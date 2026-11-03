import { spawn, type ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { redactSecrets } from '../shared/redaction';
import { sha256Hex } from '../shared/hash';
import {
  assessCommand,
  buildChildEnvironment,
  formatCommandForAudit,
  isAllowedExecutable,
  isBlockedExecutable,
  type CommandAssessment,
} from '../security/commands';
import { resolveWorkspacePath } from '../security/paths';
import {
  failure,
  type JsonSchema,
  type Tool,
  type ToolContext,
  type ToolErrorCode,
  type ToolResult,
} from './types';

export const DEFAULT_TERMINAL_TIMEOUT_MS = 120_000;
export const MAX_TERMINAL_TIMEOUT_MS = 600_000;
export const MAX_STDOUT_BYTES = 256 * 1024;
export const MAX_STDERR_BYTES = 128 * 1024;
export const MAX_ARGS = 128;
export const MAX_ARG_LENGTH = 4096;
const KILL_GRACE_MS = 1500;
const objectOutput: JsonSchema = { type: 'object' };

export interface TerminalExecuteInput {
  file: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface TerminalExecuteResult {
  file: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  stdoutBytes: number;
  stderrBytes: number;
}

export interface TerminalCommand {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface TerminalRunnerResult {
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  stdoutBytes: number;
  stderrBytes: number;
  timedOut: boolean;
  cancelled: boolean;
  spawnError?: { code?: string; message: string };
}

export interface TerminalRunner {
  run(command: TerminalCommand): Promise<TerminalRunnerResult>;
}

function killProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) {
    return;
  }
  if (process.platform === 'win32') {
    const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    taskkill.on('error', () => child.kill(signal));
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Process already exited.
    }
  }
}

function appendChunk(
  chunks: Buffer[],
  currentBytes: number,
  totalBytes: number,
  chunk: Buffer,
  cap: number,
): { captured: number; total: number; truncated: boolean } {
  const remaining = cap - currentBytes;
  if (remaining > 0) {
    const slice = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
    chunks.push(slice);
  }
  const total = totalBytes + chunk.length;
  return {
    captured: currentBytes + Math.min(chunk.length, Math.max(remaining, 0)),
    total,
    truncated: total > cap,
  };
}

export const nodeTerminalRunner: TerminalRunner = {
  async run(command) {
    if (command.signal.aborted) {
      return {
        exitCode: null,
        signal: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutBytes: 0,
        stderrBytes: 0,
        timedOut: false,
        cancelled: true,
      };
    }

    const startedAt = Date.now();
    return new Promise<TerminalRunnerResult>((resolvePromise) => {
      const child = spawn(command.file, command.args, {
        cwd: command.cwd,
        env: command.env,
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutCaptured = 0;
      let stderrCaptured = 0;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let timedOut = false;
      let cancelled = false;
      let spawnError: TerminalRunnerResult['spawnError'];
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child, 'SIGTERM');
        killTimer = setTimeout(() => killProcessTree(child, 'SIGKILL'), KILL_GRACE_MS);
      }, command.timeoutMs);

      const onAbort = (): void => {
        cancelled = true;
        killProcessTree(child, 'SIGTERM');
        killTimer = setTimeout(() => killProcessTree(child, 'SIGKILL'), KILL_GRACE_MS);
      };
      command.signal.addEventListener('abort', onAbort, { once: true });

      const finish = (exitCode: number | null, signal: string | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutTimer);
        if (killTimer) {
          clearTimeout(killTimer);
        }
        command.signal.removeEventListener('abort', onAbort);
        resolvePromise({
          exitCode,
          signal,
          durationMs: Date.now() - startedAt,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          stdoutTruncated,
          stderrTruncated,
          stdoutBytes,
          stderrBytes,
          timedOut,
          cancelled,
          spawnError,
        });
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        const next = appendChunk(
          stdoutChunks,
          stdoutCaptured,
          stdoutBytes,
          chunk,
          MAX_STDOUT_BYTES,
        );
        stdoutCaptured = next.captured;
        stdoutBytes = next.total;
        stdoutTruncated ||= next.truncated;
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const next = appendChunk(
          stderrChunks,
          stderrCaptured,
          stderrBytes,
          chunk,
          MAX_STDERR_BYTES,
        );
        stderrCaptured = next.captured;
        stderrBytes = next.total;
        stderrTruncated ||= next.truncated;
      });

      child.once('error', (error: NodeJS.ErrnoException) => {
        spawnError = {
          code: error.code,
          message: redactSecrets(error.message),
        };
        if (!child.pid) {
          finish(null, null);
        }
      });

      child.once('close', (code, signal) => {
        finish(code, signal);
      });
    });
  },
};

function mapPathFailure(
  resolution: Extract<Awaited<ReturnType<typeof resolveWorkspacePath>>, { ok: false }>,
): ToolResult<never> {
  switch (resolution.reason) {
    case 'not_found':
      return failure('not_found', resolution.message);
    case 'outside_workspace':
      return failure('unsafe_path', resolution.message);
    default:
      return failure('invalid_arguments', resolution.message);
  }
}

async function resolveCwd(
  input: TerminalExecuteInput,
  ctx: ToolContext,
): Promise<{ ok: true; cwd: string } | { ok: false; result: ToolResult<never> }> {
  const resolution = await resolveWorkspacePath(input.cwd ?? '.', ctx.workspaceRoots, {
    mustExist: true,
  });
  if (!resolution.ok) {
    return { ok: false, result: mapPathFailure(resolution) };
  }
  const metadata = await stat(resolution.path.absolute);
  if (!metadata.isDirectory()) {
    return {
      ok: false,
      result: failure(
        'invalid_arguments',
        'Terminal cwd must be a directory inside the workspace.',
      ),
    };
  }
  return { ok: true, cwd: resolution.path.absolute };
}

async function resolveExecutable(
  file: string,
  cwd: string,
  ctx: ToolContext,
): Promise<{ ok: true; file: string } | { ok: false; result: ToolResult<never> }> {
  if (
    file.trim().length === 0 ||
    file.includes('\0') ||
    file.includes('\n') ||
    file.includes('\r')
  ) {
    return {
      ok: false,
      result: failure(
        'invalid_arguments',
        'Executable path is empty or contains control characters.',
      ),
    };
  }
  if (isBlockedExecutable(file)) {
    return {
      ok: false,
      result: failure(
        'permission_denied',
        `${file} is a shell, interactive, privileged, or credential-transfer executable and is not supported.`,
      ),
    };
  }

  if (isAbsolute(file)) {
    const resolution = await resolveWorkspacePath(file, ctx.workspaceRoots, {
      mustExist: true,
    });
    if (resolution.ok) {
      return { ok: true, file: resolution.path.absolute };
    }
    if (resolution.reason === 'outside_workspace' && isAllowedExecutable(file)) {
      return { ok: true, file };
    }
    if (resolution.reason === 'not_found') {
      return { ok: false, result: failure('not_found', 'Executable does not exist.') };
    }
    if (resolution.reason === 'outside_workspace') {
      return {
        ok: false,
        result: failure(
          'permission_denied',
          'Executables outside the workspace must be in the allowlisted system command set.',
        ),
      };
    }
    return { ok: false, result: mapPathFailure(resolution) };
  }

  if (file.includes('/') || file.includes('\\')) {
    const absolute = resolve(cwd, file);
    const resolution = await resolveWorkspacePath(absolute, ctx.workspaceRoots, {
      mustExist: true,
    });
    if (!resolution.ok) {
      return { ok: false, result: mapPathFailure(resolution) };
    }
    return { ok: true, file: resolution.path.absolute };
  }

  if (!isAllowedExecutable(file)) {
    return {
      ok: false,
      result: failure(
        'permission_denied',
        `Executable ${file} is not in the terminal allowlist. Use a workspace script path or an approved toolchain command.`,
      ),
    };
  }
  return { ok: true, file };
}

interface PreparedTerminalCommand {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  assessment: CommandAssessment;
}

type PreparedTerminal =
  { ok: true; command: PreparedTerminalCommand } | { ok: false; result: ToolResult<never> };

function workspaceForPath(cwd: string, roots: string[]): string {
  return (
    roots.find((root) => {
      const child = relative(root, cwd);
      return child === '' || (!child.startsWith('..') && !isAbsolute(child));
    }) ??
    roots[0] ??
    cwd
  );
}

async function prepareTerminal(
  input: TerminalExecuteInput,
  ctx: ToolContext,
): Promise<PreparedTerminal> {
  if (
    [input.file, ...input.args].some(
      (value) => value.includes('\0') || value.includes('\n') || value.includes('\r'),
    )
  ) {
    return {
      ok: false,
      result: failure(
        'invalid_arguments',
        'Command file and arguments must not contain NUL or newline characters.',
      ),
    };
  }
  if (input.args.length > MAX_ARGS || input.args.some((arg) => arg.length > MAX_ARG_LENGTH)) {
    return {
      ok: false,
      result: failure('invalid_arguments', 'Command arguments exceed the allowed limits.'),
    };
  }

  const cwd = await resolveCwd(input, ctx);
  if (!cwd.ok) return { ok: false, result: cwd.result };

  const executable = await resolveExecutable(input.file, cwd.cwd, ctx);
  if (!executable.ok) return { ok: false, result: executable.result };

  const assessment = assessCommand(executable.file, input.args);
  if (assessment.risk === 'blocked') {
    return {
      ok: false,
      result: failure('permission_denied', assessment.reason, {
        details: { risk: assessment.risk, matchedRule: assessment.matchedRule },
      }),
    };
  }

  const environment = buildChildEnvironment(input.env ?? {});
  if (environment.rejected.length > 0) {
    return {
      ok: false,
      result: failure(
        'invalid_arguments',
        `Environment variables are not allowed: ${environment.rejected.join(', ')}`,
        { details: { rejected: environment.rejected } },
      ),
    };
  }

  return {
    ok: true,
    command: {
      file: executable.file,
      args: [...input.args],
      cwd: cwd.cwd,
      env: environment.env,
      timeoutMs: input.timeoutMs ?? DEFAULT_TERMINAL_TIMEOUT_MS,
      assessment,
    },
  };
}

function outputDetails(run: TerminalRunnerResult): Record<string, unknown> {
  return {
    exitCode: run.exitCode,
    signal: run.signal,
    durationMs: run.durationMs,
    stdout: run.stdout,
    stderr: run.stderr,
    stdoutTruncated: run.stdoutTruncated,
    stderrTruncated: run.stderrTruncated,
    stdoutBytes: run.stdoutBytes,
    stderrBytes: run.stderrBytes,
    timedOut: run.timedOut,
    cancelled: run.cancelled,
  };
}

function spawnErrorCode(code: string | undefined): ToolErrorCode {
  if (code === 'ENOENT') {
    return 'not_found';
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return 'permission_denied';
  }
  return 'command_failed';
}

function terminalAuditMetadata(
  input: TerminalExecuteInput,
  result: ToolResult<TerminalExecuteResult>,
): Record<string, unknown> {
  const details = result.ok
    ? result.data
    : (result.error.details as Partial<TerminalExecuteResult> | undefined);
  const stdout = typeof details?.stdout === 'string' ? details.stdout : '';
  const stderr = typeof details?.stderr === 'string' ? details.stderr : '';
  const command = formatCommandForAudit(
    input.file,
    input.args,
    typeof details?.cwd === 'string' ? details.cwd : (input.cwd ?? '.'),
  );
  return {
    ...command,
    exitCode: details?.exitCode ?? null,
    signal: details?.signal ?? null,
    durationMs: details?.durationMs ?? 0,
    exitStatus: result.ok ? 'ok' : result.error.code,
    stdoutBytes: details?.stdoutBytes ?? 0,
    stderrBytes: details?.stderrBytes ?? 0,
    stdoutTruncated: details?.stdoutTruncated ?? false,
    stderrTruncated: details?.stderrTruncated ?? false,
    outputSha256: sha256Hex(`${stdout}\0${stderr}`),
  };
}

export function createTerminalExecuteTool(
  runner: TerminalRunner = nodeTerminalRunner,
): Tool<TerminalExecuteInput, TerminalExecuteResult> {
  return {
    id: 'terminal.execute',
    description: 'Run an approved, non-interactive command inside the workspace without a shell.',
    permission: 'execute',
    timeoutMs: MAX_TERMINAL_TIMEOUT_MS + 5_000,
    maxResultBytes: MAX_STDOUT_BYTES + MAX_STDERR_BYTES,
    idempotent: false,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', minLength: 1, maxLength: 1024 },
        args: {
          type: 'array',
          items: { type: 'string', maxLength: MAX_ARG_LENGTH },
          maxItems: MAX_ARGS,
        },
        cwd: { type: 'string', maxLength: 4096 },
        timeoutMs: {
          type: 'integer',
          minimum: 100,
          maximum: MAX_TERMINAL_TIMEOUT_MS,
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string', maxLength: MAX_ARG_LENGTH },
        },
      },
      required: ['file', 'args'],
      additionalProperties: false,
    },
    outputSchema: objectOutput,
    async preflight(input, ctx) {
      const prepared = await prepareTerminal(input, ctx);
      if (!prepared.ok) {
        return { failure: prepared.result };
      }
      const command = prepared.command;
      const formatted = formatCommandForAudit(command.file, command.args, command.cwd);
      return {
        summary: `Run ${formatted.file} ${formatted.args.join(' ')} in ${formatted.cwd}`.trim(),
        paths: [command.cwd],
        command: {
          workspace: workspaceForPath(command.cwd, ctx.workspaceRoots),
          file: command.file,
          args: [...command.args],
          cwd: command.cwd,
        },
      };
    },
    async execute(input, ctx): Promise<ToolResult<TerminalExecuteResult>> {
      const prepared = await prepareTerminal(input, ctx);
      if (!prepared.ok) {
        return prepared.result;
      }
      const command = prepared.command;

      const run = await runner.run({
        file: command.file,
        args: command.args,
        cwd: command.cwd,
        env: command.env,
        timeoutMs: command.timeoutMs,
        signal: ctx.signal,
      });

      if (run.spawnError) {
        return failure(
          spawnErrorCode(run.spawnError.code),
          run.spawnError.message || `Failed to start ${input.file}.`,
          { details: { spawnErrorCode: run.spawnError.code, ...outputDetails(run) } },
        );
      }

      const data: TerminalExecuteResult = {
        file: command.file,
        args: command.args,
        cwd: command.cwd,
        exitCode: run.exitCode,
        signal: run.signal,
        durationMs: run.durationMs,
        stdout: run.stdout,
        stderr: run.stderr,
        stdoutTruncated: run.stdoutTruncated,
        stderrTruncated: run.stderrTruncated,
        stdoutBytes: run.stdoutBytes,
        stderrBytes: run.stderrBytes,
      };

      if (run.cancelled) {
        return failure('cancelled', 'The command was cancelled.', {
          retryable: true,
          details: outputDetails(run),
        });
      }
      if (run.timedOut) {
        return failure(
          'timeout',
          `Command timed out after ${command.timeoutMs} ms and was terminated.`,
          {
            retryable: true,
            details: outputDetails(run),
          },
        );
      }
      if (run.exitCode !== 0) {
        return failure(
          'command_failed',
          run.exitCode === null
            ? `Command terminated by signal ${run.signal ?? 'unknown'}.`
            : `Command exited with code ${run.exitCode}.`,
          {
            retryable: false,
            details: {
              ...data,
              assessment: {
                risk: command.assessment.risk,
                matchedRule: command.assessment.matchedRule,
              },
            },
          },
        );
      }

      return {
        ok: true,
        data,
        truncated: run.stdoutTruncated || run.stderrTruncated,
        bytes: run.stdoutBytes + run.stderrBytes,
      };
    },
    auditMetadata: terminalAuditMetadata,
  };
}

export const terminalExecute = createTerminalExecuteTool();
export const terminalTools: Tool[] = [terminalExecute as Tool];

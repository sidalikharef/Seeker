import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DEFAULT_SECRET_GLOBS } from '../security/exclusions';
import { resolveWorkspacePath } from '../security/paths';
import { failure, type JsonSchema, type Tool, type ToolResult } from './types';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const MAX_GIT_BYTES = 512 * 1024;
const objectOutput: JsonSchema = { type: 'object' };

export interface GitCommandRunner {
  run(
    args: string[],
    cwd: string,
    signal: AbortSignal,
  ): Promise<{ stdout: string; stderr: string }>;
}

type GitRunResult =
  | { ok: true; stdout: string }
  | { ok: false; kind: 'not_repo' | 'cancelled' | 'too_large' | 'failed'; message: string };

function isNotRepository(message: string): boolean {
  return /not a git repository/i.test(message);
}

export const nodeGitRunner: GitCommandRunner = {
  async run(args, cwd, signal) {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_GIT_BYTES,
      signal,
    });
    return { stdout: stdout ?? '', stderr: stderr ?? '' };
  },
};

async function runGit(
  runner: GitCommandRunner,
  args: string[],
  cwd: string,
  signal: AbortSignal,
): Promise<GitRunResult> {
  try {
    const result = await runner.run(args, cwd, signal);
    return { ok: true, stdout: result.stdout };
  } catch (error: unknown) {
    const err = error as {
      code?: string;
      killed?: boolean;
      stderr?: string;
      message?: string;
      name?: string;
    };
    if (signal.aborted || err.name === 'AbortError' || err.killed) {
      return { ok: false, kind: 'cancelled', message: 'Git operation was cancelled.' };
    }
    if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      return { ok: false, kind: 'too_large', message: 'Git output exceeds the limit.' };
    }
    const output = err.stderr ?? err.message ?? '';
    if (isNotRepository(output)) {
      return { ok: false, kind: 'not_repo', message: 'Not a Git repository.' };
    }
    return { ok: false, kind: 'failed', message: output.trim() || 'Git command failed.' };
  }
}

function gitFailure(result: Extract<GitRunResult, { ok: false }>): ToolResult<never> {
  switch (result.kind) {
    case 'not_repo':
      return failure('not_found', result.message, { details: { isRepository: false } });
    case 'cancelled':
      return failure('cancelled', result.message, { retryable: true });
    case 'too_large':
      return failure('too_large', result.message);
    default:
      return failure('internal', result.message);
  }
}

async function resolveCwd(
  inputPath: string | undefined,
  ctx: Parameters<Tool['execute']>[1],
): Promise<
  { ok: true; root: string; absolute: string } | { ok: false; result: ToolResult<never> }
> {
  const resolution = await resolveWorkspacePath(inputPath ?? '.', ctx.workspaceRoots, {
    mustExist: true,
  });
  if (!resolution.ok) {
    if (resolution.reason === 'outside_workspace') {
      return { ok: false, result: failure('unsafe_path', resolution.message) };
    }
    if (resolution.reason === 'not_found') {
      return { ok: false, result: failure('not_found', resolution.message) };
    }
    return { ok: false, result: failure('invalid_arguments', resolution.message) };
  }
  if (resolution.path.excluded && !ctx.allowSensitivePaths) {
    return {
      ok: false,
      result: failure(
        'permission_denied',
        `Path ${resolution.path.workspaceRelative} is excluded.`,
      ),
    };
  }
  return { ok: true, root: resolution.path.root, absolute: resolution.path.absolute };
}

interface GitStatusInput {
  path?: string;
}

interface GitStatusOutput {
  isRepository: boolean;
  branch?: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

function parseBranch(header: string): string | undefined {
  const value = header.slice(3).trim();
  if (!value) {
    return undefined;
  }
  if (value.startsWith('No commits yet on ')) {
    return value.slice('No commits yet on '.length).split(' ')[0];
  }
  if (value.startsWith('HEAD (no branch)')) {
    return 'HEAD';
  }
  return value.split('...')[0]?.split(' ')[0] || undefined;
}

export function createGitStatusTool(
  runner: GitCommandRunner = nodeGitRunner,
): Tool<GitStatusInput, GitStatusOutput> {
  return {
    id: 'git.status',
    description: 'Show read-only Git working tree status for a repository.',
    permission: 'read',
    timeoutMs: GIT_TIMEOUT_MS,
    maxResultBytes: MAX_GIT_BYTES,
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      additionalProperties: false,
    },
    outputSchema: objectOutput,
    async execute(input, ctx): Promise<ToolResult<GitStatusOutput>> {
      const cwd = await resolveCwd(input.path, ctx);
      if (!cwd.ok) return cwd.result;

      const result = await runGit(
        runner,
        ['status', '--porcelain=v1', '--branch', '--untracked-files=all'],
        cwd.root,
        ctx.signal,
      );
      if (!result.ok) {
        if (result.kind === 'not_repo') {
          return {
            ok: true,
            data: { isRepository: false, staged: [], unstaged: [], untracked: [] },
          };
        }
        return gitFailure(result);
      }

      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];
      let branch: string | undefined;

      for (const line of result.stdout.split(/\r?\n/)) {
        if (!line) continue;
        if (line.startsWith('## ')) {
          branch = parseBranch(line);
          continue;
        }
        const index = line[0];
        const workTree = line[1];
        const file = line.slice(3).split(' -> ').at(-1) ?? line.slice(3);
        if (index === '?' && workTree === '?') {
          untracked.push(file);
          continue;
        }
        if (index !== ' ') staged.push(file);
        if (workTree !== ' ') unstaged.push(file);
      }

      return {
        ok: true,
        data: { isRepository: true, branch, staged, unstaged, untracked },
        bytes: Buffer.byteLength(result.stdout, 'utf8'),
      };
    },
  };
}

interface GitDiffInput {
  path?: string;
  cached?: boolean;
  filePath?: string;
  maxBytes?: number;
}

interface GitDiffOutput {
  isRepository: boolean;
  diff: string;
  truncated: boolean;
}

export function createGitDiffTool(
  runner: GitCommandRunner = nodeGitRunner,
): Tool<GitDiffInput, GitDiffOutput> {
  return {
    id: 'git.diff',
    description: 'Show read-only Git diff output for the repository or a specific file.',
    permission: 'read',
    timeoutMs: GIT_TIMEOUT_MS,
    maxResultBytes: MAX_GIT_BYTES,
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        cached: { type: 'boolean' },
        filePath: { type: 'string' },
        maxBytes: { type: 'integer', minimum: 1, maximum: MAX_GIT_BYTES },
      },
      additionalProperties: false,
    },
    outputSchema: objectOutput,
    async execute(input, ctx): Promise<ToolResult<GitDiffOutput>> {
      const cwd = await resolveCwd(input.path, ctx);
      if (!cwd.ok) return cwd.result;

      const args = ['diff'];
      if (input.cached) args.push('--cached');
      args.push('--no-color', '--no-ext-diff');

      if (input.filePath) {
        const file = await resolveWorkspacePath(input.filePath, ctx.workspaceRoots, {
          mustExist: false,
        });
        if (!file.ok) {
          if (file.reason === 'outside_workspace') {
            return failure('unsafe_path', file.message);
          }
          return failure('invalid_arguments', file.message);
        }
        if (file.path.excluded && !ctx.allowSensitivePaths) {
          return failure('permission_denied', `Path ${file.path.workspaceRelative} is excluded.`);
        }
        args.push('--', file.path.workspaceRelative);
      } else {
        args.push('--', '.', ...DEFAULT_SECRET_GLOBS.map((pattern) => `:(exclude,glob)${pattern}`));
      }

      const result = await runGit(runner, args, cwd.root, ctx.signal);
      if (!result.ok) {
        if (result.kind === 'not_repo') {
          return { ok: true, data: { isRepository: false, diff: '', truncated: false } };
        }
        return gitFailure(result);
      }

      const maxBytes = input.maxBytes ?? 256 * 1024;
      const bytes = Buffer.byteLength(result.stdout, 'utf8');
      const diff = bytes <= maxBytes ? result.stdout : result.stdout.slice(0, maxBytes);
      return {
        ok: true,
        data: { isRepository: true, diff, truncated: bytes > maxBytes },
        truncated: bytes > maxBytes,
        bytes: Math.min(bytes, maxBytes),
      };
    },
  };
}

export const gitStatus = createGitStatusTool();
export const gitDiff = createGitDiffTool();
export const gitTools: Tool[] = [gitStatus as Tool, gitDiff as Tool];

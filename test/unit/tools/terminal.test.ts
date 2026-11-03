import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTerminalExecuteTool,
  MAX_STDOUT_BYTES,
  type TerminalCommand,
  type TerminalRunner,
  type TerminalRunnerResult,
} from '../../../src/tools/terminal';
import { MemoryAuditLogger } from '../../../src/security/audit';
import { ToolDispatcher } from '../../../src/tools/dispatcher';
import { ToolRegistry } from '../../../src/tools/registry';
import {
  AllowAllPermissionManager,
  createContext,
  makeWorkspace,
  type TestWorkspace,
} from './helpers';
import { DenyAllPermissionManager } from './helpers';
import { SessionCommandAllowlist } from '../../../src/security/approvals';
import {
  DefaultPermissionManager,
  SessionAwarePermissionManager,
} from '../../../src/tools/permissions';

let workspace: TestWorkspace | undefined;

afterEach(async () => {
  await workspace?.cleanup();
  workspace = undefined;
});

function fakeRunner(
  overrides: Partial<TerminalRunnerResult> = {},
): TerminalRunner & { commands: TerminalCommand[] } {
  const commands: TerminalCommand[] = [];
  return {
    commands,
    async run(command) {
      commands.push(command);
      return {
        exitCode: 0,
        signal: null,
        durationMs: 12,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutBytes: 0,
        stderrBytes: 0,
        timedOut: false,
        cancelled: false,
        ...overrides,
      };
    },
  };
}

describe('terminal.execute', () => {
  it('spawns an allowlisted executable in a workspace cwd with a filtered environment', async () => {
    workspace = await makeWorkspace({ 'nested/.keep': '' });
    const runner = fakeRunner({ stdout: 'v1\n', stdoutBytes: 3 });
    const tool = createTerminalExecuteTool(runner);

    const result = await tool.execute(
      { file: 'node', args: ['--version'], cwd: 'nested' },
      createContext(workspace.root),
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        file: 'node',
        args: ['--version'],
        cwd: `${workspace.root}/nested`,
        exitCode: 0,
        stdout: 'v1\n',
        stdoutBytes: 3,
      },
    });
    expect(runner.commands).toHaveLength(1);
    expect(runner.commands[0]).toMatchObject({
      file: 'node',
      args: ['--version'],
      cwd: `${workspace.root}/nested`,
    });
    expect(runner.commands[0]?.env.PATH).toBe(process.env.PATH);
  });

  it('preflights the exact resolved command before approval', async () => {
    workspace = await makeWorkspace({ 'nested/.keep': '' });
    const tool = createTerminalExecuteTool(fakeRunner());

    const preflight = await tool.preflight?.(
      { file: 'node', args: ['--version'], cwd: 'nested' },
      createContext(workspace.root),
    );

    expect(preflight?.command).toEqual({
      workspace: workspace.root,
      file: 'node',
      args: ['--version'],
      cwd: `${workspace.root}/nested`,
    });
    expect(preflight?.summary).toContain('node --version');
  });

  it('does not request approval for commands that fail preflight validation', async () => {
    workspace = await makeWorkspace({});
    const tool = createTerminalExecuteTool(fakeRunner());

    const blocked = await tool.preflight?.(
      { file: 'git', args: ['reset', '--hard'] },
      createContext(workspace.root),
    );
    expect(blocked?.failure).toMatchObject({ ok: false, error: { code: 'permission_denied' } });

    const escaped = await tool.preflight?.(
      { file: 'node', args: [], cwd: '..' },
      createContext(workspace.root),
    );
    expect(escaped?.failure).toMatchObject({ ok: false, error: { code: 'unsafe_path' } });
  });

  it('resolves workspace-relative script paths', async () => {
    workspace = await makeWorkspace({ 'scripts/run.js': '' });
    const runner = fakeRunner();
    const tool = createTerminalExecuteTool(runner);

    const result = await tool.execute(
      { file: 'scripts/run.js', args: [] },
      createContext(workspace.root),
    );

    expect(result).toMatchObject({ ok: true });
    expect(runner.commands[0]?.file).toBe(`${workspace.root}/scripts/run.js`);
  });

  it('rejects absolute executables outside the workspace unless allowlisted', async () => {
    workspace = await makeWorkspace({});
    const runner = fakeRunner();
    const tool = createTerminalExecuteTool(runner);
    const ctx = createContext(workspace.root);

    const allowed = await tool.execute({ file: process.execPath, args: ['--version'] }, ctx);
    expect(allowed).toMatchObject({ ok: true, data: { file: process.execPath } });

    const denied = await tool.execute({ file: '/usr/bin/untrusted-tool', args: [] }, ctx);
    expect(denied).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    expect(runner.commands).toHaveLength(1);
  });

  it('rejects shells, unknown executables, and cwd escapes before spawning', async () => {
    workspace = await makeWorkspace({ 'file.txt': 'x' });
    const runner = fakeRunner();
    const tool = createTerminalExecuteTool(runner);
    const ctx = createContext(workspace.root);

    await expect(tool.execute({ file: 'bash', args: ['-lc', 'ls'] }, ctx)).resolves.toMatchObject({
      ok: false,
      error: { code: 'permission_denied' },
    });
    await expect(tool.execute({ file: 'unknown-tool', args: [] }, ctx)).resolves.toMatchObject({
      ok: false,
      error: { code: 'permission_denied' },
    });
    await expect(tool.execute({ file: 'node', args: [], cwd: '..' }, ctx)).resolves.toMatchObject({
      ok: false,
      error: { code: 'unsafe_path' },
    });
    await expect(
      tool.execute({ file: 'node', args: [], cwd: 'file.txt' }, ctx),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    expect(runner.commands).toHaveLength(0);
  });

  it('blocks policy violations and rejects secret environment keys', async () => {
    workspace = await makeWorkspace({});
    const runner = fakeRunner();
    const tool = createTerminalExecuteTool(runner);
    const ctx = createContext(workspace.root);

    await expect(
      tool.execute({ file: 'git', args: ['reset', '--hard'] }, ctx),
    ).resolves.toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    await expect(
      tool.execute({ file: 'node', args: ['-e', 'x'], env: { OPENAI_API_KEY: 'secret' } }, ctx),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    expect(runner.commands).toHaveLength(0);
  });

  it('maps spawn errors to structured tool errors', async () => {
    workspace = await makeWorkspace({});
    const tool = createTerminalExecuteTool(
      fakeRunner({
        spawnError: { code: 'ENOENT', message: 'spawn node ENOENT' },
      }),
    );

    await expect(
      tool.execute({ file: 'node', args: ['--version'] }, createContext(workspace.root)),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('returns command_failed for non-zero exits and preserves output metadata', async () => {
    workspace = await makeWorkspace({});
    const tool = createTerminalExecuteTool(
      fakeRunner({
        exitCode: 2,
        stdout: 'partial',
        stderr: 'bad',
        stdoutBytes: 7,
        stderrBytes: 3,
      }),
    );

    const result = await tool.execute(
      { file: 'node', args: ['-e', 'process.exit(2)'] },
      createContext(workspace.root),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'command_failed',
        details: {
          exitCode: 2,
          stdout: 'partial',
          stderr: 'bad',
          stdoutBytes: 7,
          stderrBytes: 3,
        },
      },
    });
  });

  it('maps timeout, cancellation, and truncation flags', async () => {
    workspace = await makeWorkspace({});
    const ctx = createContext(workspace.root);

    const timedOut = await createTerminalExecuteTool(
      fakeRunner({ timedOut: true, signal: 'SIGTERM', stdoutBytes: MAX_STDOUT_BYTES }),
    ).execute({ file: 'node', args: ['--version'], timeoutMs: 250 }, ctx);
    expect(timedOut).toMatchObject({ ok: false, error: { code: 'timeout', retryable: true } });

    const cancelled = await createTerminalExecuteTool(fakeRunner({ cancelled: true })).execute(
      { file: 'node', args: ['--version'] },
      ctx,
    );
    expect(cancelled).toMatchObject({ ok: false, error: { code: 'cancelled' } });

    const truncated = await createTerminalExecuteTool(
      fakeRunner({ stdoutTruncated: true, stdoutBytes: MAX_STDOUT_BYTES + 10 }),
    ).execute({ file: 'node', args: ['--version'] }, ctx);
    expect(truncated).toMatchObject({ ok: true, truncated: true });
  });

  it('audits redacted command metadata and output hashes without raw output', async () => {
    workspace = await makeWorkspace({});
    const tool = createTerminalExecuteTool(
      fakeRunner({ stdout: 'secret output', stdoutBytes: 13 }),
    );

    const result = await tool.execute(
      { file: 'node', args: ['--token', 'sk-abcdef123456'], cwd: '.' },
      createContext(workspace.root),
    );

    const audit = tool.auditMetadata?.(
      { file: 'node', args: ['--token', 'sk-abcdef123456'], cwd: '.' },
      result,
    );

    expect(audit).toMatchObject({
      file: 'node',
      cwd: `${workspace.root}`,
      exitCode: 0,
      exitStatus: 'ok',
      stdoutBytes: 13,
    });
    expect(JSON.stringify(audit)).not.toContain('sk-abcdef123456');
    expect(JSON.stringify(audit)).not.toContain('secret output');
    expect(audit?.outputSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('includes command metadata when the dispatcher denies execution', async () => {
    workspace = await makeWorkspace({});
    const registry = new ToolRegistry();
    registry.register(createTerminalExecuteTool(fakeRunner()) as never);
    const logger = new MemoryAuditLogger();
    const ctx = createContext(workspace.root, {
      logger,
      mode: 'debug',
      permissions: new DenyAllPermissionManager(),
    });

    await new ToolDispatcher(registry).execute(
      'terminal.execute',
      { file: 'node', args: ['--version'], cwd: '.' },
      ctx,
    );

    expect(logger.entries.at(-1)).toMatchObject({
      toolId: 'terminal.execute',
      decision: 'deny',
      details: {
        file: 'node',
        args: ['--version'],
        cwd: '.',
        exitCode: null,
      },
    });
  });

  it('allows execution when permissions are granted', async () => {
    workspace = await makeWorkspace({});
    const registry = new ToolRegistry();
    registry.register(createTerminalExecuteTool(fakeRunner({ stdout: 'ok' })) as never);
    const ctx = createContext(workspace.root, {
      mode: 'debug',
      permissions: new AllowAllPermissionManager(),
    });

    await expect(
      new ToolDispatcher(registry).execute(
        'terminal.execute',
        { file: 'node', args: ['--version'] },
        ctx,
      ),
    ).resolves.toMatchObject({ ok: true, data: { stdout: 'ok' } });
  });

  it('reuses an exact session command approval without prompting again', async () => {
    workspace = await makeWorkspace({});
    const registry = new ToolRegistry();
    registry.register(createTerminalExecuteTool(fakeRunner()) as never);
    const approvals = new SessionCommandAllowlist();
    const permissions = new SessionAwarePermissionManager(
      true,
      new DefaultPermissionManager(),
      approvals,
    );
    const approve = vi.fn(async (request) => {
      if (!request.command) return false;
      approvals.allow(request.sessionId, request.command);
      return true;
    });
    const dispatcher = new ToolDispatcher(registry);
    const ctx = {
      ...createContext(workspace.root, { mode: 'debug', permissions }),
      approve,
    };

    await expect(
      dispatcher.execute('terminal.execute', { file: 'node', args: ['--version'] }, ctx),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      dispatcher.execute('terminal.execute', { file: 'node', args: ['--version'] }, ctx),
    ).resolves.toMatchObject({ ok: true });
    expect(approve).toHaveBeenCalledTimes(1);

    await dispatcher.execute('terminal.execute', { file: 'node', args: ['--help'] }, ctx);
    expect(approve).toHaveBeenCalledTimes(2);
  });
});

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryAuditLogger } from '../../../src/security/audit';
import { ToolDispatcher } from '../../../src/tools/dispatcher';
import { ToolRegistry } from '../../../src/tools/registry';
import {
  createTerminalExecuteTool,
  MAX_STDOUT_BYTES,
  nodeTerminalRunner,
} from '../../../src/tools/terminal';
import { makeWorkspace, type TestWorkspace } from '../../unit/tools/helpers';
import type { ToolContext } from '../../../src/tools/types';
import { AllowAllPermissionManager } from '../../unit/tools/helpers';

let workspace: TestWorkspace | undefined;

afterEach(async () => {
  await workspace?.cleanup();
  workspace = undefined;
});

function context(root: string, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionId: 'terminal-integration',
    workspaceRoots: [root],
    signal: new AbortController().signal,
    logger: new MemoryAuditLogger(),
    permissions: new AllowAllPermissionManager(),
    mode: 'debug',
    ...overrides,
  };
}

async function waitForDead(pid: number, timeoutMs = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        return true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function killIfAlive(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

describe('terminal execution integration', () => {
  it('captures stdout without shell interpretation and respects cwd', async () => {
    workspace = await makeWorkspace({ 'sub/.keep': '' });
    const tool = createTerminalExecuteTool(nodeTerminalRunner);

    const result = await tool.execute(
      {
        file: process.execPath,
        args: ['-e', 'console.log(process.argv[1]); console.log(process.cwd())', '$(echo nope)'],
        cwd: 'sub',
      },
      context(workspace.root),
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('terminal command failed');
    expect(result.data.stdout).toContain('$(echo nope)');
    expect(result.data.stdout).toContain(join(workspace.root, 'sub'));
    expect(result.data.stdout).not.toContain('nope\n');
  });

  it('returns non-zero exit code, stderr, and output metadata', async () => {
    workspace = await makeWorkspace({});
    const tool = createTerminalExecuteTool(nodeTerminalRunner);

    const result = await tool.execute(
      {
        file: process.execPath,
        args: ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(7)'],
      },
      context(workspace.root),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'command_failed',
        details: { exitCode: 7, stdout: 'out', stderr: 'err', stdoutBytes: 3, stderrBytes: 3 },
      },
    });
  });

  it('caps large stdout and marks truncation', async () => {
    workspace = await makeWorkspace({});
    const tool = createTerminalExecuteTool(nodeTerminalRunner);

    const result = await tool.execute(
      {
        file: process.execPath,
        args: ['-e', 'process.stdout.write("x".repeat(300000))'],
      },
      context(workspace.root),
    );

    expect(result).toMatchObject({
      ok: true,
      truncated: true,
      data: {
        stdoutTruncated: true,
        stdoutBytes: 300_000,
      },
    });
    if (!result.ok) throw new Error('terminal command failed');
    expect(result.data.stdout).toHaveLength(MAX_STDOUT_BYTES);
  });

  it.skipIf(process.platform === 'win32')('times out and terminates the process tree', async () => {
    workspace = await makeWorkspace({
      'timeout.js': [
        "const { spawn } = require('node:child_process');",
        "const fs = require('node:fs');",
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        "fs.writeFileSync('pids.json', JSON.stringify({ parent: process.pid, child: child.pid }));",
        'setInterval(() => {}, 1000);',
      ].join('\n'),
    });
    const tool = createTerminalExecuteTool(nodeTerminalRunner);
    const pidsFile = join(workspace.root, 'pids.json');
    let pids: { parent: number; child: number } | undefined;

    try {
      const result = await tool.execute(
        { file: process.execPath, args: ['timeout.js'], timeoutMs: 750 },
        context(workspace.root),
      );
      pids = JSON.parse(await readFile(pidsFile, 'utf8')) as { parent: number; child: number };

      expect(result).toMatchObject({ ok: false, error: { code: 'timeout' } });
      await expect(waitForDead(pids.parent)).resolves.toBe(true);
      await expect(waitForDead(pids.child)).resolves.toBe(true);
    } finally {
      if (pids) {
        killIfAlive(pids.parent);
        killIfAlive(pids.child);
      }
    }
  });

  it.skipIf(process.platform === 'win32')('cancels and terminates the process tree', async () => {
    workspace = await makeWorkspace({
      'cancel.js': [
        "const fs = require('node:fs');",
        "fs.writeFileSync('cancel-pid', String(process.pid));",
        'setInterval(() => {}, 1000);',
      ].join('\n'),
    });
    const controller = new AbortController();
    const pidFile = join(workspace.root, 'cancel-pid');
    let pid: number | undefined;

    try {
      const execution = createTerminalExecuteTool(nodeTerminalRunner).execute(
        { file: process.execPath, args: ['cancel.js'] },
        context(workspace.root, { signal: controller.signal }),
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      pid = Number(await readFile(pidFile, 'utf8'));
      controller.abort();

      await expect(execution).resolves.toMatchObject({
        ok: false,
        error: { code: 'cancelled' },
      });
      await expect(waitForDead(pid)).resolves.toBe(true);
    } finally {
      if (pid) killIfAlive(pid);
    }
  });

  it('executes through the dispatcher and audits metadata without raw output', async () => {
    workspace = await makeWorkspace({});
    const registry = new ToolRegistry();
    registry.register(createTerminalExecuteTool() as never);
    const logger = new MemoryAuditLogger();

    const result = await new ToolDispatcher(registry).execute(
      'terminal.execute',
      { file: process.execPath, args: ['-e', 'console.log("hello")'], cwd: '.' },
      context(workspace.root, { logger }),
    );

    expect(result).toMatchObject({ ok: true, data: { stdout: 'hello\n' } });
    expect(logger.entries.at(-1)).toMatchObject({
      toolId: 'terminal.execute',
      status: 'ok',
      details: {
        file: process.execPath,
        cwd: workspace.root,
        exitCode: 0,
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(JSON.stringify(logger.entries)).not.toContain('hello\\n');
  });
});

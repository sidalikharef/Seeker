import { afterEach, describe, expect, it } from 'vitest';
import {
  createGitDiffTool,
  createGitStatusTool,
  type GitCommandRunner,
} from '../../../src/tools/git';
import { createContext, makeWorkspace, type TestWorkspace } from './helpers';

let workspace: TestWorkspace | undefined;

afterEach(async () => {
  await workspace?.cleanup();
  workspace = undefined;
});

function runner(
  stdout: string,
): GitCommandRunner & { calls: Array<{ args: string[]; cwd: string }> } {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  return {
    calls,
    async run(args, cwd) {
      calls.push({ args, cwd });
      return { stdout, stderr: '' };
    },
  };
}

describe('git.status', () => {
  it('parses branch, staged, unstaged, and untracked entries', async () => {
    workspace = await makeWorkspace({ 'src/a.ts': 'a' });
    const fake = runner(
      [
        '## main...origin/main [ahead 1]',
        'M  staged.ts',
        ' M unstaged.ts',
        'MM both.ts',
        '?? new.ts',
        'R  old.ts -> renamed.ts',
      ].join('\n'),
    );
    const tool = createGitStatusTool(fake);

    const result = await tool.execute({}, createContext(workspace.root));

    expect(result).toMatchObject({
      ok: true,
      data: {
        isRepository: true,
        branch: 'main',
        staged: ['staged.ts', 'both.ts', 'renamed.ts'],
        unstaged: ['unstaged.ts', 'both.ts'],
        untracked: ['new.ts'],
      },
    });
    expect(fake.calls[0]?.args).toEqual([
      'status',
      '--porcelain=v1',
      '--branch',
      '--untracked-files=all',
    ]);
  });

  it('returns a non-repository result for non-repositories', async () => {
    workspace = await makeWorkspace({});
    const tool = createGitStatusTool({
      async run() {
        throw Object.assign(new Error('failed'), { stderr: 'fatal: not a git repository' });
      },
    });

    await expect(tool.execute({}, createContext(workspace.root))).resolves.toEqual({
      ok: true,
      data: { isRepository: false, staged: [], unstaged: [], untracked: [] },
    });
  });

  it('rejects excluded working directories', async () => {
    workspace = await makeWorkspace({ '.env': 'secret' });
    const fake = runner('');

    await expect(
      createGitStatusTool(fake).execute({ path: '.env' }, createContext(workspace.root)),
    ).resolves.toMatchObject({ ok: false, error: { code: 'permission_denied' } });
  });
});

describe('git.diff', () => {
  it('requests safe diff arguments and truncates by maxBytes', async () => {
    workspace = await makeWorkspace({ 'src/a.ts': 'a' });
    const fake = runner('0123456789');
    const tool = createGitDiffTool(fake);

    const result = await tool.execute({ maxBytes: 4 }, createContext(workspace.root));

    expect(result).toMatchObject({
      ok: true,
      data: { isRepository: true, diff: '0123', truncated: true },
    });
    expect(fake.calls[0]?.args).toContain('--no-ext-diff');
    expect(fake.calls[0]?.args).toContain(':(exclude,glob)**/.env');
    expect(fake.calls[0]?.args).not.toContain('--no-index');
  });

  it('diffs a specific file after path validation', async () => {
    workspace = await makeWorkspace({ 'src/a.ts': 'a' });
    const fake = runner('diff');
    const tool = createGitDiffTool(fake);

    await expect(
      tool.execute({ filePath: 'src/a.ts', cached: true }, createContext(workspace.root)),
    ).resolves.toMatchObject({ ok: true, data: { diff: 'diff' } });
    expect(fake.calls[0]?.args).toEqual([
      'diff',
      '--cached',
      '--no-color',
      '--no-ext-diff',
      '--',
      'src/a.ts',
    ]);
    await expect(
      tool.execute({ filePath: '.env' }, createContext(workspace.root)),
    ).resolves.toMatchObject({ ok: false, error: { code: 'permission_denied' } });
  });

  it('maps cancellation and non-repository errors', async () => {
    workspace = await makeWorkspace({});
    const controller = new AbortController();
    controller.abort();
    const cancelled = createGitDiffTool({
      async run() {
        throw Object.assign(new Error('aborted'), { name: 'AbortError', killed: true });
      },
    });

    await expect(
      cancelled.execute({}, { ...createContext(workspace.root), signal: controller.signal }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } });

    const notRepo = createGitDiffTool({
      async run() {
        throw Object.assign(new Error('failed'), { stderr: 'fatal: not a git repository' });
      },
    });
    await expect(notRepo.execute({}, createContext(workspace.root))).resolves.toEqual({
      ok: true,
      data: { isRepository: false, diff: '', truncated: false },
    });
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { searchFiles, searchText } from '../../../src/tools/search';
import { createContext, makeWorkspace, type TestWorkspace } from './helpers';

let workspace: TestWorkspace | undefined;

afterEach(async () => {
  await workspace?.cleanup();
  workspace = undefined;
});

async function fixtures(): Promise<TestWorkspace> {
  return makeWorkspace({
    'src/a.ts': 'const needle = 1;\nconst other = 2;\n',
    'src/nested/b.ts': 'needle42\nNeedle43\n',
    'src/c.js': 'needle in javascript\n',
    'src/generated/out.ts': 'needle generated\n',
    'node_modules/pkg/index.js': 'needle ignored\n',
    '.env': 'needle secret\n',
    'ignored.txt': 'needle ignored by seekerignore\n',
    '.seekerignore': 'ignored.txt\n',
    'binary.bin': Buffer.from([0, 110, 101, 101, 100, 108, 101]),
  });
}

describe('search.text', () => {
  it('finds literal matches, excludes secrets/builds/ignores, and reports files', async () => {
    workspace = await fixtures();
    const ctx = createContext(workspace.root);

    const result = await searchText.execute({ query: 'needle' }, ctx);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('expected success');
    const paths = result.data.matches.map((match) => match.path);
    expect(paths).toEqual(expect.arrayContaining(['src/a.ts', 'src/nested/b.ts', 'src/c.js']));
    expect(paths).not.toEqual(expect.arrayContaining(['.env', 'ignored.txt']));
    expect(paths.some((path) => path.startsWith('node_modules/'))).toBe(false);
    expect(result.data.scannedFiles).toBeGreaterThan(0);
  });

  it('supports regex, case sensitivity, include, and exclude filters', async () => {
    workspace = await fixtures();
    const ctx = createContext(workspace.root);

    const result = await searchText.execute(
      {
        query: 'needle\\d+',
        regex: true,
        caseSensitive: true,
        include: ['src/**/*.ts'],
        exclude: ['**/generated/**'],
      },
      ctx,
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('expected success');
    expect(result.data.matches).toEqual([
      expect.objectContaining({ path: 'src/nested/b.ts', line: 1, column: 1 }),
    ]);
  });

  it('honors maxResults and marks output truncated', async () => {
    workspace = await makeWorkspace({ 'many.txt': 'needle needle needle\n' });
    const ctx = createContext(workspace.root);

    const result = await searchText.execute({ query: 'needle', maxResults: 2 }, ctx);

    expect(result).toMatchObject({ ok: true, truncated: true });
    if (result.ok) expect(result.data.matches).toHaveLength(2);
  });

  it('rejects invalid regex, unsafe paths, and cancelled searches', async () => {
    workspace = await fixtures();
    const ctx = createContext(workspace.root);

    await expect(searchText.execute({ query: '(', regex: true }, ctx)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_arguments' },
    });
    await expect(
      searchText.execute({ query: 'needle', path: '../outside' }, ctx),
    ).resolves.toMatchObject({ ok: false, error: { code: 'unsafe_path' } });

    await expect(
      searchText.execute({ query: 'needle' }, { ...ctx, signal: AbortSignal.abort() }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } });
  });
});

describe('search.files', () => {
  it('finds files matching a glob while applying exclusions', async () => {
    workspace = await fixtures();
    const ctx = createContext(workspace.root);

    const result = await searchFiles.execute({ pattern: '**/*.ts' }, ctx);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('expected success');
    expect(result.data.files).toEqual(expect.arrayContaining(['src/a.ts', 'src/nested/b.ts']));
    expect(result.data.files).toContain('src/generated/out.ts');
  });

  it('caps file results', async () => {
    workspace = await makeWorkspace({ 'a.ts': '', 'b.ts': '', 'c.ts': '' });
    const ctx = createContext(workspace.root);

    const result = await searchFiles.execute({ pattern: '*.ts', maxResults: 2 }, ctx);

    expect(result).toMatchObject({ ok: true, truncated: true });
    if (result.ok) expect(result.data.files).toHaveLength(2);
  });
});

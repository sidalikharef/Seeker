import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../src/shared/hash';
import {
  filesystemApplyPatch,
  filesystemList,
  filesystemRead,
  filesystemWrite,
} from '../../../src/tools/filesystem';
import { createContext, makeWorkspace, type TestWorkspace } from './helpers';

let workspace: TestWorkspace | undefined;

afterEach(async () => {
  await workspace?.cleanup();
  workspace = undefined;
});

describe('filesystem.read', () => {
  it('reads line ranges with hashes and truncation', async () => {
    workspace = await makeWorkspace({ 'src/file.ts': 'one\ntwo\nthree\nfour\n' });
    const ctx = createContext(workspace.root);

    const result = await filesystemRead.execute(
      { path: 'src/file.ts', startLine: 2, endLine: 3 },
      ctx,
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        path: 'src/file.ts',
        content: 'two\nthree',
        startLine: 2,
        endLine: 3,
        totalLines: 4,
        sha256: sha256Hex('one\ntwo\nthree\nfour\n'),
        truncated: false,
      },
    });
  });

  it('truncates large line ranges safely', async () => {
    workspace = await makeWorkspace({ 'large.txt': 'a'.repeat(5000) });
    const ctx = createContext(workspace.root);

    const result = await filesystemRead.execute({ path: 'large.txt', maxBytes: 100 }, ctx);

    expect(result).toMatchObject({ ok: true, truncated: true });
    if (result.ok) {
      expect(Buffer.byteLength(result.data.content, 'utf8')).toBeLessThanOrEqual(100);
    }
  });

  it('rejects missing, binary, oversized, and excluded files', async () => {
    workspace = await makeWorkspace({
      'binary.bin': Buffer.from([0, 1, 2, 3]),
      'huge.txt': 'x'.repeat(4 * 1024 * 1024 + 1),
      '.env': 'SECRET=1',
    });
    const ctx = createContext(workspace.root);

    await expect(filesystemRead.execute({ path: 'missing.txt' }, ctx)).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    await expect(filesystemRead.execute({ path: 'binary.bin' }, ctx)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_arguments' },
    });
    await expect(filesystemRead.execute({ path: 'huge.txt' }, ctx)).resolves.toMatchObject({
      ok: false,
      error: { code: 'too_large' },
    });
    await expect(filesystemRead.execute({ path: '.env' }, ctx)).resolves.toMatchObject({
      ok: false,
      error: { code: 'permission_denied' },
    });
    await expect(
      filesystemRead.execute({ path: '.env' }, { ...ctx, allowSensitivePaths: true }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('rejects paths outside the workspace', async () => {
    workspace = await makeWorkspace({ 'safe.txt': 'ok' });
    const ctx = createContext(workspace.root);

    await expect(filesystemRead.execute({ path: '../outside.txt' }, ctx)).resolves.toMatchObject({
      ok: false,
      error: { code: 'unsafe_path' },
    });
  });
});

describe('filesystem.list', () => {
  it('lists directories recursively while excluding secrets and ignored folders', async () => {
    workspace = await makeWorkspace({
      'src/a.ts': 'a',
      'src/nested/b.ts': 'b',
      'node_modules/pkg/index.js': 'x',
      '.env': 'secret',
      '.git/config': 'x',
      '.seekerignore': 'ignored.txt\n',
      'ignored.txt': 'ignored',
    });
    const ctx = createContext(workspace.root);

    const result = await filesystemList.execute({ depth: 3 }, ctx);

    expect(result).toMatchObject({ ok: true, data: { root: '.' } });
    if (!result.ok) throw new Error('expected list success');
    const paths = result.data.entries.map((entry) => entry.path);
    expect(paths).toEqual(
      expect.arrayContaining(['src', 'src/a.ts', 'src/nested', 'src/nested/b.ts']),
    );
    expect(paths).not.toContain('.env');
    expect(paths.some((path) => path.startsWith('node_modules'))).toBe(false);
    expect(paths.some((path) => path.startsWith('.git'))).toBe(false);
    expect(paths).not.toContain('ignored.txt');
  });

  it('honors maxEntries', async () => {
    workspace = await makeWorkspace({ 'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c' });
    const ctx = createContext(workspace.root);

    const result = await filesystemList.execute({ maxEntries: 2 }, ctx);

    expect(result).toMatchObject({ ok: true, truncated: true });
    if (result.ok) expect(result.data.entries).toHaveLength(2);
  });
});

describe('filesystem.write', () => {
  it('creates files and refuses replacements without a matching hash', async () => {
    workspace = await makeWorkspace({ 'src/existing.ts': 'old' });
    const ctx = createContext(workspace.root);

    const created = await filesystemWrite.execute(
      { path: 'src/new.ts', content: 'new', createIfMissing: true },
      ctx,
    );
    expect(created).toMatchObject({
      ok: true,
      data: { path: 'src/new.ts', created: true, sha256: sha256Hex('new') },
    });
    await expect(readFile(join(workspace.root, 'src/new.ts'), 'utf8')).resolves.toBe('new');

    await expect(
      filesystemWrite.execute({ path: 'src/existing.ts', content: 'changed' }, ctx),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    await expect(
      filesystemWrite.execute(
        {
          path: 'src/existing.ts',
          content: 'changed',
          expectedSha256: sha256Hex('wrong'),
        },
        ctx,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('requires createIfMissing for new files and supports hash-based replacement', async () => {
    workspace = await makeWorkspace({ 'file.txt': 'old' });
    const ctx = createContext(workspace.root);

    await expect(
      filesystemWrite.execute({ path: 'new.txt', content: 'x' }, ctx),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    const replaced = await filesystemWrite.execute(
      { path: 'file.txt', content: 'new', expectedSha256: sha256Hex('old') },
      ctx,
    );
    expect(replaced).toMatchObject({
      ok: true,
      data: { created: false, previousSha256: sha256Hex('old'), sha256: sha256Hex('new') },
    });
  });

  it('does not write when preview is rejected', async () => {
    workspace = await makeWorkspace({ 'file.txt': 'old' });
    const previewPaths: string[] = [];
    const ctx = createContext(workspace.root, {
      preview: {
        async preview(request) {
          previewPaths.push(`${request.path}:${request.before}->${request.after}`);
          return false;
        },
      },
    });

    const result = await filesystemWrite.execute(
      { path: 'file.txt', content: 'new', expectedSha256: sha256Hex('old') },
      ctx,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    expect(previewPaths).toEqual(['file.txt:old->new']);
    await expect(readFile(join(workspace.root, 'file.txt'), 'utf8')).resolves.toBe('old');
  });

  it('rejects binary replacement and oversized content', async () => {
    workspace = await makeWorkspace({ 'binary.bin': Buffer.from([0, 1]) });
    const ctx = createContext(workspace.root);

    await expect(
      filesystemWrite.execute(
        {
          path: 'binary.bin',
          content: 'text',
          expectedSha256: sha256Hex(Buffer.from([0, 1])),
        },
        ctx,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    await expect(
      filesystemWrite.execute(
        { path: 'large.txt', content: 'x'.repeat(2 * 1024 * 1024 + 1), createIfMissing: true },
        ctx,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'too_large' } });
  });
});

describe('filesystem.apply_patch', () => {
  it('applies a hash-checked patch', async () => {
    workspace = await makeWorkspace({
      'src/math.ts': 'export const n = 1;\n',
      'src/other.ts': 'export const n = 1;\n',
    });
    const ctx = createContext(workspace.root);
    const patch = `--- a/src/math.ts
+++ b/src/math.ts
@@ -1 +1 @@
-export const n = 1;
+export const n = 2;
`;

    const result = await filesystemApplyPatch.execute(
      {
        path: 'src/math.ts',
        expectedSha256: sha256Hex('export const n = 1;\n'),
        patch,
      },
      ctx,
    );

    expect(result).toMatchObject({
      ok: true,
      data: { sha256: sha256Hex('export const n = 2;\n'), hunks: 1, created: false },
    });
    await expect(readFile(join(workspace.root, 'src/math.ts'), 'utf8')).resolves.toBe(
      'export const n = 2;\n',
    );
  });

  it('rejects hash mismatches, wrong paths, and stale context', async () => {
    workspace = await makeWorkspace({
      'src/math.ts': 'export const n = 1;\n',
      'src/other.ts': 'export const n = 1;\n',
    });
    const ctx = createContext(workspace.root);
    const patch = `--- a/src/math.ts
+++ b/src/math.ts
@@ -1 +1 @@
-export const n = 1;
+export const n = 2;
`;

    await expect(
      filesystemApplyPatch.execute(
        { path: 'src/math.ts', expectedSha256: sha256Hex('wrong'), patch },
        ctx,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });
    await expect(
      filesystemApplyPatch.execute(
        {
          path: 'src/other.ts',
          expectedSha256: sha256Hex('export const n = 1;\n'),
          patch,
        },
        ctx,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });

    await writeFile(join(workspace.root, 'src/math.ts'), 'export const n = 3;\n');
    await expect(
      filesystemApplyPatch.execute(
        {
          path: 'src/math.ts',
          expectedSha256: sha256Hex('export const n = 3;\n'),
          patch,
        },
        ctx,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('creates a file only with createIfMissing', async () => {
    workspace = await makeWorkspace({});
    const ctx = createContext(workspace.root);
    const patch = `--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+export const created = true;
`;

    await expect(
      filesystemApplyPatch.execute(
        { path: 'src/new.ts', expectedSha256: sha256Hex(''), patch },
        ctx,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });

    const created = await filesystemApplyPatch.execute(
      { path: 'src/new.ts', expectedSha256: sha256Hex(''), patch, createIfMissing: true },
      ctx,
    );
    expect(created).toMatchObject({ ok: true, data: { created: true } });
  });
});

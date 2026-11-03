import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isExcludedPath, isIgnoredPath, isSensitivePath } from '../../../src/security/exclusions';
import { matchesGlob } from '../../../src/security/glob';
import { resolveWorkspacePath } from '../../../src/security/paths';
import { makeWorkspace, type TestWorkspace } from './helpers';

let workspace: TestWorkspace | undefined;

afterEach(async () => {
  await workspace?.cleanup();
  workspace = undefined;
});

describe('resolveWorkspacePath', () => {
  it('resolves relative and absolute paths inside a root', async () => {
    workspace = await makeWorkspace({ 'src/file.ts': 'export {};' });
    const relative = await resolveWorkspacePath('src/file.ts', [workspace.root], {
      mustExist: true,
    });
    const absolute = await resolveWorkspacePath(
      join(workspace.root, 'src/file.ts'),
      [workspace.root],
      {
        mustExist: true,
      },
    );

    expect(relative).toMatchObject({
      ok: true,
      path: { workspaceRelative: 'src/file.ts', excluded: false },
    });
    expect(absolute).toMatchObject({
      ok: true,
      path: { workspaceRelative: 'src/file.ts' },
    });
  });

  it('rejects traversal and absolute escapes', async () => {
    workspace = await makeWorkspace({ 'src/file.ts': '' });

    await expect(resolveWorkspacePath('../outside.txt', [workspace.root])).resolves.toMatchObject({
      ok: false,
      reason: 'outside_workspace',
    });
    await expect(resolveWorkspacePath('/etc/passwd', [workspace.root])).resolves.toMatchObject({
      ok: false,
      reason: 'outside_workspace',
    });
  });

  it('rejects symlink escapes for existing and new files', async () => {
    workspace = await makeWorkspace({ 'inside.txt': 'inside' });
    const outside = await makeWorkspace({ 'secret.txt': 'outside' });
    try {
      await symlink(join(outside.root, 'secret.txt'), join(workspace.root, 'escape-file'));
      await symlink(outside.root, join(workspace.root, 'escape-dir'));

      await expect(
        resolveWorkspacePath('escape-file', [workspace.root], { mustExist: true }),
      ).resolves.toMatchObject({ ok: false, reason: 'outside_workspace' });
      await expect(
        resolveWorkspacePath('escape-dir/new.txt', [workspace.root]),
      ).resolves.toMatchObject({ ok: false, reason: 'outside_workspace' });
    } finally {
      await outside.cleanup();
    }
  });

  it('supports multi-root workspaces', async () => {
    workspace = await makeWorkspace({ 'a/first.txt': 'first' });
    const second = await makeWorkspace({ 'b/second.txt': 'second' });
    try {
      const resolved = await resolveWorkspacePath(
        join(second.root, 'b/second.txt'),
        [workspace.root, second.root],
        { mustExist: true },
      );
      expect(resolved).toMatchObject({ ok: true, path: { workspaceRelative: 'b/second.txt' } });
    } finally {
      await second.cleanup();
    }
  });

  it('marks secret and ignored paths as excluded', async () => {
    workspace = await makeWorkspace({
      '.env': 'TOKEN=secret',
      'node_modules/pkg/index.js': 'x',
      'src/main.ts': 'ok',
    });

    const secret = await resolveWorkspacePath('.env', [workspace.root], { mustExist: true });
    const ignored = await resolveWorkspacePath('node_modules/pkg/index.js', [workspace.root], {
      mustExist: true,
    });
    const normal = await resolveWorkspacePath('src/main.ts', [workspace.root], { mustExist: true });

    expect(secret).toMatchObject({ ok: true, path: { excluded: true, sensitive: true } });
    expect(ignored).toMatchObject({ ok: true, path: { excluded: true } });
    expect(normal).toMatchObject({ ok: true, path: { excluded: false } });
  });

  it('rejects missing existing paths and accepts missing write paths', async () => {
    workspace = await makeWorkspace({ 'src/keep.ts': '' });
    if (!workspace) throw new Error('workspace not created');
    await mkdir(join(workspace.root, 'src'), { recursive: true });
    await writeFile(join(workspace.root, 'src/keep.ts'), '');

    await expect(
      resolveWorkspacePath('src/missing.ts', [workspace.root], { mustExist: true }),
    ).resolves.toMatchObject({ ok: false, reason: 'not_found' });
    await expect(resolveWorkspacePath('src/new.ts', [workspace.root])).resolves.toMatchObject({
      ok: true,
      path: { workspaceRelative: 'src/new.ts' },
    });
  });
});

describe('exclusions and globs', () => {
  it('matches common glob forms', () => {
    expect(matchesGlob('src/a.ts', 'src/**')).toBe(true);
    expect(matchesGlob('src/deep/a.ts', '**/*.ts')).toBe(true);
    expect(matchesGlob('a.ts', '*.ts')).toBe(true);
    expect(matchesGlob('src/a.js', '*.ts')).toBe(false);
    expect(matchesGlob('test/unit/a.ts', '**/unit/**')).toBe(true);
  });

  it('classifies secrets, ignored directories, and custom patterns', () => {
    expect(isSensitivePath('config/.env.local')).toBe(true);
    expect(isSensitivePath('.ssh/id_ed25519')).toBe(true);
    expect(isSensitivePath('src/index.ts')).toBe(false);
    expect(isIgnoredPath('node_modules/a/index.js')).toBe(true);
    expect(isIgnoredPath('logs/debug.log', ['logs/**'])).toBe(true);
    expect(isExcludedPath('dist/app.js')).toMatchObject({ excluded: true, sensitive: false });
  });
});

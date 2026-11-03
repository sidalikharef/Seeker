import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryAuditLogger } from '../../../src/security/audit';
import { ToolDispatcher } from '../../../src/tools/dispatcher';
import {
  filesystemApplyPatch,
  filesystemRead,
  filesystemTools,
} from '../../../src/tools/filesystem';
import { createDiagnosticsTool, type DiagnosticsReader } from '../../../src/tools/diagnostics';
import { ToolRegistry } from '../../../src/tools/registry';
import { searchText, searchTools } from '../../../src/tools/search';
import { sha256Hex } from '../../../src/shared/hash';
import {
  AllowAllPermissionManager,
  makeWorkspace,
  type TestWorkspace,
} from '../../unit/tools/helpers';
import type { DiffPreviewRequest, ToolContext } from '../../../src/tools/types';

let workspace: TestWorkspace | undefined;

afterEach(async () => {
  await workspace?.cleanup();
  workspace = undefined;
});

const reader: DiagnosticsReader = {
  async get() {
    return [
      {
        path: 'src/math.ts',
        message: 'Unused import.',
        severity: 'warning',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      },
    ];
  },
};

describe('workspace tool workflow', () => {
  it('reads, patches with preview, verifies diagnostics, and searches the result', async () => {
    workspace = await makeWorkspace({
      'src/math.ts': "import { unused } from './unused';\nexport const n = 1;\n",
    });
    const previews: DiffPreviewRequest[] = [];
    const logger = new MemoryAuditLogger();
    const registry = new ToolRegistry();
    for (const tool of [...filesystemTools, ...searchTools, createDiagnosticsTool(reader)]) {
      registry.register(tool);
    }
    const dispatcher = new ToolDispatcher(registry);
    const ctx: ToolContext = {
      sessionId: 'integration',
      workspaceRoots: [workspace.root],
      signal: new AbortController().signal,
      logger,
      permissions: new AllowAllPermissionManager(),
      mode: 'build',
      preview: {
        async preview(request) {
          previews.push(request);
          return true;
        },
      },
    };

    const read = await dispatcher.execute('filesystem.read', { path: 'src/math.ts' }, ctx);
    expect(read).toMatchObject({ ok: true });
    if (!read.ok) throw new Error('read failed');
    const before = read.data as { sha256: string; content: string };

    const patch = `--- a/src/math.ts
+++ b/src/math.ts
@@ -2 +2 @@
-export const n = 1;
+export const n = 2;
`;
    await expect(
      dispatcher.execute(
        'filesystem.apply_patch',
        { path: 'src/math.ts', expectedSha256: before.sha256, patch },
        ctx,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { sha256: sha256Hex("import { unused } from './unused';\nexport const n = 2;\n") },
    });

    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      path: 'src/math.ts',
      before: "import { unused } from './unused';\nexport const n = 1;\n",
      after: "import { unused } from './unused';\nexport const n = 2;\n",
    });

    await expect(dispatcher.execute('search.text', { query: 'n = 2' }, ctx)).resolves.toMatchObject(
      {
        ok: true,
        data: { matches: [expect.objectContaining({ path: 'src/math.ts', line: 2 })] },
      },
    );
    await expect(dispatcher.execute('diagnostics.get', {}, ctx)).resolves.toMatchObject({
      ok: true,
      data: { count: 1 },
    });

    expect(logger.entries.map((entry) => [entry.toolId, entry.status])).toEqual([
      ['filesystem.read', 'ok'],
      ['filesystem.apply_patch', 'ok'],
      ['search.text', 'ok'],
      ['diagnostics.get', 'ok'],
    ]);
    await expect(readFile(join(workspace.root, 'src/math.ts'), 'utf8')).resolves.toContain(
      'export const n = 2;',
    );
  });

  it('does not mutate files when preview is rejected', async () => {
    workspace = await makeWorkspace({ 'src/value.ts': 'export const value = 1;\n' });
    const registry = new ToolRegistry();
    registry.register(filesystemApplyPatch);
    registry.register(filesystemRead);
    registry.register(searchText);
    const dispatcher = new ToolDispatcher(registry);
    const ctx: ToolContext = {
      sessionId: 'integration-reject',
      workspaceRoots: [workspace.root],
      signal: new AbortController().signal,
      logger: new MemoryAuditLogger(),
      permissions: new AllowAllPermissionManager(),
      mode: 'build',
      preview: { preview: async () => false },
    };
    const before = await filesystemRead.execute({ path: 'src/value.ts' }, ctx);
    if (!before.ok) throw new Error('read failed');

    const result = await dispatcher.execute(
      'filesystem.apply_patch',
      {
        path: 'src/value.ts',
        expectedSha256: before.data.sha256,
        patch: `--- a/src/value.ts
+++ b/src/value.ts
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
`,
      },
      ctx,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    await expect(readFile(join(workspace.root, 'src/value.ts'), 'utf8')).resolves.toBe(
      'export const value = 1;\n',
    );
  });
});

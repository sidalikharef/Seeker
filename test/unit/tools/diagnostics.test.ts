import { afterEach, describe, expect, it } from 'vitest';
import {
  createDiagnosticsTool,
  type DiagnosticRecord,
  type DiagnosticsReader,
} from '../../../src/tools/diagnostics';
import { createContext, makeWorkspace, type TestWorkspace } from './helpers';

let workspace: TestWorkspace | undefined;

afterEach(async () => {
  await workspace?.cleanup();
  workspace = undefined;
});

function record(path: string, message: string): DiagnosticRecord {
  return {
    path,
    message,
    severity: 'error',
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    },
  };
}

describe('diagnostics.get', () => {
  it('filters excluded files from unfiltered diagnostics', async () => {
    workspace = await makeWorkspace({});
    const reader: DiagnosticsReader = {
      async get() {
        return [record('src/a.ts', 'visible'), record('.env', 'secret')];
      },
    };

    const result = await createDiagnosticsTool(reader).execute({}, createContext(workspace.root));

    expect(result).toMatchObject({
      ok: true,
      data: { count: 1, diagnostics: [{ path: 'src/a.ts', message: 'visible' }] },
    });
  });

  it('allows sensitive diagnostics only with explicit opt-in', async () => {
    workspace = await makeWorkspace({});
    const reader: DiagnosticsReader = {
      async get() {
        return [record('.env', 'secret')];
      },
    };

    const result = await createDiagnosticsTool(reader).execute(
      {},
      { ...createContext(workspace.root), allowSensitivePaths: true },
    );

    expect(result).toMatchObject({ ok: true, data: { count: 1 } });
  });

  it('validates and forwards path filters', async () => {
    workspace = await makeWorkspace({ 'src/a.ts': '' });
    const seen: Array<string | undefined> = [];
    const reader: DiagnosticsReader = {
      async get(path) {
        seen.push(path);
        return [record('src/a.ts', 'problem')];
      },
    };
    const tool = createDiagnosticsTool(reader);

    await expect(
      tool.execute({ path: 'src/a.ts' }, createContext(workspace.root)),
    ).resolves.toMatchObject({ ok: true, data: { count: 1 } });
    expect(seen).toEqual([`${workspace.root}/src/a.ts`]);
    await expect(
      tool.execute({ path: '.env' }, createContext(workspace.root)),
    ).resolves.toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    await expect(
      tool.execute({ path: '../outside.ts' }, createContext(workspace.root)),
    ).resolves.toMatchObject({ ok: false, error: { code: 'unsafe_path' } });
  });

  it('truncates oversized diagnostic lists', async () => {
    workspace = await makeWorkspace({});
    const diagnostics = Array.from({ length: 50 }, (_, index) =>
      record(`src/file-${index}.ts`, 'x'.repeat(10_000)),
    );
    const reader: DiagnosticsReader = { get: async () => diagnostics };

    const result = await createDiagnosticsTool(reader).execute({}, createContext(workspace.root));

    expect(result).toMatchObject({ ok: true, truncated: true });
    if (result.ok) expect(result.data.count).toBeLessThan(50);
  });
});

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileAuditLogger, MemoryAuditLogger } from '../../../src/security/audit';
import type { AuditEntry } from '../../../src/tools/types';
import { makeWorkspace, type TestWorkspace } from './helpers';

let workspace: TestWorkspace | undefined;

afterEach(async () => {
  await workspace?.cleanup();
  workspace = undefined;
});

const entry: AuditEntry = {
  at: '2026-01-01T00:00:00.000Z',
  sessionId: 'session',
  toolId: 'filesystem.read',
  argumentHash: 'a'.repeat(64),
  permission: 'read',
  decision: 'allow',
  status: 'ok',
  durationMs: 1,
  resultBytes: 2,
};

describe('audit loggers', () => {
  it('stores copies in memory', () => {
    const logger = new MemoryAuditLogger();
    logger.record(entry);
    logger.entries[0].toolId = 'mutated';

    expect(logger.entries[0].toolId).toBe('mutated');
    logger.clear();
    expect(logger.entries).toEqual([]);
  });

  it('appends JSON lines to a file without raw arguments', async () => {
    workspace = await makeWorkspace({});
    const file = join(workspace.root, 'logs', 'audit.jsonl');
    const logger = new FileAuditLogger(file);

    await logger.record(entry);
    await logger.record({ ...entry, toolId: 'filesystem.write' });

    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ toolId: 'filesystem.read' });
    expect(lines.join('\n')).not.toContain('content');
  });
});

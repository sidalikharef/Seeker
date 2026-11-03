import { describe, expect, it } from 'vitest';
import { MODE_POLICIES, modeAllowsPermission, toolsForMode } from '../../../src/core/modes';
import type { Tool } from '../../../src/tools/types';

function tool(name: string, permission: Tool['permission']): Tool {
  return {
    id: name,
    description: name,
    permission,
    timeoutMs: 100,
    maxResultBytes: 100,
    idempotent: true,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    execute: async () => ({ ok: true, data: {} }),
  };
}

describe('agent modes', () => {
  it('exposes the expected write and execute policy', () => {
    expect(MODE_POLICIES.ask.write).toBe(false);
    expect(MODE_POLICIES.plan.execute).toBe(false);
    expect(MODE_POLICIES.build.write).toBe(true);
    expect(MODE_POLICIES.debug.execute).toBe(true);
    expect(MODE_POLICIES.review.write).toBe(false);
  });

  it('filters tools by permission class', () => {
    const tools = [
      tool('fs.read', 'read'),
      tool('fs.write', 'write'),
      tool('terminal.execute', 'execute'),
      tool('git.destructive', 'destructive'),
    ];

    expect(toolsForMode('ask', tools).map((item) => item.id)).toEqual(['fs.read']);
    expect(toolsForMode('build', tools).map((item) => item.id)).toEqual([
      'fs.read',
      'fs.write',
      'terminal.execute',
    ]);
    expect(toolsForMode('review', tools).map((item) => item.id)).toEqual(['fs.read']);
  });

  it('does not allow privileged permissions in read-only modes', () => {
    expect(modeAllowsPermission('ask', 'write')).toBe(false);
    expect(modeAllowsPermission('plan', 'execute')).toBe(false);
    expect(modeAllowsPermission('review', 'destructive')).toBe(false);
    expect(modeAllowsPermission('build', 'execute')).toBe(true);
  });
});

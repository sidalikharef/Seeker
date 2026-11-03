import { describe, expect, it } from 'vitest';
import { SessionManager, type SessionStorage } from '../../../src/core/session-manager';

function storage(): SessionStorage & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    get<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },
    set<T>(key: string, value: T | undefined): void {
      if (value === undefined) {
        values.delete(key);
      } else {
        values.set(key, value);
      }
    },
  };
}

describe('session manager', () => {
  it('creates, persists, lists, and reloads sessions', () => {
    const store = storage();
    let now = 1_000;
    const manager = new SessionManager({
      storage: store,
      now: () => now,
      createId: () => 'session-1',
    });

    const session = manager.create({
      prompt: 'Fix the test',
      mode: 'build',
      workspaceRoots: ['/workspace'],
      policy: 'free-first',
    });
    expect(session.id).toBe('session-1');
    expect(manager.load('session-1')).toMatchObject({
      id: 'session-1',
      status: 'idle',
      mode: 'build',
    });
    expect(manager.list()).toHaveLength(1);

    now = 2_000;
    session.status = 'completed';
    manager.save(session);
    expect(manager.load('session-1')).toMatchObject({
      status: 'completed',
      updatedAt: new Date(2_000).toISOString(),
    });
  });

  it('appends and reloads the event log', () => {
    const manager = new SessionManager({
      storage: storage(),
      createId: () => 'session-1',
    });
    manager.create({
      prompt: 'task',
      mode: 'ask',
      workspaceRoots: ['/workspace'],
      policy: 'free-first',
    });

    manager.appendEvent('session-1', {
      type: 'agent.started',
      sessionId: 'session-1',
      at: '2026-11-02T00:00:00.000Z',
    });
    manager.appendEvent('session-1', {
      type: 'agent.cancelled',
      sessionId: 'session-1',
      at: '2026-11-02T00:00:01.000Z',
    });

    expect(manager.loadEvents('session-1').map((event) => event.type)).toEqual([
      'agent.started',
      'agent.cancelled',
    ]);
  });

  it('rejects malformed sessions and deletes stored data', () => {
    const store = storage();
    const manager = new SessionManager({ storage: store, createId: () => 'session-1' });
    manager.create({
      prompt: 'task',
      mode: 'ask',
      workspaceRoots: ['/workspace'],
      policy: 'free-first',
    });

    store.set('seeker.agent.session.v1.bad', { schemaVersion: 99 });
    expect(manager.load('bad')).toBeUndefined();

    manager.delete('session-1');
    expect(manager.load('session-1')).toBeUndefined();
    expect(manager.list()).toHaveLength(0);
  });
});

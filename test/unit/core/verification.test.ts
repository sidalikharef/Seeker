import { afterEach, describe, expect, it } from 'vitest';
import {
  createSession,
  type AcceptanceCriterion,
  type ActionRecord,
} from '../../../src/core/state';
import { DefaultVerificationEngine } from '../../../src/core/verification';
import type { ToolCall } from '../../../src/providers/types';
import { makeWorkspace, type TestWorkspace } from '../tools/helpers';

let workspace: TestWorkspace | undefined;

afterEach(async () => {
  await workspace?.cleanup();
  workspace = undefined;
});

function criterion(
  id: string,
  kind: AcceptanceCriterion['kind'],
  params: Record<string, unknown>,
  required = true,
): AcceptanceCriterion {
  return { id, description: id, kind, params, required };
}

function action(call: ToolCall, data: unknown, ok = true): ActionRecord {
  return {
    id: `${call.id}-action`,
    at: '2026-11-02T00:00:00.000Z',
    call,
    observation: {
      toolId: call.name,
      callId: call.id,
      ok,
      ...(ok
        ? { data }
        : { error: { code: 'command_failed', message: 'failed', retryable: false } }),
    },
  };
}

describe('verification engine', () => {
  it('verifies files and commands from evidence', async () => {
    workspace = await makeWorkspace({ 'src/answer.txt': 'hello world' });
    const session = createSession({
      id: 'verify',
      prompt: 'verify',
      mode: 'build',
      workspaceRoots: [workspace.root],
      policy: 'free-first',
    });
    session.actions.push(
      action(
        { id: 'call-1', name: 'terminal.execute', argumentsJson: '{}' },
        { exitCode: 0, stdout: 'ok' },
      ),
    );

    const result = await new DefaultVerificationEngine().evaluate(
      [
        criterion('exists', 'file-exists', { path: 'src/answer.txt' }),
        criterion('content', 'file-contains', { path: 'src/answer.txt', text: 'world' }),
        criterion('command', 'command-exit-zero', {}),
      ],
      { session, workspaceRoots: [workspace.root] },
    );

    expect(result.satisfied).toBe(true);
    expect(result.criteria.every((item) => item.passed)).toBe(true);
  });

  it('does not mark empty criteria as verified', async () => {
    const session = createSession({
      id: 'verify-empty',
      prompt: 'verify',
      mode: 'build',
      workspaceRoots: ['/tmp'],
      policy: 'free-first',
    });

    const result = await new DefaultVerificationEngine().evaluate([], {
      session,
      workspaceRoots: ['/tmp'],
    });

    expect(result.satisfied).toBe(false);
  });

  it('reports failed and optional criteria explicitly', async () => {
    workspace = await makeWorkspace({ 'a.txt': 'abc' });
    const session = createSession({
      id: 'verify-fail',
      prompt: 'verify',
      mode: 'build',
      workspaceRoots: [workspace.root],
      policy: 'free-first',
    });

    const result = await new DefaultVerificationEngine().evaluate(
      [
        criterion('missing', 'file-exists', { path: 'missing.txt' }),
        criterion('optional', 'manual', {}, false),
      ],
      { session, workspaceRoots: [workspace.root] },
    );

    expect(result.satisfied).toBe(false);
    expect(result.criteria.find((item) => item.id === 'missing')?.passed).toBe(false);
    expect(result.unverified).toEqual(['optional']);
  });

  it('checks diagnostics and manual evidence', async () => {
    const session = createSession({
      id: 'verify-diag',
      prompt: 'verify',
      mode: 'build',
      workspaceRoots: ['/tmp'],
      policy: 'free-first',
    });
    session.actions.push(
      action({ id: 'call-2', name: 'diagnostics.get', argumentsJson: '{}' }, { diagnostics: [] }),
    );

    const result = await new DefaultVerificationEngine().evaluate(
      [
        criterion('diagnostics', 'diagnostics-empty', {}),
        criterion('manual', 'manual', { confirmed: true }),
      ],
      { session, workspaceRoots: ['/tmp'] },
    );

    expect(result.satisfied).toBe(true);
  });
});

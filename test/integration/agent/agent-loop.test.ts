import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentLoop,
  type AgentModelClient,
  type AgentModelResult,
  type AgentToolExecutionResult,
  type AgentToolExecutor,
} from '../../../src/core/agent-loop';
import { MemoryAgentEventSink } from '../../../src/core/events';
import {
  createSession,
  type AcceptanceCriterion,
  type AgentSession,
} from '../../../src/core/state';
import { DefaultVerificationEngine } from '../../../src/core/verification';
import type { NormalizedMessage, ToolCall } from '../../../src/providers/types';
import type { ToolError } from '../../../src/tools/types';
import { makeWorkspace, type TestWorkspace } from '../../unit/tools/helpers';

let workspace: TestWorkspace | undefined;

afterEach(async () => {
  await workspace?.cleanup();
  workspace = undefined;
});

function toolCall(id: string, name: string, input: unknown): ToolCall {
  return { id, name, argumentsJson: JSON.stringify(input) };
}

function sequenceModel(turns: AgentModelResult[]): AgentModelClient & {
  calls: NormalizedMessage[][];
} {
  const calls: NormalizedMessage[][] = [];
  return {
    calls,
    async run(messages) {
      calls.push(messages);
      return (
        turns.shift() ?? {
          text: 'Done.',
          toolCalls: [],
          finishReason: 'stop',
        }
      );
    },
  };
}

function testExecutor(options: {
  write?: (path: string, content: string) => Promise<void>;
  command?: () => Promise<void>;
  denied?: boolean;
}): AgentToolExecutor & { writes: number; commands: number } {
  const executor = {
    writes: 0,
    commands: 0,
    listTools() {
      return [
        {
          name: 'fs.write_file',
          description: 'Write a file',
          parameters: { type: 'object' },
          idempotent: false,
        },
        {
          name: 'terminal.execute',
          description: 'Run a command',
          parameters: { type: 'object' },
          idempotent: false,
        },
      ];
    },
    async execute(call: ToolCall, input: unknown): Promise<AgentToolExecutionResult> {
      if (call.name === 'fs.write_file') {
        executor.writes += 1;
        if (options.denied) {
          return {
            ok: false,
            error: {
              code: 'permission_denied',
              message: 'User denied the write.',
              retryable: false,
            } satisfies ToolError,
          };
        }
        const record = input as { path: string; content: string };
        await options.write?.(record.path, record.content);
        return { ok: true, data: { path: record.path, bytes: record.content.length } };
      }
      if (call.name === 'terminal.execute') {
        executor.commands += 1;
        await options.command?.();
        return { ok: true, data: { exitCode: 0, stdout: 'ok' } };
      }
      return {
        ok: false,
        error: {
          code: 'invalid_arguments',
          message: 'unknown tool',
          retryable: false,
        } satisfies ToolError,
      };
    },
  };
  return executor;
}

function session(
  root: string,
  criteria: AcceptanceCriterion[],
  budget: Partial<AgentSession['budget']> = {},
): AgentSession {
  return createSession({
    id: 'agent-session',
    prompt: 'Create answer.txt and validate it.',
    mode: 'build',
    workspaceRoots: [root],
    policy: 'free-first',
    acceptanceCriteria: criteria,
    budget,
  });
}

describe('agent loop with mock model and tools', () => {
  it('completes a write and command task with verification evidence', async () => {
    workspace = await makeWorkspace({});
    const root = workspace.root;
    const model = sequenceModel([
      {
        text: '',
        toolCalls: [
          toolCall('call-write', 'fs.write_file', { path: 'answer.txt', content: 'hello' }),
        ],
        finishReason: 'tool_calls',
      },
      {
        text: '',
        toolCalls: [toolCall('call-run', 'terminal.execute', { file: 'node', args: ['-e', '0'] })],
        finishReason: 'tool_calls',
      },
      { text: 'Task complete.', toolCalls: [], finishReason: 'stop' },
    ]);
    const executor = testExecutor({
      write: async (path, content) => {
        await mkdir(join(root, 'src'), { recursive: true });
        await writeFile(join(root, 'src', path), content);
      },
    });
    const events = new MemoryAgentEventSink();
    const state = session(root, [
      {
        id: 'file',
        description: 'answer exists',
        kind: 'file-exists',
        params: { path: 'src/answer.txt' },
        required: true,
      },
      {
        id: 'content',
        description: 'answer is correct',
        kind: 'file-contains',
        params: { path: 'src/answer.txt', text: 'hello' },
        required: true,
      },
      {
        id: 'command',
        description: 'command passed',
        kind: 'command-exit-zero',
        params: {},
        required: true,
      },
    ]);

    const completed = await new AgentLoop({
      session: state,
      model,
      tools: executor,
      verification: new DefaultVerificationEngine(),
      events,
      signal: new AbortController().signal,
    }).run();

    expect(completed.status).toBe('completed');
    expect(completed.verification?.satisfied).toBe(true);
    expect(completed.actions).toHaveLength(2);
    expect(executor.writes).toBe(1);
    expect(executor.commands).toBe(1);
    expect(model.calls[1]?.at(-1)).toMatchObject({ role: 'tool' });
    expect(events.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'agent.started',
        'tool.requested',
        'tool.started',
        'tool.completed',
        'verification.completed',
        'agent.completed',
      ]),
    );
  });

  it('returns permission denial to the model and continues safely', async () => {
    workspace = await makeWorkspace({});
    const model = sequenceModel([
      {
        text: '',
        toolCalls: [
          toolCall('call-write', 'fs.write_file', { path: 'answer.txt', content: 'hello' }),
        ],
        finishReason: 'tool_calls',
      },
      {
        text: 'I could not write because permission was denied.',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);
    const executor = testExecutor({ denied: true });
    const events = new MemoryAgentEventSink();

    const completed = await new AgentLoop({
      session: session(workspace.root, []),
      model,
      tools: executor,
      verification: new DefaultVerificationEngine(),
      events,
      signal: new AbortController().signal,
    }).run();

    expect(completed.status).toBe('completed_unverified');
    expect(completed.actions[0]?.observation.error?.code).toBe('permission_denied');
    expect(JSON.stringify(model.calls[1])).toContain('permission_denied');
  });

  it('never executes malformed tool arguments', async () => {
    workspace = await makeWorkspace({});
    const model = sequenceModel([
      {
        text: '',
        toolCalls: [{ id: 'bad', name: 'fs.write_file', argumentsJson: '{"path":' }],
        finishReason: 'tool_calls',
      },
      { text: 'The call was malformed.', toolCalls: [], finishReason: 'stop' },
    ]);
    const execute = vi.fn();
    const executor: AgentToolExecutor = {
      listTools: () => [
        {
          name: 'fs.write_file',
          parameters: { type: 'object' },
          idempotent: false,
        },
      ],
      execute,
    };

    const completed = await new AgentLoop({
      session: session(workspace.root, []),
      model,
      tools: executor,
      verification: new DefaultVerificationEngine(),
      events: new MemoryAgentEventSink(),
      signal: new AbortController().signal,
    }).run();

    expect(completed.status).toBe('completed_unverified');
    expect(completed.actions[0]?.observation.error?.code).toBe('invalid_arguments');
    expect(execute).not.toHaveBeenCalled();
  });

  it('pauses on quota exhaustion without replaying actions', async () => {
    workspace = await makeWorkspace({});
    const model = sequenceModel([
      {
        text: '',
        toolCalls: [],
        finishReason: 'unknown',
        error: {
          provider: 'groq',
          kind: 'quota_exhausted',
          message: 'Daily quota exhausted.',
          retryable: false,
        },
      },
    ]);

    const completed = await new AgentLoop({
      session: session(workspace.root, []),
      model,
      tools: testExecutor({}),
      verification: new DefaultVerificationEngine(),
      events: new MemoryAgentEventSink(),
      signal: new AbortController().signal,
    }).run();

    expect(completed.status).toBe('paused_quota');
    expect(completed.actions).toHaveLength(0);
    expect(completed.error?.code).toBe('quota_exhausted');
  });

  it('cancels an in-flight model request', async () => {
    workspace = await makeWorkspace({});
    const controller = new AbortController();
    const model: AgentModelClient = {
      run(_messages, _tools, signal) {
        return new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () =>
              resolve({
                text: '',
                toolCalls: [],
                finishReason: 'cancelled',
                error: {
                  provider: 'groq',
                  kind: 'cancelled',
                  message: 'Cancelled.',
                  retryable: false,
                },
              }),
            { once: true },
          );
        });
      },
    };

    const pending = new AgentLoop({
      session: session(workspace.root, []),
      model,
      tools: testExecutor({}),
      verification: new DefaultVerificationEngine(),
      events: new MemoryAgentEventSink(),
      signal: controller.signal,
    }).run();
    setTimeout(() => controller.abort(), 5);

    await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('suppresses repeated identical side-effecting calls', async () => {
    workspace = await makeWorkspace({});
    const call = toolCall('call-write', 'fs.write_file', {
      path: 'answer.txt',
      content: 'hello',
    });
    const model = sequenceModel([
      { text: '', toolCalls: [call], finishReason: 'tool_calls' },
      { text: '', toolCalls: [{ ...call, id: 'call-write-2' }], finishReason: 'tool_calls' },
      { text: '', toolCalls: [{ ...call, id: 'call-write-3' }], finishReason: 'tool_calls' },
      { text: 'Done.', toolCalls: [], finishReason: 'stop' },
    ]);
    const executor = testExecutor({
      write: async (path, content) => {
        await writeFile(join(workspace!.root, path), content);
      },
    });

    const completed = await new AgentLoop({
      session: session(workspace.root, [], { maxConsecutiveDuplicateCalls: 1 }),
      model,
      tools: executor,
      verification: new DefaultVerificationEngine(),
      events: new MemoryAgentEventSink(),
      signal: new AbortController().signal,
    }).run();

    expect(executor.writes).toBe(2);
    expect(completed.actions).toHaveLength(3);
    expect(completed.actions.at(-1)?.observation.cached).toBe(true);
  });

  it('fails safely when the iteration budget is exhausted', async () => {
    workspace = await makeWorkspace({});
    const model = sequenceModel([
      { text: 'Not done.', toolCalls: [], finishReason: 'stop' },
      { text: 'Still not done.', toolCalls: [], finishReason: 'stop' },
      { text: 'Never reached.', toolCalls: [], finishReason: 'stop' },
    ]);
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'manual',
        description: 'Confirm manually',
        kind: 'manual',
        params: {},
        required: true,
      },
    ];

    const completed = await new AgentLoop({
      session: session(workspace.root, criteria, { maxIterations: 2 }),
      model,
      tools: testExecutor({}),
      verification: new DefaultVerificationEngine(),
      events: new MemoryAgentEventSink(),
      signal: new AbortController().signal,
    }).run();

    expect(completed.status).toBe('failed');
    expect(completed.error?.code).toBe('iteration_budget');
    expect(model.calls).toHaveLength(2);
  });
});

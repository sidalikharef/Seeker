import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentLoop,
  type AgentModelClient,
  type AgentModelResult,
  type AgentToolDescriptor,
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
import type { ToolCall } from '../../../src/providers/types';
import { MemoryAuditLogger } from '../../../src/security/audit';
import { ToolDispatcher } from '../../../src/tools/dispatcher';
import { filesystemTools } from '../../../src/tools/filesystem';
import { ToolRegistry } from '../../../src/tools/registry';
import { createTerminalExecuteTool, nodeTerminalRunner } from '../../../src/tools/terminal';
import type {
  PermissionDecision,
  PermissionManager,
  PermissionRequest,
  ToolContext,
} from '../../../src/tools/types';
import { makeWorkspace, type TestWorkspace } from '../../unit/tools/helpers';

const BROKEN_SOURCE = [
  'export function add(a: number, b: number): number {',
  '  return `${a + b}`;',
  '}',
  '',
].join('\n');

const FIXED_SOURCE = BROKEN_SOURCE.replace('return `${a + b}`;', 'return a + b;');
const TSC = join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');
const PATCH = `--- a/src/math.ts
+++ b/src/math.ts
@@ -2 +2 @@
-  return \`\${a + b}\`;
+  return a + b;
`;

class RecordingPermissions implements PermissionManager {
  readonly requests: PermissionRequest[] = [];

  constructor(
    private readonly decision:
      PermissionDecision | ((request: PermissionRequest) => PermissionDecision) = 'allow',
  ) {}

  async authorize(request: PermissionRequest): Promise<PermissionDecision> {
    this.requests.push(request);
    return typeof this.decision === 'function' ? this.decision(request) : this.decision;
  }
}

class DispatcherTools implements AgentToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly dispatcher: ToolDispatcher,
    private readonly permissions: PermissionManager,
    private readonly logger: MemoryAuditLogger,
    private readonly mode: 'build' | 'debug' = 'build',
  ) {}

  listTools(): AgentToolDescriptor[] {
    return this.registry.listForMode(this.mode).map((tool) => ({
      name: tool.id,
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>,
      idempotent: tool.idempotent,
    }));
  }

  async execute(
    call: ToolCall,
    input: unknown,
    options: { session: AgentSession; signal: AbortSignal },
  ): Promise<AgentToolExecutionResult> {
    const ctx: ToolContext = {
      sessionId: options.session.id,
      workspaceRoots: options.session.task.workspaceRoots,
      signal: options.signal,
      logger: this.logger,
      permissions: this.permissions,
      mode: this.mode,
      preview: { preview: async () => true },
    };
    const result = await this.dispatcher.execute(call.name, input, ctx);
    return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
  }
}

interface Fixture {
  registry: ToolRegistry;
  permissions: RecordingPermissions;
  logger: MemoryAuditLogger;
  session: AgentSession;
  events: MemoryAgentEventSink;
  tools: DispatcherTools;
}

function fixture(
  workspaceRoot: string,
  options: {
    decision?: PermissionDecision | ((request: PermissionRequest) => PermissionDecision);
    terminal?: boolean;
  } = {},
): Fixture {
  const registry = new ToolRegistry();
  for (const tool of filesystemTools) {
    registry.register(tool);
  }
  if (options.terminal ?? true) {
    registry.register(createTerminalExecuteTool(nodeTerminalRunner));
  }
  const permissions = new RecordingPermissions(options.decision);
  const logger = new MemoryAuditLogger();
  const tools = new DispatcherTools(registry, new ToolDispatcher(registry), permissions, logger);
  const session = createSession({
    id: 'phase07-e2e',
    prompt: 'Fix the TypeScript error in src/math.ts and verify it.',
    mode: 'build',
    workspaceRoots: [workspaceRoot],
    policy: 'free-first',
    allowPaid: false,
    maxCostUsd: 0,
  });
  return { registry, permissions, logger, session, events: new MemoryAgentEventSink(), tools };
}

function loopFor(
  state: Fixture,
  model: AgentModelClient,
  criteria: AcceptanceCriterion[] = [],
): AgentLoop {
  state.session.task.acceptanceCriteria = criteria;
  return new AgentLoop({
    session: state.session,
    model,
    tools: state.tools,
    verification: new DefaultVerificationEngine(),
    events: state.events,
    signal: new AbortController().signal,
  });
}

function readResult(messages: { role: string; content: string }[]): {
  content: string;
  sha256: string;
} {
  const tool = [...messages].reverse().find((message) => message.role === 'tool');
  if (!tool) {
    throw new Error('Expected a tool result before requesting a patch.');
  }
  return JSON.parse(tool.content) as { content: string; sha256: string };
}

function successfulModel(tsc: string): AgentModelClient {
  let calls = 0;
  return {
    async run(messages): Promise<AgentModelResult> {
      calls += 1;
      if (calls === 1) {
        return {
          text: 'Reading the failing file.',
          toolCalls: [
            {
              id: 'call-read',
              name: 'filesystem.read',
              argumentsJson: JSON.stringify({ path: 'src/math.ts' }),
            },
          ],
          finishReason: 'tool_calls',
        };
      }
      if (calls === 2) {
        const file = readResult(messages);
        return {
          text: 'Applying the type fix.',
          toolCalls: [
            {
              id: 'call-patch',
              name: 'filesystem.apply_patch',
              argumentsJson: JSON.stringify({
                path: 'src/math.ts',
                expectedSha256: file.sha256,
                patch: PATCH,
              }),
            },
          ],
          finishReason: 'tool_calls',
        };
      }
      if (calls === 3) {
        return {
          text: 'Running the real TypeScript check.',
          toolCalls: [
            {
              id: 'call-tsc',
              name: 'terminal.execute',
              argumentsJson: JSON.stringify({
                file: process.execPath,
                args: [tsc, '--noEmit', '-p', 'tsconfig.json'],
                cwd: '.',
              }),
            },
          ],
          finishReason: 'tool_calls',
        };
      }
      return {
        text: 'Fixed src/math.ts. The project type-check passes.',
        toolCalls: [],
        finishReason: 'stop',
      };
    },
  };
}

function deniedPatchModel(): AgentModelClient {
  let calls = 0;
  return {
    async run(messages) {
      calls += 1;
      if (calls === 1) {
        return {
          text: '',
          toolCalls: [
            {
              id: 'call-read',
              name: 'filesystem.read',
              argumentsJson: JSON.stringify({ path: 'src/math.ts' }),
            },
          ],
          finishReason: 'tool_calls',
        };
      }
      if (calls === 2) {
        const file = readResult(messages);
        return {
          text: '',
          toolCalls: [
            {
              id: 'call-patch',
              name: 'filesystem.apply_patch',
              argumentsJson: JSON.stringify({
                path: 'src/math.ts',
                expectedSha256: file.sha256,
                patch: PATCH,
              }),
            },
          ],
          finishReason: 'tool_calls',
        };
      }
      return { text: 'I could not apply the change.', toolCalls: [], finishReason: 'stop' };
    },
  };
}

function deniedCommandModel(tsc: string): AgentModelClient {
  let calls = 0;
  return {
    async run() {
      calls += 1;
      if (calls === 1) {
        return {
          text: '',
          toolCalls: [
            {
              id: 'call-tsc',
              name: 'terminal.execute',
              argumentsJson: JSON.stringify({
                file: process.execPath,
                args: [tsc, '--noEmit', '-p', 'tsconfig.json'],
              }),
            },
          ],
          finishReason: 'tool_calls',
        };
      }
      return { text: 'The command was denied.', toolCalls: [], finishReason: 'stop' };
    },
  };
}

let workspace: TestWorkspace | undefined;

afterEach(async () => {
  await workspace?.cleanup();
  workspace = undefined;
});

describe('phase 07 end-to-end workflow', () => {
  it('reads, patches, type-checks, and verifies a broken TypeScript fixture', async () => {
    workspace = await makeWorkspace({
      'src/math.ts': BROKEN_SOURCE,
      'tsconfig.json': JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            target: 'ES2022',
            module: 'ESNext',
          },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    });
    const state = fixture(workspace.root);
    const loop = loopFor(state, successfulModel(TSC), [
      {
        id: 'fix-return',
        kind: 'file-contains',
        description: 'The function returns a number.',
        params: { path: 'src/math.ts', text: 'return a + b;' },
        required: true,
      },
    ]);

    const result = await loop.run();

    expect(result.status).toBe('completed');
    expect(result.verification?.satisfied).toBe(true);
    await expect(readFile(join(workspace.root, 'src/math.ts'), 'utf8')).resolves.toBe(FIXED_SOURCE);

    const patch = result.actions.find((action) => action.call.name === 'filesystem.apply_patch');
    expect(patch?.observation.ok).toBe(true);
    const command = result.actions.find((action) => action.call.name === 'terminal.execute');
    expect(command?.observation.ok).toBe(true);
    expect(command?.observation.data).toMatchObject({ exitCode: 0, stderr: '' });
    expect(state.permissions.requests.map((request) => request.permission)).toEqual([
      'read',
      'write',
      'execute',
    ]);
    expect(state.permissions.requests[2]?.command).toMatchObject({
      workspace: workspace.root,
      cwd: workspace.root,
      file: process.execPath,
    });
    expect(state.logger.entries.map((entry) => [entry.toolId, entry.status])).toEqual([
      ['filesystem.read', 'ok'],
      ['filesystem.apply_patch', 'ok'],
      ['terminal.execute', 'ok'],
    ]);
    expect(state.events.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'agent.completed', verified: true }),
      ]),
    );
  }, 20_000);

  it('never mutates the file when the patch is denied', async () => {
    workspace = await makeWorkspace({ 'src/math.ts': BROKEN_SOURCE });
    const state = fixture(workspace.root, {
      decision: (request) => (request.permission === 'read' ? 'allow' : 'deny'),
      terminal: false,
    });
    const loop = loopFor(state, deniedPatchModel());

    const result = await loop.run();

    expect(result.status).toBe('completed_unverified');
    expect(
      result.actions.find((action) => action.call.name === 'filesystem.apply_patch'),
    ).toMatchObject({
      observation: { ok: false, error: { code: 'permission_denied' } },
    });
    await expect(readFile(join(workspace.root, 'src/math.ts'), 'utf8')).resolves.toBe(
      BROKEN_SOURCE,
    );
  });

  it('never runs a denied command and reports the refusal to the model', async () => {
    workspace = await makeWorkspace({ 'src/math.ts': BROKEN_SOURCE });
    const state = fixture(workspace.root, {
      decision: (request) => (request.permission === 'read' ? 'allow' : 'deny'),
    });
    const loop = loopFor(state, deniedCommandModel(TSC));

    const result = await loop.run();

    expect(result.status).toBe('completed_unverified');
    expect(result.actions.find((action) => action.call.name === 'terminal.execute')).toMatchObject({
      observation: { ok: false, error: { code: 'permission_denied' } },
    });
    expect(state.permissions.requests.map((request) => request.permission)).toEqual(['execute']);
  });
});

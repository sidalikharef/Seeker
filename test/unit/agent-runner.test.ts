import { describe, expect, it, vi } from 'vitest';
import { AgentRunner } from '../../src/extension/agent-runner';
import type { WorkspaceToolHost } from '../../src/extension/workspace-host';
import type {
  ChatRequest,
  ModelEvent,
  ProviderAdapter,
  ToolSchema,
} from '../../src/providers/types';
import { QuotaLedger } from '../../src/router/quota';
import type { ModelRouter } from '../../src/router/router';

function settings() {
  return {
    policy: 'free-first' as const,
    allowPaid: false,
    maxCostUsd: 0,
    excludedProviders: [],
  };
}

function fakeAdapter(stream: (request: ChatRequest) => AsyncIterable<ModelEvent>): ProviderAdapter {
  return {
    id: 'groq',
    baseUrl: 'https://example.test',
    freeTierClass: 'free-tier',
    listModels: async () => [],
    streamChat: stream,
    healthCheck: async () => ({
      provider: 'groq',
      state: 'healthy',
      checkedAt: '2026-11-02T00:00:00.000Z',
    }),
  };
}

function tool(id: string) {
  return {
    id,
    description: `${id} description`,
    inputSchema: { type: 'object' },
    idempotent: false,
  };
}

function fakeHost(ids: string[], execute = vi.fn()) {
  const tools = ids.map(tool);
  return {
    host: {
      workspaceRoots: ['/workspace'],
      registry: {
        listForMode: () => tools,
      },
      execute,
    } as unknown as WorkspaceToolHost,
    execute,
  };
}

function runner(adapter: ProviderAdapter, host: WorkspaceToolHost): AgentRunner {
  return new AgentRunner({
    adapters: { groq: adapter },
    router: { select: () => ({ rejected: [] }) } as unknown as ModelRouter,
    quota: new QuotaLedger(),
    getRoutingSettings: settings,
    tools: host,
    createId: () => 'session-1',
  });
}

const selection = { provider: 'groq' as const, modelId: 'model', reason: 'test' };

describe('agent runner', () => {
  it('maps tool names to provider-safe names and back before execution', async () => {
    let call = 0;
    const requests: ChatRequest[] = [];
    const adapter = fakeAdapter(async function* (request) {
      requests.push(request);
      call += 1;
      if (call === 1) {
        yield {
          type: 'tool-call-delta',
          index: 0,
          id: 'call-1',
          name: 'fs_read',
          argumentsDelta: '{"path":',
        };
        yield { type: 'tool-call-delta', index: 0, argumentsDelta: '"README.md"}' };
        yield { type: 'finish', reason: 'tool_calls' };
        return;
      }
      yield { type: 'text-delta', text: 'Done.' };
      yield { type: 'finish', reason: 'stop' };
    });
    const execute = vi.fn(async () => ({ ok: true, data: { content: 'hello' } }));
    const { host } = fakeHost(['fs.read'], execute);
    const result = await runner(adapter, host).run({
      requestId: 'req-1',
      prompt: 'Read the readme',
      mode: 'build',
      selection,
      availableProviders: ['groq'],
      signal: new AbortController().signal,
    });

    expect((requests[0]?.tools as ToolSchema[]).map((item) => item.name)).toEqual(['fs_read']);
    expect(execute).toHaveBeenCalledWith('fs.read', { path: 'README.md' }, expect.anything());
    expect(result.session.actions[0]).toMatchObject({
      call: { name: 'fs.read', argumentsJson: '{"path":"README.md"}' },
      observation: { ok: true },
    });
    expect(result.content).toContain('Done.');
    expect(result.session.status).toBe('completed_unverified');
  });

  it('rejects tool-name collisions after provider-safe normalization', async () => {
    const adapter = fakeAdapter(async function* () {
      yield { type: 'finish', reason: 'stop' };
    });
    const { host } = fakeHost(['a.b', 'a_b']);

    await expect(
      runner(adapter, host).run({
        requestId: 'req-1',
        prompt: 'Do work',
        mode: 'build',
        selection,
        availableProviders: ['groq'],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/collide/);
  });
});

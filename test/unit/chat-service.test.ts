import { describe, expect, it, vi } from 'vitest';
import { ChatService, type ChatStorage } from '../../src/extension/chat-service';
import { ModelCatalog } from '../../src/providers/model-catalog';
import { cancelledError, ProviderRequestError } from '../../src/providers/errors';
import type {
  ChatRequest,
  CredentialProvider,
  ModelEvent,
  ProviderAdapter,
  ProviderId,
} from '../../src/providers/types';
import type { HostToWebview } from '../../src/extension/webview/protocol';
import { QuotaLedger } from '../../src/router/quota';
import { ModelRegistry } from '../../src/router/registry';
import { ModelRouter } from '../../src/router/router';
import type { RoutingSettings } from '../../src/router/debug';
import type { WorkspaceToolHost } from '../../src/extension/workspace-host';
import type { ToolError } from '../../src/tools/types';
import { registryEntry } from './router/fixtures';

function memoryCredentials(keys: Partial<Record<ProviderId, string>> = {}): CredentialProvider {
  const values = new Map<ProviderId, string>(Object.entries(keys) as [ProviderId, string][]);
  return {
    get: async (provider) => values.get(provider),
    set: async (provider, key) => {
      values.set(provider, key);
    },
    delete: async (provider) => {
      values.delete(provider);
    },
    has: async (provider) => values.has(provider),
  };
}

function memoryStorage(): ChatStorage & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    get<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },
    set<T>(key: string, value: T | undefined): void {
      values.set(key, value);
    },
  };
}

function settings(overrides: Partial<RoutingSettings> = {}): RoutingSettings {
  return {
    policy: 'free-first',
    allowPaid: false,
    maxCostUsd: 0,
    excludedProviders: [],
    ...overrides,
  };
}

function fakeAdapter(
  stream: (request: ChatRequest, signal: AbortSignal) => AsyncIterable<ModelEvent>,
  overrides: Partial<ProviderAdapter> = {},
): ProviderAdapter {
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
    ...overrides,
  };
}

async function* textStream(text = 'Hello world'): AsyncIterable<ModelEvent> {
  yield { type: 'text-delta', text: text.slice(0, 6) };
  yield { type: 'text-delta', text: text.slice(6) };
  yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 3 } };
  yield { type: 'finish', reason: 'stop' };
}

function fakeToolHost(options: {
  execute: (
    toolId: string,
    input: unknown,
  ) => Promise<{ ok: true; data?: unknown } | { ok: false; error: ToolError }>;
}): WorkspaceToolHost {
  return {
    workspaceRoots: ['/workspace'],
    registry: {
      listForMode: () => [
        {
          id: 'fs.write_file',
          description: 'Write a file',
          inputSchema: { type: 'object' },
          idempotent: false,
        },
      ],
    },
    execute: async (toolId: string, input: unknown) => options.execute(toolId, input),
  } as unknown as WorkspaceToolHost;
}

function harness(
  options: {
    adapters?: Partial<Record<ProviderId, ProviderAdapter>>;
    credentials?: CredentialProvider;
    storage?: ReturnType<typeof memoryStorage>;
    entries?: ReturnType<typeof registryEntry>[];
    settings?: RoutingSettings;
    tools?: WorkspaceToolHost;
    now?: () => number;
  } = {},
) {
  const events: HostToWebview[] = [];
  const adapters = options.adapters ?? { groq: fakeAdapter(() => textStream()) };
  const registry = new ModelRegistry(options.entries ?? [registryEntry('chat-model')]);
  const quota = new QuotaLedger({ now: options.now ?? (() => Date.UTC(2026, 10, 2, 12)) });
  const router = new ModelRouter({ registry, quota });
  const catalog = new ModelCatalog(adapters);
  const storage = options.storage ?? memoryStorage();
  let id = 0;
  const service = new ChatService({
    adapters,
    catalog,
    registry,
    router,
    quota,
    credentials: options.credentials ?? memoryCredentials({ groq: 'key' }),
    getRoutingSettings: () => options.settings ?? settings(),
    storage,
    tools: options.tools,
    now: options.now,
    createId: () => `id-${++id}`,
  });
  service.subscribe((event) => events.push(event));
  return { service, events, storage, registry, quota, adapters };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for chat service event.');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('chat service', () => {
  it('streams a real assistant response through the router', async () => {
    const { service, events } = harness();

    await service.send({ requestId: 'req-1', message: 'Explain this code' });
    const state = await service.getPublicState();

    expect(state.session.status).toBe('idle');
    expect(state.session.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'Explain this code', status: 'complete' }),
      expect.objectContaining({
        role: 'assistant',
        content: 'Hello world',
        provider: 'groq',
        modelId: 'chat-model',
        status: 'complete',
      }),
    ]);
    expect(state.lastDecision).toMatchObject({
      provider: 'groq',
      modelId: 'chat-model',
      automatic: true,
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'assistant.start', requestId: 'req-1' }),
        { type: 'assistant.delta', requestId: 'req-1', messageId: 'id-2', text: 'Hello ' },
        expect.objectContaining({
          type: 'assistant.end',
          requestId: 'req-1',
          status: 'complete',
          content: 'Hello world',
        }),
      ]),
    );
  });

  it('honors an explicit model selection regardless of the automatic policy', async () => {
    const seen: string[] = [];
    const { service } = harness({
      adapters: {
        groq: fakeAdapter((request) => {
          seen.push(request.model);
          return textStream('Selected');
        }),
      },
      entries: [registryEntry('chat-model'), registryEntry('other-model')],
    });

    expect(service.selectModel('groq', 'other-model')).toBe(true);
    await service.send({ requestId: 'req-1', message: 'Use this model' });
    const state = await service.getPublicState();

    expect(seen).toEqual(['other-model']);
    expect(state.selected).toEqual({ provider: 'groq', modelId: 'other-model' });
    expect(state.lastDecision).toMatchObject({ modelId: 'other-model', automatic: false });
  });

  it('requires a configured provider and exposes a settings action', async () => {
    const { service, events } = harness({ credentials: memoryCredentials() });

    await service.send({ requestId: 'req-1', message: 'Hello' });

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          requestId: 'req-1',
          actions: ['settings'],
          message: expect.stringContaining('No provider is configured'),
        }),
      ]),
    );
    expect((await service.getPublicState()).session.messages).toHaveLength(0);
  });

  it('normalizes authentication failures and marks the provider unavailable', async () => {
    const { service, events, quota } = harness({
      adapters: {
        groq: fakeAdapter(async function* () {
          yield { type: 'text-delta', text: '' };
          throw new ProviderRequestError({
            provider: 'groq',
            model: 'chat-model',
            kind: 'auth',
            message: 'Invalid API key',
            retryable: false,
          });
        }),
      },
    });

    await service.send({ requestId: 'req-1', message: 'Hello' });
    const state = await service.getPublicState();

    expect(state.session.messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'error',
      error: 'Invalid API key',
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          actions: ['settings', 'retry'],
        }),
      ]),
    );
    expect(quota.canUse('groq')).toMatchObject({ allowed: false });
  });

  it('records rate limits and can retry with a fresh provider route', async () => {
    let calls = 0;
    const { service, events, quota } = harness({
      entries: [registryEntry('chat-model'), registryEntry('backup-model')],
      settings: settings({ preferredModel: 'chat-model' }),
      adapters: {
        groq: fakeAdapter((request) => {
          calls += 1;
          if (request.model === 'chat-model') {
            return (async function* () {
              yield {
                type: 'rate-limit',
                metadata: {
                  source: 'headers',
                  requests: {
                    limit: 20,
                    remaining: 0,
                    resetAt: '2026-11-02T12:01:00.000Z',
                  },
                  retryAfterMs: 60_000,
                  capturedAt: '2026-11-02T12:00:00.000Z',
                },
              } satisfies ModelEvent;
              throw new ProviderRequestError({
                provider: 'groq',
                model: 'chat-model',
                kind: 'rate_limit',
                retryAfterMs: 60_000,
                message: 'Rate limited',
                retryable: true,
              });
            })();
          }
          return textStream('Backup response');
        }),
      },
    });

    await service.send({ requestId: 'req-1', message: 'Hello' });
    expect(quota.canUse('groq', 'chat-model').allowed).toBe(false);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'error', actions: ['retry', 'refreshModels'] }),
      ]),
    );

    await service.retry('req-2');
    const state = await service.getPublicState();

    expect(calls).toBe(2);
    expect(state.session.messages.at(-1)).toMatchObject({
      modelId: 'backup-model',
      status: 'complete',
      content: 'Backup response',
    });
    expect(state.session.messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(state.session.messages[0]).toMatchObject({ role: 'user', content: 'Hello' });
  });

  it('cancels an active stream without persisting a fake complete response', async () => {
    let aborted = false;
    const { service, events } = harness({
      adapters: {
        groq: fakeAdapter(async function* (_request, signal) {
          yield { type: 'text-delta', text: 'Partial ' };
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              aborted = true;
              resolve();
              return;
            }
            signal.addEventListener(
              'abort',
              () => {
                aborted = true;
                resolve();
              },
              { once: true },
            );
          });
          throw new ProviderRequestError(cancelledError('groq', 'chat-model'));
        }),
      },
    });

    const send = service.send({ requestId: 'req-1', message: 'Long answer' });
    await waitFor(() => events.some((event) => event.type === 'assistant.delta'));
    service.cancel('req-1');
    await send;
    const state = await service.getPublicState();

    expect(aborted).toBe(true);
    expect(state.session.status).toBe('idle');
    expect(state.session.messages.at(-1)).toMatchObject({
      content: 'Partial ',
      status: 'cancelled',
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'assistant.end', status: 'cancelled' }),
      ]),
    );
  });

  it('persists messages and the selected model without persisting credentials', async () => {
    const storage = memoryStorage();
    const first = harness({ storage });
    first.service.selectModel('groq', 'chat-model');
    await first.service.send({ requestId: 'req-1', message: 'Remember this' });
    first.service.dispose();

    const second = harness({ storage });
    const state = await second.service.getPublicState();

    expect(state.session.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'Remember this' }),
      expect.objectContaining({ role: 'assistant', content: 'Hello world', status: 'complete' }),
    ]);
    expect(state.selected).toEqual({ provider: 'groq', modelId: 'chat-model' });
    expect([...storage.values.values()].join('')).not.toContain('key');
  });

  it('lists model availability reasons without credentials', async () => {
    const { service } = harness({ credentials: memoryCredentials() });
    const state = await service.getPublicState();

    expect(state.providers).toEqual([
      expect.objectContaining({
        id: 'groq',
        configured: false,
        models: [
          expect.objectContaining({
            id: 'chat-model',
            available: false,
            reason: 'API key is not configured',
          }),
        ],
      }),
    ]);
  });

  it('marks paid models unavailable while paid fallback is disabled', async () => {
    const { service } = harness({
      entries: [
        registryEntry('free-model'),
        registryEntry('paid-model', {
          freeTierClass: 'paid',
          pricing: { inputPerMTok: 1, outputPerMTok: 2, currency: 'USD' },
        }),
      ],
    });

    const state = await service.getPublicState();
    const paid = state.providers[0]?.models.find((model) => model.id === 'paid-model');

    expect(paid).toMatchObject({ available: false });
    expect(paid?.reason).toContain('paid fallback is off');
  });

  it('does not overwrite an exhausted quota with success after the stream finishes', async () => {
    const { service, quota } = harness({
      adapters: {
        groq: fakeAdapter(async function* () {
          yield {
            type: 'rate-limit',
            metadata: {
              source: 'headers',
              requests: {
                limit: 50,
                remaining: 0,
                resetAt: '2026-11-02T12:01:00.000Z',
              },
              capturedAt: '2026-11-02T12:00:00.000Z',
            },
          };
          yield { type: 'text-delta', text: 'Last allowed response' };
          yield { type: 'finish', reason: 'stop' };
        }),
      },
    });

    await service.send({ requestId: 'req-1', message: 'Hello' });
    const state = await service.getPublicState();

    expect(state.session.messages.at(-1)).toMatchObject({
      status: 'complete',
      content: 'Last allowed response',
    });
    expect(quota.canUse('groq', 'chat-model')).toMatchObject({
      allowed: false,
      availability: { state: 'exhausted' },
    });
  });

  it('clears a persisted selection when its API key is removed', async () => {
    const store = memoryCredentials({ groq: 'key' });
    const { service } = harness({ credentials: store });
    expect(service.selectModel('groq', 'chat-model')).toBe(true);

    await store.delete('groq');
    await service.refreshModels();
    const state = await service.getPublicState();

    expect(state.selected).toBeUndefined();
  });

  it('refreshes models only for configured providers', async () => {
    const listModels = vi.fn(async () => []);
    const { service } = harness({
      credentials: memoryCredentials({ groq: 'key' }),
      adapters: {
        groq: fakeAdapter(() => textStream(), { listModels }),
        openrouter: fakeAdapter(() => textStream(), {
          id: 'openrouter',
          listModels: vi.fn(async () => []),
        }),
      },
    });

    await service.refreshModels();

    expect(listModels).toHaveBeenCalledTimes(1);
  });
  it('persists the selected agent mode', async () => {
    const storage = memoryStorage();
    const first = harness({ storage });
    first.service.setMode('plan');
    expect((await first.service.getPublicState()).mode).toBe('plan');

    const second = harness({ storage });
    expect((await second.service.getPublicState()).mode).toBe('plan');
  });

  it('refuses a mode change while a response is streaming', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, events } = harness({
      adapters: {
        groq: fakeAdapter(async function* () {
          await gate;
          yield { type: 'text-delta', text: 'done' };
          yield { type: 'finish', reason: 'stop' };
        }),
      },
    });

    const pending = service.send({ requestId: 'req-1', message: 'Hello' });
    await waitFor(() => events.some((event) => event.type === 'assistant.start'));

    service.setMode('build');

    expect((await service.getPublicState()).mode).toBe('ask');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('Stop the active response'),
        }),
      ]),
    );

    release?.();
    await pending;
  });

  it('runs Build mode through the agent loop and streams an unverified completion', async () => {
    const executions: string[] = [];
    let calls = 0;
    const { service, events } = harness({
      tools: fakeToolHost({
        execute: async (toolId, input) => {
          executions.push(toolId);
          return { ok: true, data: { path: (input as { path: string }).path, bytes: 2 } };
        },
      }),
      adapters: {
        groq: fakeAdapter(() => {
          calls += 1;
          if (calls === 1) {
            return (async function* () {
              yield {
                type: 'tool-call-delta',
                index: 0,
                id: 'call-write',
                name: 'fs_write_file',
                argumentsDelta: '{"path":"answer.txt","content":"hi"}',
              } satisfies ModelEvent;
              yield { type: 'finish', reason: 'tool_calls' } satisfies ModelEvent;
            })();
          }
          return textStream('Done');
        }),
      },
    });
    service.setMode('build');

    await service.send({ requestId: 'req-1', message: 'Write answer.txt' });
    const state = await service.getPublicState();

    expect(executions).toEqual(['fs.write_file']);
    expect(events).toEqual(
      expect.arrayContaining([
        {
          type: 'tool.activity',
          id: 'call-write',
          requestId: 'req-1',
          label: 'Running fs.write_file',
          status: 'running',
        },
        {
          type: 'tool.activity',
          id: 'call-write',
          requestId: 'req-1',
          label: 'fs.write_file completed',
          status: 'ok',
        },
        expect.objectContaining({
          type: 'assistant.end',
          status: 'complete',
          content: expect.stringContaining('_Completed without verification evidence._'),
        }),
      ]),
    );
    expect(state.session.messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'complete',
      content: expect.stringContaining('_Completed without verification evidence._'),
    });
  });

  it('reports unavailable workspace tools in Build mode without a tool host', async () => {
    const { service, events } = harness();
    service.setMode('build');

    await service.send({ requestId: 'req-1', message: 'Fix the bug' });

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          requestId: 'req-1',
          message: expect.stringContaining('Workspace tools are unavailable'),
        }),
      ]),
    );
  });
});

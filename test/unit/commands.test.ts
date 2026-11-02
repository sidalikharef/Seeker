import { describe, expect, it, vi } from 'vitest';
import {
  registerSeekerCommands,
  type CommandRegistrar,
  type CommandUi,
  type DisposableLike,
} from '../../src/extension/commands';
import { ModelCatalog } from '../../src/providers/model-catalog';
import { QuotaLedger } from '../../src/router/quota';
import type {
  CredentialProvider,
  ModelDescriptor,
  ProviderAdapter,
  ProviderId,
} from '../../src/providers/types';
import { COMMANDS } from '../../src/shared/commands';

function credentials(): CredentialProvider & { values: Map<ProviderId, string> } {
  const values = new Map<ProviderId, string>();
  return {
    values,
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

function descriptor(id: string): ModelDescriptor {
  return {
    provider: 'openrouter',
    modelId: id,
    displayName: id,
    freeTierClass: 'free-tier',
    capabilities: {
      supportsStreaming: true,
      supportsTools: 'unknown',
      supportsParallelTools: 'unknown',
      supportsStructuredOutput: 'unknown',
      supportsImages: 'unknown',
      supportsReasoning: 'unknown',
      supportsPromptCaching: 'unknown',
    },
    source: 'provider-api',
  };
}

function fakeAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    id: 'openrouter',
    baseUrl: 'https://example.test',
    freeTierClass: 'free-tier',
    listModels: async () => [descriptor('a'), descriptor('b')],
    streamChat: () => (async function* () {})(),
    healthCheck: async () => ({
      provider: 'openrouter',
      state: 'healthy',
      checkedAt: '2026-01-01T00:00:00.000Z',
      latencyMs: 12,
    }),
    ...overrides,
  };
}

function harness(uiOverrides: Partial<CommandUi> = {}) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const registrar: CommandRegistrar = {
    registerCommand: (command, callback): DisposableLike => {
      handlers.set(command, callback);
      return { dispose: () => undefined };
    },
  };
  const messages: string[] = [];
  const ui: CommandUi = {
    showInformationMessage: (message) => {
      messages.push(message);
    },
    showWarningMessage: async () => 'Clear',
    showInputBox: async () => 'sk-test-secret',
    showQuickPick: async () => ({
      label: 'OpenRouter',
      description: '',
      provider: 'openrouter',
    }),
    ...uiOverrides,
  };
  return { handlers, messages, ui, registrar };
}

describe('provider commands', () => {
  it('stores an API key and refreshes models without logging the key', async () => {
    const store = credentials();
    const logs: string[] = [];
    const { handlers, messages, ui, registrar } = harness();
    const adapter = fakeAdapter();
    const catalog = new ModelCatalog({ openrouter: adapter });

    registerSeekerCommands(registrar, ui, {
      credentials: store,
      adapters: { openrouter: adapter },
      catalog,
      log: (message) => logs.push(message),
    });

    await handlers.get(COMMANDS.setApiKey)?.('openrouter');

    expect(store.values.get('openrouter')).toBe('sk-test-secret');
    expect(messages.at(-1)).toContain('Discovered 2 models');
    expect(logs.join('\n')).not.toContain('sk-test-secret');
  });

  it('clears a stored key after confirmation', async () => {
    const store = credentials();
    store.values.set('groq', 'secret');
    const { handlers, messages, ui, registrar } = harness();

    registerSeekerCommands(registrar, ui, { credentials: store });
    await handlers.get(COMMANDS.clearApiKey)?.('groq');

    expect(store.values.has('groq')).toBe(false);
    expect(messages.at(-1)).toContain('Groq API key cleared');
  });

  it('clears quota state when a provider key is removed', async () => {
    const store = credentials();
    store.values.set('groq', 'secret');
    const { handlers, ui, registrar } = harness();
    const quota = new QuotaLedger({ now: () => 0 });
    quota.markRateLimited('groq', { modelId: 'model', retryAfterMs: 1_000 });

    registerSeekerCommands(registrar, ui, { credentials: store, quota });
    await handlers.get(COMMANDS.clearApiKey)?.('groq');

    expect(quota.getAvailability('groq', 'model')).toBeUndefined();
  });

  it('does not clear when confirmation is dismissed', async () => {
    const store = credentials();
    store.values.set('groq', 'secret');
    const { handlers, ui, registrar } = harness({
      showWarningMessage: async () => undefined,
    });

    registerSeekerCommands(registrar, ui, { credentials: store });
    await handlers.get(COMMANDS.clearApiKey)?.('groq');

    expect(store.values.get('groq')).toBe('secret');
  });

  it('reports health and free daily usage', async () => {
    const adapter = {
      ...fakeAdapter(),
      getKeyStatus: vi.fn(async () => ({
        provider: 'openrouter' as const,
        freeModelDailyRequests: { used: 10, limit: 50, remaining: 40 },
        capturedAt: '2026-01-01T00:00:00.000Z',
      })),
    };
    const { handlers, messages, ui, registrar } = harness();
    const quota = new QuotaLedger({ now: () => 0 });

    registerSeekerCommands(registrar, ui, {
      adapters: { openrouter: adapter },
      credentials: credentials(),
      quota,
    });
    await handlers.get(COMMANDS.testConnection)?.('openrouter');

    expect(messages.at(-1)).toContain('connected in 12 ms');
    expect(messages.at(-1)).toContain('10/50');
    expect(messages.at(-1)).toContain('40 remaining');
    expect(quota.getQuota('openrouter', { scope: 'request', window: 'day' })[0]).toMatchObject({
      remaining: 40,
      used: 10,
    });
  });

  it('prints routing debug output and logs it', async () => {
    const logs: string[] = [];
    const { handlers, messages, ui, registrar } = harness();

    registerSeekerCommands(registrar, ui, {
      log: (message) => logs.push(message),
      showSelection: () => 'Selected: groq/openai/gpt-oss-120b',
    });
    await handlers.get(COMMANDS.showRouting)?.();

    expect(messages.at(-1)).toContain('Selected: groq/openai/gpt-oss-120b');
    expect(logs.at(-1)).toContain('Selected: groq/openai/gpt-oss-120b');
  });

  it('reports normalized connection failures', async () => {
    const adapter = fakeAdapter({
      healthCheck: async () => ({
        provider: 'openrouter',
        state: 'unavailable',
        checkedAt: '2026-01-01T00:00:00.000Z',
        message: 'OpenRouter API key is not configured.',
      }),
    });
    const { handlers, messages, ui, registrar } = harness();

    const errors: string[] = [];
    registerSeekerCommands(
      registrar,
      {
        ...ui,
        showErrorMessage: (message) => {
          errors.push(message);
        },
      },
      { adapters: { openrouter: adapter } },
    );

    await handlers.get(COMMANDS.testConnection)?.('openrouter');

    expect(messages).toHaveLength(0);
    expect(errors.at(-1)).toContain('OpenRouter API key is not configured.');
  });
});

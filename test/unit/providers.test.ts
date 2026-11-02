import { describe, expect, it } from 'vitest';
import { GroqProvider, parseGroqRateLimitHeaders } from '../../src/providers/groq';
import {
  OpenRouterProvider,
  parseOpenRouterRateLimitHeaders,
} from '../../src/providers/openrouter';
import type { CredentialProvider, ModelEvent, ProviderId } from '../../src/providers/types';

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

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(event));
        }
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

async function collect(iterable: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe('OpenRouterProvider', () => {
  it('lists and classifies free and paid models', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        data: [
          {
            id: 'deepseek/example:free',
            name: 'Free Example',
            context_length: 65_536,
            architecture: {
              input_modalities: ['text', 'image'],
              output_modalities: ['text'],
            },
            supported_parameters: ['tools', 'response_format', 'reasoning'],
            pricing: { prompt: '0', completion: '0' },
            top_provider: { max_completion_tokens: 8_192 },
          },
          {
            id: 'paid/example',
            name: 'Paid Example',
            context_length: 4_096,
            supported_parameters: ['tools'],
            pricing: { prompt: '0.000001', completion: '0.000002' },
          },
        ],
      })) as typeof fetch;

    const provider = new OpenRouterProvider(memoryCredentials(), { fetchImpl });
    const models = await provider.listModels();

    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      provider: 'openrouter',
      modelId: 'deepseek/example:free',
      freeTierClass: 'free-tier',
      contextWindow: 65_536,
      maxOutputTokens: 8_192,
      pricing: { inputPerMTok: 0, outputPerMTok: 0, currency: 'USD' },
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsParallelTools: true,
        supportsStructuredOutput: true,
        supportsImages: true,
        supportsReasoning: true,
        toolCallFormat: 'openai',
      },
    });
    expect(models[1]).toMatchObject({
      modelId: 'paid/example',
      freeTierClass: 'paid',
      pricing: { inputPerMTok: 1, outputPerMTok: 2 },
    });
  });

  it('reads key status and free daily usage', async () => {
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      expect(String(input)).toBe('https://openrouter.ai/api/v1/key');
      return jsonResponse({
        data: {
          label: 'test-key',
          limit: 20,
          usage: 5,
          limit_remaining: 15,
          free_model_daily_requests: 50,
          free_model_daily_requests_used: 10,
        },
      });
    }) as typeof fetch;

    const provider = new OpenRouterProvider(memoryCredentials({ openrouter: 'key' }), {
      fetchImpl,
    });
    const status = await provider.getKeyStatus();

    expect(status).toMatchObject({
      provider: 'openrouter',
      label: 'test-key',
      limitRemaining: 15,
      freeModelDailyRequests: { used: 10, limit: 50, remaining: 40 },
    });
  });

  it('streams text, tool calls, usage, and finish reasons', async () => {
    const fetchImpl = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer key');
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"world","tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"pa"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a.ts\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n',
        'data: [DONE]\n\n',
      ]);
    }) as typeof fetch;

    const provider = new OpenRouterProvider(memoryCredentials({ openrouter: 'key' }), {
      fetchImpl,
    });
    const events = await collect(
      provider.streamChat(
        { model: 'test/model', messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      ),
    );

    expect(events).toEqual([
      { type: 'text-delta', text: 'Hello ' },
      { type: 'text-delta', text: 'world' },
      {
        type: 'tool-call-delta',
        index: 0,
        id: 'call_1',
        name: 'read_file',
        argumentsDelta: '{"pa',
      },
      {
        type: 'tool-call-delta',
        index: 0,
        id: undefined,
        name: undefined,
        argumentsDelta: 'th":"a.ts"}',
      },
      {
        type: 'usage',
        usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      },
      { type: 'finish', reason: 'tool_calls' },
    ]);
  });

  it('requires a key before streaming', async () => {
    const provider = new OpenRouterProvider(memoryCredentials());
    await expect(
      collect(
        provider.streamChat(
          { model: 'test/model', messages: [{ role: 'user', content: 'hi' }] },
          new AbortController().signal,
        ),
      ),
    ).rejects.toMatchObject({ normalized: { kind: 'auth' } });
  });

  it('parses rate-limit headers', () => {
    const metadata = parseOpenRouterRateLimitHeaders(
      new Headers({
        'x-ratelimit-limit': '20',
        'x-ratelimit-remaining': '3',
        'x-ratelimit-reset': '1m',
        'retry-after': '2',
      }),
      Date.parse('2026-01-01T00:00:00.000Z'),
    );

    expect(metadata).toMatchObject({
      source: 'headers',
      requests: {
        limit: 20,
        remaining: 3,
        resetAt: '2026-01-01T00:01:00.000Z',
      },
      retryAfterMs: 2_000,
    });
  });
});

describe('GroqProvider', () => {
  it('lists models with static capability and context metadata', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        data: [
          {
            id: 'openai/gpt-oss-120b',
            active: true,
            context_window: 131_072,
            max_completion_tokens: 65_536,
          },
          { id: 'inactive/model', active: false },
        ],
      })) as typeof fetch;

    const provider = new GroqProvider(memoryCredentials({ groq: 'key' }), { fetchImpl });
    const models = await provider.listModels();

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      provider: 'groq',
      modelId: 'openai/gpt-oss-120b',
      freeTierClass: 'free-tier',
      contextWindow: 131_072,
      maxOutputTokens: 65_536,
      capabilities: {
        supportsTools: true,
        supportsStructuredOutput: true,
        supportsReasoning: true,
        structuredOutputMode: 'json-schema',
      },
    });
  });

  it('returns static free-tier key status', async () => {
    const provider = new GroqProvider(memoryCredentials({ groq: 'key' }));
    await expect(provider.getKeyStatus()).resolves.toMatchObject({
      provider: 'groq',
      label: 'Groq free tier',
      freeModelDailyRequests: { limit: 1_000 },
    });
  });

  it('requires a key to list models', async () => {
    const provider = new GroqProvider(memoryCredentials());
    await expect(provider.listModels()).rejects.toMatchObject({
      normalized: { kind: 'auth', provider: 'groq' },
    });
  });

  it('parses request and token rate-limit headers', () => {
    const metadata = parseGroqRateLimitHeaders(
      new Headers({
        'x-ratelimit-limit-requests': '30',
        'x-ratelimit-remaining-requests': '7',
        'x-ratelimit-reset-requests': '2.5s',
        'x-ratelimit-limit-tokens': '8000',
        'x-ratelimit-remaining-tokens': '4000',
        'x-ratelimit-reset-tokens': '1m',
      }),
      Date.parse('2026-01-01T00:00:00.000Z'),
    );

    expect(metadata).toMatchObject({
      requests: {
        limit: 30,
        remaining: 7,
        resetAt: '2026-01-01T00:00:02.500Z',
      },
      tokens: {
        limit: 8_000,
        remaining: 4_000,
        resetAt: '2026-01-01T00:01:00.000Z',
      },
    });
  });
});

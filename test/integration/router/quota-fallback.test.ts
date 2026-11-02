import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryEventSink } from '../../../src/core/events';
import { normalizeHttpError } from '../../../src/providers/errors';
import { streamOpenAiCompatible } from '../../../src/providers/openai-compatible';
import type { ModelCapabilities, NormalizedProviderError } from '../../../src/providers/types';
import { QuotaLedger } from '../../../src/router/quota';
import { ModelRegistry } from '../../../src/router/registry';
import { ModelRouter } from '../../../src/router/router';

let server: Server | undefined;

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Mock server did not bind a TCP port.');
  }
  return `http://127.0.0.1:${address.port}/chat`;
}

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
});

const capabilities: ModelCapabilities = {
  supportsStreaming: true,
  supportsTools: true,
  supportsParallelTools: true,
  supportsStructuredOutput: true,
  supportsImages: false,
  supportsReasoning: false,
  supportsPromptCaching: false,
  contextWindow: 131_072,
};

function entry(modelId: string) {
  return {
    provider: 'openrouter' as const,
    modelId,
    displayName: modelId,
    freeTierClass: 'free-tier' as const,
    capabilities,
    tags: [],
    verification: { verifiedAt: '2026-11-01', source: 'provider-docs' as const },
  };
}

describe('router quota fallback over HTTP', () => {
  it('pauses an exhausted model and selects another free model', async () => {
    const url = await startServer((request, response) => {
      request.resume();
      response.writeHead(429, {
        'content-type': 'application/json',
        'x-ratelimit-reset-requests': '1d',
      });
      response.end(
        JSON.stringify({ error: { message: 'Daily request quota exceeded for free models.' } }),
      );
    });

    let normalized: NormalizedProviderError | undefined;
    for await (const event of streamOpenAiCompatible({
      provider: 'openrouter',
      url,
      headers: { authorization: 'Bearer secret' },
      body: { model: 'free/a', messages: [] },
      model: 'free/a',
      signal: new AbortController().signal,
      timeoutMs: 5_000,
      normalizeError: ({ status, headers, bodyText }) =>
        normalizeHttpError({
          provider: 'openrouter',
          model: 'free/a',
          status,
          headers,
          bodyText,
          forbiddenKind: 'quota_exhausted',
        }),
    })) {
      if (event.type === 'error') {
        normalized = event.error;
      }
    }

    expect(normalized).toMatchObject({
      kind: 'quota_exhausted',
      httpStatus: 429,
      retryable: false,
    });
    expect(normalized?.resetAt).toBeDefined();

    const quota = new QuotaLedger();
    quota.recordError('openrouter', normalized!);
    expect(quota.isExhausted('openrouter', 'free/a')).toBe(true);

    const registry = new ModelRegistry([entry('free/a'), entry('free/b')]);
    const sink = new MemoryEventSink();
    const router = new ModelRouter({ registry, quota, sink });
    const result = router.select(
      {
        taskKind: 'code',
        required: { tools: true, streaming: true },
        policy: 'free-first',
      },
      { provider: 'openrouter', modelId: 'free/a' },
    );

    expect(result.decision?.modelId).toBe('free/b');
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: 'free/a',
          reason: expect.stringContaining('Free quota exhausted; resets'),
        }),
      ]),
    );
    expect(sink.events[0]).toMatchObject({
      type: 'model.fallback',
      from: { provider: 'openrouter', modelId: 'free/a' },
      to: { provider: 'openrouter', modelId: 'free/b' },
    });
  });
});

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatService } from '../../../src/extension/chat-service';
import { ModelCatalog } from '../../../src/providers/model-catalog';
import {
  streamOpenAiCompatible,
  toOpenAiRequestBody,
} from '../../../src/providers/openai-compatible';
import type {
  ChatRequest,
  CredentialProvider,
  ModelEvent,
  ProviderAdapter,
  ProviderId,
} from '../../../src/providers/types';
import { QuotaLedger } from '../../../src/router/quota';
import { ModelRegistry } from '../../../src/router/registry';
import { ModelRouter } from '../../../src/router/router';
import { registryEntry } from '../../unit/router/fixtures';

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
  return `http://127.0.0.1:${address.port}/chat/completions`;
}

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
});

function credentials(): CredentialProvider {
  return {
    get: async (provider: ProviderId) => (provider === 'groq' ? 'test-secret' : undefined),
    set: async () => undefined,
    delete: async () => undefined,
    has: async (provider: ProviderId) => provider === 'groq',
  };
}

function adapter(url: string): ProviderAdapter {
  return {
    id: 'groq',
    baseUrl: url,
    freeTierClass: 'free-tier',
    listModels: async () => [],
    streamChat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
      return streamOpenAiCompatible({
        provider: 'groq',
        url,
        headers: { authorization: 'Bearer test-secret' },
        body: toOpenAiRequestBody(request),
        model: request.model,
        signal,
        timeoutMs: 5_000,
      });
    },
    healthCheck: async () => ({
      provider: 'groq',
      state: 'healthy',
      checkedAt: '2026-11-02T00:00:00.000Z',
    }),
  };
}

function storage() {
  const values = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },
    set<T>(key: string, value: T | undefined): void {
      values.set(key, value);
    },
  };
}

describe('chat service over a real SSE connection', () => {
  it('streams a provider response into ordered UI events and persisted messages', async () => {
    let requestBody = '';
    let seenAuthorization = '';
    const url = await startServer((request, response) => {
      seenAuthorization = String(request.headers.authorization ?? '');
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        requestBody += chunk;
      });
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write('data: {"choices":[{"delta":{"content":"Hello from "}}]}\n\n');
        setTimeout(() => {
          response.write(
            'data: {"choices":[{"delta":{"content":"SSE"},"finish_reason":"stop"}]}\n\n',
          );
          response.end('data: [DONE]\n\n');
        }, 15);
      });
    });

    const serviceAdapter = adapter(url);
    const registry = new ModelRegistry([registryEntry('mock/chat', { displayName: 'mock/chat' })]);
    const quota = new QuotaLedger();
    const service = new ChatService({
      adapters: { groq: serviceAdapter },
      catalog: new ModelCatalog({ groq: serviceAdapter }),
      registry,
      router: new ModelRouter({ registry, quota }),
      quota,
      credentials: credentials(),
      getRoutingSettings: () => ({
        policy: 'free-first',
        allowPaid: false,
        maxCostUsd: 0,
        excludedProviders: [],
      }),
      storage: storage(),
      createId: (() => {
        let id = 0;
        return () => `id-${++id}`;
      })(),
    });

    const events: string[] = [];
    service.subscribe((event) => events.push(event.type));
    await service.send({ requestId: 'req-real', message: 'Say hello' });
    const state = await service.getPublicState();

    expect(state.session.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Hello from SSE',
      status: 'complete',
    });
    expect(events).toEqual(
      expect.arrayContaining(['assistant.start', 'assistant.delta', 'assistant.end']),
    );
    expect(seenAuthorization).toBe('Bearer test-secret');
    expect(requestBody).toContain('"stream":true');
    expect(JSON.parse(requestBody).messages[0]).toMatchObject({ role: 'system' });
    expect(JSON.parse(requestBody).messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'Say hello',
    });
  });
});

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { streamOpenAiCompatible } from '../../../src/providers/openai-compatible';
import type { ModelEvent } from '../../../src/providers/types';

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

function streamOptions(url: string, signal: AbortSignal) {
  return {
    provider: 'openrouter' as const,
    url,
    headers: {},
    body: { model: 'test/model' },
    model: 'test/model',
    signal,
    timeoutMs: 5_000,
  };
}

describe('mock provider server', () => {
  it('streams incremental text over a real HTTP connection', async () => {
    const url = await startServer((request, response) => {
      request.resume();
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
      setTimeout(() => {
        response.write(
          'data: {"choices":[{"delta":{"content":" second"},"finish_reason":"stop"}]}\n\n',
        );
        response.end('data: [DONE]\n\n');
      }, 20);
    });

    const iterator = streamOpenAiCompatible(streamOptions(url, new AbortController().signal))[
      Symbol.asyncIterator
    ]();

    const first = await iterator.next();
    expect(first.value).toEqual({ type: 'text-delta', text: 'first' });

    const remaining: ModelEvent[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) {
        break;
      }
      remaining.push(next.value);
    }

    expect(remaining).toEqual([
      { type: 'text-delta', text: ' second' },
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('cancels an active stream promptly', async () => {
    const url = await startServer((request, response) => {
      request.resume();
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: {"choices":[{"delta":{"content":"open"}}]}\n\n');
      const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 1_000);
      request.on('close', () => {
        clearInterval(keepAlive);
        response.destroy();
      });
    });

    const controller = new AbortController();
    const iterator = streamOpenAiCompatible(streamOptions(url, controller.signal))[
      Symbol.asyncIterator
    ]();

    const first = await iterator.next();
    expect(first.value).toEqual({ type: 'text-delta', text: 'open' });

    const abortedAt = Date.now();
    controller.abort();
    const next = await iterator.next();

    expect(Date.now() - abortedAt).toBeLessThan(100);
    expect(next.value).toMatchObject({
      type: 'error',
      error: { kind: 'cancelled', retryable: false },
    });
  });
});

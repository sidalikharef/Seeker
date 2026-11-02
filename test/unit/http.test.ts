import { describe, expect, it, vi } from 'vitest';
import {
  HttpResponseError,
  linkAbortSignal,
  parseSse,
  readTextWithLimit,
  requestJson,
} from '../../src/providers/http';

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

describe('linkAbortSignal', () => {
  it('times out and reports the cause', () => {
    vi.useFakeTimers();
    const linked = linkAbortSignal(undefined, 50);

    expect(linked.signal.aborted).toBe(false);
    vi.advanceTimersByTime(50);

    expect(linked.signal.aborted).toBe(true);
    expect(linked.didTimeOut()).toBe(true);
    linked.cleanup();
    vi.useRealTimers();
  });

  it('propagates parent aborts', () => {
    const parent = new AbortController();
    const linked = linkAbortSignal(parent.signal, 1_000);

    parent.abort();

    expect(linked.signal.aborted).toBe(true);
    expect(linked.didAbort()).toBe(true);
    expect(linked.didTimeOut()).toBe(false);
    linked.cleanup();
  });
});

describe('readTextWithLimit', () => {
  it('reads text under the limit', async () => {
    const response = new Response('hello');
    await expect(readTextWithLimit(response, 100)).resolves.toBe('hello');
  });

  it('rejects oversized declared and streamed bodies', async () => {
    const declared = new Response('hello', { headers: { 'content-length': '100' } });
    await expect(readTextWithLimit(declared, 10)).rejects.toMatchObject({
      code: 'protocol',
    });

    const streamed = new Response(streamFrom(['12345', '67890']));
    await expect(readTextWithLimit(streamed, 7)).rejects.toMatchObject({
      code: 'protocol',
    });
  });
});

describe('parseSse', () => {
  it('handles split chunks, comments, CRLF, and multi-line data', async () => {
    const events = await collect(
      parseSse(
        streamFrom([': comment\r\n', 'event: delta\r', '\ndata: hel', 'lo\ndata: world\n\n']),
      ),
    );

    expect(events).toEqual([
      {
        data: 'hello\nworld',
        event: 'delta',
        id: undefined,
        retry: undefined,
      },
    ]);
  });

  it('emits a final event without a trailing blank line', async () => {
    const events = await collect(parseSse(streamFrom(['data: [DONE]'])));
    expect(events.map((event) => event.data)).toEqual(['[DONE]']);
  });
});

describe('requestJson', () => {
  it('parses JSON responses', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    const result = await requestJson<{ ok: boolean }>({
      url: 'https://example.test',
      fetchImpl,
    });

    expect(result.data).toEqual({ ok: true });
  });

  it('throws an HTTP error with status and body', async () => {
    const fetchImpl = (async () => new Response('denied', { status: 401 })) as typeof fetch;

    await expect(requestJson({ url: 'https://example.test', fetchImpl })).rejects.toBeInstanceOf(
      HttpResponseError,
    );

    try {
      await requestJson({ url: 'https://example.test', fetchImpl });
    } catch (error) {
      const httpError = error as HttpResponseError;
      expect(httpError.status).toBe(401);
      expect(httpError.bodyText).toBe('denied');
    }
  });

  it('rejects malformed JSON', async () => {
    const fetchImpl = (async () =>
      new Response('not-json', {
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    await expect(requestJson({ url: 'https://example.test', fetchImpl })).rejects.toMatchObject({
      code: 'parse',
    });
  });
});

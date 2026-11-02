import { describe, expect, it } from 'vitest';
import {
  mapFinishReason,
  mapUsage,
  toOpenAiRequestBody,
  streamOpenAiCompatible,
} from '../../src/providers/openai-compatible';
import type { ChatRequest, ModelEvent } from '../../src/providers/types';

async function collect(iterable: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe('OpenAI-compatible request mapping', () => {
  it('maps messages, tools, tool choice, and response format', () => {
    const request: ChatRequest = {
      model: 'test/model',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'read a file' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'read_file', argumentsJson: '{"path":"a.ts"}' }],
        },
        { role: 'tool', content: 'contents', toolCallId: 'call_1', name: 'read_file' },
      ],
      tools: [
        {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ],
      toolChoice: { name: 'read_file' },
      temperature: 0.2,
      maxOutputTokens: 512,
      responseFormat: {
        type: 'json',
        schema: { type: 'object', properties: { answer: { type: 'string' } } },
      },
      stop: ['END'],
      metadata: { trace: 'abc' },
    };

    expect(toOpenAiRequestBody(request)).toEqual({
      model: 'test/model',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'read a file' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'contents' },
      ],
      stream: true,
      stream_options: { include_usage: true },
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file',
            parameters: { type: 'object', properties: { path: { type: 'string' } } },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'read_file' } },
      temperature: 0.2,
      max_tokens: 512,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          schema: { type: 'object', properties: { answer: { type: 'string' } } },
        },
      },
      stop: ['END'],
      metadata: { trace: 'abc' },
    });
  });

  it('maps finish reasons and usage defensively', () => {
    expect(mapFinishReason('stop')).toBe('stop');
    expect(mapFinishReason('length')).toBe('length');
    expect(mapFinishReason('tool_calls')).toBe('tool_calls');
    expect(mapFinishReason('something-new')).toBe('unknown');

    expect(mapUsage({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 })).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    });
    expect(mapUsage({})).toBeUndefined();
    expect(mapUsage(null)).toBeUndefined();
  });
});

describe('streamOpenAiCompatible', () => {
  const base = {
    provider: 'openrouter' as const,
    url: 'https://example.test/chat',
    headers: {},
    body: { model: 'test/model' },
    model: 'test/model',
    signal: new AbortController().signal,
  };

  it('normalizes non-OK responses and respects retry headers', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { message: 'daily limit reached' } }), {
        status: 429,
        headers: {
          'x-ratelimit-remaining-requests': '0',
          'x-ratelimit-reset-requests': '1m',
          'retry-after': '30',
        },
      })) as typeof fetch;

    const events = await collect(streamOpenAiCompatible({ ...base, fetchImpl }));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      error: {
        provider: 'openrouter',
        kind: 'quota_exhausted',
        retryable: false,
        retryAfterMs: 30_000,
        message: 'daily limit reached',
      },
    });
  });

  it('reports malformed stream events as protocol failures', async () => {
    const encoder = new TextEncoder();
    const fetchImpl = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: not-json\n\n'));
            controller.close();
          },
        }),
        { status: 200 },
      )) as typeof fetch;

    const events = await collect(streamOpenAiCompatible({ ...base, fetchImpl }));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      error: { kind: 'server', retryable: true },
    });
  });

  it('reports network failures', async () => {
    const fetchImpl = (async () => {
      throw new Error('connection reset');
    }) as typeof fetch;

    const events = await collect(streamOpenAiCompatible({ ...base, fetchImpl }));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      error: {
        kind: 'network',
        retryable: true,
        message: 'Network request failed: connection reset',
      },
    });
  });
});

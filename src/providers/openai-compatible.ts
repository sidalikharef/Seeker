import { SeekerError } from '../core/errors';
import { safeErrorMessage } from './http';
import { linkAbortSignal, parseSse, readTextWithLimit } from './http';
import {
  cancelledError,
  extractProviderMessage,
  makeProviderError,
  networkError,
  normalizeHttpError,
  protocolError,
  timeoutError,
} from './errors';
import type {
  ChatRequest,
  FinishReason,
  ModelEvent,
  NormalizedMessage,
  NormalizedProviderError,
  ProviderId,
  RateLimitMetadata,
  ToolSchema,
  Usage,
} from './types';

export type FetchLike = typeof fetch;

export interface OpenAiCompatibleStreamOptions {
  provider: ProviderId;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  model: string;
  signal: AbortSignal;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxErrorBytes?: number;
  normalizeError?: (input: {
    status: number;
    headers: Headers;
    bodyText: string;
  }) => NormalizedProviderError;
  parseRateLimitHeaders?: (headers: Headers) => RateLimitMetadata | undefined;
}

export function toOpenAiMessages(messages: NormalizedMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId ?? '',
        content: message.content,
      };
    }

    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content.length > 0 ? message.content : null,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: toolCall.argumentsJson,
          },
        })),
      };
    }

    return {
      role: message.role,
      content: message.content,
      ...(message.name ? { name: message.name } : {}),
    };
  });
}

export function toOpenAiTools(tools: ToolSchema[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function toOpenAiRequestBody(request: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: toOpenAiMessages(request.messages),
    stream: true,
    stream_options: { include_usage: true },
  };

  const tools = toOpenAiTools(request.tools);
  if (tools) {
    body.tools = tools;
  }
  if (request.toolChoice) {
    body.tool_choice =
      typeof request.toolChoice === 'string'
        ? request.toolChoice
        : { type: 'function', function: { name: request.toolChoice.name } };
  }
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  if (request.maxOutputTokens !== undefined) {
    body.max_tokens = request.maxOutputTokens;
  }
  if (request.responseFormat) {
    body.response_format =
      request.responseFormat.type === 'json'
        ? {
            type: 'json_schema',
            json_schema: {
              name: 'response',
              schema: request.responseFormat.schema,
            },
          }
        : { type: 'text' };
  }
  if (request.stop && request.stop.length > 0) {
    body.stop = request.stop;
  }
  if (request.metadata) {
    body.metadata = request.metadata;
  }

  return body;
}

export function mapFinishReason(reason: unknown): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'unknown';
  }
}

export function mapUsage(value: unknown): Usage | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const usage = value as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };

  const inputTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined;
  const outputTokens =
    typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined;
  const totalTokens = typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined;

  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  return { inputTokens, outputTokens, totalTokens };
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (typeof part === 'object' && part !== null && 'text' in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .join('');
  }
  return '';
}

export async function* streamOpenAiCompatible(
  options: OpenAiCompatibleStreamOptions,
): AsyncGenerator<ModelEvent> {
  const linked = linkAbortSignal(options.signal, options.timeoutMs ?? 120_000);
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    let response: Response;
    try {
      response = await fetchImpl(options.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...options.headers,
        },
        body: JSON.stringify(options.body),
        signal: linked.signal,
      });
    } catch (error) {
      if (linked.didTimeOut()) {
        yield { type: 'error', error: timeoutError(options.provider, options.model) };
      } else if (linked.didAbort()) {
        yield { type: 'error', error: cancelledError(options.provider, options.model) };
      } else {
        yield {
          type: 'error',
          error: networkError(options.provider, options.model, safeErrorMessage(error)),
        };
      }
      return;
    }

    if (!response.ok) {
      let bodyText = '';
      try {
        bodyText = await readTextWithLimit(response, options.maxErrorBytes ?? 64 * 1024);
      } catch (error) {
        bodyText = safeErrorMessage(error);
      }

      const error = options.normalizeError
        ? options.normalizeError({
            status: response.status,
            headers: response.headers,
            bodyText,
          })
        : normalizeHttpError({
            provider: options.provider,
            model: options.model,
            status: response.status,
            headers: response.headers,
            bodyText,
          });

      yield { type: 'error', error };
      return;
    }

    const contentType = response.headers.get('content-type');
    if (
      contentType &&
      !contentType.includes('text/event-stream') &&
      !contentType.includes('application/json')
    ) {
      yield {
        type: 'error',
        error: protocolError(
          options.provider,
          options.model,
          `unexpected content type "${contentType}"`,
        ),
      };
      return;
    }

    if (options.parseRateLimitHeaders) {
      const metadata = options.parseRateLimitHeaders(response.headers);
      if (metadata) {
        yield { type: 'rate-limit', metadata };
      }
    }

    if (!response.body) {
      yield {
        type: 'error',
        error: protocolError(options.provider, options.model, 'response body is empty'),
      };
      return;
    }

    let finishReason: FinishReason = 'unknown';

    try {
      for await (const event of parseSse(response.body, linked.signal)) {
        if (event.data === '[DONE]') {
          break;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch (error) {
          yield {
            type: 'error',
            error: protocolError(
              options.provider,
              options.model,
              `invalid JSON event: ${safeErrorMessage(error)}`,
            ),
          };
          return;
        }

        if (typeof payload !== 'object' || payload === null) {
          continue;
        }

        const record = payload as Record<string, unknown>;

        if (record.error !== undefined) {
          yield {
            type: 'error',
            error: makeProviderError(
              options.provider,
              'server',
              extractProviderMessage(JSON.stringify(record)),
              { model: options.model, retryable: true },
            ),
          };
          return;
        }

        const choices = record.choices;
        const choice =
          Array.isArray(choices) && choices.length > 0
            ? (choices[0] as Record<string, unknown>)
            : undefined;

        if (choice) {
          const delta = choice.delta;
          if (typeof delta === 'object' && delta !== null) {
            const deltaRecord = delta as Record<string, unknown>;
            const text = textFromContent(deltaRecord.content);
            if (text.length > 0) {
              yield { type: 'text-delta', text };
            }

            const toolCalls = deltaRecord.tool_calls;
            if (Array.isArray(toolCalls)) {
              for (const rawToolCall of toolCalls) {
                if (typeof rawToolCall !== 'object' || rawToolCall === null) {
                  continue;
                }
                const toolCall = rawToolCall as Record<string, unknown>;
                const index = typeof toolCall.index === 'number' ? toolCall.index : 0;
                const id = typeof toolCall.id === 'string' ? toolCall.id : undefined;
                const fn = toolCall.function;
                const functionRecord =
                  typeof fn === 'object' && fn !== null
                    ? (fn as Record<string, unknown>)
                    : undefined;
                const name =
                  typeof functionRecord?.name === 'string' ? functionRecord.name : undefined;
                const argumentsDelta =
                  typeof functionRecord?.arguments === 'string'
                    ? functionRecord.arguments
                    : undefined;

                yield {
                  type: 'tool-call-delta',
                  index,
                  id,
                  name,
                  argumentsDelta,
                };
              }
            }
          }

          if (typeof choice.finish_reason === 'string') {
            finishReason = mapFinishReason(choice.finish_reason);
          }
        }

        const usage = mapUsage(record.usage);
        if (usage) {
          yield { type: 'usage', usage };
        }
      }
    } catch (error) {
      if (linked.didTimeOut()) {
        yield { type: 'error', error: timeoutError(options.provider, options.model) };
      } else if (
        linked.didAbort() ||
        (error instanceof SeekerError && error.code === 'cancelled')
      ) {
        yield { type: 'error', error: cancelledError(options.provider, options.model) };
      } else {
        yield {
          type: 'error',
          error: networkError(options.provider, options.model, safeErrorMessage(error)),
        };
      }
      return;
    }

    yield { type: 'finish', reason: finishReason };
  } finally {
    linked.cleanup();
  }
}

import { SeekerError } from '../core/errors';
import { redactSecrets } from '../shared/redaction';

export interface LinkedAbortSignal {
  signal: AbortSignal;
  cleanup(): void;
  didTimeOut(): boolean;
  didAbort(): boolean;
}

export function linkAbortSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): LinkedAbortSignal {
  const controller = new AbortController();
  let timedOut = false;
  let aborted = false;

  const onAbort = (): void => {
    aborted = true;
    controller.abort(parent?.reason);
  };

  if (parent?.aborted) {
    onAbort();
  } else {
    parent?.addEventListener('abort', onAbort, { once: true });
  }

  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort(new Error('Request timed out'));
        }, timeoutMs)
      : undefined;

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer) {
        clearTimeout(timer);
      }
      parent?.removeEventListener('abort', onAbort);
    },
    didTimeOut: () => timedOut,
    didAbort: () => aborted || parent?.aborted === true,
  };
}

export async function readTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new SeekerError(`Provider response exceeded the ${maxBytes} byte limit.`, 'protocol');
  }

  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        throw new SeekerError(`Provider response exceeded the ${maxBytes} byte limit.`, 'protocol');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(combined);
}

export interface SseEvent {
  data: string;
  event?: string;
  id?: string;
  retry?: number;
}

export async function* parseSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  let eventName: string | undefined;
  let eventId: string | undefined;
  let retry: number | undefined;

  const takeEvent = (): SseEvent | undefined => {
    if (dataLines.length === 0) {
      eventName = undefined;
      retry = undefined;
      return undefined;
    }

    const event: SseEvent = {
      data: dataLines.join('\n'),
      event: eventName,
      id: eventId,
      retry,
    };

    dataLines = [];
    eventName = undefined;
    retry = undefined;
    return event;
  };

  const processLine = (line: string): SseEvent | undefined => {
    if (line === '') {
      return takeEvent();
    }
    if (line.startsWith(':')) {
      return undefined;
    }

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    switch (field) {
      case 'data':
        dataLines.push(value);
        return undefined;
      case 'event':
        eventName = value;
        return undefined;
      case 'id':
        eventId = value;
        return undefined;
      case 'retry': {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
          retry = parsed;
        }
        return undefined;
      }
      default:
        return undefined;
    }
  };

  try {
    for (;;) {
      if (signal?.aborted) {
        throw new SeekerError('Stream aborted.', 'cancelled');
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) {
          line = line.slice(0, -1);
        }

        const event = processLine(line);
        if (event) {
          yield event;
        }

        newline = buffer.indexOf('\n');
      }
    }

    buffer += decoder.decode();
    if (buffer.length > 0) {
      const event = processLine(buffer.replace(/\r$/, ''));
      if (event) {
        yield event;
      }
    }

    const finalEvent = takeEvent();
    if (finalEvent) {
      yield finalEvent;
    }
  } finally {
    reader.releaseLock();
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  );
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return redactSecrets(error.message);
  }
  return redactSecrets(String(error));
}

export class HttpTransportError extends SeekerError {
  readonly kind: 'timeout' | 'cancelled' | 'network';

  constructor(kind: 'timeout' | 'cancelled' | 'network', message: string, cause?: unknown) {
    super(message, kind, { cause });
    this.name = 'HttpTransportError';
    this.kind = kind;
  }
}

export class HttpResponseError extends SeekerError {
  readonly status: number;
  readonly headers: Headers;
  readonly bodyText: string;

  constructor(status: number, headers: Headers, bodyText: string) {
    super(`Provider returned HTTP ${status}.`, 'protocol');
    this.name = 'HttpResponseError';
    this.status = status;
    this.headers = headers;
    this.bodyText = bodyText;
  }
}

export interface JsonRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}

export interface JsonResponse<T> {
  data: T;
  headers: Headers;
}

export async function requestJson<T>(options: JsonRequestOptions): Promise<JsonResponse<T>> {
  const linked = linkAbortSignal(options.signal, options.timeoutMs ?? 30_000);
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    let response: Response;
    try {
      response = await fetchImpl(options.url, {
        method: options.method ?? 'GET',
        headers: {
          accept: 'application/json',
          ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: linked.signal,
      });
    } catch (error) {
      if (linked.didTimeOut()) {
        throw new HttpTransportError('timeout', 'Provider request timed out.', error);
      }
      if (linked.didAbort()) {
        throw new HttpTransportError('cancelled', 'Provider request was cancelled.', error);
      }
      throw new HttpTransportError('network', 'Network request failed.', error);
    }

    let bodyText: string;
    try {
      bodyText = await readTextWithLimit(response, options.maxResponseBytes ?? 5 * 1024 * 1024);
    } catch (error) {
      if (linked.didTimeOut()) {
        throw new HttpTransportError('timeout', 'Provider request timed out.', error);
      }
      if (linked.didAbort()) {
        throw new HttpTransportError('cancelled', 'Provider request was cancelled.', error);
      }
      throw error;
    }

    if (!response.ok) {
      throw new HttpResponseError(response.status, response.headers, bodyText);
    }

    const contentType = response.headers.get('content-type');
    if (
      contentType &&
      !contentType.includes('application/json') &&
      !contentType.includes('+json')
    ) {
      throw new SeekerError(
        `Provider returned unexpected content type "${contentType}".`,
        'protocol',
      );
    }

    try {
      return { data: JSON.parse(bodyText) as T, headers: response.headers };
    } catch (error) {
      throw new SeekerError('Provider returned malformed JSON.', 'parse', { cause: error });
    }
  } finally {
    linked.cleanup();
  }
}

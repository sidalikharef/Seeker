import { SeekerError } from '../core/errors';
import { HttpTransportError, HttpResponseError } from './http';
import { redactSecrets } from '../shared/redaction';
import type { NormalizedProviderError, ProviderErrorKind, ProviderId } from './types';

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.max(0, date - now);
  }

  return undefined;
}

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDurationMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(0, numeric * 1000);
  }

  const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g;
  let total = 0;
  let consumed = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    total += Number(match[1]) * DURATION_UNITS[match[2]];
    consumed += match[0].length;
  }

  if (consumed === 0 || consumed !== value.length) {
    return undefined;
  }

  return total;
}

export function resetAtFromDuration(value: string | null, now = Date.now()): string | undefined {
  const duration = parseDurationMs(value);
  if (duration === undefined) {
    return undefined;
  }
  return new Date(now + duration).toISOString();
}

export function extractProviderMessage(bodyText: string): string {
  if (!bodyText.trim()) {
    return 'The provider returned an empty error response.';
  }

  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: unknown; code?: unknown } | string;
      message?: unknown;
    };

    const message =
      typeof parsed.error === 'object' && parsed.error !== null
        ? parsed.error.message
        : typeof parsed.error === 'string'
          ? parsed.error
          : parsed.message;

    if (typeof message === 'string' && message.trim()) {
      return redactSecrets(message).slice(0, 500);
    }
  } catch {
    // Fall through to the redacted raw body.
  }

  return redactSecrets(bodyText).slice(0, 500);
}

function classifyStatus(
  status: number,
  headers: Headers,
  bodyText: string,
  forbiddenKind: ProviderErrorKind,
): { kind: ProviderErrorKind; retryable: boolean; resetAt?: string } {
  switch (status) {
    case 400:
      return { kind: 'bad_request', retryable: false };
    case 401:
      return { kind: 'auth', retryable: false };
    case 402:
      return { kind: 'quota_exhausted', retryable: false };
    case 403:
      return { kind: forbiddenKind, retryable: false };
    case 404:
      return { kind: 'model_not_found', retryable: false };
    case 408:
      return { kind: 'timeout', retryable: true };
    case 413:
      return { kind: 'context_overflow', retryable: false };
    case 429: {
      const dailyEvidence =
        /free[-_ ]?models?[-_ ]?per[-_ ]?day|per day|\bRPD\b|daily (?:request )?(?:limit|quota)/i.test(
          bodyText,
        );
      const minuteEvidence = /per minute|requests per minute|\bRPM\b|\bTPM\b/i.test(bodyText);

      if (dailyEvidence && !minuteEvidence) {
        return {
          kind: 'quota_exhausted',
          retryable: false,
          resetAt: resetAtFromDuration(headers.get('x-ratelimit-reset-requests')),
        };
      }

      return { kind: 'rate_limit', retryable: true };
    }
    case 498:
      return { kind: 'server', retryable: true };
    default:
      if (status >= 500) {
        return { kind: 'server', retryable: true };
      }
      return { kind: 'unknown', retryable: false };
  }
}

export function normalizeHttpError(input: {
  provider: ProviderId;
  model?: string;
  status: number;
  headers: Headers;
  bodyText: string;
  forbiddenKind?: ProviderErrorKind;
}): NormalizedProviderError {
  const classification = classifyStatus(
    input.status,
    input.headers,
    input.bodyText,
    input.forbiddenKind ?? 'auth',
  );
  const retryAfterMs = parseRetryAfter(input.headers.get('retry-after'));

  return {
    provider: input.provider,
    model: input.model,
    kind: classification.kind,
    httpStatus: input.status,
    retryAfterMs,
    resetAt: classification.resetAt,
    message: extractProviderMessage(input.bodyText),
    retryable: classification.retryable,
  };
}

export function makeProviderError(
  provider: ProviderId,
  kind: ProviderErrorKind,
  message: string,
  details: Partial<Omit<NormalizedProviderError, 'provider' | 'kind' | 'message'>> = {},
): NormalizedProviderError {
  return {
    provider,
    kind,
    message: redactSecrets(message).slice(0, 500),
    retryable: details.retryable ?? ['rate_limit', 'server', 'network', 'timeout'].includes(kind),
    ...details,
  };
}

export function cancelledError(provider: ProviderId, model?: string): NormalizedProviderError {
  return makeProviderError(provider, 'cancelled', 'The request was cancelled.', {
    model,
    retryable: false,
  });
}

export function timeoutError(provider: ProviderId, model?: string): NormalizedProviderError {
  return makeProviderError(provider, 'timeout', 'The provider request timed out.', {
    model,
    retryable: true,
  });
}

export function networkError(
  provider: ProviderId,
  model: string | undefined,
  message: string,
): NormalizedProviderError {
  return makeProviderError(provider, 'network', `Network request failed: ${message}`, {
    model,
    retryable: true,
  });
}

export function protocolError(
  provider: ProviderId,
  model: string | undefined,
  message: string,
): NormalizedProviderError {
  return makeProviderError(provider, 'server', `Malformed provider response: ${message}`, {
    model,
    retryable: true,
  });
}

export class ProviderRequestError extends SeekerError {
  readonly normalized: NormalizedProviderError;

  constructor(normalized: NormalizedProviderError) {
    super(normalized.message, 'provider');
    this.name = 'ProviderRequestError';
    this.normalized = normalized;
  }
}

export function normalizeTransportError(input: {
  provider: ProviderId;
  model?: string;
  error: unknown;
  forbiddenKind?: ProviderErrorKind;
}): NormalizedProviderError {
  if (input.error instanceof HttpResponseError) {
    return normalizeHttpError({
      provider: input.provider,
      model: input.model,
      status: input.error.status,
      headers: input.error.headers,
      bodyText: input.error.bodyText,
      forbiddenKind: input.forbiddenKind,
    });
  }

  if (input.error instanceof HttpTransportError) {
    if (input.error.kind === 'timeout') {
      return timeoutError(input.provider, input.model);
    }
    if (input.error.kind === 'cancelled') {
      return cancelledError(input.provider, input.model);
    }
    return networkError(input.provider, input.model, input.error.message);
  }

  if (input.error instanceof SeekerError) {
    if (input.error.code === 'timeout') {
      return timeoutError(input.provider, input.model);
    }
    if (input.error.code === 'cancelled') {
      return cancelledError(input.provider, input.model);
    }
    if (input.error.code === 'network') {
      return networkError(input.provider, input.model, input.error.message);
    }
    return makeProviderError(input.provider, 'unknown', input.error.message, {
      model: input.model,
    });
  }

  return makeProviderError(
    input.provider,
    'unknown',
    input.error instanceof Error ? input.error.message : String(input.error),
    { model: input.model },
  );
}

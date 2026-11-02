import { describe, expect, it } from 'vitest';
import {
  extractProviderMessage,
  normalizeHttpError,
  parseDurationMs,
  parseRetryAfter,
  resetAtFromDuration,
} from '../../src/providers/errors';

describe('parseRetryAfter', () => {
  it('parses seconds and HTTP dates', () => {
    expect(parseRetryAfter('12')).toBe(12_000);
    expect(
      parseRetryAfter('Wed, 21 Oct 2015 07:28:00 GMT', Date.parse('Wed, 21 Oct 2015 07:27:30 GMT')),
    ).toBe(30_000);
    expect(parseRetryAfter('invalid')).toBeUndefined();
  });
});

describe('parseDurationMs', () => {
  it('parses composite durations', () => {
    expect(parseDurationMs('1m2.5s')).toBe(62_500);
    expect(parseDurationMs('2h')).toBe(7_200_000);
    expect(parseDurationMs('250ms')).toBe(250);
    expect(parseDurationMs('1 minute')).toBeUndefined();
  });

  it('converts durations to reset timestamps', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    expect(resetAtFromDuration('1m', now)).toBe('2026-01-01T00:01:00.000Z');
  });
});

describe('extractProviderMessage', () => {
  it('extracts and redacts provider messages', () => {
    expect(
      extractProviderMessage(
        JSON.stringify({ error: { message: 'bad key sk-or-v1-abcdef1234567890' } }),
      ),
    ).toBe('bad key [REDACTED]');
  });

  it('falls back to raw text', () => {
    expect(extractProviderMessage('service unavailable')).toBe('service unavailable');
  });
});

describe('normalizeHttpError', () => {
  const base = {
    provider: 'openrouter' as const,
    model: 'test/model',
    bodyText: JSON.stringify({ error: { message: 'rate limited' } }),
  };

  it('maps authentication and model errors', () => {
    expect(normalizeHttpError({ ...base, status: 401, headers: new Headers() })).toMatchObject({
      kind: 'auth',
      retryable: false,
    });

    expect(normalizeHttpError({ ...base, status: 404, headers: new Headers() })).toMatchObject({
      kind: 'model_not_found',
      retryable: false,
    });
  });

  it('maps OpenRouter 403 to quota exhaustion', () => {
    expect(
      normalizeHttpError({
        ...base,
        status: 403,
        headers: new Headers(),
        forbiddenKind: 'quota_exhausted',
      }),
    ).toMatchObject({ kind: 'quota_exhausted', retryable: false });
  });

  it('distinguishes rate limits from daily exhaustion', () => {
    expect(normalizeHttpError({ ...base, status: 429, headers: new Headers() })).toMatchObject({
      kind: 'rate_limit',
      retryable: true,
    });

    const exhausted = normalizeHttpError({
      ...base,
      status: 429,
      headers: new Headers({ 'x-ratelimit-reset-requests': '1m' }),
      bodyText: JSON.stringify({
        error: { message: 'free-models-per-day limit reached' },
      }),
    });

    expect(exhausted).toMatchObject({
      kind: 'quota_exhausted',
      retryable: false,
    });
    expect(exhausted.resetAt !== undefined).toBe(true);
  });

  it('includes retry-after and server retryability', () => {
    const error = normalizeHttpError({
      ...base,
      status: 503,
      headers: new Headers({ 'retry-after': '5' }),
    });

    expect(error).toMatchObject({
      kind: 'server',
      retryable: true,
      retryAfterMs: 5_000,
    });
  });
});

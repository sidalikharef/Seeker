import { describe, expect, it } from 'vitest';
import { MemoryEventSink } from '../../../src/core/events';
import type { NormalizedProviderError } from '../../../src/providers/types';
import { QuotaLedger } from '../../../src/router/quota';

function error(overrides: Partial<NormalizedProviderError> = {}): NormalizedProviderError {
  return {
    provider: 'groq',
    model: 'model',
    kind: 'rate_limit',
    message: 'Rate limited',
    retryable: true,
    ...overrides,
  };
}

describe('quota ledger', () => {
  it('honors Retry-After and clears the limit after it expires', () => {
    let now = Date.UTC(2026, 10, 2, 12);
    const ledger = new QuotaLedger({ now: () => now });

    ledger.recordError('groq', error({ retryAfterMs: 5_000 }));

    expect(ledger.canUse('groq', 'model')).toMatchObject({
      allowed: false,
      availability: { state: 'rate_limited' },
    });
    expect(ledger.getAvailability('groq', 'model')?.until).toBe('2026-11-02T12:00:05.000Z');

    now += 5_001;
    expect(ledger.canUse('groq', 'model').allowed).toBe(true);
    expect(ledger.getAvailability('groq', 'model')).toBeUndefined();
  });

  it('uses bounded exponential backoff when Retry-After is absent', () => {
    let now = 0;
    const ledger = new QuotaLedger({
      now: () => now,
      baseBackoffMs: 1_000,
      maxBackoffMs: 3_000,
    });

    ledger.recordError('groq', error());
    expect(ledger.getAvailability('groq', 'model')?.retryAfterMs).toBe(1_000);

    now = 1_001;
    ledger.recordError('groq', error());
    expect(ledger.getAvailability('groq', 'model')?.retryAfterMs).toBe(2_000);

    now = 3_002;
    ledger.recordError('groq', error());
    expect(ledger.getAvailability('groq', 'model')?.retryAfterMs).toBe(3_000);
  });

  it('resets backoff after a success', () => {
    let now = 0;
    const ledger = new QuotaLedger({
      now: () => now,
      baseBackoffMs: 1_000,
      maxBackoffMs: 3_000,
    });

    ledger.recordError('groq', error());
    now = 1_001;
    ledger.recordError('groq', error());
    ledger.recordSuccess('groq', 'model');
    now = 3_002;
    ledger.recordError('groq', error());

    expect(ledger.getAvailability('groq', 'model')?.retryAfterMs).toBe(1_000);
  });

  it('pauses daily exhaustion until the reset time', () => {
    let now = Date.UTC(2026, 10, 2, 12);
    const ledger = new QuotaLedger({ now: () => now });
    const resetAt = '2026-11-03T00:00:00.000Z';

    ledger.recordError(
      'groq',
      error({ kind: 'quota_exhausted', resetAt, message: 'Daily quota exhausted' }),
    );

    expect(ledger.isExhausted('groq', 'model')).toBe(true);
    expect(ledger.canUse('groq', 'model')).toMatchObject({
      allowed: false,
      reason: expect.stringContaining(resetAt),
    });

    now = new Date(resetAt).getTime() + 1;
    expect(ledger.isExhausted('groq', 'model')).toBe(false);
    expect(ledger.canUse('groq', 'model').allowed).toBe(true);
  });

  it('applies provider-wide exhaustion to every model', () => {
    let now = 0;
    const ledger = new QuotaLedger({ now: () => now });

    ledger.markExhausted('groq', { resetsAt: '2026-11-03T00:00:00.000Z' });
    ledger.recordSuccess('groq', 'model');

    expect(ledger.canUse('groq', 'model').allowed).toBe(false);
    expect(ledger.canUse('groq', 'other-model').allowed).toBe(false);

    now = new Date('2026-11-03T00:00:01.000Z').getTime();
    expect(ledger.canUse('groq', 'model').allowed).toBe(true);
  });

  it('parses request and token header buckets', () => {
    let now = Date.UTC(2026, 10, 2, 12);
    const ledger = new QuotaLedger({ now: () => now });

    ledger.applyRateLimitMetadata(
      'groq',
      {
        source: 'headers',
        requests: {
          limit: 1_000,
          remaining: 900,
          resetAt: '2026-11-03T00:00:00.000Z',
        },
        tokens: { limit: 8_000, remaining: 7_000, resetAt: '2026-11-02T12:01:00.000Z' },
        capturedAt: '2026-11-02T12:00:00.000Z',
      },
      { modelId: 'model' },
    );

    expect(ledger.getQuota('groq', { modelId: 'model', scope: 'request' })[0]).toMatchObject({
      limit: 1_000,
      remaining: 900,
      used: 100,
      window: 'day',
      confidence: 'authoritative',
    });
    expect(ledger.getQuota('groq', { modelId: 'model', scope: 'token' })[0]).toMatchObject({
      limit: 8_000,
      remaining: 7_000,
      used: 1_000,
      window: 'minute',
    });

    now += 1;
    expect(ledger.canUse('groq', 'model').allowed).toBe(true);
  });

  it('marks a zero daily request bucket as exhausted', () => {
    const now = Date.UTC(2026, 10, 2, 12);
    const ledger = new QuotaLedger({ now: () => now });

    ledger.applyRateLimitMetadata('groq', {
      source: 'headers',
      requests: {
        limit: 50,
        remaining: 0,
        resetAt: '2026-11-03T00:00:00.000Z',
      },
      capturedAt: new Date(now).toISOString(),
    });

    expect(ledger.isExhausted('groq', 'model')).toBe(true);
    expect(ledger.getAvailability('groq')?.until).toBe('2026-11-03T00:00:00.000Z');
  });

  it('marks a zero token bucket as a temporary rate limit', () => {
    const now = Date.UTC(2026, 10, 2, 12);
    const ledger = new QuotaLedger({ now: () => now });

    ledger.applyRateLimitMetadata('groq', {
      source: 'headers',
      tokens: {
        limit: 8_000,
        remaining: 0,
        resetAt: '2026-11-02T12:01:00.000Z',
      },
      capturedAt: new Date(now).toISOString(),
    });

    expect(ledger.canUse('groq', 'model')).toMatchObject({
      allowed: false,
      availability: { state: 'rate_limited' },
    });
    expect(ledger.getEffectiveAvailability('groq', 'model')?.retryAfterMs).toBe(60_000);
  });

  it('reconciles OpenRouter daily request status at the next UTC midnight', () => {
    const now = Date.UTC(2026, 10, 2, 12);
    const ledger = new QuotaLedger({ now: () => now });

    ledger.reconcileProviderKeyStatus('openrouter', {
      provider: 'openrouter',
      freeModelDailyRequests: { used: 50, limit: 50, remaining: 0 },
      capturedAt: new Date(now).toISOString(),
    });

    expect(ledger.getQuota('openrouter', { scope: 'request', window: 'day' })[0]).toMatchObject({
      limit: 50,
      remaining: 0,
      used: 50,
      source: 'endpoint',
    });
    expect(ledger.canUse('openrouter', 'free-model')).toMatchObject({
      allowed: false,
      availability: {
        state: 'exhausted',
        until: '2026-11-03T00:00:00.000Z',
      },
    });
  });

  it('does not overwrite authoritative quota with estimates', () => {
    const now = 0;
    const ledger = new QuotaLedger({ now: () => now });
    ledger.updateQuota({
      provider: 'groq',
      scope: 'request',
      window: 'day',
      limit: 1_000,
      remaining: 500,
      source: 'header',
      confidence: 'authoritative',
      updatedAt: new Date(now).toISOString(),
    });
    ledger.updateQuota({
      provider: 'groq',
      scope: 'request',
      window: 'day',
      limit: 1_000,
      remaining: 100,
      source: 'estimated',
      confidence: 'estimated',
      updatedAt: new Date(now).toISOString(),
    });

    expect(ledger.getQuota('groq', { scope: 'request' })[0].remaining).toBe(500);
  });

  it('moves repeated server failures to unavailable', () => {
    const ledger = new QuotaLedger({ now: () => 0 });

    expect(ledger.recordError('groq', error({ kind: 'server' }))?.state).toBe('degraded');
    expect(ledger.recordError('groq', error({ kind: 'network' }))?.state).toBe('degraded');
    expect(ledger.recordError('groq', error({ kind: 'timeout' }))?.state).toBe('unavailable');
    expect(ledger.canUse('groq', 'model').allowed).toBe(false);
  });

  it('marks authentication failures as requiring a key', () => {
    const ledger = new QuotaLedger({ now: () => 0 });
    ledger.recordError('groq', error({ kind: 'auth', message: 'Invalid API key' }));

    expect(ledger.canUse('groq', 'model')).toMatchObject({
      allowed: false,
      reason: 'Invalid API key',
      availability: { state: 'auth_required' },
    });
  });

  it('emits quota warnings for limits and exhaustion', () => {
    const sink = new MemoryEventSink();
    const ledger = new QuotaLedger({ now: () => 0, sink });

    ledger.recordError('groq', error({ retryAfterMs: 1_000 }));
    ledger.recordError(
      'groq',
      error({ kind: 'quota_exhausted', resetAt: '2026-11-03T00:00:00.000Z' }),
    );

    expect(sink.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'quota.warning',
          state: 'rate_limited',
          provider: 'groq',
        }),
        expect.objectContaining({
          type: 'quota.warning',
          state: 'exhausted',
          provider: 'groq',
        }),
      ]),
    );
  });

  it('clears all records or a single provider', () => {
    const ledger = new QuotaLedger({ now: () => 0 });
    ledger.markRateLimited('groq', { modelId: 'model', retryAfterMs: 1_000 });
    ledger.markRateLimited('openrouter', { modelId: 'model', retryAfterMs: 1_000 });

    ledger.clear('groq');
    expect(ledger.getAvailability('groq', 'model')).toBeUndefined();
    expect(ledger.getAvailability('openrouter', 'model')).toBeDefined();

    ledger.clear();
    expect(ledger.getAvailability('openrouter', 'model')).toBeUndefined();
  });
});

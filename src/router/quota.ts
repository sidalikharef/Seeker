import type { EventSink } from '../core/events';
import type {
  NormalizedProviderError,
  ProviderId,
  ProviderKeyStatus,
  RateLimitMetadata,
} from '../providers/types';

export type QuotaScope = 'request' | 'token' | 'credit';
export type QuotaWindow = 'minute' | 'hour' | 'day' | 'month' | 'lifetime';
export type QuotaSource = 'header' | 'endpoint' | 'estimated' | 'static';
export type QuotaConfidence = 'authoritative' | 'estimated' | 'unknown';

export type AvailabilityState =
  | 'unknown'
  | 'healthy'
  | 'degraded'
  | 'rate_limited'
  | 'exhausted'
  | 'auth_required'
  | 'unavailable';

export interface QuotaRecord {
  provider: ProviderId;
  modelId?: string;
  scope: QuotaScope;
  window: QuotaWindow;
  limit?: number;
  remaining?: number;
  used?: number;
  resetsAt?: string;
  source: QuotaSource;
  confidence: QuotaConfidence;
  updatedAt: string;
}

export interface AvailabilityRecord {
  provider: ProviderId;
  modelId?: string;
  state: AvailabilityState;
  until?: string;
  retryAfterMs?: number;
  updatedAt: string;
  detail?: string;
}

export interface QuotaCheck {
  allowed: boolean;
  reason?: string;
  availability?: AvailabilityRecord;
}

export interface QuotaLedgerOptions {
  now?: () => number;
  sink?: EventSink;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

function nowIso(now: number): string {
  return new Date(now).toISOString();
}

function key(provider: ProviderId, modelId?: string): string {
  return `${provider}:${modelId ?? '*'}`;
}

function recordKey(record: QuotaRecord): string {
  return `${record.provider}:${record.modelId ?? '*'}:${record.scope}:${record.window}`;
}

function nextUtcMidnight(now: number): string {
  const date = new Date(now);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1),
  ).toISOString();
}

function isExpired(record: AvailabilityRecord, now: number): boolean {
  return record.until !== undefined && new Date(record.until).getTime() <= now;
}

export class QuotaLedger {
  private readonly quotas = new Map<string, QuotaRecord>();
  private readonly availability = new Map<string, AvailabilityRecord>();
  private readonly failures = new Map<string, number>();
  private readonly now: () => number;
  private readonly sink?: EventSink;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(options: QuotaLedgerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.sink = options.sink;
    this.baseBackoffMs = options.baseBackoffMs ?? 1_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 60_000;
  }

  private emit(event: Parameters<EventSink['emit']>[0]): void {
    try {
      this.sink?.emit(event);
    } catch {
      // Telemetry must never break routing.
    }
  }

  private setAvailability(record: AvailabilityRecord): AvailabilityRecord {
    this.availability.set(key(record.provider, record.modelId), record);
    return { ...record };
  }

  updateQuota(record: QuotaRecord): void {
    const existing = this.quotas.get(recordKey(record));
    if (existing?.confidence === 'authoritative' && record.confidence === 'estimated') {
      return;
    }
    this.quotas.set(recordKey(record), { ...record });
  }

  getQuota(
    provider: ProviderId,
    options: { modelId?: string; scope?: QuotaScope; window?: QuotaWindow } = {},
  ): QuotaRecord[] {
    const result: QuotaRecord[] = [];
    for (const record of this.quotas.values()) {
      if (record.provider !== provider) {
        continue;
      }
      if (options.modelId !== undefined && record.modelId !== options.modelId) {
        continue;
      }
      if (options.scope !== undefined && record.scope !== options.scope) {
        continue;
      }
      if (options.window !== undefined && record.window !== options.window) {
        continue;
      }
      result.push({ ...record });
    }
    return result;
  }

  getAvailability(provider: ProviderId, modelId?: string): AvailabilityRecord | undefined {
    const record = this.availability.get(key(provider, modelId));
    return record ? { ...record } : undefined;
  }

  getEffectiveAvailability(provider: ProviderId, modelId?: string): AvailabilityRecord | undefined {
    let providerRecord = this.availability.get(key(provider));
    if (providerRecord && isExpired(providerRecord, this.now())) {
      this.availability.delete(key(provider));
      providerRecord = undefined;
    } else if (
      providerRecord &&
      ['auth_required', 'exhausted', 'unavailable'].includes(providerRecord.state)
    ) {
      return { ...providerRecord };
    }

    let modelRecord = this.availability.get(key(provider, modelId));
    if (modelRecord && isExpired(modelRecord, this.now())) {
      this.availability.delete(key(provider, modelId));
      modelRecord = undefined;
    }

    return modelRecord ? { ...modelRecord } : providerRecord ? { ...providerRecord } : undefined;
  }

  markExhausted(
    provider: ProviderId,
    options: { modelId?: string; resetsAt?: string; detail?: string } = {},
  ): AvailabilityRecord {
    return this.setAvailability({
      provider,
      modelId: options.modelId,
      state: 'exhausted',
      until: options.resetsAt,
      updatedAt: nowIso(this.now()),
      detail: options.detail,
    });
  }

  markRateLimited(
    provider: ProviderId,
    options: { modelId?: string; retryAfterMs?: number; detail?: string } = {},
  ): AvailabilityRecord {
    const current = this.now();
    const retryAfterMs =
      options.retryAfterMs !== undefined ? Math.max(0, options.retryAfterMs) : undefined;
    const record = this.setAvailability({
      provider,
      modelId: options.modelId,
      state: 'rate_limited',
      retryAfterMs,
      until:
        retryAfterMs === undefined ? undefined : new Date(current + retryAfterMs).toISOString(),
      updatedAt: nowIso(current),
      detail: options.detail,
    });
    this.emit({
      type: 'quota.warning',
      provider,
      modelId: options.modelId,
      state: record.state,
      message: record.detail ?? 'Provider rate limit reached.',
      resetAt: record.until,
      at: record.updatedAt,
    });
    return record;
  }

  markDegraded(
    provider: ProviderId,
    options: { modelId?: string; detail?: string } = {},
  ): AvailabilityRecord {
    return this.setAvailability({
      provider,
      modelId: options.modelId,
      state: 'degraded',
      updatedAt: nowIso(this.now()),
      detail: options.detail,
    });
  }

  markAuthRequired(
    provider: ProviderId,
    options: { modelId?: string; detail?: string } = {},
  ): AvailabilityRecord {
    return this.setAvailability({
      provider,
      modelId: options.modelId,
      state: 'auth_required',
      updatedAt: nowIso(this.now()),
      detail: options.detail,
    });
  }

  markUnavailable(
    provider: ProviderId,
    options: { modelId?: string; detail?: string } = {},
  ): AvailabilityRecord {
    return this.setAvailability({
      provider,
      modelId: options.modelId,
      state: 'unavailable',
      updatedAt: nowIso(this.now()),
      detail: options.detail,
    });
  }

  markHealthy(provider: ProviderId, options: { modelId?: string } = {}): AvailabilityRecord {
    this.failures.delete(key(provider, options.modelId));
    return this.setAvailability({
      provider,
      modelId: options.modelId,
      state: 'healthy',
      updatedAt: nowIso(this.now()),
    });
  }

  recordSuccess(provider: ProviderId, modelId?: string): AvailabilityRecord {
    return this.markHealthy(provider, { modelId });
  }

  recordError(
    provider: ProviderId,
    error: NormalizedProviderError,
    options: { modelId?: string } = {},
  ): AvailabilityRecord | undefined {
    const modelId = options.modelId ?? error.model;
    const failureKey = key(provider, modelId);
    const current = this.now();

    switch (error.kind) {
      case 'auth':
        return this.markAuthRequired(provider, {
          modelId,
          detail: error.message,
        });
      case 'quota_exhausted': {
        const resetsAt =
          error.resetAt ??
          (error.retryAfterMs !== undefined
            ? new Date(current + error.retryAfterMs).toISOString()
            : undefined);
        const record = this.markExhausted(provider, {
          modelId,
          resetsAt,
          detail: error.message,
        });
        this.emit({
          type: 'quota.warning',
          provider,
          modelId,
          state: record.state,
          message: record.detail ?? 'Free quota exhausted.',
          resetAt: record.until,
          at: record.updatedAt,
        });
        return record;
      }
      case 'rate_limit': {
        const count = (this.failures.get(failureKey) ?? 0) + 1;
        this.failures.set(failureKey, count);
        const backoff = Math.min(
          this.maxBackoffMs,
          this.baseBackoffMs * 2 ** Math.max(0, count - 1),
        );
        return this.markRateLimited(provider, {
          modelId,
          retryAfterMs: error.retryAfterMs ?? backoff,
          detail: error.message,
        });
      }
      case 'server':
      case 'network':
      case 'timeout': {
        const count = (this.failures.get(failureKey) ?? 0) + 1;
        this.failures.set(failureKey, count);
        if (count >= 3) {
          return this.markUnavailable(provider, {
            modelId,
            detail: error.message,
          });
        }
        return this.markDegraded(provider, {
          modelId,
          detail: error.message,
        });
      }
      case 'model_not_found':
        return this.markUnavailable(provider, {
          modelId,
          detail: error.message,
        });
      default:
        return undefined;
    }
  }

  applyRateLimitMetadata(
    provider: ProviderId,
    metadata: RateLimitMetadata,
    options: {
      modelId?: string;
      requestWindow?: QuotaWindow;
      tokenWindow?: QuotaWindow;
    } = {},
  ): void {
    const current = this.now();
    const updatedAt = nowIso(current);
    const buckets: Array<{
      scope: QuotaScope;
      window: QuotaWindow;
      limit?: number;
      remaining?: number;
      resetsAt?: string;
    }> = [];

    if (metadata.requests) {
      buckets.push({
        scope: 'request',
        window: options.requestWindow ?? 'day',
        limit: metadata.requests.limit,
        remaining: metadata.requests.remaining,
        resetsAt: metadata.requests.resetAt,
      });
    }
    if (metadata.tokens) {
      buckets.push({
        scope: 'token',
        window: options.tokenWindow ?? 'minute',
        limit: metadata.tokens.limit,
        remaining: metadata.tokens.remaining,
        resetsAt: metadata.tokens.resetAt,
      });
    }

    let exhausted: (typeof buckets)[number] | undefined;
    let rateLimited: (typeof buckets)[number] | undefined;

    for (const bucket of buckets) {
      const used =
        bucket.limit !== undefined && bucket.remaining !== undefined
          ? Math.max(0, bucket.limit - bucket.remaining)
          : undefined;
      this.updateQuota({
        provider,
        modelId: options.modelId,
        scope: bucket.scope,
        window: bucket.window,
        limit: bucket.limit,
        remaining: bucket.remaining,
        used,
        resetsAt: bucket.resetsAt,
        source: 'header',
        confidence: 'authoritative',
        updatedAt,
      });

      if (bucket.remaining === 0) {
        if (['day', 'month', 'lifetime'].includes(bucket.window)) {
          exhausted = bucket;
        } else {
          rateLimited = bucket;
        }
      }
    }

    if (exhausted) {
      const record = this.markExhausted(provider, {
        modelId: options.modelId,
        resetsAt: exhausted.resetsAt,
        detail: `Free ${exhausted.scope} quota exhausted.`,
      });
      this.emit({
        type: 'quota.warning',
        provider,
        modelId: options.modelId,
        state: record.state,
        message: record.detail ?? 'Free quota exhausted.',
        resetAt: record.until,
        at: record.updatedAt,
      });
    } else if (rateLimited) {
      const retryAfterMs =
        metadata.retryAfterMs ??
        (rateLimited.resetsAt
          ? Math.max(0, new Date(rateLimited.resetsAt).getTime() - current)
          : this.baseBackoffMs);
      this.markRateLimited(provider, {
        modelId: options.modelId,
        retryAfterMs,
        detail: `Temporary ${rateLimited.scope} rate limit reached.`,
      });
    }
  }

  reconcileProviderKeyStatus(provider: ProviderId, status: ProviderKeyStatus): void {
    const daily = status.freeModelDailyRequests;
    if (!daily) {
      return;
    }

    const current = this.now();
    const remaining = daily.remaining;
    this.updateQuota({
      provider,
      scope: 'request',
      window: 'day',
      limit: daily.limit,
      remaining,
      used: daily.used,
      source: 'endpoint',
      confidence: 'authoritative',
      updatedAt: nowIso(current),
    });

    if (remaining === 0) {
      const record = this.markExhausted(provider, {
        resetsAt: nextUtcMidnight(current),
        detail: 'Free daily request quota exhausted.',
      });
      this.emit({
        type: 'quota.warning',
        provider,
        state: record.state,
        message: record.detail ?? 'Free daily request quota exhausted.',
        resetAt: record.until,
        at: record.updatedAt,
      });
    }
  }

  isExhausted(provider: ProviderId, modelId?: string): boolean {
    const record = this.getEffectiveAvailability(provider, modelId);
    return record?.state === 'exhausted' && !isExpired(record, this.now());
  }

  canUse(provider: ProviderId, modelId?: string): QuotaCheck {
    const record = this.getEffectiveAvailability(provider, modelId);
    if (!record) {
      return { allowed: true };
    }

    if (record.state === 'exhausted') {
      return {
        allowed: false,
        reason: record.until
          ? `Free quota exhausted; resets ${record.until}.`
          : 'Free quota exhausted.',
        availability: record,
      };
    }

    if (record.state === 'rate_limited') {
      return {
        allowed: false,
        reason: record.until
          ? `Rate limited until ${record.until}.`
          : 'Rate limited; try again later.',
        availability: record,
      };
    }

    if (record.state === 'auth_required') {
      return {
        allowed: false,
        reason: record.detail ?? 'Provider requires authentication.',
        availability: record,
      };
    }

    if (record.state === 'unavailable') {
      return {
        allowed: false,
        reason: record.detail ?? 'Provider is unavailable.',
        availability: record,
      };
    }

    return { allowed: true, availability: record };
  }

  clear(provider?: ProviderId): void {
    if (!provider) {
      this.quotas.clear();
      this.availability.clear();
      this.failures.clear();
      return;
    }

    for (const keyName of this.quotas.keys()) {
      if (keyName.startsWith(`${provider}:`)) {
        this.quotas.delete(keyName);
      }
    }
    for (const keyName of this.availability.keys()) {
      if (keyName.startsWith(`${provider}:`)) {
        this.availability.delete(keyName);
      }
    }
    for (const keyName of this.failures.keys()) {
      if (keyName.startsWith(`${provider}:`)) {
        this.failures.delete(keyName);
      }
    }
  }
}

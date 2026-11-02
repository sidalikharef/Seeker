import type { ModelDescriptor, ProviderAdapter, ProviderId } from './types';

export const DEFAULT_MODEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface CacheEntry {
  models: ModelDescriptor[];
  fetchedAt: number;
}

export interface ModelCatalogOptions {
  ttlMs?: number;
  now?: () => number;
}

export class ModelCatalog {
  private readonly adapters: Partial<Record<ProviderId, ProviderAdapter>>;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<ProviderId, CacheEntry>();
  private readonly inflight = new Map<ProviderId, Promise<ModelDescriptor[]>>();

  constructor(
    adapters: Partial<Record<ProviderId, ProviderAdapter>>,
    options: ModelCatalogOptions = {},
  ) {
    this.adapters = adapters;
    this.ttlMs = options.ttlMs ?? DEFAULT_MODEL_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async get(provider: ProviderId, options: { force?: boolean } = {}): Promise<ModelDescriptor[]> {
    const cached = this.cache.get(provider);
    if (!options.force && cached && this.now() - cached.fetchedAt < this.ttlMs) {
      return cached.models;
    }
    return this.refresh(provider);
  }

  async refresh(provider: ProviderId): Promise<ModelDescriptor[]> {
    const existing = this.inflight.get(provider);
    if (existing) {
      return existing;
    }

    const adapter = this.adapters[provider];
    if (!adapter) {
      throw new Error(`Provider "${provider}" is not configured.`);
    }

    const request = adapter
      .listModels()
      .then((models) => {
        this.cache.set(provider, { models, fetchedAt: this.now() });
        return models;
      })
      .finally(() => {
        this.inflight.delete(provider);
      });

    this.inflight.set(provider, request);
    return request;
  }

  getCached(provider: ProviderId): readonly ModelDescriptor[] | undefined {
    return this.cache.get(provider)?.models;
  }

  clear(provider?: ProviderId): void {
    if (provider) {
      this.cache.delete(provider);
      return;
    }
    this.cache.clear();
  }
}

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_CACHE_TTL_MS, ModelCatalog } from '../../src/providers/model-catalog';
import type { ModelDescriptor, ProviderAdapter } from '../../src/providers/types';

function model(id: string): ModelDescriptor {
  return {
    provider: 'openrouter',
    modelId: id,
    displayName: id,
    freeTierClass: 'free-tier',
    capabilities: {
      supportsStreaming: true,
      supportsTools: 'unknown',
      supportsParallelTools: 'unknown',
      supportsStructuredOutput: 'unknown',
      supportsImages: 'unknown',
      supportsReasoning: 'unknown',
      supportsPromptCaching: 'unknown',
    },
    source: 'provider-api',
  };
}

function adapterWith(listModels: ProviderAdapter['listModels']): ProviderAdapter {
  return {
    id: 'openrouter',
    baseUrl: 'https://example.test',
    freeTierClass: 'free-tier',
    listModels,
    streamChat: () => (async function* () {})(),
    healthCheck: async () => ({
      provider: 'openrouter',
      state: 'healthy',
      checkedAt: new Date().toISOString(),
    }),
  };
}

describe('ModelCatalog', () => {
  it('caches discovery for six hours by default', async () => {
    let now = 1_000;
    const listModels = vi.fn(async () => [model('a')]);
    const catalog = new ModelCatalog(
      { openrouter: adapterWith(listModels) },
      {
        now: () => now,
      },
    );

    expect(await catalog.get('openrouter')).toHaveLength(1);
    now += DEFAULT_MODEL_CACHE_TTL_MS - 1;
    expect(await catalog.get('openrouter')).toHaveLength(1);
    expect(listModels).toHaveBeenCalledTimes(1);

    now += 2;
    expect(await catalog.get('openrouter')).toHaveLength(1);
    expect(listModels).toHaveBeenCalledTimes(2);
  });

  it('forces refresh and exposes cached data', async () => {
    let now = 0;
    const listModels = vi.fn(async () => [model(`m${now}`)]);
    const catalog = new ModelCatalog(
      { openrouter: adapterWith(listModels) },
      {
        now: () => now,
      },
    );

    await catalog.get('openrouter');
    now = 10;
    const refreshed = await catalog.refresh('openrouter');

    expect(refreshed[0].modelId).toBe('m10');
    expect(catalog.getCached('openrouter')?.[0].modelId).toBe('m10');
    expect(listModels).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent refreshes', async () => {
    const listModels = vi.fn(async () => [model('a')]);
    const catalog = new ModelCatalog({ openrouter: adapterWith(listModels) });

    await Promise.all([
      catalog.refresh('openrouter'),
      catalog.refresh('openrouter'),
      catalog.get('openrouter', { force: true }),
    ]);

    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it('clears cache entries and rejects unknown providers', async () => {
    const catalog = new ModelCatalog({});
    await expect(catalog.refresh('groq')).rejects.toThrow('not configured');
    expect(catalog.getCached('openrouter')).toBeUndefined();
    catalog.clear();
  });
});

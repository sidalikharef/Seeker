import { describe, expect, it } from 'vitest';
import { ModelRegistry, SEEDED_REGISTRY_ENTRIES } from '../../../src/router/registry';
import { capabilities, descriptor, registryEntry } from './fixtures';

describe('model registry', () => {
  it('ships the documented Groq seeds', () => {
    const registry = new ModelRegistry();
    const ids = registry.list('groq').map((entry) => entry.modelId);

    expect(ids).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']);
    expect(registry.get('groq', 'qwen/qwen3.8-27b')).toMatchObject({
      freeTierClass: 'free-tier',
      capabilities: {
        supportsTools: true,
        supportsParallelTools: true,
        contextWindow: 131_072,
      },
    });
  });

  it('lets discovery decide which models exist for a provider', () => {
    const registry = new ModelRegistry();
    registry.applyProviderDiscovery('groq', [descriptor('new/model')]);

    expect(registry.list('groq')).toHaveLength(1);
    expect(registry.get('groq', 'new/model')?.modelId).toBe('new/model');
    expect(registry.get('groq', 'openai/gpt-oss-120b')).toBeUndefined();
  });

  it('keeps verified static capabilities over conflicting discovery', () => {
    const registry = new ModelRegistry();
    registry.applyProviderDiscovery('groq', [
      descriptor('openai/gpt-oss-120b', {
        capabilities: capabilities({
          supportsTools: false,
          supportsStructuredOutput: false,
          contextWindow: 8_000,
        }),
      }),
    ]);

    const entry = registry.get('groq', 'openai/gpt-oss-120b');
    expect(entry?.capabilities.supportsTools).toBe(true);
    expect(entry?.capabilities.supportsStructuredOutput).toBe(true);
    expect(entry?.capabilities.contextWindow).toBe(131_072);
    expect(registry.getConflicts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'supportsTools', staticValue: true, discovered: false }),
        expect.objectContaining({
          field: 'contextWindow',
          staticValue: 131_072,
          discovered: 8_000,
        }),
      ]),
    );
  });

  it('does not infer unknown discovered capabilities', () => {
    const registry = new ModelRegistry([]);
    registry.applyProviderDiscovery('openrouter', [
      descriptor('vendor/model:free', {
        provider: 'openrouter',
        capabilities: capabilities({
          supportsTools: 'unknown',
          supportsStructuredOutput: 'unknown',
          supportsImages: 'unknown',
        }),
      }),
    ]);

    const entry = registry.get('openrouter', 'vendor/model:free');
    expect(entry?.capabilities.supportsTools).toBe('unknown');
    expect(entry?.capabilities.supportsStructuredOutput).toBe('unknown');
    expect(entry?.freeTierClass).toBe('free-tier');
  });

  it('applies user overrides after merging', () => {
    const registry = new ModelRegistry([registryEntry('model')]);
    registry.setOverride({
      provider: 'groq',
      modelId: 'model',
      freeTierClass: 'local',
      capabilities: { supportsTools: false },
      tags: ['fast'],
    });

    expect(registry.get('groq', 'model')).toMatchObject({
      freeTierClass: 'local',
      capabilities: { supportsTools: false },
      tags: ['fast'],
    });
  });

  it('returns defensive copies', () => {
    const registry = new ModelRegistry([registryEntry('model', { tags: ['coding'] })]);
    const entry = registry.get('groq', 'model');
    entry?.tags.push('reasoning');

    expect(registry.get('groq', 'model')?.tags).toEqual(['coding']);
  });

  it('records pricing conflicts without discarding discovery pricing', () => {
    const staticEntry = registryEntry('model', {
      pricing: { inputPerMTok: 0, outputPerMTok: 0, currency: 'USD' },
    });
    const registry = new ModelRegistry([staticEntry]);
    registry.applyProviderDiscovery('groq', [
      descriptor('model', {
        pricing: { inputPerMTok: 1, outputPerMTok: 2, currency: 'USD' },
      }),
    ]);

    expect(registry.get('groq', 'model')?.pricing).toEqual({
      inputPerMTok: 1,
      outputPerMTok: 2,
      currency: 'USD',
    });
    expect(registry.getConflicts()).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'pricing' })]),
    );
  });

  it('clears conflicts on request', () => {
    const registry = new ModelRegistry([registryEntry('model')]);
    registry.applyProviderDiscovery('groq', [
      descriptor('model', { capabilities: capabilities({ supportsTools: false }) }),
    ]);
    registry.list();
    expect(registry.getConflicts().length).toBeGreaterThan(0);

    registry.clearConflicts();
    expect(registry.getConflicts()).toEqual([]);
  });

  it('exposes seeded entries as immutable data', () => {
    expect(SEEDED_REGISTRY_ENTRIES.length).toBeGreaterThan(0);
  });
});

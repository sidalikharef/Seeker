import { describe, expect, it } from 'vitest';
import { MemoryEventSink } from '../../../src/core/events';
import { QuotaLedger } from '../../../src/router/quota';
import { ModelRegistry } from '../../../src/router/registry';
import { ModelRouter, type RoutingRequest } from '../../../src/router/router';
import { capabilities, registryEntry } from './fixtures';

function request(overrides: Partial<RoutingRequest> = {}): RoutingRequest {
  return {
    taskKind: 'code',
    required: { tools: true, streaming: true },
    policy: 'free-first',
    ...overrides,
  };
}

describe('model router', () => {
  it('free-first prefers a free capable model over an allowed paid model', () => {
    const registry = new ModelRegistry([
      registryEntry('paid-model', {
        freeTierClass: 'paid',
        pricing: { inputPerMTok: 1, outputPerMTok: 2, currency: 'USD' },
        capabilities: capabilities({ supportsReasoning: true }),
      }),
      registryEntry('free-model'),
    ]);
    const router = new ModelRouter({ registry, quota: new QuotaLedger() });

    const result = router.select(request({ allowPaid: true, maxCostUsd: 10 }));

    expect(result.decision).toMatchObject({
      provider: 'groq',
      modelId: 'free-model',
    });
    expect(result.decision?.score.freeTier).toBe(25);
  });

  it('cannot select a paid model with default settings', () => {
    const registry = new ModelRegistry([
      registryEntry('paid-model', {
        freeTierClass: 'paid',
        pricing: { inputPerMTok: 1, outputPerMTok: 2, currency: 'USD' },
      }),
    ]);
    const router = new ModelRouter({ registry, quota: new QuotaLedger() });

    const result = router.select(request());

    expect(result.decision).toBeUndefined();
    expect(result.rejected[0]?.reason).toContain('paid fallback is disabled');
  });

  it('allows paid models only within an explicit non-zero cost cap', () => {
    const registry = new ModelRegistry([
      registryEntry('paid-model', {
        freeTierClass: 'paid',
        pricing: { inputPerMTok: 1, outputPerMTok: 2, currency: 'USD' },
      }),
    ]);

    const allowed = new ModelRouter({ registry, quota: new QuotaLedger() }).select(
      request({ allowPaid: true, maxCostUsd: 10 }),
    );
    expect(allowed.decision?.modelId).toBe('paid-model');

    const tooExpensive = new ModelRouter({ registry, quota: new QuotaLedger() }).select(
      request({ allowPaid: true, maxCostUsd: 1 }),
    );
    expect(tooExpensive.decision).toBeUndefined();
    expect(tooExpensive.rejected[0]?.reason).toContain('exceeds maxCostUsd');

    const zeroCap = new ModelRouter({ registry, quota: new QuotaLedger() }).select(
      request({ allowPaid: true, maxCostUsd: 0 }),
    );
    expect(zeroCap.decision).toBeUndefined();
    expect(zeroCap.rejected[0]?.reason).toContain('maxCostUsd is 0');
  });

  it('rejects paid models with unknown pricing', () => {
    const registry = new ModelRegistry([registryEntry('paid-model', { freeTierClass: 'paid' })]);
    const router = new ModelRouter({ registry, quota: new QuotaLedger() });

    const result = router.select(request({ allowPaid: true, maxCostUsd: 10 }));

    expect(result.decision).toBeUndefined();
    expect(result.rejected[0]?.reason).toContain('unknown pricing');
  });

  it('never satisfies a capability requirement with unknown', () => {
    const registry = new ModelRegistry([
      registryEntry('unknown-tools', {
        capabilities: capabilities({ supportsTools: 'unknown' }),
      }),
    ]);
    const router = new ModelRouter({ registry, quota: new QuotaLedger() });

    const result = router.select(request());

    expect(result.decision).toBeUndefined();
    expect(result.rejected[0]?.reason).toContain('tool calling is not declared');
  });

  it('rejects unsupported or too-small capabilities with specific reasons', () => {
    const noStreamRegistry = new ModelRegistry([
      registryEntry('no-stream', {
        capabilities: capabilities({ supportsStreaming: false }),
      }),
    ]);
    const noStream = new ModelRouter({
      registry: noStreamRegistry,
      quota: new QuotaLedger(),
    }).select(request({ required: { tools: true, streaming: true } }));
    expect(noStream.decision).toBeUndefined();
    expect(noStream.rejected[0]?.reason).toBe('streaming is not supported');

    const contextRegistry = new ModelRegistry([
      registryEntry('adequate', {
        capabilities: capabilities({ contextWindow: 131_072 }),
      }),
      registryEntry('small-context', {
        capabilities: capabilities({ contextWindow: 8_000 }),
      }),
    ]);
    const contextRouter = new ModelRouter({
      registry: contextRegistry,
      quota: new QuotaLedger(),
    });
    const context = contextRouter.select(
      request({
        required: { tools: true, streaming: true, minContextWindow: 128_000 },
      }),
    );
    expect(context.decision?.modelId).toBe('adequate');
    expect(context.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: 'small-context',
          reason: 'context window 8000 is below required 128000',
        }),
      ]),
    );

    const unknownContext = new ModelRegistry([
      registryEntry('unknown-context', {
        capabilities: capabilities({ contextWindow: undefined }),
      }),
    ]);
    const unknownResult = new ModelRouter({
      registry: unknownContext,
      quota: new QuotaLedger(),
    }).select(
      request({
        required: { tools: true, streaming: true, minContextWindow: 128_000 },
      }),
    );
    expect(unknownResult.rejected[0]?.reason).toContain('context window is not declared');
  });

  it('rejects a documented structured-output and tools conflict', () => {
    const registry = new ModelRegistry();
    const router = new ModelRouter({ registry, quota: new QuotaLedger() });

    const result = router.select(
      request({
        required: { tools: true, streaming: true, structuredOutput: true },
      }),
    );

    expect(result.decision?.modelId).toBe('qwen/qwen3.8-27b');
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: 'openai/gpt-oss-120b',
          reason: 'structured output cannot be combined with tools or streaming for this model',
        }),
        expect.objectContaining({ modelId: 'openai/gpt-oss-20b' }),
      ]),
    );
  });

  it('manual policy selects exactly the configured model', () => {
    const registry = new ModelRegistry([registryEntry('a'), registryEntry('b')]);
    const router = new ModelRouter({ registry, quota: new QuotaLedger() });

    const result = router.select(request({ policy: 'manual', preferredModel: 'b' }));

    expect(result.decision?.modelId).toBe('b');
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: 'a',
          reason: 'manual policy selected a different model',
        }),
      ]),
    );
  });

  it('manual policy explains a missing or unavailable target', () => {
    const registry = new ModelRegistry([registryEntry('a')]);
    const quota = new QuotaLedger({ now: () => 0 });
    const router = new ModelRouter({ registry, quota });

    const missing = router.select(request({ policy: 'manual' }));
    expect(missing.decision).toBeUndefined();
    expect(missing.rejected[0]?.reason).toContain('requires preferredModel');

    const absent = router.select(request({ policy: 'manual', preferredModel: 'missing' }));
    expect(absent.decision).toBeUndefined();
    expect(absent.rejected[0]?.reason).toContain('is not in the registry');

    quota.markExhausted('groq', {
      modelId: 'a',
      resetsAt: '2026-11-03T00:00:00.000Z',
    });
    const exhausted = router.select(request({ policy: 'manual', preferredModel: 'a' }));
    expect(exhausted.decision).toBeUndefined();
    expect(exhausted.rejected[0]?.reason).toContain('resets');
  });

  it('falls back to another free model and emits explanation events', () => {
    const registry = new ModelRegistry([registryEntry('a'), registryEntry('b')]);
    const quota = new QuotaLedger({ now: () => 0 });
    const sink = new MemoryEventSink();
    const router = new ModelRouter({ registry, quota, sink, now: () => 0 });
    quota.markExhausted('groq', {
      modelId: 'a',
      resetsAt: '2026-11-03T00:00:00.000Z',
    });

    const result = router.select(request(), { provider: 'groq', modelId: 'a' });

    expect(result.decision?.modelId).toBe('b');
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: 'a',
          reason: expect.stringContaining('2026-11-03T00:00:00.000Z'),
        }),
      ]),
    );
    expect(sink.events).toEqual([
      expect.objectContaining({
        type: 'model.fallback',
        from: { provider: 'groq', modelId: 'a' },
        to: { provider: 'groq', modelId: 'b' },
        reason: expect.stringContaining('2026-11-03T00:00:00.000Z'),
      }),
      expect.objectContaining({
        type: 'model.selected',
        provider: 'groq',
        modelId: 'b',
        policy: 'free-first',
      }),
    ]);
  });

  it('excludes providers from selection', () => {
    const registry = new ModelRegistry([
      registryEntry('openrouter-model', { provider: 'openrouter' }),
      registryEntry('groq-model'),
    ]);
    const router = new ModelRouter({ registry, quota: new QuotaLedger() });

    const result = router.select(request({ excludeProviders: ['openrouter'] }));

    expect(result.decision?.modelId).toBe('groq-model');
    expect(result.rejected).toEqual([
      expect.objectContaining({
        provider: 'openrouter',
        reason: 'provider "openrouter" is excluded',
      }),
    ]);
  });

  it('applies fast policy using measured latency', () => {
    const registry = new ModelRegistry([registryEntry('slow'), registryEntry('fast')]);
    const router = new ModelRouter({
      registry,
      quota: new QuotaLedger(),
      metrics: (_provider, modelId) =>
        modelId === 'fast' ? { latencyMs: 100 } : { latencyMs: 4_000 },
    });

    expect(router.select(request({ policy: 'fast' })).decision?.modelId).toBe('fast');
  });

  it('applies coding and reasoning policy tags', () => {
    const registry = new ModelRegistry([
      registryEntry('generic'),
      registryEntry('coder', { tags: ['coding'] }),
      registryEntry('thinker', {
        tags: ['reasoning'],
        capabilities: capabilities({ supportsReasoning: true }),
      }),
    ]);
    const router = new ModelRouter({ registry, quota: new QuotaLedger() });

    expect(router.select(request({ policy: 'coding' })).decision?.modelId).toBe('coder');
    expect(router.select(request({ policy: 'reasoning' })).decision?.modelId).toBe('thinker');
  });

  it('automatic policy uses measured success data only', () => {
    const registry = new ModelRegistry([registryEntry('unproven'), registryEntry('reliable')]);
    const router = new ModelRouter({
      registry,
      quota: new QuotaLedger(),
      metrics: (_provider, modelId) =>
        modelId === 'reliable'
          ? { latencyMs: 500, successRate: 0.95, recentFailureRate: 0 }
          : { latencyMs: 100, successRate: 0.1, recentFailureRate: 0.8 },
    });

    expect(router.select(request({ policy: 'automatic' })).decision?.modelId).toBe('reliable');
  });

  it('returns an explained empty result when the registry is empty', () => {
    const router = new ModelRouter({
      registry: new ModelRegistry([]),
      quota: new QuotaLedger(),
    });

    expect(router.select(request())).toEqual({ rejected: [] });
  });

  it('supports every declared policy', () => {
    const policies = ['manual', 'free-first', 'fast', 'coding', 'reasoning', 'automatic'] as const;
    const registry = new ModelRegistry([registryEntry('model')]);
    const router = new ModelRouter({ registry, quota: new QuotaLedger() });

    for (const policy of policies) {
      const result = router.select(request({ policy, preferredModel: 'model' }));
      expect(result.decision?.modelId).toBe('model');
    }
  });
});

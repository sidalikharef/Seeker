import { describe, expect, it } from 'vitest';
import {
  createDebugRequest,
  formatRoutingDebug,
  toRoutingSettings,
} from '../../../src/router/debug';
import { QuotaLedger } from '../../../src/router/quota';
import { ModelRegistry } from '../../../src/router/registry';
import { ModelRouter } from '../../../src/router/router';
import { capabilities, descriptor, registryEntry } from './fixtures';

describe('routing debug helpers', () => {
  it('normalizes routing settings with safe defaults', () => {
    expect(
      toRoutingSettings({
        policy: 'invalid',
        allowPaid: true,
        maxCostUsdPerTask: Number.NaN,
        preferredProvider: 'nope',
        preferredModel: '  model  ',
        excludedProviders: ['groq', 'nope', 'groq'],
      }),
    ).toEqual({
      policy: 'free-first',
      allowPaid: true,
      maxCostUsd: 0,
      preferredProvider: undefined,
      preferredModel: 'model',
      excludedProviders: ['groq'],
    });
  });

  it('builds a debug request that requires Build-mode capabilities', () => {
    const settings = toRoutingSettings({ policy: 'manual', preferredModel: 'model' });
    expect(createDebugRequest(settings)).toMatchObject({
      taskKind: 'code',
      policy: 'manual',
      preferredModel: 'model',
      required: { tools: true, streaming: true },
    });
  });

  it('prints the selected model, every eligibility reason, and conflicts', () => {
    const registry = new ModelRegistry([registryEntry('chosen'), registryEntry('limited')]);
    registry.applyProviderDiscovery('groq', [
      descriptor('chosen', {
        capabilities: capabilities({ supportsTools: false }),
      }),
      descriptor('limited'),
    ]);
    const quota = new QuotaLedger({ now: () => 0 });
    quota.markExhausted('groq', {
      modelId: 'limited',
      resetsAt: '2026-11-03T00:00:00.000Z',
    });
    const settings = toRoutingSettings({ policy: 'free-first' });
    const result = new ModelRouter({ registry, quota }).select(createDebugRequest(settings));

    const text = formatRoutingDebug(registry, result, settings);

    expect(text).toContain('Policy: free-first');
    expect(text).toContain('Selected: groq/chosen');
    expect(text).toContain('groq/chosen: yes');
    expect(text).toContain('groq/limited: no - Free quota exhausted');
    expect(text).toContain('Registry conflicts');
    expect(text).toContain('supportsTools');
  });
});

import { describe, expect, it } from 'vitest';
import { resolveEnabledProviders } from '../../src/extension/provider-settings';
import { createProviderAdapters } from '../../src/providers/registry';
import type { CredentialProvider } from '../../src/providers/types';

function credentials(): CredentialProvider {
  return {
    get: async () => undefined,
    set: async () => undefined,
    delete: async () => undefined,
    has: async () => false,
  };
}

describe('provider enable settings', () => {
  it('enables both providers by default', () => {
    expect(resolveEnabledProviders({})).toEqual(['openrouter', 'groq']);
  });

  it('honors the allow-list and individual provider flags', () => {
    expect(resolveEnabledProviders({ configuredProviders: ['groq'] })).toEqual(['groq']);
    expect(
      resolveEnabledProviders({
        configuredProviders: ['openrouter', 'groq'],
        flags: { openrouter: false },
      }),
    ).toEqual(['groq']);
    expect(resolveEnabledProviders({ flags: { groq: false } })).toEqual(['openrouter']);
  });

  it('ignores unknown provider names and produces no adapters when all are disabled', () => {
    expect(
      resolveEnabledProviders({ configuredProviders: ['openrouter', 'unknown', 'groq'] }),
    ).toEqual(['openrouter', 'groq']);
    expect(
      createProviderAdapters(
        credentials(),
        {},
        resolveEnabledProviders({ configuredProviders: [] }),
      ),
    ).toEqual({});
  });

  it('creates adapters only for enabled providers', () => {
    const adapters = createProviderAdapters(credentials(), {}, ['groq']);
    expect(Object.keys(adapters)).toEqual(['groq']);
  });
});

import { GroqProvider } from './groq';
import type { FetchLike } from './openai-compatible';
import { OpenRouterProvider } from './openrouter';
import {
  PROVIDER_IDS,
  type CredentialProvider,
  type ProviderAdapter,
  type ProviderId,
} from './types';

export interface ProviderRegistryOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export function createProviderAdapters(
  credentials: CredentialProvider,
  options: ProviderRegistryOptions = {},
  enabledProviders: readonly ProviderId[] = PROVIDER_IDS,
): Partial<Record<ProviderId, ProviderAdapter>> {
  const adapters: Partial<Record<ProviderId, ProviderAdapter>> = {};
  if (enabledProviders.includes('openrouter')) {
    adapters.openrouter = new OpenRouterProvider(credentials, options);
  }
  if (enabledProviders.includes('groq')) {
    adapters.groq = new GroqProvider(credentials, options);
  }
  return adapters;
}

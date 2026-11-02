export const CONFIG_SECTION = 'seeker';

export const CONFIG_KEYS = {
  enabled: 'enabled',
  providersEnabled: 'providers.enabled',
  openrouterEnabled: 'providers.openrouter.enabled',
  groqEnabled: 'providers.groq.enabled',
  routingPolicy: 'routing.policy',
  routingAllowPaid: 'routing.allowPaid',
  routingMaxCostUsdPerTask: 'routing.maxCostUsdPerTask',
  routingPreferredProvider: 'routing.preferredProvider',
  routingPreferredModel: 'routing.preferredModel',
  routingExcludedProviders: 'routing.excludedProviders',
} as const;

export type ConfigKey = (typeof CONFIG_KEYS)[keyof typeof CONFIG_KEYS];

export function configurationKey(key: ConfigKey): string {
  return `${CONFIG_SECTION}.${key}`;
}

import { PROVIDER_IDS, type ProviderId } from '../providers/types';

export interface ProviderEnableInput {
  configuredProviders?: readonly string[];
  flags?: Partial<Record<ProviderId, boolean>>;
}

export function resolveEnabledProviders(input: ProviderEnableInput): ProviderId[] {
  const configured = new Set(
    (input.configuredProviders ?? PROVIDER_IDS).filter((provider): provider is ProviderId =>
      (PROVIDER_IDS as readonly string[]).includes(provider),
    ),
  );

  return PROVIDER_IDS.filter(
    (provider) => configured.has(provider) && input.flags?.[provider] !== false,
  );
}

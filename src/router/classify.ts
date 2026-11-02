import type { FreeTierClass, ModelDescriptor, ModelPricing } from '../providers/types';

export function parsePricePerMTok(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function hasZeroPrice(pricing: ModelPricing | undefined): boolean {
  return pricing?.inputPerMTok === 0 && pricing.outputPerMTok === 0;
}

export function classifyFreeTier(
  descriptor: Pick<ModelDescriptor, 'modelId' | 'freeTierClass' | 'pricing'>,
): FreeTierClass {
  if (descriptor.freeTierClass !== 'unknown') {
    return descriptor.freeTierClass;
  }

  if (hasZeroPrice(descriptor.pricing) || descriptor.modelId.endsWith(':free')) {
    return 'free-tier';
  }

  const hasPaidPrice =
    (descriptor.pricing?.inputPerMTok ?? 0) > 0 || (descriptor.pricing?.outputPerMTok ?? 0) > 0;
  if (hasPaidPrice) {
    return 'paid';
  }

  return 'unknown';
}

export function isFreeClass(freeTierClass: FreeTierClass): boolean {
  return freeTierClass === 'free-tier' || freeTierClass === 'local';
}

export function isPaidClass(freeTierClass: FreeTierClass): boolean {
  return (
    freeTierClass === 'paid' || freeTierClass === 'trial-credit' || freeTierClass === 'subscription'
  );
}

export function estimatedCostUsdPerMTok(pricing: ModelPricing | undefined): number {
  if (!pricing) {
    return 0;
  }
  return (pricing.inputPerMTok ?? 0) + (pricing.outputPerMTok ?? 0);
}

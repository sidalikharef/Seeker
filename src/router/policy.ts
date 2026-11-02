import type { ModelCapabilities, TriState } from '../providers/types';
import type { ModelRegistryEntry, ModelTag } from './registry';
import { estimatedCostUsdPerMTok, isFreeClass } from './classify';
import type { AvailabilityState } from './quota';

export const ROUTING_POLICIES = [
  'manual',
  'free-first',
  'fast',
  'coding',
  'reasoning',
  'automatic',
] as const;

export type RoutingPolicy = (typeof ROUTING_POLICIES)[number];

export const DEFAULT_ROUTING_POLICY: RoutingPolicy = 'free-first';

export function isRoutingPolicy(value: unknown): value is RoutingPolicy {
  return typeof value === 'string' && (ROUTING_POLICIES as readonly string[]).includes(value);
}

export interface RequiredCapabilities {
  tools: boolean;
  streaming: boolean;
  structuredOutput?: boolean;
  images?: boolean;
  reasoning?: boolean;
  minContextWindow?: number;
}

export interface RouteMetrics {
  latencyMs?: number;
  successRate?: number;
  recentFailureRate?: number;
}

export interface RoutingScore {
  capabilityFit: number;
  freeTier: number;
  health: number;
  latency: number;
  successRate: number;
  costPenalty: number;
  recentFailurePenalty: number;
  total: number;
}

function requiredTrue(value: TriState | undefined): boolean {
  return value === true;
}

export function capabilityFit(
  capabilities: ModelCapabilities,
  required: RequiredCapabilities,
): number {
  let score = 0;

  if (required.tools) {
    if (requiredTrue(capabilities.supportsTools)) score += 12;
  } else if (requiredTrue(capabilities.supportsTools)) {
    score += 4;
  }

  if (required.streaming) {
    if (requiredTrue(capabilities.supportsStreaming)) score += 8;
  } else if (requiredTrue(capabilities.supportsStreaming)) {
    score += 4;
  }

  if (required.structuredOutput) {
    if (requiredTrue(capabilities.supportsStructuredOutput)) score += 6;
  } else if (requiredTrue(capabilities.supportsStructuredOutput)) {
    score += 2;
  }

  if (required.images) {
    if (requiredTrue(capabilities.supportsImages)) score += 6;
  } else if (requiredTrue(capabilities.supportsImages)) {
    score += 2;
  }

  if (required.reasoning) {
    if (requiredTrue(capabilities.supportsReasoning)) score += 4;
  } else if (requiredTrue(capabilities.supportsReasoning)) {
    score += 2;
  }

  if (required.minContextWindow !== undefined) {
    if ((capabilities.contextWindow ?? 0) >= required.minContextWindow) {
      score += 4;
    }
  } else if ((capabilities.contextWindow ?? 0) >= 128_000) {
    score += 2;
  }

  if (requiredTrue(capabilities.supportsParallelTools)) {
    score += 2;
  }

  return Math.min(40, score);
}

function healthScore(state: AvailabilityState | undefined): number {
  switch (state) {
    case 'healthy':
      return 15;
    case 'degraded':
      return 8;
    case 'unknown':
    case undefined:
      return 5;
    default:
      return 0;
  }
}

export function scoreEntry(
  entry: ModelRegistryEntry,
  required: RequiredCapabilities,
  availability: AvailabilityState | undefined,
  metrics: RouteMetrics | undefined,
): RoutingScore {
  const capability = capabilityFit(entry.capabilities, required);
  const freeTier = isFreeClass(entry.freeTierClass)
    ? 25
    : entry.freeTierClass === 'unknown'
      ? 5
      : 0;
  const health = healthScore(availability);
  const latency =
    metrics?.latencyMs === undefined
      ? 0
      : Math.max(0, Math.min(10, 10 - metrics.latencyMs / 1_000));
  const successRate =
    metrics?.successRate === undefined ? 0 : Math.max(0, Math.min(1, metrics.successRate)) * 10;
  const costPenalty = isFreeClass(entry.freeTierClass)
    ? 0
    : estimatedCostUsdPerMTok(entry.pricing) / 10;
  const recentFailurePenalty = Math.max(0, Math.min(1, metrics?.recentFailureRate ?? 0)) * 20;
  const total = Math.max(
    0,
    capability + freeTier + health + latency + successRate - costPenalty - recentFailurePenalty,
  );

  return {
    capabilityFit: capability,
    freeTier,
    health,
    latency,
    successRate,
    costPenalty,
    recentFailurePenalty,
    total,
  };
}

function hasTag(entry: ModelRegistryEntry, tag: ModelTag): boolean {
  return entry.tags.includes(tag);
}

export function policyRank(
  entry: ModelRegistryEntry,
  policy: RoutingPolicy,
  score: RoutingScore,
  metrics: RouteMetrics | undefined,
): number {
  const freeBonus = isFreeClass(entry.freeTierClass) ? 100 : 0;

  switch (policy) {
    case 'manual':
      return 0;
    case 'free-first':
      return (isFreeClass(entry.freeTierClass) ? 10_000 : 0) + score.total;
    case 'fast':
      return (
        (metrics?.latencyMs === undefined ? 0 : Math.max(0, 10_000 - metrics.latencyMs)) +
        (hasTag(entry, 'fast') ? 500 : 0) +
        freeBonus +
        score.total
      );
    case 'coding':
      return (
        (hasTag(entry, 'coding') ? 10_000 : 0) +
        (entry.capabilities.supportsTools === true ? 2_000 : 0) +
        freeBonus +
        score.total
      );
    case 'reasoning':
      return (
        (hasTag(entry, 'reasoning') ? 10_000 : 0) +
        (entry.capabilities.supportsReasoning === true ? 2_000 : 0) +
        freeBonus +
        score.total
      );
    case 'automatic':
      return score.total;
  }
}

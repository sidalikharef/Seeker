import type { EventSink } from '../core/events';
import type { ProviderId, TriState } from '../providers/types';
import { estimatedCostUsdPerMTok, isFreeClass } from './classify';
import type { RequiredCapabilities, RouteMetrics, RoutingPolicy, RoutingScore } from './policy';
import { capabilityFit, policyRank, scoreEntry } from './policy';
import { QuotaLedger, type AvailabilityState } from './quota';
import type { ModelRegistry, ModelRegistryEntry } from './registry';

export type { RoutingPolicy } from './policy';

export interface RoutingRequest {
  taskKind: 'chat' | 'plan' | 'code' | 'debug' | 'review';
  required: RequiredCapabilities;
  policy: RoutingPolicy;
  maxCostUsd?: number;
  allowPaid?: boolean;
  excludeProviders?: ProviderId[];
  preferredProvider?: ProviderId;
  preferredModel?: string;
}

export interface RoutingDecision {
  provider: ProviderId;
  modelId: string;
  reason: string;
  score: RoutingScore;
}

export interface RoutingRejection {
  provider: ProviderId;
  modelId: string;
  reason: string;
}

export interface RoutingResult {
  decision?: RoutingDecision;
  rejected: RoutingRejection[];
}

export interface ModelSelection {
  provider: ProviderId;
  modelId: string;
}

export type MetricsLookup = (provider: ProviderId, modelId: string) => RouteMetrics | undefined;

export interface ModelRouterOptions {
  registry: ModelRegistry;
  quota: QuotaLedger;
  metrics?: MetricsLookup;
  sink?: EventSink;
  now?: () => number;
}

interface Candidate {
  entry: ModelRegistryEntry;
  rank: number;
  score: RoutingScore;
  availability?: AvailabilityState;
}

function rejection(entry: ModelRegistryEntry, reason: string): RoutingRejection {
  return { provider: entry.provider, modelId: entry.modelId, reason };
}

function triStateReason(label: string, value: TriState | undefined): string | undefined {
  if (value === true) {
    return undefined;
  }
  return value === false ? `${label} is not supported` : `${label} is not declared`;
}

function capabilityRejection(
  entry: ModelRegistryEntry,
  required: RequiredCapabilities,
): string | undefined {
  const capabilities = entry.capabilities;

  if (required.tools) {
    const reason = triStateReason('tool calling', capabilities.supportsTools);
    if (reason) return reason;
  }
  if (required.streaming) {
    const reason = triStateReason('streaming', capabilities.supportsStreaming);
    if (reason) return reason;
  }
  if (required.structuredOutput) {
    const reason = triStateReason('structured output', capabilities.supportsStructuredOutput);
    if (reason) return reason;
  }
  if (required.images) {
    const reason = triStateReason('image input', capabilities.supportsImages);
    if (reason) return reason;
  }
  if (required.reasoning) {
    const reason = triStateReason('reasoning', capabilities.supportsReasoning);
    if (reason) return reason;
  }
  if (required.minContextWindow !== undefined) {
    const contextWindow = capabilities.contextWindow;
    if (contextWindow === undefined) {
      return 'context window is not declared';
    }
    if (contextWindow < required.minContextWindow) {
      return `context window ${contextWindow} is below required ${required.minContextWindow}`;
    }
  }

  if (
    required.structuredOutput &&
    (required.tools || required.streaming) &&
    entry.knownIssues?.some((issue) =>
      /structured output.*(?:tools|streaming)|(?:tools|streaming).*structured output|incompatible/i.test(
        issue,
      ),
    )
  ) {
    return 'structured output cannot be combined with tools or streaming for this model';
  }

  return undefined;
}

function paidRejection(
  entry: ModelRegistryEntry,
  allowPaid: boolean,
  maxCostUsd: number,
): string | undefined {
  if (isFreeClass(entry.freeTierClass)) {
    return undefined;
  }

  if (!allowPaid) {
    return `tier "${entry.freeTierClass}" is not free; paid fallback is disabled`;
  }
  if (maxCostUsd <= 0) {
    return 'paid model rejected because maxCostUsd is 0';
  }
  if (!entry.pricing) {
    return 'paid model has unknown pricing';
  }

  const estimated = estimatedCostUsdPerMTok(entry.pricing);
  if (estimated > maxCostUsd) {
    return `estimated cost ${estimated.toFixed(2)} USD/MTok exceeds maxCostUsd ${maxCostUsd}`;
  }

  return undefined;
}

function selectionReason(
  entry: ModelRegistryEntry,
  policy: RoutingPolicy,
  score: RoutingScore,
): string {
  const tier = entry.freeTierClass;
  return `${policy}: selected ${entry.provider}/${entry.modelId} (${tier}, score ${score.total.toFixed(1)})`;
}

export class ModelRouter {
  private readonly registry: ModelRegistry;
  private readonly quota: QuotaLedger;
  private readonly metrics?: MetricsLookup;
  private readonly sink?: EventSink;
  private readonly now: () => number;

  constructor(options: ModelRouterOptions) {
    this.registry = options.registry;
    this.quota = options.quota;
    this.metrics = options.metrics;
    this.sink = options.sink;
    this.now = options.now ?? Date.now;
  }

  private emit(event: Parameters<EventSink['emit']>[0]): void {
    try {
      this.sink?.emit(event);
    } catch {
      // Routing must not fail because an observer threw.
    }
  }

  private evaluate(
    entry: ModelRegistryEntry,
    request: RoutingRequest,
    manualTarget: ModelRegistryEntry | undefined,
  ): Candidate | RoutingRejection {
    if (request.excludeProviders?.includes(entry.provider)) {
      return rejection(entry, `provider "${entry.provider}" is excluded`);
    }

    if (request.policy === 'manual' && entry !== manualTarget) {
      return rejection(entry, 'manual policy selected a different model');
    }

    const capabilityReason = capabilityRejection(entry, request.required);
    if (capabilityReason) {
      return rejection(entry, capabilityReason);
    }

    const costReason = paidRejection(entry, request.allowPaid ?? false, request.maxCostUsd ?? 0);
    if (costReason) {
      return rejection(entry, costReason);
    }

    const quotaCheck = this.quota.canUse(entry.provider, entry.modelId);
    if (!quotaCheck.allowed) {
      return rejection(entry, quotaCheck.reason ?? 'model is unavailable');
    }

    const metrics = this.metrics?.(entry.provider, entry.modelId);
    const score = scoreEntry(entry, request.required, quotaCheck.availability?.state, metrics);
    let rank = policyRank(entry, request.policy, score, metrics);
    if (request.preferredProvider === entry.provider) {
      rank += 25;
    }
    if (request.preferredModel === entry.modelId) {
      rank += 50;
    }

    return {
      entry,
      rank,
      score,
      availability: quotaCheck.availability?.state,
    };
  }

  select(request: RoutingRequest, previous?: ModelSelection): RoutingResult {
    const entries = this.registry.list();
    const rejected: RoutingRejection[] = [];

    if (entries.length === 0) {
      return { rejected };
    }

    let manualTarget: ModelRegistryEntry | undefined;
    if (request.policy === 'manual') {
      if (!request.preferredModel) {
        return {
          rejected: entries.map((entry) =>
            rejection(entry, 'manual policy requires preferredModel'),
          ),
        };
      }

      manualTarget = entries.find(
        (entry) =>
          entry.modelId === request.preferredModel &&
          (request.preferredProvider === undefined || entry.provider === request.preferredProvider),
      );

      if (!manualTarget) {
        const target = `${request.preferredProvider ?? '*'}/${request.preferredModel}`;
        return {
          rejected: entries.map((entry) =>
            rejection(entry, `manual policy target "${target}" is not in the registry`),
          ),
        };
      }
    }

    const candidates: Candidate[] = [];

    for (const entry of entries) {
      const result = this.evaluate(entry, request, manualTarget);
      if ('rank' in result) {
        candidates.push(result);
      } else {
        rejected.push(result);
      }
    }

    candidates.sort((left, right) => {
      if (right.rank !== left.rank) {
        return right.rank - left.rank;
      }
      const providerOrder = left.entry.provider.localeCompare(right.entry.provider);
      if (providerOrder !== 0) {
        return providerOrder;
      }
      return left.entry.modelId.localeCompare(right.entry.modelId);
    });

    const selected = candidates[0];
    if (!selected) {
      return { rejected };
    }

    for (const candidate of candidates.slice(1)) {
      rejected.push(
        rejection(
          candidate.entry,
          `eligible but lower rank (${candidate.score.total.toFixed(1)} vs ${selected.score.total.toFixed(1)})`,
        ),
      );
    }

    const decision: RoutingDecision = {
      provider: selected.entry.provider,
      modelId: selected.entry.modelId,
      reason: selectionReason(selected.entry, request.policy, selected.score),
      score: selected.score,
    };

    if (
      previous &&
      (previous.provider !== decision.provider || previous.modelId !== decision.modelId)
    ) {
      const previousRejection = rejected.find(
        (item) => item.provider === previous.provider && item.modelId === previous.modelId,
      );
      this.emit({
        type: 'model.fallback',
        from: previous,
        to: { provider: decision.provider, modelId: decision.modelId },
        reason: previousRejection?.reason ?? 'routing policy selected a different model',
        at: new Date(this.now()).toISOString(),
      });
    }

    this.emit({
      type: 'model.selected',
      provider: decision.provider,
      modelId: decision.modelId,
      policy: request.policy,
      reason: decision.reason,
      score: {
        capabilityFit: decision.score.capabilityFit,
        freeTier: decision.score.freeTier,
        health: decision.score.health,
        latency: decision.score.latency,
        successRate: decision.score.successRate,
        costPenalty: decision.score.costPenalty,
        recentFailurePenalty: decision.score.recentFailurePenalty,
        total: decision.score.total,
      },
      at: new Date(this.now()).toISOString(),
    });

    return { decision, rejected };
  }

  explain(request: RoutingRequest): RoutingResult {
    return this.select(request);
  }
}

export { capabilityFit };

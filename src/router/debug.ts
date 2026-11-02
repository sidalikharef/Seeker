import { PROVIDER_IDS, type ProviderId } from '../providers/types';
import { DEFAULT_ROUTING_POLICY, isRoutingPolicy, type RoutingPolicy } from './policy';
import type { ModelRegistry } from './registry';
import type { RoutingRequest, RoutingResult } from './router';

export interface RoutingConfigInput {
  policy?: string;
  allowPaid?: boolean;
  maxCostUsdPerTask?: number;
  preferredProvider?: string;
  preferredModel?: string;
  excludedProviders?: string[];
}

export interface RoutingSettings {
  policy: RoutingPolicy;
  allowPaid: boolean;
  maxCostUsd: number;
  preferredProvider?: ProviderId;
  preferredModel?: string;
  excludedProviders: ProviderId[];
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

function providerOrUndefined(value: string | undefined): ProviderId | undefined {
  return isProviderId(value) ? value : undefined;
}

export function toRoutingSettings(input: RoutingConfigInput): RoutingSettings {
  const maxCostUsd = input.maxCostUsdPerTask;
  return {
    policy: isRoutingPolicy(input.policy) ? input.policy : DEFAULT_ROUTING_POLICY,
    allowPaid: input.allowPaid === true,
    maxCostUsd:
      typeof maxCostUsd === 'number' && Number.isFinite(maxCostUsd) && maxCostUsd > 0
        ? maxCostUsd
        : 0,
    preferredProvider: providerOrUndefined(input.preferredProvider),
    preferredModel: input.preferredModel?.trim() || undefined,
    excludedProviders: [...new Set((input.excludedProviders ?? []).filter(isProviderId))],
  };
}

export function createDebugRequest(settings: RoutingSettings): RoutingRequest {
  return {
    taskKind: 'code',
    required: { tools: true, streaming: true },
    policy: settings.policy,
    allowPaid: settings.allowPaid,
    maxCostUsd: settings.maxCostUsd,
    preferredProvider: settings.preferredProvider,
    preferredModel: settings.preferredModel,
    excludeProviders: settings.excludedProviders,
  };
}

function formatSettings(settings: RoutingSettings): string[] {
  const excluded =
    settings.excludedProviders.length > 0 ? settings.excludedProviders.join(',') : 'none';
  return [
    `Policy: ${settings.policy}`,
    `Allow paid: ${settings.allowPaid}`,
    `Max cost: ${settings.maxCostUsd} USD/task`,
    `Preferred: ${settings.preferredProvider ?? 'any'}/${settings.preferredModel ?? 'any'}`,
    `Excluded providers: ${excluded}`,
  ];
}

export function formatRoutingDebug(
  registry: ModelRegistry,
  result: RoutingResult,
  settings: RoutingSettings,
): string {
  const lines = ['Seeker routing debug', ...formatSettings(settings), ''];

  if (result.decision) {
    lines.push(
      `Selected: ${result.decision.provider}/${result.decision.modelId}`,
      `Reason: ${result.decision.reason}`,
    );
  } else {
    lines.push('Selected: none');
  }

  const rejectionByModel = new Map(
    result.rejected.map((item) => [`${item.provider}/${item.modelId}`, item.reason]),
  );
  const entries = registry.list();
  lines.push('', `Models (${entries.length}):`);

  if (entries.length === 0) {
    lines.push('  (no models registered; refresh models first)');
  }

  for (const entry of entries) {
    const id = `${entry.provider}/${entry.modelId}`;
    const reason = rejectionByModel.get(id);
    lines.push(`  ${id}: ${reason ? `no - ${reason}` : 'yes'}`);
  }

  const conflicts = registry.getConflicts();
  if (conflicts.length > 0) {
    lines.push('', `Registry conflicts (${conflicts.length}):`);
    for (const conflict of conflicts) {
      lines.push(
        `  ${conflict.provider}/${conflict.modelId}.${conflict.field}: static=${String(
          conflict.staticValue,
        )} discovered=${String(conflict.discovered)}`,
      );
    }
  }

  return lines.join('\n');
}

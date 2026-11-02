import { PROVIDER_IDS } from '../providers/types';
import type {
  FreeTierClass,
  ModelCapabilities,
  ModelDescriptor,
  ModelPricing,
  ProviderId,
  TriState,
} from '../providers/types';
import { classifyFreeTier } from './classify';

export type ModelTag = 'coding' | 'reasoning' | 'fast' | 'long-context' | 'vision';

export type VerificationSource = 'provider-api' | 'provider-docs' | 'measured' | 'community';

export interface ModelRegistryEntry {
  provider: ProviderId;
  modelId: string;
  displayName: string;
  freeTierClass: FreeTierClass;
  capabilities: ModelCapabilities;
  pricing?: ModelPricing;
  tags: ModelTag[];
  verification: {
    verifiedAt: string;
    source: VerificationSource;
    notes?: string;
  };
  knownIssues?: string[];
  eval?: {
    tasksRun: number;
    successRate?: number;
    avgToolCalls?: number;
    lastRunAt?: string;
  };
}

export interface RegistryConflict {
  provider: ProviderId;
  modelId: string;
  field: string;
  discovered: unknown;
  staticValue: unknown;
}

export interface ModelRegistryOverride {
  provider: ProviderId;
  modelId: string;
  freeTierClass?: FreeTierClass;
  capabilities?: Partial<ModelCapabilities>;
  tags?: ModelTag[];
  knownIssues?: string[];
}

const VERIFIED_AT = '2026-11-01';
const LONG_CONTEXT = 128_000;

function baseCapabilities(overrides: Partial<ModelCapabilities>): ModelCapabilities {
  return {
    supportsStreaming: 'unknown',
    supportsTools: 'unknown',
    supportsParallelTools: 'unknown',
    supportsStructuredOutput: 'unknown',
    supportsImages: 'unknown',
    supportsReasoning: 'unknown',
    supportsPromptCaching: 'unknown',
    toolCallFormat: 'unknown',
    structuredOutputMode: 'unknown',
    ...overrides,
  };
}

function seed(
  modelId: string,
  capabilities: Partial<ModelCapabilities>,
  knownIssues?: string[],
): ModelRegistryEntry {
  return {
    provider: 'groq',
    modelId,
    displayName: modelId,
    freeTierClass: 'free-tier',
    capabilities: baseCapabilities(capabilities),
    tags: ['coding', 'long-context'],
    verification: { verifiedAt: VERIFIED_AT, source: 'provider-docs' },
    knownIssues,
  };
}

const STRUCTURED_OUTPUT_CONFLICT =
  'Structured output is not supported together with tools or streaming.';

export const SEEDED_REGISTRY_ENTRIES: readonly ModelRegistryEntry[] = [
  seed(
    'openai/gpt-oss-120b',
    {
      supportsStreaming: true,
      supportsTools: true,
      supportsParallelTools: false,
      supportsStructuredOutput: true,
      contextWindow: 131_072,
      maxOutputTokens: 65_536,
      toolCallFormat: 'openai',
      structuredOutputMode: 'json-schema',
    },
    [STRUCTURED_OUTPUT_CONFLICT],
  ),
  seed(
    'openai/gpt-oss-20b',
    {
      supportsStreaming: true,
      supportsTools: true,
      supportsParallelTools: false,
      supportsStructuredOutput: true,
      contextWindow: 131_072,
      maxOutputTokens: 65_536,
      toolCallFormat: 'openai',
      structuredOutputMode: 'json-schema',
    },
    [STRUCTURED_OUTPUT_CONFLICT],
  ),
  seed('qwen/qwen3.8-27b', {
    supportsStreaming: true,
    supportsTools: true,
    supportsParallelTools: true,
    supportsStructuredOutput: true,
    contextWindow: 131_072,
    maxOutputTokens: 16_384,
    toolCallFormat: 'openai',
    structuredOutputMode: 'json-schema',
  }),
];

function cloneEntry(entry: ModelRegistryEntry): ModelRegistryEntry {
  return {
    ...entry,
    capabilities: { ...entry.capabilities },
    pricing: entry.pricing ? { ...entry.pricing } : undefined,
    tags: [...entry.tags],
    verification: { ...entry.verification },
    knownIssues: entry.knownIssues ? [...entry.knownIssues] : undefined,
    eval: entry.eval ? { ...entry.eval } : undefined,
  };
}

function inferTags(capabilities: ModelCapabilities, contextWindow?: number): ModelTag[] {
  const tags: ModelTag[] = [];
  if (capabilities.supportsTools === true) {
    tags.push('coding');
  }
  if (capabilities.supportsReasoning === true) {
    tags.push('reasoning');
  }
  if ((contextWindow ?? 0) >= LONG_CONTEXT) {
    tags.push('long-context');
  }
  if (capabilities.supportsImages === true) {
    tags.push('vision');
  }
  return tags;
}

function mergeTags(...tagSets: ModelTag[][]): ModelTag[] {
  return [...new Set(tagSets.flat())];
}

function differs(left: unknown, right: unknown): boolean {
  return left !== undefined && right !== undefined && left !== right;
}

function mergeCapabilities(
  staticCapabilities: ModelCapabilities | undefined,
  discovered: ModelCapabilities | undefined,
  conflict: (field: string, staticValue: unknown, discoveredValue: unknown) => void,
): ModelCapabilities {
  const merged = { ...(discovered ?? baseCapabilities({})) };
  if (!staticCapabilities) {
    return merged;
  }

  const triKeys: Array<keyof ModelCapabilities> = [
    'supportsStreaming',
    'supportsTools',
    'supportsParallelTools',
    'supportsStructuredOutput',
    'supportsImages',
    'supportsReasoning',
    'supportsPromptCaching',
  ];

  for (const key of triKeys) {
    const staticValue = staticCapabilities[key] as TriState | undefined;
    const discoveredValue = discovered?.[key] as TriState | undefined;
    if (differs(staticValue, discoveredValue)) {
      conflict(key, staticValue, discoveredValue);
    }
    if (staticValue !== undefined && staticValue !== 'unknown') {
      merged[key] = staticValue as never;
    }
  }

  for (const key of ['contextWindow', 'maxOutputTokens'] as const) {
    const staticValue = staticCapabilities[key];
    const discoveredValue = discovered?.[key];
    if (differs(staticValue, discoveredValue)) {
      conflict(key, staticValue, discoveredValue);
    }
    merged[key] = staticValue ?? discoveredValue;
  }

  const toolFormat = staticCapabilities.toolCallFormat;
  if (toolFormat !== undefined && toolFormat !== 'unknown') {
    merged.toolCallFormat = toolFormat;
  } else if (discovered?.toolCallFormat && discovered.toolCallFormat !== 'unknown') {
    merged.toolCallFormat = discovered.toolCallFormat;
  }
  const structured = staticCapabilities.structuredOutputMode;
  if (structured !== undefined && structured !== 'unknown') {
    merged.structuredOutputMode = structured;
  } else if (discovered?.structuredOutputMode && discovered.structuredOutputMode !== 'unknown') {
    merged.structuredOutputMode = discovered.structuredOutputMode;
  }

  return merged;
}

export class ModelRegistry {
  private readonly staticEntries = new Map<ProviderId, Map<string, ModelRegistryEntry>>();
  private readonly discovered = new Map<ProviderId, Map<string, ModelDescriptor>>();
  private readonly discoveryApplied = new Set<ProviderId>();
  private readonly overrides = new Map<ProviderId, Map<string, ModelRegistryOverride>>();
  private readonly conflicts: RegistryConflict[] = [];

  constructor(seeds: readonly ModelRegistryEntry[] = SEEDED_REGISTRY_ENTRIES) {
    for (const entry of seeds) {
      this.addStatic(entry);
    }
  }

  private addStatic(entry: ModelRegistryEntry): void {
    let providerEntries = this.staticEntries.get(entry.provider);
    if (!providerEntries) {
      providerEntries = new Map();
      this.staticEntries.set(entry.provider, providerEntries);
    }
    providerEntries.set(entry.modelId, cloneEntry(entry));
  }

  applyProviderDiscovery(provider: ProviderId, models: readonly ModelDescriptor[]): void {
    this.discovered.set(
      provider,
      new Map(
        models.map((model) => [
          model.modelId,
          {
            ...model,
            capabilities: { ...model.capabilities },
            pricing: model.pricing ? { ...model.pricing } : undefined,
            notes: model.notes ? [...model.notes] : undefined,
          },
        ]),
      ),
    );
    this.discoveryApplied.add(provider);
  }

  setOverride(override: ModelRegistryOverride): void {
    let providerOverrides = this.overrides.get(override.provider);
    if (!providerOverrides) {
      providerOverrides = new Map();
      this.overrides.set(override.provider, providerOverrides);
    }
    providerOverrides.set(override.modelId, {
      ...override,
      capabilities: override.capabilities ? { ...override.capabilities } : undefined,
      tags: override.tags ? [...override.tags] : undefined,
      knownIssues: override.knownIssues ? [...override.knownIssues] : undefined,
    });
  }

  private mergeDescriptor(provider: ProviderId, descriptor: ModelDescriptor): ModelRegistryEntry {
    const staticEntry = this.staticEntries.get(provider)?.get(descriptor.modelId);
    const conflicts: RegistryConflict[] = [];
    const conflict = (field: string, staticValue: unknown, discoveredValue: unknown): void => {
      conflicts.push({
        provider,
        modelId: descriptor.modelId,
        field,
        discovered: discoveredValue,
        staticValue,
      });
    };

    const capabilities = mergeCapabilities(
      staticEntry?.capabilities,
      descriptor.capabilities,
      conflict,
    );

    if (
      staticEntry &&
      staticEntry.freeTierClass !== 'unknown' &&
      descriptor.freeTierClass !== 'unknown' &&
      staticEntry.freeTierClass !== descriptor.freeTierClass
    ) {
      conflict('freeTierClass', staticEntry.freeTierClass, descriptor.freeTierClass);
    }

    if (differs(staticEntry?.pricing, descriptor.pricing)) {
      conflict('pricing', staticEntry?.pricing, descriptor.pricing);
    }

    this.conflicts.push(...conflicts);

    return {
      provider,
      modelId: descriptor.modelId,
      displayName: descriptor.displayName,
      freeTierClass:
        descriptor.freeTierClass !== 'unknown'
          ? descriptor.freeTierClass
          : (staticEntry?.freeTierClass ?? classifyFreeTier(descriptor)),
      capabilities,
      pricing: descriptor.pricing ?? staticEntry?.pricing,
      tags: mergeTags(staticEntry?.tags ?? [], inferTags(capabilities, capabilities.contextWindow)),
      verification: staticEntry?.verification ?? {
        verifiedAt: descriptor.verifiedAt ?? new Date().toISOString(),
        source: 'provider-api',
      },
      knownIssues: [...(staticEntry?.knownIssues ?? []), ...(descriptor.notes ?? [])].filter(
        (issue, index, all) => all.indexOf(issue) === index,
      ),
      eval: staticEntry?.eval,
    };
  }

  private applyOverride(entry: ModelRegistryEntry): ModelRegistryEntry {
    const override = this.overrides.get(entry.provider)?.get(entry.modelId);
    if (!override) {
      return entry;
    }

    return {
      ...entry,
      freeTierClass: override.freeTierClass ?? entry.freeTierClass,
      capabilities: {
        ...entry.capabilities,
        ...override.capabilities,
      },
      tags: override.tags ? [...override.tags] : entry.tags,
      knownIssues: override.knownIssues ? [...override.knownIssues] : entry.knownIssues,
    };
  }

  list(provider?: ProviderId): ModelRegistryEntry[] {
    const providers = provider ? [provider] : [...PROVIDER_IDS];
    const entries: ModelRegistryEntry[] = [];

    for (const currentProvider of providers) {
      const staticEntries = this.staticEntries.get(currentProvider);
      const discovered = this.discovered.get(currentProvider);

      if (this.discoveryApplied.has(currentProvider) && discovered) {
        for (const descriptor of discovered.values()) {
          entries.push(this.applyOverride(this.mergeDescriptor(currentProvider, descriptor)));
        }
        continue;
      }

      for (const entry of staticEntries?.values() ?? []) {
        entries.push(this.applyOverride(cloneEntry(entry)));
      }
    }

    return entries;
  }

  get(provider: ProviderId, modelId: string): ModelRegistryEntry | undefined {
    return this.list(provider).find((entry) => entry.modelId === modelId);
  }

  getConflicts(): readonly RegistryConflict[] {
    return this.conflicts;
  }

  clearConflicts(): void {
    this.conflicts.length = 0;
  }
}

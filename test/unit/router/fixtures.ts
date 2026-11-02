import type {
  FreeTierClass,
  ModelCapabilities,
  ModelDescriptor,
} from '../../../src/providers/types';
import type { ModelRegistryEntry, ModelTag } from '../../../src/router/registry';

export function capabilities(overrides: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return {
    supportsStreaming: true,
    supportsTools: true,
    supportsParallelTools: true,
    supportsStructuredOutput: true,
    supportsImages: false,
    supportsReasoning: false,
    supportsPromptCaching: false,
    contextWindow: 131_072,
    maxOutputTokens: 16_384,
    toolCallFormat: 'openai',
    structuredOutputMode: 'json-schema',
    ...overrides,
  };
}

export function registryEntry(
  modelId: string,
  overrides: Partial<ModelRegistryEntry> = {},
): ModelRegistryEntry {
  return {
    provider: 'groq',
    modelId,
    displayName: modelId,
    freeTierClass: 'free-tier' as FreeTierClass,
    capabilities: capabilities(),
    tags: [] as ModelTag[],
    verification: { verifiedAt: '2026-11-01', source: 'provider-docs' },
    ...overrides,
  };
}

export function descriptor(
  modelId: string,
  overrides: Partial<ModelDescriptor> = {},
): ModelDescriptor {
  return {
    provider: 'groq',
    modelId,
    displayName: modelId,
    freeTierClass: 'free-tier',
    capabilities: capabilities(),
    source: 'provider-api',
    ...overrides,
  };
}

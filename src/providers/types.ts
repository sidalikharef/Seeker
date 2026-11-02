export const PROVIDER_IDS = ['openrouter', 'groq'] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type FreeTierClass =
  'free-tier' | 'trial-credit' | 'paid' | 'subscription' | 'local' | 'unknown';

export type TriState = boolean | 'unknown';

export interface ModelCapabilities {
  supportsStreaming: TriState;
  supportsTools: TriState;
  supportsParallelTools: TriState;
  supportsStructuredOutput: TriState;
  supportsImages: TriState;
  supportsReasoning: TriState;
  supportsPromptCaching: TriState;
  contextWindow?: number;
  maxOutputTokens?: number;
  toolCallFormat?: 'openai' | 'gemini' | 'anthropic' | 'unknown';
  structuredOutputMode?: 'json-schema' | 'json-object' | 'none' | 'unknown';
}

export interface ModelPricing {
  inputPerMTok?: number;
  outputPerMTok?: number;
  currency: 'USD';
}

export interface ModelDescriptor {
  provider: ProviderId;
  modelId: string;
  displayName: string;
  freeTierClass: FreeTierClass;
  capabilities: ModelCapabilities;
  contextWindow?: number;
  maxOutputTokens?: number;
  pricing?: ModelPricing;
  verifiedAt?: string;
  source: 'provider-api' | 'static-registry' | 'user-config';
  notes?: string[];
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type JsonSchema = Record<string, unknown>;

export interface ToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface NormalizedMessage {
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolSchema {
  name: string;
  description?: string;
  parameters: JsonSchema;
}

export interface ChatRequest {
  model: string;
  messages: NormalizedMessage[];
  tools?: ToolSchema[];
  toolChoice?: 'auto' | 'none' | { name: string };
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: { type: 'text' } | { type: 'json'; schema: JsonSchema };
  stop?: string[];
  metadata?: Record<string, string>;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimated?: boolean;
}

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  resetAt?: string;
}

export interface RateLimitMetadata {
  source: 'headers' | 'endpoint';
  requests?: RateLimitInfo;
  tokens?: RateLimitInfo;
  retryAfterMs?: number;
  capturedAt: string;
}

export type FinishReason =
  'stop' | 'length' | 'tool_calls' | 'content_filter' | 'cancelled' | 'unknown';

export type ProviderErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'quota_exhausted'
  | 'bad_request'
  | 'context_overflow'
  | 'model_not_found'
  | 'capability'
  | 'server'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'unknown';

export interface NormalizedProviderError {
  provider: ProviderId;
  model?: string;
  kind: ProviderErrorKind;
  httpStatus?: number;
  retryAfterMs?: number;
  resetAt?: string;
  providerCode?: string;
  message: string;
  retryable: boolean;
}

export type ModelEvent =
  | { type: 'text-delta'; text: string }
  | {
      type: 'tool-call-delta';
      index: number;
      id?: string;
      name?: string;
      argumentsDelta?: string;
    }
  | { type: 'usage'; usage: Usage }
  | { type: 'rate-limit'; metadata: RateLimitMetadata }
  | { type: 'finish'; reason: FinishReason; usage?: Usage }
  | { type: 'error'; error: NormalizedProviderError };

export interface HealthStatus {
  provider: ProviderId;
  state: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
  checkedAt: string;
  latencyMs?: number;
  message?: string;
}

export interface ProviderKeyStatus {
  provider: ProviderId;
  label?: string;
  limit?: number;
  usage?: number;
  limitRemaining?: number;
  freeModelDailyRequests?: {
    used?: number;
    limit?: number;
    remaining?: number;
  };
  capturedAt: string;
}

export interface CredentialProvider {
  get(provider: ProviderId): Promise<string | undefined>;
  set(provider: ProviderId, key: string): Promise<void>;
  delete(provider: ProviderId): Promise<void>;
  has(provider: ProviderId): Promise<boolean>;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly baseUrl: string;
  readonly freeTierClass: FreeTierClass;
  listModels(signal?: AbortSignal): Promise<ModelDescriptor[]>;
  streamChat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
  healthCheck(signal?: AbortSignal): Promise<HealthStatus>;
}

export interface KeyStatusProvider {
  getKeyStatus(signal?: AbortSignal): Promise<ProviderKeyStatus>;
}

import {
  ProviderRequestError,
  makeProviderError,
  normalizeHttpError,
  normalizeTransportError,
  parseRetryAfter,
  resetAtFromDuration,
} from './errors';
import { requestJson } from './http';
import { streamOpenAiCompatible, toOpenAiRequestBody, type FetchLike } from './openai-compatible';
import type {
  ChatRequest,
  CredentialProvider,
  FreeTierClass,
  HealthStatus,
  KeyStatusProvider,
  ModelCapabilities,
  ModelDescriptor,
  ModelEvent,
  NormalizedProviderError,
  ProviderAdapter,
  ProviderId,
  ProviderKeyStatus,
  RateLimitMetadata,
  TriState,
} from './types';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const GROQ_DAILY_REQUEST_LIMIT = 1_000;

interface StaticModelInfo {
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsParallelTools?: boolean;
  supportsStructuredOutput?: boolean;
  supportsImages?: boolean;
  supportsReasoning?: boolean;
  structuredOutputMode?: ModelCapabilities['structuredOutputMode'];
  notes?: string[];
}

const STATIC_MODELS: Record<string, StaticModelInfo> = {
  'llama-3.3-70b-versatile': {
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStructuredOutput: true,
    structuredOutputMode: 'json-object',
  },
  'llama-3.1-8b-instant': {
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStructuredOutput: true,
    structuredOutputMode: 'json-object',
  },
  'openai/gpt-oss-120b': {
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsReasoning: true,
    structuredOutputMode: 'json-schema',
    notes: ['Structured output is incompatible with tools and streaming.'],
  },
  'openai/gpt-oss-20b': {
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsReasoning: true,
    structuredOutputMode: 'json-schema',
    notes: ['Structured output is incompatible with tools and streaming.'],
  },
  'qwen/qwen3.8-27b': {
    contextWindow: 131_072,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsParallelTools: true,
    supportsStructuredOutput: true,
    supportsReasoning: true,
    structuredOutputMode: 'json-schema',
  },
};

function asTriState(value: boolean | undefined): TriState {
  return value === undefined ? 'unknown' : value;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

interface GroqModelRecord {
  id?: unknown;
  owned_by?: unknown;
  context_window?: unknown;
  max_completion_tokens?: unknown;
  active?: unknown;
}

interface GroqModelsResponse {
  data?: GroqModelRecord[];
}

function parseGroqModel(model: GroqModelRecord, verifiedAt: string): ModelDescriptor | undefined {
  const modelId = stringOrUndefined(model.id);
  if (!modelId) {
    return undefined;
  }

  const staticInfo = STATIC_MODELS[modelId] ?? {};
  const contextWindow = numberOrUndefined(model.context_window) ?? staticInfo.contextWindow;
  const maxOutputTokens =
    numberOrUndefined(model.max_completion_tokens) ?? staticInfo.maxOutputTokens;

  const capabilities: ModelCapabilities = {
    supportsStreaming: true,
    supportsTools: asTriState(staticInfo.supportsTools),
    supportsParallelTools: asTriState(staticInfo.supportsParallelTools),
    supportsStructuredOutput: asTriState(staticInfo.supportsStructuredOutput),
    supportsImages: asTriState(staticInfo.supportsImages),
    supportsReasoning: asTriState(staticInfo.supportsReasoning),
    supportsPromptCaching: 'unknown',
    contextWindow,
    maxOutputTokens,
    toolCallFormat: staticInfo.supportsTools ? 'openai' : 'unknown',
    structuredOutputMode: staticInfo.structuredOutputMode ?? 'unknown',
  };

  return {
    provider: 'groq',
    modelId,
    displayName: modelId,
    freeTierClass: 'free-tier',
    capabilities,
    contextWindow,
    maxOutputTokens,
    verifiedAt,
    source: 'provider-api',
    notes: staticInfo.notes ?? [
      'Free-tier rate limits and model availability can change without notice.',
    ],
  };
}

export function parseGroqRateLimitHeaders(
  headers: Headers,
  now = Date.now(),
): RateLimitMetadata | undefined {
  const requestLimitRaw = headers.get('x-ratelimit-limit-requests');
  const requestRemainingRaw = headers.get('x-ratelimit-remaining-requests');
  const tokenLimitRaw = headers.get('x-ratelimit-limit-tokens');
  const tokenRemainingRaw = headers.get('x-ratelimit-remaining-tokens');
  const requestLimit = requestLimitRaw === null ? Number.NaN : Number(requestLimitRaw);
  const requestRemaining = requestRemainingRaw === null ? Number.NaN : Number(requestRemainingRaw);
  const requestReset = headers.get('x-ratelimit-reset-requests');
  const tokenLimit = tokenLimitRaw === null ? Number.NaN : Number(tokenLimitRaw);
  const tokenRemaining = tokenRemainingRaw === null ? Number.NaN : Number(tokenRemainingRaw);
  const tokenReset = headers.get('x-ratelimit-reset-tokens');

  const hasAny =
    Number.isFinite(requestLimit) ||
    Number.isFinite(requestRemaining) ||
    requestReset !== null ||
    Number.isFinite(tokenLimit) ||
    Number.isFinite(tokenRemaining) ||
    tokenReset !== null;

  if (!hasAny) {
    return undefined;
  }

  return {
    source: 'headers',
    requests: {
      limit: Number.isFinite(requestLimit) ? requestLimit : undefined,
      remaining: Number.isFinite(requestRemaining) ? requestRemaining : undefined,
      resetAt: resetAtFromDuration(requestReset, now),
    },
    tokens: {
      limit: Number.isFinite(tokenLimit) ? tokenLimit : undefined,
      remaining: Number.isFinite(tokenRemaining) ? tokenRemaining : undefined,
      resetAt: resetAtFromDuration(tokenReset, now),
    },
    retryAfterMs: parseRetryAfter(headers.get('retry-after'), now),
    capturedAt: new Date(now).toISOString(),
  };
}

export class GroqProvider implements ProviderAdapter, KeyStatusProvider {
  readonly id: ProviderId = 'groq';
  readonly baseUrl = GROQ_BASE_URL;
  readonly freeTierClass: FreeTierClass = 'free-tier';

  private readonly credentials: CredentialProvider;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(
    credentials: CredentialProvider,
    options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
  ) {
    this.credentials = credentials;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  private async requireApiKey(): Promise<string> {
    const key = await this.credentials.get(this.id);
    if (!key) {
      throw new ProviderRequestError(
        makeProviderError(this.id, 'auth', 'Groq API key is not configured.', {
          retryable: false,
        }),
      );
    }
    return key;
  }

  private headers(apiKey: string): Record<string, string> {
    return { authorization: `Bearer ${apiKey}` };
  }

  private toRequestError(error: unknown, model?: string): ProviderRequestError {
    if (error instanceof ProviderRequestError) {
      return error;
    }
    return new ProviderRequestError(
      normalizeTransportError({
        provider: this.id,
        model,
        error,
        forbiddenKind: 'auth',
      }),
    );
  }

  async listModels(signal?: AbortSignal): Promise<ModelDescriptor[]> {
    const apiKey = await this.requireApiKey();

    try {
      const response = await requestJson<GroqModelsResponse>({
        url: `${this.baseUrl}/models`,
        headers: this.headers(apiKey),
        signal,
        timeoutMs: 30_000,
        fetchImpl: this.fetchImpl,
      });

      const models = Array.isArray(response.data.data) ? response.data.data : [];
      const verifiedAt = new Date().toISOString();
      return models
        .filter((model) => model.active !== false)
        .map((model) => parseGroqModel(model, verifiedAt))
        .filter((model): model is ModelDescriptor => model !== undefined);
    } catch (error) {
      throw this.toRequestError(error);
    }
  }

  async getKeyStatus(signal?: AbortSignal): Promise<ProviderKeyStatus> {
    await this.requireApiKey();
    void signal;

    return {
      provider: this.id,
      label: 'Groq free tier',
      freeModelDailyRequests: {
        limit: GROQ_DAILY_REQUEST_LIMIT,
      },
      capturedAt: new Date().toISOString(),
    };
  }

  streamChat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const run = async function* (provider: GroqProvider): AsyncGenerator<ModelEvent> {
      const apiKey = await provider.requireApiKey();
      yield* streamOpenAiCompatible({
        provider: provider.id,
        url: `${provider.baseUrl}/chat/completions`,
        headers: provider.headers(apiKey),
        body: toOpenAiRequestBody(request),
        model: request.model,
        signal,
        fetchImpl: provider.fetchImpl,
        timeoutMs: provider.timeoutMs,
        parseRateLimitHeaders: parseGroqRateLimitHeaders,
        normalizeError: ({ status, headers, bodyText }): NormalizedProviderError =>
          normalizeHttpError({
            provider: provider.id,
            model: request.model,
            status,
            headers,
            bodyText,
            forbiddenKind: 'auth',
          }),
      });
    };

    return run(this);
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const startedAt = Date.now();
    try {
      await this.listModels(signal);
      return {
        provider: this.id,
        state: 'healthy',
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const normalized =
        error instanceof ProviderRequestError
          ? error.normalized
          : this.toRequestError(error).normalized;
      return {
        provider: this.id,
        state:
          normalized.kind === 'network' || normalized.kind === 'timeout'
            ? 'degraded'
            : 'unavailable',
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        message: normalized.message,
      };
    }
  }
}

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
  ModelPricing,
  ProviderAdapter,
  ProviderId,
  ProviderKeyStatus,
  RateLimitMetadata,
  TriState,
} from './types';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const FREE_MODEL_DAILY_REQUESTS = 50;
const FREE_MODEL_DAILY_REQUESTS_WITH_CREDITS = 1_000;

interface OpenRouterModelRecord {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  architecture?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
  supported_parameters?: unknown;
  pricing?: Record<string, unknown>;
  top_provider?: { max_completion_tokens?: unknown };
}

interface OpenRouterModelsResponse {
  data?: OpenRouterModelRecord[];
}

interface OpenRouterKeyRecord {
  label?: unknown;
  limit?: unknown;
  usage?: unknown;
  limit_remaining?: unknown;
  free_tier?: unknown;
  is_free_tier?: unknown;
  free_model_daily_requests?: unknown;
  free_models_daily_requests?: unknown;
  free_model_daily_requests_used?: unknown;
  free_models_daily_requests_used?: unknown;
}

interface OpenRouterKeyResponse {
  data?: OpenRouterKeyRecord;
}

function asTriState(value: boolean | undefined): TriState {
  return value === undefined ? 'unknown' : value;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function perMillion(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * 1_000_000 : undefined;
}

function parseCapabilities(
  model: OpenRouterModelRecord,
  maxOutputTokens: number | undefined,
): ModelCapabilities {
  const supported = stringArray(model.supported_parameters);
  const inputModalities = stringArray(model.architecture?.input_modalities);
  const has = (name: string): boolean =>
    supported.some((parameter) => parameter.toLowerCase() === name);

  return {
    supportsStreaming: true,
    supportsTools: asTriState(has('tools')),
    supportsParallelTools: asTriState(has('parallel_tool_calls') || has('tools')),
    supportsStructuredOutput: asTriState(has('response_format') || has('structured_outputs')),
    supportsImages: asTriState(inputModalities.includes('image')),
    supportsReasoning: asTriState(has('reasoning') || has('include_reasoning')),
    supportsPromptCaching: asTriState(has('cache_control')),
    contextWindow: numberOrUndefined(model.context_length),
    maxOutputTokens,
    toolCallFormat: has('tools') ? 'openai' : 'unknown',
    structuredOutputMode: has('response_format') ? 'json-schema' : 'unknown',
  };
}

function parsePricing(model: OpenRouterModelRecord): ModelPricing | undefined {
  const input = perMillion(model.pricing?.prompt);
  const output = perMillion(model.pricing?.completion);
  if (input === undefined && output === undefined) {
    return undefined;
  }
  return { inputPerMTok: input, outputPerMTok: output, currency: 'USD' };
}

function isFreeModel(model: OpenRouterModelRecord, pricing: ModelPricing | undefined): boolean {
  const id = stringOrUndefined(model.id) ?? '';
  if (id.endsWith(':free')) {
    return true;
  }
  return pricing?.inputPerMTok === 0 && pricing.outputPerMTok === 0;
}

function parseModel(model: OpenRouterModelRecord, verifiedAt: string): ModelDescriptor | undefined {
  const modelId = stringOrUndefined(model.id);
  if (!modelId) {
    return undefined;
  }

  const pricing = parsePricing(model);
  const maxOutputTokens = numberOrUndefined(model.top_provider?.max_completion_tokens);
  const contextWindow = numberOrUndefined(model.context_length);
  const free = isFreeModel(model, pricing);

  return {
    provider: 'openrouter',
    modelId,
    displayName: stringOrUndefined(model.name) ?? modelId,
    freeTierClass: free ? 'free-tier' : 'paid',
    capabilities: parseCapabilities(model, maxOutputTokens),
    contextWindow,
    maxOutputTokens,
    pricing,
    verifiedAt,
    source: 'provider-api',
    notes: free ? ['Free variant; subsidized and may be rate-limited or removed.'] : undefined,
  };
}

export function parseOpenRouterRateLimitHeaders(
  headers: Headers,
  now = Date.now(),
): RateLimitMetadata | undefined {
  const limitRaw = headers.get('x-ratelimit-limit');
  const remainingRaw = headers.get('x-ratelimit-remaining');
  const limit = limitRaw === null ? Number.NaN : Number(limitRaw);
  const remaining = remainingRaw === null ? Number.NaN : Number(remainingRaw);
  const reset = headers.get('x-ratelimit-reset');

  if (!Number.isFinite(limit) && !Number.isFinite(remaining) && !reset) {
    return undefined;
  }

  return {
    source: 'headers',
    requests: {
      limit: Number.isFinite(limit) ? limit : undefined,
      remaining: Number.isFinite(remaining) ? remaining : undefined,
      resetAt: resetAtFromDuration(reset, now),
    },
    retryAfterMs: parseRetryAfter(headers.get('retry-after'), now),
    capturedAt: new Date(now).toISOString(),
  };
}

export class OpenRouterProvider implements ProviderAdapter, KeyStatusProvider {
  readonly id: ProviderId = 'openrouter';
  readonly baseUrl = OPENROUTER_BASE_URL;
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
        makeProviderError(this.id, 'auth', 'OpenRouter API key is not configured.', {
          retryable: false,
        }),
      );
    }
    return key;
  }

  private headers(apiKey: string): Record<string, string> {
    return {
      authorization: `Bearer ${apiKey}`,
      'http-referer': 'https://github.com/sidalikharef/Seeker',
      'x-title': 'Seeker',
    };
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
        forbiddenKind: 'quota_exhausted',
      }),
    );
  }

  async listModels(signal?: AbortSignal): Promise<ModelDescriptor[]> {
    try {
      const response = await requestJson<OpenRouterModelsResponse>({
        url: `${this.baseUrl}/models`,
        signal,
        timeoutMs: 30_000,
        fetchImpl: this.fetchImpl,
      });

      const models = Array.isArray(response.data.data) ? response.data.data : [];
      const verifiedAt = new Date().toISOString();
      return models
        .map((model) => parseModel(model, verifiedAt))
        .filter((model): model is ModelDescriptor => model !== undefined);
    } catch (error) {
      throw this.toRequestError(error);
    }
  }

  async getKeyStatus(signal?: AbortSignal): Promise<ProviderKeyStatus> {
    const apiKey = await this.requireApiKey();

    try {
      const response = await requestJson<OpenRouterKeyResponse>({
        url: `${this.baseUrl}/key`,
        headers: this.headers(apiKey),
        signal,
        timeoutMs: 30_000,
        fetchImpl: this.fetchImpl,
      });

      const data = response.data.data ?? {};
      const limit = numberOrUndefined(data.limit);
      const usage = numberOrUndefined(data.usage);
      const remaining =
        numberOrUndefined(data.limit_remaining) ??
        (limit !== undefined && usage !== undefined ? Math.max(0, limit - usage) : undefined);

      const dailyUsed = numberOrUndefined(
        data.free_model_daily_requests_used ?? data.free_models_daily_requests_used,
      );
      const dailyLimitFromApi = numberOrUndefined(
        data.free_model_daily_requests ?? data.free_models_daily_requests,
      );
      const freeTierFlag =
        typeof data.is_free_tier === 'boolean'
          ? data.is_free_tier
          : typeof data.free_tier === 'boolean'
            ? data.free_tier
            : undefined;
      const dailyConfigured =
        dailyLimitFromApi ??
        (freeTierFlag === false
          ? FREE_MODEL_DAILY_REQUESTS_WITH_CREDITS
          : FREE_MODEL_DAILY_REQUESTS);

      return {
        provider: this.id,
        label: stringOrUndefined(data.label),
        limit,
        usage,
        limitRemaining: remaining,
        freeModelDailyRequests: {
          used: dailyUsed,
          limit: dailyConfigured,
          remaining: dailyUsed === undefined ? undefined : Math.max(0, dailyConfigured - dailyUsed),
        },
        capturedAt: new Date().toISOString(),
      };
    } catch (error) {
      throw this.toRequestError(error);
    }
  }

  streamChat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const run = async function* (provider: OpenRouterProvider): AsyncGenerator<ModelEvent> {
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
        parseRateLimitHeaders: parseOpenRouterRateLimitHeaders,
        normalizeError: ({ status, headers, bodyText }) =>
          normalizeHttpError({
            provider: provider.id,
            model: request.model,
            status,
            headers,
            bodyText,
            forbiddenKind: 'quota_exhausted',
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

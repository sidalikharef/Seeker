# MODEL ROUTER

## 1. Objective

Provide one normalized interface for many hosted and local providers, select a model that is both capable and available, and explain every selection and fallback.

## 2. Separation of Concerns

The router distinguishes three independent facts:

| Fact | Source | Example |
|---|---|---|
| **Existence** | Provider model discovery | `openai/gpt-oss-120b` is listed |
| **Capability** | Registry + provider metadata | Supports tools, 131k context |
| **Availability** | Runtime quota/health state | Free daily quota exhausted |

A model can exist and be capable but unavailable. A model can be available but incapable of tool calling. The router must handle each case.

## 3. Provider Abstraction

```ts
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

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly baseUrl: string;
  readonly freeTierClass: FreeTierClass;

  listModels(signal?: AbortSignal): Promise<ModelDescriptor[]>;
  streamChat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
  healthCheck(signal?: AbortSignal): Promise<HealthStatus>;
}
```

Adapters must:

- Use `fetch` with `AbortSignal`; do not require vendor SDKs.
- Normalize streaming deltas into `ModelEvent`.
- Normalize errors into `NormalizedProviderError`.
- Parse rate-limit headers when present.
- Never log authorization headers or message bodies by default.
- Support cancellation at any point.

## 4. Normalized Errors

```ts
export type ProviderErrorKind =
  | 'auth' | 'rate_limit' | 'quota_exhausted' | 'bad_request'
  | 'context_overflow' | 'model_not_found' | 'capability'
  | 'server' | 'network' | 'timeout' | 'cancelled' | 'unknown';

export interface NormalizedProviderError {
  provider: ProviderId;
  model?: string;
  kind: ProviderErrorKind;
  httpStatus?: number;
  retryAfterMs?: number;
  resetAt?: string;          // ISO timestamp when authoritative
  providerCode?: string;
  message: string;           // redacted, user-safe
  retryable: boolean;
}
```

Rules:

- HTTP `429` is not automatically "quota exhausted". Use `Retry-After`, provider error codes, and quota endpoints to distinguish short-term rate limiting from a daily/monthly exhaustion.
- HTTP `401/403` is `auth` or `quota_exhausted` depending on provider metadata; never retry blindly.
- HTTP `400` is `bad_request`; do not retry without changing the request.
- Context overflow triggers one compaction attempt, not an infinite retry.

## 5. Model Descriptor

```ts
export interface ModelDescriptor {
  provider: ProviderId;
  modelId: string;
  displayName: string;
  freeTierClass: FreeTierClass;
  capabilities: ModelCapabilities;
  contextWindow?: number;
  maxOutputTokens?: number;
  pricing?: { inputPerMTok?: number; outputPerMTok?: number; currency: 'USD' };
  verifiedAt?: string;         // ISO date
  source: 'provider-api' | 'static-registry' | 'user-config';
  notes?: string[];
}
```

## 6. Routing Inputs

```ts
export interface RoutingRequest {
  taskKind: 'chat' | 'plan' | 'code' | 'debug' | 'review';
  required: {
    tools: boolean;
    streaming: boolean;
    structuredOutput?: boolean;
    minContextWindow?: number;
    images?: boolean;
  };
  policy: RoutingPolicy;
  maxCostUsd?: number;         // default 0
  allowPaid?: boolean;         // default false
  excludeProviders?: ProviderId[];
  preferredProvider?: ProviderId;
  preferredModel?: string;
}
```

## 7. Routing Policies

| Policy | Behavior |
|---|---|
| `manual` | Use the user-selected provider/model; fail if unavailable |
| `free-first` | Prefer `free-tier` models with required capabilities; never silently use paid |
| `fast` | Prefer low-latency models; still free unless `allowPaid` |
| `coding` | Prefer models marked `coding` in the registry with tools |
| `reasoning` | Prefer models marked `reasoning`; may use more tokens |
| `automatic` | Score eligible models by capability fit, free-tier class, health, measured latency, success rate, and recent failure rate |

### 7.1 Automatic scoring (explainable)

```text
score =
    capabilityFit        (0..40)
  + freeTierPreference    (0..25)
  + healthScore           (0..15)
  + latencyScore          (0..10)
  + successRateScore      (0..10)
  - costPenalty           (0..∞)
  - recentFailurePenalty  (0..20)
```

Every selection emits a `model.selected` event with a human-readable reason string and the score components. Scores use measured data only; no fabricated quality rankings.

## 8. Eligibility Filter

A model is eligible only if:

1. It is present in the registry or discovered from the provider.
2. Its capabilities satisfy every required capability. `unknown` does **not** satisfy `true`.
3. Its provider is enabled and configured before routing begins.
4. Its free-tier class is acceptable under the policy and `allowPaid`.
5. The quota ledger does not show exhaustion, authentication failure, or unavailability.
6. Its context window meets `minContextWindow`; callers set this from the estimated prompt size.
7. It is not excluded by the user.

Ineligible models produce a structured reason, e.g.:

```text
groq/openai/gpt-oss-120b: ineligible — daily free request limit reached (reset 2026-11-02T00:00:00Z)
openrouter/x:free: ineligible — tool calling not declared by provider metadata
```

## 9. Capability Negotiation

Before an autonomous task:

1. Determine required capabilities from the mode and enabled tools.
2. Select only models that declare them.
3. If no model supports tools, refuse autonomous mode and explain why.
4. A constrained JSON protocol fallback is allowed only if:
   - it is implemented and tested for that provider/model,
   - it is marked experimental,
   - the UI warns the user,
   - the agent still validates every action against schemas and permissions.
5. Never infer tool support from a model's name or reputation.

## 10. Fallback Protocol

```text
attempt primary
  ├─ success → continue
  ├─ transient/rate limit → retry (bounded, honor Retry-After)
  ├─ quota exhausted → mark provider/model unavailable
  │     ├─ another eligible free model → notify user → switch
  │     └─ none → pause session, preserve state, explain
  ├─ capability error → re-route to capable model
  ├─ auth error → stop, request credentials
  └─ context overflow → compact once → retry
```

Fallback rules:

- Rebuild the model-specific request from the normalized conversation; do not forward a provider-specific payload.
- Do not replay executed tools.
- Preserve the action log and checkpoints.
- Emit `model.fallback` with `from`, `to`, and `reason`.
- Never fall back to a paid model when `maxCostUsd` is 0 unless the user explicitly approves.

## 11. Provider Health

```ts
export interface HealthStatus {
  provider: ProviderId;
  state: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
  checkedAt: string;
  latencyMs?: number;
  message?: string;
}
```

Health is derived from recent request outcomes plus optional lightweight checks. Do not probe providers aggressively; probes consume free quota.

## 12. Model Discovery

| Provider | Discovery endpoint | Notes |
|---|---|---|
| OpenRouter | `GET https://openrouter.ai/api/v1/models` | Public; includes pricing and `supported_parameters` |
| Groq | `GET https://api.groq.com/openai/v1/models` | Requires auth |
| Gemini | `GET https://generativelanguage.googleapis.com/v1beta/models` | Requires key; different schema |
| Mistral | `GET https://api.mistral.ai/v1/models` | Requires auth |
| Hugging Face | `GET https://router.huggingface.co/v1/models` | Requires token for inference; listing may be public |
| Cerebras | Provider model catalog/API | Requires auth; trial credits |
| Ollama | `GET http://localhost:11434/api/tags` | Local only |

Discovery results are cached with a short TTL (for example, 6 hours) and refreshed on explicit user action. Do not call discovery before every request.

## 13. Configuration

```jsonc
{
  "seeker.routing.policy": "free-first",
  "seeker.routing.allowPaid": false,
  "seeker.routing.maxCostUsdPerTask": 0,
  "seeker.routing.preferredProvider": "openrouter",
  "seeker.routing.preferredModel": "",
  "seeker.routing.excludedProviders": []
}
```

Secrets are never stored here; see [SECURITY.md](SECURITY.md). The constrained-JSON tool fallback is not implemented; providers must declare tool support to be eligible for Build mode.

## 13.1 Implementation Notes (Phase 03)

- `src/router/registry.ts`: static seeds, discovery merge, user overrides, conflict capture.
- `src/router/classify.ts`: price parsing, zero-price/free-suffix detection, free/paid helpers.
- `src/router/policy.ts`: six policies and the explainable score components.
- `src/router/router.ts`: eligibility, deterministic selection, structured rejections, fallback and selected events.
- `src/router/quota.ts`: request/token quota records, rate-limit backoff, exhaustion/auth/unavailable states, OpenRouter key reconciliation.
- `src/router/debug.ts`: routing configuration normalization and debug formatting.
- `seeker.debug.showSelection`: prints the current selection, every model's eligibility reason, and registry conflicts using cached discovery only.
- Defaults are enforced in configuration: `free-first`, `allowPaid: false`, `maxCostUsdPerTask: 0`, no preferred or excluded providers.

## 14. Test Requirements

- Table-driven tests for eligibility filtering, including `unknown` capabilities.
- Error normalization tests for each provider's documented error shapes.
- Quota exhaustion vs rate limiting classification tests.
- Fallback tests proving side effects are not replayed.
- Explainability tests proving every automatic selection has a reason and score breakdown.
- Mock adapters for deterministic agent tests.

## 15. Related Documents

- [QUOTA_AND_ROUTING.md](QUOTA_AND_ROUTING.md)
- [MODEL_CAPABILITIES.md](../providers/MODEL_CAPABILITIES.md)
- [PROVIDER_MATRIX.md](../providers/PROVIDER_MATRIX.md)
- [AGENT_ENGINE.md](AGENT_ENGINE.md)

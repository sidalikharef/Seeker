# QUOTA AND ROUTING

## 1. Why This Is a Core Feature

SEEKER's default operating mode relies on free hosted inference. Free tiers are limited, change frequently, and differ in what they expose. A coding agent that treats every failure as "try again" will burn quotas, loop, or silently incur cost.

Quota management is therefore part of the execution engine, not a settings page afterthought.

## 2. Definitions

| Term | Meaning |
|---|---|
| **Rate limit** | Short-window cap (per minute/hour) that resets soon |
| **Quota** | Longer-window allowance (per day/month) or credit balance |
| **Authoritative usage** | Usage reported by the provider (headers, usage endpoint) |
| **Estimated usage** | Local estimate when the provider reports nothing |
| **Exhausted** | Provider indicates the allowance is consumed until a reset time |
| **Trial credit** | One-time or time-bounded credit, not recurring free access |
| **Free tier** | Documented recurring allowance at zero cost |
| **Budget** | User-configured cap on requests, tokens, or money |

Never label a trial credit as a permanent free tier. See [FREE_TIER_POLICY.md](../providers/FREE_TIER_POLICY.md).

## 3. Quota Ledger

```ts
export interface QuotaRecord {
  provider: ProviderId;
  modelId?: string;             // undefined = provider-wide
  scope: 'request' | 'token' | 'credit';
  window: 'minute' | 'hour' | 'day' | 'month' | 'lifetime';
  limit?: number;               // undefined = unknown
  remaining?: number;           // undefined = unknown
  used?: number;
  resetsAt?: string;            // ISO timestamp if known
  source: 'header' | 'endpoint' | 'estimated' | 'static';
  confidence: 'authoritative' | 'estimated' | 'unknown';
  updatedAt: string;
}
```

Ledger rules:

1. Authoritative values always override estimates.
2. Estimates are tracked separately and never presented as authoritative.
3. A `429` without reset information marks the model `rate_limited` with exponential backoff, not `exhausted`.
4. A documented daily-limit error or an endpoint reporting `remaining: 0` marks the model `exhausted` until `resetsAt`.
5. A successful request after a reset clears stale exhaustion.
6. Ledger entries are per provider account, not global.
7. Provider-wide exhaustion/auth/unavailable records override model-specific success until the reset time or explicit clear.

### 3.1 Implementation (Phase 03)

`QuotaLedger` in `src/router/quota.ts` implements:

- `updateQuota` / `getQuota` with authoritative-over-estimate protection.
- `recordSuccess` and `recordError` for auth, rate limit, quota exhaustion, server/network/timeout, and model-not-found outcomes.
- `applyRateLimitMetadata` for request/token buckets from provider headers.
- `reconcileProviderKeyStatus` for OpenRouter `free_model_daily_requests`.
- `markRateLimited`, `markExhausted`, `markDegraded`, `markAuthRequired`, `markUnavailable`, and `markHealthy`.
- `canUse` / `isExhausted` with reset-time expiry and provider-wide precedence.
- `quota.warning` events through an injectable `EventSink`.

Bounded exponential backoff defaults to 1 second, doubles per consecutive temporary failure, and caps at 60 seconds. A provider `Retry-After` wins over local backoff. Daily request/token buckets use `day`; temporary token buckets default to `minute`.

## 4. Header and Error Parsing

### 4.1 Groq (documented)

Headers include `retry-after`, `x-ratelimit-limit-requests` (RPD), `x-ratelimit-remaining-requests` (RPD), `x-ratelimit-reset-requests` (RPD), `x-ratelimit-limit-tokens` (TPM), `x-ratelimit-remaining-tokens` (TPM), `x-ratelimit-reset-tokens` (TPM). `retry-after` appears on `429`.

Parse both request and token buckets; whichever is exhausted first governs.

### 4.2 OpenRouter (documented)

- `GET https://openrouter.ai/api/v1/key` exposes `limit_remaining`, budget data, and `free_model_daily_requests` (`used`, `limit`, `remaining`).
- Free variants are `:free`; documented limits are 20 requests/minute and 50 requests/day, rising to 1,000/day after at least 10 credits have been purchased.
- `402` indicates credit/budget limits; `403` indicates budget guardrails; `429` indicates rate limits. Do not conflate them.
- Failed attempts count toward the daily cap.
- Fallback arrays containing paid models can incur charges even if the first model is `:free`. SEEKER must not send mixed free/paid fallback arrays when spend is zero.

### 4.3 Gemini (documented)

- Limits are per project and model; RPD resets at midnight Pacific.
- `429 RESOURCE_EXHAUSTED` may indicate request or spend limits.
- The exact per-model limits must be read from AI Studio; do not hardcode them.

### 4.4 Mistral

- Rate limits are per organization; `429` on exceed; `X-RateLimit-Remaining` may be present.
- Free mode has limited monthly usage; exact values are account-specific and must be read from the console.

### 4.5 Hugging Face / Cerebras

- Hugging Face free users have no included Inference Providers credits; PRO includes $2/month. Treat as `subscription` or `paid`, not `free-tier`.
- Cerebras offers a $5 trial credit that expires after 30 days and requires a payment method; there is no permanent free tier per its FAQ. Treat as `trial-credit`.

## 5. Estimated Usage

When authoritative usage is unavailable:

- Estimate input tokens with the provider tokenizer if available; otherwise use a documented approximation (for example, `ceil(characters / 4)` for English/code).
- Estimate output tokens from streamed text length.
- Label the record `confidence: 'estimated'`.
- Never block a request solely on an estimate unless the user configured an estimate-based budget.
- Reconcile estimates with authoritative values when they arrive.

Document the estimator and its error characteristics in the implementation.

## 6. Execution Budgets

```ts
export interface TaskBudget {
  maxIterations: number;          // default 40
  maxModelRequests: number;       // default 60
  maxInputTokens?: number;        // optional
  maxOutputTokens?: number;       // optional
  maxCostUsd: number;             // default 0
  maxWallClockMs: number;         // default 30 min
  maxToolCalls: number;           // default 80
}
```

Budgets are checked before each model request and tool call. On exhaustion:

- Stop initiating new work.
- Persist state.
- Emit a clear reason.
- Offer resume with a larger budget if appropriate.

## 7. Availability State Machine

```text
unknown ──success──> healthy
unknown ──429──────> rate_limited ──reset/backoff──> healthy
healthy ──429──────> rate_limited
healthy ──quota────> exhausted ──reset time──> healthy
healthy ──auth─────> auth_required
healthy ──5xx──────> degraded ──success──> healthy
degraded ──repeated failures──> unavailable
```

`rate_limited` is temporary. `exhausted` persists until a known reset or explicit user action. `auth_required` blocks the provider until credentials change.

## 8. Fallback Policy

When the selected model becomes unavailable:

1. Emit `quota.warning` or `model.fallback`.
2. Re-evaluate eligibility under the same policy.
3. If a free, capable model exists, notify the user and switch.
4. If none exists, transition to `paused_quota` and preserve state.
5. Never switch to a paid model when `allowPaid` is false or `maxCostUsd` is 0.
6. Never silently reduce capabilities (for example, switching to a model without tools while in Build mode).
7. Never re-execute prior side effects.

### 8.1 Safe resumability

The session stores an append-only action log:

```ts
export interface ActionRecord {
  actionId: string;              // ULID
  kind: 'model_request' | 'tool_call' | 'checkpoint';
  toolId?: string;
  inputHash?: string;
  idempotencyKey?: string;
  status: 'started' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  resultRef?: string;
  startedAt: string;
  finishedAt?: string;
}
```

Resume algorithm:

1. Load the last checkpoint.
2. Restore conversation and observations.
3. Inspect action records with `status: 'started'` or `'unknown'`.
4. For read-only tools, re-run safely.
5. For write/execute tools with unknown status, **do not re-run**; verify the observable state (file hash, command output artifact) or ask the user.
6. Rebuild the prompt for the newly selected model.
7. Continue from the next intended step.

## 9. Provider Switching UX

The UI must show:

- Current provider/model and free-tier class.
- Why the current model is unavailable.
- The proposed fallback and its free-tier class.
- Whether the fallback supports the required capabilities.
- Any privacy implication of sending context to the new provider.
- A confirm/cancel choice before switching when the switch is not automatic under a user-approved policy.

## 10. Privacy and Free Tiers

Free tiers often have different data policies. For example, Google's free tier states content may be used to improve products; OpenRouter free endpoints may log prompts. SEEKER must:

- Display the provider's data-handling classification before first use.
- Allow per-provider opt-in.
- Support file exclusions.
- Warn when switching to a provider with weaker data handling.

## 11. Metrics

Track locally:

- Requests per provider/model per day.
- Rate-limit events and retries.
- Quota exhaustion events.
- Fallback count and reasons.
- Estimated vs authoritative token usage.
- Cost incurred (should remain 0 by default).
- Recovery success rate after `paused_quota`.

These metrics feed routing scores and the evaluation harness.

## 12. Acceptance Criteria

- [x] A simulated `429` with `Retry-After` retries only after the delay and within the retry bound.
- [x] A simulated daily-quota error pauses the session instead of looping.
- [ ] A provider switch does not re-execute a completed write or terminal command.
- [x] Paid fallback is impossible with `allowPaid: false`.
- [x] Every unavailable model has a human-readable reason.
- [ ] The UI distinguishes free, trial, paid, subscription, local, and unknown. (Phase 04)
- [ ] Estimated usage is never displayed as authoritative. (Ledger support exists; UI arrives later.)

## 13. Related Documents

- [MODEL_ROUTER.md](MODEL_ROUTER.md)
- [PROVIDER_MATRIX.md](../providers/PROVIDER_MATRIX.md)
- [FREE_TIER_POLICY.md](../providers/FREE_TIER_POLICY.md)
- [SESSION_STATE.md](SESSION_STATE.md)

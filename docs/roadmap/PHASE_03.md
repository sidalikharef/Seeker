# PHASE 03 — MODEL ROUTER AND QUOTA PRIMITIVES

## Objective

Select models by capability, free-tier class, availability, and policy; track quotas; and fall back without silent cost or duplicated side effects.

## Starting Repository State

Phase 02 provider adapters, model discovery, normalized errors, and SecretStorage existed. No registry, eligibility logic, routing policy, or quota ledger existed at phase start.

## Dependencies

- Phase 02 complete.

## Scope

- Model registry with tri-state capabilities.
- Free-tier classification.
- Eligibility filtering.
- Routing policies: manual, free-first, fast, coding, reasoning, automatic.
- Quota ledger and rate-limit parsing.
- Provider health tracking.
- Explainable selection and fallback events.
- Unit tests for all policies and exhaustion cases.
- No UI beyond a command that prints the current selection for debugging.

## Architecture Decisions

- Registry combines static seeds, provider discovery, and user overrides. Discovery wins for existence; static data supplies verified capabilities; conflicts are flagged.
- `unknown` capabilities never satisfy a requirement.
- Quota ledger distinguishes rate limits from exhaustion.
- `allowPaid` defaults to `false`; `maxCostUsd` defaults to `0`.
- Automatic scoring uses only measured data; no invented quality rankings.
- Fallback rebuilds the request from normalized state and never replays tools.

## Implementation Tasks

- [x] Create `src/router/registry.ts` with `ModelRegistryEntry` and merge rules.
- [x] Seed verified entries from `docs/providers/MODEL_CAPABILITIES.md`.
- [x] Create `src/router/classify.ts` for free-tier classification and price parsing.
- [x] Create `src/router/policy.ts` with the six routing policies.
- [x] Create `src/router/router.ts` with `select(request)` and structured rejection reasons.
- [x] Create `src/router/quota.ts` with `QuotaLedger`, `QuotaRecord`, and state transitions.
- [x] Implement Groq header parsing into request/token buckets.
- [x] Implement OpenRouter `GET /key` reconciliation and `free_model_daily_requests`.
- [x] Add provider health tracking with bounded retry/backoff.
- [x] Emit `model.selected`, `model.fallback`, and `quota.warning` events.
- [x] Add a `seeker.debug.showSelection` command that prints eligibility for configured models.
- [x] Add configuration for policy, allowPaid, maxCostUsd, preferred/excluded providers.
- [x] Write table-driven tests for eligibility and policy.
- [x] Write tests proving `unknown` capabilities are ineligible.
- [x] Write tests proving paid fallback is impossible by default.
- [x] Write tests for `Retry-After` and daily exhaustion.

## Files and Packages Affected

- `src/router/registry.ts`, `classify.ts`, `policy.ts`, `router.ts`, `quota.ts`
- `src/providers/openrouter.ts`, `groq.ts` (header/key parsing)
- `src/core/events.ts`
- `test/unit/router/*.test.ts`

## API Contracts

```ts
export interface RoutingDecision {
  provider: ProviderId;
  modelId: string;
  reason: string;
  score?: {
    capabilityFit: number;
    freeTier: number;
    health: number;
    latency: number;
    successRate: number;
    costPenalty: number;
    recentFailurePenalty: number;
    total: number;
  };
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
```

## Data Structures

```ts
export type AvailabilityState =
  | 'unknown' | 'healthy' | 'degraded' | 'rate_limited'
  | 'exhausted' | 'auth_required' | 'unavailable';

export interface AvailabilityRecord {
  provider: ProviderId;
  modelId?: string;
  state: AvailabilityState;
  until?: string;
  retryAfterMs?: number;
  updatedAt: string;
  detail?: string;
}
```

## Security Considerations

- Do not log full prompts while scoring.
- Do not call provider quota endpoints more than necessary; they may count against limits.
- Never send a request to a provider the user excluded.
- Respect privacy consent state when choosing providers.

## Error Handling

- No eligible model is a normal, explained outcome, not a crash.
- Rate-limit backoff is bounded; exhaustion never retries before reset.
- Auth failure marks the provider `auth_required` and excludes it.
- Registry conflicts are logged and surfaced in debug output.

## Test Plan

- Unit: each policy selects expected models from a fixture registry.
- Unit: free-first never selects paid when a free capable model exists.
- Unit: `unknown` tool capability is ineligible for Build mode.
- Unit: daily exhaustion marks until reset; a `429` with `Retry-After` does not.
- Unit: OpenRouter `402` is not treated as transient.
- Unit: fallback reason is human-readable and includes the reset time.
- Integration: router + mock adapters under simulated quota failure.

## Acceptance Criteria

- [x] Manual mode selects exactly the configured model or explains why not.
- [x] Free-first prefers free capable models.
- [x] Paid selection is impossible with default settings.
- [x] Every decision and rejection has a reason.
- [x] Quota exhaustion pauses rather than retries.
- [x] Router tests run offline.

## Risks

- Provider metadata may omit capability fields, causing false ineligibility; this is safer than false eligibility.
- Quota endpoints may be stale.
- Scoring could overfit to a small sample; keep weights conservative and documented.

## Definition of Done

- [x] Acceptance criteria pass.
- [x] Router and quota ledger have comprehensive unit tests.
- [x] `docs/architecture/MODEL_ROUTER.md` and `QUOTA_AND_ROUTING.md` match implementation.
- [x] TD-16 is closed for the MVP scope.

## Out of Scope

- Advanced resumability (Phase 11).
- UI for selection (Phase 04).
- Provider billing dashboards.

## Implementation Notes

- `ModelRegistry` combines static seeds, provider discovery, and user overrides. Discovery controls existence; verified static capabilities win over conflicting discovery values; conflicts are recorded for debug output.
- Seeded Groq capabilities align with the provider-docs registry, including the `gpt-oss` structured-output/tools incompatibility and `qwen/qwen3.8-27b`.
- `unknown` capabilities and undeclared context windows never satisfy a requirement.
- Paid or unknown-tier models are rejected unless `allowPaid` is true, `maxCostUsd` is greater than zero, pricing is known, and the estimated cost is within the cap.
- Manual policy selects exactly the configured model or returns structured reasons; it never silently falls back.
- `QuotaLedger` distinguishes temporary `rate_limited` from daily/quota `exhausted`, applies bounded exponential backoff, reconciles OpenRouter key status, records request/token header buckets, and keeps provider-wide failures authoritative across models.
- Router events are emitted through an injectable `EventSink`; `model.selected`, `model.fallback`, and `quota.warning` are implemented.
- `seeker.debug.showSelection` prints the configured policy, selected model, per-model eligibility, and registry conflicts. It reads cached discovery only and does not make network calls.
- `seeker.testConnection` reconciles OpenRouter daily usage into the ledger; clearing a key clears that provider's quota state.
- Fallback routing rebuilds a fresh normalized selection; no tool calls are replayed and no paid model is selected with default settings.

## Tests Executed

| Command | Result |
|---|---|
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm test:unit` | Pass — 13 files, 98 tests |
| `pnpm test:integration` | Pass — 2 files, 3 tests |
| Offline router/quota tests | Pass — registry, classification, all six policies, unknown capabilities, paid gating, rate limits, backoff, daily exhaustion, provider-wide exhaustion, reconciliation, events, debug formatting |
| HTTP integration | Pass — a real mock-server `429` daily-quota response is normalized, recorded, and routed to another free model with a fallback event |

## Deviations and Limitations

- No live provider requests were made; no API keys were available.
- Provider enablement and credential checks happen before routing; the router itself receives the discovered model set and current quota ledger.
- The debug command uses cached discovery when available. It does not refresh models or spend provider quota.
- Context-window eligibility uses the request's `minContextWindow`; prompt-size estimation arrives with context intelligence in a later phase.
- Session pause/resume and UI quota prompts are intentionally deferred.

## Completion Status

**IMPLEMENTED** (local acceptance and tests pass; live provider routing unverified).

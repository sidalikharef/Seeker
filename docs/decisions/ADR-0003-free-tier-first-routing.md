# ADR-0003 — Free-Tier-First Routing with Explicit Consent

## Status

Accepted

## Date

2026-11-01

## Context

The product principle is free cloud AI first, local AI second, paid AI optional. Free tiers are limited, change frequently, and can fail in ways that look like model errors. Users must never be surprised by charges, and the agent must not silently degrade to a paid provider.

## Decision

Route to providers by configured policy:

1. Free-tier providers with available quota.
2. Local providers, if enabled and selected.
3. Paid providers only if the user explicitly enables them and confirms per-session or per-task.

Never fall back from free to paid automatically. Surface quota exhaustion, cooldowns, and capability gaps explicitly. Track quota with a local ledger and treat unknown quota as unknown, not unlimited.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Automatic cheapest-first including paid | Risk of unexpected charges |
| Single provider only | Poor resilience; one outage blocks all work |
| Treat free tiers as unlimited | False and leads to broken UX |
| Hide provider errors behind retries | Masks quota exhaustion and wastes requests |

## Consequences

### Positive

- No surprise billing.
- Predictable behavior when quota runs out.
- Users understand which provider/model handled a task.
- Provider outages can be routed around within the free tier.

### Negative

- More UI for quota and consent.
- Fewer automatic recovery options when all free quota is exhausted.
- Quota accounting differs by provider and may be approximate.

### Security and privacy

- Free tiers may use data for training (for example Gemini). Disclose this before sending workspace content.
- Do not send secrets or excluded files to any provider.

### Operational

- Provider limits must be re-verified; record verification dates.
- Ledger state is local and may drift from server-side counters; reconcile with headers and provider endpoints where available.

## Follow-up

- Implement the ledger and cooldowns in Phase 03.
- Document each provider's limits and data policy in [PROVIDER_MATRIX.md](../providers/PROVIDER_MATRIX.md).
- Add a consent dialog for paid providers if they are ever supported.

## References

- [QUOTA_AND_ROUTING.md](../architecture/QUOTA_AND_ROUTING.md)
- [FREE_TIER_POLICY.md](../providers/FREE_TIER_POLICY.md)

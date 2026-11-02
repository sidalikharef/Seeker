# FREE-TIER POLICY

## 1. Product Promise

SEEKER must make free hosted AI the default path. It must not require a paid subscription, a paid API key, a local GPU, or Ollama for its core workflow.

This promise does **not** mean unlimited free inference. It means:

- SEEKER prioritizes providers with documented recurring free usage.
- SEEKER explains limits honestly.
- SEEKER never silently spends money.
- SEEKER fails gracefully when free quotas are exhausted.

## 2. Classification

Every provider/model is classified as exactly one of:

| Class | Definition | UI label |
|---|---|---|
| `free-tier` | Documented recurring zero-cost allowance (for example, OpenRouter `:free`, Groq Free plan, Gemini free tier) | **Free tier** |
| `trial-credit` | Time- or credit-bounded grant that does not renew automatically | **Trial credit** |
| `subscription` | Requires a paid plan (for example, Hugging Face PRO credits) | **Paid plan** |
| `paid` | Pay-per-use, no recurring free allowance | **Paid** |
| `local` | Runs on the user's machine (Ollama) | **Local** |
| `unknown` | Not verified or not exposed by the provider | **Unverified** |

Rules:

- A provider marketing page is not sufficient evidence for `free-tier`.
- A trial credit is never labeled "free".
- A model whose price is zero only because of a temporary promotion is `trial-credit` unless the provider documents recurring free usage.
- Unknown is a valid, visible state. Do not default to "free" or "paid".

## 3. Current Classification (2026-11-01)

| Provider | Class | Notes |
|---|---|---|
| OpenRouter | `free-tier` for `:free` variants | 50 RPD default; 1,000 RPD after ≥10 credits purchased |
| GroqCloud | `free-tier` | Free plan, no card; per-model limits |
| Google Gemini | `free-tier` | Free tokens on certain models; data may improve products |
| Mistral | `free-tier` (limited) | Free mode with limited monthly usage; account-specific |
| Hugging Face | `subscription` / `paid` | Free users have no included credits; PRO has $2/month |
| Cerebras | `trial-credit` | $5 for 30 days, card required; no permanent free tier |
| GitHub Models | `unknown` / unavailable | Retired 2026-07-30 |
| Ollama | `local` | Optional |

See [PROVIDER_MATRIX.md](PROVIDER_MATRIX.md) for sources and dates.

## 4. No Silent Spend

- `seeker.routing.allowPaid` defaults to `false`.
- `seeker.routing.maxCostUsdPerTask` defaults to `0`.
- No fallback may select a paid model when spend is disabled.
- No request may use a provider fallback array that can bill a paid model when spend is disabled.
- If the only eligible model is paid, SEEKER pauses and explains. It does not charge.
- Enabling paid usage requires an explicit settings change and a confirmation dialog.
- A per-task cost estimate is shown before any paid request.

## 5. Honest Limit Reporting

The UI must show:

- Provider and model.
- Free-tier class.
- Known remaining requests/tokens and reset time, if authoritative.
- "Estimated" label when values are local estimates.
- "Unknown" when the provider exposes nothing.
- The verification date for static metadata.

Do not display "unlimited" unless the provider's official documentation explicitly guarantees it. No current provider in this matrix does.

## 6. Exhaustion Behavior

When a free quota is exhausted:

1. Stop the request.
2. Record the reset time if known.
3. Mark the model unavailable in the quota ledger.
4. Look for another eligible free model with the same required capabilities.
5. If found, explain the switch and continue after user notification.
6. If not found, pause the session, preserve state, and explain the options:
   - wait until reset,
   - configure another free provider,
   - explicitly enable paid usage,
   - use a local model (if configured).
7. Never loop, never retry a quota-exhausted model before its reset.

## 7. Fallback Rules

- Fallbacks must preserve required capabilities.
- Fallbacks must preserve the privacy classification or require consent.
- Fallbacks must not replay side effects.
- Fallbacks must be visible in the event stream.
- Free-to-free fallback is allowed automatically under `free-first`.
- Free-to-paid fallback requires explicit opt-in.
- If no fallback exists, fail clearly; do not degrade silently.

## 8. Privacy Disclosure

Before first use of a provider, show:

- What data is sent (task text, selected snippets, tool output).
- Whether the provider's free tier may use data for product improvement.
- Where to read the provider's policy.
- How to exclude files.
- How to revoke the key.

Providers with materially different data handling (for example, free tiers that may log prompts or use content for training) must not be switched to silently.

## 9. Rate Limits vs Quotas

| Signal | Classification | Behavior |
|---|---|---|
| `429` with `Retry-After` | Rate limit | Wait and retry within bounds |
| `429` with daily-limit metadata | Quota exhaustion | Mark until reset; fallback |
| `402` | Credit/budget exhaustion | Stop; do not retry |
| `401`/`403` | Auth or access | Stop; request credentials |
| Provider-specific capacity code | Transient | Bounded retry/fallback |

## 10. User-Configurable Controls

```jsonc
{
  "seeker.routing.policy": "free-first",
  "seeker.routing.allowPaid": false,
  "seeker.routing.maxCostUsdPerTask": 0,
  "seeker.routing.maxRequestsPerTask": 60,
  "seeker.routing.preferProviders": ["openrouter", "groq", "gemini"],
  "seeker.routing.excludedProviders": [],
  "seeker.privacy.providerConsent": {},
  "seeker.context.exclude": []
}
```

## 11. Release Gate

A release cannot claim "free-tier support" unless:

- The provider is integrated and tested.
- The free-tier classification is documented with a verification date.
- Quota exhaustion is simulated in tests.
- The UI displays the classification correctly.
- No paid fallback is possible with default settings.
- The provider's terms permit API use by third-party clients.

## 12. Related Documents

- [PROVIDER_MATRIX.md](PROVIDER_MATRIX.md)
- [QUOTA_AND_ROUTING.md](../architecture/QUOTA_AND_ROUTING.md)
- [MODEL_ROUTER.md](../architecture/MODEL_ROUTER.md)
- [SECURITY.md](../architecture/SECURITY.md)

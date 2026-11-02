# PROVIDER MATRIX

- Verification date: **2026-11-01**
- Method: official provider documentation and, where noted, unauthenticated API probes
- Rule: unverified facts are labeled **unverified**. Nothing here should be treated as a permanent guarantee.

> Free tiers change without notice. Re-verify before each release. SEEKER must read live provider metadata and quota endpoints where available rather than relying on this document at runtime.

## 1. Summary Matrix

| Provider | Base API | Auth | Free class | Model discovery | Streaming | Tool calling | Structured output | MVP priority |
|---|---|---|---|---|---|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | `Authorization: Bearer` | **Free tier** (`:free` models) | `GET /models` (public) | Yes | Model-dependent; declared in `supported_parameters` | Model-dependent | **P0** |
| GroqCloud | `https://api.groq.com/openai/v1` | `Authorization: Bearer` | **Free tier** (no card) | `GET /models` | Yes | Yes (all hosted models per docs) | Yes (strict on select models; not with tools/streaming) | **P0** |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | `x-goog-api-key` header | **Free tier** (model-dependent) | `GET /models` | Yes | Yes | Yes | **P0/P1** |
| Mistral AI | `https://api.mistral.ai/v1` | `Authorization: Bearer` | **Free mode** (limited monthly usage) | `GET /models` | Yes | Model-dependent (verify) | Model-dependent (verify) | P1 |
| Hugging Face | `https://router.huggingface.co/v1` | `Authorization: Bearer` (HF token) | **No free credits for free users**; PRO includes $2/month | `GET /models` | Yes | Model-dependent | Model-dependent | P2 |
| Cerebras | `https://api.cerebras.ai/v1` | `Authorization: Bearer` | **Trial credit only** ($5, 30 days, card required); no permanent free tier | Provider catalog/API | Yes | Model-dependent | Model-dependent | P2 |
| GitHub Models | Retired 2026-07-30 | — | **Unavailable** | — | — | — | — | **Excluded** |
| Ollama (local) | `http://localhost:11434/v1` | None | **Local** | `GET /api/tags` | Yes | Model-dependent | Model-dependent | P3 (Phase 14) |

## 2. OpenRouter

### 2.1 Facts

| Item | Value | Source |
|---|---|---|
| Base URL | `https://openrouter.ai/api/v1` | Official docs |
| Auth | Bearer API key | Official docs |
| Model list | `GET https://openrouter.ai/api/v1/models` | Official docs / probe |
| Free variants | Model IDs ending in `:free`; `openrouter/free` router | Official docs |
| Free limits | 20 requests/minute; 50 requests/day; 1,000/day after ≥10 credits purchased all-time | Official rate-limit docs |
| Quota endpoint | `GET https://openrouter.ai/api/v1/key` → `limit_remaining`, `free_model_daily_requests` | Official docs |
| Error semantics | `402` credit/budget, `403` budget guardrail, `429` rate limit | Official docs |
| Streaming | Yes | Official docs |
| Tool calling | Model-dependent; `supported_parameters` includes `tools` when supported | Models API |
| Structured output | Model-dependent; `response_format` in `supported_parameters` | Models API |
| Data policy | Free endpoints may log prompts; `data_collection: "deny"` can narrow providers | Official blog/docs |

### 2.2 Probe result (2026-11-01)

- `GET /api/v1/models` returned HTTP 200.
- 452 model entries were present.
- 14 entries ended in `:free` at probe time.
- A sampled free entry declared `supported_parameters` including `tools`, `response_format`, `reasoning`, and `max_tokens`.

The number of free models fluctuates. Do not hardcode a count.

### 2.3 Integration notes

- Best first provider: one key unlocks many models.
- Filter candidates by `pricing.prompt === "0"` **and** the `:free` variant, not price alone.
- Never send a fallback array that mixes free and paid models when spend is zero; OpenRouter may bill the paid fallback.
- Parse `free_model_daily_requests.remaining` before long tasks.
- Respect `Retry-After` on `429`.
- `402` must not be treated as a transient rate limit.

## 3. GroqCloud

### 3.1 Facts

| Item | Value | Source |
|---|---|---|
| Base URL | `https://api.groq.com/openai/v1` | Official docs |
| Auth | Bearer API key | Official docs |
| Model list | `GET /models` | Official docs |
| Free plan | Available without a payment method; per-model limits | Official pricing/docs |
| Free limits (examples) | `openai/gpt-oss-120b`: 30 RPM, 1,000 RPD, 8K TPM, 200K TPD; `openai/gpt-oss-20b`: same; `qwen/qwen3.8-27b`: same | Official rate-limit docs |
| Headers | `retry-after`, `x-ratelimit-limit-requests` (RPD), `x-ratelimit-remaining-requests` (RPD), `x-ratelimit-reset-requests`, token equivalents | Official docs |
| Streaming | Yes | Official docs |
| Tool calling | All hosted models support local tool use per docs; parallel support varies | Official tool-use docs |
| Structured output | Strict JSON schema on select models; best-effort on more; **not supported together with streaming or tool use** | Official structured-output docs |
| Data policy | Zero-data-retention option available | Official pricing page |

### 3.2 Integration notes

- Excellent second provider for speed and tool calling.
- `gpt-oss-120b` and `gpt-oss-20b` are documented free-plan models with tool use and strict structured output support (but not simultaneously).
- Because structured output is incompatible with tool use/streaming, do not request both in one call. Choose tool mode for agent turns; use structured output only for non-tool extraction calls.
- Free plan limits are per model and per organization. Read headers; do not assume the example values.
- `498` (Flex Tier capacity exceeded) is provider-specific; treat as transient.

## 4. Google Gemini API

### 4.1 Facts

| Item | Value | Source |
|---|---|---|
| Base URL | `https://generativelanguage.googleapis.com/v1beta` | Official docs |
| Auth | `x-goog-api-key` header (or `key` query parameter; prefer header) | Official docs |
| Model list | `GET /v1beta/models` | Official docs |
| Free tier | Yes; free input/output tokens for certain models; content may be used to improve products | Official pricing docs |
| Limits | Per project, per model; RPM, TPM, RPD; RPD resets midnight Pacific | Official rate-limit docs |
| Latest models | Gemini 3.5 Flash-Lite, Gemini 3.8 Flash recommended for new projects; 2.5 models limited to prior users | Official models/changelog |
| Streaming | Yes | Official docs |
| Tool calling | Yes, including parallel and compositional | Official function-calling docs |
| Structured output | Yes | Official docs |
| Protocol | Native Gemini `generateContent` / `streamGenerateContent`; not OpenAI-compatible by default | Official docs |

### 4.2 Integration notes

- Requires a dedicated adapter; do not assume OpenAI wire format.
- The exact free-tier model list and limits are account-specific and visible in AI Studio. Do not hardcode them; label unknown values as unknown.
- Free-tier data may be used to improve Google products. Show this in the provider consent UI.
- `429 RESOURCE_EXHAUSTED` may be request- or spend-related; classify carefully.
- Use `systemInstruction`, `tools.functionDeclarations`, and `generationConfig` mappings in the adapter.

## 5. Mistral AI

### 5.1 Facts

| Item | Value | Source |
|---|---|---|
| Base URL | `https://api.mistral.ai/v1` | Official docs |
| Auth | Bearer API key | Official docs |
| Model list | `GET /v1/models` | Official docs |
| Free mode | API access enabled by default, no credit card; limited usage and rate limits | Official quickstart/help center |
| Limits | Per organization; RPS, TPM, monthly tokens; exact values account-specific | Official docs |
| Streaming | Yes | Official docs |
| Tool calling | Model-dependent; **verify per model** | Official docs (not exhaustively verified here) |
| Structured output | Model-dependent; **verify per model** | Official docs (not exhaustively verified here) |
| Protocol | Largely OpenAI-compatible chat completions | Official docs |

### 5.2 Integration notes

- Viable P1 provider after OpenRouter, Groq, and Gemini.
- Free-mode monthly allowance is not a permanent guarantee; read the console limits.
- Do not claim tool/structured support for a model until verified in the registry.

## 6. Hugging Face Inference Providers

### 6.1 Facts

| Item | Value | Source |
|---|---|---|
| Router base | `https://router.huggingface.co/v1` | Official docs |
| Auth | HF user access token (`Authorization: Bearer`) | Official docs |
| Model list | `GET /v1/models` returned HTTP 200 on 2026-11-01 | Probe |
| Free users | **No included monthly credits**; must purchase credits | Official pricing docs |
| PRO | $2.00/month included inference credits | Official pricing docs |
| Team/Enterprise | $2.00 per seat/month | Official pricing docs |
| Billing | Pay-as-you-go after credits; no HF markup | Official docs |
| Streaming/tools | Model-dependent | Official docs |

### 6.2 Integration notes

- **Not a free-tier default.** Classify free accounts as `paid` for inference (credits must be purchased) and PRO as `subscription`.
- Useful as an optional router to many models when the user already pays for PRO.
- The earlier "generous free tier" marketing language does not match the current pricing table; follow the table, not the tagline.

## 7. Cerebras Inference

### 7.1 Facts

| Item | Value | Source |
|---|---|---|
| Base URL | `https://api.cerebras.ai/v1` | Official docs |
| Auth | Bearer API key | Official docs |
| Free trial | $5 credit after adding a verified payment method; expires 30 days after grant | Official rate-limit/account docs |
| Permanent free tier | **No**, per official FAQ | Official docs |
| Free-trial limits | Example: `gpt-oss-120b` 5 RPM, 30K uncached TPM, 1M TPD | Official docs |
| Streaming | Yes | Official docs |
| Tools/structured | Model-dependent | Official docs |

### 7.2 Integration notes

- Classify as `trial-credit`, never as `free-tier`.
- Requiring a payment method conflicts with SEEKER's zero-payment default, so Cerebras is P2/optional.
- If integrated, warn that the trial expires and that paid usage may follow.

## 8. GitHub Models

**Retired on 2026-07-30.** The playground, catalog, inference API, and BYOK are no longer available. Do not integrate, document as available, or use in examples. Source: official GitHub changelog.

## 9. Ollama (Local, Optional)

| Item | Value |
|---|---|
| Base URL | `http://localhost:11434/v1` (OpenAI-compatible) |
| Auth | None |
| Model discovery | `GET /api/tags` |
| Cost class | `local` |
| Requirements | User-installed Ollama and sufficient hardware |
| Phase | 14 (optional) |

Local inference is never required for the MVP.

## 10. Provider Priority and Rationale

1. **OpenRouter** — broadest free-model access through one key and one protocol; ideal first integration.
2. **GroqCloud** — genuine free plan, fast inference, strong tool calling, OpenAI-compatible.
3. **Gemini** — genuine free tier with strong tool/structured support; requires a native adapter.
4. **Mistral** — free mode and OpenAI-compatible; P1 after the first three.
5. **Hugging Face** — optional for PRO subscribers; not free-tier.
6. **Cerebras** — optional trial only; not free-tier.
7. **Ollama** — optional privacy/offline mode.

## 11. Runtime Verification Requirements

SEEKER must not treat this matrix as live state. At runtime:

- Fetch model lists from providers with a cached TTL.
- Read quota headers/endpoints.
- Classify free tier from explicit metadata plus user-configured overrides.
- Display the verification date of static registry entries.
- Re-verify documentation before each release.

## 12. Sources

- OpenRouter: <https://openrouter.ai/docs/api_reference/limits>, <https://openrouter.ai/docs/faq>, <https://openrouter.ai/docs/guides/routing/model-variants/free>, <https://openrouter.ai/pricing>
- Groq: <https://console.groq.com/docs/rate-limits>, <https://console.groq.com/docs/models>, <https://console.groq.com/docs/tool-use>, <https://console.groq.com/docs/structured-outputs>
- Gemini: <https://ai.google.dev/gemini-api/docs/rate-limits>, <https://ai.google.dev/gemini-api/docs/pricing>, <https://ai.google.dev/gemini-api/docs/models>, <https://ai.google.dev/gemini-api/docs/generate-content/function-calling>
- Mistral: <https://docs.mistral.ai/admin/billing-usage/usage-limits>, <https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them>, <https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key>
- Hugging Face: <https://huggingface.co/docs/inference-providers/pricing>
- Cerebras: <https://inference-docs.cerebras.ai/support/rate-limits>, <https://inference-docs.cerebras.ai/console/account-billing>, <https://www.cerebras.ai/pricing>
- GitHub Models retirement: <https://github.blog/changelog/2026-07-30-github-models-is-now-retired/>

## 13. Related Documents

- [FREE_TIER_POLICY.md](FREE_TIER_POLICY.md)
- [MODEL_CAPABILITIES.md](MODEL_CAPABILITIES.md)
- [MODEL_ROUTER.md](../architecture/MODEL_ROUTER.md)
- [QUOTA_AND_ROUTING.md](../architecture/QUOTA_AND_ROUTING.md)

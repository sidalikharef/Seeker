# MODEL CAPABILITIES REGISTRY

## 1. Objective

Track what each model can actually do, with provenance and verification dates, so the router never selects an incapable model for an autonomous task.

## 2. Capability Shape

```ts
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
```

Rules:

- Unknown is explicit. `unknown` never satisfies a `true` requirement.
- Capabilities are per provider/model pair, not per model family.
- Capabilities can change when a provider updates an endpoint; re-verify periodically.
- Capabilities are separate from availability (quota/health).

## 3. Registry Entry

```ts
export interface ModelRegistryEntry {
  provider: ProviderId;
  modelId: string;
  displayName: string;
  freeTierClass: FreeTierClass;
  capabilities: ModelCapabilities;
  pricing?: { inputPerMTok?: number; outputPerMTok?: number; currency: 'USD' };
  tags: Array<'coding' | 'reasoning' | 'fast' | 'long-context' | 'vision'>;
  verification: {
    verifiedAt: string;
    source: 'provider-api' | 'provider-docs' | 'measured' | 'community';
    notes?: string;
  };
  knownIssues?: string[];
  eval?: {
    tasksRun: number;
    successRate?: number;
    avgToolCalls?: number;
    lastRunAt?: string;
  };
}
```

## 4. Seeded, Verified Entries (2026-11-01)

These entries reflect official documentation. They are seeds, not a complete catalog. Provider discovery must populate the rest at runtime.

### 4.1 Groq — `openai/gpt-oss-120b`

| Field | Value |
|---|---|
| Free class | `free-tier` |
| Context | 131,072 |
| Max output | 65,536 |
| Streaming | `true` |
| Tools | `true` (local and remote; parallel: `false` per docs) |
| Structured output | `true` (strict mode) |
| Constraint | Structured output is not supported together with tool use or streaming |
| Notes | Free-plan example limits: 30 RPM, 1,000 RPD, 8K TPM, 200K TPD |
| Source | Groq models, tool-use, structured-output, rate-limit docs |

### 4.2 Groq — `openai/gpt-oss-20b`

Same as above, except the docs list parallel tool use as `false` and strict structured output as supported.

### 4.3 Groq — `qwen/qwen3.8-27b`

| Field | Value |
|---|---|
| Free class | `free-tier` |
| Context | 131,072 |
| Max output | 16,384 |
| Streaming | `true` |
| Tools | `true` (parallel: `true`) |
| Structured output | `true` (strict mode) |
| Notes | Free-plan example limits: 30 RPM, 1,000 RPD, 8K TPM, 200K TPD |

### 4.4 Google Gemini — `gemini-2.5-flash`

| Field | Value |
|---|---|
| Free class | `free-tier` (free input/output on this model per pricing docs) |
| Context | 1,048,576 |
| Max output | 65,536 |
| Streaming | `true` |
| Tools | `true` (parallel/compositional per docs) |
| Structured output | `true` |
| Reasoning | `true` (thinking budgets) |
| Notes | Access to 2.5 models is limited to users who used them previously; new projects should use 3.5 Flash-Lite or 3.8 Flash |
| Source | Gemini models, function-calling, pricing docs |

### 4.5 Google Gemini — `gemini-3.5-flash-lite` / `gemini-3.8-flash`

| Field | Value |
|---|---|
| Free class | `unknown` until verified in AI Studio for the user's project |
| Tools | `true` per function-calling docs (3.x family) |
| Structured output | `true` |
| Context | Verify in official model docs |
| Notes | Recommended for new projects; free-tier eligibility and quotas are account-specific |

### 4.6 OpenRouter — `:free` variants

| Field | Value |
|---|---|
| Free class | `free-tier` |
| Streaming | `true` |
| Tools | Read `supported_parameters` from the models API; `true` only if `tools` is present |
| Structured output | `true` only if `response_format` is present |
| Context | Per-model `context_length` |
| Notes | 20 RPM / 50 RPD default; 1,000 RPD after ≥10 credits purchased; catalog fluctuates |

OpenRouter entries must be generated dynamically. Do not ship a hardcoded list of free model IDs.

### 4.7 Mistral

No model is seeded as tool-capable until verified. Register discovered models with `supportsTools: 'unknown'` unless the provider metadata explicitly declares support.

### 4.8 Hugging Face / Cerebras

Register discovered models with `unknown` capabilities unless provider metadata declares them. Their free classes are `paid`/`subscription` and `trial-credit`, respectively.

## 5. Capability Negotiation

```ts
export function satisfies(
  capabilities: ModelCapabilities,
  required: Partial<Record<keyof ModelCapabilities, true>>
): boolean {
  return Object.entries(required).every(([key, value]) => {
    if (value !== true) return true;
    return capabilities[key as keyof ModelCapabilities] === true;
  });
}
```

For Build/Debug modes, `supportsTools === true` is mandatory. A model with `'unknown'` is not eligible.

## 6. Discovery Mapping

| Provider field | Maps to |
|---|---|
| OpenRouter `supported_parameters` contains `tools` | `supportsTools: true` |
| OpenRouter `supported_parameters` contains `response_format` | `supportsStructuredOutput: true` |
| OpenRouter `architecture.input_modalities` contains `image` | `supportsImages: true` |
| OpenRouter `context_length` | `contextWindow` |
| OpenRouter `pricing.prompt === "0"` and ID ends `:free` | `freeTierClass: 'free-tier'` |
| Gemini model `supportedGenerationMethods` includes `streamGenerateContent` | `supportsStreaming: true` |
| Gemini docs list function calling | `supportsTools: true` for that model |
| Groq docs model table | context/output/limits |
| Groq tool-use table | tools/parallel |
| Groq structured-output table | structured output |

If a field is absent, record `'unknown'`; do not infer.

## 7. Verification Process

For each seeded model:

1. Read official provider documentation.
2. Record the verification date.
3. Record the source type.
4. Add a known-issues note for constraints (for example, Groq structured output + tools).
5. Optionally run a smoke test with the user's key; store only pass/fail, not the key.
6. Re-verify before release and when the provider changes its catalog.

## 8. Evaluation Data

Capability metadata is not a quality ranking. Quality is tracked separately:

```ts
export interface ModelEvaluation {
  provider: ProviderId;
  modelId: string;
  taskSuite: string;
  tasksRun: number;
  successRate: number;
  avgModelRequests: number;
  avgToolCalls: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  toolCallFailureRate: number;
  lastRunAt: string;
}
```

The router may use evaluation data only when it exists. It must not invent quality scores.

## 9. Known Compatibility Constraints

| Constraint | Provider | Handling |
|---|---|---|
| Structured output cannot be combined with tools or streaming | Groq | Use tool mode for agent turns; separate extraction calls |
| Free-model daily cap applies even to failed attempts | OpenRouter | Count failures in the ledger |
| Mixed free/paid fallback arrays can bill paid models | OpenRouter | Never mix when spend is zero |
| 2.5 models restricted to prior users | Gemini | Prefer 3.5 Flash-Lite / 3.8 Flash; verify access |
| Free tier may use content for product improvement | Gemini | Privacy consent before use |
| Free users have no included inference credits | Hugging Face | Classify as paid/subscription |
| No permanent free tier | Cerebras | Classify as trial-credit |

## 10. Related Documents

- [PROVIDER_MATRIX.md](PROVIDER_MATRIX.md)
- [FREE_TIER_POLICY.md](FREE_TIER_POLICY.md)
- [MODEL_ROUTER.md](../architecture/MODEL_ROUTER.md)
- [AGENT_BENCHMARKS.md](../evaluations/AGENT_BENCHMARKS.md)

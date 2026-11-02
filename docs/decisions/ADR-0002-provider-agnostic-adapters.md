# ADR-0002 — Provider-Agnostic Adapters over Provider SDKs

## Status

Accepted

## Date

2026-11-01

## Context

SEEKER must work across multiple free-tier providers (OpenRouter, Groq, Gemini, Mistral, local endpoints) whose APIs differ in authentication, streaming, tool calls, structured output, and error semantics. Provider SDKs add dependencies, bundle size, and version churn. The MVP must remain installable and auditable.

## Decision

Define a single `ProviderAdapter` interface and implement adapters with the built-in `fetch` API. Do not adopt provider-specific SDKs for the MVP. Normalize requests, stream events, usage, and errors inside each adapter.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| One SDK per provider | Dependency bloat, inconsistent APIs, version conflicts |
| A single aggregator SDK | Adds a dependency and still requires provider-specific behavior |
| OpenAI SDK for all compatible endpoints | Gemini and others are not fully compatible; hides differences |
| No abstraction | Couples the agent loop to one provider |

## Consequences

### Positive

- Small dependency footprint and fewer supply-chain risks.
- Full control over streaming, cancellation, timeouts, and error mapping.
- Adapters are independently testable with local mock servers.
- Easier to add or remove a provider.

### Negative

- We maintain request/response mapping and must track provider changes.
- No SDK conveniences such as retries or typed clients.
- SSE parsing and tool-call normalization are our responsibility.

### Security and privacy

- We control exactly what is sent and logged.
- No SDK telemetry or hidden network calls.
- API keys stay in SecretStorage and are attached only to the intended host.

### Operational

- Provider docs must be re-verified before release claims.
- Each adapter needs contract tests.

## Follow-up

- Implement OpenRouter first, then Groq, then Gemini.
- Record capability support as `supported`, `unsupported`, or `unknown` (see [MODEL_CAPABILITIES.md](../providers/MODEL_CAPABILITIES.md)).

## References

- [MODEL_ROUTER.md](../architecture/MODEL_ROUTER.md)
- [PROVIDER_MATRIX.md](../providers/PROVIDER_MATRIX.md)
- [PHASE_02.md](../roadmap/PHASE_02.md)

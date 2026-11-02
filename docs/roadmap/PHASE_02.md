# PHASE 02 — FREE CLOUD MODEL INFRASTRUCTURE

## Objective

Connect SEEKER to free hosted inference through normalized provider adapters, secure credentials, model discovery, streaming, and structured errors.

## Current Repository State

No HTTP client, provider interface, secret handling, or model discovery exists.

## Dependencies

- Phase 01 complete (build, test, lint, command identity).

## Scope

- Provider interface and normalized event/error types.
- Shared HTTP/SSE transport using `fetch`.
- OpenRouter adapter.
- Groq adapter.
- SecretStorage-backed credential store.
- Model discovery and caching.
- Provider configuration commands/settings.
- Contract tests using recorded fixtures and mock servers.
- No agent loop yet.

## Architecture Decisions

- Use `fetch` and Node built-ins; do not add the OpenAI SDK.
- Normalize all providers into `ModelEvent` and `NormalizedProviderError`.
- Keep adapters in `src/providers/`, free of `vscode` imports.
- Credentials are read by the extension host and passed to adapters through a `CredentialProvider` interface.
- Streaming uses SSE parsing with incremental decoding and cancellation.
- Discovery results are cached for 6 hours with explicit refresh.
- Gemini and Mistral are deferred to later phases; do not add stubs that pretend to work.

## Implementation Tasks

- [x] Create `src/providers/types.ts` with `ProviderAdapter`, `ChatRequest`, `ModelEvent`, `ModelDescriptor`, `NormalizedProviderError`.
- [x] Create `src/shared/result.ts` and `src/core/errors.ts` with typed errors.
- [x] Implement `src/providers/http.ts`: request helper, timeout, abort propagation, SSE line parser, redaction.
- [x] Implement `src/providers/openrouter.ts`:
  - [x] `listModels()` via `GET /api/v1/models`.
  - [x] Map pricing, context length, `supported_parameters`, modalities.
  - [x] `streamChat()` with tools, streaming, and usage.
  - [x] Parse `402`, `403`, `429`, `Retry-After`, and provider error metadata.
  - [x] `getKeyStatus()` via `GET /api/v1/key`.
- [x] Implement `src/providers/groq.ts`:
  - [x] `listModels()` via `GET /api/v1/models`.
  - [x] `streamChat()` with tools.
  - [x] Parse `retry-after`, `x-ratelimit-*` headers.
  - [x] Handle `498` as transient.
- [x] Implement `src/extension/secrets.ts` using `context.secrets`.
- [x] Add commands: `seeker.setApiKey`, `seeker.clearApiKey`, `seeker.refreshModels`, `seeker.testConnection`.
- [x] Add configuration: `seeker.providers.enabled`, `seeker.providers.openrouter.enabled`, `seeker.providers.groq.enabled`.
- [x] Add an output channel with redacted logging.
- [x] Add fixture tests for SSE parsing and error normalization.
- [x] Add a mock HTTP server test for streaming and cancellation.
- [x] Document each adapter's quirks in code comments only where non-obvious (no user-facing docs required here).

## Files and Packages Affected

- `src/providers/types.ts`, `http.ts`, `openrouter.ts`, `groq.ts`
- `src/core/errors.ts`, `src/shared/result.ts`
- `src/extension/secrets.ts`, `src/extension/commands.ts`
- `package.json` contributions (commands, configuration)
- `test/unit/providers/*.test.ts`, `test/integration/providers/*.test.ts`

## API Contracts

```ts
export interface CredentialProvider {
  get(provider: ProviderId): Promise<string | undefined>;
  set(provider: ProviderId, key: string): Promise<void>;
  delete(provider: ProviderId): Promise<void>;
  has(provider: ProviderId): Promise<boolean>;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly freeTierClass: FreeTierClass;
  listModels(signal?: AbortSignal): Promise<ModelDescriptor[]>;
  streamChat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
  healthCheck(signal?: AbortSignal): Promise<HealthStatus>;
}
```

Streaming contract: emit `text-delta` incrementally; emit exactly one terminal `finish` or `error`; never emit both.

## Data Structures

```ts
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimated?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}
```

## Security Considerations

- Keys never enter settings, logs, webview, or error messages.
- Redact `Authorization` and provider key headers in logs.
- Enforce HTTPS except for explicitly configured local endpoints.
- Validate response content types and cap response sizes.
- Do not send repository context in this phase; only connection tests.
- Respect `AbortSignal` to avoid hanging sockets.

## Error Handling

- Map network timeouts to `timeout` with `retryable: true`.
- Map `401/403` to `auth` (or `quota_exhausted` only with explicit evidence).
- Map `429` to `rate_limit` with `retryAfterMs` when available.
- Map malformed SSE to `server` and terminate the stream.
- Never throw raw provider JSON at the UI.

## Test Plan

- Unit: SSE parser handles split chunks, multi-line data, comments, and `[DONE]`.
- Unit: OpenRouter model mapping from a fixture.
- Unit: Groq header parsing.
- Unit: error normalization for 400/401/402/403/429/500.
- Integration: mock server streams text and honors abort.
- Integration: cancellation stops the stream within 100 ms.
- Security: logs do not contain the test key.

## Acceptance Criteria

- [x] A user can set and clear an OpenRouter and Groq key.
- [x] `testConnection` reports success or a normalized failure.
- [x] Model discovery returns normalized descriptors.
- [x] Streaming text arrives incrementally.
- [x] Cancellation aborts the request.
- [x] Keys are absent from logs and settings.
- [x] Tests run without network access.

## Risks

- Provider response shapes change.
- SSE implementations vary in keep-alive behavior.
- Free-tier model catalogs fluctuate.
- Streaming tool-call deltas require careful assembly.

## Definition of Done

- [x] Acceptance criteria pass.
- [x] Adapters are covered by fixture and mock-server tests.
- [x] No provider SDK is added.
- [x] Credentials use SecretStorage.
- [x] `docs/providers/PROVIDER_MATRIX.md` matches implemented behavior.

## Out of Scope

- Routing and quota policy (Phase 03).
- Chat UI (Phase 04).
- Gemini/Mistral/HF/Cerebras adapters.
- Agent tool execution.

## Completion Status

**IMPLEMENTED** — local unit, fixture, and mock-server tests pass. Live OpenRouter/Groq calls remain unverified because no provider API keys were available. Remote CI has not run. Marketplace publication is still blocked by the placeholder publisher identity.

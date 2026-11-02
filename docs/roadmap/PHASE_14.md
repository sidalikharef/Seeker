# PHASE 14 — OPTIONAL LOCAL MODELS

## Objective

Add local inference for privacy, offline use, and user preference without making it a requirement.

## Current Repository State

No local provider exists. The provider interface is designed to accommodate one.

## Dependencies

- Phase 02 (provider interface).
- Phase 03 (router/classification).

## Scope

- Ollama adapter.
- Optional LM Studio or other OpenAI-compatible local endpoints.
- Local model discovery.
- Capability handling with `unknown`.
- Explicit opt-in and resource warnings.
- No bundling of model runtimes.
- No local requirement for MVP.

## Architecture Decisions

- Local providers use the same `ProviderAdapter` interface.
- Base URLs default to `http://localhost:11434/v1` (Ollama) and configurable for LM Studio.
- No authentication by default; do not send credentials to localhost.
- Local models are classified `local`, never `free-tier`.
- Capabilities come from provider metadata where available; otherwise `unknown`.
- The router prefers local only when the user selects it or a `local-first` policy is added later.

## Implementation Tasks

- [ ] Implement `src/providers/ollama.ts` with discovery via `/api/tags` and chat via `/v1/chat/completions`.
- [ ] Implement optional `src/providers/openai-compatible.ts` for LM Studio and similar endpoints.
- [ ] Add settings for local base URL and enabled state.
- [ ] Add a connectivity test command.
- [ ] Handle tool-calling support conservatively.
- [ ] Add a warning when no local runtime is detected.
- [ ] Add tests with a mock local server.
- [ ] Document privacy benefits and hardware limitations.

## Files and Packages Affected

- `src/providers/ollama.ts`, `openai-compatible.ts`
- `src/router/classify.ts`
- `package.json` configuration
- `test/integration/providers/local.test.ts`

## API Contracts

Local adapters implement the standard `ProviderAdapter`. No special-case API in the agent loop.

## Data Structures

Reuse `ModelDescriptor` with `freeTierClass: 'local'` and `source: 'provider-api'`.

## Security Considerations

- Never send API keys to localhost endpoints.
- Validate that configured local URLs are loopback or explicitly approved.
- Local models can still execute tools; permissions apply identically.
- Warn that local models may be weaker at tool use.

## Error Handling

- Runtime not running: clear message with setup guidance.
- Model missing: suggest pulling a model.
- Endpoint unreachable: do not retry indefinitely.
- Unsupported tools: route to a capable model or refuse Build mode.

## Test Plan

- Integration: mock Ollama discovery and streaming.
- Unit: local classification and capability defaults.
- Unit: no credentials sent to localhost.
- Manual: optional real Ollama smoke test.

## Acceptance Criteria

- [ ] User can configure and test a local endpoint.
- [ ] Local models appear in the selector with a `Local` badge.
- [ ] No local runtime is required for normal operation.
- [ ] Tool permissions apply to local models.
- [ ] Unknown capabilities are not treated as supported.

## Risks

- Hardware variability.
- Local models may not support tools or structured output.
- Endpoint compatibility differences.
- Users may expect local models to be as capable as hosted ones.

## Definition of Done

- [ ] Acceptance criteria pass.
- [ ] Local support is optional and documented as such.
- [ ] No model runtime is bundled.
- [ ] Provider matrix updated.

## Out of Scope

- Bundling Ollama or model weights.
- GPU management.
- Local model training/fine-tuning.
- Offline package installation.

## Completion Status

**Not started.**

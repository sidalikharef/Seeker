# Implementation Status

- Current phase: **Phase 04 — VS Code Chat UI** (next)
- Last completed phase: **Phase 03 — Model Router and Quota Primitives** (`IMPLEMENTED`)
- Last updated: 2026-11-02
- Repository: `sidalikharef/Seeker`

## Phase 01 — Project Foundation

Status: **IMPLEMENTED** (local acceptance passed; remote CI pending)

- Standardized the extension identity as `seeker` / `Seeker` with the `seeker.` command namespace.
- Fixed manifest/source command parity.
- Added pnpm, strict TypeScript, ESLint, Prettier, Vitest, extension-host tests, GitHub Actions, and VSIX packaging.
- Added `LICENSE` (MIT), `media/icon.png`, and `ADR-0009`.
- Added the `Seeker` output channel and activation error logging.
- Pinned `@types/vscode` to `1.90.0`.
- `package.json` uses `.vscodeignore` only; `vsce` rejects combining it with `files`.
- Publisher remains the explicit `your-publisher-id` placeholder.

## Phase 02 — Free Cloud Model Infrastructure

Status: **IMPLEMENTED** (local tests pass; live provider calls unverified)

### Completed

- [x] Provider contracts, normalized model/event/error types, and provider IDs (`openrouter`, `groq`).
- [x] Shared `Result`/typed `SeekerError` primitives.
- [x] `fetch`-based HTTP transport with timeouts, abort propagation, response size caps, content-type checks, and JSON helpers.
- [x] Incremental SSE parser supporting split chunks, CRLF, comments, multi-line data, and `[DONE]`.
- [x] OpenAI-compatible streaming mapper for text, tool-call deltas, usage, finish reasons, and exactly one terminal event.
- [x] OpenRouter adapter: public model discovery, pricing/capability mapping, key status, streaming, `402`/`403`/`429` handling, and rate-limit headers.
- [x] Groq adapter: authenticated model discovery, static capability/context augmentation, streaming, `retry-after`, request/token rate-limit headers, and transient `498`.
- [x] Conservative `429` classification: daily/quota evidence only when the provider response says so; otherwise treated as a retryable rate limit.
- [x] SecretStorage-backed `CredentialProvider`; keys are never written to settings or logs.
- [x] Model discovery catalog with a six-hour TTL, forced refresh, in-flight de-duplication, and clear-on-key-delete.
- [x] Commands: `seeker.setApiKey`, `seeker.clearApiKey`, `seeker.refreshModels`, `seeker.testConnection`.
- [x] Configuration: `seeker.providers.enabled`, `seeker.providers.openrouter.enabled`, `seeker.providers.groq.enabled`.
- [x] Redacted output-channel logging.
- [x] Unit tests for parsing, mapping, error normalization, models, cache, commands, and secret-free logging.
- [x] Local mock HTTP server tests for streaming and prompt cancellation.
- [x] Updated README, PHASES index, and this status document.

### Tests Executed

| Command | Result |
|---|---|
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm test:unit` | Pass — 8 files, 46 tests |
| `pnpm test:integration` | Pass — 1 file, 2 tests (local mock server, cancellation under 100 ms) |
| `pnpm format:check` | Pass |
| `pnpm build` | Pass |
| `pnpm test:extension` | Pass — VS Code 1.144.0 activated the extension and executed `seeker.hello` |
| `pnpm package` | Pass — `seeker-0.0.1.vsix`, 22 files, 26.46 KB |

### Deviations and Limitations

- Live OpenRouter and Groq requests were **not** executed; no provider API keys were available. Streaming, discovery, and error behavior are verified against fixtures and a local mock server only.
- OpenRouter key-status daily-request remaining is shown only when the API provides usage; otherwise the configured daily limit is shown without an invented usage value.
- Groq model capability/context metadata is partly static and labeled as such internally; live `/models` metadata overrides context/output limits where present.
- Gemini and Mistral remain deferred. No stubs masquerade as working providers.
- No router, chat UI, workspace tools, terminal integration, or agent loop exists yet.

## Phase 03 — Model Router and Quota Primitives

Status: **IMPLEMENTED** (offline and mock-server acceptance pass; live routing unverified)

### Completed

- [x] `ModelRegistry` with static Groq seeds, provider discovery merging, user overrides, and conflict capture.
- [x] Verified seed alignment: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`.
- [x] Free-tier classification and price parsing.
- [x] Six routing policies: `manual`, `free-first`, `fast`, `coding`, `reasoning`, `automatic`.
- [x] Eligibility filtering with structured rejection reasons and safe `unknown` handling.
- [x] Paid/unknown-tier gating: `allowPaid: false`, `maxCostUsdPerTask: 0`, known pricing, and estimated-cost checks.
- [x] `QuotaLedger` with request/token buckets, authoritative-over-estimate handling, and provider-wide precedence.
- [x] Rate-limit backoff with `Retry-After` precedence, bounded exponential delays, and reset-time exhaustion.
- [x] OpenRouter `GET /key` daily-request reconciliation through `seeker.testConnection`.
- [x] Provider health transitions for auth, degraded, unavailable, success, and repeated failures.
- [x] `model.selected`, `model.fallback`, and `quota.warning` events via an injectable sink.
- [x] `seeker.debug.showSelection` command with eligibility reasons and registry conflicts; cached discovery only.
- [x] Routing configuration: policy, paid permission, max cost, preferred provider/model, excluded providers.
- [x] Key removal clears provider quota state.
- [x] Offline unit tests for registry merging, classification, all policies, unknown capabilities, paid gating, rate limits, backoff, exhaustion, reconciliation, events, commands, and debug formatting.
- [x] Mock HTTP integration test for a real `429` daily-quota response feeding quota and free-model fallback.
- [x] Updated router/quota architecture docs, phase document, README, phase index, and TD-16.

### Tests Executed

| Command | Result |
|---|---|
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm test:unit` | Pass — 13 files, 98 tests |
| `pnpm test:integration` | Pass — 2 files, 3 tests |
| `pnpm format:check` | Pass |
| `pnpm build` | Pass |
| `pnpm test:extension` | Pass — VS Code 1.144.0 activated the extension and ran `seeker.hello` |
| `pnpm package` | Pass — `seeker-0.0.1.vsix`, 29 files, 39.22 KB |

### Deviations and Limitations

- No live OpenRouter or Groq requests were made; no provider API keys were available.
- The router consumes provider configuration, discovered models, and quota state; it does not itself read VS Code settings or credentials.
- `seeker.debug.showSelection` does not refresh models or spend provider quota.
- Prompt-size estimation and automatic context-window filtering belong to Phase 08; callers currently supply `minContextWindow`.
- Session pause/resume, UI quota prompts, tool execution, and the agent loop remain unimplemented.
- No commit exists because no commit was requested.

## Remaining Phase 01 Items

- [ ] Push the branch and confirm GitHub Actions is green remotely.
- [ ] Configure a real publisher identity before Marketplace publication.
- [ ] Commit the working tree (not performed automatically; no commit was requested).

## Known Blockers

- Marketplace publication is blocked by the placeholder publisher identity.
- Remote CI has not run.
- Live provider verification is blocked by missing API keys.

## Next Task

**Phase 04 — VS Code Chat UI:** read `docs/roadmap/PHASE_04.md`, then implement the chat surface and webview/security contract without exposing provider secrets or bypassing routing policy.

## Phase Status Summary

| Phase | Status |
|---|---|
| 00 — Repository Audit | VERIFIED (planning audit) |
| 01 — Project Foundation | IMPLEMENTED |
| 02 — Free Cloud Model Infrastructure | IMPLEMENTED |
| 03 — Model Router and Quota Primitives | IMPLEMENTED |
| 04 — VS Code Chat UI | NOT STARTED (next) |
| 05 — Workspace Tools | NOT STARTED |
| 06 — Terminal Integration | NOT STARTED |
| 07 — Autonomous Agent Loop | NOT STARTED |
| 08 — Context Intelligence | NOT STARTED |
| 09 — Planning System | NOT STARTED |
| 10 — Coding and Debugging Workflows | NOT STARTED |
| 11 — Quota-Aware Continuation | NOT STARTED |
| 12 — Git Integration and Checkpoints | NOT STARTED |
| 13 — Agent Evaluation and Hardening | NOT STARTED |
| 14 — Optional Local Models | NOT STARTED |
| 15 — Browser Automation | NOT STARTED |
| 16 — MCP Integration | NOT STARTED |
| 17 — Multi-Agent Architecture | NOT STARTED |
| 18 — Performance Optimization | NOT STARTED |
| 19 — Release Engineering | NOT STARTED |
| 20 — Future Expansion | NOT STARTED |

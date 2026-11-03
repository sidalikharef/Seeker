# Implementation Status

- Current phase: **Phase 07 — Autonomous Agent Loop** (implemented; automated verification passing; live-provider and actual UI verification unverified)
- Last completed phase: **Phase 06 — Terminal Integration** (`IMPLEMENTED`; automated verification passing; manual UI acceptance unverified)
- Last updated: 2026-11-03
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

## Phase 04 — VS Code Chat UI

Status: **IMPLEMENTED** (MVP scope; local checks pass; live providers unverified)

### Completed

- [x] Activity-bar container `seeker` and webview view `seeker.chat`; activation on `onView:seeker.chat`.
- [x] Secure `WebviewViewProvider` with a per-load nonce, no inline/eval script, `connect-src 'none'`, and nonce-injected styles.
- [x] Validated discriminated protocol for host/webview state, chat, models, credentials, settings, tool activity, and forward-compatible permission events.
- [x] Runtime limits: 32 KiB chat message and 64 KiB webview message; invalid messages are rejected before dispatch.
- [x] Real streaming chat through `ModelRouter`, provider adapters, discovery catalog, registry, and quota ledger.
- [x] Automatic and explicit model selection with free-tier/capability/quota availability reasons.
- [x] Paid-model gating, configured/disabled-provider filtering, and stale-selection pruning.
- [x] Streaming assistant updates, cancellation via `AbortController`, retry without duplicate user messages, and normalized/redacted errors.
- [x] Bounded context (40 messages / 60,000 characters) and bounded persisted history (60 messages).
- [x] Workspace-state persistence for messages and selection; credentials remain in SecretStorage only.
- [x] Sidebar UI with model/routing controls, provider credential buttons, stop/send, keyboard handling, error recovery, code-copy, live-region announcements, and theme variables.
- [x] Only Ask mode is exposed; other modes remain hidden until backend behavior exists.
- [x] Unit tests for chat service, protocol, CSP, and enabled-provider resolution.
- [x] Local HTTP SSE integration test through the real OpenAI-compatible transport into `ChatService`.
- [x] Extension-host test opens the contributed SEEKER view.
- [x] Updated Phase 04 documentation, README, phase index, architecture overview, and TD-14.

### Tests Executed

| Command | Result |
|---|---|
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm test:unit` | Pass — 17 files, 119 tests |
| `pnpm test:integration` | Pass — 3 files, 4 tests |
| `pnpm format:check` | Pass |
| `pnpm build` | Pass |
| `pnpm test:extension` | Pass — VS Code 1.144.0 activated the extension and opened the SEEKER view |
| `pnpm package` | Pass — `seeker-0.0.1.vsix`, 37 files, 59.49 KB |

### Deviations and Limitations

- Only Ask mode is user-visible. Plan, Build, Debug, and Review are deliberately deferred until their backend behavior exists.
- Permission cards and tool activity output are deferred to Phases 05–06; no fake approve/reject controls are exposed.
- Live OpenRouter and Groq streaming remains unverified because no API keys were available. The real transport is exercised against a local HTTP SSE server.
- Automated webview DOM message exchange is not possible through the VS Code test API; the extension test opens the view, while protocol and host chat paths are covered by unit and integration tests.
- Manual keyboard, accessibility, and light/dark visual review remains pending.
- Provider enable/disable changes require a window reload because flags are read at activation.
- No commit exists because no commit was requested.

## Phase 05 — Workspace Tools

Status: **IMPLEMENTED** (local acceptance pass; extension-host validation passed; live UI review pending)

### Completed

- [x] Typed `Tool`, `ToolContext`, `ToolResult`, `ToolError`, permission, preview, and audit contracts.
- [x] Runtime JSON-schema validation with `additionalProperties: false`; invalid arguments never execute.
- [x] Mode-aware `ToolRegistry` and `ToolDispatcher` with permission checks, approval callback, timeouts, cancellation, structured errors, and audit entries.
- [x] Async workspace path resolver with canonical roots, multi-root support, boundary checks, symlink-escape prevention, and new-file parent validation.
- [x] Default secret/build exclusions, `.seekerignore` discovery support, and configurable glob matching.
- [x] `filesystem.read`, `filesystem.list`, `filesystem.write`, and `filesystem.apply_patch`.
- [x] SHA-256 conflict checks, atomic writes, binary rejection, read/write size limits, and exact unified-diff application with CRLF preservation.
- [x] `search.text` and `search.files` with literal/regex matching, includes/excludes, `.seekerignore`, secret/build exclusions, cancellation, and result caps.
- [x] Read-only `git.status` and `git.diff` through `execFile('git')`, no shell, fixed argument construction, non-repository detection, path filtering, and secret exclusion pathspecs.
- [x] `diagnostics.get` through a VS Code-free `DiagnosticsReader` interface, with filtering for excluded files.
- [x] `TrustAwarePermissionManager`, read-only default policy, and privileged-action denial in untrusted workspaces.
- [x] In-memory and JSONL file audit loggers that store argument hashes rather than raw arguments.
- [x] VS Code diagnostics bridge, diff preview adapter, and `WorkspaceToolHost` composition.
- [x] `WorkspaceToolHost` instantiated during extension activation with 9 registered tools.
- [x] Unit and integration coverage for traversal, symlink escapes, exclusions, schema validation, permissions, timeouts, cancellation, audit redaction, patch conflicts, search caps, Git parsing, diagnostics filtering, atomic writes, and diff preview rejection.
- [x] Updated Phase 05, tool-system, security, overview, phase-index, README, implementation-status, and technical-debt documentation.

### Tests Executed

| Command | Result |
|---|---|
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test:unit` | Pass — 28 files, 186 tests |
| `pnpm test:integration` | Pass — 4 files, 6 tests |
| `pnpm format:check` | Pass |
| `pnpm build` | Pass |
| `pnpm test:extension` | Pass — VS Code 1.144.0 activated the extension and opened the SEEKER view |
| `pnpm package` | Pass — `seeker-0.0.1.vsix`, 56 files, 86.04 KB |

### Deviations and Limitations

- Search uses a bounded Node implementation; ripgrep is an optional Phase 18 performance optimization, not a correctness requirement.
- Git is read-only and does not expose ahead/behind counts yet.
- Diff preview uses the VS Code diff view plus a modal confirmation; the diff-preview approval path is covered at the host layer with an injected preview callback, while the actual VS Code diff-view UI remains unverified.
- The extension host defaults to read-only tools and denies privileged actions in untrusted workspaces. Full mode-specific permission UI and autonomous approval flow belong to Phase 07.
- `.seekerignore` controls discovery rather than blocking explicit file access.
- Diagnostics may be stale and are sourced from VS Code rather than a compiler run.
- No commit exists because no commit was requested.

## Phase 06 — Terminal Integration

Status: **IMPLEMENTED; AUTOMATED VERIFICATION PASSING; MANUAL UI ACCEPTANCE UNVERIFIED** (approval UI, prompt contract, session allowlist, and host flows implemented; automated tests pass; actual VS Code modal flow pending).

### Completed

- [x] `src/security/commands.ts` command risk classification, executable allow/deny sets, dangerous-pattern checks, and child-environment filtering.
- [x] `src/tools/terminal.ts` with argv-based `spawn`, no shell, workspace-bound `cwd`, executable validation, and structured results.
- [x] stdout/stderr capture caps, timeout, cancellation, POSIX process-group termination, and Windows `taskkill` tree termination.
- [x] `terminal.execute` schema, result contract, audit metadata, and output-channel command/result display through `WorkspaceToolHost`.
- [x] `execute` permission available in Build and Debug modes through the mode-filtered registry.
- [x] Audit details include redacted command/args, resolved cwd, exit code, signal, duration, byte counts, truncation flags, and captured-output SHA-256.
- [x] Unit tests for command policy, environment filtering, executable/cwd validation, policy blocks, spawn errors, timeouts, cancellation, truncation, audit metadata, and dispatcher denial.
- [x] Integration tests for shell-metacharacter literals, cwd, non-zero exits, output truncation, timeout process-tree cleanup, cancellation process-tree cleanup, and dispatcher audit.
- [x] Exact-command approval bridge (`VscodeCommandApprover`) with run-once and session-scoped choices.
- [x] `SessionCommandAllowlist` bound to exact executable, arguments, cwd, and workspace, with per-session isolation and clearing.
- [x] Preflight validation before permission prompts; invalid commands never reach the approval callback.
- [x] Build/Debug chat modes route through the agent loop and modal approval; Ask/Plan/Review remain read-only.

### Tests Executed

| Command | Result |
|---|---|
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test:unit` | Pass — 35 files, 236 tests |
| `pnpm test:integration` | Pass — 7 files, 22 tests |
| `pnpm format:check` | Pass |
| `pnpm build` | Pass |
| `pnpm test:extension` | Pass — VS Code 1.144.1 activated the extension |
| `pnpm package` | Pass — `seeker-0.0.1.vsix`, 67 files, 112.5 KB |

### Deviations and Limitations

- The approval dialog and exact-command session allowlist are implemented, but an actual approved `pnpm typecheck` run through the UI was not manually recorded.
- Session approvals are memory-only and are cleared when the extension host restarts.
- Permission prompts use a modal warning dialog, not inline webview cards.
- TTY rejection is a heuristic based on known interactive commands and flags.
- Windows process-tree termination is implemented but not validated on Windows.
- The audit output hash covers captured, possibly truncated output.
- Allowlisted system executables can access host paths when approved; this is not an OS-level sandbox.
- No commit exists because no commit was requested.

## Phase 07 — Autonomous Agent Loop

Status: **IMPLEMENTED (automated verification passing; live provider and actual UI unverified)** (offline mock integration passing; live provider and actual rendered UI pending).

### Completed

- [x] Core state, task budgets, action records, observations, verification results, and session factory in `src/core/state.ts`.
- [x] Bounded `AgentLoop` with iteration, model-request, tool-call, per-turn, duplicate, wall-clock, and provider-retry limits.
- [x] Cancellation propagation and safe `cancelled` state; quota failures produce `paused_quota` without replaying completed actions.
- [x] Append-only `AgentEvent` stream with in-memory sink and persisted session event logs.
- [x] `SessionManager` with workspace-state persistence, session listing/loading/deletion, and event history.
- [x] Mode policies and registry enforcement: Ask/Plan/Review read-only; Build/Debug allow approved write/execute.
- [x] Verification engine for file, command/test, diagnostics, diff, and manual criteria.
- [x] Provider error classification, retry delay calculation, and `AgentError` classes.
- [x] Context package assembly with system prompt and character budget.
- [x] `AgentRunner` provider bridge: model selection with tool/streaming capability filtering, provider-safe reversible tool names, collision rejection, streamed tool-call accumulation, and unknown-tool reporting.
- [x] Chat integration for all five modes, mode persistence, tool activity events, assistant streaming, cancellation, quota errors, and unverified-result labeling.
- [x] `tool.requested` events populate UI tool labels before execution; ChatService Build-mode integration is covered by a fake-provider/fake-host test.
- [x] Permission and execution remain behind `ToolDispatcher`, `SessionAwarePermissionManager`, and exact-command approval; the agent cannot bypass workspace trust.
- [x] Unit tests for modes, verification, session persistence, agent runner tool-name mapping/collisions, chat mode behavior, Build-mode tool execution/labels, and approval scoping.
- [x] Integration tests for success, denial, invalid arguments, quota pause, cancellation, duplicate suppression, iteration bounds, and a real broken-TypeScript fixture with actual `tsc --noEmit` evidence.
- [x] Extension-host tests for mocked webview initialization, mode changes, chat submissions, invalid-message handling, and real host tool flows with injected approval/preview callbacks.

### Tests Executed

| Command | Result |
|---|---|
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm test:unit` | Pass — 35 files, 236 tests |
| `pnpm test:integration` | Pass — 7 files, 22 tests |
| `pnpm format:check` | Pass |
| `pnpm build` | Pass |
| `pnpm test:extension` | Pass — VS Code 1.144.1 activated the extension; approval prompt/session tests, real host command/write flows, and mocked webview dispatch passed |
| `pnpm package` | Pass — `seeker-0.0.1.vsix`, 67 files, 112.5 KB |

### Deviations and Limitations

- No live OpenRouter or Groq run was performed; no provider API keys are available. Provider streaming/tool-call behavior is exercised through deterministic mocks and the existing local HTTP mock server tests.
- The end-to-end Phase 07 fixture uses real filesystem and terminal tools and the repository TypeScript compiler, but a mock model. It verifies read, patch, approval, real type-check, and evidence recording.
- Tool-call permission prompts are modal VS Code warnings; inline webview permission cards are not implemented.
- Tool activity is wired to the webview, but automated webview DOM rendering is not possible through the current test harness.
- The workspace-wide write lock is currently the single active `ChatService` request rather than a cross-instance lock coordinator; multi-session concurrent agents are not exposed.
- Session approvals are memory-only; persisted session events and state survive reload, but the approval allowlist does not.
- Interactive TTY detection, Windows process-tree termination, and a true OS sandbox remain unverified/out of scope.
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

**Record the manual live acceptance run:** configure a free OpenRouter or Groq key, switch to Build mode, ask Seeker to fix a small TypeScript error, approve the exact write/type-check commands, confirm the real tool result and verified completion in the UI, then repeat once with denial/cancellation. After that, close Phase 06 and Phase 07 as VERIFIED. Phase 08 remains **NOT STARTED** until the Phase 06 manual/live acceptance prerequisites and Phase 07 live-provider/actual-UI verification are satisfied.

## Phase Status Summary

| Phase | Status |
|---|---|
| 00 — Repository Audit | VERIFIED (planning audit) |
| 01 — Project Foundation | IMPLEMENTED |
| 02 — Free Cloud Model Infrastructure | IMPLEMENTED |
| 03 — Model Router and Quota Primitives | IMPLEMENTED |
| 04 — VS Code Chat UI | IMPLEMENTED |
| 05 — Workspace Tools | IMPLEMENTED |
| 06 — Terminal Integration | IMPLEMENTED; automated passing; manual UI unverified |
| 07 — Autonomous Agent Loop | IMPLEMENTED; automated passing; live/manual unverified |
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

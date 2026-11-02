# SEEKER MASTER PLAN

- Document status: Planning baseline
- Repository state at planning: scaffold only (see [CURRENT_STATE.md](../audit/CURRENT_STATE.md))
- Provider facts verified: 2026-11-01
- Sequencing: dependency-based; no calendar deadlines are asserted

## 1. Product Vision

SEEKER is an open-source autonomous AI software development agent inside VS Code.

A developer should be able to open a project, select a genuinely free hosted model, describe a change, and have SEEKER inspect the repository, plan, edit files, run approved validation commands, and report verified results — without a mandatory paid subscription, a local GPU, or a proprietary model vendor.

**Free cloud AI first. Local AI second. Paid AI optional.**

## 2. Target Users

| User | Need |
|---|---|
| Individual developers | Capable coding assistance without recurring cost |
| Students and learners | Accessible AI development with clear limits |
| Open-source maintainers | Provider-independent, auditable automation |
| Privacy-sensitive developers | Optional local inference and strict exclusions |
| Teams evaluating agents | Extensible, testable architecture without vendor lock-in |

## 3. Primary Use Cases (MVP)

1. Explain and navigate an unfamiliar codebase (Ask).
2. Produce an implementation plan without modifying files (Plan).
3. Implement a small, bounded code change (Build).
4. Diagnose and fix a failing type check or test (Debug).
5. Review a diff for defects and security issues (Review).
6. Continue a task after a free-tier quota pause without duplicating side effects.

## 4. Non-Goals (MVP and near-term)

- Multi-agent parallel execution.
- Browser automation.
- MCP integration.
- Vector databases and embeddings-first retrieval.
- Custom model training or fine-tuning.
- A hosted backend service.
- Autonomous commits, pushes, deployments, or purchases.
- Local inference as a requirement.
- Support for undocumented or consumer-chat scraping endpoints.
- Claims of "unlimited free" access.

## 5. Product Principles (Normative)

1. Free hosted inference is the default.
2. No core logic depends on a single provider.
3. Unknown capabilities are not treated as supported.
4. Permissions are enforced in code.
5. Side effects are never replayed after a retry or provider switch.
6. API keys never enter the webview or logs.
7. Context is minimized and budgeted.
8. Completion requires evidence or an explicit "unverified" label.
9. Every phase leaves a compilable, testable repository.
10. Documentation never describes planned work as complete.

## 6. Architecture Summary

Single-package VS Code extension with strict internal boundaries:

- `src/extension/` — VS Code host, webview, secrets, workspace/terminal adapters.
- `src/core/` — agent loop, sessions, events, verification.
- `src/providers/` — normalized provider adapters using `fetch`.
- `src/router/` — capability registry, routing, quota ledger.
- `src/tools/` — typed, permissioned tools.
- `src/context/` — deterministic repository intelligence and budgeting.
- `src/security/` — permissions, path guards, redaction.

The agent core must not import `vscode`. A monorepo is deferred until a second host exists. See [OVERVIEW.md](../architecture/OVERVIEW.md) and [ADR-0004](../decisions/ADR-0004-agent-core-separate-from-extension.md).

## 7. Provider Strategy

| Priority | Provider | Role | Free class |
|---|---|---|---|
| P0 | OpenRouter | Broad free-model access through one key | Free tier |
| P0 | GroqCloud | Fast, tool-capable free inference | Free tier |
| P0/P1 | Google Gemini | Strong reasoning/tools; native adapter | Free tier |
| P1 | Mistral | Additional free-mode capacity | Free tier (limited) |
| P2 | Hugging Face | Optional for PRO users | Subscription/paid |
| P2 | Cerebras | Optional trial only | Trial credit |
| P3 | Ollama | Optional local/private mode | Local |
| Excluded | GitHub Models | Retired 2026-07-30 | Unavailable |

Details and sources: [PROVIDER_MATRIX.md](../providers/PROVIDER_MATRIX.md). Policy: [FREE_TIER_POLICY.md](../providers/FREE_TIER_POLICY.md).

## 8. Feature Priorities

### P0 — Required for MVP

- Fixed, publishable extension foundation with tests and lint.
- OpenRouter and Groq adapters with streaming, discovery, errors, cancellation.
- SecretStorage credentials.
- Model registry with tri-state capabilities and free-tier classification.
- Quota ledger, rate-limit handling, no silent paid fallback.
- Chat sidebar with streaming and cancellation.
- Read/list/search tools.
- Patch-based editing with conflict detection.
- Approved terminal execution with output capture and cancellation.
- Bounded agent loop with permissions and event stream.
- Minimal verification: command exit code, diagnostics, file checks.
- Session persistence and quota-pause resume.
- Security controls: CSP, path guards, redaction, exclusions.

### P1 — Important after MVP

- Gemini adapter.
- Repository map and TypeScript intelligence.
- Structured planning and step tracking.
- Debug loop with test execution.
- Git diff review and safe checkpoints.
- Evaluation harness with fixtures.
- Mistral adapter.
- Conversation compaction improvements.

### P2 — Advanced

- Hugging Face and Cerebras adapters (with correct classification).
- Browser automation.
- MCP tools with trust boundaries.
- Performance optimization.
- Packaging and marketplace release.

### P3 — Experimental / future

- Multi-agent orchestration (only if benchmarks justify it).
- CLI and desktop hosts.
- Remote/SSH/container execution.
- Plugin ecosystem and collaboration.

## 9. Phase Sequence

| Phase | Name | Depends on | MVP? |
|---|---|---|---|
| 00 | Repository Audit | — | Yes (complete) |
| 01 | Project Foundation | 00 | Yes |
| 02 | Free Cloud Model Infrastructure | 01 | Yes |
| 03 | Model Router and Quota Primitives | 02 | Yes |
| 04 | VS Code Chat UI | 01, 03 | Yes |
| 05 | Workspace Tools | 01 | Yes |
| 06 | Terminal Integration | 05 | Yes |
| 07 | Autonomous Agent Loop | 03, 04, 05, 06 | Yes |
| 08 | Context Intelligence | 05 | No (P1) |
| 09 | Planning System | 07, 08 | No (P1) |
| 10 | Coding and Debugging Workflows | 07, 08, 09 | Yes (minimal slice) |
| 11 | Quota-Aware Continuation | 03, 07 | Yes (basic) |
| 12 | Git Integration and Checkpoints | 05, 07 | P1 |
| 13 | Evaluation and Hardening | 07, 10 | P1 |
| 14 | Optional Local Models | 02, 03 | P3 |
| 15 | Browser Automation | 07, 10 | P2 |
| 16 | MCP Integration | 07, 13 | P2 |
| 17 | Multi-Agent Architecture | 09, 10, 13 | P3 |
| 18 | Performance Optimization | 07–13 | P2 |
| 19 | Release Engineering | 13 | P0 for release |
| 20 | Future Expansion | 19 | P3 |

### 9.1 Reordering decisions

The original prompt placed quota-aware continuation in Phase 11 and verification in Phase 10. This plan makes two adjustments:

1. **Quota primitives move into Phase 03.** Free-tier reliability cannot wait until after the agent loop; the router must already understand exhaustion and fallback. Phase 11 retains advanced resumability and continuation UX.
2. **A minimal verification slice moves into Phases 06–07.** The agent loop is not useful if it cannot check a command exit code or diagnostics. Full test-loop workflows remain in Phase 10.

Rationale: reaching a trustworthy MVP sooner without weakening the architecture.

## 10. Release Milestones

### M0 — Trustworthy scaffold

- Phase 01 complete.
- `pnpm install`, `pnpm build`, `pnpm lint`, `pnpm test`, and F5 launch work from a fresh clone.
- Command IDs match.

### M1 — Free model connectivity

- Phases 02–03 complete.
- OpenRouter and Groq keys stored securely.
- Streaming chat works in a minimal panel.
- Model discovery and capability filtering work.
- Quota exhaustion is simulated and handled.

### M2 — Read-only assistant

- Phases 04–05 complete.
- Ask/Plan modes work.
- Repository search and file reading are safe and bounded.

### M3 — First useful MVP

- Phases 06–07 complete plus minimal Phase 10 and basic Phase 11.
- A user can request a change, review a patch, approve it, run a validation command, and see results.
- Free-tier exhaustion pauses safely.

### M4 — Hardened MVP

- Phase 13 complete.
- Evaluation suite meets quality gates.
- Security tests pass.

### M5 — Public release

- Phase 19 complete.
- Packaging, docs, changelog, and CI release artifacts.

## 11. Release Gates

A release is blocked unless all are true:

- [ ] Type check, lint, unit tests, integration tests, and extension smoke test pass in CI.
- [ ] No P0 technical debt remains for the release scope.
- [ ] Command contribution/registration parity is tested.
- [ ] API keys never appear in webview payloads, logs, or session files (tested).
- [ ] Path traversal, symlink escape, and command-injection tests pass.
- [ ] Free-tier exhaustion simulation pauses without paid fallback.
- [ ] Provider-switch simulation does not replay side effects.
- [ ] Agent evaluation success rate meets the threshold in [QUALITY_GATES.md](../evaluations/QUALITY_GATES.md).
- [ ] Provider matrix re-verified and dated.
- [ ] No unverified "free" claims in UI or docs.

## 12. Critical Path

```text
Audit → Foundation → OpenRouter/Groq adapters → Router + Quota
      → Chat UI → Read/Search Tools → Patch Editing → Terminal
      → Agent Loop → Minimal Verification → MVP
```

Everything else is parallelizable or deferred.

## 13. Testing Strategy Summary

- Unit tests: schemas, quota parsing, routing eligibility, patch application, path guards, token budgeting.
- Integration tests: agent loop with mock providers/tools; provider switching; permission denial.
- VS Code extension tests: activation, command parity, settings, webview messaging, SecretStorage behavior.
- Agent evaluations: fixture repositories with deterministic tasks and measurable metrics.
- Security tests: traversal, symlinks, injection, redaction, CSP.

Full plan: [TEST_STRATEGY.md](../evaluations/TEST_STRATEGY.md).

## 14. Security Requirements Summary

- SecretStorage only; no keys in settings/webview/logs.
- Strict webview CSP and typed message contract.
- Workspace-bound path resolution with symlink protection.
- No shell by default; argument arrays; environment allowlist; process-tree kill.
- Permission enforcement per tool and mode.
- Default exclusions for secrets; per-provider privacy consent.
- Audit log for privileged actions.
- No destructive Git rollback.

Full design: [SECURITY.md](../architecture/SECURITY.md).

## 15. Major Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Free tiers change or disappear | Core promise degrades | Multi-provider router, honest UI, re-verification, local option |
| Free models weak at tool calling | Agent unreliable | Capability negotiation, evaluation, prefer proven models |
| Quota exhaustion mid-task | Broken experience | Ledger, pause/resume, safe fallback |
| Prompt injection | Unauthorized actions | Permissions, approvals, untrusted-content labeling |
| Provider SDK coupling | Vendor lock-in | `fetch`-based adapters, no SDK in core |
| Token inefficiency | Rapid quota burn | Context budgeting, compaction, deterministic retrieval |
| Scope explosion | MVP never ships | Strict P0 scope and deferred phases |
| Silent paid spend | Violates promise | `allowPaid: false`, zero budget, tests |
| Documentation drift | Misleading claims | Audit discipline, completion evidence, verification dates |

## 16. Documentation Map

- Audit: [CURRENT_STATE.md](../audit/CURRENT_STATE.md), [EXISTING_FEATURES.md](../audit/EXISTING_FEATURES.md), [TECHNICAL_DEBT.md](../audit/TECHNICAL_DEBT.md)
- Architecture: [OVERVIEW.md](../architecture/OVERVIEW.md)
- Providers: [PROVIDER_MATRIX.md](../providers/PROVIDER_MATRIX.md)
- Roadmap: [DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md), [MVP_SCOPE.md](MVP_SCOPE.md), `PHASE_00.md` … `PHASE_20.md`
- Evaluations: [TEST_STRATEGY.md](../evaluations/TEST_STRATEGY.md), [AGENT_BENCHMARKS.md](../evaluations/AGENT_BENCHMARKS.md), [QUALITY_GATES.md](../evaluations/QUALITY_GATES.md)
- Decisions: [README.md](../decisions/README.md)

## 17. Next Implementation Task

Phase 01, task 01-01: unify the command identity and fix the manifest/source mismatch, then add a reproducible build/test/lint foundation.

Exact acceptance tests are in [PHASE_01.md](PHASE_01.md).

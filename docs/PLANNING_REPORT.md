# SEEKER — Planning Report

- Date: 2026-11-01
- Scope: repository audit, provider research, architecture, roadmap, and planning documentation
- Implementation status: none; the repository remains a scaffold

## 1. Repository Assessment

SEEKER is an empty VS Code extension scaffold, not an AI coding agent.

- One 11-line source file registers `deepcode.hello`.
- `package.json` contributes `Seeker.hello`, so the only declared command is unreachable.
- No provider client, router, tools, context engine, permissions, webview, agent loop, tests, lint, CI, or packaging exists.
- `tsc --noEmit` and `tsc` both pass; compilation is the only verified capability.
- `pnpm-lock.yaml` is untracked while scripts call `npm`.
- The manifest has a placeholder publisher, an uppercase name, and incomplete metadata.
- `README.md` and `PHASES.md` previously described a DeepSeek-only product; both have been replaced with provider-neutral planning documents.

Detailed findings: [CURRENT_STATE.md](audit/CURRENT_STATE.md), [EXISTING_FEATURES.md](audit/EXISTING_FEATURES.md), [TECHNICAL_DEBT.md](audit/TECHNICAL_DEBT.md).

## 2. Documentation Created

51 Markdown documents were created or replaced:

- **Audit (3):** current state, existing features, technical debt (TD-01 to TD-22).
- **Architecture (8):** overview, agent engine, model router, quota/routing, security, session state, context engine, tool system.
- **Providers (3):** provider matrix, free-tier policy, model capabilities.
- **Roadmap (24):** master plan, dependency graph, MVP scope, and phases 00–20.
- **Evaluations (3):** test strategy, agent benchmarks, quality gates.
- **Decisions (10):** index, template, and ADR-0001 through ADR-0008.
- **Root:** rewritten `README.md` and `PHASES.md`; this report.

All local Markdown links were validated; none are broken. The `SECURITY.md` threat-model table was corrected.

## 3. Architecture Summary

Single-package VS Code extension with strict internal boundaries:

- `src/extension/` — VS Code host, webview, SecretStorage, workspace/terminal adapters.
- `src/core/` — agent loop, sessions, events, verification.
- `src/providers/` — normalized `fetch`-based adapters; no provider SDKs.
- `src/router/` — capability registry, routing policies, quota ledger.
- `src/tools/` — typed, permissioned tools.
- `src/context/` — deterministic repository intelligence and budgeting.
- `src/security/` — path guards, command classification, redaction.

Invariants:

- The agent core must not import `vscode`.
- Unknown model capabilities are never treated as supported.
- Permissions are enforced in code, not by prompts.
- Side effects are never replayed after a retry or provider switch.
- API keys never enter the webview or logs.
- Completion requires verification evidence or an explicit "unverified" label.
- A monorepo is deferred until a second host exists.

Details: [OVERVIEW.md](architecture/OVERVIEW.md), [AGENT_ENGINE.md](architecture/AGENT_ENGINE.md), [SECURITY.md](architecture/SECURITY.md).

## 4. Free Cloud Strategy

Priority order:

| Priority | Provider | Role | Free class |
|---|---|---|---|
| P0 | OpenRouter | Broad free-model access via one key | Free tier |
| P0 | GroqCloud | Fast, tool-capable free inference | Free tier |
| P0/P1 | Google Gemini | Strong reasoning/tools | Free tier |
| P1 | Mistral | Additional free-mode capacity | Free tier (limited) |
| P2 | Hugging Face | Optional PRO users | Subscription/paid |
| P2 | Cerebras | Trial only | Trial credit |
| P3 | Ollama | Optional local/private mode | Local |
| Excluded | GitHub Models | Retired 2026-07-30 | Unavailable |

Verified facts as of 2026-11-01 include:

- OpenRouter: 20 RPM / 50 RPD free; 1,000 RPD after at least 10 credits; `GET /key` exposes `free_model_daily_requests`; 402/403/429 error semantics.
- Groq: free plan without a card; `gpt-oss-120b` example limits 30 RPM / 1,000 RPD / 8K TPM / 200K TPD; structured output is not compatible with tools/streaming.
- Gemini: free tier with data-use terms; 2.5 models restricted to prior users; prefer 3.5 Flash-Lite/3.8 Flash.
- Mistral: free mode with limited monthly usage.
- Hugging Face: no included credits for free users; PRO is $2/month.
- Cerebras: $5 trial for 30 days, card required, no permanent free tier.

Policy:

- Free hosted inference first; local second; paid only with explicit consent.
- Never fall back from free to paid automatically.
- No "unlimited free" claims.
- Surface quota exhaustion and data-use terms before sending workspace content.
- Record provider verification dates before release claims.

Details: [PROVIDER_MATRIX.md](providers/PROVIDER_MATRIX.md), [FREE_TIER_POLICY.md](providers/FREE_TIER_POLICY.md).

## 5. Development Roadmap

| Milestone | Phases | Outcome |
|---|---|---|
| M0 — Foundation | 00–03 | Reproducible extension, providers, routing, quota |
| M1 — Safe agent | 04–07 | Chat UI, tools, terminal, agent loop |
| M2 — Intelligence | 08–11 | Context, planning, coding/debugging, continuation |
| M3 — Hardening | 12–13 | Git safety, evaluations |
| M4 — Optional reach | 14–17 | Local models, browser, MCP, multi-agent research |
| M5 — Release | 18–19 | Performance, packaging |
| Future | 20 | Deferred expansion |

Phases 14–17 are explicitly optional and gated on MVP success. Phase 20 is deferred and requires an ADR and threat model before any implementation.

Details: [MASTER_PLAN.md](roadmap/MASTER_PLAN.md), [DEPENDENCY_GRAPH.md](roadmap/DEPENDENCY_GRAPH.md), [PHASES.md](../PHASES.md).

## 6. MVP Critical Path

1. **Phase 01** — fix command identity, adopt pnpm, add build/lint/test/CI, launch configuration, and manifest metadata.
2. **Phase 02** — provider interface, `fetch`/SSE transport, OpenRouter and Groq adapters, SecretStorage, discovery.
3. **Phase 03** — capability registry, free-tier routing, quota ledger, cooldowns, explicit fallback.
4. **Phase 04** — secure chat sidebar with streaming, cancellation, model/mode selection, permission cards.
5. **Phase 05** — workspace read/list/search, patch editing with hash checks, diagnostics, read-only Git.
6. **Phase 06** — approved command execution with output capture and process-tree termination.
7. **Phase 07** — bounded agent loop, dispatcher, permissions, events, session persistence, minimal verification.
8. **Phase 08** — deterministic context intelligence and budgeting.
9. **Phase 09** — structured plans and read-only Plan mode.
10. **Phase 10** — multi-file changes, test execution, diagnostics-driven repair.
11. **Phase 11** — quota-aware resume without replaying side effects.

A usable MVP is Phases 01–07 plus a minimal slice of Phase 10. Phases 08–09, 11, and 13 improve reliability and long-task behavior.

Details: [MVP_SCOPE.md](roadmap/MVP_SCOPE.md).

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Command mismatch ships to users | High | Phase 01, task 01-01 |
| Provider SDK coupling | High | ADR-0002; adapters use `fetch` |
| Prompt-injection-driven tool execution | High | Code-enforced permissions, approval gates, untrusted-content labeling |
| Secret leakage to webview/logs | High | SecretStorage, redaction, CSP, no keys in webview |
| Unbounded agent loops and token spend | High | Loop bounds, budgets, cancellation, verification |
| Free-tier quota exhaustion mistaken for failure | Medium | Explicit quota state machine and UI |
| Provider facts drift | Medium | Verification dates, re-check before release |
| Scope explosion (multi-agent, browser, MCP) | High | Deferred phases and benchmark gates |
| False completion claims | High | Verification evidence required; hallucinated-success metric |
| Package-manager ambiguity | Low | Adopt pnpm and commit the lockfile in Phase 01 |

## 8. Next Implementation Task

**Phase 01, task 01-01:** unify the product identity as `seeker`, fix the manifest/source command mismatch, and establish a reproducible build/test/lint foundation.

Concretely:

1. Change the contributed command to `seeker.hello` and register the same ID, or remove the placeholder command entirely.
2. Rename the extension to lowercase `seeker` and set real publisher/metadata fields when known.
3. Adopt pnpm, commit `pnpm-lock.yaml`, and replace npm assumptions in scripts.
4. Add type-check, build, lint, format, and test scripts.
5. Add `.vscode/launch.json`, `.vscode/tasks.json`, and a CI workflow.
6. Align `@types/vscode` with `engines.vscode`.
7. Verify activation and the command in the Extension Development Host.

No feature work should begin before this foundation is green.

## 9. Limitations of This Report

- Provider facts are dated 2026-11-01 and may change.
- No implementation has been tested beyond TypeScript compilation.
- Performance and agent success rates are unmeasured; targets will be set from evidence.
- The MVP scope is a plan, not a commitment to a calendar schedule.

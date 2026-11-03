# TECHNICAL DEBT REGISTER

Debt is prioritized by its effect on reaching a reliable, free-cloud-first MVP.

| ID | Debt | Severity | Evidence | Resolution phase | Notes |
|---|---|---|---|---|---|
| TD-01 | Command ID mismatch between manifest and source | P0 | `package.json:17`, `src/extension.ts:4` | 01 | The only feature is unreachable |
| TD-02 | Product identity split (`Seeker`, `deepcode`, `DeepCode`) | P0 | manifest, source, README, PHASES | 01 | Standardize on `seeker` / `Seeker` |
| TD-03 | Extension manifest is not publishable | P0 | placeholder publisher, uppercase name, no metadata | 01 / 19 | Add license, repository, icon, `.vscodeignore` |
| TD-04 | No automated tests | P0 | no test files/scripts | 01, then every phase | Required for reliability claims |
| TD-05 | No lint/format gate | P1 | no ESLint/Prettier config | 01 | Use ESLint flat config + Prettier |
| TD-06 | No CI | P1 | no `.github/workflows` | 01 | Type-check, lint, test, package |
| TD-07 | Package-manager ambiguity | P1 | pnpm lockfile untracked; npm in scripts | 01 | Adopt pnpm and commit lockfile |
| TD-08 | No launch configuration | P1 | no `.vscode/launch.json` | 01 | Makes F5 reproducible |
| TD-09 | DeepSeek-specific README and phases | P1 | `README.md`, `PHASES.md` | 00/01 | Replace with provider-neutral docs |
| TD-10 | No module boundaries in `src/` | P1 | single file | 02–07 | Introduce `core`, `providers`, `tools`, etc. |
| TD-11 | `@types/vscode` lock drift beyond `engines.vscode` | P2 | 1.140 vs ^1.90 | 01 | Pin or align intentionally |
| TD-12 | No error taxonomy | P1 | no code | 02 | Normalize provider/tool errors early |
| TD-13 | No secret-storage foundation | P0 | no code | 02 | Never store keys in settings |
| TD-14 | No webview CSP/message contract | P0 | Resolved in `src/extension/webview/` and `src/extension/chat-view.ts` (Phase 04) | 04 | Closed for MVP scope: typed validated protocol, nonce CSP, no webview network, no secrets |
| TD-15 | No permission model | P0 | dispatcher/permissions/paths/audit in `src/tools/`, `src/security/`; trust-aware host | 05–07 | Phase 05 enforces workspace boundaries, schema validation, read-only default, trust denial, and audit; Phase 06 adds terminal permission checks, command risk policy, env scrubbing, and terminal audit metadata; user-facing approval dialog/session allowlist remain open |
| TD-16 | No quota/capability model | P0 | Resolved in `src/router/` (Phase 03) | 03 | Closed for MVP scope: registry, eligibility, policies, ledger, events, debug command |
| TD-17 | No context-budgeting strategy | P1 | no code | 08 | Free tiers have small token quotas |
| TD-18 | No resumability/checkpoint model | P1 | no code | 11 | Avoid replaying side effects |
| TD-19 | No agent evaluation harness | P1 | no code | 13 | Demonstrations are not evidence |
| TD-20 | No packaging/release process | P2 | no `vsce` config | 19 | Marketplace readiness |
| TD-21 | No accessibility or theme verification for UI | P2 | implementation exists in `src/webview/main.ts` and `media/webview.css` | 04 | Keyboard/ARIA/theme code present; automated host/webview and manual verification pending |
| TD-22 | No dependency/license audit | P2 | not performed | 01/19 | Record third-party obligations |

## Debt That Must Not Be Created

The following shortcuts are explicitly disallowed because they would create worse debt later:

- Calling a provider SDK directly from the agent loop.
- Storing API keys in `settings.json`.
- Using `child_process.exec` with unsanitized model-provided command strings.
- Applying model-proposed whole-file rewrites without conflict detection.
- Retrying side-effecting tool calls automatically after a provider switch.
- Treating unknown model capabilities as supported.
- Marking a task complete because the model says so.
- Adding embeddings or multi-agent orchestration before deterministic retrieval and single-agent reliability are measured.

## Tracking Rule

Each phase document's **Definition of Done** must reference the debt IDs it closes. A phase cannot be marked complete while a P0 debt assigned to it remains open.

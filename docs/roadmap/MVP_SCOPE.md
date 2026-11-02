# MVP SCOPE

## 1. MVP Statement

The first useful SEEKER MVP lets a developer install the extension, connect a free hosted provider, select a compatible model, ask for a bounded code change, review and apply validated edits, run an approved validation command, and see verified results.

It must not require Ollama, a paid API, or a local GPU. It must fail gracefully when free quotas are exhausted.

## 2. Required User Workflow

1. Install SEEKER in VS Code.
2. Configure a legitimate free-tier provider (OpenRouter or Groq first).
3. Discover available models.
4. Select a coding-capable, tool-capable model.
5. Open a project.
6. Ask SEEKER to change code.
7. SEEKER reads relevant files.
8. SEEKER proposes a validated patch; the user approves or rejects it.
9. SEEKER runs an approved validation command.
10. SEEKER shows results, changed files, and unresolved errors.

## 3. MVP Capabilities

### 3.1 Providers

- OpenRouter adapter: discovery, streaming, tool calls, rate-limit parsing, quota endpoint.
- Groq adapter: discovery, streaming, tool calls, header parsing.
- SecretStorage-backed keys.
- Free-tier classification and visible labels.
- No paid fallback with default settings.

### 3.2 Routing

- Manual selection and `free-first`.
- Capability filtering with tri-state capabilities.
- Quota ledger for request and token limits.
- Rate-limit vs exhaustion distinction.
- Human-readable selection and fallback reasons.

### 3.3 UI

- Sidebar chat with streaming text.
- Mode selector: Ask, Plan, Build, Debug, Review.
- Provider/model selector with free-tier indicator.
- Cancel button.
- Tool activity list.
- Diff preview for file changes.
- Permission prompt with exact command or diff.
- Error state with retry/switch/cancel options.

### 3.4 Tools

- `filesystem.read`, `filesystem.list`
- `search.text`, `search.files`
- `filesystem.write` (new files), `filesystem.apply_patch` (existing files)
- `terminal.execute` (approved, captured, cancellable)
- `git.status`, `git.diff`
- `diagnostics.get`

### 3.5 Agent

- Ask, Plan, Build, Debug, Review modes with enforced tool filtering.
- Bounded loop (iterations, retries, duplicate calls).
- Event stream persisted per session.
- Permission checks in code.
- Cancellation.
- Minimal verification: command exit code, diagnostics for changed files, file existence/content, manual confirmation.
- Quota pause and resume without replaying side effects.

### 3.6 Security

- Strict webview CSP and typed messages.
- No secrets in webview/logs/session files.
- Workspace path guards and symlink protection.
- No shell by default; environment allowlist; process-tree kill.
- Secret-file exclusions.
- Provider privacy disclosure.
- Audit log for privileged actions.

## 4. Explicitly Out of Scope

- Gemini, Mistral, Hugging Face, Cerebras, Ollama adapters (Gemini may land in P1).
- Browser automation.
- MCP.
- Multi-agent orchestration.
- Embeddings/vector search.
- Autonomous Git commits or pushes.
- Dependency installation without approval.
- Marketplace publication (local VSIX is sufficient for MVP validation).
- Telemetry.
- Cloud sync or accounts.
- Windows-specific shell integrations beyond basic compatibility.
- Multi-root workspace edge cases beyond a correct allowlist implementation.

## 5. MVP Acceptance Criteria

### 5.1 Functional

- [ ] Fresh clone: `pnpm install && pnpm build && pnpm test` succeeds.
- [ ] F5 launches an Extension Development Host with a working sidebar.
- [ ] A user can store an OpenRouter or Groq key without it appearing in settings or logs.
- [ ] Model discovery lists models and marks free-tier status.
- [ ] Streaming chat renders deltas and can be cancelled.
- [ ] Ask mode can read and explain a file.
- [ ] Plan mode produces a plan without writing.
- [ ] Build mode can create a new file and patch an existing file with hash checks.
- [ ] The diff preview matches the applied change.
- [ ] A user can approve a command and see stdout/stderr/exit code.
- [ ] Changed files and unresolved errors are shown at the end.
- [ ] A simulated daily-quota exhaustion pauses the session with a clear message and no paid fallback.
- [ ] Resuming after a pause does not re-run a completed write or command.

### 5.2 Quality

- [ ] Unit test coverage for routing, quota parsing, patch application, path guards, and token budgeting.
- [ ] Integration test for agent loop with mock provider and mock tools.
- [ ] Security tests for traversal, symlink escape, command injection, redaction, and CSP.
- [ ] Extension smoke test for activation and command parity.
- [ ] At least 10 fixture evaluation tasks defined; baseline results recorded.

### 5.3 Honesty

- [ ] UI labels free/trial/paid/subscription/local/unknown correctly.
- [ ] No "unlimited" claims.
- [ ] Unverified completion is labeled.
- [ ] Documentation matches implementation.

## 6. MVP Demo Script

1. Open a fixture TypeScript project with a failing type check.
2. Select Groq `openai/gpt-oss-120b` (free tier) or an OpenRouter `:free` tool-capable model.
3. Ask: "Fix the type error in `src/math.ts` and run the type check."
4. Observe: SEEKER reads the file and diagnostics, proposes a patch, shows the diff.
5. Approve the patch.
6. Approve `pnpm typecheck`.
7. Observe: exit code 0, changed file list, verification passed.
8. Disconnect the network or simulate quota exhaustion on a second task.
9. Observe: session pauses with an explanation; no paid fallback; state preserved.

## 7. Failure Modes That Must Be Handled

| Failure | Required behavior |
|---|---|
| Invalid API key | Clear message; prompt to re-enter; no retry loop |
| No tool-capable free model | Explain; offer provider configuration; do not start Build mode |
| Rate limit with `Retry-After` | Wait and retry within bounds; show status |
| Daily quota exhausted | Pause; offer wait/switch; preserve state |
| Context overflow | Compact once; if still too large, ask to narrow scope |
| Patch conflict | Show conflict; do not overwrite; re-read and retry |
| Command failure | Return output to model; allow repair loop; do not claim success |
| User denies permission | Return denial to model; continue or stop safely |
| Cancellation | Abort HTTP and kill process; checkpoint state |
| Provider 5xx | Bounded retry; fallback if eligible |

## 8. MVP Definition of Done

- All acceptance criteria above are verified by automated tests or a recorded manual test.
- No P0 technical debt remains for the MVP scope.
- The provider matrix is re-verified.
- The README accurately describes only implemented behavior.
- A fresh clone can reproduce the demo.

## 9. Related Documents

- [MASTER_PLAN.md](MASTER_PLAN.md)
- [DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md)
- [PHASE_07.md](PHASE_07.md)
- [QUALITY_GATES.md](../evaluations/QUALITY_GATES.md)
- [SECURITY.md](../architecture/SECURITY.md)

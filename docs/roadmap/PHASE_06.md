# PHASE 06 — TERMINAL INTEGRATION

## Objective

Allow the agent to run approved commands with captured output, strict safety controls, timeouts, and cancellation.

## Current Repository State

The terminal execution backend, VS Code approval dialog, exact-command session allowlist, and Build/Debug integration are implemented. Automated unit, integration, and extension-host tests cover the approval contract, host execution, denial, session isolation, and mocked webview dispatch without screen sharing or OS screen capture. A manual end-to-end run through the actual VS Code modal UI remains unverified.

## Dependencies

- Phase 05 complete (path guards, tool contract, audit logging).

## Scope

- `terminal.execute` tool.
- Argument-array execution without a shell by default.
- Approval UI integration.
- Environment allowlist and secret scrubbing.
- Output caps and process-tree termination.
- Denied-command patterns.
- Audit records.
- No autonomous dependency installation without approval.

## Architecture Decisions

- Use `child_process.spawn(file, args, { shell: false })`.
- Require explicit approval per command unless the user creates a session-scoped rule for a specific command pattern.
- Run with a workspace-bound `cwd`.
- Kill the process group on timeout/cancel (`SIGTERM`, then `SIGKILL` after a grace period).
- Never pass provider API keys or the full environment.
- Reject interactive/TTY commands with a clear error.
- Destructive Git and deployment/publish commands require a separate high-risk confirmation.

## Implementation Tasks

- [x] Create `src/tools/terminal.ts`.
- [x] Implement `spawn` with `shell: false`, `cwd` validation, and `env` allowlist.
- [x] Implement output capture with byte caps for stdout/stderr.
- [x] Implement timeout (default 120 s, max 600 s) and cancellation.
- [x] Implement process-tree kill with graceful escalation.
- [x] Create `src/security/commands.ts` with deny patterns and risk classification.
- [x] Wire `execute` through the dispatcher permission/approval callback.
- [x] Add the user-facing approval UI for `execute` with exact executable, arguments, cwd, workspace, and risk.
- [x] Add output-channel display for the exact command and result.
- [x] Add audit details with redacted command, args, cwd, exit code, duration, byte counts, truncation flags, and captured-output hash.
- [x] Reject known interactive/TTY-dependent commands with guidance.
- [x] Add a session-scoped exact-command allowlist (in-memory, per session).
- [x] Add tests using harmless cross-platform commands.
- [x] Add extension-host tests for the exact approval prompt, run-once/session choices, session isolation, trusted host execution, write/diff denial, and mocked webview dispatch without OS screen capture.

## Files and Packages Affected

- `src/tools/terminal.ts`
- `src/security/commands.ts`
- `src/extension/workspace-host.ts` (output-channel display)
- `src/extension/command-approval.ts` (modal approval bridge)
- `src/security/approvals.ts` (exact-command prompts and session allowlist)
- `src/extension/agent-runner.ts` (Build/Debug agent wiring)
- `test/unit/tools/terminal.test.ts`
- `test/integration/terminal/*.test.ts`

## API Contracts

```ts
export interface TerminalExecuteInput {
  file: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface TerminalExecuteResult {
  file: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}
```

## Data Structures

```ts
export type CommandRisk = 'low' | 'medium' | 'high' | 'blocked';

export interface CommandAssessment {
  risk: CommandRisk;
  reason: string;
  matchedRule?: string;
}
```

## Security Considerations

- No implicit shell; no `exec`.
- Validate `file` is a permitted executable or a workspace-relative script runner.
- Reject `cwd` outside roots.
- Strip `OPENAI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `HF_TOKEN`, `AWS_*`, `GITHUB_TOKEN`, and similar.
- Block fork bombs, disk formatting, recursive deletion of home/root, credential exfiltration, and history-destroying Git commands.
- Show the exact argv and cwd before approval.
- Do not auto-approve commands influenced by untrusted file content.
- Cap output to prevent context flooding.

## Error Handling

- `command_failed` for non-zero exit, including output.
- `timeout` after the limit; process killed.
- `cancelled` when aborted by the user.
- `unsafe_path` for invalid cwd.
- `permission_denied` for rejected commands.
- Spawn errors (ENOENT, EACCES) return actionable messages.

## Test Plan

- Unit: argv is passed without shell interpretation (metacharacters remain literal).
- Unit: deny rules classify dangerous commands.
- Unit: env scrubbing removes secrets.
- Unit: cwd escape is rejected.
- Integration: output capture and truncation.
- Integration: timeout kills the process tree.
- Integration: cancellation kills the process tree.
- Integration: non-zero exit returns output and code.
- Extension host: approval prompt content/choices, session isolation, approved terminal execution, approved/denied file previews, and mocked webview message dispatch.
- Manual UI: remaining visual modal, diff-view, and user-flow checks are documented below and marked unverified.

## Acceptance Criteria

- [ ] A user can approve and run `pnpm typecheck` through the actual VS Code UI and the result is recorded. **UNVERIFIED: manual UI/provider run pending.**
- [x] The approval contract offers run-once, exact-command session approval, and denial/cancel; covered by extension-host tests with an injected approval UI.
- [x] The approval prompt includes the exact executable, arguments, cwd, workspace, and risk; covered by extension-host tests.
- [x] Terminal execution and denial flow through the real `WorkspaceToolHost` with injected approval/preview callbacks; covered by extension-host tests.
- [x] Session approval is bound to the exact executable, arguments, cwd, and workspace.
- [x] stdout/stderr/exit code are displayed and returned to the model.
- [x] Shell metacharacters are not interpreted by default.
- [x] Timeout and cancel terminate the process tree.
- [x] Dangerous commands are blocked or classified high risk.
- [x] Secrets are absent from the child environment and audit log.

## Risks

- Windows process-tree termination differs.
- Some tools require a shell or TTY.
- Approval fatigue can lead users to approve blindly; show concise, exact details and remember only narrow rules.
- Long-running watchers must be disallowed.

## Definition of Done

- [x] Automated acceptance criteria pass.
- [ ] User-driven approval criterion for the actual VS Code UI remains unverified.
- [x] Security and cancellation tests pass.
- [x] TD-15 implementation work is closed: approval UI and session allowlisting exist. Manual UI acceptance remains pending.
- [x] `TOOL_SYSTEM.md` and `SECURITY.md` match implementation.

## Out of Scope

- Persistent integrated terminals for the user.
- Test-runner-specific parsing (Phase 10).
- Background process management.
- Remote/SSH execution.

## Implementation Notes

- Commands use argv arrays and `spawn(file, args, { shell: false })`; no command string is parsed or passed to a shell.
- `cwd` is resolved through the workspace path guard. Bare executables must be allowlisted; workspace-relative scripts are allowed; absolute executables outside the workspace must be allowlisted system tools.
- The child environment inherits only a small base allowlist. Secret, loader-injection, Git-config-injection, and shell-startup variables are rejected.
- stdout is capped at 256 KiB and stderr at 128 KiB. Truncation is explicit.
- Default timeout is 120 s; the maximum is 600 s. Timeout/cancel sends `SIGTERM`, then `SIGKILL` after a grace period to the process group on POSIX. Windows uses `taskkill /T /F`.
- Executable commands are available in Build and Debug modes through the `execute` permission. Ask/Plan/Review remain read-only. The chat UI exposes all five modes; Build and Debug route through the agent loop and require approval for writes/commands.
- Audit details contain a redacted command, args, resolved cwd, exit status, duration, byte counts, truncation flags, and SHA-256 of the captured stdout/stderr. Raw output is not stored in the audit log.

## Tests Executed

| Command | Result |
|---|---|
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test:unit` | Pass — 35 files, 236 tests |
| `pnpm test:integration` | Pass — 7 files, 22 tests |
| `pnpm format:check` | Pass |
| `pnpm build` | Pass |
| `pnpm test:extension` | Pass — VS Code 1.144.1 activated the extension; approval prompt/session tests, real host command/write flows, and mocked webview dispatch passed |
| `pnpm package` | Pass — `seeker-0.0.1.vsix`, 67 files, 112.5 KB |

## Deviations and Limitations

- The approval prompt, choices, host execution, denial, and session isolation are covered by extension-host tests without screen sharing or OS screen capture. The actual modal rendering, diff-view rendering, and complete user-driven `pnpm typecheck` flow remain manually unverified.
- Manual visual checks are optional and are not a development blocker. The exact local steps are documented below.
- Session approvals are memory-only and are cleared when the extension host restarts.
- Permission requests are displayed with a modal VS Code warning; inline webview permission cards are not implemented.
- TTY detection is a command-pattern heuristic, not a platform TTY probe.
- POSIX process-tree termination is integration-tested. Windows termination is implemented but unverified on Windows.
- The output hash covers the captured (possibly truncated) stdout/stderr, not unbounded output.
- Allowlisted system executables run outside the workspace sandbox and can read host paths when approved. Secret-path arguments are blocked for read/upload commands, but shell-free execution is not an OS sandbox.
- No commit exists because no commit was requested.

## Manual UI Acceptance Steps (Unverified)

No screen sharing, screen recording, remote desktop, or OS screen capture is required. Perform these steps locally only if visual confirmation is wanted:

1. Run `pnpm install`, then start the Extension Development Host with `F5` from the repository.
2. Configure a free OpenRouter or Groq key through **Seeker: Set Provider API Key**.
3. Open a disposable workspace containing a failing `tsconfig.json` project and a `package.json` script `"typecheck": "tsc --noEmit"`.
4. Select **Build** in the Seeker sidebar and send: `Run pnpm typecheck and report the exact result.`
5. Confirm the modal shows the exact executable, arguments, working directory, workspace, and risk. Choose **Run once** and verify stdout/stderr/exit code plus the audit/output-channel record.
6. Repeat the same command and choose **Allow for this session**; verify the second identical run does not prompt, a different argument list does prompt, and the approval does not carry into another session.
7. Repeat once and press `Escape`; verify the command is denied and does not execute.
8. Record the result manually. Until this is done, the manual UI acceptance remains **UNVERIFIED**.

For the final combined mode, approval, task, and minimal-workspace checklist, see **PHASE_07 — Final Manual Acceptance Checklist (Unverified)**.

## Completion Status

**IMPLEMENTED, AUTOMATED VERIFICATION PASSING; MANUAL UI ACCEPTANCE UNVERIFIED.** Terminal execution, safety controls, output display, audit metadata, approval contract, exact-command session allowlist, Build/Debug agent wiring, and automated tests are complete. The remaining verification gap is a user-driven approval-and-execution run through the actual VS Code UI.

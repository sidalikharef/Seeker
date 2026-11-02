# PHASE 06 — TERMINAL INTEGRATION

## Objective

Allow the agent to run approved commands with captured output, strict safety controls, timeouts, and cancellation.

## Current Repository State

No command execution exists.

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

- [ ] Create `src/tools/terminal.ts`.
- [ ] Implement `spawn` with `shell: false`, `cwd` validation, and `env` allowlist.
- [ ] Implement output capture with byte caps for stdout/stderr.
- [ ] Implement timeout (default 120 s, max 600 s) and cancellation.
- [ ] Implement process-tree kill with graceful escalation.
- [ ] Create `src/security/commands.ts` with deny patterns and risk classification.
- [ ] Add the permission request flow for `execute`.
- [ ] Add a VS Code terminal or output-channel display for the exact command and result.
- [ ] Add audit entries with command, args, cwd, exit code, duration, and truncated output hash.
- [ ] Detect commands requiring a TTY and fail with guidance.
- [ ] Add a configuration option for a per-session command allowlist.
- [ ] Add tests using harmless cross-platform commands.

## Files and Packages Affected

- `src/tools/terminal.ts`
- `src/security/commands.ts`
- `src/extension/terminal-host.ts`
- `src/extension/chat-view.ts` (permission UI)
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

## Acceptance Criteria

- [ ] A user can approve and run `pnpm typecheck`.
- [ ] stdout/stderr/exit code are displayed and returned to the model.
- [ ] Shell metacharacters are not interpreted by default.
- [ ] Timeout and cancel terminate the process.
- [ ] Dangerous commands are blocked or require explicit high-risk approval.
- [ ] Secrets are absent from the child environment and audit log.

## Risks

- Windows process-tree termination differs.
- Some tools require a shell or TTY.
- Approval fatigue can lead users to approve blindly; show concise, exact details and remember only narrow rules.
- Long-running watchers must be disallowed.

## Definition of Done

- [ ] Acceptance criteria pass.
- [ ] Security and cancellation tests pass.
- [ ] TD-15 is closed for terminal execution.
- [ ] `TOOL_SYSTEM.md` and `SECURITY.md` match implementation.

## Out of Scope

- Persistent integrated terminals for the user.
- Test-runner-specific parsing (Phase 10).
- Background process management.
- Remote/SSH execution.

## Completion Status

**Not started.**

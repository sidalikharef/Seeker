# PHASE 11 — QUOTA-AWARE CONTINUATION

## Objective

Make long tasks survive free-tier interruptions without losing work, duplicating side effects, or silently spending money.

## Current Repository State

Phase 03 introduced core quota primitives; Phase 07 introduced basic pause/resume. Advanced reconciliation, UX, and multi-provider continuation are not implemented.

## Dependencies

- Phase 03 (router/quota).
- Phase 07 (agent loop).
- Phase 10 recommended for realistic long tasks.

## Scope

- Full quota ledger with reconciliation.
- Provider switch with context rebuild.
- Unknown-action reconciliation.
- Checkpoint-based resume.
- Budget configuration and enforcement.
- Continuation UX.
- Quota metrics.
- No paid fallback by default.

## Architecture Decisions

- Resume is checkpoint-driven, not prompt-replay-driven.
- Unknown write/execute actions are reconciled by observing state, never by blind replay.
- Provider switches rebuild the request from normalized state.
- The user is notified before non-trivial switches.
- Exhaustion is persisted with reset times.
- Budgets are checked before initiating work.

## Implementation Tasks

- [ ] Extend `QuotaLedger` with authoritative reconciliation from provider endpoints.
- [ ] Persist ledger state across sessions.
- [ ] Implement `ActionRecord` reconciliation for `started`/`unknown` actions.
- [ ] Implement checkpoint creation before/after side effects.
- [ ] Implement workspace fingerprint comparison on resume.
- [ ] Implement a provider-switch flow that rebuilds context and does not replay tools.
- [ ] Add continuation UI: wait, switch provider, enable paid, cancel.
- [ ] Add budget configuration and pre-flight estimates.
- [ ] Add quota metrics and a local usage view.
- [ ] Add tests for:
  - [ ] quota pause and resume
  - [ ] unknown write reconciliation
  - [ ] provider switch without duplicate command
  - [ ] reset-time expiry
  - [ ] paid fallback blocked
- [ ] Document estimation formulas and limitations.

## Files and Packages Affected

- `src/router/quota.ts`
- `src/core/session-manager.ts`, `state.ts`, `agent-loop.ts`
- `src/extension/chat-view.ts`, `webview/*`
- `test/integration/quota/*.test.ts`

## API Contracts

```ts
export interface ResumePlan {
  sessionId: string;
  fromCheckpoint: string;
  workspaceChanged: boolean;
  unknownActions: ActionRecord[];
  reconciliation: Array<{
    actionId: string;
    strategy: 'verify-file-hash' | 'inspect-output' | 'ask-user' | 'safe-rerun';
    result: 'resolved' | 'needs_user' | 'failed';
  }>;
  nextStep: string;
}
```

## Data Structures

```ts
export interface ActionRecord {
  actionId: string;
  kind: 'model_request' | 'tool_call' | 'checkpoint';
  toolId?: string;
  inputHash?: string;
  idempotencyKey?: string;
  status: 'started' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  resultRef?: string;
  startedAt: string;
  finishedAt?: string;
}
```

## Security Considerations

- Do not re-run privileged actions with unknown status.
- Do not resume automatically after a crash without user confirmation if the workspace changed.
- Do not leak prompts or file content in usage metrics.
- Do not enable paid usage implicitly.
- Preserve audit integrity across resumes.

## Error Handling

- If reconciliation is impossible, ask the user.
- If the workspace changed, show a diff summary and require confirmation.
- If the selected provider is still exhausted, offer alternatives.
- If no alternative exists, remain paused with a clear explanation.
- Corrupt checkpoints fail closed.

## Test Plan

- Integration: simulate daily exhaustion mid-task; resume after reset.
- Integration: switch from OpenRouter to Groq mid-task; no duplicate patch/command.
- Integration: kill the process after a write; resume detects the new file hash.
- Integration: external user edit after checkpoint; resume blocks unsafe restore.
- Unit: ledger transitions and reset handling.
- Unit: budget enforcement.

## Acceptance Criteria

- [ ] Quota exhaustion pauses with a reset time or explicit unknown.
- [ ] Resume does not replay completed side effects.
- [ ] Provider switch preserves task state and capabilities.
- [ ] Paid fallback remains impossible by default.
- [ ] Workspace changes are detected and surfaced.
- [ ] Usage metrics distinguish estimated from authoritative.

## Risks

- Provider reset semantics vary.
- Reconciliation heuristics can be wrong; default to asking the user.
- Checkpoint storage growth; apply retention limits.
- Long-running sessions may hit multiple providers and quotas.

## Definition of Done

- [ ] Acceptance criteria pass.
- [ ] Resume and reconciliation tests pass.
- [ ] TD-18 is closed.
- [ ] `QUOTA_AND_ROUTING.md` and `SESSION_STATE.md` match implementation.

## Out of Scope

- Paid billing management.
- Cross-device session sync.
- Automatic account rotation (prohibited).

## Completion Status

**Not started.**

# PHASE 07 — AUTONOMOUS AGENT LOOP

## Objective

Connect routing, context, tools, permissions, state, and events into a bounded autonomous loop that can complete a small coding task and verify it.

This is the central MVP engineering milestone.

## Current Repository State

The core loop, session manager, events, error classification, verification engine, mode policies, context package, provider adapter bridge, and chat integration exist. The loop is verified offline with mock providers and tools, including a real TypeScript fixture. Extension-host tests now cover mocked webview message dispatch, mode changes, host initialization, and tool-host approval/preview injection without screen sharing or OS screen capture. Live-provider and actual rendered UI runs remain unverified.

## Dependencies

- Phase 03 (router/quota).
- Phase 04 (UI/event rendering).
- Phase 05 (workspace tools).
- Phase 06 (terminal).

## Scope

- Session manager and persisted state.
- Agent loop with bounds, cancellation, and error recovery.
- Tool dispatcher with schema validation and duplicate detection.
- Permission manager enforced in code.
- Context package assembly (basic; advanced in Phase 08).
- Event bus and persistence.
- Minimal verification engine.
- Ask, Plan, Build, Debug, Review mode filtering.
- Mock-provider and mock-tool integration tests.

## Architecture Decisions

- The agent core has no `vscode` import.
- One active loop per session; one workspace write lock.
- Model output is untrusted; all actions are validated.
- Completion requires evidence or is labeled `completed_unverified`.
- Side-effecting tools are never replayed on retry/fallback.
- Iteration, retry, duplicate, token, and wall-clock budgets are enforced.
- Prompt instructions are not a security boundary.

## Implementation Tasks

- [x] Create `src/core/session-manager.ts` and `src/core/state.ts`.
- [x] Create `src/core/events.ts` with `AgentEvent` and an append-only emitter.
- [x] Create `src/core/agent-loop.ts` implementing the state machine.
- [x] Create `src/core/modes.ts` with per-mode tool allowlists.
- [x] Create `src/core/verification.ts` with the MVP criteria evaluators.
- [x] Create `src/core/errors.ts` classification and recovery decisions.
- [x] Create `src/tools/dispatcher.ts` with:
  - [x] JSON parse and schema validation
  - [x] capability check
  - [x] mode/permission check
  - [x] duplicate-call detection
  - [x] timeout and cancellation
  - [x] audit entry
- [x] Create `src/tools/permissions.ts` with default policies and exact-command session rules.
- [x] Create `src/context/package.ts` for basic context assembly (system prompt, task, recent observations, char budget).
- [x] Persist sessions to extension storage with an append-only event log.
- [x] Wire the loop to the webview event stream and modal permission prompts.
- [x] Implement cancellation from UI and extension deactivation.
- [x] Implement `paused_quota` on router exhaustion.
- [x] Implement `completed_unverified` reporting.
- [x] Add a mock provider adapter and mock tool executors for tests.
- [x] Add extension-host tests for mocked webview `ready`/`mode.set`/`chat.send`/invalid-message dispatch, host initialization, and approval/preview callback flows.
- [x] Add integration tests for:
  - [x] successful edit + validation
  - [x] permission denial
  - [x] invalid tool arguments
  - [x] quota pause
  - [x] cancellation
  - [x] duplicate call suppression
  - [x] iteration bound

## Files and Packages Affected

- `src/core/*`
- `src/tools/dispatcher.ts`
- `src/security/permissions.ts`
- `src/context/package.ts`
- `src/extension/chat-view.ts`, `commands.ts`, `extension.ts`
- `test/integration/agent/*.test.ts`
- `test/fixtures/agent/*`

## API Contracts

```ts
export interface AgentSession {
  id: string;
  status: SessionStatus;
  mode: AgentMode;
  task: { prompt: string; acceptanceCriteria: AcceptanceCriterion[] };
  budget: TaskBudget;
  conversation: ConversationTurn[];
  actions: ActionRecord[];
}

export interface ToolDispatcher {
  execute(call: ToolCall, session: AgentSession, signal: AbortSignal): Promise<ToolResultSummary>;
}
```

## Data Structures

```ts
export type SessionStatus =
  | 'idle' | 'planning' | 'awaiting_model' | 'awaiting_tool'
  | 'awaiting_permission' | 'executing' | 'verifying'
  | 'paused_quota' | 'completed' | 'completed_unverified'
  | 'cancelled' | 'failed';

export interface TaskBudget {
  maxIterations: number;
  maxModelRequests: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxCostUsd: number;
  maxWallClockMs: number;
  maxToolCalls: number;
}
```

## Security Considerations

- Permission checks occur before execution for every privileged call.
- Mode filtering is enforced by the registry, not only by prompts.
- Tool arguments influenced by untrusted content still require approval for write/execute/network.
- No secrets in prompts, events, or session files.
- Cancellation must clean up processes and partial writes.

## Error Handling

- Classify errors as transient, quota, auth, capability, context, tool, permission, fatal.
- Bounded retries with backoff; no retry for destructive actions.
- Invalid tool calls return observations and continue.
- Fatal errors preserve state and surface a clear message.
- Never mark success after a failed verification.

## Test Plan

- Integration: mock model requests a read, then a patch, then a command; session completes with verified evidence.
- Integration: user rejects a patch; the model receives denial and adapts.
- Integration: malformed arguments never execute.
- Integration: provider 429 with retry-after; loop waits and retries within bound.
- Integration: quota exhaustion pauses and resumes without replaying writes.
- Integration: cancel during streaming and during command execution.
- Unit: duplicate-call detection and budget accounting.
- Unit: mode filtering denies disallowed tools.
- Extension host: mocked webview initialization, mode submission, chat submission, invalid-message rejection, and real host tool flow with injected approval/preview.
- Manual UI: live-provider demo, rendered streaming/tool/error events, and visual review remain documented but unverified.

## Manual UI Acceptance Steps (Unverified)

No screen sharing, screen recording, remote desktop access, or operating-system screen capture is required. Perform these steps locally only if visual confirmation is wanted:

1. Configure a free OpenRouter or Groq key through **Seeker: Set Provider API Key**.
2. Open a disposable workspace with a small failing TypeScript project and a `typecheck` script.
3. Switch to **Build** in the Seeker sidebar.
4. Send a task such as `Fix the TypeScript error and run the type-check command.`
5. Approve the write/patch diff and the exact terminal command through the VS Code modal flows.
6. Watch streamed assistant updates, tool activity, permission events, and final verification evidence.
7. Repeat the task once with a user denial and once with cancellation.
8. Record the result manually. Until this is done, rendered-event UI and live-provider acceptance remain **UNVERIFIED**.

## Final Manual Acceptance Checklist (Unverified)

The final manual acceptance checklist covers Phase 06 terminal approval and Phase 07 agent-loop behavior. It is **UNVERIFIED** until a user performs the steps in a real VS Code UI.

### Mode behavior
- [ ] **Ask** (`ask`): read-only; no write/execute permission; no terminal approval should appear for read-only tasks.
- [ ] **Plan** (`plan`): read-only; no write/execute permission; no terminal approval should appear for planning tasks.
- [ ] **Build** (`build`): read/write/execute allowed; write/execute actions require approval.
- [ ] **Debug** (`debug`): read/write/execute allowed; write/execute actions require approval.
- [ ] **Review** (`review`): read-only; no write/execute permission; no terminal approval should appear for review tasks.

### Approval behavior
- [ ] Exact command approval: prompt includes executable, JSON arguments, working directory, workspace, and risk; arguments run without a shell.
- [ ] **Run Once**: approved command executes once and does not add a session allowlist rule.
- [ ] **Allow for Session**: same exact command approved for session; identical repeat does not prompt, different arguments do prompt.
- [ ] **Deny**: cancel/Escape denies command; no execution occurs and denial is surfaced.

### End-to-end task acceptance
- [ ] Use the minimal safe TypeScript-error workspace at `/tmp/seeker-final-acceptance`.
- [ ] In **Build** or **Debug**, send a task to fix the TypeScript error and run `typecheck`.
- [ ] Approve the write/patch diff and exact terminal command.
- [ ] Verify streamed updates, tool activity, final result, real `tsc --noEmit`, and verification evidence.
- [ ] Repeat with denial/cancellation only after the base task is verified.

## Acceptance Criteria

- [x] A bounded task completes end-to-end with a mock provider and real workspace tools, including an actual `tsc --noEmit` run.
- [ ] A real provider can complete the same task with OpenRouter or Groq.
- [x] Permissions are enforced in code and tested.
- [x] Cancellation stops model and tool work.
- [x] No infinite loops under adversarial model output; iteration, tool, duplicate, wall-clock, and retry budgets are tested.
- [x] Quota pause preserves state and does not replay actions.
- [x] Completion without evidence is labeled unverified.
- [ ] Events render correctly in the actual UI. **UNVERIFIED: host-to-webview dispatch is tested with a mocked webview; rendered DOM/visual behavior is not.**
- [x] Host-to-webview initialization and typed webview submissions are covered by extension-host tests with mocked webview interactions.

## Risks

- Model tool-call quality varies; the loop must recover from malformed calls.
- Context may overflow on small models.
- Permission prompts may be too frequent; tune with narrow session rules.
- State persistence bugs can cause duplicate actions; test resume heavily.

## Definition of Done

- [x] Automated acceptance criteria pass.
- [ ] A recorded manual run against a free provider completes the MVP demo script. **UNVERIFIED: no provider credentials available; manual UI run pending.**
- [x] Mock-based integration suite passes offline.
- [x] TD-10, TD-15, TD-17 (basic), TD-18 (basic) are closed for the MVP scope.
- [ ] `AGENT_ENGINE.md`, `SESSION_STATE.md`, and `TOOL_SYSTEM.md` match implementation.

## Out of Scope

- Advanced context retrieval (Phase 08).
- Full planning UI (Phase 09).
- Full test/debug workflows (Phase 10).
- Advanced resumability (Phase 11).
- Git checkpoints (Phase 12).

## Completion Status

**IMPLEMENTED; AUTOMATED VERIFICATION PASSING; LIVE PROVIDER AND ACTUAL UI UNVERIFIED.** The bounded agent loop, chat integration, mode switching, tool execution, permissions, cancellation, quota pause, session persistence, and verification evidence work in automated tests. The remaining gaps are a live OpenRouter/Groq run, an actual rendered UI run, automated visual/accessibility checks, and a cross-session workspace write lock. Session approvals are memory-only. Phase 08 must not start until the Phase 06 manual/live acceptance prerequisites and Phase 07 live-provider/actual-UI verification are satisfied.

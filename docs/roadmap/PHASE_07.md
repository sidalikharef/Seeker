# PHASE 07 — AUTONOMOUS AGENT LOOP

## Objective

Connect routing, context, tools, permissions, state, and events into a bounded autonomous loop that can complete a small coding task and verify it.

This is the central MVP engineering milestone.

## Current Repository State

Providers, router, UI, tools, and terminal exist independently. No loop, session manager, dispatcher, permission enforcement, or verification exists.

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

- [ ] Create `src/core/session-manager.ts` and `src/core/state.ts`.
- [ ] Create `src/core/events.ts` with `AgentEvent` and an append-only emitter.
- [ ] Create `src/core/agent-loop.ts` implementing the state machine.
- [ ] Create `src/core/modes.ts` with per-mode tool allowlists.
- [ ] Create `src/core/verification.ts` with the MVP criteria evaluators.
- [ ] Create `src/core/errors.ts` classification and recovery decisions.
- [ ] Create `src/tools/dispatcher.ts` with:
  - [ ] JSON parse and schema validation
  - [ ] capability check
  - [ ] mode/permission check
  - [ ] duplicate-call detection
  - [ ] timeout and cancellation
  - [ ] audit entry
- [ ] Create `src/security/permissions.ts` with default policies and session rules.
- [ ] Create `src/context/package.ts` for basic context assembly (open file, task, recent observations).
- [ ] Persist sessions to extension storage with an append-only event log.
- [ ] Wire the loop to the webview event stream and permission cards.
- [ ] Implement cancellation from UI and extension deactivation.
- [ ] Implement `paused_quota` on router exhaustion.
- [ ] Implement `completed_unverified` reporting.
- [ ] Add a mock provider adapter and mock tools for tests.
- [ ] Add integration tests for:
  - [ ] successful edit + validation
  - [ ] permission denial
  - [ ] invalid tool arguments
  - [ ] quota pause
  - [ ] cancellation
  - [ ] duplicate call suppression
  - [ ] iteration bound

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

## Acceptance Criteria

- [ ] A bounded task completes end-to-end with a mock provider.
- [ ] A real provider can complete the same task with OpenRouter or Groq.
- [ ] Permissions are enforced in code and tested.
- [ ] Cancellation stops model and tool work.
- [ ] No infinite loops under adversarial model output.
- [ ] Quota pause preserves state.
- [ ] Completion without evidence is labeled unverified.
- [ ] Events render correctly in the UI.

## Risks

- Model tool-call quality varies; the loop must recover from malformed calls.
- Context may overflow on small models.
- Permission prompts may be too frequent; tune with narrow session rules.
- State persistence bugs can cause duplicate actions; test resume heavily.

## Definition of Done

- [ ] Acceptance criteria pass.
- [ ] Mock-based integration suite passes offline.
- [ ] A recorded manual run against a free provider completes the MVP demo script.
- [ ] TD-10, TD-15, TD-17 (basic), TD-18 (basic) are closed for the MVP scope.
- [ ] `AGENT_ENGINE.md`, `SESSION_STATE.md`, and `TOOL_SYSTEM.md` match implementation.

## Out of Scope

- Advanced context retrieval (Phase 08).
- Full planning UI (Phase 09).
- Full test/debug workflows (Phase 10).
- Advanced resumability (Phase 11).
- Git checkpoints (Phase 12).

## Completion Status

**Not started.**

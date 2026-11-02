# AGENT ENGINE

## 1. Objective

Define a bounded, cancellable, provider-independent loop that turns a user task into validated tool actions and verified results.

The agent engine is **policy**, not transport. It receives normalized model events and returns tool requests to a dispatcher. It does not know how HTTP, VS Code, or the filesystem work.

## 2. Components

| Component | Responsibility |
|---|---|
| `SessionManager` | Create, resume, list, cancel, and persist sessions |
| `AgentLoop` | Iterate model calls and tool calls within bounds |
| `ToolDispatcher` | Validate, authorize, execute, and record tool calls |
| `PermissionManager` | Decide whether a call requires approval; never trust prompts |
| `ContextManager` | Build a token-bounded context package per model call |
| `StateManager` | Maintain conversation, actions, observations, checkpoints |
| `ModelRouter` | Select a compatible model for each call |
| `EventBus` | Emit structured progress events to hosts |
| `ErrorRecoveryManager` | Classify errors and decide retry/fallback/abort |
| `VerificationEngine` | Evaluate task acceptance criteria from evidence |

## 3. State Machine

```text
idle
  └─> planning ──> awaiting_model ──> awaiting_tool ──> awaiting_permission
                         │                  │                    │
                         │                  └────> executing <───┘
                         │                              │
                         └──────────────<───────────────┘
  └─> verifying ──> completed
  └─> cancelled
  └─> failed
  └─> paused_quota
```

Rules:

- Only one model request or tool execution is in flight per session unless parallel read-only tools are explicitly enabled.
- `awaiting_permission` blocks until the user responds or the session is cancelled.
- `paused_quota` is recoverable and preserves state.
- `completed` requires verification evidence or an explicit `unverified` completion reason.

## 4. Loop Algorithm

```ts
async function runLoop(session: AgentSession, signal: AbortSignal): Promise<void> {
  for (let iteration = 0; iteration < session.budget.maxIterations; iteration++) {
    if (signal.aborted) throw new CancelledError();
    if (session.budget.exhausted()) throw new BudgetExceededError();

    const context = await contextManager.build(session, signal);
    const selection = await router.select({
      task: session.task,
      required: session.requiredCapabilities,
      policy: session.routingPolicy,
    });

    if (!selection) {
      session.transition('paused_quota', { reason: 'no_eligible_model' });
      return;
    }

    const call = await provider.streamChat(toChatRequest(context, selection), signal);
    const turn = await consumeModelTurn(call, session, signal);

    if (turn.toolCalls.length === 0) {
      const verdict = await verification.evaluate(session, turn);
      if (verdict.satisfied) {
        session.transition('completed', { verdict });
        return;
      }
      session.addSystemObservation(verdict.feedback);
      continue;
    }

    for (const toolCall of turn.toolCalls) {
      const decision = await permissions.authorize(toolCall, session);
      if (decision === 'deny') {
        session.addToolObservation(toolCall.id, { error: 'permission_denied' });
        continue;
      }
      if (decision === 'ask') {
        const approval = await events.requestApproval(toolCall, signal);
        if (!approval.approved) {
          session.addToolObservation(toolCall.id, { error: 'user_rejected' });
          continue;
        }
      }
      const result = await dispatcher.execute(toolCall, session, signal);
      session.addToolObservation(toolCall.id, result);
    }
  }

  session.transition('failed', { reason: 'iteration_budget_exhausted' });
}
```

### 4.1 Bounds

| Bound | Default | Configurable |
|---|---:|---|
| Max model/tool iterations | 40 | Yes |
| Max tool calls per model turn | 8 | Yes |
| Max consecutive identical tool calls | 2 | Yes |
| Max provider retries per call | 3 | Yes |
| Max total tool result bytes per session | 4 MiB | Yes |
| Max wall-clock duration | 30 min | Yes |

Exceeding a bound transitions to `failed` or `paused_quota` with an explicit reason. Never spin indefinitely.

### 4.2 Duplicate-call detection

A call is a duplicate when `(toolId, canonicalJson(input))` matches a previous successful call in the same session and the tool is not explicitly marked `idempotent`. Duplicates are not executed; the prior observation is returned with `cached: true`.

## 5. Agent Modes

| Mode | Allowed tools | Write | Execute | Default routing |
|---|---|---|---|---|
| `ask` | read, search, diagnostics, git.status/diff | No | No | Fast/coding |
| `plan` | read, search, diagnostics, git.status/diff | No | No | Reasoning |
| `build` | all except destructive git | Yes (approval per policy) | Yes (approval) | Coding |
| `debug` | read, search, diagnostics, terminal (approval), write (approval) | Yes | Yes | Coding/reasoning |
| `review` | read, search, git.diff, diagnostics | No | No | Reasoning |

Mode enforcement is implemented by filtering the tool registry and by permission checks. Prompt instructions are not sufficient.

## 6. Context Handoff to Model

Each model call receives:

1. Immutable system policy (mode, safety, output contract).
2. Task statement and acceptance criteria.
3. Compacted conversation summary.
4. Relevant files and snippets with provenance.
5. Recent tool observations (truncated).
6. Available tool schemas filtered by mode.
7. Explicit instruction to use tool calls, not prose, for actions.

Never include API keys, full environment dumps, or files excluded by `.seekerignore`.

## 7. Tool-Call Validation

Before dispatch:

1. Parse arguments as JSON; reject on parse failure with a structured observation.
2. Validate against the tool's JSON Schema.
3. Check required capability: the selected model must support tool calls.
4. Check mode and permission class.
5. Check workspace path boundaries.
6. Check size/time limits.
7. Check idempotency/duplicate rules.
8. Attach an audit record with session ID, tool ID, and argument hash.

Invalid calls are returned to the model as errors; they are not executed.

## 8. Verification Engine

Verification is task-specific. A model's "done" message is never sufficient.

```ts
export interface AcceptanceCriterion {
  id: string;
  description: string;
  kind: 'file-exists' | 'file-contains' | 'command-exit-zero'
      | 'diagnostics-empty' | 'test-passed' | 'diff-contains' | 'manual';
  params: Record<string, unknown>;
  required: boolean;
}

export interface VerificationResult {
  satisfied: boolean;
  criteria: Array<{ id: string; passed: boolean; evidence?: string; error?: string }>;
  unverified: string[];
}
```

For the MVP, support at least:

- `command-exit-zero` (user-approved command)
- `diagnostics-empty` for changed files
- `file-exists`
- `file-contains`
- `manual` (explicit user confirmation)

If no criterion can be evaluated, the session completes as `completed_unverified`, and the UI must say so.

## 9. Events

```ts
export type AgentEvent =
  | { type: 'agent.started'; sessionId: string }
  | { type: 'agent.mode'; mode: AgentMode }
  | { type: 'model.selected'; provider: string; model: string; reason: string }
  | { type: 'assistant.delta'; text: string }
  | { type: 'assistant.reasoning'; text: string }
  | { type: 'tool.requested'; call: ToolCall }
  | { type: 'permission.requested'; request: PermissionRequest }
  | { type: 'permission.resolved'; id: string; approved: boolean }
  | { type: 'tool.started'; callId: string }
  | { type: 'tool.completed'; callId: string; ok: boolean; summary: string }
  | { type: 'quota.warning'; provider: string; message: string }
  | { type: 'model.fallback'; from: string; to: string; reason: string }
  | { type: 'verification.completed'; result: VerificationResult }
  | { type: 'agent.completed'; sessionId: string; verified: boolean }
  | { type: 'agent.failed'; sessionId: string; error: NormalizedError }
  | { type: 'agent.cancelled'; sessionId: string };
```

Events are append-only and persisted. The UI renders from the event stream, not from hidden mutable state.

## 10. Cancellation and Cleanup

- Every model request and tool execution receives an `AbortSignal`.
- Cancellation aborts the HTTP stream and kills child processes.
- In-flight file writes are atomic (temp file + rename) so cancellation cannot leave partial files.
- On cancellation, the session is checkpointed as `cancelled`, not `failed`.
- Webview disposal cancels active sessions owned by that view unless the user opts to keep them running.

## 11. Error Classification

| Class | Examples | Action |
|---|---|---|
| `transient` | network reset, 429 with retry-after | bounded retry, then fallback |
| `quota_exhausted` | daily free limit reached | pause, notify, offer provider switch |
| `auth` | invalid key, revoked key | stop, prompt for credentials |
| `capability` | model lacks tools | re-route to capable model |
| `context_overflow` | prompt too large | compact and retry once |
| `invalid_tool_call` | schema violation | return observation to model |
| `permission_denied` | user rejected | return observation |
| `tool_failure` | command exit non-zero | observation, allow repair loop |
| `fatal` | invariant violation | stop, preserve state, report |

## 12. Acceptance Criteria for This Design

- [ ] The loop can run with a mock provider and a mock tool registry without VS Code.
- [ ] Iteration, retry, and duplicate-call bounds are enforced by tests.
- [ ] Cancellation terminates HTTP streams and child processes.
- [ ] No side-effecting tool is replayed after a provider fallback.
- [ ] Completion without evidence is reported as unverified.
- [ ] Permissions are evaluated in code for every privileged call.

## 13. Related Documents

- [TOOL_SYSTEM.md](TOOL_SYSTEM.md)
- [SESSION_STATE.md](SESSION_STATE.md)
- [MODEL_ROUTER.md](MODEL_ROUTER.md)
- [QUOTA_AND_ROUTING.md](QUOTA_AND_ROUTING.md)
- [SECURITY.md](SECURITY.md)

# SESSION STATE

## 1. Objective

Persist enough information to resume an interrupted task safely, audit what happened, and render the UI from a deterministic event log.

State is split into:

- **Public state** — safe to send to the webview.
- **Private state** — host-only; may contain file content and tool output.
- **Secrets** — never part of session state.

## 2. Session Record

```ts
export interface AgentSession {
  id: string;                    // ULID
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  mode: AgentMode;
  task: {
    prompt: string;
    acceptanceCriteria: AcceptanceCriterion[];
    workspaceRoots: string[];
  };
  routing: {
    policy: RoutingPolicy;
    allowPaid: boolean;
    maxCostUsd: number;
    selected?: { provider: ProviderId; modelId: string; reason: string };
  };
  budget: TaskBudget;
  usage: {
    modelRequests: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
  conversation: ConversationTurn[];
  actions: ActionRecord[];
  checkpoints: CheckpointRef[];
  verification?: VerificationResult;
  error?: NormalizedError;
}

export type SessionStatus =
  | 'idle' | 'planning' | 'awaiting_model' | 'awaiting_tool'
  | 'awaiting_permission' | 'executing' | 'verifying'
  | 'paused_quota' | 'completed' | 'completed_unverified'
  | 'cancelled' | 'failed';
```

## 3. Conversation Turn

```ts
export interface ConversationTurn {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ContentBlock[];
  model?: { provider: ProviderId; modelId: string };
  createdAt: string;
  tokenEstimate?: number;
  compacted?: boolean;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; redacted?: boolean }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'tool-result'; callId: string; result: ToolResultSummary }
  | { type: 'file-ref'; path: string; range?: [number, number]; hash: string };
```

Large tool outputs are stored separately and referenced by ID. The conversation stores a truncated summary plus a reference.

## 4. Checkpoints

A checkpoint captures the state needed to resume without replaying side effects.

```ts
export interface Checkpoint {
  id: string;
  sessionId: string;
  createdAt: string;
  reason: 'iteration' | 'before_write' | 'after_write' | 'before_command'
        | 'after_command' | 'quota_pause' | 'cancel' | 'user';
  conversationLength: number;
  actionCount: number;
  workspace: WorkspaceFingerprint;
  fileVersions: Record<string, string>;   // path -> sha256
  git?: { head?: string; dirtyFiles: string[] };
}

export interface WorkspaceFingerprint {
  roots: string[];
  files: Record<string, { sha256: string; mtimeMs: number; size: number }>;
  capturedAt: string;
}
```

Checkpoints are created:

- Before any write or command.
- After a successful write or command.
- On quota pause, cancellation, and every N iterations.
- On explicit user request.

Checkpoints do **not** copy the entire repository by default. They record hashes and, for agent-created files, optionally store original content for safe restoration. Restoration must never discard pre-existing user changes.

## 5. Persistence Layout

Use `context.storageUri` / `context.globalStorageUri` (VS Code extension storage), not the workspace, unless the user opts into workspace-local history.

```text
<storage>/sessions/<sessionId>/
├── session.json          # metadata, status, usage, criteria
├── events.jsonl          # append-only AgentEvent log
├── conversation.jsonl    # turns, with large payload references
├── actions.jsonl         # ActionRecord entries
├── checkpoints/<id>.json
└── blobs/<sha256>        # large tool outputs, diffs
```

Rules:

- Append-only event log; no in-place rewriting of history.
- Atomic writes for metadata (`tmp` + rename).
- Size limits and retention policy (for example, keep the last 50 sessions; configurable).
- No secrets.
- Paths stored relative to workspace roots where possible.

## 6. Event Log

The UI and audit use the same event stream. Events include sequence numbers and are idempotent to render.

```ts
export interface StoredEvent {
  seq: number;
  sessionId: string;
  at: string;
  event: AgentEvent;
}
```

On resume, the host replays stored events to reconstruct UI state, then continues appending.

## 7. Compaction

When the conversation approaches the context budget:

1. Preserve the original task and acceptance criteria verbatim.
2. Preserve the current plan and step status.
3. Preserve all files changed and their hashes.
4. Preserve commands executed, exit codes, and key output.
5. Preserve pending approvals and unresolved errors.
6. Summarize older assistant reasoning and redundant tool output.
7. Mark compacted turns and keep references to blobs.
8. Never drop the action log; compaction affects prompts, not audit state.

```ts
export interface CompactionSummary {
  objective: string;
  completedSteps: string[];
  currentStep: string;
  filesChanged: Array<{ path: string; change: string; hash: string }>;
  commandsRun: Array<{ command: string; exitCode: number; summary: string }>;
  unresolvedErrors: string[];
  pendingApprovals: string[];
  remainingCriteria: string[];
}
```

## 8. Resume Semantics

Resume is explicit; it is not automatic on extension startup unless the user chooses.

1. Load session and validate schema version.
2. Replay events for UI.
3. Verify workspace fingerprints; if files changed since the checkpoint, warn and require review.
4. Identify actions with unknown status.
5. Reconcile unknown write/execute actions by inspecting observable state, not by re-running them.
6. Re-select a model using current quota and capability state.
7. Rebuild the prompt from the normalized conversation and compaction summary.
8. Continue.

If reconciliation is impossible, ask the user. Do not guess.

## 9. Schema Versioning

```ts
export const SESSION_SCHEMA_VERSION = 1;
```

- Each persisted record includes `schemaVersion`.
- Migrations are explicit, tested, and forward-only.
- Unknown future versions are opened read-only with a warning.

## 10. Concurrency

- One active agent loop per session.
- Multiple sessions may exist but only one may write to the workspace at a time by default.
- A workspace write lock prevents two sessions from applying patches concurrently.
- Stale locks are detected via timestamps and cleared with user confirmation.

## 11. Deletion and Privacy

- "Delete session" removes metadata, events, conversation, blobs, and checkpoints.
- "Clear all history" requires confirmation.
- Exported sessions are redacted by default.
- No session data leaves the machine unless the user explicitly exports it.

## 12. Acceptance Criteria

- [ ] A cancelled session can be resumed without re-running completed writes.
- [ ] A quota pause preserves the exact next intended step.
- [ ] A checkpoint detects external file edits and blocks unsafe restoration.
- [ ] Compaction retains objective, changed files, commands, errors, approvals, and remaining criteria.
- [ ] No secret is present in any persisted file.
- [ ] Corrupt session files fail closed with a recoverable error.

## 13. Related Documents

- [AGENT_ENGINE.md](AGENT_ENGINE.md)
- [QUOTA_AND_ROUTING.md](QUOTA_AND_ROUTING.md)
- [SECURITY.md](SECURITY.md)

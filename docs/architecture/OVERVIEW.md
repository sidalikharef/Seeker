# ARCHITECTURE OVERVIEW

## 1. Purpose

SEEKER is a provider-independent autonomous coding agent hosted in VS Code. It must operate with free hosted inference by default, degrade gracefully when free quotas are exhausted, and never require local GPU inference or a paid subscription for the MVP.

## 2. System Context

```text
┌──────────────────────────────────────────────────────────────┐
│ VS Code                                                      │
│                                                              │
│  ┌──────────────────┐        postMessage        ┌──────────┐ │
│  │ Webview (UI)     │ <───────────────────────> │ Extension│ │
│  │ chat, diffs,     │   typed message contract   │ Host     │ │
│  │ permissions      │                            │          │ │
│  └──────────────────┘                            └────┬─────┘ │
│                                                       │       │
│                                       ┌───────────────▼─────┐ │
│                                       │ Agent Core (no      │ │
│                                       │ direct `vscode`     │ │
│                                       │ dependency)         │ │
│                                       └───┬──────┬──────┬───┘ │
│                                           │      │      │     │
└───────────────────────────────────────────┼──────┼──────┼─────┘
                                            │      │      │
                                ┌───────────▼─┐ ┌──▼───┐ ┌▼──────────┐
                                │ Model Router│ │Tools │ │Context    │
                                └──────┬──────┘ └──┬───┘ └─────┬─────┘
                                       │           │           │
                                ┌──────▼───────────▼───────────▼─────┐
                                │ Provider adapters / workspace APIs  │
                                └────────────────────────────────────┘
```

## 3. Architectural Layers

### 3.1 Presentation layer (`src/extension/webview`, `src/extension/`)

- Owns VS Code API usage: commands, views, webview, SecretStorage, workspace, terminals.
- Converts VS Code events into core events and core events into UI messages.
- Contains no agent policy and no provider-specific logic.
- Never receives API keys.

### 3.2 Application layer (`src/core/`)

- Agent session manager, agent loop, state machine, event bus, verification.
- Depends on interfaces only: `ProviderAdapter`, `Tool`, `ContextProvider`, `PermissionManager`.
- Must be runnable in a non-VS Code host (future CLI) by injecting implementations.

### 3.3 Domain layer (`src/router/`, `src/tools/`, `src/context/`, `src/security/`)

- Model registry, routing policy, quota ledger.
- Tool definitions and execution contracts.
- Repository scanning, retrieval, token budgeting.
- Permission evaluation, path guards, redaction.

### 3.4 Infrastructure layer (`src/providers/`, `src/host/`)

- HTTP provider adapters, streaming parsers, rate-limit parsing.
- VS Code workspace/terminal implementations of core interfaces.
- Secret storage implementation.

Dependencies point inward: infrastructure → domain → application → presentation. No core module imports `vscode`.

## 4. Target Source Layout (MVP, single package)

```text
src/
├── extension.ts                 # activation, composition root
├── extension/
│   ├── commands.ts
│   ├── chat-view.ts             # WebviewViewProvider
│   ├── webview/
│   │   ├── main.ts
│   │   ├── main.css
│   │   └── protocol.ts          # shared message types
│   ├── secrets.ts               # SecretStorage wrapper
│   ├── workspace-host.ts        # workspace file operations
│   ├── terminal-host.ts         # child process execution
│   └── diagnostics.ts
├── core/
│   ├── agent-loop.ts
│   ├── session-manager.ts
│   ├── state.ts
│   ├── events.ts
│   ├── verification.ts
│   ├── errors.ts
│   └── modes.ts
├── providers/
│   ├── types.ts                 # ProviderAdapter, normalized events
│   ├── openrouter.ts
│   ├── groq.ts
│   ├── gemini.ts
│   ├── mistral.ts
│   ├── ollama.ts                # Phase 14
│   └── http.ts                  # SSE parsing, retries, abort
├── router/
│   ├── registry.ts
│   ├── router.ts
│   ├── policy.ts
│   ├── quota.ts
│   └── classify.ts
├── tools/
│   ├── types.ts
│   ├── registry.ts
│   ├── filesystem.ts
│   ├── search.ts
│   ├── terminal.ts
│   ├── git.ts
│   ├── diagnostics.ts
│   └── patch.ts
├── context/
│   ├── scanner.ts
│   ├── repo-map.ts
│   ├── retrieval.ts
│   ├── budget.ts
│   └── exclusions.ts
├── security/
│   ├── permissions.ts
│   ├── paths.ts
│   ├── redaction.ts
│   └── commands.ts
└── shared/
    ├── types.ts
    ├── result.ts
    └── tokens.ts
```

This is a **target**, not a mandate to create every file immediately. Phase 01 creates only the directories needed by that phase.

### 4.1 Extraction boundary

The `core/`, `providers/`, `router/`, `tools/` (contracts), `context/`, and `security/` modules must not import `vscode`. When a CLI or second host is built, these directories can move to `packages/*` without rewriting. See [ADR-0004](../decisions/ADR-0004-agent-core-separate-from-extension.md).

## 5. Core Interfaces (normative)

```ts
// src/providers/types.ts
export type ProviderId =
  | 'openrouter' | 'groq' | 'gemini' | 'mistral'
  | 'huggingface' | 'cerebras' | 'ollama' | 'openai-compatible';

export type FreeTierClass =
  | 'free-tier'        // documented recurring free usage
  | 'trial-credit'     // time/credit-bounded, not recurring
  | 'paid'             // requires payment per use
  | 'subscription'     // requires a paid plan
  | 'local'            // no hosted cost
  | 'unknown';

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly freeTierClass: FreeTierClass;
  listModels(signal?: AbortSignal): Promise<ModelDescriptor[]>;
  streamChat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
  healthCheck(signal?: AbortSignal): Promise<HealthStatus>;
}

export type ModelEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'usage'; usage: Usage }
  | { type: 'finish'; reason: FinishReason }
  | { type: 'error'; error: NormalizedProviderError };
```

```ts
// src/tools/types.ts
export type PermissionClass = 'read' | 'write' | 'execute' | 'network' | 'destructive';

export interface Tool<Input, Output> {
  id: string;                    // e.g. 'filesystem.read'
  description: string;
  permission: PermissionClass;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  timeoutMs: number;
  maxResultBytes: number;
  execute(input: Input, ctx: ToolContext): Promise<ToolResult<Output>>;
}
```

## 6. Primary Data Flow

1. User submits a request in the webview.
2. Extension host validates the message and creates or resumes an `AgentSession`.
3. Context engine builds a bounded context package.
4. Router selects a provider/model using capability, availability, quota, and policy.
5. Provider adapter streams normalized events.
6. Agent loop validates any tool calls, checks permissions, executes tools, and appends observations.
7. Loop continues until completion, cancellation, budget exhaustion, or a non-recoverable error.
8. Verification engine checks acceptance criteria using tool evidence.
9. UI receives structured events; changes are shown as diffs before application where required.
10. Session state and checkpoints are persisted.

## 7. Non-Goals for the MVP

- Multi-agent orchestration.
- Browser automation.
- MCP integration.
- Vector databases or embeddings-first retrieval.
- Custom model training.
- A hosted backend service.
- Local inference as a requirement.
- Autonomous Git commits or pushes.
- Automatic dependency installation without approval.

## 8. Architectural Invariants

1. No provider SDK is required; adapters use `fetch` and normalized types.
2. Unknown capabilities are `unknown`, never `true`.
3. Free-tier classification is explicit metadata, not inferred from price alone.
4. Permissions are enforced in code before tool execution.
5. Side-effecting tools are never automatically replayed on retry.
6. The agent core does not import `vscode`.
7. API keys never enter the webview.
8. Every phase leaves a compilable repository.
9. Every completion claim is backed by verification evidence or explicitly marked unverified.
10. Documentation does not describe planned behavior as implemented.

## 9. Related Documents

- [AGENT_ENGINE.md](AGENT_ENGINE.md)
- [MODEL_ROUTER.md](MODEL_ROUTER.md)
- [CONTEXT_ENGINE.md](CONTEXT_ENGINE.md)
- [TOOL_SYSTEM.md](TOOL_SYSTEM.md)
- [SECURITY.md](SECURITY.md)
- [SESSION_STATE.md](SESSION_STATE.md)
- [QUOTA_AND_ROUTING.md](QUOTA_AND_ROUTING.md)
- [MASTER_PLAN.md](../roadmap/MASTER_PLAN.md)

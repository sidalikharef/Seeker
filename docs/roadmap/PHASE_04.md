# PHASE 04 — VS CODE CHAT UI

## Objective

Provide a secure, responsive sidebar for streaming chat, model selection, mode selection, cancellation, and permission responses.

## Current Repository State

No webview, no view contribution, no message protocol, no streaming UI.

## Dependencies

- Phase 01 complete.
- Phase 03 complete (routing decisions are displayed).

## Scope

- `WebviewViewProvider` sidebar.
- Strict CSP and typed message protocol.
- Streaming assistant messages.
- Provider/model selector with free-tier indicator.
- Mode selector (Ask, Plan, Build, Debug, Review).
- Cancel button.
- Tool activity list.
- Permission request cards.
- Error state with retry/switch/cancel actions.
- Light/dark theme support and keyboard navigation.
- No file editing yet; the UI must render events even if no tools exist.

## Architecture Decisions

- The webview is a renderer only. All provider calls and secrets stay in the extension host.
- No framework dependency for the MVP; use semantic HTML, CSS variables, and small TypeScript modules compiled separately.
- Use `postMessage` with a discriminated union validated in the host.
- Use `vscode.setState` only for transient UI state; authoritative session state lives in the host.
- Render model text with `textContent`/DOM nodes, never `innerHTML`.
- Use VS Code theme variables for colors.
- Disable `connect-src` entirely.

## Implementation Tasks

- [ ] Add `viewsContainers` and `views` contributions for the SEEKER sidebar.
- [ ] Implement `src/extension/chat-view.ts` as a `WebviewViewProvider`.
- [ ] Add CSP with a per-load nonce for scripts.
- [ ] Create `src/extension/webview/protocol.ts` with `HostToWebview` and `WebviewToHost` unions.
- [ ] Validate every inbound message; reject unknown types and oversized payloads.
- [ ] Build the webview HTML/CSS/TS with:
  - [ ] message list
  - [ ] streaming caret
  - [ ] input and send
  - [ ] stop button
  - [ ] mode selector
  - [ ] provider/model selector
  - [ ] free-tier badge
  - [ ] tool activity list
  - [ ] permission card with approve/reject
  - [ ] error banner with actions
- [ ] Implement streaming delta rendering with batched DOM updates.
- [ ] Implement cancellation from the UI to the active request.
- [ ] Implement model list refresh and selection persistence in workspace state.
- [ ] Implement keyboard shortcuts: send, newline, cancel.
- [ ] Add ARIA labels, focus management, and live-region announcements for streaming.
- [ ] Ensure the layout works in narrow and wide sidebars.
- [ ] Add a webview unit test for protocol validation.
- [ ] Add an extension test that opens the view and exchanges a message.

## Files and Packages Affected

- `package.json` contributions
- `src/extension/chat-view.ts`
- `src/extension/webview/protocol.ts`, `main.ts`, `main.css`, `index.html`
- `src/extension/commands.ts`
- `test/unit/webview/protocol.test.ts`
- `test/extension/chat-view.test.ts`
- Build config for the webview assets

## API Contracts

```ts
type HostToWebview =
  | { type: 'init'; state: PublicUiState }
  | { type: 'assistant.start'; messageId: string }
  | { type: 'assistant.delta'; messageId: string; text: string }
  | { type: 'assistant.end'; messageId: string }
  | { type: 'tool.activity'; id: string; label: string; status: 'running' | 'ok' | 'error' }
  | { type: 'permission.request'; request: PublicPermissionRequest }
  | { type: 'permission.resolved'; id: string; approved: boolean }
  | { type: 'error'; message: string; recoverable: boolean; actions: string[] };

type WebviewToHost =
  | { type: 'ready' }
  | { type: 'submit'; text: string; mode: AgentMode }
  | { type: 'cancel' }
  | { type: 'permission.response'; id: string; approved: boolean }
  | { type: 'selectModel'; provider: string; modelId: string }
  | { type: 'setMode'; mode: AgentMode }
  | { type: 'refreshModels' }
  | { type: 'openSettings' };
```

## Data Structures

```ts
export interface PublicUiState {
  mode: AgentMode;
  providers: Array<{
    id: string;
    configured: boolean;
    freeTierClass: FreeTierClass;
    models: Array<{ id: string; name: string; freeTierClass: FreeTierClass; capabilities: string[] }>;
  }>;
  selected?: { provider: string; modelId: string };
  session?: { id: string; status: string; messages: PublicMessage[] };
}
```

`PublicUiState` must never contain secrets or full file contents.

## Security Considerations

- CSP: `default-src 'none'; script-src 'nonce-...'; style-src 'nonce-...' ${cspSource}; img-src ${cspSource} data:; connect-src 'none'`.
- No inline event handlers.
- No remote fonts or scripts.
- Escape all model and tool text.
- Validate message shapes and size limits.
- Do not expose API keys or provider raw errors.
- Permission cards show the exact command/diff, not just a model summary.

## Error Handling

- Show a recoverable error banner with retry, switch model, and cancel.
- Keep the input usable after an error.
- Disable send while a request is active; allow cancel.
- If the webview is disposed during a run, cancel or detach according to policy and inform the user.

## Test Plan

- Unit: protocol validator rejects malformed messages.
- Unit: streaming delta batching does not reorder text.
- Extension: view resolves, receives `ready`, and accepts `submit`.
- Extension: cancel message aborts the active session.
- Accessibility: keyboard-only send/cancel and focus order.
- Visual: light/dark theme variables only.

## Acceptance Criteria

- [ ] Sidebar opens and renders.
- [ ] Streaming text appears incrementally.
- [ ] Cancel stops the stream.
- [ ] Mode and model selectors update host state.
- [ ] Free-tier badge is accurate.
- [ ] Permission cards show exact action details.
- [ ] CSP blocks inline and remote scripts.
- [ ] UI works with keyboard and both themes.

## Risks

- Webview lifecycle can drop messages; use a ready handshake and idempotent init.
- Rendering every token can be slow; batch updates.
- Framework creep; avoid adding React/Vue for the MVP.

## Definition of Done

- [ ] Acceptance criteria pass.
- [ ] Protocol validation and CSP tests pass.
- [ ] No secret crosses the webview boundary.
- [ ] TD-14 is closed.

## Out of Scope

- Diff editor integration (Phase 05).
- Rich markdown rendering beyond safe text/code blocks.
- Session history UI (later).
- Settings UI beyond a button to open settings.

## Completion Status

**Not started.**

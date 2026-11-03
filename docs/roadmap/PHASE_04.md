# PHASE 04 — VS CODE CHAT UI

## Objective

Provide a secure, responsive sidebar for streaming chat, model selection, cancellation, settings, and credential management.

## Status

**IMPLEMENTED (MVP scope).** Local unit, integration, extension-host, typecheck, lint, format, build, and packaging checks pass. Live provider streaming remains unverified because no OpenRouter or Groq API keys were available.

## Dependencies

- Phase 01 complete.
- Phase 03 complete (routing decisions and quota state are consumed by the chat service).

## Implemented

### Extension surface

- Activity-bar container `seeker` and webview view `seeker.chat`.
- Activation on `onView:seeker.chat`, with the existing command-based activation retained.
- `ChatViewProvider` implements `WebviewViewProvider` and disposes its service subscription, message listener, and view references.
- Native credential flows use the existing `seeker.setApiKey` and `seeker.clearApiKey` commands; API keys never enter webview state or messages.
- Settings changes submitted by the webview are written to global VS Code configuration.

### Chat and routing

- `ChatService` performs real routing through `ModelRouter`, provider adapters, `ModelCatalog`, `ModelRegistry`, and `QuotaLedger`.
- Automatic routing honors the configured policy, preferred provider/model, paid fallback, cost limit, and excluded providers.
- Explicit model selection forces manual routing for that request.
- Unconfigured and disabled providers are excluded from routing and model refresh.
- Streaming text is delivered incrementally, with one terminal state per assistant message.
- Cancellation aborts the active provider request through `AbortController`.
- Retry reuses the last prompt and selection without duplicating the user message.
- Empty responses, content-filter finishes, tool-call-only responses, auth failures, quota exhaustion, rate limits, timeouts, network failures, and provider protocol errors produce explicit UI states.
- Paid models are unavailable unless `allowPaid` is enabled, the cost cap is non-zero, pricing is known, and the estimate is within the cap.
- Model lists refresh only for configured providers; stale persisted selections are cleared.
- Chat messages and model selection are persisted in workspace state. Credentials are not persisted there.
- Context is bounded to 40 messages and 60,000 characters.

### Protocol and security

- Typed discriminated unions in `src/extension/webview/protocol.ts`:
  - host-to-webview: `init`, `state`, assistant start/delta/end, tool activity, permission events, errors;
  - webview-to-host: ready, send, cancel, retry, model select/auto, mode set, refresh, credential management, settings update/open.
- Runtime validation rejects unknown message types, malformed IDs, invalid provider/model pairs, unsupported modes, invalid routing policies, and oversized messages.
- Limits: 32 KiB chat message, 64 KiB webview message.
- CSP includes a per-load nonce, prohibits inline/eval scripts, and sets `connect-src 'none'`.
- Styles are read from `media/webview.css` and injected with the nonce.
- Model output is rendered with DOM text nodes and `textContent`; only fenced code blocks receive special layout.
- No raw API key or provider request body is posted to the webview.

### Sidebar behavior

- Message list, streaming status, error banner with available recovery actions, and retry.
- Provider/model selector with availability reasons, including missing key, paid gating, unsupported streaming, and quota state.
- Routing policy and preferred-provider settings.
- Add/replace/remove API key controls for both providers.
- Send, Stop, Enter-to-send, Shift+Enter for newline, Escape to cancel.
- Batched streaming updates through `requestAnimationFrame`.
- Safe code blocks with copy buttons.
- ARIA live announcements, labels, focus-visible styles, and light/dark VS Code theme variables.
- Responsive layout for narrow and wide sidebars.

## Deliberate Scope Decisions

- **Only Ask mode is exposed.** Plan, Build, Debug, and Review remain hidden until their backend behavior, tools, and permissions exist. A decorative mode selector would falsely imply working capabilities.
- **No permission cards yet.** The protocol contains forward-compatible permission event shapes, but there is no permission backend in Phase 04, so the UI does not expose approve/reject controls.
- **No tool activity output yet.** The activity container exists for Phase 05–06 events, but no tool events are emitted in this phase.
- **No full Markdown renderer.** Plain text and fenced code blocks are supported. Links, HTML, images, and raw Markdown are not interpreted.
- **Manual webview interaction remains a review item.** The extension-host test opens the contributed view. Automated DOM message exchange is not available through the VS Code test API; host-side message handling is covered by protocol unit tests and a real local SSE `ChatService` integration test.

## Files

- `package.json` — view/container contributions, activation event.
- `src/extension.ts` — chat service composition, view registration, lifecycle.
- `src/extension/chat-view.ts` — webview provider, CSP HTML, message dispatch.
- `src/extension/chat-service.ts` — session, routing, streaming, cancellation, persistence.
- `src/extension/webview/protocol.ts` — public state and validated messages.
- `src/extension/webview/security.ts` — CSP builder.
- `src/extension/provider-settings.ts` — enabled-provider resolution.
- `src/webview/main.ts` — standalone webview renderer and input handling.
- `media/webview.css` — theme-aware sidebar styles.
- `media/seeker.svg` — activity-bar icon.
- `test/unit/chat-service.test.ts`
- `test/unit/webview-protocol.test.ts`
- `test/unit/webview-security.test.ts`
- `test/unit/provider-settings.test.ts`
- `test/integration/chat/mock-stream.test.ts`
- `test/extension/suite/index.js`

## API Contracts

The implemented protocol is broader than the original sketch. The authoritative definitions are in `src/extension/webview/protocol.ts`. Key invariants:

- Every host event carries a discriminated `type`.
- Streaming assistant events include the originating `requestId` and `messageId`.
- Only a paired provider/model selection is valid.
- `mode.set` accepts only `ask` in this phase.
- Credential actions are limited to `set` and `delete` for known provider IDs.
- Inbound messages are validated before dispatch.

## Security Considerations

- CSP: `default-src 'none'; script-src 'nonce-...'; style-src 'nonce-...' ${cspSource}; img-src ${cspSource} data:; connect-src 'none'`.
- No inline event handlers, remote fonts, remote scripts, or webview network access.
- Model and tool text is inserted as text, never HTML.
- Invalid messages receive a non-recoverable error and are not dispatched.
- API keys remain in SecretStorage and are used only by provider adapters in the extension host.
- Provider errors are normalized and redacted before reaching the webview.

## Error Handling

- Recoverable errors offer only actions that are valid for the error: retry, settings, or model refresh.
- The input remains usable after an error.
- Send is disabled while a request is active; Stop is available.
- Authentication and quota failures update provider/model availability.
- If the view is disposed, the provider service remains owned by the extension and the view subscription stops posting.

## Tests Executed

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm test:unit` | Pass — 17 files, 119 tests |
| `pnpm test:integration` | Pass — 3 files, 4 tests |
| `pnpm format:check` | Pass |
| `pnpm build` | Pass |
| `pnpm test:extension` | Pass — VS Code 1.144.0 activates the extension and opens the SEEKER view |
| `pnpm package` | Pass — `seeker-0.0.1.vsix` |

Coverage includes streaming order, explicit model routing, no-provider errors, auth failure, rate-limit retry/fallback, quota exhaustion after a successful final stream, cancellation, retry without duplicate user messages, paid-model gating, persistence without credentials, stale-selection pruning, configured-only refresh, protocol validation, CSP assertions, disabled-provider filtering, and a local HTTP SSE stream through the real OpenAI-compatible transport into `ChatService`.

## Acceptance Criteria

- [x] Sidebar opens and renders.
- [x] Streaming text appears incrementally (mock SSE integration).
- [x] Cancel stops the stream (unit and mock-server cancellation).
- [x] Model selector updates host state.
- [x] Routing policy and preferred provider update host state.
- [x] Free-tier and unavailable reasons are shown.
- [x] CSP blocks inline/remote scripts and webview network access.
- [x] Add/remove API-key flows use native prompts and SecretStorage.
- [x] Messages and selection persist; credentials do not.
- [x] Keyboard send/newline/cancel behavior is implemented.
- [ ] All five modes are available — intentionally deferred.
- [ ] Permission cards are available — intentionally deferred to Phase 06.
- [ ] Automated DOM message exchange — not supported by the VS Code test API.
- [ ] Manual keyboard/theme/accessibility review — pending.
- [ ] Live OpenRouter/Groq streaming — blocked by missing credentials.

## Remaining Limitations

- Provider enable/disable flags are read at extension activation; changing them requires a window reload.
- Live provider behavior is not verified against real OpenRouter or Groq endpoints.
- Only Ask mode is user-visible.
- Tool activity and permission controls are placeholders for later phases and emit nothing today.
- No session history UI; the current session is restored, but there is no conversation browser.
- No real Markdown renderer beyond fenced code blocks.
- No commit exists because none was requested.

## Completion Status

**IMPLEMENTED for Phase 04 MVP scope, not fully VERIFIED.** The secure webview contract, real streaming path, cancellation, model/routing controls, credential management, persistence, and packaging checks pass locally. Full verification still requires live-provider testing and a manual accessibility/theme pass. TD-14 (webview CSP/message contract) is closed for this scope; TD-21 (accessibility/theme verification) remains open until the manual pass is recorded.

# PHASE 15 — BROWSER AUTOMATION

## Objective

Enable verification of web applications through controlled browser automation, with explicit permissions and strict limits.

## Current Repository State

No browser tooling exists. The MVP does not require it.

## Dependencies

- Phase 07 (agent loop/tools).
- Phase 10 (test workflows).
- Phase 13 recommended for safety testing.

## Scope

- Browser tool interface.
- Playwright-based implementation (evaluated).
- Navigation, screenshot, DOM inspection, console/network capture.
- Permission model for sensitive interactions.
- Sandboxing and limits.
- No credential entry or payment actions without explicit approval.
- No browser bundled in the MVP.

## Architecture Decisions

- Browser automation is a tool provider, not a core agent dependency.
- Playwright is the primary candidate; evaluate bundle size, licensing, and cross-platform support before adoption.
- Run browsers headless by default.
- Restrict navigation to localhost and explicitly allowlisted origins by default.
- Treat page content as untrusted input.
- Never auto-fill credentials or complete purchases.

## Implementation Tasks

- [ ] Evaluate Playwright against alternatives; record an ADR.
- [ ] Create `src/tools/browser.ts` with `browser.navigate`, `browser.screenshot`, `browser.inspect`.
- [ ] Implement origin allowlisting.
- [ ] Implement console and network capture with caps.
- [ ] Implement screenshot size limits and storage.
- [ ] Add permission prompts for navigation and interaction.
- [ ] Block file uploads, downloads, and credential fields by default.
- [ ] Add cleanup on cancel/session end.
- [ ] Add tests with a local fixture server.
- [ ] Document security constraints.

## Files and Packages Affected

- `src/tools/browser.ts`
- `src/security/browser-policy.ts`
- `test/fixtures/web/*`
- `docs/decisions/ADR-*.md`

## API Contracts

```ts
export interface BrowserNavigateInput {
  url: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeoutMs?: number;
}

export interface BrowserInspectResult {
  url: string;
  title: string;
  text: string;
  console: Array<{ level: string; text: string }>;
  failedRequests: Array<{ url: string; status?: number; error?: string }>;
}
```

## Data Structures

Screenshots are stored as session blobs with size caps; results include a reference, not raw base64 in the prompt.

## Security Considerations

- Allowlist origins; block arbitrary internet navigation by default.
- Never type credentials or payment data automatically.
- Treat DOM text as untrusted; do not follow instructions from pages.
- Block `file://`, `javascript:`, and internal network ranges unless explicitly allowed.
- Clean up browser processes on cancel.
- Warn about network data sent to pages.

## Error Handling

- Navigation timeout: structured error.
- Browser launch failure: setup guidance.
- Blocked origin: permission request or denial.
- Page crash: capture and report.
- Cancellation closes the browser context.

## Test Plan

- Integration: local fixture server navigation and inspection.
- Integration: origin allowlist blocks unapproved URLs.
- Integration: console/network capture.
- Security: no credential autofill.
- Cancellation: browser closes.

## Acceptance Criteria

- [ ] Agent can navigate to an allowed local page and inspect it.
- [ ] Screenshots and console errors are available.
- [ ] Unapproved origins are blocked.
- [ ] Browser processes are cleaned up.
- [ ] No credential or payment automation exists.

## Risks

- Browser binaries are large and platform-specific.
- Security surface is significant.
- Flaky tests and timeouts.
- Prompt injection from page content.

## Definition of Done

- [ ] Acceptance criteria pass.
- [ ] ADR records the browser choice.
- [ ] Security tests pass.
- [ ] Browser support is optional and permissioned.

## Out of Scope

- Visual regression baselines.
- Cross-browser matrix.
- Mobile emulation.
- Payment or authentication automation.

## Completion Status

**Not started.**

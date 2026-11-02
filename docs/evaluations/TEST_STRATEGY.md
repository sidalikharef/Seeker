# Test Strategy

## Purpose

Define how SEEKER is tested from the first commit, with emphasis on agent reliability, safety, and free-tier behavior rather than only unit coverage.

## Principles

- Tests must not require paid services or real API keys.
- Deterministic tests are the gate; real-provider runs are optional evidence.
- Security boundaries are tested as product behavior.
- A task is only successful if verification passes.
- Provider failures, quota exhaustion, and cancellation are normal cases, not edge cases.
- No test may perform destructive Git operations or execute untrusted code on the host.

## Test Layers

### 1. Unit tests (Vitest)

Scope:

- Context budgeting, ranking, deduplication, and redaction.
- Patch parsing, validation, and application.
- Path safety and workspace containment.
- Router classification, quota ledger arithmetic, cooldowns, and fallback decisions.
- Capability registry tri-state logic.
- Command validation and permission classification.
- Provider request/response normalization.

Rules:

- No network.
- Use fake timers for cooldowns and resets.
- Use temporary directories for filesystem tests.
- Each test must be deterministic and isolated.

### 2. Integration tests

Scope:

- Extension activation and command registration.
- Provider adapters against local mock servers.
- Agent loop against a mock provider that emits scripted tool calls.
- Webview message validation and CSP.
- Session persistence and resumption.
- Git checkpoints and restore in temporary repositories.
- MCP and browser tools against local fixtures (when implemented).

Rules:

- Use the VS Code test runner for extension-host tests.
- Use a local HTTP server for provider mocks.
- Use a fixture workspace checked into the repo.
- Clean up processes and temporary directories.

### 3. Agent evaluations

Scope:

- End-to-end tasks in fixture repositories.
- Success is determined by objective acceptance checks (tests, type checks, diffs).
- Metrics: success, verification pass, requests, tokens, tool failures, runtime, unauthorized actions, recovery.

See [AGENT_BENCHMARKS.md](./AGENT_BENCHMARKS.md).

### 4. Security tests

Scope:

- Path traversal (`../`, absolute paths, symlinks).
- Command classification bypasses (chained commands, shell metacharacters, encodings).
- Prompt injection via files, tool output, web pages, and MCP results.
- Secret redaction and log hygiene.
- Webview CSP and message origin/schema validation.
- Excluded-file enforcement.
- Provider error handling that could leak keys.

Rules:

- Tests must assert denial, not just absence of a crash.
- Fuzz tool arguments and webview messages.
- No real secrets; use synthetic values and scan outputs.

### 5. Performance tests

Scope:

- Context build time on a large fixture.
- First-token latency on a mock stream.
- Memory bounds for sessions and caches.
- Token usage regression against a baseline.

### 6. Manual smoke tests

Required before release:

- Install the VSIX in a clean VS Code profile.
- Set a key, list models, send a message, stop a stream.
- Run a Build-mode task in a disposable repository.
- Trigger a quota error and confirm the UI explains it.
- Confirm the Command Palette commands match `package.json`.

## Fixtures

- Keep fixtures small and versioned.
- Each fixture states its acceptance command (for example `pnpm test`, `tsc --noEmit`).
- Fixtures must not contain secrets, large binaries, or network dependencies.
- Include at least one non-Git fixture and one dirty-worktree fixture.

## Determinism

- Mock providers use seeded responses.
- Time-dependent logic uses fake timers.
- Tests must not depend on the order of filesystem iteration.
- Flaky tests are quarantined and fixed; they are not retried into passing.

## Coverage Expectations

- 100% of permission-decision branches.
- 100% of quota-state transitions.
- High coverage of patch application and path validation.
- Coverage percentage is not a substitute for behavior tests; no arbitrary global threshold is enforced initially.

## CI

- On every push: install, typecheck, lint, unit tests, integration tests (mock), security tests, build.
- Nightly/optional: real-provider smoke tests with owner-provided keys and explicit consent.
- Release: full suite, VSIX packaging, clean-profile install.

## What Is Not Tested Automatically

- Paid providers.
- Real user repositories.
- Marketplace publication.
- OS-specific browser automation beyond the CI matrix.

## Traceability

| Requirement | Test layer |
|---|---|
| Provider abstraction | Unit + integration mocks |
| Free-tier quota | Unit + integration |
| Safe fallback | Unit + agent evals |
| Patch editing | Unit + integration |
| Path safety | Security |
| Command permissions | Security |
| Secret redaction | Security |
| Session resume | Integration |
| Verification honesty | Agent evals |
| Cancellation | Integration + agent evals |

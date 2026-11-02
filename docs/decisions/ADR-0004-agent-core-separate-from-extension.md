# ADR-0004 — Agent Core Separate from the Extension Host

## Status

Accepted

## Date

2026-11-01

## Context

SEEKER may eventually run as a CLI or desktop app. Coupling the agent loop to VS Code APIs would make that extraction expensive and would make core logic hard to test. At the same time, a monorepo is unnecessary while only one host exists.

## Decision

Keep the agent core in `src/` but enforce host independence:

- `core/`, `providers/`, `router/`, `tools/` (contracts), `context/`, and `security/` must not import `vscode`.
- VS Code integration lives in `src/extension/` and `src/tools/` host-specific implementations.
- The core communicates through interfaces and events.
- Do not create a monorepo yet; extract to `packages/*` only when a second host is built.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Monorepo immediately | Overhead without a second host |
| Core imports `vscode` freely | Blocks reuse and complicates tests |
| Separate npm package now | Publishing and versioning overhead for an MVP |
| Duplicate core per host | Divergence and double maintenance |

## Consequences

### Positive

- Core is testable without the extension host.
- A future CLI or desktop host can reuse the core.
- Clear boundaries reduce accidental coupling.

### Negative

- Requires discipline and a lint rule or review check.
- Some abstractions exist before a second host proves them.
- Host-specific features need adapter layers.

### Security and privacy

- Keeping the core host-independent makes the permission layer reusable and harder to bypass.
- Host-specific secret storage must not leak into core logs.

### Operational

- Add a CI check that rejects `vscode` imports in core directories.
- Document module boundaries in `OVERVIEW.md`.

## Follow-up

- Enforce boundaries with ESLint `no-restricted-imports`.
- Revisit extraction when a second host is approved.

## References

- [OVERVIEW.md](../architecture/OVERVIEW.md)
- [ADR-0001](./ADR-0001-typescript-vscode-extension.md)

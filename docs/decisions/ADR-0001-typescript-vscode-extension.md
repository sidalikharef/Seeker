# ADR-0001 — TypeScript VS Code Extension as the First Host

## Status

Accepted

## Date

2026-11-01

## Context

SEEKER is an AI coding agent intended to work where developers already edit code. The repository already contains a minimal VS Code extension scaffold, and the MVP must ship quickly without building a desktop app, CLI, or web service first. The team is small and the maintenance budget is limited.

## Decision

Build the first host as a TypeScript VS Code extension. Use the existing strict `tsconfig.json` (CommonJS, ES2022, `out/`) for the MVP and keep the agent core host-independent so another host can reuse it later.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Standalone desktop app | Much larger surface: window management, updates, editor, terminals, settings |
| CLI first | Poor fit for inline diffs, selections, and editor context |
| Web app | Requires hosting, authentication, and file access design; weak local integration |
| Monorepo from day one | Premature; only one host exists |

## Consequences

### Positive

- Reuses the existing scaffold and VS Code APIs.
- Direct access to editor state, diagnostics, terminals, and diff views.
- Familiar distribution through VSIX and the Marketplace.

### Negative

- Tied to VS Code APIs for the first host.
- Extension-host constraints affect long-running work and memory.

### Security and privacy

- Secrets can use VS Code SecretStorage.
- Workspace trust and extension sandboxing apply, but the agent still needs its own permission layer.

### Operational

- TypeScript build and VS Code test runner are required.
- A second host later requires extracting the core.

## Follow-up

- Keep `core/`, `providers/`, `router/`, `tools/`, `context/`, and `security/` free of `vscode` imports (see ADR-0004).
- Revisit packaging if a second host is approved.

## References

- [OVERVIEW.md](../architecture/OVERVIEW.md)
- [PHASE_00.md](../roadmap/PHASE_00.md)

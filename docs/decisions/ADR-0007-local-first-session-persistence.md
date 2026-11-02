# ADR-0007 — Local-First Session Persistence

## Status

Accepted

## Date

2026-11-01

## Context

Agent sessions contain prompts, tool output, diffs, and possibly sensitive code. Sessions must survive window reloads and support resumption, but storing them remotely creates privacy, cost, and availability problems. The MVP has no backend.

## Decision

Persist sessions locally under VS Code extension storage:

- One JSON metadata file per session plus content-addressed blobs for large payloads.
- Store only what is needed to resume: messages, plan, tool results (redacted/capped), checkpoints, and quota state.
- Apply retention limits and user-configurable cleanup.
- Never store API keys in session data; keys stay in SecretStorage.
- Exclude secrets and excluded files before persistence.
- Do not sync sessions to a remote service in the MVP.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Remote session store | Backend cost, privacy, authentication, availability |
| In-memory only | Loses work on reload; poor UX |
| Store full tool output | Unbounded size and secret risk |
| Store sessions in the workspace | Pollutes repositories and may be committed |

## Consequences

### Positive

- Works offline and without a backend.
- User data stays on the user's machine.
- Resumption after reload is possible.
- Simple to implement and test.

### Negative

- No cross-device sync.
- Local storage can grow; retention is required.
- Users must manage backups.
- Corruption handling is needed.

### Security and privacy

- Redact secrets before writing.
- Respect exclusions.
- Use extension storage permissions.
- Document that local storage is not encrypted by default beyond OS protections.

### Operational

- Add schema versioning and migration.
- Cap blob sizes and total storage.
- Provide a "clear sessions" command.

## Follow-up

- Implement persistence in Phase 07.
- Add retention and cleanup settings.

## References

- [SESSION_STATE.md](../architecture/SESSION_STATE.md)
- [PHASE_07.md](../roadmap/PHASE_07.md)

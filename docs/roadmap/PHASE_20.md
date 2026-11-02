# PHASE 20 — FUTURE EXPANSION

## Objective

Record credible future directions without committing the MVP to them.

## Current Repository State

No CLI, desktop host, remote execution, plugin system, or collaboration features exist.

## Dependencies

- Phase 19 (public release).

## Scope

Exploration and design only. Each direction requires its own ADR, threat model, and evidence of user demand.

## Architecture Decisions

- The agent core is host-independent so a CLI or desktop host can reuse it.
- Any new host must reuse the same permission and quota model.
- Remote execution requires a separate security review.
- Plugins must be permissioned and sandboxed.
- Collaboration must address data ownership and secrets.
- None of these are MVP requirements.

## Candidate Directions

### 20.1 CLI

Reuse `core/`, `providers/`, `router/`, `tools/`, `context/`, `security/` with a terminal host. Requires extraction to packages and a permission UI for terminal approvals.

### 20.2 Desktop application

A dedicated host with richer diff and session management. Reuses the agent core.

### 20.3 Remote workspaces and SSH

Operate on remote repositories. Requires path, process, and secret handling over a remote boundary, plus latency and quota considerations.

### 20.4 Containerized execution

Run commands and tests in a container for isolation. Requires image management, mounts, and network policy.

### 20.5 Project memory

Persist durable project facts and decisions. Must be inspectable, editable, and privacy-preserving. Do not add a vector database without evidence.

### 20.6 Visual application testing

Extend browser automation with screenshot comparison and interaction flows.

### 20.7 Plugin ecosystem

Third-party tools with manifests, permissions, signatures, and sandboxing.

### 20.8 Collaboration

Shared sessions, comments, and review. Requires identity, access control, and data residency design.

## Implementation Tasks

- [ ] Collect user demand evidence before selecting a direction.
- [ ] Write an ADR for the chosen direction.
- [ ] Define a threat model.
- [ ] Estimate maintenance cost.
- [ ] Define acceptance criteria.
- [ ] Do not begin implementation without the above.

## Files and Packages Affected

- `docs/decisions/*`
- Future `packages/*` or `apps/*`

## API Contracts

Future hosts must implement the same core interfaces. No core API is designed in this phase.

## Data Structures

None.

## Security Considerations

- Remote and collaborative features expand the trust boundary.
- Plugins are untrusted code by default.
- Container execution must not expose host secrets.
- Project memory must not store secrets.

## Error Handling

Not applicable until a direction is selected.

## Test Plan

Not applicable until a direction is selected. Any future direction must include unit, integration, security, and evaluation tests.

## Acceptance Criteria

- [ ] No future direction is implemented without an ADR and threat model.
- [ ] MVP scope is unaffected.
- [ ] User demand is documented.

## Risks

- Scope creep.
- Security regressions from remote/plugin features.
- Maintenance burden.
- Premature platform expansion.

## Definition of Done

- [ ] This document accurately reflects deferred status.
- [ ] No future feature is described as available.

## Out of Scope

Everything in this phase until explicitly approved.

## Completion Status

**Not started (intentionally deferred).**

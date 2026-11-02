# ADR-0005 — Patch-Based Editing with Conflict Detection

## Status

Accepted

## Date

2026-11-01

## Context

Agents that rewrite whole files are prone to destroying user changes, reformatting unrelated code, and producing unreviewable diffs. SEEKER needs edits that are precise, reviewable, and safe to apply while the user may also be editing.

## Decision

Represent edits as structured patches:

- Each patch targets a path and a specific range or anchored text.
- Include the expected pre-image hash (SHA-256).
- Validate paths against the workspace and exclusions.
- Reject patches whose pre-image hash does not match.
- Apply atomically per file where possible; report partial failures.
- Show a diff before applying in interactive mode.

Do not accept whole-file overwrite as the default editing mechanism. Whole-file creation is allowed for new files.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Whole-file replacement | Destroys unrelated changes; hard to review |
| Unified diff text from the model | Fragile parsing; line offsets drift |
| Search/replace strings only | Ambiguous matches; no conflict detection |
| Direct write without preview | Unsafe for user trust |

## Consequences

### Positive

- Small, reviewable diffs.
- Conflict detection prevents overwriting concurrent edits.
- Better token efficiency than rewriting entire files.
- Works for multi-file changes.

### Negative

- The model must produce well-formed patches; parsing and repair are needed.
- Anchored text can be ambiguous.
- Some models are worse at patch formats than at full files.

### Security and privacy

- Path validation prevents traversal and writes outside the workspace.
- Hashes prevent stale edits from clobbering user work.
- Excluded files are rejected before write.

### Operational

- Add repair/retry guidance when a patch is malformed.
- Test with concurrent edits and dirty worktrees.

## Follow-up

- Implement patch parsing and application in Phase 05.
- Add conflict tests in Phase 12.

## References

- [TOOL_SYSTEM.md](../architecture/TOOL_SYSTEM.md)
- [PHASE_05.md](../roadmap/PHASE_05.md)

# PHASE 12 — GIT INTEGRATION AND CHECKPOINTS

## Objective

Let SEEKER review changes safely, create checkpoints that preserve user work, and restore agent-created changes without destructive Git operations.

## Current Repository State

Phase 05 provides read-only `git.status` and `git.diff`. No checkpoints, commits, or restore exist.

## Dependencies

- Phase 05 (Git read tools).
- Phase 07 (session/action state).
- Phase 10 recommended.

## Scope

- Enhanced Git status/diff and change review.
- Checkpoint store for agent-created changes.
- Safe restore of agent changes.
- Conflict and dirty-worktree detection.
- Optional commit with explicit approval.
- No push, no force operations.
- Non-Git workspace support.

## Architecture Decisions

- Checkpoints record file hashes and original content for files the agent modifies, not the whole repository.
- Restoration is selective and never discards pre-existing user changes.
- Never use `git reset --hard` or `git clean -fdx` as rollback.
- Commits require explicit approval and a preview of staged changes.
- Push/deploy remain out of scope.
- Non-Git workspaces use the same checkpoint mechanism without Git metadata.

## Implementation Tasks

- [ ] Extend `src/tools/git.ts` with `git.history` (read-only) and `git.commit` (approval-gated).
- [ ] Create `src/core/checkpoints.ts` with create/list/restore.
- [ ] Capture original content for agent-modified files before writing.
- [ ] Detect dirty worktrees before applying patches and warn.
- [ ] Implement restore that reverts only agent-created changes and preserves user edits.
- [ ] Implement conflict detection when the user changed an agent-modified file.
- [ ] Add a change review panel showing per-file diffs.
- [ ] Add commit approval UI with staged file list and message.
- [ ] Record checkpoint metadata in the session.
- [ ] Add tests with temporary Git and non-Git workspaces.

## Files and Packages Affected

- `src/tools/git.ts`
- `src/core/checkpoints.ts`, `state.ts`
- `src/extension/chat-view.ts`, `webview/*`
- `test/integration/git/*.test.ts`

## API Contracts

```ts
export interface Checkpoint {
  id: string;
  sessionId: string;
  createdAt: string;
  reason: string;
  files: Array<{
    path: string;
    beforeSha256?: string;
    afterSha256?: string;
    originalContentRef?: string;
    agentCreated: boolean;
  }>;
  git?: { head?: string; dirtyFiles: string[] };
}

export interface RestoreResult {
  restored: string[];
  skipped: Array<{ path: string; reason: string }>;
}
```

## Data Structures

Checkpoints are stored under session storage; original content is stored as blobs with size limits.

## Security Considerations

- Never run destructive Git commands.
- Never overwrite user edits.
- Commit requires explicit approval and must not include unrelated staged changes silently.
- Do not push, tag, or publish.
- Redact secrets in diffs where possible; do not store excluded files.
- Detect and warn about `.env` files in staged changes.

## Error Handling

- Non-Git workspace: Git tools report `isRepository: false`; checkpoints still work.
- Merge conflicts: report and stop; do not resolve automatically.
- Restore conflict: skip the file and report.
- Detached HEAD or missing Git: degrade gracefully.
- Commit failure: return output and leave the working tree unchanged.

## Test Plan

- Integration: checkpoint and restore an agent-created file.
- Integration: restore does not overwrite a user edit made after the checkpoint.
- Integration: dirty worktree warning before patch.
- Integration: commit with approval includes only intended files.
- Unit: non-Git workspace handling.
- Unit: conflict detection by hash.

## Acceptance Criteria

- [ ] User can review all agent changes as diffs.
- [ ] Agent-created changes can be restored safely.
- [ ] Pre-existing user changes are never discarded.
- [ ] Commit is possible only with explicit approval.
- [ ] No destructive Git command is used.
- [ ] Non-Git workspaces are supported.

## Risks

- Restore logic can be dangerous if hashes are stale; require confirmation.
- Large files bloat checkpoint storage; cap and skip.
- Git behavior differs across versions/platforms.

## Definition of Done

- [ ] Acceptance criteria pass.
- [ ] Safety tests for restore and dirty worktrees pass.
- [ ] `SECURITY.md` and `SESSION_STATE.md` match implementation.
- [ ] No push/deploy functionality is added.

## Out of Scope

- Push, pull requests, tags, releases.
- Git LFS handling.
- Merge conflict resolution.
- Branch management UI.

## Completion Status

**Not started.**

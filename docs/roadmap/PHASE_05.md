# PHASE 05 — WORKSPACE TOOLS

## Objective

Give the agent safe, bounded, typed access to workspace files, search, diagnostics, and read-only Git.

## Current Repository State

No tool system, file access, search, diagnostics, or Git integration exists.

## Dependencies

- Phase 01 complete.

## Scope

- Tool contract and registry.
- Workspace path resolver with symlink and boundary protection.
- `filesystem.read`, `filesystem.list`.
- `search.text`, `search.files`.
- `filesystem.write` (new files / explicit replacement).
- `filesystem.apply_patch` with hash verification.
- `git.status`, `git.diff`.
- `diagnostics.get`.
- Result limits, timeouts, structured errors, audit logging.
- No terminal execution yet.

## Architecture Decisions

- Prefer patches over whole-file writes.
- Every path is canonicalized and checked against workspace roots.
- Schemas use JSON Schema 2020-12 with `additionalProperties: false`.
- Tools are pure infrastructure; they do not call models.
- The extension host implements workspace operations; the tool layer depends on an interface so it can be tested without VS Code.
- Use VS Code's diff preview for user-visible changes.
- Git is read-only in this phase.

## Implementation Tasks

- [ ] Create `src/tools/types.ts` with `Tool`, `ToolContext`, `ToolResult`, `ToolError`.
- [ ] Create `src/tools/registry.ts` with mode-aware filtering.
- [ ] Create `src/security/paths.ts` with `resolveWorkspacePath`.
- [ ] Create `src/tools/filesystem.ts`:
  - [ ] `filesystem.read` with ranges, byte cap, hash, encoding.
  - [ ] `filesystem.list` with depth and ignore rules.
  - [ ] `filesystem.write` with `expectedSha256` for existing files.
- [ ] Create `src/tools/patch.ts`:
  - [ ] Parse unified diffs.
  - [ ] Verify `expectedSha256`.
  - [ ] Apply hunks atomically; reject fuzzy matches.
  - [ ] Return new hash and hunk summary.
- [ ] Create `src/tools/search.ts`:
  - [ ] literal and regex text search
  - [ ] file glob search
  - [ ] ignore rules and result caps
  - [ ] prefer ripgrep when available
- [ ] Create `src/tools/git.ts`:
  - [ ] `git.status` porcelain parsing
  - [ ] `git.diff` with path filters and byte cap
  - [ ] detect non-Git workspaces
- [ ] Create `src/tools/diagnostics.ts` using `vscode.languages.getDiagnostics()`.
- [ ] Create `src/security/exclusions.ts` for default secret and build exclusions.
- [ ] Create an audit logger interface and a local implementation.
- [ ] Add diff preview integration for write/patch.
- [ ] Add tests for traversal, symlinks, binary files, size limits, patch conflicts, and search caps.

## Files and Packages Affected

- `src/tools/*`
- `src/security/paths.ts`, `exclusions.ts`
- `src/extension/workspace-host.ts`, `diagnostics.ts`
- `src/core/errors.ts`
- `test/unit/tools/*.test.ts`
- `test/integration/workspace/*.test.ts`

## API Contracts

```ts
export interface Tool<Input, Output> {
  id: string;
  description: string;
  permission: PermissionClass;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  timeoutMs: number;
  maxResultBytes: number;
  idempotent: boolean;
  execute(input: Input, ctx: ToolContext): Promise<ToolResult<Output>>;
}

export interface ApplyPatchInput {
  path: string;
  expectedSha256: string;
  patch: string;
  createIfMissing?: boolean;
}
```

## Data Structures

```ts
export interface FileReadResult {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  sha256: string;
  truncated: boolean;
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  snippet: string;
}

export interface GitStatusResult {
  isRepository: boolean;
  branch?: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}
```

## Security Considerations

- Reject paths outside workspace roots.
- Reject symlinks escaping roots.
- Exclude `.env*`, keys, credentials, and configured globs by default.
- Reject binary and oversized files.
- Never overwrite a file whose hash changed.
- Cap all results and mark truncation.
- Log argument hashes, not full sensitive content.
- Diff previews must show the actual patch.

## Error Handling

- `invalid_arguments`: schema failure.
- `unsafe_path`: traversal/symlink escape.
- `not_found`: missing file/path.
- `conflict`: hash mismatch.
- `too_large`: limits exceeded.
- `cancelled`: abort signal.
- Errors are returned to the model as observations; they must not crash the session.

## Test Plan

- Unit: path resolver rejects `../`, absolute escapes, and symlink escapes.
- Unit: secret exclusions are enforced for read/search/list.
- Unit: patch applies cleanly and rejects mismatched hashes.
- Unit: patch rejects fuzzy or malformed hunks.
- Unit: search caps results and respects ignores.
- Unit: binary file read is rejected.
- Unit: Git parsing handles non-repo, clean, and dirty states.
- Integration: diff preview matches applied content.

## Acceptance Criteria

- [ ] Read, list, and search work on a fixture workspace.
- [ ] Patch application is atomic and conflict-safe.
- [ ] Secret files cannot be read without explicit override.
- [ ] Traversal and symlink escapes are rejected.
- [ ] Results are bounded and truncation is explicit.
- [ ] Tools are testable without a live VS Code instance (host interfaces mocked).

## Risks

- Cross-platform path/case behavior.
- Unified diff edge cases (renames, binary, no newline at EOF).
- ripgrep availability varies.
- Diagnostics may be stale.

## Definition of Done

- [ ] Acceptance criteria pass.
- [ ] Security tests pass.
- [ ] TD-15 (path/permission foundation) is partially closed; full permission enforcement lands in Phase 07.
- [ ] `TOOL_SYSTEM.md` matches implementation.

## Out of Scope

- Terminal execution (Phase 06).
- Git commits/checkpoints (Phase 12).
- Symbol indexes and semantic retrieval (Phase 08).
- Browser tools.

## Completion Status

**Not started.**

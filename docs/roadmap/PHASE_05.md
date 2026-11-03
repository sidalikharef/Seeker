# PHASE 05 — WORKSPACE TOOLS

## Objective

Give the agent safe, bounded, typed access to workspace files, search, diagnostics, and read-only Git.

## Current Repository State

Implemented and locally validated. Typed, workspace-bounded tools now cover filesystem read/list/write/patch, text and file search, read-only Git status/diff, diagnostics, audit logging, permission checks, and diff preview. The tools are composed by `WorkspaceToolHost` and instantiated during extension activation in read-only Ask mode. Terminal execution remains Phase 06.

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

- [x] Create `src/tools/types.ts` with `Tool`, `ToolContext`, `ToolResult`, `ToolError`, permissions, audit, and preview contracts.
- [x] Create `src/tools/registry.ts` with mode-aware filtering.
- [x] Create `src/tools/schema.ts` for runtime argument validation and `src/tools/dispatcher.ts` for validation, permissions, timeouts, cancellation, and audit.
- [x] Create `src/security/paths.ts` with async `resolveWorkspacePath`, canonical roots, multi-root support, and symlink-escape rejection.
- [x] Create `src/tools/filesystem.ts`:
  - [x] `filesystem.read` with ranges, byte cap, hash, and binary rejection.
  - [x] `filesystem.list` with depth, `.seekerignore`, and ignore rules.
  - [x] `filesystem.write` with `expectedSha256` for existing files.
- [x] Create `src/tools/patch.ts`:
  - [x] Parse unified diffs.
  - [x] Verify `expectedSha256`.
  - [x] Apply hunks atomically; reject fuzzy matches.
  - [x] Return new hash and hunk summary.
- [x] Create `src/tools/search.ts`:
  - [x] literal and regex text search
  - [x] file glob search
  - [x] ignore rules and result caps
  - [x] bounded Node implementation (ripgrep optimization remains a Phase 18 performance option, not a correctness dependency)
- [x] Create `src/tools/git.ts`:
  - [x] `git.status` porcelain parsing
  - [x] `git.diff` with path filters and byte cap
  - [x] detect non-Git workspaces
- [x] Create `src/tools/diagnostics.ts` using a `DiagnosticsReader`, with `vscode.languages.getDiagnostics()` bridged in the extension host.
- [x] Create `src/security/exclusions.ts` for default secret and build exclusions.
- [x] Create an audit logger interface and in-memory/file implementations.
- [x] Add diff preview integration for write/patch.
- [x] Add tests for traversal, symlinks, binary files, size limits, patch conflicts, and search caps.

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

- [x] Unit: path resolver rejects `../`, absolute escapes, and symlink escapes.
- [x] Unit: secret exclusions are enforced for read/search/list.
- [x] Unit: patch applies cleanly and rejects mismatched hashes.
- [x] Unit: patch rejects fuzzy or malformed hunks.
- [x] Unit: search caps results and respects ignores.
- [x] Unit: binary file read is rejected.
- [x] Unit: Git parsing handles non-repo, clean, and dirty states.
- [x] Integration: diff preview matches applied content.

### Tests Executed

| Command | Result |
|---|---|
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test:unit` | Pass — 28 files, 186 tests |
| `pnpm test:integration` | Pass — 4 files, 6 tests |
| `pnpm format:check` | Pass |
| `pnpm build` | Pass |
| `pnpm test:extension` | Pass — VS Code 1.144.0 activated Seeker with 9 registered tools |
| `pnpm package` | Pass — see implementation status for current VSIX size |

## Acceptance Criteria

- [x] Read, list, and search work on a fixture workspace.
- [x] Patch application is atomic and conflict-safe.
- [x] Secret files cannot be read without explicit override.
- [x] Traversal and symlink escapes are rejected.
- [x] Results are bounded and truncation is explicit.
- [x] Tools are testable without a live VS Code instance (host interfaces mocked).

## Risks

- Cross-platform path/case behavior.
- Unified diff edge cases (renames, binary, no newline at EOF).
- ripgrep availability varies.
- Diagnostics may be stale.

## Definition of Done

- [x] Acceptance criteria pass.
- [x] Security tests pass.
- [x] TD-15 (path/permission foundation) is partially closed; full mode/UI approval enforcement lands in Phase 07.
- [x] `TOOL_SYSTEM.md` matches implementation.

## Out of Scope

- Terminal execution (Phase 06).
- Git commits/checkpoints (Phase 12).
- Symbol indexes and semantic retrieval (Phase 08).
- Browser tools.

## Deviations and Limitations

- Search uses a bounded Node implementation. Ripgrep is not required and is deferred as an optional performance optimization.
- Git is read-only and reports branch plus staged/unstaged/untracked paths; ahead/behind counts are not exposed yet.
- Diff preview uses VS Code's diff view and a modal confirmation; the approval path is covered at the host layer with an injected preview callback, while the actual VS Code diff-view UI remains unverified.
- The extension host defaults to read-only tools and denies privileged actions in untrusted workspaces. Full mode-specific approval UI belongs to Phase 07.
- `.seekerignore` controls discovery (list/search) rather than blocking explicit reads/writes.
- Diagnostics are filtered through the same secret/build exclusions, but VS Code diagnostics may be stale.
- No commit exists because no commit was requested.

## Completion Status

**IMPLEMENTED** — local acceptance passed on 2026-11-02. Extension activation and workspace tools are ready for Phase 06 terminal integration and Phase 07 approval UI/orchestration.

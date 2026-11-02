# TOOL SYSTEM

## 1. Objective

Provide a typed, permissioned, auditable interface between model output and privileged operations.

Every tool has a stable ID, a JSON Schema, a permission class, timeouts, output limits, and structured errors.

## 2. Tool Contract

```ts
export interface Tool<Input = unknown, Output = unknown> {
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

export interface ToolContext {
  sessionId: string;
  workspaceRoots: string[];
  signal: AbortSignal;
  logger: AuditLogger;
  permissions: PermissionManager;
}

export type ToolResult<T> =
  | { ok: true; data: T; truncated?: boolean; bytes?: number }
  | { ok: false; error: ToolError };

export interface ToolError {
  code:
    | 'invalid_arguments' | 'permission_denied' | 'not_found'
    | 'conflict' | 'timeout' | 'cancelled' | 'too_large'
    | 'unsafe_path' | 'command_failed' | 'internal';
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
}
```

## 3. Initial Tool Set (MVP)

| ID | Permission | Idempotent | Purpose |
|---|---|---|---|
| `filesystem.read` | read | yes | Read a file or range |
| `filesystem.list` | read | yes | List a directory |
| `filesystem.write` | write | no | Create/replace a file with conflict check |
| `filesystem.apply_patch` | write | no | Apply a validated unified diff |
| `search.text` | read | yes | Search file contents |
| `search.files` | read | yes | Search file names |
| `terminal.execute` | execute | no | Run an approved command |
| `git.status` | read | yes | Show working tree status |
| `git.diff` | read | yes | Show diff |
| `diagnostics.get` | read | yes | Get diagnostics for files |

Later: `git.commit`, `git.history`, `test.execute`, `test.results`, `symbols.*`, `web.search`, `browser.*`, `mcp.execute`.

## 4. Input/Output Schemas

Schemas are JSON Schema draft 2020-12, with `additionalProperties: false` where possible. Arguments from the model are parsed and validated before execution. Unknown fields are rejected.

Example:

```ts
const filesystemRead = {
  id: 'filesystem.read',
  permission: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      startLine: { type: 'integer', minimum: 1 },
      endLine: { type: 'integer', minimum: 1 },
      maxBytes: { type: 'integer', minimum: 1, maximum: 262144 }
    },
    required: ['path'],
    additionalProperties: false
  }
} as const;
```

## 5. Path Safety

All path-taking tools use a shared resolver:

```ts
resolveWorkspacePath(inputPath, roots, { mustExist, followSymlinks: true }): ResolvedPath
```

Rules:

- Resolve relative paths against the session's primary root.
- Canonicalize with `realpath` for existing files; resolve the parent for new files.
- Reject paths outside all roots.
- Reject symlinks escaping roots.
- Reject excluded secret paths for read and write unless explicitly overridden by the user.
- Normalize separators for cross-platform behavior.
- Store workspace-relative paths in results where possible.

## 6. Reading

- Return UTF-8 text with a detected encoding fallback.
- Reject binary files.
- Enforce `maxBytes`; return `truncated: true` with a clear marker.
- Include `sha256` and total line count so the model can reason about versions.
- Support line ranges; line numbers are 1-based and inclusive.
- Do not include excluded files.

## 7. Writing and Patching

Prefer patches over whole-file rewrites.

### 7.1 `filesystem.write`

Use only for new files or explicit full replacement. Requires:

- `path`
- `content`
- `expectedSha256?: string` (required for existing files)

If the file exists and the hash differs, return `conflict`. Never overwrite silently.

### 7.2 `filesystem.apply_patch`

```ts
export interface ApplyPatchInput {
  path: string;
  expectedSha256: string;
  patch: string;          // unified diff with file headers
  createIfMissing?: boolean;
}
```

Rules:

- Verify the current file hash equals `expectedSha256` before applying.
- Parse the patch; reject malformed hunks.
- Reject hunks that do not apply cleanly; do not fuzzy-match.
- Reject patches touching excluded paths.
- Apply atomically; write to a temp file, then rename.
- Return the new hash and a summary of hunks applied.
- If the file was modified by the user after the read, return `conflict` with both hashes.

### 7.3 Diff preview

The UI shows a VS Code diff or a rendered unified diff before applying, depending on mode and policy. Build mode may auto-apply within approved roots if the user enabled "auto-apply low-risk edits"; default is preview.

## 8. Search

- `search.text`: regex or literal, case options, glob include/exclude, max results.
- `search.files`: glob matching on paths.
- Use ripgrep if available, otherwise a bounded Node implementation.
- Never traverse `node_modules`, `.git`, build output, or excluded directories.
- Cap results (for example, 200 matches) and bytes.
- Return file path, line, column, and a short snippet.
- Respect `.seekerignore` and default secret exclusions.

## 9. Terminal Execution

```ts
export interface TerminalExecuteInput {
  file: string;              // executable
  args: string[];
  cwd?: string;
  timeoutMs?: number;        // default 120000, max 600000
  env?: Record<string, string>; // allowlisted keys only
}
```

Implementation requirements:

- `spawn(file, args, { shell: false, cwd, env })`.
- Validate `cwd` inside workspace roots.
- Strip provider keys and other secrets from the environment.
- Capture stdout/stderr with byte caps.
- Kill the process group on timeout or cancellation.
- Return exit code, signal, duration, and truncated output.
- Record the exact command in the audit log.
- Require permission before execution.
- Deny dangerous patterns even with approval (see [SECURITY.md](SECURITY.md)).
- Do not run interactive commands; detect TTY requirements and fail clearly.

## 10. Git Tools

MVP:

- `git.status`: parse porcelain output; report branch, ahead/behind, staged/unstaged/untracked.
- `git.diff`: support `--cached`, path filters, and stat mode; cap output.

Rules:

- Read-only in the MVP.
- Detect whether the workspace is a Git repository; do not assume.
- Never run `git reset --hard` or `git clean -fdx` as rollback.
- Commits, pushes, and branch changes require a separate, explicit phase and approval.

## 11. Diagnostics

- Use `vscode.languages.getDiagnostics()` in the extension host.
- Filter by path and severity.
- Return code, message, range, severity, and source.
- Do not claim a build passed based on diagnostics alone; diagnostics may be stale or partial.

## 12. Result Limits

| Limit | Default |
|---|---:|
| File read bytes | 256 KiB |
| Search matches | 200 |
| Terminal stdout | 256 KiB |
| Terminal stderr | 128 KiB |
| Git diff bytes | 512 KiB |
| Total tool result bytes per session | 4 MiB |
| Tool timeout | 120 s (terminal), 10 s (read/search) |

Truncation is explicit and never silent.

## 13. Audit Logging

Each execution records:

```ts
export interface AuditEntry {
  at: string;
  sessionId: string;
  toolId: string;
  argumentHash: string;
  permission: PermissionClass;
  decision: 'allow' | 'deny' | 'user_approved' | 'user_rejected';
  status: 'ok' | 'error' | 'cancelled';
  durationMs: number;
  resultBytes?: number;
  errorCode?: string;
}
```

Do not store full secret-bearing arguments. Store hashes and redacted summaries.

## 14. Error Semantics

- Errors are structured and returned to the model as tool observations.
- The agent must be able to recover from `invalid_arguments`, `conflict`, `not_found`, and `command_failed`.
- `permission_denied` and `cancelled` stop that action but not necessarily the session.
- `internal` is a bug; surface it and preserve state.

## 15. Extensibility

Adding a tool requires:

1. A stable ID and description.
2. JSON Schemas for input and output.
3. A permission class and idempotency flag.
4. Timeout and result limits.
5. Unit tests for validation, safety, and errors.
6. Registration in the mode-filtered registry.
7. Documentation in this file.

Do not add a tool that bypasses the dispatcher.

## 16. Acceptance Criteria

- [ ] Invalid arguments never reach execution.
- [ ] Path traversal and symlink escapes are rejected by tests.
- [ ] Patch application fails closed on hash mismatch.
- [ ] Terminal execution does not use a shell by default.
- [ ] Cancellation kills child processes.
- [ ] Output limits are enforced and marked when truncated.
- [ ] Every privileged action produces an audit entry.
- [ ] Tool results are structured and model-readable.

## 17. Related Documents

- [SECURITY.md](SECURITY.md)
- [AGENT_ENGINE.md](AGENT_ENGINE.md)
- [CONTEXT_ENGINE.md](CONTEXT_ENGINE.md)
- [ADR-0005](../decisions/ADR-0005-patch-based-editing.md)

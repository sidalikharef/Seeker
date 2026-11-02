# CONTEXT ENGINE

## 1. Objective

Give the model the smallest set of repository facts needed to act correctly, within the context window and token budget of a free-tier model.

Deterministic retrieval is the default. Semantic/embedding retrieval is deferred until measurements show a benefit.

## 2. Pipeline

```text
Workspace
  │
  ├─ scanner ──────> project profile (languages, frameworks, package managers)
  ├─ file index ───> paths, sizes, hashes, git status
  ├─ symbol index ─> definitions/references via language services where available
  ├─ diagnostics ──> errors/warnings for open and changed files
  └─ retrieval ────> candidate snippets
                        │
                        ▼
                   rank + dedupe
                        │
                        ▼
                   token budget
                        │
                        ▼
                 context package
```

## 3. Project Scanner

Detect and record:

| Signal | Files |
|---|---|
| Languages | extensions and file counts |
| Package manager | `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `go.mod` |
| Frameworks | `next.config.*`, `vite.config.*`, `angular.json`, `svelte.config.*`, `astro.config.*` |
| Monorepo | `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, `workspaces` in `package.json` |
| TypeScript | `tsconfig*.json`, project references |
| Tests | `vitest.config.*`, `jest.config.*`, `playwright.config.*`, `pytest.ini` |
| Database | `schema.prisma`, migrations, SQL config |
| CI | `.github/workflows/*`, `.gitlab-ci.yml` |
| Containers | `Dockerfile`, `docker-compose.yml` |
| Sensitive | `.env*`, key files, credential directories |

The scanner is read-only, bounded, and respects exclusions.

```ts
export interface ProjectProfile {
  roots: string[];
  languages: Array<{ id: string; fileCount: number }>;
  packageManagers: string[];
  frameworks: string[];
  monorepo?: { kind: 'pnpm' | 'npm' | 'yarn' | 'turbo' | 'nx' | 'unknown'; packages: string[] };
  typescript?: { configs: string[]; projectReferences: string[] };
  prisma?: { schemas: string[]; migrations: string[] };
  testRunners: string[];
  hasGit: boolean;
}
```

## 4. Monorepo Intelligence

- Read workspace globs from the package manager configuration.
- Build a package graph from `package.json` `dependencies` / `devDependencies` using workspace names.
- Identify the package that owns a changed file.
- When a change crosses packages, include dependent package manifests and public entry points.
- Do not scan `node_modules`, build output, or generated directories.

## 5. TypeScript Intelligence

- Parse `tsconfig` `baseUrl` and `paths` for import resolution.
- Read project references to find composite projects.
- Use VS Code's language APIs where available for definitions, references, and diagnostics.
- For non-open files, fall back to text search and import graph traversal.
- Never claim type correctness without diagnostics or a compiler run.

## 6. Prisma Intelligence

- Detect `schema.prisma`, datasource, generator, models, enums, and relations.
- Detect migration directories and their ordering.
- Include the schema when the task mentions data models.
- Treat migrations as high-risk: never run `prisma migrate` automatically; require explicit approval and warn about destructive changes.
- Do not assume the database is reachable or that migrations are safe.

## 7. Deterministic Retrieval

Priority order:

1. Files explicitly mentioned by the user (`@file`, path, symbol).
2. Files currently open and selected.
3. Files with diagnostics related to the task.
4. Recently edited files (git status / mtime).
5. Filename matches.
6. Text matches for task keywords and error messages.
7. Import/dependency neighbors of already selected files.
8. Symbol definitions/references.
9. Project profile files (`package.json`, `tsconfig`, framework config).

Retrieval result:

```ts
export interface ContextSnippet {
  path: string;
  range?: [number, number];
  content: string;
  sha256: string;
  reason: string;             // why it was included
  score: number;
  tokensEstimate: number;
}
```

## 8. Ranking and Deduplication

Score signals:

- Explicit user mention: highest.
- Diagnostic relevance: high.
- Import proximity: medium-high.
- Text match density: medium.
- Recency: medium.
- File centrality (imported by many files): low-medium.
- Path/config relevance: medium.

Deduplicate overlapping ranges. Merge adjacent snippets from the same file. Prefer complete function/class bodies over arbitrary line windows when possible.

## 9. Token Budgeting

```ts
export interface ContextBudget {
  modelContextWindow: number;
  reservedForOutput: number;
  reservedForSystem: number;
  reservedForTools: number;
  maxInputTokens: number;
}
```

Rules:

- Reserve output tokens explicitly; never fill the entire window with input.
- Reserve space for tool schemas.
- Allocate a fixed share to the task, plan, and recent observations.
- Fill remaining space with ranked snippets.
- If the task requires more context than fits, ask the user to narrow scope or use a model with a larger window.
- Truncate tool output before truncating the task or changed-file list.
- Record what was omitted so the agent can request more.

## 10. Exclusions

Default excludes:

- `node_modules`, `.git`, `dist`, `build`, `out`, `.next`, `.turbo`, `coverage`, `target`, `vendor`
- lockfiles unless explicitly requested
- binary files and large files (configurable threshold, e.g. 1 MiB)
- `.env*`, `*.pem`, `*.key`, `id_rsa*`, `.npmrc`, `.pypirc`, `.git-credentials`
- `.seekerignore` patterns
- `.gitignore` patterns for retrieval (with explicit user override)

Provide:

```jsonc
{
  "seeker.context.exclude": ["**/secrets/**", "**/*.sqlite"],
  "seeker.context.respectGitignore": true,
  "seeker.context.maxFileBytes": 1048576,
  "seeker.context.maxSnippets": 40
}
```

## 11. Repository Map

Maintain a compact map for planning:

```text
apps/web/            Next.js app
apps/api/            Express API
packages/db/         Prisma schema + client
packages/shared/     shared types
```

The map is generated from the scanner and refreshed on relevant file changes. It is cheap to include and helps the model navigate without reading everything.

## 12. Caching

- Cache file hashes and snippets per session.
- Invalidate on file change events or hash mismatch.
- Cache model discovery separately.
- Do not cache secrets or excluded content.
- Bound cache memory and clear on workspace change.

## 13. Embeddings (Deferred)

Embeddings may be considered only after:

1. Deterministic retrieval has measured success rates.
2. Token usage and latency are measured.
3. A local or free embedding source is available.
4. Privacy implications are documented.
5. A benchmark shows a meaningful improvement.

Until then, do not add a vector database.

## 14. Acceptance Criteria

- [ ] A task mentioning a symbol retrieves its definition and immediate references.
- [ ] Context stays within the configured token budget with output reserve intact.
- [ ] Excluded secrets never appear in a context package.
- [ ] Monorepo package relationships are reflected in retrieval.
- [ ] Omitting content is recorded and explainable.
- [ ] Context building does not require network access.

## 15. Related Documents

- [TOOL_SYSTEM.md](TOOL_SYSTEM.md)
- [AGENT_ENGINE.md](AGENT_ENGINE.md)
- [SECURITY.md](SECURITY.md)
- [ADR-0006](../decisions/ADR-0006-deterministic-search-first.md)

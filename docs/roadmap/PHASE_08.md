# PHASE 08 — CONTEXT INTELLIGENCE

## Objective

Improve task success per token by understanding project structure and retrieving only relevant context within free-tier limits.

## Current Repository State

Phase 07 has basic context assembly (open file, task, recent observations). No scanner, repo map, monorepo graph, or token budgeting beyond a simple cap.

## Dependencies

- Phase 05 complete (file/search tools).
- Phase 07 recommended for integration.

## Scope

- Repository scanner and project profile.
- Monorepo/package graph.
- TypeScript import/path intelligence.
- Prisma schema and migration awareness.
- Deterministic retrieval and ranking.
- Token budgeting and compaction hooks.
- Context caching and invalidation.
- Repository map for planning.
- No embeddings.

## Architecture Decisions

- Deterministic retrieval first: explicit mentions, open files, diagnostics, recency, filename, text, imports, symbols.
- Never scan `node_modules`, build output, or secrets.
- Use VS Code language APIs where available; fall back to text/import traversal.
- Treat Prisma migrations as high risk; never execute them.
- Context packages record provenance and omissions.
- Embeddings are deferred until measured benefit.

## Implementation Tasks

- [ ] Create `src/context/scanner.ts` producing `ProjectProfile`.
- [ ] Detect languages, package managers, frameworks, test runners, CI, containers, and databases.
- [ ] Create `src/context/monorepo.ts` for workspace globs and package dependency graph.
- [ ] Create `src/context/typescript.ts` for tsconfig paths and project references.
- [ ] Create `src/context/prisma.ts` for schema models and migration directories.
- [ ] Create `src/context/repo-map.ts` for a compact directory summary.
- [ ] Create `src/context/retrieval.ts` with deterministic candidates and scoring.
- [ ] Create `src/context/budget.ts` with output/system/tool reserves.
- [ ] Create `src/context/exclusions.ts` integration with `.seekerignore` and defaults.
- [ ] Implement snippet deduplication and range merging.
- [ ] Implement context package serialization with provenance.
- [ ] Integrate with the agent loop and emit a `context.built` event with counts and omissions.
- [ ] Add caching keyed by file hash and invalidate on change.
- [ ] Add tests on fixture repositories.

## Files and Packages Affected

- `src/context/*`
- `src/core/agent-loop.ts`
- `src/core/events.ts`
- `test/fixtures/context/*`
- `test/unit/context/*.test.ts`

## API Contracts

```ts
export interface ContextPackage {
  profile: ProjectProfile;
  snippets: ContextSnippet[];
  repoMap?: string;
  omitted: Array<{ reason: string; detail: string }>;
  estimatedInputTokens: number;
  budget: ContextBudget;
}

export interface ContextProvider {
  build(session: AgentSession, signal: AbortSignal): Promise<ContextPackage>;
}
```

## Data Structures

```ts
export interface ProjectProfile {
  roots: string[];
  languages: Array<{ id: string; fileCount: number }>;
  packageManagers: string[];
  frameworks: string[];
  monorepo?: { kind: string; packages: string[] };
  typescript?: { configs: string[]; projectReferences: string[] };
  prisma?: { schemas: string[]; migrations: string[] };
  testRunners: string[];
  hasGit: boolean;
}
```

## Security Considerations

- Never include excluded secrets.
- Respect `.gitignore` for retrieval; allow explicit user overrides.
- Cap file size and total context bytes.
- Do not execute Prisma or build tooling during scanning.
- Do not follow symlinks outside roots.
- Scanner must be read-only.

## Error Handling

- Missing or malformed config files are recorded, not fatal.
- Permission errors on individual files are skipped and reported.
- Context overflow returns a structured `context_overflow` with options to narrow scope or switch models.
- Cancellation stops scanning promptly.

## Test Plan

- Fixture: Next.js + Prisma + pnpm monorepo.
- Fixture: plain TypeScript package.
- Unit: tsconfig path resolution.
- Unit: monorepo graph edges.
- Unit: Prisma model extraction.
- Unit: retrieval ranks explicit mentions above incidental text matches.
- Unit: budget never exceeds input allocation and preserves output reserve.
- Unit: exclusions remove secret files.
- Integration: a symbol task retrieves the definition and references.

## Acceptance Criteria

- [ ] Project profile is accurate on fixtures.
- [ ] Context packages fit the configured budget.
- [ ] Explicitly mentioned files are always included when they fit.
- [ ] Excluded files never appear.
- [ ] Omissions are recorded with reasons.
- [ ] No network or embedding dependency is added.

## Risks

- Framework detection heuristics can misclassify.
- Large monorepos can be slow; bound traversal.
- Token estimators are approximate.
- Diagnostics can be stale.

## Definition of Done

- [ ] Acceptance criteria pass.
- [ ] Context engine tests run offline.
- [ ] `CONTEXT_ENGINE.md` matches implementation.
- [ ] Token usage is measurably reduced on fixture tasks versus Phase 07 baseline.

## Out of Scope

- Embeddings and vector databases.
- Semantic code search.
- Cross-repository context.
- Remote indexing services.

## Completion Status

**Not started.**

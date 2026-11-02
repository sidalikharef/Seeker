# ADR-0006 — Deterministic Search and Context Selection

## Status

Accepted

## Date

2026-11-01

## Context

Large repositories cannot fit in a model context. Retrieval must be predictable, inspectable, and cheap on free tiers. Embedding-based retrieval adds a dependency, indexing cost, privacy concerns, and non-determinism that is hard to test.

## Decision

Use deterministic, search-first context selection:

- Prefer explicit file reads and repository search (ripgrep-style) over embeddings.
- Rank by relevance signals: open file, selection, diagnostics, imports, recency, and path.
- Deduplicate snippets by content hash.
- Apply a token budget with explicit truncation and a visible list of included files.
- Use summaries and repo maps before raw file dumps.
- Do not add embeddings or a vector database without measured evidence that deterministic selection is insufficient.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Embeddings first | Indexing cost, privacy, non-determinism, dependency weight |
| Dump the repository | Exceeds context and quota |
| Model-driven file picking only | Unreliable and expensive |
| No ranking | Wastes context on irrelevant files |

## Consequences

### Positive

- Predictable and testable context.
- No index maintenance or extra service.
- Lower token use and fewer provider requests.
- Users can see why files were included.

### Negative

- May miss semantically related code that lacks lexical matches.
- Requires good search tooling and ranking heuristics.
- Repo maps must be maintained.

### Security and privacy

- Deterministic selection is easier to audit for excluded files and secrets.
- No third-party embedding service receives code.

### Operational

- Provide `context.explain` to show inclusion reasons.
- Revisit embeddings only with benchmark evidence.

## Follow-up

- Implement ranking and budgeting in Phase 04.
- Add a repo map in Phase 09 if planning requires it.

## References

- [CONTEXT_ENGINE.md](../architecture/CONTEXT_ENGINE.md)
- [PHASE_04.md](../roadmap/PHASE_04.md)

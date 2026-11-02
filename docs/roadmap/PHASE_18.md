# PHASE 18 — PERFORMANCE OPTIMIZATION

## Objective

Reduce latency, token consumption, memory use, and provider requests without weakening reliability or safety.

## Current Repository State

Performance is unmeasured. The MVP focuses on correctness.

## Dependencies

- Phases 07–13 implemented.
- Baseline metrics available from Phase 13.

## Scope

- Profiling of context building, routing, streaming, and tool execution.
- Context and prompt optimization.
- Caching.
- UI rendering performance.
- Memory limits.
- Provider request reduction.
- No behavior changes that break verification.

## Architecture Decisions

- Optimize only measured bottlenecks.
- Preserve safety and correctness over speed.
- Prefer deterministic caching keyed by content hashes.
- Keep provider requests minimal; batch reads where safe.
- Do not trade verification evidence for speed.
- Document before/after metrics.

## Implementation Tasks

- [ ] Add timing instrumentation to context, routing, provider, and tool stages.
- [ ] Record baseline metrics on fixture tasks.
- [ ] Optimize context selection and deduplication.
- [ ] Implement snippet and repo-map caching.
- [ ] Reduce redundant model calls (avoid re-planning when unnecessary).
- [ ] Batch read-only tool calls where the model requests them together.
- [ ] Optimize streaming UI batching.
- [ ] Bound memory for sessions, blobs, and caches.
- [ ] Add a performance regression test for key paths.
- [ ] Document results.

## Files and Packages Affected

- `src/context/*`, `src/router/*`, `src/providers/*`, `src/core/*`
- `src/extension/webview/*`
- `test/performance/*`
- `docs/evaluations/*`

## API Contracts

No public API changes expected. Internal timing events may be added:

```ts
type TimingEvent = {
  type: 'timing';
  stage: 'context' | 'routing' | 'provider' | 'tool' | 'render';
  durationMs: number;
  detail?: string;
};
```

## Data Structures

```ts
export interface PerformanceBaseline {
  taskId: string;
  provider: string;
  model: string;
  contextMs: number;
  routingMs: number;
  firstTokenMs: number;
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  memoryPeakMb?: number;
  recordedAt: string;
}
```

## Security Considerations

- Caches must not store secrets or excluded content.
- Timing logs must not include prompts.
- Do not disable permission checks for speed.
- Do not reduce output caps in a way that hides errors.

## Error Handling

- Optimization failures fall back to the correct slow path.
- Cache corruption is detected by hash and discarded.
- Timeouts remain enforced.

## Test Plan

- Performance: context build under a fixture size threshold.
- Performance: first-token latency on a mock stream.
- Regression: token usage does not exceed the baseline without justification.
- Correctness: all Phase 13 evaluations still pass.

## Acceptance Criteria

- [ ] Baselines exist for representative tasks.
- [ ] Measured improvements are documented.
- [ ] No correctness or security regression.
- [ ] Memory stays within configured bounds.
- [ ] Token usage is reduced or justified.

## Risks

- Premature optimization.
- Cache staleness.
- Benchmark variance.
- Overfitting to fixtures.

## Definition of Done

- [ ] Baselines and after-metrics recorded.
- [ ] Regression tests pass.
- [ ] No P0 regressions.
- [ ] Optimizations are reversible and documented.

## Out of Scope

- Rewriting in another language.
- Distributed execution.
- Model quantization.
- Provider-side optimizations outside SEEKER's control.

## Completion Status

**Not started.**

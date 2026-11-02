# PHASE 13 — AGENT EVALUATION AND HARDENING

## Objective

Replace anecdotal success with measurable reliability, security, and recovery evidence.

## Current Repository State

Unit and integration tests exist for implemented features, but there is no agent benchmark suite, fixture corpus, metrics dashboard, or fuzz/security harness.

## Dependencies

- Phase 07 (agent loop).
- Phase 10 (coding/debugging workflows).

## Scope

- Evaluation harness and fixture repositories.
- Metrics collection.
- Security and robustness tests.
- Regression gates.
- Provider comparison.
- Failure taxonomy.
- No new product features.

## Architecture Decisions

- Evaluations run with mock providers for determinism and with real free providers for realism, tracked separately.
- Fixtures are small, versioned, and have objective acceptance checks.
- Metrics are stored locally and compared against thresholds.
- A task is successful only if verification passes.
- Do not use a single demo as evidence.

## Implementation Tasks

- [ ] Create `tests/agent-evals/` harness and runner.
- [ ] Define fixture repositories:
  - [ ] TypeScript type error
  - [ ] broken import
  - [ ] add REST endpoint
  - [ ] refactor component
  - [ ] Prisma schema edit (no migration execution)
  - [ ] failing test to pass
  - [ ] cross-package update
  - [ ] build failure diagnosis
  - [ ] permission-denied scenario
  - [ ] quota-pause scenario
- [ ] Implement metrics: success rate, tests passed, model requests, tokens, tool failures, runtime, unauthorized actions, recovery rate.
- [ ] Add mock-provider baselines.
- [ ] Add optional real-provider runs with explicit key consent.
- [ ] Add security fuzz tests for tool arguments and webview messages.
- [ ] Add chaos tests for network interruption, 429, 5xx, and cancellation.
- [ ] Add regression comparison against a stored baseline.
- [ ] Document results in `docs/evaluations/`.
- [ ] Add CI job for deterministic suites.

## Files and Packages Affected

- `tests/agent-evals/**`
- `test/fixtures/**`
- `docs/evaluations/**`
- CI workflow
- Metrics storage module

## API Contracts

```ts
export interface EvalTask {
  id: string;
  fixture: string;
  prompt: string;
  mode: AgentMode;
  acceptance: AcceptanceCriterion[];
  budget: TaskBudget;
  tags: string[];
}

export interface EvalResult {
  taskId: string;
  provider: string;
  model: string;
  success: boolean;
  verified: boolean;
  metrics: {
    modelRequests: number;
    inputTokens: number;
    outputTokens: number;
    toolCalls: number;
    toolFailures: number;
    runtimeMs: number;
    unauthorizedActions: number;
    recoveryAttempts: number;
    recovered: boolean;
  };
  failureCategory?: string;
}
```

## Data Structures

Baselines are stored as JSON with a schema version, provider/model, date, and per-task results.

## Security Considerations

- Evaluation fixtures must not contain real secrets.
- Real-provider runs must not upload fixture content without consent.
- Unauthorized-action metrics must fail the run if any occur.
- Fuzz tests must not execute dangerous commands for real; use mocks.

## Error Handling

- A failed task is recorded, not hidden.
- Provider errors are classified and counted.
- The harness continues after individual task failures.
- Results are reproducible with a seed and fixture commit.

## Test Plan

- Deterministic mock suite in CI.
- Security fuzz suite in CI.
- Optional nightly real-provider smoke suite.
- Regression comparison fails on threshold drops.
- Recovery tests simulate quota, timeout, and cancellation.

## Acceptance Criteria

- [ ] At least 10 fixtures exist with objective acceptance checks.
- [ ] Mock suite is deterministic and runs in CI.
- [ ] Metrics are recorded per task.
- [ ] Security tests cover traversal, injection, redaction, and CSP.
- [ ] Unauthorized actions fail the run.
- [ ] Results are documented with dates and provider/model.

## Risks

- Fixtures can overfit to the agent's implementation.
- Real-provider runs consume free quota.
- Metrics can be gamed by trivial tasks.
- Model behavior changes over time.

## Definition of Done

- [ ] Acceptance criteria pass.
- [ ] Baselines are recorded.
- [ ] Quality gates are enforced in CI.
- [ ] TD-19 is closed.
- [ ] `AGENT_BENCHMARKS.md` and `QUALITY_GATES.md` match the harness.

## Out of Scope

- Public leaderboards.
- Paid-provider comparisons.
- Human preference studies.
- Multi-agent evaluation.

## Completion Status

**Not started.**

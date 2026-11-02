# PHASE 17 — MULTI-AGENT ARCHITECTURE

## Objective

Explore specialized agents (planning, coding, testing, review) only if benchmarks demonstrate a clear benefit over the single-agent loop.

## Current Repository State

No multi-agent execution exists. The single-agent loop is the intended MVP architecture.

## Dependencies

- Phase 09 (planning).
- Phase 10 (coding/debugging).
- Phase 13 (evaluation).

## Scope

- Research and prototype only.
- Specialized roles as separate prompts/contexts, not necessarily separate processes.
- Sequential composition first.
- Strict token/cost budgets.
- Benchmark gate before adoption.
- No parallel execution without evidence.

## Architecture Decisions

- Do not adopt multi-agent by default.
- Prefer sequential specialization (planner → coder → verifier) over parallel agents.
- Each role gets a filtered tool set and context.
- Shared state is explicit and persisted.
- A benchmark must show improved success rate per token/cost.
- If no benefit is measured, keep the single loop and document the result.

## Implementation Tasks

- [ ] Define a benchmark comparing single-agent vs sequential specialist roles.
- [ ] Prototype a planner role with read-only tools.
- [ ] Prototype a verifier role that inspects changes and evidence.
- [ ] Implement role handoff with explicit state.
- [ ] Enforce per-role budgets and permissions.
- [ ] Measure success, token use, latency, and failure modes.
- [ ] Write an ADR with the decision and evidence.
- [ ] Only proceed to parallel agents if sequential specialization shows a clear win.

## Files and Packages Affected

- `src/core/agents/*` (experimental)
- `src/core/agent-loop.ts`
- `tests/agent-evals/*`
- ADR

## API Contracts

```ts
export interface AgentRole {
  id: 'planner' | 'coder' | 'verifier' | 'reviewer';
  tools: string[];
  systemPrompt: string;
  budget: TaskBudget;
}

export interface RoleHandoff {
  from: AgentRole['id'];
  to: AgentRole['id'];
  state: AgentSession;
  reason: string;
}
```

## Data Structures

Reuse `AgentSession` with an optional `role` field and role-specific checkpoints.

## Security Considerations

- Roles cannot escalate permissions.
- Each role's tool set is filtered in code.
- Handoffs cannot bypass approvals.
- A verifier must not be able to write.
- Shared state must not leak secrets across roles.

## Error Handling

- Handoff failure preserves state.
- Role budget exhaustion stops or escalates explicitly.
- A verifier disagreement is surfaced, not hidden.
- Parallel execution requires conflict handling for writes; avoid until proven.

## Test Plan

- Benchmark: same tasks, single agent vs sequential roles.
- Metrics: success, tokens, requests, latency, tool failures.
- Regression: no decrease in safety or verification integrity.
- Security: role permission boundaries.

## Acceptance Criteria

- [ ] Benchmark results are recorded with dates and models.
- [ ] Sequential specialization is implemented only if it improves the primary metric.
- [ ] No role can escalate permissions.
- [ ] Single-agent remains the default unless evidence supports otherwise.
- [ ] An ADR records the outcome, including negative results.

## Risks

- Increased token usage reduces free-tier viability.
- Coordination complexity and duplicated context.
- Harder debugging.
- Benchmark overfitting.

## Definition of Done

- [ ] Benchmark complete.
- [ ] ADR written.
- [ ] Decision implemented or explicitly rejected.
- [ ] No parallel execution without evidence.

## Out of Scope

- Parallel agents with concurrent writes.
- Autonomous agent swarms.
- Cross-user collaboration.

## Completion Status

**Not started.**

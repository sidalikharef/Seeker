# PHASE 09 — PLANNING SYSTEM

## Objective

Produce structured, verifiable implementation plans and track execution against them without allowing planning to modify the workspace.

## Current Repository State

The agent loop exists but plans are implicit in conversation. There is no plan schema, step tracking, or plan-mode enforcement beyond tool filtering.

## Dependencies

- Phase 07 (agent loop).
- Phase 08 (context intelligence).

## Scope

- Plan schema and validation.
- Plan mode with read-only enforcement.
- Step tracking and status.
- Acceptance criteria derivation.
- Plan presentation and approval.
- Plan-to-execution handoff.
- Replanning after failures.
- No autonomous execution in Plan mode.

## Architecture Decisions

- Plans are structured data, not free-form prose only.
- Every step has a status and a verification hint.
- Plan mode cannot call write/execute tools; enforced by the registry and permissions.
- A plan may be approved before Build mode begins.
- Replanning is explicit and recorded.
- Plans are persisted with the session.

## Implementation Tasks

- [ ] Create `src/core/plan.ts` with `Plan`, `PlanStep`, and schema validation.
- [ ] Add plan generation prompt/tool contract for models.
- [ ] Implement Plan mode tool filtering and permission denial.
- [ ] Derive acceptance criteria from the plan and task.
- [ ] Render the plan in the webview with step statuses.
- [ ] Add approve/edit/reject plan actions.
- [ ] Implement step status transitions and event emission.
- [ ] Implement plan revision when verification fails.
- [ ] Persist plans in the session record.
- [ ] Add tests for plan validation, mode enforcement, and step transitions.

## Files and Packages Affected

- `src/core/plan.ts`, `agent-loop.ts`, `verification.ts`
- `src/extension/chat-view.ts`, `webview/*`
- `test/unit/core/plan.test.ts`
- `test/integration/agent/plan-mode.test.ts`

## API Contracts

```ts
export interface Plan {
  id: string;
  objective: string;
  assumptions: string[];
  steps: PlanStep[];
  risks: string[];
  verification: AcceptanceCriterion[];
  createdAt: string;
  revision: number;
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  files: string[];
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
  verificationHint?: string;
}
```

## Data Structures

Plans are stored in `AgentSession.plan` and emitted as `plan.updated` events.

## Security Considerations

- Plan mode must not write, execute, install, or commit.
- Plans may contain untrusted file content; render as text.
- Approval of a plan does not grant blanket permissions for individual actions.
- Do not let a plan override system policy.

## Error Handling

- Invalid plan JSON returns a validation error to the model with a repair request.
- A step that fails verification is marked `failed`; the loop may replan.
- Plans referencing excluded or missing files are flagged.
- Cancellation preserves the plan and statuses.

## Test Plan

- Unit: plan schema rejects missing steps/verification.
- Unit: Plan mode denies write/execute tools.
- Integration: plan generation, approval, execution, and step status updates.
- Integration: failed verification triggers a bounded replan.
- UI: plan renders with accessible status indicators.

## Acceptance Criteria

- [ ] Plan mode produces a validated plan and modifies nothing.
- [ ] A user can approve a plan before Build mode.
- [ ] Steps update status as work proceeds.
- [ ] Verification criteria are derived and shown.
- [ ] Replanning is bounded and recorded.
- [ ] Plans are persisted and visible after reload.

## Risks

- Models may produce overly granular or vague plans.
- Plan approval can create false confidence; keep verification evidence visible.
- Replanning loops; bound revisions (for example, 3).

## Definition of Done

- [ ] Acceptance criteria pass.
- [ ] Plan mode enforcement is tested.
- [ ] `AGENT_ENGINE.md` mode table matches implementation.
- [ ] Plans are included in evaluation fixtures.

## Out of Scope

- Multi-agent planning.
- Automatic plan execution without approval.
- Time estimates or deadlines.

## Completion Status

**Not started.**

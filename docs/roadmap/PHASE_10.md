# PHASE 10 — CODING AND DEBUGGING WORKFLOWS

## Objective

Move from single-file edits to reliable multi-file changes with diagnostics, tests, and a bounded repair loop.

## Current Repository State

Phase 07 supports basic read/patch/command actions. There is no test execution tool, structured test result parsing, multi-file patch planning, or repair strategy.

## Dependencies

- Phase 07 (agent loop).
- Phase 08 (context).
- Phase 09 (planning).

## Scope

- Multi-file change sets.
- Diagnostics-driven repair.
- `test.execute` and `test.results`.
- Build/type-check loop.
- Debug mode workflow.
- Failure analysis and targeted fixes.
- Final change report.
- Minimal MVP slice: one validation command + diagnostics (already in Phase 07); this phase generalizes it.

## Architecture Decisions

- A change set is applied atomically when possible; otherwise each patch is individually verified.
- Test execution uses the same terminal safety model.
- Parse only well-known test runners initially (Vitest, Jest, pytest) with a generic fallback.
- Limit repair attempts (for example, 5) and require evidence for success.
- Do not install dependencies automatically.
- Do not run migrations or destructive database commands.

## Implementation Tasks

- [ ] Create `src/tools/test.ts` for `test.execute` and `test.results`.
- [ ] Create `src/core/changeset.ts` for multi-file patch coordination.
- [ ] Implement diagnostics refresh after edits.
- [ ] Implement a build/type-check loop with error extraction.
- [ ] Implement test result parsers for Vitest, Jest, and pytest.
- [ ] Implement a bounded repair strategy: read error, locate file, patch, re-run.
- [ ] Implement Debug mode prompts and tool filtering.
- [ ] Generate a final report: changed files, commands, results, unresolved errors.
- [ ] Integrate with verification criteria.
- [ ] Add fixtures with deliberate type errors and failing tests.
- [ ] Add integration tests for repair success and bounded failure.

## Files and Packages Affected

- `src/tools/test.ts`
- `src/core/changeset.ts`, `verification.ts`, `agent-loop.ts`
- `src/context/diagnostics.ts`
- `test/fixtures/tasks/*`
- `test/integration/workflows/*.test.ts`

## API Contracts

```ts
export interface TestExecuteInput {
  runner: 'vitest' | 'jest' | 'pytest' | 'custom';
  command: { file: string; args: string[] };
  cwd?: string;
  timeoutMs?: number;
}

export interface TestResult {
  runner: string;
  passed: number;
  failed: number;
  skipped: number;
  failures: Array<{
    name: string;
    file?: string;
    line?: number;
    message: string;
  }>;
  exitCode: number;
  rawOutputRef?: string;
}
```

## Data Structures

```ts
export interface ChangeSet {
  id: string;
  patches: Array<{ path: string; expectedSha256: string; patch: string }>;
  status: 'proposed' | 'applied' | 'partially_applied' | 'rejected' | 'conflict';
  appliedPaths: string[];
}
```

## Security Considerations

- Test commands require approval like any terminal command.
- Never auto-install missing test dependencies.
- Never run database migrations or seed commands automatically.
- Cap output and parse defensively.
- Do not execute test code from untrusted repositories without approval; tests are code.

## Error Handling

- Build/test failure is an observation, not a crash.
- Parser failure falls back to raw output with a clear note.
- Repair attempts are bounded; then stop with unresolved errors.
- Partial change-set application is reported and never claimed as complete.
- Cancellation leaves a consistent state and report.

## Test Plan

- Fixture: TypeScript type error; agent fixes and verifies.
- Fixture: failing unit test; agent fixes and verifies.
- Fixture: broken import.
- Fixture: multi-file refactor across a workspace package boundary.
- Fixture: unfixable error; agent stops with a clear report.
- Unit: test parsers for each supported runner.
- Unit: change-set conflict handling.

## Acceptance Criteria

- [ ] Agent can fix a type error and prove it with a passing type check.
- [ ] Agent can fix a failing test and prove it with a passing test run.
- [ ] Multi-file changes are conflict-checked.
- [ ] Repair attempts are bounded.
- [ ] Final report lists changes, commands, evidence, and unresolved issues.
- [ ] No success is claimed without evidence.

## Risks

- Test output formats vary by version.
- Large test suites consume quota; support targeted test selection.
- Repair loops can thrash; bound and summarize.
- Tests may have side effects; require approval.

## Definition of Done

- [ ] Acceptance criteria pass on fixtures.
- [ ] Evaluation tasks added to the benchmark suite.
- [ ] `QUALITY_GATES.md` thresholds are measurable.
- [ ] No P0 debt in the coding workflow.

## Out of Scope

- Automatic dependency installation.
- Database migrations.
- Browser/E2E tests (Phase 15).
- Performance profiling.

## Completion Status

**Not started.**

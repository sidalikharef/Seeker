# SEEKER — Phase Index

This file is an index only. The authoritative roadmap is in [`docs/roadmap/MASTER_PLAN.md`](docs/roadmap/MASTER_PLAN.md), with one document per phase under [`docs/roadmap/`](docs/roadmap/).

The previous DeepSeek-specific seven-phase draft has been superseded. It described commands under the `deepcode.*` namespace and a single-provider design that no longer match the project direction.

## Milestones

| Milestone           | Phases | Outcome                                                   |
| ------------------- | ------ | --------------------------------------------------------- |
| M0 — Foundation     | 00–03  | Buildable extension, provider abstraction, routing, quota |
| M1 — Safe agent     | 04–07  | Chat UI, workspace tools, terminal, agent loop            |
| M2 — Intelligence   | 08–11  | Context, planning, coding/debugging, continuation         |
| M3 — Hardening      | 12–13  | Git safety, evaluations                                   |
| M4 — Optional reach | 14–17  | Local models, browser, MCP, multi-agent research          |
| M5 — Release        | 18–19  | Performance, packaging                                    |
| Future              | 20     | Deferred expansion                                        |

## Phases

| Phase | Document                                                      | Status      |
| ----- | ------------------------------------------------------------- | ----------- |
| 00    | [Repository Audit](docs/roadmap/PHASE_00.md)                  | VERIFIED    |
| 01    | [Project Foundation](docs/roadmap/PHASE_01.md)                | IMPLEMENTED |
| 02    | [Free Cloud Model Infrastructure](docs/roadmap/PHASE_02.md)   | IMPLEMENTED |
| 03    | [Model Router and Quota Primitives](docs/roadmap/PHASE_03.md) | IMPLEMENTED |
| 04    | [VS Code Chat UI](docs/roadmap/PHASE_04.md)                   | NOT STARTED |
| 05    | [Workspace Tools](docs/roadmap/PHASE_05.md)                   | NOT STARTED |
| 06    | [Terminal Integration](docs/roadmap/PHASE_06.md)              | NOT STARTED |
| 07    | [Autonomous Agent Loop](docs/roadmap/PHASE_07.md)             | NOT STARTED |
| 08    | [Context Intelligence](docs/roadmap/PHASE_08.md)              | NOT STARTED |
| 09    | [Planning System](docs/roadmap/PHASE_09.md)                   | NOT STARTED |
| 10    | [Coding and Debugging Workflows](docs/roadmap/PHASE_10.md)    | NOT STARTED |
| 11    | [Quota-Aware Continuation](docs/roadmap/PHASE_11.md)          | NOT STARTED |
| 12    | [Git Integration and Checkpoints](docs/roadmap/PHASE_12.md)   | NOT STARTED |
| 13    | [Agent Evaluation and Hardening](docs/roadmap/PHASE_13.md)    | NOT STARTED |
| 14    | [Optional Local Models](docs/roadmap/PHASE_14.md)             | NOT STARTED |
| 15    | [Browser Automation](docs/roadmap/PHASE_15.md)                | NOT STARTED |
| 16    | [MCP Integration](docs/roadmap/PHASE_16.md)                   | NOT STARTED |
| 17    | [Multi-Agent Architecture](docs/roadmap/PHASE_17.md)          | NOT STARTED |
| 18    | [Performance Optimization](docs/roadmap/PHASE_18.md)          | NOT STARTED |
| 19    | [Release Engineering](docs/roadmap/PHASE_19.md)               | NOT STARTED |
| 20    | [Future Expansion](docs/roadmap/PHASE_20.md)                  | DEFERRED    |

## Supporting Documents

- [Current state audit](docs/audit/CURRENT_STATE.md)
- [Architecture overview](docs/architecture/OVERVIEW.md)
- [Provider matrix](docs/providers/PROVIDER_MATRIX.md)
- [Free-tier policy](docs/providers/FREE_TIER_POLICY.md)
- [MVP scope](docs/roadmap/MVP_SCOPE.md)
- [Dependency graph](docs/roadmap/DEPENDENCY_GRAPH.md)
- [Test strategy](docs/evaluations/TEST_STRATEGY.md)
- [Quality gates](docs/evaluations/QUALITY_GATES.md)
- [Architecture decisions](docs/decisions/README.md)

## Status Legend

- **NOT STARTED** — specified, not implemented.
- **IN PROGRESS** — implementation started.
- **BLOCKED** — cannot proceed without an external decision or dependency.
- **IMPLEMENTED** — code exists and local checks pass; phase acceptance is not fully verified.
- **VERIFIED** — acceptance criteria and definition of done have been met with evidence.
- **DEFERRED** — intentionally postponed.

No phase is complete until its acceptance criteria are verified and its documentation matches the implementation.

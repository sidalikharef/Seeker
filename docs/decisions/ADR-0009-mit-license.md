# ADR-0009 — MIT License

## Status

Accepted

## Date

2026-11-01

## Context

SEEKER is intended to be open source and easy for individual developers, students, and maintainers to adopt and contribute to. The repository had no license, which makes redistribution and contribution legally ambiguous. The project has no dependency on copyleft-licensed code at this stage.

## Decision

License SEEKER under the MIT License, with the copyright holder recorded as "Seeker contributors". Keep the license text in the repository root as `LICENSE` and declare `"license": "MIT"` in `package.json`.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Apache-2.0 | Stronger patent grant, but more process overhead than needed for this stage |
| GPL-3.0 | Copyleft limits adoption by some integrators |
| No license | Blocks legitimate reuse and contribution |
| Unlicense/CC0 | Weakens attribution and warranty clarity |

## Consequences

### Positive

- Simple, permissive, and widely understood.
- Compatible with VS Code extension distribution.
- Encourages contribution and reuse.

### Negative

- No explicit patent grant.
- Others may redistribute modified versions without contributing back.

### Security and privacy

- The license does not affect runtime security controls.
- Third-party notice obligations still need review when dependencies are added.

### Operational

- Keep the copyright line updated when ownership changes.
- Perform a dependency-license audit in release engineering.

## Follow-up

- Add third-party notices when runtime dependencies are introduced.
- Revisit licensing only with contributor agreement.

## References

- [PHASE_01.md](../roadmap/PHASE_01.md)
- [TECHNICAL_DEBT.md](../audit/TECHNICAL_DEBT.md)

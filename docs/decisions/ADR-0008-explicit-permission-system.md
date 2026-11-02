# ADR-0008 — Explicit, Code-Enforced Permission System

## Status

Accepted

## Date

2026-11-01

## Context

An autonomous agent that reads files, writes code, and runs commands is a security boundary. Prompt instructions and UI warnings are not enforcement. A malicious file, web page, or tool result can attempt to induce dangerous actions. VS Code workspace trust is necessary but not sufficient.

## Decision

Enforce permissions in code, before tool execution:

- Every tool declares a permission class: `read`, `write`, `execute`, `network`, or `sensitive`.
- The dispatcher checks workspace containment, exclusions, approval state, and mode before running a tool.
- Read-only mode allows only read tools.
- Build mode may write inside the workspace and run approved commands.
- Sensitive actions (installing dependencies, network access, destructive commands, credential access) require explicit approval.
- Deny by default for unknown tools and unknown paths.
- Approval is scoped to a specific action, not a blanket "always allow" for dangerous operations.
- Log denials and approvals for audit.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Rely on the model's instructions | Prompt injection defeats it |
| Rely only on VS Code workspace trust | Too coarse; does not cover per-command or per-path decisions |
| Allow everything in Build mode | Unacceptable risk |
| Ask for approval on every action | Unusable UX |

## Consequences

### Positive

- Security does not depend on model behavior.
- Clear, testable rules.
- Denials are visible and auditable.
- Consistent across providers and tools.

### Negative

- More prompts for legitimate actions.
- Classification of shell commands is imperfect.
- Users may click through approvals; UI must make risk clear.

### Security and privacy

- This is the primary control for prompt injection, path traversal, and command abuse.
- Never log secrets; log decisions and redacted arguments.
- Sensitive actions require fresh approval.

### Operational

- Add tests for every permission branch.
- Review new tools for correct classification.
- Keep the command classifier conservative and document its limits.

## Follow-up

- Implement in Phase 06.
- Fuzz the classifier in Phase 13.
- Link from the threat model.

## References

- [SECURITY.md](../architecture/SECURITY.md)
- [TOOL_SYSTEM.md](../architecture/TOOL_SYSTEM.md)
- [PHASE_06.md](../roadmap/PHASE_06.md)

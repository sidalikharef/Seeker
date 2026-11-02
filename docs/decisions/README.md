# Architecture Decision Records

ADRs capture decisions that are costly to reverse. Each record states the context, the decision, alternatives considered, and consequences. Superseded ADRs are kept and linked.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](./ADR-0001-typescript-vscode-extension.md) | TypeScript VS Code extension as the first host | Accepted |
| [0002](./ADR-0002-provider-agnostic-adapters.md) | Provider-agnostic adapters over provider SDKs | Accepted |
| [0003](./ADR-0003-free-tier-first-routing.md) | Free-tier-first routing with explicit consent | Accepted |
| [0004](./ADR-0004-agent-core-separate-from-extension.md) | Agent core separate from the extension host | Accepted |
| [0005](./ADR-0005-patch-based-editing.md) | Patch-based editing with conflict detection | Accepted |
| [0006](./ADR-0006-deterministic-search-first.md) | Deterministic search and context selection | Accepted |
| [0007](./ADR-0007-local-first-session-persistence.md) | Local-first session persistence | Accepted |
| [0008](./ADR-0008-explicit-permission-system.md) | Explicit, code-enforced permission system | Accepted |
| [0009](./ADR-0009-mit-license.md) | MIT license | Accepted |

## Creating an ADR

1. Copy [ADR_TEMPLATE.md](./ADR_TEMPLATE.md).
2. Use the next four-digit number.
3. Use a short kebab-case title.
4. Fill in context, decision, alternatives, and consequences.
5. Update this index.
6. Link the ADR from the relevant architecture or phase document.

## Status Values

- `Proposed`
- `Accepted`
- `Superseded by ADR-XXXX`
- `Deprecated`
- `Rejected`

## Rules

- Record the decision, not the entire design.
- Include negative consequences.
- Do not rewrite accepted ADRs to hide history; supersede them.
- A decision that affects security must include a threat consideration.

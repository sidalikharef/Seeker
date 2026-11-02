# PHASE 16 — MCP INTEGRATION

## Objective

Support Model Context Protocol tools and resources with explicit trust boundaries and the same permission model as built-in tools.

## Current Repository State

No MCP client exists. The MVP does not require it.

## Dependencies

- Phase 07 (tool dispatcher/permissions).
- Phase 13 (security hardening).

## Scope

- MCP client for local and remote servers.
- Tool/resource discovery.
- Mapping MCP tools into the SEEKER tool registry.
- Trust levels and per-server permissions.
- Timeouts, cancellation, and result limits.
- No automatic installation or execution of untrusted servers.

## Architecture Decisions

- MCP is an optional integration, not a core dependency.
- Each server has an explicit trust level: `untrusted`, `read-only`, `trusted`.
- MCP tools inherit a permission class; unknown tools default to the most restrictive class.
- Remote MCP servers require explicit user configuration and consent.
- Do not let MCP tool descriptions override system policy.
- Prefer the official MCP SDK if its license and dependency footprint are acceptable; otherwise implement the minimal client.

## Implementation Tasks

- [ ] Evaluate the official MCP TypeScript SDK; record an ADR.
- [ ] Create `src/mcp/client.ts` with connect/list/call/cancel.
- [ ] Create `src/mcp/registry.ts` mapping MCP tools to `Tool`.
- [ ] Implement trust levels and per-server allowlists.
- [ ] Implement schema translation and validation.
- [ ] Implement timeouts, cancellation, and result caps.
- [ ] Add configuration for local servers and remote endpoints.
- [ ] Add a permission prompt for first use of each tool.
- [ ] Add audit logging.
- [ ] Add tests with a mock MCP server.
- [ ] Document trust boundaries.

## Files and Packages Affected

- `src/mcp/*`
- `src/tools/registry.ts`
- `package.json` configuration
- `test/integration/mcp/*`
- ADR

## API Contracts

```ts
export interface McpServerConfig {
  id: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  trust: 'untrusted' | 'read-only' | 'trusted';
}

export interface McpToolMapping {
  serverId: string;
  toolName: string;
  seekerToolId: string;      // mcp.<server>.<tool>
  permission: PermissionClass;
}
```

## Data Structures

MCP tool inputs/outputs are validated against translated JSON Schemas. Results are capped and stored as blobs when large.

## Security Considerations

- Untrusted servers cannot request write/execute permissions without approval.
- Remote servers receive only the data needed for the call.
- Never expose provider API keys or workspace secrets to MCP servers.
- Treat MCP descriptions and results as untrusted.
- Sandbox stdio servers where possible.
- Block automatic server installation.
- Audit every MCP call.

## Error Handling

- Connection failure: clear setup error.
- Tool not found: structured error.
- Timeout/cancel: terminate the request.
- Schema mismatch: reject before execution.
- Server crash: mark unavailable and continue.

## Test Plan

- Integration: mock stdio server tool discovery and call.
- Integration: permission denial for untrusted write tool.
- Security: secret not forwarded.
- Unit: schema translation and validation.
- Cancellation: request terminated.

## Acceptance Criteria

- [ ] User can configure a local MCP server.
- [ ] Tools are discovered and mapped with permission classes.
- [ ] Untrusted tools require approval.
- [ ] Secrets are not forwarded.
- [ ] Calls are audited and cancellable.
- [ ] No server is installed automatically.

## Risks

- MCP ecosystem security is immature.
- Transport and schema variations.
- Trust UI complexity.
- Dependency footprint.

## Definition of Done

- [ ] Acceptance criteria pass.
- [ ] ADR records SDK/transport decisions.
- [ ] Security tests pass.
- [ ] MCP remains optional.

## Out of Scope

- MCP server authoring.
- Marketplace of servers.
- Automatic trust.
- Remote OAuth flows beyond basic configuration.

## Completion Status

**Not started.**

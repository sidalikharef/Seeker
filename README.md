# SEEKER

SEEKER is an open-source, free-cloud-first AI coding agent for Visual Studio Code.

Phases 02–07 establish the free-cloud provider layer, deterministic model router, secure sidebar chat, workspace-bounded tooling, a guarded terminal executor, and a bounded autonomous agent loop. The extension can store API keys securely, discover models, stream chat completions, normalize provider errors, test connections, select models by free-tier policy and capability, track quota/health state, inspect/edit workspace files, and run approved argv-based commands with environment filtering, output caps, timeouts, and process-tree cancellation. Build and Debug modes run a bounded tool loop with exact-command approval, verification evidence, cancellation, and quota pausing. Live-provider and actual rendered-UI acceptance runs remain unverified; automated extension-host tests use mocked webview interactions and injected approval callbacks, and no screen sharing or OS screen capture is required.

## Direction

- **Free cloud AI first.** Use genuinely free hosted model tiers where available.
- **Local AI second.** Local models are optional, never required.
- **Paid AI optional.** No automatic fallback to a paid provider.
- **Provider independent.** No core logic depends on a single vendor.
- **Safe by default.** Permissions are enforced in code; changes are reviewable.
- **Honest results.** Completed work requires verification evidence or an explicit "unverified" label.

SEEKER does not claim unlimited free inference. Free tiers have rate limits, quotas, and data policies that vary by provider.

## Implemented Today

- Activates as a VS Code extension.
- Stores OpenRouter and Groq API keys in VS Code SecretStorage.
- Discovers models from OpenRouter and Groq and caches results for six hours.
- Streams OpenAI-compatible chat completions with tool-call deltas, usage, and cancellation.
- Runs a bounded Ask/Plan/Review/Build/Debug agent loop with per-mode tool permissions.
- Normalizes auth, quota, rate-limit, timeout, network, and protocol errors.
- Tests provider connections and reports free-tier status when available.
- Maintains a model registry with tri-state capabilities, discovery merging, overrides, and conflict reporting.
- Routes across six policies: `manual`, `free-first`, `fast`, `coding`, `reasoning`, and `automatic`.
- Rejects paid or unknown-tier models by default; paid selection requires `allowPaid`, a non-zero cost cap, and known pricing within the cap.
- Tracks request/token quota, rate limits, retry backoff, daily exhaustion, authentication failures, and provider health.
- Emits explainable `model.selected`, `model.fallback`, and `quota.warning` events.
- Opens a secure SEEKER sidebar with real streaming chat, cancellation, retry, model selection, availability reasons, and routing controls.
- Persists chat messages and model selection in workspace state without persisting credentials.
- Enforces a nonce-based webview CSP, no webview network access, validated messages, and text-only model output.
- Provides typed, permissioned tools for file read/list/write, unified patches with SHA-256 conflict checks, text/file search, diagnostics, read-only Git status/diff, and argv-based terminal execution without a shell.
- Rejects path traversal, symlink escapes, binary files, oversized results, secret paths, and untrusted-workspace privileged actions.
- Records tool argument hashes and outcomes in an audit log without storing raw arguments; terminal audit details store a redacted command and output hash, not raw output.
- Uses VS Code diff previews before file writes/patches and keeps Ask/Plan/Review read-only.
- Requires modal approval for terminal commands, with run-once or exact-command session-scoped approval bound to the executable, arguments, cwd, and workspace.
- Persists agent sessions and append-only events, labels unverified completion, and does not replay completed side effects after failures.
- Exposes Ask, Plan, Review, Build, and Debug modes in the sidebar.
- Registers `seeker.setApiKey`, `seeker.clearApiKey`, `seeker.refreshModels`, `seeker.testConnection`, and `seeker.debug.showSelection`.
- Declares provider enable/disable and routing settings.
- Builds reproducibly with pnpm and strict TypeScript.
- Has unit tests, mock-server integration tests, command-manifest parity tests, linting, formatting, and CI.
- Packages as a VSIX with only runtime files.

The published extension identity is not configured yet. `package.json` keeps `your-publisher-id` as an explicit placeholder so a real publisher is not invented.

## Routing Defaults

```jsonc
{
  "seeker.routing.policy": "free-first",
  "seeker.routing.allowPaid": false,
  "seeker.routing.maxCostUsdPerTask": 0,
  "seeker.routing.preferredProvider": "",
  "seeker.routing.preferredModel": "",
  "seeker.routing.excludedProviders": [],
}
```

Run **Seeker: Debug: Show Model Selection** to print the selected model, every registered model's eligibility reason, and registry conflicts. The command uses cached discovery and does not spend provider quota.

## Requirements

- VS Code `^1.90.0`
- Node.js 24 for development
- pnpm `12.15.0`

## Development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Run the extension in the Extension Development Host:

```bash
pnpm build
```

Then press `F5` in VS Code. The `Run Seeker Extension` launch configuration builds first and opens a host window.

Run the extension-host smoke test:

```bash
pnpm test:extension
```

This downloads a VS Code test build on first run, activates Seeker, and executes `seeker.hello`.

Package the extension:

```bash
pnpm package
```

The VSIX is written to `seeker-<version>.vsix`. Marketplace publication is not configured and requires a real publisher identity.

## Scripts

| Script                  | Purpose                                      |
| ----------------------- | -------------------------------------------- |
| `pnpm build`            | Compile TypeScript to `out/`                 |
| `pnpm watch`            | Compile in watch mode                        |
| `pnpm typecheck`        | Type-check source and tests without emitting |
| `pnpm lint`             | Run ESLint                                   |
| `pnpm format`           | Format with Prettier                         |
| `pnpm format:check`     | Verify formatting                            |
| `pnpm test`             | Run unit and integration tests               |
| `pnpm test:unit`        | Run unit tests                               |
| `pnpm test:integration` | Run local mock-server integration tests      |
| `pnpm test:extension`   | Build and run the extension-host smoke test  |
| `pnpm package`          | Build and create a VSIX                      |

## Documentation

- [Implementation status](docs/roadmap/IMPLEMENTATION_STATUS.md)
- [Current state audit](docs/audit/CURRENT_STATE.md)
- [Architecture overview](docs/architecture/OVERVIEW.md)
- [Master plan](docs/roadmap/MASTER_PLAN.md)
- [MVP scope](docs/roadmap/MVP_SCOPE.md)
- [Provider matrix](docs/providers/PROVIDER_MATRIX.md)
- [Free-tier policy](docs/providers/FREE_TIER_POLICY.md)
- [Test strategy](docs/evaluations/TEST_STRATEGY.md)
- [Quality gates](docs/evaluations/QUALITY_GATES.md)
- [Architecture decisions](docs/decisions/README.md)

## License

MIT. See [LICENSE](LICENSE).

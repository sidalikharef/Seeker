# SEEKER

SEEKER is an open-source, free-cloud-first AI coding agent for Visual Studio Code.

Phases 02–03 establish the free-cloud provider layer and deterministic model router. The extension can store API keys securely, discover models, stream chat completions, normalize provider errors, test connections, select models by free-tier policy and capability, and track quota/health state. No chat UI, tool execution, or autonomous agent loop is implemented yet, and the extension does not claim those features.

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
- Normalizes auth, quota, rate-limit, timeout, network, and protocol errors.
- Tests provider connections and reports free-tier status when available.
- Maintains a model registry with tri-state capabilities, discovery merging, overrides, and conflict reporting.
- Routes across six policies: `manual`, `free-first`, `fast`, `coding`, `reasoning`, and `automatic`.
- Rejects paid or unknown-tier models by default; paid selection requires `allowPaid`, a non-zero cost cap, and known pricing within the cap.
- Tracks request/token quota, rate limits, retry backoff, daily exhaustion, authentication failures, and provider health.
- Emits explainable `model.selected`, `model.fallback`, and `quota.warning` events.
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

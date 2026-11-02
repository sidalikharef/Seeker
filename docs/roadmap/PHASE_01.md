# PHASE 01 — PROJECT FOUNDATION

## Objective

Turn the scaffold into a reproducible, testable, linted VS Code extension foundation with a single product identity.

## Current Repository State

- One source file and one declared command.
- Manifest/source command mismatch.
- No tests, lint, CI, launch configuration, or packaging metadata.
- `pnpm-lock.yaml` untracked while scripts call `npm`.
- `@types/vscode` lockfile version is newer than the declared engine.

## Dependencies

- Phase 00 complete.

## Scope

- Fix the command identity and registration parity.
- Choose pnpm as the package manager and commit the lockfile.
- Add build, watch, lint, format, type-check, and test scripts.
- Add a minimal test framework.
- Add `.vscode/launch.json` and `tasks.json`.
- Add CI for type-check, lint, and tests.
- Add packaging metadata and `.vscodeignore`.
- Align `@types/vscode` with `engines.vscode`.
- Add a minimal configuration schema for future use.

## Architecture Decisions

- Product identity: display name `Seeker`, command prefix `seeker.`, configuration prefix `seeker.`, secret prefix `seeker.`.
- Package manager: pnpm. Commit `pnpm-lock.yaml`; remove npm assumptions from scripts.
- Test runner: Vitest for unit/integration tests; `@vscode/test-electron` for extension tests.
- Lint: ESLint flat config with `@typescript-eslint`; Prettier for formatting.
- Keep CommonJS output and `tsc` for the MVP; do not add a bundler yet.
- Keep a single package. Do not introduce a monorepo.
- Do not add runtime dependencies in this phase.

## Implementation Tasks

- [x] Rename the extension package to lowercase `seeker` and set a real `publisher` placeholder documented as such.
- [x] Standardize the hello command as `seeker.hello` in both manifest and source.
- [x] Add `activationEvents` only where required; rely on command contributions otherwise.
- [x] Add `repository`, `license`, `icon`, `categories`, and `keywords` metadata. Use `.vscodeignore` as the packaging strategy because `vsce` rejects combining `files` with it.
- [x] Add `.vscodeignore` excluding `src/`, tests, docs, and build caches.
- [x] Add `pnpm-lock.yaml` and the approved native-build policy to the working tree. Commit is pending an explicit commit request.
- [x] Add scripts: `build`, `watch`, `typecheck`, `lint`, `format`, `test`, `test:unit`, `test:extension`, `package`.
- [x] Set `vscode:prepublish` to `pnpm build`.
- [x] Pin `@types/vscode` to a version compatible with `engines.vscode` (or raise the engine intentionally).
- [x] Add ESLint flat config and Prettier config.
- [x] Add Vitest config and one smoke test for a pure helper.
- [x] Add `.vscode/launch.json` with an Extension Development Host configuration.
- [x] Add `.vscode/tasks.json` for the build/watch tasks.
- [x] Add `.github/workflows/ci.yml` running install, typecheck, lint, and tests.
- [x] Add a `seeker.enabled` boolean configuration setting (unused for now) to prove configuration wiring.
- [x] Add a command-parity test that reads `package.json` contributions and asserts each command is registered.
- [x] Add `LICENSE` (choose an OSI-approved license; record the choice in an ADR).
- [x] Document the developer workflow in `README.md` (only implemented behavior).

## Files and Packages Affected

- `package.json`, `pnpm-lock.yaml`, `tsconfig.json`
- `src/extension.ts`
- `.vscode/launch.json`, `.vscode/tasks.json`
- `.github/workflows/ci.yml`
- `.eslintrc` equivalent flat config, `.prettierrc`
- `vitest.config.mts`
- `test/unit/*.test.ts`, `test/extension/runTest.js`, `test/extension/suite/index.js`
- `.vscodeignore`, `LICENSE`, `README.md`

## API Contracts

```ts
export const COMMANDS = {
  hello: 'seeker.hello',
} as const;

export const CONFIG_SECTION = 'seeker';
```

All future command IDs must be declared in one constant and referenced by both the manifest generator/test and the registration code.

## Data Structures

None beyond the command/config constants.

## Security Considerations

- Do not add secrets in this phase.
- Ensure CI does not print environment secrets.
- `.vscodeignore` must not exclude required runtime files.
- Do not enable telemetry.

## Error Handling

- Activation must catch registration errors and log to an output channel.
- Unknown command invocations must fail with a clear message.

## Test Plan

- Unit: command constant parity with `package.json`.
- Unit: configuration default reads correctly.
- Extension smoke test: extension activates and `seeker.hello` executes without throwing.
- CI runs typecheck, lint, and tests from a clean install.

## Acceptance Criteria

- [x] `pnpm install --frozen-lockfile` succeeds from a fresh clone.
- [x] `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass.
- [x] `pnpm build` produces `out/extension.js`.
- [x] The F5 launch configuration exists, and the automated extension-host test activates the extension successfully.
- [x] `seeker.hello` is registered and executable in the extension host (verified by automated test).
- [x] Command parity test fails if a contributed command is not registered.
- [x] No runtime dependency is added.

## Risks

- Test tooling adds maintenance cost; keep it minimal.
- VS Code type/engine mismatch can hide API incompatibilities.
- Renaming the extension changes storage keys; acceptable because no users exist yet.

## Definition of Done

- [x] Local acceptance criteria pass; remote CI verification is pending.
- [ ] Close TD-01, TD-02, TD-04, TD-05, TD-06, TD-07, TD-08, TD-09, and TD-11 locally. TD-03 remains open because the publisher identity is a documented placeholder.
- [ ] CI is green on the default branch (workflow added; not yet run remotely).
- [x] README describes only implemented behavior.

## Out of Scope

- Provider integration.
- Webview UI.
- Agent logic.
- Bundling with esbuild.
- Marketplace publication.

## Completion Status

**IMPLEMENTED.** Local build, type-check, lint, unit tests, VSIX packaging, and extension-host activation passed. Remote CI and publisher configuration remain pending.

# First-Build Manual Testing Guide

Status: **Experimental local build; automated quality gates passed; Phase 06/07 live-provider and manual UI acceptance unverified.**

This guide describes the first real-world manual test for the local experimental Seeker build.

The local experimental VSIX is:

`/home/sid/projects/personal/Seeker/seeker-0.0.1.vsix`

The source workspace is:

`/home/sid/projects/personal/Seeker`

The minimal TypeScript acceptance fixture is:

`/tmp/seeker-final-acceptance`

## Automated validation status

The following commands passed during the current experimental-build validation:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
pnpm build
pnpm test:extension
pnpm package
```

The extension-host test passed with VS Code `1.144.1`.

The Phase 06 and Phase 07 automated test suites passed.

The manual VS Code UI acceptance and live-provider acceptance remain **UNVERIFIED**.

The Phase 08 repository-context work remains **NOT STARTED**.

## Fedora installation steps

1. Install or update Visual Studio Code on Fedora.
2. Start VS Code.
3. Open the Extensions view.
4. Select **Install from VSIX**.
5. Choose:

```text
/home/sid/projects/personal/Seeker/seeker-0.0.1.vsix
```

6. Restart VS Code.
7. Confirm the Seeker view and commands are available.

Alternatively, use the VS Code CLI:

```bash
code --install-extension /home/sid/projects/personal/Seeker/seeker-0.0.1.vsix --force
```

After installation, restart VS Code before testing.

## Free provider configuration

1. Open Seeker provider settings.
2. Configure an eligible free OpenRouter or Groq provider.
3. Do not use paid inference by default.
4. Select a model that supports tool calling.
5. If no provider is configured, stop the live-provider acceptance test and leave it unverified.

No API keys should be printed or committed.

## Mode testing

## Ask mode

1. Send a read-only question through Seeker.
2. Verify the response streams.
3. Confirm the mode does not expose write or terminal execution.

## Plan mode

1. Send a planning or read-only analysis request.
2. Verify the response streams.
3. Confirm the mode remains read-only and does not expose write or terminal execution.

## Build mode

1. Select **Build**.
2. Send a safe coding task against the minimal TypeScript fixture.
3. Verify Seeker reads the relevant source.
4. Approve any required file modification.
5. Approve the required compiler command.
6. Collect the real compiler exit code and tool result.

## Debug mode

1. Select **Debug**.
2. Send a corresponding debugging or repair task.
3. Verify read, write, and execute permissions are handled according to the mode policy.
4. Use approvals only when needed.

## Review mode

1. Select **Review**.
2. Send a read-only review or analysis request.
3. Verify no write or terminal execution occurs.

## Permission behavior

For the Build-mode TypeScript repair task:

1. Before modifying the file, request approval through Seeker’s permission system.
2. After applying the fix, request approval to execute:

```bash
pnpm exec tsc --project /tmp/seeker-final-acceptance/tsconfig.json
```

3. Use Seeker’s built-in tools for both operations.
4. Verify approval choices:
   - **Run once**: the approved command executes once and does not add a session allowlist rule.
   - **Allow for session**: the same exact command may run without prompting again; a different argument list should prompt.
   - **Deny**: the command is denied and does not execute.

5. For file modification, verify the diff preview and authorization flow.
6. Do not mark Phase 07 verified based on manual edits performed by OpenCode.

## TypeScript repair acceptance task

Use `/tmp/seeker-final-acceptance`.

The deliberate error is:

```ts
export function value(): string {
  return 42;
}
```

Expected compiler error:

```text
TS2322: Type 'number' is not assignable to type 'string'.
```

Expected correction:

```ts
export function value(): string {
  return "42";
}
```

Required workflow:

1. Put Seeker in **Build** mode.
2. Ask Seeker to fix the TypeScript error and run the type-check command.
3. Confirm Seeker locates the error.
4. Confirm Seeker reads the relevant source.
5. Approve the file modification.
6. Approve the compiler command.
7. Collect the actual compiler exit code.
8. Confirm the fix removes the TypeScript error.
9. Report the actual result.

## Troubleshooting

- Extension fails to activate: check VS Code output and extension logs, then reinstall the local VSIX.
- No provider configured: stop the live-provider task and leave Phase 07 live acceptance unverified.
- Selected model lacks tool calling: stop the task and choose a compatible free model.
- Permission denied: stop the task; no unapproved modification or command should have occurred.
- Compiler still reports an error: do not mark the repair verified; inspect the new actual error.
- Manual UI unavailable: leave Phase 06/07 manual UI acceptance unverified.

## Status after manual testing

Mark Phase 06 and Phase 07 verified only after:

- Real user-driven approval workflow is exercised.
- Live provider tool-calling task succeeds or fails for a documented reason.
- Actual compiler result is collected.
- Phase 07 completion evidence is accurate.

Until then:

- Phase 06 manual UI acceptance: **UNVERIFIED**.
- Phase 07 live-provider acceptance: **UNVERIFIED**.
- Phase 07 manual rendered UI acceptance: **UNVERIFIED**.

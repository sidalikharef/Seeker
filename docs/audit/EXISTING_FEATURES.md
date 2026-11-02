# EXISTING FEATURES — EVIDENCE-BASED INVENTORY

This document records only capabilities that can be located in the repository. Planned features are not listed as existing.

## Summary

| Category | Implemented | Partial | Absent |
|---|---:|---:|---:|
| Extension lifecycle | 1 | 0 | 0 |
| Commands | 0 | 1 | 0 |
| AI inference | 0 | 0 | 1 |
| UI | 0 | 0 | 1 |
| Agent | 0 | 0 | 1 |
| Tools | 0 | 0 | 1 |
| Security | 0 | 0 | 1 |
| Tests | 0 | 0 | 1 |
| Packaging | 0 | 0 | 1 |

## Feature Detail

### F-001 — Extension activation

- Status: **Implemented**
- Evidence: `src/extension.ts:3`
- Behavior: exports `activate(context)`, receives `vscode.ExtensionContext`, and registers a disposable.
- Limitations: no activation telemetry, no error boundary, no logging, no configuration read.

### F-002 — Hello command

- Status: **Partial / broken**
- Evidence:
  - Declared: `package.json:16-19` (`Seeker.hello`)
  - Registered: `src/extension.ts:4` (`deepcode.hello`)
- Behavior if invoked by its registered ID: shows `DeepCode is alive.`
- Limitations: the declared command ID is different, so Command Palette invocation fails. The user-facing string also uses the obsolete `DeepCode` name.

### F-003 — Deactivation hook

- Status: **Implemented (no-op)**
- Evidence: `src/extension.ts:11`
- Behavior: empty function.
- Limitations: no resource cleanup because no resources are held.

### F-004 — Strict TypeScript compilation

- Status: **Implemented**
- Evidence: `tsconfig.json:9`, verified `tsc` exit 0.
- Limitations: no linting, formatting, or test type-checking.

### F-005 — Git repository hygiene

- Status: **Partial**
- Evidence: `.gitignore` ignores build output and secrets.
- Limitations: `pnpm-lock.yaml` is untracked, so installs are not reproducible across clones. No `.vscodeignore`.

## Explicitly Absent Capabilities

The following are absent and must not be described as existing:

- Any AI model API call.
- Any provider abstraction or adapter.
- API key storage.
- Chat or webview UI.
- Streaming responses.
- Inline edit or diff preview.
- Code actions or context-menu integration.
- Workspace file reading, searching, writing, or patching.
- Terminal execution.
- Agent loop, planning, or verification.
- Model discovery, routing, quotas, or fallback.
- Git integration or checkpoints.
- Diagnostics integration.
- Session history or persistence.
- Tests, linting, CI, or release automation.
- Local model support.

## Claims in Existing Documentation That Are Not Implemented

| Claim | Source | Reality |
|---|---|---|
| Chat sidebar with full file context | `README.md:9` | No webview exists |
| Inline edit with diff preview | `README.md:10` | No command or diff flow |
| Fix / Explain / Refactor actions | `README.md:11` | No code actions |
| Streaming responses | `README.md:15` | No HTTP client |
| SecretStorage key handling | `README.md:13` | No secret code |
| Configurable endpoint | `README.md:14` | No configuration schema |
| F5 Hello World works | `PHASES.md:15` | No `.vscode/launch.json`; command mismatch |
| DeepSeek connection | `PHASES.md:19-28` | No client dependency or source |

## Verification Boundary

No runtime extension-host test was executed. The assessment is based on source inspection plus a successful TypeScript compile. A claim that the extension "works in VS Code" would require launching an Extension Development Host and invoking the command; that has not been done.

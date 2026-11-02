# PHASE 19 — RELEASE ENGINEERING

## Objective

Produce a reproducible, documented, installable release with accurate metadata and CI artifacts.

## Current Repository State

No packaging, changelog, release workflow, icon, license, or Marketplace configuration exists.

## Dependencies

- Phase 13 (quality gates).
- Phase 12 recommended (Git safety).
- Phase 18 recommended (performance).

## Scope

- Extension packaging with `vsce`.
- `.vscodeignore` validation.
- Versioning and changelog.
- CI release workflow and artifacts.
- Marketplace metadata and documentation.
- License and third-party notices.
- Installation and troubleshooting docs.
- No Marketplace publication without explicit owner action.

## Architecture Decisions

- Use `vsce package` for a VSIX; publishing is a separate, explicit step.
- Semantic versioning.
- Keep the extension name lowercase `seeker`.
- Include only runtime files in the VSIX.
- Pin CI actions and avoid secrets in logs.
- Generate a changelog from conventional commits or maintain it manually.
- Record provider verification dates in release notes.

## Implementation Tasks

- [ ] Add `vsce` as a dev dependency.
- [ ] Add `package` and `publish` scripts (publish requires manual invocation).
- [ ] Validate `.vscodeignore` contents.
- [ ] Add an icon and Marketplace metadata.
- [ ] Add `LICENSE` and third-party notices.
- [ ] Add `CHANGELOG.md`.
- [ ] Add a GitHub Actions release workflow producing a VSIX artifact.
- [ ] Add installation and troubleshooting documentation.
- [ ] Add a release checklist including provider re-verification.
- [ ] Verify the VSIX installs in a clean VS Code profile.
- [ ] Document supported VS Code versions and platform limits.

## Files and Packages Affected

- `package.json`
- `.vscodeignore`
- `.github/workflows/release.yml`
- `README.md`, `CHANGELOG.md`, `LICENSE`, `docs/`
- `media/icon.png`

## API Contracts

No runtime API changes. The release artifact must expose the same commands and settings as the tested build.

## Data Structures

A release manifest records version, commit, provider verification date, and test results.

## Security Considerations

- Do not publish from a machine with uncommitted secrets.
- Do not include `.env`, test fixtures with secrets, or source maps if they expose internals unnecessarily.
- Verify no API keys in the VSIX.
- Use least-privilege CI tokens.
- Sign or checksum artifacts where possible.

## Error Handling

- Packaging failure blocks release.
- Missing metadata blocks release.
- Provider verification missing blocks a "free-tier supported" claim.
- Installation failure in a clean profile blocks release.

## Test Plan

- Package the VSIX in CI.
- Install the VSIX in a clean VS Code profile.
- Run a smoke test: activate, set key, list models, send a message.
- Verify the VSIX contents against an allowlist.
- Run the full test suite on the release commit.

## Acceptance Criteria

- [ ] VSIX builds reproducibly.
- [ ] Clean-profile installation works.
- [ ] No secrets or unnecessary files in the VSIX.
- [ ] README, changelog, license, and icon are present.
- [ ] Release notes state verified provider facts and limitations.
- [ ] CI produces a downloadable artifact.

## Risks

- Marketplace policy changes.
- VS Code engine/API drift.
- Provider changes invalidate claims.
- Packaging includes unintended files.

## Definition of Done

- [ ] Acceptance criteria pass.
- [ ] Release checklist completed.
- [ ] TD-20 is closed.
- [ ] Artifact is installable and smoke-tested.

## Out of Scope

- Automatic Marketplace publication.
- Auto-update infrastructure.
- Paid distribution.
- Multi-platform native binaries.

## Completion Status

**Not started.**

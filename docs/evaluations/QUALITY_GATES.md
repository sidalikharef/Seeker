# Quality Gates

## Purpose

Define the minimum evidence required to merge a change or ship a release. Gates are enforced in CI where possible and documented manually where not.

## Gate 0 — Repository Hygiene

- [ ] No secrets committed.
- [ ] `pnpm-lock.yaml` committed.
- [ ] Command IDs in `package.json` match registered commands.
- [ ] No placeholder publisher/name in a release build.
- [ ] License and third-party notices present for a release.

## Gate 1 — Build

- [ ] `pnpm install --frozen-lockfile` succeeds.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm build` succeeds.

## Gate 2 — Unit and Integration Tests

- [ ] Unit tests pass.
- [ ] Extension-host integration tests pass.
- [ ] Provider mock tests pass.
- [ ] No new skipped tests without a linked issue.

## Gate 3 — Security

- [ ] Path traversal tests pass.
- [ ] Command-classification tests pass.
- [ ] Secret-redaction tests pass.
- [ ] Webview CSP/message-validation tests pass.
- [ ] No unauthorized action in agent evaluations.
- [ ] New tools have a documented permission class.
- [ ] New network endpoints are documented and justified.

## Gate 4 — Agent Evaluations

- [ ] Mock evaluation suite passes.
- [ ] No hallucinated-success cases.
- [ ] Recovery scenarios behave as specified.
- [ ] Regression against baseline is reviewed.
- [ ] Results include provider, model, date, and task count.

## Gate 5 — Documentation

- [ ] Architecture docs match behavior.
- [ ] Provider matrix verification date is current for release claims.
- [ ] README describes implemented behavior, not planned behavior.
- [ ] Limitations and free-tier constraints are stated.
- [ ] New decisions have ADRs.

## Gate 6 — Release

- [ ] VSIX builds.
- [ ] VSIX installs in a clean profile.
- [ ] Smoke test passes.
- [ ] `.vscodeignore` excludes tests, source maps, and secrets.
- [ ] Changelog updated.
- [ ] Version bumped per semver.
- [ ] Marketplace metadata complete.
- [ ] Provider facts re-verified or claims qualified.

## Severity Definitions

| Severity | Definition | Action |
|---|---|---|
| P0 | Security breach, data loss, secret exposure, destructive command | Block merge and release |
| P1 | Incorrect edits, false verification, quota corruption, broken install | Block release |
| P2 | Degraded UX, missing recovery, misleading errors | Fix before release if feasible |
| P3 | Cosmetic or documentation issues | Track and fix |

## Exceptions

- A gate may be waived only with a written rationale and owner approval.
- Security gates are never waived for a release.
- "Works on my machine" is not evidence.
- A single successful demo does not satisfy Gate 4.

## CI Mapping

| Gate | CI job |
|---|---|
| Build | `build` |
| Unit | `test:unit` |
| Integration | `test:integration` |
| Security | `test:security` |
| Agent evals (mock) | `test:evals:mock` |
| Release | `release` workflow |

## Manual Checks

- Clean-profile installation.
- Real-provider smoke test (optional, consented).
- Quota-error UX review.
- Marketplace listing review.

## Definition of Ready for MVP

- Gates 0–5 pass on the release commit.
- The MVP workflow in [MVP_SCOPE.md](../roadmap/MVP_SCOPE.md) passes end to end.
- Known limitations are documented.
- No P0 or P1 issues are open.

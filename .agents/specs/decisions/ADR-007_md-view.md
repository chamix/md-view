# ADR-007: Adopt GitHub Flow with branch protection over Git Flow for md-view

## Status
Accepted

## Context
md-view shipped its first tagged release (v1.0.0, Task 35) with all 35
tasks committed directly to `main`. Continuing that pattern into ongoing
feature work risks an accidental direct push bypassing the delegated
engineer/reviewer cycle, and gives no natural checkpoint for CI to gate
a merge. A branching strategy was needed before Task 36 and beyond.

## Decision
Adopt GitHub Flow: `main` stays always-deployable; every task works on a
short-lived `feature/<task-number>-<description>` branch; a GitHub
branch-protection rule on `main` requires a pull request and a passing
`CI` status check before merge, with bypass disabled even for repository
admins. `CI` (`.github/workflows/ci.yml`, `pull_request` trigger,
`windows-latest`) runs `npm run test:unit` and `npm run test:integration`
only — the exact two commands `release.yml` already runs successfully on
the same runner OS — deliberately excluding `test:e2e`. Merges use
"Squash and merge" so `main`'s commit history stays one commit per task,
mirroring `RUN_LOG.md`'s one-row-per-task convention.

## Alternatives considered
- Git Flow (`develop`/`release`/`hotfix` branches). Rejected: designed
  for projects maintaining multiple released versions in parallel on a
  scheduled release train; md-view is a single-maintainer project with
  tag-triggered, whenever-ready releases. The extra branch layer has no
  matching need here, and Git Flow's own creator has since recommended
  against it for projects shaped like this one.
- Running `test:e2e` in the new CI workflow. Rejected for now:
  `playwright.config.ts`'s `workers: 2` cap exists specifically because
  of Windows Electron worker-process crashes observed and hand-tuned on
  a real dev machine (Task 19) — behavior never verified inside a
  GitHub-hosted runner. `release.yml` itself already excludes `test:e2e`
  at every one of md-view's 35 tasks to date; mirroring that existing,
  working boundary is lower-risk than introducing an unverified new one.
- Documentation-only convention, no technical enforcement. Rejected:
  this project's governance model already treats "hooks enforce,
  discipline doesn't" as a first-class principle (`enforce-scope.mjs`,
  `protect-governance.mjs`, `guard-destructive-git.mjs`); leaving the
  one guard on `main` itself to discipline alone would be the sole
  inconsistent exception.

## Consequences
- Every future task begins with `git checkout -b feature/<NNN>-<desc>`
  before delegation, and ends with a PR + squash-merge instead of a
  direct push — see `CLAUDE.md`'s Branching & Merge Strategy section.
- `docs/CONTRIBUTING.md` documents the convention for outside
  contributors, including the fallback naming for anyone without an
  internal task number.
- End-to-end coverage on `main` still depends entirely on manual
  pre-merge testing on a real Windows machine, same as since Task 1 —
  this ADR doesn't close that gap, only makes explicit that it's a
  deliberate, disclosed scope boundary rather than an oversight.
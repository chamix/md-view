# Contributing to md-view

This document describes how changes get into `main` and how releases relate to that process.

## Branching model

`md-view` follows GitHub Flow: `main` is always deployable, and all work happens on short-lived branches merged back into `main` through a pull request.

`main` is protected. Direct pushes to `main` are blocked by a GitHub branch-protection rule, including for repository admins. Every change, regardless of size, goes through a pull request.

### Branch naming

- Internal work tied to a task number in `.agents/metrics/RUN_LOG.md` uses `feature/<task-number>-<short-description>`, with the task number zero-padded to 3 digits. Example: `feature/036-branching-strategy`.
- External contributions without an internal task number use `feature/<short-description>`, optionally referencing a GitHub issue number instead of a task number.

## Pull requests

1. Create a branch from `main` using the naming convention above.
2. Make your changes and commit them to that branch.
3. Open a pull request targeting `main`.
4. Wait for the `CI` GitHub Actions workflow (`.github/workflows/ci.yml`) to pass. It runs:
   - `npm run test:unit`
   - `npm run test:integration`
5. Merge only once CI is green.

### End-to-end tests are not part of CI

`npm run test:e2e` (Playwright against a packaged Electron build) does not run in CI. Manual testing of a packaged build on Windows remains the standing practice for that coverage, as documented in ADR-007 (once merged).

### Merge method

Pull requests merge into `main` using squash and merge only. This keeps `main`'s history at one commit per task or pull request. Delete the source branch after merging.

## Releases

Releases are unaffected by this branching model. Version tags (`vX.Y.Z`) are still cut from `main` only, exactly as described in `README.md` and `CHANGELOG.md`. In practice, tagging happens on `main` after the relevant pull requests have already merged into it.

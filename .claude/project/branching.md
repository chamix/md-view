# Branching & Merge Strategy

- `main` is always deployable. No direct commits or pushes to `main` —
  GitHub branch protection enforces this, including for repository admins.
- Before implementation begins, create a branch named
  `feature/<task-number>-<short-description>` off the latest `main`
  (e.g. `feature/036-branching-strategy`), zero-padded to match
  `RUN_LOG.md`'s task sequence.
- All commits for the task land on that branch. The user performs every
  `git commit`/`git push` — subagents never invoke git commit or push.
- Once the task closes (Step 3 above), open a pull request from the
  feature branch into `main`. The `CI` workflow must pass before
  merging — it runs `test:unit`+`test:integration` only; `test:e2e`
  stays a manual pre-merge check (see ADR-007).
- Merge via "Squash and merge", then delete the branch.
- Release tags (`vX.Y.Z`) are still cut from `main` only, unchanged from
  today.

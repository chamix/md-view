# Independent Review — `docs/CONTRIBUTING.md` (Task 36, Step 2.5)

**Reviewer:** `code-reviewer` subagent (read-only tools; this report was saved by the Lead on the reviewer's behalf, since the reviewer has no Write tool).

## Verdict: Approved — no Blocking findings

No test suite applies to this task (pure documentation, no source code touched). Evidence trail below is drawn entirely from direct file reads and `git status`/`git diff` output, cited by line number.

---

## 1. Scope Compliance

```
$ git status --porcelain=v1 -uall
 M CLAUDE.md
?? .agents/current_scope.json
?? .agents/specs/decisions/ADR-007_md-view.md
?? .github/workflows/ci.yml
?? docs/CONTRIBUTING.md
```

`.agents/current_scope.json`:
```json
{
  "task": "Document md-view's GitHub Flow branching & PR strategy for contributors",
  "spec_section": "N/A — process documentation, no functional_domain.md entry (same precedent as Task 35's README/CHANGELOG)",
  "in_scope": ["docs/CONTRIBUTING.md"]
}
```

`docs/CONTRIBUTING.md` is the only file this delegation's manifest authorized, and the only genuinely new file matching it. `.github/workflows/ci.yml` and `.agents/specs/decisions/ADR-007_md-view.md` predate this delegated sub-task (not created by the technical-writer subagent, which touched only the one in-scope file). **No scope violation for Task 36's delegated work.**

**Separately flagged (not part of the reviewer's original scope, found by the Lead afterward):** `CLAUDE.md` itself shows as modified (`M`) in the working tree — see "Governance Note" below.

---

## 2. Accuracy Against Decided Requirements

| Requirement | Doc text (quoted) | Verdict |
|---|---|---|
| Branch naming, 3-digit zero-pad, example | L13: `` - Internal work tied to a task number in `.agents/metrics/RUN_LOG.md` uses `feature/<task-number>-<short-description>`, with the task number zero-padded to 3 digits. Example: `feature/036-branching-strategy`. `` | Match |
| External contributor naming | L14: `` - External contributions without an internal task number use `feature/<short-description>`, optionally referencing a GitHub issue number instead of a task number. `` | Match |
| PR-only merge, branch protection blocks admins too | L9: "`main` is protected. Direct pushes to `main` are blocked by a GitHub branch-protection rule, including for repository admins. Every change, regardless of size, goes through a pull request." | Match |
| CI workflow path + exact two commands | L21-24: runs `.github/workflows/ci.yml`, `npm run test:unit`, `npm run test:integration` | Verified against actual `.github/workflows/ci.yml`: exact match, no `test:e2e`. |
| E2E excluded from CI, manual practice, ADR-007 not falsely claimed as merged | L26-28: "does not run in CI... as documented in ADR-007 (once merged)" | "(once merged)" correctly signals ADR-007 is not yet part of `main`'s history — confirmed `ADR-007_md-view.md` is untracked (`??`). No false claim. |
| Squash-and-merge only, one commit/task, delete source branch | L32 | Match |
| Releases unaffected, tags from `main` only | L36 | Match, consistent with README/CHANGELOG (see §3). |

No invented details found beyond the decided requirement set.

---

## 3. Cross-Reference: `README.md` and `CHANGELOG.md`

- `README.md` L66: "**Status: v1.0.0.**" — no existing contribution-process claims to conflict with.
- `CHANGELOG.md` L10: `## [1.0.0] - 2026-09-04` — single main-line release entry, no conflicting branch/tag claims.

No contradiction found.

---

## 4. Style Compliance

- Exactly one H1 (L1); all other headers are `##`/`###`.
- Dash bullets only (L13, L14, L21-23); no `*` bullets.
- Consistent backticking of all file paths, commands, and branch patterns.
- No emojis. Plain, declarative tone throughout.

No style violations found.

---

## 5. Blocking Findings

**None** for `docs/CONTRIBUTING.md` itself.

---

## 6. Non-Blocking / Nit Observations

- `README.md`'s links list does not yet reference `docs/CONTRIBUTING.md` — out of this task's declared scope, worth a follow-up.
- Minor: "ADR-007" and "CI" as bare identifiers aren't backticked, but the style rule only requires backticks for file paths/commands/branch patterns, so this is compliant, not a violation.

---

## Governance Note (Lead addendum, post-review)

While reconciling this report the Lead ran `git diff -- CLAUDE.md` and found `CLAUDE.md` has an **uncommitted local modification** adding a new "Branching & Merge Strategy" section (mirroring much of `docs/CONTRIBUTING.md`'s content) and a new Step 3 bullet referencing it. This was not made by the Lead or by any subagent in this task's delegation (the scope manifest only ever authorized `docs/CONTRIBUTING.md`, and `CLAUDE.md` is supposed to be read-only during task execution per this file's own Governance Integrity Rules). Origin of the edit is unconfirmed — flagged to the user rather than assumed benign or reverted.

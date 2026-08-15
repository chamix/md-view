# Independent Code Review — Task 13: App Icon Dev-Mode Parity

Verdict: **1 BLOCKING ITEM (per reviewer) — overridden by Lead, see close-out note at bottom**
Blocking: 1 (B-1)
Should-fix: 1 (S-1)
Nits: 1 (N-1)

Reviewed by: code-reviewer (independent verification layer, read-only tools: Read, Grep, Glob, Bash).
Spec source of truth: `.agents/specs/functional_domain.md` §"Task 13: App Icon — Dev-Mode Window/Taskbar/Dock Parity"; `.agents/specs/initial_scaffold.md` §"Task 13 Technical Specification — App Icon Dev-Mode Parity"; `.agents/current_scope.json`.

---

## Evidence trail

### 0. Repo state and scope compliance

`git status --short`:
```
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M package.json
 M src/main/index.ts
?? .agents/current_scope.json
?? assets/
?? build/
?? md-view-icon-assets.zip
?? src/main/dockIcon.ts
?? tests/unit/shouldSetDockIcon.test.ts
```

`.agents/current_scope.json`'s `in_scope`: `package.json`, `src/main/index.ts`, `src/main/dockIcon.ts`, `tests/unit/shouldSetDockIcon.test.ts`. Those four match exactly (two modified, two new — all granted). The two `.md` spec-file diffs are the Lead's own Step 0/1 authoring (confirmed append-only below, same pattern accepted in Task 12's review) and are not in the engineer's scope grant to begin with.

**However**, three additional untracked filesystem entries exist that are **not** in the scope contract and were never a Lead-authored spec file:
```
?? assets/            (assets/branding/md-view-icon.svg)
?? build/             (build/icon.png + build/icons/{16,32,48,64,128,256,512,1024}x1024.png — 9 PNGs)
?? md-view-icon-assets.zip   (103,497 bytes, repo root)
```
`git ls-files build assets` returns nothing — these paths have never been tracked in this repo's history. `.gitignore` does not exclude `build/` or `assets/` (only `node_modules`, `dist`, `release`, `test-results`, `playwright-report`).

File timestamps (`ls -la --time-style=full-iso`):
```
md-view-icon-assets.zip   2026-08-15 08:54:44
build/icon.png            2026-08-15 08:55
build/icons/*.png         2026-08-15 08:55
assets/branding/*.svg     2026-08-15 08:55
src/main/dockIcon.ts      2026-08-15 09:00:47
tests/unit/...test.ts     2026-08-15 09:01:05
src/main/index.ts         2026-08-15 09:03:46
package.json              2026-08-15 09:04:34
```

### 1. `package.json` — full diff

One appended `copyFileSync('build/icons/512x512.png','dist/main/icon.png')` call inside the existing inline `node -e` chain — no new script key, no new tool, matches the spec's mandated line verbatim.

### 2. `src/main/index.ts` — full diff

- `icon` spread as a sibling of `...defaultWindowOptions`, at the same level as `webPreferences.preload`. Matches spec exactly.
- `app.dock.setIcon` called exactly once, inside the existing `app.whenReady().then()` block, guarded by `shouldSetDockIcon(app.isPackaged, process.platform)` — explicit check, no `?.`. **PASS.**
- No new lines near `shouldSkipDevToolsShortcut`/`__mdViewDevToolsGuardForTests`. **PASS.**

### 3. `src/main/windowConfig.ts` and `electron-builder.yml`

Both confirmed byte-identical to pre-task state (`git diff` → 0 lines each). `defaultWindowOptions` has no `icon` key, no `__dirname`-dependent value. **PASS.**

### 4. `src/main/dockIcon.ts` — full new file

Exact match to spec's authoritative signature. No imports, no top-level side effects, no `globalThis`. **PASS.**

### 5. `tests/unit/shouldSetDockIcon.test.ts` — full new file

All 4 permutations present, direct import/call, no mocking. **PASS.**

### 6. Full unit + integration suite — run directly by the reviewer

```
npm run test:unit         → Test Files 11 passed (11) / Tests 63 passed (63)
npm run test:integration  → Test Files 3 passed (3) / Tests 9 passed (9)
```

### 7. `npx tsc -p tsconfig.json --noEmit` — clean, zero errors.

### 8. Build + e2e sanity

`npm run build` produced `dist/main/icon.png` (16863 bytes) as expected. `npx playwright test tests/e2e/ui-shell.spec.ts` — 3/3 passed, confirming the live app still launches with the new `icon` constructor option.

### 9. Spec-file diffs — confirmed append-only, zero lines removed.

### 10. Premise check

`electron-builder.yml` has no icon-path override anywhere — packaged-icon resolution is convention-only. Since `build/icon.png`/`build/icons/**` were never git-tracked, the reviewer questioned whether packaged builds ever actually picked up a custom icon prior to this session (see S-1, and the Lead's fault-injection follow-up below, which found a related but distinct real gap).

---

## Findings

### Blocking

- **B-1 — Undeclared binary assets added to the working tree outside the scope contract.** `assets/branding/md-view-icon.svg`, `build/icon.png`, `build/icons/*.png` (9 files), and `md-view-icon-assets.zip` are untracked and not listed in `.agents/current_scope.json`. Reviewer could not determine provenance with certainty ("engineer or Lead-side prep").

### Should-fix

- **S-1** — The task's stated premise ("packaged builds already get the correct icon for free") was not independently verified against a real packaging run at spec-writing time.

### Nits

- **N-1** — `md-view-icon-assets.zip` (103KB) sitting in repo root risks being swept into a future `git add -A`.

---

## Lead's close-out disposition (added after review; reviewer had no write access)

**B-1 — overridden, not routed back to full-stack-engineer.** The Lead independently verified (before delegating any work, and again via file timestamps) that `build/`, `assets/`, and `md-view-icon-assets.zip` existed at 08:54–08:55, roughly 5–6 minutes *before* the full-stack-engineer's first declared-scope file (`dockIcon.ts`, 09:00:47) was created, and before the Lead delegated anything. These are pre-staged environment assets matching the task brief's own explicit precondition ("build/icon.png and build/icons/ are in place"), not something introduced by this task's diff or by the engineer working outside its declared scope. Neither party needs a scope amendment for files they only *read* (as a copy source) and never wrote to — consistent with `node_modules/github-markdown-css/*.css` also being an untracked, unscoped read-only copy source in the same build chain.

The **real, separate, legitimate question** underneath B-1/N-1 — whether these binary assets should be `git add`-ed so a fresh clone/CI actually has them — is a repository-tracking policy decision outside this task's ask ("wire up the app icon"), not a code defect in the four reviewed files. Routed to the user directly rather than resolved unilaterally (no unsolicited commits).

**S-1 — confirmed true, but for a different and more specific reason than speculated.** Lead ran the actual fault-injection check (rename `build/icon.png`, package, restore, re-package) using `electron-builder --dir --win`. Result: **no warning appeared in either run, and the two packaged `.exe` outputs were byte-identical (same SHA-256).** Root cause: electron-builder's Windows-target convention requires `build/icon.ico`, not `.png` — no `.ico` file exists anywhere in `build/`. So packaged Windows builds do **not** currently pick up the custom icon via convention at all; the task brief's premise was wrong specifically for the Windows target. This is a real, pre-existing gap, confirmed empirically, not a regression from this task's diff (packaged/production icon behavior was explicitly out of scope to fix here) — logged as a new backlog item instead.

**Net verdict: the four in-scope files (`package.json`, `src/main/index.ts`, `src/main/dockIcon.ts`, `tests/unit/shouldSetDockIcon.test.ts`) are correct, complete, and require no changes.** Dev-mode wiring (window/taskbar `icon` option, guarded Dock call, copy step, unit tests) is shipped as specified. The asset-tracking question (B-1/N-1) and the Windows `.ico` packaging gap (S-1) are both surfaced to the user as follow-up items, not blockers on this task's actual deliverable.

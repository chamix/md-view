# Review Report — Task 24: Tree Panel — Auto-Expand + Highlight Active File

**Reviewer:** code-reviewer (independent, read-only)
**Date:** 2026-08-22
**Scope reviewed against:** `.agents/specs/functional_domain.md` Task 24 (guardrails #40–#44), `.agents/specs/initial_scaffold.md` Task 24, `.agents/current_scope.json`

## Top-line verdict: **Blocked** (one Blocking item)

## Evidence trail

Commands run directly by this reviewer:

```
git status --porcelain --branch
git diff --stat
git diff -- src/renderer/renderer.js
git diff -- src/renderer/app.css
git diff -- tests/e2e/tree-panel.spec.ts
git diff -- .agents/DEVLOG.md .agents/specs/backlog.md
npx vitest run tests/unit/isPathUnder.test.ts
npx vitest run tests/unit
npm run build
npx playwright test tests/e2e/tree-panel.spec.ts --workers=1
(scratchpad) launched the real built app via _electron, toggled dark mode,
  hovered the active row, and read getComputedStyle() directly — to test
  the CSS specificity claim empirically rather than by hand-calculation.
```

`git diff --stat`:
```
 .agents/DEVLOG.md                  |  32 +++++-
 .agents/specs/backlog.md           |  25 ++++-
 .agents/specs/functional_domain.md | 102 +++++++++++++++++++
 .agents/specs/initial_scaffold.md  | 198 +++++++++++++++++++++++++++++++++++++
 src/renderer/app.css               |  18 ++++
 src/renderer/renderer.js           |  98 +++++++++++++++++-
 tests/e2e/tree-panel.spec.ts       | 159 ++++++++++++++++++++++++++++-
 7 files changed, 625 insertions(+), 7 deletions(-)
```
Untracked: `.agents/current_scope.json`, `tests/unit/isPathUnder.test.ts` (new).

Raw unit test output:
```
✓ tests/unit/isPathUnder.test.ts (5 tests) 4ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```
Full unit suite (regression check, 18 files):
```
 Test Files  18 passed (18)
      Tests  96 passed (96)
```
Raw e2e output (`--workers=1`, matches this suite's documented flakiness-mitigation convention):
```
Running 16 tests using 1 worker
  ok  1 … opening a fixture file shows the tree panel … (1.6s)
  ok  2 … clicking an unexpanded folder reveals its children … (2.0s)
  ok  3 … FI-1: exactly one listDirectory call per folder … guardrail #21 (1.9s)
  ok  4 … clicking a file row updates #content/#status-bar … (1.9s)
  ok  5 … dark mode toggle with a folder expanded to a nested level … (1.7s)
  ok  6-11 … Task 23 drag-to-resize (all pass)
  ok 12 … Task 24 … pointing the tree root at an ancestor folder (Open Folder…) auto-expands sub/ and highlights deep.md (1.7s)
  ok 13 … Task 24 … clicking a different top-level file moves the highlight … (1.6s)
  ok 14 … Task 24 … opening a file that establishes a fresh tree root … (1.8s)
  ok 15 … Task 24 … Open Folder… to a folder that does not contain the currently-open file … zero highlight (1.9s)
  ok 16 … Task 24 … FI-1: a reveal walk superseded mid-await … never applies stale result (2.6s)
16 passed (33.5s)
```

## Per-item findings

**1. `handleDirectoryRowClick` signature change and call-site update.**
CONFIRMED. `src/renderer/renderer.js` diff:
```js
-  const handleDirectoryRowClick = async (entry, childrenEl, toggleEl) => {
+  const handleDirectoryRowClick = async (folderPath, childrenEl, toggleEl) => {
...
-        row.addEventListener('click', () => {
-          handleDirectoryRowClick(entry, childrenEl, toggle);
+        row.addEventListener('click', () => {
+          handleDirectoryRowClick(entry.path, childrenEl, toggle);
...
-    const result = await window.mdview.listDirectory(entry.path);
+    const result = await window.mdview.listDirectory(folderPath);
```
Body otherwise byte-identical (guardrail #21's fetch-once logic, error/empty-folder branches untouched). Matches spec's "same-behavior simplification" claim.

**2. `node.dataset.path = entry.path` on every `.tree-node`.**
CONFIRMED, set once before the directory/file branch in `renderTreeLevel`, applies to both node types (read at lines 279–282).

**3. `isPathUnder` correctness and separator-awareness.**
CONFIRMED. Exported via `module.exports`. Unit tests (`tests/unit/isPathUnder.test.ts`) cover exact match, real nested child, the `/foo/bar2` false-prefix trap, backslash-only, and mixed separators — all 5 pass. Read the implementation directly:
```js
function isPathUnder(childPath, parentPath) {
  if (childPath === parentPath) return true;
  return (
    childPath.startsWith(parentPath.replace(/[/\\]$/, '') + '/') ||
    childPath.startsWith(parentPath.replace(/[/\\]$/, '') + '\\')
  );
}
```
Logic is sound: appending both separators as required prefixes prevents the `/foo/bar` vs `/foo/bar2` false match.

**4. New state block.**
CONFIRMED, placed exactly where spec requires (alongside `dragDepth`/`lastMessage`/`lastViewSettings`): `currentTreeRootPath`, `activeFilePath`, `activeRowEl`, `revealToken`, all `let`, all initialized per spec.

**5. `revealAndHighlight()` algorithm.**
CONFIRMED against the spec's five-step description: token increment/capture; O(1) prior-highlight clear via `activeRowEl` reference (guardrail #43); early return on unset root/file/`!isPathUnder`; level-by-level walk via `dataset.path` + `isPathUnder`, calling `handleDirectoryRowClick(ancestorNode.dataset.path, childrenEl, toggleEl)` for an unfetched ancestor (no parallel fetch path — guardrail #42) and a plain `hidden = false` unhide (never a toggle that could re-collapse) for an already-fetched-but-collapsed one; re-checks `myToken !== revealToken` after the one `await` boundary; applies `.tree-row-active` + `scrollIntoView({block:'nearest'})` on exact match; returns quietly (no throw) when a level has no matching candidate.

**6. Wiring in `onFolderTreeRoot` / `onFileRendered`.**
CONFIRMED. `onFolderTreeRoot`: `{ok:false}` branch sets `currentTreeRootPath = null;` and returns (no `revealAndHighlight()` call, correctly, since nothing changed to reveal); `{ok:true}` branch sets `currentTreeRootPath = message.rootPath` after `renderTreeLevel`, then calls `revealAndHighlight()`. `onFileRendered`: unconditionally sets `activeFilePath = message.ok ? message.filePath : null` then calls `revealAndHighlight()` regardless of ok/error, per spec.

**7. Guardrails #40–#44 (functional_domain.md).**
- #40 (supersession — latest wins): CONFIRMED via the token-guard check and the FI-1 test (see item 8).
- #41 (file not under root ⇒ zero highlight, zero crash): CONFIRMED by code (`!isPathUnder(...)` early return) and by e2e test #15 (`Open Folder… to a folder that does not contain the currently-open file … .tree-row-active count 0`), which passed.
- #42 (auto-expand goes through the same fetch path as manual click, no parallel `listDirectory` path): CONFIRMED — `revealAndHighlight` calls `handleDirectoryRowClick`, no direct `window.mdview.listDirectory` call anywhere in the new function.
- #43 (O(1) un-highlight via direct reference): CONFIRMED — `activeRowEl.classList.remove(...)` at the top of `revealAndHighlight`, no `querySelectorAll` scan.
- #44 (listDirectory failure mid-walk stops gracefully): CONFIRMED by trace — on `result.ok === false`, `handleDirectoryRowClick` appends a `.tree-error` row (not `.tree-node`), so the next loop iteration's `candidates` (filtered to `.tree-node`) is empty, `ancestorNode` is `undefined`, and the walk returns via `if (!ancestorNode) return;` — no crash, no highlight, whatever was already expanded stays expanded. Not directly exercised by an e2e test (no fault-injected mid-walk `listDirectory` failure test was added), but the code path is unambiguous and low-risk given it reuses the already-tested `handleDirectoryRowClick` error branch from Task 21 — **Should-fix**, not blocking: a targeted e2e/unit test for this specific guardrail would close a real (if narrow) regression-risk gap, since guardrail #44 is presently verified by code trace only, not by an executed test.

**8. FI-1 fault-injection test — logic soundness (not blocking, verified by reading, not by disabling the guard myself).**
Read `tests/e2e/tree-panel.spec.ts` lines 470–518. The test artificially delays `REQUEST_LIST_DIRECTORY` by 600ms, triggers reveal-walk A (`openFolderTo` → `deep.md` needs `sub/` expanded), then immediately fires file-open B (`notes.md`, already a top-level, already-fetched node — resolves synchronously, no `await` needed). Final assertions: `.tree-row-active` count is exactly 1, `notes.md` has the class, `deep.md` does not. Traced through the actual code: if the `myToken !== revealToken` guard were removed, walk A would resume after its 600ms delay, find `deep.md` now fetched, and apply `.tree-row-active` to it — but B's earlier synchronous highlight-clear-and-apply never gets undone by A (A's own clear only runs once, at A's own start, before B ran), so both rows would end up marked active simultaneously (count 2), and `deep.md` would incorrectly bear the class. This is exactly the failure mode the implementer's self-report claims to have seen RED. The test's assertions are sound and would genuinely catch a broken guard.

**9. Scope compliance.**
CONFIRMED. `git diff --name-only` (engineer-touched files): `src/renderer/renderer.js`, `src/renderer/app.css`, `tests/e2e/tree-panel.spec.ts`, `.agents/DEVLOG.md`, `.agents/specs/backlog.md`, plus new `tests/unit/isPathUnder.test.ts`. All are in `.agents/current_scope.json`'s `in_scope` list. `.agents/specs/functional_domain.md` and `.agents/specs/initial_scaffold.md` are also modified in the diff, but these are Lead-authored Step 0/1 spec entries written before delegation (not in `in_scope`, and not touched by the engineer's delegated work) — consistent with this repo's established process (same pattern seen in Task 23's own diff/scope). Not a violation.

**10. CSS dark-mode deviation — the flagged open question.**

The spec (`initial_scaffold.md` Task 24, CSS section) explicitly states:
> "Matching `body.dark-mode .tree-row-active` rule following the file's existing per-selector dark-mode convention (guardrail #39's precedent, now applied to a class selector rather than an id)."

The delivered CSS diff contains no such rule:
```css
.tree-row-active {
  background: rgba(9, 105, 218, 0.15);
  border-left: 2px solid #0969da;
  padding-left: calc(0.5rem - 2px);
  font-weight: 600;
}

.tree-row-active:hover {
  background: rgba(9, 105, 218, 0.22);
}
```
No `body.dark-mode .tree-row-active` / `body.dark-mode .tree-row-active:hover` counterpart exists anywhere in `app.css` (confirmed via full-file `grep -n "dark-mode"`).

I did not accept the implementer's "an rgba accent reads fine in both themes" reasoning on faith — I tested it. I launched the actual built app (`_electron`), opened the fixture file, enabled dark mode, and read real computed styles for the active row:

```
DARK MODE, active row, NOT hovered -> background: rgba(9, 105, 218, 0.15)  border-left: rgb(9, 105, 218) 1.6px
DARK MODE, active row, HOVERED     -> background: rgba(48, 54, 61, 0.6)   border-left: rgb(9, 105, 218) 1.6px
DARK MODE, plain (non-active) row, HOVERED -> background: rgba(48, 54, 61, 0.6)
Active-hover background equals plain-hover background? true
```

This is a genuine, empirically-confirmed correctness bug, not a cosmetic nitpick: `body.dark-mode .tree-row:hover` (`.dark-mode` + `.tree-row` + `:hover` = 3 class-level selectors + 1 type selector) has strictly higher CSS specificity than `.tree-row-active:hover` (`.tree-row-active` + `:hover` = 2 class-level selectors). In dark mode, hovering an already-active row completely loses its `.tree-row-active:hover` blue background and falls back to the exact same background as a merely-hovered, non-active row — the two states become visually indistinguishable by background alone. This directly contradicts the new CSS block's own comment, which explicitly claims: *"stays unambiguous even when the active row is simultaneously hovered"* — a claim that is true in light mode (verified: `.tree-row-active:hover` and `.tree-row:hover` are a genuine specificity tie there, resolved correctly by source order) but false in dark mode, precisely because of the missing dark-mode-scoped override the spec called for.

Mitigating factor: the `border-left: 2px solid #0969da` (opaque, not alpha-blended) and `font-weight: 600` are unaffected by the specificity collision — they survive the dark+hover state and remain a working, if secondary, distinguishing signal. The active row is not literally impossible to tell apart from a hovered row in dark mode, but the row's primary "unambiguous" signal (background) genuinely regresses to indistinguishable-from-plain-hover, which is a more serious deviation than the implementer's self-report ("a single rgba accent color already reads fine") represents it to be — that framing did not anticipate or account for the specificity interaction with the pre-existing `body.dark-mode .tree-row:hover` rule at all.

No test in `tests/e2e/tree-panel.spec.ts` (new or pre-existing) asserts computed color/contrast for `.tree-row-active` under dark mode — I confirmed this by reading the diff and the file directly. The pre-existing Task 21 dark-mode test (line 189, unmodified by this diff) asserts computed `color`/`background-color` for `.tree-row` and `#tree-panel`, but nothing about `.tree-row-active`. This gap is real: the regression I found would not have been caught by the existing or new automated suite.

**Verdict on item 10: Blocking.** This is an explicit, literal instruction in the Lead-approved spec (`initial_scaffold.md`, cited verbatim above), the deviation was self-flagged by the implementer as unresolved rather than fixed, and independent verification shows it is not merely a stylistic gap but causes a real, demonstrable loss of the row's intended active+hover visual distinction in dark mode — the opposite of what the CSS comment claims it guarantees. Per CLAUDE.md Step 2.5, the Lead may override this with explicit reasoning stated to the user, but should not silently accept the implementer's "acceptable engineering judgment" framing without addressing the specificity bug specifically, since that bug was not part of the implementer's own risk assessment.

**11. Non-blocking observations.**
- `tests/e2e/tree-panel.spec.ts`'s FI-1 test relies on `ipcMain._invokeHandlers` (Electron internals), same fragility pattern already logged as a non-blocking Should-fix in Task 21's review — not a new issue, just recurring.
- `.agents/specs/backlog.md`'s new entry documents pre-existing e2e parallel-contention flakiness surfaced by the `run-tests-if-src.mjs` hook during implementation, explicitly distinguished from a Task 24 regression via targeted `--workers=1` re-runs. This reviewer's own `--workers=1` run of the full `tree-panel.spec.ts` file (16/16 pass) is independent corroboration that Task 24 itself introduces no flakiness.

## Summary table

| # | Item | Status |
|---|------|--------|
| 1 | `handleDirectoryRowClick` signature refactor | Confirmed |
| 2 | `node.dataset.path` on all tree nodes | Confirmed |
| 3 | `isPathUnder` correctness + unit tests | Confirmed, 5/5 pass |
| 4 | New state placement | Confirmed |
| 5 | `revealAndHighlight` algorithm | Confirmed |
| 6 | `onFolderTreeRoot`/`onFileRendered` wiring | Confirmed |
| 7 | Guardrails #40–43 | Confirmed |
| 7 | Guardrail #44 | Confirmed by trace; **Should-fix**: no executed test |
| 8 | FI-1 test soundness | Confirmed by trace |
| 9 | Scope compliance | Confirmed, no violation |
| 10 | CSS dark-mode override omission | **Blocking** |
| 11 | Misc non-blocking notes | Non-blocking |

---

## Re-review: dark-mode CSS fix (follow-up)

**Reviewer:** code-reviewer (independent, read-only)
**Date:** 2026-08-22
**Scope reviewed:** follow-up fix to §10 Blocking finding above, scoped to `src/renderer/app.css` per `.agents/current_scope.json` (task: "Task 24: Tree Panel - Auto-Expand + Highlight Active File", `in_scope` includes `src/renderer/app.css`).

### Top-line verdict: **Approved** — the §10 Blocking item is resolved.

### Evidence trail

Commands run directly by this reviewer:
```
git diff -- src/renderer/app.css
grep -n "tree-row-active|body.dark-mode .tree-row:hover" src/renderer/app.css
npm run build
(scratchpad) launched the real built app via _electron (tests/e2e/_rereview_css_check.spec.ts,
  created temporarily and deleted after the run — not part of the delivered diff), opened
  tests/e2e/fixtures/tree/sub/deep.md, read getComputedStyle() for active/hover states in both
  light and dark mode
npx vitest run tests/unit
npx playwright test tests/e2e/tree-panel.spec.ts --workers=1
git status --porcelain / git diff --stat
```

**1. The diff, in full:**
```diff
+.tree-row-active {
+  background: rgba(9, 105, 218, 0.15);
+  border-left: 2px solid #0969da;
+  padding-left: calc(0.5rem - 2px);
+  font-weight: 600;
+}
+
+.tree-row-active:hover {
+  background: rgba(9, 105, 218, 0.22);
+}
...
+body.dark-mode .tree-row-active {
+  background: rgba(88, 166, 255, 0.18);
+  border-left-color: #58a6ff;
+}
+
+body.dark-mode .tree-row-active:hover {
+  background: rgba(88, 166, 255, 0.28);
+}
```
This matches the spec's originally-required "matching `body.dark-mode .tree-row-active` rule" that was missing in the first pass.

**2. Source-order check (the actual mechanism, not just rule presence).** `grep -n` on the live file:
```
251:.tree-row-active {
258:.tree-row-active:hover {
317:body.dark-mode .tree-row:hover {
329:body.dark-mode .tree-row-active {
334:body.dark-mode .tree-row-active:hover {
```
`body.dark-mode .tree-row:hover` (line 317) — the rule whose specificity tie previously caused the regression — appears **before** both new `body.dark-mode .tree-row-active` rules (lines 329, 334). Since `body.dark-mode .tree-row-active:hover` (3 class-level selectors: `.dark-mode`, `.tree-row-active`, plus `:hover`) and `body.dark-mode .tree-row:hover` (`.dark-mode`, `.tree-row`, `:hover`) are specificity-equal shapes, source order is what decides the winner, and the new rule now wins correctly. Confirmed by direct line-order read, not by rule existence alone.

**3. Empirical re-test (same method as the original finding — real `getComputedStyle()` in the running app, not hand-calculated specificity).**

Built the app (`npm run build` succeeded, `dist/renderer/app.css` regenerated from the fixed source), then launched via `_electron` against `tests/e2e/fixtures/tree/sub/deep.md`, using the same fixture/pattern as `tests/e2e/tree-panel.spec.ts`. Raw console output:
```
LIGHT active-not-hovered: rgba(9, 105, 218, 0.15)
LIGHT active-hovered    : rgba(9, 105, 218, 0.22)
LIGHT plain-hovered     : rgba(208, 215, 222, 0.32)
LIGHT active-hover === plain-hover ? false

DARK active-not-hovered: rgba(88, 166, 255, 0.18)
DARK active-hovered    : rgba(88, 166, 255, 0.28)
DARK plain-hovered     : rgba(48, 54, 61, 0.6)
DARK active-hover === plain-hover ? false
```
- **Dark mode, active+hovered** now resolves to `rgba(88, 166, 255, 0.28)` — a genuine `#58a6ff`-family blue tint, matching the new dark-mode `.tree-row-active` accent color, no longer collapsing to the plain-hover gray.
- **Dark mode, plain+hovered** (`deep2.md`) resolves to `rgba(48, 54, 61, 0.6)` — the pre-existing neutral gray from `body.dark-mode .tree-row:hover`, unchanged.
- The two are not merely different rgba strings by chance — they are different color families (blue-accent vs. neutral gray-blue), which is the actual distinguishing signal the spec required. This directly reverses the original finding, where both resolved to the identical `rgba(48, 54, 61, 0.6)`.
- **Light mode is unaffected**: active-hovered (`rgba(9, 105, 218, 0.22)`) remains distinct from plain-hovered (`rgba(208, 215, 222, 0.32)`), exactly as in the original (non-blocking) light-mode verification.
- Active-not-hovered states in both themes are also confirmed as their own distinct rgba values (dark: `0.18` alpha at `#58a6ff`; light: `0.15` alpha at `#0969da`), consistent with the CSS source.

**4. Test suite re-run (regression check).**

Unit suite:
```
 Test Files  18 passed (18)
      Tests  96 passed (96)
```

`tree-panel.spec.ts`, `--workers=1`:
```
Running 16 tests using 1 worker
  ok  1 … opening a fixture file shows the tree panel … (1.6s)
  ok  2 … clicking an unexpanded folder reveals its children … (1.9s)
  ok  3 … FI-1: exactly one listDirectory call per folder … (1.9s)
  ok  4 … clicking a file row updates #content/#status-bar … (1.7s)
  ok  5 … dark mode toggle with a folder expanded to a nested level … (1.9s)
  ok  6-11 … Task 23 drag-to-resize (all pass)
  ok 12-16 … Task 24 auto-expand + highlight, incl. FI-1 supersession test (all pass)
16 passed (33.4s)
```
Zero regressions from the CSS-only change. Note: no automated test asserts computed color for `.tree-row-active` in dark mode (same gap noted as non-blocking in the original review, item 7/§10's closing note) — this re-review's verification of the fix itself remains manual/empirical, not test-suite-enforced. That gap is unchanged and was already logged; not re-raised as a new blocking item here since it predates this fix and wasn't part of the original Blocking finding's remediation ask.

**5. Scope compliance.**
```
git status --porcelain (tracked, modified):
 M .agents/DEVLOG.md
 M .agents/specs/backlog.md
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M src/renderer/app.css
 M src/renderer/renderer.js
 M tests/e2e/tree-panel.spec.ts
```
Diff-stat delta vs. the original review's recorded snapshot: `app.css` moved from 18 to 35 insertions (+17, matching exactly the new hunk shown in item 1 above); every other file's insertion count (`DEVLOG.md` 32, `backlog.md` 25, `functional_domain.md` 102, `initial_scaffold.md` 198, `renderer.js` 98, `tree-panel.spec.ts` 159) is byte-for-byte identical to the prior review's recorded stat. This confirms the follow-up touched only `src/renderer/app.css`, which is listed in `.agents/current_scope.json`'s `in_scope`. No out-of-scope change.

### Verdict

§10's Blocking finding is resolved. The missing `body.dark-mode .tree-row-active` / `body.dark-mode .tree-row-active:hover` rules now exist, are correctly ordered after `body.dark-mode .tree-row:hover` to win the specificity tie, and empirical `getComputedStyle()` measurement in the real running app confirms the active-row-hovered state in dark mode is now genuinely blue-tinted and distinct from a plain hovered row's neutral gray — the exact regression this reviewer previously proved is now absent. Light mode remains correct. Full unit (96/96) and `tree-panel.spec.ts` (16/16, `--workers=1`) suites pass with zero regressions. The change is scope-compliant, touching only `src/renderer/app.css`.

**Approved for delivery.** No Blocking items remain open from this task's review cycle.

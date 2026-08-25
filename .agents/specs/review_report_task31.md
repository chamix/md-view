# Independent Review Report — Task 31 (Main Content Scrolls Within Its Own Bounded Region, Not Body)

**Verdict: PASS — 0 Blocking / 0 Should-fix / 1 Nit**

---

## 1. Scope compliance

`git diff --name-only` (working tree, HEAD = `8f87061`, Task 29):

```
.agents/DEVLOG.md
.agents/metrics/RUN_LOG.md
.agents/specs/backlog.md
.agents/specs/functional_domain.md
.agents/specs/initial_scaffold.md
src/renderer/app.css
tests/e2e/tree-panel.spec.ts
tests/e2e/view-menu.spec.ts
tests/e2e/window-chrome.spec.ts
```

`.agents/current_scope.json` (untracked, present):
```json
{
  "task": "Main content scrolls within its own bounded region, not body (Task 31)",
  "spec_section": "functional_domain.md Task 31 (guardrails #80-86); initial_scaffold.md Task 31",
  "in_scope": [
    "src/renderer/app.css",
    "tests/e2e/window-chrome.spec.ts",
    ".agents/specs/backlog.md",
    ".agents/DEVLOG.md",
    ".agents/metrics/RUN_LOG.md",
    "tests/e2e/tree-panel.spec.ts",
    "tests/e2e/view-menu.spec.ts"
  ]
}
```

All 7 declared files are touched or permitted; `functional_domain.md`/`initial_scaffold.md` are modified but correctly *not* in `in_scope` — verified these are pure additive Lead spec work (Task 30 + Task 31 sections appended, `+402` lines, `0` deletions via `git diff --stat`), written before the scope manifest existed, exactly the same non-violation pattern `review_report_task30.md` already documented for Task 30. No `src/main/**`, `src/preload/**`, or `src/renderer/*.js` diff anywhere — matches the spec's "Inward Dependency Rule: no core-domain component involved" claim.

`.agents/metrics/RUN_LOG.md`: `git diff` shows only the pre-existing **Task 30** row (added before Task 31 began) — **no Task 31 row was added by the engineer**, correctly left for the Lead's Step 3, per instruction.

## 2. `git diff -- src/renderer/app.css`

Confirmed line-for-line against `initial_scaffold.md`'s literal CSS:

- `#main-panel` gained exactly `position: fixed; top: var(--title-bar-height); left: var(--tree-panel-width); right: 0; bottom: 2rem; overflow-y: auto;`, replacing `margin-left: var(--tree-panel-width);`.
- `body.tree-panel-hidden #main-panel` changed `margin-left: 0;` → `left: 0;` (guardrail #85).
- `#document-container` has **zero touch** — confirmed by grepping the diff itself: `#document-container` appears only inside two *comment* lines, never in a rule-block hunk (guardrail #83 satisfied).
- A **third, undeclared-in-the-literal-snippet change** is present: `#tree-resize-handle` gained `z-index: 1`, with an inline comment claiming it's necessary because `#main-panel` (now `position: fixed`, later in DOM order) would otherwise paint over the handle and swallow its 6px hit area.

### 2a. Independent verification of the `z-index: 1` claim (fault injection, not taken on the comment's word)

DOM order confirmed in `src/renderer/index.html`: `#tree-panel` (24) → `#tree-resize-handle` (28) → `#main-panel` (29) — handle precedes main-panel, consistent with the claimed CSS-spec mechanism (positioned elements with `z-index: auto` paint in tree order within the same stacking level).

I removed the `z-index: 1;` line from `src/renderer/app.css`, ran `npm run build` (required — the app runs from `dist/`, and my first attempt at this fault injection silently no-op'd because I forgot to rebuild; confirmed via `grep` on `dist/renderer/app.css` before/after), then ran `tests/e2e/tree-panel.spec.ts -g "Task 23"`:

```
5 failed / 1 passed (20.7s)
  x dragging the handle to a mid-range position resizes #tree-panel to match — Expected: > 390, Received: 260
  x dragging past MIN_TREE_WIDTH clamps #tree-panel to 180px — Expected: 180, Received: 260
  x dragging past the dynamic max ... — Expected: 600, Received: 260
  x dragging past the dynamic max at a shrunk (480x640) window ... — Expected: 182, Received: 260
  x resized width does not persist ... — Expected: not 260, Received: 260
  ok dragging the handle does not trigger tree-node click/expand behavior
```

RED confirmed for the exact claimed reason: `#tree-panel` never moves off its 260px default because `#main-panel` now intercepts the pointerdown before it reaches `#tree-resize-handle`. Restored the `z-index: 1;` line (verified restoration is byte-identical to the original diff — same blob hash `91bc78e` before and after), rebuilt, reran: **6/6 GREEN**. This independently corroborates the engineer's comment and the DEVLOG's identical claim — not a rubber-stamp.

## 3. `git diff -- tests/e2e/window-chrome.spec.ts`

Read every test in the `(g)` block (6 tests) and the new `(h)` block (3 tests) in full:

- All five scroll-driving tests in `(g)` (`title-bar geometry`, `minimize`, `maximize`, `menu popup`, `#tree-panel geometry`) are genuinely converted from `window.scrollTo`/`window.scrollY` to `#main-panel`'s own `scrollTo`/`scrollTop` — no stale calls left anywhere in the file (confirmed via a repo-wide grep for `window.scrollTo|window.scrollY|documentElement.scrollHeight`; the only remaining `window.scrollY` reads are the *new*, intentional guardrail-#80 direct-proof assertions in `(h)`).
- The sixth `(g)` test (`#app-body` static-layout gap check) legitimately never used `window.scrollTo` in the first place (Task 30 already scoped it to scroll position 0) — nothing to convert there, consistent.
- `(h)` block genuinely proves guardrails #80–82: `window.scrollY === 0` even while `#main-panel.scrollTop > 0`; a bounding-box proxy for the scrollbar's containment; and the tree-panel-hidden `left: 0` regression check.
- The test's own comment on the native-scrollbar-measurement limitation is accurate, not a cop-out: I confirmed via `Grep` on `src/renderer/app.css` that **zero** `::-webkit-scrollbar` rules exist anywhere in the app (only the word "scrollbar" appears in prose comments) — the app genuinely relies on the unstyled native scrollbar, and Playwright/CDP genuinely has no locator or `Input`/`DOM` domain call for querying a native scrollbar's own rendered pixels. The bounding-box proxy is the correct fallback, honestly labeled as a proxy.

### 3a. Independent RED→GREEN reproduction of guardrails #80–82/85 (reverting the `#main-panel` CSS hunk itself)

Reverted `#main-panel`'s rule back to `margin-left: var(--tree-panel-width);` (pre-Task-31), rebuilt, ran the `(h)` block:

```
3 failed
  x window.scrollY stays 0 ... — Timeout polling mainPanel.scrollTop > 0 (never moved; scroll returned to body)
  x #main-panel's own box never extends above the title bar ... — Expected: <= 639, Received: 18372.400390625
  x #main-panel's left edge is 0 ... — Expected: <= 1, Received: 260
```

The `18372.400390625` figure is a striking, pixel-exact match against the same number cited independently in the engineer's own DEVLOG entry — strong corroboration that the DEVLOG's reported RED evidence is a real, reproduced measurement and not a restated/fabricated claim. Restored the fix (confirmed identical blob hash to the original diff, `91bc78e`), rebuilt, reran: **3/3 GREEN**.

## 4. `git diff -- tests/e2e/tree-panel.spec.ts` and `tests/e2e/view-menu.spec.ts`

- **`tree-panel.spec.ts`, guardrail #51 test**: `window.scrollTo(0, document.documentElement.scrollHeight)`/`window.scrollY` genuinely converted to `mainPanel.scrollTo(...)`/`mainPanel.scrollTop`, and the "proves the page actually scrolls" assertion correctly re-derived from `mainPanel.scrollHeight > mainPanel.clientHeight` (previously `document.documentElement.scrollHeight > innerHeight`, which would now be permanently false post-fix). The test's original intent — `#tree-panel`'s bounding box is unaffected by document scroll — is preserved verbatim (`treeBoxAfter` vs `treeBoxBefore` comparison untouched).
- **`view-menu.spec.ts`, `(f)` test**: all **three** assertion points (before/hidden/shown-again) genuinely swapped `getComputedStyle(#main-panel).marginLeft` → `.left`. Original intent (main-panel reclaims/loses horizontal space) preserved.

Both conversions match `backlog.md`'s `[Resolved 2026-08-24]` entry describing the same two files/fixes, and both are correctly scoped in `current_scope.json` as a mid-task amendment.

## 5. Full test suite — executed myself, raw output cited

Unit:
```
Test Files  18 passed (18)
     Tests  99 passed (99)
```
Integration:
```
Test Files  4 passed (4)
     Tests  19 passed (19)
```
Targeted three-file e2e run (`window-chrome.spec.ts` + `tree-panel.spec.ts` + `view-menu.spec.ts`):
```
57 passed (1.7m)
```
Full e2e suite (all 14 spec files, run in background, raw tail captured):
```
93 passed (2.6m)
[exited with code 0]
```
Zero failures anywhere. No pre-existing suite (`relative-images`, `code-highlighting`, `html-comments`, `external-links`, `open-file-argv`, `live-reload`, `help-menu`, `app-launch`, `file-tree`, `ui-shell`, `drag-drop`) shows any regression from this CSS-only change.

## 6. `.agents/DEVLOG.md` factual accuracy

Read the Task 31 entry in full (`## 2026-08-24 -- Task 31: ...`). Cross-checked its specific numeric/behavioral claims against my own independent reproduction:

- "All five Task 23 drag-to-resize tests failed deterministically ... the moment the base `#main-panel` fix landed" — matches my own fault-injection run (5/6 failed, only the click-vs-drag-disambiguation test unaffected).
- "`mainPanelRect.bottom` came back as `18372.4`" — matches my own independent measurement to the sub-pixel (`18372.400390625`).
- "`window-chrome.spec.ts` 20/20 ... `tree-panel.spec.ts` 30/31 ... 37 ... 57 tests all green" — consistent with my own final counts (57 across the three files, 93 across all fourteen).
- The entry accurately states which specific `(h)` test "happened to already pass against the old CSS" (the tree-panel-hidden left-edge check, since `margin-left: 0` and `left: 0` render identically at exactly `0`) and separately documents having proven that guardrail via a scoped companion-fix-only revert — internally consistent, not a hand-wave.

No inaccuracy found in this entry (contrast with the Task 30 entry's own DEVLOG, which *did* need a correction, applied and clearly marked inline — a real prior instance of this project's stated "verify, don't restate" discipline, still visible in the file today).

## 7. `.agents/specs/backlog.md`

The `[Resolved 2026-08-24]` Task 31 entry accurately narrates the two out-of-scope regressions, the scope amendment, and the fixes — matches the actual diffs verified in section 4.

---

## Findings

**Blocking: 0**

**Should-fix: 0**

**Nit (1):**

- **N-1 — `tree-panel.spec.ts`'s pre-existing Task 26 guardrail #50 test** (`expanding many/ overflows #tree-panel and scrolls internally, without growing the whole page`, line 613) **has reduced/arguably-already-limited discriminating power for its second assertion** (`docScrollHeightAfter <= docScrollHeightBefore + 1`) now that both `#tree-panel` and `#main-panel` are entirely `position: fixed` and out of normal flow — `document.documentElement.scrollHeight` can now barely ever grow regardless of whether `#tree-panel`'s own `overflow-y: auto` is even present. This is **not introduced by this diff** (the test has zero diff and was already passing/unmodified pre-Task-31; `#tree-panel` was already `position: fixed` since Task 26, so the same structural argument likely already applied before this task too), so it is not attributable to this engineer's work and is not a regression this diff caused. Flagged only for the Lead's future awareness, not for Task 31 delivery to be blocked on.

## Summary

All seven functional/behavioral guardrails (#80–86) were independently re-derived against the real diff and the real running app, not restated from the engineer's or the DEVLOG's claims:
- #80/#81/#82 — proven via my own RED→GREEN revert of the `#main-panel` base rule, with a pixel-exact match on the bounding-box figure.
- #83 — proven via direct diff inspection (`#document-container` untouched).
- #84 — proven via my own RED→GREEN fault injection isolating the `z-index: 1` companion fix specifically (5/6 Task 23 tests fail without it, 6/6 pass with it).
- #85 — proven via the `(h)` block's dedicated test plus my own base-rule revert.
- #86 — proven via a full manual read of every test in the `(g)` block plus a repo-wide grep confirming no stale `window.scrollTo`/`window.scrollY` calls remain anywhere in scope.

Full regression suite (93 e2e + 99 unit + 19 integration) is green, executed directly, raw output cited above. Scope contract matches the actual touched-file list exactly. `RUN_LOG.md` correctly untouched by the engineer.

**Overall verdict: PASS.** The Lead may proceed to Step 3 (log run, delete `current_scope.json`).

### Files referenced in this review
- `C:\Source\md-view\.agents\specs\functional_domain.md` (Task 31 section, lines 1955–2060)
- `C:\Source\md-view\.agents\specs\initial_scaffold.md` (Task 31 section, lines 4449–4589)
- `C:\Source\md-view\src\renderer\app.css`
- `C:\Source\md-view\src\renderer\index.html`
- `C:\Source\md-view\tests\e2e\window-chrome.spec.ts`
- `C:\Source\md-view\tests\e2e\tree-panel.spec.ts`
- `C:\Source\md-view\tests\e2e\view-menu.spec.ts`
- `C:\Source\md-view\.agents\DEVLOG.md`
- `C:\Source\md-view\.agents\specs\backlog.md`
- `C:\Source\md-view\.agents\current_scope.json`
- `C:\Source\md-view\.agents\specs\review_report_task30.md` (prior-review consistency check)

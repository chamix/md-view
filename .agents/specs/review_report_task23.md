# Review Report — Task 23: Tree Panel Drag-to-Resize

**Reviewer:** code-reviewer (independent, read-only)
**Date:** 2026-08-20
**Scope reviewed against:** `.agents/specs/functional_domain.md` Task 23 (guardrails #33–#39), `.agents/specs/initial_scaffold.md` Task 23, `.agents/current_scope.json`

## Evidence trail

Commands run directly by this reviewer (raw output captured, not restated from the engineer's self-report):

```
git status --porcelain=v1
git diff --name-only
git diff --stat
git diff -- .agents/specs/functional_domain.md .agents/specs/initial_scaffold.md
git diff -- src/renderer/index.html src/renderer/app.css
git diff -- src/renderer/renderer.js
git diff -- tests/e2e/tree-panel.spec.ts
git diff -- .agents/DEVLOG.md
npx playwright test tests/e2e/tree-panel.spec.ts --reporter=list
```

`git diff --stat` result:
```
 .agents/DEVLOG.md                  |  37 ++++++++++
 .agents/specs/functional_domain.md |  82 +++++++++++++++++++++
 .agents/specs/initial_scaffold.md  | 141 ++++++++++++++++++++++++++++++++++++
 src/renderer/app.css               |  34 ++++++++-
 src/renderer/index.html            |   1 +
 src/renderer/renderer.js           |  26 +++++++
 tests/e2e/tree-panel.spec.ts       | 143 +++++++++++++++++++++++++++++++++++++
 7 files changed, 462 insertions(+), 2 deletions(-)
```

Raw test run output (own execution, not the engineer's):
```
Running 11 tests using 1 worker

  ok  1 …opening a fixture file shows the tree panel… (1.3s)
  ok  2 …clicking an unexpanded folder reveals its children… (1.7s)
  ok  3 …FI-1: exactly one listDirectory call per folder… (guardrail #21) (1.6s)
  ok  4 …clicking a file row updates #content/#status-bar… (1.4s)
  ok  5 …dark mode toggle with a folder expanded to a nested level… (1.5s)
  ok  6 …Task 23…dragging the handle to a mid-range position resizes #tree-panel to match (1.6s)
  ok  7 …Task 23…dragging past MIN_TREE_WIDTH clamps #tree-panel to 180px (1.5s)
  ok  8 …Task 23…dragging past the dynamic max at the default window size… (1.6s)
  ok  9 …Task 23…dragging past the dynamic max at a shrunk (480x640) window… guardrail #34 / FI-2 proof (1.6s)
  ok 10 …Task 23…resized width does not persist -- a fresh relaunch shows the 260px CSS default (3.0s)
  ok 11 …Task 23…dragging the handle does not trigger tree-node click/expand behavior (guardrail #35) (1.5s)

11 passed (19.0s)
```

## Per-item findings

**1. Guardrail #34 — dynamic upper bound recomputed live.**
CONFIRMED, verified by diff hunk in `src/renderer/renderer.js`:
```js
const onMouseMove = (moveEvent) => {
  const maxTreeWidth = window.innerWidth - MIN_MAIN_PANEL_WIDTH;
  const clamped = Math.min(maxTreeWidth, Math.max(MIN_TREE_WIDTH, moveEvent.clientX));
  document.documentElement.style.setProperty('--tree-panel-width', `${clamped}px`);
};
```
`maxTreeWidth` is declared *inside* `onMouseMove`, i.e. recomputed on every `mousemove` event, and reads `window.innerWidth` live. It is not hoisted outside the handler or computed once at `mousedown`. Matches guardrail #34 exactly.

**2. Guardrail #37 — document-level listeners, not hover-scoped.**
CONFIRMED. The `mousedown` handler is attached to `treeResizeHandleEl` (the small handle), but `onMouseMove`/`onMouseUp` are added to `document` inside that handler and removed from `document` inside `onMouseUp`:
```js
document.addEventListener('mousemove', onMouseMove);
document.addEventListener('mouseup', onMouseUp);
...
document.removeEventListener('mousemove', onMouseMove);
document.removeEventListener('mouseup', onMouseUp);
```
No listener is ever attached to the handle element itself for move/up tracking. Matches spec.

**3. Guardrail #38 — whole-document cursor/select lock during drag.**
CONFIRMED. `document.body.classList.add('resizing-tree-panel')` on `mousedown`, `classList.remove(...)` in `onMouseUp`. CSS:
```css
body.resizing-tree-panel {
  cursor: col-resize;
  user-select: none;
}
```
Both properties are present and scoped to `body`, applying document-wide for the drag's duration. Matches spec.

**4. Single-divider decision.**
CONFIRMED via `app.css` diff. `#tree-panel`'s light-mode `border-right: 1px solid #d0d7de;` line was deleted (removed line visible in the diff hunk, not just added-alongside). The dark-mode counterpart `body.dark-mode #tree-panel { border-right-color: #30363d; }` was also fully removed (that block is now just `background: #161b22;`). The new `#tree-resize-handle` (and its `body.dark-mode` counterpart) carries its own gradient-based 1px internal divider line plus a wider 6px hit area, with hover-state color shift in both themes. Exactly one visible divider remains; no double-border regression.

**5. No IPC/main-process involvement, no persistence.**
CONFIRMED by direct grep of the implementation diff: `git diff -- src/renderer/renderer.js src/renderer/index.html src/renderer/app.css | grep -iE "localStorage|ipcRenderer|BridgeApi|IPC_CHANNELS"` returned zero matches. `git diff --name-only` shows no `src/main/**` file touched. This is a pure DOM/CSS/renderer change, matching the spec's explicit "no new main↔renderer IPC contract" and "no persisted state" rules.

**6. Fault-injection plausibility (FI-1 / FI-2) + own test-suite run.**
The spec explicitly instructs the reviewer *not* to re-run the same transient fault injection, only to judge plausibility from the code and independently run the suite. Both done:
- Own full suite run: 11/11 passed (raw output above), including all 6 new Task 23 tests and all 5 pre-existing Task 21 tests.
- Plausibility of FI-1 (delete `Math.min`/`Math.max`): the "past MIN_TREE_WIDTH clamps to 180px" test (`expect(width).toBe(180)`) and both dynamic-max tests assert exact clamped values via strict equality. Removing the clamp would make width track raw `clientX` (or the raw un-clamped subtraction), which would not equal 180/the dynamic max in general — these three tests going RED under that fault is plausible and consistent with the code's structure.
- Plausibility of FI-2 (hardcode `maxTreeWidth = 600`): confirmed via `app.css` that `#main-panel` is `flex: 1 1 auto; min-width: 0;` while `#tree-panel` is `flex: 0 0 auto; width: var(--tree-panel-width)` — i.e. `#tree-panel`'s width is *not* flex-constrained, so forcing it to a fixed 600px in a 480px-wide window would push `#main-panel`'s flex-computed width toward 0 (since `min-width: 0` explicitly permits collapse below content size). The reported "#main-panel collapses toward 0px, proving the fixed cap is unsafe at 480px" is architecturally consistent with the actual CSS, not just asserted.
- Both fault-injection claims are plausible given the real code; the reviewer did not re-execute the fault injection itself (per the task's own instruction), so this is a plausibility judgment, not a re-verification.

**7. The shrunk-window test's live-`innerWidth` adaptation (480 → 467px reality).**
Reviewed the actual test code (`tests/e2e/tree-panel.spec.ts` lines 283–315). The test:
```ts
await electronApp.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows()[0].setBounds({ width: 480, height: 640 });
});
await expect.poll(() => window.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(480);
const innerWidth = await window.evaluate(() => window.innerWidth);
const expectedMaxTreeWidth = innerWidth - 300;
await dragHandleTo(window, innerWidth + 500);
const width = await elementWidth(window, '#tree-panel');
expect(width).toBe(expectedMaxTreeWidth);
```
Judgment: this does **not** weaken the guardrail-#34 proof. It reads the live `window.innerWidth` *after* `setBounds` and *before* the drag, then derives the expected clamp from that same value the production code would read at drag time. Since window size is stable between that read and the drag, this remains a faithful assertion that the clamp equals `live_innerWidth - 300` — the exact behavior guardrail #34 requires. A bug where `maxTreeWidth` were cached at an earlier (pre-shrink, ~900px-window) value would still be caught: the test would expect `~167`, but the buggy code would produce `~600`, failing. This is a legitimate, honest, environment-robustness fix, not a quiet dilution of the test's power — it removes a hardcoded 480px assumption that was already known to be wrong on this OS/Electron combination (documented in DEVLOG) without removing the property under test.

**8. Regression check — 5 pre-existing Task 21 tests untouched.**
CONFIRMED via `git diff -- tests/e2e/tree-panel.spec.ts | grep -n "^-"` — the only `-` line in the entire diff is the diff header itself (`--- a/tests/e2e/tree-panel.spec.ts`). Zero lines were removed or altered inside the original 5 tests; only two new imports (`fs`, `os`, `electron`) and one new constant were added above them, and the new `describe` block was appended below. All 5 pre-existing tests passed in the run above (tests 1–5 in the raw output).

**9. Scope compliance — `.agents/current_scope.json`.**
`in_scope`: `src/renderer/index.html`, `src/renderer/app.css`, `src/renderer/renderer.js`, `tests/e2e/tree-panel.spec.ts`, `.agents/specs/backlog.md`, `.agents/DEVLOG.md`, `.agents/metrics/RUN_LOG.md`.
`git diff --name-only` actual touched files: `.agents/DEVLOG.md`, `.agents/specs/functional_domain.md`, `.agents/specs/initial_scaffold.md`, `src/renderer/app.css`, `src/renderer/index.html`, `src/renderer/renderer.js`, `tests/e2e/tree-panel.spec.ts`.
All code/test/devlog files are within scope. `backlog.md` and `RUN_LOG.md` were not touched, which is allowed (optional, not required). `functional_domain.md` and `initial_scaffold.md` are modified but are **not** in the `in_scope` list — see item 10 below for disposition. No file outside the declared scope (or the two spec files, addressed separately) was written to. `git status --porcelain --untracked-files=all` shows no stray untracked files besides `current_scope.json` itself.

**10. `functional_domain.md` / `initial_scaffold.md` modified but not in scope — sanity check.**
Read both diffs in full (82 and 141 lines respectively). Both are pure prose additions: a new "## Task 23: Tree Panel — Drag-to-Resize" section in each file, containing schema-contract prose, guardrails #33–#39, an Inward Dependency Rule discussion, SOLID scan, Pattern Application rationale, and a worked file-tree diagram — no executable code, no test code, no application logic. This reads exactly as the Lead's own pre-delegation spec-authoring pass (consistent with the CLAUDE.md workflow: Step 0/1 happen before delegation and before `current_scope.json` is written). Plausible and not a scope violation by the engineer. Not flagged as blocking, per the task's own guidance.

## Additional independent checks performed

- Verified `#tree-panel { flex: 0 0 auto; width: var(--tree-panel-width); }` and `#main-panel { flex: 1 1 auto; min-width: 0; }` in `app.css` — confirms the CSS layout genuinely allows `#main-panel` to be crushed when `#tree-panel`'s width is forced too large, which is precisely the failure mode guardrail #34 exists to prevent, and confirms the FI-2 plausibility reasoning above.
- Verified `windowConfig.ts` actually contains `minWidth: 480` — confirms the spec's own cited precedent for the `MIN_MAIN_PANEL_WIDTH`/`MIN_TREE_WIDTH` "named constants" convention claim is accurate, not fabricated.
- Confirmed zero `src/main/**` files appear anywhere in `git diff --name-only`.
- Confirmed no `localStorage`/`ipcRenderer`/`BridgeApi`/`IPC_CHANNELS` reference introduced anywhere in the implementation diff.

## Blocking issues

None found.

## Should-fix

None found.

## Nits

- `#tree-resize-handle`'s hit area is 6px (spec called for "a multi-pixel hit area, not a literal 1px target" — satisfied), with the visible line only 1px within it via a CSS gradient rather than a border — a slightly unusual technique for a divider line, but functionally correct in both themes (verified light + dark gradient rules exist) and not a correctness concern.
- The `mainWidth` assertion in the shrunk-window test (`toBeGreaterThan(280)` against a `MIN_MAIN_PANEL_WIDTH` of 300) has a documented, reasoned 20px slack for the handle's own ~6px footprint plus rounding — reasonable, not a concern.

## Overall verdict: PASS

All nine required verification items were independently checked against actual diff hunks and a self-executed test run (11/11 passing, including all 5 pre-existing Task 21 tests unmodified and all 6 new Task 23 tests). No blocking issues found. Guardrails #33–#39 are all satisfied by the actual code, not merely by the engineer's narration. Scope contract was respected. The one notable deviation from the spec's worked example (live-`innerWidth`-derived expected value instead of a hardcoded 480-based number) was independently judged to strengthen rather than weaken the test's proof of guardrail #34.

---

**Files referenced in this review (absolute paths):**
- `c:\Source\md-view\.agents\specs\functional_domain.md`
- `c:\Source\md-view\.agents\specs\initial_scaffold.md`
- `c:\Source\md-view\.agents\current_scope.json`
- `c:\Source\md-view\src\renderer\index.html`
- `c:\Source\md-view\src\renderer\app.css`
- `c:\Source\md-view\src\renderer\renderer.js`
- `c:\Source\md-view\tests\e2e\tree-panel.spec.ts`
- `c:\Source\md-view\.agents\DEVLOG.md`
- `c:\Source\md-view\src\main\windowConfig.ts`

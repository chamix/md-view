# Independent Code Review — Task 12: Layout Breathing Room, Centered Max-Width Reading Column, Window Minimum Size

Verdict: **BLOCKING ITEMS FOUND — NOT CLEAR TO SHIP**
Blocking findings: 1
Should-fix findings: 1
Nits: 2

Reviewed by: code-reviewer (independent verification layer, read-only tools).
Spec source of truth: `.agents/specs/functional_domain.md` §"Task 12: Layout Breathing Room, Centered Max-Width Reading Column, Window Minimum Size"; `.agents/current_scope.json`.

---

## Evidence trail

### 0. Repo state and scope compliance

`git status --short` (before and after review — identical, confirming no work-tree drift):
```
 M .agents/specs/functional_domain.md
 M src/main/windowConfig.ts
 M src/renderer/app.css
 M tests/e2e/ui-shell.spec.ts
 M tests/integration/window-config.test.ts
?? .agents/current_scope.json
```
`.agents/current_scope.json`'s `in_scope`: `src/renderer/app.css`, `src/main/windowConfig.ts`, `tests/integration/window-config.test.ts`, `tests/e2e/ui-shell.spec.ts`. All four modified files match exactly. `functional_domain.md`'s modification is the Lead's own Step-0/1 spec-authoring (the appended "## Task 12" section) — not an engineer-scope file and not touched by the diffs to the four in-scope files. `.agents/current_scope.json` is untracked scaffolding, not a code change. **Boundary contract: compliant, zero out-of-scope changes.**

Note: the reviewer's task briefing referenced "Reference implementation" and "Test guidance" subsections of the Task 12 spec that do not exist verbatim as separate headers in `functional_domain.md`'s appended Task 12 section (that content lived in the Lead's original task prompt, not the persisted spec file), and `initial_scaffold.md` has no Task 12 entry. This task's Lead instructions explicitly directed appending only to `functional_domain.md` and skipping the Step 1 scaffold append for this already-approved spec, so this is expected for this specific task, not a process defect.

### 1. `src/main/windowConfig.ts` — full diff

```diff
 export const defaultWindowOptions: BrowserWindowConstructorOptions = {
   width: 900,
   height: 640,
+  minWidth: 480,
+  minHeight: 320,
   webPreferences: {
     contextIsolation: true,
     nodeIntegration: false,
```
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` are present, unmodified, byte-identical to pre-diff (unchanged context lines only). **Guardrail #5: PASS.**

### 2. `src/renderer/app.css` — full diff and full-file re-read

```diff
-/* Task 7: UI shell polish — lateral content margin, status bar, empty state.
-   Deliberately simple: no centered max-width reading column (out of scope). */
+/* Task 12: layout breathing room + centered max-width reading column.
+   Reverses Task 7's prior "out of scope" note below — bringing it into
+   scope deliberately, not as an oversight. */
```
Stale Task 7 comment fully replaced, not duplicated. **Guardrail #4: PASS.**

```diff
 #document-container {
-  margin: 1.5rem 2rem 0;
+  width: calc(100% - 4rem);
+  max-width: 54rem;
+  margin: 1.5rem auto 1.5rem;
   border: 1px solid #d0d7de;
   border-radius: 6px;
   overflow: hidden;
 }
 
+#document-main {
+  padding-top: 1.5rem;
+}
+
 #document-header {
```
`width: calc(100% - 4rem); max-width: 54rem; margin: 1.5rem auto 1.5rem` is exactly the explicit-width form the spec mandated. **Guardrail #2 form check: PASS** (see finding B-1 below for a deeper empirical check of *why* this matters and whether the test suite actually protects it).

Top gap = `#document-main { padding-top: 1.5rem }`; bottom gap = `#document-container`'s new `margin-bottom: 1.5rem`. Both exactly `1.5rem`. **Guardrail #3: PASS** (CSS-source verification; see S-1 for a weak test-assertion caveat).

`#content { padding-inline: 2rem; padding-bottom: 2rem; }` and `#frontmatter { margin: 0 2rem; ... }` are byte-identical to pre-diff — unchanged context only. All Task 7/8/11 dark-mode variants likewise untouched. **Guardrail #1: PASS.**

`#empty-state { padding: 2rem; color: #57606a; ... }` shows zero diff, and no new rule references it in combination with `#document-container`. **Guardrail #8: PASS.**

`#document-header` has no `width`/`max-width`/`flex-basis` property anywhere in the file. `index.html` shows zero diff for this task — `#document-header` and `#document-main` remain direct children of `#document-container` (Task 11 structure), inheriting sizing from the constrained parent with no competing constraint. **Guardrail #7: PASS.**

### 3. `tests/integration/window-config.test.ts` — full diff

```diff
+  it('sets minWidth: 480', () => {
+    expect(defaultWindowOptions.minWidth).toBe(480);
+  });
+
+  it('sets minHeight: 320', () => {
+    expect(defaultWindowOptions.minHeight).toBe(320);
+  });
```
Config-object-only assertion — correctly paired with a live e2e check (below) per the spec's own guardrail #6 requirement.

### 4. `tests/e2e/ui-shell.spec.ts` — new assertions (f)/(g)/(h)

```ts
// (f) window min-size clamp
const clampedBounds = await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  win.setBounds({ width: 100, height: 100 });
  const bounds = win.getBounds();
  return { width: bounds.width, height: bounds.height };
});
expect(clampedBounds.width).toBeGreaterThanOrEqual(480);
expect(clampedBounds.height).toBeGreaterThanOrEqual(320);
```
Real `BrowserWindow.setBounds`/`getBounds` on the live running window — not a restatement of `defaultWindowOptions`. Ran in isolation (`npx playwright test tests/e2e/ui-shell.spec.ts --workers=1`): **3 passed** (4.5s), including this test. **Guardrail #6: PASS.**

```ts
// (g) centered max-width reading column
await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  win.setBounds({ width: 1600, height: 900 });
});
...
expect(containerBox.width).toBeLessThan(900);
expect(containerBox.width).toBeGreaterThan(800);
expect(containerBox.marginLeft).toBeCloseTo(containerBox.marginRight, 0);
expect(containerBox.marginLeft).toBeGreaterThan(32);
expect(containerBox.marginRight).toBeGreaterThan(32);
```
Resizes the real window, reads real `getComputedStyle`. Passes in isolation. **However — see B-1: this test does not exercise the specific regression guardrail #2 exists to prevent.**

```ts
// (h) breathing-room spacing
expect(parseFloat(mainPaddingTop)).toBeGreaterThan(0);
expect(parseFloat(containerMarginBottom)).toBeGreaterThan(0);
```
See S-1 — weak assertion, does not pin the mandated `1.5rem` value.

### 5. Full test suite — run directly by the reviewer

`npm run test:unit`: **59 passed (10 files)**
`npm run test:integration`: **9 passed (3 files)** (7 pre-existing + 2 new)
`npm run test:e2e` (4 workers): 1 failure — `live-reload.spec.ts:17` (Windows access-violation-style worker crash, code `3221226505`). Re-ran alone at `--workers=1`: **3 passed**. Confirmed as pre-existing, diff-unrelated parallel-worker flakiness (already documented in the Task 11 review; this file has zero relationship to CSS/window-config and is out of this task's scope). `ui-shell.spec.ts` alone at `--workers=1`: **3 passed**, including all new (f)/(g)/(h) assertions.

Total: 59 + 9 + 20 = **88 tests**, independently reproduced.

### 6. BLOCKING — guardrail #2's regression scenario is not actually protected by test (g)

The spec is explicit that the risk is a *bare* `max-width` + `margin: auto` (no explicit `width`) collapsing the lateral gutter "right at the threshold... a visible regression at today's typical window sizes." An isolated, out-of-repo test page (scratchpad only, never touching a tracked file) rendered both the shipped form and the forbidden form side by side, through the project's own Electron binary via Playwright:

```
at 900px viewport (the app's own default window width, defaultWindowOptions.width):
  good (shipped form, width: calc(100% - 4rem)): marginLeft/Right = 32px  (correct — matches 2rem)
  bad  (bare max-width + margin:auto):           marginLeft/Right = 18px  (degraded, below 2rem)

at 1600px viewport (the width test (g) actually exercises):
  good: marginLeft/Right = 368px
  bad:  marginLeft/Right = 368px   <- IDENTICAL to the correct form
```

This proves: (1) the shipped CSS is genuinely correct — independently confirmed; (2) **test (g) resizes only to 1600px, a regime where the forbidden form and the correct form are indistinguishable.** A future regression back to the bare `max-width: 54rem; margin: auto` form would pass `ui-shell.spec.ts` (g) undetected, because it is never exercised at or near the 864-928px boundary, nor at the app's own default 900px window size.

**Recommended fix:** add an assertion in `ui-shell.spec.ts` at a width in the 864-928px band (e.g. the app's own default 900px) asserting `marginLeft`/`marginRight` are each `~32px` (2rem), not merely `> 0` or `> 32`. This is the only width regime that actually discriminates the correct implementation from the forbidden one.

### 7. Should-fix — guardrail #3's `1.5rem` value is not pinned by test (h)

`expect(parseFloat(mainPaddingTop)).toBeGreaterThan(0)` and `expect(parseFloat(containerMarginBottom)).toBeGreaterThan(0)` would also pass for e.g. `0.25rem` or `3rem`. Actual shipped CSS values are correct (confirmed above), so not a functional defect today, only a weak regression guard. Mirrors an already-accepted pattern in this codebase (Task 11's review accepted an identical `>0` check for `#content`'s padding-inline) — not escalated to Blocking, but worth tightening alongside the B-1 fix, e.g. `expect(parseFloat(mainPaddingTop)).toBeCloseTo(24, 0)`.

### 8. Regression risk elsewhere

`view-menu.spec.ts` untouched and unaffected (confirmed via full suite run). `renderer.js` and everything under `src/main/**` besides `windowConfig.ts` show zero diff. No regression risk outside the CSS/window-config surface this task targets.

---

## Findings

### Blocking

- **B-1** — `tests/e2e/ui-shell.spec.ts` test (g) does not actually protect guardrail #2. It only resizes to 1600px, a regime where the mandated `width: calc(100% - 4rem)` form and the explicitly forbidden bare `max-width + margin: auto` form produce byte-identical computed output (368px/368px margins either way — empirically verified). The shipped CSS is correct today, but the regression this guardrail exists to prevent — gutter collapsing toward 0 as window width approaches ~900px, the app's own default size — is invisible to the current test suite. Route back to `full-stack-engineer`: add an e2e assertion at a width in the 864-928px band (or the app's literal 900px default) pinning `marginLeft`/`marginRight` to exactly 2rem (32px), not merely `> 0` or `> 32`.

### Should-fix

- **S-1** — `tests/e2e/ui-shell.spec.ts` test (h) asserts `mainPaddingTop > 0` and `containerMarginBottom > 0`, not the mandated exact `1.5rem` (24px). The shipped value is correct, but the test would not catch a regression to any other positive value. Tighten to `toBeCloseTo(24, 0)` or equivalent when B-1 is addressed in the same pass.

### Nits

- **N-1** — The Task 11-era comment directly above `#document-container` ("the outer margin here is an additive layer...") is now slightly stale — the rule gained `width`/`max-width` this task but the comment wasn't updated to mention centering. Not a guardrail violation, purely a documentation-freshness nit.
- **N-2** — Reviewer's task briefing referenced spec subsections not persisted verbatim in `functional_domain.md`, and `initial_scaffold.md` has no Task 12 entry. Expected per this task's specific Lead instructions (append only to `functional_domain.md`, skip Step 1 scaffold append for this pre-approved spec) — not a process defect, not an engineer defect.

---

## Test quality assessment

Guardrails #5 and #6 are protected by genuine, live-process assertions, not tautological. Guardrail #2's implementation is correct and independently verified through an isolated, real-renderer measurement outside the repo, but the *delivered regression test* for it (test g) is not meaningful at the boundary that matters (B-1). Guardrail #3's test (h) is present but weak (S-1), with accepted precedent elsewhere in this codebase.

## Regression risk

Low outside the B-1 gap. Diff touches only `windowConfig.ts` (additive keys, security trio unchanged) and `app.css` (additive/restructured rules, everything else untouched context). All 88 tests pass except the known, previously-documented, diff-unrelated `live-reload.spec.ts` parallel-worker flake (passes in isolation).

---

## Files reviewed (absolute paths)

- C:\Source\md-view\.agents\specs\functional_domain.md
- C:\Source\md-view\.agents\specs\initial_scaffold.md (checked for Task 12 entry — absent, expected per this task's instructions)
- C:\Source\md-view\.agents\current_scope.json
- C:\Source\md-view\src\main\windowConfig.ts
- C:\Source\md-view\src\renderer\app.css
- C:\Source\md-view\src\renderer\index.html (zero-diff verification)
- C:\Source\md-view\tests\e2e\ui-shell.spec.ts
- C:\Source\md-view\tests\integration\window-config.test.ts
- C:\Source\md-view\package.json

Scratch/probe artifacts used for the section-6 empirical CSS measurement lived entirely under the session scratchpad directory, never inside the repository; `git status --short` before and after review is identical, confirming zero working-tree contamination.

---

**Verdict summary: BLOCKING ITEM OPEN — NOT CLEAR TO SHIP.** 1 Blocking (B-1: guardrail #2's own regression is untested at the boundary where it actually manifests), 1 Should-fix (S-1: guardrail #3's test is weaker than the spec's exact-value mandate), 2 Nits. Guardrails #1, #4, #5, #6, #7, #8 verified PASS with direct evidence. Guardrail #2's underlying implementation is correct and independently confirmed, but its regression test does not prove what it needs to prove.

---

## Re-review (Blocking-fix verification)

Verdict: **BLOCKING ITEMS RESOLVED — CLEAR TO SHIP**

Independently reproduced by: code-reviewer (read-only tools; all file edits described below were transient shell-level probes for verification purposes only, fully reverted before this report was finalized).

Scope of this pass: verify the engineer's narrowly-scoped, test-only fix to `tests/e2e/ui-shell.spec.ts` actually closes B-1 (max-width regression test doesn't discriminate correct vs. forbidden CSS form) and S-1 (breathing-room assertions too weak). `src/renderer/app.css` and `src/main/windowConfig.ts` were confirmed to have zero additional diff since the first-pass review — only the test file changed.

### 0. Diff-scope confirmation

`git diff --name-only`:
```
.agents/specs/functional_domain.md
src/main/windowConfig.ts
src/renderer/app.css
tests/e2e/ui-shell.spec.ts
tests/integration/window-config.test.ts
```
Identical to the file set reviewed in the first pass. `git diff src/main/windowConfig.ts` and `git diff src/renderer/app.css` reproduced byte-for-byte the same hunks already quoted and verified in sections 1–2 of the first-pass report above (the `minWidth: 480`/`minHeight: 320` addition, and the `width: calc(100% - 4rem); max-width: 54rem; margin: 1.5rem auto 1.5rem;` + `#document-main { padding-top: 1.5rem; }` rules). **Confirmed: only `tests/e2e/ui-shell.spec.ts` changed since the first-pass review.**

### 1. `tests/e2e/ui-shell.spec.ts` diff — read in full

`git diff tests/e2e/ui-shell.spec.ts` (relevant excerpt):

```diff
+  const documentContainer = window.locator('#document-container');
+
+  // (g) Task 12: default-width discrimination check. ...
+  // Explicitly re-assert the window
+  // bounds first, since the clamp check above (f) already moved the live
+  // window to its clamped 480x320 size.
+  await app.evaluate(({ BrowserWindow }) => {
+    const win = BrowserWindow.getAllWindows()[0];
+    win.setBounds({ width: 900, height: 640 });
+  });
+  await window.waitForTimeout(100);
+
+  const defaultWidthBox = await documentContainer.evaluate((el) => {
+    const style = window.getComputedStyle(el);
+    return {
+      marginLeft: parseFloat(style.marginLeft),
+      marginRight: parseFloat(style.marginRight),
+    };
+  });
+  expect(defaultWidthBox.marginLeft).toBeGreaterThanOrEqual(31);
+  expect(defaultWidthBox.marginLeft).toBeLessThanOrEqual(33);
+  expect(defaultWidthBox.marginRight).toBeGreaterThanOrEqual(31);
+  expect(defaultWidthBox.marginRight).toBeLessThanOrEqual(33);
```

Confirms the engineer's claim precisely:
- The new check explicitly calls `win.setBounds({ width: 900, height: 640 })` **before** measuring — correctly re-establishing the app's own default window size after test (f)'s earlier clamp probe left the live window at 480x320. This was the exact re-bounds concern flagged in the task brief, and it is handled (with a `waitForTimeout(100)` for layout settle, matching the pattern already used at the pre-existing 1600px check).
- The band `[31, 33]` sits strictly between the forbidden form's ~18px and the correct form's ~32px (per B-1's own empirical math), so it discriminates correctly on both sides with margin to spare.
- The pre-existing 1600x900 max-width-cap assertions (now relabeled test `(h)` in the diff, was `(g)` in the first pass) are present unchanged, confirmed via diff context — additive only, nothing removed.
- The `(i)` block tightens `mainPaddingTop`/`containerMarginBottom` from `toBeGreaterThan(0)` to `toBeCloseTo(24, 0)` for both assertions.

### 2. Reproducing the RED/GREEN proof myself

Backed up the current (uncommitted, working-tree) `src/renderer/app.css` to the session scratchpad first (`app.css.backup`, plus a saved `git diff` snapshot for later comparison), then edited `#document-container` via a scripted, exact-match string replace (Node one-liner, asserting exactly one match) to remove the explicit `width: calc(100% - 4rem)` line, leaving the forbidden bare form:

```css
#document-container {
  max-width: 54rem;
  margin: 1.5rem auto 1.5rem;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  overflow: hidden;
}
```

Note: this repo's e2e suite runs against `dist/renderer/app.css` (a build artifact copied by `npm run build`), not `src/renderer/app.css` directly, so `npm run build` was re-run after the edit to propagate the change before testing — otherwise the probe silently measures stale output (verified this the hard way: the first attempt without rebuilding produced a false "3 passed").

`npx playwright test tests/e2e/ui-shell.spec.ts --workers=1` against the forbidden form:

```
1) tests\e2e\ui-shell.spec.ts:67:5 › argv launch: empty-state disappears, status bar shows the real absolute path

    Error: expect(received).toBeGreaterThanOrEqual(expected)

    Expected: >= 31
    Received:    10.4

      151 |   expect(defaultWidthBox.marginLeft).toBeGreaterThanOrEqual(31);

  1 failed
    tests\e2e\ui-shell.spec.ts:67:5 › argv launch: empty-state disappears, status bar shows the real absolute path
  2 passed (4.5s)
```

This is an **exact match** to the engineer's claimed RED evidence (`Expected: >= 31, Received: 10.4`). **B-1 confirmed closed: the new test genuinely fails on the forbidden CSS form.**

Reverted the probe by restoring the backed-up `app.css` verbatim, then diffed the restored `git diff src/renderer/app.css` against the pre-probe snapshot saved earlier — **byte-identical**, confirming a clean, exact revert (not just "close enough"). Rebuilt (`npm run build`) and re-ran `npx playwright test tests/e2e/ui-shell.spec.ts --workers=1`: **3 passed** (4.7s), confirming GREEN on the real, correct CSS.

I did not separately probe the `padding-top: 0.2rem` regression the engineer described for S-1 (the `(i)` assertion), since the assertion code itself (`toBeCloseTo(24, 0)`, confirmed present in the diff below) is unambiguous and mechanically must fail for any value outside roughly [23.5, 24.5]px — a `0.2rem` (3.2px) value is trivially far outside that band. Treating the code-level confirmation as sufficient given B-1's live-process probe already validates the harness end-to-end.

### 3. S-1 tightened-assertion confirmation

```diff
+  expect(parseFloat(mainPaddingTop)).toBeCloseTo(24, 0);
+  expect(parseFloat(containerMarginBottom)).toBeCloseTo(24, 0);
```
Present exactly as claimed, replacing the prior `toBeGreaterThan(0)` checks. `toBeCloseTo(24, 0)` uses Jest/Vitest-style rounding-based precision (precision `0` means the difference must round to 0 at the given decimal place, i.e. `< 0.5` — a materially tighter bound than the removed `> 0` check, and correctly pinned to the spec's mandated 1.5rem = 24px value at the default 16px root font size). **S-1 confirmed closed.**

### 4. Full test suite — run directly by this reviewer

`npm run test:unit`:
```
Test Files  10 passed (10)
     Tests  59 passed (59)
```

`npm run test:integration`:
```
Test Files  3 passed (3)
     Tests  9 passed (9)
```

`npm test` (canonical full suite: unit + integration + `npm run build && playwright test`, 4 workers):
```
Test Files  10 passed (10)   [unit: 59 tests]
Test Files  3 passed (3)     [integration: 9 tests]
Running 20 tests using 4 workers
  20 passed (21.0s)
```

Total: **59 + 9 + 20 = 88 tests, all passing**, independently reproduced end-to-end (no parallel-worker flake observed on this run, unlike the pre-existing `live-reload.spec.ts` flake noted in the first pass — not a regression, just non-deterministic and not reproduced this time).

### 5. Work-tree cleanliness — no stray probe artifacts left behind

`git status --short` at the end of this re-review:
```
 M .agents/specs/functional_domain.md
 M src/main/windowConfig.ts
 M src/renderer/app.css
 M tests/e2e/ui-shell.spec.ts
 M tests/integration/window-config.test.ts
?? .agents/current_scope.json
?? .agents/specs/review_report_task12.md
```
Identical, entry-for-entry, to the `git status --short` captured at the very start of this re-review session, before any probing began. `dist/` and `test-results/` (touched by the rebuild-and-test cycles above) are both listed in `.gitignore` and do not appear in `git status`. **Confirmed: the working tree is exactly as found, with the temporary probe edit to `src/renderer/app.css` fully and verifiably reverted (diff-identical, not just visually similar).**

---

## Findings (re-review)

### Blocking
None open.

- **B-1 — RESOLVED.** The new `(g)` assertion in `tests/e2e/ui-shell.spec.ts` resizes the live window to the app's own default 900x640 (after explicitly re-setting bounds past the earlier 480x320 clamp probe) and asserts `marginLeft`/`marginRight` are in `[31, 33]`px — a band that sits strictly between the forbidden form's empirically-measured ~18px (this review measured 10.4px on the real rendered CSS, consistent with the forbidden form's degraded gutter) and the correct form's ~32px. Independently reproduced RED (fails on forbidden CSS, exact match to engineer's claimed `Received: 10.4`) and GREEN (passes on correct CSS) with the working tree left byte-identical to before the probe.

### Should-fix
None open.

- **S-1 — RESOLVED.** `mainPaddingTop`/`containerMarginBottom` assertions tightened from `toBeGreaterThan(0)` to `toBeCloseTo(24, 0)`, confirmed present in the diff and mechanically equivalent to a `< 0.5` tolerance band around the spec-mandated 24px (1.5rem) value.

### Nits (carried over, unaddressed — non-blocking, unchanged from first pass)
- **N-1** — Stale Task-11-era comment above `#document-container` doesn't mention centering (documentation freshness only).
- **N-2** — Spec-file structural nit from the first pass, not applicable to this test-only fix.

---

## Test quality assessment (re-review)

The `(g)` assertion is now a genuine, discriminating regression test — not tautological. It measures real `getComputedStyle` output from a live Electron `BrowserWindow` at the exact width where the mandated and forbidden CSS forms diverge, which this review confirmed empirically by reproducing both the failure and the recovery. The `(i)` breathing-room assertions are now pinned to the spec's exact mandated values rather than merely asserting non-zero. No new tautological patterns introduced.

## Regression risk (re-review)

None beyond what was already assessed as low in the first pass. The fix is additive/tightening-only within a single test file; `src/renderer/app.css` and `src/main/windowConfig.ts` are unchanged since the already-verified first pass. Full 88-test suite passes cleanly.

---

## Files reviewed in this re-review pass (absolute paths)

- C:\Source\md-view\.agents\specs\review_report_task12.md (read in full before appending)
- C:\Source\md-view\tests\e2e\ui-shell.spec.ts (diff read in full; probe-tested live)
- C:\Source\md-view\src\renderer\app.css (diff-confirmed unchanged from first pass; temporarily probe-edited and exactly reverted for verification, per task instructions)
- C:\Source\md-view\src\main\windowConfig.ts (diff-confirmed unchanged from first pass)
- C:\Source\md-view\package.json (build/test script wiring, to correctly reproduce the RED/GREEN proof against `dist/renderer/app.css`)
- C:\Source\md-view\.gitignore (confirmed `dist`/`test-results` excluded, explaining their absence from `git status` after rebuilds)

---

**Re-review verdict: BLOCKING ITEMS RESOLVED — CLEAR TO SHIP.** Both B-1 and S-1 independently reproduced as fixed, with RED/GREEN proof matching the engineer's claims exactly. Full 88-test suite (59 unit + 9 integration + 20 e2e) passes. Working tree confirmed clean and identical to its pre-review state. No new blocking or should-fix findings introduced by this change.

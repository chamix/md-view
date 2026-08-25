# Independent Review Report — Task 30 (Title Bar Scrolls Away With Long Documents)

**Verdict: PASS — 0 Blocking / 2 Should-fix / 0 Nits**

## Evidence Trail

### 1. Scope compliance (`git diff --name-only` vs `.agents/current_scope.json`)

```
.agents/DEVLOG.md
.agents/specs/functional_domain.md
.agents/specs/initial_scaffold.md
src/renderer/app.css
tests/e2e/window-chrome.spec.ts
```

`.agents/current_scope.json` (untracked, present, unmodified by the engineer):
```json
{
  "task": "Fix: title bar scrolls away with long documents (Task 30)",
  "spec_section": "functional_domain.md Task 30 (guardrails #75-79); initial_scaffold.md Task 30",
  "in_scope": [
    "src/renderer/app.css",
    "tests/e2e/window-chrome.spec.ts",
    ".agents/specs/backlog.md",
    ".agents/DEVLOG.md",
    ".agents/metrics/RUN_LOG.md"
  ]
}
```

`app.css`, `window-chrome.spec.ts`, and `DEVLOG.md` are all in the declared scope. `functional_domain.md`/`initial_scaffold.md` are modified but *not* listed — verified via `git diff` that both are **pure append-only additions** (`grep -E '^-[^-]'` on both diffs returns empty, no deletions/edits of existing content), consistent with these being the Lead's own Step 0/1 spec-authoring work product written *before* the scope manifest was created (not an engineer scope violation — the manifest governs the engineer's delegated edits, and the engineer touched none of these two files beyond what's already reflected as pre-existing at delegation time). `.agents/specs/backlog.md` was granted but left untouched — no pending backlog entry required this closure. `.agents/metrics/RUN_LOG.md` has **zero diff** (`git diff -- .agents/metrics/RUN_LOG.md` empty) — correctly left for the Lead's Step 3, not touched by the engineer. No changes anywhere in `src/main/**`, `src/renderer/*.js`, or `src/preload/**` — guardrail #79 satisfied.

### 2. `git diff -- src/renderer/app.css` — matches spec exactly

```diff
 #title-bar {
+  position: fixed;
+  top: 0;
+  left: 0;
+  right: 0;
+  z-index: 10;
   display: flex;
   flex-direction: row;
   ...
 #app-body {
   display: flow-root;
+  margin-top: var(--title-bar-height);
 }
```

Confirmed via direct read of `src/renderer/app.css` (lines 15-29, 186-189) that every pre-existing declaration on both rules (`display/flex/height/background/border/drag/user-select` on `#title-bar`; `display: flow-root` on `#app-body`) is untouched. `--title-bar-height` is defined exactly once at `:root` (line 173) and reused verbatim at lines 188 (new), 199, 220 (`#tree-panel`/`#tree-resize-handle`, pre-existing) — no second constant introduced. `git diff --stat -- src/renderer/app.css` shows `6 insertions(+), 0 deletions` — this is the only content change in the file. Guardrail #79 (single-file, two-rule fix) confirmed.

### 3. Test suite — actually executed, not trusted

Full command run myself:
```
npx playwright test tests/e2e/window-chrome.spec.ts tests/e2e/tree-panel.spec.ts --reporter=line
...
48 passed (1.6m)
```
(17 tests in `window-chrome.spec.ts`, 31 in `tree-panel.spec.ts` — matches the DEVLOG's claimed 17/17 and 31/31.)

### 4. RED→GREEN reproduction — done independently, not assumed

I stashed only the `app.css` hunk (`git stash push -- src/renderer/app.css`), rebuilt (`npm run build`, which copies `app.css` into `dist/`), and reran just the new `(g)` block:

```
npx playwright test tests/e2e/window-chrome.spec.ts -g "Task 30 regression" --reporter=line
```

**Result with the CSS fix reverted: 2 failed / 4 passed**, not 3 failed as the DEVLOG claims (see Should-fix #1 below):
- `title-bar geometry is unchanged after scrolling the document to its end` — **FAILED**, `y: -17789.6` vs. expected `y: 0` (title bar scrolled off-screen, exactly the reported bug).
- `#tree-panel geometry stays correct relative to #title-bar while the document is scrolled` — **FAILED**, off by `9213.6px` (`#tree-panel` stayed pinned; `#title-bar` moved).
- `#app-body content starts exactly --title-bar-height below #title-bar with no gap or overlap (static layout, scroll position 0)` — **PASSED even pre-fix.** This is expected and correct: at scroll position 0, pre-fix `#title-bar` (normal flow) naturally sits directly above `#app-body` in document flow with no fix needed for that specific geometric relationship — that coincidence is literally the "accidental byproduct" the bug report itself describes. This test genuinely guards a *different, real* regression (someone making `#title-bar` fixed again in the future without the compensating `margin-top`), it just isn't a RED-phase discriminator for *this* historical bug.
- The 3 button/menu functional tests passed pre-fix too, consistent with the DEVLOG's own honest explanation (Playwright's auto-scroll-into-view before `.click()` masks the positioning bug for those specific assertions).

I then restored the fix (`git stash pop`), rebuilt, and reran: **6/6 passed**. Full `window-chrome.spec.ts` + `tree-panel.spec.ts` also reconfirmed **48/48 passed** after restoration. Working tree is back to its original state (`git status --short` shows only the five expected modified files + the untracked scope manifest).

### 5. Guardrail-by-guardrail assessment

- **#75 (title-bar rect invariant under scroll).** Not vacuous: the test polls `window.scrollY` to confirm the scroll actually occurred before comparing `boundingBox()` snapshots, and I independently proved it's a real discriminator (RED without the fix, with the exact off-screen `y` value expected).
- **#76 (all six interactive elements stay functionally live, not just visually present).** Verified by direct comparison of the new `(g)` tests against the original `(b)`/`(d)` blocks (`window-chrome.spec.ts` lines 80-117, 204+): both check the same real underlying facts — `BrowserWindow.getAllWindows()[0].isMinimized()/isMaximized()` and the actual `Menu.buildFromTemplate()` item-id list via the same monkey-patch-and-capture technique — at a non-zero scroll position. Not weakened to a visual-only check.
- **#77 (no gap/overlap between `#app-body` and `#title-bar`) — scrutinized in depth.** The engineer scoped this check to scroll position 0 only, with a comment arguing a viewport-space "no gap" check is physically nonsensical at scroll > 0 because `#app-body` is deliberately normal-flow scrolling content (Task 12's design). **I independently derived and confirm this reasoning is correct, not merely accepted on faith:** since `#title-bar` is `position: fixed`, its `rect.bottom` is constant `= title-bar-height` at every scroll position `S`. Since `#app-body` is normal-flow, its viewport-space `rect.top(S) = documentTop − S`. The "no gap" condition `rect.top(S) ≈ title-bar-height` therefore only holds at `S = 0`; asserting it at any `S > 0` would fail even in a *correct* implementation, because content is supposed to scroll up and out of view beneath the fixed title bar. I also checked the task prompt's suggested alternative — a document-relative invariant (`rect.top + scrollY = constant`) tested across multiple scroll positions — and confirmed it would be **tautological**: `getBoundingClientRect().top = documentTop − window.scrollY` is an identity of the browser's own scroll math, true for *any* static element regardless of whether its `margin-top` is correct, wrong, or absent entirely (it would just yield a different, still-constant, value). Such a test would not discriminate a correct fix from a broken one at any `S`, so it would add no real coverage. **Conclusion: the engineer's scroll-0-only scoping is the only physically meaningful interpretation of guardrail #77, correctly proven, not a shortcut.** The spec's own literal "at every scroll position" wording is imprecise when applied to a fixed-vs-normal-flow pair (it is only literally satisfiable for the fixed-vs-fixed pairs in #75/#78) — flagged as Should-fix #2, directed at spec wording, not at the delivered code.
- **#78 (`#tree-panel` reconfirmed under real scroll).** This is a genuine new regression check, not a restatement of test (a)'s scroll-0 check — test (a) (`window-chrome.spec.ts` lines 44-59) only ever asserted this relationship at scroll 0; the new test in block (g) asserts it after `scrollTo(scrollHeight/2)` with a `scrollY > 0` poll gate first, and I independently proved it fails pre-fix (9213px off) and passes post-fix. Confirmed non-tautological.
- **#79 (single-file CSS fix).** Confirmed above via `git diff --name-only` / `--stat`.

### 6. DEVLOG.md accuracy check (`git diff -- .agents/DEVLOG.md`)

The new entry is largely accurate and admirably honest about the mid-cycle test-design correction (swapping `#main-panel` → `#app-body`, scoping to scroll 0) and about the Playwright auto-scroll masking. However, one claim does not hold up against my own reproduction — see Should-fix #1 below.

## Should-fix (non-blocking)

1. **DEVLOG.md Task 30 entry overstates the RED-phase count.** It states: *"Written and run against the unmodified CSS first: 3 of 6 new tests went RED for the expected reason before the fix"*, listing as one of the three: *"`#main-panel`/`#title-bar` gap check: off by ~24px (this iteration of the check was later corrected — see below)"*. My independent revert-and-rerun of the actual, final six `(g)` tests shows **only 2 of 6 go RED** against the reverted CSS (`title-bar geometry is unchanged...` and `#tree-panel geometry stays correct...`); the delivered `#app-body content starts exactly...` test **passes** even with the CSS fix reverted, because at scroll position 0 the pre-fix normal-flow layout already happened to place `#app-body` flush against `#title-bar` (see evidence in §4/§5 above). The "3 of 6" bullet is describing a RED result from an earlier, superseded draft of the test (the `#main-panel`-based version, later swapped for `#app-body`) — that draft no longer exists in the delivered file, so attributing it as one of "3 of 6 new tests" (i.e., one of the current six) is factually inaccurate on a literal read, even though the entry does parenthetically flag that iteration as "later corrected." This is exactly the class of devlog-precedent inaccuracy this project's own history (Task 17/26 devlog corrections, cited in the review task) has caught before. Recommend the Lead route a small DEVLOG wording correction back (e.g., "2 of the 6 final tests discriminate the bug directly; a since-superseded draft of a third test also caught a related, now-resolved measurement issue during design").
2. **Guardrail #77's spec wording ("at every scroll position") is imprecise for a fixed-vs-normal-flow relationship** and should be tightened in a future spec pass to distinguish fixed-to-fixed invariants (#75/#78, genuinely true at every scroll position) from fixed-to-normal-flow, resting-state-only invariants (#77, only meaningful at scroll 0, as derived independently in §5 above). This is a spec-clarity note for the Lead's own bibliography discipline, not a defect in the delivered code — the engineer's implementation and comment reasoning are correct as verified.

## Nits

None.

## Files reviewed

- `C:\Source\md-view\.agents\specs\functional_domain.md` (Task 30 section, lines 1885-1953)
- `C:\Source\md-view\.agents\specs\initial_scaffold.md` (Task 30 section, lines 4367-4446)
- `C:\Source\md-view\.agents\current_scope.json`
- `C:\Source\md-view\src\renderer\app.css`
- `C:\Source\md-view\tests\e2e\window-chrome.spec.ts`
- `C:\Source\md-view\.agents\DEVLOG.md` (new Task 30 entry)
- `C:\Source\md-view\.agents\specs\backlog.md`
- `C:\Source\md-view\tests\e2e\fixtures\long-document.md`

**Overall verdict: PASS.** No Blocking findings. The CSS fix is minimal, correct, and matches the spec's exact shape; the new test coverage genuinely discriminates the bug for 2 of the 6 new tests (independently reproduced RED→GREEN), and the remaining 4 are legitimate functional/regression coverage, honestly characterized as such. The two Should-fix items are documentation-accuracy/spec-wording issues, not code or test defects, and do not block delivery.

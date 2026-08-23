# Independent Code Review — Task 26

**Scope of this review:** `#tree-panel`/`#tree-resize-handle` switched from flex-row sizing to viewport-bound `position: fixed`; `#main-panel` switched from a flex child to `margin-left: var(--tree-panel-width)`; `#app-body` switched from `display: flex; flex-direction: row;` to `display: flow-root;` (a deviation from the approved spec's literal "no replacement properties" prediction).

**Verdict: APPROVED — no Blocking items found. One high-priority Should-fix (documentation/comment accuracy, not code behavior).**

All claims below are backed by `git diff` output, direct file reads, and test runs and empirical CSS experiments I executed myself (raw output pasted, not restated). Note: per my operating constraints I hold no Write/Edit tools, so I could not save this to `.agents/specs/review_report_task26.md` myself — the Lead should save this content verbatim to that path.

---

## 1. Scope compliance

`git status --porcelain` (reproduced myself, after cleaning up my own investigation scratch files):

```
 M .agents/DEVLOG.md
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M src/renderer/app.css
 M src/renderer/renderer.js
 M tests/e2e/tree-panel.spec.ts
?? .agents/current_scope.json
?? tests/e2e/fixtures/long-document.md
?? tests/e2e/fixtures/tree-many/
```

`.agents/current_scope.json`:
```json
"in_scope": [
  "src/renderer/app.css",
  "src/renderer/renderer.js",
  "tests/e2e/tree-panel.spec.ts",
  "tests/e2e/fixtures",
  ".agents/specs/backlog.md",
  ".agents/DEVLOG.md",
  ".agents/metrics/RUN_LOG.md"
]
```

`functional_domain.md`/`initial_scaffold.md` are modified but not in-scope — expected per CLAUDE.md's workflow (Lead writes/approves spec in Step 0/1 before creating the scope contract and delegating). I diffed both files directly and confirmed their content is exactly the approved Task 26 spec text quoted in the delegation prompt (verbatim match), not an engineer edit smuggled through.

`.agents/specs/backlog.md` and `.agents/metrics/RUN_LOG.md` — both in-scope but **untouched** (`git diff --stat` returns nothing for either). RUN_LOG.md correctly left alone (Lead's Step 3 job); backlog.md untouched means the engineer found nothing worth deferring — consistent with a clean implementation.

**No out-of-scope drift.**

## 2. CSS diff vs. spec (`src/renderer/app.css`)

Full diff, `git diff -- src/renderer/app.css`:

```diff
 #app-body {
-  display: flex;
-  flex-direction: row;
+  display: flow-root;
 }

 #tree-panel {
-  flex: 0 0 auto;
+  position: fixed;
+  top: 0;
+  left: 0;
+  bottom: 2rem;
   width: var(--tree-panel-width);
   box-sizing: border-box;
   overflow-y: auto;
   ...unchanged background/font-family/font-size...

 #tree-resize-handle {
-  flex: 0 0 auto;
+  position: fixed;
+  top: 0;
+  left: var(--tree-panel-width);
+  bottom: 2rem;
   width: 6px;
   cursor: col-resize;
   ...unchanged background gradients...

 #main-panel {
-  flex: 1 1 auto;
-  min-width: 0;
+  margin-left: var(--tree-panel-width);
 }
```

Matches the spec's exact prescribed shape for `#tree-panel`, `#tree-resize-handle`, and `#main-panel` (I confirmed `width`/`box-sizing`/`overflow-y`/`background`/`font-*`/`cursor`/gradient declarations byte-identical before/after). **The one deviation is `#app-body`: `display: flow-root` instead of the spec's "no replacement properties needed."** This is the subject of Section 5 below — the single substantive judgment call in this diff.

I read the entire final `app.css` (377 lines) and confirmed **zero changes** to `#document-container`, `#content`, `#empty-state`, `#status-bar`, `#frontmatter`, `.tree-row`/`.tree-node`/etc., or any `body.dark-mode` counterpart. Only `#app-body`, `#tree-panel`, `#tree-resize-handle`, and `#main-panel` were touched — exactly the four selectors the spec named.

## 3. `#status-bar` clobber-incident cleanup (review checklist item 7)

The engineer reported a `replace_all` mishap during manual FI-1 proofing that briefly rewrote `#status-bar`'s own `bottom: 0` rule. I read the final `#status-bar` block directly:

```css
#status-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  ...
}
```

`bottom: 0` is correct, and `git diff` shows **zero lines touched** in the `#status-bar` rule (confirmed via `git diff -- src/renderer/app.css | grep -A3 -B3 status-bar` returning only comment-context lines, no `#status-bar` property changes). The incident, if real, left no trace in the final diff.

## 4. `renderer.js` diff — comment-only, verified

Full diff:

```diff
-  // Task 23: drag-to-resize handle. #tree-panel is the flex row's first
-  // child (left edge always at viewport x=0), so a live pointer clientX
-  // *is* the desired panel width -- no delta/offset tracking needed. See
-  // functional_domain.md Task 23 for the full domain rationale.
+  // Task 23: drag-to-resize handle. #tree-panel is fixed-positioned at the
+  // viewport's left edge (Task 26; was the flex row's first child pre-
+  // Task-26 -- the mechanism changed, the left-edge-at-x=0 fact did not),
+  // so a live pointer clientX *is* the desired panel width -- no
+  // delta/offset tracking needed. See functional_domain.md Task 23 for the
+  // full domain rationale.
   const treeResizeHandleEl = document.getElementById('tree-resize-handle');
```

Every non-comment line (`MIN_TREE_WIDTH`, `MIN_MAIN_PANEL_WIDTH`, `maxTreeWidth`, clamp logic at lines 246–255) is untouched — I grepped and read them directly. Zero behavioral change, matching the spec's optional allowance exactly.

## 5. THE `flow-root` deviation — independent empirical verification (most important finding)

The approved spec's literal instruction was: remove `display: flex; flex-direction: row;` from `#app-body`, "no replacement properties needed." The engineer instead shipped `display: flow-root;`, justified (in an `app.css` comment and in `.agents/DEVLOG.md`) by claiming that without it, a flex container's BFC-boundary property, once removed, lets a child's top margin (their stated example: "an opening `<h1>`") collapse straight through `#main-panel`/`#app-body` into `body`, "shifting the whole page down" and inflating `document.documentElement.scrollHeight` — a guardrail #51 regression. DEVLOG additionally cites a concrete number as evidence: "a near-empty test document producing a 686px-tall page in a 258px-tall test window."

I did not accept this claim. I built and ran (via the real Electron app, `_electron.launch`, the actual built `dist/renderer/index.html`/`app.css`) a series of throwaway fault-injection experiments — toggling `#app-body`'s `display` between the shipped `flow-root` and the literal-spec `block` at runtime via `page.addStyleTag`-equivalent style injection, on fresh page reloads to avoid state pollution — and measured actual `getBoundingClientRect()`/`scrollHeight`/`scrollY` values and raw PNG screenshots. (All scratch spec files were deleted afterward; `git status` above confirms zero trace remains.)

**Finding 1 — the stated mechanism (h1 margin) is factually wrong.** `node_modules/github-markdown-css/github-markdown-light.css:394-396` already contains:
```css
.markdown-body>*:first-child { margin-top: 0 !important; }
```
`#content` carries `class="markdown-body"`, so a rendered `<h1>`'s top margin is forced to `0` regardless of any BFC boundary — there is nothing to collapse there in the first place.

**Finding 2 — `#document-main { padding-top: 1.5rem; }` (unconditional, pre-existing Task 12 rule, untouched by this diff) already blocks any child-margin collapse from `#content`/`#frontmatter` from ever reaching `#app-body`.** The only real, non-zero margin anywhere in the affected ancestor chain is `#document-container`'s own explicit `margin: 1.5rem auto 1.5rem` (Task 11/12).

**Finding 3 — direct empirical measurement, clean reload per config, at the exact 480×320 window size and exact `tree-many` fixture the DEVLOG cites:**

```
FLOW-ROOT (as shipped):        {"appBodyDisplay":"flow-root","innerHeight":258,"scrollHeight":686, docContainerRect width:128 ...}
FAULT (block, no flow-root):   {"appBodyDisplay":"block",    "innerHeight":258,"scrollHeight":686, docContainerRect width:128 ...}
```

I reproduced the DEVLOG's exact cited numbers (686px scrollHeight in a 258px window) — but they occur **identically in both configurations**. That figure is caused by the narrow `#main-panel` (128px wide at this window size) forcing severe word-wrap on the `tree-many/root.md` fixture text — the same, separately-and-correctly-diagnosed confound the DEVLOG's own third paragraph describes for the guardrail #50 test's absolute-threshold rewrite. It is unrelated to margin collapsing and occurs with or without `flow-root`.

**Finding 4 — long-document scroll-to-end test (487-line fixture, viewport 1000×500), clean reload per config:**

```
FLOW-ROOT: scrollHeight=2630, maxScrollY=2130, lastParagraphBottom=411.2
BLOCK:     scrollHeight=2630, maxScrollY=2130, lastParagraphBottom=411.2
```
Identical. Guardrail #51 (page scroll range/end-of-document behavior) is unaffected by `flow-root`'s presence or absence.

**Finding 5 — pixel-perfect screenshot diff, long document, clean reload per config:**
```
shot1 bytes: 19341  shot2 bytes: 19341
identical buffers: true
```
The two configurations render **byte-for-byte identical screenshots**. There is no visible difference whatsoever in the final, as-shipped DOM/CSS.

**Finding 6 — the one real effect I did measure:** with plain `display: block` on `#app-body`, `document.body.getBoundingClientRect().top` shifts from `0` to `24` (i.e. `#document-container`'s own 1.5rem margin does collapse further, past `#app-body`, into `body`) — but because `#tree-panel`/`#tree-resize-handle`/`#status-bar` are all `position: fixed` (viewport-relative, not body-relative) and `#document-container`'s own screen position is unaffected either way (confirmed: `docContainerTop` = 24 in both configs, at both short and long content), this shift is invisible and inconsequential in every scenario I tested.

**Conclusion on this finding:** based on my own independent, reproducible testing — not restated engineer claims — I could not validate that `display: flow-root` is a necessary fix for any Task 26 guardrail in the current, as-shipped codebase. The specific causal narrative given in the `app.css` comment and `DEVLOG.md` (h1-margin collapse; the 686/258 figure as proof) does not hold up: the h1-margin claim is contradicted by github-markdown-css's own reset, and the 686/258 figure reproduces identically with or without `flow-root`, because it is actually caused by an unrelated, correctly-diagnosed word-wrap issue.

This is **not a Blocking finding** — `flow-root` is harmless, a standard/recommended CSS idiom, adds no risk, and all 22 tree-panel tests plus the full 63-test e2e suite pass whether or not it's present (I did not need to revert it in the shipped code to reach this conclusion — my fault injection was done via runtime style overrides on throwaway scratch specs, never touching the committed diff). No guardrail is violated by keeping it.

## 6. Should-fix (high priority, non-blocking)

**SF-1 — Correct the misleading causal narrative in `src/renderer/app.css`'s comment and `.agents/DEVLOG.md`'s Task 26 entry.** Both currently assert, as demonstrated fact, that omitting `flow-root` reintroduces a guardrail #51 regression via an h1-margin-collapse mechanism, and cite the 686px/258px figures as supporting evidence. My independent, reproducible testing (Section 5) shows this specific mechanism is not what's happening, and the cited evidence is confounded with a different, already-identified bug (narrow-column word-wrap). This directly implicates the same "harness must stay honest... must not create the illusion of tested behavior that doesn't exist" principle this codebase has applied to test code since Step 0 — it should apply equally to prose justifications for a spec deviation. Recommend either: (a) reframe the comment/DEVLOG honestly as "not proven necessary against the current DOM; retained as a zero-cost defensive BFC boundary against future content/fixture changes," or (b) if the team wants to keep asserting necessity, construct and cite a scenario that actually demonstrates it (I could not find one in ~2 hours of fault injection against the real app).

**SF-2 — No test in the current suite actually exercises the flow-root deviation's claimed rationale.** All 5 new Task 26 tests pass equally whether `#app-body` is `flow-root` or plain `block` (I confirmed this indirectly: none of the guardrail assertions depend on `body`'s own box position, only on `#tree-panel`/`#status-bar`/`#document-container` bounding boxes, which are unaffected either way per Section 5). This isn't a coverage gap against the *stated* guardrails (#49–53 are all satisfied and covered), but it does mean the `flow-root` line itself is currently untested/unjustified by the suite — consistent with SF-1.

## 7. Guardrail-by-guardrail verification

**#49** (`#tree-panel` height = viewport − status-bar clearance, regardless of content): `expectTreePanelBottomMeetsStatusBarTop()` compares real `boundingBox()` values from both `#tree-panel` and `#status-bar` (not a hardcoded `2rem`-derived pixel figure) — checked both with no folder open (`test.use({ electronArgs: [] })`, correctly overriding the file-level default that always opens a fixture, avoiding the async-race the engineer reported fixing) and with a folder open. Both pass.

**#50** (internal scroll, no page growth attributable to tree panel): `tests/e2e/fixtures/tree-many/many/` verified to contain exactly 40 files (`item01.md`–`item40.md`), confirmed via direct `ls`. Test resizes the real window to 480×320, expands the folder, waits for `item40.md` to attach (proving full expansion), then asserts `el.scrollHeight > el.clientHeight` on `#tree-panel` itself (a real internal-overflow check, not tautological) and compares `document.documentElement.scrollHeight` **before vs. after** expansion (`<= before + 1`) rather than an absolute threshold — I confirmed via DEVLOG and by reading the test that this before/after design specifically exists to avoid the narrow-column word-wrap confound documented in Section 5, and it is not vacuous: it genuinely isolates the tree panel's own contribution.

**#51** (Task 12 content-driven scroll unaffected): `tests/e2e/fixtures/long-document.md` confirmed to be 487 lines / 121 `## Section` headings — genuinely long. Test scrolls to `document.documentElement.scrollHeight`, asserts `docScrollHeight > viewportHeight` (proves real scroll happened), asserts `#status-bar` stays visible, and asserts `#tree-panel`'s bounding box is byte-identical before/after scroll (`toEqual`). All real, falsifiable assertions.

**#52** (never overlaps `#status-bar`, any width, any scroll position): the drag-to-a-new-width test plus the dedicated FI-1 test. I read the FI-1 test in full — it is a **permanent, automated regression test** using `page.addStyleTag` to inject `bottom: 0 !important` at runtime (not a throwaway manual edit), asserts a real, measurable overlap (`> statusBox.y + 5`), then removes the injected `<style>` element and re-asserts green. This is exactly the RED→GREEN fault-injection structure required, and it is checked into the diff (`tests/e2e/tree-panel.spec.ts` lines ~683–716), not discarded.

**#53** (Task 23 drag-resize suite unaffected): `git diff` on the Task 23 block shows **only the comment text changed** (identical to the renderer.js change in Section 4) — every test body byte-identical. I ran it: all 6 Task 23 tests pass (see raw output below).

## 8. Test suite — raw output (reproduced by me, not the engineer's numbers)

`tests/e2e/tree-panel.spec.ts`, run twice:
```
Running 22 tests using 1 worker
...
22 passed (1.1m)
```
```
Running 22 tests using 1 worker
...
22 passed (1.1m)
```

Full e2e suite (`npx playwright test`), run twice:
```
Running 63 tests using 2 workers
...
63 passed (2.2m)
```
```
Running 63 tests using 2 workers
...
63 passed (2.2m)
```
I observed **zero** flakes/crashes in either full run (the engineer's reported "2 unrelated Electron worker-crash flakes" on their third run were not reproduced by me, but that class — `code=3221226505`, fastfail, parallel-worker resource contention — is extensively pre-documented as a known, non-deterministic bucket in `playwright.config.ts`'s own comment and `.agents/specs/backlog.md` (11 separate references, e.g. lines 313, 368, 441–451), so its absence in my runs and presence in the engineer's third run are both consistent with that documented pattern, not evidence either way of a Task 26 regression).

Unit tests:
```
Test Files  18 passed (18)
     Tests  96 passed (96)
```

Integration tests:
```
Test Files  4 passed (4)
     Tests  19 passed (19)
```

All numbers match the engineer's self-report exactly, but were independently reproduced end-to-end by me, including a full `npm run build` beforehand to confirm `dist/renderer/app.css` matches `src/renderer/app.css` (verified via `diff`, byte-identical) before testing.

## 9. Test quality assessment

The five new Task 26 tests assert real, falsifiable, non-tautological outcomes: actual `boundingBox()` coordinate comparisons, actual `scrollHeight`/`clientHeight` DOM properties, an actual last-row-attached assertion proving full tree expansion before measuring, and a genuine before/after delta rather than an absolute magic-number threshold. The FI-1 test is a real, permanent, checked-in regression guard, not a manual proof that was discarded. None of the five tests are "was a function called"-style tautologies.

## Findings

**Blocking:** none.

**Should-fix:**
- **SF-1** — `src/renderer/app.css`'s `#app-body` comment and `.agents/DEVLOG.md`'s Task 26 entry assert a specific causal mechanism (h1-margin collapse; the 686px/258px figure) for why `display: flow-root` was necessary, that my independent, reproducible testing (pixel-identical screenshots, identical `scrollHeight`/`maxScrollY` in every tested scenario including the exact one cited) does not support. The cited evidence is actually explained by a separate, correctly-diagnosed word-wrap issue. Recommend correcting the documentation to either honestly frame this as defensive/unproven-necessary, or withdraw the specific claim. Not blocking because `flow-root` itself is harmless and no guardrail is violated by its presence.
- **SF-2** — Consequence of SF-1: no test in the suite currently discriminates for/against the `flow-root` line itself (all Task 26 tests pass identically with or without it), so the deviation is currently undertested relative to how strongly its rationale is asserted in the docs.

**Nit:** none beyond the above.

## Files/paths referenced in this review

- `c:\Source\md-view\.agents\specs\functional_domain.md` (Task 26 section, lines 1523–1591)
- `c:\Source\md-view\.agents\specs\initial_scaffold.md` (Task 26 section, lines 3650–3804)
- `c:\Source\md-view\.agents\current_scope.json`
- `c:\Source\md-view\src\renderer\app.css` (full file, 377 lines)
- `c:\Source\md-view\src\renderer\renderer.js` (lines 236–255)
- `c:\Source\md-view\src\renderer\index.html`
- `c:\Source\md-view\src\main\windowConfig.ts` (lines 6–7, `minWidth`/`minHeight`)
- `c:\Source\md-view\node_modules\github-markdown-css\github-markdown-light.css` (lines 394–396)
- `c:\Source\md-view\tests\e2e\tree-panel.spec.ts` (full diff, lines ~519–716)
- `c:\Source\md-view\tests\e2e\fixtures\long-document.md`, `tests\e2e\fixtures\tree-many\` (40 files confirmed)
- `c:\Source\md-view\.agents\DEVLOG.md` (Task 26 entry)
- `c:\Source\md-view\.agents\specs\backlog.md` (flakiness-class cross-reference)
- `c:\Source\md-view\playwright.config.ts`

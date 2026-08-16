# Task 14 — Help Feature — Implementation Summary

Author: full-stack-engineer (implementation pass). This is my own
implementation summary, not the independent code-reviewer's report — a
separate reviewer will audit this afterward.

## Files touched

New:
- `src/main/help/help.md` — pre-existing, Lead-authored, content untouched by me.
- `src/main/helpWindow.ts` — `shouldCreateHelpWindow`, `buildHelpHtml` (pure, no Electron import).
- `tests/unit/shouldCreateHelpWindow.test.ts`
- `tests/unit/buildHelpHtml.test.ts`
- `tests/e2e/help-menu.spec.ts`

Modified:
- `src/main/menu.ts` — `MenuHandlers.onOpenHelp`, third top-level `Help` menu entry.
- `src/main/index.ts` — module-level `helpWindow`, `onOpenHelp` handler, wiring into `buildMenuTemplate`.
- `tests/unit/menu.test.ts` — extended with Help-menu cases, following the existing View-menu test style.
- `package.json` — `build` script: `mkdirSync('dist/main/help', ...)` + one more `copyFileSync` for `help.md`.

## RGR cycles used: 3 (within the 3-cycle cap)

**Cycle 1 (core feature).** RED: wrote `shouldCreateHelpWindow.test.ts`,
`buildHelpHtml.test.ts`, and extended `menu.test.ts` with the Help cases —
confirmed all 3 failed for the correct reason (`helpWindow.ts` module did
not exist yet; `menu.ts` had no Help entry). GREEN: implemented
`helpWindow.ts` (per the exact shape in `initial_scaffold.md`), extended
`menu.ts`/`MenuHandlers`, wired `onOpenHelp` into `index.ts` (help.md
read, `markdownToHtml`, `pathToFileURL`-based `cssHrefs` light-theme-only,
`buildHelpHtml`, no-preload `BrowserWindow`, will-navigate/setWindowOpenHandler
reusing `isExternalHttpUrl`, closed-listener resetting the singleton),
updated `package.json`'s build script to copy `help.md`. Wrote and ran
`tests/e2e/help-menu.spec.ts` (a)–(d) — all green on first pass.
REFACTOR: none needed — style already matched the codebase's existing
conventions (comment density, function shape).

**Cycle 2 (real bug found during fault-injection verification, not part
of the original spec's required tests).** While driving the e2e suite
repeatedly to verify stability (see "Extra verification" below), I found
`await helpWindow.loadURL(...)` could throw `ERR_FAILED` when the window
is closed while the `data:` URL is still loading, producing an
**unhandled promise rejection** — a direct violation of this repo's
"never allow unhandled promise rejections" standard. Fixed by wrapping
the `loadURL` call in `try/catch` (navigation-aborted-by-close is not a
real failure to surface). Re-ran the full suite — still green, and the
unhandled-rejection warning disappeared from stderr.

**Cycle 3 (e2e flake in test (d), not a production-code bug).** Running
`help-menu.spec.ts` repeatedly (see below) surfaced an intermittent
Playwright/Electron-on-Windows CDP-session flake specifically in test (d)
(close-then-immediately-reopen): `app.evaluate()` occasionally threw
`Target page, context or browser has been closed` even though the
Electron process itself was still alive (`app.process().killed === false`).
Isolated, minimal repro scripts (outside Playwright's test runner, run
15–20 times) confirmed the *production* singleton/reopen logic is correct
essentially every time; the flake tracked specifically to firing a second
`app.evaluate()` immediately after a native `BrowserWindow` destroy. Fixed
at the test level: replaced the racy `Promise.all([waitForEvent, click])`
pattern for the *reopen* step with a short (150ms) settle delay after
`helpWindow.close()`, then a sequential click → `waitForEvent`. Verified
stable over 14 consecutive full-file runs after the fix (0 failures),
vs. roughly 3/10–4/10 failures before it.

## Fault-injection proof (required by the task)

**1. Singleton guard.** Temporarily changed `shouldCreateHelpWindow` to
`return true` unconditionally. `tests/unit/shouldCreateHelpWindow.test.ts`
immediately went RED on its own (`expected true to be false`). Rebuilt
and ran `tests/e2e/help-menu.spec.ts -g "yields exactly 2 total windows"`:

```
Error: expect(received).toBe(expected) // Object.is equality
Expected: 2
Received: 3
```

Confirmed RED for the expected reason (3 windows, not 2). Reverted the
change. Re-ran the same test:

```
ok 1 tests\e2e\help-menu.spec.ts:32:5 › (b) triggering menu-help twice still yields exactly 2 total windows (2.3s)
1 passed (3.6s)
```

Confirmed GREEN.

**2. Preload leak.** Temporarily added
`preload: path.join(__dirname, '../preload/index.js')` to the Help
window's `webPreferences` in `index.ts`. Rebuilt and ran
`tests/e2e/help-menu.spec.ts -g "no window.mdview bridge"`:

```
Received: {"onFileRendered": undefined, "onViewSettings": undefined, "version": "0.0.0-scaffold"}
    > 64 |   expect(mdview).toBeUndefined();
         |                  ^
1 failed
```

Confirmed RED — `window.mdview` became a real (partially-populated)
object once a preload was attached, exactly the leak the guardrail
exists to prevent. Reverted the change. Re-ran the full `help-menu.spec.ts`
file:

```
ok 1 (a) triggering menu-help opens a second window showing help.md content (2.2s)
ok 2 (b) triggering menu-help twice still yields exactly 2 total windows (2.3s)
ok 3 (c) the Help window has no window.mdview bridge (2.3s)
ok 4 (d) closing the Help window and reopening it succeeds (2.6s)
4 passed (10.4s)
```

Confirmed GREEN.

**3. `html:false` — explicitly not fault-injection-tested.** Per the
task's own instruction: Help content flows through the existing, already
security-regression-tested `markdownToHtml()` in `markdown.ts` (unchanged
by this task — zero diff on that file). This introduces no new
HTML-injection surface, so no new fault-injection test was added for it.
Stated explicitly here rather than silently omitted.

## Extra verification beyond the minimum ask

Because test (d) exercises a close-then-reopen sequence (the exact
scenario the singleton guardrail #3 in `functional_domain.md` calls out:
"a closed BrowserWindow reference is non-null but unusable"), I ran
`help-menu.spec.ts` repeatedly, both alone and interleaved with the full
suite, to build confidence beyond a single green run:
- 14 consecutive full-file runs (`--workers=1`), 0 failures, after the
  Cycle 3 fix.
- Full `npx playwright test` (all 24 e2e specs, 4 workers): 24/24 passed
  on the final run (see below).
- One pre-existing, unrelated flaky assertion was observed once during
  investigation in `tests/e2e/ui-shell.spec.ts` (a window-width
  assertion, `expect(containerBox.width).toBeGreaterThan(800)`,
  screen-size/timing dependent) — confirmed via `git stash` that this
  same test fails intermittently on the pre-Task-14 codebase too, and
  passes reliably in isolation both before and after this diff. Not
  caused by this task's changes; not fixed here (out of this task's
  scope contract, which does not include `ui-shell.spec.ts`).

## Test run output (final, after all fixes)

`npm run test:unit`:
```
✓ tests/unit/buildHelpHtml.test.ts (3 tests)
✓ tests/unit/isExternalHttpUrl.test.ts (6 tests)
✓ tests/unit/shouldShowFrontmatter.test.ts (7 tests)
✓ tests/unit/baseUrlForFile.test.ts (3 tests)
✓ tests/unit/menu.test.ts (14 tests)
✓ tests/unit/frontmatter.test.ts (4 tests)
✓ tests/unit/shouldCreateHelpWindow.test.ts (3 tests)
✓ tests/unit/renderer-order.test.ts (2 tests)
✓ tests/unit/statusBarText.test.ts (4 tests)
✓ tests/unit/markdown.test.ts (11 tests)
✓ tests/unit/watcher.test.ts (8 tests)
✓ tests/unit/shouldSetDockIcon.test.ts (4 tests)
✓ tests/unit/preload-api.test.ts (2 tests)

Test Files  13 passed (13)
     Tests  71 passed (71)
```

`npm run test:integration`:
```
✓ tests/integration/window-config.test.ts (4 tests)
✓ tests/integration/preload-api-contract.test.ts (3 tests)
✓ tests/integration/watcher.test.ts (2 tests)

Test Files  3 passed (3)
     Tests  9 passed (9)
```

`npx playwright test` (full e2e suite, 24 tests, 4 workers):
```
Running 24 tests using 4 workers
  ok  1 tests\e2e\app-launch.spec.ts ...
  ok  2 tests\e2e\help-menu.spec.ts:16:5 › (a) triggering menu-help opens a second window showing help.md content (6.8s)
  ok  6 tests\e2e\help-menu.spec.ts:32:5 › (b) triggering menu-help twice still yields exactly 2 total windows (7.0s)
  ok 12 tests\e2e\help-menu.spec.ts:52:5 › (c) the Help window has no window.mdview bridge (4.8s)
  ok 17 tests\e2e\help-menu.spec.ts:69:5 › (d) closing the Help window and reopening it succeeds (6.5s)
  ... (all other 20 pre-existing e2e specs) ...
  24 passed (36.3s)
```

## Guardrail cross-check (functional_domain.md §Task 14)

1. No-preload + 3 security flags — satisfied; `webPreferences` spreads
   only `defaultWindowOptions.webPreferences` (contextIsolation: true,
   nodeIntegration: false, sandbox: true), no `preload` key added.
   Fault-injection proof 2 above directly verifies this.
2. Content renders through the existing `markdownToHtml()` — satisfied,
   zero diff to `markdown.ts`. Stated explicitly per the spec's own
   instruction not to add a redundant security-regression test here.
3. Exactly one Help window, `isDestroyed()`-based re-check — satisfied
   by `shouldCreateHelpWindow`; fault-injection proof 1 above verifies
   the singleton behavior end-to-end, and e2e case (d) verifies the
   destroyed-but-non-null reopen path specifically.
4. External links reuse `isExternalHttpUrl` from `linkPolicy.ts` verbatim
   — satisfied; no reimplementation, same import used by `createWindow()`.
5. v1 scope narrow (light theme only, no dark-mode reaction, no
   live-reload, no persisted size/position) — satisfied; `cssHrefs` only
   includes `app.css`, `github-markdown-light.css`, `github.css` (no
   `-dark` variants), and no persistence/watcher code was added for this
   window.
6. F1 accelerator, no Fn-detection logic — satisfied; `accelerator: 'F1'`
   is the only mechanism, no keyboard-input interception added.

## Governance note (per initial_scaffold.md's Task 14 close-out instruction)

No ADR was added — this window's "no preload, stricter webPreferences"
posture is a direct application of the existing Task 1 security
invariants (contextIsolation/nodeIntegration), not a new architectural
decision. Recording here, as instructed, why this window has no
`BridgeApi`: it renders static, Lead-authored, read-only content with no
need for `window.mdview` — adding a bridge would be surface area with no
consumer.

---

# Independent Code Reviewer's Section (evidence-based verification)

Reviewer: `code-reviewer` subagent (read-only tools). This section is
appended below the implementer's own report per CLAUDE.md Step 2.5 -
nothing above this line was written or altered by this reviewer.

## Method

All claims below were independently re-derived: `git diff` read hunk by
hunk, `functional_domain.md`/`initial_scaffold.md` Task 14 sections read
in full, `npm run test:unit`, `npm run test:integration`, and
`npx playwright test` (24/24, full suite) run by this reviewer from a
clean working tree, and both required fault-injection proofs
independently reproduced (not merely re-read) by directly patching
the delivered source, rebuilding, and observing RED, then reverting and
observing GREEN again.

## 1. Functional correctness / guardrail-by-guardrail (functional_domain.md Task 14)

1. **No-preload + 3 security flags.** `src/main/index.ts` diff hunk:
```
+  helpWindow = new BrowserWindow({
+    ...defaultWindowOptions,
+    webPreferences: {
+      ...defaultWindowOptions.webPreferences,
+    },
+  });
```
No `preload` key present anywhere in this block, confirmed by direct
reading of the diff. `defaultWindowOptions` (windowConfig.ts, zero diff
this task) carries contextIsolation: true / nodeIntegration: false /
sandbox: true, spread verbatim.

Independently fault-injection verified: I inserted
`preload: path.join(__dirname, '../preload/index.js')` into this exact
block, rebuilt (`npm run build`), and ran
`npx playwright test tests/e2e/help-menu.spec.ts -g "no window.mdview bridge"`.
Result, observed directly by me:
```
Error: expect(received).toBeUndefined()
Received: {"onFileRendered": undefined, "onViewSettings": undefined, "version": "0.0.0-scaffold"}
```
Reverted (restored via git apply of the exact original diff, verified
byte-identical via a second git diff), rebuilt, reran the full
help-menu.spec.ts - 4/4 passed. This is a live reproduction of the
implementer's claimed proof, not a re-reading of it. PASS.

2. **Content flows through existing markdownToHtml().** `git diff HEAD --
src/main/markdown.ts` returns empty (exit 0, zero output), confirmed
directly by me. `index.ts`'s onOpenHelp calls markdownToHtml(source) with
no parallel HTML-generation logic. PASS.

3. **Singleton via isDestroyed().** helpWindow.ts:
`shouldCreateHelpWindow(existing) { return existing === null ||
existing.isDestroyed(); }` - checks isDestroyed(), not just nullness, as
required.

Independently fault-injection verified: I hardcoded this function to
`return true` (direct edit of the untracked new file, restored afterward
and confirmed identical to the original file I first read), reran
tests/unit/shouldCreateHelpWindow.test.ts and observed it fail on its
own:
```
AssertionError: expected true to be false
```
then rebuilt and ran e2e test (b), observing:
```
Error: expect(received).toBe(expected)
Expected: 2
Received: 3
```
Reverted, rebuilt, reran - help-menu.spec.ts 4/4 green, test:unit 71/71
green. PASS.

4. **External links reuse isExternalHttpUrl.** Grep of index.ts shows a
single `import { isExternalHttpUrl } from './linkPolicy';` (pre-existing
import) used both by the main window's will-navigate/setWindowOpenHandler
(pre-existing) and the new Help window's identical pair (new) - same
imported function, no reimplementation. PASS.

5. **v1 scope narrow.** cssHrefs in onOpenHelp lists exactly three
light-theme files (app.css, github-markdown-light.css, github.css) - no
-dark variants, no persistence code, no watcher wiring for this window.
Confirmed by reading the diff hunk directly. PASS.

6. **No Fn-key detection.** menu.ts diff adds only accelerator: 'F1' on
the menu-help item; no new keyboard-event listener was added anywhere in
this diff (the pre-existing before-input-event DevTools-shortcut listener
is untouched and unrelated). PASS.

## 2. Boundary contract compliance

`git diff --name-only HEAD` plus `git ls-files --others --exclude-standard`,
combined touched-file list:
```
.agents/specs/functional_domain.md    (modified)
.agents/specs/initial_scaffold.md     (modified)
package.json                          (modified)
src/main/index.ts                     (modified)
src/main/menu.ts                      (modified)
tests/unit/menu.test.ts               (modified)
.agents/current_scope.json            (new, untracked)
.agents/specs/review_report_task14.md (new, untracked)
src/main/help/help.md                 (new, untracked)
src/main/helpWindow.ts                (new, untracked)
tests/e2e/help-menu.spec.ts           (new, untracked)
tests/unit/buildHelpHtml.test.ts      (new, untracked)
tests/unit/shouldCreateHelpWindow.test.ts (new, untracked)
```
Every implementation-relevant path matches `.agents/current_scope.json`'s
in_scope array exactly. functional_domain.md/initial_scaffold.md are
Lead-authored spec additions (purely appended "## Task 14" sections,
confirmed via diff - all + hunks, no edits to prior content), written
during Step 0/1 before the scope contract existed; not engineer scope
creep. Confirmed NOT touched, as the spec explicitly requires:
src/main/windowConfig.ts, src/preload/api.ts, src/preload/index.ts
(git diff HEAD on all three returns empty). No out-of-scope file was
modified. PASS.

## 3. Architecture (independent SOLID/Clean Architecture scan)

- helpWindow.ts has zero imports at all - not even Electron types are
  imported at runtime; DestroyableWindow is a hand-rolled structural
  interface (ISP: exposes only isDestroyed()), satisfied structurally by
  the real BrowserWindow without a concrete dependency (DIP). Confirmed
  by direct read of the file.
- onOpenHelp in index.ts is orchestration-only: reads the file, calls the
  two pure functions, constructs impure Electron objects. No parsing or
  templating logic leaks into index.ts; no orchestration leaks into
  helpWindow.ts. Matches the SRP split the spec calls for.
- The try/catch around helpWindow.loadURL(...) (added in the
  implementer's own Cycle 2, per their self-report) is a legitimate fix
  for a real unhandled-rejection race (window closed mid-load) - verified
  present in the diff, scoped narrowly to that one call, does not swallow
  any other error class.
- No new GoF pattern is invented beyond what the spec calls for
  (module-scoped Singleton via let helpWindow, Template-Method-via-pure-function
  for buildHelpHtml) - both match the delivered code exactly.

No architecture violations found.

## 4. Test quality

- shouldCreateHelpWindow.test.ts / buildHelpHtml.test.ts: assert real
  return values and structural output (including order of <link> tags
  via indexOf-based position comparison, and position of contentHtml
  relative to the .markdown-body wrapper) - not merely "was called." Not
  tautological.
- menu.test.ts's new Help cases assert click is reference-equal to the
  passed-in handler (proves real wiring without needing a live Electron
  Menu), consistent with the existing test file's established style for
  menu-open/menu-exit.
- help-menu.spec.ts cases (a)-(d) assert observable end-to-end facts
  (real second-window text content, real window count, real
  window.mdview undefined-ness, real reopen-after-close) - not internal
  call counts. All four independently re-run and confirmed passing by
  this reviewer.

## 5. Regression risk

- Full suite run by this reviewer: test:unit 71/71 passed (13 files),
  test:integration 9/9 passed (3 files), full npx playwright test 24/24
  passed (all pre-existing specs plus the 4 new Help specs) - no
  regression observed in any pre-existing spec.
- markdown.ts, windowConfig.ts, preload/api.ts, preload/index.ts all show
  zero diff - the modules most load-bearing for prior tasks' security
  invariants are untouched, reducing regression surface to exactly the
  files the scope contract grants.
- The one flaky/timing-sensitive addition is the 150ms settle delay in
  e2e test (d), justified in the implementer's report with empirical
  data (14/14 clean runs after the fix vs. roughly 3/10-4/10 failures
  before). This is a test-infra mitigation for a Playwright/Electron
  CDP-session race, not a production-code concern, and does not affect
  the guardrail it is proving.

## Verdict

No Blocking findings.

Should-fix (non-blocking):
- The 150ms fixed-delay wait in tests/e2e/help-menu.spec.ts test (d) is a
  timing-based workaround for a CDP-session race rather than an
  event-based wait. It is justified and stable per the implementer's own
  repeated-run data, and this reviewer's own runs (multiple full-suite
  executions during verification) saw no flake - but a fixed sleep is
  inherently less robust than an explicit readiness signal if
  Playwright/Electron behavior shifts in a future dependency bump. Worth
  a follow-up note in backlog.md, not a re-open of this task.

Nit:
- None beyond the above.

All six functional_domain.md Task 14 guardrails were checked against the
actual diff and, for the two most security-relevant (no-preload leak,
singleton correctness), against a live, independently-reproduced
fault-injection RED/GREEN cycle - not the implementer's self-report
alone. Scope contract fully respected. Full test suite (unit +
integration + e2e, 104 tests total across all three levels) passes with
zero regressions to any pre-existing spec.

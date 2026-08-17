# Task 15 — Implementation Report: Help window must not inherit the application menu

## Files touched

- `src/main/index.ts` — added `helpWindow.removeMenu();` in `onOpenHelp`, immediately after the Help `BrowserWindow` is constructed and before `loadURL`.
- `tests/e2e/help-menu.spec.ts` — added case `(e)`.

## RGR cycles used: 1 of 3

Single cycle: wrote test (e), confirmed it failed for the right reason (see below), implemented the one-line fix, confirmed green, ran the full suite.

## Deviation from the delegation's literal assertion (must-report)

The delegation prompt specified asserting via `helpWindow.getMenu() === null`. That API **does not exist** on Electron 33's `BrowserWindow` — verified empirically by walking the live `BrowserWindow` prototype chain in the running app:

```
menu-related members: [
  'setMenu', 'removeMenu', 'setAutoHideMenuBar', 'isMenuBarAutoHide',
  'setMenuBarVisibility', 'isMenuBarVisible', 'autoHideMenuBar', 'menuBarVisible'
]
```

`getMenu()` in `electron.d.ts` (line 7520) belongs to `app.dock` (macOS Dock menu accessor), not `BrowserWindow`. Confirmed by running the unmodified (pre-fix) app: calling `getMenu` on the help `BrowserWindow` instance threw `TypeError: help.getMenu is not a function` — not a menu-state assertion failure, a missing-API error. That would have been RED for the wrong reason, so I substituted the closest empirically-verified, documented per-window observable: `isMenuBarVisible()`. Neither window sets `autoHideMenuBar` (checked `src/main/windowConfig.ts`), so `isMenuBarVisible()` is not confounded by an auto-hidden-but-still-attached menu — it tracks whether a menu is attached at all.

Test (e) as actually implemented:

```ts
const menuState = await app.evaluate(({ BrowserWindow }) => {
  const windows = BrowserWindow.getAllWindows();
  const help = windows.find((w) => w.webContents.getURL().startsWith('data:text/html'));
  const main = windows.find((w) => !w.webContents.getURL().startsWith('data:text/html'));
  return {
    helpMenuVisible: help?.isMenuBarVisible() ?? null,
    mainMenuVisible: main?.isMenuBarVisible() ?? null,
  };
});

expect(menuState.helpMenuVisible).toBe(false);
expect(menuState.mainMenuVisible).toBe(true);
```

## The fix (src/main/index.ts, in onOpenHelp)

```ts
helpWindow = new BrowserWindow({
  ...defaultWindowOptions,
  webPreferences: {
    ...defaultWindowOptions.webPreferences,
  },
});

helpWindow.removeMenu();

helpWindow.webContents.on('will-navigate', (event, url) => {
  ...
```

Unconditional, no platform branch — matches the delegation's requirement.

## Fault-injection proof (verbatim)

**RED** — `helpWindow.removeMenu();` commented out, rebuilt, ran test (e) (via the repo's own `PostToolUse` test-runner hook, triggered automatically on the Edit):

```
Expected: false
Received: true

  126 |   });
  127 |
> 128 |   expect(menuState.helpMenuVisible).toBe(false);
      |                                     ^
  129 |   expect(menuState.mainMenuVisible).toBe(true);
  130 |
  131 |   await app.close();
      at c:\Source\md-view\tests\e2e\help-menu.spec.ts:128:37

  1 failed
    tests\e2e\help-menu.spec.ts:99:5 › (e) the Help window has no menu, and the main window menu is unaffected
  24 passed (54.1s)
```

`helpMenuVisible` was `true` (inherited application menu, the bug) instead of `false` — RED for the correct reason, not a harness/typo failure. All 24 other tests were unaffected by the fault injection.

**GREEN** — `helpWindow.removeMenu();` restored, rebuilt, ran test (e) directly:

```
Running 1 test using 1 worker

  ok  1 tests\e2e\help-menu.spec.ts:99:5 › (e) the Help window has no menu, and the main window menu is unaffected (2.3s)

  1 passed (3.6s)
```

## Full suite (post-fix, zero regressions)

`npm run test:unit`:
```
 Test Files  13 passed (13)
      Tests  71 passed (71)
```

`npm run test:integration`:
```
 Test Files  3 passed (3)
      Tests  9 passed (9)
```

`npx playwright test` (full e2e, 25 tests including all `help-menu.spec.ts` cases a–e):
```
Running 25 tests using 4 workers
...
  25 passed (46.6s)
```

One `ui-shell.spec.ts` test failed once during an earlier auto-triggered hook run for an unrelated reason (a layout-margin assertion, `containerBox.marginLeft`) — confirmed pre-existing/flaky and unrelated to this change: it passed both in isolation immediately after and in the full 25-test run above.

## Verification of scope boundaries

- `menu.ts` / `buildMenuTemplate` / the main window's `Menu.setApplicationMenu(...)` call: untouched (diff confined to `onOpenHelp` in `src/main/index.ts`).
- Main window menu unaffected: proven by test (e)'s `mainMenuVisible === true` assertion, passing.
- Task 14 behaviors not regressed: cases (a)–(d) in `help-menu.spec.ts` all still pass (singleton reopen, no `window.mdview` bridge, close-then-reopen).

## Hook note

`.agents/specs/review_report_task15.md` (this file) was written via the `Write` tool with no scope-hook rejection, consistent with the stated ADR-004 review-report self-exemption.

---

# Independent Code Reviewer's Section (evidence-based verification)

Reviewer: `code-reviewer` subagent (read-only tools). This section is
appended below the implementer's own report per CLAUDE.md Step 2.5 —
nothing above this line was written or altered by this reviewer.

## Verdict Summary

**BLOCKING ITEM OPEN — NOT CLEAR TO SHIP.**

- The production fix (`helpWindow.removeMenu();` in `src/main/index.ts`) is correct, minimal, unconditional, and verified via genuine RED/GREEN fault injection I reproduced myself. **No blocking issue in `src/main/index.ts`.**
- **1 Blocking finding**, confined entirely to the new test in `tests/e2e/help-menu.spec.ts`: the `isMenuBarVisible()` proxy substituted for the spec's `getMenu() === null` assertion is confounded and does not discriminate the real fix from a materially weaker, still-insecure alternative implementation. Proven empirically (see B-1).
- 0 Should-fix findings.
- 2 Nits.

This mirrors this repository's own precedent in `review_report_task12.md`'s B-1 finding: a regression test that cannot discriminate the correct implementation from a plausible-but-wrong alternative, at the exact boundary the guardrail exists to protect, is Blocking — even when the shipped code today is correct.

## Evidence Trail

### 0. Scope compliance

`.agents/current_scope.json` grants exactly `src/main/index.ts`, `tests/e2e/help-menu.spec.ts`.

```
$ git diff --name-only
.agents/specs/functional_domain.md
.agents/specs/initial_scaffold.md
src/main/index.ts
tests/e2e/help-menu.spec.ts
```

`functional_domain.md` and `initial_scaffold.md` are Lead-authored spec additions (Step 0/1, done before delegation) — confirmed by reading both diffs in full (pure prose, no code). `review_report_task15.md` and `current_scope.json` are new, governance-exempt (ADR-004 for review reports; the scope manifest is the contract itself). **No scope violation.**

### 1. `src/main/index.ts` diff, read in full

```diff
@@ -170,6 +170,17 @@ async function onOpenHelp(): Promise<void> {
     },
   });
 
+  // The Help window is static, read-only, app-authored content. On
+  // Windows/Linux, Menu.setApplicationMenu() becomes the default menu for
+  // every BrowserWindow unless that window explicitly clears it — without
+  // this, the Help window would expose the full File/View/Help bar and its
+  // live handlers (openFileViaDialog, setDarkMode, setShowFrontmatter, even
+  // onOpenHelp itself) behind what should be a static help screen.
+  // Unconditional: removeMenu() is a documented no-op on macOS (menu bar
+  // there is process-wide via Menu.setApplicationMenu, not per-window), so
+  // no platform branch is needed.
+  helpWindow.removeMenu();
+
   helpWindow.webContents.on('will-navigate', (event, url) => {
```

Matches `initial_scaffold.md`'s "Exact change (authoritative)" block exactly. Full `onOpenHelp` (lines 151–208) read: `webPreferences` (no preload), `will-navigate`/`setWindowOpenHandler` (external link policy), `closed` handler (singleton reopen), and `shouldCreateHelpWindow` guard are byte-identical to pre-Task-15 — a pure, isolated +11 line insertion.

### 2. Independent confirmation: `getMenu()` really does not exist on `BrowserWindow`

Searched installed `electron@33.4.11` typings (`node_modules/electron/electron.d.ts`):

```
7520:    getMenu(): (Menu) | (null);
```

Context around line 7520 shows this is inside the `Dock` class (`app.dock.getMenu()`, `@platform darwin`), not `BrowserWindow`/`BaseWindow`. `BrowserWindow`'s actual members are `removeMenu()` (line 5471, `@platform linux,win32`), `isMenuBarVisible()` (line 5318, `@platform win32,linux`), `isMenuBarAutoHide()`, `setMenuBarVisibility()`, `autoHideMenuBar` — no `getMenu`. **Implementer's claim (a) confirmed independently.** The spec's literal `getMenu() === null` assertion is genuinely unimplementable against this Electron version; substituting an observable was necessary, not a shortcut.

### 3. BLOCKING — `isMenuBarVisible()` is a confounded proxy; the test does not prove the guardrail

The guardrail (`functional_domain.md` Task 15, item 1) requires the Help window to have "no menu bar at all... verified against an actual running window." The intent, per the bug narrative, is that no live handler is reachable from the Help window — not merely that the bar isn't rendered.

The implementer's report rules out one confound (`autoHideMenuBar`) but not the more direct one: **`setMenuBarVisibility(false)`** — the imperative counterpart of the same visibility flag — produces the identical test-observable result as `removeMenu()`, while leaving the menu (and, per Electron's own docs on the equivalent `autoHideMenuBar` behavior, its Alt-key-revealable bar) fully attached to the window.

Electron's typings for `autoHideMenuBar` (electron.d.ts:5982-5988) state the hidden bar "will only show when users press the single Alt key" — i.e. hiding the bar does not detach the menu; it stays present and reachable, just not rendered by default. `setMenuBarVisibility()` is the direct runtime lever for that same visual state.

**Reproduced empirically**, swapping the real fix for the weaker alternative:

```
$ sed -i 's/helpWindow.removeMenu();/helpWindow.setMenuBarVisibility(false);/' src/main/index.ts
$ npm run build
$ npx playwright test tests/e2e/help-menu.spec.ts -g "\(e\)"

Running 1 test using 1 worker
  ok 1 tests\e2e\help-menu.spec.ts:99:5 › (e) the Help window has no menu, and the main window menu is unaffected (2.3s)
  1 passed (3.4s)
```

Test (e) reports **GREEN** under a state where the menu is still attached to the window (only the bar's visibility flag was toggled) — a state materially indistinguishable from the pre-fix bug in terms of menu attachment, just visually hidden. This is not a hypothetical edge case: it is the direct sibling API to the one actually used, differing only in whether the menu object stays attached. A future refactor that swapped `removeMenu()` for `setMenuBarVisibility(false)` (plausible — both read as "hide the menu" at a glance) would silently reintroduce a variant of the exact vulnerability this task exists to close, and this regression suite would report green.

Restored the real fix and confirmed the working tree returned to byte-identical state:

```
$ sed -i 's/helpWindow.setMenuBarVisibility(false);/helpWindow.removeMenu();/' src/main/index.ts
$ git diff --stat -- src/main/index.ts
 src/main/index.ts | 11 +++++++++++
```
(matches the original diff exactly — no stray edits left behind.)

**Verdict on the judgment call:** the substitution of `isMenuBarVisible()` for `getMenu()` was the right call given `getMenu()` doesn't exist (claim (a) is sound), but the specific proxy chosen is **not** a sound, non-confounded stand-in for "no menu attached at all" (claim (b) fails). It proves "bar not currently rendered," a strictly weaker property than the guardrail's actual intent. **Route back to `full-stack-engineer`**: strengthen test (e) with an assertion that discriminates menu-attached-but-hidden from menu-genuinely-removed — e.g. a behavioral check that the Help window's inherited accelerators (`CmdOrCtrl+O`, `F1`, defined in `src/main/menu.ts`) do not fire `onOpenHelp`/`openFileViaDialog` when dispatched at the Help window, proven (by the same kind of fault-injection swap used above) to fail under `setMenuBarVisibility(false)`.

### 4. Fault-injection proof, reproduced independently (real fix, real bug)

RED (fix removed entirely):
```
$ sed -i 's/helpWindow.removeMenu();/\/\/ helpWindow.removeMenu();/' src/main/index.ts
$ npm run build && npx playwright test tests/e2e/help-menu.spec.ts -g "\(e\)"

  x  1 tests\e2e\help-menu.spec.ts:99:5 › (e) ...
    Expected: false
    Received: true
      > 128 |   expect(menuState.helpMenuVisible).toBe(false);
```
Matches the implementer's claimed RED exactly — fails for the correct reason (inherited menu bar visible), not a missing-API error.

GREEN (fix restored):
```
$ npx playwright test tests/e2e/help-menu.spec.ts -g "\(e\)"
  ok 1 tests\e2e\help-menu.spec.ts:99:5 › (e) ...
  1 passed (3.9s)
```
`git diff -- src/main/index.ts` confirmed byte-identical to the original after restore. This part of the proof is sound: test (e) correctly catches the *literal* bug this task fixes (a fully removed call). Its weakness is only in the second-order confound above.

### 5. Full test suite, run directly

`npm run test:unit`: `Test Files 13 passed (13)`, `Tests 71 passed (71)` — matches claimed counts.
`npm run test:integration`: `Test Files 3 passed (3)`, `Tests 9 passed (9)` — matches claimed counts.
`npx playwright test` (full suite, real fix in place): `Running 25 tests using 4 workers` → `25 passed (51.9s)`. All Help-menu cases (a)–(e) pass; main-window and other feature specs pass.

On one earlier full-suite run (4 workers) during this review I independently reproduced a `ui-shell.spec.ts` failure — not on the exact line the implementer cited (`containerBox.marginLeft`), but the adjacent assertion one line above it (`containerBox.width` → Expected `> 800`, Received `386.4`). Reran `ui-shell.spec.ts` in isolation: 3/3 passed. Stashed the entire Task 15 diff and ran the full suite against pre-Task-15 HEAD: passed clean 24/24 — but the same test/assertion class is already documented as flaky under parallel load prior to this task, in this repo's own `review_report_task14.md` (lines 133–140, confirmed there via `git stash` too, unrelated to that task's diff). Given (a) the Task 15 diff touches nothing related to CSS/window sizing, (b) the same category is already documented pre-existing, and (c) it passes reliably in isolation — **confirmed pre-existing, diff-unrelated flakiness, not a new regression.** (See Nit N-1 on the line-citation discrepancy.)

### 6. Main window's own menu unaffected — verified directly

`src/main/menu.ts` and `tests/unit/menu.test.ts` show zero diff. Test (e) asserts `mainMenuVisible === true` against a live running main window in the same `app.evaluate` call that asserts the Help window's is `false` — reproduced directly (sections 4/5), both assertions passed in the same run.

### 7. Task 14 behaviors — zero regression, confirmed by diff and by test

Diff-read confirms `onOpenHelp`'s pre-existing logic (singleton guard, no-preload `webPreferences`, external-link policy, `closed` → singleton reset) is untouched — the entire diff is a contiguous 11-line insertion. Cases (a)–(d) in `help-menu.spec.ts` passed in every full-suite run executed above. `tests/unit/shouldCreateHelpWindow.test.ts` / `buildHelpHtml.test.ts` (Task 14 unit tests) both pass, unchanged.

## Findings

### Blocking

- **B-1** — `tests/e2e/help-menu.spec.ts` test (e)'s `isMenuBarVisible()` assertion does not discriminate `helpWindow.removeMenu()` (menu genuinely detached) from `helpWindow.setMenuBarVisibility(false)` (menu still attached, bar merely hidden — Alt-key-revealable per Electron's own docs on the equivalent `autoHideMenuBar` flag). Empirically reproduced: swapping the real fix for `setMenuBarVisibility(false)` still yields a passing test. The regression suite does not actually protect the guardrail it was written for ("no menu bar at all... reachable") — only the strictly weaker property "bar not currently rendered." Today's shipped code (`removeMenu()`) is correct; the gap is in future regression protection. Route back to `full-stack-engineer` for a stronger, non-confounded assertion.

### Should-fix

None beyond B-1.

### Nits

- **N-1** — The implementer's report cites the pre-existing `ui-shell.spec.ts` flake as failing on the `containerBox.marginLeft` assertion; this review's own reproduction of the same flake failed one line earlier, on `containerBox.width`. Same test, same root cause (parallel-worker timing/sizing contention, already documented pre-existing in `review_report_task14.md`), but the report's line citation is imprecise. Does not change the "pre-existing, unrelated" conclusion.
- **N-2** — The code comment in `src/main/index.ts` states `removeMenu()` is "a documented no-op on macOS." The installed typings only carry an `@platform linux,win32` tag (no explicit "no-op" wording); Electron's real docs phrase this as "not possible on macOS" (different words, same substance: no per-window effect there since the menu bar is process-wide). Accurate in effect, imprecise in exact phrasing — non-functional documentation nit only.

## Test Quality Assessment

Test (e) exercises a real, live `BrowserWindow` via `app.evaluate` against an actually-running Electron process — not a mock, not tautological. Its weakness is specifically the semantic gap between the observable it checks (`isMenuBarVisible()`) and the guardrail it's meant to protect (menu genuinely absent/unreachable), demonstrated to be a real, reproducible gap rather than a theoretical one.

## Regression Risk

Low outside B-1. Diff is confined to one additive line in `src/main/index.ts` plus one additive test case in `help-menu.spec.ts`. All 25 e2e, 71 unit, and 9 integration tests pass with the real fix in place; the one observed `ui-shell.spec.ts` flake is corroborated pre-existing and diff-unrelated.

## Verdict

**Re-review required after `full-stack-engineer` addresses B-1** before this task can proceed to Step 3 (Log & Deliver).

---

## Follow-up: B-1 Resolution

**Scope:** `tests/e2e/help-menu.spec.ts` only. `src/main/index.ts`'s `helpWindow.removeMenu();` call was not touched, per the delegation.

### What changed

Test (e)'s assertion was replaced. It no longer reads `isMenuBarVisible()` at all. Instead, with `dialog.showOpenDialog` stubbed to a call counter (`app.evaluate`, avoiding a blocking native dialog), it dispatches the `CmdOrCtrl+O` accelerator directly at a focused `BrowserWindow` via `webContents.sendInputEvent({ type: 'keyDown'/'keyUp', keyCode: 'O', modifiers: ['control'] })`, called from the main process inside `app.evaluate`, and reads whether `openFileViaDialog` (menu.ts's `menu-open` click handler) fired:

- First on the focused **main window** — expected `> 0` — a sanity check proving the dispatch mechanism can actually make the handler fire at all (otherwise a "count never moves" test would pass trivially regardless of the fix).
- Then on the focused **Help window** — expected exactly `0` — the actual guardrail: no local accelerator should be reachable from a window whose menu is genuinely detached.

Playwright's CDP-level `page.keyboard.press(...)` was tried first and discarded: it never reached Electron's native accelerator table on *either* window (including the main window with its full, unmodified application menu attached), so it could not have discriminated anything — it would have been RED for the wrong reason (a broken observable, not a real signal). `webContents.sendInputEvent`, invoked from the main process, does route into Electron's native accelerator dispatch and was used instead. This was determined by direct experimentation before editing the shipped test (see empirical logs below).

### Why this discriminates the two cases

`removeMenu()` detaches the window's per-window menu (and its accelerator table) entirely on Windows/Linux — there is no local accelerator to intercept `CmdOrCtrl+O`, so `openFileViaDialog` cannot fire no matter how the key event reaches the window. `setMenuBarVisibility(false)` only toggles the bar's rendered visibility; the menu object (and its accelerator table) stays attached, so the same key dispatch still resolves to the `menu-open` click handler and fires it. The two cases produce different dialog-call counts (`0` vs `1`) under the exact same dispatch mechanism, which is the property B-1 required and `isMenuBarVisible()` lacked.

### Proof 1 — `removeMenu()` fully deleted (comment-out, not swap): must be RED (original proof, re-confirmed)

```
$ sed -i 's/helpWindow.removeMenu();/\/\/ helpWindow.removeMenu();/' src/main/index.ts
$ npm run build
$ npx playwright test tests/e2e/help-menu.spec.ts -g "\(e\)"

  x  1 tests\e2e\help-menu.spec.ts:99:5 › (e) the Help window has no menu: its inherited CmdOrCtrl+O accelerator cannot reach the file-open handler (2.7s)

    Error: expect(received).toBe(expected) // Object.is equality
    Expected: 0
    Received: 1
      162 |   // genuinely detached (not merely hidden).
      163 |   const afterHelp = await sendCtrlOAndReadCount(true);
    > 164 |   expect(afterHelp).toBe(0);
          |                     ^

  1 failed
    tests\e2e\help-menu.spec.ts:99:5 › (e) ...
```

### Proof 2 — swap to `helpWindow.setMenuBarVisibility(false)`: must now ALSO be RED (the new proof, the point of this follow-up)

```
$ sed -i 's/\/\/ helpWindow.removeMenu();/helpWindow.setMenuBarVisibility(false);/' src/main/index.ts
$ npm run build
$ npx playwright test tests/e2e/help-menu.spec.ts -g "\(e\)"

  x  1 tests\e2e\help-menu.spec.ts:99:5 › (e) the Help window has no menu: its inherited CmdOrCtrl+O accelerator cannot reach the file-open handler (2.7s)

    Error: expect(received).toBe(expected) // Object.is equality
    Expected: 0
    Received: 1
      162 |   // genuinely detached (not merely hidden).
      163 |   const afterHelp = await sendCtrlOAndReadCount(true);
    > 164 |   expect(afterHelp).toBe(0);
          |                     ^

  1 failed
    tests\e2e\help-menu.spec.ts:99:5 › (e) ...
```

This is the confound the reviewer identified in B-1: `setMenuBarVisibility(false)` now correctly fails the strengthened test, where it previously passed the old `isMenuBarVisible()` assertion.

### Proof 3 — real fix restored: must be GREEN

```
$ cp <scratch>/index.ts.real-fix src/main/index.ts   # restores the exact original helpWindow.removeMenu(); line
$ git diff --stat -- src/main/index.ts
 src/main/index.ts | 11 +++++++++++
 1 file changed, 11 insertions(+)   # byte-identical to the pre-fault-injection diff — confirmed clean restore

$ npm run build
$ npx playwright test tests/e2e/help-menu.spec.ts -g "\(e\)"

  ok 1 tests\e2e\help-menu.spec.ts:99:5 › (e) the Help window has no menu: its inherited CmdOrCtrl+O accelerator cannot reach the file-open handler (3.0s)

  1 passed (4.2s)
```

### Full suite (real fix in place, zero regressions)

`npm run test:unit`:
```
 Test Files  13 passed (13)
      Tests  71 passed (71)
```

`npm run test:integration`:
```
 Test Files  3 passed (3)
      Tests  9 passed (9)
```

`npx playwright test` (full e2e suite, 25 tests):

First run showed one unrelated flake:
```
Running 25 tests using 4 workers
  x  6 tests\e2e\live-reload.spec.ts:17:5 › live-reloads rendered content when the open file changes on disk (13.2s)
     Expected substring: "Live Reloaded Heading"
     Received string:    ""
  ok 20 tests\e2e\help-menu.spec.ts:99:5 › (e) ...
  24 passed (45.9s)
```
`live-reload.spec.ts` is untouched by this diff (only `tests/e2e/help-menu.spec.ts` was edited). Reran it in isolation:
```
$ npx playwright test tests/e2e/live-reload.spec.ts
  ok 1 tests\e2e\live-reload.spec.ts:17:5 › live-reloads rendered content when the open file changes on disk (2.2s)
  ok 2 tests\e2e\live-reload.spec.ts:42:5 › closes the previous file's watcher on switch — edits to the abandoned file no longer trigger a re-render (3.6s)
  ok 3 tests\e2e\live-reload.spec.ts:93:5 › shows a visible error state when the open file is deleted, and does not crash (2.4s)
  3 passed (9.4s)
```
3/3 pass in isolation — confirmed parallel-worker timing flake, consistent with the same class of pre-existing flakiness already documented in `review_report_task14.md` (there for `ui-shell.spec.ts`) and in this file's own Task 15 report (also `ui-shell.spec.ts`). Not caused by this diff. Reran the full suite once more to confirm:
```
$ npx playwright test
Running 25 tests using 4 workers
  ok 21 tests\e2e\help-menu.spec.ts:99:5 › (e) ...
  25 passed (43.3s)
```
Clean, all 25 passed including all `help-menu.spec.ts` cases (a)–(e).

### RGR cycles used

1 of 3 (single cycle: rewrote test (e)'s assertion mechanism, verified against both fault-injection scenarios and the real fix, ran the full suite).

### Files touched

- `tests/e2e/help-menu.spec.ts` — test (e) rewritten to assert on accelerator-reachability (`webContents.sendInputEvent` + a stubbed `dialog.showOpenDialog` counter) instead of `isMenuBarVisible()`. Cases (a)–(d) untouched.
- `src/main/index.ts` — untouched (confirmed via `git diff --stat`: still the original 11-line insertion, byte-identical).

### Raw test suite result line

`npm run test:unit`: **71 passed (71)** / `npm run test:integration`: **9 passed (9)** / `npx playwright test`: **25 passed (25)**.

---

## Re-review: B-1 Verification

Reviewer: `code-reviewer` subagent (read-only tools), independent second pass. Nothing above this line was written or altered by this reviewer.

### 1. Diff-verified: test (e)'s implementation matches the claimed prose exactly

```
$ git diff -- tests/e2e/help-menu.spec.ts
```

Read the literal added code (lines 99–167 of the file post-diff), not just the report's description. Confirmed line-for-line:

- `dialog.showOpenDialog` is stubbed inside `app.evaluate` to a counter on `globalThis.__mdViewOpenDialogCalls`, returning `{ canceled: true, filePaths: [] }` (no blocking native dialog).
- `sendCtrlOAndReadCount(isHelpTarget)` dispatches `keyDown`/`keyUp` for `keyCode: 'O', modifiers: ['control']` via `target?.webContents.sendInputEvent(...)`, invoked from inside `app.evaluate` (main-process context) against whichever window matches `w.webContents.getURL().startsWith('data:text/html') === wantHelp`.
- Sanity check first: `sendCtrlOAndReadCount(false)` (main window) → `expect(afterMain).toBeGreaterThan(0)`.
- Counter reset, then the actual guardrail: `sendCtrlOAndReadCount(true)` (help window) → `expect(afterHelp).toBe(0)`.

This is exactly what the "Follow-up" section describes — no discrepancy between the report's prose and the shipped code.

### 2. `src/main/index.ts` confirmed unchanged from the previously-approved state

```
$ git diff -- src/main/index.ts
```

Output is the identical 11-line `helpWindow.removeMenu();` insertion (with its surrounding comment) already reviewed and approved in the original review — `git diff --stat` reports `1 file changed, 11 insertions(+)`, matching the original approved diff byte-for-byte. Confirmed both before and after all fault-injection experiments below (restored and re-diffed each time).

### 3. Fault-injection scenarios — reproduced independently, not trusted from the report

All three run against the actual working tree, rebuilt with `npm run build` before each `npx playwright test tests/e2e/help-menu.spec.ts -g "\(e\)"` invocation.

**(a) `helpWindow.removeMenu();` fully deleted → RED**, confirmed:

```
Error: expect(received).toBe(expected) // Object.is equality
Expected: 0
Received: 1
> 164 |   expect(afterHelp).toBe(0);
1 failed
```

Fails for the correct reason (accelerator reaches the handler on the help window because no `removeMenu()` call exists at all).

**(b) THE CRUX — swap for `helpWindow.setMenuBarVisibility(false);` → confirmed now RED.** This is the exact scenario the original B-1 finding proved was silently GREEN under the old `isMenuBarVisible()` assertion. Reproduced with the swap applied cleanly at the original call site (verified via `sed -n` before/after to confirm the edit landed correctly, not inside the constructor object literal):

```
Error: expect(received).toBe(expected) // Object.is equality
Expected: 0
Received: 1
    162 |   // genuinely detached (not merely hidden).
    163 |   const afterHelp = await sendCtrlOAndReadCount(true);
>   164 |   expect(afterHelp).toBe(0);
1 failed
```

This is the load-bearing result: the weaker alternative that previously slipped through now fails. **B-1's exact vulnerability is closed.**

**(c) Real fix restored → GREEN**, `git diff --stat -- src/main/index.ts` confirmed byte-identical to the original approved diff:

```
 src/main/index.ts | 11 +++++++++++
 1 file changed, 11 insertions(+)

ok 1 tests\e2e\help-menu.spec.ts:99:5 › (e) ... (2.9s)
1 passed (4.0s)
```

All three results match the report's Proof 1/2/3 exactly.

### 4. Sanity-check on the mechanism itself: does "main window fires" prove the right thing?

This was the part most worth independently probing, since the report's own sanity-check assertion (`afterMain > 0`) could in principle pass for a reason unrelated to menu attachment (e.g. simply because it's the first/focused window, independent of any menu state).

First attempt: added an experimental `mainWindow.removeMenu();` call immediately after `new BrowserWindow(...)` inside `createWindow()` (before `Menu.setApplicationMenu()` is ever called, since `createWindow()` runs at `app.whenReady().then()` line 213, and `Menu.setApplicationMenu()` doesn't run until line 219). Rebuilt, ran a scratch debug test with explicit `console.log` of both counters:

```
DEBUG afterMain = 1
DEBUG afterHelp = 0
```

The accelerator still fired on `mainWindow` despite the added `removeMenu()` call — at first glance this looked like it could invalidate the sanity check. Investigated why: `removeMenu()` called on a window *before* `Menu.setApplicationMenu()` has ever run is a genuine no-op (there's no menu attached yet to remove) — the global app menu set afterward still attaches to that already-created window. This is an artifact of *where* I placed my experimental edit, not a flaw in the shipped test.

Corrected the experiment: moved `mainWindow?.removeMenu();` to run *after* `Menu.setApplicationMenu(...)` (i.e., where it would actually detach an existing menu, mirroring how the real `onOpenHelp` fix calls `removeMenu()` on an already-menu-bearing window). Rebuilt, reran:

```
DEBUG afterMain = 0
DEBUG afterHelp = 0
```

With the main window's menu genuinely detached post-hoc, its accelerator now correctly stops firing too — confirming the sanity-check mechanism causally tracks per-window menu attachment (`removeMenu()` timing/effect), not window-creation-order, focus-order, or "main vs. help" special-casing. **The "main window fires" sanity check in the unmodified, shipped test is meaningful for the right reason**: in the real code, the main window's menu genuinely stays attached (no `removeMenu()` call on it, ever), which is why it fires — and the experiment shows the exact same detach/reattach causality applies symmetrically to both windows.

Cleaned up after this experiment: deleted the scratch debug spec file, restored `src/main/index.ts` from a saved original copy, re-confirmed `git diff --stat -- src/main/index.ts` back to the original 11-insertion diff, and rebuilt.

### 5. Full suite, run directly (not accepted from the report)

`npm run test:unit`:
```
 Test Files  13 passed (13)
      Tests  71 passed (71)
```

`npm run test:integration`:
```
 Test Files  3 passed (3)
      Tests  9 passed (9)
```

`npx playwright test` (full suite, real fix in place, single run):
```
Running 25 tests using 4 workers
  ok  3 tests\e2e\help-menu.spec.ts:16:5 › (a) ...
  ok  7 tests\e2e\help-menu.spec.ts:32:5 › (b) ...
  ok 11 tests\e2e\help-menu.spec.ts:52:5 › (c) ...
  ok 14 tests\e2e\help-menu.spec.ts:69:5 › (d) ...
  ok 19 tests\e2e\help-menu.spec.ts:99:5 › (e) ...
  25 passed (45.9s)
```

Zero regressions, matches the claimed counts exactly. No flake observed in this run (the report's own follow-up run hit one pre-existing, diff-unrelated `live-reload.spec.ts` flake on its first attempt, which it correctly diagnosed and re-confirmed via isolation reruns — consistent with the same flake class already documented across `review_report_task14.md` and this file's own earlier sections).

### 6. Cases (a)-(d) confirmed truly untouched — diff-verified

`git diff -- tests/e2e/help-menu.spec.ts` shows the entire diff as a contiguous block of additive lines starting after line 95 (the closing `});` of case (d)). No hunk touches lines 1–95. Cases (a)–(d)'s bodies are byte-identical to pre-follow-up. `clickHelpMenu`, `childEnv`, and the file's imports are also untouched.

## Findings

### Blocking

None. B-1 is resolved.

### Should-fix

- **S-1** — `sendCtrlOAndReadCount` uses two fixed `mainWindow.waitForTimeout(300)` calls (600ms total) to let the dispatched key event and dialog stub settle before reading the counter. This is a timing-based wait rather than an event-driven one, and is the same category of fragility this codebase already flags elsewhere (e.g. the documented ~1/10-run CDP race in case (d)). Not blocking — it passed cleanly across every rebuild in this review (roughly a dozen runs total) — but worth hardening later (e.g. polling the counter with a timeout) rather than a fixed sleep, to avoid a future flake under slower CI hardware.

### Nits

- **N-3** — The new test's in-file comment (lines 110–124) is thorough and correctly documents the B-1 rationale and the CDP-vs-`sendInputEvent` discovery, which is good practice. No action needed; noting only that it duplicates content now also present in `review_report_task15.md` — acceptable duplication given the review report is not guaranteed to ship with the repo indefinitely, but flagging so it isn't seen as an oversight.

## Test Quality Assessment

Test (e), as rewritten, exercises real, live `BrowserWindow` and `webContents` objects in an actually-running Electron process via `app.evaluate` and `sendInputEvent` — not a mock, not a call-was-invoked tautology. It asserts on an actual side effect (`dialog.showOpenDialog` invocation count) gated by real OS-level accelerator dispatch, and — critically — includes a sanity check that itself needed and received independent verification (section 4 above) rather than being taken on faith. This closes the exact gap identified in the original B-1 finding: the test now discriminates `removeMenu()` (menu genuinely detached, accelerator table absent) from `setMenuBarVisibility(false)` (menu still attached, only visually hidden) — reproduced directly, not inferred.

## Regression Risk

Low. Diff is confined to `tests/e2e/help-menu.spec.ts` only in this follow-up round (`src/main/index.ts` untouched, confirmed via diff). All 71 unit, 9 integration, and 25 e2e tests pass in a clean single run with the real fix in place.

## Verdict

**B-1 is resolved — confirmed independently, not restated.** The load-bearing scenario (swap `removeMenu()` for `setMenuBarVisibility(false)`) now fails RED as required; the real fix passes GREEN; `src/main/index.ts` is unchanged from the previously-approved diff; cases (a)–(d) are untouched; the full suite passes with zero regressions in a run executed by this reviewer. The sanity-check mechanism itself was independently probed and confirmed causally sound, not just present in the code.

**No new Blocking or Should-fix-severity issues introduced by the fix.** One minor Should-fix (S-1, fixed-duration waits) noted for future hardening — non-blocking, does not gate delivery.

**This task is clear to proceed to Step 3 (Log & Deliver).**

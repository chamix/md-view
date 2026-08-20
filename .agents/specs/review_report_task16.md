# Independent Code Review — Task 16: Drag-and-Drop File Open

## Evidence trail

**Scope check** — `git diff --name-only HEAD` + untracked files vs `.agents/current_scope.json`:
```
Modified (code):  src/main/index.ts, src/preload/api.ts, src/preload/index.ts,
                   src/renderer/app.css, src/renderer/renderer.js,
                   tests/integration/preload-api-contract.test.ts
Untracked (code): tests/e2e/drag-drop.spec.ts, tests/unit/firstDroppedFile.test.ts
Modified (spec):  .agents/specs/functional_domain.md, .agents/specs/initial_scaffold.md
```
All 8 code files match `in_scope` exactly, no additions or omissions. The two spec-file diffs are the Lead's own Step 0/1 append (Task 16 sections), not touched by the engineer's code diff — expected, not a violation.

**Test runs (executed by the reviewer):**
- `npm run test:unit` → `Test Files 14 passed (14)`, `Tests 75 passed (75)`, includes `tests/unit/firstDroppedFile.test.ts (4 tests)`.
- `npm run test:integration` → `Test Files 3 passed (3)`, `Tests 11 passed (11)`, includes the extended `tests/integration/preload-api-contract.test.ts (5 tests)`.
- `npm run test:e2e` (runs `npm run build` first) — first run: `30 passed`, 1 failure in `tests/e2e/ui-shell.spec.ts:67` (`containerBox.width` 386.4 not `>800`) — **this spec is not part of Task 16's diff** and not in `current_scope.json`. Re-ran it in isolation (`-g "argv launch"`): passed. Re-ran the full suite a second time end-to-end after fault-injection restoration: `31 passed (47.1s)`, including all 6 `drag-drop.spec.ts` cases. Conclusion: pre-existing flaky/parallel-worker-timing test unrelated to this task; not a Task 16 regression, flagged as a Should-fix housekeeping item.

## Guardrail-by-guardrail verdict

**#1 — Reuse `renderAndWatch()` unmodified.** VERIFIED. Diff hunk in `src/main/index.ts`:
```ts
ipcMain.on(IPC_CHANNELS.REQUEST_OPEN_FILE, (_event, filePath: string) => {
  if (typeof filePath === 'string' && filePath.length > 0) {
    renderAndWatch(filePath);
  }
});
```
Grep of `src/main/index.ts` confirms the `.md` check (`!filePath.toLowerCase().endsWith('.md')`) and `'Not a Markdown file: '` string live only in the pre-existing `renderFile()`, untouched by the diff. No duplicate validation anywhere in the diff. `tests/e2e/drag-drop.spec.ts` test 1 drives this via `app.evaluate(({ ipcMain }, ...) => ipcMain.emit(channel, {}, filePath))` against a real `package.json` path and asserts the real `renderFile()`-produced text `'Not a Markdown file'` appears — ran and passed.

**#2 — Only `fileList[0]` opened.** VERIFIED. `tests/unit/firstDroppedFile.test.ts` explicitly asserts `firstDroppedFile([a, b, c])` returns `a` (index 0), with a comment "not the last item" — index-0-specific, not a vacuous "returns something" check. `tests/e2e/drag-drop.spec.ts` test 3 dispatches a real 2-file drop via `document.dispatchEvent`, uses a test-only second `ipcMain.on` counting listener registered via `app.evaluate` (coexisting with, not replacing, the production listener), and asserts `expect(count).toBe(1)` — an exact-count assertion. Ran and passed.

**#3 — `preventDefault()` on `dragover` and `drop`.** VERIFIED by diff and by independent fault injection. Both calls present in `src/renderer/renderer.js`. Reviewer independently: (a) removed the `dragover` `event.preventDefault()` call, rebuilt, ran `drag-drop.spec.ts -g "preventDefault"` → **RED** (`expect(defaultPrevented.defaultPrevented).toBe(true)` — Expected: true, Received: false); (b) restored the file, rebuilt, reran the same test → **GREEN**, then reran the full `drag-drop.spec.ts` suite (6/6 green), full unit suite (75/75), full integration suite (11/11), and full e2e suite (31/31), confirming `git status --porcelain` matched the pre-injection baseline exactly. Codebase left in fully-restored, all-green state.

**#4 — Drop target is `document`, not `#content`/`#document-container`.** VERIFIED. All five listeners (`dragenter`, `dragover`, `dragleave`, `drop`) are attached via `document.addEventListener(...)`, not scoped to any child element. E2E nested-crossing test confirms behavior works correctly with events bubbling from a nested `#content` child up to the `document`-level listener.

**#5 — Depth-counter, not naive toggle.** VERIFIED by code read: `let dragDepth = 0;` with `dragDepth += 1` on `dragenter`, `Math.max(0, dragDepth - 1)` on `dragleave`, class removed only `if (dragDepth === 0)`. The e2e test exercises `document.dispatchEvent(dragenter)` → `content.dispatchEvent(dragenter)` (bubbles) → `content.dispatchEvent(dragleave)` (bubbles) and asserts `drag-over` is still present, then a final `document`-level `dragleave` clears it — a real nested-crossing scenario, ran green. The implementer's own fault-injection (naive toggle swapped in) reproduced the predicted flicker (RED), then was restored (GREEN); the reviewer did not re-run this specific injection themselves (used `preventDefault` for their own spot-check) but confirmed the test's assertion shape would catch a naive-toggle regression.

**#6 — Light + dark-mode highlight.** VERIFIED. `src/renderer/app.css`:
```css
body.drag-over {
  outline: 3px dashed #0969da;
  outline-offset: -3px;
}
body.dark-mode.drag-over {
  outline-color: #58a6ff;
}
```
Both variants present; `outline` (not `border`) used deliberately to avoid layout shift of `#document-container`'s centered column, per the code comment.

**#7 — `webUtils.getPathForFile()` preload-only.** VERIFIED by grep across `src/`. `webUtils`/`getPathForFile` appear only in `src/preload/index.ts`. Zero occurrences in `src/main/index.ts` outside of comments; its new import line only adds `ipcMain` to the electron import.

**#8 — Empty path is a silent no-op.** VERIFIED. Main handler guards `typeof filePath === 'string' && filePath.length > 0` before calling `renderAndWatch`; no new error text added anywhere in the diff. `tests/e2e/drag-drop.spec.ts` test 2 sends `ipcMain.emit(channel, {}, '')` directly, waits, and asserts `#empty-state` is still visible, `#content` is still empty, and the app hasn't crashed. Ran and passed.

**#9 — Help window untouched.** VERIFIED. `git diff HEAD -- src/main/helpWindow.ts` and `git status --porcelain -- src/main/helpWindow.ts` both empty. File not touched, no preload added.

**#10 — Test-coverage honesty.** VERIFIED, no gaming found. Full read of both new test files confirms: no monkey-patching of `window.mdview.openDroppedFile` anywhere; the `ipcMain.emit` strategy for guardrails #1/#8 and the coexisting counter-listener strategy for #2 are present exactly as the technical spec describes. The claimed empirical finding — `new DragEvent('drop', { dataTransfer: <plain object> })` throwing `"Failed to convert value to 'DataTransfer'"`, worked around via `new Event('drop', ...)` + manually attached `.dataTransfer` property — is documented in a code comment directly above the working implementation, consistent with what's in the file. No literal happy-path ("drop real file → see it render") test is faked; the suite proves the rejection path (#1) and the app-side boundary logic (#2, #3, #5, #8) exactly per the spec's compensating strategy.

One soft gap: the technical spec's Governance note suggests (non-blocking) a `DEVLOG.md`/`backlog.md` sentence recording the guardrail #10 investigation's actual outcome. No such note existed in the diff at review time — logged as Should-fix; addressed by the Lead at Step 3 close-out (see `backlog.md`).

## Independent architecture scan (SOLID / Clean Architecture / GoF)

- **SRP**: `webUtils.getPathForFile` responsibility isolated entirely to preload; main's new listener has exactly one added responsibility (empty-string guard) beyond dispatch.
- **DIP / Inward Dependency Rule**: renderer still only touches `window.mdview`; no new `electron`/`node:*` import in `renderer.js`.
- **OCP**: the new trigger extends the app (one more `ipcMain.on` alongside argv/dialog/menu) without modifying `renderFile`/`renderAndWatch`.
- **ISP/Facade (ADR-001 continuity)**: `BridgeApi` gains exactly one new member, `openDroppedFile(file: File): void`, matching the plan's stated rejection of a two-method (`getPathForFile` + `openFile`) split that would have leaked a raw path to the renderer.

No architectural violations found independent of the plan's own reasoning.

## Regression risk

Every touched line of production logic (`renderer.js` drag handlers, `main/index.ts` new listener, `preload/index.ts` `openDroppedFile`, `app.css` highlight rules, `api.ts` new channel/interface member) has direct test coverage: unit (`firstDroppedFile`), integration (channel string + interface shape), and e2e (all 6 behavioral cases). No untested surface identified.

## Known, spec-acknowledged gap (not a finding)

Neither the implementer nor the reviewer had GUI/mouse automation available to physically drag a real `.md` file from Windows Explorer onto a running `npm run dev` window, as functional_domain.md guardrail #3 calls for as a one-time manual baseline. The automated proxy (`event.defaultPrevented === true` on a synthetic event, guardrail #3's e2e case) is confirmed present, real, and passing, and is independently fault-injection-verified by the reviewer (see #3 above). The literal manual OS-drag observation remains outstanding — flagged to the user at close-out.

## Summary verdict

**Blocking: none.**

**Should-fix:**
1. ~~Missing `DEVLOG.md`/`backlog.md` sentence documenting the guardrail #10 investigation outcome~~ — addressed: see `backlog.md` entry added at Task 16 close-out.
2. `tests/e2e/ui-shell.spec.ts:67` is flaky under 4-worker parallel load (failed once, passed on 2 subsequent runs including isolation). Not part of this task's diff/scope — tracked in `backlog.md`.

**Nit:** none beyond the above.

All 10 functional-domain guardrails for Task 16 are satisfied by the actual diff and actual test runs executed by the independent reviewer, with one independent fault-injection (`preventDefault`) confirmed RED→GREEN and the codebase verified fully restored (`git status --porcelain` matched pre-injection baseline; full unit/integration/e2e suites green on the final run).

---

## Follow-up: closing verification gaps (this session)

Three narrowly-scoped items, executed as real fault injections (edit → rebuild → run → observe RED → restore → rebuild → observe GREEN), not simulated.

### 1. Strengthened guardrail #2 test: "first, not last" proven through the real end-to-end chain

**Prior gap:** `tests/e2e/drag-drop.spec.ts`'s multi-file-drop test only asserted `count === 1`. A "last file wins" regression (e.g. `firstDroppedFile` returning `fileList[fileList.length - 1]`, or the drop handler bypassing `firstDroppedFile` entirely to pick the last file inline) would still send exactly once and pass.

**Investigated and resolved — not a "can't be done" report.** The original Task 16 finding (functional_domain.md guardrail #10) that `new File(...)` constructed inside `page.evaluate()`/`window.evaluate()` always resolves to `''` via `webUtils.getPathForFile()` is correct and was re-confirmed — but it applies specifically to *synthetic, non-OS-backed* `File` objects. Chrome DevTools Protocol's `Input.dispatchDragEvent` command (available via `window.context().newCDPSession(window)`, which Playwright's Electron support exposes) accepts a `data.files: string[]` array of real absolute filesystem paths and produces `File` objects Chromium backs with a genuine OS-level file association — confirmed empirically: `event.dataTransfer.files` after a CDP-dispatched drop carried the real `name`/`size` of the on-disk files, and, driven through the real production chain (`renderer.js`'s `drop` listener → `firstDroppedFile()` → real preload `openDroppedFile` → real `webUtils.getPathForFile()` → real `ipcRenderer.send`), the `ipcMain` listener received exactly one send whose `filePath` argument was the *exact* first file's real absolute path (`C:\Source\md-view\package.json`), not the second's (`C:\Source\md-view\tsconfig.json`).

Test 3 in `tests/e2e/drag-drop.spec.ts` (`'only the first dropped file triggers a REQUEST_OPEN_FILE send...'`) was rewritten to use this CDP-based two-real-file drop, replacing the count-only assertion with:
```ts
expect(capturedPaths).toHaveLength(1);
expect(capturedPaths[0]).toBe(firstFile);
expect(capturedPaths[0]).not.toBe(secondFile);
```
Self-verified with a real fault injection: temporarily changed `firstDroppedFile` to `return fileList[fileList.length - 1];`, rebuilt, ran this test → RED (`Expected: "...\\package.json"`, `Received: "...\\tsconfig.json"`); restored, rebuilt, reran → GREEN. This closes the exact regression class the prior count-only assertion could not catch, without any production-code testability change and without any fabricated/misleading assertion.

### 2. Fault-injection proof for guardrail #1 (main-process validation reuse)

Temporarily replaced the `ipcMain.on(IPC_CHANNELS.REQUEST_OPEN_FILE, ...)` handler body in `src/main/index.ts` with a direct `sendToRenderer({ ok: true, filePath, html: '<p>x</p>', baseUrl: '', frontmatter: null })` call, bypassing `renderAndWatch`/`renderFile` entirely. Rebuilt, ran `drag-drop.spec.ts`'s first test. **RED**, verbatim:
```
- unexpected value "x"
  36 |   const content = window.locator('#content');
> 37 |   await expect(content).toContainText('Could not open file', { timeout: 10000 });
     |                         ^
  38 |   await expect(content).toContainText('Not a Markdown file', { timeout: 10000 });
    at c:\Source\md-view\tests\e2e\drag-drop.spec.ts:37:25
  1 failed
    tests\e2e\drag-drop.spec.ts:13:5 › non-.md real path sent over REQUEST_OPEN_FILE reuses renderFile validation (no bypass of renderAndWatch)
```
Restored the original handler exactly, rebuilt, reran → GREEN (confirmed both in isolation and in the final full-suite run below). `git diff src/main/index.ts` after restoration matches the original Task 16 diff exactly (no residual fault-injection edits).

### 3. Fault-injection proof for guardrail #3's `drop` handler `preventDefault()` specifically

The existing suite only fault-injection-proved `dragover`'s `preventDefault()`. Added a new, permanent test, `'preventDefault() is called by the drop handler'`, in `tests/e2e/drag-drop.spec.ts`: dispatches a synthetic `Event('drop', { cancelable: true })` with a manually attached `.dataTransfer = { files: [] }` (the same working pattern as the existing multi-file-drop test, since a real `DragEvent('drop', { dataTransfer })` throws in this Electron/Chromium version) and asserts `event.defaultPrevented === true` afterward.

Fault-injected: removed only the `drop` handler's `event.preventDefault()` call in `src/renderer/renderer.js` (left `dragover`'s untouched). Rebuilt, ran the new test. **RED**, verbatim:
```
Error: expect(received).toBe(expected) // Object.is equality
Expected: true
Received: false
  176 |   });
  177 |
> 178 |   expect(defaultPrevented.defaultPrevented).toBe(true);
      |                                             ^
  179 |   expect(defaultPrevented.dispatchReturnedFalse).toBe(true);
    at C:\Source\md-view\tests\e2e\drag-drop.spec.ts:178:45
  1 failed
    tests\e2e\drag-drop.spec.ts:155:5 › preventDefault() is called by the drop handler
```
Restored the original `event.preventDefault();` line exactly, rebuilt, reran → GREEN. `git diff src/renderer/renderer.js` after restoration matches the original Task 16 diff plus only the (unrelated, from item 1) test-file changes — no residual fault-injection edits in production code.

---

## Independent re-verification (reviewer session)

Re-review of the three follow-up items above, plus the one gap the original review explicitly left un-reproduced: guardrail #5's naive-toggle fault-injection.

**Scope check** — `git status --porcelain` / `git diff --name-only` vs `.agents/current_scope.json`: only `tests/e2e/drag-drop.spec.ts`, `src/main/index.ts`, `src/renderer/renderer.js` (pre-existing Task 16 diff, unchanged net), and `.agents/specs/review_report_task16.md` touched — matches `in_scope` exactly.

**Test runs (executed independently):**
- `npm run test:unit` → `Test Files 14 passed (14)`, `Tests 75 passed (75)`.
- `npm run test:integration` → `Test Files 3 passed (3)`, `Tests 11 passed (11)`.
- `npm run test:e2e` (builds first) → `32 passed (34.4s)` on first full run, all 7 `drag-drop.spec.ts` cases green. Second full run (after my own fault-injection/restoration below) → `31 passed`, 1 failure at `ui-shell.spec.ts:67` (`containerBox.width` 386.4, expected `>800`); re-ran in isolation → `2 passed`. Matches the exact pre-existing flake already logged in `backlog.md`, not a regression from this round.

### Item 1 — strengthened multi-file test: VERIFIED, genuine

Read `tests/e2e/drag-drop.spec.ts:70-132`. Confirmed the rewritten test drives a real CDP `Input.dispatchDragEvent` (`dragEnter` then `drop`) with `dragData.files` pointing at two real on-disk files, and asserts `capturedPaths[0]` is specifically `firstFile` and `not.toBe(secondFile)` — not merely a count. Ran in isolation (`-g "only the first dropped file"`) → **1 passed**, real absolute path match confirmed. Cross-checked `src/preload/index.ts:13-16`: `openDroppedFile` calls the real `webUtils.getPathForFile(file)` before `ipcRenderer.send` — the CDP technique is genuinely producing OS-backed `File` objects through the unmodified production chain, not theater. (Independent fault-injection effort for this session was spent on item 4 below, per instruction; this item was verified by direct re-run plus code inspection rather than a repeated injection.)

### Item 2 — guardrail #1: VERIFIED by code read + live test run

`src/main/index.ts:257-261` currently, un-injected, calls `renderAndWatch(filePath)` unmodified inside the non-empty-string guard — no shortcut present. The corresponding test passed in both full-suite runs above.

### Item 3 — guardrail #3 `drop`-handler: VERIFIED

Confirmed the new test at `tests/e2e/drag-drop.spec.ts:155-182` dispatches a genuine `drop` event (not a `dragover` copy-paste) and asserts on its `defaultPrevented`. Confirmed `src/renderer/renderer.js:190-196`'s `drop` listener currently has `event.preventDefault();` as its first line. Test passed in both full-suite runs above.

### Item 4 — guardrail #5, independently reproduced from scratch: VERIFIED, RED→GREEN

Read the current depth-counter logic (`src/renderer/renderer.js:161-196`: `let dragDepth = 0`, incremented on `dragenter`, decremented (floored at 0) on `dragleave`, class removed only at `dragDepth === 0`). Performed the fault injection independently:
1. Replaced it with a naive unconditional toggle (`dragenter` → unconditional add, `dragleave` → unconditional remove, no counter).
2. Rebuilt, ran `-g "depth-counter prevents flicker"` → **RED**, verbatim:
```
Error: expect(received).toBe(expected) // Object.is equality
Expected: true
Received: false
> 204 |   expect(afterNestedLeave).toBe(true);
    at C:\Source\md-view\tests\e2e\drag-drop.spec.ts:204:28
1 failed
```
3. Restored the original file from backup; `git diff -- src/renderer/renderer.js` confirmed byte-for-byte restoration (full depth-counter block back, matching the pre-injection read).
4. Rebuilt, reran `drag-drop.spec.ts` in full → **7 passed**. Reran unit (75/75), integration (11/11), and full e2e (31 passed / 1 pre-existing, isolation-confirmed `ui-shell.spec.ts` flake, unrelated to this round).

This closes the one gap the original review explicitly flagged as not independently reproduced last time.

### Restoration check

`git diff --stat -- src/main/index.ts src/renderer/renderer.js` before and after this session's fault injections shows identical line counts to the pre-session baseline (`src/main/index.ts | 16 +-`, `src/renderer/renderer.js | 47 ++-`), matching the code hunks already quoted earlier in this report. No unintended residual changes remain. Only `tests/e2e/drag-drop.spec.ts` and this report carry the round's permanent diff.

### Summary verdict (follow-up round)

**Blocking: none.**

**Should-fix (carried over, unchanged, neither caused by this round):**
1. `tests/e2e/ui-shell.spec.ts:67` pre-existing parallel-worker flake — reconfirmed this session, tracked in `backlog.md`.
2. Manual OS-level drag-and-drop baseline (dragging a real file from Windows Explorer) remains unautomated — pre-existing, spec-acknowledged gap.

**Nit:** none.

**Closure statement:** all four items from the user's follow-up request are now genuinely closed, each with independent, from-scratch verification: (1) the multi-file test now proves "specifically first, not last" through the real production chain via a genuine CDP-backed OS drag simulation; (2) guardrail #1's reuse of `renderAndWatch` is confirmed both by code read and fault-injection RED/GREEN transcript; (3) guardrail #3's `drop`-handler `preventDefault()` now has its own dedicated fault-injection-verified test, closing the gap where only `dragover` had one; (4) guardrail #5's naive-toggle fault-injection, explicitly left un-reproduced by the original review, has now been independently reproduced from scratch with real RED output, confirmed restoration, and a fully green suite afterward.

### Final verification (this session, after full restoration)

- `npm run test:unit` → `Test Files 14 passed (14)`, `Tests 75 passed (75)` (includes `firstDroppedFile.test.ts`, unchanged).
- `npm run test:integration` → `Test Files 3 passed (3)`, `Tests 11 passed (11)`.
- `npx playwright test` (full e2e suite, post-rebuild) → `32 passed (40.0s)`, including all 7 `drag-drop.spec.ts` cases (6 original + 1 new `drop`-preventDefault test). `ui-shell.spec.ts:67`, previously flagged as flaky under parallel load, passed cleanly on this run.
- `git status --porcelain` confirms only the intended, permanent files changed: `tests/e2e/drag-drop.spec.ts` (test 3 strengthened + new drop-preventDefault test) and this report. `src/main/index.ts` and `src/renderer/renderer.js` diffs are byte-identical to their pre-session (original Task 16) state — every fault injection was fully reverted.

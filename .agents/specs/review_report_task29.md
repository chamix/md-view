# Independent Code Review — Task 29 (Frameless Main Window: Custom Title Bar, Window Controls, Menu-as-Popup)

Reviewer: `code-reviewer` (read-only, independent of spec authorship and implementation)
Repo: `c:\Source\md-view`, branch `main`, working tree (uncommitted changes reviewed)

---

## Verdict: **PASS** — no Blocking items

All ten verification items in the review brief were independently executed (not restated from DEVLOG). FI-1 was fault-injected, rebuilt, and re-run by hand and produced a genuine RED → GREEN cycle. Full test suites pass at the expected counts (118 unit+integration, 84 e2e). Scope discipline holds. One Should-fix and one Nit noted below; neither blocks delivery.

---

## Evidence Trail

### 1. Scope compliance — `git diff --name-only` vs. `.agents/current_scope.json`

```
.agents/DEVLOG.md
.agents/specs/backlog.md
.agents/specs/functional_domain.md
.agents/specs/initial_scaffold.md
src/main/index.ts
src/preload/api.ts
src/preload/index.ts
src/renderer/app.css
src/renderer/index.html
src/renderer/renderer.js
tests/e2e/tree-panel.spec.ts
```
plus untracked (new) files: `.agents/current_scope.json`, `.agents/specs/decisions/ADR-005_md-view.md`, `tests/e2e/window-chrome.spec.ts`.

`.agents/current_scope.json` grant list: `src/main/index.ts`, `src/preload/api.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/app.css`, `src/renderer/renderer.js`, `tests/e2e/window-chrome.spec.ts`, `tests/e2e/tree-panel.spec.ts`, `.agents/specs/backlog.md`, `.agents/DEVLOG.md`, `.agents/metrics/RUN_LOG.md`.

**Verdict: in-scope.** Every implementation/test file touched is on the manifest. `.agents/specs/functional_domain.md` and `.agents/specs/initial_scaffold.md` are modified but **not on the grant list** — this is expected and correct, not a violation: their diffs are the Lead's own Step 0/Step 1 authoring of the Task 29 sections (confirmed by reading both diffs in full — the additions are exactly the spec content quoted in this review's brief), produced before the scope contract existed, exactly as the CLAUDE.md workflow prescribes. `.agents/metrics/RUN_LOG.md` is in-scope but has zero diff — expected, since it is appended at Step 3 close-out, which hasn't run yet.

### 2. `frame: false` placement (guardrail #66)

```diff
 function createWindow(): void {
   mainWindow = new BrowserWindow({
     ...defaultWindowOptions,
+    frame: false,
     icon: path.join(__dirname, 'icon.png'),
```
`git diff --stat -- src/main/windowConfig.ts src/main/menu.ts` → **empty output** (confirmed via Bash, both files show zero diff). The Help window's construction call (`src/main/index.ts` around `onOpenHelp`) shows **no diff hunk at all** touching `helpWindow = new BrowserWindow({...})` — verified by grepping the diff around that block; the only changes near `onOpenHelp` are the unrelated `menuHandlers()` extraction. Confirmed by e2e test `window-chrome.spec.ts:45` ("the Help window is unaffected") which passed in the full run below.

### 3. Menu reuse, not duplication (guardrail #67 / ADR-005)

```ts
function menuHandlers(): MenuHandlers { return { onOpen: openFileViaDialog, ... onOpenHelp }; }
function applyMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(menuHandlers(), viewSettings)));
}
...
ipcMain.on(IPC_CHANNELS.POPUP_MENU, (_e, section, x, y) => {
  const index = menuSectionIndex(section);
  const template = buildMenuTemplate(menuHandlers(), viewSettings);
  Menu.buildFromTemplate(template[index].submenu as MenuItemConstructorOptions[]).popup({ window: mainWindow ?? undefined, x, y });
});
```
`applyMenu()` and the `POPUP_MENU` handler both call the same `menuHandlers()` and the same imported `buildMenuTemplate` — genuine shared closure, no drift. `src/main/menu.ts` is byte-identical (zero diff, confirmed above). `buildMenuTemplate`'s own body/return shape is untouched.

### 4. `menuSectionIndex` correctness

`src/main/menu.ts` (read in full) confirms the real array order is `File` (index 0), `View` (index 1), `Help` (index 2) — matches `{ file: 0, view: 1, help: 2 }` exactly.

No standalone unit test exists for `menuSectionIndex` (`grep -rn menuSectionIndex` across the repo finds only the definition, the one callsite, and spec references) — consistent with the established precedent (`shouldSkipDevToolsShortcut` is likewise index.ts-resident and proven only at the e2e level). `window-chrome.spec.ts` test (d) ("clicking each of File/View/Help pops up that section only") captures the real `Menu.buildFromTemplate` output per label click and asserts the exact item-id array per section (`['menu-open','menu-open-folder','separator','menu-exit']` for File, etc.) — a wrong index would return a different section's items and this assertion would fail. This test **passed** in the full run (see §9).

### 5. Maximize-state push correctness (guardrail #69)

```ts
function createWindow(): void {
  ...
  mainWindow.on('maximize', () => mainWindow?.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, false));
  ...
}
```
Registered inside `createWindow()`, not inside the `TOGGLE_MAXIMIZE_WINDOW` handler (which is registered separately, later, in `app.whenReady()`, and contains no state-push call). Confirmed by grepping `renderer.js` for `is-maximized`:
```
src\renderer\renderer.js:518:      windowMaximizeEl.classList.toggle('is-maximized', isMaximized);
```
— exactly one call site, and it lives only inside the `onWindowMaximizedState` callback (not inside either window-control click handler above it). The three window-control click handlers (`minimizeWindow()`, `toggleMaximizeWindow()`, `closeWindow()`) mutate no local state.

### 6. FI-1 fault injection — executed by hand, not trusted from DEVLOG

Backed up `src/main/index.ts`, commented out the two `mainWindow.on('maximize'/'unmaximize', ...)` lines via `sed`, rebuilt (`npm run build` succeeded — TypeScript has no complaint about the removed listeners), and ran:

```
npx playwright test tests/e2e/window-chrome.spec.ts -g "FI-1"
```
**RED**, real output:
```
Error: expect(locator).toHaveClass(expected) failed
Locator: locator('#window-maximize')
Expected pattern: /is-maximized/
Received string:  "window-control"
    at C:\Source\md-view\tests\e2e\window-chrome.spec.ts:343:34
1 failed
```
Restored the original file (`git diff --stat -- src/main/index.ts` afterward matched the pre-injection stat, `91 changed`, confirming an exact restore with no leftover artifact — also grepped for `FAULT-INJECTED` markers post-restore: 0 matches), rebuilt, re-ran the same command:
```
ok 1 tests\e2e\window-chrome.spec.ts:332:7 › ... maximizing via a non-button path (BrowserWindow.maximize()) still updates the button state (1.6s)
1 passed (2.3s)
```
**GREEN.** This is the single most load-bearing proof for the task and it holds.

### 7. `BridgeApi` additions — explicit, no passthrough (guardrail #71)

`src/preload/api.ts` diff adds exactly 5 named channels and 5 named `BridgeApi` methods (`minimizeWindow`, `toggleMaximizeWindow`, `closeWindow`, `popupMenu(section, x, y)`, `onWindowMaximizedState(callback)`). `src/preload/index.ts` diff implements each with a direct `ipcRenderer.send`/`ipcRenderer.on` call — no generic `invoke(channel, ...args)` anywhere in the new surface.

### 8. `-webkit-app-region` scoping (guardrail #70)

```
src\renderer\app.css:22:  -webkit-app-region: drag;      /* #title-bar */
src\renderer\app.css:27:  -webkit-app-region: no-drag;   /* .menu-label — 3 elements */
src\renderer\app.css:51:  -webkit-app-region: no-drag;   /* .window-control — 3 elements (incl. .window-control-close) */
```
Exactly two `no-drag` declarations covering exactly the six interactive elements (3 labels via `.menu-label`, 3 buttons via `.window-control`), one `drag` declaration on `#title-bar` itself. Also live-confirmed via `window-chrome.spec.ts` test (c), which reads `getComputedStyle(...).getPropertyValue('-webkit-app-region')` on all seven elements and asserts the exact expected values — **passed**.

### 9. Dark mode coverage

`app.css` diff includes `body.dark-mode #title-bar`, `body.dark-mode .menu-label`, `body.dark-mode .menu-label:hover`, `body.dark-mode .window-control:hover`, `body.dark-mode .window-control::before`, `body.dark-mode #window-maximize.is-maximized::after`, `body.dark-mode .window-control-close::before` — same per-selector pattern already used for `#status-bar`/`#tree-panel` since Task 8, no new mechanism.

### 10. Full test suite — run by this reviewer, not accepted from claims

```
npm run build                                         → succeeded (tsc + esbuild, no errors)
npx vitest run tests/unit tests/integration            → Test Files 22 passed (22); Tests 118 passed (118)
  (breakdown: tests/unit → 99 passed; tests/integration → 19 passed)
npx playwright test --workers=2                        → 84 passed (2.0m), zero failures
```
Raw tail of the e2e run confirms all `window-chrome.spec.ts` tests (11 total across describe blocks a–f) passed, and the pre-existing `tree-panel.spec.ts` FI-2 test at guardrail #34 (`dragging past the dynamic max at a shrunk (480x640) window...`) passed at `<=490`.

### 11. `tree-panel.spec.ts` tolerance widening — honesty check (Known Wrinkle)

Read the full test (`tests/e2e/tree-panel.spec.ts:284-324`). The changed line is only the synchronization-wait poll:
```diff
-await expect.poll(() => window.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(480);
+await expect.poll(() => window.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(490);
```
Immediately after, the test still reads the **real live value**:
```ts
const innerWidth = await window.evaluate(() => window.innerWidth);
const expectedMaxTreeWidth = innerWidth - 300; // MIN_MAIN_PANEL_WIDTH
...
expect(width).toBe(expectedMaxTreeWidth);
```
The actual guardrail #34 proof (the clamp tracks the live window width, not a stale/hardcoded value) is untouched — it derives its expectation from whatever `innerWidth` really is at that moment, exactly as before. The `<=490` change only widens the settle-detection window, not the correctness assertion. `backlog.md`'s new entry states the same reasoning and matches what was independently verified in the code, not just in prose:
> "this does not weaken guardrail #34's actual proof, which reads the real live `window.innerWidth` and derives every subsequent expectation from that value, exactly as it did before."

Confirmed sound. Not a finding.

### 12. Double-click-to-maximize investigation honesty (guardrail #74)

Read the full describe block (c) and its ~30-line comment in `window-chrome.spec.ts`. Three techniques were attempted (Playwright `dblclick`, `sendInputEvent` with `clickCount:2`, and a Win32 `mouse_event` OS-level injection) and none observed a transition to maximized; the third technique was independently confirmed to never have reached the app at all (a mousedown counter stayed at zero), which correctly disqualifies it as evidence of anything. The code's own conclusion — "not observed via techniques that cannot conclusively reach Electron's native non-client hit-test path" is *not* the same claim as "proven absent" — is logically sound and matches guardrail #74's actual conditional (manual handler required only if automatic behavior is *proven absent*). No manual handler was added; a light structural confirming test was substituted instead. This is the correct, conservative reading of an inconclusive investigation, not an excuse to skip work.

### 13. Test quality — not tautological

Spot-checked every test in `window-chrome.spec.ts`: minimize/maximize/close tests assert real `BrowserWindow.isMinimized()`/`isMaximized()` OS state (not mocked), the menu-popup tests monkey-patch `Menu.buildFromTemplate` to capture the *actually constructed* menu object and assert real item-id arrays (this also proves the popup path calls the real function, not a duplicate), and the "Open… inside popup" test asserts real rendered file content appears in `#content`. None of these merely assert "a function was called."

---

## Findings

### Should-fix

- **S1 — `app.css` diff includes a change outside the title-bar's own new rules that isn't explicitly called out in the technical spec's file list.** `#tree-panel`/`#tree-resize-handle`'s `top: 0` was changed to `top: var(--title-bar-height)` (new `--title-bar-height: 2rem` custom property added to `:root`). This is a legitimate, necessary consequence of adding a 2rem-tall fixed title bar above previously viewport-pinned fixed elements (otherwise the title bar would visually overlap the tree panel's top edge) and is within `app.css`'s granted scope — not a violation. However, `initial_scaffold.md`'s "File tree — Task 29 additions/changes" section only describes `app.css` gaining "`#title-bar` layout/drag-region rules, window-control button shapes, `body.dark-mode` variants" and doesn't mention this ripple into Task 21/26's fixed-positioning rules. No dedicated e2e assertion in `window-chrome.spec.ts` directly proves `#tree-panel` no longer overlaps `#title-bar` at this new height (the closest coverage is `tree-panel.spec.ts`'s pre-existing Task 26 guardrail #52 tests, which passed, but they assert the panel meets `#status-bar` at the bottom, not the title bar at the top). This is real but non-blocking: the full e2e suite passed, and a visual regression here would very likely have surfaced as a `#title-bar` visibility/clickability failure in test (a), which also passed. Recommend a follow-up task note (or a one-line addition to `window-chrome.spec.ts`) asserting `#tree-panel`'s `getBoundingClientRect().top` equals the title bar's height, to make this guarantee explicit rather than implicit.

### Nit

- **N1** — The FI-1 describe-block comment in `window-chrome.spec.ts` (lines ~324–331) states the fault-injection cycle "was performed by hand during implementation... not re-performed by this file at every run." This is honest and correctly scoped (a self-mutating test suite would be worse), but it does mean the RED/GREEN proof is not reproducible from the test file alone — it depended on this review re-executing it. Worth a one-line pointer in that comment to `review_report_task29.md` (this file) as the artifact of record for future readers, alongside the DEVLOG entry.

---

## Summary of raw evidence

- `git diff --stat -- src/main/windowConfig.ts src/main/menu.ts` → empty (zero diff), both files confirmed untouched.
- `npm run build` → clean, both before and after fault injection.
- `npx vitest run tests/unit tests/integration` → **118/118 passed** (99 unit + 19 integration).
- `npx playwright test --workers=2` → **84/84 passed**.
- `npx playwright test tests/e2e/window-chrome.spec.ts -g "FI-1"` → **RED** under fault injection (`Received string: "window-control"`, expected `/is-maximized/`), **GREEN** after restore.
- `git status`/`git diff --name-only` after restore → identical file list and diff stat to pre-injection state; no `FAULT-INJECTED` artifacts remain.

## Files relevant to this review

- `c:\Source\md-view\src\main\index.ts`
- `c:\Source\md-view\src\main\menu.ts` (zero diff, confirmed)
- `c:\Source\md-view\src\main\windowConfig.ts` (zero diff, confirmed)
- `c:\Source\md-view\src\preload\api.ts`
- `c:\Source\md-view\src\preload\index.ts`
- `c:\Source\md-view\src\renderer\index.html`
- `c:\Source\md-view\src\renderer\app.css`
- `c:\Source\md-view\src\renderer\renderer.js`
- `c:\Source\md-view\tests\e2e\window-chrome.spec.ts`
- `c:\Source\md-view\tests\e2e\tree-panel.spec.ts`
- `c:\Source\md-view\.agents\specs\decisions\ADR-005_md-view.md`
- `c:\Source\md-view\.agents\specs\backlog.md`
- `c:\Source\md-view\.agents\DEVLOG.md`
- `c:\Source\md-view\.agents\current_scope.json`

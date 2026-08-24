# Independent Code Review — Task 28 (View Menu Toggle: Show/Hide File Tree)

Reviewer: `code-reviewer` (read-only, independent of spec authorship and implementation)
Repo: `c:\Source\md-view`, branch `main`, working tree (uncommitted changes reviewed)

---

## Evidence Trail

### 1. Touched files vs. scope contract

`git diff --name-only`:
```
.agents/specs/functional_domain.md
.agents/specs/initial_scaffold.md
src/main/index.ts
src/main/menu.ts
src/renderer/app.css
src/renderer/renderer.js
tests/e2e/tree-panel.spec.ts
tests/e2e/view-menu.spec.ts
tests/unit/menu.test.ts
```

`.agents/current_scope.json` `in_scope`:
```
src/main/menu.ts, src/main/index.ts, src/renderer/renderer.js, src/renderer/app.css,
tests/e2e/view-menu.spec.ts, tests/e2e/tree-panel.spec.ts, tests/unit/menu.test.ts,
.agents/specs/backlog.md, .agents/DEVLOG.md, .agents/metrics/RUN_LOG.md,
.agents/specs/review_report_task28.md
```

**Verdict: in-scope.** All 7 implementation/test files the engineer touched are on the manifest. The two modified spec files (`functional_domain.md`, `initial_scaffold.md`) are the Lead's own Step 0/1 authoring of the Task 28 section (confirmed by reading the diff hunk — it is the exact spec text, not an engineer edit) and predate the scope contract; not an engineer scope violation. Note: `.agents/DEVLOG.md` and `.agents/specs/backlog.md` are in-scope but have **zero diff** — see Should-fix below, the plan explicitly called for a DEVLOG entry.

### 2. Guardrail-by-guardrail check against `git diff`

**#60 (default `true`, session-scoped, never persisted)**
```diff
-let viewSettings: ViewSettings = { darkMode: false, showFrontmatter: true };
+let viewSettings: ViewSettings = { darkMode: false, showFrontmatter: true, showTreePanel: true };
```
Confirmed. Also confirmed empirically: `view-menu.spec.ts` test `(d) close-and-relaunch proves no persistence of view settings` (pre-existing, still passing) exercises the same session-scoped mechanism `showTreePanel` now shares.

**#61 (single-file open never touches `showTreePanel`)** — `src/main/index.ts:225-232`:
```ts
async function renderAndWatch(filePath: string): Promise<void> {
  const message = await renderFile(filePath);
  sendToRenderer(message);
  if (message.ok) { startWatching(filePath); }
  await establishTreeRoot(path.dirname(filePath));
}
```
Zero diff on this function — confirmed via `git diff -- src/main/index.ts` (no hunk touches lines 225-232). Genuinely zero `showTreePanel` involvement. Backed by e2e test `tree-panel.spec.ts:948` ("opening a single file while the tree is hidden never changes showTreePanel"), which **passed** (see raw run below).

**#62 (check-then-act, only when previously `false`)** — `src/main/index.ts:79-84`:
```ts
function forceShowTreePanelAndRebuildMenu(): void {
  if (viewSettings.showTreePanel) return;
  viewSettings = { ...viewSettings, showTreePanel: true };
  broadcastViewSettings();
  applyMenu();
}
```
This is a genuine `if (already-true) return` guard — **not** an unconditional rebuild. Confirmed correct.

**Ordering (initial_scaffold.md plan step 5, force-before-`establishTreeRoot`)**:
```ts
async function openFolderViaDialog(): Promise<void> {
  ...
  forceShowTreePanelAndRebuildMenu();
  await establishTreeRoot(result.filePaths[0]);
}
```
and
```ts
if (isDirectory) {
  forceShowTreePanelAndRebuildMenu();
  await establishTreeRoot(filePath);
  return;
}
```
Both call sites confirmed to invoke the force+rebuild **before** `establishTreeRoot`, exactly per the plan.

**Builder reuse (no drifted handlers object)** — `applyMenu()` is a single shared function called both from `app.whenReady()` (replacing the old inline `Menu.setApplicationMenu(Menu.buildFromTemplate(...))` block) and from `forceShowTreePanelAndRebuildMenu()`. Confirmed via diff — the old inline block was deleted and replaced with `applyMenu();`, and `applyMenu()` is the *only* place the handlers object literal now exists. No duplicated/drifted second copy.

**#63 (DOM-state preservation across hide/show)** — CSS uses `display: none` only (no removal), and `renderer.js`'s only new line is a class toggle:
```js
document.body.classList.toggle('tree-panel-hidden', !settings.showTreePanel);
```
Backed by `tree-panel.spec.ts:970` ("hide/show preserves full tree DOM state") which uses the established `ipcMain._invokeHandlers` counting-wrapper idiom to assert `listDirectory` fires exactly once across an expand→hide→show cycle, and re-asserts the expanded children's labels are unchanged. **Passed.**
Gap: this test does **not** assert the Task-24 active-file highlight (`tree-row-active`) specifically survives the cycle, though guardrail #63's own text calls that out by name ("expanded folders, already-fetched children, the active-file highlight"). The `display:none` mechanism makes this very low risk, but it's an unasserted claim — see Should-fix below.

**#64 (`#main-panel` computed `marginLeft`, both directions)** — `view-menu.spec.ts` test `(f)` (lines 180-222) asserts `marginLeftBefore > 0`, then `marginLeftHidden === 0` after hiding, then `marginLeftShownAgain > 0` after re-showing — real computed-style assertions in both directions, not just class presence. **Passed.**

**#65 (checkbox state and real visibility must never diverge)** — `tree-panel.spec.ts:924` ("Open Folder… while the tree is hidden forces both the checkbox checked and the panel visible again") asserts **both** `checkedAfter === true` **and** `#tree-panel` visible in the same test, per the guardrail's explicit "not just one as a proxy for the other" requirement. **Passed.**

### 3. Test suites — raw output

**Unit** (`npm run test:unit`):
```
Test Files  18 passed (18)
     Tests  99 passed (99)
```
`tests/unit/menu.test.ts` now has 18 tests (was ~16), including the new `menu-show-tree-panel` structure/checked/click assertions — all pass.

**Integration** (`npm run test:integration`):
```
Test Files  4 passed (4)
     Tests  19 passed (19)
```

**E2E** (`npm run test:e2e`, full build + Playwright, 2 workers):
```
Running 71 tests using 2 workers
...
71 passed (1.8m)
[exited with code 0]
```
All pre-existing 68 e2e tests plus the 3 new Task 28-specific tests in `tree-panel.spec.ts` (lines 924, 948, 970) and the 1 new test in `view-menu.spec.ts` (line 180, `(f)`) pass. **No regressions** anywhere in the full suite (Task 8, 12, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27 suites all still green).

---

## Findings

### Blocking

**B-1. Missing test for guardrail #62's negative case: "Open Folder… while the tree is already visible must not trigger a redundant rebuild."**
`initial_scaffold.md` (lines 4056-4060) explicitly specifies this as a required test:
> "Open Folder… while the tree is already visible: assert no redundant menu rebuild artifact... assert the checkbox stays checked and the tree stays visible with no observable flicker/no-op side effect."

No such test exists in the delivered `tests/e2e/tree-panel.spec.ts` `describe('Task 28: Show File Tree toggle', ...)` block (only 3 tests: lines 924, 948, 970 — confirmed via `Grep` for "already visible"/"redundant"/"no-op" returning zero matches inside that block). The early-return branch `if (viewSettings.showTreePanel) return;` in `forceShowTreePanelAndRebuildMenu()` is new logic with no test that specifically proves it skips the rebuild/re-broadcast when already `true`. This is exercised *incidentally* by several pre-existing Task 24/27 tests that call Open Folder while the tree is already visible (and all pass), which mitigates real-world risk, but there is no assertion anywhere that would go red if this guard were changed to an unconditional rebuild — the exact regression the spec's own test plan was written to catch. Per the review checklist, missing test coverage on new logic explicitly called out in the approved spec is blocking.

**Recommendation:** route back to `full-stack-engineer` for one narrowly-scoped addition: a test asserting Open-Folder-while-visible leaves `menu-show-tree-panel` checked and `#tree-panel` visible with no incidental broadcast/flicker (spec section: `initial_scaffold.md` §Task 28, test-plan bullet 2).

### Should-fix (non-blocking)

**S-1. No test exercises the `REQUEST_OPEN_FILE` directory branch's force+rebuild specifically.** Both new "hidden→forced-true" and "already-true" Task 28 tests only drive `openFolderViaDialog()` via the `menu-open-folder` menu item. The dropped/opened-directory branch (`src/main/index.ts:358-359`) shares the same `forceShowTreePanelAndRebuildMenu()` function, so risk is low, but it is a distinct call site the plan calls out by name and it's untested for this specific behavior.

**S-2. Guardrail #63's explicit mention of "the active-file highlight (Task 24)" surviving a hide/show cycle is not directly asserted.** The new DOM-preservation test (`tree-panel.spec.ts:970`) checks expanded-folder labels and `listDirectory` call count, but does not check that `.tree-row-active` survives a hide/show cycle. Low risk given the `display:none`-only mechanism, but the guardrail text names this specifically.

**S-3. `.agents/DEVLOG.md` has zero diff**, despite `initial_scaffold.md`'s own file-tree plan (line 4039) calling for "an entry: first ViewSettings field with two independent write paths; first menu rebuild outside app.whenReady()." `.agents/DEVLOG.md` is in the scope manifest's `in_scope` list, so this isn't a boundary violation — it's an incomplete delivery against the plan's documentation requirement.

### Nit

**N-1.** `applyMenu()`'s comment ("Single, shared construction... rather than each independently maintaining its own copy of the handlers literal") is accurate and helpful; no issue, just noting the SOLID/Builder-reuse claim in `initial_scaffold.md`'s Pattern Application section is genuinely reflected in the diff, not just asserted.

---

## Architecture / SOLID scan (independent, not copied from the Lead's own scan)

- **SRP** holds: `setShowTreePanel` only updates+broadcasts; the menu-rebuild-on-forced-change responsibility lives in `forceShowTreePanelAndRebuildMenu`, called only from the two folder-opening call sites — confirmed by diff, matches the plan's SRP claim.
- **OCP**: `establishTreeRoot` has zero diff (confirmed via `Grep` — no hunk touches its body); the new behavior is additive at call sites, not a modification of shared logic.
- **DIP**: renderer's `onViewSettings` handler gained one line consuming one more field on the same payload shape — no new bridge/channel, confirmed in `renderer.js` diff.
- **CSS specificity**: `body.tree-panel-hidden #main-panel { margin-left: 0 }` (specificity 1-1-1) correctly overrides the base `#main-panel { margin-left: var(--tree-panel-width) }` (1-0-0) regardless of source order — verified by reading the full `app.css` selector list, no rule-ordering bug.

No new architectural boundary crossed; inward-dependency rule intact.

---

## Overall Verdict

**Not yet ready to ship — one Blocking item open (B-1).**

The implementation itself is correct and matches the approved spec precisely: the check-then-act guard is genuine, ordering is correct, the Builder is reused without drift, `renderAndWatch` is untouched, and all 189 tests across unit/integration/e2e (99 + 19 + 71) pass with zero regressions. However, the delivered test suite is missing the one test the approved `initial_scaffold.md` explicitly required to prove guardrail #62's "only when previously false" behavior in its negative direction (redundant-rebuild avoidance) — without it, a future regression to an unconditional rebuild would go undetected by the test suite. This must be routed back to `full-stack-engineer` as a narrowly-scoped addition before delivery. S-1/S-2/S-3 can be fixed in the same pass or deferred to backlog at the Lead's discretion, but B-1 blocks.

---

## Follow-up Review — 2026-08-24 (B-1/S-1/S-2 remediation, scope: tests/e2e/tree-panel.spec.ts only)

Reviewer: `code-reviewer` (read-only, independent)
Repo: `c:\Source\md-view`, branch `main`, HEAD `7ba0ac9`, working tree (uncommitted changes reviewed)

### 1. Scope compliance

`git diff --name-only` (full repo):
```
.agents/specs/functional_domain.md
.agents/specs/initial_scaffold.md
src/main/index.ts
src/main/menu.ts
src/renderer/app.css
src/renderer/renderer.js
tests/e2e/tree-panel.spec.ts
tests/e2e/view-menu.spec.ts
tests/unit/menu.test.ts
```
Identical file list to the prior review round. `git diff -- src/main/index.ts` was re-run and hunk-by-hunk compared against the exact hunks already quoted/verified in the original review (the `viewSettings` literal, `setShowTreePanel`, `applyMenu`, `forceShowTreePanelAndRebuildMenu`'s `if (viewSettings.showTreePanel) return;` guard, both call sites, `app.whenReady()` deletion/replacement) — byte-for-byte the same, confirming no drift in production code during this follow-up. **Only `tests/e2e/tree-panel.spec.ts` carries new content** (`git diff --stat` shows `228 ++` new lines, up from the previously-reviewed baseline), matching the claimed narrow scope.

Note: `.agents/current_scope.json` still lists the full original Task 28 file set rather than being narrowed to just `tests/e2e/tree-panel.spec.ts` for this delegation — not a violation (the actual diff proves only that one file was touched), but worth flagging to the Lead as a process gap for next time (Nit, not blocking).

### 2. B-1 — closed, with genuine discriminating evidence

New test, `tests/e2e/tree-panel.spec.ts:997`, *"Open Folder… while the tree is already visible does not trigger a redundant rebuild or change any observable state"*:

```ts
await collectViewSettingsEvents(window);        // registered immediately before the action
await mockOpenDialog(electronApp, path.join(fixtureTreeDir, 'sub'));
await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open-folder')?.click());

await expect(treeRow(window, 'deep.md')).toBeVisible();
await expect(window.locator('.tree-label', { hasText: /^notes\.md$/ })).toHaveCount(0);
...
expect(await viewSettingsEventCount(window)).toBe(0);
```

I traced every emitter of `IPC_CHANNELS.VIEW_SETTINGS` in `src/main/index.ts`: `broadcastViewSettings()` (line 33-34) is called from exactly four places — `setDarkMode`, `setShowFrontmatter`, `setShowTreePanel`, and inside `forceShowTreePanelAndRebuildMenu`'s guarded branch, plus one unconditional call at startup (`did-finish-load`, line 323, long before the test's listener is registered). `establishTreeRoot` (line 180-211) never calls `broadcastViewSettings` — confirmed by reading its full body; it only sends `FOLDER_TREE_ROOT`. Critically, in the current diff, `broadcastViewSettings()` and `applyMenu()` are **structurally paired under the same guard** in `forceShowTreePanelAndRebuildMenu`:

```ts
function forceShowTreePanelAndRebuildMenu(): void {
  if (viewSettings.showTreePanel) return;
  viewSettings = { ...viewSettings, showTreePanel: true };
  broadcastViewSettings();
  applyMenu();
}
```

So a zero-VIEW_SETTINGS-broadcast assertion is not a coincidental proxy — it is logically equivalent to "the rebuild branch never executed," because both statements live behind the identical `if` in the identical function body. If the guard were changed to unconditional, this test would flip from `0` to `1` and fail. This satisfies the review checklist's bar ("provably depends on the guard short-circuiting … not just an end-state that could coincidentally look the same either way"). The test also uses a genuinely different subfolder (`fixtureTreeDir/sub`) as its non-`showTreePanel` observable, so its liveness doesn't depend on the guard at all — a real second, independent signal that the action actually ran. **B-1 is closed.**

### 3. S-1 — closed

`tests/e2e/tree-panel.spec.ts:1043`, *"REQUEST_OPEN_FILE directory branch (drag/drop-a-folder path) …"* uses:
```ts
await electronApp.evaluate(
  ({ ipcMain }, { channel, dirPath }) => { ipcMain.emit(channel, {}, dirPath); },
  { channel: IPC_CHANNELS.REQUEST_OPEN_FILE, dirPath: fixtureTreeDir }
);
```
I confirmed this is the same idiom already present and passing in `tests/e2e/drag-drop.spec.ts:22-27` (`ipcMain.emit(channel, {}, filePath)` invoking the real registered main-process `ipcMain.on(REQUEST_OPEN_FILE, …)` listener directly — `ipcMain` is a plain `EventEmitter`, so this is the actual production handler, not a reimplementation). The new test exercises the directory branch specifically and asserts both `checkedAfter === true` and `#tree-panel` visible after starting hidden. **S-1 is closed.**

### 4. S-2 — closed

The strengthened hide/show test (`tree-panel.spec.ts:1071`) now asserts:
```ts
await expect(treeRow(window, 'notes.md')).toHaveClass(/tree-row-active/);
await expect(window.locator('.tree-row-active')).toHaveCount(1);
```
both before the hide/show cycle and after. I checked `src/renderer/renderer.js` directly (not the test's comment) and confirmed the production code genuinely uses this exact class name:
```
381:      activeRowEl.classList.remove('tree-row-active');
402:          row.classList.add('tree-row-active');
```
Class name matches production verbatim. **S-2 is closed.**

### 5. Test suite — raw output (run independently, not restated from the engineer)

**Unit** (`npm run test:unit`):
```
Test Files  18 passed (18)
     Tests  99 passed (99)
```
Unchanged from prior review — confirms zero regression in production logic.

**Integration** (`npm run test:integration`):
```
Test Files  4 passed (4)
     Tests  19 passed (19)
```

**E2E, run 1** (`npm run test:e2e`, full build + Playwright, 2 workers):
```
72 passed (2.4m)
1 failed: tests\e2e\tree-panel.spec.ts:351:7 › Task 23: tree panel drag-to-resize › dragging the handle does not trigger tree-node click/expand behavior (guardrail #35)
Error: worker process exited unexpectedly (code=3221226505, signal=null)
```
This is a Windows worker crash (STATUS_STACK_BUFFER_OVERRUN-class exit code) on an unrelated pre-existing **Task 23** test, not any Task 28 test, and not caused by this diff. All 5 Task 28 tests (lines 946, 970, 997, 1043, 1071) passed on this run.

**Isolated re-run of the crashed test** (`npx playwright test tests/e2e/tree-panel.spec.ts -g "dragging the handle does not trigger tree-node click"`, 1 worker):
```
1 passed (3.9s)
```

**E2E, full clean re-run** (`npm run test:e2e`, 2 workers):
```
73 passed (2.2m)
```
Confirms the earlier crash was the same known Windows parallel-worker flakiness the prior review round encountered — reproduced-and-cleared per the review protocol, not a silent assumption. Zero real regressions across 73/73 e2e, 99/99 unit, 19/19 integration.

### 6. Findings

**Blocking:** none.

**Should-fix:** none new. S-1 and S-2 from the prior round are now closed (see above). S-3 (`.agents/DEVLOG.md` zero diff) remains open — out of scope for this narrowly-scoped follow-up (which correctly touched only `tests/e2e/tree-panel.spec.ts`), carried forward for the Lead to close before final delivery.

**Nit:** `.agents/current_scope.json` was not narrowed to reflect the actual narrow delegation scope for this round; recommend tightening scope manifests to match delegation prompts going forward for stronger boundary enforcement (does not affect this delivery — the diff itself proves compliance).

### 7. Overall verdict

**B-1 is closed** with a test that provably depends on `forceShowTreePanelAndRebuildMenu()`'s guard short-circuiting (zero-broadcast-delta assertion, structurally tied to the guarded `broadcastViewSettings()`/`applyMenu()` pair), not merely an end-state that would look identical either way. **S-1 and S-2 are also closed**, using genuine reuse of the `drag-drop.spec.ts` `ipcMain.emit` idiom and the real production `tree-row-active` class name respectively. All test suites pass (99 unit + 19 integration + 73 e2e), with one isolated, reproduced-as-flaky Windows worker crash on an unrelated pre-existing Task 23 test, cleared by a clean re-run. **Ready to ship** for Task 28, contingent only on the Lead separately deciding whether to close out S-3 (DEVLOG.md) before final delivery.

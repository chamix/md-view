# Independent Code Review - Task 7: UI Shell Polish (Native Menu, Empty State, Content Margin, Status Bar)

**Verdict: BLOCKED**

**Blocking findings: 1**
**Should-fix findings: 1**
**Nit findings: 1**

Reviewed by: code-reviewer subagent (read-only tools only). Evidence obtained by running
`git diff`, `git status --porcelain`, `npm run build`, `npm test` (bare command), targeted
`grep`, and direct file reads myself in this session. No claim below is restated from the
engineer's own report without independent reproduction.

---

## 1. Blocking Finding: Inverted DevTools guard - reachable in packaged builds, dead in dev

File: `src/main/index.ts`, line 45.

```
mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (!app.isPackaged) return;
    const isDevToolsShortcut =
      input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i');
    if (isDevToolsShortcut) {
      mainWindow?.webContents.toggleDevTools();
    }
});
```

The condition is `if (!app.isPackaged) return;`. Since `app.isPackaged` is `false` in
every dev/test run, `!app.isPackaged` evaluates to `true`, so the listener returns
immediately and does nothing during development. Conversely, in a real packaged
(shipped) build, `app.isPackaged` is `true`, `!app.isPackaged` is `false`, the `return`
is skipped, and the F12 / Ctrl(Cmd)+Shift+I shortcut successfully calls
`mainWindow.webContents.toggleDevTools()`.

This is the exact logical inverse of what both approved specs require:

- `functional_domain.md` section "Task 7", Edge-Case Invariant Guardrail #3: "A
  developer affordance (inspecting the running app) is not a product feature and must
  never be reachable in a shipped build."
- `initial_scaffold.md` section "Task 7 Technical Specification", authoritative
  illustrative wiring block: `if (app.isPackaged) return;` - note the absence of the
  `!` negation in the spec's own example. The implementation added a `!` that the
  spec's illustrative code does not have.

As implemented, the DevTools shortcut is reachable in the shipped app (the exact
scenario the guardrail forbids) and unreachable in development (defeating the stated
purpose of "a safety net that replaces the previously-implicit access to developer
tooling" during dev work).

Why this wasn't caught: zero test coverage exists for this listener.

```
grep -rn "before-input-event|toggleDevTools|F12|DevTools" tests/
-> No files found
```

Automated e2e tests always run unpackaged (`app.isPackaged === false`), so even if a
test had asserted "DevTools shortcut does nothing," it would have passed for the wrong
reason (the early-return path), and no test exercises the packaged branch at all. The
bug is real but silent under the current test suite.

Required fix: change line 45 to `if (app.isPackaged) return;` (remove the `!`), and
add a regression test that exercises both branches of the `app.isPackaged` predicate
(e.g. by extracting the shortcut-decision as a pure/testable function, or mocking
`app.isPackaged` in an integration test), since a full packaged-build e2e run is
impractical for this repo's test setup.

Severity: Blocking. This is a direct violation of an explicit, numbered edge-case
guardrail in the approved functional domain spec, not a style nit - it inverts a
security/product-hygiene invariant the task was specifically created to enforce.

---

## 2. Should-Fix: No regression test for the DevTools gating behavior

Related to Finding 1 but recorded separately per the review checklist's "anything
touched that isn't covered by a test at all" item. The `before-input-event` listener
is new logic introduced by this task and has exactly zero test coverage of any kind
(unit, integration, or e2e). Even after Finding 1 is fixed, this listener should not
ship without a test that pins down its intended behavior in both the packaged and
unpackaged cases, given it already regressed once with no test to catch it.

---

## 3. Nit: Misleading comment

`src/main/index.ts` lines 41-43, directly above the buggy guard, read: "Developer
affordance only - never reachable in a shipped build, and never surfaced as a
discoverable menu entry." The comment correctly states the intended contract but the
code beneath it currently does the opposite. Once Finding 1 is fixed the comment
becomes accurate again; flagging only so it is not mistaken for intentional-but-odd
behavior in the interim.

---

## Evidence Trail - Checklist Items Verified

### Touched-file list vs. .agents/current_scope.json

```
git diff --name-only (modified, tracked):
  .agents/specs/functional_domain.md
  .agents/specs/initial_scaffold.md
  package.json
  src/main/index.ts
  src/preload/api.ts
  src/preload/index.ts
  src/renderer/index.html
  src/renderer/renderer.js
  tests/e2e/live-reload.spec.ts
  tests/e2e/open-file-argv.spec.ts
  tests/integration/preload-api-contract.test.ts

git status --porcelain (untracked, new):
  .agents/current_scope.json
  src/main/menu.ts
  src/renderer/app.css
  tests/e2e/ui-shell.spec.ts
  tests/test-content/          <- pre-existing, see note below
  tests/unit/menu.test.ts
  tests/unit/statusBarText.test.ts
```

Every code/test file above (excluding `.agents/*` and `tests/test-content/`) matches
`.agents/current_scope.json`'s `in_scope` array exactly. No out-of-scope source file
was touched.

`tests/test-content/` (a manual fixture directory: a Spanish-language GFM test
document plus `assets/sample-diagram.svg` and `assets/sample-image.png`) is not part
of this task's diff and predates this review session - it was already the sole
untracked item in `git status` before any Task 7 work began, per the environment's
initial git status snapshot provided at the start of this review. Not attributable to
the Task 7 engineer; not a scope violation, informational only.

### Untouched files confirmed via empty diff

```
git diff -- src/main/windowConfig.ts src/main/markdown.ts src/main/watcher.ts src/main/linkPolicy.ts src/main/paths.ts
-> (empty output)
```

Confirms `windowConfig.ts` (contextIsolation/nodeIntegration/sandbox), `markdown.ts`,
`watcher.ts`, `linkPolicy.ts`, and `paths.ts` are byte-identical to `main`. Task 7 did
not touch any of the security/rendering core established by Tasks 2-6.

### buildMenuTemplate - pure data, no Electron Menu calls

`src/main/menu.ts` (full file, 15 lines) exports `buildMenuTemplate(handlers: {
onOpen: () => void }): MenuItemConstructorOptions[]`, returning one `File` submenu
with `menu-open` (label, accelerator `CmdOrCtrl+O`, click), a separator, and
`menu-exit` (label, `role: 'quit'`).

```
grep -n "Menu.(buildFromTemplate|setApplicationMenu)" src/main/menu.ts
-> No matches found
```

Signature matches `initial_scaffold.md` section "Task 7 Technical Specification"
exactly. Only a type-only import of `MenuItemConstructorOptions` - no runtime
Electron `Menu` dependency in this file. The impure `Menu.buildFromTemplate(...)` /
`Menu.setApplicationMenu(...)` calls live in `src/main/index.ts` line 110, matching the
spec's Inward Dependency Rule placement.

### OPEN_FILE_DIALOG / openFileDialog / #open-file-btn - complete removal

```
grep -rn "OPEN_FILE_DIALOG|openFileDialog|open-file-btn" src/
-> No matches found

grep -rn "OPEN_FILE_DIALOG|openFileDialog|open-file-btn" tests/
-> tests\e2e\ui-shell.spec.ts:21:  await expect(window.locator('#open-file-btn')).toHaveCount(0);
```

The only surviving reference is the expected `toHaveCount(0)` absence assertion in the
new e2e spec - proof of removal, not a leftover live reference. `src/preload/api.ts`
diff removes `OPEN_FILE_DIALOG` from `IPC_CHANNELS` and `openFileDialog()` from
`BridgeApi`; `src/preload/index.ts` diff removes the `ipcRenderer.send(...)`
implementation; `tests/integration/preload-api-contract.test.ts` diff removes both
`OPEN_FILE_DIALOG` assertions plus the now-meaningless distinct-channel-names test
(per the spec's own "engineer's call" allowance).

### Single shared dialog-opening path (no duplication)

`src/main/index.ts` diff:

```
- ipcMain.on(IPC_CHANNELS.OPEN_FILE_DIALOG, async () => { ... });   // REMOVED
+ async function openFileViaDialog(): Promise<void> {
+   const result = await dialog.showOpenDialog({ ... });
+   if (result.canceled || result.filePaths.length === 0) return;
+   await renderAndWatch(result.filePaths[0]);
+ }
  ...
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate({ onOpen: openFileViaDialog })));
```

Old `ipcMain.on(IPC_CHANNELS.OPEN_FILE_DIALOG, ...)` handler body is gone (`ipcMain`
is no longer even imported - import line changed from `dialog, ipcMain, shell` to
`dialog, Menu, shell`). `openFileViaDialog` is the single dialog-trigger function,
wired as the menu's `onOpen`, and both it (dialog path) and the argv path
(`app.whenReady().then(...)` -> `did-finish-load` -> `renderAndWatch(filePath)`)
converge on the same `renderAndWatch` function. No duplicated orchestration logic -
guardrail #2 satisfied.

### windowConfig.ts diff - empty (see "Untouched files" above, confirmed).

### DevTools gating - see Finding 1 (Blocking)

Confirmed via `grep -n "isPackaged" src/main/index.ts` -> two matches: line 45 (the
bug) and line 55 (pre-existing, correct, unrelated `argvFilePath` usage). Not
surfaced as a menu item - confirmed, `menu.ts` has only `menu-open` and `menu-exit`,
no DevTools-related entry.

### statusBarText purity and wiring

`src/renderer/renderer.js` diff adds:

```
function statusBarText(message) {
  if (!message || !message.filePath) return 'No file open';
  return message.filePath;
}
```

Follows the exact `typeof document` / `typeof module` guard pattern already
established by `applyRenderedContent` (defined above the `typeof document !==
'undefined'` block; exported via `module.exports = { applyRenderedContent,
statusBarText }` inside the `typeof module !== 'undefined'` block). Real call site,
quoted exactly (line 37 of the file after edit):

```
statusBarEl.textContent = statusBarText(message);
```

```
grep -n "textContent = statusBarText|innerHTML" src/renderer/renderer.js
-> line 34: (comment) Hard contract: textContent only, never innerHTML ...
-> line 37: statusBarEl.textContent = statusBarText(message);
-> line 57: container.innerHTML = markup;
```

Confirms this is the only assignment to `statusBarEl`, and the only other `innerHTML`
usage in the file (`container.innerHTML = markup`, line 57) is the pre-existing,
unrelated rendered-content path from Tasks 2/6 - `statusBarEl` is never assigned via
`.innerHTML` anywhere in the diff. Hard contract satisfied.

### Empty-state one-way hide logic

```
const hideEmptyState = () => {
  if (emptyStateEl) {
    emptyStateEl.hidden = true;
  }
};
...
window.mdview.onFileRendered((message) => {
  hideEmptyState();
  updateStatusBar(message);
  if (message.ok) { renderHtml(...); } else { renderError(...); }
});
```

`hideEmptyState()` is called unconditionally at the top of the `onFileRendered`
handler for both `ok` and error variants, and only ever sets `hidden = true` (never
`false` anywhere in the diff or file) - genuinely one-way/idempotent. A later error
after a successful first render (or vice versa) re-invokes `hideEmptyState()` but it
is already `true` and stays `true`. Guardrail #5 satisfied by actual wiring, not
merely by the element's presence.

### e2e trigger-path updates preserve original test intent

`tests/e2e/open-file-argv.spec.ts` diff (non-.md rejection test): only the trigger
line changed, from `window.click('#open-file-btn')` to `app.evaluate(({ Menu }) =>
Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click())`; the mocked
`dialog.showOpenDialog` setup, the non-md fixture path, and the `toContainText('Could
not open file')` assertion are all unchanged - confirmed via diff, no assertion lines
touched.

`tests/e2e/live-reload.spec.ts` diff (watcher-handoff-on-switch test): same pattern,
only the trigger line replaced; the `toContainText('File B Heading')` assertion and
prior watcher-close setup are unchanged. Both test intents preserved, not diluted.

### preload-api-contract.test.ts - zero remaining OPEN_FILE_DIALOG references

```
grep -n "OPEN_FILE_DIALOG" tests/integration/preload-api-contract.test.ts
-> No matches found
```

### Build and full test suite - reproduced myself

```
$ npm run build
> tsc -p tsconfig.json && npx esbuild ... && node -e "...copyFileSync(... app.css ...)"
  dist\preload\index.js  493b
Done in 4ms
```

Build succeeds; the `app.css` copy step is present and functioning (confirms the
`package.json` diff's build-script addition works, not just parses).

```
$ npm test
> md-view@0.1.0 test
> npm run test:all
> npm run test:unit && npm run test:integration && npm run test:e2e

Test Files  8 passed (8)
     Tests  36 passed (36)      <- tests/unit

Test Files  3 passed (3)
     Tests  6 passed (6)        <- tests/integration

Running 13 tests using 4 workers
  ok  1..13  (all 13 listed "ok", including:
      ui-shell.spec.ts:12  no-argv launch ...
      ui-shell.spec.ts:30  argv launch ... )
  13 passed (12.9s)             <- tests/e2e
```

Bare `npm test` resolves to the full suite (unit + integration + e2e) with no
"missing script" error, per the standing addendum instruction. Total: 36 + 6 + 13 =
55/55 tests passed. This confirms all new tests (`menu.test.ts`, `statusBarText.test.ts`,
`ui-shell.spec.ts`) pass, and no existing test regressed - but per Finding 1, passing
tests do not cover the DevTools gating logic, so "all green" does not mean "guardrail
#3 is satisfied" in this case.

### Unit test case-by-case match to spec's exact list

`tests/unit/menu.test.ts` (4 tests) - matches all 4 spec-mandated cases: top-level
File item with 3 submenu entries; menu-open label/accelerator/click
reference-equality; separator type; menu-exit label/role. Confirmed by direct read,
not tautological (the reference-equality check on `click` genuinely proves wiring,
not just presence of a function).

`tests/unit/statusBarText.test.ts` (4 tests) - matches all 4 spec-mandated cases
(null, ok+filePath, error+null filePath, error+filePath) verbatim, including the
exact input/output pairs specified in initial_scaffold.md.

`tests/e2e/ui-shell.spec.ts` (2 tests, cases a-d) - case (a): no-argv, asserts
h1/#open-file-btn absent (count 0), empty-state visible, status bar text "No file
open". Case (b): argv launch, empty-state hidden, status bar text equals the real
fixture absolute path. Case (c): #content computed paddingLeft/paddingRight both
greater than 0. Case (d): `statusBar.evaluate(el => el.innerHTML === el.textContent)`
asserted true - the exact contract-proof test the user required after reviewing the
blueprint is present and passing.

### Spec files (functional_domain.md, initial_scaffold.md) modified-in-diff - benign, confirmed by file-write-time ordering

```
Get-Item ... | Select-Object Name, LastWriteTime
functional_domain.md   8/3/2026 9:00:18 PM
initial_scaffold.md    8/3/2026 9:10:44 PM
current_scope.json     8/3/2026 9:10:54 PM
menu.ts                8/3/2026 9:12:04 PM
menu.test.ts           8/3/2026 9:12:29 PM
```

Both spec files were last modified before `current_scope.json` was written, and
`current_scope.json` was written before the first implementation file
(`src/main/menu.ts`) was created. This ordering is consistent with the Lead authoring
both spec sections during Step 0/1 planning, then opening the scope contract, then
handing off to the engineer for Step 2 - not with the engineer editing
governance/spec files during implementation. Content-wise, both diffs read as pure
planning prose (Functional Domain Assessment format; Technical Specification Mapping
format with Inward Dependency Rule / SOLID Boundary Scan / Pattern Application
headers) consistent with the Lead's own authoring voice elsewhere in the same files,
not implementation-driven edits - no diff hunk references a concrete bug found during
coding or an implementation detail that would only be known post-implementation.
Confirmed benign, not a governance violation.

---

## Summary Table

| # | Item | Verdict | Evidence |
|---|------|---------|----------|
| 1 | buildMenuTemplate pure / no Electron Menu calls inside | Pass | menu.ts read + grep |
| 2 | OPEN_FILE_DIALOG / openFileDialog / #open-file-btn fully removed | Pass | grep src/, tests/ |
| 3 | Old IPC handler deleted, single shared openFileViaDialog path | Pass | index.ts diff + full read |
| 4 | windowConfig.ts diff empty | Pass | git diff empty output |
| 5 | DevTools gate on app.isPackaged, not a menu item | FAIL | index.ts:45, inverted condition |
| 6 | statusBarText pure + wired via .textContent only | Pass | renderer.js diff + grep |
| 7 | Empty-state hide is genuinely one-way | Pass | renderer.js read |
| 8 | e2e trigger-path updates preserve original test intent | Pass | diff of both spec files |
| 9 | preload-api-contract.test.ts has zero OPEN_FILE_DIALOG refs | Pass | grep |
| 10 | npm run build + npm test reproduced | Pass | 55/55 tests green |
| 11 | Spec-file diffs benign (planning, not implementation-driven) | Pass | timestamp ordering + content read |

**Do not proceed to delivery.** Route Finding 1 back to `full-stack-engineer` as a
narrowly-scoped fix: flip the condition on `src/main/index.ts` line 45 (remove the
`!`) and add a regression test for the `app.isPackaged` branch behavior of the
DevTools shortcut guard, then re-review.

---

# Re-Review After Fix — DevTools Guard Polarity (2026-08-03)

## Verdict: **APPROVE**

All evidence below was independently gathered in this session (`git diff`, `npm run build`, `npm test`, file reads, `Get-ChildItem` timestamp checks). No claim is restated from the engineer's report without reproduction.

---

## 1. Polarity fix — confirmed correct

`src/main/index.ts`:

```
44	  mainWindow.webContents.on('before-input-event', (_event, input) => {
45	    if (shouldSkipDevToolsShortcut(app.isPackaged)) return;
...
58	export function shouldSkipDevToolsShortcut(isPackaged: boolean): boolean {
59	  return isPackaged;
60	}
```

`shouldSkipDevToolsShortcut` returns `true` (skip) only when `isPackaged` is `true`, and the real listener calls it with `app.isPackaged` and bails on `true`. This is the exact inverse of the prior bug (`if (!app.isPackaged) return;`) and now matches `initial_scaffold.md`'s illustrative wiring (`if (app.isPackaged) return;`, line 705) exactly. Confirmed by direct read, not just diff.

## 2. New regression test — genuinely pins the polarity

`tests/e2e/ui-shell.spec.ts:30-65`, `DevTools shortcut guard: unreachable when packaged, reachable in dev builds`:

```
44	  const isPackaged = await app.evaluate(({ app }) => app.isPackaged);
45	  expect(isPackaged).toBe(false);
...
50	    const guard = (globalThis as Record<string, unknown>).__mdViewDevToolsGuardForTests as (...) => boolean;
53	    return { skipWhenPackaged: guard(true), skipWhenDev: guard(false) };
...
60	  expect(guardResults.skipWhenPackaged).toBe(true);
62	  expect(guardResults.skipWhenDev).toBe(false);
```

This calls the actual shipped function reference (via the bridge), not a reimplementation copy — reintroducing the old bug (`return !isPackaged`) would flip both assertions and fail the test immediately. Combined with a direct source read confirming the real listener calls this exact function with `app.isPackaged`, both directions of the guard's polarity are proven, not just its existence. Not tautological.

## 3. `globalThis.__mdViewDevToolsGuardForTests` bridge — Should-fix, not Blocking

```
69	(globalThis as Record<string, unknown>).__mdViewDevToolsGuardForTests = shouldSkipDevToolsShortcut;
```

This line runs **unconditionally** at module load in every build, packaged or not — it is not gated on `!app.isPackaged`.

Independent judgment: the guardrail's protected subject is "a developer affordance (inspecting the running app)... must never be reachable in a shipped build," and the actual capability (`toggleDevTools()`) *is* correctly gated by `shouldSkipDevToolsShortcut(app.isPackaged)`. The bridge itself exposes only a trivial identity predicate (`isPackaged => isPackaged`), never surfaces a menu entry, and is never passed through `contextBridge` to the renderer — it lives in main-process Node memory, which isn't attacker-reachable via any avenue this app opens up. So this is not an exploitable surface and does not defeat the guardrail's actual protected behavior.

That said, it is a letter-of-the-spec wrinkle: guardrail #3 says the safety net "must be conditioned on the build being a development build," and shipping *any* unconditional test-instrumentation global — even an inert one — in packaged production code is a design smell (SRP: `index.ts` now also serves as a test-instrumentation host in all builds, not just dev). Recommend gating the assignment behind `!app.isPackaged` in a follow-up, but this does not block delivery.

**Verdict: Should-fix (non-blocking).**

## 4. Build and full test suite — reproduced myself

```
$ npm run build
  dist\preload\index.js  493b
Done in 4ms

$ npm test
Test Files  8 passed (8)
     Tests  36 passed (36)     <- unit
Test Files  3 passed (3)
     Tests  6 passed (6)       <- integration
Running 14 tests using 4 workers
  ... 14 passed (16.3s)        <- e2e (13 prior + 1 new guard test)
```

Total: 36 + 6 + 14 = **56/56 passed**, including the new `ui-shell.spec.ts:30` DevTools guard test.

## 5. Scope check — narrowly scoped, confirmed via timestamps (no prior commit to diff against, since Task 7 is uncommitted)

`Get-ChildItem` `LastWriteTime` on all files touched since Task 7 began: `review_report_task7.md` was written **9:26:26 PM**. Every file except `src/main/index.ts` (9:38:03 PM) and `tests/e2e/ui-shell.spec.ts` (9:39:47 PM) has a `LastWriteTime` at or before 9:17:04 PM — strictly before the report. This corroborates that only the two named files changed in the follow-up. Both are also already declared in `.agents/current_scope.json`'s `in_scope` array (paths 6 and 16) — no scope violation.

---

## Updated Summary Table

| # | Item | Verdict |
|---|------|---------|
| 1 | DevTools guard polarity fixed (`app.isPackaged` gates skip) | Pass |
| 2 | Regression test pins guard behavior in both directions | Pass |
| 3 | `globalThis` test bridge — reachability/security concern | Pass (Should-fix: gate behind `!app.isPackaged`, non-blocking) |
| 4 | Build + full suite green | Pass — 56/56 |
| 5 | Fix stayed narrowly scoped to the two named files | Pass |

**Do proceed to delivery.** No Blocking items remain.

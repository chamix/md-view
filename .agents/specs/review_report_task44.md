# Review Report: Task 44 — Close document (File > Close, Ctrl+W)

**Reviewer:** `code-reviewer` subagent (independent, read-only; it did not write the spec or the code). The Lead saved this report on the reviewer's behalf, verbatim, because the reviewer has no Write tool.

Branch `feature/044-close-document`, `HEAD == main == c8f5e20`, so every change is an uncommitted working-tree change.

Spec: `functional_domain.md` Task 44 (#145-#155 and the out-of-scope list), `initial_scaffold.md` Task 44 Step 1 and the 8 binding approval conditions.

## Verdict (round 1): APPROVED WITH NON-BLOCKING ITEMS (0 Blocking, 0 Should-fix, 5 Nits)

I ran the full `npm run test:all` myself. It passed with exit 0: unit 192/192, integration 52/52, e2e 122/122. I also ran 8 fault injections, each followed by a proven restore. Every injection went RED for the reason claimed, so the tests do catch the regressions they claim to guard.

---

## Blocking
None.

## Should-fix
None.

## Nits

**N1. The `.catch` on the watch re-render slightly changes error handling, and it is harmless.** (`src/main/documentSession.ts`, lines 57-61 of the file)
- `renderFile` (`index.ts` ~259-277) catches every I/O and parse error itself, so it never rejects.
- The only thing the new `.catch` can catch is a throw from `deliver` (for example `webContents.send` on a destroyed window).
- Before this change, that throw was an unhandled rejection from `renderFile(filePath).then(sendToRenderer)`. Now it is logged with `console.error`.
- Normal behavior does not change. It was disclosed, and I accept it.

**N2. After Close, `#frontmatter` is hidden but still holds the old frontmatter text.** (`renderer.js` onDocumentClosed)
- `updateFrontmatterVisibility()` with `lastMessage = null` hides the element but never clears its `textContent`.
- #146 only requires "hidden", so this passes. Nothing can show that text again, because `shouldShowFrontmatter(null, …)` is false and the next open overwrites it.
- However, the DOM is not byte-identical to launch, where the `<pre>` is empty. `frontmatterEl.textContent = ''` would make it exact. Optional.

**N3. The Ctrl+W half of e2e (c)'s "nothing open is inert" check proves nothing on its own.** (`close-document.spec.ts:199-204`)
- A disabled menu item's accelerator never reaches the handler. In fault injection E1 below, two triggers (Ctrl+W and a direct `click()`) produced `documentClosed: 1`, so only the direct click got through.
- The test still catches the regression, because `MenuItem.click()` ignores `enabled` (E1 went RED).
- The comment "the accelerator, and even a direct click … are both inert" could say that only the direct click tests the session.

**N4. The "Protection Proxy" label is loose.** `deliver` is a private guard function (a single guarded choke point), not an object that implements the subject's interface as a GoF Proxy does.
- The structural property the spec needs does hold: it is the only caller of `sendFileRendered` (grep below).
- Only the name is off.

**N5. `documentSession` is a module-level `const` declared at `index.ts:332`, but it is referenced from functions declared above it** (`menuHandlers` :113, `applyMenu` :154).
- This is safe today: those functions are first called inside `app.whenReady()` (:492), which runs after the module has finished evaluating.
- A future top-level `applyMenu()` above line 332 would throw a TDZ `ReferenceError`. Fragile ordering, not a defect.

**Info (not this task):** the engineer's report that a file opened through an 8.3 short path gets no tree highlight is a plausible pre-existing issue: the main process canonicalizes the tree root, but `isPathUnder` compares raw strings. It is not addressed or worsened here. I recommend a `backlog.md` entry. The e2e fixture's `realpathSync.native` workaround is test-side only and does not weaken any assertion.

---

## Per-guardrail table (#145-#155)

| # | Status | Evidence |
|---|---|---|
| 145 | PASS | A failed open still occupies the slot. Unit test "an error delivery also occupies the slot (#145)" checks `isOpen()` is true and `occupancyCalls` is 1. e2e (f) checks `#empty-state` is hidden and `menu-close` is enabled after the error. The renderer comment was rewritten with the disclosed supersession: "Task 44 #145 lifts Task 7 guardrail 5's 'never shown again …' for the Close path only -- a disclosed, intentional supersession". |
| 146 | PASS | `expectPristineDocumentView` is shared by the launch test in `ui-shell.spec.ts` and by close-document (a), (b), (c), (e), (f), (h). E5 (launch) and E6 (tree highlight after Close) both went RED. `#document-container` is asserted visible. |
| 147 | PASS | `close()` calls `stopWatching()` (documentSession.ts:135). Unit test: "close … stops the watch (zero active)". e2e (e) went RED under E2. |
| 148 | PASS | e2e (e) and the error-state (f) assert `fileRendered === 0` after a save once Close has run. Both went RED under E2 (`Expected: 0 Received: 1`). |
| 149 | PASS | One choke point (grep below). The unit tests for an invalidated open cover no send, no watch and no tree root, plus the watcher-render case. M1 and M2 went RED. |
| 150 | PASS | `slot.close()` does nothing when empty, epoch included (slot unit test "a pre-close token still delivers"). Session unit test: 0 notifications, 0 occupancy calls. e2e (c) counts are `{0,0,0}`, and E1 went RED (`documentClosed 1`, `setApplicationMenu 1`). |
| 151 | PASS | `menu.ts` diff: id `menu-close`, label `Close`, `CmdOrCtrl+W`, `enabled: documentOpen`, placed after `menu-open-folder`. The third parameter is required (`documentOpen: boolean`, not optional). Both production call sites pass `documentSession.isOpen()` (`index.ts:154`, `:597`). Unit tests cover the 7-entry order and both enabled values. e2e (a), (d) (popup) and (g) (no rebuild on re-render) pass, and E3 went RED on (g). |
| 152 | PASS | `close()` touches only the watch, `sendDocumentClosed` and `applyMenu`, which never persists anything. e2e (h) confirms settings.json and state.json have the same content and mtime. e2e (b) confirms dark mode and the Code tab are unchanged, both in the renderer and in the menu `checked` state. |
| 153 | PASS | Open Folder, the directory branch of REQUEST_OPEN_FILE and REQUEST_TREE_PARENT never touch the session (`index.ts:530-534`, `:569-572`). e2e (h) confirms Open Folder leaves `menu-close` disabled and the view pristine. e2e (b) confirms the tree rows and expanded `sub/` survive Close. |
| 154 | PASS | `api.ts` diff: +1 `IPC_CHANNELS` entry (`DOCUMENT_CLOSED`) and +1 method (`onDocumentClosed`); `FileRenderedMessage` is untouched. `preload/index.ts:52` uses `() => callback()`, so no event object is forwarded (verified by reading the code; see "Test quality"). There is no `ipcMain` handler for a close channel. |
| 155 | PASS | The renderer only assigns empty text (`textContent = ''`, `setAttribute('href','')`). `external-links.spec.ts`, `html-comments.spec.ts`, `window-config.test.ts`, `markdown.test.ts`, `isExternalHttpUrl.test.ts`, `windowConfig.ts` and `markdown.ts` are all absent from `git diff --name-only main` and all passed in the full run. |

## Per-condition table (1-8)

| # | Status | Evidence |
|---|---|---|
| 1 | PASS | `git diff --quiet main -- <f>` is UNCHANGED for all four specs. In the full run: live-reload 3, open-file-argv 3, drag-drop 9, tree-panel 31 = **46/46** ok, 0 failed. |
| 2 | PASS | The old and new code match line by line (see "Behavior preservation" below). The failed-open lingering watcher is preserved and pinned by a unit test and by e2e "(f) pinned". E4, which "fixes" the lingering watcher, made the pinned e2e go RED after the full 15 s `toPass`. |
| 3 | PASS | Grep output is below. M1 (guard removed) failed exactly the two condition-3 tests: `(condition 3, watch)` and `(condition 3, tree root)`. |
| 4 | PASS | The folder paths are still in `index.ts` and contain no `documentSession` reference (grep below lists every `documentSession.` use). |
| 5 | PASS | The helper keeps all 3 original assertions (`#empty-state` visible, "No file open", `#copy-raw-source` disabled). The `h1` and `#open-file-btn` checks stay local to `ui-shell.spec.ts`. I re-ran the fault injection (E5) and it went RED. The injected line is gone: `cmp` shows `dist/renderer/{renderer.js,index.html}` identical to `src`, and `emptyStateEl` appears only at renderer.js:79 and :113-114. |
| 6 | PASS | The ordering comment is in `renderer.js:260-266`. My independent check that nothing else depends on the ordering is below. |
| 7 | N/A (process) | Showing the scope to the user is a Lead/user interaction that the reviewer cannot verify. I did confirm that the manifest contains exactly the 15 in-scope files. |
| 8 | PENDING (Lead) | The Lead must stop and report to the user before running `/log-run`. |

---

## Evidence trail

### 1. Scope (`git status --short`, then `git diff --stat`)
```
 M .agents/metrics/test-tier-invocations.ndjson
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M src/main/index.ts
 M src/main/menu.ts
 M src/preload/api.ts
 M src/preload/index.ts
 M src/renderer/renderer.js
 M tests/e2e/ui-shell.spec.ts
 M tests/e2e/window-chrome.spec.ts
 M tests/integration/preload-api-contract.test.ts
 M tests/unit/menu.test.ts
?? .agents/current_scope.json
?? src/main/documentSession.ts
?? src/main/documentSlot.ts
?? tests/e2e/close-document.spec.ts
?? tests/e2e/support/pristine.ts
?? tests/unit/documentSession.test.ts
?? tests/unit/documentSlot.test.ts
```
- All 15 `src/` and `tests/` entries are in `current_scope.json`.
- The only extras are the hook telemetry file, the two Lead-authored spec appends and the manifest itself, all expected.
- Nothing else changed, including `watcher.ts`, `index.html`, `app.css`, `package.json`, `settings*` and the security tests.
- `window-chrome.spec.ts` diff: exactly 2 added lines, `'menu-close',` at :234 and :526.

### 2. Condition 3 grep (raw)
```
$ grep -rn "FILE_RENDERED" src/main
src/main/index.ts:334:  sendFileRendered: (message) => mainWindow?.webContents.send(IPC_CHANNELS.FILE_RENDERED, message),
src/main/watcher.ts:28:    // Not routed through onEvent/FILE_RENDERED (not a file-change
```
`sendFileRendered` call sites: only `src/main/documentSession.ts:46` (inside `deliver`). Both the open path (`if (!deliver(token, message)) return;`) and the watch callback (`.then((message) => { deliver(token, message); })`) go through it.

### 3. Behavior preservation (condition 2): old and new code, line by line

| Old (`main`) | New | Same? |
|---|---|---|
| `renderAndWatch`: `await renderFile` | `open`: `beginRender`; `await ports.renderFile` | Yes (the token capture is synchronous) |
| `sendToRenderer(message)` | `deliver(...)`: send, then `applyMenu` iff empty→occupied | Send order is the same. The menu rebuild is new by design (#151). |
| `if (message.ok) startWatching(filePath)` | `if (message.ok) startWatching(filePath)` | Identical. A failed open still does not stop the old watcher. |
| `await establishTreeRoot(path.dirname(f))` | `await ports.establishTreeRootFor(f)`, bound to `establishTreeRoot(path.dirname(f))` | Identical, still awaited and still last |
| `startWatching`: `stopWatching()` first | same | Identical |
| watch callback: `renderFile(fp).then(sendToRenderer)`, fire-and-forget | `beginRender`; `renderFile(fp).then(deliver).catch(console.error)`, fire-and-forget | Same apart from the epoch guard and the catch (N1) |
| `app.on('before-quit', stopWatching)` | `app.on('before-quit', () => documentSession.shutdown())`, where `shutdown` = `stopWatching` only | Identical |
| argv: `once('did-finish-load', () => renderAndWatch(fp))` registered before any await | `… documentSession.open(fp)`, same position (`index.ts:506-508`) | The synchronous-registration invariant is kept |
| REQUEST_OPEN_FILE file branch / dialog: `renderAndWatch` (unawaited / awaited) | `documentSession.open` (unawaited :539 / awaited :347) | Same await pattern |

### 4. Condition 6: independent check that nothing else depends on the ordering

- **Renderer state.** The renderer state touched by Close is `lastMessage` and `activeFilePath`. Only the FILE_RENDERED handler (:233-251) and the DOCUMENT_CLOSED handler (:267-283) write it.
- **FOLDER_TREE_ROOT** can arrive after DOCUMENT_CLOSED: an `open` already delivered keeps awaiting `establishTreeRootFor` after a Close. Its handler rebuilds the tree and calls `revealAndHighlight()`, which returns early when `activeFilePath` is null (:486). The result is correct in either order.
- **VIEW_SETTINGS** runs `updateFrontmatterVisibility()` from whatever the latest `lastMessage` is. Its result is correct in any order.
- **Copy-raw-source** is guarded by `canCopyRawSource(lastMessage)`.
- **Main process.** Main never waits on the renderer (there is no ack channel).

So the FILE_RENDERED/DOCUMENT_CLOSED pair is the only order-sensitive interaction, and the comment documents it. Both are `webContents.send` calls to the same frame, so they share one IPC pipe and arrive in send order.

### 5. Architecture
- `documentSlot.ts` has zero imports.
- `documentSession.ts` imports only `./documentSlot` and `import type { FileRenderedMessage } from '../preload/api'`. It has no electron, fs, path or chokidar imports.
- Dependencies point inward: slot ← session ← `index.ts` (composition root).
- SRP, DIP and ISP hold: 6 narrow ports, all bound in `index.ts:332-339`.
- Command (the `onClose` receiver with three invokers), Facade (`open`/`close`/`shutdown`/`isOpen`) and Ports & Adapters fit. "Protection Proxy" is loosely named (N4).
- Rejecting the GoF State pattern is justified: two states behind a boolean plus a counter.
- There is no inheritance.

### 6. Mutation and fault injection (all RED for the claimed reason, all restored)

**M1: deliver guard removed** (`if (!deliver(token, message)) return;` → `deliver(token, message);`), `npx vitest run tests/unit/documentSession.test.ts`:
```
× … an invalidated open does not start a watch (condition 3, watch)
  → expected [ '/a/A.md', '/b/B.md' ] to deeply equal [ '/a/A.md' ]
× … an invalidated open does not establish a tree root (condition 3, tree root)
  → expected [ '/a/A.md', '/b/B.md' ] to deeply equal [ '/a/A.md' ]
Tests  2 failed | 14 passed (16)
```

**M2: send moved ahead of the epoch check.** 7 failed, including `an open in flight across an acting close is not delivered…` and `a watch-triggered render in flight across an acting close is not delivered`.

**Restore:** `documentSession.ts` is untracked, so the proof is by hash. SHA-256 before the mutation was `2d6ece76d0315e5909584c76ea9f18fb5d38c655790293e74ceaa0ee2e202767`; after restore it is the same hash, `cmp` reports `RESTORED-IDENTICAL`, and the rerun gives `Tests 16 passed (16)`.

**E1 to E6** were done against git-ignored `dist/` (`.gitignore:2:dist`) using `npx playwright test -g …` with `ELECTRON_RUN_AS_NODE` unset. Each was restored from a backup and checked with `cmp`, and the final `test:all` rebuilt `dist/` from `src` afterward.

- **E1: close made non-inert** → (c):
  ```
  x (c) … - "documentClosed": 0, + "documentClosed": 1, - "setApplicationMenu": 0, + "setApplicationMenu": 1
  ```
- **E2: `stopWatching()` removed from close** → both (e) and the error-state (f) failed with `Expected: 0 Received: 1`. The pinned (f) still passed.
- **E3: `onOccupancyChanged` called on every delivery** → (g) failed with `Expected: 0 Received: 1`.
- **E4: a failed open stops the previous watcher**, i.e. condition 2 is broken → "(f) pinned pre-existing behavior" failed with `Timeout 15000ms exceeded while waiting on the predicate`. So the `toPass` retry does not hide a real regression.
- **E5: `#empty-state` hidden at launch (condition 5)** → `x ui-shell.spec.ts:8:5 › no-argv launch …`, `Locator: locator('#empty-state') Expected: visible Received: hidden at support\pristine.ts:13`.
- **E6: highlight clear removed from onDocumentClosed** → (b) failed with `Locator: locator('.tree-row-active') Expected: 0 Received: 1`.

### 7. Test quality
- **Counter patches are installed before the action.** In (c) they go in before Ctrl+W and the click. In (e) and (f) they go in after Close and before the save, so pre-Close traffic is excluded. In (g) they go in after the open and before the save.
- **The negative assertions catch regressions** (E1-E3). They rely on fixed settles (1000 / 1500 / 500 ms), in line with chokidar's `ignoreInitial` and no `awaitWriteFinish` (`watcher.ts:15`).
- **The `toPass` retry is limited to positive controls** (a missed save only causes a re-save), and E4 shows it still fails when it should.
- **Flakiness:** (c), (e), (f), (g) and (h) have now each passed at least 3 times across my runs. I saw no flakes.
- **The Task 44 integration test is self-referential:** it calls a method defined on its own sample literal. It says so openly and follows the file's existing pattern. The "no event object forwarded" fact rests on reading `preload/index.ts:52`, which is conclusive.
- The added `onOpenSettings` in `menu.test.ts`'s `handlers()` fills a previously missing key in the fixture. It is harmless.

### 8. Raw suite output
- `npm run build`: exit 0 (`dist\preload\index.js 3.0kb … Done in 18ms`).
- `npm run test:unit`: `Test Files 27 passed (27)`, `Tests 192 passed (192)`.
- `npm run test:integration`: `Test Files 7 passed (7)`, `Tests 52 passed (52)`.
- Targeted run `npx playwright test tests/e2e/close-document.spec.ts tests/e2e/ui-shell.spec.ts tests/e2e/window-chrome.spec.ts`: `40 passed (1.1m)`.
- **Authoritative gate, `env -u ELECTRON_RUN_AS_NODE npm run test:all`:** `EXIT: 0`. Unit `Tests 192 passed (192)`, integration `Tests 52 passed (52)`, e2e **`122 passed (2.8m)`**.
- Per spec in that run:

| Spec | ok | failed |
|---|---|---|
| close-document | 10 | 0 |
| live-reload | 3 | 0 |
| open-file-argv | 3 | 0 |
| drag-drop | 9 | 0 |
| tree-panel | 31 | 0 |
| external-links | 2 | 0 |
| html-comments | 1 | 0 |

- Security unit and integration tests in that run: `markdown.test.ts (15)`, `isExternalHttpUrl.test.ts (6)`, `window-config.test.ts (4)`, all passing.
- There were no view-menu flakes, no EBUSY errors and no orphaned `electron.exe`.
- The working tree after review is identical to the start of review (same `git status --short`).

### Engineer claims, checked
Every claim is confirmed: build clean; 192 / 52 / 122; the condition-1 specs 46/46 and unmodified; the grep result; the mutation failing exactly 2 tests; the fault-injection RED and its removal; and the deviations are as described.

---

## Addendum 1: Lead follow-up (A, E(b), E(c)); saved by the Lead, reviewer's findings summarized with raw excerpts

**Verdict unchanged: APPROVED WITH NON-BLOCKING ITEMS.** Three corrections to the round-1 report, plus one new Nit (N6).

### A. #149 evidence
- **Round-1 M2 was confounded.** It injected `ports.sendFileRendered(message); if (!decision.deliver) return false;`, which sends twice on every valid delivery too. That is why it failed 7 tests (`Tests 7 failed | 9 passed (16)`), including the ok-path tests.
- **Clean injection M2′** (epoch check deleted in `documentSession.ts:45`; every message sent exactly once). Raw result: `Tests 4 failed | 12 passed (16)`. The four failures are exactly the #149 tests:
  - "an open in flight across an acting close is not delivered and does not re-occupy the slot" → `expected [ { ok: true, …(5) }, …(1) ] to deeply equal [ { ok: true, …(5) } ]`
  - "an invalidated open does not start a watch (condition 3, watch)"
  - "an invalidated open does not establish a tree root (condition 3, tree root)"
  - "a watch-triggered render in flight across an acting close is not delivered"
- **Slot injection S1** (`tryDeliver` always returns `deliver: true` at `documentSlot.ts:35`, `occupancyChanged` unchanged). Raw result: `Tests 5 failed | 18 passed (23)`. The failures were the four #149 session tests above, plus `documentSlot.test.ts:34` "a token taken before an acting close is not delivered and the slot stays empty (#149)" → `expected { deliver: true, …(1) } to deeply equal { deliver: false, …(1) }`.
- **Tests that directly assert "a stale FILE_RENDERED never reaches `sendFileRendered`":**
  - `tests/unit/documentSession.test.ts:169` (assertion at `:178`, `expect(h.sent).toEqual([ok('/a/A.md')])`). Turned RED by M2, M2′ and S1.
  - `tests/unit/documentSession.test.ts:208` (assertion at `:216`). Turned RED by M2, M2′ and S1.
- **No e2e test covers the epoch race**, by design (it is unit-only per the scaffold). e2e (e) and (f) test watcher shutdown (#147/#148), not the epoch.
- **Restores:** `documentSession.ts` `2d6ece76…2767` and `documentSlot.ts` `34164a19…668a`, both hash-identical and `cmp`-identical to before; 23/23 GREEN after restore.

### E(b). `tsc` does not type-check `tests/**`
- **`tsconfig.json:16`:** `"include": ["src/main/**/*.ts", "src/preload/**/*.ts", "src/renderer/**/*.ts"]`.
- **No other type-check path:** there is no tests tsconfig, no vitest `typecheck` block, and no other `tsc` script. esbuild strips types without checking them.
- **Proof:** `npx tsc --noEmit --strict tests/integration/preload-api-contract.test.ts` on the unmodified file gives `TSC EXIT: 2`. It reports TS2741/TS2740 at lines 43, 67, 107, 177, 220 (pre-existing) and 258 (Task 44). These literals have never compiled, yet the suite passes.
- **Consequence:** the file's comments saying the "`: BridgeApi` annotation … would fail to compile" are false for test code. The round-1 acceptance of that comment is withdrawn.
- **Still true:** `tsc` guards `BridgeApi` at the production implementation (`src/preload/index.ts`, `const api: BridgeApi`). The #151 required-parameter enforcement also still holds at the production call sites (`src/main/index.ts:154`, `:597`), which are inside `include`.
- **N6 (new Nit, pre-existing, outside Task 44's fix round):** those comments are false. Either correct them or add a test type-check step (`tsconfig.test.json` + `tsc --noEmit`). The type-check step would first need the 6 existing errors fixed, so it is a backlog candidate.

### E(c). `menu.test.ts` `handlers()`
- **On `main`**, `handlers()` lacked `onOpenSettings`, although `MenuHandlers` already required it (`main:src/main/menu.ts:12`). It was a latent type error, never caught because tests are not type-checked. Confirmed on a scratch copy: `TS2322 … Types of property 'onOpenSettings' are incompatible`.
- **Now** it includes `onOpenSettings` and `onClose`. `tsc --noEmit --strict` on `tests/unit/menu.test.ts` gives `EXIT: 0`.

---

## Addendum 2: round-2 re-verification; saved by the Lead, reviewer's findings summarized with raw excerpts

**Verdict: APPROVED (0 Blocking, 0 Should-fix).** Round 2 changed exactly the three claimed hunks and nothing else. **N2 and N3 are closed.** N1, N4, N5 and N6 remain open as Nits. Approval condition 8 (the Lead stops before `/log-run`) is pending.

### 1. Diff scope
Compared with the engineer's round-1 snapshot (checked against the round-1 reading by line counts, size and quoted lines):
- **`pristine.ts`:** `22a23,24`, adds `// Hidden is not enough: at launch #frontmatter is also empty (#146).` and `await expect(window.locator('#frontmatter')).toHaveText('');`. Every other assertion is unchanged.
- **`close-document.spec.ts`:** `199,200c199,203`, the test (c) comment only. Assertions unchanged.
- **`renderer.js`:** `diff --strip-trailing-cr` shows `275a276 > if (frontmatterEl) frontmatterEl.textContent = '';`. Against `main` it is `43 insertions(+), 6 deletions(-)`, which is round 1 plus one line. #155 holds (empty assignment only).
- **`git status --short`:** 20 entries, i.e. the round-1 19 plus the Lead-written `review_report_task44.md`. No new source or test files.

### 2. The N2 test catches the regression (fault injection on `dist/`)
- **Start:** fresh build; `dist/renderer/renderer.js` SHA-256 `1a05f455…eb44b`, identical to `src`.
- **Injection:** the clear line at `:276` removed. Raw result for `close-document.spec.ts:148` (b): `Locator: locator('#frontmatter') Expected: "" Received: "title: Close Fixture" at support\pristine.ts:24`, `1 failed`.
- **Restore:** SHA-256 identical, `cmp` confirms `dist==src`.
- **After restore:** (b) and `ui-shell.spec.ts:8:5` both pass, `2 passed (2.5s)`, so `#frontmatter` is also empty at launch.

### 3. The N3 comment is accurate
It matches round-1 injection E1, where two triggers produced `documentClosed: 1`, so only the direct `MenuItem.click()` reached the handler. The comment claims nothing the assertions don't cover.

### 4. The `renderer.js` CRLF→LF working-copy flip is harmless
- **Settings:** `i/lf w/lf`; `core.autocrlf=true`; no `.gitattributes`.
- **Diff:** `git diff main -- src/renderer/renderer.js | grep -c $'\r'` = `0`, and the stat is identical with and without `--ignore-cr-at-eol`. There is no spurious whole-file change, and the file is committed as LF.
- **Recommendation:** no restore needed.

### 5. Full gate
`env -u ELECTRON_RUN_AS_NODE npm run test:all` → `EXIT: 0`:
- unit `192 passed (192)`
- integration `52 passed (52)`
- e2e `122 passed (2.1m)`

The four condition-1 specs total 46/46. No flakes, no EBUSY errors, no leftover processes.

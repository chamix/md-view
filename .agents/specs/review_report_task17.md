# Code Review Report — Task 17: File Tree Foundation

## Overall Verdict: **PASS**

0 Blocking findings. All eight `functional_domain.md` Task 17 guardrails were independently re-derived and verified against actual running code/tests, including fault-injection reproductions performed from scratch by the reviewer (not restated from the engineer's report). 3 Should-fix items and 2 Nits below; one Should-fix (S2) was closed with a narrowly-scoped follow-up before delivery, independently re-verified (see "Follow-up verification" section at the end). S1 and S3 remain open, disposition noted inline.

---

## Evidence Trail

### 1. Scope compliance

`git status --short` (repo root):
```
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M src/main/index.ts
 M src/main/menu.ts
 M src/preload/api.ts
 M src/preload/index.ts
 M tests/integration/preload-api-contract.test.ts
 M tests/unit/menu.test.ts
?? .agents/current_scope.json
?? src/main/fileTree.ts
?? tests/e2e/file-tree.spec.ts
?? tests/e2e/fixtures/tree/
?? tests/integration/fileTree.test.ts
?? tests/unit/fileTree.test.ts
```
Every touched file except `.agents/specs/functional_domain.md`/`initial_scaffold.md` is in `.agents/current_scope.json`'s `in_scope` list. The two spec files are additive-only (`git diff --stat` → `104 insertions(+)` and `283 insertions(+)`, `0 deletions`) — pure Task-17-section appends by the Lead prior to scope-contract creation, not an engineer out-of-scope edit. `src/renderer/**` and `README.md` show zero diff — confirms "no renderer changes."

### 2. Full test suite — run independently, raw output

Unit + integration (`npx vitest run tests/unit tests/integration`):
```
 Test Files  19 passed (19)
      Tests  102 passed (102)
```
`tsc -p tsconfig.json --noEmit`: no output (clean).

E2E (`npm run build && npx playwright test`), run 4 times at default 4-worker parallelism:
```
37 passed (38.2s)
37 passed (50.2s)
37 passed (47.3s)
37 passed (48.6s)
```
All four runs 37/37 green, including all 5 `tests/e2e/file-tree.spec.ts` cases (pre-follow-up count).

### 3. Fault-injection reproduction (from scratch, not restated)

**FI-1** — removed the `if (rootPath === currentTreeRoot) return;` guard in `establishTreeRoot` (`src/main/index.ts`), rebuilt, ran the guardrail #4 e2e test in isolation:
```
Expected length: 1
Received length: 2
Received array: [{"rootPath":"...tree\\sub", ...}, {"rootPath":"...tree\\sub", ...}]
```
RED as required. Restored, rebuilt, reran: `1 passed`. GREEN confirmed.

**FI-4** — made `listDirectoryEntries` rethrow instead of resolving `{ok:false}`, rebuilt, ran the FI-4 e2e test:
```
Error: page.evaluate: Error: Error invoking remote method 'md-view:request-list-directory': Error: ENOENT: no such file or directory, scandir '...\does-not-exist-at-all'
```
RED as required — `invoke()` surfaces as a caught rejection rather than hanging. Restored, rebuilt, reran full `file-tree.spec.ts` (5/5 green).

After both injections, `git status --short` and a direct diff against a pre-edit backup confirmed byte-identical restoration.

### 4. Guardrail #5 — structural check of `openFolderViaDialog`

```ts
async function openFolderViaDialog(): Promise<void> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return;
  await establishTreeRoot(result.filePaths[0]);
}
```
Only calls `dialog.showOpenDialog` and `establishTreeRoot`. Neither `renderFile`, `sendToRenderer`, `startWatching`, nor `activeWatcher` appear anywhere in this function or anything it calls — structurally impossible to reach the render/watch path. Cross-checked live: the e2e test "Open Folder… broadcasts FOLDER_TREE_ROOT and triggers zero FILE_RENDERED events as a side effect" passed (`fileRenderedCount === 0`, `#content` empty, `#empty-state` visible).

### 5. Guardrail #8 — no startup announcement

`currentTreeRoot` initializes to `null`. Only two call sites of `establishTreeRoot` exist — inside `renderAndWatch` and inside `openFolderViaDialog` — both reachable only via user action (menu click, or an argv-provided file path representing a user-supplied open request). `app.whenReady().then(...)` never calls `establishTreeRoot` directly.

### 6. First-`invoke()`-in-codebase claim

```
src\preload\index.ts:21:    return ipcRenderer.invoke(IPC_CHANNELS.REQUEST_LIST_DIRECTORY, dirPath);
src\main\index.ts:302:  ipcMain.handle(IPC_CHANNELS.REQUEST_LIST_DIRECTORY, (_e, dirPath: string) => listDirectoryEntries(dirPath));
```
Grep across all of `src/` for `ipcRenderer\.invoke|ipcMain\.handle` returns exactly these two lines. Confirmed: genuinely the app's first request-response IPC pair.

### 7. `.md` predicate reuse

```
src\main\fileTree.ts:9:    .filter((item) => item.isDirectory || item.name.toLowerCase().endsWith('.md'))
src\main\index.ts:109:  if (!filePath.toLowerCase().endsWith('.md')) {
```
Identical predicate shape in both `fileTree.ts` and `renderFile()`. No regex-vs-string-method drift.

### 8. Fixtures / guardrail #1's zero-`.md`-directory requirement

`tests/e2e/fixtures/tree/empty-of-md/.gitkeep` does not end in `.md`, so `empty-of-md/` still genuinely contains zero markdown files. The added `sub/deep2.md` fixture (beyond the spec's literal list) is disclosed and necessary — it supports the FI-1 same-folder-switch e2e test, which requires two `.md` files in the same subfolder to exercise the no-op guard meaningfully.

---

## Blocking

None.

---

## Should-fix

**S1 — Engineer's reported e2e flakiness claim (attributed to `view-menu.spec.ts`) could not be reproduced.** Ran the full 37-test e2e suite 4x at default 4-worker parallelism — 37/37 green every time, including all of `view-menu.spec.ts`. Also ran it in isolation at `--workers=1` (green, 5/5). Doesn't match either pre-existing flake already documented in `backlog.md` (`live-reload.spec.ts`, `ui-shell.spec.ts:67`). **Disposition:** engineer had no further evidence beyond what was already reported and explicitly deferred to the reviewer's clean runs rather than push back. No `backlog.md` entry added for this specific claim — closed without action, per this project's standing practice of only recording empirically confirmed flakiness.

**S2 — No test proved `establishTreeRoot` fires on a failed render.** `initial_scaffold.md`'s Task 17 spec explicitly requires this ("even a failed render still has a real containing directory worth treating as the tree root"), and the code correctly implements it, but no test exercised the failed-render trigger — a future refactor moving the call inside `if (message.ok)` would silently regress it. **Disposition: fixed before delivery.** See "Follow-up verification" below — closed, independently re-verified.

**S3 — No `DEVLOG.md` entry existed at review time for the first-of-kind request-response IPC pattern, and the spec's own precedent claim ("same convention as ... Task 16's first renderer→main crossing") didn't hold up** — `git log -- .agents/DEVLOG.md` showed no Task 16 entry ever existed. **Disposition:** the engineer's draft devlog entry (returned in its final report) was reviewed and written to `.agents/DEVLOG.md` by the Lead at close-out, corrected to note the inaccurate precedent claim explicitly rather than silently repeating it, and folded in the S2 finding/fix as its own noteworthy detail.

---

## Nits

**N1 — `listDirectoryEntries` is exported, diverging from the spec's literal (non-exported) code sample.** Practically necessary — `tests/integration/fileTree.test.ts` imports it directly — and follows the codebase's existing precedent (`shouldSkipDevToolsShortcut` is likewise a plain named export from the same file for testability). Not a concern.

**N2 — `backlog.md`'s existing note that importing `src/main/index.ts` directly into a test is unsafe is now partially superseded but not updated.** `tests/integration/fileTree.test.ts` demonstrates a working alternative (`vi.mock('electron', ...)` before import) that makes direct import safe without extraction — inspected and judged sound: it stubs only the Electron surface, while `fs.readdir` and `filterAndSortEntries` execute for real against the real fixture tree. Worth a cross-reference note next time `backlog.md` is touched; not actioned here (out of this task's scope).

---

## Follow-up verification (S2 fix)

A narrowly-scoped follow-up was delegated back to the same engineer to close S2: one new e2e test in `tests/e2e/file-tree.spec.ts` — "opening a file that fails to render still establishes the tree root for its parent directory" — opens a nonexistent `.md` path, asserts `FOLDER_TREE_ROOT` still broadcasts with the correct `rootPath`/entries, and asserts `#content` shows the real error state to confirm the failed-render branch is genuinely exercised.

The same independent reviewer re-verified this addition from scratch:

1. **Scope: PASS.** Only `tests/e2e/file-tree.spec.ts` changed persistently (one new test inserted, existing tests unchanged, confirmed byte-for-byte); `src/main/index.ts` diffed byte-identical to the pre-follow-up copy.
2. **Fault injection: PASS.** Reviewer moved `establishTreeRoot(...)` back inside `if (message.ok)` independently, rebuilt, got RED:
   ```
   Error: expect(received).toBeGreaterThanOrEqual(expected)
   Expected: >= 1
   Received:    0
   Timeout 5000ms exceeded while waiting on the predicate
   ```
   (other 5 tests in the file still green). Restored, rebuilt, reran: `6 passed (9.6s)`.
3. **Full suite: PASS.** `tsc --noEmit` clean, `102 passed` unit+integration. First e2e run at default parallelism: 37/38 (one incidental timeout in the unchanged, pre-existing `Open Folder…` test — reran clean twice, `38 passed` both times — logged to `backlog.md` as a fresh data point in the already-tracked parallel-contention-flakiness bucket, not a regression).

**Final state:** 38/38 e2e, 102/102 unit+integration, `tsc` clean. No new Blocking or Should-fix findings from the follow-up.

---

## Files reviewed directly

- `src/main/fileTree.ts` (new)
- `src/main/index.ts`
- `src/main/menu.ts`
- `src/preload/api.ts`
- `src/preload/index.ts`
- `tests/unit/fileTree.test.ts` (new)
- `tests/unit/menu.test.ts`
- `tests/integration/fileTree.test.ts` (new)
- `tests/integration/preload-api-contract.test.ts`
- `tests/e2e/file-tree.spec.ts` (new, and its S2 follow-up revision)
- `tests/e2e/fixtures/tree/**` (new)
- `.agents/specs/functional_domain.md` (Task 17 section)
- `.agents/specs/initial_scaffold.md` (Task 17 section)
- `.agents/specs/backlog.md` (cross-checked flakiness/precedent claims)
- `.agents/DEVLOG.md` (confirmed absence of Task 16/17 entries pre-close-out)
- `.agents/metrics/RUN_LOG.md` (confirmed no premature Task 17 row)
- `.agents/current_scope.json`

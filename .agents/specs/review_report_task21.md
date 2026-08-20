# Task 21 Independent Review — Tree Sidebar: Core Rendering, Lazy Expand, Click-to-Open

**Verdict: PASS with non-blocking notes.** No Blocking findings. All guardrails verified with executed evidence, not code-reading alone. One genuine, reproducible pre-existing flake (already backlogged from Task 19) was re-confirmed to be geometry-innocuous via direct measurement.

## Evidence trail

### 1. Scope compliance

`git diff --name-only` + `git status --short` (untracked):
```
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M src/preload/api.ts
 M src/preload/index.ts
 M src/renderer/app.css
 M src/renderer/index.html
 M src/renderer/renderer.js
?? .agents/current_scope.json
?? tests/e2e/tree-panel.spec.ts
?? tests/unit/needsFetch.test.ts
```
`.agents/current_scope.json` in_scope: `src/renderer/index.html`, `src/renderer/renderer.js`, `src/renderer/app.css`, `src/preload/api.ts`, `src/preload/index.ts`, `tests/e2e/tree-panel.spec.ts`, `tests/unit/**`, `package.json`, `.agents/specs/backlog.md`, `.agents/DEVLOG.md`, `.agents/metrics/RUN_LOG.md`. Every touched file is within this grant. `package.json` was not touched — consistent with the single-file (no split) decision documented in `initial_scaffold.md`; no new `dist/renderer/*` asset needed a `copyFileSync` entry. `src/main/**` has zero diff, confirmed by its absence from the file list — matches the spec's claim that `REQUEST_OPEN_FILE`'s existing handler needs no main-process changes. The `.agents/specs/*.md` diffs are the Lead's own pre-delegation spec additions (Task 21 sections), not engineer output — outside this review's implementer-scope concern.

Item #10 (scope amendment `tests/unit` → `tests/unit/**`) noted as expected/accepted per the Lead's brief, not flagged.

### 2. HTML/CSS structure

`git diff -- src/renderer/index.html` (full hunk, cited above) shows `#app-body > (#tree-panel[#tree-empty-state, #tree-root] , #main-panel[#empty-state, #document-container])`, matching `initial_scaffold.md`'s authoritative structure exactly. `#status-bar` remains a sibling outside `#app-body`, unchanged.

`#empty-state`'s text content (`No file open. Use File &gt; Open… (Ctrl+O)...`) and `#document-container`'s entire subtree (`#document-header`, `#tab-preview`, `#tab-code`, `#document-main`, `#frontmatter`, `#content`) are semantically unchanged — same tags, same attributes, same text, only re-indented one level deeper due to the new wrapper. (Nit: literal indentation whitespace differs, so not byte-identical in the strictest sense, but content/structure is unchanged — this is what the spec's "byte-identical" language was actually protecting against, and it holds.)

`git diff -- src/renderer/app.css` confirms:
- `--tree-panel-width: 260px` declared on `:root`, consumed via `width: var(--tree-panel-width)` on `#tree-panel` — matches the spec's stated resize-handle-friendly design.
- `#app-body { display: flex; flex-direction: row; }`, `#main-panel { flex: 1 1 auto; min-width: 0; }` — the load-bearing `min-width: 0` is present with the exact rationale comment the spec called for.
- Dark-mode coverage (guardrail #25): every element that sets a `color`/`background` value has a `body.dark-mode` counterpart — `#tree-panel`, `#tree-empty-state`, `.tree-row`, `.tree-row:hover`, `.tree-loading`/`.tree-empty`, `.tree-error`. Elements with no color/background of their own (`.tree-node`, `.tree-children`, `.tree-toggle`, `.tree-label`, `#tree-root`) correctly inherit from their dark-mode-scoped ancestor/sibling and need no separate rule — verified by reading the CSS, no gap found.

### 3. New BridgeApi method / IPC channel reuse

```diff
+ openFileByPath(filePath: string): void;   // src/preload/api.ts
```
```diff
+ openFileByPath: (filePath) => {
+   ipcRenderer.send(IPC_CHANNELS.REQUEST_OPEN_FILE, filePath);
+ },                                          // src/preload/index.ts
```
Confirmed no new `IPC_CHANNELS` entry: `grep -n "REQUEST_OPEN_FILE\|FOLDER_TREE_ROOT\|REQUEST_LIST_DIRECTORY" src/preload/api.ts` shows exactly the three pre-existing channels, unchanged. `git diff --name-only` shows zero `src/main/**` files touched. Confirmed `src/main/index.ts:325` still registers `ipcMain.handle(IPC_CHANNELS.REQUEST_LIST_DIRECTORY, (_e, dirPath) => listDirectoryEntries(dirPath))` and `renderAndWatch` is called from the pre-existing `REQUEST_OPEN_FILE` listener with no new validation — reused verbatim as claimed.

### 4. Fault-injection technique (`_invokeHandlers`) — verified working, not vacuous

Ran the technique live (`tests/e2e/tree-panel.spec.ts`'s FI-1 test) — passed cleanly across every run in this session (single-run, `--repeat-each=3`, inside full 44-test suite at workers=2 and workers=4). Independently confirmed:
- Electron version in use: `33.4.11`.
- `src/main/index.ts:325` is exactly `ipcMain.handle(IPC_CHANNELS.REQUEST_LIST_DIRECTORY, (_e, dirPath) => listDirectoryEntries(dirPath))` — the function the test's `_invokeHandlers.get(channel)` grabs and delegates to (`originalHandler(event, dirPath)`) is that exact closure, not a reimplementation.
- I additionally wrote a standalone diagnostic spec (created and removed afterward — repo confirmed clean via `git status` before/after) reusing the same `_invokeHandlers`-grab pattern against the `empty-of-md` fixture folder specifically (not just `sub`, which is the only folder the shipped FI-1 test exercises): expand → collapse → re-expand, then read the counter.
  ```
  EMPTY_FOLDER_LISTDIRECTORY_CALL_COUNT 1
  1 passed (1.9s)
  ```
  This confirms the empty-folder caching path (item 8 below) genuinely works and isn't just plausible from code reading.

Verdict on the private-API concern (item 4c): acceptable trade-off, **Should-fix at most, not Blocking**. It's test-only (never ships), the `require()`-based spec alternative was empirically dead (confirmed by the delegate's own documented probe, consistent with `electronApp.evaluate()`'s global-eval semantics), and the technique demonstrably exercises real production logic (proven both by the shipped FI-1 test and my own supplementary empty-folder probe). Recommend a backlog note flagging `_invokeHandlers` as an Electron-internals dependency that could break silently on an Electron upgrade (no test currently guards against the shape of that Map changing) — this is exactly the kind of test-fragility debt this project already tracks elsewhere (e.g. the `globalThis.__mdViewDevToolsGuardForTests` bridge flagged in Task 13/backlog.md), not a new class of problem.

### 5. FI-1 fault injection, redone independently

Patched `src/renderer/renderer.js`:
```diff
-  return childElementCount === 0;
+  return true; // FAULT-INJECTED: always needs fetch
```
Rebuilt, ran `npx playwright test tests/e2e/tree-panel.spec.ts -g "FI-1"`:
```
Error: expect(locator).toBeHidden() failed
...
      154 |   await subRow.click(); // collapse: already populated -> pure visibility toggle, zero fetch
    > 155 |   await expect(subChildren).toBeHidden();
  1 failed
```
**RED, confirmed** — defeating the cache predicate breaks the toggle behavior and the test catches it. (Note: it fails at line 155's `toBeHidden()` assertion rather than reaching the final `expect(count).toBe(1)` assertion at line 163, because with `needsFetch` always `true` the "pure toggle" branch becomes unreachable and the folder never actually hides. This is still a valid, meaningful RED directly caused by the fault — the test does not silently pass — but it's worth the Lead noting that this specific fault manifests earlier in the test than the guardrail's literal "2 calls" framing implies.)

Restored the file from a pre-patch backup and rebuilt:
```
git diff --stat -- src/renderer/renderer.js  →  1 file changed, 149 insertions(+), 1 deletion(-)
npx playwright test tests/e2e/tree-panel.spec.ts -g "FI-1"  →  1 passed (1.9s)
```
Confirmed the restored file's diff is hunk-for-hunk identical to the original delivered diff (same content verified via `git diff` output re-inspection). **GREEN, confirmed.**

### 6. Full pre-existing suite (guardrail #24) — highest-risk item, multiple runs

Build: `npm run build` — clean, no errors.

Full 44-test suite (`npx playwright test --reporter=line`), run 7 times total across this session at default `workers: 2` (plus one extra run at `--workers=4`):

| Run | Workers | Result |
|---|---|---|
| 1 | 2 | 44 passed (50.4s) |
| 2 | 2 | 44 passed (56.1s) |
| 3 | 2 | 43 passed, 1 failed (`ui-shell.spec.ts:150`) (57.1s) |
| 4 | 2 | 43 passed, 1 failed (isolated re-run, same test) |
| 5 | 2 | 43 passed, 1 failed (`ui-shell.spec.ts:150`) (49.4s) |
| 6 | 2 | 43 passed, 1 failed (`ui-shell.spec.ts:150`) (53.2s) |
| 7 | 4 | 44 passed (46.3s) |

Every single failure across all runs was the exact same pre-existing assertion: `tests/e2e/ui-shell.spec.ts:150-152`, `argv launch with sample.md › argv launch: empty-state disappears...`, `expect(containerBox.marginLeft).toBeGreaterThan(32)`. **Zero failures anywhere else in the suite, in any run** — including zero `tree-panel.spec.ts` failures and zero pre-existing-spec failures other than this one flaky line.

When run in isolation (`npx playwright test tests/e2e/ui-shell.spec.ts`), all 3 tests passed cleanly (3 passed, 4.9s) — confirming the flake only manifests under the full-suite's concurrent-process load, not from a genuine geometry defect.

**(a) Casing-artifact claim re: `file-tree.spec.ts` — could not independently reproduce.** Per the task brief, redid the `git stash` comparison:
```
git stash -u
npm run build
npx playwright test tests/e2e/file-tree.spec.ts --reporter=line   → 7 passed (9.8s)
npx playwright test --reporter=line (full 39-test pre-Task-21 suite)  → 39 passed (40.8s)
npx playwright test tests/e2e/file-tree.spec.ts --reporter=line   → 7 passed (10.1s)  [re-run]
git stash pop
```
Zero failures on the pre-Task-21 tree, in either isolated or full-suite runs. Post-Task-21 (with the stash restored), I additionally ran `file-tree.spec.ts` with `--repeat-each=3` (21 executions) — all passed — plus it appeared cleanly in every one of the 7 full-suite runs above. **Combined: 0/60+ `file-tree.spec.ts` test executions failed, pre- or post-Task-21, in this review session.** I cannot independently corroborate the implementer's specific "4 failures, casing-artifact" narrative — I simply never hit it, despite deliberately trying (varied worker counts, repeats, isolated vs. full-suite). This is consistent with Task 20's own review report (`review_report_task20.md`), which likewise called the casing quirk "plausible... none of my runs showed a `rootPath` assertion failure of that kind" — i.e., this specific failure mode has now gone unreproduced by two independent reviewers across two tasks. Net effect on guardrail #24: **no evidence of a Task-21-caused regression in `file-tree.spec.ts`**, which is the guardrail's actual concern — treat the implementer's specific stash-comparison claim as unconfirmed-but-immaterial rather than false, and consider it low-priority backlog noise, not a re-review blocker.

**(b) `ui-shell.spec.ts:150` flake-rate / geometry check.** I wrote a temporary diagnostic Playwright spec (`tests/e2e/zzz-margin-diag.spec.ts`, created outside the reviewed diff, removed immediately after — `git status` confirmed clean before and after) that launches the real app with the sidebar present, resizes to 1600×900, and **polls** `#document-container`'s computed box until 5 consecutive stable reads (instead of the flaky test's fixed 100ms wait) to get the true settled value:
```
SETTLED_CONTAINER_BOX {"width":864,"marginLeft":230.8,"marginRight":230.8}
TREE_PANEL_WIDTH 260px
1 passed (2.1s)
```
`marginLeft` settles at **230.8px**, roughly 7× the `>32` threshold the flaky assertion requires — deep within the passing band, not marginal. This matches the Lead's arithmetic estimate (~238px) closely (the ~7px difference is plausibly window-chrome/scrollbar overhead, immaterial to the conclusion). **The Lead's math holds up**: Task 21's sidebar does not meaningfully shrink the available width budget at 1600px, and the flake-rate increase is better explained by "more tests in the suite → more concurrent Electron process pressure" (Task 19's already-open, unresolved systemic issue) than by any genuine width-budget conflict this task's CSS introduced. This is a real, already-backlogged flake (first seen in Task 19's baseline, per the task brief), not a new regression — **not Blocking**, consistent with the weight the task brief itself assigned it.

### 7. Unit tests

```
tests/unit/needsFetch.test.ts
✓ a children container with zero child nodes has never been fetched -> true
✓ a children container with real entry rows has already been fetched -> false
✓ a children container with exactly one row (single entry, or the lone error/empty indicator row) has already been fetched -> false
```
`needsFetch(childElementCount: number): boolean` takes a plain number, does no DOM access, no `window`/`document` reference — genuinely pure. The three cases are meaningful: zero (never fetched), multiple real rows (fetched), and the edge case that actually matters most for correctness — exactly one row, which covers both the single-entry case and the "lone error/empty indicator row" case that guardrail #21's empty-folder handling depends on. Not tautological — it directly encodes the guardrail's caching contract.

### 8. Empty-folder handling

Confirmed necessary by reading the caching logic: `needsFetch` is keyed purely on `childElementCount`. If a genuinely-empty `ok:true`/`entries:[]` result rendered zero child nodes, `childrenEl.childElementCount` would remain `0` forever, and `needsFetch` would return `true` on every subsequent click — an infinite-refetch bug, violating guardrail #21 for exactly the empty-folder case. Verified this is not merely plausible but real via the supplementary diagnostic in item 4 above (`EMPTY_FOLDER_LISTDIRECTORY_CALL_COUNT 1` across expand/collapse/re-expand of `empty-of-md`). The `.tree-empty` indicator row (`"(empty folder)"`) is a reasonable, narrowly-scoped, disclosed implementation choice to satisfy an already-existing guardrail, not scope creep — `tests/e2e/tree-panel.spec.ts`'s second test explicitly asserts it's visible and distinct from `.tree-error` (guardrail #26 is a separate, correctly-non-conflated outcome).

### 9. `tsc` / unit / integration

```
npx tsc --noEmit          → clean, zero output
npm run test:unit         → 16 files, 86 tests passed
npm run test:integration  → 4 files, 19 tests passed
```

### 10. Scope-manifest amendment

`.agents/current_scope.json`'s `"tests/unit"` → `"tests/unit/**"` amendment is within the Lead's stated delegation intent — noted, not flagged, per the task brief's explicit instruction.

## Findings

**Blocking:** none.

**Should-fix:**
1. `tests/e2e/tree-panel.spec.ts`'s FI-1 test only exercises the cache-defeat scenario for the `sub` folder (non-empty case); the empty-folder caching path (which is the one requiring the special "(empty folder)" indicator row to work at all) has no dedicated fault-injection or call-count assertion in the shipped test suite — only my own throwaway diagnostic covered it. Recommend a follow-up task/backlog item to add an `empty-of-md`-specific call-count assertion to `tree-panel.spec.ts`, since this is precisely the edge case guardrail #21 is most likely to silently regress on.
2. `_invokeHandlers` reliance (item 4c) — real and working today, but an undocumented Electron internal with no test asserting its own continued existence; an Electron upgrade could silently break this specific test (not the shipped app) with a confusing failure mode. Worth a one-line backlog note.

**Nit:**
1. `void treePanelEl;` in `renderer.js` — a `const` declared and referenced only to suppress an unused-variable concern, never otherwise used. Harmless but slightly odd; either use it for something (e.g. a future hover/resize affordance) or drop the declaration.
2. `index.html`'s wrapped `#empty-state`/`#document-container` content changed indentation (not literally byte-identical), though semantically/structurally unchanged — worth the Lead being precise about what "byte-identical" meant when writing the spec, for future tasks.

## Files reviewed / evidence sources
- `C:\Source\md-view\.agents\specs\functional_domain.md` (Task 21 section)
- `C:\Source\md-view\.agents\specs\initial_scaffold.md` (Task 21 section)
- `C:\Source\md-view\.agents\current_scope.json`
- `C:\Source\md-view\src\preload\api.ts`, `C:\Source\md-view\src\preload\index.ts`
- `C:\Source\md-view\src\renderer\index.html`, `C:\Source\md-view\src\renderer\app.css`, `C:\Source\md-view\src\renderer\renderer.js`
- `C:\Source\md-view\src\main\index.ts` (lines 127, 160–166, 325 — read-only, confirmed zero diff)
- `C:\Source\md-view\tests\e2e\tree-panel.spec.ts`, `C:\Source\md-view\tests\unit\needsFetch.test.ts`
- `C:\Source\md-view\.agents\specs\review_report_task20.md` (cross-check for casing-artifact precedent)
- Temporary diagnostic specs created and removed during this review (not part of the delivered diff): margin-settling probe and empty-folder cache-count probe, both under `tests/e2e/zzz-*.spec.ts`, deleted immediately after use — `git status` confirmed clean before and after.

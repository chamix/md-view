# Independent Code Review — Task 27

**Scope of this review:** "Up one level" tree navigation row added to the top of `#tree-root`. New `REQUEST_TREE_PARENT` fire-and-forget IPC channel, a bridge method `requestTreeParent()`, a main-process listener that calls `establishTreeRoot(path.dirname(currentTreeRoot))` verbatim, and a renderer row (`tree-row-up`, not `tree-node`) whose click triggers that bridge call.

**Verdict: APPROVED — no Blocking items found. Three non-blocking Should-fix items (governance-file omission, a pre-existing/growing test-contract drift, and a report-accuracy discrepancy on the claimed flake).**

---

## 1. Scope compliance

`git status --short` (reproduced myself):

```
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M src/main/index.ts
 M src/preload/api.ts
 M src/preload/index.ts
 M src/renderer/app.css
 M src/renderer/renderer.js
 M tests/e2e/tree-panel.spec.ts
?? .agents/current_scope.json
```

`.agents/current_scope.json`'s `in_scope` list: `src/preload/api.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/renderer/renderer.js`, `src/renderer/app.css`, `tests/e2e/tree-panel.spec.ts`, `.agents/specs/backlog.md`, `.agents/DEVLOG.md`, `.agents/metrics/RUN_LOG.md`.

`functional_domain.md`/`initial_scaffold.md` are modified but not listed — expected per CLAUDE.md's workflow (Lead authors/approves spec in Step 0/1 before the scope contract exists; these files are read-only during task execution per the governance hook, so the engineer could not have made these edits). Diffs read in full — exactly the Task 27 spec text, verbatim.

Every other touched file is in-scope. **No out-of-scope drift.**

**Should-fix:** `.agents/DEVLOG.md` and `.agents/specs/backlog.md` are both in-scope and both **untouched** by the engineer (`git diff --stat` returned nothing for either at review time). This diverges from the approved `initial_scaffold.md` plan, which explicitly calls for both a backlog note ("if anything defers") and a DEVLOG entry. Not a functional defect — Should-fix, not Blocking. (Closed by the Lead post-review — see DEVLOG.md/backlog.md Task 27 entries.)

## 2. Diff-by-diff verification against the spec

`src/preload/api.ts`:
```diff
+  REQUEST_TREE_PARENT: 'md-view:request-tree-parent',
...
+  requestTreeParent(): void;
```
Matches spec exactly.

`src/preload/index.ts`:
```diff
+  requestTreeParent: () => {
+    ipcRenderer.send(IPC_CHANNELS.REQUEST_TREE_PARENT);
+  },
```
Bare fire-and-forget `send`, no `invoke`, no new response channel — matches spec.

`src/main/index.ts`:
```diff
+  ipcMain.on(IPC_CHANNELS.REQUEST_TREE_PARENT, () => {
+    if (!currentTreeRoot) return;
+    establishTreeRoot(path.dirname(currentTreeRoot));
+  });
```
Registered inside `app.whenReady()` immediately after `REQUEST_LIST_DIRECTORY`, alongside the other listeners. Calls `establishTreeRoot` verbatim with its sole argument `path.dirname(currentTreeRoot)`. The only guard is `if (!currentTreeRoot) return;` — this guards the distinct "no root ever established" case (avoiding `path.dirname(undefined)`), **not** a second "already at top" check, so guardrail #54 holds. `establishTreeRoot`'s own body (lines 141–172) has **zero diff** — the `resolvedRootPath === currentTreeRoot` no-op guard is untouched, reused as-is.

`src/renderer/renderer.js`, inside `onFolderTreeRoot`'s `ok:true` branch:
```diff
+      const upRow = createTreeRow('.. (up one level)', 'tree-row-up');
+      upRow.addEventListener('click', () => window.mdview.requestTreeParent());
+      treeRootEl.appendChild(upRow);
```
`createTreeRow(labelText, extraClassName)` produces `className = 'tree-row ' + extraClassName` — i.e. `tree-row tree-row-up`, never `tree-node`. `revealAndHighlight`'s candidate filter (`child.classList.contains('tree-node')`, line 392) is therefore provably blind to this row. The click handler's body is exactly one statement: `window.mdview.requestTreeParent()` — no local DOM mutation, no state write.

`src/renderer/app.css`:
```diff
+.tree-row-up {
+  padding-left: 1.85rem;
+  color: #57606a;
+  font-style: italic;
+}
...
+body.dark-mode .tree-row-up {
+  color: #8b949e;
+}
```
Follows the file's existing per-selector dark-mode idiom (matches neighboring `.tree-error`/`body.dark-mode .tree-error` pattern) — not a shortcut `:not()`/media-query rule.

## 3. Guardrail-by-guardrail verdict

| # | Guardrail | Verdict | Evidence |
|---|---|---|---|
| 54 | Verbatim call, no duplicate no-op guard | **Holds** | Diff shows exactly one guard (`!currentTreeRoot`); `establishTreeRoot` body has zero diff (confirmed by direct read, lines 141–172). |
| 55 | Up-row never gets `tree-node` | **Holds** | `createTreeRow` never appends `tree-node`; full 26-test `tree-panel.spec.ts` suite (Tasks 17/21/23/24/26) re-run and passes unmodified — see §4. |
| 56 | No watcher/render/FILE_RENDERED side effect | **Holds** | New listener's body contains only `establishTreeRoot(...)`, no `renderAndWatch`/`startWatching`/`stopWatching` calls; proven by the FI-1 test and the full green suite. |
| 57 | Up-row unconditionally rendered on every `ok:true`, even at a real fs root | **Holds** | Code path is unconditional inside `if (treeRootEl)`, no root-type branching. Empirically confirmed: the "no-op at real filesystem root" e2e test clicks `.tree-row-up` *after* establishing root at `path.parse(process.cwd()).root` — Playwright's actionability wait on `.click()` would have failed the test if the row weren't rendered there; test passed. |
| 58 | Up-row absent when no root ever established | **Holds** | Explicit test with `electronArgs: []` asserts `.tree-row-up` count 0; passed. |
| 59 | Up-row never appears on `ok:false` | **Holds** | Up-row creation code is unreachable in that branch — `onFolderTreeRoot` returns early (line 439) before the `if (treeRootEl)` block that creates the row is ever reached. Structural guarantee, consistent with `treeRootEl.hidden = true` on that branch. |

## 4. Test suite — evidence run independently by the reviewer

**Unit** (`npm run test:unit`): `Test Files 18 passed (18)` / `Tests 96 passed (96)` — matches claim.

**Integration** (`npm run test:integration`): `Test Files 4 passed (4)` / `Tests 19 passed (19)` — matches claim.

**`tree-panel.spec.ts` in isolation** (`npx playwright test tests/e2e/tree-panel.spec.ts`, workers=1): `26 passed (57.6s)` — 22 pre-existing (Tasks 17/21/23/24/26) plus exactly 4 new Task 27 tests:
- "clicking Up re-establishes the tree root at the parent directory, with correctly filtered/sorted entries" — real behavioral assertion, not tautological.
- "no-op at a real filesystem root" — uses `path.parse(process.cwd()).root` (never hardcoded), same counting-listener idiom as `file-tree.spec.ts`'s `__treeRootEvents`.
- "absent when no folder ever opened" — uses `test.use({ electronArgs: [] })`, no race observed across 2 clean runs.
- FI-1 — genuinely swaps the real `ipcMain` listener via `rawListeners`/`removeAllListeners`/`on` (public EventEmitter API, not a mock); RED then GREEN confirmed against the real production listener object.

**Full e2e suite at configured `workers: 2`** (run twice):
- Run 1: 66 passed, 1 failed — `ui-shell.spec.ts:50`, unrelated to Task 27.
- Run 2: 67 passed, 0 failed — matches implementer's claim.

`tree-panel.spec.ts:171` and the Task 24 ancestor-folder test passed in **both** full-suite runs and in the isolated workers=1 run — reviewer could not reproduce the specific flake the implementer named.

**Pre-Task-27 HEAD comparison** (`git stash`, rebuild, run twice at `workers: 2`): 63 passed / 0 failed, both runs. (`git stash pop` restored the working tree afterward.)

**Assessment of the flake claim:** consistent with the general conclusion (pre-existing, `workers:1`-clean, unrelated to this diff), but the *specific* test names cited by the implementer were not independently reproduced — instead an unrelated flake (`ui-shell.spec.ts:50`) surfaced once. Should-fix: state the observed flake set with more hedging. Not Blocking — the broader claim held up under independent re-run.

## 5. Architecture / SOLID scan (independent)

- **Inward dependency rule:** renderer → `BridgeApi` (never raw `ipcRenderer`) → main adapter → `establishTreeRoot`. Unchanged in shape from `openFileByPath`.
- **SRP:** the new listener's only reason to change is "how is the parent path derived" — zero diff in `establishTreeRoot` itself.
- **OCP:** `establishTreeRoot` gains a third *caller*, zero lines change in its body.
- **DIP:** renderer never touches `ipcRenderer` or the raw channel string; only `window.mdview.requestTreeParent()`.
- **Pattern fit:** Facade (`contextBridge.exposeInMainWorld`) + one more fire-and-forget Command message, same shape as `openFileByPath` and the dropped-folder path. No new pattern introduced.

No architecture or SOLID violations found.

## 6. Additional findings

**Should-fix (test-contract drift, not introduced solely by this task but grown by it):** `tests/integration/preload-api-contract.test.ts` constructs hand-written `BridgeApi` object literals (lines 61, 101) missing `openFileByPath` (pre-existing gap since Task 21/16) and, after this diff, also missing `requestTreeParent`. This file is outside `tsconfig.json`'s `include`, and Vitest doesn't type-check test files, so these are latent `TS2739` errors that never surface in CI (confirmed via a direct `npx tsc --noEmit` probe against the file). Out of Task 27's scope to fix — flagged to backlog for the Lead to schedule.

**Dead code / hygiene:** none found. `tree-panel.spec.ts` diff is a pure append (zero removed lines). `src/main/index.ts` diff is a pure 12-line addition inside `app.whenReady()`, no removed lines.

**Regression risk:** the up-row's unconditional insertion is exercised by every pre-existing `tree-panel.spec.ts` test (all 22 re-run unmodified and green) — the concrete proof for guardrails #55/#56. No untested touched code paths identified.

---

## Overall Verdict

**No Blocking items.** The implementation matches the approved spec verbatim at every diff site, all six new guardrails (#54–#59) hold under direct code inspection and independently executed tests, `establishTreeRoot`'s body is provably untouched, and 96 unit / 19 integration / 67 e2e tests all pass (verified independently, not restated from the implementer).

**Should-fix (non-blocking):**
1. `.agents/DEVLOG.md` and `.agents/specs/backlog.md` were not updated by the engineer despite the approved plan calling for both. **Closed by the Lead post-review.**
2. `tests/integration/preload-api-contract.test.ts`'s `BridgeApi` literals are missing `requestTreeParent` (and, pre-existing, `openFileByPath`) — a silent, never-type-checked contract drift. Logged to backlog.md.
3. The implementer's flake report named two specific tests not independently reproduced by the reviewer (an unrelated flake surfaced instead); the general "pre-existing, unrelated to this diff" conclusion held up under independent re-run including a pre-Task-27 HEAD comparison.

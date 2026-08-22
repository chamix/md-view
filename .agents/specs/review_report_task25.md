# Independent Code Review — Task 25

**Scope of this review:** dropped/opened directory establishing tree root instead of being rejected via `REQUEST_OPEN_FILE`.

**Verdict: APPROVED — no Blocking items found.**

All claims below are backed by `git diff` output, direct file reads, and my own reproduced test runs (raw output pasted, not restated).

---

## 1. Scope compliance

`git status` / `git diff --stat` (reproduced myself):

```
 .agents/DEVLOG.md                  |  31 ++++++++++-
 .agents/specs/backlog.md           |  26 ++++++++-
 .agents/specs/functional_domain.md |  66 ++++++++++++++++++++++
 .agents/specs/initial_scaffold.md  | 109 +++++++++++++++++++++++++++++++++++++
 src/main/index.ts                  |  22 +++++++-
 tests/e2e/drag-drop.spec.ts        | 102 ++++++++++++++++++++++++++++++++++
```

`.agents/current_scope.json` (still present — not yet closed out):
```json
"in_scope": [
  "src/main/index.ts",
  "tests/e2e/drag-drop.spec.ts",
  ".agents/specs/backlog.md",
  ".agents/DEVLOG.md",
  ".agents/metrics/RUN_LOG.md"
]
```

`functional_domain.md` and `initial_scaffold.md` are modified but **not** in the engineer's `in_scope` list. This is expected under CLAUDE.md's workflow (Lead writes/approves spec in Step 0/1, *then* creates `current_scope.json` and delegates) — not an engineer scope violation, but I verified it rather than assumed it, since a stale/backdated scope file could otherwise mask real drift. File mtimes (`ls -la --time-style=full-iso`) confirm strict chronological ordering:

```
functional_domain.md   10:59:39
initial_scaffold.md    11:00:03
current_scope.json     11:01:01   <- scope contract created after spec, before code
drag-drop.spec.ts      11:03:05
src/main/index.ts      11:03:35
DEVLOG.md               11:09:41
backlog.md               11:09:58
```

Spec files were last touched a full 90 seconds *before* the scope contract existed; all engineer-owned edits (code, test, DEVLOG, backlog) came after, in scope. **No out-of-scope drift.** `.agents/metrics/RUN_LOG.md` (in scope) was correctly left untouched — that's the Lead's Step 3 job.

## 2. Diff shape vs. spec (`initial_scaffold.md` §Task 25 "TS — src/main/index.ts")

Full diff of `src/main/index.ts` (only hunk in the file):

```diff
-  ipcMain.on(IPC_CHANNELS.REQUEST_OPEN_FILE, (_event, filePath: string) => {
-    if (typeof filePath === 'string' && filePath.length > 0) {
-      renderAndWatch(filePath);
+  ipcMain.on(IPC_CHANNELS.REQUEST_OPEN_FILE, async (_event, filePath: string) => {
+    if (typeof filePath !== 'string' || filePath.length === 0) return;
+
+    let isDirectory = false;
+    try {
+      const stats = await fs.stat(filePath);
+      isDirectory = stats.isDirectory();
+    } catch {
+      // Stat failed ... fall through to the existing renderAndWatch/renderFile
+      // error path below, unchanged from today's behavior.
+    }
+
+    if (isDirectory) {
+      await establishTreeRoot(filePath);
+      return;
     }
+
+    renderAndWatch(filePath);
   });
```

This matches the spec's required shape exactly: async listener, `fs.stat` try/catch, `isDirectory` set only on success, `await establishTreeRoot(filePath); return;` on the directory branch, unmodified un-awaited `renderAndWatch(filePath)` call on the fallthrough branch (identical call shape to the pre-existing code — not newly awaited, no behavior change).

`fs` in this file is `import * as fs from 'node:fs/promises'` (confirmed at line 3), so `await fs.stat(...)` is valid.

**No parallel directory-handling implementation.** `establishTreeRoot` (lines 141–172), `renderAndWatch` (186–193), and `renderFile` (108–121) are byte-identical to `main`/HEAD — the diff contains exactly one hunk, confined to the `REQUEST_OPEN_FILE` listener. I read all three functions directly to confirm no second implementation was smuggled in elsewhere in the file. Satisfies guardrail #45 and the scaffold's "No other function in this file is touched" requirement.

## 3. Guardrail-by-guardrail verification

**#45 (directory → `establishTreeRoot`, no parallel impl):** Confirmed by diff above — `await establishTreeRoot(filePath)` is the pre-existing Task 17/18 function, reused verbatim. New test `tests/e2e/drag-drop.spec.ts:179` ("dragging a folder onto the window establishes it as the tree root...") drags a real on-disk directory (`tests/e2e/fixtures/tree`) via CDP `Input.dispatchDragEvent`, through the real renderer→preload→`ipcMain` chain, and asserts `treeRootMessage.ok === true`, `rootPath === fixtureTreeDir`, and `entries` contains `notes.md`. This is a real end-to-end proof, not a mock.

**#46 (file path byte-identical):** The fallthrough call is textually unchanged (`renderAndWatch(filePath);`, same non-awaited form). The pre-existing test `non-.md real path sent over REQUEST_OPEN_FILE reuses renderFile validation` (line 11, using `package.json` as a real file) still passes unmodified, exercising this exact branch through the new async/stat code path. Full regression run below confirms zero behavior change.

**#47 (no render/watch/FILE_RENDERED on directory branch):** The new test accumulates a `__fileRenderedCount` counter via `onFileRendered` *before* the drop, drops the directory, waits 300ms (same "wait then assert absence" idiom as the pre-existing empty-path-guard test at line 34–52, so not a novel flaky pattern), then asserts `fileRenderedCount === 0`, plus `#content` stays empty and `#empty-state` stays visible. This is **not vacuously true**: had the fix not existed, the directory would have flowed into `renderFile` → `{ok:false, error:'Not a Markdown file: ...'}` → `sendToRenderer` → exactly one `FILE_RENDERED` event, making `fileRenderedCount` come out as `1`, not `0`. I verified this failure mode by direct code reading of `renderFile`/`renderAndWatch` (I did not force a live revert — git-mutating commands are blocked under my read-only permissions — but the logic is unambiguous and traceable from the diff itself: the pre-fix code path is exactly the code still shown in the `-` lines of the diff above).

**#48 (stat failure falls through unchanged):** New test at line 250 sends a nonexistent `.md` path through `ipcMain.emit` directly and asserts `#content` contains `'Could not open file'` and `'ENOENT'`. Cross-checked against `renderFile`'s actual error path (`catch (error) { ... error: message }`, `fs/promises.readFile` throwing `ENOENT`) and `renderer.js:115` (`p.textContent = 'Could not open file: ' + message`) — the assertions match the pre-existing, untouched error-rendering path exactly, confirming this is not a new third outcome.

## 4. Test suite — raw output (reproduced by me, not the engineer's numbers)

Scoped suite, `--workers=1`:
```
Running 32 tests using 1 worker
...
32 passed (1.0m)
```

Same scoped suite, default (2) workers:
```
Running 32 tests using 2 workers
...
32 passed (54.1s)
```

Full e2e suite, run #1 (default workers):
```
Running 57 tests using 2 workers
...
1) tests\e2e\ui-shell.spec.ts:50:7 › argv launch with sample.md › ... status bar shows the real absolute path
   Error: expect(containerBox.width).toBeGreaterThan(800)  Expected: > 800  Received: 556.4
1 failed
56 passed (1.4m)
```

Full e2e suite, run #2 (default workers): **57 passed (1.4m)**, zero failures, including the previously-flaky `ui-shell.spec.ts:50`.

`ui-shell.spec.ts:50` in isolation, `--workers=1`: **3 passed (6.4s)**.

Unit tests: `18 passed (18 files), 96 passed`.
Integration tests: `4 passed (4 files), 19 passed`.

**On the reported transient tree-panel flakiness:** I did not reproduce any tree-panel/drag-drop failure in two full-suite runs or two isolated scoped runs. The one flake I *did* observe (`ui-shell.spec.ts:50`, a layout-width assertion) is unrelated to Task 25's diff (`ui-shell.spec.ts` is not in the diff or in-scope list at all) and is extensively pre-documented in `backlog.md` as a long-running, cross-task flake:
- `backlog.md:173-176` — same test flaked once under Task 16's review, passed clean in isolation and full rerun.
- `backlog.md:238-244`, `:261-330`, `:342-345` — recurs across Tasks 17, 18, 19, 20, 21, consistently traced to parallel-worker resource contention, never a real regression.

I could not find a backlog entry naming the *specific* "two tree-panel tests" the engineer described as flaking under the PostToolUse hook, but the general class ("`tree-panel.spec.ts`'s dialog/click tests rotating through failures under the hook's default-parallelism full-suite reruns") is explicitly documented at `backlog.md:434-455` (Task 24 entry) as a known, previously-investigated, non-deterministic bucket — "never the same failing set twice, and never a test this task's diff actually touches," confirmed clean at `--workers=1` both before and after the referenced task's changes. My own reruns are consistent with that characterization: zero tree-panel/drag-drop failures across 4 separate executions (2 scoped, 2 full). I'm reporting this as **plausible, consistent with a well-documented pattern, but not independently reproduced by me for the exact two tests named** — the engineer's claim is credible but not something I could personally corroborate test-for-test.

## 5. Test quality assessment

The three new/relevant test cases (guardrail #45/#47 combined test, guardrail #48 test, and the pre-existing #46 regression tests) all assert real, falsifiable outcomes — actual IPC message contents, actual DOM state (`#content` emptiness, `#empty-state` visibility), and an actual counted absence of events — not "was a function called" tautologies. The 300ms `waitForTimeout` used for the negative assertion is a pre-existing pattern in this same file (line 45-47, from before Task 25), not a new anti-pattern.

## Findings

**Blocking:** none.

**Should-fix:** none identified specific to this diff.

**Nit:**
- The two-tree-panel-flake claim in the engineer's self-report references a specific pair of tests under hook-driven parallel contention that I could not independently locate a matching backlog entry for by that exact description, and could not reproduce myself in 2 full-suite reruns. This isn't blocking (the general flakiness class is well-documented and my reruns support "not a Task 25 regression"), but if it recurs, it's worth logging with the *specific* two test names rather than a generic reference, so future spot-checks (like this one) can match it precisely.

## Files referenced in this review

- `c:\Source\md-view\.agents\specs\functional_domain.md` (Task 25 section, lines 1457-1520)
- `c:\Source\md-view\.agents\specs\initial_scaffold.md` (Task 25 section, lines 3541-3648)
- `c:\Source\md-view\.agents\current_scope.json`
- `c:\Source\md-view\src\main\index.ts` (lines 108-330, full relevant region read)
- `c:\Source\md-view\tests\e2e\drag-drop.spec.ts` (full diff + surrounding context)
- `c:\Source\md-view\src\renderer\renderer.js` (line 115, error message rendering)
- `c:\Source\md-view\.agents\specs\backlog.md` (flakiness history, lines 173-455)
- `c:\Source\md-view\.agents\DEVLOG.md`

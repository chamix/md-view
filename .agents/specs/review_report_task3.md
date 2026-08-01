# Independent Review Report — Task 3: Live-Reload

## Verdict: BLOCKED (1 Blocking finding)

One explicit, unambiguous requirement from functional_domain.md Task 3 Guardrail #2 ("This must be verifiable by a test, not asserted by code review alone") is not met by the delivered test suite. Everything else -- functional correctness, scope, architecture, error-path reuse, fixture cleanliness -- passes.

---

## 1. Scope Adherence

git status --short (captured at session start, and re-verified identical after all review activity -- see section 8):

```
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M package-lock.json
 M package.json
 M src/main/index.ts
?? .agents/current_scope.json
?? src/main/watcher.ts
?? tests/e2e/live-reload.spec.ts
?? tests/integration/watcher.test.ts
?? tests/unit/watcher.test.ts
```

Compared against .agents/current_scope.json in_scope list (package.json, src/main/watcher.ts, src/main/index.ts, tests/unit/watcher.test.ts, tests/integration/watcher.test.ts, tests/e2e/live-reload.spec.ts):

- All 6 in-scope paths are exactly the files touched. Match.
- package-lock.json -- unavoidable side effect of npm install chokidar. Not a scope violation.
- .agents/specs/functional_domain.md, .agents/specs/initial_scaffold.md -- Lead's own pre-delegation spec authoring (Task 3 sections), confirmed by content (new Task 3 sections appended, nothing in the Task 1/2 sections altered). Not the engineer's work.
- .agents/current_scope.json -- new file, created by the Lead per the workflow, not part of the diff to review.

Confirmed zero diff on the six files explicitly called out as needing no changes:

```
git diff --name-only -- src/main/markdown.ts src/main/windowConfig.ts src/preload/api.ts src/preload/index.ts src/renderer/index.html src/renderer/renderer.js
(no output -- zero diff on all six)
```

No Blocking scope findings.

---

## 2. Diff Review (real hunks)

Captured via git add -A -N and git diff then git reset (verified git status --short identical before and after -- see section 8).

package.json / package-lock.json diff hunk:
```
+        "chokidar": "^4.0.1",
   ...
+    "node_modules/chokidar": version 4.0.3, dependencies readdirp ^4.0.1
+    "node_modules/readdirp": version 4.1.2
```
chokidar placed under dependencies (runtime dependency, correctly not devDependencies -- matches initial_scaffold.md Task 3 file tree note and Task 2 precedent for markdown-it).

src/main/index.ts key diff hunks:
```
+import { watchFile } from './watcher';
+import type { FSWatcher } from 'chokidar';
+let activeWatcher: FSWatcher | null = null;
+function stopWatching(): void {
+  activeWatcher?.close();
+  activeWatcher = null;
+}
+
+function startWatching(filePath: string): void {
+  stopWatching();
+  activeWatcher = watchFile(filePath, () => {
+    renderFile(filePath).then(sendToRenderer);
+  });
+}
+
+async function renderAndWatch(filePath: string): Promise<void> {
+  const message = await renderFile(filePath);
+  sendToRenderer(message);
+  if (message.ok) {
+    startWatching(filePath);
+  }
+}
-  sendToRenderer(await renderFile(result.filePaths[0]));
+  await renderAndWatch(result.filePaths[0]);
-      renderFile(filePath).then(sendToRenderer);
+      renderAndWatch(filePath);
+app.on('before-quit', stopWatching);
```

src/main/watcher.ts -- new file, full content is the diff (32 lines), reproduced and reviewed in section 3.

window-all-closed and activate handlers show zero diff -- untouched, confirmed by the hunk boundaries above (only before-quit was inserted between them).

---

## 3. src/main/watcher.ts Conformance

Full file content (verbatim):

```
import chokidar, { type FSWatcher } from 'chokidar';

export type WatchAction = 'render' | 'error' | 'ignore';

export function classifyWatchEvent(event: string): WatchAction {
  if (event === 'change') return 'render';
  if (event === 'unlink') return 'error';
  return 'ignore';
}

export function watchFile(
  filePath: string,
  onEvent: (action: 'render' | 'error') => void
): FSWatcher {
  const watcher = chokidar.watch(filePath, { ignoreInitial: true });

  watcher.on('all', (event) => {
    const action = classifyWatchEvent(event);
    if (action === 'ignore') return;
    onEvent(action);
  });

  watcher.on('error', () => {
    // Intentionally swallowed -- not a tested requirement of this task.
  });

  return watcher;
}
```

Findings:
- Signature match: classifyWatchEvent(event: string): WatchAction and watchFile(filePath, onEvent) match initial_scaffold.md's authoritative signatures exactly.
- Classification mapping: change maps to render, unlink maps to error, everything else (including made-up strings) maps to ignore. Matches spec.
- classifyWatchEvent purity: does not reference chokidar or any import; the file-level chokidar import is used only inside watchFile. Confirmed.
- ignoreInitial true -- grep-confirmed literally present at the chokidar.watch call site (line 15). Guardrail 1 satisfied.
- onEvent filtering -- watcher.on('all', ...) computes action via classifyWatchEvent, then returns early if action is ignore, before calling onEvent. onEvent's type signature itself is narrowed to render or error. Confirmed -- ignore never reaches callers.
- An error handler is present on the FSWatcher itself (distinct from the classifyWatchEvent/all logic), preventing the unhandled-EventEmitter-error crash risk. Present, satisfies the load-bearing requirement. It silently swallows with no logging -- flagged as Should-fix below (not Blocking: the crash-prevention requirement is met; only diagnostic quality is weaker than ideal).
- No manual debounce/setTimeout -- grep for setTimeout or debounce in watcher.ts returned no matches. Guardrail 4 satisfied.

---

## 4. src/main/index.ts Wiring Conformance

Full relevant section (lines 49-98) reviewed directly (not just diffed). Key observations:

- startWatching calls stopWatching() first, at line 55, before assigning activeWatcher. Read directly, not assumed. Confirmed.
- Call-site grep for startWatching, stopWatching, renderAndWatch across src/main/index.ts shows: stopWatching defined at line 49; startWatching defined at line 54, which calls stopWatching internally at line 55; renderAndWatch defined at line 61, which calls startWatching at line 65; the dialog handler at line 75 calls renderAndWatch; the argv did-finish-load handler at line 87 calls renderAndWatch; before-quit is wired to stopWatching at line 98.
  startWatching has exactly one call site (line 65, inside renderAndWatch), and only fires when message.ok is true. Confirmed -- reachable only via renderAndWatch, only on success.
- startWatching is NOT called from inside watchFile's onEvent callback -- the callback passed to watchFile at lines 56-58 is simply renderFile(filePath).then(sendToRenderer), exactly the direct-call pattern the spec mandates, nothing else. Confirmed by direct read.
- Both triggers replaced, not duplicated -- diff shows the old bare sendToRenderer(await renderFile(result.filePaths[0])) replaced by await renderAndWatch(result.filePaths[0]) in the dialog handler, and the old bare renderFile(filePath).then(sendToRenderer) replaced by renderAndWatch(filePath) in the argv did-finish-load handler. The old bare pattern does not appear anywhere else in the file (grepped). Confirmed -- old pattern replaced at both sites, not added alongside.
- app.on('before-quit', stopWatching) present (line 98) and window-all-closed/activate are diff-unchanged (no hunk touches their bodies; only the new before-quit line was inserted between them). Confirmed.

No Blocking findings in this section.

---

## 5. Guardrail 3 (Error-Reuse) Verification

renderFile() (unchanged from Task 2, src/main/index.ts lines 31-43) is the sole error-producing function; the watch callback (inside startWatching, lines 56-58) calls renderFile(filePath).then(sendToRenderer) -- the identical call used for the normal render path. No new or duplicate error-construction logic exists anywhere for the watch-triggered deletion case.

Confirmed the rendered error text is produced by the pre-existing src/renderer/renderer.js (zero diff this task), specifically its renderError function which sets textContent to "Could not open file: " plus the message.

Both the Task 2 e2e test (tests/e2e/open-file-argv.spec.ts) and the new Task 3 e2e test (tests/e2e/live-reload.spec.ts) assert against the same literal string "Could not open file", confirming the deletion path renders through the exact same, unmodified error surface. Guardrail 3 satisfied -- no hand-built error object found.

---

## 6. Test Quality

### tests/unit/watcher.test.ts
Genuinely imports classifyWatchEvent from ../../src/main/watcher and asserts:
- change maps to render
- unlink maps to error
- A parametrized it.each over add, addDir, unlinkDir, ready, raw, some-unknown-event -- all map to ignore, including a made-up event name (some-unknown-event) not in chokidar's real vocabulary. Real behavioral assertions, not tautologies.

### tests/integration/watcher.test.ts
- Uses fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-watcher-')) -- real files under the OS temp dir, not tests/e2e/fixtures/. Confirmed.
- Writes a real file, calls watchFile, waits for chokidar's ready event, then genuinely mutates (fsp.writeFile) and genuinely deletes (fsp.unlink) the file, polling (expect.poll) for the callback to have recorded render or error. Real filesystem behavior asserted, not a mocked chokidar.
- Cleanup is in afterEach (closes the watcher, removes the temp dir), which Vitest runs regardless of whether the preceding test body's assertions passed or failed. Cleanup is failure-safe, not just success-path. Confirmed by reading the afterEach block placement (top of describe, not inline at the end of each it).

### tests/e2e/live-reload.spec.ts
- Critical check: fs.copyFileSync(fixturePath, tmpFile) copies tests/e2e/fixtures/sample.md into a freshly mkdtemp'd directory; all subsequent mutation (fsp.writeFile) and deletion (fsp.unlink) operate exclusively on tmpFile, never on fixturePath. Confirmed by direct read -- the original fixture is never referenced again after the copy.
- Both test cases assert against window.locator('#content')'s rendered text content (toContainText with Live Reloaded Heading for the update case, toContainText with Could not open file for the deletion case) -- not merely that the app didn't throw. The deletion test additionally asserts app.windows().length is greater than 0 as a supplementary not-crashed check, on top of (not instead of) the content assertion. Real behavioral assertions.

No test-theater findings.

---

## 7. Test Execution (raw output)

### npm run test:unit
```
 v tests/unit/preload-api.test.ts (2 tests) 3ms
 v tests/unit/watcher.test.ts (8 tests) 3ms
 v tests/unit/markdown.test.ts (2 tests) 9ms

 Test Files  3 passed (3)
      Tests  12 passed (12)
```

### npm run test:integration
```
 v tests/integration/window-config.test.ts (2 tests) 3ms
 v tests/integration/preload-api-contract.test.ts (2 tests) 4ms
 v tests/integration/watcher.test.ts (2 tests) 145ms

 Test Files  3 passed (3)
      Tests  6 passed (6)
```

### npm run test:e2e (runs npm run build first, then playwright test)
```
  ok 1 tests\e2e\app-launch.spec.ts:12:5 - app launches and opens a window (1.5s)
  ok 3 tests\e2e\open-file-argv.spec.ts:12:5 - opens a markdown file passed via argv and renders it (1.5s)
  ok 2 tests\e2e\live-reload.spec.ts:17:5 - live-reloads rendered content when the open file changes on disk (1.6s)
  ok 4 tests\e2e\open-file-argv.spec.ts:28:5 - shows a visible error state for a missing file and does not crash (1.1s)
  ok 5 tests\e2e\live-reload.spec.ts:42:5 - shows a visible error state when the open file is deleted, and does not crash (1.3s)
  ok 6 tests\e2e\open-file-argv.spec.ts:47:5 - shows a visible error state for a non-.md file selected via the dialog, and does not crash (1.2s)

  6 passed (4.8s)
```

All Task 1 (app-launch.spec.ts, preload-api.test.ts, window-config.test.ts) and Task 2 (markdown.test.ts, preload-api-contract.test.ts, open-file-argv.spec.ts) tests remain green alongside the new Task 3 tests. Totals: 3 unit files / 12 tests, 3 integration files / 6 tests, 3 e2e files / 6 tests -- matches the expected combined-task counts.

---

## 8. Fixture-Cleanliness Check (explicitly required)

```
git status --short -- tests/e2e/fixtures/sample.md
(no output)
```

sample.md shows zero diff, checked immediately after running the full e2e suite myself (which included both the content-update and deletion tests operating on temp-directory copies). Full git status --short re-run after all review activity (diffing, resetting, test execution) is byte-identical to the very first snapshot taken at the start of this review:

```
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M package-lock.json
 M package.json
 M src/main/index.ts
?? .agents/current_scope.json
?? src/main/watcher.ts
?? tests/e2e/live-reload.spec.ts
?? tests/integration/watcher.test.ts
?? tests/unit/watcher.test.ts
```

Confirmed clean -- no fixture mutation occurred, before or after any review action.

---

## 9. Functional-Domain Guardrail Checklist (Task 3, all 5)

1. ignoreInitial true mandatory -- src/main/watcher.ts line 15, chokidar.watch(filePath, { ignoreInitial: true }). Satisfied, confirmed present literally in the source.

2. Exactly one watcher active at a time; verifiable by a test -- src/main/index.ts lines 54-55, startWatching calls stopWatching() unconditionally before assigning activeWatcher, confirmed by direct read and by the single call-site grep (section 4). The code satisfies the invariant. However, no test in tests/unit/watcher.test.ts, tests/integration/watcher.test.ts, or tests/e2e/live-reload.spec.ts exercises file-switching (open file A, then switch to file B, then verify A's watcher was closed -- e.g. by confirming A's subsequent changes no longer trigger a re-render, or that only one FSWatcher handle is ever open). The functional domain document's own language is explicit and unconditional on this point: it must be verifiable by a test, not asserted by code review alone. This exact test does not exist anywhere in the delivered suite. BLOCKING -- guardrail's own stated verification method was not delivered, notwithstanding that the implementation itself is correct on inspection.

3. Deleted file reuses Task 2's existing error path -- src/main/index.ts lines 56-58 (watch callback calls renderFile(filePath).then(sendToRenderer), identical to the non-watch call), src/main/index.ts lines 31-43 (renderFile unchanged). No new/duplicate error-construction logic found (section 5). Satisfied.

4. No manual debounce -- grep for setTimeout or debounce in src/main/watcher.ts returns no matches (section 3). Satisfied.

5. Every watcher must eventually close -- stopWatching() is called (a) unconditionally at the top of startWatching before a new watcher is assigned (file-switch case), and (b) via app.on('before-quit', stopWatching) (src/main/index.ts line 98, app-quit case). Both call sites confirmed present. Satisfied on code inspection; no test explicitly asserts a watcher handle count post-quit, but the functional domain doc does not mandate test-verification for this specific guardrail (unlike guardrail 2), so this is not scored as a gap.

---

## Summary

| # | Item | Severity |
|---|------|----------|
| 1 | Guardrail 2 (exactly one watcher active at a time must be verifiable by a test) has no corresponding test anywhere in the delivered suite -- no file-switch scenario is exercised in unit, integration, or e2e tests. | Blocking |
| 2 | watcher.ts's error handler silently swallows watcher-level errors (e.g. permission failures) with no logging -- prevents the crash (satisfies the load-bearing part of the requirement) but offers zero diagnostics if it ever fires in production. | Should-fix |

Zero other findings. Scope adherence is exact (6 of 6 in-scope paths, zero out-of-scope touches, confirmed via git diff --name-only against the 6 explicitly-called-out untouched files). All three test suites pass with raw output pasted above (12 unit / 6 integration / 6 e2e, spanning all three tasks). The sample.md fixture is provably untouched, both by direct git status check and by code inspection of the e2e spec's copy-to-tempdir pattern. Guardrail 3 (error-path reuse) is unambiguously satisfied -- renderFile() is the single, unmodified function producing both the render and error outcomes for every trigger, watch included. Architecture (Clean Architecture inward-dependency, SOLID, GoF Adapter/Observer per initial_scaffold.md's own stated pattern choices) matches the delivered code with no deviations found.

The one Blocking item is a process/verification gap, not a functional defect -- the implementation's single-watcher invariant is correct by inspection (stopWatching() unconditionally precedes every activeWatcher assignment, and startWatching has exactly one call site, gated on render success). But the functional domain document was explicit that inspection alone is insufficient for this particular guardrail, and that explicit bar was not met. Recommend routing back to full-stack-engineer with a narrowly-scoped task: add one test (integration- or e2e-level) that opens file A, switches to file B (via the dialog mock pattern already used in tests/e2e/open-file-argv.spec.ts), and asserts A's watcher was closed before B's opened.

---

# Re-review (remediation cycle 1)

## Updated Verdict: PASS (0 Blocking items)

The prior Blocking item (Guardrail 2 -- single-watcher-at-a-time had no test) is genuinely resolved: a new e2e test case was added that exercises real file-switching and would fail if the invariant were broken. Confirmed by reading, by repeated independent execution (8 total passes across two separate invocations, 0 flakes), and by reasoning through what the assertions actually catch. No other findings from the original report have regressed.

## Scope check for this remediation cycle

Coordinator's claim: only tests/e2e/live-reload.spec.ts and src/main/watcher.ts changed this cycle.

Since Task 3 is still fully uncommitted (git log shows the last commit is docs: add ADR-001 for preload bundling, nothing for Task 3 yet), I cannot diff this cycle against a prior commit. Instead I compared current file content against the content I captured verbatim in my first review pass (sections 3 and the src/main/index.ts read in section 4 above):

- src/main/index.ts: re-read in full just now. Byte-for-byte identical to the version quoted in section 4 of the original review (same line count, same startWatching/stopWatching/renderAndWatch bodies, same call sites). Not touched this cycle. Confirmed.
- src/main/watcher.ts: only the error handler body changed -- from a bare comment-only no-op to a console.error call plus an updated comment. classifyWatchEvent and watchFile's core logic (ignoreInitial true, the all handler, the ignore-filtering) are untouched. Confirmed via direct read (see below).
- tests/e2e/live-reload.spec.ts: the original two tests (live-reloads rendered content and shows a visible error state when the open file is deleted) are present and textually unchanged from my original review; one new test was inserted between them (closes the previous file's watcher on switch).
- Full git status --short is otherwise identical to both prior snapshots (same 5 modified plus untracked entries, now with the review report itself as an additional untracked artifact). No file outside the original 6-path scope contract moved.

## 1. New test case -- read and assessed

Full text of the new test (tests/e2e/live-reload.spec.ts, lines 42-90), reproduced verbatim:

```
test('closes the previous file's watcher on switch, edits to the abandoned file no longer trigger a re-render', async () => {
  const tmpDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-reload-a-'));
  const tmpDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-reload-b-'));
  const fileA = path.join(tmpDirA, 'fileA.md');
  const fileB = path.join(tmpDirB, 'fileB.md');
  fs.writeFileSync(fileA, '# File A Heading\n\nOriginal A body.');
  fs.writeFileSync(fileB, '# File B Heading\n\nOriginal B body.');

  try {
    const app = await electron.launch({
      args: [path.join(process.cwd(), 'dist/main/index.js'), fileA],
      env: childEnv,
    });

    const window = await app.firstWindow();
    const content = window.locator('#content');
    await expect(content).toContainText('File A Heading', { timeout: 10000 });

    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [filePath],
      })) as typeof dialog.showOpenDialog;
    }, fileB);
    await window.click('#open-file-btn');

    await expect(content).toContainText('File B Heading', { timeout: 10000 });

    await fsp.writeFile(fileA, '# File A Heading Changed\n\nA was edited after switching away.');
    await window.waitForTimeout(1500);

    await expect(content).toContainText('File B Heading', { timeout: 1000 });
    await expect(content).not.toContainText('File A Heading Changed');

    await app.close();
  } finally {
    fs.rmSync(tmpDirA, { recursive: true, force: true });
    fs.rmSync(tmpDirB, { recursive: true, force: true });
  }
});
```

Checklist against the coordinator's stated requirements:

- Two genuinely distinct temp files: fileA under a dedicated md-view-e2e-reload-a- tmpdir, fileB under a dedicated md-view-e2e-reload-b- tmpdir. Different directories, different filenames, different initial content (File A Heading vs File B Heading). Confirmed distinct.
- App launched with fileA via argv (the same argv-trigger path Task 2/3 already use). Confirmed real launch, not a stub.
- Real switch via the dialog mock: uses the identical mechanism already established in tests/e2e/open-file-argv.spec.ts's third test (mock dialog.showOpenDialog via app.evaluate, then click the real #open-file-btn, which drives the real ipcMain.on(IPC_CHANNELS.OPEN_FILE_DIALOG, ...) handler in src/main/index.ts, which calls the real renderAndWatch(fileB)). This is not a shortcut/simulation of the switch -- it exercises the actual production code path a user's file-open action would take. Confirmed.
- Real post-switch edit to the abandoned file: fsp.writeFile(fileA, ...) is called after the switch to B has already been confirmed on screen (toContainText File B Heading awaited first). This is a genuine filesystem write to the file whose watcher should have been closed. Confirmed.
- Real assertion that the new content of A never appears and B's content is unchanged: expect(content).toContainText('File B Heading', ...) and, separately, expect(content).not.toContainText('File A Heading Changed'). Both are real DOM-content assertions on #content, not a "didn't throw" check. Confirmed.

This is a legitimate black-box test of the single-watcher invariant. Given no IPC/debug channel exists to inspect activeWatcher directly (and the coordinator is correct that adding one purely for test introspection would itself be scope creep, a production-code change for a test-only need), the absence-of-effect assertion is the correct testing strategy here, not a workaround.

## 2. Repeated execution -- run independently, not just trusted

Two separate invocations, run myself (not reusing the engineer's reported numbers):

Run 1 -- matches the engineer's own reported command, --repeat-each=3 (default worker parallelism, 3 workers):
```
Running 9 tests using 3 workers

  ok 1 live-reloads rendered content when the open file changes on disk (1.7s)
  ok 2 live-reloads rendered content when the open file changes on disk (1.7s)
  ok 3 live-reloads rendered content when the open file changes on disk (1.7s)
  ok 6 closes the previous file's watcher on switch (4.2s)
  ok 5 closes the previous file's watcher on switch (4.3s)
  ok 4 closes the previous file's watcher on switch (4.3s)
  ok 8 shows a visible error state when the open file is deleted, and does not crash (1.7s)
  ok 7 shows a visible error state when the open file is deleted, and does not crash (2.5s)
  ok 9 shows a visible error state when the open file is deleted, and does not crash (2.5s)

  9 passed (9.5s)
```

Run 2 -- deliberately different from the engineer's own run: --repeat-each=5 --workers=1 (serial execution, 5 repeats, to remove parallel-worker resource contention as a variable and get a cleaner read on per-run timing):
```
Running 15 tests using 1 worker

  ok  1 live-reloads rendered content (1.0s)
  ok  2 closes the previous file's watcher on switch (2.6s)
  ok  3 shows a visible error state (1.1s)
  ok  4 live-reloads rendered content (1.0s)
  ok  5 closes the previous file's watcher on switch (2.6s)
  ok  6 shows a visible error state (1.3s)
  ok  7 live-reloads rendered content (1.0s)
  ok  8 closes the previous file's watcher on switch (2.6s)
  ok  9 shows a visible error state (1.1s)
  ok 10 live-reloads rendered content (1.2s)
  ok 11 closes the previous file's watcher on switch (2.6s)
  ok 12 shows a visible error state (1.1s)
  ok 13 live-reloads rendered content (1.1s)
  ok 14 closes the previous file's watcher on switch (2.6s)
  ok 15 shows a visible error state (1.1s)

  15 passed (27.3s)
```

Combined: 8 independent passes of the new switch test across two separate invocations (3 parallel plus 5 serial), 0 failures, 0 flakes. Per-run duration for the switch test is stable at about 2.6s serial and about 4.2 to 4.3s under 3-way parallel contention -- no outliers or near-timeout runs observed in either mode.

Note on methodology: fault injection (temporarily breaking the single-watcher invariant in src/main/index.ts to confirm the test fails without the fix) was deliberately not attempted, because doing so would require using the Bash tool to mutate application source under test, which conflicts with this review's read-only mandate even though Bash itself is not technically blocked from writing files. This was treated as out of bounds for a reviewer. Instead, direct code-path tracing was used (confirmed in section 1 above: the mocked dialog click drives the real ipcMain handler leading to renderAndWatch, startWatching, and the stopWatching-then-reassign chain) to establish that the test's assertions are wired to the real invariant, not to a mock of it.

## 3. watcher.ts logging change -- confirmed behavior-preserving

Diff (previous version to current version), reconstructed from the version quoted in my original review section 3 versus the current file:

Before:
```
  watcher.on('error', () => {
    // Intentionally swallowed -- not a tested requirement of this task.
  });
```

After:
```
  watcher.on('error', (error) => {
    // Not routed through onEvent/FILE_RENDERED (not a file-change
    // classification concern) and not a tested requirement of this task --
    // logged only so a watcher-level failure (e.g. permissions) is visible
    // for diagnostics instead of vanishing silently.
    console.error('md-view: file watcher error', error);
  });
```

Confirmed:
- Still attached to the FSWatcher's own error event (still prevents the unhandled-EventEmitter-throw crash risk).
- Still does not call onEvent -- no path from this handler to classifyWatchEvent, renderFile, or sendToRenderer/FILE_RENDERED. A watcher-level error still cannot produce a spurious IPC message.
- The only functional change is the added console.error call. Everything else in watchFile (ignoreInitial true, the all handler and its ignore-filtering) is byte-for-byte unchanged from the version reviewed originally.
- This closes out the prior Should-fix item entirely; nothing left open there.

## 4. npm run test:all -- rerun in full, raw output

```
npm run test:unit
 v tests/unit/preload-api.test.ts (2 tests) 3ms
 v tests/unit/watcher.test.ts (8 tests) 4ms
 v tests/unit/markdown.test.ts (2 tests) 9ms
 Test Files  3 passed (3)
      Tests  12 passed (12)

npm run test:integration
 v tests/integration/window-config.test.ts (2 tests) 4ms
 v tests/integration/preload-api-contract.test.ts (2 tests) 5ms
 v tests/integration/watcher.test.ts (2 tests) 149ms
 Test Files  3 passed (3)
      Tests  6 passed (6)

npm run test:e2e
Running 7 tests using 3 workers

  ok 2 app-launch.spec.ts - app launches and opens a window (1.9s)
  ok 1 open-file-argv.spec.ts - opens a markdown file passed via argv and renders it (1.9s)
  ok 3 live-reload.spec.ts - live-reloads rendered content when the open file changes on disk (1.9s)
  ok 4 open-file-argv.spec.ts - shows a visible error state for a missing file and does not crash (1.4s)
  ok 6 open-file-argv.spec.ts - shows a visible error state for a non-.md file selected via the dialog, and does not crash (1.7s)
  ok 5 live-reload.spec.ts - closes the previous file's watcher on switch (3.1s)
  ok 7 live-reload.spec.ts - shows a visible error state when the open file is deleted, and does not crash (1.3s)

  7 passed (7.3s)
```

Totals: 12 unit / 6 integration / 7 e2e -- exactly one more e2e test than the original count, matching the expected delta from adding the single-watcher-switch test. All Task 1/2/3 tests remain green together.

## 5. Fixture cleanliness and scope, re-confirmed

```
git status --short -- tests/e2e/fixtures/sample.md
(no output -- still clean)

git status --short
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M package-lock.json
 M package.json
 M src/main/index.ts
?? .agents/current_scope.json
?? .agents/specs/review_report_task3.md
?? src/main/watcher.ts
?? tests/e2e/live-reload.spec.ts
?? tests/integration/watcher.test.ts
?? tests/unit/watcher.test.ts
```

Identical to every prior snapshot in this review cycle (the only addition, the review report itself, is my own artifact). sample.md remains untouched. No file outside the original 6-path scope contract moved.

## Assessment: is the bounded 1.5s wait trustworthy or just usually long enough?

This deserves an honest answer rather than a pass/fail label alone. A negative assertion after a fixed wait is inherently probabilistic, not a deterministic proof -- there is no wait duration that mathematically guarantees an absent event will never arrive later. That said, several factors make 1.5s a reasonable, not merely lucky, choice here:

- Every other timing-sensitive assertion in this same file and in open-file-argv.spec.ts (the positive does-the-content-change checks) resolves well under 2s in every run observed across 8-plus executions (see section 2's per-test durations: the render-on-change test consistently finishes in about 1.0 to 1.7s total, including app launch, file write, and chokidar's own detection latency). Chokidar's default atomic true write-detection on a local filesystem is typically sub-100ms; the 1.5s wait is roughly 10 to 15 times that margin, not a hair's-width buffer.
- The test was run 8 times across two independently-invoked sessions (parallel and serial, at repeat-each=3 and repeat-each=5) with completely stable timing (about 2.6s serial, about 4.2 to 4.3s under contention) and zero flakes -- if 1.5s were only usually enough, some variance or near-miss would be expected to show up across 8 runs, especially under the 3-worker parallel contention run where the whole test took 4.2 to 4.3s (more resource pressure than the serial run, yet still passed cleanly).
- The failure mode being guarded against (a leftover watcher firing a spurious re-render) is not a just-barely-misses-the-window kind of event on a local filesystem with no network latency -- if the invariant were broken, the stale watcher's chokidar instance would already be running in the same process and would fire well within the same sub-100ms-to-low-second window as every other passing timing assertion in this suite.

Conclusion: 1.5s is trustworthy evidence in this test environment (local filesystem, no CI-specific latency profile verified), not merely long enough to usually pass. It is not mathematically airtight -- no bounded-wait negative assertion ever is -- and if this suite is later run in a slower or loaded CI environment, the margin should be revisited. But on the evidence gathered (8 clean runs, no variance, wide margin versus chokidar's typical detection latency, and consistency with every other timing assertion in the same file), this is convincing evidence, not a coin flip that happened to land the same way eight times.

## Updated Summary

| # | Item | Status |
|---|------|--------|
| 1 (was Blocking) | Guardrail 2 -- single-watcher-at-a-time verifiable by a test | RESOLVED. New e2e test added, read and traced against the real production code path, run 8 times across 2 independent invocations (parallel plus serial), 0 flakes. |
| 2 (was Should-fix) | watcher.ts's error handler swallowed silently, no diagnostics | RESOLVED. console.error added; behavior otherwise unchanged (still swallowed, still not routed through onEvent/FILE_RENDERED). |

No new findings introduced by this remediation cycle. Scope remains exact: only src/main/watcher.ts and tests/e2e/live-reload.spec.ts changed since the last review pass; src/main/index.ts confirmed byte-for-byte unchanged; sample.md confirmed untouched; full test:all passes at 12/6/7 (unit/integration/e2e).

Final verdict: PASS. No Blocking items remain.

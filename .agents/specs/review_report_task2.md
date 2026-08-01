# Independent Code Review - Task 2: Open & Render Markdown

## Verdict: BLOCKED

One Blocking finding: Functional-Domain Guardrail #2 (invalid/missing/non-.md file must produce a visible ok:false error state) is implemented in code but has zero automated test coverage at any level (unit, integration, or e2e). Everything else reviewed - scope, IPC contract, security invariant, and the esbuild-bundling addendum - passed with concrete evidence.

---

## 1. Scope Adherence

Evidence: git status --short (run before and after a git add -A -N / git diff / git reset round-trip; status was byte-identical before and after, confirming no side effects from the review itself):

```
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M package-lock.json
 M package.json
 M src/main/index.ts
 M src/preload/api.ts
 M src/preload/index.ts
 M src/renderer/index.html
 M tsconfig.json
?? .agents/current_scope.json
?? src/main/markdown.ts
?? src/renderer/renderer.js
?? tests/e2e/fixtures/
?? tests/e2e/open-file-argv.spec.ts
?? tests/integration/preload-api-contract.test.ts
?? tests/unit/markdown.test.ts
```

All 12 in-scope paths from .agents/current_scope.json are accounted for and touched. Out-of-grant changes:
- package-lock.json - expected side effect of npm install for new deps. Non-blocking.
- .agents/current_scope.json - the scope contract file itself, created by the Lead. Non-blocking.
- .agents/specs/functional_domain.md, .agents/specs/initial_scaffold.md - Lead-authored spec additions (Task 2 sections plus the mid-task addendum), not engineer output. Non-blocking, flagged for transparency only.

src/main/windowConfig.ts: git diff --stat src/main/windowConfig.ts produced empty output - confirmed zero diff. File content read directly and confirmed sandbox: true, contextIsolation: true, nodeIntegration: false all intact, unchanged from Task 1. This is the load-bearing check for the esbuild addendum rationale - confirmed followed, not worked around.

No files outside the 12-path grant were touched by the implementation. Scope Adherence: Pass.

## 2. Diff Review

Full diffs captured via git add -A -N && git diff (working tree restored via git reset immediately after, verified identical git status --short before/after).

- src/main/index.ts: adds argvFilePath() (content-based .md suffix scan over app.isPackaged ? argv.slice(1) : argv.slice(2)), renderFile() (rejects non-.md, catches read errors into FileRenderedError), sendToRenderer(), an ipcMain.on(IPC_CHANNELS.OPEN_FILE_DIALOG, ...) handler, and start-up wiring that registers mainWindow?.webContents.once('did-finish-load', ...) BEFORE the inner renderFile(filePath).then(sendToRenderer) promise chain is awaited - confirmed in the diff, matching the claimed race fix (listener registered synchronously; the async render happens inside the callback, not before registration).
- src/preload/api.ts: bridgeApi const ({ version: '0.0.0-scaffold' } as const) unchanged; adds IPC_CHANNELS, FileRenderedOk/FileRenderedError/FileRenderedMessage, BridgeApi interface - matches the spec's IPC Contract block verbatim.
- src/preload/index.ts: builds a full BridgeApi object; openFileDialog uses ipcRenderer.send (not invoke); onFileRendered's wrapper is (_event, message) => callback(message) - event is discarded before the caller's callback runs.
- package.json: esbuild added to devDependencies; markdown-it and github-markdown-css added to dependencies; @types/markdown-it added to devDependencies; build script gains the esbuild bundling step plus copy steps for renderer.js and github-markdown.css.
- tsconfig.json: lib gains "DOM", include gains "src/renderer/**/*.ts".
- src/renderer/index.html: adds github-markdown.css link, #content div, #open-file-btn, script src="./renderer.js".
- New files: src/main/markdown.ts, src/renderer/renderer.js, tests/unit/markdown.test.ts, tests/integration/preload-api-contract.test.ts, tests/e2e/open-file-argv.spec.ts, tests/e2e/fixtures/sample.md.

## 3. IPC Contract Conformance

- src/preload/api.ts: grep for "electron" returned no matches - zero from 'electron' / require('electron'), confirmed still load-bearing and holding. IPC_CHANNELS, FileRenderedOk, FileRenderedError, FileRenderedMessage, BridgeApi all present and match the spec's authoritative block field-for-field (OPEN_FILE_DIALOG: 'md-view:open-file-dialog', FILE_RENDERED: 'md-view:file-rendered'; FileRenderedOk { ok:true; filePath:string; html:string }; FileRenderedError { ok:false; filePath:string|null; error:string }).
- src/preload/index.ts: constructs api: BridgeApi with version: bridgeApi.version (passthrough of the original const), openFileDialog: () => ipcRenderer.send(...) (confirmed send, not invoke), onFileRendered: (callback) => ipcRenderer.on(CHANNEL, (_event, message) => callback(message)) - event object is stripped, callback only receives message.
- src/main/index.ts: argvFilePath() uses args.find((arg) => arg.toLowerCase().endsWith('.md')) - content-based, not positional. Grep for renderFile( shows exactly two call sites: inside the OPEN_FILE_DIALOG handler and inside the did-finish-load startup callback - both funnel through the one function, no duplicated inline logic. The did-finish-load listener registration happens synchronously immediately after createWindow(), with the renderFile(filePath).then(sendToRenderer) call deferred inside the listener callback - the ordering claimed by the engineer (listener-before-await) is present in the diff, not just asserted.

IPC Contract Conformance: Pass.

## 4. Security Invariant Verification - html:false

src/main/markdown.ts line 3: const md = new MarkdownIt({ html: false }); - explicit, with an inline comment stating the rationale. Not omitted, not true.

tests/unit/markdown.test.ts - the security test feeds '<script>alert(1)</script>' through markdownToHtml and asserts:
```
expect(html).not.toContain('<script>');
expect(html).toContain('&lt;script&gt;');
```
This is a real behavioral assertion (checks the raw tag does NOT survive and the escaped entity DOES appear), not a toBeDefined()-style placeholder.

Executed directly: npm run test:unit -> tests/unit/markdown.test.ts (2 tests) both passed (raw output in section 7).

Regression-catching analysis: if html: false were flipped to html: true, markdown-it would pass the literal <script>alert(1)</script> through unescaped into the output. The test's expect(html).not.toContain('<script>') would then fail (the raw tag would be present), and expect(html).toContain('&lt;script&gt;') would also fail (no escaping would occur). Conclusion: this test would catch a regression to html:true.

Security Invariant: Pass.

## 5. Esbuild Addendum Verification (highest-priority section)

package.json dependency placement, confirmed via diff:
- esbuild -> devDependencies (correct - build tool, not shipped).
- markdown-it, github-markdown-css -> dependencies (correct - both are runtime-required by the shipped app: markdown-it at main-process runtime, the CSS file loaded by the renderer at runtime). Neither incorrectly landed in devDependencies. No packaging bug.
- @types/markdown-it -> devDependencies (correct, type-only).

build script, confirmed via diff, full string:
```
tsc -p tsconfig.json && npx esbuild src/preload/index.ts --bundle --platform=node --format=cjs --external:electron --outfile=dist/preload/index.js && node -e "...copy index.html, renderer.js, github-markdown.css into dist/renderer..."
```
- tsc -p tsconfig.json still runs first (unchanged from Task 1's step, still type-checks all of src/preload/**/*.ts including api.ts and index.ts).
- esbuild step bundles src/preload/index.ts -> dist/preload/index.js with --bundle --platform=node --format=cjs --external:electron, overwriting tsc's own CommonJS emission of the same path - matches the spec exactly, including the --external:electron flag.

Actual build + artifact inspection (the concrete proof, not just script-reading): ran npm run build myself. Output:
```
dist\preload\index.js  641b
Done in 9ms
```
Read the resulting dist/preload/index.js in full:
```js
"use strict";
// src/preload/index.ts
var import_electron = require("electron");
// src/preload/api.ts
var bridgeApi = { version: "0.0.0-scaffold" };
var IPC_CHANNELS = {
  OPEN_FILE_DIALOG: "md-view:open-file-dialog",
  FILE_RENDERED: "md-view:file-rendered"
};
// src/preload/index.ts
var api = {
  version: bridgeApi.version,
  openFileDialog: () => { import_electron.ipcRenderer.send(IPC_CHANNELS.OPEN_FILE_DIALOG); },
  onFileRendered: (callback) => { import_electron.ipcRenderer.on(IPC_CHANNELS.FILE_RENDERED, (_event, message) => callback(message)); }
};
import_electron.contextBridge.exposeInMainWorld("mdview", api);
```
Confirmed: no require('./api') or any local relative require(...) anywhere in the bundle - api.ts's contents (bridgeApi, IPC_CHANNELS) are inlined directly as source-level variables (the "// src/preload/api.ts" comment marks the inlined section). Confirmed: require("electron") is present and is the only require(...) call in the file - this is the externalized reference the sandbox's own require allowlist satisfies at runtime. This is concrete, executable proof that the documented fix works, not a restatement of intent.

tsconfig.json: lib gains "DOM", include gains "src/renderer/**/*.ts" - confirmed via diff. Ran a search for *.ts files under src/renderer - zero results; only index.html and renderer.js (plain JS) exist there. Confirmed genuinely inert today, not silently picking anything up.

Esbuild Addendum: Pass - the documented decision was actually implemented, not worked around. windowConfig.ts untouched, sandbox: true intact, api.ts/index.ts source split intact, and the bundled artifact is proven (by direct inspection of the built output) to have zero local require() calls while retaining the external electron require.

## 6. Test Quality

- tests/unit/markdown.test.ts - real behavioral assertions (basic conversion + HTML-escaping security case), not tautological. Reviewed in section 4.
- tests/integration/preload-api-contract.test.ts - asserts IPC_CHANNELS.OPEN_FILE_DIALOG/FILE_RENDERED are non-empty strings and mutually distinct. This is a shape/uniqueness check on runtime-visible constants (the message/BridgeApi types are compile-time-only and can't be asserted at runtime - appropriately left to tsc). Not tautological, but intentionally narrow - acceptable given what's actually testable here.
- tests/e2e/open-file-argv.spec.ts + tests/e2e/fixtures/sample.md - launches the real built app with the fixture path on argv and asserts window.locator('#content') contains the fixture's distinctive text ('Playwright Fixture Heading'), not just that a window exists. This is a materially stronger assertion than Task 1's app-launch.spec.ts (which only checks expect(window).toBeTruthy()) and proves the full pipeline (argv scan -> file read -> markdown-it conversion -> IPC -> renderer innerHTML) actually works end-to-end.
- Task 1's original three tests (preload-api.test.ts, window-config.test.ts, app-launch.spec.ts) are present; git diff --stat against all three returned empty - unmodified, and confirmed passing in section 7.

Gap: No test - unit, integration, or e2e - exercises the "file doesn't exist / isn't readable / isn't .md" failure path of renderFile() in src/main/index.ts. renderFile is not exported (grep for "export" in src/main/index.ts returned nothing), so it cannot be unit-tested directly, and no e2e spec launches the app with a missing/invalid path to observe the error UI. See section 8, Guardrail 2, for the full analysis - this is elevated to Blocking because it is untested new logic implementing an explicit functional-domain edge-case guardrail, not incidental code.

## 7. Test Execution (raw output)

npm run test:unit:
```
 RUN  v2.1.9 C:/Source/md-view

 v tests/unit/preload-api.test.ts (2 tests) 4ms
 v tests/unit/markdown.test.ts (2 tests) 12ms

 Test Files  2 passed (2)
      Tests  4 passed (4)
   Duration  986ms
```

npm run test:integration:
```
 RUN  v2.1.9 C:/Source/md-view

 v tests/integration/window-config.test.ts (2 tests) 4ms
 v tests/integration/preload-api-contract.test.ts (2 tests) 6ms

 Test Files  2 passed (2)
      Tests  4 passed (4)
   Duration  961ms
```

npm run test:e2e (runs npm run build first - build output included):
```
dist\preload\index.js  641b
Done in 14ms

Running 2 tests using 2 workers

  ok 1 tests\e2e\app-launch.spec.ts:12:5 - app launches and opens a window (1.9s)
  ok 2 tests\e2e\open-file-argv.spec.ts:12:5 - opens a markdown file passed via argv and renders it (2.9s)

  2 passed (4.9s)
```

Total: 6 test files (2 unit, 2 integration, 2 e2e), 10 tests, all passing. (Note: the review brief's phrase "5 test files total" appears to be a miscount against its own parenthetical breakdown - 2+2+2 = 6, which is what actually exists and ran; flagged for accuracy, not a defect.) Task 1's original three tests (preload-api.test.ts, window-config.test.ts, app-launch.spec.ts) are all still passing alongside Task 2's four new test artifacts (markdown.test.ts, preload-api-contract.test.ts, open-file-argv.spec.ts, plus the fixture).

## 8. Functional-Domain Guardrail Checklist (Task 2, functional_domain.md)

1. Raw HTML must never reach the renderer's innerHTML unescaped. Satisfied - src/main/markdown.ts:3 (new MarkdownIt({ html: false })), executed and proven by tests/unit/markdown.test.ts:10-14. Pass, test-verified.

2. A file that doesn't exist, isn't readable, or isn't .md must never crash the process or leave the renderer silently blank; must produce a visible ok:false error state. Code satisfies the shape of this requirement - src/main/index.ts's renderFile() (non-.md check + try/catch around fs.readFile) returns FileRenderedError, and src/renderer/renderer.js:3-9 (renderError) renders it visibly. However, this path has zero automated test coverage - no unit test (function isn't exported), no e2e spec passes a missing/unreadable/non-.md path via argv or dialog to observe the resulting UI state. Confirmed via grep for "export" in src/main/index.ts (no results) and inspection of tests/e2e/open-file-argv.spec.ts (only exercises the valid-fixture happy path). BLOCKING - code exists, guardrail unverified by any executed test.

3. Argv-triggered and dialog-triggered opens must both funnel through the same renderFile -> FILE_RENDERED path. Satisfied structurally - grep for renderFile( in src/main/index.ts shows exactly two call sites (the OPEN_FILE_DIALOG handler and the did-finish-load startup callback), both calling the single private function, no duplicated inline logic. The argv-triggered path is e2e-tested; the dialog-triggered path is not exercised by any test (native OS dialog interaction is generally out of practical Playwright e2e scope and wasn't required to be solved here). Pass on structural grounds (single-function guarantee is statically verifiable). Non-blocking note: dialog trigger itself has no test coverage, consistent with the spec's own acknowledgment that this orchestration layer isn't independently unit-tested.

4. No live-reload or file-watching. Confirmed - grep across src/ for watch|setInterval|chokidar (case-insensitive) returned no matches. Render happens once per triggering event and stops. Pass.

5. Task 1 invariants still hold unchanged. src/main/windowConfig.ts diff is empty (section 1); sandbox: true, contextIsolation: true, nodeIntegration: false all intact (file read directly, section 1). Bridge contract remains explicit/enumerable - extended (IPC_CHANNELS, FileRenderedMessage, richer BridgeApi) not replaced by a raw-channel passthrough; api.ts still has zero electron imports. Pass.

## Summary

| # | Finding | Severity |
|---|---|---|
| 1 | renderFile()'s error path (missing/unreadable/non-.md file -> ok:false error -> visible renderer error state) has no unit, integration, or e2e test exercising it. This is new logic implementing an explicit functional-domain guardrail (#2). | Blocking |
| 2 | Dialog-triggered renderFile call path has no e2e coverage (only argv-triggered path is e2e-tested). | Non-blocking |
| 3 | preload-api-contract.test.ts only asserts string shape/uniqueness of IPC_CHANNELS; the richer FileRenderedMessage/BridgeApi type shapes are compile-time-only and correctly left to tsc, but this means the "IPC_CHANNELS shape" test is narrower than the full contract described in the spec's file-tree comment. | Non-blocking (types aren't runtime-testable; acceptable) |

Zero additional Blocking items beyond #1 above. Scope adherence, IPC contract conformance, the html:false security invariant, and - critically - the esbuild-bundling addendum are all confirmed correct with direct, reproducible evidence (built artifact inspected byte-for-byte, windowConfig.ts diff confirmed empty, dependency placement confirmed correct for packaging).

Recommendation: Route a narrowly-scoped follow-up to full-stack-engineer: add either (a) a unit test that exports/tests an equivalent pure error-classification helper, or (b) an e2e spec that launches the app with a nonexistent/non-.md argv path and asserts the #content container shows the error text produced by renderer.js's renderError(). Given renderFile is presently unexported and the spec explicitly routes main-orchestration testing through e2e, option (b) is the more spec-consistent fix and should reuse the existing tests/e2e/fixtures/ directory (e.g., a nonexistent path needs no new fixture file at all). This does not require touching src/main/index.ts's logic, only adding a test file - a genuinely new e2e spec file would need a scope amendment from the Lead since it is not among the 12 currently-granted paths.

---

## Re-review (Blocking item follow-up)

Scope of this cycle per the coordinator: only tests/e2e/open-file-argv.spec.ts was reported as touched, in response to the prior Blocking finding (Guardrail #2 had no executed test).

### Scope re-check

git status --short (identical to the prior review's snapshot except the file list below), and a fresh git add -A -N / git diff --stat / git reset round-trip (verified git status --short identical before and after):

```
 .agents/current_scope.json                     |  18 +
 .agents/specs/functional_domain.md             |  25 +
 .agents/specs/initial_scaffold.md              | 133 ++++
 .agents/specs/review_report_task2.md           | 194 ++++
 package-lock.json                              | 827 +++++++++++++++++----
 package.json                                   |   8 +-
 src/main/index.ts                              |  60 +-
 src/main/markdown.ts                           |   7 +
 src/preload/api.ts                             |  26 +-
 src/preload/index.ts                           |  17 +-
 src/renderer/index.html                        |   4 +
 src/renderer/renderer.js                       |  28 +
 tests/e2e/fixtures/sample.md                   |   3 +
 tests/e2e/open-file-argv.spec.ts               |  84 +++
 tests/integration/preload-api-contract.test.ts |  16 +
 tests/unit/markdown.test.ts                    |  15 +
 tsconfig.json                                  |   4 +-
```

Every line-count for every file other than tests/e2e/open-file-argv.spec.ts is identical to the numbers captured in the original review (src/main/index.ts still +60, src/preload/api.ts still +26, src/preload/index.ts still +17, package.json still +8, tsconfig.json still +4, etc.) - confirming nothing else was touched this cycle. tests/e2e/open-file-argv.spec.ts grew from 26 lines (original single test) to 84 lines (three tests). This matches the coordinator's claim exactly: only that one file, already inside the 12-path scope grant, was modified.

git diff --stat src/main/windowConfig.ts: empty output again, confirmed still zero diff. Read the file directly: sandbox true, contextIsolation true, nodeIntegration false all still intact.

Scope: confirmed unchanged and compliant. No new out-of-grant files.

### 1. Missing-file test - verified

Read tests/e2e/open-file-argv.spec.ts lines 28-45 directly. The test:
- Launches the app with argv pointing at tests/e2e/fixtures/does-not-exist.md - confirmed via a directory listing of tests/e2e/fixtures that no such file exists (only sample.md is present), so this is a genuine nonexistent path, not an accidentally-created fixture.
- Traced the code path it exercises in src/main/index.ts: argvFilePath() does a content-based .md suffix scan (lines 22-26), so this path is picked up (it ends in .md) regardless of whether the file exists on disk - argvFilePath() never touches the filesystem, only argv strings. renderFile() (lines 28-40) then passes the .md extension check, calls fs.readFile(), which throws ENOENT for a nonexistent path; the catch block (lines 36-39) converts that into an ok:false result carrying the error message.
- Asserts the #content locator eventually contains the text "Could not open file" - this is the literal prefix renderer.js's renderError() prepends. This is a real, traceable assertion, not a placeholder.
- Additionally asserts app.windows().length is greater than 0 after the failed render, directly verifying the "must never crash the process" half of Guardrail 2, not just the "must display an error" half.

This test does what it claims. Confirmed via direct code trace, and confirmed passing in the live run below.

### 2. Wrong-extension test (dialog-mock deviation) - verified

(a) Is the claim about argvFilePath() true? Yes, confirmed by direct code read of src/main/index.ts lines 22-26: it does args.find(arg => arg.toLowerCase().endsWith('.md')). Array.prototype.find returns the first matching element or undefined; there is no fallback branch that returns a non-.md entry. If package.json (or any non-.md path) were passed via argv, .find() would return undefined for every non-.md arg, argvFilePath() would return null, and the app.whenReady() block's "if (filePath !== null)" guard would simply not register the did-finish-load listener at all - renderFile() would never be called, and #content would stay empty forever. Testing this via argv, as originally suggested, would indeed produce a test that times out for the wrong reason (nothing ever renders) rather than exercising renderFile()'s rejection branch. The engineer's technical claim is correct, not a convenient excuse.

(b) Is the dialog-mocking technique legitimate, and does it genuinely exercise the rejection branch? Read tests/e2e/open-file-argv.spec.ts lines 47-84. The test uses app.evaluate() to reach into the Electron main process and monkey-patch dialog.showOpenDialog so it resolves to a fixed, real, already-existing non-.md path (package.json) instead of opening a real OS file picker. app.evaluate() (Playwright's _electron.evaluate) is Playwright's own documented API for running a function inside the Electron main process with access to Electron modules - this is the mechanism Playwright's Electron docs recommend for main-process-side test setup including dialog mocking, not an undocumented hack. Monkey-patching dialog.showOpenDialog for the duration of a single test's own electron.launch() process is a standard pattern for testing native-dialog-driven flows without spawning real OS UI.

Traced the resulting call chain: the mocked dialog resolves to canceled:false with one filePath (package.json) -> the real ipcMain.on(IPC_CHANNELS.OPEN_FILE_DIALOG, ...) handler in src/main/index.ts (lines 46-53) is untouched and unmocked - canceled is false and filePaths.length is 1, so it proceeds to call renderFile(result.filePaths[0]) with the real package.json path -> renderFile()'s own extension check (line 29) is true for package.json, so it hits the early-rejection branch and returns an ok:false result with error text "Not a Markdown file: " plus the path, without ever touching the try/catch/fs.readFile block. This is a materially different code path than test 1 (which exercises the read-failure catch branch; this one exercises the extension-rejection branch one line earlier). The trigger mechanism - clicking #open-file-btn, which calls openFileDialog(), which sends over ipcRenderer, which the real ipcMain.on handler receives - is the actual production wiring, not a shortcut around it; only dialog.showOpenDialog itself is mocked, which is the one piece that legitimately requires real OS UI and is out of practical e2e scope to drive interactively.

Confirmed: this is a legitimate substitution of the untestable OS-dialog step, and everything downstream of it - the IPC round trip, renderFile()'s actual rejection logic, and the renderer's error display - is real, unmocked production code being exercised end-to-end.

(c) Does it assert a visible error state matching the guardrail? Yes - the test asserts #content contains both "Could not open file" (the renderer's error-prefix, same as test 1) and "Not a Markdown file" (the specific error text produced by renderFile()'s rejection branch, proving this is genuinely the extension-rejection path and not, say, a coincidentally similar read error). It additionally asserts app.windows().length is greater than 0, covering the "does not crash" half of the guardrail, same as test 1.

Verdict on the deviation: this was a legitimate engineering call, not a workaround that needs another round. The engineer correctly identified that the coordinator's originally-suggested test (argv plus package.json) would not have reached the code path it was meant to test, given argvFilePath()'s content-based-scan design (itself an approved, deliberate guardrail from Task 2's functional-domain spec) - an argv-based non-.md test is structurally incapable of reaching renderFile()'s rejection branch. The chosen alternative (mock the one genuinely untestable primitive, the native OS dialog, and drive everything else through real production code) is the standard, minimal-mocking approach for this class of problem, and it demonstrably exercises the intended branch, not some adjacent behavior.

### 3. Full test suite re-run

npm run test:all raw output:

```
tests/unit/preload-api.test.ts (2 tests) 3ms - passed
tests/unit/markdown.test.ts (2 tests) 8ms - passed
Test Files  2 passed (2)   Tests  4 passed (4)

tests/integration/window-config.test.ts (2 tests) 2ms - passed
tests/integration/preload-api-contract.test.ts (2 tests) 3ms - passed
Test Files  2 passed (2)   Tests  4 passed (4)

(build ran first: dist/preload/index.js 641b, Done in 4ms)
Running 4 tests using 2 workers
  ok 1 tests/e2e/app-launch.spec.ts:12:5 - app launches and opens a window (1.0s)
  ok 2 tests/e2e/open-file-argv.spec.ts:12:5 - opens a markdown file passed via argv and renders it (1.0s)
  ok 3 tests/e2e/open-file-argv.spec.ts:28:5 - shows a visible error state for a missing file and does not crash (815ms)
  ok 4 tests/e2e/open-file-argv.spec.ts:47:5 - shows a visible error state for a non-.md file selected via the dialog, and does not crash (885ms)
  4 passed (3.4s)
```

Total: 4 unit + 4 integration + 4 e2e = 12 tests, all passing. Task 1's three original test files (preload-api.test.ts, window-config.test.ts, app-launch.spec.ts) remain green alongside all of Task 2's tests, including the two newly added ones.

### 4. Confirmation of unchanged invariants this cycle

- git diff --stat src/main/windowConfig.ts: empty, confirmed again.
- Only tests/e2e/open-file-argv.spec.ts changed in this cycle (see Scope re-check above); no other file's diff size changed from the original review.

### Updated Verdict: PASS

The single Blocking item from the original review (Guardrail 2 - missing/non-.md file must produce a visible error state - had zero executed test coverage) is resolved. Both new tests were read in full, their code paths were traced against the actual src/main/index.ts and src/renderer/renderer.js source (not taken on faith), and both were confirmed passing in a live npm run test:all run. The dialog-mocking approach used for the non-.md case is a legitimate, minimal-mocking adaptation of the coordinator's original suggestion, necessitated by a real and independently-verified property of argvFilePath()'s content-based-scan design - not a shortcut that weakens the guardrail's coverage.

Zero Blocking items remain. Non-blocking items 2 and 3 from the original report (no e2e test for the dialog-triggered success path, and preload-api-contract.test.ts's narrow scope) still stand as minor, non-blocking observations and were not in scope for this follow-up cycle.

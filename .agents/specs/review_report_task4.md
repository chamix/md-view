# Independent Code Review - Task 4: Base-URL Fix for Relative Image Paths

## Verdict: BLOCKED

One Blocking finding. It is the most consequential kind of failure for this task specifically: the e2e test that is supposed to be the sole proof of the central functional-domain guardrail (base.href-before-innerHTML ordering) does not actually detect a violation of that guardrail. Empirically verified below, not inferred.

---

## 1. Scope Adherence

git status --short (before any review activity):

```
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M src/main/index.ts
 M src/preload/api.ts
 M src/renderer/index.html
 M src/renderer/renderer.js
 M tests/integration/preload-api-contract.test.ts
?? .agents/current_scope.json
?? src/main/paths.ts
?? tests/e2e/fixtures/with-image/
?? tests/e2e/relative-images.spec.ts
?? tests/unit/baseUrlForFile.test.ts
```

Cross-checked against .agents/current_scope.json's 10-path in_scope list:

| Path | In scope contract? | Status |
|---|---|---|
| src/main/paths.ts | yes | new - matches |
| src/main/index.ts | yes | modified - matches |
| src/preload/api.ts | yes | modified - matches |
| src/renderer/index.html | yes | modified - matches |
| src/renderer/renderer.js | yes | modified - matches |
| tests/unit/baseUrlForFile.test.ts | yes | new - matches |
| tests/integration/preload-api-contract.test.ts | yes | modified - matches |
| tests/e2e/relative-images.spec.ts | yes | new - matches |
| tests/e2e/fixtures/with-image/doc.md | yes | new - matches |
| tests/e2e/fixtures/with-image/img/sample.png | yes | new - matches |

.agents/specs/functional_domain.md, .agents/specs/initial_scaffold.md, .agents/current_scope.json are the Lead's own pre-existing spec-authoring edits (governance files), not this task's implementation diff - correctly excluded from the scope contract and not attributable to the engineer.

Zero-diff files, explicitly confirmed (Blocking per the task brief if any diff existed):

```
$ git diff -- src/main/markdown.ts src/main/watcher.ts src/main/windowConfig.ts src/preload/index.ts
(no output - zero diff on all four)
```

Finding: Non-blocking / Pass. Scope is clean. No out-of-scope file touched.

---

## 2. Diff Review

Method: git add -A -N (intent-to-add, no content staged) -> git diff -> git reset to restore exactly. Verified git status --short identical before and after.

Full diffstat:

```
.agents/current_scope.json                     |  16 +++++
.agents/specs/functional_domain.md             |  22 +++++++
.agents/specs/initial_scaffold.md              |  87 ++++++++++++++++++++++++-
src/main/index.ts                              |   3 +-
src/main/paths.ts                              |   6 ++
src/preload/api.ts                             |   1 +
src/renderer/index.html                        |   1 +
src/renderer/renderer.js                       |   6 +-
tests/e2e/fixtures/with-image/doc.md           |   3 +
tests/e2e/fixtures/with-image/img/sample.png   | Bin 0 -> 68 bytes
tests/e2e/relative-images.spec.ts              |  50 ++++++++++++++
tests/integration/preload-api-contract.test.ts |  22 +++++++
tests/unit/baseUrlForFile.test.ts              |  30 +++++++++
13 files changed, 241 insertions(+), 6 deletions(-)
```

Implementation diff is minimal and surgical - matches the spec's stated small blast radius.

---

## 3. src/main/paths.ts - Exact Conformance

```ts
import { dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export function baseUrlForFile(filePath: string): string {
  return pathToFileURL(dirname(filePath) + sep).href;
}
```

This is a byte-for-byte match of initial_scaffold.md's authoritative signature. Trailing sep is present before pathToFileURL.

Import grep (zero fs/Electron imports confirmed):

```
$ grep -nE "electron|node:fs|require\('fs'\)|from 'fs'" src/main/paths.ts
(no matches)
```

tests/unit/baseUrlForFile.test.ts line 9 asserts expect(result.endsWith('/')).toBe(true) - the literal trailing-slash assertion the guardrail requires, not merely "looks like a file URL." A second test (line 15) separately asserts startsWith('file://'), and a third (lines 18-28) asserts the result contains the directory's path segments and excludes the filename doc.md.

Finding: Non-blocking / Pass.

---

## 4. src/main/index.ts / src/preload/api.ts - IPC Contract Extension

```diff
 async function renderFile(filePath: string): Promise<FileRenderedMessage> {
   ...
   try {
     const source = await fs.readFile(filePath, 'utf8');
-    return { ok: true, filePath, html: markdownToHtml(source) };
+    return { ok: true, filePath, html: markdownToHtml(source), baseUrl: baseUrlForFile(filePath) };
   } catch (error) {
     const message = error instanceof Error ? error.message : String(error);
     return { ok: false, filePath, error: message };
   }
```

ok:true branch gains baseUrl; the ok:false (catch) branch is byte-for-byte untouched - no baseUrl leaked into the error shape.

```diff
 export interface FileRenderedOk {
   ok: true;
   filePath: string;
   html: string;
+  baseUrl: string;
 }

 export interface FileRenderedError {
   (unchanged)
```

FileRenderedError has zero diff (confirmed by the full-diff output above - no hunk touches that interface).

src/preload/index.ts: confirmed zero diff (see section 1). This validates the spec's claim that the facade "forwards FileRenderedMessage generically and has no field-specific logic to update" - the claim holds under evidence, not just assertion.

Finding: Non-blocking / Pass.

---

## 5. src/renderer/index.html / renderer.js - Ordering Guardrail (Critical Section)

Diff:

```diff
--- a/src/renderer/index.html
+++ b/src/renderer/index.html
@@ -3,6 +3,7 @@
   <head>
     <meta charset="UTF-8" />
     <title>md-view</title>
+    <base id="content-base" href="" />
     <link rel="stylesheet" href="./github-markdown.css" />
   </head>
```

```diff
--- a/src/renderer/renderer.js
+++ b/src/renderer/renderer.js
@@ -1,4 +1,5 @@
 const container = document.getElementById('content');
+const baseElement = document.getElementById('content-base');
 ...
-function renderHtml(html) {
+function renderHtml(html, baseUrl) {
+  baseElement.href = baseUrl; // MUST be set before innerHTML
   container.innerHTML = html;
 }

 window.mdview.onFileRendered((message) => {
   if (message.ok) {
-    renderHtml(message.html);
+    renderHtml(message.html, message.baseUrl);
```

Read in full (not skimmed) - confirmed on disk:

```js
function renderHtml(html, baseUrl) {
  baseElement.href = baseUrl; // MUST be set before innerHTML - see renderer.js comments in spec
  container.innerHTML = html;
}
```

baseElement.href = baseUrl is statement 1; container.innerHTML = html is statement 2. Program order is correct, matching the spec's required ordering. This is a genuine, correctly-implemented fix at the source-code level.

Finding on source code: Non-blocking / Pass. (The regression this review then surfaces is in the test, not this code - see section 6.)

---

## 6. Test Quality (all 3 files read in full)

### tests/unit/baseUrlForFile.test.ts
Three tests: trailing-slash assertion (the load-bearing one, per section 3), file:// prefix, and containing-directory-not-filename assertion. Genuinely tests the trailing-slash guarantee, not just "returns a string." Pass.

### tests/integration/preload-api-contract.test.ts
Original Task 2 IPC_CHANNELS tests (non-empty string channel names; distinct channel names) are present, unmodified in substance. New FileRenderedOk/baseUrl block is additive, does not touch the pre-existing describe block. The test's own comment (lines 20-27) is honest about the tsc-vs-runtime limitation - it explicitly states the runtime assertion "cannot 'catch' a removed/renamed baseUrl field... the real protection... is tsc --strict," matching the spec's required honest caveat verbatim in spirit. Pass.

### tests/e2e/relative-images.spec.ts - the critical test, empirically checked

Structurally, the test:
- Launches the real built app against tests/e2e/fixtures/with-image/doc.md.
- Waits for #content to contain "Image Fixture."
- Locates the <img> element, asserts count 1.
- Evaluates in-page: if el.complete, asserts naturalWidth > 0; otherwise awaits a load/error event and resolves naturalWidth > 0 on load / false on error.
- Asserts the resolved value is true.

This assertion shape is correctly designed to distinguish "image tag exists" from "image actually loaded" - on paper it satisfies the letter of the guardrail.

However, I performed the specific empirical check the task brief called for (mentally tracing was insufficient - I physically swapped the two statements, rebuilt, and re-ran the test):

```js
// renderer.js, temporarily swapped for this review only, then reverted:
function renderHtml(html, baseUrl) {
  container.innerHTML = html;
  baseElement.href = baseUrl; // SWAPPED FOR TEST - broken order
}
```

Rebuilt (npm run build) and confirmed the swap propagated to dist/renderer/renderer.js. Ran npx playwright test tests/e2e/relative-images.spec.ts four times against the broken-order build:

```
Run 1:  ok 1 tests\e2e\relative-images.spec.ts:17:5 - resolves a Markdown-relative image path... (907ms)   1 passed (1.5s)
Run 2:  ok 1 tests\e2e\relative-images.spec.ts:17:5 - ... (1.1s)    1 passed (1.7s)
Run 3:  ok 1 tests\e2e\relative-images.spec.ts:17:5 - ... (892ms)   1 passed (1.5s)
Run 4:  ok 1 tests\e2e\relative-images.spec.ts:17:5 - ... (968ms)   1 passed (1.5s)
```

The test passes consistently even with the guardrail-breaking statement order. This is not flaky - 4/4 runs green on the broken build.

Root cause (for the record, not a fix - routed back per role): both statements execute synchronously within the same JS turn (no await/microtask boundary between them). The browser's actual network fetch for an <img> inserted via innerHTML is dispatched as a later task, not synchronously at the moment the attribute is parsed. By the time that fetch task runs, baseElement.href has already been updated to the correct value regardless of which of the two synchronous statements executed first, because both complete before the event loop yields to the image-fetch task. In other words: for this specific synchronous, same-turn implementation, statement order between baseElement.href = ... and container.innerHTML = ... is functionally inert in Chromium/Electron - the test cannot distinguish correct from incorrect order because no observable difference exists to test at this call-timing granularity.

I then restored renderer.js to its original (correct-order) content and reran the test to confirm the repository was returned to a clean, passing state, and re-ran git status --short to confirm it was byte-identical to the pre-experiment snapshot (see section 2 methodology and full raw output in Test Execution below).

Finding: BLOCKING. Per the review brief's explicit criterion: "If the test's assertions would ALSO pass with renderHtml's two lines swapped... that's a Blocking finding - the test wouldn't actually be testing anything." That condition is met, empirically, not speculatively. The e2e test is currently the only test covering functional-domain guardrail #3 (order-before-innerHTML), and it provides zero actual protection against a regression of that guardrail. A future refactor could silently swap the two lines (or refactor renderHtml in a way that reorders them) and the suite would stay fully green.

This is not a claim that the source code is wrong - section 5 confirms the source order is currently correct. It is a claim that the guardrail is unverified by any test in this delivery, contrary to what the engineer's self-check (per the Task 3 drift-flag learning) was explicitly instructed to confirm before declaring done.

### Fixture Integrity

```
$ ls -la tests/e2e/fixtures/with-image/img/sample.png
-rw-r--r-- 1 Administrator 197121 68 Aug  1 11:53 ... sample.png

$ xxd tests/e2e/fixtures/with-image/img/sample.png
00000000: 8950 4e47 0d0a 1a0a 0000 000d 4948 4452  .PNG........IHDR
00000010: 0000 0001 0000 0001 0804 0000 00b5 1c0c  ................
00000020: 0200 0000 0b49 4441 5478 da63 64f8 0f00  .....IDATx.cd...
00000030: 0105 0101 2718 e366 0000 0000 4945 4e44  ....'..f....IEND
00000040: ae42 6082                                .B`.
```

Genuine PNG: magic bytes 89 50 4E 47 0D 0A 1A 0A, IHDR chunk declaring 1x1 dimensions, IDAT, IEND - a real, valid, decodable 1x1 image, 68 bytes total (matches git diff --stat's "Bin 0 -> 68 bytes"). Not a text file with a .png extension. Finding: Non-blocking / Pass.

doc.md fixture:
```md
# Image Fixture

![Sample](./img/sample.png)
```
Correctly uses a ./-relative path per the guardrail's own example. Pass.

---

## 7. Test Execution (raw output, reproduced independently)

### Unit
```
$ npm run test:unit
 v tests/unit/preload-api.test.ts (2 tests) 3ms
 v tests/unit/baseUrlForFile.test.ts (3 tests) 4ms
 v tests/unit/watcher.test.ts (8 tests) 3ms
 v tests/unit/markdown.test.ts (2 tests) 12ms

 Test Files  4 passed (4)
      Tests  15 passed (15)
```
15 unit tests - matches the engineer's claimed count, independently verified.

### Integration
```
$ npm run test:integration
 v tests/integration/window-config.test.ts (2 tests) 3ms
 v tests/integration/preload-api-contract.test.ts (3 tests) 5ms
 v tests/integration/watcher.test.ts (2 tests) 143ms

 Test Files  3 passed (3)
      Tests  7 passed (7)
```
7 integration tests - matches claim, independently verified.

### E2E
```
$ npm run test:e2e
Running 8 tests using 4 workers
  ok 2 tests\e2e\app-launch.spec.ts:12:5 - app launches and opens a window (2.7s)
  ok 1 tests\e2e\live-reload.spec.ts:17:5 - live-reloads rendered content when the open file changes on disk (2.8s)
  ok 3 tests\e2e\relative-images.spec.ts:17:5 - resolves a Markdown-relative image path... (2.8s)
  ok 4 tests\e2e\open-file-argv.spec.ts:12:5 - opens a markdown file passed via argv and renders it (2.8s)
  ok 6 tests\e2e\open-file-argv.spec.ts:28:5 - shows a visible error state for a missing file... (2.6s)
  ok 5 tests\e2e\live-reload.spec.ts:42:5 - closes the previous file's watcher on switch... (3.0s)
  ok 7 tests\e2e\open-file-argv.spec.ts:47:5 - shows a visible error state for a non-.md file... (1.3s)
  ok 8 tests\e2e\live-reload.spec.ts:92:5 - shows a visible error state when the open file is deleted... (1.4s)

  8 passed (8.0s)
```
8 e2e tests - matches claim, independently verified. (This run was against the correct-order source, before the swap experiment in section 6.)

Post-experiment sanity check (after restoring renderer.js and rebuilding):
```
$ npx playwright test tests/e2e/relative-images.spec.ts
  ok 1 tests\e2e\relative-images.spec.ts:17:5 - ... (1.1s)
  1 passed (1.7s)

$ git diff --stat -- src/renderer/renderer.js
 src/renderer/renderer.js | 6 ++++--
 1 file changed, 4 insertions(+), 2 deletions(-)

$ git status --short
(identical to the pre-experiment snapshot in section 1 - confirmed byte-for-byte)
```
Repository state confirmed restored to the delivered, unmodified diff before concluding review.

---

## 8. Functional-Domain Guardrail Checklist (Task 4, functional_domain.md, "Task 4... Edge-Case Invariant Guardrails")

Guardrail 1 - "The trailing path separator before URL conversion is not optional... A test must assert the literal trailing / in the output, not just that the result 'looks like a file URL.'"
- Code: src/main/paths.ts line 5, pathToFileURL(dirname(filePath) + sep).href - sep present.
- Test: tests/unit/baseUrlForFile.test.ts line 9, expect(result.endsWith('/')).toBe(true).
- Status: MET. Literal trailing-slash assertion present and passing, independently re-run.

Guardrail 2 - "markdown.ts's purity is untouched by this task, verified, not just declared - zero diff expected on that file."
- Verified via git diff -- src/main/markdown.ts -> empty output (section 1).
- Status: MET.

Guardrail 3 - "The order of base.href assignment before innerHTML assignment in the renderer is a functional requirement, not a style choice, and must be proven by an e2e test that confirms an image actually loaded (complete && naturalWidth > 0)... Checking real load success is the only honest test of this guardrail."
- Code order: correct in the delivered source (section 5).
- Test: tests/e2e/relative-images.spec.ts does check complete/naturalWidth > 0 - the right shape of assertion.
- Status: NOT MET, empirically. The guardrail's own text anticipates exactly the failure mode this review found ("a wrong-order regression would still produce syntactically correct markup and pass any test that only checks structure") but the specific test delivered does not actually catch a wrong-order regression either, for a different reason than the spec anticipated (synchronous same-turn statement ordering has no observable effect on fetch timing in this environment, so the complete/naturalWidth check is satisfied regardless of order). The guardrail's stated intent is unmet by the current test, verified by direct experiment (section 6), not inference.

Overall: 2 of 3 guardrails proven by their tests under direct re-execution; guardrail 3 - the guardrail this task exists for - is not actually proven by any test in the delivery, despite the code itself being correct.

---

## Summary

Blocking (1):
- tests/e2e/relative-images.spec.ts does not detect the ordering regression it was written to guard against (functional-domain guardrail #3 for Task 4). Empirically confirmed: swapping baseElement.href = baseUrl and container.innerHTML = html in src/renderer/renderer.js and rebuilding produces a passing test result across 4 consecutive runs. The delivered source code itself is currently correct (section 5), but the guardrail is unverified - a future refactor could reintroduce the bug with no test failure to catch it. Route back to full-stack-engineer: the test needs an assertion mechanism that can actually distinguish the two orderings (e.g., intercepting the image network request via Playwright's page.route/request events and asserting the resolved request URL is under the fixture's directory rather than dist/renderer/, which is observable regardless of same-turn statement timing; or otherwise engineering a check that is sensitive to the actual base-URL-at-resolution-time rather than only the eventual load outcome, since same-turn statement reordering is provably unobservable via the naturalWidth end-state check in this delivery's implementation shape).

Should-fix (0).

Nit (0).

Drift-pattern check (explicitly requested by the Lead): This is a third consecutive occurrence of the same underlying pattern flagged after Task 3: a guardrail requires proof-by-test, and the delivered test does not actually prove it - this time despite an explicit engineer self-check instruction added specifically to prevent this ("Applying the Task 3 drift-flag learning," initial_scaffold.md lines 353-355). The self-check evidently confirmed a test existed and asserted the right-shaped thing (complete && naturalWidth > 0), but did not include the step this review performed - actually breaking the guardrail and confirming the test goes red. That specific verification step (mutate-and-confirm-red) is what would have caught this before delivery, and it did not happen. The self-check instruction improved test shape (correctly targeting naturalWidth, correctly avoiding a bare src-attribute check) but did not close the gap end-to-end.

---

# Re-Review: Guardrail #3 Moved to Unit-Level Call-Order Test

## Verdict: PASS

The blocking finding from the initial review is resolved. Guardrail #3 (base.href-before-innerHTML ordering) is now genuinely proven by a deterministic unit test, independently fault-injection-tested by this reviewer, not just re-read.

## Trigger

The Lead escalated the original Blocking finding to the user; the engineer independently reproduced the same blind spot with the reviewer's own suggested alternative (Playwright request-interception), confirming the failure mode is structurally unobservable at e2e/browser-timing granularity in this Electron/Chromium version, not merely a weakness of the naturalWidth check specifically. Decision: move guardrail #3's proof to a unit-level call-order test. Rationale recorded in .agents/specs/initial_scaffold.md, "Addendum: guardrail #3 needs a different test level entirely" (lines 357-396).

## 1. src/renderer/renderer.js diff, read in full

Diff summary (full text already shown in the coordinator instructions and verified byte-for-byte against the file on disk): the old top-level container/renderError/renderHtml code is replaced by a new unconditional applyRenderedContent(html, baseUrl, setBaseHref, setInnerHtml) function containing exactly "setBaseHref(baseUrl); setInnerHtml(html);" in that order, followed by a "typeof document !== 'undefined'" guard wrapping the DOM-dependent code (container/baseElement lookups, renderError, a renderHtml closure that delegates to applyRenderedContent, the onFileRendered subscription, and the open-file button listener), followed by a separate unconditional "typeof module !== 'undefined'" guard exporting only applyRenderedContent.

Confirmed by direct read of the file on disk (not just the diff):

- applyRenderedContent (lines 1-4) is defined before and outside the typeof document guard - it is unconditional top-level code, callable under plain Node with zero DOM. This is exactly the point of the extraction and it is correctly structured.
- The typeof document !== 'undefined' guard (lines 11-50) wraps container, baseElement, renderError, renderHtml (the closure-based delegator), the onFileRendered subscription, and the open-button listener - i.e., exactly the code that legitimately needs real DOM/window globals to exist. Nothing that should be guard-free (i.e. applyRenderedContent itself) got pulled inside it, and nothing that needs DOM got left outside it.
- The typeof module !== 'undefined' guard (lines 55-57) is separate, at the bottom, unconditional at top level, and only gates the module.exports assignment - it does not wrap or affect any DOM-facing code.
- (a) Guard genuinely doesn't change browser behavior: in the browser, document is a real global, so the guarded block executes unconditionally exactly as before the refactor - the internal logic (container/baseElement lookups, renderError, renderHtml's delegation to applyRenderedContent via closures over the real DOM elements, the onFileRendered subscription, the button listener) is unchanged in substance, just restructured to call through applyRenderedContent. In the browser, module is not a global; typeof module safely evaluates to 'undefined' (using typeof on a possibly-undeclared identifier does not throw - this is the standard, correct technique), so the exports line is skipped with no error. I additionally verified this empirically: the full e2e suite (see below) passed after rebuild, including relative-images.spec.ts, which depends on the guarded block executing normally in real Chromium.
- (b) applyRenderedContent is NOT inside the document guard - confirmed, it is lines 1-4, fully outside and above the if block starting at line 11.

Finding: Non-blocking / Pass. The guard placement is correct and the deviation from the addendum's illustrative snippet (which didn't show a document guard) is a legitimate, necessary technical adjustment: the addendum's snippet was illustrative of the extraction shape, not a literal diff; requiring the file under plain Node without any guard would throw a ReferenceError on document.getElementById(...) the moment the module body executes, before Vitest could ever reach the exports - the guard is required for the addendum's own stated goal ("keep renderer.js plain JS... make the ordering unit-testable via a minimal UMD-style export") to actually work.

## 2. tests/unit/renderer-order.test.ts, read in full

The file imports applyRenderedContent via require('../../src/renderer/renderer.js'). First test: builds a calls array, passes spy functions setBaseHref = () => calls.push('base') and setInnerHtml = () => calls.push('html'), invokes applyRenderedContent('<h1>hi</h1>', 'file:///some/dir/', setBaseHref, setInnerHtml), and asserts expect(calls).toEqual(['base', 'html']) - an ordered-array equality check, not merely "both were called." Second test: asserts the html and baseUrl arguments are passed through unchanged to the respective setter functions (receivedBaseUrl === 'file:///a/b/', receivedHtml === '<p>content</p>') - a distinct concern from ordering, correctly a separate it block.

Confirmed: applyRenderedContent is invoked with plain spy functions, no real DOM element, no jsdom environment configured (vitest.config.ts's environment: 'node' is unchanged - confirmed zero diff, see section 6), no timers, no await. Finding: Non-blocking / Pass.

## 3. Fault Injection - reproduced independently, not taken on the engineer's word

Ran npx vitest run tests/unit/renderer-order.test.ts against the delivered code first - both tests green (2 tests passed, Test Files 1 passed).

Then physically swapped the two statements inside applyRenderedContent (backed up the file first) to:
setInnerHtml(html); followed by setBaseHref(baseUrl); (reversed order).

Reran the exact same test file - went RED with a clear, specific failure:

"calls setBaseHref before setInnerHtml" FAILED with: expected [ 'html', 'base' ] to deeply equal [ 'base', 'html' ]. 1 failed, 1 passed (2 total).

Restored the original file from backup, confirmed the source matched the delivered state exactly (setBaseHref(baseUrl); setInnerHtml(html); in that order), and reran the test file once more - back to GREEN: 2 tests passed, Test Files 1 passed.

This is the decisive result. Unlike the original e2e test (which stayed green 4/4 times under the identical fault), this unit test goes red immediately and unambiguously on the exact regression it exists to catch, and returns to green once the fault is reverted. Finding: guardrail #3 is now genuinely closed - verified by direct fault injection, not by re-reading the engineer's claim.

## 4. tests/e2e/relative-images.spec.ts - confirm otherwise unchanged

Diffed independently (via git add -A -N / git diff / git reset, same non-destructive method as the original review). The only change versus what I already reviewed is an added comment block ("KNOWN LIMITATION...") documenting the empirically-confirmed blind spot and pointing to this guardrail's disposition. The actual test body - launch, #content text wait, <img> count assertion, the complete/naturalWidth/load/error evaluate block, and the final expect(loaded).toBe(true) - is byte-for-byte identical to the version I already reviewed and ran. This is correctly scoped documentation, not a regression, and not a silent behavior change. Finding: Non-blocking / Pass - scope clarification confirmed, not a functional change.

## 5. Full suite re-run, independently

### Unit (5 files / 17 tests expected)

npm run test:unit output: renderer-order.test.ts (2 tests), preload-api.test.ts (2 tests), baseUrlForFile.test.ts (3 tests), watcher.test.ts (8 tests), markdown.test.ts (2 tests). Test Files 5 passed (5). Tests 17 passed (17). Matches expected 5 files / 17 tests exactly, independently confirmed (2+2+3+8+2 = 17).

### Integration (3 files / 7 tests expected)

npm run test:integration output: preload-api-contract.test.ts (3 tests), window-config.test.ts (2 tests), watcher.test.ts (2 tests). Test Files 3 passed (3). Tests 7 passed (7). Matches expected 3 files / 7 tests exactly (unchanged from the original review - this task added no new integration tests).

### E2E (4 files / 8 tests expected)

npm run test:e2e output: all 8 tests passed across open-file-argv.spec.ts (3 tests), app-launch.spec.ts (1 test), live-reload.spec.ts (3 tests), relative-images.spec.ts (1 test). 8 passed (7.5s). 4 spec files (app-launch.spec.ts, live-reload.spec.ts, relative-images.spec.ts, open-file-argv.spec.ts) / 8 tests - matches expected exactly.

## 6. Scope Check

.agents/current_scope.json now lists 11 paths (added tests/unit/renderer-order.test.ts), matching the addendum's stated scope amendment. Confirmed the amendment itself was Lead-authored (governance file, out of the engineer's diff by design).

git diff on src/main/index.ts, src/preload/api.ts, src/renderer/index.html, tests/integration/preload-api-contract.test.ts is byte-identical to the diff already reviewed in the original pass (confirmed via md5sum match and full re-read).

git diff on src/main/markdown.ts, src/main/watcher.ts, src/main/windowConfig.ts, src/preload/index.ts, vitest.config.ts produces no output - zero diff on all five, including vitest.config.ts, confirmed explicitly out of scope and untouched.

Only src/renderer/renderer.js (further modified, reviewed in section 1) and tests/unit/renderer-order.test.ts (new, reviewed in section 2) changed since the last review pass. Everything else in the 11-path scope is identical to what was already verified. Finding: Non-blocking / Pass.

## Summary (Re-Review)

Blocking: none. The original Blocking finding (guardrail #3 unproven by any test) is resolved. The new tests/unit/renderer-order.test.ts is a deterministic, DOM-free unit test that this reviewer independently fault-injected (broke the guardrail, confirmed RED; restored it, confirmed GREEN) - the same rigor applied to the original e2e test that exposed the gap in the first place. The typeof document/typeof module guard pattern in renderer.js was read in full and confirmed correctly scoped: applyRenderedContent is unconditionally exported and DOM-free, the guard only wraps genuinely DOM-dependent code, and browser behavior is unchanged (confirmed both by code inspection and by the full e2e suite passing post-rebuild). tests/e2e/relative-images.spec.ts is confirmed otherwise unchanged (comment-only diff) and correctly reframed as end-to-end mechanism coverage, not ordering proof. Full suite independently re-verified: 5 unit files / 17 tests, 3 integration files / 7 tests, 4 e2e files / 8 tests - all green, all counts matching expectations exactly. Scope is clean: only the two expected files changed since the last pass; vitest.config.ts and all previously-reviewed files are byte-identical to what was already verified.

Should-fix (0). Nit (0).

Drift-pattern check: This resolution breaks the three-task drift pattern. The gap was caught before delivery this time (by this review's fault-injection methodology) rather than shipping unverified, and the follow-up fix was itself independently fault-injection-verified rather than taken on trust - closing the loop the way the Task 3 drift-flag learning originally intended.

Architectural note on the typeof document/typeof module guard pattern (requested, non-blocking): This is a new pattern in the codebase - a nominally "plain browser script, no build step" file becoming conditionally dual-environment (browser vs. plain-Node-under-Vitest). As implemented here, it is clean and well-bounded: it exposes exactly one pure, already-designed extraction (applyRenderedContent) with zero side effects and zero DOM coupling, the guard correctly fences off everything that isn't safe to run outside a DOM, and it doesn't change what ships to the browser (the script src="./renderer.js" tag still loads the identical file, unbundled, unchanged in browser-observable behavior). The risk worth flagging for future tasks is scope creep, not this instance: if this technique is reached for casually every time a future feature wants "a unit test without jsdom," renderer.js could gradually accumulate multiple guarded sections and multiple exported helpers, eroding the original Task 1/2 invariant that the renderer is a simple, single-purpose, build-step-free script. The discipline worth preserving going forward - and worth stating explicitly in a future spec if this pattern is reused - is: only pure, DOM-free logic gets extracted and exported this way, and each extraction should correspond to an actual proof obligation (like this one, born directly from an empirically-demonstrated e2e blind spot) rather than being applied preemptively "for testability" in general. One instance, clearly justified by a concrete, evidenced gap, is not a slippery slope. It would become one without that discipline attached.

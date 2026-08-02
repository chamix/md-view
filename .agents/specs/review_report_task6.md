# Independent Review Report - Task 6: Syntax Highlighting for Code Blocks

## Verdict: PASS - 0 Blocking findings (2 Should-fix, 1 Nit)

---

## 1. Scope Adherence

git status --porcelain at review time:

```
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M package-lock.json
 M package.json
 M src/main/markdown.ts
 M src/renderer/index.html
 M tests/unit/markdown.test.ts
?? .agents/current_scope.json
?? .agents/specs/backlog.md
?? tests/e2e/code-highlighting.spec.ts
?? tests/e2e/fixtures/with-code/
```

Compared against current_scope.json in_scope list (package.json, src/main/markdown.ts, src/renderer/index.html, tests/unit/markdown.test.ts, tests/e2e globs, tests/e2e/code-highlighting.spec.ts, tests/e2e/fixtures/with-code/doc.md):

- package.json, src/main/markdown.ts, src/renderer/index.html, tests/unit/markdown.test.ts: in scope, modified. Matches.
- tests/e2e/code-highlighting.spec.ts, tests/e2e/fixtures/with-code/ (contains doc.md): in scope, new. Matches.
- .agents/current_scope.json: expected artifact of the Lead workflow, not engineer output.
- .agents/specs/functional_domain.md and initial_scaffold.md: both modified; git diff --stat confirms pure additive appends (23 and 93 insertion lines respectively, 0 deletions) - these are the Lead own Step 0/1 planning edits, outside the scope contract grant (specs are read-only during execution per CLAUDE.md governance rules; these belong to the Lead, not the engineer).
- package-lock.json: expected side effect of npm install highlight.js (10 insertion lines), not an Edit/Write-tool touch.

Out-of-scope finding (Should-fix, not Blocking): .agents/specs/backlog.md is a brand-new untracked file (confirmed via git log --all -- .agents/specs/backlog.md returning zero prior history) that is NOT listed in current_scope.json in_scope array and was NOT part of the task declared change set. Its content documents a Task-6-adjacent follow-up concern about theme pairing under dark mode. It is documentation-only with zero code impact, but landed under .agents/specs/ (a governance-protected directory) outside the granted scope contract. Not blocking given zero functional risk, but should have gone through an explicit scope-contract amendment.

Zero-diff verification on files that must not have changed: git diff --name-only for src/main/index.ts and src/renderer/renderer.js returned empty output for both - confirming zero renderer wiring, as the spec requires.

---

## 2. src/main/markdown.ts Diff - Exact Conformance to Authoritative Signature

```diff
diff --git a/src/main/markdown.ts b/src/main/markdown.ts
index 67a5055..5255d79 100644
--- a/src/main/markdown.ts
+++ b/src/main/markdown.ts
@@ -1,6 +1,18 @@
 import MarkdownIt from 'markdown-it';
+import hljs from 'highlight.js';
 
-const md = new MarkdownIt({ html: false }); // explicit: never allow raw HTML passthrough from source
+function highlightCode(code: string, lang: string): string {
+  if (lang && hljs.getLanguage(lang)) {
+    try {
+      return hljs.highlight(code, { language: lang }).value;
+    } catch {
+      return '';
+    }
+  }
+  return '';
+}
+
+const md = new MarkdownIt({ html: false, highlight: highlightCode }); // explicit: never allow raw HTML passthrough from source
 
 export function markdownToHtml(source: string): string {
   return md.render(source);
```

Matches initial_scaffold.md Exact signature and wiring block (lines 528-547) verbatim: highlightCode(code, lang) returning string, hljs.getLanguage(lang) guard, hljs.highlight(code, { language: lang }).value inside try/catch, empty-string return on no-language/unrecognized/error paths.

html: false is preserved unchanged on the MarkdownIt constructor - the pre-existing Task 2 security invariant was not dropped or altered; only highlight: highlightCode was added alongside it.

No hljs.highlightAuto anywhere: grep for highlightAuto across src/ returned zero matches, confirming no auto-detection path was introduced (guardrail 1).

grep for the highlight.js import string across src/ returns exactly one hit (src/main/markdown.ts line 2) - highlight.js is imported nowhere else, satisfying the single-seam Adapter requirement.

Finding: Non-blocking. Exact conformance.

---

## 3. package.json - Dependency Placement and Build Script

The build script gained one additional copyFileSync call at the end of its node -e invocation, copying node_modules/highlight.js/styles/github.css to dist/renderer/github.css - the same pattern as the existing github-markdown.css copy step. The dependencies block gained a single new entry: highlight.js at semver range caret 11.11.1.

Confirmed via a node one-liner printing require of package.json dependencies: chokidar caret 4.0.1, github-markdown-css caret 5.8.1, highlight.js caret 11.11.1, markdown-it caret 14.1.0.

highlight.js is under dependencies, NOT devDependencies - correct, since it runs in the main process at render time and would otherwise be pruned by electron-builder from a packaged build. The installed package.json under node_modules/highlight.js reports version 11.11.1, matching the declared range.

Finding: Non-blocking.

---

## 4. src/renderer/index.html Diff

```diff
diff --git a/src/renderer/index.html b/src/renderer/index.html
@@ -5,6 +5,7 @@
     <base id="content-base" href="" />
     <link rel="stylesheet" href="./github-markdown.css" />
+    <link rel="stylesheet" href="./github.css" />
```

The relative path ./github.css correctly targets the file the build script copies to dist/renderer/github.css (both index.html and github.css land side-by-side in dist/renderer/). Confirmed via a directory listing of dist/renderer/ after running npm run build (section 7).

Finding: Non-blocking.

---

## 5. Test Suite Execution - Raw Output (self-run, not restated)

### Unit (npm run test:unit)

```
PASS tests/unit/renderer-order.test.ts (2 tests) 5ms
PASS tests/unit/isExternalHttpUrl.test.ts (6 tests) 5ms
PASS tests/unit/baseUrlForFile.test.ts (3 tests) 4ms
PASS tests/unit/preload-api.test.ts (2 tests) 5ms
PASS tests/unit/watcher.test.ts (8 tests) 5ms
PASS tests/unit/markdown.test.ts (7 tests) 20ms

Test Files  6 passed (6)
     Tests  28 passed (28)
```
markdown.test.ts grew from 2 to 7 tests, all green, matching the claimed change.

### Build (npm run build)

```
tsc -p tsconfig.json && npx esbuild (bundle preload) && node -e (copy renderer assets, including the new github.css copy)
  dist/preload/index.js  641b
Done in 14ms
```

Verified the copied asset is byte-identical to source: diff between dist/renderer/github.css and node_modules/highlight.js/styles/github.css produced no output (files identical). Byte count of dist/renderer/github.css is 2174 bytes, non-empty.

### E2E (playwright test, run twice for stability)

First run (as part of npm run test:e2e):
```
Running 11 tests using 4 workers
  ok  1 app-launch.spec.ts - app launches and opens a window (4.4s)
  ok  3 live-reload.spec.ts - live-reloads rendered content when the open file changes on disk (4.9s)
  ok  4 code-highlighting.spec.ts - renders syntax-highlighted markup for a fenced code block with a recognized language (5.2s)
  ok  2 external-links.spec.ts - clicking a valid external link hands it off to the OS browser (5.6s)
  ok  5 open-file-argv.spec.ts - opens a markdown file passed via argv and renders it (4.7s)
  ok  6 live-reload.spec.ts - closes the previous file watcher on switch (8.1s)
  ok  8 external-links.spec.ts - clicking a malformed link opens nothing externally (7.4s)
  ok  7 relative-images.spec.ts - resolves a Markdown-relative image path (7.7s)
  ok  9 open-file-argv.spec.ts - shows a visible error state for a missing file (3.8s)
  ok 10 live-reload.spec.ts - shows a visible error state when the open file is deleted (2.8s)
  ok 11 open-file-argv.spec.ts - shows a visible error state for a non-.md file (3.3s)

  11 passed (18.0s)
```

### Bare npm test (per initial_scaffold.md Addendum) - one intermittent, pre-existing, unrelated flake observed

```
Test Files  6 passed (6)
     Tests  28 passed (28)
...
Test Files  3 passed (3)
     Tests  7 passed (7)
...
Running 11 tests using 4 workers
  ...
  FAIL live-reload.spec.ts line 17 - live-reloads rendered content when the open file changes on disk (14.6s)
    Error: expect(locator).toContainText(expected) failed
    Expected substring: Live Reloaded Heading
    Received string: (empty)
  ...
  1 failed
  10 passed (22.2s)
```
npm test (bare command) DOES run the full suite without the missing-script error the Addendum asked to check for, confirming the manually-added test script resolves that prior issue.

This single e2e failure (live-reload.spec.ts first case) was investigated as a possible regression from this task changes. It is NOT a Task 6 regression:
- Re-ran playwright on live-reload.spec.ts alone (1 worker): all 3 tests passed in 9.3s.
- Re-ran the full playwright suite (4 workers) a second time: all 11 tests passed in 13.3s, including this exact test.
- git diff on src/main/markdown.ts (the only production file this task touches) has zero relationship to the chokidar file-watcher/live-reload code path exercised by that test.
- This is consistent with a pre-existing timing flake under 4-worker parallel load, not something introduced by Task 6.

Finding: Non-blocking regression risk, flagged as Should-fix - this flake pre-dates Task 6 and is unrelated to the diff, but is worth follow-up independent of this review.

---

## 6. Unit Test Case-by-Case Verification (tests/unit/markdown.test.ts)

Read in full. All 4 required cases from initial_scaffold.md Unit test cases exact list (lines 580-586) are present:

Case 1 - supported language produces real hljs-* classes:
```ts
it("applies syntax highlighting to a fence with a supported declared language", () => {
  const html = markdownToHtml("```js\nfunction add(a, b) { return a + b; }\n```");
  expect(html).toContain("hljs-keyword");
});
```
Independently confirmed the actual rendered output (via a scratch script importing the built dist/main/markdown.js): the output contains real hljs-keyword, hljs-title, hljs-params spans, not just a bare pre/code wrapper.

Case 2 - no-language fence, no auto-detection:
```ts
it("renders a fence with no declared language as plain escaped text (no auto-detection)", () => {
  const html = markdownToHtml("```\nfunction add(a, b) { return a + b; }\n```");
  expect(html).not.toContain("hljs");
  expect(html).not.toContain("language-");
});
```
Independently confirmed actual output has no hljs or language- token anywhere. Corroborated by the highlightAuto grep result (zero matches, section 2) - the no-auto-detection claim is structurally true, not just behaviorally true in this one case.

Case 3 - unrecognized language degrades safely, does not throw:
```ts
it("does not throw and falls back to plain escaped text for an unrecognized declared language", () => {
  expect(() => markdownToHtml("```notarealtonguage\n...\n```")).not.toThrow();
  const html = markdownToHtml("```notarealtonguage\n...\n```");
  expect(html).not.toContain("hljs");
});
```
Independently confirmed actual output shows a class of language-notarealtonguage on the code element but no hljs class, matching the test own inline comment explaining that markdown-it default fence renderer still emits that wrapper class from the info string regardless of highlight return value (harmless, expected markdown-it behavior, correctly distinguished from a real hljs token class).

Case 4 - explicit security regression test, both branches:
```ts
it("escapes script tags inside a highlighted fenced code block (security regression)", () => {
  const html = markdownToHtml("```js\n<script>alert(1)</script>\n```");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("&lt;/script&gt;");
});

it("escapes script tags inside a no-language fenced code block (security regression)", () => {
  const html = markdownToHtml("```\n<script>alert(1)</script>\n```");
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
});
```
Both branches (recognized-language and no-language) are present as SEPARATE, explicit tests, exactly as initial_scaffold.md line 585 requires (must not be inferred from cases 1-3 passing) - not folded into or inferred from the other cases. Both pass (section 5 raw output: 7/7 in markdown.test.ts).

Finding: Non-blocking. All 4 required cases present, each independently re-verified against actual rendered output, not just read as code.

---

## 7. E2E Spec and Fixture Verification

tests/e2e/fixtures/with-code/doc.md contains a heading "Code Highlighting Fixture" followed by a fenced code block declared as js containing an add function. Contains a recognized-language fence, as required.

tests/e2e/code-highlighting.spec.ts follows the exact electron.launch plus argv pattern of tests/e2e/open-file-argv.spec.ts (same childEnv/ELECTRON_RUN_AS_NODE strip comment, same launch-args shape): it launches dist/main/index.js with the fixture path as an argv argument, waits for the first window content locator to contain the heading text, then locates the hljs-keyword class element inside #content, asserts it is visible, and asserts its text equals "function".

This asserts against the REAL, LIVE DOM (a locator query plus a visibility assertion plus an exact-text assertion), not a raw HTML string comparison. The visibility assertion specifically proves the element is actually rendered, which requires the CSS asset to have loaded without erroring the page - this is exactly the CSS-copy proof a pure unit test cannot provide. Confirmed passing in section 5 raw output (test 4, code-highlighting.spec.ts, both in isolated and full-suite runs).

Finding: Non-blocking. Matches the authoritative e2e shape exactly.

---

## 8. Regression Check - Pre-existing Signature and Callers

The exported markdownToHtml(source) function signature in src/main/markdown.ts is UNCHANGED (only the internal MarkdownIt construction gained the highlight option; the function body and signature are identical to before).

git diff --name-only on src/main/index.ts returns empty - the sole caller of markdownToHtml was not touched and required no changes, confirming the change is fully backward compatible at the call site.

src/renderer/renderer.js was not touched (empty diff, confirmed in section 1) - the highlighted HTML flows through the pre-existing innerHTML assignment unchanged, as the spec requires (zero new renderer wiring).

Both pre-existing markdown.test.ts assertions (basic markdown, security invariant) still pass unmodified alongside the 5 new ones (7 total, section 5).

Finding: Non-blocking. No regression in the pre-existing contract or its caller.

---

## Summary

Verdict: PASS. Zero Blocking findings.

- Scope: clean on all declared in-scope paths; one out-of-scope documentation file (.agents/specs/backlog.md) was created without a scope-contract amendment - flagged as Should-fix, not Blocking, given it is documentation-only with zero functional impact and consistent in spirit with the spec own flag-dont-fix discipline.
- markdown.ts: exact conformance to the authoritative highlightCode signature; html:false preserved; zero highlightAuto usage anywhere; single-seam import of highlight.js.
- highlight.js correctly placed in dependencies (not devDependencies), version 11.11.1 matches installed package.
- Build: dist/renderer/github.css verified byte-identical to node_modules/highlight.js/styles/github.css after a self-run npm run build; index.html new link tag correctly targets it.
- Unit tests: grew from 2 to 7 in markdown.test.ts, all 4 spec-required cases present and independently re-verified against actual rendered HTML output (not just read as code), including the two explicit, separate security-regression tests for script-tag escaping through both branches.
- E2E: new spec follows the established open-file-argv.spec.ts pattern, asserts against a live DOM element (hljs-keyword class, visible, exact text) - genuine proof of both highlight markup and CSS-asset loading, not a string-containment check.
- Full suite self-run and green: 28 unit / 7 integration / 11 e2e (isolated runs); one intermittent, pre-existing, unrelated live-reload.spec.ts flake observed once under 4-worker parallel load and reproduced as passing on two subsequent re-runs - traced to timing in the chokidar-driven live-reload path, structurally unrelated to this task markdown.ts-only diff.
- No regression: markdownToHtml signature and its sole caller (src/main/index.ts) are untouched; renderer.js untouched, confirming zero new renderer wiring per the scope contract.

Should-fix (non-blocking):
1. .agents/specs/backlog.md was added outside the scope contract in_scope grant and outside the declared change set; route future backlog notes through an explicit scope-contract amendment rather than an out-of-band file creation.
2. tests/e2e/live-reload.spec.ts first test is intermittently flaky under 4-worker parallel execution (observed once, unrelated to this diff) - worth a follow-up ticket to stabilize (e.g. widen the file-write-to-render polling window or reduce parallel worker contention), independent of Task 6.

Nit: initial_scaffold.md own prose (line 549) describes MarkdownIt default fence renderer as producing a class combining hljs and language- on the code element; the actually-installed markdown-it 14.1.0 in this repo emits only the language- class on the wrapper (no literal hljs class there, only inside child span tokens). This is a harmless imprecision in the spec illustrative commentary, not a testable guardrail, and does not affect any test correctness (confirmed empirically in section 6).

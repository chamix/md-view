# Independent Code Review — Task 10: HTML Comments Rendering as Visible Text (bug fix)

Verdict: **BLOCKED**
Blocking findings: 1
Should-fix findings: 1
Nits: 1

Reviewed by: code-reviewer (independent verification layer, read-only tools).
Spec source of truth: `.agents/specs/functional_domain.md` §"Task 10: HTML Comments Rendering as Visible Text (bug fix)"; `.agents/specs/initial_scaffold.md` §"Task 10 Technical Specification — HTML Comment Stripping Fix"; `.agents/current_scope.json` (still open at review time).

---

## Evidence trail

### 1. Touched-file list vs. scope contract

Scope contract's `in_scope`: `src/main/markdown.ts`, `tests/unit/markdown.test.ts`, `tests/e2e/fixtures/with-html-comment/doc.md`, `tests/e2e/html-comments.spec.ts`.

`git status --short`:
```
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M src/main/markdown.ts
 M tests/unit/markdown.test.ts
?? .agents/current_scope.json
?? tests/e2e/fixtures/with-html-comment/
?? tests/e2e/html-comments.spec.ts
```
The two spec-file modifications are the Lead's own pre-delegation planning edits (additive "Task 10" sections in both files, confirmed by reading the diffs — see below). Every file the implementer actually touched is on the granted list; nothing outside it. Boundary contract: **compliant**.

### 2. `src/main/markdown.ts` — diff hunk

```diff
 const md = new MarkdownIt({ html: false, highlight: highlightCode }); // explicit: never allow raw HTML passthrough from source

+// Known scope boundary: a comment whose <!-- / --> delimiters are split across a Markdown soft line break lands in separate `text` tokens and is NOT caught by this per-token regex.
+md.renderer.rules.text = (tokens, idx) => {
+  return md.utils.escapeHtml(tokens[idx].content.replace(/<!--[\s\S]*?-->/g, ''));
+};
+
 export function markdownToHtml(source: string): string {
```
- `html: false` constructor option: byte-identical, unchanged. Confirmed.
- `highlight: highlightCode` fence path: byte-identical, unchanged; `highlightCode` function body untouched. Confirmed the new rule is wired only to `renderer.rules.text`, never to `renderer.rules.fence` — checked `node_modules/markdown-it/lib/renderer.mjs`, fence rendering stays on `default_rules.fence` (uses `options.highlight`), unaffected by a `rules.text` override.
- Guardrail #5 (soft-break-split comments, known limitation): documented as exactly **one** comment line at the override site, correctly worded, does not attempt to fix the case. Compliant, not scope creep.
- `md.utils.escapeHtml` verified functionally equivalent to markdown-it's own default text rule (`node_modules/markdown-it/lib/renderer.mjs:98-99`: `default_rules.text = (tokens, idx) => escapeHtml(tokens[idx].content)`) — the implementation duplicates rather than delegates to `self.renderToken`, which the spec's Decision section explicitly permitted ("`self.renderToken(...)`, **or equivalent escaping**"). Not a spec violation (see Should-fix S-1 below for the maintainability angle).

### 3. `tests/unit/markdown.test.ts` — diff and coverage check

```diff
+  it('strips a bare HTML comment alone in its own paragraph (no visible or escaped remnant)', () => {
+    const html = markdownToHtml('<!-- just a comment -->');
+    expect(html).not.toContain('just a comment');
+  });
+
+  it('strips a standalone HTML comment paragraph in the middle of a document, leaving surrounding text intact', () => {
+    const html = markdownToHtml('# Heading\n\nBefore text.\n\n<!-- a comment -->\n\nAfter text.');
+    expect(html).not.toContain('a comment');
+    expect(html).toContain('Before text.');
+    expect(html).toContain('After text.');
+  });
+
+  it('leaves an HTML comment inside a fenced code block untouched as literal escaped text (regression guard)', () => {
+    const html = markdownToHtml('```html\n<!-- inside fence -->\n<div>x</div>\n```');
+    expect(html).toContain('&lt;!--');
+    expect(html).toContain('<pre>');
+    expect(html).toContain('<code');
+  });
```
Lines 1-49 of the file (including the existing `<script>` security test at line 10-14) are byte-identical in the diff — confirmed the existing raw-HTML security tests are unmodified. The 4 required cases from `initial_scaffold.md`'s "Required test changes" section are all present: bare comment (guardrail #1), mid-doc comment with siblings (guardrail #2), fenced comment regression guard (guardrail #4), pre-existing security tests unmodified (guardrail #3).

**However**, none of these assertions check DOM/HTML structure — only substring presence/absence of the comment *text*. This blind spot is the root enabler of the Blocking finding below.

### 4. Full test suite — run directly by the reviewer

`npx vitest run tests/unit`:
```
 Test Files  10 passed (10)
      Tests  58 passed (58)
```
(includes `tests/unit/markdown.test.ts (10 tests)` — 7 pre-existing + 3 new, all green)

`npx vitest run tests/integration`:
```
 Test Files  3 passed (3)
      Tests  7 passed (7)
```

`npm run build`: exit 0, no errors.

`npx playwright test` (full suite, 20 specs):
```
Running 20 tests using 4 workers
  ... (all 20 listed as "ok")
  20 passed (24.8s)
```
Includes `html-comments.spec.ts` (new, passing) and `code-highlighting.spec.ts` (regression check, passing) plus all pre-existing specs (`app-launch`, `external-links` ×2, `live-reload` ×3, `open-file-argv` ×3, `relative-images`, `ui-shell` ×3, `view-menu` ×5). Zero regressions observed anywhere in the suite.

### 5. Fault-injection proof — performed independently by the reviewer

Backed up `src/main/markdown.ts`, then neutered the stripping regex (`tokens[idx].content.replace(/<!--[\s\S]*?-->/g, '')` → `tokens[idx].content`), leaving the escaping call and everything else intact.

`npx vitest run tests/unit/markdown.test.ts` with the fix disabled:
```
 ❯ strips a bare HTML comment alone in its own paragraph …
   → expected '<p>&lt;!-- just a comment --&gt;</p>\n' not to contain 'just a comment'
 ❯ strips a standalone HTML comment paragraph in the middle of a document …
   → expected '<h1>Heading</h1>\n<p>Before text.</p>…' not to contain 'a comment'
 Test Files  1 failed (1)
      Tests  2 failed | 8 passed (10)
```
Failure signature matches the described bug exactly — the escaped comment text reappears verbatim in the output. Restored `src/main/markdown.ts` from the backup, confirmed `git diff --stat src/main/markdown.ts` matched the pre-injection diff exactly (5 insertions, 1 file), reran:
```
 Test Files  1 passed (1)
      Tests  10 passed (10)
```
Rebuilt (`npm run build`, exit 0) to resync `dist/` before the full e2e regression run in section 4. RED→GREEN cycle confirmed by the reviewer directly.

### 6. `tests/e2e/fixtures/with-html-comment/doc.md` and `tests/e2e/html-comments.spec.ts`

Fixture contains: a standalone comment before the heading, a heading + anchor paragraph, a second standalone comment mid-document, a comment inside a ` ```html ` fence, and a raw non-comment `<div>` outside any fence. This satisfies the spec's literal file-tree annotation ("standalone comments, fenced comment, raw non-comment tag"); it does not include a *third* standalone comment specifically trailing *after* all real content, which the task brief's paraphrase ("before/mid/after") implied — see Nit N-1.

`html-comments.spec.ts` follows `code-highlighting.spec.ts`'s launch/`childEnv` boilerplate line-for-line (same `ELECTRON_RUN_AS_NODE` stripping comment, same `electron.launch` args shape, same `#content` locator + `toContainText` pattern). Assertions match what the spec requires: heading present, both standalone comments absent from `#content` text, fenced comment text present, non-comment raw tag text present. Confirmed passing in section 4's full-suite run and in isolation (`npx playwright test tests/e2e/html-comments.spec.ts tests/e2e/code-highlighting.spec.ts` → `2 passed`).

### 7. Independent functional-correctness check beyond the written tests (the actual finding)

The task brief for this review specifically asked me to verify the fix "doesn't corrupt normal text rendering" by running things myself rather than trusting the tests as written. I probed `markdownToHtml`'s literal output for the exact two guardrail-#1/#2 unit-test inputs:

```js
CASE1 (bare comment):      '<p></p>\n'
CASE2 (mid-doc comment):   '<h1>Heading</h1>\n<p>Before text.</p>\n<p></p>\n<p>After text.</p>\n'
```

`functional_domain.md` guardrail #1 states: *"A standalone HTML comment, alone in its own paragraph, must produce **no output at all** in the rendered HTML — not an empty escaped span, not a blank paragraph carrying some other visible artifact, **simply absent**."* Guardrail #2 states: *"Stripping a comment must never affect sibling paragraphs' content, order, or spacing — surrounding real content renders exactly as if the comment line were never in the source."*

The delivered output is `<p></p>` — an empty paragraph element, not "no output at all," and it is a real, additional DOM node between "Before text." and "After text." that would not exist "if the comment line were never in the source." I confirmed this has a visible effect, not just a theoretical one: `node_modules/github-markdown-css/github-markdown-light.css:316-318` gives every `.markdown-body p` a `margin-bottom: 10px` (a second, more specific block at line 422-431 raises this to `margin-bottom: 1rem`). An empty `<p></p>` still collapses its own margins into a real gap in the rendered flow — a visible blank space appears exactly where the comment used to be, which is precisely the class of artifact guardrail #1 explicitly rules out ("not a blank paragraph...") and guardrail #2 explicitly rules out ("never affect... spacing").

**Root cause**: `renderer.rules.text` only controls the inline text token between a paragraph's `paragraph_open`/`paragraph_close` tokens; it cannot suppress the paragraph wrapper itself. Stripping the comment text from the `text` token leaves an empty-content paragraph, and markdown-it still emits the `<p>`/`</p>` pair around it regardless of what the `text` rule returns. The chosen extension point (a `renderer.rules.text` override alone) is architecturally insufficient to satisfy guardrail #1 for the standalone-paragraph case — it needed either a core-ruler step that detects an inline token which reduces to empty-after-stripping and removes its surrounding paragraph tokens, or an equivalent block-level/post-render pass.

**Why the tests didn't catch it**: both new unit tests (`toContain`/`not.toContain`) and the e2e test (`textContent()` string checks) only assert on the *text content* of the output, never on structural artifacts like an empty `<p></p>`. None are tautological in the sense of asserting a mock was called, but they are incomplete relative to the literal guardrail they were written to close — this is exactly the "check it doesn't corrupt normal text rendering... don't just read it" gap the review brief called out.

---

## Findings

### Blocking

**B-1 — Guardrail #1 and #2 violated: standalone HTML comment leaves a visible empty `<p></p>` gap.**
Evidence: section 7 above (probe output `'<p></p>\n'`, CSS margin confirmation, root-cause trace to the `renderer.rules.text`-only extension point). This is a genuine, reproducible functional defect against the approved `functional_domain.md` spec, not a matter of interpretation — the spec's own wording ("not a blank paragraph... simply absent") anticipated and explicitly forbade exactly this outcome. Must be routed back to `full-stack-engineer` with a scope amendment (likely needs a core-rule or block-token-level change in `markdown.ts`, beyond the `renderer.rules.text` override alone, plus new unit/e2e assertions that check for the *absence* of an empty `<p></p>`/equivalent structural artifact, not just absence of the comment text).

### Should-fix

**S-1 — `renderer.rules.text` override reimplements escaping instead of delegating to `self.renderToken`.**
The spec's Decision text offered `self.renderToken(tokens, idx, options)` as the primary option and "or equivalent escaping" as an explicit fallback, so the current implementation (`md.utils.escapeHtml(...)`, not capturing `self`) is spec-compliant, not a violation. But it duplicates markdown-it's default text-rendering logic rather than truly delegating to it (Decorator-style: mutate `tokens[idx].content` in place, then call through). If a future markdown-it version or plugin changes what the default `text` rule does (e.g. typographic replacements chained ahead of escaping), this override will silently diverge instead of automatically staying in sync. Low risk today, but worth tightening when B-1 is fixed anyway (the fix will likely need to touch this function regardless).

### Nit

**N-1 — Fixture doesn't include a standalone comment trailing after all real content.**
`tests/e2e/fixtures/with-html-comment/doc.md` covers "before" and "mid" standalone-comment placement plus fenced/raw-tag cases, satisfying the spec's literal file-tree annotation. It doesn't add a third comment specifically *after* the last real content line, which the review brief's shorthand ("before/mid/after") implied. Not a spec violation (the approved `initial_scaffold.md` text doesn't mandate this), but worth adding for completeness once B-1 forces a fixture/test revisit anyway.

---

## Test quality assessment

The three new unit tests and the new e2e spec assert real substring presence/absence (not mock-call presence), so they are not tautological. However, per B-1, they are incomplete relative to the guardrail they close — they verify the comment's *text* disappears but never verify the comment's *paragraph* disappears, which is the more literal reading of guardrail #1. This is the specific class of gap the review brief asked to be checked for by execution, not by reading.

## Regression risk

Zero observed across the full suite (58 unit / 7 integration / 20 e2e, all green, confirmed by the reviewer directly in sections 4-5). The pre-existing `<script>` security tests and `code-highlighting.spec.ts` are unmodified and pass unchanged. The regression risk is not in what's touched — it's in what guardrail #1 required but the diff doesn't deliver.

---

## Files reviewed (absolute paths)

- C:\Source\md-view\.agents\specs\functional_domain.md
- C:\Source\md-view\.agents\specs\initial_scaffold.md
- C:\Source\md-view\src\main\markdown.ts
- C:\Source\md-view\tests\unit\markdown.test.ts
- C:\Source\md-view\tests\e2e\html-comments.spec.ts
- C:\Source\md-view\tests\e2e\fixtures\with-html-comment\doc.md
- C:\Source\md-view\tests\e2e\code-highlighting.spec.ts (comparison baseline)
- C:\Source\md-view\node_modules\markdown-it\lib\renderer.mjs (default rule verification)
- C:\Source\md-view\node_modules\github-markdown-css\github-markdown-light.css (visual-impact verification)
- C:\Source\md-view\package.json

---

**Summary for the Lead**: Verdict is **BLOCKED**. The single Blocking item (B-1) is a real, reproducible violation of guardrail #1/#2 in the approved `functional_domain.md` — a standalone comment paragraph collapses to a visible empty `<p></p>` gap instead of vanishing, because the `renderer.rules.text`-only extension point can strip the comment's text but not its paragraph wrapper. This needs to go back to `full-stack-engineer` as a narrowly-scoped follow-up (likely requires touching `markdown.ts` at a different extension point, plus strengthened unit/e2e assertions that check for the absence of the empty-paragraph artifact itself, not just the comment text). Do not proceed to delivery while B-1 is open.

---

## Re-review (Cycle 3 fix for B-1)

Verdict: **PASS**
Blocking findings: 0 (B-1 resolved)
Should-fix findings: 0 (S-1 resolved)
Nits: 1 (N-1 carried forward, unchanged status)

Reviewed by: code-reviewer (independent verification layer, read-only tools). This section covers only the Cycle-3 follow-up fix; the original Cycle-1 findings above remain the historical record of what was found and why it blocked.

### 1. Diff re-verified directly

```diff
 const md = new MarkdownIt({ html: false, highlight: highlightCode }); // explicit: never allow raw HTML passthrough from source

+// Strips author-written HTML comments from rendered content. This is a core
+// rule (runs after block + inline parsing, before rendering) rather than a
+// renderer.rules.text override: ...
+md.core.ruler.push('strip_html_comments', (state) => {
+  const tokens = state.tokens;
+  for (let i = tokens.length - 1; i >= 0; i--) {
+    const token = tokens[i];
+    if (token.type !== 'inline' || !token.children) continue;
+    for (const child of token.children) {
+      if (child.type === 'text') {
+        child.content = child.content.replace(/<!--[\s\S]*?-->/g, '');
+      }
+    }
+    token.children = token.children.filter((child) => child.type !== 'text' || child.content !== '');
+    const prev = tokens[i - 1];
+    const next = tokens[i + 1];
+    const isMatchingWrapperPair = prev && next && prev.nesting === 1 && next.nesting === -1 &&
+      prev.type.replace(/_open$/, '') === next.type.replace(/_close$/, '');
+    if (token.children.length === 0 && isMatchingWrapperPair) {
+      tokens.splice(i - 1, 3);
+      i -= 1;
+    }
+  }
+  return true;
+});
```
- `html: false` (line 15): byte-identical, unchanged. Confirmed.
- `highlight: highlightCode` / fence path: `highlightCode` function body untouched; **by inspection**, the loop's first statement is `if (token.type !== 'inline' || !token.children) continue;` — fence tokens have `type === 'fence'`, never `'inline'`, so they are `continue`d past on every iteration and never enter the mutation/splice logic at all. This isn't inferred from the fenced-comment test passing; it's structurally impossible for this rule to touch a fence token, confirmed by reading the guard condition itself.
- `md.renderer.rules` — grepped the whole file: the only remaining occurrence of the string `renderer.rules` is inside the explanatory comment (line 19), not an actual assignment. The old `renderer.rules.text` override is fully gone; rendering now flows entirely through markdown-it's untouched default rule set.
- Guardrail #5 one-liner: still present, still a single comment line, unchanged content, correctly relocated to the new rule's doc comment block. Not scope creep.

### 2. Direct probing — reproduced the original B-1 repro plus new cases

Built a standalone Node script running the exact core-rule logic copy-pasted from the diff (not the engineer's script — my own transcription from the diff hunk) against `markdown-it` directly:

```
CASE1 bare comment:                  ""
CASE2 mid-doc (Before/After):        "<h1>Heading</h1>\n<p>Before text.</p>\n<p>After text.</p>\n"
CASE3 mixed inline comment:          "<p>Some text  more text.</p>\n"
CASE4 fenced comment (regression):   "<pre><code class=\"language-html\">&lt;!-- inside fence --&gt;\n&lt;div&gt;x&lt;/div&gt;\n</code></pre>\n"
CASE5 3 consecutive comment paras:   ""
CASE6 comment/heading/comment:       "<h1>H</h1>\n"
CASE7 <script> security:             "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>\n"
```

- **CASE1**: output is the empty string `""` — no `<p></p>`, no residual tag of any kind. This is the literal "no output at all" the spec's guardrail #1 demands. B-1 is resolved for the bare-paragraph case.
- **CASE2**: exactly `<h1>Heading</h1>\n<p>Before text.</p>\n<p>After text.</p>\n` — exactly 2 `<p>` tags, directly adjacent with no empty `<p></p>` or other gap-artifact between them. Confirms guardrail #2 (spacing/order preserved as if the comment line never existed).
- **CASE3** (comment mixed with real text in the same paragraph — not in the original B-1 repro, added per this cycle's request): comment stripped, paragraph itself preserved (1 `<p>`), surrounding text intact. Minor cosmetic note: the regex-replace leaves a double space (`"Some text  more text."`) where the comment used to sit — this is not a guardrail violation (no guardrail governs inline whitespace collapsing) and HTML's own whitespace-collapse rendering means this is visually a non-issue in the browser; noting it only for completeness, not as a finding.
- **CASE4**: unchanged from Cycle 1 — fenced comment still renders as literal escaped text, confirming zero interaction with the fence path (also independently confirmed by code inspection in section 1).
- **CASE5/CASE6** (stress cases beyond the required set, added by me to stress the splice-loop correctness): consecutive comment-only paragraphs and a comment/heading/comment sandwich both resolve correctly — full removal, heading untouched.
- **CASE7**: `<script>` still renders escaped and visible — Task 1's security invariant is intact.

I additionally ran a heavier stress case (5 comment-only paragraphs interleaved with 3 real paragraphs in a single document) to specifically pressure-test the reverse-iteration splice/off-by-one logic the engineer says they self-caught and fixed:
```
Input: c1, Real1, c2, c3, Real2, c4, Real3, c5  (8 paragraphs, alternating)
Output: "<p>Real 1.</p>\n<p>Real 2.</p>\n<p>Real 3.</p>\n"
<p> count: 3 (expected 3)
```
All 5 comment paragraphs removed, all 3 real paragraphs preserved in order, none skipped or duplicated — this is strong independent corroboration that the splice/loop-counter compensation (`i -= 1` after `tokens.splice(i - 1, 3)`) is correct across multiple, including adjacent, removals.

One out-of-spec observation (not a finding): a list item whose only content is a comment (e.g. `- <!-- c1 -->`) resolves to `<li></li>`, not full removal of the `<li>`, because the rule only splices out the paragraph wrapper, not the enclosing `list_item_open`/`_close`. Guardrail #1's literal text scopes the "no output at all" requirement to "alone in its own paragraph," not list items, so this is outside the guardrail's stated scope and not a regression against the approved spec. Flagging only for the Lead's awareness in case a future task wants to extend guardrail #1's scope; not a finding against this diff.

### 3. Full suite — run directly by the reviewer

`npx vitest run tests/unit`:
```
 Test Files  10 passed (10)
      Tests  59 passed (59)
```
(`tests/unit/markdown.test.ts` now 11 tests, up from 10, all green — matches the engineer's reported count.)

`npx vitest run tests/integration`:
```
 Test Files  3 passed (3)
      Tests  7 passed (7)
```

`npm run build`: exit 0.

`npx playwright test --workers=2` (first run): 19 passed, 1 failed — `view-menu.spec.ts:134 (d) close-and-relaunch` failed with `Error: worker process exited unexpectedly (code=3221226505, signal=null)` (a Windows access-violation-class crash, not an assertion failure).

Reran independently two ways to check attribution:
- `npx playwright test tests/e2e/view-menu.spec.ts --workers=1` → **5 passed**, including test (d).
- Full suite again, `npx playwright test --workers=2` → **20 passed**, no failures.

This matches the engineer's characterization: a pre-existing, non-deterministic Windows worker-crash flake, not caused by this diff — `markdown.ts`/`markdown.test.ts` (the only files this cycle touches) have no relationship to `view-menu.spec.ts` or `renderer.js`. I reproduced the flake once and the clean pass twice independently; this is my own evidence, not the engineer's self-report.

### 4. Fault-injection — reproduced independently for the new failure mode

Backed up `src/main/markdown.ts`, then neutered only the paragraph-removal step (commented out `tokens.splice(i - 1, 3);`, leaving the text-stripping loop intact — i.e. reproducing exactly the Cycle-1 bug shape: comment text stripped, wrapper left behind).

`npx vitest run tests/unit/markdown.test.ts` with the splice disabled:
```
 ❯ strips a bare HTML comment alone in its own paragraph, producing no output at all (no empty <p> wrapper)
   → expected '<p></p>\n' not to contain '<p>'
 ❯ strips a standalone HTML comment paragraph in the middle of a document, leaving surrounding text intact and no stray empty <p></p>
   → expected '<h1>Heading</h1>\n<p>Before text.</p>…' not to contain '<p></p>'
 Test Files  1 failed (1)
      Tests  2 failed | 9 passed (11)
```
Failure signature matches B-1 exactly (`<p></p>` reappears, both new structural assertions catch it independently). Restored from backup, confirmed `git diff --stat src/main/markdown.ts` matched the pre-injection diff exactly (`42 insertions, 1 file`), reran:
```
 Test Files  1 passed (1)
      Tests  11 passed (11)
```
Rebuilt (`npm run build`, exit 0) to resync `dist/`. RED→GREEN cycle for the new failure mode confirmed by the reviewer directly, independent of the engineer's own reported fault-injection log.

### 5. S-1 re-check — resolved

S-1 (Cycle 1) flagged that the old `renderer.rules.text` override reimplemented `escapeHtml` manually instead of delegating to markdown-it's default text-rendering path. Confirmed by direct inspection (section 1) that the entire `renderer.rules` override is gone — the new core rule only mutates `state.tokens` (stripping comment substrings from `text` children and, where applicable, splicing out now-empty wrapper triplets) during the `core` phase, strictly before the `renderer` phase runs. Rendering of whatever content survives is handled entirely by markdown-it's own unmodified default `rules.text` (and all other default rules), with no custom escaping logic anywhere in `markdown.ts`. This fully resolves S-1 — there is no longer any duplicated/divergence-prone escaping logic in this file.

### 6. Zero-regression check

- `<script>` security tests (`tests/unit/markdown.test.ts` lines 10-14, 40-51): confirmed byte-identical, unmodified — verified by reading the diff hunk (only additions after the pre-existing content, nothing in the existing lines changed) and by reading the full current file directly.
- `tests/e2e/code-highlighting.spec.ts`: unmodified (not part of this cycle's diff at all — `git status --short` shows only `src/main/markdown.ts` and `tests/unit/markdown.test.ts` as modified this cycle); passed in both e2e runs (`ok 2` and `ok 2` respectively) in section 3.
- `tests/e2e/html-comments.spec.ts` / fixture: untouched this cycle (still untracked, same content as Cycle 1); passed in both e2e runs (`ok 4`).

### 7. N-1 status

Unchanged and still open — `tests/e2e/fixtures/with-html-comment/doc.md` was not touched in this cycle (confirmed via `git status --short`: only `src/main/markdown.ts` and `tests/unit/markdown.test.ts` are modified this cycle). It still lacks a standalone comment trailing after all real content. This remains **Nit-level only** — the approved `initial_scaffold.md` spec text never mandated a "before/mid/after" triad, only "standalone comments, fenced comment, raw non-comment tag," which the fixture satisfies. No change to its severity.

---

## Findings (Cycle 3)

### Blocking
None. B-1 is resolved: independently reproduced zero-output for a bare comment-only paragraph, exactly-2-`<p>`-tags for the mid-document case with no gap, and correct behavior for a comment mixed with real inline text — all via my own probe script and my own fault-injection run, not the engineer's report.

### Should-fix
None. S-1 is resolved: the core-rule approach eliminates the duplicated-escaping logic entirely by operating purely at the token-mutation stage, before any rendering/escaping happens.

### Nit
- N-1 (carried forward, unchanged) — fixture still doesn't include a trailing standalone comment after all real content. Not required by the approved spec; cosmetic only.

---

## Overall verdict: PASS

Both the Cycle-1 Blocking finding (B-1: empty `<p></p>` gap for standalone comment paragraphs) and the related Should-fix (S-1: escapeHtml duplication) are resolved, verified via direct independent probing, direct fault-injection (RED→GREEN reproduced by the reviewer, not just read from the engineer's report), and a full test-suite run (59 unit / 7 integration / 20 e2e, all green on a clean rerun). The one open item is a Nit (N-1) with no bearing on functional correctness. Cleared to proceed to delivery.

---

**File paths relevant to this re-review** (all absolute):
- `C:\Source\md-view\src\main\markdown.ts`
- `C:\Source\md-view\tests\unit\markdown.test.ts`
- `C:\Source\md-view\tests\e2e\html-comments.spec.ts`
- `C:\Source\md-view\tests\e2e\fixtures\with-html-comment\doc.md`
- `C:\Source\md-view\tests\e2e\view-menu.spec.ts` (flake attribution check)
- `C:\Source\md-view\tests\e2e\code-highlighting.spec.ts` (regression check)

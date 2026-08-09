# Independent Code Review — Task 11: Document Card Chrome (rounded border, Preview/Code header)

Verdict: **CLEAR TO SHIP**
Blocking findings: 0
Should-fix findings: 0
Nits: 2

Reviewed by: code-reviewer (independent verification layer, read-only tools).
Spec source of truth: `.agents/specs/functional_domain.md` §"Task 11: Document Card Chrome (rounded border, Preview/Code header)"; `.agents/specs/initial_scaffold.md` §"Task 11 Technical Specification — Document Card Chrome"; `.agents/current_scope.json`.

---

## Evidence trail

### 1. Touched-file list vs. scope contract

Scope contract's `in_scope`: `src/renderer/index.html`, `src/renderer/app.css`, `tests/e2e/ui-shell.spec.ts`, `.agents/specs/review_report_task11.md`.

`git status --short`:
```
 M .agents/metrics/RUN_LOG.md
 M .agents/specs/backlog.md
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M src/main/markdown.ts
 M src/renderer/app.css
 M src/renderer/index.html
 M tests/e2e/ui-shell.spec.ts
 M tests/unit/markdown.test.ts
?? .agents/current_scope.json
?? .agents/specs/review_report_task10.md
?? tests/e2e/fixtures/with-html-comment/
?? tests/e2e/html-comments.spec.ts
```
Every file this task's diff actually touches (`src/renderer/index.html`, `src/renderer/app.css`, `tests/e2e/ui-shell.spec.ts`) is on the granted list. The remaining modified/untracked files are all leftover, already-closed Task 10 artifacts still sitting uncommitted in this working tree (`src/main/markdown.ts`, `tests/unit/markdown.test.ts`, `tests/e2e/html-comments.spec.ts`, `tests/e2e/fixtures/with-html-comment/`, `review_report_task10.md`) plus the Lead's own Task-10 close-out bookkeeping (`RUN_LOG.md` append, `backlog.md` guardrail-#5 entry — both read and confirmed to be pure Task-10-closeout content, not Task-11 work). Confirmed `src/main/renderer.js` and everything under `src/main/**` other than `markdown.ts` show zero diff — no Task-11 code touched the main/preload process. Boundary contract: **compliant**.

### 2. `src/renderer/index.html` — diff hunk and full-file re-read

```diff
     <div id="empty-state">No file open. Use File &gt; Open… (Ctrl+O) to open a Markdown file.</div>
-    <pre id="frontmatter" hidden></pre>
-    <div id="content" class="markdown-body"></div>
+    <div id="document-container">
+      <div id="document-header">
+        <button type="button" id="tab-preview" class="doc-tab active">Preview</button>
+        <button type="button" id="tab-code" class="doc-tab">Code</button>
+      </div>
+      <div id="document-main">
+        <pre id="frontmatter" hidden></pre>
+        <div id="content" class="markdown-body"></div>
+      </div>
+    </div>
     <div id="status-bar">No file open</div>
     <script src="./renderer.js"></script>
```
Read the full resulting file directly. Confirmed:
- **Guardrail #1** — `#content-base` (`<base>`), all four `#theme-*` `<link>` tags, `#frontmatter` (`<pre>`, `hidden`), `#content` (`<div class="markdown-body">`), `#status-bar`, `#empty-state`: every one preserved with identical tag, id, and attributes. The `<head>` section shows zero diff at all (change is scoped entirely to `<body>`). Only the parent chain of `#frontmatter`/`#content` changed.
- **Guardrail #5** — `#empty-state` remains a sibling *before* `#document-container`, not a descendant; `#status-bar` remains a sibling *after* it. Confirmed by direct reading and independently by a runtime DOM probe (section 5 below).
- **Guardrail #3** — both buttons are `type="button"` (not `submit`), carry no `onclick`/event-handler attributes, no `aria-*` attributes at all. `grep -n "tab-preview|tab-code|doc-tab|document-container|document-header|document-main" src/renderer/renderer.js` → **no matches**. `git diff -- src/renderer/renderer.js` → empty (zero diff on the whole file). The two tabs are provably inert — no wiring exists anywhere in the renderer script.

### 3. `src/renderer/app.css` — diff hunk and full-file re-read

```diff
@@ -73,3 +73,59 @@ body.dark-mode #frontmatter {
   border-color: #30363d;
   color: #c9d1d9;
 }
+
+/* Task 11: document card chrome — ... */
+#document-container {
+  margin: 1.5rem 2rem 0;
+  border: 1px solid #d0d7de;
+  border-radius: 6px;
+  overflow: hidden;
+}
+#document-header { display: flex; ...; background: #f6f8fa; border-bottom: 1px solid #d0d7de; }
+.doc-tab { ...; border-bottom: 2px solid transparent; ...; color: #24292f; ...; cursor: pointer; }
+.doc-tab:hover { background: rgba(208, 215, 222, 0.32); }
+.doc-tab.active { border-bottom-color: #fd8c73; font-weight: 600; }
+body.dark-mode #document-container { border-color: #30363d; }
+body.dark-mode #document-header { background: #161b22; border-bottom-color: #30363d; }
+body.dark-mode .doc-tab { color: #c9d1d9; }
```
Read the full file directly (lines 1-131). Confirmed:
- **Guardrail #2** — `#content { padding-inline: 2rem; padding-bottom: 2rem; }` (lines 9-15) and `#frontmatter { margin: 0 2rem; ... }` (lines 41-52) are byte-identical to pre-diff; the diff hunk only inserts new content after line 73, touching nothing before it. `#document-container`'s own `margin: 1.5rem 2rem 0` is a genuinely separate, outer layer — not a replacement.
- **Guardrail #4** — `body.dark-mode #document-container`/`#document-header` reuse the exact `#30363d` (border) / `#161b22` (background) pair already used for `body.dark-mode #frontmatter`/`#status-bar` (lines 61-75); `body.dark-mode .doc-tab` reuses the exact `#c9d1d9` text color already used for `body.dark-mode #frontmatter`. No new dark-mode colors invented for the structural chrome, exactly as guardrail #4 requires.

### 4. `tests/e2e/ui-shell.spec.ts` — diff hunk

```diff
-  // (c) #content's computed lateral padding is non-zero after render.
+  // (c) Task 11: document card chrome — bordered container + header bar
+  // with two inert tab-style buttons, mimicking GitHub's file-view chrome.
+  await expect(window.locator('#document-container')).toBeVisible();
+  await expect(window.locator('#document-header')).toBeVisible();
+
+  const tabPreview = window.locator('#tab-preview');
+  const tabCode = window.locator('#tab-code');
+  await expect(tabPreview).toBeVisible();
+  await expect(tabCode).toBeVisible();
+  await expect(tabPreview).toHaveText('Preview');
+  await expect(tabCode).toHaveText('Code');
+
+  await expect(tabPreview).toHaveClass(/active/);
+  await expect(tabCode).not.toHaveClass(/active/);
+
+  // (d) #content's computed lateral padding is non-zero after render.
   const paddingLeft = await content.evaluate((el) => window.getComputedStyle(el).paddingLeft);
   const paddingRight = await content.evaluate((el) => window.getComputedStyle(el).paddingRight);
   expect(parseFloat(paddingLeft)).toBeGreaterThan(0);
   expect(parseFloat(paddingRight)).toBeGreaterThan(0);
```
The pre-existing padding assertion lines (`paddingLeft`/`paddingRight` capture + both `toBeGreaterThan(0)` checks) appear as unchanged context in the diff — only the preceding label comment was relettered from `(c)` to `(d)` (and the trailing block from `(d)` to `(e)`) to make room for the new sub-case. The assertion code itself is byte-for-byte unmodified, satisfying the spec's "do not modify the existing computed-padding assertion" requirement. All four required new assertions (container/header visible, both tabs present with correct text, active-class split) are present.

### 5. Runtime DOM structural check — performed independently (beyond the written assertions)

Wrote a standalone temporary Playwright spec (created and removed within this review session, never part of the delivered diff) to probe the live DOM tree via `window.evaluate`, launching against the real fixture:
```js
{
  containerContainsFrontmatter: true,
  containerContainsContent: true,
  containerContainsEmptyState: false,
  containerContainsStatusBar: false,
  emptyStateParentId: "",      // parent is <body>, not #document-container
  statusBarParentId: "",       // parent is <body>, not #document-container
  containerParentId: "BODY"
}
```
Confirms `#document-container` genuinely contains `#frontmatter` and `#content` as real DOM descendants (not merely co-present elsewhere in the tree), and genuinely does **not** contain `#empty-state` or `#status-bar` — both are siblings of `#document-container` under `<body>`. This directly verifies guardrails #1 and #5 at the DOM level, not just via static markup reading.

### 6. Full test suite — run directly by the reviewer

`npx vitest run tests/unit tests/integration`:
```
 Test Files  13 passed (13)
      Tests  66 passed (66)
```
(59 unit + 7 integration — unaffected by this presentational diff, as expected; `markdown.test.ts`'s 11 tests are Task 10 leftovers, included in this count but not part of this review.)

`npm run build`: exit 0.

`npx playwright test` (default, 4 workers): **20 passed** (21.5s).
Reran twice more explicitly at `--workers=4`: **20 passed** (23.0s), **20 passed** (24.2s).
Reran once at `--workers=1`: **20 passed** (36.1s).

I could not reproduce the parallel-worker flakiness the engineer/coordinator described in four independent full-suite runs (three at 4 workers, one at 1 worker) — all 20 specs green every time, including `view-menu.spec.ts` (d), the specific test that crashed during Task 10's cycle-3 re-review under similar conditions. This doesn't contradict the claim (a genuinely intermittent, environment-level Windows worker crash is not expected to reproduce on every run — it didn't reproduce for me during Task 10's re-review either, on 2 of 3 attempts), but I want to be precise: this is an *inability to reproduce it this session*, not a disproof of the claim. What I can confirm independently: this diff touches only `index.html`/`app.css`/`ui-shell.spec.ts`, none of which have any relationship to Electron process lifecycle, IPC, or window management — the class of code where such a crash would originate — so there is no plausible causal path from this diff to that failure mode even if it recurs.

### 7. Fault-injection proof — performed independently by the reviewer

Per the spec's own "Fault-injection proof" section (no business logic to fault-inject; substitute is confirming `#content`'s padding assertion is a real, non-compensated-for detector), I zeroed out `#content`'s own padding directly:
```diff
-  padding-inline: 2rem;
+  padding-inline: 0;
```
Rebuilt, ran `tests/e2e/ui-shell.spec.ts` in isolation:
```
Error: expect(received).toBeGreaterThan(expected)
Expected: > 0
Received:   0
  at ui-shell.spec.ts:101:35
1 failed
  argv launch: empty-state disappears, status bar shows the real absolute path
2 passed
```
Confirms the padding assertion is genuinely testing `#content`'s own CSS, not being incidentally satisfied by `#document-container`'s separate outer margin — exactly the check the spec asked for. Restored `app.css` from backup, confirmed `git diff --stat src/renderer/app.css` matched the pre-injection diff exactly (`56 insertions, 1 file`), rebuilt, reran: **3 passed** (all of `ui-shell.spec.ts`, including the restored padding assertion). RED→GREEN cycle reproduced directly by the reviewer, not trusted from the engineer's report.

### 8. Regression check — `view-menu.spec.ts` and elsewhere

`grep -n "document-container|document-header|#content\b" tests/e2e/view-menu.spec.ts` shows zero references to any new Task-11 element — the dark-mode/frontmatter-toggle tests only ever touch `#content` directly, unaffected by its new ancestor chain. All 5 `view-menu.spec.ts` cases (a-e) passed cleanly in every one of the 4 full-suite runs in section 6, including test (c) (dark-mode computed-color check) and test (e) (`#content`'s padding-bottom check) — both of which query computed styles on `#content` and would be the most likely to break if the new wrapper interfered with layout/cascade, and neither did.

---

## Findings

### Blocking
None.

### Should-fix
None.

### Nits

- **N-1** — The technical spec explicitly asked the engineer to "pick the existing palette's nearest accent — engineer's call, document the choice" for `.doc-tab.active`'s underline color. The engineer picked `#fd8c73` (a reasonable choice — it's GitHub's actual file-view active-tab accent, consistent with the "mimicking GitHub's file-view chrome" framing), but there is no comment, ADR, or note anywhere documenting *why* this specific value was chosen or that it was a deliberate, considered pick rather than an arbitrary one. `ls .agents/specs/decisions/` shows no Task-11 ADR. Low priority — purely a documentation-completeness gap, not a functional or design defect.
- **N-2** — `body.dark-mode .doc-tab.active` has no explicit dark-mode override for `border-bottom-color`, so the `#fd8c73` accent underline is shared unchanged across light/dark. This appears intentional (GitHub's own dark theme uses a similar orange-family accent for this exact UI element) and the spec's guardrail #4 / styling-changes section only mandates dark-mode variants for `#document-container`, `#document-header`, and `.doc-tab`'s text color — not `.doc-tab.active`'s underline — so this is spec-compliant, not a violation. Noting only because it's adjacent to N-1: worth an explicit one-line comment confirming this is deliberate (shared accent, not a missed dark-mode case) next time this file is touched.

---

## Test quality assessment

The new `ui-shell.spec.ts` assertions check real, specific DOM state (visibility, exact button text, exact class-list membership) rather than mock-call presence or vague "differs from before" checks — not tautological. Fault injection (section 7) proved the untouched padding assertion remains a genuine, non-compensated regression detector after the new wrapper was introduced. The runtime descendant-check performed independently (section 5) goes beyond what the written test suite asserts (the suite checks visibility/text/class, not DOM ancestry) and closes exactly the kind of gap that caused Task 10's B-1 to slip through — here, it confirms rather than contradicts the implementation.

## Regression risk

Zero. This diff touches only static markup and static CSS, plus test assertions for a single spec file. `renderer.js` and everything under `src/main/**` (other than the unrelated, already-reviewed Task 10 leftover in `markdown.ts`) show zero diff. All 20 e2e specs and 66 unit/integration tests pass across four independent full-suite runs, including the specs most likely to be affected by a layout-wrapper change (`view-menu.spec.ts` (c)/(e), which query computed styles on `#content`).

---

## Files reviewed (absolute paths)

- C:\Source\md-view\.agents\specs\functional_domain.md
- C:\Source\md-view\.agents\specs\initial_scaffold.md
- C:\Source\md-view\src\renderer\index.html
- C:\Source\md-view\src\renderer\app.css
- C:\Source\md-view\src\renderer\renderer.js (zero-diff verification)
- C:\Source\md-view\tests\e2e\ui-shell.spec.ts
- C:\Source\md-view\tests\e2e\view-menu.spec.ts (regression check)
- C:\Source\md-view\.agents\metrics\RUN_LOG.md (out-of-scope-check, confirmed Lead's own Task-10 close-out content)
- C:\Source\md-view\.agents\specs\backlog.md (out-of-scope-check, confirmed Lead's own Task-10 close-out content)
- C:\Source\md-view\package.json

---

Working tree confirmed clean of any scratch/probe artifacts (the temporary structural-check spec file was created and deleted within this session; `git diff --stat` on `app.css` after the fault-injection restore matched the pre-injection state exactly).

**Verdict summary: PASS / CLEAR TO SHIP.** Zero Blocking, zero Should-fix, two Nits (both minor documentation-completeness items around the `.doc-tab.active` accent color choice, not functional defects). All five guardrails (#1-#5) verified independently — by direct diff reading, direct runtime DOM inspection, and reproduced fault-injection — rather than trusted from the engineer's report.

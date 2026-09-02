# Independent Review Report — Task 33 (Fix: Raw Source in Code Tab Doesn't Wrap, Forces Horizontal Scroll)

**Verdict: PASS — 0 Blocking / 0 Should-fix / 1 Nit**

---

## 1. Scope compliance

`git status --short`:
```
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M src/main/markdown.ts
 M tests/e2e/ui-shell.spec.ts
 M tests/unit/markdown.test.ts
?? .agents/current_scope.json
?? tests/e2e/fixtures/long-line.md
```

`.agents/current_scope.json` (untracked, present) `in_scope`:
```json
["src/main/markdown.ts", "tests/unit/markdown.test.ts", "tests/e2e/ui-shell.spec.ts", "tests/e2e/fixtures/long-line.md"]
```

Every touched source/test file (`src/main/markdown.ts`, `tests/unit/markdown.test.ts`, `tests/e2e/ui-shell.spec.ts`, plus the new untracked `tests/e2e/fixtures/long-line.md`) is declared in scope. `.agents/specs/functional_domain.md`/`initial_scaffold.md` are modified but not in `in_scope` — confirmed via `git diff --stat` this is a pure `+71/-0` / `+72/-0` addition (the Lead's own Step 0/1 spec appendix), the same non-violation pattern already documented in `review_report_task32.md` §1. **No out-of-scope file touched.**

## 2. Guardrail #97 — fix confined to `highlightMarkdownSource`'s return value only

`git diff -- src/main/markdown.ts` (full diff, only hunk in the file):
```diff
@@ -69,5 +69,5 @@ export function highlightMarkdownSource(source: string): string {
   const value = hljs.getLanguage('markdown')
     ? hljs.highlight(source, { language: 'markdown' }).value
     : hljs.highlightAuto(source).value; // documented fallback if the guardrail #1 pre-check ever regresses
-  return `<pre><code class="hljs language-markdown">${value}</code></pre>`;
+  return `<code class="hljs language-markdown">${value}</code>`;
 }
```
Exactly the return-statement narrowing specified in `initial_scaffold.md`'s Task 33 section, character-for-character. The `hljs.getLanguage('markdown')` pre-check and `highlightAuto` fallback are untouched (unchanged lines above the `return`).

Read the full 74-line file directly: nothing else in `src/main/markdown.ts` differs from the Task 32 baseline. `markdownToHtml`, `highlightCode`, and the shared `md` MarkdownIt instance are byte-identical.

Confirmed **zero diff** to the peripheral files the spec explicitly calls out as untouched:
```
git diff -- src/renderer/app.css src/renderer/index.html
(no output)
```
Read directly: `src/renderer/index.html:39` — `<pre id="code-content" hidden></pre>` (the container is itself the `<pre>`); `src/renderer/app.css:305-308` — `#code-content { ...; white-space: pre-wrap; ... }`. Both unchanged, exactly as the spec assumes ("the existing `#code-content` rule already carries the correct behavior"). **Guardrail #97 satisfied.**

## 3. Guardrail #94 — `#code-content` contains exactly one `<pre>` (itself), never a nested one

Unit-level lock-in, `tests/unit/markdown.test.ts` diff:
```diff
   it('produces hljs-* span(s) for a known markdown snippet', () => {
     const html = highlightMarkdownSource('# Heading\n\nSome **bold** text.');
     expect(html).toContain('hljs-');
-    expect(html).toContain('<pre><code class="hljs language-markdown">');
+    expect(html).toContain('<code class="hljs language-markdown">');
   });

   it('does not throw on an empty string input', () => {
     expect(() => highlightMarkdownSource('')).not.toThrow();
     const html = highlightMarkdownSource('');
-    expect(html).toContain('<pre><code class="hljs language-markdown">');
+    expect(html).toContain('<code class="hljs language-markdown">');
   });
...
+  it('never wraps its own output in a <pre> (the container already is one)', () => {
+    const html = highlightMarkdownSource('# Heading\n\nSome text.');
+    expect(html).not.toContain('<pre');
+  });
```
Both of the two updated assertions and the one new regression test are present and match the approved Test Plan exactly. Nothing in the `markdownToHtml` describe block is touched (confirmed by reading the full diff — it starts at line 87, inside the `highlightMarkdownSource` describe block only).

e2e proof, `tests/e2e/ui-shell.spec.ts` diff (new `describe`):
```ts
test.describe('Task 33: Code tab wraps long lines instead of forcing horizontal scroll', () => {
  const fixturePath = path.join(process.cwd(), 'tests/e2e/fixtures/long-line.md');
  test.use({ electronArgs: [fixturePath] });

  test('a long prose line in #code-content wraps: no nested <pre>, no horizontal overflow', async ({ electronApp }) => {
    ...
    await window.locator('#tab-code').click();
    const codeContent = window.locator('#code-content');
    await expect(codeContent).toBeVisible();

    expect(await codeContent.locator('pre').count()).toBe(0);

    const overflow = await codeContent.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
  });
});
```
This asserts against the live rendered DOM (`#code-content pre` count === 0) and real geometry (`scrollWidth` vs `clientWidth`, 2px tolerance) — not code-read inference. **Guardrail #94 satisfied both at the unit level (string shape) and at the e2e level (live DOM).**

## 4. Guardrail #95 — a long prose line (ordinary spaces) must wrap, never force horizontal scroll

`tests/e2e/fixtures/long-line.md`, read directly (new, untracked, in scope):
```
# Long Line Fixture

This is a single long paragraph made entirely of ordinary short words separated by plain spaces, written specifically to be well over two hundred characters in length so that the Code tab's raw source view is forced to either wrap this line or force a horizontal scrollbar to appear, and this test exists to prove it wraps instead.
```
251 characters, ordinary spaces throughout — a real prose paragraph, not one unbroken token (correctly distinct from guardrail #96's out-of-scope case). This is exactly the fixture shape the Test Plan specifies. **Guardrail #95's precondition is met.**

## 5. Test execution — unit

```
npx vitest run tests/unit/markdown.test.ts

 ✓ tests/unit/markdown.test.ts (15 tests) 45ms

 Test Files  1 passed (1)
      Tests  15 passed (15)
```
14 pre-existing Task 32 assertions (2 updated) + 1 new regression test, all green.

## 6. Test execution — targeted e2e

```
npx playwright test -g "Task 33"

  ok 1 tests\e2e\ui-shell.spec.ts:266:7 › Task 33: Code tab wraps long lines instead of forcing horizontal scroll › a long prose line in #code-content wraps: no nested <pre>, no horizontal overflow (2.4s)

  1 passed (3.3s)
```
```
npx playwright test -g "Task 32"

  ok 1 … clicking #tab-code shows highlighted raw source and hides #content; clicking back to #tab-preview restores it (2.1s)
  ok 2 … selecting "Code" from the View menu updates the visible tab to Code (1.9s)
  ok 3 … clicking #tab-code directly, then opening the View menu, shows "Code" checked (menu/click round-trip) (2.2s)
  ok 4 … the frontmatter block appears literally inside #code-content when the Code tab is shown (1.9s)

  4 passed (9.2s)
```
Zero regression on the Task 32 feature this fix touches.

## 7. Fault-injection — RED/GREEN causal proof

Captured the exact hunk under test and reverted it:
```
git diff -- src/main/markdown.ts > /tmp/task33-markdown-ts.diff
git apply -R /tmp/task33-markdown-ts.diff
```
This restores the pre-fix return statement (`return '<pre><code class="hljs language-markdown">${value}</code></pre>';`), confirmed via `git status --short src/main/markdown.ts` showing no diff (now byte-identical to HEAD, the pre-Task-33 state).

**RED, unit** (`npx vitest run tests/unit/markdown.test.ts`, source reverted, test files at their current/fixed-spec state):
```
 ❯ tests/unit/markdown.test.ts (15 tests | 1 failed)
   × never wraps its own output in a <pre> (the container already is one)
     → expected '<pre><code class="hljs language-markd…' not to contain '<pre'
 Tests  1 failed | 14 passed (15)
```
This is exactly the reintroduced-bug scenario framed in the task brief. Confirmed by direct execution: it goes RED for the exact claimed reason.

**RED, e2e** — important methodological note: the first attempt to reproduce this ran `npx playwright test -g "Task 33"` directly against the already-built `dist/` output (built before the revert) and it **falsely passed**. This project's e2e suite launches a pre-built Electron bundle (`npm run test:e2e` = `npm run build && playwright test`; `dist/main/markdown.js` is `tsc`-compiled, not the live TS source). Re-running `npm run build` after the revert regenerated `dist/main/markdown.js` with the reverted (buggy) `return` line (confirmed via `grep` on the compiled output). With the rebuild in place:
```
npx playwright test -g "Task 33"

  x  1 … a long prose line in #code-content wraps: no nested <pre>, no horizontal overflow
    Error: expect(received).toBe(expected)
    Expected: 0
    Received: 1
      278 |     expect(await codeContent.locator('pre').count()).toBe(0);
```
Confirmed RED, at the exact assertion (`#code-content pre` count) that guardrail #94 requires, for the exact claimed reason (a nested `<pre>` really is present in the live DOM).

**GREEN, restore:**
```
git apply /tmp/task33-markdown-ts.diff
npm run build   # regenerates dist/main/markdown.js with the fixed return line
```
Confirmed via `git diff -- src/main/markdown.ts` showing the fix restored, then re-ran both:
- `npx vitest run tests/unit/markdown.test.ts` → `15 passed (15)`.
- `npx playwright test -g "Task 33"` → `1 passed`.

**This directly answers the fault-injection question posed to the reviewer: the new unit regression test and the new e2e test both correctly fail (RED) if the `<pre>` wrapper is reintroduced while the test files remain at their current, correct-per-spec state, and both correctly pass (GREEN) once the real fix is restored.** Neither test is tautological or calling-convention-only; both assert the actual output shape (unit) or actual rendered DOM geometry/structure (e2e) that constitutes the bug.

On the hypothetical posed ("what if the e2e overflow assertion were checking the wrong element") — verified by direct code reading, not a separate build: the assertion targets `window.locator('#code-content')`, the exact same element guardrail #94's `pre`-count check targets and the exact element `app.css:305`'s `white-space: pre-wrap` rule is declared on. There is no element-target ambiguity in the delivered test; this is not a live risk in the current diff.

## 8. Full authoritative test suite — `npm run test:all`, executed twice by the reviewer

**Run 1** (e2e portion, 2 workers):
```
97 passed (2.5m)
1 failed: tests\e2e\ui-shell.spec.ts:50 › argv launch with sample.md › argv launch: empty-state disappears, status bar shows the real absolute path
  Error: expect(containerBox.width).toBeGreaterThan(800)  Expected: > 800  Received: 140.8
```
This is the well-established pre-existing flake logged repeatedly in `.agents/specs/backlog.md:173-180` and in at least 9 prior review reports (Task 11, 12, 14, 15, 16, 19, 21, 22, 25) — a parallel-worker layout-timing race on this same assertion, never attributable to any specific diff. Confirmed via 3 consecutive isolated re-runs (`--workers=1`), all green.

**Run 2** (all three tiers):
```
> vitest run tests/unit
 Test Files  18 passed (18)
      Tests  109 passed (109)

> vitest run tests/integration
 Test Files  4 passed (4)
      Tests  22 passed (22)

> playwright test   (Running 98 tests using 2 workers)
  ok 49 tests\e2e\ui-shell.spec.ts:266:7 › Task 33: … a long prose line in #code-content wraps: no nested <pre>, no horizontal overflow (2.9s)
  ...
  1) tests\e2e\view-menu.spec.ts:180:5 › (f) toggling Show File Tree hides/shows #tree-panel and #main-panel reclaims/gives back its width, in both directions
     Error: worker process exited unexpectedly (code=3221226505, signal=null)
  1 failed
  97 passed (2.4m)
```
109 (unit) + 22 (integration) + 98 (e2e) = 229 tests attempted; 228 passed, 1 failed. The single e2e failure is a Windows access-violation-class worker crash (`code=3221226505`), an exceptionally well-documented pre-existing flake class in this repo — logged across `review_report_task10.md`, `task12.md`, `task19.md`, `task28.md`, `initial_scaffold.md:2541-2570`, and `backlog.md:311-315,439-443` — explicitly characterized there as striking a *rotating, unpredictable set of tests each run, never the same test twice, never attributable to the diff under review*. Confirmed via 3 consecutive isolated re-runs of the exact failing test (`--workers=1`), all green.
`view-menu.spec.ts` is not in Task 33's `in_scope` list and Task 33's diff touches nothing related to the Show-File-Tree/tree-panel code path.

**Both runs' single failure is a distinct, previously-and-repeatedly-documented pre-existing flake class, confirmed non-reproducing in isolation. Zero Task-33-related test failed in either run.** Test-count math is internally consistent: 98 e2e = 97 (Task 32's last-known-good baseline) + 1 net new Task 33 e2e test; unit 109 = 108 (Task 32 baseline) + 1 net new Task 33 unit test.

`git status --short` after all fault-injection/build activity, confirmed byte-identical to the pre-review snapshot in §1 (working tree fully restored, `dist/` regenerated to match current source, no stray artifacts).

## 9. Architecture / SOLID / GoF scan

- **SRP**: `highlightMarkdownSource` now does exactly one thing — produce highlighted inline markup — and no longer also decides the outer block-level wrapper. That decision now lives in exactly one place (`#code-content`'s `index.html`/`app.css` declaration), matching the spec's stated intent.
- **Inward dependency rule**: no core-domain component touched; this is a peripheral-layer (main-process formatting helper) one-line output-shape fix. No new coupling introduced or removed.
- **No GoF pattern implicated** — correctly assessed by the spec as too small a change to warrant one; agree independently, nothing here contradicts that.
- No architecture violation found, in the scaffold or in the delivered code.

## 10. Regression risk — anything touched not covered by a test?

The only production code touched is the single `return` line in `highlightMarkdownSource`, which is exercised by every test in `tests/unit/markdown.test.ts`'s `highlightMarkdownSource` describe block (15 tests, all touching this function) plus 5 e2e tests (Task 32 ×4, Task 33 ×1) that render its real output into the live DOM. No untested surface found.

---

## Findings

**Blocking: 0**

**Should-fix: 0**

**Nit (1):**
- **N-1** — No `.agents/DEVLOG.md` entry exists for Task 33 (confirmed via `grep -n "Task 33" .agents/DEVLOG.md` — zero hits; the file's last entry is Task 32's). This repeats `review_report_task32.md`'s S-2 finding (there raised as Should-fix due to a mid-task scope amendment with zero paper trail). Here it is downgraded to a Nit because Task 33 was a single-cycle, single-file bug fix with no scope amendment or judgment call needing narration — but the project's own unbroken Task 24–32 DEVLOG discipline is still not being maintained for bug-fix tasks, and is worth reinstating.

## Summary

Every guardrail introduced by Task 33 (#94, #95, #97; #96 is explicitly out-of-scope/unchanged by design and correctly untested) was independently re-derived against the real diff and the real running app. The source change is exactly the one-line return-statement narrowing specified, with zero diff to `app.css`, `index.html`, `markdownToHtml`, `highlightCode`, or the shared `md` instance. Both new/updated unit assertions and the new e2e test assert real behavior (output shape / live DOM structure and geometry), not tautologies, and were proven causal via an actual RED→GREEN fault-injection round-trip (including catching and correcting the reviewer's own initial false-GREEN e2e result caused by a stale `dist/` build — a process risk worth the Lead's awareness for future e2e-based fault injection in this repo). The full `test:all` suite was run twice by the reviewer; the single failure in each run was a distinct, extensively pre-documented flake class, confirmed non-reproducing via 3 isolated re-runs each. Scope contract matches the touched-file list exactly.

**Overall verdict: PASS.** No blocking or should-fix defects found. The one Nit (missing DEVLOG entry) does not warrant a fix-and-reverify round.

---

**Files relevant to this review** (all absolute paths):
- `c:\Source\md-view\src\main\markdown.ts`
- `c:\Source\md-view\tests\unit\markdown.test.ts`
- `c:\Source\md-view\tests\e2e\ui-shell.spec.ts`
- `c:\Source\md-view\tests\e2e\fixtures\long-line.md`
- `c:\Source\md-view\.agents\current_scope.json`
- `c:\Source\md-view\.agents\specs\functional_domain.md` (Task 33 section)
- `c:\Source\md-view\.agents\specs\initial_scaffold.md` (Task 33 section)
- `c:\Source\md-view\.agents\specs\backlog.md` (pre-existing flake log, lines 173-180)
- `c:\Source\md-view\.agents\DEVLOG.md` (no Task 33 entry — N-1)
- `c:\Source\md-view\src\renderer\index.html`, `c:\Source\md-view\src\renderer\app.css` (confirmed zero diff)

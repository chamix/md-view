# Independent Review Report — Task 32 (Code Tab: Raw Markdown Source with Syntax Highlighting + ViewSettings De-duplication)

**Verdict: PASS — 0 Blocking / 2 Should-fix / 3 Nit**

---

## 1. Scope compliance

`git status` shows all changes are **unstaged, working-tree only** (nothing committed). `git diff --name-only`:

```
.agents/specs/functional_domain.md
.agents/specs/initial_scaffold.md
src/main/index.ts
src/main/markdown.ts
src/main/menu.ts
src/preload/api.ts
src/preload/index.ts
src/renderer/app.css
src/renderer/index.html
src/renderer/renderer.js
tests/e2e/ui-shell.spec.ts
tests/e2e/window-chrome.spec.ts
tests/integration/preload-api-contract.test.ts
tests/unit/markdown.test.ts
tests/unit/menu.test.ts
```

`.agents/current_scope.json` (untracked, present) `in_scope` list:
```
src/preload/api.ts, src/main/menu.ts, src/main/markdown.ts, src/main/index.ts,
src/preload/index.ts, src/renderer/index.html, src/renderer/renderer.js,
src/renderer/app.css, tests/unit/markdown.test.ts,
tests/integration/preload-api-contract.test.ts, tests/e2e/ui-shell.spec.ts,
tests/e2e/fixtures/with-frontmatter/doc.md, tests/unit/menu.test.ts,
tests/e2e/window-chrome.spec.ts
```

Every touched source/test file is declared in scope. `tests/e2e/fixtures/with-frontmatter/doc.md` is declared but has **zero diff** (`git diff` empty) — confirmed pre-existing from Task 8, correctly reused unmodified (see §4). `.agents/specs/functional_domain.md`/`initial_scaffold.md` are modified but **not** in `in_scope` — confirmed via `git diff --stat` this is a pure `+331/-0` addition (Lead's own Step 0/1 spec appendix), the same non-violation pattern documented in `review_report_task31.md` §1. No out-of-scope file touched. **No violation.**

## 2. Guardrail #87 — Code tab shows the literal, full raw file (frontmatter included)

`git diff -- src/main/index.ts`:
```diff
     const source = await fs.readFile(filePath, 'utf8');
     const { frontmatter, body } = extractFrontmatter(source);
-    return { ok: true, filePath, html: markdownToHtml(body), baseUrl: baseUrlForFile(filePath), frontmatter };
+    return {
+      ok: true,
+      filePath,
+      html: markdownToHtml(body),
+      codeHtml: highlightMarkdownSource(source),
+      baseUrl: baseUrlForFile(filePath),
+      frontmatter,
+    };
```
`html` is built from `body` (frontmatter-stripped); `codeHtml` is built from `source` (the full, pre-split raw file). Structurally correct — cannot narrow to `body` by construction.

**Test evidence, read directly** (`tests/e2e/ui-shell.spec.ts`, `describe('Task 32: Code tab shows the full raw file, frontmatter included')`):
```ts
const fixturePath = path.join(process.cwd(), 'tests/e2e/fixtures/with-frontmatter/doc.md');
...
await window.locator('#tab-code').click();
const codeContent = window.locator('#code-content');
await expect(codeContent).toContainText('title: Frontmatter Fixture');
await expect(codeContent).toContainText('tags: e2e, task8');
await expect(codeContent).toContainText('Frontmatter Fixture Heading');
```
Fixture content read directly (`tests/e2e/fixtures/with-frontmatter/doc.md`, unmodified):
```
---
title: Frontmatter Fixture
tags: e2e, task8
---
# Frontmatter Fixture Heading
Body text following the frontmatter block.
```
This is a real, executed test asserting real frontmatter text appears inside `#code-content` — not a code-read assumption. Test passed.

**Note (see Nit N-1):** the approved Test Plan in `initial_scaffold.md` specified this lock-in as a `tests/unit/markdown.test.ts` `renderFile` fixture test; it was implemented instead as this e2e test. This is a defensible substitution (`renderFile` is a private, un-unit-tested function inside `index.ts`, which is not imported by any existing unit-test file — no unit-test seam exists for it in this codebase today), and the guardrail is genuinely proven either way, but the deviation from the literal Test Plan location wasn't called out anywhere in the diff.

## 3. Guardrail #90 — `highlightMarkdownSource` is a fully independent path, never routes through `markdown-it`

`git diff -- src/main/markdown.ts` (full addition):
```ts
export function highlightMarkdownSource(source: string): string {
  const value = hljs.getLanguage('markdown')
    ? hljs.highlight(source, { language: 'markdown' }).value
    : hljs.highlightAuto(source).value;
  return `<pre><code class="hljs language-markdown">${value}</code></pre>`;
}
```
Read the entire file directly (`src/main/markdown.ts`, 74 lines total post-diff): `highlightMarkdownSource` never references `md`, `md.render`, or any `markdown-it` API. It only calls `hljs.getLanguage`/`hljs.highlight`/`hljs.highlightAuto`. `markdownToHtml` (unchanged) still only calls `md.render(source)`. No shared state, no call relationship either direction. **Structurally confirmed independent.**

Regression proof, executed by the reviewer:
```
npx vitest run tests/unit/markdown.test.ts
✓ tests/unit/markdown.test.ts (14 tests) 55ms
Test Files  1 passed (1)
     Tests  14 passed (14)
```
All 11 pre-existing `markdownToHtml` tests pass unmodified alongside the 3 new `highlightMarkdownSource` tests.

## 4. Guardrail #91 — trust boundary / no renderer-side concatenation / escaping relied upon correctly

`git diff -- src/renderer/renderer.js`:
```js
if (message.ok) {
  renderHtml(message.html, message.baseUrl);
  // Same trust boundary as renderHtml's container.innerHTML assignment
  // above: message.codeHtml is main-process-generated, hljs-escaped
  // content, never renderer-side string concatenation.
  if (codeContentEl) codeContentEl.innerHTML = message.codeHtml;
}
```
Direct assignment of the main-process string to `innerHTML` — no template-literal concatenation, no string-building of file content in the renderer anywhere in the diff.

Security-regression test, read and executed:
```ts
it('HTML-escapes script-tag-like text in the source (security regression, mirrors markdownToHtml)', () => {
  const html = highlightMarkdownSource('<script>alert(1)</script>');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('</script>');
  expect(html).toContain('&lt;');
  expect(html).toContain('&gt;');
});
```
This passed. The assertion is intentionally weaker than the existing `markdownToHtml` script-tag test (which asserts a contiguous escaped string) — the in-file comment explains why (hljs's markdown grammar tokenizes embedded HTML into nested spans, so the escaped brackets need not be contiguous with the tag name). Considered an honest, correctly-reasoned weakening, not a hidden gap: the two negative assertions are what actually protect the `innerHTML` sink, and both are present and passing.

## 5. Guardrail #92 — exactly one `ViewSettings` declaration

```
grep -rn "interface ViewSettings" src/
src\preload\api.ts:37:export interface ViewSettings {
```
Exactly one hit. `git diff -- src/main/menu.ts`:
```diff
-export interface ViewSettings {
-  darkMode: boolean;
-  showFrontmatter: boolean;
-  showTreePanel: boolean;
-}
+import type { ViewSettings, DocumentTab } from '../preload/api';
+export type { ViewSettings, DocumentTab };
```
`menu.ts`'s local interface is deleted and it now imports from `preload/api.ts`. **Guardrail #92 literally satisfied.**

**Should-fix S-1 (architecture):** `menu.ts`'s `export type { ViewSettings, DocumentTab };` is not just leftover ceremony — it is load-bearing. `src/main/index.ts` still imports `ViewSettings` from `./menu` (unchanged import site), while the same diff adds a *direct* import of `DocumentTab` from `../preload/api`. So `index.ts` sources `DocumentTab` directly from the canonical module but `ViewSettings` indirectly through `menu.ts`'s re-export — two different import paths into the same cohesive interface family declared in the same file. This contradicts the plan's own stated Inward Dependency Rule intent ("both `main/index.ts` and `main/menu.ts` depend on `preload/api.ts`, never the reverse"), even though it doesn't violate the letter of guardrail #92. Minimal fix: import `ViewSettings` directly from `../preload/api` in `index.ts` (and in `tests/unit/menu.test.ts`, which has the same pattern), then delete the now-unnecessary re-export line from `menu.ts`.

## 6. Guardrail #89 — menu/click round-trip (highest-risk item)

`git diff -- src/renderer/renderer.js`, click handlers and shared function:
```js
const applyTab = (tab) => {
  if (tabPreviewEl) tabPreviewEl.classList.toggle('active', tab === 'preview');
  if (tabCodeEl) tabCodeEl.classList.toggle('active', tab === 'code');
  if (container) container.hidden = tab !== 'preview';
  if (codeContentEl) codeContentEl.hidden = tab !== 'code';
};

if (tabPreviewEl) {
  tabPreviewEl.addEventListener('click', () => {
    applyTab('preview');
    window.mdview.selectTab('preview');
  });
}
if (tabCodeEl) {
  tabCodeEl.addEventListener('click', () => {
    applyTab('code');
    window.mdview.selectTab('code');
  });
}
...
window.mdview.onViewSettings((settings) => {
  document.body.classList.toggle('tree-panel-hidden', !settings.showTreePanel);
  applyTab(settings.currentTab);   // never calls selectTab here — no feedback loop
});
```
Confirmed: click handler both updates local DOM (`applyTab`) **and** notifies main (`window.mdview.selectTab`, which sends `IPC_CHANNELS.SELECT_TAB`). `onViewSettings` calls the *same* `applyTab` function but never calls `selectTab`, so the two paths structurally cannot drift.

`git diff -- src/main/index.ts`:
```ts
ipcMain.on(IPC_CHANNELS.SELECT_TAB, (_e, tab: DocumentTab) => setCurrentTab(tab));
```
`setCurrentTab` updates `viewSettings.currentTab`, broadcasts, and calls `applyMenu()` (which rebuilds the native `Menu`, setting `checked` on `menu-view-preview`/`menu-view-code`).

**Round-trip test, read in full** (`tests/e2e/ui-shell.spec.ts`):
```ts
test('clicking #tab-code directly, then opening the View menu, shows "Code" checked (menu/click round-trip)', async ({ electronApp }) => {
  ...
  await window.locator('#tab-code').click();
  await expect(window.locator('#code-content')).toBeVisible();

  const checkedState = await electronApp.evaluate(({ Menu }) => ({
    code: Menu.getApplicationMenu()?.getMenuItemById('menu-view-code')?.checked,
    preview: Menu.getApplicationMenu()?.getMenuItemById('menu-view-preview')?.checked,
  }));

  expect(checkedState.code).toBe(true);
  expect(checkedState.preview).toBe(false);
});
```
This is a real round-trip proof: it drives the renderer button, then reads the *actual Electron `Menu` object's* `checked` property directly via `electronApp.evaluate`, which can only be `true` if the renderer click genuinely reached main (via IPC → `setCurrentTab` → `applyMenu`). A companion test proves the reverse direction (menu selection → visible tab updates).

**No bug found.** (Fault-injection to force a RED was attempted but blocked by the reviewer's read-only sandbox as expected; the verdict rests on direct code + test reading only.)

## 7. Guardrail #88 — session-scoping, default `'preview'`, never persisted

`git diff -- src/main/index.ts`:
```diff
-let viewSettings: ViewSettings = { darkMode: false, showFrontmatter: true, showTreePanel: true };
+let viewSettings: ViewSettings = {
+  darkMode: false,
+  showFrontmatter: true,
+  showTreePanel: true,
+  currentTab: 'preview',
+};
```
Same in-memory `let` object, same pattern as `darkMode`/`showFrontmatter`/`showTreePanel`. No file/config write of `viewSettings` found anywhere in `src/main/index.ts`.

**Nit N-2:** unlike `darkMode`, there is no dedicated regression test extending `tests/e2e/view-menu.spec.ts`'s close-and-relaunch test to also flip `currentTab` before relaunch and assert it resets. Not a spec deviation (not explicitly required by the Test Plan), but a coverage gap relative to the sibling fields.

## 8. Full test suite — executed by the reviewer, raw output cited

Guardrail #93 pre-check, reproduced independently:
```
node -e "const hljs=require('highlight.js'); console.log(!!hljs.getLanguage('markdown'));"
=> true
node -e "console.log(require('highlight.js/package.json').version)"
=> 11.11.1
```
Matches the brief's claimed evidence exactly.

Unit + Integration (`npx vitest run tests/unit tests/integration`):
```
Test Files  22 passed (22)
     Tests  130 passed (130)
```
(`tests/unit/markdown.test.ts` 14/14, `tests/unit/menu.test.ts` 24/24, `tests/integration/preload-api-contract.test.ts` 11/11 — all included and green.)

Targeted e2e (`npx playwright test tests/e2e/ui-shell.spec.ts tests/e2e/window-chrome.spec.ts`):
```
27 passed (56.4s)
```
Full e2e suite (`npm run test:e2e`, all 14 spec files):
```
97 passed (2.8m)
[exited with code 0]
```
Zero failures anywhere, including all pre-existing tiers and all 6 new Task 32 tests. `97 = 93 (Task 31's last-known-good full-suite count) + 4` net new Task 32 e2e tests — internally consistent with `review_report_task31.md`'s own cited baseline.

## 9. Scope-amendment hygiene (`tests/unit/menu.test.ts`, `tests/e2e/window-chrome.spec.ts`)

`git diff -- src/main/menu.ts` (View submenu build order): `menu-dark-mode`, `menu-show-frontmatter`, `menu-show-tree-panel`, separator, `menu-view-preview`, `menu-view-code`.

`tests/unit/menu.test.ts` diff:
```ts
expect(viewSubmenu).toHaveLength(6);
expect(viewSubmenu[0].id).toBe('menu-dark-mode');
expect(viewSubmenu[1].id).toBe('menu-show-frontmatter');
expect(viewSubmenu[2].id).toBe('menu-show-tree-panel');
expect(viewSubmenu[3].type).toBe('separator');
expect(viewSubmenu[3].id).toBeUndefined();
expect(viewSubmenu[4].id).toBe('menu-view-preview');
expect(viewSubmenu[5].id).toBe('menu-view-code');
```
`tests/e2e/window-chrome.spec.ts` diff (both popup-menu-ids tests):
```ts
expect(viewItemIds).toEqual([
  'menu-dark-mode', 'menu-show-frontmatter', 'menu-show-tree-panel',
  'separator', 'menu-view-preview', 'menu-view-code',
]);
```
Both match `menu.ts`'s real array order exactly, index-for-index — not superficially patched. Both files pass. New radio-item behavior tests (`checked` reflects `currentTab`, `click` invokes `onSelectTab` with the right value) were also added to `menu.test.ts` and pass.

**Should-fix S-2 (process hygiene):** No `.agents/DEVLOG.md` entry exists for Task 32. Every task from Task 24 through Task 31 has one. This project's own established discipline uses DEVLOG entries specifically to narrate exactly this kind of thing — a mid-task scope amendment (the addition of `tests/unit/menu.test.ts` and `tests/e2e/window-chrome.spec.ts` to `current_scope.json` after the View-menu change broke their pre-existing exact-count assertions). There was zero paper trail for this at review time. Not a functional defect, but a real regression in delivery hygiene relative to this project's own unbroken precedent.

## 10. General code quality

- The `highlightAuto` fallback branch in `highlightMarkdownSource` is unreachable today (guardrail #93 pre-check confirms `hljs.getLanguage('markdown')` is always truthy for this pinned version) — explicitly documented as an intentional, approved dead branch; not flagged as a defect.
- No unhandled edge case found in `applyTab`/`setCurrentTab`: both are guarded with `if (el)`/check-then-act patterns consistent with the rest of the file.
- `viewSettings`'s `currentTab` field is never read/written anywhere else in the diff outside the reviewed call sites — no duplicate concept found.
- See S-1 above for the one real architecture inconsistency found (mixed import sourcing for `ViewSettings` vs. `DocumentTab`).

---

## Findings

**Blocking: 0**

**Should-fix (2):**
- **S-1** — `src/main/index.ts` imports `ViewSettings` via `src/main/menu.ts`'s re-export while importing the sibling type `DocumentTab` directly from `src/preload/api.ts` — two import paths into one canonical interface family, contradicting the plan's own stated "never the reverse" intent (guardrail #92's literal wording is still satisfied). Fix: import `ViewSettings` directly from `../preload/api` in `index.ts` and in `tests/unit/menu.test.ts`, then delete the re-export line from `menu.ts`.
- **S-2** — No `.agents/DEVLOG.md` entry for Task 32, breaking this project's unbroken Task 24–31 precedent, and leaving the mid-task scope amendment with zero recorded rationale.

**Nit (3):**
- **N-1** — Guardrail #87's lock-in test was specified as a `markdown.test.ts` `renderFile` fixture test but implemented as an e2e test instead (defensible substitution, undocumented deviation).
- **N-2** — Guardrail #88 (`currentTab` never persisted) has no dedicated close-and-relaunch regression test the way `darkMode` does.
- **N-3** — `describe('Task 33: codeHtml field / SELECT_TAB channel')` is mislabeled relative to this project's actual Task 32 numbering — already explicitly flagged and explained in `initial_scaffold.md`'s own "Presented-to-user note," not an engineer defect, listed here only for completeness.

## Summary

All seven functional guardrails (#87–93) were independently re-derived against the real diff and real running app, with executed tests and raw output cited throughout. Full regression suite: 130 unit+integration tests and 97 e2e tests, all executed directly by the reviewer, all green, zero regressions. Scope contract matches the touched-file list exactly.

**Overall verdict: PASS.** No blocking defects were found; the two Should-fix items (S-1 architecture, S-2 missing DEVLOG entry) are real but do not violate any of the seven stated guardrails and do not warrant a fix-and-reverify round on their own — the Lead may route them as a small follow-up or accept them as documented technical debt.

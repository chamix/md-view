# Independent Code Review — Task 9: Dark-Mode Theme Stylesheet Resolution Fix

Verdict: **CLEAR TO SHIP**
Blocking findings: 0
Should-fix findings: 0
Nits: 1

Reviewed by: code-reviewer (independent verification layer, read-only tools).
Spec source of truth: `.agents/specs/functional_domain.md` §"Task 9: Dark-Mode Theme Stylesheet Resolution Fix"; `.agents/specs/initial_scaffold.md` §"Task 9 Technical Specification — Dark-Mode Theme Stylesheet Resolution Fix"; `.agents/current_scope.json` (closed/deleted after this review; contents preserved in the run log).

---

## Evidence trail

### 1. Touched-file list vs. scope contract

Scope contract's `in_scope`: `src/renderer/renderer.js`, `tests/e2e/view-menu.spec.ts`, `.agents/specs/decisions/ADR-004_md-view.md`.

`git status --porcelain` output:
```
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M src/renderer/renderer.js
 M tests/e2e/view-menu.spec.ts
?? .agents/current_scope.json
?? .agents/specs/decisions/ADR-004_md-view.md
```
The two spec-file modifications are the Lead's own pre-delegation edits (out of the implementer's scope per the task brief, confirmed by their content — both diffs are additive "Task 9" sections). Every file the implementer actually touched (`src/renderer/renderer.js`, `tests/e2e/view-menu.spec.ts`, new `ADR-004_md-view.md`) is on the granted list. `git diff --name-only -- src/main src/preload .agents/specs/backlog.md` returned empty — confirmed zero unexpected changes to main/preload or the backlog. Boundary contract: **compliant**.

### 2. `index.html` — zero diff, verified

`git diff -- src/renderer/index.html` produced no output. Read directly (`src/renderer/index.html:7-10`): the four theme `<link>` tags still carry their original relative, authored hrefs (`./github-markdown-light.css`, `./github-markdown-dark.css` with `disabled`, `./github.css`, `./github-dark.css` with `disabled`). Confirmed unchanged, matching the spec's explicit "index.html unchanged — out of scope" requirement.

### 3. `renderer.js` fix — matches the approved design exactly

Diff hunk (`src/renderer/renderer.js`):
```js
if (typeof document !== 'undefined') {
  const initialBaseURI = document.baseURI;

  const container = document.getElementById('content');
  ...
  const markdownLightLink = document.getElementById('theme-markdown-light');
  const markdownDarkLink = document.getElementById('theme-markdown-dark');
  const hljsLightLink = document.getElementById('theme-hljs-light');
  const hljsDarkLink = document.getElementById('theme-hljs-dark');

  [markdownLightLink, markdownDarkLink, hljsLightLink, hljsDarkLink].forEach((link) => {
    if (link) link.href = new URL(link.getAttribute('href'), initialBaseURI).href;
  });
  ...
  window.mdview.onFileRendered((message) => { ... });   // line 134
  window.mdview.onViewSettings((settings) => { ... });  // line 147
```
Checked against the three specific deviation risks called out in the delegation brief:
- **Captured before any IPC listener registration** — `initialBaseURI` is assigned on the first line of the block (line 34), before all four `getElementById` calls and long before `onFileRendered`/`onViewSettings` registration (lines 134, 147). No deviation.
- **Resolved against the correct base** — `new URL(link.getAttribute('href'), initialBaseURI).href`, i.e. resolved against the captured pre-file-open base, not the live (possibly-retargeted) `document.baseURI`. No deviation.
- **Reads the authored attribute, not the live property** — uses `link.getAttribute('href')`, not `link.href`. No deviation (this specifically avoids the double-resolution risk the spec called out).

No subtle deviations found. The implementation is a faithful, byte-level match of `initial_scaffold.md`'s authoritative code block.

### 4. Strengthened e2e test — assertions traced and confirmed non-trivial

`tests/e2e/view-menu.spec.ts`, test (c), new assertions:
```js
const contentColor = await content.evaluate((el) => window.getComputedStyle(el).color);
expect(contentColor).toBe('rgb(240, 246, 252)');   // = #f0f6fc, the real dark-palette .markdown-body color

for (const href of Object.values(linkHrefs)) {
  expect(href).not.toContain('tests/e2e/fixtures');
}

expect(consoleErrors).toEqual([]);
expect(failedRequests).toEqual([]);
```
Verified `rgb(240, 246, 252)` is the actual value, not an invented one: `github-markdown-css/github-markdown-dark.css` shows `color: #f0f6fc;` on `.markdown-body` — `0xf0=240, 0xf6=246, 0xfc=252` matches exactly. This is a real dark-palette value, not merely "differs from before."

### 5. Fault-injection proof — performed independently by the reviewer, not trusted from the implementer

Reverted the fix in `src/renderer/renderer.js` (removed the `.forEach` resolution block, restoring reliance on the raw relative `href`), rebuilt, and reran test (c) in isolation three separate ways:

**a) Full test (c), fix removed:**
```
Error: expect(received).toBe(expected)
Expected: "rgb(240, 246, 252)"
Received: "rgb(0, 0, 0)"
```
Exact signature the spec predicted ("browser-default black") — confirms the guardrail #4 failure mode.

**b) Color assertion skipped, href-anchoring check isolated, fix still removed:**
```
Error: expect(received).not.toContain(expected)
Expected substring: not "tests/e2e/fixtures"
Received string: "file:///C:/Source/md-view/tests/e2e/fixtures/with-frontmatter/github-markdown-light.css"
```
Confirms the href-anchoring assertion independently catches the regression (not redundant with the color check).

**c) Color + href checks skipped, console/network-error check isolated, fix still removed:**
```
Error: expect(received).toEqual(expected)
- Array []
+ Array ["Failed to load resource: net::ERR_FILE_NOT_FOUND", "Failed to load resource: net::ERR_FILE_NOT_FOUND"]
```
Confirms the console/network-error assertion independently catches the regression, and reproduces the literal `net::ERR_FILE_NOT_FOUND` signature named in the spec's Edge-Case Invariant Guardrail #4.

**d)** Fix and test file restored, `git diff --stat` confirmed byte-identical to the pre-injection diff, full suite rerun green (section 6).

Conclusion: all three strengthened assertions are real, non-tautological regression detectors — none would pass by accident against the broken code, individually or combined.

### 6. Full test suite — run directly by the reviewer

`npm run build`: exit 0, no errors.

`npm run test:all`:
```
test:unit         Test Files 10 passed (10) | Tests 55 passed (55)
test:integration  Test Files 3 passed (3)   | Tests 7 passed (7)
test:e2e          19 passed (28.8s)
```
Full e2e list, all passing: `app-launch`, `code-highlighting`, `live-reload` (×3), `external-links` (×2), `open-file-argv` (×3), `relative-images`, `ui-shell` (×3), `view-menu` (×5: a, b, c, d, e). Ran twice (once before fault-injection, once after restoring the fix) — both runs fully green, no flake observed in `view-menu.spec.ts` test (c).

### 7. ADR-004 — format and content check

`ADR-004_md-view.md` checked against `ADR-003_md-view.md`'s structure. Sections present in the same order: `## Status` (Accepted), `## Context`, `## Decision`, `## Alternatives considered`, `## Consequences`. Content accuracy checked against the approved spec:
- Context correctly cites the exact bug mechanism (Chromium deferred-fetch of `disabled` stylesheets + Task 4's `<base href>` retarget) and correctly notes the existing test's blind spot (only asserted `.disabled` flags + `document.body` background, not `.markdown-body`/`#content` color).
- Decision section reproduces the exact code block from `initial_scaffold.md`, including the `getAttribute('href')` vs. live `.href` rationale.
- Alternatives considered correctly restates the rejected `index.html`-touching alternative and its two rejection reasons (async-refactor fragility, out-of-scope `index.html` edit).
- Consequences section correctly names the three strengthened test dimensions (computed color, href anchoring, zero console/network errors).

No discrepancy found between ADR-004 and the approved spec's decision record.

### 8. Regression risk / test coverage of touched code

The only production-code change in this diff is the 8-line theme-link resolution block plus the 1-line `initialBaseURI` capture in `src/renderer/renderer.js`. Both are covered by the strengthened e2e test (c); no other function in the file changed (`applyRenderedContent`, `statusBarText`, `shouldShowFrontmatter`, `applyDarkMode` all show zero diff). No untested surface introduced by this diff.

---

## Findings

### Blocking
None.

### Should-fix
None.

### Nit
- N-1 — `.agents/current_scope.json` was still present on disk at review time; per CLAUDE.md Step 3 it is deleted once the contract closes (done by the Lead immediately after this report was written, to unblock writing the report itself under the enforce-scope hook). No bearing on code correctness.

---

## Test quality assessment

The three new assertions in test (c) assert real, specific behavior (an exact dark-palette RGB value, a real href-substring anchoring check, and a zero-length error array), not mere call-presence or "differs from before." Fault injection proved each is individually capable of failing against the broken code with the historically-correct bug signature (`net::ERR_FILE_NOT_FOUND`, browser-default black). No tautological tests found in this diff.

## Regression risk

Zero — the only touched production file (`renderer.js`) is fully exercised by the strengthened e2e test, and `index.html` is provably unchanged (section 2).

---

## Files reviewed (absolute paths)

- C:\Source\md-view\.agents\specs\functional_domain.md
- C:\Source\md-view\.agents\specs\initial_scaffold.md
- C:\Source\md-view\src\renderer\renderer.js
- C:\Source\md-view\src\renderer\index.html
- C:\Source\md-view\tests\e2e\view-menu.spec.ts
- C:\Source\md-view\.agents\specs\decisions\ADR-004_md-view.md
- C:\Source\md-view\.agents\specs\decisions\ADR-003_md-view.md (comparison baseline)
- C:\Source\md-view\package.json

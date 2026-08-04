# Independent Code Review — Task 8: Dark Mode, Frontmatter Visibility, Bottom Margin

Verdict: APPROVE
Blocking findings: 0
Should-fix findings: 0
Nits: 2

Reviewed by: code-reviewer (independent verification layer, read-only tools).
Spec source of truth: .agents/specs/functional_domain.md section "Task 8: Dark Mode,
Frontmatter Visibility, Bottom Margin"; .agents/specs/initial_scaffold.md
section "Task 8 Technical Specification".

---

## Evidence trail

### 1. Touched-file list vs. scope contract

.agents/current_scope.json was still present on disk (untracked) at review
time -- see Nit N-1 below -- but its contents matched the delegation:

in_scope: package.json, src/main/index.ts, src/main/menu.ts,
src/main/frontmatter.ts, src/preload/api.ts, src/preload/index.ts,
src/renderer/index.html, src/renderer/renderer.js, src/renderer/app.css,
tests/integration/preload-api-contract.test.ts, tests/unit/frontmatter.test.ts,
tests/unit/shouldShowFrontmatter.test.ts, tests/unit/menu.test.ts,
tests/e2e/view-menu.spec.ts, tests/e2e/fixtures/with-frontmatter/doc.md

git diff --name-only HEAD (modified) + git status --porcelain | grep '^??'
(new):

modified:  package.json, src/main/index.ts, src/main/menu.ts,
           src/preload/api.ts, src/preload/index.ts, src/renderer/app.css,
           src/renderer/index.html, src/renderer/renderer.js,
           tests/integration/preload-api-contract.test.ts, tests/unit/menu.test.ts
untracked: src/main/frontmatter.ts, tests/e2e/fixtures/with-frontmatter/,
           tests/e2e/view-menu.spec.ts, tests/unit/frontmatter.test.ts,
           tests/unit/shouldShowFrontmatter.test.ts
also present (pre-existing, unrelated): tests/test-content/ (was already
           untracked at session start per the original git status snapshot --
           not created by this diff)
also present: .agents/specs/functional_domain.md, .agents/specs/initial_scaffold.md
           (Lead's own spec-authoring edits, not the engineer's -- expected,
           pre-delegation additions of the Task 8 sections)

Every code/test file the engineer touched is on the granted list. No
out-of-scope file was written. Boundary contract: compliant.

### 2. Must-not-touch files -- verified zero diff

Command run:
git diff HEAD -- src/main/markdown.ts src/main/watcher.ts src/main/linkPolicy.ts src/main/paths.ts src/main/windowConfig.ts tests/e2e/ui-shell.spec.ts tests/e2e/open-file-argv.spec.ts tests/e2e/live-reload.spec.ts

Output: (no output -- zero diff on all eight files)

### 3. extractFrontmatter -- regex trace

src/main/frontmatter.ts (new file, full contents):

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function extractFrontmatter(source: string): FrontmatterSplit {
  const match = source.match(FRONTMATTER_PATTERN);
  if (!match) {
    return { frontmatter: null, body: source };
  }
  return { frontmatter: match[1], body: source.slice(match[0].length) };
}

This is a byte-for-byte match of the spec's authoritative signature
(initial_scaffold.md lines 935-943). Verified properties:
- No m flag -> ^ anchors to the literal start of the string only, never
  mid-document, satisfying guardrail #1/#2's "opening fence must be at
  position 0" requirement.
- Non-greedy [\s\S]*? before the mandatory \r?\n---\r?\n? closing token
  means an unterminated --- produces match === null -> { frontmatter:
  null, body: source }, fails closed structurally (not via a special case).

Traced against tests/unit/frontmatter.test.ts's 4 cases and confirmed by
actually running them (all green, see section 11). Case 4 is the required
"accepted ambiguity" guardrail-#1 test -- present, non-trivial, and
explicitly commented:

  it("accepted ambiguity (guardrail #1): a horizontal-rule/paragraph/horizontal-rule pattern matches the same fence pattern even though not intended as frontmatter -- this is intentional, convention-inherited behavior, not a bug", () => {
    const source = "---\n\nSome divider paragraph\n\n---\n\nMore text";
    const result = extractFrontmatter(source);
    expect(result.frontmatter).toBe("\nSome divider paragraph\n");
    expect(result.body).toBe("\nMore text");
  });

### 4. markdown.ts purity + body routing

markdown.ts has zero diff (section 2). src/main/index.ts diff:

   try {
     const source = await fs.readFile(filePath, 'utf8');
-    return { ok: true, filePath, html: markdownToHtml(source), baseUrl: baseUrlForFile(filePath) };
+    const { frontmatter, body } = extractFrontmatter(source);
+    return { ok: true, filePath, html: markdownToHtml(body), baseUrl: baseUrlForFile(filePath), frontmatter };

markdownToHtml now receives body (post-extraction), not raw source.
Confirmed correct.

### 5. buildMenuTemplate signature and View-menu checkbox wiring

git diff HEAD -- src/main/menu.ts shows the delivered code matches the
spec's authoritative block verbatim: ViewSettings/MenuHandlers interfaces,
buildMenuTemplate(handlers, initialViewSettings), both checkbox items with
type: 'checkbox', checked: initialViewSettings.darkMode /
.showFrontmatter, and:

  click: (menuItem) => handlers.onToggleDarkMode(menuItem.checked),
  click: (menuItem) => handlers.onToggleShowFrontmatter(menuItem.checked),

Not inverted, not called with no args -- the clicked item's own checked
boolean is threaded straight through. Proven (not just read) by
tests/unit/menu.test.ts's new cases, executed successfully:

  darkModeItem.click({ checked: true });
  expect(onToggleDarkMode).toHaveBeenCalledWith(true);
  ...
  showFrontmatterItem.click({ checked: false });
  expect(onToggleShowFrontmatter).toHaveBeenCalledWith(false);

Both directions (true and false) are covered across the two tests, ruling out
a hard-coded-true/inversion bug.

### 6. did-finish-load broadcast -- unconditional and separate

src/main/index.ts, app.whenReady().then(...) body (full excerpt read
directly):

  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate({...}, viewSettings)));

  // Unconditional and separate from the argv-conditional listener below...
  mainWindow?.webContents.once('did-finish-load', () => {
    broadcastViewSettings();
  });

  const filePath = argvFilePath();
  if (filePath !== null) {
    mainWindow?.webContents.once('did-finish-load', () => {
      renderAndWatch(filePath);
    });
  }

Two independent .once('did-finish-load', ...) registrations -- the
broadcastViewSettings one is registered unconditionally, outside and before
the if (filePath !== null) block, so it fires on every launch regardless of
argv. Not merged into the same callback, not gated on filePath !== null.
Confirmed empirically by e2e view-menu.spec.ts test (c) launching with a
file and successfully receiving/toggling ViewSettings and by ui-shell.spec.ts's
existing no-argv case still passing (section 11) -- both prove the broadcast
path is reachable in both argv states.

### 7. Toggling never touches render/watch pipeline

  function setDarkMode(checked: boolean): void {
    viewSettings = { ...viewSettings, darkMode: checked };
    broadcastViewSettings();
  }
  function setShowFrontmatter(checked: boolean): void {
    viewSettings = { ...viewSettings, showFrontmatter: checked };
    broadcastViewSettings();
  }

Grep confirms neither function's body contains renderFile, renderAndWatch,
startWatching, or stopWatching -- both are two-line functions that only
mutate the module-level viewSettings object and call broadcastViewSettings
(which only does mainWindow?.webContents.send(...)). e2e test (b) explicitly
asserts #content's text is byte-identical before/after the toggle,
proving no re-render occurred at runtime, not just by code inspection.

### 8. Dark Mode atomicity

src/renderer/renderer.js:

  const applyDarkMode = (isDark) => {
    if (markdownLightLink) markdownLightLink.disabled = isDark;
    if (markdownDarkLink) markdownDarkLink.disabled = !isDark;
    if (hljsLightLink) hljsLightLink.disabled = isDark;
    if (hljsDarkLink) hljsDarkLink.disabled = !isDark;
    document.body.classList.toggle('dark-mode', isDark);
  };

One function, five statements, all four link elements plus the body class
flipped together with no branch that updates a subset. This is the only call
site (window.mdview.onViewSettings((settings) => { ... applyDarkMode(settings.darkMode); ... }))
-- no other code path mutates these disabled properties or the dark-mode
class. e2e test (c) verifies all 4 link .disabled states plus a real
getComputedStyle(document.body).backgroundColor change in one assertion
block -- genuinely exercised, not just structurally present.

### 9. textContent, never innerHTML, for frontmatter

  frontmatterEl.textContent = lastMessage.frontmatter;

is the only assignment site for #frontmatter's content in the entire diff
(grepped -- no .innerHTML touches frontmatterEl anywhere). Comment directly
above it cites the guardrail explicitly.

### 10. No persistence

Command run:
grep -n "electron-store or localStorage or writeFile or fs.write" -R src/ tests/e2e/view-menu.spec.ts tests/unit/frontmatter.test.ts tests/unit/shouldShowFrontmatter.test.ts

Output: (no matches)

git diff HEAD -- package.json shows the only change is the build script's
CSS-copy list (light/dark markdown + light/dark hljs pairs) -- zero new
dependencies added, no storage-related package. viewSettings is a plain
module-level let in index.ts, reset to its literal default on every
process start.

### 11. Build + full test suite -- run directly, not trusted from the engineer

npm run build:
  tsc -p tsconfig.json && npx esbuild ... && node -e "...copy css..."
  dist/preload/index.js  680b
  Done in 10ms
  (exit 0, no tsc errors)

npm test (= npm run test:all = test:unit && test:integration && test:e2e):

  test:unit        -- Test Files 10 passed (10) | Tests 55 passed (55)   1.49s
  test:integration -- Test Files 3 passed (3)   | Tests 7 passed (7)     986ms
  test:e2e         -- 19 passed (23.1s)

Full raw list of the 19 e2e specs, all "ok": app-launch, code-highlighting,
live-reload (x3 cases), external-links (x2), relative-images,
open-file-argv (x3), ui-shell (x3), view-menu (x5: a, b, c, d, e).

Second independent full e2e run (npx playwright test), attempting to
reproduce the reported flake under the same 4-worker default:

  19 passed (22.9s)

Third targeted run isolating the historically-flaky spec,
npx playwright test tests/e2e/live-reload.spec.ts --repeat-each=3:

  9 passed (10.9s)

Flake was NOT reproduced across 3 full-suite-adjacent runs plus 3 repeats
of the specific flaky test. tests/e2e/live-reload.spec.ts has zero diff
(section 2), and .agents/specs/backlog.md line 10 confirms this is a
pre-existing, already-documented item ("Flaky e2e: live-reload.spec.ts's
primer test... failed intermittently under 4-worker parallel load during
Task 6's review... reproduced as green on two subsequent reruns... not a
Task 6 regression") predating this task by two features. The engineer's
claim is consistent with the evidence gathered independently; treated as
verified, not merely restated.

### 12. Relaunch test (case d) -- genuine second process

tests/e2e/view-menu.spec.ts, test "(d)":

  await app.close();
  const secondApp = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js'), fixturePath],
    env: childEnv,
  });
  const secondWindow = await secondApp.firstWindow();
  ...
  const checkedAfterRelaunch = await secondApp.evaluate(
    ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-dark-mode')?.checked
  );
  expect(checkedAfterRelaunch).toBe(false);

Confirmed: app.close() is called before the second, independent
electron.launch() -- a fresh OS process, not merely re-reading state within
the first still-running instance. This genuinely proves guardrail #6
(no persistence) rather than testing a no-op.

---

## Findings

### Blocking
None.

### Should-fix
None.

### Nit
- N-1 -- current_scope.json was not actually deleted. The task
  instructions stated the scope contract was "now deleted since the contract
  is closed," but git status --porcelain shows it as an untracked file
  still present on disk at review time, with contents matching the Task 8
  delegation. This has no bearing on code correctness (the PreToolUse hook
  would still have been enforcing it during implementation), but per
  CLAUDE.md Step 3 ("Delete .agents/current_scope.json -- the contract is
  closed"), the Lead should delete it before starting the next task to avoid
  the documented stale-manifest warning condition blocking future work.
- N-2 -- Backlog cleanup (Step 3) not yet applied. .agents/specs/backlog.md
  still contains the "Dark mode" bullet (lines 3-8) that
  initial_scaffold.md's Task 8 spec explicitly says to remove once this
  lands ("Backlog cleanup (Step 3, not part of the code diff)"). This is
  correctly out of the engineer's code-diff scope per the spec's own framing,
  but it is an open action item for the Lead's Step 3 delivery, not the
  engineer.

---

## Test quality assessment (checklist item 4)

The new/extended unit tests assert real behavior, not call-presence alone:
- frontmatter.test.ts asserts exact string values of both frontmatter and
  body fields (not just "no error thrown" or "returns an object").
- shouldShowFrontmatter.test.ts covers all 7 spec-mandated cases including
  both null-input branches and the error-variant branch.
- menu.test.ts's click-wiring tests assert toHaveBeenCalledWith(<specific
  boolean>), which would fail on an inverted or arg-dropped handler -- not a
  tautological "was called" assertion.
- e2e test (b) asserts #content's text is byte-identical across the toggle
  (proves no re-render), test (c) asserts both DOM attribute state and a real
  computed CSS property (proves genuine visual effect, not just class
  presence), and test (d) uses a truly independent second process (proves
  non-persistence is real, not an untested default).

No tautological tests were found in this diff.

## Regression risk (checklist item 5)

src/main/index.ts's new orchestration code (viewSettings,
broadcastViewSettings, setDarkMode, setShowFrontmatter, the
unconditional did-finish-load hook) is not unit-tested directly --
consistent with the established, spec-acknowledged precedent since Task 2
that main/index.ts's app.whenReady()-triggering side effects make it
unsuitable for isolated unit tests, and is covered instead by
view-menu.spec.ts's e2e suite. This mirrors the same tradeoff already
accepted and reviewed for renderFile/renderAndWatch/openFileViaDialog in
prior tasks -- not a new or task-8-specific gap.

---

## Files reviewed (absolute paths)

- C:\Source\md-view\.agents\specs\functional_domain.md
- C:\Source\md-view\.agents\specs\initial_scaffold.md
- C:\Source\md-view\.agents\current_scope.json
- C:\Source\md-view\src\main\frontmatter.ts
- C:\Source\md-view\src\main\index.ts
- C:\Source\md-view\src\main\menu.ts
- C:\Source\md-view\src\preload\api.ts
- C:\Source\md-view\src\preload\index.ts
- C:\Source\md-view\src\renderer\index.html
- C:\Source\md-view\src\renderer\renderer.js
- C:\Source\md-view\src\renderer\app.css
- C:\Source\md-view\package.json
- C:\Source\md-view\tests\unit\frontmatter.test.ts
- C:\Source\md-view\tests\unit\shouldShowFrontmatter.test.ts
- C:\Source\md-view\tests\unit\menu.test.ts
- C:\Source\md-view\tests\integration\preload-api-contract.test.ts
- C:\Source\md-view\tests\e2e\view-menu.spec.ts
- C:\Source\md-view\tests\e2e\fixtures\with-frontmatter\doc.md
- C:\Source\md-view\.agents\specs\backlog.md

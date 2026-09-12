# Task 37 Independent Review — Configuration Subsystem (settings.json)

**Reviewer:** code-reviewer subagent (read-only: Read/Grep/Glob/Bash)
**Branch reviewed:** `feature/037-settings-persistence` (working tree vs. `main`; no commits yet on this branch beyond `main`'s tip `e3d6e6c`)
**Verdict: PASS — 0 Blocking findings.**

---

## 0. Scope compliance

`git diff --name-only main` (modified) + `git ls-files --others --exclude-standard` (new/untracked), compared against `.agents/current_scope.json`'s `in_scope` array:

Modified: `.agents/metrics/test-tier-invocations.ndjson`, `.agents/specs/functional_domain.md`, `.agents/specs/initial_scaffold.md`, `README.md`, `package-lock.json`, `package.json`, `src/main/help/help.md`, `src/main/index.ts`, `src/main/menu.ts`, `tests/e2e/support/fixtures.ts`, `tests/e2e/view-menu.spec.ts`, `tests/e2e/window-chrome.spec.ts`, `tests/integration/fileTree.test.ts`, `tests/unit/menu.test.ts`

New/untracked: `.agents/current_scope.json`, `.agents/specs/decisions/ADR-008_md-view.md`, `src/main/settings.ts`, `src/main/settingsStore.ts`, `tests/e2e/settings-menu.spec.ts`, `tests/integration/settingsStore.test.ts`, `tests/unit/settings.test.ts`

All of these appear in `current_scope.json`'s `in_scope` list except `.agents/specs/functional_domain.md`, `.agents/specs/initial_scaffold.md`, `.agents/specs/decisions/ADR-008_md-view.md`, and `.agents/metrics/test-tier-invocations.ndjson`. These four are not implementation files -- they are the Lead's own Step 0/Step 1 spec-authoring artifacts (functional domain + technical scaffold + the ADR the scaffold's own "Governance note" says must be written before any other file in this task's scope is touched) and an append-only metrics log, none of which the full-stack-engineer subagent should be touching per the delegation workflow. Not a scope violation by the engineer. No out-of-scope engineering changes found.

---

## 1. npm run test:unit -- raw output

```
Test Files  20 passed (20)
     Tests  120 passed (120)
```
(tests/unit/settings.test.ts -- 8/8 passed; tests/unit/menu.test.ts -- 24/24 passed, including the resized-submenu assertions.)

## 2. npm run test:integration -- raw output

```
Test Files  5 passed (5)
     Tests  36 passed (36)
```
(tests/integration/settingsStore.test.ts -- 12/12 passed; tests/integration/fileTree.test.ts -- 5/5 passed, confirming the app.getPath mock fix doesn't regress anything.)

## 3. npm run test:e2e (full build && playwright test) -- raw output

```
Running 103 tests using 2 workers
...
103 passed (2.4m)
[exited with code 0]
```
No failures, no Electron worker-process crash (the documented playwright.config.ts flake class did not manifest in this run -- no rerun-in-isolation was needed since nothing failed).

## 4. npm run test:all (unit -> integration -> e2e, single authoritative run performed last, after the fault-injection round below was fully reverted and confirmed clean via git status)

```
test:unit:        Test Files  20 passed (20)  |  Tests 120 passed (120)
test:integration:  Test Files  5 passed (5)   |  Tests  36 passed (36)
test:e2e:          103 passed (2.1m)
[exited with code 0]
```

This is the verdict-gate run. All three tiers green, in full, on a working tree confirmed byte-identical to the reviewed diff (git status --short before this run showed only the expected modified/untracked file set, no leftover fault-injection edits).

---

## Checklist items (11 required points)

**1. parseSettings's .strict() schema (src/main/settings.ts lines 7-17):**
```ts
const settingsSchema = z
  .object({
    View: z
      .object({
        'Dark Mode': z.boolean(),
        'Show Frontmatter': z.boolean(),
        'Show File Tree': z.boolean(),
      })
      .strict(),
  })
  .strict();
```
.strict() present at both the outer object and the nested View object, read directly from source -- confirms guardrail #104 (wrong types / missing keys / extra keys all rejected) is structurally enforced, not just asserted by a test name. parseSettings (lines 30-40) folds JSON.parse syntax errors and safeParse schema failures into one null result, matching "one pass/fail question, never distinguishes bad JSON from bad shape."

**2. Startup vs. refocus asymmetry (guardrail #103) -- src/main/settingsStore.ts:**
- loadSettingsAtStartup (lines 16-29): missing file -> catch block returns defaultSettingsFile with NO writeSettingsFile call in that branch (self-heal only fires on the parse-failure branch, lines 24-28, which does call writeSettingsFile). Confirmed directly by reading the function body -- the missing-file catch block and the parse-failure branch are two textually distinct code paths, only the latter writes.
- rereadSettingsOnFocus (lines 35-44): any read failure -> return null immediately; a read that parses but fails schema -> parseSettings itself returns null, propagated straight through. No fs.writeFile/writeSettingsFile call anywhere in this function, and the caller (onWindowFocus in index.ts) returns immediately on null before touching viewSettings, broadcastViewSettings(), or applyMenu() (src/main/index.ts lines ~119-121: if (result === null) return;).
- Integration tests directly exercise this: settingsStore.test.ts "returns defaults with no disk write when the file is missing entirely" (asserts fs.existsSync(settingsFilePath) === false after loadSettingsAtStartup) and "returns null and never writes when the file is missing" / "...leaves a corrupt...file byte-for-byte unchanged" for rereadSettingsOnFocus -- all passing (see raw output above).

**3. No partial recovery (guardrail #104):** confirmed via direct schema read (item 1 above) plus the passing "wrong value types" / "missing a required key" / "extra/unknown key" unit tests and the fault-injection RED/GREEN proof (item 7 below), which specifically targets this branch.

**4. ensureSettingsFileExists (settingsStore.ts lines 48-55):**
```ts
export async function ensureSettingsFileExists(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
    return;
  } catch {
    await writeSettingsFile(filePath, defaultSettingsFile);
  }
}
```
Existence-only (fs.access, no read/parse at all) -- never touches content, even invalid content. Confirmed by the passing integration test "leaves an existing, even corrupt, file completely untouched" and the e2e test "File -> Settings does not recreate/overwrite an already-existing settings.json" (both green in the runs above).

**5. Guardrail #106 (full-object persistence on every toggle) -- src/main/index.ts diff:**
```ts
async function setDarkMode(checked: boolean): Promise<void> {
  viewSettings = { ...viewSettings, darkMode: checked };
  broadcastViewSettings();
  await persistCurrentViewSettings();
}
```
identical shape for setShowFrontmatter/setShowTreePanel. persistCurrentViewSettings() calls writeSettingsFile(settingsFilePath, fromViewSettings(viewSettings)) -- the entire current viewSettings object, not a single key -- confirmed by reading the helper and by e2e test (g) "toggling a View setting immediately persists the full settings object to settings.json," which reads settings.json off disk after a single toggle and asserts all three keys' values, passed in the run above.

**6. Guardrail #105 (shell.openPath fixed path, no renderer exposure):**
```
$ grep -n "shell.openPath" src/main/index.ts
113:  await shell.openPath(settingsFilePath);
```
Exactly one call site, using the module-level settingsFilePath computed once in app.whenReady() from path.join(app.getPath('userData'), 'settings.json') -- never a parameter, never renderer-sourced. git diff main -- src/preload/api.ts is empty (confirmed in item 8 below) -- no new IPC channel was added that could hand this path (or any path) to the renderer.

**7. Fault-injection proof (schema-validation branch is load-bearing):**
Edited src/main/settings.ts's parseSettings in place to skip .safeParse entirely:
```ts
return parsedJson as SettingsFile; // FAULT INJECTION: skip schema validation entirely
```
RED -- npx vitest run tests/unit/settings.test.ts tests/integration/settingsStore.test.ts:
```
FAIL tests/integration/settingsStore.test.ts > loadSettingsAtStartup > returns defaults AND rewrites the file to valid defaults when the on-disk content is valid JSON but the wrong shape
FAIL tests/integration/settingsStore.test.ts > rereadSettingsOnFocus > returns null AND leaves an on-disk file with a valid-JSON-but-wrong-shape byte-for-byte unchanged
FAIL tests/unit/settings.test.ts > parseSettings (pure JSON+schema validation) > returns null for valid JSON with the wrong value types
FAIL tests/unit/settings.test.ts > parseSettings (pure JSON+schema validation) > returns null for valid JSON missing a required key
FAIL tests/unit/settings.test.ts > parseSettings (pure JSON+schema validation) > returns null for valid JSON with an extra/unknown key
Test Files  2 failed (2)
     Tests  5 failed | 15 passed (20)
```
Exactly the wrong-shape cases go RED (the JSON-syntax-error cases, e.g. "returns null for a string that is not valid JSON at all," stayed green -- proving JSON.parse's own try/catch is a separate, still-intact guard, and that the schema branch specifically is what's being exercised).

GREEN -- restored the original file from a pre-edit backup copy, verified byte-identical (diff reported no differences), re-ran the same two files:
```
Test Files  2 passed (2)
     Tests  20 passed (20)
```
git status --short afterward showed src/main/settings.ts still untracked/unmodified relative to the reviewed diff -- no residue from the fault injection went into the final test:all gate run.

**8. No unnecessary preload/renderer changes:**
```
$ git diff main -- src/preload/api.ts src/preload/index.ts src/renderer/renderer.js
(empty)
```
All three files are byte-identical to main. Separately read src/renderer/renderer.js lines 249-261 -- the existing onViewSettings handler:
```js
window.mdview.onViewSettings((settings) => {
  lastViewSettings = settings;
  applyDarkMode(settings.darkMode);
  updateFrontmatterVisibility();
  document.body.classList.toggle('tree-panel-hidden', !settings.showTreePanel);
  applyTab(settings.currentTab);
});
```
confirms it already applies dark mode, frontmatter visibility, and tree-panel visibility idempotently on every broadcast -- exactly the claimed "zero new renderer code needed" mechanism, verified by reading the real handler body, not trusting the spec's restatement of it.

**9. Menu-shape ripple -- tests/unit/menu.test.ts / tests/e2e/window-chrome.spec.ts vs. real buildMenuTemplate output:**
Read src/main/menu.ts's actual File submenu array (lines 22-34): menu-open, menu-open-folder, separator, menu-settings, separator, menu-exit -- 6 entries. tests/unit/menu.test.ts's diff updates the length assertion to 6 and indices 3/4/5 to menu-settings/separator/menu-exit respectively -- matches exactly. tests/e2e/window-chrome.spec.ts's diff updates both fileItemIds assertions (title-bar popup tests, two call sites) to the identical 6-entry array. tests/integration/fileTree.test.ts's mock gained getPath: () => '/tmp' on the app mock -- confirmed necessary and sufficient (test suite passed, no unhandled rejection observed in the raw output).

**10. tests/e2e/view-menu.spec.ts test (d) -- assertion-direction check:**
Read the actual current test body: title changed to "(d) close-and-relaunch proves view settings now persist via settings.json", the final assertion is expect(checkedAfterRelaunch).toBe(true) (previously false), and the surrounding comment block was rewritten to say "second launch reopens the SAME on-disk profile...which is what actually proves persistence rather than trivially passing" (no stale "proves no persistence" prose remains anywhere in the diff). Confirmed both by the diff hunk and by the fact this exact test passed in the full e2e run (ok 60/61 ... (d) close-and-relaunch proves view settings now persist via settings.json).

**11. userDataDir / --user-data-dir= Playwright fix -- verified against actual playwright-core source (not trusted from the diff's comment):**
node_modules/playwright-core/package.json confirms installed version 1.62.1, matching the comment's claim. Read Electron.launch() directly in node_modules/playwright-core/lib/coreBundle.js (~line 43973):
```js
async launch(progress2, options) {
  let app = void 0;
  let electronArguments = ["--inspect=0", "--remote-debugging-port=0", ...options.args || []];
  ...
```
electronArguments is built exclusively from options.args -- options.userDataDir is never read or forwarded anywhere in this function body. This directly confirms the engineer's claim that _electron.launch({ userDataDir }) is a no-op for the spawned process's argv in this Playwright version, and that the explicit --user-data-dir=${userDataDir} switch added to args in both tests/e2e/support/fixtures.ts and the two sequential launches inside tests/e2e/view-menu.spec.ts's test (d) is the actual load-bearing mechanism making app.getPath('userData') resolve to the per-test temp directory. The passing e2e run (test (d) and test (g), both of which depend on this) is consistent with the mechanism actually working end-to-end, not merely plausible in isolation.

---

## Additional spot checks

- **ADR-008** ('.agents/specs/decisions/ADR-008_md-view.md'): reviewed in full -- documents the zod decision with alternatives considered (hand-rolled guards, ajv, io-ts) and consequences. package.json/package-lock.json diff confirms zod: "^3.23.8" was added to dependencies (resolved to 3.25.76 in the lockfile) -- the actual dependency added matches the ADR's decision, not some other validation library.
- **v1 defaults**: src/main/settings.ts's defaultSettingsFile is `{ View: { 'Dark Mode': false, 'Show Frontmatter': true, 'Show File Tree': true } }` -- matches the spec's disclosed, confirmed-with-user defaults (not the illustrative true from the task brief's example JSON). Unit test "matches the confirmed v1 defaults" passes.
- **applyMenu() reuse, not MenuItem reference-holding**: onWindowFocus in src/main/index.ts calls applyMenu() (which internally does Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(menuHandlers(), viewSettings)))) rather than looking up and mutating a cached MenuItem.checked -- confirmed by reading the function body; no MenuItem references are stored anywhere in the diff. This matches the scaffold's explicitly disclosed deviation from the task brief's literal wording.
- **app.whenReady() ordering invariant**: await loadSettingsAtStartup(settingsFilePath) happens strictly before createWindow() in the diff (confirmed in the hunk), preserving the pre-existing "register did-finish-load listeners synchronously before any further await" invariant referenced in the code comment.

---

## Should-fix / Nit items

None identified. Test coverage, architecture boundaries (settings.ts has zero fs/electron imports -- confirmed by reading its full import list: only zod and a type-only import from ../preload/api; settingsStore.ts imports only node:fs/promises, node:path, and ./settings), and the Strategy/Adapter pattern application all match the approved scaffold as actually implemented, not merely as claimed.

---

## Verdict: PASS

0 Blocking, 0 Should-fix, 0 Nit. All three test tiers pass in a single, final, authoritative npm run test:all run performed after the fault-injection round was fully reverted and confirmed clean. All 11 requested verification points have direct, cited evidence above (diff hunks, raw test output, and direct third-party source reads for the Playwright claim). No scope violations. The Lead may proceed to Step 3 (Log & Deliver).

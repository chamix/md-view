# Review report: Task 46 (About window, third-party license notices, static-window CSP)

> **For the Lead:** save this verbatim to `.agents/specs/review_report_task46.md`.

- **Reviewer:** `code-reviewer` (independent; I did not write the spec or the code).
- **Branch:** `feature/046-about-window`. The uncommitted working tree is the implementation.
- **Base:** `main` @ `38cb06b`. `git merge-base HEAD main` = `38cb06b9d581881fcbe39318a47d1669a8d34e4a`.
- **Date:** 2026-09-26.

## Verdict: CHANGES REQUIRED (1 Blocking, narrowly scoped)

The implementation meets #169-#179 and approval conditions 1-8. Every required fault went RED for the reason claimed, and so did 11 of my own. The final `npm run test:all` is green, and the packaged app works.

One gap blocks delivery. The engineer added a double-open re-check to `onOpenAbout`. My probe shows the re-check is correct and actually needed: without it, two same-tick clicks open 2 About windows. But no test fails when it is removed (fault R4). New logic with no test that can tell it apart is Blocking under the review rubric. The fix is a single e2e test in an in-scope file.

## Findings (ranked)

| ID | Severity | Guardrail | Finding | Evidence |
|---|---|---|---|---|
| **B1** | **Blocking** | #169 ("at most one instance") | The re-check in `onOpenAbout` after `await Promise.all([...])` is new logic with no test that fails without it. Removing it keeps every test green, but two same-tick `menu-about` clicks then open **2** About windows, and the first one is orphaned from `aboutWindow`. **Fix (route to `full-stack-engineer`, scope `tests/e2e/about.spec.ts` only):** add a test that calls `getMenuItemById('menu-about').click()` twice inside ONE `electronApp.evaluate`, waits, and asserts exactly one window titled `About md-view`. This is deterministic: the second click's synchronous guard runs before the first click's file reads settle. Then confirm RED with the R4 patch (after `npm run build`) and GREEN after restoring. | Fault-injection table, R4. The race probe prints `About count = 1` with the re-check and `About count = 2` without it, while `about.spec.ts` stays at `8 passed`. |
| N1 | Non-blocking | #176 / #174 | When the generator fails, it writes nothing but also leaves the previous `dist/third-party-notices.json` in place. The build exits 1, so CI and release are blocked. However, a manual `npx electron-builder` after a failed local build would package the stale file. Suggest unlinking `out` on failure. | F6: `BUILD_EXIT=1`, and `sha1sum -c` on the dist file gives `OK` (unchanged). |
| N2 | Non-blocking | #173-#175 test design | The plan says F6 turns the "integration CLI fail-closed test" red. It doesn't, and can't: that test deletes `khroma` from a temp copy itself, so it cannot see the repo's override going missing. Under F6, what goes red is the build (exit 1, `khroma@2.1.0` named) and `two CLI runs … both equal dist/`. Fail-closed is still proven. This is a plan-table inaccuracy, not a code defect. | F6 output. |
| N3 | Nit | #170 test | `about.spec.ts` asserts `License` = `'MIT'` and the repo `href` as literals, although its header says expectations are "never typed". They match the plan text, but deriving both from `package.json` would be consistent. | `about.spec.ts:107-108` |
| N4 | Nit | #174 message clarity | npm normalizes an object `license: {type}` to a string in the lockfile (`@npmcli/arborist/lib/shrinkwrap.js:118-119`: "get only the license type, not the full object"). A legacy object license would therefore fail as `installed license … disagrees with the lockfile` rather than with the named "legacy object/array" error. It still fails closed; only the message differs. | Source read. |
| N5 | Nit | pre-existing, not a regression | Help has the same same-tick double-open race. Two clicks give `["md-view Help","md-view Help","md-view"]`. It existed at `main`: `onOpenHelp` already awaited `help.md` before creating the window, and Task 46 only adds a second await. It is out of scope; I suggest it as a backlog candidate alongside the `shouldCreate*Window` consolidation. | Help race probe output. |
| N6 | Process note | review method | `git apply -R` under `core.autocrlf=true` rewrote the LF file `src/main/thirdPartyNotices.ts` to CRLF. The content was identical apart from CR, but the bytes weren't. I restored the exact pre-fault bytes from the captured copy (sha `a74db6e1…` equals the step-1 snapshot). All later reverts used `git -c core.autocrlf=false apply -R`. The repo has no `.gitattributes`. I recommend adding `-c core.autocrlf=false` to the fault-injection procedure. No hook blocked anything at any point. | Section 8, R6. |
| PRE-1 | **Pre-existing defect, found and fixed (not a regression)** | #178 / condition 5 | **The static windows were never styled.** This has been true of Help since Task 14 and of What's New since Task 43. A `data:` document cannot load `file:` stylesheets, so the three `<link>`s never applied. D1 fixes it: embedded CSS pinned by hash. The condition-4 test guards against regression: F14 went RED at `static-window-csp.spec.ts:155` in all 3 windows, and the packaged app computes `-apple-system…` and `704px`. | F14; packaged probe. |

## Evidence

### 1. Scope

The step-1 snapshot of `git status --short --untracked-files=all`:
```
 M .agents/metrics/test-tier-invocations.ndjson
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M package.json
 M src/main/helpWindow.ts
 M src/main/index.ts
 M src/main/menu.ts
 M src/main/paths.ts
 M src/main/windowConfig.ts
 M tests/e2e/window-chrome.spec.ts
 M tests/unit/buildHelpHtml.test.ts
 M tests/unit/menu.test.ts
?? .agents/current_scope.json
?? .agents/specs/decisions/ADR-011_md-view.md
?? .agents/specs/decisions/ADR-012_md-view.md
?? build/third-party/fastdom@1.0.12.txt
?? build/third-party/khroma@2.1.0.txt
?? build/third-party/overrides.json
?? build/third-party/strictdom@1.0.1.txt
?? scripts/third-party-notices.mjs
?? src/main/aboutWindow.ts
?? src/main/thirdPartyNotices.ts
?? tests/e2e/about.spec.ts
?? tests/e2e/static-window-csp.spec.ts
?? tests/integration/dist-about.test.ts
?? tests/unit/aboutWindow.test.ts
?? tests/unit/staticPaths.test.ts
?? tests/unit/staticWindowOptions.test.ts
?? tests/unit/thirdPartyNotices.test.ts
```

The `git diff --stat` snapshot:
```
 12 files changed, 1323 insertions(+), 55 deletions(-)
```

- **In scope:** every engineer file matches `in_scope`. This includes `build/third-party/**` (4 files) and `tests/e2e/window-chrome.spec.ts`, which the amendment covers.
- **Accepted exceptions:**
  - `.agents/metrics/test-tier-invocations.ndjson`: written by the test hook, `37 0` (append-only).
  - The Lead's `functional_domain.md` (+151/-0), `initial_scaffold.md` (+869/-0), `ADR-011`, `ADR-012` and `current_scope.json`.
- **Zero diff where required.** `git diff --stat main -- package-lock.json LICENSE CHANGELOG.md README.md electron-builder.yml src/renderer src/preload tests/e2e tests/integration` lists only `tests/e2e/window-chrome.spec.ts | 4 ++--`. `git diff --name-only -- tests/e2e tests/integration` lists only `tests/e2e/window-chrome.spec.ts`. `package-lock.json` has 0 diff lines, so there is no new dependency (#179, D4). `.agents/specs/backlog.md` is unmodified (condition 6).

### 2. `window-chrome.spec.ts`: exactly two lines changed

`git diff --numstat` gives `2	2	tests/e2e/window-chrome.spec.ts`. The hunks:
```
@@ -257,7 +257,7 @@ test.describe('(d) title-bar menu labels popup the real, shared buildMenuTemplat
-    expect(helpItemIds).toEqual(['menu-help']);
+    expect(helpItemIds).toEqual(['menu-help', 'separator', 'menu-about']);
@@ -549,7 +549,7 @@ test.describe('(g) #title-bar stays fixed and remains functional while the page
-    expect(helpItemIds).toEqual(['menu-help']);
+    expect(helpItemIds).toEqual(['menu-help', 'separator', 'menu-about']);
```
These are the new lines 260 and 552. Nothing else in the file changed, so the change is within the amendment's limit.

### 3. CI

`.github/workflows/ci.yml` runs on pull requests to `main`, on `windows-latest`:
```
      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Run unit + integration tests
        run: |
          npm run test:unit
          npm run test:integration
```
`.github/workflows/release.yml` has the same `npm ci` → `npm run build` → unit and integration steps, then `npx electron-builder --win --publish always`.

The `build` script now ends with `… copyFileSync('LICENSE','dist/LICENSE')\" && node scripts/third-party-notices.mjs`. **So yes: CI runs `npm run build`, and a policy violation fails CI.**

- A missing or stale override, a disallowed license, a wrong citation or a text drift all make the generator return 1. The build step then fails, and the release job never reaches packaging.
- F6 demonstrates this: `third-party-notices: 2 violation(s); nothing written` and `BUILD_EXIT=1`.
- One CI nuance: Windows runners check out with `autocrlf=true`, and the override `.txt` files become CRLF. I tested that case (deviation b) and the output is byte-identical.

### 4. Test runs (raw summary lines)

My first gate run, before any fault:
- `npm run build`: `third-party-notices: 125 packages -> dist\third-party-notices.json`, EXIT=0.
- `npm run test:unit`: `Test Files  32 passed (32)` / `Tests  355 passed (355)`, UNIT_EXIT=0.
- `npm run test:integration`: `Test Files  9 passed (9)` / `Tests  77 passed (77)`, INT_EXIT=0.
- `npx playwright test` (full suite): `164 passed (3.7m)`, E2E_EXIT=0.

**Authoritative final run** of `npm run test:all`, made after all fault injections were reverted and the tree was confirmed byte-identical to the snapshot:
```
 Test Files  32 passed (32)
      Tests  355 passed (355)
 Test Files  9 passed (9)
      Tests  77 passed (77)
  164 passed (4.2m)
TESTALL_EXIT=0
```

**The `view-menu.spec.ts:189` flake** (`Unexpected end of JSON input`):
- **Settings write path untouched.** `git diff -- src/main/settingsStore.ts src/main/settings.ts` has 0 lines. The `index.ts` hunk headers (`git diff -U0`) are at imports, `aboutWindow` declaration, `menuHandlers`, static CSS/`createStaticWindow`, `loadStaticHtml`, `onOpenHelp`, the new About region and `showWhatsNewIfDue`. None of them touches settings persistence.
- **Did not reproduce** in either of my two full runs.
- **Re-runs of `tests/e2e/view-menu.spec.ts`:** run 1 `7 passed (12.3s)`, run 2 `7 passed (12.1s)`, run 3 `7 passed (12.7s)`.
- **Already logged.** `backlog.md` has a `[Pending]` entry from the Task 41 review. The root cause is the non-atomic `fs.writeFile` in `settingsStore.ts` combined with the test's second read after its poll.
- **Classification: not Blocking.** It is a pre-existing, logged contention flake outside this diff.

### 5. Guardrails #169-#179 and conditions 1-8

| Item | Verdict | Evidence |
|---|---|---|
| #169 static window, factory, lockdown | PASS (see B1 for the double-open test gap) | `createStaticWindow(size?)` calls `new BrowserWindow(staticWindowOptions(size))`. The lockdown body (`removeMenu`, `will-navigate` preventDefault, deny-all `setWindowOpenHandler`) is outside every diff hunk and appears verbatim in `dist/main/index.js:380-404`. `staticWindowOptions` **picks** the size (`...(size ? { width: size.width, height: size.height } : {})`) and writes `webPreferences: { ...defaultWindowOptions.webPreferences }` last. The unit cast-in test rejects the smuggled `webPreferences`, `preload`, `sandbox:false` and `frame`. `help-menu.spec.ts`, `whats-new.spec.ts` and `csp.spec.ts` have 0 diff and pass. The e2e tests cover no-menu Ctrl+O (with its main-window positive control), `window.open` denied, the link handed to `openExternal` with the URL unchanged, and `preload` null with `sandbox` true. |
| #170 single source | PASS | Sources: `app.getVersion()`, `process.versions.*`, shipped `package.json` via `packageJsonPathFor`, and `dist/LICENSE` via `parseCopyrightLine`. In `dist/main/aboutWindow.js` and `dist/main/thirdPartyNotices.js`, `year=0 ver=0`. The `md-view:about-window` marker region of `dist/main/index.js` is 49 lines with `year=0 ver=0`, and it contains `electron_1.app.getVersion()`. R9b (a year hardcoded in `aboutWindow.ts`) turns the dist test red. The packaged app shows `Version 1.1.0 = app.getVersion() 1.1.0` and `Copyright (c) 2026 Camilo Vera`, parsed from the shipped `LICENSE`. |
| #171 escaping | PASS | Every interpolation goes through `escapeHtml`, and `href` is double-quoted and escaped. `repositoryWebUrl` allows only http(s). R1 (allow any protocol) turns 5 tests red, including the `javascript:` one. R6 (unescaped notice text) turns `notice names … render inert` red. |
| #172 menu | PASS | The `menu.ts` hunk gives `[menu-help F1, separator, menu-about "About md-view" with no accelerator]`. Unit, e2e and both title-bar popup arrays agree. |
| #173 closure | PASS | 125 entries, including `@types/trusted-types@2.0.7 MIT` and nested `d3-array` `['2.12.1','3.2.4']`. It excludes `vitest`, `electron-builder` and `typescript`. The dist set-equality test derives its roots from the build script, not from the constant. R3 (skip `optionalDependencies`) turns 3 tests red, including `has exactly 125` and `@types/trusted-types`. |
| #174 policy | PASS | Allowlist: `MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, Python-2.0, Unlicense`, with no MPL/GPL/LGPL/AGPL/SSPL. Chosen licenses in the output: `MIT 80, ISC 33, BSD-3-Clause 7, Apache-2.0 2, BSD-2-Clause 1, Python-2.0 1, Unlicense 1`. Of those, **80 = 79 + khroma via override**, and **"bad chosen []"** (none). `dompurify 3.4.16 (MPL-2.0 OR Apache-2.0) -> Apache-2.0`, with files `['LICENSE','LICENSE-MPL']`. |
| #175 real text, overrides | PASS | **khroma:** `cmp build/third-party/khroma@2.1.0.txt node_modules/khroma/license` gives BYTE-EQUAL. **fastdom and strictdom:** each override equals the README's `## License` block (EOL-normalized, trimmed) according to `diff`. **Citations re-derived by me:** the upstream files at the pinned commits, fetched from raw.githubusercontent, give `khroma upstream == override (byte)`, `fastdom upstream README == installed README (byte)` and `strictdom upstream README == installed README (byte)`. **Registry:** fastdom `1.0.12 published 2024-02-20T08:03:43.427Z gitHead a7b9044…`, and GitHub API `No commit found for SHA: a7b9044…`. Commit `01524d7b…` is dated `2024-02-20T08:00:06Z`. khroma and strictdom `gitHead` equal the cited commits. **es-toolkit NOTICE:** `1698` bytes, `equal true`. `noticeFiles total 1`. |
| #176 reproducible, shipped | PASS | Output sorted by code-unit name (`true`). The two-CLI-runs byte-identity test passes. The packaged `app.asar` holds the notices file byte-equal to `dist/` (section 6). The CRLF-checkout simulation gives byte-identical output (deviation b). |
| #177 reachable, budget | PASS | Nested `<details>`. The budget test asserts < 1 048 576 characters. **Measured in the packaged app: `urlLen: 369339`**, with the summary `Third-party notices (125 packages)` and 125 inner entries. |
| #178 CSP | PASS | Exact string: ``default-src 'none'; style-src 'sha256-${sha256Base64}'; base-uri 'none'; form-action 'none'``. There is no `script-src` and no `'unsafe-inline'`. The hash and the `<style>` come from one `css` string, LF-normalized first (``const css = `${cssText.replace(/\r\n?/g, '\n')}\n${STATIC_LAYOUT_CSS}\n` ``). The meta sits immediately after charset. The `</style` guard throws. `.md-view-static` replaces the old inline `style=`. The e2e tests show zero violations, a blocked canary, the exact meta, `704px`, a non-default font, and a positive control (`<img src="data:,x">`) in all 3 windows. F1, F2, R2, R5 and R8 all go RED. |
| #179 nothing else | PASS | `src/preload` and `src/renderer` have 0 diff. No `ipcMain` in the hunks. `package-lock.json` has 0 diff. |
| D3 content guard | PASS | F13 turns `every section of dist/CHANGELOG.md` red on `<th style="text-align:left">`. |
| Cond. 1 (D1-D4) | PASS | See above. |
| Cond. 2 (Step 0 amended) | PASS | The `functional_domain.md` hunk has the amended preamble and #175 names all three overrides, including fastdom's `gitHead` and merge-commit evidence. |
| Cond. 3 (ADR-011 insertCSS) | PASS | ADR-011 weighs `insertCSS` (unstyled frame at `dom-ready`, factory lifecycle change) and chooses the hash. |
| Cond. 4 (measured-default font) | PASS | `measureDefaultFontFamily` uses a hidden probe window that is destroyed afterwards. F14 goes RED at `:155` in all 3 windows. |
| Cond. 5 (pre-existing bug) | Recorded | See PRE-1. |
| Cond. 6 (backlog candidate reported only) | PASS | `backlog.md` is unmodified. |
| Cond. 7 (review rules) | Done | F1, F2, F6, F13 and F14 plus 11 own faults. Build before every e2e or dist observation (one stale run was caught and discarded, see section 8). Reverts via `git apply -R`. asar commands run with a temp cwd. Backstop below. |
| Cond. 8 (ADRs Proposed) | PASS | Both ADRs have `## Status` = `Proposed (2026-09-26 …)`. |

### 6. Packaged check (#176)

- **Packaging:**
  - `npx electron-builder --dir --publish never -c.directories.output=C:\Users\ADMINI~1\AppData\Local\Temp\md-view-pkg-review`
  - Result: `EB_EXIT=0`.
- **asar commands ran with cwd `/tmp/md-view-pkg-review/x`.** `asar list` returned 2370 entries, including:
```
2305:\dist\LICENSE
2369:\dist\third-party-notices.json
2370:\package.json
```
- **No `node_modules\mermaid`.** `mermaid node_modules entries: 0`. The only mermaid entry is `\dist\renderer\mermaid.min.js`.
- **Extracted files (in the temp dir):** `packaged notices BYTE-EQUAL to dist/` and `packaged LICENSE BYTE-EQUAL to dist/LICENSE`.
- **Size:** `app.asar bytes: 16000668` (about 15.3 MiB).
- **Packaged exe launched** (plan step 4, not required by the brief). About showed:
```
"appGetVersion": "1.1.0", "urlLen": 369339, "summary": "Third-party notices (125 packages)", "inner": 125,
"Version": "1.1.0", "Copyright": "Copyright (c) 2026 Camilo Vera", "License": "MIT",
"Repository": "https://github.com/chamix/md-view", "Electron": "44.3.0", "Chromium": "152.0.7977.78", "Node.js": "24.20.0",
"font": "-apple-system, BlinkMacSystemFont, \"Sego", "maxWidth": "704px", "cspMessages": []
```
- **Temp output deleted.** `ls` of the directory gives `No such file or directory`. `git status --short package.json` still shows only the engineer's ` M`, so it was not clobbered.

### 7. Deviation verdicts

- **(a) What's New CSP capture via reload: ACCEPT.**
  - `reload()` re-navigates to the same `data:` URL, and the CSP lives in the document's own `<meta>`. So the reload is re-parsed under the identical policy, with the listener already attached.
  - It is equivalent in practice: the document is deterministic, and only the original first parse goes unobserved.
  - **Proven live on exactly this path.** Under F2, the What's New test captured the parse-time violation after reload (`Applying inline style violates … 'style-src 'sha256-6yhOx…''`). Under F1 its canary read `1`. The positive control (`<img>` → CSP message) also runs on this path inside `assertStaticWindowCsp`.
- **(b) LF normalization of override texts: ACCEPT.**
  - Only `source: "override"` texts are normalized. Package texts are reproduced verbatim (the es-toolkit NOTICE is byte-equal; khroma uses the package's own file).
  - The upstream texts at the pinned commits have `CR count: 0`, so the LF output *is* the upstream bytes (#175).
  - I converted all three `.txt` to CRLF, simulating a Windows CI checkout, and regenerated: `CRLF-checkout output BYTE-IDENTICAL to dist/third-party-notices.json` (#176). Without normalization, CI (Windows, autocrlf) and Linux builds would differ.
- **(c) The two extra fail-closed checks: ACCEPT.**
  - **Override-contradicts-declared:** this stops an override from relabelling a package that declares its own license. It is consistent with #175 ("never invented").
  - **Installed-vs-lockfile license:** this mirrors the plan's "Lockfile license = installed license" re-assertion.
  - **False-positive risk is low and always fails closed with a clear message.** An override for a package declaring an OR expression must repeat the expression exactly. For a legacy object license, see N4.
- **(d) Double-open re-check: the code is CORRECT; the test gap is B1.**
  - JS runs the check synchronously right before `createStaticWindow`, so there is no interleaving.
  - It cannot leak a window: the early return happens only when a live `aboutWindow` exists, and that window is then focused.
  - It cannot suppress a legitimate open: a failed attempt never assigns `aboutWindow`, and `closed` resets it to null.
  - Probe: with the re-check, 1 window; without it, 2 windows (a leaked orphan). No test notices the difference, hence B1.
- **Other deviations:**
  - **Extra pure exports: ACCEPT.** `buildAboutDocument` is shared by `onOpenAbout` and the budget test, so the budget measures the real document. `staticHtmlDataUrl` is shared by `loadStaticHtml` and the budget test, so there is one formula.
  - **Dist roots derived independently: ACCEPT, and stronger than planned.** The roots come from `extractCopiedPackages(pkg.scripts.build)` plus `dependencies`, and the test also asserts they equal `shippedRoots(pkg)`.
  - **Focus-on-reopen spy: ACCEPT.** It wraps and calls the original `focus`, so the count is deterministic.
  - **"URL unchanged" read from main: ACCEPT.** It follows the `external-links.spec.ts` precedent.
  - **Also noted:** What's New failure containment (#140) is preserved. `readStaticWindowCss()` or a `</style` throw inside `showWhatsNewIfDue` goes to the existing `.catch` at `index.ts:663`.

### 8. Fault injection

Method, for every fault:
- The pre-fault file was copied to the scratchpad.
- The fault delta alone was captured with `diff -u` and a/b labels.
- The fault was reverted with `git apply -R <patch>`; after N6, with `git -c core.autocrlf=false apply -R`.
- `cmp` against the pre-fault copy printed `REVERTED …: byte-identical to pre-fault copy (0-line diff)`.
- `npm run build` ran before every e2e or dist observation.

**Discarded run.** My first F2 attempt was a transform no-op, so the build was skipped and a targeted e2e ran against the stale F1 `dist/`. I discarded those results, rebuilt clean and redid F2.

| # | Fault (captured patch lines) | Tier | RED observed (raw) | Reverted |
|---|---|---|---|---|
| F1 | Remove the CSP `<meta>` from `buildHelpHtml` | unit + e2e | Unit: 4 failed, including `the CSP meta is the first element…`, `its content equals buildStaticWindowCsp(…)`, `has no script-src…` and `embeds CRLF…`. E2E: Help, About and What's New each fail with `expect(received).toBeUndefined() Received: 1` (canary ran). | yes, byte-identical |
| F2 | `-  const css = \`${cssText.replace(/\r\n?/g, '\n')}…` / `+  const css = \`${cssText}\n${STATIC_LAYOUT_CSS}\n\`` | unit + e2e | Unit: `embeds CRLF (and lone CR) CSS as LF and hashes the LF text`. E2E: all 3 windows fail with `"Applying inline style violates … 'style-src 'sha256-6yhOxouS3Rma8KPMoSO3+V88i3SHyW1Kvf+te6QDoVs=''. Either … a hash ('sha256-X/OnfPym0yIlyX8oaxk2S1ltIrNQpKyTgfVoCJ3reRU=') …"`. | yes |
| F6 | Delete `khroma@2.1.0` from `overrides.json` | build + integration | `third-party-notices: 2 violation(s); nothing written:` / `- khroma@2.1.0: no license field and no override` / `- khroma@2.1.0: license rejected: missing license field`, `BUILD_EXIT=1`. Integration: `two CLI runs into two temp dirs are byte-identical, and both equal dist/` fails. See N1 and N2. | yes, sha `130bf931…` equals the snapshot |
| F13 | Append `\| a \| b \|` / `\|:-\|-:\|` / `\| 1 \| 2 \|` to `CHANGELOG.md` | integration | `D3 content guard … > every section of dist/CHANGELOG.md` fails with `<th style="text-align:left">a</th>` | yes, immediately. `CHANGELOG vs HEAD diff lines: 0` |
| F14 | `-  return texts.join('\n');` / `+  return [texts][0].length ? "" : "";` (no CSS embedded at the `index.ts` call site) | e2e | Help, About and What's New each fail at `static-window-csp.spec.ts:155:35` with `expect(received).not.toBe(expected) Expected: not "\"Times New Roman\""` (measured default) | yes |
| R1 | `repositoryWebUrl`: `return protocol ? candidate : null` (allows `javascript:`) | unit | 5 failed, including `gives null for "javascript:alert(1)"` and `shows a non-http(s) repository as escaped text with no link` | yes |
| R2 | Drop `; base-uri 'none'` from the policy | unit | `buildStaticWindowCsp is exactly the approved policy shape` | yes |
| R3 | Remove the `optionalDependencies` edge loop | unit | `has exactly 125 packages`, `includes @types/trusted-types through the optional edge from dompurify`, `follows an installed optional dependency` | yes |
| **R4 (not in plan)** | Remove the double-open re-check in `onOpenAbout` (5 lines) | e2e + probe | **Nothing red.** `about.spec.ts`: `8 passed (17.0s)`. The probe shows `["About md-view","About md-view","md-view"] About count = 2` (with the re-check: `About count = 1`). This is **finding B1**. | yes |
| R5 | `</style` guard disabled (`if (false) {`) | unit | 3 failed: `throws when the CSS contains "</style>"`, `"</STYLE >"`, `"a</Style"` | yes |
| R6 | Drop `escapeHtml` on notice `<pre>` text | unit | `notice names, versions, licenses, citations and texts render inert` | yes (see N6: exact bytes restored from the pre-fault copy, sha equals the snapshot) |
| R7 (not in plan) | Spread the cast-in `size.webPreferences` into `webPreferences` | unit | `ignores anything cast into the size beyond width/height (webPreferences, preload, sandbox:false)` | yes |
| R8 (not in plan) | Move the CSP meta after `<title>`/`<style>` | unit | `the CSP meta is the first element after <meta charset>, before <title> and <style>` | yes |
| R9 (not in plan) | `parseCopyrightLine` returns the hardcoded `"Copyright (c) 2026 Camilo Vera"` | unit | `takes the first Copyright line, trimmed, across CRLF` and `buildAboutDocument … titles the document…`. The real-LICENSE unit test alone would stay green, which is why the dist test matters. | yes |
| R9b | The same fault, proven from `dist/` after `npm run build` | integration | `dist/main/aboutWindow.js holds no year and no version literal` | yes, then clean rebuild |
| EOL1-3 | Override `.txt` converted to CRLF (autocrlf checkout simulation) | CLI | Expected to stay GREEN, and did: `CRLF-checkout output BYTE-IDENTICAL to dist/third-party-notices.json` | yes, all 3 |

### 9. Backstop

At the end, `git status --short --untracked-files=all` matches the step-1 list in section 1 exactly: `== status diff vs step-1 snapshot: IDENTICAL`.

`git diff --stat` also matches, including the ndjson line (the hook did not append during my Bash-only session):
```
 .agents/metrics/test-tier-invocations.ndjson |  37 ++
 .agents/specs/functional_domain.md           | 151 +++++
 .agents/specs/initial_scaffold.md            | 869 +++++++++++++++++++++++++++
 package.json                                 |   2 +-
 src/main/helpWindow.ts                       |  44 +-
 src/main/index.ts                            | 102 +++-
 src/main/menu.ts                             |   8 +-
 src/main/paths.ts                            |  16 +
 src/main/windowConfig.ts                     |  17 +
 tests/e2e/window-chrome.spec.ts              |   4 +-
 tests/unit/buildHelpHtml.test.ts             | 110 +++-
 tests/unit/menu.test.ts                      |  18 +-
 12 files changed, 1323 insertions(+), 55 deletions(-)
== stat diff vs snapshot: IDENTICAL
```

- **Untracked content hashes:** 0 mismatches against the snapshot (`sha1sum -c`).
- **Tracked diff content** (excluding the ndjson): IDENTICAL to the snapshot patch.
- **Ignored directories:** only pre-existing ones, namely `coverage/` (2026-09-13), `release/` (2026-09-19), `node_modules/`, `dist/` (the clean rebuild) and `test-results/`. `test-results/` holds only Playwright's standard `.last-run.json`.
- **Temp output:** all packaging and probe output went to the OS temp dir and has been deleted. The helper scripts and patches live only in the session scratchpad.
- **Hooks:** none fired and none were bypassed.

### Relevant paths
- `C:\Source\md-view\src\main\index.ts`: `onOpenAbout`; the B1 re-check sits right after `buildAboutDocument(...)`.
- `C:\Source\md-view\tests\e2e\about.spec.ts`: where the B1 test belongs.
- `C:\Source\md-view\scripts\third-party-notices.mjs` (N1, N4).
- `C:\Source\md-view\src\main\helpWindow.ts`, `C:\Source\md-view\src\main\windowConfig.ts`, `C:\Source\md-view\src\main\aboutWindow.ts`, `C:\Source\md-view\src\main\thirdPartyNotices.ts`.
- `C:\Source\md-view\tests\e2e\static-window-csp.spec.ts`, `C:\Source\md-view\tests\integration\dist-about.test.ts`.

---

## Re-review: B1 fix (append verbatim to `.agents/specs/review_report_task46.md`)

- **Reviewer:** `code-reviewer`, independent.
- **Date:** 2026-09-26.
- **Scope:** verify the B1 fix only, with the same evidence rules as the main review.
- **Hooks:** none fired.
- **Reverts:** `git -c core.autocrlf=false apply -R` plus `cmp`.
- **asar:** not used this round.

### Re-review verdict: **APPROVE WITH NON-BLOCKING.** B1 is CLOSED.

### 1. Diff scope versus my original snapshot

`git status --short --untracked-files=all` diffed against the original snapshot shows one extra entry, the Lead's file:
```
15a16
> ?? .agents/specs/review_report_task46.md
```

The tracked diff, excluding the ndjson, is **IDENTICAL** to the snapshot patch. `git diff --stat` differs from the snapshot only in the hook line:
```
 .agents/metrics/test-tier-invocations.ndjson |  39 ++      (was 37: hook appends)
 12 files changed, 1325 insertions(+), 55 deletions(-)
```

`sha1sum -c` of the untracked snapshot hashes:
```
tests/e2e/about.spec.ts: FAILED
sha1sum: WARNING: 1 computed checksum did NOT match
```
All the other untracked files are OK.

**Proof that the only change to `about.spec.ts` is one inserted block.** Deleting the new lines 139-178 reproduces the snapshot hash exactly:
```
sed '139,178d' tests/e2e/about.spec.ts | sha1sum  ->  143c76bee663443cfa0b32bc904a755be87f9241
snapshot:                                             143c76bee663443cfa0b32bc904a755be87f9241
```

**`src/main/index.ts` is unchanged.** It hashes to `136a957a0c91ce31ab366a9c14f78650235d1e9f`, the same as my pre-fault copy from the original review (`R4.orig`).

**No `__tmp` file.** `find src -name '*__tmp*'` and a repo-wide `find` (excluding `node_modules`) both return nothing, and git status shows none.

**Loose blob: harmless, nothing to act on.**
- Exactly one loose object was written since my snapshot: `9f35f509195c28de3d4ccbcdff97b3c20de15f67 blob 32130B`.
- Its contents are byte-identical to the working `src/main/index.ts` (`cmp` gives `blob bytes == working index.ts`). It equals `git hash-object --no-filters src/main/index.ts`.
- `git log --all --find-object` returns nothing, so no commit, ref or index entry references it.
- It holds no new content, it is never pushed, and `git gc` prunes it after the default 2-week expiry. There is no need to act on it.

### 2. Reading the new test (`about.spec.ts:139`, "#169: two same-tick clicks open exactly one About window")

The test is **deterministic**, and I found no false-GREEN path:
- **Both `click()` calls run in one `electronApp.evaluate`, which is one main-process turn.** The second click's synchronous `shouldCreateAboutWindow` guard runs while `aboutWindow` is still `null`. So without the re-check a second window is guaranteed; the fault run below shows exactly that.
- **The load wait cannot pass before any About window exists.** The first poll requires `about.length > 0 && every !isLoading()`.
- **A late or untitled second window is still caught.** A freshly constructed window that hasn't loaded yet carries the app title (`md-view`), not `About md-view`. That case is caught by the final `toHaveLength(2)` on **all** windows, not only by the About-title count. The settle poll also requires every window to have finished loading before the snapshot.
- **The 1000 ms settle is generous.** Both handlers perform identical reads concurrently and create their windows milliseconds apart, and the RED run shows both windows fully titled within the window.
- **Failure messages are diagnostic.** Both assertions carry `JSON.stringify(titles)`.

### 3. R4 re-run (my own)

**Fault** (patch captured in the scratchpad, 5 lines removed):
```
-    // A second click during the reads above must not open a second window.
-    if (!shouldCreateAboutWindow(aboutWindow)) {
-      aboutWindow?.focus();
-      return;
-    }
```

**RED.** `BUILD=0`, and `grep -c "A second click" dist/main/index.js` returned `0`, confirming the fault was compiled:
```
  1) tests\e2e\about.spec.ts:139:5 › #169: two same-tick clicks open exactly one About window (re-check after the async reads)
    Error: ["About md-view","About md-view","md-view"]
    Expected length: 1
    Received length: 2
    Received array:  ["About md-view", "About md-view"]
  1 failed
```

**Revert:**
```
REVERTED src/main/index.ts: byte-identical to pre-fault copy (0-line diff)
136a957a0c91ce31ab366a9c14f78650235d1e9f *src/main/index.ts
```

**GREEN.** After `npm run build` (`BUILD=0`, marker count `1`):
```
run 1:   1 passed (3.0s)
run 2:   1 passed (3.1s)
run 3:   1 passed (3.1s)
run 4:   1 passed (3.5s)
```

### 4. Full gate

`npm run build`:
```
third-party-notices: 125 packages -> dist\third-party-notices.json
BUILD_EXIT=0
```

`npm run test:unit`:
```
 Test Files  32 passed (32)
      Tests  355 passed (355)
```

`npm run test:integration`:
```
 Test Files  9 passed (9)
      Tests  77 passed (77)
```

`npx playwright test`, run twice. Each run failed one different test outside Task 46's files; every Task 46 spec passed in both runs.
- **Run A:** `1 failed` / `164 passed (3.2m)`. The failure was `tests\e2e\view-menu.spec.ts:189:5 › (g) toggling a View setting immediately persists the full settings object to settings.json`. I did not capture its raw error text in that run.
- **Run B:** `1 failed` / `164 passed (3.5m)`. The failure was `tests\e2e\close-document.spec.ts:221:1 › (d) the title-bar File popup carries menu-close at index 2 …`, with `Error: electronApplication.evaluate: Target page, context or browser has been closed`. The Electron process died mid-test.

Classification of the two failures:
- **`view-menu.spec.ts:189`.** Targeted re-runs of the file: `7 passed (11.3s)`, `7 passed (11.6s)`, `7 passed (11.1s)`. `src/main/settingsStore.ts` and the test file have 0 diff against `main`. This is the known partial-read race logged `[Pending]` in `backlog.md` (Task 41 entry; related Task 43 EPERM note at :658-672). **Pre-existing, outside the diff, and non-blocking.**
- **`close-document.spec.ts:221`.** Targeted re-runs: `10 passed (20.6s)`, `10 passed (20.4s)`, `10 passed (20.9s)`. The file has 0 diff against `main`. This is a crash-class failure: the app was closed mid-test, and a different test failed in each run. It matches the parallel-contention flakiness tracked in `backlog.md` (:177, :240-272, "[Pending — priority raised]"). **Pre-existing, outside the diff, and non-blocking.**
- **`view-menu.spec.ts:141` `EPERM` (the engineer's report).** It did not reproduce in either of my runs. As far as I could find, `backlog.md` has no entry for an EPERM while deleting the fixture's temp user-data directory; its EPERM notes concern `rename` in the stores. Recording it as **N7** (below).

The unit and integration tiers, which CI runs, were fully green. My original round's e2e runs were clean: 164/164 twice. The only e2e change since then is one added test. It passed in both full runs and 4 targeted runs, and it goes RED under the fault.

### 5. Verdict

- **B1: CLOSED.** The re-check is now guarded by a test that fails for the claimed reason (2 About windows) and passes when restored.
- **Overall: APPROVE WITH NON-BLOCKING.**
- **Non-blocking items still open:**
  - **N1:** a failed generator run leaves the stale `dist/third-party-notices.json` in place.
  - **N2:** the plan's F6 row names the wrong integration test as the one that goes red.
  - **N3:** `about.spec.ts` uses `'MIT'` and the repo `href` as literals.
  - **N4:** a legacy object license fails closed, but with the lockfile-mismatch message rather than the named "legacy" error.
  - **N5:** the pre-existing same-tick double-open race in Help (backlog candidate).
  - **N6:** the review procedure should use `git -c core.autocrlf=false apply -R`.
  - **N7 (new, Non-blocking):** the fixture-teardown `EPERM` on temp user-data deletion (`view-menu.spec.ts:141`, engineer-observed, not reproduced by me) is not explicitly tracked in `backlog.md`. I suggest adding it to the contention-flake entry.
- **Process note on the engineer's disclosure:** it was transient and self-reported. The out-of-scope `index.ts.__tmp` no longer exists, and the loose blob is inert. No action needed beyond the note.
- **PRE-1** (static windows never styled since Task 14, now fixed) stands as recorded.

### 6. Backstop

`git status --short --untracked-files=all` versus the post-fix state verified in step 1:
```
STATUS IDENTICAL to post-fix step-1 state
```

`git diff --stat`: every line is identical except the hook-owned ndjson, which the hook appended to during my test runs:
```
 .agents/metrics/test-tier-invocations.ndjson |  39 ++
 12 files changed, 1325 insertions(+), 55 deletions(-)
```

- Tracked diff (excluding the ndjson): IDENTICAL.
- `src/main/index.ts`: `136a957a…`, unchanged.
- `tests/e2e/about.spec.ts`: `8da05efe…`, the engineer's post-fix version, unchanged by me.
- No `__tmp` files.
- Ignored directories are only the pre-existing `coverage/`, `dist/` (clean rebuild), `node_modules/`, `release/` and `test-results/`.
- Probes and patches live only in the session scratchpad, and the temp outputs were deleted.

Relevant paths: `C:\Source\md-view\tests\e2e\about.spec.ts` (new test at :139), `C:\Source\md-view\src\main\index.ts` (`onOpenAbout` re-check) and `C:\Source\md-view\.agents\specs\backlog.md`.

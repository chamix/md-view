# Task 48 review (v1.2.0 release documentation)

Persisted by the Lead from the read-only `code-reviewer` subagent's report
(the reviewer has no write tools; ADR-003/004 convention). Content is the
reviewer's, unedited in substance.

---

## Pass 1

**Reviewer:** code-reviewer (independent). **Branch:** feature/048-release-1-2-0, uncommitted working tree vs `main` @ 8c07773.
**Verdict: BLOCKED** — 2 Blocking items (B1, B2), both one-line wording corrections. Everything else passes.

### 1. Diff and scope (#193, #195)
`git diff --stat main`: 5 in-scope files + 3 expected non-reviewed:
```
 .agents/metrics/test-tier-invocations.ndjson |   4 +
 .agents/specs/functional_domain.md           | 108 +++
 .agents/specs/initial_scaffold.md            |  98 +++
 CHANGELOG.md                                 |  24 ++++++
 README.md                                    |  12 ++-
 package-lock.json                            |   4 +-
 package.json                                 |   2 +-
 src/main/help/help.md                        |  16 ++++
```
- `git diff --name-only main -- src/` returns only `src/main/help/help.md` (#195 holds).
- `package.json`: only hunk `-  "version": "1.1.0",` / `+  "version": "1.2.0",`.
- `package-lock.json`: exactly 2 changed lines, top-level `"version"` and `packages[""].version`, both 1.1.0 → 1.2.0; no dependency lines (#193 holds).
- Scope matches `.agents/current_scope.json` (same 5 paths).
- Full CHANGELOG and help.md diffs and full resulting files read. CR-stripped `diff` main vs working tree for CHANGELOG.md shows only `7a8,31` (the inserted section); the rest is unchanged.

### 2. #189 leak scan (CHANGELOG lines 8-31, all of help.md)
Matching-line counts (CHANGELOG / help.md):
- Task 0/0, `#[0-9]` 0/0, ADR 0/0, guardrail 0/0, agent 0/0.
- `.agents` 0/0, `src/` 0/0, `tests/` 0/0, `scripts/` 0/0, `dist/` 0/0.
- extractSection 0/0, awaitWriteFinish 0/0, stabilityThreshold 0/0, pollInterval 0/0.
- `[0-9]+ ?ms` 0/0, `\b100\b` 0/0, `\b200\b` 0/0.
- review 3/7 and spec 0/1: every hit is inside "preview" / "security"; none is process text.

Read by eye: product voice throughout. Live-reload entry carries no latency number (user decision b). **Pass.**

### 3. #190 claim traces (each re-opened)
| Claim | Code | Test | Holds? |
|---|---|---|---|
| File → Close, Ctrl/Cmd+W | menu.ts:37-43 | close-document.spec.ts:191 (:215-218) | Yes |
| Close disabled when nothing is open | menu.ts:41 `enabled: documentOpen` | close-document.spec.ts:131 (:137, :145) | Yes |
| Returns to the "No file open" view | index.html:31 `#empty-state`; renderer.js:283-302 | close-document.spec.ts:144, :173 via support/pristine.ts | Yes |
| **Folder tree stays open (user decision c, pinned)** | documentSession.ts:79-84 `close()` calls only `stopWatching()`, `sendDocumentClosed()`, `onOccupancyChanged()` — no tree-root port. renderer.js:283-302 `onDocumentClosed` never touches `treeRootEl`; the only tree-DOM clear is renderer.js:556 in `onFolderTreeRoot`, which Close never sends. Close only clears the active highlight (renderer.js:300-301). | close-document.spec.ts:148, asserting :176-178 | Yes |
| Mermaid blocks render as diagrams | diagrams.js:236-270, :136, :141 | mermaid.spec.ts:200, :211 | Yes |
| Diagrams follow Dark Mode | diagrams.js:53-55, :167-173 | diagrams.test.ts:142; mermaid.spec.ts:505 | Yes |
| Invalid/oversized diagram: notice + source, rest unaffected | diagrams.js:130-132, :137-139, :255-267 | diagrams.test.ts:194, :225; mermaid.spec.ts:381 (:392, :393), :412 (:428-429) | Yes |
| Theme/security settings inside a diagram ignored | diagrams.js:25-51 | diagrams.test.ts:100, :115; mermaid.spec.ts:286, :315, :332, :362 | Yes |
| Code tab and copy button still show raw Markdown | (unchanged path) | mermaid.spec.ts:802-826 (:820, :825) | Yes |
| About: version, Electron/Chromium/Node.js, copyright, license, repo link | aboutWindow.ts:79-96 | about.spec.ts:91-109 | Yes |
| About lists third-party license notices | aboutWindow.ts:98-99; build → scripts/third-party-notices.mjs | dist-about.test.ts:96-118; about.spec.ts:273 | **Partly — B2** |
| Live reload waits for a save to finish | watcher.ts:24, :30 | watcher.test.ts:93 | Yes |
| Fixed: blank preview after a truncating save | watcher.ts:11-17, :30 | watcher.test.ts:93-128 (:116 precondition) | Yes |
| `settings.json` atomic, "never seen half-written" | settingsStore.ts:12-15 → atomicWriteFile.ts:35-45 | settingsStore.test.ts:189-213 (concurrent reader every 5 ms, ≥10 observations, zero unparsable) | Yes (reader claim; writer correctly dropped the "crash" wording) |
| Help/What's New were unstyled, now styled | helpWindow.ts:40-59 | static-window-csp.spec.ts:169, :197 | Yes |
| Main-window CSP: no inline or eval'd scripts | index.html:5 | csp.spec.ts:43, :77 | Yes |
| Main-window CSP: "no network connections from the page" | index.html:5 `connect-src 'none'` **but also `img-src 'self' file: data: http: https:`** | csp.spec.ts:109; **mermaid.spec.ts:444-449 asserts the page does request a remote https image** | **No — B1** |
| Mermaid locked configuration | diagrams.js:42-51 | diagrams.test.ts:100 | Yes |
| Help/What's New/About no-script CSP | helpWindow.ts:21-23, :45, :50 | static-window-csp.spec.ts:169, :182, :197 | Yes |
| README: Mermaid 11.17.2, pinned | package.json `"mermaid": "11.17.2"` | mermaid.min.js byte-equal integration check (passed) | Yes |
| README: build copies mermaid.min.js into dist/renderer | package.json build script | same | Yes |
| README: bundle loads only when a document has a diagram | diagrams.js:146, :185-203 | mermaid.spec.ts:487-501 | Yes |
| README: static CSP has no script-src and one SHA-256-pinned stylesheet | helpWindow.ts:22, :44-45, :52 | static-window-csp.spec.ts | Yes |
| README license: notices generated at build, shown in About | build log `third-party-notices: 125 packages -> dist\third-party-notices.json` | dist-about.test.ts:96 | Yes (but "every" — B2) |

### 4. #191 What's New compatibility
- `grep -n '^## \[' CHANGELOG.md`: `8:## [1.2.0] - 2026-09-28`, `32:## [1.1.0] - 2026-09-19`, `44:## [1.0.0] - 2026-09-04`.
- Heading exact, date per user decision (a), directly above `## [1.1.0]`; no `## [` line and no code fence inside the section.
- changelog.ts:4 `headingPattern = /^##\s+\[([^\]]+)\]/` captures `"1.2.0"`.
- Compiled extractor (`dist/main/changelog.js`) on `dist/CHANGELOG.md` for 1.2.0: 21 lines, first `"### Added"`, last `"- Third-party license notices now ship with the app, under Help → About md-view."`, no 1.1.0 text, no `## [` line; `dist == root: true`.
- dist-changelog.test.ts:21, :28 pass; whats-new.spec.ts:104 passes (`ok 147`). **Pass.**

### 5. #192 help.md
- `:--`, `--:`, `<tag`, triple-backtick: all 0.
- Table stays `|---|---|`, gains `| Ctrl/Cmd+W | Close the open file |`.
- D3 check `dist-about.test.ts` "dist/main/help/help.md" passes. **Pass.**

### 6. #194 README
Status `**Status: v1.2.0.**`; Close/Mermaid/About-notices features; Mermaid 11.17.2 build-time asset; both CSPs in security invariants; in-app notices paragraph in License. Claims hold except B1/B2 wording.

### 7. Line endings
Working tree CR count = line count for all 5 (CHANGELOG 70/70, help.md 67/67, README 99/99, package.json 61/61, package-lock.json 8539/8539). `main` blobs are LF (`core.autocrlf=true`); `LICENSE` is also CRLF in the tree, so the checkout convention is preserved. `git diff --ignore-cr-at-eol --stat` README 10 vs 12: the former last line `MIT — see [LICENSE](LICENSE).` gains a line end because a paragraph now follows. **Pass.**

### 8. Test gate (#195), solo runs
- `rm -rf dist && npm run build`: `third-party-notices: 125 packages -> dist\third-party-notices.json`, exit 0.
- `npm run test:unit`: `Test Files 34 passed (34)`, `Tests 364 passed (364)`.
- `npm run test:integration`: `Test Files 9 passed (9)`, `Tests 84 passed (84)`; watcher.test.ts:116 did not flake.
- `npm run test:e2e`: `173 passed (5.4m)`, exit 0; close-document.spec.ts:221 passed.

### 8b. Causal check (fault injection): not performed
Planned: reverse only the CHANGELOG hunk (`git apply -R`), rebuild, expect RED on dist-changelog.test.ts:28 / whats-new.spec.ts:104, restore. The permission classifier denied the patch-apply step; not pursued by any other route. Working tree confirmed unchanged afterwards. The causal link is argued from code only (package.json = 1.2.0; `extractChangelogSection` returns null without a `[1.2.0]` heading, changelog.ts:15-16), not demonstrated RED/GREEN.

### 9. `git status --short`
Same 9 entries as at start; reviewer changed no files (ndjson is appended by test hooks).

### Findings

**Blocking**

- **B1 — "no network connections from the page" is false (#190).** CHANGELOG `### Security` bullet 1 and README security invariant ("`connect-src 'none'` blocks network connections from the page"). index.html:5 allows `img-src ... http: https:`; mermaid.spec.ts:444-449 asserts the page does fetch a remote https image. Only fetch/XHR/WebSocket are blocked (csp.spec.ts:109). User-facing via What's New.
  Suggested: CHANGELOG "no inline or eval'd scripts, and scripts on the page cannot make network requests"; README "`connect-src 'none'` blocks script-initiated network requests (fetch/XHR/WebSocket); remote images in a document still load."
- **B2 — third-party notices claimed complete; Electron and Chromium are excluded (#190).** README "every bundled third-party package"; CHANGELOG "the bundled third-party software"; help.md "the third-party software bundled with md-view". Notices cover the npm runtime closure plus build-copied packages (third-party-notices.mjs:33-36, :56-59; dist-about.test.ts:100-112, 125 packages). Electron/Chromium are excluded by design (functional_domain.md:3481-3482, :3602) and ship as separate files (`LICENSE`, `LICENSES.chromium.html`), not under Help → About.
  Suggested: README "the license notices of the open-source packages bundled into md-view (Electron's and Chromium's own license files ship alongside the app)"; CHANGELOG/help.md "the open-source libraries bundled with md-view".

**Should-fix:** none.

**Nit**
- README Mermaid bullet says "raw fence"; CHANGELOG/Help say "raw Markdown". Harmless inconsistency.
- help.md "Live reload" paragraph unchanged; still accurate. No action.

**Delivery rule:** blocked while B1 or B2 is open.

---

## Pass 2 (after the B1/B2/nit fix round)

**Verdict: BLOCKED** — one Blocking item (B3), introduced by the reviewer's own pass-1 wording suggestion. B1 (README half), B2 and the nit are resolved. Gate green.

### 1. Diff
Edits are exactly the writer's list: CHANGELOG.md:14, :28; help.md:59; README.md:22, :23, :45, :100. `git diff --stat main` unchanged in shape (CHANGELOG 24, README 12, help.md 16, package.json 2, package-lock 4); package files show only the three `"version"` lines; `src/` diff is only help.md; CRLF consistent (CHANGELOG 70/70, help.md 67/67, README 99/99).

### 2. Re-trace (#190)
- **README:23 "Electron's and Chromium's own license files ship alongside the app": HOLDS.** app-builder-lib 25.1.8 `out/electron/ElectronFramework.js:169` renames `LICENSE` → `LICENSE.electron.txt` in the app output (non-mac); `LICENSES.chromium.html` stays. `node_modules/electron/dist/` has both files. `electron-builder.yml` `files: [dist/**/*]` only governs `app.asar`; unchanged since 68cca5f. Real v1.1.0 artifact `release/win-unpacked` (electronVersion 44.3.0, same config) contains `LICENSE.electron.txt` (1096 B) and `LICENSES.chromium.html` (20,472,830 B) beside `md-view.exe`. release.yml:37 uses the same packager. Non-blocking caveat: no automated test; acceptable for a README packaging statement.
- **B2 wording (CHANGELOG:14, help:59, README:23, :100): HOLDS** — third-party-notices.mjs:33-36, :56-59; dist-about.test.ts:100-112; 125 packages.
- **B1 README:45: HOLDS** — index.html:5 `connect-src 'none'`; csp.spec.ts:109; remote images per `img-src ... http: https:` and mermaid.spec.ts:444-449.
- **B1 CHANGELOG:28 "scripts on the page cannot make network requests": DOES NOT HOLD** — see B3.
- README:22 "raw Markdown": holds (mermaid.spec.ts:802-826).

### 3. #189 / #191 / #192
- Leak scan (CHANGELOG 8-31, all help.md): Task, `#[0-9]`, ADR, guardrail, agent, `.agents`, `src/`, `tests/`, `scripts/`, `dist/`, extractSection, awaitWriteFinish, stabilityThreshold, pollInterval, `[0-9]+ ?ms`, `\b100\b`, `\b200\b` all 0. review/spec hits only inside Preview/preview/previewer/inspect. **Pass.**
- `^## \[` at 8 (`## [1.2.0] - 2026-09-28`), 32, 44; none inside the section. Compiled extractor on fresh `dist/CHANGELOG.md`: 21 lines, `### Added` … `- Third-party license notices now ship with the app, under Help → About md-view.`; dist-changelog.test.ts passes (writer's stale-dist failure cleared); whats-new.spec.ts:104 `ok 146`. **Pass.**
- help.md: no `:--`/`--:`, no raw HTML, no fences; table `|---|---|` with `| Ctrl/Cmd+W | Close the open file |`; D3 check passes. **Pass.**

### 4. Gate (solo, clean dist)
- `rm -rf dist && npm run build`: exit 0, `third-party-notices: 125 packages -> dist\third-party-notices.json`.
- unit: `Test Files 34 passed (34)`, `Tests 364 passed (364)`.
- integration: `Test Files 9 passed (9)`, `Tests 84 passed (84)`; no watcher.test.ts:116 flake.
- e2e: `173 passed (4.7m)`, exit 0; close-document.spec.ts:221 `ok 9`, csp.spec.ts:109 `ok 37`, mermaid.spec.ts:434 `ok 80`, help-menu (a)-(e) pass.

### 5. `git status --short`
Same as pass 1 plus `?? .agents/specs/review_report_task48.md` (Lead-saved). Reviewer changed no files. Fault injection not retried (denied by the permission system in pass 1).

### Findings
**Blocking**
- **B3 — CHANGELOG.md:28 "scripts on the page cannot make network requests" over-claims (#190).** `connect-src 'none'` blocks only fetch/XHR/WebSocket; `img-src` allows http/https (index.html:5), and the renderer's inserted HTML loads remote images (mermaid.spec.ts:444-449 asserts one remote request). User-facing security claim in What's New; must be exact. Suggested: "no inline or eval'd scripts, and no network requests other than the images a document links to." (index.html:5: `default-src 'none'`, `style-src 'self'`, only `img-src` allows http/https; mermaid.spec.ts:449 shows the image is the only non-local request.) README:45 already precise.

**Should-fix:** none.

**Nit**
- N1: README:45 names fetch/XHR/WebSocket; only fetch is tested (csp.spec.ts:109). Accurate by CSP semantics; no doc change. Possible future test.

---

## Pass 3 (final, after the B3 fix)

**Verdict: PASS.** No Blocking items open; B1, B2, B3 closed.

### 1. Diff
Only change since pass 2 is CHANGELOG.md:28:
```
+- The main window now has a Content Security Policy: no inline or eval'd scripts, and no network requests other than the images a document links to. Mermaid diagrams render with a locked configuration.
```
`git diff --stat main -- <5 files>` identical to pass 2 (CHANGELOG 24, README 12, package-lock 4, package.json 2, help.md 16; 53+/5-). README/help hunks unchanged; package files only the three `"version"` lines; `src/` only help.md; CRLF consistent (70/70, 67/67, 99/99).

### 2. Re-trace of the new clause (#190)
index.html:5: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file: data: http: https:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self' file:`
- `default-src 'none'` → fonts/media/workers/manifests/prefetch: none.
- `script-src 'self'` → no inline/eval (csp.spec.ts:77, :90).
- `style-src 'self' 'unsafe-inline'` → no remote stylesheets; documents can't inject styles (`html: false`; Mermaid `themeCSS` locked, diagrams.js:25-51).
- `img-src ... http: https:` → the single remote allowance ("images a document links to").
- `connect-src 'none'` → no fetch/XHR/WebSocket (csp.spec.ts:109).
- `object-src`/`frame-src`/`form-action 'none'` → no plugins, frames, form posts. `base-uri` causes no request.
- Top-level navigation (outside CSP): index.ts:229-241 `will-navigate` preventDefault, `setWindowOpenHandler` deny, links → `shell.openExternal`.
- Tests: csp.spec.ts:43 pins the exact policy (`ok 23`); mermaid.spec.ts:434-449 `expect(nonLocal).toEqual([REMOTE_IMAGE])` (`ok 79`). **Holds; B3 closed.**

### 3. #189 / #191
Leak scan (CHANGELOG 8-31, all help.md): all patterns 0 (Task, `#[0-9]`, ADR, guardrail, agent, `.agents`, `src/`, `tests/`, `scripts/`, `dist/`, internal identifiers, `ms`/100/200, fences, raw HTML, `:--`/`--:`, whole-word review*/spec*). `^## \[` at 8/32/44; extractor on fresh dist: 21 lines, `### Added` … notices line, contains the new clause, no `## [`; whats-new.spec.ts:104 `ok 145`. **Pass.**

### 4. Final gate (solo, clean dist)
- build: exit 0, `third-party-notices: 125 packages -> dist\third-party-notices.json`.
- unit: `Test Files 34 passed (34)`, `Tests 364 passed (364)`.
- integration: `Test Files 9 passed (9)`, `Tests 84 passed (84)`; no watcher.test.ts:116 flake.
- e2e: `173 passed (4.4m)`, exit 0; close-document.spec.ts:221 `ok 9`.

### 5. `git status --short`
```
 M .agents/metrics/test-tier-invocations.ndjson
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M CHANGELOG.md
 M README.md
 M package-lock.json
 M package.json
 M src/main/help/help.md
?? .agents/current_scope.json
?? .agents/specs/review_report_task48.md
```
Reviewer changed no files.

### Findings
- Blocking: none. Should-fix: none.
- Nit N1 (carried): README:45 names XHR/WebSocket; only fetch is tested. No doc change.
- Carried from pass 1: RED/GREEN fault-injection on the CHANGELOG section not performed (permission system denied `git apply -R`); raised with the user; not a blocker.

**Verdict: PASS** — Task 48 may proceed to Step 3.

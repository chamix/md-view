# Independent Review Report — Task 34: Copy Raw Markdown Source Button

## What was checked

1. Read `functional_domain.md` (Task 34 section, guardrails #98-102), `initial_scaffold.md` (matching Task 34 section), `ADR-006_md-view.md`, and `.agents/current_scope.json`.
2. Ran `git status`/`git diff --name-only` and diffed every touched file individually.
3. Ran `npm run test:unit`, `npm run test:integration`, and the full `npm run test:all` (build + full Playwright suite) directly.
4. Re-ran the one failing e2e test in isolation 3x to classify it as flake vs. regression.
5. Performed a real RED→GREEN fault injection on the load-bearing e2e test via a captured `git apply`/`git apply -R` patch (never `git checkout`), rebuilding `dist/` before each run.
6. Grepped the full diff and `src/` for stray `clipboard.` usage and for any diff to the render-message type.

## Evidence and findings by guardrail

**Guardrail #98 (byte-for-byte, real OS clipboard, never DOM/HTML)** — **Pass.**
`tests/e2e/ui-shell.spec.ts` genuinely reads the real clipboard: `await electronApp.evaluate(({ clipboard }) => clipboard.readText())`, compared against `fs.readFileSync(fixturePath, 'utf8')` on a purpose-built fixture with a trailing newline, a blank line, and a trailing-space line — not against `#code-content`'s DOM string. Verified via a real fault injection:
- RED: patched `src/renderer/renderer.js`'s click handler from `codeContentEl.textContent` to `codeContentEl.innerHTML`, ran `npm run build`, reran the Task 34 e2e tests → both failed with rendered `<code class="hljs language-markdown">...` markup landing in the clipboard instead of raw text — failing for exactly the claimed reason.
- GREEN: reverted (`git apply -R`), rebuilt, reran → `2 passed (4.8s)`.

**Guardrail #99 (copy works from either tab)** — **Pass.**
A second e2e test keeps `#tab-preview` active (`#code-content` hidden) and still gets a byte-identical clipboard match, plus asserts the clipboard text does not contain `<h1`. Confirmed passing in the same fault-injection run above.

**Guardrail #100 (inert when no successful render)** — **Pass, with a Should-fix.**
`tests/unit/canCopyRawSource.test.ts` asserts all three cases: `null`/`undefined` → false, `{ok:false}` → false, `{ok:true}` → true. The wiring (`copyRawSourceEl.disabled = !canCopyRawSource(message)`) runs unconditionally on every `FILE_RENDERED` message, so it is correct by inspection for both the pre-first-file and post-error cases. The pre-first-file empty state is covered at the DOM level by an e2e assertion. **Gap:** no e2e/integration test exercises the "successful render, then a subsequent error render" transition to prove the button re-disables mid-session at the DOM level. Flagged Should-fix, not Blocking — the wiring is a trivial unconditional one-liner and the predicate is unit-proven for the error case.

**Guardrail #101 (clipboard write is main-process-only)** — **Pass.**
The only `clipboard.writeText` call in the entire diff is inside `ipcMain.handle(IPC_CHANNELS.COPY_RAW_SOURCE, ...)` in `src/main/index.ts`. A repo-wide grep for `clipboard` outside that file returns only two English-prose code comments in `renderer.js`, no API calls. Preload only does `ipcRenderer.invoke`.

**Guardrail #102 (disclosed ADR-006 icon exception)** — **Pass.**
ADR-006 exists and matches its described content. `app.css`'s zero-icon-dependency comment is extended (not replaced) to reference ADR-006 as a second disclosed exception. The two SVGs use `stroke="currentColor"` per the ADR, toggled via `.copied`/`.icon-copy`/`.icon-check`.

## File-by-file diff vs. spec mapping

All matched the `initial_scaffold.md` file-by-file mapping exactly, verified hunk-by-hunk: `src/preload/api.ts` (additive channel + method), `src/preload/index.ts` (invoke wiring), `src/main/index.ts` (import + handler grouped with Task 17's), `src/renderer/index.html` (spacer + button, disabled by default), `src/renderer/app.css` (spacer/button/dark-mode/copied rules), `src/renderer/renderer.js` (predicate + wiring + export).

No new raw-source field was added to the render-message type — confirmed via `git diff`, zero hunks touch any message-shape type.

## Scope compliance

All touched files (`src/main/index.ts`, `src/preload/api.ts`, `src/preload/index.ts`, `src/renderer/app.css`, `src/renderer/index.html`, `src/renderer/renderer.js`, `tests/e2e/ui-shell.spec.ts`, `tests/integration/preload-api-contract.test.ts`, new `tests/unit/canCopyRawSource.test.ts`) are inside `.agents/current_scope.json`'s `in_scope` array.

`functional_domain.md`/`initial_scaffold.md` diffs are the Lead's own Step 0/1 spec authorship predating the scope contract, not an engineer edit — not a scope violation. `.agents/DEVLOG.md` is in-scope but has zero diff, consistent with this project's precedent of writing that entry at Step 3 close-out.

An untracked, auto-generated `.agents/metrics/test-tier-invocations.ndjson` exists — harmless telemetry, not a manual edit. Nit: consider `.gitignore`.

## Test suite results (raw, run by reviewer)

- `npm run test:unit` → **112/112 passed** (19 files), includes `canCopyRawSource.test.ts` (3 tests).
- `npm run test:integration` → **24/24 passed** (4 files), includes the new Task 34 contract block.
- `npm run test:all` (full build + Playwright) → **99/100 e2e passed**, one failure: `ui-shell.spec.ts:57 › argv launch: empty-state disappears...` (a width/marginLeft timing assertion). Re-ran in isolation 3x: 1/3 failed, 2/3 passed — matches a pre-existing, already-documented `backlog.md` timing-race flake (Task 19/21/22 entries) in this same assertion class. Confirmed unrelated to this diff (Task 34's CSS changes are additive-only to `#document-header-spacer`/`.doc-header-action`, zero diff to the geometry this flaky assertion checks).

**Discrepancy noted:** the delegation brief referenced "16 pre-existing failures from a drive-letter-casing flake" in `tree-panel`/`file-tree`/`drag-drop` specs. No such `backlog.md` entry was found, and the reviewer's own full run reproduced none of that pattern — only the single, already-documented `ui-shell.spec.ts` flake above. Verdict rests on what was directly observed, not on the restated claim.

## Verdict

| # | Item | Status |
|---|---|---|
| 98 | Byte-for-byte real clipboard proof | Pass (fault-injection RED→GREEN verified) |
| 99 | Tab-independent copy | Pass |
| 100 | Inert with no valid render | Pass — Should-fix: no e2e test for mid-session success→error transition |
| 101 | Main-process-only clipboard boundary | Pass |
| 102 | ADR-006 disclosed exception | Pass |
| Scope | Diff vs. `current_scope.json` | Pass |
| Architecture | DIP via `BridgeApi`, IPC pattern reuse | Pass |
| Test quality | Non-tautological, real clipboard/fs | Pass |
| Regression | Full suite | Pass (1 pre-existing unrelated flake, 2/3 non-reproducing) |

**Blocking: 0. Should-fix: 1 (guardrail #100 mid-session transition test gap). Nit: 1 (untracked metrics file).**

**Overall: Approve for delivery.**

# Independent Review Report — Task 41: Electron 38.8.6 → 44.3.0

**Reviewer:** code-reviewer (read-only, evidence-based verification)
**Branch reviewed:** `feature/041-electron-38-to-44` vs `main`
**Date:** 2026-09-13

## 1. Diff Scope and Content Verification

**Command:** `git diff main --stat`

```
 .agents/metrics/test-tier-invocations.ndjson |   1 +
 .agents/specs/backlog.md                     |  15 +
 .agents/specs/functional_domain.md           | 191 ++++++++++
 .agents/specs/initial_scaffold.md            |  88 +++++
 package-lock.json                            | 528 +++------------------------
 package.json                                 |   2 +-
 tests/e2e/tree-panel.spec.ts                 |   2 +-
 7 files changed, 351 insertions(+), 476 deletions(-)
```

**Finding: PASS.** No `src/**` file appears anywhere in the diff (confirmed separately: `git diff main --name-only | grep -i '^src/'` returned nothing, exit code 1). The only non-application-code files touched beyond the three named are `.agents/specs/functional_domain.md`, `.agents/specs/initial_scaffold.md`, `.agents/specs/backlog.md` (governance/planning artifacts, expected — pre-authorized by the task brief) and `.agents/metrics/test-tier-invocations.ndjson`, which was additionally verified to be a single append-only auto-generated log line (`git diff main -- .agents/metrics/test-tier-invocations.ndjson` shows exactly one `+` line, a hook-generated record for the `tree-panel.spec.ts` edit — not hand-edited content).

### 1a. package.json
```diff
-    "electron": "^38.8.6",
+    "electron": "^44.3.0",
     "electron-builder": "^25.1.0",
```
Confirmed via `git diff main -- package.json | grep -c "^[+-]"` = 4 total lines with a `+`/`-` prefix (2 are the `---`/`+++` file headers, leaving exactly 1 removed + 1 added content line). `electron-builder` remains `^25.1.0`, untouched. **PASS.**

### 1b. package-lock.json
- `node_modules/electron`: version block changed `38.8.6` → `44.3.0` (confirmed via targeted grep of that block).
- `electron-builder`'s own `node_modules/electron-builder` block: zero `+`/`-` lines inside it (verified by viewing the full hunk — it sits untouched between the `electron`-package engines change and an unrelated `electron/node_modules/@types/node` removal).
- Grepped the entire lockfile diff for `typescript|esbuild|vitest|playwright|markdown-it|chokidar|zod|highlight.js|github-markdown-css` restricted to actual `+`/`-` changed lines (`grep -E '^[+-].*(...)'`) — **zero matches**. These packages appear only as unchanged context lines near other hunks, never as actual diff content.
- Spot-checked the one non-obvious new entry, `node_modules/undici`: ran `npm ls undici`, which resolves the chain as `electron@44.3.0 → @electron/get@5.1.0 → undici@7.29.1` — confirmed transitive to Electron's own tooling, not a new top-level app dependency.
- Removed/added block headers are all Electron's own transitive tree: `@electron/rebuild`, `@npmcli/fs`, `@types/yauzl`, `app-builder-lib`'s nested `semver`, `boolean`, `extract-zip`, `fd-slicer`, `global-agent`, `yauzl`, etc. (removed, replaced by Electron 44's own updated toolchain, e.g. `@electron-internal/extract-zip`, `@electron/get/node_modules/env-paths`, `undici`).

**Finding: PASS.** Lockfile drift is confined to Electron's own dependency tree.

### 1c. tests/e2e/tree-panel.spec.ts
```diff
-      await expect.poll(() => window.evaluate(() => window.innerHeight)).toBeLessThanOrEqual(320);
+      await expect.poll(() => window.evaluate(() => window.innerHeight)).toBeLessThanOrEqual(330);
```
Exactly one line changed (confirmed via `git diff main -- tests/e2e/tree-panel.spec.ts`, single hunk). Read the surrounding test body (lines 613–649, "guardrail #50"): the substantive proof —
```js
const docScrollHeightBefore = await window.evaluate(() => document.documentElement.scrollHeight);
...
const docScrollHeightAfter = await window.evaluate(() => document.documentElement.scrollHeight);
expect(docScrollHeightAfter).toBeLessThanOrEqual(docScrollHeightBefore + 1);
```
— is byte-identical, untouched. The changed line is purely the pre-condition resize-settling synchronization poll, not the guardrail's actual proof. **PASS.**

## 2. Spec Cross-Check (functional_domain.md / initial_scaffold.md)

Read `functional_domain.md`'s "Task 41: Electron 38 → 44 checkpoint" section (guardrails #120–124) and `initial_scaffold.md`'s "Task 41: Electron 38 → 44 checkpoint (Step 1)" section in full.

**Guardrail #122 (clipboard) — independently re-verified, not trusted from the spec text:**
```
Grep "clipboard" -i src/renderer/ src/preload/  →  src\main\index.ts, src\renderer\renderer.js
```
Investigated the `renderer.js` hit directly:
```
157:  // the system clipboard, regardless of which tab is currently visible.
162:  // tests/e2e/ui-shell.spec.ts's byte-for-byte clipboard assertion for the
```
Both are comments describing the feature, not code calling any clipboard API. `grep -n navigator\.clipboard src/` (recursive across all of `src/`) returned **zero files**. `grep clipboard src/main/index.ts`:
```
1:import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron';
483:  // ...clipboard.writeText() must run main-process
489:    clipboard.writeText(text);
```
Confirmed the only real `clipboard.writeText()` call is at `src/main/index.ts:489`, inside the `COPY_RAW_SOURCE` handler. **The spec's claim holds up under independent verification — no renderer/preload clipboard exposure exists, so Electron 44's renderer-side `clipboard` module removal has no effect on this app.**

**Guardrail #121 (windowConfig.ts byte-identical):**
```
git diff main -- src/main/windowConfig.ts  →  (empty output)
```
Also independently confirmed the actual on-disk values still match the claim (not just "no diff"):
```
9:    contextIsolation: true,
10:    nodeIntegration: false,
11:    sandbox: true,
```
**PASS.**

## 3. Test Suite — Run Myself

**Unit tests** (`npm run test:unit`):
```
Test Files  20 passed (20)
     Tests  120 passed (120)
```

**Integration tests** (`npm run test:integration`):
```
Test Files  5 passed (5)
     Tests  36 passed (36)
```

**Full `npm run test:all`** (build + full 103-test e2e suite, run once as the authoritative gate, `ELECTRON_RUN_AS_NODE` stripped first):
```
101 passed (1.9m)
2 failed:
  1) tests\e2e\ui-shell.spec.ts:57:7 › argv launch: empty-state disappears, status bar shows the real absolute path
     Expected: > 800   Received: 576   (containerBox.width, check (h))
  2) tests\e2e\view-menu.spec.ts:189:5 › (g) toggling a View setting immediately persists the full settings object to settings.json
     SyntaxError: Unexpected end of JSON input (JSON.parse on settings.json)
```

### 3a. Failure #1 — `ui-shell.spec.ts` check (h), `containerBox.width > 800`
This is the pre-documented flake (`backlog.md`'s Task 16/19/21/22/41 entries, including an explicit "Update (Task 41)" entry already logging this exact recurrence with `received 143.2`). Independently reproduced and isolated rather than accepted at face value:
- `--repeat-each=5` at default (2-worker) parallelism: **4/5 failed**, received `143.2, 143.2, 576` (unstable, matching the documented "renderer-side resize lag under concurrent-process contention" mechanism).
- `--repeat-each=5 --workers=1` (no parallel contention): **5/5 passed cleanly.**

This confirms the mechanism is exactly the already-tracked resource-contention race (backlog.md), not a new Electron 44 regression. **Non-blocking**, consistent with pre-authorized known noise.

### 3b. Failure #2 — `view-menu.spec.ts` "(g) toggling a View setting immediately persists..." — **NOT previously logged in backlog.md**
Searched `backlog.md` for `settings.json`, `readFileSync`, `JSON.parse`, "Unexpected end of JSON" — **zero prior mentions**. This is a genuinely new failure mode investigated rather than waved through.

Read the test (`tests/e2e/view-menu.spec.ts:189-207`) and the production write path (`src/main/settingsStore.ts`, untouched by this diff):
```ts
export async function writeSettingsFile(filePath: string, settings: SettingsFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf8');
}
```
The test polls `fs.readFileSync` until non-null, then **discards that read and calls `fs.readFileSync` again** for the actual `JSON.parse`. `fs.writeFile` is not atomic (no temp-file+rename); under load, the poll can observe a partially-flushed write and the second, independent read can land in a different, still-incomplete state — a latent test-design race entirely independent of the Electron version.

Reproduction: `npx playwright test tests/e2e/view-menu.spec.ts -g "toggling a View setting immediately persists" --repeat-each=8` (default 2-worker parallelism, isolated from the other 100 e2e specs) → **8/8 passed.** This confirms the failure only surfaces under the much higher concurrent-process load of the full 103-test suite, matching the same contention-flake class already established for other tests in this repo (backlog.md), not a deterministic regression, and not caused by this diff (`settingsStore.ts` and the test file itself are both outside the diff).

**Classification: Non-blocking**, but flagged as a **Should-fix (process item)**: this specific flake was not previously logged, and per this repo's own established discipline (every prior contention-flake instance gets a backlog.md entry), it should be added to `backlog.md`.

### 3c. Causal (RED/GREEN) proof for the `tree-panel.spec.ts` fix
Did not accept "the fix passes" as proof it was necessary. Captured the fix as a patch, reverted it (`git apply -R`), and reran:

**RED** (`--repeat-each=3`, reverted to `toBeLessThanOrEqual(320)`):
```
3 failed
Error: expect(received).toBeLessThanOrEqual(expected)
Expected: <= 320
Received:    322
```
(reproduced identically on all 3 repeats — a real ~2px overshoot under Electron 44, not noise)

**GREEN** (patch restored, `toBeLessThanOrEqual(330)`):
```
3 passed (4.8s)
```
This confirms the widened threshold is a real, necessary fix for an actual Electron-44-caused ~2px `innerHeight` shift, and that it does not mask or weaken the test's substantive overflow-containment assertions (`docScrollHeightBefore`/`docScrollHeightAfter`, unchanged per §1c above).

## 4. Bundled Node Version (guardrail #123)
```
$ ELECTRON_RUN_AS_NODE=1 npx electron -e "console.log(process.version)"
v24.20.0
```
Matches the expected `v24.x.y`. **PASS.**

## 5. Package and Launch Verification (guardrail #124)
```
$ npm run package
...
• executing @electron/rebuild  electronVersion=44.3.0 arch=x64 buildFromSource=false appDir=./
• packaging       platform=win32 arch=x64 electron=44.3.0 appOutDir=release\win-unpacked
...
• building        target=nsis file=release\md-view Setup 1.0.0.exe archs=x64
• building        target=portable file=release\md-view 1.0.0.exe archs=x64
```
Launched `release\win-unpacked\md-view.exe` (with `ELECTRON_RUN_AS_NODE` stripped from the launching PowerShell session first):
```
   Id ProcessName MainWindowTitle
   -- ----------- ---------------
 8656 md-view     md-view
 9524 md-view
15040 md-view
24244 md-view
```
PID 8656 shows a real, non-empty `MainWindowTitle` of `"md-view"` — confirming an actual visible window, not just process liveness (the other PIDs are Electron's standard GPU/renderer/utility helper processes, expected for any Chromium-based app). Process cleaned up after verification. **PASS.**

## 6. Architecture / SOLID / GoF Scan
This diff is a pure dependency-version bump plus one test-assertion tolerance widening — no interfaces, abstractions, or source files change. The Inward Dependency Rule is unaffected (no `src/**` touched). No new patterns, no violated boundaries. Nothing to flag independently beyond what's already covered by the clipboard/windowConfig boundary re-verification in §2.

## 7. Test Quality / Regression Risk
No new tests were added in this diff (expected — it's a version bump, not new functionality). The one existing-test change is causally proven necessary and non-weakening (§3c). Regression coverage is strong: the full 103-test e2e suite, 36 integration tests, and 120 unit tests collectively exercise nearly the entire application surface, and only the two known contention-class flakes surfaced — both independently confirmed as load-related, not deterministic regressions.

## Findings Summary

| # | Finding | Severity |
|---|---|---|
| 1 | `view-menu.spec.ts` "(g)" full-suite-only flake is real but not yet logged in `backlog.md`, unlike every other contention flake in this repo's established practice | **Should-fix** (non-blocking; recommend a backlog.md addendum, not a code fix — root cause is a pre-existing non-atomic-write/discard-reread test race unrelated to this diff) |
| 2 | `ui-shell.spec.ts` check (h) flake | Non-blocking, pre-documented, independently reproduced and isolated to confirm same mechanism |

**No Blocking findings.**

## Verdict

**PASS.** The diff correctly and completely implements the approved Task 41 spec (`functional_domain.md` guardrails #120–124):
- Exactly one dependency line changed in `package.json`, `electron-builder` untouched, lockfile drift confined to Electron's own transitive tree (independently verified via `npm ls`).
- Zero `src/**` changes; the clipboard architecture claim (guardrail #122) and `windowConfig.ts` security-settings claim (guardrail #121) were both independently re-verified against the actual source, not just the spec's assertion.
- The one test file change is a single line, causally proven (RED→GREEN) necessary and non-weakening.
- Bundled Node version independently confirmed `v24.20.0`.
- Packaging and a real GUI launch with a non-empty window title independently confirmed.
- Full authoritative `test:all` run: 101/103 e2e (plus 120/120 unit, 36/36 integration) passed; the 2 failures are both non-deterministic contention-class flakes, independently isolated and confirmed clean under low-contention reruns, unrelated to this diff's changes.

No Blocking items are open. The one Should-fix item (logging the newly-observed `view-menu.spec.ts` flake to `backlog.md`) is administrative and does not gate delivery.

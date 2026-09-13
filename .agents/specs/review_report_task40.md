# Independent Review Report — Task 40: Electron 33 → 38 checkpoint

**Reviewer:** `code-reviewer` subagent (read-only tools: Read, Grep, Glob, Bash — no Edit/Write; this report was saved by the Lead on the reviewer's behalf).

**Branch:** `feature/040-electron-33-to-38`

## Verdict: PASS — no Blocking findings

---

## 1. Scope Verification

```
$ git status --porcelain
 M .agents/metrics/test-tier-invocations.ndjson
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M package-lock.json
 M package.json
 M src/main/index.ts
 M tests/e2e/open-file-argv.spec.ts
?? .agents/current_scope.json
```

`.agents/current_scope.json`:
```json
{
  "task": "Task 40: Bump electron ^33.0.0 to ^38.8.6 (Electron 33->38 checkpoint 1 of 2)",
  "in_scope": ["package.json", "package-lock.json", "src/main/index.ts", "tests/e2e/open-file-argv.spec.ts"]
}
```

Reconciliation: `package.json`, `package-lock.json`, `src/main/index.ts`, `tests/e2e/open-file-argv.spec.ts` — exactly the 4 in-scope files. `.agents/specs/functional_domain.md` and `.agents/specs/initial_scaffold.md` are Lead-authored governance artifacts (pre-existing, expected). `.agents/current_scope.json` is the untracked contract itself (expected).

**One item not on the expected list:** `.agents/metrics/test-tier-invocations.ndjson` (+2 lines). Investigated via `git diff` and `.claude/hooks/run-tests-if-src.mjs` (read in full): this is a `PostToolUse` hook that auto-appends one JSON line to this file on every `Edit`/`Write` under `src/` or `tests/`, logging which test tier ran. The two new lines correspond exactly to the two in-scope source edits (`src/main/index.ts` and the e2e spec) firing the hook's existing, pre-approved mechanism — not a manual or out-of-scope edit by the engineer. **Not a scope violation** — machine-generated audit telemetry from infrastructure that predates this task. Flagged as informational only.

**No scope violation (Blocking or otherwise).**

---

## 2. Dependency Bump (`package.json` / `package-lock.json`)

```diff
--- a/package.json
+++ b/package.json
@@ -50,7 +50,7 @@
     "@types/node": "^24.13.4",
     "@vitest/coverage-v8": "^2.1.9",
-    "electron": "^33.0.0",
+    "electron": "^38.8.6",
     "electron-builder": "^25.1.0",
```
Confirmed: single-line change, `electron-builder` untouched at `^25.1.0`.

`package-lock.json` diff: three hunks, all consequences of the one bump — root `devDependencies.electron` version bump, the `node_modules/electron` block (version/resolved/integrity + electron's own nested `@types/node` range), and electron's private transitive `@types/node` copy. The project's own top-level `@types/node` (`^24.13.4`) is untouched. **No unrelated dependency drift.**

---

## 3. `src/main/index.ts` fix

```diff
   if (shouldSetDockIcon(app.isPackaged, process.platform)) {
-    app.dock.setIcon(path.join(__dirname, 'icon.png'));
+    app.dock?.setIcon(path.join(__dirname, 'icon.png'));
   }
```
Isolated diff: 1 insertion, 1 deletion, one hunk, nothing else touched.

**Causal fault-injection (RED/GREEN), performed via captured patch (`git apply -R` / `git apply`, not `git checkout`/`restore`):**
- Reverted: `npm run build` → `src/main/index.ts(425,5): error TS18048: 'app.dock' is possibly 'undefined'.` — RED confirmed, exact claimed cause.
- Restored: `npm run build` → clean, 0 errors. GREEN confirmed. Repo state re-verified identical to original diff after restore.

---

## 4. `tests/e2e/open-file-argv.spec.ts` fix — Race-Condition Claim

```diff
   const window = await electronApp.firstWindow();
+  await window.waitForLoadState('domcontentloaded');
   await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click());
```
Confirmed single-line addition, nothing else touched in the file.

**Independent reproduction (captured-patch fault injection, 5 runs each direction):**
- Reverted: 5/5 runs FAILED identically — `Expected substring: "Could not open file"` / `Received string: ""` / `Timeout: 10000ms`, `#content` never updates.
- Restored: 5/5 runs PASSED cleanly.

**CONFIRM: the Lead's race-condition root-cause claim is verified.** Independent reproduction matches the claimed 5/5-fail-without-fix / 5/5-pass-with-fix pattern exactly, with a failure signature matching the claimed mechanism (dropped `FILE_RENDERED` IPC message due to renderer listener-attachment timing, not a generic flake — deterministic and specific to this one assertion every time).

---

## 5. Full Regression Gate

- `npm run build` — pass, 0 errors.
- `npm run test:unit` — 120/120 pass.
- `npm run test:integration` — 36/36 pass.
- `npm run test:all` (authoritative final run, rebuilds `dist/` first): unit 120/120, integration 36/36, **e2e 103/103, zero failures.**

An earlier standalone `npm run test:e2e` run hit the known pre-existing flake once (`tests/e2e/drag-drop.spec.ts`, `code=3221226505` worker-fastfail crash) — cross-checked against `.agents/specs/backlog.md`, identical signature, documented since Task 19, rotates across unrelated files under 2-worker parallelism, occurs both before and after prior diffs. Immediate isolated re-run of that file passed cleanly (9/9). This flaky run is superseded by the clean final `test:all` run above, which is what this verdict rests on. `tests/e2e/open-file-argv.spec.ts` specifically passed in every run, isolated and full-suite alike.

---

## 6. Bundled Node Version

```
$ ELECTRON_RUN_AS_NODE=1 npx electron -e "console.log(process.version)"
v22.22.0
```
Confirmed Node 22.x — matches the task's revised expectation (38.8.6 bundles a newer 22.x point release than 38.0.0's originally-assumed `v22.18.0`; still the same major, no mismatch).

---

## 7. Packaged Build

The reviewer's own Bash sandbox forced `ELECTRON_RUN_AS_NODE=1` into every subprocess regardless of `unset`, making independent re-verification impossible in that environment (a plain-Node launch, not a GUI process). **The Lead independently resolved this**: the same variable turned out to be set at the Windows **User** environment-variable scope on the actual dev machine (`[System.Environment]::GetEnvironmentVariable("ELECTRON_RUN_AS_NODE","User")` → `1`) — a persistent, pre-existing machine quirk, not anything related to this task's diff (the app's own `tests/e2e/support/fixtures.ts` already has a defensive comment/`delete childEnv.ELECTRON_RUN_AS_NODE` for exactly this hazard).

After removing it for the launching PowerShell session (`Remove-Item Env:\ELECTRON_RUN_AS_NODE`) and relaunching `release\win-unpacked\md-view.exe`:
```
HasExited: False
   Id ProcessName MainWindowTitle  WS_MB
   -- ----------- ---------------  -----
 9852 md-view                      46.30
13648 md-view                      72.70
19464 md-view                      86.50
25168 md-view     md-view         113.60
```
Four processes alive after 4s (main + Electron's helper/GPU/renderer processes, matching the earlier implementer report), **one carrying `MainWindowTitle: "md-view"`** — confirming a real, titled, visible window exists, not just a background process. Cleanly terminated afterward (`Stop-Process -Force`, confirmed no remaining processes). This closes the gap the reviewer flagged, with stronger evidence than the original implementer check (window-title confirmation, not just process-liveness).

---

## Findings

**Blocking:** None.

**Should-fix:** None outstanding — the one item the reviewer raised (independent packaged-build re-verification, blocked by the reviewer's own sandboxed environment) was closed by the Lead directly (see §7), including root-causing *why* the reviewer's attempt failed (a pre-existing machine-level `ELECTRON_RUN_AS_NODE=1` User env var, unrelated to this diff).

**Nit:**
- `.agents/metrics/test-tier-invocations.ndjson` picked up 2 auto-appended lines from the pre-existing `run-tests-if-src.mjs` PostToolUse hook, outside the literal `current_scope.json` file list. Confirmed as expected machine-generated telemetry from approved infrastructure, not a manual scope violation.

---

## Summary Table

| Check | Result |
|---|---|
| Scope compliance | Pass (1 informational nit, hook-generated telemetry) |
| `electron` bump, `electron-builder` untouched | Confirmed |
| Lockfile diff scoped to the one bump | Confirmed |
| `src/main/index.ts` fix — exact diff + RED/GREEN fault injection | Confirmed (TS18048 → clean build) |
| `tests/e2e/open-file-argv.spec.ts` fix — exact diff | Confirmed |
| Race-condition root cause | **CONFIRMED** via independent 5x RED / 5x GREEN reproduction |
| `npm run build` / `test:unit` / `test:integration` | Pass / 120/120 / 36/36 |
| `npm run test:all` (authoritative) | 259/259 pass, 0 failures |
| Known e2e flake check | Confirmed pre-existing signature (`code=3221226505`), not a new regression |
| Bundled Node version | `v22.22.0` confirmed |
| Packaged build liveness | Confirmed by the Lead (window-title-level evidence), after root-causing the reviewer's sandbox obstacle as an unrelated pre-existing machine env var |

## Overall Verdict: **PASS**, zero Blocking, zero outstanding Should-fix items.

---

Relevant file paths (all absolute):
- `C:\Source\md-view\.agents\current_scope.json`
- `C:\Source\md-view\.agents\specs\functional_domain.md`
- `C:\Source\md-view\.agents\specs\initial_scaffold.md`
- `C:\Source\md-view\.agents\specs\backlog.md`
- `C:\Source\md-view\.claude\hooks\run-tests-if-src.mjs`
- `C:\Source\md-view\package.json`
- `C:\Source\md-view\package-lock.json`
- `C:\Source\md-view\src\main\index.ts`
- `C:\Source\md-view\tests\e2e\open-file-argv.spec.ts`

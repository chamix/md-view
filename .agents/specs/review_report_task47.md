# Review Report: Task 47, Live-reload truncate race and e2e renderer-readiness race

**Reviewer:** code-reviewer (independent, read-only)
**Branch:** `feature/047-e2e-races`, uncommitted working tree against base `main` @ `38cb06b`
**Spec:** `functional_domain.md` Task 47 #180-#188 plus the Accepted limitation; `initial_scaffold.md` Task 47 Step 1 plus the User approval conditions (the conditions take precedence); `.agents/current_scope.json`
**Date:** 2026-09-27

## Verdict: CHANGES REQUIRED (2 Blocking, both small test-only fixes)

The production changes are correct and in scope:
- H1 is fixed with `awaitWriteFinish`.
- D3 adds an atomic settings write, with the containment condition 3 asks for.
- The H2 helper's logic is sound.

The done criterion is met: 3 of 3 consecutive fully green runs.

Two guardrail tests are not good enough yet:
- **B1:** the #181 RED test can pass vacuously.
- **B2:** the application-form readiness path, which the fixture uses for about 150 tests, has no test that fails when it breaks.

Both are narrow fixes inside files already in scope.

## Findings (ranked)

| ID | Severity | Guardrail | Evidence |
|---|---|---|---|
| B1 | **Blocking** | #181, condition 1 (no vacuous pass) | `tests/integration/watcher.test.ts`, H1 case: `callbacks.filter((c) => c.at >= writtenAt ...)`. When the write finishes in the same millisecond as the truncate's callback (`delay` = 0), the truncate's own callback counts as "after the write". With F1 applied (no `awaitWriteFinish`), the full file passed this case in **2 of 8** runs (6/6 red when run alone). A scratch chokidar harness with F1's config passed in **4 of 30** trials, every time with `{"delay":0,"events":"change@0","pass":true}`. The precondition guard (`delay >= 40`) cannot catch this. With the fix in place, the same collision would hide a regression. **Fix:** count only callbacks after index 0 (for example `callbacks.slice(1)`), or use `c.at > writtenAt` together with the index. |
| B2 | **Blocking** | #183, #184, #185 (new logic without a test) | Own fault R2 made `waitForRendererReady(app)` resolve on ANY window: `if (isApp \|\| (await isRendererReady(page))) return;`. Result: **full e2e `158 passed (3.0m)`**, nothing red. The application form is new logic (deviation a). It is what `support/fixtures.ts` calls for every fixture test, and it is what `whats-new.spec.ts` calls. Only the Page form is exercised under the hold (renderer-ready (b)/(c)). **Fix:** add a case to `renderer-ready.spec.ts` that runs (b)'s hold against `waitForRendererReady(electronApp)`. Optionally add a case with What's New due, to show that the `data:` window is never accepted. |
| S1 | Should-fix | D4 / #187 (quality of the evidence) | Capture runs after `app.close()`, so the formatter's "still running at capture time" branch cannot be reached. A real failure (R1) captured `process: exited` / `exit code: 0 (0x00000000)`. That output cannot distinguish "died mid-test with code 0" from "closed by teardown". The fast-fail class (`3221226505`) is still recognisable, so D4's main value holds. Suggest recording `exited` before `app.close()`. |
| S2 | Should-fix / backlog | not a Task 47 regression | `window-chrome.spec.ts:124` "close button terminates the app" (`locator.click: Target page, context or browser has been closed`) is **pre-existing**. With the helper it failed 3/120; with the helper removed it failed 5/240 (details below). It is not in `backlog.md`, so log it. The likely fix is `click({ noWaitAfter: true })` or similar, which is outside this task's scope limit. |
| S3 | Should-fix (coverage) | condition 4 | Nothing tests the D4 status guard or the `setupFailed` wiring. R6 removed the guard: nothing turned red, and no result changed, which is correct by design. The spec only asked for "a unit test of the pure formatter, plus reviewer verification", and that verification is done below. This is recorded as a gap, not a violation. |
| N1 | Nit | condition 3 | `onOpenSettings` containment (`ensureSettingsFileExists`) is correct by reading the code, but no test covers it. Condition 3 did not require one. |
| N2 | Nit | condition 1b | `close-pending-reload.spec.ts` asserts the timing precondition (< 60 ms) but not that a write-finish check was actually pending at Close. The 20 ms wait is a heuristic. F8 turning it red shows that the render would otherwise arrive. |
| N3 | Nit | #185 | The structural scan compares counts per file, not per launch site. Two helper calls after the first of two launches would still pass. |
| N4 | Nit | appStateStore limit | Besides the import, the `appStateStore.ts` diff removes the moved body (unavoidable) and rewrites the comment above `writeAppStateFile`. Behaviour is unchanged, and `appStateStore.test.ts` has 0 diff and passes. Accepted. |

## Evidence

### 1. Scope and limits

`git status --short --untracked-files=all` (snapshot at start, identical at the end):
```
 M .agents/metrics/test-tier-invocations.ndjson
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M src/main/appStateStore.ts
 M src/main/index.ts
 M src/main/settingsStore.ts
 M src/main/watcher.ts
 M tests/e2e/support/fixtures.ts
 M tests/e2e/tree-panel.spec.ts
 M tests/e2e/view-menu.spec.ts
 M tests/e2e/whats-new.spec.ts
 M tests/e2e/window-chrome.spec.ts
 M tests/integration/settingsStore.test.ts
 M tests/integration/watcher.test.ts
?? .agents/current_scope.json
?? src/main/atomicWriteFile.ts
?? tests/e2e/close-pending-reload.spec.ts
?? tests/e2e/renderer-ready.spec.ts
?? tests/e2e/settings-locked.spec.ts
?? tests/e2e/support/failureCapture.ts
?? tests/e2e/support/rendererReady.ts
?? tests/unit/e2eReadiness.test.ts
?? tests/unit/failureCapture.test.ts
```

What is outside `in_scope`, and why each is acceptable:
- The two spec files are the Lead's approved Step 0/1 appends.
- The ndjson is written by the hook.
- `current_scope.json` is the manifest itself.

Every source and test file is in `in_scope`. `git status --ignored` shows only `coverage/ dist/ node_modules/ release/ test-results/`, so there are no stray repo files.

Protected files: `git diff --stat -- playwright.config.ts tests/e2e/live-reload.spec.ts tests/e2e/close-document.spec.ts tests/e2e/file-tree.spec.ts src/renderer src/preload tests/integration/appStateStore.test.ts src/main/documentSession.ts` printed **nothing** (rc=0).

Limits, checked against the hunks:
- **Direct-launch specs:**
  - `tree-panel`: +3 (import, and `await waitForRendererReady(window|secondWindow);` ×2)
  - `view-menu`: +3 (import plus 2 calls)
  - `whats-new`: +2 (import, and `await waitForRendererReady(app);`)
  - `window-chrome`: +2 (import plus 1 call)

  These are insertions only. The grep `launch(` finds 6 real sites: tree-panel :337/:348, view-menu :148/:167, whats-new :212, window-chrome :130. View-menu :128 is a comment, which confirms deviation (b).
- **`index.ts`:** only the try/catch around `writeSettingsFile` in `persistCurrentViewSettings`, the new `warnSettingsWriteFailed`, and the try/catch around `ensureSettingsFileExists` in `onOpenSettings`. Containment only.
- **Integration test files:** hunks `@@ -10,6 +10,26 @@`, `@@ -154,3 +174,102 @@` (settingsStore) and `@@ -57,3 +57,109 @@` (watcher) are pure additions. The existing cases are byte-unchanged.
- **The `vi.mock('node:fs/promises')` passthrough:** it spreads `actual` and only wraps `writeFile`. The wrapper calls `actual.writeFile(...args)` unless `task47.slowTruncatingWrite` is true, which only the new describe block sets and its `afterEach` resets. The existing line-164 `fsp.readFile` is the spread original. `vi.restoreAllMocks()` sits only in the new describe and cannot touch the wrapper (it is a plain function, not a `vi.fn`). It **cannot change existing behaviour**.

### 2. Guardrails and conditions

- **#180 (H1):** `watcher.ts` hunk `chokidar.watch(filePath, { ignoreInitial: true, awaitWriteFinish: WATCH_WRITE_FINISH })` with `{ stabilityThreshold: 100, pollInterval: 20 }`. Verified in `node_modules/chokidar/index.js` (4.0.3): with `awf`, add/change goes to `_awaitWriteFinish` and `return`s **before** the 50 ms `_throttle`, so the leading-edge-only swallow is bypassed. Passes GREEN, and F1 is RED (see B1 for the vacuity caveat).
- **#181:** partly met. It is RED 6/6 when run alone, but it can pass vacuously (B1).
- **#182:** the cost is stated in the `watcher.ts` comment (+105-200 ms, stat polling) and the rejected alternative is named.
- **#183:**
  - The predicate `location.pathname.endsWith('/renderer/index.html') && document.readyState === 'complete'` is correct. `renderer.js` is a classic, parser-inserted script (`index.html:57`), and its receivers are registered at the top level of the synchronous `if (typeof document !== 'undefined')` block (`:246`, `:283`, `:304`, `:552`, `:638`).
  - The What's New `data:` URL is `'data:text/html;charset=utf-8,' + encodeURIComponent(html)` (`index.ts:431`). `encodeURIComponent` escapes `/`, so the pathname cannot end in `/renderer/index.html`.
  - `about:blank` fails the URL clause (proven by (c), and by R1 turning red).
  - The application form checks the same predicate on each page, so by code reading it cannot resolve on the wrong window. It is untested (B2).
- **#184:** (a) is the positive control, and (b) is the gate. F2 is RED on (b).
- **#185:**
  - Fixture: `waitForRendererReady(app)` runs before `use(app)`, and a unit test asserts that order.
  - Direct launches: covered by the structural scan. F4 is RED. The scan's non-vacuity test requires `>= 6` launches. See N3.
- **#186 (no masking):**
  - Existing specs only gained insertions. No assertion, timeout or skip was changed.
  - `playwright.config.ts` has 0 diff (`workers: 2`, no `retries`).
  - Each e2e log begins `Running 158 tests using 2 workers` and contains no "flaky", "retry" or "skipped".
- **#187:** D4 is in place. `close-document:221` was not reproduced in my 3 runs either (`ok 8 ... close-document.spec.ts:221:1 ... (8.3s)`), so it stays "unconfirmed; capture in place". Classifying `view-menu:189` via E4 is sound, and D3 addresses it.
- **#188:** met, see "Done-criterion runs" below.
- **Condition 1:**
  - (a) and (b) exist, with precondition guards that throw `precondition not met`, and F8 turns both red.
  - `live-reload.spec.ts` has 0 diff and is green: `ok 45 tests\e2e\live-reload.spec.ts:38:1 › shows a visible error state when the open file is deleted, and does not crash`.
  - chokidar `close()` calls `removeAllListeners()` synchronously, and `documentSession.close()` calls `stopWatching()` synchronously.
- **Condition 3:** each defined behaviour is verified:
  - warn: R3a and R3c are red without it;
  - temp file deleted: (c) and (e) assert no `*.tmp`;
  - in-memory settings kept: (e) checks the checkmark and dark class;
  - no unhandled rejection: F9 is red with `"Error: EPERM: operation not permitted, rename '...settings.json.10596.1.tmp' -> '...settings.json'"`;
  - full object on the next write: (e) `toEqual({ View: { 'Dark Mode': true, ... } })`;
  - self-heal contained: R3b is red with EPERM;
  - `ensureSettingsFileExists` contained: by code reading (N1).
  - `settingsStore` stays a throwing adapter. CI runs on `windows-latest`, so the `runIf(win32)` case executes there.
- **Condition 4:**
  - The capture only runs when `setupFailed || status !== expectedStatus`.
  - It is wrapped in try/catch, with a race against a 2000 ms timer and `clearTimeout` in `finally`.
  - Teardown order: `try { app.close() } finally { attachIfFailed }`, which runs before the `userDataDir` fixture's `rmSync`. A capture error cannot replace `app.close()`'s error, because `attachIfFailed` never throws.
  - Verified by R6 (throws on every test) and R7 (hangs on every test): results were unchanged.
  - A real failure produced an attachment.

### 3. H2 helper, D4 capture on a real failure (R1, test (c))
```
attachment #1: electron-failure-capture (text/plain) ───
process: exited
exit code: 0 (0x00000000)
signal: none
--- stderr tail ---
Debugger ending on ws://127.0.0.1:60824/...
--- Crashpad ---
(not listed: ENOENT)
```
This confirms the Crashpad observation: the directory is never created. D4 still captures the exit code, signal and stderr as specified, so a fast-fail is identifiable. See S1 for the exit-timing ambiguity.

## Fault-injection table

Every fault was applied through a Bash edit. For each one:
- the patch was captured as `diff -u` in the OS temp scratchpad;
- it was reverted with `git -c core.autocrlf=false apply -R`, then `cmp` against a pre-fault copy, with output `REVERTED+CMP OK: <file>`;
- `npm run build` ran before every e2e observation that involved `src`.

| # | Fault | Result | Raw evidence |
|---|---|---|---|
| F1 | remove `awaitWriteFinish` | RED, but not deterministic (B1) | `× ... delivers a notification after the final write ... (#180/#181) 3023ms`, 6/6 when run alone; full file 6/8 red on the H1 case (plus 1a red: `expected [ { action: 'render', …(1) } ] to deeply equal []`) |
| F2 | helper made a no-op (`if (target) return;`) | RED (b), (c) | `Error: waitForRendererReady resolved while the renderer was held`; `Error: expect(received).rejects.toThrow()`; `2 failed / 1 passed` |
| F4 | drop the `view-menu` second-launch helper call | RED | `× ... every spec that launches Electron directly calls waitForRendererReady at least once per launch` → `expected [ { name: 'view-menu.spec.ts', …(2) } ] to deeply equal []` |
| F6 | `writeSettingsFile` back to plain `fs.writeFile` | RED ×3 | concurrent-reader case `expected [ Array(14) ] to deeply equal []`; 3c `promise resolved "undefined" instead of rejecting`; 3d `expected '{\n  "View"...' to be '{ corrupt and held'` |
| F8 | deferred `close()` (500 ms) | RED on 1a and 1b | 1a `expected [ { action: 'render', …(1) } ] to deeply equal []`; 1b `+ Array [ 1790517132791, ]`, `1 failed` |
| F9 | remove the `persistCurrentViewSettings` catch | RED | `expect(probe.rejections).toEqual([])` received `"Error: EPERM: operation not permitted, rename ..."` |
| R1 (own) | drop the URL clause | RED (c) only | `Error: expect(received).rejects.toThrow()`; `1 failed / 2 passed` |
| R2 (own) | application form resolves on any window | **nothing red → B2** | full e2e `158 passed (3.0m)` |
| R3a (own) | self-heal catch swallows without warning | RED 3d | `expected "warn" to be called at least once` |
| R3b (own) | remove the self-heal try/catch | RED 3d | `EPERM: operation not permitted, rename '...settings.json.13044.9.tmp' -> '...settings.json'` |
| R3c (own) | `index.ts` warning made silent | RED (e) | `expect(received).toBeGreaterThan(expected) Expected: > 0 Received: 0` |
| R4 (own) | `RENAME_MAX_ATTEMPTS = 1` | RED ×2 | `× writeAppStateFile > retries transient EPERM ...`; `× ... succeeds when the holding handle is released mid-retry (condition 3c)` → `EPERM ... rename` |
| R6 (own) / F10 | capture runs on passing tests AND throws | unchanged (by design) | `[failureCapture] capture failed: Error: R6 injected capture failure` ×9; `10 passed (12.0s)` |
| R7 (own) | capture runs on every test AND hangs | bounded to 2 s, unchanged | `[failureCapture] gave up after 2000 ms`; tests went from ~1.2 s to ~3.1 s each; `7 passed (21.8s)` |

## Deviation verdicts

| Dev | Verdict | Reasoning |
|---|---|---|
| (a) `waitForRendererReady(app)` at the whats-new site | Accept (test gap = B2) | No `firstWindow()` exists at that site, and What's New can be the first window. The design is sound, but the form is untested. |
| (b) 6 direct launches, not 7 | Accept | Confirmed by grep: view-menu :128 is a comment. |
| (c) `setupFailed` passed to capture | Accept | Setup failures would otherwise go uncaptured (status not final yet). Untested (S3). |
| (d) file-level passthrough `vi.mock` | Accept, Non-blocking | Inert for the existing cases (see Evidence §1). |
| (e) 1b write and Close in one main-side evaluate | Accept | This is stricter: one clock, no IPC stretch. See N2. |
| (f) 3c EPERM `it.runIf(win32)` | Accept | EPERM-on-open-handle is Windows semantics, and CI is `windows-latest`. |
| (g) preconditions as thrown Errors | Accept | They fail and are never skipped, so there is no masking. The B1 escape bypasses them. |
| Obs: `close-document:221` not reproduced | Accept | 0/3 in my runs too. Correctly "unconfirmed; capture in place" (#187). |
| Obs: no Crashpad directory | Accept, Non-blocking | Confirmed (`ENOENT`). The exit code, signal and stderr are still captured, so D4's specified value holds for the fast-fail class. Enabling Crashpad would be a production change and is out of scope. |
| Obs: `window-chrome:124` | Pre-existing, Non-blocking (S2) | See the diagnostic below. The test itself was unchanged apart from the helper insertion. Task 47 did not cause it and does not measurably worsen it. |

**`window-chrome:124` diagnostic (targeted, reported separately from the done-criterion runs):** `--repeat-each=40 --workers=4`.
- With the helper: `1 failed / 39 passed` three times, so **3/120**.
- With the helper transiently removed (patch D1, reverted plus `cmp` OK): `40 passed`, `40 passed`, `2 failed / 38 passed`, `40 passed`, `2 failed / 38 passed`, `1 failed / 39 passed`, so **5/240**.

Every failure was `Error: locator.click: Target page, context or browser has been closed`. The rates are the same, so this is a pre-existing race between a click that closes its own page and Playwright's click completion.

## Done-criterion runs (#188)

Each run: `rm -rf dist && npm run build`, then `npm run test:unit`, `npm run test:integration`, `npx playwright test` (config `workers: 2`, no retries).

| Run | build | unit | integration | e2e |
|---|---|---|---|---|
| 1 (10:31:48-10:35:21) | rc=0 | `Tests  251 passed (251)` | `Tests  67 passed (67)` | `158 passed (3.3m)` |
| 2 (10:35:38-10:39:11) | rc=0 | `Tests  251 passed (251)` | `Tests  67 passed (67)` | `158 passed (3.3m)` |
| 3 (10:39:17-10:43:04) | rc=0 | `Tests  251 passed (251)` | `Tests  67 passed (67)` | `158 passed (3.5m)` |

**3 of 3 consecutive fully green runs.** Every e2e log begins `Running 158 tests using 2 workers`, has 158 `ok` lines, has 0 bytes of stderr, and contains no flaky or skipped entries.

New tests in run 3:
- `ok 3 close-pending-reload.spec.ts:70:1`
- `ok 55/57/59 renderer-ready.spec.ts (a)/(b)/(c)`
- `ok 61 settings-locked.spec.ts:58:5`
- `ok 125 view-menu.spec.ts:192:5 (g)`
- `ok 138 window-chrome.spec.ts:124:7`

The faults ran after these runs. Every file was restored byte-identical (sha1 check below), so the tested tree equals the reviewed tree.

## Temp hygiene

- The engineer's `md-view-t47-fi`, `md-view-watcher-47-*`, `md-view-e2e-pending-*` and `md-view-settingsStore-*` are not present in `%TEMP%`, and nothing stray is in the repo.
- My own runs created 292 `playwright-artifacts-*` and 4 `md-view-copy-raw-source-*` directories, from the pre-existing `ui-shell.spec.ts:305`, which never cleans up. I deleted them, and `%TEMP%` now matches my baseline apart from one unrelated GUID `.tmp` that is not mine.
- My scratchpad (probe, patches, logs, pristine copies) was deleted and holds 0 entries. `rv47*` count: 0.
- Pre-existing leftovers not caused by Task 47, which a backlog note could cover: about 100 `md-view-copy-raw-source-*` from `ui-shell.spec.ts:305`, about 120 `md-view-e2e-*` (one from 08:14 today), and 35 `mdv-lazy-*` from 2026-09-26.

## Backstop

- `sha1sum -c` against the start-of-review hashes of all 23 changed or untracked files, including the ndjson: **all OK**.
- `diff status_before status_after`: **STATUS IDENTICAL** (the 23-line listing in §1).
- `git diff --stat` at the end, identical to the start:
```
 .agents/metrics/test-tier-invocations.ndjson |  45 +++
 .agents/specs/functional_domain.md           | 101 +++++++
 .agents/specs/initial_scaffold.md            | 436 +++++++++++++++++++++++++++
 src/main/appStateStore.ts                    |  42 +--
 src/main/index.ts                            |  24 +-
 src/main/settingsStore.ts                    |  17 +-
 src/main/watcher.ts                          |  17 +-
 tests/e2e/support/fixtures.ts                |  24 +-
 tests/e2e/tree-panel.spec.ts                 |   3 +
 tests/e2e/view-menu.spec.ts                  |   3 +
 tests/e2e/whats-new.spec.ts                  |   2 +
 tests/e2e/window-chrome.spec.ts              |   2 +
 tests/integration/settingsStore.test.ts      | 119 ++++++++
 tests/integration/watcher.test.ts            | 106 +++++++
 14 files changed, 895 insertions(+), 46 deletions(-)
```

**Hooks:** no project hook blocked anything. Claude Code's built-in safety check blocked one scratchpad cleanup, `rm -rf "$SP"/*`, because the variable could expand to `/`. I re-ran it with the literal absolute path, as the check itself suggested, and it succeeded (0 entries left).

## Routing (for the Lead)

Send B1 and B2 back to `full-stack-engineer` as one narrow task. Only these two in-scope files change:
- **`tests/integration/watcher.test.ts`:** for the H1 case, count only callbacks after the first one (index-based, or strict `>`). Reverify with F1 over at least 10 full-file runs: expect 10/10 red, with no vacuous pass.
- **`tests/e2e/renderer-ready.spec.ts`:** add a hold-gate case for `waitForRendererReady(electronApp)`. Reverify with R2: it must go red.

Please also log S2 (`window-chrome:124`, pre-existing, about 2% at 4 workers) and the `ui-shell.spec.ts:305` temp leak in `backlog.md`.

Relevant files:
- `C:\Source\md-view\tests\integration\watcher.test.ts`
- `C:\Source\md-view\tests\e2e\renderer-ready.spec.ts`
- `C:\Source\md-view\tests\e2e\support\rendererReady.ts`
- `C:\Source\md-view\tests\e2e\support\fixtures.ts`
- `C:\Source\md-view\tests\e2e\support\failureCapture.ts`
- `C:\Source\md-view\tests\e2e\window-chrome.spec.ts`
- `C:\Source\md-view\.agents\specs\backlog.md`

---

## Re-review (round 2): B1 and B2 fixes

**Reviewer:** code-reviewer (independent, read-only). **Date:** 2026-09-27.
**Scope of this round:** verify the fixes for B1 and B2, run the full gate, and attribute the temp leak.

### Verdict: APPROVE WITH NON-BLOCKING

- **B1 is closed.** Under F1 the full watcher file was red 15/15, always on the real assertion rather than the precondition guard. It was green 3/3 after the revert.
- **B2 is closed.** R2 (the application form accepting any window) now turns (d), (e) and (f) red.
- **The done criterion is met.** Runs 3, 4 and 5 were consecutive fully green runs.
  - Run 2 failed on `close-document.spec.ts:221`, which is **reproduced for the first time**.
  - D4 captured it: a native abort in Electron. The diff does not cause it (details below).
- **New non-blocking items:**
  - N5: my fault R8 is detected only at random (1-2 failures per 75 runs).
  - S1 has become more important: the one real crash was captured *without* an exit code.

### 1. Diff scope

`sha1sum` compared with the start of round 1:

| File | Round 1 | Now | |
|---|---|---|---|
| `tests/integration/watcher.test.ts` | `ccbe9293…` | `afc42c77…` | **changed (B1)** |
| `tests/e2e/renderer-ready.spec.ts` | `aadfe814…` | `df800038…` | **changed (B2)** |
| `.agents/metrics/test-tier-invocations.ndjson` | `5cb0abd4…` | `3a998cec…` | hook |
| `.agents/specs/review_report_task47.md` | absent | `5456bd09…` | Lead-persisted report |
| `src/main/appStateStore.ts` | `23f7dc3f…` | `23f7dc3f…` | same |
| `src/main/index.ts` | `4d3bb6f4…` | `4d3bb6f4…` | same |
| `src/main/settingsStore.ts` | `d132b9b3…` | `d132b9b3…` | same |
| `src/main/watcher.ts` | `ffaa2fac…` | `ffaa2fac…` | same |
| `src/main/atomicWriteFile.ts` | `34f94b0f…` | `34f94b0f…` | same |
| `tests/e2e/support/fixtures.ts` | `fb6794d3…` | `fb6794d3…` | same |
| `tests/e2e/support/rendererReady.ts` | `f2503576…` | `f2503576…` | same |
| `tests/e2e/support/failureCapture.ts` | `5e802b51…` | `5e802b51…` | same |
| `tests/e2e/tree-panel.spec.ts` | `07e769d1…` | `07e769d1…` | same |
| `tests/e2e/view-menu.spec.ts` | `f49588aa…` | `f49588aa…` | same |
| `tests/e2e/whats-new.spec.ts` | `8a644fad…` | `8a644fad…` | same |
| `tests/e2e/window-chrome.spec.ts` | `744682bf…` | `744682bf…` | same |
| `tests/integration/settingsStore.test.ts` | `cd837afe…` | `cd837afe…` | same |
| `tests/e2e/close-pending-reload.spec.ts` | `5c45c007…` | `5c45c007…` | same |
| `tests/e2e/settings-locked.spec.ts` | `d41f94b5…` | `d41f94b5…` | same |
| `tests/unit/e2eReadiness.test.ts` | `03b8a0aa…` | `03b8a0aa…` | same |
| `tests/unit/failureCapture.test.ts` | `5627f091…` | `5627f091…` | same |
| `.agents/specs/functional_domain.md` | `14febf76…` | `14febf76…` | same |
| `.agents/specs/initial_scaffold.md` | `6fbcbaea…` | `6fbcbaea…` | same |
| `.agents/current_scope.json` | `ef826572…` | `ef826572…` | same |

`git diff --stat` differs from round 1 only on these two lines:
- `watcher.test.ts | 112 +++` (it was 106)
- ndjson `46` (it was 45)

The total is `14 files changed, 902 insertions(+), 46 deletions(-)`. Only the two expected files changed.

### 2. B1: `watcher.test.ts`, H1 case

**Reading the code.** The poll is now:

```ts
callbacks.slice(truncateCallbackIndex + 1).filter((c) => c.action === 'render').length
```

with `truncateCallbackIndex = 0`. The precondition guard `delay >= 40` is kept. I checked whether it can still pass vacuously:
- **Two callbacks for the truncate.** For a vacuous pass, a second callback would have to arrive *between* the truncate's callback and the write, which is less than 40 ms.
  - Without `awaitWriteFinish` (F1), that window lies inside chokidar's 50 ms leading-edge `change` throttle (`index.js:506`), so such a callback is dropped.
  - With `awaitWriteFinish`, a callback needs 100 ms of stability.
  - Any extra callback therefore comes after the write, which means a read after the write. That is exactly what #180 requires.
- **The index assumption.** `waitForReady` precedes the truncate and `ignoreInitial: true` is set, so index 0 is the truncate's callback.

**F1** (captured patch; build not needed, integration only):

```
-  const watcher = chokidar.watch(filePath, { ignoreInitial: true, awaitWriteFinish: WATCH_WRITE_FINISH });
+  const watcher = chokidar.watch(filePath, { ignoreInitial: true });
```

Full `watcher.test.ts`, 15 consecutive runs, every line identical in shape:

```
   × H1-case 3033ms       Tests  2 failed | 3 passed (5)
   ... (15/15; the second failure is condition 1a, as in round 1)
```

Failure reason, from a single-case run:

```
     → Matcher did not succeed in 3000ms
Caused by: AssertionError: expected 0 to be greater than or equal to 1
```

This is the real assertion, not `precondition not met`.

Revert: `git -c core.autocrlf=false apply -R` then `cmp`, which printed `REVERTED+CMP OK`. GREEN afterwards:

```
      Tests  5 passed (5)
      Tests  5 passed (5)
      Tests  5 passed (5)
```

**B1 is closed.**

### 3. B2: `renderer-ready.spec.ts`

**Reading the code.**
- **Hold targeting.** `holdRendererBeforePageScripts` and `releaseRenderer` pick `BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().startsWith('data:'))`.
  - This is robust here. The only other window is the What's New `data:` window, and the fixture has already waited for the main window to load before the test runs, so main is not on `about:blank` at hold time.
  - (c) still uses `getAllWindows()[0]`, but only in the single-window default setup, so it is safe.
- **(d)** repeats (b) with `waitForRendererReady(electronApp)`. It is deterministic: 1 s of no resolution is asserted while `paused === true`.
- **(e)** asserts 2 windows and that the `data:` window is `complete`, then holds main. This proves that the application form does not resolve while main is held and What's New is present.
  - As the engineer says, it cannot prove *why* the `data:` window is refused. My R8 run below confirms that main is `windows()[0]` in this setup.
- **(f)** runs with nothing paused: main is on `about:blank` (asserted as `['about:blank','complete']`) and `data:` is `complete` (asserted). The helper must reject with `/renderer not ready/`.
  - Can it pass for the wrong reason? With nothing paused, `evaluate` cannot block. Both windows are asserted to exist and be `complete`. So the only thing that can refuse them is the URL clause.
  - Residual gap: the window count is asserted before the navigation, not at the moment the helper runs. That is a nit.
- **Determinism.** On unmodified code, `--repeat-each=10` gave `60 passed (1.6m)`.

**R2** (after `npm run build`):

```
-      if (await isRendererReady(page)) return;
+      if (isApp || (await isRendererReady(page))) return;
  ok 1 ... (a) ...   ok 2 ... (b) ...   ok 3 ... (c) ...
    Error: waitForRendererReady(app) resolved while the main renderer was held    [(d)]
    Error: waitForRendererReady(app) resolved while the main renderer was held    [(e)]
    Error: expect(received).rejects.toThrow()                                     [(f)]
  3 failed
  3 passed (24.4s)
```

Reverted, and `cmp` printed `REVERTED+CMP OK`. **B2 is closed.**

**R8 (my own fault, not R2):** the application form checks only the first window.

```
-    const pages = isApp ? (target as ElectronApplication).windows() : [target as Page];
+    const pages = isApp ? (target as ElectronApplication).windows().slice(0, 1) : [target as Page];
```

- `renderer-ready.spec.ts`: **`6 passed (14.6s)`**. Nothing is red: (d) and (e) block on main, and (f) rejects on main's `about:blank`.
- `whats-new.spec.ts` plus `renderer-ready.spec.ts` with `--repeat-each=5`:
  - first run: `2 failed / 73 passed`, both with `Error: waitForRendererReady: renderer not ready after 15000 ms`;
  - second run: `1 failed / 74 passed`, at `whats-new.spec.ts:104:7 › seeded with an older version › opens a second window ...`.

So R8 is caught only at random, when Playwright happens to list the `data:` window first, and it shows up as a 15 s timeout. It is loud, never a silent pass, but it is not deterministic. This is **N5 (Non-blocking)**. The fault is exactly the scenario the application form exists for: `firstWindow()` being the What's New window, measured at 3/20 launches in round 1. A deterministic test would need the `data:` window listed first, which the test cannot control. One option: a unit-level test of the window loop with fake `Page` objects in `tests/unit`.

Reverted, and `cmp` printed `REVERTED+CMP OK`.

### 4. Full gate (#188)

Each run: `rm -rf dist && npm run build`, then `npm run test:unit`, `npm run test:integration`, `npx playwright test` (`workers: 2`, no retries).

| Run | Time | Unit | Integration | E2E | e2e stderr |
|---|---|---|---|---|---|
| 1 | 11:38:54-11:42:26 | `Tests  251 passed (251)` | `Tests  67 passed (67)` | `Running 161 tests using 2 workers` / `161 passed (3.2m)` | 0 B |
| 2 | 11:42:30-11:46:22 | `Tests  251 passed (251)` | `Tests  67 passed (67)` | `1 failed` / `160 passed (3.5m)` | 0 B |
| 3 | 11:46:43-11:50:17 | `Tests  251 passed (251)` | `Tests  67 passed (67)` | `161 passed (3.3m)` | 0 B |
| 4 | 11:50:21-11:54:07 | `Tests  251 passed (251)` | `Tests  67 passed (67)` | `161 passed (3.4m)` | 0 B |
| 5 | 11:54:12-11:58:04 | `Tests  251 passed (251)` | `Tests  67 passed (67)` | `161 passed (3.5m)` | 0 B |

- **Runs 3, 4 and 5 are 3 consecutive fully green runs.** No run log contains "flaky" or "skipped".
- The count 161 = 158 + (d) + (e) + (f).

**Run 2 failure: `close-document.spec.ts:221` (#187), with the D4 capture (raw):**

```
1) tests\e2e\close-document.spec.ts:221:1 › (d) the title-bar File popup carries menu-close at index 2 and its enabled state mirrors occupancy (#151)
   Error: electronApplication.evaluate: Target page, context or browser has been closed
     > 50 |   await app.evaluate(({ dialog }, targetPath) => {      (stubOpenDialog <- openViaMenu <- close-document.spec.ts:255)
   Error: EPERM, Permission denied: \\?\C:\Users\ADMINI~1\AppData\Local\Temp\md-view-e2e-cRMBMQ
     > 43 |     fs.rmSync(dir, { recursive: true, force: true });     (support\fixtures.ts:43)
   attachment #1: electron-failure-capture (text/plain)
   process: still running at capture time
   --- stderr tail ---
   length_error was thrown in -fno-exceptions mode with message "basic_string"
   --- Crashpad ---
   (not listed: ENOENT)
```

Analysis, based only on this evidence:
1. **Mechanism.** The Electron main process aborted natively. libc++ reports `length_error` ... `-fno-exceptions`, so the process terminates. The abort came after the first File popup had been shown and `closePopup()` had been called from main, and before the next `app.evaluate` (`:255`).
   - This is a crash inside Electron/Chromium native menu code, reached through `Menu.popup`/`closePopup`.
   - Task 47 touches none of that. Menus, `index.ts` menu code and the renderer have 0 diff, and `close-document.spec.ts` is byte-identical.
   - **Classification:** a native Electron crash, pre-existing and not caused by Task 47. It is now *confirmed with evidence* rather than "unconfirmed". The `3221226505` (Task 19) link is still unproven, because no exit code was captured (see below).
2. **D4 worked, with a gap.** It produced the only evidence that exists for this crash. However, it reported `still running at capture time`: the child's `exit` event had not fired yet when the capture ran after `app.close()`. So **no exit code was recorded**, which is exactly the datum #187 needs to link this crash to the Task 19 fast-fail class. **S1 rises in priority** (it stays Non-blocking): wait a bounded time for `exit` inside the 2 s budget before formatting.
3. **A second pre-existing symptom.** Because the dying process still held files, the `userDataDir` fixture's `rmSync` threw EPERM, leaking `md-view-e2e-cRMBMQ` into `%TEMP%`. This explains the roughly 120 `md-view-e2e-*` leftovers seen in round 1. That is **N6 (Non-blocking, backlog)**.

### 5. Temp-leak attribution (the engineer and I disagreed)

**Creating code:** the only creator is `tests/e2e/ui-shell.spec.ts:305`, at **describe-collection (module) scope**:

```ts
const rawFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-copy-raw-source-'));
...
test.afterAll(() => { fs.rmSync(rawFixtureDir, { recursive: true, force: true }); });
```

The only other hits are the `#copy-raw-source` element id and the IPC channel name `md-view:copy-raw-source`.

**Measured** (count of `%TEMP%\md-view-copy-raw-source-*`):

```
before unit: 105
      Tests  251 passed (251)
after unit: 105
      Tests  67 passed (67)
after integration: 105
  10 passed (16.9s)
after e2e ui-shell only: 106
Total: 10 tests in 1 file
after --list only: 107
```

**Conclusion:** the engineer's attribution is wrong; the round-1 attribution to `ui-shell.spec.ts:305` (e2e) is right.
- The unit tier leaves **0** behind.
- Each Playwright invocation that loads `ui-shell.spec.ts` leaves **1**, even `--list` with no tests executed.
- The directory is created when the file is collected in the runner process, but `afterAll` only runs in the worker that executes the tests.

Cross-check: this round left 7 = 5 gate runs + 1 ui-shell run + 1 `--list`. Suggested backlog wording: "`ui-shell.spec.ts:305` mkdtemps at module scope; the Playwright runner's collection pass creates a copy that no `afterAll` removes; ~1 leaked dir per e2e invocation. Fix: create the directory inside a fixture or `beforeAll`."

### 6. Open items after this round (all Non-blocking)

| ID | Item |
|---|---|
| S1 | D4 runs after `app.close()`, so the exit is misreported or missing. It is now proven in practice: run 2's real crash has no exit code. Wait a bounded time for `exit` before formatting. **Recommended before closing #187.** |
| S2 | `window-chrome:124` is pre-existing (3/120 with the helper, 5/240 without). Log it in the backlog. |
| S3 | Nothing tests the D4 status guard or the `setupFailed` wiring. |
| N1 | `onOpenSettings` containment is untested. |
| N2 | 1b does not assert that a write-finish check was actually pending at Close. |
| N3 | The #185 scan counts per file, not per launch site. |
| N4 | The `appStateStore.ts` comment was reworded. Accepted. |
| **N5 (new)** | The application form's multi-window loop is covered only at random: R8 (`windows().slice(0,1)`) turns nothing red deterministically, and only 1-2 of 75 `whats-new` runs time out. |
| **N6 (new)** | When a test's Electron process dies, the `userDataDir` fixture's `rmSync` throws EPERM and leaks `md-view-e2e-*`. Pre-existing. Backlog. |
| **N7 (new, #187)** | `close-document:221` is reproduced (1 of 5 runs): a native libc++ `length_error` abort after `Menu.popup`/`closePopup`. Record it in the backlog as confirmed evidence, not caused by Task 47. Its exit-code link to Task 19's class is pending S1. |
| Nit | B1: `slice(1)` is sound. Adding `c.at >= writtenAt` as well would be belt-and-braces. (f): re-assert the window count at the moment the helper runs. |

### 7. Temp hygiene and backstop

- **OS temp.** Diffed against a baseline taken at the start of this round. The entries I created were 30 `playwright-artifacts-*`, 7 `md-view-copy-raw-source-*` and 1 `md-view-e2e-cRMBMQ` (the run-2 crash leak). All 38 were deleted.
  - The final diff against the baseline is only `28e1bbdb-772e-419c-b165-3307dbd54c99.tmp`, a GUID file not created by the test suite, so it is left alone.
  - No `md-view-t47*`, `md-view-watcher-47*`, `md-view-e2e-pending*` or `md-view-settingsStore*` entries exist.
- **Scratchpad.** Deleted by literal path, leaving `0` entries.
- **Hooks.** No project hook or built-in check blocked anything this round.
- **Faults.** F1, R2 and R8 were each reverted with `git -c core.autocrlf=false apply -R`, and `cmp` printed `REVERTED+CMP OK` each time.

Final `git status --short --untracked-files=all`, identical to step 1:

```
 M .agents/metrics/test-tier-invocations.ndjson
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M src/main/appStateStore.ts
 M src/main/index.ts
 M src/main/settingsStore.ts
 M src/main/watcher.ts
 M tests/e2e/support/fixtures.ts
 M tests/e2e/tree-panel.spec.ts
 M tests/e2e/view-menu.spec.ts
 M tests/e2e/whats-new.spec.ts
 M tests/e2e/window-chrome.spec.ts
 M tests/integration/settingsStore.test.ts
 M tests/integration/watcher.test.ts
?? .agents/current_scope.json
?? .agents/specs/review_report_task47.md
?? src/main/atomicWriteFile.ts
?? tests/e2e/close-pending-reload.spec.ts
?? tests/e2e/renderer-ready.spec.ts
?? tests/e2e/settings-locked.spec.ts
?? tests/e2e/support/failureCapture.ts
?? tests/e2e/support/rendererReady.ts
?? tests/unit/e2eReadiness.test.ts
?? tests/unit/failureCapture.test.ts
```

Final `git diff --stat`, identical to step 1:

```
 .agents/metrics/test-tier-invocations.ndjson |  46 +++
 .agents/specs/functional_domain.md           | 101 +++++++
 .agents/specs/initial_scaffold.md            | 436 +++++++++++++++++++++++++++
 src/main/appStateStore.ts                    |  42 +--
 src/main/index.ts                            |  24 +-
 src/main/settingsStore.ts                    |  17 +-
 src/main/watcher.ts                          |  17 +-
 tests/e2e/support/fixtures.ts                |  24 +-
 tests/e2e/tree-panel.spec.ts                 |   3 +
 tests/e2e/view-menu.spec.ts                  |   3 +
 tests/e2e/whats-new.spec.ts                  |   2 +
 tests/e2e/window-chrome.spec.ts              |   2 +
 tests/integration/settingsStore.test.ts      | 119 ++++++++
 tests/integration/watcher.test.ts            | 112 +++++++
 14 files changed, 902 insertions(+), 46 deletions(-)
```

Key hashes after the backstop, all unchanged from step 1:
- `src/main/watcher.ts` `ffaa2fac…`
- `tests/e2e/support/rendererReady.ts` `f2503576…`
- `tests/integration/watcher.test.ts` `afc42c77…`
- `tests/e2e/renderer-ready.spec.ts` `df800038…`
- `.agents/specs/review_report_task47.md` `5456bd09…`
- ndjson `3a998cec…`

Relevant files:
- `C:\Source\md-view\tests\integration\watcher.test.ts`
- `C:\Source\md-view\tests\e2e\renderer-ready.spec.ts`
- `C:\Source\md-view\tests\e2e\support\rendererReady.ts`
- `C:\Source\md-view\tests\e2e\support\failureCapture.ts`
- `C:\Source\md-view\tests\e2e\support\fixtures.ts`
- `C:\Source\md-view\tests\e2e\close-document.spec.ts`
- `C:\Source\md-view\tests\e2e\ui-shell.spec.ts`
- `C:\Source\md-view\.agents\specs\backlog.md`

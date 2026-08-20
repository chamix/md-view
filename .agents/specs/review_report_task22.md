# Independent Review Report — Task 22

## Scope

Task 22: Replace fixed-wait layout reads with `pollUntilStable` in `tests/e2e/ui-shell.spec.ts`, per `.agents/specs/functional_domain.md` "Task 22" (lines 1222-1271) and `.agents/specs/initial_scaffold.md` "Task 22 Technical Specification" (lines 3039-3172+), scoped by `.agents/current_scope.json`.

## 1. Scope compliance — PASS

`current_scope.json` grant:
```
tests/e2e/support/pollUntilStable.ts
tests/e2e/ui-shell.spec.ts
tests/unit/pollUntilStable.test.ts
.agents/specs/backlog.md
.agents/DEVLOG.md
.agents/metrics/RUN_LOG.md
```

Actual `git status --porcelain=v1`:
```
 M .agents/DEVLOG.md
 M .agents/specs/backlog.md
 M tests/e2e/ui-shell.spec.ts
?? .agents/current_scope.json
?? tests/e2e/support/pollUntilStable.ts
?? tests/unit/pollUntilStable.test.ts
```

Every touched path is inside the grant. `git diff -- .agents/metrics/RUN_LOG.md` returned no output — genuinely untouched, correctly per instructions (RUN_LOG update happens at Step 3, not during implementation). `current_scope.json` being untracked (`??`) is expected under this repo's workflow — it's a working-tree contract file, never committed. No out-of-scope file was touched. **Zero scope violations.**

## 2. Implementation fidelity to the authoritative spec — PASS

`git diff -- tests/e2e/ui-shell.spec.ts` (both hunks): confirmed both check (g) (lines 112-131) and check (h) (lines 133-154) had their `await window.waitForTimeout(100);` + single-shot `.evaluate()` replaced with `await pollUntilStable(() => documentContainer.evaluate(...))`, with every `expect(...)` line byte-identical before/after. Diffed the delivered `tests/e2e/support/pollUntilStable.ts` against the spec's literal code block (`initial_scaffold.md` lines 3070-3102) — the only differences are added header comments and Prettier trailing commas; the `sameValues`/`pollUntilStable` logic, defaults (`stableReads: 5`, `intervalMs: 20`, `timeoutMs: 5000`), and error message are character-for-character identical.

Guardrail check (all from `functional_domain.md` §Task 22):
- **#28** (no threshold change): confirmed via diff — every `expect(...)` line unchanged.
- **#29** (real timeout ceiling, clear error): confirmed in code and by fault-injection below.
- **#30** (no duplicated polling logic): confirmed — one `pollUntilStable` import, called twice with different field-set closures.
- **#31** (no other test/file/`src/**` touched): confirmed via `git diff --stat -- tests/e2e/ui-shell.spec.ts` → `1 file changed, 20 insertions(+), 19 deletions(-)`, and full `git status` shows no other test file modified.
- **#32** (check (g)'s 1px-band comment untouched): confirmed at lines 125-127, verbatim.

## 3. Unit tests — run independently, PASS, non-tautological

```
npm run test:unit
 Test Files  17 passed (17)
      Tests  91 passed (91)
```
Includes `tests/unit/pollUntilStable.test.ts (5 tests)`. Two `sameValues` tests (true/false on real key differences) and three `pollUntilStable` tests — settles-correctly, stops-exactly-at-N-and-asserts-`read`-call-count (`expect(read).toHaveBeenCalledTimes(4)`), and throws-with-regex-matched-message-on-timeout. These assert behavior and call count, not just a mocked return value.

**Fault injection #1** (added an extra unnecessary `read()` call after stability reached): RED — the "not over-polling" test failed on both the value (`{marginLeft: 999}` instead of `{marginLeft: 32}`) and the call-count assertion.
**Fault injection #2** (broke the streak-reset logic: `consecutive = consecutive + 1` instead of `sameValues(...) ? consecutive+1 : 1`): RED on all 3 `pollUntilStable` tests (wrong settled value, wrong call count, and the timeout test no longer throws at all — it falsely resolves).
Restored the original file after each fault; re-ran → 91/91 GREEN; `git status --porcelain=v1 -- tests/e2e/support/pollUntilStable.ts` confirmed unchanged before/after. Tests are genuinely load-bearing, not tautological.

`npx tsc --noEmit`: clean, no output.

## 4. Real-world confidence check — independently reproduced, confirms the engineer's honest finding

Built (`npm run build`, clean) and ran independently:

**`npx playwright test tests/e2e/ui-shell.spec.ts --repeat-each=20`** (60 executions): **53 passed, 7 failed**. All 7 failures on the identical line:
```
Error: expect(received).toBeGreaterThan(expected)
Expected: > 800
Received:   126.4   (also 562.4 in other failures)
  151 |     expect(containerBox.width).toBeGreaterThan(800);
```
Same assertion, same drastically-low (not near-miss) values the engineer reported (11/60 for them, 7/60 for the reviewer — same order of magnitude, same failure signature). Check (g)'s `marginLeft`/`marginRight` assertions: **zero failures** across all 60 runs.

**Full suite (`npx playwright test --reporter=line`) 5x at default `workers: 2`**:

| Run | Result |
|---|---|
| 1 | 44 passed |
| 2 | 43 passed, 1 failed — `live-reload.spec.ts:28` (unrelated, pre-existing Task-19-class flake, not this task's diff) |
| 3 | 44 passed |
| 4 | 44 passed |
| 5 | 44 passed |

0/5 full-suite runs hit the `ui-shell.spec.ts` width assertion; 1/5 hit an unrelated flake on a file this task never touched. This is not worse — arguably better — than Task 21's documented baseline (`review_report_task21.md` lines 93-101): 4 of 6 `workers: 2` full-suite runs failed on `marginLeft > 32` (near-miss values like 31.2).

**Direct causal verification (reviewer's own throwaway diagnostic, not just trusting the engineer's theory):** wrote `tests/e2e/_diagnostic-task22.spec.ts` (deleted after use — `git status` confirmed clean before and after), sampling `BrowserWindow.getBounds()` (main process) and the renderer's `window.innerWidth`/`getComputedStyle(documentContainer).width` every ~15ms for 500ms after the 1600×900 resize, across 6 runs. Result:
- Main-process bounds report the new width (1600) within **4-9ms**, every run.
- Renderer's `window.innerWidth`/computed width stayed frozen at the **pre-resize value** (886-887 / 562.4-563.2, matching the exact class of wrong values seen in the actual test failures) for **400-505ms** in 4 of 6 runs — in one run it never updated within the 500ms sampling window at all. Only 2 of 6 runs had the renderer already caught up by the time sampling started.

This is a direct, first-hand confirmation of the engineer's stale-renderer-value mechanism: since the stale value is perfectly constant across dozens of consecutive samples, `pollUntilStable`'s 5-consecutive-match/20ms-interval criterion (satisfiable in as little as ~100ms) will reliably lock onto the wrong pre-resize value long before the renderer actually updates in the worst-case runs. The mechanism is real, not speculative.

One discrepancy worth flagging: `backlog.md` states the lag is "up to ~280ms"; the reviewer's own measurement saw lag up to ~480-500ms (and one run where it hadn't resolved within the 500ms window). This doesn't contradict the mechanism — contention-based lag is inherently session/load-variable — but the true worst case may be larger than currently documented, which if anything strengthens (not weakens) the case that `pollUntilStable`'s ~100ms best-case stabilization window is too short specifically for this call site.

## 5. Backlog/DEVLOG close-out accuracy — PASS

`git diff -- .agents/specs/backlog.md`: the Task 22 update is appended as a nested `**Update (Task 22):**` paragraph under the existing `[Pending — priority raised] E2E parallel-contention flakiness` item (line 261), following the exact same pattern as the prior Task 19/21 updates on the same bullet. No prior entries were deleted or altered — pure append. It accurately states the raw counts it measured (11/60, 2/5), the root-cause mechanism, and explicitly disclaims fixing it ("not something this task's scope authorized fixing"). This matches the reviewer's independent findings.

`git diff -- .agents/DEVLOG.md`: new entry prepended above the existing Task 21 entry, no deletions, narrates the same finding honestly.

Given the severity (a *worse-looking* failure signature than the old near-miss, even if full-suite incidence isn't higher), the parent bullet's `[Pending — priority raised]` tag could be reinforced or given a forward-pointing note that the failure signature has changed in kind — but the existing text already conveys this clearly in prose, so this is a Nit, not a Should-fix on the documentation itself.

## Verdict

- **Blocking:** none. Scope is clean, implementation matches the authoritative spec exactly, unit tests are real (proven via two independent fault injections), and the real-world flake the engineer reported is independently reproduced and independently root-caused via a live diagnostic, not just re-stated. The task's own spec (`functional_domain.md` guardrail area, `initial_scaffold.md` "Required proof" §2) explicitly pre-authorized this exact outcome — a Task-19-class contention failure surfacing during the real-world check — as acceptable *if honestly reported rather than silently absorbed*, which is exactly what happened.
- **Should-fix (non-blocking, recommend as a new narrowly-scoped follow-up task, not a condition of this task's closure):** `pollUntilStable`'s default window (~100ms best case: 5×20ms) is empirically too short for check (h)'s resize call site specifically, where the renderer can lag the true window size by 400-500ms+ under contention. A future task should consider either (a) a longer `intervalMs`/`stableReads` specifically at the check-(h) call site (the options object already supports per-call-site overrides — no interface change needed), or (b) a plausibility guard comparing the renderer-observed value against `BrowserWindow.getBounds()` as ground truth before accepting "stable." This is the same tier as the still-open Task 19 contention item and belongs on the same backlog bullet, not as a Task 22 blocker.
- **Nit:** `backlog.md`'s "~280ms" lag figure is likely an undercount relative to worst-case (measured up to ~500ms); worth a footnote in a future update, not urgent.

**Recommendation: accept Task 22 as-is**, with the new finding backlogged (already done, correctly, on the existing contention bullet) — consistent with the precedent already set for Task 19/21. No blocking gate is open.

## Evidence artifacts / commands run

- `git status --porcelain=v1`, `git diff --name-only`, `git diff -- tests/e2e/ui-shell.spec.ts`, `git diff -- .agents/specs/backlog.md`, `git diff -- .agents/DEVLOG.md`, `git diff -- .agents/metrics/RUN_LOG.md`
- `npm run test:unit` (baseline 91/91, and twice more under fault injection)
- `npx tsc --noEmit`
- `npm run build`
- `npx playwright test tests/e2e/ui-shell.spec.ts --repeat-each=20 --reporter=line` (53 passed, 7 failed)
- `npx playwright test --reporter=line` ×5 (4× 44 passed, 1× 43 passed/1 failed on unrelated `live-reload.spec.ts`)
- Throwaway diagnostic `tests/e2e/_diagnostic-task22.spec.ts` (written, run 6×, deleted; `git status` confirmed clean before/after)

Relevant files (absolute paths): `c:\Source\md-view\.agents\current_scope.json`, `c:\Source\md-view\tests\e2e\ui-shell.spec.ts`, `c:\Source\md-view\tests\e2e\support\pollUntilStable.ts`, `c:\Source\md-view\tests\unit\pollUntilStable.test.ts`, `c:\Source\md-view\.agents\specs\backlog.md`, `c:\Source\md-view\.agents\DEVLOG.md`, `c:\Source\md-view\.agents\specs\functional_domain.md` (lines 1222-1271), `c:\Source\md-view\.agents\specs\initial_scaffold.md` (lines 3039-3172), `c:\Source\md-view\.agents\specs\review_report_task21.md` (lines 88-124), `c:\Source\md-view\playwright.config.ts`.

# Task 19 Independent Review — Final Report

## Verdict: **PASS** — no blocking issues found

---

## 1. Diff Scope & Boundary Compliance

```
$ git diff --stat -- src
(empty output — zero application-code changes)

$ git diff --name-only
tests/e2e/app-launch.spec.ts
tests/e2e/code-highlighting.spec.ts
tests/e2e/drag-drop.spec.ts
tests/e2e/external-links.spec.ts
tests/e2e/file-tree.spec.ts
tests/e2e/help-menu.spec.ts
tests/e2e/html-comments.spec.ts
tests/e2e/live-reload.spec.ts
tests/e2e/open-file-argv.spec.ts
tests/e2e/relative-images.spec.ts
tests/e2e/ui-shell.spec.ts
tests/e2e/view-menu.spec.ts
.agents/specs/functional_domain.md   (Task 19 planning section, Lead-authored — not in current_scope.json's in_scope)
.agents/specs/initial_scaffold.md    (Task 19 planning section, Lead-authored — not in current_scope.json's in_scope)

$ git status --porcelain
?? .agents/current_scope.json
?? tests/e2e/support/    (fixtures.ts, new)
```

`git diff --stat -- src` is empty — the hard "no application-code diff" guardrail holds. All 12 spec files listed in `.agents/current_scope.json`'s `in_scope` were touched; the new `tests/e2e/support/fixtures.ts` is present. `backlog.md`/`DEVLOG.md`/`RUN_LOG.md` were granted in scope but not touched (fine — no update was required for this task).

**Note (informational, not blocking):** `functional_domain.md`/`initial_scaffold.md` show as modified but are *not* in `current_scope.json`'s `in_scope` list. Content inspection (`git diff` on both files) shows the diff is exactly the "## Task 19" sections — Lead-voiced planning prose ("authoritative — implement exactly this"), consistent with Step 0/1 authorship prior to delegation, not engineer output. Flagged so the Lead can confirm it was written before scope lock, but it is not attributable to the `full-stack-engineer` and is not a scope violation on their part.

## 2. Fixture Correctness — `tests/e2e/support/fixtures.ts`

```ts
export const test = base.extend<{ electronArgs: string[]; electronApp: ElectronApplication; }>({
  electronArgs: [[], { option: true }],
  electronApp: async ({ electronArgs }, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-'));
    const app = await electron.launch({ args: [ENTRY_POINT, ...electronArgs], env: childEnv, userDataDir });
    await use(app);
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },
});
```

Matches the spec's authoritative design byte-for-byte: `mkdtempSync` per test, `userDataDir` passed to `electron.launch`, teardown (`app.close()` + `fs.rmSync`) after `await use(app)`, `childEnv`'s `ELECTRON_RUN_AS_NODE` stripping preserved, `electronArgs` declared as a Playwright options fixture (`{ option: true }`). Confirmed correct.

## 3. Assertion Integrity — all 12 spec files diffed and cited

Ran `git diff` on every one of the 12 files individually (full hunks reviewed, not sampled). In every case the only changes are: import line swap (`@playwright/test` → `./support/fixtures`), deletion of the file-local `childEnv` declaration, replacement of `const app = await electron.launch(...)` with the injected `electronApp` fixture parameter, addition of `test.use({ electronArgs: [...] })` where a call site's original `args` included more than the bare entry point, and deletion of the trailing `await app.close()`. No `expect(...)` line, no test title, and no fixture-file/assertion content changed anywhere. No violation found.

`live-reload.spec.ts` is worth calling out specifically: it correctly composes `base.extend` to add a `tmpFile`/`fileA`/`fileB` fixture that feeds a dynamically-computed path into the `electronArgs` fixture (since `test.use()` can't supply a path that doesn't exist until a fixture runs). This is legitimate Playwright fixture composition, not a workaround — teardown (`fs.rmSync`) is still centralized and structural.

## 4. The Deliberate Deviation — `view-menu.spec.ts` test (d)

```
$ grep -c 'electron.launch(' tests/e2e/*.spec.ts
tests/e2e/view-menu.spec.ts:2
tests/e2e/support/fixtures.ts:1
```

Only two raw `electron.launch()` calls remain in the entire spec suite outside `fixtures.ts`, and both are inside `view-menu.spec.ts`'s test (d) — exactly the one documented exception, and exactly the test that hard-crashed in the Lead's Phase 1 baseline (run 1, `code=3221226505`).

Code inspected directly:
```ts
test('(d) close-and-relaunch proves no persistence of view settings', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-'));
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  try {
    const app = await electron.launch({ args: [ENTRY_POINT, fixturePath], env: childEnv, userDataDir });
    ...
    await app.close();
    const secondApp = await electron.launch({ args: [ENTRY_POINT, fixturePath], env: childEnv, userDataDir });
    ...
    await secondApp.close();
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
```

Verified against all three sub-criteria:
- **(a) Isolation:** `fs.mkdtempSync` produces its own unique OS-generated directory, not Electron's shared default profile — the actual bug this task fixes is resolved for this test too. The two sequential launches deliberately reuse the *same* dir (required to prove no-persistence-across-relaunch), but that dir is still unique per test run and never shared with other parallel workers.
- **(b) Cleanup correctness:** the entire two-launch/two-assertion body sits inside `try`; `finally` runs `fs.rmSync` regardless of which `expect()` throws. No leak path on failure.
- **(c) Justification:** the test's real semantics require the *same* on-disk profile across a close+relaunch to prove settings don't persist — the standard one-launch-per-test `electronApp` fixture structurally cannot express this (it tears down after `use()` returns once). This is a genuine architectural constraint, not a corner cut; the in-file comment block correctly explains the reasoning.

No blocking finding on this deviation.

## 5. Flake Sanity Check — 3 full-suite runs, reviewer's own execution

```
$ npm run build   → succeeded (dist/preload/index.js 1.3kb, all copy steps ran)

$ npx playwright test --reporter=line   (run 1)
Running 39 tests using 4 workers
39 passed (39.8s)

$ npx playwright test --reporter=line   (run 2)
39 passed (45.1s)

$ npx playwright test --reporter=line   (run 3)
39 passed (45.7s)
```

3/3 clean, including `ui-shell.spec.ts` in every run (no flake reproduced in this sample). This is consistent with — not a disproof of — the implementer's reported low-frequency `ui-shell.spec.ts` flake; 3 runs is not a statistically meaningful sample either way. The Lead's own formal 12-run comparison is the actual verification instrument for the flake-rate claim. What these 3 runs confirm: the implementation is stable and plausible, nothing is structurally broken by the migration.

## 6. FI-1 Fault-Injection Proof — redone independently by the reviewer

```
$ node -e "... list os.tmpdir() for md-view-e2e-<random> dirs ..."
[]   (baseline: zero, before injection)
```

Injected fault into `tests/e2e/app-launch.spec.ts`:
```ts
test('app launches and opens a window', async ({ electronApp }) => {
  const window = await electronApp.firstWindow();
  expect(window).toBeTruthy();
  expect(true).toBe(false); // FI-1 injected failure - reviewer fault injection
});
```

```
$ npx playwright test tests/e2e/app-launch.spec.ts --reporter=line
1 failed
  Error: expect(received).toBe(expected)
  Expected: false
  Received: true
    at ...app-launch.spec.ts:6:16
```

Confirmed fails as expected. Immediately after the failed run:
```
$ node -e "... filter /^md-view-e2e-[A-Za-z0-9]+$/ ..."
bare userDataDir-style dirs (md-view-e2e-<random> only): []
```

Zero leftover `userDataDir` tmp directories — teardown (`app.close()` + `fs.rmSync`) ran even though the test body threw, exactly as guardrail #15 requires. This is real proof, not a restated claim: Playwright's fixture lifecycle guarantee holds for this specific fixture as implemented.

Reverted the injection and confirmed green:
```
$ npx playwright test tests/e2e/app-launch.spec.ts --reporter=line
1 passed (1.7s)

$ git diff --stat -- tests/e2e/app-launch.spec.ts
1 file changed, 3 insertions(+), 19 deletions(-)   (matches the delivered diff exactly, file fully restored)
```

Note: two stale, unrelated `md-view-e2e-reload-a-`/`md-view-e2e-reload-b-` directories (5 days old per `mtime`, from `live-reload.spec.ts`'s separate tmp-file fixture) were present in `os.tmpdir()` throughout — pre-existing debris from an earlier/interrupted session, not created or left behind by anything in this diff or the reviewer's test runs. Not blocking; worth a housekeeping note only.

## 7. Migration Completeness

Original count (spec's own corrected recount): 40 `electron.launch()` call sites across 12 files. Verified: every file's diff accounted for its exact original call-site count (app-launch 1, code-highlighting 1, drag-drop 7, external-links 2, file-tree 7, help-menu 5, html-comments 1, live-reload 3, open-file-argv 3, relative-images 1, ui-shell 3, view-menu 6 [4 via fixture + 2 manual in test (d)] = 40). Grep confirms only 2 raw `electron.launch()` calls remain outside `fixtures.ts`, both inside the one documented exception. No missed or partially-migrated call site found.

## 8. Regression Baseline Commands

```
$ npx tsc --noEmit
(zero output — zero type errors)

$ npm run test:unit
Test Files  15 passed (15)
Tests       83 passed (83)

$ npm run test:integration
Test Files  4 passed (4)
Tests       19 passed (19)
```

All green, unaffected by this test-infrastructure-only change, as expected.

## 9. Test Quality / Regression Risk

This task adds no new test assertions (by design — guardrail #13 forbids it) so there is nothing tautological to flag; the only "new" testable logic is `fixtures.ts` itself, and its one load-bearing property (teardown-on-throw) is proven by the reviewer's own FI-1 re-run above, not merely by code inspection. Regression risk from this diff is low: it's a pure launch-mechanism substitution with `src/**` fully untouched, verified by empty `git diff --stat -- src` and a clean `tsc --noEmit`.

---

## Summary Table

| Item | Result |
|---|---|
| `src/**` diff | Empty — confirmed |
| Fixture matches authoritative spec | Yes — exact match |
| Assertion/title integrity across 12 files | Confirmed unchanged in all 12 diffs |
| view-menu.spec.ts test (d) deviation | Justified, correctly isolated, correct try/finally |
| 3x full-suite run (sanity, not formal 12-run) | 39/39, 39/39, 39/39 — all green, no ui-shell flake in this sample |
| FI-1 fault injection (redone independently) | Fails as expected; zero leftover tmp dirs; reverts clean |
| Migration completeness | 40/40 call sites accounted for; only 2 raw calls remain, both the documented exception |
| `tsc --noEmit` | Clean |
| `test:unit` | 83/83 passed |
| `test:integration` | 19/19 passed |

**No Blocking items. No Should-fix items. One Nit:** the two spec-file diffs (`functional_domain.md`/`initial_scaffold.md`) fall outside `current_scope.json`'s declared `in_scope` list — Lead-authored pre-delegation content (confirmed by voice/content), addressed in the Lead's close-out note below.

---

## Addendum — Lead's formal Phase 2 12-run comparison (primary evidence, per task spec)

The reviewer's 3-run sanity check above (section 5) confirmed the implementation is stable and plausible. This addendum is the actual before/after evidence the task's Phase 2 requires: 12 consecutive `npx playwright test --reporter=line` runs, identical conditions to the Phase 1 baseline in `initial_scaffold.md` (same machine, same 4 workers, one `npm run build` before all 12 runs).

| Run | Result | Failing test | Error text |
|---|---|---|---|
| 1 | FAIL | `ui-shell.spec.ts:49` "argv launch: empty-state disappears, status bar shows the real absolute path" | `expect(containerBox.marginLeft).toBeGreaterThan(32)` — received `31.2` |
| 2 | PASS | — | — |
| 3 | FAIL | `code-highlighting.spec.ts:6` | `Error: worker process exited unexpectedly (code=3221226505, signal=null)` |
| 4 | FAIL | `ui-shell.spec.ts:49` (same test, same assertion) | `expect(containerBox.marginLeft).toBeGreaterThan(32)` — received `31.2` |
| 5 | PASS | — | — |
| 6 | PASS | — | — |
| 7 | PASS | — | — |
| 8 | FAIL | `ui-shell.spec.ts:4` "no-argv launch: no legacy h1/button, empty-state visible, status bar shows 'No file open'" | `Error: worker process exited unexpectedly (code=3221226505, signal=null)` |
| 9 | PASS | — | — |
| 10 | PASS | — | — |
| 11 | PASS | — | — |
| 12 | PASS | — | — |

**8/12 clean, 4/12 failed — identical to the Phase 1 baseline (8/12 clean, 4/12 failed).** No improvement. One failure per failing run in both samples (never compounding).

**Headline finding: the fixture did not move the failure rate.** Worse, the two crash-class failures (`code=3221226505`) landed on two *more* different tests than baseline's two (baseline: `view-menu.spec.ts:134`, `open-file-argv.spec.ts:47`; post-fix: `code-highlighting.spec.ts`, `ui-shell.spec.ts:4`) — four distinct tests across four occurrences in 24 total runs, no repeat test. Per-test `userDataDir` isolation should suppress a shared-profile-lock cause; it didn't, and the crash keeps landing on a different random test each time. This is more consistent with raw CPU/memory/handle contention from running 4 concurrent full Electron/Chromium processes on this machine than with profile-directory sharing specifically.

The `ui-shell.spec.ts` failures are also informative: they reproduced on a *different* assertion (`marginLeft > 32`, borderline at `31.2`) than the one originally logged in `backlog.md` for this test (`width > 800`) — a layout-timing race, not a timeout, and not something profile isolation could plausibly affect either way.

**Per the task's explicit instruction, no second hypothesis (lowering `playwright.config.ts` workers, adding delays) was implemented on the strength of this result.** Findings reported to the user; `backlog.md`'s three original flakiness entries remain `[Pending]`, and a new entry documents this evidence for whoever scopes the follow-up. The fixture itself is being kept (per user decision) as a net-positive refactor independent of whether it resolved the flakiness — real DRY win, real Playwright-guaranteed teardown, zero `src/**` diff, reviewed clean.

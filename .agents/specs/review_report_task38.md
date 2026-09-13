# Independent Review Report — Task 38: Coverage Reporting

**Note to Lead:** I hold read-only tools and cannot write files. Please save this report verbatim to `.agents/specs/review_report_task38.md`.

## Scope verification

`git diff --name-only main` → `.agents/specs/functional_domain.md`, `.agents/specs/initial_scaffold.md`, `.gitignore`, `README.md`, `package-lock.json`, `package.json`, `vitest.config.ts`. Two spec files are the Lead's own authoring (excluded from scope check per task instructions); the remaining five are exactly `.agents/current_scope.json`'s `in_scope` list. `git status --porcelain` confirms no other tracked/untracked file changed. **No scope violation.**

## Evidence

### 1. `vitest.config.ts` diff

```
   test: {
     environment: 'node',
+    coverage: {
+      provider: 'v8',
+      include: ['src/**'],
+      exclude: [
+        'tests/**',
+        '**/*.config.*',
+        'src/renderer/index.html',
+      ],
+      all: false,
+      reporter: ['text', 'html'],
+      reportsDirectory: './coverage',
+    },
   },
```
Matches the required block exactly (`provider`, `include`, `exclude`, `all: false`, `reporter`, `reportsDirectory`). `test.environment: 'node'` is untouched. `grep -i threshold vitest.config.ts` → no matches. **Guardrail #109 satisfied.**

### 2. `package.json` / lockfile / scripts

Script byte-diff via extracted JSON (`main` vs. working tree):
```
main:    { dev, build, test, test:unit, test:integration, test:e2e, test:all, package }
working: { dev, build, test, test:unit, test:integration, test:e2e, test:all, test:coverage, package }
```
All five gated scripts (`test`, `test:unit`, `test:integration`, `test:e2e`, `test:all`) are byte-identical strings; only `test:coverage: "vitest run tests/unit --coverage"` was added. **Guardrail #111 satisfied.**

Devdependency added: `"@vitest/coverage-v8": "^2.1.9"` — a `^2.x` range, cannot resolve to a 3.x-only package, matching spec intent (spec text said `^2.1.0`; the engineer used `^2.1.9` instead — functionally equivalent, both exclude 3.x — **Nit**, not blocking).

`package-lock.json` diff: only adds `@vitest/coverage-v8` and its transitive deps (`@bcoe/v8-coverage`, `@babel/*`, `istanbul-*`, `magicast`, `test-exclude`, etc.). Spot-checked all `"version"` additions in the diff — none touch a pre-existing package's resolved version. Lockfile change is additive-only as expected from `npm install`.

**Unrelated cosmetic diff found:** `package.json`'s `keywords` array was reformatted from single-line to multi-line (same 5 values, no content change) — a side effect of npm rewriting the whole file on `npm install --save-dev`. Not a scope violation (file is in-scope) and not a behavior change, but it is diff noise outside the task's intent. **Nit.**

### 3. `.gitignore`

```
 release
 test-results
 playwright-report
+/coverage
```
Read the full file before the change — no `coverage` pattern pre-existed, no duplicate/conflicting entry introduced. **Confirmed correct.**

### 4. `README.md`

```
+| `npm run test:coverage` | Generate a code coverage report for the unit test suite (`tests/unit`). Informational only — no enforced threshold |
```
Wording matches spec intent (informational, no threshold, scoped to `tests/unit`). **Confirmed.**

## Command execution (run myself, raw output)

`npm install` — completed clean (`up to date, audited 491 packages in 5s`).

Found and removed a stale, pre-existing `coverage/` directory left on disk from the engineer's own prior run, to get a clean-room result:
```
ls coverage/  → base.css, index.html, main/, preload/, renderer/, ... (pre-existing)
rm -rf coverage
```

`npm run test:coverage` (raw output):
```
 Test Files  20 passed (20)
      Tests  120 passed (120)
   Start at  10:33:34
   Duration  2.22s

 % Coverage report from v8
-----------------|---------|----------|---------|---------|---------------------
File             | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-----------------|---------|----------|---------|---------|---------------------
All files        |   34.43 |    93.97 |   46.42 |   34.43 |
 main            |    92.7 |    94.91 |   95.23 |    92.7 |
  dockIcon.ts    |     100 |      100 |     100 |     100 |
  fileTree.ts    |     100 |       90 |     100 |     100 | 18
  frontmatter.ts |     100 |      100 |     100 |     100 |
  helpWindow.ts  |     100 |      100 |     100 |     100 |
  linkPolicy.ts  |     100 |      100 |     100 |     100 |
  markdown.ts    |   93.61 |    89.47 |     100 |   93.61 | 9-10,71
  menu.ts        |     100 |      100 |     100 |     100 |
  paths.ts       |     100 |      100 |     100 |     100 |
  settings.ts    |     100 |      100 |     100 |     100 |
  watcher.ts     |   33.33 |      100 |      50 |   33.33 | 12-36
 preload         |     100 |      100 |     100 |     100 |
  api.ts         |     100 |      100 |     100 |     100 |
 renderer        |   10.13 |    91.66 |   17.14 |   10.13 |
  renderer.js    |   10.13 |    91.66 |   17.14 |   10.13 | ...-27,40-44,66-587
-----------------|---------|----------|---------|---------|---------------------
```
Text summary printed. Only `tests/unit/*` files ran (20 files, 120 tests) — `tests/integration` and `tests/e2e` were not touched. **Guardrail #110 confirmed.**

File check afterward: `ls -la coverage/index.html` → `-rw-r--r-- ... 5738 Sep 13 10:33 coverage/index.html` exists on disk. **Confirmed via listing, not tool claim.**

### Guardrail #112 — per-file scrutiny

Report lists exactly 12 files: `dockIcon.ts`, `fileTree.ts`, `frontmatter.ts`, `helpWindow.ts`, `linkPolicy.ts`, `markdown.ts`, `menu.ts`, `paths.ts`, `settings.ts`, `watcher.ts`, `preload/api.ts`, `renderer/renderer.js`. I grepped every `tests/unit/*.test.ts` import statement (both ES `import` and CJS `require`) and mapped each to source:

| Source file | Dedicated unit test(s) |
|---|---|
| `main/dockIcon.ts` | `shouldSetDockIcon.test.ts` |
| `main/fileTree.ts` | `fileTree.test.ts` |
| `main/frontmatter.ts` | `frontmatter.test.ts` |
| `main/helpWindow.ts` | `buildHelpHtml.test.ts`, `shouldCreateHelpWindow.test.ts` |
| `main/linkPolicy.ts` | `isExternalHttpUrl.test.ts` |
| `main/markdown.ts` | `markdown.test.ts` |
| `main/menu.ts` | `menu.test.ts` |
| `main/paths.ts` | `baseUrlForFile.test.ts` |
| `main/settings.ts` | `settings.test.ts` |
| `main/watcher.ts` | `watcher.test.ts` |
| `preload/api.ts` | `preload-api.test.ts` |
| `renderer/renderer.js` | `canCopyRawSource.test.ts`, `isPathUnder.test.ts`, `needsFetch.test.ts`, `shouldShowFrontmatter.test.ts`, `statusBarText.test.ts` (via `require`), `firstDroppedFile.test.ts` (via `require`), `renderer-order.test.ts` (via `require`) |

Every file in the report has at least one direct, dedicated importing test — none is present only because it was pulled in transitively. **My independent conclusion: guardrail #112 is satisfied; no misleading/unexpected file appears in the report.**

One observation for the Lead (not a #112 violation, since #112 is about unexpected files *appearing*, not files *missing*): `src/main/index.ts`, `src/main/settingsStore.ts`, `src/main/windowConfig.ts`, and `src/main/help/**` are never unit-tested and, because `all: false`, are silently absent from the report rather than showing as 0%. This is a direct, intended consequence of the Lead's own `all: false` spec choice, so it's not an engineer defect — flagging only as a **Should-fix-later** design note: a future reader could over-read the 92.7% `main` figure as representative of the whole `main` directory when it's actually only representative of the tested subset.

### Regression checks

`npm run test:unit` (raw, no coverage instrumentation):
```
 Test Files  20 passed (20)
      Tests  120 passed (120)
   Duration  1.97s
```
Identical file/test count to pre-task baseline and to the coverage run.

`npm run test:integration` (raw):
```
 Test Files  5 passed (5)
      Tests  36 passed (36)
   Duration  1.06s
```
No integration test files were touched by this task; ran it anyway since `package.json`/lockfile changed — clean pass.

### Post-run cleanliness

`git status --porcelain` after generating and then deleting `coverage/`:
```
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M .gitignore
 M README.md
 M package-lock.json
 M package.json
 M vitest.config.ts
?? .agents/current_scope.json
```
No stray `coverage/` untracked entry appeared while the directory existed on disk during the run — confirms `.gitignore`'s new `/coverage` entry works correctly. **No bug found here.**

## Findings

**Blocking:** none.

**Should-fix:**
- None requiring action before delivery. (The `all: false` visibility gap noted above is a spec-level characteristic, not an engineer error — informational for the Lead only.)

**Nit:**
- `package.json` `keywords` array reformatted (single-line → multi-line, same values) as an incidental side effect of `npm install`. Cosmetic only, no behavioral impact.
- `@vitest/coverage-v8` pinned to `^2.1.9` rather than the spec's literal `^2.1.0` text — both ranges are semver-equivalent in effect (exclude 3.x, permit the resolved 2.1.9), so this is a documentation-vs-implementation wording nit, not a functional deviation.

## Verdict

**PASS.** All four numbered guardrails (#109–#112) verified against my own diff inspection and my own command runs, not the engineer's claims. `npm run test:coverage` genuinely works as claimed (raw output above, `coverage/index.html` confirmed on disk by listing). `npm run test:unit` genuinely still passes at 20 files / 120 tests, matching pre-task baseline. No scope violations. No blocking findings. Safe to proceed to Step 3 (Log & Deliver).

## Files referenced
- `C:\Source\md-view\vitest.config.ts`
- `C:\Source\md-view\package.json`
- `C:\Source\md-view\package-lock.json`
- `C:\Source\md-view\.gitignore`
- `C:\Source\md-view\README.md`
- `C:\Source\md-view\.agents\specs\functional_domain.md` (lines 2501–2549, Task 38 section)
- `C:\Source\md-view\.agents\specs\initial_scaffold.md` (lines 5210–5274, Task 38 section)
- `C:\Source\md-view\.agents\current_scope.json`
- `C:\Source\md-view\tests\unit\*.test.ts` (import mapping for guardrail #112)

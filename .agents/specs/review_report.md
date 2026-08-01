# Independent Code Review -- md-view Structural Scaffold

## Verdict: Pass

No Blocking findings. All 15 in-scope files are present, structurally sound, security invariants verified programmatically, and all three test suites (unit, integration, e2e) pass on independent execution.

---

## 1. Scope Adherence

git status --short output (captured before any staging, and reproduced identically after git reset):

```
 M .claude/hooks/protect-governance.mjs
?? .agents/current_scope.json
?? .agents/specs/
?? .gitignore
?? README.md
?? electron-builder.yml
?? package-lock.json
?? package.json
?? playwright.config.ts
?? src/
?? tests/
?? tsconfig.json
?? vitest.config.ts
```

Cross-checked against .agents/current_scope.json's 15-path in_scope list -- all 15 paths present and correctly located under src/ and tests/.

Extra items present, all accounted for and non-violating:
- package-lock.json -- unavoidable npm install side effect. Allowed per task instructions.
- .agents/current_scope.json, .agents/specs/ -- these are the Lead's own Step 0/1/scope artifacts, not engineer output.
- .claude/hooks/protect-governance.mjs (modified, not new) -- pre-existing state, confirmed by task instructions to be a prior Lead-authorized governance fix unrelated to this scaffold. Reviewed diff -- adds a current_scope.json-gated protection window for functional_domain.md/initial_scaffold.md -- unrelated to the md-view scaffold, not attributable to this engineer task.
- node_modules/, dist/, release/, test-results/, playwright-report/ -- none appear in git status --short (correctly excluded by .gitignore).

No scope violations found.

---

## 2. Diff Review (via git add -A -N intent-to-add, then git diff, then git reset to restore working tree)

git diff --stat after intent-to-add, confirming all 15 in-scope files plus package-lock.json, the Lead's own spec/scope artifacts, and the pre-existing hook change:

```
 .agents/current_scope.json              |   21 +
 .agents/specs/functional_domain.md      |   25 +
 .agents/specs/initial_scaffold.md       |   74 +
 .claude/hooks/protect-governance.mjs    |   25 +-
 .gitignore                              |   17 +
 README.md                               |   29 +
 electron-builder.yml                    |    6 +
 package-lock.json                       | 6778 +++++++++++++++++++++++++++++++
 package.json                            |   25 +
 playwright.config.ts                    |    5 +
 src/main/index.ts                       |   27 +
 src/main/windowConfig.ts                |   11 +
 src/preload/api.ts                      |    2 +
 src/preload/index.ts                    |    4 +
 src/renderer/index.html                 |   10 +
 tests/e2e/app-launch.spec.ts            |   22 +
 tests/integration/window-config.test.ts |   12 +
 tests/unit/preload-api.test.ts          |   13 +
 tsconfig.json                           |   17 +
 vitest.config.ts                        |    7 +
 20 files changed, 7125 insertions(+), 5 deletions(-)
```

(Working tree restored to original state with git reset after the diff was captured -- verified git status --short output identical before and after.)

Key hunks relevant to findings, quoted from full file reads (all in-scope files are new/small, cited here in full where load-bearing):

src/main/windowConfig.ts (full file, 11 lines):

    import type { BrowserWindowConstructorOptions } from "electron";

    export const defaultWindowOptions: BrowserWindowConstructorOptions = {
      width: 900,
      height: 640,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    };

"import type" is a type-only import, no Electron runtime value pulled in. Literal booleans true/false present exactly as required. sandbox: true is a bonus hardening not contradicted by the spec (flagged as a Nit below).

src/preload/api.ts (full file, 2 lines):

    export const bridgeApi = { version: "0.0.0-scaffold" } as const;
    export type BridgeApi = typeof bridgeApi;

Zero Electron import of any kind -- confirmed by grep (below).

src/preload/index.ts (full file, 4 lines):

    import { contextBridge } from "electron";
    import { bridgeApi } from "./api";

    contextBridge.exposeInMainWorld("mdview", bridgeApi);

Sole call site of exposeInMainWorld in the entire src/ tree (confirmed by grep, below).

src/renderer/index.html: static markup only, no script tag, no inline JS -- confirmed by full read (10 lines, a single h1 element in the body, no script elements).

---

## 3. Architecture / Design Conformance (against initial_scaffold.md)

| # | Check | Result | Tag |
|---|---|---|---|
| 1 | src/preload/api.ts has zero from "electron" / require("electron") | Grep for "electron" in that file returned no matches. Confirmed pure/import-free. | Verified, no finding |
| 2 | src/main/windowConfig.ts imports only Electron types | import type BrowserWindowConstructorOptions from "electron" -- type-only, erased at compile time, no runtime Electron dependency. | Verified, no finding |
| 2b | contextIsolation: true, nodeIntegration: false exactly | Both present as literal booleans in defaultWindowOptions.webPreferences. | Verified, no finding |
| 3 | src/preload/index.ts is the only file calling contextBridge.exposeInMainWorld | Grep for contextBridge across src/ returned exactly one file (src/preload/index.ts), two matches (import + call). | Verified, no finding |
| 4 | src/renderer/index.html has no script tag, no logic | Confirmed by full read: DOCTYPE, head with charset/title, body with a single h1. No script tag, no inline handlers. | Verified, no finding |
| 5 | No markdown-parsing dependency in package.json; no FS business logic in src/ | Grep for markdown/marked/remark/commonmark (case-insensitive) in package.json found no matches. devDependencies are @playwright/test, @types/node, electron, electron-builder, playwright, typescript, vitest -- all infra/tooling, zero markdown libs. src/main/index.ts only does window lifecycle plus path.join, no fs reads of arbitrary content. | Verified, no finding |
| 6 | SRP split (main/index.ts = lifecycle, windowConfig.ts = config) | src/main/index.ts (27 lines): createWindow(), app.whenReady(), window-all-closed, activate handlers -- no security config literals live here, they are spread in from defaultWindowOptions. Matches spec's stated SRP rationale. | Verified, no finding |
| 7 | Facade pattern as documented | src/preload/index.ts is a 4-line facade: import contract, call exposeInMainWorld once. Matches spec exactly. | Verified, no finding |

No Blocking or Should-fix architecture findings.

One Nit: defaultWindowOptions adds sandbox: true, which is not named in functional_domain.md's two invariants (contextIsolation, nodeIntegration) nor in initial_scaffold.md's prose. It is additive hardening, not a violation, and README.md correctly documents it as a third invariant -- flagged only because it is an unrequested-but-harmless expansion of the security surface that a future engineer should know was intentional, not accidental.

---

## 4. Test Quality (real vs. theater)

- tests/unit/preload-api.test.ts -- imports bridgeApi directly from ../../src/preload/api (not a mock or stub). Asserts typeof bridgeApi === "object", non-null, and typeof bridgeApi.version === "string". This is a structural-existence assertion consistent with functional_domain.md guardrail #4 ("assert structural existence... never behavior that doesn't exist yet"). Not tautological -- it would fail if api.ts were deleted, renamed, or if version were removed or mistyped.
- tests/integration/window-config.test.ts -- imports defaultWindowOptions directly from ../../src/main/windowConfig. Asserts defaultWindowOptions.webPreferences?.contextIsolation .toBe(true) (literal boolean equality) and nodeIntegration .toBe(false) (literal boolean equality) -- not toBeDefined() or a truthy check. This directly encodes Edge-Case Invariant Guardrail #1 from functional_domain.md as an executable, falsifiable test.
- tests/e2e/app-launch.spec.ts -- uses real Playwright _electron.launch() against the actually-built dist/main/index.js, asserts app.firstWindow() resolves truthy. This is a real process-boundary test, not a mock. Includes a defensive ELECTRON_RUN_AS_NODE env strip with an explanatory comment -- reasonable test-harness robustness, not scope creep.

No test-theater findings. All three test files assert genuine, falsifiable structural or behavioral properties tied to the stated guardrails.

---

## 5. Test Verification (executed independently by reviewer)

### npm run test:unit

    > md-view@0.0.0-scaffold test:unit
    > vitest run tests/unit

     PASS  tests/unit/preload-api.test.ts (2 tests) 12ms

     Test Files  1 passed (1)
          Tests  2 passed (2)
       Start at  22:58:32
       Duration  602ms

### npm run test:integration

    > md-view@0.0.0-scaffold test:integration
    > vitest run tests/integration

     PASS  tests/integration/window-config.test.ts (2 tests) 8ms

     Test Files  1 passed (1)
          Tests  2 passed (2)
       Start at  22:58:39
       Duration  766ms

### npm run test:e2e

    > md-view@0.0.0-scaffold test:e2e
    > npm run build && playwright test

    > md-view@0.0.0-scaffold build
    > tsc -p tsconfig.json && node -e "mkdir dist/renderer and copy src/renderer/index.html to dist/renderer/index.html"

    Running 1 test using 1 worker

      ok 1 tests/e2e/app-launch.spec.ts:12:5 - app launches and opens a window (2.4s)

      1 passed (3.0s)

Post-build dist/ structure inspected and confirmed correct:

    dist/main:      index.js, index.js.map, windowConfig.js, windowConfig.js.map
    dist/preload:   api.js, api.js.map, index.js, index.js.map
    dist/renderer:  index.html

All three suites: 6 of 6 tests passing, 0 failures.

---

## 6. package.json / tsconfig.json Sanity

| Check | Result |
|---|---|
| dev script present | Pass -- npm run build then electron . |
| build script present | Pass -- tsc -p tsconfig.json, then copies index.html to dist/renderer/ |
| test:unit script present | Pass |
| test:integration script present | Pass |
| test:e2e script present | Pass |
| test:all script present | Pass -- chains all three |
| package script present (electron-builder) | Pass |
| "main" points at dist/main/index.js | Pass |
| No "type": "module" in package.json | Pass -- absent, CommonJS default preserved |
| tsconfig.json has "strict": true | Pass |
| tsconfig.json include limited to src/main and src/preload | Pass -- include is ["src/main/**/*.ts", "src/preload/**/*.ts"], renderer correctly excluded (no TS there) |

All package.json and tsconfig.json checks pass.

---

## 7. README.md Accuracy

- Explicitly states the repo "currently contains only the structural scaffold" with "no Markdown parsing, file loading, or interactive UI yet" -- factually matches the delivered code (verified above: no markdown deps, static HTML, no business logic).
- Documents contextIsolation: true, nodeIntegration: false, and sandbox: true -- matches windowConfig.ts exactly, including the additional sandbox hardening (correctly disclosed, not silently added).
- Commands table lists dev, build, test:unit, test:integration, test:e2e, test:all, package -- all seven match package.json's scripts block verbatim, and the descriptions accurately reflect actual behavior (e.g. test:e2e is correctly noted as building first).

README accuracy: Pass. No misrepresentations found.

---

## Summary

- Blocking: none.
- Should-fix: none.
- Nit: sandbox: true in windowConfig.ts is an unrequested-but-benign addition beyond the two named guardrails in functional_domain.md; correctly disclosed in README, not a defect, flagged only for the Lead's awareness.

This scaffold satisfies every Edge-Case Invariant Guardrail in functional_domain.md, stays within the 15-path scope contract, matches the architecture documented in initial_scaffold.md, and its test suite is genuinely behavioral, not tautological. Independent execution of all three test commands confirms 6 of 6 tests passing.

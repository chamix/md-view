# Independent Review Report — Task 39: Bump CI/build Node.js target from 20 to 24

## Scope verification

`git status --porcelain`:
```
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M .github/workflows/ci.yml
 M .github/workflows/release.yml
 M package-lock.json
 M package.json
?? .agents/current_scope.json
```
Excluding the two `.agents/specs/*.md` files (Lead-authored governance artifacts) and the untracked `.agents/current_scope.json` (the scope contract itself), the changed set is exactly `git diff --stat`'s four files: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `package-lock.json`, `package.json`. This is byte-identical to `.agents/current_scope.json`'s `in_scope` array. **No scope violation.**

## Evidence

### 1. `.github/workflows/ci.yml` and `.github/workflows/release.yml`

```diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
@@ -18,7 +18,7 @@ jobs:
       - name: Set up Node
         uses: actions/setup-node@v4
         with:
-          node-version: 20
+          node-version: 24

diff --git a/.github/workflows/release.yml b/.github/workflows/release.yml
@@ -18,7 +18,7 @@ jobs:
       - name: Set up Node
         uses: actions/setup-node@v4
         with:
-          node-version: 20
+          node-version: 24
```
Both diffs are exactly one line each, both under the pre-existing `actions/setup-node@v4` step, nothing else in either workflow file changed. Matches the scaffold's "Concrete plan" verbatim. **Confirmed.**

### 2. `package.json`

```diff
+  "engines": {
+    "node": ">=24.0.0"
+  },
...
-    "@types/node": "^22.7.0",
+    "@types/node": "^24.13.4",
```
- `engines.node` is `>=24.0.0` — a floor, distinct from the CI-pinned exact major (guardrail #114). Confirmed correct.
- `@types/node` moved `^22.7.0` → `^24.13.4`.
- Grepped the full diff for `electron`/`vitest` lines: `"electron": "^33.0.0"` and `"electron-builder": "^25.1.0"` both appear only as unchanged context lines (no `+`/`-` prefix). No other dependency line changed. **Guardrail #113 satisfied.**

### 3. `package-lock.json`

`git diff --stat`: `20 lines changed (15 insertions, 5 deletions)`. Full diff inspected:
- Root manifest block: `@types/node` bumped to match `package.json`, and `engines: {"node": ">=24.0.0"}` added — consistent, not hand-edited independently.
- `node_modules/@types/node` entry: version `22.20.1` → `24.13.4`, integrity hash changed accordingly, its own `undici-types` dependency range shifted `~6.21.0` → `~7.18.0` (a normal transitive consequence of the major bump).
- One new nested entry added: `node_modules/@types/node/node_modules/undici-types@7.18.2`.
- No other package's `"version"` or `"resolved"` field appears anywhere in the diff. **Confirmed lockfile-only regeneration, no unrelated dependency drift.**

### 4. Guardrail #113 — Electron/build config untouched

```
$ git diff -- vitest.config.ts electron-builder.yml
(empty output)
$ git diff --name-only | grep -v '^\.agents/specs/'
.github/workflows/ci.yml
.github/workflows/release.yml
package-lock.json
package.json
```
Zero diff in `src/**`, `electron-builder.yml`, and no `electronBuilder` config block exists to check inside `package.json` (confirmed absent from the diff). The `electron` devDependency line (`^33.0.0`) is unchanged context, confirmed above. **No conflation between CI/build Node target and Electron's bundled Node runtime — the one mistake class this task explicitly prohibits was avoided.**

### 5. `@types/node@24.13.4` version sanity check

```
$ npm view @types/node dist-tags --json
{ ..., "latest": "26.5.1", ... }
$ npm view @types/node versions --json | filter startsWith('24.')
[ '24.12.0','24.12.1','24.12.2','24.12.3','24.12.4','24.13.0','24.13.1','24.13.2','24.13.3','24.13.4' ]
```
The npm `latest` dist-tag for `@types/node` currently resolves to `26.5.1` (types packages for future Node majors are pre-published ahead of the runtime's LTS transition). The spec's instruction was "current `^24.x` **latest**" — i.e., latest patch within the 24.x line, matching the Node 24 CI target, not the package's overall `latest` tag. `24.13.4` is confirmed to be the newest published version within the `24.x` line, and matches the resolved version in `package-lock.json` exactly. **Correct, deliberate, non-stale pin — not a version-pin mistake.**

## Command execution (run by reviewer, raw output)

Local environment note: `node --version` → `v24.15.0`, `npm --version` → `11.12.1` (already on Node 24, a favorable test environment for this bump).

**`npm run build`:**
```
> md-view@1.0.0 build
> tsc -p tsconfig.json && npx esbuild src/preload/index.ts ...

  dist\preload\index.js  2.6kb

Done in 4ms
```
Zero TypeScript errors. **Guardrail #115 verification item 2 satisfied.**

**`npm run test:unit`:**
```
 Test Files  20 passed (20)
      Tests  120 passed (120)
   Duration  2.34s
```
Matches Task 38's baseline (20 files / 120 tests) — no regression from the `@types/node` bump.

**`npm run test:integration`:**
```
 Test Files  5 passed (5)
      Tests  36 passed (36)
   Duration  1.14s
```

**`npm ls @types/node`:**
```
md-view@1.0.0
+-- @types/node@24.13.4
+-- electron-builder@25.1.8
|   `-- ... @types/node@24.13.4 deduped
+-- electron@33.4.11
| +-- ... @types/node@24.13.4 deduped (multiple)
| +-- @types/node@20.19.43        <- nested under @electron/get, electron's own transitive pin
`-- vitest@2.1.9
  `-- ... @types/node@24.13.4 deduped
```
Top-level resolves to `24.13.4` as required. The one nested `@types/node@20.19.43` is a transitive dependency pinned by `electron`'s own package graph (`@electron/get`), untouched by this task and expected — consistent with guardrail #113 (Electron's own toolchain is explicitly out of scope).

**`npm ci`** (spec verification item 1, "succeeds cleanly under Node 24"):
```
added 491 packages, and audited 492 packages in 23s
23 vulnerabilities (3 moderate, 17 high, 3 critical)
```
Completed cleanly (exit success). The deprecation warnings (`inflight`, `rimraf@3`, old `glob` versions, etc.) are pre-existing transitive deps of `electron-builder`'s toolchain, unrelated to the `@types/node` bump — not new noise introduced by this diff. Re-checked `git status --porcelain package-lock.json` and `git diff --stat package-lock.json` after `npm ci`: still exactly the same 20-line diff as before — **`npm ci` did not cause further lockfile drift.**

## Findings

**Blocking:** none.

**Should-fix:** none.

**Nit:** none — this is one of the cleanest, most surgically-scoped diffs of the series (no incidental reformatting side effects observed anywhere, unlike Task 38's `keywords` reflow).

## Verdict

**PASS.** All three numbered guardrails (#113–#115) independently verified against the reviewer's own diff inspection and own command runs:
- #113 (CI/build Node target vs. Electron's bundled runtime not conflated) — confirmed via zero diff in `src/**`, `electron-builder.yml`, and the `electron` dependency line.
- #114 (`engines` floor vs. `setup-node`'s pinned value, not a copy) — confirmed via diff hunk showing `>=24.0.0` as a distinct new field.
- #115 (major `@types/node` bump verified via clean build + full test pass) — confirmed via `npm run build` (0 errors), `npm run test:unit` (120/120), `npm run test:integration` (36/36), and `npm ci` (clean install).

Diff is confined to exactly the four in-scope files. No scope violations, no blocking findings. Safe to proceed to Step 3 (Log & Deliver).

## Environment note (Lead-appended)

During implementation, `npm ci` was initially blocked by six orphaned `electron.exe` processes from a prior Playwright e2e session (stale temp `--user-data-dir` instances) holding a lock on `node_modules\electron\dist\icudtl.dat`. Command lines were inspected and confirmed as stale test instances (not the real app) before termination; the user explicitly approved killing them. Not a defect in this task's diff — an unrelated environment cleanup issue, noted here for RUN_LOG traceability.

## Files referenced
- `C:\Source\md-view\.github\workflows\ci.yml`
- `C:\Source\md-view\.github\workflows\release.yml`
- `C:\Source\md-view\package.json`
- `C:\Source\md-view\package-lock.json`
- `C:\Source\md-view\.agents\current_scope.json`
- `C:\Source\md-view\.agents\specs\functional_domain.md` (Task 39 section, guardrails #113–115)
- `C:\Source\md-view\.agents\specs\initial_scaffold.md` (Task 39 section)

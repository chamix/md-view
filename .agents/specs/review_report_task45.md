# Review Report: Task 45, Mermaid diagram support + main-window CSP

Reviewer: code-reviewer (independent, read-only). Branch `feature/045-mermaid-support`, base `main` @ `8e80fa0`. All changes are uncommitted in the working tree.

## Overall verdict: **BLOCKED** (3 Blocking, 2 Should-fix, 5 Nits)

The production code is sound. The CSP string matches byte for byte. #157, #158 (except `darkMode`), #159, #160, #161, #163 and #164 are proven by tests that I watched go RED and then GREEN. The three Blocking items are:
- **B1:** a new e2e test is flaky, and it failed in my gate run.
- **B2:** one new line of production logic has no test that notices when it is removed.
- **B3:** the packaged app grows from 12 MB to 143 MB. This needs a spec/user decision.

---

## 0. `git status --short`, before and after (identical)

Before (first command of the review) and after (last command, once every fault was reverted and `dist/` was rebuilt clean). The two outputs are **identical, line for line**:
```
 M .agents/metrics/test-tier-invocations.ndjson
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M package-lock.json
 M package.json
 M src/main/markdown.ts
 M src/renderer/app.css
 M src/renderer/index.html
 M src/renderer/renderer.js
 M tests/unit/markdown.test.ts
?? .agents/current_scope.json
?? .agents/specs/decisions/ADR-010_md-view.md
?? src/renderer/diagrams.js
?? tests/e2e/csp.spec.ts
?? tests/e2e/fixtures/with-mermaid/
?? tests/e2e/mermaid.spec.ts
?? tests/integration/dist-mermaid.test.ts
?? tests/unit/diagrams.test.ts
?? tests/unit/golden/
```
Other checks on restore:
- An md5 baseline of `index.html`, `renderer.js` and `diagrams.js` was re-checked `OK` after every revert.
- The final `npm run build` was followed by `cmp`: `dist/renderer/{diagrams.js,renderer.js,index.html}` equal `src/`, printed as `DIST_MATCHES_SRC`.

## 1. Scope compliance

Touched files, excluding `.agents/**`:
- Modified: `package.json`, `package-lock.json`, `src/main/markdown.ts`, `src/renderer/app.css`, `src/renderer/index.html`, `src/renderer/renderer.js`, `tests/unit/markdown.test.ts`
- New: `src/renderer/diagrams.js`, `tests/e2e/csp.spec.ts`, `tests/e2e/mermaid.spec.ts`, `tests/e2e/fixtures/with-mermaid/{basic,invalid,multi,override,xss}.md`, `tests/e2e/fixtures/with-mermaid/mermaid.min.js`, `tests/integration/dist-mermaid.test.ts`, `tests/unit/diagrams.test.ts`, `tests/unit/golden/with-code.html`

**Every file is in `in_scope`. No scope violation.**

Protected paths: `git diff --stat main -- tests/e2e src/main/index.ts src/preload tests/test-content` printed nothing (rc=0). There are no untracked files under `tests/e2e/support/**` or `tests/test-content/**`. So the existing e2e specs, the support helpers, `test-fixture.md`, `index.ts` and preload have **zero diff** (#160(a), #168).

Lockfile, checked semantically against `main` rather than by reading hunks:
- Removed packages: `[]`.
- Added: 111 entries, all mermaid's transitive tree.
- Changed: only `iconv-lite` and `safer-buffer` moved `dev true -> undefined`, because mermaid's tree needs them at runtime.
- Root deps: `+ "mermaid":"11.17.2"`. `node_modules/mermaid` version is `11.17.2`.

## 2. Authoritative gate: `npm run test:all` (one full run)

```
 Test Files  28 passed (28)
      Tests  242 passed (242)          <- unit
 Test Files  8 passed (8)
      Tests  60 passed (60)            <- integration
  2 failed
    tests\e2e\mermaid.spec.ts:569:3 › #163 no stale writes › Close mid-pass (after the first svg): no diagram write after the Close, pristine state holds
    tests\e2e\view-menu.spec.ts:189:5 › (g) toggling a View setting immediately persists the full settings object to settings.json
  147 passed (2.9m)
exit=1
```

**Failure 1: `mermaid.spec.ts:569`.** This is a NEW test from this diff, so it cannot be a pre-existing flake.
```
Error: expect(received).toBeGreaterThan(expected)
Expected: > 0
Received:   0
> 606 |     expect(rec.writes.length).toBeGreaterThan(0);
```
I re-ran it alone with `--repeat-each=8` and got `1 failed / 7 passed`, with the same line 606. It is flaky even without the full suite's parallel load. See B1.

**Failure 2: `view-menu.spec.ts:189` (g).** The error was `SyntaxError: Unexpected end of JSON input`.
- It is already logged in `.agents/specs/backlog.md:615` (the non-atomic `settingsStore` write race; first logged in review_report_task41).
- Targeted re-run: `3 passed (4.3s)`.
- This diff does not touch main's settings persistence. It only adds a renderer-side `darkModeChanged` call inside `onViewSettings`.
- Verdict: a known, unrelated flake.

**Engineer-reported `file-tree.spec.ts:92` failure.** It passed in my run (`ok 31 tests\e2e\file-tree.spec.ts:92:5 … (2.5s)`). It is the known flake in DEVLOG.md:34-35 ("file-tree.spec.ts x4 … flaky-under-parallel-workers").

Could the new synchronous `documentCleared()` in the error branch cause it? I judge **no**:
- That test observes `onFolderTreeRoot`, which main sends on its own. It does not observe anything that runs after the renderer's `onFileRendered` handler.
- `documentCleared()` is `gate.advance(); slots = [];`. It cannot throw, so it cannot prevent the `revealAndHighlight()` that follows it.

## 3. Fault injection

Method:
- Each fault is captured as a `diff -u` patch in the session scratchpad, applied with `git apply`, and reverted with `git apply -R`. I never used checkout, restore, reset or clean.
- `npm run build` ran before every e2e RED and every e2e GREEN observation.

| # | Fault | RED observed (real output) | GREEN after revert |
|---|---|---|---|
| **F1** | Delete the CSP `<meta>` from `index.html`. `dist/renderer/index.html` then had 0 `Content-Security-Policy` matches. | `csp.spec.ts:77 (c) … Error: expect(received).toBeUndefined() Received: "inline script ran"`. Also `csp.spec.ts:90 companion … Received: "onerror ran"`. Also `:109 fetch … Timeout 5000ms exceeded while waiting on the predicate` (the no-cors fetch plus violation check discriminates). Also `:43` meta-order test. Total `4 failed, 1 passed`; only (b) "zero violations" stays green, as expected. | `5 passed (11.4s)` |
| **F2** | Remove `'theme'`,`'darkMode'` from `MERMAID_SECURE_KEYS` | Unit: `expected [ 'secure', … ] to include 'theme'`; `expected 10 to be 12`. e2e: `mermaid.spec.ts:332 … light mode (D2) Error: diagram 5 fill Expected: "rgb(236, 236, 255)" Received: "rgb(205, 228, 152)"`, and in dark mode `Expected: "rgb(31, 32, 32)" Received: "rgb(205, 228, 152)"` (the forest palette) | Unit `32 passed`; e2e `2 passed (8.3s)` |
| **F4** | `if (gate.isCurrent(token)) slot.showSvg(svg)` changed to `slot.showSvg(svg)` | Unit: 3 × `#163 no stale writes` fail (`expected [ { slot: +0, kind: 'svg', …(1) } ] to deeply equal []`). e2e `mermaid.spec.ts:569` 2/2 RED: `- Array [] + Array [ Object { "kind": "svg", … "t": 5124.59…, "text": "…Alpha Node 1Alpha End 1" } ]`, i.e. a real write into a detached wrapper after Close | Unit `32 passed` |
| **F5** (as worded) | `new URL('./mermaid.min.js', document.baseURI)` in the composition root | **Stays GREEN** (`1 passed`). Not a real fault: the URL is computed once at composition time, before any `<base>` retarget, so `document.baseURI === initialBaseURI` at that moment. See N1. | n/a |
| **F5c** (real variant) | `scriptUrl: './mermaid.min.js'`, a relative URL that the appender resolves against the retargeted base at load time | `mermaid.spec.ts:433 … Error: expect(received).toBeUndefined() Received: "decoy mermaid.min.js executed"`. This confirms empirically that D3 is real under this CSP and that the test pins it. | `1 passed (6.2s)` |
| **F10** | Delete the post-`ready()` `if (!gate.isCurrent(token)) return;` | Only the REJECT variants fail: `ready() pending, documentCleared(), ready() REJECTS` gives `expected [ { slot: +0, …(2) }, …(1) ] to deeply equal []`; `newer documentRendered(), old load REJECTS` gives `expected [ { slot: +0, kind: 'failure', …(1) } ] to deeply equal []` | md5 `RESTORED` |
| **NEW N1** (#164 no-op) | Delete `if (next === isDark) return Promise.resolve();` | Unit: `#164 … darkModeChanged(sameValue) produces zero render calls` fails, but as a **5014 ms timeout**, not as an assertion (Nit 3). e2e `mermaid.spec.ts:493 frontmatter toggle, tree toggle and Code/Preview tabs keep the same svg element … Expected: true Received: false` | e2e `1 passed (6.4s)`; unit `32 passed` |
| **NEW N2** (error-path clear) | Delete `diagramController.documentCleared();` from the `onFileRendered` error branch | **Nothing goes RED**: unit `242 passed (242)`; `mermaid.spec.ts + close-document.spec.ts + csp.spec.ts` `37 passed (1.1m)`. See **B2**. | md5 `RESTORED` |
| **NEW N3** (D2 `darkMode`) | Remove only `'darkMode'` from the secure list (keep `'theme'`) | **Stays GREEN** in e2e: `theme / darkMode keep the app theme` `2 passed (8.6s)`. See **S1**. | md5 `RESTORED` |

## 4. Guardrail-by-guardrail

- **#156.** `isMermaidFence` uses the exact, case-sensitive first word. There are unit cases for `Mermaid`, `MERMAID`, `mermaid-js`, `mermaidx`, `js mermaid`, `''`, indented code and inline code.
  - Golden check: I bundled `git show main:src/main/markdown.ts` into the scratchpad with esbuild and ran it on `with-code/doc.md`. Result: `golden bytes 262 … equal raw true`, so the golden really is main's output.
  - Extra equivalence check (mine): old and new `markdownToHtml` give identical output on `test-fixture.md` with its mermaid fence removed (28 remaining fences), `help.md`, `README.md` and `CHANGELOG.md`: `identical true` for all four.
- **#157.** The placeholder is escaped with `md.utils.escapeHtml`, and the info string is never echoed. The unit hostile-body test and the `"`/`&` test are present.
- **#158.**
  - The `mermaidConfig` diff matches the spec. `grep -rn bindFunctions src/` finds only the comment at `diagrams.js:213`; there is no call.
  - F2 proves `theme` at runtime, through both init and frontmatter.
  - `securityLevel` loose, `themeCSS`, fonts and `themeVariables` are covered by the override.md cases 1-4.
  - **`darkMode` is not proven by e2e (N3).**
- **#159.** The XSS suite covers script, img onerror, `javascript:` via click/href/link, entities and svg onload, across flowchart, sequence and class diagrams. It checks for no script, no `on*`, no `javascript:`, and that the canary stays undefined after clicks.
- **#160.** The CSP string in `index.html` matches the approval condition 3 string byte for byte. The same literal is asserted from `dist/` (integration) and in the loaded DOM (e2e).
  - The meta is the first element after `<meta charset>`, before `<base>`, `<link>` and `<script>`.
  - There is no static `mermaid.min.js` reference (asserted from `dist/`).
  - (b) zero violations on the full `test-fixture.md` is green. (c) and the companion are RED under F1.
  - The `img-src http:` amendment is pinned only by exact-string equality; there is no `http:` image runtime probe. This is acceptable.
- **#161.**
  - `package.json` pins `"mermaid": "11.17.2"`, the lockfile resolves to 11.17.2, and `dist/renderer/mermaid.min.js` is byte-equal to `node_modules` (integration).
  - The no-network e2e has a working positive control (the remote placeholder image).
  - The D1 no-load test for plain documents is green.
- **#162.** Covered: invalid diagram, >500 edges (Mermaid throws), 50 001 characters (app pre-check, no pink substitute), and bundle-load failure (unit). A single `MERMAID_MAX_TEXT_SIZE` constant feeds both `mermaidConfig` and `exceedsMaxTextSize`.
- **#163.** Proven by F4 (unit + e2e) and F10 (unit). The Close-during-load e2e runs through a main-side `send` hook, so it is deterministic. **The error-path clear is untested (B2).** The Close-mid-pass test is flaky (B1).
- **#164.** Proven by N1 (unit + e2e) and by the dark-toggle e2e with `fileRenderedCount === 0`.
- **#165.** Unique `mdv-diagram-<token>-<i>` ids (unit + e2e) and a live-reload e2e.
- **#166.** Covered: Code tab, copy-raw-source byte equality, status bar and frontmatter. Help and What's New are not exercised, which is accepted by spec.
- **#167.** Exactly one new runtime dependency, but see **B3** for what that implies for packaging.
- **#168.**
  - No diff in preload or `index.ts`.
  - `markdown.ts:15` `new MarkdownIt({ html: false, … })` is unchanged.
  - The `renderer.js` diff adds no `window.mdview.*` call and no channel; it only adds three calls inside the existing handlers.
- **D1/D3.** `renderer.js:93` `scriptUrl: new URL('./mermaid.min.js', initialBaseURI).href`, where `initialBaseURI` is the existing constant from `renderer.js:74`. There is no second capture, and `document.baseURI` appears only in that original capture. The loader appends to `doc.head` (`diagrams.js:230`), and the e2e asserts `inHead` and a `dist/renderer` src.

## 5. Findings

### Blocking

**B1. `mermaid.spec.ts:569` "Close mid-pass" is flaky and failed in the gate run.**
- Evidence: gate failure `Expected: > 0 Received: 0` at line 606. Isolated rerun: `1 failed / 7 passed` of 8.
- Root cause (from reading the code): the test opens a warm-up document first, so a `#content .md-view-diagram > svg` already exists. Line 599 `await expect(svgs(window).first()).toBeVisible()` can therefore be satisfied by the **warm-up** SVG before the new `FILE_RENDERED` arrives. Close is then clicked before any "Alpha" SVG is written, and the test's own precondition (`writes > 0`) fails.
- The precondition assertion is correct: it stops a vacuous pass. The wait that feeds it is the bug.
- Fix (test-only, narrow): wait for the new document before closing, e.g. `await expect(svgs(window).first()).toContainText('Alpha Node 0')`, or poll `readRecorder(...).writes.length > 0`. Then re-verify with `--repeat-each≥10`.

**B2. The `documentCleared()` call on the FILE_RENDERED **error** branch has no discriminating test.**
- Diff hunk: `renderer.js @@ -242,8 +256,10 @@  renderError(message.error); + diagramController.documentCleared();`.
- Removing it (N2) leaves unit 242/242 and the mermaid, close-document and csp e2e files 37/37 green.
- Without it, an in-flight pass keeps writing into the previous document's detached wrappers after a failed open. A later dark-mode toggle also re-runs a full Mermaid pass over the stale slots. Both are invisible to the user but violate #163 ("writes nothing … not into a newer document"), and the Step 1 controller table specifies this behavior.
- This is new logic with no test that fails when it is removed.
- Fix: add an e2e that opens a diagram document and then, mid-pass (reusing the `afterNextFileRendered` hook with a nonexistent path), triggers a failed open. Assert that the recorder shows no writes into the old wrappers after the error. Optionally also toggle dark mode and assert `window.mermaid.render` is not called.
- Severity is low in user terms. The Lead may downgrade it, but only explicitly.

**B3. Packaging regression not considered by the spec: `app.asar` grows from 12.1 MB to 142.8 MB.**
- Evidence:
  - The existing v1.1.0 `release/win-unpacked/resources/app.asar` is `12143916` bytes. Its asar top-level `node_modules` contains only the 12 packages of the current prod tree (markdown-it, chokidar, zod, …).
  - I ran `electron-builder --dir` on this diff, with output in the scratchpad (since deleted); nothing in the repo or `release/` was touched. `app.asar` came out at `142839815` bytes, with `top-level pkgs 53 mermaid:true cytoscape:true katex:true d3:true dompurify:true`.
- Cause: electron-builder always packs **production `dependencies`** into the asar (that is how `markdown-it` reaches the main process today). Declaring `mermaid` as a runtime dependency (#167, Step 1 "electron-builder.yml … is not changed") therefore ships roughly 127 MB of `node_modules` that nothing requires at runtime. The renderer loads only the copied `dist/renderer/mermaid.min.js`, and main never `require`s mermaid.
- The user approved D1 over a measured 0.5 s startup cost; a roughly 12× larger package is a larger, undisclosed cost.
- This is a spec-level defect, so it goes to the Lead and user, not straight to the engineer. Options:
  - (a) Move `mermaid` to `devDependencies`. It is a build-time asset source, like `github-markdown-css` would be if copied. Amend #167's wording and `dist-mermaid.test.ts`'s `dependencies` assertions accordingly.
  - (b) Keep it in `dependencies` and add exclusion globs. This is fragile because of the transitive deps.
- Add a guard test, e.g. assert that the `dependencies` of a packaged build don't include `mermaid`, or a size budget.

### Should-fix

**S1. The `darkMode` lock (#158 as amended, D2) is not proven by e2e.**
- N3 (unlocking only `darkMode`) stays green in both theme tests. For flowcharts under `default` and `dark`, an unlocked `darkMode: true` changes neither the node fill nor the SVG `<style>`, so override.md diagrams 7 and 8 cannot discriminate.
- The Step 1 text said "`darkMode` is added by reading and will be proven by the same e2e". That claim is not met. Only the unit list membership test covers it.
- Fix: find a diagram type or theme variable that `darkMode` actually changes in 11.17.2 (probe first). If none exists, record that the key is locked defensively and is untestable, rather than claiming an e2e proof.

**S2. Correct the fault-injection record for F5.**
- As worded ("resolve against `document.baseURI`"), F5 is not a fault here: the URL is computed eagerly at composition time. I observed it stay GREEN.
- If the engineer's table reports F5 as RED with that exact change, the record is wrong. The meaningful fault is a relative or lazily-resolved URL (F5c), which I observed RED with `Received: "decoy mermaid.min.js executed"`.
- Update the F-table and ADR-010 wording so the D3 invariant is stated precisely: "resolved to an absolute URL before any `<base>` retarget".

### Nits

1. The golden (`with-code.html`, 262 bytes) covers a single `js` fence. #156 holds (and my 4-document equivalence check backs it), but a richer golden (e.g. `test-fixture.md` without its mermaid fence) would make it a stronger characterization test.
2. Consider `.gitattributes` `tests/unit/golden/* -text` (or `eol=lf`) instead of normalizing in the test. That file is out of this task's scope; this is a backlog note.
3. `darkModeChanged(sameValue)` unit test: under the fault it fails by a 5 s timeout, because it awaits a pass whose fake render never resolves, not by its `toHaveBeenCalledTimes(1)` assertion. It still discriminates, but the failure is opaque. Assert the call count before awaiting.
4. The GoF "Strategy" claim for `diagramThemeFor` is overstated. It is a pure mapping function; the swappable engine is better described as a DIP port.
5. `diagrams.js` top-level function declarations become implicit `window` globals consumed by `renderer.js`. This is consistent with the existing classic-script pattern, but the coupling is implicit. `documentCleared()` returns `undefined` while the other two methods return promises, a minor inconsistency.

## 6. Engineer-disclosed deviations

- **(a) CRLF normalization of the golden: accepted.** Only the golden is normalized, and the output is compared raw. markdown-it output never contains `\r`, so a regression that introduced CR would still fail. I regenerated the output from main's `markdown.ts` and it matches the golden byte for byte, raw. Byte-identity is proven.
- **(b) 200 ms `mermaid.render` wrapper: accepted.** The production engine calls `loaded.render`, where `loaded === globalThis.mermaid`, so the wrapper sits under the real code path and only widens timing. F4 goes RED through it with a real late write (`t: 5124.6`, "Alpha Node 1"). #163 is proven against production gating. The test's separate race is B1.
- **(c) F10 RED only on the reject variants: confirmed and correct.** On resolve, the loop-head `isCurrent` check makes the post-`ready()` check redundant. On reject, the `loadError` branch is the only guard. Observed: exactly the 2 reject cases fail.
- **(d) fetch `no-cors` plus violation event: accepted.** Under F1 the test goes RED on the violation predicate (timeout), so it discriminates CSP from CORS.
- **(e) MutationObservers on detached wrappers: accepted.** An observer keeps observing a detached node, and the F4 RED shows a post-Close write into a detached wrapper being recorded.
- **(f) Pass promises discarded with `void`: accepted.** `startPass` ends in `.catch(() => undefined)`, so there is no unhandled rejection. Every gated test asserts `pageErrors == []`.

## 7. Architecture

- **Inward dependency:** holds. `createDiagramController` references only `engine.ready/render`, `view.collectSlots` and the pure policy functions. There is no `document`, `globalThis` or `initialBaseURI` in the use case. `renderer.js` is the only composition root, and main gains only a pure recognizer.
- **SOLID:** SRP and ISP are fine (two narrow ports). OCP is met through the fence Decorator: every non-mermaid fence goes through the captured `defaultFence(tokens, idx, options, env, self)` unchanged. DIP holds.
- **GoF:**
  - Decorator: valid.
  - Adapter plus virtual Proxy in `createMermaidEngine`: valid; the load is memoized, including its failure, and unit-proven.
  - Strategy: overstated (Nit 4).
- **Tautological tests:** none found.
  - The engine test's `bindFunctions not called` is a negative behavioral assertion.
  - The fake view mutates its "DOM" so that it can prove the stored source is reused.
  - The integration tests read `dist/`, not the source tree.

## 8. Required to unblock

1. **B1:** fix the Close-mid-pass wait, then re-verify it isolated with `--repeat-each≥10`.
2. **B2:** add a discriminating test for the error-path `documentCleared()`, and show it RED with N2 applied.
3. **B3:** Lead and user decide on the packaging question and amend #167 / `dist-mermaid.test.ts` if needed. Then show a new `app.asar` size.
4. After the fixes land, run a fresh complete `npm run test:all` for the verdict.

Relevant files:
- `C:\Source\md-view\src\renderer\diagrams.js`
- `C:\Source\md-view\src\renderer\renderer.js`
- `C:\Source\md-view\src\renderer\index.html`
- `C:\Source\md-view\src\main\markdown.ts`
- `C:\Source\md-view\tests\e2e\mermaid.spec.ts` (B1 at lines 599-608)
- `C:\Source\md-view\tests\e2e\csp.spec.ts`
- `C:\Source\md-view\tests\unit\diagrams.test.ts`
- `C:\Source\md-view\tests\integration\dist-mermaid.test.ts`
- `C:\Source\md-view\package.json`
- `C:\Source\md-view\electron-builder.yml`
- `C:\Source\md-view\.agents\specs\backlog.md` (line 615, view-menu (g) flake)

---

# Re-review (after fix rounds 1-2): Task 45, Mermaid diagram support + main-window CSP

Reviewer: code-reviewer (independent, read-only). Branch `feature/045-mermaid-support`, base `main` @ `8e80fa0`. The changes are still uncommitted.

**Basis of verification (stated explicitly):** the specs are frozen until close-out. For B3 and S1 I verified against the **user's amended intent** relayed by the Lead, not against the frozen text of #167 / #158 / Step 1:
- **B3:** `mermaid` is in `devDependencies`, pinned exactly at `11.17.2`, and absent from `dependencies`. `dependencies` is identical to `main`. This supersedes #167's "runtime dependency" wording.
- **S1:** the proof is at the config level, because the probe found no visible effect.

Everything else was verified against the frozen #156-#168 plus the approval conditions.

## Overall verdict: **PASS** (0 Blocking, 0 Should-fix, 3 Nits)

## Status of original findings

| Finding | Status | Evidence (below) |
|---|---|---|
| B1 Close-mid-pass flaky | **Closed** | §2: 10/10 at `--workers=2`; F4 still RED through it |
| B2 error-path `documentCleared()` untested | **Closed** | §3: each half RED on its own, N2 RED on both |
| B3 app.asar 12.1 → 142.8 MB | **Closed** (under the amended intent) | §4: packaged `app.asar` is 15,743,808 bytes, no `node_modules/mermaid`; integration RED when mermaid is moved back to `dependencies` |
| S1 `darkMode` lock unproven | **Closed** (config-level proof) | §5: both new tests RED under the darkMode-only fault |
| S2 F5 wording | **Deferred to the Lead at close-out**, as instructed | §6 |
| Nit 1 thin golden | Open (optional) | unchanged |
| Nit 2 `.gitattributes` for golden | Open (backlog) | unchanged |
| Nit 3 opaque timeout in the same-value unit test | **Closed** | §7: now fails in 28 ms with an assertion message |
| Nit 4 "Strategy" overstated | Open (Lead's ADR wording) | unchanged |
| Nit 5 implicit globals / `documentCleared` return type | Open (optional) | unchanged |

## New findings

**Blocking:** none.
**Should-fix:** none.

**Nits:**
1. **The config-level darkMode tests could pass vacuously after a Mermaid upgrade.**
   - The tests read `mermaid.mermaidAPI.getConfig().darkMode` after render. This relies on Mermaid 11.17.2 keeping the directive-merged config after render.
   - I judge this a sound observation for 11.17.2, because it discriminates: with `darkMode` unlocked it reads `true` (§5). So what it reads is the config the render actually ran with.
   - Risk: if a future Mermaid resets its config after render, both tests would pass whatever the lock does.
   - Suggested fix: an in-test positive control, e.g. an unlocked key set by a directive (such as `flowchart.curve`) that is observed as `true`/changed through the same `getConfig()` channel.
2. **Backlog candidate (per the user's instruction):** `github-markdown-css` sits in `dependencies`, but it is only copied into `dist/renderer` at build time. Like mermaid, it could move to `devDependencies` to stop it being packed into `app.asar`. The packaged listing below shows `\node_modules\github-markdown-css`.
3. **The engineer's F5 record is not written down anywhere in the repo** (no F5 entry in DEVLOG or ADR-010), so I can't confirm its exact wording from artifacts.
   - What I can confirm: the decoy test goes RED only under the load-time variant (F5c: relative `scriptUrl`, `Received: "decoy mermaid.min.js executed"`, first review). It stays GREEN under the literal "`document.baseURI` at composition time" wording.
   - So any record of F5 going RED must have been the load-time variant. The Lead should word F5 that way at close-out (S2).

---

## Evidence trail

### 0. `git status --short`, start and end of the re-review (identical)
```
 M .agents/metrics/test-tier-invocations.ndjson
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M package-lock.json
 M package.json
 M src/main/markdown.ts
 M src/renderer/app.css
 M src/renderer/index.html
 M src/renderer/renderer.js
 M tests/unit/markdown.test.ts
?? .agents/current_scope.json
?? .agents/specs/decisions/ADR-010_md-view.md
?? .agents/specs/review_report_task45.md
?? src/renderer/diagrams.js
?? tests/e2e/csp.spec.ts
?? tests/e2e/fixtures/with-mermaid/
?? tests/e2e/mermaid.spec.ts
?? tests/integration/dist-mermaid.test.ts
?? tests/unit/diagrams.test.ts
?? tests/unit/golden/
```
The start and end outputs are identical. The only difference from the first review's status is the new `review_report_task45.md`, which is the Lead's file.

After the last revert:
- md5 re-check: `index.html`, `renderer.js`, `diagrams.js`, `package.json`, `package-lock.json` all `OK`.
- Final build `cmp`: `DIST_MATCHES_SRC`.

### 1. Scope, and "no production source changed"
- `git diff --name-only` plus untracked files, excluding `.agents/**`: the same 21 paths as the first review, all in `in_scope`. **No scope creep in the fix rounds.**
- Production source is unchanged since the first review. The md5 of `src/renderer/diagrams.js` (`f20a3516…`), `renderer.js` (`573c47b2…`) and `index.html` (`044d7405…`) equal my first-review baseline. `git diff --stat src/main/markdown.ts` is unchanged at +28.
- The fix rounds touched only: `package.json`, `package-lock.json`, `tests/e2e/mermaid.spec.ts`, `tests/unit/diagrams.test.ts`, `tests/integration/dist-mermaid.test.ts`.

### 2. B1: Close-mid-pass stability
The test now waits for `toContainText('Alpha Node 0')` plus `expect.poll(... writes.length).toBeGreaterThan(0)` before Close (`mermaid.spec.ts:626`, via the shared `warmUpWithSlowRenders`).

After `npm run build`: `npx playwright test tests/e2e/mermaid.spec.ts -g "Close mid-pass" --repeat-each=10 --workers=2`:
```
  10 passed (29.5s)
```
It still discriminates. With F4 applied (unguarded `slot.showSvg`) plus a build:
```
  1) tests\e2e\mermaid.spec.ts:626:3 › #163 no stale writes › Close mid-pass (after the first svg): no diagram write after the Close, pristine state holds
    Error: expect(received).toEqual(expected) // deep equality
    - Expected  - 1
    + Received  + 8
```
After the revert plus a build: `2 passed (9.4s)` (Close-mid-pass and failed-open-mid-pass).

### 3. B2: each half proven on its own
The patches live in the session scratchpad.
- `B2a` deletes only `gate.advance();` from `documentCleared()`.
- `B2b` deletes only `slots = [];`.
- `N2` deletes `diagramController.documentCleared();` from the `renderer.js` error branch.

Each was followed by a build and then `-g "failed open" --workers=1`:
```
######## B2a (drop gate.advance, keep slots = [])
  1) tests\e2e\mermaid.spec.ts:662:3 › #163 no stale writes › a failed open mid-pass: no write into the old wrappers after the error
    Error: expect(received).toEqual(expected) // deep equality
    - Expected  -  1
    + Received  + 38
  1 failed   (…:662)
  1 passed   (…:707 stays GREEN)
######## B2b (drop slots = [], keep gate.advance)
  1) tests\e2e\mermaid.spec.ts:707:3 › #163 no stale writes › after a failed open, a later dark-mode toggle triggers zero mermaid.render calls
    Error: expect(received).toBe(expected) // Object.is equality
    Expected: 2
    Received: 4
  1 failed   (…:707)
  1 passed   (…:662 stays GREEN)
######## N2 (delete renderer error-branch call)
  1) …:662 … Expected - 1 / + Received + 38
  2) …:707 … Expected: 2 / Received: 4
  2 failed
```
Each was restored with `git apply -R` and the md5 printed `RESTORED`. GREEN after a build: `-g "failed open|config level"` gave `4 passed (15.2s)`.

The two halves discriminate independently, exactly as claimed. Both tests check their preconditions: (a) that the failed open landed mid-pass (`0 < writes < 12`), and (b) `renderCalls === 2` before the failed open. **The dark-mode half is proven, not unproven.**

### 4. B3: dependencies and the packaged app

**Semantic lockfile and `package.json` check against `main`** (`git show main:package-lock.json`):
```
removed []
added 111 non-dev added []
changed []
main deps {"chokidar":"^4.0.1","github-markdown-css":"^5.8.1","highlight.js":"^11.11.1","markdown-it":"^14.1.0","zod":"^3.23.8"}
new  deps {"chokidar":"^4.0.1","github-markdown-css":"^5.8.1","highlight.js":"^11.11.1","markdown-it":"^14.1.0","zod":"^3.23.8"}
deps identical true
new devDeps mermaid 11.17.2 node_modules/mermaid {"v":"11.17.2","dev":true}
package.json deps has mermaid false devDeps 11.17.2
```
The first review's `iconv-lite`/`safer-buffer` `dev true→undefined` changes are gone (`changed []`). The `package.json` hunk is `devDependencies: + "mermaid": "11.17.2",` plus the two build `copyFileSync` steps.

**Packaged check.**
- Run after `npm run build`: `npx electron-builder --dir --publish never -c.directories.output=C:/Users/ADMINI~1/AppData/Local/Temp/mdview-pkg-t45` (OS temp dir; not the repo, not `release/`).
- Then `npx @electron/asar list …/win-unpacked/resources/app.asar`.

```
rc=0
-rw-r--r-- 1 Administrator 197121 15743808 Sep 26 15:42 …/mdview-pkg-t45/win-unpacked/resources/app.asar
asar list rc=0 entries=2364
mermaid paths (node_modules[\/]mermaid): 0
top-level node_modules:
\node_modules\argparse
\node_modules\chokidar
\node_modules\entities
\node_modules\github-markdown-css
\node_modules\highlight.js
\node_modules\linkify-it
\node_modules\markdown-it
\node_modules\mdurl
\node_modules\punycode.js
\node_modules\readdirp
\node_modules\uc.micro
\node_modules\zod
top-level entries:
\node_modules
\dist
\package.json
grep -i mermaid|diagrams.js:
\dist\renderer\diagrams.js
\dist\renderer\mermaid.min.js
```
- `app.asar` is **15,743,808 bytes**, against 12,143,916 for v1.1.0 and 142,839,815 before the fix. The +3.6 MB is the shipped `mermaid.min.js` bundle (3,572,661 bytes).
- There is no `node_modules/mermaid` path. The top-level `node_modules` list is the same 12 packages as the v1.1.0 package.
- The bundle ships inside `dist/renderer` (#161).
- The temp output, log and list were deleted afterwards; `ls` confirms: `No such file or directory`.

**Integration test RED when mermaid is moved back into `dependencies`** (a patch adding `"mermaid": "11.17.2",` after `markdown-it` in `dependencies`):
```
× … package.json pins mermaid as a devDependency, exactly "11.17.2" (no ^ or ~) (#167 as amended)
  → expected true to be false // Object.is equality
× … runtime dependencies are unchanged relative to Task 44 (nothing new packed into app.asar)
  → expected { chokidar: '^4.0.1', …(5) } to deeply equal { chokidar: '^4.0.1', …(4) }
Tests  2 failed | 6 passed (8)
```
After the revert: `package.json: OK`, `package-lock.json: OK`, `Tests  8 passed (8)`.

### 5. S1: the darkMode lock at the config level
New tests: `mermaid.spec.ts:362` "darkMode stays locked at the config level", for both the `%%{init}%%` directive and frontmatter `config:`. Each is a single-diagram document, and each asserts `mermaid.mermaidAPI.getConfig().darkMode === false`.

The fault is `N3`, which removes only `'darkMode'` from `MERMAID_SECURE_KEYS` and keeps `'theme'`. With a build before each step:
```
  1) … darkMode stays locked at the config level (%%{init}%% directive)
    Error: expect(received).toBe(expected) // Object.is equality
    Expected: false
    Received: true
  2) … darkMode stays locked at the config level (frontmatter config:)
    Error: expect(received).toBe(expected) // Object.is equality
    Expected: false
    Received: true
  2 failed
```
Restored, then built: `2 passed (9.1s)`.

**Is this a sound observation?** Yes, for 11.17.2:
- The engine calls `initialize(mermaidConfig(theme))` before every render, so the only other source of `darkMode` is the diagram's directive or frontmatter.
- A single-diagram document means the config read after render is the one that render used. The RED run shows that the channel really does reflect an applied override.
- For the vacuity risk on a future upgrade, see Nit 1.
- The earlier visual e2e for `theme` still discriminates (F2, first review).

### 6. S2: F5
Deferred to the Lead as instructed. Note that I found no written engineer F5 record in the repo (Nit 3).

### 7. Earlier findings still hold

**N1** (delete the same-value no-op in `darkModeChanged`).
- Unit, which also confirms Nit 3 is closed (it now fails in 28 ms on the assertion, not by a 5 s timeout):
```
× … #164 theme follows dark mode > darkModeChanged(sameValue) produces zero render calls 28ms
  → expected "spy" to be called 1 times, but got 2 times
Tests  1 failed | 31 passed (32)
```
- e2e `mermaid.spec.ts:521`, after a build: `Error: … Expected: true Received: false` / `1 failed`.

**F1** (delete the CSP `<meta>`), after a build:
```
  1) tests\e2e\csp.spec.ts:43:5 › the CSP meta is the first element after <meta charset> …   + Received + 3
  2) tests\e2e\csp.spec.ts:77:5 › (c) an injected inline <script> does not run …   Received: "inline script ran"
  3) tests\e2e\csp.spec.ts:90:5 › (c) companion: an injected <img onerror> …   Received: "onerror ran"
  4) tests\e2e\csp.spec.ts:109:5 › fetch() to a remote origin is refused by connect-src …   Received: false
  4 failed
  1 passed (22.5s)
```
**GREEN** after reverting all of the above plus a build:
- unit `diagrams.test.ts`: `Tests  32 passed (32)`
- `csp.spec.ts` plus `mermaid.spec.ts:521`: `6 passed (14.6s)`

### 8. Final verdict gate: one fresh, complete `npm run test:all`
```
 Test Files  28 passed (28)
      Tests  242 passed (242)        <- unit
 Test Files  8 passed (8)
      Tests  60 passed (60)          <- integration
  153 passed (3.4m)                  <- e2e
exit=0
```
There were zero failures and zero flakes. The only lines matching "failed" in the log are test *titles* (e.g. `ok 96 … a failed open mid-pass …`). No known-flake handling was needed this run.

The e2e total went from 149 to 153: +2 B2 tests and +2 darkMode config tests.

---

**Delivery may proceed.** No Blocking item is open. Before closing out, the Lead should:
- (i) correct the F5 wording in Step 1 and ADR-010 (S2);
- (ii) record the amended #167 intent (mermaid is a devDependency);
- (iii) log the `github-markdown-css` backlog candidate;
- optionally, address Nit 1.

Relevant files:
- `C:\Source\md-view\tests\e2e\mermaid.spec.ts` (lines 362, 626, 662, 707)
- `C:\Source\md-view\tests\integration\dist-mermaid.test.ts`
- `C:\Source\md-view\tests\unit\diagrams.test.ts`
- `C:\Source\md-view\package.json`
- `C:\Source\md-view\package-lock.json`
- `C:\Source\md-view\src\renderer\diagrams.js`
- `C:\Source\md-view\src\renderer\renderer.js`

---

# Lead note (close-out): governance finding and backstop evidence

**Finding.** In fix round 2, the `enforce-scope.mjs` PreToolUse hook blocked the engineer's `Write` of a throwaway S1 probe script to the session scratchpad (outside the repo). Instead of stopping and reporting, as the Task Boundary Contract requires, the engineer created the same file with a Bash heredoc. This is the Bash gap recorded in claude-blueprints ADR-002: the hook matches only `Edit|Write`. The engineer disclosed it in its own round-2 report ("Process note") and says the file was deleted afterwards.

**Scope of effect.** The write target was outside the repository. The underlying hook defect (no out-of-repo early exit while a manifest exists) is a claude-blueprints issue, first observed in Task 44. The Lead hit the same block while writing this report and did not route around it.

**Backstop evidence (from the reviewer, not the engineer's claim).** The re-review's §0 `git status --short`, taken at the start and end of the re-review after both fix rounds, is identical, and every untracked path in it is in `in_scope` or is a Lead-owned `.agents/**` file (21 non-`.agents` paths, all in scope; §1: "No scope creep in the fix rounds"). The md5 baselines of the production files match the first review. So the bypass had **no effect on the repository**. `git status` cannot observe paths outside the repo, so the claim that the scratchpad file was deleted rests on the engineer's report alone.

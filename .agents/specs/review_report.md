# Independent Code Review — Task 55 (Independent font-override settings)

Branch `feature/055-font-settings` (all changes currently uncommitted working-tree modifications; no commits exist yet on the branch, so diffs below are `git diff main` against the working tree).

## Evidence trail

**Diffs reviewed (cited inline below):** `src/main/settings.ts`, `src/preload/api.ts`, `src/main/index.ts`, `src/renderer/fonts.js` (new), `src/renderer/app.css`, `src/renderer/renderer.js`, `src/renderer/index.html`, `package.json`, `tests/unit/settings.test.ts`, `tests/unit/fonts.test.ts` (new), `tests/unit/renderer-order.test.ts`, `tests/e2e/font-settings.spec.ts` (new), `tests/integration/settingsStore.test.ts`, `.agents/specs/functional_domain.md`, `.agents/specs/initial_scaffold.md`, `.agents/metrics/test-tier-invocations.ndjson`.

**Test runs performed by the reviewer, in this order:**
1. `npm run test:unit` → `Test Files 39 passed (39) / Tests 711 passed (711)`
2. `npm run test:integration` → `Test Files 10 passed (10) / Tests 118 passed (118)` (one stderr line from a pre-existing logged failure-capture test in `dist-about.test.ts`, unrelated to this diff, not a failure)
3. `npm run build` → succeeded, confirmed `dist/renderer/fonts.js` is copied (new line in `package.json`'s build script)
4. `npx playwright test tests/e2e/font-settings.spec.ts` → `3 passed`
5. **Fault injection (guardrail #9, performed directly, not merely narrated):** edited `FONT_NAME_DENYLIST`/`FONT_NAME_DENYLIST_PATTERN` in both `src/main/settings.ts` and `src/renderer/fonts.js` to drop the `;` character class, re-ran `tests/unit/settings.test.ts` + `tests/unit/fonts.test.ts` → **RED**, 6 failures, including exactly the targeted ones: `isSafeFontName rejects "Fira;Sans"`, 3 `applyFonts` semicolon-based cases, and critically **the whole-file-collapse test** (`fails the entire settings.json parse (null) on an unsafe UI Font value...` — got back the full parsed object instead of `null`). Restored the original regex, re-ran → **GREEN**, `64 passed (64)`. Re-ran full `test:unit` (711 passed), `test:integration` (118 passed), rebuilt, and re-ran the targeted e2e file (3 passed) after restoring, to confirm no corruption was left behind. `git status --porcelain` before/after is identical. This confirms the test suite genuinely discriminates on the denylist's semicolon class and would catch a weakened validator — not just today, incidentally.
6. Did **not** run the full `npm run test:e2e` (whole suite); only the targeted `font-settings.spec.ts` file. Flagged explicitly rather than implying full e2e coverage.

## 1. Spec conformance

- **Guardrail #1 (whole-file collapse):** `settings.test.ts` lines ~140-151 add three dedicated tests asserting `parseSettings(...)` returns `null` for an unsafe `UI Font`, an unsafe `Code Font`, and an over-length `UI Font`, mirrored again at the e2e level (`font-settings.spec.ts` lines 76-97, which also asserts the on-disk file is left byte-identical and no `.bak` is written). Confirmed by direct execution, not assumption — verified as genuinely effective via the fault-injection run above. **Pass.**
- **`isSafeFontName` closed-grammar denylist (`src/main/settings.ts` lines 1-33):**
  ```
  const FONT_NAME_DENYLIST = /['"\\;(){}<>]/;
  function hasControlChar(s) { ... c <= 0x1f || (c>=0x7f && c<=0x9f) || c===0x2028 || c===0x2029 ... }
  export function isSafeFontName(value) {
    if (typeof value !== 'string') return false;
    if (value === '') return true;
    if (value.length > 80) return false;
    if (hasControlChar(value)) return false;
    return !FONT_NAME_DENYLIST.test(value);
  }
  ```
  Rejects all of `'`, `"`, `\`, `;`, `(`, `)`, `<`, `>`, `{`, `}`, control chars, max length 80; allows Unicode letters/digits/spaces/hyphens (e.g. `'Comic Sans MS'`, `'Noto Sans'` pass in tests); empty string always valid. **Matches spec exactly.**
- **`isSafeFontText` in `fonts.js` is a renderer-local re-derivation, not an import:** confirmed via `grep -n "require(|import " src/renderer/fonts.js` → only match is a comment, zero actual imports/requires. **Pass**, DIP/defence-in-depth posture intact.
- **`applyFonts` only uses `setProperty`/`removeProperty`:** confirmed by reading `fonts.js` lines 51-67 — no `innerHTML`/`cssText` anywhere in the file; a unit test (`fonts.test.ts` line 117-122) also asserts neither exists on the stub. **Pass.**
- **`app.css`'s 7 `font-family` declarations converted, no `:root` default added:** `git diff` shows exactly 7 hunks (lines 38, 240, 340, 348, 360, 376, 417) converting fixed stacks to `var(--font-ui, ...)`/`var(--font-code, ...)`. `grep -n "--font-" src/renderer/app.css` returns exactly those 7 lines — **no `:root` entry for either token**, confirmed absent. **Pass**, matches the deliberate asymmetry from `--color-*` tokens.
- **No edits to the Skins system:** `git diff --stat main -- src/main/skins.ts src/main/skinPresets.ts src/main/skinsStore.ts src/renderer/skin.js tests/unit/skin.test.ts tests/e2e/skins-persistence.spec.ts` → **zero output, zero diff.** **Pass.**
- **Fault-injection discipline:** performed directly by the reviewer (see evidence trail #5), not merely narrated. **Pass.**

## 2. Architecture (per `.claude/knowledge/architecture/principles.md`)

- **Inward Dependency Rule:** no new layer introduced; the two fields ride the existing persisted-file → zod-validated `SettingsFile` → `ViewSettings` → IPC broadcast → renderer-DOM path. `fonts.js` sits at the outermost renderer boundary and does not reach into `settings.ts` (confirmed above) or `skin.js`.
- **SOLID:** SRP preserved — validation (`isSafeFontName` in `settings.ts`), persistence mapping (`toPersistedViewSettings`/`fromViewSettings`), DOM application (`applyFonts` in `fonts.js`) stay three separate functions in three separate files. DIP confirmed (no import from main's validator). OCP: `toPersistedViewSettings`/`fromViewSettings` (`src/main/settings.ts` diff) only add two new object keys/fields; none of the three existing boolean fields' code paths changed.
- **GoF pattern fit:** no new pattern introduced — parallel extension of the existing Adapter (`toPersistedViewSettings`/`fromViewSettings`) and existing Observer-style `VIEW_SETTINGS` push (`onViewSettings` in `renderer.js`, confirmed by diff at line ~384). Matches the scaffold's own claim and is not over-engineered for two sibling string fields.

## 3. Security (`.claude/knowledge/nodejs/security.md` + `.claude/knowledge/security/general.md`)

- "Input validation & injection" (general.md): external input (`settings.json`'s two new fields) is validated at the boundary (`fontNameSchema` in the zod schema) before reaching `ViewSettings`/the DOM — satisfied.
- "Fail closed on auth/authorization checks" posture generalized to this feature: an unsafe value causes the *entire* parse to fail closed (`null`) rather than silently dropping just the bad field — satisfied, and is exactly guardrail #1 above.
- No secrets, no passwords, no network/transport surface, no datastore queries introduced by this task — the rest of both security modules is correctly not applicable, confirmed by reading both files rather than waving the question away.

## 4. Test quality

Tests assert actual behavior (DOM property values, `parseSettings` return value, byte-identical file-on-disk-after-reject, no `.bak` written), not just "was called." The fault-injection run independently confirms the `isSafeFontName`/`isSafeFontText`/whole-file-collapse tests are not tautological — weakening the regex produced exactly the expected 6 failures, not zero.

## 5. Regression risk / gaps found

- **Should-fix:** there is no fast unit-level assertion that `renderer.js`'s `onViewSettings` callback actually calls `applyFonts(document.body, ...)` (mirroring `renderer-order.test.ts`'s existing regex assertions for the skin-reapply wiring, e.g. `window.mdview.onSkin((skin) => {...})`). This wiring is only exercised by the e2e spec today. A future refactor that silently dropped the `applyFonts(...)` call from `renderer.js` would not be caught by `npm run test:unit`, only by the (slower, build-dependent) e2e suite. Not blocking — e2e does cover it — but worth a one-line regex assertion added to `renderer-order.test.ts` for parity with the skin precedent.
  - **Lead disposition:** routed back to `full-stack-engineer` in the same pass (scope manifest already covers `tests/unit/renderer-order.test.ts`); not deferred.

## 6. Blocking finding — spec file destructively overwritten

`git diff main -- .agents/specs/functional_domain.md` showed:
```
@@ -1,4404 +1,84 @@
-# Functional Domain Assessment
... (all prior content, Tasks 1-54, deleted)
+## Task 55: Independent font-override settings (UI font + Code font)
... (only the new section remains)
```
Confirmed by direct line counts: `git show main:.agents/specs/functional_domain.md | wc -l` → **4404** lines; the working-tree file at review time → **84** lines (exactly the new Task 55 section, nothing else). The entire functional-domain history for Tasks 1–54 had been deleted from this file on this branch, not appended to. By contrast, `initial_scaffold.md` on the same branch correctly *appended* its Task 55 section (9337 → 9451 lines, confirmed via `wc -l` and a clean `@@ -9335,3 +9335,117 @@` append-only hunk) — so the correct pattern was available and simply wasn't followed for `functional_domain.md`.

**Root cause (Lead-side, not the implementing engineer's):** the Lead used `Write` (full-file replace) instead of appending when authoring the Task 55 section of `functional_domain.md` during Step 0 planning, before the scope manifest existed. `full-stack-engineer` never touched this file (it is not in `.agents/current_scope.json`).

**Resolution:** the Lead restored the file directly — concatenated the original 4404-line history (recovered via `git show main:...`) with the Task 55 section, verified the join point reads cleanly, and confirmed the result is now a clean append-only diff: `git diff --stat main -- .agents/specs/functional_domain.md` → `1 file changed, 86 insertions(+)`, matching `initial_scaffold.md`'s correct pattern. Re-verified `wc -l` → 4490 (4404 original + 86 appended, including blank separators).

## Verdict

**Original reviewer verdict: FAIL — 1 Blocking item** (the `functional_domain.md` destructive overwrite).

**Post-fix status: RESOLVED.** The Blocking item has been corrected by the Lead directly (see Resolution above) and independently re-verified via `git diff --stat` showing a clean, append-only change. The Should-fix item has been routed back to `full-stack-engineer` for a one-line wiring-assertion addition to `tests/unit/renderer-order.test.ts`, within its already-granted scope.

**Everything else checked — the font feature itself (validator, renderer re-check, CSS wiring, no-`:root`-default asymmetry, Skins non-interference, fault-injection-proven test strength, Clean Architecture/SOLID/GoF posture, and all three test tiers run) — passes with direct evidence as cited above.**

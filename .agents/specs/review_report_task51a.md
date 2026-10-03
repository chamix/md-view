# Review Report: Task 51a (skins core and persistence), hardened, security-relevant

Reviewer: `code-reviewer` (independent). First pass. Persisted by the Lead.

## Verdict (first pass): BLOCKED on one test-only finding (B1). Everything else sound.

## Blocking

**B1. `tests/integration/skinsStore.test.ts`, "writeSkinsFile > replaces atomically: a concurrent reader never sees an unparsable file", is flaky (~40%).**
- Evidence: 3 failures in 7 full-file runs on unmodified code; 1 failure in 4 isolated runs; it also failed in both reviewer mutation runs that touched unrelated code. Failure: `EPERM: operation not permitted, rename '...\skins.json.<pid>.<n>.tmp' -> '...\skins.json'`.
- Cause: the test polls `readFileSync` every 2ms during 15 back-to-back writes; on Windows the reader's open handle blocks the rename; `renameWithRetry` gives up after ~150ms and `writeFileAtomic` rethrows. The settings analogue (`settingsStore.test.ts:183-205`) uses a 5ms reader and a single write.
- Production code not at fault; the test makes the CI gate unreliable. Route to full-stack-engineer, test-only; then >= 10 consecutive stable runs.

## Non-blocking
- N1. `rgb(001,0,0)` / `rgba(0,0,0,000001)` pass the validator (valid CSS, harmless, consistent with "1-3 digits"); optionally pin.
- N2. Names like `​x` or `Custom <img onerror=x>` pass the name rules (within #218). Carry to 51b: names reach only Electron menu `label`s and `textContent`, never `innerHTML`.
- N3. The `__proto__` test accepts either outcome; actual behavior (key dropped, `resolveSkin` -> Default, `Object.prototype` untouched) is safe; optionally pin it.
- N4. `skins.test.ts:522` formatting slip `  });});`.
- N5. Scaffold palette table is stale for Tokyo Night dark text-muted (`#787c99`); code has the user-approved `#7d82a0` (frozen spec).

## Evidence summary
- (a) Scope: only the 5 new files + hook-touched metrics ndjson + spec work; nothing imports the new modules.
- (b) Validator attacks (all false): line terminators (` / /\r/\n`), NUL/BOM/zero-width, fullwidth/Arabic-Indic lookalikes, whitespace inside rgb, CSS metacharacters (`; } " \ /*`), malformed rgb, out-of-range alpha. Legit values true. ReDoS: 1e4-1e6 char adversarial inputs return false in 0-2ms (anchored, bounded, no nested quantifiers). `toSkinPayload` falls back to Default for `__proto__` keys, throwing getters, inherited-only keys, newline names, lowercase `default`, extra keys, missing token, poisoned color.
- (c) `.strict()` at file/skin/half levels; one bad color fails the whole file; name rules enforced in schema, `isValidCustomSkinName` and `validatedPayload`; `hasOwnProperty` lookups.
- (d) Default == app.css literal for literal incl. the three #222 quirks; drift test guarded against vacuous parse (16 tokens x 2 blocks, 32 values diffed); Claude/Obsidian/Tokyo Night match the approved table (with the amendment); 8 filenames in allowlist and present in highlight.js/styles.
- (e) Store: missing -> no write; corrupt -> byte-exact `.bak` then heal; focus re-read never writes; ensure never overwrites; `canPersistSkinChange` ENOENT/clean-parse only; failure containment. Engineer interpretations (1) skip overwrite when backup fails and (2) canPersist semantics: ACCEPTED.
- (f) Mutations (restored, `cmp`-verified): validator accepts `red...` -> RED; skip `.bak` -> RED (7 failures); canPersist true on any error -> RED.
- (g) `test:unit` 555/555; `test:integration` 116/116 (one lucky roll); `tsc --noEmit` clean; e2e not run (inert tier).
- (h) Architecture: skinsStore -> skins -> skinPresets inward; pure core imports no electron/fs; type-only skins<->skinPresets cycle acceptable.
- (i) Comments accurate.

---

## Re-review addendum (targeted): final verdict PASS. No Blocking items remain.

- Production files `skins.ts`, `skinsStore.ts`, `skinPresets.ts` unchanged since the first pass (`cmp` identical / mtime before first run).
- B1 fixed: reader polls every 5ms; writer does 3 writes with 12ms pauses and tolerates only EPERM/EBUSY/EACCES (the documented `atomicWriteFile.ts` transients; anything else is rethrown). The unchanged core assertion (no observed content unparsable) is backed by `observed.length > 0`, `succeeded > 0`, a final file that parses and no `.tmp` left. Reviewer judged tolerating the rename transient acceptable test design that hides no defect.
- Discrimination check: replacing the atomic write with truncate + 8ms delay + write made the test fail 5/5 runs; restored and `cmp`-verified.
- Stability: `skinsStore.test.ts` 29/29 passed in 15 of 15 consecutive runs (previously ~40% failure).
- Tiers: `test:unit` 556/556, `test:integration` 116/116, `tsc --noEmit` clean. e2e not run (51a is inert).
- N1, N3, N4 fixed as requested.
- Carried to 51b: custom skin names are not HTML-safe; use only as menu labels / `textContent`, never `innerHTML`.

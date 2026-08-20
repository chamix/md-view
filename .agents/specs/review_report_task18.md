# Independent Code Review — Task 18: File Tree Tree-Root Path-Casing Fix

**Reviewer:** code-reviewer (independent verification layer, read-only tools)
**Date:** 2026-08-20
**Overall verdict: PASS.** Zero Blocking findings. One Should-fix (pre-existing, already-tracked, non-blocking observation) and one Nit noted below.

All claims below were independently reproduced — not restated from the engineer's own report.

---

## Evidence trail

### 1. Diff scope (`git diff --name-only`)

```
.agents/specs/functional_domain.md
.agents/specs/initial_scaffold.md
src/main/index.ts
tests/e2e/file-tree.spec.ts
```

`.agents/current_scope.json` (untracked) `in_scope`:
```json
["src/main/index.ts", "tests/e2e/file-tree.spec.ts", ".agents/specs/review_report_task18.md",
 ".agents/specs/backlog.md", ".agents/DEVLOG.md", ".agents/metrics/RUN_LOG.md"]
```

`src/main/index.ts` and `tests/e2e/file-tree.spec.ts` — the only two files the engineer's diff touches — are both explicitly in scope. `.agents/specs/functional_domain.md` and `.agents/specs/initial_scaffold.md` are modified (pure additions, `git diff --stat`: `+62`/`+122`, `0` deletions in each), but these are the Lead's own Step 0/Step 1 spec-authoring that precedes delegation, not part of the engineer's delegated diff. `git status --porcelain .agents/specs/backlog.md .agents/DEVLOG.md .agents/metrics/RUN_LOG.md` → empty output, confirming the engineer did not touch any of them (correctly deferred to Lead close-out). **No scope violation.**

### 2. `establishTreeRoot`'s exact new shape (`git diff -- src/main/index.ts`)

```diff
-async function establishTreeRoot(rootPath: string): Promise<void> {
-  if (rootPath === currentTreeRoot) return; // no-op: no re-fetch, no event sent
-  const result = await listDirectoryEntries(rootPath);
-  currentTreeRoot = rootPath;
+async function establishTreeRoot(rawRootPath: string): Promise<void> {
+  ...
+  let resolvedRootPath: string;
+  try {
+    resolvedRootPath = await fs.realpath(rawRootPath);
+  } catch {
+    resolvedRootPath = rawRootPath;
+  }
+  if (resolvedRootPath === currentTreeRoot) return; // no-op: no re-fetch, no event sent
+  const result = await listDirectoryEntries(resolvedRootPath);
+  currentTreeRoot = resolvedRootPath;
   const message: FolderTreeRootMessage = result.ok
-    ? { ok: true, rootPath, entries: result.entries }
-    : { ok: false, rootPath, error: result.error };
+    ? { ok: true, rootPath: resolvedRootPath, entries: result.entries }
+    : { ok: false, rootPath: resolvedRootPath, error: result.error };
   mainWindow?.webContents.send(IPC_CHANNELS.FOLDER_TREE_ROOT, message);
 }
```

Confirmed against the checklist:
- Canonicalization wrapped in try/catch, falls back to raw path on failure. ✓
- No-op guard compares `resolvedRootPath === currentTreeRoot` (not raw). ✓
- `currentTreeRoot = resolvedRootPath` set unconditionally, regardless of `result.ok` (Task 17's existing behavior preserved). ✓
- Broadcast payload's `rootPath` is always `resolvedRootPath`, never `rawRootPath`. ✓

`fs` at the top of the file is imported as `import * as fs from 'node:fs/promises';`, so `fs.realpath` **is** `fs.promises.realpath` under an alias — matches `initial_scaffold.md`'s authoritative code exactly.

### 3. Realpath API choice — reproduced independently

Ran an independent probe (not the engineer's):
```
dir:   C:\Source\md-view\tests\e2e\fixtures\tree
upper: C:\SOURCE\MD-VIEW\TESTS\E2E\FIXTURES\TREE
promises.realpath result: C:\Source\md-view\tests\e2e\fixtures\tree
realpath.native result:   C:\Source\md-view\tests\e2e\fixtures\tree
```
(`node -v` → `v24.15.0`.) Both APIs independently confirmed to return the true on-disk casing on this machine/Node version. The engineer's choice of `fs.promises.realpath` is empirically justified, not assumed.

### 4. Guardrail #9 — no platform heuristic

Read the code directly: no `process.platform` branch, no `.toLowerCase()`/`.toUpperCase()` anywhere in `establishTreeRoot`. Canonicalization is purely `fs.realpath` (filesystem-native). Confirmed.

### 5. Guardrail #10 — canonicalization-failure fallback, reproduced live

Constructed and ran an independent probe test opening a nonexistent directory via the mocked folder dialog:
```
PROBE EVENTS: [{"ok":false,"rootPath":"C:\\Source\\md-view\\tests\\e2e\\fixtures\\tree\\does-not-exist-dir-xyz",
"error":"ENOENT: no such file or directory, scandir '...\\does-not-exist-dir-xyz'"}]
1 passed (1.9s)
```
No crash, no hang. `realpath` rejected (ENOENT), the catch block fell back to the raw path, `listDirectoryEntries` independently hit the same ENOENT and produced the existing `{ok:false}` path — proven at runtime, not just by reading the try/catch syntax. Probe file deleted afterward; `git status` confirmed no residue.

### 6. FI-5 fault-injection — reproduced from scratch

Backed up `src/main/index.ts`, patched `establishTreeRoot` to restore the raw comparison, rebuilt:

**RED**:
```
Expected length: 1
Received length: 2
Received array:  [{"rootPath": "C:\\Source\\md-view\\tests\\e2e\\fixtures\\tree", ...},
                   {"rootPath": "C:\\SOURCE\\MD-VIEW\\TESTS\\E2E\\FIXTURES\\TREE", ...}]
  1 failed
```
Matches the spec's predicted failure exactly. Restored (byte-identical via diff against backup), rebuilt:

**GREEN**:
```
ok 1 tests\e2e\file-tree.spec.ts:228:5 › opening the same tree root twice via differently-cased paths broadcasts FOLDER_TREE_ROOT exactly once (Task 18 guardrail #9 / FI-5 proof) (1.7s)
1 passed (2.3s)
```
`git diff --stat -- src/main/index.ts` after restoration matched pre-probing exactly — no residual change.

### 7. `test.skip` guard

```ts
test.skip(process.platform === 'linux', 'case-insensitive-filesystem-only guardrail; would test the wrong thing on ext4/most Linux filesystems');
```
Present, with an explanatory comment, matching the spec's required treatment.

### 8. Out-of-scope zero-diff claims

```
$ git diff --stat -- src/preload/api.ts src/main/fileTree.ts package.json tsconfig.json src/preload/index.ts src/renderer/renderer.js
(no output — zero diff on all)
```
`BridgeApi`, `IPC_CHANNELS`, all types, `listDirectory`/`listDirectoryEntries`'s general subfolder-listing/`filterAndSortEntries` logic — all untouched. `establishTreeRoot` call sites (`renderAndWatch`, `openFolderViaDialog`) confirmed unchanged — both still pass raw paths.

### 9. Regression check — Task 17's 6 pre-existing cases

7 total `test(` blocks in `file-tree.spec.ts` (6 original + 1 new), new test inserted as a pure addition, zero modification to any existing test body. All 6 original assertions unaffected by the new canonicalization step (their fixture paths are already canonically cased).

### 10. Full test suite — run independently, raw output

`tsc -p tsconfig.json --noEmit`: clean.

Unit: `Test Files 15 passed (15)` / `Tests 83 passed (83)`.
Integration: `Test Files 4 passed (4)` / `Tests 19 passed (19)`.
E2E, 3 runs at default 4-worker parallelism: `38/39` (1 pre-existing, already-tracked, unrelated flake on `file-tree.spec.ts:294`'s "Open Folder…" test — zero diff, isolated rerun clean), `39/39`, `39/39`.

Totals match the engineer's report: 83 unit / 19 integration / 39 e2e, first implementation cycle.

---

## Findings

### Blocking
None.

### Should-fix

**S1 — E2E suite flakiness under 4-worker parallel load remains unresolved and reproduced again during this review.** 1 of 3 full runs hit the same pre-existing `file-tree.spec.ts` "Open Folder…" timeout already logged in `backlog.md`/`review_report_task17.md`. Not caused by Task 18's diff (zero diff on that test, isolated + majority-of-runs green), but it is drift-risk: every additional e2e test file increases the chance of hitting the shared resource-contention ceiling during full-suite runs. Recommend prioritizing the already-tracked "e2e flakiness as its own effort" backlog item sooner rather than continuing to accrue fresh data points against it task after task.

### Nit

**N1 — The new test's in-app event-listener/counter pattern (`__treeRootEvents`) duplicates a pattern already used twice in this file.** Reasonable reuse of an established idiom, no action needed — noting only that it's now the same shape three times in one file and could eventually be extracted to a shared helper if a fourth case appears.

---

## Summary of verification performed

- Reproduced the `fs.promises.realpath` vs `fs.realpath.native` empirical probe independently — both correctly return true on-disk casing on this Node v24.15.0/Windows machine.
- Reproduced FI-5 fault injection from scratch: reverted the fix, confirmed RED with the exact predicted two-broadcast/two-casing signature; restored, confirmed GREEN and byte-identical restoration.
- Constructed and ran an independent probe test (not authored by the engineer) to exercise guardrail #10's fallback against a genuinely nonexistent directory; confirmed correct `{ok:false}` fallback; deleted the probe afterward, confirmed no residue.
- Ran `tsc --noEmit`, full unit (83/83), full integration (19/19), full e2e three times (39/39 twice, 38/39 once on a pre-existing, already-tracked, unrelated flake).
- Verified `git diff --name-only` against scope, and zero diff on every claimed-untouched file.

**Files relevant to this review:**
- `src/main/index.ts`
- `tests/e2e/file-tree.spec.ts`
- `.agents/specs/functional_domain.md` (Task 18 section)
- `.agents/specs/initial_scaffold.md` (Task 18 section)
- `.agents/specs/review_report_task17.md` (cross-referenced flake precedent)
- `.agents/specs/backlog.md` (cross-referenced flake precedent)
- `.agents/current_scope.json`

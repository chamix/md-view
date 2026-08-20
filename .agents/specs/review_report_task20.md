# Review Report — Task 20: Fix Race Condition in "Open Folder…" E2E Test

**Reviewer:** code-reviewer (independent verification layer)
**Verdict: PASS — no blocking issues found.**

## 1. Diff scope verification

`git diff --name-only` (working tree vs. HEAD):
```
.agents/specs/functional_domain.md
.agents/specs/initial_scaffold.md
tests/e2e/file-tree.spec.ts
```

`.agents/current_scope.json` in-scope list: `tests/e2e/file-tree.spec.ts`, `.agents/specs/backlog.md`, `.agents/DEVLOG.md`, `.agents/metrics/RUN_LOG.md`.

- `tests/e2e/file-tree.spec.ts` — in scope, and is the only implementation file touched.
- `.agents/specs/functional_domain.md` / `initial_scaffold.md` — modified, but these are the Lead's own Step 0/Step 1 planning additions (the "## Task 20" sections quoted in the task brief), not engineer output. They read as pure spec-authoring diffs (new `## Task 20` sections appended at each file's end), not implementation changes. Flagging this only as an observation for the Lead's own governance bookkeeping — it is not an engineer scope violation since the delegated implementation diff touches exactly one file, `tests/e2e/file-tree.spec.ts`.
- `git diff --stat -- src package.json tsconfig.json playwright.config.ts` → **empty**. No application code touched.

## 2. The diff itself

```
$ git diff --unified=0 -- tests/e2e/file-tree.spec.ts
@@ -270,6 +270,7 @@ test('Open Folder… broadcasts FOLDER_TREE_ROOT and triggers zero FILE_RENDERED
-  const treeRootPromise = window.evaluate(() => {
-    return new Promise((resolve) => {
-      (window as unknown as { mdview: { onFolderTreeRoot: (cb: (m: unknown) => void) => void } }).mdview.onFolderTreeRoot(
-        (message) => resolve(message)
-      );
-    });
+  await window.evaluate(() => {
+    (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents = [];
+    (window as unknown as { mdview: { onFolderTreeRoot: (cb: (m: unknown) => void) => void } }).mdview.onFolderTreeRoot(
+      (message) => {
+        (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents.push(message);
+      }
+    );
@@ -280 +281,9 @@ test('Open Folder… broadcasts FOLDER_TREE_ROOT and triggers zero FILE_RENDERED
-  const treeRootMessage = (await treeRootPromise) as { ok: boolean; rootPath: string; entries: Array<{ name: string }> };
+  await expect
+    .poll(async () =>
+      window.evaluate(() => (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents.length)
+    )
+    .toBeGreaterThanOrEqual(1);
+
+  const treeRootMessage = (await window.evaluate(
+    () => (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents[0]
+  )) as { ok: boolean; rootPath: string; entries: Array<{ name: string }> };
```

Exactly 2 hunks, both entirely within the "Open Folder…" test (`grep -n "^test("` on the file confirms 7 tests total, only line 244's test contains the diff). This is byte-identical to the spec's "Exact change" block in `initial_scaffold.md` §Task 20 Technical Specification. Guardrails #17 and #19 satisfied.

## 3. Assertion integrity (guardrail #18)

Post-block assertions (current lines 291–304 of `tests/e2e/file-tree.spec.ts`) were not part of any diff hunk and are unchanged:
```ts
expect(treeRootMessage.ok).toBe(true);
expect(treeRootMessage.rootPath).toBe(fixtureTreeDir);
expect(treeRootMessage.entries.map((e) => e.name)).toContain('notes.md');
// ...
await expect(emptyState).toBeVisible();
await expect(content).toBeEmpty();
// ...
expect(fileRenderedCount).toBe(0);
```
Confirmed byte-identical to `git show HEAD:tests/e2e/file-tree.spec.ts` output.

## 4. Fix correctness

The listener registration is now inside an `await window.evaluate(...)` — this fully round-trips over CDP and resolves before the next statement runs. The triggering `await electronApp.evaluate(({ Menu }) => ...click())` only fires after that await resolves, eliminating the race by construction. The pattern (reset an array, push into it, `expect.poll` before reading) matches this file's four other tests verbatim (e.g. the "opening a fixture file via File > Open…" test at line 49 uses the identical `__fileRenderedCount`/array-accumulation idiom). No dangling un-awaited Promise remains anywhere in this test.

## 5. RED reproduction (done myself, not trusted from the implementer)

I reverted only this test's block back to the racy `treeRootPromise` shape (verified the reverted text matched the spec's documented "current (racy) content" verbatim), rebuilt (`npm run build`), and ran:

```
MSYS_NO_PATHCONV=1 cmd.exe /d /c "cd /d C:\Source\md-view && npx playwright test tests/e2e/file-tree.spec.ts:244 --repeat-each=30 --workers=4"
```

Raw result:
```
1 failed
  tests\e2e\file-tree.spec.ts:244:5 › Open Folder… broadcasts FOLDER_TREE_ROOT and triggers zero FILE_RENDERED events as a side effect
29 passed (56.7s)
```
Failure detail:
```
Test timeout of 30000ms exceeded.
Error: page.evaluate: Target page, context or browser has been closed
> 270 |   const treeRootPromise = window.evaluate(() => {
```
This reproduces the exact described symptom (30s timeout, "Target page, context or browser has been closed", at the un-awaited `window.evaluate` call site). I got a repro on the first attempt (1/30) — same rate class the implementer reported. Restored the fix afterward via the saved backup; `git diff` hash of the restored file (`f743386`) is identical to the pre-revert delivered state, confirmed by `git diff --stat` showing the same 16 insertions/7 deletions before and after the round-trip.

**Environment note confirmed real and pre-existing:** Bash's `cmd.exe /d /c` invocation initially failed silently (banner printed, no command output) because Git Bash's MSYS path-conversion layer mangles leading `/c`/`/d` flags into Windows paths. This is a Bash-environment quirk unrelated to Task 20's diff — worked around with `MSYS_NO_PATHCONV=1` (equivalent to the implementer's workaround intent). Did not end up needing to test the `process.cwd()`/`realpath` casing mismatch directly since no test failed on `rootPath` mismatch grounds in any of my runs, but I note the drive-letter-casing environment quirk is plausible and orthogonal to this fix — none of my runs showed a `rootPath` assertion failure of that kind.

## 6. GREEN proof (done myself)

Fix restored, rebuilt, then:

```
npx playwright test tests/e2e/file-tree.spec.ts:244 --repeat-each=30 --workers=4
  → 30 passed (37.4s)

npx playwright test tests/e2e/file-tree.spec.ts:244 --repeat-each=30 --workers=2
  → 30 passed (43.9s)
```
Clean at both concurrency levels — 60/60 total.

## 7. Full regression

```
npx playwright test --reporter=line
  → 39 passed (46.8s)
```
All 39 e2e specs pass, list included every spec file (`app-launch`, `drag-drop`, `code-highlighting`, `external-links`, `file-tree`, `help-menu`, `html-comments`, `live-reload`, `open-file-argv`, `relative-images`, `ui-shell`, `view-menu`) — none regressed.

```
npx tsc --noEmit
  → exit 0, empty output
```

Also ran the unit/integration tiers (not explicitly requested but part of "full test suite"):
```
npx vitest run tests/unit          → 15 files, 83 tests passed
npx vitest run tests/integration   → 4 files, 19 tests passed
```

## 8. Test quality / regression risk

Not tautological — the test asserts real outcomes (`treeRootMessage.ok`, `.rootPath`, `.entries` containing `notes.md`, `#empty-state` visibility, `#content` emptiness, `__fileRenderedCount === 0`), not "was a function called." The fix touches only listener-registration plumbing; it introduces no new assertions and removes none, so no new logic is left uncovered. No other test file was touched, so no other regression surface was opened.

## Findings

- **Blocking:** none.
- **Should-fix:** none.
- **Nit:** none.

## Files referenced

- `c:\Source\md-view\tests\e2e\file-tree.spec.ts`
- `c:\Source\md-view\.agents\specs\functional_domain.md` (Task 20 section)
- `c:\Source\md-view\.agents\specs\initial_scaffold.md` (Task 20 section)
- `c:\Source\md-view\.agents\current_scope.json`
- `c:\Source\md-view\.agents\specs\backlog.md` (existing "Open Folder…" flakiness entries — left untouched/unmarked per instructions, resolved at Lead close-out)

`RUN_LOG.md` was not appended, `backlog.md` was not marked `[Resolved]`, and `.agents/current_scope.json` was not deleted, per instructions — these remain for the Lead's close-out.

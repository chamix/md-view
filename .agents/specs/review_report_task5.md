# Independent Review Report - Task 5: External Link Handling (bug fix)

## Verdict: PASS - 0 Blocking findings

---

## 1. Scope Adherence

git status --short at review start:

```
 M .agents/specs/functional_domain.md
 M .agents/specs/initial_scaffold.md
 M src/main/index.ts
?? .agents/current_scope.json
?? src/main/linkPolicy.ts
?? tests/e2e/external-links.spec.ts
?? tests/e2e/fixtures/with-links/
?? tests/unit/isExternalHttpUrl.test.ts
```

Compared against .agents/current_scope.json's 5 granted paths:
src/main/linkPolicy.ts, src/main/index.ts, tests/unit/isExternalHttpUrl.test.ts, tests/e2e/external-links.spec.ts, tests/e2e/fixtures/with-links/doc.md.

- src/main/linkPolicy.ts - in scope, new file. Matches.
- src/main/index.ts - in scope, modified. Matches.
- tests/unit/isExternalHttpUrl.test.ts - in scope, new file. Matches.
- tests/e2e/external-links.spec.ts - in scope, new file. Matches.
- tests/e2e/fixtures/with-links/doc.md - in scope (the with-links/ directory contains exactly doc.md). Matches.
- .agents/current_scope.json - expected untracked artifact of the Lead's own workflow step, not part of the engineer's delivered diff. Not a finding.
- .agents/specs/functional_domain.md / initial_scaffold.md - both modified, but git diff on both (see below) shows pure appends (+ lines only, zero deletions per git diff --stat) of the Task 5 spec sections - these are the Lead's own pre-existing planning edits from Step 0/1, not engineer output, and are correctly outside current_scope.json's grant (specs are read-only during execution per CLAUDE.md).

Zero-diff verification on the 8 files that should not have changed (git diff --stat, empty output = no diff):

```
src/main/markdown.ts src/main/watcher.ts src/main/windowConfig.ts src/main/paths.ts
src/preload/api.ts src/preload/index.ts src/renderer/index.html src/renderer/renderer.js
-> (empty output - zero diff on all 8)
```

Finding: Non-blocking. No scope violations. All changed/new files are accounted for.

---

## 2. Diff Review (real hunks)

git add -A -N then git diff, then git reset (verified git status --short identical before and after).

src/main/index.ts diff — em dash test: this is a load-bearing safety property.

```diff
-import { app, BrowserWindow, dialog, ipcMain } from 'electron';
+import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
 ...
+import { isExternalHttpUrl } from './linkPolicy';
 ...
   mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
+
+  mainWindow.webContents.on('will-navigate', (event, url) => {
+    event.preventDefault(); // unconditional, before any URL classification
+    if (isExternalHttpUrl(url)) {
+      shell.openExternal(url);
+    }
+  });
+
+  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
+    if (isExternalHttpUrl(url)) {
+      shell.openExternal(url);
+    }
+    return { action: 'deny' };
+  });
 }
```
This is the entire non-test diff. Minimal, additive, localized to createWindow().

---

## 3. src/main/linkPolicy.ts - Exact Conformance

```ts
export function isExternalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
```

- Uses new URL(url) - confirmed, not a string-prefix heuristic.
- Checks .protocol === 'http:' || .protocol === 'https:' - exact match to spec's authoritative signature.
- Catches parse failure, returns false - fail-safe, not fail-open.
- grep -rn for .startsWith( across src/ - no matches anywhere. No string-prefix heuristic crept in.
- Zero fs/Electron imports - file contains exactly the function above, no import statements at all.

Finding: Non-blocking. Conformant to the authoritative spec signature in initial_scaffold.md.

---

## 4. tests/unit/isExternalHttpUrl.test.ts - Case-Table Completeness

Read in full. All 6 required cases present and correctly asserted via it.each:

| Input | Expected | Present |
|---|---|---|
| 'https://example.com' | true | Yes |
| 'http://example.com' | true | Yes |
| 'javascript:alert(1)' | false | Yes |
| './relative.md' | false | Yes |
| 'file:///etc/passwd' | false | Yes |
| the literal quoted string case | false | Yes - confirmed byte-for-byte: line 20 of the test file is the literal string with two embedded double-quote characters at position 0 and the last position: the JS string value is a double-quote, then https://google.com, then a closing double-quote, all wrapped as a single-quoted JS string literal. This is not a simplified/approximated version of the real-bug reproduction - it is the exact string markdown-it would produce from [text]("url"). |

Finding: Non-blocking. Case table is complete and accurately reflects the spec's authoritative test list, including the load-bearing quoted-string real-bug reproduction.

---

## 5. src/main/index.ts Wiring Verification

Read the full file (src/main/index.ts, lines 16-39, createWindow()):

- Both will-navigate and setWindowOpenHandler are registered inside createWindow() (lines 26-38), immediately after mainWindow.loadFile(...) - not per-render, not globally outside window creation. Confirmed by reading the actual function body, not inferring from spec.
- event.preventDefault() (line 27) is the first statement in the will-navigate handler, unconditional - no if gates it. Confirmed by reading actual source order.
- setWindowOpenHandler (lines 33-38): return { action: 'deny' } (line 37) is outside and after the if (isExternalHttpUrl(url)) { shell.openExternal(url); } block - not nested inside an else or any conditional that would skip it for the external-URL case. The classification only decides whether shell.openExternal fires; the deny return is unconditional in all cases. Confirmed by reading actual brace structure, not assumed.

Finding: Non-blocking. Wiring matches the spec's authoritative code block exactly, including placement inside createWindow() (correct because Task 3's activate handler re-invokes createWindow(), so each new window naturally gets its own listener pair - verified this reasoning against the actual app.on('activate', ...) handler at line 116-120, which does call createWindow() again).

---

## 6. Fault-Injection Reproduction (independent, from scratch)

Both source files were backed up to the scratchpad directory before injection, and restored + rebuilt + re-verified green afterward.

### Guardrail A - linkPolicy.ts fail-open on catch

Injected: catch { return true; } (flipped from return false).

Ran npm run test:unit. Result - 2 failures, exactly as predicted:
```
tests/unit/isExternalHttpUrl.test.ts (6 tests | 2 failed)
  x classifies ./relative.md as false -> expected true to be false
  x classifies the quoted-string case as false -> expected true to be false
 Test Files  1 failed | 5 passed (6)
      Tests  2 failed | 21 passed (23)
```
- Failed exactly on the two cases that hit the catch branch (./relative.md, the quoted-string case) - confirmed independently, not restated from the engineer's report.
- file:///etc/passwd (a valid URL that fails the protocol check, not the catch) was unaffected, remaining green - confirming the distinction the spec draws between "fails the catch branch" vs. "fails the protocol-allowlist branch" is real and independently observable, not asserted by convention.

Reverted linkPolicy.ts from backup; git diff --stat -- src/main/linkPolicy.ts was empty (file restored byte-for-byte) before proceeding to the second injection.

### Guardrail B - will-navigate event.preventDefault() removal

Injected: commented out event.preventDefault(); in the will-navigate handler, rebuilt (npm run build), ran npx playwright test tests/e2e/external-links.spec.ts --timeout=20000.

Result - both tests timed out at the 20s ceiling, with no other assertion failure surfacing first:
```
x 1 clicking a valid external link (20.0s) - Test timeout of 20000ms exceeded.
x 2 clicking a malformed link (20.0s) - Test timeout of 20000ms exceeded.
2 failed
```

This matches the engineer's claimed result exactly (hang/timeout, not a clean assertion failure).

My own judgment on whether this is trustworthy evidence, not just restated: yes, for three independent reasons I verified myself rather than accepted on faith:
1. Causal isolation. The only change between a fully green e2e run (10/10, confirmed by me both before and after this experiment) and this 2/2 timeout is the single event.preventDefault() line. No other variable moved.
2. Mechanism is coherent, not just correlated. With preventDefault() removed, the click on https://example.com causes the BrowserWindow itself to genuinely navigate away from the file://.../index.html page (Electron's default will-navigate behavior when unblocked). After that real navigation, Playwright's #content locator (or the earlier content.innerHTML() call, or the expect.poll/subsequent locator calls) is querying DOM state on a page that no longer contains a #content element at all - the automated browser is stuck the same way a real user's window would visibly go blank, exactly the bug this task fixes. It is a coherent explanation of a hang, not an arbitrary flake.
3. 100% reproducible, not intermittent. Both tests hung identically, at the same ceiling, with no variance across the single run performed. Combined with the immediate return to 10/10 green after reverting (see below), this rules out "broken/flaky test harness" as the explanation - a broken harness would not correlate this precisely with a single one-line revert.

Caveat I am flagging as Should-fix, not Blocking: a timeout-based signal is inherently weaker/slower evidence than a fast, deterministic assertion failure - a future maintainer skimming a red CI run would see "test timeout" and could plausibly misattribute it to environment flakiness rather than this specific regression, since nothing in the failure output itself names the guardrail. This is a legitimate design tradeoff already implicitly acknowledged by the engineer's own code comments explaining noWaitAfter (see section 7), not a coverage gap - the guardrail is proven, just not with a self-describing failure message. Recorded as Should-fix (see Summary).

Reverted src/main/index.ts from backup; git diff -- src/main/index.ts after restoration was byte-for-byte identical to the diff captured in section 2 above. Rebuilt (npm run build) and reran the full suite:
```
test:unit         -> 6 files / 23 tests passed
test:integration  -> 3 files / 7 tests passed
playwright test   -> 10/10 passed (including both external-links.spec.ts cases, 2.2s / 2.8s)
```
git status --short after all fault-injection work was identical to the snapshot taken at the start of the review (only test-results/ - gitignored - touched, no tracked-file drift).

Finding: Non-blocking (both guardrails independently confirmed; one Should-fix on evidence self-descriptiveness, not on guardrail correctness).

---

## 7. tests/e2e/external-links.spec.ts - Test Logic Quality

Read the full spec file.

- shell.openExternal mock genuinely captures call arguments, not just call count. mockOpenExternal (lines 19-26) replaces shell.openExternal inside the main process via app.evaluate() with a function that pushes the actual url argument into a globalThis-scoped array; getOpenExternalCalls retrieves that array by value. Test 1 asserts calls[0].replace(/\/$/, '') equals 'https://example.com' (line 64) - the real captured argument, with an explicitly-justified normalization allowance (trailing slash), not just toHaveLength(1).
- #content is captured before AND after each click and compared for equality, not just checked for a property: contentBefore = await content.innerHTML() (line 46 / line 84) before the click, contentAfter = await content.innerHTML() after (line 66 / line 99), asserted expect(contentAfter).toBe(contentBefore) (line 67 / line 100) - full-string equality, in both tests.
- { noWaitAfter: true } is present on both .click() calls (line 55, line 89), with an inline comment explaining it was needed because a preventDefault()-cancelled navigation never resolves Playwright's default post-click navigation wait (verified as plausible given my own fault-injection experiment in section 6, which independently demonstrated what happens when that cancellation does not occur). It does not weaken what the test observes: verification of the actual outcome happens through separate, explicit waits - expect.poll(() => getOpenExternalCalls(app), { timeout: 5000 }).toHaveLength(1) (line 60) for test 1, and an explicit waitForTimeout(500) before checking calls for test 2 (line 95) - both followed by the contentBefore/contentAfter equality check. noWaitAfter only opts out of Playwright's own implicit post-click wait; it does not replace or skip the test's own assertions.

Finding: Non-blocking. Test logic is substantive, not tautological - it asserts real captured argument values and real before/after DOM-content equality, not merely "was called."

---

## 8. setWindowOpenHandler Untested-by-Design - Verification

- grep -rn "setWindowOpenHandler" tests/ -> no matches. Confirmed no test directly or synthetically invokes the handler.
- grep -rn "setWindowOpenHandler" across the whole repo finds it only in src/main/index.ts (the real wiring) and the two spec markdown files (functional_domain.md, initial_scaffold.md, documentation of the design decision) - no test file references it at all.
- The stated reasoning (html:false in markdown.ts strips target attributes, making window.open()/new-window navigation currently unreachable) still holds: git diff --stat -- src/main/markdown.ts shows zero diff for this task, and the file still contains the explicit html: false option unchanged (line 3) - Task 2's invariant is intact.

Finding: Non-blocking. The "untested by design" claim is honest and independently verifiable - no artificial test pretending to exercise an unreachable path was added.

---

## 9. Test Execution - Raw Output

Unit (npm run test:unit):
```
tests/unit/renderer-order.test.ts (2 tests) 5ms
tests/unit/preload-api.test.ts (2 tests) 5ms
tests/unit/baseUrlForFile.test.ts (3 tests) 6ms
tests/unit/isExternalHttpUrl.test.ts (6 tests) 6ms
tests/unit/watcher.test.ts (8 tests) 6ms
tests/unit/markdown.test.ts (2 tests) 14ms

 Test Files  6 passed (6)
      Tests  23 passed (23)
```
Matches expected ~6 files / 23 tests.

Integration (npm run test:integration):
```
tests/integration/window-config.test.ts (2 tests) 3ms
tests/integration/preload-api-contract.test.ts (3 tests) 4ms
tests/integration/watcher.test.ts (2 tests) 139ms

 Test Files  3 passed (3)
      Tests  7 passed (7)
```
Matches expected 3 files / 7 tests.

E2E (npm run test:e2e, then re-run after fault-injection revert via npx playwright test):
```
Running 10 tests using 4 workers
  ok  app-launch.spec.ts - app launches and opens a window
  ok  live-reload.spec.ts - live-reloads rendered content when the open file changes on disk
  ok  external-links.spec.ts - clicking a valid external link hands it off to the OS browser and does not navigate the app window
  ok  open-file-argv.spec.ts - opens a markdown file passed via argv and renders it
  ok  relative-images.spec.ts - resolves a Markdown-relative image path against the open file's directory and the image actually loads
  ok  external-links.spec.ts - clicking a malformed link opens nothing externally and does not navigate the app window
  ok  open-file-argv.spec.ts - shows a visible error state for a missing file and does not crash
  ok  live-reload.spec.ts - closes the previous file's watcher on switch, edits to the abandoned file no longer trigger a re-render
  ok  open-file-argv.spec.ts - shows a visible error state for a non-.md file selected via the dialog, and does not crash
  ok  live-reload.spec.ts - shows a visible error state when the open file is deleted, and does not crash

  10 passed (8.3s)
```
Matches expected 10 e2e tests across all specs combined.

---

## 10. Functional-Domain Guardrail Checklist (Task 5, functional_domain.md, Task 5 section)

1. "Malformed or unparseable input fails safe, not open."
   Code: src/main/linkPolicy.ts line 5-7, catch { return false; }.
   Test: tests/unit/isExternalHttpUrl.test.ts, cases './relative.md' -> false and the quoted-string case -> false (both exercise the catch branch).
   Independently fault-injected (section 6, Guardrail A) - confirmed the test would catch a regression here. Verified.

2. "The app's own window must never navigate away from rendered content... event.preventDefault() unconditional and before any classification."
   Code: src/main/index.ts line 27, first statement in the will-navigate handler, unconditional.
   Test: tests/e2e/external-links.spec.ts, both tests' contentAfter === contentBefore assertions.
   Independently fault-injected (section 6, Guardrail B) - confirmed removal causes a reproducible hang/timeout, and confirmed the code order is correct by direct read. Verified.

3. "Only http:/https: ever reaches shell.openExternal... allowlist, not blocklist."
   Code: src/main/linkPolicy.ts line 4, parsed.protocol === 'http:' || parsed.protocol === 'https:' - an explicit allowlist, not an enumerated blocklist.
   Test: tests/unit/isExternalHttpUrl.test.ts, 'javascript:alert(1)' -> false, 'file:///etc/passwd' -> false (both valid-but-non-allowlisted schemes, correctly rejected without needing to be named individually). Verified.

4. "setWindowOpenHandler is defense-in-depth for a currently-unreachable path... no test should pretend to exercise it."
   Code: src/main/index.ts lines 33-38, same classification function, same fail-safe deny.
   Verified honestly untested (section 8) - no test invokes it directly, and the html:false precondition making it unreachable today was independently re-confirmed against markdown.ts (zero diff, invariant intact). Verified.

All 4 numbered guardrails hold, each backed by an independently re-run test and, for the two load-bearing ones (#1 and #2), an independently reproduced fault injection.

---

## Summary

Verdict: PASS. Zero Blocking findings.

- Scope: clean - all 5 in-scope paths touched, zero diff on all 8 explicitly-protected files, spec-file diffs are pure Lead-authored appends outside the engineer's grant.
- linkPolicy.ts: exact conformance to the authoritative signature, no string-heuristic drift, zero extraneous imports.
- Unit test case table: complete, including the byte-for-byte real-bug quoted-string reproduction.
- index.ts wiring: correct placement, correct unconditional-first-statement ordering, correct unconditional deny return.
- Both load-bearing fault injections were independently reproduced by this review, from a clean backup, with the repo restored to its exact original state afterward (confirmed via git status --short and git diff before/after) - both matched the engineer's claimed results.
- e2e test quality: genuine argument capture and before/after content equality checks, not tautological "was called" assertions; noWaitAfter usage does not weaken observed assertions.
- setWindowOpenHandler untested-by-design claim: independently confirmed honest, no synthetic coverage pretending otherwise.
- Full three-tier suite independently run and green: 23 unit / 7 integration / 10 e2e.

Should-fix (non-blocking): The will-navigate/preventDefault() guardrail's only currently-provable failure signature at the e2e level is a full test-timeout hang rather than a fast, self-describing assertion failure. This is legitimate, reproducible evidence (independently confirmed in this review) and not a coverage gap, but a future regression here would surface in CI as an opaque timeout rather than a message naming the guardrail - worth a one-line comment in the spec or test file for future readers, not worth blocking delivery over.

Nit: None beyond the above.

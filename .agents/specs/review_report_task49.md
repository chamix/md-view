# Review Report: Task 49, Copy text (selection, Copy All, context menu; diagrams copy their source)

Reviewer: code-reviewer (independent, read-only). Branch `feature/049-copy-text`, base `main` @ `d3edd79`. **Process note:** mid-review the Lead committed the engineer's work as `26a05a1` ("feat: copy text with context menu... Independent code-review not yet performed -- interrupted by a session rate limit") while this review was in flight. This does not affect any finding below: every diff command in this report was run as `git diff main -- <path>`, which is identical whether the tree is committed or not, and the final working tree (after all my fault injections were reverted) is confirmed byte-identical to that commit (`git status --porcelain` empty, `md5sum src/renderer/copy.js` unchanged across the whole session).

## Overall verdict: **BLOCKED** (1 Blocking, 1 Should-fix, 2 Nits) — **B1 resolved, see addendum below; Should-fix/Nits remain open as non-blocking**

Production code, architecture and bridge design are sound and match the approved Step 1 blueprint (D1-D4, ADR-013) exactly. Unit (386/386), integration (87/87) and the new `copy-text.spec.ts` e2e suite (20/20) are all green, and I independently reproduced two of the spec's fault injections (F1, F7) plus one of my own. The single Blocking item is a genuinely red `npm run test:e2e` test (`mermaid.spec.ts:228`, the `#159` XSS suite) which I independently confirmed is a **false positive in the test's scanner**, not a real regression in this diff's design (D1). A red e2e test cannot ship regardless of whose fault it is, so this blocks delivery until the Lead/engineer narrows the scanner (in a file this task's own spec says is out of scope for the engineer to touch unsupervised).

---

## 0. Scope compliance

`.agents/current_scope.json` (captured before the Lead deleted it as part of Step 3's close-out; `git show 26a05a1:.agents/current_scope.json` confirms it was never committed, only ever a working-tree file, now gone) listed 13 `in_scope` paths:
```
src/renderer/diagrams.js, src/renderer/renderer.js, src/renderer/copy.js, src/renderer/index.html,
src/main/menu.ts, src/main/index.ts, src/preload/api.ts, src/preload/index.ts, src/main/help/help.md,
package.json, tests/unit/copy.test.ts, tests/integration/preload-api-contract.test.ts, tests/e2e/copy-text.spec.ts
```

`git diff --name-only main -- . ':!.agents/metrics/test-tier-invocations.ndjson'`:
```
.agents/specs/functional_domain.md
.agents/specs/initial_scaffold.md
package.json
src/main/help/help.md
src/main/index.ts
src/main/menu.ts
src/preload/api.ts
src/preload/index.ts
src/renderer/diagrams.js
src/renderer/index.html
src/renderer/renderer.js
tests/integration/preload-api-contract.test.ts
```
Plus untracked: `.agents/specs/decisions/ADR-013_md-view.md`, `src/renderer/copy.js`, `tests/e2e/copy-text.spec.ts`, `tests/unit/copy.test.ts`.

Every one of these is either in the 13-entry in_scope list or is a Lead-owned governance artifact (functional_domain.md/initial_scaffold.md amendments, ADR-013, the now-deleted current_scope.json itself). test-tier-invocations.ndjson is the auto-appended hook log, excluded per instructions. No scope violation. package.json's presence is the disclosed, legitimate mid-task scope amendment (it adds exactly one copyFileSync call to the existing build script so copy.js reaches dist/renderer/, confirmed by the diff hunk below).

tests/e2e/mermaid.spec.ts is NOT in in_scope, and initial_scaffold.md's Task 49 section explicitly lists it under "Explicitly NOT touched: ... tests/e2e/mermaid.spec.ts's existing assertions." This is load-bearing for Blocking item B1 below.

---

## 1. D1 -- src/renderer/diagrams.js: source stashed on wrapper.dataset.mdviewSource

Diff (full file diff, only hunk in the file):
```
@@ -242,6 +242,11 @@ function createDiagramDomView(containerEl, doc) {
         const code = wrapper.querySelector('code');
         // textContent decodes main's escaping exactly once (#157).
         const source = code ? code.textContent || '' : '';
+        // Task 49 D1 (#199): piggyback on this existing capture point so the
+        // exact source survives showSvg/showFailure replacing the wrapper's
+        // CHILDREN -- the wrapper's own attributes are untouched by either.
+        // No new export, no second map that could drift from this one.
+        wrapper.dataset.mdviewSource = source;
         return {
           source,
           showSvg(svg) {
```
This is a 5-line diff, added at the exact line collectSlots() already reads `source` from `code.textContent` -- exactly as the approved blueprint specified (initial_scaffold.md's "Recommendation" section). A full `git diff main -- src/renderer/diagrams.js` confirms this is the only hunk in the file -- darkModeChanged() has zero lines changed, confirming D1's "additive, not a replacement" claim.

## 2. D2 -- copy.js/renderer.js: event scoping, no preventDefault() on the no-diagram path, no execCommand/webContents.copy()

Scoping: onCopyEvent (copy.js:289) starts with `if (!isInsideDocumentArea(event.target)) return;`, and isInsideDocumentArea checks only `contentEl.contains(el) || codeContentEl.contains(el)` (copy.js:191-195). The contextmenu listeners in renderer.js are attached only to `container` (#content) and `codeContentEl` (lines 225-236), never `document` globally. Confirmed behaviorally by e2e #201: "right-click on the title bar, tree panel, or status bar never pops the document copy menu" -- passed in my own full run.

No preventDefault() on the no-diagram path. onCopyEvent (copy.js:289-297):
```
onCopyEvent(event) {
  if (!isInsideDocumentArea(event.target)) return;
  const range = documentSelectionRange();
  if (!range || !rangeContainsDiagram(range)) return;
  event.preventDefault();
  const payload = serializer.serialize(range);
  event.clipboardData.setData('text/plain', payload.text);
  event.clipboardData.setData('text/html', payload.html);
},
```
preventDefault() is reached only after rangeContainsDiagram(range) is true. I proved this causally under F1 (section 7 below): removing just that one preventDefault() line turns two real e2e tests red with the Chromium-default SVG-label text leaking through, then green again on exact byte-for-byte revert.

execCommand/webContents.copy() absent from production code: `grep -rn "execCommand|webContents\.copy\b" src/ tests/unit/copy.test.ts tests/e2e/copy-text.spec.ts tests/integration/preload-api-contract.test.ts` returns only 3 comment lines (index.ts:685, copy.js:302, renderer.js:242), all explaining what is NOT used. Zero executable occurrences anywhere in the diff.

Menu-triggered paths use navigator.clipboard.write(): copy.js:228-234, writeClipboard() builds a ClipboardItem and calls `win.navigator.clipboard.write([item])`. main's index.ts:687-703 `ipcMain.on(IPC_CHANNELS.POPUP_COPY_MENU, ...)` handler never touches text/html; onCopy/onCopyAll click handlers just `mainWindow?.webContents.send(IPC_CHANNELS.COPY_COMMAND, 'copy'|'copy-all')`.

## 3. D3 -- fresh pre/code, never the wrapper's outerHTML

copy.js's substituteDiagrams (lines 125-135):
```
const substituteDiagrams = (root) => {
  const wrappers = Array.from(root.querySelectorAll('.md-view-diagram'));
  wrappers.forEach((wrapper) => {
    const source = (wrapper.dataset && wrapper.dataset.mdviewSource) || '';
    const pre = doc.createElement('pre');
    const code = doc.createElement('code');
    code.textContent = source;
    pre.appendChild(code);
    wrapper.replaceWith(pre);
  });
};
```
This builds a brand-new pre/code pair and assigns `source` via the .textContent DOM property (never string concatenation into innerHTML), then `wrapper.replaceWith(pre)` -- the original wrapper (and its class="md-view-diagram", data-diagram, data-mdview-source attributes) is discarded, not reused. `grep -rn "mdviewSource" src/` confirms there are exactly 6 references in the whole diff, and none of them concatenate the value into an HTML string outside of preCodeHtml's explicit escapeHtml() call (full trace in section 9 below). I proved this causally under F7 (section 7 below): reusing the wrapper (only swapping its children) turns the dedicated "no internal attribute" e2e test red with data-mdview-source/data-diagram/md-view-diagram literally present in the clipboard html, then green again on exact revert.

## 4. D4 -- Copy All reuse, not reimplementation

Code tab: copy.js:52-54 codeCopyAllPayload(rawText) takes rawText verbatim; the caller (copy.js:249-250) passes `codeContentEl.textContent || ''` -- the exact same property the pre-existing copyRawSource button handler reads (renderer.js:203, `window.mdview.copyRawSource(codeContentEl.textContent || '')`, unchanged in this diff). One string, one source.

Preview: buildCopyAllRange() (copy.js:236-246) checks frontmatterEl.hidden via shouldIncludeFrontmatterInCopyAll and sets the Range's start before frontmatterEl only when shown, otherwise before contentEl. e2e #197 "Copy All in Preview includes frontmatter when shown, excludes it when hidden (F4)" passed in my own run, with an html-level assertion (not.toContain('id="frontmatter"')) that specifically distinguishes "excluded from the Range" from "merely CSS-hidden" (F4's exact target).

## 5. The bridge (#202 amended)

src/preload/api.ts diff:
```
+  POPUP_COPY_MENU: 'md-view:popup-copy-menu',
+  COPY_COMMAND: 'md-view:copy-command',
...
+  popupCopyMenu(target: { hasCopyTarget: boolean; documentOpen: boolean }, x: number, y: number): void;
+  onCopyCommand(callback: (action: 'copy' | 'copy-all') => void): void;
```
src/preload/index.ts:
```
+  popupCopyMenu: (target, x, y) => { ipcRenderer.send(IPC_CHANNELS.POPUP_COPY_MENU, target, x, y); },
+  onCopyCommand: (callback) => { ipcRenderer.on(IPC_CHANNELS.COPY_COMMAND, (_event, action) => callback(action)); },
```
Neither method's signature, nor any call site in src/main/index.ts (`ipcMain.on(IPC_CHANNELS.POPUP_COPY_MENU, (_e, target, x, y) => {...})`), contains a text/html field anywhere. Confirmed also by tests/integration/preload-api-contract.test.ts's two new tests (runtime-callability checks, honest-limitation posture matching Task 34's precedent) -- both passed.

Also unchanged, confirmed by the diff and by copyRawSource's handler (index.ts:625-629, `clipboard.writeText(text)` only, never html): contextIsolation, sandbox, nodeIntegration: false, html: false, both CSPs, and copyRawSource itself.

---

## 6. Authoritative gate: npm run test:all (one full, fresh run, after all fault injections below were reverted and a clean build)

```
 Test Files  35 passed (35)
      Tests  386 passed (386)          <- unit
 Test Files  9 passed (9)
      Tests  87 passed (87)            <- integration
Running 193 tests using 2 workers
  2 failed
    tests\e2e\close-document.spec.ts:221:1 - (d) the title-bar File popup carries menu-close at index 2 and its enabled state mirrors occupancy (#151)
    tests\e2e\mermaid.spec.ts:228:1 - #159 XSS suite: no script, no on* attribute, no javascript: URL, canary stays undefined
  191 passed (4.3m)
```

Failure 1: close-document.spec.ts:221. Error: "electronApplication.evaluate: Target page, context or browser has been closed" plus a trailing EPERM on userData-dir cleanup -- a native Electron process crash under parallel load, with no relationship to clipboard/copy code (the failing call is stubOpenDialog's dialog.showOpenDialog assignment; nothing in this diff touches `dialog`). `grep -n "close-document.spec.ts:221" .agents/specs/backlog.md` finds this exact test and exact crash signature already logged (backlog.md:822, :852-863, from the Task 46/47 reviews -- "native Electron crash reproduced at close-document.spec.ts:221 (d) ... electronApplication.evaluate: Target page, context or browser has been closed ... EPERM"). Targeted re-run to confirm it's a flake, not a new deterministic failure: `npx playwright test tests/e2e/close-document.spec.ts -g "title-bar File popup carries menu-close" --repeat-each=3 --workers=1` gave 3 passed (12.9s). Verdict: known, pre-existing, unrelated flake, confirmed via backlog match plus isolation re-run, not just restated from the implementer's report.

Failure 2: mermaid.spec.ts:228, the #159 XSS suite. See the dedicated section 9 below (Blocking item B1). Re-run in isolation twice to confirm determinism: `npx playwright test tests/e2e/mermaid.spec.ts -g "#159 XSS suite" --repeat-each=2 --workers=1` gave 2 failed / 2, deterministic, not a parallel-load artifact, matching the implementer's "reproduced 2/2 in isolation" claim, independently confirmed by me.

An earlier, mid-review full npm run test:e2e run (before the fault-injection work below, same build) also showed exactly these two tests affected, with close-document.spec.ts:221 passing that time and mermaid.spec.ts:228 failing both times -- consistent with "flaky" vs. "deterministic," respectively.

---

## 7. Fault injection -- independently reproduced

Method: copy.js is a new, untracked file (no main baseline to `git apply -R` a hunk against), so each fault was applied as a direct file swap against an md5sum-verified backup taken before any edit, then restored from that exact backup and re-verified byte-identical by md5sum before re-testing GREEN. `npm run build` ran before every RED and every GREEN observation (per the e2e caveat that a targeted Playwright run does not rebuild dist/).

### F1 (from the spec's table): remove event.preventDefault() on the diagram branch only, leave the handler registered

Patch (one line removed from copy.js's onCopyEvent): the `event.preventDefault();` call right before `const payload = serializer.serialize(range);` was deleted.

RED (`npx playwright test tests/e2e/copy-text.spec.ts -g "F1|F6|spanning a diagram|entirely a diagram"`):
```
1) ...#200... Ctrl+C over a selection spanning a diagram copies its source, not the rendered SVG (F1/F6)
   expect(text).toContain(DIAGRAM_1_SOURCE.trim())   <- failed, text instead contained the rendered SVG label text
2) ...#200... Ctrl+C over a selection that is entirely a diagram copies its source, not the rendered SVG (F1/F6)
   Expected: "graph TD\n  A[Node One] --> B[Node Two]"
   Received: "Node One\n\nNode Two"
2 failed
```
Restore: copied the pre-fault backup back over copy.js; md5sum matched the pre-fault hash exactly (2bad1a2f...). GREEN: 2 passed (6.9s).

### F7 (from the spec's table): serialize via the original wrapper's attributes (children-swap) instead of a fresh pre/code

Patch (substituteDiagrams in copy.js): replaced the fresh-pre/code construction with `wrapper.innerHTML = ''; const code = ...; wrapper.appendChild(code);` -- i.e. the wrapper element itself (with its class and data attributes) stays in the DOM instead of being replaced.

RED (`-g "F7|internal markers"`):
```
1) ...the copied html never leaks md-view-diagram internal markers (F7)
   expect(html).not.toContain('data-mdview-source')
   Received string contained: <div class="md-view-diagram" data-diagram="mermaid" data-mdview-source="graph TD
  A[Node One] --> B[Node Two]
"><code>graph TD...</code></div>
1 failed
```
Restore: md5sum matched the pre-fault hash exactly. GREEN: 1 passed (5.4s).

### NEW (mine, not in F1-F7): remove the "confining wrapper" edge-case entirely -- a selection whose Range is entirely inside a single diagram wrapper (not spanning it)

The engineer's createRangeCopySerializer has code beyond the approved blueprint's literal wording: a closestDiagramWrapperFor(range.commonAncestorContainer) check that special-cases a Range confined entirely within a diagram wrapper's children (e.g. a drag-selection made directly inside the rendered SVG). Rationale given in the code's own comment: Range.cloneContents() in that case clones only the wrapper's children, never the wrapper element itself, so the normal querySelectorAll('.md-view-diagram') substitution pass would find nothing to replace and would silently leak the rendered SVG. This logic is not named in the spec's F1-F7 table, so I targeted it directly: removed the whole `if (confiningWrapper) { return diagramCopyPayload(...); }` branch from serialize(range), so every selection always falls through to the generic clone/substitute path.

RED (`npx playwright test tests/e2e/copy-text.spec.ts -g "entirely a diagram"`):
```
1) ...Ctrl+C over a selection that is entirely a diagram copies its source, not the rendered SVG (F1/F6)
   Expected: "graph TD\n  A[Node One] --> B[Node Two]"
   Received: "Node One\n\nNode Two"
1 failed
```
(Confirmed structurally too: `npx vitest run tests/unit/copy.test.ts` under this fault still shows 22 passed -- this edge case has no unit coverage at all, only e2e, because it requires a real laid-out DOM/Range; consistent with the file's "honest limitation" posture for DOM adapters.)

Restore: md5sum matched the pre-fault hash exactly. GREEN: 1 passed (5.7s).

Conclusion of this section: the e2e suite genuinely discriminates on all three faults I personally injected, confirming the causal claims in the spec/ADR, plus one real edge case the engineer added beyond the letter of the approved D3 text -- correctly, and it is tested.

---

## 8. Test quality

tests/unit/copy.test.ts (22 tests): behavioral, not tautological. escapeHtml/preCodeHtml/diagramCopyPayload/codeCopyAllPayload/classifyCopyTarget/targetHasCopyTarget/shouldIncludeFrontmatterInCopyAll/createCopyTargetMemory are all pure functions asserted against concrete input/output pairs (e.g. escapeHtml of a script tag maps to the exact escaped string), not toHaveBeenCalled()-style call-counting. createRangeCopySerializer/createCopyController (the DOM-touching adapters) are correctly left to e2e only, mirroring diagrams.test.ts's own documented honest-limitation posture for createDiagramDomView.

tests/e2e/copy-text.spec.ts (20 tests, all independently re-run and passing in my own session): every clipboard assertion reads the real OS clipboard via `electronApp.evaluate(({ clipboard }) => ...)`, never an in-memory stand-in -- matches #196's explicit requirement and Task 34's precedent. Tests check real DOM properties (window.getSelection().toString(), svg element presence) rather than internal implementation details.

Gap (Should-fix S1 below): buildCopyMenuTemplate (pure, one-line-per-branch enabled logic) has zero unit test coverage -- `grep -rn "buildCopyMenuTemplate" tests/` returns nothing. The existing buildMenuTemplate has an extensive tests/unit/menu.test.ts (18 test blocks). The new function's enabled-state logic (`target.documentOpen && target.hasCopyTarget` for Copy; `target.documentOpen` alone for Copy All) is exercised only through e2e (#201's F5-adjacent cases, all of which passed in my run), which is slower and less precise than a direct unit test would be for a pure function.

---

## 9. The flagged XSS false-positive -- independently verified (highest priority)

My independent verdict: this is a genuine false positive in mermaid.spec.ts's scanner, not a real XSS regression introduced by D1. Evidence:

### 9a. Where the "javascript:" substring actually comes from

tests/e2e/fixtures/with-mermaid/xss.md (read directly) contains literal attack-payload text like `<a href='javascript:window.__mdvCanary=1'>` and `click A "javascript:window.__mdvCanary='click href'"` inside the fence body itself (the Mermaid source text, not rendered markup). D1 stores that fence body verbatim on wrapper.dataset.mdviewSource (diagrams.js:249). The scanner (mermaid.spec.ts:252-271) walks every element under #content and flags any attribute whose VALUE contains "javascript:", with no check on the attribute NAME. The raw full-suite failure output confirms the only three hits are DIV.data-mdview-source (once per diagram in the fixture -- 3 diagrams, 3 hits), and nothing else.

### 9b. Independent, standalone confirmation beyond re-reading the existing test

Since mermaid.spec.ts is out of scope for me to edit even temporarily (and the harness's own classifier correctly blocked an attempt to patch it in-place, even for a revert-after-verification purpose -- I did not pursue a workaround, per instructions), I wrote and ran a brand-new, throwaway Playwright-Electron probe script in my own scratchpad (never touching any tracked file), replicating the existing test's setup against the real built app and the real xss.md fixture, but narrowing the jsUrls check and adding extra checks the existing test's early return prevents from being observed:
```
FINDINGS {
  "scripts": 0,
  "onAttrs": [],
  "jsUrls": [ "DIV.data-mdview-source", "DIV.data-mdview-source", "DIV.data-mdview-source" ],
  "jsUrlsNonData": []
}
CANARY_AFTER_CLICKS undefined
REAL_SCRIPT_TAG_COUNT 4 SCRIPT_UNDER_CONTENT false
```
This independently confirms, beyond what the existing (early-exiting) test can show in one run:
- jsUrlsNonData is empty -- excluding only data-* attribute names from the exact same scan makes the "javascript:" finding vanish entirely. This is the concrete evidence for "no real URL/script-bearing attribute is affected."
- scripts: 0, onAttrs: [] under #content -- no real script element and no on* handler attribute exists anywhere in the rendered diagram DOM (these are the two checks that already passed before the existing test's early-exit, consistent with the full-suite run only failing at the third expect).
- REAL_SCRIPT_TAG_COUNT 4, SCRIPT_UNDER_CONTENT false -- the 4 script tags that do exist in the document are the app's own script src tags (diagrams.js/copy.js/renderer.js/mermaid bundle) in body, none of them descendants of #content.
- CANARY_AFTER_CLICKS: undefined -- after dispatching real click events on every node/anchor/actor in the rendered diagrams (the exact check the existing test's early-exit prevents from running in a failing session), the injected canary is still never set.

### 9c. Does any production code ever write dataset.mdviewSource's content into innerHTML/outerHTML unescaped?

`grep -rn "mdviewSource" src/` returns 6 references total. Traced every one:
- diagrams.js:249, the write itself: `wrapper.dataset.mdviewSource = source;` (a DOM property assignment onto an attribute, never a markup string).
- copy.js:128, read into `source`, then `code.textContent = source;` (DOM property assignment; browser auto-escapes on serialization back through innerHTML).
- copy.js:162 and copy.js:279, both flow into `diagramCopyPayload(source)` -> `preCodeHtml(text)` -> `escapeHtml(text)` (explicit regex-based escaping of &, <, >, ", ') before any string concatenation into an html payload.

There is no code path in this diff that concatenates dataset.mdviewSource's raw value into an HTML string without going through either a DOM-property assignment (auto-escaped on read-back) or the explicit escapeHtml() function. This was also directly, causally proven by my own F7 fault injection (section 7): the only way to make that attribute leak into copied html is to actively remove the fresh-element substitution and reuse the wrapper -- which is exactly the fault the spec's F7 and this scanner both exist to catch, and which the shipped code does not do.

### 9d. Is mermaid.spec.ts genuinely out of scope?

Yes. initial_scaffold.md's Task 49 section, "Explicitly NOT touched" list, states: "tests/e2e/mermaid.spec.ts's existing assertions." .agents/current_scope.json's 13-entry in_scope list (captured in section 0 above) does not include it. Leaving it unfixed was the correct call for the engineer -- editing an out-of-scope test file without a Lead-approved scope amendment would itself be a scope violation, exactly like package.json required one and got it.

### Verdict on this item

B1 (Blocking). The regression is in the test's scanner design (too broad -- it should check only interpreted-URL-bearing attributes such as href/src/xlink:href/action/formaction/srcset, excluding data-*), not in D1's implementation. However: a red npm run test:e2e cannot ship regardless of which side of the fence the defect sits on, and the fix requires editing a file this engineer was correctly barred from touching. This blocks delivery until the Lead either (a) grants a narrowly-scoped amendment to current_scope.json adding tests/e2e/mermaid.spec.ts with instructions to narrow only the jsUrls attribute-name check, or (b) fixes the one line in mermaid.spec.ts directly as the Lead's own governance-file-adjacent action (it is a test file, not a protected .agents/specs/** or CLAUDE.md/.claude/** path, so the Lead is not blocked from it by the governance-integrity hook).

---

## 10. Architecture

- Inward dependency rule: holds. copy.js is pure browser-side script with no Node/Electron import; createCopyController takes doc/win/element refs/documentOpen as injected ports (same DIP posture as diagrams.js's createDiagramController), not reaching into globals directly except inside the adapter layer.
- SRP: the file's own documented layering (policy, use case, adapter) is real, not aspirational -- I traced every function and found no DOM access outside createRangeCopySerializer/createCopyController.
- ISP/DIP: createCopyController's port surface (doc, win, contentEl, codeContentEl, frontmatterEl, documentOpen) is narrow and matches exactly what it uses.
- GoF: createCopyTargetMemory is a small Memento (snapshots the last contextmenu classification for later, asynchronous consumption by the IPC-driven menu click). createRangeCopySerializer is an Adapter (Range -> {text, html}). buildCopyMenuTemplate mirrors buildMenuTemplate's existing "one template function, many entry points" pattern (#67), as a sibling function rather than an edit -- confirmed by the blast-radius grep already run and recorded in initial_scaffold.md (zero hits for the new token names against the whole tests/src tree before this task started).
- canCopyRawSource reuse: `documentOpen: () => canCopyRawSource(lastMessage)` (renderer.js:115) reuses Task 34's existing predicate rather than adding a second "is a file open" check that could drift -- confirmed by grep showing it used identically at 4 call sites, old and new.

---

## 11. Findings summary

### Blocking

B1. tests/e2e/mermaid.spec.ts:228 (#159 XSS suite) is red in a full npm run test:e2e run, deterministically (2/2 in isolation, independently confirmed by me). Root cause independently confirmed (section 9): the scanner's blanket "any attribute value containing javascript:" check flags the inert data-mdview-source attribute D1 adds, which is never interpreted as a URL/script by any browser mechanism and is never written into innerHTML/outerHTML unescaped anywhere in this diff (traced all 6 references). This is a false positive in the test, not a design flaw in D1 -- but it is still a red e2e test in the tree, and the fix requires a file (tests/e2e/mermaid.spec.ts) outside this task's approved scope. Route to the Lead, not to full-stack-engineer: either amend scope to add this one file with a narrow instruction (exclude data-* attribute names, or restrict to href/src/xlink:href/action/formaction/srcset), or have the Lead make the one-line fix directly (it is not a protected governance path).

### Should-fix

S1. buildCopyMenuTemplate (pure function, src/main/menu.ts) has zero unit test coverage. buildMenuTemplate has an extensive tests/unit/menu.test.ts; this sibling function's enabled-state logic is exercised only through (slower, less precise) e2e. Not required by the approved test plan (which assigned this logic's fault, F5, to e2e only), so non-blocking, but a reasonable follow-up given the precedent the codebase already sets for this exact kind of function.

### Nits

1. The "confining wrapper" edge case in createRangeCopySerializer (a selection entirely inside a diagram, e.g. a manual drag-select inside the rendered SVG) is real, correct, and tested only via e2e (confirmed by my own new fault injection in section 7) -- it has no unit coverage, which is an acceptable but documented gap given the DOM/Range dependency (consistent with the file's own stated honest-limitation posture).
2. help.md's new "Copying text" section has no dedicated test asserting its content (consistent with Task 44/45/46 precedent -- Help text is not guardrail-tested elsewhere in this codebase either, so this is not a new gap this task introduces).

---

## Evidence trail / commands run (for reproduction)

- git diff --stat main -- (in_scope files) and git diff --name-only main -- . (section 0)
- git diff main -- src/renderer/diagrams.js, renderer.js, index.html, src/main/menu.ts, index.ts, src/preload/api.ts, index.ts, src/main/help/help.md, package.json, tests/integration/preload-api-contract.test.ts (sections 1-5)
- grep -rn "execCommand|webContents\.copy\b" across src/ and the three new test files (section 2)
- grep -rn "mdviewSource" src/ (sections 3, 9c)
- npm run test:unit -> 386 passed (386)
- npm run test:integration -> 87 passed (87)
- npm run build && npx playwright test tests/e2e/copy-text.spec.ts -> 20 passed (43.8s)
- npm run test:all (final, authoritative, after all reverts) -> unit 386/386, integration 87/87, e2e 191 passed, 2 failed (close-document.spec.ts:221, mermaid.spec.ts:228)
- npx playwright test tests/e2e/close-document.spec.ts -g "title-bar File popup carries menu-close" --repeat-each=3 --workers=1 -> 3 passed (flake confirmed non-reproducing in isolation)
- npx playwright test tests/e2e/mermaid.spec.ts -g "#159 XSS suite" --repeat-each=2 --workers=1 -> 2 failed (deterministic, confirmed)
- grep -n "close-document.spec.ts:221" .agents/specs/backlog.md -> matches backlog.md lines 822, 852-863
- F1/F7/new-fault: file-swap against md5sum-verified backups, npm run build before every RED/GREEN, md5sum confirming byte-identical restore each time (section 7)
- Standalone throwaway Node/Playwright probe (xss_probe.js, scratchpad only, never committed, deleted after use) for section 9b

Relevant files (all absolute paths):
- c:\Source\md-view\src\renderer\diagrams.js (D1, line ~249)
- c:\Source\md-view\src\renderer\copy.js (whole file, new)
- c:\Source\md-view\src\renderer\renderer.js (wiring, lines ~97-243)
- c:\Source\md-view\src\main\menu.ts (buildCopyMenuTemplate, line 117)
- c:\Source\md-view\src\main\index.ts (POPUP_COPY_MENU handler, lines ~679-703)
- c:\Source\md-view\src\preload\api.ts, c:\Source\md-view\src\preload\index.ts
- c:\Source\md-view\tests\unit\copy.test.ts
- c:\Source\md-view\tests\e2e\copy-text.spec.ts
- c:\Source\md-view\tests\e2e\mermaid.spec.ts (B1, scanner at lines ~252-271, test at line 228)
- c:\Source\md-view\tests\e2e\fixtures\with-mermaid\xss.md (lines ~9-31)
- c:\Source\md-view\.agents\specs\decisions\ADR-013_md-view.md
- c:\Source\md-view\.agents\specs\backlog.md (lines 822, 852-863, close-document flake precedent)

---

## Addendum: B1 resolved (Lead-delegated fix, confirmed)

Delegated to `full-stack-engineer` as a narrow, test-only scope amendment (`.agents/current_scope.json`
gained exactly one entry, `tests/e2e/mermaid.spec.ts`, restricted to the `jsUrls` scanner). Fix: the
scanner now checks only `href`, `src`, `xlink:href`, `action`, `formaction`, `srcset` attribute names,
explicitly excluding the whole `data-*` namespace (not a one-off carve-out for `data-mdview-source`).
Factored into a shared `scanForUrlBearingJsAttrs(window)` helper so both the original `#159` assertion
and a new fault-injection sibling test exercise the identical narrowed logic.

Proof (independently spot-checked by the Lead via `git status`/`git diff --stat HEAD`, not just restated):
- **RED before fix**: `mermaid.spec.ts:228` failed with exactly the 3 `DIV.data-mdview-source` hits this
  report's section 9 predicted.
- **GREEN after fix**: both `#159 XSS suite` and the new fault-injection test pass.
- **Fault injection, genuinely discriminating** (not a blind "revert everything" check, which the
  engineer correctly found does *not* red the new test — a too-broad scanner still happens to catch
  `href`): dropping `href` from the allowlist reds the new fault-injection test specifically (`Expected:
  ["A.href=javascript:window.__mdvCanary=1"], Received: []`), while the original `#159` test stays green
  (its fixture has no plain `href` to miss) — this is exactly the blind spot the new test exists to cover.
  Reverted via byte-identical restore (`md5sum` match), confirmed GREEN again.
- **Full gate**: `npm run test:all` on a clean rebuild — unit 386/386, integration 87/87, e2e
  **194 passed, 0 failed** (`close-document.spec.ts:221`'s known flake, logged in `backlog.md:822,852-863`,
  did not reproduce this run).
- **Scope**: `git diff --stat HEAD -- . ':!.agents/metrics/test-tier-invocations.ndjson'` — exactly one
  file, `tests/e2e/mermaid.spec.ts` (58 lines changed). No `src/` file touched. (Note: diffing against
  `main` instead of `HEAD` would misleadingly include all of Task 49's already-committed work, since
  `main` does not yet contain the `26a05a1` commit this branch carries — the engineer caught this and
  used `HEAD` correctly; flagging it here so the distinction isn't lost.)

**Updated verdict: no Blocking items remain.** S1 (missing unit coverage for `buildCopyMenuTemplate`)
and the 2 Nits from the original report stand as non-blocking, optional follow-ups.

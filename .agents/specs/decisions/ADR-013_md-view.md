# ADR-013: Copy uses the renderer's native `copy` event for keyboard/selection copy, and the async Clipboard API for menu-triggered Copy/Copy All — no clipboard content crosses into `main`

## Status
Proposed (2026-09-28, Task 49 Step 1 review).

## Context
Task 49 (`functional_domain.md` #196-#203) adds Copy (current selection, both
`text` and `html`), Copy All (the whole visible view, no live selection
required) and a document-area right-click context menu, with the rule that a
Mermaid diagram anywhere in the copied content contributes its source, never
its rendered SVG.

The existing clipboard precedent, `copyRawSource` (#101, ADR from Task 34),
writes through `ipcMain.handle` in `main` because the sandboxed preload's
polyfilled `require()` does not expose Electron's `clipboard` module to
renderer-reachable code — there is no other way for a plain button click to
reach the OS clipboard. Step 0's #202 assumed the same constraint applies
here and specified a bridge method carrying `{ text, html }`.

Whether that constraint actually applies to Copy/Copy All needed checking,
not assuming (this task's own #200 principle, applied to the boundary
design too). Four throwaway Playwright e2e probes ran against the built app
(`npm run build`; probe files deleted immediately after each run, never
committed), each reading the real OS clipboard via
`electronApp.evaluate(({ clipboard }) => …)`:

1. `Ctrl+C` over a non-editable selection in `#content`, with no accelerator,
   no Edit-role menu item and no app code involved at all: **already writes
   both `text/plain` and `text/html` to the real OS clipboard today.** This
   is Chromium's own default handling of the `copy` edit command, and it
   does not go through `Menu.setApplicationMenu()`'s accelerator table (File/
   View/Help only) or through `ipcMain`.
2. A `document.addEventListener('copy', e => { e.preventDefault();
   e.clipboardData.setData(...) })` installed in the renderer intercepts
   that default and its payload wins — confirmed for `Ctrl+C` itself, for
   `BrowserWindow.webContents.copy()` called from `main` (the primitive
   behind `role: 'copy'`), and for `document.execCommand('copy')` called
   from renderer JS with no real keyboard event. All three trigger the same
   interceptable `copy` `ClipboardEvent`, and none of them touch `main`'s
   `clipboard` module or cross the preload bridge.
3. `navigator.clipboard.write()` (the async Web Clipboard API, distinct from
   both `execCommand` and Electron's `clipboard` module) also works from
   this renderer with **no permission prompt, no live selection required,
   and no change to `window.getSelection()`** — this app sets no
   `session.setPermissionRequestHandler`, so nothing restricts it. It wrote
   a `ClipboardItem` carrying both `text/plain` and `text/html` in one call,
   read back correctly via the real OS clipboard.

Point 3 surfaced during Step 1 review (2026-09-28) as the answer to two open
questions: Copy All has no live user selection to reuse, and `execCommand`
is a deprecated API whose removal a pinned Electron/Chromium version could
still ship (a risk this ADR must carry, not paper over).

## Decision
1. **Physical `Ctrl+C` / any real `copy` gesture inside `#content` or
   `#code-content`:** one `document.addEventListener('copy', handler)`,
   scoped to firing only when `event.target` is inside one of those two
   elements — everywhere else (title bar, tree panel, status bar) keeps the
   unmodified browser default, per #201's "only over the document area".
   - No diagram in the current selection: `handler` returns without calling
     `preventDefault()`. Chromium's already-proven-correct default writes
     both formats. This is the common case and costs zero new code at
     runtime.
   - A diagram is in the current selection (fully or partially covered, or
     the selection is entirely a diagram): `handler` calls
     `preventDefault()`, builds `{ text, html }` itself (clone the Range,
     replace each `.md-view-diagram` node with a plain `<pre><code>` element
     holding its stored, escaped source — never the wrapper's own attributes;
     see Consequences), and calls `event.clipboardData.setData(...)` for
     both MIME types.
2. **Menu-triggered Copy and Copy All (built in `main`, popped from a
   right-click):** `main` never calls `webContents.copy()` and never
   receives `text`/`html`. Clicking either item sends a small,
   content-free, fire-and-forget IPC to the renderer naming only *which*
   action was chosen (`'copy'` or `'copy-all'`). The renderer already knows
   the copy target — either the live selection (mirrored from the
   `contextmenu` event that opened the menu) or, for Copy All, the whole
   visible pane (Preview: `#frontmatter` when shown, then `#content`; Code:
   `codeContentEl.textContent`, byte-identical to `copyRawSource`) — builds
   `{ text, html }` with the same diagram-substitution function as (1), and
   writes it with `navigator.clipboard.write([new ClipboardItem({
   'text/plain': …, 'text/html': … })])`. No selection is moved, no
   `execCommand` runs, and no diagram-only right-click needs to fabricate a
   selection over the wrapper first.
3. **Right-click on a diagram with no pre-existing text selection:** the
   `contextmenu` handler classifies the target (inside a
   `.md-view-diagram` wrapper → that wrapper's stored source is the copy
   target) and remembers it for the menu-click IPC in (2) to consume. It
   does not call `window.getSelection().selectAllChildren(...)` — that was
   the Step 1 draft's original approach and is no longer needed now that (2)
   does not depend on a live selection at all.
4. **Result for #202:** the bridge grows by exactly one renderer→main
   method (`popupCopyMenu(target, x, y)`, a target-classification
   descriptor, no clipboard content — unchanged from the Step 1 draft) and
   one main→renderer push (the action name only, `'copy' | 'copy-all'`).
   Neither carries `text` or `html`. `main`'s only clipboard-writing code
   remains `copyRawSource` (#101), untouched.

## Alternatives considered
- **`document.execCommand('copy')` to synthesize the copy pipeline for
  Copy All and for a diagram-only right-click (rejected).** Proven to work
  today (probe 2), but `execCommand` is a deprecated MDN/WHATWG-marked API;
  a future Electron/Chromium upgrade removing it is a real, if currently
  unrealized, risk. It also requires first mutating `window.getSelection()`
  to have anything for it to act on, which is an avoidable, user-visible
  side effect (a highlight flash over content the user did not select) that
  `navigator.clipboard.write()` does not need. Kept as a documented fallback
  only: if a future Electron pin restricts `navigator.clipboard.write()`
  (see Consequences), `execCommand` plus a real (if programmatic) selection
  is the next thing to try before reaching for Option B below.
- **`webContents.copy()` from `main` for every menu-triggered action
  (rejected as the primary path, kept for (1) only).** Works (probe 2), and
  is still the right primitive for making a menu-triggered Copy behave
  identically to `Ctrl+C` when a real selection already exists. But it is a
  command over the *currently selected* content, so it cannot serve Copy All
  or a no-selection diagram right-click without the same selection-mutation
  problem as `execCommand`. Not used for (2)/(3) once
  `navigator.clipboard.write()` proved to need neither a selection nor a
  native command dispatch at all.
- **Option B: renderer always serializes and sends `{ text, html }` to
  `main` over a new `invoke` channel, `main` validates and calls
  `clipboard.write()` (rejected, kept as the literal-#202 fallback).**
  Satisfies #202's original wording without amendment, and would still work.
  Rejected as the primary design because the constraint that motivated
  #101/#202 in the first place — the sandboxed preload cannot `require()`
  Electron's `clipboard` module — does not apply to either the `copy`
  `ClipboardEvent`'s `clipboardData` or to `navigator.clipboard`, both
  standard Web Platform APIs available in the renderer regardless of
  `contextIsolation`/`sandbox`. Routing through `main` anyway would add an
  IPC hop, a size cap, and validation code for content `main` never needed
  to see, with no corresponding security or correctness gain. This
  alternative is preserved here, not deleted, precisely so it's ready to
  fall back to if the risk below materializes.

## Consequences
- No clipboard content (`text` or `html`) ever crosses the preload bridge.
  `main`'s only clipboard-writing code path remains `copyRawSource` (#101),
  completely unchanged by this task.
- The bridge grows by one narrow renderer→main descriptor and one narrow
  main→renderer action name — both already anticipated in shape by #202's
  "narrow menu-request descriptor" clause, so #202 needed a wording
  amendment (done, this review) rather than a rewrite.
- **New invariant:** the substituted `<pre><code>` for a diagram is built
  fresh (a new element with only the escaped source as its text content) —
  never the original `.md-view-diagram` wrapper's `outerHTML` with its
  children swapped. This is load-bearing: the wrapper carries
  `data-mdview-source` (Step 1 D1) so that its exact source is available
  after rendering; if a future edit ever serializes the wrapper itself
  instead of a clean replacement, that internal attribute — and any other
  implementation detail on the wrapper — would leak into the copied `html`.
  A fault injection pins this: remove the `copy` event handler entirely, and
  the "`Ctrl+C` over a diagram" e2e test must go red because the clipboard
  then contains the diagram's rendered SVG label text instead of its source.
- **Risk, carried forward rather than resolved:** this design's Copy-All/
  menu-Copy path depends on `navigator.clipboard.write()` staying available
  and unrestricted (no permission prompt) in whatever Electron version this
  app is pinned to. Nothing in this app's `webPreferences` or session setup
  restricts it today (verified: no `setPermissionRequestHandler` exists
  anywhere in `src/main`), but Electron/Chromium upgrades (ADR-... Electron
  checkpoint tasks) are exactly the kind of event that could change this.
  Every e2e test in this task's plan reads the *real* OS clipboard, never an
  in-memory stand-in, so a regression here fails loudly (a red e2e suite),
  not silently. If it ever does regress, the fallback is `execCommand` (with
  a real, if programmatic, selection) or Option B above — not a redesign
  from scratch.
- Physical `Ctrl+C` behavior for the no-diagram case is unchanged from what
  Chromium already does today, before this task existed — this task adds no
  new code to that path at all, only a scoped interception for the
  diagram-containing case.

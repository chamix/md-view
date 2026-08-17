# Functional Domain Assessment

## Task
Electron + TypeScript scaffold for **md-view** (Markdown previewer desktop app) — structural skeleton only. Zero business logic, zero markdown parsing, zero functional UI. This is infrastructure, not domain.

## Abstract Schema Contracts

- **Main ↔ Renderer boundary contract.** A single abstract surface (the "bridge API") crosses from the main/preload side into the renderer's global scope. At this phase its shape is trivial — a version marker, nothing operational — but it must be defined as an explicit, enumerable, versioned contract now, because every future capability (open file, receive parsed markdown, report render errors) will extend this *same* contract rather than inventing a new crossing mechanism later.
- **No document/content schema exists yet.** There is no markdown source model, no parsed-AST model, no persisted-file model. Defining one now would be speculative — it belongs to the step that actually parses markdown.
- **Build/runtime configuration (package.json, tsconfig, electron-builder) is peripheral, not domain.** It's addressed in the Technical Specification (Step 1), not here.

## Pure Transformation Logic

None. This phase transforms nothing. The only thing that happens at runtime is process bootstrapping (main creates a window, preload registers a bridge) — that's an infrastructural side effect, not a domain transformation, and does not belong in this document.

Explicitly out of scope for this task: markdown → HTML transformation, file-read → document transformation. Both deferred to a future step per the task's own boundary.

## Edge-Case Invariant Guardrails

Constraints that must hold regardless of how the implementation evolves later:

1. **The renderer must never receive direct Node.js API access.** `contextIsolation: true` and `nodeIntegration: false` are security invariants, not implementation details — they must hold in every future refactor, not just today's scaffold.
2. **The preload↔renderer contract must be an explicit, enumerable surface** (via `contextBridge.exposeInMainWorld`), never a passthrough of arbitrary IPC channels or raw Node primitives.
3. **No markdown-parsing dependency, file-system business logic, or persisted document state may be introduced in this phase** — any such addition is out of scope by definition, even if added "just to make a test less trivial."
4. **The test harness must stay honest.** Unit/integration tests in this phase assert structural existence (module exports, security-relevant config values) — never behavior that doesn't exist yet. A green suite must not create the illusion of tested business logic.

---

## Task 2: Open & Render Markdown (Product Step 1)

First real feature. Guardrail #3 above ("no markdown-parsing dependency... in this phase") was explicitly phase-scoped to the Step 0 scaffold — it does not carry forward as a blanket ban; this task's entire purpose is to introduce exactly that dependency, deliberately and narrowly.

### Abstract Schema Contracts

- **The file-render result is a discriminated union, not two independent optional fields.** A render attempt either succeeds (`{ ok: true, filePath, html }`) or fails (`{ ok: false, filePath, error }`) — never both, never neither. Modeling it as a union (not `{ html?: string; error?: string }`) makes the impossible state (both present, both absent) unrepresentable at the type level, which is a domain guarantee, not a style preference.
- **The IPC boundary is named, not stringly-typed.** Channel names (`open-file-dialog`, `file-rendered`) are a single shared source of truth, not independently-hardcoded string literals on the main and renderer sides — this is a direct extension of the "explicit, enumerable, versioned contract" principle from Task 1's Abstract Schema Contracts entry.
- **There is exactly one path that produces a render result**, regardless of trigger (argv at startup, or dialog selection at any later point). Argv-triggered and dialog-triggered opens are two *triggers* for one *domain operation* (`renderFile: path -> RenderResult`), not two parallel implementations that could drift.

### Pure Transformation Logic

- **`markdownToHtml: string -> string`** is the one pure transformation this task introduces: Markdown source text in, HTML markup out. No file I/O, no Electron dependency, no side effects — a real domain function, finally, after Task 1 had none.
- Reading the file from disk and dispatching the result over IPC are *not* part of this transformation — they're orchestration wrapping it (I/O at the edges, purity at the core).

### Edge-Case Invariant Guardrails

1. **Raw HTML embedded in Markdown source must never reach the renderer's `innerHTML` unescaped.** This is a security invariant, not a formatting choice: the renderer trusts the HTML it receives enough to inject it directly into the DOM, so the *only* thing making that safe is the converter refusing raw HTML passthrough. `html:false` must be passed explicitly at the `markdown-it` call site (not relied on as an implicit default that a future refactor could silently flip) and must be covered by a test that proves it, not just configures it.
2. **A file that doesn't exist, isn't readable, or isn't a `.md` file must never crash the process or leave the renderer silently blank.** It must produce an `{ ok: false, error }` result that reaches the renderer and displays as a visible error state.
3. **Argv-triggered and dialog-triggered opens must both funnel through the same `renderFile` → `FILE_RENDERED` path.** No separate ad hoc rendering logic for "the startup case" vs. "the dialog case" — that would be exactly the kind of drift the discriminated-union and single-path guarantees above exist to prevent.
4. **No live-reload or file-watching.** Explicitly deferred to a future step; this task renders once per open action and stops.
5. **The Task 1 invariants still hold unchanged**: `contextIsolation: true` / `nodeIntegration: false` are untouched by this task, and the bridge contract remains an explicit, enumerable surface (extended, not replaced by a raw-channel passthrough).

---

## Task 3: Live-Reload (Product Step 2)

### Abstract Schema Contracts

- **A raw filesystem-watcher event is not a domain concept — a `WatchAction` is.** Chokidar emits its own vocabulary (`add`, `addDir`, `change`, `unlink`, `unlinkDir`, `ready`, `raw`, `error`), most of which are irrelevant to a single-file watch. The domain only cares about three outcomes: `'render'` (content changed, re-render), `'error'` (the file is gone, show the error state), `'ignore'` (everything else — noise). This mapping is the abstraction; chokidar's specific event names are an implementation detail behind it.
- **No new message shape.** Task 2's `FileRenderedMessage` (`FileRenderedOk` | `FileRenderedError`) already fully covers both outcomes a watch can produce. Live-reload does not introduce a new IPC message type — it's a new *trigger* for the exact same result type, same as dialog was a second trigger alongside argv in Task 2.

### Pure Transformation Logic

- **`classifyWatchEvent: string -> WatchAction`** is this task's one pure transformation — a raw chokidar event name in, a domain action out. No fs, no chokidar import, no Electron dependency.

### Edge-Case Invariant Guardrails

1. **Opening a watch must not re-render content that was already rendered by the open action that triggered it.** `ignoreInitial: true` is mandatory, not incidental — without it, chokidar's initial `add` event would produce a redundant second render immediately after the real one.
2. **Exactly one watcher may be active at a time.** Opening a different file (via dialog, since argv only fires once at startup) must close the previous watcher *before* the new one starts — not after, not never. This must be verifiable by a test, not asserted by code review alone.
3. **A deleted file must reuse Task 2's existing error path, not a new one.** `renderFile()` already produces the correct `FileRenderedError` for any unreadable file, regardless of *why* it's unreadable — a watch-triggered 'unlink' is just another call to the same function, not a hand-built error message that could drift from the original.
4. **No manual debounce.** Chokidar's default `atomic: true` already collapses editor atomic-save sequences (temp-write + rename, or write + delete-original) into a single `change` event. Adding a debounce on top would be redundant complexity solving an already-solved problem, and risks *introducing* a staleness bug (a debounce window is a window where the renderer shows stale content on purpose).
5. **Every watcher must eventually close.** On app quit, and on every file-switch (guardrail #2) — no leaked filesystem watch handles across the process's lifetime.

---

## Task 4: Base-URL Fix for Relative Image Paths (bug fix)

Real bug found in manual testing: a Markdown source referencing an image by relative path (`./img/foo.png`) breaks, because the browser resolves that path against `dist/renderer/index.html`'s own location, not against the folder the open `.md` file actually lives in. Chosen fix: a dynamic `<base href>`, computed in main from the open file's directory, delivered over the existing `FILE_RENDERED` channel — no new channel, no new message type.

### Abstract Schema Contracts

- **`baseUrl` is a new field on the existing `ok:true` variant of `FileRenderedMessage`, not a new message shape.** This preserves Task 2/3's "one contract, one channel" principle — a base URL is just more information about a successful render, not a different kind of event.
- **The asymmetry is deliberate.** `FileRenderedError` gains nothing — there's no HTML to resolve relative resources against when there's no content to show. Don't "balance" the two variants for its own sake later; the shapes should track what's actually needed, not mirror each other cosmetically.

### Pure Transformation Logic

- **`baseUrlForFile: string -> string`** — a filesystem path in, a `file://` base URL (for that path's containing directory) out. Zero I/O, zero fs access — `dirname` and `pathToFileURL` are both pure string/path transformations, they don't touch disk. This is the third pure function in the codebase, alongside `markdownToHtml` and `classifyWatchEvent`.
- **`markdown.ts` stays completely unaware of this.** It converts Markdown source to HTML with zero knowledge of paths, URLs, or where the source came from — the base-href mechanism is layered on entirely in the renderer/DOM layer, external to the conversion itself. If `markdown.ts` ever needs a path-shaped argument to satisfy this fix, that would be the fix leaking into the wrong module.

### Edge-Case Invariant Guardrails

1. **The trailing path separator before URL conversion is not optional.** Its absence silently drops a directory level from *every* relative resource in the document (images, and anything else a future Markdown feature might reference relatively) — a correctness bug that produces a plausible-looking but wrong URL, not an obviously-broken one. A test must assert the literal trailing `/` in the output, not just that the result "looks like a file URL."
2. **`markdown.ts`'s purity is untouched by this task, verified, not just declared** — zero diff expected on that file.
3. **The order of `base.href` assignment before `innerHTML` assignment in the renderer is a functional requirement, not a style choice**, and must be proven by an e2e test that confirms an image *actually loaded* (`complete && naturalWidth > 0`), not merely that the `<img>` tag exists in the DOM with some `src` value — a wrong-order regression would still produce syntactically correct markup and pass any test that only checks structure, while the image itself silently fails to load. Checking real load success is the only honest test of this guardrail.

---

## Task 5: External Link Handling (bug fix)

Real bug found in manual testing: clicking a link in the rendered Markdown makes Electron try to navigate the app's *own window* to that URL, instead of opening it in the system's default browser — the app goes blank and the in-window navigation fails. Fix: intercept navigation attempts in main before they ever reach the renderer, and hand off qualifying URLs to the OS via `shell.openExternal`.

### Abstract Schema Contracts

- **No new IPC message, no renderer involvement at all.** This is a pre-renderer interception at the `webContents` level in main — the app's own window must never be a valid navigation target for content-originated links, so there's nothing for the renderer to know about or opt into.
- **The domain concept here is a classification, not a transformation**: `isExternalHttpUrl: string -> boolean` — "is this URL safe and appropriate to hand off to the OS browser," an explicit allowlist decision (http/https only), not a denylist of known-bad schemes (`javascript:`, `file:`, etc.). Allowlisting means an unanticipated future scheme defaults to *not* handed off, which is the safe default — a denylist would default the opposite way.

### Pure Transformation Logic

- **`isExternalHttpUrl: string -> boolean`** — the fourth pure function in the codebase (alongside `markdownToHtml`, `classifyWatchEvent`, `baseUrlForFile`). Uses the `URL` constructor to parse, never string-prefix heuristics (`.startsWith('http')` would admit a crafted string that merely starts with the right substring without being a well-formed URL of that scheme at all).

### Edge-Case Invariant Guardrails

1. **Malformed or unparseable input fails safe, not open.** `new URL()` throwing must be caught and produce `false` — never let a parse failure default to "allow." This is the same fail-safe-not-fail-open posture as `protect-governance.mjs`'s own "unparseable input → block" rule elsewhere in this repo's governance layer — a parse failure is not a green light.
2. **The app's own window must never navigate away from rendered content, regardless of what a link resolves to.** `event.preventDefault()` on `will-navigate` must be unconditional and happen *before* any URL classification — a bug in `isExternalHttpUrl` must never be able to result in an in-app navigation, only (at worst) in a legitimate external URL failing to open. Block first, decide whether to hand off second.
3. **Only `http:`/`https:` ever reaches `shell.openExternal`.** No scheme-specific special-casing beyond that allowlist — `javascript:`, `file:`, and anything else are all uniformly refused, not enumerated as a blocklist that could miss a future dangerous scheme.
4. **`setWindowOpenHandler` is defense-in-depth for a currently-unreachable path.** `html:false` (Task 2's guardrail) already strips any raw HTML attribute including `target`, so no rendered link can currently trigger a `target="_blank"`/`window.open()` navigation for this handler to intercept. It must still be wired correctly (same classification, same fail-safe deny default), but no test should pretend to exercise a path that isn't currently reachable — state that honestly, the same harness-honesty standard established since Step 0.

---

## Task 6: Syntax Highlighting for Code Blocks

Feature request: fenced code blocks in rendered Markdown should get syntax highlighting when the fence declares a language, using `highlight.js`.

### Abstract Schema Contracts

- **A fenced code block carries two independent pieces of information: an optional declared-language token, and raw code content.** The output is a two-outcome model, not three: either the content renders as *highlighted markup* (language declared and recognized) or as *plain escaped text* (language absent, OR declared but unrecognized). "No language" and "unrecognized language" are the same output case at the schema level — both collapse to plain text — even though they're distinguishable at the input level. There is no third "error" output; an unrecognized language is not a failure state, it's a defined fallback.
- **Highlighted markup and plain-escaped markup are both still just "the HTML for one code block"** — from the surrounding document's perspective (Task 2's `markdownToHtml: string -> string` contract) nothing changes. This task extends what happens *inside* a `<pre><code>` region; it does not introduce a new top-level output shape.

### Pure Transformation Logic

- **`code content + declared language -> HTML fragment`** is the one new transformation this task introduces, nested inside the existing `markdownToHtml` transformation. Given a language, if that language is recognized, the code's tokens map to marked-up spans; if not (or if no language was given at all), the code maps to itself, escaped, unchanged in meaning.
- This transformation is a *refinement* of Task 2's existing invariant ("raw code text must never reach the DOM unescaped"), not a replacement of it — escaping still must hold in 100% of outcomes, highlighted or not.

### Edge-Case Invariant Guardrails

1. **No declared language → plain escaped text, always.** Auto-detection (guessing a language from content heuristics) must never run. Heuristic detection is non-deterministic across highlight.js versions/inputs and would silently break render reproducibility — a document rendered the same way twice (or on two machines) must always produce byte-identical output for an unlabeled fence.
2. **A declared language that highlight.js does not recognize must degrade to plain escaped text — never throw, never abort the render of the rest of the document.** One bad fence must not take down the whole file's rendering, the same "don't crash the process" spirit as Task 2's guardrail for unreadable files, now scoped to a single fence within an otherwise-valid document.
3. **Code fence content is always literal, escaped text — even when it looks like markup, even after passing through the new highlighting library.** This is Task 2's `html:false` invariant, re-verified at a new seam: previously the only thing standing between raw fence content and the DOM was markdown-it's own escaping; now a second library sits in that same path and must not reintroduce an escaping gap. A fence containing something like a `<script>` tag *as code text* must still reach the DOM as inert escaped text, regardless of whether that fence's language was recognized or not. This needs its own explicit test — "safe before, safe after" must be demonstrated, not assumed, same standard as the original `html:false` test.
4. **Highlighting is a presentation-layer concern only.** It must not change what the document *means* — the same source Markdown must produce the same semantic content (same code text, same list items, same paragraphs) whether or not any given fence's language happens to be recognized. Nothing about this task's success or failure should be visible anywhere except inside `<pre><code>` regions.

---

## Task 7: UI Shell Polish — Native Menu, Empty State, Content Margin, Status Bar

Cosmetic/UX pass on the app shell. The rendering pipeline, security invariants, and
live-reload behavior established in Tasks 2–6 are unchanged; this task is about how
the *shell around* rendered content looks and how a user triggers the one action
(open a file) that already exists.

### Abstract Schema Contracts

- **The "open a file" action is not gaining a new trigger mechanism at the domain
  level — it's losing a redundant one.** Today there are two routes into the same
  `renderAndWatch` orchestration: an argv path (startup) and a dialog path (button
  click → IPC → main). This task replaces the dialog path's *entry point* (a
  renderer-side button that round-trips through IPC to ask main to open a dialog)
  with a main-process-native one (an OS menu item whose click handler runs directly
  in main, no IPC needed to *initiate* it). The domain action itself — "ask the OS
  for a file, then render+watch it" — is unchanged; only which process originates
  the request changes, and it collapses from two hops (renderer click → IPC send →
  main dialog) to one (menu click → main dialog).
- **A file-open request originating from a native menu is not a new schema.** It
  carries no payload of its own (no channel, no message shape) — it is a zero-argument
  trigger, same as the button's `openFileDialog()` was a zero-argument trigger. The
  *result* of that trigger is still exactly `FileRenderedMessage`, unchanged.
- **The shell now surfaces two new read-only projections of state that already
  exists, not new state.** A status line and an empty-state message are both pure
  presentations of "is a file currently open, and if so what path" — a fact already
  fully carried by whether a `FILE_RENDERED` message has arrived and which variant/
  `filePath` it carried. No new fact is being tracked; two new views onto the same
  fact are being added.
  - Status line: always visible, shows the current file's path, or an explicit
    "nothing is open" state.
  - Empty-state message: visible only in the *original* pre-first-render condition,
    and permanently gone the instant the first `FILE_RENDERED` message of the
    session arrives, ok or error. It does not reappear if a later open fails — an
    error state is not "no file", it's "a file was attempted and didn't work",
    which is a distinct condition from "nothing has been attempted yet."
- **The Exit menu item is a new domain action**: "terminate the application," with
  no state to preserve and no confirmation step — a direct request to quit, same
  as an OS window-close button would trigger.

### Pure Transformation Logic

- **Menu structure as data.** "Given a callback for what 'Open' should do, produce
  the abstract structure of a two-item File menu (Open, Exit) with a separator
  between them" is a pure transformation — input is a handler reference, output is
  a description of menu structure. It does not need to talk to the OS to be
  computed or tested; actually installing that structure as a real, visible native
  menu is a separate, impure step layered on top.
- **Status text derivation.** "Given the current file-rendered state (nothing yet,
  a successful render, or a failed render), what single line of text describes the
  open file" is a pure function of that state: no file yet or no path available →
  a fixed "nothing open" phrase; any state carrying a real path → that path,
  verbatim, with no transformation, truncation, or interpretation applied to it.

### Edge-Case Invariant Guardrails

1. **Removing the old dialog-trigger IPC surface must be a complete removal, not a
   deprecation.** The old renderer-button-to-IPC-to-dialog trigger is fully retired,
   not left dormant alongside the new one — two parallel ways to start the same
   action would be duplicated logic with no domain justification, and the whole
   point of this change is that the trigger now lives natively in main and needs no
   IPC hop to originate.
2. **The rendering/watching orchestration itself must not fork.** Whether the
   trigger was argv (Task 2) or is now menu-native, exactly one shared code path
   performs "ask for/receive a path, then render + watch it." A menu-specific
   reimplementation of that orchestration would violate the same "one path, not
   two" principle Task 2 established for argv vs. dialog and Task 3 preserved for
   watch-triggered re-renders.
3. **A developer affordance (inspecting the running app) is not a product feature
   and must never be reachable in a shipped build.** Whatever safety net replaces
   the previously-implicit access to developer tooling must be conditioned on the
   build being a development build, not on an environment variable a packaged
   build might accidentally still carry, and must never surface as a discoverable
   menu entry a real user could click.
4. **The status line's displayed path is exactly the path already known to be
   true — it is never reconstructed, guessed, or partially shown.** No new
   trust boundary is introduced: the value was already being carried safely
   over the existing render-result channel, so displaying it introduces no
   new escaping or interpretation surface beyond "put this exact known-safe
   string where a user can see it."
5. **The empty-state message is a one-way transition.** Once a real attempt to
   open a file has resolved (successfully or not), "nothing has been tried yet"
   is no longer true and must never be shown again for the rest of that window's
   lifetime — not even if a later open fails, because failure is a different,
   already-handled condition (existing error display), not a reversion to the
   initial condition.
6. **Visual/layout changes (content margin) carry no functional coupling** — they
   must not alter what content is rendered or how, only how it is spaced on
   screen. Same separation as Task 6's guardrail that highlighting is
   presentation-only and must not change document meaning.

---

## Task 8: Dark Mode, Frontmatter Visibility, Bottom Margin

Real bug found via manual testing (same discovery style as Tasks 4/5): on an OS set
to dark mode, `github-markdown-css`'s default build only auto-styles
`.markdown-body` via `prefers-color-scheme`, leaving the surrounding app chrome
(the window background, Task 7's status bar, Task 7's empty-state) light — a
half-dark/half-light window. Feature request bundled alongside the fix: a View menu
exposing an explicit, app-driven Dark Mode toggle (never OS-driven) and a
Show/Hide Frontmatter toggle for YAML frontmatter blocks, which currently render as
an unreadable run-on paragraph inside `.markdown-body` because `markdownToHtml`
has no concept of frontmatter at all — it's just more Markdown text to it today.

### Abstract Schema Contracts

- **A rendered file carries two independent facts today (its content, and whether
  it has a base URL); this task adds a third, `frontmatter`, that is more
  information about the same successful render, not a new outcome.** Exactly the
  precedent Task 4 set with `baseUrl`: an additional field on the existing
  successful-render shape. A failed render still has nothing to extract
  frontmatter from — the asymmetry between the two variants is deliberate and
  stays deliberate, not "balanced" for symmetry's own sake.
- **Frontmatter is domain-meaningful text that is not part of the document's
  rendered body.** A Markdown source file conceptually has two regions: an
  optional leading metadata block (author, tags, whatever the file's own
  convention holds) and the actual content meant to become the rendered document.
  These are different domain objects with different destinations — frontmatter is
  displayed as literal, unprocessed text; the body is what already flows through
  the existing Markdown-to-HTML transformation. Conflating them (letting
  frontmatter flow into `markdownToHtml` too) would be a domain-boundary error,
  not just a display quirk.
- **View preferences are a fact about the session, not about any particular
  file.** Whether dark mode is on, and whether frontmatter should be shown, are
  true independent of which file (if any) is currently open — a user can toggle
  Dark Mode before ever opening a file, and it must still be honored the moment a
  file is opened. This is categorically different from `FileRenderedMessage`,
  which only exists in response to a specific file being opened or re-rendered.
  Two different facts, two different lifetimes — they must not be collapsed into
  one schema just because they're both "state the renderer needs to know."
- **Dark Mode is a boolean domain fact, not a description of which stylesheets
  are loaded.** "The user wants a dark appearance" is the thing that's true or
  false; "four `<link>` elements toggle their `disabled` attribute together" is
  one possible mechanism for making that true fact visible, not the fact itself.
  A future redesign of *how* theming is implemented must not require redefining
  what `darkMode: boolean` means.
- **The two View-menu toggles are two independent facts bundled into one session
  state, not two unrelated settings that happen to share a menu.** Both are
  "how should the currently-open (or not-yet-open) content be displayed," both
  are decided by the same menu, both are consumed by the same "how do I paint the
  screen" logic in the renderer — that shared nature is why they belong in one
  schema together, the same reasoning that already justified keeping `baseUrl`
  and the render outcome in one message instead of two.

### Pure Transformation Logic

- **Frontmatter extraction: raw file source in, an optional metadata block and
  the remaining document body out.** This is a splitting operation, not a
  parsing one — the task does not require understanding the *contents* of the
  frontmatter block (no YAML parsing into structured fields), only recognizing
  its boundary and separating it from the rest of the text. Whatever a file's
  frontmatter block actually says is opaque to the domain here; only "does one
  exist, and where does it end" matters.
- **Deciding whether to display frontmatter: a display preference plus a fact
  about the current render, combined into one boolean.** Showing frontmatter
  requires two independent conditions to both hold — the user wants to see it,
  AND the currently open file actually has some to show. Neither condition alone
  is sufficient; a file with frontmatter but the toggle off shows nothing, and
  the toggle on with a file that has no frontmatter also shows nothing (there's
  nothing there to show) — these are two different reasons for the same
  "don't show it" outcome, not the same reason twice.
- **Menu structure remains a pure description, now parameterized by initial view
  state.** The View menu's checkbox items must reflect whatever the session's
  actual current preferences are at the moment the menu is built — describing
  that structure is still a pure function of (handlers, current preferences) in,
  menu structure out, extending Task 7's `buildMenuTemplate` precedent rather
  than introducing a new kind of menu-description concept.

### Edge-Case Invariant Guardrails

1. **Frontmatter detection is a convention-based heuristic with a known,
   accepted ambiguity — not a specification to perfect.** Any document that
   happens to open with two `---`-delimited lines will be treated as having
   frontmatter, whether or not that was the author's intent (e.g. a horizontal
   rule immediately followed by more horizontal-rule-shaped Markdown). This is
   the same convention every major static-site generator using this pattern
   accepts, and this task inherits that same tradeoff deliberately rather than
   attempting content-aware disambiguation that those tools themselves don't
   attempt either.
2. **An unterminated leading `---` must never be misread as frontmatter.** A
   document starting with a horizontal rule that is never closed by a second
   `---` fence is not frontmatter — it's just a document that starts with a
   horizontal rule. The absence of a closing fence must fail closed (treat the
   whole document as body, nothing extracted), not fail open (guess where it
   "should" end).
3. **Frontmatter's raw text must never be interpreted as Markdown or as live
   markup.** It is metadata the user wrote in their own file, displayed exactly
   as written — not converted, not escaped-then-reinterpreted, and never routed
   through anything that could turn it into executable/renderable markup. Same
   trust tier as Task 7's `filePath`: real data originating from something the
   user already controls, displayed literally.
4. **View preferences must never trigger new file I/O or a new render.** Toggling
   Dark Mode or Show Frontmatter is purely "redraw what's already known using a
   different preference" — it must not re-read the open file from disk, must not
   restart or otherwise touch the live-reload watcher, and must have zero
   interaction with the render pipeline beyond what's already been delivered.
   Conflating a display-preference change with a content-refresh would blur two
   categorically different actions this task's own schema contracts (above)
   already establish as distinct.
5. **Dark Mode must be visually whole or not at all — never a partial mix of
   dark and light regions simultaneously.** This is the literal bug this task
   exists to fix, restated as an invariant: whatever "dark mode is on" ends up
   controlling, it must cover every visually distinct region of the window
   together (document content, and the app chrome around it), not just the
   region the original, unfixed default happened to cover.
6. **Session-scoped, not persisted.** View preferences are true only for the
   life of the running window — closing and relaunching the app is a fresh
   session with no memory of the last session's choices. This is a deliberate
   scope boundary (no config file, no stored user profile) for this task, not
   an oversight to fix later without being asked.
7. **Frontmatter visibility defaults to shown; Dark Mode defaults to off.** A
   file with real frontmatter is visible without any menu interaction — the
   toggle exists to hide it, not to opt into seeing it. Dark Mode defaults off
   regardless of the OS's own theme, because the whole point of this task is
   that the app's appearance is now app-controlled, not OS-inferred — inheriting
   the OS default here would silently reintroduce the exact "reacts to the OS"
   coupling this task removes.

## Task 9: Dark-Mode Theme Stylesheet Resolution Fix (bug fix)

Real bug found via live DOM/console inspection: the four theme `<link>` `href`s in `index.html` are relative. The two `disabled`-by-default dark links are never fetched at parse time (Chromium defers fetching disabled stylesheets) — Task 4's dynamic `<base href>` retargets to the *open file's* directory as soon as a file is opened, so by the time Dark Mode is toggled, the deferred dark stylesheets resolve against the wrong directory and fail to load (`net::ERR_FILE_NOT_FOUND`), leaving `.markdown-body` with no color/background rule from either theme and falling back to browser-default black text. The light stylesheets never show this because they're `enabled` from parse time, fetched before `<base href>` is ever redirected.

### Abstract Schema Contracts

- **Two distinct location contexts exist and must never be conflated.** (1) The app's own bundled static-asset location (`dist/renderer/`) — fixed for the process lifetime, home to the four theme stylesheets. (2) The currently-open document's directory — changes per file, exists solely to resolve *content-relative* resources (Task 4's images) inside rendered Markdown. Both are expressed through the same DOM mechanism (`<base href>` resolution for relative URLs), but they are not the same thing, and a resource belonging to context (1) must never be left to resolve against context (2).
- **No new message shape.** This is not a data-contract change — no IPC message, no new field. The bug is purely in how a static, load-time resource reference is expressed in markup/script, independent of any message ever received.

### Pure Transformation Logic

- **Theme stylesheet location must be resolved once, at a fixed point that precedes any possibility of context (2) ever being established**, and that resolution must be immune to *when* the browser actually chooses to fetch the resource (deferred for `disabled` links vs. immediate for enabled ones). An absolute URL, computed before any file can be opened, satisfies this: fetch timing becomes irrelevant because the reference never depends on whatever `<base href>` happens to hold at fetch time.
- This is not a markdown-content transformation and does not touch `markdown.ts`, `paths.ts`, or the `FILE_RENDERED`/`VIEW_SETTINGS` contracts — it is a renderer-bootstrap-time concern only.

### Edge-Case Invariant Guardrails

1. **Correctness must not depend on execution order between renderer setup and IPC message arrival.** The rejected alternative (drop `disabled` from all four links, then call `applyDarkMode(false)` as the first line of setup) is correct *today* only because no IPC message can be processed before that synchronous block finishes — an invariant a future async refactor could silently break. The chosen fix must hold regardless of when `onFileRendered`/`onViewSettings` first fire relative to theme-link setup.
2. **The four theme stylesheets must resolve to the app's own renderer directory regardless of which file is open, how many files have been opened in the session, or which directory that file lives in** — this is the literal bug restated as an invariant, and must be proven for the toggle-after-a-file-is-open flow specifically, since that is exactly the sequence in which the original bug was invisible until now.
3. **Zero regression to Task 4's content-relative image resolution.** `<base href>` must continue to retarget to the open file's directory for content-relative resources — this task fixes theme-resource resolution without touching that mechanism or its guardrails.
4. **A regression here must be provably catchable, not just plausibly fixed.** The existing e2e test (Task 8, case (c)) asserts only `.disabled` flags and `document.body`'s background — both are satisfiable even when the dark stylesheets 404, since `applyDarkMode` flips those independent of whether the CSS actually loaded. The test must be strengthened to assert `#content`'s actual computed color, each link's resolved (not authored) `href` stays anchored under the app's own directory, and that zero console/page errors fire during the toggle — otherwise this exact bug class can regress silently again.

---

## Task 10: HTML Comments Rendering as Visible Text (bug fix)

Real bug, root cause already diagnosed via direct inspection of `markdown-it`'s
token stream: with `html: false` (the explicit, intentional security invariant
established in Task 1 — never allow raw HTML passthrough from source), `markdown-it`
never emits `html_block`/`html_inline` tokens at all. Any raw-HTML-shaped span of
text, including `<!-- annotation comments -->`, is instead tokenized as an
ordinary `text` token and rendered through the default text rule, which escapes
it for literal, visible display. That escaping is exactly the desired, tested
behavior for real raw HTML (the fixture's §12 security section, and Task 1's own
security regression tests) — but an author's HTML comment carries no intent to
be seen, and today it is caught by the same net regardless.

### Abstract Schema Contracts

- No new message shape, no IPC change. This is a transformation concern wholly
  internal to `markdownToHtml`'s existing single input (raw markdown source) →
  single output (HTML string) contract — same shape as Task 6's fence-highlighting
  addition, which also added no new schema.
- The distinction that matters is not "is this HTML-shaped" (a comment and a
  `<script>`/`<div>` tag are both HTML-shaped) but "is this annotation metadata
  never meant to render" vs. "is this literal markup the Task 1 security
  invariant demands stay visible as inert, escaped text." A comment is always
  the former; every other piece of raw-HTML-shaped text is always the latter —
  these two categories must never be conflated by the fix.

### Pure Transformation Logic

- Strip `<!-- ... -->` comment spans out of plain-text content before that
  content proceeds through the existing plain-text-escaping path — and only
  from content that would otherwise travel that path. Content already inside a
  fenced code block follows a completely different, already-correct rendering
  path (the fence renderer, keyed off declared language + `highlight.js`,
  added in Task 6) and must not be touched by this transformation.

### Edge-Case Invariant Guardrails

1. A standalone HTML comment, alone in its own paragraph, must produce no
   output at all in the rendered HTML — not an empty escaped span, not a blank
   paragraph carrying some other visible artifact, simply absent.
2. Stripping a comment must never affect sibling paragraphs' content, order,
   or spacing — surrounding real content renders exactly as if the comment
   line were never in the source.
3. **The `html: false` security invariant from Task 1 is untouched by this
   fix.** Raw HTML tags that are not comments must continue to render as
   literal, escaped, visible text outside of fences. This is documented,
   tested, intentional behavior (fixture §12) — not a bug, and not something
   this task may regress even incidentally.
4. Content inside a fenced code block is a categorically different rendering
   path and is entirely out of scope for this fix — an HTML comment written
   inside a ```html fence is source code being displayed verbatim, not an
   authoring annotation, and must remain visible, unchanged, exactly as today.
5. **Known, accepted limitation — explicitly not fixed by this task.** A
   comment whose `<!--`/`-->` delimiters are split across a Markdown soft line
   break lands in separate `text` tokens by the time `markdown-it` hands them
   to the renderer; a per-token stripping approach cannot see across that
   token boundary and will not catch a comment split this way. This is a
   deliberate scope boundary, to be recorded in the backlog at Step 3, not an
   oversight to silently work around.

---

## Task 11: Document Card Chrome (rounded border, Preview/Code header)

Purely presentational feature: wrap the existing frontmatter+content region in
a bordered "card" (GitHub file-view style), with a header bar carrying two
tab-shaped buttons ("Preview" / "Code"). No new interaction — the buttons are
visual only, not wired to anything, in this task.

### Abstract Schema Contracts

- No new message shape, no new data. This task adds zero new inputs and zero
  new outputs to any existing contract (`FILE_RENDERED`, `VIEW_SETTINGS`,
  frontmatter extraction, dark-mode toggling) — it is a DOM/CSS-only
  restructuring layered around content those contracts already produce.
- **Presentation and content-production are different domains, and this task
  stays entirely in the former.** What gets shown inside `#content`/
  `#frontmatter` (Task 4, 7, 8, 10's territory) is untouched; only the DOM
  wrapper *around* those two already-existing, already-populated elements
  changes, plus a purely decorative header sitting above them.

### Pure Transformation Logic

- None. There is no data transformation in this task at all — it is static
  markup (`index.html`) plus static styling (`app.css`). This is the same
  tier as Task 7's `#status-bar`/`#empty-state` polish: presentation-only,
  not a business-logic concern.

### Edge-Case Invariant Guardrails

1. **Every existing element id that `renderer.js`/`src/main/index.ts`
   already depend on must resolve to the same kind of node, unchanged** —
   `#content`, `#frontmatter`, `#content-base`, `#status-bar`,
   `#empty-state`, and the four `#theme-*` `<link>`s. This task changes what
   *wraps* `#frontmatter`/`#content`, never the elements themselves — the
   main process and renderer script must need zero changes, because neither
   is in this task's scope and both are load-bearing for prior tasks' fixes
   (Task 4's `<base href>` targeting, Task 9's absolute theme-href
   resolution, Task 8's dark-mode class toggling).
2. **Task 8's lateral padding on `#content` (`padding-inline: 2rem`) and
   Task 8's frontmatter margin (`margin: 0 2rem`) must survive exactly as
   they are today** — the new card border/margin is an *additional*, outer
   layer, not a replacement for either. `tests/e2e/ui-shell.spec.ts`'s
   existing computed-padding assertion on `#content` is the literal, already
   -written proof of this guardrail and must keep passing unmodified.
3. **The two header buttons carry zero behavior in this task.** `type=
   "button"` (never `submit`, so no accidental form semantics), no click
   handlers, no ARIA state wiring beyond what's needed for the default-active
   visual — this task is chrome only. Wiring an actual Preview/Code toggle is
   explicitly a future task's concern, not this one's, and must not be
   half-implemented here.
4. **Dark Mode must cover the new chrome too, not just the pre-existing
   regions.** Task 8's invariant ("Dark Mode must be visually whole... never
   a partial mix") extends to this task's new elements: `#document-container`
   and `#document-header` must have `body.dark-mode`-scoped variants
   following the exact token pattern already used for `#frontmatter`/
   `#status-bar`, not a new, parallel dark-mode mechanism.
5. **The empty-state path is unaffected.** `#empty-state` stays a sibling
   *outside* the new `#document-container`, exactly where it is today —
   this task's new chrome only wraps the frontmatter/content pair, and must
   not visually appear (card border, header, tabs) when no file is open.

---

## Task 12: Layout Breathing Room, Centered Max-Width Reading Column, Window Minimum Size

Purely presentational + config feature: adds top/bottom breathing room around
the document card, centers it with a max-width beyond which side margins
grow, and gives the BrowserWindow a usable floor size. No new interaction,
no new data.

### Abstract Schema Contracts

- No new message shape, no new data — DOM/CSS restructuring plus one
  additive change to `defaultWindowOptions`'s shape (two new optional keys).
  Same tier as Task 11.
- `windowConfig.ts`'s existing keys (`width`, `height`, `webPreferences.*`)
  are untouched; `minWidth`/`minHeight` are added alongside them, not
  replacing anything.

### Pure Transformation Logic

None — same tier as Task 7/11: presentation and window config only, no
business logic.

### Edge-Case Invariant Guardrails

1. `#content`'s existing `padding-inline: 2rem`/`padding-bottom: 2rem`,
   `#frontmatter`'s `margin: 0 2rem`, and all Task 7/8/11 dark-mode variants
   must survive unchanged — this task adds new spacing, it doesn't touch or
   replace any existing rule. `ui-shell.spec.ts`'s current padding
   assertions must keep passing unmodified.
2. `#document-container` must keep its current 2rem minimum lateral gutter
   at every width below the max-width threshold. Implement as
   `width: calc(100% - 4rem); max-width: 54rem; margin-inline: auto;` — NOT
   a bare `max-width` + `margin: auto` with no explicit width, which
   collapses the gutter to 0 right at the threshold (a visible regression
   at today's typical window sizes, not just an addition).
3. The new top gap (`#document-main`'s `padding-top`) and bottom gap
   (`#document-container`'s `margin-bottom`) must both be `1.5rem` —
   matching the container's existing `margin-top: 1.5rem`, not a new
   arbitrary value. Keeps the app's spacing rhythm at two numbers
   (1.5rem outer / 2rem lateral), not three.
4. Task 7's `app.css` header comment — "Deliberately simple: no centered
   max-width reading column (out of scope)" — must be removed or rewritten
   as part of this diff. This task is a deliberate reversal of that prior
   scope decision; leaving the stale comment in place would mislead the
   next reader.
5. `windowConfig.ts`'s three security invariants (`contextIsolation: true`,
   `nodeIntegration: false`, `sandbox: true`) must be untouched — this task
   only adds `minWidth`/`minHeight`, nothing in `webPreferences`.
6. `minWidth`/`minHeight` must be proven to actually clamp resize at the
   Electron/OS level, not just be present as config values. A test that
   only checks `defaultWindowOptions.minWidth === 480` proves the config
   exists, not that Electron obeys it — same shape of false-proof the
   reviewer has rejected before (Task 4). Needs a live e2e check: attempt
   to resize the real window below the minimum, confirm the actual
   resulting bounds clamp.
7. The max-width constraint applies to `#document-container` as a single
   unit (header bar + content together), not to `#content` alone —
   `#document-header` must resize in lockstep with `#content` so the tabs
   bar and the card border stay visually one card, consistent with Task
   11's GitHub-file-view intent.
8. `#empty-state` is unaffected — stays a sibling outside
   `#document-container` (Task 11 guardrail #5), must not be pulled into
   the new width constraint or spacing rules.

---

## Task 13: App Icon — Dev-Mode Window/Taskbar/Dock Parity

Packaged builds already get the correct app icon for free, purely from
electron-builder's convention-based discovery of `build/icon.png` /
`build/icons/` — no packaging config exists to change. The gap is dev mode
only: `npm run dev` launches a raw `electron .` process with no packaging
step in front of it, so `BrowserWindow` falls back to Electron's default
icon on Windows/Linux, and the Dock (macOS) never gets told about the app
icon at all outside a bundled `.app`.

### Abstract Schema Contracts

No message-shape or IPC change — this task has no renderer-facing surface.
The only new "data" is a build-time file (an icon PNG) that must exist at a
known path relative to the main process's compiled output before
`BrowserWindow`/`app.dock` construction reads it. Abstractly: one static
asset, copied from a build-owned source location into the dist output
alongside the other already-copied static assets (renderer HTML/CSS today).

### Pure Transformation Logic

One pure predicate: given `(isPackaged: boolean, platform: NodeJS.Platform)`,
decide whether the dev-mode Dock-icon call should run. `true` only when
`!isPackaged && platform === 'darwin'`. No traversal, no data mutation —
same tier as `shouldSkipDevToolsShortcut`/`shouldShowFrontmatter`: a boolean
gate over environment facts, trivially unit-testable without any Electron
runtime.

### Edge-Case Invariant Guardrails

1. Packaged/production icon behavior must not change at all — this task
   only adds a dev-time copy step and a dev-time Dock call gated so it
   never fires when `app.isPackaged` is true. `electron-builder.yml` is
   untouched; the existing convention-based icon discovery is the single
   source of truth for packaged builds.
2. `windowConfig.ts`'s `defaultWindowOptions` stays free of any
   `__dirname`-dependent value (icon path included) — that object's
   testability without a running Electron instance is a standing invariant
   from prior tasks (its three `webPreferences` security flags are
   unit-tested directly against the plain object). The icon path is
   resolved only at the `createWindow()` callsite, the same treatment
   `preload`'s path already gets.
3. The Dock-icon call must be main-process-only, called exactly once at
   startup (inside the existing `app.whenReady().then(...)` block), never
   per-window — Dock icon is a single OS-level singleton, not a
   per-`BrowserWindow` property, so repeating it per window would be
   redundant work disguised as correctness.
4. `app.dock` is `undefined` on non-macOS platforms. The platform branch of
   the predicate is load-bearing — it must be an explicit
   `platform === 'darwin'` check, not something that relies on optional
   chaining (`app.dock?.setIcon(...)`) to silently no-op elsewhere. A
   silent no-op from `?.` would pass today's tests by accident and mask a
   real logic error if the guard clause were ever refactored away.
5. The new pure predicate must not be exposed through the
   `globalThis.__mdViewDevToolsGuardForTests`-style bridge. That bridge is
   already flagged in `backlog.md` as debt slated for removal (Task 7's
   entry), not a pattern to extend to new predicates. The predicate must
   instead live in its own leaf module with no top-level Electron calls,
   so a plain Vitest unit test can import and call it directly — the fix
   backlog.md already recommends for the *existing* debt, applied here
   from the start instead of accruing more of it.

---

## Task 14: Help feature

md-view gets a third top-level menu item, "Help", with the classic F1
accelerator, opening a dedicated window that displays bundled help
content. This is read-only, static, app-authored content — not a
user-opened file, so none of the existing file-open/live-reload/
frontmatter machinery applies.

### Abstract Schema Contracts

No IPC/message-shape change to the existing FILE_RENDERED / VIEW_SETTINGS
channels. One new static asset (a Markdown file, Lead-authored, not
user-supplied) copied at build time into dist/ alongside the other
already-copied static assets, same tier as icon.png / the renderer CSS
files.

### Pure Transformation Logic

Two pure functions, no Electron runtime required to test either:
1. `shouldCreateHelpWindow(existing)` — given the current Help window
   reference (or a stand-in with an `isDestroyed()` method, or null),
   decide whether a new BrowserWindow must be created vs. an existing one
   focused. `true` when `existing === null || existing.isDestroyed()`.
2. `buildHelpHtml(contentHtml, cssHrefs)` — pure string templating: wraps
   already-rendered HTML in a minimal `<html>` document, `.markdown-body`
   wrapper, and a `<link>` tag per href in cssHrefs. No file I/O, no
   Electron types beyond structural ones.

### Edge-Case Invariant Guardrails

1. The Help window's webPreferences MUST match `defaultWindowOptions`'s
   three security flags (contextIsolation: true, nodeIntegration: false,
   sandbox: true) AND must NOT set a `preload` key at all — this window
   has no need for window.mdview, so it gets none. This is a stricter
   posture than the main window, deliberately.
2. Help content renders through the existing single `markdownToHtml()`
   function in markdown.ts (html:false, already tested) — this task
   introduces no new HTML-injection surface and needs no new
   security-regression test on that front; say so explicitly in the
   review-report close-out rather than silently skipping it.
3. Exactly one Help window may exist at a time. Triggering Help again
   while one is already open must focus the existing window, never open
   a second one. Closing it and triggering Help again must successfully
   reopen it (this is why the predicate checks isDestroyed(), not just
   null — a closed BrowserWindow reference is non-null but unusable).
4. External links inside help.md must route through the exact same
   isExternalHttpUrl / shell.openExternal policy as the main window
   (reuse linkPolicy.ts's isExternalHttpUrl directly — do not
   reimplement).
5. v1 scope is deliberately narrow: the Help window renders in light
   theme only, does not react to the main window's Dark Mode toggle, has
   no live-reload, and its size/position is not persisted (matches the
   existing ViewSettings "session-scoped, never persisted" precedent from
   Task 8 guardrail #6). This is not built toward — these are explicitly
   out of scope, not deferred hooks left stubbed.
6. F1 is a real, Electron-supported accelerator (F1–F24 are valid
   accelerator key names) but on most Mac laptops the physical F1 key is
   bound to a system function by default (brightness) unless the user
   holds Fn or has changed a system preference. This is a known,
   documented platform limitation, not a bug to work around — no
   Fn-detection logic is added.

---

## Task 15: Help Window Must Not Inherit the Application Menu (bug fix)

Escaped Task 14 spec gap, not a new feature: `Menu.setApplicationMenu()`
(installed once in `app.whenReady()`, per Task 7) becomes the default
menu for *every* `BrowserWindow` on Windows/Linux unless that window's
menu is explicitly cleared. The Help window never opted out, so it
currently shows the full File/View/Help bar — including live handlers
(`openFileViaDialog`, `setDarkMode`, `setShowFrontmatter`, even
`onOpenHelp` itself) on a window meant to be static, read-only,
app-authored content. This lets a user drive main-window state (open a
different file, toggle dark mode) from behind a window whose whole
purpose is Task 14 guardrail #5's "deliberately narrow, read-only" v1
scope.

### Abstract Schema Contracts

No new message shape, no IPC change. This is a window-chrome fact only —
whether one specific `BrowserWindow` instance carries a menu — not a
data contract.

### Pure Transformation Logic

None. Same tier as Task 13's dock-icon call: a single imperative Electron
API call made at window-construction time, not a computed decision that
needs its own pure predicate (unlike Task 13's `shouldSetDockIcon`,
there's no platform/packaged branching here — the call is unconditional
for the Help window, every time).

### Edge-Case Invariant Guardrails

1. The Help window must have no menu bar at all — `helpWindow.getMenu()`
   must return `null`, verified against an actual running window (a live
   e2e assertion), not inferred from reading the source.
2. `win.removeMenu()` is the correct call for this — documented by
   Electron as a no-op on macOS (menu bar is process-wide there via
   `Menu.setApplicationMenu`, not per-window). This must be confirmed
   empirically during implementation (actually running on this
   Windows dev machine), not assumed from the docs alone.
3. The main window's File/View/Help menu bar must remain completely
   unaffected — this fix touches only the Help window's own
   `BrowserWindow` instance. `menu.ts`, `buildMenuTemplate`, and the
   main window's `Menu.setApplicationMenu` call are out of scope and
   must show zero diff.
4. No other Help-window behavior established in Task 14 (singleton
   reopen via `shouldCreateHelpWindow`, no-preload posture, external
   link policy via `isExternalHttpUrl`) may regress — this is a pure
   addition (suppress the menu), not a rewrite of `onOpenHelp`.

---

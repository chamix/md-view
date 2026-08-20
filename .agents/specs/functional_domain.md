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

## Task 16: Drag-and-Drop File Open

Adds a fourth way to open a file — dragging a `.md` file from the OS
onto the main window — alongside the existing argv, dialog, and (soon)
whichever paths already exist. Converges on the exact same
`renderAndWatch(filePath)` used by argv/dialog today; no new validation
or watcher logic. Also includes a basic drag-over visual affordance
(highlighted drop target) as part of this same task, per user decision.

This is the first task to add a renderer→main IPC channel — until now
`BridgeApi` has been strictly main→renderer (`onFileRendered`,
`onViewSettings`). Treat that as a first-class fact of this task, not
an incidental detail.

### Abstract Schema Contracts

- New `IPC_CHANNELS` entry: `REQUEST_OPEN_FILE: 'md-view:request-open-file'`.
- New `BridgeApi` method: `openDroppedFile(file: File): void`. This is
  the *only* new bridge surface — deliberately not split into a
  separate `getPathForFile()` + `openFile()` pair, so the renderer never
  receives a resolved absolute path as a raw JS value it could do
  anything else with. Path resolution (`webUtils.getPathForFile`) and
  the `ipcRenderer.send` call both happen inside the preload
  implementation of this one method.
- No changes to `FileRenderedMessage` or `ViewSettings`. The result of a
  drag-and-drop open is delivered over the existing `FILE_RENDERED`
  channel — identical to how a dialog-triggered open already works.
  Fire-and-forget (`ipcRenderer.send` / `ipcMain.on`), not
  `invoke`/`handle` — matches the existing pattern where no open path
  today awaits a return value.

### Pure Transformation Logic

- `firstDroppedFile(fileList)` in `src/renderer/renderer.js`, alongside
  the existing `statusBarText`/`shouldShowFrontmatter` pure helpers:
  returns `fileList[0]` if non-empty, else `null`. Exported via the same
  `typeof module !== 'undefined'` guard for direct unit testing —
  extras beyond index 0 are never inspected here, per guardrail #2.

### Edge-Case Invariant Guardrails

1. **Reuse `renderAndWatch()` unmodified.** The new `ipcMain.on(...)`
   handler must call the existing `renderAndWatch(filePath)` directly —
   no new `.md`-extension check, no new error-message text anywhere in
   this task's diff. A dropped non-`.md` file must produce the exact
   same "Not a Markdown file" error already proven for the dialog path
   (`renderFile()`'s existing check). If this guardrail is violated
   (validation duplicated instead of reused), that is itself a Blocking
   finding regardless of whether the duplicated logic happens to work.

2. **Only the first dropped file is opened, full stop.** If more than
   one file is dropped, `files[1]` onward are silently ignored — no
   error, no partial-support message. This must be pinned by a test
   that dispatches a drop with 2+ files and asserts only one open was
   requested, not just that opening one file works when only one is
   dropped.

3. **`event.preventDefault()` on `dragover` *and* `drop` is
   load-bearing, not optional.** Electron's documented default is to
   navigate the entire window to a dropped file's location if these are
   left unhandled — this predates this task and would silently replace
   the app's own UI. Before writing the fix, empirically confirm what
   currently happens today (drag a file onto a running dev build,
   observe) and note it in the review report as a baseline, the same
   way Task 15 empirically confirmed `removeMenu()`'s macOS no-op rather
   than trusting the docs alone. This must be fault-injection tested:
   remove the `preventDefault()` calls, confirm the relevant e2e
   assertion goes red, restore, confirm green.

4. **Drop target is the whole document, not just `#content` or
   `#document-container`.** Both `#empty-state` and
   `#document-container` are always present in the DOM (only
   `#empty-state`'s `hidden` attribute toggles) — drag-and-drop must
   work identically whether no file is open yet or one is already open
   and being replaced, exactly like `File > Open` already does.

5. **Drag-over highlight must not flicker on nested elements.** A naive
   `dragenter`/`dragleave` pair toggling a class directly will flicker
   because `dragleave` also fires when the pointer crosses into a child
   element inside the drop target. Use a depth counter (or equivalent)
   so the highlight only clears when the counter returns to zero.
   Attempt a fault-injection test for this specifically (swap the
   counter-based version for a naive one, confirm a test that exercises
   a nested-element crossing catches it); if that specific scenario
   turns out impractical to simulate deterministically in Playwright,
   say so explicitly rather than silently skipping the fault-injection
   for this guardrail.

6. **Highlight must be legible in both light and dark mode.** Add a
   dark-mode-aware override alongside the base `.drag-over`-equivalent
   style — this app has already shipped one dark-mode-only-partially-
   applied bug once (Task 9); don't repeat that class of bug on a new
   visual state.

7. **Preload path resolution is preload-only, never main-process.**
   `webUtils.getPathForFile()` must be called from inside
   `src/preload/index.ts`'s implementation of `openDroppedFile`, not
   from a main-process IPC handler receiving a raw `File`-like payload.
   This is a documented Electron requirement (there are open upstream
   issues showing it failing when called from main), not a style
   preference.

8. **Empty/unresolved path is a silent no-op, not a crash or a new
   error message.** If `webUtils.getPathForFile()` ever returns an
   empty string (documented as possible in some platform edge cases),
   the main-process handler must not call `renderAndWatch('')` — guard
   on a non-empty string before dispatching. No new user-facing error
   text for this specific case; it's rare enough not to warrant one.

9. **Help window is explicitly out of scope.** It has no `preload`
   script by design (Task 14, guardrail #1) — do not add one, do not
   extend drag-and-drop there.

10. **Test-coverage honesty requirement, stated up front so it isn't
    discovered as a surprise mid-review:** `webUtils.getPathForFile()`
    only resolves a real filesystem path for a `File` object that
    traces back to an actual native OS-level drag. A `File` constructed
    inside a Playwright `page.evaluate()` will very likely resolve to an
    empty path even inside the real running app — meaning a synthetic
    e2e drop test can faithfully prove the *rejection* path (guardrail
    #1's reused error handling) but probably cannot prove the true
    happy path (drop a real file → see it rendered) end-to-end the way
    the dialog tests do via `dialog.showOpenDialog` mocking, because
    `contextBridge`-exposed methods are non-configurable from web
    content by design and can't simply be monkey-patched to fake a
    resolved path. Investigate this directly — try it — rather than
    assuming either way. If the happy path genuinely can't be proven at
    the e2e layer, name that gap explicitly in the review report and
    `backlog.md`, and compensate with thorough unit/integration coverage
    of everything on this app's own side of that boundary (guardrails
    1, 2, 5, 8 in particular). Do not fabricate a shallow e2e assertion
    to paper over the gap.

## Task 17: File Tree: Foundation (main process, IPC, preload bridge)

Establishes the data and IPC layer for a future file-tree sidebar
(Task 18's job — no renderer UI here). Two new capabilities: listing a
single directory's entries on demand, and establishing/broadcasting a
"tree root" (the folder containing whichever file is currently open, or
a folder chosen explicitly). Converges on one function,
`establishTreeRoot(rootPath)`, for both triggers — auto-detected from
`renderAndWatch(filePath)` and explicit from a new "Open Folder…" menu
action — the same discipline `renderAndWatch` itself already enforces
for file-open triggers (this file's Task 2, guardrail #3: no separate
ad hoc logic per trigger).

This is the first **request-response** shape in the app's IPC surface.
Every existing main↔renderer crossing (`FILE_RENDERED`, `VIEW_SETTINGS`,
`REQUEST_OPEN_FILE`) is fire-and-forget: `ipcMain.on`/`ipcRenderer.send`
one way, or `ipcMain.on`/`ipcRenderer.send` the other way (Task 16).
Listing a directory doesn't fit that shape — the caller needs the
result back, not a later broadcast — so this task introduces
`ipcMain.handle`/`ipcRenderer.invoke` as a first-class pattern
alongside the existing one, not a replacement for it.

### Abstract Schema Contracts

- `TreeEntry`: `{ name: string; path: string; type: 'file' | 'directory' }`
  — one entry in a directory listing. `path` is always absolute.
- `DirectoryListResult`: a discriminated union, `DirectoryListOk { ok:
  true; dirPath: string; entries: TreeEntry[] }` or `DirectoryListError
  { ok: false; dirPath: string; error: string }` — mirrors
  `FileRenderedOk`/`FileRenderedError`'s existing shape exactly (Task 2's
  established idiom for "this either worked or it didn't, and the
  caller always gets a value, never an exception").
- `FolderTreeRootMessage`: the same discriminated-union shape,
  `FolderTreeRootOk { ok: true; rootPath: string; entries: TreeEntry[] }`
  or `FolderTreeRootError { ok: false; rootPath: string; error: string }`
  — what gets broadcast when the tree root is (re)established.
- Two new named IPC channels: one for the request-response directory
  listing, one for the push-broadcast tree-root event. No generic
  `invoke(channel, ...args)` passthrough — each capability is its own
  named contract, same as every existing channel.

### Pure Transformation Logic

- `filterAndSortEntries(raw, dirPath)`: given raw `{ name, isDirectory
  }` pairs and the directory they came from, produce `TreeEntry[]`.
  - Every directory entry is kept, regardless of what (if anything) is
    inside it — no recursive pre-scan to hide folders with zero
    Markdown files. This is a deliberate lazy-loading design choice:
    a folder's contents are only inspected once a caller actually asks
    to list *that* folder, not preemptively for every folder in a tree.
  - A file entry is kept only if its name ends in `.md`, case-
    insensitive — the same test `renderFile()` already applies when
    deciding whether a path is openable. One shared rule, not two
    independently-maintained ones that could drift apart.
  - Ordering is a domain rule, not an accident of the filesystem:
    directories sort before files; within each group, case-insensitive
    alphabetical by name. This must hold regardless of which OS or
    filesystem produced the raw listing — readdir order is not a
    contract this app can depend on.
  - This function touches no filesystem and no Electron API — it is a
    pure mapping from "what the OS reported" to "what the tree should
    show," identical in shape to this file's existing
    `classifyWatchEvent`/`baseUrlForFile` leaf functions.

### Edge-Case Invariant Guardrails

1. Only `.md` files (case-insensitive) appear as file entries. Every
   directory appears regardless of contents — including one with zero
   `.md` files anywhere inside it. No recursive pre-scan to filter out
   "irrelevant" folders; that would break the lazy-loading design this
   task is built around.
2. A single directory listing is sorted deterministically: directories
   first, then case-insensitive alphabetical within each group. Must
   not depend on OS/filesystem readdir ordering, which varies by
   platform and is not a guarantee this app can rely on.
3. Listing a directory is request-response and always resolves to a
   result value — it must never throw across the process boundary and
   must never leave a caller awaiting forever. A nonexistent path, a
   path that turned out to be a file instead of a directory, and a
   permission error are all the same kind of outcome from the caller's
   perspective: a resolved failure, not a rejection.
4. Switching to a different file inside the *same* already-open folder
   must not reset or re-announce the tree root. Establishing the root
   is a no-op when the requested root is already the current one — no
   re-listing, no repeat broadcast.
5. Establishing a folder as the tree root, on its own, must never alter
   the currently open document or its live-reload watcher in any way.
   Opening a folder with no file selected inside it leaves whatever was
   already being previewed exactly as it was.
6. The three existing security invariants hold unchanged: context
   isolation, no Node integration in the renderer, and the sandbox flag
   are all untouched by this task. The two new bridge capabilities are
   explicit, individually named methods — never a generic passthrough
   that would let the renderer invoke arbitrary main-process channels.
7. The established tree root is session-scoped only — never written to
   disk, never read back on the next launch. It resets to "none" every
   process start, the same explicit precedent already set for view
   settings (this file's Task 8, guardrail #6: resets to its documented
   default every launch regardless of a prior session's choices).
8. No tree-root announcement happens on startup before any file or
   folder has been opened by the user. Silence is the correct initial
   state — a future tree-sidebar UI keys off "no announcement has
   arrived yet," not off an explicit empty-payload event.

## Task 18: File Tree Tree-Root Path-Casing Fix (bug fix)

Escaped Task 17 spec gap, not a new feature: `establishTreeRoot`'s
no-op guard (`rootPath === currentTreeRoot`) is a raw string
comparison. On a case-insensitive filesystem — Windows (this dev
machine) and default macOS/APFS — the same real directory can arrive
as two different strings depending on how it was opened
(`dialog.showOpenDialog`'s returned casing vs. `path.dirname()` of a
drag-and-drop/argv-opened file's casing). The guard fails to recognize
these as the same root, so switching between them re-lists the
directory and re-broadcasts `FOLDER_TREE_ROOT` unnecessarily — a
spurious tree reset a real user could hit simply by opening a file two
different ways from the same folder. This gap was absent from Task
17's spec, implementation, and both independent review rounds; it
surfaced only once explicitly investigated.

Resolved via the filesystem's own canonical-path answer
(`realpath`-family resolution), not a platform-based case-folding
heuristic — more precise (uses the actual on-disk identity rather than
guessing by platform/filesystem convention), at the cost of one async
`fs` call and a new failure mode (the directory may no longer exist by
the time this runs) to handle explicitly.

### Abstract Schema Contracts

No new message shape, no IPC change, no new `BridgeApi` member. This is
a purely internal behavioral fix to what value `establishTreeRoot`
compares and stores — `DirectoryListResult`/`FolderTreeRootMessage`'s
shapes are unchanged, guardrail #3 (never throw across the IPC
boundary) still governs the same way it already did.

### Pure Transformation Logic

None new. This is a single additional `await` on an existing Node API
inside `establishTreeRoot`, not a computed decision needing its own
pure predicate — same tier as Task 15's one-line `removeMenu()` fix.

### Edge-Case Invariant Guardrails

9. Two path strings that differ only in casing but resolve to the same
   real on-disk directory must be treated as the same tree root,
   established via the filesystem's own canonicalization — never a
   platform-based heuristic (e.g. lower-casing on Windows only).
   Switching between two such strings must not re-broadcast
   `FOLDER_TREE_ROOT`.
10. If canonicalization itself fails (directory deleted between the
    open action and this call, permission error), `establishTreeRoot`
    must not throw. It falls back to the raw, uncanonicalized path, and
    the existing `{ok:false}` error path (this file's Task 17 guardrail
    #3) governs the outcome exactly as it already does for any other
    unreadable directory — no new error-handling branch, no new
    user-facing message.
11. Task 17's existing behavior — `currentTreeRoot` is set
    unconditionally regardless of whether the subsequent directory
    listing succeeds — is unchanged by this fix. Only *which* value
    (raw vs. canonicalized) gets compared and stored changes.
12. `renderAndWatch` and `openFolderViaDialog` remain unaware of
    canonicalization entirely — both continue to pass a raw path to
    `establishTreeRoot` exactly as before. Resolution is fully
    encapsulated inside `establishTreeRoot`; neither caller's code
    changes.

---

## Task 19: E2E Suite Flakiness Under Parallel Load (test infrastructure)

None — this is test infrastructure, not application business logic, same
precedent as Task 15/18's small non-domain changes. There is no incoming
data map, no output state, no business transformation: the "input" is a
Playwright worker launching a real Electron process, the "output" is
that process's lifecycle, and the invariant under test is process
isolation, not domain correctness. `src/**` is explicitly zero-diff for
this task (guardrail from the task assignment) — nothing here changes
what the application does, only how the e2e suite launches and tears
down the app under test.

### Abstract Schema Contracts

None. No IPC shape, no `BridgeApi` member, no message format is touched.

### Pure Transformation Logic

None. No domain data mutation. The only "transformation" is mechanical:
each test's existing `electron.launch({ args, env: childEnv })` call
becomes a fixture-provided `electronApp`, with a fresh `fs.mkdtempSync`
temp directory passed as `userDataDir` per test instead of every
parallel worker sharing Electron's default profile directory.

### Edge-Case Invariant Guardrails

13. Every existing test's assertions must remain word-for-word
    identical — only the launch mechanism changes, per the task's own
    guardrail #2.
14. Test-specific `args` (different argv file paths, different fixture
    directories) must be preserved through whatever fixture
    parameterization mechanism is chosen — confirmed by reading actual
    call sites (`open-file-argv.spec.ts` passes an extra argv file path
    beyond the entry point; `app-launch.spec.ts` passes only the entry
    point), not assumed uniform.
15. Fixture teardown (closing the app, removing the tmp `userDataDir`)
    must run even when the test body throws — the entire reason a
    native Playwright fixture was chosen over a hand-rolled
    `electron.launch()` + manual cleanup helper (decision already made
    by the Lead and user, stated in the task assignment).
16. `childEnv`'s `ELECTRON_RUN_AS_NODE` stripping (already duplicated
    across all 12 spec files) must still apply to every launch after
    centralization in the fixture.

---

## Task 20: Fix Race Condition in "Open Folder…" E2E Test (test infrastructure)

None — test infrastructure, same tier as Task 18. This is not the
crash-class/resource-pressure flakiness Task 19 investigated and left
open; it's a distinct, previously-misdiagnosed race inside one specific
test's own listener-registration code, now precisely identified:
`file-tree.spec.ts`'s "Open Folder…" test (lines 244-296) registers its
`onFolderTreeRoot` listener via an un-awaited, Promise-returning
`window.evaluate()` call, then immediately fires an awaited
`electronApp.evaluate()` menu click on a separate automation channel
(Electron's own, not CDP). Nothing orders the listener's CDP round-trip
ahead of the click's IPC round-trip; if the click wins, the
`FOLDER_TREE_ROOT` broadcast fires into zero listeners (IPC events
aren't replayed) and the test hangs until Playwright's 30s timeout,
surfacing as "Target page, context or browser has been closed." This
file already contains the correct fix pattern in four other tests
(accumulate-into-an-array-then-poll, not a dangling `Promise`) — this
task makes the fifth test match the other four, nothing more.

### Abstract Schema Contracts

None. No IPC shape, no `BridgeApi` member touched.

### Pure Transformation Logic

None. Listener-registration mechanics only — what gets asserted (tree
root `ok`/`rootPath`/`entries`, zero `FILE_RENDERED` side effect) is
unchanged.

### Edge-Case Invariant Guardrails

17. A test's event listener must be registered via a plain, awaited,
    immediately-resolving `evaluate()` call that completes before the
    action triggering the event — never a dangling un-awaited
    Promise-returning `evaluate()` racing a separately-awaited
    triggering action on a different automation channel.
18. All of this test's existing assertions stay word-for-word
    identical — only the listener-registration mechanism changes.
19. No other test in `file-tree.spec.ts` is touched.

---

## Task 21: Tree Sidebar — Core Rendering, Lazy Expand, Click-to-Open

Task 17 built the backend (main-process `establishTreeRoot`,
`listDirectory` IPC, preload bridge methods `onFolderTreeRoot`/
`listDirectory`) with deliberately no renderer UI. This task is the
first renderer consumer of that contract. Two data flows, both already
proven correct by Task 17/18's own tests: `FOLDER_TREE_ROOT` (push,
one root per open action) and `REQUEST_LIST_DIRECTORY` (request-
response, one call per folder expansion). Neither shape changes here —
this task is a pure consumer.

### Abstract Schema Contracts

No new IPC message shape. `TreeEntry` (`{name, path, type}`),
`DirectoryListResult`, `FolderTreeRootMessage` (all `src/preload/api.ts`,
Task 17) are consumed exactly as they already exist — the renderer
never re-derives or re-validates their fields. One new `BridgeApi`
member: `openFileByPath(filePath: string): void` — a thin send-only
wrapper reusing `REQUEST_OPEN_FILE`'s existing channel and existing
main-process validation path (`renderAndWatch`, unchanged, unowned by
this task). No new `IPC_CHANNELS` entry.

### Pure Transformation Logic

Two decisions worth naming as pure predicates, testable without DOM,
following this file's established `typeof document`-guard pattern
(`statusBarText`, `shouldShowFrontmatter`, `firstDroppedFile` in
`renderer.js`):

- **Row kind**: `entry.type === 'directory'` decides expand-affordance
  vs. plain leaf row — already fully decided by data Task 17 already
  filters/sorts; the renderer performs zero re-filtering (guardrail
  #1 below).
- **Fetch-or-reveal decision**: given a folder's current in-memory
  state (never fetched / fetched-and-collapsed / fetched-and-expanded),
  a click either triggers exactly one `listDirectory` call (first time
  only) or a pure visibility toggle (every subsequent time) — never
  both, never neither. This is the guardrail #2 caching contract and
  is the one piece of new logic actually worth unit-testing in
  isolation from Playwright/DOM.

Everything else (DOM row creation, event wiring, recursion into child
levels) is standard imperative rendering, same tier as the existing
`renderHtml`/`renderError` functions — not claimed as "pure" and not
forced into a shape it doesn't naturally have.

### Edge-Case Invariant Guardrails

20. The renderer never re-filters or re-validates `TreeEntry[]` —
    trusts Task 17's contract completely. No duplicate `.md`-extension
    check, no re-sorting.
21. Lazy-expand caching: re-expanding a folder previously expanded-
    then-collapsed must not re-fetch. Exactly one `listDirectory` call
    per folder, ever, across any number of collapse/expand cycles in
    a session.
22. A file-row click sends exactly one `REQUEST_OPEN_FILE` per click,
    using the entry's own `path` field verbatim — no string
    concatenation, no recomputation.
23. Tree interactions never touch `#content`/`#frontmatter`/
    `#status-bar` directly. Every visible update after a file click
    flows through the existing `FILE_RENDERED` → `onFileRendered` →
    `renderHtml`/`renderError` pipeline, unchanged, same as File>Open
    or drag-and-drop.
24. `#empty-state`/`#document-container`/`#status-bar`'s existing
    observable behavior (visibility, computed styles, text content) is
    unchanged by the new wrapper structure — the full pre-existing e2e
    suite must stay green, not just new tree tests. Layout
    restructuring silently shifting computed styles has broken this
    app twice before (Task 8, Task 12); treated with the same weight
    here, not as a formality.
25. Every new tree-panel element gets a `body.dark-mode #id` rule,
    following the file's existing per-ID scoping convention exactly —
    no new theming mechanism introduced.
26. A `{ok:false}` `listDirectory` result renders a visible inline
    error in place of that folder's children — never a silent no-op,
    never an unhandled promise rejection.
27. `#tree-root`'s content is fully replaced (not appended-to) on each
    new `FOLDER_TREE_ROOT` broadcast — no stale nodes from a previous
    root ever remain visible or in the DOM after a folder switch.

---

## Task 22: Replace Fixed-Wait Layout Reads with Poll-Until-Stable in ui-shell.spec.ts (test infrastructure)

None — test infrastructure, same tier as Task 19/20. This targets one
specific, already-measured symptom: `ui-shell.spec.ts`'s checks (g) and
(h) each do a fixed `waitForTimeout(100)` then a single computed-style
read of `#document-container`. Task 21's review (`review_report_task21.md`
§6b) proved via a throwaway polling diagnostic that check (h)'s flake is
not a geometry defect — the real settled `marginLeft` is 230.8px, ~7x the
`>32` threshold — it's a render-not-yet-settled read racing a fixed
100ms wait under concurrent-process contention (Task 19's still-open,
broader, unrelated issue). This task rebuilds that diagnostic's polling
behavior as a permanent, reusable helper and applies it to both checks
(g) and (h). It does not touch or claim to resolve Task 19's item.

### Abstract Schema Contracts

None. No IPC shape, no `BridgeApi` member, no message format touched —
this is purely how a test *reads* an already-correct, already-rendered
DOM value, not a change to what gets rendered or asserted.

### Pure Transformation Logic

One new pure(-ish) async helper, decoupled from Playwright/DOM so its
own stability logic is unit-testable without a real browser:
`pollUntilStable<T>(read: () => Promise<T>, options): Promise<T>` — calls
`read()` repeatedly, returns as soon as N consecutive calls
(`stableReads`, default 5) produce identical values, throws if it never
stabilizes within `timeoutMs` (default 5000). Equality is its own small
function, `sameValues<T>(a, b)` — strict-equal on every key. Both are
generic over `T extends Record<string, number>`, not hardcoded to margin
fields — check (g) (`marginLeft`/`marginRight`) and check (h)
(`width`/`marginLeft`/`marginRight`) both call the same helper with
their own field sets.

### Edge-Case Invariant Guardrails

28. No assertion threshold anywhere in `ui-shell.spec.ts` changes — this
    is a measurement-timing fix only. Every existing value (31/33,
    800/900, `>32`, `toBeCloseTo`) stays exactly as-is.
29. `pollUntilStable` must have a real timeout ceiling and throw a clear
    error rather than hang forever if genuinely never stable — same
    "never leave a caller awaiting forever" principle already applied to
    `listDirectory`'s error handling (Task 17).
30. `sameValues`/`pollUntilStable` are reusable, not hardcoded to margin
    fields — no duplicated polling logic between checks (g) and (h).
31. No change to any other test in the file, any other file, or `src/**`.
32. Check (g)'s existing 1px-band comment/rationale (subpixel rendering
    variance) is untouched — unrelated to this fix.

---
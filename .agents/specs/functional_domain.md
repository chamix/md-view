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

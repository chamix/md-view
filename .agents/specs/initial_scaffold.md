# Technical Specification Mapping — Electron/TS Scaffold (Step 1)

Maps [functional_domain.md](functional_domain.md)'s Step 0 analysis to a concrete architecture plan.

## The Inward Dependency Rule

There is no domain/core layer yet — one is deliberately deferred (per Step 0, no transformation logic exists to protect). At scaffold stage the rule manifests as **process-boundary isolation** instead:

- `src/main`, `src/preload`, `src/renderer` do not reach into each other's internals. They only communicate through the explicit bridge contract (`src/preload/api.ts`).
- `src/renderer` never imports `electron` or `node:*` directly — its only channel to the outside is `window.mdview` (the bridge global).
- When a `src/core` (or `src/domain`) package appears in a later step, `src/main`/`src/preload` will depend inward on it — not the reverse. Nothing today violates that future direction.

## SOLID Boundary Scan

- **ISP** — the bridge API (`src/preload/api.ts`) is a named, narrow TypeScript type, not `any`. Growing it later is additive; nothing downstream has to widen a blind cast.
- **SRP** — `src/main/index.ts` does exactly one thing: process/window lifecycle. Window *configuration* (security-relevant `webPreferences`) is split into `src/main/windowConfig.ts` so it's independently testable and doesn't get buried in lifecycle code as IPC handlers accrue later.
- **DIP** — main depends directly on Electron's own abstractions (`app`, `BrowserWindow`); Electron *is* the outermost boundary here, so wrapping it in a further interface today would be premature abstraction with no second implementation to justify it.

## Pattern Application (GoF)

- **Facade** — `src/preload/index.ts` is a thin facade wiring `contextBridge.exposeInMainWorld` to the pure `api.ts` contract. It exists so the renderer never sees `contextBridge`/`ipcRenderer` mechanics directly, even as the API surface grows.
- **Composition Root** — `src/main/index.ts` is the single place the app is wired together (window creation, lifecycle events). No Factory/Strategy/Observer is introduced: there is no variability yet to manage, and forcing one in now would violate the project's "don't design for hypothetical requirements" principle.

## Proposed File Tree

```
md-view/
├── package.json
├── tsconfig.json                  # single config: covers src/main + src/preload (both Node/Electron context)
├── .gitignore
├── README.md
├── electron-builder.yml
├── vitest.config.ts
├── playwright.config.ts
├── src/
│   ├── main/
│   │   ├── index.ts                # composition root: app lifecycle, window creation
│   │   └── windowConfig.ts         # pure data: defaultWindowOptions (contextIsolation/nodeIntegration invariants live here)
│   ├── preload/
│   │   ├── index.ts                # facade: contextBridge.exposeInMainWorld(bridgeApi)
│   │   └── api.ts                  # pure contract: bridgeApi object + BridgeApi type (no Electron import — unit-testable)
│   └── renderer/
│       └── index.html              # fully static "Hello, md-view" — no script, no TS, nothing to test yet
└── tests/
    ├── unit/
    │   └── preload-api.test.ts         # imports api.ts directly, asserts contract shape
    ├── integration/
    │   └── window-config.test.ts       # imports windowConfig.ts, asserts contextIsolation:true / nodeIntegration:false
    └── e2e/
        └── app-launch.spec.ts          # Playwright _electron: launches dist/main/index.js, asserts a window exists
```

**Deliberate omissions, stated explicitly:**
- No `src/renderer/index.ts` — renderer has no logic to type-check or test yet (Step 0 requirement: "sin lógica, solo hello world"). Adding an empty TS entry point just to have one would be scope creep; it lands in the step that adds real renderer behavior.
- No `tsconfig.main.json` / `tsconfig.renderer.json` split — main and preload share one Node/Electron-context config, and renderer has no TypeScript to compile. A single `tsconfig.json` matches the scope contract's literal file list and avoids an unnecessary project-references setup for zero renderer code.
- No `src/core` / `src/domain` — nothing to put there yet per Step 0.

## Why main/preload/renderer are testable without a running Electron instance

`api.ts` and `windowConfig.ts` are plain data/TS modules with no `electron` runtime calls at import time (`windowConfig.ts` only imports Electron's *types*, not its runtime). `index.ts` in both main and preload is the only place that touches live Electron APIs (`contextBridge`, `app`, `BrowserWindow`) — so unit/integration tests target the pure modules, and only the e2e Playwright test needs a real Electron process. This is what makes "one trivial green test per tests/ folder" honest rather than a rubber stamp.

## Build & Scripts

- `build`: `tsc -p tsconfig.json` (emits `dist/main/**`, `dist/preload/**`) followed by copying `src/renderer/index.html` → `dist/renderer/index.html` (electron-builder packages `dist/**` only, so the static HTML must land there too).
- `dev`: `build` then `electron .` (package.json `"main": "dist/main/index.js"`).
- `test:unit` / `test:integration`: `vitest run tests/unit` / `tests/integration` respectively (one `vitest.config.ts`, filtered by directory argument).
- `test:e2e`: `build` (dist must exist for Playwright to launch it) then `playwright test`.
- `test:all`: runs all three in sequence.
- `package` (bonus, not in the original required list, needed to actually use electron-builder): `electron-builder`.

## Package manager / module system

- CommonJS output for main+preload (`"module": "CommonJS"` in tsconfig) — avoids Electron ESM-preload edge cases entirely at scaffold stage.
- `strict: true` in tsconfig from this first commit, per requirement.

*Note: a post-review fix (`fix(tsconfig): use node16 module/moduleResolution pair`) later changed `module`/`moduleResolution` from `CommonJS` to `Node16`. Output is still CommonJS-shaped (Node16 resolution with no `"type": "module"` in package.json compiles to `.js` files Node/Electron load as CommonJS) — the ESM-preload avoidance goal above still holds, just via a different compiler setting. Recorded here for accuracy; not part of this task's diff.*

---

## Task 2 Technical Specification — Open & Render Markdown

Maps `functional_domain.md`'s Task 2 analysis to concrete design.

### The Inward Dependency Rule

- `src/main/markdown.ts` is this project's first real domain-ish module: pure `string -> string`, zero Electron import, zero I/O. Everything else in this task depends *outward* toward it (main's IPC handler calls it; nothing calls back).
- The IPC contract (channel names + message types) lives in `src/preload/api.ts` as the shared abstraction both `src/main/index.ts` and `src/preload/index.ts` depend on — neither side hardcodes the other's strings. This is DIP applied to the process boundary itself: main and preload both depend on a shared type, not on each other.
- `src/renderer/renderer.js` still only touches `window.mdview` — never `electron`, never `node:*`. The inward-dependency boundary from Task 1 is unchanged; the bridge surface it depends on just grew.

### SOLID Boundary Scan

- **ISP** — `BridgeApi` grows by exactly two members (`openFileDialog`, `onFileRendered`); nothing existing widens. `renderer.js` uses only what it needs.
- **SRP** — `markdown.ts` does one thing (convert). `main/index.ts` gains orchestration (argv parsing, dialog wiring, IPC handler registration) but no parsing logic of its own — it calls `markdownToHtml`, it doesn't reimplement any part of it. `windowConfig.ts` is untouched (correctly — window chrome config has no relationship to file rendering).
- **DIP** — `main/index.ts` and `preload/index.ts` both depend on the `BridgeApi`/`IPC_CHANNELS`/`FileRenderedMessage` contract declared in `preload/api.ts`, not on each other's implementation.

### Pattern Application (GoF)

- **Adapter** — `markdown.ts` adapts the third-party `markdown-it` library behind a single narrow function (`markdownToHtml`). Nothing outside this file ever imports `markdown-it` directly — if the library is ever swapped, one file changes.
- **Facade** — `preload/index.ts` still owns the sole `contextBridge.exposeInMainWorld` call, now constructing a richer `BridgeApi` object (version passthrough + two `ipcRenderer`-bound methods) but still the only file that touches `contextBridge`/`ipcRenderer`.
- No new pattern is forced for the dialog-vs-argv duality — per the functional-domain guardrail, both triggers call the same `renderFile` orchestration function; that's a shared-function call, not a variability point that needs Strategy/Command.

### IPC Contract (authoritative — implement exactly this)

Declared in `src/preload/api.ts`, imported by both `src/main/index.ts` and `src/preload/index.ts`:

```ts
export const IPC_CHANNELS = {
  OPEN_FILE_DIALOG: 'md-view:open-file-dialog',
  FILE_RENDERED: 'md-view:file-rendered',
} as const;

export interface FileRenderedOk {
  ok: true;
  filePath: string;
  html: string;
}

export interface FileRenderedError {
  ok: false;
  filePath: string | null;
  error: string;
}

export type FileRenderedMessage = FileRenderedOk | FileRenderedError;

export interface BridgeApi {
  readonly version: string;
  openFileDialog(): void;
  onFileRendered(callback: (message: FileRenderedMessage) => void): void;
}
```

**The existing `bridgeApi` const (`{ version: '0.0.0-scaffold' }`) is kept, unchanged, in `api.ts`** — it and the Task 1 unit test that imports it both keep working untouched. `api.ts` stays 100% free of any `electron` import (still grep-verifiable, still the property the reviewer checked last time); the new pieces above are types and string constants only. `preload/index.ts` (which already legitimately imports `electron`) is where `bridgeApi.version` and the two live `ipcRenderer`-bound methods get assembled into the object actually passed to `exposeInMainWorld` — the *contract* is declared in `api.ts`, the *implementation* stays in `index.ts`, exactly like Task 1's Facade split.

`openFileDialog()` is fire-and-forget (`ipcRenderer.send`, not `invoke`) — the result doesn't come back as a return value, it arrives later on the same `FILE_RENDERED` channel that argv-triggered opens use, per the "one path" guardrail. `onFileRendered`'s wrapper strips the raw Electron event object before calling the caller's callback, passing only the typed `FileRenderedMessage` payload — preserves Task 1's "no raw primitives leak to the renderer" guardrail.

### Main-process orchestration (`src/main/index.ts`)

- `argvFilePath()`: scans `app.isPackaged ? process.argv.slice(1) : process.argv.slice(2)` for the first entry ending in `.md` (case-insensitive) — a content-based scan, not a fixed positional index, so it's robust to both `electron .` (dev) and `electron dist/main/index.js <file>` (how the e2e test launches it) without special-casing the test.
- `renderFile(filePath)`: rejects non-`.md` paths and read failures into `FileRenderedError`, otherwise reads the file and returns `{ ok: true, filePath, html: markdownToHtml(source) }`. This is the *one* function both triggers call.
- Startup: create the window, resolve `argvFilePath()`, and if present, render it and send once `did-finish-load` fires (sending earlier would race the renderer's `onFileRendered` subscription and silently drop the message).
- `ipcMain.on(IPC_CHANNELS.OPEN_FILE_DIALOG, ...)`: opens a native dialog filtered to `*.md`, and on a real selection, calls the same `renderFile` and sends the same way.
- This orchestration is not unit-tested directly (importing `main/index.ts` triggers `app.whenReady()` side effects outside Electron, same reason Task 1 kept `index.ts` untested-in-isolation) — it's covered by the e2e test instead, which is the right level for "does the whole pipeline work," not the wrong level to skip testing at.

### Renderer (`src/renderer/renderer.js`, plain JS, no build step)

- Subscribes once via `window.mdview.onFileRendered`; on `ok: true` sets `container.innerHTML = message.html`, on `ok: false` renders a plain-text error state into the same container. `innerHTML` assignment here is safe *because* `markdownToHtml` guarantees `html:false` — this is exactly why guardrail #1 is tested, not just configured.
- One button (`#open-file-btn`) calling `window.mdview.openFileDialog()` — the simplest dialog trigger; a native `Menu`/accelerator is more idiomatic Electron but is main-process surface area this task doesn't need to add.

### File Tree — Task 2 additions/changes

```
md-view/
├── package.json                    # + dependencies: markdown-it, github-markdown-css
│                                    # + devDependencies: @types/markdown-it
│                                    # ~ build script: also copies renderer.js and the
│                                    #   github-markdown-css asset into dist/renderer/
├── tsconfig.json                   # ~ lib: + "DOM"; include: + "src/renderer/**/*.ts"
│                                    #   (inert today — renderer.js is plain JS, no .ts
│                                    #   file exists under src/renderer/ yet; this is
│                                    #   forward config only, explicitly requested)
├── src/
│   ├── main/
│   │   ├── index.ts                 # ~ argv parsing, dialog IPC handler, renderFile()
│   │   ├── windowConfig.ts          # unchanged
│   │   └── markdown.ts              # NEW — pure markdownToHtml(source): string
│   ├── preload/
│   │   ├── index.ts                 # ~ builds full BridgeApi incl. new methods
│   │   └── api.ts                   # ~ + IPC_CHANNELS, FileRenderedMessage, BridgeApi type
│   │                                 #   (bridgeApi const unchanged)
│   └── renderer/
│       ├── index.html               # ~ + <link> to github-markdown css, #content div,
│       │                             #   #open-file-btn, <script src="./renderer.js">
│       └── renderer.js              # NEW — plain JS, window.mdview wiring only
└── tests/
    ├── unit/
    │   └── markdown.test.ts                    # NEW — conversion + html:false security case
    ├── integration/
    │   └── preload-api-contract.test.ts        # NEW — IPC_CHANNELS shape; Task 1's
    │                                             #   preload-api.test.ts (bridgeApi.version)
    │                                             #   stays untouched
    └── e2e/
        ├── open-file-argv.spec.ts              # NEW — separate spec, Task 1's
        │                                         #   app-launch.spec.ts stays untouched
        └── fixtures/sample.md                  # NEW — small fixture for the above
```

### Dependency placement (correctness detail, not explicitly specified by the task but load-bearing for packaging)

`markdown-it` and `github-markdown-css` are used by the **shipped application** (main process requires `markdown-it` at runtime; the renderer loads the CSS file at runtime) — they must go under `"dependencies"`, not `"devDependencies"`, or `electron-builder` will prune them from the packaged app. `@types/markdown-it` is type-only → `"devDependencies"`, consistent with the existing `@types/node` placement.

### Build script change

`build` must additionally copy `src/renderer/renderer.js` → `dist/renderer/renderer.js` (same reason `index.html` is copied: `tsc` doesn't touch non-`.ts` files, and only `dist/**` gets packaged) and copy `node_modules/github-markdown-css/github-markdown.css` → `dist/renderer/github-markdown.css`. Touching `package.json`'s `scripts.build` value is within the scope contract's grant of the whole `package.json` file, not just its dependency lists — flagging explicitly since the task description's parenthetical only mentioned dependencies.

### Addendum: preload must be bundled (discovered mid-implementation, user-approved)

**Problem, evidence-based.** `windowConfig.ts` sets `sandbox: true` (Task 1, unrequested-but-benign hardening at the time). Electron's sandboxed preload context runs a polyfilled `require()` limited to an allowlist (`electron`, `events`, `timers`, `url`) — it cannot resolve local sibling files by relative path. The mandated preload split above (`api.ts` contract / `index.ts` facade, `import { bridgeApi, IPC_CHANNELS } from './api'`) compiles to a runtime `require('./api')`, which the sandbox rejects: `window.mdview` ends up `undefined` at runtime, confirmed by launching the real built app under Playwright and capturing the renderer's console/pageerror output. This was latent since Task 1 (nothing there ever called `window.mdview`, so nothing exercised the failure) and only surfaced now that `renderer.js` actually calls `window.mdview.onFileRendered(...)`.

**Decision (Lead + user, not the engineer's call — it touches an architectural tradeoff, not just code):** bundle the preload script rather than relax `sandbox: true` or collapse the `api.ts`/`index.ts` source split. This keeps every existing invariant intact — `windowConfig.ts` stays untouched (`sandbox: true` unchanged), the DIP/Facade source split from earlier in this document stays intact (contract in `api.ts`, implementation in `index.ts`, still two files, still the same reasoning) — and resolves the constraint at the build boundary instead: the *source* stays split for authoring/testability reasons, the *shipped artifact* is a single bundled file with zero runtime local `require()` calls, which is what the sandboxed preload actually requires. This is the standard mitigation for non-trivial sandboxed Electron preload scripts.

**Rejected alternatives, and why:** `sandbox: false` would have worked and touched only one line, but throws away hardening for a problem that has a better fix. Merging `api.ts` into `index.ts` would "work" but destroys the DIP/Facade separation this very document argues for, just to route around a tooling limitation — treating source architecture as disposable is the wrong tradeoff.

**Implementation, entirely within the existing Task 2 scope contract — no scope amendment needed:**
- Add `esbuild` to `package.json` `devDependencies` (build tool, not shipped — correctly dev, unlike `markdown-it`/`github-markdown-css`).
- `build` script gains one more step, after the existing `tsc -p tsconfig.json`: bundle `src/preload/index.ts` directly (esbuild transpiles TS itself) into `dist/preload/index.js`, `--bundle --platform=node --format=cjs --external:electron`, overwriting `tsc`'s own emitted `dist/preload/index.js`. `tsc` still compiles and strict-type-checks `src/preload/**/*.ts` as before (including `api.ts` and `index.ts`) — esbuild's job is purely to reshape the *shipped* preload artifact, not to replace type-checking. `--external:electron` is required: `electron` must stay a runtime `require('electron')` in the bundle (the sandbox's own allowlist provides it), not get bundled in — bundling it would either fail (no real `electron` module to bundle at build time) or produce a nonfunctional stub.
- No new file needed: this is one additional esbuild CLI invocation in `package.json`'s existing `build` script string, the same "no new script file" discipline already used for the `index.html`/`renderer.js`/CSS copy steps.

---

## Task 3 Technical Specification — Live-Reload

Maps `functional_domain.md`'s Task 3 analysis to concrete design.

### The Inward Dependency Rule

- `src/main/watcher.ts` is a second domain-adjacent module alongside `markdown.ts` — but unlike `markdown.ts`/`windowConfig.ts` (which are pure-only, with all Electron/Node-runtime orchestration pushed out to `index.ts`), this file deliberately holds **both** the pure classifier and the chokidar wiring, because chokidar itself has no Electron dependency — it's a plain Node fs-watcher, testable with real files outside Electron entirely (that's exactly what the integration test does). The purity boundary that matters here is "Electron-free", not "I/O-free" — `watchFile()` does real I/O but never touches `electron`.
- `src/main/index.ts` orchestrates three triggers (argv, dialog, watch) into the *same* `renderFile` → `sendToRenderer` pair. No trigger gets its own rendering logic — this is the DRY consequence of Task 2's "one path produces a render result" guardrail extended to a third trigger.

### SOLID Boundary Scan

- **SRP** — within `watcher.ts`: `classifyWatchEvent` (translation) and `watchFile` (chokidar lifecycle: create, listen, return a closable handle) are two functions with two separate reasons to change. `index.ts` gains exactly one more responsibility (watcher lifecycle: start-stops-old-first, stop-on-quit) — it still doesn't gain any parsing or classification logic of its own.
- **OCP** — `classifyWatchEvent`'s `'ignore'` bucket means chokidar emitting a currently-unhandled event type (`raw`, future chokidar versions adding new event kinds) degrades to a no-op, not a crash or a `default:` branch someone has to remember to update defensively.
- **DIP** — `index.ts` depends on `watchFile`'s narrow return contract (an object with `.close()`, i.e. chokidar's `FSWatcher`) and its `onEvent` callback contract — not on chokidar's API surface directly. If the watch library were ever swapped, only `watcher.ts` changes.

### Pattern Application (GoF)

- **Adapter** — `classifyWatchEvent` adapts chokidar's raw event-name vocabulary into the domain's 3-value `WatchAction` vocabulary, the same role `markdown.ts` plays for `markdown-it`.
- **Observer** — chokidar's `FSWatcher` already *is* an `EventEmitter`/Observer; `watchFile` doesn't reinvent this, it subscribes to it once (`'all'`) and re-dispatches through the narrower `onEvent` callback, keeping every other caller from needing to know chokidar's event names at all.

### Exact signatures (authoritative — implement exactly this)

```ts
// src/main/watcher.ts
export type WatchAction = 'render' | 'error' | 'ignore';

export function classifyWatchEvent(event: string): WatchAction;

export function watchFile(
  filePath: string,
  onEvent: (action: 'render' | 'error') => void
): FSWatcher; // chokidar's FSWatcher type, re-exported or imported by callers as needed
```

`watchFile` filters out `'ignore'` internally — `onEvent` only ever fires for `'render'`/`'error'`, so callers never need to handle the ignore case. Both `'render'` and `'error'` actions are wired to the *identical* call in `index.ts` (`renderFile(filePath).then(sendToRenderer)`) — `renderFile` naturally produces `FileRenderedOk` on a real change and `FileRenderedError` on a deletion (ENOENT from `fs.readFile`), so the two-action split exists at the classification layer for semantic clarity and future extensibility, not because the two actions currently do different things downstream.

### `index.ts` wiring additions

- Module-level `let activeWatcher: FSWatcher | null = null;`
- `stopWatching()`: closes and nulls the active watcher if present; safe to call when none is active (first open).
- `startWatching(filePath)`: calls `stopWatching()` first, then `watchFile(filePath, () => renderFile(filePath).then(sendToRenderer))`, storing the result. **Never called from inside the watch callback itself** — restarting the watcher on every change event would be wasteful and could drop events during the close/reopen gap; the watcher stays attached across repeated edits to the same file.
- `renderAndWatch(filePath)`: the new shared entry point for both triggers — `renderFile` → `sendToRenderer` → if `ok: true`, `startWatching(filePath)`. Both the argv `did-finish-load` handler and the dialog `ipcMain.on` handler call this instead of the bare `renderFile().then(sendToRenderer)` they used before. On a failed open (bad path, wrong extension), no watcher starts — nothing to watch.
- `app.on('before-quit', stopWatching)` — fires exactly once when the app is actually exiting, regardless of platform (unlike `window-all-closed`, which deliberately does *not* quit on macOS).

### File tree — Task 3 additions/changes

```
md-view/
├── package.json                      # + dependencies: chokidar
├── src/main/
│   ├── index.ts                       # ~ startWatching/stopWatching/renderAndWatch, before-quit hook
│   ├── markdown.ts                    # unchanged
│   ├── windowConfig.ts                # unchanged
│   └── watcher.ts                     # NEW — classifyWatchEvent (pure) + watchFile (chokidar wiring)
└── tests/
    ├── unit/watcher.test.ts                    # NEW — classifyWatchEvent, no fs
    ├── integration/watcher.test.ts              # NEW — watchFile against a real os.tmpdir() file
    └── e2e/live-reload.spec.ts                  # NEW — copies fixtures/sample.md to a tmpdir first;
                                                   #   never mutates the checked-in fixture in place
```

### A packaging concern worth flagging, not fixing here

`electron-builder.yml`'s `files: [dist/**/*]` may or may not include `node_modules` production dependencies when actually packaged (electron-builder's default-merge behavior around `files` is not something this project has verified either way) — if it doesn't, `markdown-it` (Task 2) and now `chokidar` would fail to `require()` in a *packaged* build, even though every dev-mode test here (all of which run against `node_modules` present at the repo root) would stay green regardless. Out of this task's scope contract (`electron-builder.yml` isn't a grantable path here) and out of Task 2's scope when it first introduced the question — flagged for the user as a follow-up to verify before an actual `npm run package` ships, not something to fix mid-task.

**Resolved (verified by Lead against official electron-builder docs, no
code change needed):** confirmed false alarm — electron-builder always
copies `package.json` and `node_modules/**/*` (production dependencies
only) regardless of custom `files` patterns; this is documented,
always-included behavior, unaffected by `files: [dist/**/*]`. No fix
required to `electron-builder.yml`.

---

## Task 4 Technical Specification — Base-URL Fix for Relative Image Paths

Maps `functional_domain.md`'s Task 4 analysis to concrete design.

### The Inward Dependency Rule

- `src/main/paths.ts` is a third pure module, at the same purity tier as `markdown.ts` (no Electron, no I/O) — arguably purer still, since `dirname`/`pathToFileURL` don't even touch environment state the way `markdownToHtml`'s underlying library init does. `index.ts` calls it once per successful `renderFile`, same orchestration role it already plays for `markdownToHtml`.
- No new dependency direction: `paths.ts` has no knowledge of `markdown.ts`, `watcher.ts`, or the IPC contract — it's a leaf, exactly like `markdownToHtml` is.

### SOLID Boundary Scan

- **SRP** — `baseUrlForFile` computes exactly one thing: the base URL for a path's containing directory. It doesn't validate the path exists, doesn't read the file, doesn't know about Markdown or HTML at all.
- **ISP** — `FileRenderedOk` and `FileRenderedError` continue to carry only what each variant actually needs (per the functional-domain guardrail on this task) — `baseUrl` joins `FileRenderedOk` alone, not a shared base interface both extend.

### Pattern note

Not a new GoF pattern introduction — `baseUrlForFile` plays the same small-Adapter role `markdownToHtml` plays for `markdown-it`: wrapping a Node built-in (`url.pathToFileURL`) behind a narrow, task-specific function so nothing else in the codebase needs to know that built-in exists.

### Exact signature (authoritative)

```ts
// src/main/paths.ts
import { dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export function baseUrlForFile(filePath: string): string {
  return pathToFileURL(dirname(filePath) + sep).href;
}
```

The trailing `sep` before `pathToFileURL` is the entire fix — without it, `pathToFileURL('/a/b').href` is `file:///a/b` (no trailing slash), and a browser resolving `./img/x.png` against that base treats `b` as a filename and drops it, producing `file:///a/img/x.png` (wrong — lost a directory level). With the trailing separator, `pathToFileURL('/a/b/').href` is `file:///a/b/`, and the same relative resolution correctly produces `file:///a/b/img/x.png`.

### `renderFile()` / IPC contract changes

- `src/main/index.ts`: `renderFile`'s `ok: true` return gains `baseUrl: baseUrlForFile(filePath)`. Nothing else about `renderFile`'s control flow changes — the error branch is untouched.
- `src/preload/api.ts`: `FileRenderedOk` gains `baseUrl: string`. `FileRenderedError` unchanged. `src/preload/index.ts` needs no change — it forwards `FileRenderedMessage` generically and has no field-specific logic to update.

### Renderer changes

- `src/renderer/index.html`: `<base id="content-base" href="" />` added to `<head>`. An empty `href` on `<base>` is a spec-defined no-op (falls back to the document's own URL), so this is safe at initial static load and doesn't disturb the existing `github-markdown.css` `<link>` resolution.
- `src/renderer/renderer.js`: `renderHtml` sets `document.getElementById('content-base').href = message.baseUrl` **before** `container.innerHTML = message.html`. This ordering is the task's central guardrail — verified by e2e, not just written correctly once and trusted.

### File tree — Task 4 additions/changes

```
md-view/
├── src/main/
│   ├── paths.ts                       # NEW — baseUrlForFile (pure)
│   ├── index.ts                        # ~ renderFile()'s ok:true branch
│   ├── markdown.ts                     # unchanged, zero diff expected
│   └── watcher.ts, windowConfig.ts     # unchanged
├── src/preload/
│   ├── api.ts                          # ~ FileRenderedOk + baseUrl
│   └── index.ts                        # unchanged
├── src/renderer/
│   ├── index.html                      # ~ + <base id="content-base" href="">
│   └── renderer.js                     # ~ set base.href before innerHTML
└── tests/
    ├── unit/baseUrlForFile.test.ts               # NEW
    ├── integration/preload-api-contract.test.ts   # ~ extended, existing file
    └── e2e/
        ├── (new spec, e.g. relative-images.spec.ts — engineer's call on filename)
        └── fixtures/with-image/
            ├── doc.md                              # NEW — references ./img/sample.png
            └── img/sample.png                      # NEW — minimal valid 1x1 PNG
```

### Fixture generation note

The PNG must be a real, valid, decodable image (Playwright's `naturalWidth > 0` check demands it — a placeholder text file renamed `.png` would correctly fail this test, which is the point). Generate it by decoding a well-known minimal 1x1 PNG base64 payload via `Buffer.from(base64, 'base64')` and writing the raw bytes with Node's `fs.writeFileSync` (via Bash, not the Write tool — Write is for text content, and base64-decoding to raw binary needs an actual `Buffer`) — don't hand-construct PNG chunk bytes/CRCs manually, use a well-known constant.

### Honest limitation, stated explicitly (same caveat as Task 2's original preload-contract test)

`FileRenderedOk`/`FileRenderedError` are TypeScript interfaces — erased at compile time, no runtime representation. The integration test extension can't runtime-assert "the type has a `baseUrl` field" the way it can assert `IPC_CHANNELS`' string constants. The honest approach: construct a literal object with an explicit `: FileRenderedOk` type annotation including `baseUrl`, and assert a trivial property-access on it. Real protection against "field silently removed from the interface" comes from `tsc --strict` (part of `npm run build`), not from this Vitest assertion alone — the test's value is proving the shape is *usable* as claimed, not catching a missing field via runtime alone. State this plainly rather than presenting the test as stronger evidence than it is.

### Applying the Task 3 drift-flag learning

Before declaring done, the engineer should explicitly check every guardrail in `functional_domain.md`'s Task 4 section against the test suite ("guardrail says X must be tested — which test proves X?") rather than relying on the review pass to catch a gap, per the process note raised after Task 3's two consecutive first-pass Blocked verdicts.

### Addendum: guardrail #3 needs a different test level entirely (discovered mid-review, empirically confirmed, user-approved)

**Finding, empirically proven, not theorized.** The reviewer fault-injected the delivered code (swapped `baseElement.href = baseUrl` and `container.innerHTML = html` in `renderer.js`, rebuilt, ran the e2e test 4 times) and it stayed green against the broken order. The engineer then tried the reviewer's own suggested alternative (Playwright request-interception, asserting the resolved image URL) against the same broken-order build — also 4/4 green. **Root cause, confirmed by both experiments**: the actual image fetch/network request fires on a later task/tick than the synchronous script block containing both statements. By the time either observable (image `load` event, or the network request itself) fires, `base.href` already holds its final value regardless of which of the two synchronous statements ran first. This guardrail's failure mode has **no observable effect at browser/e2e timing granularity** in this Electron/Chromium version — not via image-load completion, not via network-request timing. Any e2e-level test of this specific guardrail is structurally incapable of catching a regression here, no matter how it's dressed up.

**Decision (Lead + user):** move this guardrail's verification down one test level — a direct unit test of call *order*, independent of browser scheduling entirely, rather than continuing to chase an e2e-level proof that cannot exist for this failure mode.

**Implementation — keep `renderer.js` "plain JS, no build step" for the browser, make the ordering unit-testable via a minimal UMD-style export:**

```js
// src/renderer/renderer.js — extracted, testable core
function applyRenderedContent(html, baseUrl, setBaseHref, setInnerHtml) {
  setBaseHref(baseUrl);
  setInnerHtml(html);
}

// renderHtml() (existing, DOM-facing) now delegates to this:
function renderHtml(html, baseUrl) {
  applyRenderedContent(
    html,
    baseUrl,
    (url) => { baseElement.href = url; },
    (markup) => { container.innerHTML = markup; }
  );
}

// ... rest of the file (onFileRendered wiring, open-button handler) unchanged ...

// No-op in the browser (there is no `module` global there); lets Vitest
// `require()` this file under Node without needing jsdom, a bundler, or
// converting the file to an ES module the <script> tag would need updating for.
if (typeof module !== 'undefined') {
  module.exports = { applyRenderedContent };
}
```

New test: `tests/unit/renderer-order.test.ts` — `require('../../src/renderer/renderer.js')` (or equivalent import), call `applyRenderedContent` with two spy functions in place of `setBaseHref`/`setInnerHtml`, and assert they were invoked in the order `['base', 'html']` (or equivalent call-order proof). This is deterministic and immune to whatever the browser's actual fetch-scheduling behavior is or ever becomes — it verifies the *source code's own statement sequence*, which is the thing actually under the engineer's control and the thing a future refactor could actually get wrong.

**The existing `tests/e2e/relative-images.spec.ts` (`naturalWidth`-based) is kept as-is** — it's real, valuable coverage that the base-URL mechanism works end-to-end (a relative image genuinely resolves and loads against the open file's directory, not `dist/renderer/`), it's just not proof of the ordering guardrail specifically, and the file should carry a comment saying so plainly (already added during the investigation) so a future reader doesn't mistake it for stronger evidence than it is.

**Scope amendment**: one new path added to the Task 4 scope contract — `tests/unit/renderer-order.test.ts`. No other file changes needed beyond what was already granted (`renderer.js` was already in scope).

---

## Task 5 Technical Specification — External Link Handling

Maps `functional_domain.md`'s Task 5 analysis to concrete design.

### The Inward Dependency Rule

- `src/main/linkPolicy.ts` is a fourth pure leaf module, same tier as `markdown.ts`/`paths.ts`/`watcher.ts`'s classifier half — zero Electron import, zero fs, uses only the `URL` global. `index.ts` orchestrates by calling it from two `webContents` event handlers, same role it already plays for `markdownToHtml`/`baseUrlForFile`.
- No renderer involvement, no preload involvement — this task's entire diff lives in main, which is itself informative: not every feature needs to touch the IPC boundary, and forcing one here (e.g. a "link clicked" message to the renderer) would be an invented indirection with no purpose.

### SOLID Boundary Scan

- **SRP** — `isExternalHttpUrl` classifies, it does not decide what to *do* with a URL (open it, ignore it) — that decision stays in `index.ts`'s two event handlers, which is where "call `shell.openExternal`" or "do nothing" actually belongs.
- **OCP** — the allowlist (`http:`/`https:`) can grow (e.g. `mailto:` someday) by editing exactly one function, with zero changes to either call site.

### Pattern note

No new GoF pattern — `isExternalHttpUrl` is a Guard/Predicate in the same "pure wrapper around a built-in" family as `baseUrlForFile` (wraps `url.pathToFileURL`) and `markdownToHtml` (wraps `markdown-it`), here wrapping the `URL` constructor.

### Exact signature (authoritative)

```ts
// src/main/linkPolicy.ts
export function isExternalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
```

### `index.ts` wiring

Registered once, inside `createWindow()`, alongside the `BrowserWindow` construction — not inside `renderFile`/`renderAndWatch`/any per-render path, and not re-registered on every window (each call to `createWindow()` naturally scopes the listeners to that window's own `webContents`, which is correct — Task 3's `activate` handler already calls `createWindow()` again if all windows closed, so each new window gets its own pair of listeners exactly once):

```ts
mainWindow.webContents.on('will-navigate', (event, url) => {
  event.preventDefault(); // unconditional, before any classification — guardrail #2
  if (isExternalHttpUrl(url)) {
    shell.openExternal(url);
  }
});

mainWindow.webContents.setWindowOpenHandler(({ url }) => {
  if (isExternalHttpUrl(url)) {
    shell.openExternal(url);
  }
  return { action: 'deny' }; // always deny in-process handling, regardless of classification
});
```
`shell` imported from `'electron'` alongside the existing `app`, `BrowserWindow`, `dialog`, `ipcMain` imports.

### File tree — Task 5 additions/changes

```
md-view/
├── src/main/
│   ├── linkPolicy.ts                  # NEW — isExternalHttpUrl (pure)
│   ├── index.ts                        # ~ will-navigate + setWindowOpenHandler in createWindow()
│   ├── markdown.ts, watcher.ts,        # unchanged
│   │   windowConfig.ts, paths.ts
├── (no preload or renderer changes — interception happens before the renderer is involved)
└── tests/
    ├── unit/isExternalHttpUrl.test.ts             # NEW — case table, see below
    └── e2e/
        ├── external-links.spec.ts                  # NEW
        └── fixtures/with-links/doc.md               # NEW — one valid https link + one
                                                        #   malformed link (the exact
                                                        #   real-bug pattern)
```

### Unit test — exact case table

`tests/unit/isExternalHttpUrl.test.ts` must cover, at minimum: `'https://example.com'` → `true`; `'http://example.com'` → `true`; `'javascript:alert(1)'` → `false`; `'./relative.md'` → `false` (this one exercises the `catch` branch — `new URL()` throws on a bare relative path with no base); `'file:///etc/passwd'` → `false` (a *valid* URL, exercises the protocol-check-false branch, not the catch branch — worth having both kinds of `false` covered distinctly); and `'"https://google.com"'` (literal leading/trailing quote characters) → `false` — this exact string is the real string markdown-it produces from the real bug's source pattern (`[text]("url")`, no space before the quote, so markdown-it reads the quotes as part of the href itself rather than as a title) — this is not a synthetic edge case, it's the literal reproduction of the manually-found bug.

### Fixture — `tests/e2e/fixtures/with-links/doc.md`

```md
# Link Fixture

[External Example](https://example.com)

[Malformed Link]("https://blocked.example.com")
```
Two links in one small fixture: the first exercises the "external URL correctly handed to the OS, app doesn't navigate" case; the second reproduces the real bug's exact markdown pattern and exercises "malformed href, nothing happens — no external open, no in-app navigation."

### e2e test design

Mock `shell.openExternal` via `electronApp.evaluate()` **before** the click, same established pattern as mocking `dialog.showOpenDialog` in earlier tasks — store received URLs in a `globalThis`-scoped array inside the main process so a second `evaluate()` call after the click can retrieve what was captured. Two separate test cases (not one test asserting both, for isolation): (1) click the valid link, assert the mock captured the URL (allow for Chromium's own URL normalization, e.g. a trailing slash — don't hardcode an assumption about exact string equality if the actual delivered value differs in a normalization-only way) and assert `#content`'s rendered text/HTML is unchanged before vs. after the click (the app didn't navigate); (2) click the malformed link, assert the mock captured *zero* calls and `#content` is equally unchanged.

### Honest limitation, stated explicitly (same standard as Task 2's/Task 4's caveats)

`setWindowOpenHandler` cannot be exercised by any test in this suite — `html:false` means no rendered link can carry `target="_blank"`, so `window.open()`/new-window navigation is not a reachable code path today. It is still correctly wired (same classification function, same fail-safe deny), but the delivered test suite should say so plainly rather than construct an artificial scenario (e.g. directly invoking the handler function outside its real trigger path) that would look like coverage without being drawn from anything a real user or real Markdown file can produce.

---

## Task 6 Technical Specification — Syntax Highlighting for Code Blocks

Maps `functional_domain.md`'s Task 6 analysis to concrete design.

### Visual baseline check (empirical, not assumed)

Windows OS-level theme is set to dark (`AppsUseLightTheme=0`), but launching the built app (Playwright `_electron`, screenshot of the real window) shows the rendered `.markdown-body` in **light** colors regardless — the running BrowserWindow is not currently following the OS dark-mode signal. Confirmed by direct observation, not inferred from `github-markdown-css`'s CSS source (which does define a `prefers-color-scheme: dark` branch that theoretically could apply). Since the app *actually renders* light today, the highlight.js theme must match the light rendering a user actually sees, not a dark mode that exists in CSS but isn't currently reachable in this app's window.

### The Inward Dependency Rule

- `src/main/markdown.ts` remains the sole module importing `markdown-it` (Task 2's boundary) and becomes, additionally, the sole module importing `highlight.js` — both third-party libraries stay behind this one Adapter file. Nothing else in the codebase (main, preload, renderer) ever imports either library directly.
- The new pure function `highlightCode(code, lang): string` is passed as the `highlight` option to MarkdownIt's constructor — this is dependency injection into a third-party library's extension point, not a new outward dependency of `markdown.ts` on anything beyond what it already had.

### SOLID Boundary Scan

- **SRP** — `highlightCode` does exactly one thing: given code text and a language token, decide highlighted-vs-plain and produce the resulting markup fragment. It has no knowledge of documents, fences, or MarkdownIt's rendering pipeline beyond the narrow callback contract it fulfills.
- **OCP** — swapping the visual theme later is a zero-code-change operation (edit which CSS file `package.json`'s build script copies + which `<link>` `index.html` points at) — `highlightCode`'s logic is theme-agnostic, it only ever emits semantic `hljs-*` class names, never inline colors.
- **DIP** — `markdown.ts` depends on `highlight.js`'s public API (`hljs.getLanguage`, `hljs.highlight`) exactly the way it already depends on `markdown-it`'s public API — both are peripheral libraries the domain-ish core wraps, not the reverse.

### Pattern Application (GoF)

- **Adapter** — `highlightCode` plays the exact same role for `highlight.js` that `markdownToHtml` already plays for `markdown-it`: the one narrow function wrapping a third-party library so nothing else in the codebase needs to know that library's API shape. This is the fifth pure/near-pure wrapper function in the codebase, alongside `markdownToHtml`, `classifyWatchEvent`, `baseUrlForFile`, `isExternalHttpUrl`.
- No new pattern needed for the "recognized vs. unrecognized language" branch — it's a plain conditional inside one small function, not a variability point that justifies Strategy/Command.

### Exact signature and wiring (authoritative)

```ts
// src/main/markdown.ts
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

function highlightCode(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang }).value;
    } catch {
      return '';
    }
  }
  return '';
}

const md = new MarkdownIt({ html: false, highlight: highlightCode });
```

**Why returning `''` is correct, not a shortcut.** MarkdownIt's fence renderer contract: if the `highlight` callback returns a truthy string, MarkdownIt uses it as-is (already-escaped HTML) inside `<pre><code class="hljs language-{lang}">`; if it returns a falsy value, MarkdownIt falls back to its own built-in escaping (`utils.escapeHtml`) and renders plain `<pre><code>` with no highlight classes. Returning `''` for both "no language" and "unrecognized language" delegates the plain-text-escaping guarantee to MarkdownIt's own already-tested default path, rather than reimplementing escaping a second time in `markdown.ts` — one less place the html-escaping invariant could drift. `hljs.highlight(...).value` itself HTML-escapes the source text as an intrinsic part of tokenizing it (this is fundamental to how highlight.js works — it never emits raw user text unescaped), which is what makes guardrail #3 (fence content always literal) hold in the highlighted branch too. The `try/catch` around `hljs.highlight` is defense-in-depth for guardrail #2 (never throw) — `getLanguage` already filters to registered languages before `highlight` is called, so the catch is expected to be dead code in practice, not a substitute for the `getLanguage` check.

### Theme choice: `highlight.js`'s `github.css` (light)

Chosen because (a) the app's actual running window renders light right now (confirmed above, not assumed), and (b) `github.css` is highlight.js's own GitHub-flavored light theme, sharing the same visual design language as `github-markdown-css` (same muted grays, same monospace treatment) already governing every other part of the rendered document — no other bundled highlight.js theme is purpose-built to sit next to GitHub's own markdown styling. A light/dark auto-switching pair is explicitly **not** attempted: the scope contract calls for a single `<link>` and a single copied CSS file (mirroring the existing `github-markdown-css` copy step), and `renderer.js`/`index.html`'s script wiring are otherwise off-limits this task — wiring a `prefers-color-scheme`-driven theme swap would need either JS logic (out of scope: "cero wiring nuevo en el renderer") or hand-authoring a custom CSS file gated by a media query (not "the theme's CSS file," a fabricated one) — both overreach what was asked. Flagged here, not fixed: if the app's window ever does start honoring OS dark mode, code blocks would go light-on-dark until a follow-up task pairs `github-dark.css` behind a media query — same "flag, don't silently fix out-of-scope" discipline as Task 3's packaging-files note.

### File tree — Task 6 additions/changes

```
md-view/
├── package.json                       # + dependency: highlight.js (runtime, not dev — main
│                                       #   process requires it at render time, same reasoning
│                                       #   as markdown-it/github-markdown-css in Task 2)
│                                       # ~ build script: + copy
│                                       #   node_modules/highlight.js/styles/github.css
│                                       #   -> dist/renderer/github.css (same pattern as the
│                                       #   existing github-markdown.css copy step)
├── src/main/
│   └── markdown.ts                    # ~ + highlightCode, MarkdownIt constructor gains
│                                       #   `highlight: highlightCode`
├── src/renderer/
│   └── index.html                     # ~ + <link rel="stylesheet" href="./github.css">
│                                       #   (renderer.js untouched — highlighted HTML flows
│                                       #   through the existing innerHTML assignment)
└── tests/
    ├── unit/markdown.test.ts          # ~ extended, existing file — see cases below
    └── e2e/
        ├── (new spec, e.g. code-highlighting.spec.ts — engineer's call on filename)
        └── fixtures/with-code/doc.md  # NEW — fence with a recognized language (e.g. ```js)
```

### Unit test cases — exact list (extends `tests/unit/markdown.test.ts`)

1. Fence with a supported declared language (e.g. ` ```js `) → output contains real `hljs-*` token classes (e.g. `hljs-keyword`, `hljs-string`) — not just a `<pre><code>` wrapper with plain text. Asserting the wrapper alone would pass even if highlighting silently no-op'd; the test must look for actual `hljs-` class evidence.
2. Fence with no declared language (` ``` ` alone) → output is escaped plain text, and contains **no** `hljs` or `language-` class anywhere — proving no auto-detection ran, not merely that *a* result was produced.
3. Fence with a declared but unrecognized language (e.g. ` ```notarealtonguage `) → does not throw, output is escaped plain text (same shape as case 2).
4. Security regression (guardrail #3): a fence containing literal `<script>alert(1)</script>` as code content — tested through **both** a recognized-language fence and a no-language fence — must appear as `&lt;script&gt;alert(1)&lt;/script&gt;` (or equivalent fully-escaped form) in the final HTML in both cases, never as a live tag. This is the explicit test the task calls for; it must not be inferred from cases 1–3 passing.

### e2e test — exact shape

`tests/e2e/fixtures/with-code/doc.md` contains at least one fence with a recognized language. The new spec launches the built app against that fixture (same `_electron.launch` + argv pattern as `open-file-argv.spec.ts`) and asserts, against the real DOM: an element matching `.hljs-keyword` (or whichever token class the chosen fixture's language/content actually produces — verify empirically during TDD rather than guessing the exact class) exists inside `#content`. This is the proof that (a) the HTML string truly contains highlight markup and (b) `dist/renderer/github.css` was actually copied and loaded by the running window — a CSS-only failure (classes present, stylesheet missing) wouldn't be caught by the unit tests above, which never load a stylesheet.

### Addendum: `npm test` (bare command) validation — not part of this task's code scope

The user manually added a `"test": "npm run test:all"` script to `package.json` after Task 5, to fix `run-tests-if-src.mjs` failing with "missing script" on every `src/**` edit since Task 1. Since this task edits `src/main/markdown.ts`, that hook fires again regardless. Per explicit user instruction, run bare `npm test` (not `npm run test:all`) once the implementation lands, and report in the closing summary whether it runs the full suite without the missing-script error — a validation step, not a deliverable of this task's scope contract.

---

## Task 7 Technical Specification — UI Shell Polish

Maps `functional_domain.md`'s Task 7 analysis to concrete design.

### The Inward Dependency Rule

- `src/main/menu.ts` is a new peripheral-boundary module, same tier as
  `linkPolicy.ts`/`watcher.ts`/`paths.ts`: it exports one pure function
  (`buildMenuTemplate`) that depends on nothing from Electron — it takes a plain
  handler object in and returns a plain data structure (`MenuItemConstructorOptions[]`)
  out. The impure calls that turn that data into a real OS menu
  (`Menu.buildFromTemplate`, `Menu.setApplicationMenu`) stay in `src/main/index.ts`,
  which is already the composition-root file wiring every other peripheral module
  together (`markdown.ts`, `watcher.ts`, `paths.ts`, `linkPolicy.ts`).
- The dialog → renderAndWatch orchestration currently inlined inside the
  `ipcMain.on(OPEN_FILE_DIALOG, ...)` handler is extracted to a named function in
  `index.ts` (e.g. `openFileViaDialog`). Both the removed IPC handler's old body and
  the new menu's `click` handler become callers of this one function — this is the
  concrete mechanism satisfying functional_domain.md guardrail #2 ("exactly one
  shared code path"), not a promise kept only in prose.
- `src/renderer/renderer.js` gains one new pure function (`statusBarText`) following
  the exact module shape `applyRenderedContent` already established: a plain
  function of its arguments, with the existing `typeof document` / `typeof module`
  guard pattern keeping it importable under plain Node for unit tests with zero DOM.
  No new outward dependency is introduced by the renderer at any point — it still
  only ever consumes `window.mdview.onFileRendered`, never a new bridge method.

### SOLID Boundary Scan

- **SRP** — `buildMenuTemplate` does exactly one thing: describe menu structure
  given a handler. It does not know how to open a dialog, render a file, or start
  a watcher — those remain `index.ts`'s and `renderFile`/`watchFile`'s
  responsibilities respectively. `statusBarText` does exactly one thing: map a
  `FileRenderedMessage | null` to a display string — it does not touch the DOM
  itself (that's `renderer.js`'s guarded top-level block, same division of labor
  `applyRenderedContent` already models for rendered content).
- **OCP** — Adding a future menu item (e.g. a "Recent Files" submenu) is a change
  localized to `buildMenuTemplate`'s returned array; `index.ts`'s wiring
  (`Menu.buildFromTemplate(buildMenuTemplate(...))`) does not need to change shape
  to accommodate it.
- **ISP** — `BridgeApi` shrinks, it does not grow: removing `openFileDialog()` is
  the interface-segregation direction working correctly — the renderer no longer
  needs to depend on a method it has no reason to call anymore. This is the same
  discipline as Task 5's allowlist-not-denylist choice: an interface should expose
  exactly what its consumer needs, no more.
- **DIP** — `index.ts`'s menu wiring depends on `buildMenuTemplate`'s abstract
  return shape (a plain template array), not on any concrete detail of *how* Open
  or Exit are triggered internally. `buildMenuTemplate` itself depends on nothing
  concrete — its only "dependency" is the `{ onOpen }` handler shape passed in,
  which is the inversion: the peripheral (menu structure) depends on an abstraction
  the composition root supplies, not the reverse.

### Pattern Application (GoF)

- **Adapter, again** — `buildMenuTemplate` plays the same role for Electron's
  `Menu` API that `markdownToHtml`/`highlightCode`/`baseUrlForFile`/`isExternalHttpUrl`
  already play for their respective libraries: a narrow, pure wrapper isolating a
  third-party/platform API shape from the rest of the codebase, and made testable
  without a real Electron runtime. This is the sixth such function, per the task's
  own numbering.
- **Command (implicit, not hand-rolled)** — `Menu.buildFromTemplate`'s `click`
  handlers are themselves already Electron's built-in Command pattern (an object
  encapsulating an action to invoke later); `buildMenuTemplate` supplies the
  callback, it does not need to introduce a hand-rolled Command class on top of
  what Electron already provides — that would be a redundant abstraction over an
  abstraction.
- No new pattern justified for the status bar or empty-state message — both are
  plain conditional string/visibility derivations, not a variability point that
  would justify Strategy/State/Observer machinery.

### Exact signatures and wiring (authoritative)

```ts
// src/main/menu.ts
import type { MenuItemConstructorOptions } from 'electron';

export function buildMenuTemplate(handlers: { onOpen: () => void }): MenuItemConstructorOptions[] {
  return [
    {
      label: 'File',
      submenu: [
        { id: 'menu-open', label: 'Open…', accelerator: 'CmdOrCtrl+O', click: handlers.onOpen },
        { type: 'separator' },
        { id: 'menu-exit', label: 'Exit', role: 'quit' },
      ],
    },
  ];
}
```

```ts
// src/main/index.ts additions (illustrative, engineer owns exact placement/naming)
import { Menu, ... } from 'electron';
import { buildMenuTemplate } from './menu';

async function openFileViaDialog(): Promise<void> {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  await renderAndWatch(result.filePaths[0]);
}

// in app.whenReady().then(...) or createWindow():
Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate({ onOpen: openFileViaDialog })));

mainWindow.webContents.on('before-input-event', (event, input) => {
  if (app.isPackaged) return;
  const isDevToolsShortcut =
    input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i');
  if (isDevToolsShortcut) {
    mainWindow?.webContents.toggleDevTools();
  }
});
```

```js
// src/renderer/renderer.js addition, alongside applyRenderedContent
function statusBarText(message) {
  if (!message || !message.filePath) return 'No file open';
  return message.filePath;
}
```

**Contract, not engineer discretion: the status bar element is updated exclusively
via `statusBarEl.textContent = statusBarText(message)`, never `.innerHTML`.**
`filePath` is an OS-provided filesystem path (dialog selection or argv), not
Markdown-derived content, so there is no active exploit surface today — but
`functional_domain.md`'s guardrail #4 calls this out as defense-in-depth
regardless, and the whole point of stating it here, in the authoritative wiring
example, is that it is fixed by this spec and not left as a judgment call the
engineer could resolve either way while still satisfying the task description in
prose.

**Why `role: 'quit'` for Exit, not a hand-rolled `click: () => app.quit()`.** Electron's
built-in `role` mechanism already implements "terminate the app" correctly across
platforms (respecting `before-quit` hooks, which `stopWatching` is already registered
against) — reimplementing it with an explicit `click` handler would be redundant
code duplicating a platform-provided Command for no behavioral gain. `id: 'menu-exit'`
is still supplied alongside the role, satisfying the e2e-lookup requirement without
conflicting with it.

**Why `before-input-event` on `webContents`, not a global shortcut or a hidden menu
item.** A global `accelerator`-based shortcut would register at the OS/Electron
Menu layer, which the app deliberately no longer has a hidden entry for (the task
explicitly forbids a menu item under any condition); `before-input-event` intercepts
key events scoped to this window's `webContents` only, which is the narrowest
mechanism that satisfies "safety net for a lost default menu" without resurrecting
any of the surface being removed.

### File tree — Task 7 additions/changes

```
md-view/
├── package.json                       # ~ build script: + copy src/renderer/app.css
│                                       #   -> dist/renderer/app.css (same copyFileSync
│                                       #   pattern as github.css/github-markdown.css)
├── src/main/
│   ├── menu.ts                        # NEW — buildMenuTemplate (pure)
│   └── index.ts                       # ~ + Menu wiring, + openFileViaDialog extraction,
│                                       #   + before-input-event DevTools listener,
│                                       #   - ipcMain.on(OPEN_FILE_DIALOG, ...) removed
├── src/preload/
│   ├── api.ts                         # ~ - OPEN_FILE_DIALOG from IPC_CHANNELS,
│                                       #   - openFileDialog from BridgeApi
│   └── index.ts                       # ~ - openFileDialog implementation
├── src/renderer/
│   ├── index.html                     # ~ - <h1>, - #open-file-btn, + empty-state element,
│                                       #   + status bar element, + <link app.css>
│   ├── renderer.js                    # ~ + statusBarText, + empty-state hide-on-first-message
│                                       #   wiring, + status bar update wiring,
│                                       #   - open-file-btn click listener
│   └── app.css                        # NEW — #content padding-inline, status bar fixed
│                                       #   positioning, empty-state styling
└── tests/
    ├── integration/preload-api-contract.test.ts   # ~ - both OPEN_FILE_DIALOG assertions
    ├── unit/
    │   ├── menu.test.ts                # NEW
    │   └── statusBarText.test.ts       # NEW
    └── e2e/
        ├── ui-shell.spec.ts            # NEW
        ├── open-file-argv.spec.ts      # ~ non-.md dialog test: button click -> menu click
        └── live-reload.spec.ts         # ~ watcher-handoff test: button click -> menu click
```

### Unit test cases — exact list

`tests/unit/menu.test.ts`:
1. Returns exactly one top-level item (`File`) whose `submenu` has exactly 3
   entries: `menu-open`, a separator, `menu-exit`.
2. `menu-open` has `label: 'Open…'` (or equivalent), `accelerator: 'CmdOrCtrl+O'`,
   and its `click` is reference-equal to the `onOpen` handler passed in (proves
   wiring without invoking real Electron `Menu`).
3. The separator entry has `type: 'separator'`.
4. `menu-exit` has `label: 'Exit'` and `role: 'quit'` (or is otherwise provably
   wired to quit — engineer's call on exact assertion given `role`-based items
   don't carry a `click`).

`tests/unit/statusBarText.test.ts`:
1. `null` → `'No file open'`.
2. `{ ok: true, filePath: '/a/b.md', html: '', baseUrl: '' }` → `'/a/b.md'`.
3. `{ ok: false, filePath: null, error: 'x' }` → `'No file open'`.
4. `{ ok: false, filePath: '/a/b.md', error: 'x' }` → `'/a/b.md'`.

### Integration test change

`tests/integration/preload-api-contract.test.ts`: remove the two
`IPC_CHANNELS.OPEN_FILE_DIALOG` assertions inside the "exposes non-empty string
channel names" test (per functional_domain.md guardrail #1 — this is proof of
complete, intentional removal, not a leftover red test). The `FILE_RENDERED`
assertions and the distinct-channel-names test stay, adjusted only if removing one
side of the distinctness check leaves it meaningless (engineer's call — if only one
channel remains, that specific assertion has nothing left to prove and should be
removed too, not contorted to keep a two-sided comparison alive artificially).

### e2e test — exact shape

`tests/e2e/ui-shell.spec.ts` (new):
a) Launch with no argv file (`open-file-argv.spec.ts`'s pattern, no file path in
   `args`). Assert `h1` and `#open-file-btn` are absent from the DOM, the
   empty-state text is visible, and the status bar shows "No file open".
b) Launch with `tests/e2e/fixtures/sample.md` via argv (`open-file-argv.spec.ts`'s
   existing pattern). Assert the empty-state text is gone and the status bar's text
   equals the fixture's real absolute path.
c) After (b)'s render, assert `#content`'s computed `padding-inline` (or the
   longhand `padding-left`/`padding-right` pair, whichever Playwright's
   `getComputedStyle` access pattern makes cleaner) is non-zero.
d) After (b)'s render, assert the status bar element's `innerHTML === textContent`
   — cheap, direct proof that the element's content was set via `textContent`
   (no HTML got parsed there), not merely that the visible string looks right.
   This is the test-level enforcement of the `textContent`-only contract stated
   above, not a redundant restatement of case (b)'s path-text assertion.

`open-file-argv.spec.ts`'s "non-.md file selected via the dialog" test: replace
`await window.click('#open-file-btn')` with driving the menu item directly, e.g.
`await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click())`.
Same replacement in `live-reload.spec.ts`'s "closes the previous file's watcher on
switch" test. Neither test's assertions, fixtures, or mocked `dialog.showOpenDialog`
setup change — only the trigger line.

### Addendum: `npm test` validation

Same standing instruction as Task 6's addendum — run bare `npm test` after
implementation lands and report whether it completes without the missing-script
error, as a validation step outside this task's code scope.

---

## Task 8 Technical Specification — Dark Mode, Frontmatter Visibility, Bottom Margin

Maps `functional_domain.md`'s Task 8 analysis to concrete design.

### Verification performed before committing to this design

Confirmed by direct `ls` of the already-installed packages (not assumed from
package names or changelogs): `node_modules/github-markdown-css/` ships
`github-markdown-light.css` and `github-markdown-dark.css` alongside the
existing `github-markdown.css`; `node_modules/highlight.js/styles/` ships
`github-dark.css` alongside the existing `github.css`. No `package.json`
dependency changes are needed — same empirical-verification discipline Task 6
established for its theme choice.

### The Inward Dependency Rule

- `src/main/frontmatter.ts` joins `src/main/markdown.ts`'s tier as a sibling
  leaf module — pure, zero Electron import, zero I/O, importable and testable
  in complete isolation. Unlike `markdown.ts`/`menu.ts`'s prior five pure
  functions, this one wraps no third-party library at all; it is plain domain
  logic with no adapter role, and the spec says so explicitly rather than
  forcing an Adapter framing where none applies.
- `markdown.ts` remains completely unaware that frontmatter exists. `index.ts`
  calls `extractFrontmatter` first and hands only the `body` half to
  `markdownToHtml` — the split happens at the orchestration layer, one level
  above both leaf modules, so neither leaf needs to know about the other.
  Same discipline Task 4 used to keep `markdown.ts` unaware of paths/URLs.
- `src/preload/api.ts` gains a second IPC message type (`ViewSettings`) and a
  second channel (`VIEW_SETTINGS`), still the single shared abstraction both
  `main/index.ts` and `preload/index.ts` depend on — neither side hardcodes
  the other's channel string or payload shape, same DIP-at-the-process-boundary
  established in Task 2 and extended in every task since.
- `src/renderer/renderer.js` still only ever touches `window.mdview` — two
  subscriptions now (`onFileRendered`, `onViewSettings`) instead of one, never
  a new kind of outward dependency.

### SOLID Boundary Scan

- **SRP** — `extractFrontmatter` does exactly one thing: find the boundary and
  split. It does not decide whether to *display* the result — that's
  `shouldShowFrontmatter`'s job — and it does not touch the DOM — that's
  `renderer.js`'s guarded block's job. Three separate responsibilities, three
  separate places, matching the division of labor already established between
  `markdownToHtml`, `statusBarText`, and the guarded DOM-wiring block.
- **OCP** — Adding a third View-menu toggle later extends `ViewSettings`,
  `buildMenuTemplate`'s submenu array, and one new `renderer.js` handler — it
  does not require restructuring `extractFrontmatter`, `shouldShowFrontmatter`,
  or the IPC contract's existing members.
- **ISP** — `BridgeApi` grows by exactly one member (`onViewSettings`),
  mirroring `onFileRendered`'s exact shape (a channel subscription taking a
  typed callback). Nothing existing widens; `renderer.js` still only depends
  on the two subscriptions it actually uses.
- **DIP** — `index.ts`'s menu wiring depends on `buildMenuTemplate`'s abstract
  template-array return and the `ViewSettings` shape, not on any concrete
  detail of how dark mode is eventually painted. `renderer.js` depends on the
  `ViewSettings`/`FileRenderedMessage` shapes delivered over the bridge, not
  on how `index.ts` decided to construct them.

### Pattern Application (GoF)

- **No Adapter here — an honest limitation, stated rather than papered over.**
  Every prior pure function in this codaebase (`markdownToHtml`,
  `classifyWatchEvent`, `baseUrlForFile`, `isExternalHttpUrl`, `highlightCode`,
  `buildMenuTemplate`) wraps a third-party or platform API. `extractFrontmatter`
  wraps nothing — it is the project's first pure function that is plain domain
  logic with no library being adapted. Forcing an "Adapter" label onto it would
  misdescribe what it does; it is simply correctly-isolated business logic,
  which is its own justification without needing a GoF label attached.
- **Observer, applied a second time, not introduced new.** `ViewSettings` over
  `VIEW_SETTINGS` is the same main-pushes/renderer-subscribes shape Task 2
  already established for `FILE_RENDERED`. This task doesn't add a new
  communication pattern to the codebase, it reuses the existing one for a
  second, independent kind of fact — exactly what `functional_domain.md`'s
  Abstract Schema Contracts section argues for keeping them on separate
  channels rather than folding one into the other.
- **`buildMenuTemplate`'s Adapter role (Task 7) is unchanged in kind, only
  extended in surface** — still a pure wrapper isolating Electron's `Menu`
  API shape, now describing two top-level menus and two checkbox items
  instead of one.

### Exact signatures and wiring (authoritative)

```ts
// src/main/frontmatter.ts
export interface FrontmatterSplit {
  frontmatter: string | null;
  body: string;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function extractFrontmatter(source: string): FrontmatterSplit {
  const match = source.match(FRONTMATTER_PATTERN);
  if (!match) {
    return { frontmatter: null, body: source };
  }
  return { frontmatter: match[1], body: source.slice(match[0].length) };
}
```

**Why the anchored regex, not a line-by-line scan.** `^---\r?\n` anchors the
opening fence to the literal start of the string (not `multiline` mode, no
`m` flag) — a `---` appearing anywhere else in the document (e.g. as a
horizontal rule mid-document) can never be mistaken for the *opening* fence,
only the two fence lines immediately bounding position 0 matter. The
non-greedy `[\s\S]*?` before the mandatory `\r?\n---\r?\n?` closing fence means
an unterminated leading `---` (no second `---` line anywhere in the document)
simply fails to match at all — `match` is `null`, and the function returns
`{ frontmatter: null, body: source }` unchanged, satisfying guardrail #2's
fail-closed requirement structurally, not via a special-cased check.
`frontmatter` is the raw text *between* the two fence lines (group 1) — the
delimiters themselves are not included, since what's displayed to the user
should be the metadata content, not the punctuation marking its boundaries.

```ts
// src/main/menu.ts — extended
import type { MenuItemConstructorOptions } from 'electron';

export interface ViewSettings {
  darkMode: boolean;
  showFrontmatter: boolean;
}

export interface MenuHandlers {
  onOpen: () => void;
  onToggleDarkMode: (checked: boolean) => void;
  onToggleShowFrontmatter: (checked: boolean) => void;
}

export function buildMenuTemplate(
  handlers: MenuHandlers,
  initialViewSettings: ViewSettings
): MenuItemConstructorOptions[] {
  return [
    {
      label: 'File',
      submenu: [
        { id: 'menu-open', label: 'Open…', accelerator: 'CmdOrCtrl+O', click: handlers.onOpen },
        { type: 'separator' },
        { id: 'menu-exit', label: 'Exit', role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          id: 'menu-dark-mode',
          label: 'Dark Mode',
          type: 'checkbox',
          checked: initialViewSettings.darkMode,
          click: (menuItem) => handlers.onToggleDarkMode(menuItem.checked),
        },
        {
          id: 'menu-show-frontmatter',
          label: 'Show Frontmatter',
          type: 'checkbox',
          checked: initialViewSettings.showFrontmatter,
          click: (menuItem) => handlers.onToggleShowFrontmatter(menuItem.checked),
        },
      ],
    },
  ];
}
```

`handlers` grows from one required member to three (`onOpen` unchanged in
meaning); existing callers must supply all three or fail to compile —
intentional, `MenuHandlers` is a named type specifically so this breaking
change is caught by `tsc`, not discovered at runtime.

```ts
// src/main/index.ts additions (illustrative — engineer owns exact placement)
import { extractFrontmatter } from './frontmatter';
import { buildMenuTemplate } from './menu';
import type { ViewSettings } from './menu';

let viewSettings: ViewSettings = { darkMode: false, showFrontmatter: true };

function broadcastViewSettings(): void {
  mainWindow?.webContents.send(IPC_CHANNELS.VIEW_SETTINGS, viewSettings);
}

function setDarkMode(checked: boolean): void {
  viewSettings = { ...viewSettings, darkMode: checked };
  broadcastViewSettings();
}

function setShowFrontmatter(checked: boolean): void {
  viewSettings = { ...viewSettings, showFrontmatter: checked };
  broadcastViewSettings();
}

// renderFile() gains one line ahead of the existing markdownToHtml call:
async function renderFile(filePath: string): Promise<FileRenderedMessage> {
  if (!filePath.toLowerCase().endsWith('.md')) {
    return { ok: false, filePath, error: 'Not a Markdown file: ' + filePath };
  }
  try {
    const source = await fs.readFile(filePath, 'utf8');
    const { frontmatter, body } = extractFrontmatter(source);
    return { ok: true, filePath, html: markdownToHtml(body), baseUrl: baseUrlForFile(filePath), frontmatter };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, filePath, error: message };
  }
}

// in createWindow(), after mainWindow is assigned — unconditional, so the
// renderer learns the (always-default) current ViewSettings even if no file
// is ever opened this session:
mainWindow.webContents.once('did-finish-load', () => {
  broadcastViewSettings();
});

// menu wiring (in app.whenReady().then(...)):
Menu.setApplicationMenu(
  Menu.buildFromTemplate(
    buildMenuTemplate(
      { onOpen: openFileViaDialog, onToggleDarkMode: setDarkMode, onToggleShowFrontmatter: setShowFrontmatter },
      viewSettings
    )
  )
);
```

**Why the `did-finish-load` broadcast is unconditional, separate from the
existing argv-conditional one.** The existing `did-finish-load` listener
(Task 2) only fires `renderAndWatch` when `argvFilePath()` returned a real
path — it is correctly silent otherwise. `ViewSettings` is a session fact
independent of whether any file was ever opened (per `functional_domain.md`'s
Abstract Schema Contracts), so it needs its own listener that always fires
once the page has loaded, regardless of the argv outcome. Folding it into the
existing conditional block would silently mean "no file on launch" also means
"renderer never learns the current view settings," which is wrong.

```js
// src/renderer/renderer.js addition, alongside statusBarText
function shouldShowFrontmatter(message, viewSettings) {
  if (!viewSettings || !viewSettings.showFrontmatter) return false;
  if (!message || !message.ok) return false;
  return message.frontmatter !== null && message.frontmatter !== undefined;
}
```

### File tree — Task 8 additions/changes

```
md-view/
├── package.json                       # ~ build script: - github-markdown.css copy,
│                                       #   + github-markdown-light.css,
│                                       #   + github-markdown-dark.css copies;
│                                       #   + github-dark.css copy alongside existing
│                                       #   github.css copy
├── src/main/
│   ├── frontmatter.ts                 # NEW — extractFrontmatter (pure)
│   ├── menu.ts                        # ~ + View menu, ViewSettings/MenuHandlers types
│   └── index.ts                       # ~ + viewSettings state, broadcastViewSettings,
│                                       #   setDarkMode/setShowFrontmatter, + unconditional
│                                       #   did-finish-load hook, + extractFrontmatter
│                                       #   wired into renderFile()
├── src/preload/
│   ├── api.ts                         # ~ + VIEW_SETTINGS channel, + ViewSettings type,
│                                       #   + frontmatter field on FileRenderedOk,
│                                       #   + onViewSettings on BridgeApi
│   └── index.ts                       # ~ + onViewSettings implementation
├── src/renderer/
│   ├── index.html                     # ~ 2 CSS links -> 4 (light/dark markdown +
│                                       #   light/dark hljs pairs, dark ones start
│                                       #   `disabled`), + <pre id="frontmatter" hidden>
│   ├── renderer.js                    # ~ + shouldShowFrontmatter, + applyDarkMode,
│                                       #   + onViewSettings wiring, + frontmatter
│                                       #   display wiring (lastMessage/lastViewSettings
│                                       #   local state, since the two channels arrive
│                                       #   independently)
│   └── app.css                        # ~ + padding-bottom on #content (2rem, matching
│                                       #   the existing padding-inline value),
│                                       #   + body.dark-mode rules (chrome/status-bar/
│                                       #   empty-state/frontmatter block), + #frontmatter
│                                       #   block styling (light + dark)
└── tests/
    ├── integration/preload-api-contract.test.ts   # ~ + VIEW_SETTINGS assertions
    ├── unit/
    │   ├── frontmatter.test.ts         # NEW
    │   ├── shouldShowFrontmatter.test.ts   # NEW
    │   └── menu.test.ts                # ~ extended for View menu / checkbox items
    └── e2e/
        ├── view-menu.spec.ts           # NEW
        └── fixtures/with-frontmatter/doc.md   # NEW
```

**Note on `#content`'s new `padding-bottom` vs. `body`'s existing one.** Task
7's `app.css` already sets `body { padding-bottom: 2rem; }` to reserve space
so the fixed status bar never overlaps document content. This task's
`#content { padding-bottom: 2rem; }` is a *different* concern — breathing room
at the visual end of the rendered document itself, matching its own lateral
`padding-inline`, independent of the status bar's clearance. Both rules stay;
they are not redundant with each other, and the engineer should not collapse
them into one.

### Unit test cases — exact list

`tests/unit/frontmatter.test.ts`:
1. Valid frontmatter (`---\ntitle: X\n---\n\nBody text`) → `frontmatter` equals
   the raw text between the fences (`'title: X'`), `body` equals the remaining
   document text with the frontmatter block removed.
2. No frontmatter at all (document starts with `# Heading`) → `frontmatter:
   null`, `body` unchanged (`===` the original source).
3. Unterminated leading `---` (a `---` line at the very start, but no second
   `---` line anywhere later in the document) → `frontmatter: null`, `body`
   unchanged — proves guardrail #2's fail-closed behavior.
4. **Explicit, commented "accepted ambiguity" case (guardrail #1):** a document
   that is not intended as frontmatter but matches the pattern anyway — e.g.
   `---\n\nSome divider paragraph\n\n---\n\nMore text` (two horizontal rules
   with a paragraph between them) — asserted to *still* extract the middle
   text as `frontmatter`, with a comment stating this is intentional,
   convention-inherited behavior, not a bug to fix.

`tests/unit/shouldShowFrontmatter.test.ts` — all 4 boolean combinations, plus
null inputs:
1. `showFrontmatter: true`, message has frontmatter → `true`.
2. `showFrontmatter: true`, message has `frontmatter: null` → `false`.
3. `showFrontmatter: false`, message has frontmatter → `false`.
4. `showFrontmatter: false`, message has `frontmatter: null` → `false`.
5. `message: null` → `false` (regardless of `viewSettings`).
6. `viewSettings: null` → `false` (regardless of `message`).
7. `message.ok === false` (error variant) with any `viewSettings` → `false` —
   an error render has no frontmatter to show, structurally, not just because
   the field happens to be absent from that variant's type.

`tests/unit/menu.test.ts` — extended, existing cases (File menu shape,
`menu-open`/`menu-exit` wiring) unchanged, plus:
1. Template now has 2 top-level items: `File`, `View`.
2. `View`'s submenu has exactly 2 entries: `menu-dark-mode`, `menu-show-frontmatter`.
3. `menu-dark-mode`: `type: 'checkbox'`, `label: 'Dark Mode'`, `checked` equals
   `initialViewSettings.darkMode` (test both `true` and `false` inputs),
   invoking `click` with a mock `menuItem: { checked: true }` calls
   `handlers.onToggleDarkMode(true)`.
4. `menu-show-frontmatter`: same shape, `checked` equals
   `initialViewSettings.showFrontmatter`, `click` wiring calls
   `handlers.onToggleShowFrontmatter` with the mock item's `checked` value.

### Integration test change

`tests/integration/preload-api-contract.test.ts`: add `VIEW_SETTINGS` to the
non-empty-string-channel-names assertions (alongside the existing
`FILE_RENDERED` check), and a distinctness assertion
(`IPC_CHANNELS.VIEW_SETTINGS !== IPC_CHANNELS.FILE_RENDERED`) — restoring the
two-channel distinctness test Task 7 had to remove for lack of a second
channel to compare against.

### e2e test — exact shape

`tests/e2e/fixtures/with-frontmatter/doc.md` — a fixture with a real leading
frontmatter block (e.g. `title`/`tags` on separate lines) followed by a
Markdown heading and body, so case (a) below has real content to assert
against.

`tests/e2e/view-menu.spec.ts` (new), following `ui-shell.spec.ts`'s established
`_electron.launch` + `childEnv` boilerplate:
a) Launch with the new frontmatter fixture via argv. Assert `#frontmatter` is
   visible and its text contains each frontmatter key on its own line (assert
   line-separated content, e.g. via `textContent.split('\n')` containing both
   keys as distinct entries — not collapsed into one run-on string, which is
   the exact legibility bug this task fixes).
b) Toggle `menu-show-frontmatter` off via
   `app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-show-frontmatter')?.click())`.
   Assert `#frontmatter` becomes hidden, and `#content`'s text is unchanged
   before vs. after the toggle (proves guardrail #3: no re-render happened).
c) Toggle `menu-dark-mode` on via the same `getMenuItemById('menu-dark-mode')`
   pattern. Assert (i) the dark CSS `<link>` elements' `disabled` property is
   `false` and the light ones' is `true` (query by the `id`s given to each
   `<link>` in `index.html`), AND (ii) a real computed style actually changed
   — e.g. `document.body`'s or `#content`'s computed `background-color` differs
   from its value before the toggle — proving genuine visual effect, not just
   attribute/class presence.
d) Close the app (`await app.close()`), then launch a **second**,
   independent `_electron.launch()` call (fresh process, same argv). Assert
   `menu-dark-mode`'s `checked` state (via `Menu.getApplicationMenu()?.getMenuItemById('menu-dark-mode')?.checked`)
   is back to `false` — proves guardrail #6 (no persistence) is real behavior,
   not merely a default never exercised.
e) After (a)'s render, assert `#content`'s computed `padding-bottom` is
   non-zero (same `getComputedStyle` pattern `ui-shell.spec.ts` already uses
   for `padding-left`/`padding-right`).

### Backlog cleanup (Step 3, not part of the code diff)

`.agents/specs/backlog.md`'s existing "Dark mode" entry (added after Task 6)
bundles two concerns in one bullet: (1) the app not honoring OS dark mode, and
(2) the highlight.js theme needing re-pairing if dark mode is ever addressed.
This task resolves both — (1) directly (the app now has its own explicit,
non-OS-driven dark mode), and (2) directly (the dark hljs theme is paired in
this same task, not deferred). Remove that single bullet entirely once this
lands; the task description's "two open backlog items" refers to these two
bundled concerns within that one entry, not two separate bullets — confirmed
by reading the actual current `backlog.md` content rather than assuming a
second bullet exists.

## Task 9 Technical Specification — Dark-Mode Theme Stylesheet Resolution Fix

Maps `functional_domain.md`'s Task 9 analysis to concrete design.

### The Inward Dependency Rule

- The fix lives entirely at the peripheral boundary — browser DOM/CSS resource loading inside `src/renderer/renderer.js`'s imperative setup block. It does not touch any of the three pure functions already extracted from that file (`applyRenderedContent`, `statusBarText`, `shouldShowFrontmatter`); those keep zero diff. No dependency direction changes: this is a leaf-level correction to how an existing peripheral mechanism (theme `<link>` toggling, introduced ADR-003) addresses its resources, not a new abstraction.

### SOLID Boundary Scan

- **SRP** — `applyDarkMode` retains its single responsibility (atomically flip the four link `disabled` states + body class) and is untouched. The fix is isolated to a new, narrow setup step that runs once, before `applyDarkMode` or any message handler can be invoked.
- **OCP** — no existing function's behavior is modified by adding a case; the four `href`s are corrected in place at the same point they're already looked up (`document.getElementById`), extending that existing lookup block rather than introducing a parallel mechanism.
- **DIP** — not applicable at this granularity; this is direct use of a browser leaf API (`document.baseURI`, `link.href` assignment), not an abstraction requiring inversion.

### Pattern note

Not a new GoF pattern. This is a resource-resolution timing fix, same tier as Task 4's `baseUrlForFile` fix — correcting *what* a reference points to, not introducing new structure.

### Decision (approved — Option A)

Rewrite the four theme `<link>` `href`s to absolute URLs, computed against `document.baseURI` captured at the very top of the `typeof document !== 'undefined'` block in `renderer.js`, before `window.mdview.onFileRendered`/`onViewSettings` are registered. Absolute URLs are immune to any later `<base href>` change (Task 4's mechanism), so the fix holds regardless of fetch timing (deferred `disabled` links vs. eager enabled ones) or a future refactor that splits renderer setup across an async boundary.

`index.html` is unchanged — its relative `href`s stay in the markup as authored; `renderer.js` resolves them to absolute URLs at setup time via `new URL(link.getAttribute('href'), initialBaseURI).href`, reading the *authored* attribute (not the live, possibly-already-rewritten `.href` property) to avoid double-resolution on any future re-entry.

### Rejected alternative (recorded, not implemented)

Drop `disabled` from all four `<link>`s in `index.html` so all four fetch eagerly at parse time (while `<base href>` is still correct), then call `applyDarkMode(false)` explicitly as the first line of setup to establish real initial state. Smaller diff, but correctness would depend on "no IPC message can be processed before this synchronous block finishes" — true today, not guaranteed to survive a future refactor that splits renderer setup across an async boundary (functional_domain.md Task 9 guardrail #1). Also touches `index.html`, which this task's scope excludes.

### Renderer changes

- `src/renderer/renderer.js`: at the very top of the `typeof document !== 'undefined'` block, before the existing `getElementById` lookups, capture `const initialBaseURI = document.baseURI;`. Immediately after the four theme-link `getElementById` calls, resolve and reassign each `.href` to its absolute form via `new URL(link.getAttribute('href'), initialBaseURI).href`, guarded per-link for `null` (matching this file's existing `if (x) x....` null-checks throughout).

### File tree — Task 9 additions/changes

```
md-view/
├── src/renderer/
│   ├── index.html                      # unchanged — out of scope
│   └── renderer.js                     # ~ absolute-URL resolution for 4 theme links, before IPC listener registration
├── tests/e2e/
│   └── view-menu.spec.ts               # ~ test (c) strengthened: computed #content color, resolved href anchoring, zero console/page errors
└── .agents/specs/decisions/
    └── ADR-004_md-view.md              # NEW — records this decision + rejected alternative
```

### Required test changes (TDD — RED first)

Strengthen `view-menu.spec.ts` test (c), same toggle-after-file-is-open flow it already exercises:
1. `getComputedStyle` on `#content` (or a heading inside it) for `color` equals the dark palette's actual value — not browser-default black, not the light value.
2. Each theme `<link>`'s resolved `.href` after toggle stays anchored under the app's own renderer directory — assert it does NOT contain the fixture's directory segment (`tests/e2e/fixtures`).
3. Zero console/page errors during the toggle — capture via `window.on('console', ...)` filtered to `type() === 'error'` (and/or `requestfailed`) across the whole flow, assert the array is empty.

### Fault-injection proof (required)

Before declaring done: temporarily revert the `renderer.js` fix to relative hrefs, rerun the strengthened test, confirm it fails with the *same failure signature* as the real bug (`net::ERR_FILE_NOT_FOUND`-shaped console error and/or wrong computed color), not just "some assertion failed." Then restore the fix and confirm green. Same practice as Task 4's addendum and Tasks 3/5.

---

## Task 10 Technical Specification — HTML Comment Stripping Fix

Maps `functional_domain.md`'s Task 10 analysis to concrete design.

### The Inward Dependency Rule

The fix lives entirely inside `src/main/markdown.ts`, at the same peripheral boundary already occupied by the existing `highlightCode` fence-rendering override (Task 6). It is a `markdown-it` `renderer.rules` override — the library's own designed extension seam — not a new abstraction layer, and it does not change what depends on what: `markdownToHtml` still exposes the same one-function, string-in/string-out boundary to its caller.

### SOLID Boundary Scan

- **SRP** — the new `renderer.rules.text` override has exactly one job: strip comment spans from plain-text token content before that content is escaped for display. Fence rendering (`highlightCode`) keeps its own, already-scoped responsibility and is untouched — the two rules are wired to different token types (`text` vs. `fence`) and never share code paths.
- **OCP** — implemented by assigning `md.renderer.rules.text`, extending `markdown-it`'s behavior through its own rule-override mechanism rather than forking or monkey-patching its internals. Content that survives stripping still falls through to the library's own default text-rendering/escaping behavior (`renderer.renderToken`), so this task adds a case without modifying markdown-it's existing default rule.
- **DIP** — the module already depends on the `markdown-it` abstraction (constructor options, `renderer.rules` extension points) rather than reaching past it; this fix uses that same seam, not a new dependency.

### Pattern note

Not a new GoF pattern. This is a Decorator-shaped use of `markdown-it`'s own rule-override extension point — the same tier of change as Task 6's `highlight` option — layering behavior onto an existing rendering step rather than introducing new structure.

### Decision

Override `md.renderer.rules.text = (tokens, idx, options, env, self) => { ... }`. Inside, strip `/<!--[\s\S]*?-->/g` from `tokens[idx].content`, then delegate to the default text-rendering behavior (`self.renderToken(tokens, idx, options)`, or equivalent escaping) for whatever content remains. The constructor's `html: false` and `highlight` options are unchanged — this is strictly additive at the renderer-rules layer, per the task's explicit instruction not to touch either.

A one-line code comment in `markdown.ts`, at the override site, records the soft-break-split-comment limitation (functional_domain.md guardrail #5) as a deliberate, known scope boundary — not a TODO implying future work is expected here.

### File tree — Task 10 additions/changes

```
md-view/
├── src/main/
│   └── markdown.ts                          # ~ renderer.rules.text override strips HTML comments; html:false and highlight option untouched
├── tests/unit/
│   └── markdown.test.ts                     # + cases: bare comment absent, mid-doc comment stripped (siblings untouched), fence-content regression guard, existing security tests re-verified unmodified
└── tests/e2e/
    ├── fixtures/with-html-comment/doc.md    # NEW — standalone comments, fenced comment, raw non-comment tag
    └── html-comments.spec.ts                # NEW — launch via electron.launch, assert on #content per the code-highlighting.spec.ts pattern
```

### Required test changes (TDD)

`tests/unit/markdown.test.ts`, extending the existing `describe('markdownToHtml (pure conversion)', ...)`:
1. A bare HTML comment alone in its own paragraph → absent from output entirely (guardrail #1).
2. A comment on its own paragraph mid-document, real content before and after → comment stripped, surrounding paragraphs' content unchanged (guardrail #2).
3. Regression guard: an HTML comment inside a fenced code block (any language) still renders as literal escaped text inside `<pre><code>` — unchanged from pre-fix behavior (guardrail #4).
4. Regression guard: the existing raw-HTML security tests already in this file continue to pass unmodified — a `<script>`/other raw tag outside a fence stays escaped and visible, never stripped (guardrail #3).

`tests/e2e/html-comments.spec.ts` (new), following `code-highlighting.spec.ts`'s `electron.launch` + `childEnv`/`ELECTRON_RUN_AS_NODE`-stripping boilerplate exactly: launch with the new fixture, assert `#content` contains the heading and both non-comment paragraphs, and that its text does *not* contain either standalone comment's text while still containing the fenced comment's text and the raw non-comment tag's text.

### Fault-injection proof (required)

Same standing practice since Task 3/4: temporarily disable the `renderer.rules.text` override (or the regex within it), rerun unit test #1 above, confirm it fails (the comment reappears, escaped, in the output) — not a different, unrelated failure. Restore the override, confirm green again. Report the before/after in the close-out.

### Backlog note (Step 3, not part of the code diff)

Record functional_domain.md guardrail #5 (soft-line-break-split comments not caught by the per-token regex) as a new `[Pending]` backlog entry once this task lands — the Lead transcribes this, not the engineer; the engineer's job is limited to leaving the one-line in-code comment noting the boundary.

---

## Task 11 Technical Specification — Document Card Chrome

Maps `functional_domain.md`'s Task 11 analysis to concrete design.

### The Inward Dependency Rule

Strictly peripheral: static markup (`index.html`) and static styling (`app.css`), the same outermost boundary layer as Task 7's status-bar/empty-state polish and Task 8's dark-mode CSS. No dependency direction changes — nothing in `src/main/**` or `renderer.js` is touched or needs to be, because this task adds a DOM wrapper and CSS around already-existing, already-populated elements rather than changing what populates them.

### SOLID Boundary Scan

- **SRP** — `#document-container`/`#document-header` are a pure layout/chrome concern, cleanly separable from content production (Task 4/7/8/10's territory) and from the `#status-bar`/`#empty-state` siblings, which stay untouched and outside the new wrapper.
- **OCP** — extends the DOM by wrapping existing nodes in new parent elements (`#frontmatter`/`#content` keep their ids, types, and existing CSS rules unmodified) rather than modifying those nodes' own definitions. `app.css`'s existing rules for `#content`, `#frontmatter`, `body.dark-mode …` are additive-only from this task's side; nothing already there is edited, only new selectors are appended, following the file's own established per-task-comment-block convention.
- **DIP** — not applicable at this granularity (no abstraction/interface boundary at play in static markup/CSS).

### Pattern note

No GoF pattern — this is presentation-layer chrome, same tier as Task 7. Worth noting only as a forward-looking design signal: `type="button"`, no click handlers, and no ARIA `aria-selected` state wiring today intentionally leaves room for a future task to wire real Preview/Code switching (e.g. a Strategy-shaped view-mode toggle) without this task pre-committing to that design — chrome now, behavior later, as separate, independently reviewable units of work.

### Markup changes — `src/renderer/index.html`

Replace:
```html
<pre id="frontmatter" hidden></pre>
<div id="content" class="markdown-body"></div>
```
with:
```html
<div id="document-container">
  <div id="document-header">
    <button type="button" id="tab-preview" class="doc-tab active">Preview</button>
    <button type="button" id="tab-code" class="doc-tab">Code</button>
  </div>
  <div id="document-main">
    <pre id="frontmatter" hidden></pre>
    <div id="content" class="markdown-body"></div>
  </div>
</div>
```
`#empty-state` stays exactly where it is today, as a sibling before `#document-container`, not inside it (guardrail #5). `#status-bar` stays exactly where it is today, after `#document-container`. No id, tag, or attribute on `#frontmatter`/`#content` changes — only their parent chain.

### Styling changes — `src/renderer/app.css`

New, additive-only block (own dated comment header, per the file's established convention):
- `#document-container`: `margin: … 2rem` (outer layer, separate from `#content`'s own `padding-inline: 2rem` and `#frontmatter`'s own `margin: 0 2rem` — guardrail #2), `border: 1px solid #d0d7de`, `border-radius: 6–8px`, `overflow: hidden` (so the header's own background doesn't visually escape the rounded corners).
- `#document-header`: `background: #f6f8fa`, `border-bottom: 1px solid #d0d7de`, flex row layout for the two tab buttons, horizontal padding.
- `.doc-tab`: borderless/flat button reset (`background: none`, `border: none`, `padding`, `font: inherit`, `cursor: pointer` even though inert today — visually affords the future click target guardrail #3 defers), `border-bottom: 2px solid transparent` as the layout placeholder for the active indicator, hover state (subtle background or text-color shift).
- `.doc-tab.active`: `border-bottom-color` set to an accent (GitHub uses its orange/black underline; pick the existing palette's nearest accent — engineer's call, document the choice), `font-weight: 600`.
- `body.dark-mode #document-container`, `body.dark-mode #document-header`: `#30363d`/`#161b22` pair, following the exact token pattern already in the file for `body.dark-mode #frontmatter`/`#status-bar` (guardrail #4) — no new dark-mode mechanism.
- `body.dark-mode .doc-tab`: text-color variant matching `#frontmatter`'s dark text color (`#c9d1d9`) for consistency.

### File tree — Task 11 additions/changes

```
md-view/
├── src/renderer/
│   ├── index.html                      # ~ #frontmatter/#content wrapped in new #document-container > #document-header + #document-main
│   └── app.css                         # + new dated block: #document-container, #document-header, .doc-tab (+ .active), dark-mode variants
└── tests/e2e/
    └── ui-shell.spec.ts                # ~ argv-launch test extended (or new test added): container/header visible, tabs present with correct text, #tab-preview active by default
```

### Required test changes

Extend `tests/e2e/ui-shell.spec.ts`'s existing `'argv launch: …'` test (preferred, keeps one place asserting "a file is open" state) or add a narrowly-scoped new test in the same file:
1. `#document-container` and `#document-header` are visible once the fixture file is open.
2. `#tab-preview` and `#tab-code` exist, with visible text `Preview` and `Code` respectively.
3. `#tab-preview` carries the active-state class (`.active`) by default; `#tab-code` does not.
4. Do **not** modify the existing computed-padding assertion on `#content` (guardrail #2) — it must keep passing exactly as written, proving the new wrapper didn't absorb or replace `#content`'s own padding.

No unit tests required — this task has zero pure-transformation logic (functional_domain.md's Task 11 "Pure Transformation Logic" section is explicitly empty), consistent with Task 7's precedent of e2e-only coverage for pure presentation work.

### Fault-injection proof

Not applicable in the standing "disable the fix, confirm RED" sense used for Tasks 3–10 — there is no logic to fault-inject, only markup/CSS. Substitute: the engineer should confirm the *existing* `#content` padding assertion in `ui-shell.spec.ts` would fail if `#document-container`'s margin were used to replace rather than wrap `#content`'s own `padding-inline` (i.e. briefly try the wrong approach — margin on the container instead of preserving `#content`'s padding — confirm the existing test still passes only because `#content`'s own CSS is untouched, not because the new wrapper happens to compensate). Report this check in the close-out.

---

## Task 13 Technical Specification — App Icon Dev-Mode Parity

Maps `functional_domain.md`'s Task 13 analysis to concrete design.

### The Inward Dependency Rule

Strictly peripheral, and unusually shallow even by this project's standard:
one build-script copy step (outermost I/O boundary, same tier as the
existing renderer-asset copies already inline in `package.json`), one
`__dirname`-resolved constructor argument added at the `createWindow()`
callsite (outer mechanism composing an inner, still-pure config object —
same treatment already given to `preload`), and one new leaf predicate
module with zero Electron imports. Nothing in this task reaches inward
past the main-process entrypoint; no domain logic exists to protect.

### SOLID Boundary Scan

- **SRP** — `dockIcon.ts` has exactly one reason to change: the rule for
  *when* the dev Dock icon should be set. It does not decide *how* (no
  `app.dock.setIcon` call inside it) and does not know about icon paths —
  that composition stays at the `index.ts` callsite, mirroring how
  `shouldSkipDevToolsShortcut` decides only the boolean, never touches
  `webContents` itself.
- **OCP** — `windowConfig.ts`'s `defaultWindowOptions` is extended by
  spreading additional keys in at the callsite (`icon: path.join(...)`,
  same pattern as `preload`), not by modifying the object's own
  definition. The object itself is closed to this change; the callsite is
  open to composing more onto it.
- **DIP** — `dockIcon.ts`'s predicate depends on nothing but two primitive
  inputs (`boolean`, `NodeJS.Platform`) passed in by the caller, rather
  than reaching into `app.isPackaged`/`process.platform` itself. This is
  what makes it importable and testable with zero Electron runtime,
  consistent with the project's existing pure-predicate modules
  (`isExternalHttpUrl`, `shouldShowFrontmatter`).

### Pattern note

No GoF pattern warranted — this is a single boolean guard clause, not a
family of interchangeable behaviors (no Strategy justified for one
predicate with one caller). Keeping it a plain exported function, not a
class or registry, is the correct-weight choice here.

### Build-script change — `package.json`

Append one more `require('fs').copyFileSync(...)` call to the existing
inline chain inside the `"build"` script's `node -e "..."` string — same
statement-per-asset pattern already used for the six renderer assets in
that chain. New line, in sequence, after the existing copies:

```js
require('fs').copyFileSync('build/icons/512x512.png','dist/main/icon.png')
```

`dist/main/` already exists as the `tsc` output directory for
`src/main/**`.ts by the time this line runs (the `tsc -p tsconfig.json`
step precedes it in the `&&` chain), so no `mkdirSync` is needed here
(unlike `dist/renderer`, created fresh by this same script). No new
tooling, no restructuring of the existing chain — one appended statement.

### Main-process changes — `src/main/index.ts`

In `createWindow()`, add `icon` to the `BrowserWindow` constructor options,
spread alongside `...defaultWindowOptions`, sibling to the existing
`webPreferences.preload` composition:

```ts
mainWindow = new BrowserWindow({
  ...defaultWindowOptions,
  icon: path.join(__dirname, 'icon.png'),
  webPreferences: {
    ...defaultWindowOptions.webPreferences,
    preload: path.join(__dirname, '../preload/index.js'),
  },
});
```

Inside the existing `app.whenReady().then(() => { ... })` block, after
`createWindow()`, call the Dock guard once:

```ts
if (shouldSetDockIcon(app.isPackaged, process.platform)) {
  app.dock.setIcon(path.join(__dirname, 'icon.png'));
}
```

Import `shouldSetDockIcon` from the new `./dockIcon` module. No change to
`windowConfig.ts`'s object shape (functional_domain.md guardrail #2).

### New module — `src/main/dockIcon.ts`

```ts
export function shouldSetDockIcon(isPackaged: boolean, platform: NodeJS.Platform): boolean {
  return !isPackaged && platform === 'darwin';
}
```

No Electron imports, no top-level side effects — a leaf module in the same
family as `linkPolicy.ts`/`paths.ts`, importable directly by a unit test.
Deliberately *not* wired through the `globalThis.__mdViewDevToolsGuardForTests`
bridge pattern (functional_domain.md guardrail #5) — that bridge exists
only because `shouldSkipDevToolsShortcut` currently lives inside
`index.ts`, a module with top-level `app.whenReady()` side effects that
make direct import unsafe in a Vitest unit test. `dockIcon.ts` has no such
side effects, so the bridge's entire reason for existing doesn't apply
here; a normal `import` + direct call is strictly correct, not a
shortcut.

### File tree — Task 13 additions/changes

```
md-view/
├── package.json                        # ~ one appended copyFileSync line in the "build" script's inline chain
├── src/main/
│   ├── index.ts                        # ~ createWindow(): + icon path at callsite; app.whenReady(): + guarded app.dock.setIcon call; + import shouldSetDockIcon
│   └── dockIcon.ts                     # NEW — pure shouldSetDockIcon(isPackaged, platform) predicate, no Electron imports
└── tests/unit/
    └── shouldSetDockIcon.test.ts       # NEW — direct import + call, both isPackaged/platform permutations
```

`windowConfig.ts` is explicitly **not** in this tree — no change, per
functional_domain.md guardrail #2.

### Required test changes (TDD)

`tests/unit/shouldSetDockIcon.test.ts`, following `shouldShowFrontmatter.test.ts`'s
direct-import-and-call style (no Electron instance, no mocking):
1. `isPackaged: false, platform: 'darwin'` → `true`.
2. `isPackaged: true, platform: 'darwin'` → `false` (packaged builds get
   the icon from the `.icns` bundle instead; this predicate must not
   double-set it).
3. `isPackaged: false, platform: 'win32'` → `false`.
4. `isPackaged: false, platform: 'linux'` → `false`.

No integration or e2e test is required for the predicate itself (it's
fully covered by direct unit tests, same tier as `shouldShowFrontmatter`).
The window/taskbar icon and the Dock icon are both verified manually per
the fault-injection section below — Playwright's Electron driver has no
reliable cross-platform way to assert on OS-chrome icon pixels or Dock
state, so this is not a gap the test suite is expected to close.

### Fault-injection proof (required)

Two independent checks, both already described in the task brief and
repeated here as the binding spec:

1. **Packaging wiring** — temporarily rename `build/icon.png` aside, run
   the buildable packaging target, confirm electron-builder logs its
   "application icon is not set" default-icon warning; restore the file,
   rerun, confirm the warning is gone. This proves `build/icon.png`
   actually exists where electron-builder's convention expects it — it is
   a pre-existing invariant this task depends on but does not create, so
   the check is expected to already pass; report the before/after anyway
   since this is the first task to touch icon plumbing at all.
2. **Predicate polarity** — with the real `npm run dev` running on
   whatever platform is available, confirm the taskbar/window icon is the
   md-view icon, not Electron's default. On macOS specifically, additionally
   confirm the Dock icon updates, then temporarily flip
   `shouldSetDockIcon`'s platform branch (e.g. hardcode a non-darwin
   return) and confirm the Dock call correctly stops firing — proving the
   guard is load-bearing, not coincidentally always-true.

### Governance note

No `.agents/decisions/` ADR is anticipated for this task — the one
deliberate divergence worth flagging (skipping the `globalThis` test
bridge in favor of a plain leaf-module import) is a *non*-extension of
existing debt rather than a new architectural decision, and is called out
above under "New module" instead. Lead's call at close-out whether a
DEVLOG entry is still warranted to make that reasoning discoverable
without re-reading this spec.

---

## Task 14: Help feature — Technical Specification

### The Inward Dependency Rule

The Help window is a peripheral mechanism (BrowserWindow, file I/O for
help.md, CSS asset paths) wrapping two pure, dependency-free core
functions (`shouldCreateHelpWindow`, `buildHelpHtml`) in the new
`helpWindow.ts` leaf module. Neither function imports Electron; both are
directly unit-testable, same tier as `dockIcon.ts`'s `shouldSetDockIcon`
and `linkPolicy.ts`'s `isExternalHttpUrl`. Orchestration (reading
help.md, constructing the window, wiring navigation interception) lives
at the `index.ts` callsite, outside the core, exactly where Task 13
placed the Dock-icon orchestration around its own pure predicate.

### SOLID Boundary Scan

- **SRP**: `helpWindow.ts` has exactly two responsibilities, split into
  two functions — window-identity decision, and HTML templating. Neither
  touches the filesystem, Electron APIs, or menu wiring.
- **DIP**: `shouldCreateHelpWindow` depends on the abstract
  `DestroyableWindow` structural interface (`{ isDestroyed(): boolean }`),
  not on Electron's concrete `BrowserWindow` class — the real
  `BrowserWindow` satisfies it structurally, but the unit test can pass a
  plain object literal with no Electron runtime involved at all.
- **ISP**: `DestroyableWindow` exposes only the one method the predicate
  actually needs, not the full `BrowserWindow` surface.
- **OCP**: External-link handling is not reimplemented for this window —
  `linkPolicy.ts`'s existing `isExternalHttpUrl` is imported and reused
  verbatim, extending its existing consumer set rather than modifying or
  duplicating it.

### Pattern Application

- **Singleton (module-scoped, not classic GoF class-based)**: exactly one
  Help window reference (`let helpWindow: BrowserWindow | null`) at
  module scope in `index.ts`, guarded by `shouldCreateHelpWindow` —
  mirrors the existing single-`mainWindow`/single-watcher precedent
  already established by Task 3's "exactly one active watcher" invariant.
- **Template Method (via pure function, not inheritance)**: `buildHelpHtml`
  is a fixed HTML-document skeleton with one varying region (content) and
  one varying list (stylesheet links) — composition over structural
  inheritance, per CLAUDE.md's stated GoF preference.

### File tree — Task 14 additions/changes

```
md-view/
├── package.json                 # ~ append help.md to the build script's inline copy chain
├── src/main/
│   ├── help/
│   │   └── help.md              # NEW — Lead-authored content, verbatim per functional_domain.md §Task 14
│   ├── helpWindow.ts            # NEW — shouldCreateHelpWindow(), buildHelpHtml(); no Electron imports
│   ├── menu.ts                  # ~ + Help top-level item (id: menu-help, label: 'md-view Help', accelerator: 'F1'); MenuHandlers += onOpenHelp
│   └── index.ts                 # ~ + module-level let helpWindow, onOpenHelp handler, external-link interception wired onto the Help window
└── tests/
    ├── unit/
    │   ├── shouldCreateHelpWindow.test.ts   # NEW
    │   ├── buildHelpHtml.test.ts            # NEW
    │   └── menu.test.ts                     # ~ extend: 3rd top-level item, its submenu, accelerator, click ref
    └── e2e/
        └── help-menu.spec.ts    # NEW
```

`windowConfig.ts` is NOT in this tree — the Help window's options are
built at the index.ts callsite (spread defaultWindowOptions, omit
preload), same treatment icon path already gets for the main window.
`preload/api.ts` and `preload/index.ts` are NOT in this tree — no new
BridgeApi surface.

`helpWindow.ts` shape:

```ts
export interface DestroyableWindow {
  isDestroyed(): boolean;
}

export function shouldCreateHelpWindow(existing: DestroyableWindow | null): boolean {
  return existing === null || existing.isDestroyed();
}

export function buildHelpHtml(contentHtml: string, cssHrefs: string[]): string {
  const links = cssHrefs.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n    ');
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>md-view Help</title>
    ${links}
  </head>
  <body>
    <div class="markdown-body" style="max-width: 44rem; margin: 2rem auto; padding: 0 1.5rem 3rem;">
      ${contentHtml}
    </div>
  </body>
</html>`;
}
```

`index.ts` wiring notes:
- Read help.md once per click (not at startup) via
  `fs.readFile(path.join(__dirname, 'help', 'help.md'), 'utf8')`, run
  through the existing `markdownToHtml()`.
- Build cssHrefs using `pathToFileURL` from 'node:url' (same import
  paths.ts already uses for baseUrlForFile) against
  `path.join(__dirname, '../renderer/app.css')` and
  `path.join(__dirname, '../renderer/github-markdown-light.css')` and
  `path.join(__dirname, '../renderer/github.css')` — light-theme CSS
  only, per functional_domain.md guardrail #5.
- `helpWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))`.
- Wire the same will-navigate / setWindowOpenHandler pattern
  createWindow() already has, scoped to helpWindow.webContents — reusing
  `isExternalHttpUrl` from linkPolicy.ts, per functional_domain.md
  guardrail #4.
- On `helpWindow.on('closed', ...)`, set the module-level reference back
  to null (mirrors mainWindow's lifecycle handling elsewhere).

### Required test changes (TDD)

`tests/unit/shouldCreateHelpWindow.test.ts`:
1. `null` → `true`.
2. `{ isDestroyed: () => true }` → `true`.
3. `{ isDestroyed: () => false }` → `false`.

`tests/unit/buildHelpHtml.test.ts`:
1. Output contains a `<link rel="stylesheet" href="...">` for each entry
   in cssHrefs, in order.
2. Output contains the given contentHtml inside a `.markdown-body`
   element.
3. Output starts with `<!DOCTYPE html>`.

`tests/unit/menu.test.ts` — extend following the existing style exactly
(see the View-menu tests already in the file):
1. Template now has 3 top-level items: File, View, Help.
2. Help's submenu has exactly 1 entry: id `menu-help`.
3. `menu-help` has label 'md-view Help', accelerator 'F1', and click
   reference-equal to the onOpenHelp handler.

`tests/e2e/help-menu.spec.ts` (new, follow view-menu.spec.ts's launch
pattern — strip ELECTRON_RUN_AS_NODE, use `_electron`):
(a) Triggering `menu-help` via `app.evaluate` opens a second window
    (`app.waitForEvent('window')`) whose text content contains a known
    phrase from help.md (e.g. "minimal desktop Markdown previewer").
(b) Triggering `menu-help` twice still yields exactly 2 total windows
    (`app.windows().length === 2`), not 3.
(c) The Help window's `window.mdview` evaluates to `undefined` — proves
    no preload leaked onto this window.
(d) Closing the Help window and triggering `menu-help` again
    successfully reopens it (still 2 total windows, new content visible).

### Fault-injection proof (required)

1. **Singleton guard** — temporarily hardcode `shouldCreateHelpWindow` to
   always `return true`. Confirm test (b) goes RED (3 windows). Restore.
   Confirm GREEN.
2. **Preload leak** — temporarily add
   `preload: path.join(__dirname, '../preload/index.js')` to the Help
   window's webPreferences. Confirm test (c) goes RED (`mdview` becomes
   defined). Remove it. Confirm GREEN.
3. No fault-injection test is added for html:false — it's inherited,
   unchanged coverage from markdown.test.ts; state this explicitly in
   the review report rather than silently omitting a check.

### Governance note

No ADR expected — the "no preload, stricter webPreferences than the
main window" choice is an application of the existing security
invariants (functional_domain.md Task 1 guardrails #1–2), not a new
architectural decision. Worth one DEVLOG.md sentence at close-out
noting *why* this window has no BridgeApi, so it's discoverable later
rather than looking like an oversight.

---

## Task 15 Technical Specification — Help Window Menu Suppression

Maps `functional_domain.md`'s Task 15 analysis to concrete design.

### The Inward Dependency Rule

No new module. `src/main/index.ts`'s `onOpenHelp` (the same composition-
root function Task 14 already added) is the only call site — same
placement discipline as Task 13's dock-icon call: a single imperative
Electron API invocation, made once, right where the object it acts on is
constructed, with no new abstraction layer introduced for a single call.

### SOLID Boundary Scan / Pattern Application

Not applicable at this scale — a one-line, unconditional API call on an
already-owned object is below the threshold where SRP/OCP/DIP or a GoF
pattern says anything not already said by Task 14's own spec. Forcing a
pattern here would be exactly the "hypothetical future requirement"
CLAUDE.md warns against.

### Exact change (authoritative)

In `onOpenHelp`, immediately after `helpWindow = new BrowserWindow({...})`
and before `loadURL`:

```ts
helpWindow = new BrowserWindow({
  ...defaultWindowOptions,
  webPreferences: {
    ...defaultWindowOptions.webPreferences,
  },
});
helpWindow.removeMenu();
```

No conditional, no platform branch — `removeMenu()` is documented as a
no-op on macOS (menu bar there is process-wide, not per-window), so
calling it unconditionally is correct on every platform without an
`if (process.platform !== 'darwin')` guard that would just be dead
weight. The engineer must confirm this empirically on the Windows dev
machine (`getMenu()` returns `null` after the call) rather than trusting
the doc claim alone — per functional_domain.md guardrail #2.

Nothing else in `onOpenHelp`, `menu.ts`, or the main window's
`Menu.setApplicationMenu(...)` wiring changes.

### Required test changes (TDD)

Extend `tests/e2e/help-menu.spec.ts` with one new case:
(e) After triggering `menu-help` (reusing case (a)'s open pattern),
`app.evaluate` against the Help `BrowserWindow` instance asserts
`win.getMenu() === null`, **and**, in the same test, asserts the main
window's `getMenu()` is still non-null (proves the fix is scoped to the
Help window only, not a global menu removal that happens to also affect
the main window).

### Fault-injection proof (required)

Temporarily comment out the new `helpWindow.removeMenu()` line, rebuild,
run case (e), confirm it goes RED (`getMenu()` returns the inherited
application menu object, not `null`). Restore the line, rebuild, confirm
GREEN. This is the live proof the guardrail's own wording demands
("verified via an actual running window, not a code read").

### Governance note

No ADR — this is a one-line bug fix closing a Task 14 spec gap, not a
new architectural decision. A `backlog.md` "Resolved" entry at close-out
is sufficient.

---

## Task 16 Technical Specification — Drag-and-Drop File Open

Maps `functional_domain.md`'s Task 16 analysis to concrete design. This
is the first task that adds a **renderer→main** crossing to the bridge
contract — until now `BridgeApi` has been strictly main→renderer
(`onFileRendered`, `onViewSettings`), so the Inward Dependency Rule and
the Facade/DIP split (ADR-001) both get exercised in the new direction
for the first time, not just extended in the old one.

### The Inward Dependency Rule

- The renderer still never imports `electron` or `node:*`. Its only
  channel outward remains `window.mdview` — this task adds one new
  method to that surface (`openDroppedFile`), not a second channel.
- `webUtils.getPathForFile()` — the one new Node/Electron-privileged
  call this task introduces — lives exclusively inside
  `src/preload/index.ts`'s implementation of `openDroppedFile`. It must
  never be called from `src/main` (functional_domain.md guardrail #7:
  documented Electron requirement, not a style choice) and the renderer
  has no way to reach it directly (contextBridge only exposes the one
  function, never `webUtils` itself).
- `src/main/index.ts` gains one new `ipcMain.on` listener. It sits at
  the same peripheral layer as the existing `openFileViaDialog` —
  another *trigger* that terminates in the one shared `renderAndWatch`
  orchestration, never a parallel implementation of it.

### SOLID Boundary Scan / Pattern Application

- **ISP / Facade (extends ADR-001)** — `BridgeApi` gains exactly one
  new named method, `openDroppedFile(file: File): void`. Deliberately
  not split into `getPathForFile()` + `openFile()` as two bridge
  methods: that shape would hand the renderer a resolved absolute
  filesystem path as a raw JS value it could inspect, log, or misuse —
  a strictly wider surface than the domain operation needs. One method,
  one responsibility ("hand this dropped File to the part of the app
  that knows what to do with it"), no new abstraction layer.
- **DIP** — the renderer depends on the `BridgeApi` interface, not on
  `ipcRenderer`/`contextBridge` mechanics or on `webUtils`. Nothing
  about this task changes that dependency direction; it just adds one
  more member to the interface already playing that role since Task 1.
- **No new pattern introduced.** `IPC_CHANNELS` already is the
  single-source-of-truth enum-like object (Task 2's "IPC boundary is
  named, not stringly-typed" precedent) — `REQUEST_OPEN_FILE` is a
  fourth entry in an existing pattern, not a new one. The Composition
  Root (`src/main/index.ts`) gains one more wired trigger alongside
  argv/dialog/menu, the same shape every prior task's new trigger has
  taken (Task 2, Task 7).

### Exact changes (authoritative)

**`src/preload/api.ts`**
```ts
export const IPC_CHANNELS = {
  FILE_RENDERED: 'md-view:file-rendered',
  VIEW_SETTINGS: 'md-view:view-settings',
  REQUEST_OPEN_FILE: 'md-view:request-open-file',
} as const;

export interface BridgeApi {
  readonly version: string;
  onFileRendered(callback: (message: FileRenderedMessage) => void): void;
  onViewSettings(callback: (settings: ViewSettings) => void): void;
  openDroppedFile(file: File): void;
}
```
No change to `FileRenderedMessage`/`ViewSettings` — per the approved
functional-domain analysis, this task's result still flows over the
existing `FILE_RENDERED` channel.

**`src/preload/index.ts`**
```ts
import { contextBridge, ipcRenderer, webUtils } from 'electron';
...
openDroppedFile: (file) => {
  const filePath = webUtils.getPathForFile(file);
  ipcRenderer.send(IPC_CHANNELS.REQUEST_OPEN_FILE, filePath);
},
```
Fire-and-forget (`send`, not `invoke`) — matches every existing
trigger's pattern; no open path today awaits a return value.

**`src/main/index.ts`**
```ts
ipcMain.on(IPC_CHANNELS.REQUEST_OPEN_FILE, (_event, filePath: string) => {
  if (typeof filePath === 'string' && filePath.length > 0) {
    renderAndWatch(filePath);
  }
});
```
Registered once, alongside the other `app.whenReady()` wiring. No new
`.md`-extension check, no new error text — `renderAndWatch` →
`renderFile` already owns that validation (guardrail #1). The
non-empty-string guard is the *only* new logic in main, and it exists
solely to satisfy guardrail #8 (never call `renderAndWatch('')`).

**`src/renderer/renderer.js`** (inside the existing `typeof document
!== 'undefined'` block, alongside the other DOM wiring)
```js
function firstDroppedFile(fileList) {
  if (!fileList || fileList.length === 0) return null;
  return fileList[0];
}

let dragDepth = 0;

document.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  document.body.classList.add('drag-over');
});

document.addEventListener('dragover', (event) => {
  event.preventDefault(); // load-bearing: without this, Electron's default
  // action navigates the whole window to the dropped file's location
});

document.addEventListener('dragleave', (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove('drag-over');
});

document.addEventListener('drop', (event) => {
  event.preventDefault(); // load-bearing, same reason as dragover
  dragDepth = 0;
  document.body.classList.remove('drag-over');
  const file = firstDroppedFile(event.dataTransfer.files);
  if (file) window.mdview.openDroppedFile(file);
});
```
`firstDroppedFile` is exported through the existing `typeof module !==
'undefined'` guard alongside `applyRenderedContent`/`statusBarText`/
`shouldShowFrontmatter`, for direct unit testing with zero DOM.
Listeners are on `document` (guardrail #4: whole-document drop target,
not `#content`/`#document-container` specifically — works identically
whether `#empty-state` or `#document-container` is currently visible).

**`src/renderer/app.css`**
```css
body.drag-over {
  outline: 3px dashed #0969da;
  outline-offset: -3px;
}

body.dark-mode.drag-over {
  outline-color: #58a6ff;
}
```
`outline` (not `border`) so the highlight never triggers reflow/layout
shift of `#document-container`'s centered max-width column (Task 12
guardrail territory) — purely additive, no existing rule touched.
Scoped to `body` so it's visible regardless of which region
(`#empty-state` or `#document-container`) currently occupies the
window, satisfying guardrail #4's "whole document" framing for the
visual affordance too, not just the drop-target wiring.

### Test architecture (investigated per guardrail #10, not assumed)

`webUtils.getPathForFile()` only resolves a real path for a `File`
tracing back to a genuine OS-level drag; a `File` constructed inside
`page.evaluate()` will very likely resolve to `''` even in the real
running app, and `contextBridge`-exposed methods are non-configurable
from web content, so `window.mdview.openDroppedFile` cannot be
monkey-patched/spied from the page side. That closes off the literal
"drop a real file, see it render" e2e proof. It does **not** close off
proving the rest of this task's guardrails end-to-end with real
production code, via two channels the engineer must confirm empirically
while implementing:

1. **`ipcMain` is a plain `EventEmitter`.** `app.evaluate(({ ipcMain },
   channel) => ipcMain.emit(channel, {}, filePath))` invokes the *real*
   registered main-process listener directly, with a real filesystem
   path chosen by the test — bypassing only the renderer/preload File-
   resolution boundary, not main's own logic. This proves guardrails
   #1 (non-`.md` real path → identical "Not a Markdown file" error
   already proven for the dialog path) and #8 (empty string → no
   render, no crash) with the actual shipped handler, not a
   reimplementation.
2. **`ipcMain.on` supports multiple listeners per channel.** A second,
   test-only listener added via `app.evaluate()` before a drop can
   count real `REQUEST_OPEN_FILE` sends without touching the production
   listener. Combined with a **real** `document.dispatchEvent(new
   DragEvent('drop', { dataTransfer: <2 files> }))` fired from
   `page.evaluate()` (exercising the actual `renderer.js` wiring,
   actual preload `openDroppedFile`, actual `ipcRenderer.send`), this
   proves guardrail #2 ("only one open requested") through the real
   call chain — the count assertion the guardrail's own wording asks
   for, without needing to distinguish *which* file by content.
3. **`event.defaultPrevented` / `dispatchEvent`'s boolean return** are
   observable on a synthetic (untrusted) event regardless of whether
   Chromium would apply its native default action to an untrusted
   event. This proves *our handler calls `preventDefault()`* — the
   thing guardrail #3 requires us to add — deterministically. It does
   **not** prove Chromium's native navigate-away default is thereby
   suppressed for a genuine OS drag; that half stays a one-time manual
   baseline observation (drag a real `.md` file onto the running dev
   build with the fix reverted, then applied), recorded in the review
   report, per guardrail #3's own instruction — not encoded as an
   automated assertion of something outside this app's control.
4. **`dragenter`/`dragleave` dispatched at a nested child element**
   (`bubbles: true`, targeted at e.g. `#content` rather than
   `document`) exercise the real depth-counter logic via normal DOM
   bubbling — this does not require a native OS drag either, so
   guardrail #5's fault-injection is expected to be practical; only
   report it as impractical if empirical attempts during implementation
   show otherwise.

If any of 1–4 behaves differently than predicted here once actually
run, the engineer reports the real behavior rather than forcing the
plan — that's the point of investigating instead of assuming, same
standard as Task 15's `removeMenu()` confirmation.

**Resulting layers:**

- **Unit** (`tests/unit/firstDroppedFile.test.ts`): empty list → `null`;
  single file → that file; multiple files → specifically index `0`
  (not last, not all) — catches a `files[1]`/`files.at(-1)` regression
  directly, independent of the e2e layer.
- **Integration** (extend `tests/integration/preload-api-contract.test.ts`):
  `IPC_CHANNELS.REQUEST_OPEN_FILE` is a non-empty string, distinct from
  both existing channels (same shape as the existing `FILE_RENDERED`/
  `VIEW_SETTINGS` pair-distinctness test). A `BridgeApi`-shaped literal
  including `openDroppedFile` type-checks (same `tsc --strict`-backed
  proof pattern as the existing `FileRenderedOk` constructibility test).
- **E2E** (`tests/e2e/drag-drop.spec.ts`): the four cases in items 1–4
  above, plus a case confirming the drag-over class is absent at rest
  and present mid-drag before any drop/leave resolves it.

### Fault-injection proofs required (map to functional_domain.md guardrails)

1. Remove both `preventDefault()` calls (dragover, drop) → the
   `event.defaultPrevented` e2e assertion (item 3) must go RED. Restore,
   confirm GREEN.
2. Change the main handler to call `sendToRenderer({ ok: true, ... })`
   directly instead of `renderAndWatch(filePath)` → the `ipcMain.emit`
   non-`.md`-path e2e assertion (item 1) must go RED (no "Not a
   Markdown file" text appears). Restore, confirm GREEN.
3. Change `firstDroppedFile` to return `fileList[fileList.length - 1]`
   → the unit test must go RED. Separately, change the renderer's drop
   handler to call `openDroppedFile` once per file in the list instead
   of once for `firstDroppedFile(...)` → the `ipcMain` counter e2e
   assertion (item 2) must go RED. Restore both, confirm GREEN both.
4. Swap the depth-counter for a naive direct toggle (`dragenter` → add
   class, `dragleave` → remove class, no counter) → the nested-element
   e2e assertion (item 4) must go RED (highlight flickers off while
   still over the drop target). Restore, confirm GREEN. If this
   specific scenario proves impractical to simulate deterministically
   in Playwright once actually attempted, state that explicitly in the
   review report rather than silently omitting the fault-injection —
   per the functional-domain guardrail's own instruction.

### Governance note

No ADR needed for the bridge-method shape itself — `openDroppedFile`
is an additive member on an interface whose Facade/DIP treatment was
already decided in Step 0/ADR-001; this task doesn't change *how* the
bridge works, only adds one more crossing through the same mechanism.
Worth one `DEVLOG.md`/`backlog.md` sentence at close-out noting the
guardrail #10 investigation's actual outcome (which of items 1–4 held
up as predicted vs. needed adjustment), so the renderer→main-boundary
testing approach is discoverable for whichever future task needs a
renderer→main crossing next, rather than being re-derived from scratch.

## Task 17 Technical Specification — File Tree: Foundation

Maps `functional_domain.md`'s Task 17 analysis to concrete design. This
is the first task to introduce **request-response** IPC
(`ipcMain.handle`/`ipcRenderer.invoke`) — every prior crossing, in
either direction, is fire-and-forget (`.on`/`.send`). The Facade/DIP
split (ADR-001) is exercised in a third mechanical shape (main→renderer
push, Task 1–15; renderer→main push, Task 16; now renderer↔main
request-response), not a new architectural direction — `BridgeApi`
stays the sole crossing point regardless of which transport a given
method uses underneath it.

### The Inward Dependency Rule

- `src/main/fileTree.ts` is a new peripheral-adjacent pure module: no
  `fs`, no `electron` import. It sits at the same layer as
  `src/main/watcher.ts`'s `classifyWatchEvent` and `src/main/paths.ts`'s
  `baseUrlForFile` — domain logic (what belongs in a tree listing, how
  it's ordered) stays independent of the I/O mechanism (`fs.readdir`)
  that supplies its raw input.
- `src/main/index.ts`'s `listDirectoryEntries(dirPath)` is the I/O
  wrapper at the periphery — same layering role as `renderFile()`
  wrapping `markdownToHtml()`. It owns the one effectful call
  (`fs.readdir`) and translates both success and thrown failure into
  the `DirectoryListResult` contract; `fileTree.ts` itself never touches
  a filesystem.
- `establishTreeRoot(rootPath)` is the single composition point both
  triggers converge on — `renderAndWatch` (auto-detect, existing
  function extended) and the new `openFolderViaDialog` (explicit). Same
  discipline `renderAndWatch` itself already enforces for file-open
  triggers (functional_domain.md Task 2, guardrail #3): no duplicate ad
  hoc tree-establishing logic per trigger.
- The renderer still never imports `electron` or `node:*`; its only
  channel outward remains `window.mdview`. This task adds two named
  methods to that surface, not a second channel out.

### SOLID Boundary Scan / Pattern Application

- **SRP** — `fileTree.ts` owns exactly one responsibility: mapping raw
  `{name, isDirectory}` pairs into sorted, filtered `TreeEntry[]`. It
  does not read directories (`listDirectoryEntries` in `index.ts` does)
  and does not construct IPC envelopes (`listDirectoryEntries`/
  `establishTreeRoot` do, by wrapping this function's return value in
  `{ok, dirPath, entries}`/`{ok, rootPath, entries}`).
- **ISP / Facade (extends ADR-001)** — `BridgeApi` gains exactly two new
  named methods, `onFolderTreeRoot` and `listDirectory`. No generic
  `invoke(channel, ...args)` passthrough (functional_domain.md guardrail
  #6) — matches Task 16's established framing for this interface: each
  capability is its own explicit member, never a wider surface than the
  domain operation needs.
- **DIP** — the renderer depends on the `BridgeApi` interface only, not
  on `ipcRenderer` mechanics or on which transport (`send`/`on` vs.
  `invoke`/`handle`) a given method uses underneath. That transport
  choice is an implementation detail of the preload layer, invisible
  across the boundary.
- **Adapter (extension of an existing pattern, not a new one)** —
  `listDirectoryEntries()` adapts `fs.readdir`'s throw-based error
  signaling into the `DirectoryListResult` discriminated union, the same
  translation `renderFile()` already performs for `fs.readFile` via
  try/catch → `{ok: false, ...}`. No new GoF pattern class is introduced
  by this task; it reuses the "pure leaf module + effectful wrapper"
  separation already established for markdown rendering and extends it
  to directory listing.
- **Idempotent command guard** — `establishTreeRoot`'s
  `rootPath === currentTreeRoot` early return (functional_domain.md
  guardrail #4) is the same "cheap equality check before doing
  expensive/observable work" shape already used implicitly by
  `stopWatching()`/`startWatching()`'s "close the old one first" — not
  named as a formal GoF pattern, just consistent defensive design
  already present in this codebase.

### Exact changes (authoritative)

**`src/preload/api.ts`**
```ts
export const IPC_CHANNELS = {
  FILE_RENDERED: 'md-view:file-rendered',
  VIEW_SETTINGS: 'md-view:view-settings',
  REQUEST_OPEN_FILE: 'md-view:request-open-file',
  FOLDER_TREE_ROOT: 'md-view:folder-tree-root',
  REQUEST_LIST_DIRECTORY: 'md-view:request-list-directory',
} as const;

export interface TreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}
export interface DirectoryListOk { ok: true; dirPath: string; entries: TreeEntry[]; }
export interface DirectoryListError { ok: false; dirPath: string; error: string; }
export type DirectoryListResult = DirectoryListOk | DirectoryListError;

export interface FolderTreeRootOk { ok: true; rootPath: string; entries: TreeEntry[]; }
export interface FolderTreeRootError { ok: false; rootPath: string; error: string; }
export type FolderTreeRootMessage = FolderTreeRootOk | FolderTreeRootError;

export interface BridgeApi {
  readonly version: string;
  onFileRendered(callback: (message: FileRenderedMessage) => void): void;
  onViewSettings(callback: (settings: ViewSettings) => void): void;
  openDroppedFile(file: File): void;
  onFolderTreeRoot(callback: (message: FolderTreeRootMessage) => void): void;
  listDirectory(dirPath: string): Promise<DirectoryListResult>;
}
```
Mirrors `FileRenderedOk`/`FileRenderedError`'s discriminated-union shape
exactly, per functional_domain.md's Abstract Schema Contracts — Task 2's
own idiom, not a new one.

**`src/preload/index.ts`**
```ts
onFolderTreeRoot: (callback) => {
  ipcRenderer.on(IPC_CHANNELS.FOLDER_TREE_ROOT, (_event, message: FolderTreeRootMessage) => callback(message));
},
listDirectory: (dirPath) => {
  return ipcRenderer.invoke(IPC_CHANNELS.REQUEST_LIST_DIRECTORY, dirPath);
},
```
`onFolderTreeRoot` reuses the existing `.on` push pattern
(`onFileRendered`/`onViewSettings`'s shape). `listDirectory` is the
first use of `ipcRenderer.invoke` anywhere in this codebase — the new
request-response pattern this task introduces.

**`src/main/fileTree.ts`** (new, pure — no `fs`, no `electron`)
```ts
export function filterAndSortEntries(
  raw: { name: string; isDirectory: boolean }[],
  dirPath: string
): TreeEntry[] {
  // keep all directories; keep files only if name.toLowerCase().endsWith('.md');
  // sort: directories before files, case-insensitive alphabetical within each group;
  // path: path.join(dirPath, name)
}
```

**`src/main/index.ts`**
```ts
import { filterAndSortEntries } from './fileTree';
// ...
let currentTreeRoot: string | null = null; // session-scoped, never persisted —
// same explicit precedent as viewSettings's "resets to this exact default on
// every launch, regardless of a prior session's choices" (functional_domain.md
// Task 8 guardrail #6, extended here per Task 17 guardrail #7)

async function listDirectoryEntries(dirPath: string): Promise<DirectoryListResult> {
  try {
    const raw = await fs.readdir(dirPath, { withFileTypes: true });
    const entries = filterAndSortEntries(
      raw.map((d) => ({ name: d.name, isDirectory: d.isDirectory() })),
      dirPath
    );
    return { ok: true, dirPath, entries };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, dirPath, error: message };
  }
}

ipcMain.handle(IPC_CHANNELS.REQUEST_LIST_DIRECTORY, (_e, dirPath: string) =>
  listDirectoryEntries(dirPath)
);

async function establishTreeRoot(rootPath: string): Promise<void> {
  if (rootPath === currentTreeRoot) return; // guardrail #4: no-op, no re-fetch, no event
  const result = await listDirectoryEntries(rootPath);
  currentTreeRoot = rootPath;
  const message: FolderTreeRootMessage = result.ok
    ? { ok: true, rootPath, entries: result.entries }
    : { ok: false, rootPath, error: result.error };
  mainWindow?.webContents.send(IPC_CHANNELS.FOLDER_TREE_ROOT, message);
}

async function renderAndWatch(filePath: string): Promise<void> {
  const message = await renderFile(filePath);
  sendToRenderer(message);
  if (message.ok) {
    startWatching(filePath);
  }
  await establishTreeRoot(path.dirname(filePath));
}

async function openFolderViaDialog(): Promise<void> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return;
  await establishTreeRoot(result.filePaths[0]); // touches nothing document-related
}
```
`establishTreeRoot` is called from `renderAndWatch` regardless of
whether `message.ok` — even a failed render still has a real containing
directory worth treating as the tree root (matches guardrail #5's
framing: tree-root establishment is independent of document state).
`openFolderViaDialog` calls only `establishTreeRoot` — never
`renderFile`, never touches `activeWatcher` — satisfying guardrail #5
structurally, not by convention.

**`src/main/menu.ts`**
```ts
export interface MenuHandlers {
  onOpen: () => void;
  onOpenFolder: () => void;
  onToggleDarkMode: (checked: boolean) => void;
  onToggleShowFrontmatter: (checked: boolean) => void;
  onOpenHelp: () => void;
}
// File submenu, right after 'Open…':
{ id: 'menu-open-folder', label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: handlers.onOpenFolder },
```

**`app.whenReady()` wiring** — `onOpenFolder: openFolderViaDialog` added
to the existing `buildMenuTemplate(...)` handlers object.

### Test architecture

This task ships no renderer UI, so its e2e coverage crosses the real
preload `contextBridge` directly via `page.evaluate()` calling
`window.mdview.listDirectory(...)`/`window.mdview.onFolderTreeRoot(...)`
— genuine end-to-end proof of everything on this task's side of the
boundary, the same technique Task 16's guardrail #1/#2 proofs used, just
without a DOM interaction driving it (there is no DOM interaction to
drive yet). Three concrete real-fs fixtures back both the integration
and e2e layers so both assert against the identical on-disk shape:
`tests/e2e/fixtures/tree/{notes.md, ignored.txt, sub/deep.md,
empty-of-md/}`.

**Resulting layers:**

- **Unit** (`tests/unit/fileTree.test.ts`): `filterAndSortEntries`
  against fabricated arrays only, no real `fs` — `.md` kept, non-`.md`
  dropped, all directories kept regardless of name, dirs-before-files
  and case-insensitive sort, empty input, mixed-case extensions.
- **Integration** (`tests/integration/fileTree.test.ts`): real
  `fs.readdir` against the real fixture tree, same pattern as
  `tests/integration/watcher.test.ts`'s real-chokidar approach — full
  `listDirectoryEntries()` result including the `{ok:false}` path
  against a nonexistent directory. Extend
  `tests/integration/preload-api-contract.test.ts` with the two new
  `IPC_CHANNELS` strings (non-empty, distinct from all existing ones)
  and a `BridgeApi`-literal constructibility check including
  `onFolderTreeRoot`/`listDirectory`, same shape as the existing Task 16
  block.
- **Unit** (`tests/unit/menu.test.ts`): extend for `menu-open-folder`
  (id, label, accelerator, click wiring), same coverage style as the
  existing `menu-open` assertions.
- **E2E** (`tests/e2e/file-tree.spec.ts`): `listDirectory` against the
  real fixture dir (asserting the exact filtered/sorted shape) and
  against a nonexistent path (`{ok:false}`); opening a fixture file via
  the existing dialog-mock pattern and asserting `onFolderTreeRoot`
  fires with `rootPath` = the fixture's parent dir and correct entries;
  triggering Open Folder… via its own dialog mock and asserting the same
  `FOLDER_TREE_ROOT` shape plus **no** `FILE_RENDERED` event as a side
  effect (guardrail #5).

### Fault-injection proofs required (map to functional_domain.md guardrails)

1. **FI-1** — remove the `rootPath === currentTreeRoot` guard in
   `establishTreeRoot` → a test switching files within the same folder
   must go RED (tree root re-sent redundantly). Restore, confirm GREEN.
2. **FI-2** — drop the `.md` filter (let all files through) → the unit
   test must go RED (non-`.md` entries appear). Restore, confirm GREEN.
3. **FI-3** — return raw unsorted `readdir` order instead of the sorted
   result → the determinism test must go RED. Restore, confirm GREEN.
4. **FI-4** — make `listDirectoryEntries` throw instead of resolving
   `{ok:false}` on a bad path → the e2e test's `invoke()` call must
   surface as a caught rejection, not a silent hang, proving the
   boundary-safety contract is actually exercised rather than assumed.
   Restore, confirm GREEN.

### Governance note

This is the first request-response IPC pattern in the app — worth a
`DEVLOG.md` entry documenting it as a first-of-kind architectural
change, same convention as prior first-of-kind entries (Task 14's
IPC-free Help window, Task 16's first renderer→main crossing). The
engineer drafts it; the Lead reviews before it goes to disk, not written
directly by the engineer. Per the still-open `backlog.md` item on Task
16's close-out sequencing, `RUN_LOG.md`'s append and
`current_scope.json`'s deletion are held until the Lead has evaluated
`review_report_task17.md` — not automatic once the reviewer reaches its
own verdict. `current_scope.json`'s `in_scope` list includes
`.agents/specs/review_report_task17.md` from the start (Task 11's
precedent), avoiding the recurring `enforce-scope.mjs` self-exemption
gap hit in Tasks 6, 7, 9, 10, 12.

## Task 18 Technical Specification — File Tree Tree-Root Path-Casing Fix

Maps `functional_domain.md`'s Task 18 analysis to concrete design.

### The Inward Dependency Rule

No new module. `establishTreeRoot` (added in Task 17, inside
`src/main/index.ts`) is the only call site touched — same placement
discipline as Task 15's `removeMenu()` fix and Task 13's dock-icon
call: a targeted change inside the one function that already owns this
decision, no new abstraction layer introduced for it.

### SOLID Boundary Scan / Pattern Application

Not applicable at this scale — swapping a raw comparison for a
canonicalized one inside an already-owned function is below the
threshold where SRP/OCP/DIP or a GoF pattern says anything Task 17's
own spec hasn't already said. `establishTreeRoot` keeps its existing
single responsibility (decide whether the tree root actually changed,
and broadcast if so); this fix only changes what value that decision
is made against.

### Exact change (authoritative)

Two Node APIs can resolve a canonical on-disk path:
`fs.promises.realpath(path)` and the native-binding variant
`fs.realpath.native` (callback-based only — there is no documented
`fs.promises.realpath.native`, so using it requires wrapping it, e.g.
via `util.promisify`). These are **not** guaranteed interchangeable
regarding case-preservation on Windows across Node versions. The
engineer must empirically verify which one actually returns the
real on-disk casing on this machine (e.g. call each against a path
typed in the wrong case and inspect the result) before committing to
one — per this project's standing "verify, don't assume" practice
(Task 15's `removeMenu()` confirmation, Task 6's theme-CSS-existence
check) — and state which was chosen and why in the review report.

```ts
async function establishTreeRoot(rawRootPath: string): Promise<void> {
  let resolvedRootPath: string;
  try {
    resolvedRootPath = await <chosen realpath call>(rawRootPath);
  } catch {
    // Canonicalization failed (e.g. ENOENT — directory deleted between
    // the open action and this call). Fall back to the raw path;
    // listDirectoryEntries below will independently hit the same
    // failure and correctly resolve {ok:false}, same as any other
    // unreadable-directory case (functional_domain.md Task 17
    // guardrail #3, unchanged by this fix).
    resolvedRootPath = rawRootPath;
  }
  if (resolvedRootPath === currentTreeRoot) return;
  const result = await listDirectoryEntries(resolvedRootPath);
  currentTreeRoot = resolvedRootPath;
  const message: FolderTreeRootMessage = result.ok
    ? { ok: true, rootPath: resolvedRootPath, entries: result.entries }
    : { ok: false, rootPath: resolvedRootPath, error: result.error };
  mainWindow?.webContents.send(IPC_CHANNELS.FOLDER_TREE_ROOT, message);
}
```
`currentTreeRoot` continues to be set unconditionally regardless of
`result.ok` — Task 17's existing, already-reviewed behavior, unchanged
here. The broadcast payload's `rootPath` is always `resolvedRootPath`,
never `rawRootPath` — every future comparison and every
`FOLDER_TREE_ROOT` payload stays consistent from this point forward.

`renderAndWatch` and `openFolderViaDialog` need zero changes — both
already call `establishTreeRoot(path.dirname(filePath))` /
`establishTreeRoot(result.filePaths[0])` with a raw path; resolution
is fully internal to `establishTreeRoot`.

`listDirectory`/`listDirectoryEntries`'s general lazy-expand path
(listing an arbitrary subfolder, not the root) is deliberately
untouched — this fix is scoped narrowly to the root-comparison bug
that was actually reported, not extended speculatively to every
directory-listing call site.

### Required test changes (TDD)

Extend `tests/e2e/file-tree.spec.ts` with one new case: open the tree
root once via the existing fixture path, then again via the same path
with `.toUpperCase()` applied, and assert exactly one `FOLDER_TREE_ROOT`
broadcast total (not two). This case is only meaningful on a
case-insensitive filesystem — guard it with
`test.skip(process.platform === 'linux', ...)` (with a comment
explaining why) rather than letting it silently pass or fail for the
wrong reason on a case-sensitive filesystem where the uppercased path
genuinely wouldn't exist. If this limitation turns out to need
adjusting once actually run, the engineer reports the real behavior
rather than forcing the plan.

### Fault-injection proof required (FI-5)

Temporarily revert the `realpath` call (restore the raw
`rootPath === currentTreeRoot` comparison), rebuild, run the new
casing-equivalence test, confirm it goes RED — two `FOLDER_TREE_ROOT`
broadcasts recorded instead of one, with two differently-cased
`rootPath` values (on a case-insensitive filesystem, `fs.readdir`
itself succeeds against either casing, so without the fix the second
`establishTreeRoot` call fully completes and broadcasts again rather
than erroring — that is exactly the spurious-reset bug, and the clean
RED signal for it). Restore the fix, rebuild, confirm GREEN.

### Regression check

Run the full existing Task 17 suite (all `file-tree.spec.ts` cases, all
fixtures) to confirm no regression — the existing fixture paths should
`realpath` to themselves unchanged, so this should be a no-op for them,
but the engineer must verify this empirically rather than assume it.

### Governance note

No ADR — this is a small, scoped bug fix closing a Task 17 spec gap,
not a new architectural decision. A `backlog.md` "Resolved" entry at
close-out is sufficient, cross-referencing the still-open Task 16
close-out-sequencing item (hold `RUN_LOG.md`/scope-contract deletion
until the Lead has evaluated `review_report_task18.md`). Per Task 17's
own review finding (S3), `current_scope.json`'s `in_scope` list
includes `.agents/specs/backlog.md`, `.agents/DEVLOG.md`, and
`.agents/metrics/RUN_LOG.md` from the start this time, not amended
reactively at close-out.

---

## Task 19 Technical Specification — E2E Suite Flakiness Under Parallel Load

Maps `functional_domain.md`'s Task 19 analysis to concrete design.

### Phase 1 baseline (Lead-run, before this spec was written)

Environment verified, not assumed: 8 logical CPUs on this machine;
`npx playwright test --reporter=line` self-reports **"Running 39 tests
using 4 workers"** (matches the 4 workers seen in past Task 16-18
sessions, now confirmed rather than presumed for this task). `npm run
build` run once before the 12 runs; each run reused that build (no
source changed between runs, so this is pure launch-timing variance).

12 consecutive `npx playwright test --reporter=line` runs, same
conditions, no config changes:

| Run | Result | Failing test | Error text |
|---|---|---|---|
| 1 | FAIL | `view-menu.spec.ts:134` "(d) close-and-relaunch proves no persistence of view settings" | `Error: worker process exited unexpectedly (code=3221226505, signal=null)` |
| 2 | PASS | — | — |
| 3 | PASS | — | — |
| 4 | PASS | — | — |
| 5 | PASS | — | — |
| 6 | FAIL | `open-file-argv.spec.ts:47` "shows a visible error state for a non-.md file selected via the dialog, and does not crash" | `Error: worker process exited unexpectedly (code=3221226505, signal=null)` |
| 7 | PASS | — | — |
| 8 | PASS | — | — |
| 9 | FAIL | `file-tree.spec.ts:294` "Open Folder… broadcasts FOLDER_TREE_ROOT and triggers zero FILE_RENDERED events" | `Test timeout of 30000ms exceeded.` |
| 10 | PASS | — | — |
| 11 | FAIL | `live-reload.spec.ts:17` "live-reloads rendered content when the open file changes on disk" | `expect(locator).toContainText(expected) failed … Received string: "" … Timeout: 10000ms` |
| 12 | PASS | — | — |

**8/12 fully green, 4/12 failed (one failing test per failing run, never
more than one).**

Cross-referenced against `backlog.md`'s three already-logged entries:

- `file-tree.spec.ts`'s "Open Folder…" test (run 9) and
  `live-reload.spec.ts`'s primer test (run 11) reproduced, both as a
  timeout under load — same signature already logged.
- `ui-shell.spec.ts:67` did **not** fail in this 12-run sample. Absence
  of a repro in 12 runs is not proof it's fixed — sample size is small
  relative to its historical one-in-several-dozen-runs rate — so it
  stays `[Pending]` in `backlog.md`, not marked resolved, pending
  Phase 2's own 12-run sample.
- Runs 1 and 6 are a **distinct, previously-unlogged failure class**:
  a hard worker-process crash (`code=3221226505` = Windows
  `STATUS_STACK_BUFFER_OVERRUN`/fastfail, not a graceful timeout), on
  two tests neither of which is one of the three backlog entries. This
  is explicitly *not* folded into "same class" by assumption — it is a
  different failure shape (process death vs. an assertion/test
  timeout) on different tests. It is, however, consistent with the
  same working hypothesis: a hard crash in a spawned Electron child
  process is at least as plausible an outcome of shared-profile
  resource contention (colliding writes to a `LOCK` file, `GPUCache`,
  or `Local Storage` under concurrent access) as a soft timeout is —
  arguably more consistent with contention than with a random flake.
  Phase 2 must report whether fixture-based isolation resolves this
  crash class too, not just the two already-logged timeout-class
  tests.

Correction to the task assignment's verified-context section: grepping
`electron.launch(` across `tests/e2e/**` found **40** call sites, not
43 (`app-launch:1, code-highlighting:1, drag-drop:7, external-links:2,
file-tree:7, help-menu:5, html-comments:1, live-reload:3,
open-file-argv:3, relative-images:1, ui-shell:3, view-menu:6`). Noted
per this project's standing verify-don't-assume practice; does not
change the plan, only the exact migration count in Phase 2's report.

### The Inward Dependency Rule

New peripheral-boundary module only: `tests/e2e/support/fixtures.ts`.
It depends outward on `@playwright/test`'s `_electron` and Node's `fs`/
`os`/`path` — same dependency direction every existing spec file
already has. No `src/**` file is touched (guardrail #1) and no
dependency points from `src/**` toward this file or vice versa; test
infrastructure stays fully outside the application's own dependency
graph.

### SOLID Boundary Scan / Pattern Application (GoF)

Single responsibility split: `fixtures.ts` owns exactly one decision —
how an `electronApp` instance is constructed and torn down for a test
— replacing 40 duplicated inline `electron.launch()` call sites (DRY)
that previously each owned that decision independently. This is a
**Factory Method** (the fixture function is the sole creator of
`ElectronApplication` instances) combined with Playwright's own
**options-fixture** mechanism to parameterize the factory's input
(`electronArgs`) per test — the same shape as a Builder's parameterized
construction step, without introducing a new abstraction beyond what
Playwright's `test.extend` already provides. Test bodies remain
consumers of the fixture via dependency injection
(`async ({ electronApp }) => {...}`), never constructing
`ElectronApplication` themselves — this is the DIP boundary: test
logic depends on the fixture's contract (an already-launched, already-
isolated app), not on `_electron.launch()`'s concrete construction
details.

### Fixture design (authoritative)

`tests/e2e/support/fixtures.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test as base, _electron as electron, type ElectronApplication } from '@playwright/test';

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const ENTRY_POINT = path.join(__dirname, '../../../dist/main/index.js');

export const test = base.extend<{
  electronArgs: string[];
  electronApp: ElectronApplication;
}>({
  electronArgs: [[], { option: true }],
  electronApp: async ({ electronArgs }, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-'));
    const app = await electron.launch({
      args: [ENTRY_POINT, ...electronArgs],
      env: childEnv,
      userDataDir,
    });
    await use(app);
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },
});

export { expect } from '@playwright/test';
```

`electronArgs` is a Playwright **options fixture** (`{ option: true }`),
set per test-or-describe-block via `test.use({ electronArgs: [...] })`
— chosen over a per-test-call parameter because it is Playwright's
documented mechanism for exactly this shape (data that varies per test
file but not per individual `use()` call), and keeps test bodies
themselves signature-identical
(`async ({ electronApp }) => {...}`) regardless of whether that test's
launch needs extra argv. Confirmed against actual call-site variance
(guardrail #14): `app-launch.spec.ts` needs no `electronArgs` (default
`[]`); `open-file-argv.spec.ts` needs a different fixture file path per
test within the *same* file — handled via one `test.describe` block per
distinct `electronArgs` value, each with its own `test.use(...)` at the
top, since Playwright scopes `test.use()` to its enclosing describe
block, not to a single `test()` call.

`await use(app)` is the load-bearing line for guardrail #15/FI-1:
Playwright guarantees the code after `use()` (`app.close()`, `fs.rmSync`)
runs during teardown even when the test body throws inside `use()`'s
scope — this is the documented behavior a hand-rolled
`try { ... } finally { ... }` helper cannot promise as reliably (a
helper only runs its cleanup if every call site remembers to wrap its
own body in try/finally; a fixture's teardown is structural, not
opt-in per call site).

### Migration (mechanical, all 40 call sites)

Each spec file: replace
`import { test, expect, _electron as electron } from '@playwright/test'`
with `import { test, expect } from './support/fixtures'` (relative path
adjusted per file depth — all spec files are flat under `tests/e2e/`,
so `./support/fixtures` from every file); delete the file-local
`childEnv` declaration (now centralized); replace each
`const app = await electron.launch({ args: [...], env: childEnv })`
call with consuming the injected `electronApp` fixture parameter,
adding `test.use({ electronArgs: [...] })` at the top of the enclosing
`test.describe` (or a new one wrapping a single test) wherever a call
site's `args` included more than the bare entry point. `await
app.close()` at the end of each test body is deleted — teardown is now
the fixture's job, not the test's. No assertion, no `expect(...)` line,
no test title changes anywhere (guardrail #2).

### Regression check

Phase 2's own 12-run repeat (spec's own required proof) is the
regression check for flakiness. Additionally: full `tsc --noEmit`,
`test:unit`, `test:integration` runs must stay green (untouched by this
task, but confirms nothing in the migration accidentally broke a
shared import path), and FI-1 (intentional single-test failure,
confirm tmp `userDataDir` removed anyway) is the fault-injection proof
for the teardown guarantee specifically.

### Governance note

No ADR for the fixture itself (mechanical test-infrastructure change,
same tier as Task 18). If Phase 2's 12-run comparison is inconclusive
or negative, no further architecture change is authorized under this
spec — `playwright.config.ts`'s `workers` setting is explicitly out of
scope (task assignment's "Out of scope" section) and any second
hypothesis requires reporting back to the user first, not silent
escalation.

---

## Task 20 Technical Specification — Fix Race Condition in "Open Folder…" E2E Test

Maps `functional_domain.md`'s Task 20 analysis to concrete design.

### The Inward Dependency Rule

No new module, no touched application code. Single call site inside
`tests/e2e/file-tree.spec.ts`, already outside `src/**`'s dependency
graph entirely (guardrail #4 — zero `src/**` diff).

### SOLID Boundary Scan / Pattern Application

Not applicable at this scale — this test already had four sibling
tests in the same file using the correct pattern; the fix is adopting
that same, already-established idiom in a fifth place, not introducing
new structure.

### Exact change (authoritative — verified against the live file before writing this spec)

Confirmed directly: lines 270-280 of `tests/e2e/file-tree.spec.ts`
(current content, not paraphrased) are

```ts
  const treeRootPromise = window.evaluate(() => {
    return new Promise((resolve) => {
      (window as unknown as { mdview: { onFolderTreeRoot: (cb: (m: unknown) => void) => void } }).mdview.onFolderTreeRoot(
        (message) => resolve(message)
      );
    });
  });

  await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open-folder')?.click());

  const treeRootMessage = (await treeRootPromise) as { ok: boolean; rootPath: string; entries: Array<{ name: string }> };
```

Replace with the accumulate-then-poll shape already used verbatim by
this same file's "opening a fixture file via File > Open…" test
(lines 66-85) and its three siblings:

```ts
  await window.evaluate(() => {
    (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents = [];
    (window as unknown as { mdview: { onFolderTreeRoot: (cb: (m: unknown) => void) => void } }).mdview.onFolderTreeRoot(
      (message) => {
        (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents.push(message);
      }
    );
  });

  await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open-folder')?.click());

  await expect
    .poll(async () =>
      window.evaluate(() => (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents.length)
    )
    .toBeGreaterThanOrEqual(1);

  const treeRootMessage = (await window.evaluate(
    () => (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents[0]
  )) as { ok: boolean; rootPath: string; entries: Array<{ name: string }> };
```

`__treeRootEvents` reset fresh at the top of this test is safe — Task
19's fixture already gives every test its own freshly-launched
Electron process and window, so there is no other test's leftover
`window` to collide with. Every assertion after this block (`ok`,
`rootPath`, `entries` containing `notes.md`, `#empty-state` visible,
`#content` empty, `__fileRenderedCount === 0`) is untouched.

### Regression check / required proof

A single fault-injection RED→GREEN can't reliably reproduce a timing
race on demand — use repeated runs instead, scoped to this one test:

1. Before the fix: `npx playwright test tests/e2e/file-tree.spec.ts -g
   "Open Folder" --repeat-each=30 --workers=4` against the current
   (racy) code. Report the raw result honestly either way — a clean
   30-repeat run does not disprove the race (already observed 4 times
   "in the wild" across separate sessions per `backlog.md`), and a
   reproduced failure is bonus confirmatory evidence, not a
   requirement for proceeding with the fix.
2. After the fix: the same `--repeat-each=30` command at both
   `--workers=4` and `--workers=2`, confirm clean, report raw counts.

### Governance note

No ADR — small, scoped bug fix, same tier as Task 18. `backlog.md`'s
existing "Open Folder…" flakiness entries get marked `[Resolved
<date>]` in place at close-out, not deleted, cross-referencing this
spec section for the mechanism.

---

## Task 21 Technical Specification — Tree Sidebar: Core Rendering, Lazy Expand, Click-to-Open

Maps `functional_domain.md`'s Task 21 analysis to concrete design.

### The Inward Dependency Rule

New rendering logic depends outward on `window.mdview` (the preload
bridge, Task 17's boundary) exactly the same way the existing
`renderer.js` already does — no new dependency direction. `src/main`
is untouched except for nothing at all: `REQUEST_OPEN_FILE`'s handler
(`src/main/index.ts` line ~317) already does zero validation beyond
non-empty-string before delegating to `renderAndWatch`, confirmed by
reading it directly — safe to reuse verbatim via a new preload method,
no main-process diff required for this task.

### SOLID/Pattern note

The tree is conceptually a Composite (folders contain children of
either kind, files are leaves, both respond to "render yourself") but
this codebase has no class hierarchy anywhere in the renderer — it's
plain DOM-manipulation functions, matching `renderHtml`/`renderError`'s
existing style. Forcing a class-based Composite here would be the kind
of premature structure this project has consistently avoided (e.g.
Task 11's presentational-only card chrome needed no pattern beyond
plain markup). One row-rendering function, called recursively for
nested levels, is the right-sized solution — same recursion-depth-
equals-tree-depth shape a Composite would produce, without inventing
a class hierarchy for two node kinds and ~7 behaviors total.

### File-module decision

Keep the new tree logic inside `src/renderer/renderer.js` rather than
splitting to a sibling file. Splitting is architecturally reasonable
(this app already uses per-concern leaf modules on the main-process
side — `dockIcon.ts`, `devtools.ts`, `fileTree.ts`, `helpWindow.ts`),
but `package.json`'s `build` script copies every `dist/renderer/*`
asset via **individually listed** `copyFileSync` calls (verified — no
wildcard/glob copy exists), so a new renderer file requires both a new
`<script>` tag in `index.html` AND a new `copyFileSync` line in
`package.json`'s build script, or the file silently never ships to
`dist/renderer/` and every e2e test depending on it fails opaquely.
Given `renderer.js` is not yet large enough to be genuinely unwieldy
even after this task's addition, the lower-risk default is one file.
**If the engineer's own judgment during implementation says split
anyway, both required changes above are mandatory, not optional — say
so explicitly in the delivery report either way.**

### HTML/CSS structure (authoritative)

```html
<body>
  <div id="app-body">
    <div id="tree-panel">
      <div id="tree-empty-state">No folder open.</div>
      <div id="tree-root" hidden></div>
    </div>
    <div id="main-panel">
      <div id="empty-state">...</div>          <!-- unchanged content -->
      <div id="document-container">...</div>   <!-- unchanged content -->
    </div>
  </div>
  <div id="status-bar">...</div>                <!-- unchanged -->
  <script src="./renderer.js"></script>
</body>
```

`#status-bar` is already `position: fixed; left:0; right:0; bottom:0`
(`app.css`, confirmed) — fully out of normal flow, so wrapping
`#empty-state`/`#document-container` in `#app-body` cannot itself
shift `#status-bar`'s position; guardrail #24's regression risk is
about `#empty-state`/`#document-container`'s own computed styles
(padding, max-width, centering), not `#status-bar`.

CSS: `#app-body` is `display: flex; flex-direction: row;` filling the
space above `#status-bar` (`body`'s existing `padding-bottom: 2rem`
already reserves that clearance — untouched). `#main-panel` gets
`flex: 1 1 auto; min-width: 0;` (the `min-width: 0` is load-bearing —
without it a flex child containing `#document-container`'s own
`width: calc(100% - 4rem)` can refuse to shrink below its content's
natural width and overflow the row). `#tree-panel` gets a fixed width
via a single CSS custom property, e.g. `--tree-panel-width: 260px;`
declared on `:root` and consumed as `width: var(--tree-panel-width);`
on `#tree-panel` — trivial for a later task (resize handle, Task 22)
to override via a single inline `style.setProperty` call without
restructuring this HTML/CSS again. Every new element
(`#tree-panel`, `#tree-empty-state`, `#tree-root`, and whatever class
tree rows use) needs a `body.dark-mode #id`/`.class` rule per
guardrail #25 — follow the file's existing per-ID scoping exactly, do
not invent a CSS variable-based theme mechanism this file doesn't
already use elsewhere.

### New BridgeApi method (authoritative)

`src/preload/api.ts`, added to the `BridgeApi` interface:
```ts
openFileByPath(filePath: string): void;
```

`src/preload/index.ts`, added to the `api` object:
```ts
openFileByPath: (filePath) => {
  ipcRenderer.send(IPC_CHANNELS.REQUEST_OPEN_FILE, filePath);
},
```
No new `IPC_CHANNELS` entry — reuses `REQUEST_OPEN_FILE` verbatim,
same channel `openDroppedFile` already sends on.

### Rendering/interaction logic (renderer.js)

1. `window.mdview.onFolderTreeRoot((message) => {...})`:
   `ok:false` → clear `#tree-root`'s children, hide it, show
   `#tree-empty-state` with an inline error variant (reuse the same
   element, swap its text — a second dedicated error element is not
   needed for one line of text). `ok:true` → clear `#tree-root`'s
   children (guardrail #27 — full replace, never append), render
   `message.entries` as the top level, un-hide `#tree-root`, hide
   `#tree-empty-state`.
2. Row rendering (one function, called recursively for nested levels):
   each `TreeEntry` becomes a row. Directories get an expand
   affordance plus a children container that starts `hidden` and
   starts with **no children rendered yet** (not merely hidden —
   genuinely empty, so "has this folder ever been fetched" is
   determinable by checking whether the container has any child
   nodes, no separate boolean flag needed). Files are plain leaf rows,
   no affordance, no children container.
3. Folder row click: if the children container already has content
   (regardless of current hidden/visible state) → toggle `hidden`
   only, zero fetch (guardrail #21). If empty → show a lightweight
   loading indicator on the row, `await window.mdview.listDirectory(entry.path)`,
   remove the indicator; `ok:true` → render `result.entries` into the
   children container via the same row-rendering function (recursion),
   un-hide it; `ok:false` → render one inline error row into the
   children container in place of entries (guardrail #26), still
   un-hide it so the error is visible.
4. File row click: `window.mdview.openFileByPath(entry.path)` — one
   call, `entry.path` verbatim, nothing else (guardrail #22/#23). No
   local DOM update of any kind here; `FILE_RENDERED`'s existing
   pipeline (`onFileRendered` → `renderHtml`/`renderError`,
   `updateStatusBar`) handles everything, exactly as it already does
   for File>Open and drag-and-drop.

### FI-1 proof technique — the existing "coexisting listener" idiom does NOT directly transfer

This codebase's established counting-proof idiom (drag-drop.spec.ts's
multi-file-drop test, file-tree.spec.ts's "Open Folder…" zero-render
test) adds a **second** `ipcMain.on`/`ipcRenderer.on` listener
alongside the production one, because `.on()`-based channels support
multiple listeners per channel. `REQUEST_LIST_DIRECTORY` is
`ipcMain.handle`/`ipcRenderer.invoke` (Task 17's first request-
response pair) — Electron allows **exactly one** handler per channel;
registering a second throws. The idiom needs adaptation, not blind
reuse:

`listDirectoryEntries` is an exported function in `src/main/index.ts`
(confirmed: compiled `dist/main/index.js` contains
`exports.listDirectoryEntries = listDirectoryEntries;`). Since the
already-running main process has this module in Node's `require`
cache, calling `require(<same absolute dist/main/index.js path>)`
again from inside `electronApp.evaluate()` returns the exact same
cached `module.exports` object the app itself is using — not a
re-executed copy. This lets a test remove the production handler and
re-install a counting wrapper that still delegates to the real,
unmodified production logic:

```ts
const mainModulePath = path.join(process.cwd(), 'dist/main/index.js'); // same resolution as fixtures.ts's ENTRY_POINT

await electronApp.evaluate(({ ipcMain }, { channel, modulePath }) => {
  const mainModule = require(modulePath);
  (globalThis as any).__listDirectoryCallCount = 0;
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (_e: unknown, dirPath: string) => {
    (globalThis as any).__listDirectoryCallCount += 1;
    return mainModule.listDirectoryEntries(dirPath);
  });
}, { channel: IPC_CHANNELS.REQUEST_LIST_DIRECTORY, modulePath: mainModulePath });
```

Read the count afterward via
`electronApp.evaluate(() => (globalThis as any).__listDirectoryCallCount)`.
This preserves the "test the real production code path, count
invocations, don't fake the behavior" spirit of the existing idiom;
it just uses `removeHandler`+re-`handle`+delegate instead of a second
listener, because the IPC shape (request-response, single-handler)
is different from every prior guardrail-#2-style proof in this suite.
If the engineer finds a cleaner mechanism that preserves the same
two properties (real production logic still runs; count is
observable), that's an acceptable substitution — state the reasoning
in the delivery report either way.

### Tests — `tests/e2e/tree-panel.spec.ts`

Reuses `tests/e2e/fixtures/tree/` (no new fixtures): `notes.md`,
`ignored.txt`, `sub/deep.md`, `sub/deep2.md`, `empty-of-md/`. Uses the
Task 19 `tests/e2e/support/fixtures.ts` isolated-launch pattern like
every other spec file now does.

1. Opening a fixture file shows the tree panel with the root's
   top-level entries, correctly filtered/ordered (directories before
   `notes.md`, `ignored.txt` absent) — reuses the same expected-shape
   assertions as `file-tree.spec.ts`'s first test.
2. Clicking an unexpanded folder reveals its children, including
   `empty-of-md/` expanding to a genuinely empty (not error) state.
3. FI-1: temporarily remove the "already-populated, skip fetch" check,
   confirm the call-count test goes RED (2 calls on collapse/
   re-expand), restore, confirm GREEN.
4. Clicking a file row updates `#content`/`#status-bar` exactly as
   `open-file-argv.spec.ts`'s existing assertions verify for File>Open.
5. Dark mode toggle with a folder expanded to a nested level — real
   `getComputedStyle` checks on tree elements, same technique as
   `view-menu.spec.ts` test (c).
6. Full pre-existing suite (all specs predating this task) run and
   confirmed green — guardrail #24's proof, run explicitly and
   reported with raw pass/fail counts, not assumed.

### Governance note

No ADR — new UI surface built entirely from already-established
patterns (existing IPC contract, existing dark-mode convention,
existing e2e fixture/isolation pattern), not a new architectural
decision. Normal-weight review, not the abbreviated Task 18/20 tier —
this is real, non-trivial UI behavior with a genuine regression risk
(guardrail #24) attached.

---

## Task 22 Technical Specification — Replace Fixed-Wait Layout Reads with Poll-Until-Stable in ui-shell.spec.ts

Maps `functional_domain.md`'s Task 22 analysis to concrete design.

### The Inward Dependency Rule

New peripheral-boundary module only: `tests/e2e/support/pollUntilStable.ts`.
It depends on nothing beyond plain JS/TS (`setTimeout`/`Date.now` via a
small delay helper) — no Playwright import, no DOM, no Electron. This is
what makes it directly unit-testable under Vitest with a fake `read()`
rather than needing a real browser, the same "Electron-free leaf module"
discipline already used for `src/main/paths.ts`/`linkPolicy.ts`/etc.,
applied here to test infrastructure instead of application code.
`tests/e2e/ui-shell.spec.ts` depends outward on it exactly the way it
already depends on `./support/fixtures` — no new dependency direction.

### SOLID Boundary Scan / Pattern Application

**SRP** — `sameValues` (equality) and `pollUntilStable` (polling loop +
timeout) are two separate exported functions with two separate reasons
to change, not one function doing both inline. **OCP** — `pollUntilStable`
is generic over `T extends Record<string, number>`; adding a poll of a
new field set (a future check (i)-style assertion, say) requires zero
changes to the helper itself, only a new `read()` closure at the call
site. No new GoF pattern — this is the same "small pure/near-pure
reusable helper" tier as `classifyWatchEvent`/`needsFetch`, not a
Strategy/Template Method situation (there is exactly one polling
algorithm, not a family of interchangeable ones).

### Exact signature (authoritative)

```ts
// tests/e2e/support/pollUntilStable.ts
export function sameValues<T extends Record<string, number>>(a: T, b: T): boolean {
  return (Object.keys(a) as Array<keyof T>).every((key) => a[key] === b[key]);
}

export async function pollUntilStable<T extends Record<string, number>>(
  read: () => Promise<T>,
  options?: { stableReads?: number; intervalMs?: number; timeoutMs?: number }
): Promise<T> {
  const stableReads = options?.stableReads ?? 5;
  const intervalMs = options?.intervalMs ?? 20;
  const timeoutMs = options?.timeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;

  let last = await read();
  let consecutive = 1;

  while (consecutive < stableReads) {
    if (Date.now() > deadline) {
      throw new Error(
        `pollUntilStable: value never stabilized within ${timeoutMs}ms (last read: ${JSON.stringify(last)})`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const next = await read();
    consecutive = sameValues(next, last) ? consecutive + 1 : 1;
    last = next;
  }

  return last;
}
```

`intervalMs` (default 20ms, not specified in the task assignment but
needed to make the loop concrete) is deliberately short relative to
`timeoutMs` — five consecutive stable 20ms-apart reads is a ~100ms best
case (matching what the fixed wait it replaces already assumed was
"enough"), while genuinely unsettled layouts get up to 5000ms to
converge before the helper gives up loudly. The timeout check happens
before each additional wait, not after — a `read()` call that itself
hangs is not this helper's concern (Playwright's own action timeouts
already bound `.evaluate()` calls), only "keeps changing" is.

### Call-site changes (authoritative — both within `tests/e2e/ui-shell.spec.ts`)

Check (g) (around current line 115-123): replace
```ts
await window.waitForTimeout(100);

const defaultWidthBox = await documentContainer.evaluate((el) => {
  const style = window.getComputedStyle(el);
  return {
    marginLeft: parseFloat(style.marginLeft),
    marginRight: parseFloat(style.marginRight),
  };
});
```
with
```ts
const defaultWidthBox = await pollUntilStable(() =>
  documentContainer.evaluate((el) => {
    const style = window.getComputedStyle(el);
    return {
      marginLeft: parseFloat(style.marginLeft),
      marginRight: parseFloat(style.marginRight),
    };
  })
);
```

Check (h) (around current line 139-148): same transformation, `read()`
returning `{ width, marginLeft, marginRight }` instead. In both cases
every line after the read (the `expect(...)` assertions) is untouched —
this is a measurement-mechanism swap only, not a logic change. New
import at the top of the file: `import { pollUntilStable } from
'./support/pollUntilStable';`.

### Required proof (authoritative — matches the task assignment's own two-level requirement)

1. `tests/unit/pollUntilStable.test.ts` (Vitest, no Playwright/DOM): a
   fake `read()` returning a counter-driven sequence — changing values
   for the first K calls, then stable — with small `stableReads`/
   `intervalMs` so the suite runs in milliseconds. Minimum cases:
   settles correctly once genuinely stable; returns as soon as N-in-a-
   row match without over-polling past that point (assert the fake
   `read()`'s call count, not just the return value); throws when
   `read()` never stabilizes within a short `timeoutMs`. This is this
   task's fault-injection-equivalent — deterministic, independent of
   real Electron/Chromium timing.
2. Real-world confidence check (run, not assumed): `npx playwright test
   tests/e2e/ui-shell.spec.ts --repeat-each=20`, then the full suite 5x
   at the project's default `workers: 2` (same methodology as Tasks
   19/20). Report raw pass/fail counts honestly. Per the task
   assignment's own framing: this fix targets the specific
   "read-before-settling" failure mode: `pollUntilStable` reading a
   truly-unsettled layout for the full `timeoutMs` (Task 19's deeper,
   unrelated contention issue manifesting as something worse than a
   momentary render lag) is explicitly out of this task's claim to fix,
   and should be reported as such if ever observed rather than silently
   absorbed into "it passed."

### File tree — Task 22 additions/changes

```
md-view/
├── tests/
│   ├── e2e/
│   │   ├── ui-shell.spec.ts             # ~ checks (g)/(h) only, per above
│   │   └── support/
│   │       └── pollUntilStable.ts       # NEW — sameValues + pollUntilStable
│   └── unit/
│       └── pollUntilStable.test.ts      # NEW
├── .agents/
│   ├── specs/backlog.md                 # ~ targeted note, cross-referenced to
│   │                                     #   Task 19's still-open item (not resolved)
│   ├── DEVLOG.md                        # ~ brief entry
│   └── metrics/RUN_LOG.md               # ~ append-only row, held until Lead
│                                         #   sign-off per process notes
```

### Governance note

No ADR — small, scoped test-infrastructure fix, same tier as Task
18/19/20. `backlog.md`'s Task 19/21 entries on `ui-shell.spec.ts`
flakiness are annotated in place (cross-referenced, not deleted) to
note this task's narrower scope: it fixes the "read before settling"
symptom specifically and explicitly does not claim to resolve Task 19's
broader, still-open concurrent-process contention question.

---

## Task 23: Tree Panel — Drag-to-Resize

### The Inward Dependency Rule

This task has no core-domain component to speak of — `clampWidth` (the
one pure transformation, per `functional_domain.md` Task 23) is trivial
enough to inline at its single call site rather than extract to a
separate module; extracting it would be ceremony without a second
caller. The dependency direction that matters here is narrower: the DOM
event-wiring (`renderer.js`) is the only outer layer touched, and it
does not reach into main-process or IPC code at all (a first for the
tree-panel line of tasks) — confirming this is a leaf, presentation-only
concern.

### SOLID Boundary Scan

- **SRP.** Three concerns stay visually and structurally separate:
  (1) the handle's own layout/paint (CSS), (2) drag-lifecycle wiring —
  when tracking starts/stops (the `mousedown`/`mouseup` listeners),
  (3) the width computation itself (the clamp math on `mousemove`). All
  three already read as separable in the task's own reference JS; no
  restructuring needed to keep them separable in the real diff.
- **OCP.** `MIN_TREE_WIDTH`/`MIN_MAIN_PANEL_WIDTH` are named constants at
  the top of the wiring code, not inlined into the clamp expression —
  changing either bound later is a one-line edit, not a re-derivation.
- **DIP.** N/A at this scale — no abstraction/interface boundary is
  warranted for two DOM listeners and one arithmetic clamp. Introducing
  an interface here would violate the repo's own stated bias (`CLAUDE.md`
  — prefer composition, avoid speculative abstraction) for zero benefit,
  since there is exactly one concrete implementation and no reason to
  expect a second.

### Pattern Application

No GoF pattern is introduced. This is intentional, not an omission:
Task 21's tree rendering already uses a Composite-shaped-without-a-class
recursive function where the recursion itself does the pattern's job;
this task's drag logic is a standard, well-known "attach/detach
document-level listeners across a drag lifecycle" idiom with no
structural decision point that a pattern would clarify. Forcing a
Strategy/Command wrapper around one clamp function would be pattern
application for its own sake.

### HTML — `src/renderer/index.html`

Insert `<div id="tree-resize-handle"></div>` as a new sibling between
the existing `#tree-panel` and `#main-panel` divs inside `#app-body`.
No other markup changes.

### CSS — `src/renderer/app.css`

- New `#tree-resize-handle` rule block: `flex: 0 0 auto`, a multi-pixel
  hit area (not a literal 1px target) with cursor `col-resize`, a thin
  1px visible divider line inside the hit area, and a hover state
  (subtle background/line-color shift).
- **Divider-line decision: the handle replaces `#tree-panel`'s existing
  `border-right`, rather than sitting alongside it.** Keeping both would
  put two visually competing divider lines directly adjacent to each
  other for no benefit — the handle's own internal 1px line is the
  single divider going forward. `#tree-panel`'s `border-right: 1px solid
  #d0d7de;` (and its `body.dark-mode #tree-panel` `border-right-color`
  counterpart) is removed as part of this change.
- New `body.resizing-tree-panel` rule: forces `cursor: col-resize` and
  `user-select: none` at the document level, added only for the
  duration of an active drag (guardrail #38).
- `body.dark-mode #tree-resize-handle` (rest + hover) rules, following
  the file's existing per-ID dark-mode convention (guardrail #39).

### JS — `src/renderer/renderer.js`

Added in the same `Task 21: tree sidebar` region as the existing
`treePanelEl`/`treeEmptyStateEl`/`treeRootEl` lookups (around line 216):
a `treeResizeHandleEl` lookup, two named constants
(`MIN_TREE_WIDTH = 180`, `MIN_MAIN_PANEL_WIDTH = 300`), and one
`mousedown` listener on the handle that, per-drag, attaches/detaches
`document`-level `mousemove`/`mouseup` listeners exactly as specified in
the task assignment's reference implementation (`clientX` maps directly
to width, `maxTreeWidth` recomputed from live `window.innerWidth` on
every `mousemove`, width written via
`document.documentElement.style.setProperty('--tree-panel-width', ...)`).
This is a direct, unmodified application of the task assignment's own
code — no deviation from that reference is warranted or introduced.

### Required proof (fault injection — authoritative per task assignment)

- **FI-1:** temporarily delete the `Math.min`/`Math.max` clamp → a test
  dragging past both `MIN_TREE_WIDTH` and the dynamic max must fail
  (catching an out-of-clamp computed width) → restore → GREEN.
- **FI-2** (protects guardrail #34 specifically): temporarily replace the
  dynamic `maxTreeWidth` with a fixed constant (e.g. `600`) → a test that
  first shrinks the `BrowserWindow` to `480×640` (`electronApp.evaluate`
  + `setBounds`, the same pattern `ui-shell.spec.ts` already uses) then
  drags toward the old fixed max must show `#main-panel`'s computed width
  fall below `MIN_MAIN_PANEL_WIDTH` → restore → GREEN.

### Tests — `tests/e2e/tree-panel.spec.ts`

Playwright real-mouse simulation (`page.mouse.down/move/up`) driving an
actual drag, then reading `#tree-panel`'s computed width — never a
synthetic `style.setProperty()` standing in for a real drag. Coverage:
normal mid-range resize; drag past `MIN_TREE_WIDTH`; drag past the
dynamic max at both the default and a shrunk (480px) window width; FI-1
and FI-2's fault-injection proofs; width back to `260px` (no
persistence) after a fresh `electronApp` relaunch.

### File tree — Task 23 additions/changes

```
md-view/
├── src/
│   └── renderer/
│       ├── index.html         # ~ new #tree-resize-handle sibling div
│       ├── app.css             # ~ handle styles, body.resizing-tree-panel,
│       │                       #   border-right removed from #tree-panel,
│       │                       #   dark-mode counterparts
│       └── renderer.js         # ~ drag wiring, Task 21's tree-sidebar region
├── tests/
│   └── e2e/
│       └── tree-panel.spec.ts  # ~ new resize describe block (or a new
│                                #   sibling spec file — engineer's call)
├── .agents/
│   ├── specs/
│   │   ├── functional_domain.md   # ~ Task 23 section (done, this pass)
│   │   ├── initial_scaffold.md    # ~ Task 23 section (this section)
│   │   └── backlog.md             # ~ Task 23 note if any deferred item
│   │                                #   surfaces during implementation
│   ├── DEVLOG.md                  # ~ brief entry
│   └── metrics/RUN_LOG.md         # ~ append-only row, held until Lead
│                                    #   sign-off per process notes
```

### Governance note

No ADR — same tier as Task 21 (real interactive feature, single-file
concentrated change, no new architectural boundary or cross-cutting
concern introduced). Normal-weight spec entries apply, per the task
assignment's own framing ("real interactive behavior, not a one-line
fix").

---

## Task 24: Tree Panel — Auto-Expand + Highlight Active File

### The Inward Dependency Rule

No new outward boundary is crossed. `revealAndHighlight` and
`isPathUnder` live in the same peripheral layer as the rest of
`renderer.js`'s DOM-touching code — this app's Clean Architecture
boundary (main process I/O vs. renderer presentation) is unchanged by
this task. No new `BridgeApi` member, no new IPC channel: reveal logic
consumes the two IPC contracts that already exist
(`onFolderTreeRoot`/`onFileRendered` inbound, `listDirectory` outbound
via the existing `handleDirectoryRowClick`), the same "no new main↔
renderer contract" posture Task 23 documented for drag-resize.

### SOLID Boundary Scan

- **SRP.** Three responsibilities stay in three places, matching the
  functional-domain split: `isPathUnder` (pure containment predicate),
  `revealAndHighlight` (orchestration — walk the tree, decide
  match/descend/stop per level, manage the supersession token), and
  `handleDirectoryRowClick` (fetch-or-toggle a single folder, reused
  unmodified in spirit). None of these absorb another's job — in
  particular, `revealAndHighlight` never reimplements fetch-or-toggle
  logic; it calls the existing function.
- **OCP.** `handleDirectoryRowClick`'s signature changes
  (`entry`→`folderPath`), but per the task assignment this is a
  same-behavior simplification (the function already only ever reads
  `entry.path`), not a behavior change — its one existing call site is
  updated in place, and its internal logic (the `needsFetch` gate, the
  loading-row lifecycle, the ok/error branches) is untouched. This
  task *extends* what can drive that function (a programmatic reveal
  walk, not just a click handler) without modifying what it does.
- **LSP/ISP.** N/A at this scale — no class hierarchies or multi-method
  interfaces are introduced or affected.
- **DIP.** The concrete dependency worth naming: `revealAndHighlight`
  depends on `handleDirectoryRowClick` as the *only* sanctioned way to
  turn "not yet fetched" into "fetched" (functional domain guardrail
  #42) — a duplicated inline `listDirectory` call inside the reveal
  walk would be a DIP-shaped violation in spirit (a second concrete
  implementation of the same abstraction, drifting from the original
  the moment either one changes), even though no formal interface
  exists to name it. No new interface/abstraction is warranted beyond
  "call the one function" — same "N/A at this scale" reasoning Task 23
  gave for its own single-implementation drag logic.

### Pattern Application

- **Traversal mirrors Task 21's existing Composite-shaped-without-a-
  class rendering** — the reveal walk descends the same physical DOM
  tree `renderTreeLevel` built, level by level, rather than maintaining
  a second parallel "path tree" model. No new Composite is introduced;
  this task's walk is a *consumer* of the structure Task 21 already
  produced.
- **The supersession token is the standard cancellation-token /
  sequence-lock idiom** for "only the latest of several overlapping
  async operations may apply its result" — not a GoF pattern by name.
  Documented explicitly as an intentional non-pattern, same as Task
  23's call not to wrap its drag clamp in Strategy/Command: introducing
  a formal Observer/Mediator around two DOM event handlers calling one
  shared function would be structure for its own sake here.

### JS — `src/renderer/renderer.js`

- **Refactor (behavior-preserving):** `handleDirectoryRowClick(entry,
  childrenEl, toggleEl)` → `handleDirectoryRowClick(folderPath,
  childrenEl, toggleEl)`. Body unchanged except substituting
  `folderPath` for `entry.path`. The one existing call site in
  `renderTreeLevel` (`row.addEventListener('click', () => { ... })`)
  passes `entry.path` instead of `entry`.
- **`renderTreeLevel`:** one addition — `node.dataset.path = entry.path;`
  set on every `.tree-node`, directory or file, right after `node` is
  created. This is the only new DOM-queryable state the reveal walk
  needs; no other attribute or data structure is introduced.
- **New pure function**, placed alongside `applyRenderedContent` /
  `statusBarText` / `shouldShowFrontmatter` / `firstDroppedFile` /
  `needsFetch` at the top of the file (above the `typeof document`
  guard, per the file's existing convention of keeping pure/testable
  functions outside the DOM-guarded block): `isPathUnder(childPath,
  parentPath)`, exactly as specified in the task assignment. Added to
  the `module.exports` object at the bottom alongside the other five.
- **New state**, inside the `typeof document !== 'undefined'` block,
  alongside the existing `dragDepth`/`lastMessage`/`lastViewSettings`
  declarations: `currentTreeRootPath`, `activeFilePath`, `activeRowEl`,
  `revealToken` — all `let`, all initialized as specified in the task
  assignment.
- **New function `revealAndHighlight()`**, async, implementing the
  five-step algorithm from the task assignment verbatim: increment-and-
  capture the token; clear the existing highlight (O(1), via
  `activeRowEl`); early-return on unset root/file or
  `!isPathUnder(...)`; walk `treeRootEl` level by level using
  `dataset.path` and `isPathUnder` to decide match/descend/stop,
  calling `handleDirectoryRowClick(node.dataset.path, childrenEl,
  toggleEl)` (the refactored signature) to expand an unfetched
  ancestor, and just unhiding an already-fetched-but-collapsed one;
  re-checking `myToken === revealToken` after every `await` before
  continuing or applying anything; applying `.tree-row-active` and
  `scrollIntoView({block:'nearest'})` on an exact match; returning
  quietly on a no-match level.
- **Wiring:**
  - `onFolderTreeRoot`'s handler: after the existing
    `renderTreeLevel(message.entries, treeRootEl)` call on the
    `{ok:true}` branch, set `currentTreeRootPath = message.rootPath;`
    then call `revealAndHighlight()`. On the `{ok:false}` branch, set
    `currentTreeRootPath = null;` (no `renderTreeLevel` call happens on
    that branch already, so there is nothing to reveal against).
  - `onFileRendered`'s handler: at the end (after the existing
    `renderHtml`/`renderError` branch), unconditionally set
    `activeFilePath = message.ok ? message.filePath : null;` then call
    `revealAndHighlight()` — unconditional per the task assignment,
    since the function's own guard correctly no-ops (after clearing any
    stale highlight) when `activeFilePath` is `null`.

### CSS — `src/renderer/app.css`

New `.tree-row-active` rule, placed near the existing `.tree-row` /
`.tree-row:hover` / `.tree-toggle-expanded` block (around line 227-253):
a background/text treatment visually distinct from both
`.tree-row:hover`'s subtle gray wash and `.tree-toggle-expanded`'s
rotation affordance — an accent-colored background plus (optionally)
a left border or bolded label, so the three states (default, hovering,
active) never look ambiguous when combined (an active row can still be
hovered). Matching `body.dark-mode .tree-row-active` rule following the
file's existing per-selector dark-mode convention (guardrail #39's
precedent, now applied to a class selector rather than an id).

### Tests — `tests/unit/isPathUnder.test.ts`

New file, same shape as `tests/unit/needsFetch.test.ts` (plain
`describe`/`it`, importing from `../../src/renderer/renderer.js`, zero
DOM). Cases: exact match; a real nested child (`/foo/bar/baz.md` under
`/foo/bar`); the false-prefix trap (`/foo/bar2` is NOT under
`/foo/bar`); both separators (`\` on one side, `/` on the other, since
`entry.path` is OS-native and this predicate must not assume a
platform).

### Tests — `tests/e2e/tree-panel.spec.ts`

New `describe` block (mirroring Task 23's own `describe('Task 23: ...')`
convention), reusing this file's existing `treeRow`/`treeNode`/
`treeChildren` helpers and the `tests/e2e/fixtures/tree` fixture set
(`sub/deep.md` already exists as the nested fixture the task assignment
calls for). Coverage, per the task assignment: nested-file auto-expand
+ highlight; re-highlight on a second top-level file click (old row
loses `.tree-row-active`, new row gains it); a fresh `FOLDER_TREE_ROOT`
(new root) still ends up correctly expanded+highlighted; Open Folder…
to a root that does not contain the currently-open file → no crash, no
highlight; FI-1's rapid-double-open proof (open file A, immediately
open file B before A's awaited `listDirectory` call(s) resolve, assert
only B's path ends up expanded/highlighted).

### Required proof (fault injection — authoritative per task assignment)

**FI-1:** temporarily remove the `myToken !== revealToken` checks in
`revealAndHighlight` → a test that opens file A then immediately opens
file B (before A's reveal walk's awaited `listDirectory` call(s) would
resolve) must fail RED (stale expansion/highlight artifacts from A's
superseded walk visible in the final state) → restore the checks →
same test GREEN (only B's path expanded/highlighted).

### File tree — Task 24 additions/changes

```
md-view/
├── src/
│   └── renderer/
│       ├── renderer.js         # ~ handleDirectoryRowClick signature
│       │                       #   simplification, node.dataset.path,
│       │                       #   isPathUnder, reveal/highlight state,
│       │                       #   revealAndHighlight(), wiring into
│       │                       #   onFolderTreeRoot/onFileRendered
│       └── app.css             # ~ .tree-row-active + dark-mode counterpart
├── tests/
│   ├── unit/
│   │   └── isPathUnder.test.ts # + new, plain-string fixtures, no DOM
│   └── e2e/
│       └── tree-panel.spec.ts  # ~ new describe block: auto-expand,
│                                #   re-highlight on click, new-root reveal,
│                                #   out-of-root no-op, FI-1 proof
├── .agents/
│   ├── specs/
│   │   ├── functional_domain.md   # ~ Task 24 section (done, this pass)
│   │   ├── initial_scaffold.md    # ~ Task 24 section (this section)
│   │   └── backlog.md             # ~ Task 24 note if any deferred item
│   │                                #   surfaces during implementation
│   ├── DEVLOG.md                  # ~ brief entry, noting this closes the
│   │                                #   21/23/24 sidebar milestone
│   └── metrics/RUN_LOG.md         # ~ append-only row, held until Lead
│                                    #   sign-off per process notes
```

### Governance note

No ADR — same tier as Task 21/23 (real interactive feature, concentrated
in `renderer.js` + `app.css`, no new architectural boundary or IPC
surface introduced). Normal-weight spec entries apply.

---

## Task 25: Dropped/Opened Directory Establishes Tree Root Instead of Rejecting

### The Inward Dependency Rule

No new boundary crossed. The fix is entirely within `src/main/index.ts`'s
existing `REQUEST_OPEN_FILE` handler — a peripheral I/O dispatch point
that already owns exactly this kind of classify-then-route decision
(it already routes to `renderAndWatch`, unconditionally, today). No new
IPC channel, no new preload surface, no renderer change: this is a
main-process dispatch correction, not a new capability crossing a layer
boundary.

### SOLID Boundary Scan

- **SRP.** The handler's one responsibility — "route an opened path to
  the correct handling" — was previously incomplete (it silently assumed
  "file"). Adding the directory branch completes that single
  responsibility rather than adding a second one. `establishTreeRoot`
  keeps its existing, sole responsibility ("make this directory the tree
  root"); this task adds a second *caller* of it, not new behavior
  inside it.
- **OCP.** `establishTreeRoot` and `renderAndWatch`/`renderFile` are
  unmodified — both are extended in applicability (one more caller,
  respectively for directory and file inputs at this entry point)
  without modifying their internals.
- **LSP/ISP.** N/A at this scale — no interfaces or class hierarchies
  are introduced or affected.
- **DIP.** The handler depends on the same two existing abstractions
  (`establishTreeRoot`, `renderAndWatch`) it always could have; the only
  change is which one gets invoked for which input shape, decided by one
  `fs.stat` check. No new concrete dependency is introduced — `fs` is
  already imported in this file.

### Pattern Application

Plain conditional dispatch on a classification result — not a GoF
pattern by name, and not worth dressing up as one. This is the same
"intentional non-pattern" call Task 24 made for its supersession token:
a two-way branch on one stat result does not warrant Strategy/Command
machinery. `establishTreeRoot` itself is reused verbatim (no
Factory/Template Method needed — it already is the one correct way to
turn a directory path into a tree-root event, per Task 17/18).

### TS — `src/main/index.ts`

- **`REQUEST_OPEN_FILE` listener** (currently lines 317-321): becomes
  `async`, gains a leading `fs.stat(filePath)` classification (wrapped
  in try/catch — a stat failure leaves `isDirectory` `false`, falling
  through unchanged to `renderAndWatch`, which independently re-derives
  and reports the same failure it does today). On `isDirectory === true`,
  call `await establishTreeRoot(filePath)` and `return` — no
  `renderAndWatch` call on that branch. On `false`, fall through to the
  existing `renderAndWatch(filePath)` call, unchanged.
- No other function in this file is touched. `establishTreeRoot`,
  `renderAndWatch`, `renderFile`, `openFileByPath`'s preload wiring, and
  the argv-open and File>Open dialog paths are all untouched, per the
  task's own "Out of scope" section.

### Tests — `tests/e2e/drag-drop.spec.ts`

Extend the existing file (no new spec file — this is additive to an
established suite, same posture as adding a `describe` block within it):

- New case: dragging a folder onto the window asserts `FOLDER_TREE_ROOT`
  fires with the correct `rootPath`/`entries` for that folder (reusing
  the file's existing dialog-mock-independent drag-simulation helper),
  and asserts zero `FILE_RENDERED` events fire — the direct proof of
  guardrail #47, mirrored from Task 17's original "Open Folder…" test
  shape.
- Regression proof (run, not assumed): the existing `drag-drop.spec.ts`
  and `tree-panel.spec.ts` suites pass unmodified, confirming zero
  behavior change for real file drops and tree clicks (guardrail #46).
- New case: a dropped path that cannot be stat'd (nonexistent) still
  produces today's existing error behavior — confirmed by an actual test
  run against the new code path, not inferred from the try/catch shape
  alone (guardrail #48).

### File tree — Task 25 additions/changes

```
md-view/
├── src/
│   └── main/
│       └── index.ts               # ~ REQUEST_OPEN_FILE listener: async,
│                                    #   fs.stat classification, directory
│                                    #   branch → establishTreeRoot
├── tests/
│   └── e2e/
│       └── drag-drop.spec.ts      # ~ + folder-drop→tree-root case,
│                                    #   + stat-failure regression case
├── .agents/
│   ├── specs/
│   │   ├── functional_domain.md   # ~ Task 25 section (done, this pass)
│   │   ├── initial_scaffold.md    # ~ Task 25 section (this section)
│   │   └── backlog.md             # ~ Task 25 note: this bug shipped
│   │                                #   through Tasks 16-24's full review
│   │                                #   cycle undetected — same class as
│   │                                #   the Task 1-4 broken-image finding
│   └── DEVLOG.md                  # ~ brief entry, same backlog note angle
```

### Governance note

No ADR — this is a bug fix within an existing, already-governed dispatch
point (no new architectural boundary, no new IPC surface, no new pattern).
Normal-weight spec entries apply, sized to the change's actual scope.

---

## Task 26: Tree Panel — Independent Viewport-Fixed Sidebar (Option A)

### The Inward Dependency Rule

No boundary crossed. This is entirely a peripheral presentation change
(`src/renderer/app.css`) — no main-process I/O, no IPC contract, no
change to what data flows where. Confirmed (per the task's own required
check) that the drag-resize JS in `renderer.js` reads/writes only the
`--tree-panel-width` custom property and never touches
position/layout directly — grep across `app.css`, `renderer.js`,
`index.html`, and `tests/` for any other `#app-body` reference found
none beyond its own two-line ruleset (`display: flex; flex-direction:
row;`) in `app.css` — so this task requires zero JS changes, confirming
the task's own prediction rather than assuming it.

### SOLID Boundary Scan

- **SRP.** `#tree-panel` and `#main-panel`/`#document-container` each
  now own their sizing model outright (viewport-bound vs.
  content-bound) rather than sharing one flex row's sizing algorithm
  that only actually suited one of them. This is a clarification of
  responsibility, not a new one.
- **OCP.** The existing `--tree-panel-width` custom property and its
  sole writer (Task 23's drag handler) are unmodified — this task
  extends *how* the property is consumed (position/margin instead of
  flex-basis) without modifying the writer or the property's meaning.
- **LSP/ISP.** N/A at this scale — no interfaces or class hierarchies.
- **DIP.** No new concrete dependency. `#tree-panel`/
  `#tree-resize-handle`'s bottom clearance depends on the same already-
  declared constant (`2rem`, `body`'s `padding-bottom`) `#status-bar`'s
  clearance already depends on — reusing the existing value literally,
  per the task's explicit instruction, rather than introducing a second
  named source for the same fact (e.g. a new custom property) that
  could drift from the original.

### Pattern Application

None named — this is CSS positioning, not an OOP structural pattern.
Worth stating explicitly (same "intentional non-pattern" posture as
Tasks 23-25): the fix is switching two elements from flex-child sizing
to `position: fixed` + `margin-left`, which is the standard CSS idiom
for "one viewport-pinned panel beside one content-flow panel" — no
GoF wrapper needed around three CSS rule changes.

### CSS — `src/renderer/app.css`

- **`#app-body`** (lines 17-20): remove `display: flex;` and
  `flex-direction: row;` — confirmed dead once its three children no
  longer participate in flex layout (see grep result above). No
  replacement properties needed; the element becomes a plain block
  wrapper.
- **`#tree-panel`** (lines 23-31): replace `flex: 0 0 auto;` with
  `position: fixed; top: 0; left: 0; bottom: 2rem;`. Keep `width: var(
  --tree-panel-width)`, `box-sizing: border-box`, `overflow-y: auto`,
  and the existing `background`/`font-family`/`font-size` declarations
  unchanged, per the task's exact snippet.
- **`#tree-resize-handle`** (lines 38-43): replace `flex: 0 0 auto;`
  with `position: fixed; top: 0; left: var(--tree-panel-width); bottom:
  2rem;`. Keep `width: 6px`, `cursor`, `background` (default and
  `:hover`) unchanged.
- **`#main-panel`** (lines 62-65): replace `flex: 1 1 auto; min-width:
  0;` with `margin-left: var(--tree-panel-width);`. The existing
  comment explaining why `min-width: 0` was load-bearing for the flex
  model (lines 57-61) is removed along with the properties it explains
  — that reasoning no longer applies once `#main-panel` isn't a flex
  child; `#document-container`'s own `width: calc(100% - 4rem)` now
  resolves against `#main-panel`'s normal block-formatting-context
  width, which was never flex-constrained in the first place.
- No other selector changes. `#document-container`, `#content`,
  `#empty-state`, `#status-bar`, and all dark-mode counterparts are
  untouched — their behavior must not change (guardrail #51).

### JS — `src/renderer/renderer.js`

No changes. Per the confirmed grep above, the only `#app-body`-adjacent
assumption anywhere in the JS is a Task 23 *comment* (line ~240,
"`#tree-panel` is the flex row's first child (left edge always at
viewport x=0)") — the underlying fact it describes (`#tree-panel`'s
left edge is always viewport x=0) remains true under `position: fixed;
left: 0;`, so the comment's conclusion still holds even though its
stated mechanism (flex row) no longer applies. Not required to be
touched by the guardrails, but the engineer may update the comment's
wording for accuracy as a zero-risk, in-scope touch of an already-
in-scope file — not a new capability, purely a stale-mechanism note fix.

### Tests — `tests/e2e/tree-panel.spec.ts`

Extend the existing file (no new spec file):

- New assertion: `#tree-panel`'s computed bounding box `bottom` equals
  `#status-bar`'s computed bounding box `top`, compared as actual
  `boundingBox()` values (never a hardcoded pixel figure derived from
  `2rem`, since that depends on root font-size) — checked with no
  folder open (tree empty-state) and with a folder open showing only a
  few top-level rows, matching the original bug's manual-repro
  scenario.
- New assertion: a folder with enough expanded nested entries to exceed
  viewport height produces a real scrollbar/scrollable overflow
  *inside* `#tree-panel` specifically (`scrollHeight > clientHeight` on
  `#tree-panel`, and no growth in `document.documentElement.scrollHeight`
  attributable to the tree panel) — reuse the existing
  `tests/e2e/fixtures/tree` fixture set, adding nested fixture depth
  only if what exists today doesn't already exceed a small test-window
  viewport height.
- New assertion: opening a long document (new fixture if none already
  long enough — check `tests/e2e/fixtures/` first) lets the page scroll
  to the document's end, `#status-bar` stays visible throughout, and
  `#tree-panel`'s own bounding box is unchanged regardless of main-
  content scroll position (guardrail #51's explicit regression proof).
- FI-1 proof (guardrail #52): temporarily revert `#tree-panel`'s and
  `#tree-resize-handle`'s `bottom: 2rem` to `bottom: 0` → a new non-
  overlap assertion against `#status-bar` must fail RED → restore →
  GREEN.
- Full existing drag-to-resize block (Task 23: mid-range drag, min-
  clamp, dynamic max-clamp at a shrunk window, persistence across
  relaunch) run unmodified and confirmed green under the new
  positioning scheme (guardrail #53) — not just re-asserted, actually
  run.

### File tree — Task 26 additions/changes

```
md-view/
├── src/
│   └── renderer/
│       ├── app.css       # ~ #app-body (flex props removed), #tree-panel
│       │                 #   (flex→fixed), #tree-resize-handle (flex→
│       │                 #   fixed), #main-panel (flex→margin-left)
│       └── renderer.js   # ~ (optional) comment-only wording fix at the
│                         #   Task 23 drag-handle block; no behavior change
├── tests/
│   └── e2e/
│       ├── tree-panel.spec.ts   # ~ + viewport-fixed height/overlap/
│       │                        #   scroll assertions, + FI-1 proof
│       └── fixtures/            # + long-document fixture and/or deeper
│                                 #   tree fixture, only if existing
│                                 #   fixtures don't already exceed a
│                                 #   small test viewport
├── .agents/
│   ├── specs/
│   │   ├── functional_domain.md   # ~ Task 26 section (done, this pass)
│   │   ├── initial_scaffold.md    # ~ Task 26 section (this section)
│   │   └── backlog.md             # ~ Task 26 note if anything deferred
│   │                                #   surfaces during implementation
│   └── DEVLOG.md                  # ~ brief entry
```

### Governance note

No ADR — same tier as Tasks 21/23/24 (real, user-visible layout
behavior change, concentrated entirely in `app.css`, no new
architectural boundary, no new IPC surface, no new pattern). Normal-
weight spec entries apply.

---

## Task 27: Tree Panel — "Up One Level" Navigation

### The Inward Dependency Rule

No new architectural boundary. The renderer (outermost, UI) already
depends only on the `BridgeApi` interface (`window.mdview.*`), never on
`ipcRenderer` directly — Task 27's new `requestTreeParent()` method
slots into that same existing crossing, unchanged in shape from
`openFileByPath`. The main process's new `REQUEST_TREE_PARENT` listener
is a thin adapter that computes one derived value (`path.dirname`) and
hands it straight to the existing `establishTreeRoot` domain function —
it adds no new domain logic of its own, so dependencies still point the
same direction they always have: renderer → preload bridge → main
adapter → `establishTreeRoot`.

### SOLID Boundary Scan

- **SRP.** The new `ipcMain.on(REQUEST_TREE_PARENT, ...)` listener has
  exactly one reason to change: how the parent path is derived. It does
  not re-implement any part of `establishTreeRoot`'s no-op/canonicalize/
  broadcast responsibility — that stays owned entirely by the existing
  function, called verbatim.
- **OCP.** `establishTreeRoot` is extended by a new *caller* (a third
  entry point, alongside "Open Folder…" and the drag/argv file-to-
  directory path), not by modifying its body. Zero lines inside
  `establishTreeRoot` change.
- **DIP.** The renderer depends on the `BridgeApi` abstraction
  (`requestTreeParent(): void`), never on `ipcRenderer.send` or the raw
  channel string — identical discipline to every existing bridge
  method.
- **ISP/LSP.** Not implicated — no class hierarchy or role interface is
  introduced or narrowed by this task.

### Pattern Application

Same **Facade/Gateway** shape the preload bridge has used since the
scaffold (`contextBridge.exposeInMainWorld`), extended with one more
fire-and-forget **Command**-message method — the identical shape
`openFileByPath` already established (a bare `ipcRenderer.send`, no
request/response, result delivered later through the pre-existing
`FOLDER_TREE_ROOT` push channel). No new pattern is introduced; this is
the same message shape reused a third time (after "Open Folder…" and
drag/argv-file-to-directory).

### File tree — Task 27 additions/changes

```
md-view/
├── src/
│   ├── preload/
│   │   ├── api.ts        # + REQUEST_TREE_PARENT channel, +
│   │   │                 #   requestTreeParent() on BridgeApi
│   │   └── index.ts      # + requestTreeParent bridge implementation
│   │                     #   (plain ipcRenderer.send, same shape as
│   │                     #   openFileByPath)
│   ├── main/
│   │   └── index.ts      # + ipcMain.on(REQUEST_TREE_PARENT, ...)
│   │                     #   registered alongside REQUEST_OPEN_FILE /
│   │                     #   REQUEST_LIST_DIRECTORY in app.whenReady();
│   │                     #   calls establishTreeRoot(path.dirname(
│   │                     #   currentTreeRoot)) verbatim, no-ops via
│   │                     #   guardrail #54 if !currentTreeRoot
│   └── renderer/
│       ├── renderer.js   # ~ onFolderTreeRoot's ok:true branch: render
│       │                 #   one up-row (createTreeRow, class
│       │                 #   tree-row-up, NOT tree-node) above
│       │                 #   renderTreeLevel's output, click ->
│       │                 #   window.mdview.requestTreeParent()
│       └── app.css       # + .tree-row-up (muted/italic, no toggle),
│                         #   + body.dark-mode .tree-row-up
├── tests/
│   └── e2e/
│       └── tree-panel.spec.ts   # + Up-click changes root to parent
│                                 #   with correct entries, + no-op at
│                                 #   a real filesystem root (counting-
│                                 #   listener pattern, Task 17/18
│                                 #   style), + up-row absent with no
│                                 #   root ever established, + FI-1
├── .agents/
│   ├── specs/
│   │   ├── functional_domain.md   # ~ Task 27 section (done, this pass)
│   │   ├── initial_scaffold.md    # ~ Task 27 section (this section)
│   │   └── backlog.md             # ~ Task 27 note if anything defers
│   └── DEVLOG.md                  # ~ entry tying this to manual-
│                                     #   testing pass point 6
```

### Tests — `tests/e2e/tree-panel.spec.ts`

Extend the existing file (no new spec file):

- Open a nested fixture file (root establishes at its parent
  directory), click the up-row once: assert a `FOLDER_TREE_ROOT`
  broadcast fires with `rootPath` equal to the grandparent directory
  and `entries` matching what `listDirectoryEntries` independently
  returns for that path.
- Establish the root directly at the platform's real filesystem root
  (`path.parse(process.cwd()).root` — never a hardcoded `'C:\\'`),
  click the up-row: assert no new/different `FOLDER_TREE_ROOT`
  broadcast fires. Reuse the exact counting-listener idiom Task 17/18's
  own tests already use for this shape (a second, test-only
  `window.mdview.onFolderTreeRoot` subscription pushing into
  `window.__treeRootEvents`, coexisting with the production listener;
  wait, then assert the count didn't grow) rather than inventing a new
  mechanism.
- The up-row is absent when no folder/file has ever been opened
  (`test.use({ electronArgs: [] })`, matching guardrail #58 / Task 17
  guardrail #8's existing "no tree content before a root exists" test
  shape).
- FI-1 proof (guardrail #54): temporarily change the new listener to
  call `establishTreeRoot(currentTreeRoot)` (the same root, not its
  parent) → the "root changes to parent after one click" assertion
  goes RED (`rootPath` stays identical) → restore → GREEN.
- Full existing `tree-panel.spec.ts` suite (Tasks 17/21/23/24/26, all
  in this one file) re-run and confirmed green unmodified — the
  concrete proof for guardrail #55 (revealAndHighlight unaffected) and
  guardrail #56 (no watcher/render/FILE_RENDERED side effect).

### Governance note

No ADR — same tier as Tasks 21/23/24/25/26: one new fire-and-forget IPC
channel following an already-established message shape, one new main-
process listener that adds no new domain logic, one new renderer row,
CSS-only visual treatment. No new architectural boundary, no new
pattern beyond the existing Facade/Command shape. Normal-weight spec
entries apply.

---

## Task 28: View Menu Toggle — Show/Hide File Tree

### The Inward Dependency Rule

No new architectural boundary. `showTreePanel` extends the existing
`ViewSettings` object exactly like `darkMode`/`showFrontmatter` — the
renderer still depends only on `onViewSettings`'s payload shape, never
on how main derives or stores it. The one new fact this task
introduces — that `openFolderViaDialog()` and the `REQUEST_OPEN_FILE`
directory branch must rebuild the application menu — is a main-process-
internal side effect between two things main already owns
(`viewSettings` and `Menu.setApplicationMenu`); it crosses no new
boundary and adds no new dependency from any outer layer inward.
`establishTreeRoot` itself gains no awareness of visibility at all,
keeping it exactly as agnostic about "why was I called" as it already
is about its three existing callers.

### SOLID Boundary Scan

- **SRP.** `setShowTreePanel` has exactly one reason to change:
  updating and broadcasting the `showTreePanel` fact — identical
  shape/responsibility to `setDarkMode`/`setShowFrontmatter`. The menu-
  rebuild-on-forced-change logic is a *separate* responsibility living
  in the two callers that need it (`openFolderViaDialog`,
  the `REQUEST_OPEN_FILE` directory branch), not folded into
  `setShowTreePanel` itself — `setShowTreePanel` is called identically
  whether it originates from the checkbox or from a forced side effect,
  and has no idea which case it's in.
- **OCP.** `establishTreeRoot` is extended by nothing here — zero lines
  inside it change. The menu-rebuild behavior is added entirely at the
  two existing call sites, as new code wrapping an existing call, not
  as a modification to any shared function's body.
- **DIP.** The renderer depends only on the `onViewSettings` callback
  shape it already consumes — `showTreePanel` is just one more field on
  a payload it already trusts. No new bridge method, no new dependency
  direction.
- **ISP/LSP.** Not implicated — no interface narrows or grows a role
  hierarchy; `ViewSettings` gains one more scalar field, same as Task 8
  already did going from one field to two.

### Pattern Application

Same **Observer/pub-sub** shape already in place for `darkMode`/
`showFrontmatter`: main holds the fact, broadcasts it over
`VIEW_SETTINGS` on every change, and the renderer's `onViewSettings`
handler is the sole subscriber that redraws in response. No new pattern
is introduced. The menu-rebuild step reuses the identical **Builder**
construction (`Menu.buildFromTemplate(buildMenuTemplate(...))`) already
used once in `app.whenReady()` — this task's only new wrinkle is
calling that same builder a second time, from two additional call
sites, when a forced value change makes the previously-built menu
stale.

### File tree — Task 28 additions/changes

```
md-view/
├── src/
│   ├── main/
│   │   ├── menu.ts        # ~ ViewSettings: + showTreePanel: boolean
│   │   │                  #   ~ MenuHandlers: + onToggleShowTreePanel
│   │   │                  #   ~ View submenu: + menu-show-tree-panel
│   │   │                  #     checkbox item
│   │   └── index.ts       # ~ viewSettings default: + showTreePanel: true
│   │                      #   + setShowTreePanel(checked) (same shape as
│   │                      #     setDarkMode/setShowFrontmatter)
│   │                      #   ~ openFolderViaDialog(): if
│   │                      #     !viewSettings.showTreePanel, force true +
│   │                      #     rebuild/reapply menu, BEFORE
│   │                      #     establishTreeRoot
│   │                      #   ~ REQUEST_OPEN_FILE listener's directory
│   │                      #     branch: identical force+rebuild, BEFORE
│   │                      #     establishTreeRoot
│   │                      #   ~ app.whenReady(): wire onToggleShowTreePanel
│   │                      #     to setShowTreePanel in the handlers object
│   │                      #   renderAndWatch(): UNCHANGED — no
│   │                      #     showTreePanel write on this path
│   └── renderer/
│       ├── renderer.js    # ~ onViewSettings: + document.body.classList
│       │                  #   .toggle('tree-panel-hidden',
│       │                  #   !settings.showTreePanel)
│       └── app.css        # + body.tree-panel-hidden #tree-panel,
│                          #   #tree-resize-handle { display: none }
│                          #   + body.tree-panel-hidden #main-panel
│                          #   { margin-left: 0 }
├── tests/
│   └── e2e/
│       ├── view-menu.spec.ts    # + checkbox toggles showTreePanel,
│       │                        #   CSS class/computed layout follow,
│       │                        #   both directions
│       └── tree-panel.spec.ts   # + Open Folder while hidden: checkbox
│                                #   flips AND tree becomes visible
│                                #   + Open single file while hidden:
│                                #   stays hidden, checkbox stays
│                                #   unchecked
│                                #   + expand folder, hide, show: same
│                                #   folder still expanded, no new
│                                #   listDirectory call (counting-
│                                #   listener idiom, Task 17/18 style)
├── .agents/
│   ├── specs/
│   │   ├── functional_domain.md   # ~ Task 28 section (done, this pass)
│   │   ├── initial_scaffold.md    # ~ Task 28 section (this section)
│   │   └── backlog.md             # ~ Task 28 note if anything defers
│   └── DEVLOG.md                  # ~ entry: first ViewSettings field
│                                     #   with two independent write
│                                     #   paths; first menu rebuild
│                                     #   outside app.whenReady()
```

### Tests — extend `tests/e2e/view-menu.spec.ts` and `tests/e2e/tree-panel.spec.ts`

- Menu checkbox click toggles `showTreePanel`; assert both
  `body.tree-panel-hidden`'s presence/absence and `#main-panel`'s
  actual computed `marginLeft` (0 vs. the live `--tree-panel-width`
  value), in both directions — not just the class.
- Open Folder… while the tree is hidden: assert the
  `menu-show-tree-panel` checkbox reads `checked === true` AND
  `#tree-panel` is actually visible (not just that one of the two
  changed) — this is guardrail #62/#65's proof and the one genuinely
  new interaction this task introduces.
- Open Folder… while the tree is already visible: assert no redundant
  menu rebuild artifact — practically, assert the checkbox stays
  `checked` and the tree stays visible with no observable flicker/
  no-op side effect beyond what `establishTreeRoot`'s own existing
  no-op guard (Task 18) already produces.
- Open a single file (dialog or argv) while the tree is hidden: assert
  `showTreePanel` and the checkbox both stay unchanged (guardrail #61).
- Expand a folder, hide the tree via the checkbox, show it again:
  assert the same folder is still expanded and no new `listDirectory`
  call fired in between — reuse the existing counting-listener idiom
  (Task 17/18/21) rather than inventing a new mechanism (guardrail
  #63).

### Governance note

No ADR — same tier as Task 8 (a third `ViewSettings` boolean field,
one new checkbox menu item, CSS-only visibility rule). The one novel
element — rebuilding the application menu outside `app.whenReady()` —
reuses the exact `Menu.setApplicationMenu(Menu.buildFromTemplate(...))`
construction already present there; it is a second call site for an
existing pattern, not a new one. Normal-weight spec entries apply.

---

## Task 29 Technical Specification — Frameless Main Window

Maps [functional_domain.md](functional_domain.md)'s Task 29 analysis to
concrete design.

### The Inward Dependency Rule

- No new domain/core module. This task's diff sits entirely at the
  peripheral boundary — `windowConfig.ts` (BrowserWindow construction
  options), `menu.ts`'s existing `buildMenuTemplate` (reused, not
  extended), `index.ts` (composition root: window creation, IPC
  handlers, event wiring), the preload facade, and static renderer
  markup/CSS/JS. `markdown.ts`, `watcher.ts`, `paths.ts`,
  `linkPolicy.ts`, `frontmatter.ts`, `fileTree.ts` are all untouched —
  none of them have any relationship to window chrome.
- **`defaultWindowOptions` is not the crossing point for this task's
  new fact.** `frame: false` is added exclusively at `createWindow()`'s
  own options object, layered on top of the spread exactly like
  `icon`/`preload` already are (`src/main/index.ts:87-94`) — this
  preserves the existing precedent that `defaultWindowOptions` is a
  *shared baseline*, and per-window additions happen at each
  construction call, not by mutating the shared object. The Help
  window's construction call (`onOpenHelp`, `src/main/index.ts:265-270`)
  spreads the same baseline and adds nothing from this task — it
  remains native chrome by simply not opting in, zero special-casing
  needed on its side.
- **The popup-menu IPC handler depends inward on the same
  `buildMenuTemplate` function the full application menu already
  depends on** — this is the concrete mechanism that satisfies
  functional_domain.md guardrail #67 ("second entry point, not a
  second definition"). `menu.ts` and `applyMenu()` need zero diff;
  the new handler in `index.ts` calls the existing function a second
  time, with the existing `handlers`/`viewSettings` values it already
  has in scope from `applyMenu()`'s own closure.

### SOLID Boundary Scan

- **SRP** — `windowConfig.ts` continues to hold only shared, testable
  construction data; it gains no new key (`frame` is added at the
  callsite, not in the shared object), so its existing unit-testable
  shape (`contextIsolation`/`nodeIntegration`/`sandbox` asserted
  directly against a plain object) is undisturbed. The five new
  `index.ts` IPC handlers (minimize/close/toggle-maximize/popup-menu/
  maximize-state-push) are five separate `ipcMain.on`/window-event
  registrations, each with exactly one reason to change, mirroring the
  existing one-handler-per-capability shape already used for
  `REQUEST_OPEN_FILE`/`REQUEST_LIST_DIRECTORY`/`REQUEST_TREE_PARENT`.
- **OCP** — Adding the popup-menu handler required zero changes to
  `buildMenuTemplate`'s own body or return shape; it is a new caller of
  an unmodified function, the same "extend by adding a call site, not
  by editing the shared function" shape Task 28 already used for its
  menu-rebuild calls.
- **ISP** — `BridgeApi` grows by five explicit, narrowly-named methods
  (`minimizeWindow`, `toggleMaximizeWindow`, `closeWindow`,
  `popupMenu`, `onWindowMaximizedState`) — no generic
  `invoke(channel, ...args)` passthrough, holding the same enumerable-
  surface discipline as every prior `BridgeApi` addition since Step 0.
- **DIP** — `renderer.js`'s three window-control buttons and three
  menu-labels depend only on the abstract `window.mdview` surface, same
  as every existing renderer interaction; they have no knowledge of
  IPC channel names, `BrowserWindow` methods, or `Menu` internals.

### Pattern Application (GoF)

- **Facade, again** — `preload/index.ts` keeps its sole role as the one
  file constructing the real `BridgeApi` object from `ipcRenderer`
  primitives; the five new methods follow the exact fire-and-forget
  (`ipcRenderer.send`) / push-listener (`ipcRenderer.on`) shapes already
  established, no new preload pattern introduced.
- **Builder, reused** — the popup-menu handler's
  `Menu.buildFromTemplate(template[index].submenu as
  MenuItemConstructorOptions[]).popup(...)` is the same
  `Menu.buildFromTemplate` construction `applyMenu()` already uses,
  called a second time against a slice of the identical template data —
  not a new construction pattern, a second use site for the existing
  one (same precedent as Task 28's menu-rebuild reuse).
- No new pattern needed for the title bar's drag/no-drag regions or the
  window-control buttons — these are CSS/DOM-only affordances with
  one-line bridge calls each, the same tier as Task 11's inert
  Preview/Code tab buttons before they had behavior.

### Exact signatures and wiring (authoritative — implement exactly this)

```ts
// src/preload/api.ts additions
export const IPC_CHANNELS = {
  // ...existing entries unchanged...
  MINIMIZE_WINDOW: 'md-view:minimize-window',
  TOGGLE_MAXIMIZE_WINDOW: 'md-view:toggle-maximize-window',
  CLOSE_WINDOW: 'md-view:close-window',
  POPUP_MENU: 'md-view:popup-menu',
  WINDOW_MAXIMIZED_STATE: 'md-view:window-maximized-state',
} as const;

export interface BridgeApi {
  // ...existing members unchanged...
  minimizeWindow(): void;
  toggleMaximizeWindow(): void;
  closeWindow(): void;
  popupMenu(section: 'file' | 'view' | 'help', x: number, y: number): void;
  onWindowMaximizedState(callback: (isMaximized: boolean) => void): void;
}
```

```ts
// src/main/windowConfig.ts — UNCHANGED (frame:false is NOT added here)

// src/main/index.ts — createWindow()
mainWindow = new BrowserWindow({
  ...defaultWindowOptions,
  frame: false,
  icon: path.join(__dirname, 'icon.png'),
  webPreferences: { ...defaultWindowOptions.webPreferences, preload: path.join(__dirname, '../preload/index.js') },
});
// ...existing will-navigate/setWindowOpenHandler/before-input-event wiring, unchanged...
mainWindow.on('maximize', () => mainWindow?.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, true));
mainWindow.on('unmaximize', () => mainWindow?.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, false));

// src/main/index.ts — app.whenReady()
ipcMain.on(IPC_CHANNELS.MINIMIZE_WINDOW, () => mainWindow?.minimize());
ipcMain.on(IPC_CHANNELS.CLOSE_WINDOW, () => mainWindow?.close());
ipcMain.on(IPC_CHANNELS.TOGGLE_MAXIMIZE_WINDOW, () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on(IPC_CHANNELS.POPUP_MENU, (_e, section: 'file' | 'view' | 'help', x: number, y: number) => {
  const index = menuSectionIndex(section); // pure lookup, see below
  const template = buildMenuTemplate(/* identical handlers/viewSettings applyMenu() already builds */);
  Menu.buildFromTemplate(template[index].submenu as MenuItemConstructorOptions[]).popup({
    window: mainWindow ?? undefined,
    x,
    y,
  });
});
```

`menuSectionIndex(section: 'file' | 'view' | 'help'): number` — the one
pure function this task introduces, at the same tier as
`shouldSetDockIcon`/`shouldCreateHelpWindow`. A plain object lookup
(`{ file: 0, view: 1, help: 2 }[section]`), unit-testable with zero
Electron runtime, isolating the "which template index does this
section name mean" fact so it is pinned by a test rather than trusted
inline at the one callsite that needs it.

**Maximize-state push registration is inside `createWindow()`, not
inside the `TOGGLE_MAXIMIZE_WINDOW` handler above** — this is the
concrete mechanism satisfying functional_domain.md guardrail #69: the
push fires for *any* path that changes real maximized state (custom
button, double-click, OS snap, Win+Up), because `'maximize'`/
`'unmaximize'` are native `BrowserWindow` events, not something this
task's own handler emits synthetically.

### Renderer wiring (`index.html`, `app.css`, `renderer.js`)

- New `#title-bar` region, sibling immediately above `#app-body` in
  `index.html`'s existing body structure — `#app-body`,
  `#tree-panel`, `#main-panel`, `#status-bar`, and every id inside them
  are untouched by this task, the same "existing ids resolve to the
  same kind of node, unchanged" discipline Task 11 guardrail #1 already
  established for a prior chrome-wrapping task.
- Three labels (`#menu-label-file`, `#menu-label-view`,
  `#menu-label-help`), each a one-line click handler calling
  `window.mdview.popupMenu('file' | 'view' | 'help', event.clientX,
  event.clientY)` — no local state, no menu-structure knowledge in the
  renderer at all (satisfies guardrail #67: the renderer never
  describes menu content, it only asks main to show a known section).
- Three window-control buttons, each a one-line click handler calling
  the matching bridge method directly — `minimizeWindow()`,
  `toggleMaximizeWindow()`, `closeWindow()` — no local state mutation,
  matching functional_domain.md's explicit instruction that button
  appearance changes only in response to the pushed
  `onWindowMaximizedState` event, never optimistically on click.
- `-webkit-app-region: drag` on `#title-bar` itself; `-webkit-app-region:
  no-drag` on exactly the six elements above (guardrail #70) — CSS-only,
  no JS region bookkeeping needed.
- `body.dark-mode`-scoped variants for `#title-bar` and its children,
  following the exact per-selector pattern already used for
  `#status-bar`/`#frontmatter`/`#document-container`/`#tree-panel`
  since Task 8 — no new dark-mode mechanism introduced.

### File tree — Task 29 additions/changes

```
md-view/
├── src/
│   ├── main/
│   │   ├── windowConfig.ts    # UNCHANGED — frame:false is NOT added here
│   │   ├── menu.ts            # UNCHANGED — zero diff (guardrail #67)
│   │   └── index.ts           # ~ createWindow(): + frame:false (own options
│   │                          #   object only) + maximize/unmaximize push
│   │                          #   listeners
│   │                          # + menuSectionIndex (pure, new leaf)
│   │                          # + 4 ipcMain.on handlers (minimize/close/
│   │                          #   toggle-maximize/popup-menu)
│   ├── preload/
│   │   ├── api.ts             # ~ + 5 IPC_CHANNELS entries, + 5 BridgeApi
│   │   │                      #   members
│   │   └── index.ts           # ~ + 5 explicit method implementations
│   │                          #   (4 fire-and-forget sends, 1 push listener)
│   └── renderer/
│       ├── index.html         # ~ + #title-bar region (3 labels, 3 buttons)
│       │                      #   above #app-body
│       ├── app.css            # + #title-bar layout/drag-region rules,
│       │                      #   window-control button shapes (CSS-drawn,
│       │                      #   no icon library), body.dark-mode variants
│       └── renderer.js        # ~ + 3 label click handlers (popupMenu)
│                              #   + 3 button click handlers (direct bridge
│                              #   calls)
│                              #   + onWindowMaximizedState handler (toggles
│                              #   maximize/restore button class only)
├── tests/
│   └── e2e/
│       └── window-chrome.spec.ts   # NEW — see functional_domain.md Task 29
│                                    #   + this section's "Required
│                                    #   fault-injection proof" below
├── .agents/
│   ├── specs/
│   │   ├── functional_domain.md    # ~ Task 29 section (done, this pass)
│   │   ├── initial_scaffold.md     # ~ Task 29 section (this section)
│   │   ├── decisions/
│   │   │   └── ADR-005_md-view.md  # NEW — see Governance note below
│   │   └── backlog.md              # ~ Task 29 note if anything defers
│   ├── DEVLOG.md                   # ~ entry: first frame:false window,
│   │                              #   first menu-as-popup entry point,
│   │                              #   first window-state (not
│   │                              #   ViewSettings-shaped) push channel
│   └── metrics/RUN_LOG.md          # ~ appended at Step 3 close-out
```

### Required fault-injection proof (FI-1)

Temporarily remove the `mainWindow.on('maximize'/'unmaximize', ...)`
push listeners from `createWindow()` → confirm a test that maximizes
the window via a path *other than* the custom button (e.g.
`electronApp.evaluate(({ BrowserWindow }) => ...)`, or the harness
directly calling `mainWindow.maximize()`, simulating an OS-level
maximize) shows the button's rendered state going stale/RED → restore
→ GREEN. This is the concrete, executed proof of functional_domain.md
guardrail #69 — "state must stay correct regardless of HOW the window
got (un)maximized" is not accepted as satisfied by code review alone,
the same evidence-based standard Step 2.5's review gate holds every
task to.

### Tests — `tests/e2e/window-chrome.spec.ts`

- `frame: false` confirmed structurally via `electronApp.evaluate()`
  reading the real `BrowserWindow`'s own properties (not inferred from
  source), plus custom title-bar elements present and visible.
- Each window-control button triggers the correct real window state
  change (minimize, maximize, restore; close gets its own isolated test
  given the app exits afterward).
- Double-click-on-drag-region behavior — either a light confirming test
  (if Electron's automatic behavior held empirically) or a full test of
  a from-scratch handler (only if it didn't) — decided by the
  investigation required under functional_domain.md guardrail #74, not
  assumed up front.
- Clicking each of File/View/Help shows that section's popup with the
  correct items, and clicking a real item inside it (e.g. "Open…")
  triggers the exact same existing behavior as before this task — the
  concrete proof that the popup path calls `buildMenuTemplate`, not a
  duplicate.
- Every existing accelerator-driven test (`grep` for `.press('Control+`)
  in the current suite still passes unmodified.
- FI-1's proof, executed (fault injected, confirmed red, restored,
  confirmed green) — not merely asserted as done.
- The full pre-existing e2e suite, run in full, confirming guardrail
  #73.

### Governance note

**ADR-005 is warranted** — unlike Task 28 (a third boolean field on an
already-established pattern), this task changes an architectural
assumption every prior task implicitly relied on: that the main
window has native OS chrome. Two decisions need recording for future
readers: (1) `frame: false` is scoped to the main window's own
construction options, never `defaultWindowOptions`, so the Help window
stays native without any special-casing on its own side; (2) the
title-bar's menu-label popups reuse `buildMenuTemplate` as a second
entry point rather than introducing a second, hand-authored menu
description — the alternative (a parallel renderer-side menu-structure
definition) was rejected because it would create exactly the kind of
two-sources-of-truth drift risk this codebase has consistently avoided
since Task 7 first introduced `buildMenuTemplate` as the single
description of menu structure.

---

## Task 30: Fix — Title Bar Scrolls Away With Long Documents

### The Inward Dependency Rule

No core-domain component involved — this is a pure presentation-layer
CSS fix, the same tier as Task 23/26's tree-panel geometry work.
`app.css` is the only file touched; nothing in `src/main/**`,
`src/renderer/*.js`, or `src/preload/**` changes.

### SOLID Boundary Scan

- **SRP.** `#title-bar`'s own positioning rule and `#app-body`'s
  compensating offset are two separate rule blocks for two separate
  concerns (the bar's own screen-space placement vs. the document
  content's origin below it) — not merged into one rule, even though
  both are required together for this fix to be correct.
- **OCP/DIP.** N/A at this scale, same reasoning as Task 23's
  precedent: two CSS property changes with one already-existing shared
  constant (`--title-bar-height`, defined at `:root` since Task 29) is
  not a decision point any interface or abstraction would clarify.

### Pattern Application

No GoF pattern is introduced — this is a two-rule CSS correction, not
a structural design decision. Reusing `--title-bar-height` verbatim
(rather than introducing a second value) is the only reuse decision
this task makes, and it isn't pattern-shaped.

### CSS — `src/renderer/app.css`

```css
#title-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  /* existing display/flex/height/background/border/drag rules unchanged */
}

#app-body {
  margin-top: var(--title-bar-height);
  /* existing display: flow-root unchanged */
}
```

`z-index: 10` is defensive (guardrail #76 — the bar must stay
functionally on top of scrolled document content, not merely visually
above it by paint order alone). No other property on either rule
changes; every existing `#title-bar`/`#app-body` declaration (flex
layout, drag region, `flow-root`) is untouched.

### Tests — extend `tests/e2e/window-chrome.spec.ts`

Reuses the existing `tests/e2e/fixtures/long-document.md` fixture
(already built for Task 26's independent-scrolling suite in
`tree-panel.spec.ts` — no new fixture needed).

- Open the long-document fixture, scroll to the bottom, assert
  `#title-bar`'s `getBoundingClientRect()` is unchanged from its
  pre-scroll position (guardrail #75).
- With the document scrolled partway down, click each of the three
  window-control buttons and each of the three menu labels, reusing
  Task 29's own per-button/per-label assertions verbatim at a
  non-zero scroll position instead of at the top (guardrail #76).
- At the same scrolled state, assert `#main-panel`'s content top
  offset lands exactly `var(--title-bar-height)` below the viewport
  top (guardrail #77), and that `#tree-panel`'s own position is
  unaffected (guardrail #78).
- Regression: the full existing `window-chrome.spec.ts` and
  `tree-panel.spec.ts` suites, run unmodified, stay green.

### Governance note

No ADR needed — same tier as Task 18/20/25's small, mechanical
bug-fix rows, not an architectural decision. This closes a gap Task
29's own test suite left open (no test ever opened a long enough
document to force a real page scroll before asserting title-bar
geometry), not a new design.

---

## Task 33: Fix — Raw Source in Code Tab Doesn't Wrap, Forces Horizontal Scroll

### The Inward Dependency Rule

No core-domain component involved. `highlightMarkdownSource` is a
peripheral formatting helper in `src/main/markdown.ts`; this fix
narrows its output shape only. Nothing in `src/renderer/**` or
`src/preload/**` changes — the existing `#code-content` CSS rule
(Task 32) already carries the correct behavior and simply never
reached the real text.

### SOLID Boundary Scan

- **SRP.** `highlightMarkdownSource` keeps its one responsibility
  (produce highlighted markup for a raw-source fragment); it stops
  additionally deciding the fragment's outer block-level wrapper,
  which is `#code-content`'s responsibility alone (defined once, in
  `index.html`/`app.css`, per guardrail #94).
- **OCP/DIP.** N/A at this scale — same reasoning as Task 30's
  precedent: removing one redundant wrapping element is not a decision
  point any interface or abstraction would clarify.

### Pattern Application

No GoF pattern introduced or changed — this is a one-line output-shape
correction, not a structural design decision.

### `src/main/markdown.ts`

```ts
export function highlightMarkdownSource(source: string): string {
  const value = hljs.getLanguage('markdown')
    ? hljs.highlight(source, { language: 'markdown' }).value
    : hljs.highlightAuto(source).value;
  return `<code class="hljs language-markdown">${value}</code>`;
}
```

Only the return statement changes — the `hljs.getLanguage('markdown')`
pre-check and the `highlightAuto` fallback are untouched, satisfying
functional-domain guardrail #97.

### Tests — `tests/unit/markdown.test.ts`

- Update the two existing `highlightMarkdownSource` assertions that
  check for the old `<pre><code class="hljs language-markdown">` string
  to check for `<code class="hljs language-markdown">` instead.
- Add one new regression test asserting the function's output never
  contains `<pre` at all — the direct, permanent lock-in for
  guardrail #94 at the unit level.

### Tests — new e2e spec

The concrete proof guardrail #95 requires: open a fixture with a real
prose paragraph over ~200 characters (ordinary spaces — not the
guardrail #96 single-long-token case), switch to the Code tab, and
assert:
- `page.locator('#code-content pre').count()` is `0` (guardrail #94,
  proven against the live rendered DOM, not just the string returned by
  the function).
- The container's `scrollWidth` does not exceed its `clientWidth` by
  more than a small subpixel-rounding tolerance (guardrail #95).

### Governance note

No ADR needed — same tier as Task 30's CSS/markup-shape bug-fix row,
not an architectural decision. This closes a gap Task 32's own e2e
suite left open (it asserted the `.hljs` class's presence but never
real wrap/overflow geometry), not a new design.

---

## Task 31: Main Content Scrolls Within Its Own Bounded Region (Not Body)

### The Inward Dependency Rule

Same as Task 26/30: no core-domain component involved. This is a pure
presentation-layer relocation of an existing CSS/DOM property (which
element owns document scroll), touching only `src/renderer/app.css`
and its own test suite. Nothing in `src/main/**`, `src/preload/**`, or
`src/renderer/*.js` changes — the drag-to-resize JS (Task 23) already
only ever writes the `--tree-panel-width` custom property, never reads
or writes `#main-panel` directly, so it needs zero code changes; only
verification that `#main-panel`'s new `left` rule keeps reading that
same live value correctly (guardrail #84).

### SOLID Boundary Scan

- **SRP.** The scroll-containment concern (where the document's
  scrollbar lives) is scoped entirely to `#main-panel`'s own rule
  block, not spread across `body`/`html`/`#app-body` generic rules —
  `#document-container`'s independent sizing rules (width/max-width/
  centering) stay untouched and unaware that the containment boundary
  moved.
- **OCP.** `#main-panel`'s new `overflow-y: auto` plus the `top`/
  `left`/`right`/`bottom` box is additive to the existing pattern
  `#tree-panel` already established (Task 26) — extending a proven
  rule shape to a second element, not modifying `#tree-panel`'s own
  rule at all.
- **DIP.** N/A at this scale, same reasoning as Task 23/26/30 — two
  CSS rule blocks reusing an already-existing shared constant
  (`--title-bar-height`, `--tree-panel-width`) is not a decision point
  any interface or abstraction would clarify.

### Pattern Application

No GoF pattern — this is intentional **reuse of an existing CSS
containment idiom**, not a new design decision: `#tree-panel` already
proved the `position: fixed` + bounded box + own `overflow-y: auto`
shape works for exactly this class of problem (Task 26). Applying the
identical shape to `#main-panel` is the whole point — the task's own
brief explicitly rules out reintroducing a flex-row bounded-height
model (the pattern Task 26 deliberately moved *away* from), so there
is no design choice being made here beyond "reuse the pattern that
already works, at a second call site."

### CSS — `src/renderer/app.css`

Base rule (verbatim, per the approved brief):

```css
#main-panel {
  position: fixed;
  top: var(--title-bar-height);
  left: var(--tree-panel-width);
  right: 0;
  bottom: 2rem;
  overflow-y: auto;
  /* margin-left removed -- left/right now define horizontal space directly */
}
```

**Required companion change, not in the brief's literal snippet but
necessary per guardrail #85:** `#main-panel`'s horizontal offset moves
from `margin-left` to `left`, so Task 28's existing
`body.tree-panel-hidden #main-panel { margin-left: 0; }` rule
(currently at `app.css` line ~259) must become:

```css
body.tree-panel-hidden #main-panel {
  left: 0;
}
```

Left as `margin-left: 0`, this rule would become dead code the moment
the base rule stops using `margin-left` — hiding the tree panel would
silently leave `#main-panel` permanently offset by
`var(--tree-panel-width)`, reserving an unreachable gutter where the
hidden tree panel used to be. This is exactly the kind of ripple-effect
gap this project's own Task 29 review (S-1) already flagged the value
of catching during spec-mapping rather than leaving to be discovered
mid-implementation.

`#document-container`'s own rule block is unchanged — do not touch it
(guardrail #83).

### Tests — extend `tests/e2e/window-chrome.spec.ts`

**First: confirm current state, don't assume.** Task 30's `(g)` describe
block (already merged) drives scrolling via `window.scrollTo`/reads
`window.scrollY`/`document.documentElement.scrollHeight`. Once scrolling
moves to `#main-panel`, every one of those becomes a vacuous check
(`window.scrollY` will genuinely stay `0` forever, satisfying the old
assertions for the wrong reason) — guardrail #86 requires converting
every scroll-driving/scroll-reading call in that block, not just adding
new tests alongside the stale ones. Concretely, in each of the six `(g)`
tests: `window.scrollTo(0, document.documentElement.scrollHeight)` →
`document.getElementById('main-panel').scrollTo(0,
document.getElementById('main-panel').scrollHeight)` (or the
`.scrollTop =` equivalent), and the `expect.poll(() =>
window.evaluate(() => window.scrollY))` gates → poll `#main-panel`'s own
`scrollTop` instead.

New/updated cases required:

- Scrolling `#main-panel` to its end leaves `#title-bar`'s geometry
  unchanged — the same invariant Task 30 proved (guardrail #75), now
  exercised via the correct scroll mechanism (guardrail #82).
- `window.scrollY` stays `0` throughout, even after scrolling
  `#main-panel` to its end and confirming `#main-panel.scrollTop > 0` —
  direct proof of guardrail #80 (`body`/`html` have no scroll of their
  own), not an inference from the visible symptom being gone.
- As close to a direct proof of the reported bug (guardrail #82) as
  Playwright allows: assert `#main-panel`'s own `getBoundingClientRect()`
  never extends above `var(--title-bar-height)` or below the `2rem`
  status-bar clearance, at both scroll position 0 and scrolled-to-end —
  the native scrollbar renders inside that box, so bounding the box
  bounds the scrollbar. If Playwright genuinely cannot measure the
  native scrollbar's own rendered pixels directly (worth a real
  investigation, not an assumption either way — same standard as Task
  29's double-click investigation), document that limitation honestly in
  the test's own comment and in `DEVLOG.md`, stating plainly what was
  actually proven (the containing box's geometry) versus what could not
  be directly observed (the scrollbar's own paint).
- Regression: the full existing `window-chrome.spec.ts` and
  `tree-panel.spec.ts` suites, run unmodified except for the Task 30
  scroll-mechanism conversions above, stay green — including Task 23's
  drag-to-resize suite (guardrail #84) and Task 28's hide/show tree-panel
  suite (guardrail #85's companion CSS fix).

### Governance note

No ADR needed. This reverses part of Task 12's original page-scroll
model, but through the same lens as Task 26's tree-panel containment
reversal (also no ADR) — it is a CSS containment-boundary relocation
reusing an already-proven idiom already present in this codebase, not a
new architectural pattern, new IPC surface, or new security boundary.
`app.css`'s own Task 12 header comment does not need rewriting — Task 12
described adding breathing room and a centered reading column, never
described *where* scrolling happens as a permanent architectural
commitment, so nothing in that comment becomes stale or misleading here.

---

## Task 32: Code Tab — Raw Markdown Source with Syntax Highlighting

### The Inward Dependency Rule

Same division as every prior render-pipeline task (Task 3/8): all
Markdown/highlighting transformation is a pure main-process concern
(`src/main/markdown.ts`), the renderer never imports `hljs` itself and
only toggles the pre-existing `theme-hljs-light`/`theme-hljs-dark`
stylesheet links. `highlightMarkdownSource` is added to `markdown.ts`
as a second, independent exported function — it does not call, wrap, or
get called by `markdownToHtml`. Dependencies still point inward only:
`src/main/index.ts` (outer, I/O) calls into `src/main/markdown.ts`
(inner, pure) and ships the result outward again as a plain string over
the existing `FILE_RENDERED` channel — no new dependency direction is
introduced.

The `ViewSettings` duplication fix moves `menu.ts` from an
outward-pointing-but-actually-self-contained duplicate definition to
correctly depending on `preload/api.ts` as the one canonical contract
module — `preload/api.ts` remains the innermost, most stable shape
definition that both `main/index.ts` and `main/menu.ts` (both outer,
Electron-specific) depend on, never the reverse.

### SOLID Boundary Scan

- **SRP.** `highlightMarkdownSource` has exactly one reason to change:
  how raw source is highlighted. It does not know about frontmatter
  extraction, IPC, or rendering — those stay in `index.ts` and
  `markdownToHtml` respectively. `setCurrentTab` in `index.ts` has
  exactly one reason to change: session tab-state transitions — same
  shape as `setDarkMode`/`setShowFrontmatter`/`setShowTreePanel`
  immediately above it.
- **OCP.** Adding a fourth `ViewSettings` field and a new IPC channel
  extends the existing broadcast/menu-rebuild pattern
  (`broadcastViewSettings` + `applyMenu`) without modifying its shape —
  every existing `setX` function is untouched by this task.
- **ISP.** `MenuHandlers` gains exactly one new method
  (`onSelectTab`) — existing handlers' signatures are unchanged, no
  handler is forced to know about tab state it doesn't use.
- **DIP.** `menu.ts` now depends on the `ViewSettings`/`DocumentTab`
  *abstraction* declared in `preload/api.ts` rather than maintaining its
  own concrete duplicate — this is the direct fix for guardrail #92.
  `index.ts` continues to depend on `markdown.ts`'s exported function
  signatures only, never its internals (the `hljs.getLanguage` branch
  inside `highlightMarkdownSource` is fully encapsulated).

### Pattern Application

- **Strategy (implicit, GoF behavioral).** `highlightMarkdownSource`'s
  internal branch (`hljs.getLanguage('markdown')` truthy → grammar-aware
  `highlight()`; falsy → `highlightAuto()` fallback) is the same
  "select an algorithm at call time" shape `highlightCode` already uses
  for fenced-code-block languages one function above it in the same
  file — reusing an existing in-file idiom, not introducing a new
  formal Strategy class hierarchy (this codebase's established
  precedent, per Task 21's own "Composite-shaped-without-a-class"
  decision, is to use the GoF *shape* without GoF *ceremony* at this
  scale).
- **Observer (implicit, already-established).** `currentTab` joins the
  existing `broadcastViewSettings()` fan-out — main is the subject,
  `mainWindow.webContents` and (indirectly, via `applyMenu()`) the
  native menu are the two observers. No new pattern; a fourth field
  riding the same existing channel.

### Guardrail #93 — Pre-check evidence

Verified directly against this project's pinned `highlight.js@11.11.1`
(the exact version in `package-lock.json`/`node_modules`, full-package
`import hljs from 'highlight.js'` already used by `markdown.ts`):

```
node -e "const hljs=require('highlight.js'); console.log(!!hljs.getLanguage('markdown'));"
=> true
```

The Markdown grammar is registered by the full-package import already
in use. No `highlight.js/lib/languages/markdown` explicit registration
is required. `highlightMarkdownSource`'s `highlightAuto` branch stays
in the code as a documented, currently-dead fallback per the approved
brief — it is not reachable today and its presence is not evidence the
pre-check failed.

### `src/preload/api.ts` — canonical contract changes

```ts
export type DocumentTab = 'preview' | 'code';

export interface ViewSettings {
  darkMode: boolean;
  showFrontmatter: boolean;
  showTreePanel: boolean;
  currentTab: DocumentTab;
}
```

- Add `SELECT_TAB: 'md-view:select-tab'` to `IPC_CHANNELS`.
- Extend `FileRenderedOk` with `codeHtml: string`.
- Extend `BridgeApi` with `selectTab(tab: DocumentTab): void`.

This closes guardrail #92: `ViewSettings` now has exactly one
declaration in the codebase.

### `src/main/menu.ts`

- Delete the local `ViewSettings` interface entirely.
- `import type { ViewSettings, DocumentTab } from '../preload/api';`
- Add `onSelectTab: (tab: DocumentTab) => void` to `MenuHandlers`.
- Add the two radio items (Preview/Code) to the View submenu, after a
  separator following the existing three checkboxes, exactly as
  specified in the approved brief (`menu-view-preview`/
  `menu-view-code`, `type: 'radio'`, `checked` keyed off
  `initialViewSettings.currentTab`).

### `src/main/markdown.ts`

```ts
export function highlightMarkdownSource(source: string): string {
  const value = hljs.getLanguage('markdown')
    ? hljs.highlight(source, { language: 'markdown' }).value
    : hljs.highlightAuto(source).value;
  return `<pre><code class="hljs language-markdown">${value}</code></pre>`;
}
```

Independent export, same file, no shared state or call relationship
with `markdownToHtml`/`highlightCode`/the `md` instance above it —
satisfies guardrail #90.

### `src/main/index.ts`

- `renderFile()`: pass the already-read `source` (before
  `extractFrontmatter` splits it) into `highlightMarkdownSource`; add
  `codeHtml` to the returned `FileRenderedOk`. Satisfies guardrail #87
  (full file, not `body`).
- `viewSettings` initial literal gains `currentTab: 'preview'`.
- New `setCurrentTab(tab: DocumentTab)`, same check-then-act shape as
  `forceShowTreePanelAndRebuildMenu` (no-op when already at target,
  otherwise updates state, broadcasts, rebuilds menu).
- `ipcMain.on(IPC_CHANNELS.SELECT_TAB, ...)` registered alongside the
  other fire-and-forget handlers.
- `onSelectTab: setCurrentTab` wired into `menuHandlers()` — the same
  single shared handlers-object function `applyMenu()`,
  `forceShowTreePanelAndRebuildMenu()`, and `POPUP_MENU` all already
  call, per the existing guardrail #67 precedent. Not a second,
  hand-duplicated handlers literal.

### `src/preload/index.ts`

- `selectTab: (tab) => { ipcRenderer.send(IPC_CHANNELS.SELECT_TAB, tab); }`,
  same fire-and-forget shape as `requestTreeParent`.

### `src/renderer/index.html`

- Add `<pre id="code-content" hidden></pre>` as a sibling of `#content`
  inside `#document-main`. `#content`/`#frontmatter` are untouched.

### `src/renderer/renderer.js`

- One shared `applyTab(tab)` function (per guardrail #89: two trigger
  paths must not drift) that toggles `.active` on `#tab-preview`/
  `#tab-code` and toggles `hidden` on `#content`/`#code-content`. Called
  from both: the click handlers (which additionally call
  `window.mdview.selectTab(tab)`) and `onViewSettings` (which does not
  — it is reacting to state that already changed in main, not
  requesting a change).
- `onFileRendered` inserts `message.codeHtml` into `#code-content` via
  the same `innerHTML`-insertion shape `renderHtml` already uses for
  `message.html` into `#content` — same trust boundary (guardrail #91).

### `src/renderer/app.css`

- `#code-content`: same monospace stack as `#frontmatter`
  (`ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace`),
  `white-space: pre-wrap`, `padding-inline: 2rem` matching `#content`.
  No new stylesheet, no duplicated color values — reuses the already-
  loaded `theme-hljs-light`/`theme-hljs-dark` `.hljs` classes.

### Test Plan

- **Unit** (`tests/unit/markdown.test.ts`, extended): known snippet →
  expected `hljs-*` spans; empty string → no throw; `<script>`-like
  text → HTML-escaped (mirrors the existing `markdownToHtml` script-tag
  regression tests at the same file). Separate `renderFile` fixture
  test (with real frontmatter) asserting `codeHtml` contains the
  frontmatter block literally — the concrete, permanent lock-in for
  guardrail #87.
- **Integration** (`tests/integration/preload-api-contract.test.ts`,
  extended): new `describe('Task 33: codeHtml field / SELECT_TAB
  channel')` block — reusing the file's own established "Honest
  limitation" comment convention for interface-shape tests, per the
  approved brief verbatim (the block's own label carries the brief's
  "Task 33" numbering; this Step 1 doc's task numbering for this
  feature is 32, continuing this project's actual sequential run — see
  Presented-to-user note below).
- **e2e** (new/extended `.spec.ts` under `tests/e2e/`): Code tab click
  → `.hljs` class present inside `#code-content`; Preview click
  restores `#content` visible; `with-frontmatter` fixture shows the
  frontmatter text literally inside `#code-content`; View-menu
  "Code" selection updates the visible tab; direct tab-button click
  followed by opening the View menu shows "Code" checked (guardrail
  #89's round-trip proof).

### Governance note

No ADR needed — this is an additive IPC field, an additive
`ViewSettings` field, and a second independent pure transformation
function, all following patterns this codebase has already used
repeatedly (Task 17's request-response precedent is not needed here;
`SELECT_TAB` is fire-and-forget like `REQUEST_TREE_PARENT`). The
`ViewSettings` de-duplication is a defect fix, not an architectural
change — it makes the existing intended architecture (one canonical
contract module) actually hold.

**Presented-to-user note:** the approved task brief's own text is
inconsistently numbered — its title says "TASK 32" but two internal
guardrail references say "Task 33" (the integration test's `describe`
label, and one unit-test cross-reference). `RUN_LOG.md`'s last entry is
Task 31, so this feature is sequentially Task 32 in this project's own
numbering, and both spec documents above file it as such. The
`describe('Task 33: ...')` string is preserved verbatim as an explicit,
literal instruction in the brief rather than silently renumbered —
flagged here, not corrected unilaterally.

---

## Task 34: Copy Raw Markdown Source Button

Adds a "copy raw source" button to `#document-header`, opposite the
Preview/Code tabs (same `flex: 1 1 auto` spacer shape `#title-bar`
already solved via `#title-bar-spacer`, Task 29), that copies the
on-disk file content to the system clipboard. See
`functional_domain.md`'s Task 34 entry for the domain-level rationale;
this section maps that to concrete files, following the Inward
Dependency Rule (the new pure predicate has zero Electron/DOM
dependency, same tier as `shouldShowFrontmatter`) and reusing the
existing GoF/idiom precedents this codebase already established rather
than inventing new ones.

### The Inward Dependency Rule / SOLID Boundary Scan

- `canCopyRawSource` is a leaf, dependency-free predicate (same
  boundary tier as `shouldShowFrontmatter`/`firstDroppedFile`) —
  importable and unit-testable with zero DOM, zero Electron, zero
  bundler, guarded behind the file's existing `typeof module !==
  'undefined'` export block.
- The clipboard capability is exposed through `BridgeApi` as an
  abstract contract (`copyRawSource(text): Promise<boolean>`) — the
  renderer depends on that interface, not on `ipcRenderer` or
  `clipboard` directly (DIP, same as every existing `BridgeApi`
  method). The concrete implementation (`ipcRenderer.invoke` in
  preload, `clipboard.writeText` in main) sits at the outer,
  peripheral boundary; the renderer's click handler is the only
  "core" caller and it only ever talks to `window.mdview.copyRawSource`.

### Pattern Application

- **Request-response IPC pair** (`ipcMain.handle`/`ipcRenderer.invoke`):
  reuses Task 17's `REQUEST_LIST_DIRECTORY` pattern exactly — the
  second instance of this shape in the app, grouped alongside it in
  `main/index.ts` per the brief. Not a new pattern; a second
  application of an existing one, which is itself evidence the app's
  IPC surface isn't fragmenting into one-off shapes per feature.
- **Two-state toggle via CSS class** (`.copied`): matches the existing
  `.active`/`.dark-mode`/`hidden`-attribute toggling idioms already
  used for `.doc-tab`, `body.dark-mode`, and `#empty-state` — no new
  state-toggling mechanism introduced.
- **Pure predicate + thin DOM wiring split**: same shape as every
  other renderer.js predicate (`shouldShowFrontmatter`,
  `firstDroppedFile`, `needsFetch`, `isPathUnder`) — decision logic
  above the `typeof document` guard, DOM effects below it.

### File-by-file mapping

- **`src/preload/api.ts`**: add `COPY_RAW_SOURCE: 'md-view:copy-raw-source'`
  to `IPC_CHANNELS`; add `copyRawSource(text: string): Promise<boolean>;`
  to `BridgeApi`. Both additive — zero diff to any existing channel or
  method signature.
- **`src/preload/index.ts`**: `copyRawSource: (text) =>
  ipcRenderer.invoke(IPC_CHANNELS.COPY_RAW_SOURCE, text)` — same
  `invoke` shape as `listDirectory`.
- **`src/main/index.ts`**: add `clipboard` to the existing Electron
  import line; register `ipcMain.handle(IPC_CHANNELS.COPY_RAW_SOURCE,
  ...)` grouped next to Task 17's handler, guarding on `typeof text ===
  'string'` before calling `clipboard.writeText(text)` and returning
  `true`/`false`.
- **`src/renderer/index.html`**: `#document-header-spacer` +
  `#copy-raw-source` button (disabled by default), inline SVG icons per
  ADR-006, inserted after `#tab-code` inside `#document-header`.
- **`src/renderer/app.css`**: `#document-header-spacer { flex: 1 1
  auto; }` (mirrors `#title-bar-spacer`); `.doc-header-action` base +
  hover + disabled + dark-mode styling; `.copied` icon-swap rules;
  update the file's top-of-file zero-icon-dependency comment to
  reference ADR-006.
- **`src/renderer/renderer.js`**: `canCopyRawSource(message)` predicate
  grouped with the other pure predicates above the `typeof document`
  guard; DOM wiring (element lookup, `onFileRendered`-driven
  `disabled` toggle, click handler awaiting `copyRawSource` and toggling
  `.copied` for 1.5s) inside the existing `typeof document !==
  'undefined'` block; export added to the `typeof module !==
  'undefined'` block.

### Governance note

No new ADR needed for the IPC shape (Task 17 precedent covers it) —
ADR-006 covers only the icon exception, per the Lead's decision, and
must be written verbatim before any other file changes per the brief.

---

## Task 37 Technical Specification — Configuration Subsystem (settings.json)

See `functional_domain.md`'s Task 37 entry for the domain-level
rationale, including the explicit, disclosed supersession of Task 8's
"session-scoped, not persisted" guardrail #6. This section maps that to
concrete files.

**Confirmed with the user before this spec was finalized:** the
persisted v1 defaults match today's existing session defaults exactly
(`Dark Mode: false`, `Show Frontmatter: true`, `Show File Tree: true`)
— the task brief's own example JSON (`"Dark Mode": true`) was
illustrative shape only, not a literal instruction to also flip Task
8's deliberately-chosen off-default.

### The Inward Dependency Rule / SOLID Boundary Scan

- **`src/main/settings.ts` (new) — pure core, zero `fs`/Electron
  imports.** Same boundary tier as `frontmatter.ts`/`fileTree.ts`: the
  zod schema, the `SettingsFile` type, `parseSettings(raw: string):
  SettingsFile | null`, `defaultSettingsFile`, and the two symmetric
  mapping functions between the on-disk shape and the in-memory
  `ViewSettings` shape all live here, importable and unit-testable with
  no Electron runtime required. `parseSettings` owns *both* JSON-syntax
  failure and schema-shape failure as one pass/fail question — it does
  not know or care whether it was called from a startup load or a
  refocus re-read (DIP: the orchestration layer depends on this
  abstraction's yes/no answer, never the reverse).
- **`src/main/settingsStore.ts` (new) — I/O orchestration, no
  Electron import, only `node:fs/promises` + `node:path`.** Same
  architectural role `watcher.ts` already plays for chokidar: a
  self-contained I/O module `index.ts` imports and calls, never
  imported by `settings.ts` itself. This is where the startup-vs-
  refocus asymmetry (functional_domain.md guardrail #103) actually
  lives, expressed as two differently-named functions rather than one
  function with an internal mode flag — each function's own body reads
  as its own complete recovery policy, not a shared function branching
  on a caller-supplied enum.
- **`src/main/index.ts` and `src/main/menu.ts` — outer, peripheral
  boundary, unchanged in kind.** `app.getPath('userData')`,
  `shell.openPath`, and the `mainWindow.on('focus', ...)` listener are
  exactly the class of "CLI shell / file-system I/O / third-party
  runtime" concern the Inward Dependency Rule reserves for this layer
  — same tier as the existing `dialog.showOpenDialog`/`clipboard.
  writeText` calls already here. Neither `settings.ts` nor
  `settingsStore.ts` ever imports `electron`.
- **No new `BridgeApi`/`IPC_CHANNELS`/preload surface at all.** Verified
  against the existing renderer code (`src/renderer/renderer.js`
  `window.mdview.onViewSettings` handler, lines 249–261): it already
  applies `darkMode`, `showFrontmatter`-driven visibility, and
  `showTreePanel` idempotently on every `ViewSettings` broadcast, and
  `broadcastViewSettings()` already fires once on `did-finish-load`
  (main/index.ts, unconditional, Task 8) — i.e. "get current settings
  once on load" and "subscription for settings-changed broadcasts" are
  both *already* the existing `VIEW_SETTINGS` channel end to end. This
  is the concrete instance of the brief's "reuse however Dark Mode's
  initial state reaches the renderer today, don't build a parallel
  mechanism" instruction: the correct implementation adds zero lines to
  `preload/api.ts`, `preload/index.ts`, and `renderer.js`. A refocus
  reconciliation only needs to (a) update `viewSettings` in main and (b)
  call the existing `broadcastViewSettings()` again — the renderer side
  requires no new code to react correctly.

### Pattern Application

- **Strategy-shaped recovery, expressed as two named functions, not one
  flag-branching function**: `loadSettingsAtStartup` (self-healing:
  overwrites on invalid content) and `rereadSettingsOnFocus`
  (protective: never touches memory/UI/disk on invalid content) are
  two distinct policies over the same `parseSettings` question —
  closer to the GoF Strategy shape (interchangeable algorithms behind
  a shared question) than an `if (mode === 'startup')` conditional
  buried inside one function.
- **Adapter-shaped mapping** between the on-disk Title-Case/`View`-
  namespaced schema and the existing internal `ViewSettings` camelCase
  shape (`toPersistedViewSettings`/`fromViewSettings` in `settings.ts`)
  — the same kind of narrow, explicit translation already implicit
  wherever this app crosses a schema boundary (e.g.
  `FileRenderedMessage` vs. the DOM state `renderer.js` derives from
  it), now made an explicit, named, independently-testable function
  pair instead of inline reshaping at each call site.
- **Full-menu-rebuild reconciliation, reusing the existing `applyMenu()`
  idiom — not a new "hold `MenuItem` references and mutate `.checked`
  in place" mechanism.** `applyMenu()` already rebuilds the entire
  native menu from current `viewSettings` on every state change that
  must be reflected in checkmarks (Task 28's
  `forceShowTreePanelAndRebuildMenu`, Task 32's `setCurrentTab`) — a
  freshly-built menu with the right `checked` values baked in is
  behaviorally identical to mutating a persisted `MenuItem` reference,
  and introducing a second, parallel "find item by id and set
  `.checked`" mechanism alongside the existing rebuild-based one would
  fragment a pattern this codebase has deliberately kept singular since
  Task 28. **This is a deliberate, disclosed deviation from the task
  brief's literal "requires keeping references to the built `MenuItems`"
  wording** — flagged here explicitly for the user's approval alongside
  this blueprint, rather than silently substituted.
- **Request-response vs. fire-and-forget, matching existing precedent
  per call shape**: `writeSettingsFile`/`ensureSettingsFileExists`/
  `loadSettingsAtStartup`/`rereadSettingsOnFocus` are all `async`
  functions `index.ts` `await`s internally — none of them need a new
  IPC shape, since every trigger (menu toggle, focus event, File menu
  click, app startup) already originates in the main process.

### File-by-file mapping

- **`src/main/settings.ts` (new)**: zod object schema (`z.object({
  View: z.object({ 'Dark Mode': z.boolean(), 'Show Frontmatter':
  z.boolean(), 'Show File Tree': z.boolean() }).strict() }).strict()`
  — `.strict()` at both levels so extra keys fail validation, per
  functional_domain.md guardrail #104. Exports: `SettingsFile` (zod-
  inferred type), `defaultSettingsFile`, `parseSettings(raw: string):
  SettingsFile | null` (catches `JSON.parse` syntax errors internally,
  folds them into the same null result as a schema failure —
  `parseSettings` reports one pass/fail outcome, never distinguishes
  "bad JSON" from "bad shape" to its caller), `toPersistedViewSettings
  (file: SettingsFile): Pick<ViewSettings, 'darkMode' |
  'showFrontmatter' | 'showTreePanel'>`, `fromViewSettings(v:
  Pick<ViewSettings, 'darkMode' | 'showFrontmatter' |
  'showTreePanel'>): SettingsFile`.
- **`src/main/settingsStore.ts` (new)**: `loadSettingsAtStartup
  (filePath: string): Promise<SettingsFile>` — read; on any read
  failure (including a simply-missing file — functional_domain.md
  guardrail #108 / the brief's "not required to exist to boot") return
  `defaultSettingsFile` with **no disk write**; on a successful read
  that fails `parseSettings`, write `defaultSettingsFile` to disk
  (self-heal) and return it. `rereadSettingsOnFocus(filePath: string):
  Promise<SettingsFile | null>` — read; any read failure or
  `parseSettings` failure returns `null` (discard-this-read, guardrail
  #103), never writes, never touches anything else. `ensureSettings
  FileExists(filePath: string): Promise<void>` — existence-check only
  (`fs.access` or equivalent); writes `defaultSettingsFile` only when
  the file is truly absent, leaves an existing-but-corrupt file
  completely untouched (same "never salvage, never silently rewrite
  what the user might be mid-editing" posture as the refocus path).
  `writeSettingsFile(filePath: string, settings: SettingsFile):
  Promise<void>` — `fs.mkdir(dirname, { recursive: true })` then
  `fs.writeFile(filePath, JSON.stringify(settings, null, 2))` (pretty-
  printed for human editing, per the brief).
- **`src/main/menu.ts`**: add `onOpenSettings: () => void;` to
  `MenuHandlers`; add a `{ id: 'menu-settings', label: 'Settings',
  click: handlers.onOpenSettings }` item (with a bracketing separator)
  to the File submenu, between "Open Folder…" and "Exit".
- **`src/main/index.ts`**:
  - `const settingsFilePath = path.join(app.getPath('userData'),
    'settings.json');` computed once inside `app.whenReady()`.
  - `app.whenReady()`'s callback becomes `async`; before
    `createWindow()`, `await loadSettingsAtStartup(settingsFilePath)`
    and merge its `toPersistedViewSettings(...)` result into the
    existing `viewSettings` default object — preserving the existing
    "register `did-finish-load` listeners synchronously, before any
    further await" invariant (Task 2/ADR-001 precedent) by keeping the
    `await` strictly *before* `createWindow()`/`applyMenu()`, never
    between them.
  - `setDarkMode`/`setShowFrontmatter`/`setShowTreePanel` each become
    `async`, and each now also calls (and awaits) a new
    `persistCurrentViewSettings()` helper — `writeSettingsFile
    (settingsFilePath, fromViewSettings(viewSettings))` — after
    updating `viewSettings` and broadcasting, so a toggle always
    persists the *entire* current object (guardrail #106), never a
    single-key patch. `MenuHandlers`'s existing `(checked: boolean) =>
    void` click-handler type is unaffected — returning a `Promise<void>`
    from a `void`-typed callback is legal TS and matches how Electron
    already treats these as fire-and-forget from its own call site.
  - New `onOpenSettings()` handler: `await ensureSettingsFileExists
    (settingsFilePath); await shell.openPath(settingsFilePath);` —
    `shell` is already imported in this file (Task 5).
  - New `mainWindow.on('focus', onWindowFocus)` registered inside
    `createWindow()`, where `onWindowFocus` calls
    `rereadSettingsOnFocus(settingsFilePath)`; on `null`, returns
    immediately (guardrail #103/#107 — no memory/UI/menu/disk change).
    On a valid result, compares its three persisted fields against
    current `viewSettings` (plain field equality — three booleans, no
    new pure helper needed for this trivial glue check, same tier as
    the existing inline `if (viewSettings.showTreePanel) return;` guard
    already in this file) and, only if different, merges it in,
    `broadcastViewSettings()`, and `applyMenu()` — applying the changed
    settings to memory, the live UI (via the existing broadcast path),
    and the menu checkmarks together, in that order, satisfying
    guardrail #107's "together or not at all."
  - `menuHandlers()` gains `onOpenSettings`.
- **`package.json`**: add `zod` to `dependencies` (see ADR-008).
- **`src/main/help/help.md`** / **`README.md`**: one bullet each
  documenting the new File → Settings item and that View-menu toggles
  now persist across relaunches — same "keep the README/help in sync
  with each new discoverable menu entry" convention every prior menu-
  affecting task has followed.

### Existing test this task must knowingly invert

`tests/e2e/view-menu.spec.ts` test (d), *"close-and-relaunch proves no
persistence of view settings"*, currently asserts
`checkedAfterRelaunch === false` and exists specifically to pin Task
8's now-superseded guardrail #6. This task must rewrite that test (new
name, inverted assertion — `checkedAfterRelaunch === true` after
toggling and relaunching against the same `userDataDir` — the test's
existing two-sequential-launches-same-profile structure is otherwise
exactly what this task also needs to prove) rather than leave a stale,
now-false assertion in the suite or silently delete the coverage.

### Test Plan mapping (see functional_domain.md's Task 37 entry and the
brief's own Test Plan for the full list)

- `tests/unit/settings.test.ts`: `parseSettings` — valid input; invalid
  JSON; valid JSON with wrong types / missing keys / extra keys (each
  a separate case, all → `null`); `toPersistedViewSettings`/
  `fromViewSettings` round-trip.
- `tests/integration/settingsStore.test.ts`: real `fs` against a
  `fs.mkdtempSync` temp dir (same isolation idiom as the e2e
  `userDataDir` fixture) — startup-corrupt→defaults-in-memory-and-
  file-rewritten; refocus-corrupt→`null`-returned-and-file-untouched;
  `ensureSettingsFileExists` creates only when missing, never touches
  an existing corrupt file; `writeSettingsFile` writes the full,
  pretty-printed object.
- `tests/e2e/view-menu.spec.ts` (rewritten test (d), per above) +
  a new case: toggling a View setting persists the full object to
  `settings.json` immediately (read the file directly from the
  fixture's `userDataDir` after the click).
- `tests/e2e/settings-menu.spec.ts` (new): File → Settings creates the
  file if missing and calls `shell.openPath` with the exact computed
  path — spy via `electronApp.evaluate` monkey-patching `shell.openPath`
  before the click (same "intercept a main-process side effect for
  assertion" idiom `ui-shell.spec.ts` already uses for the DevTools
  guard bridge), never launching a real external editor in CI.
- Fault-injection (per this project's now-standing discipline since
  Task 4): temporarily break `parseSettings` (e.g. force it to always
  return the parsed value without schema validation), confirm both the
  startup-corrupt and refocus-corrupt integration tests go RED, restore
  via `git apply -R`, confirm both GREEN again — required evidence in
  the review report, not merely asserted.

### Governance note

Zod is a new dependency requiring an ADR per this project's standing
convention (chokidar-over-`fs.watch`, highlight.js-over-Shiki
precedents) — see `ADR-008_md-view.md`, written before any other file
in this task's scope is touched.

---

## Task 38: Unit test coverage reporting

### The Inward Dependency Rule

Not implicated. This task adds no code to `src/**` and therefore
crosses no dependency boundary in either direction — `@vitest/
coverage-v8` and its config block live entirely in the outermost,
peripheral "Frameworks & Tools" ring (test runner configuration),
alongside the existing `vitest.config.ts` / `playwright.config.ts`.
Nothing in `src/**` gains an awareness of, or dependency on, the
coverage tooling.

### SOLID Boundary Scan

Not implicated. No new interface, abstract contract, or concrete
implementation is introduced in application code; DIP has nothing to
enforce here since there is no new collaborator being wired in. This
task is a test-runner configuration change, not a design change to
the codebase's own modules.

### Pattern Application

None. GoF patterns govern collaboration between objects in source
code; there is no source-code collaboration being introduced by
adding a coverage reporter to the test runner. Noting this explicitly
rather than force-fitting a pattern where none applies.

### Concrete plan

- **`package.json`**: add `@vitest/coverage-v8@^2.1.0` (pinned to match
  the installed `vitest@^2.1.0` / resolved `2.1.9`, not `latest`, to
  avoid pulling a vitest-3.x-only coverage package) as a devDependency;
  add a new, standalone `test:coverage` script:
  `"vitest run tests/unit --coverage"`. Per guardrail #111, `test`,
  `test:unit`, `test:integration`, `test:e2e`, `test:all` are untouched.
- **`package-lock.json`**: regenerated by `npm install`, not hand-edited.
- **`vitest.config.ts`**: add a `coverage` block (`provider: 'v8'`,
  `include: ['src/**']`, `exclude: ['tests/**', '**/*.config.*',
  'src/renderer/index.html']`, `all: false`, `reporter: ['text',
  'html']`, `reportsDirectory: './coverage'`), per guardrails #109
  (no thresholds) and #110 (unit-only via the script's `tests/unit`
  arg, not a config-level scope). The existing `test.environment:
  'node'` setting is left untouched.
- **`.gitignore`**: add `/coverage` — checked first against the
  existing `node_modules`/`dist`/`release`/`test-results`/
  `playwright-report` entries to avoid a duplicate pattern (none of
  those currently cover it).
- **`README.md`**: add a `test:coverage` row to the Commands table,
  describing it as generating a coverage report for the unit suite,
  informational only, no enforced threshold — matching guardrail #109
  in the documentation, not just the config.
- Per guardrail #112: after running `test:coverage`, the engineer must
  inspect `coverage/index.html` for any file that should not
  plausibly appear (e.g. something pulled in only transitively rather
  than genuinely unit-tested), add a targeted `coverage.exclude` entry
  if one turns up, and record the finding plus the fix in the PR
  description — not leave a misleading number unaddressed.

### Test Plan mapping

No new application behavior is introduced, so no new
`tests/unit/*.test.ts` cases are required by this task. Verification
is operational, not TDD Red-Green-Refactor over new source: run
`npm run test:coverage` and confirm (a) the text summary prints on
completion, (b) `coverage/index.html` is generated, (c) `npm run
test:unit` and `npm run test:all` still pass unmodified (regression
check per guardrail #111). Fault-injection is explicitly out of scope
for this task per the Lead's task brief — there is no new pure
function or security guardrail to invert.

### Governance note

No new ADR is required — `@vitest/coverage-v8` is the same publisher's
first-party coverage provider for the test runner already in use
(`vitest`), not a new tooling *choice* between competing options in
the sense the chokidar/highlight.js precedents were.

---

## Task 39: Bump CI/build Node.js target from 20 to 24 (Step 1)

Maps [functional_domain.md § Task 39](functional_domain.md) to a concrete
change plan.

### The Inward Dependency Rule

Not applicable in the architectural sense — this task touches only
peripheral build/CI tooling, never the `src/main`/`src/preload`/
`src/renderer` layers or their bridge contract. No dependency-direction
change occurs.

### SOLID Boundary Scan

Not applicable — no interfaces, abstractions, or concrete
implementations are introduced or modified. This is toolchain-version
configuration, not object collaboration.

### Pattern Application

None. GoF patterns govern object collaboration in source code; there is
no source-code collaboration being introduced by a CI/build Node
version bump. Noting this explicitly rather than force-fitting a
pattern where none applies, matching Task 38's precedent.

### Concrete plan

- **`.github/workflows/ci.yml`**: `node-version: 20` → `node-version: 24`
  under the existing `actions/setup-node@v4` step. No other change to
  the workflow.
- **`.github/workflows/release.yml`**: same single-line change, same
  action step.
- **`package.json`**:
  - Add `"engines": { "node": ">=24.0.0" }` as a new top-level field
    (per guardrail #114 — a floor, not a copy of the CI-pinned value).
  - Bump `@types/node` devDependency from `^22.7.0` to the current
    `^24.x` latest, resolved via `npm view @types/node version` or
    `npm install --save-dev @types/node@^24`.
  - `electron`, `electronBuilder`/`electron-builder.yml`, `src/**`,
    and `vitest.config.ts`/coverage tooling are explicitly untouched
    (guardrail #113).
- **`package-lock.json`**: regenerated by `npm install`, not
  hand-edited.

### Test Plan mapping

No new application behavior is introduced, so no new
`tests/unit/*.test.ts` cases are required — this is operational
verification, not TDD Red-Green-Refactor over new source (same class
as Task 38). Required verification, per guardrail #115:

1. `npm ci` succeeds cleanly under Node 24 (local or CI-observed).
2. `npm run build` succeeds with zero new TypeScript errors.
3. `npm run test:unit` and `npm run test:integration` both pass.
4. `npm ls @types/node` resolves to the bumped major.
5. `git status` / `git diff --stat` shows changes confined to
   `.github/workflows/ci.yml`, `.github/workflows/release.yml`,
   `package.json`, `package-lock.json` — zero diff in `src/**`,
   `electron-builder.yml`/`electronBuilder` config, the `electron`
   dependency line, or `vitest.config.ts`.

### Governance note

No new ADR required — this is a routine EOL-driven runtime bump of an
existing, already-adopted tool (Node.js via `actions/setup-node`), not
a new tooling choice between competing options.

---

## Task 40: Electron 33 → 38 checkpoint (Step 1)

### The Inward Dependency Rule

Unaffected. This is a peripheral-boundary tooling bump (the Electron
runtime binary and its bundled Node/Chromium/V8) — no application code
changes direction of dependency; `src/main`, `src/preload`, and
`src/renderer` remain exactly as architected.

### SOLID Boundary Scan

Not applicable — no interface or abstraction changes. `windowConfig.ts`
and the `BridgeApi` contract (`src/preload/api.ts`) are DIP boundaries
already in place and are not touched by this task (guardrail #117).

### Pattern Application

Not applicable — no design pattern changes; this is a dependency
version bump only.

### Concrete Plan

Per the Phase 1 audit (`functional_domain.md`, Task 40 section):
no blocking conflict was found, so this proceeds without a STOP
escalation.

1. `package.json`: bump `"electron": "^33.0.0"` → `"electron": "^38.8.6"`
   (latest published 38.x patch, confirmed via `npm view electron
   dist-tags` → `38-x-y: 38.8.6`). `electron-builder` stays at
   `^25.1.0` — Phase 1 found no documented incompatibility; Phase 2's
   actual `npm run package` step is the final confirming check per
   guardrail #116.
2. `package-lock.json`: regenerated by `npm install`, lockfile-only
   consequence of (1) — no hand-editing.
3. No `src/**` changes anticipated. If Phase 2 discovers Electron 38
   genuinely requires a source change (e.g., an API this app calls was
   actually removed, contradicting Phase 1's findings), the engineer
   stops and reports rather than routing around it — same contract as
   any other scope boundary.
4. Regression gate: `npm run build`, `test:unit`, `test:integration`,
   `test:e2e` all green.
5. Fault-injection: only for behavior that actually changed as a
   result of the bump. Phase 1 found no such behavior change in this
   app's code paths (guardrails #116-118 are the testable surface —
   dependency line, security settings unchanged, bundled Node version)
   — so fault-injection here means proving guardrail #118 (bundled Node
   version) via a real packaged-build check, not synthetic source
   mutation of unrelated code.
6. Manual verification: `npm run package`, then launch the packaged
   installer, confirm the app opens and renders a markdown file, and
   confirm `process.version` reports `v22.18.0` (or the exact patch
   Electron 38.8.6 bundles) in the main process — guardrail #119.

### In-scope files

- `package.json`
- `package-lock.json`

(`.agents/specs/*.md` and `.agents/current_scope.json` itself are
governance/contract artifacts, handled outside the engineer's scope
grant per standing practice.)

### Expected output format

Diff (not full rewrite) — this is a two-line dependency-version change
plus its lockfile regeneration, not a rewrite of either file.

### Spec section this closes

`functional_domain.md` Task 40 section, guardrails #116-119.

---

## Task 41: Electron 38 → 44 checkpoint (Step 1)

### The Inward Dependency Rule

Unaffected — same reasoning as Task 40. This is a peripheral-boundary
tooling bump; no application code changes direction of dependency.
`src/main`, `src/preload`, and `src/renderer` remain exactly as
architected.

### SOLID Boundary Scan

Not applicable — no interface or abstraction changes. `windowConfig.ts`
and the `BridgeApi` contract (`src/preload/api.ts`) are DIP boundaries
already in place and are not touched by this task (guardrail #121). The
`clipboard.writeText()` call stays behind the same `COPY_RAW_SOURCE`
IPC boundary it was already behind (guardrail #122) — Electron 44's
renderer-clipboard removal requires no boundary change here because the
boundary was already drawn in the correct place.

### Pattern Application

Not applicable — no design pattern changes; this is a dependency
version bump only.

### Concrete Plan

Per the Phase 1 audit (`functional_domain.md`, Task 41 section): no
blocking conflict was found, so this proceeds without a STOP
escalation.

1. `package.json`: bump `"electron": "^38.8.6"` → `"electron": "^44.3.0"`
   (latest published 44.x patch, confirmed via `npm view electron
   dist-tags` → `44-x-y: 44.3.0`). `electron-builder` stays at
   `^25.1.0` — Phase 1 found no documented incompatibility; Phase 2's
   actual `npm run package` step is the final confirming check per
   guardrail #120.
2. `package-lock.json`: regenerated by `npm install`, lockfile-only
   consequence of (1) — no hand-editing.
3. No `src/**` changes anticipated. Phase 1's clipboard audit (item (c))
   confirmed the app already conforms to Electron 44's renderer-side
   `clipboard` removal — there is nothing to migrate. If Phase 2
   discovers Electron 44 genuinely requires some other source change
   (contradicting Phase 1's findings), the engineer stops and reports
   rather than routing around it — same contract as any other scope
   boundary.
4. Regression gate: `npm run test:all` (unit + integration + e2e,
   rebuilding `dist/` first) — the authoritative run per Task 40's
   established practice, not the individual `test:unit`/`test:integration`
   commands run in isolation.
5. Fault-injection: only for behavior that actually changed as a result
   of the bump. Phase 1 found no in-app behavior change (guardrails
   #120-123 are the testable surface — dependency line, security
   settings unchanged, clipboard call site unchanged, bundled Node
   version) — so fault-injection here means proving guardrail #123
   (bundled Node version) via a real packaged-build check, not synthetic
   source mutation of unrelated code.
6. Manual verification: `npm run package`, then launch the packaged
   installer with `ELECTRON_RUN_AS_NODE` explicitly stripped from the
   launching shell first (pre-existing machine hazard, documented in
   `functional_domain.md`), confirm a real visible window via a
   window-title-level check (not just process liveness — Task 40's
   review finding), and confirm `process.version` reports a `v24.x.y`
   version via `ELECTRON_RUN_AS_NODE=1 npx electron -e
   "console.log(process.version)"` — guardrail #124. Report the exact
   patch seen; a different-but-same-major patch from whatever 44.0.0's
   original release notes stated is expected drift, not a discrepancy,
   per guardrail #123.

### In-scope files

- `package.json`
- `package-lock.json`

(`.agents/specs/*.md` and `.agents/current_scope.json` itself are
governance/contract artifacts, handled outside the engineer's scope
grant per standing practice.)

### Expected output format

Diff (not full rewrite) — this is a two-line dependency-version change
plus its lockfile regeneration, not a rewrite of either file.

### Spec section this closes

`functional_domain.md` Task 41 section, guardrails #120-124.

---

## Task 42: v1.1.0 release documentation & housekeeping (Step 1)

No architectural impact: no runtime code, no layer boundary, no interface,
no GoF pattern applicable (explicitly noted, matching Task 38/39 precedent
rather than force-fitted). The inward-dependency rule is unaffected because
no source file is touched.

### Changes

1. `package.json` `version` 1.0.0 → 1.1.0; `package-lock.json` top-level
   `version` and `packages[""].version` hand-edited to match (two-line
   edit, no `npm install`).
2. `CHANGELOG.md`: `## [Unreleased]` → `## [1.1.0] - 2026-09-19`, nothing
   else touched.
3. `README.md`: "Status: v1.0.0." → "Status: v1.1.0."; add a
   `CHANGELOG.md` link to the "About this project" process-link list.
4. `src/main/help/help.md`: add Folder sidebar section, Preview/Code tabs
   section, copy-raw-source line, `Ctrl/Cmd+Shift+O` shortcut row; delete
   the trailing "Out of scope for this task" section.

### Verification

- `git diff --stat` shows exactly the five in-scope files.
- Reviewer reads the README.md and help.md diffs line by line (guardrail
  #131) and greps `src/` for `Out of scope for this task`.
- `npm run test:unit` + `npm run test:integration` still green (CI gate,
  ADR-007); help.md is loaded by the Help window, so a build sanity check
  is worthwhile. No TDD RGR loop applies — no testable logic (Task 19/35/36
  docs-task exemption).

### In-scope files

- `package.json`
- `package-lock.json`
- `CHANGELOG.md`
- `README.md`
- `src/main/help/help.md`

### Expected output format

Diff (targeted edits), not full rewrites.

### Spec section this closes

`functional_domain.md` Task 42 section, guardrails #125-131.

---

## Task 43: "What's New" release notes on update (Step 1)

### The Inward Dependency Rule

```
[ Domain: pure, no fs/Electron ]     changelog.ts   appState.ts
                ^
[ Use case: Electron-free, ports ]   whatsNew.ts   (domain + port interfaces only)
                ^
[ Adapters ]                         appStateStore.ts (node:fs)
                                     whatsNewWindow.ts / helpWindow.ts (pure HTML + decision)
                ^
[ Composition root / Electron ]      index.ts (paths, BrowserWindow, app.getVersion())
```

Dependencies point inward only. `changelog.ts`/`appState.ts` import nothing
but `zod`; `whatsNew.ts` imports them and declares the ports it needs;
`appStateStore.ts` implements persistence with `node:fs`; only `index.ts`
touches Electron and binds concrete paths.

### SOLID Boundary Scan

- **SRP:** extraction (changelog.ts), state schema + announcement decision
  (appState.ts), state persistence (appStateStore.ts), the show/skip/record
  workflow (whatsNew.ts), HTML shell + window decision (whatsNewWindow.ts,
  helpWindow.ts), Electron wiring (index.ts). One reason to change each.
- **OCP:** `buildHelpHtml(contentHtml, cssHrefs, title = 'md-view Help')` gains
  an optional third parameter; every existing call site and test stays valid.
- **DIP:** `whatsNew.ts` receives a `WhatsNewPorts` object (`loadState`,
  `saveState`, `readChangelog`) instead of importing `fs`, so the workflow is
  unit-tested with in-memory fakes. `appStateStore.ts` is the concrete adapter,
  wired in `index.ts`.
- **ISP:** three narrow single-function ports, not a store-shaped interface.
- **LSP:** n/a (no inheritance introduced).

### Pattern Application

- **Ports & Adapters / Strategy (function-valued ports)** for `whatsNew.ts` I/O.
- **Facade:** `prepareWhatsNew()` / `recordVersionSeen()` hide the
  read-state / decide / read-changelog / extract sequence behind two calls
  `index.ts` composes.
- **Parameterization over inheritance** (composition rule): one HTML shell,
  varying `title`.
- **Extract shared lockdown helper** (`openStaticWindow(html)` in index.ts):
  the `removeMenu()` + `will-navigate` + `setWindowOpenHandler` block is
  security-sensitive; copy-pasting ~30 lines would let the two windows drift.
  `onOpenHelp` is refactored to use it (behavior identical; covered by
  help-menu.spec.ts (a)-(e)). Alternative: leave Help untouched and duplicate
  -- rejected for drift risk; this is the fallback if `onOpenHelp` must not be
  touched.

### Concrete Plan

**Pure modules**
1. `src/main/changelog.ts` -- `extractChangelogSection(text, version): string | null`.
   Split on `/\r?\n/`; heading = `/^##\s+\[([^\]]+)\]/`; compare captured token
   with `===`; slice to the next `## [` heading or EOF; trim blank
   leading/trailing lines. Guardrails #132-134.
2. `src/main/appState.ts` -- zod `.strict()` schema, `AppState`,
   `parseAppState(raw)`, `decideWhatsNew(last: string | null, current: string)`
   -> `'first-launch' | 'up-to-date' | 'announce'`. #135, #137/#138/#144 (decision).
3. `src/main/paths.ts` -- add `changelogPathFor(mainDir)` =
   `path.join(mainDir, '..', 'CHANGELOG.md')`, so `index.ts` (`__dirname`) and
   the dist test share one formula (resolves to `dist/CHANGELOG.md`).

**Use case**
4. `src/main/whatsNew.ts` -- `prepareWhatsNew(ports, currentVersion): Promise<{ version, body } | null>`
   (first-launch -> `saveState(current)` in try/catch, return null; up-to-date
   -> null, no write; announce -> `readChangelog` + extract in try/catch,
   blank/missing -> warn + null, **no state write**) and
   `recordVersionSeen(ports, version)` (catches + warns). #137-140, #144.

**I/O adapter**
5. `src/main/appStateStore.ts` -- `loadAppState(filePath): Promise<AppState | null>`
   (missing/unreadable/invalid -> null; never throws, never writes) and
   `writeAppStateFile(filePath, state)`: `mkdir -p`, `writeFile` to a unique
   temp name in the same directory, `rename` over the target, best-effort `rm`
   of the temp on failure then rethrow. #141.

**Window layer**
6. `src/main/helpWindow.ts` -- optional `title` param (default preserves
   today's output); HTML-escape the title inside the builder.
7. `src/main/whatsNewWindow.ts` -- `shouldCreateWhatsNewWindow(existing)` (same
   contract as the Help one; a deliberate separate one-liner -- two windows may
   diverge, and only two exist) and `buildWhatsNewMarkdown(version, body)` =
   heading `What's New in md-view <version>` + blank line + body. HTML via
   `buildHelpHtml(..., title)`.
8. `src/main/index.ts` -- extract `openStaticWindow(html)`; `onOpenHelp` uses it;
   new `showWhatsNewIfDue()` fire-and-forget (`.catch` -> warn) as the *last*
   step of `app.whenReady()` (after `createWindow()` and the `did-finish-load`
   registrations, preserving the synchronous-registration invariant and keeping
   the main window as `firstWindow()`). On the What's New window's `closed`
   event: `recordVersionSeen`. Binds `app.getVersion()`, `userData/state.json`,
   `changelogPathFor(__dirname)`.

**Packaging**
9. `package.json` build script: append
   `require('fs').copyFileSync('CHANGELOG.md','dist/CHANGELOG.md')` to the
   existing `node -e` chain (explicit copy, no glob). #143.

**Docs**
10. `ADR-009_md-view.md` (Lead-authored after approval, before the scope
    manifest; ADR-008 structure): separate `state.json` chosen; "extend
    settings.json" rejected (user-facing/hand-editable; strict schema; whole-file
    rewrite on every toggle couples bookkeeping to preferences; a user resetting
    their settings would replay old notes); also rejected `electron-store` (new
    dependency for one string). Documents the atomic write.
11. `CHANGELOG.md`: add `## [Unreleased]` with an "Added" bullet (Task 42
    guardrail #126 deferred the Unreleased section "until Task 43 lands its own
    entry").

### Test Plan mapping (TDD Red-Green-Refactor, 3-cycle stop)

Unit (`tests/unit/`)
- `changelog.test.ts` (#132-134): middle/first/last(EOF) section; missing ->
  null; `1.1` vs `1.1.0`, `1.1.0` vs `1.1.01`/`11.1.0`/`1x1y0`; CRLF; `###`
  doesn't end a section; `## [Unreleased]` ends the previous; heading without
  date; empty text / no headings / preamble only; empty body -> `''`;
  duplicate heading -> first wins; never throws.
- `appState.test.ts` (#135 + decision): valid; invalid JSON; array/null/string
  JSON; missing key; extra key; number / empty-string value;
  `decideWhatsNew` first-launch / up-to-date / announce / downgrade (announce).
- `whatsNew.test.ts` (#137-140, #144; in-memory fakes): first launch saves
  current + null; corrupt state (loadState -> null) same; first-launch save
  throws -> resolves null; up-to-date -> null and `saveState` not called;
  announce returns only the current version's body while older skipped
  sections exist; `readChangelog` rejects -> null, no save; version not found
  -> null, no save; blank section -> null, no save; `recordVersionSeen` saves;
  its save rejecting doesn't throw.
- `whatsNewWindow.test.ts`: `shouldCreateWhatsNewWindow` null/destroyed/live;
  `buildWhatsNewMarkdown`.
- `buildHelpHtml.test.ts` (append): default title still `md-view Help`; custom
  title used; title with `<` `&` `"` escaped. Existing 3 tests untouched.
- `changelogPath.test.ts`: `changelogPathFor('/x/dist/main')` -> `/x/dist/CHANGELOG.md`.

Integration (`tests/integration/`)
- `appStateStore.test.ts` (temp dirs): load missing/corrupt/wrong-shape -> null
  and no write; valid -> state; write creates parent dir + round-trips;
  overwrite replaces; no `.tmp` leftovers after success; write onto a directory
  target rejects and leaves no `.tmp` orphan; an existing valid `state.json` is
  unchanged after a failed write. (A concurrent reader/writer stress test is
  welcome only if stable under `--repeat-each`; no flaky test to police a flake.)
- `dist-changelog.test.ts` (**built-output proof, #143**): needs `dist/` built
  (CI already runs `npm run build` first; fail with an explicit "run npm run
  build" message otherwise). Reads `changelogPathFor(<repo>/dist/main)` -- the
  same function `index.ts` uses -- and calls the *compiled*
  `dist/main/changelog.js` extractor with `package.json`'s version, asserting a
  non-null, non-blank body; also asserts `dist/CHANGELOG.md` equals `CHANGELOG.md`.

E2E (`tests/e2e/whats-new.spec.ts`; manual gate per ADR-007; runs against `dist/`)
- `fixtures.ts` gains an `initialUserDataFiles` option fixture written into
  `userDataDir` before launch.
- Fresh userData -> exactly 1 window; `state.json` == current version.
- Seeded `lastSeenVersion` == current -> exactly 1 window; `state.json` unchanged.
- Seeded `0.0.1` -> a 2nd window with a title containing the current version and
  the current section's content; older-version content absent; **`state.json`
  still `0.0.1` while the window is open and the current version after it is
  closed** (#139); no menu (same probe as help-menu.spec (e)); no
  `window.mdview` bridge.
- Sanity: `app.getVersion()` (via `electronApp.evaluate`) equals `package.json`'s
  version when launched as `electron dist/main/index.js`. **Verify, don't
  assume**: if Electron reports its own runtime version for an explicit entry
  script the feature would silently never match in e2e -- report back.
- Existing e2e suites are unaffected: a fresh userData dir hits the silent
  first-launch path (no extra window).

### In-scope files

- `src/main/changelog.ts` (new), `appState.ts` (new), `appStateStore.ts` (new),
  `whatsNew.ts` (new), `whatsNewWindow.ts` (new)
- `src/main/helpWindow.ts`, `src/main/paths.ts`, `src/main/index.ts`
- `package.json` (build script only)
- `CHANGELOG.md` (`[Unreleased]` entry only)
- `tests/unit/changelog.test.ts`, `appState.test.ts`, `whatsNew.test.ts`,
  `whatsNewWindow.test.ts`, `changelogPath.test.ts`, `buildHelpHtml.test.ts`
- `tests/integration/appStateStore.test.ts`, `dist-changelog.test.ts`
- `tests/e2e/whats-new.spec.ts`, `tests/e2e/support/fixtures.ts`
- `.agents/specs/decisions/ADR-009_md-view.md` (Lead-authored, before the manifest)

Explicitly NOT touched: `settingsStore.ts`, `settings.ts`, `menu.ts`,
`electron-builder.yml`, `.github/**`, `README.md`, `help.md`.

### Expected output format

New files: full content. Existing files: diff (targeted edits).

### Spec section this closes

`functional_domain.md` Task 43 section, guardrails #132-144.

### Governance note

`CHANGELOG.md` is shipped prose rendered to end users, so the standing
reviewer rule from the Task 42 governance finding applies: the reviewer reads
the full CHANGELOG diff and resulting file and scans for leaked internal
process text.

---

## Task 44: Close document (Step 1)

### Code facts this plan rests on (verified by reading, not assumed)

- `index.ts` today has three `FILE_RENDERED` send paths, all through
  `sendToRenderer`: `renderAndWatch` (argv / dialog / drop / tree click) and
  the watcher callback in `startWatching`. None is guarded.
- `renderAndWatch` calls `startWatching` only when `message.ok`, and it never
  calls `stopWatching` on an error result. So #148's reading is correct: a
  failed open leaves the previous file's watcher running.
- chokidar 4 `FSWatcher.close()` calls `removeAllListeners()` synchronously
  (`node_modules/chokidar/index.js` `close()`). A closed watcher therefore
  cannot *start* a new render. Only a render already in flight (awaiting
  `renderFile`) can arrive late, and that is exactly what the epoch covers.
  No extra "stale watcher" guard is needed.
- The renderer's null-input behavior is already pinned by unit tests:
  `statusBarText(null)` -> "No file open", `canCopyRawSource(null)` -> false,
  `shouldShowFrontmatter(null, …)` -> false. Close reuses these (see below).
- Two existing tests enumerate File-menu positions and must change:
  `tests/unit/menu.test.ts` (length 6, indexes 3/4/5) and
  `tests/e2e/window-chrome.spec.ts` (two File popup id lists, lines ~231 and
  ~522).
- Accelerators are driven in e2e with `webContents.sendInputEvent`
  (window-chrome.spec.ts (e)), not `page.keyboard`. The title-bar popup is
  inspected by capturing `Menu.buildFromTemplate` (window-chrome.spec.ts (d)).

### The Inward Dependency Rule

```
[ Domain: pure, zero imports ]       documentSlot.ts   (epoch + occupancy)
                ^
[ Use case: Electron-free, ports ]   documentSession.ts (open / close / shutdown;
                                      the single guarded FILE_RENDERED choke point)
                ^
[ Adapters ]                         watcher.ts (chokidar, unchanged)
                                     menu.ts (pure template, gains `documentOpen` input)
                ^
[ Composition root / Electron ]      index.ts (binds ports: renderFile, webContents.send,
                                      watchFile, establishTreeRoot, applyMenu)
[ Bridge ]                           preload/api.ts + preload/index.ts (+1 channel, +1 method)
[ Renderer ]                         renderer.js (onDocumentClosed -> pristine)
```

`documentSession.ts` imports only `documentSlot.ts` and *types* from
`preload/api.ts` (same allowance `menu.ts` already has). No `electron`, no
`fs`, no `path`.

### SOLID Boundary Scan

- **SRP:** the slot answers "may this result be delivered, and did occupancy
  change?"; the session coordinates render / deliver / watch / tree-root / close;
  `index.ts` only binds concrete I/O; `menu.ts` only describes the menu.
- **OCP:** `MenuHandlers` gains `onClose`. `buildMenuTemplate` gains a
  **required** third parameter `documentOpen: boolean`. It is required, not
  optional, on purpose: `tsc` then refuses any production call site that
  forgets it, so #151's "both production call sites pass it" is enforced by
  the compiler rather than by review.
- **DIP:** the session receives a `DocumentSessionPorts` object instead of
  importing Electron, chokidar or `fs`. That is what makes #147-#150
  unit-testable with fake ports and controllable promises.
- **ISP:** narrow, single-purpose ports (below), not a "window" or "app"
  interface. Renderer bridge: one method, `onDocumentClosed(cb)`.
- **LSP:** n/a (no inheritance introduced).

### Pattern Application

- **Command** (existing, extended): `MenuHandlers.onClose` is one receiver
  (`session.close`) behind three invokers: the native menu item, the title-bar
  popup (same `buildMenuTemplate`, #67) and the `CmdOrCtrl+W` accelerator.
- **Protection Proxy:** the session's private `deliver(token, message)` stands
  in front of the `sendFileRendered` port and forwards only when
  `slot.tryDeliver(token).deliver`. It is the only caller of that port, which is
  what makes #149 structural rather than a per-call-site convention.
- **Facade:** `open(filePath)` / `close()` / `shutdown()` hide the slot, the
  watcher handle and tree-root coordination from `index.ts`.
- **Ports & Adapters** (same shape as Task 43's `whatsNew.ts`).
- **Considered and rejected: GoF State.** The slot has two states and four
  operations. State classes would add ceremony without removing any
  conditionals. A boolean plus a counter is the honest shape.

### Concrete Plan

**Pure domain**
1. `src/main/documentSlot.ts` (new): `createDocumentSlot()` returns a small
   stateful object with `beginRender(): number`,
   `tryDeliver(token): { deliver: boolean; occupancyChanged: boolean }`,
   `close(): { acted: boolean }` and `isOccupied(): boolean`, with exactly the
   Step 0 semantics. No imports.

**Use case**
2. `src/main/documentSession.ts` (new): `createDocumentSession(ports)` returns
   `{ open, close, shutdown, isOpen }`.
   ```ts
   interface WatchHandle { close(): void }
   interface DocumentSessionPorts {
     renderFile(filePath: string): Promise<FileRenderedMessage>;
     sendFileRendered(message: FileRenderedMessage): void;
     sendDocumentClosed(): void;
     watch(filePath: string, onChange: () => void): WatchHandle;
     establishTreeRootFor(filePath: string): Promise<void>; // index.ts does path.dirname
     onOccupancyChanged(): void;                             // index.ts: applyMenu()
   }
   ```
   - `open(filePath)`: `token = slot.beginRender()`, `await renderFile`, then
     `deliver(token, message)`. If it was **not** delivered: return, with no
     watcher and no tree root (#149, "discarded entirely"). If delivered and
     `ok`: stop the old watch and start a new one. If delivered and not `ok`:
     leave the old watch alone (the pre-existing behavior is kept on purpose;
     fixing it is out of scope). Then `await establishTreeRootFor(filePath)`.
   - Watch callback: `token = slot.beginRender()`,
     `renderFile(path).then(m => deliver(token, m))`. It goes through the same
     choke point, so re-renders never rebuild the menu (`occupancyChanged` is
     false while occupied, #151).
   - `deliver(token, message)` (private, the only caller of `sendFileRendered`):
     `tryDeliver`; on deliver, send, and call `onOccupancyChanged()` iff
     `occupancyChanged`.
   - `close()`: `if (!slot.close().acted) return;` (#150). Then stop the watch
     (#147/#148; zero watchers), `sendDocumentClosed()` and `onOccupancyChanged()`.
     All synchronous: no interleaving window inside Close.
   - `shutdown()`: stop the watch only. No notification and no menu rebuild.
     It replaces today's `app.on('before-quit', stopWatching)`.

**Composition root**
3. `src/main/index.ts`: remove `activeWatcher`, `stopWatching`,
   `startWatching`, `renderAndWatch` and `sendToRenderer`. `renderFile`,
   `establishTreeRoot`, `listDirectoryEntries` and everything else stay. Build
   one module-level `documentSession` with ports bound to `renderFile`,
   `mainWindow?.webContents.send(IPC_CHANNELS.FILE_RENDERED | DOCUMENT_CLOSED, …)`,
   `watchFile` (the chokidar handle satisfies `WatchHandle`),
   `(f) => establishTreeRoot(path.dirname(f))` and `applyMenu`. The argv
   `did-finish-load` listener, `openFileViaDialog` and `REQUEST_OPEN_FILE` all
   call `documentSession.open(...)`; the synchronous-registration invariant is
   unchanged. `menuHandlers()` gains `onClose: () => documentSession.close()`.
   `applyMenu()` and the `POPUP_MENU` handler both pass
   `documentSession.isOpen()` as the third argument. `before-quit` ->
   `documentSession.shutdown()`. Afterwards `IPC_CHANNELS.FILE_RENDERED`
   appears in `src/main` **exactly once**, inside the port binding. The
   reviewer checks this with grep.

**Menu**
4. `src/main/menu.ts`: `onClose` handler; `buildMenuTemplate(handlers,
   initialViewSettings, documentOpen)`; the new item
   `{ id: 'menu-close', label: 'Close', accelerator: 'CmdOrCtrl+W',
   enabled: documentOpen, click: handlers.onClose }` placed directly after
   `menu-open-folder` (#151).

**Bridge** (#154)
5. `src/preload/api.ts`: `DOCUMENT_CLOSED: 'md-view:document-closed'`;
   `BridgeApi.onDocumentClosed(callback: () => void): void`.
   `FileRenderedMessage` unchanged.
6. `src/preload/index.ts`: `ipcRenderer.on(DOCUMENT_CLOSED, () => callback())`.
   The event object is **not** forwarded (zero payload, narrow bridge).

**Renderer** (#145, #146, #153)
7. `src/renderer/renderer.js`:
   - Replace `hideEmptyState` with `setEmptyStateVisible(visible)`. Rewrite the
     "one-way transition" comment: hidden on the first `FILE_RENDERED` of
     either variant, and shown again **only** by Close (Task 44 #145 lifts Task
     7 guardrail 5's "never shown again" for the Close path only, a disclosed
     supersession).
   - `onDocumentClosed` handler: re-run the **same** pure functions with the
     pristine input `null`, rather than hand-writing pristine values:
     `lastMessage = null`; `setEmptyStateVisible(true)`; `updateStatusBar(null)`;
     `copyRawSourceEl.disabled = !canCopyRawSource(null)` plus remove the
     `copied` class; `updateFrontmatterVisibility()`;
     `container.textContent = ''`; `codeContentEl.textContent = ''`; restore
     `<base id="content-base">` to its pristine `href=""`;
     `activeFilePath = null; revealAndHighlight()`. That call clears the
     highlight and bumps `revealToken`, so an in-flight reveal walk aborts
     without new code. The handler never touches the tree DOM, the tab, dark
     mode or `#document-container`.
   - No renderer-side epoch. `main` never sends a stale `FILE_RENDERED`, and
     `webContents.send` messages to one renderer arrive in send order, so any
     `FILE_RENDERED` sent before Close arrives before `DOCUMENT_CLOSED`. The
     e2e round-trip tests exercise this ordering.

**Docs**
8. No ADR. The choice is local (one use case plus one pure module, following
   the ADR-009 / Task 43 ports precedent) and fully recorded here. Help /
   README / CHANGELOG are deferred to release time (Step 0 out-of-scope list).

### Test Plan mapping (TDD Red-Green-Refactor, 3-cycle stop)

Unit (`tests/unit/`)
- `documentSlot.test.ts` (new): starts empty; deliver on a current token ->
  `{deliver:true, occupancyChanged:true}`, then `false` on the next delivery;
  a token taken before an acting close -> `{deliver:false}` and the slot stays
  empty; a token taken after close delivers; close while empty ->
  `{acted:false}` and the epoch is unchanged (a pre-close token still
  delivers, #150); close while occupied -> `{acted:true}`; repeated close is
  inert.
- `documentSession.test.ts` (new; fake ports, deferred promises for
  `renderFile`):
  - #147/#148: open ok -> 1 active watch; close -> watch closed, 0 active.
    Open ok A, then open B that fails -> A's watch still active (pre-existing,
    pinned so the test documents it); close -> 0 active.
  - #149: open in flight, close (slot occupied by an earlier file), then
    resolve -> no `sendFileRendered`, no `watch`, no `establishTreeRootFor`,
    `isOpen()` false. Watch-triggered render in flight, close, then resolve ->
    no send. Open that starts after close -> delivered normally.
  - #150: close while empty -> no `sendDocumentClosed`, no
    `onOccupancyChanged`; a first open in flight across an inert close still
    delivers.
  - #151: `onOccupancyChanged` fires once on the first delivery, 0 times on a
    watch re-render or on a second open, and once on an acting close. Error
    delivery also occupies (#145).
  - `shutdown()` closes the watch with no notification and no occupancy call.
- `menu.test.ts` (update): File has 7 entries in the #151 order; `menu-close`
  has its label, accelerator and `click === onClose`; `enabled` is `false`
  for `documentOpen=false` and `true` for `true`; existing index-based
  assertions shift.

Integration (`tests/integration/`)
- `preload-api-contract.test.ts`: `DOCUMENT_CLOSED` is a non-empty string,
  distinct from every other `IPC_CHANNELS` value (checked against
  `Object.values`, not a hand list); the `BridgeApi` sample literals gain
  `onDocumentClosed`.

E2E (`tests/e2e/`; manual pre-merge gate per ADR-007)
- `support/pristine.ts` (new): `expectPristineDocumentView(window)`, the
  assertions currently inline in `ui-shell.spec.ts`'s no-argv test
  (`#empty-state` visible, status bar "No file open", `#copy-raw-source`
  disabled), extended with `#content` / `#code-content` empty, `#frontmatter`
  hidden, zero `.tree-row-active` and `#document-container` visible.
  `ui-shell.spec.ts`'s no-argv test is refactored to call it, so launch and
  close are proven against one definition (#146).
- `close-document.spec.ts` (new):
  (a) `menu-close` is disabled at launch, enabled after open, disabled after
  Close (native menu, `getMenuItemById(...).enabled`).
  (b) Round-trip: open a frontmatter fixture from a temp tree (tree root plus
  highlight present), Close -> `expectPristineDocumentView`; the tree still
  has its rows and expanded folders (#153); dark mode and the Code tab are
  unchanged across Close (#152).
  (c) `CmdOrCtrl+W` via `sendInputEvent` closes an open document. With nothing
  open, it produces zero `DOCUMENT_CLOSED` sends and zero
  `Menu.setApplicationMenu` calls (both counted by main-side monkey-patching,
  #150).
  (d) Title-bar File popup: ids include `menu-close` at index 2, and its
  `enabled` mirrors occupancy (capture technique from window-chrome (d)).
  (e) No resurrection (#148): open temp A, Close, edit A, wait 1500ms ->
  still pristine **and** zero `FILE_RENDERED` sends counted in main.
  (f) Error-state Close: open ok A, then open a missing `.md` -> error shown,
  `#empty-state` hidden (#145); Close -> pristine; edit A -> zero
  `FILE_RENDERED`.
  (g) A watcher re-render of the open file causes zero `setApplicationMenu`
  calls (#151).
  (h) Open Folder leaves `menu-close` disabled (#153). Close writes neither
  `settings.json` nor `state.json` (content and mtime unchanged, #152).
- `window-chrome.spec.ts`: both File popup id lists gain `'menu-close'` after
  `'menu-open-folder'`. No other change.
- Race (#149) is proven at unit level (deterministic). An e2e race test is
  **not** required. If the engineer adds one, it must be stable under
  `--repeat-each=10`, or it is dropped: no flaky test to police a race.
- Security suites (#155): not modified. The reviewer confirms that the
  external-links / html-comments / window-config tests are byte-unchanged.

### In-scope files

- `src/main/documentSlot.ts` (new), `src/main/documentSession.ts` (new)
- `src/main/index.ts`, `src/main/menu.ts`
- `src/preload/api.ts`, `src/preload/index.ts`
- `src/renderer/renderer.js`
- `tests/unit/documentSlot.test.ts` (new), `tests/unit/documentSession.test.ts` (new),
  `tests/unit/menu.test.ts`
- `tests/integration/preload-api-contract.test.ts`
- `tests/e2e/close-document.spec.ts` (new), `tests/e2e/support/pristine.ts` (new),
  `tests/e2e/ui-shell.spec.ts`, `tests/e2e/window-chrome.spec.ts`

Explicitly NOT touched: `watcher.ts`, `index.html`, `app.css`, `settings*.ts`,
`appState*.ts`, `whatsNew*.ts`, `help.md`, `CHANGELOG.md`, `README.md`,
`electron-builder.yml`, `package.json`, `.github/**`, and every existing
security-regression test.

### Expected output format

New files: full content. Existing files: diff (targeted edits).

### Spec section this closes

`functional_domain.md` Task 44 section, guardrails #145-155.

### Known pre-existing behaviors deliberately left alone (not regressions)

- A failed open keeps the previous watcher (#148; pinned by a unit test, not
  fixed).
- Out-of-order opens and a stale watcher render from a *switched-away* file
  are not epoch-guarded. Only Close advances the epoch (Step 0 out of scope).

---

### Task 44: User approval conditions (binding on implementation and review)

The blueprint above was approved subject to these conditions. Where a
condition and the blueprint disagree, the condition wins.

1. **Behavior-preservation proof.** `live-reload.spec.ts`,
   `open-file-argv.spec.ts`, `drag-drop.spec.ts` and `tree-panel.spec.ts` stay
   **out of scope** and must pass **unmodified**. Passing them is the proof
   that the `documentSession` extraction preserves behavior.
2. **Preserve, don't fix.** A failed open still leaves the previous watcher
   running (pre-existing, Step 0 out of scope). The refactor hides no behavior
   change. The error-state Close test (e2e (f)) and the session unit test cover
   it.
3. **#149 wiring proof.** After the change, `IPC_CHANNELS.FILE_RENDERED` is
   referenced in `src/main/` only at the single port binding; the reviewer
   greps for it and cites the raw result. An invalidated open skips the watch
   start **and** the tree-root establishment, with **one unit test for each**.
4. **Folder paths stay in `index.ts`.** The directory branch of
   `REQUEST_OPEN_FILE`, Open Folder and "Up one level" remain in `index.ts` and
   never touch the slot or the session (#153).
5. **Pristine helper fidelity.** `expectPristineDocumentView` keeps every
   assertion the current pristine-launch test makes. The legacy `h1` /
   `#open-file-btn` checks may stay local to `ui-shell.spec.ts`. One fault
   injection is required: temporarily hide `#empty-state` at launch, and the
   helper-based launch test must go RED. Revert it afterwards, and report the
   raw RED output.
6. **Ordering assumption stated in code.** The renderer relies on
   `DOCUMENT_CLOSED` and `FILE_RENDERED` (two channels, same `webContents`)
   arriving in send order. A code comment states this assumption, and the
   reviewer confirms nothing else depends on it.
7. The `in_scope` list is shown to the user before `current_scope.json` is
   written.
8. **Stop-before-`/log-run` gate.** The Lead stops and reports to the user
   before running `/log-run`.

---

## Task 45: Mermaid diagram support + main-window CSP (Step 1)

Closes `functional_domain.md` Task 45, guardrails #156-#168. Branch:
`feature/045-mermaid-support` (off `main` @ `8e80fa0`).

### Evidence this plan rests on (measured, not assumed)

Probes ran against a scratch copy of the built app (`npm run build` output +
`mermaid@11.17.2` installed outside the repo). The repo was not modified
apart from these spec files.

**Static reading of `mermaid@11.17.2/dist/mermaid.min.js` (3 572 661 bytes):**
- Exactly 4 `Function("return this")` sites, all lodash/core-js global
  lookups written as `…||self&&self.Object===Object&&self||Function(…)()`, so
  `self` short-circuits them in a window. There is no `eval(`, no
  `new Function`, no `Worker`, no `importScripts` and no `blob:`. The bundle
  contains no CDN, font or icon-pack URL: every `https://` literal is
  documentation or licence text.
- Default `secure` list: `["secure","securityLevel","startOnLoad",
  "maxTextSize","suppressErrorRendering","maxEdges"]`. **`theme` is not in it.**
- The IIFE assigns `globalThis.mermaid` (and `globalThis.__esbuild_esm_mermaid_nm`).
- `maxTextSize` defaults to `5e4`. Over that limit Mermaid does **not throw**:
  it swaps the source for `graph TB;a[Maximum text size in diagram
  exceeded];style a fill:#faa` and renders that diagram successfully.
  `suppressErrorRendering` does not affect this.

**Runtime probes (Electron 44, real main window, `file://`):**

| Probe | Result |
|---|---|
| Mermaid render under `script-src 'self'` (no `'unsafe-eval'`) | 3/3 valid diagrams render, and there are **zero** `script-src` violations. This settles the #160 lodash question at runtime. |
| `style-src 'self'` without `'unsafe-inline'` | 190+ `style-src-elem`/`style-src-attr` violations. Node fill falls back to `rgb(0,0,0)` and the stroke to `none`, so the diagram is visibly broken. The exception is required for **both** `<style>` elements and `style=` attributes. |
| Inline `<script>` appended to the DOM | Blocked (`script-src-elem`), and the canary stays `undefined`. |
| `<img onerror=…>` inserted via `insertAdjacentHTML` | Blocked (`script-src-attr`), and the canary stays `undefined`. |
| `fetch('https://example.com/')`, `fetch(file:…)` | Both blocked (`connect-src`). |
| Dynamic `<base href>` retarget to the document's folder, and a relative local image there | Works under `base-uri 'self' file:` / `img-src 'self' file:`. |
| Full `tests/test-content/test-fixture.md` with the final policy | **Zero** `securitypolicyviolation` events, including the remote `https:` image. |
| `%%{init: {"securityLevel":"loose","themeCSS":…,"fontFamily":…}}%%` plus `click` callback/`javascript:` href | No `on*` attribute, no `javascript:`, no attacker CSS or font in the output, and no handler fires. |
| `%%{init: {"theme":"forest"}}%%` or frontmatter `config: theme: forest`, with the Step 0 `secure` list | **Theme overridden** (node fill `#cde498` instead of dark `#1f2020`). Adding `theme` to `secure` restores the app theme. See Decision D2. |
| `<script src=file:///…/other-folder/evil.js>` | **Loaded and executed.** Chromium matches `'self'` against *every* `file:` URL when the page itself is `file:`. See the disclosure under the CSP. |

**Startup cost** (medians, n=9 launches per variant for navigation timing,
n=7 for wall-clock; variants alternated; wall-clock is measured from
`electron.launch` to the given DOM state):

| Variant | DOMContentLoaded | Doc w/o diagrams: content visible | Doc with diagrams: content / first SVG |
|---|---|---|---|
| Today (no Mermaid) | 197 ms | 976 ms | n/a |
| Eager `<script src=mermaid.min.js>` | 693 ms (**+496**) | 1441 ms (**+465**) | 1568 / 1688 ms |
| On demand (inject on first placeholder) | unchanged | 965 ms (**±0**) | 1052 / 1799 ms |

`main` sends the first `FILE_RENDERED` only on `did-finish-load`
(`index.ts:497/506`). An eager bundle therefore delays **every** document's
first paint by about 0.5 s, including documents with no diagrams. This is
the "measured regression" Step 0 asks for before lazy loading. See
Decision D1.

### Decisions D1-D4 (all resolved at Step 1 review; see the approval conditions at the end)

- **D1. Load the bundle on demand (recommended).** Step 0 lists lazy
  loading as out of scope "not built without asking", and makes it
  conditional on a measured regression. The regression is measured above
  (+~0.5 s on every launch). Recommendation: inject `mermaid.min.js` on the
  first diagram pass that finds at least one placeholder, memoized once per
  window. The cost moves to the first diagram document only (+~110 ms to
  first SVG relative to eager), and plain documents pay nothing.
  Alternative: accept eager loading and the +0.5 s. The rest of this plan
  assumes D1 = on demand; the eager variant changes only the engine adapter
  and one `<script>` tag.
  **Resolved: on demand, approved.**
- **D2. Add `theme` and `darkMode` to the locked `secure` keys.** This is a
  strict superset of #158's list. Without it, a directive or frontmatter
  `config:` overrides the app theme, which contradicts #164 ("diagrams use
  `dark` … `default`") and #158's own stated limitation ("per-diagram theme
  customization is not supported"). `theme` is proven by probe. `darkMode`
  is added by reading and will be proven by the same e2e.
  **Resolved: approved and folded into #158.** Both keys are tested via
  `%%{init}%%` and frontmatter `config:`.
- **D3. `'self'` is scheme-wide under `file:` (disclosure, not a change).**
  `script-src 'self'` stops inline and attribute script, `eval`, and every
  non-`file:` origin. It does **not** stop a `<script src>` pointing at
  another local file. Exploiting that needs a script element that is
  actually *inserted and executed*. Markup reaching the DOM through
  `innerHTML` never executes `<script>` elements, and every path into
  `#content` is `innerHTML` (markdown-it with `html: false`, and
  DOMPurify-sanitized SVG). The only `createElement('script')` in the app
  is the D1 loader, and its URL is a constant resolved against
  `initialBaseURI` (see below). Residual risk accepted. Hardening via
  SRI-hash `script-src` or a custom `app://` protocol is rejected for this
  task (ADR-010) and becomes a backlog candidate.
- **D4. Oversized-diagram pre-check.** #162 can only hold if the app checks
  `source.length > 50000` itself, because Mermaid renders a pink substitute
  diagram instead of failing. This is a design consequence, not a scope
  change. Stated here so it isn't read as scope creep.

### The main-window CSP (exact string)

Delivered as the **first element after `<meta charset>`** in
`src/renderer/index.html`, before `<base>`, every `<link>` and every
`<script>`, so it governs all of them:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file: data: http: https:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self' file:" />
```

Justification per directive against #160:

| Directive | Justification |
|---|---|
| `default-src 'none'` | Deny by default. `font-src`, `media-src`, `worker-src` and `manifest-src` fall back to `'none'`. The app loads no fonts (no `@font-face` in any shipped CSS), which also enforces #161's "no fonts". |
| `script-src 'self'` | #160: app files only, with no `'unsafe-inline'` and no `'unsafe-eval'`. Proven sufficient for Mermaid 11.17.2 at runtime. Scheme-wide under `file:` (D3). |
| `style-src 'self' 'unsafe-inline'` | The #160 disclosed exception. Proven necessary: Mermaid emits a `<style>` per SVG **and** `style=` attributes. It also keeps Playwright `addStyleTag` in `tree-panel.spec.ts:713` working. |
| `img-src 'self' file: data: http: https:` | #160 as amended: **preserves today's behavior**, which is the guardrail (`https:` in the original #160 text was only an example). Local images through the dynamic `<base href>` (`file:` is explicit, so it doesn't rest on the `'self'` quirk), `data:` URIs, and remote `http:` and `https:` images (fixture line 359 is `https:`). Disclosed trade-off: remote images remain an outbound channel for CSS-only tricks. |
| `connect-src 'none'` | #160. Closes the `fetch()` exfiltration channel that motivates this CSP. The renderer uses IPC, never `fetch`/XHR (grep-verified). |
| `object-src 'none'` | #160: no plugins or `<embed>`. |
| `frame-src 'none'` | #160: no iframes (also rules out Mermaid `sandbox` mode, which was rejected anyway). |
| `form-action 'none'` | #160: no form submission. `form-action` does not fall back to `default-src`, so it is set explicitly. |
| `base-uri 'self' file:` | Permits exactly the Task 4 retarget (`renderer.js` sets `<base href>` to the document's `file:` folder), and forbids an `https:`/`data:` base. `base-uri` does not fall back to `default-src`, so without it any base would be allowed. |

Omitted on purpose: `frame-ancestors`, `report-uri`/`report-to` and
`sandbox`, which are ignored in `<meta>` policies. `upgrade-insecure-requests`
is also omitted: it would rewrite `http:` images, not block them.

**Interaction with the dynamic `<base href>` (Task 4 / ADR-004):**
1. The policy is attached to the *document* and parsed once. Retargeting
   `<base>` changes URL resolution, not the policy or `'self'`.
   `base-uri` is re-checked on every `href` assignment, and `file:`
   satisfies it.
2. All static `<script>`/`<link>` URLs are resolved at parse time, before
   any retarget, so they are unaffected (the ADR-004 precedent already
   handles the deferred `disabled` stylesheets).
3. **The D1 loader must resolve `./mermaid.min.js` against
   `initialBaseURI`, never `document.baseURI`.** After a retarget, a
   relative `src` would resolve into the *user's document folder*, and
   because `'self'` is scheme-wide (D3), a file named `mermaid.min.js`
   sitting next to a Markdown file **would be executed**. This is the one
   place where the base/CSP interaction is security-relevant. The invariant
   is that the URL is **resolved to an absolute URL before any `<base>`
   retarget** (amended at Task 45 review: S2). It is pinned by a decoy e2e
   test (see the test plan) and a fault injection (F5).

### How `mermaid.min.js` reaches `dist/` and is loaded (#161, #167)

- `package.json` `dependencies`: `"mermaid": "11.17.2"`, exact with no caret.
  `package-lock.json` is regenerated by `npm install`. This is the only
  new runtime dependency (#167).
- `package.json` `build`: the existing `node -e` copy chain gains two
  `copyFileSync` calls:
  `node_modules/mermaid/dist/mermaid.min.js -> dist/renderer/mermaid.min.js`
  and `src/renderer/diagrams.js -> dist/renderer/diagrams.js`.
  `electron-builder.yml` already ships `dist/**/*`, so it is not changed.
- Loading (D1 = on demand): `index.html` does **not** reference
  `mermaid.min.js`. The engine adapter creates one `<script>` with
  `src = new URL('./mermaid.min.js', initialBaseURI).href`, where
  `initialBaseURI` is the **existing** constant in `renderer.js`, captured
  before any `<base href>` retarget and already used for the theme `<link>`
  fix (ADR-004). It is passed into the adapter as `scriptUrl`; no second
  capture is introduced. The adapter appends the `<script>` to
  `<head>`, and memoizes the resulting promise, which resolves to
  `globalThis.mermaid`. A load error rejects the promise, and every
  placeholder of that pass (and later passes) shows the failure notice (#162).
- The renderer's own new file, `diagrams.js`, is a static
  `<script src="./diagrams.js">` placed **before** `renderer.js`. Like
  `renderer.js`, it is a classic script whose pure functions are exported
  under a `typeof module` guard, so Vitest can `require()` it without
  jsdom or a bundler.

### Placeholder element and markdown-it fence rule (#156, #157)

`src/main/markdown.ts` wraps markdown-it's own `renderer.rules.fence`
(a **Decorator**: it delegates every non-mermaid fence to the captured
original rule, unchanged):

```ts
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (isMermaidFence(token.info)) return mermaidPlaceholder(token.content);
  return defaultFence(tokens, idx, options, env, self);
};
```

- `isMermaidFence(info)` (exported, pure) uses the same derivation
  markdown-it uses for the language name:
  `unescapeAll(info).trim().split(/\s+/)[0] === 'mermaid'`. This is
  case-sensitive, so `Mermaid`, `mermaid-js` and `mermaidx` are not
  mermaid fences. Indented code blocks are `code_block` tokens and never
  reach `fence`. Inline code is never a fence.
- Placeholder shape (one line, no whitespace inside `<code>`):

  ```html
  <div class="md-view-diagram" data-diagram="mermaid"><pre class="md-view-diagram-source"><code>ESCAPED_BODY</code></pre></div>
  ```

  `ESCAPED_BODY = md.utils.escapeHtml(token.content)` (escapes `& < > "`).
  The info string is **not** echoed (no `class="language-…"`), so no
  author-controlled text sits in an attribute. The Help and What's New
  windows, which have no script, show the `<pre>` as readable source (#166).
- The renderer reads the source back as `code.textContent`, so the DOM
  decodes the escaping exactly once and `html: false` holds end to end
  (#157).
- `highlightCode` and hljs are untouched. Every other fence is produced by
  the original rule with the same arguments, which is why #156's golden
  test holds byte for byte.

### Diagram pass: generation design (#163, #164, #165, #162)

New file `src/renderer/diagrams.js`. The dependency direction inside the
renderer is:

```
[ pure policy ]  mermaidConfig(theme), diagramThemeFor(isDark),
                 exceedsMaxTextSize(source), createGenerationGate()
       ^
[ use case ]     createDiagramController({ engine, view })
                 - depends on two PORTS only, no DOM and no mermaid global
       ^
[ adapters ]     createMermaidEngine({ scriptUrl, appendScript, getGlobal })  -> engine port
                 createDiagramDomView(containerEl, document)                 -> view port
       ^
[ composition ]  renderer.js wires them next to the existing handlers
```

**Ports (ISP: narrow and single-purpose):**
- `engine.ready() -> Promise<void>` (memoized bundle load)
- `engine.render(id, source, theme) -> Promise<svgString>`
- `view.collectSlots() -> Slot[]`, where
  `Slot = { source, showSvg(svg), showFailure(message) }`

**Locked configuration** (`mermaidConfig(theme)`, pure, returns a fresh
object). `MERMAID_MAX_TEXT_SIZE = 50000` is **one** exported constant in
`diagrams.js`, read by both `mermaidConfig` and `exceedsMaxTextSize`
(#162 as amended). A unit test asserts
`mermaidConfig(t).maxTextSize === MERMAID_MAX_TEXT_SIZE`, and the boundary
tests are written against the constant, not the literal:
```js
{ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
  maxTextSize: MERMAID_MAX_TEXT_SIZE, theme,
  secure: ['secure','securityLevel','startOnLoad','maxTextSize',
           'suppressErrorRendering','maxEdges',
           'themeCSS','themeVariables','fontFamily','altFontFamily',
           'theme','darkMode'] }          // last two: D2
```

**Generation gate:** `createGenerationGate()` returns
`{ advance() -> token, isCurrent(token) }`, a monotonic integer (same class
as `revealToken` and Task 44's epoch).

**Controller** (the only stateful piece, holding `slots`, `isDark` and the
gate):

| Event (from `renderer.js`) | Controller call | Effect |
|---|---|---|
| `FILE_RENDERED` ok, after `renderHtml` | `documentRendered()` | `advance()`, `slots = view.collectSlots()` (source captured **now**), and a pass starts if `slots.length > 0`. With zero slots, the engine is never touched, so no bundle load happens (D1). |
| `FILE_RENDERED` error | `documentCleared()` | `advance()`, `slots = []` |
| `DOCUMENT_CLOSED` | `documentCleared()` | `advance()`, `slots = []` |
| `VIEW_SETTINGS` | `darkModeChanged(settings.darkMode)` | No-op if the value equals the stored `isDark` (so the frontmatter toggle, tree toggle and tab switch never re-render, #164). Otherwise it stores the value, calls `advance()`, and starts a pass over the **stored** `slots` if any exist. The file is never re-read. |

**Pass** (`async`, sequential over slots):
```
token = gate.advance() (done by the caller above); theme = diagramThemeFor(isDark)
await engine.ready()   (memoized bundle load; rejection -> every slot showFailure, gated)
if !gate.isCurrent(token): return                         // after the load (#163 amended)
for (i, slot) of slots:
  if !gate.isCurrent(token): return                       // before each render
  if exceedsMaxTextSize(slot.source): slot.showFailure(TOO_LARGE_MSG); continue   // D4
  try   svg = await engine.render(`mdv-diagram-${token}-${i}`, slot.source, theme)
  catch e: if gate.isCurrent(token) slot.showFailure(messageOf(e)); continue
  if gate.isCurrent(token): slot.showSvg(svg)             // after each await
```
- **No stale writes (#163):** every write is gated by a check made *after*
  the last `await`, including the bundle-load `await` (engine port gains
  `ready() -> Promise<void>`, the memoized load). A Close or a newer
  `FILE_RENDERED` during the load advances the generation, so the old pass
  returns without writing when the load settles, whether it succeeded or
  failed. `documentCleared()`, a new document and a theme change
  all `advance()` synchronously inside their IPC handler, so an in-flight
  pass writes nothing afterwards. The check → `initialize` → `render`
  sequence inside `engine.render` is synchronous up to Mermaid's own queue,
  so a superseded pass can never re-`initialize` Mermaid with the old
  theme after a newer pass has started.
- **Unique IDs (#165):** `mdv-diagram-<token>-<index>` is unique across
  diagrams in a pass and across passes, including theme re-renders.
  Mermaid's temporary `#d<id>` scratch nodes are removed by Mermaid itself
  **only while `suppressErrorRendering: true`**. The Step 1 review probe
  showed that a failed render with it `false` leaves `DIV#d<id>` in
  `<body>`, and that maxEdges overflow throws ("Edge limit exceeded"), so
  it takes the ordinary failure path.
- **Failure isolation (#162):** each slot has its own `try`, and the pass
  never throws out of the controller (a final `catch` also covers the
  bundle-load rejection). `showFailure` builds
  `<p class="md-view-diagram-error">` (message via `textContent`) plus
  `<pre><code>` (source via `textContent`). `suppressErrorRendering: true`
  removes Mermaid's bomb graphic.
- **Theme re-render reuses the stored source (#164):** `slots[i].source` is
  the string captured at `collectSlots()` time, before any SVG replaced the
  placeholder's `<pre>`. `showSvg` replaces the *children* of the same
  `.md-view-diagram` wrapper, so the wrapper (and the slot's reference to
  it) survives theme re-renders.
- **DOM adapter's writes:** `showSvg` is the renderer's second `innerHTML`
  sink (`wrapper.innerHTML = svg`), with the same trust class as the
  existing `container.innerHTML`. Its input is Mermaid `strict` output
  sanitized by DOMPurify, with the CSP as the backstop (no script can
  execute from it). This is documented in a comment at the sink.
- **Engine adapter:** `render()` awaits the memoized load, then calls
  `mermaid.initialize(mermaidConfig(theme))` followed by
  `mermaid.render(id, source)`, and returns `.svg`. `bindFunctions` is
  **never called**, a third independent layer behind `strict` and the CSP
  for #158's click handlers.
- **Wrapper styling (`app.css`):** `.md-view-diagram` centers the SVG and
  sets `max-width: 100%`. `.md-view-diagram-error` uses the existing error
  colours in both themes. No per-diagram theming (#158 limitation).

`renderer.js` changes are wiring only: build the controller once, next to
`initialBaseURI`, and add one call in each of `onFileRendered` (ok/error
branches), `onDocumentClosed` and `onViewSettings`. The Task 44 Close
handler's existing clears stay as they are, so `container.textContent = ''`
still produces the pristine state (#163 via the shared
`expectPristineDocumentView` helper).

### SOLID boundary scan

- **SRP:** `markdown.ts` recognizes and escapes. `diagrams.js` policy
  functions decide, the controller sequences and gates, the engine adapter
  talks to Mermaid, the DOM view reads and writes elements, and
  `renderer.js` only wires. The CSP lives in markup, not code.
- **OCP:** the fence rule is extended by decoration without editing
  markdown-it or `highlightCode`. A future diagram language is a new
  `isXFence`/engine pair behind the same placeholder `data-diagram` key.
- **LSP:** no inheritance. The fake engine and fake view in unit tests
  honour the port contracts exactly, including rejection semantics.
- **ISP:** two one- and two-method ports. No bridge or IPC change (#168).
- **DIP:** the controller depends on `engine`/`view` abstractions. Only
  the composition root (`renderer.js`) knows about `document`,
  `globalThis.mermaid` and `initialBaseURI`.
- **Clean Architecture:** `main` gains no knowledge of Mermaid beyond the
  string `mermaid` in a pure recognizer. The render seam (`FileRenderedMessage`)
  is unchanged.

### GoF patterns

- **Decorator:** the fence rule wraps markdown-it's original fence renderer.
- **Adapter:** `createMermaidEngine` adapts Mermaid's global
  `initialize`/`render` API to the `engine.render(id, source, theme)` port.
- **Proxy (virtual proxy):** the same adapter defers loading the real
  3.5 MB subject until the first `render` (D1).
- **DIP port (not Strategy):** `diagramThemeFor(isDark)` is a pure mapping
  function, not a Strategy object. The swappable part is the engine port
  (a fake in unit tests, Mermaid at runtime), which is dependency inversion
  rather than a GoF Strategy (amended at Task 45 review: Nit 4).
- **Command token / guard:** the generation gate, as with `revealToken` and
  the Task 44 epoch.

### Test plan (TDD Red-Green-Refactor, 3-cycle stop)

**Unit (`vitest`, Node, no jsdom):**
- `tests/unit/markdown.test.ts` (extend):
  - **#156:** `isMermaidFence`: `mermaid`, `mermaid title`, and
    `  mermaid  ` are true; `Mermaid`, `MERMAID`, `mermaid-js`, `mermaidx`,
    `js mermaid` and `''` are false. An indented code block with mermaid
    source and inline `` `mermaid` `` produce no `md-view-diagram`.
  - **#156 golden:** `markdownToHtml(tests/e2e/fixtures/with-code/doc.md)`
    equals `tests/unit/golden/with-code.html`, byte for byte. The golden
    file is generated from **unmodified** `markdown.ts` (`main` @ `8e80fa0`)
    as the *first* step, before any production edit. It is a
    characterization test, green before and after.
  - **#157 security regression:** a mermaid fence with body
    `</pre><script>alert(1)</script><img src=x onerror=alert(1)>` yields
    HTML containing no `<script`, no `<img` and no `onerror`, and the body
    appears as `&lt;/pre&gt;&lt;script&gt;…`. Also `"`/`&` escaping, and
    placeholder shape equality for a simple body.
- `tests/unit/diagrams.test.ts` (new):
  - **#158:** `mermaidConfig(t)` contains `securityLevel:'strict'`,
    `startOnLoad:false`, `suppressErrorRendering:true` and
    `maxTextSize:50000`; `secure` ⊇ Mermaid defaults ∪
    {themeCSS, themeVariables, fontFamily, altFontFamily, theme, darkMode};
    it returns a fresh object on each call.
  - **#164:** `diagramThemeFor(true)==='dark'`, `diagramThemeFor(false)==='default'`.
  - **D4:** `exceedsMaxTextSize` at 50000 is false and at 50001 is true.
  - **Gate:** `advance` is monotonic and `isCurrent` is false for every
    earlier token.
  - **Controller with a fake engine** (controllable deferred promises)
    **and a fake view:**
    - N slots produce N `render` calls with unique ids, and `showSvg` for each.
    - A rejecting slot shows the failure, and the other slots still render (#162).
    - An oversized slot shows the failure without calling `engine.render` (D4).
    - #163: `documentCleared()` while a render is pending gives zero writes
      after resolution. `documentRendered()` with new slots while old
      renders are pending writes only the new slots. `darkModeChanged(!dark)`
      mid-pass writes nothing from the old pass, and the new pass uses the
      new theme.
    - #164: `darkModeChanged(sameValue)` produces zero `render` calls. A
      theme change re-renders from `slot.source` captured at collection
      (the fake view mutates its "DOM" after `showSvg`, proving the stored
      source is used), and `collectSlots` is not called again.
    - #165: a second `documentRendered()` re-collects and re-renders.
    - D1: zero slots means the engine is never called (lazy-load guard).
  - #163 (amended), load respects generations: with `ready()` pending,
    `documentCleared()` (or `documentRendered()` with new slots) and then
    `ready()` resolving gives zero writes from the old pass and zero
    `render` calls for it. The same holds when `ready()` **rejects**: no
    `showFailure` from the old pass.
  - #162 (amended): `ready()` rejecting on a current pass shows
    `showFailure` on every slot. `exceedsMaxTextSize` boundaries are
    `MERMAID_MAX_TEXT_SIZE` (false) and `MERMAID_MAX_TEXT_SIZE + 1` (true).
  - **Engine adapter** (fake `appendScript`/`getGlobal`): one script
    append across many renders (memoized); `initialize` receives
    `mermaidConfig(theme)` before every `render`; `bindFunctions` is never
    invoked; a load failure rejects every `render`; `scriptUrl` is exactly
    the value passed in.

**Integration:**
- `tests/integration/dist-mermaid.test.ts` (new, #161, same posture as
  `dist-changelog.test.ts`, requiring `npm run build`):
  `dist/renderer/mermaid.min.js` is byte-equal to
  `node_modules/mermaid/dist/mermaid.min.js`; the installed
  `node_modules/mermaid/package.json` version is `11.17.2`; `package.json`
  pins `"mermaid": "11.17.2"` exactly (no `^`/`~`); `dist/renderer/diagrams.js`
  exists; `dist/renderer/index.html`'s CSP meta content equals the exact
  string above and precedes `<base>`; and `mermaid` is the only dependency
  added relative to the Task 44 set (#167).

**E2E (Playwright/Electron).** Violation listeners are registered *after
launch and before opening the file*, using the stubbed-dialog File > Open
path from `close-document.spec.ts`, because an inline listener script would
itself be blocked.
- `tests/e2e/csp.spec.ts` (new, #160):
  - (b) Open `tests/test-content/test-fixture.md` (it includes a mermaid
    fence, so it exercises the diagram pass and the lazy load). Wait for
    the diagram SVG, then assert **zero** `securitypolicyviolation` events.
  - **(c) inline-script canary:** append a `<script>` whose `textContent`
    sets `window.__cspCanary`. The canary stays `undefined`. Companion:
    `insertAdjacentHTML('<img src=x onerror=…>')` leaves its canary
    `undefined` as well.
  - `fetch('https://example.com')` rejects.
  - The CSP meta is the first element after `charset` in the loaded
    document, and its `content` equals the spec string.
  - (a) is not a new test: the full existing e2e suite runs unmodified,
    with zero diff to existing spec files.
- `tests/e2e/mermaid.spec.ts` (new):
  - Basic: `test-fixture.md`'s diagram becomes an `svg` inside
    `.md-view-diagram`. Two diagrams in one fixture give two SVGs with
    distinct ids (#165).
  - **#159 XSS suite:** fixture diagrams whose node labels, edge labels,
    `click … href "javascript:…"`, `click … call`, `<script>`,
    `<img src=x onerror=…>` and HTML entities (`&lt;b&gt;`, `&#60;script&#62;`)
    set the canary. After the pass, `#content` has no `script` element, no
    attribute matching `/^on/i` on any element, no `javascript:` in any
    `href`/`xlink:href`/attribute, and `window.__mdvCanary === undefined`.
    Clicking every `.node` and `a` still leaves the canary undefined.
  - **#158 directive override:** `%%{init: {"securityLevel":"loose"}}%%` +
    `click A callback` gives no handler, and clicking leaves the canary
    undefined. `%%{init: {"themeCSS":".mdv-attacker{…}", "fontFamily":"AttackerFont"}}%%`
    gives no `mdv-attacker` or `AttackerFont` in the SVG. Frontmatter
    `config: { securityLevel: loose, themeCSS: … }` gives the same result.
    `%%{init: {"theme":"forest"}}%%` in dark mode renders with the dark
    palette (D2).
  - **#162:** an invalid diagram shows `.md-view-diagram-error` with the
    source text, while its siblings render. A diagram with more than 500
    edges shows the notice (Mermaid throws). A generated 50 001-character
    diagram shows the notice, not Mermaid's pink substitute. No
    `pageerror` event fires.
  - **#161 no network:** during the pass, `performance.getEntriesByType
    ('resource')` and `page.on('request')` show only `file:` URLs. A
    positive control (the fixture's `https:` image) confirms the
    observation channel actually sees remote requests before a zero is
    trusted.
  - **D1/base decoy:** the fixture folder contains a decoy
    `mermaid.min.js` that sets `window.__decoyCanary`. Opening a diagram
    document from that folder renders diagrams, and the decoy canary
    stays undefined. A plain document produces no `mermaid.min.js`
    resource entry.
  - **#164:** toggle Dark Mode and the SVG re-renders with dark colours
    without re-reading the file (assert via the same stubbed-read counter
    pattern, or file-unchanged plus no `FILE_RENDERED`). Toggling
    frontmatter, the tree and Code/Preview tabs keeps the SVG element's
    identity (tagged via `evaluate`, still the same node).
  - **#165 live reload:** rewrite the file's diagram, and the new SVG
    reflects the new label.
  - **#163:** open a document with several diagrams, then Close before the
    pass completes (the first load of the bundle gives a natural window of
    about 100 ms or more; the test forces it by closing immediately after
    `FILE_RENDERED`). After a settle wait, `expectPristineDocumentView`
    passes and `#content` stays empty. Also: dark toggle mid-pass leaves
    no old-theme SVG, and a newer document mid-pass contains none of the
    older document's diagrams.
  - **Orphan-free body (review addition):** snapshot the list of
    `document.body` children (tag, id, class) at pristine launch. Then (a)
    after a document whose diagrams include a failing one has finished its
    pass, and (b) after closing that document, the body's children equal
    the snapshot exactly. Mermaid's temporary `#d<id>` render containers
    (and anything else) must not linger. The loader's `<script>` goes to
    `<head>`, so it is outside this assertion by construction, and the test
    also asserts it is in `<head>`.
  - **#166:** the Code tab shows the raw fence, and copy-raw-source is
    byte-identical to the file (reusing `ui-shell.spec.ts`'s assertion
    pattern). The status bar and frontmatter view are unaffected.
- Fixtures (new): `tests/e2e/fixtures/with-mermaid/{basic,multi,xss,override,invalid}.md`
  plus `mermaid.min.js` (decoy). The >500-edge diagram is generated at
  runtime, like the oversized one. The oversized diagram is generated at
  runtime into a temp dir.

**Fault-injection plan.** The reviewer runs F1 at minimum, and the engineer
records each F in the review evidence. Each change is applied to the built
app or source, the named test is observed **red**, and the change is
reverted:

| # | Injected fault | Must go red |
|---|---|---|
| **F1** | Delete the CSP `<meta>` from `src/renderer/index.html`, rebuild | `csp.spec.ts` (c) inline-script canary **and** the `onerror` companion (and the meta-content assertions) |
| F2 | Remove `'theme'` / `'themeCSS'` from `secure` | `mermaid.spec.ts` override tests (forest palette / attacker CSS present) |
| F3 | `securityLevel: 'loose'` and call `bindFunctions` | #159 XSS / #158 click tests |
| F4 | Drop the post-`await` `isCurrent` check | `diagrams.test.ts` stale-write cases, and e2e Close-mid-pass |
| F5 | Resolve the bundle URL lazily, at load time, against the retargeted base (e.g. a relative `scriptUrl`, or `new URL('./mermaid.min.js', document.baseURI)` evaluated inside the appender). Resolving against `document.baseURI` once at composition time is **not** a fault: no retarget has happened yet, so it equals `initialBaseURI`, and the reviewer observed it stay green (amended at Task 45 review: S2) | e2e decoy canary |
| F6 | Remove `escapeHtml` from the placeholder | #157 unit test |
| F7 | Remove the `exceedsMaxTextSize` pre-check | unit oversize case and e2e 50 001-character case |
| F8 | Case-insensitive fence match | #156 `Mermaid` unit case |
| F9 | `suppressErrorRendering: false` in `mermaidConfig` (Mermaid then leaves `DIV#d<id>` in `<body>` after a failed render; probe-confirmed) | e2e orphan-free body test (and the #158 config unit test) |
| F10 | Drop the post-`ready()` `isCurrent` check | unit "load respects generations" cases |
| F11 | Hard-code `50000` in `exceedsMaxTextSize` and change the constant to 40000 | unit shared-constant/boundary test |

Every e2e RED/GREEN observation requires `npm run build` **before** the
Playwright run (a targeted `playwright test` does not rebuild `dist/`).
Reverts use a captured patch and `git apply -R`, never `git checkout`,
`git restore` or `git reset`.

### Alternatives rejected (-> ADR-010)

| Alternative | Why rejected |
|---|---|
| `@mermaid-js/tiny` | A reduced build that omits some diagram types and features (mindmap, architecture, KaTeX math, per its README; the Lead has not re-verified this), so diagrams that render on GitHub could fail here. It is maintained as a secondary artifact, and its size saving matters little once loading is on demand (D1). |
| Pre-render in `main` via mermaid-cli/puppeteer | Ships a second headless Chromium (100 MB+), spawns a process per render, and moves an untrusted-input renderer into the privileged process. It is also slow for live reload. |
| Remote renderer (Kroki, mermaid.ink) | Sends document content off-machine, breaks offline use, and needs `connect-src`/`img-src` to a third party. It contradicts #161 and the reason this CSP exists. |
| `securityLevel: 'sandbox'` | One iframe per diagram: needs `frame-src` (weakening the CSP), fixed-height iframes that don't size to content, no inherited dark-mode CSS, and no text selection/find across the document. `strict` + DOMPurify + CSP gives equivalent protection for this threat model. |
| Mermaid 12.0.0 | Released 2026-09-10 (16 days old): a new major with ELK as default layout and a new default look (visual churn for users), 5.4 MB vs 3.5 MB, and it leaves the same CVE-2026-41159 keys overridable, so it buys no security. Backlog candidate. |
| Split the CSP into a separate prerequisite task | The Lead's recommendation, overruled by the user (Step 0). Kept together because the CSP is the control that makes rendering untrusted diagrams in the bridge-bearing window acceptable; landing Mermaid first would ship a window with no exfiltration barrier. Recorded as a user decision. |
| Render in `main` (jsdom + Mermaid) | Mermaid needs real layout (`getBBox`, text measurement). jsdom has none, so output is wrong or crashes. It would also enlarge the privileged process's attack surface. |
| Eager `<script>` load | Measured +~0.5 s on every launch (D1). |
| CSP via `session.webRequest.onHeadersReceived` | Response-header hooks don't fire for `file://` loads (no HTTP response). The `<meta>` policy is the mechanism that works for `loadFile`. |
| SRI-hash `script-src` / custom `app://` protocol to fix D3 | Both would tighten `'self'` beyond `file:`, but need a build-time hash generator plus `integrity` attributes, or a protocol handler that changes every relative URL and ADR-004's base logic. That is disproportionate given D3's exploit preconditions. Backlog candidate. |

### In-scope files (proposed `current_scope.json` `in_scope`)

- `package.json` (dependency + two build copy steps), `package-lock.json`
- `src/main/markdown.ts`
- `src/renderer/index.html` (CSP meta + `diagrams.js` script tag)
- `src/renderer/diagrams.js` (new)
- `src/renderer/renderer.js` (wiring only)
- `src/renderer/app.css` (`.md-view-diagram`, `.md-view-diagram-error`)
- `tests/unit/markdown.test.ts`, `tests/unit/diagrams.test.ts` (new),
  `tests/unit/golden/with-code.html` (new)
- `tests/integration/dist-mermaid.test.ts` (new)
- `tests/e2e/csp.spec.ts` (new), `tests/e2e/mermaid.spec.ts` (new)
- `tests/e2e/fixtures/with-mermaid/basic.md`, `multi.md`, `xss.md`,
  `override.md`, `invalid.md`, `mermaid.min.js` (all new)
- `.agents/specs/review_report_task45.md` (reviewer output)
- `.agents/specs/decisions/ADR-010_md-view.md` stays **Proposed** until
  close-out. It is not in the engineer's scope; the Lead flips it at Step 3.

Explicitly NOT touched: `src/main/index.ts` (no send-path change),
`src/preload/**` (#168: no bridge or IPC change), `windowConfig.ts`,
`linkPolicy.ts`, `helpWindow.ts`, `whatsNewWindow.ts`, `electron-builder.yml`,
`tests/test-content/test-fixture.md`, every existing spec file under
`tests/e2e/` (#160(a) requires them unmodified), `tests/e2e/support/**`,
`help.md`, `README.md` and `CHANGELOG.md` (release-time satellite).

### Expected output format

New files: full content. Existing files: diff (targeted edits).

### Spec section this closes

`functional_domain.md` Task 45, guardrails #156-#168.

---

### Task 45: User approval conditions (binding on implementation and review)

The blueprint above was approved on 2026-09-26 subject to these conditions.
Where a condition and the blueprint disagree, the condition wins.

1. **D1 approved:** the bundle loads on demand. The loader resolves
   `mermaid.min.js` from the renderer's existing `initialBaseURI` (captured
   before any `<base href>` retarget, the theme `<link>` pattern). The decoy
   test and F5 stay.
2. **D2 approved:** `theme` and `darkMode` join the locked `secure` keys
   (#158 amended). Tests cover both `%%{init}%%` and frontmatter `config:`.
3. **`img-src` allows `http:` and `https:`** (#160 amended). The exact CSP
   string is
   `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file: data: http: https:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self' file:`.
4. **#162 amended:** oversized diagrams (app check, D4) and a bundle-load
   failure both produce the per-diagram notice. The app check and Mermaid's
   `maxTextSize` read one shared constant. `maxEdges` was probed: it throws,
   so it takes the ordinary failure path.
5. **#163 amended:** the on-demand load respects generations.
6. **Orphan-free body test** plus fault injection F9 (see the test plan).
7. **ADR-010 stays Proposed until close-out.**
8. D3 (scheme-wide `'self'` under `file:`) and D4 (app-side size check) are
   accepted as written.

---

## Task 46: About window + third-party license notices + static-window CSP (Step 1)

Closes `functional_domain.md` Task 46, guardrails #169-#179. Branch:
`feature/046-about-window` (off `main` @ `38cb06b`). No stale
`current_scope.json` existed at branch creation.

### Evidence this plan rests on (measured, not assumed)

The probes ran against the repo's `package-lock.json` and `node_modules`, the
registry and GitHub APIs, and Electron 44.3.0 (Chromium 152.0.7977.78). They
used scratch copies and the gitignored `dist/` from `npm run build`. Apart from
these spec files, nothing tracked was left modified. (One probe step,
`asar extract-file`, wrote into the working directory and overwrote
`package.json`. The file was restored from `HEAD`, and its blob hash was
verified identical. The packaged-app check below therefore runs every asar
command from a temp directory.)

**E1. The static windows have never been styled (pre-existing defect since
Task 14).** Chromium refuses to load a `file:` subresource into a `data:`
document. The real built app's Help window logs three times
`Not allowed to load local resource: file:///…/dist/renderer/{app,github-markdown-light,github}.css`.
Its `.markdown-body` computes to `font-family: "Times New Roman"`, and
`document.styleSheets[i].cssRules` throws for all three. Only the inline
`style` attribute (max-width and margins) applies. What's New behaves the same.
No existing test asserts styling, which is why this went unnoticed. This
changes what #178 means by "what the windows need for styles". See D1.

**E2. data: URL ceiling.** With `loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))`
under the same `webPreferences` as `createStaticWindow`:
- 1 993 153 URL characters: loads.
- 2 150 439 and 2 622 299 URL characters: `ERR_INVALID_URL (-300)`.

The ceiling is about 2 MiB (Chromium's `kMaxURLChars` = 2 097 152).
`loadStaticHtml` swallows every load error, so an oversize document would show
as a **blank window with no error**. A size budget is therefore a tested
invariant (#177 below).

**E3. Hash-pinned embedded stylesheet under the proposed CSP** (Help,
What's New, and an About+notices prototype, rendered through markdown-it with
`html: false`):

| Probe | Result |
|---|---|
| Three CSS files embedded as one `<style>`, CSP `style-src 'sha256-<hash of raw bytes>'` | **Blocked.** `dist/renderer/app.css` is CRLF, and the HTML parser normalizes `\r\n` to `\n` before hashing, so the hash never matches. |
| The same, hashing the **LF-normalized** CSS | **0** violations during load. `font-family: -apple-system…`, `max-width: 704px`. |
| Wrong hash (control) | 1 violation, unstyled. The channel sees violations. |
| No CSP (control) | An appended inline `<script>` sets the canary (`1`). |
| Proposed CSP | The appended inline `<script>` is blocked, and the canary stays `undefined`. |
| markdown-it table with `:-`/`-:` alignment | 4 violations (one per aligned cell's `style="text-align:…"`). See D3. |
| About prototype with the full notices in nested `<details>`: 346 132 URL chars (16.5% of the ceiling) | 0 violations. `summary.click()` opens it with no script. |

Violations are observable as `console-message` events on the window's
`webContents`, registered in `main` at `browser-window-created`. That is
before `loadURL`, so parse-time violations are caught; a listener added from
the page after load would miss them. The real-app probe used exactly this.

**E4. What the packaged v1.1.0 app ships today** (`release/win-unpacked/resources/app.asar`,
listed with `@electron/asar`). Its `node_modules` holds the 12 runtime-tree
packages **with their license files**, including `highlight.js/LICENSE`. They
sit inside the archive, where no user can reach them. Step 0's "the app ships
none today" is imprecise in that respect only. The 113 Mermaid-tree packages
bundled in `mermaid.min.js` ship with no notice at all, so the task is
unchanged. The packaged `package.json` keeps `name`, `version`, `description`,
`license`, `author`, `repository`, `homepage`, `bugs` and `dependencies`, and
drops `scripts`, `keywords` and `devDependencies`. `LICENSE` is **not**
shipped today (`electron-builder.yml` packs only `dist/**/*` + `package.json`).

### Shipped package closure (#173)

**Roots.**
- (a) Every key of `package.json` `dependencies`: `chokidar`,
  `github-markdown-css`, `highlight.js`, `markdown-it`, `zod`.
- (b) Every package the build copies from `node_modules` into `dist/`:
  `mermaid`, `github-markdown-css`, `highlight.js`.

Note that `mermaid` is a **`devDependency`** (Task 45 B3), so every package in
its tree is `"dev": true` in the lockfile. Any "production dependencies only"
filter silently drops all 113 of them. That is the exact omission #173
forbids, and it drives the tooling decision below.

Root list (b) is a constant `BUILD_COPIED_PACKAGES` in the generator. A unit
test parses the `build` script in `package.json`, extracts every
`node_modules/<pkg>/` source path, and asserts the extracted set **equals** the
constant. A future copy step that forgets the constant fails CI.

The preload bundle (esbuild) imports nothing from `node_modules` other than
`electron`, which is external (grep-verified), so it adds no roots. This is
recorded rather than tested, because it isn't a shipped-file copy.

**Algorithm** (pure function `computeShippedClosure(lock, roots)`, over
lockfile v3 `packages`):
1. Start with the queue `node_modules/<root>` for each root.
2. For each entry, follow `dependencies` ∪ `optionalDependencies` ∪
   non-optional `peerDependencies`.
3. Resolve each name the way Node does: try `<entry>/node_modules/<name>`,
   then walk up one `node_modules` level at a time to the top-level
   `node_modules/<name>`.
4. An unresolvable required edge throws, so the build fails closed. An
   unresolvable optional edge is skipped, because a package that isn't
   installed cannot be shipped. A `link: true` entry throws, since there are
   no workspaces.
5. The result is deduplicated by `name@version`.

Nested versions are distinct packages. Examples:
`d3-sankey/node_modules/d3-array@2.12.1` next to top-level `d3-array@3.x`, and
`katex/node_modules/commander@8.3.0`. The closure has 9 nested entries.

**My count: 125 packages**, against the Lead's baseline of 124:

| License | Mine | Lead | Δ |
|---|---|---|---|
| MIT | **79** | 78 | +1 |
| ISC | 33 | 33 | |
| BSD-3-Clause | 7 | 7 | |
| BSD-2-Clause | 1 | 1 | |
| Apache-2.0 | 1 | 1 | |
| (MPL-2.0 OR Apache-2.0) | 1 | 1 | |
| Python-2.0 | 1 | 1 | |
| Unlicense | 1 | 1 | |
| no `license` field (`khroma`) | 1 | 1 | |
| **Total** | **125** | **124** | **+1** |

**The difference is `@types/trusted-types` (MIT).** It is an
`optionalDependency` of `dompurify` and is flagged `"optional": true` in the
lockfile. The baseline evidently followed `dependencies` only. It is
types-only, so esbuild cannot have bundled it into `mermaid.min.js`. Following
optional edges is still correct under #173: over-inclusion is acceptable, and
a rule that skipped optional edges would silently drop a *runtime* optional
dependency in some future tree. Non-optional peers add nothing today: every
declared peer (`cytoscape` for the two cytoscape layouts, `d3-selection` for
`d3-transition`) is already in the closure through a regular edge.

Other checks:
- Lockfile/installed agreement: 0 version mismatches between the lockfile and
  `node_modules/*/package.json`. The generator re-asserts this on every build
  and fails on a stale install.
- Lockfile `license` = installed `package.json` `license` for all 125.
- Deliberate over-inclusion: `@types/trusted-types`, the 23 `@types/d3-*`
  packages and `@chevrotain/types` are type-only and never bundled. They are
  kept rather than filtered, because a filter would be a second, weaker rule.

### License policy (#174)

**Allowlist** (ordered: the order is the preference for OR choices):
`MIT`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`, `Apache-2.0`, `Python-2.0`,
`Unlicense`. That is exactly the set found, minus `MPL-2.0`. No copyleft
licenses. `MPL-2.0` (file-level weak copyleft) is **deliberately left out**:
the one package offering it also offers Apache-2.0.

**Expression rule** (small pure parser, `evaluateLicense(expr, allowlist)`).
Grammar: `id`, `( expr )`, `expr OR expr`, `expr AND expr`, with AND binding
tighter than OR.
- `OR` passes if at least one alternative passes. The **chosen** alternative
  is the first passing one in allowlist order.
- `AND` passes only if every operand passes.
- These all fail with a named error: `WITH` exceptions, `+` suffixes,
  `LicenseRef-*`, `SEE LICENSE IN …`, a legacy object or array `license`
  field, and a missing or empty field without an override.
- For `dompurify@3.4.16`, `(MPL-2.0 OR Apache-2.0)` gives **chosen
  `Apache-2.0`**. The notice entry records both `license` (as declared) and
  `chosenLicense`.

`Python-2.0` (`argparse@2.0.1`, a port of CPython's argparse) is the PSF
license. It is permissive and was already shipping in the runtime tree.
`Unlicense` (`robust-predicates`) is a public-domain dedication.

### License texts, NOTICE files and overrides (#175)

**File selection** (per package root directory, sorted by file name):
- License files match `/^(licen[cs]e|copying)(-[a-z0-9]+)?(\.(md|txt|markdown))?$/i`.
  This matches all 124 license files in the closure, including `LICENSE-MIT.txt`,
  `LICENSE.md`, `license` and dompurify's `LICENSE-MPL`. It excludes
  `cytoscape/license-update.mjs` (a script, not a license).
- NOTICE files match `/^notice(\.(md|txt))?$/i`.
- **Every** matching file is reproduced verbatim. Nothing is generated from an
  SPDX template.

**NOTICE files found: exactly one, `es-toolkit/NOTICE`** (MIT package; 1 698
bytes; Lodash's copyright and MIT permission notice for code derived from
Lodash). The two Apache-2.0-bearing packages (`@chevrotain/types`, and
`dompurify` under the chosen alternative) ship **no** NOTICE. Apache-2.0 §4(d)
applies only to a NOTICE the work actually includes, so none is owed.

**Packages that need a checked-in override: 3** (the baseline named one):

| Package | Problem | Upstream source (citation) |
|---|---|---|
| `khroma@2.1.0` | No `license` field (in the lockfile, the installed `package.json` and the upstream `package.json`). It **does** ship a `license` file (MIT). | `https://github.com/fabiospampinato/khroma/blob/4968165afb0d3d09be66497e7985a34f7bfe6d42/license`: tag `v2.1.0`, which is also npm's `gitHead` for 2.1.0. The upstream file is **byte-identical** to `node_modules/khroma/license` (diff verified). |
| `fastdom@1.0.12` | `license: "MIT"`, but **no license file** in the package or anywhere upstream. The only license text is the README's `## License` section (MIT, "Copyright (c) 2016 Wilson Page"). | `https://github.com/wilsonpage/fastdom/blob/01524d7b90785fcac5a75bb9f149e14b9e5246c3/README.md#license`, lines 211-221. npm's `gitHead` (`a7b9044…`) is **not** on GitHub (API returns 422). 1.0.12 was published 2024-02-20T08:03:43Z, 3 minutes after merge commit `01524d7b…` (2024-02-20T08:00:06Z), and the README at that commit is byte-identical to the installed one. The upstream has no tag for 1.0.12. |
| `strictdom@1.0.1` | Same as fastdom: README-only MIT text, "Copyright (c) 2013 Wilson Page". | `https://github.com/wilsonpage/strictdom/blob/a3bbf19013ecc9c9d165dd4ed89e94757161443e/README.md#license`, lines 99-109, tag `v1.0.1`, npm `gitHead`. Byte-identical to the installed README. |

**Override contract** (`build/third-party/overrides.json` plus one text file
per entry, `build/third-party/<name>@<version>.txt`):

```json
{ "khroma@2.1.0": { "license": "MIT", "text": "khroma@2.1.0.txt",
    "reason": "no license field",
    "citation": { "url": "https://github.com/fabiospampinato/khroma/blob/4968165afb0d3d09be66497e7985a34f7bfe6d42/license",
                  "ref": "v2.1.0 (4968165afb0d3d09be66497e7985a34f7bfe6d42)" },
    "verify": { "file": "license", "mode": "equals" } },
  "fastdom@1.0.12": { "license": "MIT", "text": "fastdom@1.0.12.txt",
    "reason": "no license file; text is the README License section",
    "citation": { "url": "https://github.com/wilsonpage/fastdom/blob/01524d7b90785fcac5a75bb9f149e14b9e5246c3/README.md#license",
                  "ref": "01524d7b90785fcac5a75bb9f149e14b9e5246c3" },
    "verify": { "file": "README.md", "mode": "contains" } },
  "strictdom@1.0.1": { "…": "same shape, verify README.md contains" } }
```

Each `.txt` is a verbatim copy of the cited upstream text. It is never retyped
and never produced from a template.

Build rules, all fail-closed:
1. A closure package with no `license` field **or** no license file must have
   an override keyed by its exact `name@version`. Otherwise the build fails
   and names the package.
2. The override's text is **machine-verified against the installed package**
   on every build, EOL-normalized:
   - `equals` requires the package's own file to match the override text.
   - `contains` requires the override text to be a substring of the named
     file.
   A version bump therefore invalidates the key, and a text drift fails the
   comparison. Both force re-verification rather than silently reusing text.
3. An override whose key is not in the closure (a **stale** override) fails
   the build.
4. A `citation.url` that is not `https://github.com/…/blob/<40-hex>/…` fails
   the build: a pinned commit is required, and a branch URL is not accepted.
5. The override's `license` id goes through the same allowlist.
6. When the package ships a license file (`khroma`), the entry reproduces
   **the package's own file**. The override supplies the id and the citation,
   and its text is the verified twin. When the package has no file
   (`fastdom`, `strictdom`), the override's text is the entry text. The entry
   records `source: "package" | "override"` and the citation.

### Generator: small script vs build-time dependency (#179)

| | In-repo script `scripts/third-party-notices.mjs` (recommended) | `license-checker` 25.0.1 | `license-checker-rseidelsohn` 5.0.1 / `generate-license-file` 4.2.5 |
|---|---|---|---|
| Last release | n/a | **2019-01-10** (unmaintained) | 2026-05-27 / 2026-08-29 |
| New dependency surface | **0 packages** | 10 direct deps, plus transitive ones | 12 / 10 direct deps, plus transitive ones |
| Root model | Exactly our roots: runtime `dependencies` **plus copied-into-dist devDeps** | Installed tree, filtered by `--production`/`--development` | Same model (production/dev filters over the installed tree) |
| Mermaid tree (all `dev: true`) | Included by construction | `--production` omits all 113, and the full tree includes vitest, electron-builder and every other devDep | Same trade-off: omit Mermaid, or over-include the whole devDep tree and then need our own filter anyway |
| Overrides with **verified** text and pinned citations | Built in (rules 1-6) | Custom-format override files, with no verification against the installed package | Varies. None found that verifies the override text against the installed package or requires a pinned citation |
| Fail-closed allowlist incl. OR choice recorded | Built in | `--onlyAllow` fails, but does not record the OR choice | Similar |
| Deterministic output for #176 | Controlled by us (sort, no timestamps) | Tool-defined | Tool-defined |

The rows about the tools rest on their documented option models and registry
metadata. I did not trial them. The deciding fact holds whichever way that
went: **none of them models "devDependency whose files are copied into the
artifact" as a root.** Using one means either omitting Mermaid (a #173
violation) or re-implementing the root and closure logic around it, and at
that point the tool adds only a dependency. The script is about 200 lines of
pure functions plus a thin IO shell, all unit-testable. **Recommendation: the
script. No new dependency is added**, so #179's allowance goes unused.

**Script shape** (ESM, Node 24, no dependencies; lives outside `src/` so
`tsc` never compiles it into `dist/` and it never ships):
- Pure core: `computeShippedClosure`, `evaluateLicense`,
  `selectLicenseFiles`/`selectNoticeFiles`, `applyOverrides`,
  `compareEntries`, `buildNoticeSet`, and `extractCopiedPackages(buildScript)`
  (for the root-sync test).
- IO shell (`main()`, guarded so importing the module has no side effects):
  1. Read `package.json`, `package-lock.json`, `node_modules/<pkg>/{package.json, license files, NOTICE}`
     and `build/third-party/*`.
  2. Call the core.
  3. Write `dist/third-party-notices.json`.
  4. Exit non-zero with **every** violation listed (not just the first).

**Output** `dist/third-party-notices.json`, LF with a trailing newline, fixed
key order, **no timestamp**:
```json
{ "schemaVersion": 1,
  "packages": [ { "name": "…", "version": "…", "license": "(MPL-2.0 OR Apache-2.0)",
                  "chosenLicense": "Apache-2.0", "source": "package",
                  "citation": null,
                  "licenseFiles": [ { "file": "LICENSE", "text": "…" }, { "file": "LICENSE-MPL", "text": "…" } ],
                  "noticeFiles": [] } ] }
```
- Sorted by `name` (code-unit order, not locale) and then `version` (numeric
  major.minor.patch, with a string fallback for prereleases). This is
  deterministic regardless of `readdir`/`Set` order or OS locale.
- Texts are reproduced byte-for-byte as decoded UTF-8. Only a leading BOM is
  stripped.
- Measured: 125 entries, 124 license files + 1 NOTICE, about 190 KB of text.

**Build script change** (`package.json` `build`):
1. The existing `node -e` copy chain gains `copyFileSync('LICENSE','dist/LICENSE')`,
   mirroring `CHANGELOG.md` → `dist/CHANGELOG.md`.
2. It is then followed by `&& node scripts/third-party-notices.mjs`.

`npm run dev`, CI (`npm ci` → `npm run build`) and `release.yml` (the same)
all run the generator, so a policy violation fails CI and blocks a release.
`electron-builder.yml` is unchanged, because `dist/**/*` already ships both
new files.

### How the notices are reached from About (#177)

**Chosen: nested `<details>` inside the About window.** The outer
`<details><summary>Third-party notices (125 packages)</summary>` contains one
inner `<details>` per package. Its summary is
`name version — chosenLicense`, and its body holds the declared expression
(when it differs), the source or citation, and one
`<pre>` per license or NOTICE file.

- No new link surface: native disclosure widgets. E3 shows they open with no
  script under `default-src 'none'`.
- No new menu entry and no fourth window variable. #172 stays exactly as
  specified.
- **Measured size: 346 132 URL characters** for About plus all notices plus
  the embedded CSS, which is **16.5% of the ~2 MiB ceiling** (E2).
- **Budget:** an integration test builds the About document from the real
  `dist/` inputs and asserts that its data: URL is **< 1 048 576 characters**
  (half the ceiling). If the budget is exceeded, the build is still valid but
  the test fails. That forces a re-plan (for example a notices file loaded
  another way) instead of the blank window E2 would otherwise produce
  silently.

Loading in the packaged build uses the existing path. `main` reads
`dist/third-party-notices.json` from `app.asar` with `fs.readFile`, just as
`help.md` and `CHANGELOG.md` are read today. It validates the file with a zod
schema (`zod` is already a runtime dependency) and renders an escaped HTML
fragment. The result goes through the same `loadStaticHtml` data: URL.

Rejected:
- **A fourth static window from a Help menu entry.** It adds one menu entry,
  one single-instance variable and more e2e surface, and it gains nothing:
  both options share the data: URL budget, and both are well under it.
- **`loadFile` of a pre-rendered notices HTML in `dist/`.** It adds a second
  load path for static windows (a `file:` origin, so `'self'` becomes
  scheme-wide as in ADR-010 D3), and it would still need the CSS fix.
- **Shipping a text file next to the `.exe` via `extraResources`.** Unreachable
  from About without a `file:` link, which would change the link policy.
- **A pre-rendered HTML fragment emitted by the build.** It would move escaping
  out of the one pure About renderer and weaken #171. JSON plus escaping at
  render keeps one escaping site.

### About data and document (#170, #171)

**Sources** (in `main`; nothing is hardcoded):

| Field | Source |
|---|---|
| name | shipped `package.json` `name` |
| version | `app.getVersion()` |
| description, license id | shipped `package.json` |
| repository URL | shipped `package.json` `repository` (string or `{url}`), normalized by `repositoryWebUrl`: strip `git+`, strip `.git`. Anything that isn't `http:`/`https:` afterwards gets **no link**, and the text is shown escaped. |
| copyright | the first line of `dist/LICENSE` matching `/^\s*Copyright\b/`, trimmed (`parseCopyrightLine`). None found: an error. |
| runtime | `process.versions.electron`, `.chrome` and `.node` in `main` |

The paths go into `paths.ts` beside `changelogPathFor`, as one formula shared
by `index.ts` and the dist tests:
- `packageJsonPathFor(mainDir)` = `mainDir/../../package.json`, which resolves
  to `app.asar/package.json` when packaged and to the repo's `package.json` in
  dev.
- `licensePathFor(mainDir)` = `mainDir/../LICENSE`.
- `thirdPartyNoticesPathFor(mainDir)` = `mainDir/../third-party-notices.json`.

**Pure modules:**
- `src/main/aboutWindow.ts`:
  - `shouldCreateAboutWindow` follows the per-window one-liner precedent.
    This is the third copy; see the backlog note.
  - `parseCopyrightLine`, `repositoryWebUrl` and `AboutPackageSchema` (zod).
  - `buildAboutContentHtml(about, notices)` builds the body fragment. **Every**
    interpolated value goes through `escapeHtml`, moved from `helpWindow.ts`
    and exported. Attribute values are double-quoted and escape `"`.
- `src/main/thirdPartyNotices.ts`: the zod schema for the JSON (the reader
  side of the generator's contract) and `renderNoticesHtml(noticeSet)`.

**Composition** (`index.ts` `onOpenAbout`):
1. If `!shouldCreateAboutWindow(aboutWindow)`, focus the existing window and
   return.
2. Read the three files (`Promise.all`).
3. Parse and build.
4. Call `createStaticWindow(ABOUT_WINDOW_SIZE)`, then `loadStaticHtml`.

On any failure, the handler logs `console.warn` and opens **no window**, the
same containment as What's New (#140). The files are build outputs proven by
the dist tests, so a failure means a broken package, and showing
half-populated legal text is worse than showing nothing. The window title is
`About ${name}`.

### Static-window CSP and styling (#178)

**D1 (needs your decision): fix E1 by embedding the stylesheet, pinned by
hash.**
- `buildHelpHtml(contentHtml, cssText, title)` changes from `cssHrefs:
  string[]` to one CSS string. `index.ts` reads the same three files it links
  today (`dist/renderer/app.css`, `github-markdown-light.css`,
  `github.css`) and concatenates them.
- The shell **LF-normalizes** the CSS (E3: the parser normalizes, and
  `app.css` is CRLF). It hashes the result with SHA-256 (`node:crypto`,
  deterministic, so the function stays pure) and emits both the hash and the
  `<style>` from that **one** normalized string. They cannot drift.
- If the CSS contains `</style` (case-insensitive), the shell throws. Shipped
  CSS never does, and a unit test pins the guard.
- **Visible consequence:** Help and What's New become styled as Task 14
  intended (GitHub markdown typography and code colours) instead of browser
  defaults. This is a user-visible change to two existing windows, so I am
  asking rather than assuming.
- Alternative (D1-b): delete the three dead `<link>`s and keep the windows
  unstyled. The CSP then has no `style-src` at all. About and the notices
  would render in Times New Roman with un-wrapped `<pre>` blocks, and #178's
  "move the inline style into CSS" would have nowhere to go.

**The exact policy** (first element after `<meta charset>`, before `<title>`
and `<style>`; `<H>` is computed per document from the embedded CSS):

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-<H>'; base-uri 'none'; form-action 'none'" />
```

| Directive | Why |
|---|---|
| `default-src 'none'` | Every fetch directive falls back to `'none'`. **That covers `script-src`, which is deliberately absent (#178: static windows never run script)**, and also `img-src`, `font-src`, `connect-src`, `object-src`, `frame-src`, `media-src`, `worker-src` and `manifest-src`. None of the three windows needs an image or a font: `help.md` and `CHANGELOG.md` contain no image syntax, and the only `url()` in the embedded CSS is a `data:` mask on `.markdown-body .anchor:hover`, which markdown-it never emits. Relative images could never resolve from a `data:` document anyway. |
| `style-src 'sha256-<H>'` | Allows exactly the one embedded `<style>`. **No `'unsafe-inline'`.** `style-src-attr` falls back to it, and a hash never matches an attribute without `'unsafe-hashes'`, so every `style=` is refused. `<link>`s are gone (E1: a `data:` document cannot load `file:` CSS anyway). |
| `base-uri 'none'` | Static documents have no `<base>`. The directive does not fall back to `default-src`, so it is set explicitly. |
| `form-action 'none'` | No forms. Also does not fall back, so it is set explicitly. |

Omitted: `frame-ancestors`, `sandbox` and `report-*` (all ignored in
`<meta>`), and `upgrade-insecure-requests` (no subresources to upgrade).

**Inline `style` attribute:** it moves into CSS as the class
`.md-view-static { max-width: 44rem; margin: 2rem auto; padding: 0 1.5rem 3rem; }`.
The shell appends this rule to the embedded CSS, and the wrapper becomes
`<div class="markdown-body md-view-static">`. No `'unsafe-inline'` is needed,
so none is disclosed.

**D3 (disclosure plus a guard): aligned tables.** markdown-it emits
`style="text-align:…"` for aligned table columns (E3). Under this policy the
alignment is dropped and a violation is logged. No current `help.md` or
`CHANGELOG.md` content uses aligned tables or images. A **content guard**
(integration test) renders `dist/main/help/help.md` and **every section** of
`dist/CHANGELOG.md` with `markdownToHtml` and asserts no ` style=` and no
`<img`. A future release note that would violate #178 fails CI before it can
ship. Rejected: `style-src-attr 'unsafe-inline'`, which reopens exactly what
#178 closes, for content we control.

The Electron "Insecure Content-Security-Policy" warning that the Help window
logs today (seen in the real-app probe) disappears. The e2e asserts its
absence as a side check.

### `createStaticWindow` size change (#169)

`windowConfig.ts` gains a pure function:

```ts
export interface StaticWindowSize { width: number; height: number }
export function staticWindowOptions(size?: StaticWindowSize): BrowserWindowConstructorOptions {
  return {
    ...defaultWindowOptions,
    ...(size ? { width: size.width, height: size.height } : {}),   // picked, never spread
    webPreferences: { ...defaultWindowOptions.webPreferences },     // last: always the defaults
  };
}
```

`createStaticWindow(size?: StaticWindowSize)` calls
`new BrowserWindow(staticWindowOptions(size))`. Everything after construction
stays unchanged and unconditional: `removeMenu`, the `will-navigate` prevent,
and the deny-all `setWindowOpenHandler`. Help and What's New call it with no
argument. About uses `ABOUT_WINDOW_SIZE = { width: 640, height: 720 }`, while
`minWidth`/`minHeight` stay 480×320 and the window stays resizable, since the
notices are long.

Why this cannot weaken #142:
1. The parameter's type admits only two numbers, and the function **picks**
   them by name. The caller's object is never spread, so even a type-cast
   `{ webPreferences: { sandbox: false }, … }` is ignored. A unit test does
   exactly that.
2. `webPreferences` is written **after** the size and always from the
   defaults (`sandbox`, `contextIsolation`, no `nodeIntegration`, **no
   `preload`**).
3. The lockdown calls don't read `size`.
4. `staticWindowOptions()` deep-equals today's inline options (unit), and the
   Help and What's New e2e files run **unmodified**.

`resizable` is not exposed, because nothing needs it (YAGNI).

### Menu (#172)

`menu.ts`:
- `MenuHandlers` gains `onOpenAbout`.
- The Help submenu becomes
  `[{ id:'menu-help', … F1 }, { type:'separator' }, { id:'menu-about', label:'About md-view', click: handlers.onOpenAbout }]`
  with no accelerator.
- `menuHandlers()` in `index.ts` wires `onOpenAbout`.
- The title-bar popup reuses `buildMenuTemplate` (#67), so it shows the entry
  by construction.

### SOLID boundary scan and patterns

- **Dependency direction:** the generator's pure core knows nothing about the
  filesystem. The IO shell adapts the lockfile, `node_modules` and overrides
  into plain values. In the app, `aboutWindow.ts` and `thirdPartyNotices.ts`
  are pure (data in, escaped HTML out). Only `index.ts` (the composition root)
  touches `app`, `process.versions`, `fs` and `BrowserWindow`.
- **SRP:** the generator decides what ships and under which license. The
  reader schema checks the contract. The About renderer escapes and lays out.
  The shell owns the CSP and styling. `windowConfig` owns the options.
- **OCP:** a fourth static window is a new caller of an unchanged factory. A
  new license is a one-line allowlist edit, reviewed like any policy change.
- **ISP/DIP:** the renderers take plain data, not `app` or `fs`, and
  `staticWindowOptions` takes a two-field size, not the full options type.
- **GoF:**
  - **Factory** (simple factory): `createStaticWindow`, the one construction
    site, parameterized by size only.
  - **Adapter:** the generator's IO shell adapts npm's on-disk layout to the
    core's value types.

  No other pattern is forced in. The CSP shell is a shared template function,
  not the Template Method pattern.

### Test plan (TDD Red-Green-Refactor, 3-cycle stop)

**Unit (`vitest`):**
- `tests/unit/thirdPartyNotices.test.ts` (new; imports the script's pure core):
  - **#173:**
    - `computeShippedClosure(realLockfile, realRoots)` contains `dompurify`,
      `d3-array@2.12.1` (nested) and `d3-array@3.x`, and excludes `vitest`,
      `electron-builder` and `typescript`. Its size is **125**, and
      `@types/trusted-types` is present (optional edge).
    - Synthetic lockfiles cover:
      - nested resolution shadowing the top-level version;
      - a missing required dep throwing;
      - a missing optional dep being skipped;
      - a peer being followed;
      - a `link: true` entry throwing;
      - cycles terminating.
  - **Root sync:** `extractCopiedPackages(pkg.scripts.build)` equals
    `BUILD_COPIED_PACKAGES`.
  - **#174:** `evaluateLicense` for each allowlisted id (pass); `GPL-3.0-only`,
    `LGPL-2.1`, `AGPL-3.0`, `SSPL-1.0` and `MPL-2.0` (fail);
    `(MPL-2.0 OR Apache-2.0)` gives chosen `Apache-2.0`; `(MIT OR Apache-2.0)`
    gives chosen `MIT` (allowlist order); `MIT AND ISC` passes;
    `MIT AND GPL-3.0` fails; and `WITH`, `+`, `LicenseRef-x`,
    `SEE LICENSE IN x`, `''`, `undefined` and an object all fail with named
    errors.
  - **#175:**
    - Selection includes `LICENSE-MIT.txt`, `license` and `LICENSE-MPL`, and
      excludes `license-update.mjs`.
    - Every override rule 1-6 has a failing case: missing override, `equals`
      mismatch, `contains` miss, stale key, branch URL citation, disallowed
      override id.
    - An override entry records `source` and `citation`.
  - **#176:** `buildNoticeSet` output is identical for shuffled inputs; the
    order is `name` then numeric `version` (`d3-array@2.12.1` before
    `d3-array@3.x`); and the serialized output has no timestamp.
- `tests/unit/aboutWindow.test.ts` (new):
  - `parseCopyrightLine` (repo `LICENSE` gives
    `Copyright (c) 2026 Camilo Vera`, read from the file at test time and
    never typed; no line throws).
  - `repositoryWebUrl` (`git+https://…/x.git` becomes `https://…/x`; the
    object form; `ssh:`/`javascript:` give `null`).
  - **#171:** every field set to `<script>alert(1)</script>"x` renders with
    no `<script`, no raw `"` inside an attribute and no unescaped `<`, and
    the same holds for notice names, versions and texts.
  - `shouldCreateAboutWindow`.
- `tests/unit/buildHelpHtml.test.ts` (updated for the new contract; the three
  title tests are unchanged):
  - The CSP meta is the first element after charset, and its `content`
    equals `buildStaticWindowCsp(hash)`.
  - It has **no** `script-src` and **no** `unsafe-inline`.
  - The hash equals SHA-256/base64 of the embedded `<style>` text.
  - CRLF CSS is embedded LF and hashed LF.
  - `</style` throws.
  - There is no `style=` attribute and no `<link`.
  - `.md-view-static` is present.
- `tests/unit/staticWindowOptions.test.ts` (new):
  - The no-arg call deep-equals today's options.
  - A size changes only `width`/`height`.
  - A cast-in `webPreferences`/`preload`/`sandbox:false` is ignored.
  - `webPreferences` has no `preload`.
- `tests/unit/menu.test.ts` (updated only for the new entries): the Help
  submenu has exactly 3 entries in the #172 order, `menu-about` has no
  accelerator, and its click calls `onOpenAbout`.
- `tests/unit/staticPaths.test.ts` (new): the three path formulas.

**Integration** (`tests/integration/dist-about.test.ts`, new; requires
`npm run build`; same posture as `dist-changelog.test.ts`):
- **#170:**
  - `dist/LICENSE` is byte-equal to `LICENSE`.
  - The copyright line parsed from `dist/LICENSE` equals the one parsed from
    `LICENSE`.
  - `dist/main/aboutWindow.js` and `dist/main/thirdPartyNotices.js` contain no
    `/\b(19|20)\d{2}\b/` and no `package.json` `version` string.
  - The `onOpenAbout` region of `dist/main/index.js` (between marker
    comments) contains neither.

  Not all of `dist/main`: `changelog.js` legitimately has `1.1.0` in a
  comment, verified.
- **#173/#176:**
  - `dist/third-party-notices.json` parses under the app's zod schema, which
    proves the writer/reader contract.
  - Its `name@version` set **equals** `computeShippedClosure(lockfile, roots)`.
  - Every entry has at least one non-empty license text.
  - `dompurify` records `chosenLicense: "Apache-2.0"`.
  - `es-toolkit` carries its NOTICE.
  - The three overrides carry citations.
  - Running the CLI twice into two temp directories gives byte-identical
    files, and both equal `dist/`.
- **#177 budget:** the About document built from the `dist/` inputs has a
  data: URL shorter than 1 048 576 characters.
- **D3 content guard:** rendered `help.md` and every `CHANGELOG.md` section
  contain no ` style=` and no `<img`.
- **CLI fail-closed:** the CLI run against a temp copy of the overrides with
  `khroma` removed exits non-zero with `khroma@2.1.0` in its stderr, and
  writes no output file.

**E2E** (Playwright/Electron). Violation capture is a `browser-window-created`
listener installed through `electronApp.evaluate` **before** the window is
triggered, collecting `console-message` text into a global (E3). Windows are
identified by `document.title`, not by "the data: window", because two data:
windows can coexist.
- `tests/e2e/static-window-csp.spec.ts` (new, #178), for each of Help (menu),
  What's New (seeded `state.json`, as `whats-new.spec.ts` does) and About:
  - **Zero** CSP messages.
  - The meta `content` equals the spec shape.
  - The inline-`<script>` canary stays `undefined`.
  - `.markdown-body` computed `max-width` is `704px` and `font-family` is not
    `"Times New Roman"` (the D1 regression guard for E1).
  - **Positive control:** appending `<img src="data:,x">` produces a CSP
    message in the same capture channel, so a zero is trusted only once the
    channel is proven live.
- `tests/e2e/about.spec.ts` (new):
  - **#172:** `menu-about` exists, has no accelerator, and sits after a
    separator following `menu-help`.
  - **#169/#170:** clicking it opens one window titled `About md-view`. It
    shows:
    - the version equal to `app.getVersion()`;
    - the Electron, Chromium and Node versions equal to `process.versions`
      read in `main`;
    - the copyright line equal to the one parsed from the `LICENSE` file;
    - `MIT`;
    - a link whose `href` is `https://github.com/chamix/md-view`.
  - A second click gives no new window and focuses the existing one.
  - Lockdown:
    - The Ctrl+O accelerator probe from `help-menu.spec.ts` (e), with the
      main-window positive control first, never reaches the handler.
    - `window.open` is denied.
    - Clicking the repo link calls the stubbed `shell.openExternal` with the
      URL, and the About window's URL is unchanged.
    - The About window's `webContents` has no preload.
  - **#177:**
    - The outer `<summary>` shows the package count equal to the JSON's
      length.
    - Opening it and the `highlight.js` entry shows that package's own
      `LICENSE` first line.
    - The `dompurify` entry shows `Apache-2.0` with the declared expression.
    - The `fastdom` entry shows its citation URL.
- **Unmodified:** `help-menu.spec.ts`, `whats-new.spec.ts`, `csp.spec.ts`
  and every other existing spec: zero diff (#169, #179).

**Packaged check (reviewer, #176, same method as Task 45 B3).**
1. Run `npx electron-builder --dir --publish never
   -c.directories.output=<OS temp>`.
2. `asar list` shows `\dist\third-party-notices.json`, `\dist\LICENSE` and
   `\package.json`.
3. `asar extract-file` is run **with the temp directory as cwd**, never the
   repo (see the evidence note). The extracted notices file is byte-equal to
   `dist/`.
4. Launch the packaged exe once, then open About and the notices. The E2
   ceiling has only been measured for the unpackaged app, so this confirms
   it still holds packaged.
5. Delete the temp output.

### Fault-injection plan

The reviewer runs F1, F2 and F6 at minimum, and the engineer records every
entry. Each fault is applied, observed **red**, and reverted with a captured
patch and `git apply -R` (never `git checkout`/`restore`/`reset`). E2E
observations need `npm run build` first.

| # | Injected fault | Must go red |
|---|---|---|
| **F1** | Remove the CSP meta from `buildHelpHtml` | e2e inline-script canary (all three windows); unit CSP tests |
| **F2** | Hash the **un-normalized** CSS (drop the LF normalization) | e2e zero-violation + styled (`max-width`/font) checks, because `app.css` is CRLF; unit CRLF test |
| F3 | Resolve dependencies at the top level only (no nested lookup) | unit nested-shadowing test; `d3-array@2.12.1` missing from the real-lockfile test |
| F4 | Follow roots' direct `dependencies` only (no transitive) | unit #173 real-lockfile test (`dompurify`, `d3-*`) and dist set-equality |
| F5 | Add `MPL-2.0` in front of `Apache-2.0` in the allowlist, or remove `Apache-2.0` | unit OR-choice test (`chosenLicense` changes), or policy failure for `@chevrotain/types` |
| **F6** | Delete the `khroma` override | `npm run build` exits non-zero, naming `khroma@2.1.0`; integration `two CLI runs … both equal dist/` goes red. (The integration CLI fail-closed test stays green by design: it deletes `khroma` from its own temp copy, so it cannot observe the repo's override going missing.) (amended at Task 46 review: N2) |
| F7 | Change one character in `fastdom@1.0.12.txt` | build fails (`contains` verification); unit rule-2 case |
| F8 | Hardcode `'1.1.0'` for the version in `onOpenAbout` | dist no-literal test (the e2e alone would stay green, which is why the dist test exists) |
| F9 | Drop `escapeHtml` from one About field | unit #171 |
| F10 | Implement `staticWindowOptions` as `{ ...defaults, ...size, webPreferences }` with the spread **after** `webPreferences` | unit cast-in test |
| F11 | Remove `mermaid` from `BUILD_COPIED_PACKAGES` | unit root-sync test; dist set-equality |
| F12 | Sort with `localeCompare` / leave unsorted | unit shuffled-input test |
| F13 | Put a `:-` aligned table in `CHANGELOG.md` | D3 content-guard integration test (reverted immediately) |

### Decisions for you (Step 1 review)

- **D1:** Embed the static-window CSS with a hash-pinned `style-src`, which
  restores Help/What's New styling (recommended). The alternative is D1-b:
  drop the dead `<link>`s and stay unstyled.
- **D2:** Notices as nested `<details>` in About (recommended), not a fourth
  window.
- **D3:** No `'unsafe-inline'` for style attributes. Aligned tables and images
  in static-window content are blocked, and the content guard enforces this
  in CI.
- **D4:** An in-repo script with no new dependency (recommended; the Lead's
  preference).
- **Disclosures:**
  - The count is 125, not 124 (`@types/trusted-types`, optional edge).
  - Three overrides are needed, not one (`fastdom`, `strictdom` have no
    license file).
  - `fastdom`'s npm `gitHead` is absent upstream; the citation pins the
    verified merge commit instead.
  - E4 nuances Step 0's "ships none today".
  - Pre-existing defect E1.
- **Backlog candidates** (not built):
  - Consolidate the three `shouldCreate*Window` one-liners (Rule of Three).
  - `loadStaticHtml` swallows **every** load failure (including
    `ERR_INVALID_URL`), not only close-aborts. Reported to the user and
    recorded here; not written to `backlog.md` (Step 1 review instruction).
  - Move `github-markdown-css` to `devDependencies` (Task 45 note, still open).

### ADRs (real rejected alternatives exist)

- **ADR-011 (proposed): static windows embed one hash-pinned stylesheet under
  `default-src 'none'`.**
  - Context: E1 (`file:` CSS is refused from `data:` documents), #178.
  - Decision: LF-normalized CSS embedded in `<style>` with
    `style-src 'sha256-…'`, computed in the same pure function that emits it;
    no `script-src`; no `'unsafe-inline'`.
  - **Main alternative weighed: `webContents.insertCSS()` from `main`**
    (probed at Step 1 review, Electron 44.3.0). `main` would inject the CSS
    string into each static window after load.
    - **For it:** CSS injected by `main` bypasses the page CSP, so the policy
      could be `style-src 'none'`, strictly tighter than a hash. There would be
      no hash plumbing and no CRLF pitfall. Probe: it applies under
      `default-src 'none'` with **0** CSP messages
      (`Times New Roman` → `-apple-system…`).
    - **Against it, and why it lost:**
      1. **Unstyled flash.**
         - At `dom-ready` (and at `did-finish-load`), `capturePage()` already
           returned a painted frame with the **unstyled** content: about
           50 000 non-white pixels and a computed `Times New Roman`. This held
           in 6 of 6 successful captures. One cold-start capture failed with
           `UnknownVizError`.
         - `capturePage` forces a frame, so this proves an unstyled frame is
           presentable at injection time. It does not prove the user saw one.
           But static windows are visible from construction (`show` defaults
           to true), so nothing prevents it.
         - Closing the gap needs `show: false` plus `ready-to-show`, or
           `dom-ready` gating in `createStaticWindow`. That is a lifecycle
           change to the #142 factory for all three callers, plus an async
           step whose failure path (injection rejected, window closed
           mid-inject) needs its own handling.
      2. **Styling moves out of the document.** Because `buildHelpHtml`'s
         output would no longer contain its styles, only e2e could prove
         styling, and there would be one more main-process step every
         caller (or the factory) must remember.
      3. **The security gain is marginal.** The hash allows exactly one
         byte-exact `<style>` whose text the app controls. Attacker-derived
         content is escaped Markdown (`html: false`) and cannot reproduce it.
         `style-src 'none'` vs `'sha256-…'` differ only for a style element
         with that exact text.
    - **Chosen: the hash.** It is deterministic (no timing), self-contained
      (one pure function emits the CSS and its hash from one string), and
      unit-provable. `insertCSS` becomes the fallback if a future need
      arises for CSS that the app does not control.
  - Rejected:
    - `'unsafe-inline'` (weaker for no gain).
    - `loadFile`/`file:` static windows (a second load path, and `'self'` is
      scheme-wide under `file:`, ADR-010 D3).
    - A custom `app://` protocol (disproportionate, already a backlog item).
    - A precomputed build-time hash (it could drift from the embedded text).
    - Leaving the windows unstyled (D1-b).
- **ADR-012 (proposed): third-party notices are generated by an in-repo,
  dependency-free script over the lockfile.**
  - Context: #173-#176; `mermaid` is a devDependency whose files ship.
  - Decision: this Step 1's closure, policy and override rules.
  - Rejected: `license-checker` (unmaintained, production filter drops
    Mermaid), `license-checker-rseidelsohn` / `generate-license-file` (same
    root model, plus a dependency), and bundler license plugins (we don't
    bundle Mermaid; we copy a prebuilt file).

The Lead writes both files as **Proposed** after approval. They are not in the
engineer's scope, and the Lead flips them at Step 3 (the ADR-010 precedent).

### In-scope files (proposed `current_scope.json` `in_scope`)

- `package.json` (the `build` script only: the `LICENSE` copy plus the generator step)
- `scripts/third-party-notices.mjs` (new)
- `build/third-party/overrides.json`, `build/third-party/khroma@2.1.0.txt`,
  `build/third-party/fastdom@1.0.12.txt`, `build/third-party/strictdom@1.0.1.txt` (new)
- `src/main/index.ts`, `src/main/menu.ts`, `src/main/helpWindow.ts`,
  `src/main/windowConfig.ts`, `src/main/paths.ts`
- `src/main/aboutWindow.ts`, `src/main/thirdPartyNotices.ts` (new)
- `tests/unit/menu.test.ts`, `tests/unit/buildHelpHtml.test.ts`
- `tests/unit/thirdPartyNotices.test.ts`, `tests/unit/aboutWindow.test.ts`,
  `tests/unit/staticWindowOptions.test.ts`, `tests/unit/staticPaths.test.ts` (new)
- `tests/integration/dist-about.test.ts` (new)
- `tests/e2e/about.spec.ts`, `tests/e2e/static-window-csp.spec.ts` (new)
- `.agents/specs/review_report_task46.md` (reviewer output)

Explicitly NOT touched:
- `package-lock.json` (no dependency change), `electron-builder.yml`,
  `LICENSE`, `CHANGELOG.md`, `README.md`, `src/main/help/help.md`.
- `src/renderer/**`: the main window, its CSP (#160) and `app.css` are
  unchanged. `.md-view-static` lives only in the shell's embedded CSS.
- `src/preload/**` (#179: no bridge or IPC change), `linkPolicy.ts`,
  `whatsNewWindow.ts`, `whatsNew.ts`.
- Every existing file under `tests/e2e/` and `tests/integration/`.

### Expected output format

New files: full content. Existing files: diff (targeted edits).

### Spec section this closes

`functional_domain.md` Task 46, guardrails #169-#179.

---

### Task 46: User approval conditions (binding on implementation and review)

The blueprint above was approved on 2026-09-26 subject to these conditions.
Where a condition and the blueprint disagree, the condition wins.

1. **D1-D4 approved as recommended:**
   - D1: embedded, hash-pinned stylesheet.
   - D2: nested `<details>` in About.
   - D3: no `'unsafe-inline'`, and the content guard.
   - D4: in-repo script, with no new dependency.
2. **Step 0 amended in place** (before any manifest existed):
   - The preamble now states what the packaged app ships (the 12 runtime
     license files, unreachable; the 113 Mermaid-bundled packages, no
     notice).
   - #175 names all three overrides, with fastdom's missing-`gitHead` and
     merge-commit evidence.
3. **ADR-011 weighs `webContents.insertCSS()`** against the hash and records
   why it lost (unstyled frame at `dom-ready`, measured; factory lifecycle
   change; styling leaves the document). The hash is chosen.
4. **New test (static-window styling), in Help, What's New and About:** the
   computed `font-family` of `.markdown-body` is **not the browser default**.
   - The default is **measured, not assumed.** The test reads the computed
     `font-family` of a `<p>` in an unstyled `data:` document, loaded in a
     hidden `BrowserWindow` it creates through `electronApp.evaluate`, and
     destroys that window afterwards.
   - It lives in `tests/e2e/static-window-csp.spec.ts`, beside the existing
     `max-width: 704px` check.
   - **Fault injection F14:** make the shell embed **no** CSS (an empty
     stylesheet string at the `index.ts` call site), `npm run build`, and all
     three windows' font test goes **red**. Revert with `git apply -R`.
5. **Pre-existing bug recorded (found at Step 1, present since Task 14):** the
   static windows (Help, and What's New since Task 43) were **never styled**.
   A `data:` document cannot load `file:` stylesheets (E1). This task fixes it
   through D1, and the test in condition 4 guards against regression. The
   review report and the run log must list it as a pre-existing defect found
   and fixed, not as a new regression.
6. **Backlog candidate, reported only:** `loadStaticHtml` swallows every load
   failure, not only close-aborts. It is **not** written to `backlog.md` in
   this task.
7. **Delegation rules:**
   - TDD Red-Green-Refactor with the 3-cycle cap.
   - `npm run build` before every e2e or dist RED/GREEN observation.
   - Reverts via a captured patch and `git apply -R` only.
   - The reviewer runs F1, F2, F6 and F14, **plus its own injections,
     including at least one not in this plan**, and ends with a
     `git status` backstop (the tree equals the implementation diff; no
     stray files).
   - **If a hook blocks a write: STOP and report. Never route around a hook
     via Bash.** (`enforce-scope`'s out-of-repo block is still unfixed.)
   - `asar` commands run **only with a temp directory as the cwd**.
   - The Lead stops before `/log-run`.
8. ADR-011 and ADR-012 are written by the Lead as **Proposed** before the
   manifest, stay out of the engineer's scope, and are flipped at Step 3.

---

## Task 47: Live-reload truncate race + e2e renderer-readiness race (Step 1)

Closes `functional_domain.md` Task 47, guardrails #180-#188. Branch
`feature/047-e2e-races` off `main` @ `38cb06b`. No stale `current_scope.json`
existed.

### Evidence this plan rests on (measured by the Lead; scratch probes only, repo unmodified)

**E1. H1 is confirmed in the code, chokidar 4.0.3.**
- `FSWatcher._emit` sends every `change` through
  `this._throttle('change', path, 50)` (`node_modules/chokidar/index.js:506`).
- `_throttle` (`:550-575`) is **leading-edge only**. A second call inside
  the 50 ms window only increments `count` and returns `false`. `clear()`
  then deletes the entry **without emitting** (no trailing edge).
- The raw fs listener adds its own 5 ms throttle (`handler.js:355`).
- `watcher.ts` uses `{ ignoreInitial: true }` with no `awaitWriteFinish`.
- `documentSession` re-reads the file with `fs.readFile` on every notified
  change.

**E2. H1 reproduces deterministically** (repo's chokidar, a scratch Node
harness mirroring `watcher.ts` + read-on-change):

| Writer behaviour | Current config: events / final render | `awaitWriteFinish {100, 20}`: events / final render |
|---|---|---|
| Truncate; after the truncate's `change` is delivered and read, write within 5-15 ms | 1 / **empty** (3/3) | 2 / correct (3/3); the first read comes after 107-135 ms and is empty because the file was stable-empty that long |
| Truncate + write 20 ms later | 1 / **empty** | 1 / correct (read at 134 ms) |
| Truncate + write 80 ms later | 2 / correct | 1 / correct (201 ms) |
| Truncate + write 150 / 300 ms later | n/a | 2 / correct |
| Plain `fsp.writeFile` (what `live-reload.spec.ts:28` does), 40 runs, idle machine | 1 event each; **0/40** empty | n/a |

The race needs the truncate to be delivered as its own notification
before the write lands. That essentially never happens on an idle machine,
but it is plausible under a loaded 2-worker e2e run. The observed failure
(`#content` EMPTY after an `fs.writeFile`) is exactly the E2 end state.

**E3. H2 reproduces deterministically** (3 of 3, real app, `main` build).
1. From main, `webContents.debugger` attaches and runs
   `Page.addScriptToEvaluateOnNewDocument({ source: 'debugger;' })`, then
   reloads. The renderer pauses **before any page script** runs.
2. While it is held, main clicks `menu-open` (stubbed dialog). A spy on
   `webContents.send` confirms that `md-view:file-rendered` (and
   `folder-tree-root`) were sent.
3. After resume, `#content` is `""` and the status bar reads "No file
   open", **while main believes a document is open** (`menu-close` is
   enabled).
4. The control run without the hold renders normally.

`ipcRenderer` messages with no registered listener are dropped.
`renderer.js` registers all receivers at the top level of a classic,
parser-inserted script at the end of `<body>`, so a document whose
`readyState` is `complete` has run it.

Two hold mechanisms did **not** work:
- A `Debugger.setBreakpointByUrl` on the sandboxed preload never resolved
  (0 locations, no pause).
- Pausing inside `renderer.js` cannot reproduce the race: IPC tasks cannot
  interleave within a running script.

The `debugger;` injection is the working hold.

**E4. `view-menu.spec.ts:189` is reproduced, not guessed.**
- In the running app, main's `fs/promises.writeFile` was patched to open the
  file, truncate it, wait 300 ms, then write. That widens the truncate gap
  of the production writer `settingsStore.writeSettingsFile`, a plain
  non-atomic `fs.writeFile`.
- The test's exact observation (poll until non-null, then re-read and
  `JSON.parse`) saw `""` as its first non-null value. It then threw exactly
  **`Unexpected end of JSON input`**. The file settled to the correct JSON
  afterwards.
- **Classification (evidence-based):** a same-class truncate-then-write
  race. The production writer is not atomic, and the test's "non-null"
  predicate accepts an empty file. The Task 41 backlog entry describes it
  correctly.
- `appStateStore.ts` already implements an atomic write (temp file plus
  `renameWithRetry`, ADR-009), which settings never adopted.

**E5. `close-document.spec.ts:221`: unconfirmed; no evidence exists yet.**
- The only observation is `electronApplication.evaluate: Target page,
  context or browser has been closed`: the Electron process ended
  mid-test. A different test failed in the reviewer's other run.
- Nothing in the test's code path explains a process exit. It stubs
  `Menu.buildFromTemplate`, pops the native File menu, and calls
  `closePopup()`.
- `playwright.config.ts` documents a **known** hard-crash class from
  Task 19: Windows fast-fail, exit code `3221226505`. It happened 2/12 at 4
  workers and 0/12 at 2. That is a *candidate* only: no exit code was
  captured.
- **Evidence is currently destroyed.** The fixture deletes the per-test
  `userDataDir`, which is where Crashpad would write dumps, and it discards
  the child's exit code and stderr.

This plan adds capture (D4). It does not propose a fix.

### Decisions for you

**D1 (H1 fix, #182): `awaitWriteFinish` (recommended) vs a trailing
re-read.**

| | `awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 }` | Trailing re-read in `watcher.ts` (re-emit `render` ~75 ms after each change) |
|---|---|---|
| #180 holds | Yes, in every E2 scenario | Yes (a re-read after the 50 ms window catches a swallowed write) |
| Latency to the first render after a save | **+~105-200 ms** (measured 107-201 ms vs ~2 ms) | none (leading render kept) |
| Transient wrong renders | Only if the file is *stably* empty or partial for ≥ 100 ms | **Yes:** a truncate-first writer flashes an empty preview until the trailing read |
| Work per save | 1 read and render typically; stat polling every 20 ms while settling | **2 reads and renders per save**, including a **full Mermaid diagram pass twice** (Task 45) |
| Code | One option on an existing library feature | New timer state in `watcher.ts` (arm, re-arm, clear on close) plus its own races |

Recommendation: `awaitWriteFinish`. The cost is about 0.1-0.2 s of extra
live-reload latency. In exchange, no blank flash and no duplicate Mermaid
passes. The unlink path is unaffected (`unlink` is not delayed, so the
error state still shows).

**D2 (H2 application, #183/#185): apply the helper in the shared fixture
(recommended) vs per test.**

`waitForRendererReady(page)` lives in the new file
`tests/e2e/support/rendererReady.ts`. It polls, with `.catch(() => false)`
for context teardown, until:

```js
location.pathname.endsWith('/renderer/index.html') && document.readyState === 'complete'
```

- The initial `about:blank` cannot satisfy it (URL clause).
- A held or not-yet-scripted document cannot satisfy it: `readyState`
  cannot reach `complete` before the parser-inserted `renderer.js` has run.
- `page.evaluate` blocks while the renderer is paused, so it cannot race the
  hold.

It is applied in two places:
- **once, in `support/fixtures.ts`**, before `use(app)`. That covers every
  test using the `electronApp` fixture, which is the large majority. My
  heuristic scan found 17 fixture tests (in `file-tree`, `help-menu` and
  `window-chrome`) that trigger main-side actions before any readiness
  wait. The fixture placement makes the list irrelevant.
- **explicitly, after `firstWindow()`,** at the 7 direct `electron.launch`
  sites: `tree-panel` ×2, `view-menu` ×3, `whats-new` ×1 and
  `window-chrome` ×1, plus any the engineer finds.

A structural check test (#185) scans `tests/e2e/*.spec.ts`: every file that
calls `electron.launch(` must call `waitForRendererReady` at least as many
times.

The alternative, per-test calls in about 110 tests, relies on a
hand-maintained list, which is the Task 46 lesson.

**D3 (`view-menu.spec.ts:189`): make `writeSettingsFile` atomic
(recommended) vs report-only.**
- Recommended: extract `appStateStore`'s existing temp-plus-`renameWithRetry`
  writer into a shared `src/main/atomicWriteFile.ts`, and use it in both
  stores. `appStateStore`'s behaviour and tests stay unchanged.
- The test's existing assertion is then valid as written: the file is never
  observable partially. It is the same bug class as H1, and a partial
  `settings.json` is also reachable in production (a focus-reread during a
  write, or an external reader).
- The deterministic RED uses a delayed `writeFile` (the E4 technique), in
  an integration test on `settingsStore`.
- Alternative: report only, leave `:189` flaky, and keep the backlog entry.
  The test itself is **not** loosened in either option (#186).

**D4 (`close-document.spec.ts:221`): capture evidence only (recommended).**
This is test-side diagnostics in `support/fixtures.ts`:
- record the child's `exit` code/signal (`app.process()`);
- tee its stderr;
- **on test failure only**, attach the code, signal, stderr tail, and a
  listing of `userDataDir/Crashpad` to the Playwright test info, before the
  directory is deleted.

No fix is attempted. If one of the done-criterion runs hits it, the report
states the captured code (for example `3221226505`, which is Task 19's
class). Otherwise it states "not reproduced in N runs; capture in place."

### Design

- **`src/main/watcher.ts` (D1):**
  `chokidar.watch(filePath, { ignoreInitial: true, awaitWriteFinish: WATCH_WRITE_FINISH })`
  with an exported constant `{ stabilityThreshold: 100, pollInterval: 20 }`
  and a comment citing E1/E2. `classifyWatchEvent` is unchanged.
- **`tests/e2e/support/rendererReady.ts`** (new, D2), the helper above.
  **`support/fixtures.ts`** calls it before `use(app)` and adds the D4
  capture.
- **D3:**
  - `src/main/atomicWriteFile.ts` (new): `writeFileAtomic(path, data)`,
    moved verbatim from `appStateStore.ts` (the same temp naming and
    `renameWithRetry`).
  - `appStateStore.ts` imports it.
  - `settingsStore.writeSettingsFile` uses it after its existing `mkdir`.

**SOLID/Clean:**
- H1 stays inside the infrastructure adapter (`watcher.ts`). The
  `documentSession` use case and its ports are unchanged, and its race rules
  are untouched.
- D3 is an extract-function refactor: one atomic-write policy, two adapters
  using it (DRY/SRP).
- The test helper is a single policy object for "renderer ready", reused
  by the fixture and the direct launches (SRP, no duplication).

GoF: none is forced. `awaitWriteFinish` is a library option, not a pattern.

### Test plan (TDD: RED is observed before any fix, 3-cycle cap)

**H1 (#180/#181).** `tests/integration/watcher.test.ts`, new case; existing
cases unmodified:
1. Truncate the watched file.
2. Wait, event-driven, for `watchFile`'s callback to fire.
3. **Immediately** write the final content, and record the delay since the
   callback. **Assert that the delay is under 40 ms** ("precondition not
   met" otherwise).
4. Poll up to 3 s for a callback **after** the write completed.

RED on today's code (E2: none arrives); GREEN with D1. A second case checks
that `unlink` still reports `error` promptly.

`live-reload.spec.ts:28` is unchanged, and serves as the e2e witness.

**H2 (#183/#184).** `tests/e2e/renderer-ready.spec.ts` (new):
- **(a) Hazard, the positive control for the hold:** hold the renderer
  (E3 technique); while it is held, trigger `menu-open` from main; resume.
  Assert `#content` stays empty and the status bar says "No file open".
  This proves the hold really is before the page scripts, so (b) means
  something.
- **(b) Gate:** hold, then start `waitForRendererReady`. Assert it has
  **not** resolved after 1 s while held. Resume, await it, trigger
  `menu-open`, and assert that the fixture heading renders.
  - RED first with the helper stubbed as a no-op (`resolved while held` =
    true).
  - GREEN with the real helper.
- **(c) Blank-document clause:** the helper does not resolve on
  `about:blank`.
- Structural check (#185): a unit test in `tests/unit/e2eReadiness.test.ts`
  (new) scans `tests/e2e/*.spec.ts` for `electron.launch(` versus
  `waitForRendererReady` call counts.

**D3.** `tests/integration/settingsStore.test.ts`, new case:
- With `node:fs/promises.writeFile` mocked to truncate, wait 200 ms, then
  write, a concurrent reader polling `settings.json` never observes `''` or
  unparsable content.
- RED on today's writer; GREEN with atomic. `appStateStore.test.ts` passes
  unmodified.

**Done criterion (#188).** 3 consecutive full runs, each after
`rm -rf dist && npm run build`: `npm run test:unit`,
`npm run test:integration` and `npx playwright test` (config `workers: 2`,
no retries). All must be green. Any failure resets the count, and is
reported with the D4 capture.

### Fault-injection plan

The reviewer runs F1, F2, F4 and F6, plus its own, at least one new.
Reverts use a captured patch and `git -c core.autocrlf=false apply -R`
plus `cmp` (Task 46 N6). `npm run build` precedes every e2e observation.

| # | Fault | Must go red |
|---|---|---|
| F1 | Remove `awaitWriteFinish` from `watcher.ts` | H1 integration case |
| F2 | Make `waitForRendererReady` a no-op | `renderer-ready.spec.ts` (b) |
| F3 | Drop the URL clause (readyState only) | (c) blank-document case |
| F4 | Remove one direct-launch helper call (e.g. `view-menu` (d)) | structural check test |
| F5 | Delay the H1 test's write by 200 ms | the H1 case fails with "precondition not met" (proves it cannot pass vacuously) |
| F6 | `writeSettingsFile` back to plain `fs.writeFile` | D3 integration case |
| F7 | Remove the hold from (a) | (a) goes red (the render arrives), proving (a) depends on the hold |

### In-scope files (proposed `current_scope.json`)

**Production:**
- `src/main/watcher.ts`
- `src/main/atomicWriteFile.ts` (new, D3)
- `src/main/appStateStore.ts` (D3, import only)
- `src/main/settingsStore.ts` (D3)

**Test support:**
- `tests/e2e/support/rendererReady.ts` (new)
- `tests/e2e/support/fixtures.ts` (the helper call plus the D4 capture)

**Tests:**
- `tests/integration/watcher.test.ts` (new case only)
- `tests/integration/settingsStore.test.ts` (new case only)
- `tests/e2e/renderer-ready.spec.ts` (new)
- `tests/unit/e2eReadiness.test.ts` (new)
- Direct-launch specs, **limited to inserting
  `await waitForRendererReady(window)` after `firstWindow()` plus its
  import**, with no other change:
  - `tests/e2e/tree-panel.spec.ts`
  - `tests/e2e/view-menu.spec.ts`
  - `tests/e2e/whats-new.spec.ts`
  - `tests/e2e/window-chrome.spec.ts`

  The list comes from `grep -rn "electron.launch(" tests/e2e`, per the
  Task 46 menu-ID lesson. The engineer re-greps and reports any extra hit
  as a scope amendment.

**Reviewer output:** `.agents/specs/review_report_task47.md`.

**Not touched:**
- `src/renderer/**` and `src/preload/**`.
- `documentSession.ts` and `index.ts`.
- `playwright.config.ts` (no retries or workers change, #186).
- `live-reload.spec.ts`, `file-tree.spec.ts` and `close-document.spec.ts`,
  which stay byte-identical: the fixture covers them.
- All other existing tests.

### Merge sequencing and the Task 46 follow-up

After this task merges:
1. Rebase `feature/046` onto `main`. The `functional_domain.md`,
   `initial_scaffold.md`, `backlog.md` and `RUN_LOG.md` appends will
   conflict at file end: keep both sections, Task 46 before Task 47.
2. Task 46's new e2e specs use the fixture, so they inherit readiness.
   `about.spec.ts` and `static-window-csp.spec.ts` contain no direct
   `electron.launch`.
3. Re-run the #188 criterion on the rebased 046.
4. Append the Task 46 RUN_LOG correction note (the row said "passed with
   known flakes"; that was wrong). It is appended, not edited.

### Spec section this closes

`functional_domain.md` Task 47, guardrails #180-#188.

---

### Task 47: User approval conditions (binding on implementation and review)

The blueprint above was approved on 2026-09-27 subject to these conditions.
Where a condition and the blueprint disagree, the condition wins.

1. **D1 approved:** `awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 }`.

   **Condition: Close during a pending write-finish check produces no
   `FILE_RENDERED`; #147/#148 still hold.**

   *Lead's evidence for why this is load-bearing:*
   - chokidar 4.0.3's `close()` does **not** cancel pending
     `awaitWriteFinish` polls (`_pendingWrites` and their `setTimeout`
     survive; `index.js:394-421`, `:600-635`). It only
     `removeAllListeners()`, so a later `awfEmit` finds no listener.
   - `documentSlot.beginRender()` returns the **current** epoch. A watcher
     callback that fired after Close would therefore start a render that
     `tryDeliver` accepts, which re-occupies the slot (resurrection).
   - The only barrier is "the watcher never calls back after `close()`".

   *Required tests:*
   - (a) `tests/integration/watcher.test.ts`: write, then `close()` the
     `watchFile` handle **inside** the 100 ms window. Assert the precondition
     (close happened < 60 ms after the write), then wait 500 ms: **zero**
     callbacks.
   - (b) `tests/e2e/close-pending-reload.spec.ts` (new):
     1. Open a file and wait until it renders.
     2. Count `FILE_RENDERED` in main with a `webContents.send` spy.
     3. Write new content, then Close via `menu-close` inside the window
        (assert the precondition).
     4. After 1 s: **no** `FILE_RENDERED` after the Close, the pristine view
        (`expectPristineDocumentView`), and `menu-close` disabled.

   *Fault injection **F8**:* make `watchFile`'s close deferred (e.g. the
   returned handle's `close` runs `setTimeout(() => watcher.close(), 500)`).
   Both (a) and (b) must go **red**; revert.

   `live-reload.spec.ts` "shows a visible error state when the open file is
   deleted" stays **unmodified and green**.
2. **D2 approved.** `functional_domain.md` Task 47 records the production
   analogue of H2 as an **accepted limitation**: argv waits for
   `did-finish-load`, and there is no `second-instance`/`open-file` path.
3. **D3 approved.** **Condition: rename failure while another program holds
   `settings.json` open** (File > Settings opens it in the user's editor).
   - *Lead's evidence (probe):* on Windows, **any** open handle on the target
     makes `rename(temp, target)` fail with **`EPERM`**. That includes a plain
     Node `fs.openSync(target, 'r')`, and .NET handles with `FileShare.Read`
     and `FileShare.ReadWrite`. It succeeds after release.
   - *Disclosed trade-off:* today's non-atomic `writeFile` usually succeeds
     while the file is held; the atomic rename does not.
   - *Defined behavior:*
     - A **short retry**: the existing `renameWithRetry` (6 attempts,
       backoff 10·attempt ms, about 150 ms of waits in total).
     - Then **containment**: `console.warn` with the path and code, delete
       the temp file, and **keep the in-memory settings** (the View state
       and menu checkmarks stay as toggled).
     - **Never crash**, and no unhandled rejection.
     - The next successful write persists the full object (#106).
     - A startup self-heal write (`loadSettingsAtStartup` on a corrupt
       file) that fails is contained too: the app boots with defaults
       (#108).
     - `ensureSettingsFileExists` (File > Settings) is contained the same
       way.
   - *Placement:* `settingsStore` stays a throwing adapter for
     `writeSettingsFile`. Containment happens at the callers:
     `index.ts` `persistCurrentViewSettings`/`onOpenSettings`, and inside
     `loadSettingsAtStartup` for its self-heal write. `index.ts` is added
     to scope for exactly this.
   - *Required tests:*
     - (c) Integration (`settingsStore.test.ts`): holding `fs.openSync`
       on the target makes `writeSettingsFile` reject with `EPERM` after the
       retries, leaves the target content unchanged, and leaves no `*.tmp`.
       Releasing the handle mid-retry (after about 30 ms) succeeds.
     - (d) Integration: a corrupt `settings.json` held open makes
       `loadSettingsAtStartup` resolve to defaults and not throw.
     - (e) E2E (`tests/e2e/settings-locked.spec.ts`, new):
       1. The test holds `settings.json` open.
       2. Toggling Dark Mode leaves the app alive, the menu checked and the
          renderer dark, with a warning captured from main.
       3. No `pageerror` and no process exit occur.
       4. After releasing the handle, toggling Show Frontmatter writes the
          full object including `Dark Mode: true`.
   - *Fault injection **F9**:* remove the containment `catch` in
     `persistCurrentViewSettings`. (e) must go red: an unhandled rejection
     is observed through a main-side `process.on('unhandledRejection')`
     probe the test installs.
4. **D4 approved: capture only, active only on failure, and it must never
   change a test's pass/fail.**
   - The capture code is wrapped so any error inside it is swallowed
     (logged).
   - It runs in fixture teardown only when `testInfo.status !== testInfo.expectedStatus`.
   - It never throws, never waits more than 2 s, and never alters the
     result.
   - *Test:* a unit test of the pure formatter, plus reviewer
     verification. *Fault injection **F10**:* make the capture throw, and
     the suite result is unchanged.
5. **Rules:**
   - TDD, 3-cycle cap, RED before GREEN, with `npm run build` before every
     e2e RED.
   - Reverts use `git -c core.autocrlf=false apply -R` plus `cmp`.
   - The reviewer adds its own injections, at least one new, and ends with
     the `git status` backstop.
   - Stop on any hook block.
   - Temp files go **outside the repo and are removed afterwards**.
   - **Done = 3 consecutive green full runs** (clean `dist/`, 2 workers, no
     retries).
   - The Lead stops before `/log-run`.

**In-scope additions** from these conditions:
- `src/main/index.ts` (containment only);
- `tests/e2e/close-pending-reload.spec.ts` (new);
- `tests/e2e/settings-locked.spec.ts` (new);
- `tests/unit/failureCapture.test.ts` (new, D4 formatter);
- `tests/e2e/support/failureCapture.ts` (new, D4).

---

## Task 48: v1.2.0 release documentation (Step 1)

No architectural impact: no runtime code, no layer boundary, no interface,
no GoF pattern applicable (Task 42 precedent). The inward-dependency rule is
unaffected; the only `src/` file touched is the `help.md` data file (#195).
Guardrails are #189-#195 (Task 47 already used #188).

### Changes

1. `CHANGELOG.md`: insert `## [1.2.0] - 2026-09-28` (amended at Task 48
   review: release date), the planned tag date, above `## [1.1.0]`, with `### Added`,
   `### Changed`, `### Fixed`, `### Security` in Keep a Changelog style,
   matching the 1.1.0 entries' voice. No other section touched (#189, #191).
2. `src/main/help/help.md`: a Close subsection (or an addition to "Opening a
   file"), a Mermaid diagrams section (prose only, no mermaid fence), an
   About/notices line, a `Ctrl/Cmd+W | Close the open file` row in the
   existing unaligned shortcut table (`|---|---|`), and one sentence in
   "Live reload" if its wording contradicts the save-finished wait (#192).
3. `README.md`: status line → v1.2.0; feature list (Close, Mermaid, About +
   notices); stack (Mermaid 11.17.2, copied into `dist/` at build time);
   security invariants (main-window CSP + locked Mermaid config; no-script
   CSP for Help/What's New/About); license section (third-party notices
   ship in-app) (#194).
4. `package.json` `version` and `package-lock.json` lines 3 and 9 →
   `1.2.0`, by hand. The other `"version": "1.1.0"` hits in the lockfile
   (console-control-strings etc.) are dependencies and stay (#193).

### Who writes

`technical-writer` subagent, all five files, targeted diffs (not
rewrites). It receives this section, the Task 48 Step 0 text and the trace
table below; it cites a trace for every line it writes. It does not run
tests or git. The Lead runs the gate (#195); the `code-reviewer` verifies.

### Verification plan for #190 (claim → code / test)

| Claim | Code | Test |
|---|---|---|
| File → Close, `Ctrl/Cmd+W` | `src/main/menu.ts:37-43` | `tests/unit/menu.test.ts:51`; `tests/e2e/close-document.spec.ts:191` |
| Close disabled when nothing is open | `menu.ts:41` (`enabled: documentOpen`) | `menu.test.ts:55`; `close-document.spec.ts:131`, `:343` |
| Close returns to the no-file view, keeps the tree (and dark mode, Code tab) | `src/main/index.ts` onClose, `documentSlot.ts` | `close-document.spec.ts:148` |
| Mermaid fences render as diagrams | `src/renderer/diagrams.js` | `tests/e2e/mermaid.spec.ts:200`, `:211` |
| Diagrams follow Dark Mode | `diagrams.js` theme select | `tests/unit/diagrams.test.ts:142`; `mermaid.spec.ts:505` |
| Invalid/oversized diagram: notice + source, rest unaffected | `diagrams.js` (maxTextSize, showFailure) | `diagrams.test.ts:194`, `:225`; `mermaid.spec.ts:381`, `:397`, `:412` |
| Theme/security settings inside a diagram ignored | `diagrams.js` locked config | `diagrams.test.ts:100`, `:115`; `mermaid.spec.ts:286`, `:315`, `:332`, `:362` |
| Code tab and copy-raw-source unchanged | — | `mermaid.spec.ts:802` |
| About: version, runtimes, copyright, license, repo link | `src/main/aboutWindow.ts:79-90` | `tests/e2e/about.spec.ts:91`, `:228` |
| About: third-party license notices | `scripts/third-party-notices.mjs`, `thirdPartyNotices.ts` | `about.spec.ts:273`; `tests/integration/dist-about.test.ts:96-132` |
| Live reload waits for the save to finish (~100-200 ms) | `src/main/watcher.ts:24` (`stabilityThreshold: 100, pollInterval: 20`) | `tests/integration/watcher.test.ts:93` |
| Fixed: blank preview after a truncating save | `watcher.ts:16-30` | `watcher.test.ts:93` |
| Fixed: `settings.json` written atomically | `src/main/atomicWriteFile.ts`, `settingsStore.ts:5-7` | `tests/integration/settingsStore.test.ts`; `tests/e2e/settings-locked.spec.ts` |
| Fixed: Help/What's New now styled | `src/main/helpWindow.ts:40-52` | `tests/e2e/static-window-csp.spec.ts:169`, `:197` ("styled") |
| Main-window CSP: no inline/eval script, no network | `src/renderer/index.html:5` | `tests/e2e/csp.spec.ts:43`, `:77`, `:109`; `mermaid.spec.ts:434` |
| No-script CSP for Help/What's New/About | `helpWindow.ts:50` (`buildStaticWindowCsp`) | `static-window-csp.spec.ts:169`, `:182`, `:197` |
| Notices ship with the app | `package.json` build → `third-party-notices.mjs` | `dist-about.test.ts:100` |
| README: Mermaid 11.17.2 | `package.json:56` | — (reviewer reads it) |

The reviewer re-opens each cited line, not this table's paraphrase; a row
that does not hold removes or corrects the claim (#190). A claim the writer
adds that is not in the table needs its own trace in the review report.

### Gate (#191, #192, #195)

- `git diff --stat` shows exactly the five in-scope files; `git diff --
  src/` touches only `help.md`; the lockfile diff is two lines.
- Reviewer reads the full CHANGELOG and help.md diffs **and** the resulting
  files; greps both for `Task`, `#[0-9]`, `ADR`, `guardrail`, `reviewer`,
  `agent`, `spec`, `.agents`, `src/`, `tests/` (#189); confirms no line
  in the 1.2.0 section starts with `## [` and the heading regex matches
  (#191); confirms no `:--`/`--:` alignment, no raw HTML, no mermaid fence
  in help.md (#192).
- `npm run build`, `npm run test:unit`, `npm run test:integration`
  (`dist-changelog.test.ts:28` proves the 1.2.0 section is found;
  `dist-about.test.ts:207` is the D3 help.md check), then one full
  `test:e2e` from a clean `dist/` (`whats-new.spec.ts:104`,
  `help-menu.spec.ts`, `static-window-csp.spec.ts`). A failure only on
  `close-document:221` with the native-abort signature follows the Task 46
  gate rule.
- No TDD loop: no testable logic (docs-task exemption, Task 42).

### In-scope files

- `CHANGELOG.md`
- `src/main/help/help.md`
- `README.md`
- `package.json`
- `package-lock.json`

### Expected output format

Diff (targeted edits), not full rewrites.

### Spec section this closes

`functional_domain.md` Task 48 section, guardrails #189-#195.

---

## Task 49: Copy text (selection, Copy All, context menu; diagrams copy their source) (Step 1)

Closes `functional_domain.md` Task 49, guardrails #196-#203. Branch:
`feature/049-copy-text` (off `main` @ `d3edd79`).

### Evidence this plan rests on (measured, not assumed)

Five throwaway Playwright probes ran against the built app (`npm run build`,
then a temp `tests/e2e/_zzz-copy-probe*.spec.ts` deleted immediately after —
no probe file is part of this diff or this branch). Each opened a real
document, made a real DOM selection inside `#content`, and read the real OS
clipboard (`electronApp.evaluate(({ clipboard }) => …)`), the same posture
Task 34's #98 and this task's #196 require.

| Probe | Result |
|---|---|
| `Ctrl+C` with a non-editable selection in `#content`, no app code involved (no accelerator on this channel, no `role: 'copy'` menu item — `menu.ts` has no Edit menu) | **Already copies today.** `clipboard.readText()` returns the selected plain text, and `clipboard.has('text/html')` is `true` immediately after. This is Chromium's own default handling of the `copy` edit command on a selection — it does not go through `Menu.setApplicationMenu()`'s accelerator table (which only carries File/View/Help) and it does not go through `ipcMain`/`main`'s `clipboard` module at all. |
| A `document.addEventListener('copy', e => { e.preventDefault(); e.clipboardData.setData(...) })` registered in the renderer, then `Ctrl+C` | The listener fires and **its** payload lands on the OS clipboard instead of the default one. App JS can fully override what a real `Ctrl+C` writes, still with zero IPC. |
| `BrowserWindow.webContents.copy()` (called from `main`, the same primitive behind `role: 'copy'`) against the same live selection, same listener installed | Same result: the listener fires, its payload wins. A menu-triggered Copy is indistinguishable from `Ctrl+C` from the renderer's point of view. |
| `document.execCommand('copy')` called from renderer JS itself (no live keyboard event) against a Range selected programmatically, same listener installed | Same result: `execCommand` returns `true`, the listener fires, its payload wins. |
| `navigator.clipboard.write([new ClipboardItem({'text/plain': …, 'text/html': …})])` (the async Web Clipboard API — distinct from both `execCommand` and Electron's `clipboard` module) called from renderer JS with **no** prior selection and **no** `copy` event in play | Works with no permission prompt (this app sets no `session.setPermissionRequestHandler`), writes both formats to the real OS clipboard, and `window.getSelection().toString()` is `""` both before and after — nothing about the visible selection changes. |

Consequence: the `copy` `ClipboardEvent` — however it is triggered — is a
renderer-side interception point that writes to the real OS clipboard without
crossing into `main`, and separately, `navigator.clipboard.write()` is a
*second*, independent renderer-side write path that needs no selection and
no event at all. Together these are the single most load-bearing facts in
this plan (see ADR-013, D2 resolved below); the engineer's first TDD cycle
should re-pin both with real (non-throwaway) e2e tests before anything else
is built on top of them.

### Where #164's diagram source lives today, and how #199 reuses it

Today (`src/renderer/diagrams.js`): `createDiagramDomView.collectSlots()`
reads `code.textContent` out of each `.md-view-diagram` wrapper's `<code>`
child **once**, at `documentRendered()` time (line ~244), and returns it
inside a `{ source, showSvg, showFailure }` slot object. `createDiagramController`
closes over the resulting `slots` array. `darkModeChanged()` (#164) does
**not** re-collect from the DOM — it reuses that same closed-over `slots`
array, because by the time a theme change happens, `showSvg` has already
replaced the wrapper's children with SVG, so the `<code>` element (and the
DOM's only copy of the source) may already be gone.

That closure is invisible outside `diagrams.js`/the controller — a right-click
handler or a selection-serializer living in `renderer.js`/a new `copy.js`
has no way to reach it, and adding a second, independently-maintained map
from wrapper → source (e.g. a `WeakMap` built by the copy feature by
re-reading `code.textContent` on its own) is exactly the "second copy that
can drift" #199 forbids: it would only be correct before the first render,
and silently wrong (empty, or stale) after.

**Recommendation:** extend the *existing* capture, don't add a parallel one.
In `collectSlots()`, at the exact line that already reads `source` from
`code.textContent`, also write `wrapper.dataset.mdviewSource = source`. This
piggybacks on #164's own capture point, costs nothing extra, and gives every
consumer (the copy feature, and anything else that shows up later) a single
DOM-anchored source of truth that:
- exists before the render pass starts (so a right-click on a still-rendering
  diagram already has it — closes part of #198),
- survives `showSvg` (only children are replaced, never the wrapper's own
  attributes) and `showFailure` (same),
- needs no new export from `diagrams.js` and no change to `#164`'s own
  reuse-the-closure behavior, which stays exactly as it is.

`darkModeChanged()` itself is untouched — this is additive, not a
replacement of its existing mechanism.

### Ctrl+C today, and Ctrl/Cmd+A

Verified above: plain `Ctrl+C` on a `#content`/`#code-content` selection
already round-trips through the real OS clipboard today, natively, with both
`text/plain` and `text/html` populated, and with zero lines of app code.
Nothing about this app's frameless-window/custom-title-bar setup
(`frame: false`, no visible native menu bar, `Menu.setApplicationMenu()`
carrying only File/View/Help) disables Chromium's own default `copy` command
handling for a non-editable selection — that handling lives below the
Electron accelerator table, in Blink's own edit-command resolution, and it
doesn't care whether an `Edit` menu exists.

`Ctrl/Cmd+A` was not probed (#200 says it's not required by Step 0) — flagged
here only as a fact worth one line in Step 2's task: it almost certainly
already does *something* today (native "select all" inside whichever pane has
focus), and that existing behavior must not regress, but building it out as
the keyboard form of Copy All stays explicitly out of scope for this task.

### Decisions

**D1. Diagram source storage: `wrapper.dataset.mdviewSource`. Approved as
drafted.** Covered above. Alternative rejected: a `WeakMap<wrapper, source>`
populated by the copy feature itself — rejected as the second, driftable
copy #199 warns against.

**D2. Native interception vs. a bridge-mediated write. Resolved: Option A,
refined at Step 1 review. See ADR-013 (Proposed) for the full record.**

Approved shape (supersedes the two sub-options originally drafted here):

- **Physical `Ctrl+C` / any real `copy` gesture, scoped to `#content` and
  `#code-content` only** (review condition: everywhere else — title bar,
  tree panel, status bar — keeps the unmodified browser default; this is
  now an explicit scope check in the handler, not just a consequence of
  where diagrams happen to live). One
  `document.addEventListener('copy', handler)`. No diagram in the
  selection: `handler` returns without calling `preventDefault()`, and
  Chromium's own default — already proven correct above — writes both
  formats, for free. A diagram is in the selection: `handler` calls
  `preventDefault()` and builds `{ text, html }` itself (D3), then
  `event.clipboardData.setData('text/plain', text)` /
  `.setData('text/html', html)`.
- **Menu-triggered Copy and Copy All: `navigator.clipboard.write()`, not
  `execCommand`/`webContents.copy()`.** `main` sends a content-free,
  fire-and-forget IPC naming only the action (`'copy'` or `'copy-all'`). The
  renderer already knows the target — the live selection (Copy) or the
  whole visible pane (Copy All, D4) — builds `{ text, html }` with the same
  D3 function, and writes it directly via
  `navigator.clipboard.write([new ClipboardItem({ 'text/plain': new
  Blob([text]), 'text/html': new Blob([html]) })])`. No selection is moved
  to make this work (review condition 2), and no deprecated API is called.
  A right-click directly on a diagram (no pre-existing text selection) no
  longer needs `window.getSelection().selectAllChildren(wrapper)` either —
  the `contextmenu` handler just remembers the classified target for the
  menu-click IPC to consume (see the context-menu section below, revised).
- **`execCommand('copy')` is not used anywhere in the approved design.** It
  was proven to work (evidence table above) but is rejected per review
  condition 2 now that a Copy-All path exists that needs neither
  `execCommand` nor a moved selection. ADR-013 keeps it on record as the
  documented fallback if `navigator.clipboard.write()` ever regresses (a
  pinned-Electron risk the ADR carries explicitly, caught by e2e tests
  reading the real clipboard, not silently).
- **`webContents.copy()` is not used for menu-triggered actions.** It stays
  correct in principle (evidence table above) but is unnecessary once
  Copy/Copy All don't need a native command dispatch at all; using it only
  for Copy while Copy All uses `navigator.clipboard.write()` would be two
  mechanisms doing the same job for no reason.
- **Result for #202** (amended in `functional_domain.md` at this review):
  no new bridge method carries `text` or `html`, ever. The bridge grows by
  one renderer→main descriptor (`popupCopyMenu`) and one main→renderer
  action-name push — both covered in the bridge section below.
  `copyRawSource` (#101) is unaffected and unchanged: it exists because a
  plain button click has no `copy` gesture to intercept and no way to reach
  `navigator.clipboard` from... actually it *could* reach
  `navigator.clipboard` too, but that's a separate, out-of-scope
  refactor of already-shipped, already-tested code — #203 keeps it as-is.
- **New invariant (review condition 3): the copied `html` never contains an
  internal attribute.** D3's diagram substitution builds a *fresh*
  `<pre><code>` element holding only the escaped source text — never the
  original `.md-view-diagram` wrapper's `outerHTML` with children swapped,
  which would leak `data-mdview-source` (and `class="md-view-diagram"`,
  `data-diagram="mermaid"`) into whatever the user pastes elsewhere.
- **New fault injection (review condition 3):** remove the `copy` event
  handler entirely (not just its `preventDefault()` call) — the
  `Ctrl+C`-over-a-diagram e2e case must go red, and specifically the
  clipboard must contain the diagram's rendered SVG label text instead of
  its source (a stronger, more direct assertion than F1 below, which only
  removes `preventDefault()`; both faults are kept, they catch different
  regressions).

**D3. Diagram-substitution serialization. Approved as drafted.** Cloning `Range.cloneContents()`,
replacing each `.md-view-diagram` node in the clone with
`<pre><code>{escaped wrapper.dataset.mdviewSource}</code></pre>`, mounting
the mutated clone in an off-screen-but-laid-out container
(`position: fixed; left: -99999px`, not `display: none` — `innerText` needs
layout), then reading `container.innerHTML` for `html` and
`container.innerText` for `text` (not `.textContent`, which collapses block
boundaries and would run headings/paragraphs together — `innerText`
approximates rendered line breaks the same way a real "select and copy" in a
browser does). This needs the engineer's first TDD cycle to pin exact
whitespace/blank-line behavior against real fixtures (multi-paragraph text
around a diagram, a diagram as the very first/last node, two adjacent
diagrams) before it's trusted — flagged as an estimate, not a proof, unlike
the four probes above.

**D4. Copy All target element. Approved as drafted.** Preview: a synthetic Range spanning
`#frontmatter` (only when `!frontmatter.hidden`) followed by `#content` —
this falls out of the existing DOM structure for free (`#frontmatter` is a
real `hidden`-attribute sibling inside `#document-main`, excluded from
selection/copy whenever it's hidden, with no new visibility logic needed) and
satisfies #197 exactly. Code: `codeContentEl.textContent` directly,
byte-identical to `copyRawSource`'s existing payload — no Range, no `copy`
event, just the same string the existing button already sends over
`copyRawSource` (#98-#101), consistent with #197's "byte-identical" wording.
Note: `#frontmatter`'s visibility is independent of which tab is active
(existing, unrelated behavior — it can show above the Code tab too when
toggled on); #197 does not ask Code-tab Copy All to account for that, so it
doesn't.

### Context menu: how it's built, and how `main` learns the copy target

Same posture as #67/`buildMenuTemplate`: one small template function,
e.g. `buildCopyMenuTemplate(handlers, target)` in `menu.ts` (or a sibling
file if that keeps `menu.ts` focused — engineer's call), returning
`[{ id: 'menu-copy', label: 'Copy', enabled, click }, { id: 'menu-copy-all',
label: 'Copy All', enabled, click }]`, popped via
`Menu.buildFromTemplate(...).popup({ window, x, y })` — the exact pattern
`POPUP_MENU`'s handler (`index.ts:669-677`) already uses for the File/View/Help
sections.

`main` learns the target from a new `'contextmenu'` listener added in the
renderer (there is none today over the document area — the existing
`popupMenu` calls are click handlers on the three title-bar labels, not a
right-click handler), attached only to `#content` and `#code-content` (so a
right-click outside the document area never fires it at all — #201's "only
over the document area" falls out of where the listener is attached, not a
runtime check). On `contextmenu`, the renderer classifies `event.target`
(inside a `.md-view-diagram` wrapper → `'diagram'`; inside `#content`/
`#code-content` with `!window.getSelection().isCollapsed` → `'selection'`;
otherwise `'none'`) and **remembers that classification** (which wrapper, or
"use the live selection") for the menu-click IPC below to consume — it does
**not** mutate `window.getSelection()` (D2's revised design: neither Copy
nor Copy All needs a live selection to work). `main` never needs to know
*which* diagram; it only needs enough to gate `enabled` (#201): a 2-field
descriptor, `{ hasCopyTarget: boolean, documentOpen: boolean }`, sent as the
payload of a new `mdview.popupCopyMenu(target, x, y)` bridge call (own
method, not a fourth value shoehorned into the existing
`popupMenu('file'|'view'|'help', …)` signature, since the shapes genuinely
differ).

`menu-copy`'s and `menu-copy-all`'s `click` handlers in `main` do the exact
same thing: send a content-free, fire-and-forget IPC naming the action
(`mdview.onCopyCommand(callback)` on the renderer side, payload
`'copy' | 'copy-all'`). `main` never calls `webContents.copy()` and never
constructs or inspects `text`/`html`. The renderer's handler for that IPC
reads back its remembered `contextmenu` classification (for `'copy'`) or
runs D4's Range-over-the-whole-pane logic (for `'copy-all'`), builds the
payload with the same D3 function the `copy`-event path uses, and writes it
with `navigator.clipboard.write()`.

### The bridge change (#202, amended)

Resolved (D2/ADR-013): the bridge grows by exactly two members, and neither
carries clipboard content:

```ts
// renderer -> main, fire-and-forget (mirrors popupMenu's existing shape)
popupCopyMenu(target: { hasCopyTarget: boolean; documentOpen: boolean }, x: number, y: number): void;

// main -> renderer push, fire-and-forget (mirrors onDocumentClosed's zero/near-zero payload style)
onCopyCommand(callback: (action: 'copy' | 'copy-all') => void): void;
```

No `copyPayload`/`{text, html}` method exists in the approved design — there
is nothing for `main` to validate or size-cap, because nothing crosses into
`main`. (Kept on record in ADR-013 as the fallback if the
`navigator.clipboard.write()` risk it names ever materializes: a
`copyPayload(text: string, html: string): Promise<boolean>` mirroring
`copyRawSource`'s exact shape, with `main` validating both are strings and
size-capping before `clipboard.write({ text, html })` — not built now.)

Unchanged: `contextIsolation`, `sandbox`, `nodeIntegration: false`,
`html: false`, both CSPs, and `copyRawSource` itself.

### Test plan

- **Unit** (`tests/unit/copy.test.ts`, new — pure functions only, no DOM):
  the diagram-substitution predicate, the escaping used inside the
  substituted `<pre><code>`, and (mirroring `diagrams.test.ts`'s style) any
  pure target-classification logic factored out of the `contextmenu`
  handler.
- **Integration** (`tests/integration/preload-api-contract.test.ts`,
  extended): the new bridge method(s) exist, are the right shape, and (Task
  34's honest-limitation posture) prove runtime callability, not the
  `BridgeApi` type itself.
- **e2e, real OS clipboard only** (`tests/e2e/copy-text.spec.ts`, new; same
  `electronApp.evaluate(({ clipboard }) => …)` posture as #98, reading both
  `clipboard.readText()` and `clipboard.read('text/html')` — note
  `clipboard.readHTML()` does not exist on this Electron's `clipboard`
  object, confirmed by probe; the own-property list is `clear, has, readText,
  writeText, read, write`):
  - #196: select plain text, `Ctrl+C`, both formats correct.
  - #197: Copy All in Preview with frontmatter shown/hidden; Copy All in
    Code, byte-identical to `copyRawSource`'s existing assertion. Also
    asserts `window.getSelection().toString()` is unchanged before/after
    Copy All (review condition 2: no visible-selection side effect).
  - #198: right-click a rendering/failed/succeeded diagram; a selection
    spanning text+diagram+text; Copy All over a document with two diagrams —
    `text` contains the fence body verbatim and contains no `<svg`/`<path`.
    Also asserts the copied `html` contains no `data-mdview-source`,
    `data-diagram` or `class="md-view-diagram"` (review condition 3: no
    internal attribute leaks into what the user pastes).
  - #199: same diagram, before first render (mid-pass), after render, after
    a Dark Mode toggle, after a forced failure — right-click copy returns the
    identical source every time.
  - #200: `Ctrl+C` parity with menu Copy on the same selection, same payload.
  - #201: no file open → both disabled; error shown → both disabled; no
    selection, no diagram under cursor → Copy disabled, Copy All still
    enabled; right-click on title bar/tree/status bar → no document menu
    appears (the `contextmenu` listener is scoped to `#content`/
    `#code-content`, review condition 3 — assert directly, not just via
    absence of a menu).
  - #202 (amended): `contextIsolation`/`sandbox`/CSP assertions unchanged
    (reuse `csp.spec.ts`'s existing canaries, don't duplicate them); assert
    the `popupCopyMenu` payload and the `onCopyCommand` callback argument
    never contain `text`/`html` fields (assert the method/callback
    signatures via the integration test above, not a runtime grep).
  - #203: `copyRawSource`'s existing three e2e assertions (`ui-shell.spec.ts`,
    `mermaid.spec.ts:802`) stay green unmodified.

### Fault injection

| # | Injected fault | Must go red |
|---|---|---|
| F1 | Remove the `preventDefault()` call for the diagram-containing branch, but leave the handler registered | #198's spanning-selection and right-click-diagram e2e cases (native copy fires *after* the handler's `setData`, and Chromium's default overwrites it with the SVG's rendered text) |
| F2 | Drop the `wrapper.dataset.mdviewSource` write from `collectSlots()` (revert D1) | #199's after-first-render and after-Dark-Mode-toggle cases |
| F3 | Use `.textContent` instead of `.innerText` when building the Copy-All/diagram-spanning `text` | a fixture with two adjacent paragraphs around a diagram — text runs together with no line break |
| F4 | Skip the `#frontmatter` `.hidden` check in Copy All (always include it) | #197's "without the frontmatter block when it is hidden" case |
| F5 | `menu-copy`'s `enabled` ignores the target descriptor (always `true`) | #201's "no selection, no diagram" disabled case |
| F6 (review condition 3) | Remove the `document.addEventListener('copy', handler)` registration entirely (not just `preventDefault()`) | The `Ctrl+C`-over-a-diagram e2e case: the clipboard must contain the diagram's rendered SVG label text, not its source — a stronger, differently-shaped regression than F1's |
| F7 | Serialize the diagram substitution from the original wrapper's `outerHTML` (children swapped) instead of a fresh `<pre><code>` element | #198's new "no internal attribute" assertion — `data-mdview-source`/`data-diagram`/`class="md-view-diagram"` appear in the copied `html` |

### Blast-radius checklist (run — not just proposed)

Per-memory process note: a menu-template change must be grepped across the
whole test tree before `in_scope` is finalized, not assumed from the file
list above. Now that D2 is resolved and the new names are final, this ran
for real against `tests/` and `src/`:

```
grep -rl "menu-copy\|popupCopyMenu\|onCopyCommand\|POPUP_COPY_MENU\|COPY_COMMAND\|md-view:popup-copy-menu\|md-view:copy-command" tests/ src/
```

**Zero hits** — expected, since every one of these names is brand new and
nothing existing references them yet. The equivalent grep for the *existing*
`menu-*`/`popupMenu`/`POPUP_MENU` tokens hits 19 files (`tests/unit/menu.test.ts`,
`tests/integration/preload-api-contract.test.ts`, and 17 `tests/e2e/*.spec.ts`
files), confirmed unaffected: Task 49 adds a new template function
(`buildCopyMenuTemplate`) and new IPC channels rather than editing
`buildMenuTemplate`/`POPUP_MENU`, so none of those 19 need a code change —
only `preload-api-contract.test.ts` joins `in_scope`, and it does so for its
own reason (the `BridgeApi` interface grows), not because of this grep.

### Finalized in-scope files (for `current_scope.json`)

- `src/renderer/diagrams.js` (D1: the one-line `dataset` addition to
  `collectSlots()`)
- `src/renderer/renderer.js` (wiring: `contextmenu` listener scoped to
  `#content`/`#code-content`, `copy` event listener installation)
- `src/renderer/copy.js` (new — pure serialization/classification functions +
  the DOM adapter, same split as `diagrams.js`'s policy/use-case/adapter
  layering)
- `src/renderer/index.html` (new script tag for `copy.js`, loaded after
  `diagrams.js` and before `renderer.js`, same ordering rule as #4/Task 45)
- `src/main/menu.ts` (new `buildCopyMenuTemplate`)
- `src/main/index.ts` (new `POPUP_COPY_MENU` / `COPY_COMMAND` IPC handlers,
  mirroring `POPUP_MENU`'s existing one)
- `src/preload/api.ts`, `src/preload/index.ts` (bridge growth: `popupCopyMenu`,
  `onCopyCommand` — both content-free, per amended #202)
- `src/main/help/help.md` (#203's "Copying text" section)
- `tests/unit/copy.test.ts` (new)
- `tests/integration/preload-api-contract.test.ts`
- `tests/e2e/copy-text.spec.ts` (new)
- `.agents/specs/functional_domain.md` (already amended this review: #202)
- `.agents/specs/decisions/ADR-013_md-view.md` (already drafted this review,
  Proposed; stays Proposed until Step 3 close-out, same as ADR-010/012's
  precedent — not in the engineer's scope to flip)

The blast-radius grep above returned zero additional hits, so this list is
final, not provisional.

Explicitly NOT touched: `copyRawSource`'s existing implementation
(`index.ts:625-629`, `renderer.js:174-185`), `menu.ts`'s existing
`buildMenuTemplate` (a new, separate template function, not an edit to the
File/View/Help one — #67's "many entry points" reading), both CSPs,
`windowConfig.ts`, `diagrams.js`'s existing render/theme logic beyond the
one-line D1 addition, all 19 files the existing-token blast-radius grep
returned, `tests/e2e/mermaid.spec.ts`'s existing assertions.

### Expected output format

New files: full content. Existing files: diff (targeted edits).

### Spec section this closes

`functional_domain.md` Task 49, guardrails #196-#203.

---

### Task 49: User approval conditions (binding on implementation and review)

The blueprint above was approved on 2026-09-28 subject to these conditions.
Where a condition and the blueprint disagree, the condition wins.

1. **D2 approved as Option A**, refined: menu-triggered Copy/Copy All use
   `navigator.clipboard.write()`, not `execCommand`/`webContents.copy()`
   (verified during this review to need neither a live selection nor a
   deprecated API). `functional_domain.md` #202 amended in place (done, this
   review) rather than left for the engineer to reinterpret.
2. **ADR-013 drafted, Proposed** (done, this review) — records Option A vs.
   Option B, the `execCommand` deprecation risk, and
   `navigator.clipboard.write()` as the verified resolution. Stays Proposed
   until Step 3 close-out.
3. **Scope and leak conditions**, both folded into D2/D3 above and into new
   fault injections F6/F7: the `copy` interception and the `contextmenu`
   listener fire only inside `#content`/`#code-content`; the copied `html`
   never contains `data-mdview-source`/`data-diagram`/
   `class="md-view-diagram"` — every diagram becomes a clean `<pre><code>`;
   removing the `copy` handler entirely must turn the
   `Ctrl+C`-over-a-diagram e2e case red (copies SVG labels).
4. **D1, D3, D4 approved as drafted**, no changes.
5. In-scope finalized from the blast-radius grep (done, this review — zero
   additional hits beyond the file list already proposed).

---

---

# Task 50: Chrome color tokens in `app.css` (Step 1)

Maps `functional_domain.md` Task 50, guardrails #204-#210.

## Inward Dependency Rule

The "core" here is the token table, a single definition site. Rules (the periphery) depend on tokens through `var(--...)`. Nothing depends on a literal. A skin (Task 51) will later replace the token table without touching any binding rule.

## Pattern Application

- **Strategy via cascade.** The mode is the strategy and the token table is its parameter set. `body.dark-mode` re-declares the same token names with different values, and the base rules never branch on mode.
- **Single source of truth (DRY).** Each color is declared once per mode instead of once per rule per mode.
- OCP: adding a skin means adding a third token table. No binding rule changes.
- No GoF class pattern fits a stylesheet, and none is forced.

## Token table (proposed; values are today's literals, verified against a full read of the 692-line file)

| Token | Light | Dark | Used by |
|---|---|---|---|
| `--color-bg-page` | `transparent` | `#0d1117` | `body` |
| `--color-bg-chrome` | `#f6f8fa` | `#161b22` | title bar, tree panel, status bar, frontmatter, doc header, maximize glyph fill |
| `--color-border` | `#d0d7de` | `#30363d` | title bar, status bar, frontmatter, doc container/header, header action, resize-handle line |
| `--color-text-primary` | `#24292f` | `#c9d1d9` | menu labels, window glyphs, frontmatter, tabs, header action, tree rows |
| `--color-text-muted` | `#57606a` | `#8b949e` | empty states, status bar, tree loading/empty/up |
| `--color-text-disabled` | `#8c959f` | `#6e7681` | disabled header action |
| `--color-border-disabled` | `#d8dee4` | `#30363d` | disabled header action |
| `--color-text-error` | `#cf222e` | `#ff7b72` | tree error, diagram error |
| `--color-bg-hover` | `rgba(208,215,222,0.32)` | `rgba(48,54,61,0.6)` | menu label, window control, tab, header action, tree row |
| `--color-accent` | `#0969da` | `#58a6ff` | resize-handle hover, active-row border, drag-over outline |
| `--color-bg-accent` | `rgba(9,105,218,0.15)` | `rgba(88,166,255,0.18)` | active tree row |
| `--color-bg-accent-hover` | `rgba(9,105,218,0.22)` | `rgba(88,166,255,0.28)` | active tree row on hover |
| `--color-tab-active` | `#fd8c73` | `#fd8c73` | active tab underline (same both modes) |
| `--color-close-hover-bg` | `#e81123` | `rgba(48,54,61,0.6)` | close button hover (preserves quirk #206a) |
| `--color-close-hover-glyph` | `#ffffff` | `#c9d1d9` | close glyph on hover (preserves quirk #206b) |

Final names may shift slightly during implementation, but the one-definition-per-mode rule may not.

## Structure

- One token block under `:root` (light), next to the existing layout properties.
- One token block under `body.dark-mode` (dark). `body.dark-mode` is the only mode-prefixed selector left, and the 25-odd `body.dark-mode <x>` blocks go away. `body { background: var(--color-bg-page) }` replaces the dark-only background rule.
- Expected survivors: none. Each dark override today is a pure color swap on a rule that also has a light base, so each becomes a token swap.

## Verification plan (hardened)

1. **Golden master (not committed, in scratchpad).** Before touching the CSS, a throwaway Playwright script captures computed `color`, `background-color`, `background-image`, `border-*-color` and `outline-color` for every chrome element in both modes. States covered: rest, hover (forced via `page.hover`), active tree row, disabled header action, maximized glyph and drag-over. After the refactor the same script is rerun and the two captures are diffed, which must be empty. This is needed because the existing e2e suite asserts only a handful of these values (body background, content color, tree row and panel color). It would not catch a swapped token on, say, the status bar or the disabled button.
2. **Committed guard** `tests/unit/css-color-tokens.test.ts` (in scope; I recommend including it rather than leaving it optional): (a) no color literal (hex, `rgb(`, `rgba(`, named color other than `transparent`) outside the two token blocks; (b) every `var(--color-*)` reference is defined in both blocks; (c) both blocks define the identical token set. This turns #208 into a durable invariant for Task 51 to build on.
3. Full suite unmodified: `test:unit`, `test:integration`, and `test:e2e` (including `view-menu.spec.ts`, `tree-panel.spec.ts`, `window-chrome.spec.ts`).
4. **Fault injection**, reported explicitly: (i) swap a light/dark pair on one token and (ii) typo one `var()` reference. Confirm RED in the golden-master diff, the unit guard, and the e2e assertions where one exists, then `git apply -R` and confirm GREEN. Because several tokens have no e2e coverage, the report states which layer caught each injection.
5. The `dist-about` size-budget test (the About data URL embeds `app.css`) should be unaffected or slightly better, since the CSS gets shorter.

## Stack declaration and calibration

- **Stack:** `.claude/knowledge/nodejs/bibliography.md`. The change is CSS and Vitest only, so `nodejs/security.md` and `security/general.md` are not applicable (no input handling, no IPC, no CSP change).
- **`code_profile`: `hardened`** (confirmed: shared global styling, and fault injection is the standing practice). Three Red-Green-Refactor cycles maximum, and Step 2.5 independent review applies.
- **`docs_profile`: `delivery`.** RUN_LOG only. I don't plan an ADR, because there is no contested architectural choice. If you want the token-naming scheme recorded as one for Task 51, say so.

## Scope manifest (written only after approval)

`src/renderer/app.css`, `tests/unit/css-color-tokens.test.ts`. The golden-master script lives in the scratchpad, outside the repo.

Branch: `feature/050-css-color-variables` off `main`. Task number 50 confirmed against RUN_LOG (last logged is Task 49 plus its correction notes).

---

# Task 51: Skins system (Step 1)

Maps `functional_domain.md` Task 51, guardrails #211-#227.

## Inward Dependency Rule

```
 renderer/skin.js  --\                 main/index.ts  (composition root: state, IPC, focus)
 preload/*          ---> preload/api.ts <---/   main/menu.ts (pure template builder)
                          (types only)         main/skinsStore.ts  (file I/O)
                                                     |
                                           main/skins.ts  (pure core: schema, validator, resolve)
                                                     |
                                           main/skinPresets.ts (pure data)
```

Pure core (`skins.ts`, `skinPresets.ts`) imports no `electron`, no `node:fs`. `skinsStore.ts` is the I/O adapter, and `index.ts` wires them. `menu.ts` stays a pure function of its inputs. `renderer/skin.js` is a classic script like `copy.js`/`diagrams.js`: pure policy at the top, DOM application below, composed in `renderer.js`.

## Pattern Application

- **Strategy.** Each preset is an interchangeable `SkinDefinition` (colors + syntax pair) behind one resolve function, so adding a skin means adding data only (OCP).
- **Repository.** `skinsStore.ts` mirrors `settingsStore.ts` function for function: `loadSkinsAtStartup`, `rereadSkinsOnFocus`, `writeSkinsFile`, `ensureSkinsFileExists`.
- **Adapter.** `toSkinPayload` is the narrow on-disk/in-memory -> wire adapter, the same role as `toPersistedViewSettings`.
- **Observer-style push.** The existing `broadcastViewSettings` posture, plus `broadcastSkin`.
- The composition root stays `index.ts` and `renderer.js`. No pattern is forced beyond these.

## Architecture decision (given, recorded as ADR-014)

Token values move from static CSS to data pushed from main and applied with `body.style.setProperty`. Details beyond the brief:

- Properties are set on `document.body`, not `documentElement`, because `body.dark-mode` re-declares the tokens on `body` and would shadow anything set on `<html>`.
- The renderer applies **only the active half** (chosen by Dark Mode) and re-applies on every Dark Mode or skin change. A custom skin can therefore never leave stale properties from the other half.
- One uniform code path for every skin, Default included. There is no special case that clears properties. The Default preset's values are pinned to app.css by the drift test (#212), so the CSS fallback and the Default preset cannot diverge silently.

## Shared contract (`src/preload/api.ts`)

`IPC_CHANNELS.SKIN = 'md-view:skin'`; `interface ResolvedSkin { name: string; palette: { light: Record<string,string>; dark: Record<string,string> }; syntax: { light: string; dark: string } }`; `BridgeApi.onSkin(callback: (skin: ResolvedSkin) => void): void`. The token-name list lives in `skins.ts`, so the contract stays free of main-process imports.

## Menu (`menu.ts`)

`buildMenuTemplate(handlers, viewSettings, documentOpen, skinMenu)` gets a fourth REQUIRED parameter, `skinMenu: { names: string[]; activeName: string }`, so `tsc` flags any call site that forgets it (the same posture as `documentOpen`). View gains, after the Preview/Code radios and a separator, a `Skin` submenu: one radio per name (ids `menu-skin-0..n` by index, never derived from names), checked on `activeName`; then a separator; then `menu-skin-edit` ("Edit Skins…"). Handlers: `onSelectSkin(name)`, `onEditSkins()`. The existing unit test that pins "View's submenu has exactly 6 entries" must be updated deliberately (a disclosed expectation change, not a relaxed assertion). Menus are built from in-memory state at popup time, so the list is as fresh as the last focus re-read.

## The split I recommend (one branch, one PR, two delegations)

| Unit | Delivers | Review |
|---|---|---|
| **51a: core + persistence** | `skins.ts`, `skinPresets.ts`, `skinsStore.ts`, drift/validator/schema tests, store integration tests. It is inert (nothing imports it yet) and independently reviewable. This is where all the security-relevant logic lives. | Blocking `code-reviewer` pass on 51a alone |
| **51b: wiring + UI** | `menu.ts`, `index.ts`, preload, `renderer/skin.js`, `renderer.js`, `index.html`, `package.json` build copies, Help section, ADR-014 finalize, unit/e2e tests | Blocking pass on the whole diff |

Two reviewer passes cost more, but 51a is exactly the code where a defect becomes an injection or a data-loss bug, and a narrow review of it is cheap. The alternative is a single delegation with one review at the end.

## Proposed palettes (design data; values tunable without any architecture change)

Default is today's literals, verbatim. The three new presets below are proposals. Columns are Light / Dark. For all three, `--color-close-hover-bg` is `#e81123` / `#e81123`, `--color-close-hover-glyph` is `#ffffff` / `#ffffff`, and `--color-tab-hover-bg` equals `--color-bg-hover` (the intended behavior, #222).

| Token | Claude | Obsidian | Tokyo Night |
|---|---|---|---|
| bg-page | `#faf9f5` / `#262624` | `#ffffff` / `#1e1e1e` | `#e6e7ed` / `#1a1b26` |
| bg-chrome | `#f0eee6` / `#1f1e1d` | `#f5f6f8` / `#262626` | `#d5d6db` / `#16161e` |
| border | `#ddd9ce` / `#3d3d3a` | `#e3e4e8` / `#363636` | `#b4b5b9` / `#292e42` |
| text-primary | `#3d3929` / `#e8e6dc` | `#2e3338` / `#dadada` | `#343b58` / `#c0caf5` |
| text-muted | `#6b6a60` / `#a09f96` | `#6a6f76` / `#999999` | `#565a6e` / `#787c99` |
| text-disabled | `#a8a69c` / `#6b6a63` | `#a5a9ae` / `#5f5f5f` | `#9699a3` / `#4a5072` |
| border-disabled | `#e6e3d9` / `#3d3d3a` | `#e9eaed` / `#363636` | `#c4c5cb` / `#292e42` |
| text-error | `#b3261e` / `#f08c85` | `#c4313b` / `#fb464c` | `#8c4351` / `#f7768e` |
| bg-hover | `rgba(61,57,41,0.08)` / `rgba(250,249,245,0.08)` | `rgba(46,51,56,0.07)` / `rgba(255,255,255,0.07)` | `rgba(52,59,88,0.08)` / `rgba(192,202,245,0.08)` |
| accent | `#d97757` / `#d97757` | `#705dcf` / `#7f6df2` | `#34548a` / `#7aa2f7` |
| bg-accent | `rgba(217,119,87,0.14)` / `rgba(217,119,87,0.18)` | `rgba(112,93,207,0.14)` / `rgba(127,109,242,0.2)` | `rgba(52,84,138,0.14)` / `rgba(122,162,247,0.16)` |
| bg-accent-hover | `rgba(217,119,87,0.22)` / `rgba(217,119,87,0.28)` | `rgba(112,93,207,0.22)` / `rgba(127,109,242,0.3)` | `rgba(52,84,138,0.22)` / `rgba(122,162,247,0.26)` |
| tab-active | `#d97757` / `#d97757` | `#705dcf` / `#7f6df2` | `#965027` / `#bb9af7` |

Syntax pairs: Default `github`/`github-dark`; Claude `atom-one-light`/`atom-one-dark`; Obsidian `stackoverflow-light`/`obsidian` (the non-matched pair, the Lead's judgment call from the brief); Tokyo Night `tokyo-night-light`/`tokyo-night-dark`. Light-half `text-primary`/`text-muted` on `bg-chrome` are unit-checked for WCAG AA (>= 4.5:1) so a proposed value cannot ship illegible.

## Verification plan (hardened)

1. **Unit (`skins.test.ts`)**: the color validator, with positives and a negative table (injection attempts: `red; background:url(x)`, `var(--x)`, `url(…)`, `rgb(0 0 0)` without commas, trailing junk, 9-digit hex); strict-schema rejection (missing or extra token, extra top-level key, wrong types); name rules; `resolveSkin` fallbacks; `listSkinNames` order; payload choke point; all built-ins pass the validator; **drift test: Default preset == parsed app.css `:root`/`body.dark-mode`**; contrast check; each preset's syntax pair is inside the allowlist and exists in `node_modules/highlight.js/styles`.
2. **Integration (`skinsStore.test.ts`)**: missing -> Default and no write; corrupt -> healed plus `.bak` holds the original bytes; focus re-read ignores corrupt and partial files; `ensureSkinsFileExists` never overwrites; atomic write.
3. **e2e**: Skin submenu present with 4 radios (+ custom names) and Edit Skins…; selecting a skin changes computed chrome colors and the loaded hljs stylesheet; Dark Mode toggle swaps halves of the active skin; persistence across relaunch; unknown `activeSkin` -> Default; corrupt file self-heals at launch; focus re-read picks up an external edit; write-while-held is contained (mirrors `settings-locked.spec.ts`); selecting a skin while `skins.json` is corrupt does not overwrite it (#219). The existing `settings-menu`/`settings-locked`/`view-menu` specs pass unmodified.
4. **Fault injection (reported with raw output)**: (i) let one invalid color through the validator -> the injection-table test goes RED; (ii) apply the wrong half on Dark Mode toggle -> e2e RED; (iii) drop the on-disk-parse check before persisting -> the #219 e2e goes RED; (iv) skip the `.bak` copy -> the integration test goes RED. Each one reverted with `git apply -R`, then green.
5. Blast radius for menu changes (from the standing lesson): `tests/unit/menu.test.ts` (the 6-entry View assertion), and the popup/menu-ID users `window-chrome.spec.ts`, `ui-shell.spec.ts`, `close-document.spec.ts`, `copy-text.spec.ts`, `mermaid.spec.ts` must be re-run, and any that assert View's contents scoped explicitly.

## Stack declaration and calibration

- **Stack:** `.claude/knowledge/nodejs/bibliography.md`. **Security-relevant: yes**, so each delegation also declares `.claude/knowledge/nodejs/security.md` and `.claude/knowledge/security/general.md`.
- **`code_profile`: `hardened`** (confirmed: persisted user-edited input, new IPC, injection surface). Three Red-Green-Refactor cycles maximum per delegation.
- **`docs_profile`: `delivery`.** User-facing behavior gets a short "Skins" section in the Help file (the Task 49 precedent), plus ADR-014 (the token-push architecture, drafted Proposed at approval, finalized at 51b close). Release notes stay a release-time task. `blog-detailed` is not warranted.

## Scope manifests (written per delegation after approval)

- **51a:** `src/main/skins.ts`, `src/main/skinPresets.ts`, `src/main/skinsStore.ts`, `tests/unit/skins.test.ts`, `tests/integration/skinsStore.test.ts`.
- **51b:** `src/main/menu.ts`, `src/main/index.ts`, `src/preload/api.ts`, `src/preload/index.ts`, `src/renderer/skin.js` (new), `src/renderer/renderer.js`, `src/renderer/index.html`, `package.json`, `src/main/help/help.md`, `tests/unit/menu.test.ts`, `tests/unit/skin.test.ts` (new, renderer module), `tests/unit/preload-api.test.ts`, `tests/integration/preload-api-contract.test.ts`, `tests/unit/renderer-order.test.ts`, `tests/e2e/skins-menu.spec.ts` (new), `tests/e2e/skins-persistence.spec.ts` (new), plus the scoped e2e hits from the blast-radius grep, if any need an expectation change.
- `src/renderer/app.css` is **not** touched: its blocks keep their Task 50 role, and the drift test only reads it.

Branch: `feature/051-skins-system` off `main` (HEAD `0ab0d20`, Task 50 merged). Task number 51 confirmed against RUN_LOG (last row is Task 50).

---

### Task 51: User approval conditions (binding on implementation and review)

Approved 2026-10-03 ("All approved"). Where a condition and the blueprint disagree, the condition wins.

1. **Split approved:** one branch (`feature/051-skins-system`), one PR, two delegations (51a core + persistence, 51b wiring + UI), a blocking `code-reviewer` pass after 51a and another over the whole diff after 51b.
2. **D1 approved:** corrupt `skins.json` at startup is copied to `skins.json.bak` before the self-heal overwrite (#215).
3. **D2 approved:** a radio selection while `skins.json` exists but does not parse applies in memory, warns, and never overwrites the file (#219).
4. **D4 approved:** Default keeps the three preserved Task 50 quirks; the new presets use the intended behavior (#222). The backlog item stays open.
5. **Palettes approved as proposed**, including the non-matched Obsidian syntax pair. The document card keeping GitHub colors in every skin is confirmed.
6. **ADR-014 drafted, Proposed** (done); finalized at 51b close.

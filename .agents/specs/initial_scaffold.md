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

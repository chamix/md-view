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

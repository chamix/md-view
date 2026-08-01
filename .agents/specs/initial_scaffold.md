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

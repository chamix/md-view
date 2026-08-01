# md-view

An Electron + TypeScript Markdown previewer desktop app.

This repository currently contains only the structural scaffold: process bootstrapping (main window creation, a security-hardened preload bridge, and a static placeholder renderer page). There is no Markdown parsing, file loading, or interactive UI yet — that functionality is planned for a future task.

## Stack

- **Electron** — desktop shell (main/preload/renderer process model)
- **TypeScript** — compiles `src/main` and `src/preload` to CommonJS (`dist/`); the renderer is currently static HTML with no TypeScript
- **Vitest** — unit and integration tests for the pure, Electron-runtime-free modules (`src/preload/api.ts`, `src/main/windowConfig.ts`)
- **Playwright** (`@playwright/test`, `_electron`) — end-to-end test that launches the built Electron app and asserts a window opens
- **electron-builder** — packages the compiled `dist/` output into distributable binaries

## Security invariants

The preload script exposes only an explicit, versioned bridge object (`window.mdview`) via `contextBridge.exposeInMainWorld` — never raw IPC or Node APIs. The main process window is created with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Build, then launch the app with `electron .` |
| `npm run build` | Compile TypeScript (`src/main`, `src/preload`) to `dist/`, and copy the static renderer HTML into `dist/renderer/` |
| `npm run test:unit` | Run unit tests (`tests/unit`) |
| `npm run test:integration` | Run integration tests (`tests/integration`) |
| `npm run test:e2e` | Build, then run the Playwright end-to-end test (`tests/e2e`) against the built app |
| `npm run test:all` | Run unit, integration, and e2e tests in sequence |
| `npm run package` | Package the built app with electron-builder |

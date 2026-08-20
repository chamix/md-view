# md-view

A minimal Electron + TypeScript desktop app for previewing Markdown files.

## Features

- **Open files** via native dialog or by passing a path as a CLI argument
- **Live-reload** — watches the open file and re-renders automatically on save
- **GitHub-flavored rendering** (GFM styling via `github-markdown-css`)
- **Syntax highlighting** for fenced code blocks with a declared language (`highlight.js`)
- **Relative image paths** in the Markdown source resolve correctly against the open file's directory
- **External links** open in your system's default browser, not inside the app
- **Drag-and-drop** a `.md` file from the OS onto the window to open it — same validation as File → Open, and only the first file is opened if several are dropped
- **Dark Mode and Show Frontmatter toggles** in the View menu control preview appearance and frontmatter visibility
- **In-app Help window** with usage documentation, available via Help → md-view Help or the F1 key

## Stack

- **Electron** — desktop shell (main/preload/renderer process model)
- **TypeScript** — compiles `src/main` and `src/preload` to CommonJS (`dist/`); the renderer is plain JS, no build step
- **markdown-it** — Markdown → HTML conversion, with raw HTML passthrough explicitly disabled
- **highlight.js** — syntax highlighting for fenced code blocks with an explicit, recognized language (no auto-detection)
- **chokidar** — file watching for live-reload
- **esbuild** — bundles the preload script into a single file (required to run under Electron's sandboxed preload context)
- **Vitest** — unit and integration tests
- **Playwright** (`@playwright/test`, `_electron`) — end-to-end tests against the built, packaged app
- **electron-builder** — packages the compiled `dist/` output into distributable binaries

## Security invariants

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on the main window
- The preload script exposes only an explicit, versioned bridge object (`window.mdview`) via `contextBridge.exposeInMainWorld` — never raw IPC or Node APIs
- Markdown is converted with `html: false` — raw HTML embedded in a source file is never rendered as live markup
- Links clicked inside rendered content are intercepted and opened externally via `shell.openExternal`; the app window itself never navigates away from its own content

## Usage

```powershell
# Open a specific file directly
npm run dev -- path/to/file.md

# Or launch the app and use File → Open
npm run dev
```

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Build, then launch the app with `electron .` |
| `npm run build` | Compile TypeScript, bundle the preload script, and copy static renderer assets into `dist/` |
| `npm test` | Alias for `test:all` |
| `npm run test:unit` | Run unit tests (`tests/unit`) |
| `npm run test:integration` | Run integration tests (`tests/integration`) |
| `npm run test:e2e` | Build, then run the Playwright end-to-end tests against the built app |
| `npm run test:all` | Run unit, integration, and e2e tests in sequence |
| `npm run package` | Package the built app with electron-builder |

## About this project

**Status: MVP.** `md-view` is a small, working tool — and also a live testbed.

This app was built end-to-end under a governed, multi-agent development
process: every feature went through explicit scope contracts, independent
code review (including deliberate fault-injection to verify tests actually
catch what they claim to), and a running decision log. The governance
system itself lives in a separate, public repo —
[chamix/claude-blueprints](https://github.com/chamix/claude-blueprints) —
and is deployed into target repos like this one.

If you're curious about the process rather than just the app:
- [`RUN_LOG.md`](.agents/metrics/RUN_LOG.md) — one row per completed task: cycles to green, reviewer verdict, notes
- [`backlog.md`](.agents/specs/backlog.md) — known follow-ups, tracked openly rather than fixed silently
- [`.agents/specs/decisions/`](.agents/specs/decisions/) — architecture decision records for the non-obvious calls

This is part of a broader learning project comparing agentic development
workflows — this app is the first thing built under the current system,
used partly to stress-test the governance itself.

## License

MIT — see [LICENSE](LICENSE).
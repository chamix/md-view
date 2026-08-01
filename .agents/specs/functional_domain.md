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

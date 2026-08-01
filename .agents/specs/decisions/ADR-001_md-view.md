# ADR-001: Bundle preload script with esbuild for sandboxed Electron preload

## Status
Accepted

## Context
Task 2 required splitting src/preload/index.ts's runtime implementation
from src/preload/api.ts's pure IPC contract — the same Facade/DIP split
approved in Step 0. Under sandbox: true (added in Step 0, beyond the two
invariants explicitly required by functional_domain.md), the preload's
require() is a restricted polyfill that cannot load local CommonJS
files — Electron's own docs recommend a bundler for any preload split
across multiple files. This surfaced a latent Step 0 bug: preload/index.ts
already imported ./api since Step 0, so the preload likely never loaded
correctly — invisible because Step 0's e2e test only checked that a
window existed, never exercised window.mdview.

## Decision
Bundle only src/preload/index.ts with esbuild (--bundle --platform=node
--format=cjs --external:electron), producing a single-file
dist/preload/index.js with api.ts's contents inlined and zero local
require() calls, while require('electron') stays external. Source stays
split; only the build output is bundled.

## Alternatives considered
- sandbox: false in windowConfig.ts. Rejected: weakens the security
  boundary for an app whose core purpose is rendering arbitrary local
  files; also would have required a scope amendment to unprotect
  windowConfig.ts, which the bundler approach avoids entirely.
- Merge api.ts into index.ts. Rejected: undoes the approved DIP/Facade
  split purely to route around a tooling constraint.

## Consequences
- build script now runs tsc (type-check) then esbuild (bundle) for the
  preload output specifically; main and renderer unaffected.
- Confirmed via direct build output inspection: bundled dist/preload/index.js
  inlines api.ts, contains no local require() calls, correctly
  externalizes require('electron').
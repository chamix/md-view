# ADR-014: Skin token values are pushed from main as data and applied at runtime with `style.setProperty`; app.css keeps the Default values as the pre-IPC fallback

## Status
Accepted (2026-10-03, Task 51 close-out; independent review PASS).

## Context
Task 50 moved every chrome color in `app.css` into 16 CSS custom properties
(light under `:root`, dark under `body.dark-mode`). Task 51 adds user-selectable
skins, including custom skins authored in a user-edited `skins.json`. The
renderer cannot know a custom skin's values at build time, so static CSS cannot
remain the single source of truth for token values.

## Decision
- Token values for the active skin are resolved in `main` (pure core
  `skins.ts`) and pushed to the renderer as a `ResolvedSkin` over one new,
  narrow channel (`md-view:skin`, `BridgeApi.onSkin`). The renderer applies the
  active half (chosen by the existing Dark Mode toggle) with
  `document.body.style.setProperty`.
- Properties are set on `body`, not `<html>`: `body.dark-mode` re-declares the
  tokens on `body` and would shadow anything set on `<html>`.
- One uniform code path for every skin including Default. `app.css`'s `:root`
  and `body.dark-mode` blocks stay unchanged as the pre-IPC fallback, and a
  drift test pins the Default preset to those literals.
- Every color is validated (closed grammar: hex, rgb()/rgba(), `transparent`)
  before it reaches `setProperty`; every highlight.js filename comes from a
  closed allowlist in main and is re-checked in the renderer.
- Custom skins control the 16 chrome tokens only and always use the Default
  syntax pair. `.markdown-body` and Mermaid are not skinned (ADR-003).

## Alternatives considered
- Generating a `<style>` element from skin data: rejected, a larger injection
  surface (string-built CSS) than validated `setProperty` calls.
- Keeping values in static CSS with one `body.skin-<name>` block per skin:
  rejected, cannot express user-authored skins.
- Hand-duplicating `github-markdown-*.css` per skin: rejected in ADR-003.

## Consequences
- A non-Default skin appears one IPC round trip after first paint (accepted).
- The Default preset's values exist twice (TS and CSS), guarded by the drift test.
- The document card keeps GitHub colors in every skin, by scope.

## Behavior notes recorded at close-out
- A skin selection is applied in memory and broadcast immediately; it is persisted only if `skins.json` is missing or parses cleanly. If the write fails (or is skipped because the file is mid-edit and invalid), memory and disk differ, and the next focus re-read of a valid file replaces the in-memory choice with the on-disk one (consistent with `settings.json` and #216).
- The renderer additionally guards token names, color text and theme filenames (defence in depth); main's validator owns numeric ranges.
- Scaffold palette table value for Tokyo Night dark text-muted (#787c99) was amended by the user to #7d82a0 (AA); code is authoritative.

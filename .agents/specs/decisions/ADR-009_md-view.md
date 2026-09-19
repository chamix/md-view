# ADR-009: Persist "last seen version" in a separate internal state.json, not in settings.json

## Status
Accepted

## Context
Task 43 shows a "What's New" window on the first launch after an update. To
know whether an update happened, the app must remember the last version
whose release notes the user has seen (`lastSeenVersion`) across launches.
That needs on-disk persistence, and the app already has exactly one
persisted file, `settings.json` (Task 37), in the same `userData`
directory.

`settings.json` is a deliberately user-facing, hand-editable file: File ->
Settings opens it in the OS default text editor for that exact purpose,
its keys are Title-Case and namespaced (`View` / `Dark Mode`), and its zod
schema is `.strict()` at every level (functional_domain.md guardrails
#103/#104), so an unknown key makes the whole file invalid. Every View-menu
toggle also rewrites the entire file (guardrail #106). `lastSeenVersion` is
internal bookkeeping: no user has a reason to see or edit it.

## Decision
Store it in a **separate file**, `state.json`, in the same `userData`
directory, validated by its own `.strict()` zod schema
(`{ lastSeenVersion: string }`, `src/main/appState.ts`) and accessed only
through `src/main/appStateStore.ts`.

`state.json` is written **atomically** (write to a uniquely named temp file
in the same directory, then `fs.rename()` over the target). This
intentionally does *not* copy `settingsStore.ts`'s plain `fs.writeFile`,
whose non-atomicity produced a real, reproducible `SyntaxError: Unexpected
end of JSON input` under load (backlog.md, Task 41 entry). Fixing
`writeSettingsFile` itself is tracked separately and is outside Task 43.

Read semantics: a missing, unreadable, or invalid `state.json` is treated
as a fresh install (record the current version, show nothing).

## Alternatives considered
- **Extend `settings.json` with a `lastSeenVersion` key (rejected).**
  Fewer files, and reuses `settingsStore.ts` as-is. But:
  1. It puts internal bookkeeping in a file whose whole purpose is to be
     shown to and edited by the user; a user who tidies or resets their
     settings would silently reset the marker and replay old release notes.
  2. The `.strict()` schema (#104) would need a new namespace for a
     non-setting, and any older build or hand-edit that lacks/keeps the key
     would invalidate the *entire* settings file, wiping the user's real
     preferences over a bookkeeping field.
  3. Whole-file rewrite on every toggle (#106) and the focus-reread path
     (#103) would couple two unrelated lifecycles: a settings toggle would
     rewrite the marker, and a marker write would look like a settings
     change.
- **`electron-store` or similar (rejected).** A new runtime dependency to
  persist one string; the project already has a small, tested JSON-file
  pattern and a standing convention of disclosing dependencies (see
  ADR-008).
- **Renderer `localStorage` / a hidden window (rejected).** State that the
  main process needs before any window exists would depend on renderer
  storage that lives in a different process and profile partition.

## Consequences
- Two small JSON files in `userData` instead of one; each has one owner and
  one lifecycle (user preferences vs. app bookkeeping).
- `settings.json` remains free to evolve without any concern for the marker,
  and vice versa.
- New persistence code has an atomic write from day one; `settingsStore.ts`
  still carries the known non-atomic write until the backlog item is
  picked up. If it is, `appStateStore.ts`'s write could be shared rather
  than duplicated -- deferred deliberately, not overlooked.
- A lost `state.json` (deleted profile, corrupt file) degrades to the safe
  direction: no What's New window that launch, and the marker is rewritten.
  The unsafe direction (re-announcing old notes) requires the *older*
  version to be recorded, which only a stale-but-valid file can cause.

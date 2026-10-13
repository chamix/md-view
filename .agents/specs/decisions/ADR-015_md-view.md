# ADR-015: Single merge-and-write choke point for state.json, shared with What's New

## Status
Accepted (2026-10-12, Task 54 close-out; re-review APPROVED, 0 Blocking after the #252 fix round. The Should-fix item (persistAppState does not serialize overlapping writes) is intentionally left open -- see .agents/specs/backlog.md, not a condition of acceptance.)

## Context
Task 43 (ADR-009) introduced `state.json` for one field, `lastSeenVersion`,
with exactly one writer family: `prepareWhatsNew`'s first-launch branch and
`recordVersionSeen` (on the What's New window's `closed` event), both
calling `WhatsNewPorts.saveState(state: AppState): Promise<void>`, bound in
`index.ts` directly to `writeAppStateFile(stateFilePath, state)`. That
binding's contract is **replace the whole file with exactly this object** —
correct and sufficient when there is only one field and one writer.

Task 54 adds two more fields to the same file, `lastFolderPath` and
`lastFileOpenPath`, written from two new, independent call sites (a tree-root
change, a document open/close) that have nothing to do with What's New's own
lifecycle. Both `prepareWhatsNew`'s first-launch write and
`recordVersionSeen` already call `saveState` with an object that only ever
names `lastSeenVersion` — e.g. `ports.saveState({ lastSeenVersion:
currentVersion })`. If that call is bound, unchanged, to a literal
`writeAppStateFile`, it replaces the *entire* file with just that one key —
silently erasing whatever `lastFolderPath`/`lastFileOpenPath` Task 54's own
writer had just recorded, the next time a What's New window closes (every
update) or on a first launch. The reverse race is equally real: Task 54's
writer, bound the same naive way, would erase `lastSeenVersion` the next time
a folder is browsed or a file is opened after an update — re-triggering the
What's New window on a later launch (regressing guardrail #139, "seen means
seen").

This is not a hypothetical: both existing call sites already construct a
*partial*-looking literal (`{ lastSeenVersion: … }`) and only get away with
it today because the file has exactly one field.

## Decision
Every `state.json` write goes through one function in `index.ts`,
`persistAppState(patch: Partial<AppState>): Promise<void>`, which:
1. Merges `patch` into a single in-memory `appState: AppState` variable
   (`mergeAppState(appState, patch)`, pure, `appState.ts`) — a shallow
   merge where an explicit `null` in `patch` is a deliberate overwrite.
2. Writes the full merged object atomically (`writeAppStateFile`, unchanged).
3. Tracks the in-flight write as `pendingStateWrite` (generalizing Task 43's
   `pendingSeenWrite`) so `will-quit` holds for *any* pending state write,
   not only What's New's.

`appState` itself is loaded once, via `loadAppState`, before `createWindow()`
— the same tier as `settings.json`/`skins.json` are already loaded at — and
kept in memory for the rest of the process lifetime; nothing re-reads
`state.json` from disk mid-session.

`WhatsNewPorts.saveState`'s type widens from `(state: AppState) =>
Promise<void>` to `(state: Partial<AppState>) => Promise<void>` (both
existing call sites, `{ lastSeenVersion: … }`, already satisfy the narrower
type, so this is a type-only change — zero behavioral change inside
`whatsNew.ts` itself). Its `index.ts` binding changes from a direct
`writeAppStateFile` call to `(state) => persistAppState(state)`.
`WhatsNewPorts.loadState` is rebound from its own `loadAppState(stateFilePath)`
call to `() => Promise.resolve(appState)`, reading the same already-loaded
in-memory object instead of a second disk read.

Task 54's own two writers (`establishTreeRoot`'s tree-root change,
`documentSession`'s new `onOpenFileChanged` port) call `persistAppState`
exactly the same way — no second, parallel write path.

## Alternatives considered
- **Two independently-tracked pending writes (`pendingSeenWrite` kept as-is,
  a new `pendingFolderFileWrite` added alongside it) (rejected).** Avoids
  touching `whatsNew.ts`'s port bindings at all. But does not solve the
  actual data-loss race above — the two writer families would still call
  `writeAppStateFile` with two different *partial-looking* objects, each
  unaware of the other's fields, each still capable of clobbering the
  other's last-written value on disk. Tracking two pending-write promises
  separately only protects against losing a write to quit timing; it does
  nothing about one writer's object silently omitting the other's fields.
- **Each writer reads the file fresh immediately before its own write
  (read-merge-write per call, no shared in-memory `appState`) (rejected).**
  Solves the field-loss problem without a shared variable, but reintroduces
  a real (if narrow) race between two concurrent read-merge-write sequences
  landing out of order — unnecessary, since this is a single-process, mostly
  single-threaded-for-this-purpose Node event loop where a single in-memory
  object with synchronous merges has no such race at all. Also means two
  disk reads at points where the process already holds the answer in memory
  (`loadAppState` at startup) for one of the two fields involved.
- **A fourth top-level field inside `settings.json` instead of `state.json`
  (rejected).** Already settled by ADR-009 for the same reasons (internal
  bookkeeping vs. a deliberately user-facing, hand-editable, `.strict()`
  file that is rewritten whole on every View toggle) — not re-litigated
  here, only reaffirmed for the two new fields.
- **`electron-store` or similar (rejected).** Same reasoning as ADR-009: a
  new runtime dependency to persist two more strings, when the project
  already has a small, tested, atomic JSON-file pattern.

## Consequences
- `state.json` keeps exactly one owner process-wide for its in-memory
  representation (`appState` in `index.ts`), written through exactly one
  function. Adding a fourth field later (if ever) is a schema change plus
  one new `persistAppState({...})` call site — not a new writer family to
  reason about for races.
- `whatsNew.ts` itself is untouched in logic; only its port *type* widens
  and its `index.ts` *bindings* change. Its own unit tests
  (`tests/unit/whatsNew.test.ts`) need no behavioral changes, only (if at
  all) a type-level adjustment to any inline fake `saveState`/`loadState`
  implementations.
- `will-quit`'s guard variable is renamed (`pendingSeenWrite` →
  `pendingStateWrite`); its bounded-wait logic (3000ms timeout,
  `Promise.race`, `setImmediate(() => app.quit())` re-entry) is otherwise
  byte-identical, now protecting a strictly larger set of writes for no
  extra cost (a `state.json` write is still, at most, a few hundred bytes).
- A future feature wanting to persist a fourth bookkeeping fact reuses
  `persistAppState` directly — the choke point is already general, not
  special-cased to folder/file.

# ADR-002: Remove OPEN_FILE_DIALOG IPC channel and openFileDialog from BridgeApi

## Status
Accepted

## Context
Task 7 replaced the renderer's "Open File…" button — the sole caller of
`window.mdview.openFileDialog()` — with a native File menu whose "Open…" item
runs its click handler natively in the main process. Since `dialog.showOpenDialog`
is a main-process-only API, the menu handler no longer needs the renderer to
ask for it via IPC — it can call the file-opening logic directly. This left
`IPC_CHANNELS.OPEN_FILE_DIALOG` and `BridgeApi.openFileDialog()` with zero
remaining callers once the button was removed.

## Decision
Delete `OPEN_FILE_DIALOG` from `IPC_CHANNELS` and `openFileDialog` from
`BridgeApi` entirely rather than leave them unused. `ipcMain.on(IPC_CHANNELS.OPEN_FILE_DIALOG, ...)`
is removed from `src/main/index.ts`; its body is extracted into a named
`openFileViaDialog()` function called directly by the menu's `onOpen` handler.
`src/preload/index.ts` drops the `ipcRenderer.send(...)` implementation. Both
BridgeApi-contract assertions on `OPEN_FILE_DIALOG` in
`tests/integration/preload-api-contract.test.ts` are removed in the same diff.
Confirmed via grep: zero remaining references to `openFileDialog`/
`OPEN_FILE_DIALOG` anywhere in `src/` or `tests/` (Task 7 review report).

## Alternatives considered
- Keep the channel and BridgeApi method in place, unused, for a hypothetical
  future renderer-triggered open affordance. Rejected: violates the project's
  "no design for hypothetical requirements" default and the BridgeApi's
  explicit narrow-contract invariant — re-adding it later, if ever needed, is
  cheap; carrying dead surface indefinitely is not free.
- Keep the IPC channel wired, but have the menu's click handler send itself an
  IPC message that the renderer bounces back into `openFileDialog()`, purely to
  avoid touching the contract. Rejected: adds a pointless two-hop round trip
  through the renderer for a main-process-only operation the renderer has no
  legitimate role in seeing or influencing.

## Consequences
- `BridgeApi` shrinks from 3 members to 2 (`version`, `onFileRendered`).
- Any future feature needing the renderer to trigger a file-open action
  independent of the menu (drag-and-drop empty state, a recent-files list)
  will need to reintroduce a BridgeApi method scoped to what that feature
  actually needs, not a preemptive reopening of this one.
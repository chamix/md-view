# ADR-005: Frameless main window scoped to its own construction options, with menu-as-popup reusing buildMenuTemplate

## Status
Proposed (pending Step 1 blueprint approval for Task 29)

## Context
Task 29 removes native OS chrome from the main window (`frame: false`) and
replaces it with an app-drawn title bar: three menu-label buttons
(File/View/Help), a drag region, and three window-control buttons
(minimize, maximize/restore, close). Two design questions carry real
architectural weight rather than being pure implementation detail:

1. `defaultWindowOptions` (`src/main/windowConfig.ts`) is shared between
   the main window and the Help window (Task 14). Adding `frame: false`
   naively to that shared object would silently strip the Help window's
   native chrome too, even though Task 14/15 deliberately gave the Help
   window a stricter, simpler posture (no preload, no application menu)
   than the main window.
2. The title bar's File/View/Help labels need to show a real menu on
   click. The obvious naive approach — describe the same three menus a
   second time, in the renderer or in a new main-process structure meant
   specifically for popups — would create a second definition of menu
   content alongside `menu.ts`'s existing `buildMenuTemplate`, which has
   been the single source of truth for File/View/Help since Task 7.

## Decision
1. `frame: false` is added only inside `createWindow()`'s own
   `BrowserWindow` options object, layered on top of the
   `...defaultWindowOptions` spread exactly the way `icon` and `preload`
   already are. `defaultWindowOptions` itself is not touched.
   `onOpenHelp()`'s Help-window construction call continues to spread the
   same shared baseline and simply never opts in to `frame: false` — it
   requires zero code change of its own to stay native.
2. The title bar's menu-label click handlers popup a *slice* of the
   exact same template `buildMenuTemplate(handlers, viewSettings)`
   already produces for `Menu.setApplicationMenu()` — a new
   `ipcMain.on(IPC_CHANNELS.POPUP_MENU, ...)` handler calls
   `buildMenuTemplate` with the same handlers/viewSettings values
   `applyMenu()` already has in scope, picks out `template[index].submenu`
   for the clicked section, and calls
   `Menu.buildFromTemplate(...).popup({ window: mainWindow, x, y })` on
   just that slice. `menu.ts` gets zero diff.

## Alternatives considered
- Add `frame: false` directly to `defaultWindowOptions`. Rejected: would
  require adding compensating logic to `onOpenHelp()` to opt back out
  (e.g. `frame: true` override), inverting the established pattern where
  `defaultWindowOptions` is the safe shared baseline and per-window
  options are additive, not subtractive.
- Hand-author a second, renderer-facing description of File/View/Help's
  contents specifically for the popup path (e.g. a static JSON menu
  description consumed by the renderer to build its own DOM context
  menu). Rejected: creates exactly the two-sources-of-truth risk this
  codebase has avoided since Task 7 — any future menu-item change would
  need to be made in two places, and the two would eventually drift
  (a new item added to `buildMenuTemplate` but forgotten in the popup
  description, or vice versa).

## Consequences
- The Help window's chrome requires no test coverage changes for this
  task — it was never touched, and `defaultWindowOptions`'s existing
  unit tests (`contextIsolation`/`nodeIntegration`/`sandbox` asserted
  against the plain object) remain valid proof that stays true for both
  windows, unaffected by `frame`.
- Every future menu-content change (new item, new accelerator, new
  checkbox) is made in exactly one place (`buildMenuTemplate`) and is
  automatically correct for both the native application menu and every
  title-bar popup — no second file to remember to update.
- The popup path depends on `applyMenu()`'s handlers/viewSettings closure
  values being available at the `POPUP_MENU` handler's registration site
  in `app.whenReady()` — both must be registered in the same scope, which
  constrains where the new handler can be added but does not change any
  existing function's signature.

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import * as fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { defaultWindowOptions } from './windowConfig';
import { markdownToHtml, highlightMarkdownSource } from './markdown';
import { baseUrlForFile, changelogPathFor } from './paths';
import { watchFile } from './watcher';
import { isExternalHttpUrl } from './linkPolicy';
import { buildMenuTemplate } from './menu';
import type { MenuHandlers } from './menu';
import { extractFrontmatter } from './frontmatter';
import { shouldSetDockIcon } from './dockIcon';
import { shouldCreateHelpWindow, buildHelpHtml } from './helpWindow';
import { shouldCreateWhatsNewWindow, buildWhatsNewMarkdown } from './whatsNewWindow';
import { prepareWhatsNew, recordVersionSeen } from './whatsNew';
import type { WhatsNewPorts } from './whatsNew';
import { loadAppState, writeAppStateFile } from './appStateStore';
import { createDocumentSession } from './documentSession';
import { filterAndSortEntries } from './fileTree';
import { IPC_CHANNELS } from '../preload/api';
import type { FileRenderedMessage, DirectoryListResult, FolderTreeRootMessage, DocumentTab, ViewSettings } from '../preload/api';
import { loadSettingsAtStartup, rereadSettingsOnFocus, ensureSettingsFileExists, writeSettingsFile } from './settingsStore';
import { toPersistedViewSettings, fromViewSettings } from './settings';

let mainWindow: BrowserWindow | null = null;
let helpWindow: BrowserWindow | null = null;
let whatsNewWindow: BrowserWindow | null = null;
// In-flight "seen version" write started by the What's New window's 'closed'
// handler; the 'will-quit' handler (bottom of file) holds the process until it
// settles. recordVersionSeen never rejects, so this promise always settles.
let pendingSeenWrite: Promise<void> | null = null;
let settingsFilePath: string;

// currentTab is session-scoped only (Task 37 explicitly does NOT persist
// it); darkMode/showFrontmatter/showTreePanel are persisted to
// settings.json as of Task 37, superseding Task 8 guardrail #6's original
// "session-scoped, never persisted" scope boundary -- a disclosed,
// intentional lifting of that boundary, not silent drift. This default
// object is overwritten with loadSettingsAtStartup()'s result (merged over
// these same three keys) before createWindow() runs.
let viewSettings: ViewSettings = {
  darkMode: false,
  showFrontmatter: true,
  showTreePanel: true,
  currentTab: 'preview',
};

// Session-scoped, never persisted — same explicit precedent as viewSettings's
// "resets to this exact default on every launch" comment above.
let currentTreeRoot: string | null = null;

function broadcastViewSettings(): void {
  mainWindow?.webContents.send(IPC_CHANNELS.VIEW_SETTINGS, viewSettings);
}

// Toggling a View-menu item always persists the *entire* current settings
// object (functional_domain.md guardrail #106) -- never a single-key patch,
// since settings.json has no defined partial-update semantics.
async function persistCurrentViewSettings(): Promise<void> {
  await writeSettingsFile(settingsFilePath, fromViewSettings(viewSettings));
}

async function setDarkMode(checked: boolean): Promise<void> {
  viewSettings = { ...viewSettings, darkMode: checked };
  broadcastViewSettings();
  await persistCurrentViewSettings();
}

async function setShowFrontmatter(checked: boolean): Promise<void> {
  viewSettings = { ...viewSettings, showFrontmatter: checked };
  broadcastViewSettings();
  await persistCurrentViewSettings();
}

async function setShowTreePanel(checked: boolean): Promise<void> {
  viewSettings = { ...viewSettings, showTreePanel: checked };
  broadcastViewSettings();
  await persistCurrentViewSettings();
}

// Session-scoped currentTab (Task 32 decision #3): check-then-act, same
// shape as forceShowTreePanelAndRebuildMenu below -- only rebroadcasts +
// rebuilds the menu (so the View menu's radio checkmarks stay in sync) when
// the value actually changes.
function setCurrentTab(tab: DocumentTab): void {
  if (viewSettings.currentTab === tab) return;
  viewSettings = { ...viewSettings, currentTab: tab };
  broadcastViewSettings();
  applyMenu();
}

// Single, shared construction of the handlers object -- applyMenu() (below),
// forceShowTreePanelAndRebuildMenu(), and the POPUP_MENU IPC handler
// (registered in app.whenReady()) all call this same function, rather than
// each independently maintaining its own copy of the handlers literal (which
// would drift over time). This is the concrete mechanism satisfying
// functional_domain.md guardrail #67: the title-bar popup is a second entry
// point into buildMenuTemplate, never a second, hand-duplicated definition.
function menuHandlers(): MenuHandlers {
  return {
    onOpen: openFileViaDialog,
    onOpenFolder: openFolderViaDialog,
    onToggleDarkMode: setDarkMode,
    onToggleShowFrontmatter: setShowFrontmatter,
    onToggleShowTreePanel: setShowTreePanel,
    onSelectTab: setCurrentTab,
    onOpenHelp,
    onOpenSettings,
    // Task 44: one receiver behind three invokers (native menu, title-bar
    // popup, CmdOrCtrl+W), never three implementations.
    onClose: () => documentSession.close(),
  };
}

// File -> Settings: create the file only if it doesn't already exist (never
// overwrite an existing one, even a corrupt one -- ensureSettingsFileExists
// owns that distinction), then hand the fixed, main-process-computed path to
// the OS's own file-type handler. settingsFilePath never originates from,
// or passes through, the renderer (functional_domain.md guardrail #105).
async function onOpenSettings(): Promise<void> {
  await ensureSettingsFileExists(settingsFilePath);
  await shell.openPath(settingsFilePath);
}

// Registered on the BrowserWindow's 'focus' event (createWindow(), below).
// Re-reads settings.json so an external hand-edit while the app was
// unfocused is picked up -- but per functional_domain.md guardrail #103,
// this path is protective, not self-healing: rereadSettingsOnFocus() already
// returns null (and touches nothing) for any read/parse failure, so a null
// result here means "ignore this event entirely". A non-null result is only
// applied to memory/UI/menu together (guardrail #107), and only when it
// actually differs from what's already in memory -- an unchanged read is a
// no-op, no rebroadcast/rebuild for nothing.
async function onWindowFocus(): Promise<void> {
  const result = await rereadSettingsOnFocus(settingsFilePath);
  if (result === null) return;

  const persisted = toPersistedViewSettings(result);
  const unchanged =
    persisted.darkMode === viewSettings.darkMode &&
    persisted.showFrontmatter === viewSettings.showFrontmatter &&
    persisted.showTreePanel === viewSettings.showTreePanel;
  if (unchanged) return;

  viewSettings = { ...viewSettings, ...persisted };
  broadcastViewSettings();
  applyMenu();
}

function applyMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(buildMenuTemplate(menuHandlers(), viewSettings, documentSession.isOpen()))
  );
}

// Task 29: which buildMenuTemplate() index a title-bar label section maps
// to. Pure lookup, zero Electron runtime -- unit-testable in isolation, same
// tier as shouldSkipDevToolsShortcut immediately below.
export function menuSectionIndex(section: 'file' | 'view' | 'help'): number {
  return { file: 0, view: 1, help: 2 }[section];
}

// Called by the two "browse a folder" actions (openFolderViaDialog and the
// dropped/opened-directory branch of REQUEST_OPEN_FILE) -- never by
// documentSession.open (single-file open must never touch showTreePanel in either
// direction). Check-then-act: only forces the value and rebuilds the menu
// when it was previously false, never an unconditional rebuild.
function forceShowTreePanelAndRebuildMenu(): void {
  if (viewSettings.showTreePanel) return;
  viewSettings = { ...viewSettings, showTreePanel: true };
  broadcastViewSettings();
  applyMenu();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    ...defaultWindowOptions,
    frame: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      ...defaultWindowOptions.webPreferences,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Task 29: the maximize/restore button's displayed state is a pure
  // reflection of the real BrowserWindow's own maximized fact, pushed
  // whenever that fact actually changes -- regardless of whether the change
  // came from the custom title-bar button, a double-click on the drag
  // region, or an OS-level action (snap, Win+Up) entirely outside the app's
  // own UI. Registered here, inside createWindow(), NOT inside the
  // TOGGLE_MAXIMIZE_WINDOW handler below -- 'maximize'/'unmaximize' are
  // native BrowserWindow events that fire for every path that changes real
  // maximized state, not something this task's own handler emits
  // synthetically (functional_domain.md guardrail #69).
  mainWindow.on('maximize', () => mainWindow?.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, false));

  // Task 37: re-read settings.json on refocus, so an external hand-edit made
  // while the window was unfocused is picked up without requiring a relaunch.
  mainWindow.on('focus', onWindowFocus);

  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault(); // unconditional, before any URL classification — this is the load-bearing safety property
    if (isExternalHttpUrl(url)) {
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Developer affordance only — never reachable in a shipped build, and
  // never surfaced as a discoverable menu entry. Scoped to this window's
  // webContents, not a global accelerator.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (shouldSkipDevToolsShortcut(app.isPackaged)) return;
    const isDevToolsShortcut =
      input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i');
    if (isDevToolsShortcut) {
      mainWindow?.webContents.toggleDevTools();
    }
  });
}

// Pure predicate isolating the DevTools-shortcut guard's polarity so it can
// be pinned by a test without having to drive real native keyboard input
// through Electron's before-input-event pipeline. Must return true (skip /
// unreachable) only when packaged, and false (reachable) only in dev builds.
export function shouldSkipDevToolsShortcut(isPackaged: boolean): boolean {
  return isPackaged;
}

// Test-only bridge: tests/e2e/ui-shell.spec.ts reads this via
// electronApp.evaluate() to pin the guard's exact polarity. Synthetic native
// keyboard input (F12) does not reliably reach Electron's before-input-event
// hook via CDP in automated test runs, so this exposes the real, running
// predicate for direct assertion instead of reimplementing it in the test
// (which would only pin a copy, not the shipped behavior). Main-process-only
// global; never reachable from renderer/web content.
(globalThis as Record<string, unknown>).__mdViewDevToolsGuardForTests = shouldSkipDevToolsShortcut;

function argvFilePath(): string | null {
  const args = app.isPackaged ? process.argv.slice(1) : process.argv.slice(2);
  const found = args.find((arg) => arg.toLowerCase().endsWith('.md'));
  return found ?? null;
}

async function renderFile(filePath: string): Promise<FileRenderedMessage> {
  if (!filePath.toLowerCase().endsWith('.md')) {
    return { ok: false, filePath, error: 'Not a Markdown file: ' + filePath };
  }

  try {
    const source = await fs.readFile(filePath, 'utf8');
    const { frontmatter, body } = extractFrontmatter(source);
    return {
      ok: true,
      filePath,
      html: markdownToHtml(body),
      codeHtml: highlightMarkdownSource(source),
      baseUrl: baseUrlForFile(filePath),
      frontmatter,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, filePath, error: message };
  }
}

export async function listDirectoryEntries(dirPath: string): Promise<DirectoryListResult> {
  try {
    const raw = await fs.readdir(dirPath, { withFileTypes: true });
    const entries = filterAndSortEntries(
      raw.map((d) => ({ name: d.name, isDirectory: d.isDirectory() })),
      dirPath
    );
    return { ok: true, dirPath, entries };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, dirPath, error: message };
  }
}

async function establishTreeRoot(rawRootPath: string): Promise<void> {
  // Canonicalize before comparing/storing so two differently-cased strings
  // that name the same real on-disk directory (dialog.showOpenDialog's
  // returned casing vs. path.dirname() of a drag-and-drop/argv-opened
  // file's casing, on a case-insensitive filesystem) are recognized as the
  // same tree root -- via the filesystem's own canonicalization, never a
  // platform-based case-folding heuristic (functional_domain.md Task 18
  // guardrail #9). fs.promises.realpath was empirically verified on this
  // Windows machine/Node version to return the true on-disk casing (probed
  // directly: fs.promises.realpath(<uppercased fixture dir>) resolved back
  // to the real mixed-case path) -- fs.realpath.native (via util.promisify)
  // was verified to return the identical result in the same probe, but
  // fs.promises.realpath was chosen because it needs no extra wrapping.
  let resolvedRootPath: string;
  try {
    resolvedRootPath = await fs.realpath(rawRootPath);
  } catch {
    // Canonicalization failed (e.g. ENOENT -- directory deleted between the
    // open action and this call). Fall back to the raw path;
    // listDirectoryEntries below will independently hit the same failure
    // and correctly resolve {ok:false}, same as any other unreadable-
    // directory case (Task 17's existing guardrail #3, unchanged).
    resolvedRootPath = rawRootPath;
  }
  if (resolvedRootPath === currentTreeRoot) return; // no-op: no re-fetch, no event sent
  const result = await listDirectoryEntries(resolvedRootPath);
  currentTreeRoot = resolvedRootPath;
  const message: FolderTreeRootMessage = result.ok
    ? { ok: true, rootPath: resolvedRootPath, entries: result.entries }
    : { ok: false, rootPath: resolvedRootPath, error: result.error };
  mainWindow?.webContents.send(IPC_CHANNELS.FOLDER_TREE_ROOT, message);
}

// Task 44: the single document session (slot occupancy + render epoch +
// the one active watcher). This is the composition root binding its ports to
// concrete I/O; the open/close/race rules live in documentSession.ts. The
// sendFileRendered binding below is the ONLY place src/main references the
// file-rendered channel (#149: every delivery goes through the session's
// guarded choke point). Folder paths (Open Folder, dropped directories, "Up one level")
// deliberately never touch this session (#153).
const documentSession = createDocumentSession({
  renderFile,
  sendFileRendered: (message) => mainWindow?.webContents.send(IPC_CHANNELS.FILE_RENDERED, message),
  sendDocumentClosed: () => mainWindow?.webContents.send(IPC_CHANNELS.DOCUMENT_CLOSED),
  watch: (filePath, onChange) => watchFile(filePath, onChange),
  establishTreeRootFor: (filePath) => establishTreeRoot(path.dirname(filePath)),
  onOccupancyChanged: applyMenu,
});

async function openFileViaDialog(): Promise<void> {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  await documentSession.open(result.filePaths[0]);
}

async function openFolderViaDialog(): Promise<void> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return;
  forceShowTreePanelAndRebuildMenu();
  await establishTreeRoot(result.filePaths[0]);
}

// Stylesheets shared by the static (Help / What's New) windows.
function staticWindowCssHrefs(): string[] {
  return [
    pathToFileURL(path.join(__dirname, '../renderer/app.css')).href,
    pathToFileURL(path.join(__dirname, '../renderer/github-markdown-light.css')).href,
    pathToFileURL(path.join(__dirname, '../renderer/github.css')).href,
  ];
}

// Single, shared construction + lockdown of the static, read-only,
// app-authored windows (Help and What's New) -- security-sensitive, so it
// lives in exactly one place rather than being copy-pasted per window
// (functional_domain.md guardrail #142). Callers own their own window
// variable, single-instance guard, and 'closed' handling; the window is
// returned before its content finishes loading so they can attach handlers
// without racing the load.
function createStaticWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...defaultWindowOptions,
    webPreferences: {
      ...defaultWindowOptions.webPreferences,
    },
  });

  // Static windows are read-only, app-authored content. On
  // Windows/Linux, Menu.setApplicationMenu() becomes the default menu for
  // every BrowserWindow unless that window explicitly clears it — without
  // this, a static window would expose the full File/View/Help bar and its
  // live handlers (openFileViaDialog, setDarkMode, setShowFrontmatter, even
  // onOpenHelp itself) behind what should be a static screen.
  // Unconditional: removeMenu() is a documented no-op on macOS (menu bar
  // there is process-wide via Menu.setApplicationMenu, not per-window), so
  // no platform branch is needed.
  win.removeMenu();

  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault(); // unconditional, before any URL classification — same safety property as the main window
    if (isExternalHttpUrl(url)) {
      shell.openExternal(url);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  return win;
}

async function loadStaticHtml(win: BrowserWindow, html: string): Promise<void> {
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  } catch {
    // Navigation can be aborted (ERR_FAILED) if the window is closed while
    // the data: URL is still loading — not a real failure to surface, just
    // a race between window teardown and an in-flight load.
  }
}

async function onOpenHelp(): Promise<void> {
  if (!shouldCreateHelpWindow(helpWindow)) {
    helpWindow?.focus();
    return;
  }

  const source = await fs.readFile(path.join(__dirname, 'help', 'help.md'), 'utf8');
  const contentHtml = markdownToHtml(source);
  const html = buildHelpHtml(contentHtml, staticWindowCssHrefs());

  const win = createStaticWindow();
  helpWindow = win;
  win.on('closed', () => {
    helpWindow = null;
  });

  await loadStaticHtml(win, html);
}

// Task 43: shows the current version's release notes the first time the app
// launches after an update. Persistence/decision logic lives in whatsNew.ts
// behind ports; this only binds the concrete paths and Electron window.
// Every failure is contained (guardrail #140): the caller also .catch()es.
async function showWhatsNewIfDue(): Promise<void> {
  const stateFilePath = path.join(app.getPath('userData'), 'state.json');
  const ports: WhatsNewPorts = {
    loadState: () => loadAppState(stateFilePath),
    saveState: (state) => writeAppStateFile(stateFilePath, state),
    readChangelog: () => fs.readFile(changelogPathFor(__dirname), 'utf8'),
  };

  const content = await prepareWhatsNew(ports, app.getVersion());
  if (content === null || !shouldCreateWhatsNewWindow(whatsNewWindow)) return;

  const html = buildHelpHtml(
    markdownToHtml(buildWhatsNewMarkdown(content.version, content.body)),
    staticWindowCssHrefs(),
    `What's New in md-view ${content.version}`
  );

  const win = createStaticWindow();
  whatsNewWindow = win;
  // The version is recorded as seen only when the window is closed, never at
  // open time (guardrail #139): a crash while it is open leaves the update
  // un-acknowledged. recordVersionSeen never throws.
  win.on('closed', () => {
    whatsNewWindow = null;
    const write = recordVersionSeen(ports, content.version);
    pendingSeenWrite = write;
    // Once settled it no longer needs to hold the quit (see 'will-quit').
    void write.then(() => {
      if (pendingSeenWrite === write) pendingSeenWrite = null;
    });
  });

  await loadStaticHtml(win, html);
}

app.whenReady().then(async () => {
  settingsFilePath = path.join(app.getPath('userData'), 'settings.json');
  // Strictly before createWindow()/the did-finish-load listener
  // registrations below -- those must stay synchronous relative to each
  // other (existing invariant: a did-finish-load that fires while
  // renderFile() is still reading from disk must never be missed).
  const startupSettings = await loadSettingsAtStartup(settingsFilePath);
  viewSettings = { ...viewSettings, ...toPersistedViewSettings(startupSettings) };

  createWindow();

  if (shouldSetDockIcon(app.isPackaged, process.platform)) {
    app.dock?.setIcon(path.join(__dirname, 'icon.png'));
  }

  applyMenu();

  // Unconditional and separate from the argv-conditional listener below:
  // ViewSettings is a session fact independent of whether any file was ever
  // opened, so the renderer must learn it even when there is no argv file.
  mainWindow?.webContents.once('did-finish-load', () => {
    broadcastViewSettings();
  });

  const filePath = argvFilePath();
  if (filePath !== null) {
    // Register the listener synchronously, before any await, so it cannot
    // miss a did-finish-load that fires while renderFile() is still reading
    // the file from disk.
    mainWindow?.webContents.once('did-finish-load', () => {
      documentSession.open(filePath);
    });
  }

  // Task 16: drag-and-drop file open. The renderer resolves the dropped
  // File's real filesystem path (via webUtils.getPathForFile, which must run
  // in preload — see src/preload/index.ts) and sends it here, fire-and-
  // forget. All validation (extension check, existence, read errors) is
  // owned exclusively by renderFile() via documentSession.open() — never
  // duplicated here. The only new logic is the empty-string guard below,
  // covering a documented possible return from getPathForFile() on some
  // platforms; that case is a silent no-op, not a user-facing error.
  ipcMain.on(IPC_CHANNELS.REQUEST_OPEN_FILE, async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || filePath.length === 0) return;

    let isDirectory = false;
    try {
      const stats = await fs.stat(filePath);
      isDirectory = stats.isDirectory();
    } catch {
      // Stat failed (nonexistent path, permission error, etc.) -- fall
      // through to the existing documentSession.open/renderFile error path
      // below, unchanged from today's behavior. Do not add a second,
      // parallel error-handling branch here.
    }

    if (isDirectory) {
      forceShowTreePanelAndRebuildMenu();
      await establishTreeRoot(filePath);
      return;
    }

    documentSession.open(filePath);
  });

  // Task 17: first request-response IPC pair in the app (ipcMain.handle /
  // ipcRenderer.invoke) — every other channel above is fire-and-forget.
  ipcMain.handle(IPC_CHANNELS.REQUEST_LIST_DIRECTORY, (_e, dirPath: string) => listDirectoryEntries(dirPath));

  // Task 34: second request-response IPC pair in the app (after Task 17's
  // REQUEST_LIST_DIRECTORY). clipboard.writeText() must run main-process
  // side — Electron's sandboxed-preload polyfilled require() does not
  // expose the clipboard module (verified against Electron's sandbox
  // docs before choosing this shape, not assumed).
  ipcMain.handle(IPC_CHANNELS.COPY_RAW_SOURCE, (_e, text: string) => {
    if (typeof text !== 'string') return false;
    clipboard.writeText(text);
    return true;
  });

  // Task 27: "Up one level" tree navigation. Fire-and-forget, same shape as
  // Open Folder…/dropped-folder — the result comes back through the existing
  // FOLDER_TREE_ROOT push channel, never a new request-response round trip.
  // path.dirname() of an actual filesystem root returns that same root
  // unchanged, so establishTreeRoot's own pre-existing
  // resolvedRootPath === currentTreeRoot no-op guard handles "already at the
  // top" for free — no second guard is duplicated here.
  ipcMain.on(IPC_CHANNELS.REQUEST_TREE_PARENT, () => {
    if (!currentTreeRoot) return;
    establishTreeRoot(path.dirname(currentTreeRoot));
  });

  // Task 32: Preview/Code tab selection. Fire-and-forget, same shape as the
  // other session-scoped ViewSettings toggles -- the renderer's click
  // handler and the View menu's radio items are two entry points into the
  // same setCurrentTab()/broadcastViewSettings() path, never two
  // independently maintained pieces of state.
  ipcMain.on(IPC_CHANNELS.SELECT_TAB, (_e, tab: DocumentTab) => setCurrentTab(tab));

  // Task 29: frameless main window's custom title-bar controls. Each is a
  // zero-argument, fire-and-forget trigger mapping 1:1 onto a real
  // BrowserWindow lifecycle method — no intermediate domain state of its
  // own to model (functional_domain.md Task 29 Abstract Schema Contracts).
  ipcMain.on(IPC_CHANNELS.MINIMIZE_WINDOW, () => mainWindow?.minimize());
  ipcMain.on(IPC_CHANNELS.CLOSE_WINDOW, () => mainWindow?.close());
  ipcMain.on(IPC_CHANNELS.TOGGLE_MAXIMIZE_WINDOW, () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  // Title-bar menu-label click -> pop up just that section's own submenu,
  // built from the exact same buildMenuTemplate(...) call applyMenu() uses
  // for the full native application menu (ADR-005 / guardrail #67) — never
  // a second, hand-duplicated menu description.
  ipcMain.on(IPC_CHANNELS.POPUP_MENU, (_e, section: 'file' | 'view' | 'help', x: number, y: number) => {
    const index = menuSectionIndex(section);
    const template = buildMenuTemplate(menuHandlers(), viewSettings, documentSession.isOpen());
    Menu.buildFromTemplate(template[index].submenu as MenuItemConstructorOptions[]).popup({
      window: mainWindow ?? undefined,
      x,
      y,
    });
  });

  // Last step, after createWindow() and the did-finish-load registrations
  // above, so the main window stays firstWindow() and the synchronous-
  // registration invariant is untouched. Fire-and-forget: What's New must
  // never block or crash startup or file opening (guardrail #140).
  showWhatsNewIfDue().catch((error) => {
    console.warn("What's New: unexpected failure:", error);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => documentSession.shutdown());

// Guardrail #139 on the exit paths. The seen-version write is async, and the
// What's New window can be the last one closed (window-all-closed ->
// app.quit()) or the app can quit while it is still open (Electron then
// destroys the window, firing 'closed', after 'before-quit'). In both cases
// 'will-quit' is the first event after every 'closed' has run, so it is where
// the process can still be held until the write has landed; otherwise the
// process may exit first and the notes would replay on every launch. The
// second app.quit() re-enters this handler with pendingSeenWrite already
// cleared, so quitting proceeds. A write that has already settled is cleared
// by its own completion, so it never holds a later, ordinary quit. The wait is bounded so a stalled disk can
// never make the app unquittable. With no pending write (no What's New
// window, or Help only) this returns immediately: the normal quit path is
// untouched.
const SEEN_WRITE_QUIT_TIMEOUT_MS = 3000;
app.on('will-quit', (event) => {
  if (!pendingSeenWrite) return;
  event.preventDefault();
  const pending = pendingSeenWrite;
  pendingSeenWrite = null;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, SEEN_WRITE_QUIT_TIMEOUT_MS));
  // Re-quit on a fresh tick, after this handler has returned to Electron: an
  // app.quit() issued synchronously from a microtask inside the handler is
  // ignored while the prevented quit is still being unwound, leaving the app
  // stuck open.
  void Promise.race([pending, timeout]).finally(() => setImmediate(() => app.quit()));
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

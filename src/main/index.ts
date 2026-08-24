import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import * as fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { defaultWindowOptions } from './windowConfig';
import { markdownToHtml } from './markdown';
import { baseUrlForFile } from './paths';
import { watchFile } from './watcher';
import { isExternalHttpUrl } from './linkPolicy';
import { buildMenuTemplate } from './menu';
import type { ViewSettings, MenuHandlers } from './menu';
import { extractFrontmatter } from './frontmatter';
import { shouldSetDockIcon } from './dockIcon';
import { shouldCreateHelpWindow, buildHelpHtml } from './helpWindow';
import type { FSWatcher } from 'chokidar';
import { filterAndSortEntries } from './fileTree';
import { IPC_CHANNELS } from '../preload/api';
import type { FileRenderedMessage, DirectoryListResult, FolderTreeRootMessage } from '../preload/api';

let mainWindow: BrowserWindow | null = null;
let activeWatcher: FSWatcher | null = null;
let helpWindow: BrowserWindow | null = null;

// Session-scoped, never persisted (functional_domain.md Task 8 guardrail #6):
// resets to this exact default on every launch, regardless of a prior
// session's choices.
let viewSettings: ViewSettings = { darkMode: false, showFrontmatter: true, showTreePanel: true };

// Session-scoped, never persisted — same explicit precedent as viewSettings's
// "resets to this exact default on every launch" comment above.
let currentTreeRoot: string | null = null;

function broadcastViewSettings(): void {
  mainWindow?.webContents.send(IPC_CHANNELS.VIEW_SETTINGS, viewSettings);
}

function setDarkMode(checked: boolean): void {
  viewSettings = { ...viewSettings, darkMode: checked };
  broadcastViewSettings();
}

function setShowFrontmatter(checked: boolean): void {
  viewSettings = { ...viewSettings, showFrontmatter: checked };
  broadcastViewSettings();
}

function setShowTreePanel(checked: boolean): void {
  viewSettings = { ...viewSettings, showTreePanel: checked };
  broadcastViewSettings();
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
    onOpenHelp,
  };
}

function applyMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(menuHandlers(), viewSettings)));
}

// Task 29: which buildMenuTemplate() index a title-bar label section maps
// to. Pure lookup, zero Electron runtime -- unit-testable in isolation, same
// tier as shouldSkipDevToolsShortcut immediately below.
export function menuSectionIndex(section: 'file' | 'view' | 'help'): number {
  return { file: 0, view: 1, help: 2 }[section];
}

// Called by the two "browse a folder" actions (openFolderViaDialog and the
// dropped/opened-directory branch of REQUEST_OPEN_FILE) -- never by
// renderAndWatch (single-file open must never touch showTreePanel in either
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
    return { ok: true, filePath, html: markdownToHtml(body), baseUrl: baseUrlForFile(filePath), frontmatter };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, filePath, error: message };
  }
}

function sendToRenderer(message: FileRenderedMessage): void {
  mainWindow?.webContents.send(IPC_CHANNELS.FILE_RENDERED, message);
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

function stopWatching(): void {
  activeWatcher?.close();
  activeWatcher = null;
}

function startWatching(filePath: string): void {
  stopWatching(); // exactly one watcher active at a time — always close the old one first
  activeWatcher = watchFile(filePath, () => {
    renderFile(filePath).then(sendToRenderer);
  });
}

async function renderAndWatch(filePath: string): Promise<void> {
  const message = await renderFile(filePath);
  sendToRenderer(message);
  if (message.ok) {
    startWatching(filePath);
  }
  await establishTreeRoot(path.dirname(filePath));
}

async function openFileViaDialog(): Promise<void> {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  await renderAndWatch(result.filePaths[0]);
}

async function openFolderViaDialog(): Promise<void> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return;
  forceShowTreePanelAndRebuildMenu();
  await establishTreeRoot(result.filePaths[0]);
}

async function onOpenHelp(): Promise<void> {
  if (!shouldCreateHelpWindow(helpWindow)) {
    helpWindow?.focus();
    return;
  }

  const source = await fs.readFile(path.join(__dirname, 'help', 'help.md'), 'utf8');
  const contentHtml = markdownToHtml(source);
  const cssHrefs = [
    pathToFileURL(path.join(__dirname, '../renderer/app.css')).href,
    pathToFileURL(path.join(__dirname, '../renderer/github-markdown-light.css')).href,
    pathToFileURL(path.join(__dirname, '../renderer/github.css')).href,
  ];
  const html = buildHelpHtml(contentHtml, cssHrefs);

  helpWindow = new BrowserWindow({
    ...defaultWindowOptions,
    webPreferences: {
      ...defaultWindowOptions.webPreferences,
    },
  });

  // The Help window is static, read-only, app-authored content. On
  // Windows/Linux, Menu.setApplicationMenu() becomes the default menu for
  // every BrowserWindow unless that window explicitly clears it — without
  // this, the Help window would expose the full File/View/Help bar and its
  // live handlers (openFileViaDialog, setDarkMode, setShowFrontmatter, even
  // onOpenHelp itself) behind what should be a static help screen.
  // Unconditional: removeMenu() is a documented no-op on macOS (menu bar
  // there is process-wide via Menu.setApplicationMenu, not per-window), so
  // no platform branch is needed.
  helpWindow.removeMenu();

  helpWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault(); // unconditional, before any URL classification — same safety property as the main window
    if (isExternalHttpUrl(url)) {
      shell.openExternal(url);
    }
  });

  helpWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  helpWindow.on('closed', () => {
    helpWindow = null;
  });

  try {
    await helpWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  } catch {
    // Navigation can be aborted (ERR_FAILED) if the window is closed while
    // the data: URL is still loading — not a real failure to surface, just
    // a race between window teardown and an in-flight load.
  }
}

app.whenReady().then(() => {
  createWindow();

  if (shouldSetDockIcon(app.isPackaged, process.platform)) {
    app.dock.setIcon(path.join(__dirname, 'icon.png'));
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
      renderAndWatch(filePath);
    });
  }

  // Task 16: drag-and-drop file open. The renderer resolves the dropped
  // File's real filesystem path (via webUtils.getPathForFile, which must run
  // in preload — see src/preload/index.ts) and sends it here, fire-and-
  // forget. All validation (extension check, existence, read errors) is
  // owned exclusively by renderFile() via renderAndWatch() — never
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
      // through to the existing renderAndWatch/renderFile error path
      // below, unchanged from today's behavior. Do not add a second,
      // parallel error-handling branch here.
    }

    if (isDirectory) {
      forceShowTreePanelAndRebuildMenu();
      await establishTreeRoot(filePath);
      return;
    }

    renderAndWatch(filePath);
  });

  // Task 17: first request-response IPC pair in the app (ipcMain.handle /
  // ipcRenderer.invoke) — every other channel above is fire-and-forget.
  ipcMain.handle(IPC_CHANNELS.REQUEST_LIST_DIRECTORY, (_e, dirPath: string) => listDirectoryEntries(dirPath));

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
    const template = buildMenuTemplate(menuHandlers(), viewSettings);
    Menu.buildFromTemplate(template[index].submenu as MenuItemConstructorOptions[]).popup({
      window: mainWindow ?? undefined,
      x,
      y,
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', stopWatching);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import * as path from 'path';
import * as fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { defaultWindowOptions } from './windowConfig';
import { markdownToHtml } from './markdown';
import { baseUrlForFile } from './paths';
import { watchFile } from './watcher';
import { isExternalHttpUrl } from './linkPolicy';
import { buildMenuTemplate } from './menu';
import type { ViewSettings } from './menu';
import { extractFrontmatter } from './frontmatter';
import { shouldSetDockIcon } from './dockIcon';
import { shouldCreateHelpWindow, buildHelpHtml } from './helpWindow';
import type { FSWatcher } from 'chokidar';
import { IPC_CHANNELS } from '../preload/api';
import type { FileRenderedMessage } from '../preload/api';

let mainWindow: BrowserWindow | null = null;
let activeWatcher: FSWatcher | null = null;
let helpWindow: BrowserWindow | null = null;

// Session-scoped, never persisted (functional_domain.md Task 8 guardrail #6):
// resets to this exact default on every launch, regardless of a prior
// session's choices.
let viewSettings: ViewSettings = { darkMode: false, showFrontmatter: true };

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    ...defaultWindowOptions,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      ...defaultWindowOptions.webPreferences,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

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
}

async function openFileViaDialog(): Promise<void> {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  await renderAndWatch(result.filePaths[0]);
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

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate(
        {
          onOpen: openFileViaDialog,
          onToggleDarkMode: setDarkMode,
          onToggleShowFrontmatter: setShowFrontmatter,
          onOpenHelp,
        },
        viewSettings
      )
    )
  );

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
  ipcMain.on(IPC_CHANNELS.REQUEST_OPEN_FILE, (_event, filePath: string) => {
    if (typeof filePath === 'string' && filePath.length > 0) {
      renderAndWatch(filePath);
    }
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

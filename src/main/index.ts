import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'node:fs/promises';
import { defaultWindowOptions } from './windowConfig';
import { markdownToHtml } from './markdown';
import { watchFile } from './watcher';
import type { FSWatcher } from 'chokidar';
import { IPC_CHANNELS } from '../preload/api';
import type { FileRenderedMessage } from '../preload/api';

let mainWindow: BrowserWindow | null = null;
let activeWatcher: FSWatcher | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    ...defaultWindowOptions,
    webPreferences: {
      ...defaultWindowOptions.webPreferences,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

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
    return { ok: true, filePath, html: markdownToHtml(source) };
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

ipcMain.on(IPC_CHANNELS.OPEN_FILE_DIALOG, async () => {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  await renderAndWatch(result.filePaths[0]);
});

app.whenReady().then(() => {
  createWindow();

  const filePath = argvFilePath();
  if (filePath !== null) {
    // Register the listener synchronously, before any await, so it cannot
    // miss a did-finish-load that fires while renderFile() is still reading
    // the file from disk.
    mainWindow?.webContents.once('did-finish-load', () => {
      renderAndWatch(filePath);
    });
  }
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

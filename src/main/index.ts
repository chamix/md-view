import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'node:fs/promises';
import { defaultWindowOptions } from './windowConfig';
import { markdownToHtml } from './markdown';
import { IPC_CHANNELS } from '../preload/api';
import type { FileRenderedMessage } from '../preload/api';

let mainWindow: BrowserWindow | null = null;

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

ipcMain.on(IPC_CHANNELS.OPEN_FILE_DIALOG, async () => {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  sendToRenderer(await renderFile(result.filePaths[0]));
});

app.whenReady().then(() => {
  createWindow();

  const filePath = argvFilePath();
  if (filePath !== null) {
    // Register the listener synchronously, before any await, so it cannot
    // miss a did-finish-load that fires while renderFile() is still reading
    // the file from disk.
    mainWindow?.webContents.once('did-finish-load', () => {
      renderFile(filePath).then(sendToRenderer);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

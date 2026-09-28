import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test as base, expect } from './support/fixtures';
import { expectPristineDocumentView } from './support/pristine';

// Task 47 approval condition 1 (b). With awaitWriteFinish a change is
// reported only after the file has been stable for 100 ms, and chokidar's
// close() does not cancel that pending check. documentSlot.beginRender()
// returns the CURRENT epoch, so a watcher callback after Close would start a
// render that is delivered and re-occupies the slot (resurrection, #147/#148).
// Close inside the write-finish window must therefore produce no
// FILE_RENDERED at all.

const test = base.extend<{ docFile: string }>({
  docFile: async ({}, use) => {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-pending-')));
    const file = path.join(dir, 'doc.md');
    fs.writeFileSync(file, '# Pending Doc Heading\n');
    await use(file);
    fs.rmSync(dir, { recursive: true, force: true });
  },
});

interface Spy {
  fileRenderedAt: number[];
}

async function openViaMenu(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, targetPath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [targetPath] })) as typeof dialog.showOpenDialog;
  }, filePath);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click());
}

function menuCloseEnabled(app: ElectronApplication): Promise<boolean | undefined> {
  return app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-close')?.enabled);
}

// Records the main-side time of every FILE_RENDERED send.
async function installSendSpy(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const bag = globalThis as unknown as { __mdViewT47Spy: Spy };
    bag.__mdViewT47Spy = { fileRenderedAt: [] };
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    const originalSend = wc.send.bind(wc);
    wc.send = ((channel: string, ...args: unknown[]) => {
      if (channel === 'md-view:file-rendered') bag.__mdViewT47Spy.fileRenderedAt.push(Date.now());
      originalSend(channel, ...args);
    }) as typeof wc.send;
  });
}

function readSpy(app: ElectronApplication): Promise<Spy> {
  return app.evaluate(() => (globalThis as unknown as { __mdViewT47Spy: Spy }).__mdViewT47Spy);
}

// Positive control: the watcher is live (it becomes ready asynchronously,
// so re-save until a change is observed; this never weakens the negative
// assertion below).
async function saveUntilRendered(window: Page, filePath: string, heading: string): Promise<void> {
  await expect(async () => {
    await fsp.writeFile(filePath, '# ' + heading + '\n');
    await expect(window.locator('#content')).toContainText(heading, { timeout: 1500 });
  }).toPass({ timeout: 15000 });
}

test('Close during a pending write-finish check sends no FILE_RENDERED and leaves the view pristine (condition 1b, #147/#148)', async ({
  electronApp,
  docFile,
}) => {
  const window = await electronApp.firstWindow();
  await openViaMenu(electronApp, docFile);
  await expect(window.locator('#content')).toContainText('Pending Doc Heading', { timeout: 10000 });
  await saveUntilRendered(window, docFile, 'Watcher Is Live');

  await installSendSpy(electronApp);

  // Write, then Close, both from main so the gap is measured on one clock
  // and is not stretched by test-runner IPC. The 20 ms pause lets the raw
  // fs notification reach chokidar, so a write-finish check is pending.
  const timing = await electronApp.evaluate(async ({ Menu }, filePath) => {
    const req = (process as unknown as { mainModule: NodeJS.Module }).mainModule.require;
    const mainFsp = req('node:fs/promises') as typeof import('node:fs/promises');
    await mainFsp.writeFile(filePath, '# Written Just Before Close\n');
    const writtenAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const closedAt = Date.now();
    Menu.getApplicationMenu()?.getMenuItemById('menu-close')?.click();
    return { writtenAt, closedAt };
  }, docFile);

  const gap = timing.closedAt - timing.writtenAt;
  if (gap >= 60) throw new Error(`precondition not met: Close ran ${gap} ms after the write (need < 60 ms)`);

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const spy = await readSpy(electronApp);
  expect(spy.fileRenderedAt.filter((at) => at >= timing.closedAt)).toEqual([]);
  await expectPristineDocumentView(window);
  expect(await menuCloseEnabled(electronApp)).toBe(false);
});

import * as path from 'path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { test, expect, _electron as electron } from '@playwright/test';

// The host shell may set ELECTRON_RUN_AS_NODE=1 (e.g. some CI/dev-tool
// environments), which forces any Electron binary to run as plain Node
// instead of booting the Electron runtime (app/BrowserWindow become
// undefined). Strip it from the child process env so the launched app
// always runs as real Electron regardless of the parent shell's env.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const fixturePath = path.join(process.cwd(), 'tests/e2e/fixtures/sample.md');

test('live-reloads rendered content when the open file changes on disk', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-reload-'));
  const tmpFile = path.join(tmpDir, 'sample.md');
  fs.copyFileSync(fixturePath, tmpFile);

  try {
    const app = await electron.launch({
      args: [path.join(process.cwd(), 'dist/main/index.js'), tmpFile],
      env: childEnv,
    });

    const window = await app.firstWindow();
    const content = window.locator('#content');
    await expect(content).toContainText('Playwright Fixture Heading', { timeout: 10000 });

    await fsp.writeFile(tmpFile, '# Live Reloaded Heading\n\nUpdated body text.');

    await expect(content).toContainText('Live Reloaded Heading', { timeout: 10000 });

    await app.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('closes the previous file\'s watcher on switch — edits to the abandoned file no longer trigger a re-render', async () => {
  const tmpDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-reload-a-'));
  const tmpDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-reload-b-'));
  const fileA = path.join(tmpDirA, 'fileA.md');
  const fileB = path.join(tmpDirB, 'fileB.md');
  fs.writeFileSync(fileA, '# File A Heading\n\nOriginal A body.');
  fs.writeFileSync(fileB, '# File B Heading\n\nOriginal B body.');

  try {
    const app = await electron.launch({
      args: [path.join(process.cwd(), 'dist/main/index.js'), fileA],
      env: childEnv,
    });

    const window = await app.firstWindow();
    const content = window.locator('#content');
    await expect(content).toContainText('File A Heading', { timeout: 10000 });

    // Switch to File B via the dialog trigger, exactly like the non-.md
    // dialog test in open-file-argv.spec.ts: mock dialog.showOpenDialog in
    // the main process and drive it through the native File > Open… menu
    // item (menu-open), since there is no in-page button anymore.
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [filePath],
      })) as typeof dialog.showOpenDialog;
    }, fileB);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click());

    await expect(content).toContainText('File B Heading', { timeout: 10000 });

    // The actual proof: edit the file we've switched away from. If A's
    // watcher were still active, this would trigger a spurious re-render
    // (index.ts's exactly-one-watcher invariant would be violated) and
    // #content would flip back to A's content. A bounded wait gives any
    // leftover watcher plenty of time to fire before we assert nothing
    // changed.
    await fsp.writeFile(fileA, '# File A Heading Changed\n\nA was edited after switching away.');
    await window.waitForTimeout(1500);

    await expect(content).toContainText('File B Heading', { timeout: 1000 });
    await expect(content).not.toContainText('File A Heading Changed');

    await app.close();
  } finally {
    fs.rmSync(tmpDirA, { recursive: true, force: true });
    fs.rmSync(tmpDirB, { recursive: true, force: true });
  }
});

test('shows a visible error state when the open file is deleted, and does not crash', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-reload-'));
  const tmpFile = path.join(tmpDir, 'sample.md');
  fs.copyFileSync(fixturePath, tmpFile);

  try {
    const app = await electron.launch({
      args: [path.join(process.cwd(), 'dist/main/index.js'), tmpFile],
      env: childEnv,
    });

    const window = await app.firstWindow();
    const content = window.locator('#content');
    await expect(content).toContainText('Playwright Fixture Heading', { timeout: 10000 });

    await fsp.unlink(tmpFile);

    await expect(content).toContainText('Could not open file', { timeout: 10000 });

    // App is still alive/responsive after the watch-triggered error, not crashed.
    expect(app.windows().length).toBeGreaterThan(0);

    await app.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

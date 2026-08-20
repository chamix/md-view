import * as path from 'path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { test as base, expect } from './support/fixtures';

const fixturePath = path.join(process.cwd(), 'tests/e2e/fixtures/sample.md');

// Both single-file reload tests (primer + deleted-file) need one tmp copy of
// sample.md as their argv-opened file. Overriding the `electronArgs` fixture
// (rather than the base `electronApp` fixture itself) keeps the launch/
// teardown/userDataDir-isolation logic centralized in support/fixtures.ts —
// this only supplies the dynamic per-test argv value that test.use() cannot,
// since the tmp path doesn't exist until a fixture actually runs.
const testWithTmpFile = base.extend<{ tmpFile: string }>({
  tmpFile: async ({}, use) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-reload-'));
    const tmpFile = path.join(tmpDir, 'sample.md');
    fs.copyFileSync(fixturePath, tmpFile);
    await use(tmpFile);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  },
  electronArgs: async ({ tmpFile }, use) => {
    await use([tmpFile]);
  },
});

testWithTmpFile('live-reloads rendered content when the open file changes on disk', async ({ electronApp, tmpFile }) => {
  const window = await electronApp.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Playwright Fixture Heading', { timeout: 10000 });

  await fsp.writeFile(tmpFile, '# Live Reloaded Heading\n\nUpdated body text.');

  await expect(content).toContainText('Live Reloaded Heading', { timeout: 10000 });
});

testWithTmpFile('shows a visible error state when the open file is deleted, and does not crash', async ({ electronApp, tmpFile }) => {
  const window = await electronApp.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Playwright Fixture Heading', { timeout: 10000 });

  await fsp.unlink(tmpFile);

  await expect(content).toContainText('Could not open file', { timeout: 10000 });

  // App is still alive/responsive after the watch-triggered error, not crashed.
  expect(electronApp.windows().length).toBeGreaterThan(0);
});

// The watcher-switch test opens fileA via argv, then switches to fileB via
// the dialog mid-test — both files' tmp dirs need their own fixture-owned
// creation/cleanup, distinct from the single-tmp-file shape above.
const testSwitchFiles = base.extend<{ fileA: string; fileB: string }>({
  fileA: async ({}, use) => {
    const tmpDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-reload-a-'));
    const fileA = path.join(tmpDirA, 'fileA.md');
    fs.writeFileSync(fileA, '# File A Heading\n\nOriginal A body.');
    await use(fileA);
    fs.rmSync(tmpDirA, { recursive: true, force: true });
  },
  fileB: async ({}, use) => {
    const tmpDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-reload-b-'));
    const fileB = path.join(tmpDirB, 'fileB.md');
    fs.writeFileSync(fileB, '# File B Heading\n\nOriginal B body.');
    await use(fileB);
    fs.rmSync(tmpDirB, { recursive: true, force: true });
  },
  electronArgs: async ({ fileA }, use) => {
    await use([fileA]);
  },
});

testSwitchFiles('closes the previous file\'s watcher on switch — edits to the abandoned file no longer trigger a re-render', async ({ electronApp, fileA, fileB }) => {
  const window = await electronApp.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('File A Heading', { timeout: 10000 });

  // Switch to File B via the dialog trigger, exactly like the non-.md
  // dialog test in open-file-argv.spec.ts: mock dialog.showOpenDialog in
  // the main process and drive it through the native File > Open… menu
  // item (menu-open), since there is no in-page button anymore.
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [filePath],
    })) as typeof dialog.showOpenDialog;
  }, fileB);
  await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click());

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
});

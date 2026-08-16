import * as path from 'path';
import { test, expect, _electron as electron } from '@playwright/test';

// The host shell may set ELECTRON_RUN_AS_NODE=1 (e.g. some CI/dev-tool
// environments), which forces any Electron binary to run as plain Node
// instead of booting the Electron runtime (app/BrowserWindow become
// undefined). Strip it from the child process env so the launched app
// always runs as real Electron regardless of the parent shell's env.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

function clickHelpMenu(app: Awaited<ReturnType<typeof electron.launch>>) {
  return app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-help')?.click());
}

test('(a) triggering menu-help opens a second window showing help.md content', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const mainWindow = await app.firstWindow();
  void mainWindow;

  const [helpWindow] = await Promise.all([app.waitForEvent('window'), clickHelpMenu(app)]);

  await expect(helpWindow.locator('body')).toContainText('minimal desktop Markdown previewer', { timeout: 10000 });

  await app.close();
});

test('(b) triggering menu-help twice still yields exactly 2 total windows', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  await app.firstWindow();

  const [helpWindow] = await Promise.all([app.waitForEvent('window'), clickHelpMenu(app)]);
  await expect(helpWindow.locator('body')).toContainText('minimal desktop Markdown previewer', { timeout: 10000 });

  await clickHelpMenu(app);
  // Give a potential (incorrect) second window creation a moment to surface.
  await helpWindow.waitForTimeout(300);

  expect(app.windows().length).toBe(2);

  await app.close();
});

test('(c) the Help window has no window.mdview bridge', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  await app.firstWindow();

  const [helpWindow] = await Promise.all([app.waitForEvent('window'), clickHelpMenu(app)]);
  await expect(helpWindow.locator('body')).toContainText('minimal desktop Markdown previewer', { timeout: 10000 });

  const mdview = await helpWindow.evaluate(() => (window as unknown as { mdview?: unknown }).mdview);
  expect(mdview).toBeUndefined();

  await app.close();
});

test('(d) closing the Help window and reopening it succeeds', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  await app.firstWindow();

  const [helpWindow] = await Promise.all([app.waitForEvent('window'), clickHelpMenu(app)]);
  await expect(helpWindow.locator('body')).toContainText('minimal desktop Markdown previewer', { timeout: 10000 });

  await helpWindow.close();
  // A brief settle window after a native BrowserWindow destroy avoids a
  // known Playwright/Electron CDP-session race when a second `app.evaluate`
  // call races the just-closed window's teardown (observed empirically:
  // ~1/10 runs otherwise fail with "Target page, context or browser has
  // been closed" even though the app process itself is still alive).
  await new Promise((resolve) => setTimeout(resolve, 150));

  await clickHelpMenu(app);
  const reopenedHelpWindow = await app.waitForEvent('window');
  await expect(reopenedHelpWindow.locator('body')).toContainText('minimal desktop Markdown previewer', {
    timeout: 10000,
  });

  expect(app.windows().length).toBe(2);

  await app.close();
});

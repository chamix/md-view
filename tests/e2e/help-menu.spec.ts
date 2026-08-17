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

test('(e) the Help window has no menu: its inherited CmdOrCtrl+O accelerator cannot reach the file-open handler', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const mainWindow = await app.firstWindow();

  const [helpWindow] = await Promise.all([app.waitForEvent('window'), clickHelpMenu(app)]);
  await expect(helpWindow.locator('body')).toContainText('minimal desktop Markdown previewer', { timeout: 10000 });

  // Rationale (review_report_task15.md B-1): isMenuBarVisible() only proves
  // the bar isn't rendered — it returns false under setMenuBarVisibility(false)
  // too, which leaves the menu (and its local accelerators, per Electron's
  // own autoHideMenuBar docs) fully attached. A genuinely detached menu
  // (removeMenu()) has no local accelerator table at all, so its window's
  // CmdOrCtrl+O can never reach menu.ts's 'menu-open' click handler
  // (openFileViaDialog -> dialog.showOpenDialog). We stub showOpenDialog to a
  // counter so firing is observable without a blocking native dialog, and
  // dispatch the accelerator via webContents.sendInputEvent from the main
  // process (Playwright's CDP-level page.keyboard.press was tried first and
  // never reached Electron's native accelerator table on either window, even
  // the main one — sendInputEvent does, confirmed empirically). We prove the
  // mechanism can detect "accelerator fired" at all by exercising it on the
  // focused main window first — otherwise a "the counter never moves" test
  // would trivially pass regardless of the fix and prove nothing.
  await app.evaluate(({ dialog }) => {
    const bag = globalThis as unknown as { __mdViewOpenDialogCalls: number };
    bag.__mdViewOpenDialogCalls = 0;
    dialog.showOpenDialog = () => {
      bag.__mdViewOpenDialogCalls += 1;
      return Promise.resolve({ canceled: true, filePaths: [] });
    };
  });

  async function sendCtrlOAndReadCount(isHelpTarget: boolean): Promise<number> {
    await app.evaluate(
      ({ BrowserWindow }, wantHelp) => {
        const target = BrowserWindow.getAllWindows().find(
          (w) => w.webContents.getURL().startsWith('data:text/html') === wantHelp
        );
        target?.focus();
        target?.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'O', modifiers: ['control'] });
        target?.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'O', modifiers: ['control'] });
      },
      isHelpTarget
    );
    await mainWindow.waitForTimeout(300);
    return app.evaluate(() => (globalThis as unknown as { __mdViewOpenDialogCalls: number }).__mdViewOpenDialogCalls);
  }

  // Sanity check: the main window still carries the real application menu,
  // so its local CmdOrCtrl+O accelerator must reach the handler — this
  // proves the observable can actually detect "accelerator fired".
  const afterMain = await sendCtrlOAndReadCount(false);
  expect(afterMain).toBeGreaterThan(0);

  await app.evaluate(() => {
    (globalThis as unknown as { __mdViewOpenDialogCalls: number }).__mdViewOpenDialogCalls = 0;
  });

  // The actual guardrail: focused on the Help window, the same accelerator
  // must NOT reach openFileViaDialog, because the Help window's menu is
  // genuinely detached (not merely hidden).
  const afterHelp = await sendCtrlOAndReadCount(true);
  expect(afterHelp).toBe(0);

  await app.close();
});

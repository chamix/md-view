import type { ElectronApplication } from '@playwright/test';
import { test, expect } from './support/fixtures';

function clickHelpMenu(app: ElectronApplication) {
  return app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-help')?.click());
}

test('(a) triggering menu-help opens a second window showing help.md content', async ({ electronApp }) => {
  const mainWindow = await electronApp.firstWindow();
  void mainWindow;

  const [helpWindow] = await Promise.all([electronApp.waitForEvent('window'), clickHelpMenu(electronApp)]);

  await expect(helpWindow.locator('body')).toContainText('minimal desktop Markdown previewer', { timeout: 10000 });
});

test('(b) triggering menu-help twice still yields exactly 2 total windows', async ({ electronApp }) => {
  await electronApp.firstWindow();

  const [helpWindow] = await Promise.all([electronApp.waitForEvent('window'), clickHelpMenu(electronApp)]);
  await expect(helpWindow.locator('body')).toContainText('minimal desktop Markdown previewer', { timeout: 10000 });

  await clickHelpMenu(electronApp);
  // Give a potential (incorrect) second window creation a moment to surface.
  await helpWindow.waitForTimeout(300);

  expect(electronApp.windows().length).toBe(2);
});

test('(c) the Help window has no window.mdview bridge', async ({ electronApp }) => {
  await electronApp.firstWindow();

  const [helpWindow] = await Promise.all([electronApp.waitForEvent('window'), clickHelpMenu(electronApp)]);
  await expect(helpWindow.locator('body')).toContainText('minimal desktop Markdown previewer', { timeout: 10000 });

  const mdview = await helpWindow.evaluate(() => (window as unknown as { mdview?: unknown }).mdview);
  expect(mdview).toBeUndefined();
});

test('(d) closing the Help window and reopening it succeeds', async ({ electronApp }) => {
  await electronApp.firstWindow();

  const [helpWindow] = await Promise.all([electronApp.waitForEvent('window'), clickHelpMenu(electronApp)]);
  await expect(helpWindow.locator('body')).toContainText('minimal desktop Markdown previewer', { timeout: 10000 });

  await helpWindow.close();
  // A brief settle window after a native BrowserWindow destroy avoids a
  // known Playwright/Electron CDP-session race when a second `app.evaluate`
  // call races the just-closed window's teardown (observed empirically:
  // ~1/10 runs otherwise fail with "Target page, context or browser has
  // been closed" even though the app process itself is still alive).
  await new Promise((resolve) => setTimeout(resolve, 150));

  await clickHelpMenu(electronApp);
  const reopenedHelpWindow = await electronApp.waitForEvent('window');
  await expect(reopenedHelpWindow.locator('body')).toContainText('minimal desktop Markdown previewer', {
    timeout: 10000,
  });

  expect(electronApp.windows().length).toBe(2);
});

test('(e) the Help window has no menu: its inherited CmdOrCtrl+O accelerator cannot reach the file-open handler', async ({ electronApp }) => {
  const mainWindow = await electronApp.firstWindow();

  const [helpWindow] = await Promise.all([electronApp.waitForEvent('window'), clickHelpMenu(electronApp)]);
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
  await electronApp.evaluate(({ dialog }) => {
    const bag = globalThis as unknown as { __mdViewOpenDialogCalls: number };
    bag.__mdViewOpenDialogCalls = 0;
    dialog.showOpenDialog = () => {
      bag.__mdViewOpenDialogCalls += 1;
      return Promise.resolve({ canceled: true, filePaths: [] });
    };
  });

  async function sendCtrlOAndReadCount(isHelpTarget: boolean): Promise<number> {
    await electronApp.evaluate(
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
    return electronApp.evaluate(() => (globalThis as unknown as { __mdViewOpenDialogCalls: number }).__mdViewOpenDialogCalls);
  }

  // Sanity check: the main window still carries the real application menu,
  // so its local CmdOrCtrl+O accelerator must reach the handler — this
  // proves the observable can actually detect "accelerator fired".
  const afterMain = await sendCtrlOAndReadCount(false);
  expect(afterMain).toBeGreaterThan(0);

  await electronApp.evaluate(() => {
    (globalThis as unknown as { __mdViewOpenDialogCalls: number }).__mdViewOpenDialogCalls = 0;
  });

  // The actual guardrail: focused on the Help window, the same accelerator
  // must NOT reach openFileViaDialog, because the Help window's menu is
  // genuinely detached (not merely hidden).
  const afterHelp = await sendCtrlOAndReadCount(true);
  expect(afterHelp).toBe(0);
});

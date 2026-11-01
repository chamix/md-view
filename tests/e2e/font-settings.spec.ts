import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { test, expect } from './support/fixtures';

// Task 56: same clickItem/itemChecked helpers as skins-menu.spec.ts /
// skins-persistence.spec.ts -- clicking a native menu item by id via the
// real application menu, never a second hand-built invoker.
const clickItem = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click(), id);

// Task 55 (functional_domain.md #52-#58; initial_scaffold.md Task 55).
// Mirrors tests/e2e/skins-persistence.spec.ts's "focus re-read (#216)"
// shape: hand-edit settings.json, emit the main window's real 'focus'
// listener, assert the resulting --font-ui/--font-code custom property on
// document.body. No new channel/window/menu item is exercised here -- the
// existing VIEW_SETTINGS broadcast path carries the two new fields.

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')) as { version: string };
// Keeps What's New out of the way (no window, no state write).
const STATE_JSON = JSON.stringify({ lastSeenVersion: pkg.version });

const settingsJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    View: {
      'Dark Mode': false,
      'Show Frontmatter': true,
      'Show File Tree': true,
      'UI Font': '',
      'Code Font': '',
      ...over,
    },
  });

// Fires the main window's real 'focus' listener (onWindowFocus) without
// depending on OS focus: the handler is registered via mainWindow.on('focus').
// Identical to skins-persistence.spec.ts's emitFocus helper.
async function emitFocus(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/renderer/index.html'));
    main?.emit('focus');
  });
}

const fontVar = (page: import('@playwright/test').Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.body).getPropertyValue(n).trim(), name);

test.describe('focus re-read (#216 posture, Task 55)', () => {
  test.use({ initialUserDataFiles: { 'settings.json': settingsJson(), 'state.json': STATE_JSON } });

  test('picks up a valid external UI Font / Code Font edit on refocus', async ({ electronApp, userDataDir }) => {
    const window = await electronApp.firstWindow();
    const settingsPath = path.join(userDataDir, 'settings.json');

    expect(await fontVar(window, '--font-ui')).toBe('');
    expect(await fontVar(window, '--font-code')).toBe('');

    fs.writeFileSync(settingsPath, settingsJson({ 'UI Font': 'Fira Sans', 'Code Font': 'Fira Code' }), 'utf8');
    await emitFocus(electronApp);

    await expect.poll(() => fontVar(window, '--font-ui')).toBe('"Fira Sans"');
    await expect.poll(() => fontVar(window, '--font-code')).toBe('"Fira Code"');
  });

  test('reverting to the empty string on refocus removes the custom property (CSS fallback takes over)', async ({
    electronApp,
    userDataDir,
  }) => {
    const window = await electronApp.firstWindow();
    const settingsPath = path.join(userDataDir, 'settings.json');

    fs.writeFileSync(settingsPath, settingsJson({ 'UI Font': 'Fira Sans', 'Code Font': 'Fira Code' }), 'utf8');
    await emitFocus(electronApp);
    await expect.poll(() => fontVar(window, '--font-ui')).toBe('"Fira Sans"');

    fs.writeFileSync(settingsPath, settingsJson(), 'utf8');
    await emitFocus(electronApp);
    await expect.poll(() => fontVar(window, '--font-ui')).toBe('');
    await expect.poll(() => fontVar(window, '--font-code')).toBe('');
  });

  test('an unsafe external Code Font value is ignored entirely (whole-file collapse, #1/#104): no UI change, file untouched', async ({
    electronApp,
    userDataDir,
  }) => {
    const window = await electronApp.firstWindow();
    const settingsPath = path.join(userDataDir, 'settings.json');

    fs.writeFileSync(settingsPath, settingsJson({ 'UI Font': 'Fira Sans' }), 'utf8');
    await emitFocus(electronApp);
    await expect.poll(() => fontVar(window, '--font-ui')).toBe('"Fira Sans"');

    const unsafe = settingsJson({ 'UI Font': 'Fira Sans', 'Code Font': 'url(evil)' });
    fs.writeFileSync(settingsPath, unsafe, 'utf8');
    await emitFocus(electronApp);

    // Protective, not self-healing (#103): ignored entirely, previous state
    // kept, file left byte-identical, no .bak written.
    expect(await fontVar(window, '--font-ui')).toBe('"Fira Sans"');
    expect(await fontVar(window, '--font-code')).toBe('');
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(unsafe);
    expect(fs.existsSync(`${settingsPath}.bak`)).toBe(false);
  });
});

// Task 56 (#255-#259): the discoverable View > UI Font path. Selecting a
// preset from the native menu applies it immediately (--font-ui) and
// persists the raw preset string (never the 'Default' label) to
// settings.json, the same choke point setDarkMode/onSelectSkin already use.
test.describe('View > UI Font menu selection (Task 56)', () => {
  test.use({ initialUserDataFiles: { 'settings.json': settingsJson(), 'state.json': STATE_JSON } });

  test("selecting 'Segoe UI' from the UI Font menu updates --font-ui and persists 'UI Font': 'Segoe UI' (never 'Default')", async ({
    electronApp,
    userDataDir,
  }) => {
    const window = await electronApp.firstWindow();
    const settingsPath = path.join(userDataDir, 'settings.json');

    expect(await fontVar(window, '--font-ui')).toBe('');

    // UI_FONT_PRESETS = ['Default', 'Segoe UI', ...] -- index 1.
    await clickItem(electronApp, 'menu-ui-font-1');

    await expect.poll(() => fontVar(window, '--font-ui')).toBe('"Segoe UI"');
    await expect
      .poll(() => (JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>).View)
      .toMatchObject({ 'UI Font': 'Segoe UI' });
  });
});

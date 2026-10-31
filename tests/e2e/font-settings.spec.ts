import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { test, expect } from './support/fixtures';

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

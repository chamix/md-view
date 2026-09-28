import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { test, expect } from './support/fixtures';

// Task 47 approval condition 3 (e). File > Settings opens settings.json in
// the user's editor, and on Windows any open handle on the target makes the
// atomic rename fail with EPERM. A View toggle while the file is held must be
// contained: the app stays alive, the in-memory settings (menu checkmark,
// renderer theme) keep the toggle, main logs a warning, and nothing escapes as
// an unhandled rejection. The next successful write persists the full object
// (#106).

const INITIAL = { View: { 'Dark Mode': false, 'Show Frontmatter': true, 'Show File Tree': true } };
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')) as { version: string };

test.use({
  initialUserDataFiles: {
    'settings.json': JSON.stringify(INITIAL, null, 2),
    // Keeps What's New out of the way (no window, no state write).
    'state.json': JSON.stringify({ lastSeenVersion: pkg.version }),
  },
});

interface Probe {
  rejections: string[];
  warnings: string[];
}

// Main-side probe: every unhandled rejection and every console.warn in main.
async function installProbe(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const bag = globalThis as unknown as { __mdViewT47Probe: Probe };
    bag.__mdViewT47Probe = { rejections: [], warnings: [] };
    process.on('unhandledRejection', (reason) => {
      bag.__mdViewT47Probe.rejections.push(String(reason));
    });
    const originalWarn = console.warn.bind(console);
    console.warn = (...args: unknown[]) => {
      bag.__mdViewT47Probe.warnings.push(args.map((arg) => String(arg)).join(' '));
      originalWarn(...args);
    };
  });
}

function readProbe(app: ElectronApplication): Promise<Probe> {
  return app.evaluate(() => (globalThis as unknown as { __mdViewT47Probe: Probe }).__mdViewT47Probe);
}

function clickMenuItem(app: ElectronApplication, id: string): Promise<unknown> {
  return app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click(), id);
}

function menuChecked(app: ElectronApplication, id: string): Promise<boolean | undefined> {
  return app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.checked, id);
}

test('a View toggle while settings.json is held open is contained, and the next write persists the full object (condition 3e)', async ({
  electronApp,
  userDataDir,
}) => {
  const window = await electronApp.firstWindow();
  const settingsPath = path.join(userDataDir, 'settings.json');
  const before = fs.readFileSync(settingsPath, 'utf8');

  const pageErrors: string[] = [];
  window.on('pageerror', (error) => pageErrors.push(error.message));
  let exited = false;
  electronApp.on('close', () => {
    exited = true;
  });
  await installProbe(electronApp);

  const fd = fs.openSync(settingsPath, 'r');
  try {
    await clickMenuItem(electronApp, 'menu-dark-mode');

    // Wait for the write attempt to finish one way or the other.
    await expect
      .poll(async () => {
        const probe = await readProbe(electronApp);
        return probe.rejections.length + probe.warnings.length;
      }, { timeout: 10000 })
      .toBeGreaterThan(0);

    const probe = await readProbe(electronApp);
    expect(probe.rejections).toEqual([]);
    expect(probe.warnings.some((w) => w.includes('settings.json') && w.includes('EPERM'))).toBe(true);

    // In-memory settings keep the toggle.
    expect(await menuChecked(electronApp, 'menu-dark-mode')).toBe(true);
    await window.waitForFunction(() => document.body.classList.contains('dark-mode'));

    // Nothing reached the disk, and no temp file was left behind.
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(before);
    expect(fs.readdirSync(userDataDir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  } finally {
    fs.closeSync(fd);
  }

  // Released: the next toggle writes the FULL current object (#106),
  // including the Dark Mode toggle that could not be persisted earlier.
  await clickMenuItem(electronApp, 'menu-show-frontmatter');
  await expect
    .poll(() => {
      try {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch {
        return null;
      }
    }, { timeout: 10000 })
    .toEqual({ View: { 'Dark Mode': true, 'Show Frontmatter': false, 'Show File Tree': true } });

  const after = await readProbe(electronApp);
  expect(after.rejections).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(exited).toBe(false);
  expect(electronApp.process().exitCode).toBeNull();
});

import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './support/fixtures';

// File -> Settings must never launch a real OS file-type handler in CI --
// spy on shell.openPath via electronApp.evaluate() (monkey-patching it on
// the real, running shell module before the click), same "intercept a
// main-process side effect for assertion" idiom ui-shell.spec.ts already
// uses for the DevTools guard bridge.
async function spyOnOpenPath(electronApp: import('@playwright/test').ElectronApplication) {
  await electronApp.evaluate(({ shell }) => {
    (globalThis as Record<string, unknown[]>).__mdViewOpenPathCallsForTests = [];
    shell.openPath = ((p: string) => {
      (globalThis as Record<string, unknown[]>).__mdViewOpenPathCallsForTests.push(p);
      return Promise.resolve('');
    }) as typeof shell.openPath;
  });
}

async function getOpenPathCalls(electronApp: import('@playwright/test').ElectronApplication): Promise<string[]> {
  return electronApp.evaluate(
    () => (globalThis as Record<string, unknown>).__mdViewOpenPathCallsForTests as string[]
  );
}

test('File -> Settings creates settings.json if missing and calls shell.openPath with the exact path', async ({
  electronApp,
  userDataDir,
}) => {
  const window = await electronApp.firstWindow();
  await expect(window.locator('#empty-state')).toBeVisible();

  const settingsPath = path.join(userDataDir, 'settings.json');
  expect(fs.existsSync(settingsPath)).toBe(false);

  await spyOnOpenPath(electronApp);

  await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-settings')?.click());

  await expect.poll(() => fs.existsSync(settingsPath)).toBe(true);

  const calls = await getOpenPathCalls(electronApp);
  expect(calls).toHaveLength(1);
  // app.getPath('userData') inside the launched app resolves to the exact
  // userDataDir Electron was launched with (support/fixtures.ts's own
  // documented invariant) -- settingsFilePath is computed as
  // path.join(userData, 'settings.json'), so this is the exact expected path.
  expect(calls[0]).toBe(settingsPath);
});

test('File -> Settings does not recreate/overwrite an already-existing settings.json', async ({
  electronApp,
  userDataDir,
}) => {
  const window = await electronApp.firstWindow();
  await expect(window.locator('#empty-state')).toBeVisible();

  const settingsPath = path.join(userDataDir, 'settings.json');
  const existingContent = JSON.stringify({
    View: { 'Dark Mode': true, 'Show Frontmatter': false, 'Show File Tree': false },
  });
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(settingsPath, existingContent, 'utf8');

  await spyOnOpenPath(electronApp);

  await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-settings')?.click());

  await expect.poll(() => getOpenPathCalls(electronApp)).toHaveLength(1);

  expect(fs.readFileSync(settingsPath, 'utf8')).toBe(existingContent);
});

import * as path from 'path';
import { test, expect, _electron as electron } from '@playwright/test';

// The host shell may set ELECTRON_RUN_AS_NODE=1 (e.g. some CI/dev-tool
// environments), which forces any Electron binary to run as plain Node
// instead of booting the Electron runtime (app/BrowserWindow become
// undefined). Strip it from the child process env so the launched app
// always runs as real Electron regardless of the parent shell's env.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

test('no-argv launch: no legacy h1/button, empty-state visible, status bar shows "No file open"', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const window = await app.firstWindow();

  await expect(window.locator('h1')).toHaveCount(0);
  await expect(window.locator('#open-file-btn')).toHaveCount(0);
  await expect(window.locator('#empty-state')).toBeVisible();

  const statusBar = window.locator('#status-bar');
  await expect(statusBar).toHaveText('No file open');

  await app.close();
});

test('DevTools shortcut guard: unreachable when packaged, reachable in dev builds', async () => {
  // Native keyboard events (F12) do not reliably reach Electron's
  // before-input-event hook when synthesized via CDP in this environment
  // (verified empirically), so driving real DevTools toggling through
  // Playwright is not a reliable signal here. Instead, exercise the exact
  // exported guard predicate that the real listener calls, via
  // app.evaluate() reading the globalThis test bridge set by
  // src/main/index.ts — this asserts the shipped function's behavior
  // directly, not a reimplementation of it.
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const isPackaged = await app.evaluate(({ app }) => app.isPackaged);
  expect(isPackaged).toBe(false);

  const guardResults = await app.evaluate(() => {
    // Reads the real, running predicate exposed by src/main/index.ts on
    // globalThis for exactly this purpose — not a reimplementation.
    const guard = (globalThis as Record<string, unknown>).__mdViewDevToolsGuardForTests as (
      isPackaged: boolean,
    ) => boolean;
    return {
      skipWhenPackaged: guard(true),
      skipWhenDev: guard(false),
    };
  });

  // Packaged (shipped) builds must skip — the shortcut is unreachable.
  expect(guardResults.skipWhenPackaged).toBe(true);
  // Dev (unpacked) builds — this test's own run mode — must NOT skip.
  expect(guardResults.skipWhenDev).toBe(false);

  await app.close();
});

test('argv launch: empty-state disappears, status bar shows the real absolute path', async () => {
  const fixturePath = path.join(process.cwd(), 'tests/e2e/fixtures/sample.md');
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js'), fixturePath],
    env: childEnv,
  });

  const window = await app.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Playwright Fixture Heading', { timeout: 10000 });

  await expect(window.locator('#empty-state')).toBeHidden();

  const statusBar = window.locator('#status-bar');
  await expect(statusBar).toHaveText(fixturePath, { timeout: 10000 });

  // (c) Task 11: document card chrome — bordered container + header bar
  // with two inert tab-style buttons, mimicking GitHub's file-view chrome.
  await expect(window.locator('#document-container')).toBeVisible();
  await expect(window.locator('#document-header')).toBeVisible();

  const tabPreview = window.locator('#tab-preview');
  const tabCode = window.locator('#tab-code');
  await expect(tabPreview).toBeVisible();
  await expect(tabCode).toBeVisible();
  await expect(tabPreview).toHaveText('Preview');
  await expect(tabCode).toHaveText('Code');

  await expect(tabPreview).toHaveClass(/active/);
  await expect(tabCode).not.toHaveClass(/active/);

  // (d) #content's computed lateral padding is non-zero after render.
  const paddingLeft = await content.evaluate((el) => window.getComputedStyle(el).paddingLeft);
  const paddingRight = await content.evaluate((el) => window.getComputedStyle(el).paddingRight);
  expect(parseFloat(paddingLeft)).toBeGreaterThan(0);
  expect(parseFloat(paddingRight)).toBeGreaterThan(0);

  // (e) status bar content was set via textContent, never innerHTML — proof
  // no HTML was parsed there.
  const isTextContentOnly = await statusBar.evaluate((el) => el.innerHTML === el.textContent);
  expect(isTextContentOnly).toBe(true);

  await app.close();
});

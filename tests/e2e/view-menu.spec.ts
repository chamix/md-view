import * as path from 'path';
import { test, expect, _electron as electron } from '@playwright/test';

// The host shell may set ELECTRON_RUN_AS_NODE=1 (e.g. some CI/dev-tool
// environments), which forces any Electron binary to run as plain Node
// instead of booting the Electron runtime (app/BrowserWindow become
// undefined). Strip it from the child process env so the launched app
// always runs as real Electron regardless of the parent shell's env.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const fixturePath = path.join(process.cwd(), 'tests/e2e/fixtures/with-frontmatter/doc.md');

test('(a) frontmatter is visible with line-separated, legible content', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js'), fixturePath],
    env: childEnv,
  });

  const window = await app.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Frontmatter Fixture Heading', { timeout: 10000 });

  const frontmatter = window.locator('#frontmatter');
  await expect(frontmatter).toBeVisible();

  const lines = (await frontmatter.textContent())?.split('\n') ?? [];
  expect(lines.some((line) => line.includes('title: Frontmatter Fixture'))).toBe(true);
  expect(lines.some((line) => line.includes('tags: e2e, task8'))).toBe(true);

  await app.close();
});

test('(b) toggling Show Frontmatter off hides it without touching #content', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js'), fixturePath],
    env: childEnv,
  });

  const window = await app.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Frontmatter Fixture Heading', { timeout: 10000 });

  const frontmatter = window.locator('#frontmatter');
  await expect(frontmatter).toBeVisible();

  const contentBefore = await content.textContent();

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-show-frontmatter')?.click());

  await expect(frontmatter).toBeHidden();

  const contentAfter = await content.textContent();
  expect(contentAfter).toBe(contentBefore);

  await app.close();
});

test('(c) dark mode toggle flips link-disabled states and a real computed style', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js'), fixturePath],
    env: childEnv,
  });

  const window = await app.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Frontmatter Fixture Heading', { timeout: 10000 });

  const bgBefore = await window.evaluate(() => window.getComputedStyle(document.body).backgroundColor);

  // Collect page-level failures (console errors and failed network/file
  // requests) from before the toggle click through the end of the
  // assertions below — a stylesheet 404 caused by a wrongly-resolved
  // theme-link href surfaces as exactly this kind of failure.
  const consoleErrors: string[] = [];
  window.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const failedRequests: string[] = [];
  window.on('requestfailed', (request) => {
    failedRequests.push(`${request.url()} :: ${request.failure()?.errorText ?? 'unknown'}`);
  });

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-dark-mode')?.click());

  await window.waitForFunction(() => document.body.classList.contains('dark-mode'));

  const linkStates = await window.evaluate(() => ({
    markdownLightDisabled: (document.getElementById('theme-markdown-light') as HTMLLinkElement).disabled,
    markdownDarkDisabled: (document.getElementById('theme-markdown-dark') as HTMLLinkElement).disabled,
    hljsLightDisabled: (document.getElementById('theme-hljs-light') as HTMLLinkElement).disabled,
    hljsDarkDisabled: (document.getElementById('theme-hljs-dark') as HTMLLinkElement).disabled,
  }));

  expect(linkStates.markdownLightDisabled).toBe(true);
  expect(linkStates.markdownDarkDisabled).toBe(false);
  expect(linkStates.hljsLightDisabled).toBe(true);
  expect(linkStates.hljsDarkDisabled).toBe(false);

  const bgAfter = await window.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
  expect(bgAfter).not.toBe(bgBefore);

  // Real proof the dark stylesheet actually loaded and applied, not just
  // that applyDarkMode() flipped independent .disabled flags: the
  // dark-mode text color from github-markdown-dark.css's .markdown-body
  // rule (#f0f6fc), never the light value (#1f2328) and never browser-
  // default black (rgb(0, 0, 0)), which is what renders when the dark
  // stylesheet 404s and no color rule applies at all.
  const contentColor = await content.evaluate((el) => window.getComputedStyle(el).color);
  expect(contentColor).toBe('rgb(240, 246, 252)');

  // Each theme link's resolved href must stay anchored under the app's own
  // renderer directory, immune to <base href> having been retargeted to
  // the open file's own directory (Task 4). If resolution ever regresses
  // back to relying on <base href> at fetch time, these hrefs would
  // resolve under the fixture's directory instead.
  const linkHrefs = await window.evaluate(() => ({
    markdownLight: (document.getElementById('theme-markdown-light') as HTMLLinkElement).href,
    markdownDark: (document.getElementById('theme-markdown-dark') as HTMLLinkElement).href,
    hljsLight: (document.getElementById('theme-hljs-light') as HTMLLinkElement).href,
    hljsDark: (document.getElementById('theme-hljs-dark') as HTMLLinkElement).href,
  }));

  for (const href of Object.values(linkHrefs)) {
    expect(href).not.toContain('tests/e2e/fixtures');
  }

  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);

  await app.close();
});

test('(d) close-and-relaunch proves no persistence of view settings', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js'), fixturePath],
    env: childEnv,
  });

  const window = await app.firstWindow();
  await expect(window.locator('#content')).toContainText('Frontmatter Fixture Heading', { timeout: 10000 });

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-dark-mode')?.click());

  const checkedBeforeClose = await app.evaluate(
    ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-dark-mode')?.checked
  );
  expect(checkedBeforeClose).toBe(true);

  await app.close();

  const secondApp = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js'), fixturePath],
    env: childEnv,
  });

  const secondWindow = await secondApp.firstWindow();
  await expect(secondWindow.locator('#content')).toContainText('Frontmatter Fixture Heading', { timeout: 10000 });

  const checkedAfterRelaunch = await secondApp.evaluate(
    ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-dark-mode')?.checked
  );
  expect(checkedAfterRelaunch).toBe(false);

  await secondApp.close();
});

test("(e) #content's computed padding-bottom is non-zero", async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js'), fixturePath],
    env: childEnv,
  });

  const window = await app.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Frontmatter Fixture Heading', { timeout: 10000 });

  const paddingBottom = await content.evaluate((el) => window.getComputedStyle(el).paddingBottom);
  expect(parseFloat(paddingBottom)).toBeGreaterThan(0);

  await app.close();
});

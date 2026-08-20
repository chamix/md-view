import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _electron as electron } from '@playwright/test';
import { test, expect } from './support/fixtures';

const fixturePath = path.join(process.cwd(), 'tests/e2e/fixtures/with-frontmatter/doc.md');
const ENTRY_POINT = path.join(process.cwd(), 'dist/main/index.js');

test.use({ electronArgs: [fixturePath] });

test('(a) frontmatter is visible with line-separated, legible content', async ({ electronApp }) => {
  const window = await electronApp.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Frontmatter Fixture Heading', { timeout: 10000 });

  const frontmatter = window.locator('#frontmatter');
  await expect(frontmatter).toBeVisible();

  const lines = (await frontmatter.textContent())?.split('\n') ?? [];
  expect(lines.some((line) => line.includes('title: Frontmatter Fixture'))).toBe(true);
  expect(lines.some((line) => line.includes('tags: e2e, task8'))).toBe(true);
});

test('(b) toggling Show Frontmatter off hides it without touching #content', async ({ electronApp }) => {
  const window = await electronApp.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Frontmatter Fixture Heading', { timeout: 10000 });

  const frontmatter = window.locator('#frontmatter');
  await expect(frontmatter).toBeVisible();

  const contentBefore = await content.textContent();

  await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-show-frontmatter')?.click());

  await expect(frontmatter).toBeHidden();

  const contentAfter = await content.textContent();
  expect(contentAfter).toBe(contentBefore);
});

test('(c) dark mode toggle flips link-disabled states and a real computed style', async ({ electronApp }) => {
  const window = await electronApp.firstWindow();
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

  await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-dark-mode')?.click());

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
});

// (d) is the one call site in this suite that genuinely needs two full,
// sequential Electron launches within a single test (close, then relaunch,
// to prove view settings don't persist across a process restart) -- the
// standard one-launch-per-test `electronApp` fixture doesn't fit this shape.
// Deliberately reuses ONE fixture-style mkdtempSync userDataDir across both
// sequential launches (not the base fixture's per-test isolation, and not
// Electron's shared default profile either): this keeps this test isolated
// from other parallel workers (the actual bug this task fixes) while
// preserving the original test's real semantics -- second launch reopens
// the SAME on-disk profile the first launch just used, which is what
// actually proves "no persistence" rather than trivially passing because
// the two launches never shared a profile in the first place.
test('(d) close-and-relaunch proves no persistence of view settings', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-'));
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  try {
    const app = await electron.launch({
      args: [ENTRY_POINT, fixturePath],
      env: childEnv,
      userDataDir,
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
      args: [ENTRY_POINT, fixturePath],
      env: childEnv,
      userDataDir,
    });

    const secondWindow = await secondApp.firstWindow();
    await expect(secondWindow.locator('#content')).toContainText('Frontmatter Fixture Heading', { timeout: 10000 });

    const checkedAfterRelaunch = await secondApp.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-dark-mode')?.checked
    );
    expect(checkedAfterRelaunch).toBe(false);

    await secondApp.close();
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("(e) #content's computed padding-bottom is non-zero", async ({ electronApp }) => {
  const window = await electronApp.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Frontmatter Fixture Heading', { timeout: 10000 });

  const paddingBottom = await content.evaluate((el) => window.getComputedStyle(el).paddingBottom);
  expect(parseFloat(paddingBottom)).toBeGreaterThan(0);
});

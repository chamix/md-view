import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { waitForRendererReady } from './support/rendererReady';

// Task 47 H2 (functional_domain.md #183/#184). ipcRenderer messages sent
// before renderer.js has registered its receivers are dropped, not queued.
// The hold: from main, a `debugger;` statement is injected into every new
// document through webContents.debugger (CDP), then the page reloads. The
// renderer pauses BEFORE any page script has run, and page.evaluate cannot
// run while it is paused.

const SAMPLE = path.join(process.cwd(), 'tests/e2e/fixtures/sample.md');
const SAMPLE_HEADING = 'Playwright Fixture Heading';
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')) as { version: string };

// No What's New window by default ((e) below opts in to one). The hold always
// targets the MAIN window: the one that is not a static data: window.
test.use({ initialUserDataFiles: { 'state.json': JSON.stringify({ lastSeenVersion: pkg.version }) } });

interface Hold {
  paused: boolean;
  identifier: string | null;
  fileRenderedSends: number;
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function holdRendererBeforePageScripts(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }) => {
    const bag = globalThis as unknown as { __mdViewT47Hold: Hold };
    bag.__mdViewT47Hold = { paused: false, identifier: null, fileRenderedSends: 0 };
    const wc = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().startsWith('data:'))!.webContents;

    const originalSend = wc.send.bind(wc);
    wc.send = ((channel: string, ...args: unknown[]) => {
      if (channel === 'md-view:file-rendered') bag.__mdViewT47Hold.fileRenderedSends += 1;
      originalSend(channel, ...args);
    }) as typeof wc.send;

    const d = wc.debugger;
    d.attach('1.3');
    d.on('message', (_event, method) => {
      if (method === 'Debugger.paused') bag.__mdViewT47Hold.paused = true;
    });
    await d.sendCommand('Debugger.enable');
    await d.sendCommand('Page.enable');
    const { identifier } = (await d.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: 'debugger;',
    })) as { identifier: string };
    bag.__mdViewT47Hold.identifier = identifier;
    wc.reload();
  });
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { __mdViewT47Hold: Hold }).__mdViewT47Hold.paused), {
      timeout: 10000,
    })
    .toBe(true);
}

async function releaseRenderer(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }) => {
    const bag = globalThis as unknown as { __mdViewT47Hold: Hold };
    const d = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().startsWith('data:'))!.webContents
      .debugger;
    await d.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: bag.__mdViewT47Hold.identifier });
    await d.sendCommand('Debugger.resume');
    d.detach();
  });
}

function readHold(app: ElectronApplication): Promise<Hold> {
  return app.evaluate(() => (globalThis as unknown as { __mdViewT47Hold: Hold }).__mdViewT47Hold);
}

async function openViaMenu(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, targetPath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [targetPath] })) as typeof dialog.showOpenDialog;
  }, filePath);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click());
}

function menuCloseEnabled(app: ElectronApplication): Promise<boolean | undefined> {
  return app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-close')?.enabled);
}

function contentHtml(window: Page): Promise<string> {
  return window.locator('#content').innerHTML();
}

test('(a) hazard: a main-side open while the renderer is held before its page scripts is lost (#184 positive control)', async ({
  electronApp,
}) => {
  const window = await electronApp.firstWindow();
  await holdRendererBeforePageScripts(electronApp);

  await openViaMenu(electronApp, SAMPLE);
  // Main really did send the render while the renderer was held.
  await expect.poll(async () => (await readHold(electronApp)).fileRenderedSends, { timeout: 10000 }).toBe(1);
  expect((await readHold(electronApp)).paused).toBe(true);

  await releaseRenderer(electronApp);
  await window.waitForFunction(() => document.readyState === 'complete');
  await settle(1000);

  // Lost: main believes a document is open, the renderer never got it.
  expect(await contentHtml(window)).toBe('');
  await expect(window.locator('#status-bar')).toHaveText('No file open');
  expect(await menuCloseEnabled(electronApp)).toBe(true);
});

test('(b) gate: waitForRendererReady does not resolve while held; an open after it resolves is rendered (#183/#184)', async ({
  electronApp,
}) => {
  const window = await electronApp.firstWindow();
  await holdRendererBeforePageScripts(electronApp);

  let resolved = false;
  const ready = waitForRendererReady(window).then(() => {
    resolved = true;
  });
  await settle(1000);
  expect(resolved, 'waitForRendererReady resolved while the renderer was held').toBe(false);
  expect((await readHold(electronApp)).paused).toBe(true);

  await releaseRenderer(electronApp);
  await ready;
  expect(resolved).toBe(true);

  await openViaMenu(electronApp, SAMPLE);
  await expect(window.locator('#content')).toContainText(SAMPLE_HEADING, { timeout: 10000 });
});

test('(c) blank-document clause: waitForRendererReady does not resolve on about:blank (#183)', async ({ electronApp }) => {
  const window = await electronApp.firstWindow();
  // Independent of the helper under test: never abort the initial load.
  await window.waitForLoadState('load');
  await electronApp.evaluate(async ({ BrowserWindow }) => {
    await BrowserWindow.getAllWindows()[0].webContents.loadURL('about:blank');
  });
  // about:blank is itself `complete`, so only the URL clause can refuse it.
  await expect
    .poll(() => window.evaluate(() => [location.href, document.readyState]).catch(() => null))
    .toEqual(['about:blank', 'complete']);

  await expect(waitForRendererReady(window, { timeoutMs: 1500 })).rejects.toThrow(/renderer not ready/);
});

// B2 (review round 2): the APPLICATION form, which support/fixtures.ts uses
// for every fixture test and whats-new.spec.ts uses at its direct launch. It
// must gate on the main renderer exactly like the Page form.
test('(d) gate, application form: waitForRendererReady(app) does not resolve while the main renderer is held (#183/#185)', async ({
  electronApp,
}) => {
  const window = await electronApp.firstWindow();
  await holdRendererBeforePageScripts(electronApp);

  let resolved = false;
  const ready = waitForRendererReady(electronApp).then(() => {
    resolved = true;
  });
  await settle(1000);
  expect(resolved, 'waitForRendererReady(app) resolved while the main renderer was held').toBe(false);
  expect((await readHold(electronApp)).paused).toBe(true);

  await releaseRenderer(electronApp);
  await ready;
  expect(resolved).toBe(true);

  await openViaMenu(electronApp, SAMPLE);
  await expect(window.locator('#content')).toContainText(SAMPLE_HEADING, { timeout: 10000 });
});

test.describe("with What's New due", () => {
  // An older seen version makes main open the static data: What's New window
  // next to the main window (same seeding as whats-new.spec.ts).
  test.use({ initialUserDataFiles: { 'state.json': JSON.stringify({ lastSeenVersion: '0.0.1' }) } });

  test("(e) gate, application form: with the What's New window open and loaded, it does not resolve while the main renderer is held (#183)", async ({
    electronApp,
  }) => {
    await expect.poll(() => electronApp.windows().length, { timeout: 10000 }).toBe(2);
    const whatsNew = electronApp.windows().find((w) => w.url().startsWith('data:'));
    expect(whatsNew, 'a static data: window is open').toBeTruthy();
    // The data: window is fully loaded, so only the URL clause can refuse it.
    await expect.poll(() => whatsNew!.evaluate(() => document.readyState).catch(() => null)).toBe('complete');
    const mainWindow = electronApp.windows().find((w) => !w.url().startsWith('data:'))!;

    await holdRendererBeforePageScripts(electronApp);

    let resolved = false;
    const ready = waitForRendererReady(electronApp).then(() => {
      resolved = true;
    });
    await settle(1000);
    expect(resolved, 'waitForRendererReady(app) resolved while the main renderer was held').toBe(false);
    expect((await readHold(electronApp)).paused).toBe(true);
    expect(electronApp.windows().length).toBe(2);

    await releaseRenderer(electronApp);
    await ready;
    expect(resolved).toBe(true);

    await openViaMenu(electronApp, SAMPLE);
    await expect(mainWindow.locator('#content')).toContainText(SAMPLE_HEADING, { timeout: 10000 });
  });

  // (e) cannot show WHY the data: window is refused: while main is paused the
  // app form's evaluate on main blocks. Here nothing is paused: main is on
  // about:blank and the data: window is loaded, so both are `complete` and only
  // the URL clause can refuse them.
  test("(f) application form: neither a loaded data: What's New window nor about:blank is accepted (#183)", async ({
    electronApp,
  }) => {
    await expect.poll(() => electronApp.windows().length, { timeout: 10000 }).toBe(2);
    const whatsNew = electronApp.windows().find((w) => w.url().startsWith('data:'))!;
    const mainWindow = electronApp.windows().find((w) => !w.url().startsWith('data:'))!;
    await expect.poll(() => whatsNew.evaluate(() => document.readyState).catch(() => null)).toBe('complete');

    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().startsWith('data:'))!;
      await main.webContents.loadURL('about:blank');
    });
    await expect
      .poll(() => mainWindow.evaluate(() => [location.href, document.readyState]).catch(() => null))
      .toEqual(['about:blank', 'complete']);

    await expect(waitForRendererReady(electronApp, { timeoutMs: 1500 })).rejects.toThrow(/renderer not ready/);
  });
});

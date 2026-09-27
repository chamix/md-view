import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './support/fixtures';

// Task 46 #178 (ADR-011) + approval condition 4: Help, What's New and About
// each render under the static-window CSP with zero violations, cannot run an
// injected inline <script>, and are actually styled (the embedded stylesheet
// applies; before Task 46 they never were, E1).
//
// Violations are captured in MAIN, as webContents 'console-message' events:
// a listener registered at browser-window-created (i.e. before loadURL) sees
// parse-time violations, which a listener added from the page after load
// would miss. A positive control (an appended <img>) proves, per window, that
// the channel is live before a zero is trusted.

const repoRoot = path.join(__dirname, '../..');
const currentVersion = (JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string })
  .version;
const CSP_MESSAGE = /Content.Security.Policy/i;

type Bag = { __mdViewConsole: string[] };

// Installs the capture channel in main. Every static window created from now
// on reports its console messages into one global list.
async function installCapture(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp }) => {
    const bag = globalThis as unknown as Bag & { __mdViewCaptureInstalled?: boolean };
    bag.__mdViewConsole = [];
    if (bag.__mdViewCaptureInstalled) return;
    bag.__mdViewCaptureInstalled = true;
    electronApp.on('browser-window-created', (_event, win) => {
      win.webContents.on('console-message', (details: unknown, _level: unknown, legacyMessage: unknown) => {
        const message = (details as { message?: unknown }).message;
        bag.__mdViewConsole.push(String(typeof message === 'string' ? message : legacyMessage));
      });
    });
  });
}

// What's New is created during startup, before any test code can run, so it
// cannot be caught by browser-window-created. Instead the listener is attached
// to its existing webContents and the SAME document is re-parsed via reload,
// so parse-time violations are still observed with the listener in place.
async function captureByReload(app: ElectronApplication, title: string): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }, wantTitle) => {
    const bag = globalThis as unknown as Bag;
    bag.__mdViewConsole = [];
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === wantTitle);
    if (!win) throw new Error(`no window titled ${wantTitle}`);
    win.webContents.on('console-message', (details: unknown, _level: unknown, legacyMessage: unknown) => {
      const message = (details as { message?: unknown }).message;
      bag.__mdViewConsole.push(String(typeof message === 'string' ? message : legacyMessage));
    });
    await new Promise<void>((resolve) => {
      win.webContents.once('did-finish-load', () => resolve());
      win.webContents.reload();
    });
  }, title);
}

function cspMessages(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as Bag).__mdViewConsole ?? []).then((all) =>
    all.filter((m) => CSP_MESSAGE.test(m))
  );
}

// Condition 4: the browser-default font is MEASURED, never assumed: an
// unstyled data: document in a hidden window created (and destroyed) here.
async function measureDefaultFontFamily(app: ElectronApplication): Promise<string> {
  return app.evaluate(async ({ BrowserWindow }) => {
    const probe = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    try {
      await probe.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!DOCTYPE html><p>probe</p>'));
      return (await probe.webContents.executeJavaScript(
        'getComputedStyle(document.querySelector("p")).fontFamily'
      )) as string;
    } finally {
      probe.destroy();
    }
  });
}

async function pageByTitle(app: ElectronApplication, title: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(
      async () => {
        for (const page of app.windows()) {
          try {
            if ((await page.title()) === title) {
              found = page;
              return true;
            }
          } catch {
            // page closed or navigating; keep polling
          }
        }
        return false;
      },
      { timeout: 10000 }
    )
    .toBe(true);
  return found as Page;
}

function clickMenu(app: ElectronApplication, id: string): Promise<void> {
  return app.evaluate(({ Menu }, menuId) => {
    Menu.getApplicationMenu()?.getMenuItemById(menuId)?.click();
  }, id);
}

async function assertStaticWindowCsp(app: ElectronApplication, page: Page, defaultFont: string): Promise<void> {
  await page.waitForLoadState('load');
  // Let any late-reported violation arrive before snapshotting the load's messages.
  await page.waitForTimeout(300);
  const loadMessages = await cspMessages(app);

  // An injected inline <script> never runs (asserted first, so removing the
  // policy fails exactly here).
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__mdViewCanary = 1;';
    document.body.appendChild(script);
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as unknown as { __mdViewCanary?: unknown }).__mdViewCanary)).toBeUndefined();

  // Zero CSP messages during load (also: no Electron "Insecure
  // Content-Security-Policy" warning, which the same pattern matches).
  expect(loadMessages).toEqual([]);

  // The meta content is exactly the approved shape, with the hash of the
  // embedded <style> text.
  const { content, styleText, styleCount } = await page.evaluate(() => ({
    content: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? null,
    styleText: document.querySelector('style')?.textContent ?? '',
    styleCount: document.querySelectorAll('style').length,
  }));
  expect(styleCount).toBe(1);
  const hash = createHash('sha256').update(styleText, 'utf8').digest('base64');
  expect(content).toBe(`default-src 'none'; style-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'`);

  // Styled: the embedded CSS applies (the D1 regression guard for E1).
  const computed = await page.evaluate(() => {
    const body = document.querySelector('.markdown-body') as HTMLElement;
    const style = getComputedStyle(body);
    return { maxWidth: style.maxWidth, fontFamily: style.fontFamily };
  });
  expect(computed.maxWidth).toBe('704px');
  expect(computed.fontFamily).not.toBe(defaultFont);
  expect(computed.fontFamily).not.toBe('"Times New Roman"');

  // Positive control: the same channel does see a violation.
  await page.evaluate(() => {
    const img = document.createElement('img');
    img.src = 'data:,x';
    document.body.appendChild(img);
  });
  await expect
    .poll(async () => (await cspMessages(app)).some((m) => m.includes('data:,x')), { timeout: 5000 })
    .toBe(true);
}

test('Help: zero CSP violations, exact policy, script blocked, styled', async ({ electronApp }) => {
  await electronApp.firstWindow();
  const defaultFont = await measureDefaultFontFamily(electronApp);
  expect(defaultFont.length).toBeGreaterThan(0);
  await installCapture(electronApp);

  await clickMenu(electronApp, 'menu-help');
  const help = await pageByTitle(electronApp, 'md-view Help');
  await expect(help.locator('body')).toContainText('minimal desktop Markdown previewer', { timeout: 10000 });

  await assertStaticWindowCsp(electronApp, help, defaultFont);
});

test('About: zero CSP violations, exact policy, script blocked, styled', async ({ electronApp }) => {
  await electronApp.firstWindow();
  const defaultFont = await measureDefaultFontFamily(electronApp);
  await installCapture(electronApp);

  await clickMenu(electronApp, 'menu-about');
  const about = await pageByTitle(electronApp, 'About md-view');
  await expect(about.locator('body')).toContainText('Third-party notices', { timeout: 10000 });

  await assertStaticWindowCsp(electronApp, about, defaultFont);
});

test.describe("What's New", () => {
  test.use({ initialUserDataFiles: { 'state.json': JSON.stringify({ lastSeenVersion: '0.0.1' }) } });

  test("What's New: zero CSP violations, exact policy, script blocked, styled", async ({ electronApp }) => {
    await electronApp.firstWindow();
    const title = `What's New in md-view ${currentVersion}`;
    const whatsNew = await pageByTitle(electronApp, title);
    const defaultFont = await measureDefaultFontFamily(electronApp);

    await captureByReload(electronApp, title);
    await expect(whatsNew.locator('body')).toContainText(`What's New in md-view ${currentVersion}`, { timeout: 10000 });

    await assertStaticWindowCsp(electronApp, whatsNew, defaultFont);
  });
});

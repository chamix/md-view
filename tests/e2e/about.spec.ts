import * as fs from 'fs';
import * as path from 'path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './support/fixtures';

// Task 46 (#169, #170, #172, #177): Help > About md-view. Every expectation is
// derived from the real inputs (LICENSE, dist/third-party-notices.json,
// node_modules, app.getVersion(), process.versions in main), never typed.
const repoRoot = path.join(__dirname, '../..');
const ABOUT_TITLE = 'About md-view';

function readNotices(): { packages: Array<{ name: string; version: string; license: string; chosenLicense: string; citation: { url: string } | null }> } {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist', 'third-party-notices.json'), 'utf8'));
}

function licenseCopyrightLine(): string {
  const line = fs
    .readFileSync(path.join(repoRoot, 'LICENSE'), 'utf8')
    .split(/\r?\n/)
    .find((l) => /^\s*Copyright\b/.test(l));
  expect(line, 'LICENSE has a Copyright line').toBeTruthy();
  return (line as string).trim();
}

function clickAbout(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('menu-about')?.click();
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

async function openAbout(app: ElectronApplication): Promise<Page> {
  await app.firstWindow();
  await clickAbout(app);
  const about = await pageByTitle(app, ABOUT_TITLE);
  await expect(about.locator('body')).toContainText('Third-party notices', { timeout: 10000 });
  return about;
}

function fieldValue(page: Page, label: string) {
  return page.locator('tr', { has: page.locator('th', { hasText: new RegExp(`^${label}$`) }) }).locator('td');
}

async function mockOpenExternal(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    (globalThis as unknown as { __openExternalCalls: string[] }).__openExternalCalls = [];
    shell.openExternal = (async (url: string) => {
      (globalThis as unknown as { __openExternalCalls: string[] }).__openExternalCalls.push(url);
    }) as typeof shell.openExternal;
  });
}

function openExternalCalls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __openExternalCalls?: string[] }).__openExternalCalls ?? []);
}

test('#172: Help has menu-help, a separator, then menu-about with no accelerator', async ({ electronApp }) => {
  await electronApp.firstWindow();
  const items = await electronApp.evaluate(({ Menu }) => {
    const help = Menu.getApplicationMenu()?.items.find((i) => i.label === 'Help');
    return (help?.submenu?.items ?? []).map((i) => ({ id: i.id ?? null, type: i.type, label: i.label, accelerator: i.accelerator ?? null }));
  });

  expect(items.map((i) => i.type)).toEqual(['normal', 'separator', 'normal']);
  expect(items[0].id).toBe('menu-help');
  expect(items[2]).toEqual({ id: 'menu-about', type: 'normal', label: 'About md-view', accelerator: null });
});

test('#169/#170: About opens one window showing the version, runtime, copyright, license and repository link', async ({
  electronApp,
}) => {
  const about = await openAbout(electronApp);
  const { version, versions } = await electronApp.evaluate(({ app }) => ({
    version: app.getVersion(),
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
  }));

  expect(electronApp.windows().length).toBe(2);
  await expect(about).toHaveTitle(ABOUT_TITLE);
  await expect(fieldValue(about, 'Version')).toHaveText(version);
  await expect(fieldValue(about, 'Electron')).toHaveText(versions.electron);
  await expect(fieldValue(about, 'Chromium')).toHaveText(versions.chrome);
  await expect(fieldValue(about, 'Node.js')).toHaveText(versions.node);
  await expect(fieldValue(about, 'Copyright')).toHaveText(licenseCopyrightLine());
  await expect(fieldValue(about, 'License')).toHaveText('MIT');
  await expect(fieldValue(about, 'Repository').locator('a')).toHaveAttribute('href', 'https://github.com/chamix/md-view');
});

test('#169: a second click opens no new window and focuses the existing one', async ({ electronApp }) => {
  await openAbout(electronApp);

  // Observe focus() deterministically (OS focus-stealing rules make
  // getFocusedWindow() unreliable in automation): count calls on the About
  // BrowserWindow instance itself.
  await electronApp.evaluate(({ BrowserWindow }, title) => {
    const bag = globalThis as unknown as { __aboutFocusCalls: number };
    bag.__aboutFocusCalls = 0;
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === title);
    if (!win) throw new Error('About window not found');
    const original = win.focus.bind(win);
    win.focus = () => {
      bag.__aboutFocusCalls += 1;
      original();
    };
  }, ABOUT_TITLE);

  await clickAbout(electronApp);
  await expect
    .poll(() => electronApp.evaluate(() => (globalThis as unknown as { __aboutFocusCalls: number }).__aboutFocusCalls), {
      timeout: 5000,
    })
    .toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(electronApp.windows().length).toBe(2);
});

test('#169: two same-tick clicks open exactly one About window (re-check after the async reads)', async ({
  electronApp,
}) => {
  await electronApp.firstWindow();

  // Both clicks in ONE main-process turn: each passes the synchronous
  // single-instance guard before the first click's file reads settle, so only
  // onOpenAbout's re-check after its reads can prevent a second window.
  await electronApp.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('menu-about');
    item?.click();
    item?.click();
  });

  function windowTitles(): Promise<Array<{ title: string; loading: boolean }>> {
    return electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), loading: w.webContents.isLoading() }))
    );
  }

  // Wait until an About window exists and has finished loading...
  await expect
    .poll(
      async () => {
        const about = (await windowTitles()).filter((w) => w.title === ABOUT_TITLE);
        return about.length > 0 && about.every((w) => !w.loading);
      },
      { timeout: 10000 }
    )
    .toBe(true);
  // ...then give a (wrongly) created second window time to be constructed,
  // load and take its title, and require every window to be settled.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await expect.poll(async () => (await windowTitles()).every((w) => !w.loading), { timeout: 10000 }).toBe(true);

  const titles = (await windowTitles()).map((w) => w.title);
  expect(titles.filter((t) => t === ABOUT_TITLE), JSON.stringify(titles)).toHaveLength(1);
  expect(titles, JSON.stringify(titles)).toHaveLength(2);
});

test('#169 lockdown: no menu, so the inherited CmdOrCtrl+O accelerator cannot reach the file-open handler', async ({
  electronApp,
}) => {
  const mainWindow = await electronApp.firstWindow();
  await openAbout(electronApp);

  // Same probe as help-menu.spec.ts (e), including its main-window positive control.
  await electronApp.evaluate(({ dialog }) => {
    const bag = globalThis as unknown as { __mdViewOpenDialogCalls: number };
    bag.__mdViewOpenDialogCalls = 0;
    dialog.showOpenDialog = () => {
      bag.__mdViewOpenDialogCalls += 1;
      return Promise.resolve({ canceled: true, filePaths: [] });
    };
  });

  async function sendCtrlOAndReadCount(toAbout: boolean): Promise<number> {
    await electronApp.evaluate(
      ({ BrowserWindow }, { wantAbout, title }) => {
        const target = BrowserWindow.getAllWindows().find((w) => (w.getTitle() === title) === wantAbout);
        target?.focus();
        target?.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'O', modifiers: ['control'] });
        target?.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'O', modifiers: ['control'] });
      },
      { wantAbout: toAbout, title: ABOUT_TITLE }
    );
    await mainWindow.waitForTimeout(300);
    return electronApp.evaluate(() => (globalThis as unknown as { __mdViewOpenDialogCalls: number }).__mdViewOpenDialogCalls);
  }

  expect(await sendCtrlOAndReadCount(false)).toBeGreaterThan(0);
  await electronApp.evaluate(() => {
    (globalThis as unknown as { __mdViewOpenDialogCalls: number }).__mdViewOpenDialogCalls = 0;
  });
  expect(await sendCtrlOAndReadCount(true)).toBe(0);
});

test('#169 lockdown: window.open is denied and no window is created', async ({ electronApp }) => {
  const about = await openAbout(electronApp);
  await mockOpenExternal(electronApp);

  const opened = await about.evaluate(() => window.open('about:blank') === null);
  await about.waitForTimeout(300);

  expect(opened).toBe(true);
  expect(electronApp.windows().length).toBe(2);
  expect(await openExternalCalls(electronApp)).toEqual([]);
});

test('#169: clicking the repository link hands it to the OS browser and does not navigate the About window', async ({
  electronApp,
}) => {
  const about = await openAbout(electronApp);
  await mockOpenExternal(electronApp);

  // Read from main: Playwright's own page.url()/title() wait on the cancelled
  // navigation's lifecycle, which never settles (see external-links.spec.ts).
  function aboutUrls(): Promise<string[]> {
    return electronApp.evaluate(({ BrowserWindow }, title) => {
      return BrowserWindow.getAllWindows()
        .filter((w) => w.getTitle() === title)
        .map((w) => w.webContents.getURL());
    }, ABOUT_TITLE);
  }
  const urlsBefore = await aboutUrls();
  expect(urlsBefore).toHaveLength(1);

  // noWaitAfter: the will-navigate preventDefault() cancels the navigation at
  // the Electron layer (see external-links.spec.ts).
  await about.click('a[href="https://github.com/chamix/md-view"]', { noWaitAfter: true });

  await expect.poll(() => openExternalCalls(electronApp), { timeout: 5000 }).toHaveLength(1);
  expect((await openExternalCalls(electronApp))[0].replace(/\/$/, '')).toBe('https://github.com/chamix/md-view');
  await about.waitForTimeout(300);
  expect(await aboutUrls()).toEqual(urlsBefore);
});

test('#169 lockdown: the About window has no preload and no bridge', async ({ electronApp }) => {
  const about = await openAbout(electronApp);

  const prefs = await electronApp.evaluate(({ BrowserWindow }, title) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === title);
    const p = win?.webContents.getLastWebPreferences();
    return p ? { preload: p.preload ?? null, sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration } : null;
  }, ABOUT_TITLE);

  expect(prefs).not.toBeNull();
  expect(prefs?.preload ?? null).toBeNull();
  expect(prefs?.sandbox).toBe(true);
  expect(prefs?.contextIsolation).toBe(true);
  expect(prefs?.nodeIntegration).toBe(false);
  expect(await about.evaluate(() => (window as unknown as { mdview?: unknown }).mdview)).toBeUndefined();
});

test('#177: the notices open with no script and show the real license texts, choices and citations', async ({
  electronApp,
}) => {
  const about = await openAbout(electronApp);
  const notices = readNotices();

  const outer = about.locator('details.third-party-notices');
  await expect(outer.locator(':scope > summary')).toHaveText(`Third-party notices (${notices.packages.length} packages)`);
  await outer.locator(':scope > summary').click();

  function entry(name: string) {
    return outer.locator('details.notice-package', {
      has: about.locator('summary', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `) }),
    });
  }

  // highlight.js: its own LICENSE, first line.
  const hljsFirstLine = fs
    .readFileSync(path.join(repoRoot, 'node_modules', 'highlight.js', 'LICENSE'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim() !== '') as string;
  const hljs = entry('highlight.js');
  await hljs.locator('summary').click();
  await expect(hljs.locator('pre').first()).toBeVisible();
  await expect(hljs.locator('pre').first()).toContainText(hljsFirstLine.trim());

  // dompurify: chosen Apache-2.0, with the declared expression.
  const dompurify = entry('dompurify');
  await expect(dompurify.locator('summary')).toContainText('Apache-2.0');
  await dompurify.locator('summary').click();
  await expect(dompurify).toContainText('(MPL-2.0 OR Apache-2.0)');

  // fastdom: its pinned citation URL.
  const fastdomCitation = notices.packages.find((p) => p.name === 'fastdom')?.citation?.url as string;
  expect(fastdomCitation).toBeTruthy();
  const fastdom = entry('fastdom');
  await fastdom.locator('summary').click();
  await expect(fastdom).toContainText(fastdomCitation);
});

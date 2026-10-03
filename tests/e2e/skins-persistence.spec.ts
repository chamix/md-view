import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { waitForRendererReady } from './support/rendererReady';

// Task 51 (functional_domain.md #214-#216, #219-#221; approval conditions D1,
// D2): persistence, self-heal, focus re-read, containment of write failures.

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')) as { version: string };
const ENTRY_POINT = path.join(process.cwd(), 'dist/main/index.js');
// Keeps What's New out of the way (no window, no state write).
const STATE_JSON = JSON.stringify({ lastSeenVersion: pkg.version });

const TOKENS = [
  '--color-bg-page',
  '--color-bg-chrome',
  '--color-border',
  '--color-text-primary',
  '--color-text-muted',
  '--color-text-disabled',
  '--color-border-disabled',
  '--color-text-error',
  '--color-bg-hover',
  '--color-tab-hover-bg',
  '--color-accent',
  '--color-bg-accent',
  '--color-bg-accent-hover',
  '--color-tab-active',
  '--color-close-hover-bg',
  '--color-close-hover-glyph',
];
const half = (chrome: string) => Object.fromEntries(TOKENS.map((t) => [t, t === '--color-bg-chrome' ? chrome : '#808080']));
const validFile = (activeSkin: string) =>
  JSON.stringify({ activeSkin, customSkins: { Mine: { light: half('#405060'), dark: half('#0a0b0c') } } }, null, 2);

const BG = {
  Default: 'rgb(246, 248, 250)',
  Claude: 'rgb(240, 238, 230)',
  Obsidian: 'rgb(245, 246, 248)',
  'Tokyo Night': 'rgb(213, 214, 219)',
};

const titleBarBg = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.getElementById('title-bar') as HTMLElement).backgroundColor);
const clickItem = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click(), id);
const itemChecked = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.checked, id);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Fires the main window's real 'focus' listener (onWindowFocus) without
// depending on OS focus: the handler is registered via mainWindow.on('focus').
async function emitFocus(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/renderer/index.html'));
    main?.emit('focus');
  });
}

interface Probe {
  rejections: string[];
  warnings: string[];
}
async function installProbe(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const bag = globalThis as unknown as { __mdViewT51Probe: Probe };
    bag.__mdViewT51Probe = { rejections: [], warnings: [] };
    process.on('unhandledRejection', (reason) => {
      bag.__mdViewT51Probe.rejections.push(String(reason));
    });
    const originalWarn = console.warn.bind(console);
    console.warn = (...args: unknown[]) => {
      bag.__mdViewT51Probe.warnings.push(args.map((a) => String(a)).join(' '));
      originalWarn(...args);
    };
  });
}
const readProbe = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __mdViewT51Probe: Probe }).__mdViewT51Probe);

async function spyOnOpenPath(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    (globalThis as Record<string, unknown[]>).__mdViewT51OpenPath = [];
    shell.openPath = ((p: string) => {
      (globalThis as Record<string, unknown[]>).__mdViewT51OpenPath.push(p);
      return Promise.resolve('');
    }) as typeof shell.openPath;
  });
}
const openPathCalls = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as Record<string, unknown>).__mdViewT51OpenPath as string[]);

test.describe('relaunch', () => {
  test('a selected skin persists to skins.json and is restored (and checked) after a relaunch', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-'));
    fs.writeFileSync(path.join(userDataDir, 'state.json'), STATE_JSON, 'utf8');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const launch = () =>
      electron.launch({ args: [`--user-data-dir=${userDataDir}`, ENTRY_POINT], env, userDataDir });
    try {
      const app = await launch();
      const window = await app.firstWindow();
      await waitForRendererReady(window);
      await expect.poll(() => titleBarBg(window)).toBe(BG.Default);

      await clickItem(app, 'menu-skin-1');
      await expect.poll(() => titleBarBg(window)).toBe(BG.Claude);
      const skinsPath = path.join(userDataDir, 'skins.json');
      await expect
        .poll(() => (fs.existsSync(skinsPath) ? JSON.parse(fs.readFileSync(skinsPath, 'utf8')) : null))
        .toEqual({ activeSkin: 'Claude', customSkins: {} });
      await app.close();

      const second = await launch();
      const secondWindow = await second.firstWindow();
      await waitForRendererReady(secondWindow);
      await expect.poll(() => titleBarBg(secondWindow)).toBe(BG.Claude);
      expect(await itemChecked(second, 'menu-skin-1')).toBe(true);
      expect(await itemChecked(second, 'menu-skin-0')).toBe(false);
      await second.close();
    } finally {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});

test.describe('unknown activeSkin (#217)', () => {
  const content = validFile('No Such Skin');
  test.use({ initialUserDataFiles: { 'skins.json': content, 'state.json': STATE_JSON } });

  test('shows Default, checks the Default radio, and leaves the file byte-identical', async ({ electronApp, userDataDir }) => {
    const window = await electronApp.firstWindow();
    await expect.poll(() => titleBarBg(window)).toBe(BG.Default);
    expect(await itemChecked(electronApp, 'menu-skin-0')).toBe(true);
    expect(fs.readFileSync(path.join(userDataDir, 'skins.json'), 'utf8')).toBe(content);
    expect(fs.existsSync(path.join(userDataDir, 'skins.json.bak'))).toBe(false);
  });
});

test.describe('missing skins.json (#214)', () => {
  test.use({ initialUserDataFiles: { 'state.json': STATE_JSON } });

  test('boots on Default and writes nothing', async ({ electronApp, userDataDir }) => {
    const window = await electronApp.firstWindow();
    await expect.poll(() => titleBarBg(window)).toBe(BG.Default);
    expect(fs.existsSync(path.join(userDataDir, 'skins.json'))).toBe(false);
  });
});

test.describe('corrupt skins.json at launch (#215, D1)', () => {
  const corrupt = '{ "activeSkin": "Claude", oops é';
  test.use({ initialUserDataFiles: { 'skins.json': corrupt, 'state.json': STATE_JSON } });

  test('self-heals to defaults and skins.json.bak holds the original bytes', async ({ electronApp, userDataDir }) => {
    const window = await electronApp.firstWindow();
    await expect.poll(() => titleBarBg(window)).toBe(BG.Default);
    expect(await itemChecked(electronApp, 'menu-skin-0')).toBe(true);

    const skinsPath = path.join(userDataDir, 'skins.json');
    expect(JSON.parse(fs.readFileSync(skinsPath, 'utf8'))).toEqual({ activeSkin: 'Default', customSkins: {} });
    expect(fs.readFileSync(path.join(userDataDir, 'skins.json.bak'))).toEqual(Buffer.from(corrupt, 'utf8'));
  });
});

test.describe('focus re-read (#216)', () => {
  test.use({ initialUserDataFiles: { 'skins.json': validFile('Default'), 'state.json': STATE_JSON } });

  test('picks up a valid external edit, and ignores a corrupt one without writing', async ({ electronApp, userDataDir }) => {
    const window = await electronApp.firstWindow();
    const skinsPath = path.join(userDataDir, 'skins.json');
    await expect.poll(() => titleBarBg(window)).toBe(BG.Default);

    // Valid external edit while unfocused -> applied on refocus.
    fs.writeFileSync(skinsPath, validFile('Tokyo Night'), 'utf8');
    await emitFocus(electronApp);
    await expect.poll(() => titleBarBg(window)).toBe(BG['Tokyo Night']);
    expect(await itemChecked(electronApp, 'menu-skin-3')).toBe(true);

    // A custom skin added externally appears in the menu.
    const withCustom = JSON.parse(validFile('Tokyo Night'));
    withCustom.customSkins.Another = { light: half('#111111'), dark: half('#222222') };
    fs.writeFileSync(skinsPath, JSON.stringify(withCustom), 'utf8');
    await emitFocus(electronApp);
    await expect
      .poll(() =>
        electronApp.evaluate(({ Menu }) => {
          const skin = Menu.getApplicationMenu()?.getMenuItemById('menu-skin');
          return skin?.submenu?.items.map((i) => i.label).filter(Boolean);
        })
      )
      .toEqual(['Default', 'Claude', 'Obsidian', 'Tokyo Night', 'Mine', 'Another', 'Edit Skins…']);

    // Corrupt external edit -> ignored entirely: no UI change, file untouched, no .bak.
    const corrupt = '{ half-typed';
    fs.writeFileSync(skinsPath, corrupt, 'utf8');
    await emitFocus(electronApp);
    await sleep(600);
    expect(await titleBarBg(window)).toBe(BG['Tokyo Night']);
    expect(await itemChecked(electronApp, 'menu-skin-3')).toBe(true);
    expect(fs.readFileSync(skinsPath, 'utf8')).toBe(corrupt);
    expect(fs.existsSync(`${skinsPath}.bak`)).toBe(false);
  });
});

test.describe('write while the file is held open (#220)', () => {
  test.use({ initialUserDataFiles: { 'skins.json': validFile('Default'), 'state.json': STATE_JSON } });

  test('a selection is contained: app alive, choice kept in memory, warning logged, next write persists', async ({
    electronApp,
    userDataDir,
  }) => {
    const window = await electronApp.firstWindow();
    const skinsPath = path.join(userDataDir, 'skins.json');
    const before = fs.readFileSync(skinsPath, 'utf8');

    const pageErrors: string[] = [];
    window.on('pageerror', (e) => pageErrors.push(e.message));
    let exited = false;
    electronApp.on('close', () => {
      exited = true;
    });
    await installProbe(electronApp);

    const fd = fs.openSync(skinsPath, 'r');
    try {
      await clickItem(electronApp, 'menu-skin-1');
      await expect
        .poll(async () => {
          const p = await readProbe(electronApp);
          return p.rejections.length + p.warnings.length;
        }, { timeout: 10000 })
        .toBeGreaterThan(0);

      const probe = await readProbe(electronApp);
      expect(probe.rejections).toEqual([]);
      expect(probe.warnings.some((w) => w.includes('skins.json') && w.includes('EPERM'))).toBe(true);

      expect(await itemChecked(electronApp, 'menu-skin-1')).toBe(true);
      await expect.poll(() => titleBarBg(window)).toBe(BG.Claude);
      expect(fs.readFileSync(skinsPath, 'utf8')).toBe(before);
      expect(fs.readdirSync(userDataDir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    } finally {
      fs.closeSync(fd);
    }

    await clickItem(electronApp, 'menu-skin-2');
    await expect
      .poll(() => {
        try {
          return JSON.parse(fs.readFileSync(skinsPath, 'utf8')).activeSkin;
        } catch {
          return null;
        }
      }, { timeout: 10000 })
      .toBe('Obsidian');
    // The full object is written: the custom skin survives.
    expect(Object.keys(JSON.parse(fs.readFileSync(skinsPath, 'utf8')).customSkins)).toEqual(['Mine']);

    expect((await readProbe(electronApp)).rejections).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(exited).toBe(false);
    expect(electronApp.process().exitCode).toBeNull();
  });
});

test.describe('Edit Skins… (#221)', () => {
  test.describe('file missing', () => {
    test.use({ initialUserDataFiles: { 'state.json': STATE_JSON } });

    test('creates a valid default skins.json and opens exactly that path', async ({ electronApp, userDataDir }) => {
      await electronApp.firstWindow();
      const skinsPath = path.join(userDataDir, 'skins.json');
      expect(fs.existsSync(skinsPath)).toBe(false);
      await spyOnOpenPath(electronApp);

      await clickItem(electronApp, 'menu-skin-edit');

      await expect.poll(() => fs.existsSync(skinsPath)).toBe(true);
      await expect.poll(async () => (await openPathCalls(electronApp)).length).toBe(1);
      expect((await openPathCalls(electronApp))[0]).toBe(skinsPath);
      expect(JSON.parse(fs.readFileSync(skinsPath, 'utf8'))).toEqual({ activeSkin: 'Default', customSkins: {} });
    });
  });

  test.describe('file exists but is corrupt', () => {
    const corrupt = '{ mid-edit, not json';
    // Launch would self-heal a corrupt file, so corrupt it after launch.
    test.use({ initialUserDataFiles: { 'skins.json': validFile('Default'), 'state.json': STATE_JSON } });

    test('never overwrites it', async ({ electronApp, userDataDir }) => {
      await electronApp.firstWindow();
      const skinsPath = path.join(userDataDir, 'skins.json');
      fs.writeFileSync(skinsPath, corrupt, 'utf8');
      await spyOnOpenPath(electronApp);

      await clickItem(electronApp, 'menu-skin-edit');

      await expect.poll(async () => (await openPathCalls(electronApp)).length).toBe(1);
      expect(fs.readFileSync(skinsPath, 'utf8')).toBe(corrupt);
      expect(fs.existsSync(`${skinsPath}.bak`)).toBe(false);
    });
  });
});

test.describe('selecting a skin while skins.json is corrupt (#219, D2)', () => {
  test.use({ initialUserDataFiles: { 'skins.json': validFile('Default'), 'state.json': STATE_JSON } });

  test('applies in memory, warns, and leaves the file byte-identical', async ({ electronApp, userDataDir }) => {
    const window = await electronApp.firstWindow();
    const skinsPath = path.join(userDataDir, 'skins.json');
    await installProbe(electronApp);

    // Hand-edit in progress: the file on disk no longer parses.
    const corrupt = '{ "activeSkin": "Default", "customSkins": { typing...';
    fs.writeFileSync(skinsPath, corrupt, 'utf8');

    await clickItem(electronApp, 'menu-skin-2');

    await expect.poll(() => titleBarBg(window)).toBe(BG.Obsidian);
    expect(await itemChecked(electronApp, 'menu-skin-2')).toBe(true);
    await expect
      .poll(async () => (await readProbe(electronApp)).warnings.some((w) => w.includes('skins.json')))
      .toBe(true);

    await sleep(300);
    expect(fs.readFileSync(skinsPath, 'utf8')).toBe(corrupt);
    expect(fs.existsSync(`${skinsPath}.bak`)).toBe(false);
    expect(fs.readdirSync(userDataDir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect((await readProbe(electronApp)).rejections).toEqual([]);
  });
});

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './support/fixtures';

// Task 51 (functional_domain.md #211-#213, #217, #222-#226; ADR-014): the
// View > Skin submenu and what selecting a skin does to the real page.

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')) as { version: string };

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
const CUSTOM_NAME = 'Mine & Co';
const SKINS_JSON = JSON.stringify({
  activeSkin: 'Default',
  customSkins: { [CUSTOM_NAME]: { light: half('#405060'), dark: half('#0a0b0c') } },
});

test.use({
  initialUserDataFiles: {
    'skins.json': SKINS_JSON,
    // Keeps What's New out of the way (no window, no state write).
    'state.json': JSON.stringify({ lastSeenVersion: pkg.version }),
  },
});

const CHROME = {
  Default: { light: 'rgb(246, 248, 250)', dark: 'rgb(22, 27, 34)' },
  Claude: { light: 'rgb(240, 238, 230)', dark: 'rgb(31, 30, 29)' },
  Obsidian: { light: 'rgb(245, 246, 248)', dark: 'rgb(38, 38, 38)' },
  'Tokyo Night': { light: 'rgb(213, 214, 219)', dark: 'rgb(22, 22, 30)' },
  [CUSTOM_NAME]: { light: 'rgb(64, 80, 96)', dark: 'rgb(10, 11, 12)' },
} as const;

const titleBarBg = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.getElementById('title-bar') as HTMLElement).backgroundColor);

const hljsHrefs = (page: Page) =>
  page.evaluate(() => ({
    light: (document.getElementById('theme-hljs-light') as HTMLLinkElement).href,
    dark: (document.getElementById('theme-hljs-dark') as HTMLLinkElement).href,
  }));

const clickItem = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click(), id);

const itemChecked = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.checked, id);

const dark = (page: Page) => page.evaluate(() => document.body.classList.contains('dark-mode'));

test('the Skin submenu has the 4 built-in radios, the custom skin, a separator and Edit Skins… (ids by index, & escaped)', async ({
  electronApp,
}) => {
  await electronApp.firstWindow();
  const items = await electronApp.evaluate(({ Menu }) => {
    const skin = Menu.getApplicationMenu()?.getMenuItemById('menu-skin');
    return (skin?.submenu?.items ?? []).map((i) => ({ id: i.id, label: i.label, type: i.type, checked: i.checked }));
  });

  expect(items).toEqual([
    { id: 'menu-skin-0', label: 'Default', type: 'radio', checked: true },
    { id: 'menu-skin-1', label: 'Claude', type: 'radio', checked: false },
    { id: 'menu-skin-2', label: 'Obsidian', type: 'radio', checked: false },
    { id: 'menu-skin-3', label: 'Tokyo Night', type: 'radio', checked: false },
    { id: 'menu-skin-4', label: 'Mine && Co', type: 'radio', checked: false },
    { id: undefined, label: '', type: 'separator', checked: false },
    { id: 'menu-skin-edit', label: 'Edit Skins…', type: 'normal', checked: false },
  ]);
});

test('the View title-bar popup is built from the same template and carries the Skin submenu', async ({ electronApp }) => {
  const window = await electronApp.firstWindow();
  await electronApp.evaluate(({ Menu }) => {
    const bag = globalThis as unknown as { __mdViewLastPopupMenu: Electron.Menu | null };
    bag.__mdViewLastPopupMenu = null;
    const original = Menu.buildFromTemplate.bind(Menu);
    Menu.buildFromTemplate = ((template: Electron.MenuItemConstructorOptions[]) => {
      const menu = original(template);
      bag.__mdViewLastPopupMenu = menu;
      return menu;
    }) as typeof Menu.buildFromTemplate;
  });

  await window.locator('#menu-label-view').click();
  const skinIds = await electronApp.evaluate(() => {
    const bag = globalThis as unknown as { __mdViewLastPopupMenu: Electron.Menu | null };
    const skin = bag.__mdViewLastPopupMenu?.items.find((i) => i.id === 'menu-skin');
    return skin?.submenu?.items.map((i) => i.id || i.type) ?? [];
  });
  expect(skinIds).toEqual([
    'menu-skin-0',
    'menu-skin-1',
    'menu-skin-2',
    'menu-skin-3',
    'menu-skin-4',
    'separator',
    'menu-skin-edit',
  ]);
});

test('Default skin shows exactly the pre-Task-51 chrome colors and highlight sheets, in both modes (#212)', async ({
  electronApp,
}) => {
  const window = await electronApp.firstWindow();
  await expect.poll(() => titleBarBg(window)).toBe(CHROME.Default.light);
  expect((await hljsHrefs(window)).light).toMatch(/\/renderer\/github\.css$/);
  expect((await hljsHrefs(window)).dark).toMatch(/\/renderer\/github-dark\.css$/);

  await clickItem(electronApp, 'menu-dark-mode');
  await expect.poll(() => dark(window)).toBe(true);
  await expect.poll(() => titleBarBg(window)).toBe(CHROME.Default.dark);
});

test('selecting each skin changes the computed chrome color and the highlight sheets; Dark Mode swaps the halves (#213)', async ({
  electronApp,
}) => {
  const window = await electronApp.firstWindow();
  const failedRequests: string[] = [];
  const consoleErrors: string[] = [];
  window.on('requestfailed', (r) => failedRequests.push(r.url()));
  window.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  const cases: Array<[string, number, string, string]> = [
    ['Claude', 1, 'atom-one-light.css', 'atom-one-dark.css'],
    ['Obsidian', 2, 'stackoverflow-light.css', 'obsidian.css'],
    ['Tokyo Night', 3, 'tokyo-night-light.css', 'tokyo-night-dark.css'],
    [CUSTOM_NAME, 4, 'github.css', 'github-dark.css'], // custom skins use the Default pair
  ];
  const endsWith = (file: string) => new RegExp(`/renderer/${file.replace('.', '\\.')}$`);

  for (const [name, index, lightFile, darkFile] of cases) {
    await clickItem(electronApp, `menu-skin-${index}`);
    const colors = CHROME[name as keyof typeof CHROME];

    // light half while Dark Mode is off
    await expect.poll(() => titleBarBg(window)).toBe(colors.light);
    await expect.poll(async () => (await hljsHrefs(window)).light).toMatch(endsWith(lightFile));
    await expect.poll(async () => (await hljsHrefs(window)).dark).toMatch(endsWith(darkFile));
    expect(await itemChecked(electronApp, `menu-skin-${index}`)).toBe(true);

    // Dark Mode on: the same skin's dark half, no stale light value
    await clickItem(electronApp, 'menu-dark-mode');
    await expect.poll(() => dark(window)).toBe(true);
    await expect.poll(() => titleBarBg(window)).toBe(colors.dark);

    // Dark Mode off again: back to the light half
    await clickItem(electronApp, 'menu-dark-mode');
    await expect.poll(() => dark(window)).toBe(false);
    await expect.poll(() => titleBarBg(window)).toBe(colors.light);
  }

  // Back to Default restores today's look and sheets.
  await clickItem(electronApp, 'menu-skin-0');
  await expect.poll(() => titleBarBg(window)).toBe(CHROME.Default.light);
  await expect.poll(async () => (await hljsHrefs(window)).light).toMatch(endsWith('github.css'));

  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('a skin selected while Dark Mode is already on applies its dark half (push-order independence, #226)', async ({
  electronApp,
}) => {
  const window = await electronApp.firstWindow();
  await clickItem(electronApp, 'menu-dark-mode');
  await expect.poll(() => dark(window)).toBe(true);
  await clickItem(electronApp, 'menu-skin-2');
  await expect.poll(() => titleBarBg(window)).toBe(CHROME.Obsidian.dark);
});

test('markdown content keeps its stylesheets in every skin (#224)', async ({ electronApp }) => {
  const window = await electronApp.firstWindow();
  const markdownHref = () =>
    window.evaluate(() => (document.getElementById('theme-markdown-light') as HTMLLinkElement).href);
  const before = await markdownHref();
  await clickItem(electronApp, 'menu-skin-1');
  await expect.poll(() => titleBarBg(window)).toBe(CHROME.Claude.light);
  expect(await markdownHref()).toBe(before);
  expect(before).toMatch(/\/renderer\/github-markdown-light\.css$/);
});

test('the build ships skin.js and all eight highlight theme files in dist/renderer', async () => {
  const dir = path.join(__dirname, '../../dist/renderer');
  for (const f of [
    'skin.js',
    'github.css',
    'github-dark.css',
    'atom-one-light.css',
    'atom-one-dark.css',
    'stackoverflow-light.css',
    'obsidian.css',
    'tokyo-night-light.css',
    'tokyo-night-dark.css',
  ]) {
    expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    expect(fs.statSync(path.join(dir, f)).size, f).toBeGreaterThan(0);
  }
});

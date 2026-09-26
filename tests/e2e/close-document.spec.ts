import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test as base, expect } from './support/fixtures';
import { expectPristineDocumentView } from './support/pristine';

// Task 44: File > Close (Ctrl+W). functional_domain.md #145-#155.
//
// Every file this spec edits lives in a per-test temp directory (same
// fixture-owned create/cleanup shape as live-reload.spec.ts), never in the
// checked-in tests/e2e/fixtures tree.

interface TempTree {
  root: string;
  notes: string; // <root>/notes.md
  doc: string; // <root>/sub/doc.md (has frontmatter)
  missing: string; // <root>/missing.md (never created)
}

const DOC_SOURCE = '---\ntitle: Close Fixture\n---\n\n# Close Doc Heading\n\nOriginal body.\n';

const test = base.extend<{ tree: TempTree }>({
  tree: async ({}, use) => {
    // realpath.native: os.tmpdir() can be an 8.3 short path (C:\Users\ADMINI~1)
    // while main canonicalizes the tree root to the long form, which would make
    // the renderer's isPathUnder(activeFilePath, treeRoot) miss the highlight.
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-close-')));
    fs.mkdirSync(path.join(root, 'sub'));
    const notes = path.join(root, 'notes.md');
    const doc = path.join(root, 'sub', 'doc.md');
    fs.writeFileSync(notes, '# Notes Heading\n');
    fs.writeFileSync(doc, DOC_SOURCE);
    await use({ root, notes, doc, missing: path.join(root, 'missing.md') });
    fs.rmSync(root, { recursive: true, force: true });
  },
});

// firstWindow() can resolve before renderer.js has registered its IPC
// listeners; a push sent before then (e.g. the tree root after an immediate
// Open Folder) would be dropped. renderer.js runs before the 'load' event.
async function launchedWindow(app: ElectronApplication): Promise<Page> {
  const window = await app.firstWindow();
  await window.waitForLoadState('load');
  return window;
}

async function stubOpenDialog(app: ElectronApplication, target: string): Promise<void> {
  await app.evaluate(({ dialog }, targetPath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [targetPath] })) as typeof dialog.showOpenDialog;
  }, target);
}

async function clickMenuItem(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click(), id);
}

async function openViaMenu(app: ElectronApplication, filePath: string): Promise<void> {
  await stubOpenDialog(app, filePath);
  await clickMenuItem(app, 'menu-open');
}

function menuCloseEnabled(app: ElectronApplication): Promise<boolean | undefined> {
  return app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-close')?.enabled);
}

async function pressCtrlW(app: ElectronApplication): Promise<void> {
  // Same accelerator technique as window-chrome.spec.ts (e): sendInputEvent
  // reaches Electron's native accelerator table; page.keyboard does not.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: ['control'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'W', modifiers: ['control'] });
  });
}

interface Counters {
  fileRendered: number;
  documentClosed: number;
  setApplicationMenu: number;
}

// Counts main -> renderer sends per channel and application-menu rebuilds,
// by monkey-patching inside main (same technique as the dialog /
// buildFromTemplate stubs elsewhere in this suite). Originals still run.
async function installCounters(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow, Menu }) => {
    const bag = globalThis as unknown as { __mdViewCloseCounters: Counters };
    bag.__mdViewCloseCounters = { fileRendered: 0, documentClosed: 0, setApplicationMenu: 0 };

    const wc = BrowserWindow.getAllWindows()[0].webContents;
    const originalSend = wc.send.bind(wc);
    wc.send = ((channel: string, ...args: unknown[]) => {
      if (channel === 'md-view:file-rendered') bag.__mdViewCloseCounters.fileRendered += 1;
      if (channel === 'md-view:document-closed') bag.__mdViewCloseCounters.documentClosed += 1;
      originalSend(channel, ...args);
    }) as typeof wc.send;

    const originalSetMenu = Menu.setApplicationMenu.bind(Menu);
    Menu.setApplicationMenu = ((menu: Electron.Menu | null) => {
      bag.__mdViewCloseCounters.setApplicationMenu += 1;
      originalSetMenu(menu);
    }) as typeof Menu.setApplicationMenu;
  });
}

function readCounters(app: ElectronApplication): Promise<Counters> {
  return app.evaluate(() => (globalThis as unknown as { __mdViewCloseCounters: Counters }).__mdViewCloseCounters);
}

function treeLabel(window: Page, name: string) {
  const exact = new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
  return window.locator('.tree-label', { hasText: exact });
}

// Positive-control saves: chokidar becomes ready asynchronously (and runs
// with ignoreInitial), so a single write racing the watcher's startup can be
// missed under load. Re-save until the change is observed. This only makes
// the *positive* controls robust; it never weakens a negative assertion.
async function saveUntilRendered(window: Page, filePath: string, heading: string): Promise<void> {
  await expect(async () => {
    await fsp.writeFile(filePath, '# ' + heading + '\n');
    await expect(window.locator('#content')).toContainText(heading, { timeout: 1500 });
  }).toPass({ timeout: 15000 });
}

const settle =(ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('(a) menu-close is disabled at launch, enabled after an open, disabled again after Close (#151)', async ({
  electronApp,
  tree,
}) => {
  const window = await launchedWindow(electronApp);
  await expect(window.locator('#empty-state')).toBeVisible();
  expect(await menuCloseEnabled(electronApp)).toBe(false);

  await openViaMenu(electronApp, tree.notes);
  await expect(window.locator('#content')).toContainText('Notes Heading', { timeout: 10000 });
  await expect.poll(() => menuCloseEnabled(electronApp)).toBe(true);

  await clickMenuItem(electronApp, 'menu-close');
  await expectPristineDocumentView(window);
  await expect.poll(() => menuCloseEnabled(electronApp)).toBe(false);
});

test('(b) round-trip: Close returns to the pristine view; tree, dark mode and the Code tab survive (#146 #152 #153)', async ({
  electronApp,
  tree,
}) => {
  const window = await launchedWindow(electronApp);

  // A file with frontmatter, then its ancestor as tree root, so the tree has
  // an expanded folder plus the active highlight on the open file.
  await openViaMenu(electronApp, tree.doc);
  await expect(window.locator('#content')).toContainText('Close Doc Heading', { timeout: 10000 });
  await expect(window.locator('#frontmatter')).toBeVisible();

  await stubOpenDialog(electronApp, tree.root);
  await clickMenuItem(electronApp, 'menu-open-folder');
  await expect(treeLabel(window, 'notes.md')).toBeVisible();
  await expect(treeLabel(window, 'doc.md')).toBeVisible(); // sub/ auto-expanded
  await expect(window.locator('.tree-row-active')).toHaveCount(1);

  await clickMenuItem(electronApp, 'menu-dark-mode');
  await window.waitForFunction(() => document.body.classList.contains('dark-mode'));
  await window.locator('#tab-code').click();
  await expect(window.locator('#tab-code')).toHaveClass(/active/);

  await clickMenuItem(electronApp, 'menu-close');

  await expectPristineDocumentView(window);

  // #153: the tree root and the expanded/fetched tree DOM survive.
  await expect(treeLabel(window, 'notes.md')).toBeVisible();
  await expect(treeLabel(window, 'sub')).toBeVisible();
  await expect(treeLabel(window, 'doc.md')).toBeVisible();

  // #152: dark mode and the current tab are untouched.
  expect(await window.evaluate(() => document.body.classList.contains('dark-mode'))).toBe(true);
  await expect(window.locator('#tab-code')).toHaveClass(/active/);
  expect(
    await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-view-code')?.checked)
  ).toBe(true);
  expect(
    await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-dark-mode')?.checked)
  ).toBe(true);
});

test('(c) CmdOrCtrl+W closes an open document; with nothing open it sends nothing and rebuilds no menu (#150)', async ({
  electronApp,
  tree,
}) => {
  const window = await launchedWindow(electronApp);
  await expect(window.locator('#empty-state')).toBeVisible();
  await installCounters(electronApp);

  // Nothing open. The Ctrl+W send only shows that the disabled item's
  // accelerator does nothing (a disabled item's accelerator never reaches the
  // handler at all). The direct MenuItem.click(), which ignores `enabled` and
  // does invoke the real handler, is what proves session.close() itself is
  // inert when nothing is open (#150).
  await pressCtrlW(electronApp);
  await clickMenuItem(electronApp, 'menu-close');
  await settle(1000);
  expect(await readCounters(electronApp)).toEqual({ fileRendered: 0, documentClosed: 0, setApplicationMenu: 0 });
  await expectPristineDocumentView(window);

  // Something open: the accelerator closes it.
  await openViaMenu(electronApp, tree.notes);
  await expect(window.locator('#content')).toContainText('Notes Heading', { timeout: 10000 });
  await expect.poll(() => menuCloseEnabled(electronApp)).toBe(true);

  await pressCtrlW(electronApp);

  await expectPristineDocumentView(window);
  await expect.poll(async () => (await readCounters(electronApp)).documentClosed).toBe(1);
});

test('(d) the title-bar File popup carries menu-close at index 2 and its enabled state mirrors occupancy (#151)', async ({
  electronApp,
  tree,
}) => {
  const window = await launchedWindow(electronApp);

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

  const readPopupClose = () =>
    electronApp.evaluate(() => {
      const bag = globalThis as unknown as { __mdViewLastPopupMenu: Electron.Menu | null };
      const menu = bag.__mdViewLastPopupMenu;
      const result = {
        ids: menu?.items.map((item) => item.id ?? item.type) ?? [],
        enabled: menu?.getMenuItemById('menu-close')?.enabled,
      };
      menu?.closePopup();
      return result;
    });

  await window.locator('#menu-label-file').click();
  const before = await readPopupClose();
  expect(before.ids[2]).toBe('menu-close');
  expect(before.enabled).toBe(false);

  await openViaMenu(electronApp, tree.notes);
  await expect(window.locator('#content')).toContainText('Notes Heading', { timeout: 10000 });

  await window.locator('#menu-label-file').click();
  const after = await readPopupClose();
  expect(after.ids[2]).toBe('menu-close');
  expect(after.enabled).toBe(true);
});

test('(e) no resurrection: after Close, saving the previously open file sends nothing and changes nothing (#147 #148)', async ({
  electronApp,
  tree,
}) => {
  const window = await launchedWindow(electronApp);
  await openViaMenu(electronApp, tree.notes);
  await expect(window.locator('#content')).toContainText('Notes Heading', { timeout: 10000 });

  // Positive control: the watcher is live before Close.
  await saveUntilRendered(window, tree.notes, 'Notes Edited Once');

  await clickMenuItem(electronApp, 'menu-close');
  await expectPristineDocumentView(window);

  await installCounters(electronApp);
  await fsp.writeFile(tree.notes, '# Notes Resurrected\n');
  await settle(1500);

  expect((await readCounters(electronApp)).fileRendered).toBe(0);
  await expectPristineDocumentView(window);
});

test('(f) Close from the error state still leaves zero watchers: a later save to the earlier file sends nothing (#145 #148)', async ({
  electronApp,
  tree,
}) => {
  const window = await launchedWindow(electronApp);
  await openViaMenu(electronApp, tree.notes);
  await expect(window.locator('#content')).toContainText('Notes Heading', { timeout: 10000 });

  await openViaMenu(electronApp, tree.missing);
  await expect(window.locator('#content')).toContainText('Could not open file', { timeout: 10000 });
  // #145: a failed open still occupies the slot.
  await expect(window.locator('#empty-state')).toBeHidden();
  expect(await menuCloseEnabled(electronApp)).toBe(true);

  await clickMenuItem(electronApp, 'menu-close');
  await expectPristineDocumentView(window);

  await installCounters(electronApp);
  await fsp.writeFile(tree.notes, '# Notes Resurrected\n');
  await settle(1500);

  expect((await readCounters(electronApp)).fileRendered).toBe(0);
  await expectPristineDocumentView(window);
});

test('(f) pinned pre-existing behavior: a failed open leaves the previous file watched (not fixed by Task 44)', async ({
  electronApp,
  tree,
}) => {
  const window = await launchedWindow(electronApp);
  await openViaMenu(electronApp, tree.notes);
  await expect(window.locator('#content')).toContainText('Notes Heading', { timeout: 10000 });

  await openViaMenu(electronApp, tree.missing);
  await expect(window.locator('#content')).toContainText('Could not open file', { timeout: 10000 });

  // The earlier file's watcher is still running, so saving it re-renders it.
  // This is exactly the lingering watcher the error-state Close test above
  // proves Close still stops.
  await saveUntilRendered(window, tree.notes, 'Notes Still Watched');
});

test('(g) a watcher re-render of the open document never rebuilds the menu (#151)', async ({ electronApp, tree }) => {
  const window = await launchedWindow(electronApp);
  await openViaMenu(electronApp, tree.notes);
  await expect(window.locator('#content')).toContainText('Notes Heading', { timeout: 10000 });
  await expect.poll(() => menuCloseEnabled(electronApp)).toBe(true);

  await installCounters(electronApp);
  await saveUntilRendered(window, tree.notes, 'Notes Re-rendered');
  await settle(500);

  const counters = await readCounters(electronApp);
  expect(counters.fileRendered).toBeGreaterThanOrEqual(1);
  expect(counters.setApplicationMenu).toBe(0);
});

test('(h) Open Folder never occupies the slot: menu-close stays disabled and the view stays pristine (#153)', async ({
  electronApp,
  tree,
}) => {
  const window = await launchedWindow(electronApp);
  await stubOpenDialog(electronApp, tree.root);
  await clickMenuItem(electronApp, 'menu-open-folder');
  await expect(treeLabel(window, 'notes.md')).toBeVisible();

  expect(await menuCloseEnabled(electronApp)).toBe(false);
  await expectPristineDocumentView(window);
});

test.describe('(h) Close persists nothing (#152)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')) as { version: string };
  test.use({
    initialUserDataFiles: {
      'settings.json': JSON.stringify(
        { View: { 'Dark Mode': false, 'Show Frontmatter': true, 'Show File Tree': true } },
        null,
        2
      ),
      'state.json': JSON.stringify({ lastSeenVersion: pkg.version }),
    },
  });

  test('Close writes neither settings.json nor state.json (content and mtime unchanged)', async ({
    electronApp,
    tree,
    userDataDir,
  }) => {
    const snapshot = () =>
      ['settings.json', 'state.json'].map((name) => {
        const file = path.join(userDataDir, name);
        return { name, content: fs.readFileSync(file, 'utf8'), mtimeMs: fs.statSync(file).mtimeMs };
      });

    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tree.notes);
    await expect(window.locator('#content')).toContainText('Notes Heading', { timeout: 10000 });

    const before = snapshot();
    await clickMenuItem(electronApp, 'menu-close');
    await expectPristineDocumentView(window);
    await settle(500);

    expect(snapshot()).toEqual(before);
  });
});

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { test as base, expect } from './support/fixtures';
import { expectPristineDocumentView } from './support/pristine';
import { waitForRendererReady } from './support/rendererReady';

// Task 54 (functional_domain.md #241-#254): launch-time session restore of
// the last open folder/file. Every file this spec seeds lives in a per-test
// temp directory, never the checked-in tests/e2e/fixtures tree (same posture
// as close-document.spec.ts).

interface Tree {
  base: string;
  folderA: string; // real folder, contains noteA.md
  fileInA: string; // folderA/noteA.md
  folderB: string; // real, SEPARATE folder (the #244 divergence target), contains noteB.md
  fileInB: string; // folderB/noteB.md
  missingFile: string; // folderA/missing.md, never created
  missingFolder: string; // base/does-not-exist, never created
}

type PathChoice = 'none' | 'a' | 'b' | 'missing';

interface SeedSpec {
  folder?: PathChoice;
  file?: PathChoice;
  showTreePanel?: boolean;
}

const test = base.extend<{ tree: Tree; seed: SeedSpec }>({
  tree: async ({}, use) => {
    const treeBase = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-session-')));
    const folderA = path.join(treeBase, 'folderA');
    const folderB = path.join(treeBase, 'folderB');
    fs.mkdirSync(folderA);
    fs.mkdirSync(folderB);
    const fileInA = path.join(folderA, 'noteA.md');
    const fileInB = path.join(folderB, 'noteB.md');
    fs.writeFileSync(fileInA, '# Note A Heading\n');
    fs.writeFileSync(fileInB, '# Note B Heading\n');
    await use({
      base: treeBase,
      folderA,
      fileInA,
      folderB,
      fileInB,
      missingFile: path.join(folderA, 'missing.md'),
      missingFolder: path.join(treeBase, 'does-not-exist'),
    });
    fs.rmSync(treeBase, { recursive: true, force: true });
  },
  // Default: no seed at all -- a truly fresh userData, not an empty state.json.
  seed: [{}, { option: true }],
  initialUserDataFiles: async ({ tree, seed }, use) => {
    const folderMap: Record<PathChoice, string | undefined> = {
      none: undefined,
      a: tree.folderA,
      b: tree.folderB,
      missing: tree.missingFolder,
    };
    const fileMap: Record<PathChoice, string | undefined> = {
      none: undefined,
      a: tree.fileInA,
      b: tree.fileInB,
      missing: tree.missingFile,
    };

    const state: Record<string, unknown> = {};
    const folderPath = folderMap[seed.folder ?? 'none'];
    const filePath = fileMap[seed.file ?? 'none'];
    if (folderPath !== undefined) state.lastFolderPath = folderPath;
    if (filePath !== undefined) state.lastFileOpenPath = filePath;

    const files: Record<string, string> = {};
    if (Object.keys(state).length > 0) files['state.json'] = JSON.stringify(state);
    if (seed.showTreePanel !== undefined) {
      files['settings.json'] = JSON.stringify({
        View: { 'Dark Mode': false, 'Show Frontmatter': true, 'Show File Tree': seed.showTreePanel },
      });
    }

    await use(files);
  },
});

async function launchedWindow(app: ElectronApplication): Promise<Page> {
  const window = await app.firstWindow();
  await window.waitForLoadState('load');
  return window;
}

function menuCloseEnabled(app: ElectronApplication): Promise<boolean | undefined> {
  return app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-close')?.enabled);
}

function exactLabel(name: string): RegExp {
  return new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
}

function treeLabel(window: Page, name: string) {
  return window.locator('.tree-label', { hasText: exactLabel(name) });
}

// Counts main -> renderer FOLDER_TREE_ROOT sends from inside the app process
// (same monkey-patch technique as close-document.spec.ts's installCounters).
// Installed from the test body, after the fixture already resolved -- fine
// for a negative assertion (expecting it to stay at 0), since there is then
// no race: if restoreLastSession were ever going to call establishTreeRoot,
// it would already be done well within the settle window below.
async function installTreeRootCounter(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const bag = globalThis as unknown as { __mdViewTreeRootSends: number };
    bag.__mdViewTreeRootSends = 0;
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    const originalSend = wc.send.bind(wc);
    wc.send = ((channel: string, ...args: unknown[]) => {
      if (channel === 'md-view:folder-tree-root') bag.__mdViewTreeRootSends += 1;
      originalSend(channel, ...args);
    }) as typeof wc.send;
  });
}

function readTreeRootSends(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => (globalThis as unknown as { __mdViewTreeRootSends: number }).__mdViewTreeRootSends);
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.describe('scenario 1: fresh userData (no state.json) -> true pristine (#248)', () => {
  test('no restore happens: pristine empty-state, no tree root sent, File > Close disabled', async ({
    electronApp,
  }) => {
    const window = await launchedWindow(electronApp);
    await expectPristineDocumentView(window);
    await expect(window.locator('#tree-empty-state')).toBeVisible();
    expect(await menuCloseEnabled(electronApp)).toBe(false);

    await installTreeRootCounter(electronApp);
    await settle(800);
    expect(await readTreeRootSends(electronApp)).toBe(0);
  });
});

test.describe('scenario 2: both a real folder and a real file inside it (#244 common case)', () => {
  test.use({ seed: { folder: 'a', file: 'a' } });

  test('the file is rendered, the tree is rooted at the folder, the watcher is active, File > Close is enabled', async ({
    electronApp,
    tree,
  }) => {
    const window = await launchedWindow(electronApp);
    await expect(window.locator('#content')).toContainText('Note A Heading', { timeout: 10000 });
    await expect(treeLabel(window, 'noteA.md')).toBeVisible();
    await expect.poll(() => menuCloseEnabled(electronApp)).toBe(true);

    // Watcher active: a save triggers a live-reload re-render.
    await expect(async () => {
      await fsp.writeFile(tree.fileInA, '# Note A Edited\n');
      await expect(window.locator('#content')).toContainText('Note A Edited', { timeout: 1500 });
    }).toPass({ timeout: 15000 });
  });
});

test.describe('scenario 3: a real folder but a lastFileOpenPath that does not exist (#247)', () => {
  test.use({ seed: { folder: 'a', file: 'missing' } });

  test('the folder tree is shown, the document stays pristine, File > Close is disabled, no watcher starts', async ({
    electronApp,
    tree,
  }) => {
    const window = await launchedWindow(electronApp);
    await expect(treeLabel(window, 'noteA.md')).toBeVisible();
    await expect(window.locator('#tree-empty-state')).toBeHidden();

    await expectPristineDocumentView(window);
    expect(await menuCloseEnabled(electronApp)).toBe(false);

    // No watcher: editing the (missing, never opened) file's sibling proves
    // nothing by itself, but confirms the document truly never got occupied.
    await settle(500);
    await expectPristineDocumentView(window);
    void tree; // tree fixture only needed for its setup side effect here
  });
});

test.describe('scenario 4: a lastFolderPath that does not exist (#246) -> true pristine', () => {
  test.use({ seed: { folder: 'missing', file: 'missing' } });

  test('pristine empty-state, no tree root sent', async ({ electronApp }) => {
    const window = await launchedWindow(electronApp);
    await expectPristineDocumentView(window);
    await expect(window.locator('#tree-empty-state')).toBeVisible();
    expect(await menuCloseEnabled(electronApp)).toBe(false);

    await installTreeRootCounter(electronApp);
    await settle(800);
    expect(await readTreeRootSends(electronApp)).toBe(0);
  });
});

test.describe('scenario 5: a real file plus a SEPARATE real folder (#244 divergence case)', () => {
  test.use({ seed: { folder: 'b', file: 'a' } });

  test('the file is opened, but the tree root is the seeded folder, not the opened file\'s own directory', async ({
    electronApp,
  }) => {
    const window = await launchedWindow(electronApp);
    await expect(window.locator('#content')).toContainText('Note A Heading', { timeout: 10000 });
    await expect.poll(() => menuCloseEnabled(electronApp)).toBe(true);

    // The tree root is folderB (noteB.md visible), never re-overridden back
    // to folderA (the opened file's own directory) by documentSession.open's
    // establishTreeRootFor side effect -- proving the file-then-folder order.
    await expect(treeLabel(window, 'noteB.md')).toBeVisible();
    await expect(window.locator('.tree-label', { hasText: exactLabel('noteA.md') })).toHaveCount(0);
  });
});

test.describe('scenario 6: showTreePanel:false + a valid seeded folder (#245)', () => {
  test.use({ seed: { folder: 'a', file: 'none', showTreePanel: false } });

  test('the tree root is restored (sent over FOLDER_TREE_ROOT) but the panel itself stays closed', async ({
    electronApp,
  }) => {
    const window = await launchedWindow(electronApp);

    await expect(window.locator('#tree-panel')).toBeHidden();
    // The folder was still restored: its entry is present in the tree DOM
    // (count, not visibility -- an ancestor is hidden by the user's own
    // ViewSettings, independent of whether the data arrived).
    await expect(treeLabel(window, 'noteA.md')).toHaveCount(1);

    await expectPristineDocumentView(window);
    expect(await menuCloseEnabled(electronApp)).toBe(false);
  });
});

// Guardrail #250's "close clears the pointer" half, proven ACROSS two real
// process launches sharing one userDataDir -- none of the 6 single-launch
// scenarios above exercise an in-session Close before a relaunch. Raw
// _electron.launch (not the shared electronApp fixture, which tears its own
// app down and would create a second, unrelated userDataDir): both launches
// here must share the exact same on-disk state.json.
const repoRoot = path.join(__dirname, '../..');
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

async function launchSharing(userDataDir: string): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: [`--user-data-dir=${userDataDir}`, '.'],
    cwd: repoRoot,
    env: childEnv,
    userDataDir,
  });
  await waitForRendererReady(app);
  return app;
}

test.describe('close-then-relaunch (#250 fault-injection regression: close must persist null)', () => {
  test('a file closed before quitting is NOT reopened on the next launch', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-session-close-'));
    const docDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-session-closedoc-'));
    const docPath = path.join(docDir, 'closeme.md');
    fs.writeFileSync(docPath, '# Close Me Heading\n');

    let app: ElectronApplication | null = null;
    try {
      app = await launchSharing(userDataDir);
      const window = await app.firstWindow();
      await window.waitForLoadState('load');

      await app.evaluate(({ dialog }, target) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as typeof dialog.showOpenDialog;
      }, docPath);
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click());
      await expect(window.locator('#content')).toContainText('Close Me Heading', { timeout: 10000 });

      await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-close')?.click());
      await expectPristineDocumentView(window);

      const exited = app.waitForEvent('close');
      await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => {});
      await exited;
      app = null;

      const stateAfterClose = JSON.parse(fs.readFileSync(path.join(userDataDir, 'state.json'), 'utf8'));
      expect(stateAfterClose.lastFileOpenPath).toBeNull();

      app = await launchSharing(userDataDir);
      const window2 = await app.firstWindow();
      await window2.waitForLoadState('load');
      await expectPristineDocumentView(window2);
    } finally {
      if (app) await app.close().catch(() => {});
      fs.rmSync(userDataDir, { recursive: true, force: true });
      fs.rmSync(docDir, { recursive: true, force: true });
    }
  });
});

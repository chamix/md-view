import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { IPC_CHANNELS } from '../../src/preload/api';

const ENTRY_POINT = path.join(process.cwd(), 'dist/main/index.js');

// First renderer UI consumer of Task 17/18's FOLDER_TREE_ROOT / listDirectory
// contract (Task 17 was backend-only). Reuses the same fixture tree
// file-tree.spec.ts already exercises at the IPC layer:
//   notes.md, ignored.txt, sub/deep.md, sub/deep2.md, empty-of-md/
const fixtureTreeDir = path.join(process.cwd(), 'tests/e2e/fixtures/tree');
const fixtureNotesFile = path.join(fixtureTreeDir, 'notes.md');

test.use({ electronArgs: [fixtureNotesFile] });

// Exact-text label matcher: names in this fixture set overlap as substrings
// ("deep.md" is a substring-prefix of "deep2.md"), so a plain hasText
// substring match would be ambiguous -- anchor to the full label instead.
function exactLabel(name: string): RegExp {
  return new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
}

// Deliberately filters on .tree-row, not .tree-node: a directory's
// .tree-children container is a *sibling* of its own .tree-row (both
// appended directly to the same .tree-node in renderer.js), never a
// descendant of that .tree-row. That makes a .tree-row's only possible
// .tree-label descendant its own label, with zero ambiguity regardless of
// nesting depth -- filtering on .tree-node instead would be ambiguous,
// since an ancestor directory's .tree-node also "has" every descendant's
// .tree-label once expanded (confirmed the hard way: an earlier .tree-node
// -based version of this helper resolved 'deep.md' to the 'sub' node
// itself, because .first() picked the nearer ancestor match in document
// order).
function treeRow(window: Page, name: string) {
  return window.locator('.tree-row', { has: window.locator('.tree-label', { hasText: exactLabel(name) }) }).first();
}

function treeNode(window: Page, name: string) {
  return treeRow(window, name).locator('xpath=..');
}

// `> .tree-children` (direct-child combinator), not a bare descendant
// selector -- once a node is expanded to a nested level, its .tree-node
// subtree also contains further-nested .tree-children containers belonging
// to its own children, so an unrestricted descendant match would be
// ambiguous at depth 2+.
function treeChildren(window: Page, name: string) {
  return treeNode(window, name).locator('> .tree-children');
}

test('opening a fixture file shows the tree panel with the root entries, filtered/ordered per Task 17 (directories before notes.md, ignored.txt absent)', async ({
  electronApp,
}) => {
  const window = await electronApp.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('notes', { timeout: 10000 });

  const treeRoot = window.locator('#tree-root');
  await expect(treeRoot).toBeVisible();
  await expect(window.locator('#tree-empty-state')).toBeHidden();

  const topLevelLabels = await window.locator('#tree-root > .tree-node > .tree-row .tree-label').allTextContents();
  expect(topLevelLabels).toEqual(['empty-of-md', 'sub', 'notes.md']);
  expect(topLevelLabels).not.toContain('ignored.txt');

  const topLevelTypes = await window
    .locator('#tree-root > .tree-node')
    .evaluateAll((nodes) => nodes.map((n) => (n.classList.contains('tree-directory') ? 'directory' : 'file')));
  expect(topLevelTypes).toEqual(['directory', 'directory', 'file']);
});

test('clicking an unexpanded folder reveals its children, including empty-of-md/ expanding to a genuinely empty (not error) state', async ({
  electronApp,
}) => {
  const window = await electronApp.firstWindow();
  await expect(window.locator('#tree-root')).toBeVisible();

  const subChildren = treeChildren(window, 'sub');
  await expect(subChildren).toBeHidden();
  await treeRow(window, 'sub').click();
  await expect(subChildren).toBeVisible();

  const subChildLabels = await subChildren.locator('> .tree-node > .tree-row .tree-label').allTextContents();
  expect(subChildLabels).toEqual(['deep.md', 'deep2.md']);

  const emptyChildren = treeChildren(window, 'empty-of-md');
  await expect(emptyChildren).toBeHidden();
  await treeRow(window, 'empty-of-md').click();
  await expect(emptyChildren).toBeVisible();

  // Genuinely empty -- a visible "(empty folder)" indicator row, zero real
  // entry nodes, and specifically not an error row (guardrail #26 covers
  // the ok:false case; this is the ok:true/zero-entries case, a different
  // outcome that must not be conflated with it).
  await expect(emptyChildren.locator('.tree-empty')).toBeVisible();
  await expect(emptyChildren.locator('.tree-error')).toHaveCount(0);
  await expect(emptyChildren.locator('.tree-node')).toHaveCount(0);
});

test('FI-1: exactly one listDirectory call per folder across any number of collapse/re-expand cycles (guardrail #21)', async ({
  electronApp,
}) => {
  const window = await electronApp.firstWindow();
  await expect(window.locator('#tree-root')).toBeVisible();

  // Task 17's REQUEST_LIST_DIRECTORY is ipcMain.handle/ipcRenderer.invoke
  // (request-response) -- Electron allows exactly one handler per channel,
  // so the usual "add a second coexisting listener" counting idiom used
  // elsewhere in this suite (e.g. drag-drop.spec.ts) does not apply here.
  //
  // The spec's own worked-out adaptation (require() the compiled
  // dist/main/index.js again from inside electronApp.evaluate(), relying on
  // Node's require cache to return the same module.exports) was tried first
  // and empirically does NOT work in this Electron/Playwright combination:
  // electronApp.evaluate() runs the callback via a global eval() inside the
  // main process's V8 context, not as a CommonJS module body, so neither
  // the bare `require` identifier nor `module`/`process.mainModule` (all of
  // which Node injects per-module, never as true globals) are in scope --
  // confirmed directly: typeof require / module / process.mainModule are
  // all 'undefined' there.
  //
  // Cleaner mechanism that preserves the same two properties the spec asks
  // for (real production logic still runs; call count is observable),
  // using only what electronApp.evaluate() actually has in scope (the
  // `electron` module's own exports, e.g. `ipcMain`): Electron's ipcMain
  // stores its ipcMain.handle() registrations in its own internal
  // `_invokeHandlers` Map, keyed by channel name (confirmed empirically via
  // a throwaway probe test against this exact Electron version). The
  // function already sitting in that map IS the real, unmodified production
  // handler `(_e, dirPath) => listDirectoryEntries(dirPath)` registered by
  // src/main/index.ts -- grabbing it, removing it, and re-registering a
  // counting wrapper that delegates straight to it exercises the exact same
  // production code path the spec's require()-based approach was after,
  // without needing require() at all.
  await electronApp.evaluate(({ ipcMain }, channel) => {
    const invokeHandlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> })
      ._invokeHandlers;
    const originalHandler = invokeHandlers.get(channel);
    if (!originalHandler) throw new Error('production REQUEST_LIST_DIRECTORY handler not found -- test setup assumption broken');

    (globalThis as unknown as { __listDirectoryCallCount: number }).__listDirectoryCallCount = 0;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event: unknown, dirPath: string) => {
      (globalThis as unknown as { __listDirectoryCallCount: number }).__listDirectoryCallCount += 1;
      return originalHandler(event, dirPath);
    });
  }, IPC_CHANNELS.REQUEST_LIST_DIRECTORY);

  const subChildren = treeChildren(window, 'sub');
  const subRow = treeRow(window, 'sub');

  await subRow.click(); // expand: never fetched -> exactly one listDirectory call
  await expect(subChildren).toBeVisible();

  await subRow.click(); // collapse: already populated -> pure visibility toggle, zero fetch
  await expect(subChildren).toBeHidden();

  await subRow.click(); // re-expand: already populated -> pure visibility toggle, zero fetch
  await expect(subChildren).toBeVisible();

  const count = await electronApp.evaluate(
    () => (globalThis as unknown as { __listDirectoryCallCount: number }).__listDirectoryCallCount
  );
  expect(count).toBe(1);
});

test('clicking a file row updates #content/#status-bar exactly as File>Open does', async ({ electronApp }) => {
  const window = await electronApp.firstWindow();
  await expect(window.locator('#tree-root')).toBeVisible();

  await treeRow(window, 'sub').click();
  const subChildren = treeChildren(window, 'sub');
  await expect(subChildren).toBeVisible();

  const deepFilePath = path.join(fixtureTreeDir, 'sub', 'deep.md');
  await treeRow(window, 'deep.md').click();

  const content = window.locator('#content');
  await expect(content).toContainText('deep', { timeout: 10000 });

  const statusBar = window.locator('#status-bar');
  await expect(statusBar).toHaveText(deepFilePath, { timeout: 10000 });
});

test('dark mode toggle with a folder expanded to a nested level applies real computed styles to tree elements', async ({
  electronApp,
}) => {
  const window = await electronApp.firstWindow();
  await expect(window.locator('#tree-root')).toBeVisible();

  await treeRow(window, 'sub').click();
  const subChildren = treeChildren(window, 'sub');
  await expect(subChildren).toBeVisible();

  const nestedRow = treeRow(window, 'deep.md');
  await expect(nestedRow).toBeVisible();

  const colorBefore = await nestedRow.evaluate((el) => window.getComputedStyle(el).color);
  const panelBgBefore = await window
    .locator('#tree-panel')
    .evaluate((el) => window.getComputedStyle(el).backgroundColor);

  await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-dark-mode')?.click());
  await window.waitForFunction(() => document.body.classList.contains('dark-mode'));

  const colorAfter = await nestedRow.evaluate((el) => window.getComputedStyle(el).color);
  const panelBgAfter = await window
    .locator('#tree-panel')
    .evaluate((el) => window.getComputedStyle(el).backgroundColor);

  expect(colorAfter).not.toBe(colorBefore);
  expect(colorAfter).toBe('rgb(201, 209, 217)'); // #c9d1d9, github-dark-scoped tree row text
  expect(panelBgAfter).not.toBe(panelBgBefore);
  expect(panelBgAfter).toBe('rgb(22, 27, 34)'); // #161b22, matches #status-bar's/#frontmatter's existing dark-mode background

  // The nested row is still visible/expanded after the theme toggle -- Dark
  // Mode is a pure redraw of an already-known state (functional_domain.md
  // Task 8 guardrail #4), never a content-refresh side effect.
  await expect(nestedRow).toBeVisible();
  await expect(subChildren).toBeVisible();
});

// Task 23: drag-to-resize handle between #tree-panel and #main-panel.
// `#tree-panel` is the flex row's first child (left edge always at viewport
// x=0), so a real Playwright mouse drag's clientX *is* the desired panel
// width -- these tests drive `page.mouse.down/move/up` directly rather than
// standing in with a synthetic `style.setProperty()` call, per the task
// assignment's own requirement.
test.describe('Task 23: tree panel drag-to-resize', () => {
  async function dragHandleTo(window: Page, targetClientX: number) {
    const handle = window.locator('#tree-resize-handle');
    const box = await handle.boundingBox();
    if (!box) throw new Error('#tree-resize-handle has no bounding box -- test setup assumption broken');
    const handleY = box.y + box.height / 2;
    await window.mouse.move(box.x + box.width / 2, handleY);
    await window.mouse.down();
    await window.mouse.move(targetClientX, handleY, { steps: 10 });
    await window.mouse.up();
  }

  function elementWidth(window: Page, selector: string): Promise<number> {
    return window.locator(selector).evaluate((el) => el.getBoundingClientRect().width);
  }

  test('dragging the handle to a mid-range position resizes #tree-panel to match', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#tree-root')).toBeVisible();

    await dragHandleTo(window, 400);

    const width = await elementWidth(window, '#tree-panel');
    expect(width).toBeGreaterThan(390);
    expect(width).toBeLessThan(410);
  });

  test('dragging past MIN_TREE_WIDTH clamps #tree-panel to 180px', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#tree-root')).toBeVisible();

    await dragHandleTo(window, -50);

    const width = await elementWidth(window, '#tree-panel');
    expect(width).toBe(180);
  });

  test('dragging past the dynamic max at the default window size clamps to windowWidth - MIN_MAIN_PANEL_WIDTH', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#tree-root')).toBeVisible();

    const innerWidth = await window.evaluate(() => window.innerWidth);
    await dragHandleTo(window, innerWidth + 500);

    const width = await elementWidth(window, '#tree-panel');
    expect(width).toBe(innerWidth - 300);
  });

  test('dragging past the dynamic max at a shrunk (480x640) window clamps to the LIVE windowWidth - MIN_MAIN_PANEL_WIDTH (not the pre-shrink 900px-window value), never crushing #main-panel (guardrail #34 / FI-2 proof)', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#tree-root')).toBeVisible();

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setBounds({ width: 480, height: 640 });
    });
    // Client-area width after an outer setBounds(480) isn't necessarily
    // exactly 480 (Windows window-chrome overhead) -- read the real live
    // value rather than assuming it, then derive the expected clamp from
    // that, same as the "default window size" test above.
    await expect.poll(() => window.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(480);
    const innerWidth = await window.evaluate(() => window.innerWidth);
    const expectedMaxTreeWidth = innerWidth - 300; // MIN_MAIN_PANEL_WIDTH

    await dragHandleTo(window, innerWidth + 500);

    const width = await elementWidth(window, '#tree-panel');
    // Proves live window.innerWidth (not the original 900px-window-derived
    // max of 600, and not a value snapshotted once at drag-start) drives the
    // cap -- the whole point of guardrail #34.
    expect(width).toBe(expectedMaxTreeWidth);

    const mainWidth = await elementWidth(window, '#main-panel');
    // MIN_MAIN_PANEL_WIDTH (300) minus a few px of slack for
    // #tree-resize-handle's own width (the clamp formula caps at
    // windowWidth - MIN_MAIN_PANEL_WIDTH without separately subtracting the
    // handle's own few-px footprint from the row) -- still far above the
    // near-zero width the FI-2 fault (a fixed maxTreeWidth) produces here.
    expect(mainWidth).toBeGreaterThan(280);
  });

  test('resized width does not persist -- a fresh relaunch shows the 260px CSS default', async () => {
    // Two full, sequential Electron launches sharing one on-disk profile
    // (mkdtempSync userDataDir), same shape as view-menu.spec.ts's (d) test
    // -- the standard one-launch-per-test `electronApp` fixture doesn't fit
    // "close, then relaunch the same profile" by construction.
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-'));
    const childEnv = { ...process.env };
    delete childEnv.ELECTRON_RUN_AS_NODE;

    try {
      const app = await electron.launch({ args: [ENTRY_POINT, fixtureNotesFile], env: childEnv, userDataDir });
      const window = await app.firstWindow();
      await expect(window.locator('#tree-root')).toBeVisible();

      await dragHandleTo(window, 400);
      const widthAfterDrag = await elementWidth(window, '#tree-panel');
      expect(widthAfterDrag).not.toBe(260);

      await app.close();

      const secondApp = await electron.launch({ args: [ENTRY_POINT, fixtureNotesFile], env: childEnv, userDataDir });
      const secondWindow = await secondApp.firstWindow();
      await expect(secondWindow.locator('#tree-root')).toBeVisible();

      const widthAfterRelaunch = await elementWidth(secondWindow, '#tree-panel');
      expect(widthAfterRelaunch).toBe(260);

      await secondApp.close();
    } finally {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('dragging the handle does not trigger tree-node click/expand behavior (guardrail #35)', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#tree-root')).toBeVisible();

    const subChildren = treeChildren(window, 'sub');
    await expect(subChildren).toBeHidden();

    await dragHandleTo(window, 350);

    await expect(subChildren).toBeHidden();
  });
});

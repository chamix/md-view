import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page, ElectronApplication } from '@playwright/test';
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
// `#tree-panel` is fixed-positioned at the viewport's left edge (Task 26;
// was the flex row's first child pre-Task-26 -- the mechanism changed, the
// left-edge-at-x=0 fact did not), so a real Playwright mouse drag's clientX
// *is* the desired panel width -- these tests drive `page.mouse.down/move/up`
// directly rather than standing in with a synthetic `style.setProperty()`
// call, per the task assignment's own requirement.
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
    // exactly 480 -- read the real live value rather than assuming it, then
    // derive the expected clamp from that, same as the "default window
    // size" test above. Originally this only ever undershot 480 (native
    // window-chrome overhead). Task 29's frame:false removed that overhead
    // and exposed a ~2px DPI-scaling rounding artifact at this machine's
    // 125% scale factor that instead overshoots to 482 (confirmed via
    // direct getBounds()/getContentBounds() probing, see DEVLOG's Task 29
    // entry) -- this poll only needs to confirm the resize has actually
    // settled near 480 (not still sitting at the pre-shrink 900px), so a
    // small tolerance band covers both directions without hardcoding either
    // OS's exact rounding behavior.
    await expect.poll(() => window.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(490);
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

// Task 24: auto-expand + highlight the tree row for whichever file is
// currently active. establishTreeRoot() (src/main/index.ts) recomputes the
// tree root as path.dirname() of *whatever file was just opened*, on every
// single file open (File>Open, drag-drop, argv, and tree-row clicks all
// funnel through the same REQUEST_OPEN_FILE -> renderAndWatch path) -- so a
// freshly-opened file is, by construction, always a *direct* child of the
// tree root immediately afterward, never a multi-level-nested one. The only
// way a multi-level auto-expand walk is ever actually exercised is the
// inverse order: a file is already active, and *then* the tree root is
// pointed at one of its ancestor folders via Open Folder... (which never
// touches activeFilePath) -- these helpers construct exactly that sequence.
test.describe('Task 24: tree panel auto-expand + highlight active file', () => {
  const deepFile = path.join(fixtureTreeDir, 'sub', 'deep.md');

  async function mockOpenDialog(electronApp: ElectronApplication, target: string) {
    await electronApp.evaluate(({ dialog }, targetPath) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [targetPath],
      })) as typeof dialog.showOpenDialog;
    }, target);
  }

  async function openFolderTo(electronApp: ElectronApplication, dirPath: string) {
    await mockOpenDialog(electronApp, dirPath);
    await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open-folder')?.click());
  }

  async function openFileViaMenu(electronApp: ElectronApplication, filePath: string) {
    await mockOpenDialog(electronApp, filePath);
    await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click());
  }

  test.describe('with deep.md already open (root = its own parent, sub/, per establishTreeRoot)', () => {
    test.use({ electronArgs: [deepFile] });

    test('pointing the tree root at an ancestor folder (Open Folder…) auto-expands sub/ and highlights deep.md', async ({
      electronApp,
    }) => {
      const window = await electronApp.firstWindow();
      await expect(window.locator('#content')).toContainText('deep', { timeout: 10000 });

      await openFolderTo(electronApp, fixtureTreeDir);

      await expect(treeRow(window, 'notes.md')).toBeVisible();
      await expect(treeChildren(window, 'sub')).toBeVisible();
      await expect(treeRow(window, 'deep.md')).toHaveClass(/tree-row-active/);
      await expect(window.locator('.tree-row-active')).toHaveCount(1);
    });

    test('clicking a different top-level file moves the highlight via the exact same onFileRendered -> revealAndHighlight path', async ({
      electronApp,
    }) => {
      const window = await electronApp.firstWindow();
      await expect(window.locator('#content')).toContainText('deep', { timeout: 10000 });

      await openFolderTo(electronApp, fixtureTreeDir);
      await expect(treeRow(window, 'deep.md')).toHaveClass(/tree-row-active/);

      await treeRow(window, 'notes.md').click();
      await expect(window.locator('#content')).toContainText('notes', { timeout: 10000 });

      await expect(treeRow(window, 'notes.md')).toHaveClass(/tree-row-active/);
      await expect(treeRow(window, 'deep.md')).not.toHaveClass(/tree-row-active/);
      await expect(window.locator('.tree-row-active')).toHaveCount(1);
    });
  });

  test('opening a file that establishes a fresh tree root still ends up correctly expanded+highlighted in the new tree', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#content')).toContainText('notes', { timeout: 10000 });
    await expect(treeRow(window, 'notes.md')).toHaveClass(/tree-row-active/);

    // deep.md lives in a different directory than the current root
    // (fixtureTreeDir) -- opening it re-establishes FOLDER_TREE_ROOT
    // (guardrail #27: old tree fully cleared, brand-new DOM nodes), exactly
    // this suite's already-established "open a file in a different folder"
    // trigger (see file-tree.spec.ts's guardrail #4 test).
    await openFileViaMenu(electronApp, deepFile);
    await expect(window.locator('#content')).toContainText('deep', { timeout: 10000 });

    await expect(treeRow(window, 'deep.md')).toHaveClass(/tree-row-active/);
    await expect(window.locator('.tree-row-active')).toHaveCount(1);
    // The old root's notes.md node is gone entirely, not merely unhighlighted.
    await expect(window.locator('.tree-label', { hasText: /^notes\.md$/ })).toHaveCount(0);
  });

  test('Open Folder… to a folder that does not contain the currently-open file renders cleanly with zero highlight', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#content')).toContainText('notes', { timeout: 10000 });
    await expect(treeRow(window, 'notes.md')).toHaveClass(/tree-row-active/);

    await openFolderTo(electronApp, path.join(fixtureTreeDir, 'sub'));

    await expect(treeRow(window, 'deep.md')).toBeVisible();
    await expect(window.locator('.tree-row-active')).toHaveCount(0);
  });

  test.describe('with deep.md already open (root = its own parent, sub/, per establishTreeRoot)', () => {
    test.use({ electronArgs: [deepFile] });

    test('FI-1: a reveal walk superseded mid-await by a newer file open never applies its stale expand/highlight result', async ({
      electronApp,
    }) => {
      const window = await electronApp.firstWindow();
      await expect(window.locator('#content')).toContainText('deep', { timeout: 10000 });

      // Artificially slow down every REQUEST_LIST_DIRECTORY response so the
      // reveal walk triggered by the Open Folder… call below is still
      // awaiting its expand-fetch of "sub" when the second file-open fires
      // immediately after -- manufactures the exact race window
      // deterministically rather than hoping for natural timing luck. Same
      // ipcMain._invokeHandlers technique as the "exactly one listDirectory
      // call" FI-1 test above in this file (electronApp.evaluate() has no
      // require()/module scope -- see that test's own comment for the full
      // rationale).
      await electronApp.evaluate(({ ipcMain }, channel) => {
        const invokeHandlers = (
          ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> }
        )._invokeHandlers;
        const originalHandler = invokeHandlers.get(channel);
        if (!originalHandler) {
          throw new Error('production REQUEST_LIST_DIRECTORY handler not found -- test setup assumption broken');
        }
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, async (event: unknown, dirPath: string) => {
          await new Promise((resolve) => setTimeout(resolve, 600));
          return originalHandler(event, dirPath);
        });
      }, IPC_CHANNELS.REQUEST_LIST_DIRECTORY);

      // File A's trigger: point the tree root at deep.md's ancestor -- the
      // reveal walk this kicks off must expand "sub" (now artificially
      // slow) before it can find+highlight deep.md.
      await openFolderTo(electronApp, fixtureTreeDir);

      // File B, fired immediately after -- well before file A's 600ms-
      // delayed listDirectory call would resolve.
      await openFileViaMenu(electronApp, path.join(fixtureTreeDir, 'notes.md'));

      await expect(window.locator('#content')).toContainText('notes', { timeout: 10000 });

      // Let file A's artificially-delayed reveal walk fully settle before
      // asserting the final state.
      await window.waitForTimeout(1000);

      await expect(window.locator('.tree-row-active')).toHaveCount(1);
      await expect(treeRow(window, 'notes.md')).toHaveClass(/tree-row-active/);
      await expect(treeRow(window, 'deep.md')).not.toHaveClass(/tree-row-active/);
    });
  });
});

// Task 26: #tree-panel's height was borrowed from #app-body's flex row (in
// turn driven by whichever sibling was tallest) -- switched to a genuinely
// viewport-bound height (position: fixed; bottom: 2rem, matching the
// status bar's already-declared clearance), independent of both its own
// content and #main-panel/#document-container's content-driven grow
// behavior. See functional_domain.md guardrails #49-53.
test.describe('Task 26: independent viewport-fixed tree panel sizing', () => {
  const longDocumentFixture = path.join(process.cwd(), 'tests/e2e/fixtures/long-document.md');
  const treeManyDir = path.join(process.cwd(), 'tests/e2e/fixtures/tree-many');
  const treeManyRoot = path.join(treeManyDir, 'root.md');

  // #tree-panel's bottom edge must land exactly at #status-bar's top edge
  // (guardrails #49/#52) -- compared via real boundingBox() values from both
  // elements, never a hardcoded pixel number derived from `2rem` (which
  // depends on root font-size). An explicit +/-1px band, not
  // toBeCloseTo(x, 0)'s tighter <0.5 tolerance -- real sub-pixel rendering
  // here shows ~0.8px drift, the same fallback ui-shell.spec.ts's Task 12
  // tests already documented for the same class of measurement.
  async function expectTreePanelBottomMeetsStatusBarTop(window: Page) {
    const treeBox = await window.locator('#tree-panel').boundingBox();
    const statusBox = await window.locator('#status-bar').boundingBox();
    if (!treeBox || !statusBox) {
      throw new Error('#tree-panel/#status-bar has no bounding box -- test setup assumption broken');
    }
    expect(Math.abs(treeBox.y + treeBox.height - statusBox.y)).toBeLessThanOrEqual(1);
  }

  async function expectElementBottomMeetsStatusBarTop(window: Page, selector: string) {
    const box = await window.locator(selector).boundingBox();
    const statusBox = await window.locator('#status-bar').boundingBox();
    if (!box || !statusBox) {
      throw new Error(`${selector}/#status-bar has no bounding box -- test setup assumption broken`);
    }
    expect(Math.abs(box.y + box.height - statusBox.y)).toBeLessThanOrEqual(1);
  }

  test.describe('with no folder open', () => {
    // Overrides the file-level default electronArgs (which always opens a
    // fixture file, and so always establishes a tree root) -- launching
    // with zero argv files is the only way to genuinely exercise the
    // permanent, never-resolved #tree-empty-state, rather than racing
    // against the async FOLDER_TREE_ROOT message a real file-open would
    // eventually deliver.
    test.use({ electronArgs: [] });

    test('#tree-panel still fills the viewport down to #status-bar (tree empty-state)', async ({ electronApp }) => {
      const window = await electronApp.firstWindow();
      await expect(window.locator('#tree-empty-state')).toBeVisible();
      await expectTreePanelBottomMeetsStatusBarTop(window);
    });
  });

  test('with a folder open showing only a few top-level rows, #tree-panel still fills the viewport down to #status-bar', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#tree-root')).toBeVisible();
    await expectTreePanelBottomMeetsStatusBarTop(window);
  });

  test('after dragging #tree-resize-handle to a new width, #tree-panel/#tree-resize-handle still meet #status-bar exactly (guardrail #52 holds across widths)', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#tree-root')).toBeVisible();

    const handle = window.locator('#tree-resize-handle');
    const box = await handle.boundingBox();
    if (!box) throw new Error('#tree-resize-handle has no bounding box -- test setup assumption broken');
    const handleY = box.y + box.height / 2;
    await window.mouse.move(box.x + box.width / 2, handleY);
    await window.mouse.down();
    await window.mouse.move(420, handleY, { steps: 10 });
    await window.mouse.up();

    await expectTreePanelBottomMeetsStatusBarTop(window);
    await expectElementBottomMeetsStatusBarTop(window, '#tree-resize-handle');
  });

  test.describe('with enough expanded tree rows to exceed a small window', () => {
    test.use({ electronArgs: [treeManyRoot] });

    test('expanding many/ overflows #tree-panel and scrolls internally, without growing the whole page (guardrail #50)', async ({
      electronApp,
    }) => {
      const window = await electronApp.firstWindow();
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setBounds({ width: 480, height: 320 });
      });
      await expect.poll(() => window.evaluate(() => window.innerHeight)).toBeLessThanOrEqual(320);

      await expect(window.locator('#tree-root')).toBeVisible();

      // Baseline document/page height *before* the tree panel has anything
      // to overflow -- #main-panel's own chrome (header, margins, padding)
      // legitimately produces some non-zero page height on its own, even
      // for a near-empty document; comparing before/after (rather than
      // against a fixed absolute threshold) isolates exactly what the tree
      // panel's own overflow contributes, independent of that baseline.
      const docScrollHeightBefore = await window.evaluate(() => document.documentElement.scrollHeight);

      await treeRow(window, 'many').click();
      await expect(treeChildren(window, 'many')).toBeVisible();
      // Wait for the last row to attach, proving the full 40-entry expand
      // actually completed before measuring.
      await expect(treeRow(window, 'item40.md')).toBeVisible();

      const [scrollHeight, clientHeight] = await window
        .locator('#tree-panel')
        .evaluate((el) => [el.scrollHeight, el.clientHeight]);
      // Real internal scroll: #tree-panel's own content now exceeds its
      // available (viewport-bound) height.
      expect(scrollHeight).toBeGreaterThan(clientHeight);

      const docScrollHeightAfter = await window.evaluate(() => document.documentElement.scrollHeight);
      // The whole page/document never grows on #tree-panel's account -- only
      // #tree-panel itself scrolls internally (its own overflow-y: auto).
      expect(docScrollHeightAfter).toBeLessThanOrEqual(docScrollHeightBefore + 1);
    });
  });

  test.describe('long document vs. tree panel independence', () => {
    test.use({ electronArgs: [longDocumentFixture] });

    test('a long document scrolls the page to its end while #status-bar stays visible and #tree-panel is unaffected by scroll position (guardrail #51)', async ({
      electronApp,
    }) => {
      const window = await electronApp.firstWindow();
      await expect(window.locator('#content')).toContainText('Section 1', { timeout: 10000 });

      const treeBoxBefore = await window.locator('#tree-panel').boundingBox();

      // Task 31: #main-panel is now its own bounded scroll container --
      // body/html no longer overflow at all, so window.scrollTo()/scrollY
      // can no longer drive or observe this. Same conversion already
      // proven in window-chrome.spec.ts's (g)/(h) blocks.
      await window.evaluate(() => {
        const mainPanel = document.getElementById('main-panel') as HTMLElement;
        mainPanel.scrollTo(0, mainPanel.scrollHeight);
      });
      await expect
        .poll(() => window.evaluate(() => (document.getElementById('main-panel') as HTMLElement).scrollTop))
        .toBeGreaterThan(0);

      const [mainPanelScrollHeight, mainPanelClientHeight] = await window.evaluate(() => {
        const mainPanel = document.getElementById('main-panel') as HTMLElement;
        return [mainPanel.scrollHeight, mainPanel.clientHeight];
      });
      // Proves #main-panel actually scrolls -- Task 12's content-driven grow
      // behavior is completely unaffected by this task; #main-panel is
      // simply the element that now owns that overflow (Task 31), instead
      // of document.documentElement, which no longer overflows at all.
      expect(mainPanelScrollHeight).toBeGreaterThan(mainPanelClientHeight);

      await expect(window.locator('#status-bar')).toBeVisible();
      await expectTreePanelBottomMeetsStatusBarTop(window);

      const treeBoxAfter = await window.locator('#tree-panel').boundingBox();
      expect(treeBoxAfter).toEqual(treeBoxBefore);
    });
  });

  // Required fault-injection proof for guardrail #52 (per this task's own
  // assignment): a runtime style override reintroducing the pre-fix
  // `bottom: 0` on #tree-panel/#tree-resize-handle (in place of the real
  // `bottom: 2rem`) must make expectTreePanelBottomMeetsStatusBarTop's own
  // check fail for a real, measurable overlap -- proving the check actually
  // discriminates the fault rather than being a tautology against whatever
  // app.css currently says. The equivalent manual proof (literally reverting
  // `bottom: 2rem` back to `bottom: 0` in src/renderer/app.css, confirming
  // this suite goes RED, then restoring it) was additionally run once by
  // hand during development -- see this task's delegation report for that
  // transcript; this automated version is the permanent regression guard.
  test('FI-1 (guardrail #52): a fault-injected bottom:0 override on #tree-panel/#tree-resize-handle produces a real, detectable overlap with #status-bar', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#tree-root')).toBeVisible();

    // Baseline: passes against the real, unmodified stylesheet.
    await expectTreePanelBottomMeetsStatusBarTop(window);

    const styleHandle = await window.addStyleTag({
      content: '#tree-panel, #tree-resize-handle { bottom: 0 !important; }',
    });

    const treeBoxFaulty = await window.locator('#tree-panel').boundingBox();
    const statusBoxFaulty = await window.locator('#status-bar').boundingBox();
    if (!treeBoxFaulty || !statusBoxFaulty) {
      throw new Error('bounding box missing under fault injection -- test setup assumption broken');
    }
    // Real, measurable overlap: #tree-panel's bottom edge now extends well
    // past #status-bar's top edge instead of meeting it exactly.
    expect(treeBoxFaulty.y + treeBoxFaulty.height).toBeGreaterThan(statusBoxFaulty.y + 5);

    // Restore -- remove the injected <style> element and confirm green again.
    await styleHandle.evaluate((el) => el.remove());
    await expectTreePanelBottomMeetsStatusBarTop(window);
  });
});

// Task 27: "Up one level" tree navigation. Clicking the new .tree-row-up row
// sends REQUEST_TREE_PARENT (fire-and-forget) -- the main process re-points
// the tree root at path.dirname(currentTreeRoot) via the existing
// establishTreeRoot(), and the result comes back through the existing
// FOLDER_TREE_ROOT push channel, exactly like Open Folder…/dropped-folder
// already work (never a new request-response round trip).
test.describe('Task 27: tree panel "up one level" navigation', () => {
  const deepFile = path.join(fixtureTreeDir, 'sub', 'deep.md');

  // Same accumulate-events-and-poll idiom as file-tree.spec.ts's
  // __treeRootEvents helpers (search that file for the term) -- a
  // test-only, coexisting second subscription to onFolderTreeRoot, since
  // ipcRenderer supports multiple listeners per push channel.
  async function collectTreeRootEvents(window: Page): Promise<void> {
    await window.evaluate(() => {
      (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents = [];
      (
        window as unknown as { mdview: { onFolderTreeRoot: (cb: (m: unknown) => void) => void } }
      ).mdview.onFolderTreeRoot((message) => {
        (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents.push(message);
      });
    });
  }

  function treeRootEventCount(window: Page): Promise<number> {
    return window.evaluate(() => (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents.length);
  }

  function treeRootEvents(
    window: Page
  ): Promise<Array<{ ok: boolean; rootPath: string; entries: Array<{ name: string }> }>> {
    return window.evaluate(
      () => (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents
    ) as Promise<Array<{ ok: boolean; rootPath: string; entries: Array<{ name: string }> }>>;
  }

  function clickUpRow(window: Page) {
    return window.locator('.tree-row-up').click();
  }

  test.describe('with deep.md already open (root = its own parent, sub/, per establishTreeRoot)', () => {
    test.use({ electronArgs: [deepFile] });

    test('clicking "Up" re-establishes the tree root at the parent directory, with correctly filtered/sorted entries', async ({
      electronApp,
    }) => {
      const window = await electronApp.firstWindow();
      await expect(window.locator('#content')).toContainText('deep', { timeout: 10000 });
      await expect(window.locator('.tree-row-up')).toBeVisible();

      await collectTreeRootEvents(window);
      await clickUpRow(window);

      await expect.poll(() => treeRootEventCount(window)).toBeGreaterThanOrEqual(1);

      const events = await treeRootEvents(window);
      expect(events).toHaveLength(1);
      expect(events[0].ok).toBe(true);
      expect(events[0].rootPath).toBe(fixtureTreeDir);
      expect(events[0].entries.map((e) => e.name)).toEqual(['empty-of-md', 'sub', 'notes.md']);
      expect(events[0].entries.map((e) => e.name)).not.toContain('ignored.txt');
    });
  });

  test('clicking "Up" at a real filesystem root is a harmless no-op — zero new/different FOLDER_TREE_ROOT broadcast (establishTreeRoot\'s own existing same-root guard, guardrail #1/#4)', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#tree-root')).toBeVisible();

    // Cross-platform-safe -- never hardcode 'C:\\'.
    const filesystemRoot = path.parse(process.cwd()).root;

    await electronApp.evaluate(({ dialog }, dirPath) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [dirPath],
      })) as typeof dialog.showOpenDialog;
    }, filesystemRoot);

    await collectTreeRootEvents(window);

    await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open-folder')?.click());
    await expect.poll(() => treeRootEventCount(window)).toBeGreaterThanOrEqual(1);

    const rootEstablishedEvents = await treeRootEvents(window);
    expect(rootEstablishedEvents[0].ok).toBe(true);
    expect(rootEstablishedEvents[0].rootPath).toBe(filesystemRoot);

    await clickUpRow(window);

    // Give any (incorrect) second broadcast time to arrive before asserting
    // the count stayed at exactly one -- path.dirname() of an actual
    // filesystem root returns that same root unchanged (Node's own
    // documented behavior), so establishTreeRoot's own pre-existing
    // resolvedRootPath === currentTreeRoot no-op guard must fire (same
    // "accumulate, then poll, then wait, then assert final count" idiom as
    // file-tree.spec.ts's guardrail #4 FI-1 proof).
    await window.waitForTimeout(500);

    const events = await treeRootEvents(window);
    expect(events).toHaveLength(1);
  });

  test.describe('with no folder open', () => {
    // Overrides the file-level default electronArgs (which always opens a
    // fixture file, and so always establishes a tree root) -- same "with no
    // folder open" pattern Task 26's suite already uses in this file.
    test.use({ electronArgs: [] });

    test('the "up one level" row is absent when no folder/file has ever been opened', async ({ electronApp }) => {
      const window = await electronApp.firstWindow();
      await expect(window.locator('#tree-empty-state')).toBeVisible();
      await expect(window.locator('.tree-row-up')).toHaveCount(0);
    });
  });

  test.describe('with deep.md already open (root = its own parent, sub/, per establishTreeRoot)', () => {
    test.use({ electronArgs: [deepFile] });

    test('FI-1: a test asserting "Up" moves the root to the parent goes RED under a fault-injected no-op REQUEST_TREE_PARENT handler, then GREEN once the real production handler is restored', async ({
      electronApp,
    }) => {
      const window = await electronApp.firstWindow();
      await expect(window.locator('#content')).toContainText('deep', { timeout: 10000 });

      // Runtime fault injection into the main process, not a hand-edit.
      // The described bug ("forgot to compute dirname", i.e. calling
      // establishTreeRoot(currentTreeRoot) instead of
      // establishTreeRoot(path.dirname(currentTreeRoot))) is, by
      // construction, a pure no-op: establishTreeRoot's own pre-existing
      // resolvedRootPath === currentTreeRoot guard fires immediately (no
      // re-fetch, no broadcast) — that IS guardrail #1's whole point.
      // Reproducing that exact no-op observable effect only requires
      // ipcMain's public EventEmitter API (rawListeners/removeAllListeners/
      // on) — no need to reach into main/index.ts's unexported
      // currentTreeRoot/establishTreeRoot closures, which (per this file's
      // sibling FI-1 test's own documented probe, above) are not reachable
      // from electronApp.evaluate()'s eval context anyway (no require/
      // module/process.mainModule in scope there).
      const swapped = await electronApp.evaluate(({ ipcMain }, channel) => {
        const listeners = ipcMain.rawListeners(channel);
        if (listeners.length !== 1) {
          throw new Error(
            'expected exactly one production REQUEST_TREE_PARENT listener -- test setup assumption broken'
          );
        }
        (globalThis as unknown as { __mdviewOriginalTreeParentListener: unknown }).__mdviewOriginalTreeParentListener =
          listeners[0];
        ipcMain.removeAllListeners(channel);
        ipcMain.on(channel, () => {
          // Fault: does nothing -- the exact observable effect of
          // establishTreeRoot(currentTreeRoot) (same root -> its own no-op
          // guard fires immediately).
        });
        return true;
      }, IPC_CHANNELS.REQUEST_TREE_PARENT);
      expect(swapped).toBe(true);

      await collectTreeRootEvents(window);
      await clickUpRow(window);

      // RED: give the (faulty) handler ample time to have broadcast a new
      // root, then confirm it did not -- a test asserting "rootPath actually
      // changes to the parent after one click" would fail here exactly as
      // the task's required proof describes (rootPath stays identical
      // instead of becoming the parent).
      await window.waitForTimeout(500);
      const redEvents = await treeRootEvents(window);
      expect(redEvents).toHaveLength(0); // RED

      // Restore the real production listener.
      await electronApp.evaluate(({ ipcMain }, channel) => {
        const original = (
          globalThis as unknown as { __mdviewOriginalTreeParentListener: (...args: unknown[]) => void }
        ).__mdviewOriginalTreeParentListener;
        ipcMain.removeAllListeners(channel);
        ipcMain.on(channel, original as (...args: unknown[]) => void);
      }, IPC_CHANNELS.REQUEST_TREE_PARENT);

      await clickUpRow(window);

      // GREEN: the real listener computes path.dirname(currentTreeRoot) and
      // the root genuinely moves to the parent directory.
      await expect.poll(() => treeRootEventCount(window)).toBeGreaterThanOrEqual(1);
      const greenEvents = await treeRootEvents(window);
      expect(greenEvents).toHaveLength(1);
      expect(greenEvents[0].ok).toBe(true);
      expect(greenEvents[0].rootPath).toBe(fixtureTreeDir); // GREEN
    });
  });
});

// Task 28: "Show File Tree" View-menu checkbox. Unlike the checkbox itself,
// two other actions can *force* showTreePanel from false to true --
// openFolderViaDialog() and the dropped/opened-directory branch of
// REQUEST_OPEN_FILE -- and only when it was previously false. Opening a
// single file (any trigger) must never touch showTreePanel in either
// direction.
test.describe('Task 28: Show File Tree toggle', () => {
  async function hideOrShowTreePanel(electronApp: ElectronApplication) {
    await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-show-tree-panel')?.click());
  }

  async function mockOpenDialog(electronApp: ElectronApplication, target: string) {
    await electronApp.evaluate(({ dialog }, targetPath) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [targetPath],
      })) as typeof dialog.showOpenDialog;
    }, target);
  }

  // Same accumulate-events-and-poll idiom as this file's Task 27
  // collectTreeRootEvents/treeRootEventCount helpers (ipcRenderer.on/the
  // preload's onViewSettings support any number of coexisting listeners per
  // push channel) -- registered *immediately before* the action under test
  // so it only ever captures the delta produced by that one action, never
  // any VIEW_SETTINGS broadcast(s) already sent since launch (e.g. the
  // initial one applyMenu()/broadcastViewSettings() fires at startup).
  async function collectViewSettingsEvents(window: Page): Promise<void> {
    await window.evaluate(() => {
      (window as unknown as { __viewSettingsEvents: unknown[] }).__viewSettingsEvents = [];
      (
        window as unknown as { mdview: { onViewSettings: (cb: (m: unknown) => void) => void } }
      ).mdview.onViewSettings((settings) => {
        (window as unknown as { __viewSettingsEvents: unknown[] }).__viewSettingsEvents.push(settings);
      });
    });
  }

  function viewSettingsEventCount(window: Page): Promise<number> {
    return window.evaluate(() => (window as unknown as { __viewSettingsEvents: unknown[] }).__viewSettingsEvents.length);
  }

  test('Open Folder… while the tree is hidden forces both the checkbox checked and the panel visible again', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#tree-root')).toBeVisible();

    await hideOrShowTreePanel(electronApp);
    await expect(window.locator('#tree-panel')).toBeHidden();
    const checkedWhileHidden = await electronApp.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-show-tree-panel')?.checked
    );
    expect(checkedWhileHidden).toBe(false);

    await mockOpenDialog(electronApp, fixtureTreeDir);
    await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open-folder')?.click());

    await expect(window.locator('#tree-root')).toBeVisible();
    await expect(window.locator('#tree-panel')).toBeVisible();
    const checkedAfter = await electronApp.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-show-tree-panel')?.checked
    );
    expect(checkedAfter).toBe(true);
  });

  test('opening a single file while the tree is hidden never changes showTreePanel -- stays hidden, stays unchecked', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#tree-root')).toBeVisible();

    await hideOrShowTreePanel(electronApp);
    await expect(window.locator('#tree-panel')).toBeHidden();

    const otherFile = path.join(fixtureTreeDir, 'sub', 'deep.md');
    await mockOpenDialog(electronApp, otherFile);
    await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click());

    await expect(window.locator('#content')).toContainText('deep', { timeout: 10000 });

    await expect(window.locator('#tree-panel')).toBeHidden();
    const checkedAfter = await electronApp.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-show-tree-panel')?.checked
    );
    expect(checkedAfter).toBe(false);
  });

  // The negative case of forceShowTreePanelAndRebuildMenu()'s own
  // `if (viewSettings.showTreePanel) return;` guard (src/main/index.ts) --
  // without this test, replacing that guard with an unconditional rebuild
  // would go undetected by the whole suite, even though the two tests above
  // only ever exercise the tree-was-hidden branch.
  test('Open Folder… while the tree is already visible does not trigger a redundant rebuild or change any observable state', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#tree-root')).toBeVisible();
    await expect(window.locator('#tree-panel')).toBeVisible();
    const checkedBefore = await electronApp.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-show-tree-panel')?.checked
    );
    expect(checkedBefore).toBe(true);

    // Registered right before the action -- captures only VIEW_SETTINGS
    // broadcasts produced by this specific Open Folder… call, not any sent
    // since launch.
    await collectViewSettingsEvents(window);

    // A genuinely different folder (fixtureTreeDir's own sub/ subdirectory),
    // not the identical current root -- gives this test a real, independent
    // observable (the tree's contents actually changing) to wait on and
    // confirm the action truly completed, decoupled from
    // showTreePanel/menu-rebuild behavior entirely.
    await mockOpenDialog(electronApp, path.join(fixtureTreeDir, 'sub'));
    await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open-folder')?.click());

    await expect(treeRow(window, 'deep.md')).toBeVisible();
    await expect(window.locator('.tree-label', { hasText: /^notes\.md$/ })).toHaveCount(0);

    await expect(window.locator('#tree-panel')).toBeVisible();
    const checkedAfter = await electronApp.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-show-tree-panel')?.checked
    );
    expect(checkedAfter).toBe(true);

    // Strongest proof the guard actually short-circuited (rather than
    // merely happening to look inert): zero VIEW_SETTINGS broadcasts fired
    // during this action at all.
    expect(await viewSettingsEventCount(window)).toBe(0);
  });

  // Reviewer should-fix item: Task 28's forceShowTreePanelAndRebuildMenu()
  // is also called from the REQUEST_OPEN_FILE directory branch (a real
  // drag/drop-a-folder, or a directory passed on argv), a separate call
  // site from openFolderViaDialog() above -- exercised directly here via the
  // same ipcMain.emit(...) technique drag-drop.spec.ts's own
  // REQUEST_OPEN_FILE tests already use to invoke the real, unmodified
  // production listener with a real on-disk path.
  test('REQUEST_OPEN_FILE directory branch (drag/drop-a-folder path) forces both the checkbox checked and the panel visible again when the tree starts hidden', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#tree-root')).toBeVisible();

    await hideOrShowTreePanel(electronApp);
    await expect(window.locator('#tree-panel')).toBeHidden();
    const checkedWhileHidden = await electronApp.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-show-tree-panel')?.checked
    );
    expect(checkedWhileHidden).toBe(false);

    await electronApp.evaluate(
      ({ ipcMain }, { channel, dirPath }) => {
        ipcMain.emit(channel, {}, dirPath);
      },
      { channel: IPC_CHANNELS.REQUEST_OPEN_FILE, dirPath: fixtureTreeDir }
    );

    await expect(window.locator('#tree-panel')).toBeVisible();
    await expect(treeRow(window, 'notes.md')).toBeVisible();
    const checkedAfter = await electronApp.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-show-tree-panel')?.checked
    );
    expect(checkedAfter).toBe(true);
  });

  test('hide/show preserves full tree DOM state -- an expanded folder stays expanded, the active-file highlight (Task 24) survives, and no new listDirectory call fires across the cycle', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#tree-root')).toBeVisible();

    // The file-level default electronArgs opens notes.md, so it is already
    // the active/highlighted row (Task 24) before the tree is ever touched.
    await expect(treeRow(window, 'notes.md')).toHaveClass(/tree-row-active/);
    await expect(window.locator('.tree-row-active')).toHaveCount(1);

    // Same ipcMain._invokeHandlers counting-wrapper idiom as this file's own
    // "FI-1: exactly one listDirectory call" test above.
    await electronApp.evaluate(({ ipcMain }, channel) => {
      const invokeHandlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> })
        ._invokeHandlers;
      const originalHandler = invokeHandlers.get(channel);
      if (!originalHandler) {
        throw new Error('production REQUEST_LIST_DIRECTORY handler not found -- test setup assumption broken');
      }
      (globalThis as unknown as { __listDirectoryCallCount: number }).__listDirectoryCallCount = 0;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (event: unknown, dirPath: string) => {
        (globalThis as unknown as { __listDirectoryCallCount: number }).__listDirectoryCallCount += 1;
        return originalHandler(event, dirPath);
      });
    }, IPC_CHANNELS.REQUEST_LIST_DIRECTORY);

    const subChildren = treeChildren(window, 'sub');
    await treeRow(window, 'sub').click();
    await expect(subChildren).toBeVisible();

    const countAfterExpand = await electronApp.evaluate(
      () => (globalThis as unknown as { __listDirectoryCallCount: number }).__listDirectoryCallCount
    );
    expect(countAfterExpand).toBe(1);

    await hideOrShowTreePanel(electronApp); // hide
    await expect(window.locator('#tree-panel')).toBeHidden();

    await hideOrShowTreePanel(electronApp); // show again
    await expect(window.locator('#tree-panel')).toBeVisible();

    await expect(subChildren).toBeVisible();
    const subChildLabels = await subChildren.locator('> .tree-node > .tree-row .tree-label').allTextContents();
    expect(subChildLabels).toEqual(['deep.md', 'deep2.md']);

    // The Task 24 active-file highlight is pure DOM state (a class on the
    // still-attached notes.md row), never recomputed by the hide/show
    // toggle itself -- must survive the cycle exactly like the expanded
    // sub/ folder does above.
    await expect(treeRow(window, 'notes.md')).toHaveClass(/tree-row-active/);
    await expect(window.locator('.tree-row-active')).toHaveCount(1);

    const countAfterCycle = await electronApp.evaluate(
      () => (globalThis as unknown as { __listDirectoryCallCount: number }).__listDirectoryCallCount
    );
    expect(countAfterCycle).toBe(1);
  });
});

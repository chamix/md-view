import * as path from 'path';
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { IPC_CHANNELS } from '../../src/preload/api';

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

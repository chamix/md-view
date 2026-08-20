import * as path from 'path';
import { test, expect, _electron as electron } from '@playwright/test';

// The host shell may set ELECTRON_RUN_AS_NODE=1 (e.g. some CI/dev-tool
// environments), which forces any Electron binary to run as plain Node
// instead of booting the Electron runtime (app/BrowserWindow become
// undefined). Strip it from the child process env so the launched app
// always runs as real Electron regardless of the parent shell's env.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const fixtureTreeDir = path.join(process.cwd(), 'tests/e2e/fixtures/tree');
const fixtureNotesFile = path.join(fixtureTreeDir, 'notes.md');

// No renderer UI exists yet for the file tree (Task 17 is backend-only), so
// every case here crosses the real preload contextBridge directly via
// page.evaluate() calling window.mdview.listDirectory(...) /
// window.mdview.onFolderTreeRoot(...), the same technique Task 16's
// guardrail proofs used, just without a DOM interaction driving it.

test('listDirectory resolves the real filtered/sorted fixture directory shape', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const window = await app.firstWindow();

  const result = await window.evaluate(
    (dirPath) => (window as unknown as { mdview: { listDirectory: (p: string) => Promise<unknown> } }).mdview.listDirectory(dirPath),
    fixtureTreeDir
  );

  expect(result).toMatchObject({ ok: true, dirPath: fixtureTreeDir });
  const entries = (result as { entries: Array<{ name: string; type: string }> }).entries;
  const names = entries.map((e) => e.name);

  expect(names).toEqual(['empty-of-md', 'sub', 'notes.md']);
  expect(entries[0].type).toBe('directory');
  expect(entries[1].type).toBe('directory');
  expect(entries[2].type).toBe('file');
  expect(names).not.toContain('ignored.txt');

  await app.close();
});

test('listDirectory resolves ok:false for a nonexistent path (never rejects/hangs) -- FI-4 proof', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const window = await app.firstWindow();
  const nonexistentPath = path.join(fixtureTreeDir, 'does-not-exist-at-all');

  // If listDirectoryEntries ever threw instead of returning {ok:false}, this
  // invoke() call would reject -- Playwright's page.evaluate would itself
  // throw/reject rather than resolve to a value, and this await would throw
  // synchronously here instead of producing the object asserted below. This
  // is the concrete boundary-safety proof required by FI-4.
  const result = await window.evaluate(
    (dirPath) => (window as unknown as { mdview: { listDirectory: (p: string) => Promise<unknown> } }).mdview.listDirectory(dirPath),
    nonexistentPath
  );

  expect(result).toMatchObject({ ok: false, dirPath: nonexistentPath });

  await app.close();
});

test('opening a fixture file via File > Open… establishes the tree root and broadcasts FOLDER_TREE_ROOT with the parent directory', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const window = await app.firstWindow();

  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [filePath],
    })) as typeof dialog.showOpenDialog;
  }, fixtureNotesFile);

  // Listener writes into a page-scoped array and returns immediately (no
  // pending in-page Promise left open across the CDP round trip) --
  // deliberately not the "return new Promise((resolve) => on(...))" shape,
  // which proved flaky under full-suite parallel load (a long-held
  // evaluate() call racing a second evaluate() on the same session). Same
  // "accumulate, then poll" technique as the guardrail #4 and Open Folder…
  // tests below.
  await window.evaluate(() => {
    (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents = [];
    (window as unknown as { mdview: { onFolderTreeRoot: (cb: (m: unknown) => void) => void } }).mdview.onFolderTreeRoot(
      (message) => {
        (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents.push(message);
      }
    );
  });

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click());

  await expect
    .poll(async () =>
      window.evaluate(() => (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents.length)
    )
    .toBeGreaterThanOrEqual(1);

  const treeRootMessage = (await window.evaluate(
    () => (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents[0]
  )) as { ok: boolean; rootPath: string; entries: Array<{ name: string }> };

  expect(treeRootMessage.ok).toBe(true);
  expect(treeRootMessage.rootPath).toBe(fixtureTreeDir);
  expect(treeRootMessage.entries.map((e) => e.name)).toContain('notes.md');

  await app.close();
});

test('opening a file that fails to render still establishes the tree root for its parent directory (spec: tree-root establishment is independent of render success)', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const window = await app.firstWindow();

  // Nonexistent .md path -- renderFile() passes the extension check, then
  // fails at fs.readFile (ENOENT), producing a real FILE_RENDERED
  // ok:false. Its parent directory is still the real, existing
  // fixtureTreeDir, so this reuses the same fixtures/expected entries as
  // the first test in this file rather than adding a new fixture.
  const nonexistentFile = path.join(fixtureTreeDir, 'does-not-exist.md');

  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [filePath],
    })) as typeof dialog.showOpenDialog;
  }, nonexistentFile);

  await window.evaluate(() => {
    (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents = [];
    (window as unknown as { mdview: { onFolderTreeRoot: (cb: (m: unknown) => void) => void } }).mdview.onFolderTreeRoot(
      (message) => {
        (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents.push(message);
      }
    );
  });

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click());

  await expect
    .poll(async () =>
      window.evaluate(() => (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents.length)
    )
    .toBeGreaterThanOrEqual(1);

  const treeRootMessage = (await window.evaluate(
    () => (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents[0]
  )) as { ok: boolean; rootPath: string; entries: Array<{ name: string }> };

  expect(treeRootMessage.ok).toBe(true);
  expect(treeRootMessage.rootPath).toBe(fixtureTreeDir);
  expect(treeRootMessage.entries.map((e) => e.name)).toEqual(['empty-of-md', 'sub', 'notes.md']);

  // Confirm the render itself genuinely failed (error state), proving this
  // test really exercises the failed-render branch of renderAndWatch, not
  // a coincidental success.
  const content = window.locator('#content');
  await expect(content).toContainText('Could not open file', { timeout: 10000 });

  await app.close();
});

test('switching to a different file inside the same already-open folder does not re-broadcast FOLDER_TREE_ROOT (guardrail #4 / FI-1 proof)', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const window = await app.firstWindow();

  const sameFolderFirstFile = path.join(fixtureTreeDir, 'sub', 'deep.md');
  const sameFolderSecondFile = path.join(fixtureTreeDir, 'sub', 'deep2.md');

  await app.evaluate(({ dialog }, files) => {
    let callIndex = 0;
    dialog.showOpenDialog = (async () => {
      const filePath = files[Math.min(callIndex, files.length - 1)];
      callIndex += 1;
      return { canceled: false, filePaths: [filePath] };
    }) as typeof dialog.showOpenDialog;
  }, [sameFolderFirstFile, sameFolderSecondFile]);

  await window.evaluate(() => {
    (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents = [];
    (window as unknown as { mdview: { onFolderTreeRoot: (cb: (m: unknown) => void) => void } }).mdview.onFolderTreeRoot(
      (message) => {
        (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents.push(message);
      }
    );
  });

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click());
  await expect
    .poll(async () =>
      window.evaluate(() => (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents.length)
    )
    .toBeGreaterThanOrEqual(1);

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click());

  // Give any (incorrect) second broadcast time to arrive before asserting
  // the count stayed at exactly one -- same folder, second file, must be a
  // no-op per establishTreeRoot's rootPath === currentTreeRoot guard.
  await window.waitForTimeout(500);

  const events = await window.evaluate(
    () => (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents
  );
  expect(events).toHaveLength(1);

  await app.close();
});

test('opening the same tree root twice via differently-cased paths broadcasts FOLDER_TREE_ROOT exactly once (Task 18 guardrail #9 / FI-5 proof)', async () => {
  // Only meaningful on a case-insensitive filesystem (Windows -- this dev
  // machine -- and default macOS/APFS). On a case-sensitive filesystem the
  // uppercased path genuinely would not exist, so this test would pass/fail
  // for the wrong reason rather than proving the casing-equivalence
  // guardrail -- skip outright instead of forcing a workaround.
  test.skip(process.platform === 'linux', 'case-insensitive-filesystem-only guardrail; would test the wrong thing on ext4/most Linux filesystems');

  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const window = await app.firstWindow();

  const lowerCaseDir = fixtureTreeDir;
  const upperCaseDir = fixtureTreeDir.toUpperCase();

  await app.evaluate(({ dialog }, dirs) => {
    let callIndex = 0;
    dialog.showOpenDialog = (async () => {
      const dirPath = dirs[Math.min(callIndex, dirs.length - 1)];
      callIndex += 1;
      return { canceled: false, filePaths: [dirPath] };
    }) as typeof dialog.showOpenDialog;
  }, [lowerCaseDir, upperCaseDir]);

  // Accumulate-events-and-poll pattern (this file's established, stable
  // technique -- not a pending in-page Promise left unresolved across the
  // CDP round trip, which proved flaky under full-suite parallel load).
  await window.evaluate(() => {
    (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents = [];
    (window as unknown as { mdview: { onFolderTreeRoot: (cb: (m: unknown) => void) => void } }).mdview.onFolderTreeRoot(
      (message) => {
        (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents.push(message);
      }
    );
  });

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open-folder')?.click());
  await expect
    .poll(async () =>
      window.evaluate(() => (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents.length)
    )
    .toBeGreaterThanOrEqual(1);

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open-folder')?.click());

  // Give any (incorrect) second broadcast time to arrive before asserting
  // the count stayed at exactly one -- same real directory, differently
  // cased path string, must be a no-op per establishTreeRoot's
  // canonicalized-comparison guard.
  await window.waitForTimeout(500);

  const events = await window.evaluate(
    () => (window as unknown as { __treeRootEvents: unknown[] }).__treeRootEvents
  );
  expect(events).toHaveLength(1);

  const firstEvent = events[0] as { ok: boolean; rootPath: string };
  expect(firstEvent.ok).toBe(true);
  expect(firstEvent.rootPath).toBe(lowerCaseDir);

  await app.close();
});

test('Open Folder… broadcasts FOLDER_TREE_ROOT and triggers zero FILE_RENDERED events as a side effect', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const window = await app.firstWindow();

  await app.evaluate(({ dialog }, dirPath) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [dirPath],
    })) as typeof dialog.showOpenDialog;
  }, fixtureTreeDir);

  // Test-only counting listener on the real renderer-side bridge
  // (window.mdview.onFileRendered), coexisting with the production renderer
  // script's own subscription (ipcRenderer supports multiple listeners per
  // channel) -- proves zero FILE_RENDERED pushes reached the renderer as a
  // side effect of opening a folder (guardrail #5), the same "count, don't
  // assume" technique Task 16's e2e drag-drop test used, adapted to the
  // main -> renderer push direction FILE_RENDERED actually uses.
  await window.evaluate(() => {
    (window as unknown as { __fileRenderedCount: number }).__fileRenderedCount = 0;
    (window as unknown as { mdview: { onFileRendered: (cb: (m: unknown) => void) => void } }).mdview.onFileRendered(
      () => {
        (window as unknown as { __fileRenderedCount: number }).__fileRenderedCount += 1;
      }
    );
  });

  const treeRootPromise = window.evaluate(() => {
    return new Promise((resolve) => {
      (window as unknown as { mdview: { onFolderTreeRoot: (cb: (m: unknown) => void) => void } }).mdview.onFolderTreeRoot(
        (message) => resolve(message)
      );
    });
  });

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open-folder')?.click());

  const treeRootMessage = (await treeRootPromise) as { ok: boolean; rootPath: string; entries: Array<{ name: string }> };

  expect(treeRootMessage.ok).toBe(true);
  expect(treeRootMessage.rootPath).toBe(fixtureTreeDir);
  expect(treeRootMessage.entries.map((e) => e.name)).toContain('notes.md');

  // #content must remain untouched -- no render happened as a side effect.
  const emptyState = window.locator('#empty-state');
  await expect(emptyState).toBeVisible();
  const content = window.locator('#content');
  await expect(content).toBeEmpty();

  const fileRenderedCount = await window.evaluate(
    () => (window as unknown as { __fileRenderedCount: number }).__fileRenderedCount
  );
  expect(fileRenderedCount).toBe(0);

  await app.close();
});

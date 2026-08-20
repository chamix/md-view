import * as path from 'path';
import { test, expect, _electron as electron } from '@playwright/test';
import { IPC_CHANNELS } from '../../src/preload/api';

// The host shell may set ELECTRON_RUN_AS_NODE=1 (e.g. some CI/dev-tool
// environments), which forces any Electron binary to run as plain Node
// instead of booting the Electron runtime (app/BrowserWindow become
// undefined). Strip it from the child process env so the launched app
// always runs as real Electron regardless of the parent shell's env.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

test('non-.md real path sent over REQUEST_OPEN_FILE reuses renderFile validation (no bypass of renderAndWatch)', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const window = await app.firstWindow();
  const emptyState = window.locator('#empty-state');
  await expect(emptyState).toBeVisible();

  const nonMdPath = path.join(process.cwd(), 'package.json');

  // ipcMain is a plain EventEmitter — this invokes the *real* registered
  // main-process listener (src/main/index.ts) directly, with a real
  // filesystem path, bypassing only the renderer/preload File-resolution
  // boundary (webUtils.getPathForFile), not main's own logic at all.
  await app.evaluate(
    ({ ipcMain }, { channel, filePath }) => {
      ipcMain.emit(channel, {}, filePath);
    },
    { channel: IPC_CHANNELS.REQUEST_OPEN_FILE, filePath: nonMdPath }
  );

  const content = window.locator('#content');
  await expect(content).toContainText('Could not open file', { timeout: 10000 });
  await expect(content).toContainText('Not a Markdown file', { timeout: 10000 });

  await app.close();
});

test('empty-path guard: no crash, and no render is triggered by that call', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const window = await app.firstWindow();
  const emptyState = window.locator('#empty-state');
  await expect(emptyState).toBeVisible();
  const content = window.locator('#content');
  await expect(content).toBeEmpty();

  await app.evaluate(({ ipcMain }, channel) => {
    ipcMain.emit(channel, {}, '');
  }, IPC_CHANNELS.REQUEST_OPEN_FILE);

  // Give any (incorrect) async render a chance to happen before asserting
  // the baseline is unchanged.
  await window.waitForTimeout(300);

  expect(app.windows().length).toBeGreaterThan(0);
  await expect(emptyState).toBeVisible();
  await expect(content).toBeEmpty();

  await app.close();
});

test('only the first dropped file triggers a REQUEST_OPEN_FILE send, through the real renderer -> preload -> ipcMain chain', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const window = await app.firstWindow();
  await expect(window.locator('#empty-state')).toBeVisible();

  // Two real, on-disk files with genuinely distinguishable absolute paths.
  // A `new File(...)` constructed inside window.evaluate() has no OS drag
  // origin, so the real preload `webUtils.getPathForFile()` (confirmed
  // empirically, see functional_domain.md Task 16 guardrail #10) always
  // resolves it to '' -- which would make any two synthetic files
  // indistinguishable by path once they reach ipcMain, incapable of
  // proving "specifically index 0, not the last" through the real chain.
  // Chrome DevTools Protocol's Input.dispatchDragEvent, by contrast,
  // backs the File objects it creates with a real OS-level file
  // association (confirmed empirically), so `webUtils.getPathForFile()`
  // resolves each to its real, distinct path -- letting this test drive
  // the actual renderer -> preload -> ipcMain chain end-to-end AND prove
  // the resolved path is specifically the first file's, not the second's.
  const firstFile = path.join(process.cwd(), 'package.json');
  const secondFile = path.join(process.cwd(), 'tsconfig.json');

  // Test-only capturing listener, coexisting with the production listener
  // registered in src/main/index.ts (ipcMain.on supports multiple
  // listeners per channel; the production listener is never removed).
  await app.evaluate(({ ipcMain }, channel) => {
    (global as unknown as { __capturedPaths: string[] }).__capturedPaths = [];
    ipcMain.on(channel, (_event, filePath: string) => {
      (global as unknown as { __capturedPaths: string[] }).__capturedPaths.push(filePath);
    });
  }, IPC_CHANNELS.REQUEST_OPEN_FILE);

  const client = await window.context().newCDPSession(window);
  const box = await window.locator('#empty-state').boundingBox();
  const x = box ? box.x + box.width / 2 : 100;
  const y = box ? box.y + box.height / 2 : 100;
  const dragData = { items: [], files: [firstFile, secondFile], dragOperationsMask: 1 };

  // dragEnter then drop, exercising the actual renderer.js `drop` listener
  // -> firstDroppedFile() -> actual preload openDroppedFile -> actual
  // ipcRenderer.send, unmodified.
  await client.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data: dragData } as never);
  await client.send('Input.dispatchDragEvent', { type: 'drop', x, y, data: dragData } as never);

  await window.waitForTimeout(300);

  const capturedPaths = await app.evaluate(
    () => (global as unknown as { __capturedPaths: string[] }).__capturedPaths
  );

  // Exactly one send (guardrail #2's "only one open requested"), and that
  // one send carries specifically the first dropped file's real path, not
  // the second's -- a "last file wins" regression would fail this
  // assertion even though it would still send exactly once.
  expect(capturedPaths).toHaveLength(1);
  expect(capturedPaths[0]).toBe(firstFile);
  expect(capturedPaths[0]).not.toBe(secondFile);

  await app.close();
});

test('preventDefault() is called by the dragover handler', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const window = await app.firstWindow();
  await expect(window.locator('#empty-state')).toBeVisible();

  const defaultPrevented = await window.evaluate(() => {
    const event = new DragEvent('dragover', { bubbles: true, cancelable: true });
    const notCancelled = document.dispatchEvent(event);
    return { defaultPrevented: event.defaultPrevented, dispatchReturnedFalse: notCancelled === false };
  });

  expect(defaultPrevented.defaultPrevented).toBe(true);
  expect(defaultPrevented.dispatchReturnedFalse).toBe(true);

  await app.close();
});

test('preventDefault() is called by the drop handler', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const window = await app.firstWindow();
  await expect(window.locator('#empty-state')).toBeVisible();

  // A real `DragEvent('drop', { dataTransfer })` throws in this
  // Electron/Chromium version ("Failed to convert value to 'DataTransfer'")
  // when passed a plain object -- same empirically-confirmed constraint as
  // the multi-file drop test above. A plain Event with a manually attached
  // `.dataTransfer` (an empty file list is enough here; this test only
  // proves the unconditional preventDefault() call, not file selection)
  // is the working equivalent.
  const defaultPrevented = await window.evaluate(() => {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    (event as unknown as { dataTransfer: unknown }).dataTransfer = { files: [] };
    const notCancelled = document.dispatchEvent(event);
    return { defaultPrevented: event.defaultPrevented, dispatchReturnedFalse: notCancelled === false };
  });

  expect(defaultPrevented.defaultPrevented).toBe(true);
  expect(defaultPrevented.dispatchReturnedFalse).toBe(true);

  await app.close();
});

test('depth-counter prevents flicker: highlight stays on while over a nested child, clears only at true dragleave', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const window = await app.firstWindow();
  await expect(window.locator('#empty-state')).toBeVisible();

  // dragenter at document (depth 0 -> 1), then dragenter at a nested child
  // (depth 1 -> 2, bubbles to document's listener), then dragleave at that
  // same child (depth 2 -> 1) -- the highlight must still be on, since the
  // pointer is still logically over the drop target as a whole.
  const afterNestedLeave = await window.evaluate(() => {
    const content = document.getElementById('content')!;
    document.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true }));
    content.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true }));
    content.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true }));
    return document.body.classList.contains('drag-over');
  });
  expect(afterNestedLeave).toBe(true);

  const afterFinalLeave = await window.evaluate(() => {
    document.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true }));
    return document.body.classList.contains('drag-over');
  });
  expect(afterFinalLeave).toBe(false);

  await app.close();
});

test('rest state: drag-over class is absent on a freshly launched window with no drag in progress', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const window = await app.firstWindow();
  await expect(window.locator('#empty-state')).toBeVisible();

  const hasDragOver = await window.evaluate(() => document.body.classList.contains('drag-over'));
  expect(hasDragOver).toBe(false);

  await app.close();
});

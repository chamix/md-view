import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FSWatcher } from 'chokidar';
import { watchFile } from '../../src/main/watcher';

describe('watchFile (chokidar wiring against real files)', () => {
  let tmpDir: string | null = null;
  let watcher: FSWatcher | null = null;

  afterEach(async () => {
    if (watcher) {
      await watcher.close();
      watcher = null;
    }
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  function waitForReady(w: FSWatcher): Promise<void> {
    return new Promise((resolve) => w.on('ready', () => resolve()));
  }

  it('reports "render" when the watched file changes', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-watcher-'));
    const filePath = path.join(tmpDir, 'sample.md');
    await fsp.writeFile(filePath, '# initial');

    const events: Array<'render' | 'error'> = [];
    watcher = watchFile(filePath, (action) => events.push(action));
    await waitForReady(watcher);

    await fsp.writeFile(filePath, '# changed');

    await expect
      .poll(() => events, { timeout: 5000 })
      .toContain('render');
  });

  it('reports "error" when the watched file is deleted', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-watcher-'));
    const filePath = path.join(tmpDir, 'sample.md');
    await fsp.writeFile(filePath, '# initial');

    const events: Array<'render' | 'error'> = [];
    watcher = watchFile(filePath, (action) => events.push(action));
    await waitForReady(watcher);

    await fsp.unlink(filePath);

    await expect
      .poll(() => events, { timeout: 5000 })
      .toContain('error');
  });
});

// Task 47 (functional_domain.md #180/#181, approval condition 1). Appended
// cases only; the two cases above are unchanged.
describe('watchFile: truncate-then-write race and close during a pending write-finish check (Task 47)', () => {
  let tmpDir: string | null = null;
  let watcher: FSWatcher | null = null;

  afterEach(async () => {
    if (watcher) {
      await watcher.close();
      watcher = null;
    }
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  function waitForReady(w: FSWatcher): Promise<void> {
    return new Promise((resolve) => w.on('ready', () => resolve()));
  }

  function makeFile(content: string): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-watcher-47-'));
    const filePath = path.join(tmpDir, 'sample.md');
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  // #181: truncate, wait (event-driven) until the truncate's notification has
  // been delivered, then write the final content at once, inside chokidar's
  // 50 ms leading-edge-only change throttle. #180 requires a notification
  // after the final write, or the preview is left showing the empty file.
  it('delivers a notification after the final write even when it lands right after a delivered truncate (#180/#181)', async () => {
    const filePath = makeFile('# initial\n');
    const callbacks: Array<{ action: 'render' | 'error'; at: number }> = [];
    let onFirst: (() => void) | null = null;
    const firstCallback = new Promise<void>((resolve) => {
      onFirst = resolve;
    });
    watcher = watchFile(filePath, (action) => {
      callbacks.push({ action, at: Date.now() });
      onFirst?.();
    });
    await waitForReady(watcher);

    await fsp.truncate(filePath, 0);
    await firstCallback;
    const callbackAt = callbacks[0].at;

    await fsp.writeFile(filePath, '# final content\n');
    const writtenAt = Date.now();

    // Timing precondition (#181): the write must land inside the window,
    // otherwise this case proves nothing and must not pass.
    const delay = writtenAt - callbackAt;
    if (delay >= 40) throw new Error(`precondition not met: write landed ${delay} ms after the truncate's callback (need < 40 ms)`);

    // Only callbacks AFTER the truncate's own callback (index 0) count: a
    // timestamp filter would accept that callback itself whenever the write
    // finished in the same millisecond (delay 0), a vacuous pass.
    const truncateCallbackIndex = 0;
    await expect
      .poll(() => callbacks.slice(truncateCallbackIndex + 1).filter((c) => c.action === 'render').length, {
        timeout: 3000,
      })
      .toBeGreaterThanOrEqual(1);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('# final content\n');
  });

  it('still reports "error" promptly when the watched file is deleted (unlink is not delayed)', async () => {
    const filePath = makeFile('# initial\n');
    const callbacks: Array<{ action: 'render' | 'error'; at: number }> = [];
    watcher = watchFile(filePath, (action) => callbacks.push({ action, at: Date.now() }));
    await waitForReady(watcher);

    const unlinkedAt = Date.now();
    await fsp.unlink(filePath);

    await expect.poll(() => callbacks.some((c) => c.action === 'error'), { timeout: 1000 }).toBe(true);
    const errorAt = callbacks.find((c) => c.action === 'error')!.at;
    expect(errorAt - unlinkedAt).toBeLessThan(1000);
  });

  // Approval condition 1 (a): chokidar's close() does not cancel a pending
  // awaitWriteFinish poll, so the only barrier against a post-Close render
  // (which documentSlot would accept, resurrecting the document) is that the
  // watcher never calls back once close() has been called.
  it('never calls back after close() when close() lands inside the write-finish window (condition 1a)', async () => {
    const filePath = makeFile('# initial\n');
    const callbacks: Array<{ action: 'render' | 'error'; at: number }> = [];
    watcher = watchFile(filePath, (action) => callbacks.push({ action, at: Date.now() }));
    await waitForReady(watcher);

    await fsp.writeFile(filePath, '# changed right before close\n');
    const writtenAt = Date.now();
    // Let the raw fs notification reach chokidar so a write-finish check is
    // actually pending when close() is called.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const closingWatcher = watcher;
    watcher = null;
    void closingWatcher.close();
    const closedAt = Date.now();

    const delay = closedAt - writtenAt;
    if (delay >= 60) throw new Error(`precondition not met: close() ran ${delay} ms after the write (need < 60 ms)`);

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(callbacks.filter((c) => c.at >= closedAt)).toEqual([]);
    expect(callbacks).toEqual([]);
  });
});

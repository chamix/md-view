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

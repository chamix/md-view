import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

// src/main/index.ts is a composition root: importing it for real triggers
// app.whenReady() side effects that only make sense inside a running
// Electron process (documented precedent: initial_scaffold.md Task 2's
// "not unit-tested directly" note). listDirectoryEntries() is a plain
// async function with no Electron-specific behavior of its own beyond the
// try/catch around fs.readdir, so this integration test stubs the
// 'electron' module with inert no-ops just enough for the module's
// top-level wiring to import without crashing, then exercises
// listDirectoryEntries() against the real filesystem -- the actual thing
// this test is proving, same spirit as tests/integration/watcher.test.ts's
// real-fs approach.
vi.mock('electron', () => {
  const webContents = {
    on: () => {},
    once: () => {},
    setWindowOpenHandler: () => {},
    send: () => {},
    toggleDevTools: () => {},
  };
  class FakeBrowserWindow {
    webContents = webContents;
    static getAllWindows() {
      return [];
    }
    loadFile() {}
    removeMenu() {}
    on() {}
    focus() {}
  }
  return {
    app: {
      isPackaged: false,
      whenReady: () => Promise.resolve(),
      on: () => {},
      dock: { setIcon: () => {} },
    },
    BrowserWindow: FakeBrowserWindow,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    ipcMain: { on: () => {}, handle: () => {} },
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: (t: unknown) => t },
    shell: { openExternal: () => {} },
  };
});

const { listDirectoryEntries } = await import('../../src/main/index');

const fixtureRoot = path.join(process.cwd(), 'tests/e2e/fixtures/tree');

describe('listDirectoryEntries (real fs.readdir against real fixture directories)', () => {
  it('returns ok:true with .md files kept, non-.md files dropped, and directories always kept', async () => {
    const result = await listDirectoryEntries(fixtureRoot);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dirPath).toBe(fixtureRoot);

    const names = result.entries.map((e) => e.name);
    expect(names).toContain('notes.md');
    expect(names).toContain('sub');
    expect(names).toContain('empty-of-md');
    expect(names).not.toContain('ignored.txt');
  });

  it('sorts directories before files within the real fixture directory', async () => {
    const result = await listDirectoryEntries(fixtureRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const firstFileIndex = result.entries.findIndex((e) => e.type === 'file');
    const lastDirIndex = result.entries
      .map((e, i) => (e.type === 'directory' ? i : -1))
      .filter((i) => i >= 0)
      .pop();

    expect(lastDirIndex).toBeDefined();
    expect(firstFileIndex).toBeGreaterThan(lastDirIndex as number);
  });

  it('keeps an empty-of-.md directory in the listing (no recursive pre-scan hides it)', async () => {
    const result = await listDirectoryEntries(fixtureRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const emptyDirEntry = result.entries.find((e) => e.name === 'empty-of-md');
    expect(emptyDirEntry).toBeDefined();
    expect(emptyDirEntry?.type).toBe('directory');

    // Confirm, against the real filesystem, that this directory genuinely
    // has zero .md files inside it -- proving the entry above survived
    // specifically *because* directories are never content-filtered.
    const innerEntries = await fs.readdir(path.join(fixtureRoot, 'empty-of-md'));
    const innerMdFiles = innerEntries.filter((name) => name.toLowerCase().endsWith('.md'));
    expect(innerMdFiles).toHaveLength(0);
  });

  it('resolves ok:false (never rejects) for a nonexistent directory', async () => {
    const badPath = path.join(fixtureRoot, 'does-not-exist-at-all');

    const result = await listDirectoryEntries(badPath);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.dirPath).toBe(badPath);
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
  });

  it('resolves ok:false (never rejects) when the path is a file, not a directory', async () => {
    const filePath = path.join(fixtureRoot, 'notes.md');

    const result = await listDirectoryEntries(filePath);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.dirPath).toBe(filePath);
  });
});

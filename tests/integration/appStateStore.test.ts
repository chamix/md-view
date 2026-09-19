import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadAppState, writeAppStateFile } from '../../src/main/appStateStore';

// Passthrough wrapper over the real fs/promises: real disk I/O for every test
// except the one that flips failNextRename to inject a rename failure (a
// real-fs way to make rename fail while an existing target survives is not
// portable across Windows and POSIX).
const injection = vi.hoisted(() => ({ failNextRename: false, transientRenameFailures: 0, renameCalls: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      injection.renameCalls += 1;
      if (injection.transientRenameFailures > 0) {
        injection.transientRenameFailures -= 1;
        throw Object.assign(new Error('injected transient rename failure'), { code: 'EPERM' });
      }
      if (injection.failNextRename) {
        injection.failNextRename = false;
        throw new Error('injected rename failure');
      }
      return actual.rename(...args);
    },
  };
});

let tempDir: string;
let stateFilePath: string;

beforeEach(() => {
  injection.failNextRename = false;
  injection.transientRenameFailures = 0;
  injection.renameCalls = 0;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-appStateStore-'));
  stateFilePath = path.join(tempDir, 'state.json');
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function tempLeftovers(dir: string): string[] {
  return fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'));
}

describe('loadAppState', () => {
  it('returns null and writes nothing when the file is missing', async () => {
    expect(await loadAppState(stateFilePath)).toBeNull();
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });

  it('returns null and leaves the file untouched when the content is not valid JSON', async () => {
    fs.writeFileSync(stateFilePath, '{ not valid json', 'utf8');

    expect(await loadAppState(stateFilePath)).toBeNull();
    expect(fs.readFileSync(stateFilePath, 'utf8')).toBe('{ not valid json');
  });

  it('returns null and leaves the file untouched when the JSON has the wrong shape', async () => {
    const wrongShape = '{"lastSeenVersion":"1.1.0","extra":1}';
    fs.writeFileSync(stateFilePath, wrongShape, 'utf8');

    expect(await loadAppState(stateFilePath)).toBeNull();
    expect(fs.readFileSync(stateFilePath, 'utf8')).toBe(wrongShape);
  });

  it('returns null (never throws) when the path is unreadable, e.g. a directory', async () => {
    fs.mkdirSync(stateFilePath);
    await expect(loadAppState(stateFilePath)).resolves.toBeNull();
  });

  it('returns the state for a valid file', async () => {
    fs.writeFileSync(stateFilePath, '{"lastSeenVersion":"1.1.0"}', 'utf8');
    expect(await loadAppState(stateFilePath)).toEqual({ lastSeenVersion: '1.1.0' });
  });
});

describe('writeAppStateFile', () => {
  it('creates the parent directory and round-trips through loadAppState', async () => {
    const nested = path.join(tempDir, 'a', 'b', 'state.json');

    await writeAppStateFile(nested, { lastSeenVersion: '1.2.0' });

    expect(await loadAppState(nested)).toEqual({ lastSeenVersion: '1.2.0' });
  });

  it('replaces an existing file', async () => {
    await writeAppStateFile(stateFilePath, { lastSeenVersion: '1.0.0' });
    await writeAppStateFile(stateFilePath, { lastSeenVersion: '1.1.0' });

    expect(await loadAppState(stateFilePath)).toEqual({ lastSeenVersion: '1.1.0' });
  });

  it('leaves no .tmp files behind after a successful write', async () => {
    await writeAppStateFile(stateFilePath, { lastSeenVersion: '1.0.0' });
    await writeAppStateFile(stateFilePath, { lastSeenVersion: '1.1.0' });

    expect(tempLeftovers(tempDir)).toEqual([]);
    expect(fs.readdirSync(tempDir)).toEqual(['state.json']);
  });

  it('rejects when the target is a directory, leaving no .tmp orphan', async () => {
    fs.mkdirSync(stateFilePath);

    await expect(writeAppStateFile(stateFilePath, { lastSeenVersion: '1.1.0' })).rejects.toThrow();

    expect(tempLeftovers(tempDir)).toEqual([]);
    expect(fs.statSync(stateFilePath).isDirectory()).toBe(true);
  });

  it('leaves an existing valid state.json byte-identical and no .tmp orphan when the rename step fails', async () => {
    await writeAppStateFile(stateFilePath, { lastSeenVersion: '1.0.0' });
    const before = fs.readFileSync(stateFilePath);

    injection.failNextRename = true;
    await expect(writeAppStateFile(stateFilePath, { lastSeenVersion: '9.9.9' })).rejects.toThrow(
      'injected rename failure'
    );

    expect(fs.readFileSync(stateFilePath).equals(before)).toBe(true);
    expect(tempLeftovers(tempDir)).toEqual([]);
  });

  // Windows: renaming over an existing file fails transiently with EPERM
  // (measured ~1% of writes with a concurrent reader, and a few in a thousand
  // with none -- antivirus/indexers/readers briefly hold the target). One
  // transient failure must not lose the write (guardrail #139).
  it('retries transient EPERM rename failures and still replaces the file', async () => {
    await writeAppStateFile(stateFilePath, { lastSeenVersion: '1.0.0' });
    injection.renameCalls = 0;
    injection.transientRenameFailures = 2;

    await writeAppStateFile(stateFilePath, { lastSeenVersion: '1.1.0' });

    expect(injection.renameCalls).toBe(3);
    expect(await loadAppState(stateFilePath)).toEqual({ lastSeenVersion: '1.1.0' });
    expect(tempLeftovers(tempDir)).toEqual([]);
  });

  it('gives up after bounded retries on a persistent EPERM, cleaning up the temp file', async () => {
    await writeAppStateFile(stateFilePath, { lastSeenVersion: '1.0.0' });
    const before = fs.readFileSync(stateFilePath);
    injection.transientRenameFailures = 1000;

    await expect(writeAppStateFile(stateFilePath, { lastSeenVersion: '9.9.9' })).rejects.toThrow('injected transient');

    expect(injection.renameCalls).toBeLessThan(20);
    expect(fs.readFileSync(stateFilePath).equals(before)).toBe(true);
    expect(tempLeftovers(tempDir)).toEqual([]);
  });
});

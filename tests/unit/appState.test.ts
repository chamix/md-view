import { describe, it, expect, vi } from 'vitest';
import {
  parseAppState,
  decideWhatsNew,
  mergeAppState,
  decideSessionRestore,
  persistAppStatePatch,
} from '../../src/main/appState';

describe('parseAppState (strict, all-or-nothing)', () => {
  it('accepts a valid state', () => {
    expect(parseAppState('{"lastSeenVersion":"1.1.0"}')).toEqual({ lastSeenVersion: '1.1.0' });
  });

  it('returns null for invalid JSON', () => {
    expect(parseAppState('{ not json')).toBeNull();
    expect(parseAppState('')).toBeNull();
  });

  it('returns null for array / null / string / number JSON', () => {
    expect(parseAppState('[]')).toBeNull();
    expect(parseAppState('null')).toBeNull();
    expect(parseAppState('"1.1.0"')).toBeNull();
    expect(parseAppState('1')).toBeNull();
  });

  // Task 54 (#241/#242): the whole object becoming valid-when-empty is the
  // deliberate point of widening every field to .nullable().optional() -- an
  // empty object is no longer "missing the key", it is "nothing recorded
  // yet" for every field at once.
  it('accepts an empty object: every field is now optional', () => {
    expect(parseAppState('{}')).toEqual({});
  });

  it('returns null when an unknown extra key is present', () => {
    expect(parseAppState('{"lastSeenVersion":"1.1.0","extra":true}')).toBeNull();
  });

  it('returns null for a wrong-typed or empty-string lastSeenVersion, but accepts explicit null (#241 widening)', () => {
    expect(parseAppState('{"lastSeenVersion":1}')).toBeNull();
    expect(parseAppState('{"lastSeenVersion":""}')).toBeNull();
    // Deliberately no longer invalid: lastSeenVersion is now
    // .nullable().optional(), same shape as the two new fields.
    expect(parseAppState('{"lastSeenVersion":null}')).toEqual({ lastSeenVersion: null });
  });

  // #242: a state.json written by any build through Task 53 -- no
  // lastFolderPath/lastFileOpenPath keys at all -- still parses after the
  // widening, with the two new fields simply absent (undefined), never
  // invalidating the already-recorded lastSeenVersion.
  it('a pre-Task-54 state.json (lastSeenVersion only) still parses, with the new fields undefined', () => {
    const result = parseAppState('{"lastSeenVersion":"1.3.0"}');
    expect(result).toEqual({ lastSeenVersion: '1.3.0' });
    expect(result?.lastFolderPath).toBeUndefined();
    expect(result?.lastFileOpenPath).toBeUndefined();
  });

  it('accepts lastFolderPath/lastFileOpenPath as a non-empty string or explicit null', () => {
    expect(parseAppState('{"lastFolderPath":"/a/b","lastFileOpenPath":null}')).toEqual({
      lastFolderPath: '/a/b',
      lastFileOpenPath: null,
    });
  });

  it('rejects an empty-string or wrong-typed lastFolderPath/lastFileOpenPath', () => {
    expect(parseAppState('{"lastFolderPath":""}')).toBeNull();
    expect(parseAppState('{"lastFolderPath":1}')).toBeNull();
    expect(parseAppState('{"lastFileOpenPath":""}')).toBeNull();
    expect(parseAppState('{"lastFileOpenPath":2}')).toBeNull();
  });
});

describe('mergeAppState (ADR-015 shallow merge)', () => {
  it('a patch overwrites a key', () => {
    expect(mergeAppState({ lastSeenVersion: '1.0.0' }, { lastSeenVersion: '1.1.0' })).toEqual({
      lastSeenVersion: '1.1.0',
    });
  });

  it('an explicit null in the patch clears a key (deliberate overwrite)', () => {
    expect(mergeAppState({ lastFileOpenPath: '/a/A.md' }, { lastFileOpenPath: null })).toEqual({
      lastFileOpenPath: null,
    });
  });

  it('current: null defaults to {}', () => {
    expect(mergeAppState(null, { lastSeenVersion: '1.1.0' })).toEqual({ lastSeenVersion: '1.1.0' });
  });

  it('keys not present in the patch are preserved from current', () => {
    const current = { lastSeenVersion: '1.1.0', lastFolderPath: '/a', lastFileOpenPath: '/a/A.md' };
    expect(mergeAppState(current, { lastFolderPath: '/b' })).toEqual({
      lastSeenVersion: '1.1.0',
      lastFolderPath: '/b',
      lastFileOpenPath: '/a/A.md',
    });
  });
});

describe('persistAppStatePatch (#252: write failures never block the app)', () => {
  it('a rejected write is caught and warned exactly once, never rethrown -- the operation completes normally', async () => {
    const warn = vi.fn();
    const write = vi.fn().mockRejectedValue(new Error('disk full'));
    const current = { lastFolderPath: '/a' };

    // Models index.ts's fire-and-forget callers (establishTreeRoot's and
    // onOpenFileChanged's `void persistAppState(...)`): the triggering
    // operation only cares that this promise never rejects.
    const result = await persistAppStatePatch(current, { lastFileOpenPath: '/a/A.md' }, write, warn);

    expect(result).toEqual({ lastFolderPath: '/a', lastFileOpenPath: '/a/A.md' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('md-view: state.json write failed', expect.any(Error));
  });

  it('a later call still merges from the latest state even though the earlier write failed', async () => {
    const warn = vi.fn();
    const write = vi.fn().mockRejectedValue(new Error('disk full'));

    const afterFirst = await persistAppStatePatch({}, { lastFolderPath: '/a' }, write, warn);
    const afterSecond = await persistAppStatePatch(afterFirst, { lastFileOpenPath: '/a/A.md' }, write, warn);

    expect(afterSecond).toEqual({ lastFolderPath: '/a', lastFileOpenPath: '/a/A.md' });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('a successful write resolves without warning', async () => {
    const warn = vi.fn();
    const write = vi.fn().mockResolvedValue(undefined);

    const result = await persistAppStatePatch({ lastFolderPath: '/a' }, { lastFileOpenPath: '/a/A.md' }, write, warn);

    expect(result).toEqual({ lastFolderPath: '/a', lastFileOpenPath: '/a/A.md' });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('decideSessionRestore (#246-#248 truth table)', () => {
  it('both exist: both are restored', () => {
    expect(
      decideSessionRestore({ lastFolderPath: '/a', lastFileOpenPath: '/a/A.md', folderExists: true, fileExists: true })
    ).toEqual({ folderPath: '/a', filePath: '/a/A.md' });
  });

  it('only the folder exists (#247): file is dropped, folder kept', () => {
    expect(
      decideSessionRestore({ lastFolderPath: '/a', lastFileOpenPath: '/a/A.md', folderExists: true, fileExists: false })
    ).toEqual({ folderPath: '/a', filePath: null });
  });

  it('only the file exists: folder is dropped, file kept', () => {
    expect(
      decideSessionRestore({ lastFolderPath: '/a', lastFileOpenPath: '/a/A.md', folderExists: false, fileExists: true })
    ).toEqual({ folderPath: null, filePath: '/a/A.md' });
  });

  it('neither exists (#248): both dropped', () => {
    expect(
      decideSessionRestore({ lastFolderPath: '/a', lastFileOpenPath: '/a/A.md', folderExists: false, fileExists: false })
    ).toEqual({ folderPath: null, filePath: null });
  });
});

describe('decideWhatsNew (pure announcement decision)', () => {
  it('no recorded version -> first-launch', () => {
    expect(decideWhatsNew(null, '1.1.0')).toBe('first-launch');
  });

  it('same version -> up-to-date', () => {
    expect(decideWhatsNew('1.1.0', '1.1.0')).toBe('up-to-date');
  });

  it('different (newer) version -> announce', () => {
    expect(decideWhatsNew('1.0.0', '1.1.0')).toBe('announce');
  });

  it('a downgrade is also announce: inequality, not ordering', () => {
    expect(decideWhatsNew('2.0.0', '1.1.0')).toBe('announce');
  });
});

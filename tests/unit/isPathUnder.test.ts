import { describe, it, expect } from 'vitest';
import { isPathUnder } from '../../src/renderer/renderer.js';

describe('isPathUnder (Task 24: separator-aware "is childPath located under parentPath" check)', () => {
  it('exact match -> true', () => {
    expect(isPathUnder('/foo/bar', '/foo/bar')).toBe(true);
  });

  it('a real nested child -> true', () => {
    expect(isPathUnder('/foo/bar/baz.md', '/foo/bar')).toBe(true);
  });

  it('the false-prefix trap: a sibling whose name merely starts with the parent name -> false', () => {
    expect(isPathUnder('/foo/bar2', '/foo/bar')).toBe(false);
  });

  it('Windows-style backslash separators throughout -> true', () => {
    expect(isPathUnder('C:\\foo\\bar\\baz.md', 'C:\\foo\\bar')).toBe(true);
  });

  it('mixed separators: forward-slash child under a backslash-written parent -> true', () => {
    expect(isPathUnder('C:\\foo\\bar/baz.md', 'C:\\foo\\bar')).toBe(true);
  });
});

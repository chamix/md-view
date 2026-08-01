import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { baseUrlForFile } from '../../src/main/paths';

describe('baseUrlForFile (pure path -> base URL transformation)', () => {
  it('returns a URL ending with a trailing slash (load-bearing: without it, relative resource resolution drops a directory level)', () => {
    const filePath = path.join(path.sep, 'some', 'dir', 'doc.md');
    const result = baseUrlForFile(filePath);
    expect(result.endsWith('/')).toBe(true);
  });

  it('returns a file:// URL', () => {
    const filePath = path.join(path.sep, 'some', 'dir', 'doc.md');
    const result = baseUrlForFile(filePath);
    expect(result.startsWith('file://')).toBe(true);
  });

  it('resolves to the containing directory, not the file itself', () => {
    const dir = path.join(path.sep, 'some', 'dir');
    const filePath = path.join(dir, 'doc.md');
    const result = baseUrlForFile(filePath);

    expect(result).not.toContain('doc.md');

    const dirSegments = dir.split(path.sep).filter(Boolean);
    for (const segment of dirSegments) {
      expect(result).toContain(segment);
    }
  });
});

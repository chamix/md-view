import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { changelogPathFor } from '../../src/main/paths';

describe('changelogPathFor (pure path formula shared by index.ts and the dist test)', () => {
  it('resolves to CHANGELOG.md one directory above the main dir', () => {
    const mainDir = path.join(path.sep, 'x', 'dist', 'main');
    expect(path.normalize(changelogPathFor(mainDir))).toBe(path.join(path.sep, 'x', 'dist', 'CHANGELOG.md'));
  });
});

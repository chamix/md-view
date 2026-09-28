import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { packageJsonPathFor, licensePathFor, thirdPartyNoticesPathFor } from '../../src/main/paths';

// Task 46 (#170, #176): one formula per shipped About input, shared by
// index.ts (mainDir = __dirname) and the dist tests.
describe('About input path formulas', () => {
  const mainDir = path.join(path.sep, 'x', 'app.asar', 'dist', 'main');

  it('packageJsonPathFor resolves two levels above the main dir (app.asar/package.json)', () => {
    expect(path.normalize(packageJsonPathFor(mainDir))).toBe(path.join(path.sep, 'x', 'app.asar', 'package.json'));
  });

  it('licensePathFor resolves to dist/LICENSE', () => {
    expect(path.normalize(licensePathFor(mainDir))).toBe(path.join(path.sep, 'x', 'app.asar', 'dist', 'LICENSE'));
  });

  it('thirdPartyNoticesPathFor resolves to dist/third-party-notices.json', () => {
    expect(path.normalize(thirdPartyNoticesPathFor(mainDir))).toBe(
      path.join(path.sep, 'x', 'app.asar', 'dist', 'third-party-notices.json')
    );
  });
});

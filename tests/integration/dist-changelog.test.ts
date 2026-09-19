import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { changelogPathFor } from '../../src/main/paths';

// Built-output proof (functional_domain.md guardrail #143): electron-builder
// ships only dist/**/*, so the changelog the app reads at runtime must exist
// inside dist/ and be readable through the compiled code -- source-tree
// existence proves nothing. Requires `npm run build` to have run first.
const repoRoot = path.resolve(__dirname, '../..');
const distMainDir = path.join(repoRoot, 'dist', 'main');
const compiledChangelogModule = path.join(distMainDir, 'changelog.js');

function requireBuilt(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${filePath} is missing -- run \`npm run build\` first`);
  }
}

describe('built dist/ output ships a usable changelog', () => {
  it('dist/CHANGELOG.md (via changelogPathFor) equals the repo-root CHANGELOG.md', () => {
    const shipped = changelogPathFor(distMainDir);
    requireBuilt(shipped);

    expect(fs.readFileSync(shipped, 'utf8')).toBe(fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8'));
  });

  it("the compiled extractor finds a non-blank section for package.json's version in the shipped changelog", () => {
    requireBuilt(compiledChangelogModule);
    const shipped = changelogPathFor(distMainDir);
    requireBuilt(shipped);

    const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      version: string;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { extractChangelogSection } = require(compiledChangelogModule) as {
      extractChangelogSection: (text: string, version: string) => string | null;
    };

    const body = extractChangelogSection(fs.readFileSync(shipped, 'utf8'), version);

    expect(body).not.toBeNull();
    expect((body ?? '').trim()).not.toBe('');
  });
});

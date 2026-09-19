import { dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export function baseUrlForFile(filePath: string): string {
  return pathToFileURL(dirname(filePath) + sep).href;
}

// Shared by index.ts (mainDir = __dirname) and the built-output test, so both
// resolve the shipped changelog through one formula: dist/main -> dist/CHANGELOG.md.
export function changelogPathFor(mainDir: string): string {
  return join(mainDir, '..', 'CHANGELOG.md');
}

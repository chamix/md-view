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

// Task 46 About inputs, same one-formula posture. dist/main -> the shipped
// package.json (app.asar/package.json when packaged, the repo's in dev).
export function packageJsonPathFor(mainDir: string): string {
  return join(mainDir, '..', '..', 'package.json');
}

// dist/main -> dist/LICENSE (copied by the build script).
export function licensePathFor(mainDir: string): string {
  return join(mainDir, '..', 'LICENSE');
}

// dist/main -> dist/third-party-notices.json (scripts/third-party-notices.mjs).
export function thirdPartyNoticesPathFor(mainDir: string): string {
  return join(mainDir, '..', 'third-party-notices.json');
}

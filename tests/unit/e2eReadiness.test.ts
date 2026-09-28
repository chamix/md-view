import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Task 47 #185: renderer readiness coverage is complete AND checked. Every
// test using the shared launch fixture is covered by the fixture itself;
// every spec that launches Electron directly must establish readiness at
// least once per launch. A structural scan, so a new direct launch without
// the helper fails here instead of flaking under load.

const E2E_DIR = path.join(__dirname, '../e2e');

// Drops block comments and full-line // comments, so prose that mentions
// `_electron.launch(` or the helper does not count as a call.
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

function count(source: string, pattern: RegExp): number {
  return (source.match(pattern) ?? []).length;
}

// `\b` keeps `_electron.launch(` (only ever the import alias in prose) out.
const LAUNCH = /\belectron\.launch\(/g;
const READY = /\bwaitForRendererReady\(/g;

function specFiles(): string[] {
  return fs
    .readdirSync(E2E_DIR)
    .filter((name) => name.endsWith('.spec.ts'))
    .sort();
}

describe('e2e renderer readiness coverage (#185)', () => {
  it('every spec that launches Electron directly calls waitForRendererReady at least once per launch', () => {
    const offenders = specFiles()
      .map((name) => {
        const code = codeOnly(fs.readFileSync(path.join(E2E_DIR, name), 'utf8'));
        return { name, launches: count(code, LAUNCH), ready: count(code, READY) };
      })
      .filter(({ launches, ready }) => launches > 0 && ready < launches);

    expect(offenders).toEqual([]);
  });

  it('the scan is not vacuous: it sees the known direct launches', () => {
    const launches = specFiles().reduce(
      (sum, name) => sum + count(codeOnly(fs.readFileSync(path.join(E2E_DIR, name), 'utf8')), LAUNCH),
      0
    );
    expect(launches).toBeGreaterThanOrEqual(6);
  });

  it('the shared electronApp fixture establishes readiness before handing the app to a test', () => {
    const code = codeOnly(fs.readFileSync(path.join(E2E_DIR, 'support/fixtures.ts'), 'utf8'));
    const readyAt = code.search(READY);
    const useAt = code.indexOf('await use(app)');
    expect(readyAt).toBeGreaterThan(-1);
    expect(useAt).toBeGreaterThan(-1);
    expect(readyAt).toBeLessThan(useAt);
  });
});

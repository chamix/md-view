import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { statusBarText } = require('../../src/renderer/renderer.js');

describe('statusBarText (pure status line derivation)', () => {
  it('null message -> "No file open"', () => {
    expect(statusBarText(null)).toBe('No file open');
  });

  it('ok message with filePath -> that filePath', () => {
    expect(statusBarText({ ok: true, filePath: '/a/b.md', html: '', baseUrl: '' })).toBe('/a/b.md');
  });

  it('error message with null filePath -> "No file open"', () => {
    expect(statusBarText({ ok: false, filePath: null, error: 'x' })).toBe('No file open');
  });

  it('error message with filePath -> that filePath', () => {
    expect(statusBarText({ ok: false, filePath: '/a/b.md', error: 'x' })).toBe('/a/b.md');
  });
});

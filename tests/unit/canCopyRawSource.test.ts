import { describe, it, expect } from 'vitest';
import { canCopyRawSource } from '../../src/renderer/renderer.js';

describe('canCopyRawSource (pure gate for the raw-copy button)', () => {
  it('no message -> false', () => {
    expect(canCopyRawSource(null)).toBe(false);
    expect(canCopyRawSource(undefined)).toBe(false);
  });

  it('message with ok: false (error variant) -> false', () => {
    const message = { ok: false, filePath: '/a.md', error: 'boom' };

    expect(canCopyRawSource(message)).toBe(false);
  });

  it('message with ok: true -> true', () => {
    const message = { ok: true, filePath: '/a.md', html: '', codeHtml: '', baseUrl: '', frontmatter: null };

    expect(canCopyRawSource(message)).toBe(true);
  });
});

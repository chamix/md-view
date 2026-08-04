import { describe, it, expect } from 'vitest';
import { shouldShowFrontmatter } from '../../src/renderer/renderer.js';

describe('shouldShowFrontmatter (pure display-decision)', () => {
  it('showFrontmatter: true, message has frontmatter -> true', () => {
    const message = { ok: true, filePath: '/a.md', html: '', baseUrl: '', frontmatter: 'title: X' };
    const viewSettings = { darkMode: false, showFrontmatter: true };

    expect(shouldShowFrontmatter(message, viewSettings)).toBe(true);
  });

  it('showFrontmatter: true, message has frontmatter: null -> false', () => {
    const message = { ok: true, filePath: '/a.md', html: '', baseUrl: '', frontmatter: null };
    const viewSettings = { darkMode: false, showFrontmatter: true };

    expect(shouldShowFrontmatter(message, viewSettings)).toBe(false);
  });

  it('showFrontmatter: false, message has frontmatter -> false', () => {
    const message = { ok: true, filePath: '/a.md', html: '', baseUrl: '', frontmatter: 'title: X' };
    const viewSettings = { darkMode: false, showFrontmatter: false };

    expect(shouldShowFrontmatter(message, viewSettings)).toBe(false);
  });

  it('showFrontmatter: false, message has frontmatter: null -> false', () => {
    const message = { ok: true, filePath: '/a.md', html: '', baseUrl: '', frontmatter: null };
    const viewSettings = { darkMode: false, showFrontmatter: false };

    expect(shouldShowFrontmatter(message, viewSettings)).toBe(false);
  });

  it('message: null -> false regardless of viewSettings', () => {
    const viewSettings = { darkMode: false, showFrontmatter: true };

    expect(shouldShowFrontmatter(null, viewSettings)).toBe(false);
  });

  it('viewSettings: null -> false regardless of message', () => {
    const message = { ok: true, filePath: '/a.md', html: '', baseUrl: '', frontmatter: 'title: X' };

    expect(shouldShowFrontmatter(message, null)).toBe(false);
  });

  it('message.ok === false (error variant) with any viewSettings -> false', () => {
    const message = { ok: false, filePath: '/a.md', error: 'boom' };
    const viewSettings = { darkMode: false, showFrontmatter: true };

    expect(shouldShowFrontmatter(message, viewSettings)).toBe(false);
  });
});

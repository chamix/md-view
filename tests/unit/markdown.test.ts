import { describe, it, expect } from 'vitest';
import { markdownToHtml } from '../../src/main/markdown';

describe('markdownToHtml (pure conversion)', () => {
  it('converts basic markdown to HTML', () => {
    const html = markdownToHtml('# Hello');
    expect(html).toContain('<h1>Hello</h1>');
  });

  it('never allows raw HTML passthrough from source (security invariant)', () => {
    const html = markdownToHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

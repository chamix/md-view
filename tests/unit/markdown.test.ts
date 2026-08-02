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

  it('applies syntax highlighting to a fence with a supported declared language', () => {
    const html = markdownToHtml('```js\nfunction add(a, b) { return a + b; }\n```');
    expect(html).toContain('hljs-keyword');
  });

  it('renders a fence with no declared language as plain escaped text (no auto-detection)', () => {
    const html = markdownToHtml('```\nfunction add(a, b) { return a + b; }\n```');
    expect(html).not.toContain('hljs');
    expect(html).not.toContain('language-');
  });

  it('does not throw and falls back to plain escaped text (no hljs markup) for an unrecognized declared language', () => {
    expect(() =>
      markdownToHtml('```notarealtonguage\nfunction add(a, b) { return a + b; }\n```')
    ).not.toThrow();
    const html = markdownToHtml('```notarealtonguage\nfunction add(a, b) { return a + b; }\n```');
    // Same escaping treatment as the no-language case: no hljs-* token classes anywhere,
    // i.e. highlight() correctly returned falsy and markdown-it fell back to its own
    // plain escaping. (markdown-it's default fence renderer still emits a
    // class="language-notarealtonguage" wrapper from the info string itself, regardless
    // of highlight's return value, which is expected/harmless markdown-it behavior.)
    expect(html).not.toContain('hljs');
  });

  it('escapes script tags inside a highlighted fenced code block (security regression)', () => {
    const html = markdownToHtml('```js\n<script>alert(1)</script>\n```');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;/script&gt;');
  });

  it('escapes script tags inside a no-language fenced code block (security regression)', () => {
    const html = markdownToHtml('```\n<script>alert(1)</script>\n```');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

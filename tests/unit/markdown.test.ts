import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { markdownToHtml, highlightMarkdownSource, isMermaidFence } from '../../src/main/markdown';

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

  it('strips a bare HTML comment alone in its own paragraph, producing no output at all (no empty <p> wrapper)', () => {
    const html = markdownToHtml('<!-- just a comment -->');
    expect(html).not.toContain('just a comment');
    expect(html).not.toContain('<p>');
  });

  it('strips a standalone HTML comment paragraph in the middle of a document, leaving surrounding text intact and no stray empty <p></p>', () => {
    const html = markdownToHtml(
      '# Heading\n\nBefore text.\n\n<!-- a comment -->\n\nAfter text.'
    );
    expect(html).not.toContain('a comment');
    expect(html).toContain('Before text.');
    expect(html).toContain('After text.');
    expect(html).not.toContain('<p></p>');
    expect((html.match(/<p>/g) || []).length).toBe(2);
  });

  it('strips a comment mixed with real text inside the same paragraph, keeping the paragraph and the surrounding text', () => {
    const html = markdownToHtml('Some text <!-- inline comment --> more text.');
    expect(html).not.toContain('inline comment');
    expect(html).toContain('Some text');
    expect(html).toContain('more text.');
    expect((html.match(/<p>/g) || []).length).toBe(1);
  });

  it('leaves an HTML comment inside a fenced code block untouched as literal escaped text (regression guard)', () => {
    const html = markdownToHtml('```html\n<!-- inside fence -->\n<div>x</div>\n```');
    expect(html).toContain('&lt;!--');
    expect(html).toContain('<pre>');
    expect(html).toContain('<code');
  });
});

describe('highlightMarkdownSource (Task 32: raw-source Code tab, independent of markdownToHtml)', () => {
  it('produces hljs-* span(s) for a known markdown snippet', () => {
    const html = highlightMarkdownSource('# Heading\n\nSome **bold** text.');
    expect(html).toContain('hljs-');
    expect(html).toContain('<code class="hljs language-markdown">');
  });

  it('does not throw on an empty string input', () => {
    expect(() => highlightMarkdownSource('')).not.toThrow();
    const html = highlightMarkdownSource('');
    expect(html).toContain('<code class="hljs language-markdown">');
  });

  it('HTML-escapes script-tag-like text in the source (security regression, mirrors markdownToHtml)', () => {
    const html = highlightMarkdownSource('<script>alert(1)</script>');
    // hljs's markdown grammar highlights embedded HTML with nested spans, so
    // the escaped angle brackets are not necessarily contiguous with the tag
    // name -- the real security invariant is simply that no literal,
    // unescaped `<script>` tag reaches the renderer's innerHTML sink.
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</script>');
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
  });

  it('never wraps its own output in a <pre> (the container already is one)', () => {
    const html = highlightMarkdownSource('# Heading\n\nSome text.');
    expect(html).not.toContain('<pre');
  });
});

// Task 45 #156 characterization: every non-mermaid fence must keep today's
// highlight.js output byte for byte. The golden file was generated from the
// UNMODIFIED markdown.ts (main @ 8e80fa0) before the fence decorator existed.
// Only the golden's own line endings are normalized: with core.autocrlf=true a
// fresh checkout rewrites it to CRLF, while markdown-it output is always LF.
describe('Task 45 #156: non-mermaid fences are byte-identical to pre-Task-45 output', () => {
  it('with-code fixture renders exactly the golden HTML', () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const source = fs.readFileSync(path.join(repoRoot, 'tests/e2e/fixtures/with-code/doc.md'), 'utf8');
    const golden = fs.readFileSync(path.join(__dirname, 'golden/with-code.html'), 'utf8').replace(/\r\n/g, '\n');
    expect(markdownToHtml(source)).toBe(golden);
  });
});

describe('Task 45 #156: isMermaidFence (exact, case-sensitive first word)', () => {
  it.each(['mermaid', 'mermaid title', '  mermaid  ', 'mermaid\t{.class}'])('%j is a mermaid fence', (info) => {
    expect(isMermaidFence(info)).toBe(true);
  });

  it.each(['Mermaid', 'MERMAID', 'mermaid-js', 'mermaidx', 'js mermaid', ''])('%j is NOT a mermaid fence', (info) => {
    expect(isMermaidFence(info)).toBe(false);
  });

  it('a mermaid fence becomes the diagram placeholder, with no language class echoed', () => {
    const html = markdownToHtml('```mermaid\ngraph TD\n  A-->B\n```');
    expect(html).toBe(
      '<div class="md-view-diagram" data-diagram="mermaid"><pre class="md-view-diagram-source"><code>graph TD\n  A--&gt;B\n</code></pre></div>'
    );
  });

  it('a capitalised Mermaid fence stays an ordinary code block', () => {
    const html = markdownToHtml('```Mermaid\ngraph TD\n```');
    expect(html).not.toContain('md-view-diagram');
    expect(html).toContain('<pre><code class="language-Mermaid">');
  });

  it('an indented code block with mermaid source is not a diagram', () => {
    const html = markdownToHtml('Para.\n\n    mermaid\n    graph TD\n      A-->B\n');
    expect(html).not.toContain('md-view-diagram');
    expect(html).toContain('<pre><code>');
  });

  it('inline `mermaid` code is not a diagram', () => {
    const html = markdownToHtml('Use `mermaid` here.');
    expect(html).not.toContain('md-view-diagram');
    expect(html).toContain('<code>mermaid</code>');
  });
});

describe('Task 45 #157: the placeholder carries the fence body as escaped text only', () => {
  it('a hostile body yields no <script, no <img and no onerror (security regression)', () => {
    const html = markdownToHtml('```mermaid\n</pre><script>alert(1)</script><img src=x onerror=alert(1)>\n```');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/<[^>]*onerror/);
    expect(html).toContain('&lt;/pre&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes " and & in the body', () => {
    const html = markdownToHtml('```mermaid\nA["x & y"]\n```');
    expect(html).toContain('<code>A[&quot;x &amp; y&quot;]\n</code>');
  });

  it('never echoes the info string into an attribute', () => {
    const html = markdownToHtml('```mermaid "><script>x</script>\ngraph TD\n```');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('language-');
  });
});

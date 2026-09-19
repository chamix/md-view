import { describe, it, expect } from 'vitest';
import { buildHelpHtml } from '../../src/main/helpWindow';

describe('buildHelpHtml (pure HTML templating)', () => {
  it('contains a <link rel="stylesheet" href="..."> for each cssHrefs entry, in order', () => {
    const cssHrefs = ['file:///a/app.css', 'file:///a/github-markdown-light.css', 'file:///a/github.css'];
    const html = buildHelpHtml('<p>hi</p>', cssHrefs);

    const indices = cssHrefs.map((href) => {
      const needle = `<link rel="stylesheet" href="${href}">`;
      expect(html).toContain(needle);
      return html.indexOf(needle);
    });

    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('contains the given contentHtml inside a .markdown-body element', () => {
    const html = buildHelpHtml('<p>hello help</p>', []);

    const markdownBodyIndex = html.indexOf('class="markdown-body"');
    expect(markdownBodyIndex).toBeGreaterThan(-1);
    expect(html).toContain('<p>hello help</p>');
    expect(html.indexOf('<p>hello help</p>')).toBeGreaterThan(markdownBodyIndex);
  });

  it('starts with <!DOCTYPE html>', () => {
    const html = buildHelpHtml('<p>hi</p>', []);

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });
});

describe('buildHelpHtml title parameter', () => {
  it('defaults to "md-view Help" when no title is given', () => {
    expect(buildHelpHtml('<p>x</p>', [])).toContain('<title>md-view Help</title>');
  });

  it('uses a custom title when given', () => {
    expect(buildHelpHtml('<p>x</p>', [], "What's New in md-view 1.2.0")).toContain(
      "<title>What's New in md-view 1.2.0</title>"
    );
  });

  it('HTML-escapes & < > and " in the title', () => {
    const html = buildHelpHtml('<p>x</p>', [], 'a & <b> "c"');
    expect(html).toContain('<title>a &amp; &lt;b&gt; &quot;c&quot;</title>');
    expect(html).not.toContain('<b>');
  });
});

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { buildHelpHtml, buildStaticWindowCsp, escapeHtml, staticHtmlDataUrl } from '../../src/main/helpWindow';

// Task 46 (#178, ADR-011): the shell embeds ONE LF-normalized stylesheet and
// pins it by hash in a CSP with no script-src and no 'unsafe-inline'.
function embeddedStyle(html: string): string {
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
  expect(styles).toHaveLength(1);
  return styles[0][1];
}

function cspContent(html: string): string {
  const metas = html.match(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/g) ?? [];
  expect(metas).toHaveLength(1);
  const content = metas[0].match(/content="([^"]*)"/)?.[1];
  expect(content).toBeDefined();
  return content as string;
}

function sha256Base64(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('base64');
}

describe('buildHelpHtml (pure HTML templating)', () => {
  it('contains the given contentHtml inside a .markdown-body element', () => {
    const html = buildHelpHtml('<p>hello help</p>', '');

    const markdownBodyIndex = html.indexOf('class="markdown-body md-view-static"');
    expect(markdownBodyIndex).toBeGreaterThan(-1);
    expect(html).toContain('<p>hello help</p>');
    expect(html.indexOf('<p>hello help</p>')).toBeGreaterThan(markdownBodyIndex);
  });

  it('starts with <!DOCTYPE html>', () => {
    const html = buildHelpHtml('<p>hi</p>', '');

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });
});

describe('buildHelpHtml static-window CSP (#178)', () => {
  const css = '.a { color: red; }\n.b { color: blue; }';

  it('the CSP meta is the first element after <meta charset>, before <title> and <style>', () => {
    const html = buildHelpHtml('<p>x</p>', css);
    const tags = [...html.matchAll(/<(meta|title|style|link|script)\b[^>]*>/g)].map((m) => m[0]);
    expect(tags[0]).toMatch(/^<meta charset=/i);
    expect(tags[1]).toMatch(/^<meta http-equiv="Content-Security-Policy"/);
    expect(tags[2]).toMatch(/^<title>/);
    expect(tags[3]).toBe('<style>');
  });

  it('its content equals buildStaticWindowCsp(sha256 of the embedded <style> text)', () => {
    const html = buildHelpHtml('<p>x</p>', css);
    const style = embeddedStyle(html);
    expect(cspContent(html)).toBe(buildStaticWindowCsp(sha256Base64(style)));
  });

  it('buildStaticWindowCsp is exactly the approved policy shape', () => {
    expect(buildStaticWindowCsp('H')).toBe("default-src 'none'; style-src 'sha256-H'; base-uri 'none'; form-action 'none'");
  });

  it("has no script-src and no 'unsafe-inline'", () => {
    const content = cspContent(buildHelpHtml('<p>x</p>', css));
    expect(content).not.toContain('script-src');
    expect(content).not.toContain('unsafe-inline');
    expect(content).toMatch(/^default-src 'none';/);
  });

  it('embeds CRLF (and lone CR) CSS as LF and hashes the LF text', () => {
    const html = buildHelpHtml('<p>x</p>', '.a {\r\n  color: red;\r\n}\r.b {}');
    const style = embeddedStyle(html);
    expect(style).not.toContain('\r');
    expect(style).toContain('.a {\n  color: red;\n}\n.b {}');
    expect(cspContent(html)).toBe(buildStaticWindowCsp(sha256Base64(style)));
  });

  it('embeds the given CSS and appends the .md-view-static rule', () => {
    const style = embeddedStyle(buildHelpHtml('<p>x</p>', css));
    expect(style.startsWith(css)).toBe(true);
    expect(style).toMatch(/\.md-view-static\s*\{\s*max-width:\s*44rem;\s*margin:\s*2rem auto;\s*padding:\s*0 1\.5rem 3rem;\s*\}/);
  });

  it.each(['</style>', '</STYLE >', 'a</Style'])('throws when the CSS contains %j', (bad) => {
    expect(() => buildHelpHtml('<p>x</p>', `.a{} ${bad}`)).toThrow(/<\/style/i);
  });

  it('emits no style= attribute and no <link>', () => {
    const html = buildHelpHtml('<p>x</p>', css);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toContain('<link');
  });
});

describe('staticHtmlDataUrl', () => {
  it('is the utf-8 data: URL of the encoded document', () => {
    expect(staticHtmlDataUrl('<p>a b</p>')).toBe('data:text/html;charset=utf-8,%3Cp%3Ea%20b%3C%2Fp%3E');
  });
});

describe('escapeHtml', () => {
  it('escapes & < > and "', () => {
    expect(escapeHtml(`a & <b> "c" 'd'`)).toBe(`a &amp; &lt;b&gt; &quot;c&quot; 'd'`);
  });
});

describe('buildHelpHtml title parameter', () => {
  it('defaults to "md-view Help" when no title is given', () => {
    expect(buildHelpHtml('<p>x</p>', '')).toContain('<title>md-view Help</title>');
  });

  it('uses a custom title when given', () => {
    expect(buildHelpHtml('<p>x</p>', '', "What's New in md-view 1.2.0")).toContain(
      "<title>What's New in md-view 1.2.0</title>"
    );
  });

  it('HTML-escapes & < > and " in the title', () => {
    const html = buildHelpHtml('<p>x</p>', '', 'a & <b> "c"');
    expect(html).toContain('<title>a &amp; &lt;b&gt; &quot;c&quot;</title>');
    expect(html).not.toContain('<b>');
  });
});

import { createHash } from 'node:crypto';

export interface DestroyableWindow {
  isDestroyed(): boolean;
}

export function shouldCreateHelpWindow(existing: DestroyableWindow | null): boolean {
  return existing === null || existing.isDestroyed();
}

// The one HTML-escaping site shared by every static-window renderer (Help
// title, What's New title, About and the third-party notices -- #171).
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Task 46 (#178, ADR-011): the static windows run no script, so the policy has
// no script-src at all (default-src 'none' covers it); styles are allowed only
// for the one embedded <style> whose SHA-256 is pinned. base-uri and
// form-action do not fall back to default-src, so they are set explicitly.
export function buildStaticWindowCsp(sha256Base64: string): string {
  return `default-src 'none'; style-src 'sha256-${sha256Base64}'; base-uri 'none'; form-action 'none'`;
}

// Replaces the former inline style attribute (a hash never matches an
// attribute, so style= would be refused under the policy above).
const STATIC_LAYOUT_CSS = '.md-view-static { max-width: 44rem; margin: 2rem auto; padding: 0 1.5rem 3rem; }';

// The static windows load as data: documents (loadStaticHtml); one formula,
// shared with the dist size-budget test (#177).
export function staticHtmlDataUrl(html: string): string {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

// Shared static-window HTML shell (Help, What's New, About). The CSS is
// LF-normalized BEFORE hashing: the HTML parser normalizes CR/CRLF inside
// <style> before the browser hashes it, so hashing raw CRLF bytes would never
// match. The hash and the <style> are emitted from the same string, so they
// cannot drift.
export function buildHelpHtml(contentHtml: string, cssText: string, title: string = 'md-view Help'): string {
  if (/<\/style/i.test(cssText)) {
    throw new Error('static-window CSS must not contain "</style"');
  }
  const css = `${cssText.replace(/\r\n?/g, '\n')}\n${STATIC_LAYOUT_CSS}\n`;
  const hash = createHash('sha256').update(css, 'utf8').digest('base64');
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${buildStaticWindowCsp(hash)}" />
    <title>${escapeHtml(title)}</title>
    <style>${css}</style>
  </head>
  <body>
    <div class="markdown-body md-view-static">
      ${contentHtml}
    </div>
  </body>
</html>`;
}

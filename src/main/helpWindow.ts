export interface DestroyableWindow {
  isDestroyed(): boolean;
}

export function shouldCreateHelpWindow(existing: DestroyableWindow | null): boolean {
  return existing === null || existing.isDestroyed();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Shared static-window HTML shell: the What's New window reuses it with its
// own title rather than duplicating the template.
export function buildHelpHtml(contentHtml: string, cssHrefs: string[], title: string = 'md-view Help'): string {
  const links = cssHrefs.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n    ');
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(title)}</title>
    ${links}
  </head>
  <body>
    <div class="markdown-body" style="max-width: 44rem; margin: 2rem auto; padding: 0 1.5rem 3rem;">
      ${contentHtml}
    </div>
  </body>
</html>`;
}

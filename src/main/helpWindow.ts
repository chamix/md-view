export interface DestroyableWindow {
  isDestroyed(): boolean;
}

export function shouldCreateHelpWindow(existing: DestroyableWindow | null): boolean {
  return existing === null || existing.isDestroyed();
}

export function buildHelpHtml(contentHtml: string, cssHrefs: string[]): string {
  const links = cssHrefs.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n    ');
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>md-view Help</title>
    ${links}
  </head>
  <body>
    <div class="markdown-body" style="max-width: 44rem; margin: 2rem auto; padding: 0 1.5rem 3rem;">
      ${contentHtml}
    </div>
  </body>
</html>`;
}

import type { DestroyableWindow } from './helpWindow';

// Same contract as shouldCreateHelpWindow -- a deliberate separate one-liner:
// the two windows may diverge, and only two exist.
export function shouldCreateWhatsNewWindow(existing: DestroyableWindow | null): boolean {
  return existing === null || existing.isDestroyed();
}

export function buildWhatsNewMarkdown(version: string, body: string): string {
  return `# What's New in md-view ${version}\n\n${body}`;
}

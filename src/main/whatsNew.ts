import { decideWhatsNew } from './appState';
import type { AppState } from './appState';
import { extractChangelogSection } from './changelog';

// Function-valued ports (ISP): the workflow never imports fs, so it is unit
// tested with in-memory fakes. loadState is specified never to throw, but
// prepareWhatsNew is defensive about it anyway (guardrail #140).
export interface WhatsNewPorts {
  loadState(): Promise<AppState | null>;
  saveState(state: AppState): Promise<void>;
  readChangelog(): Promise<string>;
}

export interface WhatsNewContent {
  version: string;
  body: string;
}

// Decides whether to show release notes for currentVersion, and returns them
// if so. Never throws (guardrail #140). Writes state only on first launch
// (#137); an announce never writes here -- "seen" is recorded on window close
// via recordVersionSeen (#139), and never at all if nothing was shown.
export async function prepareWhatsNew(ports: WhatsNewPorts, currentVersion: string): Promise<WhatsNewContent | null> {
  let last: AppState | null;
  try {
    last = await ports.loadState();
  } catch (error) {
    console.warn('What\'s New: could not load app state:', error);
    return null;
  }

  const decision = decideWhatsNew(last?.lastSeenVersion ?? null, currentVersion);

  if (decision === 'first-launch') {
    try {
      await ports.saveState({ lastSeenVersion: currentVersion });
    } catch (error) {
      console.warn('What\'s New: could not record first-launch version:', error);
    }
    return null;
  }

  if (decision === 'up-to-date') return null;

  try {
    const text = await ports.readChangelog();
    const body = extractChangelogSection(text, currentVersion);
    if (body === null || body.trim() === '') {
      console.warn(`What's New: no release notes found for version ${currentVersion}`);
      return null;
    }
    return { version: currentVersion, body };
  } catch (error) {
    console.warn('What\'s New: could not read the changelog:', error);
    return null;
  }
}

// Called when the What's New window is closed (guardrail #139).
export async function recordVersionSeen(ports: WhatsNewPorts, version: string): Promise<void> {
  try {
    await ports.saveState({ lastSeenVersion: version });
  } catch (error) {
    console.warn('What\'s New: could not record the seen version:', error);
  }
}

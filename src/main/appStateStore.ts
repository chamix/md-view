import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseAppState } from './appState';
import { writeFileAtomic } from './atomicWriteFile';
import type { AppState } from './appState';

// Missing, unreadable, or invalid all collapse to null; never throws, never
// writes (guardrails #135, #137). The caller treats null as fresh install.
export async function loadAppState(filePath: string): Promise<AppState | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  return parseAppState(raw);
}

// Atomic replace (guardrail #141): temp file in the same directory plus
// renameWithRetry, shared with settingsStore since Task 47 (atomicWriteFile.ts).
export async function writeAppStateFile(filePath: string, state: AppState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, JSON.stringify(state, null, 2));
}

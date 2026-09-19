import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseAppState } from './appState';
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

let tempCounter = 0;

// On Windows, renaming over an existing file fails transiently (EPERM/EBUSY/
// EACCES) while another process or an antivirus/indexer briefly holds the
// target -- measured ~1% of writes with a concurrent reader. Retry a few times
// with a short backoff (the same approach graceful-fs takes) before giving up;
// anything else, or exhausting the retries, still fails the write.
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_MAX_ATTEMPTS = 6;

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= RENAME_MAX_ATTEMPTS || code === undefined || !RENAME_RETRY_CODES.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
    }
  }
}

// Atomic replace (guardrail #141): write to a unique temp file in the SAME
// directory (rename is only atomic within one filesystem), then rename over
// the target. A failure leaves any existing target untouched and cleans up
// the temp file best-effort before rethrowing. Deliberately not the plain
// writeFile pattern of writeSettingsFile.
export async function writeAppStateFile(filePath: string, state: AppState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  tempCounter += 1;
  const tempPath = `${filePath}.${process.pid}.${tempCounter}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

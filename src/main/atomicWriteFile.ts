import * as fs from 'node:fs/promises';

// Task 47 (D3): the one atomic-replace policy, extracted verbatim from
// appStateStore.ts (ADR-009) so settings.json uses it too. Both stores call it
// after creating the parent directory themselves.

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
// the temp file best-effort before rethrowing, so a reader only ever sees the
// old bytes or the new bytes, never a truncated or partial file.
export async function writeFileAtomic(filePath: string, data: string): Promise<void> {
  tempCounter += 1;
  const tempPath = `${filePath}.${process.pid}.${tempCounter}.tmp`;
  try {
    await fs.writeFile(tempPath, data, 'utf8');
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

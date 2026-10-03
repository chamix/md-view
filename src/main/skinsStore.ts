import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseSkins, defaultSkinsFile } from './skins';
import type { SkinsFile } from './skins';
import { writeFileAtomic } from './atomicWriteFile';

// Task 51 (ADR-014): the I/O adapter for skins.json, mirroring
// settingsStore.ts function for function. Never imports electron.

// Atomic replace (same policy as settings.json, Task 47 D3). Still a throwing
// adapter: callers contain failures (#220).
export async function writeSkinsFile(filePath: string, skins: SkinsFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, JSON.stringify(skins, null, 2));
}

// #214: a missing file is not an error (defaults in memory, nothing written).
// #215 + D1: a file that reads but fails parseSkins is corrupt. Its original
// bytes are first copied to `<file>.bak` so a typo can never silently destroy
// user-authored skins, then the file is self-healed with valid defaults. Both
// steps are contained; the app always boots on defaults.
export async function loadSkinsAtStartup(filePath: string): Promise<SkinsFile> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return defaultSkinsFile;
  }

  const parsed = parseSkins(raw);
  if (parsed !== null) return parsed;

  // If the backup cannot be made, the corrupt file is deliberately left in
  // place: overwriting it would destroy the only copy of the user's work.
  try {
    await fs.copyFile(filePath, `${filePath}.bak`);
  } catch (error) {
    console.warn(
      'md-view: could not back up corrupt skins file; leaving it untouched',
      filePath,
      (error as NodeJS.ErrnoException).code ?? error
    );
    return defaultSkinsFile;
  }

  try {
    await writeSkinsFile(filePath, defaultSkinsFile);
  } catch (error) {
    console.warn('md-view: could not rewrite corrupt skins file', filePath, (error as NodeJS.ErrnoException).code ?? error);
  }
  return defaultSkinsFile;
}

// #216: protective. Any read or schema failure discards only this read; never
// writes. The caller treats null as "ignore this event entirely".
export async function rereadSkinsOnFocus(filePath: string): Promise<SkinsFile | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  return parseSkins(raw);
}

// #221: existence check only, never a validity check. An existing file, even a
// corrupt one, is left completely untouched (the user may be mid-edit).
export async function ensureSkinsFileExists(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
    return;
  } catch {
    await writeSkinsFile(filePath, defaultSkinsFile);
  }
}

// D2 / #219: may a skin selection be persisted right now? True only if the
// file is missing or currently parses cleanly. Any other state (corrupt, or
// unreadable for another reason) means "do not write". Never writes itself.
export async function canPersistSkinChange(filePath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
  return parseSkins(raw) !== null;
}

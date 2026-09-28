import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseSettings, defaultSettingsFile } from './settings';
import type { SettingsFile } from './settings';
import { writeFileAtomic } from './atomicWriteFile';

// Task 47 (D3): atomic replace, so no reader (the focus re-read, an external
// editor, a test) can ever observe a truncated or partial settings.json.
// Still a throwing adapter: on Windows a rename over a target that another
// program holds open fails with EPERM once the short retry is exhausted, and
// callers contain that (index.ts, and the self-heal write below).
export async function writeSettingsFile(filePath: string, settings: SettingsFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, JSON.stringify(settings, null, 2));
}

// Self-healing (functional_domain.md guardrail #103): a missing file is not
// an error -- boot with defaults in memory and write nothing (guardrail
// #108). A file that reads but fails parseSettings is genuinely corrupt --
// there is no prior in-memory state to protect at startup, so overwrite it
// with valid defaults and return those same defaults.
export async function loadSettingsAtStartup(filePath: string): Promise<SettingsFile> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return defaultSettingsFile;
  }

  const parsed = parseSettings(raw);
  if (parsed !== null) return parsed;

  // Task 47 condition 3: a self-heal write that fails (e.g. EPERM because
  // another program holds settings.json open) is contained -- the app still
  // boots with defaults (#108); the corrupt file is simply left for now.
  try {
    await writeSettingsFile(filePath, defaultSettingsFile);
  } catch (error) {
    console.warn('md-view: could not rewrite corrupt settings file', filePath, (error as NodeJS.ErrnoException).code ?? error);
  }
  return defaultSettingsFile;
}

// Protective (functional_domain.md guardrail #103): unlike startup, there IS
// prior known-good in-memory state worth protecting here. Any read failure
// or schema failure discards only this read -- never writes, never touches
// memory/UI/disk. The caller treats null as "ignore this event entirely".
export async function rereadSettingsOnFocus(filePath: string): Promise<SettingsFile | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  return parseSettings(raw);
}

// Existence check only, never a validity check -- an existing-but-corrupt
// file is left completely untouched (the user may be mid-edit externally).
export async function ensureSettingsFileExists(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
    return;
  } catch {
    await writeSettingsFile(filePath, defaultSettingsFile);
  }
}

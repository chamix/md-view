import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseSettings, defaultSettingsFile } from './settings';
import type { SettingsFile } from './settings';

export async function writeSettingsFile(filePath: string, settings: SettingsFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf8');
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

  await writeSettingsFile(filePath, defaultSettingsFile);
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

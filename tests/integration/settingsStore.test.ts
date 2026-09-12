import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadSettingsAtStartup,
  rereadSettingsOnFocus,
  ensureSettingsFileExists,
  writeSettingsFile,
} from '../../src/main/settingsStore';
import { defaultSettingsFile, parseSettings } from '../../src/main/settings';

let tempDir: string;
let settingsFilePath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-settingsStore-'));
  settingsFilePath = path.join(tempDir, 'settings.json');
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('loadSettingsAtStartup', () => {
  it('returns defaults with no disk write when the file is missing entirely', async () => {
    const result = await loadSettingsAtStartup(settingsFilePath);

    expect(result).toEqual(defaultSettingsFile);
    expect(fs.existsSync(settingsFilePath)).toBe(false);
  });

  it('returns defaults AND rewrites the file to valid defaults when the on-disk content is not valid JSON at all', async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(settingsFilePath, '{ not valid json at all', 'utf8');

    const result = await loadSettingsAtStartup(settingsFilePath);

    expect(result).toEqual(defaultSettingsFile);

    const onDisk = fs.readFileSync(settingsFilePath, 'utf8');
    expect(parseSettings(onDisk)).toEqual(defaultSettingsFile);
  });

  // Distinct from the JSON-syntax-error case above: this content parses as
  // JSON fine but fails schema validation (wrong shape), the other half of
  // parseSettings' single pass/fail question -- exercises the
  // settingsSchema.safeParse branch specifically (fault-injection evidence
  // target), not just JSON.parse's own try/catch.
  it('returns defaults AND rewrites the file to valid defaults when the on-disk content is valid JSON but the wrong shape', async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(settingsFilePath, JSON.stringify({ View: { 'Dark Mode': 'not-a-boolean' } }), 'utf8');

    const result = await loadSettingsAtStartup(settingsFilePath);

    expect(result).toEqual(defaultSettingsFile);

    const onDisk = fs.readFileSync(settingsFilePath, 'utf8');
    expect(parseSettings(onDisk)).toEqual(defaultSettingsFile);
  });

  it('returns the parsed content unchanged when the file is already valid', async () => {
    const custom = { View: { 'Dark Mode': true, 'Show Frontmatter': false, 'Show File Tree': true } };
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(settingsFilePath, JSON.stringify(custom), 'utf8');

    const result = await loadSettingsAtStartup(settingsFilePath);

    expect(result).toEqual(custom);
  });
});

describe('rereadSettingsOnFocus', () => {
  it('returns null and never writes when the file is missing', async () => {
    const result = await rereadSettingsOnFocus(settingsFilePath);

    expect(result).toBeNull();
    expect(fs.existsSync(settingsFilePath)).toBe(false);
  });

  it('returns null AND leaves a corrupt (invalid JSON syntax) on-disk file byte-for-byte unchanged', async () => {
    const corruptContent = '{ still not valid json';
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(settingsFilePath, corruptContent, 'utf8');

    const result = await rereadSettingsOnFocus(settingsFilePath);

    expect(result).toBeNull();
    expect(fs.readFileSync(settingsFilePath, 'utf8')).toBe(corruptContent);
  });

  // Distinct from the JSON-syntax-error case above -- see the equivalent
  // comment on loadSettingsAtStartup's wrong-shape case. Exercises the
  // schema-validation branch, not just JSON.parse's try/catch.
  it('returns null AND leaves an on-disk file with a valid-JSON-but-wrong-shape byte-for-byte unchanged', async () => {
    const corruptContent = JSON.stringify({ View: { 'Dark Mode': 'not-a-boolean' } });
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(settingsFilePath, corruptContent, 'utf8');

    const result = await rereadSettingsOnFocus(settingsFilePath);

    expect(result).toBeNull();
    expect(fs.readFileSync(settingsFilePath, 'utf8')).toBe(corruptContent);
  });

  it('returns the parsed content when the file is valid', async () => {
    const custom = { View: { 'Dark Mode': true, 'Show Frontmatter': true, 'Show File Tree': false } };
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(settingsFilePath, JSON.stringify(custom), 'utf8');

    const result = await rereadSettingsOnFocus(settingsFilePath);

    expect(result).toEqual(custom);
  });
});

describe('ensureSettingsFileExists', () => {
  it('creates the file with defaults when it is absent', async () => {
    await ensureSettingsFileExists(settingsFilePath);

    expect(fs.existsSync(settingsFilePath)).toBe(true);
    const onDisk = fs.readFileSync(settingsFilePath, 'utf8');
    expect(parseSettings(onDisk)).toEqual(defaultSettingsFile);
  });

  it('leaves an existing, even corrupt, file completely untouched', async () => {
    const corruptContent = '{ this is corrupt';
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(settingsFilePath, corruptContent, 'utf8');

    await ensureSettingsFileExists(settingsFilePath);

    expect(fs.readFileSync(settingsFilePath, 'utf8')).toBe(corruptContent);
  });
});

describe('writeSettingsFile', () => {
  it('writes the full pretty-printed object and round-trips through parseSettings', async () => {
    const custom = { View: { 'Dark Mode': true, 'Show Frontmatter': false, 'Show File Tree': false } };

    await writeSettingsFile(settingsFilePath, custom);

    const onDisk = await fsp.readFile(settingsFilePath, 'utf8');
    expect(onDisk).toBe(JSON.stringify(custom, null, 2));
    expect(parseSettings(onDisk)).toEqual(custom);
  });

  it('creates any missing parent directories', async () => {
    const nestedPath = path.join(tempDir, 'nested', 'dir', 'settings.json');

    await writeSettingsFile(nestedPath, defaultSettingsFile);

    expect(fs.existsSync(nestedPath)).toBe(true);
  });
});

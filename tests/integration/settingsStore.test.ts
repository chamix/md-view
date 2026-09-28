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
import { vi } from 'vitest';

// Task 47 (D3): passthrough wrapper over the real fs/promises. Inert unless a
// Task 47 case flips `slowTruncatingWrite`, which makes writeFile truncate its
// target, wait, and only then write (the E4 technique: a widened truncate gap).
const task47 = vi.hoisted(() => ({ slowTruncatingWrite: false, gapMs: 200 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (task47.slowTruncatingWrite) {
        const handle = await actual.open(args[0] as string, 'w');
        await handle.close();
        await new Promise((resolve) => setTimeout(resolve, task47.gapMs));
      }
      return actual.writeFile(...args);
    },
  };
});

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

// Task 47 D3 (view-menu.spec.ts:189 / E4) and approval condition 3. Appended
// cases only; every case above is unchanged.
describe('Task 47: settings.json is replaced atomically', () => {
  const tmpFiles = () => fs.readdirSync(tempDir).filter((name) => name.endsWith('.tmp'));
  const custom = { View: { 'Dark Mode': true, 'Show Frontmatter': false, 'Show File Tree': true } };

  afterEach(() => {
    task47.slowTruncatingWrite = false;
    vi.restoreAllMocks();
  });

  it('a concurrent reader never observes an empty or unparsable settings.json while a slow write is in flight', async () => {
    fs.writeFileSync(settingsFilePath, JSON.stringify(defaultSettingsFile, null, 2), 'utf8');
    task47.slowTruncatingWrite = true;

    const observed: string[] = [];
    const reader = setInterval(() => {
      try {
        observed.push(fs.readFileSync(settingsFilePath, 'utf8'));
      } catch {
        // A transient open failure is not an observation of content.
      }
    }, 5);
    try {
      await writeSettingsFile(settingsFilePath, custom);
    } finally {
      clearInterval(reader);
    }

    // The reader really ran across the write's truncate gap.
    expect(observed.length).toBeGreaterThanOrEqual(10);
    const bad = observed.filter((content) => parseSettings(content) === null);
    expect(bad).toEqual([]);
    expect(parseSettings(fs.readFileSync(settingsFilePath, 'utf8'))).toEqual(custom);
    expect(tmpFiles()).toEqual([]);
  });

  // Condition 3 (c): on Windows any open handle on the target makes the
  // rename fail with EPERM. The short retry runs out, the adapter rejects,
  // the target keeps its old bytes and no temp file is left behind.
  it.runIf(process.platform === 'win32')(
    'rejects with EPERM after the retries while another handle holds the target, leaving it unchanged and no *.tmp (condition 3c)',
    async () => {
      const before = JSON.stringify(defaultSettingsFile, null, 2);
      fs.writeFileSync(settingsFilePath, before, 'utf8');
      const fd = fs.openSync(settingsFilePath, 'r');
      try {
        await expect(writeSettingsFile(settingsFilePath, custom)).rejects.toMatchObject({ code: 'EPERM' });
      } finally {
        fs.closeSync(fd);
      }
      expect(fs.readFileSync(settingsFilePath, 'utf8')).toBe(before);
      expect(tmpFiles()).toEqual([]);
    }
  );

  it('succeeds when the holding handle is released mid-retry (condition 3c)', async () => {
    fs.writeFileSync(settingsFilePath, JSON.stringify(defaultSettingsFile, null, 2), 'utf8');
    const fd = fs.openSync(settingsFilePath, 'r');
    const release = setTimeout(() => fs.closeSync(fd), 30);
    try {
      await writeSettingsFile(settingsFilePath, custom);
    } finally {
      clearTimeout(release);
      try {
        fs.closeSync(fd);
      } catch {
        // Already released by the timer.
      }
    }
    expect(parseSettings(fs.readFileSync(settingsFilePath, 'utf8'))).toEqual(custom);
    expect(tmpFiles()).toEqual([]);
  });

  // Condition 3 (d): the startup self-heal write is contained. A corrupt
  // file that cannot be replaced still boots with defaults (#108).
  it('loadSettingsAtStartup resolves to defaults, with a warning, when a corrupt settings.json is held open (condition 3d)', async () => {
    const corrupt = '{ corrupt and held';
    fs.writeFileSync(settingsFilePath, corrupt, 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fd = fs.openSync(settingsFilePath, 'r');
    let result: unknown;
    try {
      result = await loadSettingsAtStartup(settingsFilePath);
    } finally {
      fs.closeSync(fd);
    }
    expect(result).toEqual(defaultSettingsFile);
    if (process.platform === 'win32') {
      // The rename could not happen: the corrupt bytes are still there, the
      // failure was reported, and no temp file was left behind.
      expect(fs.readFileSync(settingsFilePath, 'utf8')).toBe(corrupt);
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0].join(' '))).toContain(settingsFilePath);
    }
    expect(tmpFiles()).toEqual([]);
  });
});

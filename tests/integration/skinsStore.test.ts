import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadSkinsAtStartup,
  rereadSkinsOnFocus,
  ensureSkinsFileExists,
  writeSkinsFile,
  canPersistSkinChange,
} from '../../src/main/skinsStore';
import { defaultSkinsFile, parseSkins } from '../../src/main/skins';
import type { SkinsFile } from '../../src/main/skins';

// Task 51a (functional_domain.md #214-#216, #219, #221; approval conditions D1/D2).
// Real temp dirs, real fs.

let tempDir: string;
let skinsFilePath: string;
let bakPath: string;

const TOKENS = [
  '--color-bg-page',
  '--color-bg-chrome',
  '--color-border',
  '--color-text-primary',
  '--color-text-muted',
  '--color-text-disabled',
  '--color-border-disabled',
  '--color-text-error',
  '--color-bg-hover',
  '--color-tab-hover-bg',
  '--color-accent',
  '--color-bg-accent',
  '--color-bg-accent-hover',
  '--color-tab-active',
  '--color-close-hover-bg',
  '--color-close-hover-glyph',
];
const half = (v: string) => Object.fromEntries(TOKENS.map((t) => [t, v]));
const customFile = (): SkinsFile =>
  ({
    activeSkin: 'Mine',
    customSkins: { Mine: { light: half('#abcdef'), dark: half('#123456') } },
  }) as SkinsFile;

const tmpFiles = () => fs.readdirSync(tempDir).filter((n) => n.endsWith('.tmp'));

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-skinsStore-'));
  skinsFilePath = path.join(tempDir, 'skins.json');
  bakPath = `${skinsFilePath}.bak`;
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('writeSkinsFile', () => {
  it('writes pretty-printed JSON and round-trips through parseSkins', async () => {
    const file = customFile();
    await writeSkinsFile(skinsFilePath, file);

    const onDisk = await fsp.readFile(skinsFilePath, 'utf8');
    expect(onDisk).toBe(JSON.stringify(file, null, 2));
    expect(parseSkins(onDisk)).toEqual(file);
    expect(tmpFiles()).toEqual([]);
  });

  it('creates any missing parent directories', async () => {
    const nested = path.join(tempDir, 'a', 'b', 'skins.json');
    await writeSkinsFile(nested, defaultSkinsFile);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('replaces atomically: a concurrent reader never sees an unparsable file', async () => {
    await writeSkinsFile(skinsFilePath, defaultSkinsFile);
    const observed: string[] = [];
    const reader = setInterval(() => {
      try {
        observed.push(fs.readFileSync(skinsFilePath, 'utf8'));
      } catch {
        // transient open failure is not an observation
      }
    }, 5);
    // On Windows an open reader handle can transiently block the rename; if the
    // short retry in writeFileAtomic is exhausted it rethrows EPERM/EBUSY/EACCES
    // (documented, contained by real callers). That is tolerated here ONLY for
    // the writer; the property under test is about what the reader observes.
    let succeeded = 0;
    try {
      for (let i = 0; i < 3; i++) {
        try {
          await writeSkinsFile(skinsFilePath, i % 2 ? customFile() : defaultSkinsFile);
          succeeded++;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 12));
      }
    } finally {
      clearInterval(reader);
    }
    expect(succeeded).toBeGreaterThan(0);
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.filter((c) => parseSkins(c) === null)).toEqual([]);
    expect(parseSkins(fs.readFileSync(skinsFilePath, 'utf8'))).not.toBeNull();
    expect(tmpFiles()).toEqual([]);
  });
});

describe('loadSkinsAtStartup', () => {
  it('missing file: returns defaults and writes nothing (#214)', async () => {
    const result = await loadSkinsAtStartup(skinsFilePath);

    expect(result).toEqual(defaultSkinsFile);
    expect(fs.existsSync(skinsFilePath)).toBe(false);
    expect(fs.existsSync(bakPath)).toBe(false);
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });

  it('valid file: returns the parsed content and writes no backup', async () => {
    const file = customFile();
    fs.writeFileSync(skinsFilePath, JSON.stringify(file), 'utf8');

    expect(await loadSkinsAtStartup(skinsFilePath)).toEqual(file);
    expect(fs.existsSync(bakPath)).toBe(false);
    expect(fs.readFileSync(skinsFilePath, 'utf8')).toBe(JSON.stringify(file));
  });

  it('valid file with an unknown activeSkin is returned as written (#217 resolves later)', async () => {
    const raw = JSON.stringify({ activeSkin: 'Nope', customSkins: {} });
    fs.writeFileSync(skinsFilePath, raw, 'utf8');
    expect(await loadSkinsAtStartup(skinsFilePath)).toEqual({ activeSkin: 'Nope', customSkins: {} });
    expect(fs.readFileSync(skinsFilePath, 'utf8')).toBe(raw);
  });

  it('corrupt (invalid JSON): heals to defaults AND .bak holds the original bytes exactly (#215, D1)', async () => {
    const corrupt = '{ not valid json é \r\n tail';
    fs.writeFileSync(skinsFilePath, corrupt, 'utf8');

    const result = await loadSkinsAtStartup(skinsFilePath);

    expect(result).toEqual(defaultSkinsFile);
    expect(parseSkins(fs.readFileSync(skinsFilePath, 'utf8'))).toEqual(defaultSkinsFile);
    expect(fs.readFileSync(bakPath)).toEqual(Buffer.from(corrupt, 'utf8'));
  });

  it('corrupt (valid JSON, wrong shape): heals AND preserves the user-authored skins in .bak', async () => {
    // A hand-edit with one bad color: the whole file is rejected, but the
    // user's other work must survive in the backup.
    const bad = {
      activeSkin: 'Mine',
      customSkins: { Mine: { light: half('#abcdef'), dark: { ...half('#123456'), '--color-accent': 'red' } } },
    };
    const raw = JSON.stringify(bad, null, 2);
    fs.writeFileSync(skinsFilePath, raw, 'utf8');

    const result = await loadSkinsAtStartup(skinsFilePath);

    expect(result).toEqual(defaultSkinsFile);
    expect(parseSkins(fs.readFileSync(skinsFilePath, 'utf8'))).toEqual(defaultSkinsFile);
    expect(fs.readFileSync(bakPath, 'utf8')).toBe(raw);
  });

  it('corrupt with invalid UTF-8 bytes: .bak is a byte-exact copy', async () => {
    const bytes = Buffer.from([0x7b, 0xff, 0xfe, 0x80, 0x00, 0x7d]);
    fs.writeFileSync(skinsFilePath, bytes);

    expect(await loadSkinsAtStartup(skinsFilePath)).toEqual(defaultSkinsFile);
    expect(fs.readFileSync(bakPath)).toEqual(bytes);
  });

  it('a second corrupt launch replaces the stale .bak with the newer original', async () => {
    fs.writeFileSync(skinsFilePath, '{ first', 'utf8');
    await loadSkinsAtStartup(skinsFilePath);
    fs.writeFileSync(skinsFilePath, '{ second', 'utf8');
    await loadSkinsAtStartup(skinsFilePath);
    expect(fs.readFileSync(bakPath, 'utf8')).toBe('{ second');
  });

  it('contained backup failure: boots on defaults, warns, and does NOT overwrite the corrupt file it could not back up', async () => {
    const corrupt = '{ precious but broken';
    fs.writeFileSync(skinsFilePath, corrupt, 'utf8');
    fs.mkdirSync(bakPath); // a directory squatting on the .bak path makes the copy fail
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadSkinsAtStartup(skinsFilePath);

    expect(result).toEqual(defaultSkinsFile);
    expect(fs.readFileSync(skinsFilePath, 'utf8')).toBe(corrupt);
    expect(warn).toHaveBeenCalled();
    expect(tmpFiles()).toEqual([]);
  });

  it.runIf(process.platform === 'win32')(
    'contained heal-write failure (file held open): boots on defaults with a warning; backup still made; no *.tmp',
    async () => {
      const corrupt = '{ corrupt and held';
      fs.writeFileSync(skinsFilePath, corrupt, 'utf8');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fd = fs.openSync(skinsFilePath, 'r');
      let result: unknown;
      try {
        result = await loadSkinsAtStartup(skinsFilePath);
      } finally {
        fs.closeSync(fd);
      }
      expect(result).toEqual(defaultSkinsFile);
      expect(fs.readFileSync(skinsFilePath, 'utf8')).toBe(corrupt);
      expect(fs.readFileSync(bakPath, 'utf8')).toBe(corrupt);
      expect(warn).toHaveBeenCalled();
      expect(tmpFiles()).toEqual([]);
    }
  );

  it('an unreadable path (a directory) boots on defaults and writes nothing', async () => {
    fs.mkdirSync(skinsFilePath);
    expect(await loadSkinsAtStartup(skinsFilePath)).toEqual(defaultSkinsFile);
    expect(fs.statSync(skinsFilePath).isDirectory()).toBe(true);
    expect(fs.existsSync(bakPath)).toBe(false);
  });
});

describe('rereadSkinsOnFocus (#216)', () => {
  it('missing: returns null and never creates anything', async () => {
    expect(await rereadSkinsOnFocus(skinsFilePath)).toBeNull();
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });

  it('corrupt JSON: returns null, file byte-identical, no .bak', async () => {
    const corrupt = '{ still not valid json';
    fs.writeFileSync(skinsFilePath, corrupt, 'utf8');
    expect(await rereadSkinsOnFocus(skinsFilePath)).toBeNull();
    expect(fs.readFileSync(skinsFilePath, 'utf8')).toBe(corrupt);
    expect(fs.existsSync(bakPath)).toBe(false);
  });

  it('wrong shape: returns null, file byte-identical, no .bak', async () => {
    const wrong = JSON.stringify({ activeSkin: 'Default', customSkins: { Mine: { light: half('#fff') } } });
    fs.writeFileSync(skinsFilePath, wrong, 'utf8');
    expect(await rereadSkinsOnFocus(skinsFilePath)).toBeNull();
    expect(fs.readFileSync(skinsFilePath, 'utf8')).toBe(wrong);
    expect(fs.existsSync(bakPath)).toBe(false);
  });

  it('partial (truncated mid-write) content: returns null, file untouched', async () => {
    const full = JSON.stringify(customFile(), null, 2);
    const partial = full.slice(0, Math.floor(full.length / 2));
    fs.writeFileSync(skinsFilePath, partial, 'utf8');
    expect(await rereadSkinsOnFocus(skinsFilePath)).toBeNull();
    expect(fs.readFileSync(skinsFilePath, 'utf8')).toBe(partial);
  });

  it('empty file: returns null, file untouched', async () => {
    fs.writeFileSync(skinsFilePath, '', 'utf8');
    expect(await rereadSkinsOnFocus(skinsFilePath)).toBeNull();
    expect(fs.readFileSync(skinsFilePath, 'utf8')).toBe('');
  });

  it('an unreadable path (a directory): returns null', async () => {
    fs.mkdirSync(skinsFilePath);
    expect(await rereadSkinsOnFocus(skinsFilePath)).toBeNull();
  });

  it('valid: returns the parsed content and does not rewrite the file', async () => {
    const raw = JSON.stringify(customFile());
    fs.writeFileSync(skinsFilePath, raw, 'utf8');
    expect(await rereadSkinsOnFocus(skinsFilePath)).toEqual(customFile());
    expect(fs.readFileSync(skinsFilePath, 'utf8')).toBe(raw);
  });
});

describe('ensureSkinsFileExists (#221)', () => {
  it('creates the file with valid defaults when absent', async () => {
    await ensureSkinsFileExists(skinsFilePath);
    expect(parseSkins(fs.readFileSync(skinsFilePath, 'utf8'))).toEqual(defaultSkinsFile);
  });

  it('creates missing parent directories', async () => {
    const nested = path.join(tempDir, 'x', 'skins.json');
    await ensureSkinsFileExists(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('leaves an existing corrupt file byte-identical (and makes no .bak)', async () => {
    const corrupt = '{ this is corrupt é';
    fs.writeFileSync(skinsFilePath, corrupt, 'utf8');
    await ensureSkinsFileExists(skinsFilePath);
    expect(fs.readFileSync(skinsFilePath, 'utf8')).toBe(corrupt);
    expect(fs.existsSync(bakPath)).toBe(false);
  });

  it('leaves an existing valid file byte-identical', async () => {
    const raw = JSON.stringify(customFile());
    fs.writeFileSync(skinsFilePath, raw, 'utf8');
    await ensureSkinsFileExists(skinsFilePath);
    expect(fs.readFileSync(skinsFilePath, 'utf8')).toBe(raw);
  });
});

describe('canPersistSkinChange (D2 / #219)', () => {
  it('true when the file is missing, and never creates it', async () => {
    expect(await canPersistSkinChange(skinsFilePath)).toBe(true);
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });

  it('true when the file parses cleanly, and never rewrites it', async () => {
    const raw = JSON.stringify(customFile());
    fs.writeFileSync(skinsFilePath, raw, 'utf8');
    expect(await canPersistSkinChange(skinsFilePath)).toBe(true);
    expect(fs.readFileSync(skinsFilePath, 'utf8')).toBe(raw);
  });

  it('false when the file exists but is not valid JSON, and never touches it', async () => {
    const corrupt = '{ hand edit in progress';
    fs.writeFileSync(skinsFilePath, corrupt, 'utf8');
    expect(await canPersistSkinChange(skinsFilePath)).toBe(false);
    expect(fs.readFileSync(skinsFilePath, 'utf8')).toBe(corrupt);
    expect(fs.existsSync(bakPath)).toBe(false);
  });

  it('false when the file is valid JSON of the wrong shape, and never touches it', async () => {
    const wrong = JSON.stringify({ activeSkin: 'Default' });
    fs.writeFileSync(skinsFilePath, wrong, 'utf8');
    expect(await canPersistSkinChange(skinsFilePath)).toBe(false);
    expect(fs.readFileSync(skinsFilePath, 'utf8')).toBe(wrong);
  });

  it('false when the path exists but cannot be read as a file (a directory)', async () => {
    fs.mkdirSync(skinsFilePath);
    expect(await canPersistSkinChange(skinsFilePath)).toBe(false);
  });
});

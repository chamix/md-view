import { describe, it, expect } from 'vitest';
import {
  parseSettings,
  defaultSettingsFile,
  toPersistedViewSettings,
  fromViewSettings,
  isSafeFontName,
} from '../../src/main/settings';
import type { SettingsFile } from '../../src/main/settings';

// Task 55 (functional_domain.md #52-#58): base View object shared by every
// test below that needs a fully-shaped, valid 'View' object -- keeps each
// test's override minimal and visible.
const BASE_VIEW = {
  'Dark Mode': true,
  'Show Frontmatter': false,
  'Show File Tree': true,
  'UI Font': '',
  'Code Font': '',
};

describe('parseSettings (pure JSON+schema validation)', () => {
  it('returns the parsed object for valid input', () => {
    const raw = JSON.stringify({ View: BASE_VIEW });

    const result = parseSettings(raw);

    expect(result).toEqual({ View: BASE_VIEW });
  });

  it('returns null for a string that is not valid JSON at all', () => {
    const result = parseSettings('{ this is not json');
    expect(result).toBeNull();
  });

  it('returns null for valid JSON with the wrong value types', () => {
    const raw = JSON.stringify({
      View: { ...BASE_VIEW, 'Dark Mode': 'yes' },
    });

    const result = parseSettings(raw);
    expect(result).toBeNull();
  });

  it('returns null for valid JSON missing a required key', () => {
    const raw = JSON.stringify({
      View: { 'Dark Mode': true, 'Show Frontmatter': true, 'UI Font': '', 'Code Font': '' },
    });

    const result = parseSettings(raw);
    expect(result).toBeNull();
  });

  it('returns null for valid JSON with an extra/unknown key', () => {
    const raw = JSON.stringify({
      View: {
        ...BASE_VIEW,
        'Extra Unknown Key': true,
      },
    });

    const result = parseSettings(raw);
    expect(result).toBeNull();
  });
});

describe('defaultSettingsFile', () => {
  it('matches the confirmed v1 defaults (Dark Mode false, Show Frontmatter true, Show File Tree true, UI Font "", Code Font "")', () => {
    expect(defaultSettingsFile).toEqual({
      View: {
        'Dark Mode': false,
        'Show Frontmatter': true,
        'Show File Tree': true,
        'UI Font': '',
        'Code Font': '',
      },
    });
  });
});

describe('toPersistedViewSettings / fromViewSettings (symmetric mapping)', () => {
  it('round-trips a SettingsFile -> ViewSettings fields -> SettingsFile unchanged', () => {
    const file: SettingsFile = {
      View: { ...BASE_VIEW, 'UI Font': 'Fira Sans', 'Code Font': 'Fira Code' },
    };

    const viewSettings = toPersistedViewSettings(file);
    expect(viewSettings).toEqual({
      darkMode: true,
      showFrontmatter: false,
      showTreePanel: true,
      uiFontFamily: 'Fira Sans',
      codeFontFamily: 'Fira Code',
    });

    const roundTripped = fromViewSettings(viewSettings);
    expect(roundTripped).toEqual(file);
  });

  it('round-trips the default SettingsFile', () => {
    const viewSettings = toPersistedViewSettings(defaultSettingsFile);
    const roundTripped = fromViewSettings(viewSettings);
    expect(roundTripped).toEqual(defaultSettingsFile);
  });
});

// Task 55 (functional_domain.md #52-#58, #211-posture parity with
// isSafeColorValue): closed-grammar denylist, not a hand-picked allowlist.
describe('isSafeFontName', () => {
  it('accepts the empty string (meaningful "unset" value, not a failure)', () => {
    expect(isSafeFontName('')).toBe(true);
  });

  it.each(['Fira Sans', 'Fira Code', 'Comic Sans MS', 'Noto Sans', 'Consolas', 'Ubuntu Mono', 'A'.repeat(80)])(
    'accepts %s',
    (name) => {
      expect(isSafeFontName(name)).toBe(true);
    }
  );

  it.each([
    "Fira'Sans",
    'Fira"Sans',
    'Fira\\Sans',
    'Fira;Sans',
    'Fira(Sans)',
    'Fira)Sans(',
    'Fira<Sans>',
    'Fira{Sans}',
    'Fira\nSans',
    'Fira\tSans',
    'A'.repeat(81),
  ])('rejects %j', (name) => {
    expect(isSafeFontName(name)).toBe(false);
  });

  it('rejects non-strings', () => {
    for (const v of [undefined, null, 5, {}, ['Fira Sans']]) {
      expect(isSafeFontName(v as unknown as string)).toBe(false);
    }
  });
});

describe('whole-file pass/fail collapse on an invalid font value (guardrail #1, confirmed not assumed)', () => {
  it('fails the entire settings.json parse (null) on an unsafe UI Font value, identical to an invalid Dark Mode value', () => {
    const raw = JSON.stringify({
      View: { ...BASE_VIEW, 'UI Font': 'Fira; Sans' },
    });

    expect(parseSettings(raw)).toBeNull();
  });

  it('fails the entire settings.json parse (null) on an unsafe Code Font value', () => {
    const raw = JSON.stringify({
      View: { ...BASE_VIEW, 'Code Font': 'url(evil)' },
    });

    expect(parseSettings(raw)).toBeNull();
  });

  it('fails the entire settings.json parse (null) on a too-long font value', () => {
    const raw = JSON.stringify({
      View: { ...BASE_VIEW, 'UI Font': 'A'.repeat(81) },
    });

    expect(parseSettings(raw)).toBeNull();
  });
});

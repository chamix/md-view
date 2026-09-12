import { describe, it, expect } from 'vitest';
import {
  parseSettings,
  defaultSettingsFile,
  toPersistedViewSettings,
  fromViewSettings,
} from '../../src/main/settings';
import type { SettingsFile } from '../../src/main/settings';

describe('parseSettings (pure JSON+schema validation)', () => {
  it('returns the parsed object for valid input', () => {
    const raw = JSON.stringify({
      View: { 'Dark Mode': true, 'Show Frontmatter': false, 'Show File Tree': true },
    });

    const result = parseSettings(raw);

    expect(result).toEqual({
      View: { 'Dark Mode': true, 'Show Frontmatter': false, 'Show File Tree': true },
    });
  });

  it('returns null for a string that is not valid JSON at all', () => {
    const result = parseSettings('{ this is not json');
    expect(result).toBeNull();
  });

  it('returns null for valid JSON with the wrong value types', () => {
    const raw = JSON.stringify({
      View: { 'Dark Mode': 'yes', 'Show Frontmatter': true, 'Show File Tree': true },
    });

    const result = parseSettings(raw);
    expect(result).toBeNull();
  });

  it('returns null for valid JSON missing a required key', () => {
    const raw = JSON.stringify({
      View: { 'Dark Mode': true, 'Show Frontmatter': true },
    });

    const result = parseSettings(raw);
    expect(result).toBeNull();
  });

  it('returns null for valid JSON with an extra/unknown key', () => {
    const raw = JSON.stringify({
      View: {
        'Dark Mode': true,
        'Show Frontmatter': true,
        'Show File Tree': true,
        'Extra Unknown Key': true,
      },
    });

    const result = parseSettings(raw);
    expect(result).toBeNull();
  });
});

describe('defaultSettingsFile', () => {
  it('matches the confirmed v1 defaults (Dark Mode false, Show Frontmatter true, Show File Tree true)', () => {
    expect(defaultSettingsFile).toEqual({
      View: { 'Dark Mode': false, 'Show Frontmatter': true, 'Show File Tree': true },
    });
  });
});

describe('toPersistedViewSettings / fromViewSettings (symmetric mapping)', () => {
  it('round-trips a SettingsFile -> ViewSettings fields -> SettingsFile unchanged', () => {
    const file: SettingsFile = {
      View: { 'Dark Mode': true, 'Show Frontmatter': false, 'Show File Tree': true },
    };

    const viewSettings = toPersistedViewSettings(file);
    expect(viewSettings).toEqual({ darkMode: true, showFrontmatter: false, showTreePanel: true });

    const roundTripped = fromViewSettings(viewSettings);
    expect(roundTripped).toEqual(file);
  });

  it('round-trips the default SettingsFile', () => {
    const viewSettings = toPersistedViewSettings(defaultSettingsFile);
    const roundTripped = fromViewSettings(viewSettings);
    expect(roundTripped).toEqual(defaultSettingsFile);
  });
});

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  SKIN_TOKEN_NAMES,
  SYNTAX_THEME_ALLOWLIST,
  isSafeColorValue,
  isValidCustomSkinName,
  parseSkins,
  defaultSkinsFile,
  resolveSkin,
  listSkinNames,
  toSkinPayload,
} from '../../src/main/skins';
import type { SkinColors, SkinsFile, ResolvedSkin } from '../../src/main/skins';
import { BUILT_IN_SKINS } from '../../src/main/skinPresets';

// Task 51a (functional_domain.md #211-#218, #222, #227). Pure core only.

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

function half(value = '#123456'): Record<string, string> {
  return Object.fromEntries(TOKENS.map((t) => [t, value]));
}
function colors(): SkinColors {
  return { light: half('#abcdef'), dark: half('#123456') } as SkinColors;
}
function fileWith(customSkins: Record<string, unknown>, activeSkin = 'Default'): string {
  return JSON.stringify({ activeSkin, customSkins });
}

describe('SKIN_TOKEN_NAMES', () => {
  it('is exactly the 16 chrome tokens, in app.css order', () => {
    expect([...SKIN_TOKEN_NAMES]).toEqual(TOKENS);
  });
});

describe('isSafeColorValue: accepted grammar (#211)', () => {
  it.each([
    '#abc',
    '#ABC',
    '#aBc',
    '#abcd',
    '#aabbcc',
    '#AABBCC',
    '#aabbccdd',
    '#AaBbCcDd',
    'rgb(0,0,0)',
    'rgb(255, 255, 255)',
    'rgb(0,   128,  255)',
    'rgba(0,0,0,0)',
    'rgba(0,0,0,1)',
    'rgba(208, 215, 222, 0.32)',
    'rgba(61,57,41,0.08)',
    'rgba(1, 2, 3, .5)',
    'rgba(1, 2, 3, 1.0)',
    'transparent',
  ])('accepts %s', (value) => {
    expect(isSafeColorValue(value)).toBe(true);
  });
});

describe('isSafeColorValue: injection / malformed table (#211)', () => {
  it.each([
    ['declaration smuggling', 'red; background:url(x)'],
    ['declaration smuggling after valid', '#fff; background:url(x)'],
    ['var()', 'var(--x)'],
    ['var() with fallback', 'var(--x, #fff)'],
    ['url()', 'url(http://x)'],
    ['url() in rgb', 'rgb(url(x),0,0)'],
    ['rgb without commas', 'rgb(0 0 0)'],
    ['rgb slash alpha', 'rgb(0 0 0 / 50%)'],
    ['rgb red over 255', 'rgb(256,0,0)'],
    ['rgb negative', 'rgb(-1,0,0)'],
    ['rgb percent', 'rgb(10%,0,0)'],
    ['rgb with 4 components', 'rgb(0,0,0,1)'],
    ['rgba with 3 components', 'rgba(0,0,0)'],
    ['rgba alpha over 1', 'rgba(0,0,0,1.5)'],
    ['rgba alpha negative', 'rgba(0,0,0,-0.1)'],
    ['rgba alpha 2', 'rgba(0,0,0,2)'],
    ['rgba unclosed', 'rgba(0,0,0,1'],
    ['rgba extra paren', 'rgba(0,0,0,1))'],
    ['rgba uppercase function', 'RGBA(0,0,0,1)'],
    ['space before comma', 'rgb(0 ,0,0)'],
    ['leading space in parens', 'rgb( 0,0,0)'],
    ['trailing space', '#fff '],
    ['leading space', ' #fff'],
    ['trailing newline', '#fff\n'],
    ['trailing newline after rgb', 'rgb(0,0,0)\n'],
    ['embedded newline', '#ff\nf'],
    ['trailing semicolon', '#fff;'],
    ['trailing !important', '#fff !important'],
    ['trailing junk', '#fffzzz'],
    ['9-digit hex', '#aabbccdde'],
    ['7-digit hex', '#aabbccd'],
    ['5-digit hex', '#aabbc'],
    ['2-digit hex', '#12'],
    ['1-digit hex', '#1'],
    ['bare hash', '#'],
    ['non-hex digits', '#ggg'],
    ['hex without hash', 'aabbcc'],
    ['expression()', 'expression(alert(1))'],
    ['hsl()', 'hsl(0, 0%, 0%)'],
    ['named color', 'red'],
    ['inherit', 'inherit'],
    ['currentcolor', 'currentcolor'],
    ['capitalised transparent (pinned: lowercase only)', 'Transparent'],
    ['uppercase transparent', 'TRANSPARENT'],
    ['empty', ''],
    ['whitespace only', '   '],
    ['comment injection', '#fff/**/'],
    ['nul byte', '#fff\u0000'],
  ])('rejects %s', (_label, value) => {
    expect(isSafeColorValue(value)).toBe(false);
  });

  it('rejects non-string input', () => {
    for (const v of [undefined, null, 0, 1, true, {}, [], ['#fff']]) {
      expect(isSafeColorValue(v as unknown as string)).toBe(false);
    }
  });
});

describe('SYNTAX_THEME_ALLOWLIST', () => {
  it('is exactly the 8 bundled theme filenames', () => {
    expect([...SYNTAX_THEME_ALLOWLIST].sort()).toEqual(
      [
        'atom-one-dark.css',
        'atom-one-light.css',
        'github-dark.css',
        'github.css',
        'obsidian.css',
        'stackoverflow-light.css',
        'tokyo-night-dark.css',
        'tokyo-night-light.css',
      ].sort()
    );
  });
});

describe('isValidCustomSkinName (#218)', () => {
  it.each(['My Skin', 'a', 'x'.repeat(40), 'Sólo Ünïcode', 'Default 2', 'Tokyo Night!'])('accepts %j', (n) => {
    expect(isValidCustomSkinName(n)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['41 chars', 'x'.repeat(41)],
    ['leading space', ' My Skin'],
    ['trailing space', 'My Skin '],
    ['whitespace only', '   '],
    ['newline', 'My\nSkin'],
    ['tab', 'My\tSkin'],
    ['NUL', 'My\u0000Skin'],
    ['DEL', 'My\u007fSkin'],
    ['C1 control', 'My\u0085Skin'],
    ['line separator', 'My Skin'],
    ['built-in Default', 'Default'],
    ['built-in lowercase', 'default'],
    ['built-in Claude uppercase', 'CLAUDE'],
    ['built-in mixed case', 'oBsIdIaN'],
    ['built-in with space', 'tokyo night'],
  ])('rejects %s', (_label, name) => {
    expect(isValidCustomSkinName(name)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidCustomSkinName(5 as unknown as string)).toBe(false);
  });
});

describe('parseSkins (#104 posture, strict schema)', () => {
  it('parses a valid file with no custom skins', () => {
    expect(parseSkins(fileWith({}))).toEqual({ activeSkin: 'Default', customSkins: {} });
  });

  it('parses a valid file with custom skins, preserving file order', () => {
    const raw = fileWith({ Zeta: colors(), Alpha: colors() }, 'Zeta');
    const result = parseSkins(raw);
    expect(result).not.toBeNull();
    expect(result!.activeSkin).toBe('Zeta');
    expect(Object.keys(result!.customSkins)).toEqual(['Zeta', 'Alpha']);
    expect(result!.customSkins.Zeta).toEqual(colors());
  });

  it('accepts an activeSkin that names nothing (resolved later, #217)', () => {
    expect(parseSkins(fileWith({}, 'Nope'))).toEqual({ activeSkin: 'Nope', customSkins: {} });
  });

  it('returns null for invalid JSON', () => {
    expect(parseSkins('{ nope')).toBeNull();
    expect(parseSkins('')).toBeNull();
  });

  it.each([
    ['null', 'null'],
    ['array', '[]'],
    ['string', '"x"'],
    ['empty object', '{}'],
    ['missing customSkins', JSON.stringify({ activeSkin: 'Default' })],
    ['missing activeSkin', JSON.stringify({ customSkins: {} })],
    ['activeSkin wrong type', JSON.stringify({ activeSkin: 3, customSkins: {} })],
    ['customSkins wrong type', JSON.stringify({ activeSkin: 'Default', customSkins: [] })],
    ['extra top-level key', JSON.stringify({ activeSkin: 'Default', customSkins: {}, 'Dark Mode': true })],
  ])('returns null for %s', (_label, raw) => {
    expect(parseSkins(raw)).toBeNull();
  });

  it('returns null when a skin is light-only', () => {
    expect(parseSkins(fileWith({ Mine: { light: half() } }))).toBeNull();
  });

  it('returns null when a skin is dark-only', () => {
    expect(parseSkins(fileWith({ Mine: { dark: half() } }))).toBeNull();
  });

  it('returns null for an extra key on a skin', () => {
    expect(parseSkins(fileWith({ Mine: { ...colors(), syntax: { light: 'github.css', dark: 'github-dark.css' } } }))).toBeNull();
  });

  it('returns null when a half is missing a token', () => {
    const l = half();
    delete l['--color-accent'];
    expect(parseSkins(fileWith({ Mine: { light: l, dark: half() } }))).toBeNull();
  });

  it('returns null when a half has an extra token', () => {
    expect(parseSkins(fileWith({ Mine: { light: { ...half(), '--color-evil': '#fff' }, dark: half() } }))).toBeNull();
  });

  it('returns null when a token value is not a string', () => {
    expect(parseSkins(fileWith({ Mine: { light: { ...half(), '--color-accent': 5 }, dark: half() } }))).toBeNull();
  });

  it('returns null when ANY color in a custom skin fails the validator (whole-file failure)', () => {
    const bad = { light: { ...half(), '--color-accent': 'red; background:url(x)' }, dark: half() };
    expect(parseSkins(fileWith({ Good: colors(), Bad: bad }))).toBeNull();
  });

  it('returns null when a custom name violates the name rules', () => {
    expect(parseSkins(fileWith({ '': colors() }))).toBeNull();
    expect(parseSkins(fileWith({ ' padded ': colors() }))).toBeNull();
    expect(parseSkins(fileWith({ ['x'.repeat(41)]: colors() }))).toBeNull();
    expect(parseSkins(fileWith({ 'a\nb': colors() }))).toBeNull();
    expect(parseSkins(fileWith({ default: colors() }))).toBeNull();
    expect(parseSkins(fileWith({ 'Tokyo Night': colors() }))).toBeNull();
  });

  it('does not pollute prototypes through a __proto__ custom skin name', () => {
    const raw = `{"activeSkin":"Default","customSkins":{"__proto__":${JSON.stringify(colors())}}}`;
    const result = parseSkins(raw);
    // Actual (zod 3.25 record) behavior: the __proto__ key is dropped, the rest
    // of the file is accepted, and nothing leaks onto any prototype.
    expect(result).toEqual({ activeSkin: 'Default', customSkins: {} });
    expect(Object.keys(result!.customSkins)).toEqual([]);
    expect(Object.getPrototypeOf(result!.customSkins)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).light).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'light')).toBe(false);
    expect(resolveSkin(result!, '__proto__').name).toBe('Default');
  });

  it('accepts leading-zero numeric components (documented grammar: 1-3 digit r/g/b, up to 6 alpha digits)', () => {
    expect(isSafeColorValue('rgb(001,0,0)')).toBe(true);
    expect(isSafeColorValue('rgba(0,0,0,000001)')).toBe(true);
  });
});

describe('defaultSkinsFile', () => {
  it('is Default active with no custom skins', () => {
    expect(defaultSkinsFile).toEqual({ activeSkin: 'Default', customSkins: {} });
  });
});

describe('resolveSkin (#217)', () => {
  const file: SkinsFile = { activeSkin: 'Mine', customSkins: { Mine: colors() } };
  const def = BUILT_IN_SKINS.find((s) => s.name === 'Default')!;

  it('resolves each built-in to its preset (palette and syntax)', () => {
    for (const preset of BUILT_IN_SKINS) {
      const r = resolveSkin(file, preset.name);
      expect(r.name).toBe(preset.name);
      expect(r.palette).toEqual(preset.palette);
      expect(r.syntax).toEqual(preset.syntax);
    }
  });

  it('resolves a custom skin to its colors with the Default syntax pair', () => {
    const r = resolveSkin(file, 'Mine');
    expect(r.name).toBe('Mine');
    expect(r.palette).toEqual(colors());
    expect(r.syntax).toEqual(def.syntax);
  });

  it('falls back to Default for an unknown name', () => {
    const r = resolveSkin(file, 'Nope');
    expect(r.name).toBe('Default');
    expect(r.palette).toEqual(def.palette);
    expect(r.syntax).toEqual(def.syntax);
  });

  it('falls back to Default for names that only exist on Object.prototype', () => {
    for (const n of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const r = resolveSkin(file, n);
      expect(r.name).toBe('Default');
      expect(r.palette).toEqual(def.palette);
    }
  });

  it('is case-sensitive: "claude" is unknown and falls back to Default', () => {
    expect(resolveSkin(file, 'claude').name).toBe('Default');
  });

  it('does not alias the preset objects (mutating a result cannot corrupt presets)', () => {
    const r = resolveSkin(file, 'Default');
    (r.palette.light as Record<string, string>)['--color-accent'] = 'red';
    expect(resolveSkin(file, 'Default').palette.light['--color-accent']).toBe(def.palette.light['--color-accent']);
  });
});

describe('listSkinNames', () => {
  it('lists the 4 built-ins in order, then custom names in file order', () => {
    const file: SkinsFile = { activeSkin: 'Default', customSkins: { Zeta: colors(), Alpha: colors() } };
    expect(listSkinNames(file)).toEqual(['Default', 'Claude', 'Obsidian', 'Tokyo Night', 'Zeta', 'Alpha']);
  });

  it('lists only the built-ins when there are no custom skins', () => {
    expect(listSkinNames(defaultSkinsFile)).toEqual(['Default', 'Claude', 'Obsidian', 'Tokyo Night']);
  });
});

describe('toSkinPayload: the choke point (#211)', () => {
  const defaultPayload = toSkinPayload(resolveSkin(defaultSkinsFile, 'Default'));

  it('passes a valid resolved skin through unchanged in shape', () => {
    const resolved = resolveSkin(defaultSkinsFile, 'Claude');
    const payload = toSkinPayload(resolved);
    expect(payload).toEqual(resolved);
    expect(Object.keys(payload).sort()).toEqual(['name', 'palette', 'syntax']);
    expect(Object.keys(payload.palette.light)).toEqual(TOKENS);
  });

  it('falls back to the Default payload when one color is poisoned', () => {
    const resolved = resolveSkin(defaultSkinsFile, 'Claude');
    const poisoned: ResolvedSkin = JSON.parse(JSON.stringify(resolved));
    poisoned.palette.dark['--color-accent'] = 'red; background:url(x)';
    expect(toSkinPayload(poisoned)).toEqual(defaultPayload);
  });

  it('falls back to Default when a token is missing', () => {
    const poisoned: ResolvedSkin = JSON.parse(JSON.stringify(resolveSkin(defaultSkinsFile, 'Claude')));
    delete (poisoned.palette.light as Record<string, string>)['--color-border'];
    expect(toSkinPayload(poisoned)).toEqual(defaultPayload);
  });

  it('falls back to Default when a syntax filename is outside the allowlist', () => {
    const poisoned: ResolvedSkin = JSON.parse(JSON.stringify(resolveSkin(defaultSkinsFile, 'Claude')));
    (poisoned.syntax as { light: string }).light = '../../evil.css';
    expect(toSkinPayload(poisoned)).toEqual(defaultPayload);
    (poisoned.syntax as { light: string }).light = 'github.css';
    (poisoned.syntax as { dark: string }).dark = 'x.css" onload="y';
    expect(toSkinPayload(poisoned)).toEqual(defaultPayload);
  });

  it('falls back to Default for garbage input', () => {
    for (const g of [null, undefined, 5, 'x', {}, { name: 'x' }]) {
      expect(toSkinPayload(g as unknown as ResolvedSkin)).toEqual(defaultPayload);
    }
  });

  it('never carries extra properties through to the wire', () => {
    const resolved = JSON.parse(JSON.stringify(resolveSkin(defaultSkinsFile, 'Claude')));
    resolved.palette.light['--color-extra'] = '#fff';
    resolved.extra = 'x';
    expect(toSkinPayload(resolved)).toEqual(defaultPayload);
  });
});

describe('built-in presets', () => {
  it('are Default, Claude, Obsidian, Tokyo Night in that order', () => {
    expect(BUILT_IN_SKINS.map((s) => s.name)).toEqual(['Default', 'Claude', 'Obsidian', 'Tokyo Night']);
  });

  const STYLES_DIR = path.join(__dirname, '../../node_modules/highlight.js/styles');

  describe.each(BUILT_IN_SKINS.map((s) => [s.name, s] as const))('%s', (_name, skin) => {
    it('has exactly the 16 tokens in both halves, each passing the validator', () => {
      for (const mode of ['light', 'dark'] as const) {
        expect(Object.keys(skin.palette[mode]).sort()).toEqual([...TOKENS].sort());
        for (const t of TOKENS) {
          const v = (skin.palette[mode] as Record<string, string>)[t];
          expect(isSafeColorValue(v), `${mode} ${t}: ${v}`).toBe(true);
        }
      }
    });

    it('uses syntax files that are allowlisted and exist in highlight.js/styles', () => {
      for (const file of [skin.syntax.light, skin.syntax.dark]) {
        expect(SYNTAX_THEME_ALLOWLIST).toContain(file);
        expect(fs.existsSync(path.join(STYLES_DIR, file)), file).toBe(true);
        expect(file).toMatch(/^[a-z0-9-]+\.css$/);
      }
    });

    it('passes the payload choke point unchanged', () => {
      expect(toSkinPayload(resolveSkin(defaultSkinsFile, skin.name)).name).toBe(skin.name);
    });
  });

  it('every allowlisted file is used by some built-in preset', () => {
    const used = new Set(BUILT_IN_SKINS.flatMap((s) => [s.syntax.light, s.syntax.dark]));
    expect([...used].sort()).toEqual([...SYNTAX_THEME_ALLOWLIST].sort());
  });

  it('pins the syntax pairs', () => {
    const pairs = Object.fromEntries(BUILT_IN_SKINS.map((s) => [s.name, [s.syntax.light, s.syntax.dark]]));
    expect(pairs).toEqual({
      Default: ['github.css', 'github-dark.css'],
      Claude: ['atom-one-light.css', 'atom-one-dark.css'],
      Obsidian: ['stackoverflow-light.css', 'obsidian.css'],
      'Tokyo Night': ['tokyo-night-light.css', 'tokyo-night-dark.css'],
    });
  });

  it('new presets use the intended close-hover and tab-hover behavior (#222)', () => {
    for (const skin of BUILT_IN_SKINS.filter((s) => s.name !== 'Default')) {
      for (const mode of ['light', 'dark'] as const) {
        const p = skin.palette[mode];
        expect(p['--color-close-hover-bg']).toBe('#e81123');
        expect(p['--color-close-hover-glyph']).toBe('#ffffff');
        expect(p['--color-tab-hover-bg']).toBe(p['--color-bg-hover']);
      }
    }
  });
});

// ---- Drift test (#212): the Default preset equals app.css's token blocks ----

function parseTokenBlocks(css: string): { light: Record<string, string>; dark: Record<string, string> } {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments)) !== null) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    const target = selector === ':root' ? light : selector === 'body.dark-mode' ? dark : null;
    if (!target) continue;
    for (const d of m[2].matchAll(/(--color-[a-z0-9-]+)\s*:\s*([^;]+);?/g)) {
      target[d[1]] = d[2].trim().replace(/\s+/g, ' ');
    }
  }
  return { light, dark };
}

describe('Default preset drift against app.css (#212)', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.css'), 'utf8');
  const parsed = parseTokenBlocks(css);
  const def = BUILT_IN_SKINS.find((s) => s.name === 'Default')!;

  it('app.css defines the 16 tokens in both blocks (guard for the parser itself)', () => {
    expect(Object.keys(parsed.light).sort()).toEqual([...TOKENS].sort());
    expect(Object.keys(parsed.dark).sort()).toEqual([...TOKENS].sort());
  });

  it("Default's 32 values equal the parsed :root / body.dark-mode values exactly", () => {
    const normalize = (v: string) => v.trim().replace(/\s+/g, ' ');
    const problems: string[] = [];
    for (const t of TOKENS) {
      const l = normalize((def.palette.light as Record<string, string>)[t]);
      const d = normalize((def.palette.dark as Record<string, string>)[t]);
      if (l !== parsed.light[t]) problems.push(`light ${t}: preset "${l}" vs css "${parsed.light[t]}"`);
      if (d !== parsed.dark[t]) problems.push(`dark ${t}: preset "${d}" vs css "${parsed.dark[t]}"`);
    }
    expect(problems).toEqual([]);
  });
});

// ---- WCAG AA contrast of body text on the chrome background ----

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('WCAG AA (>= 4.5:1) of text on bg-chrome, every built-in preset', () => {
  it('computes known reference ratios (helper sanity)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  const cases = BUILT_IN_SKINS.flatMap((s) =>
    (['light', 'dark'] as const).flatMap((mode) =>
      (['--color-text-primary', '--color-text-muted'] as const).map((token) => [s.name, mode, token] as const)
    )
  );
  it.each(cases)('%s %s %s over bg-chrome', (name, mode, token) => {
    const skin = BUILT_IN_SKINS.find((s) => s.name === name)!;
    const p = skin.palette[mode] as Record<string, string>;
    const ratio = contrast(p[token], p['--color-bg-chrome']);
    expect(ratio, `${name} ${mode} ${token} ${p[token]} on ${p['--color-bg-chrome']} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  });
});

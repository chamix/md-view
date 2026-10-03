import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Task 50 (functional_domain.md #204-#210): every chrome color in app.css is
// a --color-* token, defined once per mode (:root = light, body.dark-mode =
// dark). This guard keeps that true for Task 51 (skins) to build on.

const CSS_PATH = path.join(__dirname, '../../src/renderer/app.css');

interface Rule {
  selector: string;
  body: string;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// app.css has no at-rules, so a flat `selector { body }` scan is exact.
function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    rules.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  }
  return rules;
}

const rules = parseRules(stripComments(fs.readFileSync(CSS_PATH, 'utf8')));
const lightBlocks = rules.filter((r) => r.selector === ':root');
const darkBlocks = rules.filter((r) => r.selector === 'body.dark-mode');
const isTokenBlock = (r: Rule) => r.selector === ':root' || r.selector === 'body.dark-mode';

const TOKEN_DECL = /(--color-[a-z0-9-]+)\s*:\s*([^;]+);?/g;

function definedTokens(blocks: Rule[]): string[] {
  const names: string[] = [];
  for (const b of blocks) {
    for (const m of b.body.matchAll(TOKEN_DECL)) names.push(m[1]);
  }
  return names;
}

function declarations(body: string): Array<{ prop: string; value: string }> {
  return body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':');
      return { prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() };
    });
}

const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood ' +
    'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray ' +
    'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue ' +
    'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew ' +
    'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue ' +
    'mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred ' +
    'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
    'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white ' +
    'whitesmoke yellow yellowgreen'
  ).split(' ')
);

// Returns the color literals found in a declaration value (empty if none).
// `transparent` is deliberately allowed (#210).
function colorLiterals(value: string): string[] {
  const found: string[] = [];
  const noStrings = value.replace(/'[^']*'|"[^"]*"/g, '');
  found.push(...(noStrings.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []));
  found.push(...(noStrings.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi) ?? []));
  for (const w of noStrings.match(/[a-zA-Z]+(?:-[a-zA-Z0-9]+)*/g) ?? []) {
    if (NAMED_COLORS.has(w.toLowerCase())) found.push(w);
  }
  return found;
}

// Pinned token values: [token, light (:root), dark (body.dark-mode)].
// Updating this table is the intended step when a token value changes
// deliberately (e.g. Task 51 skins); an unintended swap or edit fails below.
const EXPECTED_TOKENS: Array<[string, string, string]> = [
  ['--color-bg-page', 'transparent', '#0d1117'],
  ['--color-bg-chrome', '#f6f8fa', '#161b22'],
  ['--color-border', '#d0d7de', '#30363d'],
  ['--color-text-primary', '#24292f', '#c9d1d9'],
  ['--color-text-muted', '#57606a', '#8b949e'],
  ['--color-text-disabled', '#8c959f', '#6e7681'],
  ['--color-border-disabled', '#d8dee4', '#30363d'],
  ['--color-text-error', '#cf222e', '#ff7b72'],
  ['--color-bg-hover', 'rgba(208, 215, 222, 0.32)', 'rgba(48, 54, 61, 0.6)'],
  ['--color-tab-hover-bg', 'rgba(208, 215, 222, 0.32)', 'rgba(208, 215, 222, 0.32)'],
  ['--color-accent', '#0969da', '#58a6ff'],
  ['--color-bg-accent', 'rgba(9, 105, 218, 0.15)', 'rgba(88, 166, 255, 0.18)'],
  ['--color-bg-accent-hover', 'rgba(9, 105, 218, 0.22)', 'rgba(88, 166, 255, 0.28)'],
  ['--color-tab-active', '#fd8c73', '#fd8c73'],
  ['--color-close-hover-bg', '#e81123', 'rgba(48, 54, 61, 0.6)'],
  ['--color-close-hover-glyph', '#ffffff', '#c9d1d9'],
];

function tokenValues(blocks: Rule[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of blocks) {
    for (const m of b.body.matchAll(TOKEN_DECL)) out[m[1]] = m[2].trim().replace(/\s+/g, ' ');
  }
  return out;
}

describe('app.css color tokens (Task 50)', () => {
  it('pins every token to its exact expected light and dark value', () => {
    const light = tokenValues(lightBlocks);
    const dark = tokenValues(darkBlocks);
    const problems: string[] = [];
    for (const [name, expLight, expDark] of EXPECTED_TOKENS) {
      if (light[name] !== expLight) problems.push(`${name} (light): expected "${expLight}", got "${light[name]}"`);
      if (dark[name] !== expDark) problems.push(`${name} (dark): expected "${expDark}", got "${dark[name]}"`);
    }
    const known = new Set(EXPECTED_TOKENS.map(([n]) => n));
    for (const name of new Set([...Object.keys(light), ...Object.keys(dark)])) {
      if (!known.has(name)) problems.push(`${name}: defined in app.css but missing from EXPECTED_TOKENS`);
    }
    expect(problems).toEqual([]);
  });

  it('has exactly one :root block and one body.dark-mode block', () => {
    expect(lightBlocks).toHaveLength(1);
    expect(darkBlocks).toHaveLength(1);
  });

  it('(a) has no color literals outside the --color-* token declarations', () => {
    const offenders: string[] = [];
    for (const r of rules) {
      for (const d of declarations(r.body)) {
        if (isTokenBlock(r) && d.prop.startsWith('--color-')) continue;
        const lits = colorLiterals(d.value);
        if (lits.length > 0) offenders.push(`${r.selector} { ${d.prop}: ${d.value} } -> ${lits.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('(b) every var(--color-*) reference is defined in both blocks', () => {
    const light = new Set(definedTokens(lightBlocks));
    const dark = new Set(definedTokens(darkBlocks));
    const used = new Set<string>();
    for (const r of rules) {
      for (const d of declarations(r.body)) {
        for (const m of d.value.matchAll(/var\(\s*(--color-[a-z0-9-]+)/g)) used.add(m[1]);
      }
    }
    const missingLight = [...used].filter((t) => !light.has(t));
    const missingDark = [...used].filter((t) => !dark.has(t));
    expect({ missingLight, missingDark }).toEqual({ missingLight: [], missingDark: [] });
  });

  it('(c) both blocks define the identical token set, each token once', () => {
    const light = definedTokens(lightBlocks);
    const dark = definedTokens(darkBlocks);
    expect(new Set(light).size).toBe(light.length);
    expect(new Set(dark).size).toBe(dark.length);
    expect(light.length).toBeGreaterThan(0);
    expect([...dark].sort()).toEqual([...light].sort());
  });
});

import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isSafeThemeFilename, isSafeTokenName, isSafeColorText, halfFor, applySkin } = require('../../src/renderer/skin.js');

// Task 51 (#211, #224-#226; ADR-014). Pure Node with a fake DOM, same posture
// as copy.test.ts: the real DOM application is proven end to end by
// tests/e2e/skins-menu.spec.ts.

const TOKENS = [
  '--color-bg-page',
  '--color-bg-chrome',
  '--color-accent',
];

function half(prefix: string): Record<string, string> {
  return Object.fromEntries(TOKENS.map((t, i) => [t, `#${prefix}${i}${prefix}${i}${prefix}${i}`.slice(0, 7)]));
}

function payload(over: Record<string, unknown> = {}) {
  return {
    name: 'Test',
    palette: { light: { '--color-bg-page': '#111111', '--color-accent': '#222222' }, dark: { '--color-bg-page': '#aaaaaa', '--color-accent': '#bbbbbb' } },
    syntax: { light: 'atom-one-light.css', dark: 'atom-one-dark.css' },
    ...over,
  };
}

function fakeDom() {
  const props = new Map<string, string>();
  const calls: string[] = [];
  const body = {
    style: {
      setProperty: (n: string, v: string) => {
        calls.push(`set ${n}`);
        props.set(n, v);
      },
      removeProperty: (n: string) => {
        calls.push(`remove ${n}`);
        props.delete(n);
      },
    },
  };
  let lightSets = 0;
  let darkSets = 0;
  const mkLink = (href: string, counter: () => void) => {
    let h = href;
    return {
      get href() {
        return h;
      },
      set href(v: string) {
        counter();
        h = v;
      },
    };
  };
  const hljsLightLink = mkLink('file:///app/renderer/github.css', () => lightSets++);
  const hljsDarkLink = mkLink('file:///app/renderer/github-dark.css', () => darkSets++);
  return {
    props,
    calls,
    body,
    hljsLightLink,
    hljsDarkLink,
    sets: () => ({ light: lightSets, dark: darkSets }),
    ports: { body, hljsLightLink, hljsDarkLink, baseUri: 'file:///app/renderer/index.html' },
  };
}

describe('isSafeThemeFilename (#211)', () => {
  it.each(['github.css', 'github-dark.css', 'tokyo-night-light.css', 'a1.css'])('accepts %s', (f) => {
    expect(isSafeThemeFilename(f)).toBe(true);
  });
  it.each([
    '',
    'github',
    'github.js',
    'GitHub.css',
    '../github.css',
    '..\\github.css',
    'sub/github.css',
    'github.css ',
    ' github.css',
    'github.css\n',
    'git hub.css',
    'x.css" onload="y',
    'http://evil/x.css',
    'file:///etc/x.css',
    'a_b.css',
    '.css',
    'github.css.css.',
  ])('rejects %j', (f) => {
    expect(isSafeThemeFilename(f)).toBe(false);
  });
  it('rejects non-strings', () => {
    for (const v of [undefined, null, 5, {}, ['github.css']]) expect(isSafeThemeFilename(v)).toBe(false);
  });
});

describe('isSafeTokenName', () => {
  it.each(['--color-bg-page', '--color-close-hover-glyph'])('accepts %s', (n) => {
    expect(isSafeTokenName(n)).toBe(true);
  });
  it.each(['', 'color-bg', '--tree-panel-width', '--color-', '--color-A', '--color-bg;x', 'background', '--color-bg page', '--color-x\n'])(
    'rejects %j',
    (n) => {
      expect(isSafeTokenName(n)).toBe(false);
    }
  );
});

describe('isSafeColorText (renderer-side defence in depth)', () => {
  it.each(['#fff', '#aabbccdd', 'transparent', 'rgb(0,0,0)', 'rgba(208, 215, 222, 0.32)'])('accepts %s', (v) => {
    expect(isSafeColorText(v)).toBe(true);
  });
  it.each(['red', 'var(--x)', 'url(x)', '#fff; x:y', 'rgb(0,0,0) !important', '', 'expression(1)', '#fff\n', 5])('rejects %j', (v) => {
    expect(isSafeColorText(v)).toBe(false);
  });
});

describe('halfFor', () => {
  it('returns the light half when not dark and the dark half when dark', () => {
    const p = payload();
    expect(halfFor(p, false)).toBe(p.palette.light);
    expect(halfFor(p, true)).toBe(p.palette.dark);
  });
  it('returns null for a malformed payload', () => {
    for (const bad of [null, undefined, {}, { palette: null }, { palette: {} }, { palette: { light: 'x', dark: 'y' } }]) {
      expect(halfFor(bad, false)).toBeNull();
      expect(halfFor(bad, true)).toBeNull();
    }
  });
});

describe('applySkin', () => {
  it('sets only the active half (light) on body.style', () => {
    const d = fakeDom();
    applySkin(d.ports, payload(), false);
    expect(Object.fromEntries(d.props)).toEqual({ '--color-bg-page': '#111111', '--color-accent': '#222222' });
  });

  it('sets only the active half (dark) on body.style', () => {
    const d = fakeDom();
    applySkin(d.ports, payload(), true);
    expect(Object.fromEntries(d.props)).toEqual({ '--color-bg-page': '#aaaaaa', '--color-accent': '#bbbbbb' });
  });

  it('switching halves leaves no stale value from the other half', () => {
    const d = fakeDom();
    applySkin(d.ports, payload(), false);
    applySkin(d.ports, payload(), true);
    expect(Object.fromEntries(d.props)).toEqual({ '--color-bg-page': '#aaaaaa', '--color-accent': '#bbbbbb' });
    applySkin(d.ports, payload(), false);
    expect(Object.fromEntries(d.props)).toEqual({ '--color-bg-page': '#111111', '--color-accent': '#222222' });
  });

  it('a token that becomes unsafe in a later payload is removed, not left stale', () => {
    const d = fakeDom();
    applySkin(d.ports, payload(), false);
    const next = payload({ palette: { light: { '--color-bg-page': '#333333', '--color-accent': 'red; x:y' }, dark: {} } });
    applySkin(d.ports, next, false);
    expect(d.props.get('--color-bg-page')).toBe('#333333');
    expect(d.props.has('--color-accent')).toBe(false);
  });

  it('skips property names that fail the token guard (never touches non --color-* properties)', () => {
    const d = fakeDom();
    const p = payload({
      palette: {
        light: { '--color-bg-page': '#111111', 'background-image': '#222222', '--tree-panel-width': '#333333', '--color-x;y': '#444444' },
        dark: {},
      },
    });
    applySkin(d.ports, p, false);
    expect([...d.props.keys()]).toEqual(['--color-bg-page']);
    expect(d.calls.filter((c) => c.includes('background-image') || c.includes('tree-panel'))).toEqual([]);
  });

  it('skips color values that fail the value guard', () => {
    const d = fakeDom();
    const p = payload({ palette: { light: { '--color-bg-page': 'url(http://x)', '--color-accent': '#123456' }, dark: {} } });
    applySkin(d.ports, p, false);
    expect(d.props.get('--color-accent')).toBe('#123456');
    expect(d.props.has('--color-bg-page')).toBe(false);
  });

  it('points the two hljs links at the pair, resolved against baseUri', () => {
    const d = fakeDom();
    applySkin(d.ports, payload(), false);
    expect(d.hljsLightLink.href).toBe('file:///app/renderer/atom-one-light.css');
    expect(d.hljsDarkLink.href).toBe('file:///app/renderer/atom-one-dark.css');
  });

  it('never resolves against anything but the supplied baseUri (a relative name stays in the renderer dir)', () => {
    const d = fakeDom();
    applySkin({ ...d.ports, baseUri: 'file:///app/renderer/index.html' }, payload(), true);
    expect(d.hljsLightLink.href.startsWith('file:///app/renderer/')).toBe(true);
  });

  it('does not touch a link whose href is already correct (no-op for unchanged hrefs)', () => {
    const d = fakeDom();
    applySkin(d.ports, payload({ syntax: { light: 'github.css', dark: 'github-dark.css' } }), false);
    expect(d.sets()).toEqual({ light: 0, dark: 0 });
    applySkin(d.ports, payload(), false);
    expect(d.sets()).toEqual({ light: 1, dark: 1 });
    applySkin(d.ports, payload(), true);
    expect(d.sets()).toEqual({ light: 1, dark: 1 });
  });

  it.each(['../evil.css', 'x.css" onload="y', 'http://evil/x.css', 'a/b.css', 'x.js', ''])('rejects unsafe syntax filename %j and leaves the link alone', (bad) => {
    const d = fakeDom();
    const before = { light: d.hljsLightLink.href, dark: d.hljsDarkLink.href };
    applySkin(d.ports, payload({ syntax: { light: bad, dark: bad } }), false);
    expect({ light: d.hljsLightLink.href, dark: d.hljsDarkLink.href }).toEqual(before);
    expect(d.sets()).toEqual({ light: 0, dark: 0 });
  });

  it('applies the valid half of a pair when only one filename is unsafe', () => {
    const d = fakeDom();
    applySkin(d.ports, payload({ syntax: { light: '../evil.css', dark: 'obsidian.css' } }), false);
    expect(d.hljsLightLink.href).toBe('file:///app/renderer/github.css');
    expect(d.hljsDarkLink.href).toBe('file:///app/renderer/obsidian.css');
  });

  it('is a safe no-op for a malformed payload or missing ports', () => {
    const d = fakeDom();
    expect(() => applySkin(d.ports, null, false)).not.toThrow();
    expect(() => applySkin(d.ports, {}, true)).not.toThrow();
    expect(() => applySkin({ body: d.body, hljsLightLink: null, hljsDarkLink: null, baseUri: d.ports.baseUri }, payload(), false)).not.toThrow();
    expect(d.props.size).toBe(2);
  });

  it('never assigns cssText or innerHTML (body stub has neither and nothing throws)', () => {
    const d = fakeDom();
    applySkin(d.ports, payload(), false);
    expect('cssText' in d.body.style).toBe(false);
    expect('innerHTML' in d.body).toBe(false);
  });
});

// keep the helper referenced for readers; half() documents the token shape
void half;

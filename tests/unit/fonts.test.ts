import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FONT_TOKEN_NAMES, isSafeFontText, applyFonts } = require('../../src/renderer/fonts.js');

// Task 55 (functional_domain.md #52-#58; initial_scaffold.md Task 55). Pure
// Node with a fake DOM, same posture as skin.test.ts: the real DOM
// application is proven end to end by tests/e2e/font-settings.spec.ts.

function fakeBody() {
  const props = new Map<string, string>();
  const calls: string[] = [];
  return {
    props,
    calls,
    body: {
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
    },
  };
}

describe('FONT_TOKEN_NAMES', () => {
  it('maps the two logical slots to the expected CSS custom-property names', () => {
    expect(FONT_TOKEN_NAMES).toEqual({ ui: '--font-ui', code: '--font-code' });
  });
});

describe('isSafeFontText (renderer-side defence in depth)', () => {
  it.each(['Fira Sans', 'Fira Code', 'Comic Sans MS', 'Noto Sans', 'A'.repeat(80)])('accepts %s', (v) => {
    expect(isSafeFontText(v)).toBe(true);
  });

  it.each([
    '',
    "Fira'Sans",
    'Fira"Sans',
    'Fira\\Sans',
    'Fira;Sans',
    'Fira(Sans)',
    'Fira<Sans>',
    'Fira{Sans}',
    'url(evil)',
    'Fira\nSans',
    'A'.repeat(81),
    5,
    null,
    undefined,
  ])('rejects %j', (v) => {
    expect(isSafeFontText(v as unknown as string)).toBe(false);
  });
});

describe('applyFonts', () => {
  it('sets --font-ui and --font-code as double-quoted CSS strings for valid names', () => {
    const d = fakeBody();
    applyFonts(d.body, { uiFontFamily: 'Fira Sans', codeFontFamily: 'Fira Code' });
    expect(Object.fromEntries(d.props)).toEqual({
      '--font-ui': '"Fira Sans"',
      '--font-code': '"Fira Code"',
    });
  });

  it('removes both properties when both fields are the empty string (unset)', () => {
    const d = fakeBody();
    applyFonts(d.body, { uiFontFamily: 'Fira Sans', codeFontFamily: 'Fira Code' });
    applyFonts(d.body, { uiFontFamily: '', codeFontFamily: '' });
    expect(d.props.size).toBe(0);
    expect(d.calls).toContain('remove --font-ui');
    expect(d.calls).toContain('remove --font-code');
  });

  it.each(["Fira';alert(1)", 'Fira;Sans', 'url(evil)', 'Fira"Sans'])(
    'never calls setProperty for an unsafe uiFontFamily value (%j); removes instead',
    (bad) => {
      const d = fakeBody();
      applyFonts(d.body, { uiFontFamily: bad, codeFontFamily: '' });
      expect(d.calls.some((c) => c.startsWith('set --font-ui'))).toBe(false);
      expect(d.props.has('--font-ui')).toBe(false);
    }
  );

  it.each(["Fira';alert(1)", 'Fira;Sans', 'url(evil)', 'Fira"Sans'])(
    'never calls setProperty for an unsafe codeFontFamily value (%j); removes instead',
    (bad) => {
      const d = fakeBody();
      applyFonts(d.body, { uiFontFamily: '', codeFontFamily: bad });
      expect(d.calls.some((c) => c.startsWith('set --font-code'))).toBe(false);
      expect(d.props.has('--font-code')).toBe(false);
    }
  );

  it('a font that becomes unsafe in a later call is removed, not left stale', () => {
    const d = fakeBody();
    applyFonts(d.body, { uiFontFamily: 'Fira Sans', codeFontFamily: 'Fira Code' });
    applyFonts(d.body, { uiFontFamily: 'bad;value', codeFontFamily: 'Fira Code' });
    expect(d.props.has('--font-ui')).toBe(false);
    expect(d.props.get('--font-code')).toBe('"Fira Code"');
  });

  it('is a safe no-op for missing body/style and missing settings', () => {
    expect(() => applyFonts(null, { uiFontFamily: 'x', codeFontFamily: 'y' })).not.toThrow();
    expect(() => applyFonts({}, { uiFontFamily: 'x', codeFontFamily: 'y' })).not.toThrow();
    const d = fakeBody();
    expect(() => applyFonts(d.body, null)).not.toThrow();
    expect(() => applyFonts(d.body, undefined)).not.toThrow();
    expect(d.props.size).toBe(0);
  });

  it('never assigns cssText or innerHTML (body stub has neither and nothing throws)', () => {
    const d = fakeBody();
    applyFonts(d.body, { uiFontFamily: 'Fira Sans', codeFontFamily: 'Fira Code' });
    expect('cssText' in d.body.style).toBe(false);
    expect('innerHTML' in d.body).toBe(false);
  });
});

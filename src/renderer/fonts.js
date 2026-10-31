// Task 55 (functional_domain.md #52-#58; initial_scaffold.md Task 55). Classic
// script, loaded by index.html AFTER skin.js and BEFORE renderer.js -- same
// composition-root posture as skin.js: renderer.js feeds this file the
// pushed ViewSettings, this file never reaches into main or skin.js itself.
//
// Main validates every font name before pushing (isSafeFontName in
// src/main/settings.ts); this file re-checks (defence in depth) before
// anything touches the DOM, mirroring skin.js's isSafeColorText posture:
//   - font names must match a closed character-class denylist, re-derived
//     locally -- never imported/required from main's validator.
// Never uses innerHTML or cssText: only style.setProperty/removeProperty.

// ---------------------------------------------------------------- policy ---

const FONT_TOKEN_NAMES = { ui: '--font-ui', code: '--font-code' };

// Mirrors the closed grammar main enforces (src/main/settings.ts's
// isSafeFontName): reject control chars, quotes, backslash, semicolon,
// parens, angle brackets, curly braces; allow Unicode letters, digits,
// spaces, hyphens; max length 80; empty string is handled separately by the
// caller (applyFonts), not by this pattern.
const MAX_FONT_NAME_LENGTH = 80;
const FONT_NAME_DENYLIST_PATTERN = /['"\\;(){}<>]/;

// C0, DEL, C1 controls plus the Unicode line/paragraph separators -- same
// character classes as main's hasControlChar, reimplemented locally.
function hasControlChar(value) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

function isSafeFontText(value) {
  if (typeof value !== 'string' || value === '') return false;
  if (value.length > MAX_FONT_NAME_LENGTH) return false;
  if (hasControlChar(value)) return false;
  return !FONT_NAME_DENYLIST_PATTERN.test(value);
}

// --------------------------------------------------------------- applier ---

// Applies the two font overrides to body.style. For each of uiFontFamily /
// codeFontFamily: a non-empty value that passes isSafeFontText is set as a
// double-quoted CSS string (no fallback stack appended -- the fallback
// lives only in app.css's var() second argument, functional_domain.md
// guardrail #7); anything else (empty string, unsafe text, wrong type)
// removes the property so that CSS fallback takes over. Safe to call
// repeatedly, in any order of arrival, same posture as applySkin.
function applyFonts(body, settings) {
  if (!body || !body.style) return;
  const uiFontFamily = settings ? settings.uiFontFamily : undefined;
  const codeFontFamily = settings ? settings.codeFontFamily : undefined;

  if (typeof uiFontFamily === 'string' && uiFontFamily !== '' && isSafeFontText(uiFontFamily)) {
    body.style.setProperty(FONT_TOKEN_NAMES.ui, '"' + uiFontFamily + '"');
  } else {
    body.style.removeProperty(FONT_TOKEN_NAMES.ui);
  }

  if (typeof codeFontFamily === 'string' && codeFontFamily !== '' && isSafeFontText(codeFontFamily)) {
    body.style.setProperty(FONT_TOKEN_NAMES.code, '"' + codeFontFamily + '"');
  } else {
    body.style.removeProperty(FONT_TOKEN_NAMES.code);
  }
}

// No-op in the browser; lets Vitest require() this file under plain Node,
// same guard skin.js/diagrams.js/copy.js/renderer.js use.
if (typeof module !== 'undefined') {
  module.exports = { FONT_TOKEN_NAMES, isSafeFontText, applyFonts };
}

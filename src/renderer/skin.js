// Task 51: skins (functional_domain.md #211, #224-#226; ADR-014). Classic
// script, loaded by index.html AFTER copy.js and BEFORE renderer.js;
// renderer.js is the composition root that feeds it the pushed payload and the
// Dark Mode fact, same posture as diagrams.js / copy.js.
//
// Main validates every color and filename before pushing (toSkinPayload);
// this file re-checks (defence in depth) before anything touches the DOM:
//   - property names must match /^--color-[a-z-]+$/
//   - values must match a small closed color shape
//   - theme filenames must match /^[a-z0-9-]+\.css$/
// Never uses innerHTML or cssText: only style.setProperty/removeProperty and
// link.href.

// ---------------------------------------------------------------- policy ---

const THEME_FILENAME_PATTERN = /^[a-z0-9-]+\.css$/;
const TOKEN_NAME_PATTERN = /^--color-[a-z-]+$/;
// Mirrors the closed grammar main enforces: hex, rgb()/rgba() of plain
// numbers, or the keyword transparent. Deliberately looser on numeric ranges
// (main owns those); strict on every character class that could carry syntax.
const COLOR_TEXT_PATTERN = /^(?:#[0-9a-fA-F]{3,8}|transparent|rgba?\([0-9., ]{5,40}\))$/;

function isSafeThemeFilename(value) {
  return typeof value === 'string' && THEME_FILENAME_PATTERN.test(value);
}

function isSafeTokenName(value) {
  return typeof value === 'string' && TOKEN_NAME_PATTERN.test(value);
}

function isSafeColorText(value) {
  return typeof value === 'string' && COLOR_TEXT_PATTERN.test(value);
}

// The half of the palette that Dark Mode selects, or null for a malformed
// payload. Dark Mode stays an independent fact (#213): only the half changes.
function halfFor(payload, isDark) {
  if (!payload || typeof payload !== 'object') return null;
  const palette = payload.palette;
  if (!palette || typeof palette !== 'object') return null;
  const half = isDark ? palette.dark : palette.light;
  if (!half || typeof half !== 'object') return null;
  return half;
}

// --------------------------------------------------------------- applier ---

// Points one <link> at a theme file resolved against the renderer's own
// directory (baseUri is the initial document.baseURI, ADR-004; never the
// retargeted <base href>). Unsafe filename or unchanged href: no-op.
function pointLinkAt(link, file, baseUri) {
  if (!link || !isSafeThemeFilename(file)) return;
  const href = new URL(file, baseUri).href;
  if (link.href !== href) link.href = href;
}

// Applies ONLY the active half's properties to body.style (body, not
// <html>: body.dark-mode re-declares the tokens on body, ADR-014) and points
// the two highlight links at the skin's syntax pair. Safe to call repeatedly,
// with either half, in any order of arrival (#226).
function applySkin(ports, payload, isDark) {
  if (!ports || !ports.body) return;
  const half = halfFor(payload, isDark);
  if (half === null) return;

  for (const name of Object.keys(half)) {
    if (!isSafeTokenName(name)) continue;
    const value = half[name];
    if (isSafeColorText(value)) {
      ports.body.style.setProperty(name, value);
    } else {
      // A token that is no longer valid must not keep a previous value.
      ports.body.style.removeProperty(name);
    }
  }

  const syntax = payload.syntax;
  if (syntax && typeof syntax === 'object') {
    pointLinkAt(ports.hljsLightLink, syntax.light, ports.baseUri);
    pointLinkAt(ports.hljsDarkLink, syntax.dark, ports.baseUri);
  }
}

// No-op in the browser; lets Vitest require() this file under plain Node,
// same guard diagrams.js/copy.js/renderer.js use.
if (typeof module !== 'undefined') {
  module.exports = { isSafeThemeFilename, isSafeTokenName, isSafeColorText, halfFor, applySkin };
}

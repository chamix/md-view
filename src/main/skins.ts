import { z } from 'zod';
import { BUILT_IN_SKINS } from './skinPresets';
import type { SkinDefinition } from './skinPresets';
import type { ResolvedSkin } from '../preload/api';

// Task 51 (ADR-014, functional_domain.md #211-#222). Pure core: no electron,
// no node:fs. skinsStore.ts is the I/O adapter; index.ts (51b) wires them.
//
// Security posture (#211): skins.json is user-edited, and its values are later
// applied to the live page via style.setProperty. Nothing reaches the page
// unless it passed isSafeColorValue (a closed, anchored grammar) or, for the
// syntax themes, the closed filename allowlist below.

export const SKIN_TOKEN_NAMES = [
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
] as const;

export type SkinTokenName = (typeof SKIN_TOKEN_NAMES)[number];
export type HalfPalette = Record<SkinTokenName, string>;
export interface SkinColors {
  light: HalfPalette;
  dark: HalfPalette;
}
export interface SyntaxPair {
  light: string;
  dark: string;
}
export interface SkinsFile {
  activeSkin: string;
  customSkins: Record<string, SkinColors>;
}
// Wire shape (what crosses to the renderer) lives in the shared contract,
// src/preload/api.ts (same posture as settings.ts importing ViewSettings).
export type { ResolvedSkin };

export const SYNTAX_THEME_ALLOWLIST: readonly string[] = [
  'github.css',
  'github-dark.css',
  'atom-one-light.css',
  'atom-one-dark.css',
  'stackoverflow-light.css',
  'obsidian.css',
  'tokyo-night-light.css',
  'tokyo-night-dark.css',
];

// ---- Color validator (#211): closed grammar, anchored, lowercase function
// names and keyword. No named colors, var(), url(), ';', '!important', etc.
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_COLOR = /^rgb\((\d{1,3}), *(\d{1,3}), *(\d{1,3})\)$/;
const RGBA_COLOR = /^rgba\((\d{1,3}), *(\d{1,3}), *(\d{1,3}), *(\d{1,6}(?:\.\d{1,6})?|\.\d{1,6})\)$/;

export function isSafeColorValue(value: string): boolean {
  if (typeof value !== 'string') return false;
  if (value === 'transparent') return true;
  if (HEX_COLOR.test(value)) return true;

  const rgb = RGB_COLOR.exec(value);
  if (rgb !== null) return [rgb[1], rgb[2], rgb[3]].every((c) => Number(c) <= 255);

  const rgba = RGBA_COLOR.exec(value);
  if (rgba !== null) {
    return [rgba[1], rgba[2], rgba[3]].every((c) => Number(c) <= 255) && Number(rgba[4]) <= 1;
  }
  return false;
}

// ---- Custom skin names (#218) ----
const MAX_NAME_LENGTH = 40;
// C0, DEL, C1 controls plus the Unicode line/paragraph separators.
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}
const BUILT_IN_NAMES_LOWER = BUILT_IN_SKINS.map((s) => s.name.toLowerCase());

export function isValidCustomSkinName(name: string): boolean {
  return (
    typeof name === 'string' &&
    name.length >= 1 &&
    name.length <= MAX_NAME_LENGTH &&
    name === name.trim() &&
    !hasControlChar(name) &&
    !BUILT_IN_NAMES_LOWER.includes(name.toLowerCase())
  );
}

// ---- Strict schemas (mirror settings.ts: .strict() at every level) ----
const colorSchema = z.string().refine(isSafeColorValue, { message: 'unsafe color value' });

const halfPaletteSchema = z
  .object(Object.fromEntries(SKIN_TOKEN_NAMES.map((t) => [t, colorSchema])) as Record<SkinTokenName, typeof colorSchema>)
  .strict();

const skinColorsSchema = z.object({ light: halfPaletteSchema, dark: halfPaletteSchema }).strict();

const skinsFileSchema = z
  .object({
    activeSkin: z.string(),
    customSkins: z
      .record(z.string(), skinColorsSchema)
      .refine((skins) => Object.keys(skins).every(isValidCustomSkinName), { message: 'invalid custom skin name' }),
  })
  .strict();

export const defaultSkinsFile: SkinsFile = { activeSkin: 'Default', customSkins: {} };

// One pass/fail question (#104): JSON syntax errors and shape errors both
// collapse to null.
export function parseSkins(raw: string): SkinsFile | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = skinsFileSchema.safeParse(parsedJson);
  return result.success ? (result.data as SkinsFile) : null;
}

// ---- Resolution ----
function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function cloneHalf(half: HalfPalette): HalfPalette {
  const out = {} as HalfPalette;
  for (const t of SKIN_TOKEN_NAMES) out[t] = half[t];
  return out;
}

function cloneColors(c: SkinColors): SkinColors {
  return { light: cloneHalf(c.light), dark: cloneHalf(c.dark) };
}

function fromDefinition(def: SkinDefinition): ResolvedSkin {
  return {
    name: def.name,
    palette: cloneColors(def.palette),
    syntax: { light: def.syntax.light, dark: def.syntax.dark },
  };
}

const DEFAULT_DEFINITION: SkinDefinition = BUILT_IN_SKINS[0];

// Fresh copies every call, so a consumer mutating a result can never corrupt
// the shared presets or the parsed file.
export function resolveSkin(file: SkinsFile, activeName: string): ResolvedSkin {
  const builtIn = BUILT_IN_SKINS.find((s) => s.name === activeName);
  if (builtIn !== undefined) return fromDefinition(builtIn);

  // hasOwn: 'constructor' / 'toString' / '__proto__' must not resolve.
  if (typeof activeName === 'string' && hasOwn(file.customSkins, activeName)) {
    return {
      name: activeName,
      palette: cloneColors(file.customSkins[activeName]),
      syntax: { light: DEFAULT_DEFINITION.syntax.light, dark: DEFAULT_DEFINITION.syntax.dark },
    };
  }
  return fromDefinition(DEFAULT_DEFINITION);
}

export function listSkinNames(file: SkinsFile): string[] {
  return [...BUILT_IN_SKINS.map((s) => s.name), ...Object.keys(file.customSkins)];
}

// ---- The choke point (#211) ----
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sameKeys(obj: object, expected: readonly string[]): boolean {
  const keys = Object.keys(obj);
  return keys.length === expected.length && expected.every((k) => hasOwn(obj, k));
}

function validatedHalf(v: unknown): HalfPalette | null {
  if (!isPlainObject(v) || !sameKeys(v, SKIN_TOKEN_NAMES)) return null;
  const out = {} as HalfPalette;
  for (const t of SKIN_TOKEN_NAMES) {
    const value = v[t];
    if (typeof value !== 'string' || !isSafeColorValue(value)) return null;
    out[t] = value;
  }
  return out;
}

function validatedPayload(candidate: unknown): ResolvedSkin | null {
  if (!isPlainObject(candidate) || !sameKeys(candidate, ['name', 'palette', 'syntax'])) return null;
  const { name, palette, syntax } = candidate;

  const isBuiltInName = typeof name === 'string' && BUILT_IN_SKINS.some((s) => s.name === name);
  if (typeof name !== 'string' || !(isBuiltInName || isValidCustomSkinName(name))) return null;

  if (!isPlainObject(palette) || !sameKeys(palette, ['light', 'dark'])) return null;
  const light = validatedHalf(palette.light);
  const dark = validatedHalf(palette.dark);
  if (light === null || dark === null) return null;

  if (!isPlainObject(syntax) || !sameKeys(syntax, ['light', 'dark'])) return null;
  const { light: sLight, dark: sDark } = syntax;
  if (typeof sLight !== 'string' || typeof sDark !== 'string') return null;
  if (!SYNTAX_THEME_ALLOWLIST.includes(sLight) || !SYNTAX_THEME_ALLOWLIST.includes(sDark)) return null;

  return { name, palette: { light, dark }, syntax: { light: sLight, dark: sDark } };
}

// The one place every color and filename is re-validated immediately before
// leaving main. Any failure falls back to the Default payload (defence in
// depth for built-ins; custom skins were already validated at parse time).
// The result is rebuilt field by field, so nothing extra rides along.
export function toSkinPayload(resolved: ResolvedSkin): ResolvedSkin {
  try {
    const checked = validatedPayload(resolved);
    if (checked !== null) return checked;
  } catch {
    // fall through to Default
  }
  return fromDefinition(DEFAULT_DEFINITION);
}

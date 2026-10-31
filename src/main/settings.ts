import { z } from 'zod';
import type { ViewSettings } from '../preload/api';

// .strict() at both levels (functional_domain.md guardrails #103/#104): an
// unknown/extra key or a wrong-shaped 'View' object fails validation exactly
// like a missing key or a wrong-typed value does -- no partial recovery.

// ---- Font name validator (Task 55, functional_domain.md guardrails #52-#58)
// Closed-grammar denylist, anchored, same posture as skins.ts's
// isSafeColorValue: free text is allowed, but control chars and every
// character class that could carry CSS/HTML syntax is rejected. Values
// later reach the live page via style.setProperty (fonts.js), so nothing
// unvalidated may cross this boundary.
const MAX_FONT_NAME_LENGTH = 80;
const FONT_NAME_DENYLIST = /['"\\;(){}<>]/;

// C0, DEL, C1 controls plus the Unicode line/paragraph separators -- same
// check as skins.ts's hasControlChar, reimplemented independently (this
// task does not import from skins.ts).
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

export function isSafeFontName(value: string): boolean {
  if (typeof value !== 'string') return false;
  if (value === '') return true;
  if (value.length > MAX_FONT_NAME_LENGTH) return false;
  if (hasControlChar(value)) return false;
  return !FONT_NAME_DENYLIST.test(value);
}

const fontNameSchema = z
  .string()
  .max(MAX_FONT_NAME_LENGTH)
  .refine((v) => v === '' || isSafeFontName(v), { message: 'unsafe font name' });

const settingsSchema = z
  .object({
    View: z
      .object({
        'Dark Mode': z.boolean(),
        'Show Frontmatter': z.boolean(),
        'Show File Tree': z.boolean(),
        'UI Font': fontNameSchema,
        'Code Font': fontNameSchema,
      })
      .strict(),
  })
  .strict();

export type SettingsFile = z.infer<typeof settingsSchema>;

// v1 defaults match today's existing session defaults exactly (confirmed
// with the user -- see functional_domain.md/initial_scaffold.md Task 37).
// Task 55: the two font fields default to '' (no override).
export const defaultSettingsFile: SettingsFile = {
  View: {
    'Dark Mode': false,
    'Show Frontmatter': true,
    'Show File Tree': true,
    'UI Font': '',
    'Code Font': '',
  },
};

// One pass/fail question, never distinguishing "bad JSON" from "bad shape"
// to its caller (functional_domain.md guardrail #104) -- JSON.parse syntax
// errors and zod schema failures both collapse to the same null result.
export function parseSettings(raw: string): SettingsFile | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = settingsSchema.safeParse(parsedJson);
  return result.success ? result.data : null;
}

// Narrow, symmetric adapter functions between the on-disk Title-Case/'View'-
// namespaced shape and the in-memory ViewSettings camelCase shape.
// currentTab is deliberately absent from both directions -- it is not part
// of the persisted schema (functional_domain.md Task 37 intro).
export function toPersistedViewSettings(
  file: SettingsFile
): Pick<ViewSettings, 'darkMode' | 'showFrontmatter' | 'showTreePanel' | 'uiFontFamily' | 'codeFontFamily'> {
  return {
    darkMode: file.View['Dark Mode'],
    showFrontmatter: file.View['Show Frontmatter'],
    showTreePanel: file.View['Show File Tree'],
    uiFontFamily: file.View['UI Font'],
    codeFontFamily: file.View['Code Font'],
  };
}

export function fromViewSettings(
  v: Pick<ViewSettings, 'darkMode' | 'showFrontmatter' | 'showTreePanel' | 'uiFontFamily' | 'codeFontFamily'>
): SettingsFile {
  return {
    View: {
      'Dark Mode': v.darkMode,
      'Show Frontmatter': v.showFrontmatter,
      'Show File Tree': v.showTreePanel,
      'UI Font': v.uiFontFamily,
      'Code Font': v.codeFontFamily,
    },
  };
}

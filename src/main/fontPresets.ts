// Task 56: pure data (same posture as skinPresets.ts, ADR-014). A fixed
// curated list of font names for the View > UI Font / Code Font menus --
// deliberately NOT system font detection/enumeration (no new dependency).
// Zero electron/node imports, zero logic beyond the Default<->'' mapping
// below.

export const UI_FONT_PRESETS: readonly string[] = [
  'Default',
  'Segoe UI',
  'Calibri',
  'Tahoma',
  'Verdana',
  'Georgia',
  'Trebuchet MS',
  'Helvetica',
];

export const CODE_FONT_PRESETS: readonly string[] = [
  'Default',
  'Cascadia Code',
  'Consolas',
  'Fira Code',
  'JetBrains Mono',
  'Source Code Pro',
  'Courier New',
];

// 'Default' is a display-only label: it must never be written to
// settings.json or appear in ViewSettings/the VIEW_SETTINGS payload (#255).
// It maps to '' (no override) in both directions. One definition, used from
// both onSelectUiFont and onSelectCodeFont in src/main/index.ts -- never
// duplicated at the call sites.
export function presetToStored(name: string): string {
  return name === 'Default' ? '' : name;
}

// Does no validation of its own -- that is the caller's job via the
// preset-list `.includes()` guard (onSelectUiFont/onSelectCodeFont in
// index.ts). An unknown stored value is returned unchanged.
export function storedToPreset(stored: string): string {
  return stored === '' ? 'Default' : stored;
}

import type { SkinTokenName } from './skins';

// Pure data (Task 51, ADR-014). The four built-in skins. No logic and no
// imports beyond a type: validation lives in skins.ts, which re-checks every
// value here at the payload choke point (#211) and in unit tests.

export type HalfPaletteData = Record<SkinTokenName, string>;

export interface SkinDefinition {
  readonly name: string;
  readonly palette: { readonly light: HalfPaletteData; readonly dark: HalfPaletteData };
  readonly syntax: { readonly light: string; readonly dark: string };
}

// Default: today's app.css literals, VERBATIM (#212), including the three
// latent Task 50 quirks (#222): dark close-hover-bg/-glyph, and tab-hover-bg
// keeping the light wash in dark mode. A drift test pins this to app.css.
const DEFAULT_SKIN: SkinDefinition = {
  name: 'Default',
  palette: {
    light: {
      '--color-bg-page': 'transparent',
      '--color-bg-chrome': '#f6f8fa',
      '--color-border': '#d0d7de',
      '--color-text-primary': '#24292f',
      '--color-text-muted': '#57606a',
      '--color-text-disabled': '#8c959f',
      '--color-border-disabled': '#d8dee4',
      '--color-text-error': '#cf222e',
      '--color-bg-hover': 'rgba(208, 215, 222, 0.32)',
      '--color-tab-hover-bg': 'rgba(208, 215, 222, 0.32)',
      '--color-accent': '#0969da',
      '--color-bg-accent': 'rgba(9, 105, 218, 0.15)',
      '--color-bg-accent-hover': 'rgba(9, 105, 218, 0.22)',
      '--color-tab-active': '#fd8c73',
      '--color-close-hover-bg': '#e81123',
      '--color-close-hover-glyph': '#ffffff',
    },
    dark: {
      '--color-bg-page': '#0d1117',
      '--color-bg-chrome': '#161b22',
      '--color-border': '#30363d',
      '--color-text-primary': '#c9d1d9',
      '--color-text-muted': '#8b949e',
      '--color-text-disabled': '#6e7681',
      '--color-border-disabled': '#30363d',
      '--color-text-error': '#ff7b72',
      '--color-bg-hover': 'rgba(48, 54, 61, 0.6)',
      '--color-tab-hover-bg': 'rgba(208, 215, 222, 0.32)',
      '--color-accent': '#58a6ff',
      '--color-bg-accent': 'rgba(88, 166, 255, 0.18)',
      '--color-bg-accent-hover': 'rgba(88, 166, 255, 0.28)',
      '--color-tab-active': '#fd8c73',
      '--color-close-hover-bg': 'rgba(48, 54, 61, 0.6)',
      '--color-close-hover-glyph': '#c9d1d9',
    },
  },
  syntax: { light: 'github.css', dark: 'github-dark.css' },
};

// The three new presets use the intended behavior (#222): red/white close
// hover in both modes, and a tab hover wash equal to bg-hover.
const CLAUDE_SKIN: SkinDefinition = {
  name: 'Claude',
  palette: {
    light: {
      '--color-bg-page': '#faf9f5',
      '--color-bg-chrome': '#f0eee6',
      '--color-border': '#ddd9ce',
      '--color-text-primary': '#3d3929',
      '--color-text-muted': '#6b6a60',
      '--color-text-disabled': '#a8a69c',
      '--color-border-disabled': '#e6e3d9',
      '--color-text-error': '#b3261e',
      '--color-bg-hover': 'rgba(61,57,41,0.08)',
      '--color-tab-hover-bg': 'rgba(61,57,41,0.08)',
      '--color-accent': '#d97757',
      '--color-bg-accent': 'rgba(217,119,87,0.14)',
      '--color-bg-accent-hover': 'rgba(217,119,87,0.22)',
      '--color-tab-active': '#d97757',
      '--color-close-hover-bg': '#e81123',
      '--color-close-hover-glyph': '#ffffff',
    },
    dark: {
      '--color-bg-page': '#262624',
      '--color-bg-chrome': '#1f1e1d',
      '--color-border': '#3d3d3a',
      '--color-text-primary': '#e8e6dc',
      '--color-text-muted': '#a09f96',
      '--color-text-disabled': '#6b6a63',
      '--color-border-disabled': '#3d3d3a',
      '--color-text-error': '#f08c85',
      '--color-bg-hover': 'rgba(250,249,245,0.08)',
      '--color-tab-hover-bg': 'rgba(250,249,245,0.08)',
      '--color-accent': '#d97757',
      '--color-bg-accent': 'rgba(217,119,87,0.18)',
      '--color-bg-accent-hover': 'rgba(217,119,87,0.28)',
      '--color-tab-active': '#d97757',
      '--color-close-hover-bg': '#e81123',
      '--color-close-hover-glyph': '#ffffff',
    },
  },
  syntax: { light: 'atom-one-light.css', dark: 'atom-one-dark.css' },
};

const OBSIDIAN_SKIN: SkinDefinition = {
  name: 'Obsidian',
  palette: {
    light: {
      '--color-bg-page': '#ffffff',
      '--color-bg-chrome': '#f5f6f8',
      '--color-border': '#e3e4e8',
      '--color-text-primary': '#2e3338',
      '--color-text-muted': '#6a6f76',
      '--color-text-disabled': '#a5a9ae',
      '--color-border-disabled': '#e9eaed',
      '--color-text-error': '#c4313b',
      '--color-bg-hover': 'rgba(46,51,56,0.07)',
      '--color-tab-hover-bg': 'rgba(46,51,56,0.07)',
      '--color-accent': '#705dcf',
      '--color-bg-accent': 'rgba(112,93,207,0.14)',
      '--color-bg-accent-hover': 'rgba(112,93,207,0.22)',
      '--color-tab-active': '#705dcf',
      '--color-close-hover-bg': '#e81123',
      '--color-close-hover-glyph': '#ffffff',
    },
    dark: {
      '--color-bg-page': '#1e1e1e',
      '--color-bg-chrome': '#262626',
      '--color-border': '#363636',
      '--color-text-primary': '#dadada',
      '--color-text-muted': '#999999',
      '--color-text-disabled': '#5f5f5f',
      '--color-border-disabled': '#363636',
      '--color-text-error': '#fb464c',
      '--color-bg-hover': 'rgba(255,255,255,0.07)',
      '--color-tab-hover-bg': 'rgba(255,255,255,0.07)',
      '--color-accent': '#7f6df2',
      '--color-bg-accent': 'rgba(127,109,242,0.2)',
      '--color-bg-accent-hover': 'rgba(127,109,242,0.3)',
      '--color-tab-active': '#7f6df2',
      '--color-close-hover-bg': '#e81123',
      '--color-close-hover-glyph': '#ffffff',
    },
  },
  syntax: { light: 'stackoverflow-light.css', dark: 'obsidian.css' },
};

const TOKYO_NIGHT_SKIN: SkinDefinition = {
  name: 'Tokyo Night',
  palette: {
    light: {
      '--color-bg-page': '#e6e7ed',
      '--color-bg-chrome': '#d5d6db',
      '--color-border': '#b4b5b9',
      '--color-text-primary': '#343b58',
      '--color-text-muted': '#565a6e',
      '--color-text-disabled': '#9699a3',
      '--color-border-disabled': '#c4c5cb',
      '--color-text-error': '#8c4351',
      '--color-bg-hover': 'rgba(52,59,88,0.08)',
      '--color-tab-hover-bg': 'rgba(52,59,88,0.08)',
      '--color-accent': '#34548a',
      '--color-bg-accent': 'rgba(52,84,138,0.14)',
      '--color-bg-accent-hover': 'rgba(52,84,138,0.22)',
      '--color-tab-active': '#965027',
      '--color-close-hover-bg': '#e81123',
      '--color-close-hover-glyph': '#ffffff',
    },
    dark: {
      '--color-bg-page': '#1a1b26',
      '--color-bg-chrome': '#16161e',
      '--color-border': '#292e42',
      '--color-text-primary': '#c0caf5',
      '--color-text-muted': '#7d82a0',
      '--color-text-disabled': '#4a5072',
      '--color-border-disabled': '#292e42',
      '--color-text-error': '#f7768e',
      '--color-bg-hover': 'rgba(192,202,245,0.08)',
      '--color-tab-hover-bg': 'rgba(192,202,245,0.08)',
      '--color-accent': '#7aa2f7',
      '--color-bg-accent': 'rgba(122,162,247,0.16)',
      '--color-bg-accent-hover': 'rgba(122,162,247,0.26)',
      '--color-tab-active': '#bb9af7',
      '--color-close-hover-bg': '#e81123',
      '--color-close-hover-glyph': '#ffffff',
    },
  },
  syntax: { light: 'tokyo-night-light.css', dark: 'tokyo-night-dark.css' },
};

// Fixed order: this is the order of the built-in radios in the Skin menu.
export const BUILT_IN_SKINS: readonly SkinDefinition[] = [DEFAULT_SKIN, CLAUDE_SKIN, OBSIDIAN_SKIN, TOKYO_NIGHT_SKIN];

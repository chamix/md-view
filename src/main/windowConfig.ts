import type { BrowserWindowConstructorOptions } from 'electron';

export const defaultWindowOptions: BrowserWindowConstructorOptions = {
  width: 900,
  height: 640,
  minWidth: 480,
  minHeight: 320,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
};

export interface StaticWindowSize {
  width: number;
  height: number;
}

// Task 46 (#169): options for createStaticWindow. The size is PICKED by name,
// never spread, so nothing else a caller smuggles in (even via a type cast)
// can reach the constructor; webPreferences is written LAST and always from
// the defaults (sandbox, contextIsolation, no nodeIntegration, no preload).
export function staticWindowOptions(size?: StaticWindowSize): BrowserWindowConstructorOptions {
  return {
    ...defaultWindowOptions,
    ...(size ? { width: size.width, height: size.height } : {}),
    webPreferences: { ...defaultWindowOptions.webPreferences },
  };
}

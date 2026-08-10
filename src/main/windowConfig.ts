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

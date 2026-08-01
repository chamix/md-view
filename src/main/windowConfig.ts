import type { BrowserWindowConstructorOptions } from 'electron';

export const defaultWindowOptions: BrowserWindowConstructorOptions = {
  width: 900,
  height: 640,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
};

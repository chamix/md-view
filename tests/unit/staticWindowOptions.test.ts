import { describe, it, expect } from 'vitest';
import { defaultWindowOptions, staticWindowOptions } from '../../src/main/windowConfig';
import type { StaticWindowSize } from '../../src/main/windowConfig';

// Task 46 (#169): the static-window factory gains a size without weakening
// the #142 lockdown for any caller.
describe('staticWindowOptions', () => {
  it('with no argument deep-equals the pre-Task-46 inline static-window options', () => {
    expect(staticWindowOptions()).toEqual({
      width: 900,
      height: 640,
      minWidth: 480,
      minHeight: 320,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    expect(staticWindowOptions()).toEqual({
      ...defaultWindowOptions,
      webPreferences: { ...defaultWindowOptions.webPreferences },
    });
  });

  it('a size changes only width and height', () => {
    const options = staticWindowOptions({ width: 640, height: 720 });
    expect(options).toEqual({ ...staticWindowOptions(), width: 640, height: 720 });
  });

  it('ignores anything cast into the size beyond width/height (webPreferences, preload, sandbox:false)', () => {
    const hostile = {
      width: 640,
      height: 720,
      webPreferences: { sandbox: false, nodeIntegration: true, contextIsolation: false, preload: 'evil.js' },
      preload: 'evil.js',
      sandbox: false,
      frame: false,
      minWidth: 1,
    } as unknown as StaticWindowSize;

    const options = staticWindowOptions(hostile);

    expect(options).toEqual({ ...staticWindowOptions(), width: 640, height: 720 });
    expect(options.webPreferences).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
  });

  it('webPreferences has no preload and is a fresh copy (never the shared defaults object)', () => {
    const options = staticWindowOptions();
    expect(options.webPreferences).not.toHaveProperty('preload');
    expect(options.webPreferences).not.toBe(defaultWindowOptions.webPreferences);
  });
});

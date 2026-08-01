import { describe, it, expect } from 'vitest';
import { defaultWindowOptions } from '../../src/main/windowConfig';

describe('defaultWindowOptions (window security invariants)', () => {
  it('enforces contextIsolation: true', () => {
    expect(defaultWindowOptions.webPreferences?.contextIsolation).toBe(true);
  });

  it('enforces nodeIntegration: false', () => {
    expect(defaultWindowOptions.webPreferences?.nodeIntegration).toBe(false);
  });
});

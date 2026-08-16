import { describe, it, expect } from 'vitest';
import { shouldCreateHelpWindow } from '../../src/main/helpWindow';

describe('shouldCreateHelpWindow (pure window-identity decision)', () => {
  it('null existing window -> true (no window yet, must create one)', () => {
    expect(shouldCreateHelpWindow(null)).toBe(true);
  });

  it('a destroyed existing window -> true (stale reference, must recreate)', () => {
    expect(shouldCreateHelpWindow({ isDestroyed: () => true })).toBe(true);
  });

  it('a live existing window -> false (reuse it, do not create a second one)', () => {
    expect(shouldCreateHelpWindow({ isDestroyed: () => false })).toBe(false);
  });
});

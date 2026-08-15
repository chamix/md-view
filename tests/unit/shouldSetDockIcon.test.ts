import { describe, it, expect } from 'vitest';
import { shouldSetDockIcon } from '../../src/main/dockIcon';

describe('shouldSetDockIcon (pure dev-mode Dock-icon decision)', () => {
  it('isPackaged: false, platform: darwin -> true', () => {
    expect(shouldSetDockIcon(false, 'darwin')).toBe(true);
  });

  it('isPackaged: true, platform: darwin -> false', () => {
    expect(shouldSetDockIcon(true, 'darwin')).toBe(false);
  });

  it('isPackaged: false, platform: win32 -> false', () => {
    expect(shouldSetDockIcon(false, 'win32')).toBe(false);
  });

  it('isPackaged: false, platform: linux -> false', () => {
    expect(shouldSetDockIcon(false, 'linux')).toBe(false);
  });
});

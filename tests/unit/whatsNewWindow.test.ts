import { describe, it, expect } from 'vitest';
import { shouldCreateWhatsNewWindow, buildWhatsNewMarkdown } from '../../src/main/whatsNewWindow';

describe('shouldCreateWhatsNewWindow (pure window-identity decision)', () => {
  it('null existing window -> true', () => {
    expect(shouldCreateWhatsNewWindow(null)).toBe(true);
  });

  it('a destroyed existing window -> true', () => {
    expect(shouldCreateWhatsNewWindow({ isDestroyed: () => true })).toBe(true);
  });

  it('a live existing window -> false', () => {
    expect(shouldCreateWhatsNewWindow({ isDestroyed: () => false })).toBe(false);
  });
});

describe('buildWhatsNewMarkdown', () => {
  it('prefixes the body with a level-1 heading naming the version', () => {
    expect(buildWhatsNewMarkdown('1.2.0', '### Added\n\n- Thing')).toBe(
      "# What's New in md-view 1.2.0\n\n### Added\n\n- Thing"
    );
  });
});

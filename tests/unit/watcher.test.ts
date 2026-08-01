import { describe, it, expect } from 'vitest';
import { classifyWatchEvent } from '../../src/main/watcher';

describe('classifyWatchEvent (pure translation)', () => {
  it('maps "change" to "render"', () => {
    expect(classifyWatchEvent('change')).toBe('render');
  });

  it('maps "unlink" to "error"', () => {
    expect(classifyWatchEvent('unlink')).toBe('error');
  });

  it.each(['add', 'addDir', 'unlinkDir', 'ready', 'raw', 'some-unknown-event'])(
    'maps "%s" to "ignore"',
    (event) => {
      expect(classifyWatchEvent(event)).toBe('ignore');
    }
  );
});

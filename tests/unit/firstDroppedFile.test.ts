import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { firstDroppedFile } = require('../../src/renderer/renderer.js');

describe('firstDroppedFile (pure drop-target selection)', () => {
  it('empty array -> null', () => {
    expect(firstDroppedFile([])).toBe(null);
  });

  it('single-item array -> that item', () => {
    const item = { name: 'a' };
    expect(firstDroppedFile([item])).toBe(item);
  });

  it('multi-item array -> specifically index 0, not the last item', () => {
    const a = { name: 'a' };
    const b = { name: 'b' };
    const c = { name: 'c' };
    expect(firstDroppedFile([a, b, c])).toBe(a);
  });

  it('null/undefined -> null', () => {
    expect(firstDroppedFile(null)).toBe(null);
    expect(firstDroppedFile(undefined)).toBe(null);
  });
});

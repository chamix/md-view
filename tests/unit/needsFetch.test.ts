import { describe, it, expect } from 'vitest';
import { needsFetch } from '../../src/renderer/renderer.js';

describe('needsFetch (pure fetch-or-reveal caching predicate)', () => {
  it('a children container with zero child nodes has never been fetched -> true', () => {
    expect(needsFetch(0)).toBe(true);
  });

  it('a children container with real entry rows has already been fetched -> false', () => {
    expect(needsFetch(3)).toBe(false);
  });

  it('a children container with exactly one row (single entry, or the lone error/empty indicator row) has already been fetched -> false', () => {
    expect(needsFetch(1)).toBe(false);
  });
});

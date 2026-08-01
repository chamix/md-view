import { describe, it, expect } from 'vitest';
import { bridgeApi } from '../../src/preload/api';

describe('bridgeApi (preload contract)', () => {
  it('is a plain object', () => {
    expect(typeof bridgeApi).toBe('object');
    expect(bridgeApi).not.toBeNull();
  });

  it('exposes a string version marker', () => {
    expect(typeof bridgeApi.version).toBe('string');
  });
});

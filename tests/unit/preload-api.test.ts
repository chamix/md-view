import { describe, it, expect } from 'vitest';
import { bridgeApi, IPC_CHANNELS } from '../../src/preload/api';

describe('bridgeApi (preload contract)', () => {
  it('is a plain object', () => {
    expect(typeof bridgeApi).toBe('object');
    expect(bridgeApi).not.toBeNull();
  });

  it('exposes a string version marker', () => {
    expect(typeof bridgeApi.version).toBe('string');
  });
});

describe('IPC_CHANNELS.SKIN (Task 51)', () => {
  it('is the md-view:skin push channel', () => {
    expect(IPC_CHANNELS.SKIN).toBe('md-view:skin');
  });
});

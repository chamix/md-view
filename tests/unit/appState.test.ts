import { describe, it, expect } from 'vitest';
import { parseAppState, decideWhatsNew } from '../../src/main/appState';

describe('parseAppState (strict, all-or-nothing)', () => {
  it('accepts a valid state', () => {
    expect(parseAppState('{"lastSeenVersion":"1.1.0"}')).toEqual({ lastSeenVersion: '1.1.0' });
  });

  it('returns null for invalid JSON', () => {
    expect(parseAppState('{ not json')).toBeNull();
    expect(parseAppState('')).toBeNull();
  });

  it('returns null for array / null / string / number JSON', () => {
    expect(parseAppState('[]')).toBeNull();
    expect(parseAppState('null')).toBeNull();
    expect(parseAppState('"1.1.0"')).toBeNull();
    expect(parseAppState('1')).toBeNull();
  });

  it('returns null when the key is missing', () => {
    expect(parseAppState('{}')).toBeNull();
  });

  it('returns null when an unknown extra key is present', () => {
    expect(parseAppState('{"lastSeenVersion":"1.1.0","extra":true}')).toBeNull();
  });

  it('returns null for a non-string or empty-string value', () => {
    expect(parseAppState('{"lastSeenVersion":1}')).toBeNull();
    expect(parseAppState('{"lastSeenVersion":""}')).toBeNull();
    expect(parseAppState('{"lastSeenVersion":null}')).toBeNull();
  });
});

describe('decideWhatsNew (pure announcement decision)', () => {
  it('no recorded version -> first-launch', () => {
    expect(decideWhatsNew(null, '1.1.0')).toBe('first-launch');
  });

  it('same version -> up-to-date', () => {
    expect(decideWhatsNew('1.1.0', '1.1.0')).toBe('up-to-date');
  });

  it('different (newer) version -> announce', () => {
    expect(decideWhatsNew('1.0.0', '1.1.0')).toBe('announce');
  });

  it('a downgrade is also announce: inequality, not ordering', () => {
    expect(decideWhatsNew('2.0.0', '1.1.0')).toBe('announce');
  });
});

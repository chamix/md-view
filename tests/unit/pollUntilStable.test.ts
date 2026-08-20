import { describe, it, expect, vi } from 'vitest';
import { sameValues, pollUntilStable } from '../../tests/e2e/support/pollUntilStable';

describe('sameValues (strict-equal on every key)', () => {
  it('returns true when every key matches', () => {
    expect(sameValues({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it('returns false when any key differs', () => {
    expect(sameValues({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
  });
});

describe('pollUntilStable (deterministic, fake read())', () => {
  it('settles once the fake read() becomes genuinely stable after some changing values', async () => {
    // Changing for the first 3 calls, then stable forever after.
    const sequence = [
      { marginLeft: 10, marginRight: 10 },
      { marginLeft: 15, marginRight: 15 },
      { marginLeft: 20, marginRight: 20 },
      { marginLeft: 32, marginRight: 32 },
      { marginLeft: 32, marginRight: 32 },
      { marginLeft: 32, marginRight: 32 },
      { marginLeft: 32, marginRight: 32 },
    ];
    let call = 0;
    const read = vi.fn(async () => sequence[Math.min(call++, sequence.length - 1)]);

    const result = await pollUntilStable(read, { stableReads: 3, intervalMs: 1, timeoutMs: 1000 });

    expect(result).toEqual({ marginLeft: 32, marginRight: 32 });
  });

  it('returns as soon as N-in-a-row match, proven via the fake read()\'s call count, not over-polling past stability', async () => {
    // First call: 5. Calls 2-4 (3 in a row): 32. Should stop exactly at
    // call 4 (1 initial read + 3 stable reads) and never call read() again,
    // even though a 5th, different value is queued right behind it.
    const sequence = [
      { marginLeft: 5 },
      { marginLeft: 32 },
      { marginLeft: 32 },
      { marginLeft: 32 },
      { marginLeft: 999 },
    ];
    let call = 0;
    const read = vi.fn(async () => sequence[call++]);

    const result = await pollUntilStable(read, { stableReads: 3, intervalMs: 1, timeoutMs: 1000 });

    expect(result).toEqual({ marginLeft: 32 });
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('throws a clear error naming the last-seen value when read() never stabilizes within timeoutMs', async () => {
    let call = 0;
    // Every value is different from the last — never stabilizes.
    const read = vi.fn(async () => ({ marginLeft: call++ }));

    await expect(
      pollUntilStable(read, { stableReads: 5, intervalMs: 5, timeoutMs: 50 }),
    ).rejects.toThrow(/pollUntilStable: value never stabilized within 50ms/);
  });
});

// Electron-free leaf module: no Playwright, DOM, or Electron imports.
// A caller supplies a `read()` closure (typically wrapping a real
// Playwright `.evaluate()` call); this helper knows nothing about where
// the values come from, only whether they've stopped changing.

export function sameValues<T extends Record<string, number>>(a: T, b: T): boolean {
  return (Object.keys(a) as Array<keyof T>).every((key) => a[key] === b[key]);
}

export async function pollUntilStable<T extends Record<string, number>>(
  read: () => Promise<T>,
  options?: { stableReads?: number; intervalMs?: number; timeoutMs?: number },
): Promise<T> {
  const stableReads = options?.stableReads ?? 5;
  const intervalMs = options?.intervalMs ?? 20;
  const timeoutMs = options?.timeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;

  let last = await read();
  let consecutive = 1;

  while (consecutive < stableReads) {
    if (Date.now() > deadline) {
      throw new Error(
        `pollUntilStable: value never stabilized within ${timeoutMs}ms (last read: ${JSON.stringify(last)})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const next = await read();
    consecutive = sameValues(next, last) ? consecutive + 1 : 1;
    last = next;
  }

  return last;
}

import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS } from '../../src/preload/api';
import type { FileRenderedOk } from '../../src/preload/api';

describe('IPC_CHANNELS (preload/main contract)', () => {
  it('exposes non-empty string channel names', () => {
    expect(typeof IPC_CHANNELS.OPEN_FILE_DIALOG).toBe('string');
    expect(IPC_CHANNELS.OPEN_FILE_DIALOG.length).toBeGreaterThan(0);

    expect(typeof IPC_CHANNELS.FILE_RENDERED).toBe('string');
    expect(IPC_CHANNELS.FILE_RENDERED.length).toBeGreaterThan(0);
  });

  it('uses distinct channel names', () => {
    expect(IPC_CHANNELS.OPEN_FILE_DIALOG).not.toBe(IPC_CHANNELS.FILE_RENDERED);
  });
});

describe('FileRenderedOk (Task 4: baseUrl field)', () => {
  // Honest limitation: FileRenderedOk is a TypeScript interface, erased at
  // compile time — it has no runtime representation, so this test cannot
  // "catch" a removed/renamed baseUrl field by itself the way a runtime
  // check on IPC_CHANNELS' string constants can. The real protection against
  // that regression is `tsc --strict` (via `npm run build`): if baseUrl were
  // removed from the interface or this literal stopped satisfying it, the
  // `: FileRenderedOk` annotation below would fail to compile. What this
  // test does prove is that the shape is usable as claimed at runtime.
  it('is constructible with a baseUrl and the field is readable', () => {
    const sample: FileRenderedOk = {
      ok: true,
      filePath: '/some/dir/doc.md',
      html: '<h1>Hello</h1>',
      baseUrl: 'file:///some/dir/',
    };

    expect(sample.baseUrl).toBe('file:///some/dir/');
  });
});

import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS } from '../../src/preload/api';
import type { BridgeApi, FileRenderedOk } from '../../src/preload/api';

describe('IPC_CHANNELS (preload/main contract)', () => {
  it('exposes non-empty string channel names', () => {
    expect(typeof IPC_CHANNELS.FILE_RENDERED).toBe('string');
    expect(IPC_CHANNELS.FILE_RENDERED.length).toBeGreaterThan(0);

    expect(typeof IPC_CHANNELS.VIEW_SETTINGS).toBe('string');
    expect(IPC_CHANNELS.VIEW_SETTINGS.length).toBeGreaterThan(0);

    expect(typeof IPC_CHANNELS.REQUEST_OPEN_FILE).toBe('string');
    expect(IPC_CHANNELS.REQUEST_OPEN_FILE.length).toBeGreaterThan(0);
  });

  it('FILE_RENDERED and VIEW_SETTINGS are distinct channel names', () => {
    expect(IPC_CHANNELS.VIEW_SETTINGS).not.toBe(IPC_CHANNELS.FILE_RENDERED);
  });

  it('REQUEST_OPEN_FILE is distinct from FILE_RENDERED and VIEW_SETTINGS', () => {
    expect(IPC_CHANNELS.REQUEST_OPEN_FILE).not.toBe(IPC_CHANNELS.FILE_RENDERED);
    expect(IPC_CHANNELS.REQUEST_OPEN_FILE).not.toBe(IPC_CHANNELS.VIEW_SETTINGS);
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
      frontmatter: null,
    };

    expect(sample.baseUrl).toBe('file:///some/dir/');
  });
});

describe('BridgeApi (Task 16: openDroppedFile field)', () => {
  // Honest limitation: same as FileRenderedOk above — BridgeApi is a
  // TypeScript interface, erased at compile time, so this test cannot by
  // itself "catch" a removed/renamed openDroppedFile field the way a
  // runtime check on IPC_CHANNELS' string constants can. The real
  // protection against that regression is `tsc --strict` (via `npm run
  // build`): if openDroppedFile were removed from the interface or this
  // literal stopped satisfying it, the `: BridgeApi` annotation below would
  // fail to compile. What this test does prove is that the shape is usable
  // as claimed at runtime.
  it('is constructible with an openDroppedFile method and it is callable', () => {
    let received: File | null = null;
    const sample: BridgeApi = {
      version: '0.0.0-test',
      onFileRendered: () => {},
      onViewSettings: () => {},
      openDroppedFile: (file) => {
        received = file;
      },
    };

    const fakeFile = { name: 'doc.md' } as unknown as File;
    sample.openDroppedFile(fakeFile);
    expect(received).toBe(fakeFile);
  });
});

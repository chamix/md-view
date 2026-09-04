import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS } from '../../src/preload/api';
import type {
  BridgeApi,
  FileRenderedOk,
  DirectoryListResult,
  FolderTreeRootMessage,
  DocumentTab,
} from '../../src/preload/api';

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

describe('Task 17: file tree channels/shape', () => {
  it('exposes non-empty string channel names for FOLDER_TREE_ROOT and REQUEST_LIST_DIRECTORY', () => {
    expect(typeof IPC_CHANNELS.FOLDER_TREE_ROOT).toBe('string');
    expect(IPC_CHANNELS.FOLDER_TREE_ROOT.length).toBeGreaterThan(0);

    expect(typeof IPC_CHANNELS.REQUEST_LIST_DIRECTORY).toBe('string');
    expect(IPC_CHANNELS.REQUEST_LIST_DIRECTORY.length).toBeGreaterThan(0);
  });

  it('FOLDER_TREE_ROOT and REQUEST_LIST_DIRECTORY are distinct from every existing channel and each other', () => {
    const existing = [IPC_CHANNELS.FILE_RENDERED, IPC_CHANNELS.VIEW_SETTINGS, IPC_CHANNELS.REQUEST_OPEN_FILE];

    expect(existing).not.toContain(IPC_CHANNELS.FOLDER_TREE_ROOT);
    expect(existing).not.toContain(IPC_CHANNELS.REQUEST_LIST_DIRECTORY);
    expect(IPC_CHANNELS.FOLDER_TREE_ROOT).not.toBe(IPC_CHANNELS.REQUEST_LIST_DIRECTORY);
  });

  // Honest limitation: same as FileRenderedOk/BridgeApi above -- these are
  // TypeScript interfaces, erased at compile time, so this test cannot by
  // itself "catch" a removed/renamed field the way a runtime check on
  // IPC_CHANNELS' string constants can. Real protection comes from
  // `tsc --strict` (via `npm run build`); this test proves the shape is
  // usable as claimed at runtime.
  it('is constructible with onFolderTreeRoot/listDirectory methods and they are callable', async () => {
    let received: FolderTreeRootMessage | null = null;
    const sample: BridgeApi = {
      version: '0.0.0-test',
      onFileRendered: () => {},
      onViewSettings: () => {},
      openDroppedFile: () => {},
      onFolderTreeRoot: (callback) => {
        callback({ ok: true, rootPath: '/some/dir', entries: [] });
      },
      listDirectory: async (dirPath) => {
        const result: DirectoryListResult = { ok: true, dirPath, entries: [] };
        return result;
      },
    };

    sample.onFolderTreeRoot((message) => {
      received = message;
    });
    expect(received).toEqual({ ok: true, rootPath: '/some/dir', entries: [] });

    const listResult = await sample.listDirectory('/some/dir');
    expect(listResult).toEqual({ ok: true, dirPath: '/some/dir', entries: [] });
  });
});

describe('Task 33: codeHtml field / SELECT_TAB channel', () => {
  it('exposes a non-empty string channel name for SELECT_TAB, distinct from every other existing channel', () => {
    expect(typeof IPC_CHANNELS.SELECT_TAB).toBe('string');
    expect(IPC_CHANNELS.SELECT_TAB.length).toBeGreaterThan(0);

    const existing = [
      IPC_CHANNELS.FILE_RENDERED,
      IPC_CHANNELS.VIEW_SETTINGS,
      IPC_CHANNELS.REQUEST_OPEN_FILE,
      IPC_CHANNELS.FOLDER_TREE_ROOT,
      IPC_CHANNELS.REQUEST_LIST_DIRECTORY,
      IPC_CHANNELS.REQUEST_TREE_PARENT,
      IPC_CHANNELS.MINIMIZE_WINDOW,
      IPC_CHANNELS.TOGGLE_MAXIMIZE_WINDOW,
      IPC_CHANNELS.CLOSE_WINDOW,
      IPC_CHANNELS.POPUP_MENU,
      IPC_CHANNELS.WINDOW_MAXIMIZED_STATE,
    ];
    expect(existing).not.toContain(IPC_CHANNELS.SELECT_TAB);
  });

  // Honest limitation: same as FileRenderedOk/BridgeApi above -- these are
  // TypeScript interfaces, erased at compile time, so this test cannot by
  // itself "catch" a removed/renamed field the way a runtime check on
  // IPC_CHANNELS' string constants can. Real protection comes from
  // `tsc --strict` (via `npm run build`); this test proves the shape is
  // usable as claimed at runtime.
  it('FileRenderedOk is constructible with a codeHtml field and the field is readable', () => {
    const sample: FileRenderedOk = {
      ok: true,
      filePath: '/some/dir/doc.md',
      html: '<h1>Hello</h1>',
      codeHtml: '<pre><code class="hljs language-markdown"># Hello</code></pre>',
      baseUrl: 'file:///some/dir/',
      frontmatter: null,
    };

    expect(sample.codeHtml).toContain('hljs');
  });

  // Honest limitation: same as above -- BridgeApi is a TypeScript interface,
  // erased at compile time. What this proves is that a selectTab method is
  // usable as claimed at runtime; `tsc --strict` proves the interface shape
  // itself.
  it('BridgeApi is constructible with a selectTab method and it is callable', () => {
    let received: DocumentTab | null = null;
    const sample: BridgeApi = {
      version: '0.0.0-test',
      onFileRendered: () => {},
      onViewSettings: () => {},
      openDroppedFile: () => {},
      selectTab: (tab) => {
        received = tab;
      },
    };

    sample.selectTab('code');
    expect(received).toBe('code');
  });
});

describe('Task 34: COPY_RAW_SOURCE channel / copyRawSource method', () => {
  it('exposes a non-empty string channel name for COPY_RAW_SOURCE, distinct from every other existing channel', () => {
    expect(typeof IPC_CHANNELS.COPY_RAW_SOURCE).toBe('string');
    expect(IPC_CHANNELS.COPY_RAW_SOURCE.length).toBeGreaterThan(0);

    const existing = [
      IPC_CHANNELS.FILE_RENDERED,
      IPC_CHANNELS.VIEW_SETTINGS,
      IPC_CHANNELS.REQUEST_OPEN_FILE,
      IPC_CHANNELS.FOLDER_TREE_ROOT,
      IPC_CHANNELS.REQUEST_LIST_DIRECTORY,
      IPC_CHANNELS.REQUEST_TREE_PARENT,
      IPC_CHANNELS.MINIMIZE_WINDOW,
      IPC_CHANNELS.TOGGLE_MAXIMIZE_WINDOW,
      IPC_CHANNELS.CLOSE_WINDOW,
      IPC_CHANNELS.POPUP_MENU,
      IPC_CHANNELS.WINDOW_MAXIMIZED_STATE,
      IPC_CHANNELS.SELECT_TAB,
    ];
    expect(existing).not.toContain(IPC_CHANNELS.COPY_RAW_SOURCE);
  });

  // Honest limitation: same as above -- BridgeApi is a TypeScript interface,
  // erased at compile time. What this proves is that a copyRawSource method
  // is usable as claimed at runtime, request-response shaped (a Promise it
  // must be awaited); `tsc --strict` proves the interface shape itself.
  it('BridgeApi is constructible with a copyRawSource method and it resolves with the request-response result', async () => {
    let received: string | null = null;
    const sample: BridgeApi = {
      version: '0.0.0-test',
      onFileRendered: () => {},
      onViewSettings: () => {},
      openDroppedFile: () => {},
      copyRawSource: async (text) => {
        received = text;
        return true;
      },
    };

    const ok = await sample.copyRawSource('# Hello\n');
    expect(ok).toBe(true);
    expect(received).toBe('# Hello\n');
  });
});

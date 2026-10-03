export const bridgeApi = { version: '0.0.0-scaffold' } as const;

export const IPC_CHANNELS = {
  FILE_RENDERED: 'md-view:file-rendered',
  VIEW_SETTINGS: 'md-view:view-settings',
  REQUEST_OPEN_FILE: 'md-view:request-open-file',
  FOLDER_TREE_ROOT: 'md-view:folder-tree-root',
  REQUEST_LIST_DIRECTORY: 'md-view:request-list-directory',
  REQUEST_TREE_PARENT: 'md-view:request-tree-parent',
  MINIMIZE_WINDOW: 'md-view:minimize-window',
  TOGGLE_MAXIMIZE_WINDOW: 'md-view:toggle-maximize-window',
  CLOSE_WINDOW: 'md-view:close-window',
  POPUP_MENU: 'md-view:popup-menu',
  WINDOW_MAXIMIZED_STATE: 'md-view:window-maximized-state',
  SELECT_TAB: 'md-view:select-tab',
  COPY_RAW_SOURCE: 'md-view:copy-raw-source',
  // Task 44: main -> renderer push, zero payload. Its arrival is the whole
  // fact ("the document slot is now empty"); not a FileRenderedMessage variant.
  DOCUMENT_CLOSED: 'md-view:document-closed',
  // Task 49 (#202 amended, ADR-013 D2): renderer -> main, fire-and-forget,
  // same shape as POPUP_MENU -- a target-classification descriptor only,
  // never clipboard content.
  POPUP_COPY_MENU: 'md-view:popup-copy-menu',
  // Task 49: main -> renderer push, fire-and-forget, payload is the action
  // name only ('copy' | 'copy-all') -- mirrors DOCUMENT_CLOSED's near-zero
  // payload style. No clipboard content ever crosses this channel either.
  COPY_COMMAND: 'md-view:copy-command',
  // Task 51 (#223, ADR-014): main -> renderer push of the active skin. One
  // channel, payload ResolvedSkin; no new renderer -> main surface.
  SKIN: 'md-view:skin',
} as const;

// Task 51: what crosses to the renderer. Main re-validates every color and
// filename (toSkinPayload) immediately before sending; the renderer re-checks
// again before applying. Carries no file paths and no raw file content.
export interface ResolvedSkin {
  name: string;
  palette: { light: Record<string, string>; dark: Record<string, string> };
  syntax: { light: string; dark: string };
}

export type DocumentTab = 'preview' | 'code';

export interface FileRenderedOk {
  ok: true;
  filePath: string;
  html: string;
  codeHtml: string;
  baseUrl: string;
  frontmatter: string | null;
}

export interface FileRenderedError {
  ok: false;
  filePath: string | null;
  error: string;
}

export type FileRenderedMessage = FileRenderedOk | FileRenderedError;

export interface ViewSettings {
  darkMode: boolean;
  showFrontmatter: boolean;
  showTreePanel: boolean;
  currentTab: DocumentTab;
}

export interface TreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

export interface DirectoryListOk {
  ok: true;
  dirPath: string;
  entries: TreeEntry[];
}

export interface DirectoryListError {
  ok: false;
  dirPath: string;
  error: string;
}

export type DirectoryListResult = DirectoryListOk | DirectoryListError;

export interface FolderTreeRootOk {
  ok: true;
  rootPath: string;
  entries: TreeEntry[];
}

export interface FolderTreeRootError {
  ok: false;
  rootPath: string;
  error: string;
}

export type FolderTreeRootMessage = FolderTreeRootOk | FolderTreeRootError;

export interface BridgeApi {
  readonly version: string;
  onFileRendered(callback: (message: FileRenderedMessage) => void): void;
  onViewSettings(callback: (settings: ViewSettings) => void): void;
  openDroppedFile(file: File): void;
  onFolderTreeRoot(callback: (message: FolderTreeRootMessage) => void): void;
  listDirectory(dirPath: string): Promise<DirectoryListResult>;
  openFileByPath(filePath: string): void;
  requestTreeParent(): void;
  minimizeWindow(): void;
  toggleMaximizeWindow(): void;
  closeWindow(): void;
  popupMenu(section: 'file' | 'view' | 'help', x: number, y: number): void;
  onWindowMaximizedState(callback: (isMaximized: boolean) => void): void;
  selectTab(tab: DocumentTab): void;
  copyRawSource(text: string): Promise<boolean>;
  onDocumentClosed(callback: () => void): void;
  // Task 49 (#202 amended, ADR-013 D2): renderer -> main, fire-and-forget.
  // `target` carries only enough for main to gate enabled state (#201) --
  // never clipboard content.
  popupCopyMenu(target: { hasCopyTarget: boolean; documentOpen: boolean }, x: number, y: number): void;
  // Task 49: main -> renderer push, fire-and-forget, payload is the action
  // name only. The renderer already knows the copy target; it builds
  // { text, html } itself and writes via navigator.clipboard.write()
  // (D2/ADR-013) -- main never sees text/html.
  onCopyCommand(callback: (action: 'copy' | 'copy-all') => void): void;
  // Task 51 (#223): main -> renderer push of the active skin.
  onSkin(callback: (skin: ResolvedSkin) => void): void;
}

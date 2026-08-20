export const bridgeApi = { version: '0.0.0-scaffold' } as const;

export const IPC_CHANNELS = {
  FILE_RENDERED: 'md-view:file-rendered',
  VIEW_SETTINGS: 'md-view:view-settings',
  REQUEST_OPEN_FILE: 'md-view:request-open-file',
  FOLDER_TREE_ROOT: 'md-view:folder-tree-root',
  REQUEST_LIST_DIRECTORY: 'md-view:request-list-directory',
} as const;

export interface FileRenderedOk {
  ok: true;
  filePath: string;
  html: string;
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
}

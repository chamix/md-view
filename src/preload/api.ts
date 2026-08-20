export const bridgeApi = { version: '0.0.0-scaffold' } as const;

export const IPC_CHANNELS = {
  FILE_RENDERED: 'md-view:file-rendered',
  VIEW_SETTINGS: 'md-view:view-settings',
  REQUEST_OPEN_FILE: 'md-view:request-open-file',
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

export interface BridgeApi {
  readonly version: string;
  onFileRendered(callback: (message: FileRenderedMessage) => void): void;
  onViewSettings(callback: (settings: ViewSettings) => void): void;
  openDroppedFile(file: File): void;
}

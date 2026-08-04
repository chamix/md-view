export const bridgeApi = { version: '0.0.0-scaffold' } as const;

export const IPC_CHANNELS = {
  FILE_RENDERED: 'md-view:file-rendered',
} as const;

export interface FileRenderedOk {
  ok: true;
  filePath: string;
  html: string;
  baseUrl: string;
}

export interface FileRenderedError {
  ok: false;
  filePath: string | null;
  error: string;
}

export type FileRenderedMessage = FileRenderedOk | FileRenderedError;

export interface BridgeApi {
  readonly version: string;
  onFileRendered(callback: (message: FileRenderedMessage) => void): void;
}

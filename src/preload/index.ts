import { contextBridge, ipcRenderer } from 'electron';
import { bridgeApi, IPC_CHANNELS } from './api';
import type { BridgeApi, FileRenderedMessage } from './api';

const api: BridgeApi = {
  version: bridgeApi.version,
  openFileDialog: () => {
    ipcRenderer.send(IPC_CHANNELS.OPEN_FILE_DIALOG);
  },
  onFileRendered: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.FILE_RENDERED, (_event, message: FileRenderedMessage) => callback(message));
  },
};

contextBridge.exposeInMainWorld('mdview', api);

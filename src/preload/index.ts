import { contextBridge, ipcRenderer } from 'electron';
import { bridgeApi, IPC_CHANNELS } from './api';
import type { BridgeApi, FileRenderedMessage, ViewSettings } from './api';

const api: BridgeApi = {
  version: bridgeApi.version,
  onFileRendered: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.FILE_RENDERED, (_event, message: FileRenderedMessage) => callback(message));
  },
  onViewSettings: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.VIEW_SETTINGS, (_event, settings: ViewSettings) => callback(settings));
  },
};

contextBridge.exposeInMainWorld('mdview', api);

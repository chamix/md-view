import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { bridgeApi, IPC_CHANNELS } from './api';
import type { BridgeApi, FileRenderedMessage, ViewSettings, FolderTreeRootMessage } from './api';

const api: BridgeApi = {
  version: bridgeApi.version,
  onFileRendered: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.FILE_RENDERED, (_event, message: FileRenderedMessage) => callback(message));
  },
  onViewSettings: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.VIEW_SETTINGS, (_event, settings: ViewSettings) => callback(settings));
  },
  openDroppedFile: (file) => {
    const filePath = webUtils.getPathForFile(file);
    ipcRenderer.send(IPC_CHANNELS.REQUEST_OPEN_FILE, filePath);
  },
  onFolderTreeRoot: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.FOLDER_TREE_ROOT, (_event, message: FolderTreeRootMessage) => callback(message));
  },
  listDirectory: (dirPath) => {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUEST_LIST_DIRECTORY, dirPath);
  },
  openFileByPath: (filePath) => {
    ipcRenderer.send(IPC_CHANNELS.REQUEST_OPEN_FILE, filePath);
  },
  requestTreeParent: () => {
    ipcRenderer.send(IPC_CHANNELS.REQUEST_TREE_PARENT);
  },
};

contextBridge.exposeInMainWorld('mdview', api);

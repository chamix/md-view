import { contextBridge } from 'electron';
import { bridgeApi } from './api';

contextBridge.exposeInMainWorld('mdview', bridgeApi);

// Narrow, explicit bridge. No Node APIs, no raw ipcRenderer reach the UI.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hearth', {
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  appInfo: () => ipcRenderer.invoke('app:info'),

  providerStatus: () => ipcRenderer.invoke('providers:status'),
  setKey: (provider, key) => ipcRenderer.invoke('providers:setKey', provider, key),
  removeKey: (provider) => ipcRenderer.invoke('providers:removeKey', provider),
  ask: (provider, model, prompt) => ipcRenderer.invoke('providers:ask', provider, model, prompt),

  updaterInfo: () => ipcRenderer.invoke('updater:info'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdaterStatus: (cb) => {
    const listener = (_e, status) => cb(status);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
});

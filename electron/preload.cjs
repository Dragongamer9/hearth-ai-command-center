// Narrow, explicit bridge. No Node APIs, no raw ipcRenderer reach the UI.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hearth', {
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  appInfo: () => ipcRenderer.invoke('app:info'),
  backups: () => ipcRenderer.invoke('state:backups'),
  restoreBackup: (n) => ipcRenderer.invoke('state:restore', n),
  exportAll: (state) => ipcRenderer.invoke('state:export', state),

  providerStatus: () => ipcRenderer.invoke('providers:status'),
  setKey: (provider, key) => ipcRenderer.invoke('providers:setKey', provider, key),
  removeKey: (provider) => ipcRenderer.invoke('providers:removeKey', provider),
  ask: (provider, model, prompt) => ipcRenderer.invoke('providers:ask', provider, model, prompt),

  settings: () => ipcRenderer.invoke('settings:get'),
  setConnection: (agent, method) => ipcRenderer.invoke('settings:setConnection', agent, method),
  pickProject: () => ipcRenderer.invoke('settings:pickProject'),
  pickBinary: (agent) => ipcRenderer.invoke('settings:pickBinary', agent),
  useProject: (dir) => ipcRenderer.invoke('settings:useProject', dir),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  addDir: () => ipcRenderer.invoke('settings:addDir'),
  removeDir: (dir) => ipcRenderer.invoke('settings:removeDir', dir),
  gitTools: () => ipcRenderer.invoke('git:tools'),
  gitLogin: () => ipcRenderer.invoke('git:login'),
  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitPull: () => ipcRenderer.invoke('git:pull'),
  gitPushTask: (taskId) => ipcRenderer.invoke('git:pushTask', taskId),
  gitPushBranch: (branch) => ipcRenderer.invoke('git:pushBranch', branch),
  gitMergeApproved: (taskId) => ipcRenderer.invoke('git:mergeApproved', taskId),
  gitOpenPr: (taskId, title, body) => ipcRenderer.invoke('git:openPr', taskId, title, body),
  gitClone: (input) => ipcRenderer.invoke('git:clone', input),
  agentStatus: (agent) => ipcRenderer.invoke('agents:status', agent),
  agentLogin: (agent) => ipcRenderer.invoke('agents:login', agent),
  agentInstall: (agent) => ipcRenderer.invoke('agents:install', agent),
  agentLogout: (agent) => ipcRenderer.invoke('agents:logout', agent),
  run: (opts) => ipcRenderer.invoke('agents:run', opts),
  cancelRun: (runId) => ipcRenderer.invoke('agents:cancel', runId),
  ensureWorkspace: (taskId, title) => ipcRenderer.invoke('workspace:ensure', taskId, title),
  checkpoint: (taskId, author, message) => ipcRenderer.invoke('workspace:checkpoint', taskId, author, message),
  workspaceSummary: (taskId, baseSha) => ipcRenderer.invoke('workspace:summary', taskId, baseSha),
  openWorkspace: (taskId) => ipcRenderer.invoke('workspace:open', taskId),
  openFreebuff: (taskId, brief) => ipcRenderer.invoke('workspace:openFreebuff', taskId, brief),

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

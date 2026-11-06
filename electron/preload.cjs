// Narrow, explicit bridge. No Node APIs, no raw ipcRenderer reach the UI.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hearth', {
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  appInfo: () => ipcRenderer.invoke('app:info'),
  reloadWindow: () => ipcRenderer.invoke('app:reload'),
  backups: () => ipcRenderer.invoke('state:backups'),
  restoreBackup: (n) => ipcRenderer.invoke('state:restore', n),
  exportAll: (state) => ipcRenderer.invoke('state:export', state),
  stateHealth: () => ipcRenderer.invoke('state:health'),
  chatsList: () => ipcRenderer.invoke('chats:list'),
  chatsCreate: (projectId) => ipcRenderer.invoke('chats:create', projectId),
  chatsGet: (id) => ipcRenderer.invoke('chats:get', id),
  chatsSave: (id, data) => ipcRenderer.invoke('chats:save', id, data),
  chatsUpdate: (id, patch) => ipcRenderer.invoke('chats:update', id, patch),
  chatsReorder: (ids) => ipcRenderer.invoke('chats:reorder', ids),
  chatsDelete: (id) => ipcRenderer.invoke('chats:delete', id),
  chatsTrash: () => ipcRenderer.invoke('chats:trash'),
  chatsRestore: (trashId) => ipcRenderer.invoke('chats:restore', trashId),
  // 2.x chats (electron/v2.cjs)
  v2Boot: () => ipcRenderer.invoke('v2:boot'),
  chatsList2: () => ipcRenderer.invoke('chats:list2'),
  chatsCreate2: (o) => ipcRenderer.invoke('chats:create2', o || {}),
  chatsGet2: (id) => ipcRenderer.invoke('chats:get2', id),
  chatsSearch: (q) => ipcRenderer.invoke('chats:search', q),
  chatsConnect: (id, conn) => ipcRenderer.invoke('chats:connect', id, conn),
  chatsDelete2: (id, opts) => ipcRenderer.invoke('chats:delete2', id, opts || {}),
  chatRun: (o) => ipcRenderer.invoke('chat:run', o),
  chatCancel: (chatId) => ipcRenderer.invoke('chat:cancel', chatId),
  chatChanges: (id) => ipcRenderer.invoke('chat:changes', id),
  chatDiff: (id) => ipcRenderer.invoke('chat:diff', id),
  chatPush: (id) => ipcRenderer.invoke('chat:push', id),
  chatPr: (id, o) => ipcRenderer.invoke('chat:pr', id, o || {}),
  chatMerge: (id, o) => ipcRenderer.invoke('chat:merge', id, o || {}),
  chatRuns: (id, o) => ipcRenderer.invoke('chat:runs', id, o || {}),
  chatFailure: (id, runId) => ipcRenderer.invoke('chat:failure', id, runId),
  chatSaveFile: (id, rel, content) => ipcRenderer.invoke('chat:saveFile', id, rel, content),
  copiesStatus: (id) => ipcRenderer.invoke('copies:status', id),
  copiesList: () => ipcRenderer.invoke('copies:list'),
  copiesRemove: (id, force) => ipcRenderer.invoke('copies:remove', id, force === true),
  copiesCleanup: () => ipcRenderer.invoke('copies:cleanup'),
  copiesOpen: (id) => ipcRenderer.invoke('copies:open', id),
  ghRepos: () => ipcRenderer.invoke('gh:repos'),
  ghBranches: (repo) => ipcRenderer.invoke('gh:branches', repo),
  previewServe: (html, o) => ipcRenderer.invoke('preview:serve', html, o || {}),
  previewServeFile: (chatId, file, kind) => ipcRenderer.invoke('preview:serveFile', chatId, file, kind),
  mediaOpenBrowser: (chatId, file) => ipcRenderer.invoke('media:openBrowser', chatId, file),
  mediaReveal: (chatId, file) => ipcRenderer.invoke('media:reveal', chatId, file),
  mediaRevealSource: (chatId, rel) => ipcRenderer.invoke('media:revealSource', chatId, rel),
  mediaCancelFetch: (chatId) => ipcRenderer.invoke('media:cancelFetch', chatId),
  attachCancel: () => ipcRenderer.invoke('attach:cancel'),
  onMediaProgress: (cb) => {
    const listener = (_e, a) => cb(a);
    ipcRenderer.on('media:progress', listener);
    return () => ipcRenderer.removeListener('media:progress', listener);
  },
  previewDownload: (name, content) => ipcRenderer.invoke('preview:download', name, content),
  savedBoards: () => ipcRenderer.invoke('saved:boards'),
  savedOpenData: () => ipcRenderer.invoke('saved:openData'),
  attachSaveAny: (name, data) => ipcRenderer.invoke('attach:saveAny', name, data),
  attachPickAny: () => ipcRenderer.invoke('attach:pickAny'),
  // Claude-app features (electron/parity.cjs) and several chats at once (electron/v2.cjs)
  chatsTemp: () => ipcRenderer.invoke('chats:temp'),
  chatsTempEnd: (id) => ipcRenderer.invoke('chats:tempEnd', id),
  chatBusy: (id, on) => ipcRenderer.invoke('chat:busy', id, on === true),
  mediaOpen: (chatId, file) => ipcRenderer.invoke('media:open', chatId, file),
  mediaSave: (chatId, file, name) => ipcRenderer.invoke('media:save', chatId, file, name),
  mediaToRepo: (chatId, file, rel) => ipcRenderer.invoke('media:toRepo', chatId, file, rel),
  mediaFetchRemote: (chatId, url) => ipcRenderer.invoke('media:fetchRemote', chatId, url),
  mediaSaveText: (chatId, name, text) => ipcRenderer.invoke('media:saveText', chatId, name, text),
  mediaKeys: () => ipcRenderer.invoke('media:keys'),
  mediaSetKey: (name, key) => ipcRenderer.invoke('media:setKey', name, key),
  mediaRemoveKey: (name) => ipcRenderer.invoke('media:removeKey', name),
  mediaImage: (chatId, o) => ipcRenderer.invoke('media:image', chatId, o || {}),
  mediaVideo: (chatId, o) => ipcRenderer.invoke('media:video', chatId, o || {}),
  mediaCancel: (chatId) => ipcRenderer.invoke('media:cancel', chatId),
  mediaScreenshot: (chatId, url) => ipcRenderer.invoke('media:screenshot', chatId, url),
  ttsSpeak: (text) => ipcRenderer.invoke('tts:speak', text),
  ttsStop: () => ipcRenderer.invoke('tts:stop'),
  // Voice chat (electron/voice-chat.cjs): speech to text, voices, cloning with consent.
  voiceStatus: () => ipcRenderer.invoke('voice:status'),
  voiceVoices: (provider, fresh) => ipcRenderer.invoke('voice:voices', provider, Boolean(fresh)),
  voiceTranscribe: (data, o) => ipcRenderer.invoke('voice:transcribe', data, o || {}),
  voiceSpeak: (o) => ipcRenderer.invoke('voice:speak', o || {}),
  voiceCancel: (token) => ipcRenderer.invoke('voice:cancel', token),
  voiceStopAll: () => ipcRenderer.invoke('voice:stopAll'),
  voiceClone: (o) => ipcRenderer.invoke('voice:clone', o || {}),
  // Speech servers (electron/speech-servers.cjs): only a saved server's id is ever passed.
  voiceServerKey: (id, key) => ipcRenderer.invoke('voice:serverKey', id, key),
  voiceServerTest: (id) => ipcRenderer.invoke('voice:serverTest', id),
  voiceServerClone: (o) => ipcRenderer.invoke('voice:serverClone', o || {}),
  voiceServerForget: (id) => ipcRenderer.invoke('voice:serverForget', id),
  onVoiceChunk: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('voice:chunk', listener);
    return () => ipcRenderer.removeListener('voice:chunk', listener);
  },
  onVoiceEnd: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('voice:end', listener);
    return () => ipcRenderer.removeListener('voice:end', listener);
  },
  cardsSetVoice: (id, voice) => ipcRenderer.invoke('cards:setVoice', id, voice),
  memoryList: () => ipcRenderer.invoke('memory:list'),
  memoryAdd: (text) => ipcRenderer.invoke('memory:add', text),
  memoryUpdate: (id, text) => ipcRenderer.invoke('memory:update', id, text),
  memoryRemove: (id) => ipcRenderer.invoke('memory:remove', id),
  memoryPropose: (text, agent, chatId) => ipcRenderer.invoke('memory:propose', text, agent, chatId),
  memoryDecide: (id, yes) => ipcRenderer.invoke('memory:decide', id, yes === true),
  memoryPrompt: () => ipcRenderer.invoke('memory:prompt'),
  chatsRecall: (q, exclude) => ipcRenderer.invoke('chats:recall', q, exclude),
  chatsReadOther: (id) => ipcRenderer.invoke('chats:readOther', id),
  chatsKnowledge: (id, k) => ipcRenderer.invoke('chats:knowledge', id, k || {}),
  skillsList: (chatId) => ipcRenderer.invoke('skills:list', chatId),
  connectorsList: () => ipcRenderer.invoke('connectors:list'),
  connectorsAdd: (spec) => ipcRenderer.invoke('connectors:add', spec),
  connectorsRemove: (id) => ipcRenderer.invoke('connectors:remove', id),
  connectorsEnable: (id, on) => ipcRenderer.invoke('connectors:enable', id, on === true),
  scheduleList: () => ipcRenderer.invoke('schedule:list'),
  scheduleAdd: (spec) => ipcRenderer.invoke('schedule:add', spec),
  scheduleUpdate: (id, patch) => ipcRenderer.invoke('schedule:update', id, patch),
  scheduleRemove: (id) => ipcRenderer.invoke('schedule:remove', id),
  chatExport: (chatId, format, payload) => ipcRenderer.invoke('chat:export', chatId, format, payload || {}),
  habitatGet: () => ipcRenderer.invoke('habitat:get'),
  habitatSave: (store) => ipcRenderer.invoke('habitat:save', store),
  teammatesStatus: () => ipcRenderer.invoke('teammates:status'),
  teammatesSetKey: (agent, key) => ipcRenderer.invoke('teammates:setKey', agent, key),
  teammatesRemoveKey: (agent) => ipcRenderer.invoke('teammates:removeKey', agent),
  teammatesAddServer: (spec) => ipcRenderer.invoke('teammates:addServer', spec),
  teammatesRemoveServer: (id) => ipcRenderer.invoke('teammates:removeServer', id),
  cardsList: () => ipcRenderer.invoke('cards:list'),
  cardsImport: (name, data) => ipcRenderer.invoke('cards:import', name, data),
  cardsPick: () => ipcRenderer.invoke('cards:pick'),
  cardsSave: (card) => ipcRenderer.invoke('cards:save', card),
  cardsConfirmAdult: (id, age, on) => ipcRenderer.invoke('cards:confirmAdult', id, age, on),
  cardsRemove: (id) => ipcRenderer.invoke('cards:remove', id),
  cardsExport: (id, fmt) => ipcRenderer.invoke('cards:export', id, fmt),
  loreList: () => ipcRenderer.invoke('lore:list'),
  loreSave: (b) => ipcRenderer.invoke('lore:save', b),
  loreRemove: (id) => ipcRenderer.invoke('lore:remove', id),
  loreImport: (name, data) => ipcRenderer.invoke('lore:import', name, data),
  loreFromCard: (id) => ipcRenderer.invoke('lore:fromCard', id),
  loreExport: (id) => ipcRenderer.invoke('lore:export', id),
  rpPersona: () => ipcRenderer.invoke('rp:persona'),
  rpSetPersona: (p) => ipcRenderer.invoke('rp:setPersona', p),
  rpCheck: (ids, text) => ipcRenderer.invoke('rp:check', ids, text),
  rpImage: (chatId, o) => ipcRenderer.invoke('rp:image', chatId, o || {}),
  // Characters chat scene pictures (ComfyUI) and the character's saved look.
  rpSceneSources: () => ipcRenderer.invoke('rp:sceneSources'),
  rpScenePrompt: (ids, messages) => ipcRenderer.invoke('rp:scenePrompt', ids, messages),
  rpScene: (chatId, o) => ipcRenderer.invoke('rp:scene', chatId, o || {}),
  cardsSetLook: (id, patch) => ipcRenderer.invoke('cards:setLook', id, patch || {}),
  comfyCheckpoints: () => ipcRenderer.invoke('comfy:checkpoints'),
  comfyTest: () => ipcRenderer.invoke('comfy:test'),
  comfyStats: () => ipcRenderer.invoke('comfy:stats'),
  rpSceneCancel: (job) => ipcRenderer.invoke('rp:sceneCancel', job),
  onSceneProgress: (cb) => {
    const listener = (_e, a) => cb(a);
    ipcRenderer.on('rp:sceneProgress', listener);
    return () => ipcRenderer.removeListener('rp:sceneProgress', listener);
  },
  // Hearth devices (Settings › Accounts): status and test, and the share code (encrypted).
  hearthStatus: (o) => ipcRenderer.invoke('hearth:status', o || {}),
  hearthShareCode: (code) => ipcRenderer.invoke('hearth:shareCode', code),
  chatsRp: (id, rp) => ipcRenderer.invoke('chats:rp', id, rp),
  notifyShow: (o) => ipcRenderer.invoke('notify:show', o || {}),
  onNotifyOpen: (cb) => {
    const listener = (_e, a) => cb(a);
    ipcRenderer.on('notify:open', listener);
    return () => ipcRenderer.removeListener('notify:open', listener);
  },
  onChatExternal: (cb) => {
    const listener = (_e, a) => cb(a);
    ipcRenderer.on('chat:external', listener);
    return () => ipcRenderer.removeListener('chat:external', listener);
  },
  onChatStep: (cb) => {
    const listener = (_e, a) => cb(a);
    ipcRenderer.on('chat:step', listener);
    return () => ipcRenderer.removeListener('chat:step', listener);
  },
  cardsFindSites: () => ipcRenderer.invoke('cards:findSites'),
  cardsFindOpen: (id) => ipcRenderer.invoke('cards:findOpen', id),
  onCardsFound: (cb) => {
    const listener = (_e, a) => cb(a);
    ipcRenderer.on('cards:found', listener);
    return () => ipcRenderer.removeListener('cards:found', listener);
  },
  onCopiesIdle: (cb) => {
    const listener = (_e, a) => cb(a);
    ipcRenderer.on('copies:idleUnpushed', listener);
    return () => ipcRenderer.removeListener('copies:idleUnpushed', listener);
  },
  onCopiesRemoved: (cb) => {
    const listener = (_e, a) => cb(a);
    ipcRenderer.on('copies:removed', listener);
    return () => ipcRenderer.removeListener('copies:removed', listener);
  },

  providerStatus: () => ipcRenderer.invoke('providers:status'),
  setKey: (provider, key) => ipcRenderer.invoke('providers:setKey', provider, key),
  removeKey: (provider) => ipcRenderer.invoke('providers:removeKey', provider),
  ask: (provider, model, prompt) => ipcRenderer.invoke('providers:ask', provider, model, prompt),
  testKey: (provider, model) => ipcRenderer.invoke('providers:test', provider, model),

  settings: () => ipcRenderer.invoke('settings:get'),
  setConnection: (agent, method) => ipcRenderer.invoke('settings:setConnection', agent, method),
  pickProject: () => ipcRenderer.invoke('settings:pickProject'),
  pickBinary: (agent) => ipcRenderer.invoke('settings:pickBinary', agent),
  useProject: (dir) => ipcRenderer.invoke('settings:useProject', dir),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  // Settings › Saved data change log, Permissions, missing quick-check tools, Test team.
  settingsLog: () => ipcRenderer.invoke('settings:log'),
  permsTable: (ids, apiReady) => ipcRenderer.invoke('perms:table', ids, apiReady),
  permsAgy: () => ipcRenderer.invoke('perms:agy'),
  permsAgySetup: () => ipcRenderer.invoke('perms:agySetup'),
  toolsMissing: () => ipcRenderer.invoke('tools:missing'),
  teamTest: (ids) => ipcRenderer.invoke('team:test', ids),
  addDir: () => ipcRenderer.invoke('settings:addDir'),
  removeDir: (dir) => ipcRenderer.invoke('settings:removeDir', dir),
  gitTools: () => ipcRenderer.invoke('git:tools'),
  gitLogin: () => ipcRenderer.invoke('git:login'),
  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitPull: () => ipcRenderer.invoke('git:pull'),
  gitPushTask: (taskId) => ipcRenderer.invoke('git:pushTask', taskId),
  gitPushBranch: (branch) => ipcRenderer.invoke('git:pushBranch', branch),
  gitMergeApproved: (taskId, opts) => ipcRenderer.invoke('git:mergeApproved', taskId, opts || {}),
  gitUpdateFromMain: (taskId) => ipcRenderer.invoke('git:updateFromMain', taskId),
  gitReleaseBranch: (taskIds) => ipcRenderer.invoke('git:releaseBranch', taskIds),
  gitLeadSync: (op, arg) => ipcRenderer.invoke('git:leadSync', op, arg),
  attachSave: (name, data) => ipcRenderer.invoke('attach:save', name, data),
  attachPick: () => ipcRenderer.invoke('attach:pick'),
  attachFromAgent: (rel, baseTaskId) => ipcRenderer.invoke('attach:fromAgent', rel, baseTaskId),
  gitOpenPr: (taskId, title, body) => ipcRenderer.invoke('git:openPr', taskId, title, body),
  gitClone: (input) => ipcRenderer.invoke('git:clone', input),
  gitPrList: () => ipcRenderer.invoke('git:prList'),
  gitPrView: (taskId) => ipcRenderer.invoke('git:prView', taskId),
  gitPrMerge: (number, opts) => ipcRenderer.invoke('git:prMerge', number, opts || {}),
  gitRelease: (opts) => ipcRenderer.invoke('git:release', opts),
  agentOpenSignin: (agent) => ipcRenderer.invoke('agents:openSignin', agent),
  openWeb: (provider) => ipcRenderer.invoke('web:open', provider),
  openExport: (provider) => ipcRenderer.invoke('web:openExport', provider),

  historyScan: () => ipcRenderer.invoke('history:scan'),
  historySearch: (q, filters) => ipcRenderer.invoke('history:search', q, filters),
  historyGet: (key) => ipcRenderer.invoke('history:get', key),
  historyStats: () => ipcRenderer.invoke('history:stats'),
  historyRemove: (key) => ipcRenderer.invoke('history:remove', key),
  historyResume: (key) => ipcRenderer.invoke('history:resume', key),
  historyOpenWeb: (key, inApp) => ipcRenderer.invoke('history:openWeb', key, inApp),
  historyImport: (kind) => ipcRenderer.invoke('history:import', kind),

  themeGet: () => ipcRenderer.invoke('theme:get'),
  onThemeChanged: (cb) => {
    const listener = (_e, t) => cb(t);
    ipcRenderer.on('theme:changed', listener);
    return () => ipcRenderer.removeListener('theme:changed', listener);
  },
  agentStatus: (agent) => ipcRenderer.invoke('agents:status', agent),
  agentLogin: (agent) => ipcRenderer.invoke('agents:login', agent),
  agentInstall: (agent) => ipcRenderer.invoke('agents:install', agent),
  agentLogout: (agent) => ipcRenderer.invoke('agents:logout', agent),
  run: (opts) => ipcRenderer.invoke('agents:run', opts),
  cancelRun: (runId) => ipcRenderer.invoke('agents:cancel', runId),
  ensureWorkspace: (taskId, title) => ipcRenderer.invoke('workspace:ensure', taskId, title),
  ensureChatWorkspace: (projectId) => ipcRenderer.invoke('workspace:ensureChat', projectId),
  checkpoint: (taskId, author, message) => ipcRenderer.invoke('workspace:checkpoint', taskId, author, message),
  workspaceHead: (taskId) => ipcRenderer.invoke('workspace:head', taskId),
  workspaceSummary: (taskId, baseSha) => ipcRenderer.invoke('workspace:summary', taskId, baseSha),
  openWorkspace: (taskId) => ipcRenderer.invoke('workspace:open', taskId),
  openFreebuff: (taskId, brief) => ipcRenderer.invoke('workspace:openFreebuff', taskId, brief),

  updaterInfo: () => ipcRenderer.invoke('updater:info'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  restartApp: () => ipcRenderer.invoke('updater:restart'),
  // Team ops (electron/ops/)
  opsProjects: () => ipcRenderer.invoke('ops:projects'),
  opsProjectAdd: (kind, input) => ipcRenderer.invoke('ops:projectAdd', kind, input),
  opsProjectSwitch: (id) => ipcRenderer.invoke('ops:projectSwitch', id),
  opsProjectRename: (id, name) => ipcRenderer.invoke('ops:projectRename', id, name),
  opsProjectSettings: (patch) => ipcRenderer.invoke('ops:projectSettings', patch),
  opsMemoryGet: (decisions) => ipcRenderer.invoke('ops:memoryGet', decisions),
  opsMemorySave: (text) => ipcRenderer.invoke('ops:memorySave', text),
  opsMemoryApply: (proposal) => ipcRenderer.invoke('ops:memoryApply', proposal),
  opsTestRun: (taskId, sha) => ipcRenderer.invoke('ops:testRun', taskId, sha),
  opsTestCancel: (taskId) => ipcRenderer.invoke('ops:testCancel', taskId),
  opsCiPoll: (branches) => ipcRenderer.invoke('ops:ciPoll', branches),
  opsLogsPoll: () => ipcRenderer.invoke('ops:logsPoll'),
  opsVoiceTools: () => ipcRenderer.invoke('ops:voiceTools'),
  opsVoiceSave: (data) => ipcRenderer.invoke('ops:voiceSave', data),
  opsUsage: (agent) => ipcRenderer.invoke('ops:usage', agent),
  opsIdentityDefault: () => ipcRenderer.invoke('ops:identityDefault'),
  opsIdentityApply: () => ipcRenderer.invoke('ops:identityApply'),
  opsRewriteTask: (taskId, byLead) => ipcRenderer.invoke('ops:rewriteTask', taskId, byLead === true),
  opsCheckTask: (taskId) => ipcRenderer.invoke('ops:checkTask', taskId),
  opsLeadRelease: (kind, version) => ipcRenderer.invoke('ops:leadRelease', kind, version),
  opsActRelease: (kind, version, request) => ipcRenderer.invoke('ops:actRelease', kind, version, request),
  opsReleaseStatus: (version, since) => ipcRenderer.invoke('ops:releaseStatus', version, since),
  opsHardware: () => ipcRenderer.invoke('ops:hardware'),
  opsOllamaPull: (tag) => ipcRenderer.invoke('ops:ollamaPull', tag),
  opsOllamaRemove: (tag) => ipcRenderer.invoke('ops:ollamaRemove', tag),
  opsUpscaleTools: () => ipcRenderer.invoke('ops:upscaleTools'),
  opsUpscale: (file, target) => ipcRenderer.invoke('ops:upscale', file, target),
  opsEsrganInstall: () => ipcRenderer.invoke('ops:esrganInstall'),
  opsJobs: () => ipcRenderer.invoke('ops:jobs'),
  opsJobStart: (spec) => ipcRenderer.invoke('ops:jobStart', spec),
  opsJobCancel: (id) => ipcRenderer.invoke('ops:jobCancel', id),
  opsJobRetry: (id) => ipcRenderer.invoke('ops:jobRetry', id),
  opsTruth: (ids) => ipcRenderer.invoke('ops:truth', ids),
  opsPrepareRun: (taskId) => ipcRenderer.invoke('ops:prepareRun', taskId),
  opsSnapshot: (taskId) => ipcRenderer.invoke('ops:snapshot', taskId),
  opsEnforceVerify: (taskId, before) => ipcRenderer.invoke('ops:enforceVerify', taskId, before),
  opsEnforceDocs: (taskId, startSha) => ipcRenderer.invoke('ops:enforceDocs', taskId, startSha),
  opsSplitFollowup: (taskId, sha) => ipcRenderer.invoke('ops:splitFollowup', taskId, sha),
  opsReviewData: (taskId, from, changes) => ipcRenderer.invoke('ops:reviewData', taskId, from, changes),
  opsLeadTaskGit: (op, taskId, arg) => ipcRenderer.invoke('ops:leadTaskGit', op, taskId, arg),
  opsCollectAssets: (taskId, agent, text, sinceMs) => ipcRenderer.invoke('ops:collectAssets', taskId, agent, text, sinceMs),
  opsReleasePreview: (version) => ipcRenderer.invoke('ops:releasePreview', version),
  opsReleaseOverride: (version, reason) => ipcRenderer.invoke('ops:releaseOverride', version, reason),
  opsRemoteTags: () => ipcRenderer.invoke('ops:remoteTags'),
  opsDiskPending: () => ipcRenderer.invoke('ops:diskPending'),
  opsDiskResolve: (which, choice) => ipcRenderer.invoke('ops:diskResolve', which, choice),
  onOpsDiskChange: (cb) => {
    const listener = (_e, a) => cb(a);
    ipcRenderer.on('ops:diskChange', listener);
    return () => ipcRenderer.removeListener('ops:diskChange', listener);
  },
  opsPhoneHost: (ip) => ipcRenderer.invoke('ops:phoneHost', ip),
  opsPhoneStatus: () => ipcRenderer.invoke('ops:phoneStatus'),
  opsPhoneEnable: () => ipcRenderer.invoke('ops:phoneEnable'),
  opsPhoneDisable: () => ipcRenderer.invoke('ops:phoneDisable'),
  opsPhoneNewCode: () => ipcRenderer.invoke('ops:phoneNewCode'),
  opsPhoneForget: () => ipcRenderer.invoke('ops:phoneForget'),
  opsPhoneRemove: (id) => ipcRenderer.invoke('ops:phoneRemove', id),
  opsPhonePush: (snap) => ipcRenderer.invoke('ops:phonePush', snap),
  onOpsPhoneAction: (cb) => {
    const listener = (_e, a) => cb(a);
    ipcRenderer.on('ops:phoneAction', listener);
    return () => ipcRenderer.removeListener('ops:phoneAction', listener);
  },
  onUpdaterStatus: (cb) => {
    const listener = (_e, status) => cb(status);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
});

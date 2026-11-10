// Hearth AI Command Center — Electron main process.
// All privileged work (files, secrets, provider APIs, updates) happens here.
// The renderer only gets the narrow API exposed in preload.cjs.
const { app, BrowserWindow, Notification, ipcMain, shell, Menu, safeStorage, dialog, clipboard, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { validateState, validateProvider, validateApiKey, validateModel, validatePrompt } = require('./validate.cjs');
const { testKey, callProvider, DEFAULT_MODELS } = require('./providers.cjs');
const { createSecretStore } = require('./secrets.cjs');
const { createUpdater } = require('./updater.cjs');
const agents = require('./agents.cjs');
const workspace = require('./workspace.cjs');
const gitops = require('./git.cjs');
const attachments = require('./attachments.cjs');
const { pathToFileURL } = require('node:url');
const { createStore, redact, redactDeep } = require('./store.cjs');
const bridge = require('./bridge.cjs');
const imports = require('./imports.cjs');
const { createHistory } = require('./history.cjs');
const theme = require('./theme.cjs');
const web = require('./webapps.cjs');
const { LIVE_PROVIDERS } = require('./validate.cjs');
const { cleanSavedLevels } = require('./ops/approval.cjs');
const { cleanIdentity } = require('./ops/identity.cjs');
const ops = require('./ops/index.cjs');
const guard = require('./ops/project-guard.cjs');
const { createChats } = require('./chats.cjs');
const v2 = require('./v2.cjs');
const parity = require('./parity.cjs');
const { diffSettings, applyChanges, createSettingsLog } = require('./settings-log.cjs');
const teamCheck = require('./team-check.cjs');
const voiceChat = require('./voice-chat.cjs');
const voicePerms = require('./voice-perms.cjs');
const hearthDevices = require('./hearth-devices.cjs');
const comfy = require('./comfy.cjs');
const studioLib = require('./studio.cjs');

// No Hearth OS version pin: the app never changes, bumps, publishes or deploys
// Hearth OS versions (the owner picks every number). It only shows which Hearth
// OS this computer runs, read from /etc/os-release.
const API_ONLY = ['perplexity', 'deepseek'];
const TEXT_SIZES = [100, 115, 130, 150];
const THEMES = ['hearth', 'dark', 'light', 'system'];

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
// Live previews are served from their own scheme with their own CSP (electron/previews.cjs).
// Pictures and videos the AIs made are served from hearth-media: (only the app's media folder).
protocol.registerSchemesAsPrivileged([{ scheme: 'hearth-preview', privileges: { standard: true, secure: true } }, { scheme: 'hearth-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);

let mainWindow = null;
let secrets = null;
let updater = null;

const dataDir = () => app.getPath('userData');
const stateFile = () => path.join(dataDir(), 'command-center-state.json');
const settingsFile = () => path.join(dataDir(), 'settings.json');
const worktreeRoot = () => path.join(dataDir(), 'workspaces');
const historyFile = () => path.join(dataDir(), 'chat-history.json');
const runs = new Map(); // runId -> AbortController

// Settings live in memory and are written only through IPC. If settings.json changes on
// disk outside the app (an AI editing it), nothing is applied until the owner decides.
let settingsMem = null;
let settingsHash = null;
const hashText = (t) => require('node:crypto').createHash('sha256').update(String(t)).digest('hex');
// A settings.json that can't be read is never overwritten: its .bak is used read-only and
// saving stops with a clear message until the owner looks at it.
let settingsBroken = null;
function loadSettingsFile() {
  let t = null;
  try { t = fs.readFileSync(settingsFile(), 'utf8'); } catch { settingsBroken = null; settingsHash = null; return {}; }
  settingsHash = hashText(t);
  try { const j = JSON.parse(t); if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('not an object'); settingsBroken = null; return j; } catch {
    settingsBroken = 'settings.json could not be read, so nothing was saved over it. Your previous settings (settings.json.bak) are used until you fix or remove it.';
    try { const b = JSON.parse(fs.readFileSync(`${settingsFile()}.bak`, 'utf8')); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; } catch { return {}; }
  }
}
// The settings change log (Settings › Saved data): time, what changed (old -> new) and who.
let settingsLogStore = null;
const settingsLog = () => (settingsLogStore ||= createSettingsLog(path.join(dataDir(), 'settings-log.json')));
const settingsDisk = {
  changed: () => { try { return hashText(fs.readFileSync(settingsFile(), 'utf8')) !== settingsHash; } catch { return false; } },
  // The owner chose to keep a change made outside the app: logged as his choice.
  keep: () => { const before = readSettings(); settingsMem = loadSettingsFile(); settingsLog().add(diffSettings(before, readSettings()), 'you kept a change made outside the app'); return readSettings(); },
  discard: () => { const outside = (() => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return null; } })(); writeRawSettings(settingsMem || {}); if (outside) settingsLog().add(diffSettings(normalSettings(outside), readSettings()), 'you undid a change made outside the app'); return readSettings(); },
};
// After every AI turn: if settings.json changed on disk while the AI worked, the owner's
// settings are put back at once (the changed file is kept next to it) and the log says who.
function guardSettings(who) {
  if (!settingsDisk.changed()) return null;
  let outside = null;
  try { const t = fs.readFileSync(settingsFile(), 'utf8'); fs.writeFileSync(`${settingsFile()}.changed-${Date.now()}`, t, { mode: 0o600 }); outside = JSON.parse(t); } catch {}
  writeRawSettings(settingsMem || {});
  const changes = outside ? diffSettings(readSettings(), normalSettings(outside)) : [];
  settingsLog().add(changes.length ? changes : [{ key: 'settings.json', path: ['settings.json'], from: 'your settings', to: 'changed on disk' }], `${who} changed settings.json during a chat turn; undone`);
  return { undone: true, keys: changes.map((c) => c.key) };
}
// Main-side settings: the renderer can never hand us an arbitrary path to run in.
function readSettings() {
  if (settingsMem === null) settingsMem = loadSettingsFile();
  return normalSettings(settingsMem);
}
// The saved values with every default filled in at read time (the defaults are never saved).
function normalSettings(s) {
  return {
    project: typeof s.project === 'string' ? s.project : null,
    projects: Array.isArray(s.projects) ? s.projects.filter((p) => typeof p === 'string') : (typeof s.project === 'string' ? [s.project] : []),
    connection: { anthropic: 'cli', openai: 'cli', xai: 'cli', mistral: 'cli', perplexity: 'api', deepseek: 'api', ...(s.connection || {}), perplexity: 'api', deepseek: 'api' },
    bins: { ...(s.bins || {}) },
    // What AIs may do when working: 'standard' = each tool's own autonomous mode
    // with its built-in safety checks; 'full' = no checks (owner opt-in).
    access: s.access === 'full' ? 'full' : 'standard',
    extraDirs: Array.isArray(s.extraDirs) ? s.extraDirs.filter((d) => typeof d === 'string' && path.isAbsolute(d)) : [],
    autoPush: s.autoPush !== false,
    chatEdits: s.chatEdits !== false,
    // Keep one CLI session per AI for the team chat, so it's resumable in that AI's own CLI.
    chatResume: s.chatResume !== false,
    // The lead AI may take the owner's Task board actions. Off unless the owner turns it on.
    leadActions: s.leadActions === true,
    // Lead handles GitHub (pull, combine, push branches). Off until the owner turns it on.
    leadGitHub: s.leadGitHub === true,
    theme: THEMES.includes(s.theme) ? s.theme : 'hearth',
    // 2.9: the gold hologram design unless the owner picks Classic.
    design: s.design === 'classic' ? 'classic' : 'hologram',
    textSize: TEXT_SIZES.includes(s.textSize) ? s.textSize : 100,
    // Habitat page: characters stay in place. Off unless the owner turns it on (the OS setting also counts).
    reduceMotion: s.reduceMotion === true,
    // Keys without a keyring: basic (weak) protection, only if the owner chose it. Off unless he does.
    secretsBasic: s.secretsBasic === true,
    // Approval levels: the owner's moves between Routine and Major (owner-only stays owner-only).
    approvalLevels: cleanSavedLevels(s.approvalLevels),
    // Local AI may review code (with a 7B or larger model). Off unless the owner turns it on.
    localReviewCode: s.localReviewCode === true,
    // The lead's extra powers: each off unless the owner turns it on.
    leadMerge: s.leadMerge === true,
    leadRelease: s.leadRelease === true,
    leadTag: s.leadTag === true,
    // Every commit is made as this identity (set once by the owner).
    ownerIdentity: cleanIdentity(s.ownerIdentity),
    // The Habitat 3D view's owner settings (view mode, Lighter 3D, walk view, avatar, study decor, notes).
    view3d: cleanView3d(s.view3d),
    // "Claude can do everything I can (asks me first every time)". Off unless the owner turns it on.
    actForMe: s.actForMe === true,
    // 2.x chats. Defaults are shown until the owner changes them; nothing is written for him.
    // Temporary copies are removed after this many idle hours (0 = never; unpushed work always stays).
    copyIdleHours: v2.IDLE_CHOICES.includes(s.copyIdleHours) ? s.copyIdleHours : 24,
    // The composer's Web and "Run & build" start on these; quick checks the AIs may run on this PC.
    tools: {
      web: s.tools?.web !== false,
      build: s.tools?.build !== false,
      quickChecks: Array.isArray(s.tools?.quickChecks) ? v2.cleanQuick(s.tools.quickChecks) : v2.DEFAULT_QUICK_CHECKS.slice(),
    },
    // Live previews may load from the internet. Off unless the owner turns it on.
    previewNetwork: s.previewNetwork === true,
    // Who's in chats: { lead, reviewer, members }. null = the default team (Claude leads).
    team: cleanTeam(s.team),
    // 2.10: everyone the lead picks works at the same time (each in its own copy). On unless the owner turns it off.
    teamParallel: s.teamParallel !== false,
    // New in this version: defaults shown at read time, saved only when the owner changes one.
    // A desktop notification when a long turn finishes or an AI needs him.
    notify: s.notify !== false,
    // Read every answer aloud. Off unless the owner turns it on.
    autoRead: s.autoRead === true,
    // How many chats may have their team working at once.
    maxChats: v2.MAX_CHAT_CHOICES.includes(s.maxChats) ? s.maxChats : 3,
    // Custom instructions every AI gets in every chat (empty until he writes them).
    customInstructions: cleanInstructions(s.customInstructions),
    // Venice and Civitai choices (models, engine, request fields). Defaults until he picks.
    teammates: cleanTeammates(s.teammates),
    // Voice chat (Settings › Voice): speech to text, the voice provider, voices per teammate.
    // Defaults filled in here at read time; only what he changes is saved.
    voice: voiceChat.cleanSettings(s.voice),
    // Hearth devices (Settings › Accounts): the Home server's address, the device order and the
    // skip rules. Defaults filled in here at read time; only what he changes is saved.
    hearthDevices: hearthDevices.cleanSettings(s.hearthDevices),
    // His ComfyUI server for Characters chat scene pictures (address and default checkpoint).
    comfy: comfy.cleanSettings(s.comfy),
    // Uncensored mode (2.2.1, electron/studio.cjs): off until the owner turns it on; the hard
    // limits stay on either way.
    uncensored: studioLib.cleanUncensored(s.uncensored),
  };
}
const MODEL_OK = /^[A-Za-z0-9._:\-/]{1,100}$/;
function cleanTeammates(t) {
  const o = t && typeof t === 'object' && !Array.isArray(t) ? t : {};
  const out = {};
  if (o.venice && typeof o.venice === 'object') out.venice = { ...(MODEL_OK.test(o.venice.model || '') ? { model: o.venice.model } : {}), ...(MODEL_OK.test(o.venice.imageModel || '') ? { imageModel: o.venice.imageModel } : {}) };
  if (o.civitai && typeof o.civitai === 'object') out.civitai = { ...(['sdcpp', 'comfy', 'flux2', 'qwen'].includes(o.civitai.engine) ? { engine: o.civitai.engine } : {}), ...(typeof o.civitai.fields === 'string' ? { fields: o.civitai.fields.slice(0, 4000) } : {}) };
  return out;
}
function cleanInstructions(c) {
  const t = (v) => (typeof v === 'string' ? v.slice(0, 3000) : '');
  return c && typeof c === 'object' && !Array.isArray(c) ? { about: t(c.about), style: t(c.style) } : { about: '', style: '' };
}
const TEAM_IDS = ['anthropic', 'openai', 'google', 'xai', 'mistral', 'qwen', 'perplexity', 'deepseek', 'ollama', 'venice', 'civitai', 'gpu', 'hearth', 'free'];
// Teammates by key or URL (electron/teammates.cjs; Hearth devices: electron/hearth-devices.cjs):
// answered through their own API.
const TEAMMATES = ['venice', 'civitai', 'gpu', 'hearth', 'free'];
function cleanTeam(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const members = [...new Set((Array.isArray(t.members) ? t.members : []).filter((a) => TEAM_IDS.includes(a)))];
  return { lead: TEAM_IDS.includes(t.lead) ? t.lead : 'anthropic', reviewer: TEAM_IDS.includes(t.reviewer) ? t.reviewer : t.reviewer === null ? null : 'openai', members };
}
// Plain JSON only, small; the window normalises the fields (src/habitat3d/map.mjs normPrefs).
function cleanView3d(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  try { const t = JSON.stringify(v); return t.length <= 20000 ? JSON.parse(t) : null; } catch { return null; }
}
function useProject(dir) {
  const s = readSettings();
  s.project = dir;
  if (!s.projects.includes(dir)) s.projects.unshift(dir);
  s.projects = s.projects.slice(0, 20);
  writeSettings(s);
  return s;
}
// Same page, ignoring the #hash and ?query (a reload of the app's own page).
function sameDocument(a, b) {
  try { const x = new URL(a), y = new URL(b); return x.protocol === y.protocol && x.host === y.host && x.pathname === y.pathname; } catch { return false; }
}
// Saves only what really changed (merge-on-write into the saved file): a click on one
// switch never writes the other settings' defaults. Every change is logged with who made it.
function writeSettings(s, by = 'you, in the app') {
  const changes = diffSettings(readSettings(), s);
  if (!changes.length) return;
  writeRawSettings(applyChanges(settingsMem || {}, changes));
  settingsLog().add(changes, by);
}
function writeRawSettings(s) {
  if (settingsBroken) throw new Error(settingsBroken);
  fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  const data = JSON.stringify(s, null, 2);
  const tmp = `${settingsFile()}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  // Keep the previous settings as .bak, then swap in the new file atomically.
  try { if (fs.existsSync(settingsFile())) fs.copyFileSync(settingsFile(), `${settingsFile()}.bak`); } catch {}
  fs.renameSync(tmp, settingsFile());
  settingsMem = JSON.parse(data);
  settingsHash = hashText(data);
}
const TASK_ID = /^[A-Z0-9]{4,10}$/; // 'CHATROOM' is the team chat's own workspace
function taskDir(taskId) {
  if (!TASK_ID.test(taskId)) throw new Error('bad task id');
  return path.join(worktreeRoot(), taskId);
}

let store = null;
let history = null;
let openWeb = null;
let lastLoad = { recoveredFrom: null };
let opsApi = null; // electron/ops/index.cjs
let chats = null; // electron/chats.cjs
// The window is bound to the project whose state it loaded; saves and actions from a
// window bound to another project are refused (electron/ops/project-guard.cjs).
const binding = guard.createBinding();
// Channels that act on the open project: refused while the window still shows another project.
const GUARDED = new Set(['agents:run', 'workspace:ensure', 'workspace:ensureChat', 'workspace:checkpoint', 'state:restore',
  'git:pushTask', 'git:pushBranch', 'git:mergeApproved', 'git:leadSync', 'git:updateFromMain', 'git:releaseBranch', 'git:openPr', 'git:prMerge', 'git:release',
  'ops:leadRelease', 'ops:actRelease', 'ops:releasePreview', 'ops:releaseOverride', 'ops:projectSettings', 'ops:rewriteTask', 'ops:testRun', 'ops:jobStart', 'ops:jobRetry', 'ops:leadTaskGit', 'ops:memorySave', 'ops:memoryApply']);

function readState() {
  lastLoad = store.load();
  return lastLoad.state;
}

function writeState(state) {
  validateState(state);
  return store.save(state);
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// Only accept IPC from our own bundled page.
function trusted(event) {
  const url = event.senderFrame?.url || '';
  const dev = process.env.VITE_DEV_SERVER_URL;
  return url.startsWith('file://') || (dev && url.startsWith(dev));
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trusted(event)) throw new Error('untrusted sender');
    if (GUARDED.has(channel)) {
      const g = binding.checkAction();
      if (!g.ok) return { ok: false, refused: 'project', error: { kind: 'wrong_project', message: `Not done: ${g.reason}.` }, message: `Not done: ${g.reason}.` };
    }
    return fn(...args);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#171a21',
    title: 'Hearth AI Command Center',
    icon: path.join(__dirname, '..', 'dist', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Reapply the saved choice on every load, including renderer recovery.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(readSettings().textSize / 100);
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // The microphone (voice chat) only for this window's own page; never for previews or web windows.
  voicePerms.install(mainWindow, { devUrl: process.env.VITE_DEV_SERVER_URL });
  // No navigating away from the app. Reloading the app's own page is allowed: switching projects and
  // chats reloads the window (in 1.3–1.4 the reload was blocked here, so a switch only showed after a restart).
  mainWindow.webContents.on('will-navigate', (e, url) => { if (!sameDocument(url, mainWindow.webContents.getURL())) e.preventDefault(); });
  // A live preview's frame can never navigate anywhere but its own hearth-preview: page.
  mainWindow.webContents.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame && !String(e.url || '').startsWith('hearth-preview://') && e.url !== 'about:blank' && e.url !== 'about:srcdoc') e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      message: 'The interface stopped unexpectedly.',
      detail: `Reason: ${details.reason}. Your saved data is safe.`,
      buttons: ['Reload', 'Quit'],
    });
    if (choice === 0) mainWindow.reload();
    else app.quit();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const load = devUrl ? mainWindow.loadURL(devUrl) : mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  load.catch((e) => {
    dialog.showErrorBox('Hearth AI Command Center failed to start', String(e?.message || e));
    app.quit();
  });
}

// Never let a secret that an agent echoed back reach the UI, state or logs.
function cleanResult(r) {
  if (r.text) r.text = redact(r.text);
  if (r.partial) r.partial = redact(r.partial);
  if (r.error?.message) r.error.message = redact(r.error.message);
  return r;
}

function registerIpc() {
  // The window loads the open project's state, stamped with its id, and is bound to it.
  // Refused (never written) when the state isn't the open project's: no cross-project saves.
  const stateApi = guard.stateIpc({ binding, read: () => readState(), write: (st) => writeState(st) });
  // The window asks the main process to reload it (always works, whatever the page's own navigation rules).
  handle('app:reload', () => { setImmediate(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload(); }); return true; });
  handle('state:load', () => stateApi.load());
  handle('state:save', (state) => stateApi.save(state));
  // Look only: signs the open project's saved data was copied from another project.
  handle('state:health', () => {
    try {
      const reg = ops.projectsList();
      const read = (id) => { try { return JSON.parse(fs.readFileSync(ops.projectStateFile(id), 'utf8')); } catch { return null; } };
      const cur = reg.list.find((p) => p.id === binding.active());
      if (!cur) return { ok: true, notices: [] };
      const others = reg.list.filter((p) => p.id !== cur.id).map((p) => ({ id: p.id, name: p.name, dir: p.dir, state: read(p.id) }));
      return { ok: true, notices: guard.detectCrossCopy({ id: cur.id, name: cur.name, dir: readSettings().project || cur.dir, state: lastLoad.state }, others) };
    } catch (e) { return { ok: false, notices: [], message: String(e.message || e) }; }
  });
  // ---- chats (many conversations, each linkable to a project) ----
  const chatProjects = () => ops.projectsList().list;
  handle('chats:list', () => ({ list: chats.list(chatProjects(), (id) => ops.projectStateFile(id)), notices: chats.notices(), broken: Boolean(chats.broken()) }));
  handle('chats:create', (projectId) => {
    const pid = projectId === null || projectId === undefined ? null : String(projectId);
    if (pid && !chatProjects().some((p) => p.id === pid)) throw new Error('Unknown project.');
    return chats.create({ projectId: pid });
  });
  handle('chats:get', (id) => chats.get(String(id)));
  handle('chats:save', (id, data) => chats.save(String(id), data || {}));
  handle('chats:update', (id, patch) => {
    const p = patch && typeof patch === 'object' ? patch : {};
    if ('projectId' in p && p.projectId !== null && !chatProjects().some((x) => x.id === p.projectId)) throw new Error('Unknown project.');
    return chats.update(String(id), p);
  });
  handle('chats:reorder', (ids) => chats.reorder(Array.isArray(ids) ? ids.map(String) : []));
  handle('chats:delete', (id) => chats.remove(String(id)));
  handle('chats:trash', () => chats.trash());
  handle('chats:restore', (trashId) => chats.restore(String(trashId)));
  handle('state:backups', () => ({ recoveredFrom: lastLoad.recoveredFrom, lost: Boolean(lastLoad.lost), backups: store.list() }));
  handle('state:restore', (n) => ({ ...store.restore(Number(n)), projectId: binding.active() }));
  // Export everything (tasks, progress, chat, audit) with secrets scrubbed.
  handle('state:export', async (state) => {
    validateState(state);
    const r = await dialog.showSaveDialog(mainWindow, { title: 'Export Hearth AI work', defaultPath: `hearth-ai-backup-${new Date().toISOString().slice(0, 10)}.json` });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.writeFileSync(r.filePath, JSON.stringify(redactDeep({ exportedAt: new Date().toISOString(), app: app.getVersion(), ...state }), null, 2), { mode: 0o600 });
    return { ok: true, file: r.filePath };
  });

  handle('app:info', () => ({
    appVersion: app.getVersion(),
    hearthOs: theme.hearthOsRelease(),
    dataPath: dataDir(),
    electron: process.versions.electron,
    packaged: app.isPackaged,
  }));

  handle('providers:status', async () => ({
    encryption: await secrets.available(),
    weakEncryption: secrets.weak(),
    defaults: DEFAULT_MODELS,
    keys: Object.fromEntries(LIVE_PROVIDERS.map((p) => [p, secrets.has(p)])),
  }));

  handle('providers:setKey', async (provider, key) => {
    await secrets.set(validateProvider(provider, { liveOnly: true }), validateApiKey(key));
    return true;
  });

  handle('providers:removeKey', (provider) => {
    secrets.remove(validateProvider(provider, { liveOnly: true }));
    return true;
  });

  handle('providers:test', (provider, model) => {
    const p = validateProvider(provider, { liveOnly: true });
    return testKey({ provider: p, apiKey: secrets.get(p), model: validateModel(model || DEFAULT_MODELS[p]), timeoutMs: 30000 });
  });
  handle('providers:ask', async (provider, model, prompt) => {
    const p = validateProvider(provider);
    if (p === 'freebuff') {
      return { ok: false, error: { kind: 'unsupported', message: 'FreeBuff has no verified public API; integration not implemented.' } };
    }
    return callProvider({
      provider: p,
      apiKey: secrets.get(p),
      model: validateModel(model || DEFAULT_MODELS[p]),
      prompt: validatePrompt(prompt),
    });
  });

  // ---- linked agents & shared workspace ----
  handle('settings:get', () => readSettings());
  handle('settings:setConnection', (agent, method) => {
    validateProvider(agent, { liveOnly: true });
    if (!['cli', 'api'].includes(method)) throw new Error('bad method');
    if (API_ONLY.includes(agent) && method !== 'api') throw new Error('This one connects by API key only.');
    const s = readSettings();
    s.connection[agent] = method;
    writeSettings(s);
    return s;
  });
  handle('settings:pickProject', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Choose a project folder', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return readSettings();
    const dir = r.filePaths[0];
    if (!gitops.find('git')) throw new Error('git is not installed on this computer. Install it first (see the setup checklist).');
    if (!(await workspace.isRepo(dir))) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        message: 'Start tracking this folder with git?',
        detail: `${dir} isn't a git repository yet. Hearth AI needs git to save checkpoints so no AI work is ever lost. This adds a hidden .git folder and one first commit; your files are not changed.`,
        buttons: ['Start tracking', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      });
      if (choice !== 0) return readSettings();
      const init = await gitops.initRepo(dir);
      if (!init.ok) throw new Error(`Couldn't start git here: ${init.message}`);
    }
    return opsApi ? opsApi.useFolder(dir) : useProject(dir);
  });
  handle('settings:useProject', (dir) => {
    const s = readSettings();
    if (!s.projects.includes(dir)) throw new Error('Unknown project.');
    return opsApi ? opsApi.useFolder(dir) : useProject(dir);
  });
  handle('settings:set', (patch) => {
    if (!patch || typeof patch !== 'object') throw new Error('bad settings');
    const s = readSettings();
    if ('access' in patch) s.access = patch.access === 'full' ? 'full' : 'standard';
    if ('autoPush' in patch) s.autoPush = Boolean(patch.autoPush);
    if ('chatEdits' in patch) s.chatEdits = Boolean(patch.chatEdits);
    if ('chatResume' in patch) s.chatResume = Boolean(patch.chatResume);
    if ('leadActions' in patch) s.leadActions = patch.leadActions === true;
    if ('leadGitHub' in patch) s.leadGitHub = patch.leadGitHub === true;
    if ('theme' in patch && THEMES.includes(patch.theme)) s.theme = patch.theme;
    if ('design' in patch && ['hologram', 'classic'].includes(patch.design)) s.design = patch.design;
    if ('textSize' in patch) {
      if (!TEXT_SIZES.includes(patch.textSize)) throw new Error('Invalid text size');
      s.textSize = patch.textSize;
    }
    if ('reduceMotion' in patch) s.reduceMotion = patch.reduceMotion === true;
    if ('secretsBasic' in patch) s.secretsBasic = patch.secretsBasic === true;
    if ('approvalLevels' in patch) s.approvalLevels = cleanSavedLevels(patch.approvalLevels);
    if ('localReviewCode' in patch) s.localReviewCode = patch.localReviewCode === true;
    for (const k of ['leadMerge', 'leadRelease', 'leadTag']) if (k in patch) s[k] = patch[k] === true;
    if ('ownerIdentity' in patch) s.ownerIdentity = cleanIdentity(patch.ownerIdentity);
    if ('view3d' in patch) s.view3d = cleanView3d(patch.view3d);
    if ('copyIdleHours' in patch) {
      if (!v2.IDLE_CHOICES.includes(patch.copyIdleHours)) throw new Error('Invalid idle time');
      s.copyIdleHours = patch.copyIdleHours;
    }
    if ('tools' in patch && patch.tools && typeof patch.tools === 'object') {
      const t = { ...s.tools };
      if ('web' in patch.tools) t.web = patch.tools.web === true;
      if ('build' in patch.tools) t.build = patch.tools.build === true;
      if ('quickChecks' in patch.tools) t.quickChecks = v2.cleanQuick(patch.tools.quickChecks);
      s.tools = t;
    }
    if ('previewNetwork' in patch) s.previewNetwork = patch.previewNetwork === true;
    if ('team' in patch) s.team = cleanTeam(patch.team);
    if ('teamParallel' in patch) s.teamParallel = patch.teamParallel === true;
    if ('notify' in patch) s.notify = patch.notify === true;
    if ('autoRead' in patch) s.autoRead = patch.autoRead === true;
    if ('maxChats' in patch) {
      if (!v2.MAX_CHAT_CHOICES.includes(patch.maxChats)) throw new Error('Invalid number of chats');
      s.maxChats = patch.maxChats;
    }
    if ('customInstructions' in patch) s.customInstructions = cleanInstructions(patch.customInstructions);
    if ('voice' in patch) s.voice = voiceChat.mergeSettings(s.voice, patch.voice);
    if ('hearthDevices' in patch) s.hearthDevices = hearthDevices.mergeSettings(s.hearthDevices, patch.hearthDevices);
    if ('comfy' in patch) s.comfy = comfy.mergeSettings(s.comfy, patch.comfy);
    if ('uncensored' in patch) {
      const next = studioLib.mergeUncensored(s.uncensored, patch.uncensored);
      // Turning it on asks once (the first time), in a native box the window can't answer for him.
      if (next.on && !s.uncensored.on && !s.uncensored.confirmedAt) {
        const c = dialog.showMessageBoxSync(mainWindow, { type: 'warning', message: 'Turn on Uncensored mode (18+)?', detail: 'Pictures and videos from your PC can then be adult content, and local chat uses your 18+ model. For adults only.\n\nThe hard limits never change: nothing sexual with minors or anyone who looks under 18, and no real people. Claude, ChatGPT and Gemini keep their own rules.', buttons: ['I\'m 18 or older: turn on', 'Cancel'], defaultId: 1, cancelId: 1 });
        if (c !== 0) return { ...readSettings(), message: 'Cancelled: Uncensored mode stays off.' };
        next.confirmedAt = new Date().toISOString();
      }
      s.uncensored = next;
    }
    if ('teammates' in patch) {
      const t = cleanTeammates(patch.teammates);
      if (t.civitai?.fields) { try { JSON.parse(t.civitai.fields); } catch { throw new Error('The Civitai request fields must be JSON, like {"prompt": "{prompt}"}.'); } }
      s.teammates = { ...s.teammates, ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { ...(s.teammates[k] || {}), ...v }])) };
    }
    // Only the owner turns it on: a native confirmation the window can't answer for him.
    if ('actForMe' in patch) {
      const on = patch.actForMe === true;
      if (on && !s.actForMe) {
        const c = dialog.showMessageBoxSync(mainWindow, { type: 'warning', message: 'Let Claude ask to do everything you can?', detail: 'Claude may then ask to approve, merge, push, start or stop tasks, answer permission requests, release or tag your Next version, and change settings. Every single action waits for your yes (a popup, or you typing yes in that chat). Version numbers, the updaters and your identity stay yours. You can turn it off any time.', buttons: ['Turn on', 'Cancel'], defaultId: 1, cancelId: 1 });
        if (c !== 0) return { ...readSettings(), message: 'Cancelled.' };
      }
      s.actForMe = on;
    }
    writeSettings(s);
    mainWindow.webContents.setZoomFactor(s.textSize / 100);
    return s;
  });
  handle('settings:addDir', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Give the AIs access to a folder', properties: ['openDirectory'] });
    const s = readSettings();
    if (!r.canceled && r.filePaths[0]) {
      const d = r.filePaths[0];
      if (d === '/' || d === os.homedir()) throw new Error('Pick a specific folder, not your whole home folder or the whole disk.');
      if (!s.extraDirs.includes(d)) s.extraDirs.push(d);
      writeSettings(s);
    }
    return s;
  });
  handle('settings:removeDir', (d) => {
    const s = readSettings();
    s.extraDirs = s.extraDirs.filter((x) => x !== d);
    writeSettings(s);
    return s;
  });
  handle('settings:pickBinary', async (agent) => {
    validateProvider(agent);
    const r = await dialog.showOpenDialog(mainWindow, { title: `Locate the ${agents.BIN[agent]} program`, properties: ['openFile'] });
    const s = readSettings();
    if (!r.canceled && r.filePaths[0]) s.bins[agent] = r.filePaths[0];
    writeSettings(s);
    return s;
  });

  handle('agents:status', async (agent) => {
    validateProvider(agent);
    const s = readSettings();
    return agents.status(agent, s.bins[agent]);
  });
  // One agent or a list ("Install all"); everything runs in a visible terminal.
  handle('agents:install', (list) => {
    const ids = (Array.isArray(list) ? list : [list]).map((a) => validateProvider(a));
    if (!ids.length || ids.length > 12) throw new Error('nothing to install');
    return agents.install([...new Set(ids)]);
  });
  handle('agents:logout', async (agent) => {
    validateProvider(agent);
    return agents.logout(agent, readSettings().bins[agent]);
  });
  handle('agents:login', (agent) => {
    validateProvider(agent);
    const s = readSettings();
    return agents.login(agent, s.bins[agent], s.project || undefined);
  });
  // The provider's own account / API-key page in your browser.
  handle('agents:openSignin', (agent) => {
    const url = web.SIGNIN[agent];
    if (!url) throw new Error('No sign-in page for this one.');
    shell.openExternal(url);
    return { ok: true, url };
  });
  // The provider's own chat site in a sandboxed in-app window (you sign in there).
  handle('web:open', (provider) => openWeb(String(provider)));
  handle('web:openExport', (provider) => {
    const url = web.EXPORT[provider];
    if (!url) return { ok: false, message: 'This provider offers no chat export.' };
    shell.openExternal(url);
    return { ok: true };
  });

  // Run an agent. mode 'read' answers/plans in the project folder; mode 'edit'
  // works inside the task's own worktree. Out-of-usage is reported as kind 'limit'.
  handle('agents:run', async (opts) => {
    if (!opts || typeof opts !== 'object') throw new Error('bad request');
    const agent = validateProvider(opts.agent);
    // Every AI reads the project memory (.hearth-ai/PROJECT.md) at the start of each run.
  const prompt = opsApi ? opsApi.withMemory(validatePrompt(opts.prompt)) : validatePrompt(opts.prompt);
    let mode = opts.mode === 'edit' ? 'edit' : 'read';
    const runId = typeof opts.runId === 'string' && /^[A-Za-z0-9]{4,20}$/.test(opts.runId) ? opts.runId : null;
    const s = readSettings();
    // A chat linked to another project, or a window showing another project, never runs here.
    if (opts.projectId !== undefined) {
      const g = binding.checkAction(opts.projectId);
      if (!g.ok) return { ok: false, error: { kind: 'wrong_project', message: `Not run: ${g.reason}.` } };
    }
    let cwd = s.project || undefined;
    if (opts.unlinked === true) {
      // A chat with no project: it can talk, never edit, and sees no project's files.
      cwd = path.join(dataDir(), 'chats', 'no-project');
      fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
      mode = 'read';
    } else if (opts.taskId) {
      const dir = taskDir(opts.taskId);
      if (fs.existsSync(dir)) {
        // Only a workspace of the open project's repository (never another project's).
        if (!s.project || !(await workspace.belongsTo(dir, s.project))) {
          return { ok: false, error: { kind: 'wrong_project', message: `Not run: the workspace ${opts.taskId} belongs to a different project's repository than ${s.project ? path.basename(s.project) : 'the open project'}.` } };
        }
        cwd = dir;
      }
    }
    if (mode === 'edit') mode = s.access; // 'standard' or 'full'
    if (mode !== 'read' && agent === 'ollama') {
      return { ok: false, error: { kind: 'read_only', message: 'The local model can chat, plan and review, but cannot edit files.' } };
    }
    if (mode !== 'read' && (opts.unlinked === true || !opts.taskId || cwd !== taskDir(opts.taskId))) {
      return { ok: false, error: { kind: 'no_workspace', message: 'Pick a project folder in Settings first so the task has a workspace.' } };
    }

    const title = typeof opts.title === 'string' ? opts.title.slice(0, 120) : 'Conversation';
    const shown = typeof opts.historyText === 'string' && opts.historyText.trim() ? opts.historyText.slice(0, 8000) : prompt.slice(0, 8000);
    const taskId = typeof opts.taskId === 'string' && TASK_ID.test(opts.taskId) ? opts.taskId : null;

    if (LIVE_PROVIDERS.includes(agent) && s.connection[agent] === 'api') {
      // API connections can't touch files; in edit mode they answer with a plan instead.
      const r = await callProvider({ provider: agent, apiKey: secrets.get(agent), model: validateModel(opts.model || DEFAULT_MODELS[agent]), prompt });
      if (!r.ok) {
        if (r.error.kind === 'rate_limit' || agents.isLimit(r.error.message)) r.error.kind = 'limit';
        else if (r.error.kind === 'server' || r.error.kind === 'network') r.error.kind = 'outage';
        else if (r.error.kind === 'no_key') r.error.kind = 'auth';
      }
      const out = cleanResult(r.ok ? { ...r, via: 'API' } : r);
      // API chats have no CLI session; the app's history is their only copy.
      if (out.ok) {
        const thread = typeof opts.thread === 'string' && /^[A-Za-z0-9:_-]{2,60}$/.test(opts.thread) ? opts.thread : `once-${Date.now()}`;
        try { history.append({ provider: agent, sessionId: `api-${thread}`, title, cwd, taskId, resumable: false, messages: [{ role: 'user', text: shown, at: new Date().toISOString() }, { role: 'assistant', text: out.text, at: new Date().toISOString() }] }); } catch {}
      }
      return out;
    }

    const controller = new AbortController();
    if (runId) runs.set(runId, controller);
    // No output and no file changes for the project's stall time: stopped as 'stalled'.
    const wd = mode !== 'read' && taskId && opsApi ? opsApi.watchdog(cwd, () => controller.abort()) : null;
    const base = {
      agent,
      cwd,
      mode,
      model: opts.model && s.connection[agent] !== 'api' ? validateModel(opts.model) : undefined,
      timeoutMs: mode === 'read' ? 10 * 60 * 1000 : 30 * 60 * 1000,
      signal: controller.signal,
      bin: s.bins[agent],
      extraDirs: s.extraDirs,
      // Only files from the app's attachments folder are ever passed to a tool.
      images: (Array.isArray(opts.images) ? opts.images : []).filter((f) => typeof f === 'string' && attachments.inside(f, [attachments.attachDir(worktreeRoot())])).slice(0, 8),
      onData: wd ? wd.touch : undefined,
      // Each AI's own folder for generated files (images etc.), inside its workspace.
      extraEnv: opsApi ? opsApi.assetsEnv(agent, cwd) : undefined,
    };
    try {
      const resumeId = typeof opts.resumeId === 'string' ? opts.resumeId : null;
      let r = await agents.runAgent({ ...base, prompt, resumeId });
      // If continuing the saved CLI session didn't work, start a fresh one with the full brief.
      if (!r.ok && r.resumeFailed && ['failed', 'unsupported'].includes(r.error.kind) && typeof opts.fallbackPrompt === 'string' && !controller.signal.aborted) {
        r = await agents.runAgent({ ...base, prompt: validatePrompt(opts.fallbackPrompt) });
        r.resumeReset = true;
      }
      if (wd?.stalled) r = { ok: false, error: { kind: 'stalled', message: `No output and no file changes for ${opsApi.stallMinutes()} minutes, so the run was stopped. Progress is checkpointed.` }, partial: r.partial || null };
      r = cleanResult(r);
      if (r.ok && r.sessionId) {
        try {
          history.append({ provider: agent, sessionId: r.sessionId, title, cwd, taskId, resumable: true, messages: [{ role: 'user', text: shown, at: new Date().toISOString() }, { role: 'assistant', text: r.text, at: new Date().toISOString() }] });
        } catch {}
      }
      return r;
    } finally {
      wd?.stop();
      if (runId) runs.delete(runId);
    }
  });

  // ---- chat history bridge ----
  const knownDirs = () => {
    const s = readSettings();
    let ws = [];
    try { ws = fs.readdirSync(worktreeRoot()).map((d) => path.join(worktreeRoot(), d)); } catch {}
    return [...s.projects, ...ws, os.homedir()];
  };
  handle('history:scan', () => {
    const found = bridge.scanAll({ knownDirs: knownDirs() });
    const n = history.upsertMany(found);
    return { ok: true, found: n, stats: history.stats() };
  });
  handle('history:search', (q, filters) => history.search(String(q || '').slice(0, 200), filters && typeof filters === 'object' ? filters : {}));
  handle('history:get', (key) => history.get(String(key)));
  handle('history:stats', () => history.stats());
  handle('history:remove', (key) => history.remove(String(key)));
  // Reopen a conversation in that AI's own CLI, in a terminal, in its folder.
  handle('history:resume', (key) => {
    const c = history.get(String(key));
    if (!c) return { ok: false, message: 'Not found.' };
    const args = bridge.resumeArgs(c.provider, c.sessionId);
    if (!c.resumable || !args) return { ok: false, message: 'This conversation can\'t be resumed in a CLI (imported from a web app, or an API chat).' };
    const file = agents.findBinary(c.provider, readSettings().bins[c.provider]);
    if (!file) return { ok: false, message: `${agents.BIN[c.provider]} is not installed.` };
    const cwd = c.cwd && fs.existsSync(c.cwd) ? c.cwd : os.homedir();
    return { ...agents.openTerminal(file, args, cwd), command: `${agents.BIN[c.provider]} ${args.join(' ')}`, cwd };
  });
  // "Open in <provider>": the conversation's own page when the export gave its id.
  handle('history:openWeb', (key, inApp) => {
    const c = history.get(String(key));
    if (!c) return { ok: false };
    const url = web.conversationUrl(c.provider, c.source?.startsWith('import') ? c.sessionId : null) || web.WEB[c.provider];
    if (!url) return { ok: false, message: 'No web app for this one.' };
    if (inApp && web.WEB[c.provider]) return openWeb(c.provider, url);
    shell.openExternal(url);
    return { ok: true };
  });
  handle('history:import', async (kind) => {
    const k = ['auto', 'chatgpt', 'claude', 'gemini', 'deepseek', 'generic'].includes(kind) ? kind : 'auto';
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Import an official chat export', properties: ['openFile'], filters: [{ name: 'Chat exports', extensions: ['zip', 'json'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
    const f = r.filePaths[0];
    if (fs.statSync(f).size > 1024 * 1024 * 1024) return { ok: false, message: 'That file is over 1 GB.' };
    try {
      const out = imports.importFile(fs.readFileSync(f), { name: path.basename(f), kind: k });
      const n = history.upsertMany(out.conversations);
      return { ok: true, kind: out.kind, imported: n, file: path.basename(f) };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });

  // ---- theme (follows Hearth OS's desktop theme when present) ----
  handle('theme:get', () => theme.readTheme());
  handle('agents:cancel', (runId) => {
    runs.get(runId)?.abort();
    return true;
  });

  handle('workspace:ensure', async (taskId, title) => {
    const s = readSettings();
    if (!s.project) throw new Error('Pick a shared project folder in Settings first.');
    taskDir(taskId);
    return workspace.ensureWorktree({ project: s.project, root: worktreeRoot(), taskId, title: String(title).slice(0, 200) });
  });
  // The team chat's workspace: chosen here (never by the window) and verified to belong
  // to the open project's repository; one from another repo is never used.
  handle('workspace:ensureChat', async (projectId) => {
    const g = binding.checkAction(projectId);
    if (!g.ok) return { ok: false, message: `Not done: ${g.reason}.` };
    const s = readSettings();
    if (!s.project) return { ok: false, message: 'Pick a project folder first.' };
    try {
      const pick = await guard.chooseChatWorkspace({ project: s.project, root: worktreeRoot(), belongsTo: workspace.belongsTo });
      const ws = await workspace.ensureWorktree({ project: s.project, root: worktreeRoot(), taskId: pick.id, title: 'team chat' });
      return { ok: true, ...ws, id: pick.id, projectId: binding.active(), notice: pick.notice };
    } catch (e) { return { ok: false, message: String(e.message || e) }; }
  });
  handle('workspace:head', (taskId) => workspace.head(taskDir(taskId)));
  // ---- chat attachments (images / videos) ----
  const withFrames = async (r) => {
    if (!r.ok) return r;
    const att = { ...r.att, url: pathToFileURL(r.att.path).href, ...(r.att.kind === 'image' && opsApi ? opsApi.imageInfo(r.att.path) : {}) };
    // A picture too big to decode is never put in an <img> in the window (it shows as a file).
    if (att.kind === 'image') { const fit = require('./bigfiles.cjs').pictureFit(att); if (!fit.decode) att.huge = fit.reason; }
    if (att.kind === 'video') {
      const f = await attachments.extractFrames(att.path, { ffmpeg: gitops.find('ffmpeg'), count: 4 });
      Object.assign(att, { frames: f.frames, duration: f.duration, note: f.note, ...(f.width ? { width: f.width, height: f.height } : {}) });
    }
    return { ok: true, att };
  };
  handle('attach:save', (name, data) => withFrames(attachments.saveBuffer(worktreeRoot(), String(name || ''), Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data || []))));
  // Picked files are streamed from disk (up to 10 GB each) with progress; attach:cancel stops it.
  let picking = null;
  const pickedCopy = async (f) => {
    picking = picking && !picking.signal.aborted ? picking : new AbortController();
    const name = path.basename(f);
    return withFrames(await attachments.saveFromPathStreamed(worktreeRoot(), f, { signal: picking.signal, onProgress: (p) => send('media:progress', { chatId: null, attach: true, name, done: p.done, total: p.total ?? null, finished: p.finished === true }) }));
  };
  handle('attach:cancel', () => { picking?.abort(); return true; });
  // Images & Videos › Send to a chat: the picture or video goes into the message box. 18+ ones
  // stay in Images & Videos (never sent to Claude, ChatGPT or Gemini).
  handle('studio:toAttach', async (id) => {
    const it = parityApi?.studio.list().items.find((x) => x.id === String(id));
    if (!it) return { ok: false, message: 'That one isn\'t there any more.' };
    if (it.adult) return { ok: false, message: 'Pictures and videos made in Uncensored mode stay in Images & Videos: they\'re never sent to Claude, ChatGPT or Gemini.' };
    const f = parityApi.studio.itemFile(it.id);
    if (!f) return { ok: false, message: 'The file isn\'t there any more.' };
    const r = await pickedCopy(f);
    picking = null;
    send('media:progress', { chatId: null, attach: true, finished: true });
    return r;
  });
  handle('attach:pick', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Attach images or videos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images and videos', extensions: Object.keys(attachments.TYPES) }] });
    if (r.canceled) return [];
    const out = [];
    for (const f of r.filePaths.slice(0, 10)) out.push(await pickedCopy(f));
    picking = null;
    send('media:progress', { chatId: null, attach: true, finished: true });
    return out;
  });
  // An AI's ATTACH line: relative to its workspace; only files inside the project,
  // the task workspaces or the attachments folder.
  handle('attach:fromAgent', (rel, baseTaskId) => {
    const s = readSettings();
    let base = s.project;
    try { if (baseTaskId && fs.existsSync(taskDir(String(baseTaskId)))) base = taskDir(String(baseTaskId)); } catch {}
    if (!base) return { ok: false, message: 'No workspace.' };
    // Only a plain relative path inside the workspace: no absolute paths, no "..".
    const where = attachments.agentPath(base, rel);
    if (!where.ok) return where;
    return withFrames(attachments.saveFromPath(worktreeRoot(), where.file, { roots: [s.project, worktreeRoot()] }));
  });
  handle('workspace:checkpoint', async (taskId, author, message) => {
    const dir = taskDir(taskId);
    const s = readSettings();
    if (fs.existsSync(dir) && !(s.project && (await workspace.belongsTo(dir, s.project)))) throw new Error(`The workspace ${taskId} belongs to a different project's repository; nothing was committed.`);
    return workspace.checkpoint(dir, { author: String(author).slice(0, 40), message: String(message).slice(0, 300) });
  });
  handle('workspace:summary', (taskId, baseSha) => {
    if (!/^[0-9a-f]{7,40}$/.test(baseSha)) throw new Error('bad sha');
    return workspace.summary(taskDir(taskId), baseSha);
  });
  handle('workspace:open', (taskId) => shell.openPath(taskId ? taskDir(taskId) : readSettings().project || dataDir()));
  // Hand a task to FreeBuff: brief goes to the clipboard and a file next to the
  // worktree, then FreeBuff opens in a terminal inside the task's worktree.
  handle('workspace:openFreebuff', (taskId, brief) => {
    const dir = taskDir(taskId);
    if (!fs.existsSync(dir)) throw new Error('Start the task first so it has a workspace.');
    const s = readSettings();
    const file = agents.findBinary('freebuff', s.bins.freebuff);
    if (!file) return { ok: false, message: 'FreeBuff is not installed yet. Open Agents and press Install on FreeBuff (one click, no password).' };
    const text = String(brief).slice(0, 20000);
    const briefFile = path.join(worktreeRoot(), `${taskId}-HANDOFF.md`);
    fs.writeFileSync(briefFile, text, { mode: 0o600 });
    clipboard.writeText(text);
    const r = agents.openTerminal(file, [], dir);
    return r.ok ? { ...r, briefFile } : r;
  });

  // ---- git + GitHub ----
  handle('git:tools', async () => {
    const t = await gitops.tools();
    if (t.ghUser) await gitops.setupGitAuth();
    return t;
  });
  handle('git:login', () => {
    const gh = gitops.find('gh');
    if (!gh) return { ok: false, message: 'GitHub CLI (gh) is not installed. Install it first (see the setup checklist).' };
    // GitHub's own sign-in in your browser; afterwards git push/pull use it too.
    return agents.openTerminal(gh, ['auth', 'login', '--web', '--git-protocol', 'https', '--hostname', 'github.com'], os.homedir(), { hold: true });
  });
  handle('git:status', () => {
    const s = readSettings();
    return s.project ? gitops.status(s.project) : { repo: false };
  });
  handle('git:pull', () => {
    const s = readSettings();
    if (!s.project) throw new Error('Pick a project first.');
    return gitops.pull(s.project);
  });
  handle('git:pushTask', async (taskId) => {
    const s = readSettings();
    const dir = taskDir(taskId);
    if (!fs.existsSync(dir)) return { ok: false, message: 'No workspace yet.' };
    const branch = (await workspace.git(dir, ['branch', '--show-current'])).out;
    return gitops.pushBranch(s.project || dir, branch);
  });
  handle('git:pushBranch', (branch) => {
    const s = readSettings();
    if (!s.project) throw new Error('Pick a project first.');
    return gitops.pushBranch(s.project, String(branch));
  });
  // Only called from the Approve flow in the UI (owner click).
  handle('git:mergeApproved', async (taskId, opts = {}) => {
    const s = readSettings();
    const dir = taskDir(taskId);
    if (!s.project || !fs.existsSync(dir)) return { ok: false, message: 'This task has no workspace to merge.' };
    const branch = (await workspace.git(dir, ['branch', '--show-current'])).out;
    // Only the approved commit is merged: the task branch must still be exactly there.
    const sha = typeof opts?.sha === 'string' ? opts.sha : null;
    if (sha !== null && (await workspace.git(dir, ['rev-parse', 'HEAD'])).out !== sha) return { ok: false, message: 'The task branch changed after it was approved. Nothing was merged; review it again.' };
    // The lead's approval (only while the owner's switch is on, checked here) is the same
    // single Approve-to-merge step, without the owner's confirmation box. Never a release.
    // The owner's rule: merging always asks him. The old "Lead may merge" switch only lets the
    // lead ask; it never skips this native box (it did in 1.4–1.7).
    if (opts?.byLead === true) {
      if (s.leadActions !== true) return { ok: false, message: 'The lead switch is off.' };
      if (s.leadMerge !== true) return { ok: false, message: 'Lead may merge to main is off.' };
      if (!sha) return { ok: false, message: 'No approved commit recorded; the lead cannot merge it.' };
    }
    const confirm = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      message: `${opts?.byLead === true ? 'The lead asks: ' : ''}Merge ${branch} into the main branch and push it to GitHub?`,
      detail: 'This changes the main branch of your project. If it touches booting, make sure the previous version stays startable.',
      buttons: ['Merge and push', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (confirm !== 0) return { ok: false, message: 'Cancelled.' };
    return gitops.mergeApproved(s.project, branch, sha);
  });
  // The lead as integrator: fetch, push task/release branches, merge an approved task
  // onto the release branch. Uses your own git/gh sign-in; never main, tags or releases.
  handle('git:leadSync', async (op, arg) => {
    const s = readSettings();
    if (!s.project) return { ok: false, message: 'Pick a project first.' };
    // Checked here, not trusted from the page: only while the owner's toggle is on.
    if (s.leadGitHub !== true) return { ok: false, message: 'Lead handles GitHub is off.' };
    if (op === 'fetch') return gitops.leadFetch(s.project);
    const dir = taskDir(String(arg || ''));
    if (!fs.existsSync(dir)) return { ok: false, message: 'This task has no workspace.' };
    const branch = (await workspace.git(dir, ['branch', '--show-current'])).out;
    if (op === 'push') return gitops.leadPush(s.project, branch);
    if (op === 'integrate') return gitops.integrateIntoRelease(s.project, 'release/next', branch);
    return { ok: false, message: gitops.leadGitAllowed(String(op)).reason };
  });
  // Bring a task branch up to date with main (inside its worktree; main is untouched).
  handle('git:updateFromMain', async (taskId) => {
    const s = readSettings();
    const dir = taskDir(taskId);
    if (!s.project || !fs.existsSync(dir)) return { ok: false, message: 'This task has no workspace.' };
    return gitops.updateFromMain(s.project, dir);
  });
  // Combine several approved task branches into one release branch (never main).
  // The name is a date stamp: version numbers are always the owner's to choose.
  handle('git:releaseBranch', async (taskIds) => {
    const s = readSettings();
    if (!s.project) return { ok: false, message: 'Pick a project first.' };
    // Each entry: { id, sha } with the approved commit. Workspaces with unsaved changes or
    // that moved past their approval are refused (nothing is snapshotted for you).
    const branches = [];
    const problems = [];
    for (const e of (Array.isArray(taskIds) ? taskIds : []).slice(0, 30)) {
      const id = String(e && typeof e === 'object' ? e.id : e);
      const sha = e && typeof e === 'object' && typeof e.sha === 'string' ? e.sha : null;
      const dir = taskDir(id);
      if (!fs.existsSync(dir)) continue;
      if ((await workspace.git(dir, ['status', '--porcelain'])).out) { problems.push(`T-${id} has unsaved changes`); continue; }
      const head = (await workspace.git(dir, ['rev-parse', 'HEAD'])).out;
      if (sha && head !== sha) { problems.push(`T-${id} changed after it was approved`); continue; }
      const b = (await workspace.git(dir, ['branch', '--show-current'])).out;
      if (b) branches.push(sha ? { branch: b, sha } : b);
    }
    if (problems.length) return { ok: false, message: `Not combined: ${problems.join('; ')}. Nothing was changed.` };
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const name = `release/tasks-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return gitops.releaseBranch(s.project, name, branches);
  });
  handle('git:openPr', async (taskId, title, body) => {
    const s = readSettings();
    const dir = taskDir(taskId);
    const branch = (await workspace.git(dir, ['branch', '--show-current'])).out;
    const r = await gitops.openPr(s.project, branch, title, redact(String(body)));
    if (r.ok && r.url?.startsWith('https://github.com/')) shell.openExternal(r.url);
    return r;
  });
  handle('git:prList', () => {
    const s = readSettings();
    return s.project ? gitops.prList(s.project) : { ok: false, prs: [], message: 'Pick a project first.' };
  });
  handle('git:prView', async (taskId) => {
    const s = readSettings();
    const dir = taskDir(taskId);
    if (!s.project || !fs.existsSync(dir)) return { ok: false, message: 'No workspace.' };
    const branch = (await workspace.git(dir, ['branch', '--show-current'])).out;
    return gitops.prView(s.project, branch);
  });
  // Only from the owner's Approve click; a native confirmation is the last gate.
  handle('git:prMerge', async (number, opts = {}) => {
    const s = readSettings();
    if (!s.project) return { ok: false, message: 'Pick a project first.' };
    const n = Number(number);
    const sha = typeof opts?.sha === 'string' ? opts.sha : null;
    // Always asks the owner, also when the lead asked (the switch never skips this box).
    if (opts?.byLead === true) {
      if (s.leadActions !== true) return { ok: false, message: 'The lead switch is off.' };
      if (s.leadMerge !== true) return { ok: false, message: 'Lead may merge to main is off.' };
      if (!sha) return { ok: false, message: 'No approved commit recorded; the lead cannot merge it.' };
    }
    const confirm = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      message: `${opts?.byLead === true ? 'The lead asks: ' : ''}Merge pull request #${n} on GitHub?`,
      detail: 'You approved this in Hearth AI Command Center. This changes the base branch (usually main). If it touches booting, make sure the previous version stays startable.',
      buttons: ['Merge pull request', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (confirm !== 0) return { ok: false, message: 'Cancelled.' };
    return gitops.prMerge(s.project, n, sha);
  });
  // Releases: separate explicit approval, version typed by the owner twice.
  handle('git:release', async (o) => {
    const s = readSettings();
    if (!s.project) return { ok: false, message: 'Pick a project first.' };
    if (!o || typeof o.version !== 'string' || o.version !== o.confirmVersion) return { ok: false, message: 'The two version fields must match exactly.' };
    let gatedSha = null;
    // The release gate: the checklist must pass for the commit being released (or the Owner overrides it).
    if (opsApi) {
      const rg = await opsApi.releaseGate(o.version, String(o.target || ''));
      if (!rg.ok) return { ok: false, message: `Not released: ${rg.reason}.` };
      gatedSha = rg.sha;
    }
    const confirm = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      message: `Create release v${o.version} from ${o.target}?`,
      detail: `Version v${o.version} was typed by you. ${o.draft === false ? 'It is published right away.' : 'It is created as a draft; press Publish on GitHub when ready.'}`,
      buttons: [`Create v${o.version}`, 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (confirm !== 0) return { ok: false, message: 'Cancelled.' };
    // Tag exactly the commit the gate checked, not whatever the branch is by then.
    return gitops.releaseCreate(s.project, { version: o.version, target: gatedSha || String(o.target || ''), notes: redact(String(o.notes || '')), draft: o.draft !== false });
  });
  handle('git:clone', async (input) => {
    if (!gitops.find('git')) return { ok: false, message: 'git is not installed.' };
    const r = await gitops.clone(String(input), path.join(os.homedir(), 'HearthProjects'));
    if (r.ok) r.settings = opsApi ? opsApi.useFolder(r.dir) : useProject(r.dir);
    return r;
  });

  // Text files (logs, notes, code) for the composer's attach button; images still go to attach:save.
  handle('attach:saveAny', (name, data) => {
    const buf = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data || []);
    if (attachments.kindOf(String(name || ''))) return withFrames(attachments.saveBuffer(worktreeRoot(), String(name || ''), buf));
    if (/\.pdf$/i.test(String(name || ''))) return savePdf(String(name), buf);
    const r = attachments.saveText(worktreeRoot(), String(name || ''), buf);
    return r.ok ? { ok: true, att: { ...r.att, url: null } } : r;
  });
  handle('attach:pickAny', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Attach files', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images, videos, PDFs and text files', extensions: [...Object.keys(attachments.TYPES), 'pdf', ...attachments.TEXT_EXT] }, { name: 'All files', extensions: ['*'] }] });
    if (r.canceled) return [];
    const out = [];
    for (const f of r.filePaths.slice(0, 10)) {
      if (attachments.kindOf(f)) { out.push(await pickedCopy(f)); continue; }
      // PDFs and text files are read whole (their text goes to the AIs), so their size is checked first.
      let size = 0;
      try { size = fs.statSync(f).size; } catch { out.push({ ok: false, message: `File not found: ${path.basename(f)}` }); continue; }
      if (/\.pdf$/i.test(f)) out.push(size > 100 * 1024 * 1024 ? { ok: false, message: `${path.basename(f)} is ${Math.round(size / 1048576)} MB; PDFs can be up to 100 MB.` } : await savePdf(path.basename(f), fs.readFileSync(f)));
      else if (size > attachments.TEXT_MAX) out.push({ ok: false, message: `${path.basename(f)} is ${Math.round(size / 1048576)} MB; text files can be up to ${Math.round(attachments.TEXT_MAX / 1048576)} MB (the AIs read them as text).` });
      else { const t = attachments.saveText(worktreeRoot(), path.basename(f), fs.readFileSync(f)); out.push(t.ok ? { ok: true, att: { ...t.att, url: null } } : t); }
    }
    picking = null;
    send('media:progress', { chatId: null, attach: true, finished: true });
    return out;
  });

  // PDFs: kept in the attachments folder; their text (pdftotext, else Mistral OCR with the
  // owner's key) goes to the AIs so they can answer questions about long documents.
  async function savePdf(name, buf) {
    if (buf.length > 100 * 1024 * 1024) return { ok: false, message: 'That PDF is over 100 MB.' };
    const dir = attachments.attachDir(worktreeRoot());
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${Date.now()}-${require('node:crypto').randomBytes(3).toString('hex')}-${attachments.safeName(name)}`);
    fs.writeFileSync(file, buf, { mode: 0o600 });
    const t = parityApi ? await parityApi.docText(file) : { text: '' };
    return { ok: true, att: { kind: 'file', name, path: file, size: buf.length, url: null, pdf: true, text: t.text ? t.text.slice(0, 200000) : '', textVia: t.via || null, ...(t.text ? {} : { note: 'No text could be read from this PDF here (install pdftotext, or add a Mistral key for OCR); the AIs get the file itself.' }) } };
  }

  handle('updater:info', () => updater.info());
  handle('updater:check', () => updater.check());
  handle('updater:download', () => updater.download());
  handle('updater:install', () => updater.install());
  handle('updater:restart', () => updater.restart());
  // The settings change log (Settings › Saved data).
  handle('settings:log', () => ({ ...settingsLog().list(), broken: settingsBroken || settingsLog().list().broken || null }));
  registerOps();
  registerV2();
  registerParity();
  // "Make it sound human" (electron/humanizer.cjs) through the AI he picks, on its API path.
  handle('humanize:run', (q) => {
    const agent = String(q?.agent || '');
    const ok = TEAMMATES.includes(agent) || API_ONLY.includes(agent) || (LIVE_PROVIDERS.includes(agent) && readSettings().connection[agent] === 'api');
    if (!ok || agent === 'civitai') return { ok: false, message: 'Pick an AI that answers by API (Free AI, your GPU server, or one with an API key).' };
    // The same Uncensored mode check (and model) as a chat with that AI.
    const unc = studioLib.chatUncensored(readSettings(), agent, String(q?.text || ''));
    if (unc && !unc.ok) return { ok: false, message: unc.message };
    return require('./humanizer.cjs').humanize({ text: q?.text, agent, callApi: (a, _m, p, sig) => apiCall(a, unc?.model || null, p, sig) });
  });
  teamCheck.register({
    handle, agents, readSettings, dataDir,
    methodOf: (agent) => (TEAMMATES.includes(agent) || API_ONLY.includes(agent) ? 'api' : (LIVE_PROVIDERS.includes(agent) && readSettings().connection[agent] === 'api') ? 'api' : 'cli'),
    guardSettings, logChange: (changes, by) => settingsLog().add(changes, by),
    protectFiles: () => [settingsFile(), `${settingsFile()}.bak`, path.join(dataDir(), 'settings-log.json')],
  });
}

let parityApi = null;
function registerParity() {
  parityApi = parity.register({
    handle, dataDir, readSettings, chats, secrets, shell, dialog, send, protocol, attachments, worktreeRoot, BrowserWindow, Notification,
    getWindow: () => mainWindow,
    v2: () => v2Api,
    // The Habitat from the old (1.x) project boards: read-only, never written.
    oldHabitat: () => { const list = ops.projectsList().list; for (const p of list) { const st = require('./migrate-v2.cjs').readStateReadOnly(ops.projectStateFile(p.id)).state; if (st?.habitat) return st.habitat; } return null; },
  });
}

// The app's own API path for one AI (teammates, API-only AIs, AIs switched to an API key).
async function apiCall(agent, model, prompt, signal) {
  if (agent === 'hearth') return parityApi ? parityApi.hearth.chat({ prompt, model, signal }) : { ok: false, error: { kind: 'auth', message: 'Not ready.' } };
  if (TEAMMATES.includes(agent)) return parityApi ? parityApi.teammates.chat(agent, { prompt, model, signal }) : { ok: false, error: { kind: 'auth', message: 'Not ready.' } };
  const r = await callProvider({ provider: agent, apiKey: secrets.get(agent), model: validateModel(model || DEFAULT_MODELS[agent]), prompt });
  if (!r.ok) {
    if (r.error.kind === 'rate_limit' || agents.isLimit(r.error.message)) r.error.kind = 'limit';
    else if (r.error.kind === 'server' || r.error.kind === 'network') r.error.kind = 'outage';
    else if (r.error.kind === 'no_key') r.error.kind = 'auth';
  }
  return r.ok ? { ...r, via: 'API' } : r;
}

// 2.x chats (electron/v2.cjs): runs in temporary copies, GitHub, previews, saved data.
let v2Api = null;
function registerV2() {
  v2Api = v2.register({
    handle, dataDir, readSettings, chats, agents, gitops, attachments, history, redact, send, dialog, shell, worktreeRoot, runs, protocol,
    getWindow: () => mainWindow,
    mcpForRun: (dir, chatId) => (parityApi ? parityApi.mcpForRun(dir, chatId) : null),
    rpGuard: (...a) => (parityApi ? parityApi.rpGuard(...a) : { ok: true }),
    assetsEnv: (agent, cwd) => (opsApi ? opsApi.assetsEnv(agent, cwd) : undefined),
    validateProvider, validatePrompt, validateModel,
    // Uncensored mode: local chat (Ollama, Hearth devices) uses his 18+ model; hard limits stay.
    uncensoredFor: (agent, prompt) => studioLib.chatUncensored(readSettings(), agent, prompt),
    projects: () => ops.projectsList(),
    stateFileFor: (id) => ops.projectStateFile(id),
    extraAgents: TEAMMATES,
    guardSettings,
    apiConnected: (agent) => TEAMMATES.includes(agent) || API_ONLY.includes(agent) || (LIVE_PROVIDERS.includes(agent) && readSettings().connection[agent] === 'api'),
    callApi: (agent, model, prompt, signal) => apiCall(agent, model, prompt, signal),
  });
}

// Team ops (projects, project memory, test runs, CI, logs, voice, phone): electron/ops/.
function registerOps() {
  opsApi = ops.register({
    handle, dataDir, readSettings, useProject, settingsDisk, taskDir, worktreeRoot, gitops, workspace, agents, attachments, redact, send, dialog,
    getWindow: () => mainWindow,
    // The store swaps first and the binding with it: any save still on its way from the
    // window (which shows the previous project until it reloads) is refused.
    setStore: (file, id) => { store = createStore(file); lastLoad = { recoveredFrom: null }; binding.setActive(id); },
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

process.on('uncaughtException', (e) => {
  console.error('[hearth-ai] uncaught:', e?.message || e);
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  secrets = createSecretStore({ safeStorage, dir: dataDir(), allowBasic: () => readSettings().secretsBasic === true });
  // Decrypt saved keys once (async keyring API), so they can be read synchronously afterwards.
  try { await secrets.load(); } catch (e) { console.error('[hearth-ai] keys:', e?.message || e); }
  // The active project's board (the data from before projects is the default project, in the same file).
  store = createStore(ops.stateFile(dataDir(), readSettings().project, readSettings().projects));
  binding.setActive(ops.activeProjectId());
  chats = createChats(dataDir(), { onPurge: (id) => require('./media.cjs').removeChat(require('./media.cjs').mediaRoot(dataDir()), id) });
  history = createHistory(historyFile());
  openWeb = web.createWebWindows({ BrowserWindow, shell, iconPath: path.join(__dirname, '..', 'dist', 'icon.png') });
  theme.watchTheme((t) => send('theme:changed', t));
  updater = createUpdater({ app, send });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  for (const c of runs.values()) c.abort();
  opsApi?.stop();
  v2Api?.stop();
  parityApi?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

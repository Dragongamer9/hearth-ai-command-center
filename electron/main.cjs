// Hearth AI Command Center — Electron main process.
// All privileged work (files, secrets, provider APIs, updates) happens here.
// The renderer only gets the narrow API exposed in preload.cjs.
const { app, BrowserWindow, ipcMain, shell, Menu, safeStorage, dialog, clipboard } = require('electron');
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
function loadSettingsFile() {
  try { const t = fs.readFileSync(settingsFile(), 'utf8'); settingsHash = hashText(t); return JSON.parse(t); } catch { return {}; }
}
const settingsDisk = {
  changed: () => { try { return hashText(fs.readFileSync(settingsFile(), 'utf8')) !== settingsHash; } catch { return false; } },
  keep: () => { settingsMem = loadSettingsFile(); return readSettings(); },
  discard: () => { writeSettings(settingsMem || {}); return readSettings(); },
};
// Main-side settings: the renderer can never hand us an arbitrary path to run in.
function readSettings() {
  if (settingsMem === null) settingsMem = loadSettingsFile();
  const s = settingsMem;
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
    textSize: TEXT_SIZES.includes(s.textSize) ? s.textSize : 100,
    // Habitat page: characters stay in place. Off unless the owner turns it on (the OS setting also counts).
    reduceMotion: s.reduceMotion === true,
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
  };
}
function useProject(dir) {
  const s = readSettings();
  s.project = dir;
  if (!s.projects.includes(dir)) s.projects.unshift(dir);
  s.projects = s.projects.slice(0, 20);
  writeSettings(s);
  return s;
}
function writeSettings(s) {
  fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  const data = JSON.stringify(s, null, 2);
  const tmp = `${settingsFile()}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
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
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
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
  handle('state:load', () => readState());
  handle('state:save', (state) => writeState(state));
  handle('state:backups', () => ({ recoveredFrom: lastLoad.recoveredFrom, lost: Boolean(lastLoad.lost), backups: store.list() }));
  handle('state:restore', (n) => store.restore(Number(n)));
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
    if ('textSize' in patch) {
      if (!TEXT_SIZES.includes(patch.textSize)) throw new Error('Invalid text size');
      s.textSize = patch.textSize;
    }
    if ('reduceMotion' in patch) s.reduceMotion = patch.reduceMotion === true;
    if ('approvalLevels' in patch) s.approvalLevels = cleanSavedLevels(patch.approvalLevels);
    if ('localReviewCode' in patch) s.localReviewCode = patch.localReviewCode === true;
    for (const k of ['leadMerge', 'leadRelease', 'leadTag']) if (k in patch) s[k] = patch[k] === true;
    if ('ownerIdentity' in patch) s.ownerIdentity = cleanIdentity(patch.ownerIdentity);
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
    let cwd = s.project || undefined;
    if (opts.taskId) {
      const dir = taskDir(opts.taskId);
      if (fs.existsSync(dir)) cwd = dir;
    }
    if (mode === 'edit') mode = s.access; // 'standard' or 'full'
    if (mode !== 'read' && agent === 'ollama') {
      return { ok: false, error: { kind: 'read_only', message: 'The local model can chat, plan and review, but cannot edit files.' } };
    }
    if (mode !== 'read' && (!opts.taskId || cwd !== taskDir(opts.taskId))) {
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
  handle('workspace:head', (taskId) => workspace.head(taskDir(taskId)));
  // ---- chat attachments (images / videos) ----
  const withFrames = async (r) => {
    if (!r.ok) return r;
    const att = { ...r.att, url: pathToFileURL(r.att.path).href, ...(r.att.kind === 'image' && opsApi ? opsApi.imageInfo(r.att.path) : {}) };
    if (att.kind === 'video') {
      const f = await attachments.extractFrames(att.path, { ffmpeg: gitops.find('ffmpeg'), count: 4 });
      Object.assign(att, { frames: f.frames, duration: f.duration, note: f.note, ...(f.width ? { width: f.width, height: f.height } : {}) });
    }
    return { ok: true, att };
  };
  handle('attach:save', (name, data) => withFrames(attachments.saveBuffer(worktreeRoot(), String(name || ''), Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data || []))));
  handle('attach:pick', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Attach images or videos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images and videos', extensions: Object.keys(attachments.TYPES) }] });
    if (r.canceled) return [];
    const out = [];
    for (const f of r.filePaths.slice(0, 10)) out.push(await withFrames(attachments.saveFromPath(worktreeRoot(), f)));
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
  handle('workspace:checkpoint', (taskId, author, message) =>
    workspace.checkpoint(taskDir(taskId), { author: String(author).slice(0, 40), message: String(message).slice(0, 300) }));
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
    if (opts?.byLead === true) {
      if (s.leadActions !== true) return { ok: false, message: 'The lead switch is off.' };
      if (s.leadMerge !== true) return { ok: false, message: 'Lead may merge to main is off.' };
      if (!sha) return { ok: false, message: 'No approved commit recorded; the lead cannot merge it.' };
      return gitops.mergeApproved(s.project, branch, sha);
    }
    const confirm = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      message: `Merge ${branch} into the main branch and push it to GitHub?`,
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
    if (opts?.byLead === true) {
      if (s.leadActions !== true) return { ok: false, message: 'The lead switch is off.' };
      if (s.leadMerge !== true) return { ok: false, message: 'Lead may merge to main is off.' };
      if (!sha) return { ok: false, message: 'No approved commit recorded; the lead cannot merge it.' };
      return gitops.prMerge(s.project, n, sha);
    }
    const confirm = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      message: `Merge pull request #${n} on GitHub?`,
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
    // The release gate: the checklist must pass for the commit being released (or the Owner overrides it).
    if (opsApi) {
      const rg = await opsApi.releaseGate(o.version, String(o.target || ''));
      if (!rg.ok) return { ok: false, message: `Not released: ${rg.reason}.` };
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
    return gitops.releaseCreate(s.project, { version: o.version, target: String(o.target || ''), notes: redact(String(o.notes || '')), draft: o.draft !== false });
  });
  handle('git:clone', async (input) => {
    if (!gitops.find('git')) return { ok: false, message: 'git is not installed.' };
    const r = await gitops.clone(String(input), path.join(os.homedir(), 'HearthProjects'));
    if (r.ok) r.settings = opsApi ? opsApi.useFolder(r.dir) : useProject(r.dir);
    return r;
  });

  handle('updater:info', () => updater.info());
  handle('updater:check', () => updater.check());
  handle('updater:download', () => updater.download());
  handle('updater:install', () => updater.install());
  handle('updater:restart', () => updater.restart());
  registerOps();
}

// Team ops (projects, project memory, test runs, CI, logs, voice, phone): electron/ops/.
function registerOps() {
  opsApi = ops.register({
    handle, dataDir, readSettings, useProject, settingsDisk, taskDir, worktreeRoot, gitops, workspace, agents, attachments, redact, send, dialog,
    getWindow: () => mainWindow,
    setStore: (file) => { store = createStore(file); lastLoad = { recoveredFrom: null }; },
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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  secrets = createSecretStore({ safeStorage, dir: dataDir() });
  // The active project's board (the data from before projects is the default project, in the same file).
  store = createStore(ops.stateFile(dataDir(), readSettings().project, readSettings().projects));
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

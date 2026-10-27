// Hearth AI Command Center — Electron main process.
// All privileged work (files, secrets, provider APIs, updates) happens here.
// The renderer only gets the narrow API exposed in preload.cjs.
const { app, BrowserWindow, ipcMain, shell, Menu, safeStorage, dialog, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { validateState, validateProvider, validateApiKey, validateModel, validatePrompt } = require('./validate.cjs');
const { callProvider, DEFAULT_MODELS } = require('./providers.cjs');
const { createSecretStore } = require('./secrets.cjs');
const { createUpdater } = require('./updater.cjs');
const agents = require('./agents.cjs');
const workspace = require('./workspace.cjs');
const gitops = require('./git.cjs');
const { createStore, redact, redactDeep } = require('./store.cjs');

// Hearth OS version this console is pinned to. Display-only: this app never
// changes, bumps, publishes or deploys Hearth OS.
const HEARTH_OS_VERSION = '0.6.55';

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
const runs = new Map(); // runId -> AbortController

// Main-side settings: the renderer can never hand us an arbitrary path to run in.
function readSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch {}
  return {
    project: typeof s.project === 'string' ? s.project : null,
    projects: Array.isArray(s.projects) ? s.projects.filter((p) => typeof p === 'string') : (typeof s.project === 'string' ? [s.project] : []),
    connection: { anthropic: 'cli', openai: 'cli', ...(s.connection || {}) },
    bins: { ...(s.bins || {}) },
    // What AIs may do when working: 'standard' = each tool's own autonomous mode
    // with its built-in safety checks; 'full' = no checks (owner opt-in).
    access: s.access === 'full' ? 'full' : 'standard',
    extraDirs: Array.isArray(s.extraDirs) ? s.extraDirs.filter((d) => typeof d === 'string' && path.isAbsolute(d)) : [],
    autoPush: s.autoPush !== false,
    chatEdits: s.chatEdits !== false,
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
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2), { mode: 0o600 });
}
const TASK_ID = /^[A-Z0-9]{4,10}$/; // 'CHATROOM' is the team chat's own workspace
function taskDir(taskId) {
  if (!TASK_ID.test(taskId)) throw new Error('bad task id');
  return path.join(worktreeRoot(), taskId);
}

let store = null;
let lastLoad = { recoveredFrom: null };

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
    backgroundColor: '#0d0f0e',
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
    hearthOsVersion: HEARTH_OS_VERSION,
    dataPath: dataDir(),
    electron: process.versions.electron,
    packaged: app.isPackaged,
  }));

  handle('providers:status', async () => ({
    encryption: await secrets.available(),
    weakEncryption: secrets.weak(),
    defaults: DEFAULT_MODELS,
    keys: { anthropic: secrets.has('anthropic'), openai: secrets.has('openai'), freebuff: false },
  }));

  handle('providers:setKey', async (provider, key) => {
    await secrets.set(validateProvider(provider, { liveOnly: true }), validateApiKey(key));
    return true;
  });

  handle('providers:removeKey', (provider) => {
    secrets.remove(validateProvider(provider, { liveOnly: true }));
    return true;
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
    return useProject(dir);
  });
  handle('settings:useProject', (dir) => {
    const s = readSettings();
    if (!s.projects.includes(dir)) throw new Error('Unknown project.');
    return useProject(dir);
  });
  handle('settings:set', (patch) => {
    if (!patch || typeof patch !== 'object') throw new Error('bad settings');
    const s = readSettings();
    if ('access' in patch) s.access = patch.access === 'full' ? 'full' : 'standard';
    if ('autoPush' in patch) s.autoPush = Boolean(patch.autoPush);
    if ('chatEdits' in patch) s.chatEdits = Boolean(patch.chatEdits);
    writeSettings(s);
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
  handle('agents:install', (agent) => {
    validateProvider(agent);
    if (agent === 'ollama') {
      shell.openExternal('https://ollama.com/download');
      return { ok: true, terminal: 'your browser' };
    }
    return agents.install(agent);
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

  // Run an agent. mode 'read' answers/plans in the project folder; mode 'edit'
  // works inside the task's own worktree. Out-of-usage is reported as kind 'limit'.
  handle('agents:run', async (opts) => {
    if (!opts || typeof opts !== 'object') throw new Error('bad request');
    const agent = validateProvider(opts.agent);
    const prompt = validatePrompt(opts.prompt);
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

    if (['anthropic', 'openai'].includes(agent) && s.connection[agent] === 'api') {
      // API connections can't touch files; in edit mode they answer with a plan instead.
      const r = await callProvider({ provider: agent, apiKey: secrets.get(agent), model: validateModel(opts.model || DEFAULT_MODELS[agent]), prompt });
      if (!r.ok) {
        if (r.error.kind === 'rate_limit' || agents.isLimit(r.error.message)) r.error.kind = 'limit';
        else if (r.error.kind === 'server' || r.error.kind === 'network') r.error.kind = 'outage';
        else if (r.error.kind === 'no_key') r.error.kind = 'auth';
      }
      return cleanResult(r.ok ? { ...r, via: 'API' } : r);
    }

    const controller = new AbortController();
    if (runId) runs.set(runId, controller);
    try {
      return cleanResult(await agents.runAgent({
        agent,
        prompt,
        cwd,
        mode,
        model: opts.model && s.connection[agent] !== 'api' ? validateModel(opts.model) : undefined,
        timeoutMs: mode === 'read' ? 10 * 60 * 1000 : 30 * 60 * 1000,
        signal: controller.signal,
        bin: s.bins[agent],
        extraDirs: s.extraDirs,
      }));
    } finally {
      if (runId) runs.delete(runId);
    }
  });
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
    if (!file) return { ok: false, message: 'freebuff is not installed. Install it with: npm install -g freebuff' };
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
  handle('git:mergeApproved', async (taskId) => {
    const s = readSettings();
    const dir = taskDir(taskId);
    if (!s.project || !fs.existsSync(dir)) return { ok: false, message: 'This task has no workspace to merge.' };
    const branch = (await workspace.git(dir, ['branch', '--show-current'])).out;
    const confirm = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      message: `Merge ${branch} into the main branch and push it to GitHub?`,
      detail: 'This changes the main branch of your project. If it touches booting, make sure the previous version stays startable.',
      buttons: ['Merge and push', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (confirm !== 0) return { ok: false, message: 'Cancelled.' };
    return gitops.mergeApproved(s.project, branch);
  });
  handle('git:openPr', async (taskId, title, body) => {
    const s = readSettings();
    const dir = taskDir(taskId);
    const branch = (await workspace.git(dir, ['branch', '--show-current'])).out;
    const r = await gitops.openPr(s.project, branch, title, redact(String(body)));
    if (r.ok && r.url?.startsWith('https://github.com/')) shell.openExternal(r.url);
    return r;
  });
  handle('git:clone', async (input) => {
    if (!gitops.find('git')) return { ok: false, message: 'git is not installed.' };
    const r = await gitops.clone(String(input), path.join(os.homedir(), 'HearthProjects'));
    if (r.ok) useProject(r.dir);
    return r;
  });

  handle('updater:info', () => updater.info());
  handle('updater:check', () => updater.check());
  handle('updater:download', () => updater.download());
  handle('updater:install', () => updater.install());
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
  store = createStore(stateFile());
  updater = createUpdater({ app, send });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  for (const c of runs.values()) c.abort();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

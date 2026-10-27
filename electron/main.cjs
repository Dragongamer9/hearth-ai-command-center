// Hearth AI Command Center — Electron main process.
// All privileged work (files, secrets, provider APIs, updates) happens here.
// The renderer only gets the narrow API exposed in preload.cjs.
const { app, BrowserWindow, ipcMain, shell, Menu, safeStorage, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { validateState, validateProvider, validateApiKey, validateModel, validatePrompt } = require('./validate.cjs');
const { callProvider, DEFAULT_MODELS } = require('./providers.cjs');
const { createSecretStore } = require('./secrets.cjs');
const { createUpdater } = require('./updater.cjs');

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

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // Keep a copy of an unreadable file instead of silently losing it.
      try { fs.copyFileSync(stateFile(), `${stateFile()}.corrupt-${Date.now()}`); } catch {}
    }
    return null;
  }
}

function writeState(state) {
  validateState(state);
  const file = stateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return true;
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

function registerIpc() {
  handle('state:load', () => readState());
  handle('state:save', (state) => writeState(state));

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
  updater = createUpdater({ app, send });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

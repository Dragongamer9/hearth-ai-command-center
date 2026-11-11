// Providers' own official pages, opened in an in-app window (or your browser).
// Only these fixed URLs can be opened; the renderer passes a provider id, never
// a URL. Each provider gets its own persistent, sandboxed browser profile with no
// preload and no access to the app, so you sign in on their site with your own
// account and the app never sees, reads or stores the page, password or cookies.
const WEB = Object.freeze({
  anthropic: 'https://claude.ai/new',
  openai: 'https://chatgpt.com/',
  google: 'https://gemini.google.com/app',
  xai: 'https://grok.com/',
  mistral: 'https://chat.mistral.ai/chat',
  qwen: 'https://chat.qwen.ai/',
  perplexity: 'https://www.perplexity.ai/',
  deepseek: 'https://chat.deepseek.com/',
  copilot: 'https://copilot.microsoft.com/',
  meta: 'https://www.meta.ai/',
  freebuff: 'https://freebuff.com/',
  bolt: 'https://bolt.new/',
  firebase: 'https://studio.firebase.google.com/',
});

// Official account / key pages (opened in your browser for sign-in and API keys).
const SIGNIN = Object.freeze({
  anthropic: 'https://claude.ai/login',
  openai: 'https://chatgpt.com/auth/login',
  google: 'https://accounts.google.com/',
  xai: 'https://accounts.x.ai/',
  mistral: 'https://chat.mistral.ai/',
  qwen: 'https://chat.qwen.ai/auth',
  perplexity: 'https://www.perplexity.ai/account/api',
  deepseek: 'https://platform.deepseek.com/api_keys',
  copilot: 'https://copilot.microsoft.com/',
  meta: 'https://www.meta.ai/',
  freebuff: 'https://freebuff.com/',
});

// Official export pages (where you request your data download).
const EXPORT = Object.freeze({
  openai: 'https://chatgpt.com/#settings/DataControls',
  anthropic: 'https://claude.ai/settings/data-privacy-controls',
  google: 'https://takeout.google.com/',
  deepseek: 'https://chat.deepseek.com/',
  meta: 'https://accountscenter.meta.com/info_and_permissions/dyi/',
  copilot: 'https://account.microsoft.com/privacy',
});

const NAMES = { anthropic: 'Claude', openai: 'ChatGPT', google: 'Gemini', xai: 'Grok', mistral: 'Le Chat', qwen: 'Qwen Chat', perplexity: 'Perplexity', deepseek: 'DeepSeek', copilot: 'Copilot', meta: 'Meta AI', freebuff: 'FreeBuff', bolt: 'Bolt', firebase: 'Firebase Studio' };

// Conversation links built from validated ids only.
function conversationUrl(provider, id) {
  const s = String(id || '');
  if (provider === 'openai' && /^[A-Za-z0-9-]{8,64}$/.test(s)) return `https://chatgpt.com/c/${s}`;
  if (provider === 'anthropic' && /^[0-9a-f-]{36}$/i.test(s)) return `https://claude.ai/chat/${s}`;
  return WEB[provider] || null;
}

function createWebWindows({ BrowserWindow, shell, iconPath }) {
  const open = new Map();
  return function openWeb(provider, url = null) {
    const start = url || WEB[provider];
    if (!start || !/^https:\/\//.test(start)) throw new Error('Unknown provider.');
    const existing = open.get(provider);
    if (existing && !existing.isDestroyed()) {
      if (url) existing.loadURL(url);
      existing.focus();
      return { ok: true };
    }
    const win = new BrowserWindow({
      width: 1180,
      height: 860,
      title: `${NAMES[provider] || provider} — official site`,
      icon: iconPath,
      autoHideMenuBar: true,
      backgroundColor: '#171a21',
      webPreferences: {
        partition: `persist:web-${provider}`,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        // No preload: the page gets nothing from this app.
      },
    });
    // Sign-in popups (Google, Microsoft, Apple…) stay in the same sandboxed profile.
    win.webContents.setWindowOpenHandler(({ url: u }) => {
      if (!/^https:\/\//.test(u)) return { action: 'deny' };
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: `persist:web-${provider}`, contextIsolation: true, nodeIntegration: false, sandbox: true } } };
    });
    win.webContents.on('will-navigate', (e, u) => { if (!/^https:\/\//.test(u)) { e.preventDefault(); if (/^mailto:/.test(u)) shell.openExternal(u); } });
    win.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => cb(['clipboard-sanitized-write', 'fullscreen'].includes(perm)));
    win.loadURL(start);
    win.on('closed', () => open.delete(provider));
    open.set(provider, win);
    return { ok: true };
  };
}

module.exports = { WEB, SIGNIN, EXPORT, NAMES, conversationUrl, createWebWindows };

// Follow the Hearth OS desktop theme when running on Hearth OS.
// Mantel writes ~/.config/hearth/theme.json (tokens) and/or theme.css; when they
// exist the app uses them and live-updates on change. Tokens are validated so a
// theme file can only set colors, a corner radius and a font family name.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\)|hsla?\(\s*[\d.\s,%deg]+\))$/i;
const COLOR_KEYS = ['bg', 'bg2', 'panel', 'panel2', 'line', 'text', 'muted', 'faint', 'accent', 'accent2', 'accentInk', 'good', 'warn', 'bad'];

function themeDir() {
  const xdg = process.env.XDG_CONFIG_HOME;
  return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.config'), 'hearth');
}

// Accepts both flat tokens and { tokens: {...} } / { colors: {...} } layouts and
// common aliases (background, foreground, surface, radius, fontFamily).
function sanitizeTokens(raw) {
  const src = { ...(raw?.colors || {}), ...(raw?.tokens || {}), ...(raw || {}) };
  const alias = { background: 'bg', surface: 'panel', foreground: 'text', fg: 'text', secondary: 'muted', border: 'line', radius: 'r', fontFamily: 'font', 'font-family': 'font', 'accent-2': 'accent2' };
  for (const [a, k] of Object.entries(alias)) if (src[a] !== undefined && src[k] === undefined) src[k] = src[a];
  const out = {};
  for (const k of COLOR_KEYS) {
    const v = typeof src[k] === 'string' ? src[k].trim() : '';
    if (COLOR.test(v)) out[k] = v;
  }
  const r = typeof src.r === 'number' ? src.r : parseFloat(src.r);
  if (Number.isFinite(r) && r >= 0 && r <= 24) out.r = r;
  if (typeof src.font === 'string') {
    const f = src.font.split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter((x) => /^[A-Za-z0-9 _-]{1,60}$/.test(x)).slice(0, 4);
    if (f.length) out.font = f;
  }
  if (src.mode === 'light' || src.mode === 'dark') out.mode = src.mode;
  if (typeof src.name === 'string' && /^[\w .-]{1,40}$/.test(src.name)) out.name = src.name;
  return out;
}

// theme.css may only restyle; strip anything that could load outside resources.
function sanitizeCss(css) {
  return String(css || '').slice(0, 200000).replace(/@import[^;]*;?/gi, '').replace(/url\s*\(\s*(['"]?)(?!data:)[^)]*\)/gi, 'none').replace(/<\/?style/gi, '');
}

function readTheme(dir = themeDir()) {
  const out = { found: false, dir, tokens: {}, css: '' };
  try {
    out.tokens = sanitizeTokens(JSON.parse(fs.readFileSync(path.join(dir, 'theme.json'), 'utf8')));
    out.found = true;
  } catch {}
  try {
    out.css = sanitizeCss(fs.readFileSync(path.join(dir, 'theme.css'), 'utf8'));
    out.found = true;
  } catch {}
  return out;
}

// Calls onChange(theme) whenever the files appear, change or go away.
function watchTheme(onChange, dir = themeDir()) {
  let last = JSON.stringify(readTheme(dir));
  let timer = null;
  const check = () => {
    const t = readTheme(dir);
    const s = JSON.stringify(t);
    if (s !== last) { last = s; onChange(t); }
  };
  let watcher = null;
  const arm = () => {
    try { watcher = fs.watch(dir, () => { clearTimeout(timer); timer = setTimeout(check, 150); }); watcher.on('error', () => { watcher = null; }); } catch { watcher = null; }
  };
  arm();
  // Poll too: covers the folder being created later and editors that replace files.
  const poll = setInterval(() => { if (!watcher) arm(); check(); }, 4000);
  return () => { clearInterval(poll); watcher?.close(); };
}

// Display-only: which Hearth OS this computer runs, if any.
function hearthOsRelease(file = '/etc/os-release') {
  try {
    const kv = Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, '')]));
    if (!/hearth/i.test(`${kv.ID} ${kv.NAME} ${kv.PRETTY_NAME}`)) return null;
    return { name: kv.PRETTY_NAME || kv.NAME || 'Hearth OS', version: kv.VERSION_ID || kv.VERSION || null };
  } catch {
    return null;
  }
}

module.exports = { readTheme, watchTheme, sanitizeTokens, sanitizeCss, themeDir, hearthOsRelease };

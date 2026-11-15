'use strict';
// 3.13 (compact-A9): a 2D picture, a Live2D model or a 3D VRM model for each AI. The files you pick are copied into
// the app's own folder (<data>/characters/<ai>/) and served to the window from hearth-char://, read only, never from
// anywhere else. Nothing here is ever sent to an AI. Live2D's Cubism Core (Live2D's own runtime, not included in the
// app) is downloaded from Live2D's site the first time a Live2D model is loaded, and kept in <data>/characters/_core.
const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'hearth-char';
const AGENT_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const KINDS = ['none', 'picture', 'starter', 'live2d', 'vrm'];
const STARTERS = ['ember-fox', 'robot-pilot', 'star-twin', 'wind-sprite', 'moss-bear', 'crystal'];
const PICTURE = /\.(png|gif|webp|jpe?g)$/i;
const MAX_FILE = 200 * 1048576;
const MAX_FOLDER = 400 * 1048576;
const CORE_URL = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';
const MIME = { '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.vrm': 'model/gltf-binary', '.json': 'application/json', '.moc3': 'application/octet-stream', '.js': 'text/javascript', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };

// What's kept in settings: { <ai>: { kind, starter?, file?, motion } }; anything else is dropped.
function clean(v) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [a, c] of Object.entries(v)) {
    if (!AGENT_RE.test(a) || !c || typeof c !== 'object') continue;
    const kind = KINDS.includes(c.kind) ? c.kind : 'none';
    const e = { kind, motion: c.motion !== false };
    if (kind === 'starter') { if (!STARTERS.includes(c.starter)) continue; e.starter = c.starter; }
    if (['picture', 'live2d', 'vrm'].includes(kind)) { const f = String(c.file || ''); if (!f || f.includes('..') || path.isAbsolute(f)) continue; e.file = f; }
    out[a] = e;
  }
  return out;
}

function create({ dataDir, libDir = path.join(__dirname, '..', 'dist', 'vendor', 'avatar-stage'), fetchImpl = (...a) => fetch(...a) }) {
  const root = () => path.join(dataDir(), 'characters');
  const agentDir = (a) => { if (!AGENT_RE.test(a)) throw new Error('bad ai'); return path.join(root(), a); };
  function folderSize(d) { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isSymbolicLink()) continue; n += e.isDirectory() ? folderSize(p) : fs.statSync(p).size; if (n > MAX_FOLDER) return n; } return n; }
  // Copy what he picked into <ai>/<kind>/ (the old one of that kind replaced). Returns the path to keep in settings.
  function importFrom(agent, kind, src) {
    const st = fs.statSync(src);
    const dest = path.join(agentDir(agent), kind);
    if (kind === 'picture') {
      if (!st.isFile() || !PICTURE.test(src) || st.size > MAX_FILE) throw new Error('Pick a PNG, GIF, WebP or JPEG picture (up to 200 MB).');
      fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(dest, { recursive: true });
      const name = `picture${path.extname(src).toLowerCase()}`;
      fs.copyFileSync(src, path.join(dest, name));
      return `${kind}/${name}`;
    }
    if (kind === 'vrm') {
      if (!st.isFile() || !/\.vrm$/i.test(src) || st.size > MAX_FILE) throw new Error('Pick a .vrm file (up to 200 MB).');
      fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(src, path.join(dest, 'model.vrm'));
      return `${kind}/model.vrm`;
    }
    if (kind === 'live2d') {
      const json = st.isDirectory() ? fs.readdirSync(src).find((f) => /\.model3\.json$/i.test(f)) : /\.model3\.json$/i.test(src) ? path.basename(src) : null;
      const folder = st.isDirectory() ? src : path.dirname(src);
      if (!json) throw new Error('That folder has no Live2D model (.model3.json). Cubism 3 and 4 models work.');
      if (folderSize(folder) > MAX_FOLDER) throw new Error('That Live2D folder is over 400 MB.');
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(folder, dest, { recursive: true, dereference: false, filter: (s) => !fs.lstatSync(s).isSymbolicLink() });
      return `${kind}/${json}`;
    }
    throw new Error('Unknown kind.');
  }
  async function ensureCore() {
    const f = path.join(root(), '_core', 'live2dcubismcore.min.js');
    if (fs.existsSync(f)) return { ok: true };
    const r = await fetchImpl(CORE_URL);
    if (!r.ok) return { ok: false, message: `Live2D's Cubism Core couldn't be downloaded (${r.status}).` };
    const txt = await r.text();
    if (!/Live2DCubismCore/.test(txt)) return { ok: false, message: 'Live2D\'s site sent something that isn\'t its Cubism Core.' };
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(`${f}.tmp`, txt); fs.renameSync(`${f}.tmp`, f);
    return { ok: true };
  }
  // hearth-char://stage/?kind=&url= -> the sealed page that draws one model; hearth-char://lib/stage.js -> the renderer.
  function stagePage(u) {
    const kind = u.searchParams.get('kind') === 'live2d' ? 'live2d' : 'vrm';
    const url = String(u.searchParams.get('url') || '');
    if (!/^hearth-char:\/\/a\/[a-z][a-z0-9_-]{0,31}\//.test(url)) return null;
    const core = kind === 'live2d' ? '<script src="hearth-char://core/live2dcubismcore.min.js"></script>' : '';
    const cfg = JSON.stringify({ kind, url }).replace(/</g, '\\u003c');
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src hearth-char: 'unsafe-eval'; img-src hearth-char: data: blob:; connect-src hearth-char: blob: data:; style-src 'unsafe-inline'"><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}#s{width:100%;height:100%}</style><script type="application/json" id="cfg">${cfg}</script>${core}<script src="hearth-char://lib/stage.js"></script></head><body><div id="s"></div><script src="hearth-char://lib/boot.js"></script></body></html>`;
  }
  // hearth-char://a/<ai>/<path…> and hearth-char://core/live2dcubismcore.min.js -> the file, only inside its folder.
  function resolve(url) {
    let u; try { u = new URL(String(url)); } catch { return null; }
    if (u.protocol !== `${SCHEME}:`) return null;
    const parts = u.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return '\0'; } });
    if (parts.some((p) => p === '..' || p.includes('\0') || p.includes('/'))) return null;
    let base;
    if (u.host === 'stage') { const html = stagePage(u); return html ? { body: html, mime: 'text/html' } : null; }
    if (u.host === 'lib') { const name = parts.join('/'); if (!['stage.js', 'boot.js'].includes(name)) return null; return { file: path.join(libDir, name), mime: 'text/javascript' }; }
    if (u.host === 'core') { base = path.join(root(), '_core'); if (parts.join('/') !== 'live2dcubismcore.min.js') return null; }
    else if (u.host === 'a' && AGENT_RE.test(parts[0] || '')) { base = path.join(root(), parts.shift()); }
    else return null;
    let realBase; try { realBase = fs.realpathSync(base); } catch { return null; }
    const f = path.join(realBase, ...parts);
    let real; try { real = fs.realpathSync(f); } catch { return null; }
    if (!real.startsWith(realBase + path.sep)) return null;
    if (!fs.statSync(real).isFile()) return null;
    return { file: real, mime: MIME[path.extname(real).toLowerCase()] || 'application/octet-stream' };
  }
  return { importFrom, ensureCore, resolve, root };
}

module.exports = { SCHEME, KINDS, STARTERS, clean, create, CORE_URL };

// Pictures, videos and files the AIs make in a chat.
// - After each turn the app looks for new images/videos/files the AI made in its working
//   folder (anywhere new, plus .hearth-media/ and .hearth-out/, plus paths it names with
//   FILE:, ATTACH: or a Markdown image) and copies them into the app's own media folder,
//   <data>/media/<chatId>/. They stay after the temporary copy is gone.
// - The window shows them through the hearth-media: scheme, which serves ONLY files inside
//   that media folder for that chat: no file:// links, no paths outside, no symlinks.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEME = 'hearth-media';
const MEDIA_DIRS = ['.hearth-media', '.hearth-out'];
const IMAGE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
const VIDEO = { mp4: 'video/mp4', webm: 'video/webm' };
const FILES = { pdf: 'application/pdf', zip: 'application/zip', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', json: 'application/json', html: 'text/plain; charset=utf-8', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odt: 'application/vnd.oasis.opendocument.text', tar: 'application/x-tar', gz: 'application/gzip', log: 'text/plain; charset=utf-8', mp3: 'audio/mpeg', wav: 'audio/wav' };
const MAX_FILE = 200 * 1024 * 1024;
const CHAT_RE = /^(c[0-9a-f]{10}|team-[a-z0-9]{3,16}|t[0-9a-f]{10})$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,150}$/;
const SKIP = new Set(['.git', 'node_modules', '.hearth-preview', '.hearth-ai', 'dist', 'build', 'target', '.cache', '.venv', '__pycache__']);

const extOf = (n) => String(n || '').split('.').pop().toLowerCase();
const kindOf = (n) => (IMAGE[extOf(n)] ? 'image' : VIDEO[extOf(n)] ? 'video' : 'file');
const mimeOf = (n) => IMAGE[extOf(n)] || VIDEO[extOf(n)] || FILES[extOf(n)] || 'application/octet-stream';
const mediaRoot = (dataDir) => path.join(dataDir, 'media');
const safeName = (n) => String(path.basename(String(n || 'file'))).replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/^[._ -]+/, '').slice(0, 100) || 'file';
const urlFor = (chatId, file) => `${SCHEME}://c/${chatId}/${encodeURIComponent(file)}`;

// A relative path an AI named, resolved inside its folder (no absolute paths, no "..").
function inside(base, rel) {
  const r = String(rel || '').trim().replace(/^\.\//, '');
  if (!r || path.isAbsolute(r) || r.split(/[\\/]+/).includes('..') || /[\0\r\n]/.test(r)) return null;
  let realBase;
  try { realBase = fs.realpathSync(base); } catch { return null; }
  const f = path.resolve(realBase, r);
  let real;
  try { real = fs.realpathSync(f); } catch { return null; }
  if (!real.startsWith(realBase + path.sep)) return null;
  try { if (!fs.statSync(real).isFile()) return null; } catch { return null; }
  return real;
}

// A path as an AI writes it: quotes, <>, backticks, a trailing full stop and a
// "(caption)" are not part of it.
function cleanNamed(p) {
  let x = String(p || '').trim().replace(/\s+\([^)]*\)\s*$/, '').replace(/[.,;:!?]+$/, '').trim();
  x = x.replace(/^[<"'`]+|[>"'`]+$/g, '').replace(/[.,;:!?]+$/, '').trim();
  if (/^file:\/\//i.test(x)) { try { x = decodeURIComponent(x.slice(7)); } catch {} }
  return x;
}
// Paths an AI named in its reply: FILE: x, ATTACH: x (also in a list or quote: "- ATTACH: x"),
// ![alt](x) with a relative path, or an absolute one inside its folder.
function namedPaths(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const m = raw.replace(/[*`]/g, '').trim().replace(/^(?:[-+>•]|\d+[.)])\s*/, '').match(/^(?:FILE|ATTACH)\s*:\s*(.+)$/i);
    if (m) out.push(cleanNamed(m[1]));
  }
  for (const m of String(text || '').matchAll(/!\[[^\]\n]{0,200}\]\(<?([^)\s>]{1,300})>?(?:\s+"[^"]*")?\)/g)) if (!/^(?!file:)[a-z][a-z0-9+.-]*:/i.test(m[1])) out.push(cleanNamed(m[1]));
  return [...new Set(out.filter(Boolean))].slice(0, 20);
}
// Why a named file can't be shown, in plain words (null = it can).
function whyNot(base, named) {
  const r = String(named || '');
  let rel = r;
  let realBase;
  try { realBase = fs.realpathSync(base); } catch { return 'the chat\'s folder is gone'; }
  if (path.isAbsolute(r)) {
    const abs = path.resolve(r);
    if (!(abs === realBase || abs.startsWith(realBase + path.sep) || abs.startsWith(path.resolve(base) + path.sep))) return 'it is outside the chat\'s folder (only files in the chat\'s folder can be shown)';
    rel = path.relative(abs.startsWith(realBase) ? realBase : path.resolve(base), abs);
  }
  if (rel.split(/[\\/]+/).includes('..')) return 'it is outside the chat\'s folder (only files in the chat\'s folder can be shown)';
  const f = path.resolve(realBase, rel);
  let real;
  try { real = fs.realpathSync(f); } catch { return 'the file isn\'t there (missing)'; }
  if (!real.startsWith(realBase + path.sep)) return 'it links outside the chat\'s folder';
  let st;
  try { st = fs.statSync(real); } catch { return 'the file isn\'t there (missing)'; }
  if (!st.isFile()) return 'it is a folder, not a file';
  if (!st.size) return 'the file is empty';
  if (st.size > MAX_FILE) return `it is too large (${Math.round(st.size / 1048576)} MB; the limit is ${MAX_FILE / 1048576} MB)`;
  const e = extOf(real);
  if (!IMAGE[e] && !VIDEO[e] && !FILES[e]) return `.${e} isn't a type the chat can show (pictures: png, jpg, gif, webp, svg; videos: mp4, webm)`;
  return null;
}
// The resolved file for a named path (relative, or absolute inside the folder), or null.
function resolveNamed(base, named) {
  if (whyNot(base, named)) return null;
  let realBase;
  try { realBase = fs.realpathSync(base); } catch { return null; }
  const r = path.isAbsolute(named) ? path.relative(path.resolve(named).startsWith(realBase) ? realBase : path.resolve(base), path.resolve(named)) : named;
  return inside(base, r);
}

// New media files in a folder since a time (bounded walk).
function scan(dir, sinceMs, { max = 2000, depth = 5 } = {}) {
  const found = [];
  let seen = 0;
  const walk = (d, lvl, forced) => {
    if (lvl > depth || seen > max) return;
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (++seen > max) return;
      const f = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(f, lvl + 1, forced || MEDIA_DIRS.includes(e.name)); continue; }
      if (!e.isFile()) continue;
      const k = kindOf(e.name);
      if (k === 'file' && !forced) continue;
      let st;
      try { st = fs.statSync(f); } catch { continue; }
      if (st.mtimeMs < sinceMs - 2000 || st.size > MAX_FILE || !st.size) continue;
      found.push(f);
    }
  };
  walk(dir, 0, false);
  return found;
}

// Copy into <root>/<chatId>/ (deduplicated by content hash). Returns the media items.
function store(root, chatId, files) {
  if (!CHAT_RE.test(String(chatId))) throw new Error('bad chat id');
  const dir = path.join(root, chatId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const out = [];
  const have = new Set();
  for (const f of files) {
    let buf;
    try { const st = fs.statSync(f); if (!st.isFile() || st.size > MAX_FILE) continue; buf = fs.readFileSync(f); } catch { continue; }
    out.push(storeBuffer(root, chatId, path.basename(f), buf, have));
  }
  return out.filter(Boolean);
}
function storeBuffer(root, chatId, name, buf, have = new Set()) {
  if (!CHAT_RE.test(String(chatId))) throw new Error('bad chat id');
  if (!buf?.length || buf.length > MAX_FILE) return null;
  const dir = path.join(root, chatId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
  if (have.has(hash)) return null;
  have.add(hash);
  const file = `${hash}-${safeName(name)}`;
  const dest = path.join(dir, file);
  if (!fs.existsSync(dest)) { const tmp = `${dest}.tmp-${process.pid}`; fs.writeFileSync(tmp, buf, { mode: 0o600 }); fs.renameSync(tmp, dest); }
  return { kind: kindOf(name), name: safeName(name), file, size: buf.length, mime: mimeOf(name), url: urlFor(chatId, file) };
}

function collect(o) { return collectAll(o).items; }
// Everything the AI made or named, plus a plain reason for every named file that can't be
// shown. Each item names the path the AI wrote (from), so the chat can show the picture
// right where its link was.
function collectAll({ cwd, sinceMs, text, chatId, root }) {
  if (!cwd || !fs.existsSync(cwd)) return { items: [], problems: [] };
  const problems = [];
  const fromOf = new Map();
  for (const n of namedPaths(text)) {
    const why = whyNot(cwd, n);
    if (why) { problems.push({ path: n, reason: why }); continue; }
    const f = resolveNamed(cwd, n);
    if (f && !fromOf.has(f)) fromOf.set(f, n);
  }
  const files = [...new Set([...fromOf.keys(), ...scan(cwd, sinceMs)])].slice(0, 24);
  const items = [];
  for (const f of files) {
    let buf;
    try { const st = fs.statSync(f); if (!st.isFile() || st.size > MAX_FILE) continue; buf = fs.readFileSync(f); } catch { continue; }
    const it = storeBuffer(root, chatId, path.basename(f), buf, new Set());
    if (!it) continue;
    // The same picture under two names is shown once; both links point at it.
    const same = items.find((x) => x.file.slice(0, 10) === it.file.slice(0, 10));
    if (same) { if (fromOf.has(f)) { if (!same.from) same.from = fromOf.get(f); else (same.alsoFrom ||= []).push(fromOf.get(f)); } continue; }
    items.push(fromOf.has(f) ? { ...it, from: fromOf.get(f) } : it);
  }
  return { items, problems };
}

// hearth-media://c/<chatId>/<file> -> the file, only inside <root>/<chatId>/.
function resolve(url, root) {
  let u;
  try { u = new URL(String(url)); } catch { return { ok: false, status: 400 }; }
  if (u.protocol !== `${SCHEME}:` || u.host !== 'c') return { ok: false, status: 403 };
  const parts = u.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return '\0'; } });
  if (parts.length !== 2 || !CHAT_RE.test(parts[0]) || !FILE_RE.test(parts[1]) || parts[1].includes('..')) return { ok: false, status: 403 };
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch { return { ok: false, status: 404 }; }
  const f = path.join(realRoot, parts[0], parts[1]);
  let st;
  try { st = fs.lstatSync(f); } catch { return { ok: false, status: 404 }; }
  if (!st.isFile() || st.isSymbolicLink()) return { ok: false, status: 403 };
  let real;
  try { real = fs.realpathSync(f); } catch { return { ok: false, status: 404 }; }
  if (!real.startsWith(path.join(realRoot, parts[0]) + path.sep)) return { ok: false, status: 403 };
  return { ok: true, file: real, size: st.size, mime: mimeOf(parts[1]), chatId: parts[0], name: parts[1] };
}

// The protocol response (Range supported so videos can seek).
function respond(req, root) {
  const r = resolve(req.url, root);
  const base = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox" };
  if (!r.ok) return { status: r.status, headers: { ...base, 'content-type': 'text/plain' }, body: 'Not allowed.' };
  const range = String(req.headers?.get?.('range') || '').match(/^bytes=(\d*)-(\d*)$/);
  let start = 0;
  let end = r.size - 1;
  if (range) { if (range[1]) start = Number(range[1]); if (range[2]) end = Math.min(Number(range[2]), r.size - 1); if (!range[1] && range[2]) { start = Math.max(0, r.size - Number(range[2])); end = r.size - 1; } }
  if (start > end || start >= r.size) return { status: 416, headers: { ...base, 'content-range': `bytes */${r.size}` }, body: '' };
  const headers = { ...base, 'content-type': r.mime, 'accept-ranges': 'bytes', 'content-length': String(end - start + 1), ...(range ? { 'content-range': `bytes ${start}-${end}/${r.size}` } : {}) };
  return { status: range ? 206 : 200, headers, stream: () => fs.createReadStream(r.file, { start, end }) };
}

// Data URI for exports (images only, size-capped).
function dataUri(url, root, max = 15 * 1024 * 1024) {
  const r = resolve(url, root);
  if (!r.ok || r.size > max) return null;
  return `data:${r.mime.split(';')[0]};base64,${fs.readFileSync(r.file).toString('base64')}`;
}

function removeChat(root, chatId) {
  if (!CHAT_RE.test(String(chatId))) return;
  try { fs.rmSync(path.join(root, chatId), { recursive: true, force: true }); } catch {}
}

module.exports = { SCHEME, MEDIA_DIRS, IMAGE, VIDEO, MAX_FILE, CHAT_RE, kindOf, mimeOf, mediaRoot, inside, namedPaths, cleanNamed, whyNot, scan, store, storeBuffer, collect, collectAll, resolve, respond, dataUri, urlFor, removeChat, safeName };

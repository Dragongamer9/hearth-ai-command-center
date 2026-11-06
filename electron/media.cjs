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
const big = require('./bigfiles.cjs');
const { imageInfo } = require('./ops/media.cjs');

const SCHEME = 'hearth-media';
const MEDIA_DIRS = ['.hearth-media', '.hearth-out'];
const IMAGE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml' };
const VIDEO = { mp4: 'video/mp4', webm: 'video/webm', m4v: 'video/mp4' };
const AUDIO = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac' };
const FILES = { pdf: 'application/pdf', zip: 'application/zip', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', json: 'application/json', html: 'text/plain; charset=utf-8', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odt: 'application/vnd.oasis.opendocument.text', tar: 'application/x-tar', gz: 'application/gzip', log: 'text/plain; charset=utf-8' };
// Per file: 10 GB (bigfiles.MAX_STORED). Files are streamed to disk, never held in memory.
const MAX_FILE = big.MAX_STORED;
const CHAT_RE = /^(c[0-9a-f]{10}|team-[a-z0-9]{3,16}|t[0-9a-f]{10})$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,150}$/;
const SKIP = new Set(['.git', 'node_modules', '.hearth-preview', '.hearth-ai', 'dist', 'build', 'target', '.cache', '.venv', '__pycache__']);

const extOf = (n) => String(n || '').split('.').pop().toLowerCase();
const kindOf = (n) => (IMAGE[extOf(n)] ? 'image' : VIDEO[extOf(n)] ? 'video' : AUDIO[extOf(n)] ? 'audio' : 'file');
const mimeOf = (n) => IMAGE[extOf(n)] || VIDEO[extOf(n)] || AUDIO[extOf(n)] || FILES[extOf(n)] || 'application/octet-stream';
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
  if (st.size > MAX_FILE) return big.tooBigMessage(st.size, MAX_FILE);
  const e = extOf(real);
  if (!IMAGE[e] && !VIDEO[e] && !AUDIO[e] && !FILES[e]) return `.${e} isn't a type the chat can show (pictures: png, jpg, gif, webp, avif, svg; videos: mp4, webm; audio: mp3, wav, ogg, m4a, flac)`;
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
      if (st.mtimeMs < sinceMs - 2000 || !st.size) continue;
      found.push(f);
    }
  };
  walk(dir, 0, false);
  return found;
}

// What the chat needs to know about a stored picture: its size in pixels (from the header,
// never decoded), whether it can be opened in the app at all, and whether the chat should
// show a downscaled copy instead of the original.
function describe(dir, item) {
  if (!item || item.kind !== 'image' || /svg/.test(item.mime)) return item;
  const info = imageInfo(path.join(dir, item.file));
  if (!info.width) return item;
  const fit = big.pictureFit({ width: info.width, height: info.height, size: item.size });
  return { ...item, width: info.width, height: info.height, ...(fit.decode ? (fit.view ? { view: true } : {}) : { huge: fit.reason }) };
}
const itemFor = (chatId, name, file, size) => ({ kind: kindOf(name), name: safeName(name), file, size, mime: mimeOf(name), url: urlFor(chatId, file) });

// Copy into <root>/<chatId>/ (deduplicated by content hash), streamed. Returns the media items.
async function store(root, chatId, files, o = {}) {
  if (!CHAT_RE.test(String(chatId))) throw new Error('bad chat id');
  const out = [];
  const have = new Set();
  for (const f of files) {
    const r = await storeFile(root, chatId, f, path.basename(f), o);
    if (r.ok && !have.has(r.item.file)) { have.add(r.item.file); out.push(r.item); }
  }
  return out;
}
// One file from disk: small ones in one read, big ones streamed (up to MAX_FILE, with a
// free-space check, progress and cancel). Returns { ok, item } or { ok: false, code, message }.
async function storeFile(root, chatId, src, name = path.basename(src), o = {}) {
  if (!CHAT_RE.test(String(chatId))) throw new Error('bad chat id');
  const dir = path.join(root, chatId);
  let st;
  try { st = fs.statSync(src); } catch { return { ok: false, code: 'failed', message: 'the file isn\'t there (missing)' }; }
  if (!st.isFile()) return { ok: false, code: 'failed', message: 'it is not a file' };
  if (!st.size) return { ok: false, code: 'failed', message: 'the file is empty' };
  if (st.size > MAX_FILE) return { ok: false, code: 'too-big', size: st.size, limit: MAX_FILE, message: big.tooBigMessage(st.size, MAX_FILE) };
  if (st.size <= big.SMALL && !o.fsImpl) {
    const item = storeBuffer(root, chatId, name, fs.readFileSync(src));
    return item ? { ok: true, item: describe(dir, item) } : { ok: false, code: 'failed', message: 'Couldn\'t copy it.' };
  }
  const r = await big.copyFile(src, dir, name, o);
  if (!r.ok) return r;
  return { ok: true, item: describe(dir, itemFor(chatId, name, r.file, r.size)) };
}
// Bytes already in memory (a generated picture, a short download): capped at MAX_FILE.
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
  if (!fs.existsSync(dest)) { const tmp = path.join(dir, `.part-${process.pid}-${crypto.randomBytes(4).toString('hex')}`); fs.writeFileSync(tmp, buf, { mode: 0o600 }); fs.renameSync(tmp, dest); }
  return describe(dir, itemFor(chatId, name, file, buf.length));
}

async function collect(o) { return (await collectAll(o)).items; }
// Everything the AI made or named, plus a plain reason for every named file that can't be
// shown. Each item names the path the AI wrote (from), so the chat can show the picture
// right where its link was. Big files are streamed (o.signal cancels, o.onProgress reports).
// A file over the limit, or one there's no room for, comes back as a problem with its size
// and the limit, so the chat shows a clear card instead of nothing.
async function collectAll({ cwd, sinceMs, text, chatId, root, signal = null, onProgress = null, fsImpl, statfs }) {
  if (!cwd || !fs.existsSync(cwd)) return { items: [], problems: [] };
  const problems = [];
  const fromOf = new Map();
  let realCwd = cwd;
  try { realCwd = fs.realpathSync(cwd); } catch {}
  const relOf = (f) => path.relative(realCwd, f) || path.basename(f);
  const reported = new Set();
  for (const n of namedPaths(text)) {
    const why = whyNot(cwd, n);
    if (why) {
      const p = { path: n, reason: why };
      if (/too large/.test(why)) {
        let f = null;
        try { const real = fs.realpathSync(path.isAbsolute(n) ? n : path.resolve(realCwd, n)); if (real.startsWith(realCwd + path.sep)) f = real; } catch {}
        if (f) { Object.assign(p, { tooBig: true, size: fs.statSync(f).size, limit: MAX_FILE, name: path.basename(f), source: relOf(f) }); reported.add(f); }
      }
      problems.push(p);
      continue;
    }
    const f = resolveNamed(cwd, n);
    if (f && !fromOf.has(f)) fromOf.set(f, n);
  }
  const files = [...new Set([...fromOf.keys(), ...scan(cwd, sinceMs)])].filter((f) => !reported.has(f)).slice(0, 24);
  const items = [];
  for (const f of files) {
    const name = path.basename(f);
    const r = await storeFile(root, chatId, f, name, { signal, fsImpl, statfs, onProgress: onProgress ? (p) => onProgress({ name, ...p }) : null });
    if (!r.ok) {
      const shown = fromOf.get(f) || relOf(f);
      if (r.code === 'too-big') problems.push({ path: shown, reason: r.message, tooBig: true, size: r.size, limit: r.limit, name, source: relOf(f) });
      else if (r.code === 'no-space') problems.push({ path: shown, reason: r.message.replace(/^There/, 'there').replace(/\.$/, ''), noSpace: true, size: r.need, name, source: relOf(f) });
      else if (r.code === 'cancelled') problems.push({ path: shown, reason: 'copying it into the chat was stopped', name, source: relOf(f) });
      continue;
    }
    const it = r.item;
    // The same picture under two names is shown once; both links point at it.
    const same = items.find((x) => x.file.slice(0, 10) === it.file.slice(0, 10));
    if (same) { if (fromOf.has(f)) { if (!same.from) same.from = fromOf.get(f); else (same.alsoFrom ||= []).push(fromOf.get(f)); } continue; }
    items.push(fromOf.has(f) ? { ...it, from: fromOf.get(f) } : it);
  }
  return { items, problems };
}

// hearth-media://c/<chatId>/<file> -> the file, only inside <root>/<chatId>/.
// hearth-media://t/… is its thumbnail and hearth-media://v/… its screen-sized copy (pictures).
const HOSTS = { c: null, t: 't', v: 'v' };
function resolve(url, root) {
  let u;
  try { u = new URL(String(url)); } catch { return { ok: false, status: 400 }; }
  if (u.protocol !== `${SCHEME}:` || !Object.hasOwn(HOSTS, u.host)) return { ok: false, status: 403 };
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
  return { ok: true, file: real, size: st.size, mime: mimeOf(parts[1]), chatId: parts[0], name: parts[1], rendition: HOSTS[u.host], dir: path.join(realRoot, parts[0]) };
}

// A picture's thumbnail (t) or screen-sized copy (v): made once with render(file, maxSide)
// -> { buf, ext } (Electron's nativeImage in the app) and kept in <chat>/.r/. A picture that
// is small enough is served as it is; one too big to decode is never decoded.
function rendition(r, render) {
  if (kindOf(r.name) !== 'image' || /svg/.test(r.mime)) return { file: r.file, size: r.size, mime: r.mime };
  const info = imageInfo(r.file);
  const fit = big.pictureFit({ width: info.width, height: info.height, size: r.size });
  if (!fit.decode) return null;
  const side = r.rendition === 't' ? big.THUMB_SIDE : big.VIEW_SIDE;
  const smallEnough = r.rendition === 't' ? r.size <= 192 * 1024 && (info.width || 0) <= side * 2 : !fit.view;
  if (smallEnough) return { file: r.file, size: r.size, mime: r.mime };
  const cacheDir = path.join(r.dir, '.r');
  for (const ext of ['jpg', 'png']) {
    const c = path.join(cacheDir, `${r.rendition}${side}-${r.name}.${ext}`);
    try { const st = fs.statSync(c); if (st.isFile() && st.size) return { file: c, size: st.size, mime: ext === 'jpg' ? 'image/jpeg' : 'image/png' }; } catch {}
  }
  let made = null;
  try { made = render ? render(r.file, side) : null; } catch { made = null; }
  if (!made?.buf?.length) return r.rendition === 'v' || r.size <= big.VIEW_OVER_BYTES ? { file: r.file, size: r.size, mime: r.mime } : null;
  const ext = made.ext === 'png' ? 'png' : 'jpg';
  const c = path.join(cacheDir, `${r.rendition}${side}-${r.name}.${ext}`);
  try {
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    const tmp = `${c}.part-${process.pid}`;
    fs.writeFileSync(tmp, made.buf, { mode: 0o600 });
    fs.renameSync(tmp, c);
  } catch { return { buf: made.buf, size: made.buf.length, mime: ext === 'jpg' ? 'image/jpeg' : 'image/png' }; }
  return { file: c, size: made.buf.length, mime: ext === 'jpg' ? 'image/jpeg' : 'image/png' };
}

// The protocol response (Range supported so videos and audio can seek).
function respond(req, root, { render = null } = {}) {
  const r = resolve(req.url, root);
  const base = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox" };
  if (!r.ok) return { status: r.status, headers: { ...base, 'content-type': 'text/plain' }, body: 'Not allowed.' };
  let src = { file: r.file, size: r.size, mime: r.mime };
  if (r.rendition) {
    src = rendition(r, render);
    if (!src) return { status: 415, headers: { ...base, 'content-type': 'text/plain' }, body: 'This picture is too big to open in the app.' };
    if (src.buf) return { status: 200, headers: { ...base, 'content-type': src.mime, 'content-length': String(src.size) }, body: src.buf };
  }
  const range = String(req.headers?.get?.('range') || '').match(/^bytes=(\d*)-(\d*)$/);
  let start = 0;
  let end = src.size - 1;
  if (range && !range[1] && !range[2]) return { status: 416, headers: { ...base, 'content-range': `bytes */${src.size}` }, body: '' };
  if (range) { if (range[1]) start = Number(range[1]); if (range[2]) end = Math.min(Number(range[2]), src.size - 1); if (!range[1] && range[2]) { start = Math.max(0, src.size - Number(range[2])); end = src.size - 1; } }
  if (start > end || start >= src.size) return { status: 416, headers: { ...base, 'content-range': `bytes */${src.size}` }, body: '' };
  const headers = { ...base, 'content-type': src.mime, 'accept-ranges': 'bytes', 'content-length': String(end - start + 1), ...(range ? { 'content-range': `bytes ${start}-${end}/${src.size}` } : {}) };
  return { status: range ? 206 : 200, headers, stream: () => fs.createReadStream(src.file, { start, end }) };
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

module.exports = { SCHEME, MEDIA_DIRS, IMAGE, VIDEO, AUDIO, MAX_FILE, storeFile, describe, rendition, CHAT_RE, kindOf, mimeOf, mediaRoot, inside, namedPaths, cleanNamed, whyNot, scan, store, storeBuffer, collect, collectAll, resolve, respond, dataUri, urlFor, removeChat, safeName };

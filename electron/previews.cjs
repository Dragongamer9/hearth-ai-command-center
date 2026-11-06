// Live previews (artifacts). An AI makes one by writing an HTML, SVG or Markdown file into
// .hearth-preview/ in its working folder, or by a fenced block whose info string says
// "preview" (src/app/previews.mjs). The window shows them in a sandboxed iframe served
// from the hearth-preview: scheme with its own Content-Security-Policy:
// - the iframe has sandbox="allow-scripts" only (no same-origin, no popups, no top
//   navigation), so the page can't reach the app, its preload bridge or Node;
// - preloads never run in sub-frames (nodeIntegrationInSubFrames stays off);
// - network is blocked by CSP unless the owner turned on "Previews may load from the
//   internet" (Settings › Tools), checked here in the main process, not by the window.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const media = require('./media.cjs');
const big = require('./bigfiles.cjs');

const SCHEME = 'hearth-preview';
const DIR = '.hearth-preview';
const KINDS = { html: 'html', htm: 'html', svg: 'svg', md: 'markdown', markdown: 'markdown' };
// Size limits (measured; see release-notes/NEXT.md and test/big-media.test.cjs):
// - MAX_FILE: a preview up to 1 MB is kept inside the chat (editable in the canvas).
// - Bigger previews are copied into the chat's media folder (streamed, up to
//   bigfiles.MAX_STORED) and shown from disk through hearth-preview://, never as a srcdoc
//   string. Pictures, video and audio embedded as data: URLs are pulled out into their own
//   files first, because they are most of a big preview's size.
// - MARKUP_MAX: what's left (the page itself) is shown up to 2 MB. Measured in Chromium: a
//   2 MB page of ordinary markup keeps the window's worst frame near 0.2 s; 5 MB froze the
//   window for 1.3 s and 10 MB for 2.8 s. Over it, the chat shows a card with "Open in browser".
// - MAX_PAGE: an in-memory page the window hands over (a small preview or a diagram).
const MAX_FILE = 1024 * 1024;
const MARKUP_MAX = 2 * 1024 * 1024;
const MAX_PAGE = 6 * 1024 * 1024;
// A big HTML preview is read into memory to pull its pictures out only up to this size.
const EXTRACT_MAX = 512 * 1024 * 1024;

// lib: a diagram page may load the bundled diagram library from hearth-preview://lib/ only.
// self: a page served from disk may load its own pulled-out pictures (hearth-preview://<id>/a/…).
function csp(allowNet = false, lib = false, self = '') {
  const net = allowNet ? ' https:' : '';
  const own = self ? ` ${self}` : '';
  return [
    "default-src 'none'",
    `img-src data: blob:${own}${net}`,
    `media-src data: blob:${own}${net}`,
    `font-src data:${net}`,
    `style-src 'unsafe-inline'${net}`,
    `script-src 'unsafe-inline'${net}${lib ? ` ${SCHEME}://lib` : ''}`,
    `connect-src ${allowNet ? 'https:' : "'none'"}`,
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

// Files an AI wrote into .hearth-preview/ during this turn.
function collect(dir, sinceMs = 0, { max = 6 } = {}) {
  const d = path.join(String(dir || ''), DIR);
  let names = [];
  try { names = fs.readdirSync(d); } catch { return []; }
  const out = [];
  for (const name of names) {
    const kind = KINDS[path.extname(name).slice(1).toLowerCase()];
    if (!kind || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,100}$/.test(name)) continue;
    const f = path.join(d, name);
    let st;
    try { st = fs.lstatSync(f); } catch { continue; }
    if (!st.isFile() || !st.size || st.mtimeMs < sinceMs - 2000) continue;
    // Over 1 MB: not read here; storeBig copies it into the chat's media folder.
    if (st.size > MAX_FILE) out.push({ name, kind, big: true, path: f, size: st.size, at: st.mtime.toISOString(), mtime: st.mtimeMs });
    else out.push({ name, kind, content: fs.readFileSync(f, 'utf8'), at: st.mtime.toISOString(), mtime: st.mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, max).map(({ mtime, ...p }) => p);
}

// ---- big previews ----
// data: pictures, video and audio in attributes and CSS url() are pulled out into files in
// the chat's media folder and the page points at them as a(/<file>) on its own origin.
// Anything inside <script> is left alone (a script may read its own data: URL), and small
// ones (icons) stay inline. put(name, buf) stores a file and returns its media file name.
const DATA_RE = /(\b(?:src|href|poster|xlink:href)\s*=\s*["']?|url\(\s*["']?)data:((?:image\/(?:png|jpeg|gif|webp|avif|svg\+xml))|(?:video\/(?:mp4|webm))|(?:audio\/(?:mpeg|ogg|wav|mp4)));base64,([A-Za-z0-9+/=\r\n]{4096,})/gi;
const EXT_OF = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mp4': 'm4a' };
function extractDataMedia(html, put, { base = 'embedded' } = {}) {
  const parts = String(html || '').split(/(<script\b[\s\S]*?<\/script\s*>)/i);
  let n = 0;
  let bytes = 0;
  const out = parts.map((seg, i) => (i % 2 ? seg : seg.replace(DATA_RE, (m, lead, mime, b64) => {
    const buf = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
    if (!buf.length) return m;
    const file = put(`${base}-${n + 1}.${EXT_OF[mime.toLowerCase()] || 'bin'}`, buf);
    if (!file) return m;
    n++;
    bytes += b64.length;
    return `${lead}a/${encodeURIComponent(file)}`;
  })));
  return { html: out.join(''), extracted: n, bytes };
}

// A big preview (over MAX_FILE) from a file (src) or text (buf): the original is copied into
// the chat's media folder (streamed), its embedded media pulled out, and the page that's
// left kept next to it when it fits MARKUP_MAX. Returns the preview for the chat:
// { name, kind, size, original, file?, markup, extracted, tooBig? }. No content is kept in
// the chat file. tooBig = { reason, limit } shows the clear card instead of a frame.
async function storeBig({ root, chatId, name, kind, src = null, buf = null, signal = null, onProgress = null, statfs }) {
  const dir = path.join(root, chatId);
  let orig;
  if (buf) {
    const item = buf.length <= media.MAX_FILE ? media.storeBuffer(root, chatId, name, buf) : null;
    orig = item ? { ok: true, file: item.file, size: item.size } : { ok: false, code: 'too-big', size: buf.length, message: big.tooBigMessage(buf.length) };
  } else {
    const r = await media.storeFile(root, chatId, src, name, { signal, onProgress, statfs });
    orig = r.ok ? { ok: true, file: r.item.file, size: r.item.size } : r;
  }
  const size = orig.size ?? (buf ? buf.length : 0);
  if (!orig.ok) return { name, kind, size, tooBig: { reason: orig.message, limit: orig.code === 'too-big' ? media.MAX_FILE : null, code: orig.code } };
  const p = { name, kind, size, original: orig.file, markup: size, extracted: 0 };
  if (kind === 'markdown') return { ...p, tooBig: { reason: `Markdown previews are shown in the chat up to ${big.fmtBytes(MAX_FILE)}`, limit: MAX_FILE } };
  if (size > EXTRACT_MAX) return { ...p, tooBig: { reason: `the chat shows pages up to ${big.fmtBytes(MARKUP_MAX)} of HTML (pictures in it don't count); this one is too big to look inside`, limit: MARKUP_MAX } };
  const text = buf ? buf.toString('utf8') : fs.readFileSync(path.join(dir, orig.file), 'utf8');
  const stem = String(name).replace(/\.[^.]*$/, '').slice(0, 60) || 'preview';
  const x = extractDataMedia(text, (n, b) => media.storeBuffer(root, chatId, n, b)?.file || null, { base: stem });
  const page = Buffer.from(x.html, 'utf8');
  if (page.length > MARKUP_MAX) return { ...p, markup: page.length, extracted: x.extracted, tooBig: { reason: `its page is ${big.fmtBytes(page.length)} of ${kind === 'svg' ? 'SVG' : 'HTML'}${x.extracted ? ' even after pulling its pictures out' : ''}; the chat shows up to ${big.fmtBytes(MARKUP_MAX)} so it stays responsive`, limit: MARKUP_MAX } };
  if (!x.extracted) return { ...p, file: orig.file, markup: page.length };
  const viewItem = media.storeBuffer(root, chatId, `${stem}.page.${kind === 'svg' ? 'svg' : 'html'}`, page);
  return { ...p, file: viewItem.file, markup: page.length, extracted: x.extracted };
}

// Fenced "```html preview name" blocks over MAX_FILE in a reply: taken out of the text
// (which becomes a short note) so they can be stored like a big preview file.
const FENCE = /^```[ \t]*(html|svg|markdown|md)[ \t]+preview(?:[ \t]+([^\n`]{1,100}))?[ \t]*\n([\s\S]*?)\n```[ \t]*$/gim;
const FKIND = { html: 'html', svg: 'svg', markdown: 'markdown', md: 'markdown' };
function bigFences(text) {
  const blocks = [];
  const t = String(text || '');
  if (t.length <= MAX_FILE) return { text: t, blocks };
  const out = t.replace(FENCE, (m, lang, name, body) => {
    if (Buffer.byteLength(body) <= MAX_FILE) return m;
    const kind = FKIND[lang.toLowerCase()];
    const ext = kind === 'markdown' ? 'md' : kind;
    let n = String(name || '').trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '').slice(0, 80) || `preview-${blocks.length + 1}`;
    if (!/\.[A-Za-z0-9]{1,8}$/.test(n)) n = `${n}.${ext}`;
    blocks.push({ name: n, kind, buf: Buffer.from(body, 'utf8') });
    return `*(Live preview: ${n})*`;
  });
  return { text: out, blocks };
}

// Pages the window asked to show. Kept in memory only, newest 30. A page from disk (a big
// preview) is bound to its chat: the page and its a/<file> pictures come only from that
// chat's media folder, through media.resolve (no other folder, no "..", no symlinks).
// Bundled libraries a sandboxed diagram page may load (never the app window).
const LIBS = { 'mermaid.min.js': path.join('mermaid', 'mermaid.min.js') };
function createPreviewStore({ libDir = null, mediaRoot = null } = {}) {
  const pages = new Map();
  const keep = (id, p) => { pages.set(id, p); while (pages.size > 30) pages.delete(pages.keys().next().value); return `${SCHEME}://${id}/`; };
  const notFound = (body = 'Not found.') => ({ status: 404, headers: { 'content-type': 'text/plain', 'x-content-type-options': 'nosniff' }, body });
  return {
    add(html, allowNet, { lib = false } = {}) {
      const text = String(html || '');
      if (Buffer.byteLength(text) > MAX_PAGE) throw new Error('That preview is too big to show.');
      return keep(crypto.randomBytes(8).toString('hex'), { html: text, allowNet: allowNet === true && !lib, lib: lib === true });
    },
    // A big preview kept in the chat's media folder. Checked here: the chat, the file name and
    // MARKUP_MAX (the size cap applies when it is read, not only when it was stored).
    addFile(chatId, file, kind, allowNet) {
      if (!mediaRoot) throw new Error('No media folder.');
      const r = media.resolve(media.urlFor(String(chatId), String(file)), mediaRoot);
      if (!r.ok) throw new Error('That preview file is gone.');
      if (r.size > MARKUP_MAX) throw new Error(`That page is ${big.fmtBytes(r.size)}; the chat shows pages up to ${big.fmtBytes(MARKUP_MAX)}.`);
      return keep(crypto.randomBytes(8).toString('hex'), { chatId: r.chatId, file: r.name, kind: kind === 'svg' ? 'svg' : 'html', allowNet: allowNet === true });
    },
    // The protocol handler: the page with its CSP as a real header.
    respond(url, headers = null) {
      let id = '';
      let file = '';
      try { const u = new URL(String(url)); id = u.host; file = u.pathname.replace(/^\//, ''); } catch {}
      if (id === 'lib') {
        const rel = LIBS[file];
        if (!rel || !libDir) return notFound();
        try { return { status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'max-age=3600' }, body: fs.readFileSync(path.join(libDir, rel)) }; } catch { return notFound(); }
      }
      const p = pages.get(id);
      if (!p) return notFound('Preview not found.');
      const sec = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };
      if (p.file) {
        // a/<file>: a picture pulled out of this page, from this chat's media folder only.
        if (file.startsWith('a/')) {
          const name = file.slice(2);
          if (!name || name.includes('/')) return notFound();
          const r = media.respond({ url: `${media.SCHEME}://c/${p.chatId}/${name}`, headers }, mediaRoot);
          if (r.status >= 400) return notFound();
          return { ...r, headers: { ...r.headers, 'content-security-policy': "default-src 'none'; sandbox" } };
        }
        if (file) return notFound();
        const r = media.resolve(media.urlFor(p.chatId, p.file), mediaRoot);
        if (!r.ok || r.size > MARKUP_MAX) return notFound('Preview not found.');
        return { status: 200, headers: { ...sec, 'content-type': p.kind === 'svg' ? 'image/svg+xml' : 'text/html; charset=utf-8', 'content-security-policy': csp(p.allowNet, false, `${SCHEME}://${id}`), 'content-length': String(r.size) }, stream: () => fs.createReadStream(r.file) };
      }
      return {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp(p.allowNet, p.lib), ...sec },
        body: p.html,
      };
    },
    size: () => pages.size,
  };
}

module.exports = { SCHEME, DIR, KINDS, csp, collect, createPreviewStore, extractDataMedia, storeBig, bigFences, MAX_FILE, MARKUP_MAX, MAX_PAGE, EXTRACT_MAX };

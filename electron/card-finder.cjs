// Find characters: the card sites open in the app's sandboxed web window (no preload, its
// own browser profile, no access to the app's files or keys). The owner searches and
// browses on the site itself; when he downloads a card there, the app catches the
// download, keeps it only if it is a card file (png, json, charx) of at most 20 MB, and
// imports it into the character library with the existing importer (electron/cards.cjs),
// picture included. Nothing from the site is ever run, and imports never touch settings.
// The under-18 rule applies as for any import: such a card still imports and is blocked
// from sexual content (cards.cjs cardLimits / checkRequest).
//
// No in-app search box: none of these sites publishes an official, documented search API
// for third-party apps (checked Nov 2026), and scraping them through Cloudflare isn't done.
// Botbooru and CharaVault aren't listed yet: their official addresses couldn't be confirmed
// here, and a guessed domain could be someone else's site.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const SITES = Object.freeze({
  chub: { name: 'Chub', url: 'https://chub.ai/', note: 'the biggest card library' },
  aicc: { name: 'AICharacterCards', url: 'https://aicharactercards.com/', note: 'curated cards' },
  datacat: { name: 'Datacat', url: 'https://datacat.run/', note: 'cards from many sites' },
});
const NOT_LISTED = ['Botbooru', 'CharaVault'];
const CARD_EXT = ['png', 'json', 'charx'];
const MAX_CARD = 20 * 1024 * 1024;

const extOf = (n) => String(n || '').split('.').pop().toLowerCase();
const safeName = (n) => String(path.basename(String(n || 'card'))).replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/^[._ -]+/, '').slice(0, 100) || 'card';

// Is this download a card we take? (before it is saved)
function acceptDownload({ filename, total = 0 }) {
  const e = extOf(filename);
  if (!CARD_EXT.includes(e)) return { ok: false, reason: `${safeName(filename)} isn't a card file (png, json or charx), so it was ignored.` };
  if (total > MAX_CARD) return { ok: false, reason: `${safeName(filename)} is ${Math.round(total / 1048576)} MB; cards over 20 MB are ignored.` };
  return { ok: true };
}

// A .charx card is a zip with card.json (and its pictures). Read only those, never run anything.
function unzipEntries(buf, want = (n) => true, cap = MAX_CARD) {
  const out = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This .charx file isn\'t a valid card archive.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (!want(name) || usize > cap || name.includes('..')) continue;
    if (buf.readUInt32LE(off) !== 0x04034b50) continue;
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.subarray(start, start + csize);
    if (method === 0) out[name] = Buffer.from(data);
    else if (method === 8) out[name] = zlib.inflateRawSync(data, { maxOutputLength: cap });
  }
  return out;
}

// Turn a downloaded file into what the importer reads: a PNG card or JSON (charx -> card.json,
// with its main picture attached by importing the JSON, then the picture separately is not needed).
function cardFileOf(name, buf) {
  if (buf.length > MAX_CARD) throw new Error('Cards over 20 MB are ignored.');
  if (extOf(name) !== 'charx') return { name: safeName(name), buf };
  const files = unzipEntries(buf, (n) => n === 'card.json' || /^assets\/icon\/.+\.(png|jpe?g|webp)$/i.test(n));
  if (!files['card.json']) throw new Error('This .charx file has no card.json inside.');
  const icon = Object.keys(files).find((n) => n !== 'card.json');
  return { name: safeName(name).replace(/\.charx$/i, '.json'), buf: files['card.json'], picture: icon ? files[icon] : null };
}

// Import one downloaded file. importFile(name, buf) is cards.importFile; setPicture(id, buf) optional.
function importDownloaded({ name, buf, importFile, setPicture = null }) {
  const a = acceptDownload({ filename: name, total: buf.length });
  if (!a.ok) return { ok: false, ignored: true, message: a.reason };
  let f;
  try { f = cardFileOf(name, buf); } catch (e) { return { ok: false, message: e.message }; }
  let r;
  try { r = importFile(f.name, f.buf); } catch (e) { return { ok: false, message: `${safeName(name)}: ${e.message}` }; }
  if (r.card && f.picture && setPicture) { try { setPicture(r.card.id, f.picture); } catch {} }
  if (r.lorebook) return { ok: true, lorebook: { id: r.lorebook.id, name: r.lorebook.name } };
  const c = r.card || {};
  return { ok: true, card: { id: c.id, name: c.name, avatarUrl: c.avatarUrl || null, minor: Boolean(c.limits?.minor), minorWhy: c.limits?.minorWhy || null } };
}

function createFinder({ BrowserWindow, shell, iconPath, importFile, setPicture, send, tmpRoot = os.tmpdir() }) {
  const open = new Map();
  const hooked = new Set();
  function hook(sess) {
    if (hooked.has(sess)) return;
    hooked.add(sess);
    sess.on('will-download', (_e, item) => {
      const filename = item.getFilename();
      const a = acceptDownload({ filename, total: item.getTotalBytes() });
      if (!a.ok) { item.cancel(); send('cards:found', { ok: false, ignored: true, message: a.reason }); return; }
      const dir = fs.mkdtempSync(path.join(tmpRoot, 'hearth-card-'));
      const file = path.join(dir, `${crypto.randomBytes(4).toString('hex')}-${safeName(filename)}`);
      item.setSavePath(file);
      item.on('updated', () => { if (item.getReceivedBytes() > MAX_CARD) item.cancel(); });
      item.once('done', (_ev, state) => {
        let res;
        try {
          if (state !== 'completed') res = { ok: false, message: item.getReceivedBytes() > MAX_CARD ? `${safeName(filename)} is over 20 MB, so it was ignored.` : `The download of ${safeName(filename)} didn't finish.` };
          else res = importDownloaded({ name: filename, buf: fs.readFileSync(file), importFile, setPicture });
        } catch (e) { res = { ok: false, message: String(e.message || e) }; }
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
        send('cards:found', res);
      });
    });
    sess.setPermissionRequestHandler((_wc, perm, cb) => cb(['clipboard-sanitized-write', 'fullscreen'].includes(perm)));
  }
  return function openSite(id) {
    const site = SITES[id];
    if (!site) throw new Error('Unknown site.');
    const existing = open.get(id);
    if (existing && !existing.isDestroyed()) { existing.focus(); return { ok: true }; }
    const prefs = { partition: `persist:cards-${id}`, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true };
    const win = new BrowserWindow({ width: 1240, height: 880, title: `${site.name} — find characters`, icon: iconPath, autoHideMenuBar: true, backgroundColor: '#171a21', webPreferences: prefs });
    hook(win.webContents.session);
    win.webContents.setWindowOpenHandler(({ url }) => (/^https:\/\//.test(url) ? { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: prefs } } : { action: 'deny' }));
    win.webContents.on('will-navigate', (e, u) => { if (!/^https:\/\//.test(u)) e.preventDefault(); });
    win.loadURL(site.url);
    win.on('closed', () => open.delete(id));
    open.set(id, win);
    return { ok: true };
  };
}

module.exports = { SITES, NOT_LISTED, CARD_EXT, MAX_CARD, acceptDownload, cardFileOf, importDownloaded, unzipEntries, createFinder };

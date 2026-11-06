// Big files in chat: the size limits in one place, the free-space check, and streamed writes.
// A file is never read into memory whole or sent through IPC as one blob: it is streamed to a
// hidden part file in the chat's media folder, hashed on the way, and renamed when complete.
// Progress is reported (throttled) and an AbortSignal cancels it (the part file is removed).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

const MB = 1024 * 1024;
const GB = 1024 * MB;
// Per file stored in a chat (pictures, videos, audio, files, downloads, picked attachments).
const MAX_STORED = 10 * GB;
// Files up to this size are read in one go (fast); bigger ones are streamed.
const SMALL = 8 * MB;
// Kept free on the disk after a copy, so the app and the system still have room.
const HEADROOM = 256 * MB;
// Pictures: decoding needs width x height x 4 bytes of memory, so very big pictures are not
// decoded in the app at all (the card offers to open the original instead).
const MAX_PIXELS = 100 * 1000 * 1000;
const MAX_SIDE = 30000;
// Pictures over these are shown in the chat as a downscaled copy (made once, kept on disk).
const VIEW_SIDE = 2048;
const THUMB_SIDE = 320;
const VIEW_OVER_BYTES = 12 * MB;
const VIEW_OVER_SIDE = 4096;

const fmtBytes = (n) => {
  const v = Number(n) || 0;
  if (v >= GB) return `${(v / GB).toFixed(v >= 10 * GB ? 0 : 1)} GB`;
  if (v >= MB) return `${(v / MB).toFixed(v >= 10 * MB ? 0 : 1)} MB`;
  if (v >= 1024) return `${Math.round(v / 1024)} KB`;
  return `${v} B`;
};
const safeName = (n) => String(path.basename(String(n || 'file'))).replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/^[._ -]+/, '').slice(0, 100) || 'file';

// Free bytes for this user on the disk holding dir (null when it can't be told).
async function freeSpace(dir, { statfs = fs.promises.statfs } = {}) {
  let d = path.resolve(String(dir || '.'));
  for (let i = 0; i < 40; i++) {
    try { const s = await statfs(d); return Number(s.bavail) * Number(s.bsize); } catch (e) { if (e?.code !== 'ENOENT') return null; }
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
  return null;
}
async function checkSpace(dir, need, o = {}) {
  const free = await freeSpace(dir, o);
  if (free == null || !(need > 0)) return { ok: true, free };
  const want = Number(need) + (o.headroom ?? HEADROOM);
  if (free >= want) return { ok: true, free };
  return { ok: false, code: 'no-space', free, need: Number(need), message: `There isn't enough free disk space: it needs ${fmtBytes(need)} (plus ${fmtBytes(o.headroom ?? HEADROOM)} kept free) and only ${fmtBytes(free)} is free.` };
}
const tooBigMessage = (size, limit = MAX_STORED) => `it is too large (${fmtBytes(size)}; the limit is ${fmtBytes(limit)} per file)`;

// Stream a readable into <dir>/<hash10>-<name>. Returns { ok, file, size, hash } or
// { ok: false, code: 'too-big' | 'no-space' | 'cancelled' | 'failed', message }.
async function streamToFile(readable, dir, name, { max = MAX_STORED, expected = null, signal = null, onProgress = null, fsImpl = fs, statfs, headroom, every = 250 } = {}) {
  if (expected != null && expected > max) { readable.destroy?.(); return { ok: false, code: 'too-big', size: expected, limit: max, message: tooBigMessage(expected, max) }; }
  if (signal?.aborted) { readable.destroy?.(); return { ok: false, code: 'cancelled', message: 'Copying was stopped.' }; }
  await fsImpl.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const space = await checkSpace(dir, expected || 0, { ...(statfs ? { statfs } : {}), ...(headroom != null ? { headroom } : {}) });
  if (!space.ok) { readable.destroy?.(); return space; }
  const part = path.join(dir, `.part-${crypto.randomBytes(6).toString('hex')}`);
  const hash = crypto.createHash('sha256');
  let size = 0;
  let last = 0;
  let over = false;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > max) { over = true; return cb(new Error('too big')); }
      hash.update(chunk);
      const now = Date.now();
      if (onProgress && now - last >= every) { last = now; try { onProgress({ done: size, total: expected }); } catch {} }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(readable, meter, fsImpl.createWriteStream(part, { mode: 0o600, flags: 'wx' }), ...(signal ? [{ signal }] : []));
  } catch (e) {
    try { await fsImpl.promises.unlink(part); } catch {}
    if (over) return { ok: false, code: 'too-big', size, limit: max, message: tooBigMessage(size, max) };
    if (signal?.aborted || e?.name === 'AbortError') return { ok: false, code: 'cancelled', message: 'Copying was stopped.' };
    if (e?.code === 'ENOSPC') return { ok: false, code: 'no-space', message: 'The disk filled up while copying, so the copy was removed.' };
    return { ok: false, code: 'failed', message: `Couldn't copy it: ${e?.message || e}` };
  }
  if (!size) { try { await fsImpl.promises.unlink(part); } catch {} return { ok: false, code: 'failed', message: 'the file is empty' }; }
  const hex = hash.digest('hex');
  const file = `${hex.slice(0, 10)}-${safeName(name)}`;
  const dest = path.join(dir, file);
  let exists = false;
  try { await fsImpl.promises.stat(dest); exists = true; } catch {}
  if (exists) { try { await fsImpl.promises.unlink(part); } catch {} } else await fsImpl.promises.rename(part, dest);
  try { onProgress?.({ done: size, total: expected ?? size, finished: true }); } catch {}
  return { ok: true, file, size, hash: hex, path: dest };
}

// A file on disk, streamed (never read whole).
async function copyFile(src, dir, name, o = {}) {
  const fsImpl = o.fsImpl || fs;
  let st;
  try { st = await fsImpl.promises.stat(src); } catch { return { ok: false, code: 'failed', message: 'the file isn\'t there (missing)' }; }
  if (!st.isFile()) return { ok: false, code: 'failed', message: 'it is not a file' };
  if (st.size > (o.max ?? MAX_STORED)) return { ok: false, code: 'too-big', size: st.size, limit: o.max ?? MAX_STORED, message: tooBigMessage(st.size, o.max ?? MAX_STORED) };
  return streamToFile(fsImpl.createReadStream(src), dir, name ?? path.basename(src), { ...o, expected: st.size });
}

// Can this picture be decoded in the app, and should the chat show a smaller copy?
function pictureFit({ width, height, size } = {}) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w && h && (w * h > MAX_PIXELS || w > MAX_SIDE || h > MAX_SIDE)) return { decode: false, view: false, reason: `${w}×${h} pixels is too many to open in the app (up to ${MAX_PIXELS / 1e6} megapixels)` };
  return { decode: true, view: Boolean((size || 0) > VIEW_OVER_BYTES || w > VIEW_OVER_SIDE || h > VIEW_OVER_SIDE) };
}

module.exports = { MB, GB, MAX_STORED, SMALL, HEADROOM, MAX_PIXELS, MAX_SIDE, VIEW_SIDE, THUMB_SIDE, VIEW_OVER_BYTES, VIEW_OVER_SIDE, fmtBytes, safeName, freeSpace, checkSpace, streamToFile, copyFile, pictureFit, tooBigMessage };

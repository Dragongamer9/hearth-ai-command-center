// Images and videos in team chat. Files are copied into the app's own
// .hearth-ai/attachments/ folder (next to the task workspaces, outside your repo,
// so they never make the project "dirty") and are only ever given to the AI tools
// you already use. Nothing is uploaded anywhere else.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const TYPES = { png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', mp4: 'video', webm: 'video', mov: 'video' };
const MAX_BYTES = 200 * 1024 * 1024;
const TOO_BIG = (size, max = MAX_BYTES) => `That file is ${(size / 1048576).toFixed(0)} MB; attachments can be up to ${Math.round(max / 1048576)} MB.`;

const extOf = (name) => path.extname(String(name || '')).slice(1).toLowerCase();
const kindOf = (name) => TYPES[extOf(name)] || null;
const attachDir = (root) => path.join(root, '.hearth-ai', 'attachments');
function safeName(name) {
  const base = path.basename(String(name || 'file')).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._-]+/, '').slice(-80);
  return base || 'file';
}
function inside(file, roots) {
  let real;
  try { real = fs.realpathSync(file); } catch { return false; }
  return roots.filter(Boolean).some((r) => {
    let rr;
    try { rr = fs.realpathSync(r); } catch { return false; }
    return real === rr || real.startsWith(rr + path.sep);
  });
}

function record(root, dest, name, kind, size) {
  return { id: path.basename(dest).split('-')[0], name: path.basename(String(name)), kind, size, path: dest };
}

function newDest(root, name) {
  const dir = attachDir(root);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, `${crypto.randomBytes(5).toString('hex')}-${safeName(name)}`);
}

// From the owner's paste / drag-and-drop (bytes).
function saveBuffer(root, name, data, { max = MAX_BYTES } = {}) {
  const kind = kindOf(name);
  if (!kind) return { ok: false, message: 'Only images (png, jpg, webp, gif) and videos (mp4, webm, mov) can be attached.' };
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data || []);
  if (buf.length > max) return { ok: false, message: TOO_BIG(buf.length, max) };
  if (!buf.length) return { ok: false, message: 'That file is empty.' };
  const dest = newDest(root, name);
  fs.writeFileSync(dest, buf, { mode: 0o600 });
  return { ok: true, att: record(root, dest, name, kind, buf.length) };
}

// From a file on disk. `roots` limits where it may come from (an AI's ATTACH line:
// only the project, the task workspaces or the attachments folder); null = any file
// the owner picked himself.
function saveFromPath(root, src, { roots = null, max = MAX_BYTES } = {}) {
  // Everything is decided on the real file a symlink points to, and that is what is copied.
  let real;
  try { real = fs.realpathSync(src); } catch { return { ok: false, message: `File not found: ${path.basename(String(src))}` }; }
  const kind = kindOf(real);
  if (!kind || !kindOf(src)) return { ok: false, message: 'Only images (png, jpg, webp, gif) and videos (mp4, webm, mov) can be attached.' };
  const st = fs.statSync(real);
  if (!st.isFile()) return { ok: false, message: 'Not a file.' };
  if (roots && !inside(real, roots)) return { ok: false, message: 'Only files inside the project workspace or the attachments folder can be posted.' };
  if (st.size > max) return { ok: false, message: TOO_BIG(st.size, max) };
  const dest = newDest(root, src);
  fs.copyFileSync(real, dest);
  return { ok: true, att: record(root, dest, src, kind, st.size) };
}

function exec(file, args, timeoutMs = 60000) {
  return new Promise((resolve) => execFile(file, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout), err: String(stderr), error })));
}

// 3–6 still frames from a video with ffmpeg, so AIs that read images can see it.
async function extractFrames(file, { ffmpeg, count = 4, outDir } = {}) {
  if (!ffmpeg) return { ok: false, frames: [], duration: null, note: 'video attached (frames unavailable: install ffmpeg)' };
  const n = Math.min(6, Math.max(3, count));
  // Read only this one local file, with a fixed container format: a crafted video or
  // playlist can't make ffmpeg open other files or URLs.
  const fmt = /\.webm$/i.test(file) ? 'matroska' : 'mov';
  const input = ['-protocol_whitelist', 'file', '-f', fmt, '-i', `file:${path.resolve(file)}`];
  const probe = await exec(ffmpeg, ['-hide_banner', ...input]);
  const m = `${probe.err}\n${probe.out}`.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  const res = probeResolution(`${probe.err}\n${probe.out}`);
  const dir = outDir || path.dirname(file);
  const stem = path.basename(file, path.extname(file));
  const frames = [];
  for (let i = 0; i < n; i++) {
    const at = duration ? ((i + 0.5) * duration) / n : i;
    const out = path.join(dir, `${stem}-frame${i + 1}.jpg`);
    const r = await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at.toFixed(2), ...input, '-frames:v', '1', '-vf', 'scale=960:-2', out]);
    if (r.ok && fs.existsSync(out)) frames.push(out);
  }
  if (!frames.length) return { ok: false, frames, duration, ...res, note: 'video attached (frames unavailable: ffmpeg could not read it)' };
  return { ok: true, frames, duration, ...res, note: '' };
}

// "Stream #0:0: Video: h264 (High), yuv420p(progressive), 1280x720 [SAR 1:1 DAR 16:9], 30 fps"
function probeResolution(text) {
  const m = String(text || '').match(/Stream[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : {};
}

// An AI's ATTACH path: plain relative paths inside its workspace only.
function agentPath(base, rel) {
  const r = String(rel || '');
  if (!r || path.isAbsolute(r) || r.split(/[\\/]+/).includes('..')) return { ok: false, message: 'Use a path relative to your workspace (no absolute paths or "..").' };
  return { ok: true, file: path.resolve(base, r) };
}

// Text files (logs, notes, code) attached in chat: kept in the attachments folder and given
// to the AIs as a file path (and, when small, as text in the message).
const TEXT_EXT = ['txt', 'log', 'md', 'json', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'csv', 'xml', 'html', 'css', 'js', 'mjs', 'cjs', 'ts', 'py', 'sh', 'qml', 'rs', 'c', 'h', 'cpp', 'cs', 'go', 'java', 'kt', 'diff', 'patch', 'desktop', 'service'];
const TEXT_MAX = 20 * 1024 * 1024;
function saveText(root, name, data, { max = TEXT_MAX } = {}) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data || []);
  const ext = extOf(name);
  if (!TEXT_EXT.includes(ext) && !(ext === '' && buf.length && !buf.subarray(0, 8000).includes(0))) return { ok: false, message: 'That kind of file can\'t be attached. Images, videos and text files (logs, notes, code) can.' };
  if (buf.subarray(0, 8000).includes(0)) return { ok: false, message: 'That doesn\'t look like a text file.' };
  if (buf.length > max) return { ok: false, message: TOO_BIG(buf.length, max) };
  if (!buf.length) return { ok: false, message: 'That file is empty.' };
  const dest = newDest(root, name);
  fs.writeFileSync(dest, buf, { mode: 0o600 });
  const text = buf.length <= 100 * 1024 ? buf.toString('utf8') : null;
  return { ok: true, att: { ...record(root, dest, name, 'file', buf.length), text } };
}

const ffmpegInput = (file) => ['-protocol_whitelist', 'file', '-f', /\.webm$/i.test(file) ? 'matroska' : 'mov', '-i', `file:${path.resolve(file)}`];

module.exports = { saveText, TEXT_EXT, probeResolution, agentPath, ffmpegInput, TYPES, MAX_BYTES, kindOf, safeName, attachDir, inside, saveBuffer, saveFromPath, extractFrames };

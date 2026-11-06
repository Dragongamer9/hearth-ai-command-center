// The one ComfyUI client: used by Hearth devices (a device that shares ComfyUI) and by the
// ComfyUI server in Settings › Accounts (Characters chat scene pictures).
// ComfyUI's API (checked against its server.py routes, November 2026):
//   POST /prompt { prompt: <graph>, client_id } -> { prompt_id }
//   GET  /history/<prompt_id> -> { <id>: { outputs: { <node>: { images: [{ filename, subfolder, type }] } }, status } }
//   GET  /view?filename=&subfolder=&type= -> the picture
//   GET  /models/checkpoints -> [names]  (newer ComfyUI)
//   GET  /object_info/CheckpointLoaderSimple -> { CheckpointLoaderSimple: { input: { required: { ckpt_name: [[names], ...] } } } }
// Every request goes through hearth-net.cjs (allow-list, no redirects, timeouts, size caps).
const crypto = require('node:crypto');
const hnet = require('./hearth-net.cjs');
const { DEFAULT_WORKFLOW, fillWorkflow } = require('./teammates.cjs');

const MAX_JSON = 4 * 1024 * 1024;
const MAX_IMAGE = 30 * 1024 * 1024;
const CKPT_RE = /^[^\0\r\n]{1,200}$/;
const ID_RE = /^[A-Za-z0-9-]{1,80}$/;
const SIZES = [512, 640, 768, 832, 896, 1024, 1152, 1216, 1344];

// The checkpoints a ComfyUI server has. { ok, checkpoints } or a plain failure:
// 'unreachable' / 'timeout' (offline), 'redirect', 'not_comfy' (wrong address), 'no_models'.
async function listCheckpoints({ base, allow, headers = {}, fetchImpl, name = 'ComfyUI' }) {
  const o = { allow, fetchImpl, name, timeoutMs: 10000, max: MAX_JSON, init: { headers: { accept: 'application/json', ...headers } } };
  let list = null;
  let first = await hnet.fetchJson(`${base}/models/checkpoints`, o);
  if (first.ok && Array.isArray(first.json)) list = first.json;
  else if (!first.ok && ['unreachable', 'timeout', 'redirect', 'blocked', 'auth', 'cancelled'].includes(first.kind)) return first;
  if (!list) {
    const r = await hnet.fetchJson(`${base}/object_info/CheckpointLoaderSimple`, o);
    if (!r.ok) return ['unreachable', 'timeout', 'redirect', 'blocked', 'auth'].includes(r.kind) ? r : hnet.fail(`${name} doesn't look like ComfyUI at ${base} (${r.message}). Check the address and port (ComfyUI uses 8188).`, 'not_comfy');
    const c = r.json?.CheckpointLoaderSimple?.input?.required?.ckpt_name;
    if (!Array.isArray(c)) return hnet.fail(`${name} doesn't look like ComfyUI at ${base}. Check the address and port (ComfyUI uses 8188).`, 'not_comfy');
    list = Array.isArray(c[0]) ? c[0] : [];
  }
  const out = [...new Set(list.filter((x) => typeof x === 'string' && CKPT_RE.test(x)))].slice(0, 500);
  if (!out.length) return hnet.fail(`${name} has no checkpoint (model) yet. Put one in ComfyUI's models/checkpoints folder.`, 'no_models');
  return { ok: true, checkpoints: out };
}

// One text-to-image picture. { ok, images: [{ buf, mime }], seed, checkpoint } or a plain failure.
async function generate({ base, allow, headers = {}, checkpoint, checkpoints = null, prompt, negative = 'blurry, low quality', seed, width = 1024, height = 1024, steps = 25, fetchImpl, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxPolls = 150, pollMs = 2000, signal, name = 'ComfyUI' }) {
  const p = String(prompt || '').trim().slice(0, 3000);
  if (!p) return hnet.fail('Say what the picture should show.');
  let list = checkpoints;
  if (!list) { const l = await listCheckpoints({ base, allow, headers, fetchImpl, name }); if (!l.ok) return l; list = l.checkpoints; }
  if (!list.length) return hnet.fail(`${name} has no checkpoint (model) yet.`, 'no_models');
  const ckpt = checkpoint && list.includes(checkpoint) ? checkpoint : list[0];
  const sd = Number.isInteger(Number(seed)) && Number(seed) >= 0 && Number(seed) < 2 ** 48 ? Number(seed) : crypto.randomInt(1, 2 ** 31);
  const wf = JSON.parse(JSON.stringify(DEFAULT_WORKFLOW));
  wf['5'].inputs.width = SIZES.includes(width) ? width : 1024;
  wf['5'].inputs.height = SIZES.includes(height) ? height : 1024;
  wf['3'].inputs.steps = Math.min(60, Math.max(4, Math.round(Number(steps) || 25)));
  const graph = fillWorkflow(wf, { prompt: p, negative: String(negative || '').slice(0, 2000), seed: sd, ckpt });
  const jh = { 'content-type': 'application/json', accept: 'application/json', ...headers };
  const base0 = { allow, fetchImpl, name, signal, max: MAX_JSON };
  const r = await hnet.fetchJson(`${base}/prompt`, { ...base0, timeoutMs: 30000, init: { method: 'POST', headers: jh, body: JSON.stringify({ prompt: graph, client_id: `hearth-${crypto.randomBytes(4).toString('hex')}` }) } });
  if (!r.ok) return r.kind === 'failed' || r.kind === 'not_found' ? hnet.fail(`${name} refused the picture: ${r.message}`, 'failed') : r;
  const id = String(r.json?.prompt_id || '');
  if (!ID_RE.test(id)) return hnet.fail(`${name} gave an unexpected answer.`);
  for (let i = 0; i < maxPolls; i++) {
    if (signal?.aborted) return hnet.fail('Stopped.', 'cancelled');
    await sleep(pollMs);
    const h = await hnet.fetchJson(`${base}/history/${id}`, { ...base0, timeoutMs: 15000, init: { headers: jh } });
    if (!h.ok) { if (['redirect', 'blocked', 'cancelled'].includes(h.kind)) return h; continue; }
    const entry = h.json?.[id];
    if (!entry || typeof entry !== 'object') continue;
    if (entry.status?.status_str === 'error') return hnet.fail(`${name}: the picture failed on the server.`);
    const imgs = Object.values(entry.outputs || {}).flatMap((o) => (Array.isArray(o?.images) ? o.images : [])).filter((im) => im && typeof im.filename === 'string');
    if (!imgs.length) { if (entry.status?.completed) return hnet.fail(`${name}: finished without a picture.`); continue; }
    const out = [];
    for (const im of imgs.slice(0, 4)) {
      const q = new URLSearchParams({ filename: String(im.filename).slice(0, 300), subfolder: String(im.subfolder || '').slice(0, 300), type: ['output', 'temp'].includes(im.type) ? im.type : 'output' });
      const v = await hnet.safeFetch(`${base}/view?${q}`, { allow, fetchImpl, name, signal, timeoutMs: 60000, init: { headers } });
      if (!v.ok) { if (v.kind === 'redirect') return v; continue; }
      if (!v.res.ok) continue;
      const type = String(v.res.headers?.get?.('content-type') || 'image/png').split(';')[0].toLowerCase();
      if (!/^image\/(png|jpeg|webp)$/.test(type)) continue;
      const buf = await hnet.readCapped(v.res, MAX_IMAGE).catch(() => null);
      if (buf?.length) out.push({ buf, mime: type });
    }
    return out.length ? { ok: true, images: out, seed: sd, checkpoint: ckpt } : hnet.fail(`${name}: couldn't download the picture.`);
  }
  return hnet.fail(`${name}: no picture after ${Math.round((maxPolls * pollMs) / 60000)} minutes.`, 'timeout');
}

// ---------- the ComfyUI server in Settings › Accounts (read-time defaults; saved only by him) ----------
// { url: '' (none), checkpoint: '' (the server's first) }. Only addresses on this PC, the home
// network or Tailscale are accepted: scene prompts never go to an internet host.
function cleanSettings(v) {
  const s = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const url = typeof s.url === 'string' ? hnet.cleanBase(s.url) : null;
  return { url: url && hnet.isPrivateHost(hnet.hostOf(url)) ? url : '', checkpoint: typeof s.checkpoint === 'string' && CKPT_RE.test(s.checkpoint) ? s.checkpoint : '' };
}
function mergeSettings(cur, patch) {
  const next = { ...cleanSettings(cur) };
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  if ('url' in p) {
    const raw = String(p.url || '').trim();
    if (!raw) next.url = '';
    else {
      const u = hnet.cleanBase(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
      if (!u) throw new Error('Type the ComfyUI address, like http://100.72.99.97:8188');
      if (!hnet.isPrivateHost(hnet.hostOf(u))) throw new Error('The ComfyUI server must be on this PC, your home network or Tailscale (like http://100.72.99.97:8188), so scene prompts never go to an internet host.');
      if (u !== next.url) next.checkpoint = '';
      next.url = u;
    }
  }
  if ('checkpoint' in p) next.checkpoint = typeof p.checkpoint === 'string' && CKPT_RE.test(p.checkpoint) ? p.checkpoint : '';
  return cleanSettings(next);
}
// Only the configured server's own host may be reached.
const allowOnly = (base) => { const h = hnet.hostOf(base); return (host) => Boolean(h) && host === h && hnet.isPrivateHost(host); };

module.exports = { cleanSettings, mergeSettings, allowOnly, listCheckpoints, generate, MAX_IMAGE, MAX_JSON, CKPT_RE };

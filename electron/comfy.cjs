// The one ComfyUI client: used by Hearth devices (a device that shares ComfyUI) and by the
// ComfyUI server in Settings › Accounts (Characters chat scene pictures).
// ComfyUI's API (checked against its server.py routes, November 2026, and the owner's tests on
// ComfyUI 0.44 with an RTX 5070):
//   GET  /system_stats -> { system: { comfyui_version, ... }, devices: [{ name, type, vram_total, vram_free }] }
//   GET  /object_info/CheckpointLoaderSimple -> ckpt_name: [[names], {...}] or ["COMBO", { options: [names] }]
//   GET  /models/checkpoints -> [names]  (fallback)
//   POST /prompt { prompt: <graph>, client_id: <uuid> } -> { prompt_id }  (400: { error, node_errors })
//   GET  /history/<prompt_id> -> { <id>: { outputs: { <node>: { images: [{ filename, subfolder, type }] } }, status: { status_str, completed, messages } } }
//   GET  /queue -> { queue_running: [[n, id, ...]], queue_pending: [...] }
//   POST /interrupt { prompt_id }   POST /queue { delete: [id] }   (cancel)
//   GET  /view?filename=&subfolder=&type=output -> the picture
// Every request goes through hearth-net.cjs (allow-list, no redirects, timeouts, size caps).
const crypto = require('node:crypto');
const hnet = require('./hearth-net.cjs');

const MAX_JSON = 4 * 1024 * 1024;
const MAX_IMAGE = 30 * 1024 * 1024;
const CKPT_RE = /^[^\0\r\n]{1,200}$/;
const ID_RE = /^[A-Za-z0-9-]{1,80}$/;
const SIZES = [512, 640, 768, 832, 896, 1024, 1152, 1216, 1344];
const NETWORK = ['unreachable', 'timeout', 'redirect', 'blocked', 'auth', 'cancelled'];

// The owner's tested defaults (his RTX 5070, ComfyUI 0.44, November 2026): 1024×1024 in about 8 s,
// 1344×768 in about 13 s, both good; 1536×1536 fell apart, so it isn't offered. These are only
// suggestions and read-time defaults: nothing here is ever written into his settings.
const DEFAULTS = Object.freeze({ url: 'http://chris-hearth.tail0e2082.ts.net:8188', checkpoint: 'NoobAI-XL-v1.1.safetensors', width: 1024, height: 1024, steps: 26, cfg: 5.5, sampler: 'euler_ancestral', scheduler: 'normal' });
const SIZE_CHOICES = Object.freeze([
  { id: '1024x1024', width: 1024, height: 1024, label: '1024 × 1024 (square, about 8 s)' },
  { id: '1344x768', width: 1344, height: 768, label: '1344 × 768 (wide, about 13 s)' },
  { id: '768x1344', width: 768, height: 1344, label: '768 × 1344 (tall, about 13 s)' },
]);
const SAMPLERS = ['euler_ancestral', 'euler', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_sde', 'ddim', 'uni_pc'];
const SCHEDULERS = ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple'];
const clampSteps = (n) => Math.min(60, Math.max(4, Math.round(Number(n))));
const clampCfg = (n) => Math.min(15, Math.max(1, Math.round(Number(n) * 10) / 10));
const okNum = (n) => n !== null && n !== '' && Number.isFinite(Number(n));

// The txt2img graph, exactly the shape in his spec (nodes 3-9, SaveImage prefix "hearth-scene"),
// with the seed, steps, cfg, size, checkpoint and both prompts filled in.
function buildWorkflow({ checkpoint, positive, negative = '', seed, width = DEFAULTS.width, height = DEFAULTS.height, steps = DEFAULTS.steps, cfg = DEFAULTS.cfg, sampler = DEFAULTS.sampler, scheduler = DEFAULTS.scheduler } = {}) {
  return {
    3: { class_type: 'KSampler', inputs: { seed: Number(seed), steps: clampSteps(steps), cfg: clampCfg(cfg), sampler_name: SAMPLERS.includes(sampler) ? sampler : DEFAULTS.sampler, scheduler: SCHEDULERS.includes(scheduler) ? scheduler : DEFAULTS.scheduler, denoise: 1.0, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: String(checkpoint) } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: SIZES.includes(Number(width)) ? Number(width) : DEFAULTS.width, height: SIZES.includes(Number(height)) ? Number(height) : DEFAULTS.height, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: String(positive || ''), clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: String(negative || ''), clip: ['4', 1] } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'hearth-scene', images: ['8', 0] } },
  };
}

// The checkpoint names in an /object_info/CheckpointLoaderSimple answer. ComfyUI has used two
// shapes: ckpt_name: [[names], {...}] (older) and ckpt_name: ["COMBO", { options: [names] }] (newer).
function checkpointNames(j) {
  const c = j?.CheckpointLoaderSimple?.input?.required?.ckpt_name;
  if (!Array.isArray(c)) return null;
  if (Array.isArray(c[0])) return c[0];
  if (Array.isArray(c[1]?.options)) return c[1].options;
  return null;
}

// The checkpoints a ComfyUI server has. { ok, checkpoints } or a plain failure:
// 'unreachable' / 'timeout' (offline), 'redirect', 'not_comfy' (wrong address), 'no_models'.
// GET /object_info/CheckpointLoaderSimple first (both shapes), then /models/checkpoints.
async function listCheckpoints({ base, allow, headers = {}, fetchImpl, name = 'ComfyUI', signal }) {
  const o = { allow, fetchImpl, name, signal, timeoutMs: 10000, max: MAX_JSON, init: { headers: { accept: 'application/json', ...headers } } };
  let list = null;
  const r = await hnet.fetchJson(`${base}/object_info/CheckpointLoaderSimple`, o);
  if (!r.ok && NETWORK.includes(r.kind)) return r;
  if (r.ok) list = checkpointNames(r.json);
  if (!list) {
    const m = await hnet.fetchJson(`${base}/models/checkpoints`, o);
    if (!m.ok && NETWORK.includes(m.kind)) return m;
    if (m.ok && Array.isArray(m.json)) list = m.json;
  }
  if (!list) return hnet.fail(`${name} doesn't look like ComfyUI at ${base}${r.ok ? '' : ` (${r.message})`}. Check the address and port (ComfyUI uses 8188).`, 'not_comfy');
  const out = [...new Set(list.filter((x) => typeof x === 'string' && CKPT_RE.test(x)))].slice(0, 500);
  if (!out.length) return hnet.fail(`${name} has no checkpoint (model) yet. Put one in ComfyUI's models/checkpoints folder.`, 'no_models');
  return { ok: true, checkpoints: out };
}

const GB = 1024 ** 3;
const gb = (n) => `${(n / GB).toFixed(1)} GB`;
// Free graphics memory under this is "low" (the 30B Ollama model takes most of his 12 GB card).
const LOW_VRAM = 4 * GB;
// GET /system_stats: online, the GPU and its free/total graphics memory.
// { ok, version, gpu, vramFree, vramTotal, low, note } or a plain failure (offline etc.).
async function systemStats({ base, allow, headers = {}, fetchImpl, name = 'ComfyUI', signal }) {
  const r = await hnet.fetchJson(`${base}/system_stats`, { allow, fetchImpl, name, signal, timeoutMs: 8000, max: 256 * 1024, init: { headers: { accept: 'application/json', ...headers } } });
  if (!r.ok) return NETWORK.includes(r.kind) ? r : hnet.fail(`${name} doesn't look like ComfyUI at ${base} (${r.message}). Check the address and port (ComfyUI uses 8188).`, 'not_comfy');
  const devs = Array.isArray(r.json?.devices) ? r.json.devices : null;
  if (!devs || typeof r.json?.system !== 'object') return hnet.fail(`${name} doesn't look like ComfyUI at ${base}. Check the address and port (ComfyUI uses 8188).`, 'not_comfy');
  const d = devs.find((x) => x && typeof x === 'object' && x.type !== 'cpu') || devs[0] || {};
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
  const vramFree = num(d.vram_free);
  const vramTotal = num(d.vram_total);
  const low = vramFree !== null && vramTotal ? vramFree < LOW_VRAM : false;
  const version = typeof r.json.system.comfyui_version === 'string' ? r.json.system.comfyui_version.slice(0, 40) : null;
  const gpu = typeof d.name === 'string' ? d.name.replace(/^cuda:\d+\s*/, '').replace(/\s*:\s*cudaMallocAsync$/i, '').slice(0, 120) : null;
  return {
    ok: true, version, gpu, vramFree, vramTotal, low,
    note: low ? `Only ${gb(vramFree)} of ${gb(vramTotal)} graphics memory is free on ${name} (another model, like the big Ollama one, may be loaded), so this picture may be slower. Nothing is unloaded unless you do it.` : null,
  };
}

// Test Connection: online + GPU + free memory (/system_stats), and the model list.
async function testConnection(o) {
  const st = await systemStats(o);
  if (!st.ok) return st;
  const l = await listCheckpoints(o);
  return { ...st, ok: l.ok, checkpoints: l.ok ? l.checkpoints : [], ...(l.ok ? {} : { kind: l.kind, message: l.message }) };
}

// The checkpoint to use: his pick (it must be on the server: else 'model_missing'), else the
// suggested default when the server has it, else the server's first.
function pickCheckpoint(list, wanted, { strict = false, name = 'ComfyUI' } = {}) {
  if (!list.length) return hnet.fail(`${name} has no checkpoint (model) yet. Put one in ComfyUI's models/checkpoints folder.`, 'no_models');
  if (wanted && list.includes(wanted)) return { ok: true, checkpoint: wanted };
  if (wanted && strict) return hnet.fail(`The model ${wanted} isn't on ${name} any more. It has: ${list.slice(0, 6).join(', ')}${list.length > 6 ? '…' : ''}. Pick one in Settings › Accounts › ComfyUI server.`, 'model_missing', { checkpoints: list });
  return { ok: true, checkpoint: list.includes(DEFAULTS.checkpoint) ? DEFAULTS.checkpoint : list[0] };
}

// ComfyUI's own words for a refused /prompt: { error: { message, details }, node_errors: {...} }.
function promptErrorText(status, buf) {
  let j = null;
  try { j = JSON.parse(buf.toString('utf8')); } catch {}
  if (!j) return `${status}${buf?.length ? ` ${buf.toString('utf8').replace(/\s+/g, ' ').trim().slice(0, 200)}` : ''}`;
  const parts = [];
  const e = j.error;
  if (typeof e === 'string') parts.push(e);
  else if (e && typeof e === 'object') parts.push([e.message, e.details].filter((x) => typeof x === 'string' && x).join(': '));
  for (const [node, ne] of Object.entries(j.node_errors && typeof j.node_errors === 'object' ? j.node_errors : {}).slice(0, 3)) {
    for (const x of (Array.isArray(ne?.errors) ? ne.errors : []).slice(0, 2)) parts.push(`node ${node}${ne.class_type ? ` (${ne.class_type})` : ''}: ${[x?.message, x?.details].filter((y) => typeof y === 'string' && y).join(': ')}`);
  }
  return `${status} ${parts.filter(Boolean).join('; ')}`.trim().slice(0, 350);
}
// ComfyUI's words for a failed run: status.messages is [[type, data], ...].
function runErrorText(status) {
  const msgs = Array.isArray(status?.messages) ? status.messages : [];
  const ex = msgs.find((m) => Array.isArray(m) && m[0] === 'execution_error')?.[1];
  if (ex && typeof ex === 'object') return [ex.node_type ? `${ex.node_type}${ex.node_id ? ` (node ${ex.node_id})` : ''}` : '', ex.exception_type, ex.exception_message].filter((x) => typeof x === 'string' && x).map((x) => x.trim()).join(': ').slice(0, 300);
  const other = msgs.filter((m) => Array.isArray(m) && typeof m[0] === 'string' && !/^execution_(start|cached|success)$/.test(m[0])).map((m) => m[0]);
  return other.join(', ').slice(0, 200);
}

// Where the job is in ComfyUI's queue: 'running', 'pending' or null (GET /queue).
async function queueState({ base, allow, headers = {}, fetchImpl, name, id }) {
  const q = await hnet.fetchJson(`${base}/queue`, { allow, fetchImpl, name, timeoutMs: 5000, max: MAX_JSON, init: { headers: { accept: 'application/json', ...headers } } });
  if (!q.ok) return null;
  const has = (list) => (Array.isArray(list) ? list : []).some((e) => Array.isArray(e) && e[1] === id);
  return has(q.json?.queue_running) ? 'running' : has(q.json?.queue_pending) ? 'pending' : null;
}
// Cancel: POST /interrupt for the running job (only when it is this one), or
// POST /queue {"delete":[id]} while it is still waiting. Never touches another job.
async function cancelJob({ base, allow, headers = {}, fetchImpl, name, id }) {
  const state = await queueState({ base, allow, headers, fetchImpl, name, id });
  const jh = { 'content-type': 'application/json', accept: 'application/json', ...headers };
  const post = (p, body) => hnet.safeFetch(`${base}${p}`, { allow, fetchImpl, name, timeoutMs: 5000, init: { method: 'POST', headers: jh, body: JSON.stringify(body) } });
  if (state === 'running') { await post('/interrupt', { prompt_id: id }); return 'interrupted'; }
  if (state === 'pending') { await post('/queue', { delete: [id] }); return 'removed'; }
  return 'gone';
}

const abortableSleep = (sleep, ms, signal) => (signal ? Promise.race([sleep(ms), new Promise((r) => { if (signal.aborted) r(); else signal.addEventListener('abort', r, { once: true }); })]) : sleep(ms));

// One text-to-image picture. { ok, images: [{ buf, mime }], seed, checkpoint, width, height,
// steps, cfg, sampler, scheduler, positive, negative, promptId, vram } or a plain failure:
// kind 'unreachable'/'timeout' (offline), 'no_models', 'model_missing', 'failed' (POST /prompt
// refused, with ComfyUI's words), 'gen_failed' (the run failed, with status.messages),
// 'gen_timeout', 'no_images', 'cancelled'.
// onProgress({ phase: 'checking' | 'queued' | 'generating' | 'downloading', elapsed, note }).
async function generate({ base, allow, headers = {}, checkpoint, checkpoints = null, strictCheckpoint = false, prompt, negative = 'blurry, low quality', seed, width = DEFAULTS.width, height = DEFAULTS.height, steps = DEFAULTS.steps, cfg = DEFAULTS.cfg, sampler = DEFAULTS.sampler, scheduler = DEFAULTS.scheduler, checkVram = false, fetchImpl, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), maxPolls = 300, pollMs = 1000, signal, onProgress = () => {}, name = 'ComfyUI' }) {
  const p = String(prompt || '').trim().slice(0, 3000);
  if (!p) return hnet.fail('Say what the picture should show.');
  const t0 = now();
  const tell = (phase, extra = {}) => { try { onProgress({ phase, elapsed: Math.round((now() - t0) / 1000), ...extra }); } catch {} };
  let vram = null;
  if (checkVram) {
    tell('checking');
    const st = await systemStats({ base, allow, headers, fetchImpl, name, signal });
    if (!st.ok) return st;
    vram = { gpu: st.gpu, free: st.vramFree, total: st.vramTotal, low: st.low, note: st.note };
    if (st.note) tell('checking', { note: st.note });
  }
  let list = checkpoints;
  if (!list) { const l = await listCheckpoints({ base, allow, headers, fetchImpl, name, signal }); if (!l.ok) return l; list = l.checkpoints; }
  const pick = pickCheckpoint(list, checkpoint, { strict: strictCheckpoint, name });
  if (!pick.ok) return pick;
  const ckpt = pick.checkpoint;
  const sd = Number.isInteger(Number(seed)) && seed !== null && seed !== '' && Number(seed) >= 0 && Number(seed) < 2 ** 48 ? Number(seed) : crypto.randomInt(1, 2 ** 31);
  const neg = String(negative || '').slice(0, 2000);
  const graph = buildWorkflow({ checkpoint: ckpt, positive: p, negative: neg, seed: sd, width, height, steps: okNum(steps) ? steps : DEFAULTS.steps, cfg: okNum(cfg) ? cfg : DEFAULTS.cfg, sampler, scheduler });
  const used = { seed: sd, checkpoint: ckpt, width: graph['5'].inputs.width, height: graph['5'].inputs.height, steps: graph['3'].inputs.steps, cfg: graph['3'].inputs.cfg, sampler: graph['3'].inputs.sampler_name, scheduler: graph['3'].inputs.scheduler, positive: p, negative: neg };
  const jh = { 'content-type': 'application/json', accept: 'application/json', ...headers };
  const base0 = { allow, fetchImpl, name, max: MAX_JSON };
  if (signal?.aborted) return hnet.fail('Stopped before it was sent.', 'cancelled');
  // POST /prompt { prompt, client_id (a uuid) } -> { prompt_id }; ComfyUI's own words on an HTTP error.
  // (Not tied to Cancel: once ComfyUI has the job, its id is needed to take it off the queue.)
  const sent = await hnet.safeFetch(`${base}/prompt`, { allow, fetchImpl, name, timeoutMs: 30000, init: { method: 'POST', headers: jh, body: JSON.stringify({ prompt: graph, client_id: crypto.randomUUID() }) } });
  if (!sent.ok) return sent;
  if (!sent.res.ok) { const b = await hnet.readCapped(sent.res, 64 * 1024).catch(() => null) || Buffer.alloc(0); return hnet.fail(`${name} refused the picture: ${promptErrorText(sent.res.status, b)}`, 'failed', { status: sent.res.status }); }
  const pj = await hnet.readJson(sent.res, MAX_JSON);
  const id = String(pj.ok ? pj.json?.prompt_id || '' : '');
  if (!ID_RE.test(id)) return hnet.fail(`${name} gave an unexpected answer to the picture request.`);
  const stop = async () => { const how = await cancelJob({ base, allow, headers, fetchImpl, name, id }).catch(() => 'gone'); return hnet.fail(how === 'removed' ? 'Cancelled: taken out of ComfyUI\'s queue.' : how === 'interrupted' ? 'Cancelled: ComfyUI stopped the picture.' : 'Cancelled.', 'cancelled', { promptId: id }); };
  tell('queued', { promptId: id });
  for (let i = 0; i < maxPolls; i++) {
    if (signal?.aborted) return stop();
    await abortableSleep(sleep, pollMs, signal);
    if (signal?.aborted) return stop();
    const h = await hnet.fetchJson(`${base}/history/${id}`, { ...base0, timeoutMs: 15000, init: { headers: jh } });
    if (!h.ok) { if (['redirect', 'blocked'].includes(h.kind)) return h; continue; }
    const entry = h.json?.[id];
    if (!entry || typeof entry !== 'object') {
      // Not finished yet: queued or generating (GET /queue), every few polls to stay light.
      if (i % 3 === 0) { const st = await queueState({ base, allow, headers, fetchImpl, name, id }); tell(st === 'pending' ? 'queued' : 'generating', { promptId: id }); } else tell('tick', { promptId: id });
      continue;
    }
    if (entry.status?.status_str === 'error') { const why = runErrorText(entry.status); return hnet.fail(`${name}: the picture failed on the server${why ? `: ${why}` : '.'}`, 'gen_failed', { promptId: id }); }
    const imgs = Object.values(entry.outputs || {}).flatMap((o) => (Array.isArray(o?.images) ? o.images : [])).filter((im) => im && typeof im.filename === 'string');
    if (!imgs.length) {
      if (entry.status?.completed || entry.status?.status_str === 'success') return hnet.fail(`${name} finished without a picture (the workflow saved no image).`, 'no_images', { promptId: id });
      tell('generating', { promptId: id });
      continue;
    }
    tell('downloading', { promptId: id });
    const out = [];
    for (const im of imgs.slice(0, 4)) {
      // GET /view?filename=&subfolder=&type=output
      const q = new URLSearchParams({ filename: String(im.filename).slice(0, 300), subfolder: String(im.subfolder || '').slice(0, 300), type: ['output', 'temp'].includes(im.type) ? im.type : 'output' });
      const v = await hnet.safeFetch(`${base}/view?${q}`, { allow, fetchImpl, name, signal, timeoutMs: 60000, init: { headers } });
      if (!v.ok) { if (v.kind === 'redirect') return v; if (v.kind === 'cancelled') return stop(); continue; }
      if (!v.res.ok) continue;
      const type = String(v.res.headers?.get?.('content-type') || 'image/png').split(';')[0].toLowerCase();
      if (!/^image\/(png|jpeg|webp)$/.test(type)) continue;
      const buf = await hnet.readCapped(v.res, MAX_IMAGE).catch(() => null);
      if (buf?.length) out.push({ buf, mime: type });
    }
    return out.length ? { ok: true, images: out, ...used, promptId: id, vram } : hnet.fail(`${name}: couldn't download the picture.`, 'failed', { promptId: id });
  }
  // Out of time: take it off ComfyUI's queue so it doesn't keep the GPU busy for nothing.
  await cancelJob({ base, allow, headers, fetchImpl, name, id }).catch(() => {});
  return hnet.fail(`${name}: no picture after ${Math.max(1, Math.round((maxPolls * pollMs) / 60000))} minute${maxPolls * pollMs >= 120000 ? 's' : ''}, so it was stopped. The PC may be busy (a game or a big model on the GPU); try again or pick a smaller size.`, 'gen_timeout', { promptId: id });
}

// ---------- the ComfyUI server in Settings › Accounts (read-time defaults; saved only by him) ----------
// Saved: { url: '' (none), checkpoint: '' (none picked) } plus, only once he picks them,
// size ('1024x1024' | '1344x768' | '768x1344'), steps and cfg. Nothing is filled in here: the
// defaults (DEFAULTS) are applied only when a picture is made (effective()), never written.
// Only addresses on this PC, the home network or Tailscale are accepted: scene prompts never
// go to an internet host.
function cleanSettings(v) {
  const s = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const url = typeof s.url === 'string' ? hnet.cleanBase(s.url) : null;
  const out = { url: url && hnet.isPrivateHost(hnet.hostOf(url)) ? url : '', checkpoint: typeof s.checkpoint === 'string' && CKPT_RE.test(s.checkpoint) ? s.checkpoint : '' };
  if (SIZE_CHOICES.some((c) => c.id === s.size)) out.size = s.size;
  if (Number.isInteger(s.steps) && s.steps >= 4 && s.steps <= 60) out.steps = s.steps;
  if (typeof s.cfg === 'number' && Number.isFinite(s.cfg) && s.cfg >= 1 && s.cfg <= 15) out.cfg = Math.round(s.cfg * 10) / 10;
  return out;
}
function mergeSettings(cur, patch) {
  const next = { ...cleanSettings(cur) };
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  if ('url' in p) {
    const raw = String(p.url || '').trim();
    if (!raw) next.url = '';
    else {
      const u = hnet.cleanBase(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
      if (!u) throw new Error(`Type the ComfyUI address, like ${DEFAULTS.url}`);
      if (!hnet.isPrivateHost(hnet.hostOf(u))) throw new Error(`The ComfyUI server must be on this PC, your home network or Tailscale (like ${DEFAULTS.url}), so scene prompts never go to an internet host.`);
      if (u !== next.url) next.checkpoint = '';
      next.url = u;
    }
  }
  if ('checkpoint' in p) next.checkpoint = typeof p.checkpoint === 'string' && CKPT_RE.test(p.checkpoint) ? p.checkpoint : '';
  if ('size' in p) {
    if (p.size === '' || p.size === null) delete next.size;
    else if (SIZE_CHOICES.some((c) => c.id === p.size)) next.size = p.size;
    else throw new Error('Pick one of the offered picture sizes.');
  }
  if ('steps' in p) {
    if (p.steps === '' || p.steps === null) delete next.steps;
    else { const n = Number(p.steps); if (!Number.isInteger(n) || n < 4 || n > 60) throw new Error('Steps must be a whole number from 4 to 60.'); next.steps = n; }
  }
  if ('cfg' in p) {
    if (p.cfg === '' || p.cfg === null) delete next.cfg;
    else { const n = Number(p.cfg); if (!Number.isFinite(n) || n < 1 || n > 15) throw new Error('CFG must be a number from 1 to 15.'); next.cfg = Math.round(n * 10) / 10; }
  }
  return cleanSettings(next);
}
// What a picture uses: his saved values, else the defaults (filled in here, at read time only).
function effective(saved) {
  const s = cleanSettings(saved);
  const size = SIZE_CHOICES.find((c) => c.id === s.size) || SIZE_CHOICES[0];
  return { url: s.url, checkpoint: s.checkpoint, width: size.width, height: size.height, size: size.id, steps: s.steps ?? DEFAULTS.steps, cfg: s.cfg ?? DEFAULTS.cfg, sampler: DEFAULTS.sampler, scheduler: DEFAULTS.scheduler };
}
// Only the configured server's own host may be reached.
const allowOnly = (base) => { const h = hnet.hostOf(base); return (host) => Boolean(h) && host === h && hnet.isPrivateHost(host); };

module.exports = { cleanSettings, mergeSettings, effective, allowOnly, listCheckpoints, checkpointNames, systemStats, testConnection, pickCheckpoint, buildWorkflow, generate, cancelJob, promptErrorText, runErrorText, DEFAULTS, SIZE_CHOICES, SIZES, MAX_IMAGE, MAX_JSON, CKPT_RE, LOW_VRAM };

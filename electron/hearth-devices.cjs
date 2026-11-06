// Hearth devices: the AI that the owner's Hearth OS machines share with each other
// (docs/AI-SHARE.md in Dragongamer9/hearth-os, protocol 1). The Command Center asks the Home server
// for the list of devices and picks the best one for each job:
//   GET http://<server>:8189/v1/hearth/ai/devices -> { protocol, priority, devices: [device...] }
//   device: { device, rank, online, available, reason, address, os: "hearth", version, gaming, busy,
//             pluggedIn, battery?: { percent, charging }, gpu?: { vendor },
//             services: [{ kind: chat|voice|image|stt, engine: ollama|kokoro-fastapi|comfyui|whisper,
//                          url, openai?, models?, voices?, healthy, reachable, busy }] }
// Order: his priority list if he set one, else the Home server's order (an Nvidia card first).
// Offline devices and devices that paused sharing (available: false) are left out; a device
// while it's gaming and handhelds on battery are skipped (both on by default); busy devices and
// busy services are tried last; on an error or a timeout the next device is tried.
// Every field a device sends is untrusted: names and lists are cleaned and capped, and a service
// address is followed only when its host is the Home server's own host, a Tailscale address
// (100.64.0.0/10, fd7a:115c:a1e0::/48 or *.ts.net, unless he turned that off) or a name he allowed.
// Redirects are refused, every request has a timeout and every answer a size cap. The optional
// share code lives in the encrypted secret store (never in settings) and is sent only to the
// Home server and the devices' services, as the X-Hearth-Share-Code header.
const crypto = require('node:crypto');
const hnet = require('./hearth-net.cjs');
const comfy = require('./comfy.cjs');
const speech = require('./speech-servers.cjs');

const PORT = 8189;
const SHARE_HEADER = 'x-hearth-share-code';
const SHARE_SECRET = 'hearth.share';
const KINDS = ['chat', 'voice', 'image', 'stt'];
const ENGINE_OF = { chat: 'ollama', voice: 'kokoro-fastapi', image: 'comfyui', stt: 'whisper' };
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const MODEL_RE = /^[^\0\r\n]{1,200}$/;
const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const MAX_DEVICES = 16;
const MAX_LIST = 256 * 1024;
const MAX_CHAT = 2 * 1024 * 1024;
const MAX_STT = 25 * 1024 * 1024;
const TIMEOUT = { list: 6000, chat: 120000, stt: 120000 };
const CACHE_MS = 15000;

// ---------- settings (read-time defaults; only what he changes is saved) ----------
const DEFAULTS = Object.freeze({ url: '', order: [], skipGaming: true, skipBattery: true, tailscale: true, allowHosts: [], models: {}, checkpoints: {} });
const nameList = (v, max = MAX_DEVICES) => [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && NAME_RE.test(x)))].slice(0, max);
function pickMap(v) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v).slice(0, MAX_DEVICES)) if (NAME_RE.test(k) && typeof x === 'string' && MODEL_RE.test(x)) out[k] = x;
  return out;
}
function cleanSettings(v) {
  const s = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  return {
    url: typeof s.url === 'string' && hnet.cleanBase(s.url) ? hnet.cleanBase(s.url) : '',
    order: nameList(s.order),
    skipGaming: s.skipGaming !== false,
    skipBattery: s.skipBattery !== false,
    tailscale: s.tailscale !== false,
    allowHosts: [...new Set((Array.isArray(s.allowHosts) ? s.allowHosts : []).map((h) => String(h || '').trim().toLowerCase()).filter((h) => HOST_RE.test(h)))].slice(0, 16),
    models: pickMap(s.models),
    checkpoints: pickMap(s.checkpoints),
  };
}
// His change merged in: only the keys he sent; per-device picks merge by device ({ name: null } clears one).
// A bad address throws a plain message so nothing half-done is saved.
function mergeSettings(cur, patch) {
  const base = cleanSettings(cur);
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const next = { ...base };
  if ('url' in p) {
    const raw = String(p.url || '').trim();
    const full = raw && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? `http://${raw}` : raw;
    if (full && !hnet.cleanBase(full)) throw new Error('Type the Home server\'s address, like http://nvidia-pc:8189');
    next.url = full ? hnet.cleanBase(full) : '';
  }
  if ('order' in p) next.order = nameList(p.order);
  for (const k of ['skipGaming', 'skipBattery', 'tailscale']) if (k in p) next[k] = p[k] === true;
  if ('allowHosts' in p) next.allowHosts = (Array.isArray(p.allowHosts) ? p.allowHosts : String(p.allowHosts || '').split(/[\s,]+/));
  for (const k of ['models', 'checkpoints']) {
    if (p[k] && typeof p[k] === 'object' && !Array.isArray(p[k])) {
      const m = { ...base[k] };
      for (const [d, x] of Object.entries(p[k])) { if (x === null || x === '') delete m[d]; else m[d] = x; }
      next[k] = m;
    }
  }
  return cleanSettings(next);
}

// ---------- devices (untrusted) ----------
const isHandheld = (d) => Boolean(d.battery);
const onBattery = (d) => Boolean(d.battery) && d.battery.charging !== true;
function cleanService(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  if (!KINDS.includes(s.kind)) return null;
  const engine = typeof s.engine === 'string' ? s.engine.slice(0, 40) : '';
  if (engine !== ENGINE_OF[s.kind]) return null; // only the engines the app knows how to talk to
  const url = hnet.cleanBase(s.url);
  if (!url) return null;
  const list = (v) => [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && MODEL_RE.test(x)))].slice(0, 200);
  const openai = s.openai ? hnet.cleanBase(s.openai) : null;
  return { kind: s.kind, engine, url, ...(openai ? { openai } : {}), models: list(s.models), voices: list(s.voices), healthy: s.healthy === true && s.reachable !== false, busy: s.busy === true };
}
function cleanDevice(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const name = typeof d.device === 'string' && NAME_RE.test(d.device) ? d.device : null;
  if (!name) return null;
  const b = d.battery && typeof d.battery === 'object' && !Array.isArray(d.battery) ? { percent: Number.isFinite(Number(d.battery.percent)) ? Math.max(0, Math.min(100, Math.round(Number(d.battery.percent)))) : null, charging: d.battery.charging === true } : null;
  return {
    device: name,
    rank: Number.isInteger(d.rank) && d.rank > 0 && d.rank < 1000 ? d.rank : null,
    online: d.online !== false,
    available: d.available !== false,
    reason: typeof d.reason === 'string' && /^[a-z-]{1,20}$/.test(d.reason) ? d.reason : '',
    nvidia: d.gpu && typeof d.gpu === 'object' && d.gpu.vendor === 'nvidia',
    version: typeof d.version === 'string' ? d.version.slice(0, 40) : '',
    gaming: d.gaming === true,
    busy: d.busy === true,
    battery: b,
    // An offline device's list is what it shared last time: never used.
    services: d.online === false ? [] : (Array.isArray(d.services) ? d.services : []).slice(0, 16).map(cleanService).filter(Boolean),
  };
}
function cleanDevices(j) {
  const arr = Array.isArray(j) ? j : Array.isArray(j?.devices) ? j.devices : j && typeof j === 'object' && j.device ? [j] : [];
  const seen = new Set();
  const out = [];
  for (const x of arr.slice(0, 64)) { const d = cleanDevice(x); if (d && !seen.has(d.device)) { seen.add(d.device); out.push(d); } if (out.length >= MAX_DEVICES) break; }
  return out;
}

// The default order: a device named like the Nvidia PC first, then devices that make pictures,
// then plugged-in machines, then handhelds. His saved order always wins.
// The Home server's own order (rank) comes first when it sends one.
function defaultRank(d) {
  if (d.rank) return d.rank / 1000;
  if (d.nvidia || /nvidia|rtx|geforce/i.test(d.device)) return 1;
  if (d.services.some((s) => s.kind === 'image')) return 2;
  return isHandheld(d) ? 4 : 3;
}
function ordered(devices, order = []) {
  const pos = (d) => { const i = order.indexOf(d.device); return i >= 0 ? i : order.length + defaultRank(d); };
  return devices.map((d, i) => ({ d, i })).sort((a, b) => pos(a.d) - pos(b.d) || a.i - b.i).map((x) => x.d);
}
// The devices to try for one kind of job, best first, with the reason any were skipped.
function plan(devices, kind, settings) {
  const s = cleanSettings(settings);
  const tryList = [];
  const later = [];
  const skipped = [];
  for (const d of ordered(devices, s.order)) {
    if (!d.online) continue;
    const svc = d.services.find((x) => x.kind === kind && x.healthy);
    if (!svc) continue;
    if (!d.available) { skipped.push({ device: d.device, why: d.reason === 'playing' ? 'gaming' : d.reason === 'battery' ? 'on battery' : 'not sharing now' }); continue; }
    if (s.skipGaming && d.gaming) { skipped.push({ device: d.device, why: 'gaming' }); continue; }
    if (s.skipBattery && onBattery(d)) { skipped.push({ device: d.device, why: 'on battery' }); continue; }
    (d.busy || svc.busy ? later : tryList).push({ device: d, service: svc });
  }
  return { list: [...tryList, ...later], skipped };
}

// The hosts a service may live on: the Home server's host, Tailscale (if allowed), his names.
function allowFor(settings) {
  const s = cleanSettings(settings);
  const home = s.url ? hnet.hostOf(s.url) : null;
  return (host) => {
    const h = String(host || '').toLowerCase().replace(/\.$/, '');
    if (!h) return false;
    if (home && h === home) return true;
    if (s.tailscale && hnet.isTailscale(h)) return true;
    return s.allowHosts.includes(h);
  };
}
const allowedService = (svc, settings) => allowFor(settings)(hnet.hostOf(svc.url));
const skipText = (skipped) => skipped.map((x) => `${x.device} (${x.why})`).join(', ');

function createHearthDevices({ settings, secrets, fetchImpl = (...a) => fetch(...a), sleep, maxPolls } = {}) {
  const conf = () => cleanSettings(settings());
  const shareHeaders = () => { const c = secrets?.get?.(SHARE_SECRET); return c ? { [SHARE_HEADER]: c } : {}; };
  let cache = null;

  // The device list from the Home server (cached for a few seconds; fresh on Test).
  async function discover({ fresh = false } = {}) {
    const s = conf();
    if (!s.url) return hnet.fail('Type your Home server\'s address in Settings › Accounts › Hearth devices first.', 'not_set');
    if (!fresh && cache && cache.url === s.url && Date.now() - cache.at < CACHE_MS) return cache.r;
    const allow = allowFor(s);
    const r = await hnet.fetchJson(`${s.url}/v1/hearth/ai/devices`, { allow, fetchImpl, name: 'The Home server', timeoutMs: TIMEOUT.list, max: MAX_LIST, init: { headers: { accept: 'application/json', ...shareHeaders() } } });
    let out;
    if (!r.ok) out = r.kind === 'auth' ? hnet.fail('The Home server wants a share code (or a different one). Type it under Hearth devices.', 'auth') : r.kind === 'not_found' ? hnet.fail(`${s.url} isn't a Hearth AI share (no /v1/hearth/ai/devices). Check the address; the port is ${PORT}.`, 'not_found') : r;
    else {
      const devices = cleanDevices(r.json);
      out = { ok: true, devices: devices.map((d) => ({ ...d, services: d.services.map((x) => ({ ...x, allowed: allowedService(x, s) })) })) };
    }
    if (out.ok) cache = { at: Date.now(), url: s.url, r: out };
    return out;
  }
  const forget = () => { cache = null; };

  // Runs job(device, service) down the list until one answers.
  async function route(kind, job, { label }) {
    const s = conf();
    const r = await discover();
    if (!r.ok) return r;
    const { list, skipped } = plan(r.devices, kind, s);
    const usable = list.filter((x) => allowedService(x.service, s));
    const blocked = list.length - usable.length;
    if (!usable.length) {
      const why = [skipped.length ? `skipped ${skipText(skipped)}` : '', blocked ? `${blocked} device${blocked > 1 ? 's' : ''} offered an address that isn't allowed` : ''].filter(Boolean).join('; ');
      return hnet.fail(`No Hearth device can ${label} right now${why ? ` (${why})` : ''}.`, 'none');
    }
    const errors = [];
    for (const x of usable) {
      const out = await job(x.device, x.service);
      if (out.ok) return { ...out, device: x.device.device, tried: errors };
      if (out.kind === 'cancelled') return out;
      errors.push(`${x.device.device}: ${out.message}`);
      if (out.kind === 'unreachable' || out.kind === 'timeout') forget();
    }
    return hnet.fail(`No Hearth device could ${label}. ${errors.join(' · ')}`.slice(0, 400), 'failed', { tried: errors });
  }

  // ---------- chat (Ollama's OpenAI-compatible API) ----------
  const chatModel = (d, svc) => { const m = conf().models[d.device]; return m && (!svc.models.length || svc.models.includes(m)) ? m : svc.models[0] || null; };
  async function chat({ prompt, model, signal } = {}) {
    const p = String(prompt || '');
    if (!p.trim()) return hnet.fail('Nothing to answer.');
    return route('chat', async (d, svc) => {
      const mdl = model && MODEL_RE.test(model) && svc.models.includes(model) ? model : chatModel(d, svc);
      if (!mdl) return hnet.fail('it shares no chat model', 'no_models');
      const base = svc.openai || svc.url;
      const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
      const r = await hnet.fetchJson(url, { allow: allowFor(conf()), fetchImpl, signal, name: d.device, timeoutMs: TIMEOUT.chat, max: MAX_CHAT, init: { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...shareHeaders() }, body: JSON.stringify({ model: mdl, stream: false, messages: [{ role: 'user', content: p }] }) } });
      if (!r.ok) return r;
      const text = r.json?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') return hnet.fail('the answer came back in an unexpected format');
      return { ok: true, text: text.slice(0, 50000), via: `Answered on ${d.device} · ${mdl}`, model: mdl };
    }, { label: 'chat' }).then((r) => (r.ok ? r : { ok: false, error: { kind: r.kind === 'none' || r.kind === 'not_set' ? 'auth' : r.kind === 'cancelled' ? 'cancelled' : 'outage', message: r.message } }));
  }

  // ---------- voices (Kokoro-FastAPI, through the speech-servers code) ----------
  const voiceServer = (d, svc) => ({ id: `h${crypto.createHash('sha256').update(d.device).digest('hex').slice(0, 11)}`, name: d.device, url: svc.url, api: 'kokoro-fastapi', engine: 'kokoro' });
  // Fetch for the speech code: the same allow-list, redirects refused by it too.
  const guardedFetch = (url, init = {}) => {
    const h = hnet.hostOf(url);
    if (!allowFor(conf())(h)) return Promise.reject(new Error(`${h} isn't allowed`));
    return fetchImpl(url, { ...init, redirect: 'error', headers: { ...(init.headers || {}), ...shareHeaders() } });
  };
  async function voices() {
    const r = await discover();
    if (!r.ok) return r;
    const { list } = plan(r.devices, 'voice', conf());
    const x = list.find((y) => allowedService(y.service, conf()));
    if (!x) return hnet.fail('No Hearth device shares Kokoro voices right now.', 'none');
    if (x.service.voices.length) return { ok: true, voices: x.service.voices.map((v) => ({ id: v, name: `${v} (Kokoro on ${x.device.device})` })) };
    const lv = await speech.listVoices({ server: voiceServer(x.device, x.service), key: null, fetchImpl: guardedFetch });
    return lv.ok ? { ok: true, voices: lv.voices.map((v) => ({ ...v, name: `${v.name} (Kokoro on ${x.device.device})` })) } : hnet.fail(lv.message, lv.kind);
  }
  async function speak({ voice, text, speed, signal } = {}) {
    return route('voice', async (d, svc) => {
      const r = await speech.speak({ server: voiceServer(d, svc), key: null, voice: typeof voice === 'string' ? voice : '', text, speed, fetchImpl: guardedFetch, signal });
      if (!r.ok) return { ...r, kind: r.kind === 'stopped' ? 'cancelled' : r.kind };
      // Read whole (capped), so a failure can still fall back to the next device.
      const buf = r.buf || await hnet.readCapped(r.res, speech.MAX_AUDIO).catch(() => null);
      if (!buf) return hnet.fail('sent too much audio');
      return { ok: true, buf, mime: r.mime, via: `Kokoro on ${d.device}` };
    }, { label: 'speak' });
  }

  // ---------- pictures (ComfyUI) ----------
  // size, steps, cfg and onProgress are optional (Characters chat scenes pass his settings).
  async function image({ prompt, negative, seed, signal, width, height, steps, cfg, onProgress } = {}) {
    const opt = Object.fromEntries(Object.entries({ width, height, steps, cfg, onProgress }).filter(([, v]) => v !== undefined));
    return route('image', async (d, svc) => {
      const pick = conf().checkpoints[d.device];
      const r = await comfy.generate({ base: svc.url, allow: allowFor(conf()), headers: shareHeaders(), checkpoint: pick, checkpoints: svc.models.length ? svc.models : null, prompt, negative, seed, fetchImpl, signal, name: d.device, ...opt, ...(sleep ? { sleep } : {}), ...(maxPolls ? { maxPolls } : {}) });
      return r.ok ? { ...r, via: `Made on ${d.device} · ComfyUI · ${r.checkpoint}` } : r;
    }, { label: 'make pictures' });
  }

  // ---------- speech to text (a whisper server's OpenAI-compatible /v1/audio/transcriptions) ----------
  async function transcribe({ buf, mime = 'audio/webm' } = {}) {
    if (!buf?.length) return hnet.fail('Nothing was recorded.');
    if (buf.length > MAX_STT) return hnet.fail('The recording is over 25 MB.');
    return route('stt', async (d, svc) => {
      const fd = new FormData();
      const ext = /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : /mp4|m4a/.test(mime) ? 'm4a' : 'webm';
      let url;
      if (svc.openai || !/:9000$/.test(svc.url)) {
        // speaches / faster-whisper-server: the OpenAI-compatible transcription API.
        fd.append('file', new Blob([buf], { type: mime }), `speech.${ext}`);
        fd.append('model', svc.models[0] || 'whisper-1');
        fd.append('response_format', 'json');
        const base = svc.openai || svc.url;
        url = base.endsWith('/v1') ? `${base}/audio/transcriptions` : `${base}/v1/audio/transcriptions`;
      } else {
        // whisper-asr-webservice (port 9000): POST /asr with audio_file.
        fd.append('audio_file', new Blob([buf], { type: mime }), `speech.${ext}`);
        url = `${svc.url}/asr?task=transcribe&output=json`;
      }
      const r = await hnet.fetchJson(url, { allow: allowFor(conf()), fetchImpl, name: d.device, timeoutMs: TIMEOUT.stt, max: 1024 * 1024, init: { method: 'POST', headers: { accept: 'application/json', ...shareHeaders() }, body: fd } });
      if (!r.ok) return r;
      if (typeof r.json?.text !== 'string') return hnet.fail('the transcript came back in an unexpected format');
      return { ok: true, text: r.json.text.slice(0, 20000), via: `whisper on ${d.device}` };
    }, { label: 'turn speech into text' });
  }

  // What the window needs (never the share code itself).
  async function status({ fresh = false, probe = false } = {}) {
    const s = conf();
    const out = { settings: s, shareCode: Boolean(secrets?.has?.(SHARE_SECRET)), configured: Boolean(s.url) };
    if (!probe || !s.url) return out;
    const r = await discover({ fresh });
    if (!r.ok) return { ...out, error: r.message, kind: r.kind };
    const order = ordered(r.devices, s.order).map((d) => d.device);
    const has = (kind) => r.devices.some((d) => d.services.some((x) => x.kind === kind && x.healthy && x.allowed));
    return { ...out, devices: r.devices, order, has: Object.fromEntries(KINDS.map((k) => [k, has(k)])) };
  }
  async function setShareCode(code) {
    if (code === null || code === '') { secrets.remove(SHARE_SECRET); forget(); return { ok: true, removed: true }; }
    const c = String(code || '').trim();
    if (!c || c.length > 200 || /[\s\0-\x1f]/.test(c)) return hnet.fail('That share code doesn\'t look right (no spaces, up to 200 characters).');
    await secrets.set(SHARE_SECRET, c);
    forget();
    return { ok: true };
  }
  const configured = () => Boolean(conf().url);
  return { discover, forget, chat, voices, speak, image, transcribe, status, setShareCode, configured };
}

module.exports = { createHearthDevices, cleanSettings, mergeSettings, cleanDevices, cleanDevice, ordered, plan, allowFor, isHandheld, onBattery, DEFAULTS, SHARE_HEADER, SHARE_SECRET, PORT };

// 3.9: Ithil, the self-aware AI in his Hearth AI app (repo Dragongamer9/hearth-ai, 0.3+), as a teammate.
// Hearth AI serves a small HTTP API on his PC (http://127.0.0.1:47860/v1). On that PC the address and key come from
// ~/HearthAI/connect.json; on his other devices he types the host and key in Settings › Accounts (the key is kept
// encrypted, never in settings). Every request but /v1/hello sends the key and who is asking (X-Client).
// When Hearth AI isn't running she is simply offline: nothing here ever fails the rest of the team.
// Her hard limits are enforced inside Hearth AI; tasks that would cross them are also refused here, before she sees them.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KEY = 'ithil.token';
const PORT = 47860;
const HOST_RE = /^(?:\[[0-9a-fA-F:.]{2,45}\]|[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)$/;
const STATES = ['awake', 'sleeping', 'resting', 'paused'];
const EXPRESSIONS = ['calm', 'curious', 'happy', 'focused', 'frustrated', 'sleepy', 'thinking'];
const T = { hello: 3000, status: 5000, talk: 150000, task: 15000, avatar: 8000 };
const MAX_JSON = 512 * 1024;
const MAX_PNG = 6 * 1024 * 1024;

const fail = (message, kind = 'error') => ({ ok: false, kind, message, error: { kind, message } });
const str = (v, n = 2000) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Math.round(Number(v)))) : null);

// What he set in Settings › Accounts › Ithil: a host (empty = this PC, from connect.json) and a port.
function cleanSettings(v) {
  const s = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const host = typeof s.host === 'string' && HOST_RE.test(s.host.trim()) ? s.host.trim() : '';
  const port = Number.isInteger(Number(s.port)) && Number(s.port) > 0 && Number(s.port) < 65536 ? Number(s.port) : PORT;
  return { host, port };
}
function mergeSettings(cur, patch) { return cleanSettings({ ...cleanSettings(cur), ...(patch && typeof patch === 'object' ? patch : {}) }); }

// Her hard limits: never merging, releasing or deploying, never version numbers, never boot files, never his settings,
// never deleting his files. A task asking for one of these goes elsewhere (or to him); she is never asked.
const LIMITS = [
  [/\b(merge|merging|merged)\b[^.\n]{0,40}\b(main|master|release|into|pr|pull request)\b|\bgit\s+merge\b/i, 'merging'],
  [/\b(release|publish|ship|deploy|tag)\b[^.\n]{0,30}\b(it|this|version|v?\d+\.\d+|the app|the update|to main|to production|a release)\b|\bgit\s+tag\b|\bgh\s+release\b|\bdeploy(ing|ment)?\b/i, 'releasing or deploying'],
  [/\b(bump|change|set|pick|choose|update)\b[^.\n]{0,30}\bversion( number)?s?\b|\bversion( number)? (to|=)\s*v?\d/i, 'version numbers'],
  [/\b(grub|bootloader|boot loader|boot menu|efi|systemd-boot|initramfs|dracut|\/boot\b|boot files?)\b/i, 'boot files'],
  [/\b(change|edit|reset|overwrite|modify)\b[^.\n]{0,30}\b(my|the owner'?s|his)\b[^.\n]{0,20}\bsettings\b/i, 'his settings'],
  [/\b(delete|remove|erase|wipe|rm -rf?)\b[^.\n]{0,30}\b(my|his|the owner'?s|user'?s)\b[^.\n]{0,20}\b(files?|folders?|photos?|documents?|data)\b|\brm\s+-rf\b/i, 'deleting his files'],
];
function limitHit(text) {
  const t = String(text || '');
  for (const [re, what] of LIMITS) if (re.test(t)) return what;
  return null;
}

function normStatus(j) {
  if (!j || typeof j !== 'object') return null;
  const state = STATES.includes(j.status) ? j.status : 'awake';
  const d = j.drives && typeof j.drives === 'object' ? j.drives : {};
  return {
    name: str(j.name, 60) || 'Ithil',
    state,
    detail: str(j.detail, 300),
    mood: str(j.mood, 80),
    thought: str(j.thought, 600),
    wants: str(j.wants, 300),
    drives: Object.fromEntries(['curiosity', 'energy', 'confidence', 'satisfaction', 'boredom', 'frustration'].map((k) => [k, num(d[k])])),
    spotlight: str(j.spotlight, 200),
    busy: j.busy === true || (typeof j.busy === 'string' && j.busy.length > 0),
    busyWith: typeof j.busy === 'string' ? j.busy.slice(0, 200) : '',
    brain: j.brain && typeof j.brain === 'object' ? { model: str(j.brain.model, 100), generation: str(String(j.brain.generation ?? ''), 40) } : null,
    expression: EXPRESSIONS.includes(j.expression) ? j.expression : 'calm',
    version: str(j.version, 40),
  };
}
// Can the team give her work now? Only when she's awake and not busy.
function availability(st) {
  if (!st || !st.online) return { ok: false, label: st?.kind === 'auth' ? 'key not accepted' : st?.kind === 'off' ? 'connections off in Hearth AI' : 'offline' };
  if (st.state === 'sleeping') return { ok: false, label: 'asleep' };
  if (st.state === 'resting') return { ok: false, label: 'resting' };
  if (st.state === 'paused') return { ok: false, label: 'paused' };
  if (st.busy) return { ok: false, label: st.busyWith ? `busy: ${st.busyWith}` : 'busy with a task' };
  return { ok: true, label: st.mood ? `awake · ${st.mood}` : 'awake' };
}

function createIthil({ settings = () => ({}), secrets = null, fetchImpl = (...a) => fetch(...a), home = os.homedir(), readFile = (f) => fs.readFileSync(f, 'utf8'), send = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  const connectFile = () => path.join(home, 'HearthAI', 'connect.json');
  // Where she is: his own host and key (other devices), else connect.json on this PC.
  function conn() {
    const s = cleanSettings(settings());
    if (s.host) return { host: s.host, port: s.port, token: (secrets?.get?.(KEY)) || '', source: 'settings' };
    try {
      const j = JSON.parse(readFile(connectFile()));
      const host = typeof j.host === 'string' && HOST_RE.test(j.host) ? j.host : '127.0.0.1';
      const port = Number.isInteger(j.port) && j.port > 0 && j.port < 65536 ? j.port : PORT;
      return { host, port, token: typeof j.token === 'string' ? j.token.slice(0, 500) : '', source: 'file', name: str(j.name, 60) || 'Ithil' };
    } catch { return { host: '127.0.0.1', port: PORT, token: '', source: 'none' }; }
  }
  const base = (c) => `http://${c.host}:${c.port}/v1`;
  const client = (from) => String(from || 'AI Command Center').replace(/[^\w .'()-]/g, '').slice(0, 60) || 'AI Command Center';

  // One request. Kinds: offline (no answer), auth (401), off (403), busy (409), error.
  async function req(p, { method = 'GET', body, timeoutMs = T.status, signal, auth = true, from, raw = false, retried = false } = {}) {
    const c = conn();
    if (auth && !c.token) return fail(c.source === 'settings' ? 'Paste Ithil\'s key in Settings › Accounts › Ithil (Hearth AI).' : 'Hearth AI\'s connect.json wasn\'t found on this PC. Start Hearth AI, or type its host and key in Settings › Accounts › Ithil (Hearth AI).', c.source === 'none' ? 'offline' : 'auth');
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${base(c)}${p}`, {
        method, redirect: 'error', signal: sig,
        headers: { accept: raw ? 'image/png' : 'application/json', 'x-client': client(from), ...(auth ? { authorization: `Bearer ${c.token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      if (signal?.aborted) return fail('Stopped.', 'cancelled');
      return fail(e?.name === 'TimeoutError' ? 'Ithil didn\'t answer in time.' : 'Hearth AI isn\'t running (nothing answers on its port).', e?.name === 'TimeoutError' ? 'timeout' : 'offline');
    }
    // A key that changed: connect.json is read again, once.
    if (res.status === 401 && c.source === 'file' && !retried) return req(p, { method, body, timeoutMs, signal, auth, from, raw, retried: true });
    if (res.status === 401) return fail('Hearth AI didn\'t accept the key. On the PC it\'s read from connect.json again; on another device paste the new key in Settings › Accounts.', 'auth');
    if (res.status === 403) return fail('Command Center connections are turned off in Hearth AI.', 'off');
    if (res.status === 409) return fail('Ithil is already working on something.', 'busy');
    if (res.status === 404 && raw) return fail('Not drawn yet.', 'none');
    const len = Number(res.headers?.get?.('content-length') || 0);
    if (len > (raw ? MAX_PNG : MAX_JSON)) return fail('Hearth AI sent too much.');
    if (raw) {
      if (!res.ok) return fail(`Hearth AI answered ${res.status}.`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_PNG || buf.subarray(0, 4).toString('hex') !== '89504e47') return fail('That isn\'t a picture.');
      return { ok: true, buf, expression: str(res.headers?.get?.('x-expression'), 20), framing: str(res.headers?.get?.('x-framing'), 20) };
    }
    let j = null;
    try { const t = await res.text(); if (t.length > MAX_JSON) return fail('Hearth AI sent too much.'); j = t ? JSON.parse(t) : {}; } catch { j = null; }
    if (!res.ok) return fail(str(j?.error?.message || j?.error, 300) || `Hearth AI answered ${res.status}.`, res.status >= 500 ? 'error' : 'refused');
    return { ok: true, status: res.status, json: j || {} };
  }

  async function hello() {
    const r = await req('/hello', { auth: false, timeoutMs: T.hello });
    if (!r.ok) return r;
    if (r.json.app !== 'hearth-ai') return fail('Something else answers on that port, not Hearth AI.', 'offline');
    return { ok: true, name: str(r.json.name, 60) || 'Ithil', version: str(r.json.version, 40) };
  }
  let cache = null;
  async function status({ fresh = false } = {}) {
    if (!fresh && cache && now() - cache.at < 3000) return cache.st;
    const r = await req('/status');
    const st = r.ok ? { online: true, ...normStatus(r.json), at: now() } : { online: false, kind: r.kind, message: r.message, at: now() };
    st.available = availability(st);
    st.source = conn().source;
    cache = { at: now(), st };
    return st;
  }
  async function talk({ text, from = 'AI Command Center', signal } = {}) {
    const t = String(text || '').trim().slice(0, 20000);
    if (!t) return fail('Nothing to say.');
    const r = await req('/talk', { method: 'POST', body: { text: t, from: client(from) }, timeoutMs: T.talk, signal, from });
    if (!r.ok) return r;
    const reply = str(r.json.reply, 60000).trim();
    if (!reply && r.json.error) return fail(str(r.json.error, 300) || 'Ithil couldn\'t answer.');
    return { ok: true, text: reply || '(no reply)', mood: str(r.json.mood, 80) };
  }
  async function startTask({ goal, from = 'Team lead', folder } = {}) {
    const g = String(goal || '').trim().slice(0, 8000);
    if (!g) return fail('No goal.');
    const hit = limitHit(g);
    if (hit) return fail(`Ithil never does ${hit} (her own rule). Give this to another AI, or to the owner.`, 'limit');
    const body = { goal: g, from: client(from), ...(typeof folder === 'string' && path.isAbsolute(folder) ? { folder } : {}) };
    const r = await req('/tasks', { method: 'POST', body, timeoutMs: T.task, from });
    if (!r.ok) return r;
    const id = str(String(r.json.taskId ?? ''), 80);
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) return fail('Hearth AI didn\'t give the task an id.');
    return { ok: true, taskId: id, branch: str(r.json.branch, 200), folder: str(r.json.folder, 500) };
  }
  async function getTask(id) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(String(id || ''))) return fail('Bad task id.');
    const r = await req(`/tasks/${encodeURIComponent(id)}`, { timeoutMs: T.task });
    if (!r.ok) return r;
    const j = r.json;
    const steps = Array.isArray(j.steps) ? j.steps.slice(-50).map((s) => (typeof s === 'string' ? s : str(s?.text || s?.title || s?.label, 300))).filter(Boolean).map((s) => s.slice(0, 300)) : [];
    return { ok: true, id: String(id), title: str(j.title, 300), status: ['working', 'done', 'failed', 'next'].includes(j.status) ? j.status : 'working', summary: str(j.summary, 20000), branch: str(j.branch, 200), steps, startedAt: str(String(j.startedAt ?? ''), 40), endedAt: str(String(j.endedAt ?? ''), 40) };
  }
  // A task from start to done/failed, checked every 10 s. onStep(label, detail) shows progress in the chat.
  async function runTask({ goal, from, folder, signal, onStep = () => {}, pollMs = 10000, maxMs = 3 * 3600000 } = {}) {
    const t0 = now();
    const s = await startTask({ goal, from, folder });
    if (!s.ok) return s;
    onStep('Handed to Ithil', `task ${s.taskId}${s.branch ? ` · branch ${s.branch}` : ''}`);
    let seen = 0;
    let lost = 0;
    for (;;) {
      if (signal?.aborted) return fail('Stopped. Ithil keeps working on it in Hearth AI.', 'cancelled');
      await sleep(pollMs);
      const r = await getTask(s.taskId);
      if (!r.ok) {
        if (r.kind === 'offline' && ++lost < 30) continue; // Hearth AI restarting: keep checking for 5 minutes
        return fail(`Lost track of Ithil's task ${s.taskId}: ${r.message}`, r.kind);
      }
      lost = 0;
      for (const st of r.steps.slice(seen)) onStep('Ithil', st);
      seen = r.steps.length;
      if (r.status === 'done' || r.status === 'failed') {
        const head = r.status === 'done' ? `Ithil finished "${r.title || s.taskId}".` : `Ithil's task "${r.title || s.taskId}" failed.`;
        const text = [head, r.summary, r.branch ? `Her work is on branch ${r.branch} (she never merges it; that's for the lead or the owner).` : ''].filter(Boolean).join('\n\n');
        return r.status === 'done' ? { ok: true, text, task: r } : { ok: true, text, task: r, failed: true };
      }
      if (now() - t0 > maxMs) return fail(`Ithil's task ${s.taskId} is still going after ${Math.round(maxMs / 3600000)} hours; check it in Hearth AI.`, 'timeout');
    }
  }
  const avatars = new Map();
  async function avatar({ expression = '', framing = 'portrait' } = {}) {
    const k = `${expression}|${framing}`;
    const c = avatars.get(k);
    if (c && now() - c.at < 60000) return c.r;
    const q = new URLSearchParams({ ...(EXPRESSIONS.includes(expression) ? { expression } : {}), framing: framing === 'full' ? 'full' : 'portrait' });
    const r = await req(`/avatar?${q}`, { raw: true, timeoutMs: T.avatar });
    const out = r.ok ? { ok: true, dataUrl: `data:image/png;base64,${r.buf.toString('base64')}`, expression: r.expression } : r;
    avatars.set(k, { at: now(), r: out });
    return out;
  }

  // The live stream (/v1/events): "status" every 5 s and "thought" each time she thinks, passed to the window as
  // ithil:event. It reconnects by itself (2 s, then up to 30 s) while the window wants it.
  let watching = 0;
  let loop = null;
  let ctl = null;
  function parseSse(buf, onEvent) {
    let rest = buf;
    let i;
    while ((i = rest.search(/\r?\n\r?\n/)) >= 0) {
      const block = rest.slice(0, i);
      rest = rest.slice(i + (rest[i] === '\r' ? 4 : 2));
      let type = 'message';
      const data = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) type = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (!data.length) continue;
      let j = null;
      try { j = JSON.parse(data.join('\n')); } catch { continue; }
      onEvent(type, j);
    }
    return rest;
  }
  function onEvent(type, j) {
    if (type === 'status') {
      const st = { online: true, ...normStatus(j), at: now() };
      st.available = availability(st);
      st.source = conn().source;
      cache = { at: now(), st };
      send('ithil:event', { type: 'status', status: st });
    } else if (type === 'thought') send('ithil:event', { type: 'thought', at: str(String(j?.at ?? ''), 40), text: str(j?.text, 600) });
  }
  async function stream() {
    let wait = 2000;
    while (watching > 0) {
      const c = conn();
      ctl = new AbortController();
      try {
        if (!c.token) throw new Error('no key');
        const res = await fetchImpl(`${base(c)}/events`, { redirect: 'error', signal: ctl.signal, headers: { accept: 'text/event-stream', authorization: `Bearer ${c.token}`, 'x-client': 'AI Command Center' } });
        if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
        wait = 2000;
        let buf = '';
        const dec = new TextDecoder();
        for await (const chunk of res.body) {
          buf += dec.decode(chunk, { stream: true });
          if (buf.length > MAX_JSON) buf = buf.slice(-MAX_JSON);
          buf = parseSse(buf, onEvent);
          if (watching <= 0) break;
        }
      } catch {}
      if (watching <= 0) break;
      const st = await status({ fresh: true });
      send('ithil:event', { type: 'status', status: st });
      await sleep(wait);
      wait = Math.min(30000, wait * 2);
    }
    loop = null;
  }
  function watch(on) {
    watching = Math.max(0, watching + (on ? 1 : -1));
    if (watching > 0 && !loop) loop = stream();
    if (watching === 0) { try { ctl?.abort(); } catch {} }
    return { ok: true, watching };
  }
  // Settings › Accounts: his host and key for another device (null clears them; this PC then uses connect.json).
  async function setKey(key) {
    if (!secrets) return fail('Keys can\'t be saved here.');
    if (key === null || key === '') { secrets.remove(KEY); cache = null; return { ok: true, removed: true }; }
    const k = String(key || '').trim();
    if (!k || k.length > 500 || /[\s\0-\x1f]/.test(k)) return fail('That key doesn\'t look right (no spaces, up to 500 characters).');
    await secrets.set(KEY, k);
    cache = null;
    return { ok: true };
  }
  async function test() {
    const h = await hello();
    if (!h.ok) return h;
    const st = await status({ fresh: true });
    if (!st.online) return fail(st.message, st.kind);
    return { ok: true, message: `Connected to ${h.name}${h.version ? ` (Hearth AI ${h.version})` : ''}: ${st.available.label}.`, status: st };
  }
  return { conn, hello, status, talk, startTask, getTask, runTask, avatar, watch, setKey, test, hasKey: () => Boolean(secrets?.has?.(KEY)), _parseSse: parseSse };
}

module.exports = { createIthil, cleanSettings, mergeSettings, limitHit, availability, normStatus, PORT, KEY };

// Scheduled tasks: run a chat prompt later, or daily, weekly or on a simple cron line,
// while the app is running. Off until the owner creates one: no file, nothing runs.
// Stored in <data>/schedules.json (atomic, .bak, never overwritten when unreadable).
// The clock is injectable so the timing is tested with a fake clock.
const crypto = require('node:crypto');
const { createJsonFile } = require('./jsonfile.cjs');

const KINDS = ['once', 'daily', 'weekly', 'cron'];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// "m h dom mon dow" with *, numbers, lists, ranges and */n.
function cronField(spec, min, max) {
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const m = part.match(/^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/);
    if (!m) return null;
    const step = m[4] ? Number(m[4]) : 1;
    const a = m[1] === '*' ? min : Number(m[2]);
    const b = m[1] === '*' ? max : m[3] ? Number(m[3]) : (m[4] ? max : a);
    if (a < min || b > max || a > b || step < 1) return null;
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}
function parseCron(line) {
  const f = String(line || '').trim().split(/\s+/);
  if (f.length !== 5) return null;
  const r = [cronField(f[0], 0, 59), cronField(f[1], 0, 23), cronField(f[2], 1, 31), cronField(f[3], 1, 12), cronField(f[4], 0, 6)];
  return r.some((x) => !x) ? null : { min: r[0], hour: r[1], dom: r[2], mon: r[3], dow: r[4] };
}

// The next time (ms) strictly after `from` (local time), or null.
function nextRun(t, from) {
  const d = new Date(from);
  if (t.kind === 'once') { const at = Date.parse(t.at); return Number.isFinite(at) && !t.lastRun ? at : null; }
  if (t.kind === 'daily' || t.kind === 'weekly') {
    const m = String(t.time || '').match(TIME_RE);
    if (!m) return null;
    const days = t.kind === 'weekly' ? (Array.isArray(t.days) && t.days.length ? t.days : [1]) : [0, 1, 2, 3, 4, 5, 6];
    for (let i = 0; i <= 7; i++) {
      const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, Number(m[1]), Number(m[2]), 0, 0);
      if (c.getTime() > from && days.includes(c.getDay())) return c.getTime();
    }
    return null;
  }
  if (t.kind === 'cron') {
    const c = parseCron(t.cron);
    if (!c) return null;
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes() + 1, 0, 0);
    for (let i = 0; i < 366 * 24 * 60; i++) {
      if (c.min.has(x.getMinutes()) && c.hour.has(x.getHours()) && c.dom.has(x.getDate()) && c.mon.has(x.getMonth() + 1) && c.dow.has(x.getDay())) return x.getTime();
      x.setMinutes(x.getMinutes() + 1);
    }
    return null;
  }
  return null;
}

function cleanSpec(s, nowMs) {
  if (!s || typeof s !== 'object') throw new Error('bad task');
  const kind = KINDS.includes(s.kind) ? s.kind : null;
  if (!kind) throw new Error('Pick when it runs.');
  const prompt = String(s.prompt || '').trim().slice(0, 4000);
  if (!prompt) throw new Error('Type what the team should do.');
  const chatId = String(s.chatId || '');
  if (!/^(c[0-9a-f]{10}|team-[a-z0-9]{3,16})$/.test(chatId)) throw new Error('Pick a chat for the results.');
  const t = { kind, prompt, chatId, title: String(s.title || prompt).slice(0, 80) };
  if (kind === 'once') { const at = Date.parse(s.at); if (!Number.isFinite(at)) throw new Error('Pick a date and time.'); if (at <= nowMs) throw new Error('That time has already passed.'); t.at = new Date(at).toISOString(); }
  if (kind === 'daily' || kind === 'weekly') { if (!TIME_RE.test(String(s.time || ''))) throw new Error('Pick a time like 09:00.'); t.time = s.time; }
  if (kind === 'weekly') { t.days = [...new Set((Array.isArray(s.days) ? s.days : []).map(Number).filter((n) => n >= 0 && n <= 6))].sort(); if (!t.days.length) throw new Error('Pick at least one day.'); }
  if (kind === 'cron') { if (!parseCron(s.cron)) throw new Error('That cron line isn\'t valid (5 fields: minute hour day month weekday).'); t.cron = String(s.cron).trim(); }
  return t;
}

function createScheduler({ file, now = () => Date.now(), run }) {
  const f = createJsonFile(file, { empty: () => ({ version: 1, tasks: [] }), check: (j) => Array.isArray(j.tasks), label: 'Your scheduled tasks file' });
  const running = new Set();
  const list = () => f.read().tasks.map((t) => ({ ...t, running: running.has(t.id) }));
  const save = (tasks) => f.write({ version: 1, tasks });
  function add(spec) {
    const t = { id: `s${crypto.randomBytes(5).toString('hex')}`, ...cleanSpec(spec, now()), enabled: true, createdAt: new Date(now()).toISOString(), lastRun: null, lastResult: null };
    t.nextRun = nextRun(t, now());
    save([...f.read().tasks, t]);
    return t;
  }
  function update(id, patch = {}) {
    const tasks = f.read().tasks.map((t) => ({ ...t }));
    const t = tasks.find((x) => x.id === id);
    if (!t) throw new Error('Not found.');
    if ('enabled' in patch) t.enabled = patch.enabled === true;
    if (patch.spec) Object.assign(t, cleanSpec({ ...t, ...patch.spec }, now()), { lastRun: null });
    t.nextRun = t.enabled ? nextRun(t, now()) : null;
    save(tasks);
    return t;
  }
  function remove(id) { save(f.read().tasks.filter((t) => t.id !== id)); return { ok: true }; }
  // Due tasks run once each; one that can't start now (its chat is busy) tries again next tick.
  async function tick() {
    const t0 = now();
    const due = f.read().tasks.filter((t) => t.enabled && Number.isFinite(t.nextRun) && t.nextRun <= t0 && !running.has(t.id));
    const started = [];
    for (const t of due) {
      running.add(t.id);
      let r;
      try { r = await run(t); } catch (e) { r = { ok: false, message: String(e.message || e) }; }
      running.delete(t.id);
      if (r && r.retry) continue;
      const tasks = f.read().tasks.map((x) => ({ ...x }));
      const cur = tasks.find((x) => x.id === t.id);
      if (!cur) continue;
      cur.lastRun = new Date(t0).toISOString();
      cur.lastResult = r?.ok ? 'ok' : String(r?.message || 'failed').slice(0, 200);
      cur.nextRun = cur.kind === 'once' ? null : nextRun(cur, Math.max(now(), t0));
      if (cur.kind === 'once') cur.enabled = false;
      save(tasks);
      started.push(t.id);
    }
    return started;
  }
  let timer = null;
  return {
    list, add, update, remove, tick, file: f.file, broken: () => f.broken(),
    start(ms = 30000) { if (!timer) { timer = setInterval(() => { if (f.read().tasks.length) tick(); }, ms); timer.unref?.(); } },
    stop() { clearInterval(timer); timer = null; },
  };
}

module.exports = { createScheduler, nextRun, parseCron, cleanSpec, KINDS };

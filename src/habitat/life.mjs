// Habitat life: day and night, weather, the saved Habitat progress (garden,
// trophies, per-AI achievements and unlocked props), moods, desk lights and the
// visits that mirror real hand-offs. Pure functions only (no DOM), unit tested.
//
// Everything here is driven by real app state (tasks, test and CI results);
// nothing is random judgement shown as fact. Saved progress only ever changes
// because of a real task event or an owner action (rearrange, rename, reset).

import { T } from './world.mjs';

// ---------- day and night ----------
// Soft, stepwise lighting from the local clock (no animated transitions).
export function lightAt(date = new Date(), { dark = true } = {}) {
  const h = date.getHours() + date.getMinutes() / 60;
  const k = dark ? 1 : 0.7; // light themes get a gentler tint
  if (h >= 21 || h < 5.5) return { phase: 'night', tint: `rgba(18,26,66,${(0.34 * k).toFixed(3)})`, lamps: true, stars: true, sky: '#18224a' };
  if (h < 7.5) return { phase: 'dawn', tint: `rgba(255,170,130,${(0.10 * k).toFixed(3)})`, lamps: true, stars: false, sky: '#f2b48f' };
  if (h < 18) return { phase: 'day', tint: null, lamps: false, stars: false, sky: '#9fd4f2' };
  return { phase: 'dusk', tint: `rgba(120,70,140,${(0.16 * k).toFixed(3)})`, lamps: true, stars: false, sky: '#c27a8e' };
}

// ---------- weather ----------
export function hashStr(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

// One cosmetic shower a day at most, seeded by the date: same day, same weather.
export function weatherFor(date = new Date()) {
  const h = hashStr(`weather:${dayKey(date)}`);
  const roll = h % 100;
  if (roll >= 30) return { kind: 'clear', from: 0, to: 0 };
  const month = date.getMonth();
  const cold = month === 11 || month <= 1 || (month === 10 && roll % 2 === 0);
  const from = 6 + ((h >>> 8) % 14); // starts between 6:00 and 19:00
  const len = 2 + ((h >>> 16) % 4); // lasts 2-5 hours
  return { kind: cold ? 'snow' : 'rain', from, to: Math.min(24, from + len) };
}
export function weatherAt(date = new Date(), { reduced = false } = {}) {
  if (reduced) return 'clear';
  const w = weatherFor(date);
  const h = date.getHours();
  return w.kind !== 'clear' && h >= w.from && h < w.to ? w.kind : 'clear';
}

// ---------- saved Habitat progress ----------
export const STORE_V = 1;
export const UNLOCK_EVERY = 5; // a new room prop for every 5 tasks an AI finishes
export const PROP_POOL = ['fern', 'globe', 'radio', 'teapot', 'easel', 'fishbowl', 'cushion', 'lantern'];
export const MAX_COUNTED = 600;
export const MAX_SEEN = 400;
export const TROPHIES = [
  { id: 'first-merge', label: 'First merge', test: (s) => s.merged },
  { id: 'done-10', label: '10 tasks done', test: (s) => s.finished >= 10 },
  { id: 'done-50', label: '50 tasks done', test: (s) => s.finished >= 50 },
  { id: 'done-100', label: '100 tasks done', test: (s) => s.finished >= 100 },
  { id: 'clean-week', label: 'A week with no failed tests or CI', test: (s, now) => Boolean(s.cleanSince) && now - Date.parse(s.cleanSince) >= 7 * 864e5 },
];
export const ACHIEVEMENTS = [
  { id: 'first-task', label: 'First task done', test: (a) => a.done >= 1 },
  { id: 'five-tasks', label: '5 tasks done', test: (a) => a.done >= 5 },
  { id: 'quarter', label: '25 tasks done', test: (a) => a.done >= 25 },
  { id: 'approved', label: 'First approval', test: (a) => a.approvals >= 1 },
  { id: 'ten-approved', label: '10 approvals', test: (a) => a.approvals >= 10 },
];
const HANDOFF_REASONS = new Set(['limit', 'outage', 'crash', 'interrupted', 'error', 'auth', 'timeout']);

const int = (v, lo = 0, hi = 1e9) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.floor(Number(v)))) : lo);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

export const JOURNAL_MAX = 50; // entries kept per AI
export const RUG_STYLES = ['stripes', 'round', 'diamond'];
export const RELIEF_CAP = 2; // watering eases wilting by at most this many steps

export function emptyStore() {
  return {
    v: STORE_V, rev: 0, finished: 0, growth: 0, counted: [], merged: false, failStreak: 0, relief: 0, seen: {}, trophies: {}, ai: {}, pet: { name: '' }, cleanSince: null,
    locks: {}, lockAll: false, board: {}, journal: {}, life: emptyLife(),
  };
}
export function emptyLife() { return { rate: {}, watered: {}, look: {}, undo: {}, events: [], jnotes: {} }; }
// Short printable text: no markup, no control characters, one line.
export function cleanText(s, n = 200) {
  const t = String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f<>`*_#|\[\]{}\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}
function normAi(a) {
  const o = isObj(a) ? a : {};
  const props = Array.isArray(o.props) ? o.props.filter((p) => isObj(p) && PROP_POOL.includes(p.kind)).map((p) => ({ kind: p.kind, x: int(p.x, 0, 5), y: int(p.y, 0, 3), ...(p.owner === true ? { owner: true } : {}) })) : [];
  const used = new Set(props.map((p) => p.kind));
  const stored = Array.isArray(o.stored) ? [...new Set(o.stored.filter((k) => PROP_POOL.includes(k) && !used.has(k)))] : [];
  const ach = isObj(o.ach) ? Object.fromEntries(Object.entries(o.ach).filter(([k, v]) => ACHIEVEMENTS.some((x) => x.id === k) && iso(v))) : {};
  const out = { done: int(o.done), fails: int(o.fails), handoffs: int(o.handoffs), approvals: int(o.approvals), lastApproval: iso(o.lastApproval), props, stored, ach };
  if (typeof o.plate === 'string' && cleanText(o.plate, 24)) out.plate = cleanText(o.plate, 24);
  if (Number.isInteger(o.rug) && o.rug >= 0 && o.rug < RUG_STYLES.length) out.rug = o.rug;
  if (o.lamp === 'on' || o.lamp === 'off') out.lamp = o.lamp;
  return out;
}
export const blankAi = () => normAi({});
function normLife(l) {
  const o = isObj(l) ? l : {};
  const map = (v, f) => (isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, f(x)]).filter(([, x]) => x != null)) : {});
  return {
    rate: map(o.rate, (v) => (Array.isArray(v) ? v.filter((n) => Number.isFinite(n)).slice(-60) : null)),
    watered: map(o.watered, (v) => (typeof v === 'string' ? v : null)),
    look: map(o.look, (v) => (v === true ? true : null)),
    undo: map(o.undo, (v) => (isObj(v) && isObj(v.before) ? { label: String(v.label || ''), at: iso(v.at), before: v.before, undone: v.undone === true } : null)),
    events: Array.isArray(o.events) ? o.events.filter((e) => isObj(e) && typeof e.id === 'string' && Number.isFinite(e.at)).slice(-30) : [],
    jnotes: map(o.jnotes, (v) => (isObj(v) && typeof v.day === 'string' ? { day: v.day, n: int(v.n, 0, 99) } : null)),
  };
}
// One dated line in an AI's Habitat journal (newest last, capped).
export function addJournal(s, id, text, at = Date.now()) {
  if (!id || !text) return;
  const list = (s.journal[id] ||= []);
  list.push({ at: new Date(at).toISOString(), text: cleanText(text, 220) });
  if (list.length > JOURNAL_MAX) list.splice(0, list.length - JOURNAL_MAX);
}
// Missing or older saves become a clean, valid store; known fields keep their values.
export function migrateStore(raw) {
  const s = emptyStore();
  if (!isObj(raw)) return s;
  s.finished = int(raw.finished);
  s.growth = int(raw.growth, 0, s.finished);
  s.counted = Array.isArray(raw.counted) ? raw.counted.filter((x) => typeof x === 'string').slice(-MAX_COUNTED) : [];
  s.merged = raw.merged === true;
  s.failStreak = int(raw.failStreak, 0, 99);
  s.seen = isObj(raw.seen) ? Object.fromEntries(Object.entries(raw.seen).filter(([, v]) => isObj(v)).slice(-MAX_SEEN).map(([k, v]) => [k, { t: String(v.t || ''), c: String(v.c || ''), a: String(v.a || ''), s: String(v.s || ''), m: v.m === true }])) : {};
  s.trophies = isObj(raw.trophies) ? Object.fromEntries(Object.entries(raw.trophies).filter(([k, v]) => TROPHIES.some((x) => x.id === k) && iso(v))) : {};
  s.ai = isObj(raw.ai) ? Object.fromEntries(Object.entries(raw.ai).map(([k, v]) => [k, normAi(v)])) : {};
  s.pet = { name: typeof raw.pet?.name === 'string' ? raw.pet.name.slice(0, 24) : '' };
  s.cleanSince = iso(raw.cleanSince);
  s.rev = int(raw.rev);
  s.relief = int(raw.relief, 0, Math.min(RELIEF_CAP, s.failStreak));
  s.locks = isObj(raw.locks) ? Object.fromEntries(Object.entries(raw.locks).filter(([, v]) => v === true)) : {};
  s.lockAll = raw.lockAll === true;
  s.board = isObj(raw.board) ? Object.fromEntries(Object.entries(raw.board).filter(([, v]) => isObj(v) && cleanText(v.text, 120)).map(([k, v]) => [k, { text: cleanText(v.text, 120), at: iso(v.at) || new Date(0).toISOString() }])) : {};
  s.journal = isObj(raw.journal) ? Object.fromEntries(Object.entries(raw.journal).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.filter((e) => isObj(e) && iso(e.at) && typeof e.text === 'string').map((e) => ({ at: e.at, text: cleanText(e.text, 220) })).slice(-JOURNAL_MAX)])) : {};
  s.life = normLife(raw.life);
  return s;
}
const aiOf = (s, id) => (s.ai[id] ||= normAi({}));
const seenOf = (t) => ({ t: t.tests || '', c: t.ci || '', a: t.assignee || '', s: t.stage || '', m: Boolean(t.merged) });

// The owner's reset: a clean store where today's tasks are the baseline, so the
// garden and trophies start again from zero instead of regrowing from history.
export function resetStore(tasks = [], now = Date.now()) {
  const s = emptyStore();
  for (const t of tasks) {
    if (!t?.id) continue;
    if (t.stage === 'approved') s.counted.push(t.id);
    s.seen[t.id] = seenOf(t);
  }
  s.cleanSince = new Date(now).toISOString();
  return s;
}

// Fold the app's real task state into the saved progress. Idempotent: running it
// twice on the same tasks changes nothing. Tasks it has never seen are a
// baseline (no penalties for history); a finished task is counted exactly once.
// tasks: [{ id, stage, assignee, tests, ci, merged, updatedAt, runs: [{ a, s }] }]
export function reconcile(store, tasks = [], now = Date.now()) {
  const s = migrateStore(store);
  const before = JSON.stringify(s);
  const counted = new Set(s.counted);
  const nowIso = new Date(now).toISOString();
  if (!s.cleanSince) s.cleanSince = nowIso;
  const growthCap = gardenCap();
  for (const t of tasks) {
    if (!t?.id) continue;
    const prev = s.seen[t.id];
    const who = t.assignee || '';
    if (t.stage === 'approved' && !counted.has(t.id)) {
      counted.add(t.id); s.counted.push(t.id);
      if (t.merged) s.merged = true;
      s.finished += 1;
      s.growth = Math.min(growthCap, s.growth + 1);
      if (who) {
        const a = aiOf(s, who);
        a.done += 1; a.approvals += 1; a.handoffs = 0;
        const at = iso(t.updatedAt) || nowIso;
        if (!a.lastApproval || Date.parse(at) > Date.parse(a.lastApproval)) a.lastApproval = at;
      }
    }
    if (prev) {
      if (t.merged && !prev.m) s.merged = true;
      for (const [field, val] of [['t', t.tests], ['c', t.ci]]) {
        const v = val || '';
        if (v === prev[field] || !v) continue;
        if (v === 'failed') { s.failStreak = Math.min(99, s.failStreak + 1); s.cleanSince = nowIso; if (who) aiOf(s, who).fails += 1; }
        if (v === 'passed') { s.failStreak = 0; s.relief = 0; if (who) aiOf(s, who).fails = 0; }
      }
      if (prev.a && who && prev.a !== who && t.stage !== 'approved') {
        const last = [...(t.runs || [])].reverse().find((r) => r.a === prev.a);
        if (last && HANDOFF_REASONS.has(last.s)) aiOf(s, prev.a).handoffs += 1;
      }
    }
    s.seen[t.id] = seenOf(t);
  }
  // Keep the saved lists small: forget the oldest entries first.
  if (s.counted.length > MAX_COUNTED) s.counted = s.counted.slice(-MAX_COUNTED);
  const keys = Object.keys(s.seen);
  if (keys.length > MAX_SEEN) {
    const live = new Set(tasks.map((t) => t.id));
    const drop = keys.filter((k) => !live.has(k)).slice(0, keys.length - MAX_SEEN);
    for (const k of drop) delete s.seen[k];
  }
  for (const tr of TROPHIES) if (!s.trophies[tr.id] && tr.test(s, now)) s.trophies[tr.id] = nowIso;
  for (const [id, a] of Object.entries(s.ai)) for (const x of ACHIEVEMENTS) if (!a.ach[x.id] && x.test(a)) { a.ach[x.id] = nowIso; addJournal(s, id, `earned medal: ${x.label}`, now); }
  return { store: s, changed: JSON.stringify(s) !== before };
}

// ---------- garden ----------
export const GARDEN_STAGES = 3;
export const GARDEN_PLANTS = 15;
export const gardenCap = () => GARDEN_PLANTS * GARDEN_STAGES;
// Growth points spread over the beds one stage at a time, in a fixed order.
export function gardenState(store, plants = GARDEN_PLANTS) {
  const g = Math.min(int(store?.growth), plants * GARDEN_STAGES);
  const stages = Array.from({ length: plants }, (_, i) => Math.min(GARDEN_STAGES, Math.floor(g / plants) + (i < g % plants ? 1 : 0)));
  const streak = Math.max(0, int(store?.failStreak) - int(store?.relief));
  return { stages, wilt: streak >= 4 ? 2 : streak >= 2 ? 1 : 0 };
}

// ---------- unlocked room props ----------
export const unlockedCount = (done) => Math.min(PROP_POOL.length, Math.floor(int(done) / UNLOCK_EVERY));

// Room-local tiles (lx 0..5, ly 0..3) that are taken by built-in furniture.
function blockedLocal(room) {
  const loc = (p) => roomLocal(room, p);
  const b = new Set([...room.props.map(loc), ...room.bed.map(loc)].map(({ x, y }) => `${x},${y}`));
  b.add('2,3'); // the tile just inside the door stays free
  return b;
}
export function roomLocal(room, p) { return { x: p.x - room.x0, y: room.side === 'top' ? p.y - room.y0 : room.y0 + 3 - p.y }; }
export function roomGlobal(room, l) { return { x: room.x0 + l.x, y: room.side === 'top' ? room.y0 + l.y : room.y0 + 3 - l.y }; }

// Can prop #idx stand on local tile (lx, ly)? It must be a free tile and keep
// every other free tile of the room reachable from the door.
export function canPlace(room, props, idx, lx, ly) {
  if (lx < 0 || ly < 0 || lx > 5 || ly > 3) return false;
  const blocked = blockedLocal(room);
  props.forEach((p, i) => { if (i !== idx) blocked.add(`${p.x},${p.y}`); });
  const k = `${lx},${ly}`;
  if (blocked.has(k)) return false;
  // The rug's middle spot is where its owner sits.
  const rug = roomLocal(room, room.rugSpot);
  if (rug.x === lx && rug.y === ly) return false;
  blocked.add(k);
  const free = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) if (!blocked.has(`${x},${y}`)) free.push(`${x},${y}`);
  const seen = new Set(['2,3']);
  const q = [[2, 3]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx; const ny = y + dy; const nk = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx > 5 || ny > 3 || seen.has(nk) || blocked.has(nk)) continue;
      seen.add(nk); q.push([nx, ny]);
    }
  }
  return free.every((f) => seen.has(f));
}
const SLOT_ORDER = [[1, 0], [2, 0], [4, 0], [4, 3], [0, 1], [5, 2], [0, 2], [3, 3], [1, 3], [5, 3], [0, 3], [3, 0], [4, 1], [4, 2]];
export function defaultSlot(room, props) {
  for (const [x, y] of SLOT_ORDER) if (canPlace(room, props, -1, x, y)) return { x, y };
  return null;
}
// New props for AIs that reached the next threshold. Placed once, then they stay
// where they are (or where the owner moved them).
export function applyUnlocks(store, world) {
  const s = migrateStore(store);
  let changed = false;
  for (const room of world.rooms) {
    const a = s.ai[room.id];
    if (!a) continue;
    const want = unlockedCount(a.done);
    while (a.props.length + a.stored.length < want) {
      const used = new Set([...a.props.map((p) => p.kind), ...a.stored]);
      const start = hashStr(room.id) % PROP_POOL.length;
      let kind = null;
      for (let i = 0; i < PROP_POOL.length && !kind; i++) { const k = PROP_POOL[(start + i) % PROP_POOL.length]; if (!used.has(k)) kind = k; }
      const at = kind && defaultSlot(room, a.props);
      if (!at) break;
      a.props.push({ kind, ...at });
      addJournal(s, room.id, `unlocked ${kind} for ${(a.props.length + a.stored.length) * UNLOCK_EVERY} tasks`);
      changed = true;
    }
  }
  return { store: s, changed };
}
export function layoutOf(store) {
  return Object.fromEntries(Object.entries(store?.ai || {}).map(([id, a]) => [id, a.props || []]));
}

// ---------- mood, desk lights ----------
// Tired: two or more test/CI failures in a row on its tasks, or two or more
// hand-offs after a limit or crash since it last finished a task.
// Pleased: one of its tasks was approved in the last 12 hours.
export function moodOf(ai, now = Date.now()) {
  if (!ai) return null;
  if (int(ai.fails) >= 2 || int(ai.handoffs) >= 2) return 'tired';
  if (ai.lastApproval && now - Date.parse(ai.lastApproval) < 12 * 3600e3 && now >= Date.parse(ai.lastApproval)) return 'pleased';
  return null;
}
export const MOOD_SPEED = { tired: 0.6, pleased: 1.1 };

// light: { running, tests, ci } of the AI's current task.
export function deskLight(cur) {
  if (!cur) return null;
  if (cur.ci === 'failed' || cur.tests === 'failed') return 'red';
  if (cur.running || cur.ci === 'pending') return 'amber';
  if (cur.tests === 'passed' || cur.ci === 'passed') return 'green';
  return null;
}
// CI state for a task from snap.ops when the team-ops branch provides it.
export function opsCi(ops, id) {
  if (!ops || !id) return '';
  const v = ops.ci?.[id] ?? ops.tasks?.[id]?.ci ?? (Array.isArray(ops.ci) ? ops.ci.find((c) => c?.taskId === id) : null);
  const st = typeof v === 'string' ? v : v?.state || v?.status || v?.conclusion || '';
  if (/fail|error|red/i.test(st)) return 'failed';
  if (/pend|run|queue|progress|amber/i.test(st)) return 'pending';
  if (/pass|success|ok|green/i.test(st)) return 'passed';
  return '';
}

// ---------- visits that mirror real work ----------
// Compares two consecutive task snapshots from this session.
export function visitsFrom(prev = [], next = []) {
  const before = new Map(prev.map((t) => [t.id, t]));
  const out = [];
  for (const t of next) {
    const p = before.get(t.id);
    if (!p) continue;
    if (p.stage !== 'review' && t.stage === 'review' && t.assignee && t.reviewer && t.assignee !== t.reviewer) out.push({ kind: 'review-visit', from: t.assignee, to: t.reviewer, task: t.id });
    if (p.stage !== 'approved' && t.stage === 'approved') {
      out.push({ kind: 'stamp', who: t.assignee, task: t.id });
      if (t.assignee) out.push({ kind: 'coffee', who: t.assignee, task: t.id });
    }
    if (p.assignee && t.assignee && p.assignee !== t.assignee && t.stage !== 'approved') out.push({ kind: 'handover', from: p.assignee, to: t.assignee, task: t.id });
  }
  return out;
}
// How an event plays: walking and flying papers only when motion is allowed.
export function effectFor(ev, { reduced = false } = {}) {
  if (ev.kind === 'review-visit') return { walk: !reduced, paperAt: reduced ? ev.to : null, ttl: 8 };
  if (ev.kind === 'stamp') return { anim: !reduced, ttl: reduced ? 6 : 2.4 };
  if (ev.kind === 'handover') return { fly: !reduced, ttl: reduced ? 6 : 1.6 };
  if (ev.kind === 'coffee') return { walk: !reduced };
  return {};
}

// ---------- pet ----------
// The busiest AI: working right now counts most, then its open tasks.
export function busiestAi(agents = []) {
  let best = null; let score = 0;
  for (const a of agents) {
    if (a.status === 'out' || a.status === 'hold' || a.status === 'signedout') continue;
    const sc = (a.task ? 3 : 0) + (a.reviewing ? 2 : 0) + int(a.open);
    if (sc > score) { score = sc; best = a.id; }
  }
  return score >= 3 ? best : null;
}
// The warmest rug the pet can reach: the kitchen rug by the heater, then rooms
// with a lit lamp at night, then any open room's rug.
export function warmestRug(world, { lamps = false, closed = new Set() } = {}) {
  let best = world.kitchen ? { spot: world.kitchen.rugSpot, warmth: 3, where: 'kitchen' } : null;
  for (const r of world.rooms) {
    if (closed.has(r.id)) continue;
    const warmth = lamps && r.props.some((p) => p.kind === 'lamp') ? 4 : 1;
    if (!best || warmth > best.warmth) best = { spot: r.rugSpot, warmth, where: r.id };
  }
  return best;
}
export function petGoal(world, { busiest = null, lamps = false, closed = new Set() } = {}) {
  if (busiest) {
    const d = world.desks.find((x) => x.id === busiest);
    if (d) return { spot: { x: d.seat.x - 1, y: d.seat.y }, pose: 'sit', follow: busiest };
  }
  const rug = warmestRug(world, { lamps, closed });
  return { spot: rug?.spot || { x: 1, y: 7 }, pose: 'nap', follow: null };
}

// ---------- message board ----------
const clean = (s) => String(s || '').replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();
// pins: { [aiId]: { text, at } } notes the AIs pinned (HABITAT: note), shown first.
export function boardNotes(chat = [], tasks = [], pins = {}) {
  const notes = Object.entries(pins || {}).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 3).map(([who, p]) => ({ kind: 'pin', id: `pin-${who}`, who, text: p.text }));
  for (const m of [...chat].reverse()) {
    if (notes.length >= 3) break;
    const text = clean(m?.text).split(/(?<=[.!?])\s/)[0];
    if (!text || m.who === 'system') continue;
    notes.push({ kind: 'chat', id: m.id, who: m.who, text });
  }
  if (notes.length < 3) {
    for (const t of [...tasks].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))) {
      if (notes.length >= 3) break;
      if (t?.title) notes.push({ kind: 'task', id: t.id, text: clean(t.title) });
    }
  }
  return notes.slice(0, 3);
}
// Pixel-font-safe short text: A-Z 0-9 - . and spaces, cut to n characters.
export function noteText(s, n = 12) {
  const t = String(s || '').toUpperCase().replace(/[^A-Z0-9 .-]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}.` : t;
}

// Every walkable tile of a world (for tests and the pet's wandering).
export function walkableTiles(world) {
  const out = [];
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) if ([T.FLOOR, T.ROOM, T.KITCHEN, T.PATH, T.DOOR].includes(world.grid[y][x])) out.push({ x, y });
  return out;
}

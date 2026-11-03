// AIs acting in their Habitat: HABITAT: lines in team chat replies. Pure
// functions only (no DOM), unit tested. Everything here is cosmetic and Routine
// (no approval card): it only ever changes the AI's own room, its board note,
// its journal and a small, capped garden watering. Every change is audited by
// the caller and can be undone by the owner (the last one per AI).
import { buildWorld, roomOf, behaviourOf } from './world.mjs';
import { migrateStore, applyUnlocks, layoutOf, canPlace, roomLocal, gardenState, cleanText, addJournal, blankAi, dayKey, PROP_POOL, RUG_STYLES, RELIEF_CAP, ACHIEVEMENTS, GARDEN_STAGES } from './life.mjs';
import { aliasOf } from '../registry.mjs';

export const MAX_PER_TURN = 5;
export const MAX_PER_HOUR = 30;
export const NOTE_MAX = 80;
export const PLATE_MAX = 24;
export const JOURNAL_NOTE_MAX = 200;
export const JOURNAL_NOTES_PER_DAY = 3;
export const SUMMARY_MAX = 300;
export const EMOTES = ['happy', 'thinking', 'tired', 'celebrate'];
export const PLACES = { desk: 'desk', room: 'room', 'break room': 'kitchen', breakroom: 'kitchen', kitchen: 'kitchen', garden: 'garden', courtyard: 'garden', hall: 'hall' };
export const LOCAL_ACTIONS = ['look', 'emote', 'note'];
const ALIASES = { lamp: 'lantern', plant: 'fern', fish: 'fishbowl', bowl: 'fishbowl', pillow: 'cushion', tea: 'teapot', painting: 'easel' };
const UNDOABLE = new Set(['place', 'move', 'remove', 'nameplate', 'rug', 'lamp', 'note', 'water']);
const HOUR = 3600e3;

const propKind = (w) => { const k = String(w || '').toLowerCase().replace(/^(a|an|the|my)\s+/, '').trim(); return PROP_POOL.includes(k) ? k : ALIASES[k] || null; };
const xy = (a, b) => ({ x: Number(a), y: Number(b) });
const nameOf = (names, id) => names?.[id] || id;
const article = (k) => (/^[aeiou]/.test(k) ? `an ${k}` : `a ${k}`);

// ---------- parsing ----------
// One entry per HABITAT: line, in order. Unknown commands come back as { cmd: 'unknown' }.
export function parseHabitatLines(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/^[\s*\-•`>]+/, '').replace(/[*`]+$/g, '').trim();
    const m = line.match(/^HABITAT:\s*(.*)$/i);
    if (!m) continue;
    const body = m[1].trim();
    const shown = `HABITAT: ${body}`.slice(0, 140);
    out.push({ line: shown, ...parseOne(body) });
  }
  return out;
}
function parseOne(body) {
  const b = body.replace(/[.!]+$/, '').trim();
  let m;
  if (/^look$/i.test(b)) return { cmd: 'look' };
  if ((m = b.match(/^place\s+(.+?)\s+(?:at\s+)?(-?\d+)\s*,\s*(-?\d+)$/i))) return { cmd: 'place', prop: m[1], ...xy(m[2], m[3]) };
  if ((m = b.match(/^move\s+(.+?)\s+(?:to\s+)?(-?\d+)\s*,\s*(-?\d+)$/i))) return { cmd: 'move', prop: m[1], ...xy(m[2], m[3]) };
  if ((m = b.match(/^remove\s+(.+)$/i))) return { cmd: 'remove', prop: m[1] };
  if ((m = b.match(/^nameplate\s+(.+)$/i))) return { cmd: 'nameplate', text: body.replace(/^nameplate\s+/i, '') };
  if ((m = b.match(/^rug\s+(\S+)$/i))) return { cmd: 'rug', style: m[1].toLowerCase() };
  if ((m = b.match(/^lamp\s+(on|off)$/i))) return { cmd: 'lamp', on: m[1].toLowerCase() === 'on' };
  if ((m = b.match(/^go\s+(?:to\s+)?(?:the\s+|my\s+)?(.+)$/i))) return { cmd: 'go', place: m[1].toLowerCase().trim() };
  if ((m = b.match(/^coffee\s+with\s+@?(\w+)$/i))) return { cmd: 'coffee', with: m[1] };
  if (/^water(\s+(the\s+)?garden)?$/i.test(b)) return { cmd: 'water' };
  if (/^pet(\s+the\s+pet)?$/i.test(b)) return { cmd: 'pet' };
  if ((m = b.match(/^note\s+(.+)$/i))) return { cmd: 'note', text: body.replace(/^note\s+/i, '') };
  if ((m = b.match(/^wave(?:\s+(?:at|to))?\s+@?(\w+)$/i))) return { cmd: 'wave', to: m[1] };
  if ((m = b.match(/^emote\s+(\w+)$/i))) return { cmd: 'emote', emote: m[1].toLowerCase() };
  if ((m = b.match(/^journal\s+(.+)$/i))) return { cmd: 'journal', text: body.replace(/^journal\s+/i, '') };
  return { cmd: 'unknown' };
}

// The reply text without its HABITAT: lines (they show as ✓/✗ results instead).
export function stripHabitatLines(text) {
  return String(text || '').split('\n').filter((raw) => !/^HABITAT:/i.test(raw.replace(/^[\s*\-•`>]+/, '').trim())).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- applying ----------
function worldFor(s, ids) {
  let world = buildWorld(ids, layoutOf(s));
  const un = applyUnlocks(s, world);
  if (un.changed) { s = un.store; world = buildWorld(ids, layoutOf(s)); }
  return { s, world };
}
const custom = (s, id) => {
  const a = s.ai[id] || {};
  return { ai: { props: (a.props || []).map((p) => ({ ...p })), stored: [...(a.stored || [])], plate: a.plate ?? null, rug: a.rug ?? null, lamp: a.lamp ?? null }, board: s.board[id] ? { ...s.board[id] } : null, relief: s.relief, watered: s.life.watered[id] || null };
};
const roomLocked = (s, id) => s.lockAll === true || s.locks[id] === true;
const isIdle = (a) => a && a.status === 'idle' && !a.task && !a.reviewing;

// store: the saved Habitat store; ids: the Habitat's AIs in order (its rooms);
// agents: the Habitat snapshot's agents ({ id, status, task, reviewing });
// names: id -> display name. Returns a new store plus one result per line.
export function applyHabitatLines(store, { agent, text, ids = [], agents = [], names = {}, now = Date.now(), reduced = false, local = false } = {}) {
  const cmds = parseHabitatLines(text);
  const results = []; const audits = []; const events = [];
  if (!cmds.length) return { store, results, audits, events, changed: false };
  let { s, world } = worldFor(migrateStore(store), ids);
  const before0 = JSON.stringify(s);
  const room = roomOf(world, agent);
  const me = agents.find((a) => a.id === agent);
  const who = nameOf(names, agent);
  const hour = (s.life.rate[agent] || []).filter((t) => t > now - HOUR && t <= now);
  let turn = 0;
  for (const c of cmds) {
    const done = (ok, reason, extra = {}) => { results.push({ ok, line: c.line, reason }); return { ok, reason, ...extra }; };
    if (c.cmd === 'unknown') { done(false, 'unknown Habitat action'); continue; }
    if (local && !LOCAL_ACTIONS.includes(c.cmd)) { done(false, 'the Local AI can only use look, emote and note'); continue; }
    if (turn >= MAX_PER_TURN || hour.length >= MAX_PER_HOUR) { done(false, 'too many Habitat actions'); continue; }
    turn += 1; hour.push(now);
    if (!room) { done(false, 'no room in the Habitat'); continue; }
    const before = custom(s, agent);
    const r = act(s, c, { agent, who, room, me, ids, agents, names, now, world });
    done(r.ok, r.reason);
    if (r.ok) {
      if (UNDOABLE.has(c.cmd)) s.life.undo[agent] = { label: r.label, at: new Date(now).toISOString(), before, undone: false };
      if (r.journal) addJournal(s, agent, r.journal, now);
      if (r.partnerJournal) addJournal(s, r.partnerJournal[0], r.partnerJournal[1], now);
      audits.push({ event: `${who} ${r.label}`, detail: c.line });
      if (r.event) events.push({ id: `${now.toString(36)}-${agent}-${events.length}`, at: now, who: agent, instant: Boolean(reduced), ...r.event });
    } else audits.push({ event: `${who}: Habitat action refused`, detail: `${c.line} — ${r.reason}` });
  }
  s.life.rate[agent] = hour.slice(-MAX_PER_HOUR);
  if (events.length) s.life.events = [...s.life.events, ...events].slice(-30);
  const changed = JSON.stringify(s) !== before0;
  if (changed) s.rev += 1;
  return { store: s, results, audits, events, changed };
}

function act(s, c, { agent, who, room, me, ids, agents, names, now, world }) {
  const a = (s.ai[agent] ||= blankAi());
  const no = (reason) => ({ ok: false, reason });
  const own = () => (roomLocked(s, agent) ? 'the Owner locked this room' : null);
  switch (c.cmd) {
    case 'look':
      s.life.look[agent] = true;
      return { ok: true, reason: 'your next turn gets a description of your room and Habitat presence', label: 'looked around its room' };
    case 'place': case 'move': {
      if (own()) return no(own());
      const kind = propKind(c.prop);
      if (!kind) return no(`${cleanText(c.prop, 30)} is not a room prop`);
      const idx = a.props.findIndex((p) => p.kind === kind);
      if (c.cmd === 'place') {
        if (idx >= 0) return no(`the ${kind} is already placed (use move)`);
        if (!a.stored.includes(kind)) return no(`the ${kind} is not unlocked yet`);
      } else {
        if (idx < 0) return no(a.stored.includes(kind) ? `the ${kind} is not placed (use place)` : `the ${kind} is not unlocked yet`);
        if (a.props[idx].owner) return no(`the Owner placed the ${kind}; only he can free it`);
      }
      if (!Number.isInteger(c.x) || !Number.isInteger(c.y) || c.x < 0 || c.y < 0 || c.x > 5 || c.y > 3) return no('that spot is outside the room (x 0-5, y 0-3)');
      if (!canPlace(room, a.props, idx, c.x, c.y)) return no('that spot is taken or would block the way');
      if (c.cmd === 'place') { a.stored = a.stored.filter((k) => k !== kind); a.props.push({ kind, x: c.x, y: c.y }); } else a.props[idx] = { kind, x: c.x, y: c.y };
      return { ok: true, reason: `${c.cmd === 'place' ? 'placed' : 'moved'} at ${c.x},${c.y}`, label: `${c.cmd === 'place' ? 'placed' : 'moved'} ${article(kind)} in its room`, journal: `${c.cmd === 'place' ? 'placed' : 'moved'} ${kind} ${c.cmd === 'place' ? 'at' : 'to'} ${c.x},${c.y}` };
    }
    case 'remove': {
      if (own()) return no(own());
      const kind = propKind(c.prop);
      const idx = kind ? a.props.findIndex((p) => p.kind === kind) : -1;
      if (idx < 0) return no(kind ? `the ${kind} is not in its room` : `${cleanText(c.prop, 30)} is not a room prop`);
      if (a.props[idx].owner) return no(`the Owner placed the ${kind}; only he can free it`);
      a.props.splice(idx, 1); a.stored.push(kind);
      return { ok: true, reason: 'put away (still unlocked)', label: `put away its ${kind}`, journal: `put away ${kind}` };
    }
    case 'nameplate': {
      if (own()) return no(own());
      const t = cleanText(c.text, PLATE_MAX).replace(/^["']|["']$/g, '').trim();
      if (!t) return no('the nameplate text is empty');
      a.plate = t;
      return { ok: true, reason: `nameplate reads “${t}”`, label: 'changed its nameplate', journal: `named nameplate '${t}'` };
    }
    case 'rug': {
      if (own()) return no(own());
      const i = RUG_STYLES.indexOf(c.style);
      if (i < 0) return no(`rug styles: ${RUG_STYLES.join(', ')}`);
      a.rug = i;
      return { ok: true, reason: `${c.style} rug`, label: `laid a ${c.style} rug`, journal: `chose the ${c.style} rug` };
    }
    case 'lamp': {
      if (own()) return no(own());
      const has = room.props.some((p) => p.kind === 'lamp') || a.props.some((p) => p.kind === 'lantern');
      if (!has) return no('there is no lamp in its room');
      a.lamp = c.on ? 'on' : 'off';
      return { ok: true, reason: `lamp ${a.lamp}`, label: `turned its lamp ${a.lamp}`, journal: `turned the lamp ${a.lamp}` };
    }
    case 'go': {
      const place = PLACES[c.place];
      if (!place) return no('go where? desk, room, break room, garden or hall');
      if (me?.task || me?.reviewing) return no('busy with a task: stays at its desk');
      if (me && me.status !== 'idle') return no('can’t walk around right now');
      return { ok: true, reason: `walking to the ${c.place}`, label: `walked to the ${c.place}`, journal: `went to the ${c.place}`, event: { kind: 'go', place } };
    }
    case 'coffee': {
      const other = aliasOf(c.with);
      if (!other || !ids.includes(other)) return no(`no teammate called ${cleanText(c.with, 20)} in the Habitat`);
      if (other === agent) return no('coffee needs someone else');
      if (me?.task || me?.reviewing || (me && me.status !== 'idle')) return no('busy right now');
      if (!isIdle(agents.find((x) => x.id === other))) return no(`${nameOf(names, other)} isn’t free right now`);
      return { ok: true, reason: `meeting ${nameOf(names, other)} in the break room`, label: `had coffee with ${nameOf(names, other)}`, journal: `had coffee with ${nameOf(names, other)}`, partnerJournal: [other, `had coffee with ${who}`], event: { kind: 'coffee', with: other } };
    }
    case 'water': {
      const day = dayKey(new Date(now));
      if (s.life.watered[agent] === day) return no('already watered the garden today');
      s.life.watered[agent] = day;
      const wilting = gardenState(s).wilt > 0;
      // Watering never adds growth (growth comes only from finished tasks).
      if (wilting && s.relief < RELIEF_CAP && s.relief < s.failStreak) { s.relief += 1; return { ok: true, reason: 'the plants perk up a little', label: 'watered the garden', journal: 'watered the garden', event: { kind: 'water' } }; }
      return { ok: true, reason: wilting ? 'watered (they need passing tests to recover more)' : 'watered (nothing was wilting)', label: 'watered the garden', journal: 'watered the garden', event: { kind: 'water' } };
    }
    case 'pet':
      return { ok: true, reason: `${s.pet.name || 'the pet'} looks happy`, label: `petted ${s.pet.name || 'the pet'}`, journal: `petted ${s.pet.name || 'the pet'}`, event: { kind: 'pet' } };
    case 'note': {
      const t = cleanText(c.text, NOTE_MAX);
      if (!t) return no('the note is empty');
      s.board[agent] = { text: t, at: new Date(now).toISOString() };
      return { ok: true, reason: 'pinned on the hall board', label: 'pinned a note on the board', journal: `left note: ${t}` };
    }
    case 'wave': {
      const other = aliasOf(c.to);
      if (!other || !ids.includes(other) || other === agent) return no(`no teammate called ${cleanText(c.to, 20)} to wave at`);
      return { ok: true, reason: `waved at ${nameOf(names, other)}`, label: `waved at ${nameOf(names, other)}`, event: { kind: 'wave', to: other } };
    }
    case 'emote':
      if (!EMOTES.includes(c.emote)) return no(`emotes: ${EMOTES.join(', ')}`);
      return { ok: true, reason: c.emote, label: `looks ${c.emote === 'celebrate' ? 'like celebrating' : c.emote}`, event: { kind: 'emote', emote: c.emote } };
    case 'journal': {
      const t = cleanText(c.text, JOURNAL_NOTE_MAX);
      if (!t) return no('the journal note is empty');
      const day = dayKey(new Date(now));
      const j = s.life.jnotes[agent]?.day === day ? s.life.jnotes[agent] : { day, n: 0 };
      if (j.n >= JOURNAL_NOTES_PER_DAY) return no(`journal notes are limited to ${JOURNAL_NOTES_PER_DAY} a day`);
      s.life.jnotes[agent] = { day, n: j.n + 1 };
      return { ok: true, reason: 'added to its journal', label: 'wrote in its journal', journal: `note: ${t}` };
    }
    default:
      return no('unknown Habitat action');
  }
}

// ---------- owner tools ----------
// The owner undoes an AI's last Habitat change (room, board note, watering).
export function undoLast(store, agent, now = Date.now(), names = {}) {
  const s = migrateStore(store);
  const u = s.life.undo[agent];
  if (!u || u.undone) return { store: s, ok: false, reason: 'nothing to undo' };
  const b = u.before;
  const a = (s.ai[agent] ||= blankAi());
  a.props = Array.isArray(b.ai?.props) ? b.ai.props.map((p) => ({ ...p })) : a.props;
  a.stored = Array.isArray(b.ai?.stored) ? [...b.ai.stored] : a.stored;
  for (const k of ['plate', 'rug', 'lamp']) { if (b.ai?.[k] == null) delete a[k]; else a[k] = b.ai[k]; }
  if (b.board) s.board[agent] = { ...b.board }; else delete s.board[agent];
  if (Number.isFinite(b.relief)) s.relief = b.relief;
  if (b.watered) s.life.watered[agent] = b.watered; else delete s.life.watered[agent];
  u.undone = true;
  addJournal(s, agent, `the Owner undid: ${u.label}`, now);
  const fixed = migrateStore(s);
  fixed.rev += 1;
  return { store: fixed, ok: true, label: `${nameOf(names, agent)} ${u.label}` };
}
export function setLock(store, id, locked) {
  const s = migrateStore(store);
  if (id === '*') { s.lockAll = Boolean(locked); if (!locked) s.locks = {}; } else if (locked) s.locks[id] = true; else delete s.locks[id];
  s.rev += 1;
  return s;
}
// Lets the AI move props the owner placed again.
export function freeOwnerProps(store, id) {
  const s = migrateStore(store);
  for (const p of s.ai[id]?.props || []) delete p.owner;
  s.rev += 1;
  return s;
}
export function clearBoard(store) { const s = migrateStore(store); s.board = {}; s.rev += 1; return s; }
export function clearJournal(store, id) { const s = migrateStore(store); delete s.journal[id]; delete s.life.jnotes[id]; s.rev += 1; return s; }
export const isLocked = (store, id) => store?.lockAll === true || store?.locks?.[id] === true;

// ---------- what the AI is told ----------
export function relDay(iso, now = Date.now()) {
  const d = new Date(iso); const n = new Date(now);
  const days = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? `${days} days ago` : d.toISOString().slice(0, 10);
}
// A short memory line (under SUMMARY_MAX characters) so the AI knows its room
// without spending a turn on look.
export function habitatSummary(store, agent, now = Date.now()) {
  const s = migrateStore(store);
  const a = s.ai[agent];
  const bits = [];
  const props = (a?.props || []).map((p) => `${p.kind} (${p.x},${p.y})`);
  bits.push(props.length ? `room props ${props.join(', ')}` : 'no props placed yet');
  if (a?.plate) bits.push(`nameplate '${a.plate}'`);
  if (a?.rug != null) bits.push(`${RUG_STYLES[a.rug]} rug`);
  if (a?.lamp) bits.push(`lamp ${a.lamp}`);
  if (a?.stored?.length) bits.push(`${a.stored.length} prop${a.stored.length > 1 ? 's' : ''} unlocked but not placed`);
  if (isLocked(s, agent)) bits.push('room locked by the Owner');
  const last = (s.journal[agent] || []).slice(-1)[0];
  if (last) bits.push(`last: ${cleanText(last.text, 70)} ${relDay(last.at, now)}`);
  let line = `Your Habitat memory: ${bits.join('; ')}.`;
  if (line.length > SUMMARY_MAX) line = `${line.slice(0, SUMMARY_MAX - 1)}…`;
  return line;
}

export function habitatRules({ local = false } = {}) {
  if (local) return 'HABITAT (optional, cosmetic): you have a room in the app\'s Habitat. You may add one line HABITAT: look | HABITAT: emote happy|thinking|tired|celebrate | HABITAT: note <short text>. Never let it interrupt real work.';
  return [
    'HABITAT (optional and cosmetic; never let it interrupt real work): you have your own room in the app\'s Habitat. You may act there by adding lines to your reply:',
    'HABITAT: look | place <prop> at <x>,<y> | move <prop> to <x>,<y> | remove <prop> | nameplate <text> | rug stripes|round|diamond | lamp on|off | journal <short note>',
    'HABITAT: go desk|room|break room|garden|hall | coffee with @name | water garden | pet | note <text for the hall board> | wave @name | emote happy|thinking|tired|celebrate',
    'Only your own room and props you have unlocked; the room must stay walkable. Max 5 Habitat lines per reply and 30 an hour. The Owner can lock rooms, and props he placed stay where he put them.',
  ].join('\n');
}

// Saved actions describe visits even when the canvas is closed. Visits expire
// on the same schedule as the scene; current work/status always takes priority.
export function storedPresence(store, { ids = [], agents = [], now = Date.now() } = {}) {
  const s = migrateStore(store);
  return Object.fromEntries(ids.map((id) => {
    const agent = agents.find((a) => a.id === id);
    const mode = agent ? behaviourOf(agent).mode : 'idle';
    let place = { room: id };
    if (mode === 'desk') place = 'shared workroom';
    if (mode === 'idle') {
      for (const e of s.life.events) {
        if (e.at > now) continue;
        const mine = e.who === id;
        if (e.kind === 'go' && mine) {
          place = now < e.at + 45000
            ? ({ desk: 'shared workroom', room: { room: id }, kitchen: 'break room', garden: 'garden courtyard', hall: 'hall' }[e.place] || place)
            : { room: id };
        } else if (e.kind === 'coffee' && (mine || e.with === id)) {
          place = now < e.at + 40000 ? 'break room' : { room: id };
        } else if (e.kind === 'water' && mine) {
          place = now < e.at + 15000 ? 'garden courtyard' : { room: id };
        }
      }
    }
    return [id, place];
  }));
}

// The full description an AI gets on the turn after HABITAT: look.
export function describeRoom(store, agent, { ids = [], names = {}, now = Date.now(), presence = {}, agents = [] } = {}) {
  const { s, world } = worldFor(migrateStore(store), ids);
  const room = roomOf(world, agent);
  if (!room) return 'HABITAT LOOK: you have no room in the Habitat right now.';
  const a = s.ai[agent] || { props: [], stored: [], ach: {} };
  const loc = (p) => { const l = roomLocal(room, p); return `${l.x},${l.y}`; };
  const free = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) if (canPlace(room, a.props || [], -1, x, y)) free.push(`${x},${y}`);
  const rugL = room.rug.tiles.map((t) => roomLocal(room, t));
  const xs = rugL.map((t) => t.x); const ys = rugL.map((t) => t.y);
  const g = gardenState(s, world.courtyard?.beds.length);
  const grown = g.stages.filter((x) => x >= GARDEN_STAGES).length;
  const medals = ACHIEVEMENTS.filter((x) => a.ach?.[x.id]).map((x) => x.label);
  const locations = { ...storedPresence(s, { ids, agents, now }), ...presence };
  const notes = Object.entries(s.board).map(([id, n]) => `${nameOf(names, id)}: '${n.text}'`);
  const journal = (s.journal[agent] || []).slice(-10);
  return [
    'HABITAT LOOK (you asked with HABITAT: look):',
    `- AI locations: ${ids.map((id) => { const p = locations[id]; return `${nameOf(names, id)}: ${p?.room ? `${nameOf(names, p.room)}’s room` : typeof p === 'string' ? p : 'location unavailable'}`; }).join('; ') || 'unavailable'}.`,
    '- Your room is 6x4 tiles: x 0-5 left to right, y 0-3 from the back wall. The door is at 2,3 and must stay free.',
    `- Built-in furniture (fixed): ${room.props.map((p) => `${p.kind} ${loc(p)}`).join('; ') || 'none'}; bed ${room.bed.map(loc).join(' and ')}; rug ${Math.min(...xs)}-${Math.max(...xs)},${Math.min(...ys)}-${Math.max(...ys)} (${RUG_STYLES[a.rug ?? room.rug.style]}), its middle ${loc(room.rugSpot)} stays free.`,
    `- Your props: ${(a.props || []).map((p) => `${p.kind} ${p.x},${p.y}${p.owner ? ' (placed by the Owner: fixed)' : ''}`).join('; ') || 'none placed'}.`,
    `- Unlocked but not placed: ${(a.stored || []).join(', ') || 'none'}.`,
    `- Free spots for a prop: ${free.join(' ') || 'none'}.`,
    `- Nameplate: ${a.plate ? `'${a.plate}'` : 'your name'}. Lamp: ${a.lamp || 'automatic (on at night)'}. Room ${isLocked(s, agent) ? 'LOCKED by the Owner (no rearranging)' : 'open for you to arrange'}.`,
    `- Medals: ${medals.join(', ') || 'none yet'}.`,
    `- Garden: ${grown} of ${g.stages.length} plants in full bloom${g.wilt ? `, wilting a little (${s.failStreak} failed results in a row)` : ', healthy'}${s.life.watered[agent] === dayKey(new Date(now)) ? '; you watered it today' : ''}.`,
    `- Pet: ${s.pet.name || 'not named yet'}. Board notes: ${notes.join('; ') || 'none'}.`,
    journal.length ? `- Your journal (latest ${journal.length}):\n${journal.map((e) => `  ${e.at.slice(0, 10)} ${e.text}`).join('\n')}` : '- Your journal is empty.',
  ].join('\n');
}

// What goes at the end of an AI's team chat prompt: the rules (full prompts
// only), its memory line, and the look description if it asked for one.
export function habitatSection(store, { agent, ids = [], names = {}, now = Date.now(), local = false, full = true, presence = {}, agents = [] } = {}) {
  if (!ids.includes(agent)) return { text: '', store, changed: false };
  const s = migrateStore(store);
  const parts = ['', full || local ? habitatRules({ local }) : '', habitatSummary(s, agent, now)];
  let changed = false;
  if (s.life.look[agent]) {
    parts.push(describeRoom(s, agent, { ids, names, now, presence, agents }));
    delete s.life.look[agent];
    s.rev += 1;
    changed = true;
  }
  return { text: parts.filter((p, i) => i === 0 || p).join('\n'), store: changed ? s : store, changed };
}


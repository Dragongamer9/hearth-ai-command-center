// Habitat 3D: the owner's own walk-around avatar and his private room. Pure
// functions (no DOM, no three.js), unit tested.
//
// The owner's study is an annex west of the 2D grid, and the fireside nook is a
// bay in the west wall. Neither exists in the AIs' world map: their tiles are
// outside the grid (or wall tiles in it), so the AIs' pathfinding (world.mjs
// findPath / passable) can never reach them, and HABITAT: actions only ever
// touch the shared Habitat store, never the owner's room (kept in its own saved
// settings). Only the avatar's walkable set below includes them.

import { T, passable as aiPassable } from '../habitat/world.mjs';
import { PROP_POOL } from '../habitat/life.mjs';

// Study interior, in grid coordinates (x negative = west of the lodge).
export const STUDY = { x0: -6, y0: 5, w: 6, h: 4 };
export const STUDY_DOOR = { x: 0, y: 7 }; // in the lodge's west wall, opening onto the great room
export const STUDY_ENTRY = { lx: 5, ly: 2 }; // the study tile just inside the door: always kept free
// Fireside inglenook: the fireplace at the back (x -3), benches on both sides.
export const NOOK = { x0: -2, y0: 10, w: 2, h: 3, opening: [{ x: 0, y: 10 }, { x: 0, y: 11 }, { x: 0, y: 12 }], benches: [{ x: -2, y: 10 }, { x: -1, y: 10 }, { x: -2, y: 12 }, { x: -1, y: 12 }], fire: { x: -3, y: 11 } };

export const inStudy = (x, y) => x >= STUDY.x0 && x < STUDY.x0 + STUDY.w && y >= STUDY.y0 && y < STUDY.y0 + STUDY.h;
export const inNook = (x, y) => x >= NOOK.x0 && x < NOOK.x0 + NOOK.w && y >= NOOK.y0 && y < NOOK.y0 + NOOK.h;
export const studyLocal = (x, y) => ({ x: x - STUDY.x0, y: y - STUDY.y0 });
export const studyGlobal = (lx, ly) => ({ x: STUDY.x0 + lx, y: STUDY.y0 + ly });

// Props he can use in his room: his own items, plus every prop any AI has unlocked.
export const OWNER_ITEMS = ['owner-desk', 'bookshelf', 'armchair', 'plant', 'trophy', 'lamp', 'globe', 'cushion'];
export function ownerPool(store) {
  const unlocked = new Set();
  for (const a of Object.values(store?.ai || {})) {
    for (const p of a.props || []) unlocked.add(p.kind);
    for (const k of a.stored || []) unlocked.add(k);
  }
  return [...new Set([...OWNER_ITEMS, ...PROP_POOL.filter((k) => unlocked.has(k))])];
}

// Can a prop stand on study tile (lx, ly) with the others at `props` (skipping #idx)?
// The entry tile stays free and every free tile stays reachable from the door.
export function canPlaceOwner(props, idx, lx, ly) {
  if (!Number.isInteger(lx) || !Number.isInteger(ly) || lx < 0 || ly < 0 || lx >= STUDY.w || ly >= STUDY.h) return false;
  if (lx === STUDY_ENTRY.lx && ly === STUDY_ENTRY.ly) return false;
  const blocked = new Set(props.filter((_, i) => i !== idx).map((p) => `${p.x},${p.y}`));
  const k = `${lx},${ly}`;
  if (blocked.has(k)) return false;
  blocked.add(k);
  const seen = new Set([`${STUDY_ENTRY.lx},${STUDY_ENTRY.ly}`]);
  const q = [[STUDY_ENTRY.lx, STUDY_ENTRY.ly]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx; const ny = y + dy; const nk = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= STUDY.w || ny >= STUDY.h || seen.has(nk) || blocked.has(nk)) continue;
      seen.add(nk); q.push([nx, ny]);
    }
  }
  for (let y = 0; y < STUDY.h; y++) for (let x = 0; x < STUDY.w; x++) if (!blocked.has(`${x},${y}`) && !seen.has(`${x},${y}`)) return false;
  return true;
}
// Owner edits: place, move, remove. Return { ok, room, reason }; never mutate the input.
export function ownerEdit(room, op, { pool = OWNER_ITEMS } = {}) {
  const props = (room?.props || []).map((p) => ({ ...p }));
  if (op.kind === 'place') {
    if (!pool.includes(op.prop)) return { ok: false, room, reason: 'that prop isn’t in your pool' };
    if (props.length >= 14) return { ok: false, room, reason: 'the room is full' };
    if (!canPlaceOwner(props, -1, op.x, op.y)) return { ok: false, room, reason: 'that spot is taken or would block the way' };
    props.push({ kind: op.prop, x: op.x, y: op.y });
  } else if (op.kind === 'move') {
    if (!props[op.idx]) return { ok: false, room, reason: 'pick a prop first' };
    if (!canPlaceOwner(props, op.idx, op.x, op.y)) return { ok: false, room, reason: 'that spot is taken or would block the way' };
    props[op.idx] = { ...props[op.idx], x: op.x, y: op.y };
  } else if (op.kind === 'remove') {
    if (!props[op.idx]) return { ok: false, room, reason: 'pick a prop first' };
    props.splice(op.idx, 1);
  } else return { ok: false, room, reason: 'unknown edit' };
  return { ok: true, room: { props }, reason: 'saved' };
}

// ---------- the avatar's walkable space ----------
// Grid tiles the AIs can walk on (every door open for him), plus the study,
// its door, and the fireside nook. Furniture tiles are never walkable.
export function ownerFree(world, room = { props: [] }) {
  const taken = new Set((room.props || []).map((p) => { const g = studyGlobal(p.x, p.y); return `${g.x},${g.y}`; }));
  return (x, y) => {
    if (inStudy(x, y)) return !taken.has(`${x},${y}`);
    if (x === STUDY_DOOR.x && y === STUDY_DOOR.y) return true;
    if (inNook(x, y)) return !NOOK.benches.some((b) => b.x === x && b.y === y);
    if (NOOK.opening.some((o) => o.x === x && o.y === y)) return true;
    if (x < 0 || y < 0 || x >= world.w || y >= world.h) return false;
    if (world.grid[y][x] === T.DOOR) return true;
    return aiPassable(world, x, y, {});
  };
}
// The AIs' own rule, for tests: never true for the owner's space.
export const aiCanStand = (world, x, y, closed = new Set(), who = null) => aiPassable(world, x, y, { closed, who });

export const AVATAR_R = 0.26;
// Slide-collision move in tile units: tile (i, j) spans i±0.5, j±0.5. Each axis
// is tried on its own so he slides along walls instead of sticking.
export function moveAvatar(pos, dx, dy, free, r = AVATAR_R) {
  const ok = (x, y) => {
    for (const [cx, cy] of [[x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]]) if (!free(Math.round(cx), Math.round(cy))) return false;
    return true;
  };
  let { x, y } = pos;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.2));
  for (let i = 0; i < steps; i++) {
    if (ok(x + dx / steps, y)) x += dx / steps;
    if (ok(x, y + dy / steps)) y += dy / steps;
  }
  return { x, y };
}

// ---------- controls ----------
export const KEYS = {
  KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run', KeyE: 'interact', KeyV: 'view', Escape: 'exit', KeyQ: 'turnL', KeyR: 'turnR',
};
// Standard gamepad mapping: A interact, B exit, Y switch view, sticks move/look, L3 or RB run.
export const PAD = { interact: 0, exit: 1, view: 3, run: [10, 5] };
const DEAD = 0.18;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));
// keys: Set of held key codes; pad: { axes, buttons: [{pressed}] } or null;
// touch: { move: {x,y}, look: {x,y} }. Returns one frame of intent.
export function inputFrom(keys = new Set(), pad = null, touch = null) {
  const held = (a) => [...keys].some((k) => KEYS[k] === a);
  let mx = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  let my = (held('fwd') ? 1 : 0) - (held('back') ? 1 : 0);
  let lx = (held('turnR') ? 1 : 0) - (held('turnL') ? 1 : 0); let ly = 0;
  let run = held('run');
  const btn = (i) => Boolean(pad?.buttons?.[i]?.pressed);
  if (pad?.axes) {
    mx += dz(pad.axes[0] || 0); my -= dz(pad.axes[1] || 0);
    lx += dz(pad.axes[2] || 0); ly += dz(pad.axes[3] || 0);
    run = run || PAD.run.some(btn);
  }
  if (touch?.move) { mx += touch.move.x; my -= touch.move.y; }
  if (touch?.look) { lx += touch.look.x; ly += touch.look.y; }
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  return {
    move: { x: mx, y: my }, look: { x: Math.max(-1, Math.min(1, lx)), y: Math.max(-1, Math.min(1, ly)) }, run,
    interact: held('interact') || btn(PAD.interact), exit: held('exit') || btn(PAD.exit), view: held('view') || btn(PAD.view),
  };
}
// Walk speed in tiles per second.
export const speedFor = (run) => (run ? 3.6 : 2.0);
// Move intent (forward/right) turned by the view yaw into a grid delta. yaw 0 looks toward -y (north).
export function stepDelta(move, yaw, dist) {
  const s = Math.sin(yaw); const c = Math.cos(yaw);
  return { dx: (move.x * c - move.y * s) * dist, dy: (-move.y * c - move.x * s) * dist };
}
// Reduced motion: no head bob, and turning snaps in 45° steps when asked.
export function camBob(t, moving, { reduced = false } = {}) { return reduced || !moving ? 0 : Math.abs(Math.sin(t * 9)) * 0.035; }
export function snapTurn(yaw, dir, { reduced = false, instant = false } = {}) { return reduced && instant ? yaw + Math.sign(dir) * (Math.PI / 4) : yaw; }

// The nearest thing in reach for E. targets: [{ kind, id?, x, y }] in tile units.
export function nearestTarget(pos, targets, reach = 1.6) {
  let best = null; let bd = reach;
  for (const t of targets) { const d = Math.hypot(t.x - pos.x, t.y - pos.y); if (d <= bd) { bd = d; best = t; } }
  return best;
}
// Who notices him: idle AIs within 2.6 tiles (working or sleeping ones never react).
export function noticers(pos, actors = [], behs = {}, range = 2.6) {
  return actors.filter((a) => behs[a.id]?.mode === 'idle' && Math.hypot(a.x - pos.x, a.y - pos.y) <= range).map((a) => a.id);
}

// Cosmetic owner actions never change the shared Habitat store (no growth, no counters).
export const OWNER_COSMETIC = ['pet', 'coffee', 'water', 'sit'];

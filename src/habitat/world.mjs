// Habitat world logic: tile map, rooms, desks, pathfinding and the
// state -> behaviour mapping. Pure functions only (no DOM), unit tested.
//
// Layout (tiles): one row of rooms along the top edge, one along the bottom,
// a shared workroom in the middle with one desk per AI. Each room is 6x4
// tiles inside its walls, with a door facing the workroom. An east wing adds a
// break room (top), a hall with the message board and trophy shelf (middle)
// and a garden courtyard (bottom).
import { canPlace } from './life.mjs';

export const TILE = 16;
export const T = { WALL: 1, FLOOR: 2, ROOM: 3, DOOR: 4, DESK: 5, PROP: 6, GARDEN: 7, KITCHEN: 8, PATH: 9 };
export const MAX_AIS = 12;
const ROOM_W = 7; // wall + 6 interior tiles
const H = 20;
const TOP_Y = 1; // top room interior rows 1..4
const BOTTOM_Y = 15; // bottom room interior rows 15..18
const WORK_Y0 = 6;
const WORK_Y1 = 13;

// Personal props per room, varied by position. Slots are local (lx 0..5,
// ly 0..3 counted from the room's back wall). The door is at lx 2 on ly 3.
const SLOTS = { A: [0, 0], B: [3, 0], C: [0, 3], D: [5, 3] };
export const VARIANTS = [
  { A: 'bookshelf', B: 'lamp', D: 'plant', rug: 0 },
  { A: 'plant', B: 'bookshelf', C: 'lamp', rug: 1 },
  { A: 'chest', B: 'plant', D: 'lamp', rug: 2 },
  { A: 'lamp', B: 'chest', C: 'bookshelf', rug: 1 },
  { A: 'bookshelf', B: 'plant', C: 'chest', rug: 2 },
  { A: 'plant', B: 'lamp', D: 'bookshelf', rug: 0 },
];

const key = (x, y) => `${x},${y}`;

const WING = 9; // east wing: 8 interior tiles + wall

// layout: { [aiId]: [{ kind, x, y }] } unlocked props in room-local tiles.
export function buildWorld(ids = [], layout = {}) {
  const list = [...new Set(ids)].slice(0, MAX_AIS);
  const n = list.length;
  const top = Math.ceil(n / 2);
  const bottom = n - top;
  const cols = Math.max(3, top);
  const E0 = cols * ROOM_W + 1;
  const w = E0 + WING;
  const grid = Array.from({ length: H }, () => Array(w).fill(T.WALL));
  const set = (x, y, v) => { grid[y][x] = v; };
  const rooms = [];
  const desks = [];
  const gardens = [];

  // Shared workroom.
  for (let y = WORK_Y0; y <= WORK_Y1; y++) for (let x = 1; x < w - 1; x++) set(x, y, T.FLOOR);

  const place = (side, count, offset) => {
    const startCol = Math.floor((cols - count) / 2);
    for (let c = 0; c < cols; c++) {
      const x0 = c * ROOM_W;
      const y0 = side === 'top' ? TOP_Y : BOTTOM_Y;
      const idx = c - startCol;
      const id = idx >= 0 && idx < count ? list[offset + idx] : null;
      if (!id) {
        for (let y = y0; y < y0 + 4; y++) for (let x = x0 + 1; x <= x0 + 6; x++) set(x, y, T.GARDEN);
        gardens.push({ x0: x0 + 1, y0, w: 6, h: 4 });
        continue;
      }
      const i = offset + idx;
      const g = (lx, ly) => ({ x: x0 + 1 + lx, y: side === 'top' ? y0 + ly : y0 + 3 - ly });
      for (let y = y0; y < y0 + 4; y++) for (let x = x0 + 1; x <= x0 + 6; x++) set(x, y, T.ROOM);
      const door = { x: x0 + 3, y: side === 'top' ? 5 : 14 };
      set(door.x, door.y, T.DOOR);
      const v = VARIANTS[i % VARIANTS.length];
      const props = [];
      for (const s of ['A', 'B', 'C', 'D']) {
        if (!v[s]) continue;
        const p = g(...SLOTS[s]);
        set(p.x, p.y, T.PROP);
        props.push({ kind: v[s], ...p });
      }
      const bed = [g(5, 0), g(5, 1)];
      const rugTiles = [];
      for (let ly = 1; ly <= 2; ly++) for (let lx = 1; lx <= 3; lx++) rugTiles.push(g(lx, ly));
      const bedKeys = new Set(bed.map((b) => key(b.x, b.y)));
      const room = {
        id, index: i, side, x0: x0 + 1, y0, w: 6, h: 4, door, props, bed, bedSpot: bed[0].y < bed[1].y ? bed[0] : bed[1],
        rug: { tiles: rugTiles, style: v.rug, x: Math.min(...rugTiles.map((r) => r.x)), y: Math.min(...rugTiles.map((r) => r.y)), w: 3, h: 2 },
        rugSpot: g(2, 1), spots: [], extras: [],
        plate: { x: x0 + 4, y: door.y, w: 3 },
      };
      // Unlocked props, where they were saved; one that no longer fits is left out of the drawing.
      const placed = [];
      for (const p of Array.isArray(layout[id]) ? layout[id] : []) {
        if (!canPlace(room, placed, -1, p.x, p.y)) continue;
        placed.push({ kind: p.kind, x: p.x, y: p.y });
        const at = g(p.x, p.y);
        set(at.x, at.y, T.PROP);
        room.extras.push({ kind: p.kind, ...at, lx: p.x, ly: p.y });
      }
      for (let y = y0; y < y0 + 4; y++) for (let x = x0 + 1; x <= x0 + 6; x++) if (grid[y][x] === T.ROOM && !bedKeys.has(key(x, y))) room.spots.push({ x, y });
      rooms.push(room);
      const dy = side === 'top' ? 8 : 11;
      const tiles = [{ x: x0 + 2, y: dy }, { x: x0 + 3, y: dy }, { x: x0 + 4, y: dy }];
      for (const t of tiles) set(t.x, t.y, T.DESK);
      desks.push({ id, tiles, seat: { x: x0 + 3, y: dy + 1 }, monitor: { x: x0 + 3, y: dy } });
    }
  };
  place('top', top, 0);
  place('bottom', bottom, top);

  // East wing: break room, hall, courtyard.
  for (let y = TOP_Y; y < TOP_Y + 4; y++) for (let x = E0; x < E0 + 8; x++) set(x, y, T.KITCHEN);
  const kdoor = { x: E0 + 1, y: 5 };
  set(kdoor.x, kdoor.y, T.DOOR);
  const kprops = [
    { kind: 'coffee', x: E0, y: 1 }, { kind: 'counter', x: E0 + 1, y: 1 }, { kind: 'plant', x: E0 + 6, y: 1 }, { kind: 'fridge', x: E0 + 7, y: 1 },
    { kind: 'heater', x: E0 + 7, y: 3 },
  ];
  const table = [{ x: E0 + 3, y: 2 }, { x: E0 + 4, y: 2 }, { x: E0 + 3, y: 3 }, { x: E0 + 4, y: 3 }];
  for (const p of [...kprops, ...table]) set(p.x, p.y, T.PROP);
  const kitchen = {
    x0: E0, y0: TOP_Y, w: 8, h: 4, door: kdoor, props: kprops, table: { x: E0 + 3, y: 2, w: 2, h: 2 },
    // Pairs of spots side by side, so two AIs on a break stand together and chat.
    spots: [{ x: E0 + 2, y: 2 }, { x: E0 + 2, y: 3 }, { x: E0 + 5, y: 2 }, { x: E0 + 5, y: 3 }],
    coffeeSpot: { x: E0, y: 2 },
    rug: { x: E0 + 5, y: 4, w: 3, h: 1 }, rugSpot: { x: E0 + 6, y: 4 },
    window: { x: E0 + 3, y: 0, w: 3 },
  };
  const hall = { x0: E0, board: { x: E0 + 3, y: WORK_Y0, w: 4, h: 2 }, shelf: { x: E0 + 3, y: WORK_Y1, w: 4 } };
  for (let x = hall.board.x; x < hall.board.x + 4; x++) { set(x, WORK_Y0, T.PROP); set(x, WORK_Y0 + 1, T.PROP); set(x, WORK_Y1, T.PROP); }
  const gate = { x: E0 + 1, y: 14 };
  set(gate.x, gate.y, T.DOOR);
  const beds = [];
  for (let y = BOTTOM_Y; y < BOTTOM_Y + 4; y++) {
    for (let x = E0; x < E0 + 8; x++) {
      const bed = x >= E0 + 3 && y !== BOTTOM_Y + 2;
      set(x, y, bed ? T.GARDEN : T.PATH);
      if (bed) beds.push({ x, y });
    }
  }
  const cprops = [{ kind: 'tree', x: E0, y: BOTTOM_Y }, { kind: 'bench', x: E0, y: BOTTOM_Y + 3 }];
  for (const p of cprops) set(p.x, p.y, T.PROP);
  const courtyard = { x0: E0, y0: BOTTOM_Y, w: 8, h: 4, gate, beds, props: cprops };

  // A little shared decor in the workroom corners (never on a path).
  const decor = [
    { kind: 'plant', x: 1, y: WORK_Y0 }, { kind: 'plant', x: w - 2, y: WORK_Y0 },
    { kind: 'cooler', x: 1, y: WORK_Y1 }, { kind: 'bookshelf', x: w - 2, y: WORK_Y1 },
  ];
  for (const d of decor) set(d.x, d.y, T.PROP);

  return { w, h: H, cols, grid, rooms, desks, decor, gardens, kitchen, hall, courtyard, ids: list };
}

export const roomOf = (world, id) => world.rooms.find((r) => r.id === id) || null;
export const deskOf = (world, id) => world.desks.find((d) => d.id === id) || null;

// Doors are closed for everyone but their owner when the room is locked.
export function passable(world, x, y, { closed = new Set(), who = null } = {}) {
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return false;
  const t = world.grid[y][x];
  if (t === T.FLOOR || t === T.ROOM || t === T.KITCHEN || t === T.PATH) return true;
  if (t === T.DOOR) {
    const r = world.rooms.find((rm) => rm.door.x === x && rm.door.y === y);
    return !r || !closed.has(r.id) || r.id === who;
  }
  return false;
}

// Breadth-first search on the tile grid (4 directions). Returns the tiles to
// walk, start excluded, or null when the goal can't be reached.
export function findPath(world, from, to, opts = {}) {
  const sx = Math.round(from.x); const sy = Math.round(from.y);
  if (sx === to.x && sy === to.y) return [];
  if (!passable(world, to.x, to.y, opts)) return null;
  const prev = new Map([[key(sx, sy), null]]);
  const queue = [[sx, sy]];
  for (let qi = 0; qi < queue.length; qi++) {
    const [x, y] = queue[qi];
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const nx = x + dx; const ny = y + dy; const k = key(nx, ny);
      if (prev.has(k) || !passable(world, nx, ny, opts)) continue;
      prev.set(k, key(x, y));
      if (nx === to.x && ny === to.y) {
        const path = [];
        for (let c = k; c && c !== key(sx, sy); c = prev.get(c)) { const [px, py] = c.split(',').map(Number); path.unshift({ x: px, y: py }); }
        return path;
      }
      queue.push([nx, ny]);
    }
  }
  return null;
}

// What an AI is doing, from the app's status snapshot. Priority:
// out of usage > signed out / sign-in hold > task or review at the desk > idle.
// s: { status: 'out'|'hold'|'signedout'|'idle', task, reviewing, typing, waiting, lead }
export function behaviourOf(s = {}) {
  const star = Boolean(s.lead);
  if (s.status === 'out') return { mode: 'sleep', icon: 'zzz', door: 'open', star, monitor: null };
  if (s.status === 'hold' || s.status === 'signedout') return { mode: 'locked', icon: 'lock', door: 'locked', star, monitor: null };
  const icon = s.typing ? 'bubble' : s.reviewing ? 'magnifier' : s.waiting ? 'ask' : null;
  if (s.task) return { mode: 'desk', icon, door: 'open', star, monitor: { id: s.task.id, kind: 'task' } };
  if (s.reviewing) return { mode: 'desk', icon, door: 'open', star, monitor: { id: s.reviewing.id, kind: 'review' } };
  return { mode: 'idle', icon, door: 'open', star, monitor: null };
}

// Where an AI rests for a behaviour (also where reduced motion snaps it).
export function restSpot(world, id, beh) {
  const room = roomOf(world, id);
  if (beh.mode === 'desk') return deskOf(world, id)?.seat || room?.rugSpot;
  if (beh.mode === 'sleep') return room?.bedSpot;
  return room?.rugSpot;
}

const restPose = (mode) => (mode === 'desk' ? 'sit' : mode === 'sleep' ? 'sleep' : 'sit');

export function newActor(world, id, beh) {
  const s = restSpot(world, id, beh) || { x: 1, y: WORK_Y0 + 1 };
  return { id, x: s.x, y: s.y, path: [], mode: beh.mode, pose: restPose(beh.mode), dir: beh.mode === 'desk' ? 'up' : 'down', wait: 1, anim: 0, goal: 'rest' };
}

export function closedDoors(behs = {}) {
  return new Set(Object.entries(behs).filter(([, b]) => b.door === 'locked').map(([id]) => id));
}

// Advance one actor by dt seconds. With reduced motion it snaps to its spot and never wanders.
// opts.social lets idle AIs take coffee breaks; opts.speed scales the walk (mood);
// opts.taken holds kitchen spots other AIs are using. actor.errand = { to, task }
// walks it somewhere (a visit) and sets actor.delivered on arrival.
// actor.visit = { to, until } (HABITAT: go / coffee) walks an idle AI there and
// keeps it there until `until` (ms, opts.now); work always wins over a visit.
export function stepActor(world, actor, beh, dt, { rng = Math.random, reduced = false, closed = new Set(), social = false, speed: speedK = 1, taken = new Set(), now = Date.now() } = {}) {
  const opts = { closed, who: actor.id };
  const room = roomOf(world, actor.id);
  const free = beh.mode === 'idle';
  if (actor.errand && (reduced || !free)) { actor.delivered = actor.errand; actor.errand = null; }
  if (actor.visit && (!free || now >= actor.visit.until)) { actor.visit = null; if (actor.goal === 'visit') { actor.goal = 'rest'; actor.wait = 0; } }
  if (reduced && actor.visit) {
    // Reduced motion: it is simply there, no walking.
    actor.x = actor.visit.to.x; actor.y = actor.visit.to.y; actor.path = []; actor.mode = beh.mode; actor.goal = 'visit'; actor.dest = key(actor.visit.to.x, actor.visit.to.y);
    actor.pose = 'stand'; actor.dir = 'down';
    return actor;
  }
  if (reduced) {
    const s = restSpot(world, actor.id, beh);
    if (s) { actor.x = s.x; actor.y = s.y; }
    actor.path = []; actor.mode = beh.mode; actor.goal = 'rest'; actor.coffeeNext = false; actor.dest = null;
    actor.pose = restPose(beh.mode); actor.dir = beh.mode === 'desk' ? 'up' : 'down';
    return actor;
  }
  const go = (target, goal) => {
    actor.goal = goal;
    actor.dest = target ? key(target.x, target.y) : null;
    actor.path = (target && findPath(world, actor, target, opts)) || [];
    if (!actor.path.length) arrive(actor, rng);
  };
  if (actor.mode !== beh.mode) {
    actor.mode = beh.mode;
    actor.wait = 0;
    if (free && social && actor.coffeeNext && world.kitchen) { actor.coffeeNext = false; go(kitchenSpot(world, taken), 'coffee'); return actor; }
    actor.goal = 'rest'; actor.dest = null;
    actor.path = findPath(world, actor, restSpot(world, actor.id, beh), opts) || [];
    if (!actor.path.length) { const s = restSpot(world, actor.id, beh); if (s) { actor.x = s.x; actor.y = s.y; } }
  }
  if (free && actor.errand && actor.goal !== 'errand') { go(actor.errand.to, 'errand'); if (actor.goal !== 'errand') return actor; }
  if (free && actor.visit && !actor.errand && actor.goal !== 'visit') { go(actor.visit.to, 'visit'); return actor; }
  if (actor.path.length) {
    const speed = (actor.mode === 'idle' || actor.mode === 'locked' ? 1.6 : 3.2) * (actor.goal === 'errand' || actor.goal === 'coffee' ? 1.5 : 1) * speedK;
    let left = speed * dt;
    while (left > 0 && actor.path.length) {
      const n = actor.path[0];
      const dx = n.x - actor.x; const dy = n.y - actor.y;
      const d = Math.abs(dx) + Math.abs(dy);
      if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) actor.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      if (d <= left) { actor.x = n.x; actor.y = n.y; actor.path.shift(); left -= d; actor.anim += d; } else { actor.x += Math.sign(dx) * Math.min(Math.abs(dx), left); actor.y += Math.sign(dy) * Math.min(Math.abs(dy), left); actor.anim += left; left = 0; }
    }
    actor.pose = 'walk';
    if (!actor.path.length) arrive(actor, rng);
    return actor;
  }
  // Resting at the spot.
  if (actor.mode === 'desk') { actor.pose = 'sit'; actor.dir = 'up'; return actor; }
  if (actor.mode === 'sleep') { actor.pose = 'sleep'; actor.dir = 'down'; return actor; }
  if (actor.goal === 'visit' && actor.visit) return actor;
  // Idle or locked in: wander slowly in its own room, sometimes sit on the rug,
  // and (idle only) now and then walk to the break room for a coffee.
  actor.wait -= dt;
  if (actor.wait > 0 || !room) return actor;
  if (actor.goal === 'coffee' || actor.goal === 'errand' || actor.goal === 'visit') { go(room.rugSpot, 'rest'); return actor; }
  if (free && social && world.kitchen && rng() < 0.12) { go(kitchenSpot(world, taken), 'coffee'); return actor; }
  const toRug = rng() < 0.3;
  go(toRug ? room.rugSpot : room.spots[Math.floor(rng() * room.spots.length)], toRug ? 'rug' : 'wander');
  return actor;
}

// The first free break-room spot: the second AI to arrive stands next to the first.
export function kitchenSpot(world, taken = new Set()) {
  const k = world.kitchen;
  if (!k) return null;
  return k.spots.find((s) => !taken.has(key(s.x, s.y))) || k.coffeeSpot;
}

function arrive(actor, rng) {
  if (actor.mode === 'desk') { actor.pose = 'sit'; actor.dir = 'up'; return; }
  if (actor.mode === 'sleep') { actor.pose = 'sleep'; actor.dir = 'down'; return; }
  if (actor.goal === 'errand') { actor.delivered = actor.errand; actor.errand = null; actor.pose = 'stand'; actor.dir = 'up'; actor.wait = 1.5; return; }
  if (actor.goal === 'visit') { actor.pose = 'stand'; actor.dir = actor.x % 2 ? 'right' : 'left'; return; }
  if (actor.goal === 'coffee') { actor.pose = 'stand'; actor.dir = actor.x % 2 ? 'right' : 'left'; actor.wait = 8 + rng() * 6; return; }
  if (actor.goal === 'rug' || actor.goal === 'rest') { actor.pose = 'sit'; actor.dir = 'down'; actor.wait = 6 + rng() * 6; } else { actor.pose = 'stand'; actor.wait = 2 + rng() * 3; }
}

// ---------- the pet ----------
export function newPet(world, goal) {
  const s = goal?.spot || { x: 1, y: WORK_Y0 + 1 };
  return { x: s.x, y: s.y, path: [], pose: goal?.pose || 'nap', dir: 'down', anim: 0, goalKey: s ? key(s.x, s.y) : '', wait: 20, roaming: false };
}
// Pets walk on any floor but never through a closed door.
export function stepPet(world, pet, goal, dt, { reduced = false, closed = new Set(), rng = Math.random } = {}) {
  const opts = { closed, who: null };
  const gk = key(goal.spot.x, goal.spot.y);
  if (reduced) { pet.x = goal.spot.x; pet.y = goal.spot.y; pet.path = []; pet.pose = goal.pose; pet.goalKey = gk; pet.roaming = false; return pet; }
  if (gk !== pet.goalKey) {
    pet.goalKey = gk; pet.roaming = false;
    pet.path = findPath(world, pet, goal.spot, opts) || [];
    if (!pet.path.length) { pet.x = goal.spot.x; pet.y = goal.spot.y; }
  }
  if (pet.path.length) {
    let left = 2.6 * dt;
    while (left > 0 && pet.path.length) {
      const n = pet.path[0];
      const dx = n.x - pet.x; const dy = n.y - pet.y; const d = Math.abs(dx) + Math.abs(dy);
      if (d > 0.001) pet.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      if (d <= left) { pet.x = n.x; pet.y = n.y; pet.path.shift(); left -= d; pet.anim += d; } else { pet.x += Math.sign(dx) * Math.min(Math.abs(dx), left); pet.y += Math.sign(dy) * Math.min(Math.abs(dy), left); pet.anim += left; left = 0; }
    }
    pet.pose = 'walk';
    if (!pet.path.length) { pet.pose = pet.roaming ? 'sit' : goal.pose; pet.wait = pet.roaming ? 3 + rng() * 3 : 25 + rng() * 20; }
    return pet;
  }
  pet.pose = pet.roaming ? 'sit' : goal.pose;
  pet.wait -= dt;
  if (pet.wait > 0) return pet;
  // A short stroll through the hall or the courtyard, then back to its spot.
  if (pet.roaming || goal.follow) { pet.roaming = false; pet.path = findPath(world, pet, goal.spot, opts) || []; pet.wait = 20; return pet; }
  const c = world.courtyard; const k = world.kitchen;
  const picks = [{ x: c.x0 + 1, y: c.y0 + 2 }, { x: c.x0 + 5, y: c.y0 + 2 }, { x: world.hall.x0 + 1, y: WORK_Y0 + 3 }, { x: k.x0 + 6, y: k.y0 + 2 }];
  const to = picks[Math.floor(rng() * picks.length)];
  pet.roaming = true;
  pet.path = findPath(world, pet, to, opts) || [];
  if (!pet.path.length) { pet.roaming = false; pet.wait = 20; }
  return pet;
}

// Walk-cycle frame: 0 stand, 1 step A, 2 stand, 3 step B.
export const walkFrame = (actor) => (actor.pose === 'walk' ? Math.floor(actor.anim * 4) % 4 : 0);

// Describe actual positions, including actors still walking between destinations.
export function actorLocation(world, actor) {
  if (!actor || !Number.isFinite(actor.x) || !Number.isFinite(actor.y)) return 'location unavailable';
  const { x, y } = actor;
  const inside = (r) => r && x >= r.x0 && x < r.x0 + r.w && y >= r.y0 && y < r.y0 + r.h;
  if (inside(world.kitchen)) return 'break room';
  if (inside(world.courtyard)) return 'garden courtyard';
  const room = world.rooms.find((r) => x >= r.x0 + 1 && x < r.x0 + 7 && y >= r.y0 && y < r.y0 + 4);
  if (room) return { room: room.id };
  if (x >= world.hall.x0 && y >= 5 && y < 15) return 'hall';
  return 'shared workroom';
}

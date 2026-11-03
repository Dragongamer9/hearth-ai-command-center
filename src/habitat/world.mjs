// Habitat world logic: tile map, rooms, desks, pathfinding and the
// state -> behaviour mapping. Pure functions only (no DOM), unit tested.
//
// Layout (tiles): one row of rooms along the top edge, one along the bottom,
// a shared workroom in the middle with one desk per AI. Each room is 6x4
// tiles inside its walls, with a door facing the workroom.

export const TILE = 16;
export const T = { WALL: 1, FLOOR: 2, ROOM: 3, DOOR: 4, DESK: 5, PROP: 6, GARDEN: 7 };
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

export function buildWorld(ids = []) {
  const list = [...new Set(ids)].slice(0, MAX_AIS);
  const n = list.length;
  const top = Math.ceil(n / 2);
  const bottom = n - top;
  const cols = Math.max(3, top);
  const w = cols * ROOM_W + 1;
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
      const spots = [];
      for (let y = y0; y < y0 + 4; y++) for (let x = x0 + 1; x <= x0 + 6; x++) if (grid[y][x] === T.ROOM && !bedKeys.has(key(x, y))) spots.push({ x, y });
      rooms.push({
        id, index: i, side, x0: x0 + 1, y0, w: 6, h: 4, door, props, bed, bedSpot: bed[0].y < bed[1].y ? bed[0] : bed[1],
        rug: { tiles: rugTiles, style: v.rug, x: Math.min(...rugTiles.map((r) => r.x)), y: Math.min(...rugTiles.map((r) => r.y)), w: 3, h: 2 },
        rugSpot: g(2, 1), spots,
        plate: { x: x0 + 4, y: door.y, w: 3 },
      });
      const dy = side === 'top' ? 8 : 11;
      const tiles = [{ x: x0 + 2, y: dy }, { x: x0 + 3, y: dy }, { x: x0 + 4, y: dy }];
      for (const t of tiles) set(t.x, t.y, T.DESK);
      desks.push({ id, tiles, seat: { x: x0 + 3, y: dy + 1 }, monitor: { x: x0 + 3, y: dy } });
    }
  };
  place('top', top, 0);
  place('bottom', bottom, top);

  // A little shared decor in the workroom corners (never on a path).
  const decor = [
    { kind: 'plant', x: 1, y: WORK_Y0 }, { kind: 'plant', x: w - 2, y: WORK_Y0 },
    { kind: 'cooler', x: 1, y: WORK_Y1 }, { kind: 'bookshelf', x: w - 2, y: WORK_Y1 },
  ];
  for (const d of decor) set(d.x, d.y, T.PROP);

  return { w, h: H, cols, grid, rooms, desks, decor, gardens, ids: list };
}

export const roomOf = (world, id) => world.rooms.find((r) => r.id === id) || null;
export const deskOf = (world, id) => world.desks.find((d) => d.id === id) || null;

// Doors are closed for everyone but their owner when the room is locked.
export function passable(world, x, y, { closed = new Set(), who = null } = {}) {
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return false;
  const t = world.grid[y][x];
  if (t === T.FLOOR || t === T.ROOM) return true;
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
export function stepActor(world, actor, beh, dt, { rng = Math.random, reduced = false, closed = new Set() } = {}) {
  const opts = { closed, who: actor.id };
  const room = roomOf(world, actor.id);
  if (reduced) {
    const s = restSpot(world, actor.id, beh);
    if (s) { actor.x = s.x; actor.y = s.y; }
    actor.path = []; actor.mode = beh.mode; actor.goal = 'rest';
    actor.pose = restPose(beh.mode); actor.dir = beh.mode === 'desk' ? 'up' : 'down';
    return actor;
  }
  if (actor.mode !== beh.mode) {
    actor.mode = beh.mode;
    actor.goal = 'rest';
    actor.path = findPath(world, actor, restSpot(world, actor.id, beh), opts) || [];
    if (!actor.path.length) { const s = restSpot(world, actor.id, beh); if (s) { actor.x = s.x; actor.y = s.y; } }
    actor.wait = 0;
  }
  if (actor.path.length) {
    const speed = actor.mode === 'idle' || actor.mode === 'locked' ? 1.6 : 3.2;
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
  // Idle or locked in: wander slowly in its own room, sometimes sit on the rug.
  actor.wait -= dt;
  if (actor.wait > 0 || !room) return actor;
  const toRug = rng() < 0.3;
  const target = toRug ? room.rugSpot : room.spots[Math.floor(rng() * room.spots.length)];
  actor.goal = toRug ? 'rug' : 'wander';
  actor.path = findPath(world, actor, target, opts) || [];
  if (!actor.path.length) arrive(actor, rng);
  return actor;
}

function arrive(actor, rng) {
  if (actor.mode === 'desk') { actor.pose = 'sit'; actor.dir = 'up'; return; }
  if (actor.mode === 'sleep') { actor.pose = 'sleep'; actor.dir = 'down'; return; }
  if (actor.goal === 'rug' || actor.goal === 'rest') { actor.pose = 'sit'; actor.dir = 'down'; actor.wait = 6 + rng() * 6; } else { actor.pose = 'stand'; actor.wait = 2 + rng() * 3; }
}

// Walk-cycle frame: 0 stand, 1 step A, 2 stand, 3 step B.
export const walkFrame = (actor) => (actor.pose === 'walk' ? Math.floor(actor.anim * 4) % 4 : 0);

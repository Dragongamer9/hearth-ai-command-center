// Habitat 3D: pure mappings from the 2D Habitat (tile grid, behaviour, saved
// view settings) to what the 3D lodge shows. No DOM and no three.js here, so it
// is unit tested with node --test. The 2D world logic (../habitat/world.mjs and
// ../habitat/life.mjs) stays the single source of truth; 3D only draws it.

import { T } from '../habitat/world.mjs';

// One tile is one metre-ish unit in 3D. The lodge floor sits at y = 0.
export const UNIT = 1;
export const FLOOR_Y = 0;
export const WALL_H = { outer: 1.5, back: 2.5, inner: 1.15 }; // dollhouse: low walls toward the viewer
export const PIXEL_RATIO_CAP = 2;

// Tile (x, y) of the 2D grid -> centre of that tile on the 3D floor (x, z).
// The lodge is centred on the origin; +z is "down" in 2D (toward the viewer).
export function tileTo3D(world, x, y) {
  return { x: (x - world.w / 2 + 0.5) * UNIT, z: (y - world.h / 2 + 0.5) * UNIT };
}
// The reverse, for picking a floor point.
export function toTile(world, X, Z) {
  return { x: Math.floor(X / UNIT + world.w / 2), y: Math.floor(Z / UNIT + world.h / 2) };
}
// The lodge's footprint (outer wall faces) on the floor plane.
export function lodgeBounds(world) {
  return { minX: (-world.w / 2) * UNIT, maxX: (world.w / 2) * UNIT, minZ: (-world.h / 2) * UNIT, maxZ: (world.h / 2) * UNIT };
}
export const inBounds = (b, p, pad = 0) => p.x >= b.minX - pad && p.x <= b.maxX + pad && p.z >= b.minZ - pad && p.z <= b.maxZ + pad;

// Which way a figure faces for the 2D directions (rotation about y, 0 = toward +z).
export const FACING = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 };
export const facingOf = (dir) => FACING[dir] ?? 0;

// What a wall tile is in 3D: the outer north row is tall with windows, the rest
// of the outer ring is low, walls between rooms are low too (cut away).
export function wallKind(world, x, y) {
  if (world.grid[y]?.[x] !== T.WALL) return null;
  if (y === 0) return 'back';
  if (x === 0 || y === world.h - 1 || x === world.w - 1) return 'outer';
  return 'inner';
}
export const wallHeight = (kind) => WALL_H[kind] || 0;

// Courtyard and empty room slots are open to the sky (no roof, grass floor).
export function isOutdoor(world, x, y) {
  const c = world.courtyard;
  if (c && x >= c.x0 && x < c.x0 + c.w && y >= c.y0 && y < c.y0 + c.h) return true;
  return world.grid[y]?.[x] === T.GARDEN;
}

// The figure's look for one frame, from the same state the 2D Habitat draws.
// beh: behaviourOf(); actor: the shared actor; extra: { mood, chat, waving, cheering }.
export function visualFor(beh = {}, actor = {}, extra = {}) {
  const moving = actor.pose === 'walk';
  let pose = actor.pose === 'sleep' ? 'sleep' : moving ? 'walk' : actor.pose === 'sit' ? 'sit' : 'stand';
  if (pose === 'sit' && actor.mode === 'desk') pose = 'type';
  let hold = null;
  if (actor.errand) hold = 'paper';
  else if (actor.goal === 'coffee' && !moving) hold = 'mug';
  let gesture = null;
  if (extra.cheering && pose !== 'sleep') gesture = 'cheer';
  else if (extra.waving && pose !== 'sleep') gesture = 'wave';
  const face = pose === 'sleep' ? 'asleep' : extra.mood === 'tired' ? 'tired' : extra.mood === 'pleased' ? 'smile' : 'calm';
  return {
    pose, hold, gesture, face,
    icon: extra.chat ? 'chat' : beh.icon || null,
    star: Boolean(beh.star),
    speed: extra.mood === 'tired' ? 0.6 : extra.mood === 'pleased' ? 1.1 : 1,
  };
}
export const doorClosed = (beh) => beh?.door === 'locked';
// A room lamp is lit at dusk/night/dawn unless its AI switched it off (HABITAT: lamp off).
export const lampLit = (store, id, light) => Boolean(light?.lamps) && store?.ai?.[id]?.lamp !== 'off';

// ---------- saved view settings ----------
// Kept in the app state (state.habitatView). They only change when the owner
// presses the switch; nothing here ever changes them on its own.
export const HAIR_STYLES = ['short', 'curly', 'bun', 'long', 'hood'];
export const OUTFITS = ['#e8833a', '#c9542e', '#d9a441', '#7a4a2e', '#3f6e8c', '#5d7f4a'];
export function normPrefs(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const av = o.avatar && typeof o.avatar === 'object' ? o.avatar : {};
  return {
    mode: o.mode === '3d' ? '3d' : '2d',
    lighter: o.lighter === true,
    walkView: o.walkView === 'first' ? 'first' : 'third',
    avatar: { hair: Number.isInteger(av.hair) && av.hair >= 0 && av.hair < HAIR_STYLES.length ? av.hair : 0, outfit: OUTFITS.includes(av.outfit) ? av.outfit : OUTFITS[0] },
    room: normOwnerRoom(o.room),
    notes: Array.isArray(o.notes) ? o.notes.filter((n) => n && typeof n.text === 'string' && n.text.trim()).slice(-OWNER_NOTES_MAX).map((n) => ({ text: cleanNote(n.text), at: typeof n.at === 'string' ? n.at : new Date(0).toISOString() })) : [],
  };
}
export const OWNER_NOTES_MAX = 4;
export const cleanNote = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
export function withPref(prefs, key, value) {
  const p = normPrefs(prefs);
  if (key === 'mode') p.mode = value === '3d' ? '3d' : '2d';
  if (key === 'lighter') p.lighter = value === true;
  if (key === 'walkView') p.walkView = value === 'first' ? 'first' : 'third';
  if (key === 'avatar') p.avatar = normPrefs({ avatar: { ...p.avatar, ...value } }).avatar;
  if (key === 'room') p.room = normOwnerRoom(value);
  if (key === 'note') { const t = cleanNote(value); if (t) p.notes = [...p.notes, { text: t, at: new Date().toISOString() }].slice(-OWNER_NOTES_MAX); }
  if (key === 'clearNotes') p.notes = [];
  return p;
}
// The owner's room is decorated by him only (see ./walk.mjs); this just keeps the saved shape valid.
export function normOwnerRoom(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const props = Array.isArray(o.props) ? o.props.filter((p) => p && typeof p.kind === 'string' && /^[a-z-]{2,20}$/.test(p.kind) && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.x < 6 && p.y >= 0 && p.y < 4) : [];
  const seen = new Set();
  return { props: props.filter((p) => { const k = `${p.x},${p.y}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 14).map((p) => ({ kind: p.kind, x: p.x, y: p.y })) };
}
// What actually shows: 3D only when chosen and WebGL works. Falling back never
// rewrites the saved choice, it only adds a notice.
export function pickView(prefs, { webgl = true, rearranging = false } = {}) {
  const p = normPrefs(prefs);
  if (p.mode !== '3d') return { mode: '2d', notice: '' };
  if (!webgl) return { mode: '2d', notice: '3D needs WebGL, which isn’t available here, so the Habitat is shown in 2D.' };
  if (rearranging) return { mode: '2d', notice: 'Rearranging happens in 2D; the lodge comes back when you press Done.' };
  return { mode: '3d', notice: '' };
}

// Quality and motion. Reduced motion: no particles, no camera easing, figures snap.
export function motionFor({ reduced = false, lighter = false } = {}) {
  return {
    snap: reduced,
    easing: !reduced,
    animate: !reduced,
    particles: reduced ? 0 : lighter ? 160 : 700,
    shadows: !lighter,
    shadowMap: lighter ? 0 : 1024,
    glow: true,
    fps: reduced ? 2.5 : 60,
  };
}
export function pixelRatio(dpr = 1, { lighter = false } = {}) {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.min(d, lighter ? 1 : PIXEL_RATIO_CAP);
}

// Day and night rig from lightAt(): sun or moon, sky, window glow, fireplace.
export function lightRig(phase = 'day') {
  const R = {
    day: { sky: '#a9d3ec', fog: '#cfe3ee', sun: { color: '#fff1d6', intensity: 2.4, pos: [14, 22, 10] }, hemi: { sky: '#dfefff', ground: '#6b5240', intensity: 0.9 }, windows: 0.0, fire: 1.4, lampsOn: false, stars: false },
    dawn: { sky: '#f0b996', fog: '#e8c2a8', sun: { color: '#ffc49a', intensity: 1.3, pos: [-18, 8, 6] }, hemi: { sky: '#ffd9c0', ground: '#5a4034', intensity: 0.6 }, windows: 0.6, fire: 1.8, lampsOn: true, stars: false },
    dusk: { sky: '#b97487', fog: '#a77382', sun: { color: '#ff9e6e', intensity: 1.0, pos: [18, 7, -4] }, hemi: { sky: '#d6a0b8', ground: '#3e2c2a', intensity: 0.5 }, windows: 0.85, fire: 2.0, lampsOn: true, stars: false },
    night: { sky: '#141c3c', fog: '#1a2244', sun: { color: '#9fb4ff', intensity: 0.35, pos: [-10, 18, -12] }, hemi: { sky: '#3a4a80', ground: '#1a1210', intensity: 0.28 }, windows: 1.0, fire: 2.6, lampsOn: true, stars: true },
  };
  return R[phase] || R.day;
}

// Camera presets: the whole lodge, the great room, the kitchen, the garden and each AI's room.
export function presets(world, names = {}) {
  const b = lodgeBounds(world);
  const span = Math.max(b.maxX - b.minX, (b.maxZ - b.minZ) * 1.6);
  const out = [{ id: 'lodge', label: 'Whole lodge', target: { x: 0, y: 0, z: 1 }, dist: span * 0.8, phi: 0.92, theta: 0.3 }];
  const rect = (x0, y0, w, h) => { const a = tileTo3D(world, x0, y0); const c = tileTo3D(world, x0 + w - 1, y0 + h - 1); return { x: (a.x + c.x) / 2, y: 0, z: (a.z + c.z) / 2 }; };
  out.push({ id: 'great', label: 'Great room', target: rect(1, 6, world.w - 2, 8), dist: Math.max(14, world.w * 0.55), phi: 0.85, theta: 0.18 });
  if (world.kitchen) { const k = world.kitchen; out.push({ id: 'kitchen', label: 'Kitchen nook', target: rect(k.x0, k.y0, k.w, k.h), dist: 9, phi: 0.8, theta: 0.3 }); }
  if (world.courtyard) { const c = world.courtyard; out.push({ id: 'garden', label: 'Garden', target: rect(c.x0, c.y0, c.w, c.h), dist: 9, phi: 0.75, theta: -0.2 }); }
  for (const r of world.rooms) out.push({ id: `room:${r.id}`, label: `${names[r.id] || r.id}’s room`, target: rect(r.x0, r.y0, r.w, r.h), dist: 7.5, phi: 0.78, theta: r.side === 'top' ? 0.15 : 0.15 });
  return out;
}

// Effects in the 2D engine use base-canvas pixels (16 per tile); 3D wants tiles.
export const pxToTile = (v, tile = 16) => v / tile;

// What forces the static lodge to be rebuilt (furniture, names, notes, garden...).
export function sceneKey({ world, agents = {}, store = {}, notes = [], garden = {} }) {
  return [
    world?.ids?.join(','), world?.w,
    Object.values(agents).map((a) => `${a.id}:${a.color}:${a.name}`).join(','),
    JSON.stringify(world?.rooms?.map((r) => r.extras.map((p) => [p.kind, p.x, p.y])) || []),
    JSON.stringify(Object.entries(store.ai || {}).map(([k, a]) => [k, a.plate, a.rug, Object.keys(a.ach || {}).length])),
    Object.keys(store.trophies || {}).sort().join(),
    JSON.stringify(notes.map((n) => [n.id, n.text])),
    (garden.stages || []).join(''), garden.wilt,
  ].join('#');
}

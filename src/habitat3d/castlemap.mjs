// Habitat 3D (2.4): the castle city. Pure layout and mapping, no DOM and no
// three.js, unit tested with node --test.
//
// The 2D Habitat's tile grid stays the single source of truth (../habitat/world.mjs
// and life.mjs run underneath). 3D only places it: each AI's room becomes that AI's
// own house on the city street, the great room, kitchen, garden and fireside nook
// become the keep's great hall and its courtyard, and the owner's study becomes the
// King's Chambers at the top of the keep. A tile is placed by its zone; within a
// zone tiles keep their relative positions, so desks, beds and doors line up.

// ---------- zones ----------
// Rooms own their walls and door (the ring one tile around their interior).
export function roomZoneRect(r) { return { x0: r.x0 - 1, y0: r.y0 - 1, x1: r.x0 + r.w, y1: r.y0 + r.h }; }
const STUDY_RECT = { x0: -7, y0: 4, x1: -1, y1: 9 }; // the study (-6..-1, 5..8) and its walls; its door (0,7) is the hall's
// zoneOf: { kind: 'house', id } | { kind: 'chambers' } | { kind: 'keep' }
export function zoneOf(world, x, y) {
  const tx = Math.round(x); const ty = Math.round(y);
  if (tx >= STUDY_RECT.x0 && tx <= STUDY_RECT.x1 && ty >= STUDY_RECT.y0 && ty <= STUDY_RECT.y1 && tx < 0) return { kind: 'chambers' };
  for (const r of world?.rooms || []) {
    const z = roomZoneRect(r);
    if (tx >= z.x0 && tx <= z.x1 && ty >= z.y0 && ty <= z.y1) return { kind: 'house', id: r.id };
  }
  return { kind: 'keep' };
}
export const zoneKey = (z) => (z.kind === 'house' ? `house:${z.id}` : z.kind);

// ---------- the city's layout (tile units, 1 tile ~ 1 metre) ----------
export const HOUSE_GAP = 11;      // centre to centre along the street
export const CHAMBERS_Y = 9;      // the King's Chambers' floor height, on top of the keep
export function castleLayout(world) {
  const w = world?.w || 31; const h = world?.h || 20;
  const keep = { rx: Math.max(28, w / 2 + 9), rz: h / 2 + 11 };        // the keep's own walled ring (an ellipse of towers)
  const street = { z: keep.rz + 16 };                                    // the AIs' street, east-west
  const top = (world?.rooms || []).filter((r) => r.side !== 'bottom');
  const bottom = (world?.rooms || []).filter((r) => r.side === 'bottom');
  const houses = {};
  const row = (list, z, side) => list.forEach((r, i) => { houses[r.id] = { id: r.id, x: (i - (list.length - 1) / 2) * HOUSE_GAP, z, side, door: side === 'north' ? 'south' : 'north', i }; });
  // Top rooms open to the south (their door is on the room's bottom wall): they stand on the street's north side.
  row(top, street.z - 6, 'north');
  row(bottom, street.z + 6, 'south');
  const halfStreet = Math.max(30, ((Math.max(top.length, bottom.length) - 1) / 2) * HOUSE_GAP + 10);
  const city = { cx: 0, cz: street.z * 0.42, r: Math.max(64, street.z + 34, halfStreet + 24) };
  const gate = { x: 0, z: city.cz + city.r };
  const keepGate = { x: 0, z: keep.rz };
  const tower = { x: 0, z: -(h / 2) - 5, w: 11, d: 9 };                  // the keep tower, the King's Chambers on top
  const market = { x: -Math.min(26, halfStreet - 4), z: street.z + 22, r: 9 };
  return { w, h, keep, street, houses, halfStreet, city, gate, keepGate, tower, market };
}

// ---------- tile -> 3D ----------
// Returns { x, y, z, zone } with y the floor height there.
export function place3D(world, x, y, L = castleLayout(world)) {
  const z = zoneOf(world, x, y);
  if (z.kind === 'house') {
    const r = world.rooms.find((q) => q.id === z.id); const H = L.houses[z.id];
    const zr = roomZoneRect(r); const cx = (zr.x0 + zr.x1) / 2; const cy = (zr.y0 + zr.y1) / 2;
    return { x: H.x + (x - cx), y: 0, z: H.z + (y - cy), zone: z };
  }
  if (z.kind === 'chambers') {
    const cx = (STUDY_RECT.x0 + STUDY_RECT.x1) / 2; const cy = (STUDY_RECT.y0 + STUDY_RECT.y1) / 2;
    return { x: L.tower.x + (x - cx), y: CHAMBERS_Y, z: L.tower.z + (y - cy), zone: z };
  }
  return { x: x - L.w / 2 + 0.5, y: 0, z: y - L.h / 2 + 0.5, zone: z };
}

// The walk between an AI's house and the great hall, through town and the keep gate.
// a, b: 3D points ({x,z}) of where it leaves and where it arrives; returns the polyline.
export function routeBetween(world, from, to, a, b, L = castleLayout(world)) {
  const out = [{ x: a.x, z: a.z }];
  const leg = (zone, p, outward) => {
    if (zone.kind !== 'house') return [];
    const H = L.houses[zone.id];
    const doorZ = H.side === 'north' ? H.z + 3.5 : H.z - 3.5;
    const pts = [{ x: H.x, z: doorZ }, { x: H.x, z: L.street.z }, { x: 0, z: L.street.z }, { x: 0, z: L.keepGate.z + 1 }];
    return outward ? pts : pts.reverse();
  };
  if (from.kind === 'house' && to.kind === 'house') { out.push(...leg(from, a, true).slice(0, 3)); out.push(...leg(to, b, false).slice(1)); }
  else { out.push(...leg(from, a, true)); if (from.kind !== 'house' && to.kind === 'house') out.push({ x: 0, z: L.keepGate.z - 2 }); out.push(...leg(to, b, false)); if (from.kind === 'house' && to.kind !== 'house') out.push({ x: 0, z: L.keepGate.z - 2 }); }
  out.push({ x: b.x, z: b.z });
  return out.filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.z - arr[i - 1].z) > 0.05);
}
export const pathLength = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0), 0);
export function alongPath(pts, d) {
  let left = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]; const b = pts[i]; const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= seg || i === pts.length - 1) { const k = seg ? Math.min(1, left / seg) : 1; return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: Math.atan2(b.x - a.x, b.z - a.z) }; }
    left -= seg;
  }
  const p = pts[pts.length - 1]; return { x: p.x, z: p.z, yaw: 0 };
}

// Where each habitat state puts an AI in the castle (for the camera, tooltips and tests).
export function placeOf(beh = {}, actor = {}, world = null) {
  const z = world ? zoneOf(world, actor.x ?? 0, actor.y ?? 0) : null;
  if (z?.kind === 'house') return beh.mode === 'sleep' || actor.pose === 'sleep' ? 'home-asleep' : 'home';
  if (actor.mode === 'desk' || beh.mode === 'work' || beh.mode === 'review') return 'great-hall-desk';
  if (actor.goal === 'coffee' || actor.goal === 'visit') return 'great-hall-tea';
  if (actor.goal === 'garden' || actor.goal === 'water') return 'keep-garden';
  return z?.kind === 'chambers' ? 'chambers' : 'great-hall';
}

// ---------- the time of day ----------
export const TIMES = ['auto', 'day', 'sunset', 'night'];
// The owner's override wins; auto follows the Habitat's clock (lightAt's phase).
export function timeOfDay(pref, clockPhase = 'day') {
  if (pref === 'day') return 'day';
  if (pref === 'sunset') return 'dusk';
  if (pref === 'night') return 'night';
  return ['day', 'dawn', 'dusk', 'night'].includes(clockPhase) ? clockPhase : 'day';
}

// ---------- characters ----------
// Original anime-style characters only: built from these parts, never named after
// or copied from characters in existing anime or games.
export const HAIR = ['soft', 'bob', 'long', 'twin', 'pony', 'spiky'];
export const ACCESSORIES = ['none', 'glasses', 'catears', 'headphones', 'ribbon'];
export const EXPRESSIONS = ['smile', 'happy', 'focused', 'calm'];
export const HAIR_COLORS = ['#f2a65a', '#2f3a4f', '#f7d76b', '#e9e4f2', '#6b3f2a', '#ff7a59', '#9a7cff', '#3a2a22', '#ff8fb1', '#7fc8a9', '#c7d4e8', '#20242c'];
export const EYE_COLORS = ['#6b4fd8', '#2fbf8f', '#e0607e', '#d13f3f', '#4a7bd1', '#3fb8c9', '#f2c14e', '#7a5c3c'];
export const SKINS = ['#ffe2cf', '#f6d2b5', '#e9bf98', '#d6a27a', '#b9805a', '#8f5f3f'];
export const OUTFITS = {
  scholar: { label: 'Scholar', outfit: '#f4f1ea', trim: '#ec7552' },
  ranger: { label: 'Ranger', outfit: '#3d7a5c', trim: '#f4f1ea' },
  school: { label: 'School', outfit: '#1f3a5f', trim: '#f2c14e' },
  pilot: { label: 'Pilot', outfit: '#e8eef5', trim: '#3fb8c9' },
  knight: { label: 'Knight', outfit: '#5c6b80', trim: '#e8c35a' },
  cozy: { label: 'Cozy', outfit: '#c86b4a', trim: '#ffd7a8' },
  mage: { label: 'Mage', outfit: '#2b3a67', trim: '#f2c14e' },
  noble: { label: 'Noble', outfit: '#7a2e4a', trim: '#ffd27a' },
};
const HEX = /^#[0-9a-f]{6}$/i;
export const DEFAULT_CHAR = { name: '', hair: 'soft', hairColor: '#f2a65a', eyes: '#6b4fd8', skin: '#ffe2cf', outfit: 'scholar', accessory: 'none', expression: 'smile' };
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>`"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
export function normChar(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    name: cleanName(o.name),
    hair: HAIR.includes(o.hair) ? o.hair : DEFAULT_CHAR.hair,
    hairColor: HEX.test(o.hairColor || '') ? o.hairColor.toLowerCase() : DEFAULT_CHAR.hairColor,
    eyes: HEX.test(o.eyes || '') ? o.eyes.toLowerCase() : DEFAULT_CHAR.eyes,
    skin: HEX.test(o.skin || '') ? o.skin.toLowerCase() : DEFAULT_CHAR.skin,
    outfit: Object.hasOwn(OUTFITS, o.outfit) ? o.outfit : DEFAULT_CHAR.outfit,
    accessory: ACCESSORIES.includes(o.accessory) ? o.accessory : DEFAULT_CHAR.accessory,
    expression: EXPRESSIONS.includes(o.expression) ? o.expression : DEFAULT_CHAR.expression,
  };
}
// The 12 ready-made originals (from the approved mockup).
export const ROSTER = [
  { name: 'Ren', role: 'Wandering scholar', tag: 'fantasy', hair: 'soft', hairColor: '#f2a65a', eyes: '#6b4fd8', outfit: 'scholar', accessory: 'none', expression: 'calm' },
  { name: 'Kaede', role: 'Ranger', tag: 'fantasy', hair: 'pony', hairColor: '#2f3a4f', eyes: '#2fbf8f', outfit: 'ranger', accessory: 'headphones', expression: 'happy' },
  { name: 'Miko', role: 'Shrine apprentice', tag: 'cozy', hair: 'twin', hairColor: '#f7d76b', eyes: '#e0607e', outfit: 'pilot', accessory: 'catears', expression: 'smile' },
  { name: 'Sable', role: 'Night alchemist', tag: 'fantasy', hair: 'spiky', hairColor: '#e9e4f2', eyes: '#d13f3f', outfit: 'mage', accessory: 'glasses', expression: 'calm' },
  { name: 'Tomo', role: 'Class rep', tag: 'school', hair: 'bob', hairColor: '#6b3f2a', eyes: '#4a7bd1', outfit: 'school', accessory: 'ribbon', expression: 'smile' },
  { name: 'Juno', role: 'Starship pilot', tag: 'scifi', hair: 'spiky', hairColor: '#ff7a59', eyes: '#3fb8c9', outfit: 'pilot', accessory: 'headphones', expression: 'happy' },
  { name: 'Hoshi', role: 'Stargazer', tag: 'cozy', hair: 'long', hairColor: '#9a7cff', eyes: '#f2c14e', outfit: 'mage', accessory: 'none', expression: 'calm' },
  { name: 'Riku', role: 'Blacksmith', tag: 'fantasy', hair: 'soft', hairColor: '#3a2a22', eyes: '#7a5c3c', outfit: 'cozy', accessory: 'none', expression: 'focused' },
  { name: 'Nao', role: 'Hacker', tag: 'scifi', hair: 'bob', hairColor: '#20242c', eyes: '#2fbf8f', outfit: 'knight', accessory: 'glasses', expression: 'focused' },
  { name: 'Lumi', role: 'Café owner', tag: 'cozy', hair: 'pony', hairColor: '#ff8fb1', eyes: '#7a5c3c', outfit: 'scholar', accessory: 'ribbon', expression: 'happy' },
  { name: 'Aster', role: 'Knight', tag: 'fantasy', hair: 'long', hairColor: '#c7d4e8', eyes: '#4a7bd1', outfit: 'knight', accessory: 'none', expression: 'focused' },
  { name: 'Pip', role: 'Club leader', tag: 'school', hair: 'twin', hairColor: '#ff8fb1', eyes: '#4a7bd1', outfit: 'scholar', accessory: 'catears', expression: 'happy' },
].map((c) => ({ ...normChar(c), role: c.role, tag: c.tag }));
// The owner's default: a noble look for the King's Chambers.
export const OWNER_DEFAULT = normChar({ name: 'You', hair: 'soft', hairColor: '#3a2a22', eyes: '#4a7bd1', outfit: 'noble', accessory: 'none', expression: 'smile' });
// Saved characters: { owner: char|null, ai: { [id]: char } }. Nothing here ever saves on its own.
export function normCharacters(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const ai = {};
  if (o.ai && typeof o.ai === 'object') for (const [k, v] of Object.entries(o.ai)) if (/^[a-z0-9_-]{1,32}$/i.test(k) && v && typeof v === 'object') ai[k] = normChar(v);
  return { owner: o.owner && typeof o.owner === 'object' ? normChar(o.owner) : null, ai };
}
export function withCharacter(chars, who, spec) {
  const c = normCharacters(chars);
  if (who === 'owner') c.owner = normChar(spec);
  else if (/^[a-z0-9_-]{1,32}$/i.test(who || '')) c.ai[who] = normChar(spec);
  return c;
}
// What shows when nothing was saved: roster characters in order (not written anywhere).
export function charFor(chars, who, order = []) {
  const c = normCharacters(chars);
  if (who === 'owner') return c.owner || OWNER_DEFAULT;
  if (c.ai[who]) return c.ai[who];
  const i = Math.max(0, order.indexOf(who));
  return ROSTER[i % ROSTER.length];
}
export const outfitColors = (c) => OUTFITS[c.outfit] || OUTFITS.scholar;
// Surprise me / townsfolk looks: a seeded random original.
export function randomChar(seed = 1) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const pick = (a) => a[Math.floor(r() * a.length)];
  return normChar({ hair: pick(HAIR), hairColor: pick(HAIR_COLORS), eyes: pick(EYE_COLORS), skin: pick(SKINS), outfit: pick(Object.keys(OUTFITS)), accessory: r() < 0.6 ? 'none' : pick(ACCESSORIES), expression: pick(EXPRESSIONS) });
}

// ---------- townsfolk and guards (ambient only, never tied to agents) ----------
function rng(seed) { let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
// The wall ring of the city, as tower points (the same points castle.mjs builds).
export function cityTowers(L, n = 12) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + Math.PI / 2; out.push({ x: L.city.cx + Math.cos(a) * L.city.r, z: L.city.cz + Math.sin(a) * L.city.r }); }
  return out;
}
export function keepTowers(L, n = 8) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + Math.PI / 2 + Math.PI / n; out.push({ x: Math.cos(a) * L.keep.rx, z: Math.sin(a) * L.keep.rz }); }
  return out;
}
// Spots townsfolk walk between: the market, the well, stalls, the street, the town's houses.
export function folkSpots(L, houses) {
  return [
    { kind: 'market', x: L.market.x, z: L.market.z },
    { kind: 'well', x: L.market.x + 4, z: L.market.z - 3 },
    { kind: 'street', x: -L.halfStreet + 6, z: L.street.z },
    { kind: 'street', x: L.halfStreet - 6, z: L.street.z },
    { kind: 'road', x: 0, z: (L.street.z + L.gate.z) / 2 },
    ...houses.slice(0, 18).map((h) => ({ kind: 'home', x: h.door.x, z: h.door.z })),
  ];
}
export const MARKET_STALLS = 6;
export const FOLK_KINDS = ['merchant', 'child', 'baker', 'farmer', 'chatter', 'walker', 'cat'];
// counts: off -> none; Lighter 3D -> a few; reduced motion keeps them but still.
export function folkCount({ on = true, lighter = false } = {}) { return on ? (lighter ? 12 : 34) : 0; }
export function guardCount({ on = true, lighter = false } = {}) { return on ? (lighter ? 4 : 12) : 0; }
// The town's people: seeded so screenshots and tests are stable.
export function townsfolk(L, houses, n, seed = 24) {
  const r = rng(seed); const spots = folkSpots(L, houses); const out = [];
  for (let i = 0; i < n; i++) {
    const nm = n >= 20 ? 6 : 3; // a merchant at each stall (MARKET_STALLS), fewer in Lighter 3D
    const kind = i < nm ? 'merchant' : i < nm + 2 ? 'cat' : FOLK_KINDS[1 + Math.floor(r() * (FOLK_KINDS.length - 2))];
    const home = houses.length ? houses[Math.floor(r() * houses.length)].door : { x: L.market.x, z: L.market.z + 6 };
    let path;
    if (kind === 'merchant') { const a = (i / nm) * Math.PI * 2; path = [{ x: L.market.x + Math.cos(a) * 5.6, z: L.market.z + Math.sin(a) * 5.6 }]; }
    else if (kind === 'child' || kind === 'cat') { const c = spots[1]; const rad = kind === 'cat' ? 3 : 2.2; path = Array.from({ length: 6 }, (_, k) => ({ x: c.x + Math.cos(k + i) * rad, z: c.z + Math.sin(k * 1.3 + i) * rad })); }
    else if (kind === 'farmer') path = [home, { x: 0, z: L.street.z }, { x: 0, z: L.gate.z - 2 }, { x: 0, z: L.gate.z + 14 }, { x: -18, z: L.gate.z + 22 }];
    else if (r() < 0.55) { // browsing the market: a slow loop between the stalls
      const a0 = r() * Math.PI * 2; const rad = 3.2 + r() * 2.2;
      path = Array.from({ length: 4 }, (_, k) => ({ x: L.market.x + Math.cos(a0 + k * 1.4) * rad, z: L.market.z + Math.sin(a0 + k * 1.4) * rad }));
    } else { const a = spots[Math.floor(r() * spots.length)]; const b = spots[Math.floor(r() * spots.length)]; path = [home, { x: a.x, z: a.z }, { x: b.x, z: b.z }]; }
    out.push({ i, kind, look: randomChar(seed * 97 + i * 13), home, path, speed: kind === 'cat' ? 1.1 : kind === 'child' ? 1.6 : 1.2, offset: r() * 1000, nightOut: r() < 0.22, small: kind === 'child', cat: kind === 'cat' });
  }
  return out;
}
// Where one of them is at t seconds. Ping-pong along the path; at night most are at home.
export function folkAt(f, t, phase = 'day', { still = false } = {}) {
  const home = phase === 'night' && !f.nightOut && f.kind !== 'cat';
  if (home || (phase === 'dusk' && f.kind === 'child')) return { x: f.home.x, z: f.home.z, visible: false, moving: false, yaw: 0 };
  if (f.path.length === 1) return { x: f.path[0].x, z: f.path[0].z, visible: true, moving: false, yaw: Math.atan2(-f.path[0].x, -f.path[0].z) };
  const len = pathLength(f.path); if (!len) return { x: f.path[0].x, z: f.path[0].z, visible: true, moving: false, yaw: 0 };
  const d = still ? (f.offset % len) : ((t * f.speed + f.offset) % (len * 2));
  const back = d > len; const p = alongPath(back ? [...f.path].reverse() : f.path, back ? d - len : d);
  return { x: p.x, z: p.z, visible: true, moving: !still, yaw: p.yaw };
}
// Guards: wall walkers between two towers, and posts at the gatehouse and the keep gate.
// Shift change at dusk: the night watch carries torches.
export function guards(L, n, seed = 5) {
  const r = rng(seed); const T = cityTowers(L); const out = [];
  const posts = [{ x: L.gate.x - 3, z: L.gate.z - 4 }, { x: L.gate.x + 3, z: L.gate.z - 4 }, { x: L.keepGate.x - 2.5, z: L.keepGate.z + 2 }, { x: L.keepGate.x + 2.5, z: L.keepGate.z + 2 }];
  for (let i = 0; i < n; i++) {
    if (i < posts.length) { out.push({ i, kind: 'post', path: [posts[i]], wall: false, offset: 0, speed: 0 }); continue; }
    const k = Math.floor(r() * T.length); const a = T[k]; const b = T[(k + 1) % T.length];
    out.push({ i, kind: 'patrol', path: [a, b], wall: true, offset: r() * 100, speed: 0.9 });
  }
  return out;
}
export function guardAt(g, t, phase = 'day', { still = false } = {}) {
  const torch = phase === 'night' || phase === 'dusk';
  if (g.kind === 'post') return { x: g.path[0].x, z: g.path[0].z, visible: true, moving: false, yaw: 0, torch };
  const p = folkAt({ ...g, home: g.path[0], nightOut: true, kind: 'guard' }, t, 'day', { still });
  return { ...p, torch };
}
export const WALL_TOP = 7;

// ---------- raids (cartoon, family-friendly: hits flash and knock back, beaten
// raiders get dizzy stars and run off; no blood) ----------
export const RAID_FREQ = { rare: 1, sometimes: 3, often: 6 };          // raids per day
export const RAID_LEN = 95;                                            // seconds, march to the last one running off
export function normRaids(raw, { lighter = false, reduced = false } = {}) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const set = typeof o.on === 'boolean';
  return { on: set ? o.on : !(lighter || reduced), freq: Object.hasOwn(RAID_FREQ, o.freq) ? o.freq : 'sometimes', explicit: set };
}
// When raids start on a given day: seeded by the date, spread out, never in the first
// minutes after midnight. Returns start times (ms) for that local day.
export function raidTimes(dayStartMs, freq = 'sometimes', seed = 11) {
  const n = RAID_FREQ[freq] || 3; const day = Math.floor(dayStartMs / 864e5);
  const r = rng(seed * 7919 + day); const slot = 864e5 / n; const out = [];
  for (let i = 0; i < n; i++) out.push(Math.round(dayStartMs + i * slot + (0.15 + r() * 0.7) * slot));
  return out;
}
export function raidAt(nowMs, dayStartMs, freq = 'sometimes') {
  for (const t of raidTimes(dayStartMs, freq)) if (nowMs >= t && nowMs < t + RAID_LEN * 1000) return t;
  return null;
}
// One raid, worked out from its seed: who comes, when each is beaten, which guard gets dazed.
// defenders: AI ids that are idle or on a break (never one working on a task).
export function planRaid(seed, L, defenders = []) {
  const r = rng(seed); const n = 4 + Math.floor(r() * 5);
  const raiders = Array.from({ length: n }, (_, i) => ({
    i, look: { ...randomChar(seed * 31 + i), outfit: ['cozy', 'ranger', 'noble'][i % 3] }, hp: 100,
    lane: (i - (n - 1) / 2) * 1.6, arrive: 18 + i * 1.2 + r() * 3,
    beaten: 34 + i * 6 + r() * 10, poof: r() < 0.35,
  }));
  const credit = {}; const ds = defenders.slice(0, 3);
  raiders.forEach((x, i) => { const who = ds.length && r() < 0.6 ? ds[i % ds.length] : null; x.by = who; if (who) credit[who] = (credit[who] || 0) + 1; });
  return { seed, raiders, defenders: ds, credit, dazed: { guard: Math.floor(r() * 2), at: 40 + r() * 15, back: 75 + r() * 10 }, start: { x: 0, z: L.gate.z + 46 }, front: { x: 0, z: L.gate.z + 5 } };
}
// The scene at s seconds into the raid: raiders, their health, arrows in the air.
export function raidState(plan, s) {
  const out = { raiders: [], arrows: [], done: s >= RAID_LEN, fighting: s >= 16 && s < RAID_LEN - 8 };
  for (const x of plan.raiders) {
    const march = Math.min(1, s / x.arrive);
    let z = plan.start.z + (plan.front.z - plan.start.z) * march; let mode = march < 1 ? 'march' : 'fight';
    let hp = 100; let flash = false; let knock = 0;
    if (s >= x.arrive) {
      const k = Math.min(1, (s - x.arrive) / Math.max(1, x.beaten - x.arrive));
      hp = Math.max(0, Math.round(100 * (1 - k)));
      const hitPhase = ((s - x.arrive) * 1.7 + x.i) % 2.4; flash = hp > 0 && hitPhase < 0.18; knock = flash ? 0.6 : 0;
    }
    if (s >= x.beaten) { const a = s - x.beaten; mode = a < 2.2 ? 'dizzy' : x.poof ? 'poof' : 'flee'; z = plan.front.z + knock + (mode === 'flee' ? (a - 2.2) * 6 : 0); hp = 0; }
    const gone = (mode === 'poof' && s - x.beaten > 3) || (mode === 'flee' && z > plan.start.z);
    out.raiders.push({ i: x.i, x: x.lane, z: z + knock, hp, mode, flash, visible: !gone, look: x.look, by: x.by });
  }
  // arrows and bolts: from wall guards near the gate, arcing down onto living raiders
  const live = out.raiders.filter((x) => x.visible && x.hp > 0 && x.mode === 'fight');
  if (live.length) for (let k = 0; k < 3; k++) {
    const ph = (s * 0.9 + k * 0.37) % 1; const tg = live[(Math.floor(s * 0.9 + k * 0.37) + k) % live.length];
    out.arrows.push({ from: { x: (k - 1) * 6, y: WALL_TOP + 1.2, z: plan.front.z - 9 }, to: { x: tg.x, y: 0.8, z: tg.z }, k: ph, bolt: k === 1 });
  }
  return out;
}
export function guardDazed(plan, s, guardIndex) { return guardIndex === plan.dazed.guard && s >= plan.dazed.at && s < plan.dazed.back; }
// The tally kept per AI in the Habitat store (never reset by itself).
export function addRaidWins(raids, credit) {
  const o = { ...(raids && typeof raids === 'object' ? raids : {}) };
  for (const [k, v] of Object.entries(credit || {})) if (/^[a-z0-9_-]{1,32}$/i.test(k) && Number.isInteger(v) && v > 0) o[k] = Math.min(1e6, (Number.isInteger(o[k]) ? o[k] : 0) + v);
  return o;
}

// ---------- the town's own houses (not the AIs'): seeded, clear of roads and squares ----------
export function townHouses(L, max = 90, seed = 7) {
  const r = rng(seed); const out = [];
  const clear = (x, z, rad) => {
    if (Math.abs(x) < 4.5 + rad && z > L.keepGate.z - 2) return false;                      // the main road
    if (Math.abs(z - L.street.z) < 11 + rad && Math.abs(x) < L.halfStreet + 6) return false; // the AIs' street and houses
    if ((x / (L.keep.rx + 6 + rad)) ** 2 + (z / (L.keep.rz + 6 + rad)) ** 2 < 1) return false; // the keep's ring
    if (Math.hypot(x - L.market.x, z - L.market.z) < L.market.r + 3 + rad) return false;
    if (Math.hypot(x - L.city.cx, z - L.city.cz) > L.city.r - 7 - rad) return false;          // inside the city wall
    return out.every((h) => Math.hypot(h.x - x, h.z - z) > rad + h.rad + 1.2);
  };
  for (let i = 0; i < max * 12 && out.length < max; i++) {
    const a = r() * Math.PI * 2; const d = Math.sqrt(r()) * L.city.r;
    const x = L.city.cx + Math.cos(a) * d; const z = L.city.cz + Math.sin(a) * d;
    const w = 3.6 + r() * 2.4; const dd = 3.4 + r() * 2.2; const rad = Math.hypot(w, dd) / 2;
    if (!clear(x, z, rad)) continue;
    const yaw = Math.round(Math.atan2(-x, -(z - L.city.cz)) / (Math.PI / 2)) * (Math.PI / 2);
    out.push({ x, z, w, d: dd, h: 2.8 + r() * 2.6, rad, yaw, wall: Math.floor(r() * 6), roof: Math.floor(r() * 8), door: { x: x + Math.sin(yaw) * (dd / 2 + 0.8), z: z + Math.cos(yaw) * (dd / 2 + 0.8) } });
  }
  return out;
}

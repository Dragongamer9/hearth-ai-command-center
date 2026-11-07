// Habitat 3D (2.4): the castle city around the keep. City walls with round towers
// and a gatehouse, the town and its market, the AIs' houses on their street, the
// keep's own walled ring, the keep tower with the King's Chambers on top, and the
// forest, river and fields outside. Built once per world; cel-shaded and inked.
import * as THREE from '../vendor/three/three.module.min.js';
import { toon, inked, PASTEL } from './toon.mjs';
import { stoneTex } from './textures.mjs';
import { cityTowers, keepTowers, townHouses, roomZoneRect, CHAMBERS_Y, WALL_TOP, MARKET_STALLS } from './castlemap.mjs';

function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function put(parent, geo, mat, x, y, z, o = {}) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  if (o.ry) m.rotation.y = o.ry; if (o.rx) m.rotation.x = o.rx; if (o.rz) m.rotation.z = o.rz;
  m.castShadow = o.cast !== false; m.receiveShadow = true;
  if (o.ink) inked(m, o.ink === true ? 1.035 : o.ink);
  parent.add(m); return m;
}
const G = {};
const geo = (k, f) => (G[k] ||= f());

function wallRun(g, a, b, h, t, mat, crenMat, { ink = true } = {}) {
  const dx = b.x - a.x; const dz = b.z - a.z; const L = Math.hypot(dx, dz); const ry = -Math.atan2(dz, dx);
  put(g, new THREE.BoxGeometry(L, h, t), mat, (a.x + b.x) / 2, h / 2, (a.z + b.z) / 2, { ry, ink });
  put(g, new THREE.BoxGeometry(L, 0.35, t + 0.6), crenMat, (a.x + b.x) / 2, h, (a.z + b.z) / 2, { ry, cast: false });
  const n = Math.floor(L / 2.2); const cg = geo(`cren:${t}`, () => new THREE.BoxGeometry(1.0, 1.0, t + 0.6));
  for (let i = 0; i < n; i += 2) { const f = (i + 0.5) / n; put(g, cg, mat, a.x + dx * f, h + 0.65, a.z + dz * f, { ry, ink: 1.06 }); }
}
function roundTower(g, x, z, r, h, roofColor, stone, stone2, windowMat) {
  put(g, new THREE.CylinderGeometry(r, r * 1.08, h, 14), stone, x, h / 2, z, { ink: true });
  put(g, new THREE.CylinderGeometry(r * 1.18, r * 1.18, 0.7, 14), stone2, x, h, z, { cast: false });
  const roof = put(g, new THREE.ConeGeometry(r * 1.35, r * 2.4, 14), toon(roofColor), x, h + r * 1.2 + 0.35, z, { ink: true });
  put(g, geo('slit', () => new THREE.BoxGeometry(0.5, 1.0, 0.2)), windowMat, x, h * 0.72, z + r * 0.98, { cast: false });
  return roof;
}
function flag(g, x, y, z, color) {
  put(g, geo('pole', () => new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6)), toon('#2a2230'), x, y + 1.2, z, { cast: false });
  put(g, geo('flag', () => new THREE.BoxGeometry(1.2, 0.7, 0.05)), toon(color), x + 0.6, y + 2.0, z, { cast: false });
}
function tree(g, x, z, k, r) {
  put(g, geo('trunk', () => new THREE.CylinderGeometry(0.35, 0.45, 1.8, 6)), toon(PASTEL.woodDark), x, 0.9 * k, z, { cast: false });
  const c = ['#5fae66', '#4f9e5a', '#6bb870'][Math.floor(r() * 3)];
  const cone = put(g, geo('crown', () => new THREE.ConeGeometry(1.8, 4.2, 8)), toon(c), x, 3.6 * k, z, { ink: 1.05 }); cone.scale.setScalar(k);
}

// A small house: walls, a pitched roof (hidden when the camera comes in), a door and windows.
function townHouse(g, h, windowMat) {
  const hg = new THREE.Group(); hg.position.set(h.x, 0, h.z); hg.rotation.y = h.yaw; g.add(hg);
  put(hg, new THREE.BoxGeometry(h.w, h.h, h.d), toon(PASTEL.walls[h.wall]), 0, h.h / 2, 0, { ink: true });
  const roof = put(hg, new THREE.ConeGeometry(Math.max(h.w, h.d) * 0.78, 2.4, 4), toon(PASTEL.roofs[h.roof]), 0, h.h + 1.2, 0, { ry: Math.PI / 4, ink: true });
  roof.scale.set(h.w / Math.max(h.w, h.d) * 1.05, 1, h.d / Math.max(h.w, h.d) * 1.05);
  put(hg, geo('door', () => new THREE.BoxGeometry(0.9, 1.6, 0.12)), toon(PASTEL.wood), 0, 0.8, h.d / 2 + 0.02, { cast: false });
  put(hg, geo('win', () => new THREE.BoxGeometry(0.8, 0.7, 0.1)), windowMat, h.w * 0.28, h.h * 0.6, h.d / 2 + 0.02, { cast: false });
  return hg;
}

// The AI's house shell around its room (the room's own floor, walls and furniture come
// from the lodge build, placed here by place3D). Low front, open top under a lift-off roof.
function aiHouse(g, H, room, color, name, labelTex, windowMat) {
  const zr = roomZoneRect(room); const w = zr.x1 - zr.x0 + 1.4; const d = zr.y1 - zr.y0 + 1.4;
  const hg = new THREE.Group(); hg.position.set(H.x, 0, H.z); g.add(hg);
  const wallH = 2.7; const front = H.side === 'north' ? 1 : -1; // +1: the door wall faces +z (south)
  const stone = toon(PASTEL.walls[H.i % PASTEL.walls.length]);
  put(hg, new THREE.BoxGeometry(w, 0.3, d), toon(PASTEL.paving), 0, -0.17, 0, { cast: false }); // top just under the room's own floor
  put(hg, new THREE.BoxGeometry(w, wallH, 0.35), stone, 0, wallH / 2, -front * d / 2, { ink: true });                 // back wall
  for (const sx of [-1, 1]) put(hg, new THREE.BoxGeometry(0.35, wallH * 0.7, d), stone, sx * w / 2, wallH * 0.35, 0, { ink: true });
  // the front wall, low (cut away toward the street) with a gap at the door
  const doorX = (room.door.x - (zr.x0 + zr.x1) / 2);
  const leftW = doorX + w / 2 - 0.8; const rightW = w / 2 - doorX - 0.8;
  if (leftW > 0.2) put(hg, new THREE.BoxGeometry(leftW, 0.9, 0.35), stone, -w / 2 + leftW / 2, 0.45, front * d / 2, { ink: true });
  if (rightW > 0.2) put(hg, new THREE.BoxGeometry(rightW, 0.9, 0.35), stone, w / 2 - rightW / 2, 0.45, front * d / 2, { ink: true });
  put(hg, geo('aiwin', () => new THREE.BoxGeometry(1.4, 0.9, 0.12)), windowMat, -w * 0.25, wallH * 0.62, -front * (d / 2 + 0.05), { cast: false });
  put(hg, geo('aiwin', () => new THREE.BoxGeometry(1.4, 0.9, 0.12)), windowMat, w * 0.25, wallH * 0.62, -front * (d / 2 + 0.05), { cast: false });
  const roof = put(hg, new THREE.ConeGeometry(Math.hypot(w, d) * 0.55, 3.2, 4), toon(color), 0, wallH + 1.6, 0, { ry: Math.PI / 4, ink: true });
  roof.scale.set(w / Math.hypot(w, d) * 1.45, 1, d / Math.hypot(w, d) * 1.45);
  // a hanging sign with the AI's name, beside the door
  const sign = new THREE.Mesh(geo('sign', () => new THREE.PlaneGeometry(2.4, 0.8)), new THREE.MeshBasicMaterial({ map: labelTex(name, color), transparent: true }));
  sign.position.set(doorX + 1.9, 1.6, front * (d / 2 + 0.25)); if (front < 0) sign.rotation.y = Math.PI; hg.add(sign);
  // a little porch lantern and a doormat
  put(hg, geo('mat', () => new THREE.BoxGeometry(1.2, 0.03, 0.7)), toon('#c0563f'), doorX, 0.02, front * (d / 2 + 0.6), { cast: false });
  put(hg, geo('plamp', () => new THREE.SphereGeometry(0.16, 8, 6)), new THREE.MeshBasicMaterial({ color: '#ffd27a' }), doorX - 1.0, 2.1, front * (d / 2 + 0.3), { cast: false });
  const door = { x: H.x + doorX, z: H.z + front * (d / 2 + 1.0), rot: front > 0 ? 0 : Math.PI };
  return { group: hg, roof, w, d, door };
}

const HALL_WALL = 4.2;
// Coloured stone blocks with dark mortar lines for the great hall's walls.
function hallStoneMat() {
  if (typeof document === 'undefined') return toon('#c9b8a2');
  const t = stoneTex('warm').clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.5, HALL_WALL / 2); t.needsUpdate = true;
  return toon('#e9d6bd', { map: t });
}
// The great hall's life: a red runner down the middle, arched windows and banners on
// the back wall, a big fireplace with a glow, long work tables with screens, benches,
// chandeliers. Positions come from the world (desks, doors), so it fits 1 to 12 AIs.
function hallDecor(hall, world, L, refs, windowMat) {
  const X = (tx) => tx - L.w / 2 + 0.5; const Z = (ty) => ty - L.h / 2 + 0.5;
  const zBack = Z(5) + 0.24; const g = hall;
  const top = world.rooms.filter((q) => q.side !== 'bottom');
  const doors = new Set(top.map((q) => q.door.x));
  const minX = top.length ? Math.min(...top.map((q) => roomZoneRect(q).x0)) : 1; const maxX = top.length ? Math.max(...top.map((q) => roomZoneRect(q).x1)) : 6;
  // runner rug on rows 9-10
  put(g, new THREE.BoxGeometry(L.w - 4, 0.03, 1.7), toon('#a8323e'), 0, 0.015, (Z(9) + Z(10)) / 2, { cast: false });
  put(g, new THREE.BoxGeometry(L.w - 4.6, 0.035, 1.2), toon('#e8c35a'), 0, 0.02, (Z(9) + Z(10)) / 2, { cast: false });
  put(g, new THREE.BoxGeometry(L.w - 5, 0.04, 0.9), toon('#a8323e'), 0, 0.025, (Z(9) + Z(10)) / 2, { cast: false });
  // back-wall slots: the fireplace in the widest run without doors, windows and banners elsewhere
  const cols = []; for (let x = minX; x <= maxX; x++) cols.push(x);
  const free = (x) => !doors.has(x) && !doors.has(x - 1) && !doors.has(x + 1);
  let best = null; let run = [];
  for (const x of [...cols, 9999]) { if (x !== 9999 && !doors.has(x)) run.push(x); else { if (run.length >= 3 && (!best || Math.abs(run[run.length >> 1] - (minX + maxX) / 2) < Math.abs(best[best.length >> 1] - (minX + maxX) / 2))) best = run; run = []; } }
  const fx = best ? best[best.length >> 1] : null;
  if (fx !== null) {
    const f = new THREE.Group(); f.position.set(X(fx), 0, zBack + 0.25); g.add(f);
    const fs = toon('#9a8a7c');
    put(f, new THREE.BoxGeometry(2.8, 2.2, 0.7), fs, 0, 1.1, 0, { ink: true });
    put(f, new THREE.BoxGeometry(1.7, 1.3, 0.72), toon('#2a1a18'), 0, 0.65, 0.02, { cast: false });
    put(f, new THREE.BoxGeometry(3.2, 0.24, 0.9), toon('#6d4128'), 0, 2.3, 0.05, { ink: true });
    put(f, new THREE.BoxGeometry(1.8, HALL_WALL - 2.4, 0.5), fs, 0, 2.4 + (HALL_WALL - 2.4) / 2, -0.08, { ink: true });
    const flames = new THREE.Group(); flames.position.set(0, 0.1, 0.25); f.add(flames);
    for (const [x, h, c] of [[-0.3, 0.7, '#ff8a3d'], [0.25, 0.8, '#ff8a3d'], [0, 1.0, '#ffb347'], [-0.08, 0.55, '#ffe08a'], [0.12, 0.6, '#ffe08a']]) put(flames, new THREE.ConeGeometry(0.2, h, 6), new THREE.MeshBasicMaterial({ color: c }), x, h / 2, 0, { cast: false });
    for (const x of [-0.35, 0, 0.35]) put(f, geo('log', () => new THREE.CylinderGeometry(0.09, 0.09, 0.9, 6)), toon('#6d4128'), x, 0.1, 0.25, { rx: Math.PI / 2, rz: 0.3 * x, cast: false });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(2.4, 24), new THREE.MeshBasicMaterial({ color: '#ffb35a', transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.rotation.x = -Math.PI / 2; glow.position.set(0, 0.05, 1.2); f.add(glow);
    refs.hallFire = { flames, glow, x: X(fx), z: zBack + 0.25 };
    refs.hallTea = [{ x: X(fx) - 1.2, z: zBack + 2.0, rot: Math.PI * 0.75 }, { x: X(fx) + 1.2, z: zBack + 2.0, rot: -Math.PI * 0.75 }];
  }
  const busy = new Set(fx !== null ? [fx - 2, fx - 1, fx, fx + 1, fx + 2] : []);
  let k = 0;
  for (const x of cols) {
    if (!free(x) || busy.has(x)) continue;
    if (k % 2 === 0) { // tall arched window
      put(g, geo('hwin', () => new THREE.BoxGeometry(0.8, 1.8, 0.08)), windowMat, X(x), 2.0, zBack, { cast: false });
      const arch = put(g, geo('harch', () => new THREE.CylinderGeometry(0.4, 0.4, 0.08, 14, 1, false, 0, Math.PI)), windowMat, X(x), 2.9, zBack, { cast: false }); arch.rotation.set(Math.PI / 2, 0, Math.PI / 2);
      put(g, geo('hsill', () => new THREE.BoxGeometry(1.0, 0.12, 0.2)), toon('#6d4128'), X(x), 1.05, zBack + 0.05, { cast: false });
    } else { // banner with a crest
      const c = PASTEL.roofs[(k >> 1) % PASTEL.roofs.length];
      put(g, geo('hrod', () => new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6)), toon('#e8c35a'), X(x), 3.75, zBack + 0.06, { rz: Math.PI / 2, cast: false });
      put(g, geo('hban', () => new THREE.BoxGeometry(0.85, 2.1, 0.04)), toon(c), X(x), 2.65, zBack + 0.06, { cast: false });
      put(g, geo('htip', () => new THREE.ConeGeometry(0.42, 0.4, 3)), toon(c), X(x), 1.45, zBack + 0.06, { rx: Math.PI, cast: false });
      put(g, geo('hcrest', () => new THREE.CircleGeometry(0.24, 16)), toon('#ffd27a'), X(x), 2.9, zBack + 0.09, { cast: false });
    }
    k++;
  }
  // long work tables with screens and benches, in the hall's free stretch east of the desks
  const deskMax = world.desks.length ? Math.max(...world.desks.flatMap((d) => d.tiles.map((t) => t.x))) : 0;
  const tx0 = deskMax + 2; const tx1 = Math.min(world.w - 9, tx0 + 7); // clear of the kitchen door
  if (tx1 - tx0 >= 3) {
    for (const row of [8, 11]) {
      const cx = (X(tx0) + X(tx1)) / 2; const len = X(tx1) - X(tx0) + 1; const z = Z(row);
      put(g, new THREE.BoxGeometry(len, 0.12, 1.1), toon('#8a5634'), cx, 0.78, z, { ink: true });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(g, geo('tleg', () => new THREE.BoxGeometry(0.12, 0.74, 0.12)), toon('#6d4128'), cx + sx * (len / 2 - 0.3), 0.37, z + sz * 0.42, { cast: false });
      for (const sz of [-1, 1]) put(g, new THREE.BoxGeometry(len - 0.4, 0.1, 0.36), toon('#6d4128'), cx, 0.44, z + sz * 0.95, { ink: true });
      for (let i = 0; i < Math.floor(len / 1.6); i++) {
        const x = X(tx0) + 0.5 + i * 1.6;
        put(g, geo('tscr', () => new THREE.BoxGeometry(0.62, 0.42, 0.05)), toon('#2a2230'), x, 1.1, z - 0.18, { ink: 1.06 });
        put(g, geo('tscr2', () => new THREE.PlaneGeometry(0.54, 0.34)), new THREE.MeshBasicMaterial({ color: i % 2 ? '#7fd3ff' : '#9fe3b0' }), x, 1.1, z - 0.15, { cast: false });
        put(g, geo('tkb', () => new THREE.BoxGeometry(0.42, 0.03, 0.16)), toon('#e3dcef'), x, 0.86, z + 0.12, { cast: false });
      }
    }
  }
  // chandeliers: a gold ring of candles on a chain
  const n = Math.max(2, Math.round(L.w / 10));
  for (let i = 0; i < n; i++) {
    const x = -L.w / 2 + (L.w * (i + 0.5)) / n; const z = (Z(9) + Z(10)) / 2;
    put(g, geo('chain', () => new THREE.CylinderGeometry(0.03, 0.03, 1.6, 4)), toon('#2a2230'), x, 4.6, z, { cast: false });
    put(g, geo('cring', () => new THREE.TorusGeometry(0.7, 0.06, 6, 20)), toon('#e8c35a'), x, 3.8, z, { rx: Math.PI / 2, ink: 1.08, cast: false });
    for (let j = 0; j < 6; j++) { const a = (j / 6) * Math.PI * 2; put(g, geo('cand', () => new THREE.CylinderGeometry(0.04, 0.04, 0.2, 6)), toon('#fbf3e4'), x + Math.cos(a) * 0.7, 3.95, z + Math.sin(a) * 0.7, { cast: false }); put(g, geo('cfl', () => new THREE.SphereGeometry(0.06, 6, 4)), new THREE.MeshBasicMaterial({ color: '#ffd27a' }), x + Math.cos(a) * 0.7, 4.1, z + Math.sin(a) * 0.7, { cast: false }); }
  }
}

// The market: stalls with striped awnings in a ring (a merchant stands at each, see
// townsfolk()), crates, barrels and produce, lantern posts, a cobbled ring and trees.
function buildMarket(root, L, r, stone) {
  const M0 = L.market; const N = MARKET_STALLS;
  const ring = put(root, new THREE.CylinderGeometry(M0.r + 2.2, M0.r + 2.2, 0.1, 32), toon('#cbbfa8'), M0.x, 0.06, M0.z, { cast: false }); void ring;
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; put(root, geo('cob', () => new THREE.CylinderGeometry(0.32, 0.36, 0.08, 6)), toon(i % 2 ? '#b9ab92' : '#d8ccb5'), M0.x + Math.cos(a) * (M0.r + 1.5), 0.13, M0.z + Math.sin(a) * (M0.r + 1.5), { cast: false }); }
  const goods = ['#ec7552', '#f2c14e', '#7ccf8a', '#e0607e', '#9a7cff', '#ffb347'];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2; const g = new THREE.Group(); g.position.set(M0.x + Math.cos(a) * 7.4, 0, M0.z + Math.sin(a) * 7.4); g.rotation.y = -a - Math.PI / 2; root.add(g);
    put(g, geo('stall-c', () => new THREE.BoxGeometry(2.8, 1.0, 1.2)), toon(PASTEL.wood), 0, 0.5, 0, { ink: true });
    for (const sx of [-1.3, 1.3]) for (const sz of [-0.5, 0.5]) put(g, geo('stall-p', () => new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6)), toon(PASTEL.woodDark), sx, 1.2, sz, { cast: false });
    const c1 = PASTEL.roofs[i % PASTEL.roofs.length];
    for (let k = 0; k < 5; k++) put(g, geo('awn-s', () => new THREE.BoxGeometry(0.62, 0.06, 1.7)), toon(k % 2 ? '#fbf3e4' : c1), -1.24 + k * 0.62, 2.45, 0.1, { rx: 0.28, cast: k === 2, ink: k === 0 || k === 4 ? 1.06 : false });
    for (let k = 0; k < 4; k++) put(g, geo('fruit', () => new THREE.SphereGeometry(0.16, 8, 6)), toon(goods[(i + k) % goods.length]), -0.9 + k * 0.6, 1.12, 0.1, { cast: false });
    put(g, geo('crate', () => new THREE.BoxGeometry(0.7, 0.6, 0.7)), toon('#b07a4a'), 1.9, 0.3, 0.3, { ry: 0.3, ink: true });
    put(g, geo('barrel', () => new THREE.CylinderGeometry(0.34, 0.3, 0.8, 10)), toon('#8a5634'), -1.9, 0.4, 0.4, { ink: true });
  }
  // the well, with a little roof
  const wx = M0.x + 0.2; const wz = M0.z;
  put(root, new THREE.CylinderGeometry(1.2, 1.3, 0.9, 14), stone, wx, 0.45, wz, { ink: true });
  put(root, new THREE.CylinderGeometry(0.95, 0.95, 0.05, 14), toon('#5aa9e0'), wx, 0.86, wz, { cast: false });
  for (const sx of [-1, 1]) put(root, geo('well-p', () => new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6)), toon(PASTEL.woodDark), wx + sx * 1.0, 1.4, wz, {});
  put(root, new THREE.ConeGeometry(1.7, 1.0, 4), toon('#c0563f'), wx, 2.9, wz, { ry: Math.PI / 4, ink: true });
  // lantern posts and trees around the square
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; const x = M0.x + Math.cos(a) * (M0.r + 3.4); const z = M0.z + Math.sin(a) * (M0.r + 3.4);
    put(root, geo('lp', () => new THREE.CylinderGeometry(0.08, 0.1, 3.2, 6)), toon('#2a2230'), x, 1.6, z, { cast: false });
    put(root, geo('lb', () => new THREE.SphereGeometry(0.3, 8, 6)), new THREE.MeshBasicMaterial({ color: '#ffd27a' }), x, 3.3, z, { cast: false }); }
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 1.1; tree(root, M0.x + Math.cos(a) * (M0.r + 6.5), M0.z + Math.sin(a) * (M0.r + 6.5), 0.7 + r() * 0.3, r); }
}
export function buildCastle({ world, L, agents = {}, labelTex, night = false }) {
  const root = new THREE.Group(); root.name = 'castle';
  const refs = { houseRoofs: {}, houseDoors: {}, towerRoof: null, windowMat: null, torches: [], houses: [], hallShell: null, hallTea: [], hallFire: null };
  const r = rng(7);
  const stone = toon(PASTEL.stone); const stone2 = toon(PASTEL.stone2);
  const windowMat = new THREE.MeshToonMaterial({ color: '#9fe3f0', emissive: new THREE.Color('#ffc36b'), emissiveIntensity: 0 }); refs.windowMat = windowMat;
  // land, river, hills, fields
  const R = L.city.r;
  put(root, new THREE.CircleGeometry(R + 160, 48), toon(PASTEL.grass), 0, -0.02, L.city.cz, { rx: -Math.PI / 2, cast: false });
  const river = put(root, new THREE.PlaneGeometry(24, 520), toon(night ? PASTEL.waterNight : PASTEL.water), R + 26, 0.0, L.city.cz, { rx: -Math.PI / 2, cast: false }); river.rotation.z = 0.35; refs.river = river;
  for (const [x, z, s, c] of [[-R - 70, -R - 60, 70, '#78bf6b'], [R, -R - 110, 90, '#6db260'], [-20, -R - 140, 100, '#82c575']]) put(root, new THREE.SphereGeometry(s, 20, 12), toon(c), x, -s * 0.58, z, { cast: false });
  for (const [x, z, c] of [[-R + 6, L.gate.z + 26, '#e8cf6a'], [-R + 30, L.gate.z + 34, '#a9d46b'], [-R + 4, L.gate.z + 46, '#d9b45a'], [R - 10, L.gate.z + 30, '#e8cf6a']]) put(root, new THREE.PlaneGeometry(26, 18), toon(c), x, 0.03, z, { rx: -Math.PI / 2, cast: false });
  for (let i = 0; i < 160; i++) { const a = r() * Math.PI * 2; const d = R + 12 + r() * 70; const x = Math.cos(a) * d; const z = L.city.cz + Math.sin(a) * d; if (Math.abs(x) < 10 && z > L.gate.z) continue; if (Math.abs((x - (R + 26)) * Math.cos(0.35) - (z - L.city.cz) * Math.sin(0.35)) < 18) continue; tree(root, x, z, 0.8 + r() * 0.6, r); }
  // roads
  put(root, new THREE.PlaneGeometry(6, 70), toon(PASTEL.road), 0, 0.04, L.gate.z + 30, { rx: -Math.PI / 2, cast: false });
  put(root, new THREE.PlaneGeometry(6, L.gate.z - L.keepGate.z), toon(PASTEL.road), 0, 0.05, (L.gate.z + L.keepGate.z) / 2, { rx: -Math.PI / 2, cast: false });
  put(root, new THREE.PlaneGeometry(L.halfStreet * 2 + 8, 6), toon(PASTEL.road), 0, 0.06, L.street.z, { rx: -Math.PI / 2, cast: false });
  // city wall and its towers, with the gatehouse on the south side
  const T = cityTowers(L);
  for (let i = 0; i < T.length; i++) { const a = T[i]; const b = T[(i + 1) % T.length]; wallRun(root, a, b, WALL_TOP, 2.2, stone, stone2); }
  T.forEach((p, i) => { const roof = roundTower(root, p.x, p.z, 3, 11, PASTEL.roofs[i % 5], stone, stone2, windowMat); if (i % 3 === 0) flag(root, p.x, 11 + 4, p.z, PASTEL.roofs[(i + 1) % 5]); roof.userData.cityTower = true; });
  const gh = new THREE.Group(); gh.position.set(L.gate.x, 0, L.gate.z); root.add(gh);
  put(gh, new THREE.BoxGeometry(12, 12, 8), stone2, 0, 6, 0, { ink: true });
  put(gh, new THREE.BoxGeometry(4.6, 6.5, 8.4), toon('#3a2230'), 0, 3.25, 0, { cast: false });
  for (const sx of [-1, 1]) roundTower(gh, sx * 7, 0, 3, 14, PASTEL.roofs[0], stone, stone2, windowMat);
  for (const sx of [-1, 1]) { const tq = put(gh, geo('torch', () => new THREE.SphereGeometry(0.35, 8, 6)), new THREE.MeshBasicMaterial({ color: '#ffd27a' }), sx * 3.2, 4.2, 4.3, { cast: false }); refs.torches.push(tq); }
  refs.gateFront = { x: L.gate.x, z: L.gate.z + 5 };
  // market square and well
  put(root, new THREE.CylinderGeometry(L.market.r, L.market.r, 0.12, 28), toon(PASTEL.paving), L.market.x, 0.07, L.market.z, { cast: false });
  buildMarket(root, L, r, stone);
  // the town's houses
  const houses = townHouses(L);
  for (const h of houses) townHouse(root, h, windowMat);
  refs.houses = houses;
  // the AIs' houses on their street
  for (const room of world.rooms) {
    const H = L.houses[room.id]; if (!H) continue;
    const a = agents[room.id];
    const built = aiHouse(root, H, room, a?.color || PASTEL.roofs[H.i % 8], a?.name || room.id, labelTex, windowMat);
    refs.houseRoofs[room.id] = built.roof; refs.houseDoors[room.id] = built.door;
  }
  // the keep's own ring: paving, walls with a gate, towers
  put(root, new THREE.CylinderGeometry(1, 1, 0.5, 40), toon('#86c978'), 0, -0.3, 0, { cast: false }).scale.set(L.keep.rx + 3, 1, L.keep.rz + 3);
  put(root, new THREE.CylinderGeometry(1, 1, 0.12, 40), toon(PASTEL.paving), 0, -0.09, 0, { cast: false }) /* top under the hall's floor */.scale.set(L.keep.rx - 1.5, 1, L.keep.rz - 1.5);
  const KT = keepTowers(L);
  for (let i = 0; i < KT.length; i++) {
    const a = KT[i]; const b = KT[(i + 1) % KT.length];
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    if (mid.z > 0 && Math.abs(mid.x) < 6) { // the gate in the south wall
      const gx = 2.5; const dir = { x: b.x - a.x, z: b.z - a.z }; const len = Math.hypot(dir.x, dir.z);
      const p1 = { x: mid.x - (dir.x / len) * gx, z: mid.z - (dir.z / len) * gx }; const p2 = { x: mid.x + (dir.x / len) * gx, z: mid.z + (dir.z / len) * gx };
      wallRun(root, a, p1, 5, 1.8, stone, stone2); wallRun(root, p2, b, 5, 1.8, stone, stone2);
      put(root, new THREE.BoxGeometry(6.4, 1.2, 2.2), stone2, mid.x, 5.6, mid.z, { ink: true });
    } else wallRun(root, a, b, 5, 1.8, stone, stone2);
  }
  KT.forEach((p, i) => roundTower(root, p.x, p.z, 2.6, 9, PASTEL.roofs[(i + 1) % 5], stone, stone2, windowMat));
  // the keep tower behind the great hall, the King's Chambers on its top floor
  const tw = L.tower;
  put(root, new THREE.BoxGeometry(tw.w, CHAMBERS_Y, tw.d), stone2, tw.x, CHAMBERS_Y / 2, tw.z, { ink: true });
  // the chambers' floor slab: its top is exactly CHAMBERS_Y, where the study's floor, props and people stand
  put(root, new THREE.BoxGeometry(tw.w + 0.8, 0.4, tw.d + 0.8), stone, tw.x, CHAMBERS_Y - 0.23, tw.z, { cast: false });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cx = tw.x + sx * (tw.w / 2 + 0.6); const cz = tw.z + sz * (tw.d / 2 + 0.6);
    put(root, geo('kt', () => new THREE.CylinderGeometry(1.6, 1.7, CHAMBERS_Y + 6, 12)), stone, cx, (CHAMBERS_Y + 6) / 2, cz, { ink: true });
    put(root, geo('ktr', () => new THREE.ConeGeometry(2.2, 4.6, 12)), toon('#ec7552'), cx, CHAMBERS_Y + 6 + 2.3, cz, { ink: true });
  }
  // the chambers' walls (low at the front so you can look in) and a lift-off roof
  const cw = tw.w - 1; const cd = tw.d - 1; const ch = 2.6; const top = CHAMBERS_Y;
  put(root, new THREE.BoxGeometry(cw, ch, 0.35), stone, tw.x, top + ch / 2, tw.z - cd / 2, { ink: true });
  for (const sx of [-1, 1]) put(root, new THREE.BoxGeometry(0.35, ch * 0.8, cd), stone, tw.x + sx * cw / 2, top + ch * 0.4, tw.z, { ink: true });
  put(root, new THREE.BoxGeometry(cw, 0.8, 0.35), stone, tw.x, top + 0.4, tw.z + cd / 2, { ink: true });
  refs.towerRoof = put(root, new THREE.ConeGeometry(Math.hypot(cw, cd) * 0.6, 5, 4), toon('#5b7cfa'), tw.x, top + ch + 2.5, tw.z, { ry: Math.PI / 4, ink: true });
  flag(root, tw.x, top + ch + 5, tw.z, '#ec7552');
  // the King's Chambers' own furnishings, outside the 6×4 floor he decorates: a canopy bed
  // along the east wall (the wall screen is on the west), banners and a tall window on the back wall, a carpet under it all
  const kc = new THREE.Group(); kc.name = 'kings-chambers'; root.add(kc);
  put(kc, new THREE.BoxGeometry(cw - 0.6, 0.04, cd - 0.6), toon('#b03a48'), tw.x, top + 0.02, tw.z, { cast: false });
  put(kc, new THREE.BoxGeometry(cw - 1.4, 0.05, cd - 1.4), toon('#e8c35a'), tw.x, top + 0.03, tw.z, { cast: false });
  const bx = tw.x + cw / 2 - 1.1; const bz = tw.z - cd / 2 + 1.6;
  put(kc, new THREE.BoxGeometry(1.6, 0.5, 2.4), toon('#8a5634'), bx, top + 0.25, bz, { ink: true });
  put(kc, new THREE.BoxGeometry(1.5, 0.22, 2.3), toon('#f4f1ea'), bx, top + 0.6, bz, { ink: true });
  put(kc, new THREE.BoxGeometry(1.5, 0.12, 1.4), toon('#5b7cfa'), bx, top + 0.74, bz + 0.45, { ink: true });
  for (const [dx, dz] of [[-0.75, -1.15], [0.75, -1.15], [-0.75, 1.15], [0.75, 1.15]]) put(kc, geo('kc-post', () => new THREE.CylinderGeometry(0.06, 0.06, 2.1, 6)), toon('#6d4128'), bx + dx, top + 1.05, bz + dz, {});
  put(kc, new THREE.BoxGeometry(1.7, 0.08, 2.5), toon('#b03a48'), bx, top + 2.12, bz, { ink: true });
  for (const [sx, c] of [[-1, '#ec7552'], [1, '#5b7cfa']]) {
    put(kc, new THREE.BoxGeometry(0.9, 1.6, 0.05), toon(c), tw.x + sx * 2.2, top + 1.5, tw.z - cd / 2 + 0.22, {});
    put(kc, geo('kc-crest', () => new THREE.CircleGeometry(0.22, 16)), toon('#ffd27a'), tw.x + sx * 2.2, top + 1.6, tw.z - cd / 2 + 0.25, { cast: false });
  }
  put(kc, new THREE.BoxGeometry(1.2, 1.5, 0.06), windowMat || toon('#8fd3ff'), tw.x, top + 1.5, tw.z - cd / 2 + 0.2, { cast: false });
  // a throne-like armchair by the west wall, facing into the room, on a little dais
  { const tx = tw.x - cw / 2 + 1.0; const tz = tw.z + 0.6; const th = new THREE.Group(); th.position.set(tx, top, tz); th.rotation.y = Math.PI / 2; kc.add(th);
    put(th, new THREE.BoxGeometry(1.5, 0.16, 1.4), toon('#cdc3df'), 0, 0.08, 0, { ink: true });
    put(th, new THREE.BoxGeometry(0.9, 0.45, 0.8), toon('#b03a48'), 0, 0.38, 0.05, { ink: true });
    put(th, new THREE.BoxGeometry(0.9, 1.5, 0.18), toon('#b03a48'), 0, 1.0, -0.38, { ink: true });
    put(th, new THREE.BoxGeometry(1.06, 0.2, 0.26), toon('#e8c35a'), 0, 1.8, -0.38, { ink: true });
    for (const sx of [-1, 1]) { put(th, new THREE.BoxGeometry(0.14, 0.5, 0.8), toon('#e8c35a'), sx * 0.52, 0.55, 0.05, { ink: true }); put(th, geo('th-ball', () => new THREE.SphereGeometry(0.1, 8, 6)), toon('#e8c35a'), sx * 0.45, 1.95, -0.38, { cast: false }); } }
  // two candle stands for warm light
  for (const sx of [-1, 1]) { const x = tw.x + sx * (cw / 2 - 0.5); const z = tw.z + cd / 2 - 0.7;
    put(kc, geo('cs', () => new THREE.CylinderGeometry(0.05, 0.12, 1.3, 6)), toon('#e8c35a'), x, top + 0.65, z, { cast: false });
    put(kc, geo('cf', () => new THREE.SphereGeometry(0.09, 8, 6)), new THREE.MeshBasicMaterial({ color: '#ffd27a' }), x, top + 1.38, z, { cast: false }); }
  refs.kingsChambers = kc;
  // the great hall's own walls: the band between where the rooms used to be (their
  // walls went with them to their houses), with an opening at each room door
  const hall = new THREE.Group(); hall.name = 'hall-shell'; root.add(hall); refs.hallShell = hall;
  const hallStone = hallStoneMat();
  const x0 = -L.w / 2; const x1 = L.w / 2;
  const doorXs = { top: new Set(world.rooms.filter((q) => q.side !== 'bottom').map((q) => q.door.x)), bottom: new Set(world.rooms.filter((q) => q.side === 'bottom').map((q) => q.door.x)) };
  const edge = (row, zLine, tall) => {
    const span = world.rooms.filter((q) => (row === 'top' ? q.side !== 'bottom' : q.side === 'bottom'));
    if (!span.length) return;
    const minX = Math.min(...span.map((q) => roomZoneRect(q).x0)); const maxX = Math.max(...span.map((q) => roomZoneRect(q).x1));
    for (let x = minX; x <= maxX; x++) {
      if (doorXs[row].has(x)) continue;
      put(hall, geo(`hw:${tall}`, () => new THREE.BoxGeometry(1.02, tall, 0.36)), hallStone, x - L.w / 2 + 0.5, tall / 2, zLine, { ink: 1.02, cast: tall > 1 });
    }
  };
  edge('top', 5 - L.h / 2 + 0.5, HALL_WALL);
  edge('bottom', 14 - L.h / 2 + 0.5, 0.9);
  hallDecor(hall, world, L, refs, windowMat);
  void x0; void x1;
  return { root, refs, houses };
}

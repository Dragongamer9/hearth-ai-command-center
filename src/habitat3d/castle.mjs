// Habitat 3D (2.4): the castle city around the keep. City walls with round towers
// and a gatehouse, the town and its market, the AIs' houses on their street, the
// keep's own walled ring, the keep tower with the King's Chambers on top, and the
// forest, river and fields outside. Built once per world; cel-shaded and inked.
import * as THREE from '../vendor/three/three.module.min.js';
import { toon, inked, PASTEL } from './toon.mjs';
import { cityTowers, keepTowers, townHouses, roomZoneRect, CHAMBERS_Y, WALL_TOP } from './castlemap.mjs';

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
  put(hg, new THREE.BoxGeometry(w, 0.3, d), toon(PASTEL.paving), 0, -0.14, 0, { cast: false });
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
  return { group: hg, roof, w, d };
}

export function buildCastle({ world, L, agents = {}, labelTex, night = false }) {
  const root = new THREE.Group(); root.name = 'castle';
  const refs = { houseRoofs: {}, towerRoof: null, windowMat: null, torches: [], houses: [], hallShell: null };
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
  put(root, new THREE.CylinderGeometry(1.3, 1.3, 1.2, 14), stone, L.market.x + 4, 0.6, L.market.z - 3, { ink: true });
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; const sx = L.market.x + Math.cos(a) * 6.8; const sz = L.market.z + Math.sin(a) * 6.8; put(root, geo('stall', () => new THREE.BoxGeometry(2.6, 1.3, 1.5)), toon(PASTEL.wood), sx, 0.65, sz, { ry: -a, ink: true }); put(root, geo('awn', () => new THREE.ConeGeometry(2.1, 1.1, 4)), toon(PASTEL.roofs[i]), sx, 2.1, sz, { ry: -a + Math.PI / 4, ink: true }); }
  // the town's houses
  const houses = townHouses(L);
  for (const h of houses) townHouse(root, h, windowMat);
  refs.houses = houses;
  // the AIs' houses on their street
  for (const room of world.rooms) {
    const H = L.houses[room.id]; if (!H) continue;
    const a = agents[room.id];
    const built = aiHouse(root, H, room, a?.color || PASTEL.roofs[H.i % 8], a?.name || room.id, labelTex, windowMat);
    refs.houseRoofs[room.id] = built.roof;
  }
  // the keep's own ring: paving, walls with a gate, towers
  put(root, new THREE.CylinderGeometry(1, 1, 0.5, 40), toon('#86c978'), 0, -0.2, 0, { cast: false }).scale.set(L.keep.rx + 3, 1, L.keep.rz + 3);
  put(root, new THREE.CylinderGeometry(1, 1, 0.12, 40), toon(PASTEL.paving), 0, 0.02, 0, { cast: false }).scale.set(L.keep.rx - 1.5, 1, L.keep.rz - 1.5);
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
  put(root, new THREE.BoxGeometry(tw.w + 0.8, 0.4, tw.d + 0.8), stone, tw.x, CHAMBERS_Y, tw.z, { cast: false });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cx = tw.x + sx * (tw.w / 2 + 0.6); const cz = tw.z + sz * (tw.d / 2 + 0.6);
    put(root, geo('kt', () => new THREE.CylinderGeometry(1.6, 1.7, CHAMBERS_Y + 6, 12)), stone, cx, (CHAMBERS_Y + 6) / 2, cz, { ink: true });
    put(root, geo('ktr', () => new THREE.ConeGeometry(2.2, 4.6, 12)), toon('#ec7552'), cx, CHAMBERS_Y + 6 + 2.3, cz, { ink: true });
  }
  // the chambers' walls (low at the front so you can look in) and a lift-off roof
  const cw = tw.w - 1; const cd = tw.d - 1; const ch = 2.6; const top = CHAMBERS_Y + 0.2;
  put(root, new THREE.BoxGeometry(cw, ch, 0.35), stone, tw.x, top + ch / 2, tw.z - cd / 2, { ink: true });
  for (const sx of [-1, 1]) put(root, new THREE.BoxGeometry(0.35, ch * 0.8, cd), stone, tw.x + sx * cw / 2, top + ch * 0.4, tw.z, { ink: true });
  put(root, new THREE.BoxGeometry(cw, 0.8, 0.35), stone, tw.x, top + 0.4, tw.z + cd / 2, { ink: true });
  refs.towerRoof = put(root, new THREE.ConeGeometry(Math.hypot(cw, cd) * 0.6, 5, 4), toon('#5b7cfa'), tw.x, top + ch + 2.5, tw.z, { ry: Math.PI / 4, ink: true });
  flag(root, tw.x, top + ch + 5, tw.z, '#ec7552');
  // the great hall's own walls: the band between where the rooms used to be (their
  // walls went with them to their houses), with an opening at each room door
  const hall = new THREE.Group(); hall.name = 'hall-shell'; root.add(hall); refs.hallShell = hall;
  const x0 = -L.w / 2; const x1 = L.w / 2;
  const doorXs = { top: new Set(world.rooms.filter((q) => q.side !== 'bottom').map((q) => q.door.x)), bottom: new Set(world.rooms.filter((q) => q.side === 'bottom').map((q) => q.door.x)) };
  const edge = (row, zLine, tall) => {
    const span = world.rooms.filter((q) => (row === 'top' ? q.side !== 'bottom' : q.side === 'bottom'));
    if (!span.length) return;
    const minX = Math.min(...span.map((q) => roomZoneRect(q).x0)); const maxX = Math.max(...span.map((q) => roomZoneRect(q).x1));
    for (let x = minX; x <= maxX; x++) {
      if (doorXs[row].has(x)) continue;
      put(hall, geo(`hw:${tall}`, () => new THREE.BoxGeometry(1.02, tall, 0.36)), stone, x - L.w / 2 + 0.5, tall / 2, zLine, { ink: 1.02, cast: tall > 1 });
    }
  };
  edge('top', 5 - L.h / 2 + 0.5, 2.4);
  edge('bottom', 14 - L.h / 2 + 0.5, 0.9);
  void x0; void x1;
  return { root, refs, houses };
}

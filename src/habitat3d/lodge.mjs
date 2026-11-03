// Habitat 3D: the Cozy Hearth lodge, built in code from simple original
// geometry and procedural textures (no model files). A timber-frame lodge on a
// small hill, cut away dollhouse style: one room per AI, the great room with
// desks and the fireside inglenook, the kitchen nook, the hall with the board
// and trophy shelf, the garden courtyard, and the owner's private study.
import * as THREE from '../vendor/three/three.module.min.js';
import { T } from '../habitat/world.mjs';
import { TROPHIES, gardenState, GARDEN_STAGES, RUG_STYLES } from '../habitat/life.mjs';
import { tileTo3D, wallKind, wallHeight, isOutdoor, lodgeBounds } from './map.mjs';
import { STUDY, STUDY_DOOR, NOOK, studyGlobal } from './walk.mjs';
import { woodTex, planksTex, stoneTex, knitTex, grassTex, soilTex, fabricTex, glowTex, blobTex, labelTex, roofTex, artTex } from './textures.mjs';

const mats = new Map();
export function M(color, o = {}) {
  const k = JSON.stringify([color, o.rough, o.metal, o.emissive, o.ei, o.map?.uuid, o.transparent, o.opacity, o.vc, o.side]);
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0, emissive: o.emissive || '#000000', emissiveIntensity: o.ei ?? 0, map: o.map || null, transparent: Boolean(o.transparent), opacity: o.opacity ?? 1, vertexColors: Boolean(o.vc), side: o.side ?? THREE.FrontSide }));
  return mats.get(k);
}
export function disposeLodgeMats() { for (const m of mats.values()) m.dispose(); mats.clear(); for (const t of reps.values()) t.dispose(); reps.clear(); }

const WOOD = () => M('#ffffff', { map: woodTex('oak'), rough: 0.7 });
const DARKWOOD = () => M('#ffffff', { map: woodTex('dark'), rough: 0.7 });
const LIGHTWOOD = () => M('#ffffff', { map: woodTex('light'), rough: 0.7 });
const STONE = () => M('#ffffff', { map: stoneTex('warm'), rough: 0.95 });

function add(parent, geo, mat, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, cast = true, receive = true, sx = 1, sy = 1, sz = 1 } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
  m.castShadow = cast; m.receiveShadow = receive;
  parent.add(m);
  return m;
}
// A box resting on y0 (bottom), centred on x/z, with slightly rounded look via a bevel strip.
function box(parent, w, h, d, x, y0, z, mat, o = {}) { return add(parent, new THREE.BoxGeometry(w, h, d), mat, { x, y: y0 + h / 2, z, ...o }); }
function cyl(parent, rt, rb, h, x, y0, z, mat, seg = 16, o = {}) { return add(parent, new THREE.CylinderGeometry(rt, rb, h, seg), mat, { x, y: y0 + h / 2, z, ...o }); }
function ball(parent, r, x, y, z, mat, o = {}) { return add(parent, new THREE.SphereGeometry(r, 16, 12), mat, { x, y, z, ...o }); }
function plane(parent, w, d, x, y, z, mat, o = {}) { return add(parent, new THREE.PlaneGeometry(w, d), mat, { x, y, z, rx: -Math.PI / 2, cast: false, ...o }); }
function glow(parent, size, x, y, z, color = 'rgba(255,206,140,1)') {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
  s.position.set(x, y, z); s.scale.set(size, size, 1); s.renderOrder = 5;
  parent.add(s);
  return s;
}
function pool(parent, size, x, z) {
  const m = plane(parent, size, size, x, 0.02, z, new THREE.MeshBasicMaterial({ map: glowTex('rgba(255,190,110,.55)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.receiveShadow = false; m.renderOrder = 2;
  return m;
}
function blob(parent, w, d, x, z, o = 0.6) {
  const m = plane(parent, w, d, x, 0.011, z, new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, opacity: o }));
  m.receiveShadow = false; m.renderOrder = 1;
  return m;
}
const reps = new Map();
function texRepeat(t, rx, ry) {
  const k = `${t.uuid}:${rx.toFixed(2)}:${ry.toFixed(2)}`;
  if (!reps.has(k)) { const c = t.clone(); c.needsUpdate = true; c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(rx, ry); reps.set(k, c); }
  return reps.get(k);
}

// ---------- props ----------
const BOOKS = ['#8c3b2e', '#2f5d62', '#c99a3e', '#5b4a8a', '#3d6b3a', '#b5643c', '#2c3e60'];
function leafCluster(g, x, y, z, r, color = '#4f8a3c', n = 7) {
  const m = M(color, { rough: 0.8 });
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; ball(g, r * (0.5 + (i % 3) * 0.12), x + Math.cos(a) * r * 0.55, y + (i % 2) * r * 0.35, z + Math.sin(a) * r * 0.55, m, { sy: 0.8 }); }
  ball(g, r * 0.6, x, y + r * 0.45, z, m);
}
function pot(g, x, z, color = '#b4613a', r = 0.16, h = 0.22) { cyl(g, r, r * 0.78, h, x, 0, z, M(color, { rough: 0.6 }), 18); cyl(g, r * 0.92, r * 0.92, 0.02, x, h - 0.02, z, M('#3d2a1c'), 18); }

// One prop, centred on its tile, standing on the floor. facing: rotation about y.
export function buildProp(kind, { color = '#c27a3a', lit = false, refs = null, id = null, seed = 0 } = {}) {
  const g = new THREE.Group();
  const acc = M(color, { rough: 0.7 });
  switch (kind) {
    case 'bookshelf': {
      box(g, 0.86, 1.3, 0.34, 0, 0, -0.28, WOOD());
      for (let s = 0; s < 4; s++) {
        box(g, 0.78, 0.03, 0.3, 0, 0.08 + s * 0.3, -0.26, DARKWOOD());
        let x = -0.36;
        while (x < 0.33) { const w = 0.04 + ((x * 97 + s * 13 + seed) % 1 + 1) % 1 * 0.04; const h = 0.18 + (((x * 31 + s) % 1 + 1) % 1) * 0.08; box(g, w, h, 0.22, x + w / 2, 0.11 + s * 0.3, -0.24, M(BOOKS[Math.abs(Math.floor(x * 50 + s * 3 + seed)) % BOOKS.length], { rough: 0.85 }), { cast: false }); x += w + 0.008; }
      }
      blob(g, 1.0, 0.5, 0, -0.25);
      break;
    }
    case 'lamp': case 'lantern': {
      if (kind === 'lamp') {
        cyl(g, 0.14, 0.16, 0.04, 0, 0, 0, DARKWOOD());
        cyl(g, 0.018, 0.018, 1.0, 0, 0.04, 0, M('#3b2a20', { metal: 0.4, rough: 0.4 }));
        const shade = cyl(g, 0.13, 0.2, 0.24, 0, 0.98, 0, new THREE.MeshStandardMaterial({ color: '#f3dcb2', emissive: '#ffb860', emissiveIntensity: lit ? 1.2 : 0.05, roughness: 0.9, side: THREE.DoubleSide }), 20, { cast: false });
        const halo = glow(g, 1.4, 0, 1.1, 0); halo.visible = lit;
        const fl = pool(g, 2.6, 0, 0); fl.visible = lit;
        refs?.lamps.push({ id, shade, halo, pool: fl });
      } else {
        box(g, 0.2, 0.03, 0.2, 0, 0, 0, M('#3a2a20', { metal: 0.5 }));
        const glass = box(g, 0.16, 0.24, 0.16, 0, 0.03, 0, new THREE.MeshStandardMaterial({ color: '#ffe2a8', emissive: '#ffae4a', emissiveIntensity: lit ? 1.6 : 0.05, transparent: true, opacity: 0.85 }), { cast: false });
        cyl(g, 0.02, 0.12, 0.08, 0, 0.27, 0, M('#3a2a20', { metal: 0.5 }), 4);
        add(g, new THREE.TorusGeometry(0.05, 0.01, 6, 12), M('#3a2a20', { metal: 0.5 }), { y: 0.38 });
        const halo = glow(g, 1.0, 0, 0.16, 0); halo.visible = lit;
        const fl = pool(g, 1.8, 0, 0); fl.visible = lit;
        refs?.lamps.push({ id, shade: glass, halo, pool: fl });
      }
      break;
    }
    case 'plant': case 'fern': {
      pot(g, 0, 0, kind === 'fern' ? '#7c8c5a' : '#b4613a');
      if (kind === 'fern') { const m = M('#5d9a45', { rough: 0.8, side: THREE.DoubleSide }); for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; add(g, new THREE.ConeGeometry(0.05, 0.42, 4), m, { x: Math.cos(a) * 0.12, y: 0.36, z: Math.sin(a) * 0.12, rz: Math.cos(a) * 0.7, rx: -Math.sin(a) * 0.7, sz: 0.3 }); } }
      else leafCluster(g, 0, 0.42, 0, 0.2);
      blob(g, 0.5, 0.5, 0, 0);
      break;
    }
    case 'chest': {
      box(g, 0.7, 0.36, 0.42, 0, 0, -0.1, WOOD());
      add(g, new THREE.CylinderGeometry(0.21, 0.21, 0.7, 16, 1, false, 0, Math.PI), WOOD(), { y: 0.36, z: -0.1, rz: Math.PI / 2, ry: 0 });
      for (const x of [-0.25, 0.25]) box(g, 0.05, 0.4, 0.44, x, 0, -0.1, M('#7a5a30', { metal: 0.6, rough: 0.4 }));
      box(g, 0.08, 0.08, 0.02, 0, 0.3, 0.12, M('#d8b24a', { metal: 0.8, rough: 0.3 }));
      blob(g, 0.9, 0.6, 0, -0.1);
      break;
    }
    case 'globe': {
      cyl(g, 0.12, 0.14, 0.05, 0, 0, 0, DARKWOOD()); cyl(g, 0.015, 0.015, 0.4, 0, 0.05, 0, M('#a07a3a', { metal: 0.6 }));
      ball(g, 0.16, 0, 0.55, 0, M('#3f7fa8', { rough: 0.5 }));
      for (const [a, b] of [[0.3, 0.2], [-1.2, -0.4], [2.2, 0.5]]) ball(g, 0.07, Math.cos(a) * 0.12, 0.55 + b * 0.18, Math.sin(a) * 0.12, M('#6aa04a'), { sy: 0.6 });
      add(g, new THREE.TorusGeometry(0.19, 0.01, 6, 24, Math.PI), M('#a07a3a', { metal: 0.6 }), { y: 0.55, rz: Math.PI / 2 + 0.4 });
      break;
    }
    case 'radio': {
      box(g, 0.32, 0.36, 0.26, 0, 0.42, 0, DARKWOOD()); box(g, 0.4, 0.42, 0.3, 0, 0, 0, WOOD());
      cyl(g, 0.08, 0.08, 0.01, -0.06, 0.62, 0.135, M('#d9c39a', { rough: 0.9 }), 18, { rx: Math.PI / 2 });
      for (const x of [0.08, 0.13]) cyl(g, 0.02, 0.02, 0.03, x, 0.6, 0.14, M('#c9a24a', { metal: 0.7 }), 10, { rx: Math.PI / 2 });
      break;
    }
    case 'teapot': {
      box(g, 0.5, 0.4, 0.4, 0, 0, 0, WOOD()); // side table
      ball(g, 0.11, 0, 0.5, 0, M('#d97b5a', { rough: 0.35 }), { sy: 0.8 });
      add(g, new THREE.ConeGeometry(0.025, 0.12, 8), M('#d97b5a', { rough: 0.35 }), { x: 0.12, y: 0.52, rz: -1.0 });
      add(g, new THREE.TorusGeometry(0.05, 0.012, 6, 12), M('#d97b5a'), { x: -0.11, y: 0.5 });
      for (const x of [-0.16, 0.17]) cyl(g, 0.03, 0.025, 0.05, x, 0.4, 0.1, M('#f4ead8', { rough: 0.3 }), 12);
      break;
    }
    case 'easel': {
      const w = WOOD();
      for (const s of [-1, 1]) box(g, 0.04, 1.2, 0.04, s * 0.2, 0, 0, w, { rz: s * 0.12 });
      box(g, 0.04, 1.1, 0.04, 0, 0, -0.25, w, { rx: -0.25 });
      box(g, 0.5, 0.04, 0.08, 0, 0.45, 0.03, w);
      const canvasMesh = add(g, new THREE.PlaneGeometry(0.5, 0.4), M('#ffffff', { map: artTex(color, seed + 2), rough: 0.9 }), { y: 0.72, z: 0.05, rx: -0.12, cast: false });
      canvasMesh.receiveShadow = false;
      break;
    }
    case 'fishbowl': {
      box(g, 0.44, 0.42, 0.36, 0, 0, 0, WOOD());
      ball(g, 0.15, 0, 0.56, 0, M('#bfe6f2', { transparent: true, opacity: 0.45, rough: 0.05 }), { cast: false });
      ball(g, 0.12, 0, 0.53, 0, M('#5aa6c8', { transparent: true, opacity: 0.5 }), { cast: false, sy: 0.75 });
      ball(g, 0.03, 0.03, 0.55, 0, M('#ff8a3a', { emissive: '#ff6a1a', ei: 0.3 }), { sx: 1.6 });
      break;
    }
    case 'cushion': {
      const m = M('#ffffff', { map: fabricTex(color), rough: 0.95 });
      ball(g, 0.26, 0, 0.1, 0, m, { sy: 0.35 }); ball(g, 0.2, 0.08, 0.2, -0.05, M('#ffffff', { map: fabricTex('#e8c27a') }), { sy: 0.4 });
      blob(g, 0.7, 0.7, 0, 0);
      break;
    }
    case 'armchair': {
      const fab = M('#ffffff', { map: fabricTex(color), rough: 0.95 });
      box(g, 0.7, 0.28, 0.66, 0, 0.08, 0, fab); box(g, 0.7, 0.55, 0.16, 0, 0.3, -0.28, fab);
      for (const s of [-1, 1]) box(g, 0.13, 0.4, 0.62, s * 0.3, 0.1, 0, fab);
      ball(g, 0.25, 0, 0.42, 0.02, fab, { sy: 0.3, sx: 1.1 });
      for (const [x, z] of [[-0.3, -0.28], [0.3, -0.28], [-0.3, 0.28], [0.3, 0.28]]) cyl(g, 0.03, 0.025, 0.08, x, 0, z, DARKWOOD(), 8);
      blob(g, 0.95, 0.9, 0, 0);
      break;
    }
    case 'trophy': {
      box(g, 0.5, 0.7, 0.4, 0, 0, 0, WOOD());
      cyl(g, 0.06, 0.08, 0.05, 0, 0.7, 0, DARKWOOD(), 12);
      cyl(g, 0.02, 0.02, 0.1, 0, 0.75, 0, M('#e2b440', { metal: 0.9, rough: 0.25 }), 8);
      add(g, new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M('#e2b440', { metal: 0.9, rough: 0.25, side: THREE.DoubleSide }), { y: 0.95, rx: Math.PI });
      break;
    }
    case 'owner-desk': {
      box(g, 0.95, 0.05, 0.55, 0, 0.5, -0.15, WOOD());
      for (const [x, z] of [[-0.42, -0.38], [0.42, -0.38], [-0.42, 0.08], [0.42, 0.08]]) box(g, 0.05, 0.5, 0.05, x, 0, z, DARKWOOD());
      box(g, 0.04, 0.2, 0.04, 0, 0.55, -0.32, M('#2b2b30'));
      const scr = add(g, new THREE.PlaneGeometry(0.52, 0.32), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 0.3 }), { y: 0.88, z: -0.3, cast: false });
      box(g, 0.56, 0.36, 0.03, 0, 0.7, -0.33, M('#2b2b30', { rough: 0.4 }));
      refs && (refs.ownerScreens = [...(refs.ownerScreens || []), scr]);
      const ch = buildProp('armchair', { color: '#b85a30' }); ch.scale.setScalar(0.75); ch.position.z = 0.35; ch.rotation.y = Math.PI; g.add(ch);
      break;
    }
    default: { box(g, 0.4, 0.4, 0.4, 0, 0, 0, acc); }
  }
  return g;
}

// ---------- the lodge ----------
// opts: { world, agents, store, notes, prefs, light }
export function buildLodge({ world, agents = {}, store = {}, notes = [], prefs = { room: { props: [] }, notes: [] }, lampsOn = false }) {
  const root = new THREE.Group();
  const refs = { lamps: [], doors: {}, monitors: {}, deskLights: {}, windows: [], windowGlows: [], fire: null, roof: null, picks: [], textures: [], seats: {}, ownerScreens: [], studyDoor: null, bounds: lodgeBounds(world) };
  const P = (x, y) => tileTo3D(world, x, y);
  const pick = (obj, hit) => { obj.traverse((o) => { o.userData.hit = hit; }); refs.picks.push(obj); return obj; };
  const color = (id) => agents[id]?.color || '#888888';
  const b = refs.bounds;
  const W = world.w; const Hh = world.h;

  // Hill and meadow
  const span = Math.max(b.maxX - b.minX + 14, b.maxZ - b.minZ + 14);
  const hill = add(root, new THREE.CylinderGeometry(span * 0.62, span * 0.82, 3.2, 64, 1), M('#ffffff', { map: texRepeat(grassTex(), 10, 10), rough: 1 }), { y: -1.9, cast: false });
  hill.position.x = -2;
  plane(root, span * 6, span * 6, 0, -3.5, 0, M('#ffffff', { map: texRepeat(grassTex(), 40, 40), rough: 1 }));
  // Foundation stone under the lodge, the study and the nook.
  box(root, W + 0.4, 0.4, Hh + 0.4, (b.minX + b.maxX) / 2, -0.4, (b.minZ + b.maxZ) / 2, M('#ffffff', { map: texRepeat(stoneTex('warm'), W / 2, 1) }));
  const sA = P(STUDY.x0 - 1, STUDY.y0 - 1); const sB = P(STUDY.x0 + STUDY.w, STUDY.y0 + STUDY.h);
  box(root, sB.x - sA.x + 1.4, 0.4, sB.z - sA.z + 1.4, (sA.x + sB.x) / 2, -0.4, (sA.z + sB.z) / 2, M('#ffffff', { map: texRepeat(stoneTex('warm'), 3, 1) }));
  const nA = P(NOOK.fire.x, NOOK.y0 - 1); const nB = P(0, NOOK.y0 + NOOK.h);
  box(root, nB.x - nA.x + 1.4, 0.4, nB.z - nA.z + 1.4, (nA.x + nB.x) / 2, -0.4, (nA.z + nB.z) / 2, STONE());
  // Trees around the hill (original low-poly pines and round trees).
  const rngT = (i) => ((Math.sin(i * 127.1) * 43758.5453) % 1 + 1) % 1;
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rngT(i) * 0.2; const r = span * (0.5 + rngT(i + 3) * 0.12);
    const x = Math.cos(a) * r - 2; const z = Math.sin(a) * r * 0.75;
    if (z > b.maxZ + 2 && Math.abs(x) < span * 0.35) continue; // keep the front view open
    const t = new THREE.Group(); t.position.set(x, -0.35 - rngT(i + 9) * 0.3, z);
    cyl(t, 0.12, 0.18, 0.9, 0, 0, 0, M('#5b3b26'));
    if (i % 3) { for (let k = 0; k < 3; k++) add(t, new THREE.ConeGeometry(1.0 - k * 0.25, 1.2, 8), M(['#2f5a3a', '#376a42', '#2b5034'][k]), { y: 1.2 + k * 0.6 }); }
    else leafCluster(t, 0, 1.5, 0, 0.8, '#5e8f3e', 8);
    root.add(t);
  }

  // Floors
  const floors = new THREE.Group(); root.add(floors);
  const rectFloor = (x0, y0, w, h, mat, hit = null, rep = 0.5) => {
    const a = P(x0, y0); const c = P(x0 + w - 1, y0 + h - 1);
    const m = mat.map ? M('#ffffff', { map: texRepeat(mat.map, w * rep, h * rep), rough: mat.roughness }) : mat;
    const f = plane(floors, w, h, (a.x + c.x) / 2, 0, (a.z + c.z) / 2, m);
    f.receiveShadow = true;
    if (hit) pick(f, hit);
    return f;
  };
  rectFloor(1, 6, W - 2, 8, M('#ffffff', { map: planksTex('floor'), rough: 0.8 }), null, 0.35);
  for (const r of world.rooms) rectFloor(r.x0, r.y0, r.w, r.h, M('#ffffff', { map: planksTex('room') }), { kind: 'room', id: r.id }, 0.4);
  for (const g of world.gardens) rectFloor(g.x0, g.y0, g.w, g.h, M('#ffffff', { map: grassTex() }), null, 0.5);
  if (world.kitchen) { const k = world.kitchen; rectFloor(k.x0, k.y0, k.w, k.h, M('#ffffff', { map: planksTex('kitchen') }), { kind: 'kitchen' }, 0.4); }
  if (world.courtyard) { const c = world.courtyard; rectFloor(c.x0, c.y0, c.w, c.h, M('#ffffff', { map: grassTex() }), { kind: 'garden' }, 0.6); }
  rectFloor(STUDY.x0, STUDY.y0, STUDY.w, STUDY.h, M('#ffffff', { map: planksTex('study') }), { kind: 'study' }, 0.4);
  rectFloor(NOOK.x0, NOOK.y0, NOOK.w, NOOK.h, STONE(), null, 0.6);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const t = world.grid[y][x];
    if (t === T.DOOR) rectFloor(x, y, 1, 1, M('#ffffff', { map: planksTex('floor') }), null, 0.3);
    if (t === T.PATH) { const p = P(x, y); for (let i = 0; i < 2; i++) cyl(floors, 0.22, 0.24, 0.04, p.x + (i ? 0.2 : -0.18), 0, p.z + (i ? -0.15 : 0.18), M('#9a8f84', { rough: 1 }), 7, { cast: false }); }
  }
  for (const o of [STUDY_DOOR, ...NOOK.opening]) rectFloor(o.x, o.y, 1, 1, STONE(), null, 0.5);

  // Walls: plaster with baked darkening toward the floor (ambient occlusion), timber on top.
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  { const pos = wallGeo.attributes.position; const cols = []; for (let i = 0; i < pos.count; i++) { const k = 0.62 + 0.38 * (pos.getY(i) + 0.5); cols.push(k, k * 0.98, k * 0.95); } wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); }
  const skip = new Set([`${STUDY_DOOR.x},${STUDY_DOOR.y}`, ...NOOK.opening.map((o) => `${o.x},${o.y}`)]);
  const cells = { back: [], outer: [], inner: [], fence: [] };
  const nearOutdoor = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isOutdoor(world, x + dx, y + dy));
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    let k = wallKind(world, x, y);
    if (!k || skip.has(`${x},${y}`)) continue;
    if (k !== 'inner' && nearOutdoor(x, y) && !(y === 0 && !isOutdoor(world, x, 1))) k = 'fence';
    cells[k].push({ x, y });
  }
  // The study's own walls (outside the grid) and the nook's low walls.
  for (let y = STUDY.y0 - 1; y <= STUDY.y0 + STUDY.h; y++) cells.back.push({ x: STUDY.x0 - 1, y });
  for (let x = STUDY.x0; x < 0; x++) { cells.back.push({ x, y: STUDY.y0 - 1 }); cells.inner.push({ x, y: STUDY.y0 + STUDY.h }); }
  for (let x = NOOK.fire.x; x < 0; x++) cells.inner.push({ x, y: NOOK.y0 + NOOK.h });
  const plaster = M('#efe2c9', { vc: true, rough: 0.95 });
  const panel = M('#ffffff', { map: woodTex('light'), vc: true, rough: 0.8 });
  const mats2 = { back: plaster, outer: plaster, inner: panel };
  const dummy = new THREE.Object3D();
  for (const kind of ['back', 'outer', 'inner']) {
    const list = cells[kind]; if (!list.length) continue;
    const h = wallHeight(kind);
    const im = new THREE.InstancedMesh(wallGeo, mats2[kind], list.length);
    list.forEach((c, i) => { const p = P(c.x, c.y); dummy.position.set(p.x, h / 2, p.z); dummy.scale.set(1, h, 1); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    im.castShadow = true; im.receiveShadow = true;
    root.add(im); refs[`walls_${kind}`] = im;
    // Timber: a top plate on every wall tile and posts every few tiles.
    const plate = new THREE.InstancedMesh(new THREE.BoxGeometry(1.02, 0.12, 1.02), DARKWOOD(), list.length);
    list.forEach((c, i) => { const p = P(c.x, c.y); dummy.position.set(p.x, h + 0.06, p.z); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); plate.setMatrixAt(i, dummy.matrix); });
    plate.castShadow = true; root.add(plate);
    const posts = list.filter((c) => (c.x + c.y) % 4 === 0 && kind !== 'inner');
    if (posts.length) {
      const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 1, 1.04), DARKWOOD(), posts.length);
      posts.forEach((c, i) => { const p = P(c.x, c.y); dummy.position.set(p.x, h / 2, p.z); dummy.scale.set(1, h, 1); dummy.updateMatrix(); pm.setMatrixAt(i, dummy.matrix); });
      pm.castShadow = true; root.add(pm);
    }
  }
  // Fences around the open-air parts.
  for (const c of cells.fence) {
    const p = P(c.x, c.y);
    cyl(root, 0.06, 0.06, 0.6, p.x, 0, p.z, WOOD(), 6);
    box(root, 1, 0.06, 0.06, p.x, 0.42, p.z, WOOD(), { ry: c.y === 0 || c.y === Hh - 1 ? 0 : Math.PI / 2 });
    box(root, 1, 0.06, 0.06, p.x, 0.2, p.z, WOOD(), { ry: c.y === 0 || c.y === Hh - 1 ? 0 : Math.PI / 2 });
  }
  // Back-wall windows (one per top room, the kitchen's, the study's): glow warm at night.
  const winMat = M('#ffe6b0', { emissive: '#ffb45a', ei: 0, rough: 0.2 });
  refs.windowMat = winMat;
  const windowAt = (x, y, w = 1) => {
    const p = P(x, y); const zf = p.z + 0.52;
    const g = new THREE.Group(); g.position.set(p.x + (w - 1) / 2, 1.45, zf); root.add(g);
    box(g, w * 0.8 + 0.12, 0.08, 0.08, 0, -0.5, 0.02, DARKWOOD()); box(g, w * 0.8 + 0.12, 0.08, 0.08, 0, 0.46, 0.02, DARKWOOD());
    for (const s of [-1, 1]) box(g, 0.08, 1.0, 0.08, s * (w * 0.4 + 0.02), -0.5, 0.02, DARKWOOD());
    box(g, 0.05, 0.92, 0.05, 0, -0.46, 0.03, DARKWOOD()); box(g, w * 0.8, 0.05, 0.05, 0, -0.02, 0.03, DARKWOOD());
    add(g, new THREE.PlaneGeometry(w * 0.8, 0.92), winMat, { cast: false, receive: false });
    // little curtains
    for (const s of [-1, 1]) add(g, new THREE.BoxGeometry(0.16, 1.0, 0.05), M('#ffffff', { map: fabricTex('#b8543a'), rough: 1 }), { x: s * (w * 0.4 + 0.12), y: -0.02, z: 0.07 });
    box(g, w * 0.8 + 0.3, 0.05, 0.16, 0, -0.56, 0.06, WOOD()); // sill
    const gl = glow(g, w * 1.8, 0, 0, 0.2, 'rgba(255,190,110,1)'); refs.windowGlows.push(gl);
  };
  for (const r of world.rooms) if (r.side === 'top') windowAt(r.x0 + 2, 0, 2);
  if (world.kitchen) windowAt(world.kitchen.window.x, 0, world.kitchen.window.w);
  windowAt(STUDY.x0 + 2, STUDY.y0 - 1, 2);

  // Roof: the back slope only (cut away), translucent and hidden when zoomed in.
  const roofW = (b.maxX - b.minX) + 1.2; const zBack = b.minZ - 0.6; const zRidge = (b.minZ + b.maxZ) / 2 - 1.5;
  const slope = Math.hypot(zRidge - zBack, 2.0);
  const roofMat = new THREE.MeshStandardMaterial({ map: texRepeat(roofTex(), roofW / 2, slope / 2), roughness: 0.9, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide });
  const roof = add(root, new THREE.PlaneGeometry(roofW, slope), roofMat, { x: (b.minX + b.maxX) / 2, y: WALL_TOP + 1.0, z: (zBack + zRidge) / 2, rx: -Math.PI / 2 - Math.atan2(2.0, zRidge - zBack), cast: true, receive: false });
  const ridge = box(root, roofW, 0.16, 0.18, (b.minX + b.maxX) / 2, WALL_TOP + 1.95, zRidge, DARKWOOD());
  refs.roof = { mesh: roof, mat: roofMat, ridge };

  // ---------- AI rooms ----------
  for (const r of world.rooms) {
    const c = color(r.id); const ai = store.ai?.[r.id] || {};
    const lit = lampsOn && ai.lamp !== 'off';
    const backZ = r.side === 'top' ? -1 : 1; // the room's back wall direction
    // rug
    const rs = ai.rug ?? r.rug.style;
    const ra = P(r.rug.x, r.rug.y); const rc = P(r.rug.x + r.rug.w - 1, r.rug.y + r.rug.h - 1);
    const rug = plane(root, r.rug.w - 0.15, r.rug.h - 0.15, (ra.x + rc.x) / 2, 0.015, (ra.z + rc.z) / 2, M('#ffffff', { map: knitTex(c, rs % RUG_STYLES.length), rough: 1 }));
    rug.receiveShadow = true;
    // bed (head at the back wall)
    const b0 = P(r.bed[0].x, r.bed[0].y); const b1 = P(r.bed[1].x, r.bed[1].y);
    const bed = new THREE.Group(); bed.position.set(b0.x, 0, (b0.z + b1.z) / 2); root.add(bed);
    box(bed, 0.86, 0.22, 1.9, 0, 0.06, 0, WOOD());
    box(bed, 0.8, 0.12, 1.84, 0, 0.28, 0, M('#f6f0e4', { rough: 1 }));
    box(bed, 0.84, 0.08, 1.2, 0, 0.36, -backZ * 0.32, M('#ffffff', { map: fabricTex(c), rough: 1 }));
    ball(bed, 0.24, 0, 0.44, backZ * 0.7, M('#fffaf0', { rough: 1 }), { sy: 0.35, sz: 0.6 });
    box(bed, 0.9, 0.7, 0.08, 0, 0, backZ * 0.95, DARKWOOD()); // headboard
    box(bed, 0.9, 0.4, 0.08, 0, 0, -backZ * 0.95, DARKWOOD());
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(bed, 0.04, 0.04, 0.06, sx * 0.38, 0, sz * 0.88, DARKWOOD(), 8);
    blob(bed, 1.2, 2.2, 0, 0, 0.5);
    refs.seats[`bed:${r.id}`] = { side: r.side };
    // built-in props and unlocked extras
    for (const p of [...r.props, ...(r.extras || [])]) {
      const pr = buildProp(p.kind, { color: c, lit, refs, id: r.id, seed: p.x * 7 + p.y });
      const q = P(p.x, p.y); pr.position.set(q.x, 0, q.z);
      if (r.side === 'bottom') pr.rotation.y = Math.PI;
      root.add(pr);
    }
    // framed picture on the back wall
    const pz = r.side === 'top' ? P(0, 0).z + 0.53 : P(0, Hh - 1).z - 0.53;
    const pic = P(r.x0 + 4, 0);
    if (r.side === 'bottom') {
      const fr = new THREE.Group(); fr.position.set(pic.x, 1.0, pz); fr.rotation.y = Math.PI; root.add(fr);
      box(fr, 0.6, 0.48, 0.04, 0, -0.24, 0, DARKWOOD()); add(fr, new THREE.PlaneGeometry(0.5, 0.38), M('#ffffff', { map: artTex(c, r.index) }), { z: 0.025, cast: false });
    } else { const fr = new THREE.Group(); fr.position.set(pic.x + 0.5, 1.95, pz); root.add(fr); box(fr, 0.6, 0.48, 0.04, 0, -0.24, 0, DARKWOOD()); add(fr, new THREE.PlaneGeometry(0.5, 0.38), M('#ffffff', { map: artTex(c, r.index) }), { z: 0.025, cast: false }); }
    // nameplate on the wall beside the door, facing the great room
    const plateText = ai.plate || agents[r.id]?.name || r.id;
    const pt = labelTex([plateText], { w: 256, h: 72, bg: '#f6e8cc', fg: '#3a2616', border: c, font: 'bold 34px system-ui, sans-serif' });
    refs.textures.push(pt);
    const pp = P(r.plate.x + 1, r.plate.y);
    const facing = r.side === 'top' ? 1 : -1;
    const sign = new THREE.Group(); sign.position.set(pp.x, 0.82, pp.z + facing * 0.53); sign.rotation.y = facing > 0 ? 0 : Math.PI; root.add(sign);
    box(sign, 1.1, 0.32, 0.05, 0, -0.16, 0, DARKWOOD());
    add(sign, new THREE.PlaneGeometry(1.0, 0.26), new THREE.MeshStandardMaterial({ map: pt, roughness: 0.9 }), { z: 0.03, cast: false });
    // the door
    const dp = P(r.door.x, r.door.y);
    const frame = new THREE.Group(); frame.position.set(dp.x, 0, dp.z); root.add(frame);
    for (const s of [-1, 1]) box(frame, 0.1, wallHeight('inner') + 0.12, 0.2, s * 0.47, 0, 0, DARKWOOD());
    const pivot = new THREE.Group(); pivot.position.set(-0.42, 0, 0); frame.add(pivot);
    const leaf = box(pivot, 0.84, 1.05, 0.06, 0.42, 0, 0, M('#ffffff', { map: woodTex('walnut') }));
    ball(pivot, 0.035, 0.74, 0.55, facing * 0.05, M('#d8b24a', { metal: 0.8, rough: 0.3 }));
    const lock = box(pivot, 0.14, 0.16, 0.03, 0.42, 0.55, facing * 0.05, M('#e3b23c', { metal: 0.7, rough: 0.35, emissive: '#5a3a00', ei: 0.4 }));
    refs.doors[r.id] = { pivot, lock, facing, frame };
    pick(leaf, { kind: 'door', id: r.id });
  }
  // Empty room slots: little planters with flowers.
  for (const gd of world.gardens) {
    const p = P(gd.x0 + 2.5, gd.y0 + 1.5);
    for (let i = 0; i < 3; i++) { const g = new THREE.Group(); g.position.set(p.x - 2 + i * 2, 0, p.z); root.add(g); box(g, 1.2, 0.28, 0.6, 0, 0, 0, WOOD()); for (let k = 0; k < 4; k++) { ball(g, 0.12, -0.42 + k * 0.28, 0.38, 0, M(['#e7a1b0', '#f2d06b', '#c9a0e8', '#f29a6b'][(k + i) % 4], { rough: 0.8 })); } }
  }

  // ---------- desks ----------
  for (const d of world.desks) {
    const c = color(d.id);
    const a = P(d.tiles[0].x, d.tiles[0].y); const e = P(d.tiles[2].x, d.tiles[2].y);
    const g = new THREE.Group(); g.position.set((a.x + e.x) / 2, 0, a.z); root.add(g);
    box(g, 2.7, 0.07, 0.8, 0, 0.5, 0, WOOD());
    box(g, 2.64, 0.03, 0.74, 0, 0.47, 0, DARKWOOD());
    for (const sx of [-1, 1]) box(g, 0.08, 0.47, 0.7, sx * 1.27, 0, 0, DARKWOOD());
    box(g, 0.6, 0.36, 0.66, -0.9, 0.08, 0, WOOD()); // drawers
    for (let i = 0; i < 2; i++) box(g, 0.16, 0.03, 0.02, -0.9, 0.18 + i * 0.16, 0.34, M('#c9a24a', { metal: 0.6 }));
    // monitor (faces the seat: +z)
    box(g, 0.16, 0.03, 0.12, 0, 0.57, -0.1, M('#2b2b30', { rough: 0.4 }));
    box(g, 0.04, 0.22, 0.04, 0, 0.57, -0.14, M('#2b2b30'));
    box(g, 0.74, 0.46, 0.04, 0, 0.72, -0.16, M('#24242a', { rough: 0.35 }));
    const scr = add(g, new THREE.PlaneGeometry(0.66, 0.38), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.85, roughness: 0.3 }), { y: 0.95, z: -0.135, cast: false });
    refs.monitors[d.id] = { mesh: scr, key: null };
    box(g, 0.5, 0.02, 0.16, 0, 0.57, 0.26, M('#3a3a40', { rough: 0.6 })); // keyboard
    cyl(g, 0.045, 0.04, 0.09, 0.62, 0.57, 0.1, M(c, { rough: 0.4 }), 14); // mug in the AI's colour
    const lamp = ball(g, 0.05, -1.1, 0.64, -0.2, M('#555555', { emissive: '#000000', ei: 0 }));
    cyl(g, 0.012, 0.012, 0.08, -1.1, 0.56, -0.2, M('#3a3a40'));
    const lampGlow = glow(g, 0.5, -1.1, 0.64, -0.2, 'rgba(255,255,255,1)'); lampGlow.visible = false;
    refs.deskLights[d.id] = { mesh: lamp, glow: lampGlow, state: undefined };
    const potG = new THREE.Group(); potG.position.set(1.05, 0.57, -0.15); potG.scale.setScalar(0.5); g.add(potG); pot(potG, 0, 0, '#c9784a'); leafCluster(potG, 0, 0.4, 0, 0.18);
    blob(g, 3.0, 1.1, 0, 0, 0.45);
    pick(g, { kind: 'desk', id: d.id });
    // chair (back toward +z)
    const s = P(d.seat.x, d.seat.y);
    const ch = new THREE.Group(); ch.position.set(s.x, 0, s.z - 0.2); root.add(ch);
    const fab = M('#ffffff', { map: fabricTex(c), rough: 1 });
    box(ch, 0.48, 0.07, 0.44, 0, 0.24, 0, DARKWOOD()); ball(ch, 0.22, 0, 0.33, 0, fab, { sy: 0.25, sx: 1.05 });
    box(ch, 0.46, 0.46, 0.06, 0, 0.3, 0.22, DARKWOOD()); box(ch, 0.38, 0.3, 0.05, 0, 0.38, 0.19, fab);
    for (const [x, z] of [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]]) box(ch, 0.05, 0.24, 0.05, x, 0, z, DARKWOOD());
  }
  // Shared decor in the great room corners
  for (const d of world.decor) {
    const q = P(d.x, d.y);
    const pr = d.kind === 'cooler' ? (() => { const g = new THREE.Group(); box(g, 0.4, 0.8, 0.4, 0, 0, 0, M('#e9e2d4')); cyl(g, 0.15, 0.15, 0.4, 0, 0.8, 0, M('#9fd0e8', { transparent: true, opacity: 0.7, rough: 0.1 }), 16); return g; })() : buildProp(d.kind, { color: '#c27a3a' });
    pr.position.set(q.x, 0, q.z); root.add(pr);
  }
  // Wall sconces along the back of the great room (warm at night).
  for (let x = 4; x < W - 4; x += 6) {
    const p = P(x, 5);
    if (world.grid[5][x] !== T.WALL) continue;
    const g = new THREE.Group(); g.position.set(p.x, 1.0, p.z + 0.52); root.add(g);
    box(g, 0.1, 0.18, 0.06, 0, -0.09, 0, DARKWOOD());
    const bulb = ball(g, 0.07, 0, 0.06, 0.08, new THREE.MeshStandardMaterial({ color: '#ffe2a8', emissive: '#ffae4a', emissiveIntensity: lampsOn ? 1.6 : 0.1 }));
    const gl = glow(g, 1.1, 0, 0.06, 0.12); gl.visible = lampsOn;
    refs.lamps.push({ id: null, shade: bulb, halo: gl, pool: null });
  }

  // ---------- fireside inglenook ----------
  {
    const f = P(NOOK.fire.x, NOOK.fire.y);
    const g = new THREE.Group(); g.position.set(f.x, 0, f.z); root.add(g);
    const st = STONE();
    box(g, 1.0, 1.5, 2.6, -0.1, 0, 0, st); // hearth body
    box(g, 0.3, 2.2, 1.0, -0.45, 1.5, 0, st); // chimney breast
    box(g, 0.75, 3.5, 0.85, -0.75, 1.5, 0, st); // chimney stack, out through the roof line
    box(g, 0.85, 0.2, 0.95, -0.75, 4.9, 0, M('#6a5a50'));
    box(g, 0.5, 0.75, 1.2, 0.27, 0.12, 0, M('#1c120d', { rough: 1 })); // firebox recess
    box(g, 0.5, 0.12, 2.8, 0.25, 1.38, 0, DARKWOOD()); // mantel beam
    box(g, 0.9, 0.12, 2.0, 0.55, 0, 0, st); // hearthstone
    for (const z of [-0.2, 0.15]) cyl(g, 0.07, 0.07, 0.6, 0.45, 0.16, z, M('#5b3b26'), 8, { rz: Math.PI / 2, ry: 0.4 });
    // mantel things: candles, a little clock, a framed picture
    for (const z of [-1.0, 1.0]) { cyl(g, 0.04, 0.04, 0.16, 0.25, 1.5, z, M('#f6ecd6')); ball(g, 0.025, 0.25, 1.7, z, M('#ffd27a', { emissive: '#ffb040', ei: 2 })); }
    cyl(g, 0.12, 0.12, 0.06, 0.25, 1.5, -0.45, M('#8a6a3a', { metal: 0.4 }), 16, { rx: Math.PI / 2, ry: Math.PI / 2 });
    { const fr = new THREE.Group(); fr.position.set(0.3, 1.95, 0.4); fr.rotation.y = Math.PI / 2; g.add(fr); box(fr, 0.7, 0.55, 0.04, 0, -0.27, 0, DARKWOOD()); add(fr, new THREE.PlaneGeometry(0.6, 0.45), M('#ffffff', { map: artTex('#d9692e', 1) }), { z: 0.025, cast: false }); }
    // flames
    const flames = [];
    const fm = [new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }), new THREE.MeshBasicMaterial({ color: '#ffc04a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }), new THREE.MeshBasicMaterial({ color: '#fff0b0', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })];
    for (let i = 0; i < 7; i++) { const fl = add(g, new THREE.ConeGeometry(0.08 + (i % 3) * 0.02, 0.4, 8), fm[i % 3], { x: 0.4, y: 0.4, z: -0.25 + (i / 6) * 0.5, cast: false, receive: false }); fl.userData.base = { y: 0.36 + (i % 2) * 0.04, s: 1 - (i % 3) * 0.2, ph: i * 1.7 }; flames.push(fl); }
    const fg = glow(g, 2.4, 0.6, 0.55, 0, 'rgba(255,150,60,1)');
    const fl2 = pool(g, 4.0, 1.4, 0);
    const light = new THREE.PointLight('#ff9a4a', 2.5, 9, 1.6); light.position.set(0.9, 0.7, 0); g.add(light);
    refs.fire = { flames, glow: fg, pool: fl2, light, group: g };
    // benches with cushions and a hearth rug
    const benchFab = M('#ffffff', { map: fabricTex('#a8432a'), rough: 1 });
    for (const row of [NOOK.y0, NOOK.y0 + NOOK.h - 1]) {
      const a = P(NOOK.x0, row); const e = P(NOOK.x0 + NOOK.w - 1, row);
      const bg = new THREE.Group(); bg.position.set((a.x + e.x) / 2, 0, a.z); bg.rotation.y = row === NOOK.y0 ? 0 : Math.PI; root.add(bg);
      box(bg, 1.9, 0.38, 0.62, 0, 0, -0.1, WOOD()); box(bg, 1.9, 0.6, 0.12, 0, 0.38, -0.36, WOOD());
      ball(bg, 0.42, -0.45, 0.44, -0.05, benchFab, { sy: 0.22, sz: 0.65 }); ball(bg, 0.42, 0.45, 0.44, -0.05, benchFab, { sy: 0.22, sz: 0.65 });
      ball(bg, 0.17, 0.75, 0.6, -0.22, M('#ffffff', { map: fabricTex('#e8c27a') }), { sy: 0.8, sz: 0.5 });
      pick(bg, { kind: 'couch' });
      refs.seats[`bench:${row}`] = { x: (a.x + e.x) / 2, z: a.z + (row === NOOK.y0 ? 0.0 : 0), rot: bg.rotation.y };
    }
    const r = P(NOOK.x0 + 1, NOOK.y0 + 1);
    plane(root, 1.6, 0.9, r.x - 0.4, 0.016, r.z, M('#ffffff', { map: knitTex('#b5643c', 1), rough: 1 }));
    // low walls around the nook sides (back is the hearth)
  }

  // ---------- kitchen nook ----------
  if (world.kitchen) {
    const k = world.kitchen;
    for (const p of k.props) {
      const q = P(p.x, p.y); const g = new THREE.Group(); g.position.set(q.x, 0, q.z); root.add(g);
      if (p.kind === 'coffee') {
        box(g, 0.9, 0.85, 0.6, 0, 0, -0.15, WOOD()); box(g, 0.94, 0.05, 0.64, 0, 0.85, -0.15, M('#d9cbb4', { rough: 0.5 }));
        box(g, 0.36, 0.42, 0.3, 0, 0.9, -0.25, M('#b8432f', { rough: 0.35, metal: 0.3 }));
        box(g, 0.28, 0.06, 0.12, 0, 1.18, -0.08, M('#2b2b30', { metal: 0.6 }));
        ball(g, 0.025, 0.12, 1.2, -0.1, M('#7cff9a', { emissive: '#3aff6a', ei: 1.5 }));
        cyl(g, 0.04, 0.035, 0.08, 0, 0.9, -0.08, M('#f4ead8', { rough: 0.3 }), 12);
        pick(g, { kind: 'coffee' });
        refs.coffee = g;
      } else if (p.kind === 'counter') {
        box(g, 1.0, 0.85, 0.6, 0, 0, -0.15, WOOD()); box(g, 1.04, 0.05, 0.64, 0, 0.85, -0.15, M('#d9cbb4', { rough: 0.5 }));
        for (let i = 0; i < 3; i++) cyl(g, 0.06, 0.06, 0.14, -0.3 + i * 0.22, 0.9, -0.25, M(['#c9784a', '#d9a441', '#6a8a5a'][i], { rough: 0.5 }), 12);
        box(g, 0.3, 0.03, 0.2, 0.25, 0.9, -0.05, LIGHTWOOD());
      } else if (p.kind === 'fridge') {
        box(g, 0.8, 1.6, 0.66, 0, 0, -0.12, M('#efe6d2', { rough: 0.35 })); box(g, 0.04, 0.4, 0.04, 0.3, 0.9, 0.23, M('#c9a24a', { metal: 0.7 }));
        box(g, 0.8, 0.02, 0.67, 0, 1.0, -0.12, M('#cfc2a8'));
      } else if (p.kind === 'heater') {
        box(g, 0.7, 0.7, 0.55, 0, 0.08, -0.1, M('#2e2a28', { metal: 0.5, rough: 0.5 })); for (const [x, z] of [[-0.3, -0.33], [0.3, -0.33], [-0.3, 0.13], [0.3, 0.13]]) box(g, 0.05, 0.08, 0.05, x, 0, z, M('#2e2a28'));
        box(g, 0.34, 0.22, 0.02, 0, 0.28, 0.18, M('#ff8a3a', { emissive: '#ff6a1a', ei: 1.4 }));
        cyl(g, 0.07, 0.07, 1.6, 0.2, 0.78, -0.25, M('#2e2a28', { metal: 0.5 }), 10);
        glow(g, 1.0, 0, 0.4, 0.3, 'rgba(255,140,60,1)');
      } else { const pr = buildProp(p.kind, { color: '#c27a3a' }); g.add(pr); }
    }
    // table and stools
    const ta = P(k.table.x, k.table.y); const tb = P(k.table.x + 1, k.table.y + 1);
    const tg = new THREE.Group(); tg.position.set((ta.x + tb.x) / 2, 0, (ta.z + tb.z) / 2); root.add(tg);
    cyl(tg, 0.85, 0.85, 0.06, 0, 0.6, 0, LIGHTWOOD(), 28); cyl(tg, 0.08, 0.12, 0.6, 0, 0, 0, DARKWOOD(), 12); cyl(tg, 0.4, 0.42, 0.04, 0, 0, 0, DARKWOOD(), 20);
    add(tg, new THREE.CylinderGeometry(0.5, 0.5, 0.005, 28), M('#ffffff', { map: fabricTex('#c9543a'), rough: 1 }), { y: 0.665, cast: false });
    cyl(tg, 0.1, 0.08, 0.2, 0, 0.665, 0, M('#e9dcc4', { rough: 0.4 }), 14); leafCluster(tg, 0, 0.95, 0, 0.12, '#e8a0b0', 6);
    const kl = new THREE.PointLight('#ffcf8a', 0, 6, 1.8); kl.position.set(tg.position.x, 2.0, tg.position.z); root.add(kl); refs.kitchenLight = kl;
    const kr = P(k.rug.x + 1, k.rug.y);
    plane(root, k.rug.w - 0.2, 0.8, kr.x, 0.015, kr.z, M('#ffffff', { map: knitTex('#8a5a3a', 0), rough: 1 }));
  }

  // ---------- hall: message board and trophy shelf ----------
  if (world.hall) {
    const bd = world.hall.board;
    const a = P(bd.x, bd.y); const e = P(bd.x + bd.w - 1, bd.y);
    const g = new THREE.Group(); g.position.set((a.x + e.x) / 2, 0, a.z - 0.25); root.add(g);
    for (const s of [-1, 1]) box(g, 0.1, 1.9, 0.1, s * 1.85, 0, 0, DARKWOOD());
    box(g, 3.8, 1.2, 0.08, 0, 0.6, 0, DARKWOOD());
    const cork = box(g, 3.6, 1.04, 0.06, 0, 0.68, 0.04, M('#b88a5a', { rough: 1 }));
    cork.userData.hit = { kind: 'board' }; refs.picks.push(cork);
    box(g, 3.9, 0.1, 0.16, 0, 1.82, 0, DARKWOOD());
    const all = [...notes.map((n) => ({ ...n, owner: false })), ...(prefs.notes || []).slice(-2).map((n, i) => ({ kind: 'owner', id: `owner-${i}`, who: 'owner', text: n.text, owner: true }))].slice(0, 5);
    all.forEach((n, i) => {
      const who = n.owner ? 'Owner' : n.kind === 'task' ? `T-${n.id}` : agents[n.who]?.name || n.who || '';
      const tx = labelTex([who, String(n.text || '').slice(0, 22), String(n.text || '').slice(22, 44)], { w: 192, h: 150, bg: n.owner ? '#ffe2b0' : n.kind === 'pin' ? '#fff3b8' : '#fbf7ec', fg: '#3a2616', font: 'bold 20px system-ui, sans-serif' });
      refs.textures.push(tx);
      const note = add(g, new THREE.PlaneGeometry(0.62, 0.48), new THREE.MeshStandardMaterial({ map: tx, roughness: 1 }), { x: -1.4 + i * 0.7, y: 1.2 - (i % 2) * 0.08, z: 0.08, rz: ((i * 37) % 7 - 3) * 0.02, cast: false });
      ball(g, 0.025, note.position.x, note.position.y + 0.2, 0.1, M(n.owner ? '#ff8a2a' : agents[n.who]?.color || '#c94a3a', { rough: 0.4 }));
      note.userData.hit = n.owner ? { kind: 'ownernote', text: n.text } : { kind: 'note', note: n }; refs.picks.push(note);
    });
    // a little folded paper plane resting on the frame
    const pp = new THREE.Group(); pp.position.set(1.4, 1.9, 0.02); g.add(pp);
    const pm = M('#fbf6e9', { rough: 0.9, side: THREE.DoubleSide });
    for (const s of [-1, 1]) { const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.18, 0, 0, -0.12, s * 0.12, 0.02, -0.12], 3)); wg.computeVertexNormals(); add(pp, wg, pm, { cast: false }); }
    refs.boardPos = { x: g.position.x, z: g.position.z };
    // trophy shelf on the south wall
    const sh = world.hall.shelf; const sa = P(sh.x, sh.y); const se = P(sh.x + sh.w - 1, sh.y);
    const s = new THREE.Group(); s.position.set((sa.x + se.x) / 2, 0, sa.z + 0.3); root.add(s);
    box(s, 3.6, 0.9, 0.4, 0, 0, 0, WOOD()); box(s, 3.7, 0.05, 0.44, 0, 0.9, 0, DARKWOOD()); box(s, 3.6, 0.05, 0.36, 0, 1.45, 0.02, DARKWOOD());
    TROPHIES.forEach((tr, i) => {
      const x = -1.4 + i * 0.7; const got = Boolean(store.trophies?.[tr.id]);
      if (got) {
        const gold = M(i % 2 ? '#d9dde2' : '#e2b440', { metal: 0.9, rough: 0.25 });
        cyl(s, 0.07, 0.09, 0.05, x, 0.95, 0, DARKWOOD(), 12); cyl(s, 0.02, 0.02, 0.1, x, 1.0, 0, gold, 8);
        add(s, new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M(i % 2 ? '#d9dde2' : '#e2b440', { metal: 0.9, rough: 0.25, side: THREE.DoubleSide }), { x, y: 1.2, rx: Math.PI });
        glow(s, 0.4, x, 1.18, 0.1, 'rgba(255,230,160,1)').material.opacity = 0.35;
      } else box(s, 0.18, 0.12, 0.04, x, 0.95, 0.1, M('#7a5a3a'));
    });
    pick(s, { kind: 'shelf' });
  }

  // ---------- garden courtyard ----------
  if (world.courtyard) {
    const c = world.courtyard;
    const g = gardenState(store, c.beds.length);
    const soil = M('#ffffff', { map: soilTex(), rough: 1 });
    c.beds.forEach((bd, i) => {
      const q = P(bd.x, bd.y);
      box(root, 0.96, 0.14, 0.96, q.x, 0, q.z, soil).userData.hit = { kind: 'garden' };
      box(root, 1.0, 0.18, 0.06, q.x, 0, q.z - 0.48, WOOD()); box(root, 1.0, 0.18, 0.06, q.x, 0, q.z + 0.48, WOOD());
      const st = g.stages[i] || 0;
      const wilt = g.wilt;
      const leaf = M(wilt === 2 ? '#8a8a3a' : wilt ? '#6f9a3a' : '#4f9a3c', { rough: 0.8 });
      if (st >= 1) for (const [dx, dz] of [[-0.2, -0.2], [0.2, 0.15], [-0.15, 0.22], [0.22, -0.18]]) add(root, new THREE.ConeGeometry(0.06, 0.18 + st * 0.08, 5), leaf, { x: q.x + dx, y: 0.2 + st * 0.04, z: q.z + dz, rz: wilt ? 0.5 : 0 });
      if (st >= 2) ball(root, 0.13 + st * 0.03, q.x, 0.32 + st * 0.06, q.z, leaf);
      if (st >= GARDEN_STAGES) for (let k = 0; k < 3; k++) ball(root, 0.065, q.x + Math.cos(k * 2.1 + i) * 0.14, 0.5 + st * 0.05, q.z + Math.sin(k * 2.1 + i) * 0.14, M(['#ef8aa0', '#f4cf5a', '#c49aea', '#f6a06a'][(i + k) % 4], { rough: 0.6, emissive: '#ffffff', ei: 0.04 }));
    });
    for (const p of c.props) {
      const q = P(p.x, p.y); const t = new THREE.Group(); t.position.set(q.x, 0, q.z); root.add(t);
      if (p.kind === 'tree') { cyl(t, 0.1, 0.16, 1.2, 0, 0, 0, M('#5b3b26')); leafCluster(t, 0, 1.6, 0, 0.7, '#5e9a42', 9); for (let k = 0; k < 4; k++) ball(t, 0.06, Math.cos(k * 1.6) * 0.5, 1.4 + (k % 2) * 0.4, Math.sin(k * 1.6) * 0.5, M('#d9452e', { rough: 0.5 })); }
      if (p.kind === 'bench') { box(t, 0.9, 0.06, 0.4, 0, 0.36, 0, WOOD()); box(t, 0.9, 0.3, 0.05, 0, 0.42, -0.18, WOOD()); for (const x of [-0.38, 0.38]) box(t, 0.06, 0.36, 0.36, x, 0, 0, DARKWOOD()); }
    }
    // a watering can by the gate
    const gq = P(c.gate.x + 1, c.gate.y + 1);
    const can = new THREE.Group(); can.position.set(gq.x - 0.3, 0, gq.z - 0.3); root.add(can);
    cyl(can, 0.1, 0.12, 0.2, 0, 0, 0, M('#5f8f9a', { metal: 0.5, rough: 0.4 }), 14); add(can, new THREE.CylinderGeometry(0.015, 0.02, 0.2, 6), M('#5f8f9a', { metal: 0.5 }), { x: 0.14, y: 0.18, rz: -0.9 });
    refs.gardenPos = P(c.x0 + 2, c.y0 + 2);
  }

  // ---------- the owner's private study ----------
  {
    const sd = P(STUDY_DOOR.x, STUDY_DOOR.y);
    const frame = new THREE.Group(); frame.position.set(sd.x, 0, sd.z); root.add(frame);
    for (const s of [-1, 1]) box(frame, 1.0, wallHeight('outer') + 0.12, 0.1, 0, 0, s * 0.47, DARKWOOD());
    const pivot = new THREE.Group(); pivot.position.set(0, 0, -0.42); frame.add(pivot);
    const leaf = box(pivot, 0.06, 1.35, 0.84, 0, 0, 0.42, M('#ffffff', { map: woodTex('dark') }));
    // flame mark on the great-room side
    const fl = new THREE.Group(); fl.position.set(0.05, 0.95, 0.42); pivot.add(fl);
    add(fl, new THREE.ConeGeometry(0.08, 0.22, 10), M('#ff8a2a', { emissive: '#ff6a00', ei: 1.3 }), { cast: false });
    add(fl, new THREE.ConeGeometry(0.04, 0.12, 10), M('#ffe08a', { emissive: '#ffcf4a', ei: 1.5 }), { y: -0.03, x: 0.02, cast: false });
    box(pivot, 0.03, 0.16, 0.12, 0.04, 0.6, 0.42, M('#e3b23c', { metal: 0.7, rough: 0.35 }));
    refs.studyDoor = { pivot };
    pick(leaf, { kind: 'studydoor' });
    // his props
    for (const p of prefs.room?.props || []) {
      const q = studyGlobal(p.x, p.y); const w = P(q.x, q.y);
      const pr = buildProp(p.kind, { color: '#e8833a', lit: lampsOn, refs, id: 'owner', seed: p.x + p.y * 3 });
      pr.position.set(w.x, 0, w.z); root.add(pr);
    }
    // rug, wall screen with the live Overview, a reading light
    const rc = P(STUDY.x0 + 2, STUDY.y0 + 1);
    plane(root, 2.6, 1.6, rc.x + 0.5, 0.015, rc.z + 0.5, M('#ffffff', { map: knitTex('#e8833a', 2), rough: 1 }));
    const wp = P(STUDY.x0 - 1, STUDY.y0 + 1);
    const scrG = new THREE.Group(); scrG.position.set(wp.x + 0.53, 1.35, wp.z + 0.5); scrG.rotation.y = Math.PI / 2; root.add(scrG);
    box(scrG, 1.6, 0.95, 0.05, 0, -0.47, 0, M('#1c1c20', { rough: 0.4 }));
    const screen = add(scrG, new THREE.PlaneGeometry(1.5, 0.85), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 0.3 }), { z: 0.03, cast: false });
    refs.wallScreen = screen;
    const sl = new THREE.PointLight('#ffc78a', lampsOn ? 1.2 : 0.3, 6, 1.8); sl.position.set(rc.x + 0.5, 2.0, rc.z + 0.5); root.add(sl); refs.studyLight = sl;
    refs.studyCenter = P(STUDY.x0 + 2.5, STUDY.y0 + 1.5);
  }
  mergeStatic(root, refs);
  return { root, refs };
}
const WALL_TOP = 2.5;

// Fewer draw calls: bake every static, non-interactive mesh into one mesh per
// material (lamps, doors, screens, flames and anything clickable stay separate).
function mergeStatic(root, refs) {
  const keep = new Set([
    ...refs.lamps.flatMap((l) => [l.shade, l.halo, l.pool]), ...Object.values(refs.doors).map((d) => d.pivot),
    ...Object.values(refs.monitors).map((m) => m.mesh), ...Object.values(refs.deskLights).flatMap((d) => [d.mesh, d.glow]),
    refs.fire?.group, refs.roof?.mesh, refs.roof?.ridge, refs.studyDoor?.pivot, refs.wallScreen, ...(refs.ownerScreens || []), ...refs.windowGlows,
  ].filter(Boolean));
  const cached = new Set(mats.values());
  root.updateMatrixWorld(true);
  const groups = new Map(); const drop = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !cached.has(o.material) || o.material.transparent) return;
    for (let a = o; a && a !== root; a = a.parent) if (keep.has(a) || a.userData.hit) return;
    const g = o.geometry;
    if (!g.attributes.position || !g.attributes.normal || !g.attributes.uv || g.attributes.color) return;
    const k = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}`;
    if (!groups.has(k)) groups.set(k, { mat: o.material, cast: o.castShadow, receive: o.receiveShadow, list: [] });
    groups.get(k).list.push(o); drop.push(o);
  });
  for (const { mat, cast, receive, list } of groups.values()) {
    if (list.length < 2) { drop.splice(drop.indexOf(list[0]), 1); continue; }
    const parts = list.map((o) => { const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()); g.applyMatrix4(o.matrixWorld); return g; });
    let n = 0; for (const g of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3); const nor = new Float32Array(n * 3); const uv = new Float32Array(n * 2);
    let i = 0;
    for (const g of parts) { pos.set(g.attributes.position.array, i * 3); nor.set(g.attributes.normal.array, i * 3); uv.set(g.attributes.uv.array, i * 2); i += g.attributes.position.count; g.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = receive; m.matrixAutoUpdate = false;
    root.add(m);
  }
  for (const o of drop) { o.removeFromParent(); o.geometry.dispose(); }
}

export function disposeTree(obj, textures = []) {
  const cached = new Set(mats.values());
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    for (const m of [].concat(o.material || [])) if (!cached.has(m)) m.dispose();
  });
  for (const t of textures) t.dispose();
}

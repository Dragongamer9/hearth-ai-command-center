// Habitat 3D: the characters. Original stylised figures built in code from
// smooth primitives, with a small joint hierarchy (hips, spine, neck, shoulders,
// elbows, hips, knees) driven procedurally: breathing, looking around, walking
// with arm swing, sitting and typing, sleeping, carrying a paper or a mug,
// waving and cheering. Faces show the same moods as 2D. Plus the ember-fox pet.
import * as THREE from '../vendor/three/three.module.min.js';
import { blobTex, fabricTex } from './textures.mjs';
import { hashStr } from '../habitat/life.mjs';
import { HAIR_STYLES } from './map.mjs';

const SKIN = ['#f3d2b3', '#e9bf98', '#d6a27a', '#b9805a', '#8f5f3f', '#f6dcc4'];
const HAIR = ['#3b2a20', '#6b4127', '#a8662f', '#d9b36a', '#1f1a1c', '#8a3b25', '#c9c3bd'];
export const ACCENTS = ['scarf', 'glasses', 'headphones', 'beanie', 'bowtie', 'badge'];

const mats = new Map();
function mat(color, { rough = 0.75, metal = 0, emissive = null, ei = 0, map = null, transparent = false, opacity = 1 } = {}) {
  const k = [color, rough, metal, emissive, ei, map?.uuid, transparent, opacity].join('|');
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: emissive || '#000000', emissiveIntensity: ei, map, transparent, opacity }));
  return mats.get(k);
}
export function disposeFigureMats() { for (const m of mats.values()) m.dispose(); mats.clear(); }
const shade = (c, k) => { const x = new THREE.Color(c); const h = {}; x.getHSL(h); x.setHSL(h.h, h.s, Math.max(0, Math.min(1, h.l + k))); return `#${x.getHexString()}`; };

const G = {}; // shared geometries
function geo(name, make) { return (G[name] ||= make()); }
function mesh(g, m, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, shadow = true } = {}) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.set(rx, ry, rz);
  o.castShadow = shadow; o.receiveShadow = false;
  return o;
}
const sphere = () => geo('sphere', () => new THREE.SphereGeometry(1, 24, 18));
const capsule = (r, l) => geo(`cap:${r}:${l}`, () => new THREE.CapsuleGeometry(r, l, 6, 14));
const cyl = (rt, rb, h, s = 16) => geo(`cyl:${rt}:${rb}:${h}:${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const box = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const torusArc = (arc) => geo(`arc:${arc}`, () => new THREE.TorusGeometry(1, 0.22, 6, 16, arc));

function blob(size = 0.5) {
  const m = new THREE.Mesh(geo('plane', () => new THREE.PlaneGeometry(1, 1)), new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, opacity: 0.8 }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.012; m.scale.set(size, size, 1); m.renderOrder = 1;
  return m;
}

// A limb: pivot at the joint, the segment hanging down from it.
function limb(len, r, m) {
  const pivot = new THREE.Group();
  const seg = mesh(capsule(r, len), m, { y: -len / 2 - r * 0.2 });
  pivot.add(seg);
  return pivot;
}

// opts: { color, id, skin?, hair?, hairStyle?, accent?, owner? }
export function buildFigure(opts) {
  const h = hashStr(opts.id || 'x');
  const color = opts.color || '#888888';
  const skinC = opts.skin || SKIN[h % SKIN.length];
  const hairC = opts.hairColor || HAIR[(h >>> 4) % HAIR.length];
  const style = opts.hairStyle ?? HAIR_STYLES[(h >>> 8) % 4];
  const accent = opts.accent ?? (opts.owner ? 'flame' : ACCENTS[(h >>> 12) % ACCENTS.length]);
  const cloth = mat(color, { rough: 0.85, map: fabricTex('#ffffff') });
  const clothDark = mat(shade(color, -0.14), { rough: 0.85 });
  const skin = mat(skinC, { rough: 0.6 });
  const hair = mat(hairC, { rough: 0.55 });
  const pants = mat(opts.owner ? '#3b2c24' : shade(color, -0.32), { rough: 0.9 });
  const shoe = mat('#3a2a20', { rough: 0.7 });
  const white = mat('#ffffff', { rough: 0.3 });
  const ink = mat('#2a1d18', { rough: 0.4 });
  const blush = mat('#f08a8a', { rough: 0.9, transparent: true, opacity: 0.45 });

  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const hips = new THREE.Group(); hips.position.y = 0.36; body.add(hips);
  hips.add(mesh(sphere(), pants, { sx: 0.13, sy: 0.08, sz: 0.1 }));
  // legs
  const legs = [];
  for (const sx of [-1, 1]) {
    const thigh = limb(0.11, 0.045, pants); thigh.position.set(sx * 0.065, -0.02, 0);
    const knee = limb(0.1, 0.04, pants); knee.position.y = -0.17; thigh.add(knee);
    const foot = mesh(sphere(), shoe, { sx: 0.05, sy: 0.035, sz: 0.08, z: 0.025, y: -0.16 }); knee.add(foot);
    hips.add(thigh); legs.push({ thigh, knee });
  }
  // torso
  const spine = new THREE.Group(); spine.position.y = 0.04; hips.add(spine);
  const chest = mesh(capsule(0.115, 0.14), cloth, { y: 0.14, sz: 0.85 }); spine.add(chest);
  spine.add(mesh(cyl(0.125, 0.13, 0.05, 18), clothDark, { y: 0.03, sz: 0.85 })); // belt / hem
  // arms
  const arms = [];
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(sx * 0.15, 0.25, 0); spine.add(shoulder);
    shoulder.add(mesh(sphere(), cloth, { sx: 0.05, sy: 0.05, sz: 0.05 }));
    const upper = limb(0.09, 0.036, cloth); shoulder.add(upper);
    const elbow = limb(0.08, 0.032, skin); elbow.position.y = -0.14; upper.add(elbow);
    const hand = mesh(sphere(), skin, { sx: 0.038, sy: 0.042, sz: 0.038, y: -0.13 }); elbow.add(hand);
    arms.push({ shoulder, upper, elbow, hand });
  }
  // head
  const neck = new THREE.Group(); neck.position.y = 0.31; spine.add(neck);
  neck.add(mesh(cyl(0.035, 0.04, 0.06), skin, { y: 0.02 }));
  const head = new THREE.Group(); head.position.y = 0.17; neck.add(head);
  head.add(mesh(sphere(), skin, { sx: 0.165, sy: 0.155, sz: 0.15 }));
  for (const sx of [-1, 1]) head.add(mesh(sphere(), skin, { sx: 0.03, sy: 0.04, sz: 0.02, x: sx * 0.16, y: -0.01 })); // ears
  // face
  const face = new THREE.Group(); face.position.set(0, -0.01, 0.135); head.add(face);
  const eyes = new THREE.Group(); face.add(eyes);
  const lids = new THREE.Group(); face.add(lids); lids.visible = false;
  const closed = new THREE.Group(); face.add(closed); closed.visible = false;
  for (const sx of [-1, 1]) {
    eyes.add(mesh(sphere(), white, { sx: 0.03, sy: 0.036, sz: 0.015, x: sx * 0.058, y: 0.012, shadow: false }));
    const pupil = mesh(sphere(), ink, { sx: 0.019, sy: 0.025, sz: 0.012, x: sx * 0.058, y: 0.008, z: 0.01, shadow: false }); eyes.add(pupil);
    eyes.add(mesh(sphere(), white, { sx: 0.006, sy: 0.006, sz: 0.004, x: sx * 0.058 + 0.007, y: 0.02, z: 0.02, shadow: false }));
    lids.add(mesh(sphere(), skin, { sx: 0.034, sy: 0.02, sz: 0.018, x: sx * 0.058, y: 0.03, z: 0.004, shadow: false }));
    closed.add(mesh(torusArc(Math.PI), ink, { sx: 0.022, sy: 0.016, sz: 0.01, x: sx * 0.058, y: 0.0, z: 0.012, rz: Math.PI, shadow: false }));
    face.add(mesh(box(), hair, { sx: 0.045, sy: 0.009, sz: 0.01, x: sx * 0.06, y: 0.062, z: 0.0, rz: -sx * 0.12, shadow: false }));
    face.add(mesh(sphere(), blush, { sx: 0.024, sy: 0.014, sz: 0.006, x: sx * 0.095, y: -0.035, z: -0.005, shadow: false }));
  }
  face.children.filter((c) => c.geometry === box()).forEach((b, i) => { b.userData.brow = i ? 1 : -1; });
  face.add(mesh(sphere(), mat(shade(skinC, -0.06)), { sx: 0.014, sy: 0.012, sz: 0.012, y: -0.02, z: 0.012, shadow: false })); // nose
  const mouths = {
    smile: mesh(torusArc(Math.PI), ink, { sx: 0.03, sy: 0.026, sz: 0.01, y: -0.045, z: 0.004, rz: Math.PI, shadow: false }),
    calm: mesh(torusArc(Math.PI * 0.7), ink, { sx: 0.022, sy: 0.014, sz: 0.01, y: -0.05, z: 0.004, rz: Math.PI + Math.PI * 0.15, shadow: false }),
    tired: mesh(box(), ink, { sx: 0.03, sy: 0.006, sz: 0.008, y: -0.055, z: 0.006, shadow: false }),
    asleep: mesh(sphere(), ink, { sx: 0.012, sy: 0.009, sz: 0.006, y: -0.052, z: 0.006, shadow: false }),
  };
  for (const m of Object.values(mouths)) face.add(m);
  // hair or hood
  if (style === 'hood') {
    head.add(mesh(sphere(), cloth, { sx: 0.19, sy: 0.185, sz: 0.18, y: 0.02, z: -0.02 }));
    const opening = mesh(sphere(), skin, { sx: 0.15, sy: 0.14, sz: 0.06, y: -0.01, z: 0.12, shadow: false }); head.add(opening);
    head.add(mesh(sphere(), hair, { sx: 0.12, sy: 0.04, sz: 0.04, y: 0.1, z: 0.14 })); // fringe
    for (const sx of [-1, 1]) head.add(mesh(sphere(), cloth, { sx: 0.045, sy: 0.06, sz: 0.04, x: sx * 0.11, y: 0.17, z: -0.02, rz: -sx * 0.4 })); // little hood ears, like the 2D critters
  } else {
    head.add(mesh(sphere(), hair, { sx: 0.172, sy: 0.15, sz: 0.158, y: 0.035, z: -0.012 }));
    head.add(mesh(sphere(), hair, { sx: 0.14, sy: 0.05, sz: 0.06, y: 0.1, z: 0.1, rx: 0.3 })); // fringe
    if (style === 'curly') for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; head.add(mesh(sphere(), hair, { sx: 0.05, sy: 0.05, sz: 0.05, x: Math.cos(a) * 0.14, y: 0.1 + Math.sin(a * 2) * 0.02, z: Math.sin(a) * 0.12 - 0.02 })); }
    if (style === 'bun') head.add(mesh(sphere(), hair, { sx: 0.07, sy: 0.065, sz: 0.07, y: 0.17, z: -0.06 }));
    if (style === 'long') head.add(mesh(capsule(0.12, 0.12), hair, { y: -0.08, z: -0.07, sx: 1.25, sz: 0.6 }));
  }
  // personal accent (small and original)
  const acc = new THREE.Group(); spine.add(acc);
  const accentC = opts.owner ? '#ffb347' : shade(color, 0.28);
  if (accent === 'scarf') { acc.add(mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 18), mat(accentC, { map: fabricTex(accentC) }), { y: 0.3, rx: Math.PI / 2 })); acc.add(mesh(capsule(0.03, 0.08), mat(accentC), { x: 0.05, y: 0.22, z: 0.1, rz: 0.2 })); }
  if (accent === 'bowtie') for (const sx of [-1, 1]) acc.add(mesh(sphere(), mat(accentC), { sx: 0.035, sy: 0.025, sz: 0.015, x: sx * 0.03, y: 0.28, z: 0.105 }));
  if (accent === 'badge') acc.add(mesh(cyl(0.025, 0.025, 0.01), mat('#ffd36b', { metal: 0.6, rough: 0.3 }), { x: 0.06, y: 0.2, z: 0.1, rx: Math.PI / 2 }));
  if (accent === 'glasses') for (const sx of [-1, 1]) face.add(mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 16), ink, { x: sx * 0.058, y: 0.012, z: 0.02, shadow: false }));
  if (accent === 'headphones') { head.add(mesh(new THREE.TorusGeometry(0.17, 0.014, 6, 24, Math.PI), mat('#3a3a42'), { y: 0.02 })); for (const sx of [-1, 1]) head.add(mesh(cyl(0.045, 0.045, 0.03), mat(accentC), { x: sx * 0.17, rz: Math.PI / 2 })); }
  if (accent === 'beanie') { head.add(mesh(sphere(), mat(accentC, { map: fabricTex(accentC) }), { sx: 0.178, sy: 0.12, sz: 0.168, y: 0.07, z: -0.01 })); head.add(mesh(sphere(), mat(shade(accentC, 0.2)), { sx: 0.045, sy: 0.045, sz: 0.045, y: 0.2 })); }
  if (accent === 'flame') { // the owner's flame badge
    const fl = new THREE.Group(); fl.position.set(0.06, 0.2, 0.105);
    fl.add(mesh(new THREE.ConeGeometry(0.03, 0.07, 10), mat('#ff8a2a', { emissive: '#ff6a00', ei: 1.4 }), { y: 0.01 }));
    fl.add(mesh(new THREE.ConeGeometry(0.016, 0.04, 10), mat('#ffe08a', { emissive: '#ffcf4a', ei: 1.6 }), { y: 0.0, z: 0.012 }));
    acc.add(fl);
    acc.add(mesh(new THREE.TorusGeometry(0.1, 0.03, 8, 18), mat('#e8833a', { map: fabricTex('#e8833a') }), { y: 0.3, rx: Math.PI / 2 }));
  }
  // held items
  const paper = mesh(box(), mat('#fbf6e9', { rough: 0.9 }), { sx: 0.12, sy: 0.16, sz: 0.006, y: -0.16, z: 0.04, rx: -0.4 }); paper.visible = false; arms[1].elbow.add(paper);
  const mug = new THREE.Group(); mug.position.set(0, -0.15, 0.03);
  mug.add(mesh(cyl(0.032, 0.028, 0.06), mat('#f0e4d0', { rough: 0.4 })));
  mug.add(mesh(new THREE.TorusGeometry(0.018, 0.006, 6, 12), mat('#f0e4d0'), { x: 0.035, rz: Math.PI / 2 }));
  mug.add(mesh(cyl(0.028, 0.028, 0.005), mat('#5a3420'), { y: 0.027, shadow: false }));
  mug.visible = false; arms[1].elbow.add(mug);
  root.add(blob(0.55));
  root.userData.fig = { body, hips, spine, neck, head, legs, arms, eyes, lids, closed, mouths, paper, mug, face, phase: Math.random() * 10, look: 0 };
  return root;
}

const lerp = (a, b, k) => a + (b - a) * k;
function approach(obj, key, target, k) { obj[key] = lerp(obj[key], target, k); }

// vis: from map.mjs visualFor(); t: seconds; dt: seconds; opts: { reduced, lookAt (yaw offset or null), seatY }
export function animateFigure(root, vis, t, dt, { reduced = false, lookYaw = null, seatY = 0.28, bedY = 0.5, bedZ = 0.6 } = {}) {
  const f = root.userData.fig;
  const k = reduced ? 1 : Math.min(1, dt * 10);
  const tt = reduced ? 0 : t + f.phase;
  const L = f.legs; const A = f.arms;
  // pose targets
  let bodyY = 0; let lay = 0; let thighX = 0; let kneeX = 0; let spineX = 0;
  const sh = [{ x: 0.05, z: 0.08 }, { x: 0.05, z: -0.08 }]; const el = [0, 0];
  let swing = 0; let bob = 0;
  if (vis.pose === 'walk') {
    const p = tt * 9 * (vis.speed || 1);
    swing = Math.sin(p); bob = Math.abs(Math.cos(p)) * 0.025;
    spineX = 0.06;
  } else if (vis.pose === 'sit' || vis.pose === 'type') {
    bodyY = seatY - 0.36 + 0.02; thighX = -1.45; kneeX = 1.45; spineX = vis.pose === 'type' ? 0.12 : -0.04;
    if (vis.pose === 'type') { sh[0].x = sh[1].x = -0.95; el[0] = el[1] = -0.55; sh[0].z = 0.18; sh[1].z = -0.18; }
  } else if (vis.pose === 'sleep') {
    lay = 1; bodyY = bedY; sh[0].z = 0.25; sh[1].z = -0.25;
  }
  // gestures and held items
  if (vis.hold === 'paper') { sh[1].x = -0.9; el[1] = -0.6; }
  if (vis.hold === 'mug') { sh[1].x = -0.35; el[1] = -1.5; }
  if (vis.gesture === 'wave') { sh[1].x = -0.2; sh[1].z = -2.6; el[1] = reduced ? -0.4 : -0.4 + Math.sin(tt * 10) * 0.45; }
  if (vis.gesture === 'cheer') { sh[0].z = 2.6; sh[1].z = -2.6; el[0] = el[1] = -0.2; bob = reduced ? 0 : Math.abs(Math.sin(tt * 6)) * 0.08; }
  // apply
  approach(f.body.position, 'y', bodyY + bob, k);
  approach(f.body.rotation, 'x', lay ? -Math.PI / 2 : 0, k);
  f.body.position.z = lay ? bedZ : 0;
  approach(f.spine.rotation, 'x', spineX, k);
  const breathe = reduced ? 0 : Math.sin(tt * 2.2) * 0.012;
  f.spine.scale.set(1 + breathe * 0.5, 1 + breathe, 1 + breathe * 0.5);
  for (let i = 0; i < 2; i++) {
    const s = i ? -1 : 1;
    const legSwing = vis.pose === 'walk' ? swing * 0.55 * s : 0;
    approach(L[i].thigh.rotation, 'x', thighX + legSwing, k);
    approach(L[i].knee.rotation, 'x', kneeX + (vis.pose === 'walk' ? Math.max(0, -swing * s) * 0.7 : 0), k);
    const armSwing = vis.pose === 'walk' && !(i === 1 && vis.hold) ? -swing * 0.5 * s : 0;
    let typing = 0;
    if (vis.pose === 'type' && !reduced) typing = Math.sin(tt * 14 + i * 2.1) * 0.08;
    approach(A[i].shoulder.rotation, 'x', sh[i].x + armSwing + typing, k);
    approach(A[i].shoulder.rotation, 'z', sh[i].z, k);
    approach(A[i].elbow.rotation, 'x', el[i] + typing * 0.6, k);
  }
  // head: idle look-around, or toward the owner when he's near
  let yaw = 0; let pitch = 0;
  if (lookYaw != null) yaw = Math.max(-1.1, Math.min(1.1, lookYaw));
  else if (!reduced && (vis.pose === 'stand' || vis.pose === 'sit')) yaw = Math.sin(tt * 0.35) * 0.45 * Math.max(0, Math.sin(tt * 0.13));
  if (vis.pose === 'type') pitch = 0.18;
  approach(f.head.rotation, 'y', yaw, reduced ? 1 : Math.min(1, dt * 4));
  approach(f.head.rotation, 'x', pitch, k);
  // face
  const asleep = vis.face === 'asleep';
  const blink = !reduced && !asleep && (tt % 4.2) < 0.12;
  f.eyes.visible = !asleep && !blink; f.closed.visible = asleep || blink;
  f.lids.visible = vis.face === 'tired' && !asleep;
  for (const [name, m] of Object.entries(f.mouths)) m.visible = name === vis.face;
  f.face.children.forEach((c) => { if (c.userData.brow) c.rotation.z = (vis.face === 'tired' ? 0.35 : vis.face === 'smile' ? -0.1 : -0.12) * -c.userData.brow; });
  f.paper.visible = vis.hold === 'paper';
  f.mug.visible = vis.hold === 'mug';
}

// ---------- the ember-fox pet ----------
export function buildPet() {
  const fur = mat('#d9692e', { rough: 0.8 });
  const cream = mat('#f4e2c6', { rough: 0.85 });
  const dark = mat('#3a2418', { rough: 0.6 });
  const ember = mat('#ffb04a', { emissive: '#ff7a1a', ei: 1.3 });
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const torso = mesh(capsule(0.09, 0.16), fur, { y: 0.17, rx: Math.PI / 2 }); body.add(torso);
  body.add(mesh(sphere(), cream, { sx: 0.07, sy: 0.06, sz: 0.1, y: 0.13, z: 0.04 }));
  const head = new THREE.Group(); head.position.set(0, 0.27, 0.15); body.add(head);
  head.add(mesh(sphere(), fur, { sx: 0.1, sy: 0.09, sz: 0.095 }));
  head.add(mesh(new THREE.ConeGeometry(0.05, 0.1, 12), cream, { z: 0.1, y: -0.02, rx: Math.PI / 2 }));
  head.add(mesh(sphere(), dark, { sx: 0.016, sy: 0.014, sz: 0.014, z: 0.15, y: -0.02 }));
  for (const sx of [-1, 1]) {
    head.add(mesh(new THREE.ConeGeometry(0.04, 0.09, 4), fur, { x: sx * 0.055, y: 0.09, z: -0.01, rz: -sx * 0.25 }));
    head.add(mesh(sphere(), dark, { sx: 0.014, sy: 0.018, sz: 0.01, x: sx * 0.04, y: 0.02, z: 0.085 }));
  }
  const legs = [];
  for (const [x, z] of [[-0.05, 0.1], [0.05, 0.1], [-0.05, -0.08], [0.05, -0.08]]) { const l = limb(0.06, 0.022, dark); l.position.set(x, 0.12, z); body.add(l); legs.push(l); }
  const tail = new THREE.Group(); tail.position.set(0, 0.2, -0.15); body.add(tail);
  tail.add(mesh(capsule(0.05, 0.16), fur, { y: 0.0, z: -0.1, rx: Math.PI / 2 - 0.5 }));
  tail.add(mesh(sphere(), ember, { sx: 0.05, sy: 0.05, sz: 0.06, z: -0.2, y: 0.09 })); // glowing ember tip
  root.add(blob(0.45));
  root.userData.fig = { body, head, legs, tail, phase: Math.random() * 5 };
  return root;
}
export function animatePet(root, pose, t, dt, { reduced = false } = {}) {
  const f = root.userData.fig; const tt = reduced ? 0 : t + f.phase;
  const k = reduced ? 1 : Math.min(1, dt * 8);
  const walk = pose === 'walk';
  const nap = pose === 'nap';
  f.legs.forEach((l, i) => approach(l.rotation, 'x', walk ? Math.sin(tt * 12 + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * 0.6 : nap ? 1.3 * (i < 2 ? -1 : 1) : 0, k));
  approach(f.body.position, 'y', nap ? -0.08 : pose === 'sit' ? -0.02 : walk ? Math.abs(Math.sin(tt * 12)) * 0.015 : 0, k);
  approach(f.head.rotation, 'x', nap ? 0.5 : 0, k);
  f.tail.rotation.y = reduced ? 0 : Math.sin(tt * (walk ? 8 : 2)) * (nap ? 0.1 : 0.4);
  approach(f.tail.rotation, 'x', nap ? -0.6 : 0, k);
}

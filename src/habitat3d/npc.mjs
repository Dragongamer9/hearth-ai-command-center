// Habitat 3D (2.4): the townsfolk, guards and raiders. Small anime chibis made of a
// handful of shared meshes each (cheap to draw), plus floating health bars, arrows,
// dizzy stars and the poof. Cartoony on purpose: no blood, hits only flash.
import * as THREE from '../vendor/three/three.module.min.js';
import { toon, inked } from './toon.mjs';
import { outfitColors } from './castlemap.mjs';

const G = {};
const geo = (k, f) => (G[k] ||= f());
const M = (c, o) => toon(c, o);
function part(parent, g, m, x, y, z, o = {}) { const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); if (o.s) mesh.scale.set(...o.s); if (o.rx) mesh.rotation.x = o.rx; if (o.rz) mesh.rotation.z = o.rz; mesh.castShadow = o.cast !== false; if (o.ink) inked(mesh, o.ink === true ? 1.06 : o.ink); parent.add(mesh); return mesh; }

// look: a normChar()-shaped character. kind: 'folk' | 'guard' | 'raider' | 'cat'.
export function buildNpc(look, { kind = 'folk', small = false } = {}) {
  const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
  const k = small ? 0.72 : 1;
  if (kind === 'cat') {
    const fur = M(['#f2a65a', '#3a2a22', '#e9e4f2'][Math.abs(look.hairColor.charCodeAt(2)) % 3]);
    part(body, geo('catb', () => new THREE.SphereGeometry(0.28, 12, 8)), fur, 0, 0.26, 0, { s: [1, 0.8, 1.5], ink: true });
    part(body, geo('cath', () => new THREE.SphereGeometry(0.2, 12, 8)), fur, 0, 0.42, 0.34, { ink: true });
    for (const sx of [-1, 1]) part(body, geo('cate', () => new THREE.ConeGeometry(0.07, 0.14, 4)), fur, sx * 0.1, 0.6, 0.34);
    part(body, geo('catt', () => new THREE.CylinderGeometry(0.04, 0.03, 0.5, 6)), fur, 0, 0.42, -0.42, { rx: -0.6 });
    root.userData.npc = { body, legs: [], kind, h: 0.7 };
    return root;
  }
  const oc = kind === 'guard' ? { outfit: '#5c6b80', trim: '#e8c35a' } : kind === 'raider' ? { outfit: '#8a5634', trim: '#c0563f' } : outfitColors(look);
  const cloth = M(oc.outfit); const trim = M(oc.trim); const skin = M(look.skin || '#ffe2cf'); const hair = M(look.hairColor); const ink = M('#2a2230'); const iris = M(look.eyes);
  const legs = [];
  for (const sx of [-1, 1]) { const lg = new THREE.Group(); lg.position.set(sx * 0.12, 0.42, 0); body.add(lg); part(lg, geo('leg', () => new THREE.CylinderGeometry(0.07, 0.07, 0.4, 6)), M('#3a2a30'), 0, -0.2, 0); legs.push(lg); }
  part(body, geo('torso', () => new THREE.CylinderGeometry(0.22, 0.3, 0.55, 10)), cloth, 0, 0.66, 0, { ink: true });
  part(body, geo('belt', () => new THREE.CylinderGeometry(0.305, 0.305, 0.07, 10)), trim, 0, 0.5, 0);
  const head = new THREE.Group(); head.position.y = 1.18; body.add(head);
  part(head, geo('head', () => new THREE.SphereGeometry(0.36, 16, 12)), skin, 0, 0, 0, { ink: true });
  part(head, geo('cap', () => new THREE.SphereGeometry(0.385, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)), hair, 0, 0.04, -0.02, { ink: true });
  part(head, geo('bang', () => new THREE.BoxGeometry(0.6, 0.16, 0.18)), hair, 0, 0.2, 0.25, { rx: 0.35 });
  for (const sx of [-1, 1]) { part(head, geo('eye', () => new THREE.SphereGeometry(0.075, 10, 8)), ink, sx * 0.13, -0.02, 0.31, { s: [1, 1.35, 0.5], cast: false }); part(head, geo('iris', () => new THREE.SphereGeometry(0.055, 10, 8)), iris, sx * 0.13, -0.035, 0.34, { s: [1, 1.3, 0.4], cast: false }); }
  if (look.hair === 'long' || look.hair === 'pony') part(head, geo('back', () => new THREE.CapsuleGeometry(0.18, 0.5, 4, 8)), hair, 0, -0.3, -0.24);
  if (look.hair === 'twin') for (const sx of [-1, 1]) part(head, geo('tail', () => new THREE.CapsuleGeometry(0.1, 0.4, 4, 8)), hair, sx * 0.4, -0.15, -0.05, { rz: sx * 0.25 });
  if (look.hair === 'spiky') for (let i = -2; i <= 2; i++) part(head, geo('spike', () => new THREE.ConeGeometry(0.1, 0.3, 6)), hair, i * 0.13, 0.4, -0.04, { rz: -i * 0.25 });
  if (look.accessory === 'catears' && kind === 'folk') for (const sx of [-1, 1]) part(head, geo('cear', () => new THREE.ConeGeometry(0.11, 0.22, 4)), hair, sx * 0.22, 0.38, 0, { rz: -sx * 0.3 });
  // gear
  if (kind === 'guard') { part(head, geo('helm', () => new THREE.SphereGeometry(0.4, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)), M('#b9c3d6'), 0, 0.06, 0, { ink: true }); }
  if (kind === 'raider') { part(head, geo('hood', () => new THREE.ConeGeometry(0.42, 0.5, 10)), M('#6d4128'), 0, 0.36, -0.03, { ink: true }); part(head, geo('mask', () => new THREE.BoxGeometry(0.56, 0.08, 0.1)), M('#2a2230'), 0, 0.06, 0.33); }
  const hand = new THREE.Group(); hand.position.set(0.32, 0.78, 0.08); body.add(hand);
  const gear = {};
  gear.sword = part(hand, geo('sword', () => new THREE.BoxGeometry(0.06, 0.62, 0.03)), M('#dfe6f2'), 0, 0.25, 0); gear.sword.visible = false;
  gear.spear = part(hand, geo('spear', () => new THREE.CylinderGeometry(0.025, 0.025, 1.6, 6)), M('#8a5634'), 0, 0.4, 0); gear.spear.visible = false;
  gear.bow = part(hand, geo('bow', () => new THREE.TorusGeometry(0.32, 0.03, 6, 14, Math.PI)), M('#8a5634'), 0, 0.2, 0, { rz: Math.PI / 2 }); gear.bow.visible = false;
  gear.torch = new THREE.Group(); hand.add(gear.torch); gear.torch.visible = false;
  part(gear.torch, geo('tstick', () => new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6)), M('#6d4128'), 0, 0.2, 0);
  part(gear.torch, geo('tfire', () => new THREE.SphereGeometry(0.11, 8, 6)), new THREE.MeshBasicMaterial({ color: '#ffb347' }), 0, 0.5, 0, { cast: false });
  gear.club = part(hand, geo('club', () => new THREE.CylinderGeometry(0.05, 0.09, 0.6, 6)), M('#6d4128'), 0, 0.25, 0); gear.club.visible = false;
  root.scale.setScalar(k);
  root.userData.npc = { body, head, legs, hand, gear, kind, h: 1.65 * k, flashMat: null, mats: [cloth, skin] };
  return root;
}

// One frame: walking legs, a hit flash (a quick bob back), sitting dazed, dizzy.
export function animateNpc(root, { moving = false, t = 0, flash = false, dazed = false, dizzy = false, attack = false, reduced = false } = {}) {
  const n = root.userData.npc; if (!n) return;
  const sw = moving && !reduced ? Math.sin(t * 9 + root.id) : 0;
  n.legs.forEach((l, i) => { l.rotation.x = (i ? -sw : sw) * 0.6; });
  n.body.position.y = moving && !reduced ? Math.abs(Math.cos(t * 9 + root.id)) * 0.05 : 0;
  n.body.rotation.x = dazed ? -0.25 : flash ? -0.35 : 0;
  n.body.position.z = flash ? -0.25 : 0;
  if (dazed) { n.body.position.y = -0.35; n.legs.forEach((l) => { l.rotation.x = -1.4; }); }
  if (n.hand) n.hand.rotation.x = attack && !reduced ? -Math.abs(Math.sin(t * 7 + root.id)) * 1.6 : 0;
  if (n.head) n.head.rotation.z = dizzy && !reduced ? Math.sin(t * 10) * 0.25 : 0;
}
export function setGear(root, name) { const g = root.userData.npc?.gear; if (!g) return; for (const [k, m] of Object.entries(g)) m.visible = k === name; }

// A floating health bar (always faces the camera).
export function healthBar() {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(geo('hbbg', () => new THREE.PlaneGeometry(0.9, 0.14)), new THREE.MeshBasicMaterial({ color: '#2a2230', depthTest: false, transparent: true, opacity: 0.85 }));
  const fill = new THREE.Mesh(geo('hbf', () => new THREE.PlaneGeometry(0.84, 0.09)), new THREE.MeshBasicMaterial({ color: '#7fdc8b', depthTest: false }));
  fill.position.z = 0.001; bg.renderOrder = 20; fill.renderOrder = 21; g.add(bg); g.add(fill); g.userData.fill = fill;
  return g;
}
export function setHealth(bar, hp, camera) {
  const f = bar.userData.fill; const k = Math.max(0, Math.min(1, hp / 100));
  f.scale.x = Math.max(0.001, k); f.position.x = -0.42 * (1 - k);
  f.material.color.set(k > 0.5 ? '#7fdc8b' : k > 0.25 ? '#ffd27a' : '#ff8a6a');
  if (camera) bar.quaternion.copy(camera.quaternion);
  bar.visible = hp > 0;
}
export function dizzyStars() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(geo('star', () => new THREE.OctahedronGeometry(0.09)), new THREE.MeshBasicMaterial({ color: '#ffe27a' })); s.userData.a = (i / 3) * Math.PI * 2; g.add(s); }
  return g;
}
export function spinStars(g, t) { g.children.forEach((s) => { const a = s.userData.a + t * 5; s.position.set(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35); }); }
export function poof() { return new THREE.Mesh(geo('poof', () => new THREE.SphereGeometry(0.6, 10, 8)), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false })); }
export function arrow(bolt = false) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(geo(bolt ? 'bolt' : 'arrow', () => new THREE.CylinderGeometry(0.025, 0.025, bolt ? 0.5 : 0.8, 5)), M('#6d4128')); shaft.rotation.x = Math.PI / 2; g.add(shaft);
  const tip = new THREE.Mesh(geo('atip', () => new THREE.ConeGeometry(0.05, 0.14, 5)), M('#dfe6f2')); tip.rotation.x = Math.PI / 2; tip.position.z = bolt ? 0.3 : 0.45; g.add(tip);
  return g;
}
// Where an arrow is: a high arc from a to b (k 0..1).
export function arcAt(a, b, k) { return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k + Math.sin(k * Math.PI) * 4, z: a.z + (b.z - a.z) * k }; }

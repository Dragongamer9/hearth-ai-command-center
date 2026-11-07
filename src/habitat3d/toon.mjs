// Habitat 3D (2.4): the anime look. Cel shading with a hard three-band ramp and
// ink outlines (an inverted, slightly larger copy drawn back faces only).
import * as THREE from '../vendor/three/three.module.min.js';

let ramp = null;
export function toonRamp() {
  if (ramp) return ramp;
  const d = new Uint8Array([92, 92, 92, 255, 176, 176, 176, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.generateMipmaps = false; ramp.needsUpdate = true;
  return ramp;
}
const cache = new Map();
// opts: { map, emissive, ei, transparent, opacity, side }
export function toon(color, o = {}) {
  const key = `${color}|${o.map?.uuid || ''}|${o.emissive || ''}|${o.ei || 0}|${o.transparent ? o.opacity : ''}|${o.side || ''}`;
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), map: o.map || null });
  if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei ?? 1; }
  if (o.transparent) { m.transparent = true; m.opacity = o.opacity ?? 1; m.depthWrite = (o.opacity ?? 1) > 0.95; }
  if (o.side) m.side = o.side;
  cache.set(key, m);
  return m;
}
export const INK = new THREE.MeshBasicMaterial({ color: '#2a2230', side: THREE.BackSide });
// Adds an ink outline as a child; w is how much bigger (1.04 = 4%).
export function inked(mesh, w = 1.04) {
  const o = new THREE.Mesh(mesh.geometry, INK); o.scale.setScalar(w); o.castShadow = false; o.receiveShadow = false; o.userData.ink = true; o.raycast = () => {};
  mesh.add(o);
  return mesh;
}
export function disposeToon() { for (const m of cache.values()) m.dispose(); cache.clear(); }
export const PASTEL = { stone: '#e3dcef', stone2: '#cdc3df', stoneDark: '#9a90b2', grass: '#8ccf7e', grass2: '#76bd6a', road: '#e8c9a0', paving: '#d9cfe0', water: '#6cc3f0', waterNight: '#2b4c7a', wood: '#8a5634', woodDark: '#6d4128', roofs: ['#ec7552', '#5b7cfa', '#9a7cff', '#3d7a5c', '#f2c14e', '#c0563f', '#3f5fb0', '#b04466'], walls: ['#f4e3c8', '#f2d2c2', '#e9dcf2', '#d7ecd9', '#f6e7b0', '#fbeee0'] };

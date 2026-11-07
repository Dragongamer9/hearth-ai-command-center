// Habitat 3D: the Cozy Hearth lodge view. It shows the same simulation as the
// 2D Habitat (src/habitat.mjs keeps running underneath, headless) and sends
// clicks back to it, so both views always agree. Rendering only; the mappings
// are pure and tested in ./map.mjs and ./walk.mjs.
import * as THREE from '../vendor/three/three.module.min.js';
import './habitat3d.css';
import { habitatEngine } from '../habitat.mjs';
import { roomOf } from '../habitat/world.mjs';
import { gardenState } from '../habitat/life.mjs';
import { tileTo3D, facingOf, visualFor, doorClosed, lampLit, normPrefs, withPref, pickView, motionFor, pixelRatio, lightRig, presets, pxToTile, sceneKey, lodgeBounds, cityBounds, layoutOf, HAIR_STYLES, OUTFITS } from './map.mjs';
import { STUDY, STUDY_DOOR, NOOK, ownerFree, moveAvatar, inputFrom, speedFor, stepDelta, camBob, nearestTarget, noticers, ownerPool, ownerEdit, KEYS } from './walk.mjs';
import { buildLodge, disposeTree } from './lodge.mjs';
import { buildFigure, animateFigure, buildPet, animatePet } from './figures.mjs';
import { iconTex, screenTex, labelTex, glowTex } from './textures.mjs';
import { buildCastle } from './castle.mjs';
import { buildNpc, animateNpc, setGear, healthBar, setHealth, dizzyStars, spinStars, poof, arrow, arcAt } from './npc.mjs';
import { zoneOf, zoneKey, routeBetween, pathLength, alongPath, timeOfDay, charFor, townsfolk, folkAt, guards, guardAt, folkCount, guardCount, raidAt, planRaid, raidState, guardDazed, RAID_LEN, WALL_TOP, normRaids } from './castlemap.mjs';
import { charactersPanel, bindCharacters } from './charui.mjs';

let V = null;
let winBound = false;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const now = () => performance.now();

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

// ---------- setup ----------
function createRenderer() {
  const canvas = document.createElement('canvas');
  canvas.className = 'hab3d-canvas';
  canvas.setAttribute('aria-label', 'Habitat in 3D: the castle city. Each AI’s house on the street, the keep with its great hall and garden, and the King’s Chambers on top');
  canvas.setAttribute('role', 'img');
  canvas.tabIndex = 0;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1.6, 0.05, 900);
  const hemi = new THREE.HemisphereLight('#dfefff', '#6b5240', 0.8); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.2); sun.castShadow = true; scene.add(sun); scene.add(sun.target);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
  const rim = new THREE.DirectionalLight('#ffd2a0', 0.45); rim.position.set(-10, 8, -16); scene.add(rim);
  const fill = new THREE.AmbientLight('#ffe7cc', 0.18); scene.add(fill);
  scene.fog = new THREE.Fog('#cfe3ee', 60, 160);
  const dyn = new THREE.Group(); scene.add(dyn);
  const fx = new THREE.Group(); scene.add(fx);
  return { canvas, renderer, scene, camera, hemi, sun, rim, fill, dyn, fx };
}

function ensure() {
  if (V) return V;
  V = {
    ok: null, gl: null, figs: new Map(), pet: null, avatar: null, lodge: null, key: '', world: null, phase: '', raf: 0, last: 0, visible: true,
    cam: { target: new THREE.Vector3(0, 0, 1), dist: 40, theta: 0.3, phi: 0.95 }, goal: null, frames: 0,
    fxMap: new Map(), icons: new Map(), particles: null, weather: '', notice: '', lighter: false,
    walk: { on: false, pos: { x: 1, y: 11 }, yaw: Math.PI / 2, pitch: -0.12, sit: null, mugUntil: 0, camPos: null, prev: {}, moving: false, faceYaw: 0 },
    keys: new Set(), tapped: new Set(), touch: { move: null, look: null }, notice3d: new Map(), lastScreen: 0, prefs: normPrefs(null), opts: null,
    castle: null, castleKey: '', zones: new Map(), transit: new Map(), npcs: [], raid: null, raidSeen: 0, defend: new Set(),
  };
  return V;
}

// ---------- public ----------
// el: #habitat (the 2D card). opts: the Habitat hooks plus view3d()/saveView3d(v).
export function mountHabitat3d(el, opts) {
  if (!el) return stopHabitat3d();
  const v = ensure();
  v.el = el; v.opts = opts;
  v.prefs = normPrefs(opts.view3d?.());
  if (v.ok === null) v.ok = webglAvailable();
  toolbar();
  apply();
}
export function stopHabitat3d() {
  if (!V) return;
  if (V.raf) cancelAnimationFrame(V.raf); V.raf = 0;
  if (V.timer) clearTimeout(V.timer); V.timer = 0;
  V.ro?.disconnect(); V.io?.disconnect();
  if (V.walk.on) exitWalk();
  teardown();
}
// Leaving the Habitat page frees the GPU: the lodge, the renderer and its WebGL context
// are disposed, and recreated when the page is shown again.
function teardown() {
  if (!V?.gl) return;
  const gl = V.gl;
  try { if (V.lodge) { gl.scene.remove(V.lodge.root); disposeTree(V.lodge.root, V.lodge.refs.textures); } } catch {}
  try { gl.scene.traverse((o) => o.geometry?.dispose?.()); } catch {}
  try { V.screenTex?.dispose(); gl.sun.shadow.map?.dispose(); } catch {}
  try { gl.renderer.dispose(); gl.renderer.forceContextLoss(); } catch {}
  gl.canvas.remove();
  for (const n of Object.values(V.nodes || {})) n.remove();
  Object.assign(V, { castle: null, castleKey: '', npcs: [], zones: new Map(), transit: new Map(), raid: null, defend: new Set() });
  Object.assign(V, { gl: null, lodge: null, key: '', figs: new Map(), pet: null, avatar: null, fxMap: new Map(), icons: new Map(), notice3d: new Map(), particles: null, weather: '', screenTex: null, frames: 0 });
}

function savePrefs(p) { V.prefs = normPrefs(p); V.opts?.saveView3d?.(V.prefs); }

// Which view shows right now: 3D only when chosen, WebGL works and nobody is rearranging.
function apply() {
  const eng = habitatEngine();
  if (!eng || !V.el) return;
  const want = pickView(V.prefs, { webgl: V.ok, rearranging: eng.rearranging });
  V.notice = want.notice;
  const c2 = V.el.querySelector('canvas:not(.hab3d-canvas)');
  if (want.mode === '3d' && !V.gl) {
    try { V.gl = createRenderer(); } catch { V.ok = false; V.gl = null; return apply(); }
    V.gl.canvas.habitat3d = api();
    bindPointer();
  }
  if (want.mode === '3d') {
    V.el.classList.add('hab3d-on');
    if (V.gl.canvas.parentElement !== V.el) V.el.insertBefore(V.gl.canvas, V.el.querySelector('.hab-tip'));
    for (const n of ['vignette', 'hud', 'bubble', 'panel', 'stick']) { const d = node(n); if (d.parentElement !== V.el) V.el.appendChild(d); }
    if (c2) c2.style.display = 'none';
    eng.setHeadless(true);
    V.lighter = V.prefs.lighter;
    observe();
    resize();
    start();
  } else {
    V.el.classList.remove('hab3d-on');
    V.gl?.canvas.remove();
    for (const n of ['vignette', 'hud', 'bubble', 'panel', 'stick', 'toast', 'chars']) V.nodes?.[n]?.remove();
    if (c2) c2.style.display = '';
    eng.setHeadless(false);
    if (V.raf) cancelAnimationFrame(V.raf); V.raf = 0;
    if (V.walk.on) exitWalk();
  }
  noticeLine();
}
function node(name) {
  V.nodes ||= {};
  if (!V.nodes[name]) { const d = document.createElement('div'); d.className = `hab3d-${name}`; if (name !== 'vignette') d.hidden = true; V.nodes[name] = d; }
  return V.nodes[name];
}

// The 2D/3D switch and the 3D tools, above the legend. Saved; they never change by themselves.
function toolbar() {
  const foot = V.el.parentElement?.querySelector('.hab-foot') || V.el.nextElementSibling;
  if (!foot) return;
  let bar = foot.querySelector('.hab3d-bar');
  if (!bar) { bar = document.createElement('div'); bar.className = 'hab3d-bar'; foot.prepend(bar); }
  const p = V.prefs; const is3 = p.mode === '3d';
  const world = habitatEngine()?.world;
  const names = Object.fromEntries(Object.entries(habitatEngine()?.agents || {}).map(([k, a]) => [k, a.name]));
  const pre = world ? presets(world, names) : [];
  bar.innerHTML = `<div class="hab3d-seg" role="group" aria-label="Habitat view"><button class="btn small${is3 ? '' : ' primary'}" data-h3="2d" aria-pressed="${!is3}">2D</button><button class="btn small${is3 ? ' primary' : ''}" data-h3="3d" aria-pressed="${is3}">3D</button></div>
    ${is3 ? `<select class="hab3d-pre" aria-label="Camera view">${pre.map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('')}<option value="study">King’s Chambers (decorate)</option></select>
    <button class="btn small" data-h3="walk">Walk the castle</button><button class="btn small" data-h3="study">King’s Chambers…</button><button class="btn small" data-h3="chars">Characters…</button>
    <select class="hab3d-time" aria-label="Time of day">${[['auto', 'Time: follow the clock'], ['day', 'Day'], ['sunset', 'Sunset'], ['night', 'Night']].map(([v, l]) => `<option value="${v}"${p.time === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    <label class="hab3d-check"><input type="checkbox" data-h3="lighter" ${p.lighter ? 'checked' : ''}> Lighter 3D</label>
    <label class="hab3d-check"><input type="checkbox" data-h3="folk" ${p.folk ? 'checked' : ''}> Townsfolk and guards</label>
    <select class="hab3d-raids" aria-label="Raids">${[['off', 'Raids: off'], ['rare', 'Raids: rare'], ['sometimes', 'Raids: sometimes'], ['often', 'Raids: often']].map(([v, l]) => `<option value="${v}"${(raidsOn() ? p.raids.freq : 'off') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    <a href="#" class="hab3d-link" data-h3="rearrange2d">Rearrange in 2D</a>` : ''}<span class="hab3d-note faint"></span>`;
  bar.querySelectorAll('[data-h3]').forEach((b) => b.addEventListener(b.type === 'checkbox' ? 'change' : 'click', (e) => { e.preventDefault(); barAction(b.dataset.h3, b); }));
  bar.querySelector('.hab3d-pre')?.addEventListener('change', (e) => { if (e.target.value === 'study') return goStudy(); preset(e.target.value); });
  bar.querySelector('.hab3d-time')?.addEventListener('change', (e) => { savePrefs(withPref(V.prefs, 'time', e.target.value)); V.phase = ''; });
  bar.querySelector('.hab3d-raids')?.addEventListener('change', (e) => { const v = e.target.value; savePrefs(withPref(V.prefs, 'raids', v === 'off' ? { on: false } : { on: true, freq: v })); });
  noticeLine();
}
function noticeLine() { const n = V?.el?.parentElement?.querySelector('.hab3d-note'); if (n) n.textContent = V.notice || ''; }
function barAction(act, b) {
  if (act === '2d' || act === '3d') { savePrefs(withPref(V.prefs, 'mode', act)); toolbar(); apply(); if (act === '3d') preset('lodge', true); }
  else if (act === 'lighter') { savePrefs(withPref(V.prefs, 'lighter', b.checked)); V.lighter = V.prefs.lighter; resize(); quality(); }
  else if (act === 'walk') enterWalk();
  else if (act === 'study') goStudy();
  else if (act === 'chars') openCharacters();
  else if (act === 'folk') { savePrefs(withPref(V.prefs, 'folk', b.checked)); V.npcKey = ''; }
  else if (act === 'rearrange2d') { savePrefs(withPref(V.prefs, 'mode', '2d')); toolbar(); apply(); }
}

// ---------- loop ----------
function observe() {
  if (!V.io && 'IntersectionObserver' in window) { V.io = new IntersectionObserver((es) => { V.visible = es.some((e) => e.isIntersecting); if (V.visible) start(); }); }
  V.io?.disconnect(); V.io?.observe(V.gl.canvas);
  if (!V.ro && 'ResizeObserver' in window) V.ro = new ResizeObserver(() => resize());
  V.ro?.disconnect(); V.ro?.observe(V.el);
}
function start() { if (!V?.gl || V.raf || V.timer || document.hidden) return; V.last = 0; V.raf = requestAnimationFrame(frame); }
function resize() {
  if (!V?.gl || !V.el) return;
  const rect = V.el.getBoundingClientRect();
  const w = Math.max(280, V.el.clientWidth);
  const h = Math.max(380, Math.min(900, window.innerHeight - rect.top - 96));
  V.gl.renderer.setPixelRatio(pixelRatio(window.devicePixelRatio || 1, { lighter: V.lighter }));
  V.gl.renderer.setSize(w, h, true);
  V.gl.camera.aspect = w / h; V.gl.camera.updateProjectionMatrix();
}
function quality() {
  const m = motionFor({ reduced: habitatEngine()?.reduced, lighter: V.lighter });
  V.gl.sun.castShadow = m.shadows;
  V.gl.sun.shadow.mapSize.set(m.shadowMap || 512, m.shadowMap || 512);
  if (V.gl.sun.shadow.map) { V.gl.sun.shadow.map.dispose(); V.gl.sun.shadow.map = null; }
  if (V.particles) { V.particles.removeFromParent(); V.particles.geometry.dispose(); V.particles = null; V.weather = ''; }
}

function frame(ms) {
  V.raf = 0;
  const eng = habitatEngine();
  if (!eng || !V.gl?.canvas.isConnected) return;
  if (document.hidden) return;
  if (eng.rearranging) { apply(); return watchRearrange(); }
  const t = ms / 1000;
  const dt = Math.min(0.1, Math.max(0, V.last ? t - V.last : 0.016));
  V.last = t;
  const reduced = eng.reduced;
  if (V.visible) {
    sync(eng);
    update(eng, t, dt, reduced);
    V.gl.renderer.render(V.gl.scene, V.gl.camera);
    V.frames += 1;
  }
  const m = motionFor({ reduced, lighter: V.lighter });
  if (reduced && !V.walk.on) V.timer = setTimeout(() => { V.timer = 0; start(); }, 1000 / m.fps);
  else V.raf = requestAnimationFrame(frame);
}
// While he rearranges in 2D, come back to the lodge once he presses Done.
function watchRearrange() {
  clearTimeout(V.rtimer);
  V.rtimer = setTimeout(() => { const eng = habitatEngine(); if (!eng || !V.el?.isConnected) return; if (eng.rearranging) return watchRearrange(); apply(); }, 400);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && V?.gl?.canvas.isConnected) start(); });

// Rebuild the static lodge when the world or its saved look changes.
function sync(eng) {
  const world = eng.world;
  if (!world) return;
  const g = gardenState(eng.store, world.courtyard?.beds.length);
  const light = eng.light;
  const key = [sceneKey({ world, agents: eng.agents, store: eng.store, notes: eng.notes, garden: g }), JSON.stringify(V.prefs.room), JSON.stringify(V.prefs.notes)].join('|');
  if (key !== V.key || world !== V.world) {
    const first = !V.lodge;
    if (V.lodge) { V.gl.scene.remove(V.lodge.root); disposeTree(V.lodge.root, V.lodge.refs.textures); }
    V.lodge = buildLodge({ world, agents: eng.agents, store: eng.store, notes: eng.notes, prefs: V.prefs, lampsOn: Boolean(light?.lamps) });
    V.gl.scene.add(V.lodge.root);
    V.key = key; V.world = world; V.phase = '';
    for (const m of Object.values(V.lodge.refs.monitors)) m.key = null;
    // 2.4: the sun's shadows cover the part of the city around the camera's target
    const s = V.gl.sun.shadow.camera; const half = 48;
    s.left = -half; s.right = half; s.top = half; s.bottom = -half; s.near = 1; s.far = 260; s.updateProjectionMatrix();
    quality();
    if (first) preset('lodge', true);
    toolbar();
  }
  // the castle city around the keep: rebuilt when the AIs or their names change
  const ck = [world.ids.join(','), world.w, Object.values(eng.agents).map((a) => `${a.id}:${a.color}:${a.name}`).join(',')].join('#');
  if (ck !== V.castleKey) {
    if (V.castle) { V.gl.scene.remove(V.castle.root); disposeTree(V.castle.root, []); }
    V.castle = buildCastle({ world, L: layoutOf(world), agents: eng.agents, labelTex: (name, color) => labelTex([name], { w: 384, h: 128, bg: '#fff4d6', fg: '#2a2230', font: 'bold 54px system-ui, sans-serif', border: color }) });
    V.gl.scene.add(V.castle.root); V.castleKey = ck; V.npcKey = ''; V.phase = '';
  }
  // figures: one per AI in the world, kept across rebuilds, each as the character picked for it
  for (const id of world.ids) {
    const a = eng.agents[id];
    const ch = charFor(V.prefs.characters, id, world.ids);
    const k = `${id}:${a?.color}:${JSON.stringify(ch)}`;
    if (!V.figs.has(id) || V.figs.get(id).userData.key !== k) {
      if (V.figs.has(id)) V.gl.dyn.remove(V.figs.get(id));
      const f = buildFigure({ id, color: a?.color || '#888', char: ch });
      f.userData.key = k; f.userData.hitId = id;
      f.traverse((o) => { o.userData.hit = { kind: 'actor', id }; });
      V.gl.dyn.add(f); V.figs.set(id, f);
    }
  }
  for (const [id, f] of V.figs) if (!world.ids.includes(id)) { V.gl.dyn.remove(f); V.figs.delete(id); }
  if (!V.pet) { V.pet = buildPet(); V.pet.traverse((o) => { o.userData.hit = { kind: 'pet' }; }); V.gl.dyn.add(V.pet); }
  const ph = timeOfDay(V.prefs.time, light?.phase);
  if (ph !== V.phase) { V.phase = ph; rig(ph); }
  syncNpcs(eng);
}

function rig(phase) {
  const R = lightRig(phase);
  const { scene, sun, hemi, rim, fill } = V.gl;
  scene.background = new THREE.Color(R.sky);
  scene.fog.color.set(R.fog); scene.fog.near = 140; scene.fog.far = 420;
  sun.color.set(R.sun.color); sun.intensity = R.sun.intensity; sun.position.set(...R.sun.pos).multiplyScalar(1.4); sun.target.position.set(0, 0, 0);
  hemi.color.set(R.hemi.sky); hemi.groundColor.set(R.hemi.ground); hemi.intensity = R.hemi.intensity;
  rim.intensity = phase === 'night' ? 0.25 : 0.45; fill.intensity = phase === 'night' ? 0.1 : 0.18;
  V.gl.renderer.toneMappingExposure = phase === 'night' ? 1.25 : 1.05;
  if (V.castle) { V.castle.refs.windowMat.emissiveIntensity = R.windows * 1.4; for (const tq of V.castle.refs.torches) tq.visible = R.lampsOn; }
  const refs = V.lodge?.refs; if (!refs) return;
  refs.windowMat.emissiveIntensity = R.windows * 1.6;
  for (const g of refs.windowGlows) { g.visible = R.windows > 0.3; g.material.opacity = 0.5 * R.windows; }
  if (refs.kitchenLight) refs.kitchenLight.intensity = R.lampsOn ? 1.6 : 0;
  if (refs.studyLight) refs.studyLight.intensity = R.lampsOn ? 1.3 : 0.3;
  V.fireBase = R.fire;
  // stars
  if (!V.stars) {
    const pts = []; for (let i = 0; i < 400; i++) { const a = Math.random() * Math.PI * 2; const e = 0.15 + Math.random() * 1.2; pts.push(Math.cos(a) * Math.cos(e) * 150, 20 + Math.sin(e) * 120, Math.sin(a) * Math.cos(e) * 150); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    V.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#fff6dd', size: 0.6, sizeAttenuation: true, fog: false }));
    scene.add(V.stars);
  }
  V.stars.visible = R.stars;
}

// ---------- per frame ----------
const ICON_FOR_EMOTE = { happy: 'happy', thinking: 'idea', tired: 'tired', celebrate: 'happy', wave: 'wave' };
function figIcons(f) {
  if (!f.userData.icons) {
    const mk = () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false })); s.scale.set(0.36, 0.36, 1); s.renderOrder = 12; s.visible = false; f.add(s); return s; };
    f.userData.icons = { icon: mk(), star: mk(), fx: mk() };
    f.userData.icons.star.material.map = iconTex('star'); f.userData.icons.star.scale.set(0.3, 0.3, 1);
  }
  return f.userData.icons;
}
function setIcon(s, name, y) { if (!name) { s.visible = false; return; } if (s.userData.name !== name) { s.material.map = iconTex(name); s.material.needsUpdate = true; s.userData.name = name; } s.visible = true; s.position.y = y; }

function kitchenChat(eng) {
  const k = eng.world?.kitchen; if (!k) return new Set();
  const ids = [...eng.actors.values()].filter((a) => (a.goal === 'coffee' || a.goal === 'visit') && !a.path.length && a.x >= k.x0 && a.x < k.x0 + k.w && a.y >= k.y0 && a.y < k.y0 + k.h).map((a) => a.id);
  return new Set(ids.length >= 2 ? ids : []);
}

function update(eng, t, dt, reduced) {
  const world = eng.world; const refs = V.lodge.refs; const tms = now();
  const P = (x, y) => tileTo3D(world, x, y);
  const chatting = kitchenChat(eng);
  const owner = V.walk.on ? V.walk.pos : null;
  const near = owner ? new Set(noticers(owner, [...eng.actors.values()], eng.behs)) : new Set();
  // who celebrates: a stamp landed on their desk, or they emoted celebrate
  const cheering = new Set(); const fxIcon = {};
  for (const e of eng.effects) {
    if (e.kind === 'stamp') { const tx = Math.floor(pxToTile(e.x)); const ty = Math.round(pxToTile(e.y)); for (const d of world.desks) if (tx >= d.tiles[0].x && tx <= d.tiles[2].x + 1 && Math.abs(ty - d.tiles[0].y) <= 1) cheering.add(d.id); }
    if (e.kind === 'bubble' && tms >= e.t0) { fxIcon[e.who] = ICON_FOR_EMOTE[e.icon] || 'happy'; if (e.icon === 'celebrate') cheering.add(e.who); }
  }
  for (const [id, f] of V.figs) {
    const a = eng.actors.get(id); const beh = eng.behs[id];
    if (!a || !beh) { f.visible = false; continue; }
    f.visible = true;
    let wave = fxIcon[id] === 'wave';
    if (near.has(id)) { const st = V.notice3d.get(id) || { since: t, waved: false }; if (!V.notice3d.has(id)) V.notice3d.set(id, st); if (t - st.since < 1.6) wave = true; } else V.notice3d.delete(id);
    const vis = visualFor(beh, a, { mood: eng.moods[id], chat: chatting.has(id) && (reduced || Math.floor(t / 2.2) % 2 === [...chatting].indexOf(id) % 2), waving: wave, cheering: cheering.has(id) });
    let p = P(a.x, a.y);
    let rot = facingOf(a.dir); let bedZ = 0.6;
    if (vis.pose === 'sleep') { const r = roomOf(world, id); rot = r?.side === 'bottom' ? Math.PI : 0; bedZ = r?.side === 'bottom' ? -0.3 : 0.6; }
    // 2.4: crossing between an AI's house and the keep, they walk through town
    const zk = zoneKey(zoneOf(world, a.x, a.y));
    const last = V.zones.get(id);
    const defending = V.defend.has(id) && beh.mode === 'idle';
    const want = defending ? { x: V.raidSpot?.(id).x ?? p.x, y: 0, z: V.raidSpot?.(id).z ?? p.z } : p;
    const wantKey = defending ? 'gate' : zk;
    if (last && last.key !== wantKey && !reduced) {
      const from = last.pos; const fz = last.key.startsWith('house:') ? { kind: 'house', id: last.key.slice(6) } : { kind: 'keep' };
      const tz = wantKey.startsWith('house:') ? { kind: 'house', id: wantKey.slice(6) } : { kind: 'keep' };
      let pts = routeBetween(world, fz, tz, from, want);
      if (wantKey === 'gate' || last.key === 'gate') { const L = layoutOf(world); const via = [{ x: 0, z: L.keepGate.z + 1 }, { x: 0, z: L.gate.z - 6 }]; pts = [from, ...(wantKey === 'gate' ? via : [...via].reverse()), want]; }
      V.transit.set(id, { pts, d: 0, len: pathLength(pts) });
    }
    V.zones.set(id, { key: wantKey, pos: { x: want.x, z: want.z } });
    const tr = V.transit.get(id);
    if (tr && !reduced) {
      tr.d += dt * 5.5;
      if (tr.d >= tr.len) V.transit.delete(id);
      else { const q = alongPath(tr.pts, tr.d); p = { x: q.x, y: 0, z: q.z }; rot = q.yaw; vis.pose = 'walk'; vis.icon = null; }
    } else if (defending) { p = want; rot = Math.PI; vis.pose = 'stand'; vis.gesture = 'cheer'; vis.icon = null; }
    f.position.set(p.x, p.y || 0, p.z + (vis.pose === 'type' ? -0.28 : 0));
    if (reduced || vis.pose === 'sleep') f.rotation.y = rot; else f.rotation.y += angDiff(rot, f.rotation.y) * Math.min(1, dt * 10);
    if (f.userData.sword) f.userData.sword.visible = defending;
    let lookYaw = null;
    if (owner && near.has(id)) { const want = Math.atan2(owner.x - a.x, owner.y - a.y); lookYaw = angDiff(want, f.rotation.y); }
    animateFigure(f, vis, t, dt, { reduced, lookYaw, seatY: a.mode === 'desk' ? 0.3 : 0.06, bedZ });
    const ic = figIcons(f);
    const top = 0.2 + (vis.pose === 'sleep' ? 0.95 : vis.pose === 'type' || vis.pose === 'sit' ? (a.mode === 'desk' ? 1.2 : 0.95) : 1.25);
    setIcon(ic.icon, vis.icon, top);
    ic.icon.position.z = vis.pose === 'sleep' ? (bedZ - 0.9) : 0;
    setIcon(ic.star, vis.star ? 'star' : null, top + (vis.icon ? 0.36 : 0.02));
    setIcon(ic.fx, fxIcon[id] && fxIcon[id] !== 'wave' ? fxIcon[id] : null, top + 0.3);
    ic.fx.position.x = 0.32;
  }
  // pet
  if (eng.pet && V.pet) {
    const p = P(eng.pet.x, eng.pet.y);
    V.pet.position.set(p.x, 0, p.z);
    const r = facingOf(eng.pet.dir); V.pet.rotation.y = reduced ? r : V.pet.rotation.y + angDiff(r, V.pet.rotation.y) * Math.min(1, dt * 8);
    animatePet(V.pet, eng.pet.pose, t, dt, { reduced });
  }
  // doors: closed when the room is locked; they open for the owner as he walks up
  for (const r of world.rooms) {
    const d = refs.doors[r.id]; if (!d) continue;
    const locked = doorClosed(eng.behs[r.id]);
    const ownerNear = owner && Math.hypot(owner.x - r.door.x, owner.y - r.door.y) < 1.4;
    const target = locked && !ownerNear ? 0 : -d.facing * 1.75;
    d.pivot.rotation.y = reduced ? target : d.pivot.rotation.y + (target - d.pivot.rotation.y) * Math.min(1, dt * 6);
    d.lock.visible = locked;
  }
  if (refs.studyDoor) { const open = owner && Math.hypot(owner.x - STUDY_DOOR.x, owner.y - STUDY_DOOR.y) < 1.5; const tg = open ? -1.7 : 0; refs.studyDoor.pivot.rotation.y = reduced ? tg : refs.studyDoor.pivot.rotation.y + (tg - refs.studyDoor.pivot.rotation.y) * Math.min(1, dt * 6); }
  // monitors and desk lights
  for (const d of world.desks) {
    const m = refs.monitors[d.id]; const beh = eng.behs[d.id];
    const key = beh?.monitor ? `${beh.monitor.kind}:${beh.monitor.id}` : '';
    if (m && m.key !== key) { m.mesh.material.map?.dispose(); const tx = screenTex(beh?.monitor?.id, beh?.monitor?.kind); m.mesh.material.map = tx; m.mesh.material.emissiveMap = tx; m.mesh.material.needsUpdate = true; m.key = key; }
    const dl = refs.deskLights[d.id]; const st = eng.lights[d.id] || null;
    if (dl && dl.state !== st) { const c = { green: '#5ef08a', amber: '#ffb347', red: '#ff5a4a' }[st]; dl.mesh.material = new THREE.MeshStandardMaterial({ color: c || '#555555', emissive: c || '#000000', emissiveIntensity: c ? 1.8 : 0 }); dl.glow.visible = Boolean(c); if (c) dl.glow.material.color.set(c); dl.state = st; }
  }
  // lamps follow the clock and HABITAT: lamp on/off
  for (const l of refs.lamps) {
    const lit = l.id && l.id !== 'owner' ? lampLit(eng.store, l.id, eng.light) : Boolean(eng.light?.lamps);
    if (l.halo) l.halo.visible = lit; if (l.pool) l.pool.visible = lit;
    l.shade.material.emissiveIntensity = lit ? 1.4 : 0.05;
  }
  // fire
  if (refs.fire) {
    const base = V.fireBase ?? 1.6;
    for (const fl of refs.fire.flames) { const b = fl.userData.base; const k = reduced ? 1 : 0.8 + Math.sin(t * 9 + b.ph) * 0.15 + Math.sin(t * 23 + b.ph * 2) * 0.08; fl.scale.set(b.s, b.s * k * 1.1, b.s); fl.position.y = b.y + (k - 1) * 0.08; }
    refs.fire.light.intensity = base * (reduced ? 1 : 0.9 + Math.sin(t * 7) * 0.06 + Math.sin(t * 17) * 0.04);
    refs.fire.glow.material.opacity = 0.65 + (reduced ? 0 : Math.sin(t * 11) * 0.08);
  }
  // the owner's screens: a live Overview, refreshed every few seconds
  if (tms - V.lastScreen > 3000 || !V.screenTex) { V.lastScreen = tms; overviewScreen(eng, refs); }
  effects(eng, t, reduced);
  weather(eng, dt);
  if (V.walk.on) walkStep(eng, t, dt, reduced); else orbitStep(dt, reduced);
  updateNpcs(eng, t, dt, reduced);
  updateRaid(eng, t, dt, reduced);
  roofs();
  // the roof's back slope fades out as you zoom in
  if (refs.roof) { const d = V.walk.on ? 0 : V.cam.dist; const o = Math.max(0, Math.min(0.45, (d - 30) / 25)); refs.roof.mat.opacity = o; refs.roof.mesh.visible = o > 0.02; refs.roof.ridge.visible = o > 0.02; }
}
// ---------- 2.4: townsfolk, guards and raids ----------
// Raids are on unless he turned them off; in Lighter 3D or reduced motion only when he turned them on.
function raidsOn() { const r = normRaids(V.prefs.raids, { lighter: V.lighter, reduced: Boolean(habitatEngine()?.reduced) }); return r.explicit ? r.on : !(V.prefs.lighter || habitatEngine()?.reduced); }
function syncNpcs(eng) {
  const m = motionFor({ reduced: eng.reduced, lighter: V.lighter });
  const key = [V.castleKey, V.prefs.folk, V.lighter].join('|');
  if (key === V.npcKey || !V.castle) return;
  for (const n of V.npcs) n.obj.removeFromParent();
  V.npcs = [];
  V.npcKey = key;
  if (!V.npcGroup) { V.npcGroup = new THREE.Group(); V.gl.scene.add(V.npcGroup); }
  const L = layoutOf(eng.world);
  for (const f of townsfolk(L, V.castle.houses, folkCount({ on: V.prefs.folk, lighter: V.lighter }))) {
    const obj = buildNpc(f.look, { kind: f.cat ? 'cat' : 'folk', small: f.small }); V.npcGroup.add(obj);
    if (f.kind === 'merchant') setGear(obj, null);
    if (f.kind === 'farmer') setGear(obj, 'spear');
    V.npcs.push({ kind: 'folk', f, obj });
  }
  guards(L, guardCount({ on: V.prefs.folk, lighter: V.lighter })).forEach((g) => {
    const obj = buildNpc({ hair: 'soft', hairColor: '#3a2a22', eyes: '#4a7bd1', skin: '#ffe2cf', outfit: 'knight', accessory: 'none' }, { kind: 'guard' }); V.npcGroup.add(obj);
    setGear(obj, g.wall ? (g.i % 2 ? 'bow' : 'spear') : 'spear');
    V.npcs.push({ kind: 'guard', g, obj });
  });
  void m;
}
function updateNpcs(eng, t, dt, reduced) {
  const still = reduced; const phase = V.phase || 'day';
  const s = V.raid ? (performance.now() - V.raid.t0) / 1000 : -1;
  let gi = 0;
  for (const n of V.npcs) {
    if (n.kind === 'folk') {
      // during a raid the market empties near the gate: folk stay where they are but keep clear of the road
      const p = folkAt(n.f, t, phase, { still });
      n.obj.visible = p.visible; if (!p.visible) continue;
      n.obj.position.set(p.x, 0, p.z); n.obj.rotation.y = p.yaw;
      animateNpc(n.obj, { moving: p.moving, t, reduced });
    } else {
      const p = guardAt(n.g, t, phase, { still });
      const fighting = V.raid && s >= 16 && s < RAID_LEN - 8;
      const dazed = V.raid && !n.g.wall && guardDazed(V.raid.plan, s, gi);
      let x = p.x; let z = p.z;
      if (fighting && !n.g.wall) { const L = layoutOf(eng.world); x = L.gate.x + (gi % 4 - 1.5) * 2.2; z = L.gate.z + 3.2; }
      n.obj.position.set(x, n.g.wall ? WALL_TOP + 0.35 : 0, z);
      n.obj.rotation.y = fighting ? 0 : p.yaw;
      setGear(n.obj, p.torch && !fighting ? 'torch' : n.g.wall ? (n.g.i % 2 ? 'bow' : 'spear') : (gi % 2 ? 'sword' : 'spear'));
      animateNpc(n.obj, { moving: p.moving && !fighting, t, dazed, attack: fighting && !dazed && !n.g.wall, reduced });
      if (!n.g.wall) gi += 1;
    }
  }
}
function startRaid(t0Ms, eng) {
  const L = layoutOf(eng.world);
  const defenders = eng.world.ids.filter((id) => eng.behs[id]?.mode === 'idle' && !eng.agents[id]?.task && !eng.agents[id]?.reviewing);
  const plan = planRaid(Math.floor(t0Ms / 1000), L, defenders);
  V.raid = { t0: performance.now() - Math.max(0, Date.now() - t0Ms), plan, objs: [], arrows: [], credited: false, startMs: t0Ms };
  V.defend = new Set(plan.defenders);
  V.raidSpot = (id) => { const i = plan.defenders.indexOf(id); return { x: L.gate.x + (i - 1) * 2.4, z: L.gate.z + 1.6 }; };
  if (!V.raidGroup) { V.raidGroup = new THREE.Group(); V.gl.scene.add(V.raidGroup); }
  for (const x of plan.raiders) {
    const obj = buildNpc(x.look, { kind: 'raider' }); setGear(obj, 'club');
    const bar = healthBar(); bar.position.y = 2.05; obj.add(bar);
    const stars = dizzyStars(); stars.position.y = 1.95; stars.visible = false; obj.add(stars);
    const pf = poof(); pf.visible = false; obj.add(pf); pf.position.y = 0.8;
    V.raidGroup.add(obj); V.raid.objs.push({ obj, bar, stars, pf });
  }
  for (let k = 0; k < 3; k++) { const a = arrow(k === 1); a.visible = false; V.raidGroup.add(a); V.raid.arrows.push(a); }
  for (const id of plan.defenders) { const f = V.figs.get(id); if (f && !f.userData.sword) { const sw = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.42, 0.02), new THREE.MeshToonMaterial({ color: '#dfe6f2' })); sw.position.set(0, -0.3, 0.05); f.userData.fig.arms[1].elbow.add(sw); f.userData.sword = sw; } }
  toast('Raiders at the gate!', 'Watch', () => preset('gate'));
}
function endRaid(eng) {
  if (V.raid && !V.raid.credited) { V.raid.credited = true; const c = Object.fromEntries(Object.entries(V.raid.plan.credit).filter(([id]) => V.defend.has(id))); if (Object.keys(c).length) eng.addRaidWins?.(c); }
  V.raid?.objs.forEach((o) => o.obj.removeFromParent()); V.raid?.arrows.forEach((a) => a.removeFromParent());
  V.raid = null; V.defend = new Set();
}
function updateRaid(eng, t, dt, reduced) {
  // a new raid from the schedule (seeded per day), unless one is already on
  if (!V.raid && raidsOn() && !V.walk.on) {
    const now = eng.clock?.().getTime?.() ?? Date.now(); const d = new Date(now); d.setHours(0, 0, 0, 0);
    const st = raidAt(now, d.getTime(), normRaids(V.prefs.raids).freq);
    if (st && st !== V.raidSeen) { V.raidSeen = st; startRaid(st, eng); }
  }
  if (!V.raid) return;
  const s = (performance.now() - V.raid.t0) / 1000;
  const st = raidState(V.raid.plan, s);
  // work is never interrupted: an AI that starts a task leaves the gate at once
  for (const id of [...V.defend]) if (eng.behs[id]?.mode !== 'idle') V.defend.delete(id);
  st.raiders.forEach((x, i) => {
    const o = V.raid.objs[i]; o.obj.visible = x.visible; if (!x.visible) return;
    o.obj.position.set(x.x, 0, x.z); o.obj.rotation.y = x.mode === 'flee' ? 0 : Math.PI;
    animateNpc(o.obj, { moving: x.mode === 'march' || x.mode === 'flee', t, flash: x.flash, dizzy: x.mode === 'dizzy', attack: x.mode === 'fight', reduced });
    setHealth(o.bar, x.hp, V.gl.camera);
    o.stars.visible = x.mode === 'dizzy' || x.mode === 'flee'; if (o.stars.visible) spinStars(o.stars, t);
    o.pf.visible = x.mode === 'poof'; if (o.pf.visible) { const k = Math.min(1, (s - V.raid.plan.raiders[i].beaten - 2.2) / 0.8); o.pf.scale.setScalar(0.5 + k * 1.6); o.pf.material.opacity = 0.8 * (1 - k); o.obj.userData.npc.body.visible = k < 0.3; }
  });
  st.arrows.forEach((a, k) => { const m = V.raid.arrows[k]; if (!m) return; m.visible = !reduced; const p = arcAt(a.from, a.to, a.k); const q = arcAt(a.from, a.to, Math.min(1, a.k + 0.02)); m.position.set(p.x, p.y, p.z); m.lookAt(q.x, q.y, q.z); });
  for (let k = st.arrows.length; k < V.raid.arrows.length; k++) V.raid.arrows[k].visible = false;
  if (st.done) endRaid(eng);
}
// House roofs and the keep tower's roof lift off when the camera comes in close.
function roofs() {
  if (!V.castle || V.walk.on) { if (V.castle && V.walk.on) { for (const r of Object.values(V.castle.refs.houseRoofs)) r.visible = false; if (V.castle.refs.towerRoof) V.castle.refs.towerRoof.visible = false; } return; }
  const c = V.cam; const near = (x, z, r) => c.dist < 24 && Math.hypot(c.target.x - x, c.target.z - z) < r;
  const L = layoutOf(habitatEngine().world);
  for (const [id, r] of Object.entries(V.castle.refs.houseRoofs)) { const H = L.houses[id]; r.visible = !(H && near(H.x, H.z, 9)); }
  if (V.castle.refs.towerRoof) V.castle.refs.towerRoof.visible = !near(L.tower.x, L.tower.z, 9);
}
function toast(text, act, onAct) {
  const n = node('toast'); if (n.parentElement !== V.el) V.el.appendChild(n);
  n.innerHTML = `<b>${esc(text)}</b>${act ? ` <button class="btn small primary" data-h3t="go">${esc(act)}</button>` : ''} <button class="btn small" data-h3t="x" aria-label="Close">×</button>`;
  n.hidden = false; n.setAttribute('role', 'status');
  n.querySelector('[data-h3t="go"]')?.addEventListener('click', () => { onAct?.(); n.hidden = true; });
  n.querySelector('[data-h3t="x"]')?.addEventListener('click', () => { n.hidden = true; });
  clearTimeout(V.toastT); V.toastT = setTimeout(() => { n.hidden = true; }, 12000);
}
// The Characters page: the 12 ready-made originals, who plays whom, and the creator.
function openCharacters(state = {}) {
  const eng = habitatEngine(); if (!eng?.world) return;
  const n = node('chars'); if (n.parentElement !== V.el) V.el.appendChild(n);
  const people = [['owner', 'You (the King’s Chambers)'], ...eng.world.ids.map((id) => [id, eng.agents[id]?.name || id])];
  const chars = Object.fromEntries(people.map(([id]) => [id, charFor(V.prefs.characters, id, eng.world.ids)]));
  n.innerHTML = charactersPanel({ people, chars, raids: eng.store?.raids || {}, state });
  n.hidden = false;
  bindCharacters(n, { people, chars, state, save: (who, spec) => { savePrefs(withPref(V.prefs, 'character', { who, spec })); }, close: () => { n.hidden = true; }, rerender: (st) => openCharacters(st) });
}

const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

function overviewScreen(eng, refs) {
  const tasks = eng.tasks || [];
  const working = Object.values(eng.agents).filter((a) => a.task).map((a) => a.name);
  const review = tasks.filter((x) => x.stage === 'review').length;
  const wait = tasks.filter((x) => x.stage === 'approval').length;
  const lines = ['Overview', working.length ? `Working: ${working.slice(0, 3).join(', ')}` : 'Nobody is working right now', `In review ${review} · Waiting for you ${wait}`, `Finished ${eng.store?.finished || 0} · Garden ${gardenState(eng.store).stages.filter((s) => s >= 3).length} in bloom`];
  const tx = labelTex(lines, { w: 512, h: 288, bg: '#211611', fg: '#ffd9a8', font: 'bold 30px system-ui, sans-serif', align: 'left' });
  V.screenTex?.dispose(); V.screenTex = tx;
  for (const m of [refs.wallScreen, ...(refs.ownerScreens || [])].filter(Boolean)) { m.material.map = tx; m.material.emissiveMap = tx; m.material.needsUpdate = true; }
}

// Papers, stamps, flying hand-overs, hearts and water from the shared effect list.
function effects(eng, t, reduced) {
  const world = eng.world; const tms = now(); const live = new Set();
  const P = (x, y) => tileTo3D(world, x, y);
  for (const e of eng.effects) {
    if (tms < e.t0) continue;
    live.add(e);
    let o = V.fxMap.get(e);
    if (!o) {
      if (e.kind === 'paper' || e.kind === 'fly') o = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.01, 0.28), new THREE.MeshStandardMaterial({ color: '#fbf6e9', roughness: 0.9 }));
      else if (e.kind === 'stamp') { o = new THREE.Group(); o.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.01, 0.28), new THREE.MeshStandardMaterial({ color: '#fbf6e9' }))); const st = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.012, 20), new THREE.MeshStandardMaterial({ color: '#d0402f', emissive: '#7a1a10', emissiveIntensity: 0.4 })); st.position.y = 0.01; o.add(st); o.userData.st = st; }
      else if (e.kind === 'heart' || e.kind === 'water') { o = new THREE.Sprite(new THREE.SpriteMaterial({ map: e.kind === 'heart' ? iconTex('heart') : glowTex('rgba(140,200,255,1)'), transparent: true, depthWrite: false })); o.scale.set(0.45, 0.45, 1); }
      else continue;
      V.gl.fx.add(o); V.fxMap.set(e, o);
    }
    const k = Math.min(1, (tms - e.t0) / (e.ttl * 1000));
    if (e.kind === 'paper') { const p = P(pxToTile(e.x), pxToTile(e.y)); o.position.set(p.x, 0.56, p.z + 0.1); }
    if (e.kind === 'stamp') { const p = P(pxToTile(e.x), pxToTile(e.y)); o.position.set(p.x, 0.56, p.z + 0.1); const s = e.anim && !reduced ? Math.max(1, 3 - k * 6) : 1; o.userData.st.scale.set(s, 1, s); o.userData.st.position.y = e.anim && !reduced ? Math.max(0.01, 0.4 - k * 1.2) : 0.01; }
    if (e.kind === 'fly') { const a = P(pxToTile(e.from.x), pxToTile(e.from.y)); const b = P(pxToTile(e.to.x), pxToTile(e.to.y)); const q = e.anim && !reduced ? k : 1; o.position.set(a.x + (b.x - a.x) * q, 0.6 + Math.sin(q * Math.PI) * 1.2, a.z + (b.z - a.z) * q); o.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); o.rotation.z = reduced ? 0 : Math.sin(t * 6) * 0.2; }
    if (e.kind === 'heart') { const pp = V.pet?.position || new THREE.Vector3(); o.position.set(pp.x, 0.6 + (reduced ? 0 : k * 0.8), pp.z); o.material.opacity = 1 - k * 0.6; }
    if (e.kind === 'water') { const c = world.courtyard; const p = P(c.x0 + 5, c.y0 + 1.5); o.position.set(p.x + (reduced ? 0 : Math.sin(t * 5) * 0.8), 0.9 - (reduced ? 0 : (t * 1.3) % 0.7), p.z); o.scale.set(1.2, 1.2, 1); }
  }
  for (const [e, o] of V.fxMap) if (!live.has(e)) { o.removeFromParent(); o.traverse((x) => { x.geometry?.dispose(); if (x.material && !x.isSprite) x.material.dispose(); else x.material?.dispose(); }); V.fxMap.delete(e); }
}

function weather(eng, dt) {
  const m = motionFor({ reduced: eng.reduced, lighter: V.lighter });
  const kind = m.particles ? eng.weather : 'clear';
  if (kind !== V.weather) {
    if (V.particles) { V.particles.removeFromParent(); V.particles.geometry.dispose(); V.particles.material.dispose(); V.particles = null; }
    V.weather = kind;
    if (kind === 'snow' || kind === 'rain') {
      const b0 = lodgeBounds(eng.world); const tg = V.cam.target; const b = { minX: tg.x - 40, maxX: tg.x + 40, minZ: tg.z - 40, maxZ: tg.z + 40 }; void b0; const n = m.particles; const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = b.minX - 8 + Math.random() * (b.maxX - b.minX + 16); pos[i * 3 + 1] = Math.random() * 12; pos[i * 3 + 2] = b.minZ - 6 + Math.random() * (b.maxZ - b.minZ + 14); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      V.particles = new THREE.Points(g, new THREE.PointsMaterial({ color: kind === 'snow' ? '#ffffff' : '#a9c8ff', size: kind === 'snow' ? 0.12 : 0.06, transparent: true, opacity: kind === 'snow' ? 0.95 : 0.6, depthWrite: false }));
      V.gl.scene.add(V.particles);
    }
  }
  if (!V.particles) return;
  const a = V.particles.geometry.attributes.position; const sp = V.weather === 'snow' ? 0.9 : 9;
  for (let i = 0; i < a.count; i++) {
    let y = a.getY(i) - sp * dt;
    if (y < 0) y += 12;
    a.setY(i, y);
    if (V.weather === 'snow') a.setX(i, a.getX(i) + Math.sin(y * 1.3 + i) * dt * 0.3);
  }
  a.needsUpdate = true;
}

// ---------- orbit camera ----------
function preset(id, instant = false) {
  const eng = habitatEngine(); if (!eng?.world) return;
  const names = Object.fromEntries(Object.entries(eng.agents).map(([k, a]) => [k, a.name]));
  const p = presets(eng.world, names).find((x) => x.id === id) || presets(eng.world, names)[0];
  V.goal = { target: new THREE.Vector3(p.target.x, (p.target.y || 0) + 0.4, p.target.z), dist: p.dist, theta: p.theta, phi: p.phi };
  if (instant || eng.reduced) { V.cam = { target: V.goal.target.clone(), dist: V.goal.dist, theta: V.goal.theta, phi: V.goal.phi }; }
}
function focusOn(x, z, dist = 4.5) {
  V.goal = { target: new THREE.Vector3(x, 0.5, z), dist, theta: V.cam.theta, phi: Math.min(V.cam.phi, 0.95) };
  if (habitatEngine()?.reduced) V.cam = { ...V.goal, target: V.goal.target.clone() };
}
function goStudy() {
  if (!V.gl) { savePrefs(withPref(V.prefs, 'mode', '3d')); toolbar(); apply(); }
  const eng = habitatEngine(); if (!eng?.world) return;
  const c = tileTo3D(eng.world, STUDY.x0 + 2.5, STUDY.y0 + 1.5);
  V.goal = { target: new THREE.Vector3(c.x, (c.y || 0) + 0.4, c.z), dist: 8, theta: -0.4, phi: 0.82 };
  if (eng.reduced) V.cam = { ...V.goal, target: V.goal.target.clone() };
  openPanel();
}
function orbitStep(dt, reduced) {
  // controller in orbit mode: left stick turns, right stick zooms and pans
  const pad = navigator.getGamepads?.().find((g) => g && g.connected);
  if (pad && document.activeElement === V.gl.canvas) {
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    const g = V.goal || (V.goal = { ...V.cam, target: V.cam.target.clone() });
    g.theta -= dz(pad.axes[0] || 0) * dt * 1.6; g.phi = Math.max(0.25, Math.min(1.35, g.phi + dz(pad.axes[1] || 0) * dt));
    g.dist = Math.max(3, Math.min(260, g.dist * (1 + dz(pad.axes[3] || 0) * dt * 1.5)));
    panBy(dz(pad.axes[2] || 0) * dt * 8, 0, g);
  }
  if (V.goal) {
    const k = reduced ? 1 : Math.min(1, dt * 5);
    V.cam.target.lerp(V.goal.target, k); V.cam.dist += (V.goal.dist - V.cam.dist) * k;
    V.cam.theta += angDiff(V.goal.theta, V.cam.theta) * k; V.cam.phi += (V.goal.phi - V.cam.phi) * k;
  }
  const c = V.cam; const cam = V.gl.camera;
  if (V.gl.sun) { const R = lightRig(V.phase || 'day'); V.gl.sun.target.position.set(c.target.x, 0, c.target.z); V.gl.sun.position.set(c.target.x + R.sun.pos[0] * 2.2, R.sun.pos[1] * 2.2, c.target.z + R.sun.pos[2] * 2.2); }
  cam.position.set(c.target.x + c.dist * Math.sin(c.phi) * Math.sin(c.theta), c.target.y + c.dist * Math.cos(c.phi), c.target.z + c.dist * Math.sin(c.phi) * Math.cos(c.theta));
  cam.lookAt(c.target);
}
function panBy(dx, dy, g = V.goal || (V.goal = { ...V.cam, target: V.cam.target.clone() })) {
  const th = g.theta; const s = g.dist * 0.0018 * 60;
  const right = new THREE.Vector3(Math.cos(th), 0, -Math.sin(th)); const fwd = new THREE.Vector3(-Math.sin(th), 0, -Math.cos(th));
  g.target.addScaledVector(right, dx * s * 0.05).addScaledVector(fwd, dy * s * 0.05);
  const b = cityBounds(habitatEngine().world);
  g.target.x = Math.max(b.minX, Math.min(b.maxX, g.target.x)); g.target.z = Math.max(b.minZ, Math.min(b.maxZ, g.target.z));
}

// ---------- pointer ----------
function bindPointer() {
  const c = V.gl.canvas;
  const pts = new Map(); let drag = null; let moved = 0;
  c.addEventListener('contextmenu', (e) => e.preventDefault());
  c.addEventListener('pointerdown', (e) => {
    c.focus({ preventScroll: true });
    if (V.walk.on && V.prefs.walkView === 'first' && e.pointerType === 'mouse' && document.pointerLockElement !== c) { try { c.requestPointerLock(); } catch { /* not allowed */ } }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = { button: e.button, shift: e.shiftKey, x: e.clientX, y: e.clientY }; moved = 0;
    c.setPointerCapture?.(e.pointerId);
  });
  c.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) { hover(e); return; }
    const dx = e.clientX - p.x; const dy = e.clientY - p.y; moved += Math.abs(dx) + Math.abs(dy);
    if (V.walk.on) {
      if (document.pointerLockElement !== c && (e.pointerType !== 'touch' || e.clientX > c.getBoundingClientRect().left + c.clientWidth * 0.4)) { V.walk.yaw -= dx * 0.005; V.walk.pitch = Math.max(-1.1, Math.min(0.6, V.walk.pitch - dy * 0.004)); }
    } else {
      const g = V.goal || (V.goal = { ...V.cam, target: V.cam.target.clone() });
      if (pts.size >= 2) {
        const others = [...pts.entries()].filter(([k]) => k !== e.pointerId).map(([, v]) => v)[0];
        const d0 = Math.hypot(p.x - others.x, p.y - others.y); const d1 = Math.hypot(e.clientX - others.x, e.clientY - others.y);
        if (d0 > 0) g.dist = Math.max(3, Math.min(260, g.dist * (d0 / d1)));
        panBy(-dx / 2, -dy / 2, g);
      } else if (drag && (drag.button === 2 || drag.button === 1 || drag.shift)) panBy(-dx, -dy, g);
      else { g.theta -= dx * 0.006; g.phi = Math.max(0.25, Math.min(1.38, g.phi - dy * 0.005)); }
      if (habitatEngine()?.reduced) V.cam = { ...g, target: g.target.clone() };
    }
    p.x = e.clientX; p.y = e.clientY;
  });
  const up = (e) => {
    const was = pts.has(e.pointerId); pts.delete(e.pointerId);
    if (was && moved < 6 && e.type === 'pointerup' && !V.walk.on) click(e);
    if (!pts.size) drag = null;
  };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  c.addEventListener('pointerleave', () => { const tip = V.el?.querySelector('.hab-tip'); if (tip) tip.hidden = true; });
  c.addEventListener('wheel', (e) => { if (V.walk.on) return; e.preventDefault(); const g = V.goal || (V.goal = { ...V.cam, target: V.cam.target.clone() }); g.dist = Math.max(3, Math.min(260, g.dist * (e.deltaY > 0 ? 1.12 : 0.89))); if (habitatEngine()?.reduced) V.cam = { ...g, target: g.target.clone() }; }, { passive: false });
  c.addEventListener('dblclick', (e) => { if (V.walk.on) return; const h = pickAt(e); if (!h) return; const o = h.point; focusOn(o.x, o.z, h.hit.kind === 'actor' ? 3.2 : 4.5); });
  c.addEventListener('mousemove', (e) => { if (V.walk.on && document.pointerLockElement === c) { V.walk.yaw -= e.movementX * 0.0025; V.walk.pitch = Math.max(-1.1, Math.min(0.6, V.walk.pitch - e.movementY * 0.0022)); } });
  if (winBound) return; // window listeners once, however often the renderer is recreated
  winBound = true;
  window.addEventListener('keydown', (e) => {
    if (!V?.walk.on || !V.gl?.canvas.isConnected) return;
    if (e.target.closest?.('input, textarea, select')) return;
    if (KEYS[e.code]) { V.keys.add(e.code); V.tapped.add(e.code); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { V?.keys.delete(e.code); });
  window.addEventListener('blur', () => V?.keys.clear());
}
const ray = new THREE.Raycaster();
function pickAt(e) {
  const c = V.gl.canvas; const r = c.getBoundingClientRect();
  const m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(m, V.gl.camera);
  const objs = [...V.figs.values(), V.pet, ...(V.lodge?.refs.picks || [])].filter(Boolean);
  const hits = ray.intersectObjects(objs, true);
  for (const h of hits) { let o = h.object; while (o && !o.userData.hit) o = o.parent; if (o?.userData.hit && o.visible !== false) return { hit: o.userData.hit, point: h.point }; }
  return null;
}
const TIP_3D = {
  couch: () => '<b>Fireside nook</b><div>Benches by the stone fireplace. In “Walk the lodge” you can sit here.</div>',
  coffee: () => '<b>Coffee machine</b><div>Idle AIs fetch a coffee here; so can you when you walk the lodge.</div>',
  study: () => '<b>Your study</b><div>Only you can go in. Click to decorate it.</div>',
  studydoor: () => '<b>Your study</b><div>The door with the flame. Locked for everyone but you.</div>',
  ownernote: (h) => `<b>Your note</b><div>${esc(h.text)}</div>`,
  board: () => '<b>Message board</b><div>Notes from the AIs and you. Walk up to it and press E to pin one.</div>',
};
const BOTH = new Set(['actor', 'pet', 'note', 'shelf', 'garden', 'kitchen', 'desk', 'room', 'door']);
function hover(e) {
  if (V.walk.on) return;
  const tip = V.el?.querySelector('.hab-tip'); if (!tip) return;
  const h = pickAt(e); const eng = habitatEngine();
  const html = !h ? '' : BOTH.has(h.hit.kind) ? eng.tip(h.hit) : TIP_3D[h.hit.kind]?.(h.hit) || '';
  V.gl.canvas.style.cursor = html ? 'pointer' : 'grab';
  if (!html) { tip.hidden = true; return; }
  tip.innerHTML = html; tip.hidden = false;
  const host = V.el.getBoundingClientRect();
  tip.style.left = `${Math.max(4, Math.min(e.clientX - host.left + 14, host.width - tip.offsetWidth - 4))}px`;
  tip.style.top = `${e.clientY - host.top + 14}px`;
}
function click(e) {
  const h = pickAt(e); if (!h) return;
  const eng = habitatEngine();
  if (BOTH.has(h.hit.kind)) return eng.click(h.hit);
  if (h.hit.kind === 'study' || h.hit.kind === 'studydoor') return goStudy();
}

// ---------- walk the lodge ----------
function enterWalk() {
  const eng = habitatEngine(); if (!eng?.world || !V.gl) return;
  const w = V.walk; w.on = true; w.sit = null; w.camPos = null;
  const k = eng.world.kitchen;
  // 2.4: he starts in the King's Chambers, at the top of the keep
  if (!w.placed || !ownerFree(eng.world, V.prefs.room)(Math.round(w.pos.x), Math.round(w.pos.y))) { const fr = ownerFree(eng.world, V.prefs.room); const start = [[-3, 6], [-4, 6], [-2, 7], [-1, 7]].find(([x, y]) => fr(x, y)) || [-1, 7]; w.pos = { x: start[0], y: start[1] }; w.yaw = 0; w.placed = true; }
  void k;
  const och = charFor(V.prefs.characters, 'owner');
  if (!V.avatar || V.avatar.userData.key !== JSON.stringify(och)) {
    if (V.avatar) V.gl.dyn.remove(V.avatar);
    V.avatar = buildFigure({ id: 'owner', owner: true, char: och });
    V.avatar.userData.key = JSON.stringify(och);
    V.gl.dyn.add(V.avatar);
  }
  V.avatar.visible = true;
  V.gl.canvas.focus({ preventScroll: true });
  hud(); stick();
}
function exitWalk() {
  const w = V.walk; w.on = false; V.keys.clear();
  if (document.pointerLockElement === V.gl?.canvas) document.exitPointerLock?.();
  if (V.avatar) V.avatar.visible = false;
  for (const n of ['hud', 'bubble', 'stick']) if (V.nodes?.[n]) V.nodes[n].hidden = true;
  V.goal = { target: new THREE.Vector3(V.gl ? V.gl.camera.position.x : 0, 0.4, V.gl ? V.gl.camera.position.z - 6 : 0), dist: 14, theta: V.cam.theta, phi: 0.9 };
}
function setWalkView(view) {
  savePrefs(withPref(V.prefs, 'walkView', view));
  if (view === 'first' && V.gl.canvas.requestPointerLock && matchMedia('(pointer: fine)').matches) { try { V.gl.canvas.requestPointerLock(); } catch { /* not allowed here */ } }
  else if (document.pointerLockElement) document.exitPointerLock();
  hud();
}
function hud(prompt = '') {
  const d = node('hud'); d.hidden = !V.walk.on;
  const fp = V.prefs.walkView === 'first';
  const key = `${fp}|${prompt}`;
  if (d.dataset.key === key) return;
  d.dataset.key = key;
  d.innerHTML = `<div class="hab3d-hud-row"><b>Walking the lodge</b><button class="btn small" data-w="view">${fp ? 'Third person' : 'First person'} (V)</button><button class="btn small" data-w="look">Your look…</button><button class="btn small" data-w="exit">Exit (Esc)</button></div>
    <div class="faint">WASD or arrows to move · Shift runs · ${fp ? 'click to look with the mouse' : 'drag to look'} · E interacts · controller: sticks, A, B, Y</div>${prompt ? `<div class="hab3d-prompt">E · ${esc(prompt)}</div>` : ''}`;
  d.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.w === 'exit') exitWalk();
    if (b.dataset.w === 'view') setWalkView(fp ? 'third' : 'first');
    if (b.dataset.w === 'look') lookPanel();
  }));
}
function stick() {
  const d = node('stick');
  d.hidden = !(V.walk.on && matchMedia('(pointer: coarse)').matches);
  if (d.dataset.bound) return;
  d.dataset.bound = '1';
  d.innerHTML = '<div class="hab3d-knob"></div>';
  const knob = d.firstChild; let id = null; let c0 = null;
  d.addEventListener('pointerdown', (e) => { id = e.pointerId; const r = d.getBoundingClientRect(); c0 = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; d.setPointerCapture(e.pointerId); });
  d.addEventListener('pointermove', (e) => { if (e.pointerId !== id) return; const dx = Math.max(-40, Math.min(40, e.clientX - c0.x)); const dy = Math.max(-40, Math.min(40, e.clientY - c0.y)); knob.style.transform = `translate(${dx}px,${dy}px)`; V.touch.move = { x: dx / 40, y: dy / 40 }; });
  const end = () => { id = null; knob.style.transform = ''; V.touch.move = null; };
  d.addEventListener('pointerup', end); d.addEventListener('pointercancel', end);
}
function walkTargets(eng) {
  const w = eng.world; const out = [];
  for (const a of eng.actors.values()) out.push({ kind: 'actor', id: a.id, x: a.x, y: a.y, label: `Talk to ${eng.agents[a.id]?.name || a.id}` });
  for (const d of w.desks) out.push({ kind: 'desk', id: d.id, x: d.seat.x, y: d.seat.y - 0.4, label: `${eng.agents[d.id]?.name || d.id}’s desk: the task card` });
  if (w.hall) out.push({ kind: 'board', x: w.hall.board.x + 1.5, y: w.hall.board.y + 2, label: 'Read the board or pin a note' });
  if (eng.pet) out.push({ kind: 'pet', x: eng.pet.x, y: eng.pet.y, label: `Pet ${eng.store?.pet?.name || 'the ember-fox'}` });
  out.push({ kind: 'couch', x: NOOK.x0 + 0.5, y: NOOK.y0 + 1, label: 'Sit by the fire' });
  if (w.kitchen) out.push({ kind: 'coffee', x: w.kitchen.coffeeSpot.x, y: w.kitchen.coffeeSpot.y, label: 'Get a coffee' });
  if (w.courtyard) out.push({ kind: 'garden', x: w.courtyard.x0 + 2, y: w.courtyard.y0 + 2, label: 'Water the garden (just for fun)' });
  out.push({ kind: 'study', x: STUDY.x0 + 3, y: STUDY.y0 + 1.5, label: 'Decorate the King’s Chambers' });
  return out;
}
function walkStep(eng, t, dt, reduced) {
  const w = V.walk; const world = eng.world;
  const pad = navigator.getGamepads?.().find((g) => g && g.connected) || null;
  // taps shorter than a frame still count (slow machines, quick presses)
  const inp = inputFrom(new Set([...V.keys, ...V.tapped]), pad, V.touch);
  V.tapped.clear();
  const edge = (k) => { const was = w.prev[k]; w.prev[k] = inp[k]; return inp[k] && !was; };
  if (edge('exit')) { if (!V.nodes.bubble.hidden) { V.nodes.bubble.hidden = true; } else return exitWalk(); }
  if (edge('view')) setWalkView(V.prefs.walkView === 'first' ? 'third' : 'first');
  w.yaw -= inp.look.x * dt * 2.4; w.pitch = Math.max(-1.1, Math.min(0.6, w.pitch - inp.look.y * dt * 1.6));
  const free = ownerFree(world, V.prefs.room);
  const moving = Math.hypot(inp.move.x, inp.move.y) > 0.05;
  if (moving) {
    w.sit = null;
    const d = stepDelta(inp.move, w.yaw, speedFor(inp.run) * dt);
    const before = { ...w.pos };
    w.pos = moveAvatar(w.pos, d.dx, d.dy, free);
    const mx = w.pos.x - before.x; const my = w.pos.y - before.y;
    if (Math.hypot(mx, my) > 1e-4) w.faceYaw = Math.atan2(mx, my);
  }
  w.moving = moving;
  const target = nearestTarget(w.pos, walkTargets(eng));
  hud(target?.label || '');
  if (edge('interact') && target) interact(eng, target);
  // avatar
  const fp = V.prefs.walkView === 'first';
  const p = tileTo3D(world, w.pos.x, w.pos.y);
  const av = V.avatar;
  av.visible = !fp;
  const zk = zoneKey(zoneOf(world, w.pos.x, w.pos.y)); if (w.zone !== zk) { w.zone = zk; w.camPos = null; }
  if (w.sit) { av.position.set(w.sit.x, 0, w.sit.z); av.rotation.y = w.sit.rot; } else { av.position.set(p.x, p.y || 0, p.z); av.rotation.y = reduced ? w.faceYaw : av.rotation.y + angDiff(w.faceYaw, av.rotation.y) * Math.min(1, dt * 12); }
  animateFigure(av, { pose: w.sit ? 'sit' : moving ? 'walk' : 'stand', hold: t < w.mugUntil ? 'mug' : null, gesture: null, face: 'smile', speed: inp.run ? 1.5 : 1 }, t, dt, { reduced, seatY: 0.42 });
  // camera
  const cam = V.gl.camera;
  const head = new THREE.Vector3(av.position.x, av.position.y + (w.sit ? 0.85 : 1.15), av.position.z);
  if (fp) {
    cam.position.set(head.x, head.y + camBob(t, moving, { reduced }), head.z);
    cam.rotation.set(w.pitch, w.yaw, 0, 'YXZ');
  } else {
    const fwd = new THREE.Vector3(-Math.sin(w.yaw) * Math.cos(w.pitch), Math.sin(w.pitch), -Math.cos(w.yaw) * Math.cos(w.pitch));
    let dist = 2.8;
    ray.set(head, fwd.clone().negate().add(new THREE.Vector3(0, 0.35, 0)).normalize());
    const walls = ['walls_back', 'walls_outer', 'walls_inner'].map((k) => V.lodge.refs[k]).filter(Boolean);
    const hit = ray.intersectObjects(walls, false)[0];
    if (hit && hit.distance < dist) dist = Math.max(0.6, hit.distance - 0.25);
    const want = head.clone().add(fwd.clone().negate().add(new THREE.Vector3(0, 0.35, 0)).normalize().multiplyScalar(dist));
    if (!w.camPos || reduced) w.camPos = want.clone(); else w.camPos.lerp(want, Math.min(1, dt * 8));
    cam.position.copy(w.camPos);
    cam.lookAt(head.clone().add(fwd.clone().multiplyScalar(1.5)).setY(head.y + 0.1));
  }
}
function interact(eng, tg) {
  const w = V.walk; const t = now() / 1000;
  if (document.pointerLockElement && tg.kind !== 'pet' && tg.kind !== 'coffee' && tg.kind !== 'garden' && tg.kind !== 'couch') document.exitPointerLock();
  if (tg.kind === 'actor') {
    const a = eng.agents[tg.id]; const task = a?.task || a?.reviewing;
    bubble(`${eng.tip({ kind: 'actor', id: tg.id })}<div class="hab-row"><button class="btn small primary" data-b="open">${task ? 'Open task' : 'Open its card'}</button><button class="btn small" data-b="chat">Message in team chat</button><button class="btn small" data-b="close">Close</button></div>`, (act) => {
      if (act === 'open') { exitWalk(); eng.click({ kind: 'actor', id: tg.id }); }
      if (act === 'chat') { exitWalk(); V.opts?.openChat?.(); setTimeout(() => { const box = document.getElementById('chat-text'); if (box && !box.value) { box.value = `@${String(a?.name || tg.id).split(/\s+/)[0].toLowerCase()} `; box.focus(); } }, 60); }
    });
  } else if (tg.kind === 'desk') { exitWalk(); eng.click({ kind: 'desk', id: tg.id }); }
  else if (tg.kind === 'board') {
    const notes = [...(eng.notes || []).map((n) => `<div><b>${esc(n.kind === 'task' ? `T-${n.id}` : eng.agents[n.who]?.name || n.who)}</b> ${esc(n.text)}</div>`), ...V.prefs.notes.map((n) => `<div><b>You</b> ${esc(n.text)}</div>`)];
    bubble(`<b>Message board</b>${notes.join('') || '<div class="faint">No notes yet.</div>'}<div class="hab-row"><input class="hab-input" maxlength="80" placeholder="Pin a note as Owner"><button class="btn small primary" data-b="pin">Pin</button>${V.prefs.notes.length ? '<button class="btn small" data-b="clear">Clear my notes</button>' : ''}<button class="btn small" data-b="close">Close</button></div>`, (act, root) => {
      if (act === 'pin') { const v = root.querySelector('.hab-input').value; if (v.trim()) { savePrefs(withPref(V.prefs, 'note', v)); return 'close'; } }
      if (act === 'clear') { savePrefs(withPref(V.prefs, 'clearNotes')); return 'close'; }
      return null;
    });
  } else if (tg.kind === 'pet') eng.effects.push({ kind: 'heart', t0: now(), ttl: 3 }); // cosmetic, never saved
  else if (tg.kind === 'couch') { const s = tileTo3D(eng.world, NOOK.x0 + 0.5, NOOK.y0); w.sit = { x: s.x, z: s.z - 0.1, rot: 0 }; }
  else if (tg.kind === 'coffee') w.mugUntil = t + 25;
  else if (tg.kind === 'garden') eng.effects.push({ kind: 'water', t0: now(), ttl: 5 }); // cosmetic only: no growth, no counters
  else if (tg.kind === 'study') openPanel();
}
function bubble(html, onAct) {
  const d = node('bubble'); d.innerHTML = html; d.hidden = false;
  d.onclick = (e) => { const b = e.target.closest('[data-b]'); if (!b) return; const r = b.dataset.b === 'close' ? 'close' : onAct?.(b.dataset.b, d); if (r === 'close' || b.dataset.b !== 'pin') d.hidden = true; };
  const inp = d.querySelector('input'); if (inp) { inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') d.querySelector('[data-b="pin"]')?.click(); if (e.key === 'Escape') d.hidden = true; }); setTimeout(() => inp.focus(), 0); }
}
function lookPanel() {
  const a = V.prefs.avatar;
  bubble(`<b>Your look</b><div class="hab-row">Hair ${HAIR_STYLES.map((h, i) => `<button class="btn small${a.hair === i ? ' primary' : ''}" data-b="hair:${i}">${h}</button>`).join('')}</div><div class="hab-row">Outfit ${OUTFITS.map((c) => `<button class="hab3d-swatch${a.outfit === c ? ' on' : ''}" style="background:${c}" data-b="outfit:${c}" aria-label="Outfit colour ${c}"></button>`).join('')}</div><div class="hab-row"><button class="btn small" data-b="close">Done</button></div>`, (act) => {
    const [k, v] = act.split(':');
    savePrefs(withPref(V.prefs, 'avatar', k === 'hair' ? { hair: Number(v) } : { outfit: v }));
    if (V.avatar) { V.gl.dyn.remove(V.avatar); V.avatar = null; }
    enterWalk(); setTimeout(lookPanel, 0);
  });
}

// ---------- his study: place, move, remove ----------
function openPanel(msg = '') {
  const eng = habitatEngine(); const d = node('panel'); if (!eng) return;
  const pool = ownerPool(eng.store);
  const room = V.prefs.room; const sel = V.sel ?? null;
  if (!V.poolPick || !pool.includes(V.poolPick)) V.poolPick = pool[0];
  let grid = '';
  for (let y = 0; y < STUDY.h; y++) for (let x = 0; x < STUDY.w; x++) {
    const i = room.props.findIndex((p) => p.x === x && p.y === y);
    const entry = x === 5 && y === 2;
    grid += `<button class="hab3d-cell${i === sel && i >= 0 ? ' sel' : ''}${entry ? ' door' : ''}" data-c="${x},${y}" title="${entry ? 'By the door: stays free' : i >= 0 ? room.props[i].kind : 'Free'}">${entry ? '🚪' : i >= 0 ? esc(room.props[i].kind.replace('owner-', '').slice(0, 6)) : ''}</button>`;
  }
  d.innerHTML = `<b>Your study</b><div class="faint">Only you can enter. Pick a prop and click a free spot; click a prop to move or remove it. Saved, and nothing moves by itself.</div>
    <div class="hab-row"><select class="hab3d-pool" aria-label="Prop">${pool.map((k) => `<option value="${esc(k)}"${k === V.poolPick ? ' selected' : ''}>${esc(k.replace('owner-', 'your '))}</option>`).join('')}</select>${sel != null && room.props[sel] ? '<button class="btn small danger" data-p="remove">Remove</button>' : ''}<button class="btn small" data-p="close">Close</button></div>
    <div class="hab3d-grid">${grid}</div><div class="hab3d-msg">${esc(msg)}</div>`;
  d.hidden = false;
  d.querySelector('.hab3d-pool').addEventListener('change', (e) => { V.poolPick = e.target.value; V.sel = null; });
  d.onclick = (e) => {
    const b = e.target.closest('[data-c],[data-p]'); if (!b) return;
    if (b.dataset.p === 'close') { d.hidden = true; V.sel = null; return; }
    if (b.dataset.p === 'remove') { const r = ownerEdit(room, { kind: 'remove', idx: V.sel }); if (r.ok) savePrefs(withPref(V.prefs, 'room', r.room)); V.sel = null; return openPanel(r.reason); }
    const [x, y] = b.dataset.c.split(',').map(Number);
    const i = room.props.findIndex((p) => p.x === x && p.y === y);
    if (i >= 0) { V.sel = i; return openPanel('Now click a free spot to move it, or Remove.'); }
    const r = V.sel != null ? ownerEdit(room, { kind: 'move', idx: V.sel, x, y }) : ownerEdit(room, { kind: 'place', prop: V.poolPick, x, y }, { pool });
    if (r.ok) savePrefs(withPref(V.prefs, 'room', r.room));
    V.sel = null; openPanel(r.reason);
  };
}

// ---------- for the CI screenshot harness ----------
function api() {
  return {
    get ready() { return Boolean(V?.lodge) && Boolean(V?.castle) && V.frames > 2; },
    get frames() { return V?.frames || 0; },
    mode: () => (V?.el?.classList.contains('hab3d-on') ? '3d' : '2d'),
    preset: (id) => preset(id, true),
    focus: (x, y, dist) => { const p = tileTo3D(habitatEngine().world, x, y); V.goal = { target: new THREE.Vector3(p.x, 0.5, p.z), dist, theta: V.cam.theta, phi: 0.9 }; V.cam = { ...V.goal, target: V.goal.target.clone() }; },
    orbit: (theta, phi, dist) => { V.goal = { target: V.cam.target.clone(), dist, theta, phi }; V.cam = { ...V.goal, target: V.goal.target.clone() }; },
    walk: (on) => (on ? enterWalk() : exitWalk()),
    walkTo: (x, y, yaw) => { V.walk.pos = { x, y }; V.walk.yaw = yaw; V.walk.faceYaw = yaw + Math.PI; V.walk.camPos = null; V.walk.placed = true; },
    setView: (v) => setWalkView(v),
    pos: () => ({ ...V.walk.pos }),
    study: () => goStudy(),
    raid: () => { const eng = habitatEngine(); if (eng?.world) { if (V.raid) endRaid(eng); startRaid(Date.now(), eng); } },
    raidAt: (sec) => { if (V.raid) V.raid.t0 = performance.now() - sec * 1000; },
    time: (v) => { savePrefs(withPref(V.prefs, 'time', v)); V.phase = ''; },
    characters: () => openCharacters(),
    roomPreset: (i = 0) => preset(`room:${habitatEngine().world.ids[i]}`, true),
    walkStart: () => enterWalk(),
    stats: () => ({ figures: [...V.figs.values()].filter((f) => f.visible).length, pet: Boolean(V.pet?.visible), fire: Boolean(V.lodge?.refs.fire), lampsLit: (V.lodge?.refs.lamps || []).filter((l) => l.halo?.visible).length, windows: V.lodge?.refs.windowMat.emissiveIntensity || 0, weather: V.weather, phase: V.phase, walking: V.walk.on, avatar: Boolean(V.avatar?.visible), prefs: { ...V.prefs }, folk: V.npcs.filter((n) => n.kind === 'folk' && n.obj.visible).length, guards: V.npcs.filter((n) => n.kind === 'guard').length, raid: V.raid ? V.raid.plan.raiders.length : 0, castle: Boolean(V.castle) }),
  };
}

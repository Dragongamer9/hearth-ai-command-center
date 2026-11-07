import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildWorld, behaviourOf, findPath, restSpot, newActor, stepActor, roomOf, deskOf, T, MAX_AIS } from '../src/habitat/world.mjs';
import { walkableTiles, emptyStore } from '../src/habitat/life.mjs';
import { applyHabitatLines, habitatSection, describeRoom, OWNER_ROOM_LINE } from '../src/habitat/actions.mjs';
import { tileTo3D, hallTo3D, cityBounds, toTile, lodgeBounds, inBounds, wallKind, visualFor, doorClosed, lampLit, normPrefs, withPref, pickView, motionFor, pixelRatio, PIXEL_RATIO_CAP, lightRig, presets, facingOf, sceneKey, OWNER_NOTES_MAX } from '../src/habitat3d/map.mjs';
import { STUDY, STUDY_DOOR, NOOK, inStudy, inNook, ownerFree, aiCanStand, moveAvatar, AVATAR_R, inputFrom, stepDelta, camBob, snapTurn, nearestTarget, noticers, ownerPool, ownerEdit, canPlaceOwner, OWNER_ITEMS, studyGlobal } from '../src/habitat3d/walk.mjs';
import { AGENT_IDS } from '../src/registry.mjs';

const IDS = [...AGENT_IDS, 'copilot', 'meta'];
const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const ownerTiles = () => {
  const out = [];
  for (let y = STUDY.y0; y < STUDY.y0 + STUDY.h; y++) for (let x = STUDY.x0; x < STUDY.x0 + STUDY.w; x++) out.push({ x, y });
  for (let y = NOOK.y0; y < NOOK.y0 + NOOK.h; y++) for (let x = NOOK.x0; x < NOOK.x0 + NOOK.w; x++) out.push({ x, y });
  return [...out, STUDY_DOOR, ...NOOK.opening];
};

test('2D grid -> 3D: every tile maps inside the castle city, for 1 to 12 AIs', () => {
  for (let n = 1; n <= MAX_AIS; n++) {
    const w = buildWorld(IDS.slice(0, n));
    const b = lodgeBounds(w); const city = cityBounds(w);
    assert.ok(b.maxX - b.minX === w.w && b.maxZ - b.minZ === w.h);
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
      const p = tileTo3D(w, x, y);
      assert.ok(inBounds(city, p), `tile ${x},${y} inside the city for ${n}`);
      const h = hallTo3D(w, x, y);
      assert.ok(inBounds(b, h), 'hall mapping inside the hall');
      assert.deepEqual(toTile(w, h.x, h.z), { x, y }, 'round trip');
    }
  }
});

test('desks, seats, beds and doors line up in 3D', () => {
  for (let n = 1; n <= MAX_AIS; n++) {
    const w = buildWorld(IDS.slice(0, n));
    for (const d of w.desks) {
      const seat = tileTo3D(w, d.seat.x, d.seat.y); const mon = tileTo3D(w, d.monitor.x, d.monitor.y);
      assert.equal(seat.x, mon.x, 'seat sits square in front of the monitor');
      assert.equal(Math.abs(seat.z - mon.z), 1, 'seat is one tile from the desk');
      const xs = d.tiles.map((t) => tileTo3D(w, t.x, t.y).x);
      assert.ok(xs[1] - xs[0] === 1 && xs[2] - xs[1] === 1, 'desk tiles are contiguous');
    }
    for (const r of w.rooms) {
      const a = tileTo3D(w, r.x0, r.y0); const c = tileTo3D(w, r.x0 + r.w - 1, r.y0 + r.h - 1);
      for (const bt of r.bed) { const p = tileTo3D(w, bt.x, bt.y); assert.ok(p.x >= a.x && p.x <= c.x && p.z >= a.z && p.z <= c.z, 'bed inside its room'); }
      const [b0, b1] = r.bed.map((t) => tileTo3D(w, t.x, t.y));
      assert.equal(b0.x, b1.x); assert.equal(Math.abs(b0.z - b1.z), 1, 'bed is two tiles long');
      const door = tileTo3D(w, r.door.x, r.door.y);
      assert.ok(door.x > a.x && door.x < c.x, 'door within the room width');
      assert.equal(w.grid[r.door.y][r.door.x], T.DOOR);
      // the door sits in the wall row between the room and the great room
      assert.equal(Math.abs(door.z - (r.side === 'top' ? c.z : a.z)), 1);
    }
    assert.equal(wallKind(w, 0, 0), 'back');
    assert.equal(wallKind(w, 0, 5), 'outer');
    assert.equal(wallKind(w, 1, 1), null);
  }
});

test('state -> visual: the same state as the 2D behaviour fixtures', () => {
  const work = behaviourOf({ status: 'idle', task: { id: 'K7Q2MA', title: 'Storage page', branch: 'hearth/k7q2ma' } });
  assert.equal(visualFor(work, { pose: 'sit', mode: 'desk' }).pose, 'type');
  assert.equal(visualFor(work, { pose: 'walk', mode: 'desk' }).pose, 'walk');
  const out = behaviourOf({ status: 'out', task: { id: 'X' } });
  const vo = visualFor(out, { pose: 'sleep', mode: 'sleep' });
  assert.equal(vo.pose, 'sleep'); assert.equal(vo.face, 'asleep'); assert.equal(vo.icon, 'zzz');
  for (const status of ['hold', 'signedout']) { const b = behaviourOf({ status }); assert.equal(doorClosed(b), true); assert.equal(visualFor(b, { pose: 'stand' }).icon, 'lock'); }
  assert.equal(doorClosed(behaviourOf({ status: 'idle' })), false);
  assert.equal(visualFor(behaviourOf({ status: 'idle', typing: true }), { pose: 'sit' }).icon, 'bubble');
  assert.equal(visualFor(behaviourOf({ status: 'idle', reviewing: { id: 'R' } }), { pose: 'sit', mode: 'desk' }).icon, 'magnifier');
  assert.equal(visualFor(behaviourOf({ status: 'idle', lead: true }), { pose: 'sit' }).star, true);
  assert.equal(visualFor(behaviourOf({ status: 'idle', waiting: true }), { pose: 'stand' }).icon, 'ask');
  // visits and coffee: paper in hand, mug at the kitchen
  const idle = behaviourOf({ status: 'idle' });
  assert.equal(visualFor(idle, { pose: 'walk', errand: { to: { x: 1, y: 1 } } }).hold, 'paper');
  assert.equal(visualFor(idle, { pose: 'stand', goal: 'coffee' }).hold, 'mug');
  assert.equal(visualFor(idle, { pose: 'walk', goal: 'coffee' }).hold, null);
  // moods and gestures
  assert.equal(visualFor(idle, { pose: 'stand' }, { mood: 'tired' }).face, 'tired');
  assert.equal(visualFor(idle, { pose: 'stand' }, { mood: 'pleased' }).face, 'smile');
  assert.equal(visualFor(idle, { pose: 'stand' }, { chat: true }).icon, 'chat');
  assert.equal(visualFor(idle, { pose: 'stand' }, { waving: true }).gesture, 'wave');
  assert.equal(visualFor(out, { pose: 'sleep' }, { waving: true }).gesture, null, 'sleepers never wave');
  // lamps: lit at night unless the AI turned it off
  assert.equal(lampLit({ ai: { a: { lamp: 'off' } } }, 'a', { lamps: true }), false);
  assert.equal(lampLit({ ai: {} }, 'a', { lamps: true }), true);
  assert.equal(lampLit({ ai: {} }, 'a', { lamps: false }), false);
  assert.equal(facingOf('up'), Math.PI); assert.equal(facingOf('down'), 0);
});

test('3D figures follow the shared actors: desk, sleep, walking, and reduced motion snapping', () => {
  const ids = IDS.slice(0, 6);
  const w = buildWorld(ids);
  const behs = { [ids[0]]: behaviourOf({ status: 'idle', task: { id: 'A' } }), [ids[1]]: behaviourOf({ status: 'out' }), [ids[2]]: behaviourOf({ status: 'idle' }) };
  for (const id of ids.slice(0, 3)) {
    const a = newActor(w, id, { mode: 'idle' });
    for (let i = 0; i < 400; i++) stepActor(w, a, behs[id], 0.05, { rng: seeded(i + 3) });
    const v = visualFor(behs[id], a);
    if (behs[id].mode === 'desk') { assert.equal(v.pose, 'type'); assert.deepEqual({ x: a.x, y: a.y }, deskOf(w, id).seat); }
    if (behs[id].mode === 'sleep') { assert.equal(v.pose, 'sleep'); assert.deepEqual({ x: a.x, y: a.y }, roomOf(w, id).bedSpot); }
  }
  // reduced motion: snapped to the rest spot at once, no walking, no particles or easing
  const a = newActor(w, ids[0], { mode: 'idle' });
  stepActor(w, a, behs[ids[0]], 0.016, { reduced: true });
  assert.deepEqual({ x: a.x, y: a.y }, restSpot(w, ids[0], behs[ids[0]]));
  assert.notEqual(visualFor(behs[ids[0]], a).pose, 'walk');
  const m = motionFor({ reduced: true });
  assert.equal(m.particles, 0); assert.equal(m.easing, false); assert.equal(m.snap, true); assert.equal(m.animate, false);
  assert.equal(camBob(1.2, true, { reduced: true }), 0);
  assert.ok(camBob(1.2, true, { reduced: false }) > 0);
  assert.equal(snapTurn(0, 1, { reduced: true, instant: true }), Math.PI / 4);
});

test('quality: pixel ratio capped, Lighter 3D drops shadows and most particles', () => {
  assert.equal(pixelRatio(3), PIXEL_RATIO_CAP);
  assert.equal(pixelRatio(1.5), 1.5);
  assert.equal(pixelRatio(2, { lighter: true }), 1);
  assert.equal(pixelRatio(NaN), 1);
  const full = motionFor({}); const light = motionFor({ lighter: true });
  assert.equal(full.shadows, true); assert.equal(light.shadows, false);
  assert.ok(light.particles < full.particles && light.particles > 0);
  assert.ok(lightRig('night').windows > lightRig('day').windows, 'windows glow at night');
  assert.ok(lightRig('night').fire > lightRig('day').fire);
  assert.equal(lightRig('night').stars, true);
});

test('2D/3D switch and 3D settings: saved, and never changed by themselves', () => {
  assert.equal(normPrefs(null).mode, '2d', '2D stays the default');
  assert.equal(normPrefs({ mode: 'weird', lighter: 'yes' }).mode, '2d');
  assert.equal(normPrefs({ lighter: 'yes' }).lighter, false);
  let p = withPref(null, 'mode', '3d');
  p = withPref(p, 'lighter', true);
  const saved = JSON.parse(JSON.stringify(p));
  assert.deepEqual(normPrefs(saved), p, 'survives a save and reload');
  assert.equal(normPrefs(saved).mode, '3d'); assert.equal(normPrefs(saved).lighter, true);
  // normalising again changes nothing
  assert.deepEqual(normPrefs(normPrefs(saved)), normPrefs(saved));
  // flipping one setting leaves the others alone
  const q = withPref(saved, 'walkView', 'first');
  assert.equal(q.mode, '3d'); assert.equal(q.lighter, true); assert.equal(q.walkView, 'first');
});

test('no WebGL: the Habitat falls back to 2D with a notice, and the saved choice stays 3D', () => {
  const prefs = withPref(null, 'mode', '3d');
  const before = JSON.stringify(prefs);
  const v = pickView(prefs, { webgl: false });
  assert.equal(v.mode, '2d'); assert.match(v.notice, /WebGL/);
  assert.equal(JSON.stringify(prefs), before, 'the fallback never rewrites the saved choice');
  assert.deepEqual(pickView(prefs, { webgl: true }), { mode: '3d', notice: '' });
  assert.equal(pickView(withPref(null, 'mode', '2d'), { webgl: false }).notice, '', '2D users see no notice');
  assert.equal(pickView(prefs, { webgl: true, rearranging: true }).mode, '2d', 'rearranging happens in 2D');
});

test('camera presets aim inside the lodge; the scene key tracks saved looks', () => {
  for (const n of [1, 5, 12]) {
    const w = buildWorld(IDS.slice(0, n));
    const ps = presets(w, {});
    assert.equal(ps.filter((p) => p.id.startsWith('room:')).length, n);
    for (const p of ps) assert.ok(inBounds(cityBounds(w), p.target, 0.01), p.id);
    assert.ok(ps.some((p) => p.id === 'lodge') && ps.some((p) => p.id === 'great'));
  }
  const w = buildWorld(IDS.slice(0, 3));
  const s = emptyStore();
  const k1 = sceneKey({ world: w, store: s, notes: [] });
  assert.equal(k1, sceneKey({ world: w, store: s, notes: [] }));
  assert.notEqual(k1, sceneKey({ world: w, store: s, notes: [{ id: 'x', text: 'hi' }] }));
});

test('the owner’s study: no AI can ever path into it, for 1 to 12 AIs', () => {
  for (let n = 1; n <= MAX_AIS; n++) {
    const ids = IDS.slice(0, n);
    const w = buildWorld(ids);
    const walk = walkableTiles(w);
    for (const t of ownerTiles()) {
      assert.ok(!walk.some((x) => x.x === t.x && x.y === t.y), `${t.x},${t.y} is not in the AIs' walkable map`);
      for (const id of ids) {
        assert.equal(aiCanStand(w, t.x, t.y, new Set(), id), false);
        assert.equal(findPath(w, restSpot(w, id, { mode: 'idle' }), t, { closed: new Set(), who: id }), null, `${id} can't reach ${t.x},${t.y}`);
      }
    }
    // the study door is a wall tile in the AIs' world
    assert.equal(w.grid[STUDY_DOOR.y][STUDY_DOOR.x], T.WALL);
    // wandering AIs and the pet never end up there
    const a = newActor(w, ids[0], { mode: 'idle' });
    for (let i = 0; i < 600; i++) { stepActor(w, a, { mode: 'idle' }, 0.1, { rng: seeded(i + 1), social: true }); assert.ok(!inStudy(Math.round(a.x), Math.round(a.y)) && !inNook(Math.round(a.x), Math.round(a.y))); }
  }
});

test('HABITAT: actions can’t reach, change or describe the owner’s room', () => {
  const ids = IDS.slice(0, 4); const agents = ids.map((id) => ({ id, status: 'idle' }));
  const s0 = emptyStore();
  for (const line of ['go owner room', 'go the study', 'go to the owner’s room', 'go private', 'go loft']) {
    const r = applyHabitatLines(s0, { agent: ids[0], text: `HABITAT: ${line}`, ids, agents, now: 1e12 });
    assert.equal(r.results[0].ok, false, line);
    assert.equal(r.events.length, 0);
  }
  assert.match(applyHabitatLines(s0, { agent: ids[0], text: 'HABITAT: go owner room', ids, agents, now: 1e12 }).results[0].reason, /private/);
  // place / move / note only ever touch the AI's own room and the shared board, never the owner's settings
  const r = applyHabitatLines(s0, { agent: ids[0], text: 'HABITAT: place fern at -3,7\nHABITAT: move fern to 9,9\nHABITAT: note hello owner', ids, agents, now: 1e12 });
  assert.equal(r.results[0].ok, false); assert.equal(r.results[1].ok, false);
  assert.ok(!/owner-desk|habitat3d|study/i.test(JSON.stringify(r.store)), 'nothing about the owner’s room in the AIs’ store');
  // prompts: only the one line
  const sec = habitatSection(s0, { agent: ids[0], ids, full: true });
  assert.equal(sec.text.split(OWNER_ROOM_LINE).length - 1, 1);
  assert.ok(!/owner-desk|armchair|wall screen/i.test(sec.text));
  assert.ok(describeRoom(s0, ids[0], { ids }).includes(OWNER_ROOM_LINE));
});

test('the owner’s avatar stays inside walkable space and can enter his study', () => {
  const w = buildWorld(IDS.slice(0, 8));
  const free = ownerFree(w, { props: [{ kind: 'armchair', x: 1, y: 1 }] });
  assert.equal(free(STUDY_DOOR.x, STUDY_DOOR.y), true);
  assert.equal(free(studyGlobal(1, 1).x, studyGlobal(1, 1).y), false, 'furniture blocks');
  for (const b of NOOK.benches) assert.equal(free(b.x, b.y), false);
  const rng = seeded(42);
  let pos = { x: 1, y: 10 };
  const corners = (p) => [[p.x - AVATAR_R, p.y - AVATAR_R], [p.x + AVATAR_R, p.y - AVATAR_R], [p.x - AVATAR_R, p.y + AVATAR_R], [p.x + AVATAR_R, p.y + AVATAR_R]];
  for (let i = 0; i < 3000; i++) {
    pos = moveAvatar(pos, (rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6, free);
    for (const [cx, cy] of corners(pos)) assert.ok(free(Math.round(cx), Math.round(cy)), `inside at step ${i}`);
  }
  // walking straight west from the great room is stopped by the wall (no study door on row 9)
  let p = { x: 1, y: 9 };
  for (let i = 0; i < 40; i++) p = moveAvatar(p, -0.2, 0, free);
  assert.ok(p.x >= 0.5 + AVATAR_R - 1e-9, 'blocked by the west wall');
  // ...but on row 7 he walks through his door into the study
  p = { x: 1, y: 7 };
  for (let i = 0; i < 40; i++) p = moveAvatar(p, -0.15, 0, free);
  assert.ok(inStudy(Math.round(p.x), Math.round(p.y)), 'in the study');
  // movement turns with the view
  const d = stepDelta({ x: 0, y: 1 }, 0, 1); assert.ok(Math.abs(d.dx) < 1e-9 && Math.abs(d.dy + 1) < 1e-9, 'forward at yaw 0 is north');
  const r = stepDelta({ x: 1, y: 0 }, 0, 1); assert.ok(Math.abs(r.dx - 1) < 1e-9);
});

test('controls: keyboard, controller and touch mappings', () => {
  const k = inputFrom(new Set(['KeyW', 'ShiftLeft']));
  assert.deepEqual(k.move, { x: 0, y: 1 }); assert.equal(k.run, true);
  assert.equal(inputFrom(new Set(['ArrowLeft'])).move.x, -1);
  assert.equal(inputFrom(new Set(['KeyE'])).interact, true);
  assert.equal(inputFrom(new Set(['KeyV'])).view, true);
  assert.equal(inputFrom(new Set(['Escape'])).exit, true);
  const diag = inputFrom(new Set(['KeyW', 'KeyD'])).move; assert.ok(Math.abs(Math.hypot(diag.x, diag.y) - 1) < 1e-9, 'diagonals are not faster');
  const btn = (i) => Array.from({ length: 12 }, (_, j) => ({ pressed: j === i }));
  const pad = { axes: [0, -1, 0.5, 0], buttons: btn(0) };
  const g = inputFrom(new Set(), pad);
  assert.ok(g.move.y > 0.99, 'left stick up walks forward'); assert.ok(g.look.x > 0.3, 'right stick looks');
  assert.equal(g.interact, true, 'A interacts');
  assert.equal(inputFrom(new Set(), { axes: [0, 0, 0, 0], buttons: btn(1) }).exit, true, 'B exits');
  assert.equal(inputFrom(new Set(), { axes: [0, 0, 0, 0], buttons: btn(3) }).view, true, 'Y switches view');
  assert.deepEqual(inputFrom(new Set(), { axes: [0.1, -0.1, 0, 0], buttons: [] }).move, { x: 0, y: 0 }, 'dead zone');
  assert.ok(inputFrom(new Set(), null, { move: { x: 0, y: -1 } }).move.y > 0.99, 'touch stick');
  assert.equal(nearestTarget({ x: 0, y: 0 }, [{ kind: 'a', x: 3, y: 0 }, { kind: 'b', x: 1, y: 0 }]).kind, 'b');
  assert.equal(nearestTarget({ x: 0, y: 0 }, [{ kind: 'a', x: 3, y: 0 }]), null);
  assert.deepEqual(noticers({ x: 0, y: 0 }, [{ id: 'a', x: 1, y: 0 }, { id: 'b', x: 1, y: 1 }, { id: 'c', x: 9, y: 0 }], { a: { mode: 'idle' }, b: { mode: 'desk' }, c: { mode: 'idle' } }), ['a'], 'only idle AIs nearby notice him');
});

test('walk mode settings, avatar and study decorations persist', () => {
  let p = withPref(null, 'walkView', 'first');
  p = withPref(p, 'avatar', { hair: 2 });
  p = withPref(p, 'avatar', { outfit: '#3f6e8c' });
  p = withPref(p, 'note', 'Back on Monday');
  const back = normPrefs(JSON.parse(JSON.stringify(p)));
  assert.equal(back.walkView, 'first'); assert.equal(back.avatar.hair, 2); assert.equal(back.avatar.outfit, '#3f6e8c');
  assert.equal(back.notes[0].text, 'Back on Monday');
  assert.equal(normPrefs({ avatar: { hair: 99, outfit: 'javascript:' } }).avatar.hair, 0);
  for (let i = 0; i < 10; i++) p = withPref(p, 'note', `n${i}`);
  assert.equal(p.notes.length, OWNER_NOTES_MAX);
  assert.equal(withPref(p, 'note', '<b></b>').notes.length, OWNER_NOTES_MAX, 'empty notes are ignored');
  // decorating: place, move, remove; the way from the door stays open
  const pool = ownerPool({ ai: { a: { props: [{ kind: 'globe', x: 0, y: 0 }], stored: ['lantern'] } } });
  for (const k of OWNER_ITEMS) assert.ok(pool.includes(k));
  assert.ok(pool.includes('lantern') && !pool.includes('fishbowl'), 'unlocked props join his pool');
  let room = { props: [] };
  assert.equal(ownerEdit(room, { kind: 'place', prop: 'owner-desk', x: 5, y: 2 }, { pool }).ok, false, 'the spot by the door stays free');
  assert.equal(ownerEdit(room, { kind: 'place', prop: 'fishbowl', x: 1, y: 1 }, { pool }).ok, false, 'not in his pool');
  let r = ownerEdit(room, { kind: 'place', prop: 'owner-desk', x: 0, y: 0 }, { pool }); assert.ok(r.ok); room = r.room;
  r = ownerEdit(room, { kind: 'place', prop: 'armchair', x: 0, y: 0 }, { pool }); assert.equal(r.ok, false, 'taken');
  r = ownerEdit(room, { kind: 'move', idx: 0, x: 2, y: 1 }); assert.ok(r.ok); room = r.room;
  assert.deepEqual(room.props[0], { kind: 'owner-desk', x: 2, y: 1 });
  // a wall of props that would cut a corner off is refused
  let wall = { props: [{ kind: 'plant', x: 1, y: 0 }, { kind: 'plant', x: 1, y: 1 }, { kind: 'plant', x: 1, y: 2 }] };
  assert.equal(canPlaceOwner(wall.props, -1, 1, 3), false);
  const saved = normPrefs(JSON.parse(JSON.stringify(withPref(null, 'room', room))));
  assert.deepEqual(saved.room, room);
  r = ownerEdit(room, { kind: 'remove', idx: 0 }); assert.ok(r.ok); assert.equal(r.room.props.length, 0);
  assert.equal(room.props.length, 1, 'edits never mutate the saved room');
  wall = null;
});

// Recorded here, independently of the README: the npm tarball's dist.integrity (sha512)
// and the sha256 of package/build/three.module.min.js inside it. CI re-downloads the
// tarball with npm (which checks dist.integrity) and compares the extracted file.
const THREE_TGZ_SHA512 = 'sha512-FQK+LEpYc0fBD+J8g6oSEyyNzjp+Q7Ks1C568WWaoMRLW+TkNNWmenWeGgJjV105Gd+p/2ql1ZcjYvNiPZBhuQ==';
const THREE_MIN_SHA256 = '08fd7545d13d2c7fb65ab691530a802dafefd638596501854f267d0fb13c39e7';
test('vendored three.js matches its recorded integrity', () => {
  const readme = readFileSync(new URL('../src/vendor/three/README.md', import.meta.url), 'utf8');
  const file = readFileSync(new URL('../src/vendor/three/three.module.min.js', import.meta.url));
  const sha = createHash('sha256').update(file).digest('hex');
  assert.equal(sha, THREE_MIN_SHA256, 'the vendored file is byte-for-byte the upstream one');
  assert.ok(readme.includes(THREE_MIN_SHA256) && readme.includes(THREE_TGZ_SHA512), 'README records the same values');
  assert.match(readme, /three-0\.170\.0\.tgz/);
  assert.match(readme, /sha512-FQK\+LEpYc0fBD\+J8g6oSEyyNzjp\+Q7Ks1C568WWaoMRLW\+TkNNWmenWeGgJjV105Gd\+p\/2ql1ZcjYvNiPZBhuQ==/);
  assert.match(file.subarray(0, 200).toString(), /three\.js/i);
  assert.match(readFileSync(new URL('../src/vendor/three/LICENSE', import.meta.url), 'utf8'), /MIT License/);
  // local files only: no CDN in the 3D view
  for (const f of ['view.mjs', 'lodge.mjs', 'figures.mjs', 'textures.mjs']) assert.ok(!/https?:\/\//.test(readFileSync(new URL(`../src/habitat3d/${f}`, import.meta.url), 'utf8')), `${f} loads nothing remote`);
});

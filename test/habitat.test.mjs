import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWorld, behaviourOf, findPath, passable, restSpot, newActor, stepActor, closedDoors, roomOf, deskOf, T, MAX_AIS } from '../src/habitat/world.mjs';
import { SPRITES, SLEEP, ICONS, FONT } from '../src/habitat/sprites.mjs';
import { AGENT_IDS, COLORS } from '../src/registry.mjs';

const IDS = [...AGENT_IDS, 'copilot', 'meta'];
const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

test('state -> behaviour: working at the desk, out of usage asleep, hold locked, typing bubble', () => {
  const work = behaviourOf({ status: 'idle', task: { id: 'K7Q2MA', title: 'Storage page', branch: 'hearth/k7q2ma' } });
  assert.equal(work.mode, 'desk');
  assert.deepEqual(work.monitor, { id: 'K7Q2MA', kind: 'task' });
  const out = behaviourOf({ status: 'out', task: { id: 'X' } });
  assert.equal(out.mode, 'sleep'); assert.equal(out.icon, 'zzz'); assert.equal(out.monitor, null);
  for (const status of ['hold', 'signedout']) {
    const b = behaviourOf({ status, task: { id: 'X' } });
    assert.equal(b.mode, 'locked'); assert.equal(b.door, 'locked'); assert.equal(b.icon, 'lock');
  }
  assert.equal(behaviourOf({ status: 'idle', typing: true }).icon, 'bubble');
  assert.equal(behaviourOf({ status: 'idle', typing: true }).mode, 'idle');
  assert.equal(behaviourOf({ status: 'idle', typing: true, task: { id: 'A' } }).mode, 'desk');
  const rev = behaviourOf({ status: 'idle', reviewing: { id: 'RV1', title: 'r' } });
  assert.equal(rev.mode, 'desk'); assert.equal(rev.icon, 'magnifier'); assert.equal(rev.monitor.kind, 'review');
  assert.equal(behaviourOf({ status: 'idle' }).mode, 'idle');
  assert.equal(behaviourOf({ status: 'idle', lead: true }).star, true);
  assert.equal(behaviourOf({ status: 'idle', waiting: true }).icon, 'ask');
});

test('every enabled AI gets a room and a desk, for 1 to 12 AIs', () => {
  for (let n = 1; n <= MAX_AIS; n++) {
    const ids = IDS.slice(0, n);
    const w = buildWorld(ids);
    assert.equal(w.rooms.length, n, `rooms for ${n}`);
    assert.equal(w.desks.length, n, `desks for ${n}`);
    for (const id of ids) { assert.ok(roomOf(w, id), `${id} room`); assert.ok(deskOf(w, id), `${id} desk`); }
    // Rooms never overlap and stay on the map edges.
    const seen = new Set();
    for (const r of w.rooms) {
      assert.ok(r.y0 === 1 || r.y0 + r.h === w.h - 1, 'room along an edge');
      for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) { const k = `${x},${y}`; assert.ok(!seen.has(k), 'overlap'); seen.add(k); }
      assert.equal(w.grid[r.door.y][r.door.x], T.DOOR);
      assert.ok(r.props.length >= 2 && r.props.length <= 3, 'two or three personal props');
    }
    // The outer border is wall all the way round.
    for (let x = 0; x < w.w; x++) { assert.equal(w.grid[0][x], T.WALL); assert.equal(w.grid[w.h - 1][x], T.WALL); }
    for (let y = 0; y < w.h; y++) { assert.equal(w.grid[y][0], T.WALL); assert.equal(w.grid[y][w.w - 1], T.WALL); }
  }
  const kinds = new Set(buildWorld(IDS).rooms.map((r) => r.props.map((p) => p.kind).join('+')));
  assert.ok(kinds.size >= 4, 'props vary per AI');
  assert.equal(buildWorld([...IDS, 'extra1']).rooms.length, MAX_AIS);
});

test('pathfinding never crosses walls and reaches every desk, bed and rug', () => {
  for (const n of [1, 2, 5, 8, 12]) {
    const w = buildWorld(IDS.slice(0, n));
    for (const r of w.rooms) {
      for (const goal of [deskOf(w, r.id).seat, r.bedSpot, r.rugSpot, ...r.spots]) {
        for (const from of [r.rugSpot, deskOf(w, r.id).seat]) {
          const path = findPath(w, from, goal, { who: r.id });
          assert.ok(path, `${r.id} reaches ${goal.x},${goal.y}`);
          let prev = from;
          for (const p of path) {
            assert.ok(passable(w, p.x, p.y, { who: r.id }), `no wall at ${p.x},${p.y}`);
            assert.ok(![T.WALL, T.DESK, T.PROP, T.GARDEN].includes(w.grid[p.y][p.x]));
            assert.equal(Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y), 1, 'one tile per step');
            prev = p;
          }
        }
      }
    }
  }
});

test('a locked room keeps everyone else out, but its owner can still get home', () => {
  const w = buildWorld(IDS.slice(0, 4));
  const [a, b] = w.rooms;
  const closed = new Set([a.id]);
  assert.equal(findPath(w, deskOf(w, b.id).seat, a.rugSpot, { closed, who: b.id }), null);
  assert.ok(findPath(w, deskOf(w, a.id).seat, a.rugSpot, { closed, who: a.id }));
  assert.deepEqual([...closedDoors({ x: behaviourOf({ status: 'hold' }), y: behaviourOf({}) })], ['x']);
});

test('characters walk to the desk to work and to bed when out of usage', () => {
  const w = buildWorld(IDS.slice(0, 3));
  const id = w.rooms[0].id;
  const idle = behaviourOf({ status: 'idle' });
  const a = newActor(w, id, idle);
  const rng = seeded(3);
  const work = behaviourOf({ status: 'idle', task: { id: 'T1' } });
  for (let i = 0; i < 400 && !(a.pose === 'sit' && a.mode === 'desk' && !a.path.length); i++) stepActor(w, a, work, 0.05, { rng });
  assert.deepEqual({ x: a.x, y: a.y }, deskOf(w, id).seat);
  assert.equal(a.pose, 'sit');
  const out = behaviourOf({ status: 'out' });
  for (let i = 0; i < 400 && a.pose !== 'sleep'; i++) stepActor(w, a, out, 0.05, { rng });
  assert.deepEqual({ x: a.x, y: a.y }, restSpot(w, id, out));
});

test('reduced motion: no wandering, characters snap to their spot', () => {
  const w = buildWorld(IDS.slice(0, 6));
  const rng = seeded(7);
  for (const r of w.rooms) {
    const idle = behaviourOf({ status: 'idle' });
    const a = newActor(w, r.id, idle);
    a.x = r.spots[0].x; a.y = r.spots[0].y;
    for (let i = 0; i < 300; i++) {
      stepActor(w, a, idle, 0.5, { rng, reduced: true });
      assert.deepEqual({ x: a.x, y: a.y }, r.rugSpot);
      assert.equal(a.path.length, 0);
    }
    const work = behaviourOf({ status: 'idle', task: { id: 'T' } });
    stepActor(w, a, work, 0.016, { rng, reduced: true });
    assert.deepEqual({ x: a.x, y: a.y }, deskOf(w, r.id).seat, 'snaps straight to the desk');
    assert.equal(a.pose, 'sit');
  }
  // Without reduced motion the same idle AI does wander.
  const r = w.rooms[0];
  const a = newActor(w, r.id, behaviourOf({}));
  const spots = new Set();
  for (let i = 0; i < 2000; i++) { stepActor(w, a, behaviourOf({}), 0.1, { rng }); spots.add(`${Math.round(a.x)},${Math.round(a.y)}`); }
  assert.ok(spots.size > 2, 'wanders when motion is allowed');
  for (const k of spots) { const [x, y] = k.split(',').map(Number); assert.ok(x >= r.x0 && x < r.x0 + r.w && y >= r.y0 && y < r.y0 + r.h, 'stays in its own room'); }
});

test('sprites, icons and font are well formed; every AI has a color', () => {
  for (const dir of ['down', 'up', 'right']) {
    assert.ok(SPRITES[dir].length >= 2 && SPRITES[dir].length <= 4, `${dir} walk cycle`);
    for (const f of SPRITES[dir]) { assert.equal(f.length, 16); for (const row of f) assert.equal(row.length, 16, `${dir}: ${row}`); }
  }
  assert.equal(SLEEP.length, 9); for (const row of SLEEP) assert.equal(row.length, 16);
  for (const [k, rows] of Object.entries(ICONS)) for (const row of rows) assert.equal(row.length, rows[0].length, k);
  for (const [k, g] of Object.entries(FONT)) assert.match(g, /^[01]{15}$/, k);
  for (const a of IDS) assert.match(COLORS[a], /^#[0-9a-f]{6}$/);
});

test('Habitat hooks: sidebar entry, pixelated canvas, paused when hidden, reduced-motion setting kept', () => {
  const hab = readFileSync(new URL('../src/habitat.mjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  assert.match(hab, /if \(document\.hidden\) return;/);
  assert.match(hab, /requestAnimationFrame/);
  assert.doesNotMatch(hab, /https?:\/\/|fetch\(|new Image\(/, 'no network or external assets');
  assert.match(main, /reduceMotion: s\.reduceMotion === true,/);
  assert.match(main, /if \('reduceMotion' in patch\) s\.reduceMotion = patch\.reduceMotion === true;/);
});

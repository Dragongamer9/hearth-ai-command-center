import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWorld, behaviourOf, findPath, passable, newActor, stepActor, deskOf, roomOf, newPet, stepPet, kitchenSpot, T } from '../src/habitat/world.mjs';
import {
  lightAt, weatherFor, weatherAt, emptyStore, migrateStore, reconcile, resetStore, gardenState, gardenCap, GARDEN_STAGES,
  unlockedCount, UNLOCK_EVERY, PROP_POOL, applyUnlocks, canPlace, layoutOf, moodOf, deskLight, opsCi, visitsFrom, effectFor,
  busiestAi, warmestRug, petGoal, boardNotes, noteText, walkableTiles, roomLocal,
} from '../src/habitat/life.mjs';
import { PET, ICONS2 } from '../src/habitat/sprites.mjs';
import { AGENT_IDS } from '../src/registry.mjs';

const IDS = [...AGENT_IDS, 'copilot', 'meta'];
const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const at = (h, m = 0, d = new Date(2026, 10, 2)) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
const NOW = at(12).getTime();
const task = (id, o = {}) => ({ id, title: `Task ${id}`, stage: 'implementing', assignee: 'anthropic', reviewer: 'google', tests: '', ci: '', runs: [], updatedAt: new Date(NOW - 3600e3).toISOString(), ...o });

test('day and night follow the local clock: tint, lamps and stars', () => {
  assert.equal(lightAt(at(23)).phase, 'night');
  assert.equal(lightAt(at(3)).phase, 'night');
  assert.equal(lightAt(at(6)).phase, 'dawn');
  assert.equal(lightAt(at(12)).phase, 'day');
  assert.equal(lightAt(at(19)).phase, 'dusk');
  const night = lightAt(at(22, 30));
  assert.ok(night.lamps && night.stars && night.tint);
  const day = lightAt(at(10));
  assert.equal(day.lamps, false); assert.equal(day.stars, false); assert.equal(day.tint, null);
  // Light themes get a gentler tint; same phase.
  const a = Number(lightAt(at(23), { dark: true }).tint.match(/,([\d.]+)\)$/)[1]);
  const b = Number(lightAt(at(23), { dark: false }).tint.match(/,([\d.]+)\)$/)[1]);
  assert.ok(b < a);
  // Stepwise, never in between: the same minute always gives the same lighting.
  assert.deepEqual(lightAt(at(20, 15)), lightAt(at(20, 15)));
});

test('weather is deterministic per day, occasional, and off with reduced motion', () => {
  const days = Array.from({ length: 120 }, (_, i) => new Date(2026, 0, 1 + i, 12));
  for (const d of days) assert.deepEqual(weatherFor(d), weatherFor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 3)), 'same weather all day');
  const wet = days.filter((d) => weatherFor(d).kind !== 'clear').length;
  assert.ok(wet > 5 && wet < 70, `occasional (${wet} of 120 days)`);
  const w = days.map(weatherFor).find((x) => x.kind !== 'clear');
  assert.ok(w.from >= 6 && w.to > w.from && w.to <= 24);
  for (const d of days) {
    const f = weatherFor(d);
    if (f.kind === 'clear') continue;
    const inside = new Date(d.getFullYear(), d.getMonth(), d.getDate(), f.from);
    assert.equal(weatherAt(inside), f.kind);
    assert.equal(weatherAt(inside, { reduced: true }), 'clear', 'reduced motion: no weather');
    assert.equal(weatherAt(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 2)), 'clear', 'only for a few hours');
  }
  assert.ok(days.filter((d) => d.getMonth() >= 2).every((d) => weatherFor(d).kind !== 'snow'), 'no snow in spring');
});

test('garden grows one stage per finished task, is capped, wilts on repeated failures and recovers', () => {
  let s = emptyStore();
  const tasks = Array.from({ length: 5 }, (_, i) => task(`T${i}`));
  s = reconcile(s, tasks, NOW).store;
  assert.equal(s.growth, 0);
  tasks[0].stage = 'approved'; tasks[1].stage = 'approved';
  s = reconcile(s, tasks, NOW).store;
  assert.equal(s.finished, 2); assert.equal(s.growth, 2);
  assert.deepEqual(gardenState(s).stages.filter((x) => x > 0).length, 2);
  // Counting is idempotent: the same tasks again change nothing.
  const again = reconcile(s, tasks, NOW);
  assert.equal(again.changed, false); assert.equal(again.store.finished, 2);
  // Capped.
  const many = Array.from({ length: gardenCap() + 20 }, (_, i) => task(`M${i}`, { stage: 'approved' }));
  const big = reconcile(s, many, NOW).store;
  assert.equal(big.growth, gardenCap());
  assert.ok(big.finished > gardenCap());
  assert.ok(gardenState(big).stages.every((x) => x === GARDEN_STAGES));
  // Wilts after repeated failed tests or CI, recovers on a pass.
  tasks[2].tests = 'failed'; s = reconcile(s, tasks, NOW).store;
  assert.equal(gardenState(s).wilt, 0, 'one failure is not enough');
  tasks[3].ci = 'failed'; s = reconcile(s, tasks, NOW).store;
  assert.equal(gardenState(s).wilt, 1);
  tasks[4].tests = 'failed'; tasks[3].tests = 'failed'; s = reconcile(s, tasks, NOW).store;
  assert.equal(gardenState(s).wilt, 2);
  assert.equal(s.growth, 2, 'wilting never removes growth');
  tasks[2].tests = 'passed'; s = reconcile(s, tasks, NOW).store;
  assert.equal(gardenState(s).wilt, 0, 'recovers when fixed');
});

test('a never-seen task is a baseline: history adds growth but no penalties', () => {
  const s = reconcile(emptyStore(), [task('A', { stage: 'approved' }), task('B', { tests: 'failed' }), task('C', { assignee: 'openai', runs: [{ a: 'anthropic', s: 'limit' }] })], NOW).store;
  assert.equal(s.finished, 1);
  assert.equal(s.failStreak, 0);
  assert.equal(s.ai.anthropic.fails || 0, 0);
  assert.equal(s.ai.anthropic.handoffs || 0, 0);
});

test('unlock thresholds: a new prop every N tasks, placed once, saved per AI, never moving by itself', () => {
  assert.equal(unlockedCount(0), 0);
  assert.equal(unlockedCount(UNLOCK_EVERY - 1), 0);
  assert.equal(unlockedCount(UNLOCK_EVERY), 1);
  assert.equal(unlockedCount(UNLOCK_EVERY * 3 + 2), 3);
  assert.equal(unlockedCount(10000), PROP_POOL.length);
  const w = buildWorld(IDS.slice(0, 4));
  const id = w.rooms[0].id;
  let s = emptyStore();
  s.ai[id] = { done: UNLOCK_EVERY * 2 };
  const u = applyUnlocks(s, w);
  assert.ok(u.changed);
  const props = u.store.ai[id].props;
  assert.equal(props.length, 2);
  assert.notEqual(props[0].kind, props[1].kind);
  for (const p of props) assert.ok(PROP_POOL.includes(p.kind));
  // Applying again changes nothing; the props keep their places.
  const again = applyUnlocks(u.store, w);
  assert.equal(again.changed, false);
  assert.deepEqual(again.store.ai[id].props, props);
  // Placed on the world grid as blocking props, and the room stays walkable.
  const w2 = buildWorld(IDS.slice(0, 4), layoutOf(u.store));
  const room = roomOf(w2, id);
  assert.equal(room.extras.length, 2);
  for (const e of room.extras) assert.equal(w2.grid[e.y][e.x], T.PROP);
  for (const sp of room.spots) assert.ok(findPath(w2, deskOf(w2, id).seat, sp, { who: id }), 'every free tile reachable');
});

test('rearranging: only free tiles that keep the room connected', () => {
  const w = buildWorld(IDS.slice(0, 2));
  const room = w.rooms[0];
  const props = [{ kind: 'fern', x: 1, y: 0 }];
  const door = { x: 2, y: 3 };
  assert.equal(canPlace(room, props, 0, door.x, door.y), false, 'not in front of the door');
  for (const p of room.props) { const l = roomLocal(room, p); assert.equal(canPlace(room, props, 0, l.x, l.y), false, 'not on furniture'); }
  const rug = roomLocal(room, room.rugSpot);
  assert.equal(canPlace(room, props, 0, rug.x, rug.y), false, 'not on the rug spot');
  assert.equal(canPlace(room, props, 0, 9, 0), false, 'not outside the room');
  // Find any legal move and check the room is still fully reachable after it.
  let moved = null;
  for (let y = 0; y < 4 && !moved; y++) for (let x = 0; x < 6 && !moved; x++) if (canPlace(room, props, 0, x, y) && !(x === 1 && y === 0)) moved = { x, y };
  assert.ok(moved);
  const w2 = buildWorld(IDS.slice(0, 2), { [room.id]: [{ kind: 'fern', ...moved }] });
  const r2 = roomOf(w2, room.id);
  assert.equal(r2.extras[0].lx, moved.x);
  for (const sp of r2.spots) assert.ok(findPath(w2, r2.door, sp, { who: room.id }));
  // A saved spot that no longer fits is not drawn, but the saved data is untouched.
  const bad = { [room.id]: [{ kind: 'fern', x: 2, y: 3 }] };
  assert.equal(roomOf(buildWorld(IDS.slice(0, 2), bad), room.id).extras.length, 0);
  assert.deepEqual(bad[room.id][0], { kind: 'fern', x: 2, y: 3 });
});

test('visits are generated from real state transitions', () => {
  const a = [task('V1', { stage: 'implementing' }), task('V2', { stage: 'review' }), task('V3', { stage: 'implementing', assignee: 'openai' })];
  const b = [task('V1', { stage: 'review' }), task('V2', { stage: 'approved' }), task('V3', { stage: 'implementing', assignee: 'xai' })];
  const ev = visitsFrom(a, b);
  assert.deepEqual(ev.find((e) => e.kind === 'review-visit'), { kind: 'review-visit', from: 'anthropic', to: 'google', task: 'V1' });
  assert.deepEqual(ev.find((e) => e.kind === 'stamp'), { kind: 'stamp', who: 'anthropic', task: 'V2' });
  assert.deepEqual(ev.find((e) => e.kind === 'coffee'), { kind: 'coffee', who: 'anthropic', task: 'V2' }, 'a finished AI may go for a coffee');
  assert.deepEqual(ev.find((e) => e.kind === 'handover'), { kind: 'handover', from: 'openai', to: 'xai', task: 'V3' });
  assert.deepEqual(visitsFrom(b, b), [], 'nothing happens by itself');
  assert.deepEqual(visitsFrom([], b), [], 'new tasks are not visits');
});

test('reduced motion disables wandering, coffee walks, weather and visit animations', () => {
  for (const kind of ['review-visit', 'stamp', 'handover', 'coffee']) {
    const r = effectFor({ kind }, { reduced: true });
    assert.ok(!r.walk && !r.anim && !r.fly, `${kind} is still with reduced motion`);
  }
  assert.equal(effectFor({ kind: 'review-visit', to: 'google' }, { reduced: true }).paperAt, 'google', 'the paper still lands on the desk');
  assert.ok(effectFor({ kind: 'review-visit' }).walk);
  const w = buildWorld(IDS.slice(0, 4));
  const id = w.rooms[0].id;
  const a = newActor(w, id, behaviourOf({}));
  a.errand = { to: { x: deskOf(w, w.rooms[1].id).seat.x + 1, y: deskOf(w, w.rooms[1].id).seat.y }, task: 'X', deskOf: w.rooms[1].id };
  a.coffeeNext = true;
  for (let i = 0; i < 50; i++) stepActor(w, a, behaviourOf({}), 0.5, { reduced: true, social: true, rng: seeded(2) });
  assert.deepEqual({ x: a.x, y: a.y }, w.rooms[0].rugSpot, 'no walking with reduced motion');
  assert.ok(a.delivered, 'the visit completes at once');
  assert.equal(a.coffeeNext, false);
  const pet = newPet(w, petGoal(w, {}));
  pet.x = 1; pet.y = 7;
  const goal = petGoal(w, {});
  stepPet(w, pet, goal, 0.1, { reduced: true });
  assert.deepEqual({ x: pet.x, y: pet.y }, goal.spot, 'the pet snaps to its spot');
});

test('a builder walks to the reviewer and delivers the paper; idle AIs take coffee breaks in pairs', () => {
  const w = buildWorld(IDS.slice(0, 4));
  const [r0, r1] = w.rooms;
  const a = newActor(w, r0.id, behaviourOf({}));
  const target = { x: deskOf(w, r1.id).seat.x + 1, y: deskOf(w, r1.id).seat.y };
  a.errand = { to: target, task: 'V1', deskOf: r1.id };
  const rng = seeded(4);
  for (let i = 0; i < 600 && !a.delivered; i++) stepActor(w, a, behaviourOf({}), 0.05, { rng, social: true });
  assert.ok(a.delivered, 'delivered');
  assert.deepEqual({ x: a.x, y: a.y }, target);
  // Starting work drops the errand but still delivers.
  const b = newActor(w, r1.id, behaviourOf({}));
  b.errand = { to: target, task: 'V2', deskOf: r0.id };
  stepActor(w, b, behaviourOf({ task: { id: 'Z' } }), 0.05, { rng });
  assert.ok(b.delivered && !b.errand);
  // Coffee: the second AI stands next to the first.
  const first = kitchenSpot(w);
  const second = kitchenSpot(w, new Set([`${first.x},${first.y}`]));
  assert.equal(Math.abs(first.x - second.x) + Math.abs(first.y - second.y), 1);
  const c = newActor(w, r0.id, behaviourOf({}));
  let visited = false;
  for (let i = 0; i < 6000 && !visited; i++) {
    stepActor(w, c, behaviourOf({}), 0.1, { rng, social: true });
    if (c.goal === 'coffee' && !c.path.length) visited = true;
  }
  assert.ok(visited, 'idle AIs sometimes walk to the break room');
  // After finishing a task, an AI may head for the coffee first.
  const d = newActor(w, r0.id, behaviourOf({ task: { id: 'Q' } }));
  d.coffeeNext = true;
  stepActor(w, d, behaviourOf({}), 0.05, { rng, social: true });
  assert.equal(d.goal, 'coffee');
});

test('mood comes only from real counters', () => {
  assert.equal(moodOf(undefined), null);
  assert.equal(moodOf({ fails: 0, handoffs: 0 }), null);
  assert.equal(moodOf({ fails: 1 }), null);
  assert.equal(moodOf({ fails: 2 }), 'tired');
  assert.equal(moodOf({ handoffs: 2 }), 'tired');
  assert.equal(moodOf({ lastApproval: new Date(NOW - 3600e3).toISOString() }, NOW), 'pleased');
  assert.equal(moodOf({ lastApproval: new Date(NOW - 20 * 3600e3).toISOString() }, NOW), null, 'fades after 12 hours');
  // From real events: failures on its tasks, hand-offs after a limit, approvals.
  let s = reconcile(emptyStore(), [task('A'), task('B'), task('C', { assignee: 'openai' })], NOW).store;
  s = reconcile(s, [task('A', { tests: 'failed' }), task('B', { ci: 'failed' }), task('C', { assignee: 'openai' })], NOW).store;
  assert.equal(moodOf(s.ai.anthropic, NOW), 'tired');
  s = reconcile(s, [task('A', { tests: 'passed' }), task('B', { ci: 'failed' }), task('C', { assignee: 'xai', runs: [{ a: 'openai', s: 'limit' }, { a: 'xai', s: 'running' }] })], NOW).store;
  assert.equal(s.ai.anthropic.fails, 0, 'a pass resets the streak');
  assert.equal(s.ai.openai.handoffs, 1);
  s = reconcile(s, [task('A', { stage: 'approved', tests: 'passed', updatedAt: new Date(NOW - 60e3).toISOString() })], NOW).store;
  assert.equal(moodOf(s.ai.anthropic, NOW), 'pleased');
  // A hand-off by the owner (no limit or crash) doesn't make anyone tired.
  const t0 = reconcile(emptyStore(), [task('H', { assignee: 'openai' })], NOW).store;
  const t1 = reconcile(t0, [task('H', { assignee: 'google', runs: [{ a: 'openai', s: 'done' }] })], NOW).store;
  assert.equal(t1.ai.openai?.handoffs || 0, 0);
});

test('desk status light: red for failing tests or CI, amber while running, green when passing', () => {
  assert.equal(deskLight(null), null);
  assert.equal(deskLight({ tests: 'passed' }), 'green');
  assert.equal(deskLight({ running: true }), 'amber');
  assert.equal(deskLight({ running: true, tests: 'passed' }), 'amber');
  assert.equal(deskLight({ running: true, tests: 'failed' }), 'red');
  assert.equal(deskLight({ ci: 'failed', tests: 'passed' }), 'red');
  assert.equal(deskLight({ ci: 'pending' }), 'amber');
  assert.equal(deskLight({}), null);
  // snap.ops is optional and read defensively.
  assert.equal(opsCi(null, 'A'), '');
  assert.equal(opsCi({}, 'A'), '');
  assert.equal(opsCi({ ci: { A: 'failure' } }, 'A'), 'failed');
  assert.equal(opsCi({ tasks: { A: { ci: { state: 'success' } } } }, 'A'), 'passed');
  assert.equal(opsCi({ ci: [{ taskId: 'A', status: 'in_progress' }] }, 'A'), 'pending');
});

test('trophies and achievements: earned from real milestones, kept for good', () => {
  let s = reconcile(emptyStore(), [], NOW).store;
  assert.deepEqual(s.trophies, {});
  const tasks = Array.from({ length: 10 }, (_, i) => task(`D${i}`, { stage: 'approved', merged: i === 0 }));
  s = reconcile(s, tasks, NOW).store;
  assert.ok(s.trophies['first-merge']); assert.ok(s.trophies['done-10']); assert.ok(!s.trophies['done-50']);
  assert.ok(s.ai.anthropic.ach['first-task'] && s.ai.anthropic.ach['five-tasks'] && s.ai.anthropic.ach.approved);
  // A week later with no failures: the clean-week trophy.
  const later = reconcile(s, tasks, NOW + 8 * 864e5).store;
  assert.ok(later.trophies['clean-week']);
  // A failure restarts the clean week, but trophies already earned stay.
  const f = reconcile(later, [...tasks, task('F')], NOW + 8 * 864e5).store;
  const g = reconcile(f, [...tasks, task('F', { tests: 'failed' })], NOW + 8 * 864e5).store;
  assert.ok(g.trophies['clean-week']);
  assert.equal(g.cleanSince, new Date(NOW + 8 * 864e5).toISOString());
  // Deleting tasks never takes progress away.
  const h = reconcile(g, [], NOW + 9 * 864e5).store;
  assert.equal(h.finished, 10); assert.ok(h.trophies['done-10']);
});

test('persistence: round-trip, migration of missing or broken saves, owner reset', () => {
  let s = reconcile(emptyStore(), [task('A', { stage: 'approved' })], NOW).store;
  s.pet.name = 'Ember';
  s.ai.anthropic.props = [{ kind: 'fern', x: 1, y: 0 }];
  const back = migrateStore(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back, s, 'round-trip through JSON is lossless');
  for (const raw of [undefined, null, 42, 'x', [], {}]) {
    const m = migrateStore(raw);
    assert.deepEqual(m, emptyStore(), `clean store from ${JSON.stringify(raw)}`);
  }
  const broken = migrateStore({ finished: '7', growth: 999, counted: ['A', 3], pet: { name: 5 }, trophies: { 'done-10': 'nope', bogus: new Date().toISOString() }, ai: { anthropic: { done: -3, props: [{ kind: 'sword', x: 1, y: 1 }, { kind: 'fern', x: 99, y: -1 }] } } });
  assert.equal(broken.finished, 7);
  assert.equal(broken.growth, 7, 'growth never exceeds finished');
  assert.deepEqual(broken.counted, ['A']);
  assert.equal(broken.pet.name, '');
  assert.deepEqual(broken.trophies, {});
  assert.equal(broken.ai.anthropic.done, 0);
  assert.deepEqual(broken.ai.anthropic.props, [{ kind: 'fern', x: 5, y: 0 }], 'unknown props dropped, positions clamped');
  // Reset: empty progress, and today's tasks are a baseline (nothing regrows from history).
  const tasks = [task('A', { stage: 'approved', merged: true }), task('B')];
  const r = resetStore(tasks, NOW);
  const after = reconcile(r, tasks, NOW);
  assert.equal(after.changed, false);
  assert.equal(after.store.finished, 0); assert.equal(after.store.pet.name, ''); assert.deepEqual(after.store.trophies, {});
  // Saved progress never changes by itself: re-running on the same state is a no-op.
  const x = reconcile(s, [task('A', { stage: 'approved' })], NOW + 3600e3);
  assert.equal(x.changed, false);
});

test('the pet follows the busiest AI and naps on the warmest rug', () => {
  const w = buildWorld(IDS.slice(0, 4));
  const agents = [{ id: 'anthropic', status: 'idle', task: { id: 'A' }, open: 2 }, { id: 'openai', status: 'idle', open: 1 }, { id: 'google', status: 'out', task: { id: 'B' }, open: 5 }];
  assert.equal(busiestAi(agents), 'anthropic');
  assert.equal(busiestAi([{ id: 'x', status: 'idle', open: 1 }]), null, 'nobody busy');
  const g = petGoal(w, { busiest: w.rooms[0].id });
  assert.equal(g.pose, 'sit');
  assert.ok(passable(w, g.spot.x, g.spot.y), 'sits on a floor tile beside the desk');
  const day = warmestRug(w, { lamps: false });
  assert.equal(day.where, 'kitchen', 'the kitchen rug by the heater');
  const night = warmestRug(w, { lamps: true });
  assert.ok(roomOf(w, night.where).props.some((p) => p.kind === 'lamp'), 'a lamp-lit room at night');
  const closed = new Set(w.rooms.map((r) => r.id));
  assert.equal(warmestRug(w, { lamps: true, closed }).where, 'kitchen', 'never behind a closed door');
  const nap = petGoal(w, {});
  assert.equal(nap.pose, 'nap');
  const pet = newPet(w, { spot: { x: 1, y: 7 }, pose: 'nap' });
  const rng = seeded(9);
  for (let i = 0; i < 800 && (pet.x !== nap.spot.x || pet.y !== nap.spot.y); i++) stepPet(w, pet, nap, 0.05, { rng });
  assert.deepEqual({ x: pet.x, y: pet.y }, nap.spot);
});

test('message board: last 3 chat headlines (or task titles), pixel-safe and truncated', () => {
  const chat = [{ id: 'C1', who: 'owner', text: 'Old' }, { id: 'C2', who: 'system', text: 'System note' }, { id: 'C3', who: 'anthropic', text: 'Storage page done. Tests pass.' }, { id: 'C4', who: 'google', text: '**GRUB** theme format checked' }];
  const n = boardNotes(chat, []);
  assert.deepEqual(n.map((x) => x.id), ['C4', 'C3', 'C1']);
  assert.equal(n[1].text, 'Storage page done.');
  assert.equal(n[0].text, 'GRUB theme format checked');
  const t = boardNotes([], [task('A', { updatedAt: '2026-01-01T00:00:00Z' }), task('B', { updatedAt: '2026-02-01T00:00:00Z' })]);
  assert.deepEqual(t.map((x) => [x.kind, x.id]), [['task', 'B'], ['task', 'A']]);
  assert.equal(noteText('Fix Wi-Fi list ✓ after resume', 12), 'FIX WI-FI L.');
  assert.match(noteText('ünïcødé & stuff!'), /^[A-Z0-9 .-]*$/);
});

test('every new walkable area (break room, hall, courtyard) is reachable by BFS', () => {
  for (const n of [1, 2, 5, 8, 12]) {
    const w = buildWorld(IDS.slice(0, n));
    const from = deskOf(w, w.rooms[0].id).seat;
    const tiles = walkableTiles(w);
    const inArea = (a, t) => t.x >= a.x0 && t.x < a.x0 + a.w && t.y >= a.y0 && t.y < a.y0 + a.h;
    assert.ok(tiles.some((t) => inArea(w.kitchen, t)) && tiles.some((t) => inArea(w.courtyard, t)));
    for (const t of tiles) assert.ok(findPath(w, from, t, { who: w.rooms[0].id }) || (t.x === from.x && t.y === from.y), `${n} AIs: ${t.x},${t.y} reachable`);
    for (const s of [...w.kitchen.spots, w.kitchen.coffeeSpot, w.kitchen.rugSpot]) assert.equal(w.grid[s.y][s.x], T.KITCHEN);
    assert.equal(w.courtyard.beds.length, 15);
    for (const b of w.courtyard.beds) assert.equal(w.grid[b.y][b.x], T.GARDEN);
    // Desks, rooms and walls still where the original tests expect them.
    for (let x = 0; x < w.w; x++) { assert.equal(w.grid[0][x], T.WALL); assert.equal(w.grid[w.h - 1][x], T.WALL); }
  }
});

test('pet and new icons are well formed; Habitat stays offline and saves through the app state', () => {
  for (const f of [PET.sit, PET.nap, ...PET.walk]) { assert.equal(f.length, 10); for (const r of f) assert.equal(r.length, 12); }
  for (const [k, rows] of Object.entries(ICONS2)) for (const r of rows) assert.equal(r.length, rows[0].length, k);
  const hab = readFileSync(new URL('../src/habitat.mjs', import.meta.url), 'utf8');
  const life = readFileSync(new URL('../src/habitat/life.mjs', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  for (const src of [hab, life]) assert.doesNotMatch(src, /https?:\/\/|fetch\(|new Image\(|localStorage/, 'no network, no external assets, no side storage');
  assert.doesNotMatch(life, /Math\.random/, 'no random judgement in the saved progress or moods');
  assert.match(ui, /saveStore: \(h\) => \{ state\.habitat = h; save\(\); \}/);
  assert.match(ui, /store: state\.habitat \|\| null/);
  assert.match(ui, /ops: ops\.snapshot\(\),/, 'the Habitat reads opsSnapshot() through ops.snapshot()');
  assert.match(hab, /Reset Habitat progress/);
});

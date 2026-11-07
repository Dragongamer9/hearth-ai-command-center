// 2.4 castle city: the pure mappings behind the 3D Habitat (src/habitat3d/castlemap.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, MAX_AIS } from '../src/habitat/world.mjs';
import { emptyStore, migrateStore } from '../src/habitat/life.mjs';
import { normPrefs, withPref, presets, cityBounds, inBounds } from '../src/habitat3d/map.mjs';
import {
  zoneOf, castleLayout, place3D, routeBetween, pathLength, alongPath, placeOf, timeOfDay, TIMES, CHAMBERS_Y,
  ROSTER, normChar, normCharacters, withCharacter, charFor, randomChar, OWNER_DEFAULT, HAIR, ACCESSORIES,
  townsfolk, folkAt, guards, guardAt, folkCount, guardCount, townHouses,
  normRaids, raidTimes, raidAt, planRaid, raidState, addRaidWins, RAID_LEN, RAID_FREQ,
} from '../src/habitat3d/castlemap.mjs';
import { AGENT_IDS } from '../src/registry.mjs';

const IDS = [...AGENT_IDS, 'copilot', 'meta'];

test('every AI gets its own house, labelled by id, all different, for 1 to 12 AIs', () => {
  for (let n = 1; n <= MAX_AIS; n++) {
    const ids = IDS.slice(0, n); const w = buildWorld(ids); const L = castleLayout(w);
    assert.deepEqual(Object.keys(L.houses).sort(), [...ids].sort());
    const spots = new Set(Object.values(L.houses).map((h) => `${h.x},${h.z}`));
    assert.equal(spots.size, n, 'no two AIs share a house');
    for (const h of Object.values(L.houses)) assert.ok(inBounds(cityBounds(w), h), 'house inside the city');
  }
});

test('room tiles go to that AI’s house, the study to the King’s Chambers, the rest stays in the keep', () => {
  const w = buildWorld(IDS.slice(0, 8)); const L = castleLayout(w);
  for (const r of w.rooms) {
    for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) {
      assert.deepEqual(zoneOf(w, x, y), { kind: 'house', id: r.id });
      const p = place3D(w, x, y, L); const H = L.houses[r.id];
      assert.ok(Math.hypot(p.x - H.x, p.z - H.z) < 8, `${r.id} tile ${x},${y} lands at its house`);
    }
  }
  const s = place3D(w, -4, 6, L);
  assert.equal(s.zone.kind, 'chambers'); assert.equal(s.y, CHAMBERS_Y);
  for (const d of w.desks) assert.equal(zoneOf(w, d.seat.x, d.seat.y).kind, 'keep', 'desks are in the great hall');
});

test('sim states map to castle places', () => {
  const w = buildWorld(IDS.slice(0, 3)); const r = w.rooms[0];
  assert.equal(placeOf({ mode: 'sleep' }, { x: r.x0 + 1, y: r.y0 + 1, pose: 'sleep' }, w), 'home-asleep');
  assert.equal(placeOf({ mode: 'idle' }, { x: r.x0 + 1, y: r.y0 + 1 }, w), 'home');
  const d = w.desks[0];
  assert.equal(placeOf({ mode: 'desk' }, { x: d.seat.x, y: d.seat.y, mode: 'desk' }, w), 'great-hall-desk');
  assert.equal(placeOf({ mode: 'idle' }, { x: -3, y: 6 }, w), 'chambers');
});

test('a walk home goes through town and has a sensible length', () => {
  const w = buildWorld(IDS.slice(0, 4)); const L = castleLayout(w);
  const r = w.rooms[0]; const d = w.desks[0];
  const a = place3D(w, d.seat.x, d.seat.y, L); const b = place3D(w, r.x0 + 2, r.y0 + 2, L);
  const pts = routeBetween(w, zoneOf(w, d.seat.x, d.seat.y), zoneOf(w, r.x0 + 2, r.y0 + 2), a, b, L);
  assert.ok(pts.length >= 3);
  const len = pathLength(pts);
  assert.ok(len >= Math.hypot(b.x - a.x, b.z - a.z) - 1e-6);
  const mid = alongPath(pts, len / 2); assert.ok(Number.isFinite(mid.x) && Number.isFinite(mid.z) && Number.isFinite(mid.yaw));
  const end = alongPath(pts, len + 5); assert.ok(Math.abs(end.x - b.x) < 1e-6 && Math.abs(end.z - b.z) < 1e-6);
});

test('time of day follows the clock unless set by hand', () => {
  assert.deepEqual(TIMES, ['auto', 'day', 'sunset', 'night']);
  assert.equal(timeOfDay('auto', 'night'), 'night');
  assert.equal(timeOfDay('auto', 'day'), 'day');
  assert.equal(timeOfDay('day', 'night'), 'day');
  assert.equal(timeOfDay('sunset', 'day'), 'dusk');
  assert.equal(timeOfDay('night', 'day'), 'night');
  assert.equal(normPrefs({}).time, 'auto');
  assert.equal(normPrefs({ time: 'bogus' }).time, 'auto');
  assert.equal(withPref(normPrefs({}), 'time', 'night').time, 'night');
});

test('characters: 12 originals, round-trip through saving, defaults never saved', () => {
  assert.equal(ROSTER.length, 12);
  assert.deepEqual(ROSTER.map((r) => r.name), ['Ren', 'Kaede', 'Miko', 'Sable', 'Tomo', 'Juno', 'Hoshi', 'Riku', 'Nao', 'Lumi', 'Aster', 'Pip']);
  for (const r of ROSTER) { const c = normChar(r); assert.ok(HAIR.includes(c.hair) && ACCESSORIES.includes(c.accessory)); }
  // nothing saved: everyone gets a default, but nothing is written
  const empty = normPrefs({});
  assert.deepEqual(empty.characters, { owner: null, ai: {} });
  assert.equal(charFor(empty.characters, 'owner').name, OWNER_DEFAULT.name);
  assert.equal(charFor(empty.characters, IDS[1], IDS).name, ROSTER[1].name);
  // give Kaede to the first AI and make the owner's own; save, reload, same thing
  let p = withPref(empty, 'character', { who: IDS[0], spec: ROSTER[1] });
  p = withPref(p, 'character', { who: 'owner', spec: { name: 'My King', hair: 'spiky', accessory: 'glasses', hairColor: '#20242c' } });
  const reloaded = normPrefs(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(reloaded.characters, p.characters);
  assert.equal(charFor(reloaded.characters, IDS[0], IDS).name, 'Kaede');
  assert.equal(charFor(reloaded.characters, 'owner').hair, 'spiky');
  // other settings survive a character save (merge, not replace)
  const withLighter = withPref(normPrefs({ lighter: true, folk: false }), 'character', { who: 'owner', spec: ROSTER[0] });
  assert.equal(withLighter.lighter, true); assert.equal(withLighter.folk, false);
  // junk never crashes and never becomes markup
  const bad = normChar({ name: '<img src=x>', hair: 'mohawk', accessory: 'sword', hairColor: 'javascript:' });
  assert.ok(!/[<>]/.test(bad.name)); assert.ok(HAIR.includes(bad.hair)); assert.ok(ACCESSORIES.includes(bad.accessory)); assert.match(bad.hairColor, /^#[0-9a-f]{6}$/i);
  assert.deepEqual(normCharacters('garbage'), { owner: null, ai: {} });
  assert.deepEqual(withCharacter({}, '../evil', ROSTER[0]).ai, {});
  // Surprise me is repeatable for the same seed
  assert.deepEqual(randomChar(42), randomChar(42));
});

test('a saved settings file is never overwritten by defaults on load', () => {
  const saved = { lighter: true, time: 'night', folk: false, raids: { on: false, freq: 'often' }, characters: { owner: { name: 'Me', hair: 'bob' }, ai: { claude: ROSTER[3] } } };
  const p = normPrefs(JSON.parse(JSON.stringify(saved)));
  assert.equal(p.lighter, true); assert.equal(p.time, 'night'); assert.equal(p.folk, false);
  assert.equal(p.raids.on, false); assert.equal(p.raids.freq, 'often');
  assert.equal(p.characters.owner.name, 'Me'); assert.equal(p.characters.ai.claude.name, ROSTER[3].name);
  // a second pass changes nothing (idempotent), so saving after loading never drifts
  assert.deepEqual(normPrefs(JSON.parse(JSON.stringify(p))), p);
  // defaults: townsfolk on, raids unset (so Lighter 3D / reduced motion keep them off unless he turns them on)
  const d = normPrefs({});
  assert.equal(d.folk, true); assert.equal('on' in d.raids, false); assert.equal(d.raids.freq, 'sometimes');
  assert.deepEqual(normPrefs(JSON.parse(JSON.stringify(d))), d);
});

test('townsfolk and guards: seeded, capped, fewer in Lighter 3D, none when off', () => {
  assert.equal(folkCount({ on: false }), 0); assert.equal(guardCount({ on: false }), 0);
  assert.ok(folkCount({ on: true, lighter: true }) < folkCount({ on: true }));
  assert.ok(guardCount({ on: true, lighter: true }) < guardCount({ on: true }));
  assert.ok(folkCount({ on: true }) <= 40 && guardCount({ on: true }) <= 16);
  const w = buildWorld(IDS.slice(0, 8)); const L = castleLayout(w); const houses = townHouses(L);
  const a = townsfolk(L, houses, folkCount({ on: true })); const b = townsfolk(L, houses, folkCount({ on: true }));
  assert.deepEqual(a, b, 'same seed, same town');
  assert.ok(new Set(a.map((f) => f.kind)).size >= 4, 'a mix of merchants, children, cats and more');
  const day = a.filter((f) => folkAt(f, 100, 'day').visible).length; const night = a.filter((f) => folkAt(f, 100, 'night').visible).length;
  assert.ok(night < day, 'fewer people out at night');
  const g = guards(L, guardCount({ on: true }));
  assert.ok(g.some((x) => x.kind === 'post') && g.some((x) => x.wall), 'posts at the gates and patrols on the walls');
  assert.equal(guardAt(g[0], 10, 'night').torch, true); assert.equal(guardAt(g[0], 10, 'day').torch, false);
  for (const h of houses) assert.ok(Math.hypot(h.x - L.city.cx, h.z - L.city.cz) < L.city.r, 'town houses inside the city wall');
});

test('raids: default on/sometimes, off in Lighter 3D or reduced motion unless turned on', () => {
  assert.deepEqual(normRaids(undefined), { on: true, freq: 'sometimes', explicit: false });
  assert.equal(normRaids(undefined, { lighter: true }).on, false);
  assert.equal(normRaids(undefined, { reduced: true }).on, false);
  assert.equal(normRaids({ on: true }, { lighter: true }).on, true);
  assert.equal(normRaids({ on: false }).on, false);
  assert.equal(normRaids({ freq: 'often' }).freq, 'often');
  assert.equal(normRaids({ freq: 'always' }).freq, 'sometimes');
  assert.equal(withPref(normPrefs({}), 'raids', { on: false }).raids.on, false);
  assert.equal(withPref(withPref(normPrefs({}), 'raids', { freq: 'rare' }), 'raids', { on: true }).raids.freq, 'rare', 'merge, not replace');
});

test('raid schedule: seeded per day, a few a day, each about 1–2 minutes', () => {
  const day = new Date(2026, 10, 6).getTime();
  for (const f of Object.keys(RAID_FREQ)) {
    const t = raidTimes(day, f); assert.equal(t.length, RAID_FREQ[f]); assert.deepEqual(raidTimes(day, f), t);
    for (const x of t) { assert.ok(x >= day && x < day + 86400000); assert.equal(raidAt(x + 1000, day, f), x); }
  }
  assert.ok(RAID_LEN >= 60 && RAID_LEN <= 120);
  assert.equal(raidAt(day - 1, day, 'sometimes'), null);
});

test('raid plan: 4–8 raiders, never past the gate, all gone by the end, AIs credited', () => {
  const w = buildWorld(IDS.slice(0, 4)); const L = castleLayout(w);
  for (let seed = 1; seed < 40; seed++) {
    const plan = planRaid(seed, L, ['claude', 'codex']);
    assert.ok(plan.raiders.length >= 4 && plan.raiders.length <= 8);
    assert.deepEqual(planRaid(seed, L, ['claude', 'codex']), plan, 'seeded');
    for (let s = 0; s <= RAID_LEN; s += 2.5) {
      const st = raidState(plan, s);
      for (const x of st.raiders) if (x.visible) assert.ok(x.z >= L.gate.z + 1, `raider stays outside the gate (seed ${seed}, ${s}s)`);
      for (const x of st.raiders) assert.ok(x.hp >= 0 && x.hp <= 100);
    }
    const end = raidState(plan, RAID_LEN);
    assert.ok(end.done); assert.equal(end.raiders.filter((x) => x.visible).length, 0);
    const total = Object.values(plan.credit).reduce((a, b) => a + b, 0);
    assert.ok(total <= plan.raiders.length);
    for (const id of Object.keys(plan.credit)) assert.ok(['claude', 'codex'].includes(id));
  }
  assert.deepEqual(planRaid(3, L, []).credit, {}, 'no AIs on a break, no credit');
});

test('raiders-defeated tally: only counts up, survives a reload, never reset by itself', () => {
  let r = addRaidWins({}, { claude: 2 });
  r = addRaidWins(r, { claude: 1, codex: 3, '../x': 9, gemini: -4, meta: 1.5 });
  assert.deepEqual(r, { claude: 3, codex: 3 });
  const s = emptyStore(); assert.deepEqual(s.raids, {});
  s.raids = r;
  const back = migrateStore(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back.raids, { claude: 3, codex: 3 });
  assert.deepEqual(migrateStore({ ...s, raids: 'junk' }).raids, {});
  assert.deepEqual(migrateStore({}).raids, {}, 'an old store without raids loads fine');
});

test('camera presets: the castle views and one house per AI', () => {
  const w = buildWorld(IDS.slice(0, 5)); const ps = presets(w, {});
  for (const id of ['lodge', 'great', 'chambers', 'market', 'gate']) assert.ok(ps.some((p) => p.id === id), id);
  assert.equal(ps.find((p) => p.id === 'chambers').label, 'King’s Chambers');
  assert.equal(ps.filter((p) => p.id.startsWith('room:')).length, 5);
});

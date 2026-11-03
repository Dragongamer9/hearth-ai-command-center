import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, roomOf, stepActor, newActor, behaviourOf } from '../src/habitat/world.mjs';
import { migrateStore, reconcile, resetStore, gardenState, applyUnlocks, layoutOf, boardNotes, JOURNAL_MAX, canPlace } from '../src/habitat/life.mjs';
import {
  parseHabitatLines, stripHabitatLines, applyHabitatLines, undoLast, setLock, freeOwnerProps, clearBoard, clearJournal,
  habitatSection, habitatSummary, describeRoom, habitatResultsHtml, MAX_PER_TURN, MAX_PER_HOUR, SUMMARY_MAX,
} from '../src/habitat/actions.mjs';

const IDS = ['anthropic', 'google', 'openai', 'xai'];
const NAMES = { anthropic: 'Claude', google: 'Gemini', openai: 'ChatGPT', xai: 'Grok', ollama: 'Local AI' };
const NOW = new Date(2026, 10, 2, 12).getTime();
const idle = (id, o = {}) => ({ id, status: 'idle', task: null, reviewing: null, ...o });
const AGENTS = IDS.map((id) => idle(id));
// Claude has finished 12 tasks: two props unlocked, one of them put away.
const base = () => {
  const world = buildWorld(IDS, {});
  const s = applyUnlocks(migrateStore({ ai: { anthropic: { done: 12 }, google: { done: 3 } } }), world).store;
  const k = s.ai.anthropic.props.pop().kind;
  s.ai.anthropic.stored.push(k);
  return { s, stored: k, placed: s.ai.anthropic.props[0].kind };
};
const run = (store, text, o = {}) => applyHabitatLines(store, { agent: 'anthropic', text, ids: IDS, agents: AGENTS, names: NAMES, now: NOW, ...o });
const esc = (x) => String(x).replace(/[&<>"]/g, '');

test('parsing: every HABITAT line, bullets and case tolerated, others ignored', () => {
  const p = parseHabitatLines('Sure.\n- HABITAT: look\n**HABITAT: place lamp at 4,1**\nhabitat: move fern to 1, 2\nHABITAT: remove teapot\nHABITAT: nameplate Claude\'s den\nHABITAT: rug round\nHABITAT: lamp off\nHABITAT: go break room\nHABITAT: coffee with @grok\nHABITAT: water garden\nHABITAT: pet\nHABITAT: note Storage page done\nHABITAT: wave @gemini\nHABITAT: emote celebrate\nHABITAT: journal kept the door clear\nHABITAT: dance');
  assert.deepEqual(p.map((c) => c.cmd), ['look', 'place', 'move', 'remove', 'nameplate', 'rug', 'lamp', 'go', 'coffee', 'water', 'pet', 'note', 'wave', 'emote', 'journal', 'unknown']);
  assert.deepEqual([p[1].prop, p[1].x, p[1].y], ['lamp', 4, 1]);
  assert.deepEqual([p[2].x, p[2].y], [1, 2]);
  assert.equal(p[7].place, 'break room');
  assert.equal(p[8].with, 'grok');
  assert.equal(p[6].on, false);
  assert.equal(stripHabitatLines('Hi\nHABITAT: look\n- HABITAT: pet\nbye'), 'Hi\nbye');
  assert.equal(run(null, 'no actions here').results.length, 0);
});

test('place, move and remove: own room only, unlocked props only, walkable spots only', () => {
  const { s, stored, placed } = base();
  const room = roomOf(buildWorld(IDS, layoutOf(s)), 'anthropic');
  const spot = [[4, 1], [4, 2], [0, 1], [0, 2], [3, 3], [1, 3]].find(([x, y]) => canPlace(room, s.ai.anthropic.props, -1, x, y));
  let r = run(s, `HABITAT: place ${stored} at ${spot[0]},${spot[1]}`);
  assert.equal(r.results[0].ok, true, r.results[0].reason);
  assert.ok(r.store.ai.anthropic.props.some((p) => p.kind === stored && p.x === spot[0] && p.y === spot[1]));
  assert.ok(!r.store.ai.anthropic.stored.includes(stored));
  assert.match(r.audits[0].event, /^Claude placed an? \w+ in its room$/);
  // Not unlocked (and never another AI's props or room: commands only ever touch the writer's own room).
  const locked = ['fern', 'globe', 'radio', 'teapot', 'easel', 'fishbowl', 'cushion', 'lantern'].find((k) => k !== stored && k !== placed);
  r = run(r.store, `HABITAT: place ${locked} at 4,3`);
  assert.equal(r.results[0].ok, false); assert.match(r.results[0].reason, /not unlocked/);
  const g = run(base().s, `HABITAT: move ${placed} to 4,3`, { agent: 'google' });
  assert.equal(g.results[0].ok, false, 'Gemini cannot move Claude’s prop');
  assert.deepEqual(g.store.ai.anthropic.props, base().s.ai.anthropic.props);
  // Door tile, built-in furniture, the rug spot and outside the room are refused.
  for (const [x, y] of [[2, 3], [0, 0], [2, 1], [9, 9], [5, 0]]) {
    const q = run(s, `HABITAT: move ${placed} to ${x},${y}`);
    assert.equal(q.results[0].ok, false, `${x},${y}`);
  }
  // A spot that would wall off part of the room is refused (reuses canPlace).
  const block = run(s, `HABITAT: place ${stored} at 1,3`);
  const blockOk = canPlace(room, s.ai.anthropic.props, -1, 1, 3);
  assert.equal(block.results[0].ok, blockOk);
  // Remove keeps it unlocked.
  r = run(s, `HABITAT: remove ${placed}`);
  assert.equal(r.results[0].ok, true);
  assert.ok(r.store.ai.anthropic.stored.includes(placed));
  assert.equal(applyUnlocks(r.store, buildWorld(IDS, layoutOf(r.store))).changed, false, 'a put-away prop is not unlocked again');
});

test('nameplate, rug and lamp change only its own room; text is sanitised', () => {
  const r = run(base().s, 'HABITAT: nameplate <b>Claude\'s den</b> `x`\nHABITAT: rug diamond\nHABITAT: lamp on\nHABITAT: rug plaid');
  assert.deepEqual(r.results.map((x) => x.ok), [true, true, true, false]);
  const a = r.store.ai.anthropic;
  assert.equal(a.plate, 'Claude\'s den x');
  assert.ok(a.plate.length <= 24 && !/[<>`]/.test(a.plate));
  assert.equal(a.rug, 2); assert.equal(a.lamp, 'on');
  assert.equal(r.store.ai.google.plate, undefined);
  // Room 4 (index 4) has no lamp.
  const ids5 = [...IDS, 'mistral'];
  const n = applyHabitatLines(null, { agent: 'mistral', text: 'HABITAT: lamp on', ids: ids5, agents: [], names: NAMES, now: NOW });
  assert.equal(n.results[0].ok, false);
});

test('go and coffee: idle only; work always wins', () => {
  let r = run(base().s, 'HABITAT: go garden\nHABITAT: coffee with @grok');
  assert.deepEqual(r.results.map((x) => x.ok), [true, true]);
  assert.deepEqual(r.events.map((e) => [e.kind, e.place || e.with]), [['go', 'garden'], ['coffee', 'xai']]);
  assert.ok(r.store.journal.xai.some((e) => e.text === 'had coffee with Claude'));
  r = run(base().s, 'HABITAT: go hall', { agents: [idle('anthropic', { task: { id: 'T1' } }), ...AGENTS.slice(1)] });
  assert.equal(r.results[0].ok, false); assert.match(r.results[0].reason, /desk/);
  r = run(base().s, 'HABITAT: coffee with @chatgpt', { agents: [idle('anthropic'), idle('openai', { status: 'out' })] });
  assert.equal(r.results[0].ok, false);
  r = run(base().s, 'HABITAT: go moon');
  assert.equal(r.results[0].ok, false);
  // The visit overrides wandering but not a task.
  const world = buildWorld(IDS, {});
  const beh = behaviourOf({ status: 'idle' });
  const a = newActor(world, 'anthropic', beh);
  const to = { x: world.courtyard.x0 + 1, y: world.courtyard.y0 + 2 };
  a.visit = { to, until: NOW + 60000 };
  for (let i = 0; i < 400; i++) stepActor(world, a, beh, 0.1, { rng: () => 0.5, now: NOW + i * 100 });
  assert.deepEqual([a.x, a.y], [to.x, to.y]);
  stepActor(world, a, behaviourOf({ status: 'idle', task: { id: 'T1' } }), 0.1, { now: NOW + 41000 });
  assert.equal(a.visit, null, 'a task cancels the visit');
});

test('reduced motion: actions apply instantly, no walking', () => {
  const r = run(base().s, 'HABITAT: go hall', { reduced: true });
  assert.equal(r.events[0].instant, true);
  const world = buildWorld(IDS, {});
  const beh = behaviourOf({ status: 'idle' });
  const a = newActor(world, 'anthropic', beh);
  a.visit = { to: { x: world.hall.board.x + 1, y: world.hall.board.y + 2 }, until: NOW + 30000 };
  stepActor(world, a, beh, 0.1, { reduced: true, now: NOW });
  assert.deepEqual([a.x, a.y, a.path.length], [world.hall.board.x + 1, world.hall.board.y + 2, 0]);
  stepActor(world, a, beh, 0.1, { reduced: true, now: NOW + 31000 });
  assert.equal(a.visit, null);
});

test('rate limits: 5 per turn and 30 per hour', () => {
  const lines = Array.from({ length: 7 }, () => 'HABITAT: emote happy').join('\n');
  const r = run(base().s, lines);
  assert.equal(r.results.filter((x) => x.ok).length, MAX_PER_TURN);
  assert.deepEqual(r.results.slice(MAX_PER_TURN).map((x) => x.reason), ['too many Habitat actions', 'too many Habitat actions']);
  let s = base().s;
  let ok = 0;
  for (let i = 0; i < 8; i++) { const q = run(s, Array.from({ length: 5 }, () => 'HABITAT: pet').join('\n'), { now: NOW + i * 60000 }); s = q.store; ok += q.results.filter((x) => x.ok).length; }
  assert.equal(ok, MAX_PER_HOUR);
  const later = run(s, 'HABITAT: pet', { now: NOW + 2 * 3600e3 });
  assert.equal(later.results[0].ok, true, 'an hour later it works again');
});

test('locks and owner-placed props win', () => {
  const { s, placed, stored } = base();
  let locked = setLock(s, 'anthropic', true);
  let r = run(locked, `HABITAT: move ${placed} to 4,2\nHABITAT: nameplate X\nHABITAT: rug round\nHABITAT: remove ${placed}\nHABITAT: emote happy`);
  assert.deepEqual(r.results.map((x) => x.ok), [false, false, false, false, true]);
  assert.match(r.results[0].reason, /locked/);
  locked = setLock(setLock(s, '*', true), 'anthropic', false);
  assert.equal(run(locked, `HABITAT: place ${stored} at 4,2`).results[0].ok, false, 'lock all');
  const open = setLock(locked, '*', false);
  assert.equal(open.lockAll, false);
  // The owner moved the prop: the AI can't move it until he frees it.
  const owned = migrateStore(s); owned.ai.anthropic.props[0].owner = true;
  r = run(owned, `HABITAT: move ${placed} to 4,2\nHABITAT: remove ${placed}`);
  assert.deepEqual(r.results.map((x) => x.ok), [false, false]);
  assert.match(r.results[0].reason, /Owner placed/);
  const freed = freeOwnerProps(owned, 'anthropic');
  assert.equal(run(freed, `HABITAT: remove ${placed}`).results[0].ok, true);
  // Locks survive a save round-trip and never change by themselves.
  const back = migrateStore(JSON.parse(JSON.stringify(setLock(s, 'google', true))));
  assert.equal(back.locks.google, true);
  assert.equal(reconcile(back, [], NOW).store.locks.google, true);
});

test('watering: once per AI per day, small capped wilting relief, never adds growth', () => {
  const s = migrateStore({ finished: 10, growth: 10, failStreak: 4 });
  assert.equal(gardenState(s).wilt, 2);
  let r = run(s, 'HABITAT: water garden');
  assert.equal(r.results[0].ok, true);
  assert.equal(r.store.growth, 10); assert.equal(r.store.finished, 10);
  assert.equal(r.store.relief, 1);
  assert.equal(gardenState(r.store).wilt, 1);
  r = run(r.store, 'HABITAT: water garden');
  assert.equal(r.results[0].ok, false); assert.match(r.results[0].reason, /today/);
  // Others can water too, but the relief is capped.
  let st = r.store;
  for (const id of ['google', 'openai', 'xai']) st = run(st, 'HABITAT: water', { agent: id }).store;
  assert.equal(st.relief, 2); assert.equal(st.growth, 10);
  // Next day it works again (still capped).
  const next = run(st, 'HABITAT: water', { now: NOW + 864e5 });
  assert.equal(next.results[0].ok, true); assert.equal(next.store.relief, 2); assert.equal(next.store.growth, 10);
  // A passing result resets the streak and the relief together.
  const t = { id: 'T1', stage: 'implementing', assignee: 'anthropic', tests: 'failed', ci: '' };
  const a = reconcile(next.store, [t], NOW).store;
  const b = reconcile(a, [{ ...t, tests: 'passed' }], NOW).store;
  assert.equal(b.failStreak, 0); assert.equal(b.relief, 0); assert.equal(b.growth, 10);
});

test('board notes: sanitised, truncated, one per AI, owner can clear', () => {
  let r = run(base().s, `HABITAT: note <script>x</script> ${'long '.repeat(40)}`);
  const n = r.store.board.anthropic;
  assert.ok(n.text.length <= 80 && !/[<>]/.test(n.text));
  r = run(r.store, 'HABITAT: note second note');
  assert.equal(Object.keys(r.store.board).length, 1);
  assert.equal(r.store.board.anthropic.text, 'second note');
  const notes = boardNotes([{ id: 'C1', who: 'owner', text: 'Hello team.' }], [], r.store.board);
  assert.deepEqual([notes[0].kind, notes[0].who], ['pin', 'anthropic']);
  assert.deepEqual(clearBoard(r.store).board, {});
  assert.equal(run(base().s, 'HABITAT: note    ').results[0].ok, false);
});

test('the Local AI only gets look, emote and note', () => {
  const r = applyHabitatLines(null, { agent: 'ollama', text: 'HABITAT: look\nHABITAT: emote thinking\nHABITAT: note hi\nHABITAT: go garden', ids: [...IDS, 'ollama'], agents: [], names: NAMES, now: NOW, local: true });
  assert.deepEqual(r.results.map((x) => x.ok), [true, true, true, false]);
  const sec = habitatSection(null, { agent: 'ollama', ids: [...IDS, 'ollama'], names: NAMES, now: NOW, local: true });
  assert.ok(sec.text.includes('HABITAT: look') && !sec.text.includes('place <prop>'));
  const full = habitatSection(null, { agent: 'anthropic', ids: IDS, names: NAMES, now: NOW, full: true });
  assert.ok(full.text.includes('place <prop>') && full.text.includes('never let it interrupt real work'));
  const delta = habitatSection(null, { agent: 'anthropic', ids: IDS, names: NAMES, now: NOW, full: false });
  assert.ok(!delta.text.includes('place <prop>') && delta.text.includes('Your Habitat memory'));
  assert.equal(habitatSection(null, { agent: 'mistral', ids: IDS }).text, '');
});

test('undo: the owner reverts the last Habitat change per AI', () => {
  const { s, stored } = base();
  const r1 = run(s, 'HABITAT: nameplate Den');
  const r2 = run(r1.store, 'HABITAT: rug round\nHABITAT: emote happy');
  const u = undoLast(r2.store, 'anthropic', NOW, NAMES);
  assert.equal(u.ok, true); assert.match(u.label, /^Claude laid a round rug/);
  assert.equal(u.store.ai.anthropic.rug, undefined);
  assert.equal(u.store.ai.anthropic.plate, 'Den', 'only the last change is undone');
  assert.equal(undoLast(u.store, 'anthropic', NOW).ok, false);
  const placedSpot = run(s, `HABITAT: place ${stored} at 4,3`);
  if (placedSpot.results[0].ok) {
    const back = undoLast(placedSpot.store, 'anthropic', NOW);
    assert.ok(back.store.ai.anthropic.stored.includes(stored));
  }
  assert.ok(u.store.journal.anthropic.some((e) => /Owner undid/.test(e.text)));
});

test('journal: dated entries, capped, persisted, notes limited, cleared by reset', () => {
  let s = base().s;
  assert.ok(s.journal.anthropic.some((e) => /^unlocked \w+ for (5|10) tasks$/.test(e.text)), 'unlocks are journaled');
  const medal = reconcile(migrateStore({ ai: { google: { done: 0 } } }), [{ id: 'T9', stage: 'approved', assignee: 'google' }], NOW).store;
  assert.ok(medal.journal.google.some((e) => e.text === 'earned medal: First task done'));
  for (let i = 0; i < 70; i++) s = run(s, `HABITAT: note n${i}`, { now: NOW + i * 3600e3 }).store;
  assert.equal(s.journal.anthropic.length, JOURNAL_MAX);
  assert.equal(s.journal.anthropic.slice(-1)[0].text, 'left note: n69');
  assert.ok(s.journal.anthropic.every((e) => !Number.isNaN(Date.parse(e.at))));
  // Persistence round-trip keeps everything.
  const back = migrateStore(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back.journal, s.journal); assert.deepEqual(back.board, s.board); assert.deepEqual(back.ai, s.ai);
  // The AI's own notes: max 200 chars, 3 a day.
  let j = base().s;
  const res = [];
  for (let i = 0; i < 4; i++) { const q = run(j, `HABITAT: journal ${i === 0 ? 'x'.repeat(400) : `why ${i}`}`); j = q.store; res.push(q.results[0].ok); }
  assert.deepEqual(res, [true, true, true, false]);
  assert.ok(j.journal.anthropic.find((e) => e.text.startsWith('note: x')).text.length <= 210);
  assert.equal(run(j, 'HABITAT: journal tomorrow', { now: NOW + 864e5 }).results[0].ok, true);
  assert.deepEqual(clearJournal(j, 'anthropic').journal.anthropic, undefined);
  assert.deepEqual(resetStore([], NOW).journal, {});
});

test('memory line stays short; look includes the room and recent journal entries', () => {
  let s = base().s;
  s = run(s, `HABITAT: nameplate ${'Z'.repeat(30)}\nHABITAT: rug round\nHABITAT: lamp off\nHABITAT: coffee with @grok`).store;
  for (let i = 0; i < 12; i++) s.ai.anthropic.props.push({ kind: 'globe', x: 1, y: 1 });
  const line = habitatSummary(s, 'anthropic', NOW + 864e5);
  assert.ok(line.length <= SUMMARY_MAX, `${line.length}`);
  const short = habitatSummary(run(base().s, 'HABITAT: coffee with @grok').store, 'anthropic', NOW + 864e5);
  assert.match(short, /room props .*\(\d,\d\)/); assert.match(short, /1 prop unlocked but not placed/); assert.match(short, /last: had coffee with Grok yesterday/);
  let st = base().s;
  for (let i = 0; i < 12; i++) st = run(st, `HABITAT: note n${i}`, { now: NOW + i * 3600e3 }).store;
  st = run(st, 'HABITAT: look', { now: NOW + 13 * 3600e3 }).store;
  const sec = habitatSection(st, { agent: 'anthropic', ids: IDS, names: NAMES, now: NOW + 14 * 3600e3 });
  assert.equal(sec.changed, true);
  assert.ok(sec.text.includes('HABITAT LOOK') && sec.text.includes('Free spots') && sec.text.includes('Unlocked but not placed'));
  assert.ok(sec.text.includes('left note: n11') && !sec.text.includes('left note: n1\n'), 'latest 10 journal entries');
  assert.ok(sec.text.includes('Board notes: Claude:'));
  // Asked once: the next prompt only has the memory line again.
  assert.ok(!habitatSection(sec.store, { agent: 'anthropic', ids: IDS, names: NAMES, now: NOW }).text.includes('HABITAT LOOK'));
  assert.ok(describeRoom(st, 'anthropic', { ids: IDS }).includes('door is at 2,3'));
});

test('results render as ✓/✗ lines and the store round-trips', () => {
  const r = run(base().s, 'HABITAT: emote happy\nHABITAT: emote angry');
  const html = habitatResultsHtml({ results: [...r.results, { ok: true, line: 'TASK: x', reason: 'other branch' }] }, esc);
  assert.equal((html.match(/✓/g) || []).length, 1); assert.equal((html.match(/✗/g) || []).length, 1);
  assert.equal(r.store.rev, migrateStore(JSON.parse(JSON.stringify(r.store))).rev);
  assert.ok(r.store.rev > 0);
  assert.deepEqual(migrateStore(JSON.parse(JSON.stringify(r.store))).life.events, r.store.life.events);
});

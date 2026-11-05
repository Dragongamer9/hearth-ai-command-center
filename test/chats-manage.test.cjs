// Chat list management: rename (team chats too), pin, reorder, hide (team chats only),
// delete to the bin (never destroyed) and restore. Saved data only changes on the owner's action.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createChats, chatOrder } = require('../electron/chats.cjs');

let t0 = 0;
const fresh = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chats-'));
  const c = createChats(dir, { now: () => new Date(Date.UTC(2026, 10, 4, 0, 0, t0++)).toISOString() });
  c.ensureTeams([{ id: 'default', name: 'hearth-os' }]);
  return { c, dir };
};
const ids = (c) => c.list([{ id: 'default', name: 'hearth-os' }]).map((x) => x.id);

test('pinned chats come first, then the owner order, then newest', () => {
  const { c } = fresh();
  const a = c.create({ title: 'A' }), b = c.create({ title: 'B' }), d = c.create({ title: 'D' });
  c.update(a.id, { pinned: true });
  const l = ids(c);
  assert.equal(l[0], a.id, 'pinned first');
  c.reorder(l.slice(1).reverse());
  assert.deepEqual(ids(c).slice(1), l.slice(1).reverse(), 'owner order kept for the other chats');
  const n = c.create({ title: 'N' });
  assert.equal(ids(c)[1], n.id, 'a new chat goes to the top of the unpinned chats');
  assert.throws(() => c.reorder([a.id, b.id]), /separately/, 'pinned and other chats are ordered separately');
  assert.throws(() => c.reorder([b.id, b.id]), /bad order/);
  c.update(a.id, { pinned: false });
  assert.ok(!c.list([]).find((x) => x.id === a.id).pinned);
  assert.ok(d);
});

test('rename works for team chats too and is remembered as the owner\'s name', () => {
  const { c, dir } = fresh();
  const e = c.update('team-default', { title: 'Hearth OS main chat' });
  assert.equal(e.title, 'Hearth OS main chat');
  assert.equal(e.renamed, true);
  const again = createChats(dir).list([{ id: 'default', name: 'hearth-os' }]).find((x) => x.id === 'team-default');
  assert.equal(again.title, 'Hearth OS main chat', 'survives a restart');
  assert.equal(again.renamed, true);
});

test('deleting moves the chat file to the bin, and restoring brings it back unchanged', () => {
  const { c, dir } = fresh();
  const a = c.create({ title: 'Keep me' });
  c.save(a.id, { messages: [{ id: 'm1', who: 'owner', text: 'hello' }], sessions: { x: 1 } });
  const r = c.remove(a.id);
  assert.ok(r.ok);
  assert.ok(!ids(c).includes(a.id));
  assert.ok(!fs.existsSync(path.join(dir, 'chats', `${a.id}.json`)), 'not in the list folder');
  assert.ok(fs.existsSync(path.join(dir, 'chats', 'trash', `${r.trashId}.json`)), 'kept in the bin');
  assert.equal(c.trash()[0].title, 'Keep me');
  const back = c.restore(r.trashId);
  assert.equal(back.id, a.id);
  assert.deepEqual(c.get(a.id).messages, [{ id: 'm1', who: 'owner', text: 'hello' }], 'messages intact');
  assert.equal(c.trash().length, 0);
  assert.throws(() => c.restore(r.trashId), /no longer in the bin/);
});

test("a project's team chat can't be deleted, only hidden (and shown again)", () => {
  const { c } = fresh();
  assert.throws(() => c.remove('team-default'), /can't be deleted/);
  assert.equal(c.update('team-default', { hidden: true }).hidden, true);
  assert.equal(c.update('team-default', { hidden: false }).hidden, undefined);
  const a = c.create({});
  assert.throws(() => c.update(a.id, { hidden: true }), /Only a project's team chat can be hidden/);
});

test('every change keeps the previous index as .bak, and a damaged index is never overwritten', () => {
  const { c, dir } = fresh();
  const a = c.create({ title: 'A' });
  c.update(a.id, { pinned: true });
  const idx = path.join(dir, 'chats', 'index.json');
  assert.ok(fs.existsSync(`${idx}.bak`));
  fs.writeFileSync(idx, '{ broken');
  fs.writeFileSync(`${idx}.bak`, '{ broken too');
  const c2 = createChats(dir);
  assert.throws(() => c2.create({}), /could not be read/);
  assert.equal(fs.readFileSync(idx, 'utf8'), '{ broken', 'left exactly as it was');
});

test('chatOrder is the same order the window shows', async () => {
  const { sortChats, moveInGroup, dropInGroup } = await import('../src/chats.mjs');
  const list = [
    { id: 'c1', updatedAt: '2026-11-04T03:00:00Z' },
    { id: 'c2', updatedAt: '2026-11-04T02:00:00Z', pinned: true },
    { id: 'c3', updatedAt: '2026-11-04T01:00:00Z' },
    { id: 'c4', updatedAt: '2026-11-04T04:00:00Z', order: 0 },
  ];
  assert.deepEqual(sortChats(list).map((x) => x.id), [...list].sort(chatOrder).map((x) => x.id));
  assert.deepEqual(sortChats(list).map((x) => x.id), ['c2', 'c4', 'c1', 'c3']);
  assert.deepEqual(moveInGroup(list, 'c1', 1), ['c4', 'c3', 'c1']);
  assert.equal(moveInGroup(list, 'c2', -1), null, 'nothing above the first pinned chat');
  assert.deepEqual(dropInGroup(list, 'c3', 'c4'), ['c3', 'c4', 'c1']);
  assert.equal(dropInGroup(list, 'c3', 'c2'), null, 'not across Pinned and Chats');
});

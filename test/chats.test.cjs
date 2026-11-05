// Part B, main side: the chats store (electron/chats.cjs). Existing team chats are never
// moved or rewritten; the first run only adds an index; writes are atomic with a backup;
// a file that fails to parse is never overwritten.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createChats } = require('../electron/chats.cjs');
const { createProjects } = require('../electron/ops/projects.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chats-test-'));
const snapshot = (dir) => {
  const out = {};
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8'); } };
  walk(dir);
  return out;
};

function withProjects() {
  const d = tmp();
  const projects = createProjects(d);
  projects.load('/home/c/command-center', []);
  const h = projects.add({ dir: '/var/home/chris/HearthProjects/hearth-os' });
  // Each project's existing team chat, in its own state file.
  fs.writeFileSync(projects.stateFile('default'), JSON.stringify({ tasks: [], audit: [], chat: [{ id: 'a', who: 'owner', text: 'command center chat' }] }));
  fs.mkdirSync(path.dirname(projects.stateFile(h.id)), { recursive: true });
  fs.writeFileSync(projects.stateFile(h.id), JSON.stringify({ tasks: [], audit: [], chat: [{ id: 'b', who: 'owner', text: 'hearth chat' }] }));
  return { d, projects, h };
}

test('first run: each project\'s team chat becomes one chat in the list; only the index is added', () => {
  const { d, projects, h } = withProjects();
  const before = snapshot(d);
  const chats = createChats(d);
  const list = chats.list(projects.get().list, (id) => projects.stateFile(id));
  assert.deepEqual(list.map((c) => c.id).sort(), ['team-default', `team-${h.id}`].sort());
  assert.ok(list.every((c) => c.team && c.projectId));
  const after = snapshot(d);
  // Nothing that existed changed; only chats/index.json is new.
  for (const [f, text] of Object.entries(before)) assert.equal(after[f], text, `${f} untouched`);
  assert.deepEqual(Object.keys(after).filter((f) => !(f in before)), [path.join('chats', 'index.json')]);
  // A second run adds nothing.
  const again = createChats(d).list(projects.get().list, (id) => projects.stateFile(id));
  assert.equal(again.length, 2);
});

test('a project added later gets its team chat entry too (additive)', () => {
  const { d, projects } = withProjects();
  const chats = createChats(d);
  chats.list(projects.get().list);
  const n = projects.add({ dir: '/p/beacon' });
  const list = chats.list(projects.get().list);
  assert.ok(list.some((c) => c.id === `team-${n.id}` && c.projectId === n.id));
});

test('new chats: own messages and sessions, newest first, title and link changes, backups kept', () => {
  const { d, projects, h } = withProjects();
  const chats = createChats(d, { now: (() => { let t = 0; return () => new Date(Date.UTC(2026, 10, 4, 12, 0, t++)).toISOString(); })() });
  chats.list(projects.get().list);
  const a = chats.create({ projectId: 'default' });
  const b = chats.create({ projectId: h.id });
  chats.save(a.id, { messages: [{ id: 'x', who: 'owner', text: 'fix the switcher' }], sessions: { anthropic: { sessionId: 's-a' } } });
  chats.save(b.id, { messages: [{ id: 'y', who: 'owner', text: 'boot menu' }], sessions: { anthropic: { sessionId: 's-b' } } });
  assert.equal(chats.get(a.id).messages[0].text, 'fix the switcher');
  assert.equal(chats.get(a.id).sessions.anthropic.sessionId, 's-a');
  assert.equal(chats.get(b.id).sessions.anthropic.sessionId, 's-b', "chats don't share AI sessions");
  const list = chats.list(projects.get().list).filter((c) => !c.team);
  assert.equal(list[0].id, b.id, 'newest first');
  chats.update(a.id, { title: 'Project switcher' });
  chats.update(a.id, { projectId: null });
  const ea = chats.list(projects.get().list).find((c) => c.id === a.id);
  assert.equal(ea.title, 'Project switcher');
  assert.equal(ea.projectId, null);
  assert.ok(fs.existsSync(path.join(d, 'chats', `${a.id}.json.bak`)), 'previous copy kept');
  assert.ok(fs.existsSync(path.join(d, 'chats', 'index.json.bak')));
  // No temp files left behind (atomic rename).
  assert.deepEqual(fs.readdirSync(path.join(d, 'chats')).filter((f) => f.includes('.tmp-')), []);
});

test("a project's team chat can't be relinked or overwritten through the chats store", () => {
  const { d, projects } = withProjects();
  const chats = createChats(d);
  chats.list(projects.get().list);
  assert.throws(() => chats.update('team-default', { projectId: null }), /stays linked to its project/);
  assert.throws(() => chats.save('team-default', { messages: [] }), /unknown chat|bad chat id/);
  assert.equal(JSON.parse(fs.readFileSync(projects.stateFile('default'), 'utf8')).chat[0].text, 'command center chat');
});

test('a damaged index is never overwritten: the backup is used, or writes stop and the owner is told', () => {
  const { d, projects } = withProjects();
  let chats = createChats(d);
  chats.list(projects.get().list);
  const c = chats.create({ projectId: 'default' });
  chats.update(c.id, { title: 'kept' });
  const idx = path.join(d, 'chats', 'index.json');
  fs.writeFileSync(idx, '{ broken');
  chats = createChats(d);
  const list = chats.list(projects.get().list);
  assert.ok(list.some((x) => x.id === c.id), 'the last good copy was used');
  assert.match(chats.notices()[0], /damaged; the last good copy was used/);
  assert.ok(fs.readdirSync(path.join(d, 'chats')).some((f) => f.startsWith('index.json.corrupt-')), 'damaged file kept aside');
  // Both damaged: nothing is written over it.
  fs.writeFileSync(idx, '{ broken');
  fs.writeFileSync(`${idx}.bak`, 'also broken');
  chats = createChats(d);
  chats.list(projects.get().list);
  assert.equal(fs.readFileSync(idx, 'utf8'), '{ broken');
  assert.ok(chats.broken());
  assert.throws(() => chats.create({ projectId: 'default' }), /could not be read/);
  assert.equal(fs.readFileSync(idx, 'utf8'), '{ broken', 'still untouched');
});

test('a damaged chat file is never overwritten', () => {
  const { d, projects } = withProjects();
  const chats = createChats(d);
  chats.list(projects.get().list);
  const c = chats.create({ projectId: 'default' });
  chats.save(c.id, { messages: [{ id: '1', who: 'owner', text: 'one' }] });
  const f = path.join(d, 'chats', `${c.id}.json`);
  fs.writeFileSync(f, 'garbage');
  const g = chats.get(c.id);
  assert.equal(g.ok, true);
  assert.equal(g.recovered, true);
  assert.equal(g.readOnly, true);
  assert.throws(() => chats.save(c.id, { messages: [] }), /not overwritten/);
  assert.equal(fs.readFileSync(f, 'utf8'), 'garbage');
});

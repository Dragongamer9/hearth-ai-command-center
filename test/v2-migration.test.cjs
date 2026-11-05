// 2.x migration: every old chat appears as a chat connected to the right repo, with all its
// messages; old boards, settings and state files are untouched; backups are kept.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createChats } = require('../electron/chats.cjs');
const { migrateV2 } = require('../electron/migrate-v2.cjs');

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// A 1.5 data folder: two projects (one with a GitHub remote, one local-only), their boards and
// team chats, a 1.4 chat linked to a project, a chat with no project, settings and the registry.
function fixture() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-mig-'));
  const projects = [
    { id: 'default', name: 'hearth-os', dir: '/home/o/hearth-os', createdAt: '2026-10-01T00:00:00Z' },
    { id: 'b7e1c2d3', name: 'beacon', dir: '/home/o/beacon', createdAt: '2026-10-02T00:00:00Z' },
    { id: 'c9f0e1d2', name: 'scratch', dir: null, createdAt: '2026-10-03T00:00:00Z' },
  ];
  const stateFileFor = (id) => (id === 'default' ? path.join(data, 'command-center-state.json') : path.join(data, 'projects', id, 'command-center-state.json'));
  const teamChat = Array.from({ length: 450 }, (_, i) => ({ id: `t${i}`, who: i % 2 ? 'anthropic' : 'owner', text: `hearth message ${i}`, at: '2026-11-01T10:00:00Z' }));
  const boards = {
    default: { version: 1, tasks: [{ id: 'K7Q2MA', title: 'Storage page', stage: 'approval' }], audit: [{ at: 'x', event: 'y' }], permissions: [{ id: 'R1', status: 'pending' }], chat: teamChat, chatSessions: { 'CHATAB:anthropic': { sessionId: 'sess-hearth' } }, lead: 'anthropic' },
    b7e1c2d3: { version: 1, tasks: [], audit: [], chat: [{ id: 'b1', who: 'owner', text: 'beacon icons', at: '2026-11-02T10:00:00Z' }], chatSessions: {} },
  };
  for (const [id, st] of Object.entries(boards)) { fs.mkdirSync(path.dirname(stateFileFor(id)), { recursive: true }); fs.writeFileSync(stateFileFor(id), JSON.stringify(st)); fs.writeFileSync(`${stateFileFor(id)}.1`, JSON.stringify(st)); }
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ project: '/home/o/hearth-os', projects: ['/home/o/hearth-os', '/home/o/beacon'], theme: 'light', textSize: 115, autoPush: false, actForMe: true, leadGitHub: true, ownerIdentity: { name: 'Dragongamer9', email: 'Dragongamer9@users.noreply.github.com' } }, null, 2));
  fs.writeFileSync(path.join(data, 'ops-projects.json'), JSON.stringify({ version: 1, active: 'default', list: projects }, null, 2));
  // 1.4/1.5 chats: one linked to beacon, one with no project, plus the team chat entries.
  fs.mkdirSync(path.join(data, 'chats'), { recursive: true });
  const index = { version: 1, migratedAt: '2026-11-01T00:00:00Z', list: [
    { id: 'team-default', title: 'hearth-os team chat', projectId: 'default', team: true, createdAt: '2026-10-01T00:00:00Z', pinned: true },
    { id: 'team-b7e1c2d3', title: 'beacon team chat', projectId: 'b7e1c2d3', team: true, createdAt: '2026-10-02T00:00:00Z' },
    { id: 'c0123456789', title: 'Beacon launcher icons', titleAuto: true, projectId: 'b7e1c2d3', createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T01:00:00Z', order: 0 },
    { id: 'c9876543210', title: 'Weekend ideas', projectId: null, createdAt: '2026-11-03T00:00:00Z', renamed: true },
  ], trash: [] };
  fs.writeFileSync(path.join(data, 'chats', 'index.json'), JSON.stringify(index, null, 1));
  fs.writeFileSync(path.join(data, 'chats', 'c0123456789.json'), JSON.stringify({ id: 'c0123456789', messages: [{ id: 'm1', who: 'owner', text: 'icons please' }], sessions: { anthropic: 'sess-icons' } }));
  fs.writeFileSync(path.join(data, 'chats', 'c9876543210.json'), JSON.stringify({ id: 'c9876543210', messages: [{ id: 'm2', who: 'owner', text: 'ideas' }], sessions: {} }));
  const remotes = { '/home/o/hearth-os': 'Dragongamer9/hearth-os' };
  const remoteOf = async (dir) => remotes[dir] || null;
  const untouched = [path.join(data, 'settings.json'), path.join(data, 'ops-projects.json'), stateFileFor('default'), `${stateFileFor('default')}.1`, stateFileFor('b7e1c2d3')];
  const before = Object.fromEntries(untouched.map((f) => [f, sha(f)]));
  const indexBefore = fs.readFileSync(path.join(data, 'chats', 'index.json'), 'utf8');
  return { data, projects, stateFileFor, remoteOf, untouched, before, indexBefore, teamChat };
}

test('every old chat appears, connected to the right repo, with all its messages', async () => {
  const f = fixture();
  const chats = createChats(f.data);
  const r = await migrateV2({ chats, projects: f.projects, stateFileFor: f.stateFileFor, remoteOf: f.remoteOf });
  assert.equal(r.ok, true);
  assert.equal(r.migrated, true);
  const list = chats.list([], null);
  const by = Object.fromEntries(list.map((c) => [c.id, c]));
  assert.deepEqual(Object.keys(by).sort(), ['c0123456789', 'c9876543210', 'team-b7e1c2d3', 'team-c9f0e1d2', 'team-default']);
  assert.equal(by['team-default'].repo, 'Dragongamer9/hearth-os', 'project chat -> its GitHub repo (from the folder\'s git remote)');
  assert.equal(by['team-b7e1c2d3'].repo, undefined);
  assert.equal(by['team-b7e1c2d3'].repoDir, '/home/o/beacon', 'no GitHub remote -> the project folder');
  assert.equal(by.c0123456789.repoDir, '/home/o/beacon', 'a 1.4/1.5 chat linked to a project gets that project\'s repo');
  assert.equal(by.c9876543210.repo, undefined, 'a chat with no project stays without a repo');
  assert.equal(by.c9876543210.repoDir, undefined);
  assert.equal(by['team-default'].pinned, true, 'pins, titles and order are kept');
  assert.equal(by.c0123456789.order, 0);
  assert.equal(by.c9876543210.renamed, true);
  // The team chat's every message (450, more than 1.x's 400 limit) and its sessions.
  const g = chats.get('team-default');
  assert.equal(g.ok, true);
  assert.deepEqual(g.messages, f.teamChat);
  assert.equal(g.sessions['CHATAB:anthropic'].sessionId, 'sess-hearth');
  assert.equal(chats.get('team-b7e1c2d3').messages[0].text, 'beacon icons');
  assert.deepEqual(chats.get('c0123456789').messages, [{ id: 'm1', who: 'owner', text: 'icons please' }]);
  // Migrated team chats are ordinary chats now: they can be saved to (their own file), and deleted to the bin.
  assert.equal(chats.save('team-default', { messages: [...g.messages, { id: 'new', who: 'owner', text: 'hi' }], sessions: g.sessions }), true);
  assert.equal(chats.get('team-default').messages.length, 451, 'nothing dropped on save');
});

test('old boards, settings, the projects registry and state files are byte-for-byte untouched', async () => {
  const f = fixture();
  const chats = createChats(f.data);
  await migrateV2({ chats, projects: f.projects, stateFileFor: f.stateFileFor, remoteOf: f.remoteOf });
  chats.save('team-default', { messages: [{ id: 'x', who: 'owner', text: 'after' }], sessions: {} });
  for (const file of f.untouched) assert.equal(sha(file), f.before[file], `${path.basename(file)} unchanged`);
  // The board is still all there to show read-only.
  const st = JSON.parse(fs.readFileSync(f.stateFileFor('default'), 'utf8'));
  assert.equal(st.tasks[0].id, 'K7Q2MA');
  assert.equal(st.chat.length, 450);
});

test('backups: the 1.x list is kept as index.json.pre-2 and every write keeps index.json.bak', async () => {
  const f = fixture();
  const chats = createChats(f.data);
  await migrateV2({ chats, projects: f.projects, stateFileFor: f.stateFileFor, remoteOf: f.remoteOf });
  const idx = path.join(f.data, 'chats', 'index.json');
  assert.equal(fs.readFileSync(`${idx}.pre-2`, 'utf8'), f.indexBefore, 'the exact 1.x list');
  assert.ok(fs.existsSync(`${idx}.bak`));
  JSON.parse(fs.readFileSync(`${idx}.bak`, 'utf8'));
  const j = JSON.parse(fs.readFileSync(idx, 'utf8'));
  assert.ok(j.v2 && j.v2.from === '1.x');
});

test('running it again changes nothing; a deleted team chat stays deleted', async () => {
  const f = fixture();
  let chats = createChats(f.data);
  await migrateV2({ chats, projects: f.projects, stateFileFor: f.stateFileFor, remoteOf: f.remoteOf });
  const idx = path.join(f.data, 'chats', 'index.json');
  chats.remove('team-b7e1c2d3');
  const snap = fs.readFileSync(idx, 'utf8');
  chats = createChats(f.data);
  const again = await migrateV2({ chats, projects: f.projects, stateFileFor: f.stateFileFor, remoteOf: f.remoteOf });
  assert.equal(again.migrated, false);
  chats.list(f.projects, f.stateFileFor);
  assert.equal(fs.readFileSync(idx, 'utf8'), snap, 'no write on a second run, and no team chat brought back');
  assert.ok(!chats.list([], null).some((c) => c.id === 'team-b7e1c2d3'));
  assert.equal(chats.trash()[0].id, 'team-b7e1c2d3', 'it\'s in Recently deleted');
  assert.equal(chats.restore(chats.trash()[0].trashId).id, 'team-b7e1c2d3');
  assert.equal(chats.get('team-b7e1c2d3').messages[0].text, 'beacon icons', 'restored with its messages');
});

test('a chats list that fails to parse is never written over', async () => {
  const f = fixture();
  const idx = path.join(f.data, 'chats', 'index.json');
  fs.writeFileSync(idx, '{ broken');
  const chats = createChats(f.data);
  const r = await migrateV2({ chats, projects: f.projects, stateFileFor: f.stateFileFor, remoteOf: f.remoteOf });
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(idx, 'utf8'), '{ broken');
  assert.ok(!fs.existsSync(path.join(f.data, 'chats', 'team-default.json')), 'nothing written');
  for (const file of f.untouched) assert.equal(sha(file), f.before[file]);
});

test('a project state file that fails to parse is left alone; its backup is used read-only; others still move', async () => {
  const f = fixture();
  fs.writeFileSync(f.stateFileFor('default'), '{ nope');
  const brokenSha = sha(f.stateFileFor('default'));
  const chats = createChats(f.data);
  const r = await migrateV2({ chats, projects: f.projects, stateFileFor: f.stateFileFor, remoteOf: f.remoteOf });
  assert.equal(r.ok, true);
  assert.equal(sha(f.stateFileFor('default')), brokenSha, 'the damaged file is not touched');
  assert.equal(chats.get('team-default').messages.length, 450, 'messages from its newest readable backup');
  assert.ok(r.notices.some((n) => /backup/.test(n)));
  // No readable copy at all: that chat stays as it is, with a note; nothing is lost or invented.
  const g = fixture();
  fs.writeFileSync(g.stateFileFor('default'), '{ nope');
  fs.writeFileSync(`${g.stateFileFor('default')}.1`, '{ nope');
  const c2 = createChats(g.data);
  const r2 = await migrateV2({ chats: c2, projects: g.projects, stateFileFor: g.stateFileFor, remoteOf: g.remoteOf });
  assert.ok(r2.notices.some((n) => /couldn't be read/.test(n)));
  assert.ok(!fs.existsSync(path.join(g.data, 'chats', 'team-default.json')));
  assert.match(c2.list([], null).find((c) => c.id === 'team-default').importError, /could not be read/);
  assert.equal(c2.list([], null).find((c) => c.id === 'c0123456789').repoDir, '/home/o/beacon');
});

test('settings keep their values: the migration never sees or writes settings.json', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'migrate-v2.cjs'), 'utf8');
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /settings\.json|writeSettings|setSettings/);
  const v2 = fs.readFileSync(path.join(__dirname, '..', 'electron', 'v2.cjs'), 'utf8');
  assert.doesNotMatch(v2.replace(/\/\/.*$/gm, ''), /writeSettings|settingsFile/, 'the 2.x IPC only reads settings');
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  // New settings are defaults shown at read time, written only from the owner's own changes.
  for (const k of ['copyIdleHours', 'previewNetwork', 'team']) assert.match(main, new RegExp(`if \\('${k}' in patch\\)`));
  assert.match(main, /previewNetwork: s\.previewNetwork === true,/);
  assert.match(main, /copyIdleHours: v2\.IDLE_CHOICES\.includes\(s\.copyIdleHours\) \? s\.copyIdleHours : 24,/);
});

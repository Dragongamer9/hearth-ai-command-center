// Part A: after a project switch, one project's state can never be saved into another
// project's file, and a chat workspace from another repository is never used.
// The first two tests reproduce the owner's bug and fail on 1.3.0.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createStore } = require('../electron/store.cjs');
const { createProjects } = require('../electron/ops/projects.cjs');
const workspace = require('../electron/workspace.cjs');
const guard = require('../electron/ops/project-guard.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'guard-test-'));
const repo = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), path.basename(dir));
  g('add', '.');
  g('-c', 'user.name=Dragongamer9', '-c', 'user.email=Dragongamer9@users.noreply.github.com', 'commit', '-q', '-m', 'first');
  return dir;
};
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const ccState = () => ({ version: 1, tasks: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map((id) => ({ id, title: id })), audit: [], chat: [{ id: 'm1', who: 'owner', text: 'cc' }], permissions: [{ id: 'R1', kind: 'push' }], chatWs: { id: 'CHAT9D7ALX' } });

// The main process as electron/main.cjs wires it: a store per project file, the binding,
// and the state:load / state:save handlers from project-guard.
function mainProcess(dataDir) {
  const projects = createProjects(dataDir);
  projects.load(null, []);
  const binding = guard.createBinding();
  let store = createStore(projects.stateFile(projects.get().active));
  binding.setActive(projects.get().active);
  const ipc = guard.stateIpc({ binding, read: () => store.load().state, write: (s) => store.save(s) });
  return {
    projects, binding, ipc,
    // ops:projectSwitch: the store (and the binding) swap first; the window reloads after.
    switchTo(id) { projects.switchTo(id); store = createStore(projects.stateFile(id)); binding.setActive(id); },
  };
}

test('BUG REPRO: a save that arrives after the switch never lands in the new project (failed on 1.3.0)', () => {
  const d = tmp();
  const m = mainProcess(d);
  const hearth = m.projects.add({ dir: '/var/home/chris/HearthProjects/hearth-os' });
  // The window loads Command Center (default) and works.
  const win = m.ipc.load();
  assert.equal(win.projectId, 'default');
  Object.assign(win, ccState());
  assert.equal(m.ipc.save(win), true);
  // The owner switches to Hearth OS: the window saved first, the main process swaps the file...
  m.switchTo(hearth.id);
  // ...and a chat turn / timer / the lead waker in the old window saves once more before it reloads.
  const r = m.ipc.save({ ...win });
  assert.equal(r.ok, false);
  assert.equal(r.refused, 'project');
  // On 1.3.0 this wrote Command Center's 7 tasks, permissions and chat workspace into Hearth OS.
  assert.equal(fs.existsSync(m.projects.stateFile(hearth.id)), false, "Hearth OS's file was not written");
  assert.equal(read(m.projects.stateFile('default')).tasks.length, 7, "Command Center's own file is intact");
});

test('BUG REPRO: a chat workspace from another repository is never reused (failed on 1.3.0)', async () => {
  const d = tmp();
  const cc = repo(path.join(d, 'command-center'));
  const hearth = repo(path.join(d, 'hearth-os'));
  const root = path.join(d, 'workspaces');
  await workspace.ensureWorktree({ project: cc, root, taskId: 'CHAT9D7ALX', title: 'team chat' });
  // Hearth OS's saved state pointed at CHAT9D7ALX: 1.3.0 handed that folder back as Hearth OS's.
  await assert.rejects(() => workspace.ensureWorktree({ project: hearth, root, taskId: 'CHAT9D7ALX', title: 'team chat' }), (e) => e.wrongRepo === true && /different project/.test(e.message));
  assert.equal(await workspace.belongsTo(path.join(root, 'CHAT9D7ALX'), cc), true);
  assert.equal(await workspace.belongsTo(path.join(root, 'CHAT9D7ALX'), hearth), false);
});

test('chat workspace: the main process picks the id and skips one from another repo, with a message', async () => {
  const d = tmp();
  const cc = repo(path.join(d, 'cc'));
  const hearth = repo(path.join(d, 'hearth-os'));
  const root = path.join(d, 'workspaces');
  // Plant another repo's worktree exactly at Hearth OS's usual id.
  const usual = guard.chatWorkspaceId(hearth);
  await workspace.ensureWorktree({ project: cc, root, taskId: usual, title: 'planted' });
  const pick = await guard.chooseChatWorkspace({ project: hearth, root, belongsTo: workspace.belongsTo });
  assert.notEqual(pick.id, usual);
  assert.match(pick.notice, /belongs to another project's repository/);
  const ws = await workspace.ensureWorktree({ project: hearth, root, taskId: pick.id, title: 'team chat' });
  assert.equal(await workspace.belongsTo(ws.dir, hearth), true);
  // Its own usual workspace is used when it is its own.
  const ccPick = await guard.chooseChatWorkspace({ project: cc, root: path.join(d, 'other-root'), belongsTo: workspace.belongsTo });
  assert.equal(ccPick.id, guard.chatWorkspaceId(cc));
  assert.equal(ccPick.notice, null);
});

test('the chat workspace id is the one the window always used (existing workspaces keep working)', () => {
  // src/main.js chatId() before this change, verbatim.
  const old = (project) => { let h = 0; for (const c of String(project || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `CHAT${h.toString(36).toUpperCase().padStart(6, '0').slice(-6)}`; };
  for (const p of ['/var/home/chris/HearthProjects/hearth-os', '/home/x/Command Center', '']) assert.equal(guard.chatWorkspaceId(p), old(p));
});

test('switching back and forth: each project keeps only its own tasks, chat, permissions', () => {
  const d = tmp();
  const m = mainProcess(d);
  const b = m.projects.add({ dir: '/p/b' });
  let w = m.ipc.load();
  Object.assign(w, ccState());
  m.ipc.save(w);
  for (let i = 0; i < 3; i++) {
    m.switchTo(b.id);
    w = m.ipc.load();
    assert.equal(w.projectId, b.id);
    assert.equal(w.empty || w.tasks.length === 1, true);
    if (w.empty) Object.assign(w, { version: 1, tasks: [{ id: 'HB1' }], audit: [], chat: [{ id: 'h1', who: 'owner', text: 'hearth' }], permissions: [] });
    assert.equal(m.ipc.save(w), true);
    m.switchTo('default');
    w = m.ipc.load();
    assert.equal(w.projectId, 'default');
    assert.equal(w.tasks.length, 7);
    assert.equal(m.ipc.save(w), true);
  }
  const fb = read(m.projects.stateFile(b.id));
  assert.deepEqual(fb.tasks.map((t) => t.id), ['HB1']);
  assert.equal(fb.chat[0].text, 'hearth');
  assert.deepEqual(fb.permissions, []);
  assert.equal(read(m.projects.stateFile('default')).tasks.length, 7);
});

test('a save stamped with another project is refused even from a bound window', () => {
  const m = mainProcess(tmp());
  const b = m.projects.add({ dir: '/p/b' });
  m.ipc.load();
  const r = m.ipc.save({ ...ccState(), projectId: b.id });
  assert.equal(r.refused, 'project');
  const r2 = m.ipc.save({ ...ccState() }); // no stamp at all
  assert.equal(r2.refused, 'project');
  assert.equal(m.binding.checkAction(b.id).ok, false, 'a run for another project is refused');
  assert.equal(m.binding.checkAction('default').ok, true);
});

test('restart after a switch: the app opens the switched-to project and its own state only', () => {
  const d = tmp();
  let m = mainProcess(d);
  const b = m.projects.add({ dir: '/p/b' });
  const w = m.ipc.load();
  Object.assign(w, ccState());
  m.ipc.save(w);
  m.switchTo(b.id);
  const wb = m.ipc.load();
  Object.assign(wb, { version: 1, tasks: [{ id: 'HB1' }], audit: [], chat: [], permissions: [] });
  m.ipc.save(wb);
  // Restart: a fresh main process reads the registry from disk.
  m = mainProcess(d);
  assert.equal(m.binding.active(), b.id);
  const again = m.ipc.load();
  assert.equal(again.projectId, b.id);
  assert.deepEqual(again.tasks.map((t) => t.id), ['HB1']);
  // Before the window loads, nothing can be saved or run.
  const m2 = mainProcess(d);
  assert.equal(m2.ipc.save({ ...again }).refused, 'project');
  assert.equal(m2.binding.checkAction().ok, false);
});

test('Next version and release settings are per project; a new project never inherits another one', () => {
  const d = tmp();
  const p = createProjects(d);
  p.load(null, []);
  p.setSettings('default', { nextVersion: '1.2.0' });
  const h = p.add({ dir: '/var/home/chris/HearthProjects/hearth-os' });
  assert.equal(p.byId(h.id).settings.nextVersion, '');
  p.switchTo(h.id);
  assert.equal(p.active().settings.nextVersion, '', "Hearth OS has no Next version: Command Center's 1.2.0 is not offered");
  // Release, tag and the release preview read only the active project's settings and are guarded.
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ops', 'index.cjs'), 'utf8');
  for (const h2 of ["handle('ops:leadRelease'", "handle('ops:releasePreview'"]) assert.match(src.slice(src.indexOf(h2), src.indexOf(h2) + 600), /active\(\)\.settings/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  for (const ch of ['agents:run', 'git:mergeApproved', 'git:release', 'ops:leadRelease', 'ops:releasePreview', 'workspace:checkpoint', 'state:restore']) assert.ok(main.includes(`'${ch}'`) && new RegExp(`GUARDED = new Set\\([\\s\\S]*'${ch}'`).test(main), ch);
});

test('agents:run refuses a workspace that belongs to another repo, and an unlinked chat runs read-only outside any project', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const run = main.slice(main.indexOf("handle('agents:run'"), main.indexOf("// ---- chat history bridge"));
  assert.match(run, /binding\.checkAction\(opts\.projectId\)/);
  assert.match(run, /workspace\.belongsTo\(dir, s\.project\)/);
  assert.match(run, /kind: 'wrong_project'/);
  assert.match(run, /opts\.unlinked === true[\s\S]*mode = 'read'/);
});

test('cross-copy detection: Hearth OS holding Command Center tasks and chat workspace is flagged (look only)', () => {
  const cc = { id: 'default', name: 'Command Center', dir: '/home/c/cc', state: ccState() };
  const copied = { id: 'b1', name: 'Hearth OS', dir: '/var/home/chris/HearthProjects/hearth-os', state: { ...ccState(), chatWs: { id: guard.chatWorkspaceId('/home/c/cc') } } };
  const n = guard.detectCrossCopy(copied, [cc]);
  assert.equal(n.length, 2);
  assert.match(n[0].text, /Hearth OS holds 7 of the same tasks as Command Center/);
  assert.match(n[1].text, /chat workspace/);
  const fine = { ...copied, state: { tasks: [{ id: 'HB1' }], chatWs: { id: guard.chatWorkspaceId(copied.dir) } } };
  assert.deepEqual(guard.detectCrossCopy(fine, [cc]), []);
});

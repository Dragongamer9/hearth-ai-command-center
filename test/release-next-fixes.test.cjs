// Fixes from the release/next review (1.1): one test per fix that touches git or the main process.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const w = require('../electron/ops/workflow.cjs');
const { git } = require('../electron/workspace.cjs');
const projects = require('../electron/ops/projects.cjs');

const ID = ['-c', 'user.name=Dragongamer9', '-c', 'user.email=d@users.noreply.github.com'];
for (const k of ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME']) process.env[k] = 'Dragongamer9';
for (const k of ['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL']) process.env[k] = 'd@users.noreply.github.com';
const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-fix-'));
  const remote = path.join(tmp, 'remote.git');
  const proj = path.join(tmp, 'proj');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['clone', '-q', remote, proj], { stdio: 'ignore' });
  const run = (cwd, ...a) => execFileSync('git', a, { cwd }).toString().trim();
  run(proj, 'checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'one\n');
  fs.mkdirSync(path.join(proj, 'docs'));
  fs.writeFileSync(path.join(proj, 'docs', 'guide.md'), '# guide\n');
  run(proj, 'add', '.');
  run(proj, ...ID, 'commit', '-qm', 'init');
  run(proj, 'push', '-q', '-u', 'origin', 'main');
  const wt = path.join(tmp, 'wt');
  run(proj, 'worktree', 'add', '-q', '-b', 'hearth/fix123-task', wt);
  const commit = (cwd, file, text, msg) => { fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); fs.writeFileSync(path.join(cwd, file), text); run(cwd, 'add', '-A'); run(cwd, ...ID, 'commit', '-qm', msg); return run(cwd, 'rev-parse', 'HEAD'); };
  return { tmp, remote, proj, wt, run, commit };
}

test('fix 1 (HIGH): a merge of main is never reverted; undo of MERGE MAIN resets only while nothing came after it and it is not pushed', async () => {
  const { proj, wt, run, commit } = setup();
  commit(wt, 'task.txt', 'task\n', 'task work');
  commit(proj, 'main.txt', 'from main\n', 'main change');
  const m = await w.mergeMain({ git, dir: wt, def: 'main', why: 'lead: MERGE MAIN' });
  assert.ok(m.ok && m.merged === 1, m.reason);
  const refused = await w.revertOnTask({ git, dir: wt, sha: m.head, def: 'main' });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /merges main into the task branch; reverting it would remove main's changes/);
  assert.ok(fs.existsSync(path.join(wt, 'main.txt')), "main's change stays");
  const undo = await w.undoMergeMain({ git, dir: wt, merge: m.head, before: m.before });
  assert.ok(undo.ok, undo.reason);
  assert.equal(run(wt, 'rev-parse', 'HEAD'), m.before);
  assert.equal(run(proj, 'rev-parse', 'main'), run(proj, 'log', '-1', '--format=%H', 'main'), 'main untouched');
  // Something came after the merge: refused.
  const m2 = await w.mergeMain({ git, dir: wt, def: 'main' });
  commit(wt, 'later.txt', 'later\n', 'later work');
  const moved = await w.undoMergeMain({ git, dir: wt, merge: m2.head, before: m2.before });
  assert.equal(moved.ok, false);
  assert.match(moved.reason, /moved on since that merge/);
  // Pushed: refused.
  const { wt: wt2, proj: p2, commit: c2, run: r2 } = setup();
  c2(wt2, 't.txt', 't\n', 'task');
  c2(p2, 'm.txt', 'm\n', 'main');
  const m3 = await w.mergeMain({ git, dir: wt2, def: 'main' });
  r2(wt2, 'push', '-q', 'origin', 'hearth/fix123-task');
  const pushed = await w.undoMergeMain({ git, dir: wt2, merge: m3.head, before: m3.before });
  assert.equal(pushed.ok, false);
  assert.match(pushed.reason, /already pushed/);
});

test('fix 3: the asset pipeline copies files and never removes one from the worktree', () => {
  const ui = src('electron/ops/index.cjs');
  assert.match(ui, /copyIntoAssets\(d, f\.rel, assetsDir\)/);
  assert.doesNotMatch(src('electron/ops/workflow.cjs'), /renameSync\(path\.join\(dir, rel\)/);
});

test('fix 5: docs-only runs see renames as both paths, restore the source, and treat paths literally', async () => {
  const { wt, run } = setup();
  const start = run(wt, 'rev-parse', 'HEAD');
  run(wt, 'mv', 'docs/guide.md', 'src.js');          // docs -> code: source restored, code file dropped
  run(wt, 'mv', 'a.txt', 'docs/a.md');                // code -> docs: code file restored
  fs.writeFileSync(path.join(wt, ':(glob)**'), 'x');  // pathspec magic as a file name
  run(wt, ...ID, 'commit', '-qam', 'renames');
  const r = await w.enforceDocs({ git, dir: wt, startSha: start });
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(path.join(wt, 'docs/guide.md'), 'utf8'), '# guide\n', 'rename source restored');
  assert.equal(fs.existsSync(path.join(wt, 'src.js')), false);
  assert.equal(fs.readFileSync(path.join(wt, 'a.txt'), 'utf8'), 'one\n');
  assert.equal(fs.existsSync(path.join(wt, ':(glob)**')), false, 'the odd file name is removed on its own');
  assert.ok(fs.existsSync(path.join(wt, 'docs/a.md')), 'the new docs file is kept');
  assert.equal(run(wt, 'ls-files', '--', 'docs/guide.md'), 'docs/guide.md', 'tracked files were not mass-deleted');
});

test('fix 6: the sha-lock split never resets commits that are already on GitHub, and never runs during a run', async () => {
  const { wt, run, commit } = setup();
  const approved = commit(wt, 'b.txt', 'approved\n', 'approved');
  const late = commit(wt, 'b.txt', 'late\n', 'late');
  run(wt, 'push', '-q', 'origin', 'hearth/fix123-task');
  const r = await w.splitFollowup({ git, dir: wt, approved });
  assert.equal(r.ok, false);
  assert.equal(r.pushed, true);
  assert.match(r.reason, /already has commits after the approved/);
  assert.equal(run(wt, 'rev-parse', 'HEAD'), late, 'nothing reset');
  const idx = src('electron/ops/index.cjs');
  assert.match(idx.slice(idx.indexOf("handle('ops:splitFollowup'")), /activeCwds\.has\(d\)\) return \{ ok: false, busy: true/);
  const main = src('src/main.js');
  const re = main.slice(main.indexOf('async function recheckApprovals('));
  assert.ok(re.indexOf('ui.running[t.id] || ui.busy[t.id]') < re.indexOf('opsSplitFollowup'), 'skips tasks with any run in progress');
});

test('fix 8: verify runs detect edits to files that were already dirty, and use per-task refs (not refs/stash)', async () => {
  const { wt, run } = setup();
  fs.writeFileSync(path.join(wt, 'a.txt'), 'owner edit\n'); // dirty before the run
  const before = await w.snapshot({ git, dir: wt });
  fs.writeFileSync(path.join(wt, 'a.txt'), 'changed during verify\n');
  const r = await w.enforceVerify({ git, dir: wt, before, stamp: 7, taskId: 'FIX123' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.files, ['a.txt']);
  assert.equal(fs.readFileSync(path.join(wt, 'a.txt'), 'utf8'), 'owner edit\n', "the owner's earlier edit is back, the run's edit is gone");
  assert.equal(r.treeRef, 'refs/hearth/discarded/FIX123/7-tree');
  assert.match(run(wt, 'show', `${r.treeRef}:a.txt`), /changed during verify/, 'the discarded edit is recoverable');
  assert.equal(run(wt, 'stash', 'list'), '');
});

test("fix 9: the review packet diff shows the task's own changes, not main's merged-in ones", async () => {
  const { proj, wt, commit } = setup();
  const signed = commit(wt, 'task.txt', 'v1\n', 'task v1');
  commit(proj, 'big-main-change.txt', 'main\n'.repeat(50), 'main change');
  await w.mergeMain({ git, dir: wt, def: 'main' });
  commit(wt, 'task.txt', 'v2\n', 'task v2');
  const r = await w.reviewData({ git, dir: wt, from: signed, def: 'main' });
  assert.match(r.diff, /task\.txt/);
  assert.doesNotMatch(r.diff, /big-main-change/);
  assert.doesNotMatch(r.log, /main change|Merge/);
  const vsMain = await w.reviewData({ git, dir: wt, from: null, def: 'main' });
  assert.doesNotMatch(vsMain.diff, /big-main-change/);
  assert.match(vsMain.diff, /task\.txt/);
});

test('fix 4: the release gate tags exactly the gated commit (fetch first, --target <sha>, dispatch re-check, release command in a clean worktree)', () => {
  const idx = src('electron/ops/index.cjs');
  const gate = idx.slice(idx.indexOf('async releaseGate(version, target)'));
  assert.ok(gate.indexOf("'fetch'") < gate.indexOf('rev-parse'), 'fetch before reading the commit');
  assert.match(gate, /return \{ \.\.\.releaseGateFor\(version, sha\), sha \}/);
  const main = src('electron/main.cjs');
  assert.match(main, /target: gatedSha \|\| String\(o\.target/);
  const lead = idx.slice(idx.indexOf("handle('ops:leadRelease'"), idx.indexOf("handle('ops:releaseStatus'"));
  assert.ok(lead.indexOf('not the gated') < lead.indexOf('/dispatches'), 'main is re-checked right before dispatch');
  assert.match(lead, /worktree', 'add', '--detach', tmp, sha\]/);
  assert.match(lead, /cwd: tmp, timeoutMs: 30 \* 60000/);
  assert.match(src('electron/git.cjs'), /\^\[0-9a-f\]\{40\}\$\/\.test\(String\(target/);
});

test('fix 11: the 3D view settings are app-wide settings, migrated once, written atomically with a .bak', () => {
  const main = src('electron/main.cjs');
  assert.match(main, /view3d: cleanView3d\(s\.view3d\)/);
  assert.match(main, /if \('view3d' in patch\) s\.view3d = cleanView3d\(patch\.view3d\)/);
  assert.match(main, /copyFileSync\(settingsFile\(\), `\$\{settingsFile\(\)\}\.bak`\)/);
  const ui = src('src/main.js');
  assert.match(ui, /view3d: \(\) => settings\.view3d \|\| null/);
  assert.match(ui, /if \(!settings\.view3d && state\.habitat3d/);
});

test('fix 12: invalid docs paths are refused with a message, never silently reset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-proj-'));
  const p = projects.createProjects(dir);
  const id = p.active().id;
  assert.throws(() => p.setSettings(id, { docsPaths: '../secrets/**' }), /Docs paths must be/);
  assert.throws(() => p.setSettings(id, { docsPaths: ':(glob)**' }), /Docs paths must be/);
  p.setSettings(id, { docsPaths: '*.md, notes/**' });
  assert.equal(p.active().settings.docsPaths, '*.md, notes/**');
});

test('fix 13: leaving the Habitat page disposes the lodge and renderer and loses the WebGL context', () => {
  const v = src('src/habitat3d/view.mjs');
  const stop = v.slice(v.indexOf('export function stopHabitat3d'), v.indexOf('function savePrefs'));
  assert.match(stop, /teardown\(\);/);
  assert.match(stop, /disposeTree\(V\.lodge\.root/);
  assert.match(stop, /renderer\.dispose\(\); gl\.renderer\.forceContextLoss\(\)/);
  assert.match(stop, /gl: null, lodge: null/);
  assert.match(v, /if \(winBound\) return;/, 'window listeners bound once across re-creation');
});

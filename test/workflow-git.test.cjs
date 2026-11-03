const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const w = require('../electron/ops/workflow.cjs');
const { git } = require('../electron/workspace.cjs');
const jobsMod = require('../electron/ops/jobs.cjs');
const { probeResolution } = require('../electron/attachments.cjs');
const { imageSize } = require('../electron/ops/media.cjs');

const ID = ['-c', 'user.name=Dragongamer9', '-c', 'user.email=d@users.noreply.github.com'];
process.env.GIT_AUTHOR_NAME = 'Dragongamer9'; process.env.GIT_AUTHOR_EMAIL = 'd@users.noreply.github.com';
process.env.GIT_COMMITTER_NAME = 'Dragongamer9'; process.env.GIT_COMMITTER_EMAIL = 'd@users.noreply.github.com';

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-wf-'));
  const remote = path.join(tmp, 'remote.git');
  const proj = path.join(tmp, 'proj');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['clone', '-q', remote, proj], { stdio: 'ignore' });
  const run = (cwd, ...a) => execFileSync('git', a, { cwd }).toString().trim();
  run(proj, 'checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(proj, 'README.md'), '# r\n');
  run(proj, 'add', '.');
  run(proj, ...ID, 'commit', '-qm', 'init');
  run(proj, 'push', '-q', '-u', 'origin', 'main');
  const wt = path.join(tmp, 'wt');
  run(proj, 'worktree', 'add', '-q', '-b', 'hearth/abc123-task', wt);
  const commit = (cwd, file, text, msg) => { fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); fs.writeFileSync(path.join(cwd, file), text); run(cwd, 'add', '-A'); run(cwd, ...ID, 'commit', '-qm', msg); return run(cwd, 'rev-parse', 'HEAD'); };
  return { tmp, remote, proj, wt, run, commit };
}

test('A/D: truth facts and the verified start: fetch, fast-forward main, merge main into the task branch', async () => {
  const { tmp, remote, proj, wt, run, commit } = setup();
  commit(wt, 'b.txt', 'task\n', 'task work');
  // Someone else pushes to main on GitHub.
  const other = path.join(tmp, 'other');
  execFileSync('git', ['clone', '-q', remote, other], { stdio: 'ignore' });
  commit(other, 'c.txt', 'upstream\n', 'upstream change');
  run(other, 'push', '-q', 'origin', 'main');
  const sync = await w.syncMain({ git, project: proj, def: 'main' });
  assert.match(sync.note, /fast-forwarded main/);
  assert.equal(run(proj, 'rev-parse', 'main'), run(other, 'rev-parse', 'HEAD'));
  const before = await w.truthFacts({ git, dir: wt, def: 'main' });
  assert.equal(before.behind, 1);
  assert.equal(before.ahead, 1);
  assert.equal(before.branch, 'hearth/abc123-task');
  assert.equal(before.merged, null);
  assert.match(before.stat, /1 file, \+1 −0/);
  const m = await w.mergeMain({ git, dir: wt, def: 'main' });
  assert.ok(m.ok, m.reason);
  assert.equal(m.merged, 1);
  assert.equal((await w.truthFacts({ git, dir: wt, def: 'main' })).behind, 0);
  assert.ok(fs.existsSync(path.join(wt, 'c.txt')));
  assert.equal(run(proj, 'rev-parse', 'main'), run(other, 'rev-parse', 'HEAD'), 'main itself is never changed by the merge');
});

test('D: a conflicting main stops with a conflict report and leaves the branch as it was', async () => {
  const { proj, wt, run, commit } = setup();
  const head = commit(wt, 'a.txt', 'task side\n', 'task edit');
  commit(proj, 'a.txt', 'main side\n', 'main edit');
  const m = await w.mergeMain({ git, dir: wt, def: 'main' });
  assert.equal(m.ok, false);
  assert.deepEqual(m.conflicts, ['a.txt']);
  assert.equal(run(wt, 'rev-parse', 'HEAD'), head);
  assert.equal(run(wt, 'status', '--porcelain'), '');
});

test('D: runtime check: Node version, the quoted test glob on Node 20, package manager and installed deps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-rt-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ engines: { node: '>=22' }, scripts: { test: "node --test 'test/*.test.*'" }, devDependencies: { vite: '1' } }));
  const b = w.runtimeCheck(dir, { nodeVersion: '20.11.0', has: () => true });
  assert.deepEqual(b.map((x) => x.title), ['Wrong Node version', 'Test glob needs Node 21+', 'Dependencies not installed']);
  assert.ok(b.every((x) => x.next));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  assert.deepEqual(w.runtimeCheck(dir, { nodeVersion: '22.22.0', has: () => true }), []);
  assert.equal(w.runtimeCheck(dir, { nodeVersion: null, has: () => false })[0].title, 'Node.js not found');
  assert.equal(w.nodeSatisfies('^20 || ^22', '22.1.0'), true);
  assert.equal(w.nodeSatisfies('20.x', '22.1.0'), false);
  assert.equal(w.nodeSatisfies('~22.1', '22.1.9'), true);
});

test('E: a verify-only run can change nothing: stray commits and edits are discarded (recoverably) and reported', async () => {
  const { wt, run, commit } = setup();
  const start = commit(wt, 'b.txt', 'task\n', 'task work');
  const before = await w.snapshot({ git, dir: wt });
  commit(wt, 'b.txt', 'sneaky\n', 'commit during verify');
  fs.writeFileSync(path.join(wt, 'a.txt'), 'edited\n');
  fs.writeFileSync(path.join(wt, 'new.txt'), 'new\n');
  const r = await w.enforceVerify({ git, dir: wt, before, stamp: 1, taskId: 'ABC123' });
  assert.equal(r.ok, false);
  assert.equal(r.commits.length, 1);
  assert.match(r.commits[0], /commit during verify/);
  assert.deepEqual(r.files.sort(), ['a.txt', 'new.txt']);
  assert.equal(run(wt, 'rev-parse', 'HEAD'), start, 'head back to where the run started');
  assert.equal(fs.readFileSync(path.join(wt, 'a.txt'), 'utf8'), 'one\n');
  assert.equal(fs.existsSync(path.join(wt, 'new.txt')), false);
  assert.ok(fs.existsSync(path.join(wt, '.hearth-ai', 'discarded', '1', 'new.txt')), 'new files kept aside');
  assert.equal(r.backupRef, 'refs/hearth/discarded/ABC123/1');
  assert.match(run(wt, 'log', '-1', '--format=%s', r.backupRef), /commit during verify/, 'commits kept on a per-task ref');
  assert.equal(run(wt, 'stash', 'list'), '', 'the shared stash is never used');
  const clean = await w.enforceVerify({ git, dir: wt, before: await w.snapshot({ git, dir: wt }), stamp: 2, taskId: 'ABC123' });
  assert.equal(clean.ok, true);
});

test('F: sha lock: commits after approval go to a follow-up branch; the task branch is exactly the approved commit', async () => {
  const { wt, run, commit } = setup();
  const approved = commit(wt, 'b.txt', 'approved\n', 'approved work');
  commit(wt, 'b.txt', 'late\n', 'late change');
  const r = await w.splitFollowup({ git, dir: wt, approved });
  assert.ok(r.ok, r.reason);
  assert.equal(r.followup.startsWith('hearth/abc123-task-followup-'), true);
  assert.equal(run(wt, 'rev-parse', 'HEAD'), approved);
  assert.match(run(wt, 'log', '-1', '--format=%s', r.followup), /late change/, 'later work kept');
  assert.equal(r.commits.length, 1);
  assert.deepEqual(await w.splitFollowup({ git, dir: wt, approved }), { ok: true, moved: false });
  assert.equal((await w.splitFollowup({ git, dir: wt, approved: 'f'.repeat(40) })).ok, false);
});

test('J: docs and research runs keep docs changes and put everything else back', async () => {
  const { wt, run, commit } = setup();
  const start = run(wt, 'rev-parse', 'HEAD');
  commit(wt, 'a.txt', 'changed code\n', 'touch code');
  fs.mkdirSync(path.join(wt, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'docs/guide.md'), '# guide\n');
  fs.writeFileSync(path.join(wt, 'README.md'), '# updated\n');
  fs.writeFileSync(path.join(wt, 'src.js'), 'x\n');
  const r = await w.enforceDocs({ git, dir: wt, startSha: start });
  assert.deepEqual(r.discarded.sort(), ['a.txt', 'src.js']);
  assert.deepEqual(r.kept.sort(), ['README.md', 'docs/guide.md']);
  assert.equal(fs.readFileSync(path.join(wt, 'a.txt'), 'utf8'), 'one\n');
  assert.equal(fs.existsSync(path.join(wt, 'src.js')), false);
  const m = w.docsMatcher(['*.md', 'notes/**']);
  assert.equal(m('x/y.md'), false);
  assert.equal(m('notes/a/b.txt'), true);
});

test('G: review data: diff since the last sign-off and the commits after each CHANGES', async () => {
  const { wt, commit } = setup();
  const signed = commit(wt, 'b.txt', '1\n', 'first');
  const changesAt = signed;
  commit(wt, 'b.txt', '2\n', 'address review');
  const r = await w.reviewData({ git, dir: wt, from: signed, def: 'main', changes: [changesAt] });
  assert.equal(r.baseLabel, 'your last sign-off');
  assert.match(r.log, /address review/);
  assert.doesNotMatch(r.log, /first/);
  assert.match(r.diff, /\+2/);
  assert.equal(r.commitsAfter[changesAt].length, 1);
  const vsMain = await w.reviewData({ git, dir: wt, from: null, def: 'main' });
  assert.equal(vsMain.baseLabel, 'main');
  assert.match(vsMain.log, /first/);
});

test('D: the lead may revert a task-branch commit (undo = revert the revert), never one already on main', async () => {
  const { proj, wt, run, commit } = setup();
  const bad = commit(wt, 'out.txt', 'out of scope\n', 'out of scope change');
  const r = await w.revertOnTask({ git, dir: wt, sha: bad.slice(0, 8), def: 'main' });
  assert.ok(r.ok, r.reason);
  assert.equal(fs.existsSync(path.join(wt, 'out.txt')), false);
  const undo = await w.revertOnTask({ git, dir: wt, sha: r.head, def: 'main' });
  assert.ok(undo.ok, undo.reason);
  assert.equal(fs.existsSync(path.join(wt, 'out.txt')), true);
  const onMain = run(proj, 'rev-parse', 'main');
  const refused = await w.revertOnTask({ git, dir: wt, sha: onMain, def: 'main' });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /already on main/);
  assert.equal((await w.revertOnTask({ git, dir: proj, sha: onMain, def: 'main' })).ok, false, 'never on main itself');
});

test('K: asset scan finds new images in the workspace, the assets folder and paths in the reply; files are copied, never moved', async () => {
  const { wt } = setup();
  const assets = path.join(wt, '.hearth-ai', 'assets', 'google');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(wt, 'mock.png'), 'x');
  fs.mkdirSync(path.join(wt, 'public'));
  fs.writeFileSync(path.join(wt, 'public', 'icon.png'), 'x');
  fs.writeFileSync(path.join(assets, 'gen.webp'), 'x');
  const found = await w.scanAssets({ git, dir: wt, assetsDir: assets, text: 'Saved the diagram to ./mock.png and also see /etc/passwd.png', sinceMs: Date.now() - 60000 });
  const by = Object.fromEntries(found.map((f) => [f.rel, f]));
  assert.ok(by['mock.png'] && by['public/icon.png']);
  assert.ok(found.every((f) => f.move === false), 'nothing is marked to move');
  assert.equal(by['.hearth-ai/assets/google/gen.webp'].source, 'assets');
  assert.equal(found.some((f) => f.rel.includes('passwd')), false, 'nothing outside the workspace');
  const rel = w.copyIntoAssets(wt, 'public/icon.png', assets);
  assert.equal(rel, '.hearth-ai/assets/google/icon.png');
  assert.ok(fs.existsSync(path.join(wt, 'public', 'icon.png')), 'the project file stays in the worktree');
  assert.equal(w.moveIntoAssets, undefined, 'there is no move any more');
});

test('I: release facts: the commit, tasks since the last tag, the notes file and the version file', async () => {
  const { proj, run, commit } = setup();
  run(proj, 'tag', 'v1.0.0');
  commit(proj, 'x.txt', 'x\n', 'Merge hearth/7vpj34-text-size-option (approved in Hearth AI Command Center)');
  commit(proj, 'release-notes/v1.1.0.md', '- Text size option\n', 'notes');
  const f = await w.releaseFacts({ git, dir: proj, ref: 'main', version: 'v1.1.0', versionFile: 'README.md' });
  assert.ok(f.ok);
  assert.equal(f.lastTag, 'v1.0.0');
  assert.equal(f.commits.length, 2);
  assert.deepEqual(f.tasks.map((t) => t.id), ['7VPJ34']);
  assert.equal(f.notes, '- Text size option');
  assert.deepEqual(w.parseLsRemote(`${'a'.repeat(40)}\trefs/tags/v1.0.0\n${'b'.repeat(40)}\trefs/tags/v1.0.0^{}\n`), [{ name: 'v1.0.0', sha: 'b'.repeat(40) }]);
});

test('L: background jobs keep progress lines, count restarts survived, list output files and can be retried', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-jobs-'));
  const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-assets-'));
  let alive = true;
  const jobs = jobsMod.createJobs({ dir, spawnRunner: () => 4242, isAlive: () => alive });
  const j = jobs.start({ agent: 'google', kind: 'image', title: 'icon', prompt: 'p', extraEnv: { HEARTH_AI_ASSETS: assets } });
  const p = jobsMod.createProgress(path.join(dir, `${j.id}.progress.log`), { every: 0 });
  p.line('started');
  p.chunk('step 1\nstep 2\npart');
  p.flush();
  fs.writeFileSync(path.join(assets, 'icon.png'), 'x');
  const again = jobsMod.createJobs({ dir, spawnRunner: () => 4243, isAlive: () => alive }); // the app restarted
  const v = again.list()[0];
  assert.equal(v.restarts, 1);
  assert.deepEqual(v.progress.slice(1), ['step 1', 'step 2', 'part']);
  assert.equal(v.outputs.length, 1);
  assert.equal(again.retry(j.id).ok, false, 'a running job is not retried');
  alive = false;
  const r = again.retry(j.id);
  assert.equal(r.retryOf, j.id);
  assert.equal(r.title, 'icon');
});

test('M: video resolution from ffmpeg and PNG colour depth', () => {
  assert.deepEqual(probeResolution('Stream #0:0(und): Video: h264 (High), yuv420p(progressive), 1280x720 [SAR 1:1 DAR 16:9], 30 fps'), { width: 1280, height: 720 });
  const png = Buffer.alloc(32);
  png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20); png[24] = 8; png[25] = 6;
  assert.deepEqual(imageSize(png), { format: 'PNG', width: 640, height: 480, depth: 8, color: 'RGBA' });
});

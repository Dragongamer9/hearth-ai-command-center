const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const g = require('../electron/git.cjs');

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-git-'));
  const remote = path.join(tmp, 'remote.git');
  const proj = path.join(tmp, 'proj');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['clone', '-q', remote, proj], { stdio: 'ignore' });
  const run = (...a) => execFileSync('git', a, { cwd: proj }).toString().trim();
  run('checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'one\n');
  run('add', '.');
  run(...ID, 'commit', '-qm', 'init');
  run('push', '-q', '-u', 'origin', 'main');
  return { tmp, remote, proj, run };
}
const remoteHas = (remote, ref) => { try { execFileSync('git', ['--git-dir', remote, 'rev-parse', '--verify', ref], { stdio: 'ignore' }); return true; } catch { return false; } };

test('parseRepo accepts owner/repo and GitHub links only', () => {
  assert.equal(g.parseRepo('Dragongamer9/hearth-os').url, 'https://github.com/Dragongamer9/hearth-os.git');
  assert.equal(g.parseRepo('https://github.com/Dragongamer9/hearth-os.git').repo, 'hearth-os');
  for (const bad of ['', 'x', '../../etc', 'https://evil.com/a/b', 'a/b; rm -rf ~', '-o/x', 'a/..']) assert.equal(g.parseRepo(bad), null, bad);
});

test('push task branches to GitHub; main/master are refused', async () => {
  const { proj, remote, run } = setup();
  run('checkout', '-q', '-b', 'hearth/abc123-thing');
  fs.writeFileSync(path.join(proj, 'b.txt'), 'two\n');
  run('add', '.');
  run(...ID, 'commit', '-qm', 'work');
  const r = await g.pushBranch(proj, 'hearth/abc123-thing');
  assert.ok(r.ok, r.message);
  assert.ok(remoteHas(remote, 'refs/heads/hearth/abc123-thing'));
  assert.equal((await g.pushBranch(proj, 'main')).ok, false);
  assert.equal((await g.pushBranch(proj, 'master')).ok, false);
  assert.equal((await g.pushBranch(proj, 'a;b')).ok, false);
  const st = await g.status(proj);
  assert.equal(st.defaultBranch, 'main');
  assert.ok(st.branches.find((b) => b.name === 'main').protected);
});

test('approved merge goes into main and is pushed; conflicts change nothing', async () => {
  const { proj, remote, run } = setup();
  run('checkout', '-q', '-b', 'hearth/t1-feature');
  fs.writeFileSync(path.join(proj, 'feature.txt'), 'new\n');
  run('add', '.');
  run(...ID, 'commit', '-qm', 'feature');
  run('checkout', '-q', 'hearth/t1-feature');
  process.env.GIT_AUTHOR_NAME = 't'; process.env.GIT_AUTHOR_EMAIL = 't@t';
  process.env.GIT_COMMITTER_NAME = 't'; process.env.GIT_COMMITTER_EMAIL = 't@t';
  const m = await g.mergeApproved(proj, 'hearth/t1-feature');
  assert.ok(m.ok, m.message);
  assert.ok(m.pushed, m.message);
  assert.equal(run('branch', '--show-current'), 'hearth/t1-feature', 'returns to the branch you had');
  assert.equal(execFileSync('git', ['--git-dir', remote, 'show', 'main:feature.txt']).toString(), 'new\n');

  // conflict
  run('checkout', '-q', 'main');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'main side\n');
  run(...ID, 'commit', '-qam', 'main edit');
  run('checkout', '-q', '-b', 'hearth/t2-clash', 'HEAD~1');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'branch side\n');
  run(...ID, 'commit', '-qam', 'clash');
  const before = run('rev-parse', 'main');
  const c = await g.mergeApproved(proj, 'hearth/t2-clash');
  assert.equal(c.ok, false);
  assert.match(c.message, /conflict/i);
  assert.equal(run('rev-parse', 'main'), before, 'main unchanged after a conflict');
  assert.equal(run('status', '--porcelain'), '');
});

test('pull is fast-forward only and refuses to overwrite uncommitted work', async () => {
  const { tmp, proj, remote } = setup();
  const other = path.join(tmp, 'other');
  execFileSync('git', ['clone', '-q', remote, other]);
  fs.writeFileSync(path.join(other, 'c.txt'), 'from elsewhere\n');
  execFileSync('git', ['add', '.'], { cwd: other });
  execFileSync('git', [...ID, 'commit', '-qm', 'remote change'], { cwd: other });
  execFileSync('git', ['push', '-q'], { cwd: other });
  fs.writeFileSync(path.join(proj, 'dirty.txt'), 'x');
  assert.equal((await g.pull(proj)).ok, false);
  fs.unlinkSync(path.join(proj, 'dirty.txt'));
  const r = await g.pull(proj);
  assert.ok(r.ok, r.message);
  assert.ok(fs.existsSync(path.join(proj, 'c.txt')));
});

test('a plain folder can start being tracked without changing its files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-plain-'));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
  assert.ok((await g.initRepo(dir)).ok);
  assert.ok(await g.isRepo(dir));
  assert.equal(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'), 'hello');
});
function branchWith(run, proj, name, file, text, from = 'main') {
  run('checkout', '-q', '-b', name, from);
  fs.writeFileSync(path.join(proj, file), text);
  run('add', '.');
  run(...ID, 'commit', '-qm', `${name} work`);
  run('checkout', '-q', 'main');
}

test('update from main brings a task branch up to date in its worktree; conflicts change nothing', async () => {
  const { tmp, proj, run } = setup();
  branchWith(run, proj, 'hearth/u1-ok', 'u1.txt', 'u1\n');
  branchWith(run, proj, 'hearth/u2-clash', 'a.txt', 'branch side\n');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'main side\n');
  run(...ID, 'commit', '-qam', 'main moves on');
  run('push', '-q', 'origin', 'main');
  const mainBefore = run('rev-parse', 'main');
  const wt1 = path.join(tmp, 'wt1');
  const wt2 = path.join(tmp, 'wt2');
  run('worktree', 'add', '-q', wt1, 'hearth/u1-ok');
  run('worktree', 'add', '-q', wt2, 'hearth/u2-clash');

  const ok = await g.updateFromMain(proj, wt1);
  assert.ok(ok.ok, ok.message);
  assert.equal(ok.changed, true);
  assert.equal(fs.readFileSync(path.join(wt1, 'a.txt'), 'utf8'), 'main side\n');
  assert.ok(fs.existsSync(path.join(wt1, 'u1.txt')));
  assert.equal((await g.updateFromMain(proj, wt1)).changed, false, 'second time: already up to date');

  const before2 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt2 }).toString().trim();
  const bad = await g.updateFromMain(proj, wt2);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.conflicts, ['a.txt']);
  assert.match(bad.message, /Conflicts with main in a\.txt/);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt2 }).toString().trim(), before2);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: wt2 }).toString().trim(), '');
  assert.equal(run('rev-parse', 'main'), mainBefore, 'main is never changed');
});

test('release branch merges several approved tasks, reports conflicts, never touches main', async () => {
  const { proj, remote, run } = setup();
  branchWith(run, proj, 'hearth/r1-one', 'one.txt', '1\n');
  branchWith(run, proj, 'hearth/r2-two', 'two.txt', '2\n');
  branchWith(run, proj, 'hearth/r3-clash', 'one.txt', 'other\n');
  const mainBefore = run('rev-parse', 'main');
  const r = await g.releaseBranch(proj, 'release/tasks-test', ['hearth/r1-one', 'hearth/r2-two', 'hearth/r3-clash']);
  assert.ok(r.ok, r.message);
  assert.deepEqual(r.merged, ['hearth/r1-one', 'hearth/r2-two']);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].branch, 'hearth/r3-clash');
  assert.deepEqual(r.conflicts[0].files, ['one.txt']);
  assert.match(r.message, /Conflict: hearth\/r3-clash in one\.txt/);
  assert.match(r.message, /Main was not changed/);
  assert.ok(r.pushed);
  assert.ok(remoteHas(remote, 'refs/heads/release/tasks-test'));
  assert.equal(execFileSync('git', ['--git-dir', remote, 'show', 'release/tasks-test:two.txt']).toString(), '2\n');
  assert.equal(run('rev-parse', 'main'), mainBefore);
  assert.equal(execFileSync('git', ['--git-dir', remote, 'rev-parse', 'main']).toString().trim(), mainBefore);
  assert.equal(run('branch', '--show-current'), 'main');
  assert.equal((await g.releaseBranch(proj, 'release/tasks-test', ['hearth/r1-one'])).ok, false, 'never overwrites');
  assert.equal((await g.releaseBranch(proj, 'main', ['hearth/r1-one'])).ok, false);
  assert.equal((await g.releaseBranch(proj, 'release/x', ['main'])).ok, false);
});

test('lead GitHub: only task and release branches, main protected, no tags', async () => {
  assert.equal(g.leadGitAllowed('fetch').ok, true);
  assert.equal(g.leadGitAllowed('pull').ok, true);
  assert.equal(g.leadGitAllowed('push', 'hearth/abc123-x').ok, true);
  assert.equal(g.leadGitAllowed('push', 'release/next').ok, true);
  for (const b of ['main', 'master', 'develop', 'v0.7.0', 'refs/tags/v1', 'hearth/../main', '']) assert.equal(g.leadGitAllowed('push', b).ok, false, b);
  for (const op of ['tag', 'release', 'merge-main']) assert.match(g.leadGitAllowed(op).reason, /stays with the Owner/);

  const { proj, remote, run } = setup();
  run(...ID, 'tag', 'v9.9.9');
  branchWith(run, proj, 'hearth/l1-one', 'l1.txt', '1\n');
  branchWith(run, proj, 'hearth/l2-two', 'l2.txt', '2\n');
  branchWith(run, proj, 'hearth/l3-clash', 'l1.txt', 'other\n');
  const mainBefore = run('rev-parse', 'main');
  const p = await g.leadPush(proj, 'hearth/l1-one');
  assert.ok(p.ok, p.message);
  assert.match(p.message, /Pushed hearth\/l1-one \([0-9a-f]+\)/);
  assert.equal((await g.leadPush(proj, 'main')).ok, false);
  const i1 = await g.integrateIntoRelease(proj, 'release/next', 'hearth/l1-one');
  assert.ok(i1.ok, i1.message);
  assert.ok(i1.pushed);
  const i2 = await g.integrateIntoRelease(proj, 'release/next', 'hearth/l2-two');
  assert.ok(i2.ok, i2.message);
  assert.equal(execFileSync('git', ['--git-dir', remote, 'show', 'release/next:l2.txt']).toString(), '2\n');
  const i3 = await g.integrateIntoRelease(proj, 'release/next', 'hearth/l3-clash');
  assert.equal(i3.ok, false);
  assert.deepEqual(i3.conflicts, ['l1.txt']);
  assert.equal((await g.integrateIntoRelease(proj, 'main', 'hearth/l1-one')).ok, false, 'never onto main');
  const f = await g.leadFetch(proj);
  assert.ok(f.ok, f.message);
  assert.equal(run('rev-parse', 'main'), mainBefore, 'main untouched');
  assert.equal(execFileSync('git', ['--git-dir', remote, 'rev-parse', 'main']).toString().trim(), mainBefore);
  assert.equal(remoteHas(remote, 'refs/tags/v9.9.9'), false, 'no tags are ever pushed');
});

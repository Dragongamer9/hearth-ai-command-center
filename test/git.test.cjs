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

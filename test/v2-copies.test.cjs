// 2.x temporary copies: shallow, removed on close/delete/idle, never delete unpushed work
// without asking, never use a copy from another repo, never push to main.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createCopies, prePushHook, sourceOf } = require('../electron/copies.cjs');

// Temp folders made by this file are removed when it finishes.
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Dragongamer9', GIT_AUTHOR_EMAIL: 'Dragongamer9@users.noreply.github.com', GIT_COMMITTER_NAME: 'Dragongamer9', GIT_COMMITTER_EMAIL: 'Dragongamer9@users.noreply.github.com' } }).trim();

// Two "GitHub" repos as local bare repos, each with 3 commits on main.
function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-copies-'));
  made.push(tmp);
  const remotes = {};
  for (const name of ['Dragongamer9/alpha', 'Dragongamer9/beta']) {
    const bare = path.join(tmp, 'gh', `${name}.git`);
    fs.mkdirSync(bare, { recursive: true });
    g(bare, 'init', '-q', '--bare', '-b', 'main');
    const work = path.join(tmp, 'seed', name);
    fs.mkdirSync(work, { recursive: true });
    g(work, 'init', '-q', '-b', 'main');
    for (let i = 1; i <= 3; i++) { fs.writeFileSync(path.join(work, 'f.txt'), `v${i} ${name}\n`); g(work, 'add', '.'); g(work, 'commit', '-q', '-m', `c${i}`); }
    g(work, 'remote', 'add', 'origin', bare);
    g(work, 'push', '-q', 'origin', 'main');
    remotes[name] = bare;
  }
  const data = path.join(tmp, 'data');
  let clock = new Date('2026-11-04T12:00:00Z');
  const copies = createCopies({ dataDir: data, urlFor: (repo) => `file://${remotes[Object.keys(remotes).find((k) => k.toLowerCase() === repo.toLowerCase())]}`, owner: () => ({ name: 'Dragongamer9', email: 'Dragongamer9@users.noreply.github.com' }), now: () => clock });
  return { tmp, data, remotes, copies, setClock: (d) => { clock = d; } };
}

test('a copy is a shallow, single-branch clone on the chat\'s own branch', async () => {
  const f = fixture();
  const c = await f.copies.ensure({ chatId: 'c0123456789', repo: 'Dragongamer9/alpha', branch: 'main', title: 'Fix Wi-Fi list' });
  assert.equal(c.created, true);
  assert.equal(g(c.dir, 'rev-parse', '--is-shallow-repository'), 'true');
  assert.equal(g(c.dir, 'rev-list', '--count', 'HEAD'), '1', 'depth 1: only the newest commit');
  assert.deepEqual(g(c.dir, 'branch', '-r').split('\n').map((s) => s.trim()).filter((s) => !s.includes('->')), ['origin/main'], 'single branch');
  assert.equal(g(c.dir, 'branch', '--show-current'), c.work);
  assert.match(c.work, /^hearth\/fix-wi-fi-list-6789$/);
  assert.ok(fs.readFileSync(path.join(c.dir, '.git', 'hooks', 'pre-push'), 'utf8').includes('refs/heads/main'));
  assert.match(fs.readFileSync(path.join(c.dir, '.git', 'info', 'exclude'), 'utf8'), /\.hearth-preview\//);
  // Reused, not cloned again.
  const again = await f.copies.ensure({ chatId: 'c0123456789', repo: 'Dragongamer9/alpha', branch: 'main', title: 'x' });
  assert.equal(again.created, false);
});

test('a copy from another repo is never used (and never deleted by it)', async () => {
  const f = fixture();
  const c = await f.copies.ensure({ chatId: 'c0123456789', repo: 'Dragongamer9/alpha', branch: 'main' });
  await assert.rejects(() => f.copies.ensure({ chatId: 'c0123456789', repo: 'Dragongamer9/beta', branch: 'main' }), (e) => e.wrongRepo === true);
  assert.equal(await f.copies.belongs('c0123456789', { repo: 'Dragongamer9/beta' }), false);
  assert.equal(await f.copies.belongs('c0123456789', { repo: 'dragongamer9/ALPHA' }), true, 'GitHub names are case-insensitive');
  // Someone points the copy's origin at another repo behind the app's back: refused too.
  g(c.dir, 'remote', 'set-url', 'origin', `file://${f.remotes['Dragongamer9/beta']}`);
  assert.equal(await f.copies.belongs('c0123456789', { repo: 'Dragongamer9/alpha' }), false);
  await assert.rejects(() => f.copies.ensure({ chatId: 'c0123456789', repo: 'Dragongamer9/alpha', branch: 'main' }), (e) => e.wrongRepo === true);
  assert.ok(fs.existsSync(c.dir), 'the mismatched copy is left alone, not deleted');
});

test('removing a copy with unpushed work is refused unless forced; push makes it safe', async () => {
  const f = fixture();
  const c = await f.copies.ensure({ chatId: 'c0123456789', repo: 'Dragongamer9/alpha', branch: 'main', title: 'work' });
  assert.equal((await f.copies.status('c0123456789')).unpushed, false, 'a fresh copy holds nothing new');
  fs.writeFileSync(path.join(c.dir, 'new.txt'), 'hello\n');
  let st = await f.copies.status('c0123456789');
  assert.equal(st.unpushed, true);
  assert.equal(st.dirty, 1);
  let r = await f.copies.remove('c0123456789');
  assert.equal(r.ok, false);
  assert.equal(r.unpushed, true);
  assert.ok(fs.existsSync(path.join(c.dir, 'new.txt')), 'nothing deleted');
  // Committed but not pushed still counts as unpushed.
  const commit = await f.copies.commitAll('c0123456789', 'Add new.txt\n\nCo-Authored-By: Claude <noreply@anthropic.com>');
  assert.ok(commit.sha);
  assert.doesNotMatch(g(c.dir, 'log', '-1', '--format=%B'), /Co-Authored-By/i, 'no AI attribution lines');
  assert.equal(g(c.dir, 'log', '-1', '--format=%an <%ae>'), 'Dragongamer9 <Dragongamer9@users.noreply.github.com>');
  st = await f.copies.status('c0123456789');
  assert.equal(st.ahead, 1);
  assert.equal((await f.copies.remove('c0123456789')).ok, false);
  // Push to the chat's branch, then it can go.
  const p = await f.copies.push('c0123456789');
  assert.equal(p.ok, true, p.message);
  assert.equal(g(f.remotes['Dragongamer9/alpha'], 'rev-parse', `refs/heads/${c.work}`), p.sha);
  assert.equal(g(f.remotes['Dragongamer9/alpha'], 'rev-list', '--count', 'main'), '3', 'main untouched');
  assert.equal((await f.copies.status('c0123456789')).unpushed, false);
  r = await f.copies.remove('c0123456789');
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(c.dir), false);
});

test('force removes unpushed work only when asked (the window asks the owner first)', async () => {
  const f = fixture();
  const c = await f.copies.ensure({ chatId: 'team-abcd1234', repo: 'Dragongamer9/alpha', branch: 'main' });
  fs.writeFileSync(path.join(c.dir, 'x.txt'), 'x');
  assert.equal((await f.copies.remove('team-abcd1234', { force: true })).ok, true);
  assert.equal(fs.existsSync(c.dir), false);
});

test('idle copies are removed; idle copies with unpushed work are kept and reported', async () => {
  const f = fixture();
  await f.copies.ensure({ chatId: 'c0000000001', repo: 'Dragongamer9/alpha', branch: 'main' });
  const b = await f.copies.ensure({ chatId: 'c0000000002', repo: 'Dragongamer9/beta', branch: 'main' });
  fs.writeFileSync(path.join(b.dir, 'wip.txt'), 'wip');
  f.setClock(new Date('2026-11-04T20:00:00Z'));
  let r = await f.copies.sweep({ idleHours: 24 });
  assert.equal(r.removed.length, 0, 'not idle long enough');
  f.setClock(new Date('2026-11-06T12:00:00Z'));
  r = await f.copies.sweep({ idleHours: 0 });
  assert.equal(r.removed.length, 0, '0 = never');
  r = await f.copies.sweep({ idleHours: 24 });
  assert.deepEqual(r.removed.map((c) => c.chatId), ['c0000000001']);
  assert.deepEqual(r.keptUnpushed.map((c) => c.chatId), ['c0000000002']);
  assert.ok(fs.existsSync(path.join(b.dir, 'wip.txt')));
  assert.equal(f.copies.exists('c0000000001'), false);
});

test('nothing is ever pushed to main, the base branch or a tag (pre-push hook)', async () => {
  const f = fixture();
  const c = await f.copies.ensure({ chatId: 'c0123456789', repo: 'Dragongamer9/alpha', branch: 'main' });
  fs.writeFileSync(path.join(c.dir, 'evil.txt'), 'x');
  await f.copies.commitAll('c0123456789', 'x');
  const env = { ...process.env, HEARTH_AI_APP: '1' };
  assert.throws(() => execFileSync('git', ['push', 'origin', 'HEAD:refs/heads/main'], { cwd: c.dir, env, stdio: 'pipe' }));
  assert.throws(() => execFileSync('git', ['push', 'origin', 'HEAD:refs/tags/v9.9'], { cwd: c.dir, env, stdio: 'pipe' }));
  assert.equal(g(f.remotes['Dragongamer9/alpha'], 'rev-list', '--count', 'main'), '3');
  assert.match(prePushHook(['main', 'bughunt']), /refs\/heads\/main\|refs\/heads\/bughunt\)?|refs\/tags/);
});

test('the push refuses commits that aren\'t the owner\'s', async () => {
  const f = fixture();
  const c = await f.copies.ensure({ chatId: 'c0123456789', repo: 'Dragongamer9/alpha', branch: 'main' });
  fs.writeFileSync(path.join(c.dir, 'a.txt'), 'a');
  execFileSync('git', ['add', '.'], { cwd: c.dir });
  execFileSync('git', ['-c', 'user.name=Claude', '-c', 'user.email=noreply@anthropic.com', 'commit', '-q', '--no-verify', '-m', 'x'], { cwd: c.dir, env: { ...process.env, GIT_AUTHOR_NAME: 'Claude', GIT_AUTHOR_EMAIL: 'noreply@anthropic.com', GIT_COMMITTER_NAME: 'Claude', GIT_COMMITTER_EMAIL: 'noreply@anthropic.com' } });
  const p = await f.copies.push('c0123456789');
  assert.equal(p.ok, false);
  assert.match(p.message, /authored by Claude/);
});

test('changes, diff and "Save to repo" stay inside the copy', async () => {
  const f = fixture();
  const c = await f.copies.ensure({ chatId: 'c0123456789', repo: 'Dragongamer9/alpha', branch: 'main' });
  fs.writeFileSync(path.join(c.dir, 'f.txt'), 'changed\nmore\n');
  fs.mkdirSync(path.join(c.dir, '.hearth-preview'));
  fs.writeFileSync(path.join(c.dir, '.hearth-preview', 'p.html'), '<b>x</b>');
  const ch = await f.copies.changes('c0123456789');
  assert.deepEqual(ch.files.map((x) => x.path), ['f.txt'], 'previews are never part of the changes');
  assert.match(await f.copies.diff('c0123456789'), /\+changed/);
  for (const bad of ['../x.html', '/etc/x', '.git/hooks/pre-push', '']) assert.equal((await f.copies.writeFile('c0123456789', bad, 'x')).ok, false, bad);
  const w = await f.copies.writeFile('c0123456789', 'docs/mockups/page.html', '<p>hi</p>');
  assert.equal(w.ok, true);
  assert.equal(fs.readFileSync(path.join(c.dir, 'docs/mockups/page.html'), 'utf8'), '<p>hi</p>');
  assert.equal(g(c.dir, 'log', '-1', '--format=%s'), 'Add docs/mockups/page.html');
});

test('origins are read from git itself', () => {
  assert.deepEqual(sourceOf('https://github.com/Dragongamer9/hearth-os.git'), { repo: 'Dragongamer9/hearth-os' });
  assert.deepEqual(sourceOf('git@github.com:Dragongamer9/hearth-os'), { repo: 'Dragongamer9/hearth-os' });
  assert.deepEqual(sourceOf('file:///tmp/x/'), { dir: '/tmp/x' });
  assert.equal(sourceOf('https://gitlab.com/a/b'), null);
});

// 2.10: teammates working at the same time, each in its own lane (a worktree on its own local branch).
test('lanes: two teammates change different files at once and both are merged into the chat\'s branch as the owner', async () => {
  const f = fixture();
  const c = await f.copies.ensure({ chatId: 'c0123456781', repo: 'Dragongamer9/alpha', branch: 'main', title: 'Port' });
  const a = await f.copies.lane('c0123456781', 'openai');
  const b = await f.copies.lane('c0123456781', 'google');
  assert.notEqual(a.dir, b.dir);
  assert.equal(g(a.dir, 'branch', '--show-current'), `${c.work}--openai`);
  fs.writeFileSync(path.join(a.dir, 'parser.js'), 'parse\n');
  fs.writeFileSync(path.join(b.dir, 'tests.js'), 'test\n');
  await f.copies.commitAll('c0123456781', 'parser', a.dir);
  await f.copies.commitAll('c0123456781', 'tests', b.dir);
  assert.ok(!fs.existsSync(path.join(c.dir, 'parser.js')), 'the chat\'s copy is untouched while they work');
  assert.equal((await f.copies.laneChanges('c0123456781', 'openai')).files[0].path, 'parser.js');
  const m = await f.copies.mergeLanes('c0123456781', ['openai', 'google'], { openai: 'ChatGPT', google: 'Gemini' });
  assert.deepEqual(m.merged.map((x) => x.agent), ['openai', 'google']);
  assert.deepEqual(m.conflicts, []);
  assert.ok(fs.existsSync(path.join(c.dir, 'parser.js')) && fs.existsSync(path.join(c.dir, 'tests.js')));
  assert.equal(g(c.dir, 'branch', '--show-current'), c.work);
  assert.match(g(c.dir, 'log', '--format=%s', '-n', '1'), /^Merge Gemini's part$/);
  assert.deepEqual(g(c.dir, 'log', '--format=%an <%ae>', '-n', '4').split('\n').filter((x, i, l) => l.indexOf(x) === i), ['Dragongamer9 <Dragongamer9@users.noreply.github.com>'], 'every commit is the owner\'s');
  assert.equal(g(c.dir, 'branch', '--list', `${c.work}--*`), '', 'merged lanes are gone');
  assert.ok(!fs.existsSync(a.dir) && !fs.existsSync(b.dir));
  assert.equal((await f.copies.status('c0123456781')).dirty, 0);
});

test('lanes: a clash is not merged, the chat\'s copy stays clean and the work is kept on the teammate\'s branch', async () => {
  const f = fixture();
  const c = await f.copies.ensure({ chatId: 'c0123456782', repo: 'Dragongamer9/alpha', branch: 'main', title: 'Port' });
  const a = await f.copies.lane('c0123456782', 'openai');
  const b = await f.copies.lane('c0123456782', 'google');
  fs.writeFileSync(path.join(a.dir, 'f.txt'), 'ChatGPT\n');
  fs.writeFileSync(path.join(b.dir, 'f.txt'), 'Gemini\n');
  await f.copies.commitAll('c0123456782', 'a', a.dir);
  await f.copies.commitAll('c0123456782', 'b', b.dir);
  const m = await f.copies.mergeLanes('c0123456782', ['openai', 'google']);
  assert.deepEqual(m.merged.map((x) => x.agent), ['openai']);
  assert.equal(m.conflicts.length, 1);
  assert.deepEqual(m.conflicts[0].files, ['f.txt']);
  assert.equal(m.conflicts[0].branch, `${c.work}--google`);
  assert.equal(fs.readFileSync(path.join(c.dir, 'f.txt'), 'utf8'), 'ChatGPT\n');
  assert.equal((await f.copies.status('c0123456782')).dirty, 0, 'no half-done merge left behind');
  assert.equal(g(c.dir, 'show', `${c.work}--google:f.txt`), 'Gemini', 'Gemini\'s work is kept');
});

test('lanes: more work for the same teammate keeps its lane; a bad name is refused; removing the copy removes its lanes', async () => {
  const f = fixture();
  await f.copies.ensure({ chatId: 'c0123456783', repo: 'Dragongamer9/alpha', branch: 'main', title: 'Port' });
  const a = await f.copies.lane('c0123456783', 'openai');
  fs.writeFileSync(path.join(a.dir, 'x.js'), '1\n');
  await f.copies.commitAll('c0123456783', 'x', a.dir);
  const again = await f.copies.lane('c0123456783', 'openai');
  assert.equal(again.reused, true);
  assert.ok(fs.existsSync(path.join(again.dir, 'x.js')));
  await assert.rejects(() => f.copies.lane('c0123456783', '../evil'), /bad agent/);
  await f.copies.mergeLanes('c0123456783', ['openai']);
  const r = await f.copies.remove('c0123456783', { force: true });
  assert.equal(r.ok, true);
  assert.ok(!fs.existsSync(`${f.copies.dirOf('c0123456783')}.lanes`));
});

// Fixes from the independent review of the combined release (main-process side).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const id = require('../electron/ops/identity.cjs');
const tests = require('../electron/ops/tests.cjs');
const { createJobs, ownsPid } = require('../electron/ops/jobs.cjs');
const projects = require('../electron/ops/projects.cjs');
const phone = require('../electron/ops/phone.cjs');
const media = require('../electron/ops/media.cjs');
const ops = require('../electron/ops/index.cjs');
const approval = require('../electron/ops/approval.cjs');
const memory = require('../electron/ops/memory.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fix-'));
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const OWNER = id.cleanIdentity({ name: 'Dragongamer9', emails: ['Dragongamer9@users.noreply.github.com', '43799111+Dragongamer9@users.noreply.github.com', 'game305.cl@gmail.com'] });

test('fix 2: owner identity is a name plus emails; GitHub web-flow merges and every owner email pass', () => {
  assert.deepEqual(id.suggestIdentity('Dragongamer9', 'Dragongamer9@users.noreply.github.com').emails, ['Dragongamer9@users.noreply.github.com', '43799111+Dragongamer9@users.noreply.github.com', 'game305.cl@gmail.com']);
  const d = tmp();
  const g = (args, env = {}) => execFileSync('git', args, { cwd: d, encoding: 'utf8', env: { ...process.env, ...env } });
  const as = (n, e, cn = n, ce = e) => ({ GIT_AUTHOR_NAME: n, GIT_AUTHOR_EMAIL: e, GIT_COMMITTER_NAME: cn, GIT_COMMITTER_EMAIL: ce });
  g(['init', '-q', '-b', 'main']);
  g(['commit', '-q', '--allow-empty', '-m', 'one'], as('Dragongamer9', 'game305.cl@gmail.com'));
  g(['commit', '-q', '--allow-empty', '-m', 'two'], as('Dragongamer9', '43799111+Dragongamer9@users.noreply.github.com'));
  g(['checkout', '-q', '-b', 'side']); g(['commit', '-q', '--allow-empty', '-m', 'side'], as('Dragongamer9', 'Dragongamer9@users.noreply.github.com'));
  g(['checkout', '-q', 'main']); g(['merge', '-q', '--no-ff', '-m', 'Merge pull request #1', 'side'], as('Dragongamer9', 'Dragongamer9@users.noreply.github.com', 'GitHub', 'noreply@github.com'));
  const all = id.parseLog(g(['log', id.LOG_FORMAT, 'HEAD']));
  assert.equal(id.scanCommits(all, OWNER).ok, true, 'whole history passes');
  g(['commit', '-q', '--allow-empty', '-m', 'web edit'], as('Dragongamer9', 'game305.cl@gmail.com', 'GitHub', 'noreply@github.com'));
  assert.equal(id.scanCommits(id.parseLog(g(['log', id.LOG_FORMAT, 'HEAD~1..HEAD'])), OWNER).ok, false, 'web-flow only on merge commits');
  g(['commit', '-q', '--allow-empty', '--no-verify', '-m', 'old\n\nCo-Authored-By: Claude <noreply@anthropic.com>'], as('Dragongamer9', 'game305.cl@gmail.com'));
  const last = id.parseLog(g(['log', id.LOG_FORMAT, 'HEAD~1..HEAD']));
  assert.equal(id.scanCommits(last, OWNER).ok, false);
  assert.equal(id.scanCommits(last, OWNER, { ownerRelease: true }).ok, true, "the owner's own Release button isn't blocked by his own commits");
  g(['commit', '-q', '--allow-empty', '-m', 'x'], as('Claude', 'noreply@anthropic.com'));
  assert.equal(id.scanCommits(id.parseLog(g(['log', id.LOG_FORMAT, 'HEAD~1..HEAD'])), OWNER, { ownerRelease: true }).ok, false, 'but someone else\'s commit still is');
  const idx = read('electron/ops/index.cjs');
  assert.ok(!idx.includes('~50'), 'no silent ~50 range');
  assert.match(idx, /'--match', 'v\[0-9\]\*'/);
  assert.match(idx, /from \? `\$\{from\}\.\.\$\{to\}` : to/, 'whole history when there is no release tag');
});

test('fix 3: test command from the base branch, test-config changes flagged, deps and tokens', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ scripts: { test: 'echo ok' } }));
  assert.equal(tests.resolveTestCommand(null, d, JSON.stringify({ scripts: {} })), null, 'the task\'s own package.json does not decide');
  assert.equal(tests.resolveTestCommand(null, d, JSON.stringify({ scripts: { test: 'node --test' } })), 'npm test');
  const base = JSON.stringify({ scripts: { test: 'node --test' } });
  assert.deepEqual(tests.testConfigChanges(['src/a.js'], base, base), []);
  assert.deepEqual(tests.testConfigChanges(['package.json'], base, JSON.stringify({ scripts: { test: 'exit 0' } })), ['package.json (test scripts)']);
  assert.deepEqual(tests.testConfigChanges(['vitest.config.ts', '.github/workflows/ci.yml'], base, base), ['vitest.config.ts', '.github/workflows/ci.yml']);
  assert.equal(tests.needsDeps('npm test', d), true);
  assert.equal(tests.needsDeps('npm ci && npm test', d), false);
  const red = tests.redactTokens('API_KEY=abcdefghijk\ntoken: zzzzzzzzzz\n' + 'x'.repeat(10) + ' ' + 'A1b2C3d4'.repeat(6) + '\nok 1 - passes');
  assert.ok(!red.includes('abcdefghijk') && !red.includes('zzzzzzzzzz') && !red.includes('A1b2C3d4A1b2'));
  assert.match(red, /ok 1 - passes/);
  const idx = read('electron/ops/index.cjs');
  assert.match(idx, /'show', `\$\{base\}:package\.json`/);
  assert.match(idx, /reason: 'no dependencies installed'/);
});

test('fix 5: background jobs: limits, read-only unless the turn could edit, owned pids, valid ids', () => {
  assert.equal(ops.jobLimits([{ agent: 'google', status: 'running' }], 'google').ok, false);
  assert.equal(ops.jobLimits([{ agent: 'a', status: 'running' }, { agent: 'b', status: 'running' }, { agent: 'c', status: 'running' }], 'd').ok, false);
  assert.equal(ops.jobLimits([{ agent: 'google', status: 'done' }], 'google').ok, true);
  assert.equal(ops.jobMode({ requested: 'standard', canEdit: false, busy: false }), 'read');
  assert.equal(ops.jobMode({ requested: 'standard', canEdit: true, busy: true }), 'read', 'never writes where a normal run is active');
  assert.equal(ops.jobMode({ requested: 'standard', canEdit: true, busy: false }), 'standard');
  assert.equal(ownsPid(123, '/d/J1.json', () => 'node\0/x/job-runner.cjs\0/d/J1.json'), true);
  assert.equal(ownsPid(123, '/d/J1.json', () => 'bash\0'), false, 'a reused pid is not ours');
  const dir = tmp();
  const j = createJobs({ dir, spawnRunner: () => 1, isAlive: () => false });
  assert.equal(j.cancel('../../etc/passwd').ok, false);
  assert.equal(j.cancel('J1234').ok, false);
  const started = j.start({ agent: 'google', title: 't' });
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, `${started.id}.json`), 'utf8')).startedMs > 0);
  assert.match(read('electron/ops/job-runner.cjs'), /createWatchdog/);
});

test('fix 6: a corrupt projects file is never wiped: the .bak is restored or the file kept aside', () => {
  const d = tmp();
  const p = projects.createProjects(d);
  p.load('/home/o/hearth-os');
  p.setSettings('default', { nextVersion: '0.9.0' });
  p.setSettings('default', { testCommand: 'make check' }); // .bak now holds the 0.9.0 copy
  fs.writeFileSync(path.join(d, 'ops-projects.json'), '{ broken');
  const again = projects.createProjects(d);
  const reg = again.load('/elsewhere');
  assert.equal(reg.list[0].settings.nextVersion, '0.9.0', 'restored from .bak');
  assert.match(again.notice(), /last good copy was restored/);
  assert.ok(fs.readdirSync(d).some((f) => f.startsWith('ops-projects.json.corrupt-')), 'the broken file is kept');
  const d2 = tmp();
  fs.writeFileSync(path.join(d2, 'ops-projects.json'), 'garbage');
  const p2 = projects.createProjects(d2);
  p2.load('/x');
  assert.ok(fs.readdirSync(d2).some((f) => f.startsWith('ops-projects.json.corrupt-')));
  assert.match(p2.notice(), /kept at/);
});

test('fix 7: old Settings folders migrate into projects; the folder picker goes through the registry', () => {
  const d = tmp();
  const p = projects.createProjects(d);
  const reg = p.load('/home/o/hearth-os', ['/home/o/hearth-os', '/home/o/beacon', '/home/o/tributary']);
  assert.deepEqual(reg.list.map((x) => x.dir), ['/home/o/hearth-os', '/home/o/beacon', '/home/o/tributary']);
  const main = read('electron/main.cjs');
  assert.equal((main.match(/opsApi \? opsApi\.useFolder\(/g) || []).length, 3, 'pick, use and clone all go through projects');
  assert.match(main, /ops\.stateFile\(dataDir\(\), readSettings\(\)\.project, readSettings\(\)\.projects\)/);
});

test('fix 9: .hearth-ai/ goes in the shared exclude file; the tracked .gitignore is never edited', () => {
  const ws = read('electron/workspace.cjs');
  assert.ok(!ws.includes('ensureIgnored'));
  assert.match(ws, /`:\(exclude\)\$\{APP_DIR\}`/);
  const idx = read('electron/ops/index.cjs');
  assert.match(idx, /'rev-parse', '--git-path', 'info\/exclude'/);
  const d = tmp();
  execFileSync('git', ['init', '-q'], { cwd: d });
  const rel = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: d, encoding: 'utf8' }).trim();
  assert.match(rel, /info\/exclude$/);
});

test('fix 10: Real-ESRGAN keeps models, asks before an unverified download, keeps the old install', () => {
  assert.deepEqual(media.esrganArgs('in.png', 'out.png', '/t/realesrgan/realesrgan-ncnn-vulkan').slice(-2), ['-m', '/t/realesrgan/models']);
  assert.equal(media.needsConfirm({ sha256: null }), true);
  assert.equal(media.needsConfirm({ sha256: 'a'.repeat(64) }), false);
  const d = tmp();
  fs.mkdirSync(path.join(d, 'pkg'));
  fs.writeFileSync(path.join(d, 'pkg', 'realesrgan-ncnn-vulkan'), '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(media.esrganIn(d), path.join(d, 'pkg', 'realesrgan-ncnn-vulkan'));
  const idx = read('electron/ops/index.cjs');
  const inst = idx.slice(idx.indexOf("handle('ops:esrganInstall'"), idx.indexOf("// ---- background jobs"));
  assert.ok(!inst.includes("'-j'"), 'unzip keeps folders');
  assert.match(inst, /Unverified download/);
  assert.ok(inst.indexOf('fs.rmSync(dir, { recursive: true, force: true })') > inst.indexOf('media.esrganIn(fresh)'), 'old install removed only after the new one works');
});

test('fix 11: settings live in memory; on-disk edits wait for the owner to keep or discard', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /if \(settingsMem === null\) settingsMem = loadSettingsFile\(\);/);
  assert.match(main, /changed: \(\) =>/);
  const idx = read('electron/ops/index.cjs');
  assert.match(idx, /send\('ops:diskChange'/);
  assert.match(read('src/ops/ui.mjs'), /changed outside the app — keep or discard\?/);
  const d = tmp();
  const p = projects.createProjects(d);
  p.load('/x');
  p.setSettings('default', { nextVersion: '0.9.0' });
  assert.equal(p.changedOnDisk(), false);
  const f = path.join(d, 'ops-projects.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.list[0].settings.nextVersion = '9.9.9'; // an AI edits the file
  fs.writeFileSync(f, JSON.stringify(j));
  assert.equal(p.changedOnDisk(), true);
  assert.equal(p.byId('default').settings.nextVersion, '0.9.0', 'not applied by itself');
  p.discardDisk();
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).list[0].settings.nextVersion, '0.9.0');
});

test('fix 12: phone binds one LAN interface, tokens expire after 30 days, the body limit always settles', async () => {
  const ifaces = { eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.5' }], wlan0: [{ family: 'IPv4', internal: false, address: '10.0.0.7' }], docker0: [{ family: 'IPv4', internal: false, address: '8.8.8.8' }] };
  assert.equal(phone.pickHost('10.0.0.7', ifaces), '10.0.0.7');
  assert.equal(phone.pickHost('1.2.3.4', ifaces), '192.168.1.5');
  assert.equal(phone.pickHost(null, {}), null);
  assert.equal(phone.tokenValid({ expires: Date.now() - 1 }), false);
  assert.equal(phone.tokenValid({ expires: Date.now() + 1000 }), true);
  assert.equal(phone.TOKEN_TTL_MS, 30 * 24 * 3600e3);
  assert.ok(!read('electron/ops/phone.cjs').includes("'0.0.0.0'"));
  const server = http.createServer(async (req, res) => { const b = await phone.readJson(req, 100); res.end(JSON.stringify({ got: b })); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const send = (body) => new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/' }, (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve(s)); });
    r.on('error', () => resolve('closed'));
    r.end(body);
  });
  assert.equal(await send('{"a":1}'), '{"got":{"a":1}}');
  const big = await Promise.race([send('x'.repeat(5000)), new Promise((r) => setTimeout(() => r('hung'), 3000))]);
  assert.notEqual(big, 'hung', 'oversized bodies settle instead of hanging');
  server.close();
  assert.match(read('src/ops/ui.mjs'), /plain HTTP on your local network/);
});

test('fix 13: rewrite paths via env, hooks only for the app, PROJECT.md seed, phonePush, stall default, CI off', () => {
  assert.match(id.REWRITE_EXEC, /"\$HEARTH_MSG"/);
  assert.equal(id.rewriteEnv({}, '/m', '/h').HEARTH_MSG, '/m');
  const d = tmp();
  const hook = path.join(d, 'h'); fs.writeFileSync(hook, id.hookScript());
  const msg = path.join(d, 'm'); fs.writeFileSync(msg, 'Mine\n\nCo-Authored-By: Someone <a@b.co>\n');
  execFileSync('sh', [hook, msg], { env: { ...process.env, HEARTH_AI_APP: '' } });
  assert.match(fs.readFileSync(msg, 'utf8'), /Co-Authored-By/, 'the owner\'s own commits outside the app are untouched');
  assert.match(memory.seed({}), /only for the owner's Next version, and only with the owner's lead switches on/);
  assert.equal(ops.phonePushData({ a: 'x'.repeat(100) }, (t) => t, () => {}, 50).ok, false, 'too big: refused, not truncated');
  let got = null;
  assert.equal(ops.phonePushData({ a: 1 }, (t) => t, (v) => { got = v; }).ok, true);
  assert.deepEqual(got, { a: 1 });
  assert.equal(projects.defaultSettings().stallMin, 45);
  assert.equal(projects.defaultSettings().ciWatch, false);
  assert.equal(projects.cleanSettings({}).ciWatch, false, 'existing users get it off until they turn it on');
  assert.equal(ops.pickDispatchRun([{ event: 'push', created_at: '2026-11-03T10:00:00Z' }, { event: 'workflow_dispatch', created_at: '2026-11-03T09:00:00Z' }, { event: 'workflow_dispatch', created_at: '2026-11-03T11:00:00Z' }], '2026-11-03T10:30:00Z').created_at, '2026-11-03T11:00:00Z');
  const idx = read('electron/ops/index.cjs');
  const rw = idx.slice(idx.indexOf("handle('ops:rewriteTask'"), idx.indexOf('// ---- releases and tags'));
  assert.match(rw, /Always the owner's confirmation, also when the lead asked/);
  assert.deepEqual(approval.FIXED, ['boot', 'secrets']);
  assert.ok(!('boot' in approval.MOVABLE) && !('secrets' in approval.MOVABLE));
});

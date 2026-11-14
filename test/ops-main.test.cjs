// Team ops, main-process side (electron/ops/*): pure logic and the real test runner,
// watchdog, projects registry and phone server on loopback.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const tests = require('../electron/ops/tests.cjs');
const ci = require('../electron/ops/ci.cjs');
const logs = require('../electron/ops/logs.cjs');
const voice = require('../electron/ops/voice.cjs');
const memory = require('../electron/ops/memory.cjs');
const usage = require('../electron/ops/usage.cjs');
const projects = require('../electron/ops/projects.cjs');
const phone = require('../electron/ops/phone.cjs');
const { createWatchdog } = require('../electron/ops/watchdog.cjs');
const approval = require('../electron/ops/approval.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ops-test-'));

// 1. Tests after every task
test('test command: automatic picks npm test only with a real test script; "" means none', () => {
  const d = tmp();
  assert.equal(tests.resolveTestCommand(null, d), null);
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
  assert.equal(tests.resolveTestCommand(null, d), null);
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  assert.equal(tests.resolveTestCommand(null, d), 'npm test');
  assert.equal(tests.resolveTestCommand('', d), null);
  assert.equal(tests.resolveTestCommand(' make check ', d), 'make check');
});

test('test env is clean: no tokens, throwaway HOME, CI on', () => {
  const env = tests.cleanEnv({ PATH: '/usr/bin', HOME: '/home/me', GH_TOKEN: 'x', GITHUB_TOKEN: 'y', ANTHROPIC_API_KEY: 'z', NPM_TOKEN: 'n', SSH_AUTH_SOCK: '/s' }, '/tmp/h');
  assert.equal(env.HOME, '/tmp/h');
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.CI, '1');
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'NPM_TOKEN', 'SSH_AUTH_SOCK']) assert.equal(env[k], undefined, k);
});

test('runTests: pass, fail with captured output, secrets not visible, time limit, cancel', async () => {
  const d = tmp();
  process.env.HEARTH_FAKE_TOKEN = 'secret-value';
  const ok = await tests.runTests({ command: 'echo all good; echo "tok=${HEARTH_FAKE_TOKEN:-none}"', cwd: d });
  assert.equal(ok.status, 'passed');
  assert.match(ok.log, /all good/);
  assert.match(ok.log, /tok=none/);
  const bad = await tests.runTests({ command: 'echo boom >&2; exit 3', cwd: d });
  assert.equal(bad.status, 'failed');
  assert.equal(bad.code, 3);
  assert.match(bad.log, /boom/);
  const slow = await tests.runTests({ command: 'sleep 5', cwd: d, timeoutMs: 300 });
  assert.equal(slow.status, 'failed');
  assert.ok(slow.timedOut);
  const c = new AbortController();
  const p = tests.runTests({ command: 'sleep 5', cwd: d, signal: c.signal });
  setTimeout(() => c.abort(), 100);
  const cancelled = await p;
  assert.equal(cancelled.status, 'not run');
  assert.ok(cancelled.cancelled);
});

// 4. Stall watchdog
test('watchdog: stalls only when neither output nor files change', async () => {
  let t = 0;
  let fp = 'a';
  let stalled = 0;
  const wd = createWatchdog({ idleMs: 100, probe: async () => fp, onStall: () => stalled++, now: () => t, setTimer: () => 1, clearTimer: () => {} });
  t = 50; await wd.tick(); assert.equal(stalled, 0);
  t = 120; fp = 'b'; await wd.tick(); assert.equal(stalled, 0, 'file change counts as activity');
  t = 200; wd.touch(); await wd.tick(); assert.equal(stalled, 0, 'output counts as activity');
  t = 310; await wd.tick(); assert.equal(stalled, 1);
  assert.equal(wd.stalled, true);
  assert.equal(createWatchdog({ idleMs: 0, probe: async () => '', onStall: () => {} }).stalled, false);
});

// 8. CI
test('CI: remote parsing, aggregation across workflows, failed job and log tail', () => {
  assert.deepEqual(ci.parseRemote('https://github.com/Dragongamer9/hearth-os.git'), { owner: 'Dragongamer9', repo: 'hearth-os' });
  assert.deepEqual(ci.parseRemote('git@github.com:Dragongamer9/hearth-os.git'), { owner: 'Dragongamer9', repo: 'hearth-os' });
  assert.equal(ci.parseRemote('https://gitlab.com/x/y'), null);
  const runs = [
    { id: 3, name: 'build', workflow_id: 1, head_sha: 'new', status: 'completed', conclusion: 'failure', created_at: '2026-11-02T10:05:00Z', html_url: 'https://github.com/o/r/actions/runs/3' },
    { id: 2, name: 'shots', workflow_id: 2, head_sha: 'new', status: 'completed', conclusion: 'success', created_at: '2026-11-02T10:04:00Z' },
    { id: 1, name: 'build', workflow_id: 1, head_sha: 'old', status: 'completed', conclusion: 'success', created_at: '2026-11-01T10:00:00Z' },
  ];
  const a = ci.aggregate(runs);
  assert.equal(a.state, 'failure');
  assert.equal(a.sha, 'new');
  assert.equal(a.failedRun.id, 3);
  assert.equal(ci.aggregate([{ ...runs[1], status: 'in_progress', conclusion: null }]).state, 'pending');
  assert.equal(ci.aggregate([runs[1]]).state, 'success');
  assert.equal(ci.aggregate([]).state, 'none');
  const job = ci.failedJob({ jobs: [{ id: 9, name: 'ok', conclusion: 'success' }, { id: 10, name: 'appimage', conclusion: 'failure', html_url: 'u', steps: [{ name: 'Unit tests', conclusion: 'failure' }] }] });
  assert.deepEqual(job, { id: 10, name: 'appimage', url: 'u', step: 'Unit tests' });
  const log = Array.from({ length: 200 }, (_, i) => `2026-11-02T10:00:${String(i % 60).padStart(2, '0')}.0000000Z line ${i}`).join('\n').replace('line 150', '##[error]Process completed with exit code 1');
  const tail = ci.logTail(log, 20);
  assert.match(tail, /##\[error\]/);
  assert.doesNotMatch(tail, /2026-11-02T/);
  assert.equal(ci.safeBranch('hearth/k7q2ma-storage'), true);
  assert.equal(ci.safeBranch('--upload-pack=x'), false);
  assert.equal(ci.safeBranch('a/../b'), false);
});

// 10. Hearth logs
test('Hearth logs: paths, new ones only, and a summary of device, version and errors', () => {
  assert.deepEqual(logs.parseLogPath('logs/2026-11-01/AB12CD.txt'), { date: '2026-11-01', code: 'AB12CD', path: 'logs/2026-11-01/AB12CD.txt' });
  assert.equal(logs.parseLogPath('logs/../etc/passwd.txt'), null);
  assert.deepEqual(logs.recentDates([{ type: 'dir', name: '2026-10-30' }, { type: 'dir', name: '2026-11-01' }, { type: 'file', name: 'README.md' }], 1), ['2026-11-01']);
  const fresh = logs.newLogs(new Set(['logs/2026-11-01/A.txt']), ['logs/2026-11-01/A.txt', 'logs/2026-11-01/B.txt', 'junk']);
  assert.deepEqual(fresh.map((x) => x.code), ['B']);
  const s = logs.summarizeLog('Device: ROG Ally RC71L\nHearth OS version: 0.6.52\n12:00:01 kernel: amdgpu: error -110 ring timeout\n12:00:02 kernel: amdgpu: error -110 ring timeout\nsddm: Failed to start session\nall fine');
  assert.equal(s.device, 'ROG Ally RC71L');
  assert.equal(s.version, '0.6.52');
  assert.equal(s.errors.length, 2, 'repeated errors are listed once');
  assert.match(s.errors[1], /Failed to start session/);
});

// 12. Voice
test('voice: whisper.cpp needs a model, python whisper works alone, otherwise the install note', () => {
  const list = (d) => (d.endsWith(path.join('.cache', 'whisper.cpp')) ? ['ggml-tiny.bin', 'ggml-base.en.bin', 'notes.txt'] : []);
  { const d = voice.detect({ find: (b) => (b === 'whisper-cli' ? '/usr/bin/whisper-cli' : null), list, home: '/h' }); assert.deepEqual({ tool: d.tool, bin: d.bin, model: d.model }, { tool: 'whisper.cpp', bin: '/usr/bin/whisper-cli', model: path.join('/h', '.cache', 'whisper.cpp', 'ggml-base.en.bin') }); }
  assert.equal(voice.detect({ find: (b) => (b === 'whisper-cli' ? '/x' : null), list: () => [], home: '/h' }).tool, null);
  assert.equal(voice.detect({ find: (b) => (b === 'whisper' ? '/usr/bin/whisper' : null), list: () => [], home: '/h' }).tool, 'whisper');
  assert.match(voice.detect({ find: () => null, list: () => [], home: '/h' }).missing, /^transcription unavailable: install whisper.cpp/);
  assert.equal(voice.cleanTranscript(' [BLANK_AUDIO]  Fix the   wifi page. \n'), 'Fix the wifi page.');
  assert.ok(voice.cppArgs('/m.bin', '/a.wav').includes('-nt'));
});

// 7. Project memory
test('PROJECT.md: seeded with the owner rules and layout; prepended to prompts; approved proposals appended', () => {
  const s = memory.seed({ name: 'hearth-os', layout: ['src', 'docs'], decisions: ['Storage page uses Mantel'] });
  assert.match(s, /Dragongamer9 <Dragongamer9@users\.noreply\.github\.com>/);
  assert.match(s, /No Co-authored-by, Claude-Session or "Generated with"/);
  assert.match(s, /version numbers are the owner's/);
  assert.match(s, /never change by themselves/);
  assert.match(s, /Nothing reaches main without the owner's approval/);
  assert.match(s, /- src\n- docs/);
  assert.match(s, /Storage page uses Mantel/);
  assert.equal(memory.withMemory('do it', ''), 'do it');
  const p = memory.withMemory('do it', s);
  assert.ok(p.startsWith('PROJECT MEMORY (.hearth-ai/PROJECT.md'));
  assert.ok(p.endsWith('do it'));
  const once = memory.applyProposal(s, 'Wi-Fi code lives in mantel/net', '2026-11-02T00:00:00Z');
  const twice = memory.applyProposal(once, 'Second', '2026-11-02T00:00:00Z');
  assert.equal((twice.match(/## Approved additions/g) || []).length, 1);
  assert.match(twice, /- Wi-Fi code lives in mantel\/net _\(approved 2026-11-02\)_\n- Second/);
});

// 3/6. Usage numbers
test('usage: agy percentages and counts, Claude tokens', () => {
  assert.equal(usage.parseUsage('You have used 72% of your quota. Resets in 3 hours.').usedPct, 72);
  assert.equal(usage.parseUsage('28% remaining').usedPct, 72);
  assert.equal(usage.parseUsage('Requests: 30/120 used').usedPct, 25);
  assert.equal(usage.parseUsage('Resets in 3 hours.').usedPct, null);
  assert.match(usage.parseUsage('50% used, resets at 5pm').reset, /resets at 5pm/);
  assert.deepEqual(usage.claudeUsage({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }, total_cost_usd: 0.02 }), { tokens: 115, costUsd: 0.02 });
  assert.equal(usage.claudeUsage({}), null);
});

// 9. Projects
test('projects: existing data becomes the default project in its old file; settings stay as the owner set them', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'command-center-state.json'), JSON.stringify({ tasks: [{ id: 'KEEP01' }], audit: [] }));
  const p = projects.createProjects(d);
  const reg = p.load('/home/o/hearth-os');
  assert.equal(reg.active, 'default');
  assert.equal(reg.list[0].dir, '/home/o/hearth-os');
  assert.equal(p.stateFile('default'), path.join(d, 'command-center-state.json'), 'old board file is used as-is');
  assert.equal(JSON.parse(fs.readFileSync(p.stateFile('default'), 'utf8')).tasks[0].id, 'KEEP01');
  const b = p.add({ dir: '/home/o/beacon' });
  assert.equal(p.add({ dir: '/home/o/beacon' }).id, b.id, 'same folder is not added twice');
  assert.match(p.stateFile(b.id), /projects[\\/][a-f0-9]{8}[\\/]command-center-state\.json$/);
  p.setSettings('default', { testCommand: 'make check', logsOn: true, logsRepo: 'Dragongamer9/hearth-logs', stallMin: 999, bogus: 1 });
  p.switchTo(b.id);
  const again = projects.createProjects(d);
  const r2 = again.load('/somewhere/else');
  assert.equal(r2.active, b.id);
  const def = again.byId('default');
  assert.equal(def.dir, '/home/o/hearth-os', 'loading again never changes it');
  assert.equal(def.settings.testCommand, 'make check');
  assert.equal(def.settings.logsRepo, 'Dragongamer9/hearth-logs');
  assert.equal(def.settings.stallMin, 240);
  assert.equal(def.settings.bogus, undefined);
  assert.equal(again.byId(b.id).settings.logsOn, false, 'logs are off by default');
  assert.equal(again.byId(b.id).settings.testCommand, null, 'automatic by default');
  assert.equal(projects.cleanSettings({ logsRepo: 'not a repo; rm -rf' }).logsRepo, '');
});

// 11. Phone
test('phone: LAN-only addresses and hosts, one-time codes, hashed tokens', () => {
  for (const ip of ['127.0.0.1', '::1', '10.1.2.3', '192.168.1.20', '172.16.0.4', '172.31.9.9', '::ffff:192.168.0.2', 'fe80::1', 'fd00::5']) assert.ok(phone.isLanAddress(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '2001:db8::1', '']) assert.ok(!phone.isLanAddress(ip), ip);
  assert.ok(phone.hostOk('192.168.1.5:8787'));
  assert.ok(phone.hostOk('localhost:8787'));
  assert.ok(!phone.hostOk('evil.example.com:8787'));
  const p = phone.newPairing(1000, () => 42);
  assert.equal(p.code, '000042');
  assert.equal(phone.tryPair(p, '000041', 1001).ok, false);
  assert.equal(phone.tryPair(p, '000042', 1001).ok, true);
  assert.equal(phone.tryPair(phone.newPairing(0, () => 1), '000001', phone.CODE_TTL_MS + 1).ok, false, 'expired');
  const q = phone.newPairing(0, () => 7);
  let r;
  for (let i = 0; i < phone.MAX_TRIES; i++) r = phone.tryPair(q, '999999', 1);
  assert.equal(r.dead, true, 'too many tries kills the code');
  assert.equal(phone.tryPair(q, 'é', 1).ok, false, 'odd input does not throw');
  assert.equal(phone.hashToken('abc').length, 64);
  assert.equal(phone.cookieToken('a=1; hearth_phone=AAAAAAAAAAAAAAAAAAAAAAAA; b=2'), 'AAAAAAAAAAAAAAAAAAAAAAAA');
});

test('phone server: pairing gives a cookie, only its hash is stored, actions need the header, forget clears all', { skip: phone.lanInterfaces().length ? false : 'no LAN interface here' }, async () => {
  const d = tmp();
  const file = path.join(d, 'ops-phone.json');
  const actions = [];
  const ph = phone.createPhone({ file, getSnapshot: () => ({ board: [], chat: [{ who: 'owner', text: 'hi' }] }), onAction: (a) => actions.push(a) });
  const st = await ph.enable();
  assert.equal(st.running, true);
  const port = st.port;
  const host = new URL(st.urls[0]).hostname; // bound to the LAN interface only, never 0.0.0.0
  const req = (method, p, body, headers = {}) => new Promise((resolve, reject) => {
    const r = http.request({ host, port, path: p, method, headers: { Host: `${host}:${port}`, 'Content-Type': 'application/json', ...headers } }, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: s }));
    });
    r.on('error', reject);
    if (body) r.end(JSON.stringify(body)); else r.end();
  });
  try {
    assert.equal((await req('GET', '/')).status, 200);
    assert.equal((await req('GET', '/', null, { Host: 'evil.example.com' })).status, 403, 'DNS rebinding host refused');
    assert.equal((await req('GET', '/api/state')).status, 401);
    assert.equal((await req('POST', '/api/pair', { code: '123456' }, { 'X-Hearth': '1' })).status, 401, 'no code active');
    const code = ph.newCode().pairing.code;
    assert.equal((await req('POST', '/api/pair', { code })).status, 403, 'header required');
    const ok = await req('POST', '/api/pair', { code, name: 'Pixel' }, { 'X-Hearth': '1' });
    assert.equal(ok.status, 200);
    const cookie = ok.headers['set-cookie'][0];
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    const token = cookie.match(/hearth_phone=([^;]+)/)[1];
    const saved = fs.readFileSync(file, 'utf8');
    assert.ok(!saved.includes(token), 'token never stored');
    assert.ok(saved.includes(phone.hashToken(token)), 'hash stored');
    assert.equal((await req('POST', '/api/pair', { code }, { 'X-Hearth': '1' })).status, 401, 'one-time');
    const auth = { Cookie: `hearth_phone=${token}` };
    const s = await req('GET', '/api/state', null, auth);
    assert.equal(JSON.parse(s.body).chat[0].text, 'hi');
    assert.equal((await req('POST', '/api/action', { type: 'chat', value: 'x' }, auth)).status, 403);
    assert.equal((await req('POST', '/api/action', { type: 'chat', value: 'from phone' }, { ...auth, 'X-Hearth': '1' })).status, 200);
    assert.equal(actions[0].value, 'from phone');
    assert.equal(actions[0].device, 'Pixel');
    const f = ph.forget();
    assert.equal(f.running, false);
    assert.equal(f.devices.length, 0);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).enabled, false);
  } finally {
    ph.stop();
  }
});

// Approval levels (main side)
test('approval levels saved in settings: only movable categories, only differences, owner-only never saved', () => {
  assert.deepEqual(approval.cleanSavedLevels({ attach: 'major', install: 'routine', merge: 'routine', release: 'routine', tests: 'routine', bogus: 'routine', push: 'owner' }), { attach: 'major', install: 'routine' });
  assert.deepEqual(approval.cleanSavedLevels(null), {});
  assert.deepEqual(approval.cleanSavedLevels(approval.cleanSavedLevels({ network: 'routine' })), { network: 'routine' }, 'stable when read back');
});

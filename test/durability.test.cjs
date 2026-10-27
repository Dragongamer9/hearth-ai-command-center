const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, redact, redactDeep } = require('../electron/store.cjs');
const agents = require('../electron/agents.cjs');

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-dur-'));
const st = (n) => ({ tasks: Array.from({ length: n }, (_, i) => ({ id: `T${i}`, runs: [] })), audit: [] });

test('saves are atomic and versioned', () => {
  const dir = tmpdir();
  const store = createStore(path.join(dir, 'state.json'), { keep: 3 });
  for (let i = 1; i <= 5; i++) store.save(st(i));
  assert.equal(store.load().state.tasks.length, 5);
  const list = store.list();
  assert.deepStrictEqual(list.map((b) => b.tasks), [4, 3, 2]); // newest backups kept, oldest pruned
  assert.ok(!fs.readdirSync(dir).some((f) => f.includes('.tmp-')), 'no temp files left behind');
  assert.equal(fs.statSync(path.join(dir, 'state.json')).mode & 0o777, 0o600);
});

test('interrupted write: a leftover temp file does not affect the saved state', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'state.json');
  const store = createStore(file);
  store.save(st(2));
  fs.writeFileSync(`${file}.tmp-99999`, '{"tasks":[{"id":"half'); // crash mid-write
  assert.equal(createStore(file).load().state.tasks.length, 2);
});

test('corrupt latest save falls back to newest good backup and keeps the corrupt file', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'state.json');
  const store = createStore(file);
  store.save(st(1));
  store.save(st(2));
  fs.writeFileSync(file, '{"tasks": [ truncated');
  const r = createStore(file).load();
  assert.equal(r.recoveredFrom, 'state.json.1');
  assert.equal(r.state.tasks.length, 1);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('state.json.corrupt-')), 'corrupt file preserved');
});

test('restore an earlier checkpoint', () => {
  const dir = tmpdir();
  const store = createStore(path.join(dir, 'state.json'));
  store.save(st(1));
  store.save(st(7));
  assert.equal(store.restore(1).tasks.length, 1);
  assert.equal(store.load().state.tasks.length, 1);
  assert.equal(store.list()[0].tasks, 7, 'the state you restored over is itself kept');
  assert.throws(() => store.restore(0));
});

test('secrets never reach disk', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'state.json');
  const store = createStore(file);
  const s = st(1);
  s.tasks[0].notes = [{ text: 'my key sk-ant-abcdefghijklmnopqrstuvwxyz and ghp_abcdefghijklmnopqrstuvwx1234' }];
  s.chat = [{ text: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456' }];
  store.save(s);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!/sk-ant-abc|ghp_abc|abcdefghijklmnopqrstuvwxyz123456/.test(raw), raw);
  assert.match(raw, /\[REDACTED\]/);
  assert.equal(redact('plain text'), 'plain text');
  assert.deepStrictEqual(redactDeep({ a: [1, 'sk-proj-aaaaaaaaaaaaaaaaaaaaaaaa'] }), { a: [1, '[REDACTED]'] });
});

test('provider outage is distinguished from usage limit', async () => {
  const bin = path.join(__dirname, 'fixtures', 'claude');
  process.env.FAKE_CLAUDE_OUTAGE = '1';
  const r = await agents.runAgent({ agent: 'anthropic', prompt: 'x', bin, cwd: os.tmpdir() });
  delete process.env.FAKE_CLAUDE_OUTAGE;
  assert.equal(r.error.kind, 'outage');
  process.env.FAKE_CLAUDE_LIMIT = '1';
  const l = await agents.runAgent({ agent: 'anthropic', prompt: 'x', bin, cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'h-')) });
  delete process.env.FAKE_CLAUDE_LIMIT;
  assert.equal(l.error.kind, 'limit');
  assert.equal(l.error.reset, 'resets 3pm');
});

test('cancelled run reports cancelled, not a crash', async () => {
  const c = new AbortController();
  const p = agents.runAgent({ agent: 'anthropic', prompt: 'x', bin: path.join(__dirname, 'fixtures', 'slow'), cwd: os.tmpdir(), signal: c.signal });
  setTimeout(() => c.abort(), 100);
  const r = await p;
  assert.equal(r.error.kind, 'cancelled');
});

test('timeout reports a resumable state', async () => {
  const r = await agents.runAgent({ agent: 'anthropic', prompt: 'x', bin: path.join(__dirname, 'fixtures', 'slow'), cwd: os.tmpdir(), timeoutMs: 200 });
  assert.equal(r.error.kind, 'timeout');
});

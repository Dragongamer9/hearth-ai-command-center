// rtk (electron/rtk.cjs): the "Trim command output for agents (rtk)" switch. Off by default, the one verified
// download, nothing touched while it's off, used only for the agents the app starts, removed when turned off.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-rtk-'));
process.env.HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.HOME, { recursive: true });
const rtk = require('../electron/rtk.cjs');
const agents = require('../electron/agents.cjs');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// A .tar.gz with the given files (ustar).
function tgz(files) {
  const blocks = [];
  for (const [name, body, mode = 0o755] of files) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100);
    h.write(`${mode.toString(8).padStart(7, '0')}\0`, 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h.write('0', 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}
// A stand-in rtk: answers --version and gain like the real one, and passes hooks through.
const FAKE_RTK = Buffer.from(`#!/bin/sh
case "$1" in
  --version) echo "rtk 1.2.0";;
  gain) echo '{"summary":{"total_commands":4,"total_input":1000,"total_output":200,"total_saved":800,"avg_savings_pct":80.04}}';;
esac
exit 0
${'#'.repeat(2000)}
`);
const GOOD = tgz([['LICENSE', Buffer.from('Apache-2.0'), 0o644], ['rtk', FAKE_RTK]]);
const fetchOf = (buf, calls = []) => async (url) => { calls.push(url); return { ok: true, status: 200, arrayBuffer: async () => buf }; };

let on = false;
const ROOT = path.join(TMP, 'userData', 'rtk');
const mk = (o = {}) => rtk.create({ dir: ROOT, enabled: () => on, platform: 'linux', arch: 'x64', ...o });

test('the switch is off by default and saved only from his click (merged, atomic settings code)', async () => {
  const main = read('electron/main.cjs');
  assert.match(main, /rtk: s\.rtk === true,/, 'a missing value reads as off; the default is never saved');
  const set = main.slice(main.indexOf("handle('settings:set',"), main.indexOf("handle('settings:addDir'"));
  assert.match(set, /if \('rtk' in patch\) s\.rtk = patch\.rtk === true;/);
  assert.ok(set.indexOf('writeSettings(s)') > set.indexOf("if ('rtk' in patch)"), 'saved through writeSettings (merge-on-write, atomic, .bak)');
  assert.match(main, /rtkLib\.configure\(\{ dir: \(\) => path\.join\(dataDir\(\), 'rtk'\), enabled: \(\) => readSettings\(\)\.rtk === true \}\)/);
  // Nothing configured yet = off.
  assert.equal(rtk.forRun({ agent: 'anthropic' }), null);
  const st = await mk({ enabled: undefined }).status();
  assert.equal(st.on, false);
  const ui = read('src/main.js');
  assert.match(ui, /Trim command output for agents \(rtk\)/);
  assert.match(ui, /tog\(s\.rtk === true, 'rtk-toggle'\)/);
  assert.match(ui, /rtk bypass, rtk recall/, 'says the full output is kept');
});

test('only the verified v1.2.0 oss build: its URL and published SHA-256', () => {
  assert.equal(rtk.DOWNLOAD_URL, 'https://github.com/rtk-ai/rtk/releases/download/v1.2.0/rtk-oss-x86_64-unknown-linux-musl.tar.gz');
  assert.equal(rtk.SHA256, 'a28407dc13038bdc9c2a1f5a047b0c636e0c1d495b15523576e2adb992a06a17');
  assert.equal(rtk.verify(Buffer.from('not rtk')).ok, false);
  assert.equal(rtk.verify(GOOD, rtk.sha256(GOOD)).ok, true);
});

test('a download that fails the checksum is thrown away: nothing is saved', async () => {
  on = false;
  const none = [];
  const off = await mk({ fetchFn: fetchOf(GOOD, none) }).download();
  assert.equal(off.ok, false, 'never downloads while the switch is off');
  assert.deepEqual(none, []);
  on = true;
  const calls = [];
  const bad = await rtk.create({ dir: ROOT, enabled: () => true, platform: 'linux', arch: 'x64', fetchFn: fetchOf(GOOD, calls) }).download();
  assert.equal(bad.ok, false, 'the stand-in archive is not the published build');
  assert.match(bad.message, /checksum/);
  assert.deepEqual(calls, [rtk.DOWNLOAD_URL]);
  assert.equal(fs.existsSync(ROOT), false, 'nothing written');
  on = false;
});

test('the archive reader takes only the one file named rtk', () => {
  assert.equal(rtk.extractRtk(Buffer.from('junk')), null);
  assert.equal(rtk.extractRtk(tgz([['../rtk', FAKE_RTK], ['bin/rtk', FAKE_RTK]])), null);
  assert.deepEqual(rtk.extractRtk(GOOD), FAKE_RTK);
  assert.deepEqual(rtk.extractRtk(tgz([['./rtk', FAKE_RTK]])), FAKE_RTK);
});

test('never telemetry, never rtk-proxy, never rtk init', () => {
  const src = read('electron/rtk.cjs');
  assert.match(src, /RTK_TELEMETRY_DISABLED: '1'/);
  assert.doesNotMatch(src, /rtk-proxy-|llm-proxy|\['init'|'telemetry'|'claude'\]|\['proxy'/, 'no proxy download or start, no init, no telemetry command');
  const env = mk().env();
  assert.equal(env.RTK_TELEMETRY_DISABLED, '1');
  assert.ok(env.RTK_DB_PATH.startsWith(ROOT) && env.RTK_RECALL_DB.startsWith(ROOT) && env.RTK_TEE_DIR.startsWith(ROOT), 'rtk keeps its files in the app folder');
});

// A fake agent that records what it was started with.
const OUT = path.join(TMP, 'out');
function fakeAgent(name, reply) {
  const f = path.join(TMP, name);
  fs.writeFileSync(f, `#!/bin/sh\ncat > "${OUT}.prompt"\nprintf '%s\\n' "$@" > "${OUT}.args"\nenv > "${OUT}.env"\necho '${reply}'\n`, { mode: 0o755 });
  return f;
}
const CLAUDE = fakeAgent('claude', '{"type":"result","is_error":false,"result":"ok","session_id":"abcd-1234"}');
const CODEX = fakeAgent('codex', '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}');
const got = () => ({ args: fs.readFileSync(`${OUT}.args`, 'utf8').split('\n'), env: fs.readFileSync(`${OUT}.env`, 'utf8'), prompt: fs.readFileSync(`${OUT}.prompt`, 'utf8') });
const settingsArg = (args) => args[args.indexOf('--settings') + 1];

test('while off nothing is touched: the agents run exactly as before and no rtk file is made', async () => {
  on = false;
  rtk.configure({ dir: ROOT, enabled: () => on, platform: 'linux', arch: 'x64' });
  let r = await agents.runAgent({ agent: 'anthropic', prompt: 'hello', mode: 'standard', bin: CLAUDE, cwd: TMP });
  assert.equal(r.ok, true);
  let g = got();
  assert.equal(settingsArg(g.args), path.join(process.env.HOME, '.cache', 'hearth-ai', 'claude-settings.json'));
  assert.doesNotMatch(fs.readFileSync(settingsArg(g.args), 'utf8'), /hooks|rtk/);
  assert.doesNotMatch(g.env, /^RTK_/m);
  assert.equal(g.prompt, 'hello');
  r = await agents.runAgent({ agent: 'openai', prompt: 'hello', mode: 'standard', bin: CODEX, cwd: TMP });
  assert.equal(r.ok, true);
  g = got();
  assert.equal(g.prompt, 'hello');
  assert.doesNotMatch(g.env, /^RTK_/m);
  assert.equal(fs.existsSync(ROOT), false);
  assert.equal((await rtk.instance().status()).installed, false);
  assert.equal(fs.existsSync(ROOT), false, 'checking the status writes nothing');
  assert.equal(fs.existsSync(path.join(process.env.HOME, '.claude')), false, 'no global Claude Code files');
});

test('while on: Claude Code gets rtk\'s hook only in its per-run settings, other CLIs get rtk on PATH; off removes it all', async () => {
  on = true;
  const inst = rtk.configure({ dir: ROOT, enabled: () => on, platform: 'linux', arch: 'x64', fetchFn: fetchOf(GOOD), expect: rtk.sha256(GOOD) });
  // Switched on but not downloaded yet: runs are unchanged.
  assert.equal(rtk.forRun({ agent: 'anthropic' }), null);
  const d = await inst.download();
  assert.equal(d.ok, true, d.message);
  assert.ok(inst.installed());
  const st = await inst.status();
  assert.deepEqual([st.installed, st.gain.commands, st.gain.saved, st.gain.pct], [true, 4, 800, 80]);

  await agents.runAgent({ agent: 'anthropic', prompt: 'hello', mode: 'standard', bin: CLAUDE, cwd: TMP });
  let g = got();
  const file = settingsArg(g.args);
  assert.ok(file.startsWith(ROOT), 'the hook lives in the app\'s own rtk folder');
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(s.includeCoAuthoredBy, false, 'the no-attribution settings stay');
  assert.equal(s.hooks.PreToolUse[0].matcher, 'Bash');
  assert.equal(s.hooks.PreToolUse[0].hooks[0].command, `'${path.join(ROOT, 'bin', 'rtk')}' hook claude`);
  assert.match(g.env, /^RTK_TELEMETRY_DISABLED=1$/m);
  assert.match(g.env, new RegExp(`^PATH=${path.join(ROOT, 'bin').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`, 'm'));
  assert.equal(g.prompt, 'hello', 'Claude Code needs no note: the hook is transparent');
  assert.equal(fs.existsSync(path.join(process.env.HOME, '.claude', 'settings.json')), false);

  await agents.runAgent({ agent: 'openai', prompt: 'hello', mode: 'standard', bin: CODEX, cwd: TMP });
  g = got();
  assert.ok(g.prompt.startsWith(rtk.NOTE) && g.prompt.endsWith('hello'));
  assert.match(g.env, /^RTK_TELEMETRY_DISABLED=1$/m);
  assert.equal(fs.existsSync(path.join(process.env.HOME, '.codex')), false, 'no global Codex files');

  // A changed binary is no longer trusted.
  fs.appendFileSync(path.join(ROOT, 'bin', 'rtk'), '\n# changed\n');
  assert.equal(inst.installed(), null);
  assert.equal(rtk.forRun({ agent: 'anthropic' }), null);

  // Off: everything the app added goes.
  on = false;
  assert.equal(rtk.forRun({ agent: 'anthropic' }), null);
  assert.equal((await inst.status()).leftover, true);
  assert.equal(inst.remove().ok, true);
  assert.equal(fs.existsSync(ROOT), false);
  const main = read('electron/main.cjs');
  assert.match(main, /const rtkOff = 'rtk' in patch && patch\.rtk !== true && s\.rtk === true;/);
  assert.match(main, /if \(rtkOff\) rtkLib\.instance\(\)\?\.remove\(\);/);
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

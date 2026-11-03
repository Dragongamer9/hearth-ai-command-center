// One-click installs: user prefix, Node.js checksum verification, binary discovery.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');

// Hermetic home: everything the installer touches lives under a temp HOME.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-inst-home-'));
process.env.HOME = HOME;
delete process.env.XDG_DATA_HOME;
// Only /usr/bin and /bin on PATH, so a Codex, Grok or other tool already installed in
// a user folder on this machine can't change what discovery and status checks find.
process.env.PATH = '/usr/bin:/bin';
const installer = require('../electron/installer.cjs');
const agents = require('../electron/agents.cjs');

const exe = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
};
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-inst-'));
const fakeFetch = (routes) => async (url) => {
  if (!(url in routes)) return { ok: false, status: 404 };
  const v = routes[url];
  return { ok: true, status: 200, json: async () => v, text: async () => v };
};

const INDEX = [
  { version: 'v27.1.0', lts: false, files: ['linux-x64', 'linux-arm64'] },
  { version: 'v24.11.1', lts: 'Krypton', files: ['linux-x64', 'linux-arm64', 'win-x64-zip'] },
  { version: 'v22.21.0', lts: 'Jod', files: ['linux-x64'] },
];
const SUMS_HASH = 'a'.repeat(64);
const SUMS = `${'b'.repeat(64)}  node-v24.11.1-darwin-arm64.tar.gz\n${SUMS_HASH}  node-v24.11.1-linux-x64.tar.gz\n${'c'.repeat(64)}  node-v24.11.1-linux-x64.tar.xz\n`;
const NODE_ROUTES = { 'https://nodejs.org/dist/index.json': INDEX, 'https://nodejs.org/dist/v24.11.1/SHASUMS256.txt': SUMS };

test('Node.js version check: 20 or newer is usable', () => {
  assert.equal(installer.nodeUsable('v22.3.0\n'), true);
  assert.equal(installer.nodeUsable('v20.0.0'), true);
  assert.equal(installer.nodeUsable('v18.19.1'), false);
  assert.equal(installer.nodeUsable(''), false);
  assert.equal(installer.nodeUsable('garbage'), false);
  assert.equal(installer.parseNodeVersion('v24.11.1').major, 24);
});

test('picks the newest LTS with a Linux build from nodejs.org index.json', () => {
  assert.equal(installer.pickLts(INDEX, 'x64'), 'v24.11.1');
  assert.equal(installer.pickLts([{ version: 'v27.0.0', lts: false, files: ['linux-x64'] }], 'x64'), null);
  assert.equal(installer.pickLts([{ version: 'v24.0.0; rm -rf /', lts: 'X', files: ['linux-x64'] }], 'x64'), null, 'odd version strings are ignored');
  assert.equal(installer.pickLts(null, 'x64'), null);
  assert.equal(installer.nodeArch('x64'), 'x64');
  assert.equal(installer.nodeArch('ia32'), null);
});

test('reads the official SHASUMS256.txt and resolves the tarball and its checksum', async () => {
  const sums = installer.parseShasums(SUMS);
  assert.equal(sums['node-v24.11.1-linux-x64.tar.gz'], SUMS_HASH);
  assert.equal(Object.keys(sums).length, 3);
  const rel = await installer.resolveNode({ fetchImpl: fakeFetch(NODE_ROUTES), arch: 'x64' });
  assert.deepStrictEqual(rel, { version: 'v24.11.1', file: 'node-v24.11.1-linux-x64.tar.gz', url: 'https://nodejs.org/dist/v24.11.1/node-v24.11.1-linux-x64.tar.gz', sha256: SUMS_HASH });
  await assert.rejects(installer.resolveNode({ fetchImpl: fakeFetch({ ...NODE_ROUTES, 'https://nodejs.org/dist/v24.11.1/SHASUMS256.txt': 'nothing here' }), arch: 'x64' }), /no checksum/);
  await assert.rejects(installer.resolveNode({ fetchImpl: fakeFetch({}), arch: 'x64' }), /HTTP 404/);
});

test('npm installs always go to the user prefix ~/.local, with an existing new-enough Node.js', async () => {
  const bin = path.join(scratch(), 'bin');
  exe(path.join(bin, 'node'), 'echo v22.4.0');
  exe(path.join(bin, 'npm'), 'exit 0');
  const plan = await installer.prepare({ agents: ['openai', 'anthropic'], dirs: [bin], versionOf: async () => 'v22.4.0', fetchImpl: () => { throw new Error('must not download Node.js'); } });
  assert.equal(plan.ok, true);
  assert.equal(plan.args[0], path.join(HOME, '.local', 'share', 'hearth-ai'));
  assert.equal(plan.args[1], path.join(HOME, '.local'), 'user prefix, never a system folder');
  assert.deepStrictEqual(plan.args.slice(2), [
    'npm', 'anthropic', path.join(bin, 'npm'), '@anthropic-ai/claude-code', 'Claude Code',
    'npm', 'openai', path.join(bin, 'npm'), '@openai/codex', 'Codex CLI',
  ]);
  assert.ok(!plan.args.includes('-g'), 'no bare global install');
});

test('old or missing Node.js: the official LTS is downloaded first and its npm is used', async () => {
  const bin = path.join(scratch(), 'bin');
  exe(path.join(bin, 'node'), 'echo v16.20.0');
  exe(path.join(bin, 'npm'), 'exit 0');
  const plan = await installer.prepare({ agents: ['google'], dirs: [bin], versionOf: async () => 'v16.20.0', fetchImpl: fakeFetch(NODE_ROUTES), arch: 'x64' });
  assert.equal(plan.ok, true);
  assert.deepStrictEqual(plan.args.slice(2), [
    'node', 'v24.11.1', SUMS_HASH, 'https://nodejs.org/dist/v24.11.1/node-v24.11.1-linux-x64.tar.gz',
    'npm', 'google', path.join(installer.nodeBin(), 'npm'), '@google/gemini-cli', 'Gemini CLI',
  ]);
  const offline = await installer.prepare({ agents: ['google'], dirs: [], versionOf: async () => '', fetchImpl: fakeFetch({}), arch: 'x64' });
  assert.equal(offline.ok, false);
  assert.match(offline.message, /nodejs\.org/);
});

test('Mistral gets uv first only when missing; Ollama runs last; unknown agents are refused', async () => {
  const none = await installer.prepare({ agents: ['ollama', 'mistral'], dirs: [], versionOf: async () => '' });
  assert.deepStrictEqual(none.args.slice(2), ['uv', 'uvtool', 'mistral', 'mistral-vibe', 'Mistral Vibe', 'ollama']);
  const bin = path.join(scratch(), 'bin');
  exe(path.join(bin, 'uv'), 'exit 0');
  const withUv = await installer.prepare({ agents: ['mistral'], dirs: [bin], versionOf: async () => '' });
  assert.deepStrictEqual(withUv.args.slice(2), ['uvtool', 'mistral', 'mistral-vibe', 'Mistral Vibe']);
  assert.equal((await installer.prepare({ agents: ['perplexity'], dirs: [], versionOf: async () => '' })).ok, false);
  assert.equal(installer.canInstall('copilot'), false);
});

test('installer script uses only the official vendor URLs and never handles a password', () => {
  assert.match(installer.SCRIPT, /UV_URL='https:\/\/astral\.sh\/uv\/install\.sh'/);
  assert.match(installer.SCRIPT, /OLLAMA_URL='https:\/\/ollama\.com\/install\.sh'/);
  assert.doesNotMatch(installer.SCRIPT, /sudo -S|--password|passwd|SUDO_ASKPASS/);
  assert.doesNotMatch(installer.SCRIPT, /\$\{(?!TMPDIR|2:-|actual)/, 'no stray template interpolation');
  const r = spawnSync('sh', ['-n', installer.writeScript(path.join(scratch(), 'i.sh'))]);
  assert.equal(r.status, 0, String(r.stderr));
});

function fakeNodeTarball() {
  const dir = scratch();
  exe(path.join(dir, 'src', 'node-v99.0.0-linux-x64', 'bin', 'node'), 'echo v99.0.0');
  const tgz = path.join(dir, 'node.tar.gz');
  execFileSync('tar', ['-czf', tgz, '-C', path.join(dir, 'src'), 'node-v99.0.0-linux-x64']);
  return tgz;
}

test('Node.js download: correct checksum installs into the app folder', () => {
  const tgz = fakeNodeTarball();
  const dir = scratch();
  const app = path.join(dir, 'app');
  const script = installer.writeScript(path.join(dir, 'i.sh'));
  const r = spawnSync('sh', [script, app, path.join(dir, 'prefix'), 'nodefile', tgz, sha(tgz)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Checksum OK/);
  assert.equal(execFileSync(path.join(app, 'node', 'bin', 'node'), { encoding: 'utf8' }).trim(), 'v99.0.0');
});

test('Node.js download: a wrong checksum is refused and nothing is unpacked', () => {
  const tgz = fakeNodeTarball();
  const dir = scratch();
  const app = path.join(dir, 'app');
  const prefix = path.join(dir, 'prefix');
  const log = path.join(dir, 'npm-called');
  const npm = exe(path.join(dir, 'fakebin', 'npm'), `touch "${log}"`);
  const script = installer.writeScript(path.join(dir, 'i.sh'));
  const r = spawnSync('sh', [script, app, prefix, 'nodefile', tgz, 'f'.repeat(64), 'npm', 'openai', npm, '@openai/codex', 'Codex CLI'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Checksum MISMATCH/);
  assert.match(r.stdout, /FAILED {2}Codex CLI/);
  assert.ok(!fs.existsSync(path.join(app, 'node')), 'nothing installed');
  assert.ok(!fs.existsSync(log), 'npm never ran without Node.js');
  assert.equal(fs.readFileSync(path.join(app, 'install', 'openai'), 'utf8').trim(), 'failed');
});

test('npm step installs into the given prefix and records the result per agent', () => {
  const dir = scratch();
  const app = path.join(dir, 'app');
  const prefix = path.join(dir, 'prefix');
  const argsFile = path.join(dir, 'args');
  const good = exe(path.join(dir, 'fakebin', 'npm'), `echo "$@" > "${argsFile}"`);
  const bad = exe(path.join(dir, 'badbin', 'npm'), 'echo "network down" >&2; exit 1');
  const script = installer.writeScript(path.join(dir, 'i.sh'));
  const r = spawnSync('sh', [script, app, prefix, 'npm', 'anthropic', good, '@anthropic-ai/claude-code', 'Claude Code', 'npm', 'qwen', bad, '@qwen-code/qwen-code', 'Qwen Code'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(r.status, 1, 'one step failed');
  assert.equal(fs.readFileSync(argsFile, 'utf8').trim(), `install -g --prefix ${prefix} --no-fund --no-audit @anthropic-ai/claude-code`);
  assert.equal(fs.readFileSync(path.join(app, 'install', 'anthropic'), 'utf8').trim(), 'ok');
  assert.equal(fs.readFileSync(path.join(app, 'install', 'qwen'), 'utf8').trim(), 'failed');
  assert.match(r.stdout, /OK {6}Claude Code[\s\S]*FAILED {2}Qwen Code/);
});

test('binary discovery: finds tools in ~/.local/bin and puts the app’s Node.js first', () => {
  const dirs = agents.searchDirs();
  assert.ok(dirs.includes(path.join(HOME, '.local', 'bin')));
  assert.ok(!dirs.includes(installer.nodeBin()), 'no app Node.js until it is installed');
  exe(path.join(HOME, '.local', 'bin', 'codex'), 'exit 0');
  assert.equal(agents.findBinary('openai'), path.join(HOME, '.local', 'bin', 'codex'));
  exe(path.join(installer.nodeBin(), 'node'), 'echo v24.11.1');
  assert.equal(agents.searchDirs()[0], installer.nodeBin());
});

test('status reports a failed install while the tool is still missing', async () => {
  installer.markQueued(['xai']);
  assert.equal(installer.readRun('xai'), 'queued');
  fs.writeFileSync(path.join(installer.statusDir(), 'xai'), 'failed\n');
  const st = await agents.status('xai');
  assert.equal(st.installed, false);
  assert.equal(st.install, 'failed');
  assert.equal(installer.readRun('copilot'), null);
});

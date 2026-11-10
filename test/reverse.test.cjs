// Reverse Engineering: REA only for the chats of projects started there, only while on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createReverse, nodeOk, kindOf, REA_VERSION } = require('../electron/reverse.cjs');
const { createConnectors } = require('../electron/connectors.cjs');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-re-')); made.push(d); return d; };
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
function fakeChats() { const list = new Map(); let n = 0; return { create: (o) => { const e = { id: `c${++n}`, ...o }; list.set(e.id, e); return e; }, entry: (id) => list.get(id) || null }; }
const fakeSecrets = () => { const m = new Map(); return { available: async () => true, set: async (k, v) => { m.set(k, v); }, get: (k) => m.get(k) ?? null, has: (k) => m.has(k), remove: (k) => m.delete(k) }; };
function ghidraTree(dir) { fs.mkdirSync(path.join(dir, 'support'), { recursive: true }); fs.mkdirSync(path.join(dir, 'Ghidra'), { recursive: true }); fs.writeFileSync(path.join(dir, 'support', 'analyzeHeadless'), ''); fs.writeFileSync(path.join(dir, 'Ghidra', 'application.properties'), ''); return dir; }

test('Node versions REA accepts', () => {
  for (const v of ['v22.23.4', 'v22.30.0', 'v24.22.1', 'v26.12.1', 'v27.0.0']) assert.equal(nodeOk(v), true, v);
  for (const v of ['v22.23.3', 'v22.11.0', 'v23.5.0', 'v24.22.0', 'v25.1.0', 'v20.18.0', null, 'nope']) assert.equal(nodeOk(v), false, String(v));
});

test('what kind of program, from its first bytes', () => {
  const d = tmp();
  const w = (n, b) => { const f = path.join(d, n); fs.writeFileSync(f, b); return f; };
  assert.equal(kindOf(w('game.exe', 'MZ\x90\x00')), 'Windows program');
  assert.equal(kindOf(w('engine.dll', 'MZ\x90\x00')), 'Windows library (DLL)');
  assert.equal(kindOf(w('tool', '\x7fELF')), 'Linux program');
  assert.equal(kindOf(w('app.apk', 'PK\x03\x04')), 'Android app');
  assert.equal(kindOf(w('app.asar', 'xxxx')), 'Electron app');
});

test('off until he turns it on; REA only for a project chat', () => {
  const d = tmp();
  const re = createReverse({ file: path.join(d, 'reverse.json'), chats: fakeChats() });
  const prog = path.join(d, 'rotwk.exe'); fs.writeFileSync(prog, 'MZ\x90\x00');
  const { project, chat } = re.addProject(prog);
  assert.equal(chat.title, 'Reverse engineering: rotwk.exe');
  assert.equal(project.kind, 'Windows program');
  assert.equal(re.serverFor(chat.id), null, 'off by default');
  re.setEnabled(true);
  const s = re.serverFor(chat.id);
  assert.deepEqual({ name: s.name, command: s.command, args: s.args }, { name: 'rea', command: 'npx', args: ['-y', `rea-agents@${REA_VERSION}`, 'mcp'] });
  assert.equal(re.serverFor('some-other-chat'), null, 'never for another chat');
  assert.match(re.firstMessage(project), /Only read it: don't change, run or patch the file\./);
  re.removeProject(project.id);
  assert.equal(re.serverFor(chat.id), null);
});

test('Ghidra folder: checked, passed as GHIDRA_INSTALL_DIR, forgettable', () => {
  const d = tmp();
  const re = createReverse({ file: path.join(d, 'reverse.json'), chats: fakeChats() });
  assert.throws(() => re.setGhidra(d), /isn't a Ghidra installation/);
  const g = ghidraTree(path.join(d, 'ghidra_12.1.4_PUBLIC'));
  re.setGhidra(g); re.setEnabled(true);
  const prog = path.join(d, 'a.exe'); fs.writeFileSync(prog, 'MZ');
  const { chat } = re.addProject(prog);
  assert.equal(re.serverFor(chat.id).plainEnv.GHIDRA_INSTALL_DIR, g);
  re.setGhidra(null);
  assert.deepEqual(re.serverFor(chat.id).plainEnv, {});
});

test('a file that can\'t be read is refused and nothing is saved', () => {
  const d = tmp();
  const f = path.join(d, 'reverse.json');
  const re = createReverse({ file: f, chats: fakeChats() });
  assert.throws(() => re.addProject(path.join(d, 'missing.exe')), /can't be read/);
  assert.equal(fs.existsSync(f), false);
});

test('an unreadable reverse.json is never overwritten', () => {
  const d = tmp();
  const f = path.join(d, 'reverse.json');
  fs.writeFileSync(f, '{ not json');
  const re = createReverse({ file: f, chats: fakeChats() });
  assert.ok(re.broken());
  assert.throws(() => re.setEnabled(true));
  assert.equal(fs.readFileSync(f, 'utf8'), '{ not json');
});

test('connectors: the extra server goes into this run\'s configs only, never into connectors.json', async () => {
  const d = tmp();
  const c = createConnectors({ file: path.join(d, 'connectors.json'), secrets: fakeSecrets() });
  const r = c.forRun(path.join(d, 'run'), [{ name: 'rea', command: 'npx', args: ['-y', 'rea-agents@6.8.0', 'mcp'], plainEnv: { GHIDRA_INSTALL_DIR: '/opt/ghidra' } }]);
  const claude = JSON.parse(fs.readFileSync(r.claudeFile, 'utf8'));
  assert.equal(claude.mcpServers.rea.command, 'npx');
  assert.deepEqual(claude.mcpServers.rea.args, ['-y', 'rea-agents@6.8.0', 'mcp']);
  const v = claude.mcpServers.rea.env.GHIDRA_INSTALL_DIR.replace(/^\$\{|\}$/g, '');
  assert.equal(r.env[v], '/opt/ghidra');
  assert.ok(r.codexArgs.includes('mcp_servers.rea.command="npx"'));
  assert.ok(r.codexArgs.includes('mcp_servers.rea.env_vars=["GHIDRA_INSTALL_DIR"]'));
  assert.equal(r.codexEnv.GHIDRA_INSTALL_DIR, '/opt/ghidra');
  assert.equal(c.list().length, 0);
  r.cleanup();
  assert.equal(c.forRun(path.join(d, 'run')), null, 'no connectors and no extra: nothing');
});

test('wiring: the run passes its chat; the window has the section', () => {
  assert.match(read('electron/v2.cjs'), /d\.mcpForRun\(path\.join\(dataDir\(\), 'run'\), e\.id\)/);
  assert.match(read('electron/parity.cjs'), /mcpForRun: \(dir, chatId\) => connectors\.forRun\(dir, \[reverse\.serverFor\(chatId\), desktop\.serverFor\(chatId\)\]\.filter\(Boolean\)\)/);
  const ui = read('src/main.js');
  assert.match(ui, /data-a="reverse"[^>]*>\$\{icon\('code', 'sm'\)\}Reverse Engineering/);
  assert.match(ui, /data-a="re-new"/);
  assert.match(ui, /Nothing is sent until you press Send/);
  assert.match(ui, /Use it only on software you own or are allowed to look at/);
});

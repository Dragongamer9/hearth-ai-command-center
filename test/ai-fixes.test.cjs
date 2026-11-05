// 1.8 fixes from the owner's AI team list: narrow tool access for Gemini and Mistral, settings
// written only when they really change (with a change log), AI changes to settings undone,
// pictures with a plain reason when they can't be shown, the permissions table, the team
// test, missing quick-check tools, the stricter pre-push guard, and Find characters.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const perms = require('../electron/permissions.cjs');
const agents = require('../electron/agents.cjs');
const media = require('../electron/media.cjs');
const { diffSettings, applyChanges, createSettingsLog } = require('../electron/settings-log.cjs');
const teamCheck = require('../electron/team-check.cjs');
const finder = require('../electron/card-finder.cjs');
const cardsLib = require('../electron/cards.cjs');
const { prePushHook } = require('../electron/copies.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-aifix-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const QC = ['node --check', 'npm test', 'python3 -m pytest', 'shellcheck', 'cargo check'];

// ---------- 1. Gemini and Mistral: narrow access, never a bypass ----------
test('Gemini CLI policy: reading, web and quick checks allowed; push/merge/tag denied above them; never yolo', () => {
  const p = perms.geminiPolicy({ quickChecks: QC, build: true, web: true });
  assert.match(p, /toolName = \["read_file", "read_many_files", "glob", "grep_search", "list_directory"\]\ndecision = "allow"/);
  assert.match(p, /toolName = \["google_web_search", "web_fetch"\]\ndecision = "allow"/);
  assert.match(p, /commandPrefix = \[[^\]]*"node --check"[^\]]*"shellcheck"[^\]]*\]\ndecision = "allow"\npriority = 100/);
  assert.match(p, /commandPrefix = \["git push", "git tag", "git merge"[^\]]*\]\ndecision = "deny"\npriority = 900/);
  assert.doesNotMatch(p, /yolo|"\*"/);
  const read = perms.geminiPolicy({ quickChecks: QC, build: false, web: false });
  assert.match(read, /toolName = \["google_web_search", "web_fetch"\]\ndecision = "deny"/, 'Web off: web tools denied');
  assert.doesNotMatch(read, /node --check/, 'Run & build off: no quick checks');
  assert.match(read, /"git status"/, 'read-only commands stay');
});

test('a quick check with shell characters never reaches an allow-list', () => {
  assert.deepEqual(perms.cleanCmds(['node --check', 'rm -rf / ; ls', 'echo $(x)', 'a|b', 'ok cmd']), ['node --check', 'ok cmd']);
});

test('Gemini CLI run: --policy file for this run (removed after), default/auto_edit, never yolo', async () => {
  const bin = path.join(tmp, 'gemini');
  fs.writeFileSync(bin, `#!/usr/bin/env node
const a = process.argv.slice(2); const fs = require('fs');
const p = a[a.indexOf('--policy') + 1];
console.log(JSON.stringify({ response: JSON.stringify({ args: a, policy: a.includes('--policy') ? fs.readFileSync(p, 'utf8') : null, file: p }) }));
`, { mode: 0o755 });
  for (const [mode, appr] of [['read', 'default'], ['standard', 'auto_edit'], ['full', 'auto_edit']]) {
    const r = await agents.runAgent({ agent: 'google', bin, cwd: tmp, prompt: 'x', mode, quickChecks: QC, runDir: path.join(tmp, 'run') });
    assert.ok(r.ok, JSON.stringify(r));
    const o = JSON.parse(r.text);
    assert.equal(o.args[o.args.indexOf('--approval-mode') + 1], appr, mode);
    assert.ok(!o.args.includes('yolo'));
    assert.match(o.policy, /run_shell_command/);
    assert.equal(fs.existsSync(o.file), false, 'the policy file is removed after the run');
  }
});

test('Antigravity CLI: never --dangerously-skip-permissions or auto mode, also with Full access', async () => {
  const bin = path.join(tmp, 'agy');
  fs.writeFileSync(bin, '#!/usr/bin/env node\nconsole.log(JSON.stringify({ status: "SUCCESS", response: JSON.stringify(process.argv.slice(2)) }));\n', { mode: 0o755 });
  for (const mode of ['read', 'standard', 'full']) {
    const r = await agents.runAgent({ agent: 'google', bin, cwd: tmp, prompt: 'x', mode, quickChecks: QC });
    const a = JSON.parse(r.text);
    assert.ok(!a.includes('--dangerously-skip-permissions'));
    assert.equal(a[a.indexOf('--mode') + 1], mode === 'read' ? 'plan' : 'accept-edits');
  }
});

test('Mistral Vibe: the app\'s own agent profile, --add-dir for granted folders, never --auto-approve', async () => {
  const home = path.join(tmp, 'vibe-home');
  const old = process.env.VIBE_HOME;
  process.env.VIBE_HOME = home;
  const bin = path.join(tmp, 'vibe');
  fs.writeFileSync(bin, '#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify([{ role: "assistant", content: JSON.stringify(process.argv.slice(2)) }])));\n', { mode: 0o755 });
  try {
    const extra = fs.mkdtempSync(path.join(tmp, 'granted-'));
    for (const [mode, name] of [['read', 'hearth-read'], ['standard', 'hearth-build'], ['full', 'hearth-build']]) {
      const r = await agents.runAgent({ agent: 'mistral', bin, cwd: tmp, prompt: 'x', mode, quickChecks: QC, extraDirs: [extra], web: true });
      assert.ok(r.ok, JSON.stringify(r));
      const a = JSON.parse(r.text);
      assert.equal(a[a.indexOf('--agent') + 1], name, mode);
      assert.equal(a[a.indexOf('--add-dir') + 1], extra);
      assert.ok(!a.includes('--auto-approve') && !a.includes('--yolo'));
    }
    const build = fs.readFileSync(path.join(home, 'agents', 'hearth-build.toml'), 'utf8');
    assert.match(build, /\[tools\.read_file\]\npermission = "always"/);
    assert.match(build, /\[tools\.web_search\]\npermission = "always"/);
    assert.match(build, /\[tools\.write_file\]\npermission = "always"/);
    assert.match(build, /\[tools\.bash\]\npermission = "ask"\nallowlist = \[[^\]]*"node --check"/);
    assert.doesNotMatch(build, /bypass_tool_permissions|auto_approve/);
    const read = fs.readFileSync(path.join(home, 'agents', 'hearth-read.toml'), 'utf8');
    assert.match(read, /\[tools\.write_file\]\npermission = "never"/);
    assert.doesNotMatch(read, /node --check/);
    assert.equal(fs.existsSync(path.join(home, 'config.toml')), false, 'his config.toml is never written');
  } finally { if (old === undefined) delete process.env.VIBE_HOME; else process.env.VIBE_HOME = old; }
});

test('agy allow-list: added only by the owner\'s click, merged into his file (.bak), never over a broken file', () => {
  const file = path.join(tmp, 'agy-home', '.gemini', 'antigravity-cli', 'settings.json');
  const rules = perms.agyRules({ quickChecks: QC, readDirs: ['/data/chats'], protect: ['/data/settings.json'] });
  assert.ok(rules.allow.includes('command(node --check)') && rules.allow.includes('read_url(*)') && rules.allow.includes('read_file(/data/chats)'));
  assert.ok(rules.ask.includes('command(git push)'), 'push/merge/tag are asked (refused headless), not allowed');
  assert.deepEqual(rules.deny, ['write_file(/data/settings.json)']);
  assert.equal(perms.agyState(rules, file).state, 'none');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ theme: 'dark', permissions: { allow: ['command(make)'] } }));
  const r = perms.agySetup(rules, file);
  assert.ok(r.ok && r.added.length > 5);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(j.theme, 'dark', 'his other settings stay');
  assert.ok(j.permissions.allow.includes('command(make)'), 'his own rules stay');
  assert.ok(fs.existsSync(`${file}.bak`));
  assert.equal(perms.agyState(rules, file).state, 'set');
  assert.equal(perms.agySetup(rules, file).added.length, 0, 'nothing twice');
  fs.writeFileSync(file, '{ broken');
  assert.equal(perms.agySetup(rules, file).ok, false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ broken', 'a file it can\'t read is left alone');
  assert.match(src('electron/team-check.cjs'), /handle\('perms:agySetup'/);
  assert.doesNotMatch(src('electron/agents.cjs'), /agySetup/, 'a chat run never writes agy\'s settings');
});

// ---------- 10. missing quick-check tools ----------
test('missing quick-check tools are found (binaries and python modules)', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'bin-'));
  for (const b of ['node', 'npm', 'python3']) fs.writeFileSync(path.join(dir, b), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const r = await perms.missingTools(QC, { dirs: [dir], run: async () => ({ code: 3 }) });
  const miss = r.filter((x) => x.missing).map((x) => x.tool);
  assert.deepEqual(miss, ['pytest', 'shellcheck', 'cargo']);
  assert.equal(r.find((x) => x.check === 'python3 -m pytest').what, 'python3 -m pytest');
});

// ---------- 3. settings: only real changes are saved, with a log ----------
test('settings: only the leaves that changed are saved (defaults are never written)', () => {
  const before = { access: 'standard', tools: { web: true, build: true, quickChecks: ['node --check'] }, maxChats: 3, connection: { anthropic: 'cli' } };
  const after = { ...before, tools: { ...before.tools, web: false } };
  const ch = diffSettings(before, after);
  assert.deepEqual(ch.map((c) => c.key), ['tools.web']);
  const saved = applyChanges({ theme: 'dark' }, ch);
  assert.deepEqual(saved, { theme: 'dark', tools: { web: false } }, 'no quickChecks, maxChats or connection defaults written');
  assert.deepEqual(diffSettings(before, JSON.parse(JSON.stringify(before))), []);
  const team = diffSettings({ team: null }, { team: { lead: 'anthropic', members: ['anthropic', 'venice'] } });
  assert.deepEqual(team.map((c) => c.key), ['team']);
});

test('the settings change log: time, old -> new, who; atomic with a .bak; a broken log never blocks a change', () => {
  const f = path.join(tmp, 'settings-log.json');
  const log = createSettingsLog(f, { now: () => '2026-11-05T10:00:00.000Z' });
  log.add([{ key: 'access', path: ['access'], from: 'standard', to: 'full' }], 'you, in the app');
  log.add([{ key: 'tools.web', path: ['tools', 'web'], from: true, to: false }], 'Grok changed settings.json during a chat turn; undone');
  const l = log.list();
  assert.equal(l.entries[0].key, 'tools.web');
  assert.deepEqual(l.entries[1], { at: '2026-11-05T10:00:00.000Z', key: 'access', from: '"standard"', to: '"full"', by: 'you, in the app' });
  assert.ok(fs.existsSync(`${f}.bak`));
  fs.writeFileSync(f, 'nope');
  const log2 = createSettingsLog(f);
  assert.doesNotThrow(() => log2.add([{ key: 'x', path: ['x'], from: 1, to: 2 }], 'you'));
  assert.equal(fs.readFileSync(f, 'utf8'), 'nope', 'a log it can\'t read is never overwritten');
  assert.ok(log2.list().broken);
});

test('main process: writes merge only changes, never over a broken settings.json; AI changes are undone after every turn', () => {
  const m = src('electron/main.cjs');
  const w = m.slice(m.indexOf('function writeSettings('), m.indexOf('function writeRawSettings('));
  assert.match(w, /diffSettings\(readSettings\(\), s\)/);
  assert.match(w, /applyChanges\(settingsMem \|\| \{\}, changes\)/);
  assert.match(w, /settingsLog\(\)\.add\(changes, by\)/);
  assert.match(m, /function writeRawSettings\(s\) \{\n  if \(settingsBroken\) throw new Error\(settingsBroken\);/);
  assert.match(m, /function guardSettings\(who\)[\s\S]{0,400}writeRawSettings\(settingsMem \|\| \{\}\)/);
  const v2 = src('electron/v2.cjs');
  assert.match(v2, /const undone = d\.guardSettings \? d\.guardSettings\(agent\) : null;/);
  assert.doesNotMatch(v2.replace(/\/\/.*$/gm, ''), /writeSettings|settingsFile/);
  assert.match(m, /handle\('settings:log'/);
});

// ---------- 4. merging, releasing and tagging always ask ----------
test('the old lead switches never skip the owner\'s popup', () => {
  const m = src('electron/main.cjs');
  for (const ch of ["handle('git:mergeApproved'", "handle('git:prMerge'"]) {
    const h = m.slice(m.indexOf(ch), m.indexOf('handle(', m.indexOf(ch) + 10));
    const lead = h.slice(h.indexOf('if (opts?.byLead === true)'), h.indexOf('showMessageBoxSync'));
    assert.doesNotMatch(lead, /return gitops\./, `${ch}: no merge before the popup`);
    assert.match(h, /showMessageBoxSync/);
  }
  const ops = src('electron/ops/index.cjs');
  const rel = ops.slice(ops.indexOf('async function releaseOrTag('), ops.indexOf("handle('ops:releaseStatus'"));
  assert.match(rel, /if \(!viaOwner\?\.owner\) \{\n\s+const yes = dialog\.showMessageBoxSync/);
  assert.ok(rel.indexOf('showMessageBoxSync') < rel.indexOf('tagArgs'), 'asked before tagging');
});

// ---------- pre-push guard (1.6/1.7) re-verified, now only the chat's branch ----------
test('pre-push guard: main, base branch and tags refused; with the chat branch, every other branch too', () => {
  const hook = path.join(tmp, 'pre-push');
  fs.writeFileSync(hook, prePushHook(['main', 'master', 'bughunt'], 'hearth/fix-0001'), { mode: 0o755 });
  execFileSync('sh', ['-n', hook]);
  const push = (ref) => { try { execFileSync('sh', [hook], { input: `refs/heads/x 1 ${ref} 0\n`, stdio: ['pipe', 'ignore', 'ignore'] }); return 0; } catch (e) { return e.status; } };
  assert.equal(push('refs/heads/hearth/fix-0001'), 0);
  for (const ref of ['refs/heads/main', 'refs/heads/master', 'refs/heads/bughunt', 'refs/tags/v1.8.0', 'refs/heads/feature/x', 'refs/heads/hearth/other']) assert.equal(push(ref), 1, ref);
  assert.match(src('electron/copies.cjs'), /prePushHook\(\['main', 'master', base, defaultBranch\]\.filter\(Boolean\), work\)/);
  const push2 = src('electron/copies.cjs');
  assert.match(push2, /!\/\^hearth\\\/\/\.test\(work\)/, 'push() still only pushes hearth/ branches');
});

// ---------- 7. pictures ----------
test('pictures: ATTACH in a list, relative and absolute links inside the folder work; others get a plain reason', () => {
  const cwd = fs.mkdtempSync(path.join(tmp, 'chat-'));
  const root = path.join(tmp, 'media');
  fs.mkdirSync(path.join(cwd, '.hearth-ai', 'assets', 'google'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.hearth-media'));
  const png = cardsLib.plainPng(8);
  fs.writeFileSync(path.join(cwd, '.hearth-ai', 'assets', 'google', 'a.png'), png);
  fs.writeFileSync(path.join(cwd, '.hearth-media', 'b.png'), png);
  fs.writeFileSync(path.join(cwd, 'shot.png'), png);
  fs.writeFileSync(path.join(cwd, 'pic.bmp'), 'BM');
  fs.writeFileSync(path.join(cwd, 'huge.png'), '');
  fs.truncateSync(path.join(cwd, 'huge.png'), media.MAX_FILE + 1);
  const text = ['- ATTACH: `.hearth-ai/assets/google/a.png`.', 'ATTACH: .hearth-media/b.png', `![shot](${path.join(cwd, 'shot.png')})`, 'ATTACH: missing.png', 'ATTACH: ../outside.png', '![x](/etc/hostname.png)', 'ATTACH: pic.bmp', 'ATTACH: huge.png'].join('\n');
  const r = media.collectAll({ cwd, sinceMs: Date.now() + 60000, text, chatId: 'c0000000001', root });
  assert.equal(r.items.length, 1, 'the same picture is stored once');
  assert.deepEqual([r.items[0].from, ...(r.items[0].alsoFrom || [])].sort(), ['.hearth-ai/assets/google/a.png', '.hearth-media/b.png', path.join(cwd, 'shot.png')].sort(), 'every link that named it points at it');
  const why = Object.fromEntries(r.problems.map((p) => [p.path, p.reason]));
  assert.match(why['missing.png'], /missing/);
  assert.match(why['../outside.png'], /outside/);
  assert.match(why['/etc/hostname.png'], /outside/);
  assert.match(why['pic.bmp'], /isn't a type/);
  assert.match(why['huge.png'], /too large/);
});

// ---------- 8/9. permissions table and team test ----------
test('permissions table: worked out from the CLI found, its tool and the allow-list state', () => {
  const none = teamCheck.capabilities({ id: 'google', cli: { installed: true, tool: 'agy', version: '1.4.4' }, agy: { state: 'none' } });
  assert.equal(none.tool, 'agy 1.4.4');
  assert.match(none.commands, /refused until you set up/);
  const set = teamCheck.capabilities({ id: 'google', cli: { installed: true, tool: 'agy' }, agy: { state: 'set' } });
  assert.match(set.commands, /quick checks/);
  assert.match(teamCheck.capabilities({ id: 'mistral', cli: { installed: false } }).tool, /not installed/);
  assert.match(teamCheck.capabilities({ id: 'anthropic', cli: { installed: true }, access: 'full' }).commands, /any command/);
  const venice = teamCheck.capabilities({ id: 'venice', method: 'api', apiReady: false });
  assert.equal(venice.tool, 'needs a key');
  assert.equal(venice.push, 'No');
  assert.match(teamCheck.capabilities({ id: 'openai', cli: { installed: true } }).push, /hearth\//);
});

test('team test: the app checks the token and that the file is gone; a failed run shows the real error per step', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'tt-'));
  fs.writeFileSync(path.join(dir, 'probe.txt'), 'x');
  const ok = teamCheck.judge({ dir, token: 'abc123', r: { ok: true, text: 'STEP 1: PASS abc123\nSTEP 2: PASS https://example.org/x\nSTEP 3: PASS no errors\nSTEP 4: PASS deleted' } });
  assert.deepEqual(ok.map((s) => s.pass), [true, true, true, true]);
  fs.writeFileSync(path.join(dir, 'hearth-check.js'), 'x');
  const left = teamCheck.judge({ dir, token: 'abc123', r: { ok: true, text: 'STEP 1: PASS zzz\nSTEP 2: PASS searched\nSTEP 3: FAIL command not allowed\nSTEP 4: PASS' } });
  assert.deepEqual(left.slice(0, 4).map((s) => s.pass), [false, false, false, false]);
  assert.match(left[2].detail, /command not allowed/);
  assert.match(left[3].detail, /still there/);
  const failed = teamCheck.judge({ dir, token: 't', r: { ok: false, error: { kind: 'failed', message: 'a tool required the \'command\' permission that headless mode cannot prompt for' } } });
  assert.ok(failed.every((s) => !s.pass && /headless mode/.test(s.detail)));
  const t = src('electron/team-check.cjs');
  assert.match(t, /mkdtempSync\(path\.join\(os\.tmpdir\(\), 'hearth-teamtest-'\)\)/, 'a temporary scratch folder, not a repo');
  assert.match(t, /guardSettings\('A teammate in the team test'\)/);
  const run = t.slice(t.indexOf("handle('team:test'"));
  assert.doesNotMatch(run, /bypassPermissions|dangerously|makeImage|push\(/);
});

// ---------- Find characters ----------
function zipStored(files) {
  const parts = []; const central = []; let off = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name); const crc = cardsLib.crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    parts.push(h, n, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central); const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}

test('Find characters: a downloaded PNG, JSON or CHARX card is imported (picture included)', () => {
  const lib = cardsLib.createCards({ dataDir: fs.mkdtempSync(path.join(tmp, 'cards-')) });
  const pics = [];
  const imp = (name, buf) => finder.importDownloaded({ name, buf, importFile: (n, b) => lib.importFile(n, b), setPicture: (id, b) => { pics.push(id); lib.save({ id, avatarData: `data:image/png;base64,${b.toString('base64')}` }); } });
  const card = { spec: 'chara_card_v2', data: { name: 'Mira', description: 'A traveller of the north woods.', first_mes: 'Hello.' } };
  const png = cardsLib.withPngText(cardsLib.plainPng(16), { chara: cardsLib.b64(card) });
  const a = imp('Mira.png', png);
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.card.name, 'Mira');
  assert.ok(a.card.avatarUrl, 'the picture came with it');
  const b = imp('tobin.json', Buffer.from(JSON.stringify({ ...card, data: { ...card.data, name: 'Tobin' } })));
  assert.equal(b.card.name, 'Tobin');
  const c = imp('ash.charx', zipStored({ 'card.json': Buffer.from(JSON.stringify({ spec: 'chara_card_v3', data: { name: 'Ash', description: 'x', first_mes: 'Hi' } })), 'assets/icon/main.png': cardsLib.plainPng(8) }));
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.card.name, 'Ash');
  assert.equal(pics.length, 1, 'the charx picture is set');
  assert.deepEqual(lib.list().map((x) => x.name).sort(), ['Ash', 'Mira', 'Tobin']);
});

test('Find characters: other file types and files over 20 MB are ignored', () => {
  for (const f of ['setup.exe', 'card.zip', 'page.html', 'x.sh']) assert.equal(finder.acceptDownload({ filename: f, total: 10 }).ok, false, f);
  assert.equal(finder.acceptDownload({ filename: 'big.png', total: finder.MAX_CARD + 1 }).ok, false);
  assert.equal(finder.acceptDownload({ filename: 'ok.charx', total: 1000 }).ok, true);
  let called = false;
  const r = finder.importDownloaded({ name: 'run.exe', buf: Buffer.from('MZ'), importFile: () => { called = true; } });
  assert.equal(r.ignored, true);
  assert.equal(called, false, 'never handed to the importer');
  const big = finder.importDownloaded({ name: 'big.json', buf: Buffer.alloc(finder.MAX_CARD + 1), importFile: () => { called = true; } });
  assert.equal(big.ok, false);
  assert.equal(called, false);
});

test('Find characters: an under-18 card still imports and is flagged (blocked from sexual content)', () => {
  const lib = cardsLib.createCards({ dataDir: fs.mkdtempSync(path.join(tmp, 'cards-')) });
  const r = finder.importDownloaded({ name: 'lena.json', buf: Buffer.from(JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Lena', description: 'Lena is 12 years old.', first_mes: 'Hi!' } })), importFile: (n, b) => lib.importFile(n, b) });
  assert.equal(r.ok, true);
  assert.equal(r.card.minor, true);
  assert.equal(cardsLib.checkRequest({ cards: [lib.get(r.card.id)], text: 'something sexual' }).ok, false);
});

test('Find characters: the site window has no preload, its own profile, and imports never touch settings', () => {
  const f = src('electron/card-finder.cjs').replace(/^\s*\/\/.*$/gm, '');
  assert.match(f, /partition: `persist:cards-\$\{id\}`, contextIsolation: true, nodeIntegration: false, sandbox: true/);
  assert.doesNotMatch(f, /preload|settings|executeJavaScript|shell\.openPath|child_process/);
  assert.match(f, /item\.cancel\(\)/);
});

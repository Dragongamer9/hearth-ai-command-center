// 2.x main process: steps parsed from the CLIs' events, live previews served sandboxed, and
// the in-app updaters left exactly as they were in 1.5.0 (RED FLAG).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const steps = require('../electron/steps.cjs');
const previews = require('../electron/previews.cjs');
const { claudePolicy, cleanQuick } = require('../electron/v2.cjs');

// Temp folders made by this file are removed when it finishes.
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('steps from Claude Code stream-json tool uses', () => {
  const ev = { type: 'assistant', message: { content: [
    { type: 'text', text: 'Looking.' },
    { type: 'tool_use', name: 'Grep', input: { pattern: 'wifi rescan' } },
    { type: 'tool_use', name: 'Read', input: { file_path: '/c/hosts/WifiPage.qml' } },
    { type: 'tool_use', name: 'WebFetch', input: { url: 'https://networkmanager.dev/docs/api' } },
    { type: 'tool_use', name: 'Edit', input: { file_path: '/c/nm-watch.py' } },
    { type: 'tool_use', name: 'Bash', input: { command: 'python3 -m py_compile nm-watch.py' } },
    { type: 'tool_use', name: 'Bash', input: { command: 'git push origin HEAD:hearth/wifi' } },
    { type: 'tool_use', name: 'Bash', input: { command: 'gh run watch 123' } },
    { type: 'tool_use', name: 'TodoWrite', input: {} },
  ] } };
  assert.deepEqual(steps.fromEvent('anthropic', ev).map((s) => [s.kind, s.label, s.detail]), [
    ['search', 'Searched the repo', 'for “wifi rescan”'],
    ['read', 'Read', 'WifiPage.qml'],
    ['web-read', 'Read a web page', 'networkmanager.dev'],
    ['edit', 'Edited', 'nm-watch.py'],
    ['check', 'Ran checks locally', 'python3 -m py_compile nm-watch.py'],
    ['push', 'Pushed', 'git push origin HEAD:hearth/wifi'],
    ['actions', 'Checked GitHub Actions', 'gh run watch 123'],
  ]);
  assert.deepEqual(steps.fromEvent('anthropic', { type: 'result', result: 'x' }), []);
});

test('steps from Codex --json events', () => {
  assert.deepEqual(steps.fromEvent('openai', { type: 'item.started', item: { type: 'command_execution', command: 'node --test test/a.test.js' } }).map((s) => s.kind), ['check']);
  assert.deepEqual(steps.fromEvent('openai', { type: 'item.started', item: { type: 'file_change', changes: [{ path: 'src/a.js' }, { path: 'src/b.js' }] } }).map((s) => s.detail), ['a.js', 'b.js']);
  assert.deepEqual(steps.fromEvent('openai', { type: 'item.completed', item: { type: 'command_execution', command: 'x' } }), [], 'each step once');
  assert.deepEqual(steps.fromEvent('google', { type: 'assistant' }), []);
});

test('Claude Code gets exactly the permissions of the turn', () => {
  const on = claudePolicy({ build: true, access: 'standard', quickChecks: ['node --check', 'rm -rf /; x', 'npm test'], web: true });
  assert.equal(on.perm, 'acceptEdits');
  assert.ok(on.allowedTools.includes('Bash(node --check:*)'));
  assert.ok(on.allowedTools.includes('Bash(git push:*)'), 'it may push the chat branch (the copy\'s hook refuses main and tags)');
  assert.ok(!on.allowedTools.some((t) => t.includes('rm -rf')), 'shell tricks never get in');
  assert.ok(!on.allowedTools.some((t) => /gh (api|release|workflow|pr merge)/.test(t)));
  const off = claudePolicy({ build: false, access: 'standard', quickChecks: ['node --check'], web: false });
  assert.ok(!off.allowedTools.some((t) => /git push|node --check/.test(t)), 'Run & build off: no commands that change anything');
  assert.equal(off.web, false);
  assert.equal(claudePolicy({ build: true, access: 'full', quickChecks: [], web: true }).perm, 'bypassPermissions', 'only with the owner\'s Full access');
  assert.deepEqual(cleanQuick(['bash -n', 'a && b', '$(x)', 'node --check', 'node --check']), ['bash -n', 'node --check']);
  // agents.cjs: stream-json only when steps are wanted; web tools removed when Web is off.
  const ag = read('electron/agents.cjs');
  assert.match(ag, /'--output-format', lines \? 'stream-json' : 'json', \.\.\.\(lines \? \['--verbose'\] : \[\]\)/);
  assert.match(ag, /if \(!web\) args\.push\('--disallowedTools', 'WebSearch', 'WebFetch'\)/);
});

test('previews are served with their own CSP; network only when the owner allows it', () => {
  const store = previews.createPreviewStore();
  const url = store.add('<h1>x</h1>', false);
  assert.match(url, /^hearth-preview:\/\/[0-9a-f]{16}\/$/);
  const r = store.respond(url);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-security-policy'], /default-src 'none'/);
  assert.match(r.headers['content-security-policy'], /connect-src 'none'/);
  assert.doesNotMatch(r.headers['content-security-policy'], /https:/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.match(store.respond(store.add('x', true)).headers['content-security-policy'], /connect-src https:/);
  assert.equal(store.respond('hearth-preview://nope/').status, 404);
  assert.throws(() => store.add('x'.repeat(7 * 1024 * 1024)), /too big/);
});

test('previews written to .hearth-preview/ during the turn are picked up (and nothing else)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-pv-'));
  made.push(dir);
  const d = path.join(dir, '.hearth-preview');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'page.html'), '<p>1</p>');
  fs.writeFileSync(path.join(d, 'chart.svg'), '<svg/>');
  fs.writeFileSync(path.join(d, 'notes.md'), '# n');
  fs.writeFileSync(path.join(d, 'evil.sh'), 'rm -rf');
  fs.writeFileSync(path.join(d, 'huge.html'), 'x'.repeat(previews.MAX_FILE + 1));
  fs.symlinkSync('/etc/hostname', path.join(d, 'link.html'));
  const old = path.join(d, 'old.html');
  fs.writeFileSync(old, 'old');
  fs.utimesSync(old, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
  const got = previews.collect(dir, Date.now() - 60e3);
  assert.deepEqual(got.map((p) => p.name).sort(), ['chart.svg', 'notes.md', 'page.html']);
  assert.equal(got.find((p) => p.name === 'notes.md').kind, 'markdown');
});

test('RED FLAG: the in-app updaters and release.yml are exactly as in 1.5.0', () => {
  // If one of these must change, the owner says so first; then update the hash here.
  const want = {
    'electron/updater.cjs': '4811aac6a6dc40341d19a8d2a4d27446cddba6df6d2b01e9ae7030504897e311',
    'electron/updater-deb.cjs': '39ed4ef6b4a491baa81ce686c9b98bc502e4d41ac87d7f439cafe9fce3ba7805',
    '.github/workflows/release.yml': 'ae12e7d818779ddb637df6846276ee82a3a7e8f33cc1360e3db5822a96e7deae',
  };
  for (const [f, h] of Object.entries(want)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', f))).digest('hex'), h, f);
  const main = read('electron/main.cjs');
  for (const ch of ['updater:info', 'updater:check', 'updater:download', 'updater:install', 'updater:restart']) assert.ok(main.includes(`handle('${ch}'`), ch);
});

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const agents = require('../electron/agents.cjs');
const ws = require('../electron/workspace.cjs');

const FIX = path.join(__dirname, 'fixtures');

test('limit detection', () => {
  for (const t of ['Claude AI usage limit reached|resets 3pm', 'You have hit your usage limit', 'Error 429 Too Many Requests', 'insufficient_quota', 'Your credit balance is too low']) assert.ok(agents.isLimit(t), t);
  assert.ok(!agents.isLimit('Compiled successfully'));
  assert.equal(agents.resetHint('limit reached, resets at 3pm.'), 'resets at 3pm');
  assert.equal(agents.resetHint('usage limit reached|resets 3pm'), 'resets 3pm');
});

test('parseClaude handles json and plain text', () => {
  assert.equal(agents.parseClaude('{"result":"hi","is_error":false}').text, 'hi');
  assert.equal(agents.parseClaude('noise\n{"result":"x","is_error":true}').isError, true);
  assert.equal(agents.parseClaude('plain words').text, 'plain words');
});

test('missing binary is reported, not thrown', async () => {
  const r = await agents.runAgent({ agent: 'anthropic', prompt: 'hi', bin: '/nonexistent/claude' });
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'not_installed');
});

test('status of fake signed-in CLIs', async () => {
  assert.deepStrictEqual(await agents.status('anthropic', path.join(FIX, 'claude')), { installed: true, signedIn: true, path: path.join(FIX, 'claude') });
  assert.equal((await agents.status('openai', path.join(FIX, 'codex'))).signedIn, true);
});

test('shared workspace: Claude runs out, ChatGPT continues on the same branch, nothing lost', async (t) => {
  // Hermetic: config and GIT_AUTHOR_*/GIT_COMMITTER_* on this machine must not decide the commit email.
  const saved = {};
  const drop = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];
  const keys = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', ...drop];
  for (const k of keys) saved[k] = process.env[k];
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  for (const k of drop) delete process.env[k];
  t.after(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-test-'));
  const project = path.join(tmp, 'project');
  fs.mkdirSync(project);
  const g = (...a) => execFileSync('git', a, { cwd: project });
  g('init', '-q');
  fs.writeFileSync(path.join(project, 'README.md'), 'hi\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');

  const w = await ws.ensureWorktree({ project, root: path.join(tmp, 'ws'), taskId: 'ABC123', title: 'Add feature' });
  assert.match(w.branch, /^hearth\/abc123-add-feature$/);

  // 1) Claude works normally.
  let r = await agents.runAgent({ agent: 'anthropic', prompt: 'do it', cwd: w.dir, mode: 'edit', bin: path.join(FIX, 'claude') });
  assert.ok(r.ok, JSON.stringify(r));
  assert.match(r.text, /STATUS: DONE/);
  const cp1 = await ws.checkpoint(w.dir, { author: 'Claude', message: 'Claude: progress' });
  assert.ok(cp1.sha);

  // 2) Claude hits its usage limit mid-way; partial work is still checkpointed.
  process.env.FAKE_CLAUDE_LIMIT = '1';
  r = await agents.runAgent({ agent: 'anthropic', prompt: 'more', cwd: w.dir, mode: 'edit', bin: path.join(FIX, 'claude') });
  delete process.env.FAKE_CLAUDE_LIMIT;
  assert.equal(r.error.kind, 'limit');
  const cp2 = await ws.checkpoint(w.dir, { author: 'Claude', message: 'Claude: checkpoint (limit)' });
  assert.ok(cp2.sha, 'partial work must be committed');

  // 3) ChatGPT picks it up in the same worktree and sees everything.
  const summary = await ws.summary(w.dir, w.baseSha);
  assert.match(summary, /Claude: checkpoint \(limit\)/);
  assert.match(summary, /claude-partial\.txt/);
  r = await agents.runAgent({ agent: 'openai', prompt: `HANDOFF from Claude\n${summary}`, cwd: w.dir, mode: 'edit', bin: path.join(FIX, 'codex') });
  assert.ok(r.ok, JSON.stringify(r));
  assert.match(r.text, /continued handoff/);
  await ws.checkpoint(w.dir, { author: 'ChatGPT', message: 'ChatGPT: progress' });

  for (const f of ['claude.txt', 'claude-partial.txt', 'codex.txt']) assert.ok(fs.existsSync(path.join(w.dir, f)), f);
  // Commits are the owner's: no AI names as authors/committers, no attribution lines.
  const who = execFileSync('git', ['log', '--format=%an <%ae>%n%cn <%ce>', `${w.baseSha}..HEAD`], { cwd: w.dir }).toString();
  assert.ok(who.trim().split('\n').length >= 6);
  assert.doesNotMatch(who, /Claude|ChatGPT|Hearth AI|hearth-ai@localhost/);
  assert.match(who, /Dragongamer9 <Dragongamer9@users\.noreply\.github\.com>/);
  assert.doesNotMatch(execFileSync('git', ['log', '--format=%B', `${w.baseSha}..HEAD`], { cwd: w.dir }).toString(), /Co-authored-by/i);
  // Main branch untouched.
  assert.equal(execFileSync('git', ['log', '--oneline'], { cwd: project }).toString().trim().split('\n').length, 1);
  assert.equal(await ws.checkpoint(w.dir, { author: 'x', message: 'nothing' }), null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('non-repo project is refused', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-test-'));
  await assert.rejects(ws.ensureWorktree({ project: tmp, root: tmp, taskId: 'ABC123', title: 'x' }), /not a git repository/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

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

test('shared workspace: Claude runs out, ChatGPT continues on the same branch, nothing lost', async () => {
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
  const log = execFileSync('git', ['log', '--format=%an', `${w.baseSha}..HEAD`], { cwd: w.dir }).toString();
  assert.match(log, /ChatGPT \(Hearth AI\)/);
  assert.match(log, /Claude \(Hearth AI\)/);
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

// New team members: Grok (xAI), Mistral, Qwen CLIs; Perplexity / DeepSeek / xAI / Mistral APIs;
// CLI session ids for resuming in each AI's own CLI.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const agents = require('../electron/agents.cjs');
const { callProvider, ENDPOINTS } = require('../electron/providers.cjs');

const FIX = path.join(__dirname, 'fixtures');

test('Claude runs get a session id (new or resumed) for `claude --resume`', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-s-'));
  const echo = path.join(dir, 'echo-args');
  fs.writeFileSync(echo, '#!/bin/sh\ncat >/dev/null\nprintf \'{"is_error":false,"result":"%s","session_id":"from-cli-0001"}\' "$*"\n');
  fs.chmodSync(echo, 0o755);
  let r = await agents.runAgent({ agent: 'anthropic', prompt: 'x', cwd: dir, bin: echo });
  assert.match(r.text, /--session-id [0-9a-f-]{36}/);
  assert.match(r.text, /--settings \S+claude-settings\.json/, 'AI attribution turned off through a settings file');
  assert.equal(r.sessionId, 'from-cli-0001');
  r = await agents.runAgent({ agent: 'anthropic', prompt: 'x', cwd: dir, bin: echo, resumeId: 'abcd-1234' });
  assert.match(r.text, /--resume abcd-1234/);
  assert.doesNotMatch(r.text, /--session-id/);
  r = await agents.runAgent({ agent: 'anthropic', prompt: 'x', cwd: dir, bin: echo, resumeId: 'bad id; rm' });
  assert.doesNotMatch(r.text, /--resume/, 'unsafe ids are ignored');
  const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.cache', 'hearth-ai', 'claude-settings.json'), 'utf8'));
  assert.deepStrictEqual(s, { includeCoAuthoredBy: false, attribution: { commit: '', pr: '' } });
});

test('Codex JSON events give the thread id; resume goes through `codex exec … resume <id>`', async () => {
  assert.deepStrictEqual(agents.parseCodexEvents('{"type":"thread.started","thread_id":"0199-abc"}\nnoise\n{"type":"item.completed","item":{"type":"agent_message","text":"done"}}'), { threadId: '0199-abc', text: 'done' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-c-'));
  const fake = path.join(dir, 'codex');
  fs.writeFileSync(fake, `#!/bin/sh
out=""; prev=""; for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
echo '{"type":"thread.started","thread_id":"0199-thread-1"}'
printf '%s' "$*" > "$out"
`);
  fs.chmodSync(fake, 0o755);
  let r = await agents.runAgent({ agent: 'openai', prompt: 'hello', cwd: dir, bin: fake });
  assert.equal(r.sessionId, '0199-thread-1');
  assert.match(r.text, /exec --json .* -$/);
  r = await agents.runAgent({ agent: 'openai', prompt: 'next part', cwd: dir, bin: fake, resumeId: '0199-thread-1' });
  assert.match(r.text, /resume 0199-thread-1 next part$/);
});

test('Grok Build: headless JSON, client-chosen session id, resume, approvals by mode', async () => {
  const bin = path.join(FIX, 'grok');
  let r = await agents.runAgent({ agent: 'xai', prompt: 'hi', cwd: os.tmpdir(), mode: 'read', bin });
  assert.ok(r.ok, JSON.stringify(r));
  assert.match(r.text, /new session, approvals ask/);
  assert.match(r.sessionId, /^[0-9a-f-]{36}$/);
  r = await agents.runAgent({ agent: 'xai', prompt: 'hi', cwd: os.tmpdir(), mode: 'standard', bin, resumeId: r.sessionId });
  assert.match(r.text, /resumed session, approvals auto/);
  assert.deepStrictEqual(agents.parseGrok('log\n{"result":"x","session_id":"s1"}'), { text: 'x', sessionId: 's1', isError: false });
  assert.equal((await agents.logout('xai', bin)).ok, true);
});

test('Mistral Vibe: prompt on stdin, last assistant message from JSON, auto-approve only in full mode', async () => {
  const bin = path.join(FIX, 'vibe');
  let r = await agents.runAgent({ agent: 'mistral', prompt: 'hi', cwd: os.tmpdir(), mode: 'standard', bin });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.text, 'Vibe answered (accept-edits).');
  r = await agents.runAgent({ agent: 'mistral', prompt: 'hi', cwd: os.tmpdir(), mode: 'full', bin });
  assert.equal(r.text, 'Vibe answered (auto).');
  assert.equal(agents.parseVibe('not json').text, 'not json');
});

test('Qwen Code uses the Gemini-style headless flags', async () => {
  const r = await agents.runAgent({ agent: 'qwen', prompt: 'x', cwd: os.tmpdir(), mode: 'edit', bin: path.join(FIX, 'gemini') });
  assert.ok(r.ok);
  assert.equal(r.via, 'Qwen Code');
  assert.match(r.text, /auto_edit mode/);
});

test('sign-in detection for Grok and Qwen reads only the presence of their own files', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-home-'));
  const old = { HOME: process.env.HOME, GROK_HOME: process.env.GROK_HOME, XAI_API_KEY: process.env.XAI_API_KEY };
  process.env.HOME = home;
  delete process.env.GROK_HOME; delete process.env.XAI_API_KEY;
  try {
    assert.equal((await agents.status('xai', path.join(FIX, 'grok'))).signedIn, false);
    fs.mkdirSync(path.join(home, '.grok'));
    fs.writeFileSync(path.join(home, '.grok', 'auth.json'), '{}');
    assert.equal((await agents.status('xai', path.join(FIX, 'grok'))).signedIn, true);
    assert.equal((await agents.status('qwen', path.join(FIX, 'gemini'))).signedIn, false);
    fs.mkdirSync(path.join(home, '.qwen'));
    fs.writeFileSync(path.join(home, '.qwen', 'oauth_creds.json'), '{}');
    assert.equal((await agents.status('qwen', path.join(FIX, 'gemini'))).signedIn, true);
    assert.equal((await agents.logout('qwen')).ok, true);
    assert.ok(!fs.existsSync(path.join(home, '.qwen', 'oauth_creds.json')));
    assert.equal((await agents.status('mistral', path.join(FIX, 'vibe'))).signedIn, null, 'Vibe keeps its login in the keyring: unknown, not guessed');
  } finally {
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('official API endpoints for xAI, Mistral, Perplexity and DeepSeek; Perplexity sources kept', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content: 'answer' } }], citations: url.includes('perplexity') ? ['https://docs.example/a'] : undefined }) };
  };
  for (const provider of ['xai', 'mistral', 'perplexity', 'deepseek']) {
    const r = await callProvider({ provider, apiKey: 'key-123456789', model: 'm1', prompt: 'hi', fetchImpl });
    assert.ok(r.ok, provider);
    if (provider === 'perplexity') assert.match(r.text, /Sources:\n\[1\] https:\/\/docs\.example\/a/);
    else assert.equal(r.text, 'answer');
  }
  assert.deepStrictEqual(calls.map((c) => c.url), [ENDPOINTS.xai, ENDPOINTS.mistral, ENDPOINTS.perplexity, ENDPOINTS.deepseek]);
  assert.ok(calls.every((c) => c.auth === 'Bearer key-123456789' && c.body.messages[0].content === 'hi'));
  assert.ok(Object.values(ENDPOINTS).every((u) => u.startsWith('https://')));
});

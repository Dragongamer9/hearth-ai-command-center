const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const FIX = path.join(__dirname, 'fixtures');

// Fake Ollama server; must be set before agents.cjs is loaded.
let server;
const ready = new Promise((resolve) => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }));
      if (req.url === '/api/chat') {
        const j = JSON.parse(body);
        return res.end(JSON.stringify({ message: { role: 'assistant', content: `local ${j.model} says hi` } }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  }).listen(0, '127.0.0.1', () => resolve());
});

test('Gemini CLI: plan vs edit mode, JSON parsing, quota = usage limit', async () => {
  await ready;
  const agents = require('../electron/agents.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-g-'));
  const bin = path.join(FIX, 'gemini');
  let r = await agents.runAgent({ agent: 'google', prompt: 'x', cwd: dir, mode: 'read', bin });
  assert.ok(r.ok, JSON.stringify(r));
  assert.match(r.text, /plan mode/);
  r = await agents.runAgent({ agent: 'google', prompt: 'x', cwd: dir, mode: 'edit', bin });
  assert.match(r.text, /auto_edit mode/);
  assert.equal(r.via, 'Gemini CLI');
  process.env.FAKE_GEMINI_LIMIT = '1';
  r = await agents.runAgent({ agent: 'google', prompt: 'x', cwd: dir, mode: 'edit', bin });
  delete process.env.FAKE_GEMINI_LIMIT;
  assert.equal(r.error.kind, 'limit');
  assert.deepStrictEqual(agents.parseGemini('{"response":"hi"}'), { text: 'hi', error: null });
});

test('local AI via Ollama: lists models and answers', async () => {
  await ready;
  process.env.OLLAMA_HOST = `http://127.0.0.1:${server.address().port}`;
  delete require.cache[require.resolve('../electron/agents.cjs')];
  const agents = require('../electron/agents.cjs');
  const st = await agents.status('ollama');
  assert.deepStrictEqual(st.models, ['llama3.2:latest']);
  const r = await agents.runAgent({ agent: 'ollama', prompt: 'hello' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.text, 'local llama3.2:latest says hi');
  server.close();
  const down = await agents.runAgent({ agent: 'ollama', prompt: 'hello' });
  assert.equal(down.error.kind, 'not_installed');
});

test('OLLAMA_HOST pointing off this machine is ignored', () => {
  process.env.OLLAMA_HOST = 'http://evil.example.com:11434';
  delete require.cache[require.resolve('../electron/agents.cjs')];
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'agents.cjs'), 'utf8');
  assert.match(src, /127\\\.0\\\.0\\\.1\|localhost/);
  delete process.env.OLLAMA_HOST;
});

test('installers only use the fixed official npm packages', () => {
  const agents = require('../electron/agents.cjs');
  assert.deepStrictEqual(agents.NPM_PACKAGE, {
    anthropic: '@anthropic-ai/claude-code', openai: '@openai/codex', google: '@google/gemini-cli', freebuff: 'freebuff',
  });
});

test('disconnect uses each tool\'s own sign-out; Gemini forgets only its Google sign-in file', async () => {
  const agents = require('../electron/agents.cjs');
  assert.deepStrictEqual(await agents.logout('anthropic', path.join(FIX, 'claude')), { ok: true });
  assert.deepStrictEqual(await agents.logout('openai', path.join(FIX, 'codex')), { ok: true });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-home-'));
  const old = process.env.HOME;
  process.env.HOME = home;
  try {
    fs.mkdirSync(path.join(home, '.gemini'));
    fs.writeFileSync(path.join(home, '.gemini', 'oauth_creds.json'), '{}');
    fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), '{"keep":true}');
    assert.deepStrictEqual(await agents.logout('google'), { ok: true });
    assert.ok(!fs.existsSync(path.join(home, '.gemini', 'oauth_creds.json')));
    assert.ok(fs.existsSync(path.join(home, '.gemini', 'settings.json')), 'other Gemini settings untouched');
    assert.equal((await agents.logout('google')).ok, true);
    assert.equal((await agents.logout('freebuff')).ok, false);
  } finally {
    process.env.HOME = old;
  }
});

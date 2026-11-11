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

test('Gemini CLI: default (read) vs auto_edit, never yolo; JSON parsing, quota = usage limit', async () => {
  await ready;
  const agents = require('../electron/agents.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-g-'));
  const bin = path.join(FIX, 'gemini');
  let r = await agents.runAgent({ agent: 'google', prompt: 'x', cwd: dir, mode: 'read', bin, runDir: dir });
  assert.ok(r.ok, JSON.stringify(r));
  assert.match(r.text, /default mode/);
  r = await agents.runAgent({ agent: 'google', prompt: 'x', cwd: dir, mode: 'edit', bin, runDir: dir });
  assert.match(r.text, /auto_edit mode/);
  r = await agents.runAgent({ agent: 'google', prompt: 'x', cwd: dir, mode: 'full', bin, runDir: dir });
  assert.match(r.text, /auto_edit mode/, 'Full access never means yolo for Gemini');
  assert.equal(r.via, 'Gemini CLI');
  process.env.FAKE_GEMINI_LIMIT = '1';
  r = await agents.runAgent({ agent: 'google', prompt: 'x', cwd: dir, mode: 'edit', bin });
  delete process.env.FAKE_GEMINI_LIMIT;
  assert.equal(r.error.kind, 'limit');
  assert.deepStrictEqual(agents.parseGemini('{"response":"hi"}'), { text: 'hi', error: null, sessionId: null });
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
    anthropic: '@anthropic-ai/claude-code', openai: '@openai/codex', google: '@google/gemini-cli', xai: '@xai-official/grok', qwen: '@qwen-code/qwen-code', freebuff: 'freebuff',
    // 3.3: each company's own CLI package (electron/more-ais.cjs).
    ghcopilot: '@github/copilot', kimi: '@moonshot-ai/kimi-code', opencode: 'opencode-ai', cline: 'cline', crush: '@charmland/crush', amp: '@sourcegraph/amp', auggie: '@augmentcode/auggie@prerelease', droid: '@factory/cli',
  });
});

test('disconnect uses each tool\'s own sign-out; agy is left alone, Gemini CLI forgets only its Google sign-in file', async () => {
  const agents = require('../electron/agents.cjs');
  assert.deepStrictEqual(await agents.logout('anthropic', path.join(FIX, 'claude')), { ok: true });
  assert.deepStrictEqual(await agents.logout('openai', path.join(FIX, 'codex')), { ok: true });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-home-'));
  const old = process.env.HOME;
  process.env.HOME = home;
  const agy = path.join(home, 'agy');
  fs.writeFileSync(agy, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  try {
    fs.mkdirSync(path.join(home, '.gemini'));
    fs.writeFileSync(path.join(home, '.gemini', 'oauth_creds.json'), '{}');
    fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), '{"keep":true}');
    // agy keeps its Google sign-in; the app never holds it and does not delete the Gemini CLI file.
    assert.deepStrictEqual(await agents.logout('google', agy), { ok: false, message: 'Sign out inside agy itself (run agy in a terminal); the app never holds its sign-in.' });
    assert.ok(fs.existsSync(path.join(home, '.gemini', 'oauth_creds.json')), 'agy sign-out leaves the Gemini CLI sign-in file alone');
    assert.deepStrictEqual(await agents.logout('google', path.join(FIX, 'gemini')), { ok: true });
    assert.ok(!fs.existsSync(path.join(home, '.gemini', 'oauth_creds.json')));
    assert.ok(fs.existsSync(path.join(home, '.gemini', 'settings.json')), 'other Gemini settings untouched');
    assert.equal((await agents.logout('google', path.join(FIX, 'gemini'))).ok, true);
    assert.equal((await agents.logout('freebuff')).ok, false);
  } finally {
    process.env.HOME = old;
  }
});

test('permission levels map to each tool\'s own modes', async () => {
  const agents = require('../electron/agents.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-m-'));
  const echo = path.join(dir, 'echo-args');
  fs.writeFileSync(echo, '#!/bin/sh\ncat >/dev/null\nprintf \'{"is_error":false,"result":"%s"}\' "$*"\n');
  fs.chmodSync(echo, 0o755);
  const args = async (mode, extraDirs = []) => (await agents.runAgent({ agent: 'anthropic', prompt: 'x', cwd: dir, mode, bin: echo, extraDirs })).text;
  assert.match(await args('read'), /--permission-mode plan .*WebSearch WebFetch/);
  assert.match(await args('edit'), /--permission-mode auto /);
  assert.doesNotMatch(await args('standard'), /dangerously/);
  assert.match(await args('full'), /bypassPermissions.*--dangerously-skip-permissions/);
  assert.match(await args('standard', [dir, '/does/not/exist', 'relative']), new RegExp(`--add-dir ${dir}$`));
});

// Free AI: the free tiers of several providers with the owner's own keys, one after another.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFreeAi, PROVIDERS } = require('../electron/free-ai.cjs');
const { createTeammates } = require('../electron/teammates.cjs');

const fakeSecrets = (init = {}) => { const m = new Map(Object.entries(init)); return { m, available: async () => true, set: async (k, v) => { m.set(k, v); }, get: (k) => m.get(k) ?? null, has: (k) => m.has(k), remove: (k) => m.delete(k) }; };
const jsonRes = (j, status = 200, headers = {}) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json', ...headers } });
const answer = (t) => jsonRes({ choices: [{ message: { content: t } }] });
const base = (id) => PROVIDERS.find((p) => p.id === id).base;
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function make(keys, routes, clock = { t: 1e12 }) {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const r = routes[url];
    if (r === 'down') throw new Error('fetch failed');
    if (typeof r === 'function') return r(url, init);
    return r || jsonRes({ error: { message: 'not found' } }, 404);
  };
  return { seen, clock, ai: createFreeAi({ secrets: fakeSecrets(keys), fetchImpl, now: () => clock.t }) };
}

test('no keys: not ready, and says where to add one', async () => {
  const { ai } = make({}, {});
  assert.equal(ai.ready(), false);
  const r = await ai.chat({ prompt: 'hi' });
  assert.equal(r.ok, false);
  assert.match(r.error.message, /Settings › Accounts › Free AI/);
});

test('the first provider with a key answers, its key only goes to its own host', async () => {
  const { ai, seen } = make({ 'free.groq': 'gsk_groq_key_1', 'free.google': 'g_key_12345' }, { [`${base('groq')}/chat/completions`]: answer('hello from groq') });
  const r = await ai.chat({ prompt: 'hi' });
  assert.equal(r.ok, true);
  assert.equal(r.text, 'hello from groq');
  assert.match(r.via, /^Free AI · Groq · llama-3\.3-70b-versatile$/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.headers.authorization, 'Bearer gsk_groq_key_1');
  assert.equal(seen[0].init.redirect, 'manual');
});

test('at its limit (429): the next provider answers, the reply says why, and it rests', async () => {
  const routes = {
    [`${base('cerebras')}/chat/completions`]: () => jsonRes({ error: { message: 'rate limited' } }, 429, { 'retry-after': '30' }),
    [`${base('groq')}/chat/completions`]: answer('groq here'),
  };
  const { ai, seen, clock } = make({ 'free.cerebras': 'csk_key_123', 'free.groq': 'gsk_key_123' }, routes);
  const r = await ai.chat({ prompt: 'hi' });
  assert.equal(r.ok, true);
  assert.equal(r.text, 'groq here');
  assert.match(r.via, /Groq.*Cerebras is at its free limit/);
  assert.equal(ai.status().providers.find((p) => p.id === 'cerebras').resting, true);
  const n = seen.length;
  await ai.chat({ prompt: 'again' });
  assert.ok(!seen.slice(n).some((x) => x.url.startsWith(base('cerebras'))), 'resting provider is skipped');
  clock.t += 31000;
  await ai.chat({ prompt: 'later' });
  assert.ok(seen.slice(n).some((x) => x.url.startsWith(base('cerebras'))), 'tried again after the rest');
});

test('a model that is gone: picks one from the provider\'s own list and remembers it', async () => {
  const routes = {
    [`${base('openrouter')}/chat/completions`]: (_u, init) => (JSON.parse(init.body).model === 'z-ai/glm-4.5-air:free' ? answer('ok') : jsonRes({ error: { message: 'No endpoints found for model' } }, 404)),
    [`${base('openrouter')}/models`]: jsonRes({ data: [{ id: 'openai/gpt-4o' }, { id: 'z-ai/glm-4.5-air:free' }] }),
  };
  const { ai } = make({ 'free.openrouter': 'sk-or-key-123' }, routes);
  const r = await ai.chat({ prompt: 'hi' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.via, /OpenRouter · z-ai\/glm-4\.5-air:free/);
  assert.equal(ai.status().providers.find((p) => p.id === 'openrouter').model, 'z-ai/glm-4.5-air:free', 'only :free models on OpenRouter');
});

test('everyone failing: one plain sentence naming each', async () => {
  const routes = {
    [`${base('groq')}/chat/completions`]: () => jsonRes({ error: { message: 'Invalid API Key' } }, 401),
    [`${base('mistral')}/chat/completions`]: 'down',
  };
  const { ai } = make({ 'free.groq': 'gsk_bad_key_1', 'free.mistral': 'mistral_key_1' }, routes);
  const r = await ai.chat({ prompt: 'hi' });
  assert.equal(r.ok, false);
  assert.match(r.error.message, /None of your free providers answered: Groq didn't accept your key; Mistral couldn't be reached\./);
});

test('keys: checked, saved as free.<provider>, removable; unknown providers refused', async () => {
  const s = fakeSecrets();
  const ai = createFreeAi({ secrets: s, fetchImpl: async () => answer('x') });
  await assert.rejects(ai.setKey('groq', 'short'), /doesn't look like a key/);
  await assert.rejects(ai.setKey('nope', 'a-long-enough-key'), /bad provider/);
  await ai.setKey('groq', 'gsk_long_enough_key');
  assert.equal(s.get('free.groq'), 'gsk_long_enough_key');
  assert.equal(ai.ready(), true);
  ai.removeKey('groq');
  assert.equal(ai.ready(), false);
  assert.ok(!JSON.stringify(ai.status()).includes('gsk_'), 'status never shows a key');
});

test('as a teammate: ready, chat and keys go through teammates.cjs', async () => {
  const s = fakeSecrets();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-free-'));
  try {
    const tm = createTeammates({ secrets: s, file: path.join(dir, 'servers.json'), fetchImpl: async (u) => (u.startsWith(base('google')) ? answer('gemini says hi') : jsonRes({}, 404)) });
    assert.equal(tm.ready('free'), false);
    await tm.setKey('free.google', 'AIza_long_enough_key');
    assert.equal(tm.ready('free'), true);
    const r = await tm.chat('free', { prompt: 'hi' });
    assert.equal(r.ok, true);
    assert.match(r.via, /Google AI Studio · gemini-2\.5-flash/);
    assert.equal(tm.status().ready.free, true);
    assert.equal(tm.status().free.providers.length, PROVIDERS.length);
    tm.removeKey('free.google');
    assert.equal(tm.ready('free'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('wired in everywhere: registry, routing, names, Settings', () => {
  assert.match(read('src/registry.mjs'), /TEAMMATE_IDS = \[[^\]]*'free'/);
  assert.match(read('src/registry.mjs'), /free: \{ name: 'Free AI'[^}]*api: true(?![^}]*unfiltered)/);
  assert.match(read('electron/main.cjs'), /const TEAMMATES = \[[^\]]*'free'/);
  assert.match(read('electron/parity.cjs'), /free: 'Free AI'/);
  assert.match(read('electron/team-check.cjs'), /free: 'Free AI'/);
  const ui = read('src/main.js');
  assert.match(ui, /data-a="mate-key" data-v="free\.\$\{esc\(p\.id\)\}"/);
  assert.match(ui, /FreeLLMAPI \(github\.com\/tashfeenahmed\/freellmapi, MIT\)/);
});

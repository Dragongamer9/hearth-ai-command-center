const test = require('node:test');
const assert = require('node:assert');
const { callProvider, extractText, testProvider } = require('../electron/providers.cjs');

const res = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => { if (body === 'BAD') throw new Error('bad json'); return body; },
});
const base = { model: 'm', prompt: 'hi', apiKey: 'test-key-123' };

test('anthropic success extracts text and sends key in header only', async () => {
  let seen;
  const out = await callProvider({ ...base, provider: 'anthropic', fetchImpl: async (url, init) => { seen = { url, init }; return res(200, { content: [{ type: 'text', text: 'hello' }] }); } });
  assert.deepStrictEqual(out, { ok: true, text: 'hello', model: 'm' });
  assert.equal(seen.init.headers['x-api-key'], 'test-key-123');
  assert.ok(!seen.init.body.includes('test-key-123'));
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
});

test('openai success', async () => {
  const out = await callProvider({ ...base, provider: 'openai', fetchImpl: async () => res(200, { choices: [{ message: { content: 'yo' } }] }) });
  assert.equal(out.text, 'yo');
});

test('auth failure', async () => {
  const out = await callProvider({ ...base, provider: 'openai', fetchImpl: async () => res(401, { error: { message: 'Invalid key' } }) });
  assert.equal(out.error.kind, 'auth');
  assert.match(out.error.message, /Invalid key/);
});

test('rate limit includes retry-after', async () => {
  const out = await callProvider({ ...base, provider: 'anthropic', fetchImpl: async () => res(429, { error: { message: 'slow down' } }, { 'retry-after': '12' }) });
  assert.equal(out.error.kind, 'rate_limit');
  assert.match(out.error.message, /12s/);
});

test('timeout', async () => {
  const out = await callProvider({ ...base, provider: 'openai', timeoutMs: 30, fetchImpl: (_u, init) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); })) });
  assert.equal(out.error.kind, 'timeout');
});

test('offline', async () => {
  const out = await callProvider({ ...base, provider: 'openai', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(out.error.kind, 'network');
});

test('malformed responses are rejected', async () => {
  for (const body of ['BAD', { content: 'nope' }, { choices: [] }, null]) {
    const out = await callProvider({ ...base, provider: 'anthropic', fetchImpl: async () => res(200, body) });
    assert.equal(out.error.kind, 'malformed');
  }
  assert.equal(extractText('openai', { choices: [{ message: { content: 42 } }] }), null);
});

test('missing key and freebuff are refused without a network call', async () => {
  const fetchImpl = async () => { throw new Error('should not be called'); };
  assert.equal((await callProvider({ ...base, apiKey: null, provider: 'openai', fetchImpl })).error.kind, 'no_key');
  assert.equal((await callProvider({ ...base, provider: 'freebuff', fetchImpl })).error.kind, 'unsupported');
});


test('key test sends only Hello for every API provider and hides response text', async () => {
  for (const provider of ['anthropic', 'openai', 'xai', 'mistral', 'perplexity', 'deepseek']) {
    let request;
    const out = await testProvider({ ...base, provider, prompt: 'must not be sent', fetchImpl: async (_url, init) => {
      request = JSON.parse(init.body);
      return res(200, provider === 'anthropic'
        ? { content: [{ type: 'text', text: base.apiKey }] }
        : { choices: [{ message: { content: base.apiKey } }] });
    } });
    assert.deepStrictEqual(request.messages, [{ role: 'user', content: 'Hello' }]);
    assert.equal(request.model, base.model);
    assert.deepStrictEqual(out, { ok: true });
  }
});

test('key test preserves failure category without exposing provider error or key', async () => {
  for (const [status, kind] of [[401, 'auth'], [429, 'rate_limit'], [404, 'not_found'], [500, 'server']]) {
    const out = await testProvider({ ...base, provider: 'mistral', fetchImpl: async () =>
      res(status, { error: { message: base.apiKey } }, { 'retry-after': base.apiKey }) });
    assert.equal(out.ok, false);
    assert.equal(out.error.kind, kind);
    assert.equal(out.error.status, status);
    assert.ok(!JSON.stringify(out).includes(base.apiKey));
  }
});

test('key test without a saved key never contacts provider', async () => {
  let called = false;
  const out = await testProvider({ ...base, provider: 'mistral', apiKey: null,
    fetchImpl: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(out.error.kind, 'no_key');
});

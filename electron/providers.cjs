// Official-API provider adapters. Runs only in the main process; API keys
// never reach the renderer and are never logged.
// Official endpoints only. xAI, Mistral, Perplexity and DeepSeek use the
// OpenAI-style chat-completions shape (messages in, choices[0].message out).
const ENDPOINTS = Object.freeze({
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
  xai: 'https://api.x.ai/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  perplexity: 'https://api.perplexity.ai/v1/sonar',
  deepseek: 'https://api.deepseek.com/chat/completions',
});

const DEFAULT_MODELS = Object.freeze({
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5',
  xai: 'grok-4',
  mistral: 'mistral-large-latest',
  perplexity: 'sonar',
  deepseek: 'deepseek-chat',
});
const OPENAI_STYLE = ['openai', 'xai', 'mistral', 'perplexity', 'deepseek'];

const MAX_RESPONSE_CHARS = 50000;

function fail(kind, message, status) {
  return { ok: false, error: { kind, message, status: status ?? null } };
}

function classifyStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server';
  return 'request';
}

function buildRequest(provider, apiKey, model, prompt) {
  if (provider === 'anthropic') {
    return {
      url: ENDPOINTS.anthropic,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: { model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] },
    };
  }
  if (OPENAI_STYLE.includes(provider)) {
    return {
      url: ENDPOINTS[provider],
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: { model, messages: [{ role: 'user', content: prompt }] },
    };
  }
  throw new Error('provider has no verified API adapter');
}

// Pull plain text out of an untrusted provider response. Returns null if the
// shape is not what the official API documents.
function extractText(provider, json) {
  if (!json || typeof json !== 'object') return null;
  if (provider === 'anthropic') {
    if (!Array.isArray(json.content)) return null;
    const text = json.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
    return text || null;
  }
  if (OPENAI_STYLE.includes(provider)) {
    const msg = json.choices?.[0]?.message?.content;
    if (typeof msg === 'string' && msg) {
      // Perplexity returns its sources separately; keep them with the answer.
      const cites = Array.isArray(json.citations) ? json.citations.filter((c) => typeof c === 'string').slice(0, 10) : [];
      return cites.length ? `${msg}\n\nSources:\n${cites.map((c, i) => `[${i + 1}] ${c}`).join('\n')}` : msg;
    }
    return null;
  }
  return null;
}

function errorMessageFrom(json) {
  const m = json?.error?.message;
  return typeof m === 'string' ? m.slice(0, 300) : null;
}

async function callProvider({ provider, apiKey, model, prompt, timeoutMs = 60000, fetchImpl = fetch }) {
  if (!apiKey) return fail('no_key', 'No API key saved for this provider.');
  let req;
  try {
    req = buildRequest(provider, apiKey, model, prompt);
  } catch (e) {
    return fail('unsupported', e.message);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') return fail('timeout', `No response after ${Math.round(timeoutMs / 1000)}s.`);
    return fail('network', 'Could not reach the provider (offline or blocked).');
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const kind = classifyStatus(res.status);
    const retry = res.headers?.get?.('retry-after');
    const base = errorMessageFrom(json) || `HTTP ${res.status}`;
    return fail(kind, retry && kind === 'rate_limit' ? `${base} (retry after ${retry}s)` : base, res.status);
  }

  const text = extractText(provider, json);
  if (text === null) return fail('malformed', 'Provider returned a response in an unexpected format.', res.status);
  return { ok: true, text: text.slice(0, MAX_RESPONSE_CHARS), model };
}

// "Test" on the Agents page: one tiny prompt with the saved key. Only a category
// comes back, never the provider's text (an error body could echo the key).
const TEST_MESSAGES = {
  no_key: 'Save an API key first.',
  auth: 'The provider rejected this key or denied access.',
  rate_limit: 'The key works, but the provider reports a usage or rate limit.',
  not_found: 'The selected model or endpoint was not found.',
  server: 'The provider is having problems right now.',
  network: 'Could not reach the provider (offline or blocked).',
  timeout: 'The test timed out.',
};
async function testKey(options) {
  const r = await callProvider({ ...options, prompt: 'Hi' });
  if (r.ok) return { ok: true };
  return { ok: false, error: { kind: r.error.kind, status: r.error.status ?? null, message: TEST_MESSAGES[r.error.kind] || 'The provider could not complete the test.' } };
}

module.exports = { testKey, callProvider, extractText, classifyStatus, DEFAULT_MODELS, ENDPOINTS };

// Official-API provider adapters. Runs only in the main process; API keys
// never reach the renderer and are never logged.
const ENDPOINTS = Object.freeze({
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
});

const DEFAULT_MODELS = Object.freeze({
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5',
});

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
  if (provider === 'openai') {
    return {
      url: ENDPOINTS.openai,
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
  if (provider === 'openai') {
    const msg = json.choices?.[0]?.message?.content;
    return typeof msg === 'string' && msg ? msg : null;
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

module.exports = { callProvider, extractText, classifyStatus, DEFAULT_MODELS, ENDPOINTS };

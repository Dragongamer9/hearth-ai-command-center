// Free AI: one teammate on the free tiers of several AI providers, with the owner's own keys.
// The provider list and the idea (one endpoint, fall back to the next provider when one is at
// its limit) follow FreeLLMAPI (github.com/tashfeenahmed/freellmapi, MIT); this is the
// Command Center's own small version: nothing runs as a server, keys stay in the encrypted
// secret store (secrets.cjs) as free.<provider>, and each key only ever goes to its own host.
// Every provider here speaks OpenAI-compatible chat (POST <base>/chat/completions).
// Stay inside each provider's terms: one account each, your own use only.
const hnet = require('./hearth-net.cjs');

const MODEL_RE = /^[A-Za-z0-9._:\-/]{1,100}$/;
// order = the order they are tried in. prefer = the models used first when the provider has
// them (its own /models list picks another when these are gone).
const PROVIDERS = [
  { id: 'cerebras', name: 'Cerebras', base: 'https://api.cerebras.ai/v1', keys: 'https://cloud.cerebras.ai/', prefer: ['gpt-oss-120b', 'qwen-3-235b-a22b-instruct-2507', 'llama-3.3-70b', 'llama3.1-8b'] },
  { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', keys: 'https://console.groq.com/keys', prefer: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'qwen/qwen3-32b', 'llama-3.1-8b-instant'] },
  { id: 'google', name: 'Google AI Studio', base: 'https://generativelanguage.googleapis.com/v1beta/openai', keys: 'https://aistudio.google.com/apikey', prefer: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'] },
  { id: 'mistral', name: 'Mistral', base: 'https://api.mistral.ai/v1', keys: 'https://console.mistral.ai/api-keys', prefer: ['mistral-small-latest', 'mistral-medium-latest', 'open-mistral-nemo'] },
  { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', keys: 'https://openrouter.ai/keys', prefer: ['meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-chat-v3-0324:free', 'qwen/qwen3-235b-a22b:free'], freeOnly: true },
];
const IDS = PROVIDERS.map((p) => p.id);
const byId = (id) => PROVIDERS.find((p) => p.id === id) || null;
const keyName = (id) => `free.${id}`;

function createFreeAi({ secrets, fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
  const models = new Map(); // provider -> the model that works (found from its /models list)
  const resting = new Map(); // provider -> time it can be tried again (after a 429)
  const hostAllow = (p) => { const h = hnet.hostOf(p.base); return (host) => host === h; };
  const withKey = () => PROVIDERS.filter((p) => secrets.has(keyName(p.id)));
  const ready = () => withKey().length > 0;

  async function listModels(p, signal) {
    const r = await hnet.fetchJson(`${p.base}/models`, { allow: hostAllow(p), fetchImpl, name: p.name, signal, timeoutMs: 15000, max: 4 * 1024 * 1024, init: { headers: { accept: 'application/json', authorization: `Bearer ${secrets.get(keyName(p.id))}` } } });
    if (!r.ok) return r;
    const ids = (Array.isArray(r.json?.data) ? r.json.data : Array.isArray(r.json?.models) ? r.json.models : [])
      .map((m) => String(m?.id || m?.name || '').replace(/^models\//, ''))
      .filter((m) => MODEL_RE.test(m) && (!p.freeOnly || m.endsWith(':free')));
    return { ok: true, models: [...new Set(ids)] };
  }
  // The preferred model it still has; else the first one it lists (chat models first).
  function pick(p, list) {
    const hit = p.prefer.find((m) => list.includes(m));
    if (hit) return hit;
    return list.find((m) => !/embed|whisper|tts|guard|moderation|vision-only|image/i.test(m)) || list[0] || null;
  }

  async function ask(p, model, prompt, signal) {
    let res;
    try {
      res = await fetchImpl(`${p.base}/chat/completions`, { method: 'POST', redirect: 'manual', signal: signal || AbortSignal.timeout(120000), headers: { 'content-type': 'application/json', authorization: `Bearer ${secrets.get(keyName(p.id))}` }, body: JSON.stringify({ model, messages: [{ role: 'user', content: String(prompt || '') }] }) });
    } catch (e) {
      if (signal?.aborted) return { stop: true, why: 'Stopped.' };
      return { why: `${p.name} couldn't be reached`, kind: 'outage' };
    }
    let j = null;
    try { j = await res.json(); } catch { /* not JSON */ }
    if (res.ok) {
      const text = j?.choices?.[0]?.message?.content;
      if (typeof text === 'string' && text.trim()) return { ok: true, text };
      return { why: `${p.name} answered with nothing`, kind: 'failed' };
    }
    const msg = String(j?.error?.message || j?.error || j?.message || `HTTP ${res.status}`).slice(0, 200);
    if (res.status === 429) {
      const after = Number(res.headers?.get?.('retry-after'));
      resting.set(p.id, now() + (Number.isFinite(after) && after > 0 ? Math.min(after, 3600) : 60) * 1000);
      return { why: `${p.name} is at its free limit`, kind: 'limit' };
    }
    if (res.status === 401 || res.status === 403) return { why: `${p.name} didn't accept your key`, kind: 'auth' };
    if (res.status === 404 || (res.status === 400 && /model/i.test(msg))) return { why: `${p.name}: ${msg}`, kind: 'model' };
    return { why: `${p.name}: ${msg}`, kind: res.status >= 500 ? 'outage' : 'failed' };
  }

  // Try each provider that has a key, in order, skipping ones resting after a 429. A provider
  // whose model is gone gets one more try with a model from its own list.
  async function chat({ prompt, signal } = {}) {
    const list = withKey();
    if (!list.length) return { ok: false, error: { kind: 'auth', message: 'Add a free key for at least one provider in Settings › Accounts › Free AI.' } };
    const skipped = [];
    for (const p of list) {
      if ((resting.get(p.id) || 0) > now()) { skipped.push(`${p.name} is resting after hitting its free limit`); continue; }
      let model = models.get(p.id) || p.prefer[0];
      let r = await ask(p, model, prompt, signal);
      if (r.stop) return { ok: false, error: { kind: 'cancelled', message: 'Stopped.' } };
      if (r.kind === 'model') {
        const l = await listModels(p, signal);
        const m = l.ok ? pick(p, l.models) : null;
        if (m && m !== model) { model = m; r = await ask(p, model, prompt, signal); if (r.stop) return { ok: false, error: { kind: 'cancelled', message: 'Stopped.' } }; }
      }
      if (r.ok) {
        models.set(p.id, model);
        return { ok: true, text: r.text.slice(0, 50000), via: `Free AI · ${p.name} · ${model}${skipped.length ? ` (${skipped.join('; ')})` : ''}` };
      }
      skipped.push(r.why);
    }
    const allLimit = skipped.every((w) => /limit|resting/.test(w));
    return { ok: false, error: { kind: allLimit ? 'limit' : 'failed', message: `None of your free providers answered: ${skipped.join('; ')}.`.slice(0, 500) } };
  }

  async function setKey(id, key) {
    if (!byId(id)) throw new Error('bad provider');
    const k = String(key || '').trim();
    if (k.length < 8 || k.length > 600 || /\s/.test(k)) throw new Error('That doesn\'t look like a key.');
    if (!(await secrets.available())) throw new Error('This PC has no keyring for encrypted secrets, so the key was not saved.');
    await secrets.set(keyName(id), k);
    models.delete(id); resting.delete(id);
    return { ok: true };
  }
  function removeKey(id) { if (!byId(id)) throw new Error('bad provider'); secrets.remove(keyName(id)); models.delete(id); resting.delete(id); return { ok: true }; }
  function status() {
    return { ready: ready(), providers: PROVIDERS.map((p) => ({ id: p.id, name: p.name, keys: p.keys, key: secrets.has(keyName(p.id)), model: models.get(p.id) || null, resting: (resting.get(p.id) || 0) > now() })) };
  }
  return { ready, chat, setKey, removeKey, status };
}

module.exports = { createFreeAi, PROVIDERS, IDS };

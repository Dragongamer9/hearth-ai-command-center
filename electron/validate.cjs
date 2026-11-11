// Input validation for everything that crosses the IPC boundary.
const more = require('./more-ais.cjs');
// 3.3: plus the new AIs (electron/more-ais.cjs).
const PROVIDERS = Object.freeze(['anthropic', 'openai', 'google', 'xai', 'mistral', 'qwen', 'perplexity', 'deepseek', 'ollama', 'freebuff', ...more.TEAM]);
// Providers with an official API-key connection.
const LIVE_PROVIDERS = Object.freeze(['anthropic', 'openai', 'xai', 'mistral', 'perplexity', 'deepseek', ...more.KEYED]);
const MAX_STATE_BYTES = 5 * 1024 * 1024;
const MAX_PROMPT_CHARS = 60000;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validateState(state) {
  if (!isPlainObject(state)) throw new Error('state must be an object');
  if (!Array.isArray(state.tasks) || !Array.isArray(state.audit)) {
    throw new Error('state.tasks and state.audit must be arrays');
  }
  const size = Buffer.byteLength(JSON.stringify(state), 'utf8');
  if (size > MAX_STATE_BYTES) throw new Error('state too large');
  return state;
}

function validateProvider(id, { liveOnly = false } = {}) {
  const list = liveOnly ? LIVE_PROVIDERS : PROVIDERS;
  if (typeof id !== 'string' || !list.includes(id)) throw new Error('unknown provider');
  return id;
}

function validateApiKey(key) {
  if (typeof key !== 'string') throw new Error('key must be a string');
  // 3.4.1 fix: a key pasted from a web page can carry a line break, a space or an invisible character in it,
  // or quotes around it; keys never contain those, so they're dropped.
  const k = key.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '').replace(/^["'`]+|["'`]+$/g, '');
  if (k.length < 8 || k.length > 512) throw new Error('That doesn\'t look like a whole key: copy it again from the company\'s page and paste it.');
  return k;
}

function validateModel(model) {
  if (typeof model !== 'string') throw new Error('model must be a string');
  const m = model.trim();
  if (!/^[A-Za-z0-9._:\-/]{1,100}$/.test(m)) throw new Error('model name looks invalid');
  return m;
}

function validatePrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('prompt is empty');
  if (prompt.length > MAX_PROMPT_CHARS) throw new Error('prompt too long');
  return prompt;
}

module.exports = {
  PROVIDERS,
  LIVE_PROVIDERS,
  validateState,
  validateProvider,
  validateApiKey,
  validateModel,
  validatePrompt,
};

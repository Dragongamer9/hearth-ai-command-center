// More teammates, each on only once the owner adds a key or a URL (Settings › Accounts):
// - Venice AI: OpenAI-compatible chat at https://api.venice.ai/api/v1 (Bearer key), default
//   model venice-uncensored-1-2; pictures through its own POST /image/generate with
//   safe_mode: false (Venice's default true blurs adult pictures).
// - Civitai: POST https://orchestration.civitai.com/v2/consumer/recipes/imageGen with
//   allowMatureContent=true (Bearer token, billed in Buzz). The engine and its fields come
//   from the owner's settings: Civitai's per-engine fields aren't listed in the docs page
//   this was built from, so nothing beyond engine/outputFormat is guessed.
// - The owner's own GPU server(s) (RunPod or any rented or local GPU): an OpenAI-compatible
//   chat URL, or a ComfyUI image API (POST /prompt, poll /history/<id>, fetch /view).
// Keys live only in the encrypted secret store (electron/secrets.cjs). A server only ever
// gets its own key: never another account's.
// Errors and refusals come back as plain sentences; nothing here hides them.
const crypto = require('node:crypto');
const { createJsonFile } = require('./jsonfile.cjs');

const VENICE = 'https://api.venice.ai/api/v1';
const CIVITAI = 'https://orchestration.civitai.com/v2/consumer/recipes/imageGen';
const IDS = ['venice', 'civitai', 'gpu'];
const VENICE_MODELS = ['venice-uncensored-1-2', 'venice-uncensored', 'llama-3.3-70b', 'qwen3-235b', 'mistral-31-24b'];
const VENICE_IMAGE_MODELS = ['lustify-sdxl', 'lustify-v7', 'lustify-v8', 'flux-dev-uncensored', 'hidream'];
const CIVITAI_ENGINES = ['sdcpp', 'comfy', 'flux2', 'qwen'];
const MODEL_RE = /^[A-Za-z0-9._:\-/]{1,100}$/;
const NAME = { venice: 'Venice', civitai: 'Civitai', gpu: 'your GPU server' };

const fail = (message, kind = 'failed', status = null) => ({ ok: false, error: { kind, message: String(message || 'Something went wrong.').slice(0, 500), status } });
async function json(res) { try { return await res.json(); } catch { return null; } }
const msgOf = (j, res) => String(j?.error?.message || j?.error || j?.detail || j?.message || j?.title || `HTTP ${res.status}`).slice(0, 400);

// A default ComfyUI text-to-image workflow (the stock SDXL graph). {prompt}, {negative},
// {seed} and {ckpt} are filled in; the owner can paste his own workflow instead.
const DEFAULT_WORKFLOW = {
  3: { class_type: 'KSampler', inputs: { seed: '{seed}', steps: 25, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
  4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '{ckpt}' } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}', clip: ['4', 1] } },
  7: { class_type: 'CLIPTextEncode', inputs: { text: '{negative}', clip: ['4', 1] } },
  8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  9: { class_type: 'SaveImage', inputs: { filename_prefix: 'hearth', images: ['8', 0] } },
};

// Fill placeholders in a workflow (strings only; numbers stay numbers where the whole value is a placeholder).
function fillWorkflow(wf, vars) {
  const walk = (v) => {
    if (typeof v === 'string') {
      const whole = v.match(/^\{(seed)\}$/);
      if (whole) return Number(vars.seed);
      return v.replace(/\{(prompt|negative|seed|ckpt)\}/g, (_m, k) => String(vars[k] ?? ''));
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(wf);
}

function cleanUrl(u) {
  let x;
  try { x = new URL(String(u || '').trim()); } catch { return null; }
  if (!['https:', 'http:'].includes(x.protocol) || x.username || x.password) return null;
  return x.href.replace(/\/+$/, '');
}

function createTeammates({ secrets, file, settings = () => ({}), fetchImpl = (...a) => fetch(...a), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxPolls = 120 }) {
  const servers = createJsonFile(file, { empty: () => ({ version: 1, servers: [] }), check: (j) => Array.isArray(j.servers), label: 'Your GPU servers file' });
  const list = () => servers.read().servers.map((s) => ({ ...s, key: secrets.has(`server.${s.id}`) }));
  const chatServer = () => list().find((s) => s.type === 'openai') || null;
  const imageServer = () => list().find((s) => s.type === 'comfy') || null;
  const conf = () => {
    const t = settings().teammates || {};
    return {
      venice: { model: MODEL_RE.test(t.venice?.model || '') ? t.venice.model : VENICE_MODELS[0], imageModel: MODEL_RE.test(t.venice?.imageModel || '') ? t.venice.imageModel : VENICE_IMAGE_MODELS[0] },
      civitai: { engine: CIVITAI_ENGINES.includes(t.civitai?.engine) ? t.civitai.engine : 'sdcpp', fields: typeof t.civitai?.fields === 'string' ? t.civitai.fields : '{"prompt": "{prompt}"}' },
    };
  };

  function ready(agent) {
    if (agent === 'venice') return secrets.has('venice');
    if (agent === 'civitai') return secrets.has('civitai');
    if (agent === 'gpu') return list().length > 0;
    return false;
  }
  const hint = (agent) => (agent === 'gpu' ? 'Add your GPU server in Settings › Accounts' : `Add your ${NAME[agent]} key in Settings › Accounts`);
  // Pictures only (no chat): Civitai, or a GPU server set up only as ComfyUI.
  const imagesOnly = (agent) => agent === 'civitai' || (agent === 'gpu' && !chatServer() && Boolean(imageServer()));

  async function chat(agent, { prompt, model, signal } = {}) {
    if (!ready(agent)) return fail(`${hint(agent)}.`, 'auth');
    let url;
    let key;
    let mdl;
    let via;
    if (agent === 'venice') {
      url = `${VENICE}/chat/completions`;
      key = secrets.get('venice');
      mdl = model && MODEL_RE.test(model) ? model : conf().venice.model;
      via = `Venice API · ${mdl}`;
    } else if (agent === 'gpu') {
      const s = chatServer();
      if (!s) return fail('Your GPU server is set up for pictures only (ComfyUI).', 'unsupported');
      url = `${s.url}/chat/completions`;
      key = secrets.get(`server.${s.id}`);
      mdl = model && MODEL_RE.test(model) ? model : s.model || 'default';
      via = `${s.name} · ${mdl}`;
    } else return fail(`${NAME[agent] || agent} makes pictures only.`, 'unsupported');
    let res;
    try {
      res = await fetchImpl(url, { method: 'POST', signal: signal || AbortSignal.timeout(180000), headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ model: mdl, messages: [{ role: 'user', content: String(prompt || '') }] }) });
    } catch (e) { return fail(e?.name === 'AbortError' ? 'Stopped.' : `Couldn't reach ${agent === 'venice' ? 'Venice' : 'your server'}.`, e?.name === 'AbortError' ? 'cancelled' : 'outage'); }
    const j = await json(res);
    if (!res.ok) return fail(res.status === 422 ? `Venice refused it: ${msgOf(j, res)}` : msgOf(j, res), res.status === 422 ? 'refused' : res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'limit' : 'failed', res.status);
    const text = j?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') return fail('The answer came back in an unexpected format.');
    return { ok: true, text: text.slice(0, 50000), via };
  }

  async function veniceImage(prompt, signal, safe = false) {
    const c = conf().venice;
    let res;
    try {
      res = await fetchImpl(`${VENICE}/image/generate`, { method: 'POST', signal: signal || AbortSignal.timeout(240000), headers: { 'content-type': 'application/json', authorization: `Bearer ${secrets.get('venice')}` }, body: JSON.stringify({ model: c.imageModel, prompt, safe_mode: safe === true, format: 'png', width: 1024, height: 1024, return_binary: false }) });
    } catch { return fail('Couldn\'t reach Venice.', 'outage'); }
    const j = await json(res);
    if (!res.ok) return fail(res.status === 422 ? `Venice refused it: ${msgOf(j, res)}` : msgOf(j, res), res.status === 422 ? 'refused' : res.status === 401 ? 'auth' : 'failed', res.status);
    const imgs = (Array.isArray(j?.images) ? j.images : []).map((x) => (typeof x === 'string' ? x : x?.b64_json || x?.data)).filter((x) => typeof x === 'string');
    if (!imgs.length) return fail('Venice answered without a picture.');
    return { ok: true, images: imgs.slice(0, 4).map((b) => ({ buf: Buffer.from(b.replace(/^data:image\/\w+;base64,/, ''), 'base64'), mime: 'image/png' })), via: `Venice · ${c.imageModel}` };
  }

  async function civitaiImage(prompt, signal, safe = false) {
    const c = conf().civitai;
    let fields = {};
    try { fields = JSON.parse(c.fields.replace(/\{prompt\}/g, JSON.stringify(String(prompt)).slice(1, -1))); } catch { return fail('Your Civitai request fields (Settings › Accounts) aren\'t valid JSON.'); }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) fields = {};
    // The owner wants mature content allowed; a roleplay card that reads as under 18 (or a real
    // person) always goes with it off (electron/cards.cjs hard limits).
    const url = `${CIVITAI}?allowMatureContent=${safe === true ? 'false' : 'true'}`;
    let res;
    try {
      res = await fetchImpl(url, { method: 'POST', signal: signal || AbortSignal.timeout(300000), headers: { 'content-type': 'application/json', authorization: `Bearer ${secrets.get('civitai')}` }, body: JSON.stringify({ ...fields, engine: c.engine, outputFormat: 'png' }) });
    } catch { return fail('Couldn\'t reach Civitai.', 'outage'); }
    const j = await json(res);
    if (!res.ok) return fail(`Civitai: ${j?.detail || j?.title || `HTTP ${res.status}`}`, res.status === 401 || res.status === 403 ? 'auth' : 'failed', res.status);
    const errs = Array.isArray(j?.errors) ? j.errors.filter((e) => typeof e === 'string') : [];
    const blobs = Array.isArray(j?.images) ? j.images : [];
    const out = [];
    for (const b of blobs.slice(0, 4)) {
      const link = typeof b?.url === 'string' && /^https:\/\//.test(b.url) ? b.url : null;
      if (!link) continue;
      try {
        // The picture's own link: fetched without the owner's token.
        const r = await fetchImpl(link, { signal: AbortSignal.timeout(120000) });
        const type = String(r.headers?.get?.('content-type') || 'image/png').split(';')[0];
        if (r.ok && /^image\//.test(type)) out.push({ buf: Buffer.from(await r.arrayBuffer()), mime: type });
      } catch {}
    }
    if (!out.length) return fail(errs.length ? `Civitai: ${errs.join(' ')}` : blobs.length ? 'Civitai made the picture but sent no download link yet (it may still be generating; look in your Civitai account).' : 'Civitai answered without a picture.');
    return { ok: true, images: out, via: `Civitai · ${c.engine}`, notes: errs };
  }

  async function comfyImage(prompt, signal) {
    const s = imageServer();
    if (!s) return fail('Your GPU server has no ComfyUI entry.', 'unsupported');
    const key = secrets.get(`server.${s.id}`);
    const headers = { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) };
    let wf = DEFAULT_WORKFLOW;
    if (s.workflow) { try { wf = JSON.parse(s.workflow); } catch { return fail('Your ComfyUI workflow isn\'t valid JSON.'); } }
    const graph = fillWorkflow(wf, { prompt, negative: 'blurry, low quality', seed: crypto.randomInt(1, 2 ** 31), ckpt: s.model || 'sd_xl_base_1.0.safetensors' });
    let res;
    try { res = await fetchImpl(`${s.url}/prompt`, { method: 'POST', signal: signal || AbortSignal.timeout(60000), headers, body: JSON.stringify({ prompt: graph, client_id: `hearth-${crypto.randomBytes(4).toString('hex')}` }) }); } catch { return fail(`Couldn't reach ${s.name}.`, 'outage'); }
    const j = await json(res);
    if (!res.ok || !j?.prompt_id) return fail(`${s.name}: ${j?.error?.message || j?.error || msgOf(j, res)}`, 'failed', res.status);
    const id = String(j.prompt_id);
    if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) return fail('Unexpected answer from ComfyUI.');
    for (let i = 0; i < maxPolls; i++) {
      if (signal?.aborted) return fail('Stopped.', 'cancelled');
      await sleep(2000);
      let h;
      try { h = await json(await fetchImpl(`${s.url}/history/${id}`, { headers })); } catch { continue; }
      const entry = h?.[id];
      if (!entry) continue;
      if (entry.status?.status_str === 'error') return fail(`${s.name}: the workflow failed.`);
      const imgs = Object.values(entry.outputs || {}).flatMap((o) => (Array.isArray(o?.images) ? o.images : []));
      if (!imgs.length) { if (entry.status?.completed) return fail(`${s.name}: the workflow finished without a picture.`); continue; }
      const out = [];
      for (const im of imgs.slice(0, 4)) {
        const q = new URLSearchParams({ filename: String(im.filename || ''), subfolder: String(im.subfolder || ''), type: String(im.type || 'output') });
        try { const r = await fetchImpl(`${s.url}/view?${q}`, { headers }); if (r.ok) out.push({ buf: Buffer.from(await r.arrayBuffer()), mime: String(r.headers?.get?.('content-type') || 'image/png').split(';')[0] }); } catch {}
      }
      return out.length ? { ok: true, images: out, via: `${s.name} · ComfyUI` } : fail(`${s.name}: couldn't download the picture.`);
    }
    return fail(`${s.name}: no picture after ${Math.round((maxPolls * 2) / 60)} minutes.`);
  }

  async function image(agent, { prompt, signal, safe = false } = {}) {
    if (!ready(agent)) return fail(`${hint(agent)}.`, 'auth');
    const p = String(prompt || '').trim().slice(0, 3000);
    if (!p) return fail('Say what the picture should show.');
    if (agent === 'venice') return veniceImage(p, signal, safe);
    if (agent === 'civitai') return civitaiImage(p, signal, safe);
    if (agent === 'gpu') return comfyImage(p, signal);
    return fail('That teammate can\'t make pictures.', 'unsupported');
  }

  async function addServer(spec = {}) {
    const name = String(spec.name || '').trim().slice(0, 40);
    if (!name) throw new Error('Give the server a name.');
    const type = spec.type === 'comfy' ? 'comfy' : 'openai';
    const url = cleanUrl(spec.url);
    if (!url) throw new Error('Type the server address (https://… or http://… for one on your own network).');
    if (spec.model && !MODEL_RE.test(String(spec.model))) throw new Error('That model name looks wrong.');
    if (spec.workflow) { try { JSON.parse(String(spec.workflow)); } catch { throw new Error('The workflow isn\'t valid JSON.'); } }
    const cur = servers.read().servers;
    if (cur.length >= 6) throw new Error('Six servers at most.');
    const s = { id: crypto.randomBytes(4).toString('hex'), name, type, url, ...(spec.model ? { model: String(spec.model) } : {}), ...(type === 'comfy' && spec.workflow ? { workflow: String(spec.workflow).slice(0, 200000) } : {}), addedAt: new Date().toISOString() };
    const key = String(spec.key || '').trim();
    if (key) {
      if (!(await secrets.available())) throw new Error('This PC has no keyring for encrypted secrets, so the key was not saved.');
      await secrets.set(`server.${s.id}`, key);
    }
    servers.write({ version: 1, servers: [...cur, s] });
    return { ...s, key: Boolean(key) };
  }
  function removeServer(id) {
    const cur = servers.read().servers;
    if (!cur.some((s) => s.id === id)) return { ok: false };
    secrets.remove(`server.${id}`);
    servers.write({ version: 1, servers: cur.filter((s) => s.id !== id) });
    return { ok: true };
  }
  async function setKey(agent, key) {
    if (!['venice', 'civitai'].includes(agent)) throw new Error('bad teammate');
    const k = String(key || '').trim();
    if (k.length < 8 || k.length > 600 || /\s/.test(k)) throw new Error('That doesn\'t look like a key.');
    await secrets.set(agent, k);
    return { ok: true };
  }
  function removeKey(agent) { if (!['venice', 'civitai'].includes(agent)) throw new Error('bad teammate'); secrets.remove(agent); return { ok: true }; }

  function status() {
    const c = conf();
    return { ready: Object.fromEntries(IDS.map((a) => [a, ready(a)])), keys: { venice: secrets.has('venice'), civitai: secrets.has('civitai') }, servers: list().map(({ workflow, ...s }) => ({ ...s, workflow: Boolean(workflow) })), imagesOnly: Object.fromEntries(IDS.map((a) => [a, imagesOnly(a)])), conf: c, models: { venice: VENICE_MODELS, veniceImage: VENICE_IMAGE_MODELS, civitaiEngines: CIVITAI_ENGINES }, broken: servers.broken() };
  }

  return { IDS, ready, hint, imagesOnly, chat, image, addServer, removeServer, setKey, removeKey, status, list };
}

module.exports = { createTeammates, fillWorkflow, DEFAULT_WORKFLOW, VENICE, CIVITAI, IDS, VENICE_MODELS, VENICE_IMAGE_MODELS, CIVITAI_ENGINES };

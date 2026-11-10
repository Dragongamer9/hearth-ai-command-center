// Your GPU servers: the models on each server are picked up automatically, and a saved
// server's model (or address, name, key) can be changed without removing it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTeammates } = require('../electron/teammates.cjs');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-gpu-models-')); made.push(d); return d; };
const fakeSecrets = () => { const m = new Map(); return { m, available: async () => true, set: async (k, v) => { m.set(k, v); }, get: (k) => m.get(k) ?? null, has: (k) => m.has(k), remove: (k) => m.delete(k) }; };
const jsonRes = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function make(routes) {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, init });
    const r = routes[url];
    if (r === 'down') throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    if (typeof r === 'function') return r(url, init);
    return r ? jsonRes(r) : jsonRes({ error: 'not found' }, 404);
  };
  const secrets = fakeSecrets();
  const file = path.join(tmp(), 'servers.json');
  return { seen, secrets, file, tm: createTeammates({ secrets, file, fetchImpl, sleep: async () => {} }) };
}

test('the models come from <url>/models on an OpenAI-compatible server', async () => {
  const { tm } = make({ 'http://192.168.1.20:11434/v1/models': { data: [{ id: 'qwen3:30b-a3b' }, { id: 'huihui_ai/qwen3-abliterated:30b-a3b' }] } });
  const s = await tm.addServer({ name: 'Nvidia PC', url: 'http://192.168.1.20:11434/v1' });
  const r = await tm.listModels({ id: s.id });
  assert.deepEqual(r, { ok: true, models: ['qwen3:30b-a3b', 'huihui_ai/qwen3-abliterated:30b-a3b'] });
});

test('Ollama without /v1/models: falls back to /api/tags', async () => {
  const { tm } = make({ 'http://10.0.0.5:11434/api/tags': { models: [{ name: 'huihui_ai/qwen3-abliterated:30b-a3b' }, { name: 'llama3.2:3b' }] } });
  const r = await tm.listModels({ url: 'http://10.0.0.5:11434/v1' });
  assert.deepEqual(r, { ok: true, models: ['huihui_ai/qwen3-abliterated:30b-a3b', 'llama3.2:3b'] });
});

test('the Add form can list models before saving, with its key sent only to that host', async () => {
  const { tm, seen } = make({ 'https://pod.example.com/v1/models': { data: [{ id: 'm1' }] } });
  const r = await tm.listModels({ url: 'https://pod.example.com/v1', key: 'secret-key-123' });
  assert.equal(r.ok, true);
  assert.equal(seen[0].init.headers.authorization, 'Bearer secret-key-123');
  assert.equal(seen[0].init.redirect, 'manual');
});

test('a server that can\'t be reached says so plainly', async () => {
  const { tm } = make({ 'http://192.168.1.99:11434/v1/models': 'down' });
  const r = await tm.listModels({ url: 'http://192.168.1.99:11434/v1' });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'unreachable');
  assert.match(r.message, /Couldn't reach/);
});

test('editing the model keeps the id, the key and the other servers', async () => {
  const { tm, secrets, file } = make({});
  const a = await tm.addServer({ name: 'Nvidia PC', url: 'http://192.168.1.20:11434/v1', model: 'qwen3:30b-a3b', key: 'k-12345678' });
  const b = await tm.addServer({ name: 'RunPod', url: 'https://pod.example.com/v1' });
  const r = await tm.updateServer(a.id, { model: 'huihui_ai/qwen3-abliterated:30b-a3b' });
  assert.equal(r.id, a.id);
  assert.equal(r.model, 'huihui_ai/qwen3-abliterated:30b-a3b');
  assert.equal(r.key, true);
  assert.equal(secrets.get(`server.${a.id}`), 'k-12345678');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')).servers;
  assert.equal(saved.length, 2);
  assert.equal(saved[0].url, 'http://192.168.1.20:11434/v1');
  assert.equal(saved[0].name, 'Nvidia PC');
  assert.deepEqual(saved[1], JSON.parse(JSON.stringify({ ...b, key: undefined })));
});

test('an empty model means the first one on the server; a new key replaces, Remove key clears', async () => {
  const { tm, secrets } = make({});
  const a = await tm.addServer({ name: 'Nvidia PC', url: 'http://192.168.1.20:11434/v1', model: 'x:1', key: 'k-12345678' });
  assert.equal((await tm.updateServer(a.id, { model: '' })).model, undefined);
  await tm.updateServer(a.id, { key: 'k-new-87654321' });
  assert.equal(secrets.get(`server.${a.id}`), 'k-new-87654321');
  await tm.updateServer(a.id, { key: '' });
  assert.equal(secrets.get(`server.${a.id}`), 'k-new-87654321', 'an empty key keeps the saved one');
  await tm.updateServer(a.id, { removeKey: true });
  assert.equal(secrets.has(`server.${a.id}`), false);
});

test('a bad model name or address is refused and nothing is saved', async () => {
  const { tm, file } = make({});
  const a = await tm.addServer({ name: 'Nvidia PC', url: 'http://192.168.1.20:11434/v1', model: 'qwen3:30b-a3b' });
  const before = fs.readFileSync(file, 'utf8');
  await assert.rejects(tm.updateServer(a.id, { model: 'bad model with spaces' }), /model name/);
  await assert.rejects(tm.updateServer(a.id, { url: 'ftp://x' }), /address/);
  await assert.rejects(tm.updateServer('nope', { model: 'x' }), /isn't saved/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('ComfyUI checkpoint names with spaces are fine; paths out of the folder are not', async () => {
  const { tm } = make({});
  const a = await tm.addServer({ name: 'Pics', type: 'comfy', url: 'http://192.168.1.20:8188', model: 'My Model v2.safetensors' });
  assert.equal(a.model, 'My Model v2.safetensors');
  await assert.rejects(tm.updateServer(a.id, { model: '../../etc/passwd' }), /model name/);
});

test('chat with no model saved uses the first model the server has, not "default"', async () => {
  let body = null;
  const { tm } = make({
    'http://192.168.1.20:11434/v1/models': { data: [{ id: 'huihui_ai/qwen3-abliterated:30b-a3b' }] },
    'http://192.168.1.20:11434/v1/chat/completions': async (_u, init) => { body = JSON.parse(init.body); return jsonRes({ choices: [{ message: { content: 'hi' } }] }); },
  });
  await tm.addServer({ name: 'Nvidia PC', url: 'http://192.168.1.20:11434/v1' });
  const r = await tm.chat('gpu', { prompt: 'hello' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(body.model, 'huihui_ai/qwen3-abliterated:30b-a3b');
  assert.match(r.via, /abliterated/);
});

test('the window: a model dropdown per server, Refresh, and the Add form finds models from the address', () => {
  const ui = read('src/main.js');
  assert.match(ui, /data-a="sv-model-pick"/);
  assert.match(ui, /data-a="server-models"/);
  assert.match(ui, /teammatesUpdateServer/);
  assert.match(ui, /#sv-url, #sv-type'\)\) loadAddModels\(\)/);
  const pre = read('electron/preload.cjs');
  assert.match(pre, /teammatesUpdateServer: \(id, patch\) => ipcRenderer\.invoke\('teammates:updateServer', id, patch\)/);
  assert.match(pre, /teammatesListModels: \(q\) => ipcRenderer\.invoke\('teammates:listModels', q\)/);
  const par = read('electron/parity.cjs');
  assert.match(par, /handle\('teammates:updateServer'/);
  assert.match(par, /handle\('teammates:listModels'/);
});

// Hearth devices (electron/hearth-devices.cjs), the shared ComfyUI client (electron/comfy.cjs) and
// the careful requests under both (electron/hearth-net.cjs): routing order and fallback, skipping
// gaming devices and handhelds on battery, the allow-list, refused redirects, size caps, the
// ComfyUI request flow against a fake ComfyUI server, and settings merged without defaults saved.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const hd = require('../electron/hearth-devices.cjs');
const hnet = require('../electron/hearth-net.cjs');
const comfy = require('../electron/comfy.cjs');
const { diffSettings, applyChanges } = require('../electron/settings-log.cjs');

const fakeSecrets = () => { const m = new Map(); return { m, available: async () => true, set: async (k, v) => { m.set(k, v); }, get: (k) => m.get(k) ?? null, has: (k) => m.has(k), remove: (k) => m.delete(k) }; };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const PC = { device: 'nvidia-pc', os: 'hearth', version: '1.0', gaming: false, busy: false, services: [
  { kind: 'chat', engine: 'ollama', url: 'http://100.72.99.97:11434', models: ['llama3.1:70b', 'qwen2.5:14b'], healthy: true },
  { kind: 'image', engine: 'comfyui', url: 'http://100.72.99.97:8188', models: ['sdxl.safetensors'], healthy: true },
] };
const ALLY = { device: 'rog-ally', os: 'hearth', version: '1.0', gaming: false, busy: false, battery: { percent: 80, charging: true }, services: [
  { kind: 'chat', engine: 'ollama', url: 'http://100.80.1.2:11434', models: ['llama3.2:3b'], healthy: true },
  { kind: 'voice', engine: 'kokoro-fastapi', url: 'http://100.80.1.2:8880', voices: ['af_heart', 'am_adam'], healthy: true },
] };
const LAPTOP = { device: 'laptop', os: 'hearth', version: '1.0', gaming: false, busy: false, battery: { percent: 50, charging: false }, services: [
  { kind: 'stt', engine: 'whisper', url: 'http://laptop.tail1234.ts.net:9000', models: ['base.en'], healthy: true },
] };

// A fake network: the Home server answers the device list; each URL prefix has a handler.
function fakeNet(devices, routes = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    assert.strictEqual(init.redirect === 'manual' || init.redirect === 'error', true, `redirects are never followed (${url})`);
    if (url.endsWith('/v1/hearth/ai/devices')) return json(typeof devices === 'function' ? devices() : devices);
    for (const [prefix, fn] of Object.entries(routes)) if (url.startsWith(prefix)) return fn(url, init);
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  };
  return { calls, fetchImpl };
}
const make = (settings, net, secrets = fakeSecrets()) => hd.createHearthDevices({ settings: () => settings, secrets, fetchImpl: net.fetchImpl, sleep: async () => {}, maxPolls: 3 });
const answer = (text) => json({ choices: [{ message: { content: text } }] });

test('routing: the Nvidia PC first by default, its chosen model; "Answered on nvidia-pc"', async () => {
  const net = fakeNet([ALLY, PC], { 'http://100.72.99.97:11434': (u, i) => { assert.strictEqual(JSON.parse(i.body).model, 'qwen2.5:14b'); return answer('hi from the PC'); } });
  const h = make({ url: 'http://nvidia-pc:8189', models: { 'nvidia-pc': 'qwen2.5:14b' } }, net);
  const r = await h.chat({ prompt: 'hello' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, 'hi from the PC');
  assert.match(r.via, /^Answered on nvidia-pc/);
  assert.ok(net.calls[1].url.endsWith('/v1/chat/completions'), 'Ollama\'s OpenAI-compatible chat');
});

test('routing: falls back down the list on an error or a timeout, and says which device answered', async () => {
  const net = fakeNet([PC, ALLY], {
    'http://100.72.99.97:11434': () => json({ error: 'out of memory' }, 500),
    'http://100.80.1.2:11434': () => answer('hi from the Ally'),
  });
  const r = await make({ url: 'http://nvidia-pc:8189' }, net).chat({ prompt: 'hello' });
  assert.strictEqual(r.ok, true);
  assert.match(r.via, /rog-ally/);
  assert.match(r.tried[0], /nvidia-pc/);
  // A device that takes too long (its request times out): the next one answers.
  const slow = fakeNet([PC, ALLY], {
    'http://100.72.99.97:11434': async (u, i) => { assert.ok(i.signal, 'every request has a timeout'); throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); },
    'http://100.80.1.2:11434': () => answer('ally'),
  });
  const r2 = await make({ url: 'http://nvidia-pc:8189' }, slow).chat({ prompt: 'x' });
  assert.strictEqual(r2.text, 'ally');
  assert.match(r2.tried[0], /took too long/);
  // Every device failing: one plain message naming each.
  const down = fakeNet([PC, ALLY]);
  const r3 = await make({ url: 'http://nvidia-pc:8189' }, down).chat({ prompt: 'x' });
  assert.strictEqual(r3.ok, false);
  assert.match(r3.error.message, /nvidia-pc.*rog-ally/);
});

test('routing: his order wins; gaming devices and handhelds on battery are skipped; busy ones go last', () => {
  const devs = hd.cleanDevices([PC, ALLY, LAPTOP]);
  assert.deepStrictEqual(hd.ordered(devs, []).map((d) => d.device), ['nvidia-pc', 'rog-ally', 'laptop'], 'Nvidia PC first, then the rest as listed');
  assert.deepStrictEqual(hd.ordered(devs, ['rog-ally']).map((d) => d.device)[0], 'rog-ally', 'his saved order first');
  const desk = { device: 'desk', services: [] };
  assert.deepStrictEqual(hd.ordered(hd.cleanDevices([ALLY, desk]), []).map((d) => d.device), ['desk', 'rog-ally'], 'plugged-in machines before handhelds');
  const gaming = hd.cleanDevices([{ ...PC, gaming: true }, ALLY]);
  const p = hd.plan(gaming, 'chat', {});
  assert.deepStrictEqual(p.list.map((x) => x.device.device), ['rog-ally']);
  assert.deepStrictEqual(p.skipped, [{ device: 'nvidia-pc', why: 'gaming' }]);
  assert.deepStrictEqual(hd.plan(gaming, 'chat', { skipGaming: false }).list.map((x) => x.device.device), ['nvidia-pc', 'rog-ally'], 'the switch off: used while gaming');
  const onBattery = hd.cleanDevices([PC, { ...ALLY, battery: { percent: 40, charging: false } }]);
  assert.deepStrictEqual(hd.plan(onBattery, 'voice', {}).list, [], 'the Ally on battery is skipped');
  assert.deepStrictEqual(hd.plan(onBattery, 'voice', {}).skipped, [{ device: 'rog-ally', why: 'on battery' }]);
  assert.strictEqual(hd.plan(onBattery, 'voice', { skipBattery: false }).list.length, 1);
  assert.strictEqual(hd.plan(hd.cleanDevices([PC, ALLY]), 'voice', {}).list.length, 1, 'plugged in: used');
  const busy = hd.cleanDevices([{ ...PC, busy: true }, ALLY]);
  assert.deepStrictEqual(hd.plan(busy, 'chat', {}).list.map((x) => x.device.device), ['rog-ally', 'nvidia-pc'], 'busy: tried last, not dropped');
  const sick = hd.cleanDevices([{ ...PC, services: PC.services.map((s) => ({ ...s, healthy: false })) }, ALLY]);
  assert.deepStrictEqual(hd.plan(sick, 'chat', {}).list.map((x) => x.device.device), ['rog-ally'], 'unhealthy services are skipped');
});

test('a gaming Nvidia PC: chat goes to the Ally without ever calling the PC', async () => {
  const net = fakeNet([{ ...PC, gaming: true }, ALLY], { 'http://100.80.1.2:11434': () => answer('ally') });
  const r = await make({ url: 'http://nvidia-pc:8189' }, net).chat({ prompt: 'x' });
  assert.match(r.via, /rog-ally/);
  assert.ok(!net.calls.some((c) => c.url.includes('100.72.99.97')));
});

test('allow-list: only the Home server\'s host, Tailscale (if allowed) and names he allowed', async () => {
  assert.strictEqual(hnet.isTailscale('100.64.0.1'), true);
  assert.strictEqual(hnet.isTailscale('100.127.255.255'), true);
  assert.strictEqual(hnet.isTailscale('100.128.0.1'), false);
  assert.strictEqual(hnet.isTailscale('100.63.0.1'), false);
  assert.strictEqual(hnet.isTailscale('pc.tail1234.ts.net'), true);
  assert.strictEqual(hnet.isTailscale('ts.net.evil.com'), false);
  const allow = hd.allowFor({ url: 'http://nvidia-pc:8189', allowHosts: ['rog-ally'] });
  for (const h of ['nvidia-pc', '100.72.99.97', 'laptop.tail1234.ts.net', 'rog-ally']) assert.strictEqual(allow(h), true, h);
  for (const h of ['evil.com', '169.254.169.254', '192.168.1.1', 'localhost', 'api.openai.com']) assert.strictEqual(allow(h), false, h);
  assert.strictEqual(hd.allowFor({ url: 'http://nvidia-pc:8189', tailscale: false })('100.72.99.97'), false, 'Tailscale off');
  // A device that points its service somewhere else: never contacted.
  const evil = { ...PC, services: [{ kind: 'chat', engine: 'ollama', url: 'http://evil.example.com:11434', models: ['m'], healthy: true }] };
  const net = fakeNet([evil], { 'http://evil.example.com': () => { throw new Error('must not be called'); } });
  const r = await make({ url: 'http://nvidia-pc:8189' }, net).chat({ prompt: 'x' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error.message, /isn't allowed/);
  assert.ok(!net.calls.some((c) => c.url.includes('evil')));
  // Untrusted fields: unknown engines, bad names, credentials in URLs are dropped.
  const odd = hd.cleanDevices([{ device: '../etc', services: [] }, { device: 'ok', services: [{ kind: 'chat', engine: 'curl', url: 'http://x' }, { kind: 'chat', engine: 'ollama', url: 'http://u:p@100.64.0.1' }, { kind: 'chat', engine: 'ollama', url: 'file:///etc/passwd' }] }]);
  assert.deepStrictEqual(odd.map((d) => d.device), ['ok']);
  assert.deepStrictEqual(odd[0].services, []);
});

test('redirects are refused (the Home server and every service)', async () => {
  const net = { fetchImpl: async (url, init) => { assert.strictEqual(init.redirect, 'manual'); return new Response('', { status: 302, headers: { location: 'http://evil.example.com/' } }); } };
  const r = await make({ url: 'http://nvidia-pc:8189' }, net).discover({ fresh: true });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.kind, 'redirect');
  const net2 = fakeNet([PC], { 'http://100.72.99.97:11434': () => new Response('', { status: 307, headers: { location: 'http://evil.example.com/' } }) });
  const r2 = await make({ url: 'http://nvidia-pc:8189' }, net2).chat({ prompt: 'x' });
  assert.match(r2.error.message, /redirect/);
  const r3 = await hnet.safeFetch('http://100.64.0.1/', { allow: () => true, fetchImpl: async () => ({ type: 'opaqueredirect', status: 0 }) });
  assert.strictEqual(r3.kind, 'redirect');
});

test('size caps: a huge device list or answer is not downloaded', async () => {
  const big = { fetchImpl: async () => new Response('x'.repeat(10), { status: 200, headers: { 'content-length': String(50 * 1024 * 1024) } }) };
  const r = await make({ url: 'http://nvidia-pc:8189' }, big).discover({ fresh: true });
  assert.strictEqual(r.kind, 'too_big');
  // Streamed without a length: stopped past the cap.
  let pulled = 0;
  const stream = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(64 * 1024)); if (pulled > 200) c.close(); } });
  const buf = await hnet.readCapped(new Response(stream), 256 * 1024);
  assert.strictEqual(buf, null);
  assert.ok(pulled < 20, 'the rest is never downloaded');
  // Too many devices: capped at 16.
  assert.strictEqual(hd.cleanDevices(Array.from({ length: 40 }, (_, i) => ({ device: `d${i}`, services: [] }))).length, 16);
});

test('the share code: from the encrypted store only, sent as a header, never in settings', async () => {
  const secrets = fakeSecrets();
  const net = fakeNet([PC], { 'http://100.72.99.97:11434': (u, i) => { assert.strictEqual(i.headers['x-hearth-share-code'], 's3cret'); return answer('ok'); } });
  const h = make({ url: 'http://nvidia-pc:8189' }, net, secrets);
  assert.strictEqual((await h.setShareCode('s3cret')).ok, true);
  assert.strictEqual(secrets.get(hd.SHARE_SECRET), 's3cret');
  assert.strictEqual((await h.chat({ prompt: 'x' })).ok, true);
  assert.strictEqual(net.calls[0].init.headers['x-hearth-share-code'], 's3cret');
  const st = await h.status({});
  assert.strictEqual(st.shareCode, true);
  assert.ok(!JSON.stringify(st).includes('s3cret'), 'the window never gets the code');
  assert.ok(!JSON.stringify(hd.cleanSettings({ shareCode: 's3cret' })).includes('s3cret'), 'not a setting');
  const auth = await make({ url: 'http://nvidia-pc:8189' }, { fetchImpl: async () => json({ error: 'share code' }, 401) }).discover({ fresh: true });
  assert.match(auth.message, /share code/);
});

test('voices: Kokoro on a Hearth device, the next device if it fails; speech to text on whisper', async () => {
  const ally2 = { ...ALLY, device: 'ally-2', services: [{ kind: 'voice', engine: 'kokoro-fastapi', url: 'http://100.80.1.3:8880', voices: ['af_heart'], healthy: true }] };
  const net = fakeNet([ALLY, ally2], {
    'http://100.80.1.2:8880': () => json({ detail: 'busy' }, 503),
    'http://100.80.1.3:8880': (u, i) => { assert.ok(u.endsWith('/v1/audio/speech')); assert.strictEqual(JSON.parse(i.body).voice, 'af_heart'); return new Response(Buffer.alloc(4000, 1), { status: 200, headers: { 'content-type': 'audio/wav' } }); },
    'http://laptop.tail1234.ts.net:9000': (u) => { assert.ok(u.endsWith('/v1/audio/transcriptions')); return json({ text: 'hello there' }); },
  });
  const h = make({ url: 'http://nvidia-pc:8189' }, net);
  const v = await h.voices();
  assert.deepStrictEqual(v.voices.map((x) => x.id), ['af_heart', 'am_adam']);
  const s = await h.speak({ voice: 'af_heart', text: 'Hi.' });
  assert.strictEqual(s.ok, true);
  assert.match(s.via, /ally-2/);
  const net2 = fakeNet([LAPTOP], { 'http://laptop.tail1234.ts.net:9000': () => json({ text: 'hello there' }) });
  const t = await make({ url: 'http://nvidia-pc:8189', skipBattery: false }, net2).transcribe({ buf: Buffer.alloc(2000) });
  assert.strictEqual(t.text, 'hello there');
  const t2 = await make({ url: 'http://nvidia-pc:8189' }, net2).transcribe({ buf: Buffer.alloc(2000) });
  assert.strictEqual(t2.ok, false, 'the laptop on battery is skipped');
  assert.match(t2.message, /laptop \(on battery\)/);
});

test('settings: defaults only when read; his change merges; a bad address saves nothing', () => {
  const d = hd.cleanSettings(undefined);
  assert.deepStrictEqual(d, { url: '', order: [], skipGaming: true, skipBattery: true, tailscale: true, allowHosts: [], models: {}, checkpoints: {} });
  const cur = hd.cleanSettings({ url: 'http://nvidia-pc:8189', models: { 'nvidia-pc': 'qwen2.5:14b' } });
  const next = hd.mergeSettings(cur, { skipGaming: false, models: { 'rog-ally': 'llama3.2:3b' } });
  assert.strictEqual(next.url, 'http://nvidia-pc:8189');
  assert.deepStrictEqual(next.models, { 'nvidia-pc': 'qwen2.5:14b', 'rog-ally': 'llama3.2:3b' }, 'per-device picks merge');
  assert.deepStrictEqual(hd.mergeSettings(next, { models: { 'nvidia-pc': null } }).models, { 'rog-ally': 'llama3.2:3b' });
  assert.strictEqual(hd.mergeSettings(cur, { url: 'nvidia-pc:8189' }).url, 'http://nvidia-pc:8189');
  assert.throws(() => hd.mergeSettings(cur, { url: 'http://user:pw@x:8189' }), /Home server/);
  assert.deepStrictEqual(hd.mergeSettings(cur, { allowHosts: 'rog-ally, LAPTOP bad/host' }).allowHosts, ['rog-ally', 'laptop']);
  // What main.cjs saves: only the leaf he changed, never the defaults.
  const before = { hearthDevices: hd.cleanSettings(undefined) };
  const after = { hearthDevices: hd.mergeSettings(undefined, { url: 'http://nvidia-pc:8189' }) };
  const changes = diffSettings(before, after);
  assert.deepStrictEqual(changes.map((c) => c.key), ['hearthDevices.url']);
  assert.deepStrictEqual(applyChanges({ theme: 'dark' }, changes), { theme: 'dark', hearthDevices: { url: 'http://nvidia-pc:8189' } });
  const c2 = diffSettings({ comfy: comfy.cleanSettings(undefined) }, { comfy: comfy.mergeSettings(undefined, { url: '100.72.99.97:8188' }) });
  assert.deepStrictEqual(c2.map((c) => [c.key, c.to]), [['comfy.url', 'http://100.72.99.97:8188']]);
});

test('ComfyUI server setting: home network or Tailscale only; a new address clears the old model', () => {
  assert.deepStrictEqual(comfy.cleanSettings(undefined), { url: '', checkpoint: '' });
  const s = comfy.mergeSettings({}, { url: 'http://100.72.99.97:8188' });
  assert.strictEqual(s.url, 'http://100.72.99.97:8188');
  const s2 = comfy.mergeSettings(s, { checkpoint: 'sdxl.safetensors' });
  assert.strictEqual(s2.checkpoint, 'sdxl.safetensors');
  assert.strictEqual(comfy.mergeSettings(s2, { url: 'http://192.168.1.20:8188' }).checkpoint, '');
  assert.throws(() => comfy.mergeSettings({}, { url: 'https://comfy.example.com' }), /home network or Tailscale/);
  assert.strictEqual(comfy.cleanSettings({ url: 'https://comfy.example.com' }).url, '', 'a hand-edited internet address is not used');
  assert.strictEqual(comfy.allowOnly('http://100.72.99.97:8188')('100.72.99.97'), true);
  assert.strictEqual(comfy.allowOnly('http://100.72.99.97:8188')('100.72.99.98'), false);
});

// ---------- a fake ComfyUI server (real HTTP) ----------
function fakeComfy({ checkpoints = ['sdxl.safetensors', 'pony.safetensors'], modelsRoute = true, failPrompt = false, redirect = false } = {}) {
  const seen = { prompts: [] };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);
  let polls = 0;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    if (redirect) { res.writeHead(302, { location: 'http://evil.example.com/' }); return res.end(); }
    if (u.pathname === '/models/checkpoints' && modelsRoute) return send(200, checkpoints);
    if (u.pathname === '/object_info/CheckpointLoaderSimple') return send(200, { CheckpointLoaderSimple: { input: { required: { ckpt_name: [checkpoints, {}] } } } });
    if (u.pathname === '/prompt' && req.method === 'POST') {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => { const j = JSON.parse(b); seen.prompts.push(j); if (failPrompt) return send(400, { error: { message: 'Prompt outputs failed validation' } }); send(200, { prompt_id: 'abc-123', number: 1 }); });
      return undefined;
    }
    if (u.pathname === '/history/abc-123') { polls++; return send(200, polls < 2 ? {} : { 'abc-123': { outputs: { 9: { images: [{ filename: 'hearth_00001_.png', subfolder: '', type: 'output' }] } }, status: { completed: true, status_str: 'success' } } }); }
    if (u.pathname === '/view') { seen.view = Object.fromEntries(u.searchParams); return send(200, png, 'image/png'); }
    return send(404, { error: 'not found' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));
}
const allowLocal = (h) => h === '127.0.0.1';
const nodeFetch = (...a) => fetch(...a);

test('ComfyUI flow: checkpoints, POST /prompt with the default txt2img graph, poll /history, GET /view', async () => {
  const f = await fakeComfy();
  try {
    const l = await comfy.listCheckpoints({ base: f.base, allow: allowLocal, fetchImpl: nodeFetch });
    assert.deepStrictEqual(l.checkpoints, ['sdxl.safetensors', 'pony.safetensors']);
    const r = await comfy.generate({ base: f.base, allow: allowLocal, fetchImpl: nodeFetch, checkpoint: 'pony.safetensors', prompt: 'a lighthouse at dusk', negative: 'blurry', seed: 4242, sleep: async () => {}, maxPolls: 5 });
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(r.images[0].mime, 'image/png');
    assert.strictEqual(r.seed, 4242);
    const g = f.seen.prompts[0].prompt;
    assert.strictEqual(g['4'].inputs.ckpt_name, 'pony.safetensors');
    assert.strictEqual(g['6'].inputs.text, 'a lighthouse at dusk');
    assert.strictEqual(g['7'].inputs.text, 'blurry');
    assert.strictEqual(g['3'].inputs.seed, 4242, 'the seed is a number in the KSampler');
    assert.strictEqual(f.seen.view.filename, 'hearth_00001_.png');
    // Older ComfyUI without /models/checkpoints: /object_info is used.
    const f2 = await fakeComfy({ modelsRoute: false });
    try { assert.deepStrictEqual((await comfy.listCheckpoints({ base: f2.base, allow: allowLocal, fetchImpl: nodeFetch })).checkpoints, ['sdxl.safetensors', 'pony.safetensors']); } finally { await f2.close(); }
  } finally { await f.close(); }
});

test('ComfyUI clear errors: offline, no checkpoints, wrong address, refused redirect, not allowed', async () => {
  const off = await comfy.listCheckpoints({ base: 'http://127.0.0.1:9', allow: allowLocal, fetchImpl: nodeFetch });
  assert.strictEqual(off.kind, 'unreachable');
  assert.match(off.message, /Couldn't reach/);
  const empty = await fakeComfy({ checkpoints: [] });
  try {
    const r = await comfy.generate({ base: empty.base, allow: allowLocal, fetchImpl: nodeFetch, prompt: 'x', sleep: async () => {} });
    assert.strictEqual(r.kind, 'no_models');
    assert.match(r.message, /no checkpoint/);
  } finally { await empty.close(); }
  const wrong = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>router</html>'); });
  await new Promise((r) => wrong.listen(0, '127.0.0.1', r));
  try {
    const r = await comfy.listCheckpoints({ base: `http://127.0.0.1:${wrong.address().port}`, allow: allowLocal, fetchImpl: nodeFetch });
    assert.strictEqual(r.kind, 'not_comfy');
    assert.match(r.message, /doesn't look like ComfyUI/);
  } finally { await new Promise((r) => wrong.close(r)); }
  const redir = await fakeComfy({ redirect: true });
  try {
    const r = await comfy.listCheckpoints({ base: redir.base, allow: allowLocal, fetchImpl: nodeFetch });
    assert.strictEqual(r.kind, 'redirect');
    assert.match(r.message, /redirect/);
  } finally { await redir.close(); }
  const blocked = await comfy.listCheckpoints({ base: 'http://comfy.example.com', allow: () => false, fetchImpl: () => { throw new Error('must not be called'); } });
  assert.strictEqual(blocked.kind, 'blocked');
  const bad = await fakeComfy({ failPrompt: true });
  try { const r = await comfy.generate({ base: bad.base, allow: allowLocal, fetchImpl: nodeFetch, prompt: 'x', sleep: async () => {} }); assert.match(r.message, /refused the picture/); } finally { await bad.close(); }
});

test('Hearth devices pictures: ComfyUI on the Nvidia PC with its chosen checkpoint (fake server)', async () => {
  const f = await fakeComfy();
  try {
    const host = new URL(f.base);
    const pc = { ...PC, services: [{ kind: 'image', engine: 'comfyui', url: f.base, models: ['sdxl.safetensors', 'pony.safetensors'], healthy: true }] };
    const net = { fetchImpl: async (url, init) => (url.endsWith('/v1/hearth/ai/devices') ? json([pc]) : fetch(url, init)) };
    const h = make({ url: `http://${host.hostname}:8189`, checkpoints: { 'nvidia-pc': 'pony.safetensors' } }, net);
    const r = await h.image({ prompt: 'a castle', negative: 'child', seed: 7 });
    assert.strictEqual(r.ok, true, r.message);
    assert.match(r.via, /Made on nvidia-pc · ComfyUI · pony\.safetensors/);
    assert.strictEqual(f.seen.prompts[0].prompt['4'].inputs.ckpt_name, 'pony.safetensors');
  } finally { await f.close(); }
});

test('voice chat: provider "hearth" speaks on a device, else the system voice; Automatic speech to text tries a device\'s whisper first', async () => {
  const voiceChat = require('../electron/voice-chat.cjs');
  const handlers = {};
  let speakOk = true;
  let sttOk = true;
  const fakeHearth = {
    configured: () => true,
    status: async () => ({ has: { voice: true, stt: true } }),
    voices: async () => ({ ok: true, voices: [{ id: 'af_heart', name: 'af_heart (Kokoro on rog-ally)' }] }),
    speak: async (o) => (speakOk ? { ok: true, buf: Buffer.alloc(500, 1), mime: 'audio/wav', via: `Kokoro on rog-ally (${o.voice})` } : { ok: false, kind: 'none', message: 'No Hearth device can speak right now' }),
    transcribe: async () => (sttOk ? { ok: true, text: 'hello from whisper', via: 'whisper on laptop' } : { ok: false, message: 'laptop: took too long' }),
  };
  const S = { voice: { tts: 'hearth', stt: 'auto' } };
  voiceChat.register({ handle: (c, f) => { handlers[c] = f; }, secrets: fakeSecrets(), readSettings: () => S, send: () => {}, which: () => null, media: null, mediaRoot: null, dialog: {}, getWindow: () => null, hearth: fakeHearth });
  assert.strictEqual(voiceChat.cleanSettings({ tts: 'hearth' }).tts, 'hearth');
  assert.deepStrictEqual(voiceChat.cleanVoice({ hearth: 'af_heart' }), { hearth: 'af_heart' }, 'a Hearth voice per teammate or character');
  const r = await handlers['voice:speak']({ text: 'Hi there.', voice: 'af_heart', who: 'venice' });
  assert.strictEqual(r.ok, true);
  assert.match(r.via, /rog-ally/, 'an uncensored teammate may be spoken on his own devices');
  speakOk = false;
  const r2 = await handlers['voice:speak']({ text: 'Hi there.', voice: 'af_heart' });
  assert.strictEqual(r2.system, true, 'no device: the system voice on this PC');
  assert.match(r2.notice, /system voice/);
  assert.deepStrictEqual((await handlers['voice:voices']('hearth')).voices.map((v) => v.id), ['af_heart']);
  const t = await handlers['voice:transcribe'](Buffer.alloc(4000), {});
  assert.strictEqual(t.text, 'hello from whisper');
  assert.strictEqual(t.via, 'whisper on laptop');
  sttOk = false;
  const t2 = await handlers['voice:transcribe'](Buffer.alloc(4000), {});
  assert.strictEqual(t2.ok, false, 'then this PC / OpenAI as before (neither is set up here)');
  S.voice.stt = 'local';
  sttOk = true;
  const t3 = await handlers['voice:transcribe'](Buffer.alloc(4000), {});
  assert.notStrictEqual(t3.via, 'whisper on laptop', '"This PC only" never uses a device');
  const st = await handlers['voice:status']();
  assert.deepStrictEqual(st.hearth, { configured: true, voice: true, stt: true, error: null });
});

test('protocol 1 (docs/AI-SHARE.md): the server\'s ranked list, offline and paused devices left out, the openai base, whisper on 9000', async () => {
  const list = {
    protocol: 1, server: 'nvidia-pc', priority: ['nvidia-pc', 'rog-ally', 'laptop', 'den'],
    devices: [
      { rank: 1, device: 'nvidia-pc', online: true, available: false, reason: 'playing', gaming: true, gpu: { vendor: 'nvidia' }, services: [{ kind: 'chat', engine: 'ollama', url: 'http://nvidia-pc.tail4f2a.ts.net:11434', openai: 'http://nvidia-pc.tail4f2a.ts.net:11434/v1', healthy: true, reachable: true, models: ['qwen3:30b-a3b'] }] },
      { rank: 2, device: 'rog-ally', online: true, available: true, pluggedIn: true, battery: { percent: 90, charging: true }, services: [
        { kind: 'chat', engine: 'ollama', url: 'http://rog-ally.tail4f2a.ts.net:11434', openai: 'http://rog-ally.tail4f2a.ts.net:11434/v1', healthy: true, reachable: true, models: ['qwen3:4b'] },
        { kind: 'stt', engine: 'whisper', url: 'http://rog-ally.tail4f2a.ts.net:9000', healthy: true, reachable: true, models: [] },
        { kind: 'voice', engine: 'kokoro-fastapi', url: 'http://rog-ally.tail4f2a.ts.net:8880', healthy: true, reachable: false, voices: ['af_bella'] },
      ] },
      { rank: 3, device: 'laptop', online: false, via: 'seen before', reason: 'offline', services: [{ kind: 'chat', engine: 'ollama', url: 'http://laptop.tail4f2a.ts.net:11434', healthy: true, models: ['x'] }] },
      { rank: 4, device: 'den', online: false, via: 'hearth link', reason: 'offline', services: ['chat'] },
    ],
  };
  const devs = hd.cleanDevices(list);
  assert.deepStrictEqual(devs.map((d) => d.device), ['nvidia-pc', 'rog-ally', 'laptop', 'den']);
  assert.deepStrictEqual(devs[2].services, [], 'an offline device\'s old list is never used');
  assert.deepStrictEqual(hd.ordered(hd.cleanDevices({ devices: [{ ...list.devices[1], rank: 2 }, { ...list.devices[0], rank: 1 }] }), []).map((d) => d.device), ['nvidia-pc', 'rog-ally'], 'the Home server\'s rank is the default order');
  const p = hd.plan(devs, 'chat', { skipGaming: false });
  assert.deepStrictEqual(p.list.map((x) => x.device.device), ['rog-ally'], 'paused (available: false) is skipped even with the gaming switch off');
  assert.deepStrictEqual(p.skipped, [{ device: 'nvidia-pc', why: 'gaming' }]);
  assert.deepStrictEqual(hd.plan(devs, 'voice', {}).list, [], 'a service other devices can\'t reach (reachable: false) is skipped');
  const net = fakeNet(list, {
    'http://rog-ally.tail4f2a.ts.net:11434/v1/chat/completions': () => answer('from the ally'),
    'http://rog-ally.tail4f2a.ts.net:9000/asr': (u, i) => { assert.ok(i.body.get('audio_file')); return json({ text: 'heard on the ally' }); },
  });
  const h = make({ url: 'http://nvidia-pc.tail4f2a.ts.net:8189' }, net);
  assert.strictEqual((await h.chat({ prompt: 'x' })).text, 'from the ally');
  assert.ok(net.calls.some((c) => c.url === 'http://rog-ally.tail4f2a.ts.net:11434/v1/chat/completions'), 'the openai base, without doubling /v1');
  assert.strictEqual((await h.transcribe({ buf: Buffer.alloc(3000) })).text, 'heard on the ally', 'whisper-asr-webservice on 9000: POST /asr');
});

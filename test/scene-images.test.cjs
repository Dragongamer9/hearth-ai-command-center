// Characters chat scene pictures (electron/scene.cjs, rp:scene in electron/parity.cjs, the
// character's saved look in electron/cards.cjs): the prompt, every hard-limit refusal, the
// negative prompt, the look and seed, pictures saved with the chat, and the ComfyUI request flow
// against a fake ComfyUI server. Plus the regression for "Your GPU server has no ComfyUI entry".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const scene = require('../electron/scene.cjs');
const cardsLib = require('../electron/cards.cjs');
const parity = require('../electron/parity.cjs');
const attachments = require('../electron/attachments.cjs');
const media = require('../electron/media.cjs');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-scene-')); made.push(d); return d; };
const fakeSecrets = () => { const m = new Map(); return { m, available: async () => true, set: async (k, v) => { m.set(k, v); }, get: (k) => m.get(k) ?? null, has: (k) => m.has(k), remove: (k) => m.delete(k) }; };

const adult = { name: 'Aria', description: 'Aria is a 29 year old ranger with long red hair and green eyes. She loves the forest.', tags: ['fantasy'] };
const ageless = { name: 'Bryn', description: 'A ranger with short black hair.', tags: [] };
const softMinor = { name: 'Cale', description: 'Cale teaches at a middle school. Tall, with grey hair.', tags: [] };
const hardMinor = { name: 'Dot', description: 'A 15 year old apprentice.', tags: [], extensions: { age: 15 } };
const real = { name: 'Famous', description: 'An actor.', tags: ['real person'] };

test('the prompt: each character\'s look, then what is happening, from the last messages (built locally)', () => {
  const msgs = [
    { who: 'owner', text: 'We set up camp.' },
    { who: 'gpu', text: '*Aria lights a campfire under the pines* "Stay close tonight."' },
    { who: 'system', text: 'App note' },
    { who: 'owner', text: '*I sit by the fire*' },
  ];
  const p = scene.buildScenePrompt({ cards: [{ ...adult, ownerLook: { appearance: 'red braid, green cloak, freckles' } }], messages: msgs, persona: { name: 'Rook' } });
  assert.match(p, /^Aria: red braid, green cloak, freckles\./, 'the saved appearance first');
  assert.match(p, /Scene: .*lights a campfire under the pines.*sit by the fire/);
  assert.doesNotMatch(p, /App note/);
  const p2 = scene.buildScenePrompt({ cards: [adult], messages: [] });
  assert.match(p2, /Aria: Aria is a 29 year old ranger with long red hair and green eyes\./, 'no saved look: the start of the description');
  assert.ok(scene.buildScenePrompt({ cards: [adult], messages: Array.from({ length: 50 }, (_, i) => ({ who: 'owner', text: `*step ${i}*` })) }).length <= 2500);
});

test('hard limits: every refusal (real people, minors hard and soft, unclear age, the prompt itself)', () => {
  const sexual = 'Aria undressing by the fire, nude';
  // Real people: a card marked real, or a prompt asking for a real person's likeness.
  assert.strictEqual(scene.checkScene({ cards: [real], prompt: 'a portrait in a park' }).kind, 'real');
  assert.strictEqual(scene.checkScene({ cards: [adult], prompt: 'Aria with a celebrity at the fire' }).kind, 'real');
  assert.strictEqual(scene.checkScene({ cards: [adult], prompt: 'Aria, in the likeness of a famous actress' }).kind, 'real');
  assert.strictEqual(scene.checkScene({ cards: [adult], prompt: 'a deepfake of my neighbour' }).kind, 'real');
  // Sexual scenes: refused for a hard minor (never overridable), a soft flag, an unclear age.
  assert.strictEqual(scene.checkScene({ cards: [hardMinor], prompt: sexual }).kind, 'minor');
  const hardConfirmed = { ...hardMinor, ownerAdult: { age: 30 } };
  assert.strictEqual(scene.checkScene({ cards: [hardConfirmed], prompt: sexual }).kind, 'minor', 'an owner confirmation never clears a hard flag');
  assert.strictEqual(scene.checkScene({ cards: [softMinor], prompt: sexual }).kind, 'minor');
  assert.strictEqual(scene.checkScene({ cards: [ageless], prompt: sexual }).kind, 'age', 'no clear adult age');
  assert.strictEqual(scene.checkScene({ cards: [], prompt: sexual }).kind, 'age', 'no characters: ages unknown');
  assert.strictEqual(scene.checkScene({ cards: [adult, ageless], prompt: sexual }).kind, 'age', 'every character must be clearly adult');
  // The prompt itself mentioning minors or a young age.
  assert.strictEqual(scene.checkScene({ cards: [adult], prompt: 'nude teen by the fire' }).kind, 'minor');
  assert.strictEqual(scene.checkScene({ cards: [adult], prompt: 'naked, she is 16 years old' }).kind, 'minor');
  // Allowed: an owner-confirmed adult (soft flag only), a clearly adult card, non-sexual scenes.
  assert.strictEqual(scene.checkScene({ cards: [{ ...softMinor, ownerAdult: { age: 45 } }], prompt: 'Cale, nude, by the fire' }).ok, true);
  assert.strictEqual(scene.checkScene({ cards: [adult], prompt: sexual }).ok, true);
  assert.strictEqual(scene.checkScene({ cards: [{ ...ageless, extensions: { age: 31 } }], prompt: sexual }).ok, true, 'an age field of 18+ is clear');
  assert.strictEqual(scene.checkScene({ cards: [hardMinor], prompt: 'Dot reading a map in the library' }).ok, true, 'non-sexual stories are fine');
  assert.strictEqual(scene.checkScene({ cards: [adult], prompt: '' }).ok, false);
});

test('the negative prompt keeps minors out; with a minor character, nudity and sexual content too', () => {
  const a = scene.checkScene({ cards: [adult], prompt: 'Aria at the fire' });
  for (const w of ['child', 'underage', 'teen', 'loli', 'childlike']) assert.ok(a.negative.includes(w), w);
  assert.strictEqual(a.safe, false);
  const m = scene.checkScene({ cards: [hardMinor], prompt: 'Dot reading a map' });
  for (const w of ['nsfw', 'nude', 'sexual']) assert.ok(m.negative.includes(w), w);
  assert.strictEqual(m.safe, true);
});

test('clearlyAdult: age field, owner confirmation, stated adult age; never with a minor flag', () => {
  assert.strictEqual(cardsLib.clearlyAdult(adult), true);
  assert.strictEqual(cardsLib.clearlyAdult(ageless), false);
  assert.strictEqual(cardsLib.clearlyAdult({ ...ageless, extensions: { age: 17 } }), false);
  assert.strictEqual(cardsLib.clearlyAdult({ ...ageless, ownerLook: { appearance: 'a 40 year old ranger' } }), true, 'the saved appearance counts');
  assert.strictEqual(cardsLib.clearlyAdult({ ...softMinor, ownerAdult: { age: 40 } }), true);
  assert.strictEqual(cardsLib.clearlyAdult({ name: 'X', description: 'An adult elf. 16 years old.' }), false);
});

// ---------- the main process: parity with a fake ComfyUI ----------
function fakeComfy({ checkpoints = ['sdxl.safetensors'] } = {}) {
  const seen = { prompts: [] };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 3)]);
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    if (u.pathname === '/models/checkpoints') return send(200, checkpoints);
    if (u.pathname === '/object_info/CheckpointLoaderSimple') return send(200, { CheckpointLoaderSimple: { input: { required: { ckpt_name: [checkpoints] } } } });
    if (u.pathname === '/prompt') { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { seen.prompts.push(JSON.parse(b)); send(200, { prompt_id: 'p-1' }); }); return undefined; }
    if (u.pathname === '/history/p-1') return send(200, { 'p-1': { outputs: { 9: { images: [{ filename: 'hearth_1.png', subfolder: '', type: 'output' }] } }, status: { completed: true } } });
    if (u.pathname === '/view') return send(200, png, 'image/png');
    return send(404, {});
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ seen, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((c) => server.close(c)) })));
}
function setup(settings = {}) {
  const d = tmp();
  const handlers = {};
  const S = { tools: { web: true }, team: null, comfy: { url: '', checkpoint: '' }, hearthDevices: {}, ...settings };
  const secrets = fakeSecrets();
  const p = parity.register({
    handle: (ch, fn) => { handlers[ch] = fn; }, dataDir: () => d, readSettings: () => S, chats: { search: () => [], entry: () => null }, secrets, shell: {}, dialog: {}, send: () => {}, protocol: null, attachments, worktreeRoot: () => d, BrowserWindow: null, getWindow: () => null,
    v2: () => ({ entryOf: (id) => ({ id }) }), sleep: async () => {},
  });
  return { d, handlers, p, S, secrets, root: media.mediaRoot(d) };
}

test('rp:scene: his ComfyUI server, the default model, the character\'s seed; the picture is saved with the chat', async () => {
  const f = await fakeComfy({ checkpoints: ['sdxl.safetensors', 'pony.safetensors'] });
  const x = setup({ comfy: { url: f.base, checkpoint: 'pony.safetensors' } });
  try {
    const card = x.p.cards.save(adult);
    x.p.cards.setLook(card.id, { appearance: 'red braid, green cloak', seed: 777 });
    const sources = x.handlers['rp:sceneSources']();
    assert.deepStrictEqual(sources.map((s) => s.id), ['comfy']);
    const pr = x.handlers['rp:scenePrompt']([card.id], [{ who: 'owner', text: '*we reach the river*' }]);
    assert.match(pr.prompt, /red braid, green cloak.*river/);
    const chatId = 'c0ffee12345';
    const r = await x.handlers['rp:scene'](chatId, { cardIds: [card.id], prompt: `${pr.prompt} (edited by him)`, source: 'comfy' });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.seed, 777, 'the saved seed (keep the same seed is on by default)');
    const g = f.seen.prompts[0].prompt;
    assert.strictEqual(g['4'].inputs.ckpt_name, 'pony.safetensors', 'his default model');
    assert.match(g['6'].inputs.text, /\(edited by him\)$/, 'the prompt he edited is the one sent');
    assert.match(g['7'].inputs.text, /underage/, 'minor safety terms in the negative prompt');
    assert.strictEqual(r.items.length, 1);
    const file = path.join(x.root, chatId, r.items[0].file);
    assert.ok(fs.existsSync(file), 'saved in the chat\'s own media folder');
    media.removeChat(x.root, chatId);
    assert.ok(!fs.existsSync(file), 'and removed with the chat');
    // A seed he typed wins over the saved one.
    const r2 = await x.handlers['rp:scene'](chatId, { cardIds: [card.id], prompt: 'Aria at the river', source: 'comfy', seed: 12 });
    assert.strictEqual(r2.seed, 12);
  } finally { await f.close(); }
});

test('rp:scene refuses before any request: real people, minors, unclear ages', async () => {
  let called = 0;
  const f = await fakeComfy();
  const x = setup({ comfy: { url: f.base, checkpoint: '' } });
  try {
    const orig = f.seen.prompts;
    const ids = { real: x.p.cards.save(real).id, minor: x.p.cards.save(hardMinor).id, ageless: x.p.cards.save(ageless).id };
    for (const [id, prompt, kind] of [[ids.real, 'portrait at the park', 'real'], [ids.minor, 'nude by the lake', 'minor'], [ids.ageless, 'nude by the lake', 'age']]) {
      const r = await x.handlers['rp:scene']('c0ffee12345', { cardIds: [id], prompt, source: 'comfy' });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.error.kind, kind);
      called += orig.length;
    }
    assert.strictEqual(called, 0, 'ComfyUI is never asked');
  } finally { await f.close(); }
});

test('rp:scene clear errors: nothing set up, ComfyUI offline, no checkpoints', async () => {
  const x = setup();
  const c = x.p.cards.save(adult);
  const none = await x.handlers['rp:scene']('c0ffee12345', { cardIds: [c.id], prompt: 'Aria', source: 'comfy' });
  assert.match(none.error.message, /Add your ComfyUI server/);
  const off = setup({ comfy: { url: 'http://127.0.0.1:9', checkpoint: '' } });
  const c2 = off.p.cards.save(adult);
  const r = await off.handlers['rp:scene']('c0ffee12345', { cardIds: [c2.id], prompt: 'Aria', source: 'comfy' });
  assert.strictEqual(r.error.kind, 'unreachable');
  const f = await fakeComfy({ checkpoints: [] });
  try {
    const y = setup({ comfy: { url: f.base, checkpoint: '' } });
    const c3 = y.p.cards.save(adult);
    const r2 = await y.handlers['rp:scene']('c0ffee12345', { cardIds: [c3.id], prompt: 'Aria', source: 'comfy' });
    assert.strictEqual(r2.error.kind, 'no_models');
    const l = await y.handlers['comfy:checkpoints']();
    assert.match(l.message, /no checkpoint/);
  } finally { await f.close(); }
});

test('the look: only his edits and buttons change it; kept with the character, never in exported cards', () => {
  const x = setup();
  const c = x.p.cards.save(adult);
  assert.strictEqual(c.ownerLook, undefined, 'nothing until he sets it');
  const a = x.p.cards.setLook(c.id, { appearance: 'red braid', keepSeed: true });
  assert.deepStrictEqual(a.ownerLook, { appearance: 'red braid' }, 'keep the same seed on by default (not stored)');
  const b = x.p.cards.setLook(c.id, { reroll: true });
  assert.ok(Number.isInteger(b.ownerLook.seed), 'Re-roll: a new seed');
  assert.strictEqual(b.ownerLook.appearance, 'red braid', 'the appearance is kept');
  const e = x.p.cards.save({ id: c.id, name: 'Aria', description: 'changed' });
  assert.deepStrictEqual(e.ownerLook, b.ownerLook, 'editing the card keeps the look');
  assert.strictEqual(x.p.cards.setLook(c.id, { keepSeed: false }).ownerLook.keepSeed, false);
  assert.throws(() => x.p.cards.setLook(c.id, { seed: 'abc' }), /whole number/);
  const out = x.p.cards.exportCard(c.id, 'json');
  assert.doesNotMatch(out.buf.toString('utf8'), /ownerLook|red braid/, 'not in the exported card');
});

// Regression: "Your GPU server has no ComfyUI entry." in Characters chats. With a ComfyUI-only
// GPU server, a Characters chat picture (rp:image) and a scene (rp:scene with that server) both
// reach ComfyUI's /prompt, as pictures in normal chats (media:image) do.
test('regression: a ComfyUI-only GPU server makes Characters chat pictures and scenes', async () => {
  const f = await fakeComfy();
  const x = setup();
  try {
    const s = await x.p.teammates.addServer({ name: 'Nvidia PC', type: 'comfy', url: f.base });
    const card = x.p.cards.save(adult);
    const st = x.handlers['teammates:status']();
    assert.strictEqual(st.imagesOnly.gpu, true);
    const portrait = await x.handlers['rp:image']('c0ffee12345', { kind: 'portrait', cardIds: [card.id], provider: 'gpu' });
    assert.strictEqual(portrait.ok, true, JSON.stringify(portrait));
    assert.doesNotMatch(JSON.stringify(portrait), /no ComfyUI entry/);
    const normal = await x.handlers['media:image']('c0ffee12345', { provider: 'gpu', prompt: 'a cat' });
    assert.strictEqual(normal.ok, true);
    const sources = x.handlers['rp:sceneSources']();
    assert.ok(sources.some((y) => y.id === `gpu:${s.id}`), 'his GPU server\'s ComfyUI is offered for scenes');
    const sc = await x.handlers['rp:scene']('c0ffee12345', { cardIds: [card.id], prompt: 'Aria at the fire', source: `gpu:${s.id}`, seed: 5 });
    assert.strictEqual(sc.ok, true, JSON.stringify(sc));
    assert.strictEqual(f.seen.prompts.length, 3);
  } finally { await f.close(); }
});

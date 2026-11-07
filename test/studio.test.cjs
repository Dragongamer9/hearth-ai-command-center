// 2.2.1 Images & Videos and Uncensored mode (electron/studio.cjs, electron/comfy.cjs runWorkflow).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const studio = require('../electron/studio.cjs');
const comfy = require('../electron/comfy.cjs');
const media = require('../electron/media.cjs');
const scene = require('../electron/scene.cjs');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('hard limits: minors and anyone who looks under 18 are blocked in every mode', () => {
  for (const uncensored of [false, true]) {
    for (const p of ['nude teen on a beach', 'sexy loli', 'naked girl, 16 years old', 'nude woman who looks 15', 'sexy schoolgirl in uniform', 'explicit scene, barely legal', 'nude, underage']) {
      const r = studio.checkPrompt({ prompt: p, uncensored });
      assert.equal(r.ok, false, p);
      assert.equal(r.kind, 'minor', p);
    }
  }
});
test('hard limits: real people are blocked, sexual or not, in every mode', () => {
  for (const uncensored of [false, true]) {
    for (const p of ['nude celebrity', 'a deepfake of my boss', 'portrait in the likeness of a famous actress', 'a real person at the beach']) {
      const r = studio.checkPrompt({ prompt: p, uncensored });
      assert.equal(r.ok, false, p);
      assert.equal(r.kind, 'real', p);
    }
  }
});
test('18+ prompts need Uncensored mode; adults are fine with it on; outside photos never become sexual videos', () => {
  const p = 'nude elf queen, adult woman, in a moonlit bath house';
  assert.equal(studio.checkPrompt({ prompt: p, uncensored: false }).kind, 'uncensored_off');
  assert.deepEqual(studio.checkPrompt({ prompt: p, uncensored: true }), { ok: true, sexual: true });
  const out = studio.checkPrompt({ prompt: p, uncensored: true, outside: true, what: 'video' });
  assert.equal(out.ok, false);
  assert.equal(out.kind, 'real');
  assert.deepEqual(studio.checkPrompt({ prompt: 'a steam locomotive on a snowy viaduct', uncensored: false }), { ok: true, sexual: false });
  assert.deepEqual(studio.checkPrompt({ prompt: 'a steam train', uncensored: false, outside: true }), { ok: true, sexual: false });
  assert.equal(studio.checkPrompt({ prompt: '   ' }).kind, 'empty');
});
test('negative prompt: minors always left out; nudity only while Uncensored mode is off; his words only add', () => {
  const off = studio.negativeFor({ kind: 'image', uncensored: false, own: 'cars' });
  const on = studio.negativeFor({ kind: 'video', uncensored: true });
  for (const n of [off, on]) assert.ok(n.includes(scene.NEG_MINOR));
  assert.ok(off.includes(scene.NEG_NSFW) && off.endsWith('cars'));
  assert.ok(!on.includes('nudity'));
  assert.ok(on.includes('static'));
});
test('Uncensored mode setting: off by default, merged, never filled in', () => {
  assert.deepEqual(studio.cleanUncensored(undefined), { on: false, chatModel: '', pictureModel: '', confirmedAt: null });
  assert.deepEqual(studio.cleanUncensored({ on: 'yes' }).on, false);
  const m = studio.mergeUncensored({ on: true, chatModel: 'dolphin3:8b', confirmedAt: '2026-11-06T00:00:00Z' }, { pictureModel: 'Pony.safetensors' });
  assert.deepEqual(m, { on: true, chatModel: 'dolphin3:8b', pictureModel: 'Pony.safetensors', confirmedAt: '2026-11-06T00:00:00Z' });
  assert.throws(() => studio.mergeUncensored({}, { chatModel: 'bad model name with spaces' }));
  assert.equal(studio.mergeUncensored({ on: true }, { on: false }).on, false);
});
test('local chat in Uncensored mode: the 18+ model for Ollama and Hearth devices only; hard limits still checked', () => {
  const s = { uncensored: { on: true, chatModel: 'huihui_ai/qwen3-abliterated:14b' } };
  assert.equal(studio.chatUncensored({ uncensored: { on: false, chatModel: 'x' } }, 'ollama', 'hi'), null);
  assert.equal(studio.chatUncensored(s, 'anthropic', 'hi'), null);
  assert.equal(studio.chatUncensored(s, 'openai', 'hi'), null);
  assert.deepEqual(studio.chatUncensored(s, 'ollama', 'tell me a story'), { ok: true, model: 'huihui_ai/qwen3-abliterated:14b' });
  assert.deepEqual(studio.chatUncensored(s, 'hearth', 'an erotic story about two adults'), { ok: true, model: 'huihui_ai/qwen3-abliterated:14b' });
  const r = studio.chatUncensored(s, 'ollama', 'an erotic story with a 15 year old');
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'minor');
});

const UNETS = ['Wan2.2-T2V-A14B-HighNoise-Q4_K_M.gguf', 'Wan2.2-T2V-A14B-LowNoise-Q4_K_M.gguf', 'Wan2.2-I2V-A14B-HighNoise-Q4_K_M.gguf', 'Wan2.2-I2V-A14B-LowNoise-Q4_K_M.gguf'];
const LORAS = ['Wan2.2_LightX2V_high_n54vv.safetensors', 'Wan2.2_LightX2V_low_n54vv.safetensors', 'wan2.2_i2v_A14b_high_noise_lora_rank64_lightx2v_4step_1022.safetensors', 'wan2.2_i2v_A14b_low_noise_lora_rank64_lightx2v_4step_1022.safetensors'];
test('Wan 2.2: the right model pair, LoRAs and plain messages for what is missing', () => {
  assert.deepEqual(studio.pickWan(UNETS, 't2v'), { high: UNETS[0], low: UNETS[1] });
  assert.deepEqual(studio.pickWan(UNETS, 'i2v'), { high: UNETS[2], low: UNETS[3] });
  assert.equal(studio.pickLoras(LORAS, { uncensored: true }).kind, 'uncensored');
  assert.equal(studio.pickLoras(LORAS, { uncensored: true }).high, LORAS[0]);
  assert.equal(studio.pickLoras(LORAS, { uncensored: false, mode: 'i2v' }).high, LORAS[2]);
  assert.equal(studio.pickLoras(LORAS.slice(0, 2), { uncensored: false, mode: 't2v' }).kind, 'none');
  assert.equal(studio.pickLoras([], { uncensored: true }).kind, 'missing_uncensored');
  const ok = studio.videoSetup({ unets: UNETS, loras: LORAS, clips: ['umt5_xxl_fp8_e4m3fn_scaled.safetensors'], vaes: ['wan_2.1_vae.safetensors', 'wan2.2_vae.safetensors'], mode: 't2v', uncensored: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.models.vae, 'wan_2.1_vae.safetensors');
  assert.deepEqual([ok.models.steps, ok.models.split, ok.models.cfg], [4, 2, 1]);
  const slow = studio.videoSetup({ unets: UNETS, loras: [], clips: ['umt5_xxl_fp8_e4m3fn_scaled.safetensors'], vaes: ['wan_2.1_vae.safetensors'], mode: 't2v' });
  assert.deepEqual([slow.models.steps, slow.models.split, slow.models.lora], [20, 10, null]);
  assert.equal(studio.videoSetup({ unets: null }).kind, 'no_gguf');
  const i2vOnly = studio.videoSetup({ unets: UNETS.slice(2), clips: ['umt5'], vaes: ['wan_2.1_vae'], mode: 't2v' });
  assert.equal(i2vOnly.kind, 'no_t2v');
  assert.match(i2vOnly.message, /i2v-only/);
  assert.equal(studio.videoSetup({ unets: UNETS, clips: ['umt5'], vaes: ['wan_2.1_vae'], uncensored: true }).kind, 'no_lora');
  assert.equal(studio.videoSetup({ unets: UNETS, clips: [], vaes: ['wan_2.1_vae'] }).kind, 'no_clip');
});
test('Wan 2.2 workflow: two GGUF models, LoRAs on both, two samplers 0-2 and 2-4, CFG 1, 832x480, 81 frames', () => {
  const s = studio.videoSetup({ unets: UNETS, loras: LORAS, clips: ['umt5_xxl_fp8_e4m3fn_scaled.safetensors'], vaes: ['wan_2.1_vae.safetensors'], mode: 'i2v', uncensored: true });
  const g = studio.buildVideoWorkflow({ mode: 'i2v', models: s.models, positive: 'the train moves', negative: 'blurry', seed: 42, image: 'hearth-start.png' });
  assert.equal(g[1].class_type, 'UnetLoaderGGUF');
  assert.equal(g[1].inputs.unet_name, UNETS[2]);
  assert.equal(g[3].inputs.lora_name, LORAS[0]);
  assert.equal(g[4].inputs.lora_name, LORAS[1]);
  assert.equal(g[3].inputs.strength_model, 1);
  assert.deepEqual(g[10].inputs.model, ['3', 0]);
  assert.equal(g[5].inputs.type, 'wan');
  assert.equal(g[12].inputs.image, 'hearth-start.png');
  assert.equal(g[13].class_type, 'WanImageToVideo');
  assert.deepEqual([g[13].inputs.width, g[13].inputs.height, g[13].inputs.length], [832, 480, 81]);
  assert.deepEqual([g[20].inputs.start_at_step, g[20].inputs.end_at_step, g[20].inputs.cfg, g[20].inputs.steps], [0, 2, 1, 4]);
  assert.deepEqual([g[21].inputs.start_at_step, g[21].inputs.add_noise], [2, 'disable']);
  assert.deepEqual(g[21].inputs.positive, ['13', 0]);
  assert.equal(g[24].class_type, 'SaveVideo');
  const t = studio.buildVideoWorkflow({ mode: 't2v', models: { ...s.models, lora: null }, positive: 'x', seed: 1, width: 480, height: 832 });
  assert.equal(t[13].class_type, 'EmptyHunyuanLatentVideo');
  assert.deepEqual([t[13].inputs.width, t[13].inputs.height], [480, 832]);
  assert.equal(t[3], undefined);
  assert.deepEqual(t[10].inputs.model, ['1', 0]);
  assert.deepEqual(t[20].inputs.positive, ['6', 0]);
});

// A fake ComfyUI with the Wan 2.2 files installed.
function fakeComfy({ uploads = [], prompts = [] } = {}) {
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/object_info/UnetLoaderGGUF') return json({ UnetLoaderGGUF: { input: { required: { unet_name: [UNETS, {}] } } } });
    if (u.pathname === '/object_info/LoraLoaderModelOnly') return json({ LoraLoaderModelOnly: { input: { required: { lora_name: ['COMBO', { options: LORAS }] } } } });
    if (u.pathname === '/object_info/CLIPLoader') return json({ CLIPLoader: { input: { required: { clip_name: [['umt5_xxl_fp8_e4m3fn_scaled.safetensors'], {}] } } } });
    if (u.pathname === '/object_info/VAELoader') return json({ VAELoader: { input: { required: { vae_name: [['wan_2.1_vae.safetensors'], {}] } } } });
    if (u.pathname === '/object_info/CheckpointLoaderSimple') return json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['NoobAI-XL-v1.1.safetensors'], {}] } } } });
    if (u.pathname === '/upload/image') { uploads.push(init.body); return json({ name: 'hearth-start.png', subfolder: '', type: 'input' }); }
    if (u.pathname === '/prompt') { prompts.push(JSON.parse(init.body).prompt); return json({ prompt_id: `p-${prompts.length}` }); }
    if (u.pathname.startsWith('/history/')) {
      const id = u.pathname.split('/').pop();
      const g = prompts[Number(id.split('-')[1]) - 1];
      const vid = Boolean(g?.[24]);
      return json({ [id]: { status: { status_str: 'success', completed: true }, outputs: { 9: vid ? { images: [{ filename: 'hearth-video_00001.mp4', subfolder: 'video', type: 'output' }], animated: [true] } : { images: [{ filename: 'hearth-scene_00001.png', subfolder: '', type: 'output' }] } } } });
    }
    if (u.pathname === '/view') return /mp4/.test(u.searchParams.get('filename')) ? new Response(Buffer.from('fake mp4 bytes'), { headers: { 'content-type': 'video/mp4' } }) : new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    if (u.pathname === '/queue') return json({ queue_running: [], queue_pending: [] });
    return json({}, 404);
  };
}
const until = async (fn) => { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 10)); } throw new Error('timed out'); };

test('studio: a blocked request never reaches ComfyUI', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
  let calls = 0;
  const st = studio.createStudio({ dataDir: () => dir, readSettings: () => ({ comfy: { url: 'http://100.72.99.97:8188' }, uncensored: { on: true } }), fetchImpl: async () => { calls++; return new Response('{}'); }, sleep: async () => {}, pollMs: 1 });
  for (const p of ['nude teen', 'sexy loli', 'a deepfake of a celebrity']) {
    const r = st.add({ kind: 'image', prompt: p });
    assert.equal(r.ok, false, p);
  }
  assert.equal(st.add({ kind: 'video', prompt: 'nude woman, adult', start: 'pick:nope' }).ok, false);
  assert.equal(calls, 0);
  assert.equal(st.list().jobs.length, 0);
});
test('studio: a text-to-video request builds the Wan workflow (uncensored LoRA), saves the video and marks it 18+', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
  const prompts = [];
  const events = [];
  const st = studio.createStudio({ dataDir: () => dir, readSettings: () => ({ comfy: { url: 'http://100.72.99.97:8188' }, uncensored: { on: true } }), fetchImpl: fakeComfy({ prompts }), send: (ch, v) => events.push(ch), sleep: async () => {}, pollMs: 1 });
  const r = st.add({ kind: 'video', prompt: 'a steam train crossing a viaduct', size: '832x480' });
  assert.equal(r.ok, true);
  await until(() => st.list().items.length === 1);
  const it = st.list().items[0];
  assert.equal(it.kind, 'video');
  assert.equal(it.adult, true);
  assert.match(it.url, /^hearth-media:\/\/c\/studio\//);
  assert.ok(fs.existsSync(st.itemFile(it.id)));
  const g = prompts[0];
  assert.equal(g[1].inputs.unet_name, UNETS[0]);
  assert.equal(g[3].inputs.lora_name, LORAS[0]);
  assert.ok(g[7].inputs.text.includes('child'));
  assert.ok(!g[7].inputs.text.includes('nudity'));
  assert.ok(events.includes('studio:update'));
  // Saved atomically in studio.json, with the file in media/studio/.
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'studio.json'), 'utf8')).items.length, 1);
  assert.equal(st.remove(it.id).ok, true);
  assert.equal(st.list().items.length, 0);
});
test('studio: picture to video uploads the gallery picture; pictures keep the no-nudity words while the mode is off', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
  const prompts = [];
  const uploads = [];
  const settings = { comfy: { url: 'http://100.72.99.97:8188' }, uncensored: { on: false } };
  const st = studio.createStudio({ dataDir: () => dir, readSettings: () => settings, fetchImpl: fakeComfy({ prompts, uploads }), sleep: async () => {}, pollMs: 1 });
  assert.equal(st.add({ kind: 'image', prompt: 'nude adult woman' }).kind, 'uncensored_off');
  assert.equal(st.add({ kind: 'image', prompt: 'a signal box at night', count: 2 }).jobs.length, 2);
  await until(() => st.list().items.length >= 1 && st.list().jobs.length === 0);
  assert.ok(prompts[0][7].inputs.text.includes('nudity'));
  const pic = st.list().items.find((x) => x.kind === 'image');
  assert.equal(pic.adult, false);
  const r = st.add({ kind: 'video', prompt: 'the lamp flickers', start: `item:${pic.id}` });
  assert.equal(r.ok, true);
  await until(() => st.list().items.some((x) => x.kind === 'video'));
  assert.equal(uploads.length, 1);
  const g = prompts.at(-1);
  assert.equal(g[13].class_type, 'WanImageToVideo');
  assert.equal(g[1].inputs.unet_name, UNETS[2]);
  assert.equal(g[3].inputs.lora_name, LORAS[2]);
  const vid = st.list().items.find((x) => x.kind === 'video');
  assert.equal(vid.from, pic.id);
  assert.equal(vid.mode, 'i2v');
});
test('studio: a waiting job can be removed; nothing to do without a ComfyUI address', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
  const st0 = studio.createStudio({ dataDir: () => dir, readSettings: () => ({ comfy: {}, uncensored: {} }) });
  assert.equal(st0.add({ kind: 'image', prompt: 'x' }).kind, 'not_set');
  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = async (url, init) => { if (new URL(url).pathname === '/prompt') await gate; return fakeComfy()(url, init); };
  const st = studio.createStudio({ dataDir: () => dir, readSettings: () => ({ comfy: { url: 'http://100.72.99.97:8188' }, uncensored: {} }), fetchImpl: slow, sleep: async () => {}, pollMs: 1 });
  const a = st.add({ kind: 'image', prompt: 'one' });
  const b = st.add({ kind: 'image', prompt: 'two' });
  assert.equal(st.list().jobs.length, 2);
  assert.equal(st.cancel(b.jobs[0]).removed, true);
  assert.equal(st.list().jobs.length, 1);
  assert.equal(st.list().jobs[0].id, a.jobs[0]);
  release();
  await until(() => st.list().jobs.length === 0);
});
test('comfy.runWorkflow, objectOptions and uploadImage stay on the configured host and never follow redirects', async () => {
  const base = 'http://100.72.99.97:8188';
  const o = { base, allow: comfy.allowOnly(base), fetchImpl: fakeComfy() };
  assert.deepEqual((await comfy.objectOptions(o, 'LoraLoaderModelOnly', 'lora_name')).list, LORAS);
  assert.equal((await comfy.objectOptions({ ...o, fetchImpl: async () => new Response('{}') }, 'UnetLoaderGGUF', 'unet_name')).kind, 'no_node');
  assert.equal((await comfy.uploadImage(o, { buf: Buffer.from('x') })).name, 'hearth-start.png');
  const redirect = async () => new Response(null, { status: 302, headers: { location: 'http://evil.example/' } });
  assert.equal((await comfy.runWorkflow({ ...o, fetchImpl: redirect, graph: {} })).kind, 'redirect');
  assert.equal((await comfy.runWorkflow({ base: 'http://evil.example:8188', allow: comfy.allowOnly(base), fetchImpl: fakeComfy(), graph: {} })).kind, 'blocked');
});
test('wiring: settings, the confirm box, local chat, Send to a chat and the media folder', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /uncensored: studioLib\.cleanUncensored\(s\.uncensored\)/);
  assert.match(main, /if \('uncensored' in patch\)/);
  assert.match(main, /Turn on Uncensored mode \(18\+\)\?/);
  assert.match(main, /if \(it\.adult\) return \{ ok: false/);
  assert.match(main, /uncensoredFor: \(agent, prompt\) => studioLib\.chatUncensored\(readSettings\(\), agent, prompt\)/);
  assert.match(read('electron/v2.cjs'), /d\.uncensoredFor \? d\.uncensoredFor\(agent, prompt\)/);
  assert.match(read('electron/parity.cjs'), /handle\('studio:add'/);
  assert.ok(media.CHAT_RE.test('studio'));
  assert.ok(!media.CHAT_RE.test('studio2'));
  // Nothing in the studio writes settings.
  assert.doesNotMatch(read('electron/studio.cjs'), /writeSettings|settings:set/);
});

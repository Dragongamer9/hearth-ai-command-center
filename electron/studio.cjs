// Images & Videos (2.2.1): pictures and videos made by ComfyUI on the owner's Nvidia PC.
// - Pictures: the same text-to-image graph as Characters scenes (electron/comfy.cjs).
// - Videos: Wan 2.2 14B as install-wan22-video.sh puts it on his PC (ComfyUI-GGUF's
//   UnetLoaderGGUF with the HighNoise/LowNoise Q4_K_M pairs, umt5_xxl_fp8_e4m3fn_scaled,
//   wan_2.1_vae): text to video (T2V pair) and picture to video (I2V pair). The app builds the
//   whole workflow itself; nothing has to be wired up in ComfyUI.
// - Uncensored mode (Settings): videos load rzgar's Wan2.2_LightX2V_4Step_Uncensored pair
//   instead of the plain speed LoRAs, pictures drop the "no nudity" negative words and may use
//   his own 18+ picture model, and local chat (Ollama / Hearth devices) uses his 18+ chat model.
// - The hard limits are always on, Uncensored or not, and checked here before anything is sent:
//   never anything sexual with minors or anyone who looks under 18 (cards.cjs MINOR_WORDS,
//   HARD_WORDS, ages under 18; scene.cjs AMBIGUOUS and "looks 15"), never a real person's
//   likeness (cards.cjs REAL_TAGS, scene.cjs LIKENESS). A picture file added from outside the
//   app is used for a video in Uncensored mode only after the owner confirms, each time, that it
//   isn't a real person (and everyone in it is an adult): NOT_REAL_TEXT. Minors are kept out of every
//   picture and video by the negative prompt. A blocked request never reaches ComfyUI.
// - The gallery is saved in <data>/studio.json (atomic, .bak, never written over when broken);
//   the files in <data>/media/studio/ (served by the hearth-media: scheme). Nothing here writes
//   settings.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hnet = require('./hearth-net.cjs');
const comfy = require('./comfy.cjs');
const cards = require('./cards.cjs');
const scene = require('./scene.cjs');
const media = require('./media.cjs');
const { createJsonFile } = require('./jsonfile.cjs');

const FOLDER = 'studio';
const MAX_ITEMS = 2000;
const MAX_JOBS = 20;
const NEG_PIC = 'blurry, low quality, deformed, extra limbs, watermark, text';
const NEG_VID = 'blurry, static, low quality, worst quality, deformed, watermark, text, subtitles';
const SCRIPT = 'install-wan22-video.sh';
const VIDEO_SIZES = Object.freeze([
  { id: '832x480', width: 832, height: 480, label: 'Wide 832 × 480' },
  { id: '480x832', width: 480, height: 832, label: 'Tall 480 × 832' },
]);
const FRAMES = 81; // about 5 seconds at 16 frames a second
const FPS = 16;
const ID_RE = /^[0-9a-f]{12}$/;
// Asked each time a picture file from outside the app starts a video in Uncensored mode (never remembered).
const NOT_REAL_TEXT = 'This picture is not a real person — it\'s AI-made, drawn or a 3D render, and everyone in it is an adult.';
const NOT_REAL_REFUSED = 'Not made: a picture file you add can only start a video in Uncensored mode after you confirm it isn\'t a real person (AI-made, drawn or a 3D render) and everyone in it is an adult.';

// ---------- the hard limits (pure) ----------
// { ok, sexual } or { ok: false, kind, message }. uncensored: the owner's switch.
function checkPrompt({ prompt = '', uncensored = false, what = 'picture' } = {}) {
  const p = String(prompt || '');
  if (!p.trim()) return { ok: false, kind: 'empty', message: `Say what the ${what} should show.` };
  const real = p.match(cards.REAL_TAGS) || p.match(scene.LIKENESS);
  if (real) return { ok: false, kind: 'real', message: `Blocked: the prompt asks for a real person ("${real[0]}"). Pictures and videos never use a real person's likeness.` };
  const sexual = cards.isSexual(p);
  if (!sexual) return { ok: true, sexual: false };
  const minor = p.match(cards.HARD_WORDS) || p.match(cards.MINOR_WORDS);
  const young = cards.ageNumbers(p).find((x) => x > 0 && x < 18);
  if (minor || young !== undefined) return { ok: false, kind: 'minor', message: `Blocked: the prompt mentions ${minor ? `"${minor[0]}"` : `the age ${young}`}, so it can't be sexual. This is a hard limit: no setting changes it.` };
  const amb = p.match(scene.AMBIGUOUS);
  const look = scene.lookAges(p)[0];
  if (amb || look !== undefined) return { ok: false, kind: 'minor', message: `Blocked: the prompt says ${amb ? `"${amb[0]}"` : `someone looks ${look}`}, which makes the age unclear, so it can't be sexual. Nothing sexual is ever made with anyone who looks under 18.` };
  if (!uncensored) return { ok: false, kind: 'uncensored_off', message: 'That prompt is 18+. Turn on Uncensored mode in Settings › Uncensored mode to make it (adults only).' };
  return { ok: true, sexual: true };
}
// The negative prompt: minors are always kept out; nudity too unless Uncensored mode is on.
// His own words only ever add to it.
function negativeFor({ kind = 'image', uncensored = false, own = '' } = {}) {
  return [kind === 'video' ? NEG_VID : NEG_PIC, scene.NEG_MINOR, uncensored ? '' : scene.NEG_NSFW, scene.ownNegative(own)].filter(Boolean).join(', ');
}
// Local chat in Uncensored mode: which model, and the same hard limits on what is asked.
// null when the switch is off or the AI isn't a local one (Claude and ChatGPT are never changed).
function chatUncensored(settings, agent, prompt) {
  const u = cleanUncensored(settings?.uncensored);
  if (!u.on || !['ollama', 'hearth'].includes(agent)) return null;
  const p = String(prompt || '');
  if (cards.isSexual(p)) {
    const minor = p.match(cards.HARD_WORDS) || p.match(cards.MINOR_WORDS);
    const young = cards.ageNumbers(p).find((x) => x > 0 && x < 18);
    const amb = p.match(scene.AMBIGUOUS);
    if (minor || young !== undefined || amb) return { ok: false, kind: 'minor', message: `Blocked: this is sexual and mentions ${minor ? `"${minor[0]}"` : young !== undefined ? `the age ${young}` : `"${amb[0]}"`}. Nothing sexual with anyone under 18 or who looks it, in any mode.` };
  }
  return { ok: true, model: u.chatModel || null };
}

// ---------- the setting (read-time defaults; saved only when the owner changes it) ----------
const MODEL_RE = /^[^\0\r\n]{1,200}$/; // a ComfyUI checkpoint file name
const CHAT_MODEL_RE = /^[A-Za-z0-9._:\-/]{1,100}$/; // an Ollama model name (validate.cjs validateModel)
function cleanUncensored(v) {
  const s = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  return {
    on: s.on === true,
    chatModel: typeof s.chatModel === 'string' && CHAT_MODEL_RE.test(s.chatModel) ? s.chatModel : '',
    pictureModel: typeof s.pictureModel === 'string' && MODEL_RE.test(s.pictureModel) ? s.pictureModel : '',
    confirmedAt: typeof s.confirmedAt === 'string' && s.confirmedAt.length <= 40 ? s.confirmedAt : null,
  };
}
function mergeUncensored(cur, patch) {
  const next = cleanUncensored(cur);
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  if ('on' in p) next.on = p.on === true;
  for (const k of ['chatModel', 'pictureModel']) {
    if (!(k in p)) continue;
    const v = String(p[k] || '').trim();
    if (v && !(k === 'chatModel' ? CHAT_MODEL_RE : MODEL_RE).test(v)) throw new Error('That model name isn\'t valid.');
    next[k] = v;
  }
  return next;
}

// ---------- Wan 2.2 (pure) ----------
// The HighNoise/LowNoise pair for text to video (T2V) or picture to video (I2V).
function pickWan(unets = [], mode = 't2v') {
  const re = mode === 'i2v' ? /i2v/i : /t2v/i;
  const of = (noise) => unets.filter((n) => re.test(n) && new RegExp(`${noise}[_-]?noise`, 'i').test(n) && /\.gguf$/i.test(n)).sort((a, b) => (/q4_k_m/i.test(b) ? 1 : 0) - (/q4_k_m/i.test(a) ? 1 : 0))[0] || null;
  const high = of('high');
  const low = of('low');
  return high && low ? { high, low } : null;
}
// The LoRA pair: rzgar's uncensored 4-step pair in Uncensored mode, else plain lightx2v speed
// LoRAs when he has them (for this mode: i2v or t2v), else none (slower: 20 steps).
function pickLoras(loras = [], { uncensored = false, mode = 't2v' } = {}) {
  const pair = (list) => {
    const high = list.find((n) => /high/i.test(n));
    const low = list.find((n) => /low/i.test(n));
    return high && low ? { high, low } : null;
  };
  if (uncensored) {
    const p = pair(loras.filter((n) => /n54vv|uncensored/i.test(n)));
    if (p) return { ...p, kind: 'uncensored' };
    return { kind: 'missing_uncensored' };
  }
  const speed = loras.filter((n) => /lightx2v|lightning/i.test(n) && !/n54vv|uncensored/i.test(n));
  const own = pair(speed.filter((n) => (mode === 'i2v' ? /i2v/i : /t2v/i).test(n)));
  const any = own || pair(speed.filter((n) => !/i2v|t2v/i.test(n)));
  return any ? { ...any, kind: 'speed' } : { kind: 'none' };
}
// What a video needs on the server, from the four model lists. { ok, models } or { ok: false, message }.
function videoSetup({ unets = null, loras = [], clips = [], vaes = [], mode = 't2v', uncensored = false } = {}) {
  if (!unets) return { ok: false, kind: 'no_gguf', message: `Your PC's ComfyUI can't load the Wan 2.2 files yet (the ComfyUI-GGUF node is missing). Run ${SCRIPT} on the PC, then try again.` };
  const wan = pickWan(unets, mode);
  if (!wan) {
    if (mode === 't2v' && pickWan(unets, 'i2v')) return { ok: false, kind: 'no_t2v', message: `Text to video needs the Wan 2.2 T2V files, and your PC only has the picture-to-video ones (the script was run with --i2v-only). Pick a picture to animate instead, or run ${SCRIPT} again without --i2v-only.` };
    return { ok: false, kind: 'no_wan', message: `Wan 2.2 14B (${mode === 'i2v' ? 'I2V' : 'T2V'} HighNoise and LowNoise .gguf) isn't on your PC's ComfyUI. Run ${SCRIPT} on the PC, then try again.` };
  }
  const clip = clips.find((n) => /umt5/i.test(n));
  if (!clip) return { ok: false, kind: 'no_clip', message: `The text encoder (umt5_xxl_fp8_e4m3fn_scaled) isn't on your PC's ComfyUI. Run ${SCRIPT} on the PC.` };
  const vae = vaes.find((n) => /wan_?2\.1_vae/i.test(n)) || vaes.find((n) => /wan/i.test(n) && !/2\.2/.test(n));
  if (!vae) return { ok: false, kind: 'no_vae', message: `The Wan VAE (wan_2.1_vae) isn't on your PC's ComfyUI. Run ${SCRIPT} on the PC.` };
  const lora = pickLoras(loras, { uncensored, mode });
  if (lora.kind === 'missing_uncensored') return { ok: false, kind: 'no_lora', message: `Uncensored mode needs the Wan2.2_LightX2V_4Step_Uncensored LoRA pair (Wan2.2_LightX2V_high_n54vv and _low_n54vv) in ComfyUI's loras folder. Run ${SCRIPT} on the PC.` };
  const fast = lora.kind === 'uncensored' || lora.kind === 'speed';
  return { ok: true, models: { ...wan, clip, vae, lora: fast ? { high: lora.high, low: lora.low, kind: lora.kind } : null, steps: fast ? 4 : 20, split: fast ? 2 : 10, cfg: fast ? 1 : 3.5 } };
}
// The whole API-format graph. image: the uploaded start picture's name (picture to video).
function buildVideoWorkflow({ mode = 't2v', models, positive, negative = '', seed, width = 832, height = 480, frames = FRAMES, image = null, prefix = 'hearth-video' }) {
  const size = VIDEO_SIZES.find((x) => x.width === Number(width) && x.height === Number(height)) || VIDEO_SIZES[0];
  const g = {
    1: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: models.high } },
    2: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: models.low } },
    5: { class_type: 'CLIPLoader', inputs: { clip_name: models.clip, type: 'wan', device: 'default' } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: String(positive || ''), clip: ['5', 0] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: String(negative || ''), clip: ['5', 0] } },
    8: { class_type: 'VAELoader', inputs: { vae_name: models.vae } },
  };
  let hi = ['1', 0];
  let lo = ['2', 0];
  if (models.lora) {
    g[3] = { class_type: 'LoraLoaderModelOnly', inputs: { model: hi, lora_name: models.lora.high, strength_model: 1.0 } };
    g[4] = { class_type: 'LoraLoaderModelOnly', inputs: { model: lo, lora_name: models.lora.low, strength_model: 1.0 } };
    hi = ['3', 0];
    lo = ['4', 0];
  }
  g[10] = { class_type: 'ModelSamplingSD3', inputs: { model: hi, shift: 8.0 } };
  g[11] = { class_type: 'ModelSamplingSD3', inputs: { model: lo, shift: 8.0 } };
  let pos = ['6', 0];
  let neg = ['7', 0];
  let latent;
  const n = Math.min(121, Math.max(17, Math.round(Number(frames) || FRAMES)));
  if (mode === 'i2v') {
    g[12] = { class_type: 'LoadImage', inputs: { image: String(image) } };
    g[13] = { class_type: 'WanImageToVideo', inputs: { positive: pos, negative: neg, vae: ['8', 0], start_image: ['12', 0], width: size.width, height: size.height, length: n, batch_size: 1 } };
    pos = ['13', 0];
    neg = ['13', 1];
    latent = ['13', 2];
  } else {
    g[13] = { class_type: 'EmptyHunyuanLatentVideo', inputs: { width: size.width, height: size.height, length: n, batch_size: 1 } };
    latent = ['13', 0];
  }
  const sd = Number(seed);
  g[20] = { class_type: 'KSamplerAdvanced', inputs: { model: ['10', 0], add_noise: 'enable', noise_seed: sd, steps: models.steps, cfg: models.cfg, sampler_name: 'euler', scheduler: 'simple', positive: pos, negative: neg, latent_image: latent, start_at_step: 0, end_at_step: models.split, return_with_leftover_noise: 'enable' } };
  g[21] = { class_type: 'KSamplerAdvanced', inputs: { model: ['11', 0], add_noise: 'disable', noise_seed: sd, steps: models.steps, cfg: models.cfg, sampler_name: 'euler', scheduler: 'simple', positive: pos, negative: neg, latent_image: ['20', 0], start_at_step: models.split, end_at_step: 10000, return_with_leftover_noise: 'disable' } };
  g[22] = { class_type: 'VAEDecode', inputs: { samples: ['21', 0], vae: ['8', 0] } };
  g[23] = { class_type: 'CreateVideo', inputs: { images: ['22', 0], fps: FPS } };
  g[24] = { class_type: 'SaveVideo', inputs: { video: ['23', 0], filename_prefix: prefix, format: 'mp4', codec: 'h264' } };
  return g;
}

// ---------- the store, the queue and the runs ----------
function createStudio({ dataDir, readSettings, send = () => {}, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), sleep, pollMs } = {}) {
  const root = media.mediaRoot(dataDir());
  const file = createJsonFile(path.join(dataDir(), 'studio.json'), { empty: () => ({ version: 1, items: [] }), check: (j) => Array.isArray(j.items), label: 'Images & Videos (studio.json)' });
  const jobs = [];
  let running = null;
  const picked = new Map(); // token -> a picture file he picked from outside the app
  const uid = () => crypto.randomBytes(6).toString('hex');
  const conn = () => {
    const c = readSettings().comfy || {};
    return c.url ? { base: c.url, allow: comfy.allowOnly(c.url), fetchImpl, name: 'Your PC' } : null;
  };
  const unc = () => cleanUncensored(readSettings().uncensored);
  const items = () => file.read().items;
  const jobView = (j) => ({ id: j.id, kind: j.kind, mode: j.mode, prompt: j.prompt, state: j.state, phase: j.phase || null, elapsed: j.elapsed || 0, startedAt: j.startedAt || null, estimate: estimateFor(j), n: j.n || 1, of: j.of || 1 });
  function estimateFor(j) {
    const same = items().filter((x) => x.kind === j.kind && (j.kind === 'image' || x.mode === j.mode) && Number.isFinite(x.secs)).slice(0, 5);
    return same.length ? Math.round(same.reduce((a, x) => a + x.secs, 0) / same.length) : null;
  }
  const snapshot = () => ({ items: items(), jobs: jobs.map(jobView), uncensored: unc().on, broken: file.broken ? file.broken() : null });
  const changed = () => { try { send('studio:update', snapshot()); } catch {} };
  const save = (list) => file.write({ version: 1, items: list.slice(0, MAX_ITEMS) });

  // A request from the window: checked, then queued (one job per picture asked for).
  function add(req = {}) {
    const kind = req.kind === 'video' ? 'video' : 'image';
    const mode = kind === 'video' ? (req.start ? 'i2v' : 't2v') : null;
    if (!conn()) return hnet.fail(`Type your PC's ComfyUI address in Settings › Accounts › ComfyUI server first (like ${comfy.DEFAULTS.url}).`, 'not_set');
    const prompt = String(req.prompt || '').replace(/[\0-\x08\x0b-\x1f]/g, ' ').trim().slice(0, 3000);
    let start = null;
    if (mode === 'i2v') {
      const s = String(req.start);
      if (s.startsWith('item:')) {
        const it = items().find((x) => x.id === s.slice(5) && x.kind === 'image');
        if (!it) return hnet.fail('That picture isn\'t in Images & Videos any more.');
        start = { item: it.id, outside: false };
      } else if (picked.has(s)) start = { file: picked.get(s), outside: true, token: s };
      else return hnet.fail('Pick the picture to animate again.');
    }
    const u = unc();
    const chk = checkPrompt({ prompt, uncensored: u.on, what: kind === 'video' ? 'video' : 'picture' });
    if (!chk.ok) return { ok: false, kind: chk.kind, message: chk.message };
    // An outside picture in Uncensored mode: only with his confirmation for this request.
    if (start?.outside && u.on && req.notReal !== true) return { ok: false, kind: 'confirm', message: NOT_REAL_REFUSED };
    if (start?.outside) start.notReal = req.notReal === true;
    const count = kind === 'image' ? [1, 2, 4].includes(Number(req.count)) ? Number(req.count) : 1 : 1;
    if (jobs.length + count > MAX_JOBS) return hnet.fail(`${MAX_JOBS} are already waiting. Let some finish first.`);
    const size = kind === 'video' ? VIDEO_SIZES.find((x) => x.id === req.size) || VIDEO_SIZES[0] : comfy.SIZE_CHOICES.find((x) => x.id === req.size) || null;
    const seed0 = Number.isInteger(Number(req.seed)) && req.seed !== '' && req.seed !== null && Number(req.seed) >= 0 && Number(req.seed) < 2 ** 31 ? Number(req.seed) : null;
    const added = [];
    for (let i = 0; i < count; i++) {
      const j = { id: uid(), kind, mode, prompt, own: scene.ownNegative(req.negative), seed: seed0 !== null ? seed0 + i : crypto.randomInt(1, 2 ** 31), size, steps: Number.isInteger(Number(req.steps)) && Number(req.steps) >= 4 && Number(req.steps) <= 60 ? Number(req.steps) : null, model: typeof req.model === 'string' && MODEL_RE.test(req.model) ? req.model : '', start, state: 'waiting', n: i + 1, of: count, again: req.again || null };
      jobs.push(j);
      added.push(j.id);
    }
    changed();
    pump();
    return { ok: true, jobs: added };
  }
  function pump() {
    if (running) return;
    const j = jobs.find((x) => x.state === 'waiting');
    if (!j) return;
    running = j;
    j.state = 'running';
    j.startedAt = now();
    j.ac = new AbortController();
    changed();
    run(j).catch((e) => hnet.fail(`It failed: ${e?.message || e}`)).then((r) => {
      const i = jobs.indexOf(j);
      if (i >= 0) jobs.splice(i, 1);
      running = null;
      if (r && !r.ok && r.kind !== 'cancelled') { try { send('studio:failed', { id: j.id, kind: j.kind, prompt: j.prompt, message: r.message }); } catch {} }
      if (j.start?.token && !jobs.some((x) => x.start?.token === j.start.token)) picked.delete(j.start.token);
      changed();
      pump();
    });
  }
  const progress = (j) => (p) => { if (p.phase !== 'tick') j.phase = p.phase; j.elapsed = p.elapsed; changed(); };
  async function run(j) {
    const c = conn();
    if (!c) return hnet.fail('No ComfyUI address saved.', 'not_set');
    const u = unc();
    // Checked again when it starts: the switch may have changed while it waited.
    const chk = checkPrompt({ prompt: j.prompt, uncensored: u.on, what: j.kind === 'video' ? 'video' : 'picture' });
    if (!chk.ok) return { ok: false, kind: chk.kind, message: chk.message };
    if (j.start?.outside && u.on && j.start.notReal !== true) return { ok: false, kind: 'confirm', message: NOT_REAL_REFUSED };
    const negative = negativeFor({ kind: j.kind, uncensored: u.on, own: j.own });
    if (j.kind === 'image') {
      const eff = comfy.effective(readSettings().comfy);
      const wanted = j.model || (u.on && u.pictureModel) || eff.checkpoint || null;
      const r = await comfy.generate({ ...c, checkpoint: wanted, strictCheckpoint: Boolean(j.model || (u.on && u.pictureModel)), prompt: j.prompt, negative, seed: j.seed, width: j.size?.width || eff.width, height: j.size?.height || eff.height, steps: j.steps || eff.steps, cfg: eff.cfg, checkVram: false, signal: j.ac.signal, onProgress: progress(j), ...(sleep ? { sleep } : {}), ...(pollMs ? { pollMs } : {}) });
      if (!r.ok) return r;
      const secs = Math.round((now() - j.startedAt) / 1000);
      const out = r.images.map((im, i) => keep(j, im.buf, `picture-${j.id}-${i + 1}.${/jpeg/.test(im.mime) ? 'jpg' : /webp/.test(im.mime) ? 'webp' : 'png'}`, { kind: 'image', seed: r.seed, model: r.checkpoint, width: r.width, height: r.height, steps: r.steps, negative, secs, adult: u.on })).filter(Boolean);
      return out.length ? { ok: true } : hnet.fail('The picture couldn\'t be saved.');
    }
    // Video: what his ComfyUI has, then the graph.
    j.phase = 'checking';
    changed();
    const opt = (cls, input) => comfy.objectOptions({ ...c, signal: j.ac.signal }, cls, input);
    const [un, lo, cl, va] = await Promise.all([opt('UnetLoaderGGUF', 'unet_name'), opt('LoraLoaderModelOnly', 'lora_name'), opt('CLIPLoader', 'clip_name'), opt('VAELoader', 'vae_name')]);
    for (const r of [un, lo, cl, va]) if (!r.ok && r.kind !== 'no_node') return r;
    const setup = videoSetup({ unets: un.ok ? un.list : null, loras: lo.ok ? lo.list : [], clips: cl.ok ? cl.list : [], vaes: va.ok ? va.list : [], mode: j.mode, uncensored: u.on });
    if (!setup.ok) return { ok: false, kind: setup.kind, message: setup.message };
    let image = null;
    if (j.mode === 'i2v') {
      const src = j.start.item ? itemFile(j.start.item) : j.start.file;
      let buf;
      try { buf = fs.readFileSync(src); } catch { return hnet.fail('The picture to animate isn\'t there any more.'); }
      const mime = /\.jpe?g$/i.test(src) ? 'image/jpeg' : /\.webp$/i.test(src) ? 'image/webp' : 'image/png';
      const up = await comfy.uploadImage({ ...c, signal: j.ac.signal }, { buf, filename: `hearth-start-${j.id}${path.extname(src) || '.png'}`, mime });
      if (!up.ok) return up;
      image = up.name;
    }
    const graph = buildVideoWorkflow({ mode: j.mode, models: setup.models, positive: j.prompt, negative, seed: j.seed, width: j.size?.width, height: j.size?.height, image });
    const r = await comfy.runWorkflow({ ...c, graph, kinds: ['video'], signal: j.ac.signal, onProgress: progress(j), what: 'video', ...(sleep ? { sleep } : {}), ...(pollMs ? { pollMs } : {}) });
    if (!r.ok) return r;
    const f = r.files[0];
    const ext = /webm/.test(f.mime) ? 'webm' : /webp/.test(f.mime) ? 'webp' : /gif/.test(f.mime) ? 'gif' : 'mp4';
    const it = keep(j, f.buf, `video-${j.id}.${ext}`, { kind: 'video', seed: j.seed, model: `Wan 2.2 14B ${j.mode === 'i2v' ? 'I2V' : 'T2V'}${setup.models.lora ? setup.models.lora.kind === 'uncensored' ? ' · uncensored LoRA' : ' · speed LoRA' : ''}`, width: graph['13'].inputs.width, height: graph['13'].inputs.height, frames: graph['13'].inputs.length, steps: setup.models.steps, negative, secs: Math.round((now() - j.startedAt) / 1000), adult: u.on, mode: j.mode, from: j.start?.item || null });
    return it ? { ok: true } : hnet.fail('The video couldn\'t be saved.');
  }
  function keep(j, buf, name, meta) {
    const it = media.storeBuffer(root, FOLDER, name, buf);
    if (!it) return null;
    const entry = { id: uid(), kind: meta.kind, mode: meta.mode || null, file: it.file, mime: it.mime, url: it.url, size: it.size, prompt: j.prompt, ownNegative: j.own || '', negative: meta.negative, seed: meta.seed, model: meta.model || null, width: meta.width || null, height: meta.height || null, frames: meta.frames || null, steps: meta.steps || null, secs: meta.secs, adult: meta.adult === true, from: meta.from || null, at: new Date(now()).toISOString() };
    save([entry, ...items()]);
    return entry;
  }
  function itemFile(id) {
    const it = items().find((x) => x.id === id);
    if (!it) return null;
    const r = media.resolve(media.urlFor(FOLDER, it.file), root);
    return r.ok ? r.file : null;
  }
  function cancel(id) {
    const j = jobs.find((x) => x.id === String(id));
    if (!j) return { ok: false, message: 'It already finished.' };
    if (j.state === 'running') { j.ac?.abort(); return { ok: true, stopped: true }; }
    jobs.splice(jobs.indexOf(j), 1);
    changed();
    return { ok: true, removed: true };
  }
  function remove(id) {
    const list = items();
    const it = list.find((x) => x.id === String(id));
    if (!it) return { ok: false, message: 'Already gone.' };
    save(list.filter((x) => x !== it));
    // The file goes only when no other entry uses it (the same picture made twice is stored once).
    if (!items().some((x) => x.file === it.file)) { const f = path.join(root, FOLDER, it.file); try { if (fs.lstatSync(f).isFile()) fs.unlinkSync(f); } catch {} }
    changed();
    return { ok: true };
  }
  // A picture he picks from outside the app, to animate (in Uncensored mode only after he confirms NOT_REAL_TEXT).
  function pickToken(file) {
    if (!/\.(png|jpe?g|webp)$/i.test(String(file || ''))) return hnet.fail('Pick a PNG, JPG or WebP picture.');
    let st;
    try { st = fs.statSync(file); } catch { return hnet.fail('That file isn\'t there.'); }
    if (!st.isFile() || st.size > comfy.MAX_IMAGE) return hnet.fail('That picture is too big (30 MB at most).');
    const t = `pick:${uid()}`;
    picked.set(t, file);
    return { ok: true, token: t, name: path.basename(file) };
  }
  // Again: the same request with a new seed.
  function again(id) {
    const it = items().find((x) => x.id === String(id));
    if (!it) return hnet.fail('That one isn\'t there any more.');
    const size = it.kind === 'video' ? VIDEO_SIZES.find((x) => x.width === it.width && x.height === it.height)?.id : comfy.SIZE_CHOICES.find((x) => x.width === it.width && x.height === it.height)?.id;
    return add({ kind: it.kind, prompt: it.prompt, negative: it.ownNegative, size, start: it.mode === 'i2v' && it.from && items().some((x) => x.id === it.from) ? `item:${it.from}` : null, again: it.id });
  }
  async function status() {
    const c = conn();
    if (!c) return hnet.fail(`Type your PC's ComfyUI address in Settings › Accounts › ComfyUI server first (like ${comfy.DEFAULTS.url}).`, 'not_set');
    const st = await comfy.systemStats(c);
    return st.ok ? { ...st, host: hnet.hostOf(c.base) } : { ...st, host: hnet.hostOf(c.base) };
  }
  return { add, cancel, remove, again, pickToken, itemFile, list: snapshot, status, jobs: () => jobs.map(jobView), FOLDER };
}

module.exports = { NOT_REAL_TEXT, NOT_REAL_REFUSED, createStudio, checkPrompt, negativeFor, chatUncensored, cleanUncensored, mergeUncensored, pickWan, pickLoras, videoSetup, buildVideoWorkflow, VIDEO_SIZES, FRAMES, FPS, SCRIPT, FOLDER, ID_RE };

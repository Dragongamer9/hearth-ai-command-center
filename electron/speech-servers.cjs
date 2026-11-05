// Speech servers: the free, open-source voice engines (Kokoro, Chatterbox, Sesame CSM, Dia,
// CosyVoice2, Orpheus) run on the owner's own machines (his Nvidia PC, or a GPU he rents) behind
// an HTTP server. One way to reach any of them:
// - the OpenAI-compatible speech API (POST /v1/audio/speech with model, voice, input,
//   response_format; voices from /v1/audio/voices), which most community servers speak;
// - presets for well-known server programs that have their own API, each checked against that
//   program's README or docs (November 2026):
//   Kokoro-FastAPI (remsky, Apache 2.0, port 8880): POST /v1/audio/speech (model, input, voice,
//     response_format mp3|wav|opus|flac|aac|pcm, speed); GET /v1/audio/voices -> { voices: [...] };
//     voices can be mixed: "af_bella(2)+af_sky(1)".
//   chatterbox-tts-api (travisvn, port 4123; its licence is in the app's credits: it is only ever
//     reached over HTTP, and none of its code is used here): POST /v1/audio/speech (input, voice,
//     exaggeration 0.25-2, cfg_weight 0-1, temperature 0.05-5); voice library: GET /v1/voices ->
//     { voices: [{ name, ... }], count }, POST /v1/voices (multipart voice_name, voice_file).
//     Its README lists the library at /voices, its wiki at /v1/voices: both are tried.
//   Chatterbox-TTS-Server (devnen, MIT, port 8004): POST /tts (text, voice_mode predefined|clone,
//     predefined_voice_id | reference_audio_filename, output_format wav, exaggeration, cfg_weight,
//     temperature, speed_factor); GET /get_predefined_voices, GET /get_reference_files. Its upload
//     form field isn't documented, so clips are added with its own web page.
//   Dia-TTS-Server (devnen, MIT, port 8003): POST /v1/audio/speech (input, voice S1|S2|dialogue|
//     <file in voices/ or reference_audio/>, response_format wav|opus, speed 0.5-2). [S1]/[S2]
//     speakers and cues like (laughs) (sighs) (clears throat).
//   Orpheus-FastAPI (Lex-au, Apache 2.0, port 5005): POST /v1/audio/speech (input, model orpheus,
//     voice, response_format wav only, speed 0.5-1.5); tags <laugh> <chuckle> <sigh> <cough>
//     <sniffle> <groan> <yawn> <gasp>.
//   sesame_csm_openai (phildougherty, port 8000): POST /v1/audio/speech (model csm-1b,
//     input, voice, response_format, speed, temperature); GET /v1/audio/voices; cloning
//     POST /v1/voice-cloning/clone (multipart name, audio_file, transcript, description).
//   CosyVoice's own FastAPI server (FunAudioLLM, Apache 2.0, runtime/python/fastapi/server.py,
//     port 50000): /inference_sft (tts_text, spk_id), /inference_zero_shot (tts_text, prompt_text,
//     prompt_wav file), form fields; answers raw 16-bit PCM with no header (wrapped in WAV here).
//     Newer copies accept POST as well as GET; POST is used (fetch can't send a body with GET).
// Rules: the server's own key (optional) is the only key ever sent to it; the address comes from
// his settings only (the window and the AIs only ever name a saved server by its id); redirects
// are refused so the key can't follow one; every request has a timeout and every answer a size cap.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWrite } = require('./jsonfile.cjs');

const ID_RE = /^[a-z0-9]{6,16}$/;
const MAX_SERVERS = 8;
const VOICE_RE = /^[^\0\r\n]{1,200}$/;
const MODEL_RE = /^[A-Za-z0-9._:/-]{1,80}$/;
const ENGINES = ['kokoro', 'chatterbox', 'sesame', 'dia', 'cosyvoice', 'orpheus', 'other'];
const ENGINE_NAMES = { kokoro: 'Kokoro', chatterbox: 'Chatterbox', sesame: 'Sesame CSM', dia: 'Dia', cosyvoice: 'CosyVoice2', orpheus: 'Orpheus', other: 'Another engine' };
const ORPHEUS_EN = ['tara', 'leah', 'jess', 'leo', 'dan', 'mia', 'zac', 'zoe'];
const ORPHEUS_MORE = ['pierre', 'amelie', 'marie', 'jana', 'thomas', 'max', 'javi', 'sergio', 'maria', 'pietro', 'giulia', 'carlo'];
// Size caps and timeouts (the owner's rule for anything that reaches another machine).
const MAX_AUDIO = 40 * 1024 * 1024; // one spoken part
const MAX_JSON = 2 * 1024 * 1024; // a voices list or a clone answer
const MAX_ERR = 64 * 1024; // an error page
const MAX_CLIP = 20 * 1024 * 1024; // a recording sent to learn a voice
const TIMEOUT = { list: 10000, speak: 180000, clone: 180000, test: 60000 };

// The server programs (presets). engine: the engine it runs (null = he picks). port: its
// documented default port. clone: how it learns a voice (null = not from the app).
const APIS = {
  openai: { label: 'OpenAI-compatible speech API', engine: null, model: 'tts-1', format: 'mp3', voices: ['/v1/audio/voices'], clone: null },
  'kokoro-fastapi': { label: 'Kokoro-FastAPI', engine: 'kokoro', model: 'kokoro', format: 'mp3', voices: ['/v1/audio/voices'], port: 8880, clone: null },
  'chatterbox-api': { label: 'chatterbox-tts-api', engine: 'chatterbox', model: 'chatterbox', format: null, voices: ['/v1/voices', '/voices'], port: 4123, clone: 'library', extras: ['exaggeration', 'cfgWeight', 'temperature'] },
  'chatterbox-server': { label: 'Chatterbox-TTS-Server', engine: 'chatterbox', model: 'chatterbox', format: 'wav', voices: ['/get_predefined_voices', '/get_reference_files'], port: 8004, clone: null, extras: ['exaggeration', 'cfgWeight', 'temperature'] },
  'dia-server': { label: 'Dia-TTS-Server', engine: 'dia', model: 'dia-1.6b', format: 'wav', voices: [], fixed: ['S1', 'S2', 'dialogue'], port: 8003, clone: null },
  'orpheus-fastapi': { label: 'Orpheus-FastAPI', engine: 'orpheus', model: 'orpheus', format: 'wav', voices: [], fixed: [...ORPHEUS_EN, ...ORPHEUS_MORE], port: 5005, clone: null },
  'sesame-openai': { label: 'sesame_csm_openai', engine: 'sesame', model: 'csm-1b', format: 'mp3', voices: ['/v1/audio/voices'], fixed: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'], port: 8000, clone: 'sesame', extras: ['temperature'] },
  'cosyvoice-fastapi': { label: 'CosyVoice FastAPI server', engine: 'cosyvoice', model: null, format: 'pcm', voices: [], port: 50000, clone: 'clip', extras: ['sampleRate'] },
};
// Default voices per engine when a generic OpenAI-compatible server lists none.
const ENGINE_VOICES = { kokoro: ['af_heart', 'af_bella', 'af_sky', 'am_adam', 'am_michael', 'bf_emma', 'bm_george'], orpheus: ORPHEUS_EN, dia: ['S1', 'S2', 'dialogue'], sesame: ['alloy', 'echo', 'nova'] };
// The engines' own expressive tags and cues, shown as hints in Settings › Voice.
const HINTS = {
  dia: 'Dia speaks dialogue: [S1] and [S2] mark two speakers (pick the "dialogue" voice for a two-person scene), and cues like (laughs), (sighs), (coughs), (gasps) or (clears throat) are performed, not read out.',
  orpheus: 'Orpheus performs the tags <laugh> <chuckle> <sigh> <cough> <sniffle> <groan> <yawn> <gasp>. Cues written as (laughs) or (sighs) are turned into its tags.',
  chatterbox: 'Chatterbox: Exaggeration sets how emotional it sounds (0.5 is normal, up to 2 is dramatic); a lower CFG weight makes it slower and more deliberate.',
  sesame: 'Sesame CSM is made for natural conversation. It has no tags; it can learn a voice from a short clip and the words said in it.',
  kokoro: 'Kokoro is fast and light. On Kokoro-FastAPI voices can be mixed: type af_bella(2)+af_sky(1) as an extra voice.',
  cosyvoice: 'CosyVoice2 speaks in a voice it hears in a short clip: add a voice below with the clip and the words said in it.',
  other: 'Cues like (laughs) and <laugh> are left out for engines that don\'t perform them.',
};

// ---------- settings: one server ----------
const num = (v, lo, hi) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : undefined);
function cleanUrl(u) {
  let x;
  try { x = new URL(String(u || '').trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(x.protocol) || x.username || x.password || !x.hostname) return null;
  x.hash = ''; x.search = '';
  const s = x.href.replace(/\/+$/, '');
  return s.length <= 300 ? s : null;
}
// One server from his settings, cleaned, or a plain reason it can't be saved.
function checkServer(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, message: 'That speech server is empty.' };
  if (!ID_RE.test(String(v.id || ''))) return { ok: false, message: 'That speech server has a bad id.' };
  const url = cleanUrl(v.url);
  if (!url) return { ok: false, message: 'The address must start with http:// or https:// (for example http://100.64.0.5:8880), with no user name or password in it.' };
  const api = Object.hasOwn(APIS, v.api) ? v.api : 'openai';
  const engine = APIS[api].engine || (ENGINES.includes(v.engine) ? v.engine : 'other');
  const name = String(v.name || '').replace(/[\0-\x1f]/g, ' ').trim().slice(0, 60) || APIS[api].label;
  const out = { id: v.id, name, url, api, engine };
  if (typeof v.model === 'string' && MODEL_RE.test(v.model.trim()) && v.model.trim() !== APIS[api].model) out.model = v.model.trim();
  const voices = (Array.isArray(v.voices) ? v.voices : typeof v.voices === 'string' ? v.voices.split(',') : []).map((x) => String(x).trim()).filter((x) => VOICE_RE.test(x)).slice(0, 30);
  if (voices.length) out.voices = [...new Set(voices)];
  const ex = v.extras && typeof v.extras === 'object' && !Array.isArray(v.extras) ? v.extras : {};
  const allowed = APIS[api].extras || [];
  const extras = {};
  if (allowed.includes('exaggeration')) { const n = num(ex.exaggeration, 0.25, 2); if (n !== undefined) extras.exaggeration = n; }
  if (allowed.includes('cfgWeight')) { const n = num(ex.cfgWeight, 0, 1); if (n !== undefined) extras.cfgWeight = n; }
  if (allowed.includes('temperature')) { const n = num(ex.temperature, 0.05, 2); if (n !== undefined) extras.temperature = n; }
  if (allowed.includes('sampleRate')) { const n = num(ex.sampleRate, 8000, 48000); if (n !== undefined) extras.sampleRate = Math.round(n); }
  if (Object.keys(extras).length) out.extras = extras;
  return { ok: true, server: out };
}
const cleanServer = (v) => { const r = checkServer(v); return r.ok ? r.server : null; };
function cleanServers(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const v of list) { const s = cleanServer(v); if (s && !seen.has(s.id)) { seen.add(s.id); out.push(s); } if (out.length >= MAX_SERVERS) break; }
  return out;
}
// His change to the list, merged by id: { <id>: { ...fields } } adds or edits one server (fields
// he didn't send are kept), { <id>: null } removes it. The others are never touched. A server that
// can't be saved throws a plain message, so nothing half-done is written.
function mergeServers(cur, patch) {
  const list = cleanServers(cur);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return list;
  for (const [id, v] of Object.entries(patch)) {
    if (!ID_RE.test(id)) throw new Error('That speech server has a bad id.');
    const i = list.findIndex((x) => x.id === id);
    if (v === null) { if (i >= 0) list.splice(i, 1); continue; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('That speech server is empty.');
    if (i < 0 && list.length >= MAX_SERVERS) throw new Error(`Up to ${MAX_SERVERS} speech servers can be added. Remove one first.`);
    const r = checkServer({ ...(i >= 0 ? list[i] : {}), ...v, id });
    if (!r.ok) throw new Error(r.message);
    if (i >= 0) list[i] = r.server; else list.push(r.server);
  }
  return list;
}
const newId = () => crypto.randomBytes(6).toString('hex');
const secretName = (id) => `speech:${id}`;
// A server whose address is OpenAI's own: the uncensored rule treats it as OpenAI.
function isOpenAIHost(server) {
  try { const h = new URL(server.url).hostname.toLowerCase(); return h === 'openai.com' || h.endsWith('.openai.com'); } catch { return false; }
}
// What the window needs to draw the presets (no addresses, no keys).
function presets() {
  return {
    apis: Object.entries(APIS).map(([id, a]) => ({ id, label: a.label, engine: a.engine, port: a.port || null, clone: Boolean(a.clone), cloneNeedsText: a.clone === 'clip', extras: a.extras || [], fixed: a.fixed || [] })),
    engines: ENGINES.map((id) => ({ id, name: ENGINE_NAMES[id] })),
    hints: HINTS,
  };
}

// ---------- requests ----------
// base + path, without doubling /v1 when he typed an address ending in /v1.
function joinUrl(base, p) {
  const b = String(base).replace(/\/+$/, '');
  const q = b.endsWith('/v1') && p.startsWith('/v1/') ? p.slice(3) : p;
  return b + q;
}
const auth = (key) => (key ? { authorization: `Bearer ${key}` } : {});

// Emotion and non-verbal cues: kept in the form the engine understands, removed for the others.
const CUES = { laugh: /^laugh(s|ing)?$/, chuckle: /^chuckle(s)?$/, sigh: /^sigh(s)?$/, cough: /^cough(s)?$/, sniffle: /^(sniffle(s)?|sniff(s)?)$/, groan: /^groan(s)?$/, yawn: /^yawn(s)?$/, gasp: /^gasp(s)?$/, throat: /^clears? (his |her |their )?throat$/ };
const ORPHEUS_TAG = { laugh: '<laugh>', chuckle: '<chuckle>', sigh: '<sigh>', cough: '<cough>', sniffle: '<sniffle>', groan: '<groan>', yawn: '<yawn>', gasp: '<gasp>' };
const DIA_TAG = { laugh: '(laughs)', chuckle: '(chuckle)', sigh: '(sighs)', cough: '(coughs)', sniffle: '(sniffs)', groan: '(groans)', gasp: '(gasps)', throat: '(clears throat)' };
function cueOf(word) { const w = String(word).toLowerCase().trim(); return Object.keys(CUES).find((k) => CUES[k].test(w)) || null; }
function engineText(engine, text, voice = '') {
  let t = String(text || '').replace(/<([a-z ]{3,20})>|\(([a-z ]{3,20})\)/gi, (m, a, b) => {
    const c = cueOf(a || b);
    if (!c) return a ? ' ' : m; // unknown <tags> go; ordinary (words in brackets) stay
    if (engine === 'orpheus') return ORPHEUS_TAG[c] || ' ';
    if (engine === 'dia') return DIA_TAG[c] || ' ';
    return ' ';
  });
  if (engine === 'dia') {
    if (voice === 'dialogue' && !/\[S[12]\]/.test(t)) t = `[S1] ${t}`;
  } else t = t.replace(/\[S\d\]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

// The request that speaks one part on a server. voice: the voice id from its list (or, for a
// CosyVoice2 clip, { clip }).
function speechRequest({ server, key, voice, text, speed }) {
  const api = APIS[server.api] || APIS.openai;
  const model = server.model || api.model || undefined;
  const ex = server.extras || {};
  const input = engineText(server.engine, text, typeof voice === 'string' ? voice : '').slice(0, 4000);
  const json = (p, body) => ({ url: joinUrl(server.url, p), init: { method: 'POST', redirect: 'error', headers: { ...auth(key), 'content-type': 'application/json' }, body: JSON.stringify(body) }, kind: 'audio' });
  const sp = speed !== undefined && speed !== null && speed !== 1 ? speed : undefined;
  if (server.api === 'cosyvoice-fastapi') {
    const fd = new FormData();
    fd.append('tts_text', input);
    let p;
    if (voice?.clip) { p = '/inference_zero_shot'; fd.append('prompt_text', voice.clip.transcript || ''); fd.append('prompt_wav', new Blob([voice.clip.buf], { type: voice.clip.mime || 'audio/wav' }), voice.clip.file || 'prompt.wav'); }
    else { p = '/inference_sft'; fd.append('spk_id', String(voice || '')); }
    return { url: joinUrl(server.url, p), init: { method: 'POST', redirect: 'error', headers: { ...auth(key) }, body: fd }, kind: 'pcm', rate: ex.sampleRate || 24000 };
  }
  if (server.api === 'chatterbox-server') {
    const ref = String(voice || '').startsWith('ref:');
    const body = { text: input, voice_mode: ref ? 'clone' : 'predefined', output_format: 'wav' };
    if (ref) body.reference_audio_filename = String(voice).slice(4); else if (voice) body.predefined_voice_id = String(voice);
    if (ex.exaggeration !== undefined) body.exaggeration = ex.exaggeration;
    if (ex.cfgWeight !== undefined) body.cfg_weight = ex.cfgWeight;
    if (ex.temperature !== undefined) body.temperature = Math.min(1.5, ex.temperature);
    if (sp !== undefined) body.speed_factor = Math.min(2, Math.max(0.25, sp));
    return json('/tts', body);
  }
  const body = { model, input };
  // chatterbox-tts-api uses its own default voice when none is named.
  if (voice || server.api !== 'chatterbox-api') body.voice = String(voice || 'alloy');
  if (api.format) body.response_format = api.format;
  if (sp !== undefined) body.speed = server.api === 'orpheus-fastapi' ? Math.min(1.5, Math.max(0.5, sp)) : server.api === 'dia-server' ? Math.min(2, Math.max(0.5, sp)) : Math.min(4, Math.max(0.25, sp));
  if (server.api === 'chatterbox-api') {
    if (ex.exaggeration !== undefined) body.exaggeration = ex.exaggeration;
    if (ex.cfgWeight !== undefined) body.cfg_weight = ex.cfgWeight;
    if (ex.temperature !== undefined) body.temperature = ex.temperature;
  }
  if (server.api === 'sesame-openai' && ex.temperature !== undefined) body.temperature = ex.temperature;
  return json('/v1/audio/speech', body);
}

// Raw 16-bit mono PCM (CosyVoice) as a WAV file the window can play.
function pcmToWav(pcm, rate = 24000) {
  const data = pcm.length % 2 ? pcm.subarray(0, pcm.length - 1) : pcm; // whole samples only
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8, 'latin1');
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'latin1'); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// A response body read up to max bytes (null when it is bigger: the rest is never downloaded).
async function readCapped(res, max) {
  const len = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(len) && len > max) { try { await res.body?.cancel?.(); } catch {} return null; }
  if (!res.body || typeof res.body[Symbol.asyncIterator] !== 'function') {
    const b = Buffer.from(await res.arrayBuffer());
    return b.length > max ? null : b;
  }
  const parts = [];
  let n = 0;
  for await (const c of res.body) {
    n += c.length;
    if (n > max) return null; // leaving the loop cancels the download
    parts.push(Buffer.from(c));
  }
  return Buffer.concat(parts);
}
async function readJson(res, max = MAX_JSON) {
  const b = await readCapped(res, max).catch(() => null);
  if (!b) return null;
  try { return JSON.parse(b.toString('utf8')); } catch { return null; }
}

const fail = (message, kind = 'failed') => ({ ok: false, kind, message: String(message).slice(0, 300) });
async function errText(res) {
  const b = await readCapped(res, MAX_ERR).catch(() => null);
  const t = b ? b.toString('utf8') : '';
  let j = null;
  try { j = JSON.parse(t); } catch {}
  const m = j?.detail?.message || (typeof j?.detail === 'string' ? j.detail : null) || j?.error?.message || (typeof j?.error === 'string' ? j.error : null) || j?.message || '';
  return `${res.status}${m ? `: ${String(m).slice(0, 200)}` : ''}`;
}
const redirected = (server) => fail(`${server.name} answered with a redirect to another address. The app never follows redirects (so your key can't be sent somewhere else): put the server's direct address in Settings › Voice.`, 'redirect');
const isRedirect = (res) => res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
function reach(server, e) {
  const why = `${e?.cause?.message || ''} ${e?.message || ''}`;
  if (/redirect/i.test(why)) return redirected(server);
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError' || e?.cause?.name === 'TimeoutError') return fail(`${server.name} took too long to answer.`, 'timeout');
  return fail(`Couldn't reach ${server.name} at ${server.url}: ${e?.cause?.code || e?.cause?.message || e?.message || e}. Is the server running, and is that PC on (and on Tailscale)?`, 'unreachable');
}
const statusFail = async (server, res) => fail(`${server.name}: ${await errText(res)}`, res.status === 401 || res.status === 403 ? 'auth' : 'failed');

// The voices a server offers (its list, the preset's fixed voices, his own extra names, and his
// saved clips for CosyVoice2).
async function listVoices({ server, key, fetchImpl = fetch, clips = [], timeoutMs = TIMEOUT.list }) {
  const api = APIS[server.api] || APIS.openai;
  const out = [];
  const add = (id, name, extra = {}) => { const s = String(id || '').trim(); if (VOICE_RE.test(s) && !out.some((v) => v.id === s)) out.push({ id: s, name: String(name || s).slice(0, 100), ...extra }); };
  let error = null;
  for (const p of api.voices) {
    let res;
    try { res = await fetchImpl(joinUrl(server.url, p), { headers: { ...auth(key), accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); } catch (e) { error = reach(server, e).message; break; }
    if (isRedirect(res)) { error = redirected(server).message; break; }
    if (!res.ok) { if (res.status === 401 || res.status === 403) { error = `${server.name} refused the key (${res.status}). Check the key in its settings.`; break; } continue; }
    const j = await readJson(res);
    const arr = Array.isArray(j) ? j : Array.isArray(j?.voices) ? j.voices : Array.isArray(j?.data) ? j.data : Array.isArray(j?.files) ? j.files : [];
    const ref = p === '/get_reference_files';
    for (const v of arr.slice(0, 300)) {
      if (typeof v === 'string') add(ref ? `ref:${v}` : v, ref ? `${v} (your clip)` : v);
      else if (v && typeof v === 'object') {
        const id = v.id || v.voice_id || v.filename || v.name;
        add(ref ? `ref:${id}` : id, v.display_name || v.name || id, v.language ? { lang: String(v.language).slice(0, 20) } : {});
      }
    }
    if (server.api !== 'chatterbox-server' && arr.length) break; // the first list that answers
  }
  for (const v of api.fixed || []) add(v, v);
  if (!out.length) for (const v of ENGINE_VOICES[server.engine] || []) add(v, v);
  for (const v of server.voices || []) add(v, v);
  for (const c of clips) add(`clip:${c.id}`, `${c.name} (your clip)`, { clip: true });
  if (error && !out.length) return fail(error, 'unreachable');
  if (!out.length) return fail(server.api === 'cosyvoice-fastapi' ? `${server.name} has no voices yet. Add one from a clip (Settings › Voice › Add a voice), or type its speaker names in Edit › Extra voices.` : `${server.name} lists no voices. Type the voice names in Edit › Extra voices.`, 'no_voices');
  return { ok: true, voices: out, warning: error };
}

// ---------- CosyVoice2 clips: kept in the app's data folder (never in settings) ----------
const CLIP_ID = /^[a-f0-9]{10}$/;
const clipsFile = (clipsDir, sid) => path.join(clipsDir, sid, 'clips.json');
// The saved clips, or null when clips.json exists but can't be read (it is then left alone).
function readClipsOrNull(clipsDir, sid) {
  if (!clipsDir || !ID_RE.test(String(sid))) return [];
  let t;
  try { t = fs.readFileSync(clipsFile(clipsDir, sid), 'utf8'); } catch { return []; }
  try { const j = JSON.parse(t); if (!Array.isArray(j)) return null; return j.filter((c) => c && CLIP_ID.test(c.id) && c.consent === true); } catch { return null; }
}
const readClips = (clipsDir, sid) => readClipsOrNull(clipsDir, sid) || [];
function clipFor(clipsDir, sid, voiceId) {
  const m = String(voiceId || '').match(/^clip:([a-f0-9]{10})$/);
  if (!m) return null;
  const c = readClips(clipsDir, sid).find((x) => x.id === m[1]);
  if (!c) return null;
  try { return { ...c, buf: fs.readFileSync(path.join(clipsDir, sid, path.basename(c.file))) }; } catch { return null; }
}
// A removed server's clips go with it (only for an id that is no longer in his settings).
function forgetClips(clipsDir, sid) {
  if (!clipsDir || !ID_RE.test(String(sid))) return false;
  try { fs.rmSync(path.join(clipsDir, sid), { recursive: true, force: true }); return true; } catch { return false; }
}

// Voice cloning on a server: refused without his consent. chatterbox-tts-api keeps the clip in
// its voice library; the Sesame server learns it; CosyVoice2 needs the clip with every request,
// so it is kept in the app's data folder.
async function cloneOnServer({ server, key, name, transcript = '', file, consent, fetchImpl = fetch, clipsDir }) {
  if (consent !== true) return fail('Tick the box first: only your own voice, or a voice you have the speaker\'s permission to use.', 'consent');
  const api = APIS[server?.api];
  if (!api?.clone) return fail(`${server?.name || 'This server'} can't learn a voice from the app. Add the clip with its own web page, then type its file name in Edit › Extra voices.`, 'unsupported');
  const n = String(name || '').replace(/[\0-\x1f]/g, ' ').trim().slice(0, 60);
  if (!n) return fail('Give the voice a name.');
  if (!file?.buf?.length) return fail('Pick a recording of the voice.');
  if (file.buf.length > MAX_CLIP) return fail('The recording is over 20 MB. A clean 10 to 30 second clip is best.');
  if (api.clone === 'clip') {
    const t = String(transcript || '').trim().slice(0, 500);
    if (!t) return fail('CosyVoice2 needs the words said in the clip. Type them in the box.');
    const list = readClipsOrNull(clipsDir, server.id);
    if (!list) return fail('The saved voice clips for this server couldn\'t be read, so nothing was changed. Look at clips.json in the app\'s voice-clips folder.');
    const id = crypto.randomBytes(5).toString('hex');
    const dir = path.join(clipsDir, server.id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const ext = /^(wav|mp3|flac)$/.test(file.ext || '') ? file.ext : 'wav';
    fs.writeFileSync(path.join(dir, `${id}.${ext}`), file.buf, { mode: 0o600 });
    list.push({ id, name: n, transcript: t, file: `${id}.${ext}`, mime: file.mime || 'audio/wav', consent: true, at: new Date().toISOString() });
    atomicWrite(clipsFile(clipsDir, server.id), JSON.stringify(list, null, 1));
    return { ok: true, voice: { id: `clip:${id}`, name: n } };
  }
  const blob = new Blob([file.buf], { type: file.mime || 'audio/wav' });
  const form = () => {
    const fd = new FormData();
    if (api.clone === 'library') { fd.append('voice_name', n.replace(/[^\w.-]+/g, '_')); fd.append('voice_file', blob, file.name || 'voice.wav'); }
    else { fd.append('name', n); fd.append('audio_file', blob, file.name || 'voice.wav'); if (transcript) fd.append('transcript', String(transcript).slice(0, 500)); fd.append('description', 'Added from the Hearth AI Command Center with the owner\'s consent (own voice or permission given).'); }
    return fd;
  };
  const paths = api.clone === 'library' ? ['/v1/voices', '/voices'] : ['/v1/voice-cloning/clone'];
  let res = null;
  for (const p of paths) {
    try { res = await fetchImpl(joinUrl(server.url, p), { method: 'POST', redirect: 'error', headers: { ...auth(key) }, body: form(), signal: AbortSignal.timeout(TIMEOUT.clone) }); } catch (e) { return reach(server, e); }
    if (isRedirect(res)) return redirected(server);
    if (res.status !== 404) break;
  }
  if (!res.ok) return statusFail(server, res);
  const j = (await readJson(res)) || {};
  const id = api.clone === 'library' ? (j.voice?.name || j.name || n.replace(/[^\w.-]+/g, '_')) : (j.voice_id || j.id || j.voice?.id);
  if (!VOICE_RE.test(String(id || ''))) return fail(`${server.name} didn't say which voice it made.`);
  return { ok: true, voice: { id: String(id), name: n } };
}

// Speaks one part: { ok, res, mime } to stream (mp3; the caller caps it at MAX_AUDIO), or
// { ok, buf, mime } whole.
async function speak({ server, key, voice, text, speed, fetchImpl = fetch, signal, clipsDir, timeoutMs = TIMEOUT.speak }) {
  if (!server) return fail('That speech server was removed. Pick another voice in Settings › Voice.');
  let v = voice;
  if (String(voice || '').startsWith('clip:')) {
    const clip = server.api === 'cosyvoice-fastapi' ? clipFor(clipsDir, server.id, voice) : null;
    if (!clip) return fail('That voice clip is gone. Add it again in Settings › Voice.');
    v = { clip };
  } else if (!voice) v = (APIS[server.api]?.fixed || ENGINE_VOICES[server.engine] || [])[0] || (server.voices || [])[0] || '';
  const r = speechRequest({ server, key, voice: v, text, speed });
  const timer = AbortSignal.timeout(timeoutMs);
  let res;
  try { res = await fetchImpl(r.url, { ...r.init, signal: signal ? AbortSignal.any([signal, timer]) : timer }); } catch (e) { return signal?.aborted ? fail('Stopped.', 'stopped') : reach(server, e); }
  if (isRedirect(res)) return redirected(server);
  if (!res.ok) return statusFail(server, res);
  const ct = String(res.headers.get('content-type') || '').toLowerCase();
  if (/json|text\/html|text\/plain/.test(ct)) { const b = await readCapped(res, MAX_ERR).catch(() => null); return fail(`${server.name} answered with text, not sound: ${(b ? b.toString('utf8') : '').slice(0, 160)}`); }
  if (r.kind !== 'pcm' && /audio\/mpeg|audio\/mp3/.test(ct)) {
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > MAX_AUDIO) { try { await res.body?.cancel?.(); } catch {} return fail(`${server.name} sent too much audio.`); }
    return { ok: true, res, mime: 'audio/mpeg' };
  }
  let buf;
  try { buf = await readCapped(res, MAX_AUDIO); } catch (e) { return signal?.aborted ? fail('Stopped.', 'stopped') : reach(server, e); }
  if (!buf) return fail(`${server.name} sent too much audio.`);
  if (buf.length < 100) return fail(`${server.name} made no sound.`);
  if (r.kind === 'pcm') return { ok: true, buf: pcmToWav(buf, r.rate), mime: 'audio/wav' };
  const head = buf.subarray(0, 4).toString('latin1');
  const mime = /^audio\//.test(ct) ? ct.split(';')[0] : head === 'RIFF' ? 'audio/wav' : head === 'OggS' ? 'audio/ogg' : head === 'fLaC' ? 'audio/flac' : 'audio/mpeg';
  return { ok: true, buf, mime };
}

module.exports = { APIS, ENGINES, ENGINE_NAMES, ENGINE_VOICES, HINTS, MAX_SERVERS, MAX_AUDIO, MAX_CLIP, TIMEOUT, ID_RE, checkServer, cleanServer, cleanServers, mergeServers, cleanUrl, newId, secretName, isOpenAIHost, presets, joinUrl, engineText, speechRequest, pcmToWav, readCapped, listVoices, cloneOnServer, readClips, clipFor, forgetClips, speak };

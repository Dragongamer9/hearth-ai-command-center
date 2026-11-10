// Voice chat: speech to text, realistic voices and voice cloning, in the main process.
// - Speech to text: whisper.cpp (or openai-whisper) on this PC when installed (free, private,
//   the default when present), otherwise OpenAI's transcription API with the owner's own key.
// - Voices (text to speech), one provider at a time, picked in Settings › Voice:
//   ElevenLabs (his key, streaming), OpenAI TTS (his key, streaming), or local and free:
//   Kokoro or Piper if installed, else espeak-ng / speech-dispatcher (CPU only).
// - Streamed audio goes to the window over IPC (voice:chunk / voice:end), never through a file.
//   Nothing is kept on disk unless he turns on "Keep voice recordings".
// - The rule for the uncensored teammates (Venice, Civitai, his GPU server): their replies are
//   never sent to OpenAI to be spoken unless he allowed it in Settings › Voice (checked here too).
// - Speech servers (electron/speech-servers.cjs): the free open-source engines (Kokoro,
//   Chatterbox, Sesame CSM, Dia, CosyVoice2, Orpheus) on his own machines. They are his, so the
//   uncensored teammates may be spoken there; only that server's own key is ever sent to it.
// - A voice choice can name a speech server (use), so different characters can use different
//   engines (Dia for the narrator, Kokoro for a character...).
// - Voice cloning (ElevenLabs, Chatterbox, Sesame, CosyVoice2): only with his explicit consent
//   tick, for his own voice or a voice he has permission to use. No presets of real people.
// API endpoints (checked against the providers' docs, November 2026):
//   ElevenLabs: GET https://api.elevenlabs.io/v2/voices, POST /v1/text-to-speech/{voice_id}/stream,
//               POST /v1/voices/add (multipart: name, files), header xi-api-key.
//   OpenAI:     POST https://api.openai.com/v1/audio/speech (model, input, voice, response_format,
//               speed, instructions), POST /v1/audio/transcriptions (multipart: file, model),
//               header Authorization: Bearer.
// - Hearth devices (electron/hearth-devices.cjs): the Kokoro voices and whisper speech to text
//   his Hearth OS machines share. Provider 'hearth' speaks on the best device (falling back down
//   his device order, then to the system voice on this PC); speech to text on Automatic uses a
//   device's whisper first when one is shared, then this PC, then OpenAI. They are his own
//   machines, so the uncensored teammates may be spoken and heard there.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const whisper = require('./ops/voice.cjs');
const servers = require('./speech-servers.cjs');

const ELEVEN = 'https://api.elevenlabs.io';
const OPENAI = 'https://api.openai.com';
const PROVIDERS = ['elevenlabs', 'openai', 'local', 'hearth'];
const UNCENSORED = ['venice', 'civitai', 'gpu', 'hearth'];
const TEAM = ['anthropic', 'openai', 'google', 'xai', 'mistral', 'qwen', 'perplexity', 'deepseek', 'ollama', 'freebuff', 'venice', 'civitai', 'gpu', 'hearth', 'free'];
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
const OPENAI_TTS_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'];
const OPENAI_STT_MODELS = ['gpt-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'];
const ELEVEN_MODELS = ['eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_multilingual_v2'];
// English Kokoro voices (the kokoro-tts CLI's list); the first letter is the accent.
const KOKORO_VOICES = ['af_heart', 'af_bella', 'af_sarah', 'af_nicole', 'af_sky', 'af_nova', 'af_river', 'am_adam', 'am_michael', 'am_eric', 'am_liam', 'am_onyx', 'am_puck', 'bf_emma', 'bf_isabella', 'bf_alice', 'bf_lily', 'bm_george', 'bm_lewis', 'bm_daniel', 'bm_fable'];
const ESPEAK_VOICES = ['en-us', 'en-gb', 'en-us+f3', 'en-us+m3', 'en-gb+f4', 'en-gb-scotland', 'en-029'];
const MAX_TEXT = 4000;

// ---------- settings (read-time defaults; only what the owner changes is saved) ----------
const DEFAULTS = Object.freeze({
  stt: 'auto', // auto = whisper.cpp on this PC when installed, else OpenAI
  tts: 'local', // the voice provider he picked
  turn: 'auto', // auto = hands-free (voice activity detection), ptt = push to talk
  bargeIn: true, // talking over a reply stops it
  narration: 'same', // *asterisk* text: same voice, a narrator voice, or skipped
  openaiForUncensored: false, // let Venice/Civitai/GPU replies go to OpenAI TTS/STT
  keepAudio: false, // keep recordings and spoken replies in the chat's media folder
  elevenModel: 'eleven_flash_v2_5',
  openaiModel: 'gpt-4o-mini-tts',
  sttModel: 'gpt-transcribe',
});
const ELEVEN_ID = /^[A-Za-z0-9]{6,40}$/;
const LOCAL_ID = /^(kokoro|piper|espeak|system):[^\0\r\n]{1,300}$/;
const SERVER_VOICE = /^[^\0\r\n]{1,200}$/;
const SERVER_P = /^server:([a-z0-9]{6,16})$/;
const serverOf = (provider, s) => { const m = String(provider || '').match(SERVER_P); return m ? (s?.servers || []).find((x) => x.id === m[1]) || null : null; };
const num = (v, lo, hi) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, Number(v))) : undefined);
// One voice choice: a voice per provider, plus speed and pitch where supported.
function cleanVoice(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  if (v.elevenlabs && typeof v.elevenlabs === 'object' && ELEVEN_ID.test(String(v.elevenlabs.id || ''))) out.elevenlabs = { id: String(v.elevenlabs.id), name: String(v.elevenlabs.name || '').slice(0, 80) };
  if (OPENAI_VOICES.includes(v.openai)) out.openai = v.openai;
  if (typeof v.local === 'string' && LOCAL_ID.test(v.local)) out.local = v.local;
  if (typeof v.hearth === 'string' && SERVER_VOICE.test(v.hearth)) out.hearth = v.hearth;
  if (v.servers && typeof v.servers === 'object' && !Array.isArray(v.servers)) {
    const sv = {};
    for (const [k, x] of Object.entries(v.servers).slice(0, servers.MAX_SERVERS * 2)) if (servers.ID_RE.test(k) && typeof x === 'string' && SERVER_VOICE.test(x)) sv[k] = x;
    if (Object.keys(sv).length) out.servers = sv;
  }
  if (SERVER_P.test(String(v.use || ''))) out.use = v.use;
  const sp = num(v.speed, 0.5, 2);
  if (sp !== undefined && sp !== 1) out.speed = Math.round(sp * 100) / 100;
  const pi = num(v.pitch, 0.5, 1.5);
  if (pi !== undefined && pi !== 1) out.pitch = Math.round(pi * 100) / 100;
  return Object.keys(out).length ? out : null;
}
function cleanVoices(m) {
  const out = {};
  if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
  for (const k of ['default', 'narrator', ...TEAM]) { const v = cleanVoice(m[k]); if (v) out[k] = v; }
  return out;
}
function cleanSettings(v) {
  const s = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const list = servers.cleanServers(s.servers);
  return {
    stt: ['auto', 'local', 'openai'].includes(s.stt) ? s.stt : DEFAULTS.stt,
    tts: PROVIDERS.includes(s.tts) || serverOf(s.tts, { servers: list }) ? s.tts : DEFAULTS.tts,
    turn: ['auto', 'ptt'].includes(s.turn) ? s.turn : DEFAULTS.turn,
    bargeIn: s.bargeIn !== false,
    narration: ['same', 'narrator', 'skip'].includes(s.narration) ? s.narration : DEFAULTS.narration,
    openaiForUncensored: s.openaiForUncensored === true,
    keepAudio: s.keepAudio === true,
    elevenModel: ELEVEN_MODELS.includes(s.elevenModel) ? s.elevenModel : DEFAULTS.elevenModel,
    openaiModel: OPENAI_TTS_MODELS.includes(s.openaiModel) ? s.openaiModel : DEFAULTS.openaiModel,
    sttModel: OPENAI_STT_MODELS.includes(s.sttModel) ? s.sttModel : DEFAULTS.sttModel,
    voices: cleanVoices(s.voices),
    servers: list,
  };
}
// A change from the window merged into the current settings ({ voices: { venice: null } } clears one).
function mergeSettings(cur, patch) {
  const base = cleanSettings(cur);
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const next = { ...base };
  for (const k of Object.keys(DEFAULTS)) if (k in p) next[k] = p[k];
  // Speech servers merge by id (one server's change never rewrites the others); a server that
  // can't be saved throws a plain message and nothing is written.
  if ('servers' in p) next.servers = servers.mergeServers(base.servers, p.servers);
  if (p.voices && typeof p.voices === 'object') {
    const voices = { ...base.voices };
    for (const [k, v] of Object.entries(p.voices)) {
      if (v === null) { delete voices[k]; continue; }
      const merged = { ...(voices[k] || {}), ...(v && typeof v === 'object' ? v : {}) };
      // A server voice merges per server (picking one server's voice keeps the others').
      if (v?.servers && typeof v.servers === 'object') {
        merged.servers = { ...(voices[k]?.servers || {}), ...v.servers };
        for (const [sk, sv] of Object.entries(v.servers)) if (sv === null) delete merged.servers[sk];
      }
      for (const [kk, vv] of Object.entries(v || {})) if (vv === null) delete merged[kk];
      voices[k] = merged;
    }
    next.voices = voices;
  }
  return cleanSettings(next);
}

// ---------- the uncensored rule ----------
// OpenAI may speak (or hear) a turn from Venice, Civitai or his GPU server only if he allowed it.
function guardOpenAI({ provider, who, uncensoredOnly = false, settings }) {
  const s = cleanSettings(settings);
  if (provider !== 'openai' || s.openaiForUncensored) return { ok: true };
  if (UNCENSORED.includes(who) || uncensoredOnly) {
    return { ok: false, blocked: 'uncensored', message: 'Not sent to OpenAI: replies from Venice, Civitai and your GPU server never go to OpenAI unless you allow it in Settings › Voice. Pick ElevenLabs or a voice on this PC, or allow it there.' };
  }
  return { ok: true };
}

// ---------- text to speak ----------
function cleanSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' (code) ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/<([a-z]{3,12})>/gi, '\u0001$1\u0002')
    .replace(/[#*_`>|~]/g, ' ')
    .replace(/\u0001([a-z]{3,12})\u0002/gi, '<$1>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

// ---------- provider requests (fetchImpl is replaceable in tests) ----------
const fail = (message, kind = 'failed') => ({ ok: false, kind, message: String(message).slice(0, 300) });
async function errText(res) {
  let j = null;
  try { j = await res.json(); } catch {}
  const m = j?.detail?.message || (typeof j?.detail === 'string' ? j.detail : null) || j?.error?.message || `HTTP ${res.status}`;
  return String(m);
}
async function elevenVoices({ key, fetchImpl = fetch, maxPages = 3 }) {
  if (!key) return fail('Add your ElevenLabs API key in Settings › Voice first.', 'no_key');
  const out = [];
  let token = null;
  for (let i = 0; i < maxPages; i++) {
    const u = new URL(`${ELEVEN}/v2/voices`);
    u.searchParams.set('page_size', '100');
    u.searchParams.set('include_total_count', 'false');
    if (token) u.searchParams.set('next_page_token', token);
    const res = await fetchImpl(u.href, { headers: { 'xi-api-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return fail(await errText(res), res.status === 401 ? 'auth' : 'failed');
    const j = await res.json();
    for (const v of j.voices || []) if (ELEVEN_ID.test(String(v.voice_id || ''))) out.push({ id: v.voice_id, name: String(v.name || v.voice_id).slice(0, 80), category: String(v.category || ''), labels: v.labels && typeof v.labels === 'object' ? Object.fromEntries(Object.entries(v.labels).slice(0, 6).map(([a, b]) => [String(a).slice(0, 20), String(b).slice(0, 30)])) : {}, preview: /^https:\/\//.test(String(v.preview_url || '')) ? v.preview_url : null });
    if (!j.has_more || !j.next_page_token) break;
    token = j.next_page_token;
  }
  return { ok: true, voices: out };
}
function elevenRequest({ key, voiceId, text, model = DEFAULTS.elevenModel, speed }) {
  const u = `${ELEVEN}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`;
  const body = { text, model_id: ELEVEN_MODELS.includes(model) ? model : DEFAULTS.elevenModel };
  // ElevenLabs takes speed in voice_settings; 0.7–1.2 is the range its app offers.
  if (speed !== undefined && speed !== 1) body.voice_settings = { stability: 0.5, similarity_boost: 0.75, speed: Math.min(1.2, Math.max(0.7, speed)) };
  return { url: u, init: { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' }, body: JSON.stringify(body) } };
}
function openaiSpeechRequest({ key, voice, text, model = DEFAULTS.openaiModel, speed, instructions }) {
  const m = OPENAI_TTS_MODELS.includes(model) ? model : DEFAULTS.openaiModel;
  const body = { model: m, input: text.slice(0, 4096), voice: OPENAI_VOICES.includes(voice) ? voice : 'alloy', response_format: 'mp3' };
  if (speed !== undefined && speed !== 1) body.speed = Math.min(4, Math.max(0.25, speed));
  if (instructions && m.startsWith('gpt-')) body.instructions = String(instructions).slice(0, 1000);
  return { url: `${OPENAI}/v1/audio/speech`, init: { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) } };
}
// Starts a streaming request; resolves when the headers are in (or with a plain error).
async function startStream({ provider, key, voiceId, text, settings, speed, fetchImpl = fetch, signal }) {
  if (!key) return fail(`Add your ${provider === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI'} API key in Settings › Voice first.`, 'no_key');
  const s = cleanSettings(settings);
  const r = provider === 'elevenlabs'
    ? (ELEVEN_ID.test(String(voiceId || '')) ? elevenRequest({ key, voiceId, text, model: s.elevenModel, speed }) : null)
    : openaiSpeechRequest({ key, voice: voiceId, text, model: s.openaiModel, speed });
  if (!r) return fail('Pick an ElevenLabs voice first (Settings › Voice, or the character\'s editor).');
  let res;
  try { res = await fetchImpl(r.url, { ...r.init, signal }); } catch (e) { return fail(e?.name === 'AbortError' ? 'Stopped.' : `Couldn't reach ${provider === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI'}: ${e.message}`); }
  if (!res.ok) return fail(await errText(res), res.status === 401 ? 'auth' : res.status === 429 ? 'limit' : 'failed');
  return { ok: true, res, mime: 'audio/mpeg' };
}
async function transcribeOpenAI({ key, buf, mime = 'audio/webm', model = DEFAULTS.sttModel, fetchImpl = fetch }) {
  if (!key) return fail('Add your OpenAI API key (Settings › Voice) or install whisper.cpp.', 'no_key');
  if (!buf?.length) return fail('Nothing was recorded.');
  if (buf.length > 25 * 1024 * 1024) return fail('The recording is over 25 MB.');
  const fd = new FormData();
  const ext = /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : /mp4|m4a/.test(mime) ? 'm4a' : 'webm';
  fd.append('file', new Blob([buf], { type: mime }), `speech.${ext}`);
  fd.append('model', OPENAI_STT_MODELS.includes(model) ? model : DEFAULTS.sttModel);
  let res;
  try { res = await fetchImpl(`${OPENAI}/v1/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(120000) }); } catch (e) { return fail(`Couldn't reach OpenAI: ${e.message}`); }
  if (!res.ok) return fail(await errText(res), res.status === 401 ? 'auth' : 'failed');
  let j = null;
  try { j = await res.json(); } catch {}
  return { ok: true, text: whisper.cleanTranscript(j?.text || '') };
}
// Instant voice cloning: only with his explicit consent, for a voice he has the right to use.
async function elevenClone({ key, name, files, consent, fetchImpl = fetch }) {
  if (consent !== true) return fail('Tick the box first: only your own voice, or a voice you have the speaker\'s permission to use.', 'consent');
  if (!key) return fail('Add your ElevenLabs API key in Settings › Voice first.', 'no_key');
  const n = String(name || '').trim().slice(0, 60);
  if (!n) return fail('Give the voice a name.');
  if (!Array.isArray(files) || !files.length) return fail('Pick one or more recordings of the voice.');
  const fd = new FormData();
  fd.append('name', n);
  fd.append('description', 'Added from the Hearth AI Command Center with the owner\'s consent (own voice or permission given).');
  for (const f of files.slice(0, 5)) fd.append('files', new Blob([f.buf], { type: f.mime || 'audio/mpeg' }), f.name || 'sample.mp3');
  let res;
  try { res = await fetchImpl(`${ELEVEN}/v1/voices/add`, { method: 'POST', headers: { 'xi-api-key': key }, body: fd, signal: AbortSignal.timeout(180000) }); } catch (e) { return fail(`Couldn't reach ElevenLabs: ${e.message}`); }
  if (!res.ok) return fail(await errText(res), res.status === 401 ? 'auth' : 'failed');
  const j = await res.json().catch(() => ({}));
  if (!ELEVEN_ID.test(String(j.voice_id || ''))) return fail('ElevenLabs didn\'t return a voice.');
  return { ok: true, voice: { id: j.voice_id, name: n }, requiresVerification: j.requires_verification === true };
}

// ---------- on this PC ----------
const listDir = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
function kokoroDirs(home) { return [path.join(home, '.local', 'share', 'kokoro'), path.join(home, '.local', 'share', 'kokoro-tts'), path.join(home, '.cache', 'kokoro'), path.join(home, 'kokoro'), path.join(home, 'kokoro-tts'), '/usr/share/kokoro', '/usr/local/share/kokoro']; }
function piperDirs(home) { return [path.join(home, '.local', 'share', 'piper'), path.join(home, '.local', 'share', 'piper-voices'), path.join(home, '.cache', 'piper'), path.join(home, 'piper'), path.join(home, 'piper-voices'), '/usr/share/piper-voices', '/usr/local/share/piper-voices', '/usr/share/piper/voices']; }
// find(name) -> path|null; list(dir) -> names.
function localTools({ find, list = listDir, home = os.homedir() } = {}) {
  const out = { kokoro: null, piper: null, espeak: null, spd: null, notes: [] };
  const kbin = find('kokoro-tts');
  if (kbin) {
    const dir = kokoroDirs(home).find((d) => { const n = list(d); return n.includes('kokoro-v1.0.onnx') && n.includes('voices-v1.0.bin'); });
    if (dir) out.kokoro = { bin: kbin, dir, voices: KOKORO_VOICES.slice() };
    else out.notes.push('Kokoro is installed but its model files (kokoro-v1.0.onnx and voices-v1.0.bin) weren\'t found; put them in ~/.local/share/kokoro');
  }
  const pbin = find('piper') || find('piper-tts');
  if (pbin) {
    const models = [];
    for (const d of piperDirs(home)) {
      for (const n of list(d)) {
        if (n.endsWith('.onnx')) models.push(path.join(d, n));
        else if (!n.includes('.')) for (const m of list(path.join(d, n))) if (m.endsWith('.onnx')) models.push(path.join(d, n, m));
      }
    }
    if (models.length) out.piper = { bin: pbin, models: [...new Set(models)].slice(0, 60) };
    else out.notes.push('Piper is installed but no voice (.onnx) was found; put one in ~/.local/share/piper');
  }
  const ebin = find('espeak-ng') || find('espeak');
  if (ebin) out.espeak = { bin: ebin, voices: ESPEAK_VOICES.slice() };
  const sbin = find('spd-say');
  if (sbin) out.spd = { bin: sbin };
  return out;
}
function localVoices(tools) {
  const v = [];
  if (tools.kokoro) for (const k of tools.kokoro.voices) v.push({ id: `kokoro:${k}`, name: `${k.slice(3).replace(/^./, (c) => c.toUpperCase())} (Kokoro, ${k[0] === 'b' ? 'British' : 'American'} ${k[1] === 'f' ? 'female' : 'male'})`, engine: 'kokoro' });
  if (tools.piper) for (const m of tools.piper.models) v.push({ id: `piper:${m}`, name: `${path.basename(m, '.onnx')} (Piper)`, engine: 'piper' });
  if (tools.espeak) for (const e of tools.espeak.voices) v.push({ id: `espeak:${e}`, name: `${e} (espeak-ng)`, engine: 'espeak', pitch: true });
  return v;
}
// The command for one local voice (null = not an installed voice). Paths come only from what
// localTools found, never from the window.
function localCommand(tools, id, { speed = 1, pitch = 1, out }) {
  const m = String(id || '').match(/^(kokoro|piper|espeak):(.+)$/);
  if (!m) return null;
  const [, engine, v] = m;
  if (engine === 'kokoro' && tools.kokoro && tools.kokoro.voices.includes(v)) {
    return { bin: tools.kokoro.bin, args: ['-', out, '--voice', v, '--speed', String(Math.min(2, Math.max(0.5, speed))), '--lang', v[0] === 'b' ? 'en-gb' : 'en-us', '--format', 'wav'], cwd: tools.kokoro.dir, file: out };
  }
  if (engine === 'piper' && tools.piper && tools.piper.models.includes(v)) {
    const args = ['-m', v, '-f', out];
    if (speed !== 1) args.push('--length_scale', String(Math.round((1 / Math.min(2, Math.max(0.5, speed))) * 100) / 100));
    return { bin: tools.piper.bin, args, file: out };
  }
  if (engine === 'espeak' && tools.espeak && tools.espeak.voices.includes(v)) {
    return { bin: tools.espeak.bin, args: ['--stdout', '-v', v, '-s', String(Math.round(175 * Math.min(2, Math.max(0.5, speed)))), '-p', String(Math.round(Math.min(99, Math.max(0, 50 * pitch)))), '--stdin'], stdout: true };
  }
  return null;
}
function runLocal(cmd, text, { timeoutMs = 90000, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawnImpl(cmd.bin, cmd.args, { cwd: cmd.cwd, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { resolve(fail(`Couldn't start ${path.basename(cmd.bin)}: ${e.message}`)); return; }
    const chunks = [];
    let err = '';
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
    child.stdout.on('data', (d) => { if (cmd.stdout) chunks.push(d); });
    child.stderr.on('data', (d) => { err = `${err}${d}`.slice(-2000); });
    child.on('error', (e) => { clearTimeout(t); resolve(fail(`${path.basename(cmd.bin)}: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(t);
      let buf = null;
      if (cmd.stdout) buf = Buffer.concat(chunks);
      else { try { buf = fs.readFileSync(cmd.file); } catch {} try { fs.rmSync(cmd.file, { force: true }); } catch {} }
      if (!buf?.length) resolve(fail(`${path.basename(cmd.bin)} made no sound${code ? ` (exit ${code}): ${err.split('\n').filter(Boolean).slice(-1)[0] || ''}` : ''}`));
      else resolve({ ok: true, buf, mime: 'audio/wav' });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(text);
  });
}

// ---------- local speech to text (nothing kept) ----------
function execFile(bin, args, { timeoutMs = 180000, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try { child = spawnImpl(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { resolve({ ok: false, out, err: e.message }); return; }
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err = `${err}${d}`.slice(-4000); });
    child.on('error', (e) => { clearTimeout(t); resolve({ ok: false, out, err: e.message }); });
    child.on('close', (code) => { clearTimeout(t); resolve({ ok: code === 0, out, err }); });
  });
}
async function transcribeLocal({ buf, tool, ffmpeg, run = execFile }) {
  if (!tool?.tool) return fail(tool?.missing || 'whisper.cpp isn\'t installed.', 'no_tool');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-talk-'));
  try {
    fs.chmodSync(dir, 0o700);
    const src = path.join(dir, 'speech.webm');
    fs.writeFileSync(src, buf, { mode: 0o600 });
    if (tool.tool === 'whisper.cpp') {
      if (!ffmpeg) return fail('whisper.cpp needs ffmpeg to read the recording; install ffmpeg.', 'no_tool');
      const wav = path.join(dir, 'speech.wav');
      const c = await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeoutMs: 60000 });
      if (!c.ok) return fail('ffmpeg couldn\'t read the recording.');
      const r = await run(tool.bin, whisper.cppArgs(tool.model, wav), { timeoutMs: 180000 });
      return { ok: true, text: whisper.cleanTranscript(r.out) };
    }
    const r = await run(tool.bin, whisper.pyArgs(src, dir), { timeoutMs: 300000 });
    let text = '';
    try { text = whisper.cleanTranscript(fs.readFileSync(path.join(dir, 'speech.txt'), 'utf8')); } catch {}
    return text || r.ok ? { ok: true, text } : fail('whisper couldn\'t transcribe it.');
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

// Which speech-to-text this turn uses (and why), or a plain refusal.
function sttRoute({ settings, local, hasOpenAI, uncensoredOnly = false }) {
  const s = cleanSettings(settings);
  const localOk = Boolean(local?.tool);
  if (s.stt === 'local' || (s.stt === 'auto' && localOk)) {
    if (localOk) return { ok: true, via: 'local', label: `${local.tool} on this PC (private, free)` };
    return fail(local?.missing || 'whisper.cpp isn\'t installed.', 'no_tool');
  }
  if (!hasOpenAI) return fail('Speech to text needs whisper.cpp on this PC or your OpenAI API key (Settings › Voice).', 'no_key');
  const g = guardOpenAI({ provider: 'openai', who: null, uncensoredOnly, settings: s });
  if (!g.ok) return { ...fail('This chat talks only to Venice, Civitai or your GPU server, so your voice isn\'t sent to OpenAI. Install whisper.cpp, or allow OpenAI in Settings › Voice.', 'uncensored') };
  return { ok: true, via: 'openai', label: `OpenAI (${s.sttModel}): your recording goes to OpenAI` };
}

// ---------- IPC ----------
function register(d) {
  const { handle, secrets, readSettings, send, which, media, mediaRoot, dialog, getWindow, clipsDir = null, fetchImpl = (...a) => fetch(...a), hearth = null } = d;
  const hearthOn = () => Boolean(hearth?.configured?.());
  const settings = () => cleanSettings(readSettings().voice);
  const find = (b) => which([b]);
  let toolsCache = null;
  const tools = (fresh = false) => { if (fresh || !toolsCache || Date.now() - toolsCache.at > 60000) toolsCache = { at: Date.now(), t: localTools({ find }) }; return toolsCache.t; };
  const whisperTool = () => whisper.detect({ find, list: listDir });
  let elevenCache = null;
  const streams = new Map();

  handle('voice:status', async () => {
    const t = tools(true);
    const w = whisperTool();
    const s = settings();
    const st = sttRoute({ settings: s, local: w, hasOpenAI: secrets.has('openai') });
    return {
      encryption: await secrets.available(),
      keys: { elevenlabs: secrets.has('elevenlabs'), openai: secrets.has('openai') },
      stt: { local: w.tool ? { tool: w.tool } : { tool: null, missing: w.missing }, using: st.ok ? st.label : null, problem: st.ok ? null : st.message, ffmpeg: Boolean(find('ffmpeg')) },
      local: { kokoro: Boolean(t.kokoro), piper: t.piper ? t.piper.models.length : 0, espeak: t.espeak ? path.basename(t.espeak.bin) : null, spd: Boolean(t.spd), notes: t.notes },
      openaiVoices: OPENAI_VOICES, elevenModels: ELEVEN_MODELS, openaiModels: OPENAI_TTS_MODELS, sttModels: OPENAI_STT_MODELS,
      // Speech servers: whether each has its own key saved (never the key), and the presets.
      servers: Object.fromEntries(s.servers.map((x) => [x.id, { key: secrets.has(servers.secretName(x.id)), openaiHost: servers.isOpenAIHost(x) }])),
      serverPresets: servers.presets(),
      // Hearth devices: whether any device shares Kokoro voices or whisper right now.
      hearth: hearthOn() ? await hearth.status({ probe: true }).then((h) => ({ configured: true, voice: Boolean(h.has?.voice), stt: Boolean(h.has?.stt), error: h.error || null })).catch(() => ({ configured: true, voice: false, stt: false })) : { configured: false, voice: false, stt: false },
    };
  });
  const serverKey = (srv) => secrets.get(servers.secretName(srv.id)) || null;
  const serverCache = new Map();
  handle('voice:voices', async (provider, fresh) => {
    if (SERVER_P.test(String(provider || ''))) {
      const srv = serverOf(provider, settings());
      if (!srv) return fail('That speech server was removed.', 'gone');
      const c = serverCache.get(srv.id);
      if (!fresh && c && Date.now() - c.at < 5 * 60000 && c.url === srv.url) return c.r;
      const r = await servers.listVoices({ server: srv, key: serverKey(srv), fetchImpl, clips: servers.readClips(clipsDir, srv.id) });
      if (r.ok) serverCache.set(srv.id, { at: Date.now(), r, url: srv.url });
      return r;
    }
    if (provider === 'openai') return { ok: true, voices: OPENAI_VOICES.map((v) => ({ id: v, name: v[0].toUpperCase() + v.slice(1) })) };
    if (provider === 'local') return { ok: true, voices: localVoices(tools()) };
    if (provider === 'hearth') return hearthOn() ? hearth.voices() : fail('Set up Hearth devices in Settings › Accounts first.', 'not_set');
    if (provider !== 'elevenlabs') return fail('Unknown provider.');
    if (!fresh && elevenCache && Date.now() - elevenCache.at < 10 * 60000) return elevenCache.r;
    const r = await elevenVoices({ key: secrets.get('elevenlabs'), fetchImpl });
    if (r.ok) elevenCache = { at: Date.now(), r };
    return r;
  });
  handle('voice:transcribe', async (data, o = {}) => {
    const buf = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data || []);
    if (buf.length < 1000) return fail('Nothing was heard.');
    if (buf.length > 25 * 1024 * 1024) return fail('The recording is too long.');
    const s = settings();
    // Automatic: a Hearth device's whisper first when one is shared (his own machine).
    let hearthNote = null;
    if (s.stt === 'auto' && hearthOn()) {
      const h = await hearth.transcribe({ buf, mime: String(o.mime || 'audio/webm') });
      if (h.ok) return { ok: true, text: whisper.cleanTranscript(h.text), via: h.via, item: null };
      hearthNote = h.message;
    }
    const w = whisperTool();
    const route = sttRoute({ settings: s, local: w, hasOpenAI: secrets.has('openai'), uncensoredOnly: o.uncensoredOnly === true });
    if (!route.ok) return route;
    const r = route.via === 'local'
      ? await transcribeLocal({ buf, tool: w, ffmpeg: find('ffmpeg') })
      : await transcribeOpenAI({ key: secrets.get('openai'), buf, mime: String(o.mime || 'audio/webm'), model: s.sttModel, fetchImpl });
    let item = null;
    if (r.ok && s.keepAudio && o.chatId && media?.CHAT_RE.test(String(o.chatId))) { try { item = media.storeBuffer(mediaRoot, String(o.chatId), `voice-${Date.now()}.webm`, buf); } catch {} }
    return r.ok ? { ok: true, text: r.text, via: route.label, item, ...(hearthNote ? { note: `Hearth devices: ${hearthNote}` } : {}) } : { ...r, via: route.label };
  });
  // Speak one part. Remote voices stream over voice:chunk; local voices come back whole.
  handle('voice:speak', async (o = {}) => {
    const s = settings();
    const provider = PROVIDERS.includes(o.provider) || SERVER_P.test(String(o.provider || '')) ? o.provider : s.tts;
    // The server comes from his settings by id; the window never gives an address.
    const srv = SERVER_P.test(provider) ? serverOf(provider, s) : null;
    if (SERVER_P.test(provider) && !srv) return fail('That speech server was removed. Pick another voice in Settings › Voice.', 'gone');
    let text = cleanSpeech(o.text);
    // Expressive <tags> are for the engines that perform them (speech servers); others skip them.
    if (!srv) text = text.replace(/<[a-z]{3,12}>/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return fail('Nothing to say.');
    // A server at OpenAI's own address counts as OpenAI for the uncensored rule.
    const g = guardOpenAI({ provider: srv ? (servers.isOpenAIHost(srv) ? 'openai' : 'server') : provider, who: String(o.who || ''), settings: s });
    if (!g.ok) return g;
    const speed = num(o.speed, 0.5, 2);
    const keep = s.keepAudio && o.chatId && media?.CHAT_RE.test(String(o.chatId)) ? String(o.chatId) : null;
    // Hearth devices: Kokoro on the best device, down his order; when none can, the system voice here.
    if (provider === 'hearth') {
      const r = hearthOn() ? await hearth.speak({ voice: typeof o.voice === 'string' ? o.voice : '', text, speed }) : fail('Hearth devices aren\'t set up.', 'not_set');
      if (r.ok) {
        if (keep) { try { media.storeBuffer(mediaRoot, keep, `reply-${Date.now()}.${/wav/.test(r.mime) ? 'wav' : 'mp3'}`, r.buf); } catch {} }
        return { ok: true, mime: r.mime, audio: r.buf, via: r.via };
      }
      if (r.kind === 'cancelled') return r;
      return { ok: true, system: true, notice: `No Hearth device could speak (${r.message}), so your system voice is used.` };
    }
    if (provider === 'local') {
      const id = String(o.voice || '');
      if (id.startsWith('system:') || !id) {
        // speech-dispatcher speaks by itself; the window uses Web Speech when it has voices.
        return { ok: true, system: true };
      }
      const t = tools();
      const cmd = localCommand(t, id, { speed: speed ?? 1, pitch: num(o.pitch, 0.5, 1.5) ?? 1, out: path.join(os.tmpdir(), `hearth-say-${crypto.randomBytes(5).toString('hex')}.wav`) });
      if (!cmd) return fail('That voice isn\'t installed on this PC any more. Pick another in Settings › Voice.');
      const r = await runLocal(cmd, text);
      if (r.ok && keep) { try { media.storeBuffer(mediaRoot, keep, `reply-${Date.now()}.wav`, r.buf); } catch {} }
      return r.ok ? { ok: true, mime: r.mime, audio: r.buf, via: id.split(':')[0] } : r;
    }
    const token = crypto.randomBytes(8).toString('hex');
    const ctl = new AbortController();
    streams.set(token, ctl);
    if (srv) {
      // Only this server's own key is ever sent to it.
      const voiceId = typeof o.voice === 'string' && o.voice.length <= 200 ? o.voice : '';
      const r = await servers.speak({ server: srv, key: serverKey(srv), voice: voiceId, text, speed, fetchImpl, signal: ctl.signal, clipsDir });
      if (!r.ok || r.buf) streams.delete(token);
      if (!r.ok) return r;
      if (r.buf) {
        if (keep) { try { media.storeBuffer(mediaRoot, keep, `reply-${Date.now()}.${/wav/.test(r.mime) ? 'wav' : /ogg/.test(r.mime) ? 'ogg' : /flac/.test(r.mime) ? 'flac' : 'mp3'}`, r.buf); } catch {} }
        return { ok: true, mime: r.mime, audio: r.buf, via: provider };
      }
      pipe(token, ctl, r.res, keep);
      return { ok: true, token, mime: r.mime, via: provider };
    }
    const r = await startStream({ provider, key: secrets.get(provider), voiceId: o.voice, text, settings: s, speed, fetchImpl, signal: ctl.signal });
    if (!r.ok) { streams.delete(token); return r; }
    pipe(token, ctl, r.res, keep);
    return { ok: true, token, mime: r.mime, via: provider };
  });
  // A streamed reply to the window, chunk by chunk, stopped past servers.MAX_AUDIO.
  function pipe(token, ctl, res, keep) {
    (async () => {
      const kept = [];
      let n = 0;
      let error = null;
      try {
        for await (const chunk of res.body) {
          if (ctl.signal.aborted) break;
          const b = Buffer.from(chunk);
          n += b.length;
          if (n > servers.MAX_AUDIO) { error = 'The voice sent too much audio, so the rest was stopped.'; ctl.abort(); break; }
          if (keep) kept.push(b);
          send('voice:chunk', { token, data: b });
        }
        send('voice:end', { token, error, stopped: ctl.signal.aborted && !error });
        if (keep && !ctl.signal.aborted) { try { media.storeBuffer(mediaRoot, keep, `reply-${Date.now()}.mp3`, Buffer.concat(kept)); } catch {} }
      } catch (e) { send('voice:end', { token, error: ctl.signal.aborted ? error : String(e.message || e).slice(0, 200), stopped: ctl.signal.aborted && !error }); }
      streams.delete(token);
    })();
  }

  // ---------- speech servers (Settings › Voice) ----------
  // Every call names a saved server by id; its address comes from his settings only.
  const savedServer = (id) => (servers.ID_RE.test(String(id || '')) ? settings().servers.find((x) => x.id === id) || null : null);
  // The server's own key, saved encrypted (never in settings). null or '' removes it.
  handle('voice:serverKey', async (id, key) => {
    const srv = savedServer(id);
    if (!srv) return fail('Save the server first, then add its key.');
    const name = servers.secretName(srv.id);
    if (key === null || key === '') { secrets.remove(name); serverCache.delete(srv.id); return { ok: true, removed: true }; }
    const k = String(key || '').trim();
    if (!k || k.length > 500 || /[\s\0-\x1f]/.test(k)) return fail('That key doesn\'t look right (no spaces, up to 500 characters).');
    try { await secrets.set(name, k); } catch (e) { return fail(e?.message || e, 'no_keyring'); }
    serverCache.delete(srv.id);
    return { ok: true };
  });
  // Test: list its voices, then speak one short line with the first voice.
  handle('voice:serverTest', async (id) => {
    const srv = savedServer(id);
    if (!srv) return fail('That speech server was removed.', 'gone');
    const key = serverKey(srv);
    const t0 = Date.now();
    const lv = await servers.listVoices({ server: srv, key, fetchImpl, clips: servers.readClips(clipsDir, srv.id) });
    if (!lv.ok) return { ...lv, step: 'voices' };
    serverCache.set(srv.id, { at: Date.now(), r: lv, url: srv.url });
    const first = lv.voices.find((v) => !v.clip) || lv.voices[0];
    const r = await servers.speak({ server: srv, key, voice: first.id, text: 'Hello! This is a test of your speech server.', fetchImpl, clipsDir, timeoutMs: servers.TIMEOUT.test });
    if (!r.ok) return { ...r, step: 'speak', voices: lv.voices.length };
    let audio = r.buf;
    if (!audio) { audio = await servers.readCapped(r.res, servers.MAX_AUDIO).catch(() => null); if (!audio) return { ...fail(`${srv.name} sent too much audio.`), step: 'speak' }; }
    return { ok: true, voices: lv.voices.length, voice: first.name, warning: lv.warning || null, audio, mime: r.mime, ms: Date.now() - t0 };
  });
  // Learn a voice on a server that can (with his consent tick, through the same rule as ElevenLabs).
  handle('voice:serverClone', async (o = {}) => {
    if (o.consent !== true) return fail('Tick the box first: only your own voice, or a voice you have the speaker\'s permission to use.', 'consent');
    const srv = savedServer(o.id);
    if (!srv) return fail('That speech server was removed.', 'gone');
    if (!servers.APIS[srv.api]?.clone) return fail(`${srv.name} can't learn a voice from the app.`, 'unsupported');
    const pick = await dialog.showOpenDialog(getWindow(), { title: 'A recording of the voice (your own, or one you have permission to use)', properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac'] }] });
    if (pick.canceled || !pick.filePaths?.length) return { ok: false, cancelled: true };
    const f = pick.filePaths[0];
    const st = fs.statSync(f);
    if (st.size > servers.MAX_CLIP) return fail(`${path.basename(f)} is over 20 MB. A clean 10 to 30 second clip is best.`);
    const ext = path.extname(f).slice(1).toLowerCase();
    const file = { name: path.basename(f), ext, buf: fs.readFileSync(f), mime: { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac' }[ext] || 'audio/wav' };
    const r = await servers.cloneOnServer({ server: srv, key: serverKey(srv), name: o.name, transcript: o.transcript, file, consent: true, fetchImpl, clipsDir });
    if (r.ok) serverCache.delete(srv.id);
    return r;
  });
  // After he removed a server from his settings: its key and saved clips go too.
  handle('voice:serverForget', (id) => {
    if (!servers.ID_RE.test(String(id || ''))) return fail('bad id');
    if (savedServer(id)) return fail('That server is still in your settings.');
    try { secrets.remove(servers.secretName(id)); } catch {}
    servers.forgetClips(clipsDir, id);
    serverCache.delete(id);
    return { ok: true };
  });
  handle('voice:cancel', (token) => { const c = streams.get(String(token)); if (c) { c.abort(); streams.delete(String(token)); } return { ok: true }; });
  handle('voice:stopAll', () => { for (const c of streams.values()) c.abort(); streams.clear(); return { ok: true }; });
  handle('voice:clone', async (o = {}) => {
    if (o.consent !== true) return fail('Tick the box first: only your own voice, or a voice you have the speaker\'s permission to use.', 'consent');
    const pick = await dialog.showOpenDialog(getWindow(), { title: 'Recordings of the voice (your own, or one you have permission to use)', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'flac'] }] });
    if (pick.canceled || !pick.filePaths?.length) return { ok: false, cancelled: true };
    const files = [];
    for (const f of pick.filePaths.slice(0, 5)) {
      const st = fs.statSync(f);
      if (st.size > 10 * 1024 * 1024) return fail(`${path.basename(f)} is over 10 MB.`);
      const ext = path.extname(f).slice(1).toLowerCase();
      files.push({ name: path.basename(f), buf: fs.readFileSync(f), mime: { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac' }[ext] || 'application/octet-stream' });
    }
    const r = await elevenClone({ key: secrets.get('elevenlabs'), name: o.name, files, consent: true, fetchImpl });
    if (r.ok) elevenCache = null;
    return r;
  });
  return { stop() { for (const c of streams.values()) c.abort(); streams.clear(); } };
}

module.exports = { register, serverOf, cleanSettings, mergeSettings, cleanVoice, cleanVoices, guardOpenAI, cleanSpeech, elevenVoices, elevenRequest, openaiSpeechRequest, startStream, transcribeOpenAI, elevenClone, localTools, localVoices, localCommand, runLocal, transcribeLocal, sttRoute, DEFAULTS, PROVIDERS, UNCENSORED, OPENAI_VOICES, KOKORO_VOICES, ELEVEN_MODELS, OPENAI_TTS_MODELS, OPENAI_STT_MODELS };

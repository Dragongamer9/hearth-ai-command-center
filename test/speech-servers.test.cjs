// Speech servers: the free, open-source voices (electron/speech-servers.cjs and its wiring in
// electron/voice-chat.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const ss = require('../electron/speech-servers.cjs');
const vc = require('../electron/voice-chat.cjs');
const { diffSettings, applyChanges } = require('../electron/settings-log.cjs');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-speech-test-'));
const srv = (api, extra = {}) => ss.cleanServer({ id: 'abc123def456', name: 'Home', url: 'http://100.64.0.5:8880', api, ...extra });

// A local HTTP server standing in for a speech server: records every request.
async function fakeServer(reply) {
  const seen = [];
  const s = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { const r = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) }; seen.push(r); reply(r, res); });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { seen, url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => { s.closeAllConnections?.(); s.close(r); }) };
}

test('Request building: each preset gets its own documented request', () => {
  const body = (r) => JSON.parse(r.init.body);
  // Kokoro-FastAPI: OpenAI-style, mp3, speed.
  let r = ss.speechRequest({ server: srv('kokoro-fastapi'), voice: 'af_bella(2)+af_sky(1)', text: 'Hi (laughs) there', speed: 1.2 });
  assert.equal(r.url, 'http://100.64.0.5:8880/v1/audio/speech');
  assert.deepEqual(body(r), { model: 'kokoro', input: 'Hi there', voice: 'af_bella(2)+af_sky(1)', response_format: 'mp3', speed: 1.2 });
  assert.equal(r.init.redirect, 'error');
  // An address ending in /v1 doesn't double it.
  assert.equal(ss.speechRequest({ server: srv('openai', { url: 'http://h:1/v1/', engine: 'kokoro' }), voice: 'x', text: 'a' }).url, 'http://h:1/v1/audio/speech');
  // chatterbox-tts-api: exaggeration, cfg_weight, temperature; no voice = its own default.
  r = ss.speechRequest({ server: srv('chatterbox-api', { extras: { exaggeration: 0.9, cfgWeight: 0.3, temperature: 0.7 } }), voice: '', text: 'Hello' });
  assert.deepEqual(body(r), { model: 'chatterbox', input: 'Hello', exaggeration: 0.9, cfg_weight: 0.3, temperature: 0.7 });
  // Chatterbox-TTS-Server: its own /tts, predefined or a reference clip.
  r = ss.speechRequest({ server: srv('chatterbox-server'), voice: 'ref:me.wav', text: 'Hello', speed: 1.5 });
  assert.equal(r.url, 'http://100.64.0.5:8880/tts');
  assert.deepEqual(body(r), { text: 'Hello', voice_mode: 'clone', output_format: 'wav', reference_audio_filename: 'me.wav', speed_factor: 1.5 });
  assert.equal(body(ss.speechRequest({ server: srv('chatterbox-server'), voice: 'Emily.wav', text: 'x' })).predefined_voice_id, 'Emily.wav');
  // Dia: dialogue gets [S1], cues stay in its form; others lose [S1].
  r = ss.speechRequest({ server: srv('dia-server'), voice: 'dialogue', text: 'Well <laugh> hi (sighs)', speed: 3 });
  assert.deepEqual(body(r), { model: 'dia-1.6b', input: '[S1] Well (laughs) hi (sighs)', voice: 'dialogue', response_format: 'wav', speed: 2 });
  // Orpheus: cues become its tags, unknown tags go, wav only, speed 0.5-1.5.
  r = ss.speechRequest({ server: srv('orpheus-fastapi'), voice: 'tara', text: '[S1] Oh (laughs) <whisper> no <sigh> (in the dark)', speed: 2 });
  assert.deepEqual(body(r), { model: 'orpheus', input: 'Oh <laugh> no <sigh> (in the dark)', voice: 'tara', response_format: 'wav', speed: 1.5 });
  // Sesame: csm-1b with temperature.
  assert.deepEqual(body(ss.speechRequest({ server: srv('sesame-openai', { extras: { temperature: 0.8 } }), voice: 'nova', text: 'Hi <laugh>' })), { model: 'csm-1b', input: 'Hi', voice: 'nova', response_format: 'mp3', temperature: 0.8 });
  // CosyVoice: form fields, PCM back.
  r = ss.speechRequest({ server: srv('cosyvoice-fastapi'), voice: 'spk1', text: 'Hello' });
  assert.equal(r.url, 'http://100.64.0.5:8880/inference_sft');
  assert.equal(r.kind, 'pcm');
  assert.equal(r.rate, 24000);
  assert.equal(r.init.body.get('tts_text'), 'Hello');
  assert.equal(r.init.body.get('spk_id'), 'spk1');
  r = ss.speechRequest({ server: srv('cosyvoice-fastapi', { extras: { sampleRate: 22050 } }), voice: { clip: { buf: Buffer.from('RIFF'), transcript: 'the words', file: 'a.wav' } }, text: 'Hi' });
  assert.equal(r.url, 'http://100.64.0.5:8880/inference_zero_shot');
  assert.equal(r.init.body.get('prompt_text'), 'the words');
  assert.ok(r.init.body.get('prompt_wav'));
  assert.equal(r.rate, 22050);
  // Every preset has a sensible default port, and the window gets the presets without addresses.
  for (const [id, port] of Object.entries({ 'kokoro-fastapi': 8880, 'chatterbox-api': 4123, 'chatterbox-server': 8004, 'dia-server': 8003, 'orpheus-fastapi': 5005, 'sesame-openai': 8000, 'cosyvoice-fastapi': 50000 })) assert.equal(ss.APIS[id].port, port, id);
  const p = ss.presets();
  assert.ok(p.apis.find((a) => a.id === 'dia-server').fixed.includes('dialogue'));
  assert.match(p.hints.dia, /\[S1\].*\(laughs\)/);
  assert.match(p.hints.orpheus, /<laugh>/);
  assert.doesNotMatch(JSON.stringify(p), /https?:\/\//);
});

test('Key handling: only the server\'s own key is sent, and only to that server', async () => {
  const r = ss.speechRequest({ server: srv('kokoro-fastapi'), key: 'sk-home', voice: 'af_bella', text: 'Hi' });
  assert.equal(r.init.headers.authorization, 'Bearer sk-home');
  assert.equal(ss.speechRequest({ server: srv('kokoro-fastapi'), voice: 'a', text: 'b' }).init.headers.authorization, undefined, 'no key, no header');
  assert.equal(ss.secretName('abc123def456'), 'speech:abc123def456');
  // Through voice:speak: the secrets store gives the server's key; the OpenAI and ElevenLabs keys never leave.
  const seen = [];
  const handlers = {};
  const settings = { voice: { tts: 'server:abc123def456', servers: [{ id: 'abc123def456', name: 'Home', url: 'http://100.64.0.5:8880', api: 'kokoro-fastapi' }] } };
  const store = { 'speech:abc123def456': 'sk-home', openai: 'sk-openai', elevenlabs: 'el-key' };
  const secrets = { get: (k) => store[k] || null, has: (k) => Boolean(store[k]), set: async (k, v) => { store[k] = v; }, remove: (k) => { delete store[k]; }, available: async () => true };
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return new Response(Buffer.alloc(400, 1), { status: 200, headers: { 'content-type': 'audio/wav' } }); };
  vc.register({ handle: (n, f) => { handlers[n] = f; }, secrets, readSettings: () => settings, send: () => {}, which: () => null, media: null, mediaRoot: null, dialog: null, getWindow: () => null, clipsDir: tmp(), fetchImpl });
  const out = await handlers['voice:speak']({ text: 'Hello there', voice: 'af_bella', who: 'venice' });
  assert.equal(out.ok, true);
  assert.equal(out.mime, 'audio/wav');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'http://100.64.0.5:8880/v1/audio/speech', 'the address comes from his settings');
  assert.equal(seen[0].init.headers.authorization, 'Bearer sk-home');
  assert.doesNotMatch(JSON.stringify(seen[0].init.headers), /sk-openai|el-key/);
  // The window can only name a saved server; an unknown one is refused, and no URL is ever taken from it.
  const bad = await handlers['voice:speak']({ text: 'x', provider: 'server:zzzzzz999999', url: 'http://evil.example' });
  assert.equal(bad.ok, false);
  assert.equal(seen.length, 1);
  // The key is saved for a saved server only, and refused when it has spaces.
  assert.equal((await handlers['voice:serverKey']('nothere00000', 'k')).ok, false);
  assert.equal((await handlers['voice:serverKey']('abc123def456', 'two words')).ok, false);
  assert.equal((await handlers['voice:serverKey']('abc123def456', 'sk-new')).ok, true);
  assert.equal(store['speech:abc123def456'], 'sk-new');
  const st = await handlers['voice:status']();
  assert.deepEqual(st.servers, { abc123def456: { key: true, openaiHost: false } });
  assert.doesNotMatch(JSON.stringify(st), /sk-new/, 'the window never sees the key');
  // Forget only works once the server is gone from his settings.
  assert.equal((await handlers['voice:serverForget']('abc123def456')).ok, false);
  settings.voice.servers = [];
  assert.equal((await handlers['voice:serverForget']('abc123def456')).ok, true);
  assert.equal(store['speech:abc123def456'], undefined);
});

test('Redirects are refused, so the key can never follow one to another address', async () => {
  const other = await fakeServer((r, res) => res.end('should never be reached'));
  const s = await fakeServer((r, res) => { res.statusCode = 302; res.setHeader('location', `${other.url}/steal`); res.end(); });
  try {
    const server = ss.cleanServer({ id: 'abc123def456', name: 'Home', url: s.url, api: 'kokoro-fastapi' });
    const r = await ss.speak({ server, key: 'sk-home', voice: 'af_bella', text: 'Hello' });
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'redirect');
    assert.match(r.message, /redirect/);
    const lv = await ss.listVoices({ server, key: 'sk-home' });
    assert.equal(lv.ok, true, 'Kokoro still offers its default voices');
    assert.match(lv.warning, /redirect/);
    assert.equal(other.seen.length, 0, 'nothing reached the other address');
    assert.ok(s.seen.length >= 2);
    // A fetch that hands back the 3xx itself is refused too.
    const r2 = await ss.speak({ server, key: 'k', voice: 'a', text: 'b', fetchImpl: async () => new Response(null, { status: 307, headers: { location: 'http://x' } }) });
    assert.equal(r2.kind, 'redirect');
    // Every request asks fetch to refuse redirects.
    const inits = [];
    const spy = async (u, init) => { inits.push(init); return new Response(JSON.stringify({ voices: ['a'] }), { headers: { 'content-type': 'application/json' } }); };
    await ss.listVoices({ server, fetchImpl: spy });
    await ss.speak({ server, voice: 'a', text: 'b', fetchImpl: spy });
    await ss.cloneOnServer({ server: { ...server, api: 'sesame-openai' }, name: 'Me', file: { buf: Buffer.alloc(200) }, consent: true, fetchImpl: spy });
    assert.ok(inits.length >= 3);
    for (const i of inits) { assert.equal(i.redirect, 'error'); assert.ok(i.signal, 'every request has a timeout'); }
  } finally { await s.close(); await other.close(); }
});

test('CosyVoice\'s raw 16-bit PCM is wrapped in a WAV header the window can play', async () => {
  const pcm = Buffer.alloc(4801, 7);
  const wav = ss.pcmToWav(pcm, 22050);
  assert.equal(wav.subarray(0, 4).toString('latin1'), 'RIFF');
  assert.equal(wav.subarray(8, 16).toString('latin1'), 'WAVEfmt ');
  assert.equal(wav.readUInt16LE(20), 1, 'PCM');
  assert.equal(wav.readUInt16LE(22), 1, 'mono');
  assert.equal(wav.readUInt32LE(24), 22050);
  assert.equal(wav.readUInt32LE(28), 44100, 'byte rate');
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 4800, 'whole samples only');
  assert.equal(wav.readUInt32LE(4), 36 + 4800);
  assert.equal(wav.length, 44 + 4800);
  // From a real server answer (no content type) to a playable file.
  const s = await fakeServer((r, res) => { res.setHeader('content-type', 'application/octet-stream'); res.end(Buffer.alloc(2000, 3)); });
  try {
    const r = await ss.speak({ server: ss.cleanServer({ id: 'abc123def456', url: s.url, api: 'cosyvoice-fastapi' }), voice: 'spk1', text: 'Hello' });
    assert.equal(r.ok, true);
    assert.equal(r.mime, 'audio/wav');
    assert.equal(r.buf.readUInt32LE(24), 24000);
    assert.equal(s.seen[0].url, '/inference_sft');
    assert.equal(s.seen[0].method, 'POST');
  } finally { await s.close(); }
});

test('Audio answers are capped in size; text answers and errors are plain messages', async () => {
  const server = srv('dia-server');
  const big = async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024 * 1024)); } }), { headers: { 'content-type': 'audio/wav' } });
  const r = await ss.speak({ server, voice: 'S1', text: 'x', fetchImpl: big });
  assert.equal(r.ok, false);
  assert.match(r.message, /too much audio/);
  const told = await ss.speak({ server, voice: 'S1', text: 'x', fetchImpl: async () => new Response('x', { headers: { 'content-type': 'audio/mpeg', 'content-length': String(ss.MAX_AUDIO + 1) } }) });
  assert.match(told.message, /too much audio/);
  const json = await ss.speak({ server, voice: 'S1', text: 'x', fetchImpl: async () => new Response('{"detail":"model loading"}', { headers: { 'content-type': 'application/json' } }) });
  assert.match(json.message, /text, not sound.*model loading/);
  const err = await ss.speak({ server, voice: 'S1', text: 'x', fetchImpl: async () => new Response('{"detail":"Unknown voice"}', { status: 422 }) });
  assert.equal(err.message, 'Home: 422: Unknown voice');
  const auth = await ss.speak({ server, voice: 'S1', text: 'x', fetchImpl: async () => new Response('no', { status: 401 }) });
  assert.equal(auth.kind, 'auth');
  const down = await ss.speak({ server: ss.cleanServer({ id: 'abc123def456', name: 'Home', url: 'http://127.0.0.1:1', api: 'dia-server' }), voice: 'S1', text: 'x' });
  assert.equal(down.kind, 'unreachable');
  assert.match(down.message, /Couldn't reach Home at http:\/\/127\.0\.0\.1:1/);
  // Streaming (mp3) through voice:speak stops past the cap.
  assert.match(read('electron/voice-chat.cjs'), /n > servers\.MAX_AUDIO/);
});

test('Settings: servers merge by id, nothing is saved by itself, and a bad server is never written', () => {
  const base = vc.cleanSettings({});
  assert.deepEqual(base.servers, []);
  assert.deepEqual(diffSettings({ voice: base }, { voice: vc.cleanSettings({}) }), [], 'reading saves nothing');
  const a = vc.mergeSettings(base, { servers: { abc123def456: { name: 'Kokoro', api: 'kokoro-fastapi', url: 'http://100.64.0.5:8880/' } } });
  assert.deepEqual(a.servers, [{ id: 'abc123def456', name: 'Kokoro', url: 'http://100.64.0.5:8880', api: 'kokoro-fastapi', engine: 'kokoro' }]);
  const ch = diffSettings({ voice: base }, { voice: a });
  assert.deepEqual(ch.map((c) => c.key), ['voice.servers'], 'only his change is written');
  assert.deepEqual(Object.keys(applyChanges({}, ch).voice), ['servers']);
  // A second server and an edit to the first keep everything else.
  const b = vc.mergeSettings(a, { servers: { fff000aaa111: { name: 'Dia', api: 'dia-server', url: 'http://100.64.0.5:8003' } } });
  const c = vc.mergeSettings(b, { servers: { abc123def456: { name: 'Kokoro (home)' } } });
  assert.equal(c.servers.length, 2);
  assert.deepEqual(c.servers[0], { ...a.servers[0], name: 'Kokoro (home)' });
  assert.deepEqual(c.servers[1], b.servers[1]);
  // Picking a server as the provider, and a voice per server for a teammate.
  const d = vc.mergeSettings(c, { tts: 'server:fff000aaa111', voices: { venice: { servers: { fff000aaa111: 'S2' }, use: 'server:abc123def456' } } });
  assert.equal(d.tts, 'server:fff000aaa111');
  const e = vc.mergeSettings(d, { voices: { venice: { servers: { abc123def456: 'af_bella' } } } });
  assert.deepEqual(e.voices.venice, { servers: { fff000aaa111: 'S2', abc123def456: 'af_bella' }, use: 'server:abc123def456' }, 'one server\'s voice keeps the other\'s');
  assert.deepEqual(vc.mergeSettings(e, { voices: { venice: { use: null, servers: { fff000aaa111: null } } } }).voices.venice, { servers: { abc123def456: 'af_bella' } });
  // Bad input throws a plain message (nothing half-done is saved).
  assert.throws(() => vc.mergeSettings(e, { servers: { abc123def456: { url: 'ftp://x' } } }), /must start with http/);
  assert.throws(() => vc.mergeSettings(e, { servers: { abc123def456: { url: 'http://user:pw@x' } } }), /no user name or password/);
  assert.throws(() => vc.mergeSettings(e, { servers: { 'BAD ID': { url: 'http://x' } } }), /bad id/);
  const full = {};
  for (let i = 0; i < 8; i++) full[`aaaaaa00000${i}`] = { url: `http://h${i}:1` };
  const eight = vc.mergeSettings({}, { servers: full });
  assert.equal(eight.servers.length, 8);
  assert.throws(() => vc.mergeSettings(eight, { servers: { bbbbbb000000: { url: 'http://h:1' } } }), /Up to 8/);
  // Removing a server; a provider pointing at a removed server reads as the default.
  const f = vc.mergeSettings(e, { servers: { fff000aaa111: null } });
  assert.deepEqual(f.servers.map((x) => x.id), ['abc123def456']);
  assert.equal(f.tts, 'local');
  // An array from the window never replaces the list.
  assert.deepEqual(vc.mergeSettings(e, { servers: [] }).servers, e.servers);
  // The key is never in settings.
  const g = vc.mergeSettings(e, { servers: { abc123def456: { key: 'sk-secret', apiKey: 'x' } } });
  assert.doesNotMatch(JSON.stringify(g), /sk-secret/);
  // main.cjs refuses to save over a damaged settings.json (unchanged rule).
  assert.match(read('electron/main.cjs'), /if \(settingsBroken\) throw new Error\(settingsBroken\);/);
});

test('Uncensored rule: a server at OpenAI\'s own address counts as OpenAI', async () => {
  assert.equal(ss.isOpenAIHost(srv('openai', { url: 'https://api.openai.com' })), true);
  assert.equal(ss.isOpenAIHost(srv('openai', { url: 'http://100.64.0.5:8880' })), false);
  const handlers = {};
  const seen = [];
  const settings = { voice: { tts: 'server:abc123def456', servers: [{ id: 'abc123def456', name: 'Sneaky', url: 'https://api.openai.com', api: 'openai' }] } };
  vc.register({ handle: (n, f) => { handlers[n] = f; }, secrets: { get: () => 'k', has: () => true, available: async () => true }, readSettings: () => settings, send: () => {}, which: () => null, dialog: null, getWindow: () => null, fetchImpl: async (u, i) => { seen.push(u); return new Response(Buffer.alloc(400), { headers: { 'content-type': 'audio/wav' } }); } });
  const r = await handlers['voice:speak']({ text: 'adult text', who: 'venice' });
  assert.equal(r.blocked, 'uncensored');
  assert.equal(seen.length, 0);
  assert.equal((await handlers['voice:speak']({ text: 'hello', who: 'anthropic' })).ok, true);
  settings.voice.openaiForUncensored = true;
  assert.equal((await handlers['voice:speak']({ text: 'adult text', who: 'venice' })).ok, true, 'only once he allowed it');
});

test('Cloning on a server only with his consent, only where the server can, CosyVoice clips kept safely', async () => {
  const dir = tmp();
  const file = { buf: Buffer.alloc(500, 1), ext: 'wav', mime: 'audio/wav', name: 'me.wav' };
  assert.equal((await ss.cloneOnServer({ server: srv('cosyvoice-fastapi'), name: 'Me', transcript: 'hi', file, consent: false, clipsDir: dir })).kind, 'consent');
  assert.equal((await ss.cloneOnServer({ server: srv('kokoro-fastapi'), name: 'Me', file, consent: true })).kind, 'unsupported');
  assert.match((await ss.cloneOnServer({ server: srv('cosyvoice-fastapi'), name: 'Me', file, consent: true, clipsDir: dir })).message, /words said/);
  const ok = await ss.cloneOnServer({ server: srv('cosyvoice-fastapi'), name: 'Me', transcript: 'the words', file, consent: true, clipsDir: dir });
  assert.equal(ok.ok, true);
  assert.match(ok.voice.id, /^clip:[a-f0-9]{10}$/);
  const clip = ss.clipFor(dir, 'abc123def456', ok.voice.id);
  assert.equal(clip.transcript, 'the words');
  assert.equal(clip.buf.length, 500);
  const lv = await ss.listVoices({ server: srv('cosyvoice-fastapi'), clips: ss.readClips(dir, 'abc123def456') });
  assert.deepEqual(lv.voices.map((v) => v.id), [ok.voice.id]);
  // A damaged clips.json is never overwritten.
  fs.writeFileSync(path.join(dir, 'abc123def456', 'clips.json'), '{broken');
  const no = await ss.cloneOnServer({ server: srv('cosyvoice-fastapi'), name: 'Two', transcript: 'x', file, consent: true, clipsDir: dir });
  assert.equal(no.ok, false);
  assert.equal(fs.readFileSync(path.join(dir, 'abc123def456', 'clips.json'), 'utf8'), '{broken');
  // The Sesame server gets the clip as multipart.
  const s = await fakeServer((r, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ voice_id: 'v_me' })); });
  try {
    const r = await ss.cloneOnServer({ server: ss.cleanServer({ id: 'abc123def456', url: s.url, api: 'sesame-openai' }), key: 'k', name: 'Me', transcript: 'hello', file, consent: true });
    assert.deepEqual(r, { ok: true, voice: { id: 'v_me', name: 'Me' } });
    assert.equal(s.seen[0].url, '/v1/voice-cloning/clone');
    assert.match(String(s.seen[0].headers['content-type']), /multipart\/form-data/);
    assert.match(s.seen[0].body.toString('latin1'), /name="audio_file"/);
  } finally { await s.close(); }
});

test('Voices list: presets, fixed voices, his extras; the window code never saves settings or takes an address', async () => {
  const s = await fakeServer((r, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ voices: ['af_heart', 'am_adam'] })); });
  try {
    const lv = await ss.listVoices({ server: ss.cleanServer({ id: 'abc123def456', url: s.url, api: 'kokoro-fastapi', voices: 'af_bella(2)+af_sky(1)' }) });
    assert.deepEqual(lv.voices.map((v) => v.id), ['af_heart', 'am_adam', 'af_bella(2)+af_sky(1)']);
    assert.equal(s.seen[0].url, '/v1/audio/voices');
  } finally { await s.close(); }
  const dia = await ss.listVoices({ server: srv('dia-server') });
  assert.deepEqual(dia.voices.map((v) => v.id), ['S1', 'S2', 'dialogue']);
  const ui = read('src/voice.mjs');
  assert.doesNotMatch(ui, /setSettings/);
  assert.doesNotMatch(read('electron/preload.cjs').match(/voiceServer[^\n]*/g).join('\n'), /url/i, 'the window passes only an id');
  // Credits list each engine and server program.
  const credits = read('src/app/credits.mjs');
  for (const n of ['Kokoro', 'Chatterbox', 'Sesame CSM', 'Dia', 'CosyVoice2', 'Orpheus', 'Kokoro-FastAPI', 'chatterbox-tts-api', 'Chatterbox-TTS-Server', 'Dia-TTS-Server', 'Orpheus-FastAPI', 'sesame_csm_openai', 'CosyVoice FastAPI server']) assert.ok(credits.includes(`name: '${n}`), n);
});

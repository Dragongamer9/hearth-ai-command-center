// Voice chat, main process side (electron/voice-chat.cjs, electron/voice-perms.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const vc = require('../electron/voice-chat.cjs');
const perms = require('../electron/voice-perms.cjs');
const { createSecretStore } = require('../electron/secrets.cjs');
const { diffSettings, applyChanges } = require('../electron/settings-log.cjs');
const cardsLib = require('../electron/cards.cjs');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-voice-test-'));
// A stand-in for Electron's safeStorage: reversible, and never the plain text.
const fakeSafe = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from([...Buffer.from(s, 'utf8')].map((b) => b ^ 0x5a)), decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString('utf8') };

// A local HTTP server standing in for the providers: records every request.
async function fakeServer(reply) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { const r = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) }; seen.push(r); reply(r, res); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  // Requests to the real hosts go to this server instead (the path and headers are kept).
  const fetchImpl = (url, init) => fetch(String(url).replace(/^https:\/\/api\.(elevenlabs\.io|openai\.com)/, (m, h) => `${base}/${h}`), init);
  return { seen, fetchImpl, close: () => new Promise((r) => srv.close(r)) };
}

test('ElevenLabs: the voices list and streaming speech use the documented URLs and the xi-api-key header', async () => {
  const s = await fakeServer((r, res) => {
    if (r.url.startsWith('/elevenlabs.io/v2/voices')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ voices: [{ voice_id: 'VoiceAria0001', name: 'Aria', category: 'premade', preview_url: 'https://x/p.mp3', labels: { accent: 'american' } }, { voice_id: 'bad id!', name: 'x' }], has_more: false, next_page_token: null })); }
    res.setHeader('content-type', 'audio/mpeg'); res.write(Buffer.from([0xff, 0xfb, 1])); res.end(Buffer.from([2, 3]));
  });
  try {
    const v = await vc.elevenVoices({ key: 'el-key-123456', fetchImpl: s.fetchImpl });
    assert.equal(v.ok, true);
    assert.deepEqual(v.voices.map((x) => x.id), ['VoiceAria0001'], 'only real voice ids');
    const q = new URL(`http://x${s.seen[0].url}`);
    assert.equal(q.pathname, '/elevenlabs.io/v2/voices');
    assert.equal(q.searchParams.get('page_size'), '100');
    assert.equal(s.seen[0].headers['xi-api-key'], 'el-key-123456');
    assert.equal(s.seen[0].headers.authorization, undefined);
    const st = await vc.startStream({ provider: 'elevenlabs', key: 'el-key-123456', voiceId: 'VoiceAria0001', text: 'Hello there.', settings: {}, speed: 1.1, fetchImpl: s.fetchImpl });
    assert.equal(st.ok, true);
    const body = Buffer.from(await st.res.arrayBuffer());
    assert.deepEqual([...body], [0xff, 0xfb, 1, 2, 3]);
    const r = s.seen[1];
    assert.equal(r.method, 'POST');
    assert.equal(r.url, '/elevenlabs.io/v1/text-to-speech/VoiceAria0001/stream?output_format=mp3_44100_128');
    assert.equal(r.headers['xi-api-key'], 'el-key-123456');
    const j = JSON.parse(r.body);
    assert.equal(j.text, 'Hello there.');
    assert.equal(j.model_id, 'eleven_flash_v2_5', 'the fastest model by default');
    assert.equal(j.voice_settings.speed, 1.1);
  } finally { await s.close(); }
});

test('OpenAI: speech and transcription use /v1/audio/speech and /v1/audio/transcriptions with a Bearer key', async () => {
  const s = await fakeServer((r, res) => {
    if (r.url.endsWith('/audio/transcriptions')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ text: ' [BLANK_AUDIO] Hello   Mira. ' })); }
    res.setHeader('content-type', 'application/octet-stream'); res.end(Buffer.from([0xff, 0xf3]));
  });
  try {
    const st = await vc.startStream({ provider: 'openai', key: 'sk-test-abcdef', voiceId: 'nova', text: 'Hi!', settings: { openaiModel: 'gpt-4o-mini-tts' }, speed: 1.2, fetchImpl: s.fetchImpl });
    assert.equal(st.ok, true);
    await st.res.arrayBuffer();
    const sp = s.seen[0];
    assert.equal(sp.url, '/openai.com/v1/audio/speech');
    assert.equal(sp.headers.authorization, 'Bearer sk-test-abcdef');
    assert.deepEqual(JSON.parse(sp.body), { model: 'gpt-4o-mini-tts', input: 'Hi!', voice: 'nova', response_format: 'mp3', speed: 1.2 });
    const tr = await vc.transcribeOpenAI({ key: 'sk-test-abcdef', buf: Buffer.alloc(3000, 1), mime: 'audio/webm', fetchImpl: s.fetchImpl });
    assert.deepEqual(tr, { ok: true, text: 'Hello Mira.' });
    const t = s.seen[1];
    assert.equal(t.url, '/openai.com/v1/audio/transcriptions');
    assert.equal(t.headers.authorization, 'Bearer sk-test-abcdef');
    assert.match(t.headers['content-type'], /^multipart\/form-data; boundary=/);
    const body = t.body.toString('latin1');
    assert.match(body, /name="file"; filename="speech\.webm"/);
    assert.match(body, /name="model"\r\n\r\ngpt-transcribe/);
  } finally { await s.close(); }
});

test('Voice cloning: refused without the consent tick; with it, POST /v1/voices/add with name and files', async () => {
  const s = await fakeServer((r, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ voice_id: 'NewVoice12345', requires_verification: false })); });
  try {
    const no = await vc.elevenClone({ key: 'el-key-123456', name: 'My voice', files: [{ name: 'a.mp3', buf: Buffer.from('x') }], consent: false, fetchImpl: s.fetchImpl });
    assert.equal(no.ok, false);
    assert.equal(no.kind, 'consent');
    assert.equal(s.seen.length, 0, 'nothing sent without consent');
    const yes = await vc.elevenClone({ key: 'el-key-123456', name: 'My voice', files: [{ name: 'a.mp3', buf: Buffer.from('abc'), mime: 'audio/mpeg' }], consent: true, fetchImpl: s.fetchImpl });
    assert.deepEqual(yes, { ok: true, voice: { id: 'NewVoice12345', name: 'My voice' }, requiresVerification: false });
    assert.equal(s.seen[0].url, '/elevenlabs.io/v1/voices/add');
    assert.equal(s.seen[0].headers['xi-api-key'], 'el-key-123456');
    const b = s.seen[0].body.toString('latin1');
    assert.match(b, /name="name"\r\n\r\nMy voice/);
    assert.match(b, /name="files"; filename="a\.mp3"/);
  } finally { await s.close(); }
  // No presets of real people anywhere in the voice code.
  for (const f of ['electron/voice-chat.cjs', 'src/voice.mjs', 'src/app/voice-logic.mjs']) assert.doesNotMatch(read(f), /celebrity|impersonat(e|ion) preset|famous voice/i);
});

function harness({ settings = {}, keys = {}, fetchImpl } = {}) {
  const dir = tmp();
  const secrets = createSecretStore({ safeStorage: fakeSafe, dir });
  const handlers = {};
  const sent = [];
  const media = require('../electron/media.cjs');
  const api = vc.register({ handle: (ch, fn) => { handlers[ch] = fn; }, secrets, readSettings: () => ({ voice: settings }), send: (ch, p) => sent.push([ch, p]), which: () => null, media, mediaRoot: path.join(dir, 'media'), dialog: null, getWindow: () => null, fetchImpl });
  return { dir, secrets, handlers, sent, api, setKeys: async () => { for (const [k, v] of Object.entries(keys)) await secrets.set(k, v); } };
}

test('Keys never land in plain text: encrypted in secrets.json, never in settings, never sent to the window', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }); };
  const h = harness({ settings: { tts: 'elevenlabs' }, keys: { elevenlabs: 'EL-SECRET-KEY-0001', openai: 'sk-SECRET-KEY-0002' }, fetchImpl });
  await h.setKeys();
  const disk = fs.readFileSync(path.join(h.dir, 'secrets.json'), 'utf8');
  assert.ok(!disk.includes('EL-SECRET-KEY-0001') && !disk.includes('sk-SECRET-KEY-0002'), 'secrets.json holds no plain key');
  assert.equal((fs.statSync(path.join(h.dir, 'secrets.json')).mode & 0o777), 0o600);
  const status = await h.handlers['voice:status']();
  assert.deepEqual(status.keys, { elevenlabs: true, openai: true });
  assert.ok(!JSON.stringify(status).includes('SECRET'), 'status says only whether a key is saved');
  const r = await h.handlers['voice:speak']({ provider: 'elevenlabs', voice: 'VoiceAria0001', text: 'Hello.', who: 'anthropic' });
  assert.equal(r.ok, true);
  assert.ok(!JSON.stringify(r).includes('SECRET'));
  await new Promise((res) => setTimeout(res, 30));
  assert.ok(h.sent.some(([ch]) => ch === 'voice:end'));
  assert.ok(!JSON.stringify(h.sent).includes('SECRET'), 'nothing sent to the window carries the key');
  assert.equal(calls[0].init.headers['xi-api-key'], 'EL-SECRET-KEY-0001', 'the key only goes in the request header');
  // Settings never hold a key, whatever the window sends.
  const s = vc.mergeSettings({}, { tts: 'openai', apiKey: 'sk-SECRET', voices: { default: { openai: 'nova', key: 'sk-SECRET' } } });
  assert.ok(!JSON.stringify(s).includes('SECRET'));
  // The main window saves the ElevenLabs key through the same encrypted media key path.
  assert.match(read('electron/parity.cjs'), /const KEY_NAMES = \['google', 'openai', 'xai', 'mistral', 'elevenlabs'\];/);
  assert.match(read('electron/parity.cjs'), /await secrets\.set\(name, k\);/);
});

test('Uncensored teammates: their replies are not sent to OpenAI TTS unless he allowed it', async () => {
  let fetched = 0;
  const fetchImpl = async () => { fetched++; return new Response(new Uint8Array([1]), { status: 200 }); };
  for (const who of ['venice', 'civitai', 'gpu']) {
    const h = harness({ settings: { tts: 'openai' }, keys: { openai: 'sk-test-0000000' }, fetchImpl });
    await h.setKeys();
    const r = await h.handlers['voice:speak']({ provider: 'openai', voice: 'nova', text: 'A reply.', who });
    assert.equal(r.ok, false);
    assert.equal(r.blocked, 'uncensored');
  }
  assert.equal(fetched, 0, 'nothing reached OpenAI');
  // Other teammates may use OpenAI as he picked.
  const h2 = harness({ settings: { tts: 'openai' }, keys: { openai: 'sk-test-0000000' }, fetchImpl });
  await h2.setKeys();
  assert.equal((await h2.handlers['voice:speak']({ provider: 'openai', voice: 'nova', text: 'A reply.', who: 'anthropic' })).ok, true);
  // With his explicit choice it goes through.
  const h3 = harness({ settings: { tts: 'openai', openaiForUncensored: true }, keys: { openai: 'sk-test-0000000' }, fetchImpl });
  await h3.setKeys();
  assert.equal((await h3.handlers['voice:speak']({ provider: 'openai', voice: 'nova', text: 'A reply.', who: 'venice' })).ok, true);
  assert.equal(fetched, 2);
  // His voice in a chat only with them isn't sent to OpenAI for speech to text either.
  assert.equal(vc.sttRoute({ settings: { stt: 'openai' }, local: { tool: null }, hasOpenAI: true, uncensoredOnly: true }).kind, 'uncensored');
  assert.equal(vc.sttRoute({ settings: { stt: 'auto' }, local: { tool: 'whisper.cpp' }, hasOpenAI: true, uncensoredOnly: true }).via, 'local');
});

test('Speech to text: whisper.cpp on this PC by default when present, otherwise OpenAI, and it says which', () => {
  assert.equal(vc.sttRoute({ settings: {}, local: { tool: 'whisper.cpp' }, hasOpenAI: true }).via, 'local');
  assert.match(vc.sttRoute({ settings: {}, local: { tool: 'whisper.cpp' }, hasOpenAI: true }).label, /on this PC/);
  const o = vc.sttRoute({ settings: {}, local: { tool: null, missing: 'x' }, hasOpenAI: true });
  assert.equal(o.via, 'openai');
  assert.match(o.label, /goes to OpenAI/);
  assert.equal(vc.sttRoute({ settings: {}, local: { tool: null }, hasOpenAI: false }).ok, false);
  assert.equal(vc.sttRoute({ settings: { stt: 'local' }, local: { tool: null, missing: 'install whisper.cpp' }, hasOpenAI: true }).ok, false, 'This PC only never falls back to the cloud');
});

test('Local voices: only installed voices run, with argument arrays (no shell), CPU tools only', () => {
  const home = '/h';
  const files = { '/h/.local/share/kokoro': ['kokoro-v1.0.onnx', 'voices-v1.0.bin'], '/h/.local/share/piper': ['en_US-lessac-medium.onnx', 'en_US-lessac-medium.onnx.json'] };
  const t = vc.localTools({ find: (b) => ({ 'kokoro-tts': '/usr/bin/kokoro-tts', piper: '/usr/bin/piper', 'espeak-ng': '/usr/bin/espeak-ng' }[b] || null), list: (d) => files[d] || [], home });
  assert.ok(t.kokoro && t.piper && t.espeak);
  const k = vc.localCommand(t, 'kokoro:bf_emma', { speed: 1.2, out: '/tmp/o.wav' });
  assert.deepEqual(k.args, ['-', '/tmp/o.wav', '--voice', 'bf_emma', '--speed', '1.2', '--lang', 'en-gb', '--format', 'wav']);
  assert.equal(k.cwd, '/h/.local/share/kokoro');
  const p = vc.localCommand(t, 'piper:/h/.local/share/piper/en_US-lessac-medium.onnx', { out: '/tmp/o.wav' });
  assert.deepEqual(p.args, ['-m', '/h/.local/share/piper/en_US-lessac-medium.onnx', '-f', '/tmp/o.wav']);
  assert.equal(vc.localCommand(t, 'piper:/etc/passwd', { out: '/tmp/o.wav' }), null, 'a path the app didn\'t find is refused');
  assert.equal(vc.localCommand(t, 'kokoro:af_x; rm -rf /', { out: '/tmp/o.wav' }), null);
  const e = vc.localCommand(t, 'espeak:en-us', { speed: 1, pitch: 1.2, out: '' });
  assert.deepEqual(e.args, ['--stdout', '-v', 'en-us', '-s', '175', '-p', '60', '--stdin']);
  assert.equal(vc.localVoices(t).filter((v) => v.engine === 'kokoro').length, vc.KOKORO_VOICES.length);
});

test('Microphone permission: only the app window, its own page, audio only', () => {
  const app = { id: 1 };
  const other = { id: 2 };
  const ok = (o) => perms.allowRequest({ appWc: app, devUrl: undefined, ...o });
  assert.equal(ok({ wc: app, permission: 'media', details: { mediaTypes: ['audio'], requestingUrl: 'file:///app/dist/index.html', isMainFrame: true } }), true);
  assert.equal(ok({ wc: other, permission: 'media', details: { mediaTypes: ['audio'], requestingUrl: 'https://chub.ai/', isMainFrame: true } }), false, 'Find characters / web app windows');
  assert.equal(ok({ wc: app, permission: 'media', details: { mediaTypes: ['audio'], requestingUrl: 'hearth-preview://p/x.html', isMainFrame: false } }), false, 'a live preview frame');
  assert.equal(ok({ wc: app, permission: 'media', details: { mediaTypes: ['video'], requestingUrl: 'file:///app/dist/index.html', isMainFrame: true } }), false, 'no camera');
  assert.equal(ok({ wc: app, permission: 'media', details: { mediaTypes: ['audio', 'video'], requestingUrl: 'file:///app/dist/index.html', isMainFrame: true } }), false);
  assert.equal(ok({ wc: other, permission: 'notifications', details: {} }), false);
  assert.equal(ok({ wc: other, permission: 'clipboard-sanitized-write', details: {} }), true);
  assert.equal(ok({ wc: app, permission: 'notifications', details: {} }), true, 'the app window keeps what it had');
  assert.equal(perms.allowCheck({ wc: app, appWc: app, permission: 'media', origin: 'file:///', details: { mediaType: 'audio', requestingUrl: 'file:///app/index.html' } }), true);
  assert.equal(perms.allowCheck({ wc: other, appWc: app, permission: 'media', origin: 'https://x', details: { mediaType: 'audio' } }), false);
  // Wired up on the app window; the web windows keep their own deny-by-default handlers.
  assert.match(read('electron/main.cjs'), /voicePerms\.install\(mainWindow,/);
  for (const f of ['electron/webapps.cjs', 'electron/card-finder.cjs']) assert.match(read(f), /setPermissionRequestHandler\(\(_wc, perm, cb\) => cb\(\['clipboard-sanitized-write', 'fullscreen'\]\.includes\(perm\)\)\)/);
});

test('RED FLAG: the updaters and release workflow are byte-identical to 1.8.0 (voice chat touches none of them)', () => {
  const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', p))).digest('hex');
  assert.equal(sha('electron/updater.cjs'), '4811aac6a6dc40341d19a8d2a4d27446cddba6df6d2b01e9ae7030504897e311');
  assert.equal(sha('electron/updater-deb.cjs'), '39ed4ef6b4a491baa81ce686c9b98bc502e4d41ac87d7f439cafe9fce3ba7805');
  assert.equal(sha('.github/workflows/release.yml'), 'ae12e7d818779ddb637df6846276ee82a3a7e8f33cc1360e3db5822a96e7deae');
  for (const f of ['electron/voice-chat.cjs', 'electron/voice-perms.cjs', 'src/voice.mjs', 'src/app/voice-logic.mjs']) assert.doesNotMatch(read(f), /updater/i);
});

test('Settings never change by themselves: first run saves nothing, a change saves only that key', () => {
  const d = vc.cleanSettings(undefined);
  assert.deepEqual(d, { ...vc.DEFAULTS, voices: {}, servers: [] });
  assert.equal(d.tts, 'local', 'free and private until he picks another');
  // Reading twice is the same and writes nothing (main.cjs saves only diffs).
  assert.deepEqual(diffSettings({ voice: vc.cleanSettings({}) }, { voice: vc.cleanSettings({}) }), []);
  const before = { voice: vc.cleanSettings({}) };
  const after = { voice: vc.mergeSettings(before.voice, { turn: 'ptt' }) };
  const ch = diffSettings(before, after);
  assert.deepEqual(ch.map((c) => c.key), ['voice.turn']);
  assert.deepEqual(applyChanges({}, ch), { voice: { turn: 'ptt' } }, 'only his change is written, no defaults');
  const v2 = vc.mergeSettings(after.voice, { voices: { venice: { elevenlabs: { id: 'VoiceAria0001', name: 'Aria' } } } });
  assert.deepEqual(v2.voices, { venice: { elevenlabs: { id: 'VoiceAria0001', name: 'Aria' } } });
  assert.deepEqual(vc.mergeSettings(v2, { voices: { venice: null } }).voices, {}, 'clearing a voice');
  const main = read('electron/main.cjs');
  assert.match(main, /voice: voiceChat\.cleanSettings\(s\.voice\),/);
  assert.match(main, /if \('voice' in patch\) s\.voice = voiceChat\.mergeSettings\(s\.voice, patch\.voice\);/);
  // The window's voice code never saves settings on its own.
  assert.doesNotMatch(read('src/voice.mjs'), /setSettings|setVoiceSettings/);
  // In main.js every voice settings write sits in the click or change handler (his clicks).
  const js = read('src/main.js');
  const click = js.slice(js.indexOf("document.addEventListener('click'"), js.indexOf("document.addEventListener('change'"));
  const change = js.slice(js.indexOf("document.addEventListener('change'"), js.indexOf('let searchTimer'));
  const writes = [...js.matchAll(/setSettings\(\{ voice: /g)].length;
  assert.ok(writes >= 6);
  assert.equal([...click.matchAll(/setSettings\(\{ voice: /g)].length + [...change.matchAll(/setSettings\(\{ voice: /g)].length, writes);
});

test('Character voices are kept in the character store, never in exported card files', () => {
  const dir = tmp();
  const store = cardsLib.createCards({ dataDir: dir });
  const c = store.add(cardsLib.normalizeCard({ spec: 'chara_card_v2', data: { name: 'Mira', description: 'A ranger.', extensions: { hearth: { voice: 'Old System Voice' } } } }));
  const v = store.setVoice(c.id, { elevenlabs: { id: 'VoiceAria0001', name: 'Aria' }, openai: 'nova', local: 'kokoro:af_heart', speed: 1.1, junk: 'x' });
  assert.deepEqual(v.ownerVoice, { elevenlabs: { id: 'VoiceAria0001', name: 'Aria' }, openai: 'nova', local: 'kokoro:af_heart', speed: 1.1 });
  // Editing the card keeps the voice.
  const saved = store.save({ id: c.id, name: 'Mira', description: 'A ranger of the north.' });
  assert.equal(saved.ownerVoice.openai, 'nova');
  for (const fmt of ['json', 'png']) {
    const x = store.exportCard(c.id, fmt);
    const txt = fmt === 'json' ? x.buf.toString('utf8') : Object.values(cardsLib.pngText(x.buf)).map((t) => Buffer.from(t, 'base64').toString('utf8')).join('\n');
    assert.ok(txt.includes('A ranger of the north.'));
    for (const s of ['VoiceAria0001', 'nova', 'af_heart', 'ownerVoice', 'Old System Voice']) assert.ok(!txt.includes(s), `${fmt} export has no ${s}`);
  }
  assert.equal(store.setVoice(c.id, null).ownerVoice, undefined);
});

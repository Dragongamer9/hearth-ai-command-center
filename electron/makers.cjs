// Things the AIs' own apps can do that go through an official API with the owner's own
// key (saved encrypted), or a program on this PC:
// - pictures: OpenAI Images (ChatGPT), Gemini API image model, xAI Grok images; editing
//   through OpenAI image edits or Gemini (picture + instruction);
// - videos: OpenAI Sora (videos API) or Google Veo (Gemini API), only with the owner's key;
// - document reading: Mistral OCR (PDFs and pictures) with his Mistral key, or pdftotext;
// - web page screenshots with a headless Chromium/Chrome if one is installed;
// - reading answers aloud with espeak-ng / espeak / spd-say;
// - the Claude Code skills that are installed.
// Every network call is the official endpoint; nothing here stores a key or a picture
// anywhere but the app's own media folder (electron/media.cjs).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const IMAGE_PROVIDERS = ['google', 'openai', 'xai'];
const VIDEO_PROVIDERS = ['openai', 'google'];
const IMAGE_MODELS = { openai: 'gpt-image-1', google: 'gemini-2.5-flash-image', xai: 'grok-2-image' };
const VIDEO_MODELS = { openai: 'sora-2', google: 'veo-3.0-generate-001' };
const PROVIDER_NAMES = { openai: 'ChatGPT (OpenAI Images)', google: 'Gemini (Gemini API)', xai: 'Grok (xAI images)', mistral: 'Mistral' };

const fail = (message, kind = 'failed') => ({ ok: false, error: { kind, message: String(message).slice(0, 300) } });
async function jsonOrNull(res) { try { return await res.json(); } catch { return null; } }
const errOf = (j, res) => (j?.error?.message ? String(j.error.message) : `HTTP ${res.status}`);

async function generateImage({ provider, key, prompt, image = null, fetchImpl = fetch, timeoutMs = 180000 }) {
  if (!IMAGE_PROVIDERS.includes(provider)) return fail('That AI can\'t make pictures through its API.', 'unsupported');
  if (!key) return fail(`Add your ${PROVIDER_NAMES[provider]} API key in Settings › Media & voice first.`, 'no_key');
  const text = String(prompt || '').slice(0, 4000);
  if (!text) return fail('Say what the picture should show.');
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    if (provider === 'google') {
      const parts = [{ text }];
      if (image) parts.push({ inline_data: { mime_type: image.mime || 'image/png', data: image.buf.toString('base64') } });
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODELS.google}:generateContent`, { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ parts }] }) });
      const j = await jsonOrNull(res);
      if (!res.ok) return fail(errOf(j, res), res.status === 401 || res.status === 403 ? 'auth' : 'failed');
      const part = (j?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data || p.inline_data?.data);
      const d = part?.inlineData || part?.inline_data;
      if (!d) return fail('Gemini answered without a picture (it may have refused the request).');
      return { ok: true, buf: Buffer.from(d.data, 'base64'), mime: d.mimeType || d.mime_type || 'image/png', via: PROVIDER_NAMES.google };
    }
    if (provider === 'openai' && image) {
      const form = new FormData();
      form.append('model', IMAGE_MODELS.openai);
      form.append('prompt', text);
      form.append('image', new Blob([image.buf], { type: image.mime || 'image/png' }), image.name || 'image.png');
      const res = await fetchImpl('https://api.openai.com/v1/images/edits', { method: 'POST', signal, headers: { authorization: `Bearer ${key}` }, body: form });
      const j = await jsonOrNull(res);
      if (!res.ok) return fail(errOf(j, res), res.status === 401 ? 'auth' : 'failed');
      const b64 = j?.data?.[0]?.b64_json;
      return b64 ? { ok: true, buf: Buffer.from(b64, 'base64'), mime: 'image/png', via: PROVIDER_NAMES.openai } : fail('No picture came back.');
    }
    const url = provider === 'openai' ? 'https://api.openai.com/v1/images/generations' : 'https://api.x.ai/v1/images/generations';
    const body = provider === 'openai' ? { model: IMAGE_MODELS.openai, prompt: text, size: '1024x1024' } : { model: IMAGE_MODELS.xai, prompt: text, response_format: 'b64_json' };
    if (provider === 'xai' && image) return fail('Grok can make pictures but not edit one through its API; ask Gemini or ChatGPT to edit it.', 'unsupported');
    const res = await fetchImpl(url, { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
    const j = await jsonOrNull(res);
    if (!res.ok) return fail(errOf(j, res), res.status === 401 ? 'auth' : 'failed');
    const b64 = j?.data?.[0]?.b64_json;
    return b64 ? { ok: true, buf: Buffer.from(b64, 'base64'), mime: 'image/png', via: PROVIDER_NAMES[provider] } : fail('No picture came back.');
  } catch (e) { return fail(e?.name === 'TimeoutError' ? 'The picture took too long.' : `Couldn't reach ${PROVIDER_NAMES[provider]}.`, 'network'); }
}

// Videos are slow: start a job and poll it (up to ~10 minutes).
async function generateVideo({ provider, key, prompt, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxPolls = 60, signal = null }) {
  if (!VIDEO_PROVIDERS.includes(provider)) return fail('No video API for that AI.', 'unsupported');
  if (!key) return fail(`Video needs your ${provider === 'openai' ? 'OpenAI' : 'Gemini API'} key (Settings › Media & voice).`, 'no_key');
  const text = String(prompt || '').slice(0, 2000);
  try {
    if (provider === 'openai') {
      const res = await fetchImpl('https://api.openai.com/v1/videos', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model: VIDEO_MODELS.openai, prompt: text }) });
      const j = await jsonOrNull(res);
      if (!res.ok || !j?.id) return fail(errOf(j, res), res.status === 401 ? 'auth' : 'failed');
      for (let i = 0; i < maxPolls; i++) {
        if (signal?.aborted) return fail('Stopped.', 'cancelled');
        await sleep(10000);
        const st = await fetchImpl(`https://api.openai.com/v1/videos/${encodeURIComponent(j.id)}`, { headers: { authorization: `Bearer ${key}` } });
        const sj = await jsonOrNull(st);
        if (sj?.status === 'failed') return fail(sj?.error?.message || 'The video failed.');
        if (sj?.status === 'completed') {
          const c = await fetchImpl(`https://api.openai.com/v1/videos/${encodeURIComponent(j.id)}/content`, { headers: { authorization: `Bearer ${key}` } });
          if (!c.ok) return fail(`Download failed (HTTP ${c.status}).`);
          return { ok: true, buf: Buffer.from(await c.arrayBuffer()), mime: 'video/mp4', via: 'Sora (OpenAI videos API)' };
        }
      }
      return fail('The video is still not ready after 10 minutes.');
    }
    const base = 'https://generativelanguage.googleapis.com/v1beta';
    const res = await fetchImpl(`${base}/models/${VIDEO_MODELS.google}:predictLongRunning`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ instances: [{ prompt: text }] }) });
    const j = await jsonOrNull(res);
    if (!res.ok || !j?.name) return fail(errOf(j, res), res.status === 401 || res.status === 403 ? 'auth' : 'failed');
    if (!/^[A-Za-z0-9/_.-]{1,300}$/.test(j.name)) return fail('Unexpected answer from Gemini.');
    for (let i = 0; i < maxPolls; i++) {
      if (signal?.aborted) return fail('Stopped.', 'cancelled');
      await sleep(10000);
      const st = await fetchImpl(`${base}/${j.name}`, { headers: { 'x-goog-api-key': key } });
      const sj = await jsonOrNull(st);
      if (sj?.error) return fail(sj.error.message || 'The video failed.');
      if (sj?.done) {
        const uri = sj?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri || !/^https:\/\/generativelanguage\.googleapis\.com\//.test(uri)) return fail('No video came back (it may have been refused).');
        const c = await fetchImpl(uri, { headers: { 'x-goog-api-key': key } });
        if (!c.ok) return fail(`Download failed (HTTP ${c.status}).`);
        return { ok: true, buf: Buffer.from(await c.arrayBuffer()), mime: 'video/mp4', via: 'Veo (Gemini API)' };
      }
    }
    return fail('The video is still not ready after 10 minutes.');
  } catch { return fail('Couldn\'t reach the video service.', 'network'); }
}

// Mistral OCR: a PDF or picture to Markdown text.
async function mistralOcr({ key, buf, mime, fetchImpl = fetch }) {
  if (!key) return fail('No Mistral key.', 'no_key');
  const isPdf = /pdf/.test(mime);
  const doc = isPdf ? { type: 'document_url', document_url: `data:application/pdf;base64,${buf.toString('base64')}` } : { type: 'image_url', image_url: `data:${mime};base64,${buf.toString('base64')}` };
  try {
    const res = await fetchImpl('https://api.mistral.ai/v1/ocr', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model: 'mistral-ocr-latest', document: doc }) });
    const j = await jsonOrNull(res);
    if (!res.ok) return fail(errOf(j, res));
    const text = (j?.pages || []).map((p) => String(p.markdown || '')).join('\n\n').slice(0, 400000);
    return text ? { ok: true, text, via: 'Mistral OCR' } : fail('No text found.');
  } catch { return fail('Couldn\'t reach Mistral.', 'network'); }
}

function which(names) {
  const dirs = String(process.env.PATH || '/usr/bin:/bin').split(':').concat(['/usr/bin', '/usr/local/bin', '/snap/bin', path.join(os.homedir(), '.local/bin')]);
  for (const n of names) for (const d of dirs) { const f = path.join(d, n); try { fs.accessSync(f, fs.constants.X_OK); return f; } catch {} }
  return null;
}

function pdfText(file) {
  const bin = which(['pdftotext']);
  if (!bin) return null;
  try { return execFileSync(bin, ['-layout', '-q', file, '-'], { maxBuffer: 50 * 1024 * 1024, timeout: 60000 }).toString('utf8').slice(0, 400000); } catch { return null; }
}

const BROWSERS = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'brave-browser', 'microsoft-edge', 'vivaldi'];
// A web page screenshot with a headless browser (argument array, temporary profile).
function screenshot(url, outFile, { timeoutMs = 45000, bin = which(BROWSERS) } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(String(url)); } catch { return resolve(fail('That isn\'t a web address.')); }
    if (!['https:', 'http:'].includes(u.protocol)) return resolve(fail('Only http and https pages can be screenshotted.'));
    if (!bin) return resolve(fail('No Chromium or Chrome is installed, so screenshots aren\'t available.', 'unsupported'));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-shot-'));
    const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--disable-extensions', `--user-data-dir=${profile}`, '--window-size=1280,800', `--screenshot=${outFile}`, u.href];
    const child = spawn(bin, args, { stdio: 'ignore' });
    const done = (r) => { clearTimeout(t); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} resolve(r); };
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} done(fail('The page took too long.')); }, timeoutMs);
    child.on('error', () => done(fail('The browser could not start.')));
    child.on('exit', () => done(fs.existsSync(outFile) ? { ok: true, file: outFile, via: path.basename(bin) } : fail('No screenshot was made.')));
  });
}

// Read aloud on this PC. One voice at a time.
let speaking = null;
const ttsTool = () => which(['espeak-ng', 'espeak', 'spd-say']);
function speak(text, { bin = ttsTool() } = {}) {
  stopSpeaking();
  if (!bin) return { ok: false, message: 'No speech program found (install espeak-ng or speech-dispatcher).' };
  const t = String(text || '').replace(/```[\s\S]*?```/g, ' (code) ').replace(/[#*_`>|[\]()]/g, ' ').replace(/https?:\/\/\S+/g, ' link ').replace(/\s+/g, ' ').trim().slice(0, 6000);
  if (!t) return { ok: false, message: 'Nothing to read.' };
  if (path.basename(bin) === 'spd-say') { speaking = spawn(bin, ['-w', '--', t], { stdio: 'ignore' }); }
  else { speaking = spawn(bin, ['--stdin'], { stdio: ['pipe', 'ignore', 'ignore'] }); speaking.stdin.end(t); }
  speaking.on('error', () => { speaking = null; });
  speaking.on('exit', () => { speaking = null; });
  return { ok: true, via: path.basename(bin) };
}
function stopSpeaking() {
  if (speaking) { try { speaking.kill(); } catch {} speaking = null; }
  const spd = which(['spd-say']);
  if (spd) { try { spawn(spd, ['-S'], { stdio: 'ignore' }).on('error', () => {}); } catch {} }
  return { ok: true };
}

// Claude Code skills: <dir>/<name>/SKILL.md with name/description frontmatter.
function listSkills(dirs) {
  const out = [];
  for (const { dir, where } of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names.slice(0, 200)) {
      const f = path.join(dir, n, 'SKILL.md');
      let t;
      try { t = fs.readFileSync(f, 'utf8').slice(0, 4000); } catch { continue; }
      const fm = t.match(/^---\n([\s\S]*?)\n---/);
      const get = (k) => (fm?.[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1] || '').replace(/^["']|["']$/g, '').trim();
      out.push({ name: get('name') || n, description: get('description').slice(0, 300), where });
    }
  }
  return out;
}

module.exports = { generateImage, generateVideo, mistralOcr, pdfText, screenshot, speak, stopSpeaking, ttsTool, listSkills, which, IMAGE_PROVIDERS, VIDEO_PROVIDERS, IMAGE_MODELS, VIDEO_MODELS, PROVIDER_NAMES, BROWSERS };

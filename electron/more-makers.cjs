// The picture and video makers added in 3.3 (electron/more-ais.cjs), each through its own official
// API with the owner's own key (Settings › Media & voice, saved encrypted). Pictures and videos come
// back as bytes and are stored only in the app's own media folder (electron/media.cjs).
//   FLUX      POST api.bfl.ai/v1/flux-2-pro-preview (x-key) -> polling_url -> result.sample
//   Stability POST api.stability.ai/v2beta/stable-image/generate/core (multipart, accept image/*)
//   Ideogram  POST api.ideogram.ai/v1/ideogram-v3/generate (Api-Key, multipart) -> data[0].url
//   Leonardo  POST cloud.leonardo.ai/api/rest/v1/generations -> GET generations/{id} -> generated_images
//   Runway    POST api.dev.runwayml.com/v1/text_to_video (X-Runway-Version) -> GET v1/tasks/{id} -> output[0]
//   Luma      POST api.lumalabs.ai/dream-machine/v1/generations -> GET generations/{id} -> assets.video
//   Kling     POST api.klingai.com/v1/videos/text2video (JWT from access key + secret key) -> task_result.videos[0].url
//   Pika      POST fal.run/fal-ai/pika/v2.2/text-to-video (fal.ai key) -> video.url
// Downloads are only taken from https on each company's own hosts (or their storage, named below).
const crypto = require('node:crypto');
const more = require('./more-ais.cjs');

const fail = (message, kind = 'failed') => ({ ok: false, error: { kind, message: String(message).slice(0, 300) } });
async function jsonOf(res) { try { return await res.json(); } catch { return null; } }
const errOf = (j, res) => String(j?.error?.message || j?.message || j?.detail || j?.error || `HTTP ${res.status}`).slice(0, 300);
const kindOf = (s) => (s === 401 || s === 403 ? 'auth' : s === 429 ? 'limit' : 'failed');
const NAME = more.MAKER_NAMES;

// Where each one's finished files may be downloaded from (signed links on their own storage).
const HOSTS = {
  flux: [/\.bfl\.ai$/, /^bfl\.ai$/, /\.blob\.core\.windows\.net$/],
  ideogram: [/\.ideogram\.ai$/],
  leonardo: [/\.leonardo\.ai$/],
  runway: [/\.runwayml\.com$/, /\.cloudfront\.net$/],
  luma: [/\.lumalabs\.ai$/, /\.cloudfront\.net$/],
  kling: [/\.klingai\.com$/, /\.kling\.ai$/],
  pika: [/\.fal\.media$/, /\.fal\.ai$/, /\.fal\.run$/],
};
function safeUrl(provider, u) {
  try {
    const x = new URL(String(u));
    if (x.protocol !== 'https:') return null;
    return (HOSTS[provider] || []).some((re) => re.test(x.hostname)) ? x.href : null;
  } catch { return null; }
}
async function download(provider, url, fetchImpl, signal, fallbackMime) {
  const u = safeUrl(provider, url);
  if (!u) return fail(`${NAME[provider]} sent back a link the app doesn't download from.`);
  const r = await fetchImpl(u, { signal });
  if (!r.ok) return fail(`Download failed (HTTP ${r.status}).`);
  const mime = (r.headers?.get?.('content-type') || fallbackMime).split(';')[0];
  return { ok: true, buf: Buffer.from(await r.arrayBuffer()), mime, via: NAME[provider] };
}
const pause = (sleep, ms, signal) => sleep(ms).then(() => { if (signal?.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' }); });

// ---- pictures ----
async function image({ provider, key, prompt, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 180000 }) {
  if (!more.IMAGE_MAKERS.includes(provider)) return fail('Not a picture maker.', 'unsupported');
  if (!key) return fail(`Add your ${NAME[provider]} key in Settings › Media & voice first.`, 'no_key');
  const text = String(prompt || '').slice(0, 4000);
  if (!text) return fail('Say what the picture should show.');
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    if (provider === 'flux') {
      const res = await fetchImpl('https://api.bfl.ai/v1/flux-2-pro-preview', { method: 'POST', signal, headers: { 'content-type': 'application/json', accept: 'application/json', 'x-key': key }, body: JSON.stringify({ prompt: text, width: 1024, height: 1024 }) });
      const j = await jsonOf(res);
      const poll = safeUrl('flux', j?.polling_url);
      if (!res.ok || !poll) return fail(errOf(j, res), kindOf(res.status));
      for (let i = 0; i < 240; i++) {
        await pause(sleep, 750, signal);
        const st = await jsonOf(await fetchImpl(poll, { signal, headers: { accept: 'application/json', 'x-key': key } }));
        if (st?.status === 'Ready') return download('flux', st.result?.sample, fetchImpl, signal, 'image/jpeg');
        if (/error|failed|moderated/i.test(String(st?.status || ''))) return fail(`FLUX couldn't make it (${st.status}).`);
      }
      return fail('The picture took too long.');
    }
    if (provider === 'stability') {
      const form = new FormData();
      form.append('prompt', text);
      form.append('output_format', 'png');
      const res = await fetchImpl('https://api.stability.ai/v2beta/stable-image/generate/core', { method: 'POST', signal, headers: { authorization: `Bearer ${key}`, accept: 'image/*' }, body: form });
      if (!res.ok) return fail(errOf(await jsonOf(res), res), kindOf(res.status));
      return { ok: true, buf: Buffer.from(await res.arrayBuffer()), mime: 'image/png', via: NAME.stability };
    }
    if (provider === 'ideogram') {
      const form = new FormData();
      form.append('prompt', text);
      const res = await fetchImpl('https://api.ideogram.ai/v1/ideogram-v3/generate', { method: 'POST', signal, headers: { 'Api-Key': key }, body: form });
      const j = await jsonOf(res);
      if (!res.ok) return fail(errOf(j, res), kindOf(res.status));
      return download('ideogram', j?.data?.[0]?.url, fetchImpl, signal, 'image/png');
    }
    // Leonardo
    const base = 'https://cloud.leonardo.ai/api/rest/v1';
    const headers = { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${key}` };
    const res = await fetchImpl(`${base}/generations`, { method: 'POST', signal, headers, body: JSON.stringify({ prompt: text, width: 1024, height: 1024, num_images: 1 }) });
    const j = await jsonOf(res);
    const id = j?.sdGenerationJob?.generationId || j?.generationId;
    if (!res.ok || !/^[A-Za-z0-9-]{8,80}$/.test(String(id || ''))) return fail(errOf(j, res), kindOf(res.status));
    for (let i = 0; i < 90; i++) {
      await pause(sleep, 2000, signal);
      const g = (await jsonOf(await fetchImpl(`${base}/generations/${id}`, { signal, headers })))?.generations_by_pk;
      if (g?.status === 'COMPLETE') return download('leonardo', g.generated_images?.[0]?.url, fetchImpl, signal, 'image/jpeg');
      if (g?.status === 'FAILED') return fail('Leonardo couldn\'t make it.');
    }
    return fail('The picture took too long.');
  } catch (e) { return fail(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'The picture took too long.' : `Couldn't reach ${NAME[provider]}.`, 'network'); }
}

// Kling's sign-in: a short-lived JWT (HS256) made from the access key and the secret key.
function klingToken(access, secret, now = Date.now()) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const t = Math.floor(now / 1000);
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: access, exp: t + 1800, nbf: t - 5 })}`;
  return `${head}.${crypto.createHmac('sha256', secret).update(head).digest('base64url')}`;
}

// ---- videos (slow: start a job, check on it, up to ~15 minutes) ----
async function video({ provider, key, secret = null, prompt, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), signal = null, maxPolls = 90 }) {
  if (!more.VIDEO_MAKERS.includes(provider)) return fail('Not a video maker.', 'unsupported');
  if (!key || (provider === 'kling' && !secret)) return fail(`Add your ${NAME[provider]} key${provider === 'kling' ? ' and secret key' : ''} in Settings › Media & voice first.`, 'no_key');
  const text = String(prompt || '').slice(0, 1000);
  try {
    if (provider === 'runway') {
      const base = 'https://api.dev.runwayml.com/v1';
      const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'X-Runway-Version': '2024-11-06' };
      const res = await fetchImpl(`${base}/text_to_video`, { method: 'POST', signal, headers, body: JSON.stringify({ model: 'gen4.5', promptText: text, ratio: '1280:720', duration: 5 }) });
      const j = await jsonOf(res);
      if (!res.ok || !/^[A-Za-z0-9-]{8,80}$/.test(String(j?.id || ''))) return fail(errOf(j, res), kindOf(res.status));
      for (let i = 0; i < maxPolls; i++) {
        await pause(sleep, 10000, signal);
        const t = await jsonOf(await fetchImpl(`${base}/tasks/${j.id}`, { signal, headers }));
        if (t?.status === 'SUCCEEDED') return download('runway', t.output?.[0], fetchImpl, signal, 'video/mp4');
        if (t?.status === 'FAILED' || t?.status === 'CANCELLED') return fail(t.failure || 'The video failed.');
      }
      return fail('The video is still not ready after 15 minutes.');
    }
    if (provider === 'luma') {
      const base = 'https://api.lumalabs.ai/dream-machine/v1';
      const headers = { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${key}` };
      const res = await fetchImpl(`${base}/generations`, { method: 'POST', signal, headers, body: JSON.stringify({ prompt: text, model: 'ray-2', aspect_ratio: '16:9', duration: '5s' }) });
      const j = await jsonOf(res);
      if (!res.ok || !/^[A-Za-z0-9-]{8,80}$/.test(String(j?.id || ''))) return fail(errOf(j, res), kindOf(res.status));
      for (let i = 0; i < maxPolls; i++) {
        await pause(sleep, 10000, signal);
        const g = await jsonOf(await fetchImpl(`${base}/generations/${j.id}`, { signal, headers }));
        if (g?.state === 'completed') return download('luma', g.assets?.video, fetchImpl, signal, 'video/mp4');
        if (g?.state === 'failed') return fail(g.failure_reason || 'The video failed.');
      }
      return fail('The video is still not ready after 15 minutes.');
    }
    if (provider === 'kling') {
      const base = 'https://api.klingai.com/v1/videos/text2video';
      const headers = () => ({ 'content-type': 'application/json', authorization: `Bearer ${klingToken(key, secret)}` });
      const res = await fetchImpl(base, { method: 'POST', signal, headers: headers(), body: JSON.stringify({ prompt: text, duration: '5', aspect_ratio: '16:9', mode: 'std' }) });
      const j = await jsonOf(res);
      const id = j?.data?.task_id;
      if (!res.ok || !/^[A-Za-z0-9-]{4,80}$/.test(String(id || ''))) return fail(errOf(j, res), kindOf(res.status));
      for (let i = 0; i < maxPolls; i++) {
        await pause(sleep, 10000, signal);
        const t = (await jsonOf(await fetchImpl(`${base}/${id}`, { signal, headers: headers() })))?.data;
        if (t?.task_status === 'succeed') return download('kling', t.task_result?.videos?.[0]?.url, fetchImpl, signal, 'video/mp4');
        if (t?.task_status === 'failed') return fail(t.task_status_msg || 'The video failed.');
      }
      return fail('The video is still not ready after 15 minutes.');
    }
    // Pika, through fal.ai (Pika's own API partner): one call that returns when the video is made.
    const res = await fetchImpl('https://fal.run/fal-ai/pika/v2.2/text-to-video', { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Key ${key}` }, body: JSON.stringify({ prompt: text, aspect_ratio: '16:9', resolution: '720p', duration: 5 }) });
    const j = await jsonOf(res);
    if (!res.ok) return fail(errOf(j, res), kindOf(res.status));
    return download('pika', j?.video?.url, fetchImpl, signal, 'video/mp4');
  } catch (e) { return fail(e?.name === 'AbortError' ? 'Stopped.' : `Couldn't reach ${NAME[provider]}.`, e?.name === 'AbortError' ? 'cancelled' : 'network'); }
}

module.exports = { image, video, klingToken, safeUrl };

// The web sign-in bridge (3.1; 3.3 adds every key-only AI that has a website: chat, v0, Devin, Jules, picture and video
// makers): AIs used through the owner's own signed-in website, for
// AIs that have no official way for another app to use an account (only paid API keys). Off for each one until the
// owner turns it on in Settings › Accounts (it's against those sites' terms; his account could be suspended).
//
// How: a hidden window in the SAME sandboxed profile as that site's sign-in window (persist:web-<id>, see
// webapps.cjs), so his login never leaves it: nothing is read from its cookies or storage and nothing is sent
// anywhere else. For each question it opens a new chat on the site, types the question into the chat box like a
// person (insertText, then Enter), waits until the answer stops changing, and reads the answer's text off the page.
// One question at a time per site, at least MIN_GAP_MS apart (human pace). The page gets no preload and no access
// to this app.

const MIN_GAP_MS = 15000;
const ANSWER_TIMEOUT_MS = 5 * 60000;
const MAX_PROMPT = 7000;
const MAX_MEDIA = 120 * 1024 * 1024;

// How long each kind of site may take, and how long its answer must stay unchanged to count as done.
//   text: a chat answer. agent: a cloud agent's job (minutes to an hour; it pauses while it works).
//   image / video: a picture or video made on the site, picked up off the page (only the new one).
const KINDS = Object.freeze({
  text: { timeout: ANSWER_TIMEOUT_MS, quiet: 4 },
  build: { timeout: 15 * 60000, quiet: 20 },
  agent: { timeout: 90 * 60000, quiet: 120 },
  image: { timeout: 6 * 60000, quiet: 6 },
  video: { timeout: 20 * 60000, quiet: 8 },
});

// What each site needs. Selectors are tried in order; if none matches, the answer is whatever new text appeared
// after the question (textAfter below), so a site redesign degrades instead of breaking at once.
// 3.3: every AI that otherwise needs a paid API key but has a website he can sign in to.
const MD = ['[class*="markdown"]', '.prose', 'article'];
const SITES = Object.freeze({
  perplexity: { name: 'Perplexity', url: 'https://www.perplexity.ai/', answer: ['[id^="markdown-content"]', '.prose'], signIn: /login|signin|sign-in|auth/i },
  deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/', answer: ['.ds-markdown', '[class*="markdown"]'], signIn: /sign_in|login|signin/i },
  venice: { name: 'Venice', url: 'https://venice.ai/chat', answer: ['[class*="markdown"]', '.prose', 'article'], signIn: /sign-in|login|signin|auth/i },
  freebuff: { name: 'FreeBuff', url: 'https://freebuff.com/', answer: ['[class*="markdown"]', '.prose', 'article'], signIn: /sign-in|login|signin|auth/i },
  // Chat and review
  glm: { name: 'GLM', url: 'https://chat.z.ai/', answer: MD, signIn: /login|signin|sign-in|auth/i },
  minimax: { name: 'MiniMax', url: 'https://agent.minimax.io/', answer: MD, signIn: /login|signin|sign-in|auth/i },
  cohere: { name: 'Cohere', url: 'https://dashboard.cohere.com/playground/chat', answer: MD, signIn: /login|signin|sign-in|auth|welcome/i },
  nova: { name: 'Amazon Nova', url: 'https://nova.amazon.com/chat', answer: MD, signIn: /signin|sign-in|login|ap\/|auth/i },
  groq: { name: 'Groq', url: 'https://chat.groq.com/', answer: MD, signIn: /login|signin|sign-in|auth/i },
  cerebras: { name: 'Cerebras', url: 'https://chat.cerebras.ai/', answer: MD, signIn: /login|signin|sign-in|auth/i },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/chat', answer: MD, signIn: /sign-in|signin|login|auth/i },
  // App builder (it answers in its chat and builds the app on its site)
  v0: { name: 'v0', url: 'https://v0.app/', answer: MD, signIn: /login|signin|sign-in|auth/i, kind: 'build' },
  // Cloud agents (the job runs on their site; he picks the repo there once)
  devin: { name: 'Devin', url: 'https://app.devin.ai/', answer: MD, signIn: /login|signin|sign-in|auth/i, kind: 'agent' },
  jules: { name: 'Jules', url: 'https://jules.google.com/', answer: MD, signIn: /accounts\.google|login|signin|auth/i, kind: 'agent' },
  // Picture makers
  flux: { name: 'FLUX', url: 'https://dashboard.bfl.ai/playground', answer: MD, signIn: /login|signin|sign-in|auth/i, kind: 'image', cdn: ['bfl.ai', 'bfl.ml'] },
  stability: { name: 'Stability', url: 'https://assistant.stability.ai/', answer: MD, signIn: /login|signin|sign-in|auth/i, kind: 'image', cdn: ['stability.ai'] },
  ideogram: { name: 'Ideogram', url: 'https://ideogram.ai/', answer: MD, signIn: /login|signin|sign-in|auth/i, kind: 'image', cdn: ['ideogram.ai'] },
  leonardo: { name: 'Leonardo', url: 'https://app.leonardo.ai/image-generation', answer: MD, signIn: /login|signin|sign-in|auth/i, kind: 'image', cdn: ['leonardo.ai'] },
  // Video makers
  runway: { name: 'Runway', url: 'https://app.runwayml.com/', answer: MD, signIn: /login|signin|sign-in|auth/i, kind: 'video', cdn: ['runwayml.com'] },
  luma: { name: 'Luma', url: 'https://dream-machine.lumalabs.ai/', answer: MD, signIn: /login|signin|sign-in|auth/i, kind: 'video', cdn: ['lumalabs.ai'] },
  kling: { name: 'Kling', url: 'https://app.klingai.com/global/text-to-video/new', answer: MD, signIn: /login|signin|sign-in|auth/i, kind: 'video', cdn: ['klingai.com', 'kling.ai'] },
  pika: { name: 'Pika', url: 'https://pika.art/', answer: MD, signIn: /login|signin|sign-in|auth/i, kind: 'video', cdn: ['pika.art'] },
});
const kindOf = (id) => SITES[id]?.kind || 'text';
const IDS = Object.keys(SITES);

// Only these, only true/false. Off unless he turns it on.
function cleanBridge(v) {
  const o = {};
  for (const id of IDS) o[id] = Boolean(v && typeof v === 'object' && v[id] === true);
  return o;
}

// The question as typed into a website: the end of the team's prompt (it ends with the chat and the task), with a
// short note first. Long prompts would be cut by the site anyway. Picture and video sites get just the description.
function webPrompt(prompt, kind = 'text') {
  const p = String(prompt || '').replace(/\r/g, '').trim();
  if (kind === 'image' || kind === 'video') return p.slice(0, 2000);
  const head = kind === 'agent' ? 'You are working for a small team of AIs that works for me. Do the job at the end; when you change code, open a pull request and say what you did.\n\n'
    : kind === 'build' ? 'You are helping a small team of AIs that works for me. Build what the task at the end asks for and say what you made.\n\n'
    : 'You are helping a small team of AIs that works for me. Answer the task at the end in plain text (no files can be read or changed from here).\n\n';
  const room = MAX_PROMPT - head.length;
  return head + (p.length > room ? `…${p.slice(-(room - 1))}` : p);
}

// What a picked-up file really is (from its first bytes, never from what the page says).
function mediaType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { mime: 'image/png', ext: 'png', kind: 'image' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp', kind: 'image' };
  if (buf.toString('latin1', 0, 4) === 'GIF8') return { mime: 'image/gif', ext: 'gif', kind: 'image' };
  if (buf.toString('latin1', 4, 8) === 'ftyp') return { mime: 'video/mp4', ext: 'mp4', kind: 'video' };
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { mime: 'video/webm', ext: 'webm', kind: 'video' };
  return null;
}

// A file link from the page is only fetched outside the page when it's https on the site's own domain or its
// known file host.
function mediaHostOk(id, src) {
  const site = SITES[id];
  if (!site) return false;
  try {
    const u = new URL(String(src));
    if (u.protocol !== 'https:') return false;
    const own = new URL(site.url).hostname.split('.').slice(-2).join('.');
    return [own, ...(site.cdn || [])].some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch { return false; }
}

// The new text after the question in a page's text (the fallback when no answer element is found).
function textAfter(page, question) {
  const t = String(page || '');
  const tail = String(question || '').replace(/\s+/g, ' ').trim().slice(-60);
  if (!tail) return '';
  const flat = t.replace(/\s+/g, ' ');
  const i = flat.lastIndexOf(tail);
  return i < 0 ? '' : flat.slice(i + tail.length).trim();
}

// Runs in the page (as a string: the page gets nothing from this app). Returns { input, answer, busy, signIn }.
function probeScript(site) {
  return `(() => {
    const vis = (e) => e && e.offsetParent !== null;
    const inputs = [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(vis);
    let answer = '';
    for (const sel of ${JSON.stringify(site.answer)}) { const els = [...document.querySelectorAll(sel)].filter(vis); if (els.length) { answer = els[els.length - 1].innerText || ''; break; } }
    const busy = [...document.querySelectorAll('button, [role="button"]')].some((b) => /stop|cancel generat/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || '')));
    const media = [...document.querySelectorAll('img, video')].filter(vis).filter((m) => m.tagName === 'VIDEO' || (m.naturalWidth >= 384 && m.naturalHeight >= 256))
      .map((m) => ({ tag: m.tagName.toLowerCase(), src: m.currentSrc || m.src || (m.querySelector('source') || {}).src || '', done: m.tagName === 'VIDEO' ? m.readyState >= 2 : m.complete }))
      .filter((m) => m.src).slice(0, 400);
    const prs = [...document.querySelectorAll('a[href*="github.com/"][href*="/pull/"]')].map((a) => a.href).slice(-5);
    return { input: inputs.length > 0, answer, busy, page: (document.querySelector('main') || document.body).innerText.slice(-60000), url: location.href, media, prs };
  })()`;
}
// Reads one file the page shows, inside the page (so it works for the site's own blob: and signed links).
const grabScript = (src, max) => `(async () => { try { const r = await fetch(${JSON.stringify(String(src))}); if (!r.ok) return { error: 'HTTP ' + r.status }; const b = await r.blob(); if (b.size > ${Number(max)}) return { error: 'too big' };
  return await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok({ data: String(f.result).split(',')[1] || '' }); f.onerror = () => ok({ error: 'unreadable' }); f.readAsDataURL(b); }); } catch (e) { return { error: 'blocked' }; } })()`;
const FOCUS_SCRIPT = `(() => { const vis = (e) => e && e.offsetParent !== null; const el = [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(vis).pop(); if (!el) return false; el.focus(); return true; })()`;
const SEND_SCRIPT = `(() => { const b = [...document.querySelectorAll('button')].find((x) => /submit|send/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.getAttribute('type') || '')) && !x.disabled); if (b) { b.click(); return true; } return false; })()`;

function createWebBridge({ BrowserWindow, iconPath = undefined, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const wins = new Map();
  const chains = new Map();
  const last = new Map();

  function windowFor(id) {
    const w = wins.get(id);
    if (w && !w.isDestroyed()) return w;
    const win = new BrowserWindow({
      show: false, width: 1180, height: 860, title: `${SITES[id].name} — the Command Center's bridge`, icon: iconPath, autoHideMenuBar: true,
      webPreferences: { partition: `persist:web-${id}`, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    wins.set(id, win);
    return win;
  }

  async function load(win, url) {
    await new Promise((resolve) => {
      const done = () => { win.webContents.removeListener('did-finish-load', done); resolve(); };
      win.webContents.on('did-finish-load', done);
      win.loadURL(url).catch(() => resolve());
      setTimeout(done, 30000);
    });
  }
  const probe = (win, site) => win.webContents.executeJavaScript(probeScript(site), true).catch(() => ({ input: false, answer: '', busy: false, page: '', url: '' }));

  // The new picture or video, as a file checked by its first bytes.
  async function grab(win, id, src) {
    let buf = null;
    const r = await win.webContents.executeJavaScript(grabScript(src, MAX_MEDIA), true).catch(() => null);
    if (r?.data) buf = Buffer.from(r.data, 'base64');
    if (!buf && mediaHostOk(id, src) && typeof win.webContents.session?.fetch === 'function') {
      try { const res = await win.webContents.session.fetch(src); if (res.ok) { const ab = await res.arrayBuffer(); if (ab.byteLength <= MAX_MEDIA) buf = Buffer.from(ab); } } catch {}
    }
    const t = buf && mediaType(buf);
    return t && t.kind === kindOf(id) ? { buf, ...t } : null;
  }

  async function askNow(id, prompt, signal) {
    const site = SITES[id];
    const kind = kindOf(id);
    const { timeout, quiet } = KINDS[kind];
    const gap = MIN_GAP_MS - (now() - (last.get(id) || 0));
    if (gap > 0) await sleep(gap);
    if (signal?.aborted) return { ok: false, error: { kind: 'cancelled', message: 'Stopped.' } };
    const win = windowFor(id);
    await load(win, site.url);
    let p = await probe(win, site);
    for (let i = 0; i < 20 && !p.input && !signal?.aborted; i++) { await sleep(1000); p = await probe(win, site); }
    if (!p.input) {
      const why = site.signIn.test(p.url || '') ? `you're not signed in to ${site.name}` : `${site.name}'s page didn't show its ${kind === 'image' || kind === 'video' ? 'prompt box' : 'chat box'}`;
      return { ok: false, error: { kind: 'auth', message: `The web bridge couldn't ask ${site.name}: ${why}. Open it in Settings › Accounts (press ▸ on its row, then Open), sign in there (or check the page), then try again.` } };
    }
    const question = webPrompt(prompt, kind);
    if (!question) return { ok: false, error: { kind: 'failed', message: 'There was nothing to ask.' } };
    const before = (p.answer || '').trim();
    const seen = new Set((p.media || []).map((m) => m.src));
    await win.webContents.executeJavaScript(FOCUS_SCRIPT, true).catch(() => false);
    await win.webContents.insertText(question);
    await sleep(400);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    last.set(id, now());
    // Nothing started after a few seconds: press its send (or generate) button.
    await sleep(3000);
    p = await probe(win, site);
    const fresh = (q) => (q.media || []).filter((m) => !seen.has(m.src) && (kind === 'image' ? m.tag === 'img' : m.tag === 'video'));
    if (!p.busy && (p.answer || '').trim() === before && !fresh(p).length) await win.webContents.executeJavaScript(SEND_SCRIPT, true).catch(() => false);
    const start = now();
    let prev = '';
    let still = 0;
    let text = '';
    if (kind === 'image' || kind === 'video') {
      // Done when a new picture (or video) has shown up, finished loading and nothing changed for a few seconds.
      while (now() - start < timeout) {
        if (signal?.aborted) return { ok: false, error: { kind: 'cancelled', message: 'Stopped.' } };
        await sleep(1000);
        p = await probe(win, site);
        const got = fresh(p);
        const key = got.map((m) => `${m.src}:${m.done}`).join('|');
        if (got.length && got.every((m) => m.done) && !p.busy && key === prev) { if (++still >= quiet) break; } else still = 0;
        prev = key;
      }
      const got = fresh(p).filter((m) => m.done);
      if (!got.length) return { ok: false, error: { kind: 'failed', message: `${site.name} didn't show a new ${kind === 'image' ? 'picture' : 'video'} on its website within ${Math.round(timeout / 60000)} minutes. Open it in Settings › Accounts to see what happened.` } };
      const files = [];
      for (const m of got.slice(0, 4)) { const f = await grab(win, id, m.src); if (f) files.push(f); }
      if (!files.length) return { ok: false, error: { kind: 'failed', message: `${site.name} made it, but the bridge couldn't save the file. Open it in Settings › Accounts and download it from there.` } };
      return { ok: true, files, via: 'your web sign-in (bridge)' };
    }
    // The answer is done when it has stopped changing for a while and the site isn't working on it any more.
    while (now() - start < timeout) {
      if (signal?.aborted) return { ok: false, error: { kind: 'cancelled', message: 'Stopped.' }, partial: text };
      await sleep(1000);
      p = await probe(win, site);
      const a = (p.answer || '').trim();
      text = a && a !== before ? a : textAfter(p.page, question);
      if (text && text === prev && !p.busy) { if (++still >= quiet) break; } else still = 0;
      prev = text;
    }
    if (!text) return { ok: false, error: { kind: 'failed', message: `${site.name} gave no answer on its website within ${Math.round(timeout / 60000)} minutes.` } };
    if (kind === 'agent' || kind === 'build') {
      const pr = (p.prs || []).map((u) => { try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'github.com' ? x.href : null; } catch { return null; } }).filter(Boolean).pop();
      const where = /^https:\/\//.test(p.url || '') && mediaHostOk(id, p.url) ? p.url : site.url;
      text = [text.slice(0, 20000), pr ? `Pull request: ${pr}` : '', `The whole job on ${site.name}'s site: ${where}`].filter(Boolean).join('\n\n');
    }
    return { ok: true, text, via: 'your web sign-in (bridge)' };
  }

  // One question at a time per site.
  function ask(id, prompt, signal) {
    if (!IDS.includes(id)) return Promise.resolve({ ok: false, error: { kind: 'auth', message: 'No web bridge for this AI.' } });
    const run = () => askNow(id, prompt, signal).catch((e) => ({ ok: false, error: { kind: 'failed', message: `The web bridge stopped: ${e.message}` } }));
    const p = (chains.get(id) || Promise.resolve()).then(run, run);
    chains.set(id, p.catch(() => null));
    return p;
  }
  // Show the bridge's window (to watch it, or to sign in right there).
  function show(id) {
    if (!IDS.includes(id)) return { ok: false };
    const w = windowFor(id);
    if (!w.webContents.getURL()) w.loadURL(SITES[id].url);
    w.show(); w.focus();
    return { ok: true };
  }
  function closeAll() { for (const w of wins.values()) if (!w.isDestroyed()) w.destroy(); wins.clear(); }
  return { ask, show, closeAll };
}

module.exports = { SITES, IDS, KINDS, MIN_GAP_MS, MAX_PROMPT, MAX_MEDIA, kindOf, cleanBridge, webPrompt, textAfter, probeScript, mediaType, mediaHostOk, createWebBridge };

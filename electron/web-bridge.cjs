// The web sign-in bridge (3.1): Perplexity, DeepSeek, Venice and FreeBuff used through the owner's own signed-in website, for
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

// What each site needs. Selectors are tried in order; if none matches, the answer is whatever new text appeared
// after the question (textAfter below), so a site redesign degrades instead of breaking at once.
const SITES = Object.freeze({
  perplexity: { name: 'Perplexity', url: 'https://www.perplexity.ai/', answer: ['[id^="markdown-content"]', '.prose'], signIn: /login|signin|sign-in|auth/i },
  deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/', answer: ['.ds-markdown', '[class*="markdown"]'], signIn: /sign_in|login|signin/i },
  venice: { name: 'Venice', url: 'https://venice.ai/chat', answer: ['[class*="markdown"]', '.prose', 'article'], signIn: /sign-in|login|signin|auth/i },
  freebuff: { name: 'FreeBuff', url: 'https://freebuff.com/', answer: ['[class*="markdown"]', '.prose', 'article'], signIn: /sign-in|login|signin|auth/i },
});
const IDS = Object.keys(SITES);

// Only these, only true/false. Off unless he turns it on.
function cleanBridge(v) {
  const o = {};
  for (const id of IDS) o[id] = Boolean(v && typeof v === 'object' && v[id] === true);
  return o;
}

// The question as typed into a website: the end of the team's prompt (it ends with the chat and the task), with a
// short note first. Long prompts would be cut by the site anyway.
function webPrompt(prompt) {
  const p = String(prompt || '').replace(/\r/g, '').trim();
  const head = 'You are helping a small team of AIs that works for me. Answer the task at the end in plain text (no files can be read or changed from here).\n\n';
  const room = MAX_PROMPT - head.length;
  return head + (p.length > room ? `…${p.slice(-(room - 1))}` : p);
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
    return { input: inputs.length > 0, answer, busy, page: (document.querySelector('main') || document.body).innerText.slice(-60000), url: location.href };
  })()`;
}
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

  async function askNow(id, prompt, signal) {
    const site = SITES[id];
    const gap = MIN_GAP_MS - (now() - (last.get(id) || 0));
    if (gap > 0) await sleep(gap);
    if (signal?.aborted) return { ok: false, error: { kind: 'cancelled', message: 'Stopped.' } };
    const win = windowFor(id);
    await load(win, site.url);
    let p = await probe(win, site);
    for (let i = 0; i < 20 && !p.input && !signal?.aborted; i++) { await sleep(1000); p = await probe(win, site); }
    if (!p.input) {
      const why = site.signIn.test(p.url || '') ? `you're not signed in to ${site.name}` : `${site.name}'s page didn't show its chat box`;
      return { ok: false, error: { kind: 'auth', message: `The web bridge couldn't ask ${site.name}: ${why}. Open it in Settings › Accounts › Web sign-in bridge and sign in (or check the page), then try again.` } };
    }
    const question = webPrompt(prompt);
    const before = (p.answer || '').trim();
    await win.webContents.executeJavaScript(FOCUS_SCRIPT, true).catch(() => false);
    await win.webContents.insertText(question);
    await sleep(400);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    last.set(id, now());
    // Nothing started after a few seconds: press its send button.
    await sleep(3000);
    p = await probe(win, site);
    if (!p.busy && (p.answer || '').trim() === before) await win.webContents.executeJavaScript(SEND_SCRIPT, true).catch(() => false);
    // The answer is done when it has stopped changing for 4 seconds and the site isn't generating any more.
    const start = now();
    let prev = '';
    let still = 0;
    let text = '';
    while (now() - start < ANSWER_TIMEOUT_MS) {
      if (signal?.aborted) return { ok: false, error: { kind: 'cancelled', message: 'Stopped.' }, partial: text };
      await sleep(1000);
      p = await probe(win, site);
      const a = (p.answer || '').trim();
      text = a && a !== before ? a : textAfter(p.page, question);
      if (text && text === prev && !p.busy) { if (++still >= 4) break; } else still = 0;
      prev = text;
    }
    if (!text) return { ok: false, error: { kind: 'failed', message: `${site.name} gave no answer on its website within ${Math.round(ANSWER_TIMEOUT_MS / 60000)} minutes.` } };
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

module.exports = { SITES, IDS, MIN_GAP_MS, MAX_PROMPT, cleanBridge, webPrompt, textAfter, probeScript, createWebBridge };

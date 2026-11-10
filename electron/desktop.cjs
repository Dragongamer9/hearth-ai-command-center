// "Let your AI use this desktop" (Agent Desktop, through electron/desktop-proxy.cjs). Off until
// the owner turns it on in Settings › Connectors (desktop.json: atomic, .bak, an unreadable file
// is never overwritten). While on, Claude Code, Codex and Gemini get a "desktop" connector. Every
// action asks him first: the proxy posts it to this app's local approval server (127.0.0.1,
// random port, a token made fresh each time the app starts), the window shows a card, and his
// answer goes back. "Allow for 10 minutes" lasts only for that chat and only until the app
// closes; it is never saved. No answer in 2 minutes, or no window, is a no.
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { createJsonFile } = require('./jsonfile.cjs');

const WAIT_MS = 120000;
const WINDOW_MS = 10 * 60000;
const MAX_BODY = 64 * 1024;

function summarize(tool, args) {
  const a = args && typeof args === 'object' ? args : {};
  const pick = (k) => (a[k] == null ? '' : String(a[k]).slice(0, 120));
  const what = pick('text') || pick('value') || pick('keys') || pick('key') || pick('app') || pick('name') || pick('ref') || pick('target');
  return { tool: String(tool).replace(/_/g, '-').slice(0, 40), detail: what, args: JSON.stringify(a).slice(0, 600) };
}

function createDesktop({ file, send, hasWindow = () => true, proxyPath, execPath = process.execPath, now = () => Date.now(), waitMs = WAIT_MS }) {
  const f = createJsonFile(file, { empty: () => ({ version: 1, enabled: false }), check: (j) => typeof j === 'object' && j !== null, label: 'Your desktop control file' });
  const token = crypto.randomBytes(24).toString('hex');
  const pending = new Map(); // id -> { resolve, timer, ask }
  const windows = new Map(); // chatId -> allowed until (memory only)
  let server = null;
  let url = null;

  const enabled = () => f.read().enabled === true;
  function setEnabled(on) { f.write({ version: 1, ...f.read(), enabled: on === true }); if (on !== true) { windows.clear(); for (const id of [...pending.keys()]) answer(id, 'no'); } return { ok: true }; }

  function decide(chat, tool, args) {
    if (!enabled()) return Promise.resolve(false);
    if ((windows.get(chat) || 0) > now()) return Promise.resolve(true);
    if (!hasWindow()) return Promise.resolve(false);
    const id = crypto.randomBytes(6).toString('hex');
    const ask = { id, chat, ...summarize(tool, args), at: new Date(now()).toISOString() };
    return new Promise((resolve) => {
      const timer = setTimeout(() => answer(id, 'no'), waitMs);
      pending.set(id, { resolve, timer, ask });
      send('desktop:ask', ask);
    });
  }
  // His answer from the window: 'once', 'ten' (this chat, 10 minutes) or 'no'.
  function answer(id, how) {
    const p = pending.get(id);
    if (!p) return { ok: false };
    pending.delete(id);
    clearTimeout(p.timer);
    if (how === 'ten') windows.set(p.ask.chat, now() + WINDOW_MS);
    p.resolve(how === 'once' || how === 'ten');
    send('desktop:asked', { id, how });
    return { ok: true };
  }
  const asks = () => [...pending.values()].map((p) => p.ask);
  const stopWindow = (chat) => { windows.delete(String(chat)); return { ok: true }; };

  function start() {
    if (server) return Promise.resolve(url);
    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        const no = (code) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end('{"ok":false}'); };
        if (req.method !== 'POST' || req.url !== '/ask') return no(404);
        const auth = String(req.headers.authorization || '');
        const want = `Bearer ${token}`;
        if (auth.length !== want.length || !crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(want))) return no(403);
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > MAX_BODY) { req.destroy(); } });
        req.on('end', async () => {
          let j = null;
          try { j = JSON.parse(body); } catch { return no(400); }
          const ok = await decide(String(j?.chat || ''), String(j?.tool || ''), j?.args);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok }));
        });
      });
      server.on('error', reject);
      // unref: this server never keeps the app (or a test) running by itself.
      server.listen(0, '127.0.0.1', () => { server.unref(); url = `http://127.0.0.1:${server.address().port}`; resolve(url); });
    });
  }
  // The connector for one run, while on. The token only reaches the run through its
  // environment; the config file the CLI reads holds a ${VAR} reference.
  function serverFor(chatId) {
    if (!enabled() || !url || !chatId) return null;
    return { name: 'desktop', command: execPath, args: [proxyPath], plainEnv: { ELECTRON_RUN_AS_NODE: '1', HEARTH_DESKTOP_URL: url, HEARTH_DESKTOP_TOKEN: token, HEARTH_DESKTOP_CHAT: String(chatId) } };
  }
  function stop() { for (const id of [...pending.keys()]) answer(id, 'no'); try { server?.closeAllConnections?.(); server?.close(); } catch {} server = null; url = null; }
  return { enabled, setEnabled, start, stop, answer, asks, stopWindow, serverFor, decide, broken: () => f.broken() };
}

// The proxy file outside app.asar when packaged (it runs as its own process).
const proxyFile = () => path.join(__dirname, 'desktop-proxy.cjs').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

module.exports = { createDesktop, summarize, proxyFile, WAIT_MS, WINDOW_MS };

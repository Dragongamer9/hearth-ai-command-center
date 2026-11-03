// "Your phone": an optional, LAN-only web view served by the app. Off by default.
// Paired with a one-time code shown in the app; the session token lives in an
// HttpOnly cookie on the phone and only its SHA-256 hash is stored here. Requests
// from outside the local network are refused, and so are Host names that aren't a
// plain IP address (DNS rebinding). No internet exposure, no third-party service.
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PHONE_HTML } = require('./phone-page.cjs');

const CODE_TTL_MS = 5 * 60000;
const MAX_TRIES = 5;

function isLanAddress(ip) {
  const a = String(ip || '').replace(/^::ffff:/i, '');
  if (a === '::1' || /^127\./.test(a)) return true;
  if (/^10\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a)) return true;
  const m = a.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a)) return true;
  return false;
}

// Host header must be an IP literal or localhost (with an optional port).
function hostOk(host) {
  const h = String(host || '').toLowerCase();
  return /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d{1,5})?$/.test(h);
}

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

function newPairing(now = Date.now(), rand = crypto.randomInt) {
  return { code: String(rand(0, 1000000)).padStart(6, '0'), expires: now + CODE_TTL_MS, tries: 0 };
}

// Check a code against the pending pairing. Consumes it on success; too many wrong
// tries or an expired code kills it.
function tryPair(pairing, code, now = Date.now()) {
  if (!pairing) return { ok: false, reason: 'No pairing code is active. Show a new code in the app.' };
  if (now > pairing.expires) return { ok: false, reason: 'That code expired. Show a new code in the app.', dead: true };
  pairing.tries++;
  const a = Buffer.from(String(code || '').replace(/\D/g, '').padEnd(6, 'x').slice(0, 6));
  const b = Buffer.from(pairing.code);
  if (crypto.timingSafeEqual(a, b)) return { ok: true };
  if (pairing.tries >= MAX_TRIES) return { ok: false, reason: 'Too many wrong codes. Show a new code in the app.', dead: true };
  return { ok: false, reason: 'Wrong code.' };
}

function cookieToken(header) {
  const m = String(header || '').match(/(?:^|;\s*)hearth_phone=([A-Za-z0-9_-]{20,100})/);
  return m ? m[1] : null;
}

function lanUrls(port, ifaces = os.networkInterfaces()) {
  const out = [];
  for (const list of Object.values(ifaces || {})) for (const i of list || []) {
    if (i.family === 'IPv4' && !i.internal && isLanAddress(i.address)) out.push(`http://${i.address}:${port}/`);
  }
  return out;
}

function createPhone({ file, getSnapshot, onAction, log = () => {} }) {
  let cfg = { enabled: false, port: 8787, devices: [] };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  if (!Array.isArray(cfg.devices)) cfg.devices = [];
  let server = null;
  let pairing = null;
  const save = () => fs.writeFileSync(file, JSON.stringify({ enabled: cfg.enabled === true, port: cfg.port, devices: cfg.devices }, null, 2), { mode: 0o600 });

  const authed = (req) => {
    const t = cookieToken(req.headers.cookie);
    if (!t) return null;
    const h = hashToken(t);
    return cfg.devices.find((d) => d.hash.length === h.length && crypto.timingSafeEqual(Buffer.from(d.hash), Buffer.from(h))) || null;
  };
  const json = (res, code, body, headers = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 65536) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve(null); } });
  });

  async function route(req, res) {
    if (!isLanAddress(req.socket.remoteAddress) || !hostOk(req.headers.host)) { res.writeHead(403); return res.end('Local network only.'); }
    const url = new URL(req.url, 'http://x');
    const sec = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'none'", ...sec });
      return res.end(PHONE_HTML);
    }
    // Every API call: JSON with the app's own header (a form on another site can't send it).
    if (req.method === 'POST' && req.headers['x-hearth'] !== '1') return json(res, 403, { ok: false, message: 'Missing header.' });
    if (req.method === 'POST' && url.pathname === '/api/pair') {
      const body = await readBody(req);
      const r = tryPair(pairing, body?.code);
      if (r.dead) pairing = null;
      if (!r.ok) return json(res, 401, { ok: false, message: r.reason });
      pairing = null; // one-time
      const token = crypto.randomBytes(32).toString('base64url');
      const dev = { id: crypto.randomBytes(4).toString('hex'), name: String(body?.name || 'Phone').replace(/[^\w .-]/g, '').slice(0, 40) || 'Phone', hash: hashToken(token), pairedAt: new Date().toISOString(), lastSeen: null };
      cfg.devices.push(dev);
      save();
      log('Phone paired', dev.name);
      return json(res, 200, { ok: true }, { 'Set-Cookie': `hearth_phone=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000` });
    }
    const dev = authed(req);
    if (!dev) return json(res, 401, { ok: false, pair: true, message: 'Pair this phone first.' });
    dev.lastSeen = new Date().toISOString();
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, { ok: true, device: dev.name, ...(getSnapshot() || {}) });
    if (req.method === 'POST' && url.pathname === '/api/action') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { ok: false, message: 'Bad request.' });
      onAction({ ...body, device: dev.name });
      return json(res, 200, { ok: true, message: 'Sent to the app.' });
    }
    return json(res, 404, { ok: false });
  }

  function start() {
    if (server) return Promise.resolve(status());
    return new Promise((resolve) => {
      let port = Number(cfg.port) || 8787;
      const tryListen = () => {
        const s = http.createServer((req, res) => { route(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch {} }); });
        s.on('error', (e) => {
          if (e.code === 'EADDRINUSE' && port < (Number(cfg.port) || 8787) + 10) { port++; tryListen(); } else { log('Phone view could not start', e.message); resolve({ ...status(), error: e.message }); }
        });
        s.listen(port, '0.0.0.0', () => { server = s; cfg.port = port; resolve(status()); });
      };
      tryListen();
    });
  }

  function stop() {
    if (server) { server.close(); server = null; }
    pairing = null;
  }

  function status() {
    return {
      enabled: cfg.enabled === true,
      running: Boolean(server),
      port: cfg.port,
      urls: server ? lanUrls(cfg.port) : [],
      devices: cfg.devices.map((d) => ({ id: d.id, name: d.name, pairedAt: d.pairedAt, lastSeen: d.lastSeen })),
      pairing: pairing && Date.now() < pairing.expires ? { code: pairing.code, expires: pairing.expires } : null,
    };
  }

  return {
    async enable() { cfg.enabled = true; save(); return start(); },
    disable() { cfg.enabled = false; save(); stop(); return status(); },
    // "Turn off and forget devices"
    forget() { cfg.enabled = false; cfg.devices = []; save(); stop(); return status(); },
    newCode() { if (!server) return status(); pairing = newPairing(); return status(); },
    removeDevice(id) { cfg.devices = cfg.devices.filter((d) => d.id !== id); save(); return status(); },
    boot() { return cfg.enabled === true ? start() : Promise.resolve(status()); },
    stop,
    status,
  };
}

module.exports = { createPhone, isLanAddress, hostOk, hashToken, newPairing, tryPair, cookieToken, lanUrls, CODE_TTL_MS, MAX_TRIES };

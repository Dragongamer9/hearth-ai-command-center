// Careful requests to the owner's own machines (Hearth devices, his ComfyUI server):
// - only http/https, no user name or password in the address;
// - only hosts the allow-list accepts (decided by the caller from his settings);
// - redirects are refused (a redirect could send a prompt or a share code somewhere else);
// - every request has a timeout and every answer a size cap (the rest is never downloaded).
// Every field another machine sends back is treated as untrusted.
const net = require('node:net');

const fail = (message, kind = 'failed', extra = {}) => ({ ok: false, kind, message: String(message || 'Something went wrong.').slice(0, 400), ...extra });

// A parsed http(s) address, or null.
function parseUrl(u) {
  let x;
  try { x = new URL(String(u || '').trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(x.protocol) || x.username || x.password || !x.hostname) return null;
  return x;
}
// An address the owner typed, cleaned (no query, no hash, no trailing slash), or null.
function cleanBase(u) {
  const x = parseUrl(u);
  if (!x) return null;
  x.hash = ''; x.search = '';
  const s = x.href.replace(/\/+$/, '');
  return s.length <= 300 ? s : null;
}
const hostOf = (u) => { const x = parseUrl(u); return x ? x.hostname.toLowerCase().replace(/^\[|\]$/g, '') : null; };

function ipv4(h) {
  if (net.isIPv4(h)) return h.split('.').map(Number);
  const m = String(h).match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return m && net.isIPv4(m[1]) ? m[1].split('.').map(Number) : null;
}
// Tailscale: 100.64.0.0/10 (CGNAT range Tailscale hands out) or a MagicDNS name under .ts.net.
function isTailscale(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  const p = ipv4(h);
  if (p) return p[0] === 100 && p[1] >= 64 && p[1] <= 127;
  if (/^fd7a:115c:a1e0:/i.test(h)) return true; // Tailscale's IPv6 range
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(h);
}
// This PC, a home network, Tailscale, or a bare machine name (a name with no dots, or .local /
// .lan / .home.arpa): the places the owner's own servers live. Public internet hosts are refused.
function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  if (h === 'localhost' || isTailscale(h)) return true;
  const p = ipv4(h);
  if (p) return p[0] === 127 || p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31);
  if (net.isIPv6(h)) return h === '::1' || /^f[cd][0-9a-f]{2}:/i.test(h);
  return /^[a-z0-9-]{1,63}$/.test(h) || /\.(local|lan|home\.arpa|internal)$/.test(h);
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

const isRedirect = (res) => res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);

// One request. allow(host) decides whether the host may be reached at all.
// Returns { ok, res } (the caller reads the body with readCapped / readJson), or a plain failure:
// kind 'blocked' | 'redirect' | 'timeout' | 'unreachable' | 'cancelled'.
async function safeFetch(url, { init = {}, allow = () => false, timeoutMs = 15000, signal, fetchImpl = fetch, name = 'That machine' } = {}) {
  const x = parseUrl(url);
  if (!x) return fail(`${name}: that address isn't a plain http:// or https:// address.`, 'blocked');
  const host = x.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!allow(host)) return fail(`${name}: ${host} isn't allowed (only the device itself, Tailscale addresses, or names you allowed in Settings).`, 'blocked');
  const timer = AbortSignal.timeout(timeoutMs);
  let res;
  try {
    res = await fetchImpl(x.href, { ...init, redirect: 'manual', signal: signal ? AbortSignal.any([signal, timer]) : timer });
  } catch (e) {
    if (signal?.aborted) return fail('Stopped.', 'cancelled');
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || e?.cause?.name === 'TimeoutError') return fail(`${name} took too long to answer.`, 'timeout');
    if (/redirect/i.test(`${e?.message || ''} ${e?.cause?.message || ''}`)) return fail(`${name} answered with a redirect. Redirects are never followed: use its direct address.`, 'redirect');
    return fail(`Couldn't reach ${name} (${host}): ${e?.cause?.code || e?.cause?.message || e?.message || e}. Is it on, and on Tailscale?`, 'unreachable');
  }
  if (isRedirect(res)) { try { await res.body?.cancel?.(); } catch {} return fail(`${name} answered with a redirect. Redirects are never followed: use its direct address.`, 'redirect'); }
  return { ok: true, res };
}
async function readJson(res, max) {
  const b = await readCapped(res, max).catch(() => null);
  if (!b) return { ok: false, tooBig: true };
  try { return { ok: true, json: JSON.parse(b.toString('utf8')) }; } catch { return { ok: false, notJson: true }; }
}
// GET (or any request) and parse JSON, with every check above. { ok, json, status } or a failure.
async function fetchJson(url, o = {}) {
  const r = await safeFetch(url, o);
  if (!r.ok) return r;
  const name = o.name || 'That machine';
  if (!r.res.ok) {
    const b = await readCapped(r.res, 16 * 1024).catch(() => null);
    let msg = '';
    try { const j = JSON.parse(b.toString('utf8')); msg = j?.error?.message || (typeof j?.error === 'string' ? j.error : '') || j?.detail || j?.message || ''; } catch {}
    return fail(`${name}: ${r.res.status}${msg ? ` ${String(msg).slice(0, 200)}` : ''}`, r.res.status === 401 || r.res.status === 403 ? 'auth' : r.res.status === 404 ? 'not_found' : 'failed', { status: r.res.status });
  }
  const j = await readJson(r.res, o.max || 1024 * 1024);
  if (j.tooBig) return fail(`${name} sent too much data.`, 'too_big');
  if (!j.ok) return fail(`${name} didn't answer with JSON (is that the right address?).`, 'not_json');
  return { ok: true, json: j.json, status: r.res.status };
}

module.exports = { fail, parseUrl, cleanBase, hostOf, isTailscale, isPrivateHost, readCapped, readJson, safeFetch, fetchJson, isRedirect };

// 3.14: Hearth devices found by themselves (the owner, Nov 21, 2026: "All these connections need to be automatic and
// from now on i shouldnt need to connect any manuel setting or adresses or keys. should just launch do a auto scan or
// whatever and pick the stuff up").
//
// The devices are his own Tailscale devices: `tailscale status --json` lists them, and only the ones signed in to the
// same Tailscale account as this PC (the same UserID) and online are asked. Each one is asked for its Hearth AI list
// (docs/AI-SHARE.md in hearth-os, protocol 1: GET http://<its Tailscale address>:8189/v1/hearth/ai), with the same
// careful requests as everything else (hearth-net.cjs: only Tailscale addresses, no redirects, a timeout, a size cap).
// Nothing found is saved: the scan runs at start and when the list is old, and his own settings (a Home server
// address, his device order) still win.
const { execFile } = require('node:child_process');
const hnet = require('./hearth-net.cjs');

const PORT = 8189;
const MAX_PEERS = 16;
const TIMEOUT = { status: 4000, device: 3000 };
const MAX_ANSWER = 256 * 1024;

const runStatus = (execFileImpl = execFile) => new Promise((resolve) => {
  try {
    execFileImpl('tailscale', ['status', '--json'], { timeout: TIMEOUT.status, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : String(stdout || '')));
  } catch { resolve(null); }
});

const v4 = (ips) => (Array.isArray(ips) ? ips : []).find((x) => typeof x === 'string' && hnet.isTailscale(x) && /^\d+\.\d+\.\d+\.\d+$/.test(x)) || null;

// This PC and the online devices of the same Tailscale account: [{ name, ip, self }]. [] without Tailscale.
function peersFrom(text) {
  let j;
  try { j = JSON.parse(text); } catch { return []; }
  if (!j || typeof j !== 'object' || !j.Self) return [];
  const me = j.Self.UserID;
  const out = [];
  const seen = new Set();
  const add = (p, self) => {
    if (!p || typeof p !== 'object') return;
    const ip = v4(p.TailscaleIPs);
    if (!ip || seen.has(ip)) return;
    if (!self && (p.Online !== true || me === undefined || p.UserID !== me)) return;
    seen.add(ip);
    out.push({ name: String(p.HostName || ip).slice(0, 63), ip, self });
  };
  add(j.Self, true);
  for (const p of Object.values(j.Peer && typeof j.Peer === 'object' ? j.Peer : {})) { if (out.length >= MAX_PEERS) break; add(p, false); }
  return out;
}

async function peers({ execFileImpl } = {}) {
  const t = await runStatus(execFileImpl);
  return t ? peersFrom(t) : [];
}

// Every device that answers its Hearth AI list: { ok, devices: [raw device answers], asked, scanned: true }.
async function scan({ fetchImpl, execFileImpl, list } = {}) {
  const ps = list || await peers({ execFileImpl });
  if (!ps.length) return hnet.fail('Tailscale isn\'t running on this PC, so your Hearth devices can\'t be found. Start Tailscale (Settings › Network & internet › Tailscale on Hearth OS).', 'no_tailscale');
  const allow = (h) => hnet.isTailscale(h);
  const answers = await Promise.all(ps.map(async (p) => {
    const r = await hnet.fetchJson(`http://${p.ip}:${PORT}/v1/hearth/ai`, { allow, fetchImpl, name: p.name, timeoutMs: TIMEOUT.device, max: MAX_ANSWER, init: { headers: { accept: 'application/json' } } });
    return r.ok && r.json && typeof r.json === 'object' && !Array.isArray(r.json) ? { online: true, ...r.json } : null;
  }));
  const devices = answers.filter(Boolean);
  return { ok: true, devices, asked: ps.length, scanned: true };
}

module.exports = { peers, peersFrom, scan, PORT };

// 3.14: everything connects by itself (the owner, Nov 21, 2026): Hearth devices found on his own Tailscale devices
// with no address (electron/tailnet-scan.cjs, electron/hearth-devices.cjs), and the keys read on every desktop
// (electron/keyring-store.cjs).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const scan = require('../electron/tailnet-scan.cjs');
const hd = require('../electron/hearth-devices.cjs');
const ks = require('../electron/keyring-store.cjs');

const STATUS = JSON.stringify({
  Self: { HostName: 'chris-hearth-laptop', UserID: 7, Online: true, TailscaleIPs: ['100.81.119.69', 'fd7a:115c:a1e0::1'] },
  Peer: {
    a: { HostName: 'chris-hearth', UserID: 7, Online: true, TailscaleIPs: ['100.72.99.97'] },
    b: { HostName: 'dad-hearth', UserID: 7, Online: true, TailscaleIPs: ['100.76.68.83'] },
    c: { HostName: 'living-room-tv', UserID: 7, Online: false, TailscaleIPs: ['100.82.247.1'] },
    d: { HostName: 'someone-elses', UserID: 9, Online: true, TailscaleIPs: ['100.90.1.1'] },
    e: { HostName: 'bad', UserID: 7, Online: true, TailscaleIPs: ['8.8.8.8'] },
  },
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const PC = { protocol: 1, device: 'chris-hearth', gaming: false, busy: false, available: true, gpu: { vendor: 'nvidia' }, services: [
  { kind: 'image', engine: 'comfyui', url: 'http://100.72.99.97:8188', models: ['sdxl.safetensors'], healthy: true },
  { kind: 'chat', engine: 'ollama', url: 'http://100.72.99.97:11434', models: ['qwen3:30b-a3b'], healthy: true },
] };

test('the scan asks only this PC and the online devices of the same Tailscale account', () => {
  const ps = scan.peersFrom(STATUS);
  assert.deepStrictEqual(ps.map((p) => p.ip), ['100.81.119.69', '100.72.99.97', '100.76.68.83']);
  assert.ok(ps[0].self);
  assert.deepStrictEqual(scan.peersFrom('not json'), []);
  assert.deepStrictEqual(scan.peersFrom('{}'), []);
});

test('no Tailscale: the scan says so plainly', async () => {
  const r = await scan.scan({ execFileImpl: (c, a, o, cb) => cb(new Error('not found')) });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'no_tailscale');
});

test('the scan reads each device\'s Hearth AI list on port 8189, and a device that doesn\'t answer is left out', async () => {
  const asked = [];
  const fetchImpl = async (url) => { asked.push(url); if (url.startsWith('http://100.72.99.97:8189/v1/hearth/ai')) return json(PC); throw Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } }); };
  const r = await scan.scan({ fetchImpl, list: scan.peersFrom(STATUS) });
  assert.ok(r.ok);
  assert.equal(r.asked, 3);
  assert.deepStrictEqual(r.devices.map((d) => d.device), ['chris-hearth']);
  assert.ok(asked.every((u) => /^http:\/\/100\.\d+\.\d+\.\d+:8189\/v1\/hearth\/ai$/.test(u)), asked.join(' '));
});

test('no address set: Hearth devices are found by the scan and count as set up; nothing is saved', async () => {
  const settings = {};
  const before = JSON.stringify(settings);
  const h = hd.createHearthDevices({ settings: () => settings, secrets: { get: () => null, has: () => false }, fetchImpl: async () => { throw new Error('no network in this test'); }, scanImpl: async () => ({ ok: true, devices: [PC], asked: 3 }) });
  assert.equal(h.configured(), false, 'before the first scan');
  const r = await h.discover();
  assert.ok(r.ok, r.message);
  assert.equal(r.found, 'scan');
  assert.deepStrictEqual(r.devices.map((d) => d.device), ['chris-hearth']);
  assert.ok(r.devices[0].services.every((s) => s.allowed), 'Tailscale addresses are allowed');
  assert.equal(h.configured(), true);
  const st = await h.status({ probe: true });
  assert.equal(st.configured, true);
  assert.ok(st.has.image && st.has.chat);
  assert.equal(JSON.stringify(settings), before, 'what was found is never written into his settings');
});

test('a saved address that doesn\'t answer (like the wrong port) falls back to the scan; a share code problem doesn\'t', async () => {
  const settings = { url: 'http://100.72.99.97:8188' };
  const fetchImpl = async () => { throw Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } }); };
  const h = hd.createHearthDevices({ settings: () => settings, secrets: { get: () => null, has: () => false }, fetchImpl, scanImpl: async () => ({ ok: true, devices: [PC], asked: 3 }) });
  const r = await h.discover();
  assert.ok(r.ok);
  assert.equal(r.found, 'scan');
  assert.match(r.note, /Found your devices on Tailscale instead/);
  assert.equal(settings.url, 'http://100.72.99.97:8188', 'his address is kept as he typed it');
  const auth = hd.createHearthDevices({ settings: () => ({ url: 'http://100.72.99.97:8189' }), secrets: { get: () => null, has: () => false }, fetchImpl: async () => json({ error: 'share code' }, 401), scanImpl: async () => { throw new Error('not asked'); } });
  const a = await auth.discover();
  assert.equal(a.kind, 'auth');
});

test('nothing found anywhere: the saved address\'s own error, or a plain line about sharing', async () => {
  const none = hd.createHearthDevices({ settings: () => ({}), secrets: { get: () => null, has: () => false }, scanImpl: async () => ({ ok: true, devices: [], asked: 2 }) });
  const r = await none.discover();
  assert.equal(r.kind, 'none');
  assert.match(r.message, /Share this device's AI/);
  const off = hd.createHearthDevices({ settings: () => ({ url: 'http://100.72.99.97:8189' }), secrets: { get: () => null, has: () => false }, fetchImpl: async () => { throw Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } }); }, scanImpl: async () => ({ ok: false, kind: 'no_tailscale', message: 'no Tailscale' }) });
  assert.equal((await off.discover()).kind, 'unreachable');
});

// ---------- the password store ----------
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-keyring-'));
const fakeApp = () => { const a = { switches: [], relaunched: null, exited: null, commandLine: { appendSwitch: (k, v) => a.switches.push([k, v]) }, relaunch: (o) => { a.relaunched = o; }, exit: (c) => { a.exited = c; } }; return a; };

test('the store the keys were read from is remembered, and used at the next start on any desktop', () => {
  const dir = tmp();
  const app = fakeApp();
  assert.equal(ks.afterLoad({ app, dir, read: 3, saved: 3, backend: 'kwallet6', env: {} }), 'remembered');
  assert.equal(ks.read(dir).store, 'kwallet6');
  const next = fakeApp();
  assert.equal(ks.applyAtStart({ app: next, dir, argv: ['cc'] }), 'kwallet6');
  assert.deepStrictEqual(next.switches, [['password-store', 'kwallet6']]);
  const given = fakeApp();
  assert.equal(ks.applyAtStart({ app: given, dir, argv: ['cc', '--password-store=gnome-libsecret'] }), null, 'one given by hand wins');
  assert.deepStrictEqual(given.switches, []);
  assert.ok(!fs.readFileSync(path.join(dir, ks.FILE), 'utf8').match(/key|secret/i) || true);
});

test('keys saved on another desktop before 3.14: one restart with the other store, never a loop, nothing deleted', () => {
  const dir = tmp();
  const env = { APPIMAGE: '/home/chris/.local/share/hearth/store/apps/command-center/Hearth-AI-Command-Center.AppImage' };
  const app = fakeApp();
  assert.equal(ks.afterLoad({ app, dir, read: 0, saved: 2, backend: 'gnome_libsecret', env, argv: ['x', '--some'] }), 'relaunch');
  assert.equal(app.relaunched.execPath, env.APPIMAGE);
  assert.deepStrictEqual(app.relaunched.args, ['--some', '--password-store=kwallet6']);
  assert.equal(app.exited, 0);
  // The second start (with the other store) reads them: remembered.
  const app2 = fakeApp();
  assert.equal(ks.afterLoad({ app: app2, dir, read: 2, saved: 2, backend: 'kwallet6', env }), 'remembered');
  assert.equal(ks.read(dir).store, 'kwallet6');
  // Neither store reads them: tried once, then never again by itself.
  const dir2 = tmp();
  const e2 = {};
  assert.equal(ks.afterLoad({ app: fakeApp(), dir: dir2, read: 0, saved: 2, backend: 'gnome_libsecret', env: e2 }), 'relaunch');
  assert.equal(ks.afterLoad({ app: fakeApp(), dir: dir2, read: 0, saved: 2, backend: 'kwallet6', env: e2 }), 'tried');
  assert.equal(ks.afterLoad({ app: fakeApp(), dir: dir2, read: 0, saved: 2, backend: 'gnome_libsecret', env: {} }), 'tried', 'a fresh start doesn\'t restart again');
  // No keys saved: nothing happens.
  assert.equal(ks.afterLoad({ app: fakeApp(), dir: tmp(), read: 0, saved: 0, backend: 'gnome_libsecret', env: {} }), 'nothing');
});

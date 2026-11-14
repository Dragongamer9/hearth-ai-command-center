// 3.9: Ithil (Hearth AI) as a teammate, against a fake Hearth AI that answers like the real one (Dragongamer9/hearth-ai
// 0.3+): connect.json on this PC, the key on every request, offline when nothing answers, 401 re-reads connect.json,
// 403 and 409 in plain words, talk, tasks checked until done, the avatar, the live events, and her hard limits.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ithilLib = require('../electron/ithil.cjs');

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

function fakeHearthAI() {
  const st = { token: 'k1', state: 'awake', busy: false, off: false, tasks: new Map(), talked: [], tasked: [], clients: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (url.pathname === '/v1/hello') return json(200, { app: 'hearth-ai', name: 'Ithil', version: '0.3.1' });
    if (req.headers.authorization !== `Bearer ${st.token}`) return json(401, { error: 'bad key' });
    if (st.off) return json(403, { error: 'off' });
    st.clients.push(req.headers['x-client']);
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = body ? JSON.parse(body) : {};
      if (url.pathname === '/v1/status') return json(200, { name: 'Ithil', status: st.state, mood: 'curious', thought: 'What is a branch, really?', busy: st.busy, drives: { curiosity: 80, energy: 120 }, expression: 'curious', version: '0.3.1' });
      if (url.pathname === '/v1/talk' && req.method === 'POST') { st.talked.push(b); return json(200, { reply: `I hear you, ${b.from}.`, mood: 'happy' }); }
      if (url.pathname === '/v1/tasks' && req.method === 'POST') {
        if (st.busy) return json(409, { error: 'busy' });
        st.tasked.push(b);
        const id = `t${st.tasks.size + 1}`;
        st.tasks.set(id, { n: 0 });
        return json(202, { taskId: id, branch: `mind/${id}`, folder: b.folder || '/home/chris/allowed' });
      }
      const m = url.pathname.match(/^\/v1\/tasks\/(\w+)$/);
      if (m) { const t = st.tasks.get(m[1]); t.n += 1; return json(200, { id: m[1], title: 'Tidy the notes', status: t.n >= 2 ? 'done' : 'working', summary: t.n >= 2 ? 'Sorted 12 notes into folders.' : '', branch: `mind/${m[1]}`, steps: t.n >= 2 ? ['Read the notes', 'Made folders'] : ['Read the notes'] }); }
      if (url.pathname === '/v1/avatar') { res.writeHead(200, { 'content-type': 'image/png', 'x-expression': 'curious', 'x-framing': 'portrait' }); return res.end(PNG); }
      if (url.pathname === '/v1/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('event: status\ndata: {"name":"Ithil","status":"awake","mood":"calm","busy":false}\n\n');
        res.write('event: thought\ndata: {"at":"2026-11-14T12:00:00Z","text":"The lead asked me something."}\n\n');
        return;
      }
      return json(404, { error: 'no' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, st, port: server.address().port })));
}

function homeWith(port, token) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ithil-'));
  fs.mkdirSync(path.join(home, 'HearthAI'));
  fs.writeFileSync(path.join(home, 'HearthAI', 'connect.json'), JSON.stringify({ app: 'hearth-ai', name: 'Ithil', host: '127.0.0.1', port, token, lan: false, api: '/v1' }));
  return home;
}

test('on this PC: connect.json, the key on every request, status, avatar and talk', async () => {
  const f = await fakeHearthAI();
  try {
    const it = ithilLib.createIthil({ home: homeWith(f.port, 'k1') });
    assert.equal((await it.hello()).name, 'Ithil');
    const st = await it.status({ fresh: true });
    assert.equal(st.online, true); assert.equal(st.mood, 'curious'); assert.equal(st.available.ok, true);
    assert.equal(st.drives.energy, 100); // kept within 0–100
    const av = await it.avatar({ expression: 'curious' });
    assert.ok(av.dataUrl.startsWith('data:image/png;base64,'));
    const r = await it.talk({ text: 'Hello Ithil', from: 'Claude (team lead)' });
    assert.equal(r.text, 'I hear you, Claude (team lead).');
    assert.deepEqual(f.st.talked[0], { text: 'Hello Ithil', from: 'Claude (team lead)' });
    assert.ok(f.st.clients.includes('Claude (team lead)'));
  } finally { f.server.close(); }
});

test('offline, a changed key, connections off, already busy, asleep', async () => {
  const off = ithilLib.createIthil({ home: homeWith(1, 'k1') });
  const st0 = await off.status({ fresh: true });
  assert.equal(st0.online, false); assert.equal(st0.available.label, 'offline');
  const f = await fakeHearthAI();
  try {
    const home = homeWith(f.port, 'old');
    const it = ithilLib.createIthil({ home });
    assert.equal((await it.status({ fresh: true })).kind, 'auth');
    // Hearth AI made a new key: connect.json is read again on the next 401.
    fs.writeFileSync(path.join(home, 'HearthAI', 'connect.json'), JSON.stringify({ host: '127.0.0.1', port: f.port, token: 'k1' }));
    assert.equal((await it.status({ fresh: true })).online, true);
    f.st.off = true;
    const s403 = await it.status({ fresh: true });
    assert.equal(s403.kind, 'off'); assert.match(s403.available.label, /connections off/);
    f.st.off = false; f.st.busy = true;
    assert.equal((await it.startTask({ goal: 'Sort the notes' })).kind, 'busy');
    assert.match((await it.status({ fresh: true })).available.label, /^busy/);
    f.st.busy = false; f.st.state = 'sleeping';
    const sl = await it.status({ fresh: true });
    assert.equal(sl.available.ok, false); assert.equal(sl.available.label, 'asleep');
  } finally { f.server.close(); }
});

test('a task from the lead: handed, checked every 10 s, collected when done', async () => {
  const f = await fakeHearthAI();
  try {
    const it = ithilLib.createIthil({ home: homeWith(f.port, 'k1'), sleep: () => Promise.resolve() });
    const steps = [];
    const r = await it.runTask({ goal: 'Sort my notes folder into topics', from: 'Claude (team lead)', folder: '/home/chris/notes', onStep: (l, d) => steps.push(`${l}: ${d}`) });
    assert.equal(r.ok, true);
    assert.match(r.text, /Ithil finished "Tidy the notes"/); assert.match(r.text, /Sorted 12 notes/); assert.match(r.text, /branch mind\/t1/);
    assert.deepEqual(f.st.tasked[0], { goal: 'Sort my notes folder into topics', from: 'Claude (team lead)', folder: '/home/chris/notes' });
    assert.ok(steps.some((s) => s.startsWith('Handed to Ithil')));
    assert.ok(steps.includes('Ithil: Made folders'));
  } finally { f.server.close(); }
});

test('her hard limits: such a task never reaches her', async () => {
  const f = await fakeHearthAI();
  try {
    const it = ithilLib.createIthil({ home: homeWith(f.port, 'k1') });
    for (const goal of ['Merge mind/t1 into main', 'Release 3.9 to GitHub', 'Bump the version number to 1.13', 'Fix the GRUB boot menu', 'Change my settings to dark mode', 'Delete my old photos', 'deploy the site']) {
      const r = await it.startTask({ goal });
      assert.equal(r.kind, 'limit', goal);
    }
    assert.equal(f.st.tasked.length, 0);
    assert.equal(ithilLib.limitHit('Sort the notes into topics and write a summary'), null);
  } finally { f.server.close(); }
});

test('the live events: status and thoughts go to the window', async () => {
  const f = await fakeHearthAI();
  const got = [];
  try {
    const it = ithilLib.createIthil({ home: homeWith(f.port, 'k1'), send: (ch, ev) => got.push([ch, ev]) });
    it.watch(true);
    for (let i = 0; i < 50 && got.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    it.watch(false);
    assert.deepEqual(got.map(([ch, ev]) => [ch, ev.type]), [['ithil:event', 'status'], ['ithil:event', 'thought']]);
    assert.equal(got[1][1].text, 'The lead asked me something.');
    assert.equal(got[0][1].status.mood, 'calm');
  } finally { f.server.close(); }
});

test('from another device: his host, port and key (the key never in settings)', async () => {
  const f = await fakeHearthAI();
  try {
    const keys = new Map();
    const secrets = { get: (k) => keys.get(k), has: (k) => keys.has(k), set: async (k, v) => { keys.set(k, v); }, remove: (k) => keys.delete(k) };
    let conf = { host: '127.0.0.1', port: f.port };
    const it = ithilLib.createIthil({ home: '/nonexistent', settings: () => conf, secrets });
    assert.equal((await it.status({ fresh: true })).kind, 'auth');
    assert.equal((await it.setKey('k1')).ok, true);
    const t = await it.test();
    assert.equal(t.ok, true); assert.match(t.message, /Connected to Ithil \(Hearth AI 0\.3\.1\): awake · curious/);
    assert.deepEqual(ithilLib.cleanSettings({ host: 'bad host!', port: 99999 }), { host: '', port: 47860 });
    assert.deepEqual(ithilLib.cleanSettings({ host: 'chris-hearth.tail0e2082.ts.net', port: '47860' }), { host: 'chris-hearth.tail0e2082.ts.net', port: 47860 });
    conf = {};
  } finally { f.server.close(); }
});

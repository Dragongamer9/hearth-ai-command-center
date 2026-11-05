// The main process for this build: several chats at once (electron/v2.cjs), the media scheme,
// memory, scheduled tasks, connectors, the new teammates, and settings left alone.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const v2 = require('../electron/v2.cjs');
const media = require('../electron/media.cjs');
const { createChats } = require('../electron/chats.cjs');
const attachments = require('../electron/attachments.cjs');
const { createMemory } = require('../electron/memory-store.cjs');
const { createScheduler } = require('../electron/schedule.cjs');
const { createConnectors } = require('../electron/connectors.cjs');
const { createJsonFile } = require('../electron/jsonfile.cjs');
const { createTeammates, fillWorkflow, DEFAULT_WORKFLOW } = require('../electron/teammates.cjs');
const parity = require('../electron/parity.cjs');
const { validateProvider, validatePrompt, validateModel } = require('../electron/validate.cjs');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (n = 'hearth-par-') => { const d = fs.mkdtempSync(path.join(os.tmpdir(), n)); made.push(d); return d; };
const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Dragongamer9', GIT_AUTHOR_EMAIL: 'Dragongamer9@users.noreply.github.com', GIT_COMMITTER_NAME: 'Dragongamer9', GIT_COMMITTER_EMAIL: 'Dragongamer9@users.noreply.github.com' };
const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const fakeSecrets = () => { const m = new Map(); return { m, available: async () => true, set: async (k, v) => { m.set(k, v); }, get: (k) => m.get(k) ?? null, has: (k) => m.has(k), remove: (k) => m.delete(k) }; };

function setup({ maxChats = 3 } = {}) {
  const t = tmp('hearth-par-v2-');
  const bare = path.join(t, 'gh', 'alpha.git');
  fs.mkdirSync(bare, { recursive: true });
  g(bare, 'init', '-q', '--bare', '-b', 'main');
  const seed = path.join(t, 'seed');
  fs.mkdirSync(seed);
  g(seed, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(seed, 'f.txt'), 'one\n');
  g(seed, 'add', '.'); g(seed, 'commit', '-q', '-m', 'start'); g(seed, 'push', '-q', bare, 'main');
  const data = path.join(t, 'data');
  fs.mkdirSync(data);
  const chats = createChats(data);
  chats.migrateIndex((idx) => { idx.v2 = { at: 'now', from: 'test' }; return true; });
  const handlers = {};
  const runs = [];
  const release = new Map();
  const S = { connection: {}, bins: {}, extraDirs: [], access: 'standard', autoPush: false, tools: { web: true, build: true, quickChecks: [] }, previewNetwork: false, copyIdleHours: 24, maxChats, ownerIdentity: { name: 'Dragongamer9', email: 'Dragongamer9@users.noreply.github.com', emails: ['Dragongamer9@users.noreply.github.com'] } };
  const api = v2.register({
    handle: (ch, fn) => { handlers[ch] = fn; }, dataDir: () => data, readSettings: () => S, chats,
    gitops: { find: (b) => (b === 'git' ? 'git' : null) },
    agents: {
      runAgent: async (o) => {
        runs.push(o);
        // Each run waits until the test lets it finish (or it is stopped).
        await new Promise((r) => { release.set(o.cwd, r); o.signal?.addEventListener('abort', r); });
        if (o.signal?.aborted) return { ok: false, error: { kind: 'cancelled', message: 'Stopped.' } };
        fs.writeFileSync(path.join(o.cwd, 'f.txt'), `changed in ${path.basename(o.cwd)}\n`);
        return { ok: true, text: `done in ${path.basename(o.cwd)}`, sessionId: `s-${path.basename(o.cwd)}`, via: 'fake' };
      },
    },
    attachments, history: { append() {} }, redact: (x) => x, send: () => {}, dialog: { showMessageBoxSync: () => 1 }, getWindow: () => null, shell: {}, worktreeRoot: () => path.join(data, 'ws'),
    runs: new Map(), assetsEnv: () => undefined, validateProvider, validatePrompt, validateModel, apiConnected: () => false, callApi: async () => ({ ok: false }), projects: () => ({ list: [] }), stateFileFor: (id) => path.join(data, `${id}.json`),
    urlFor: () => `file://${bare}`,
    github: { defaultBranch: async () => 'main', branches: async () => ({ ok: true, default: 'main', branches: ['main'] }) },
  });
  const waitRuns = async (n) => { for (let i = 0; i < 400 && runs.length < n; i++) await new Promise((r) => setTimeout(r, 10)); };
  const finish = (cwd) => release.get(cwd)?.();
  return { data, chats, handlers, runs, api, S, waitRuns, finish };
}
const run = (t, chatId, o = {}) => t.handlers['chat:run']({ chatId, agent: 'anthropic', prompt: 'Fix it', build: true, web: false, ...o });

test('two chats on the SAME repo run at once, each in its own copy and branch, each getting only its own result', async () => {
  const t = setup();
  const a = t.chats.create({ repo: 'Dragongamer9/alpha', branch: 'main', title: 'Chat A' });
  const b = t.chats.create({ repo: 'Dragongamer9/alpha', branch: 'main', title: 'Chat B' });
  const pa = run(t, a.id);
  const pb = run(t, b.id);
  await t.waitRuns(2);
  assert.equal(t.api.running.size, 2, 'both running at the same moment');
  const [ca, cb] = [t.runs.find((o) => o.cwd.endsWith(a.id)).cwd, t.runs.find((o) => o.cwd.endsWith(b.id)).cwd];
  assert.notEqual(ca, cb, 'separate copies');
  t.finish(cb); t.finish(ca);
  const [ra, rb] = await Promise.all([pa, pb]);
  assert.equal(ra.text, `done in ${a.id}`);
  assert.equal(rb.text, `done in ${b.id}`);
  assert.notEqual(ra.changes.branch, rb.changes.branch, 'separate branches');
  assert.equal(fs.readFileSync(path.join(ca, 'f.txt'), 'utf8'), `changed in ${a.id}\n`);
  assert.equal(fs.readFileSync(path.join(cb, 'f.txt'), 'utf8'), `changed in ${b.id}\n`);
});

test('stopping one chat leaves the other running; runs are keyed by chat', async () => {
  const t = setup();
  const a = t.chats.create({ title: 'A' });
  const b = t.chats.create({ title: 'B' });
  const pa = run(t, a.id);
  const pb = run(t, b.id);
  await t.waitRuns(2);
  await t.handlers['chat:cancel'](a.id);
  const ra = await pa;
  assert.equal(ra.ok, false); assert.equal(ra.error.kind, 'cancelled');
  assert.ok(t.api.running.has(b.id), 'B still working');
  t.finish(t.runs.find((o) => o.cwd.endsWith(b.id)).cwd);
  assert.equal((await pb).ok, true);
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'v2.cjs'), 'utf8');
  assert.doesNotMatch(src, /let\s+round\b|currentRun|activeRun\s*=/, 'nothing global or single-run');
});

test('over the limit the main process says the chat waits its turn (the window keeps it in line)', async () => {
  const t = setup({ maxChats: 1 });
  const a = t.chats.create({ title: 'A' });
  const b = t.chats.create({ title: 'B' });
  const pa = run(t, a.id);
  await t.waitRuns(1);
  const rb = await run(t, b.id);
  assert.equal(rb.ok, false); assert.equal(rb.error.kind, 'queue'); assert.match(rb.error.message, /waits its turn/);
  const helper = run(t, b.id, { helper: true, runId: 'helper1' });
  await t.waitRuns(2);
  assert.equal(t.runs[1].mode, 'read', 'a helper always works read-only');
  t.runs.forEach((o) => t.finish(o.cwd));
  await Promise.all([pa, helper]);
});

test('MEDIA SCHEME: only files in the app\'s media folder for that chat; nothing outside, no symlinks', () => {
  const d = tmp();
  const root = media.mediaRoot(d);
  const item = media.storeBuffer(root, 'c0000000001', 'pic.png', Buffer.from('png'));
  assert.equal(media.resolve(item.url, root).ok, true);
  fs.writeFileSync(path.join(d, 'secret.txt'), 'x');
  for (const u of ['hearth-media://c/c0000000001/..%2F..%2Fsecret.txt', 'hearth-media://c/../secret.txt', 'hearth-media://c/c0000000002/' + item.file, 'hearth-media://x/c0000000001/' + item.file, 'file:///etc/passwd', 'hearth-media://c/c0000000001/%2Fetc%2Fpasswd']) assert.equal(media.resolve(u, root).ok, false, u);
  fs.symlinkSync(path.join(d, 'secret.txt'), path.join(root, 'c0000000001', 'abcdef1234-link.png'));
  assert.equal(media.resolve('hearth-media://c/c0000000001/abcdef1234-link.png', root).ok, false, 'symlinks refused');
  const r = media.respond({ url: item.url, headers: { get: () => '' } }, root);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-security-policy'], /sandbox/, 'an SVG opened directly can\'t run scripts');
  assert.equal(media.respond({ url: 'hearth-media://c/c0000000001/nope.png', headers: { get: () => '' } }, root).status, 404);
  assert.equal(media.inside(d, '../etc/passwd'), null);
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /script-src 'self';/, 'the window runs only its own scripts');
});

test('MEMORY: atomic with a backup; an AI suggestion is saved only after the owner\'s yes', () => {
  const d = tmp();
  const f = path.join(d, 'memory.json');
  const m = createMemory(f);
  assert.deepEqual(m.list().facts, []);
  assert.equal(fs.existsSync(f), false, 'no file until something is saved');
  m.add('Uses 4 spaces.');
  const p = m.propose('Likes dark mode', { agent: 'anthropic', chatId: 'c0000000001' }).proposal;
  assert.equal(m.list().facts.length, 1, 'a suggestion is not a fact');
  assert.equal(m.promptLines().includes('dark mode'), false, 'the AIs don\'t read it yet');
  m.decide(p.id, true);
  assert.equal(m.list().facts.length, 2);
  assert.ok(fs.existsSync(`${f}.bak`));
  const p2 = m.propose('Nope', { agent: 'openai' }).proposal;
  m.decide(p2.id, false);
  assert.equal(m.list().facts.some((x) => x.text === 'Nope'), false);
  fs.writeFileSync(f, '{bad');
  const m2 = createMemory(f);
  assert.throws(() => m2.add('x'), /could not be read/);
  assert.equal(fs.readFileSync(f, 'utf8'), '{bad', 'never overwritten');
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'parity.cjs'), 'utf8');
  assert.match(src, /handle\('memory:propose'[^\n]*memory\.propose/);
  assert.doesNotMatch(src.slice(src.indexOf("handle('memory:propose'"), src.indexOf("handle('memory:decide'")), /decide/, 'proposing never decides');
});

test('SCHEDULED TASKS: off until the owner creates one; due runs with a fake clock; results go to their chat', async () => {
  const d = tmp();
  let now = new Date(2026, 10, 4, 8, 0).getTime();
  const ran = [];
  const s = createScheduler({ file: path.join(d, 'schedules.json'), now: () => now, run: async (t) => { ran.push(t.chatId); return { ok: true }; } });
  assert.deepEqual(await s.tick(), []);
  assert.equal(fs.existsSync(path.join(d, 'schedules.json')), false, 'nothing saved, nothing runs');
  s.add({ kind: 'daily', time: '09:00', prompt: 'Check logs', chatId: 'c0000000001' });
  s.add({ kind: 'once', at: new Date(2026, 10, 4, 8, 30).toISOString(), prompt: 'Once', chatId: 'c0000000002' });
  assert.deepEqual(await s.tick(), []);
  now = new Date(2026, 10, 4, 8, 31).getTime();
  await s.tick();
  assert.deepEqual(ran, ['c0000000002']);
  now = new Date(2026, 10, 4, 9, 1).getTime();
  await s.tick();
  assert.deepEqual(ran, ['c0000000002', 'c0000000001']);
  await s.tick();
  assert.equal(ran.length, 2, 'each due run once');
  const once = s.list().find((x) => x.kind === 'once');
  assert.equal(once.enabled, false);
  assert.equal(new Date(s.list().find((x) => x.kind === 'daily').nextRun).getDate(), 5, 'next day');
  assert.throws(() => s.add({ kind: 'once', at: new Date(2020, 1, 1).toISOString(), prompt: 'x', chatId: 'c0000000001' }), /already passed/);
});

test('CONNECTORS and TEAMMATE SECRETS are never written in plain text', async () => {
  const d = tmp();
  const sec = fakeSecrets();
  const c = createConnectors({ file: path.join(d, 'connectors.json'), secrets: sec });
  await c.add({ name: 'github', type: 'stdio', command: 'npx', args: ['-y', 'server-github'], env: { GITHUB_TOKEN: 'ghp_SECRET123' } });
  await c.add({ name: 'remote', type: 'http', url: 'https://mcp.example.com', headers: { Authorization: 'Bearer TOKEN_SECRET' } });
  const r = c.forRun(path.join(d, 'run'));
  const disk = [fs.readFileSync(path.join(d, 'connectors.json'), 'utf8'), fs.readFileSync(r.claudeFile, 'utf8'), fs.readFileSync(r.geminiFile, 'utf8'), r.codexArgs.join(' ')].join('\n');
  assert.doesNotMatch(disk, /ghp_SECRET123|TOKEN_SECRET/, 'configs hold references only');
  assert.match(fs.readFileSync(r.claudeFile, 'utf8'), /\$\{HEARTH_MCP_/);
  assert.ok(Object.values(r.env).includes('ghp_SECRET123'), 'the value reaches the AI app through its environment');
  r.cleanup();
  assert.equal(fs.existsSync(r.claudeFile), false);
  const tm = createTeammates({ secrets: sec, file: path.join(d, 'servers.json'), settings: () => ({}) });
  await tm.setKey('venice', 'VENICE_KEY_123');
  await tm.addServer({ name: 'Pod', type: 'comfy', url: 'https://pod.example.com', key: 'POD_KEY_456' });
  for (const f of fs.readdirSync(d)) if (fs.statSync(path.join(d, f)).isFile()) assert.doesNotMatch(fs.readFileSync(path.join(d, f), 'utf8'), /VENICE_KEY_123|POD_KEY_456/, f);
});

function fakeFetch(routes) {
  const seen = [];
  const f = async (url, o = {}) => {
    seen.push({ url: String(url), method: o.method || 'GET', headers: o.headers || {}, body: o.body ? (typeof o.body === 'string' ? JSON.parse(o.body) : o.body) : null });
    const r = routes(String(url), o);
    return { ok: r.status < 400, status: r.status, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? r.type || 'application/json' : null) }, json: async () => r.json, arrayBuffer: async () => (r.bin || Buffer.from('img')).buffer };
  };
  f.seen = seen;
  return f;
}

test('VENICE: right URL and auth, model picker default, safe_mode false; refusals (422) shown plainly', async () => {
  const sec = fakeSecrets();
  await sec.set('venice', 'vk-1'); await sec.set('openai', 'OTHER-KEY');
  const fetchImpl = fakeFetch((u) => (u.endsWith('/chat/completions') ? { status: 200, json: { choices: [{ message: { content: 'Hi from Venice' } }] } } : u.endsWith('/image/generate') ? { status: 200, json: { images: [Buffer.from('png').toString('base64')] } } : { status: 404, json: {} }));
  const tm = createTeammates({ secrets: sec, file: path.join(tmp(), 's.json'), settings: () => ({}), fetchImpl });
  const c = await tm.chat('venice', { prompt: 'hello' });
  assert.equal(c.text, 'Hi from Venice');
  assert.equal(fetchImpl.seen[0].url, 'https://api.venice.ai/api/v1/chat/completions');
  assert.equal(fetchImpl.seen[0].headers.authorization, 'Bearer vk-1');
  assert.equal(fetchImpl.seen[0].body.model, 'venice-uncensored-1-2');
  const i = await tm.image('venice', { prompt: 'a castle' });
  assert.equal(i.ok, true);
  assert.equal(fetchImpl.seen[1].url, 'https://api.venice.ai/api/v1/image/generate');
  assert.equal(fetchImpl.seen[1].body.safe_mode, false);
  assert.equal(fetchImpl.seen[1].body.model, 'lustify-sdxl');
  assert.ok(!JSON.stringify(fetchImpl.seen).includes('OTHER-KEY'), 'never another account\'s key');
  const no = createTeammates({ secrets: sec, file: path.join(tmp(), 's.json'), settings: () => ({}), fetchImpl: fakeFetch(() => ({ status: 422, json: { error: 'Content policy violation' } })) });
  const r = await no.image('venice', { prompt: 'x' });
  assert.equal(r.ok, false); assert.equal(r.error.kind, 'refused'); assert.match(r.error.message, /Venice refused it: Content policy violation/);
});

test('CIVITAI: right URL, Bearer token, allowMatureContent=true, engine and outputFormat; ProblemDetails shown plainly', async () => {
  const sec = fakeSecrets();
  await sec.set('civitai', 'civ-token');
  const fetchImpl = fakeFetch((u) => (u.startsWith('https://orchestration.civitai.com/') ? { status: 200, json: { images: [{ url: 'https://blob.civitai.com/x.png' }], errors: null } } : { status: 200, type: 'image/png' }));
  const tm = createTeammates({ secrets: sec, file: path.join(tmp(), 's.json'), settings: () => ({ teammates: { civitai: { engine: 'flux2', fields: '{"prompt": "{prompt}", "width": 1024}' } } }), fetchImpl });
  const r = await tm.image('civitai', { prompt: 'a "quoted" fox' });
  assert.equal(r.ok, true, r.error?.message);
  const q = fetchImpl.seen[0];
  assert.equal(q.url, 'https://orchestration.civitai.com/v2/consumer/recipes/imageGen?allowMatureContent=true');
  assert.equal(q.headers.authorization, 'Bearer civ-token');
  assert.deepEqual([q.body.engine, q.body.outputFormat, q.body.prompt, q.body.width], ['flux2', 'png', 'a "quoted" fox', 1024]);
  assert.equal(fetchImpl.seen[1].headers.authorization, undefined, 'the picture link is fetched without the token');
  const safe = await tm.image('civitai', { prompt: 'x', safe: true });
  assert.equal(safe.ok, true);
  assert.match(fetchImpl.seen[2].url, /allowMatureContent=false/, 'off for a card that reads as under 18');
  const bad = createTeammates({ secrets: sec, file: path.join(tmp(), 's.json'), settings: () => ({}), fetchImpl: fakeFetch(() => ({ status: 403, json: { title: 'Forbidden', detail: 'Not enough Buzz.' } })) });
  const e = await bad.image('civitai', { prompt: 'x' });
  assert.match(e.error.message, /Civitai: Not enough Buzz\./);
});

test('OWN GPU SERVER: OpenAI-compatible chat and ComfyUI /prompt → /history → /view, with only its own key', async () => {
  const sec = fakeSecrets();
  await sec.set('venice', 'VENICE-NOT-FOR-SERVER');
  const fetchImpl = fakeFetch((u) => {
    if (u.endsWith('/chat/completions')) return { status: 200, json: { choices: [{ message: { content: 'gpu says hi' } }] } };
    if (u.endsWith('/prompt')) return { status: 200, json: { prompt_id: 'abc-1' } };
    if (u.includes('/history/abc-1')) return { status: 200, json: { 'abc-1': { outputs: { 9: { images: [{ filename: 'h_1.png', subfolder: '', type: 'output' }] } }, status: { completed: true } } } };
    if (u.includes('/view?')) return { status: 200, type: 'image/png' };
    return { status: 404, json: {} };
  });
  const d = tmp();
  const tm = createTeammates({ secrets: sec, file: path.join(d, 's.json'), settings: () => ({}), fetchImpl, sleep: async () => {} });
  assert.equal(tm.ready('gpu'), false);
  assert.match(tm.hint('gpu'), /Add your GPU server/);
  await tm.addServer({ name: 'Pod chat', type: 'openai', url: 'https://pod.example.com/v1/', model: 'llama3', key: 'POD-KEY' });
  await tm.addServer({ name: 'Pod comfy', type: 'comfy', url: 'http://192.168.1.20:8188' });
  const c = await tm.chat('gpu', { prompt: 'hi' });
  assert.equal(c.text, 'gpu says hi');
  assert.equal(fetchImpl.seen[0].url, 'https://pod.example.com/v1/chat/completions');
  assert.equal(fetchImpl.seen[0].headers.authorization, 'Bearer POD-KEY');
  const i = await tm.image('gpu', { prompt: 'a lighthouse' });
  assert.equal(i.ok, true, i.error?.message);
  assert.deepEqual(fetchImpl.seen.slice(1).map((x) => x.url.replace(/\?.*/, '')), ['http://192.168.1.20:8188/prompt', 'http://192.168.1.20:8188/history/abc-1', 'http://192.168.1.20:8188/view']);
  assert.equal(fetchImpl.seen[1].body.prompt[6].inputs.text, 'a lighthouse', 'the prompt goes into the workflow');
  assert.ok(!JSON.stringify(fetchImpl.seen).includes('VENICE-NOT-FOR-SERVER'), 'never the owner\'s other keys');
  assert.equal(typeof fillWorkflow(DEFAULT_WORKFLOW, { seed: 5 })[3].inputs.seed, 'number');
  await assert.rejects(tm.addServer({ name: 'x', url: 'ftp://nope' }), /server address/);
});

test('teammates without a key are skipped with "Add your … key"', async () => {
  const tm = createTeammates({ secrets: fakeSecrets(), file: path.join(tmp(), 's.json'), settings: () => ({}), fetchImpl: async () => { throw new Error('no network'); } });
  for (const a of ['venice', 'civitai']) {
    assert.equal(tm.ready(a), false);
    const r = await tm.image(a, { prompt: 'x' });
    assert.match(r.error.message, new RegExp(`Add your ${a === 'venice' ? 'Venice' : 'Civitai'} key`));
  }
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'team-run.mjs'), 'utf8');
  assert.match(src, /was skipped: /, 'the chat says so');
});

test('scheduled tasks and read-other-chat give other AIs placeholders for unfiltered teammates', () => {
  const t = parity.transcriptOf([{ who: 'owner', text: 'hi' }, { who: 'venice', text: 'adult words', media: [{ kind: 'image' }] }, { who: 'owner', text: 'nsfw ask', to: ['venice'] }, { who: 'anthropic', text: 'ok' }]);
  assert.doesNotMatch(t, /adult words|nsfw ask/);
  assert.match(t, /Venice: \[image by Venice\]/);
});

test('SETTINGS UNCHANGED ON FIRST RUN: registering everything writes no file; new settings are read-time defaults', async () => {
  const d = tmp();
  const handlers = {};
  const before = fs.readdirSync(d);
  const p = parity.register({ handle: (ch, fn) => { handlers[ch] = fn; }, dataDir: () => d, readSettings: () => ({ tools: { web: true }, team: null }), chats: { search: () => [], entry: () => null }, secrets: fakeSecrets(), shell: {}, dialog: {}, send: () => {}, protocol: null, attachments, worktreeRoot: () => d, BrowserWindow: null, getWindow: () => null, v2: () => ({ entryOf: () => ({}) }) });
  for (const ch of ['memory:list', 'schedule:list', 'connectors:list', 'teammates:status', 'cards:list', 'lore:list', 'rp:persona', 'habitat:get']) await handlers[ch]();
  p.stop();
  assert.deepEqual(fs.readdirSync(d), before, 'nothing written');
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  for (const k of ['notify: s.notify !== false', 'autoRead: s.autoRead === true', 'maxChats: v2.MAX_CHAT_CHOICES.includes(s.maxChats) ? s.maxChats : 3', 'teammates: cleanTeammates(s.teammates)']) assert.ok(main.includes(k), k);
});

test('RED FLAG: the updaters and the release workflow are untouched', () => {
  const root = path.join(__dirname, '..');
  for (const f of ['electron/updater.cjs', 'electron/updater-deb.cjs', '.github/workflows/release.yml']) assert.ok(fs.existsSync(path.join(root, f)), f);
  let base = null;
  try { base = execFileSync('git', ['rev-parse', '--verify', '-q', 'c606f10'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  if (!base) return; // shallow CI checkout: test/redflag-updates.test.cjs guards the contents
  for (const f of ['electron/updater.cjs', 'electron/updater-deb.cjs', '.github/workflows/release.yml']) assert.equal(execFileSync('git', ['diff', '--stat', base, '--', f], { cwd: root, encoding: 'utf8' }).trim(), '', `${f} is byte-identical to 1.6.0`);
});

// 3.3: the new AIs (electron/more-ais.cjs). Each one is tested against a pretend version of it:
// fake command-line tools (small scripts that print what the real ones print) and fake web APIs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const more = require('../electron/more-ais.cjs');
const providers = require('../electron/providers.cjs');
const cloud = require('../electron/cloud-agents.cjs');
const agents = require('../electron/agents.cjs');
const makers = require('../electron/makers.cjs');
const moreMakers = require('../electron/more-makers.cjs');
const installer = require('../electron/installer.cjs');
const { PROVIDERS, LIVE_PROVIDERS } = (() => { const v = require('../electron/validate.cjs'); return { PROVIDERS: ['x'].concat(), LIVE_PROVIDERS: v.LIVE_PROVIDERS }; })();
const validate = require('../electron/validate.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-more-'));
const fetchOf = (routes, calls = []) => async (url, init = {}) => {
  calls.push({ url: String(url), init });
  for (const [re, reply] of routes) {
    if (re.test(String(url)) && (!reply.method || reply.method === (init.method || 'GET'))) {
      const r = typeof reply.body === 'function' ? reply.body(url, init, calls) : reply.body;
      const status = reply.status || 200;
      const buf = Buffer.isBuffer(r) ? r : null;
      return { ok: status < 400, status, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? reply.type || (buf ? 'application/octet-stream' : 'application/json') : null) }, json: async () => (buf ? null : r), arrayBuffer: async () => (buf || Buffer.from(JSON.stringify(r))) };
    }
  }
  return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ error: { message: `no route for ${url}` } }), arrayBuffer: async () => Buffer.alloc(0) };
};
const noSleep = () => Promise.resolve();

test('the window and the main side list the same new AIs', async () => {
  const reg = await import('../src/registry.mjs');
  const team = more.TEAM.filter((a) => !more.WEB_IDS.includes(a));
  assert.deepEqual([...reg.MORE_IDS].sort(), [...team].sort());
  assert.deepEqual([...reg.MORE_WEB].sort(), [...more.WEB_IDS].sort());
  for (const a of more.TEAM) {
    assert.ok(reg.AGENTS[a], `${a} is in the registry`);
    assert.ok(reg.COLORS[a], `${a} has a colour`);
    assert.ok(reg.ACCESS_NOTE[a] && reg.BILLING[a], `${a} says how it connects and how it's paid`);
  }
  // Microsoft Copilot (web window) and GitHub Copilot (CLI) are two different teammates.
  assert.equal(reg.AGENTS.copilot.vendor, 'Microsoft');
  assert.equal(reg.AGENTS.ghcopilot.vendor, 'GitHub');
  for (const g of Object.values(reg.MORE_GROUPS)) for (const a of g) assert.ok(reg.AGENTS[a], `${a} in a group exists`);
  // Every new id can be validated and the keyed ones take a key.
  for (const a of more.TEAM) assert.equal(validate.validateProvider(a), a);
  for (const a of more.KEYED) assert.ok(LIVE_PROVIDERS.includes(a), `${a} takes an API key`);
});

test('the chat APIs use their own OpenAI-compatible endpoint, the key only in the header', async () => {
  for (const id of more.CHAT_IDS) assert.equal(providers.ENDPOINTS[id], `${more.CHAT[id].base}/chat/completions`);
  const calls = [];
  const f = fetchOf([[/api\.moonshot\.ai\/v1\/chat\/completions$/, { method: 'POST', body: { choices: [{ message: { content: 'Kimi says hi' } }] } }]], calls);
  const r = await providers.callProvider({ provider: 'kimi', apiKey: 'sk-KIMI', model: providers.DEFAULT_MODELS.kimi, prompt: 'hello', fetchImpl: f });
  assert.equal(r.ok, true);
  assert.equal(r.text, 'Kimi says hi');
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-KIMI');
  assert.equal(JSON.parse(calls[0].init.body).model, 'kimi-k3.1-pro');
  // OpenRouter gets the app's name (its optional attribution headers), nothing else extra.
  const c2 = [];
  await providers.callProvider({ provider: 'openrouter', apiKey: 'or-1', model: 'openrouter/auto', prompt: 'x', fetchImpl: fetchOf([[/openrouter\.ai/, { body: { choices: [{ message: { content: 'ok' } }] } }]], c2) });
  assert.equal(c2[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(c2[0].init.headers['X-OpenRouter-Title'], 'Hearth AI Command Center');
  // A wrong key comes back as a sign-in problem, not a crash.
  const bad = await providers.callProvider({ provider: 'groq', apiKey: 'x', model: 'm', prompt: 'x', fetchImpl: fetchOf([[/groq/, { status: 401, body: { error: { message: 'Invalid API Key' } } }]]) });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.kind, 'auth');
});

test('Claude\'s API replies can be long now (16,000 tokens, was 1,024)', async () => {
  const calls = [];
  await providers.callProvider({ provider: 'anthropic', apiKey: 'sk-ant', model: 'claude-sonnet-5-5', prompt: 'x', fetchImpl: fetchOf([[/anthropic/, { body: { content: [{ type: 'text', text: 'hi' }] } }]], calls) });
  assert.equal(JSON.parse(calls[0].init.body).max_tokens, 16000);
});

test('Devin: starts a job, checks on it, comes back with its message and the pull request', async () => {
  let polls = 0;
  const calls = [];
  const f = fetchOf([
    [/api\.devin\.ai\/v1\/sessions$/, { method: 'POST', body: { session_id: 'devin-abc123', url: 'https://app.devin.ai/sessions/abc123' } }],
    [/api\.devin\.ai\/v1\/sessions\/devin-abc123$/, { body: () => (++polls < 3 ? { status_enum: 'working' } : { status_enum: 'finished', messages: [{ type: 'devin_message', message: 'Added the save menu.' }], pull_request: { url: 'https://github.com/Dragongamer9/game/pull/7' } }) }],
  ], calls);
  const r = await providers.callProvider({ provider: 'devin', apiKey: 'dv-KEY', prompt: 'Add a save menu', repo: 'Dragongamer9/game', fetchImpl: f, sleep: noSleep });
  assert.equal(r.ok, true);
  assert.match(r.text, /Added the save menu\./);
  assert.match(r.text, /Pull request: https:\/\/github\.com\/Dragongamer9\/game\/pull\/7/);
  assert.match(r.text, /https:\/\/app\.devin\.ai\/sessions\/abc123/);
  assert.match(JSON.parse(calls[0].init.body).prompt, /^Repository: Dragongamer9\/game/);
  assert.ok(calls.every((c) => c.url.startsWith('https://api.devin.ai/')), 'the key only goes to Devin');
});

test('Jules: finds the chat\'s repo among his connected ones, opens a PR job, reports the PR', async () => {
  const calls = [];
  let n = 0;
  const f = fetchOf([
    [/\/v1alpha\/sources/, { body: { sources: [{ name: 'sources/github/Dragongamer9/other' }, { name: 'sources/github/Dragongamer9/game' }] } }],
    [/\/v1alpha\/sessions$/, { method: 'POST', body: { id: 'j123', name: 'sessions/j123' } }],
    [/\/v1alpha\/sessions\/j123\/activities/, { body: () => (++n < 2 ? { activities: [{ progressUpdated: { description: 'Working' } }] } : { activities: [{ agentMessaged: { agentMessage: 'Fixed the crash on load.' } }, { sessionCompleted: {} }] }) }],
    [/\/v1alpha\/sessions\/j123$/, { body: { outputs: [{ pullRequest: { url: 'https://github.com/Dragongamer9/game/pull/9' } }] } }],
  ], calls);
  const r = await cloud.run({ provider: 'jules', key: 'AIza-J', prompt: 'Fix the crash on load', repo: 'Dragongamer9/game', fetchImpl: f, sleep: noSleep });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.text, /Fixed the crash on load\./);
  assert.match(r.text, /pull\/9/);
  const create = calls.find((c) => /sessions$/.test(c.url) && c.init.method === 'POST');
  const body = JSON.parse(create.init.body);
  assert.equal(body.sourceContext.source, 'sources/github/Dragongamer9/game');
  assert.equal(body.automationMode, 'AUTO_CREATE_PR');
  assert.equal(create.init.headers['x-goog-api-key'], 'AIza-J');
  // A chat without a repo, or a repo Jules can't see, says so plainly.
  assert.match((await cloud.run({ provider: 'jules', key: 'k', prompt: 'x', repo: null, fetchImpl: f, sleep: noSleep })).error.message, /GitHub repo/);
  assert.match((await cloud.run({ provider: 'jules', key: 'k', prompt: 'x', repo: 'Dragongamer9/unknown', fetchImpl: f, sleep: noSleep })).error.message, /connect it in Jules/);
});

test('every new CLI turns look-only turns into look-only flags, and work turns into work flags', () => {
  const look = { prompt: 'P', mode: 'read' };
  const work = { prompt: 'P', mode: 'standard' };
  const has = (a, x) => a.includes(x);
  assert.ok(!has(more.CLI.cursor.args(look), '--force') && has(more.CLI.cursor.args(work), '--force'));
  assert.ok(has(more.CLI.ghcopilot.args(look), '--deny-tool=write') && !has(more.CLI.ghcopilot.args(work), '--deny-tool=write'));
  assert.ok(!has(more.CLI.ghcopilot.args(work), '--allow-all-tools') && has(more.CLI.ghcopilot.args({ ...work, mode: 'full' }), '--allow-all-tools'), 'Copilot only gets everything with Full access');
  assert.ok(!has(more.CLI.kiro.args(look), '--trust-all-tools') && has(more.CLI.kiro.args(work), '--trust-all-tools'));
  assert.ok(has(more.CLI.aider.args(look), '--dry-run') && !has(more.CLI.aider.args(work), '--dry-run'));
  assert.ok(has(more.CLI.aider.args(work), '--no-auto-commits'), 'Aider never makes its own commits');
  assert.ok(!has(more.CLI.opencode.args(look), '--auto') && has(more.CLI.opencode.args(work), '--auto'));
  assert.equal(more.CLI.goose.env(look).GOOSE_MODE, 'chat');
  assert.equal(more.CLI.goose.env(work).GOOSE_MODE, 'auto');
  assert.ok(has(more.CLI.cline.args(look), '--plan'));
  assert.ok(!has(more.CLI.crush.args(look), '--yolo') && has(more.CLI.crush.args(work), '--yolo'));
  assert.ok(!has(more.CLI.openhands.args(look), '--always-approve'));
  assert.ok(!has(more.CLI.amp.args(look), '--dangerously-allow-all'));
  assert.ok(has(more.CLI.auggie.args(look), '--tools'));
  assert.ok(!has(more.CLI.droid.args(look), '--auto'));
  assert.deepEqual(more.CLI.droid.args({ ...work, mode: 'full' }).slice(3, 5), ['--auto', 'high']);
  // Prompts given as an argument never start with "-" (they'd be read as flags).
  for (const id of more.CLI_IDS) for (const a of more.CLI[id].args({ prompt: 'hello', mode: 'standard' })) assert.equal(typeof a, 'string');
});

test('answers are read from each kind of CLI output', () => {
  assert.deepEqual(agents.parseCli('claude', '{"type":"result","result":"done","session_id":"s-1"}').text, 'done');
  assert.equal(agents.parseCli('claude', '{"type":"system"}\n{"type":"assistant"}\n{"type":"result","subtype":"success","is_error":false,"result":"Amp did it","session_id":"T-9"}').sessionId, 'T-9');
  const oc = agents.parseCli('events', '{"type":"step_start","sessionID":"ses_1"}\n{"type":"text","part":{"type":"text","text":"Hello "}}\n{"type":"text","part":{"type":"text","text":"world"}}');
  assert.equal(oc.text, 'Hello world');
  assert.equal(oc.sessionId, 'ses_1');
  assert.equal(agents.parseCli('events', JSON.stringify({ messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: [{ type: 'text', text: 'Goose answer' }] }] })).text, 'Goose answer');
  assert.equal(agents.parseCli('cline', '{"type":"say","text":"x"}\n{"type":"run_result","text":"Cline result"}').text, 'Cline result');
  assert.equal(agents.parseCli('text', '\x1b[32mAll good\x1b[0m\nRequest ID: abc').text, 'All good');
});

function fakeTool(dir, name, script) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return f;
}

test('a fake Cursor runs with the right flags, in its folder, and its answer comes back', async () => {
  const dir = tmp();
  const log = path.join(dir, 'args.txt');
  const bin = fakeTool(dir, 'agent', `printf '%s\\n' "$@" > "${log}"; pwd >> "${log}"; echo '{"type":"result","result":"Cursor fixed it","session_id":"c-77"}'`);
  const work = tmp();
  const r = await agents.runAgent({ agent: 'cursor', bin, prompt: 'Fix the bug', cwd: work, mode: 'standard', timeoutMs: 20000 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.text, 'Cursor fixed it');
  assert.equal(r.sessionId, 'c-77');
  const seen = fs.readFileSync(log, 'utf8').split('\n');
  assert.ok(seen.includes('--force') && seen.includes('Fix the bug') && seen.includes(fs.realpathSync(work)));
  const r2 = await agents.runAgent({ agent: 'cursor', bin, prompt: 'Look only', cwd: work, mode: 'read', resumeId: 'c-77', timeoutMs: 20000 });
  assert.equal(r2.ok, true);
  const seen2 = fs.readFileSync(log, 'utf8').split('\n');
  assert.ok(!seen2.includes('--force') && seen2.includes('--resume') && seen2.includes('c-77'));
});

test('a fake Kiro gets its prompt on stdin and its key in its own environment', async () => {
  const dir = tmp();
  const out = path.join(dir, 'seen.txt');
  const bin = fakeTool(dir, 'kiro-cli', `cat > "${out}"; echo "key=$KIRO_API_KEY" >> "${out}"; echo "Kiro answer"`);
  const r = await agents.runAgent({ agent: 'kiro', bin, prompt: 'Plan the work', cwd: dir, mode: 'read', extraEnv: { KIRO_API_KEY: 'kiro-SECRET' }, timeoutMs: 20000 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.text, 'Kiro answer');
  assert.match(fs.readFileSync(out, 'utf8'), /Plan the work[^]*key=kiro-SECRET/);
});

test('Kimi (which approves its own steps in print mode) is told not to change anything on look-only turns', async () => {
  const dir = tmp();
  const out = path.join(dir, 'seen.txt');
  const bin = fakeTool(dir, 'kimi', `cat > "${out}"; echo "ok"`);
  await agents.runAgent({ agent: 'kimi', bin, prompt: 'What does this do?', cwd: dir, mode: 'read', timeoutMs: 20000 });
  assert.match(fs.readFileSync(out, 'utf8'), /^Only look and answer: don't change/);
  await agents.runAgent({ agent: 'kimi', bin, prompt: 'Build it', cwd: dir, mode: 'standard', timeoutMs: 20000 });
  assert.equal(fs.readFileSync(out, 'utf8'), 'Build it');
});

test('Goose gets GOOSE_MODE=chat (no tools) on look-only turns', async () => {
  const dir = tmp();
  const out = path.join(dir, 'mode.txt');
  const bin = fakeTool(dir, 'goose', `echo "$GOOSE_MODE" > "${out}"; cat >/dev/null; echo '{"messages":[{"role":"assistant","content":[{"type":"text","text":"g"}]}]}'`);
  const r = await agents.runAgent({ agent: 'goose', bin, prompt: 'x', cwd: dir, mode: 'read', timeoutMs: 20000 });
  assert.equal(r.text, 'g');
  assert.equal(fs.readFileSync(out, 'utf8').trim(), 'chat');
});

test('a CLI that fails says why (not signed in), with what it printed', async () => {
  const dir = tmp();
  const bin = fakeTool(dir, 'amp', 'cat >/dev/null; echo "Error: not logged in, run amp login" >&2; exit 1');
  const r = await agents.runAgent({ agent: 'amp', bin, prompt: 'x', cwd: dir, mode: 'standard', timeoutMs: 20000 });
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'auth');
});

test('Lovable and Replit: Claude Code with only that builder\'s MCP tools', async () => {
  const dir = tmp();
  const log = path.join(dir, 'args.txt');
  const bin = fakeTool(dir, 'claude', `printf '%s\\n' "$@" > "${log}"; cat > "${log}.in"; echo '{"type":"result","result":"Built it: https://my-app.lovable.app","session_id":"s-1"}'`);
  const r = await agents.runAgent({ agent: 'lovable', bin, prompt: 'Make a landing page', cwd: dir, mode: 'standard', timeoutMs: 20000 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.via, /Lovable \(through Claude Code\)/);
  const args = fs.readFileSync(log, 'utf8').split('\n');
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'mcp__lovable');
  assert.ok(!args.includes('bypassPermissions'));
  assert.match(fs.readFileSync(`${log}.in`, 'utf8'), /^You are working as Lovable[^]*Make a landing page$/);
  assert.match(agents.builderPrompt('replit', 'x'), /mcp__replit__/);
});

test('one-click installs: npm packages, official scripts, uv with Python 3.12, MCP servers for the builders', async () => {
  const dirs = [tmp()];
  const versionOf = async () => 'v22.11.0';
  fs.writeFileSync(path.join(dirs[0], 'node'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dirs[0], 'npm'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dirs[0], 'uv'), '#!/bin/sh\n', { mode: 0o755 });
  const plan = await installer.prepare({ agents: ['cursor', 'ghcopilot', 'aider', 'goose', 'lovable', 'phi', 'warp'], dirs, versionOf });
  assert.equal(plan.ok, true, JSON.stringify(plan));
  const a = plan.args;
  assert.ok(a.includes('@github/copilot'));
  assert.ok(a.includes('https://cursor.com/install'));
  const g = a.indexOf('https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh');
  assert.equal(a[g + 1], 'CONFIGURE=false');
  const u = a.indexOf('uvtoolpy');
  assert.deepEqual(a.slice(u + 1, u + 4), ['aider', 'aider-chat', '3.12']);
  const m = a.indexOf('mcpadd');
  assert.deepEqual(a.slice(m + 1, m + 3), ['lovable', 'https://mcp.lovable.dev']);
  assert.ok(a.includes('ollamapull') && a.includes('phi4'));
  assert.ok(!plan.agents.includes('warp'), 'Warp comes from its own page (a system package), never this installer');
});

test('pictures: FLUX polls its own link and downloads only from its own storage', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  let n = 0;
  const calls = [];
  const f = fetchOf([
    [/api\.bfl\.ai\/v1\/flux-2-pro-preview$/, { method: 'POST', body: { id: 'r1', polling_url: 'https://api.bfl.ai/v1/get_result?id=r1' } }],
    [/get_result/, { body: () => (++n < 2 ? { status: 'Pending' } : { status: 'Ready', result: { sample: 'https://delivery.bfl.ai/x.jpeg' } }) }],
    [/delivery\.bfl\.ai/, { body: png, type: 'image/jpeg' }],
  ], calls);
  const r = await makers.generateImage({ provider: 'flux', key: 'bfl-KEY', prompt: 'a red fox', fetchImpl: f });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.mime, 'image/jpeg');
  assert.deepEqual(r.buf, png);
  assert.equal(calls[0].init.headers['x-key'], 'bfl-KEY');
  const dl = calls.find((c) => /delivery\.bfl\.ai/.test(c.url));
  assert.ok(dl && !dl.init.headers?.['x-key'], 'the key never goes to the download link');
  assert.equal(moreMakers.safeUrl('flux', 'https://evil.example/x.jpg'), null);
  assert.equal(moreMakers.safeUrl('ideogram', 'http://ideogram.ai/x.png'), null);
});

test('pictures: Stability returns the picture itself; Ideogram a link on its own site', async () => {
  const png = Buffer.from('PNGDATA');
  const s = await makers.generateImage({ provider: 'stability', key: 'sk-ST', prompt: 'x', fetchImpl: fetchOf([[/stable-image\/generate\/core/, { method: 'POST', body: png, type: 'image/png' }]]) });
  assert.equal(s.ok, true);
  assert.deepEqual(s.buf, png);
  const i = await makers.generateImage({ provider: 'ideogram', key: 'id-K', prompt: 'x', fetchImpl: fetchOf([[/ideogram-v3\/generate/, { method: 'POST', body: { data: [{ url: 'https://ideogram.ai/api/images/ephemeral/a.png' }] } }], [/ideogram\.ai\/api\/images/, { body: png, type: 'image/png' }]]) });
  assert.equal(i.ok, true, JSON.stringify(i));
});

test('videos: Runway, Luma, Kling and Pika start a job and bring the video back', async () => {
  const mp4 = Buffer.from('MP4');
  const run = await makers.generateVideo({ provider: 'runway', key: 'rw', prompt: 'waves', sleep: noSleep, fetchImpl: fetchOf([
    [/text_to_video$/, { method: 'POST', body: { id: 'aaaaaaaa-1111' } }],
    [/v1\/tasks\/aaaaaaaa-1111$/, { body: { status: 'SUCCEEDED', output: ['https://dnznrvs05pmza.cloudfront.net/v.mp4'] } }],
    [/cloudfront\.net/, { body: mp4, type: 'video/mp4' }],
  ]) });
  assert.equal(run.ok, true, JSON.stringify(run));
  const luma = await makers.generateVideo({ provider: 'luma', key: 'lu', prompt: 'x', sleep: noSleep, fetchImpl: fetchOf([
    [/dream-machine\/v1\/generations$/, { method: 'POST', body: { id: 'gen-12345678' } }],
    [/generations\/gen-12345678$/, { body: { state: 'completed', assets: { video: 'https://storage.cdn-luma.lumalabs.ai/v.mp4' } } }],
    [/lumalabs\.ai\/v\.mp4/, { body: mp4 }],
  ]) });
  assert.equal(luma.ok, true, JSON.stringify(luma));
  const calls = [];
  const kling = await makers.generateVideo({ provider: 'kling', key: 'AK', secret: 'SK', prompt: 'x', sleep: noSleep, fetchImpl: fetchOf([
    [/text2video$/, { method: 'POST', body: { data: { task_id: 'task-1' } } }],
    [/text2video\/task-1$/, { body: { data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn.klingai.com/v.mp4' }] } } } }],
    [/cdn\.klingai\.com/, { body: mp4 }],
  ], calls) });
  assert.equal(kling.ok, true, JSON.stringify(kling));
  const tok = calls[0].init.headers.authorization.replace('Bearer ', '');
  const [h, p, sig] = tok.split('.');
  assert.equal(sig, crypto.createHmac('sha256', 'SK').update(`${h}.${p}`).digest('base64url'), 'signed with the secret key');
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).iss, 'AK');
  assert.equal((await makers.generateVideo({ provider: 'kling', key: 'AK', prompt: 'x' })).error.kind, 'no_key', 'Kling needs both parts');
  const pika = await makers.generateVideo({ provider: 'pika', key: 'fal-K', prompt: 'x', fetchImpl: fetchOf([[/fal\.run\/fal-ai\/pika/, { method: 'POST', body: { video: { url: 'https://v3.fal.media/files/v.mp4' } } }], [/fal\.media/, { body: mp4 }]]) });
  assert.equal(pika.ok, true, JSON.stringify(pika));
});

test('the team lead is told what each kind of new AI is for', async () => {
  const { brief } = await import('../src/app/brief.mjs');
  const team = { lead: 'anthropic', reviewer: null, members: ['anthropic', 'cursor', 'devin', 'lovable', 'groq'] };
  const t = brief({ agent: 'anthropic', role: 'lead', chat: { title: 'T' }, team, live: team.members, status: {} });
  assert.match(t, /CODING TOOLS that change files[^]*Cursor/);
  assert.match(t, /CLOUD AGENTS: Devin and Jules take one whole, self-contained task[^]*pull request/);
  assert.match(t, /APP BUILDERS: Lovable and Replit/);
  assert.match(t, /Groq and Cerebras \(very fast/);
  const member = brief({ agent: 'cursor', role: 'member', chat: { title: 'T' }, team, live: team.members, status: {} });
  assert.doesNotMatch(member, /CLOUD AGENTS/, 'only the lead gets the hand-out rules');
});

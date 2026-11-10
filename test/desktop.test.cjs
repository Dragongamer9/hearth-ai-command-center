// "Let your AI use this desktop": Agent Desktop behind the owner's approval.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const proxy = require('../electron/desktop-proxy.cjs');
const { createDesktop, summarize } = require('../electron/desktop.cjs');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-desk-')); made.push(d); return d; };
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('only looking goes straight through; every action (and anything unknown) asks', () => {
  for (const t of ['desktop_snapshot', 'desktop_find', 'desktop_get', 'desktop_is', 'desktop_list_windows', 'desktop_list_apps', 'desktop_status']) assert.equal(proxy.needsOk(t), false, t);
  for (const t of ['desktop_click', 'desktop_type', 'desktop_press', 'desktop_launch', 'desktop_close_app', 'desktop_drag', 'desktop_mouse_click', 'desktop_screenshot', 'desktop_clipboard_get', 'desktop_clipboard_set', 'desktop_batch', 'desktop_set_value', 'desktop_something_new']) assert.equal(proxy.needsOk(t), true, t);
  assert.equal(proxy.AGENT_DESKTOP, 'agent-desktop@1.2.0');
});

test('what the card shows', () => {
  assert.deepEqual(summarize('click', { ref: '@e12' }), { tool: 'click', detail: '@e12', args: '{"ref":"@e12"}' });
  assert.equal(summarize('type', { ref: '@e3', text: 'hello' }).detail, 'hello');
});

async function post(url, token, body) {
  const r = await fetch(`${url}/ask`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

test('approval server: token needed, off says no, Allow / 10 minutes / no answer', async () => {
  const d = tmp();
  const sent = [];
  const dk = createDesktop({ file: path.join(d, 'desktop.json'), send: (ch, x) => sent.push([ch, x]), proxyPath: '/x/desktop-proxy.cjs', waitMs: 300 });
  const url = await dk.start();
  try {
    assert.equal(dk.serverFor('c1'), null, 'off by default: no connector');
    const env0 = (() => { dk.setEnabled(true); const s = dk.serverFor('c1'); dk.setEnabled(false); return s.plainEnv; })();
    const token = env0.HEARTH_DESKTOP_TOKEN;
    assert.match(env0.HEARTH_DESKTOP_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await post(url, null, { chat: 'c1', tool: 'click' })).status, 403);
    assert.equal((await post(url, 'wrong'.padEnd(token.length, 'x'), { chat: 'c1', tool: 'click' })).status, 403);
    assert.equal((await post(url, token, { chat: 'c1', tool: 'click' })).json.ok, false, 'off: no');
    dk.setEnabled(true);
    // Allow once
    let p = post(url, token, { chat: 'c1', tool: 'click', args: { ref: '@e1' } });
    await new Promise((r) => setTimeout(r, 50));
    let ask = sent.filter(([ch]) => ch === 'desktop:ask').pop()[1];
    assert.equal(ask.tool, 'click');
    dk.answer(ask.id, 'once');
    assert.equal((await p).json.ok, true);
    // No answer: no
    assert.equal((await post(url, token, { chat: 'c1', tool: 'type' })).json.ok, false);
    // Allow for 10 minutes: this chat only
    p = post(url, token, { chat: 'c1', tool: 'press' });
    await new Promise((r) => setTimeout(r, 50));
    ask = sent.filter(([ch]) => ch === 'desktop:ask').pop()[1];
    dk.answer(ask.id, 'ten');
    assert.equal((await p).json.ok, true);
    assert.equal((await post(url, token, { chat: 'c1', tool: 'launch' })).json.ok, true, 'within 10 minutes, same chat');
    assert.equal((await post(url, token, { chat: 'c2', tool: 'launch' })).json.ok, false, 'another chat still asks');
    dk.setEnabled(false);
    assert.equal((await post(url, token, { chat: 'c1', tool: 'launch' })).json.ok, false, 'turning it off ends the 10 minutes');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'desktop.json'), 'utf8')).enabled, false);
  } finally { dk.stop(); }
});

test('the proxy: looking is passed on, a refused action never reaches Agent Desktop', async () => {
  const d = tmp();
  // A stand-in for `npx -y agent-desktop@… mcp`: answers every request with the tool name it got.
  const fake = path.join(d, 'fake.cjs');
  fs.writeFileSync(fake, "require('readline').createInterface({input:process.stdin}).on('line',(l)=>{const m=JSON.parse(l);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'ran '+(m.params&&m.params.name)}]}})+'\\n');});");
  const npx = path.join(d, 'npx');
  fs.writeFileSync(npx, `#!/bin/sh\nexec "${process.execPath}" "${fake}"\n`, { mode: 0o755 });
  const sent = [];
  const dk = createDesktop({ file: path.join(d, 'desktop.json'), send: (ch, x) => sent.push([ch, x]), proxyPath: path.join(__dirname, '..', 'electron', 'desktop-proxy.cjs'), execPath: process.execPath, waitMs: 2000 });
  await dk.start();
  dk.setEnabled(true);
  const s = dk.serverFor('chat-1');
  const child = spawn(s.command, s.args, { env: { ...process.env, ...s.plainEnv, ELECTRON_RUN_AS_NODE: '1', HEARTH_DESKTOP_NPX: npx }, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  readline.createInterface({ input: child.stdout }).on('line', (l) => lines.push(JSON.parse(l)));
  const call = (id, name) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { ref: '@e1' } } })}\n`);
  const waitFor = async (id) => { for (let i = 0; i < 100; i++) { const m = lines.find((x) => x.id === id); if (m) return m; await new Promise((r) => setTimeout(r, 30)); } throw new Error(`no reply ${id}`); };
  try {
    call(1, 'desktop_snapshot');
    assert.equal((await waitFor(1)).result.content[0].text, 'ran desktop_snapshot');
    call(2, 'desktop_click');
    for (let i = 0; i < 50 && !sent.some(([ch]) => ch === 'desktop:ask'); i++) await new Promise((r) => setTimeout(r, 30));
    const ask = sent.find(([ch]) => ch === 'desktop:ask')[1];
    assert.equal(ask.chat, 'chat-1');
    dk.answer(ask.id, 'no');
    const r2 = await waitFor(2);
    assert.equal(r2.result.isError, true);
    assert.match(r2.result.content[0].text, /didn't allow click/);
    call(3, 'desktop_click');
    for (let i = 0; i < 50 && sent.filter(([ch]) => ch === 'desktop:ask').length < 2; i++) await new Promise((r) => setTimeout(r, 30));
    dk.answer(sent.filter(([ch]) => ch === 'desktop:ask')[1][1].id, 'once');
    assert.equal((await waitFor(3)).result.content[0].text, 'ran desktop_click');
  } finally { child.kill(); dk.stop(); }
});

test('wiring: a connector per run while on, the card in the window, the proxy unpacked', () => {
  assert.match(read('electron/parity.cjs'), /\[reverse\.serverFor\(chatId\), desktop\.serverFor\(chatId\)\]/);
  assert.match(read('package.json'), /"asarUnpack": \[\s*"electron\/desktop-proxy\.cjs"\s*\]/);
  const ui = read('src/main.js');
  assert.match(ui, /data-a="desk-ans"[^>]*data-v="once">Allow</);
  assert.match(ui, /Every action asks you first/);
  assert.match(ui, /'desk-toggle'/);
});

// The "desktop" connector: Agent Desktop (github.com/vercel-labs/agent-desktop, Apache-2.0)
// behind the owner's approval. This file runs as its own small process (Electron as Node) that
// speaks MCP over stdio to the AI's CLI and passes messages to `agent-desktop mcp` (pinned via
// npx). Looking (snapshot, find, list…) goes straight through. Every other tool call (clicks,
// typing, keys, launching or closing apps, windows, clipboard, screenshots, batches) waits
// for the owner's answer from the Command Center window; no answer in 2 minutes is a no.
// Needs: HEARTH_DESKTOP_URL + HEARTH_DESKTOP_TOKEN (the app's local approval server for this
// run) and HEARTH_DESKTOP_CHAT (the chat it belongs to).
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const AGENT_DESKTOP = 'agent-desktop@1.2.0'; // pinned: changed on purpose, never "latest"
// Tools that only look; everything else asks first (an unknown tool asks too).
const LOOK = new Set(['snapshot', 'find', 'get', 'is', 'list_surfaces', 'list_apps', 'list_windows', 'list_displays', 'list_notifications', 'wait', 'status', 'version', 'skills']);
const bare = (name) => String(name || '').replace(/^desktop_/, '').replace(/-/g, '_');
const needsOk = (name) => !LOOK.has(bare(name));

async function ask(tool, args, { url, token, chat, fetchImpl = fetch, timeoutMs = 125000 }) {
  try {
    const r = await fetchImpl(`${url}/ask`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ chat, tool: bare(tool), args }), signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json();
    return j && j.ok === true;
  } catch { return false; }
}

function refusal(id, tool) {
  return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `The owner didn't allow ${bare(tool).replace(/_/g, '-')} this time. Ask them in the chat before trying again.` }] } };
}

function main() {
  const env = process.env;
  const conf = { url: env.HEARTH_DESKTOP_URL, token: env.HEARTH_DESKTOP_TOKEN, chat: env.HEARTH_DESKTOP_CHAT || '' };
  const child = spawn(env.HEARTH_DESKTOP_NPX || 'npx', ['-y', AGENT_DESKTOP, 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...env, ELECTRON_RUN_AS_NODE: undefined } });
  const toClient = (o) => process.stdout.write(`${typeof o === 'string' ? o : JSON.stringify(o)}\n`);
  readline.createInterface({ input: child.stdout }).on('line', (line) => toClient(line));
  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    let msg = null;
    try { msg = JSON.parse(line); } catch { child.stdin.write(`${line}\n`); return; }
    if (msg && msg.method === 'tools/call' && needsOk(msg.params?.name)) {
      const ok = conf.url && conf.token ? await ask(msg.params.name, msg.params.arguments || {}, conf) : false;
      if (!ok) { toClient(refusal(msg.id, msg.params.name)); return; }
    }
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  });
  process.stdin.on('end', () => { try { child.stdin.end(); } catch {} });
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { try { child.kill(s); } catch {} process.exit(0); });
}

if (require.main === module) main();
module.exports = { LOOK, needsOk, bare, ask, refusal, AGENT_DESKTOP };

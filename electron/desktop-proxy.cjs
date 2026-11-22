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

// 3.14 (claude-look-10): what the owner sees when it asks: a picture of the screen and, when the action names an
// element, where it is. Taken by this proxy (not by the AI), sent only to the Command Center window on this PC, never
// back to the AI. Anything missing or slow (4 s) is simply left out; the ask still goes through.
const PEEK_MS = 4000;
const MAX_SHOT = 6 * 1024 * 1024; // base64 characters
function imageFrom(result) {
  for (const c of result?.content || []) if (c && c.type === 'image' && typeof c.data === 'string' && /^image\/(png|jpeg|webp)$/.test(c.mimeType || '') && c.data.length <= MAX_SHOT && /^[A-Za-z0-9+/=\s]+$/.test(c.data.slice(0, 200))) return { data: c.data.replace(/\s+/g, ''), mime: c.mimeType };
  return null;
}
// Bounds from any answer shape: { bounds: { x, y, width, height } } or x / y / width / height together.
function boundsFrom(result) {
  const texts = (result?.content || []).filter((c) => c && c.type === 'text').map((c) => String(c.text || ''));
  if (result?.structuredContent) texts.push(JSON.stringify(result.structuredContent));
  for (const t of texts) {
    const num = (k) => { const m = t.match(new RegExp(`"${k}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`)); return m ? Number(m[1]) : null; };
    const x = num('x'); const y = num('y'); const w = num('width') ?? num('w'); const h = num('height') ?? num('h');
    if ([x, y, w, h].every((v) => Number.isFinite(v)) && w > 0 && h > 0 && w < 20000 && h < 20000) return { x, y, w, h };
  }
  return null;
}
async function ask(tool, args, { url, token, chat, peek = null, fetchImpl = fetch, timeoutMs = 125000 }) {
  try {
    const r = await fetchImpl(`${url}/ask`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ chat, tool: bare(tool), args, ...(peek ? { peek } : {}) }), signal: AbortSignal.timeout(timeoutMs) });
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
  const tools = new Set();
  const own = new Map(); // this proxy's own requests to agent-desktop: id -> resolve
  let n = 0;
  const call = (name, args) => new Promise((resolve) => {
    const id = `hearth-peek-${++n}`;
    const t = setTimeout(() => { own.delete(id); resolve(null); }, PEEK_MS);
    own.set(id, (r) => { clearTimeout(t); resolve(r); });
    try { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`); } catch { clearTimeout(t); own.delete(id); resolve(null); }
  });
  const named = (b) => [...tools].find((t) => bare(t) === b);
  async function peekFor(args) {
    const shot = named('screenshot');
    const get = named('get');
    const [s, g] = await Promise.all([shot ? call(shot, {}) : null, get && args?.ref ? call(get, { ref: args.ref, property: 'bounds' }) : null]);
    const image = imageFrom(s?.result);
    const mark = boundsFrom(g?.result) || (Number.isFinite(Number(args?.x)) && Number.isFinite(Number(args?.y)) ? { x: Number(args.x), y: Number(args.y), w: 1, h: 1 } : null);
    return image || mark ? { ...(image || {}), ...(mark ? { mark } : {}) } : null;
  }
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let m = null;
    try { m = JSON.parse(line); } catch {}
    if (m && typeof m.id === 'string' && own.has(m.id)) { const r = own.get(m.id); own.delete(m.id); r(m); return; }
    if (m && Array.isArray(m.result?.tools)) for (const t of m.result.tools) if (t && typeof t.name === 'string') tools.add(t.name);
    toClient(line);
  });
  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    let msg = null;
    try { msg = JSON.parse(line); } catch { child.stdin.write(`${line}\n`); return; }
    if (msg && msg.method === 'tools/call' && needsOk(msg.params?.name)) {
      const peek = conf.url && conf.token ? await peekFor(msg.params.arguments || {}).catch(() => null) : null;
      const ok = conf.url && conf.token ? await ask(msg.params.name, msg.params.arguments || {}, { ...conf, peek }) : false;
      if (!ok) { toClient(refusal(msg.id, msg.params.name)); return; }
    }
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  });
  process.stdin.on('end', () => { try { child.stdin.end(); } catch {} });
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { try { child.kill(s); } catch {} process.exit(0); });
}

if (require.main === module) main();
module.exports = { LOOK, needsOk, bare, ask, refusal, imageFrom, boundsFrom, AGENT_DESKTOP };

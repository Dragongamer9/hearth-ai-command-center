// Connectors (MCP servers) the owner adds in Settings › Connectors, handed to Claude Code
// (--mcp-config), Codex (-c mcp_servers.*) and the Gemini CLI (a system settings file).
// Secrets (environment values, header values such as tokens) go ONLY into the encrypted
// secret store. The config files the CLIs read hold ${VAR} references; the values reach
// the CLI process through its environment and are never written to disk in plain text.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createJsonFile, atomicWrite } = require('./jsonfile.cjs');

const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const secretName = (id, kind, key) => `mcp.${id}.${kind}.${key}`;
const envVar = (id, kind, key) => `HEARTH_MCP_${id.toUpperCase()}_${kind === 'header' ? 'H' : 'E'}_${key.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;

function createConnectors({ file, secrets }) {
  const f = createJsonFile(file, { empty: () => ({ version: 1, servers: [] }), check: (j) => Array.isArray(j.servers), label: 'Your connectors file' });
  const list = () => f.read().servers.map((s) => ({ ...s, secrets: [...s.envKeys.map((k) => ({ kind: 'env', key: k, saved: secrets.has(secretName(s.id, 'env', k)) })), ...s.headerKeys.map((k) => ({ kind: 'header', key: k, saved: secrets.has(secretName(s.id, 'header', k)) }))] }));
  async function add(spec = {}) {
    const name = String(spec.name || '').trim();
    if (!NAME_RE.test(name)) throw new Error('Give it a short name: letters, numbers, - and _.');
    if (f.read().servers.some((s) => s.name === name)) throw new Error('A connector with that name exists.');
    const type = spec.type === 'http' ? 'http' : 'stdio';
    const s = { id: crypto.randomBytes(4).toString('hex'), name, type, enabled: true, envKeys: [], headerKeys: [], addedAt: new Date().toISOString() };
    if (type === 'stdio') {
      const command = String(spec.command || '').trim();
      if (!command || command.length > 300 || /[\0\n]/.test(command)) throw new Error('Type the command that starts the server.');
      s.command = command;
      s.args = (Array.isArray(spec.args) ? spec.args : []).map((a) => String(a)).filter((a) => a.length < 500 && !/[\0\n]/.test(a)).slice(0, 30);
    } else {
      const url = String(spec.url || '').trim();
      if (!/^https?:\/\/[^\s]{3,500}$/.test(url)) throw new Error('Type the server URL (https://…).');
      s.url = url;
    }
    const env = spec.env && typeof spec.env === 'object' ? spec.env : {};
    const headers = spec.headers && typeof spec.headers === 'object' ? spec.headers : {};
    const pending = [];
    for (const [k, v] of Object.entries(env)) { if (!KEY_RE.test(k)) throw new Error(`Bad variable name: ${k}`); s.envKeys.push(k); pending.push([secretName(s.id, 'env', k), String(v)]); }
    for (const [k, v] of Object.entries(headers)) { if (!KEY_RE.test(k)) throw new Error(`Bad header name: ${k}`); s.headerKeys.push(k); pending.push([secretName(s.id, 'header', k), String(v)]); }
    // Every secret value goes to the encrypted store first; nothing is saved if that fails.
    if (pending.length && !(await secrets.available())) throw new Error('This PC has no keyring for encrypted secrets, so the connector was not saved.');
    for (const [n, v] of pending) await secrets.set(n, v);
    f.write({ version: 1, servers: [...f.read().servers, s] });
    return s;
  }
  function setEnabled(id, on) { const servers = f.read().servers.map((s) => (s.id === id ? { ...s, enabled: on === true } : s)); f.write({ version: 1, servers }); return { ok: true }; }
  function remove(id) {
    const s = f.read().servers.find((x) => x.id === id);
    if (!s) return { ok: false };
    for (const k of s.envKeys) secrets.remove(secretName(id, 'env', k));
    for (const k of s.headerKeys) secrets.remove(secretName(id, 'header', k));
    f.write({ version: 1, servers: f.read().servers.filter((x) => x.id !== id) });
    return { ok: true };
  }
  // For one run: config files with ${VAR} references, plus the env holding the values.
  function forRun(runDir) {
    const servers = f.read().servers.filter((s) => s.enabled);
    if (!servers.length) return null;
    const env = {};
    const codexEnv = {};
    const claude = { mcpServers: {} };
    const gemini = { mcpServers: {} };
    const codexArgs = [];
    const toml = (v) => JSON.stringify(v);
    for (const s of servers) {
      const e = {};
      const h = {};
      for (const k of s.envKeys) { const v = secrets.get(secretName(s.id, 'env', k)); if (v == null) continue; const n = envVar(s.id, 'env', k); env[n] = v; codexEnv[k] = v; e[k] = n; }
      for (const k of s.headerKeys) { const v = secrets.get(secretName(s.id, 'header', k)); if (v == null) continue; const n = envVar(s.id, 'header', k); env[n] = v; h[k] = n; }
      if (s.type === 'stdio') {
        claude.mcpServers[s.name] = { type: 'stdio', command: s.command, args: s.args, env: Object.fromEntries(Object.entries(e).map(([k, n]) => [k, `\${${n}}`])) };
        gemini.mcpServers[s.name] = { command: s.command, args: s.args, env: Object.fromEntries(Object.entries(e).map(([k, n]) => [k, `$${n}`])) };
        codexArgs.push('-c', `mcp_servers.${s.name}.command=${toml(s.command)}`, '-c', `mcp_servers.${s.name}.args=${toml(s.args)}`);
        if (s.envKeys.length) codexArgs.push('-c', `mcp_servers.${s.name}.env_vars=${toml(s.envKeys)}`);
      } else {
        claude.mcpServers[s.name] = { type: 'http', url: s.url, headers: Object.fromEntries(Object.entries(h).map(([k, n]) => [k, `\${${n}}`])) };
        gemini.mcpServers[s.name] = { httpUrl: s.url, headers: Object.fromEntries(Object.entries(h).map(([k, n]) => [k, `$${n}`])) };
        codexArgs.push('-c', `mcp_servers.${s.name}.url=${toml(s.url)}`);
        const auth = Object.entries(h).find(([k]) => k.toLowerCase() === 'authorization');
        if (auth) { const bare = `${auth[1]}_BEARER`; const v = String(env[auth[1]] || '').replace(/^Bearer\s+/i, ''); env[bare] = v; codexArgs.push('-c', `mcp_servers.${s.name}.bearer_token_env_var=${toml(bare)}`); }
      }
    }
    fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
    const tag = crypto.randomBytes(4).toString('hex');
    const claudeFile = path.join(runDir, `mcp-claude-${tag}.json`);
    const geminiFile = path.join(runDir, `mcp-gemini-${tag}.json`);
    atomicWrite(claudeFile, JSON.stringify(claude, null, 1));
    atomicWrite(geminiFile, JSON.stringify(gemini, null, 1));
    return {
      names: servers.map((s) => s.name), claudeFile, geminiFile, codexArgs, env, codexEnv,
      cleanup() { for (const x of [claudeFile, geminiFile]) { try { fs.unlinkSync(x); } catch {} } },
    };
  }
  return { list, add, remove, setEnabled, forRun, broken: () => f.broken() };
}

module.exports = { createConnectors, secretName, envVar };

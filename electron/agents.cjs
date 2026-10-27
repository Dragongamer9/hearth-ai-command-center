// Account-linked agents: drives the official CLIs on this machine, which sign in
// with the user's own subscriptions (no API credit needed).
//   Claude   -> Claude Code  (`claude -p`)          sign in: `claude auth login`
//   ChatGPT  -> OpenAI Codex (`codex exec`)         sign in: `codex login`
//   Gemini   -> Gemini CLI   (`gemini -p`)          sign in: run `gemini`, "Sign in with Google"
//   Local    -> Ollama on this machine (HTTP on 127.0.0.1:11434, no account)
//   FreeBuff -> `freebuff` (interactive only; opened in a terminal)
// Every process is started with execFile/spawn and an argument array (never a
// shell), prompts go in over stdin, and runs have hard timeouts.
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = { anthropic: 'claude', openai: 'codex', google: 'gemini', freebuff: 'freebuff', ollama: 'ollama' };
const LOGIN = { anthropic: ['auth', 'login'], openai: ['login'], google: [], freebuff: [] };
const NPM_PACKAGE = {
  anthropic: '@anthropic-ai/claude-code',
  openai: '@openai/codex',
  google: '@google/gemini-cli',
  freebuff: 'freebuff',
};
const OLLAMA = process.env.OLLAMA_HOST && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(process.env.OLLAMA_HOST)
  ? process.env.OLLAMA_HOST
  : 'http://127.0.0.1:11434';

function searchDirs() {
  const home = os.homedir();
  const extra = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.local', 'npm', 'bin'),
    path.join(home, '.config', 'npm', 'bin'),
    path.join(home, '.local', 'share', 'pnpm'),
    path.join(home, '.local', 'share', 'mise', 'shims'),
    path.join(home, '.asdf', 'shims'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, '.volta', 'bin'),
    path.join(home, 'bin'),
    '/usr/local/bin',
    '/usr/bin',
  ];
  // Desktop launchers may not inherit a login shell's npm prefix or PATH.
  // Only add npm's user-level prefix; never invoke a shell to discover tools.
  const npmPrefix = process.env.npm_config_prefix || process.env.NPM_CONFIG_PREFIX;
  if (npmPrefix && path.isAbsolute(npmPrefix)) extra.push(path.join(npmPrefix, 'bin'));
  const nvm = path.join(home, '.nvm', 'versions', 'node');
  try {
    for (const v of fs.readdirSync(nvm)) extra.push(path.join(nvm, v, 'bin'));
  } catch {}
  return [...new Set([...(process.env.PATH || '').split(path.delimiter), ...extra])].filter(Boolean);
}

// Env for child processes: a desktop-launched AppImage often has a thin PATH.
function childEnv() {
  const env = { ...process.env, PATH: searchDirs().join(path.delimiter), NO_COLOR: '1', TERM: 'dumb' };
  // Don't leak AppImage runtime internals into the agent CLIs.
  for (const k of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']) delete env[k];
  return env;
}

function findBinary(agent, custom) {
  if (custom) return fs.existsSync(custom) ? custom : null;
  for (const dir of searchDirs()) {
    const p = path.join(dir, BIN[agent]);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

function run(file, args, { cwd, input, timeoutMs = 60000, signal } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const child = spawn(file, args, { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000);
      finish({ code: null, out, err, timedOut: true });
    }, timeoutMs);
    signal?.addEventListener('abort', () => {
      child.kill('SIGTERM');
      finish({ code: null, out, err, cancelled: true });
    });
    child.stdout.on('data', (d) => { if (out.length < 2e6) out += d; });
    child.stderr.on('data', (d) => { if (err.length < 2e5) err += d; });
    child.on('error', (e) => finish({ code: null, out, err: String(e.message), spawnError: true }));
    child.on('close', (code) => finish({ code, out, err }));
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

// Out-of-usage detection across Claude, Codex and API error text.
const LIMIT_RE = /usage limit|rate[ _-]?limit|quota|credit balance|out of (credits|usage)|hit your (usage )?limit|limit reached|too many requests|\b429\b|insufficient_quota|plan limit|resets? (at|in)/i;
function isLimit(text) {
  return LIMIT_RE.test(String(text || ''));
}
function resetHint(text) {
  const m = String(text || '').match(/(resets?|try again)\s+((?:at|in)\s+)?([^.\n|"]{1,40})/i);
  return m ? `${m[1]} ${(m[2] || '').trim()} ${m[3]}`.replace(/\s+/g, ' ').trim() : null;
}

function parseClaude(stdout) {
  const s = stdout.trim();
  const start = s.lastIndexOf('\n{') >= 0 ? s.lastIndexOf('\n{') + 1 : s.indexOf('{');
  try {
    const j = JSON.parse(s.slice(Math.max(0, start)));
    return { text: typeof j.result === 'string' ? j.result : '', isError: Boolean(j.is_error), raw: j };
  } catch {
    return { text: s, isError: false, raw: null };
  }
}

function classify(agent, res, text) {
  const all = `${text}\n${res.err}\n${res.out}`.slice(-20000);
  if (res.spawnError) return { kind: 'not_installed', message: `${BIN[agent]} could not be started: ${res.err}` };
  if (res.timedOut) return { kind: 'timeout', message: 'The agent took too long and was stopped. Its progress so far is checkpointed.' };
  if (res.cancelled) return { kind: 'cancelled', message: 'Stopped by you.' };
  if (isLimit(all)) return { kind: 'limit', message: 'Out of usage.', reset: resetHint(all) };
  if (/overloaded|service unavailable|internal server error|bad gateway|gateway timeout|\b50[0234]\b|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network error|fetch failed|stream disconnected/i.test(all)) {
    return { kind: 'outage', message: 'The provider is unreachable or having problems. Work so far is saved; resume when it is back.' };
  }
  if (/not logged in|log ?in|authenticat|unauthori[sz]ed|invalid api key|\b401\b/i.test(all)) {
    return { kind: 'auth', message: 'Not signed in. Use “Sign in” on the Agents page.' };
  }
  const tail = (res.err || res.out || '').trim().split('\n').slice(-3).join(' ').slice(0, 300);
  return { kind: 'failed', message: tail || `Exited with code ${res.code}` };
}

async function runOllama({ prompt, model, timeoutMs = 300000, signal }) {
  const st = await ollamaStatus();
  if (!st.installed) return { ok: false, error: { kind: 'not_installed', message: 'Ollama is not running on this computer.' } };
  const use = model && st.models.includes(model) ? model : st.models[0];
  if (!use) return { ok: false, error: { kind: 'not_installed', message: 'Ollama has no models yet. Run e.g. `ollama pull llama3.2` first.' } };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener('abort', () => controller.abort());
  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: use, stream: false, messages: [{ role: 'user', content: prompt }] }),
      signal: controller.signal,
    });
    const j = await r.json().catch(() => null);
    const text = j?.message?.content;
    if (r.ok && typeof text === 'string' && text) return { ok: true, text, via: `Ollama · ${use}` };
    return { ok: false, error: { kind: 'failed', message: (j?.error || `HTTP ${r.status}`).toString().slice(0, 300) } };
  } catch (e) {
    if (signal?.aborted) return { ok: false, error: { kind: 'cancelled', message: 'Stopped by you.' } };
    if (e.name === 'AbortError') return { ok: false, error: { kind: 'timeout', message: 'The local model took too long.' } };
    return { ok: false, error: { kind: 'outage', message: 'Could not reach Ollama on this computer.' } };
  } finally {
    clearTimeout(timer);
  }
}

async function ollamaStatus() {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    const models = Array.isArray(j.models) ? j.models.map((m) => String(m.name)).filter(Boolean) : [];
    return { installed: true, signedIn: true, path: OLLAMA, models };
  } catch {
    return { installed: false, signedIn: false, path: null, models: [] };
  }
}

function parseGemini(stdout) {
  const s = stdout.trim();
  const start = s.indexOf('{');
  try {
    const j = JSON.parse(s.slice(Math.max(0, start)));
    const err = j.error ? (typeof j.error === 'string' ? j.error : j.error.message || JSON.stringify(j.error)) : null;
    return { text: typeof j.response === 'string' ? j.response : '', error: err };
  } catch {
    return { text: s, error: null };
  }
}

// mode: 'read'     — look, answer, plan, browse the web; no changes
//       'standard' — what the tool does in its own app when working on its own:
//                    edits, commands and web, with the tool's built-in safety checks
//       'full'     — no safety checks at all (owner opt-in only)
// ('edit' is accepted as 'standard'.) extraDirs: other folders the owner granted.
async function runAgent({ agent, prompt, cwd, mode = 'read', model, timeoutMs, signal, bin, extraDirs = [] }) {
  if (mode === 'edit') mode = 'standard';
  const dirs = extraDirs.filter((d) => typeof d === 'string' && path.isAbsolute(d) && fs.existsSync(d));
  const file = bin || findBinary(agent);
  if (agent === 'ollama') return runOllama({ prompt, model, timeoutMs, signal });
  if (!file) return { ok: false, error: { kind: 'not_installed', message: `${BIN[agent]} is not installed.` } };
  if (agent === 'freebuff') {
    return { ok: false, error: { kind: 'interactive', message: 'FreeBuff only runs interactively — open it in a terminal from the task.' } };
  }
  const workdir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();

  if (agent === 'anthropic') {
    const perm = { read: 'plan', standard: 'auto', full: 'bypassPermissions' }[mode];
    const args = ['-p', '--output-format', 'json', '--permission-mode', perm, '--allowedTools', 'WebSearch', 'WebFetch'];
    if (mode === 'full') args.push('--dangerously-skip-permissions');
    for (const d of dirs) args.push('--add-dir', d);
    if (model) args.push('--model', model);
    const res = await run(file, args, { cwd: workdir, input: prompt, timeoutMs, signal });
    const parsed = parseClaude(res.out);
    if (res.code === 0 && !parsed.isError && parsed.text) return { ok: true, text: parsed.text, via: 'Claude Code' };
    return { ok: false, error: classify(agent, res, parsed.text), partial: parsed.text || null };
  }

  if (agent === 'openai') {
    const outFile = path.join(os.tmpdir(), `hearth-codex-${process.pid}-${Date.now()}.txt`);
    const args = ['exec', '--skip-git-repo-check', '--color', 'never', '-C', workdir, '-o', outFile];
    if (mode === 'full') args.push('--dangerously-bypass-approvals-and-sandbox');
    else if (mode === 'standard') args.push('--approve-for-me');
    else args.push('-s', 'read-only');
    if (mode !== 'read') for (const d of dirs) args.push('--add-dir', d);
    if (model) args.push('-m', model);
    args.push('-');
    const res = await run(file, args, { cwd: workdir, input: prompt, timeoutMs, signal });
    let text = '';
    try {
      text = fs.readFileSync(outFile, 'utf8').trim();
      fs.unlinkSync(outFile);
    } catch {}
    if (res.code === 0 && text) return { ok: true, text, via: 'Codex' };
    return { ok: false, error: classify(agent, res, text), partial: text || null };
  }
  if (agent === 'google') {
    // Brief comes in over stdin; -p forces headless mode and is appended to it.
    const args = ['-p', 'Follow the instructions above.', '--output-format', 'json', '--approval-mode', { read: 'plan', standard: 'auto_edit', full: 'yolo' }[mode]];
    if (dirs.length) args.push('--include-directories', dirs.join(','));
    if (model) args.push('-m', model);
    const res = await run(file, args, { cwd: workdir, input: prompt, timeoutMs, signal });
    const parsed = parseGemini(res.out);
    if (res.code === 0 && !parsed.error && parsed.text) return { ok: true, text: parsed.text, via: 'Gemini CLI' };
    return { ok: false, error: classify(agent, res, `${parsed.error || ''}\n${parsed.text}`), partial: parsed.text || null };
  }
  return { ok: false, error: { kind: 'unsupported', message: 'Unknown agent.' } };
}

function geminiSignedIn() {
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return true;
  const dir = path.join(os.homedir(), '.gemini');
  if (fs.existsSync(path.join(dir, 'oauth_creds.json'))) return true;
  try {
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    if (st?.security?.auth?.selectedType === 'gemini-api-key' || st?.selectedAuthType === 'gemini-api-key') return Boolean(process.env.GEMINI_API_KEY);
    // Selecting OAuth is a preference, not proof of completed Google sign-in.
    if (st?.security?.auth?.selectedType === 'oauth-personal' || st?.selectedAuthType === 'oauth-personal') return fs.existsSync(path.join(dir, 'oauth_creds.json'));
    if (st?.security?.auth?.selectedType === 'vertex-ai' || st?.selectedAuthType === 'vertex-ai') return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  } catch {}
  return false;
}

async function status(agent, bin) {
  if (agent === 'ollama') return ollamaStatus();
  const file = bin || findBinary(agent);
  if (!file) return { installed: false, signedIn: false, path: null };
  if (agent === 'anthropic') {
    const r = await run(file, ['auth', 'status'], { timeoutMs: 15000 });
    let signedIn = false;
    try { signedIn = Boolean(JSON.parse(r.out).loggedIn); } catch { signedIn = r.code === 0 && !/not logged/i.test(r.out); }
    return { installed: true, signedIn, path: file };
  }
  if (agent === 'openai') {
    const r = await run(file, ['login', 'status'], { timeoutMs: 15000 });
    return { installed: true, signedIn: r.code === 0 && !/not logged/i.test(r.out + r.err), path: file };
  }
  if (agent === 'google') return { installed: true, signedIn: geminiSignedIn(), path: file };
  // FreeBuff has no status command; signing in happens inside its own session.
  return { installed: true, signedIn: null, path: file };
}

const TERMINALS = [
  ['x-terminal-emulator', ['-e']],
  ['gnome-terminal', ['--']],
  ['konsole', ['-e']],
  ['kgx', ['--']],
  ['ptyxis', ['--']],
  ['xfce4-terminal', ['-x']],
  ['kitty', []],
  ['alacritty', ['-e']],
  ['foot', []],
  ['wezterm', ['start', '--']],
  ['tilix', ['-e']],
  ['xterm', ['-e']],
];

// Open an interactive terminal (sign-in flows, installs, FreeBuff sessions).
// With hold: true the window stays open afterwards so you can read the result.
function openTerminal(file, args, cwd, { hold = false } = {}) {
  let cmd = [file, ...args];
  if (hold) {
    // Fixed script; the program and its arguments are passed as positional
    // parameters ("$@"), never pasted into the shell text.
    cmd = ['/bin/sh', '-c', '"$@"; s=$?; echo; if [ $s -eq 0 ]; then echo "Done. Return to Hearth AI and press Re-check."; else echo "Finished with an error (code $s)."; fi; printf "Press Enter to close… "; read _', 'hearth', file, ...args];
  }
  for (const [term, pre] of TERMINALS) {
    const t = searchDirs().map((d) => path.join(d, term)).find((p) => fs.existsSync(p));
    if (!t) continue;
    const child = spawn(t, [...pre, ...cmd], { cwd: cwd || os.homedir(), env: childEnv(), detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return { ok: true, terminal: term };
  }
  return { ok: false, message: 'No terminal app found (tried gnome-terminal, konsole, kitty, xterm and others).' };
}

function login(agent, bin, cwd) {
  const file = bin || findBinary(agent);
  if (!file) return { ok: false, message: `${BIN[agent]} is not installed.` };
  // Gemini opens an interactive OAuth selection screen; keep terminal open on exit
  // so authentication errors are visible instead of disappearing immediately.
  return openTerminal(file, LOGIN[agent], cwd, { hold: ['anthropic', 'openai', 'google'].includes(agent) });
}

// Sign out using each tool's own sign-out. The Command Center never holds the
// login itself, so disconnecting means asking the official tool to forget it.
async function logout(agent, bin) {
  const file = bin || findBinary(agent);
  if (agent === 'anthropic' || agent === 'openai') {
    if (!file) return { ok: false, message: `${BIN[agent]} is not installed.` };
    const r = await run(file, agent === 'anthropic' ? ['auth', 'logout'] : ['logout'], { timeoutMs: 20000 });
    return r.code === 0 ? { ok: true } : { ok: false, message: (r.err || r.out || `exit ${r.code}`).trim().split('\n').slice(-1)[0] };
  }
  if (agent === 'google') {
    // Gemini CLI has no sign-out command; its cached Google sign-in lives in
    // ~/.gemini/oauth_creds.json. Removing that file is how it signs out.
    const f = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
    if (!fs.existsSync(f)) return { ok: true, message: 'Gemini was not signed in with Google on this computer.' };
    fs.unlinkSync(f);
    return { ok: true };
  }
  return { ok: false, message: 'This one signs out inside its own app.' };
}

// One-click install of an agent's official CLI from npm, shown in a terminal.
function install(agent) {
  const pkg = NPM_PACKAGE[agent];
  if (!pkg) return { ok: false, message: 'No installer for this agent.' };
  const npm = searchDirs().map((d) => path.join(d, 'npm')).find((p) => fs.existsSync(p));
  if (!npm) return { ok: false, message: 'npm was not found. Install Node.js 18 or newer first (it includes npm).' };
  return openTerminal(npm, ['install', '-g', pkg], os.homedir(), { hold: true });
}

module.exports = { runAgent, status, login, logout, install, openTerminal, findBinary, isLimit, resetHint, parseClaude, parseGemini, BIN, NPM_PACKAGE, execFile };

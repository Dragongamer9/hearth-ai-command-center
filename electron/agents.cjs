// Account-linked agents: drives the official CLIs on this machine, which sign in
// with the user's own subscriptions (no API credit needed).
//   Claude   -> Claude Code  (`claude -p`)          sign in: `claude auth login`
//   ChatGPT  -> OpenAI Codex (`codex exec`)         sign in: `codex login`
//   FreeBuff -> `freebuff` (interactive only; opened in a terminal)
// Every process is started with execFile/spawn and an argument array (never a
// shell), prompts go in over stdin, and runs have hard timeouts.
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = { anthropic: 'claude', openai: 'codex', freebuff: 'freebuff' };
const LOGIN = { anthropic: ['auth', 'login'], openai: ['login'], freebuff: [] };

function searchDirs() {
  const home = os.homedir();
  const extra = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, '.volta', 'bin'),
    path.join(home, 'bin'),
    '/usr/local/bin',
    '/usr/bin',
  ];
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

// mode: 'read' (look, answer, plan — no file changes) or 'edit' (may edit files in cwd).
async function runAgent({ agent, prompt, cwd, mode = 'read', model, timeoutMs, signal, bin }) {
  const file = bin || findBinary(agent);
  if (!file) return { ok: false, error: { kind: 'not_installed', message: `${BIN[agent]} is not installed.` } };
  if (agent === 'freebuff') {
    return { ok: false, error: { kind: 'interactive', message: 'FreeBuff only runs interactively — open it in a terminal from the task.' } };
  }
  const workdir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();

  if (agent === 'anthropic') {
    const args = ['-p', '--output-format', 'json', '--permission-mode', mode === 'edit' ? 'acceptEdits' : 'plan'];
    if (model) args.push('--model', model);
    const res = await run(file, args, { cwd: workdir, input: prompt, timeoutMs, signal });
    const parsed = parseClaude(res.out);
    if (res.code === 0 && !parsed.isError && parsed.text) return { ok: true, text: parsed.text, via: 'Claude Code' };
    return { ok: false, error: classify(agent, res, parsed.text), partial: parsed.text || null };
  }

  if (agent === 'openai') {
    const outFile = path.join(os.tmpdir(), `hearth-codex-${process.pid}-${Date.now()}.txt`);
    const args = ['exec', '--skip-git-repo-check', '--color', 'never', '-s', mode === 'edit' ? 'workspace-write' : 'read-only', '-C', workdir, '-o', outFile];
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
  return { ok: false, error: { kind: 'unsupported', message: 'Unknown agent.' } };
}

async function status(agent, bin) {
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

// Open an interactive terminal (sign-in flows, FreeBuff sessions).
function openTerminal(file, args, cwd) {
  for (const [term, pre] of TERMINALS) {
    const t = searchDirs().map((d) => path.join(d, term)).find((p) => fs.existsSync(p));
    if (!t) continue;
    const child = spawn(t, [...pre, file, ...args], { cwd: cwd || os.homedir(), env: childEnv(), detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return { ok: true, terminal: term };
  }
  return { ok: false, message: 'No terminal app found (tried gnome-terminal, konsole, kitty, xterm and others).' };
}

function login(agent, bin, cwd) {
  const file = bin || findBinary(agent);
  if (!file) return { ok: false, message: `${BIN[agent]} is not installed.` };
  return openTerminal(file, LOGIN[agent], cwd);
}

module.exports = { runAgent, status, login, openTerminal, findBinary, isLimit, resetHint, parseClaude, BIN, execFile };

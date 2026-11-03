// Account-linked agents: drives the official CLIs on this machine, which sign in
// with the user's own subscriptions (no API credit needed).
//   Claude   -> Claude Code  (`claude -p`)          sign in: `claude auth login`
//   ChatGPT  -> OpenAI Codex (`codex exec`)         sign in: `codex login`
//   Gemini   -> Antigravity (`agy -p`), legacy `gemini` fallback; sign in: `agy`
//   Grok     -> xAI Grok Build (`grok -p`)       sign in: `grok login` (browser OAuth, grok.com account)
//   Mistral  -> Mistral Vibe (`vibe -p`)          sign in: `vibe --setup` (browser, Mistral account)
//   Qwen     -> Qwen Code (`qwen -p`)             sign in: run `qwen`, choose Qwen OAuth
//   Local    -> Ollama on this machine (HTTP on 127.0.0.1:11434, no account)
//   FreeBuff -> `freebuff` (interactive only; opened in a terminal)
// Every run reports the CLI's own session id, so the conversation can be
// resumed later in that CLI (`claude --resume <id>`, `codex resume <id>` …).
// Every process is started with execFile/spawn and an argument array (never a
// shell), prompts go in over stdin, and runs have hard timeouts.
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const crypto = require('node:crypto');
const installer = require('./installer.cjs');

const BIN = { anthropic: 'claude', openai: 'codex', google: 'agy', xai: 'grok', mistral: 'vibe', qwen: 'qwen', freebuff: 'freebuff', ollama: 'ollama' };
const CLI_AGENTS = ['anthropic', 'openai', 'google', 'xai', 'mistral', 'qwen'];
// Each tool's own sign-in. hold: keep the terminal open afterwards to read the result.
const LOGIN = { anthropic: ['auth', 'login'], openai: ['login'], google: [], xai: ['login'], mistral: ['--setup'], qwen: [], freebuff: [] };
const LOGIN_HOLD = ['anthropic', 'openai', 'xai'];
const NPM_PACKAGE = installer.NPM_PACKAGE;
// Claude Code adds AI attribution to commits/PRs by default; the owner's rule is
// commits only as Dragongamer9 with no AI attribution, so turn it off per run.
// Passed as a settings file (not inline JSON) in the user's own cache folder.
function claudeSettingsFile() {
  const dir = path.join(os.homedir(), '.cache', 'hearth-ai');
  const file = path.join(dir, 'claude-settings.json');
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify({ includeCoAuthoredBy: false, attribution: { commit: '', pr: '' } }), { mode: 0o600 });
    return file;
  } catch {
    return null;
  }
}
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
    path.join(home, '.grok', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, '.volta', 'bin'),
    path.join(home, 'bin'),
    '/usr/local/bin',
    '/usr/bin',
  ];
  // Desktop launchers may not inherit a login shell's npm prefix; never run a shell to find it.
  const npmPrefix = process.env.npm_config_prefix || process.env.NPM_CONFIG_PREFIX;
  if (npmPrefix && path.isAbsolute(npmPrefix)) extra.push(path.join(npmPrefix, 'bin'));
  const nvm = path.join(home, '.nvm', 'versions', 'node');
  try {
    for (const v of fs.readdirSync(nvm)) extra.push(path.join(nvm, v, 'bin'));
  } catch {}
  // Node.js set up by the one-click installer (only exists when the system had
  // none new enough) goes first so the CLIs' "#!/usr/bin/env node" finds it.
  const first = fs.existsSync(installer.nodeBin()) ? [installer.nodeBin()] : [];
  extra.push(path.join(installer.userPrefix(), 'bin'));
  return [...new Set([...first, ...(process.env.PATH || '').split(path.delimiter), ...extra])].filter(Boolean);
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
  for (const name of (agent === 'google' ? ['agy', 'gemini'] : [BIN[agent]])) for (const dir of searchDirs()) {
    const p = path.join(dir, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

const isAntigravity = (file) => /^agy(?:\.exe)?$/i.test(path.basename(file));

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
    // A tool that exits before reading its prompt must not crash the app (EPIPE).
    child.stdin.on('error', () => {});
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
    return { text: typeof j.response === 'string' ? j.response : '', error: err || (j.status && j.status !== 'SUCCESS' ? `Antigravity ended with status ${j.status}` : null), sessionId: j.conversation_id || j.session_id || j.sessionId || j.stats?.session_id || null };
  } catch {
    return { text: s, error: null, sessionId: null };
  }
}

// Pull the result object out of a CLI's JSON output (tolerates log lines before it).
function lastJson(stdout) {
  const s = String(stdout || '').trim();
  for (const open of ['\n{', '\n[']) {
    const i = s.lastIndexOf(open);
    if (i >= 0) { try { return JSON.parse(s.slice(i + 1)); } catch {} }
  }
  for (const ch of ['{', '[']) {
    const i = s.indexOf(ch);
    if (i >= 0) { try { return JSON.parse(s.slice(i)); } catch {} }
  }
  return null;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join('\n');
  if (v && typeof v === 'object') return textOf(v.text ?? v.content ?? v.parts ?? '');
  return '';
}

// Codex `exec --json` prints JSONL events; the first one carries the thread id.
function parseCodexEvents(stdout) {
  let threadId = null;
  let last = '';
  for (const line of String(stdout || '').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const j = JSON.parse(line);
      if (j.type === 'thread.started' && j.thread_id) threadId = String(j.thread_id);
      if (j.type === 'session.created' && j.session_id) threadId = threadId || String(j.session_id);
      if (j.type === 'item.completed' && j.item?.type === 'agent_message' && typeof j.item.text === 'string') last = j.item.text;
    } catch {}
  }
  return { threadId, text: last };
}

function parseGrok(stdout) {
  const j = lastJson(stdout);
  if (!j || Array.isArray(j)) return { text: String(stdout || '').trim(), sessionId: null, isError: false };
  return {
    text: textOf(j.result ?? j.response ?? j.text ?? j.content ?? j.message ?? ''),
    sessionId: j.session_id || j.sessionId || null,
    isError: Boolean(j.is_error || j.error),
  };
}

function parseVibe(stdout) {
  const j = lastJson(stdout);
  const msgs = Array.isArray(j) ? j : Array.isArray(j?.messages) ? j.messages : null;
  if (!msgs) return { text: String(stdout || '').trim(), sessionId: null };
  const last = [...msgs].reverse().find((m) => m && (m.role === 'assistant' || m.type === 'assistant'));
  return { text: last ? textOf(last.content ?? last.text) : '', sessionId: j?.session_id || null };
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{3,99}$/; // never starts with "-"
const uuid = () => crypto.randomUUID();

// mode: 'read'     — look, answer, plan, browse the web; no changes
//       'standard' — what the tool does in its own app when working on its own:
//                    edits, commands and web, with the tool's built-in safety checks
//       'full'     — no safety checks at all (owner opt-in only)
// ('edit' is accepted as 'standard'.) extraDirs: other folders the owner granted.
// resumeId: continue that CLI session (its own session list keeps the whole
// conversation); on success the result carries sessionId for next time.
async function runAgent({ agent, prompt, cwd, mode = 'read', model, timeoutMs, signal, bin, extraDirs = [], resumeId = null }) {
  if (mode === 'edit') mode = 'standard';
  const dirs = extraDirs.filter((d) => typeof d === 'string' && path.isAbsolute(d) && fs.existsSync(d));
  if (agent === 'ollama') return runOllama({ prompt, model, timeoutMs, signal });
  const file = bin || findBinary(agent);
  if (!file) return { ok: false, error: { kind: 'not_installed', message: `${BIN[agent] || agent} is not installed.` } };
  if (agent === 'freebuff') {
    return { ok: false, error: { kind: 'interactive', message: 'FreeBuff only runs interactively — open it in a terminal from the task.' } };
  }
  const workdir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const resume = resumeId && SAFE_ID.test(resumeId) ? resumeId : null;

  if (agent === 'anthropic') {
    const perm = { read: 'plan', standard: 'auto', full: 'bypassPermissions' }[mode];
    const sid = resume || uuid();
    const args = ['-p', '--output-format', 'json', '--permission-mode', perm, '--allowedTools', 'WebSearch', 'WebFetch'];
    const settingsFile = claudeSettingsFile();
    if (settingsFile) args.push('--settings', settingsFile);
    args.push(...(resume ? ['--resume', resume] : ['--session-id', sid]));
    if (mode === 'full') args.push('--dangerously-skip-permissions');
    for (const d of dirs) args.push('--add-dir', d);
    if (model) args.push('--model', model);
    const res = await run(file, args, { cwd: workdir, input: prompt, timeoutMs, signal });
    const parsed = parseClaude(res.out);
    const sessionId = (parsed.raw && parsed.raw.session_id) || sid;
    if (res.code === 0 && !parsed.isError && parsed.text) return { ok: true, text: parsed.text, via: 'Claude Code', sessionId };
    return { ok: false, error: classify(agent, res, parsed.text), partial: parsed.text || null, resumeFailed: Boolean(resume) };
  }

  if (agent === 'openai') {
    const outFile = path.join(os.tmpdir(), `hearth-codex-${process.pid}-${Date.now()}.txt`);
    const args = ['exec', '--json', '--skip-git-repo-check', '--color', 'never', '-C', workdir, '-o', outFile];
    if (mode === 'full') args.push('--dangerously-bypass-approvals-and-sandbox');
    else if (mode === 'standard') args.push('--approve-for-me');
    else args.push('-s', 'read-only');
    if (mode !== 'read') for (const d of dirs) args.push('--add-dir', d);
    if (model) args.push('-m', model);
    let input = prompt;
    if (resume && prompt.length < 100000) { args.push('resume', resume, prompt); input = null; } else args.push('-');
    const res = await run(file, args, { cwd: workdir, input, timeoutMs, signal });
    const ev = parseCodexEvents(res.out);
    let text = '';
    try {
      text = fs.readFileSync(outFile, 'utf8').trim();
      fs.unlinkSync(outFile);
    } catch {}
    text = text || ev.text;
    const sessionId = ev.threadId || resume || null;
    if (res.code === 0 && text) return { ok: true, text, via: 'Codex', sessionId };
    return { ok: false, error: classify(agent, res, text), partial: text || null, resumeFailed: Boolean(resume) };
  }

  if (agent === 'google' || agent === 'qwen') {
    const agy = agent === 'google' && isAntigravity(file);
    const args = agy
      ? ['-p', prompt, '--output-format', 'json', '--mode', { read: 'plan', standard: 'accept-edits', full: 'auto' }[mode]]
      : ['-p', 'Follow the instructions above.', '--output-format', 'json', '--approval-mode', { read: 'plan', standard: 'auto_edit', full: 'yolo' }[mode]];
    if (resume) args.push(agy ? '--conversation' : '--resume', resume);
    if (agy) for (const d of dirs) args.push('--add-dir', d);
    else if (dirs.length) args.push('--include-directories', dirs.join(','));
    if (agy && mode === 'full') args.push('--sandbox');
    if (model) args.push(agy ? '--model' : '-m', model);
    const res = await run(file, args, { cwd: workdir, input: agy ? undefined : prompt, timeoutMs, signal });
    const parsed = parseGemini(res.out);
    const via = agent === 'google' ? (agy ? 'Antigravity CLI' : 'Gemini CLI') : 'Qwen Code';
    if (res.code === 0 && !parsed.error && parsed.text) return { ok: true, text: parsed.text, via, sessionId: parsed.sessionId || resume || null };
    return { ok: false, error: classify(agent, res, `${parsed.error || ''}\n${parsed.text}`), partial: parsed.text || null, resumeFailed: Boolean(resume) };
  }

  if (agent === 'xai') {
    // Grok's headless mode has no "safe auto" level: it either asks (denied when
    // nobody can answer) or auto-approves. Read mode leaves approvals on.
    const sid = resume || uuid();
    const args = ['-p', prompt, '--output-format', 'json'];
    args.push(...(resume ? ['--resume', resume] : ['--session-id', sid]));
    if (mode !== 'read') args.push('--always-approve');
    if (model) args.push('-m', model);
    const res = await run(file, args, { cwd: workdir, timeoutMs, signal });
    const parsed = parseGrok(res.out);
    if (res.code === 0 && !parsed.isError && parsed.text) return { ok: true, text: parsed.text, via: 'Grok Build', sessionId: parsed.sessionId || sid };
    return { ok: false, error: classify(agent, res, parsed.text), partial: parsed.text || null, resumeFailed: Boolean(resume) };
  }

  if (agent === 'mistral') {
    // `vibe -p` with no text reads the prompt from stdin. Standard = Vibe's
    // default accept-edits agent (commands needing approval are denied).
    const args = ['-p', '--output', 'json'];
    if (resume) args.push('--resume', resume);
    if (mode === 'full') args.push('--auto-approve');
    const res = await run(file, args, { cwd: workdir, input: prompt, timeoutMs, signal });
    const parsed = parseVibe(res.out);
    if (res.code === 0 && parsed.text) return { ok: true, text: parsed.text, via: 'Mistral Vibe', sessionId: parsed.sessionId || resume || null };
    return { ok: false, error: classify(agent, res, parsed.text), partial: parsed.text || null, resumeFailed: Boolean(resume) };
  }
  return { ok: false, error: { kind: 'unsupported', message: 'Unknown agent.' } };
}

function geminiSignedIn() {
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_CLOUD_PROJECT) return true;
  const dir = path.join(os.homedir(), '.gemini');
  if (fs.existsSync(path.join(dir, 'oauth_creds.json'))) return true;
  try {
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    if (st?.security?.auth?.selectedType || st?.selectedAuthType) return true;
  } catch {}
  return false;
}

function fileHas(f, needle) {
  try { return fs.readFileSync(f, 'utf8').includes(needle); } catch { return false; }
}
function grokHome() {
  const h = process.env.GROK_HOME;
  return h && path.isAbsolute(h) ? h : path.join(os.homedir(), '.grok');
}
function grokSignedIn() {
  return Boolean(process.env.XAI_API_KEY) || fs.existsSync(path.join(grokHome(), 'auth.json'));
}
function qwenSignedIn() {
  const dir = path.join(os.homedir(), '.qwen');
  return fs.existsSync(path.join(dir, 'oauth_creds.json')) || fileHas(path.join(dir, '.env'), 'OPENAI_API_KEY');
}

// Status plus, while not installed, how the last one-click install went.
async function status(agent, bin) {
  const s = await toolStatus(agent, bin);
  if (!s.installed) {
    const run = installer.readRun(agent);
    if (run && run !== 'ok') s.install = run;
  }
  return s;
}

async function toolStatus(agent, bin) {
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
  if (agent === 'google') {
    if (!isAntigravity(file)) return { installed: true, signedIn: geminiSignedIn(), path: file };
    // /usage is handled by the CLI, without asking a model to run tools.
    const r = await run(file, ['-p', '/usage', '--output-format', 'json'], { timeoutMs: 15000 });
    const parsed = parseGemini(r.out);
    const auth = /authentication required|not signed in|not logged in|unauthori[sz]ed|sign.?in|not eligible/i.test(`${r.err} ${parsed.error || ''}`);
    return { installed: true, signedIn: auth ? false : r.code === 0 && !parsed.error ? true : null, path: file };
  }
  if (agent === 'xai') return { installed: true, signedIn: grokSignedIn(), path: file };
  if (agent === 'qwen') return { installed: true, signedIn: qwenSignedIn(), path: file };
  // Vibe keeps a browser sign-in in the OS keyring, which can't be checked
  // without reading it; null = installed, sign-in state unknown.
  if (agent === 'mistral') return { installed: true, signedIn: process.env.MISTRAL_API_KEY || fileHas(path.join(os.homedir(), '.vibe', '.env'), 'MISTRAL_API_KEY') ? true : null, path: file };
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
  // Gemini, Qwen and FreeBuff sign in inside their own first session, so no hold wrapper.
  return openTerminal(file, LOGIN[agent] || [], cwd, { hold: LOGIN_HOLD.includes(agent) || agent === 'mistral' });
}

// Sign out using each tool's own sign-out. The Command Center never holds the
// login itself, so disconnecting means asking the official tool to forget it.
async function logout(agent, bin) {
  const file = bin || findBinary(agent);
  if (agent === 'anthropic' || agent === 'openai' || agent === 'xai') {
    if (!file) return { ok: false, message: `${BIN[agent]} is not installed.` };
    const r = await run(file, agent === 'anthropic' ? ['auth', 'logout'] : ['logout'], { timeoutMs: 20000 });
    return r.code === 0 ? { ok: true } : { ok: false, message: (r.err || r.out || `exit ${r.code}`).trim().split('\n').slice(-1)[0] };
  }
  if (agent === 'google') {
    if (file && isAntigravity(file)) return { ok: false, message: 'Open Antigravity with Sign in and use /logout to sign out of its shared account session.' };
    // Gemini CLI has no sign-out command; its cached Google sign-in lives in
    // ~/.gemini/oauth_creds.json. Removing that file is how it signs out.
    const f = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
    if (!fs.existsSync(f)) return { ok: true, message: 'Gemini was not signed in with Google on this computer.' };
    fs.unlinkSync(f);
    return { ok: true };
  }
  if (agent === 'qwen') {
    const f = path.join(os.homedir(), '.qwen', 'oauth_creds.json');
    if (!fs.existsSync(f)) return { ok: true, message: 'Qwen was not signed in with Qwen OAuth on this computer.' };
    fs.unlinkSync(f);
    return { ok: true };
  }
  return { ok: false, message: 'This one signs out inside its own app.' };
}

// One-click install of the official tools (one agent or a list, one after
// another) in a terminal you can see. Node.js and uv are set up in your own
// folders when missing; see installer.cjs. Passwords never pass through here.
async function install(list, { fetchImpl } = {}) {
  const want = (Array.isArray(list) ? list : [list]).filter((a) => installer.canInstall(a));
  if (!want.length) return { ok: false, message: 'No installer for this agent.' };
  const versionOf = async (node) => (await run(node, ['--version'], { timeoutMs: 8000 })).out;
  const plan = await installer.prepare({ agents: want, dirs: searchDirs(), versionOf, fetchImpl });
  if (!plan.ok) return plan;
  let script;
  try {
    script = installer.writeScript();
    installer.markQueued(plan.agents);
  } catch (e) {
    return { ok: false, message: `Could not prepare the installer in ${installer.appDir()}: ${e.message}` };
  }
  const r = openTerminal('/bin/sh', [script, ...plan.args], os.homedir());
  return r.ok ? { ...r, agents: plan.agents, plan: plan.plan } : r;
}

module.exports = { runAgent, status, login, logout, install, openTerminal, findBinary, isAntigravity, isLimit, resetHint, parseClaude, parseGemini, parseCodexEvents, parseGrok, parseVibe, lastJson, run, searchDirs, BIN, CLI_AGENTS, NPM_PACKAGE, execFile };

// The app runs the project's tests itself after an AI reports done: in the task's
// worktree, at the reported commit, time-limited, output captured, cancellable, with
// a clean environment (no tokens, a throwaway HOME so CLI sign-ins aren't reachable).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// null = automatic: `npm test` when the BASE branch's package.json (origin/main, not the
// task's own copy, which the AI controls) has a real test script; '' = none.
function resolveTestCommand(setting, dir, basePkgText = null) {
  if (typeof setting === 'string') return setting.trim() || null;
  try {
    const pkg = JSON.parse(basePkgText !== null ? basePkgText : fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const t = pkg?.scripts?.test;
    if (typeof t === 'string' && t.trim() && !/no test specified/i.test(t)) return 'npm test';
  } catch {}
  return null;
}

const KEEP = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'USER', 'LOGNAME', 'SHELL'];
// Nothing secret passes: only the basics, plus CI-style switches.
function cleanEnv(env = process.env, home) {
  const out = {};
  for (const k of KEEP) if (typeof env[k] === 'string') out[k] = env[k];
  return {
    ...out,
    HOME: home,
    TMPDIR: home,
    CI: '1',
    NO_COLOR: '1',
    TERM: 'dumb',
    GIT_TERMINAL_PROMPT: '0',
    GH_PROMPT_DISABLED: '1',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  };
}

// Keep the end of the output (that's where test summaries are).
function tail(text, max = 64000) {
  const s = String(text || '');
  return s.length > max ? `…[earlier output trimmed]\n${s.slice(-max)}` : s;
}

// A task that changes how tests run is flagged on its card ("tests changed by this task").
const TEST_CONFIG = /(^|\/)(jest|vitest|playwright|cypress|karma|ava|mocha)\.config\.[cm]?[jt]s$|(^|\/)\.mocharc|(^|\/)\.nycrc|(^|\/)(pytest\.ini|tox\.ini|setup\.cfg|conftest\.py|noxfile\.py)$|(^|\/)\.github\/workflows\/|(^|\/)Makefile$/;
function testConfigChanges(files = [], basePkgText = '', headPkgText = '') {
  const out = files.filter((f) => TEST_CONFIG.test(f));
  if (files.includes('package.json')) {
    const scripts = (t) => { try { const s = JSON.parse(t).scripts || {}; return JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => /^(pre|post)?test/.test(k)))); } catch { return null; } };
    if (scripts(basePkgText) !== scripts(headPkgText)) out.push('package.json (test scripts)');
  }
  return out;
}
// Keep the output tail, but nothing token-like goes back to an AI or the screen.
function redactTokens(text) {
  return String(text || '')
    .replace(/\b((?:api[_-]?key|token|secret|password|passwd|auth|bearer|access[_-]?key)[\w-]*)(\s*[:=]\s*|\s+)["']?[^\s"']{6,}/gi, '$1$2[REDACTED]')
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '[REDACTED]');
}
const needsDeps = (command, dir) => /^(npm|npx|yarn|pnpm)\b/.test(command) && !fs.existsSync(path.join(dir, 'node_modules')) && !/\b(npm (ci|install|i)|yarn install|pnpm install)\b/.test(command);

function verdict({ code, timedOut, cancelled, spawnError }) {
  if (cancelled) return 'not run';
  if (spawnError) return 'not run';
  if (timedOut) return 'failed';
  return code === 0 ? 'passed' : 'failed';
}

function runTests({ command, cwd, timeoutMs = 15 * 60000, signal, env = process.env }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let home;
    try { home = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-tests-')); } catch { home = os.tmpdir(); }
    let log = '';
    let done = false;
    const add = (d) => { log = tail(log + d, 200000); };
    const child = spawn('/bin/sh', ['-c', command], { cwd, env: cleanEnv(env, home), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const kill = (sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch {} } };
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
      const status = verdict(r);
      const note = r.cancelled ? 'Cancelled by you.' : r.timedOut ? `Timed out after ${Math.round(timeoutMs / 60000)} min.` : r.spawnError ? `Could not start: ${r.err}` : '';
      resolve({ status, code: r.code ?? null, ms: Date.now() - started, command, log: tail(`${note ? `${note}\n` : ''}${log}`), timedOut: Boolean(r.timedOut), cancelled: Boolean(r.cancelled) });
    };
    const timer = setTimeout(() => { kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 3000); finish({ code: null, timedOut: true }); }, timeoutMs);
    if (signal) {
      if (signal.aborted) { kill('SIGTERM'); finish({ code: null, cancelled: true }); }
      signal.addEventListener('abort', () => { kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 3000); finish({ code: null, cancelled: true }); });
    }
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    child.on('error', (e) => finish({ code: null, spawnError: true, err: e.message }));
    child.on('close', (code) => finish({ code }));
  });
}

module.exports = { resolveTestCommand, testConfigChanges, redactTokens, needsDeps, cleanEnv, runTests, tail, verdict };

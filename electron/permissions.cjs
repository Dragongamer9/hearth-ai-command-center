// What each AI may do in a chat, passed through each CLI's own documented mechanism.
// Never a bypass-all mode for Gemini or Mistral (no --dangerously-skip-permissions, no
// yolo, no --auto-approve): they get narrow access only — reading files, the web, and the
// owner's quick checks (plus read-only commands like ls and git status).
//
// How each one is told (checked against each tool's own docs or source, Nov 2026):
// - Gemini CLI: a policy file for this run only (`--policy <file>`, TOML [[rule]] entries
//   with toolName / commandPrefix / decision / priority; "ask_user" is denied headless).
//   Source: gemini-cli docs/reference/policy-engine.md and packages/cli/src/config/config.ts.
// - Antigravity CLI (agy): rules live ONLY in ~/.gemini/antigravity-cli/settings.json
//   ("permissions": { "allow", "deny", "ask" }, entries like command(git status),
//   read_url(*), read_file(/path)). agy documents no per-run flag for rules, so the app
//   never writes that file by itself: Settings › Permissions has a button the owner presses
//   ("Set up Gemini's allow-list"), which adds only the missing rules, keeps everything else,
//   writes atomically with a .bak, and refuses a file it can't read. Source:
//   antigravity.google/docs/permissions?tab=cli.
// - Mistral Vibe: an agent profile the app owns, $VIBE_HOME/agents/hearth-read.toml or
//   hearth-build.toml, chosen with `--agent` (custom agents are documented in `vibe --help`;
//   tools.<name>.permission = always|ask|never and tools.bash.allowlist / denylist are in
//   the configuration reference). It never touches the owner's own config.toml.
//   Source: docs.mistral.ai/vibe/code/cli/configuration-reference and mistral-vibe
//   vibe/cli-rust/src/cli.rs, vibe/core/agents/models.py.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWrite } = require('./jsonfile.cjs');

// Read-only commands every narrow AI may run (also with Run & build off).
const READ_ONLY = ['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'pwd', 'git status', 'git diff', 'git log', 'git show', 'git grep', 'git ls-files', 'git rev-parse', 'git branch --show-current'];
// Never by itself, whatever the lists say (the owner's rules).
const NEVER = ['git push', 'git tag', 'git merge', 'git rebase', 'git reset --hard', 'gh pr merge', 'gh release', 'sudo', 'rm -rf'];
// Only for the Test Team button: the file it makes is removed again.
const TEST_EXTRA = ['rm hearth-check.js'];
const CMD_RE = /^[A-Za-z0-9][A-Za-z0-9 ._/:=+-]{0,79}$/;
const cleanCmds = (list) => [...new Set((list || []).map((c) => String(c || '').trim().replace(/\s+/g, ' ')).filter((c) => CMD_RE.test(c) && !/[;&|`$<>"'\\]/.test(c)))];

// The commands one run may use. build: Run & build is on (quick checks too).
function allowedCommands({ quickChecks = [], build = false, test = false } = {}) {
  return cleanCmds([...READ_ONLY, ...(build ? quickChecks : []), ...(test ? TEST_EXTRA : [])]);
}

const tomlStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const tomlList = (a) => `[${a.map(tomlStr).join(', ')}]`;

// ---- Gemini CLI: one policy file per run ----
function geminiPolicy({ quickChecks = [], build = false, web = true, test = false } = {}) {
  const read = ['read_file', 'read_many_files', 'glob', 'grep_search', 'list_directory'];
  const webTools = ['google_web_search', 'web_fetch'];
  const rules = [
    '# Written by Hearth AI Command Center for one run only (gemini --policy). Narrow access.',
    '[[rule]]', `toolName = ${tomlList(read)}`, 'decision = "allow"', 'priority = 100', '',
    '[[rule]]', `toolName = ${tomlList(webTools)}`, `decision = "${web ? 'allow' : 'deny'}"`, 'priority = 100', '',
    '[[rule]]', 'toolName = "run_shell_command"', `commandPrefix = ${tomlList(allowedCommands({ quickChecks, build, test }))}`, 'decision = "allow"', 'priority = 100', '',
    '[[rule]]', 'toolName = "run_shell_command"', `commandPrefix = ${tomlList(NEVER)}`, 'decision = "deny"', 'priority = 900', '',
  ];
  return rules.join('\n');
}
function writeGeminiPolicy(dir, opts) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `gemini-policy-${process.pid}-${crypto.randomBytes(4).toString('hex')}.toml`);
  fs.writeFileSync(file, geminiPolicy(opts), { mode: 0o600 });
  return file;
}

// ---- Mistral Vibe: the app's own agent profiles ----
const VIBE_AGENTS = { read: 'hearth-read', build: 'hearth-build', test: 'hearth-test' };
function vibeHome(env = process.env) {
  const h = env.VIBE_HOME;
  return h && path.isAbsolute(h) ? h : path.join(os.homedir(), '.vibe');
}
function vibeProfile({ quickChecks = [], build = false, web = true, test = false } = {}) {
  const edits = build || test ? 'always' : 'never';
  return [
    '# Written by Hearth AI Command Center (used only when the app runs vibe --agent with this name).',
    '# Narrow access: read files, search the web, the owner\'s quick checks. Your config.toml is untouched.',
    `display_name = ${tomlStr(`Hearth team (${test ? 'test' : build ? 'build' : 'read'})`)}`,
    'description = "Hearth AI Command Center chats: read, web, quick checks only"',
    'safety = "safe"',
    '',
    '[tools.read_file]', 'permission = "always"', '',
    '[tools.grep]', 'permission = "always"', '',
    '[tools.web_search]', `permission = "${web ? 'always' : 'never'}"`, '',
    '[tools.web_fetch]', `permission = "${web ? 'always' : 'never'}"`, '',
    '[tools.write_file]', `permission = "${edits}"`, '',
    '[tools.edit]', `permission = "${edits}"`, '',
    '[tools.bash]', 'permission = "ask"',
    `allowlist = ${tomlList(allowedCommands({ quickChecks, build, test }))}`,
    `denylist = ${tomlList([...NEVER, 'gdb', 'pdb', 'passwd', 'vim', 'vi', 'nano', 'emacs'])}`,
    '',
  ].join('\n');
}
// Written before each run (only when the text changed). Returns the agent name to pass.
function ensureVibeAgent(opts = {}, { home = vibeHome() } = {}) {
  const kind = opts.test ? 'test' : opts.build ? 'build' : 'read';
  const name = `${VIBE_AGENTS[kind]}${opts.web === false ? '-noweb' : ''}`;
  const dir = path.join(home, 'agents');
  const file = path.join(dir, `${name}.toml`);
  const text = vibeProfile(opts);
  let cur = null;
  try { cur = fs.readFileSync(file, 'utf8'); } catch {}
  if (cur !== text) atomicWrite(file, text);
  return name;
}

// ---- Antigravity CLI (agy): rules the owner adds with one click ----
const agySettingsFile = (home = os.homedir()) => path.join(home, '.gemini', 'antigravity-cli', 'settings.json');
function agyRules({ quickChecks = [], readDirs = [], protect = [] } = {}) {
  const cmds = allowedCommands({ quickChecks, build: true, test: true });
  return {
    allow: [...cmds.map((c) => `command(${c})`), 'read_url(*)', ...readDirs.filter((d) => path.isAbsolute(d)).map((d) => `read_file(${d})`)],
    // Asked (= refused in headless runs, asked when he uses agy himself), never auto-run.
    ask: NEVER.map((c) => `command(${c})`),
    // The app's own settings can never be written by agy.
    deny: protect.filter((f) => path.isAbsolute(f)).map((f) => `write_file(${f})`),
  };
}
function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { ok: true, json: {}, missing: true }; return { ok: false, message: `${file} could not be read (${e.code || e.message}).` }; }
  try { const j = JSON.parse(text); if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('x'); return { ok: true, json: j, text }; } catch { return { ok: false, message: `${file} isn't valid JSON, so the app left it alone. Fix it in agy first.` }; }
}
// What the allow-list looks like now: 'set' (every rule there), 'partly', 'none', or an error.
function agyState(rules, file = agySettingsFile()) {
  const r = readJson(file);
  if (!r.ok) return { state: 'error', message: r.message, file };
  const p = r.json.permissions || {};
  const have = (k) => (Array.isArray(p[k]) ? p[k] : []);
  const want = [...rules.allow.map((x) => ['allow', x]), ...rules.ask.map((x) => ['ask', x]), ...rules.deny.map((x) => ['deny', x])];
  const missing = want.filter(([k, x]) => !have(k).includes(x));
  // A broad rule of his own (command(*) in allow, or always-proceed) is shown, never changed.
  const broad = have('allow').includes('command(*)') || r.json.toolPermission === 'always-proceed';
  return { state: !missing.length ? 'set' : missing.length === want.length ? 'none' : 'partly', missing: missing.length, total: want.length, broad, file };
}
// Owner's click only. Adds the missing rules; keeps every other key and rule; .bak; atomic.
function agySetup(rules, file = agySettingsFile()) {
  const r = readJson(file);
  if (!r.ok) return { ok: false, message: r.message };
  const j = r.json;
  const p = j.permissions && typeof j.permissions === 'object' && !Array.isArray(j.permissions) ? { ...j.permissions } : {};
  const added = [];
  for (const k of ['allow', 'ask', 'deny']) {
    const cur = Array.isArray(p[k]) ? [...p[k]] : [];
    for (const x of rules[k]) if (!cur.includes(x)) { cur.push(x); added.push(`${k}: ${x}`); }
    p[k] = cur;
  }
  if (!added.length) return { ok: true, added: [], message: 'Gemini\'s allow-list was already set up.' };
  if (!r.missing) fs.copyFileSync(file, `${file}.bak`);
  atomicWrite(file, `${JSON.stringify({ ...j, permissions: p }, null, 2)}\n`);
  return { ok: true, added, file, message: `Added ${added.length} rule${added.length > 1 ? 's' : ''} to agy's settings (${file}); the old file is kept as settings.json.bak.` };
}

// ---- quick-check tools on this PC ----
// The tool a quick check needs: "python3 -m pytest" -> python module pytest; else the first word.
function toolOf(check) {
  const w = String(check || '').trim().split(/\s+/);
  if (/^python3?$/.test(w[0]) && w[1] === '-m' && /^[A-Za-z_][\w.]{0,60}$/.test(w[2] || '')) return { bin: w[0], module: w[2] };
  return { bin: w[0] };
}
function findIn(dirs, bin) {
  if (!/^[A-Za-z0-9._+-]{1,60}$/.test(bin)) return null;
  for (const d of dirs) { const p = path.join(d, bin); try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {} }
  return null;
}
// run(file, args) -> { code } ; used only for "does this python module exist".
async function missingTools(quickChecks, { dirs, run }) {
  const out = [];
  for (const check of cleanCmds(quickChecks)) {
    const t = toolOf(check);
    const bin = findIn(dirs, t.bin);
    let missing = !bin;
    let what = t.bin;
    if (bin && t.module) {
      what = `${t.bin} -m ${t.module}`;
      const r = await run(bin, ['-c', `import importlib.util,sys; sys.exit(0 if importlib.util.find_spec(${JSON.stringify(t.module)}) else 3)`]);
      missing = r.code !== 0;
    }
    out.push({ check, tool: t.module || t.bin, what, missing, path: bin });
  }
  return out;
}

module.exports = { READ_ONLY, NEVER, TEST_EXTRA, allowedCommands, cleanCmds, geminiPolicy, writeGeminiPolicy, vibeProfile, ensureVibeAgent, vibeHome, VIBE_AGENTS, agySettingsFile, agyRules, agyState, agySetup, toolOf, missingTools };

// Settings › Permissions and Settings › AI team › Test team (registered from main.cjs).
// - perms:table   what each AI can really do, worked out from the CLI on this PC (found or
//                 not, its version), the connection (CLI or API key) and the flags the app
//                 passes (electron/agents.cjs), not only from what's saved.
// - perms:agy     Gemini's (agy) allow-list: shown, and added only on the owner's click.
// - tools:missing quick checks whose tool isn't installed on this PC (they go to Actions).
// - team:test     the same safe test for every connected teammate, in a temporary scratch
//                 folder: read a file, search the web, node --check a file it makes, delete
//                 that file. No repo (so nothing can be pushed), no pictures, and settings are
//                 checked afterwards (an AI's change would be undone and logged).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const perms = require('./permissions.cjs');

const CLI = ['anthropic', 'openai', 'google', 'xai', 'mistral', 'qwen'];
const NAME = { anthropic: 'Claude', openai: 'ChatGPT', google: 'Gemini', xai: 'Grok', mistral: 'Mistral', qwen: 'Qwen', perplexity: 'Perplexity', deepseek: 'DeepSeek', ollama: 'Local AI', venice: 'Venice', civitai: 'Civitai', gpu: 'Your GPU server' };
const PUSH_CHAT = 'Only the chat\'s own hearth/ branch, and only in a chat with a repo (main, the base branch and tags are refused)';

// One row per AI. cli: { installed, path, version, tool }, api: connected by key/URL,
// agy: the allow-list state, s: settings (access, quickChecks).
function capabilities({ id, method = 'cli', cli = {}, apiReady = false, agy = null, access = 'standard' }) {
  const row = { id, name: NAME[id] || id, connection: method === 'api' ? 'API' : id === 'ollama' ? 'On this PC' : 'CLI', ready: false, tool: '', files: 'No', commands: 'No', web: 'No', images: 'No', push: 'No', notes: [] };
  if (id === 'ollama') return { ...row, ready: Boolean(cli.installed), tool: cli.installed ? 'Ollama' : 'Ollama not running', files: 'No (text only)', notes: ['Answers from your local model; no tools.'] };
  if (method === 'api') {
    row.ready = Boolean(apiReady);
    row.tool = apiReady ? 'API key or address saved' : 'needs a key';
    row.files = 'No (text only)';
    if (id === 'perplexity') row.web = 'Yes: Sonar searches the web itself';
    if (['venice', 'gpu'].includes(id)) row.images = 'Makes pictures';
    if (id === 'civitai') { row.images = 'Makes pictures only'; row.files = 'No'; }
    return row;
  }
  row.ready = Boolean(cli.installed);
  row.tool = cli.installed ? `${cli.tool || id}${cli.version ? ` ${cli.version}` : ''}` : 'CLI not installed';
  if (!cli.installed) return { ...row, notes: ['Install it in Settings › Accounts.'] };
  const full = access === 'full';
  row.push = PUSH_CHAT;
  if (id === 'anthropic') {
    Object.assign(row, { files: 'Reads and edits files in the chat\'s folder', commands: full ? 'With Run & build: any command (your Full access is on)' : 'With Run & build: git and your quick checks only (Claude Code enforces the list)', web: 'Yes, when Web is on', images: 'Looks at pictures' });
  } else if (id === 'openai') {
    Object.assign(row, { files: 'Reads; edits with Run & build', commands: full ? 'With Run & build: any command, no checks (your Full access is on)' : 'With Run & build: Codex\'s own auto-review (--approve-for-me); otherwise its read-only sandbox', web: 'Yes, when Web is on', images: 'Looks at pictures (--image)' });
  } else if (id === 'google' && cli.tool === 'agy') {
    const set = agy?.state === 'set';
    Object.assign(row, { files: 'Reads its folder; edits with Run & build', commands: set ? 'Read-only commands and your quick checks (agy\'s allow-list)' : agy?.state === 'partly' ? 'Only part of the allow-list is set up: press Set up again' : 'None yet: refused until you set up Gemini\'s allow-list', web: set ? 'Reads web pages (read_url); searching is agy\'s own' : 'Pages are refused until the allow-list is set up', images: 'Looks at pictures (@path)' });
    if (agy?.broad) row.notes.push('Your agy settings also have a broad rule of your own (command(*) or always-proceed); the app leaves it as it is.');
    row.notes.push('Never runs with --dangerously-skip-permissions, also with Full access.');
  } else if (id === 'google') {
    Object.assign(row, { files: 'Reads its folder; edits with Run & build', commands: 'Read-only commands, and your quick checks with Run & build (a policy file for each run)', web: 'Google search and pages, when Web is on', images: 'Looks at pictures (@path)', notes: ['Never runs in yolo mode, also with Full access.'] });
  } else if (id === 'xai') {
    Object.assign(row, { files: 'Reads; edits with Run & build', commands: 'With Run & build: any command (Grok Build has only --always-approve, no narrower headless mode); otherwise none', web: 'Grok\'s own tools (the app can\'t check them)', images: 'Can\'t view pictures here' });
  } else if (id === 'mistral') {
    Object.assign(row, { files: 'Reads its folder and the folders you granted; edits with Run & build', commands: 'Read-only commands, and your quick checks with Run & build (the app\'s hearth-build agent profile)', web: 'Web search only when Vibe finds a Mistral API key (from vibe --setup or MISTRAL_API_KEY); the app can\'t check the keyring', images: 'Can\'t view pictures here', notes: ['Never runs with --auto-approve, also with Full access.'] });
  } else if (id === 'qwen') {
    Object.assign(row, { files: 'Reads; edits with Run & build', commands: full ? 'With Run & build: any command (yolo, your Full access is on)' : 'Edits only; commands are asked, so refused', web: 'Qwen Code\'s own tools', images: 'Looks at pictures (@path)' });
  }
  return row;
}

// The test every teammate gets. File names are fixed so the allow-lists can name them.
const TEST_PROMPT = (token) => [
  'This is the Hearth AI Command Center team test. Do exactly these four steps in your current folder, then report.',
  '1. Read the file probe.txt and quote the token written in it.',
  '2. Search the web for "Hearth OS gamepad shell" and give the https link of one result.',
  '3. Create a file hearth-check.js containing exactly: console.log("hearth");  then run: node --check hearth-check.js',
  '4. Delete hearth-check.js (run: rm hearth-check.js).',
  'Do nothing else: no git, no pushing, no pictures, no other files, no settings.',
  'Then answer with exactly four lines, one per step: "STEP <n>: PASS <what you saw>" or "STEP <n>: FAIL <the exact error you got>".',
  `(The token starts with ${token.slice(0, 2)}.)`,
].join('\n');

function parseSteps(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/STEP\s*([1-4])\s*[:.-]\s*(PASS|FAIL)\b[:\s-]*([^\n]*)/gi)) out[m[1]] = { pass: m[2].toUpperCase() === 'PASS', detail: m[3].trim().slice(0, 400) };
  return out;
}

// What the app checked itself (verified) and what the AI reported.
function judge({ r, token, dir }) {
  const names = ['Read a file', 'Search the web', 'node --check on its own file', 'Delete that file'];
  if (!r.ok) {
    const err = String(r.error?.message || 'The run failed.').slice(0, 600);
    return names.map((label) => ({ label, pass: false, detail: err, kind: r.error?.kind || 'failed' }));
  }
  const said = parseSteps(r.text);
  const text = String(r.text || '');
  const fileGone = !fs.existsSync(path.join(dir, 'hearth-check.js'));
  const strays = (() => { try { return fs.readdirSync(dir).filter((f) => !['probe.txt', '.hearth-ai', '.vibe', '.gemini'].includes(f)); } catch { return []; } })();
  const step = (n, pass, detail, verified) => ({ label: names[n - 1], pass, detail: detail || said[n]?.detail || (pass ? '' : 'No answer for this step.'), verified });
  return [
    step(1, text.includes(token), text.includes(token) ? 'Quoted the right token (checked by the app)' : (said[1]?.detail || 'The token from probe.txt wasn\'t in the answer'), true),
    step(2, Boolean(said[2]?.pass && /https:\/\/\S+/.test(said[2]?.detail || text)), said[2]?.pass && !/https:\/\/\S+/.test(said[2]?.detail || text) ? 'Said it searched, but gave no link' : null, false),
    step(3, Boolean(said[3]?.pass), null, false),
    step(4, Boolean(said[4]?.pass) && fileGone, !fileGone ? 'hearth-check.js is still there (checked by the app)' : said[4]?.pass ? 'The file is gone (checked by the app)' : null, true),
  ].concat(strays.length ? [{ label: 'Left nothing else behind', pass: false, detail: `Extra files: ${strays.slice(0, 5).join(', ')}`, verified: true }] : []);
}

function register(d) {
  const { handle, agents, readSettings, dataDir, guardSettings, logChange, protectFiles } = d;
  const versions = new Map();
  async function cliInfo(id, s) {
    const file = agents.findBinary(id, s.bins[id]);
    if (!file) return { installed: false };
    const tool = id === 'google' ? (agents.isAgy(file) ? 'agy' : 'gemini') : path.basename(file);
    const key = `${file}`;
    if (!versions.has(key)) {
      const r = await agents.run(file, ['--version'], { timeoutMs: 8000 });
      const v = String(r.out || r.err || '').match(/\d+\.\d+(\.\d+)?([-.+][\w.]+)?/);
      versions.set(key, r.code === 0 && v ? v[0] : '');
    }
    return { installed: true, path: file, tool, version: versions.get(key) };
  }
  const agyRulesNow = () => {
    const s = readSettings();
    return perms.agyRules({ quickChecks: s.tools.quickChecks, readDirs: [path.join(dataDir(), 'chats'), path.join(dataDir(), 'copies'), path.join(dataDir(), 'workspaces', '.attachments'), ...s.extraDirs], protect: protectFiles() });
  };
  handle('perms:table', async (ids, apiReady = {}) => {
    const s = readSettings();
    const list = (Array.isArray(ids) ? ids : []).filter((a) => typeof a === 'string' && NAME[a]).slice(0, 16);
    const rows = [];
    let agy = null;
    for (const id of list) {
      const method = d.methodOf(id);
      const cli = CLI.includes(id) && method !== 'api' ? await cliInfo(id, s) : id === 'ollama' ? { installed: Boolean(apiReady.ollama) } : {};
      if (id === 'google' && cli.tool === 'agy') agy = perms.agyState(agyRulesNow());
      rows.push(capabilities({ id, method, cli, apiReady: Boolean(apiReady[id]), agy: id === 'google' ? agy : null, access: s.access }));
    }
    return { rows, agy, access: s.access };
  });
  handle('perms:agy', () => ({ ...perms.agyState(agyRulesNow()), rules: agyRulesNow() }));
  // Only from the owner's button: adds the missing rules to agy's own settings file.
  handle('perms:agySetup', () => {
    const r = perms.agySetup(agyRulesNow());
    if (r.ok && r.added.length) logChange([{ key: 'agy settings.json (Gemini\'s allow-list)', path: ['agy'], from: 'without the Hearth rules', to: `${r.added.length} rules added` }], 'you, with the Set up button');
    return r;
  });
  handle('tools:missing', async () => perms.missingTools(readSettings().tools.quickChecks, { dirs: agents.searchDirs(), run: (f, a) => agents.run(f, a, { timeoutMs: 8000 }) }));

  let testing = false;
  handle('team:test', async (ids) => {
    if (testing) return { ok: false, message: 'A team test is already running.' };
    testing = true;
    const s = readSettings();
    const list = (Array.isArray(ids) ? ids : []).filter((a) => CLI.includes(a) && d.methodOf(a) !== 'api').slice(0, 8);
    try {
      const results = await Promise.all(list.map(async (agent) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-teamtest-'));
        const token = crypto.randomBytes(6).toString('hex');
        fs.writeFileSync(path.join(dir, 'probe.txt'), `Hearth team test token: ${token}\n`, { mode: 0o600 });
        const started = Date.now();
        try {
          const r = await agents.runAgent({
            agent, prompt: TEST_PROMPT(token), cwd: dir, mode: 'standard', web: true, test: true, runDir: dir,
            quickChecks: ['node --check'], timeoutMs: 6 * 60000, bin: s.bins[agent],
            // Claude Code: edits plus exactly these commands (never bypass, also with Full access).
            claude: agent === 'anthropic' ? { perm: 'acceptEdits', allowedTools: ['Bash(node --check:*)', 'Bash(rm hearth-check.js)', 'Bash(cat:*)', 'Bash(ls:*)'], web: true } : null,
          });
          return { agent, ok: r.ok, via: r.via || null, ms: Date.now() - started, error: r.ok ? null : r.error, steps: judge({ r, token, dir }), answer: String(r.text || r.partial || '').slice(0, 2000) };
        } catch (e) {
          return { agent, ok: false, ms: Date.now() - started, error: { kind: 'failed', message: String(e.message || e) }, steps: judge({ r: { ok: false, error: { message: String(e.message || e) } }, token, dir }) };
        } finally {
          try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
        }
      }));
      const undone = guardSettings('A teammate in the team test');
      return { ok: true, results, settingsUndone: undone };
    } finally { testing = false; }
  });
  return { capabilities };
}

module.exports = { register, capabilities, parseSteps, judge, TEST_PROMPT, CLI };

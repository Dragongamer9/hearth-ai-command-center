// 2.x chat IPC (electron/v2.cjs) against local "GitHub" repos: runs happen in the chat's own
// shallow copy, steps stream, work is committed as the owner and pushed to the chat's branch;
// merging always asks; a copy from another repo is never used; unpushed work is never
// deleted without the owner's own yes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const v2 = require('../electron/v2.cjs');
const { createChats } = require('../electron/chats.cjs');
const attachments = require('../electron/attachments.cjs');
const { validateProvider, validatePrompt, validateModel } = require('../electron/validate.cjs');

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Dragongamer9', GIT_AUTHOR_EMAIL: 'Dragongamer9@users.noreply.github.com', GIT_COMMITTER_NAME: 'Dragongamer9', GIT_COMMITTER_EMAIL: 'Dragongamer9@users.noreply.github.com' };
const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function setup({ settings = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-v2ipc-'));
  const remotes = {};
  for (const name of ['Dragongamer9/alpha', 'Dragongamer9/beta']) {
    const bare = path.join(tmp, 'gh', `${name}.git`);
    fs.mkdirSync(bare, { recursive: true });
    g(bare, 'init', '-q', '--bare', '-b', 'main');
    const seed = path.join(tmp, 'seed', name);
    fs.mkdirSync(seed, { recursive: true });
    g(seed, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(seed, 'f.txt'), 'one\n');
    g(seed, 'add', '.');
    g(seed, 'commit', '-q', '-m', 'start');
    g(seed, 'push', '-q', bare, 'main');
    remotes[name] = bare;
  }
  const data = path.join(tmp, 'data');
  fs.mkdirSync(data);
  const chats = createChats(data);
  chats.migrateIndex((idx) => { idx.v2 = { at: 'now', from: 'test' }; return true; });
  const handlers = {};
  const sent = [];
  const merged = [];
  const runs = [];
  let answer = 1;
  const S = { connection: {}, bins: {}, extraDirs: [], access: 'standard', autoPush: true, tools: { web: true, build: true, quickChecks: ['node --check'] }, previewNetwork: false, copyIdleHours: 24, ownerIdentity: { name: 'Dragongamer9', email: 'Dragongamer9@users.noreply.github.com', emails: ['Dragongamer9@users.noreply.github.com'] }, ...settings };
  const api = v2.register({
    handle: (ch, fn) => { handlers[ch] = fn; },
    dataDir: () => data,
    readSettings: () => S,
    chats,
    gitops: { find: (b) => (b === 'git' ? 'git' : null) },
    agents: {
      runAgent: async (o) => {
        runs.push(o);
        o.onEvent?.({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: path.join(o.cwd, 'f.txt') } }, { type: 'tool_use', name: 'Edit', input: { file_path: path.join(o.cwd, 'f.txt') } }] } });
        if (o.mode !== 'read') fs.writeFileSync(path.join(o.cwd, 'f.txt'), `changed by ${o.agent}\n`);
        fs.mkdirSync(path.join(o.cwd, '.hearth-preview'), { recursive: true });
        fs.writeFileSync(path.join(o.cwd, '.hearth-preview', 'mock.html'), '<h1>mock</h1>');
        return { ok: true, text: 'Done.\nCo-Authored-By: Claude <noreply@anthropic.com>', sessionId: 'sess-1', via: 'Claude Code' };
      },
    },
    attachments, history: { append() {} }, redact: (x) => x,
    send: (ch, p) => sent.push([ch, p]),
    dialog: { showMessageBoxSync: () => answer, showSaveDialog: async () => ({ canceled: true }) },
    getWindow: () => null,
    shell: { openExternal() {}, openPath() {} },
    worktreeRoot: () => path.join(data, 'workspaces'),
    runs: new Map(),
    assetsEnv: () => undefined,
    validateProvider, validatePrompt, validateModel,
    apiConnected: () => false,
    callApi: async () => ({ ok: false }),
    projects: () => ({ list: [] }),
    stateFileFor: (id) => path.join(data, `${id}.json`),
    urlFor: (repo) => `file://${remotes[repo]}`,
    github: {
      defaultBranch: async () => 'main',
      prFor: async () => ({ ok: true, pr: null }),
      prCreate: async (repo, o) => ({ ok: true, number: 7, url: `https://github.com/${repo}/pull/7`, head: o.head, base: o.base }),
      prMerge: async (repo, n, sha) => { merged.push([repo, n, sha]); return { ok: true, message: `Merged pull request #${n} into main.` }; },
      runs: async () => ({ ok: true, state: 'success', runs: [] }),
      failure: async () => ({ ok: true, job: null, annotations: [] }),
      repos: async () => ({ ok: true, repos: [] }),
      branches: async () => ({ ok: true, default: 'main', branches: ['main'] }),
    },
  });
  return { tmp, data, chats, handlers, sent, merged, runs, remotes, api, S, setAnswer: (a) => { answer = a; } };
}
const run = (t, chatId, o = {}) => t.handlers['chat:run']({ chatId, agent: 'anthropic', prompt: 'Fix it', runId: 'run1', build: true, web: true, ...o });

test('a run works in the chat\'s own shallow copy, streams steps, commits as the owner and pushes to the chat\'s branch', async () => {
  const t = setup();
  const c = t.chats.create({ repo: 'Dragongamer9/alpha', branch: 'main', title: 'Fix it' });
  const r = await run(t, c.id);
  assert.equal(r.ok, true);
  const o = t.runs[0];
  assert.equal(o.cwd, path.join(t.data, 'copies', c.id), 'the copy belongs to this chat');
  assert.equal(g(o.cwd, 'rev-parse', '--is-shallow-repository'), 'true');
  assert.equal(o.claude.perm, 'acceptEdits', 'Claude: edits plus allowed commands only');
  assert.ok(o.claude.allowedTools.includes('Bash(node --check:*)'));
  assert.ok(!o.claude.allowedTools.some((x) => /gh pr merge|gh api|gh release/.test(x)), 'never merge, API or release tools');
  const steps = t.sent.filter(([ch]) => ch === 'chat:step').map(([, p]) => p.step.kind);
  assert.deepEqual(steps.slice(0, 3), ['copy', 'read', 'edit']);
  assert.equal(r.changedThisTurn, true);
  assert.deepEqual(r.changes.files.map((f) => f.path), ['f.txt']);
  assert.equal(g(o.cwd, 'log', '-1', '--format=%an <%ae>'), 'Dragongamer9 <Dragongamer9@users.noreply.github.com>');
  assert.equal(r.pushed.ok, true, r.pushed.message);
  assert.match(r.pushed.branch, /^hearth\/fix-it-/);
  assert.equal(g(t.remotes['Dragongamer9/alpha'], 'rev-parse', r.pushed.branch), r.pushed.sha);
  assert.equal(g(t.remotes['Dragongamer9/alpha'], 'rev-list', '--count', 'main'), '1', 'main untouched');
  assert.deepEqual(r.previews.map((p) => p.name), ['mock.html'], 'live previews from .hearth-preview/');
  // A second turn that changes nothing gets no files-changed card.
  const again = await run(t, c.id, { build: false, agent: 'openai' });
  assert.equal(again.changedThisTurn, false);
  assert.equal(again.changes, null);
  assert.equal(t.runs[1].mode, 'read', 'Run & build off: other AIs only read');
});

test('merging always asks the owner in a native box; Cancel merges nothing', async () => {
  const t = setup({ settings: { autoPush: false } });
  const c = t.chats.create({ repo: 'Dragongamer9/alpha', branch: 'main', title: 'Merge me' });
  await run(t, c.id);
  t.setAnswer(1);
  const no = await t.handlers['chat:merge'](c.id, {});
  assert.equal(no.ok, false);
  assert.equal(no.cancelled, true);
  assert.equal(t.merged.length, 0, 'nothing merged without the owner\'s yes');
  t.setAnswer(0);
  const head = g(path.join(t.data, 'copies', c.id), 'rev-parse', 'HEAD');
  const stale = await t.handlers['chat:merge'](c.id, { sha: 'a'.repeat(40) });
  assert.match(stale.message, /changed since you looked/);
  assert.equal(t.merged.length, 0);
  const yes = await t.handlers['chat:merge'](c.id, { sha: head });
  assert.equal(yes.ok, true);
  assert.deepEqual(t.merged, [['Dragongamer9/alpha', 7, head]], 'exactly the commit he saw');
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'v2.cjs'), 'utf8');
  const m = src.slice(src.indexOf("handle('chat:merge'"), src.indexOf("handle('chat:runs'"));
  assert.ok(m.indexOf('showMessageBoxSync') > 0 && m.indexOf('showMessageBoxSync') < m.indexOf('github.prMerge('), 'the question comes before the merge');
  assert.doesNotMatch(m, /byLead|actForMe/, 'no path around the question');
});

test('a copy from another repo is never used: the run is refused and nothing runs', async () => {
  const t = setup();
  const c = t.chats.create({ repo: 'Dragongamer9/alpha', branch: 'main', title: 'x' });
  await run(t, c.id);
  const n = t.runs.length;
  // The chat now says beta (as if changed behind the app's back); its copy is alpha's.
  t.chats.migrateIndex((idx) => { idx.list.find((e) => e.id === c.id).repo = 'Dragongamer9/beta'; return true; });
  const r = await run(t, c.id);
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'wrong_repo');
  assert.equal(t.runs.length, n, 'the AI was never started');
  assert.ok(fs.existsSync(path.join(t.data, 'copies', c.id, 'f.txt')), 'and the other repo\'s copy is not deleted');
});

test('unpushed work is never deleted without asking: connect, delete and clean up all stop first', async () => {
  const t = setup({ settings: { autoPush: false } });
  const c = t.chats.create({ repo: 'Dragongamer9/alpha', branch: 'main', title: 'wip' });
  await run(t, c.id);
  const dir = path.join(t.data, 'copies', c.id);
  const conn = await t.handlers['chats:connect'](c.id, { repo: 'Dragongamer9/beta', branch: 'main' });
  assert.equal(conn.ok, false);
  assert.equal(conn.unpushed, true);
  assert.equal(t.chats.entry(c.id).repo, 'Dragongamer9/alpha', 'not switched');
  const del = await t.handlers['chats:delete2'](c.id, {});
  assert.equal(del.unpushed, true);
  assert.ok(t.chats.entry(c.id), 'chat not deleted');
  const clean = await t.handlers['copies:cleanup']();
  assert.deepEqual(clean.unpushed.map((x) => x.chatId), [c.id]);
  assert.ok(fs.existsSync(dir));
  // Force needs the owner's own yes in a native box: Cancel keeps everything.
  t.setAnswer(1);
  const kept = await t.handlers['copies:remove'](c.id, true);
  assert.equal(kept.ok, false);
  assert.ok(fs.existsSync(dir));
  // "Push to a branch first", then it can go without any question.
  const p = await t.handlers['chat:push'](c.id);
  assert.equal(p.ok, true, p.message);
  t.setAnswer(1);
  const gone = await t.handlers['chats:delete2'](c.id, {});
  assert.equal(gone.ok, true);
  assert.equal(fs.existsSync(dir), false, 'the copy is deleted with the chat');
  assert.equal(t.chats.trash()[0].id, c.id, 'the chat is in Recently deleted');
});

test('closing a clean copy removes it; the next run makes a fresh one', async () => {
  const t = setup();
  const c = t.chats.create({ repo: 'Dragongamer9/alpha', branch: 'main', title: 'close' });
  await run(t, c.id); // pushed (autoPush on)
  const dir = path.join(t.data, 'copies', c.id);
  const r = await t.handlers['copies:remove'](c.id, false);
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(dir), false);
  const list = await t.handlers['copies:list']();
  assert.equal(list.list.length, 0);
});

test('previews: the window can\'t turn the network on; only the owner\'s setting can', async () => {
  const t = setup();
  const r = t.handlers['preview:serve']('<p>x</p>', true);
  assert.equal(r.net, false);
  t.S.previewNetwork = true;
  assert.equal(t.handlers['preview:serve']('<p>x</p>').net, true);
});

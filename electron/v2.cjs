// 2.x: chats that can connect to a GitHub repo. The IPC behind the new window:
// runs in a chat (in the chat's temporary copy, see copies.cjs), the steps they stream,
// the files-changed card (diff, push, pull request, merge that always asks), GitHub
// Actions status, live previews, temporary copies in Settings › Saved data, and the old
// boards shown read-only. electron/main.cjs wires it up; nothing here writes settings.
const fs = require('node:fs');
const path = require('node:path');
const { createCopies, sameRepo, validBranch, validRepo } = require('./copies.cjs');
const { createGithub } = require('./github.cjs');
const steps = require('./steps.cjs');
const previews = require('./previews.cjs');
const { migrateV2, remoteReader, readStateReadOnly } = require('./migrate-v2.cjs');
const media = require('./media.cjs');
const crypto = require('node:crypto');

// Commands the AIs may run in a copy by themselves (Claude Code enforces this list; the
// others are told). Quick checks only: heavy builds and full test runs go to GitHub Actions.
const DEFAULT_QUICK_CHECKS = ['node --check', 'node --test', 'npm test', 'python3 -m py_compile', 'python3 -m pytest', 'bash -n', 'sh -n', 'shellcheck', 'cargo check', 'cargo fmt --check'];
const GIT_TOOLS = ['git status', 'git diff', 'git log', 'git show', 'git add', 'git commit', 'git checkout', 'git switch', 'git restore', 'git push', 'git fetch', 'git grep', 'git ls-files', 'git rev-parse', 'git branch', 'gh run list', 'gh run view', 'gh run watch', 'gh pr view', 'gh pr list', 'gh pr checks', 'gh pr create', 'gh pr diff', 'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'mkdir', 'mv', 'cp'];
const QUICK_RE = /^[A-Za-z0-9][A-Za-z0-9 ._/:=+-]{0,79}$/;
const cleanQuick = (list) => [...new Set((Array.isArray(list) ? list : []).map((c) => String(c || '').trim().replace(/\s+/g, ' ')).filter((c) => QUICK_RE.test(c) && !/[;&|`$<>]/.test(c)))].slice(0, 40);
const IDLE_CHOICES = [1, 6, 24, 72, 168, 0];

// Claude Code permissions for one chat turn. Build on: edits plus the allowed commands only.
// Skill (Claude Code skills) and Task (its own parallel helpers) are always allowed;
// connectors (MCP servers the owner added) by name.
function claudePolicy({ build, access, quickChecks, web, mcp = [] }) {
  const extra = ['Skill', 'Task', ...mcp.map((n) => `mcp__${n}`)];
  if (access === 'full' && build) return { perm: 'bypassPermissions', allowedTools: extra, web };
  const allowedTools = build ? [...GIT_TOOLS, ...cleanQuick(quickChecks)].map((c) => `Bash(${c}:*)`) : ['Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(ls:*)'];
  return { perm: 'acceptEdits', allowedTools: [...allowedTools, ...extra], web };
}
const MAX_CHAT_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10];

function register(d) {
  const { handle, dataDir, readSettings, chats, agents, gitops, attachments, history, redact, send, dialog, getWindow, shell, assetsEnv, worktreeRoot, validateProvider, validatePrompt, validateModel, callApi, apiConnected, projects, stateFileFor, protocol } = d;
  const ownerIdentity = () => readSettings().ownerIdentity;
  // (tests pass urlFor/github to work against local repos without the network)
  const copies = createCopies({ dataDir: dataDir(), gitBin: gitops.find('git') || 'git', owner: ownerIdentity, ...(d.urlFor ? { urlFor: d.urlFor } : {}) });
  const github = d.github || createGithub({ ghBin: () => gitops.find('gh') });
  const store = previews.createPreviewStore({ libDir: d.libDir || path.join(__dirname, '..', 'dist', 'vendor') });
  // Every run is keyed by its chat (helpers by chat#run), never one global: several chats
  // can have their teams working at once, each in its own copy, branch and sessions.
  const running = new Map(); // chatId (or chatId#runId for a helper) -> AbortController
  const busyChats = new Set(); // chats whose round is in progress in the window (between turns too)
  const temps = new Map(); // temporary chats: kept in memory only, nothing saved
  const mediaRoot = media.mediaRoot(dataDir());
  const notices = [];
  const primaryRunning = () => [...running.keys()].filter((k) => !k.includes('#')).length;

  // ---- migration (once, additive) ----
  const migration = (async () => {
    try {
      const r = await migrateV2({ chats, projects: projects().list, stateFileFor, remoteOf: remoteReader(copies.git) });
      notices.push(...r.notices);
      return r;
    } catch (e) { notices.push(`Moving to the new layout stopped: ${e.message}. Nothing was lost; your old files are untouched.`); return { ok: false }; }
  })();

  // ---- preview pages (hearth-preview://<id>/) ----
  if (protocol?.handle) {
    protocol.handle(previews.SCHEME, (req) => {
      const r = store.respond(req.url);
      return new Response(r.body, { status: r.status, headers: r.headers });
    });
  }

  const entryOf = (id) => { const t = temps.get(String(id)); if (t) return t; const e = chats.entry(String(id)); if (!e) throw new Error('unknown chat'); return e; };
  const connOf = (e) => (e.repo ? { repo: e.repo } : e.repoDir ? { dir: e.repoDir } : null);
  async function branchOf(e) {
    if (e.branch) return e.branch;
    if (e.repo) return (await github.defaultBranch(e.repo)) || 'main';
    const r = await copies.git(e.repoDir, ['branch', '--show-current']);
    return (r.ok && validBranch(r.out) && r.out) || 'main';
  }
  // The chat's copy, made when first needed. One from another repo is never used.
  async function copyFor(e, { make = true } = {}) {
    const c = connOf(e);
    if (!c) return null;
    if (!make && !copies.exists(e.id)) return null;
    const branch = await branchOf(e);
    const def = e.repo ? await github.defaultBranch(e.repo) : null;
    return copies.ensure({ chatId: e.id, ...(c.repo ? { repo: c.repo } : { dir: c.dir }), branch, title: e.title, defaultBranch: def });
  }
  const scratchDir = (id) => { const dir = path.join(dataDir(), 'chats', temps.has(String(id)) ? 'temp' : 'scratch', String(id).replace(/[^a-z0-9-]/g, '')); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; };
  // Temporary (incognito) chats: no file, no history, no repo; everything goes when it ends.
  handle('chats:temp', () => {
    const id = `t${crypto.randomBytes(5).toString('hex')}`;
    const e = { id, title: 'Temporary chat', temp: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    temps.set(id, e);
    return e;
  });
  function endTemp(id) {
    if (!temps.has(String(id))) return { ok: false };
    running.get(String(id))?.abort();
    temps.delete(String(id));
    try { fs.rmSync(path.join(dataDir(), 'chats', 'temp', String(id)), { recursive: true, force: true }); } catch {}
    media.removeChat(mediaRoot, String(id));
    return { ok: true };
  }
  handle('chats:tempEnd', (id) => endTemp(id));
  handle('chat:busy', (id, on) => { if (on === true) busyChats.add(String(id)); else busyChats.delete(String(id)); return true; });

  handle('v2:boot', async () => {
    const m = await migration;
    return { migrated: Boolean(m?.migrated), notices: [...notices, ...chats.notices()], broken: Boolean(chats.broken()) };
  });
  handle('chats:list2', async () => { await migration; return { list: chats.list([], null).map((e) => ({ ...e, hasCopy: copies.exists(e.id) })), notices: [...notices, ...chats.notices()], broken: Boolean(chats.broken()) }; });
  handle('chats:create2', async (o = {}) => {
    await migration;
    const repo = o && validRepo(o.repo) ? o.repo : null;
    const branch = repo && validBranch(o.branch) ? o.branch : null;
    return chats.create({ repo, branch, title: typeof o?.title === 'string' && o.title.trim() ? o.title.slice(0, 120) : 'New chat' });
  });
  handle('chats:search', (q) => chats.search(String(q || '')));
  handle('chats:get2', (id) => (temps.has(String(id)) ? { ok: true, messages: [], sessions: {}, temp: true } : chats.get(String(id))));

  // Connect a chat to another repo/branch (or none). Its old copy goes away first; one
  // holding unpushed work is never removed here: the window asks the owner.
  handle('chats:connect', async (id, conn) => {
    const e = entryOf(id);
    const repo = conn && validRepo(conn.repo) ? conn.repo : null;
    if (conn && conn.repo && !repo) throw new Error('bad repo');
    const branch = repo && conn.branch && validBranch(conn.branch) ? conn.branch : null;
    const same = repo && e.repo && sameRepo(repo, e.repo) && (branch || null) === (e.branch || null);
    if (!same && copies.exists(e.id)) {
      const r = await copies.remove(e.id);
      if (!r.ok) return { ok: false, unpushed: Boolean(r.unpushed), status: r.status, message: r.message };
    }
    return { ok: true, entry: chats.update(e.id, { repo, branch }) };
  });
  // Deleting a chat removes its copy; with unpushed work it asks (force only after a native yes).
  handle('chats:delete2', async (id, opts = {}) => {
    const e = entryOf(id);
    if (copies.exists(e.id)) {
      const r = await removeCopy(e.id, opts?.force === true);
      if (!r.ok) return r;
    }
    if (running.has(e.id)) return { ok: false, message: 'An AI is still working in this chat. Stop it first.' };
    return chats.remove(e.id);
  });

  async function removeCopy(chatId, force) {
    const st = await copies.status(chatId);
    if (st.unpushed && !force) return { ok: false, unpushed: true, status: st, message: 'This copy has work that isn\'t on GitHub yet.' };
    if (st.unpushed && force) {
      // The owner's own yes, in a native box the window (or an AI) can't answer.
      const c = dialog.showMessageBoxSync(getWindow(), { type: 'warning', message: 'Delete work that isn\'t on GitHub?', detail: `The temporary copy of ${st.repo || st.dir || 'this repo'} has ${st.dirty ? `${st.dirty} changed file${st.dirty > 1 ? 's' : ''}` : ''}${st.dirty && st.ahead ? ' and ' : ''}${st.ahead ? `${st.ahead} commit${st.ahead > 1 ? 's' : ''}` : ''} that were never pushed. Deleting it loses that work for good.`, buttons: ['Delete for good', 'Cancel'], defaultId: 1, cancelId: 1 });
      if (c !== 0) return { ok: false, cancelled: true, message: 'Kept.' };
    }
    return copies.remove(chatId, { force: st.unpushed && force });
  }

  // ---- runs ----
  async function runChat(o) {
    if (!o || typeof o !== 'object') throw new Error('bad request');
    const e = entryOf(o.chatId);
    const agent = validateProvider(o.agent);
    const prompt = validatePrompt(o.prompt);
    const runId = typeof o.runId === 'string' && /^[A-Za-z0-9]{4,24}$/.test(o.runId) ? o.runId : crypto.randomBytes(5).toString('hex');
    const helper = o.helper === true;
    const key = helper ? `${e.id}#${runId}` : e.id;
    if (running.has(key)) return { ok: false, error: { kind: 'busy', message: 'Another AI is still working in this chat.' } };
    const s = readSettings();
    // The owner's limit on chats working at once (the window queues the rest and says so).
    if (!helper && primaryRunning() >= (s.maxChats || 3)) return { ok: false, error: { kind: 'queue', message: `${s.maxChats || 3} chats are already working; this one waits its turn.` } };
    const tools = s.tools;
    const web = o.web === true;
    const build = o.build === true && !helper;
    const controller = new AbortController();
    running.set(key, controller);
    d.runs.set(runId, controller);
    const step = (st) => send('chat:step', { runId, chatId: e.id, step: st });
    let mcp = null;
    try {
      let cwd;
      let copy = null;
      if (connOf(e) && !e.temp) {
        if (!copies.exists(e.id)) step({ kind: 'copy', label: 'Made a temporary copy', detail: `${e.repo || path.basename(e.repoDir)} · shallow, on this PC`, live: true });
        try { copy = await copyFor(e); } catch (err) { return { ok: false, error: { kind: err.wrongRepo ? 'wrong_repo' : 'copy', message: err.message } }; }
        // Belt and braces: never run in a copy whose origin isn't this chat's repo.
        if (!(await copies.belongs(e.id, connOf(e)))) return { ok: false, error: { kind: 'wrong_repo', message: 'This chat\'s copy belongs to a different repo, so nothing was run.' } };
        cwd = copy.dir;
      } else cwd = scratchDir(e.id);
      const startedAt = Date.now();
      const headBefore = copy ? (await copies.git(cwd, ['rev-parse', 'HEAD'])).out : null;
      const apiOnly = apiConnected(agent);
      let mode = 'read';
      if (agent !== 'ollama' && !apiOnly && !helper) {
        if (copy) mode = build ? (s.access === 'full' ? 'full' : 'standard') : agent === 'anthropic' ? 'standard' : 'read';
        else mode = build ? 'standard' : 'read';
      }
      const images = (Array.isArray(o.images) ? o.images : []).filter((f) => typeof f === 'string' && attachments.inside(f, [attachments.attachDir(worktreeRoot())])).slice(0, 8);
      const files = (Array.isArray(o.files) ? o.files : []).filter((f) => typeof f === 'string' && attachments.inside(f, [attachments.attachDir(worktreeRoot())])).slice(0, 8);
      let r;
      if (apiOnly) {
        r = await callApi(agent, o.model, prompt);
      } else {
        try { mcp = d.mcpForRun ? d.mcpForRun(path.join(dataDir(), 'run')) : null; } catch { mcp = null; }
        const base = {
          agent, cwd, mode,
          model: o.model ? validateModel(o.model) : undefined,
          timeoutMs: mode === 'read' ? 15 * 60000 : 45 * 60000,
          signal: controller.signal,
          bin: s.bins[agent],
          extraDirs: [...s.extraDirs, ...(files.length ? [attachments.attachDir(worktreeRoot())] : [])],
          images,
          extraEnv: { ...(assetsEnv(agent, cwd) || {}), ...(mcp ? (agent === 'openai' ? mcp.codexEnv : mcp.env) : {}), ...(mcp && agent === 'google' ? { GEMINI_CLI_SYSTEM_SETTINGS_PATH: mcp.geminiFile } : {}) },
          onEvent: (ev) => { for (const st of steps.fromEvent(agent, ev)) step(st); },
          web,
          mcp: mcp ? { claudeFile: mcp.claudeFile, codexArgs: mcp.codexArgs } : null,
          // Claude: plan mode when it only answers; else edits plus the allowed commands only
          // (Run & build off: edits, no commands).
          claude: agent !== 'anthropic' ? null : mode === 'read' ? { perm: 'plan', allowedTools: ['Skill', 'Task', ...(mcp ? mcp.names.map((n) => `mcp__${n}`) : [])], web } : claudePolicy({ build, access: s.access, quickChecks: tools.quickChecks, web, mcp: mcp ? mcp.names : [] }),
        };
        const resumeId = typeof o.resumeId === 'string' ? o.resumeId : null;
        r = await agents.runAgent({ ...base, prompt, resumeId });
        if (!r.ok && r.resumeFailed && ['failed', 'unsupported'].includes(r.error?.kind) && typeof o.fallbackPrompt === 'string' && !controller.signal.aborted) {
          r = await agents.runAgent({ ...base, prompt: validatePrompt(o.fallbackPrompt) });
          r.resumeReset = true;
        }
      }
      if (r.text) r.text = redact(r.text);
      if (r.partial) r.partial = redact(r.partial);
      if (r.error?.message) r.error.message = redact(r.error.message);
      const out = { ...r, mode, web, build, helper };
      if (copy && !helper) {
        // Anything the AI left uncommitted is saved as the owner's commit.
        try { await copies.commitAll(e.id, `${String(o.title || e.title).slice(0, 72)}`); } catch (err) { out.commitError = err.message; }
        // The files-changed card only for a turn that really changed something.
        out.changedThisTurn = (await copies.git(cwd, ['rev-parse', 'HEAD'])).out !== headBefore;
        out.changes = out.changedThisTurn ? await copies.changes(e.id) : null;
        out.status = await copies.status(e.id);
        if (build && s.autoPush && out.status.ahead > 0) {
          out.pushed = await copies.push(e.id);
          if (out.pushed.ok) step({ kind: 'push', label: 'Pushed', detail: `to ${out.pushed.branch}` });
          out.status = await copies.status(e.id);
        }
        copies.touch(e.id);
      }
      out.previews = previews.collect(cwd, startedAt);
      // Pictures, videos and files the AI made or named: copied into the app's media folder.
      try { out.media = media.collect({ cwd, sinceMs: startedAt, text: r.text || r.partial || '', chatId: e.id, root: mediaRoot }); } catch { out.media = []; }
      if (r.ok && r.sessionId && !e.temp) {
        try { history.append({ provider: agent, sessionId: r.sessionId, title: e.title, cwd, taskId: null, resumable: true, messages: [{ role: 'user', text: String(o.historyText || prompt).slice(0, 8000), at: new Date(startedAt).toISOString() }, { role: 'assistant', text: r.text, at: new Date().toISOString() }] }); } catch {}
      }
      return out;
    } finally {
      mcp?.cleanup();
      running.delete(key);
      d.runs.delete(runId);
    }
  }
  handle('chat:run', runChat);
  // Stop one chat (and its helpers); other chats keep working.
  handle('chat:cancel', (chatId) => { const id = String(chatId); for (const [k, c] of running) if (k === id || k.startsWith(`${id}#`)) c.abort(); return true; });

  // ---- the files-changed card ----
  handle('chat:changes', async (id) => { const e = entryOf(id); return copies.exists(e.id) ? { ok: true, ...(await copies.changes(e.id)), status: await copies.status(e.id) } : { ok: false, files: [] }; });
  handle('chat:diff', async (id) => { const e = entryOf(id); return { ok: true, diff: redact(await copies.diff(e.id)) }; });
  handle('chat:push', async (id) => { const e = entryOf(id); return copies.push(e.id); });
  handle('copies:status', async (id) => copies.status(entryOf(id).id));
  handle('chat:pr', async (id, o = {}) => {
    const e = entryOf(id);
    if (!e.repo) return { ok: false, message: 'Pull requests need a GitHub repo.' };
    const st = await copies.status(e.id);
    if (!st.exists) return { ok: false, message: 'Nothing to open a pull request for yet.' };
    if (st.unpushed) { const p = await copies.push(e.id); if (!p.ok && !p.nothing) return p; }
    const meta = copies.readMeta(e.id);
    const r = await github.prCreate(e.repo, { head: meta.work, base: meta.branch, title: String(o.title || e.title), body: redact(String(o.body || '')) });
    if (r.ok && r.url?.startsWith('https://github.com/') && o.open !== false) shell.openExternal(r.url);
    return r;
  });
  // Merging ALWAYS asks the owner in a native box (also when Claude asked for it and the
  // owner said yes in the chat). It merges the pull request on GitHub, exactly at the
  // commit he looked at; main never changes any other way.
  handle('chat:merge', async (id, o = {}) => {
    const e = entryOf(id);
    if (!e.repo) return { ok: false, message: 'Merging needs a GitHub repo.' };
    const st = await copies.status(e.id);
    if (!st.exists) return { ok: false, message: 'There is nothing to merge yet.' };
    if (st.unpushed) { const p = await copies.push(e.id); if (!p.ok && !p.nothing) return p; }
    const meta = copies.readMeta(e.id);
    const head = (await copies.git(copies.dirOf(e.id), ['rev-parse', 'HEAD'])).out;
    if (typeof o.sha === 'string' && o.sha && o.sha !== head) return { ok: false, message: 'The branch changed since you looked at it. Look at the changes again.' };
    let pr = (await github.prFor(e.repo, meta.work)).pr;
    if (!pr || pr.state !== 'OPEN') {
      const c = await github.prCreate(e.repo, { head: meta.work, base: meta.branch, title: e.title, body: redact(String(o.body || '')) });
      if (!c.ok) return c;
      pr = { number: c.number, url: c.url };
    }
    const confirm = dialog.showMessageBoxSync(getWindow(), {
      type: 'warning',
      message: `Merge ${meta.work} into ${meta.branch}?`,
      detail: `This merges pull request #${pr.number} on GitHub and changes ${meta.branch} of ${e.repo}. Commit ${head.slice(0, 7)} is merged exactly as you saw it. If it touches booting, make sure the previous version stays startable.`,
      buttons: [`Merge into ${meta.branch}`, 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (confirm !== 0) return { ok: false, cancelled: true, message: 'Not merged.' };
    const r = await github.prMerge(e.repo, pr.number, head);
    return { ...r, number: pr.number, url: pr.url };
  });
  handle('chat:runs', async (id, o = {}) => {
    const e = entryOf(id);
    if (!e.repo) return { ok: false, message: 'No GitHub repo.' };
    const branch = validBranch(o.branch) ? o.branch : copies.readMeta(e.id)?.work;
    if (!branch) return { ok: false, message: 'No branch yet.' };
    const sha = /^[0-9a-f]{40}$/.test(String(o.sha || '')) ? o.sha : null;
    return github.runs(e.repo, branch, sha);
  });
  handle('chat:failure', async (id, runId) => { const e = entryOf(id); return e.repo ? github.failure(e.repo, runId) : { ok: false }; });
  // "Save to repo…": the owner picked the path; committed as him in the chat's copy.
  handle('chat:saveFile', async (id, rel, content) => {
    const e = entryOf(id);
    if (!connOf(e)) return { ok: false, message: 'Connect this chat to a repo first.' };
    try { await copyFor(e); } catch (err) { return { ok: false, message: err.message }; }
    return copies.writeFile(e.id, rel, content);
  });

  // ---- GitHub ----
  handle('gh:repos', () => github.repos());
  handle('gh:branches', (repo) => github.branches(String(repo || '')));

  // ---- previews ----
  handle('preview:serve', (html, o = {}) => (o && o.diagram === true
    // A diagram (mermaid) frame: the bundled library only, never the network.
    ? { ok: true, url: store.add(String(html || ''), false, { lib: true }), net: false }
    : { ok: true, url: store.add(String(html || ''), readSettings().previewNetwork === true), net: readSettings().previewNetwork === true }));
  handle('preview:download', async (name, content) => {
    const safe = String(name || 'preview.html').replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 100) || 'preview.html';
    const r = await dialog.showSaveDialog(getWindow(), { title: 'Download preview', defaultPath: safe });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.writeFileSync(r.filePath, String(content || ''), { mode: 0o644 });
    return { ok: true, file: r.filePath };
  });

  // ---- temporary copies (Settings › Saved data) ----
  handle('copies:list', async () => ({ ok: true, root: copies.root, list: await copies.list(), idleHours: readSettings().copyIdleHours }));
  handle('copies:remove', async (id, force) => {
    if (running.has(String(id))) return { ok: false, message: 'An AI is working in that copy right now.' };
    return removeCopy(String(id), force === true);
  });
  handle('copies:cleanup', async () => {
    const removed = [];
    const unpushed = [];
    for (const c of await copies.list()) {
      if (running.has(c.chatId)) continue;
      if (c.unpushed) { unpushed.push(c); continue; }
      const r = await copies.remove(c.chatId);
      if (r.ok) removed.push({ ...c, freed: r.freed });
    }
    return { ok: true, removed, unpushed };
  });
  handle('copies:open', (id) => shell.openPath(copies.dirOf(String(id))));

  // ---- the old boards, read-only ----
  handle('saved:boards', () => projects().list.map((p) => {
    const file = stateFileFor(p.id);
    const { state, from } = readStateReadOnly(file);
    return {
      id: p.id, name: p.name, dir: p.dir, file, readFrom: from,
      tasks: (state?.tasks || []).slice(0, 500).map((t) => ({ id: String(t.id || ''), title: String(t.title || '').slice(0, 200), stage: String(t.stage || ''), assignee: String(t.assignee || ''), updatedAt: t.updatedAt || null })),
      approvals: (state?.permissions || []).length,
      audit: (state?.audit || []).length,
      chat: (state?.chat || []).length,
      savedAt: state?.savedAt || null,
      ok: Boolean(state),
    };
  }));
  handle('saved:openData', () => shell.openPath(dataDir()));

  // Idle copies are removed (unpushed ones are kept and listed). On start and hourly.
  const sweep = async () => {
    try {
      const r = await copies.sweep({ idleHours: readSettings().copyIdleHours, skip: [...running.keys()] });
      if (r.keptUnpushed.length) send('copies:idleUnpushed', r.keptUnpushed.map((c) => ({ chatId: c.chatId, repo: c.repo, dirty: c.dirty, ahead: c.ahead })));
      if (r.removed.length) send('copies:removed', r.removed.map((c) => c.chatId));
    } catch {}
  };
  const timer = setInterval(sweep, 3600e3);
  const first = setTimeout(sweep, 20000);
  timer.unref?.();
  first.unref?.();
  return { copies, github, sweep, runChat, running, busyChats, temps, entryOf, scratchDir, mediaRoot, copyFor, stop() { clearInterval(timer); clearTimeout(first); for (const c of running.values()) c.abort(); for (const id of [...temps.keys()]) endTemp(id); }, migration };
}

module.exports = { register, claudePolicy, cleanQuick, DEFAULT_QUICK_CHECKS, GIT_TOOLS, IDLE_CHOICES, MAX_CHAT_CHOICES };

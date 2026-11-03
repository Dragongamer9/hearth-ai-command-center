// Team ops in the main process: projects, project memory, the app's own test runs,
// stall watchdog, CI watch, Hearth logs, voice notes, phone view, CLI usage.
// main.cjs calls register() once and uses the few helpers it returns.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { createProjects } = require('./projects.cjs');
const tests = require('./tests.cjs');
const ci = require('./ci.cjs');
const logs = require('./logs.cjs');
const voice = require('./voice.cjs');
const memory = require('./memory.cjs');
const usage = require('./usage.cjs');
const { createWatchdog } = require('./watchdog.cjs');
const { createPhone } = require('./phone.cjs');
const media = require('./media.cjs');
const { createJobs } = require('./jobs.cjs');
const { spawn } = require('node:child_process');
const identity = require('./identity.cjs');
const release = require('./release.cjs');

function exec(file, args, { cwd, timeoutMs = 60000, env, maxBuffer = 16 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, timeout: timeoutMs, maxBuffer, env: env || { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' } }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: String(stdout), err: String(stderr).trim() || (error ? error.message : '') });
    });
  });
}

let projects = null;
let phone = null;
const testRuns = new Map(); // taskId -> AbortController

// Which state file the app should open (before the window exists).
function stateFile(dataDir, legacyDir) {
  projects = projects || createProjects(dataDir);
  const reg = projects.load(legacyDir);
  return projects.stateFile(reg.active);
}

function register(d) {
  const { handle, dataDir, readSettings, useProject, setStore, taskDir, worktreeRoot, gitops, workspace, agents, attachments, redact, send, dialog, getWindow } = d;
  projects = projects || createProjects(dataDir());
  const gh = () => gitops.find('gh');
  const ghApi = (args, timeoutMs = 30000) => {
    const bin = gh();
    if (!bin) return Promise.resolve({ ok: false, err: 'GitHub CLI (gh) is not installed.' });
    return exec(bin, ['api', ...args], { timeoutMs });
  };
  const active = () => projects.active();
  const projectDir = () => readSettings().project;
  const memFile = (dir = projectDir()) => (dir ? path.join(dir, memory.MEMORY_REL) : null);
  const readMemory = () => { try { return fs.readFileSync(memFile(), 'utf8'); } catch { return ''; } };
  // ---- the owner's identity on every commit ----
  const ownerId = () => readSettings().ownerIdentity || null;
  // Every git operation the app runs (and every AI CLI it starts) inherits this env.
  const applyIdentity = () => {
    const id = ownerId();
    for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete process.env[k];
    Object.assign(process.env, identity.gitEnv(id));
    return id;
  };
  applyIdentity();
  handle('ops:identityDefault', async () => {
    const dir = projectDir() || os.homedir();
    const [n, e] = await Promise.all([workspace.git(dir, ['config', 'user.name']), workspace.git(dir, ['config', 'user.email'])]);
    return { saved: ownerId(), suggested: identity.cleanIdentity({ name: n.out, email: e.out }) };
  });
  handle('ops:identityApply', () => applyIdentity());
  const range = async (dir, from, to) => (await workspace.git(dir, ['log', identity.LOG_FORMAT, `${from}..${to}`, '-n', '500'])).out;
  const baseOf = async (dir) => {
    const def = await gitops.defaultBranch(dir);
    return (await workspace.git(dir, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${def}`])).ok ? `origin/${def}` : def;
  };
  // The guard before any push, merge to main, release or tag.
  async function guard(dir, from, to, what) {
    const id = applyIdentity();
    const r = identity.scanCommits(identity.parseLog(await range(dir, from, to)), id);
    if (r.ok) return null;
    return { ok: false, guard: r.problems, message: `Not ${what}: ${r.problems.slice(0, 3).join('; ')}${r.problems.length > 3 ? ` (+${r.problems.length - 3} more)` : ''}. Every commit must be yours only. Use "Rewrite authorship on this task branch" if it hasn't been pushed yet.` };
  }
  const wrap = (obj, name, fn) => { const orig = obj[name]; if (typeof orig === 'function' && !orig.hearthWrapped) { obj[name] = async (...a) => fn(orig, ...a); obj[name].hearthWrapped = true; } };
  wrap(gitops, 'pushBranch', async (orig, dir, branch) => (await guard(dir, await baseOf(dir), branch, 'pushed')) || orig(dir, branch));
  wrap(gitops, 'leadPush', async (orig, dir, branch) => (await guard(dir, await baseOf(dir), branch, 'pushed')) || orig(dir, branch));
  wrap(gitops, 'mergeApproved', async (orig, dir, branch, sha) => (await guard(dir, await baseOf(dir), sha || branch, 'merged')) || orig(dir, branch, sha));
  wrap(gitops, 'prMerge', async (orig, dir, n, sha) => (sha && (await guard(dir, await baseOf(dir), sha, 'merged'))) || orig(dir, n, sha));
  wrap(gitops, 'integrateIntoRelease', async (orig, dir, rel, branch) => (await guard(dir, await baseOf(dir), branch, 'combined')) || orig(dir, rel, branch));
  wrap(gitops, 'releaseBranch', async (orig, dir, name, branches) => {
    for (const b of branches || []) { const g = await guard(dir, await baseOf(dir), typeof b === 'object' ? b.sha : b, 'combined'); if (g) return g; }
    return orig(dir, name, branches);
  });
  wrap(gitops, 'releaseCreate', async (orig, dir, o) => {
    const last = (await workspace.git(dir, ['describe', '--tags', '--abbrev=0', o.target])).out;
    return (await guard(dir, last || `${o.target}~50`, o.target, 'released')) || orig(dir, o);
  });
  wrap(gitops, 'updateFromMain', async (orig, ...a) => { applyIdentity(); return orig(...a); });
  wrap(workspace, 'checkpoint', async (orig, ...a) => { applyIdentity(); return orig(...a); });
  // New task worktrees: the owner as local user, and hooks that strip AI attribution.
  wrap(workspace, 'ensureWorktree', async (orig, o) => {
    const id = applyIdentity();
    const r = await orig(o);
    try {
      if (id) { await workspace.git(r.dir, ['config', 'user.name', id.name]); await workspace.git(r.dir, ['config', 'user.email', id.email]); }
      const common = (await workspace.git(r.dir, ['rev-parse', '--git-common-dir'])).out;
      if (common) identity.installHooks(path.join(path.resolve(r.dir, common), 'hooks'));
    } catch {}
    return r;
  });
  handle('ops:checkTask', async (taskId) => {
    const dir = taskDir(String(taskId));
    if (!fs.existsSync(dir)) return { ok: true, problems: [] };
    const r = identity.scanCommits(identity.parseLog(await range(dir, await baseOf(dir), 'HEAD')), applyIdentity());
    return { ok: r.ok, problems: r.problems };
  });
  // "Rewrite authorship on this task branch": only unpublished hearth/ branches.
  handle('ops:rewriteTask', async (taskId, byLead) => {
    const s = readSettings();
    const id = applyIdentity();
    if (!id) return { ok: false, message: 'Set your owner identity in Settings first.' };
    const dir = taskDir(String(taskId));
    if (!fs.existsSync(dir)) return { ok: false, message: 'No workspace.' };
    const branch = (await workspace.git(dir, ['branch', '--show-current'])).out;
    const base = await baseOf(dir);
    const commits = identity.parseLog(await range(dir, base, 'HEAD'));
    if (!commits.length) return { ok: false, message: 'Nothing to rewrite.' };
    const oldest = commits[commits.length - 1].sha;
    const remotes = (await workspace.git(dir, ['branch', '-r', '--contains', oldest])).out.split('\n').map((x) => x.trim()).filter(Boolean);
    const allowed = identity.rewriteAllowed({ branch, remoteBranchesContaining: remotes });
    if (!allowed.ok) return { ok: false, message: allowed.reason };
    if (byLead === true) { if (s.leadActions !== true || s.leadMerge !== true) return { ok: false, message: 'Only the Owner can confirm this (lead merge is off).' }; }
    else if (dialog.showMessageBoxSync(getWindow(), { type: 'warning', message: `Rewrite ${commits.length} commit(s) on ${branch} as ${id.name}?`, detail: 'Only this task branch changes; nothing has been pushed from it. AI attribution lines are removed.', buttons: ['Rewrite', 'Cancel'], defaultId: 1, cancelId: 1 }) !== 0) return { ok: false, message: 'Cancelled.' };
    const hook = path.join(dataDir(), 'strip-attribution.sh');
    fs.writeFileSync(hook, identity.hookScript(), { mode: 0o700 });
    const msg = path.join(os.tmpdir(), `hearth-msg-${crypto.randomBytes(4).toString('hex')}`);
    const exe = `git log -1 --format=%B > '${msg}' && sh '${hook}' '${msg}' && git commit --amend -q --no-verify --reset-author -F '${msg}'`;
    const r = await workspace.git(dir, ['rebase', '-q', '--exec', exe, base], { timeoutMs: 300000 });
    try { fs.rmSync(msg, { force: true }); } catch {}
    if (!r.ok) { await workspace.git(dir, ['rebase', '--abort']); return { ok: false, message: `Rewrite stopped: ${r.err.split('\n')[0]}` }; }
    const head = (await workspace.git(dir, ['rev-parse', 'HEAD'])).out;
    return { ok: true, head, count: commits.length, message: `Rewrote ${commits.length} commit(s) on ${branch} as ${id.name} <${id.email}>.` };
  });

  // ---- releases and tags by the lead (owner switches; only the owner's Next version) ----
  const ghRepo = async () => {
    const r = await workspace.git(projectDir(), ['remote', 'get-url', 'origin']);
    return r.ok ? ci.parseRemote(r.out) : null;
  };
  handle('ops:leadRelease', async (kind, version) => {
    const s = readSettings();
    const dir = projectDir();
    if (!dir) return { ok: false, message: 'Pick a project first.' };
    const k = kind === 'tag' ? 'tag' : 'release';
    const ps = active().settings;
    await workspace.git(dir, ['fetch', '--quiet', '--no-tags', 'origin']);
    const def = await gitops.defaultBranch(dir);
    const ref = (await workspace.git(dir, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${def}`])).ok ? `origin/${def}` : def;
    const ver = String(version || '').replace(/^v/, '');
    const file = (await workspace.git(dir, ['show', `${ref}:${ps.versionFile}`])).out;
    const repo = await ghRepo();
    let exists = false;
    if (k === 'tag') exists = Boolean((await workspace.git(dir, ['ls-remote', '--tags', 'origin', `refs/tags/v${ver}`])).out) || (await workspace.git(dir, ['rev-parse', '--verify', '--quiet', `refs/tags/v${ver}`])).ok;
    else if (repo) exists = (await ghApi([`repos/${repo.owner}/${repo.repo}/releases/tags/v${ver}`])).ok;
    const c = release.checkLead({ kind: k, leadActions: s.leadActions, switchOn: k === 'tag' ? s.leadTag : s.leadRelease, requested: version, next: ps.nextVersion, fileVer: release.fileVersion(ps.versionFile, file), exists });
    if (!c.ok) return { ok: false, message: c.reason };
    const sha = (await workspace.git(dir, ['rev-parse', ref])).out;
    const g = await guard(dir, (await workspace.git(dir, ['describe', '--tags', '--abbrev=0', sha])).out || `${sha}~50`, sha, k === 'tag' ? 'tagged' : 'released');
    if (g) return g;
    if (k === 'tag') {
      const t = await workspace.git(dir, release.tagArgs(c.version, sha));
      if (!t.ok) return { ok: false, message: `Tag failed: ${t.err.split('\n')[0]}` };
      const p = await workspace.git(dir, release.pushTagArgs(c.version), { timeoutMs: 120000 });
      return p.ok ? { ok: true, message: `Tagged ${sha.slice(0, 7)} as v${c.version} and pushed the tag.`, sha } : { ok: false, message: `Tag v${c.version} created locally, but the push failed: ${p.err.split('\n')[0]}` };
    }
    if (ps.releaseCommand) {
      const r = await exec('/bin/sh', ['-c', ps.releaseCommand], { cwd: dir, timeoutMs: 30 * 60000, env: { ...process.env, HEARTH_RELEASE_VERSION: c.version } });
      return r.ok ? { ok: true, message: `Release command finished for v${c.version}.`, log: redact(r.out).slice(-4000) } : { ok: false, message: `Release command failed: ${redact(r.err).split('\n').slice(-2).join(' ')}` };
    }
    if (!(await workspace.git(dir, ['cat-file', '-e', `${ref}:.github/workflows/release.yml`])).ok || !repo) return { ok: false, message: 'This project has no release path (no .github/workflows/release.yml and no release command on the Project page).' };
    const d = await ghApi(['-X', 'POST', `repos/${repo.owner}/${repo.repo}/actions/workflows/release.yml/dispatches`, '-f', `ref=${def}`]);
    return d.ok ? { ok: true, dispatched: true, message: `Started the release workflow for v${c.version} on ${def}. Progress is shown here as it runs.`, url: `https://github.com/${repo.owner}/${repo.repo}/actions/workflows/release.yml` } : { ok: false, message: `Couldn't start the release workflow: ${d.err.split('\n')[0]}` };
  });
  handle('ops:releaseStatus', async (version) => {
    const repo = await ghRepo();
    if (!repo) return { ok: false };
    const ver = String(version || '').replace(/^v/, '');
    const runs = await ghApi(['-X', 'GET', `repos/${repo.owner}/${repo.repo}/actions/workflows/release.yml/runs`, '-f', 'per_page=1']);
    let run = null;
    try { const j = JSON.parse(runs.out).workflow_runs?.[0]; if (j) run = { status: j.status, conclusion: j.conclusion, url: j.html_url }; } catch {}
    const rel = await ghApi([`repos/${repo.owner}/${repo.repo}/releases/tags/v${ver}`]);
    let url = null;
    try { url = rel.ok ? JSON.parse(rel.out).html_url : null; } catch {}
    return { ok: true, run, released: rel.ok, url };
  });

  // HEARTH_AI_ASSETS: <workspace>/.hearth-ai/assets/<agent>/, one folder per AI so names never clash.
  const assetsEnv = (agent, cwd) => {
    if (!cwd || !/^[a-z]+$/.test(String(agent))) return undefined;
    const dir = path.join(cwd, '.hearth-ai', 'assets', agent);
    try { fs.mkdirSync(dir, { recursive: true }); } catch { return undefined; }
    // Never shows up in git status of the project folder (local exclude, not committed).
    try {
      const ex = path.join(cwd, '.git', 'info', 'exclude');
      if (fs.existsSync(path.dirname(ex)) && !(fs.existsSync(ex) && /^\.hearth-ai\/$/m.test(fs.readFileSync(ex, 'utf8')))) fs.appendFileSync(ex, '\n.hearth-ai/\n');
    } catch {}
    // ...and every AI commits as the owner (GIT_AUTHOR_*/GIT_COMMITTER_*).
    return { HEARTH_AI_ASSETS: dir, ...identity.gitEnv(applyIdentity()) };
  };

  // ---- projects ----
  const listProjects = () => {
    const reg = projects.get();
    return { active: reg.active, list: reg.list.map((p) => ({ ...p, dir: p.id === reg.active ? projectDir() || p.dir : p.dir })) };
  };
  handle('ops:projects', () => listProjects());
  handle('ops:projectAdd', async (kind, input) => {
    let dir = null;
    if (kind === 'clone') {
      const r = await gitops.clone(String(input || ''), path.join(os.homedir(), 'HearthProjects'));
      if (!r.ok) return r;
      dir = r.dir;
    } else {
      const r = await dialog.showOpenDialog(getWindow(), { title: 'Add a project folder (a git repository)', properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
      dir = r.filePaths[0];
      if (!(await workspace.isRepo(dir))) return { ok: false, message: `${dir} isn't a git repository yet. Start tracking it with git first (Settings › Project folder offers that).` };
    }
    const p = projects.add({ dir });
    return { ok: true, project: p, ...listProjects() };
  });
  // Switching: the current project keeps its folder; the new one's board, chat and folder load.
  handle('ops:projectSwitch', (id) => {
    const cur = active();
    const target = projects.byId(String(id));
    if (!target) throw new Error('Unknown project.');
    projects.setDir(cur.id, projectDir());
    projects.switchTo(target.id);
    setStore(projects.stateFile(target.id));
    if (target.dir) useProject(target.dir);
    return { ok: true, ...listProjects() };
  });
  handle('ops:projectRename', (id, name) => { projects.rename(String(id), name); return listProjects(); });
  handle('ops:projectSettings', (patch) => { projects.setSettings(active().id, patch); return listProjects(); });

  // ---- project memory ----
  handle('ops:memoryGet', async (decisions) => {
    const file = memFile();
    if (!file) return { ok: false, message: 'Pick a project folder first.' };
    let seeded = false;
    if (!fs.existsSync(file)) {
      const ls = await workspace.git(projectDir(), ['ls-tree', '--name-only', 'HEAD']);
      const layout = ls.ok ? ls.out.split('\n').filter(Boolean).slice(0, 40) : [];
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, memory.seed({ name: active().name, layout, decisions: (Array.isArray(decisions) ? decisions : []).map((x) => String(x).slice(0, 200)) }));
      seeded = true;
      // Keep it out of `git status` (local exclude only; never committed for you).
      try {
        const ex = path.join(projectDir(), '.git', 'info', 'exclude');
        if (fs.existsSync(path.dirname(ex)) && !(fs.existsSync(ex) && /^\.hearth-ai\/$/m.test(fs.readFileSync(ex, 'utf8')))) fs.appendFileSync(ex, '\n.hearth-ai/\n');
      } catch {}
    }
    return { ok: true, file, text: readMemory(), seeded };
  });
  handle('ops:memorySave', (text) => {
    const file = memFile();
    if (!file) return { ok: false, message: 'Pick a project folder first.' };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, redact(String(text || '')).slice(0, 100000));
    return { ok: true, text: readMemory() };
  });
  // Only from the owner's Approve on a lead proposal card.
  handle('ops:memoryApply', (proposal) => {
    const file = memFile();
    if (!file) return { ok: false, message: 'Pick a project folder first.' };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, memory.applyProposal(readMemory(), redact(String(proposal || ''))));
    return { ok: true, text: readMemory() };
  });

  // ---- the app's own test run ----
  handle('ops:testRun', async (taskId, sha) => {
    const dir = taskDir(String(taskId));
    if (!fs.existsSync(dir)) return { status: 'not run', log: 'This task has no workspace.', command: null };
    const command = tests.resolveTestCommand(active().settings.testCommand, dir);
    if (!command) return { status: 'not run', log: 'No test command for this project (set one on the Project page).', command: null };
    const head = (await workspace.git(dir, ['rev-parse', 'HEAD'])).out;
    if (typeof sha === 'string' && /^[0-9a-f]{7,40}$/.test(sha) && !head.startsWith(sha)) return { status: 'not run', log: `The worktree is at ${head.slice(0, 7)}, not the reported commit ${sha.slice(0, 7)}.`, command };
    testRuns.get(taskId)?.abort();
    const controller = new AbortController();
    testRuns.set(taskId, controller);
    try {
      const r = await tests.runTests({ command, cwd: dir, timeoutMs: active().settings.testTimeoutMin * 60000, signal: controller.signal });
      if (/^npm /.test(command) && !fs.existsSync(path.join(dir, 'node_modules'))) r.log = `Note: this worktree has no node_modules. If the tests need dependencies, set the test command to e.g. "npm ci && npm test".\n${r.log}`;
      return { ...r, log: redact(r.log), sha: head };
    } finally {
      if (testRuns.get(taskId) === controller) testRuns.delete(taskId);
    }
  });
  handle('ops:testCancel', (taskId) => { testRuns.get(String(taskId))?.abort(); return true; });

  // ---- CI watch (GitHub Actions via gh REST) ----
  const ciSeen = new Map(); // runId -> failure details
  const repoOf = async () => {
    const dir = projectDir();
    if (!dir) return null;
    const r = await workspace.git(dir, ['remote', 'get-url', 'origin']);
    return r.ok ? ci.parseRemote(r.out) : null;
  };
  handle('ops:ciPoll', async (branches) => {
    if (!active().settings.ciWatch) return { ok: false, off: true, results: [] };
    const repo = await repoOf();
    if (!repo || !gh()) return { ok: false, message: 'No GitHub remote or gh sign-in.', results: [] };
    const results = [];
    for (const b of (Array.isArray(branches) ? branches : []).filter(ci.safeBranch).slice(0, 30)) {
      const r = await ghApi(['-X', 'GET', `repos/${repo.owner}/${repo.repo}/actions/runs`, '-f', `branch=${b}`, '-f', 'per_page=10']);
      if (!r.ok) continue;
      let j = null;
      try { j = JSON.parse(r.out); } catch { continue; }
      const agg = ci.aggregate(j.workflow_runs);
      const out = { branch: b, state: agg.state, sha: agg.sha, runs: agg.runs, runId: agg.failedRun?.id || agg.runs[0]?.id || null, url: agg.failedRun?.url || agg.runs[0]?.url || null };
      if (agg.state === 'failure' && agg.failedRun) {
        if (!ciSeen.has(agg.failedRun.id)) {
          const jr = await ghApi([`repos/${repo.owner}/${repo.repo}/actions/runs/${agg.failedRun.id}/jobs`]);
          let job = null;
          try { job = ci.failedJob(JSON.parse(jr.out)); } catch {}
          let tail = '';
          if (job) {
            const lr = await ghApi([`repos/${repo.owner}/${repo.repo}/actions/jobs/${job.id}/logs`], 60000);
            tail = lr.ok ? ci.logTail(lr.out) : '';
          }
          ciSeen.set(agg.failedRun.id, { job, tail: redact(tail), workflow: agg.failedRun.name });
        }
        Object.assign(out, ciSeen.get(agg.failedRun.id));
      }
      results.push(out);
    }
    return { ok: true, repo: `${repo.owner}/${repo.repo}`, results };
  });

  // ---- Hearth logs ----
  const seenFile = () => path.join(dataDir(), 'ops-logs-seen.json');
  const readSeen = () => { try { return JSON.parse(fs.readFileSync(seenFile(), 'utf8')); } catch { return {}; } };
  handle('ops:logsPoll', async () => {
    const s = active().settings;
    if (!s.logsOn || !s.logsRepo) return { ok: false, off: true, created: [] };
    if (!gh()) return { ok: false, message: 'GitHub CLI (gh) is not installed.', created: [] };
    const top = await ghApi([`repos/${s.logsRepo}/contents/logs`]);
    if (!top.ok) return { ok: false, message: `Couldn't read ${s.logsRepo}: ${top.err.split('\n')[0]}`, created: [] };
    let dates = [];
    try { dates = logs.recentDates(JSON.parse(top.out)); } catch {}
    const paths = [];
    for (const date of dates) {
      const r = await ghApi([`repos/${s.logsRepo}/contents/logs/${date}`]);
      try { for (const f of JSON.parse(r.out)) if (f.type === 'file') paths.push(f.path); } catch {}
    }
    const all = readSeen();
    const key = `${active().id}:${s.logsRepo}`;
    const baseline = !Array.isArray(all[key]);
    const seen = new Set(all[key] || []);
    const fresh = logs.newLogs(seen, paths);
    const created = [];
    if (!baseline) {
      for (const l of fresh.slice(0, 10)) {
        const r = await ghApi(['-H', 'Accept: application/vnd.github.raw', `repos/${s.logsRepo}/contents/${l.path}`], 60000);
        if (!r.ok) continue;
        const text = redact(r.out.slice(0, 1024 * 1024));
        const dir = path.join(dataDir(), 'hearth-logs', s.logsRepo.replace('/', '_'), l.date);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const file = path.join(dir, `${l.code}.txt`);
        fs.writeFileSync(file, text, { mode: 0o600 });
        created.push({ ...l, file, summary: logs.summarizeLog(text), excerpt: text.slice(0, 4000) });
        seen.add(l.path);
      }
    } else for (const l of fresh) seen.add(l.path);
    all[key] = [...seen].slice(-5000);
    fs.writeFileSync(seenFile(), JSON.stringify(all), { mode: 0o600 });
    return { ok: true, repo: s.logsRepo, baseline, skipped: baseline ? fresh.length : 0, created };
  });

  // ---- voice notes (local transcription only) ----
  const voiceTools = () => voice.detect({ find: gitops.find, list: voice.listDir });
  handle('ops:voiceTools', () => voiceTools());
  handle('ops:voiceSave', async (data) => {
    const buf = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data || []);
    if (!buf.length || buf.length > 50 * 1024 * 1024) return { ok: false, message: 'Voice note is empty or too long.' };
    const dir = attachments.attachDir(worktreeRoot());
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = crypto.randomBytes(5).toString('hex');
    const file = path.join(dir, `${id}-voice-note.webm`);
    fs.writeFileSync(file, buf, { mode: 0o600 });
    const att = { id, kind: 'audio', name: 'voice-note.webm', size: buf.length, path: file, url: pathToFileURL(file).href };
    const tool = voiceTools();
    if (!tool.tool) return { ok: true, att, transcript: '', note: tool.missing };
    const env = tests.cleanEnv(process.env, os.tmpdir());
    try {
      if (tool.tool === 'whisper.cpp') {
        const ffmpeg = gitops.find('ffmpeg');
        if (!ffmpeg) return { ok: true, att, transcript: '', note: 'transcription unavailable: install ffmpeg (whisper.cpp needs a WAV file)' };
        const wav = path.join(os.tmpdir(), `hearth-voice-${id}.wav`);
        const c = await exec(ffmpeg, ['-y', '-i', file, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeoutMs: 60000, env });
        if (!c.ok) return { ok: true, att, transcript: '', note: 'transcription unavailable: ffmpeg could not read the recording' };
        const r = await exec(tool.bin, voice.cppArgs(tool.model, wav), { timeoutMs: 180000, env });
        try { fs.unlinkSync(wav); } catch {}
        const text = voice.cleanTranscript(r.out);
        return { ok: true, att, transcript: text, note: text ? '' : 'transcription came back empty' };
      }
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-voice-'));
      const r = await exec(tool.bin, voice.pyArgs(file, out), { timeoutMs: 300000, env: { ...env, HOME: os.homedir() } });
      let text = '';
      try { text = voice.cleanTranscript(fs.readFileSync(path.join(out, `${path.basename(file, '.webm')}.txt`), 'utf8')); } catch {}
      fs.rmSync(out, { recursive: true, force: true });
      return { ok: true, att, transcript: text, note: text ? '' : `transcription failed: ${r.err.split('\n').slice(-1)[0] || 'no text'}` };
    } catch (e) {
      return { ok: true, att, transcript: '', note: `transcription failed: ${e.message}` };
    }
  });

  // ---- CLI usage (agy answers /usage) ----
  handle('ops:usage', async (agent) => {
    if (agent !== 'google') return { ok: false, message: 'This tool reports no usage numbers.' };
    const file = agents.findBinary('google', readSettings().bins.google);
    if (!file || !agents.isAgy(file)) return { ok: false, message: 'Only the Antigravity CLI (agy) reports usage.' };
    const r = await agents.run(file, ['-p', '/usage', '--output-format', 'json'], { timeoutMs: 30000 });
    const parsed = agents.parseGemini(r.out);
    const u = usage.parseUsage(`${parsed.text || ''}\n${r.out}`);
    return { ok: u.usedPct !== null, ...u, at: new Date().toISOString() };
  });

  // ---- phone view ----
  let phoneSnap = null;
  phone = createPhone({ file: path.join(dataDir(), 'ops-phone.json'), getSnapshot: () => phoneSnap, onAction: (a) => send('ops:phoneAction', a) });
  handle('ops:phoneStatus', () => phone.status());
  handle('ops:phoneEnable', () => phone.enable());
  handle('ops:phoneDisable', () => phone.disable());
  handle('ops:phoneNewCode', () => phone.newCode());
  handle('ops:phoneForget', () => phone.forget());
  handle('ops:phoneRemove', (id) => phone.removeDevice(String(id)));
  handle('ops:phonePush', (snap) => { if (snap && typeof snap === 'object') phoneSnap = JSON.parse(redact(JSON.stringify(snap)).slice(0, 2e6)); return true; });
  phone.boot();

  // ---- this computer (Local AI model fit) and Ollama models ----
  handle('ops:hardware', async () => {
    const nv = gitops.find('nvidia-smi');
    const r = nv ? await exec(nv, ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], { timeoutMs: 8000 }) : { out: '' };
    return media.parseHardware({ totalBytes: os.totalmem(), nvidiaMiB: r.ok ? r.out : '', amdVramBytes: media.readAmdVram() });
  });
  const TAG = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)?(:[A-Za-z0-9._-]+)?$/;
  // Download: `ollama pull` in a visible terminal (routine, no approval).
  handle('ops:ollamaPull', (tag) => {
    if (!TAG.test(String(tag || ''))) return { ok: false, message: 'That isn\'t an Ollama model name.' };
    const bin = gitops.find('ollama');
    if (!bin) return { ok: false, message: 'Ollama is not installed.' };
    return agents.openTerminal(bin, ['pull', String(tag)], os.homedir(), { hold: true });
  });
  // Remove: only after the owner confirmed in the window.
  handle('ops:ollamaRemove', async (tag) => {
    if (!TAG.test(String(tag || ''))) return { ok: false, message: 'That isn\'t an Ollama model name.' };
    const bin = gitops.find('ollama');
    if (!bin) return { ok: false, message: 'Ollama is not installed.' };
    const r = await exec(bin, ['rm', String(tag)], { timeoutMs: 60000 });
    return r.ok ? { ok: true } : { ok: false, message: r.err.split('\n')[0] };
  });

  // ---- upscaling an image attachment (Real-ESRGAN, or ffmpeg as a basic resize) ----
  handle('ops:upscaleTools', () => ({ esrgan: media.findEsrgan(gitops.find, dataDir()), ffmpeg: gitops.find('ffmpeg') }));
  handle('ops:upscale', async (file, target) => {
    const h = media.TARGETS[String(target)];
    const root = attachments.attachDir(worktreeRoot());
    if (!h || typeof file !== 'string' || !attachments.inside(file, [root])) return { ok: false, message: 'Only attachments can be upscaled.' };
    const esr = media.findEsrgan(gitops.find, dataDir());
    const ff = gitops.find('ffmpeg');
    const out = path.join(os.tmpdir(), `hearth-up-${crypto.randomBytes(4).toString('hex')}`);
    const final = `${out}-${target}.png`;
    let method = null;
    if (esr) {
      const r = await exec(esr, media.esrganArgs(file, `${out}-x4.png`), { timeoutMs: 600000 });
      if (r.ok && fs.existsSync(`${out}-x4.png`)) {
        if (ff && (await exec(ff, media.ffmpegScaleArgs(`${out}-x4.png`, final, h), { timeoutMs: 120000 })).ok) method = 'Real-ESRGAN';
        else { fs.renameSync(`${out}-x4.png`, final); method = 'Real-ESRGAN (4x)'; }
      }
    }
    if (!method && ff && (await exec(ff, media.ffmpegScaleArgs(file, final, h), { timeoutMs: 120000 })).ok) method = 'basic resize (not AI upscaling)';
    try { fs.rmSync(`${out}-x4.png`, { force: true }); } catch {}
    if (!method) return { ok: false, message: 'Install Real-ESRGAN (button in the chat) or ffmpeg to upscale.' };
    const base = path.basename(file).replace(/^[0-9a-f]{10}-/, '').replace(/\.\w+$/, '');
    const saved = attachments.saveFromPath(worktreeRoot(), final, {});
    try { fs.rmSync(final, { force: true }); } catch {}
    if (!saved.ok) return saved;
    const att = { ...saved.att, name: `${base}-${target}.png`, url: pathToFileURL(saved.att.path).href, ...media.imageInfo(saved.att.path) };
    return { ok: true, att, method };
  });
  // One-click Real-ESRGAN from its official GitHub release, into the app's own folder (no root).
  handle('ops:esrganInstall', async () => {
    const unzip = gitops.find('unzip');
    if (!unzip) return { ok: false, message: 'unzip is needed to unpack Real-ESRGAN.' };
    const rel = await fetch(`https://api.github.com/repos/${media.ESRGAN_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } }).then((r) => r.json()).catch(() => null);
    const asset = media.pickEsrganAsset(rel);
    if (!asset || !/^https:\/\/github\.com\//.test(asset.url)) return { ok: false, message: 'No Linux build found in the latest Real-ESRGAN release.' };
    const res = await fetch(asset.url).catch(() => null);
    if (!res?.ok) return { ok: false, message: 'Download failed.' };
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (asset.sha256 && sha !== asset.sha256) return { ok: false, message: 'Checksum mismatch; nothing was installed.' };
    const dir = media.toolsDir(dataDir());
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const zip = path.join(dir, asset.name);
    fs.writeFileSync(zip, buf);
    const u = await exec(unzip, ['-o', '-j', zip, '-d', dir], { timeoutMs: 120000 });
    fs.rmSync(zip, { force: true });
    if (!u.ok) return { ok: false, message: `Unpacking failed: ${u.err.split('\n')[0]}` };
    try { fs.chmodSync(path.join(dir, 'realesrgan-ncnn-vulkan'), 0o755); } catch {}
    return { ok: Boolean(media.findEsrgan(() => null, dataDir())), verified: Boolean(asset.sha256), sha256: sha, message: asset.sha256 ? 'Installed; checksum verified.' : 'Installed; the release publishes no checksum, so it could not be verified.' };
  });

  // ---- background jobs (survive turns and restarts) ----
  const jobs = createJobs({
    dir: path.join(dataDir(), 'jobs'),
    spawnRunner: (jobFile) => {
      const child = spawn(process.execPath, [path.join(__dirname, 'job-runner.cjs'), jobFile], { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      child.unref();
      return child.pid;
    },
  });
  handle('ops:jobs', () => jobs.list());
  handle('ops:jobCancel', (id) => jobs.cancel(String(id)));
  handle('ops:jobStart', (spec) => {
    if (!spec || typeof spec !== 'object') throw new Error('bad job');
    const s = readSettings();
    let cwd = s.project || os.homedir();
    let mode = 'read';
    const tid = typeof spec.taskId === 'string' ? spec.taskId : null;
    let base = null;
    try {
      if (tid && fs.existsSync(taskDir(tid))) { cwd = taskDir(tid); mode = s.access; base = tid; }
      else if (fs.existsSync(taskDir('CHATROOM'))) { cwd = taskDir('CHATROOM'); mode = s.access; base = 'CHATROOM'; } // the team chat's own worktree
    } catch {}
    const agent = String(spec.agent || '');
    return jobs.start({
      agent, base, kind: String(spec.kind || 'job').slice(0, 20), title: String(spec.title || '').slice(0, 200), taskId: tid, requestId: typeof spec.requestId === 'string' ? spec.requestId.slice(0, 20) : null,
      prompt: memory.withMemory(String(spec.prompt || '').slice(0, 20000), readMemory()), cwd, mode, bin: s.bins[agent], extraDirs: s.extraDirs, extraEnv: assetsEnv(agent, cwd),
    });
  });

  // Helpers for main.cjs.
  return {
    assetsEnv: (agent, cwd) => assetsEnv(agent, cwd),
    imageInfo: (file) => media.imageInfo(file),
    withMemory: (prompt) => memory.withMemory(prompt, readMemory()),
    // Stall watchdog for an editing run in a task worktree.
    watchdog(cwd, onStall) {
      const idleMs = active().settings.stallMin * 60000;
      if (!idleMs || !cwd) return null;
      return createWatchdog({
        idleMs,
        onStall,
        probe: async () => {
          const a = await workspace.git(cwd, ['status', '--porcelain']);
          const b = await workspace.git(cwd, ['diff', 'HEAD', '--shortstat']);
          const c = await workspace.git(cwd, ['rev-parse', 'HEAD']);
          return `${a.out}|${b.out}|${c.out}`;
        },
      });
    },
    stallMinutes: () => active().settings.stallMin,
    stop() { for (const c of testRuns.values()) c.abort(); phone?.stop(); },
  };
}

module.exports = { register, stateFile };

// Team ops in the main process: projects, project memory, the app's own test runs,
// stall watchdog, CI watch, Hearth logs, voice notes, phone view, CLI usage.
// main.cjs calls register() once and uses the few helpers it returns.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');
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
const wfgit = require('./workflow.cjs');
const gate = require('./gate.cjs');

function exec(file, args, { cwd, timeoutMs = 60000, env, maxBuffer = 16 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, timeout: timeoutMs, maxBuffer, env: env || { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' } }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: String(stdout), err: String(stderr).trim() || (error ? error.message : '') });
    });
  });
}

let projects = null;
const activeCwds = new Set(); // worktrees with a normal editing run right now
// At most 1 running background job per AI and 3 overall.
function jobLimits(list, agent) {
  const running = list.filter((j) => j.status === 'running');
  if (running.filter((j) => j.agent === agent).length >= 1) return { ok: false, reason: `${agent} already has a background job running` };
  if (running.length >= 3) return { ok: false, reason: '3 background jobs are already running' };
  return { ok: true };
}
const jobMode = ({ requested, canEdit, busy }) => (canEdit && !busy ? requested : 'read');
let phone = null;
const testRuns = new Map(); // taskId -> AbortController

// Which state file the app should open (before the window exists).
function stateFile(dataDir, legacyDir, legacyList = []) {
  projects = projects || createProjects(dataDir);
  const reg = projects.load(legacyDir, legacyList);
  return projects.stateFile(reg.active);
}

function register(d) {
  const { settingsDisk, handle, dataDir, readSettings, useProject, setStore, taskDir, worktreeRoot, gitops, workspace, agents, attachments, redact, send, dialog, getWindow } = d;
  const hearthOf = typeof d.hearth === 'function' ? d.hearth : () => d.hearth || null;
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
  // .hearth-ai/ in the repo's shared exclude file (git rev-parse --git-path info/exclude).
  const excludeAppDir = (dir) => {
    try {
      const rel = execFileSync(gitops.find('git') || 'git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: dir, encoding: 'utf8', timeout: 10000 }).trim();
      const ex = path.resolve(dir, rel);
      fs.mkdirSync(path.dirname(ex), { recursive: true });
      if (!(fs.existsSync(ex) && /^\/?\.hearth-ai\/?$/m.test(fs.readFileSync(ex, 'utf8')))) fs.appendFileSync(ex, '\n.hearth-ai/\n');
      return ex;
    } catch { return null; }
  };
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
  // Marks git commands run by the app and its AIs (the attribution hook only acts on those).
  process.env.HEARTH_AI_APP = '1';
  handle('ops:identityDefault', async () => {
    const dir = projectDir() || os.homedir();
    const [n, e] = await Promise.all([workspace.git(dir, ['config', 'user.name']), workspace.git(dir, ['config', 'user.email'])]);
    // Suggestions only: the owner confirms them; nothing is saved here.
    return { saved: ownerId(), suggested: identity.suggestIdentity(n.out, e.out) };
  });
  handle('ops:identityApply', () => applyIdentity());
  // from = null scans the whole history up to `to`.
  const range = async (dir, from, to) => (await workspace.git(dir, ['log', identity.LOG_FORMAT, from ? `${from}..${to}` : to, '-n', from ? '2000' : '20000'], { timeoutMs: 120000 })).out;
  // For releases and tags: what main gained since the last release tag (else the whole history).
  const releaseFrom = async (dir, sha) => (await workspace.git(dir, ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', sha])).out || null;
  const baseOf = async (dir) => {
    const def = await gitops.defaultBranch(dir);
    return (await workspace.git(dir, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${def}`])).ok ? `origin/${def}` : def;
  };
  // The guard before any push, merge to main, release or tag.
  async function guard(dir, from, to, what, opts = {}) {
    const id = applyIdentity();
    const r = identity.scanCommits(identity.parseLog(await range(dir, from, to)), id, opts);
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
  // The owner's own Release button: only commits someone else authored stop it.
  wrap(gitops, 'releaseCreate', async (orig, dir, o) => (await guard(dir, await releaseFrom(dir, o.target), o.target, 'released', { ownerRelease: true })) || orig(dir, o));
  wrap(gitops, 'updateFromMain', async (orig, ...a) => { applyIdentity(); return orig(...a); });
  wrap(workspace, 'checkpoint', async (orig, ...a) => { applyIdentity(); return orig(...a); });
  // New task worktrees: the owner as local user, and hooks that strip AI attribution.
  wrap(workspace, 'ensureWorktree', async (orig, o) => {
    const id = applyIdentity();
    const r = await orig(o);
    try {
      if (id) { await workspace.git(r.dir, ['config', 'user.name', id.name]); await workspace.git(r.dir, ['config', 'user.email', id.email]); }
      // .hearth-ai/ goes in the shared exclude file, never the tracked .gitignore.
      excludeAppDir(r.dir);
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
    // Always the owner's confirmation, also when the lead asked for it (REWRITE: T-…).
    if (dialog.showMessageBoxSync(getWindow(), { type: 'warning', message: `Rewrite ${commits.length} commit(s) on ${branch} as ${id.name}?`, detail: `${byLead === true ? 'The lead asked for this. ' : ''}Only this task branch changes; nothing has been pushed from it. AI attribution lines are removed.`, buttons: ['Rewrite', 'Cancel'], defaultId: 1, cancelId: 1 }) !== 0) return { ok: false, message: 'Cancelled.' };
    const hook = path.join(dataDir(), 'strip-attribution.sh');
    fs.writeFileSync(hook, identity.hookScript(), { mode: 0o700 });
    const msg = path.join(os.tmpdir(), `hearth-msg-${crypto.randomBytes(4).toString('hex')}`);
    const r = await exec(gitops.find('git') || 'git', ['rebase', '-q', '--exec', identity.REWRITE_EXEC, base], { cwd: dir, timeoutMs: 300000, env: identity.rewriteEnv(process.env, msg, hook) });
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
  handle('ops:leadRelease', (kind, version) => releaseOrTag(kind, version, null));
  // "Claude can do everything I can": a release or tag Claude asked for and the owner
  // allowed. Still only the owner's Next version, the version file, the gate and the guard;
  // and a native confirmation here (it can't be undone), so the window alone can't start one.
  handle('ops:actRelease', async (kind, version, request) => {
    const s = readSettings();
    if (s.actForMe !== true) return { ok: false, message: '"Claude can do everything I can" is off.' };
    const ps = active().settings;
    const ver = String(version || '').replace(/^v/, '');
    if (!request || request.projectId !== active().id || request.version !== ver || ps.nextVersion !== ver) return { ok: false, message: `Only your Next version for this project (${ps.nextVersion ? `v${ps.nextVersion}` : 'not set'}) can be released or tagged.` };
    const k = kind === 'tag' ? 'tag' : 'release';
    const ok = dialog.showMessageBoxSync(getWindow(), { type: 'warning', message: `${k === 'tag' ? 'Tag' : 'Release'} v${ver} of ${active().name}?`, detail: `Claude asked for this and you allowed it (request ${String(request.id || '').slice(0, 10)}).\nIt uses the release gate for the exact commit on main and can't be undone.`, buttons: [k === 'tag' ? 'Tag now' : 'Release now', 'Cancel'], defaultId: 1, cancelId: 1 });
    if (ok !== 0) return { ok: false, message: 'Cancelled.' };
    return releaseOrTag(k, ver, { owner: true });
  });
  async function releaseOrTag(kind, version, viaOwner) {
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
    // The owner's own yes stands in for the lead switches; every other check is the same.
    const c = release.checkLead({ kind: k, leadActions: viaOwner?.owner ? true : s.leadActions, switchOn: viaOwner?.owner ? true : (k === 'tag' ? s.leadTag : s.leadRelease), requested: version, next: ps.nextVersion, fileVer: release.fileVersion(ps.versionFile, file), exists });
    if (!c.ok) return { ok: false, message: c.reason };
    // Releasing and tagging always ask the owner: the lead's switches only let it ask.
    if (!viaOwner?.owner) {
      const yes = dialog.showMessageBoxSync(getWindow(), { type: 'warning', message: `The lead asks: ${k === 'tag' ? 'tag' : 'release'} v${c.version}?`, detail: 'Your "Lead may publish releases / create tags" switch lets the lead ask; only your yes here does it. It can\'t be undone.', buttons: [k === 'tag' ? 'Tag now' : 'Release now', 'Cancel'], defaultId: 1, cancelId: 1 });
      if (yes !== 0) return { ok: false, cancelled: true, message: 'Cancelled.' };
    }
    const sha = (await workspace.git(dir, ['rev-parse', ref])).out;
    // The release gate: the checklist passed for exactly this commit (or the Owner overrode it).
    // (fetched above, so ref is GitHub's main right now)
    const rg = releaseGateFor(c.version, sha);
    if (!rg.ok) return { ok: false, message: `Not ${k === 'tag' ? 'tagged' : 'released'}: ${rg.reason}.` };
    const g = await guard(dir, await releaseFrom(dir, sha), sha, k === 'tag' ? 'tagged' : 'released');
    if (g) return g;
    if (k === 'tag') {
      const t = await workspace.git(dir, release.tagArgs(c.version, sha));
      if (!t.ok) return { ok: false, message: `Tag failed: ${t.err.split('\n')[0]}` };
      const p = await workspace.git(dir, release.pushTagArgs(c.version), { timeoutMs: 120000 });
      return p.ok ? { ok: true, message: `Tagged ${sha.slice(0, 7)} as v${c.version} and pushed the tag.`, sha } : { ok: false, message: `Tag v${c.version} created locally, but the push failed: ${p.err.split('\n')[0]}` };
    }
    if (ps.releaseCommand) {
      // Runs in a clean worktree at exactly the gated commit, never the local checkout.
      const tmp = path.join(os.tmpdir(), `hearth-relcmd-${crypto.randomBytes(4).toString('hex')}`);
      const add = await workspace.git(dir, ['worktree', 'add', '--detach', tmp, sha], { timeoutMs: 120000 });
      if (!add.ok) return { ok: false, message: `Couldn't check out ${sha.slice(0, 7)} for the release command.` };
      try {
        const r = await exec('/bin/sh', ['-c', ps.releaseCommand], { cwd: tmp, timeoutMs: 30 * 60000, env: { ...process.env, HEARTH_RELEASE_VERSION: c.version, HEARTH_RELEASE_SHA: sha } });
        return r.ok ? { ok: true, message: `Release command finished for v${c.version} at ${sha.slice(0, 7)}.`, log: redact(r.out).slice(-4000) } : { ok: false, message: `Release command failed: ${redact(r.err).split('\n').slice(-2).join(' ')}` };
      } finally { await workspace.git(dir, ['worktree', 'remove', '--force', tmp]); }
    }
    if (!(await workspace.git(dir, ['cat-file', '-e', `${ref}:.github/workflows/release.yml`])).ok || !repo) return { ok: false, message: 'This project has no release path (no .github/workflows/release.yml and no release command on the Project page).' };
    // The workflow builds main's head: re-check right before dispatch that it is still the gated commit.
    const now = await ghApi([`repos/${repo.owner}/${repo.repo}/commits/${def}`, '--jq', '.sha']);
    if (!now.ok || now.out.trim() !== sha) return { ok: false, message: `Not released: ${def} on GitHub is ${now.ok ? now.out.trim().slice(0, 7) : 'unreadable'}, not the gated ${sha.slice(0, 7)}. Run the release preview again.` };
    const d = await ghApi(['-X', 'POST', `repos/${repo.owner}/${repo.repo}/actions/workflows/release.yml/dispatches`, '-f', `ref=${def}`]);
    return d.ok ? { ok: true, dispatched: true, message: `Started the release workflow for v${c.version} on ${def}. Progress is shown here as it runs.`, url: `https://github.com/${repo.owner}/${repo.repo}/actions/workflows/release.yml` } : { ok: false, message: `Couldn't start the release workflow: ${d.err.split('\n')[0]}` };
  }
  handle('ops:releaseStatus', async (version, since) => {
    const repo = await ghRepo();
    if (!repo) return { ok: false };
    const ver = String(version || '').replace(/^v/, '');
    // Only the run this dispatch started: event workflow_dispatch, created after it was sent.
    const after = typeof since === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(since) ? since : null;
    const runs = await ghApi(['-X', 'GET', `repos/${repo.owner}/${repo.repo}/actions/workflows/release.yml/runs`, '-f', 'event=workflow_dispatch', '-f', 'per_page=5', ...(after ? ['-f', `created=>=${after.slice(0, 19)}Z`] : [])]);
    let run = null;
    try { const j = pickDispatchRun(JSON.parse(runs.out).workflow_runs, after); if (j) run = { status: j.status, conclusion: j.conclusion, url: j.html_url }; } catch {}
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
    excludeAppDir(cwd); // never shows up in git status (shared exclude file, not committed)
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
    setStore(projects.stateFile(target.id), target.id);
    if (target.dir) useProject(target.dir);
    return { ok: true, ...listProjects() };
  });
  handle('ops:projectRename', (id, name) => { projects.rename(String(id), name); return listProjects(); });
  handle('ops:projectSettings', (patch) => {
    try { projects.setSettings(active().id, patch); } catch (e) { return { ok: false, message: String(e.message || e) }; }
    return listProjects();
  });

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
    const base = await baseOf(dir);
    const basePkg = await workspace.git(dir, ['show', `${base}:package.json`]);
    const command = tests.resolveTestCommand(active().settings.testCommand, dir, basePkg.ok ? basePkg.out : '');
    const changed = (await workspace.git(dir, ['diff', '--name-only', `${base}...HEAD`])).out.split('\n').filter(Boolean);
    const headPkg = await workspace.git(dir, ['show', 'HEAD:package.json']);
    const testsChanged = tests.testConfigChanges(changed, basePkg.ok ? basePkg.out : '', headPkg.ok ? headPkg.out : '');
    if (!command) return { status: 'not run', log: 'No test command for this project (set one on the Project page).', command: null, testsChanged };
    const head = (await workspace.git(dir, ['rev-parse', 'HEAD'])).out;
    // No dependencies installed: "not run", not "failed", so the AI doesn't loop on it.
    if (tests.needsDeps(command, dir)) return { status: 'not run', reason: 'no dependencies installed', log: 'Not run: this worktree has no node_modules. Set the test command to e.g. "npm ci && npm test" on the Project page to install them first.', command, testsChanged, sha: head };
    if (typeof sha === 'string' && /^[0-9a-f]{7,40}$/.test(sha) && !head.startsWith(sha)) return { status: 'not run', log: `The worktree is at ${head.slice(0, 7)}, not the reported commit ${sha.slice(0, 7)}.`, command };
    testRuns.get(taskId)?.abort();
    const controller = new AbortController();
    testRuns.set(taskId, controller);
    try {
      const r = await tests.runTests({ command, cwd: dir, timeoutMs: active().settings.testTimeoutMin * 60000, signal: controller.signal });
      return { ...r, reason: r.cancelled ? 'cancelled' : null, log: tests.redactTokens(redact(r.log)), sha: head, testsChanged };
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

  // ---- voice notes (whisper on this computer, else Speech to text on his Hearth devices) ----
  const voiceTools = () => voice.detect({ find: gitops.find, list: voice.listDir });
  handle('ops:voiceTools', () => voiceTools());
  // 3.7: Install speech to text (the button beside the mic): faster-whisper into ~/.local/share/hearth-ai/whisper.
  let installing = null;
  handle('ops:voiceInstall', async () => {
    if (voiceTools().tool) return { ok: true, already: true };
    if (installing) return installing;
    const proxy = Object.fromEntries(['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy'].filter((k) => typeof process.env[k] === 'string').map((k) => [k, process.env[k]]));
    installing = voice.fwInstall({ run: (bin, args, o) => exec(bin, args, { ...o, env: { ...tests.cleanEnv(process.env, os.tmpdir()), ...proxy, HOME: os.homedir() } }), onStep: (label) => send('ops:voiceInstallStep', label) })
      .catch((e) => ({ ok: false, message: e.message }))
      .finally(() => { installing = null; });
    return installing;
  });
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
    if (!tool.tool) {
      // 3.7: no whisper on this computer: Speech to text on his Hearth devices (the PC's whisper) does it.
      const h = hearthOf();
      if (h?.configured?.()) {
        const r = await h.transcribe({ buf, mime: 'audio/webm' }).catch((e) => ({ ok: false, message: e.message }));
        if (r?.ok) return { ok: true, att, transcript: String(r.text || ''), note: r.text ? '' : 'transcription came back empty' };
        return { ok: true, att, transcript: '', canInstall: true, note: `transcription unavailable: Hearth devices: ${r?.message || 'no Speech to text answered'}` };
      }
      return { ok: true, att, transcript: '', canInstall: true, note: tool.missing };
    }
    const env = tests.cleanEnv(process.env, os.tmpdir());
    try {
      if (tool.tool === 'faster-whisper') {
        const r = await exec(tool.bin, [tool.script, file], { timeoutMs: 300000, env: { ...env, HOME: os.homedir() } });
        const text = voice.cleanTranscript(r.out);
        return { ok: true, att, transcript: text, note: text ? '' : `transcription failed: ${String(r.err || '').split('\n').slice(-1)[0] || 'no text'}` };
      }
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
  handle('ops:phoneHost', (ip) => phone.setHost(String(ip)));
  // Size is checked before parsing; the JSON is never cut in the middle.
  handle('ops:phonePush', (snap) => phonePushData(snap, redact, (v) => { phoneSnap = v; }));
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
      const r = await exec(esr, media.esrganArgs(file, `${out}-x4.png`, esr), { timeoutMs: 600000 });
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
    // Without a published checksum, nothing is installed unless the owner accepts an unverified download.
    if (media.needsConfirm(asset) && dialog.showMessageBoxSync(getWindow(), { type: 'warning', message: 'Unverified download', detail: `The Real-ESRGAN release (${asset.name}) publishes no checksum, so this download can't be verified. Install it anyway?`, buttons: ['Install unverified', 'Cancel'], defaultId: 1, cancelId: 1 }) !== 0) return { ok: false, message: 'Cancelled: unverified download not installed.' };
    const res = await fetch(asset.url).catch(() => null);
    if (!res?.ok) return { ok: false, message: 'Download failed.' };
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (asset.sha256 && sha !== asset.sha256) return { ok: false, message: 'Checksum mismatch; nothing was installed.' };
    // Unpack next to the old install; it is replaced only once the new one is there and runs.
    const dir = media.toolsDir(dataDir());
    const fresh = `${dir}.new`;
    fs.rmSync(fresh, { recursive: true, force: true });
    fs.mkdirSync(fresh, { recursive: true, mode: 0o700 });
    const zip = path.join(fresh, asset.name);
    fs.writeFileSync(zip, buf);
    const u = await exec(unzip, ['-o', zip, '-d', fresh], { timeoutMs: 120000 }); // keeps the models/ folder
    fs.rmSync(zip, { force: true });
    if (!u.ok) { fs.rmSync(fresh, { recursive: true, force: true }); return { ok: false, message: `Unpacking failed: ${u.err.split('\n')[0]}` }; }
    for (const c of [path.join(fresh, 'realesrgan-ncnn-vulkan'), ...fs.readdirSync(fresh).map((d) => path.join(fresh, d, 'realesrgan-ncnn-vulkan'))]) { try { fs.chmodSync(c, 0o755); } catch {} }
    const bin = media.esrganIn(fresh);
    const runs = bin ? await exec(bin, ['-h'], { timeoutMs: 20000 }) : null;
    if (!bin || !runs || !/realesrgan|usage/i.test(`${runs.out}${runs.err}`)) { fs.rmSync(fresh, { recursive: true, force: true }); return { ok: false, message: 'The new Real-ESRGAN did not start; the previous install (if any) is kept.' }; }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(fresh, dir);
    return { ok: Boolean(media.findEsrgan(() => null, dataDir())), verified: Boolean(asset.sha256), sha256: sha, message: asset.sha256 ? 'Installed; checksum verified.' : 'Installed (unverified download, accepted by you).' };
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
    const lim = jobLimits(jobs.list(), agent);
    if (!lim.ok) return { ok: false, message: lim.reason };
    // Read-only unless the turn that asked could edit, and never in a worktree a normal run is using.
    mode = jobMode({ requested: mode, canEdit: spec.canEdit === true, busy: activeCwds.has(cwd) });
    return jobs.start({
      agent, base, kind: String(spec.kind || 'job').slice(0, 20), title: String(spec.title || '').slice(0, 200), taskId: tid, requestId: typeof spec.requestId === 'string' ? spec.requestId.slice(0, 20) : null,
      prompt: memory.withMemory(String(spec.prompt || '').slice(0, 20000), readMemory()), cwd, mode, bin: s.bins[agent], extraDirs: s.extraDirs, extraEnv: assetsEnv(agent, cwd),
      idleMs: active().settings.stallMin * 60000,
    });
  });

  handle('ops:jobRetry', (id) => jobs.retry(String(id)));

  // ---- team workflow: truth card, verified start, run enforcement, sha lock, review packet ----
  const g = (cwd, args, o) => workspace.git(cwd, args, o);
  const taskWs = (id) => { const d = taskDir(String(id || '')); return fs.existsSync(d) ? d : null; };
  const defOf = async () => (projectDir() ? gitops.defaultBranch(projectDir()) : 'main');
  const shaOk = (x) => typeof x === 'string' && /^[0-9a-f]{7,40}$/.test(x);
  handle('ops:truth', async (ids) => {
    const out = {};
    const def = await defOf();
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, 60)) { const d = taskWs(id); if (d) out[id] = await wfgit.truthFacts({ git: g, dir: d, def }); }
    return out;
  });
  const nodeVersion = () => { try { return execFileSync(gitops.find('node') || 'node', ['--version'], { encoding: 'utf8', timeout: 10000 }).trim().replace(/^v/, ''); } catch { return null; } };
  // Before each task run: fetch, fast-forward local main, merge main into the task branch
  // (or stop with a conflict report), and check the runtime the project needs.
  handle('ops:prepareRun', async (taskId) => {
    const d = taskWs(taskId);
    if (!d || !projectDir()) return { ok: false, reason: 'no task workspace' };
    const def = await defOf();
    const sync = await wfgit.syncMain({ git: g, project: projectDir(), def });
    const merge = await wfgit.mergeMain({ git: g, dir: d, def, why: 'before the next run' });
    const blockers = wfgit.runtimeCheck(d, { nodeVersion: nodeVersion(), has: (b) => Boolean(gitops.find(b)) });
    if (!merge.ok && merge.conflict) blockers.unshift({ kind: 'conflict', title: 'Merge conflict with main', detail: merge.reason, next: 'Resolve the conflict in the task workspace (or ask the implementer to), then start the run again.' });
    return { ok: merge.ok || !merge.conflict, sync, merge, blockers, facts: await wfgit.truthFacts({ git: g, dir: d, def }) };
  });
  handle('ops:snapshot', async (taskId) => { const d = taskWs(taskId); return d ? wfgit.snapshot({ git: g, dir: d }) : null; });
  handle('ops:enforceVerify', async (taskId, before) => {
    const d = taskWs(taskId);
    if (!d || !before || !shaOk(before.head)) return { ok: true, commits: [], files: [] };
    return wfgit.enforceVerify({ git: g, dir: d, taskId: String(taskId), before: { head: before.head, status: String(before.status || ''), stash: shaOk(before.stash) ? before.stash : null, tree: shaOk(before.tree) ? before.tree : null, untracked: Array.isArray(before.untracked) ? before.untracked.map(String) : [] } });
  });
  handle('ops:enforceDocs', async (taskId, startSha) => {
    const d = taskWs(taskId);
    if (!d || !shaOk(startSha)) return { ok: true, discarded: [], kept: [] };
    const globs = String(active().settings.docsPaths || '').split(',').map((x) => x.trim()).filter(Boolean);
    return wfgit.enforceDocs({ git: g, dir: d, startSha, globs });
  });
  handle('ops:splitFollowup', async (taskId, approved) => {
    const d = taskWs(taskId);
    if (!d) return { ok: false, reason: 'no task workspace' };
    // Never while a run is working in that workspace.
    if (activeCwds.has(d)) return { ok: false, busy: true, reason: 'a run is in progress in that workspace' };
    return wfgit.splitFollowup({ git: g, dir: d, approved: String(approved || '') });
  });
  handle('ops:reviewData', async (taskId, from, changes) => {
    const d = taskWs(taskId);
    if (!d) return { ok: false };
    const r = await wfgit.reviewData({ git: g, dir: d, from: shaOk(from) ? from : null, def: await defOf(), changes: Array.isArray(changes) ? changes.filter(shaOk) : [] });
    if (r.ok) { r.diff = redact(r.diff); r.log = redact(r.log); }
    return r;
  });
  // The lead's standing permissions (Routine, audited by the window, undoable): bring main
  // into a hearth/ task branch, or revert one task-branch commit. Checked here, not trusted
  // from the page: only while the lead switch is on, never main, tags or releases.
  handle('ops:leadTaskGit', async (op, taskId, arg) => {
    if (readSettings().leadActions !== true) return { ok: false, reason: 'the lead switch is off' };
    const d = taskWs(taskId);
    if (!d) return { ok: false, reason: `T-${taskId} has no task branch` };
    if (activeCwds.has(d)) return { ok: false, reason: `T-${taskId} has a run in progress` };
    const def = await defOf();
    if (op === 'mergemain') return wfgit.mergeMain({ git: g, dir: d, def, why: 'lead: MERGE MAIN' });
    if (op === 'revert') return wfgit.revertOnTask({ git: g, dir: d, sha: String(arg || ''), def });
    if (op === 'undomerge') return wfgit.undoMergeMain({ git: g, dir: d, merge: String(arg?.merge || ''), before: String(arg?.before || '') });
    return { ok: false, reason: 'unknown operation' };
  });
  // K. New images and videos after a run become attachments; workspace files move into the AI's assets folder.
  handle('ops:collectAssets', async (taskId, agent, text, sinceMs) => {
    const d = taskWs(taskId);
    if (!d || !/^[a-z]+$/.test(String(agent))) return [];
    const assetsDir = path.join(d, '.hearth-ai', 'assets', String(agent));
    const found = await wfgit.scanAssets({ git: g, dir: d, assetsDir, text: String(text || '').slice(0, 20000), sinceMs: Number(sinceMs) || 0 });
    // Copied into the assets folder, never moved: the workspace file may be part of the project.
    return found.map((f) => { try { return f.source === 'workspace' ? { ...f, from: f.rel, rel: wfgit.copyIntoAssets(d, f.rel, assetsDir), copied: true } : f; } catch { return f; } });
  });

  // ---- I. the release gate (enforced here before any tag or release) ----
  let gateState = null; // { version, sha, list, at, override }
  handle('ops:releasePreview', async (version) => {
    const dir = projectDir();
    if (!dir) return { ok: false, message: 'Pick a project first.' };
    const ps = active().settings;
    const ver = String(version || ps.nextVersion || '').replace(/^v/, '');
    await workspace.git(dir, ['fetch', '--quiet', '--tags', 'origin'], { timeoutMs: 90000 });
    const ref = await baseOf(dir);
    const f = await wfgit.releaseFacts({ git: g, dir, ref, version: ver, versionFile: ps.versionFile });
    if (!f.ok) return { ok: false, message: f.reason };
    // The full test suite at exactly that commit, in a temporary worktree.
    let testsR = { status: 'not run', reason: 'no test command', command: null };
    const command = tests.resolveTestCommand(ps.testCommand, dir, (await workspace.git(dir, ['show', `${f.sha}:package.json`])).out || '');
    if (command) {
      const tmp = path.join(os.tmpdir(), `hearth-release-${crypto.randomBytes(4).toString('hex')}`);
      const add = await workspace.git(dir, ['worktree', 'add', '--detach', tmp, f.sha], { timeoutMs: 120000 });
      if (add.ok) {
        try {
          if (tests.needsDeps(command, tmp)) testsR = { status: 'not run', reason: 'no dependencies installed (set the test command to e.g. "npm ci && npm test")', command };
          else { const r = await tests.runTests({ command, cwd: tmp, timeoutMs: ps.testTimeoutMin * 60000 }); testsR = { status: r.status, command, log: tests.redactTokens(redact(r.log)).slice(-4000) }; }
        } finally { await workspace.git(dir, ['worktree', 'remove', '--force', tmp]); }
      } else testsR = { status: 'not run', reason: `couldn't check out ${f.sha.slice(0, 7)}`, command };
    }
    const auth = identity.scanCommits(identity.parseLog(await range(dir, f.lastTag, f.sha)), applyIdentity());
    const list = gate.releaseChecklist({ version: ver, next: ps.nextVersion, fileVersion: release.fileVersion(ps.versionFile, f.versionText), sha: f.sha, notes: f.notes, commits: f.commits, tasks: f.tasks, tests: testsR, authorship: auth });
    gateState = { version: ver, sha: f.sha, list, at: Date.now(), override: null };
    return { ok: true, version: ver, sha: f.sha, ref, lastTag: f.lastTag, tasks: f.tasks, commits: f.commits.slice(0, 80), notesRel: f.notesRel, notes: f.notes, tests: testsR, list, gate: gate.releaseGate(list) };
  });
  // Only the owner can override, with a reason, in a native dialog (never the lead).
  handle('ops:releaseOverride', async (version, reason) => {
    const ver = String(version || '').replace(/^v/, '');
    if (!gateState || gateState.version !== ver) return { ok: false, message: 'Run the release preview first.' };
    const why = String(reason || '').trim().slice(0, 300);
    if (!why) return { ok: false, message: 'Write why you are overriding the checklist.' };
    const failed = gateState.list.filter((c) => !c.ok).map((c) => c.label);
    if (dialog.showMessageBoxSync(getWindow(), { type: 'warning', message: `Override the release checklist for v${ver}?`, detail: `Failing: ${failed.join('; ') || 'nothing'}.\nYour reason: ${why}`, buttons: ['Override', 'Cancel'], defaultId: 1, cancelId: 1 }) !== 0) return { ok: false, message: 'Cancelled.' };
    gateState.override = { by: 'owner', reason: why, at: Date.now() };
    return { ok: true, gate: gate.releaseGate(gateState.list, gateState.override) };
  });
  // The gate for a tag or release of `version` at commit `sha`.
  const releaseGateFor = (version, sha) => {
    const ver = String(version || '').replace(/^v/, '');
    if (!gateState || gateState.version !== ver) return { ok: false, reason: `run the release preview for v${ver} first (Release gate page)` };
    if (sha && gateState.sha !== sha) return { ok: false, reason: `main moved since the release preview (${gateState.sha.slice(0, 7)}→${String(sha).slice(0, 7)}); run the preview again` };
    if (Date.now() - gateState.at > 6 * 3600e3) return { ok: false, reason: 'the release preview is older than 6 hours; run it again' };
    return gate.releaseGate(gateState.list, gateState.override);
  };
  // Tags and releases on GitHub (to warn about ones the app didn't make).
  handle('ops:remoteTags', async () => {
    const dir = projectDir();
    if (!dir || !(await workspace.git(dir, ['remote', 'get-url', 'origin'])).ok) return { ok: false, tags: [] };
    const r = await workspace.git(dir, ['ls-remote', '--tags', 'origin'], { timeoutMs: 60000 });
    const tags = r.ok ? wfgit.parseLsRemote(r.out) : [];
    const repo = await ghRepo();
    if (repo) {
      const rel = await ghApi(['-X', 'GET', `repos/${repo.owner}/${repo.repo}/releases`, '-f', 'per_page=20']);
      try { for (const x of JSON.parse(rel.out)) if (x?.tag_name && !tags.some((t) => t.name === x.tag_name)) tags.push({ name: x.tag_name, sha: null, release: true }); } catch {}
    }
    return { ok: r.ok, tags };
  });

  // ---- settings or projects file edited outside the app: the owner keeps or discards it ----
  const diskNotified = { settings: false, projects: false };
  setInterval(() => {
    for (const [which, changed] of [['settings', () => settingsDisk?.changed()], ['projects', () => projects.changedOnDisk()]]) {
      let c = false;
      try { c = changed(); } catch {}
      if (c && !diskNotified[which]) { diskNotified[which] = true; send('ops:diskChange', { which }); }
      if (!c) diskNotified[which] = false;
    }
  }, 5000).unref?.();
  handle('ops:diskPending', () => ({ settings: Boolean(settingsDisk?.changed()), projects: projects.changedOnDisk(), notice: projects.notice() }));
  handle('ops:diskResolve', (which, choice) => {
    diskNotified[which] = false;
    if (which === 'settings') return { ok: true, settings: choice === 'keep' ? settingsDisk.keep() : settingsDisk.discard() };
    if (which === 'projects') { if (choice === 'keep') projects.keepDisk(); else projects.discardDisk(); return { ok: true, ...listProjects() }; }
    return { ok: false };
  });

  // Helpers for main.cjs.
  return {
    // The old Settings folder picker goes through the projects registry: a folder is a
    // project with its own board, and picking it switches to it (the window reloads).
    useFolder(dir) {
      const cur = active();
      const known = projects.get().list.find((p) => p.dir === dir) || (cur.dir === dir || (!cur.dir && cur.id === 'default') ? cur : null);
      if (known && known.id === cur.id) { projects.setDir(cur.id, dir); return { ...useProject(dir), projectSwitched: false }; }
      projects.setDir(cur.id, projectDir());
      const p = known || projects.add({ dir });
      projects.switchTo(p.id);
      setStore(projects.stateFile(p.id), p.id);
      return { ...useProject(dir), projectSwitched: true };
    },
    assetsEnv: (agent, cwd) => assetsEnv(agent, cwd),
    // The owner's release form (git:release) goes through the same gate.
    async releaseGate(version, target) {
      const dir = projectDir();
      if (!dir) return { ok: false, reason: 'no project' };
      const t = String(target || '');
      await workspace.git(dir, ['fetch', '--quiet', '--no-tags', 'origin'], { timeoutMs: 90000 });
      const ref = (await workspace.git(dir, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${t}`])).ok ? `origin/${t}` : t;
      const sha = (await workspace.git(dir, ['rev-parse', '--verify', '--quiet', ref])).out || null;
      // The release is created at exactly this commit (gh release create --target <sha>).
      return { ...releaseGateFor(version, sha), sha };
    },
    imageInfo: (file) => media.imageInfo(file),
    withMemory: (prompt) => memory.withMemory(prompt, readMemory()),
    // Stall watchdog for an editing run in a task worktree.
    watchdog(cwd, onStall) {
      const idleMs = active().settings.stallMin * 60000;
      if (!cwd) return null;
      // Track worktrees with a normal editing run, so background jobs don't write there.
      activeCwds.add(cwd);
      const release = () => activeCwds.delete(cwd);
      if (!idleMs) return { touch() {}, stop: release, stalled: false };
      const wd = createWatchdog({
        idleMs,
        onStall,
        probe: async () => {
          const a = await workspace.git(cwd, ['status', '--porcelain']);
          const b = await workspace.git(cwd, ['diff', 'HEAD', '--shortstat']);
          const c = await workspace.git(cwd, ['rev-parse', 'HEAD']);
          return `${a.out}|${b.out}|${c.out}`;
        },
      });
      const stop = wd.stop;
      return { touch: wd.touch, stop() { stop(); release(); }, get stalled() { return wd.stalled; } };
    },
    stallMinutes: () => active().settings.stallMin,
    stop() { for (const c of testRuns.values()) c.abort(); phone?.stop(); },
  };
}

// The phone snapshot: redacted, and refused (not truncated) when it is too big.
function phonePushData(snap, redactFn, set, max = 2e6) {
  if (!snap || typeof snap !== 'object') return { ok: false };
  const text = redactFn(JSON.stringify(snap));
  if (text.length > max) return { ok: false, message: 'snapshot too large' };
  set(JSON.parse(text));
  return { ok: true };
}

const pickDispatchRun = (runs = [], after = null) => (runs || []).filter((r) => r.event === 'workflow_dispatch' && (!after || String(r.created_at) >= after.slice(0, 19))).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;

const activeProjectId = () => (projects ? projects.get().active : 'default');
const projectsList = () => projects.get();
const projectStateFile = (id) => projects.stateFile(id);

module.exports = { activeProjectId, projectsList, projectStateFile, register, stateFile, jobLimits, jobMode, phonePushData, pickDispatchRun };

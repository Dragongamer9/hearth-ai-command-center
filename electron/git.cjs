// Git + GitHub for the Command Center, using your own git and your own
// GitHub sign-in (GitHub CLI, `gh auth login` in the browser). Every call is
// execFile with an argument array — never a shell — and nothing ever
// force-pushes. The default branch (main/master) is only changed through
// mergeApproved(), which the UI only calls after you click Approve.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function find(bin) {
  const dirs = [...(process.env.PATH || '').split(path.delimiter), path.join(os.homedir(), '.local', 'bin'), '/usr/local/bin', '/usr/bin', '/bin', '/home/linuxbrew/.linuxbrew/bin'];
  for (const d of dirs) {
    const p = path.join(d, bin);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  return null;
}

function exec(file, args, cwd, timeoutMs = 120000) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' } }, (error, stdout, stderr) => {
      resolve({ ok: !error, code: error?.code ?? 0, out: String(stdout).trim(), err: String(stderr).trim() || (error ? error.message : '') });
    });
  });
}

const git = (cwd, args, t) => exec(find('git') || 'git', args, cwd, t);
const lastLine = (r) => (r.err || r.out || '').split('\n').filter(Boolean).slice(-1)[0] || 'failed';

async function tools() {
  const gitPath = find('git');
  const ghPath = find('gh');
  let ghUser = null;
  if (ghPath) {
    const r = await exec(ghPath, ['api', 'user', '--jq', '.login'], undefined, 15000);
    if (r.ok && r.out) ghUser = r.out;
  }
  return { git: gitPath, gh: ghPath, ghUser };
}

// After `gh auth login`, let plain git push/pull use that same sign-in.
async function setupGitAuth() {
  const gh = find('gh');
  if (!gh) return { ok: false };
  const r = await exec(gh, ['auth', 'setup-git'], undefined, 20000);
  return { ok: r.ok };
}

async function isRepo(dir) {
  return Boolean(dir) && fs.existsSync(dir) && (await git(dir, ['rev-parse', '--is-inside-work-tree'])).out === 'true';
}

async function defaultBranch(dir) {
  const r = await git(dir, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (r.ok && r.out) return r.out.replace(/^origin\//, '');
  for (const b of ['main', 'master']) {
    if ((await git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`])).ok) return b;
  }
  return (await git(dir, ['branch', '--show-current'])).out || 'main';
}

const PROTECTED = (name, def) => name === def || name === 'main' || name === 'master';
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,120}$/;

async function status(dir) {
  if (!(await isRepo(dir))) return { repo: false };
  const [branch, remote, dirty] = await Promise.all([
    git(dir, ['branch', '--show-current']),
    git(dir, ['remote', 'get-url', 'origin']),
    git(dir, ['status', '--porcelain']),
  ]);
  const def = await defaultBranch(dir);
  let ahead = 0;
  let behind = 0;
  if (remote.ok && branch.out) {
    const c = await git(dir, ['rev-list', '--left-right', '--count', `${branch.out}...origin/${branch.out}`]);
    if (c.ok) [ahead, behind] = c.out.split(/\s+/).map(Number);
  }
  const branches = await git(dir, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)|%(upstream:track)|%(committerdate:relative)', 'refs/heads/']);
  return {
    repo: true,
    branch: branch.out,
    defaultBranch: def,
    remote: remote.ok ? remote.out.replace(/\/\/[^@/]*@/, '//') : null,
    dirty: dirty.out ? dirty.out.split('\n').length : 0,
    ahead,
    behind,
    branches: branches.out ? branches.out.split('\n').slice(0, 30).map((l) => { const [name, track, when] = l.split('|'); return { name, track, when, protected: PROTECTED(name, def) }; }) : [],
  };
}

async function pull(dir) {
  if (!(await isRepo(dir))) return { ok: false, message: 'Not a git repository.' };
  const st = await git(dir, ['status', '--porcelain']);
  if (st.out) return { ok: false, message: 'There are uncommitted changes in the project folder. Commit or stash them first, so nothing gets overwritten.' };
  const r = await git(dir, ['pull', '--ff-only'], 180000);
  return r.ok ? { ok: true, message: r.out.split('\n').slice(-1)[0] || 'Up to date.' } : { ok: false, message: lastLine(r) };
}

// Push a branch to GitHub. Protected branches are refused here on purpose.
async function pushBranch(dir, branch) {
  if (!BRANCH_RE.test(branch || '')) return { ok: false, message: 'Bad branch name.' };
  const def = await defaultBranch(dir);
  if (PROTECTED(branch, def)) return { ok: false, message: `Pushing ${branch} directly isn't allowed. Approve a merge instead.` };
  const r = await git(dir, ['push', '--no-follow-tags', '-u', 'origin', `refs/heads/${branch}:refs/heads/${branch}`], 180000);
  return r.ok ? { ok: true, message: `Pushed ${branch}.` } : { ok: false, message: lastLine(r) };
}

// Owner-approved: merge a task branch into the default branch and push it.
const SHA_RE = /^[0-9a-f]{40}$/;
// `sha`: the approved commit. The branch must still be exactly there, and exactly that
// commit is merged, so nothing added after the approval reaches main.
async function mergeApproved(dir, branch, approved = null) {
  if (!BRANCH_RE.test(branch || '')) return { ok: false, message: 'Bad branch name.' };
  if (approved !== null) {
    if (!SHA_RE.test(String(approved))) return { ok: false, message: 'No approved commit recorded for this task; review it again.' };
    const tip = (await git(dir, ['rev-parse', `refs/heads/${branch}`])).out;
    if (tip !== approved) return { ok: false, message: `${branch} changed after it was approved (approved ${approved.slice(0, 7)}, now ${tip.slice(0, 7)}). Nothing was merged.` };
  }
  const def = await defaultBranch(dir);
  if (PROTECTED(branch, def)) return { ok: false, message: 'Nothing to merge.' };
  if ((await git(dir, ['status', '--porcelain'])).out) return { ok: false, message: 'The project folder has uncommitted changes. Commit or stash them first.' };
  const before = (await git(dir, ['branch', '--show-current'])).out;
  const steps = [['checkout', def]];
  if ((await git(dir, ['remote', 'get-url', 'origin'])).ok) steps.push(['pull', '--ff-only']);
  steps.push(['merge', '--no-ff', '--no-edit', '-m', `Merge ${branch} (approved in Hearth AI Command Center)`, approved || branch]);
  for (const s of steps) {
    const r = await git(dir, s, 180000);
    if (!r.ok) {
      if (s[0] === 'merge') await git(dir, ['merge', '--abort']);
      if (before && before !== def) await git(dir, ['checkout', before]);
      return { ok: false, message: s[0] === 'merge' ? `Merge conflict — nothing was changed. (${lastLine(r)})` : lastLine(r) };
    }
  }
  const sha = (await git(dir, ['rev-parse', '--short', 'HEAD'])).out;
  let pushed = false;
  let pushMsg = 'No GitHub remote, merged locally only.';
  if ((await git(dir, ['remote', 'get-url', 'origin'])).ok) {
    const p = await git(dir, ['push', '--no-follow-tags', 'origin', `refs/heads/${def}:refs/heads/${def}`], 180000);
    pushed = p.ok;
    pushMsg = p.ok ? `Pushed ${def} to GitHub.` : `Merged locally, but push failed: ${lastLine(p)}`;
  }
  if (before && before !== def) await git(dir, ['checkout', before]);
  return { ok: true, sha, branch: def, pushed, message: `Merged into ${def} (${sha}). ${pushMsg}` };
}

const conflictFiles = async (dir) => (await git(dir, ['diff', '--name-only', '--diff-filter=U'])).out.split('\n').filter(Boolean);
async function idArgs(dir) {
  const id = await ownerIdentity(dir);
  return ['-c', `user.name=${id.name}`, '-c', `user.email=${id.email}`];
}
// The newest default branch: origin's copy when there is a remote, else the local one.
async function freshBase(dir, def) {
  if ((await git(dir, ['remote', 'get-url', 'origin'])).ok) {
    const f = await git(dir, ['fetch', 'origin', `refs/heads/${def}:refs/remotes/origin/${def}`], 180000);
    if (f.ok) return `origin/${def}`;
  }
  return def;
}

// Owner-pressed: bring one task branch up to date with the default branch, inside
// the task's own worktree. Main itself is never touched. On a conflict nothing changes
// and the conflicting files are listed.
async function updateFromMain(project, taskDir) {
  const branch = (await git(taskDir, ['branch', '--show-current'])).out;
  if (!branch || !BRANCH_RE.test(branch)) return { ok: false, message: 'This task has no branch to update.' };
  const def = await defaultBranch(project);
  if (PROTECTED(branch, def)) return { ok: false, message: 'That is the main branch.' };
  if ((await git(taskDir, ['status', '--porcelain'])).out) return { ok: false, message: 'The task workspace has unsaved changes. Save a checkpoint first.' };
  const base = await freshBase(project, def);
  const behind = (await git(taskDir, ['rev-list', '--count', `HEAD..${base}`])).out;
  if (behind === '0') return { ok: true, changed: false, branch, message: `${branch} is already up to date with ${def}.` };
  const r = await git(taskDir, [...(await idArgs(project)), 'merge', '--no-ff', '--no-edit', '-m', `Bring ${branch} up to date with ${def}`, base], 180000);
  if (!r.ok) {
    const conflicts = await conflictFiles(taskDir);
    await git(taskDir, ['merge', '--abort']);
    return { ok: false, conflicts, branch, message: conflicts.length ? `Conflicts with ${def} in ${conflicts.join(', ')}. Nothing was changed; the implementer needs to resolve these.` : lastLine(r) };
  }
  const sha = (await git(taskDir, ['rev-parse', '--short', 'HEAD'])).out;
  return { ok: true, changed: true, branch, sha, message: `${branch} now includes the latest ${def} (${sha}).` };
}

// Owner-pressed: one release branch (never main) that merges several approved task
// branches at once. A branch that conflicts is skipped and reported with its files;
// the rest still go in. Built in a temporary worktree so your checkout is untouched.
async function releaseBranch(project, name, branches = []) {
  // Entries are branch names, or { branch, sha } to merge exactly the approved commit.
  const shaOf = Object.fromEntries(branches.filter((b) => b && typeof b === 'object' && SHA_RE.test(String(b.sha || ''))).map((b) => [b.branch, b.sha]));
  branches = branches.map((b) => (b && typeof b === 'object' ? b.branch : b));
  if (!/^release\/[A-Za-z0-9._-]{1,80}$/.test(name || '')) return { ok: false, message: 'Bad release branch name.' };
  const list = [...new Set(branches)].filter((b) => BRANCH_RE.test(b || ''));
  if (!list.length) return { ok: false, message: 'No task branches to combine.' };
  if ((await git(project, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])).ok) return { ok: false, message: `${name} already exists.` };
  const def = await defaultBranch(project);
  if (list.some((b) => PROTECTED(b, def))) return { ok: false, message: 'The main branch cannot be combined into a release branch.' };
  const base = await freshBase(project, def);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-release-'));
  const wt = path.join(tmp, 'wt');
  const add = await git(project, ['worktree', 'add', '-b', name, wt, base]);
  if (!add.ok) { fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, message: lastLine(add) }; }
  const ids = await idArgs(project);
  const merged = [];
  const conflicts = [];
  try {
    for (const b of list) {
      const r = await git(wt, [...ids, 'merge', '--no-ff', '--no-edit', '-m', `Merge ${b} into ${name}`, shaOf[b] || b], 180000);
      if (r.ok) { merged.push(b); continue; }
      const files = await conflictFiles(wt);
      await git(wt, ['merge', '--abort']);
      conflicts.push({ branch: b, files, message: files.length ? '' : lastLine(r) });
    }
  } finally {
    await git(project, ['worktree', 'remove', '--force', wt]);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  let pushed = false;
  let pushMsg = 'Local only (no GitHub remote).';
  if (merged.length && (await git(project, ['remote', 'get-url', 'origin'])).ok) {
    const p = await git(project, ['push', '--no-follow-tags', '-u', 'origin', `refs/heads/${name}:refs/heads/${name}`], 180000);
    pushed = p.ok;
    pushMsg = p.ok ? `Pushed ${name} to GitHub.` : `Push failed: ${lastLine(p)}`;
  }
  const sha = (await git(project, ['rev-parse', '--short', name])).out;
  const lines = [
    `${name} (${sha}) from ${def}: ${merged.length} of ${list.length} task branches merged.`,
    ...conflicts.map((c) => `Conflict: ${c.branch}${c.files.length ? ` in ${c.files.join(', ')}` : ` (${c.message})`} — skipped.`),
    pushMsg,
    'Main was not changed. Merge the release branch when you are ready.',
  ];
  return { ok: merged.length > 0, branch: name, sha, merged, conflicts, pushed, message: lines.join(' ') };
}

// ---- the lead as integrator (owner's Settings toggle) ----
// The lead may fetch/pull and push task branches (hearth/…) and release branches
// (release/…). Main/master, tags and releases are never the lead's: merging into
// main only happens through mergeApproved() after an approval.
const LEAD_PUSH = /^(hearth|release)\/[A-Za-z0-9._\/-]{1,110}$/;
function leadGitAllowed(op, branch = '', def = 'main') {
  if (op === 'fetch' || op === 'pull') return { ok: true };
  if (op === 'push' || op === 'integrate') {
    if (!branch || PROTECTED(branch, def) || !LEAD_PUSH.test(branch) || branch.includes('..')) return { ok: false, reason: `${branch || 'that branch'} is not a task or release branch; main stays protected` };
    return { ok: true };
  }
  return { ok: false, reason: `${op} stays with the Owner (tags, releases and version numbers are never the lead's)` };
}

// Fetch from GitHub with your own git sign-in; never tags.
async function leadFetch(dir) {
  if (!(await git(dir, ['remote', 'get-url', 'origin'])).ok) return { ok: false, message: 'No GitHub remote.' };
  const r = await git(dir, ['fetch', '--no-tags', '--prune', 'origin'], 180000);
  if (!r.ok) return { ok: false, message: lastLine(r) };
  const def = await defaultBranch(dir);
  const sha = (await git(dir, ['rev-parse', '--short', `origin/${def}`])).out;
  return { ok: true, branch: def, sha, message: `Fetched origin: ${def} is at ${sha}.` };
}

// Push one task or release branch (never main, never tags).
async function leadPush(dir, branch) {
  const def = await defaultBranch(dir);
  const allowed = leadGitAllowed('push', branch, def);
  if (!allowed.ok) return { ok: false, message: allowed.reason };
  if (!(await git(dir, ['remote', 'get-url', 'origin'])).ok) return { ok: false, message: 'No GitHub remote.' };
  const r = await git(dir, ['push', '--no-follow-tags', '-u', 'origin', `refs/heads/${branch}:refs/heads/${branch}`], 180000);
  const sha = (await git(dir, ['rev-parse', '--short', `refs/heads/${branch}`])).out;
  return r.ok ? { ok: true, branch, sha, message: `Pushed ${branch} (${sha}).` } : { ok: false, branch, message: lastLine(r) };
}

// Merge one approved task branch onto the release branch (created from the newest
// main the first time), in a temporary worktree, then push it. Conflicts change
// nothing and list the files.
async function integrateIntoRelease(project, release, branch) {
  const def = await defaultBranch(project);
  for (const b of [release, branch]) {
    const ok = leadGitAllowed('integrate', b, def);
    if (!ok.ok) return { ok: false, message: ok.reason };
  }
  const hasRemote = (await git(project, ['remote', 'get-url', 'origin'])).ok;
  if (hasRemote) await git(project, ['fetch', '--no-tags', 'origin'], 180000);
  const local = (await git(project, ['rev-parse', '--verify', '--quiet', `refs/heads/${release}`])).ok;
  const remote = hasRemote && (await git(project, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${release}`])).ok;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-integrate-'));
  const wt = path.join(tmp, 'wt');
  const add = local ? await git(project, ['worktree', 'add', wt, release])
    : await git(project, ['worktree', 'add', '-b', release, wt, remote ? `origin/${release}` : await freshBase(project, def)]);
  if (!add.ok) { fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, message: lastLine(add) }; }
  let result;
  try {
    if (local && remote) await git(wt, ['merge', '--ff-only', `origin/${release}`]);
    const r = await git(wt, [...(await idArgs(project)), 'merge', '--no-ff', '--no-edit', '-m', `Merge ${branch} into ${release}`, branch], 180000);
    if (!r.ok) {
      const conflicts = await conflictFiles(wt);
      await git(wt, ['merge', '--abort']);
      result = { ok: false, conflicts, release, message: conflicts.length ? `${branch} conflicts with ${release} in ${conflicts.join(', ')}. Nothing was changed.` : lastLine(r) };
    } else {
      result = { ok: true, release, sha: (await git(wt, ['rev-parse', '--short', 'HEAD'])).out };
    }
  } finally {
    await git(project, ['worktree', 'remove', '--force', wt]);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (!result.ok) return result;
  const pushed = hasRemote ? await leadPush(project, release) : { ok: false, message: 'No GitHub remote, kept locally.' };
  return { ...result, pushed: pushed.ok, message: `Merged ${branch} onto ${release} (${result.sha}). ${pushed.ok ? `Pushed ${release}.` : pushed.message}` };
}

async function openPr(dir, branch, title, body) {
  const gh = find('gh');
  if (!gh) return { ok: false, message: 'GitHub CLI (gh) is not installed.' };
  const push = await pushBranch(dir, branch);
  if (!push.ok) return push;
  const def = await defaultBranch(dir);
  const r = await exec(gh, ['pr', 'create', '--head', branch, '--base', def, '--title', String(title).slice(0, 200), '--body', String(body).slice(0, 5000)], dir, 60000);
  const num = (u) => Number((String(u).match(/\/pull\/(\d+)/) || [])[1]) || null;
  if (r.ok) { const url = r.out.split('\n').filter((l) => l.startsWith('https://')).pop() || r.out; return { ok: true, url, number: num(url) }; }
  const existing = await exec(gh, ['pr', 'view', branch, '--json', 'url', '--jq', '.url'], dir, 30000);
  return existing.ok ? { ok: true, url: existing.out, number: num(existing.out) } : { ok: false, message: lastLine(r) };
}

// "owner/repo" or a github.com URL -> https clone URL + folder name.
function parseRepo(input) {
  const s = String(input || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = s.match(/^(?:https:\/\/github\.com\/|git@github\.com:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!m || !/^[A-Za-z0-9]/.test(m[1]) || !/^[A-Za-z0-9_]/.test(m[2]) || m[2] === '..') return null;
  return { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}.git` };
}

async function clone(input, parent) {
  const p = parseRepo(input);
  if (!p) return { ok: false, message: 'Use owner/repo or a github.com link.' };
  fs.mkdirSync(parent, { recursive: true });
  const dir = path.join(parent, p.repo);
  if (fs.existsSync(dir)) {
    return (await isRepo(dir)) ? { ok: true, dir, message: 'Already cloned — using the existing folder.' } : { ok: false, message: `${dir} already exists and isn't a git repo.` };
  }
  const r = await git(parent, ['clone', '--', p.url, dir], 600000);
  return r.ok ? { ok: true, dir } : { ok: false, message: lastLine(r) };
}

// The owner's identity for commits the app makes: git's own user.name/email when
// set, otherwise Dragongamer9's GitHub no-reply address. Never an AI name.
const OWNER = { name: 'Dragongamer9', email: 'Dragongamer9@users.noreply.github.com' };
async function ownerIdentity(dir) {
  const [n, e] = await Promise.all([git(dir, ['config', 'user.name']), git(dir, ['config', 'user.email'])]);
  return { name: (n.ok && n.out) || OWNER.name, email: (e.ok && e.out) || OWNER.email };
}

// Start tracking a plain folder with git so work on it can be checkpointed.
async function initRepo(dir) {
  if (await isRepo(dir)) return { ok: true };
  const id = await ownerIdentity(dir);
  const steps = [['init', '-b', 'main'], ['add', '-A'], ['-c', `user.name=${id.name}`, '-c', `user.email=${id.email}`, 'commit', '--allow-empty', '-m', 'Start tracking the project']];
  for (const s of steps) {
    const r = await git(dir, s);
    if (!r.ok) return { ok: false, message: lastLine(r) };
  }
  return { ok: true };
}

// ---- Pull requests (GitHub CLI with your own `gh auth login`) ----
const PR_FIELDS = 'number,title,url,state,isDraft,headRefName,baseRefName,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup,reviews,updatedAt,mergedAt';
const PASS = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];
const FAIL = ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'];

// gh's JSON -> what the app shows: state label, check counts, latest review per person.
function summarizePr(j) {
  if (!j || typeof j !== 'object' || !j.number) return null;
  const checks = { total: 0, passed: 0, failed: 0, pending: 0, items: [] };
  for (const c of Array.isArray(j.statusCheckRollup) ? j.statusCheckRollup : []) {
    const name = c.name || c.context || 'check';
    const res = String(c.conclusion || c.state || '').toUpperCase();
    const done = c.status ? String(c.status).toUpperCase() === 'COMPLETED' : res && res !== 'PENDING' && res !== 'EXPECTED';
    const st = done && PASS.includes(res) ? 'passed' : done && FAIL.includes(res) ? 'failed' : 'pending';
    checks.total++;
    checks[st]++;
    checks.items.push({ name: String(name).slice(0, 80), state: st, url: c.detailsUrl || c.targetUrl || null });
  }
  const latest = new Map();
  for (const r of Array.isArray(j.reviews) ? j.reviews : []) {
    const who = r.author?.login || 'someone';
    if (r.state === 'COMMENTED' && latest.has(who)) continue;
    latest.set(who, { who, state: r.state, at: r.submittedAt || null });
  }
  const reviews = [...latest.values()];
  const state = String(j.state || '').toUpperCase();
  let label = 'open';
  if (state === 'MERGED' || j.mergedAt) label = 'merged';
  else if (state === 'CLOSED') label = 'closed';
  else if (j.isDraft) label = 'draft';
  else if (checks.failed) label = 'checks failing';
  else if (j.reviewDecision === 'CHANGES_REQUESTED') label = 'changes requested';
  else if (checks.pending) label = 'checks running';
  else if (j.reviewDecision === 'APPROVED') label = 'approved';
  else if (j.reviewDecision === 'REVIEW_REQUIRED') label = 'review required';
  return {
    number: j.number, title: String(j.title || ''), url: String(j.url || ''), state, label, draft: Boolean(j.isDraft),
    head: j.headRefName || '', base: j.baseRefName || '', mergeable: j.mergeable || 'UNKNOWN', mergeState: j.mergeStateStatus || '',
    reviewDecision: j.reviewDecision || '', checks, reviews, updatedAt: j.updatedAt || null,
  };
}

async function prView(dir, ref) {
  const gh = find('gh');
  if (!gh) return { ok: false, message: 'GitHub CLI (gh) is not installed.' };
  if (!/^(\d{1,7}|[A-Za-z0-9._/-]{1,120})$/.test(String(ref))) return { ok: false, message: 'Bad pull request reference.' };
  const r = await exec(gh, ['pr', 'view', String(ref), '--json', PR_FIELDS], dir, 30000);
  if (!r.ok) return { ok: false, message: /no pull requests found/i.test(r.err) ? 'No pull request for this branch yet.' : lastLine(r) };
  try { return { ok: true, pr: summarizePr(JSON.parse(r.out)) }; } catch { return { ok: false, message: 'Unexpected answer from gh.' }; }
}

async function prList(dir) {
  const gh = find('gh');
  if (!gh) return { ok: false, message: 'GitHub CLI (gh) is not installed.', prs: [] };
  const r = await exec(gh, ['pr', 'list', '--state', 'all', '--limit', '30', '--json', PR_FIELDS], dir, 30000);
  if (!r.ok) return { ok: false, message: lastLine(r), prs: [] };
  try { return { ok: true, prs: JSON.parse(r.out).map(summarizePr).filter(Boolean) }; } catch { return { ok: false, message: 'Unexpected answer from gh.', prs: [] }; }
}

// Owner-approved only (the UI calls this after Approve + a confirmation dialog).
// A normal merge commit: never --admin (doesn't bypass branch protection), never --auto.
async function prMerge(dir, number, sha = null) {
  const gh = find('gh');
  if (!gh) return { ok: false, message: 'GitHub CLI (gh) is not installed.' };
  if (!/^\d{1,7}$/.test(String(number))) return { ok: false, message: 'Bad pull request number.' };
  const view = await prView(dir, String(number));
  if (!view.ok) return view;
  if (view.pr.state !== 'OPEN') return { ok: false, message: `Pull request #${number} is ${view.pr.state.toLowerCase()}.` };
  if (view.pr.checks.failed) return { ok: false, message: `Pull request #${number} has failing checks; nothing merged.` };
  if (sha !== null && !SHA_RE.test(String(sha))) return { ok: false, message: 'No approved commit recorded for this pull request; review it again.' };
  // --match-head-commit: GitHub refuses if the PR moved past the approved commit.
  const r = await exec(gh, ['pr', 'merge', String(number), '--merge', ...(sha ? ['--match-head-commit', sha] : [])], dir, 120000);
  return r.ok ? { ok: true, message: `Merged pull request #${number} into ${view.pr.base}.` } : { ok: false, message: lastLine(r) };
}

const VERSION = /^\d{1,4}\.\d{1,4}(\.\d{1,4})?$/;
// Owner-approved only, with the version typed by the owner (twice). Never picks a number.
async function releaseCreate(dir, { version, target, notes = '', draft = true }) {
  const gh = find('gh');
  if (!gh) return { ok: false, message: 'GitHub CLI (gh) is not installed.' };
  if (!VERSION.test(String(version || ''))) return { ok: false, message: 'Type the version as MAJOR.MINOR (for example 1.1).' };
  // A branch name, or (from the release gate) the exact 40-character commit to tag.
  if (!BRANCH_RE.test(String(target || '')) && !/^[0-9a-f]{40}$/.test(String(target || ''))) return { ok: false, message: 'Bad target branch.' };
  const tag = `v${version}`;
  const args = ['release', 'create', tag, '--target', target, '--title', `${tag}`, '--notes', String(notes).slice(0, 20000) || `Release ${tag}`];
  if (draft) args.push('--draft');
  const r = await exec(gh, args, dir, 120000);
  if (!r.ok) return { ok: false, message: lastLine(r) };
  return { ok: true, tag, draft, url: r.out.split('\n').filter((l) => l.startsWith('https://')).pop() || '', message: `${draft ? 'Draft release' : 'Release'} ${tag} created${draft ? ' — press Publish on GitHub when ready' : ''}.` };
}

module.exports = { leadGitAllowed, leadFetch, leadPush, integrateIntoRelease, updateFromMain, releaseBranch, summarizePr, prView, prList, prMerge, releaseCreate, ownerIdentity, tools, setupGitAuth, isRepo, status, pull, pushBranch, mergeApproved, openPr, clone, initRepo, parseRepo, defaultBranch, find };

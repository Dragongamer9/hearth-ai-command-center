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
  const r = await git(dir, ['push', '-u', 'origin', `refs/heads/${branch}:refs/heads/${branch}`], 180000);
  return r.ok ? { ok: true, message: `Pushed ${branch}.` } : { ok: false, message: lastLine(r) };
}

// Owner-approved: merge a task branch into the default branch and push it.
async function mergeApproved(dir, branch) {
  if (!BRANCH_RE.test(branch || '')) return { ok: false, message: 'Bad branch name.' };
  const def = await defaultBranch(dir);
  if (PROTECTED(branch, def)) return { ok: false, message: 'Nothing to merge.' };
  if ((await git(dir, ['status', '--porcelain'])).out) return { ok: false, message: 'The project folder has uncommitted changes. Commit or stash them first.' };
  const before = (await git(dir, ['branch', '--show-current'])).out;
  const steps = [['checkout', def]];
  if ((await git(dir, ['remote', 'get-url', 'origin'])).ok) steps.push(['pull', '--ff-only']);
  steps.push(['merge', '--no-ff', '--no-edit', '-m', `Merge ${branch} (approved in Hearth AI Command Center)`, branch]);
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
    const p = await git(dir, ['push', 'origin', `refs/heads/${def}:refs/heads/${def}`], 180000);
    pushed = p.ok;
    pushMsg = p.ok ? `Pushed ${def} to GitHub.` : `Merged locally, but push failed: ${lastLine(p)}`;
  }
  if (before && before !== def) await git(dir, ['checkout', before]);
  return { ok: true, sha, branch: def, pushed, message: `Merged into ${def} (${sha}). ${pushMsg}` };
}

async function openPr(dir, branch, title, body) {
  const gh = find('gh');
  if (!gh) return { ok: false, message: 'GitHub CLI (gh) is not installed.' };
  const push = await pushBranch(dir, branch);
  if (!push.ok) return push;
  const def = await defaultBranch(dir);
  const r = await exec(gh, ['pr', 'create', '--head', branch, '--base', def, '--title', String(title).slice(0, 200), '--body', String(body).slice(0, 5000)], dir, 60000);
  if (r.ok) return { ok: true, url: r.out.split('\n').filter((l) => l.startsWith('https://')).pop() || r.out };
  const existing = await exec(gh, ['pr', 'view', branch, '--json', 'url', '--jq', '.url'], dir, 30000);
  return existing.ok ? { ok: true, url: existing.out } : { ok: false, message: lastLine(r) };
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

// Start tracking a plain folder with git so work on it can be checkpointed.
async function initRepo(dir) {
  if (await isRepo(dir)) return { ok: true };
  const steps = [['init', '-b', 'main'], ['add', '-A'], ['-c', 'user.name=Hearth AI Command Center', '-c', 'user.email=hearth-ai@localhost', 'commit', '--allow-empty', '-m', 'Start tracking with Hearth AI Command Center']];
  for (const s of steps) {
    const r = await git(dir, s);
    if (!r.ok) return { ok: false, message: lastLine(r) };
  }
  return { ok: true };
}

module.exports = { tools, setupGitAuth, isRepo, status, pull, pushBranch, mergeApproved, openPr, clone, initRepo, parseRepo, defaultBranch, find };

// Shared workspace: one git branch + worktree per task that every agent works in,
// with automatic checkpoint commits so progress survives an agent running out of
// usage. Git is called with execFile and argument arrays only. Nothing is ever
// pushed or merged here.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function git(cwd, args, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: String(stdout).trim(), err: String(stderr).trim() || (error ? error.message : '') });
    });
  });
}

async function isRepo(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  return (await git(dir, ['rev-parse', '--is-inside-work-tree'])).out === 'true';
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task';
}

// The repository a folder belongs to: its shared git dir (the same for a repo and all
// of its worktrees), as a real absolute path. null when it isn't a git folder.
async function commonDir(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const r = await git(dir, ['rev-parse', '--git-common-dir']);
  if (!r.ok || !r.out) return null;
  try { return fs.realpathSync(path.resolve(dir, r.out)); } catch { return null; }
}
// True only when `dir` is a worktree (or the checkout) of the same repository as `project`.
async function belongsTo(dir, project) {
  const [a, b] = await Promise.all([commonDir(dir), commonDir(project)]);
  return Boolean(a && b && a === b);
}

// Create (or reuse) the task's branch and worktree. An existing folder is reused only
// when it is a worktree of this project's repository; one from another repo is refused.
async function ensureWorktree({ project, root, taskId, title }) {
  if (!(await isRepo(project))) throw new Error('The project folder is not a git repository. Pick a git repo in Settings (or run `git init` there).');
  if (!/^[A-Z0-9]{4,10}$/.test(taskId)) throw new Error('bad task id');
  const dir = path.join(root, taskId);
  const branch = `hearth/${taskId.toLowerCase()}-${slug(title)}`;
  if (fs.existsSync(path.join(dir, '.git'))) {
    if (!(await belongsTo(dir, project))) {
      const e = new Error(`The workspace ${taskId} belongs to a different project's repository, so it was not used.`);
      e.wrongRepo = true;
      throw e;
    }
    const base = await git(project, ['rev-parse', 'HEAD']);
    return { dir, branch, created: false, baseSha: base.out };
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const head = await git(project, ['rev-parse', 'HEAD']);
  if (!head.ok) throw new Error('The project repo has no commits yet. Make one first commit, then try again.');
  const exists = await git(project, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  const args = exists.ok ? ['worktree', 'add', dir, branch] : ['worktree', 'add', '-b', branch, dir, head.out];
  const r = await git(project, args);
  if (!r.ok) throw new Error(`Could not create the task workspace: ${r.err}`);
  return { dir, branch, created: true, baseSha: head.out };
}

// The owner's rule: commits only as Dragongamer9, with no AI attribution.
// Uses git's own user.name/email when set, else the GitHub no-reply address.
async function ownerIdentity(dir) {
  const [n, e] = await Promise.all([git(dir, ['config', 'user.name']), git(dir, ['config', 'user.email'])]);
  return { name: (n.ok && n.out) || 'Dragongamer9', email: (e.ok && e.out) || 'Dragongamer9@users.noreply.github.com' };
}
// Strip AI attribution lines an agent might have suggested.
function cleanMessage(message) {
  return String(message).split('\n').filter((l) => !/^\s*(co-authored-by:|claude-session:|🤖?\s*generated with)/i.test(l)).join('\n').trim() || 'Checkpoint';
}

// Commit whatever is in the worktree. Returns null when nothing changed.
// (author is who worked on it, recorded in the app's audit log — not in git.)
// The app's own files (.hearth-ai/: attachments, assets, jobs) are never committed, even
// if .gitignore says otherwise: they're excluded from the add and unstaged before committing.
const APP_DIR = '.hearth-ai';

async function checkpoint(dir, { message }) {
  if (!fs.existsSync(dir)) return null;
  // Never edits the tracked .gitignore: .hearth-ai/ is excluded here and in the shared exclude file.
  await git(dir, ['add', '-A', '--', '.', `:(exclude)${APP_DIR}`]);
  await git(dir, ['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', APP_DIR]);
  const staged = await git(dir, ['diff', '--cached', '--stat']);
  if (!staged.out) return null;
  const names = await git(dir, ['diff', '--cached', '--name-only']);
  const id = await ownerIdentity(dir);
  const r = await git(dir, [
    '-c', `user.name=${id.name}`, '-c', `user.email=${id.email}`,
    'commit', '--no-verify', '-m', cleanMessage(message),
  ]);
  if (!r.ok) throw new Error(`Checkpoint failed: ${r.err}`);
  const sha = await git(dir, ['rev-parse', '--short', 'HEAD']);
  return { sha: sha.out, stat: staged.out.split('\n').slice(-1)[0], files: names.out.split('\n').filter(Boolean).slice(0, 200) };
}

// What has been done on this task's branch so far — shared with the next agent.
async function summary(dir, baseSha) {
  if (!fs.existsSync(dir)) return '';
  const log = await git(dir, ['log', '--format=%h %s', `${baseSha}..HEAD`]);
  const stat = await git(dir, ['diff', '--stat', baseSha]);
  const dirty = await git(dir, ['status', '--short']);
  return [
    log.out ? `Commits on this task branch:\n${log.out}` : 'No commits on this task branch yet.',
    stat.out ? `Files changed vs. start:\n${stat.out}` : '',
    dirty.out ? `Uncommitted changes:\n${dirty.out}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 6000);
}

// Current commit of a task branch (full sha; shown short), or null.
async function head(dir) {
  if (!fs.existsSync(dir)) return null;
  const r = await git(dir, ['rev-parse', 'HEAD']);
  return r.ok && r.out ? r.out : null;
}

module.exports = { APP_DIR, head, isRepo, commonDir, belongsTo, ensureWorktree, checkpoint, summary, git, slug, cleanMessage, ownerIdentity };

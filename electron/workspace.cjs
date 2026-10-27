// Shared workspace: one git branch + worktree per task that every agent works in,
// with automatic checkpoint commits so progress survives an agent running out of
// usage. Git is called with execFile and argument arrays only. Nothing is ever
// pushed or merged.
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

// Create (or reuse) the task's branch and worktree.
async function ensureWorktree({ project, root, taskId, title }) {
  if (!(await isRepo(project))) throw new Error('The project folder is not a git repository. Pick a git repo in Settings (or run `git init` there).');
  if (!/^[A-Z0-9]{4,10}$/.test(taskId)) throw new Error('bad task id');
  const dir = path.join(root, taskId);
  const branch = `hearth/${taskId.toLowerCase()}-${slug(title)}`;
  if (fs.existsSync(path.join(dir, '.git'))) {
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

// Commit whatever is in the worktree. Returns null when nothing changed.
async function checkpoint(dir, { author, message }) {
  if (!fs.existsSync(dir)) return null;
  await git(dir, ['add', '-A']);
  const staged = await git(dir, ['diff', '--cached', '--stat']);
  if (!staged.out) return null;
  const who = `${author} (Hearth AI) <hearth-ai@localhost>`;
  const r = await git(dir, [
    '-c', 'user.name=Hearth AI Command Center', '-c', 'user.email=hearth-ai@localhost',
    'commit', '--no-verify', '--author', who, '-m', message,
  ]);
  if (!r.ok) throw new Error(`Checkpoint failed: ${r.err}`);
  const sha = await git(dir, ['rev-parse', '--short', 'HEAD']);
  return { sha: sha.out, stat: staged.out.split('\n').slice(-1)[0] };
}

// What has been done on this task's branch so far — shared with the next agent.
async function summary(dir, baseSha) {
  if (!fs.existsSync(dir)) return '';
  const log = await git(dir, ['log', '--format=%h %an: %s', `${baseSha}..HEAD`]);
  const stat = await git(dir, ['diff', '--stat', baseSha]);
  const dirty = await git(dir, ['status', '--short']);
  return [
    log.out ? `Commits on this task branch:\n${log.out}` : 'No commits on this task branch yet.',
    stat.out ? `Files changed vs. start:\n${stat.out}` : '',
    dirty.out ? `Uncommitted changes:\n${dirty.out}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 6000);
}

module.exports = { isRepo, ensureWorktree, checkpoint, summary, git, slug };

// Temporary copies: when a chat is connected to a GitHub repo, the AIs work in a small
// shallow clone of it (git clone --depth 1 --single-branch) inside the app's data folder.
// They edit, search and run quick checks there; real builds and tests run in GitHub
// Actions after a push to the chat's own branch.
//
// The owner's rules, enforced here:
// - A copy belongs to exactly one chat and one repo. One whose origin is another repo is
//   never used (and never deleted by mistake either).
// - A copy holding work that isn't on GitHub yet (uncommitted changes or commits on no
//   remote branch) is never deleted without force; the window asks the owner first and
//   offers to push it to a branch.
// - Nothing is ever pushed to main/master, the chat's base branch or a tag: a pre-push
//   hook in every copy refuses those, and push() only pushes the chat's own hearth/ branch.
// - Every commit is the owner's (identity from Settings, AI attribution lines stripped).
// git is called with execFile and argument arrays only.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const identity = require('./ops/identity.cjs');

const CHAT_ID = /^(c[0-9a-f]{10}|team-[a-z0-9]{3,16})$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,200}$/;
const OWNER = { name: 'Dragongamer9', email: 'Dragongamer9@users.noreply.github.com', emails: ['Dragongamer9@users.noreply.github.com'] };
const PREPUSH_MARK = '# hearth-ai-command-center: temporary copy guard';
// Files the app writes into a copy that must never be committed.
const APP_PATHS = ['.hearth-ai', '.hearth-preview', '.hearth-media', '.hearth-out'];

const validBranch = (b) => typeof b === 'string' && BRANCH_RE.test(b) && !b.includes('..') && !b.startsWith('-') && !b.endsWith('/') && !b.endsWith('.lock');
const validRepo = (r) => typeof r === 'string' && REPO_RE.test(r) && !r.endsWith('.git');
const sameRepo = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

// "https://github.com/o/r.git", "git@github.com:o/r", file:///x -> comparable source id.
function sourceOf(url) {
  const s = String(url || '').trim();
  const m = s.match(/github\.com[:/]+([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9_.][A-Za-z0-9_.-]*?)(?:\.git)?\/?$/);
  if (m) return { repo: `${m[1]}/${m[2]}` };
  if (s.startsWith('file://')) return { dir: decodeURIComponent(s.slice(7)).replace(/\/+$/, '') };
  if (path.isAbsolute(s)) return { dir: s.replace(/\/+$/, '') };
  return null;
}

function slug(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'chat';
}

// Disk space a folder really uses (allocated blocks), without following symlinks.
function du(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      let st;
      try { st = fs.lstatSync(p); } catch { continue; }
      total += Number.isFinite(st.blocks) && st.blocks > 0 ? st.blocks * 512 : st.size;
      if (e.isDirectory()) stack.push(p);
    }
  }
  return total;
}

function prePushHook(protectedBranches) {
  const cases = [...new Set(protectedBranches.filter(validBranch))].map((b) => `refs/heads/${b}`).join('|');
  return `#!/bin/sh
${PREPUSH_MARK}
# This folder is a temporary copy made by Hearth AI Command Center. Work goes to the
# chat's own branch; main, the chat's base branch and tags change only when the owner
# approves a merge or release on GitHub.
while read local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    ${cases || 'refs/heads/main|refs/heads/master'}|refs/tags/*)
      echo "Hearth AI: pushing to \${remote_ref#refs/*/} is not allowed from a temporary copy. Push to the chat's own branch; merging asks the owner first." >&2
      exit 1;;
  esac
done
exit 0
`;
}

function createCopies({ dataDir, gitBin = 'git', urlFor = (repo) => `https://github.com/${repo}.git`, owner = () => null, now = () => new Date(), env = {} } = {}) {
  const root = path.join(dataDir, 'copies');
  const dirOf = (chatId) => { if (!CHAT_ID.test(String(chatId))) throw new Error('bad chat id'); return path.join(root, chatId); };
  const metaFile = (chatId) => `${dirOf(chatId)}.meta.json`;
  const ident = () => { const o = identity.cleanIdentity(owner()); return o || OWNER; };
  const busy = new Set(); // chats with a clone in progress

  function git(cwd, args, { timeoutMs = 120000, extraEnv = {} } = {}) {
    const id = ident();
    return new Promise((resolve) => {
      execFile(gitBin, args, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, ...env, ...identity.gitEnv(id), HEARTH_AI_APP: '1', GIT_TERMINAL_PROMPT: '0', ...extraEnv },
      }, (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout).replace(/\s+$/, ''), err: String(stderr).trim() || (error ? error.message : '') }));
    });
  }
  const lastLine = (r) => (r.err || r.out || '').split('\n').filter(Boolean).slice(-1)[0] || 'failed';

  function readMeta(chatId) {
    try { const j = JSON.parse(fs.readFileSync(metaFile(chatId), 'utf8')); return j && typeof j === 'object' ? j : null; } catch { return null; }
  }
  function writeMeta(chatId, meta) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const f = metaFile(chatId);
    const tmp = `${f}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, f);
  }
  const exists = (chatId) => fs.existsSync(path.join(dirOf(chatId), '.git'));

  // Which repo (or local folder) this copy was cloned from, read from git itself.
  async function originOf(chatId) {
    const r = await git(dirOf(chatId), ['remote', 'get-url', 'origin']);
    return r.ok ? { ...(sourceOf(r.out) || {}), url: r.out.trim() } : null;
  }
  // True only when the copy's origin AND its saved record are the chat's repo.
  async function belongs(chatId, conn) {
    if (!exists(chatId)) return false;
    const meta = readMeta(chatId);
    const o = await originOf(chatId);
    if (!o || !meta) return false;
    if (conn.repo) return Boolean((o.repo ? sameRepo(o.repo, conn.repo) : o.url.toLowerCase() === urlFor(conn.repo).toLowerCase()) && sameRepo(meta.repo, conn.repo));
    if (conn.dir) return Boolean(o.dir && o.dir === String(conn.dir).replace(/\/+$/, '') && meta.dir === conn.dir);
    return false;
  }

  async function setupCopy(dir, { base, work, defaultBranch }) {
    const id = ident();
    await git(dir, ['config', 'user.name', id.name]);
    await git(dir, ['config', 'user.email', id.email]);
    // AI attribution lines are stripped from every commit made here (hooks act on HEARTH_AI_APP=1).
    const hooks = path.join(dir, '.git', 'hooks');
    identity.installHooks(hooks);
    fs.writeFileSync(path.join(hooks, 'pre-push'), prePushHook(['main', 'master', base, defaultBranch].filter(Boolean)), { mode: 0o755 });
    // The app's own folders never show up in git status (local exclude, never the tracked .gitignore).
    const ex = path.join(dir, '.git', 'info', 'exclude');
    fs.mkdirSync(path.dirname(ex), { recursive: true });
    const cur = fs.existsSync(ex) ? fs.readFileSync(ex, 'utf8') : '';
    const add = APP_PATHS.filter((p) => !new RegExp(`^/?${p.replace('.', '\\.')}/?$`, 'm').test(cur)).map((p) => `${p}/`);
    if (add.length) fs.appendFileSync(ex, `\n${add.join('\n')}\n`);
    const r = await git(dir, ['checkout', '-q', '-b', work]);
    if (!r.ok) {
      const sw = await git(dir, ['checkout', '-q', work]);
      if (!sw.ok) throw new Error(`Could not start the chat's branch: ${lastLine(r)}`);
    }
  }

  // Make (or reuse) the chat's copy. conn: { repo: 'owner/name' } or { dir: '/local/repo' }.
  async function ensure({ chatId, repo = null, dir = null, branch, title = '', defaultBranch = null }) {
    const d = dirOf(chatId);
    const conn = repo ? { repo } : { dir };
    if (repo && !validRepo(repo)) throw new Error('bad repo');
    if (!repo && !(typeof dir === 'string' && path.isAbsolute(dir))) throw new Error('no repo');
    if (!validBranch(branch)) throw new Error('bad branch');
    if (exists(chatId)) {
      if (!(await belongs(chatId, conn))) {
        const e = new Error(`The temporary copy for this chat belongs to a different repo than ${repo || dir}, so it was not used. Nothing in it was changed.`);
        e.wrongRepo = true;
        throw e;
      }
      const meta = readMeta(chatId);
      if (meta.branch !== branch) {
        const e = new Error(`This chat's copy was made from ${meta.branch}, not ${branch}. Reconnect the chat to switch branches.`);
        e.wrongBranch = true;
        throw e;
      }
      meta.lastUsedAt = now().toISOString();
      writeMeta(chatId, meta);
      return { ...meta, dir: d, created: false };
    }
    if (busy.has(chatId)) throw new Error('This chat\'s copy is still being made.');
    busy.add(chatId);
    try {
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true }); // a half-made clone (no .git)
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      const url = repo ? urlFor(repo) : `file://${dir}`;
      const r = await git(root, ['clone', '--depth', '1', '--single-branch', '--no-tags', '--branch', branch, '--', url, d], { timeoutMs: 15 * 60000 });
      if (!r.ok) { fs.rmSync(d, { recursive: true, force: true }); throw new Error(`Could not copy ${repo || dir} (${branch}): ${lastLine(r)}`); }
      const baseSha = (await git(d, ['rev-parse', 'HEAD'])).out;
      const work = `hearth/${slug(title)}-${chatId.replace(/^team-/, '').slice(-4)}`;
      await setupCopy(d, { base: branch, work, defaultBranch });
      const meta = { chatId, ...(repo ? { repo } : { dir }), branch, work, baseSha, defaultBranch: defaultBranch || null, createdAt: now().toISOString(), lastUsedAt: now().toISOString(), shallow: true };
      writeMeta(chatId, meta);
      return { ...meta, dir: d, created: true };
    } finally { busy.delete(chatId); }
  }

  function touch(chatId) {
    const meta = readMeta(chatId);
    if (meta) { meta.lastUsedAt = now().toISOString(); writeMeta(chatId, meta); }
  }

  // Unpushed work: uncommitted changes, or commits that are on no remote branch.
  async function status(chatId) {
    if (!exists(chatId)) return { exists: false, unpushed: false, dirty: 0, ahead: 0 };
    const d = dirOf(chatId);
    const meta = readMeta(chatId) || {};
    const [st, ahead, head, branch] = await Promise.all([
      git(d, ['status', '--porcelain']),
      git(d, ['rev-list', '--count', 'HEAD', '--not', '--remotes']),
      git(d, ['rev-parse', 'HEAD']),
      git(d, ['branch', '--show-current']),
    ]);
    const dirty = st.out ? st.out.split('\n').filter(Boolean).length : 0;
    const n = ahead.ok ? Number(ahead.out) || 0 : 0;
    // A status we couldn't read counts as unpushed: never delete on a guess.
    const unknown = !st.ok || !ahead.ok;
    return { exists: true, dirty, ahead: n, unpushed: unknown || dirty > 0 || n > 0, unknown, head: head.out || null, branch: branch.out || meta.work, work: meta.work, base: meta.branch, repo: meta.repo || null, dir: meta.dir || null };
  }

  // Commit everything (except the app's own folders) as the owner.
  async function commitAll(chatId, message) {
    if (!exists(chatId)) return null;
    const d = dirOf(chatId);
    await git(d, ['add', '-A', '--', '.', ...APP_PATHS.map((p) => `:(exclude)${p}`)]);
    for (const p of APP_PATHS) await git(d, ['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', p]);
    const staged = await git(d, ['diff', '--cached', '--name-only']);
    if (!staged.out) return null;
    const id = ident();
    const msg = identity.stripTrailers(message || 'Work in chat').trim() || 'Work in chat';
    const r = await git(d, ['-c', `user.name=${id.name}`, '-c', `user.email=${id.email}`, 'commit', '-q', '--no-verify', '-m', msg]);
    if (!r.ok) throw new Error(`Could not save the work as a commit: ${lastLine(r)}`);
    const sha = (await git(d, ['rev-parse', 'HEAD'])).out;
    return { sha, files: staged.out.split('\n').filter(Boolean) };
  }

  // What changed on the chat's branch since the copy was made (commits + anything uncommitted).
  async function changes(chatId) {
    if (!exists(chatId)) return { files: [], add: 0, del: 0 };
    const d = dirOf(chatId);
    const meta = readMeta(chatId) || {};
    if (!meta.baseSha) return { files: [], add: 0, del: 0 };
    const r = await git(d, ['diff', '--numstat', meta.baseSha, '--', '.', ...APP_PATHS.map((p) => `:(exclude)${p}`)]);
    const files = (r.out ? r.out.split('\n') : []).map((l) => { const [a, b, ...p] = l.split('\t'); return { path: p.join('\t'), add: a === '-' ? 0 : Number(a) || 0, del: b === '-' ? 0 : Number(b) || 0, binary: a === '-' }; }).filter((f) => f.path);
    const log = await git(d, ['log', '--format=%h %s', `${meta.baseSha}..HEAD`, '-n', '50']);
    return { files, add: files.reduce((s, f) => s + f.add, 0), del: files.reduce((s, f) => s + f.del, 0), branch: meta.work, base: meta.branch, baseSha: meta.baseSha, commits: log.out ? log.out.split('\n') : [] };
  }

  async function diff(chatId, { maxBytes = 2 * 1024 * 1024 } = {}) {
    if (!exists(chatId)) return '';
    const meta = readMeta(chatId) || {};
    const r = await git(dirOf(chatId), ['diff', '--no-color', '--no-ext-diff', meta.baseSha, '--', '.', ...APP_PATHS.map((p) => `:(exclude)${p}`)]);
    return r.out.length > maxBytes ? `${r.out.slice(0, maxBytes)}\n… (diff cut at ${Math.round(maxBytes / 1024)} KB)` : r.out;
  }

  // Push the chat's own branch to GitHub after checking every new commit is the owner's.
  async function push(chatId) {
    if (!exists(chatId)) return { ok: false, message: 'This chat has no temporary copy.' };
    const d = dirOf(chatId);
    const meta = readMeta(chatId) || {};
    const work = meta.work;
    const prot = ['main', 'master', meta.branch, meta.defaultBranch].filter(Boolean);
    if (!validBranch(work) || !/^hearth\//.test(work) || prot.includes(work)) return { ok: false, message: `Not pushed: ${work || 'this branch'} isn't the chat's own branch.` };
    const cur = (await git(d, ['branch', '--show-current'])).out;
    if (cur !== work) return { ok: false, message: `Not pushed: the copy is on ${cur || 'no branch'}, not the chat's branch ${work}.` };
    await commitAll(chatId, 'Work in chat');
    const log = await git(d, ['log', identity.LOG_FORMAT, `${meta.baseSha}..HEAD`, '-n', '2000']);
    const scan = identity.scanCommits(identity.parseLog(log.out), ident());
    if (!scan.ok) return { ok: false, guard: scan.problems, message: `Not pushed: ${scan.problems.slice(0, 3).join('; ')}. Every commit must be yours only.` };
    if (!scan.count) return { ok: false, nothing: true, message: 'Nothing to push yet.' };
    const r = await git(d, ['push', '--no-follow-tags', '-u', 'origin', `HEAD:refs/heads/${work}`], { timeoutMs: 5 * 60000 });
    if (!r.ok) return { ok: false, message: `Not pushed: ${lastLine(r)}` };
    const sha = (await git(d, ['rev-parse', 'HEAD'])).out;
    // A single-branch clone doesn't track other branches, so record what GitHub now has
    // (status() counts commits that are on no remote branch as unpushed).
    await git(d, ['update-ref', `refs/remotes/origin/${work}`, sha]);
    meta.pushedSha = sha;
    meta.pushedAt = now().toISOString();
    writeMeta(chatId, meta);
    return { ok: true, branch: work, sha, message: `Pushed ${work}.` };
  }

  // Save a file into the copy at a path the owner chose, and commit it as the owner.
  async function writeFile(chatId, rel, content) {
    if (!exists(chatId)) return { ok: false, message: 'This chat has no temporary copy yet.' };
    const r = String(rel || '').trim();
    const parts = r.split(/[\\/]+/);
    if (!r || path.isAbsolute(r) || parts.includes('..') || parts[0] === '.git' || /[\0\r\n]/.test(r) || r.length > 300) return { ok: false, message: 'Use a plain path inside the repo, like docs/mockups/page.html.' };
    const file = path.resolve(dirOf(chatId), r);
    if (!file.startsWith(dirOf(chatId) + path.sep)) return { ok: false, message: 'That path is outside the repo.' };
    // Text from a preview, or the bytes of a picture/video/file the owner saves to the repo.
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ''), 'utf8');
    const cap = Buffer.isBuffer(content) ? 50 : 5;
    if (buf.length > cap * 1024 * 1024) return { ok: false, message: `That file is too big (over ${cap} MB).` };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    const c = await commitAll(chatId, `Add ${r}`);
    return { ok: true, path: r, sha: c?.sha || null };
  }

  // Delete a copy. Refused while it holds unpushed work, unless force (the owner said yes).
  async function remove(chatId, { force = false } = {}) {
    const d = dirOf(chatId);
    if (!fs.existsSync(d) && !fs.existsSync(metaFile(chatId))) return { ok: true, freed: 0, gone: true };
    const st = await status(chatId);
    if (st.unpushed && !force) return { ok: false, unpushed: true, status: st, message: 'This copy has work that isn\'t on GitHub yet.' };
    const real = (() => { try { return fs.realpathSync(d); } catch { return d; } })();
    if (!real.startsWith(fs.realpathSync(fs.existsSync(root) ? root : dataDir) + path.sep) && fs.existsSync(d)) return { ok: false, message: 'Refused: that folder is not one of the app\'s temporary copies.' };
    const freed = fs.existsSync(d) ? du(d) : 0;
    fs.rmSync(d, { recursive: true, force: true });
    try { fs.unlinkSync(metaFile(chatId)); } catch {}
    return { ok: true, freed };
  }

  async function list() {
    let names = [];
    try { names = fs.readdirSync(root); } catch {}
    const ids = [...new Set(names.map((n) => n.replace(/\.meta\.json$/, '')).filter((n) => CHAT_ID.test(n)))];
    const out = [];
    for (const id of ids) {
      const meta = readMeta(id) || { chatId: id };
      const st = await status(id);
      out.push({ chatId: id, repo: meta.repo || null, dir: meta.dir || null, branch: meta.branch || null, work: meta.work || null, createdAt: meta.createdAt || null, lastUsedAt: meta.lastUsedAt || null, pushedAt: meta.pushedAt || null, size: fs.existsSync(dirOf(id)) ? du(dirOf(id)) : 0, exists: st.exists, unpushed: st.unpushed, dirty: st.dirty || 0, ahead: st.ahead || 0 });
    }
    return out.sort((a, b) => String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')));
  }

  // Idle copies go away; ones holding unpushed work stay and are reported so the owner can decide.
  async function sweep({ idleHours = 24, skip = [] } = {}) {
    const removed = [];
    const keptUnpushed = [];
    if (!(idleHours > 0)) return { removed, keptUnpushed };
    const limit = now().getTime() - idleHours * 3600e3;
    for (const c of await list()) {
      if (skip.includes(c.chatId)) continue;
      const last = Date.parse(c.lastUsedAt || c.createdAt || '') || 0;
      if (last > limit) continue;
      if (c.unpushed) { keptUnpushed.push(c); continue; }
      const r = await remove(c.chatId);
      if (r.ok) removed.push({ ...c, freed: r.freed });
    }
    return { removed, keptUnpushed };
  }

  return { root, dirOf, exists, ensure, belongs, originOf, status, commitAll, changes, diff, push, writeFile, remove, list, sweep, touch, readMeta, git };
}

module.exports = { createCopies, sourceOf, sameRepo, validRepo, validBranch, prePushHook, du, slug, CHAT_ID, REPO_RE, OWNER, APP_PATHS, PREPUSH_MARK };

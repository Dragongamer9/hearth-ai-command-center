// Team workflow in the main process (git only, argument arrays, never main/tags/releases
// except reading them): task truth facts, the verified starting workspace (fetch,
// fast-forward local main, merge main into the task branch, runtime check), verify-only
// and docs-only enforcement, the sha lock's follow-up branch, the review packet's diff,
// the lead's standing MERGE MAIN / REVERT on hearth/ branches, the asset scan and the
// release preview's facts. `git(cwd, args, opts)` resolves { ok, out, err }.
const fs = require('node:fs');
const path = require('node:path');

const SHA = /^[0-9a-f]{7,40}$/;
const MEDIA = /\.(png|jpe?g|webp|gif|mp4|webm|mov)$/i;
const APP_DIR = '.hearth-ai';
const DEFAULT_DOCS = ['*.md', '**/*.md', 'docs/**', 'release-notes/**'];

const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
async function branchOf(git, dir) { return (await git(dir, ['branch', '--show-current'])).out; }
async function headOf(git, dir) { const r = await git(dir, ['rev-parse', 'HEAD']); return r.ok ? r.out : null; }
async function refOk(git, dir, ref) { return (await git(dir, ['rev-parse', '--verify', '--quiet', ref])).ok; }
const isAncestor = async (git, dir, a, b) => (await git(dir, ['merge-base', '--is-ancestor', a, b])).ok;

// ---------- A. truth facts ----------
// "3 files changed, 10 insertions(+), 2 deletions(-)" -> "3 files, +10 −2"
function shortStat(t) {
  const n = (re) => Number((String(t).match(re) || [])[1] || 0);
  const f = n(/(\d+) files? changed/);
  return f ? `${f} file${f > 1 ? 's' : ''}, +${n(/(\d+) insertions?/)} −${n(/(\d+) deletions?/)}` : '';
}
async function truthFacts({ git, dir, def = 'main' }) {
  if (!dir || !fs.existsSync(dir)) return { known: false };
  const head = await headOf(git, dir);
  if (!head) return { known: false };
  const branch = await branchOf(git, dir);
  const counts = (await git(dir, ['rev-list', '--left-right', '--count', `${def}...HEAD`])).out.split(/\s+/).map(Number);
  const stat = shortStat((await git(dir, ['diff', '--shortstat', `${def}...HEAD`])).out);
  const dirty = Boolean((await git(dir, ['status', '--porcelain'])).out);
  let merged = null;
  if (await isAncestor(git, dir, head, def)) merged = 'main';
  else {
    for (const ref of ['refs/heads/release/next', 'refs/remotes/origin/release/next']) {
      if ((await refOk(git, dir, ref)) && (await isAncestor(git, dir, head, ref))) { merged = 'release/next'; break; }
    }
  }
  return { known: true, branch, head, behind: Number.isFinite(counts[0]) ? counts[0] : null, ahead: Number.isFinite(counts[1]) ? counts[1] : null, stat, dirty, merged };
}

// ---------- D. verified starting workspace ----------
// Fetch and fast-forward the local main branch (never a merge or reset of main).
async function syncMain({ git, project, def = 'main' }) {
  if (!(await git(project, ['remote', 'get-url', 'origin'])).ok) return { ok: true, note: 'no remote: local main used as is', main: await headOf(git, project) };
  const f = await git(project, ['fetch', '--quiet', '--no-tags', 'origin', def], { timeoutMs: 90000 });
  if (!f.ok) return { ok: true, note: `fetch failed (${lines(f.err).slice(-1)[0] || 'offline'}): local main used as is`, main: (await git(project, ['rev-parse', def])).out };
  const remote = `refs/remotes/origin/${def}`;
  const local = (await git(project, ['rev-parse', def])).out;
  const theirs = (await git(project, ['rev-parse', remote])).out;
  if (!theirs || local === theirs) return { ok: true, note: 'main is up to date', main: local };
  if (!(await isAncestor(git, project, def, remote))) return { ok: true, note: `local ${def} has commits that aren't on origin; not fast-forwarded`, main: local };
  if ((await branchOf(git, project)) === def) {
    if ((await git(project, ['status', '--porcelain'])).out) return { ok: true, note: `the project folder has uncommitted changes on ${def}; not fast-forwarded`, main: local };
    const r = await git(project, ['merge', '--ff-only', '--quiet', remote]);
    return { ok: true, moved: r.ok, note: r.ok ? `fast-forwarded ${def} to ${theirs.slice(0, 7)}` : `fast-forward failed: ${lines(r.err).slice(-1)[0]}`, main: r.ok ? theirs : local };
  }
  const r = await git(project, ['update-ref', `refs/heads/${def}`, theirs, local]);
  return { ok: true, moved: r.ok, note: r.ok ? `fast-forwarded ${def} to ${theirs.slice(0, 7)}` : 'fast-forward failed', main: r.ok ? theirs : local };
}

// Merge main into the task branch (inside its worktree). Conflicts abort and are reported.
async function mergeMain({ git, dir, def = 'main', why = 'before the next run' }) {
  const branch = await branchOf(git, dir);
  if (!/^hearth\//.test(branch)) return { ok: false, reason: `${branch || 'this worktree'} is not a hearth/ task branch` };
  const behind = Number((await git(dir, ['rev-list', '--count', `HEAD..${def}`])).out) || 0;
  if (!behind) return { ok: true, merged: 0, note: `${branch} already has everything on ${def}` };
  if ((await git(dir, ['status', '--porcelain'])).out) return { ok: false, reason: 'the task workspace has uncommitted changes' };
  const before = await headOf(git, dir);
  const r = await git(dir, ['merge', '--no-edit', '-m', `Merge ${def} into ${branch} (${why})`, def], { timeoutMs: 120000 });
  if (!r.ok) {
    const conflicts = lines((await git(dir, ['diff', '--name-only', '--diff-filter=U'])).out);
    await git(dir, ['merge', '--abort']);
    return { ok: false, conflict: true, conflicts, reason: conflicts.length ? `merging ${def} conflicts in ${conflicts.join(', ')}` : `merging ${def} failed: ${lines(r.err).slice(-1)[0]}` };
  }
  return { ok: true, merged: behind, before, head: await headOf(git, dir), note: `merged ${behind} commit(s) from ${def} into ${branch}` };
}

// "^20", ">=18.17", "20.x", "18 || 20", "~22.1" against "22.22.0".
function nodeSatisfies(range, version) {
  const v = String(version || '').replace(/^v/, '').split('.').map(Number);
  const cmp = (a) => { for (let i = 0; i < 3; i++) { const d = (v[i] || 0) - (a[i] || 0); if (d) return d; } return 0; };
  const one = (r) => {
    const parts = r.trim().split(/\s+/).filter(Boolean);
    if (!parts.length || parts[0] === '*') return true;
    return parts.every((p) => {
      const m = p.match(/^(>=|<=|>|<|\^|~|=)?v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/);
      if (!m) return true;
      const a = [Number(m[2]), /\d/.test(m[3] || '') ? Number(m[3]) : 0, /\d/.test(m[4] || '') ? Number(m[4]) : 0];
      const c = cmp(a);
      switch (m[1]) {
        case '>=': return c >= 0;
        case '>': return c > 0;
        case '<=': return c <= 0;
        case '<': return c < 0;
        case '^': return v[0] === a[0] && c >= 0;
        case '~': return v[0] === a[0] && v[1] === a[1] && c >= 0;
        default: return m[3] === undefined || !/\d/.test(m[3]) ? v[0] === a[0] : v[0] === a[0] && v[1] === a[1];
      }
    });
  };
  return String(range || '*').split('||').some(one);
}

// What the project needs to run its checks here. Returns blockers with the next action.
function runtimeCheck(dir, { nodeVersion = null, has = () => true } = {}) {
  const out = [];
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return out; }
  const engines = pkg?.engines?.node;
  if (!nodeVersion) out.push({ kind: 'tool', title: 'Node.js not found', detail: 'node is not installed or not on PATH.', next: `Install Node.js${engines ? ` ${engines}` : ''}.` });
  else if (engines && !nodeSatisfies(engines, nodeVersion)) out.push({ kind: 'environment', title: 'Wrong Node version', detail: `The project wants Node ${engines}; this computer has ${nodeVersion}.`, next: `Install Node ${engines} (e.g. with nvm) for this project.` });
  const test = String(pkg?.scripts?.test || '');
  if (nodeVersion && /node\s+--test\b[^&|;]*['"][^'"]*\*[^'"]*['"]/.test(test) && Number(String(nodeVersion).replace(/^v/, '').split('.')[0]) < 21) {
    out.push({ kind: 'environment', title: 'Test glob needs Node 21+', detail: `npm test runs \`${test}\`; Node ${nodeVersion} doesn't expand quoted globs, so the tests can't be found.`, next: 'Use Node 22 for this project, or set the test command on the Project page to an unquoted glob.' });
  }
  const pm = fs.existsSync(path.join(dir, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(dir, 'yarn.lock')) ? 'yarn' : fs.existsSync(path.join(dir, 'bun.lockb')) ? 'bun' : 'npm';
  if (!has(pm)) out.push({ kind: 'tool', title: `${pm} not installed`, detail: `The project uses ${pm} (from its lockfile).`, next: `Install ${pm}.` });
  const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).length;
  if (deps && !fs.existsSync(path.join(dir, 'node_modules'))) out.push({ kind: 'dependency', title: 'Dependencies not installed', detail: `${deps} package(s) in package.json, no node_modules in this workspace.`, next: `Set the test command to "${pm === 'npm' ? 'npm ci' : `${pm} install`} && ${pm} test" on the Project page, or install them in the workspace.` });
  return out;
}

// ---------- E/F/J. enforcement ----------
// The state of the workspace: head, porcelain status, and a fingerprint of every
// uncommitted change (tracked edits via `git stash create`, untracked files by content),
// so edits to files that were already dirty before the run are detected too.
async function untrackedHashes(git, dir) {
  const files = lines((await git(dir, ['ls-files', '-o', '--exclude-standard'])).out).filter((p) => !p.startsWith(`${APP_DIR}/`));
  const out = [];
  for (const p of files.slice(0, 2000)) out.push(`${p}:${(await git(dir, ['hash-object', '--', p])).out}`);
  return out;
}
async function snapshot({ git, dir }) {
  const head = await headOf(git, dir);
  const stash = (await git(dir, ['stash', 'create'])).out || null;
  const tree = stash ? (await git(dir, ['rev-parse', `${stash}^{tree}`])).out : head ? (await git(dir, ['rev-parse', `${head}^{tree}`])).out : null;
  return { head, status: (await git(dir, ['status', '--porcelain'])).out, stash, tree, untracked: await untrackedHashes(git, dir) };
}

// A verify-only run may not change anything. New commits are kept on
// refs/hearth/discarded/<task>/<stamp> and reset away; changed tracked files are kept on
// refs/hearth/discarded/<task>/<stamp>-tree (a `git stash create` commit, not the shared
// stash); new untracked files move to .hearth-ai/discarded/<stamp>/. The workspace goes
// back to exactly the state before the run, including edits that were already there.
async function enforceVerify({ git, dir, before, stamp = Date.now(), taskId = 'task' }) {
  const after = await snapshot({ git, dir });
  const tag = `${String(taskId).replace(/[^A-Za-z0-9]/g, '') || 'task'}/${stamp}`;
  const headMoved = Boolean(after.head && before.head && after.head !== before.head);
  const commits = headMoved ? lines((await git(dir, ['log', '--format=%h %s', `${before.head}..${after.head}`])).out) : [];
  const beforeUntracked = new Set(before.untracked || []);
  const newUntracked = after.untracked.filter((x) => !beforeUntracked.has(x)).map((x) => x.slice(0, x.lastIndexOf(':')));
  let tracked = [];
  if (before.tree && after.tree && before.tree !== after.tree) {
    // Compare the worktree states, ignoring what the commits themselves changed.
    const afterWork = after.stash ? after.tree : null;
    const base = headMoved ? (await git(dir, ['rev-parse', `${after.head}^{tree}`])).out : before.tree;
    tracked = afterWork ? lines((await git(dir, ['diff', '--name-only', base, afterWork])).out) : [];
    if (!headMoved && !afterWork) tracked = lines((await git(dir, ['diff', '--name-only', before.tree, after.tree])).out);
  }
  const files = [...new Set([...tracked, ...newUntracked])];
  let backupRef = null;
  let treeRef = null;
  if (after.stash) { treeRef = `refs/hearth/discarded/${tag}-tree`; await git(dir, ['update-ref', treeRef, after.stash]); }
  if (headMoved) { backupRef = `refs/hearth/discarded/${tag}`; await git(dir, ['update-ref', backupRef, after.head]); }
  if (headMoved || tracked.length) await git(dir, ['reset', '--hard', '--quiet', before.head]);
  if (before.stash && (headMoved || tracked.length)) await git(dir, ['stash', 'apply', '--quiet', before.stash]);
  for (const p of newUntracked) {
    const dest = path.join(dir, APP_DIR, 'discarded', String(stamp), p);
    try { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(path.join(dir, p), dest); } catch {}
  }
  const ok = !commits.length && !files.length && !headMoved;
  return { ok, commits, files, backupRef, treeRef: files.length ? treeRef : null, stash: Boolean(treeRef && files.length), head: await headOf(git, dir) };
}

function globRe(g) {
  const re = String(g).trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*');
  return new RegExp(`^${re}$`);
}
function docsMatcher(globs = DEFAULT_DOCS) {
  const list = (Array.isArray(globs) && globs.length ? globs : DEFAULT_DOCS).map(globRe);
  return (p) => list.some((re) => re.test(p));
}
// `git status --porcelain=v2 -uall` (v1's leading space is lost when output is trimmed).
const statusPaths = (out, { untrackedOnly = false } = {}) => lines(out).map((l) => {
  if (l.startsWith('? ')) return l.slice(2);
  if (untrackedOnly) return null;
  if (l.startsWith('1 ')) return l.split(' ').slice(8).join(' ');
  if (l.startsWith('2 ')) return l.split(' ').slice(9).join(' ').split('\t')[0];
  if (l.startsWith('u ')) return l.split(' ').slice(10).join(' ');
  return null;
}).filter(Boolean);

// Docs and research runs may only change docs files: anything else changed since the run
// started (committed or not) is put back as it was at the start and reported. Renames are
// seen as both paths (the source of a rename out of the docs paths is restored), and every
// path is literal (a file named ":(glob)**" is just a file name).
async function enforceDocs({ git, dir, startSha, globs }) {
  const ok = docsMatcher(globs);
  const L = (args) => git(dir, ['--literal-pathspecs', ...args]);
  await L(['add', '-A', '--', '.']);
  await L(['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', APP_DIR]);
  const entries = startSha ? lines((await L(['diff', '--cached', '--name-status', '-M', startSha])).out).map((l) => l.split('\t')) : [];
  const changed = new Set();
  const restore = new Set(); // paths to put back as they were at the start
  const drop = new Set(); // paths that didn't exist at the start
  for (const [st, a, b] of entries) {
    const paths = /^[RC]/.test(st) ? [a, b] : [a];
    for (const p of paths) changed.add(p);
    const bad = paths.some((p) => p && !p.startsWith(`${APP_DIR}/`) && !ok(p));
    if (!bad) continue;
    if (/^R/.test(st)) { restore.add(a); if (!ok(b)) drop.add(b); else restore.add(a); }
    else if (/^C/.test(st)) { if (!ok(b)) drop.add(b); }
    else if (st === 'A') drop.add(a);
    else restore.add(a);
  }
  for (const p of restore) await L(['checkout', startSha, '--', p]);
  for (const p of drop) { await L(['rm', '-q', '-f', '--cached', '--ignore-unmatch', '--', p]); try { fs.rmSync(path.join(dir, p), { force: true }); } catch {} }
  return { ok: !restore.size && !drop.size, discarded: [...new Set([...drop, ...restore])], kept: [...changed].filter((p) => ok(p) && !drop.has(p) && !restore.has(p)) };
}

// The sha lock: commits after the approved one move to a follow-up branch and the task
// branch goes back to exactly the approved commit, so the review stays valid.
async function splitFollowup({ git, dir, approved }) {
  if (!SHA.test(String(approved || ''))) return { ok: false, reason: 'no approved commit recorded' };
  const head = await headOf(git, dir);
  if (!head) return { ok: false, reason: 'no task branch' };
  if (head === approved || head.startsWith(approved)) return { ok: true, moved: false };
  if (!(await isAncestor(git, dir, approved, head))) return { ok: false, reason: `the approved commit ${approved.slice(0, 7)} is no longer on this branch` };
  if ((await git(dir, ['status', '--porcelain'])).out) return { ok: false, reason: 'the task workspace has uncommitted changes' };
  const branch = await branchOf(git, dir);
  if (!/^hearth\//.test(branch)) return { ok: false, reason: `${branch} is not a hearth/ task branch` };
  // Commits after the approval that are already on GitHub are never reset away.
  const remote = `refs/remotes/origin/${branch}`;
  if ((await refOk(git, dir, remote)) && !(await isAncestor(git, dir, remote, approved))) {
    return { ok: false, pushed: true, reason: `origin/${branch} already has commits after the approved ${approved.slice(0, 7)}, so they can't be split off without rewriting pushed history` };
  }
  let name = `${branch}-followup-${head.slice(0, 7)}`;
  for (let i = 2; await refOk(git, dir, `refs/heads/${name}`); i++) name = `${branch}-followup-${head.slice(0, 7)}-${i}`;
  const b = await git(dir, ['branch', name, head]);
  if (!b.ok) return { ok: false, reason: `could not create ${name}: ${lines(b.err).slice(-1)[0]}` };
  const commits = lines((await git(dir, ['log', '--format=%h %s', `${approved}..${head}`])).out);
  const r = await git(dir, ['reset', '--hard', '--quiet', approved]);
  if (!r.ok) return { ok: false, reason: `reset failed: ${lines(r.err).slice(-1)[0]}` };
  return { ok: true, moved: true, followup: name, commits, from: head, to: approved };
}

// ---------- G. the review packet's diff ----------
// Only the task's own changes: vs main it is `main...HEAD`; since the reviewer's last
// sign-off it is HEAD against (sign-off + current main merged), so main's changes that
// were merged in don't push the real change out of view.
async function reviewData({ git, dir, from = null, def = 'main', changes = [] }) {
  const head = await headOf(git, dir);
  if (!head) return { ok: false };
  const signed = from && SHA.test(from) && (await isAncestor(git, dir, from, head)) ? from : null;
  let baseTree = null;
  let label = def;
  let base = (await git(dir, ['merge-base', def, 'HEAD'])).out || null;
  if (signed) {
    label = 'your last sign-off';
    base = signed;
    const mt = await git(dir, ['merge-tree', '--write-tree', signed, def]);
    baseTree = mt.ok ? lines(mt.out)[0] : null;
    if (!baseTree && (await isAncestor(git, dir, def, signed))) baseTree = signed;
  }
  const diffFrom = baseTree || base;
  const commitsAfter = {};
  for (const sha of changes.filter((x) => SHA.test(String(x))).slice(0, 5)) {
    commitsAfter[sha] = (await isAncestor(git, dir, sha, head)) ? lines((await git(dir, ['log', '--no-merges', '--first-parent', '--format=%h %s', `${sha}..${head}`])).out) : [];
  }
  return {
    ok: true, head, base, baseLabel: label,
    log: (await git(dir, ['log', '--no-merges', '--first-parent', '--format=%h %s', ...(signed ? [`${signed}..${head}`] : [`${def}..${head}`])])).out.slice(0, 4000),
    stat: diffFrom ? (await git(dir, ['diff', '--stat', diffFrom, head])).out.slice(0, 4000) : '',
    diff: diffFrom ? (await git(dir, ['diff', diffFrom, head])).out.slice(0, 12000) : '',
    commitsAfter,
  };
}

// ---------- D. the lead's standing permissions on hearth/ task branches ----------
async function revertOnTask({ git, dir, sha, def = 'main' }) {
  const branch = await branchOf(git, dir);
  if (!/^hearth\//.test(branch)) return { ok: false, reason: `${branch || 'this worktree'} is not a hearth/ task branch` };
  if (!SHA.test(String(sha || ''))) return { ok: false, reason: 'that is not a commit id' };
  const full = (await git(dir, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`])).out;
  if (!full) return { ok: false, reason: `there is no commit ${sha}` };
  if (await isAncestor(git, dir, full, def)) return { ok: false, reason: `${sha.slice(0, 7)} is already on ${def}; only commits made on the task branch can be reverted here` };
  if (!(await isAncestor(git, dir, full, 'HEAD'))) return { ok: false, reason: `${sha.slice(0, 7)} is not on ${branch}` };
  if ((await git(dir, ['status', '--porcelain'])).out) return { ok: false, reason: 'the task workspace has uncommitted changes' };
  // Reverting a merge of main would take main's changes back out of the task branch (and
  // a later merge would delete them from main): refused. Other merges revert on parent 1.
  const parents = (await git(dir, ['rev-list', '--parents', '-n', '1', full])).out.split(/\s+/).slice(1);
  if (parents.length > 1 && (await isAncestor(git, dir, parents[1], def))) return { ok: false, reason: `${sha.slice(0, 7)} merges ${def} into the task branch; reverting it would remove ${def}'s changes. Undo a MERGE MAIN with the Undo button right after it instead` };
  const r = await git(dir, ['revert', '--no-edit', ...(parents.length > 1 ? ['-m', '1'] : []), full]);
  if (!r.ok) { await git(dir, ['revert', '--abort']); return { ok: false, reason: `the revert conflicts: ${lines(r.err).slice(-1)[0]}` }; }
  const head = await headOf(git, dir);
  return { ok: true, head, reverted: full, message: `Reverted ${full.slice(0, 7)} on ${branch} as ${head.slice(0, 7)} (undo reverts the revert).` };
}

// Undo of the lead's MERGE MAIN: back to the commit before it, only while that merge is
// still the branch head (nothing came after it) and it hasn't been pushed.
async function undoMergeMain({ git, dir, merge, before }) {
  if (!SHA.test(String(merge || '')) || !SHA.test(String(before || ''))) return { ok: false, reason: 'no merge recorded' };
  const branch = await branchOf(git, dir);
  if (!/^hearth\//.test(branch)) return { ok: false, reason: `${branch || 'this worktree'} is not a hearth/ task branch` };
  const head = await headOf(git, dir);
  if (head !== merge) return { ok: false, reason: `${branch} has moved on since that merge (now ${String(head).slice(0, 7)}), so it can't be undone without losing later work` };
  const remote = `refs/remotes/origin/${branch}`;
  if ((await refOk(git, dir, remote)) && (await isAncestor(git, dir, merge, remote))) return { ok: false, reason: `the merge is already pushed to origin/${branch}` };
  if ((await git(dir, ['status', '--porcelain'])).out) return { ok: false, reason: 'the task workspace has uncommitted changes' };
  const r = await git(dir, ['reset', '--hard', '--quiet', before]);
  return r.ok ? { ok: true, head: before, message: `Undid the merge of main on ${branch}: back at ${before.slice(0, 7)}.` } : { ok: false, reason: lines(r.err).slice(-1)[0] || 'reset failed' };
}

// ---------- K. the asset pipeline ----------
// New image/video files after a run: untracked ones in the worktree (outside .hearth-ai/),
// new files in the AI's own assets folder, and existing files its reply mentions.
async function scanAssets({ git, dir, assetsDir = null, text = '', sinceMs = 0 }) {
  const found = [];
  const add = (abs, source, move) => {
    const rel = path.relative(dir, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !MEDIA.test(rel) || found.some((f) => f.rel === rel)) return;
    try { if (!fs.statSync(abs).isFile()) return; } catch { return; }
    found.push({ rel, source, move });
  };
  for (const p of statusPaths((await git(dir, ['status', '--porcelain=v2', '-uall'])).out, { untrackedOnly: true })) {
    if (!p.startsWith(`${APP_DIR}/`)) add(path.join(dir, p), 'workspace', false);
  }
  if (assetsDir) {
    try { for (const n of fs.readdirSync(assetsDir)) { const f = path.join(assetsDir, n); try { if (fs.statSync(f).mtimeMs >= sinceMs - 2000) add(f, 'assets', false); } catch {} } } catch {}
  }
  for (const m of String(text || '').matchAll(/(?:^|[\s`'"(\[])((?:\/|\.\/)?[\w.@+\-/]+\.(?:png|jpe?g|webp|gif|mp4|webm|mov))\b/gim)) {
    const p = m[1];
    const abs = path.isAbsolute(p) ? p : path.resolve(dir, p);
    add(abs, 'mentioned', false);
  }
  return found.slice(0, 8);
}
// Copy a workspace file into the AI's assets folder (unique name). The workspace file is
// never moved or removed: it may be part of the project. Returns the copy's relative path.
function copyIntoAssets(dir, rel, assetsDir) {
  fs.mkdirSync(assetsDir, { recursive: true });
  const base = path.basename(rel);
  let dest = path.join(assetsDir, base);
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(assetsDir, `${path.parse(base).name}-${i}${path.extname(base)}`);
  fs.copyFileSync(path.join(dir, rel), dest);
  return path.relative(dir, dest);
}

// ---------- I. release preview facts ----------
async function releaseFacts({ git, dir, ref, version, versionFile = 'package.json', notesDir = 'release-notes' }) {
  const ver = String(version || '').replace(/^v/, '');
  const sha = (await git(dir, ['rev-parse', ref])).out;
  if (!sha) return { ok: false, reason: `can't read ${ref}` };
  const lastTag = (await git(dir, ['describe', '--tags', '--abbrev=0', `${sha}^`])).out || null;
  const range = lastTag ? `${lastTag}..${sha}` : sha;
  const commits = lines((await git(dir, ['log', '--format=%H\t%s', range])).out).map((l) => { const [s, ...r] = l.split('\t'); return { sha: s, subject: r.join('\t') }; });
  const tasks = [];
  for (const c of commits) {
    const m = c.subject.match(/^Merge (?:branch ')?hearth\/([a-z0-9]{4,10})-([a-z0-9-]*)/i);
    if (m && !tasks.some((t) => t.id === m[1].toUpperCase())) tasks.push({ id: m[1].toUpperCase(), title: m[2].replace(/-/g, ' '), sha: c.sha });
  }
  const notesRel = `${notesDir}/v${ver}.md`;
  const notes = await git(dir, ['show', `${sha}:${notesRel}`]);
  const vf = await git(dir, ['show', `${sha}:${versionFile}`]);
  return { ok: true, sha, lastTag, commits, tasks, notesRel, notes: notes.ok ? notes.out : null, versionText: vf.ok ? vf.out : '' };
}
// Tags on the remote: [{ name, sha }].
function parseLsRemote(out) {
  const m = new Map();
  for (const l of lines(out)) {
    const [sha, ref] = l.split(/\s+/);
    const name = String(ref || '').replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '');
    if (name && sha && (!m.has(name) || ref.endsWith('^{}'))) m.set(name, sha);
  }
  return [...m].map(([name, sha]) => ({ name, sha }));
}

module.exports = { shortStat, truthFacts, syncMain, mergeMain, nodeSatisfies, runtimeCheck, snapshot, enforceVerify, enforceDocs, docsMatcher, splitFollowup, reviewData, revertOnTask, undoMergeMain, scanAssets, copyIntoAssets, releaseFacts, parseLsRemote, DEFAULT_DOCS };

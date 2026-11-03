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
// New media under these folders is part of the project: attached as a copy, never moved.
const KEEP_DIRS = /^(src|public|build|assets|static|res|resources|docs|images|img|icons)\//;
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
async function snapshot({ git, dir }) { return { head: await headOf(git, dir), status: (await git(dir, ['status', '--porcelain'])).out }; }

// A verify-only run may not change anything: new commits are moved to a backup ref and
// reset away; working-tree changes are stashed (both recoverable). Reported as violations.
async function enforceVerify({ git, dir, before, stamp = Date.now() }) {
  const after = await snapshot({ git, dir });
  const commits = after.head && before.head && after.head !== before.head ? lines((await git(dir, ['log', '--format=%h %s', `${before.head}..${after.head}`])).out) : [];
  const files = after.status !== before.status ? lines(after.status).filter((l) => !lines(before.status).includes(l)) : [];
  let stash = false;
  let backupRef = null;
  if (files.length) stash = (await git(dir, ['stash', 'push', '--include-untracked', '-m', `Hearth verify-only run: discarded changes (${stamp})`, '--', '.', `:(exclude)${APP_DIR}`])).ok;
  if (commits.length || (after.head && after.head !== before.head)) {
    backupRef = `refs/hearth/discarded/${stamp}`;
    await git(dir, ['update-ref', backupRef, after.head]);
    await git(dir, ['reset', '--hard', '--quiet', before.head]);
  }
  return { ok: !commits.length && !files.length && after.head === before.head, commits, files, stash, backupRef, head: await headOf(git, dir) };
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
// started (committed or not) is put back as it was at the start and reported.
async function enforceDocs({ git, dir, startSha, globs }) {
  const ok = docsMatcher(globs);
  const committed = startSha ? lines((await git(dir, ['diff', '--name-only', startSha, 'HEAD'])).out) : [];
  const working = statusPaths((await git(dir, ['status', '--porcelain=v2', '-uall'])).out);
  const changed = [...new Set([...committed, ...working])].filter((p) => p && !p.startsWith(`${APP_DIR}/`));
  const bad = changed.filter((p) => !ok(p));
  for (const p of bad) {
    if (startSha && (await git(dir, ['cat-file', '-e', `${startSha}:${p}`])).ok) await git(dir, ['checkout', startSha, '--', p]);
    else { await git(dir, ['rm', '-q', '-f', '--cached', '--ignore-unmatch', '--', p]); try { fs.rmSync(path.join(dir, p), { force: true }); } catch {} }
  }
  return { ok: !bad.length, discarded: bad, kept: changed.filter(ok) };
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
async function reviewData({ git, dir, from = null, def = 'main', changes = [] }) {
  const head = await headOf(git, dir);
  if (!head) return { ok: false };
  let base = from && SHA.test(from) && (await isAncestor(git, dir, from, head)) ? from : null;
  const label = base ? 'your last sign-off' : def;
  if (!base) base = (await git(dir, ['merge-base', def, 'HEAD'])).out || null;
  const range = base ? `${base}..${head}` : head;
  const commitsAfter = {};
  for (const sha of changes.filter((x) => SHA.test(String(x))).slice(0, 5)) {
    commitsAfter[sha] = (await isAncestor(git, dir, sha, head)) ? lines((await git(dir, ['log', '--format=%h %s', `${sha}..${head}`])).out) : [];
  }
  return {
    ok: true, head, base, baseLabel: label,
    log: (await git(dir, ['log', '--format=%h %s', range])).out.slice(0, 4000),
    stat: base ? (await git(dir, ['diff', '--stat', base, head])).out.slice(0, 4000) : '',
    diff: base ? (await git(dir, ['diff', base, head])).out.slice(0, 12000) : '',
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
  // A merge commit (e.g. the lead's MERGE MAIN) is reverted against its first parent.
  const parents = (await git(dir, ['rev-list', '--parents', '-n', '1', full])).out.split(/\s+/).length - 1;
  const r = await git(dir, ['revert', '--no-edit', ...(parents > 1 ? ['-m', '1'] : []), full]);
  if (!r.ok) { await git(dir, ['revert', '--abort']); return { ok: false, reason: `the revert conflicts: ${lines(r.err).slice(-1)[0]}` }; }
  const head = await headOf(git, dir);
  return { ok: true, head, reverted: full, message: `Reverted ${full.slice(0, 7)} on ${branch} as ${head.slice(0, 7)} (undo reverts the revert).` };
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
    if (!p.startsWith(`${APP_DIR}/`)) add(path.join(dir, p), 'workspace', !KEEP_DIRS.test(p));
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
// Move a workspace file into the assets folder (unique name); returns its new relative path.
function moveIntoAssets(dir, rel, assetsDir) {
  fs.mkdirSync(assetsDir, { recursive: true });
  const base = path.basename(rel);
  let dest = path.join(assetsDir, base);
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(assetsDir, `${path.parse(base).name}-${i}${path.extname(base)}`);
  fs.renameSync(path.join(dir, rel), dest);
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

module.exports = { shortStat, truthFacts, syncMain, mergeMain, nodeSatisfies, runtimeCheck, snapshot, enforceVerify, enforceDocs, docsMatcher, splitFollowup, reviewData, revertOnTask, scanAssets, moveIntoAssets, releaseFacts, parseLsRemote, DEFAULT_DOCS };

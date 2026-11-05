// GitHub for chats, through the owner's own GitHub CLI sign-in (gh auth login). REST only,
// execFile with argument arrays (never a shell). Reads repos, branches and Actions runs;
// opens pull requests; merges only from chat:merge after the owner's native yes.
const { execFile } = require('node:child_process');
const ci = require('./ops/ci.cjs');
const { summarizePr } = require('./git.cjs');
const { validRepo, validBranch } = require('./copies.cjs');

function createGithub({ ghBin }) {
  function gh(args, { timeoutMs = 45000 } = {}) {
    const bin = typeof ghBin === 'function' ? ghBin() : ghBin;
    if (!bin) return Promise.resolve({ ok: false, out: '', err: 'GitHub CLI (gh) is not installed.' });
    return new Promise((resolve) => execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' } }, (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout).trim(), err: String(stderr).trim() || (error ? error.message : '') })));
  }
  const json = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
  const fail = (r) => ({ ok: false, message: (r.err || r.out || 'failed').split('\n').filter(Boolean).slice(-1)[0] });

  async function repos() {
    const r = await gh(['repo', 'list', '--limit', '200', '--json', 'nameWithOwner,isPrivate,pushedAt,defaultBranchRef,description']);
    if (!r.ok) return fail(r);
    return { ok: true, repos: parseRepos(json(r)) };
  }
  async function branches(repo) {
    if (!validRepo(repo)) return { ok: false, message: 'Bad repo.' };
    const [b, info] = await Promise.all([gh(['api', `repos/${repo}/branches?per_page=100`]), gh(['api', `repos/${repo}`])]);
    if (!b.ok) return fail(b);
    const def = json(info)?.default_branch || null;
    const names = (json(b) || []).map((x) => x && x.name).filter((n) => validBranch(n));
    return { ok: true, default: def, branches: def ? [def, ...names.filter((n) => n !== def)] : names };
  }
  async function defaultBranch(repo) {
    if (!validRepo(repo)) return null;
    const r = await gh(['api', `repos/${repo}`, '--jq', '.default_branch']);
    return r.ok && validBranch(r.out) ? r.out : null;
  }
  // Newest runs on a branch, summed up for its newest commit (or the given one).
  async function runs(repo, branch, sha = null) {
    if (!validRepo(repo) || !validBranch(branch)) return { ok: false, message: 'Bad repo or branch.' };
    const r = await gh(['api', `repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=30`]);
    if (!r.ok) return fail(r);
    const list = (json(r)?.workflow_runs || []).filter((x) => !sha || x.head_sha === sha);
    return { ok: true, ...ci.aggregate(list) };
  }
  // The failing job of a run and its error annotations (what broke, in plain lines).
  async function failure(repo, runId) {
    if (!validRepo(repo) || !/^\d{1,20}$/.test(String(runId))) return { ok: false, message: 'Bad run.' };
    const j = await gh(['api', `repos/${repo}/actions/runs/${runId}/jobs?per_page=50`]);
    if (!j.ok) return fail(j);
    const job = ci.failedJob(json(j));
    if (!job) return { ok: true, job: null, annotations: [] };
    const a = await gh(['api', `repos/${repo}/check-runs/${job.id}/annotations?per_page=50`]);
    return { ok: true, job, annotations: parseAnnotations(json(a)) };
  }
  async function prFor(repo, head) {
    if (!validRepo(repo) || !validBranch(head)) return { ok: false, message: 'Bad repo or branch.' };
    const r = await gh(['pr', 'list', '--repo', repo, '--head', head, '--state', 'all', '--limit', '5', '--json', 'number,url,state,headRefOid,baseRefName,title']);
    if (!r.ok) return fail(r);
    const list = json(r) || [];
    return { ok: true, pr: list.find((p) => p.state === 'OPEN') || list[0] || null };
  }
  async function prCreate(repo, { head, base, title, body }) {
    if (!validRepo(repo) || !validBranch(head) || !validBranch(base)) return { ok: false, message: 'Bad repo or branch.' };
    if (head === base) return { ok: false, message: 'The chat branch and its base are the same.' };
    const r = await gh(['pr', 'create', '--repo', repo, '--head', head, '--base', base, '--title', String(title || head).slice(0, 200), '--body', String(body || '').slice(0, 20000)], { timeoutMs: 90000 });
    if (r.ok) { const url = r.out.split('\n').filter((l) => l.startsWith('https://')).pop() || r.out; return { ok: true, url, number: Number((url.match(/\/pull\/(\d+)/) || [])[1]) || null }; }
    const have = await prFor(repo, head);
    return have.ok && have.pr && have.pr.state === 'OPEN' ? { ok: true, url: have.pr.url, number: have.pr.number, existed: true } : fail(r);
  }
  async function prView(repo, number) {
    if (!validRepo(repo) || !/^\d{1,7}$/.test(String(number))) return { ok: false, message: 'Bad pull request.' };
    const r = await gh(['pr', 'view', String(number), '--repo', repo, '--json', 'number,title,url,state,isDraft,headRefName,baseRefName,headRefOid,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup,reviews,updatedAt,mergedAt']);
    if (!r.ok) return fail(r);
    const j = json(r);
    const pr = summarizePr(j);
    return pr ? { ok: true, pr: { ...pr, headSha: j.headRefOid || null } } : { ok: false, message: 'Unexpected answer from gh.' };
  }
  // Only ever called by chat:merge after the owner's native confirmation. A normal merge
  // commit, never --admin or --auto; GitHub refuses if the branch moved past headSha.
  async function prMerge(repo, number, headSha) {
    if (!/^[0-9a-f]{40}$/.test(String(headSha || ''))) return { ok: false, message: 'No commit recorded for this merge.' };
    const v = await prView(repo, number);
    if (!v.ok) return v;
    if (v.pr.state !== 'OPEN') return { ok: false, message: `Pull request #${number} is ${v.pr.state.toLowerCase()}.` };
    if (v.pr.checks.failed) return { ok: false, message: `Pull request #${number} has failing checks; nothing was merged.` };
    if (v.pr.headSha && v.pr.headSha !== headSha) return { ok: false, message: 'The branch changed since you looked at it; nothing was merged. Look at the changes again.' };
    const r = await gh(['pr', 'merge', String(number), '--repo', repo, '--merge', '--match-head-commit', headSha], { timeoutMs: 120000 });
    return r.ok ? { ok: true, message: `Merged pull request #${number} into ${v.pr.base}.`, base: v.pr.base } : fail(r);
  }
  return { gh, repos, branches, defaultBranch, runs, failure, prFor, prCreate, prView, prMerge };
}

function parseRepos(list) {
  return (Array.isArray(list) ? list : []).map((r) => ({
    full: String(r?.nameWithOwner || ''),
    private: r?.isPrivate === true,
    pushedAt: r?.pushedAt || null,
    default: r?.defaultBranchRef?.name || null,
    description: String(r?.description || '').slice(0, 200),
  })).filter((r) => validRepo(r.full)).sort((a, b) => String(b.pushedAt || '').localeCompare(String(a.pushedAt || '')));
}

function parseAnnotations(list) {
  return (Array.isArray(list) ? list : []).filter((a) => a && a.message).map((a) => ({
    level: String(a.annotation_level || 'failure'),
    path: String(a.path || ''),
    line: Number(a.start_line) || null,
    title: String(a.title || '').slice(0, 200),
    message: String(a.message || '').slice(0, 2000),
  })).sort((a, b) => (a.level === 'failure' ? -1 : 0) - (b.level === 'failure' ? -1 : 0)).slice(0, 20);
}

module.exports = { createGithub, parseRepos, parseAnnotations };

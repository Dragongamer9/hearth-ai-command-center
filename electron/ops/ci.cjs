// GitHub Actions status per branch, read with the owner's own gh sign-in (REST only).
// Pure helpers here; the polling lives in index.cjs.

function parseRemote(url) {
  const m = String(url || '').trim().match(/github\.com[:/]+([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9_.][A-Za-z0-9_.-]*?)(?:\.git)?\/?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// workflow_runs for one branch -> state of its newest commit across all workflows.
function aggregate(runs = []) {
  const list = (Array.isArray(runs) ? runs : []).filter((r) => r && r.head_sha);
  if (!list.length) return { state: 'none', sha: null, runs: [] };
  list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const sha = list[0].head_sha;
  // Newest run per workflow for that commit.
  const per = new Map();
  for (const r of list) if (r.head_sha === sha && !per.has(r.workflow_id ?? r.name)) per.set(r.workflow_id ?? r.name, r);
  const mine = [...per.values()];
  const failed = mine.filter((r) => ['failure', 'timed_out', 'startup_failure'].includes(r.conclusion));
  const pending = mine.filter((r) => r.status !== 'completed');
  const state = failed.length ? 'failure' : pending.length ? 'pending' : mine.every((r) => ['success', 'skipped', 'neutral'].includes(r.conclusion)) ? 'success' : 'failure';
  return {
    state,
    sha,
    runs: mine.map((r) => ({ id: r.id, name: r.name, status: r.status, conclusion: r.conclusion, url: r.html_url })),
    failedRun: failed[0] ? { id: failed[0].id, name: failed[0].name, url: failed[0].html_url } : null,
  };
}

function failedJob(jobsJson) {
  const jobs = Array.isArray(jobsJson?.jobs) ? jobsJson.jobs : [];
  const j = jobs.find((x) => ['failure', 'timed_out'].includes(x.conclusion));
  if (!j) return null;
  const step = (j.steps || []).find((s) => ['failure', 'timed_out'].includes(s.conclusion));
  return { id: j.id, name: j.name, url: j.html_url, step: step?.name || null };
}

// The useful end of a job log: timestamps stripped, starting a little before the first error.
function logTail(text, lines = 60) {
  const all = String(text || '').split(/\r?\n/).map((l) => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/, '')).filter((l) => l.trim() !== '');
  const firstErr = all.findIndex((l) => /##\[error\]|\berror\b|failed|not ok/i.test(l));
  const from = firstErr >= 0 ? Math.max(0, Math.min(firstErr - 10, all.length - lines)) : Math.max(0, all.length - lines);
  return all.slice(from, from + lines).join('\n').slice(0, 8000);
}

const BRANCH_RE = /^[A-Za-z0-9._/-]{1,200}$/;
const safeBranch = (b) => typeof b === 'string' && BRANCH_RE.test(b) && !b.includes('..') && !b.startsWith('-');

module.exports = { parseRemote, aggregate, failedJob, logTail, safeBranch };

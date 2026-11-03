// CI on the board: which branches to watch, the state per task, and a failure going
// back to the AI that wrote the commit as a CHANGES item. Pure, unit tested.
const CLOSED = ['approved', 'rejected'];

export function ciBranches(tasks = [], extra = []) {
  const set = new Set();
  for (const t of tasks) if (t.ws?.branch && !CLOSED.includes(t.stage)) set.add(t.ws.branch);
  for (const b of extra) if (b) set.add(b);
  return [...set].slice(0, 30);
}

// The AI that wrote a commit: the run that ended at it, else whoever reported done, else the implementer.
export function authorOf(task, sha) {
  const runs = (task.runs || []).slice().reverse();
  const hit = sha && runs.find((r) => r.head === sha || r.checkpoint === sha || (r.head && sha.startsWith(r.head)) || (r.checkpoint && sha.startsWith(r.checkpoint)));
  return hit?.agent || task.done?.by || task.assignee || null;
}

// Apply one branch result to its task. Returns what happened.
export function applyCi(task, r, now = new Date().toISOString()) {
  if (!task || !r) return { changed: false };
  const prev = task.ci || {};
  const next = { state: r.state, sha: r.sha, url: r.url || null, runId: r.runId || null, at: now, job: r.job?.name || prev.job || null, handled: prev.handled || null };
  const changed = prev.state !== next.state || prev.sha !== next.sha || prev.runId !== next.runId;
  task.ci = next;
  const newFailure = r.state === 'failure' && r.runId && prev.handled !== r.runId;
  if (newFailure) task.ci.handled = r.runId;
  return { changed, newFailure: Boolean(newFailure), author: newFailure ? authorOf(task, r.sha) : null };
}

export function ciChangesText(r) {
  const where = r.job ? `${r.workflow || 'CI'} › ${r.job.name}${r.job.step ? ` › ${r.job.step}` : ''}` : r.workflow || 'CI';
  return `CI failed on ${String(r.sha || '').slice(0, 7)} (${where}). Fix it and report done again.${r.tail ? `\n\nLog tail:\n${r.tail}` : ''}`;
}

export const CI_LABEL = { success: 'CI passed', failure: 'CI failed', pending: 'CI running', none: '' };

// Reviewer sign-off and "waiting for you" logic (pure functions, unit tested).
import { NAMES, PERMISSION_KINDS } from './chat.mjs';
import { taskRunState } from './team.mjs';

const CLOSED = ['approved', 'rejected'];
// Stages where the implementer has handed work over, so a reviewer may sign off.
const REVIEWABLE = ['checkpoint', 'testing', 'review'];

// Reviewer verdict lines in an AI reply:
//   APPROVE: T-ABC123 [optional note]
//   CHANGES: T-ABC123 <reason>
export function parseVerdicts(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/^[\s*\-•`>]+/, '').replace(/[*`]+/g, '').trim();
    const m = line.match(/^(APPROVE|APPROVED|CHANGES)\s*:\s*T-([A-Z0-9]{4,12})\b[\s:—–-]*(.*)$/i);
    if (!m) continue;
    const verdict = m[1].toUpperCase() === 'CHANGES' ? 'changes' : 'approve';
    out.push({ verdict, taskId: m[2].toUpperCase(), reason: m[3].trim().slice(0, 1000) });
  }
  return out;
}

// Apply a verdict from `by` to a task. Only the task's assigned reviewer counts.
// Mutates the task; returns { ok, reason } and, on success, the new stage.
export function applyVerdict(task, { by, verdict, reason = '', at = new Date().toISOString() }) {
  if (!task) return { ok: false, reason: 'no such task' };
  if (by !== task.reviewer) return { ok: false, reason: `only the assigned reviewer (${NAMES[task.reviewer] || 'none'}) can sign off on T-${task.id}` };
  if (CLOSED.includes(task.stage)) return { ok: false, reason: `T-${task.id} is already ${task.stage}` };
  if (verdict === 'approve') {
    if (task.stage === 'approval') return { ok: false, reason: `T-${task.id} is already waiting for owner approval` };
    if (!REVIEWABLE.includes(task.stage)) return { ok: false, reason: `T-${task.id} isn't ready for review yet (${task.stage}); the implementer must report it done first` };
    if (task.policy && !task.policy.ok) return { ok: false, reason: `T-${task.id} is blocked by the policy check` };
    task.stage = 'approval';
    task.reviewVerdict = { by, verdict, reason, at };
  } else if (verdict === 'changes') {
    if (!reason) return { ok: false, reason: 'CHANGES needs a reason' };
    if (task.stage === 'intake') return { ok: false, reason: `T-${task.id} hasn't started yet` };
    task.stage = 'implementing';
    task.reviewVerdict = { by, verdict, reason, at };
    task.notes = task.notes || [];
    task.notes.push({ at, who: `${NAMES[by]} (review)`, text: `CHANGES REQUESTED: ${reason}` });
  } else {
    return { ok: false, reason: 'unknown verdict' };
  }
  task.updatedAt = at;
  return { ok: true, stage: task.stage };
}

// The one thing a task is waiting on the owner for, or null.
// kind: permission | approve | policy | signin | resume | start
// ctx: { permissions, running, saving, canRun(agent), free: [agents that could pick it up] }
export function ownerAction(task, ctx = {}) {
  if (!task || CLOSED.includes(task.stage)) return null;
  const { permissions = [], running = false, saving = false, canRun = () => true, free = [] } = ctx;
  const ask = permissions.find((p) => p.context === task.id && p.status === 'pending');
  if (ask) return { kind: 'permission', label: 'Answer permission request', reason: `${NAMES[ask.agent]} asks: ${PERMISSION_KINDS[ask.kind] || ask.kind} — ${ask.what}`, request: ask.id };
  if (task.stage === 'approval') {
    const label = { release: 'Approve release', deploy: 'Approve deploy', docs: task.ws ? 'Approve to merge' : 'Approve' }[task.action] || (task.ws || task.pr || task.action === 'merge' ? 'Approve to merge' : 'Approve');
    const v = task.reviewVerdict?.verdict === 'approve' ? task.reviewVerdict : null;
    return { kind: 'approve', label, reason: v ? `${NAMES[v.by]} approved the review${v.reason ? `: ${v.reason}` : '.'}` : 'Ready for your sign-off.' };
  }
  if (task.policy && !task.policy.ok) return { kind: 'policy', label: 'Fix policy issue', reason: task.policy.block[0] || 'Blocked by the policy check.' };
  if (running || saving) return null;
  const st = taskRunState(task, { running, saving });
  const last = (task.runs || []).slice(-1)[0];
  const who = last?.agent || task.assignee;
  if (st === 'auth' || st === 'not_installed') return { kind: 'signin', label: 'Sign in to resume', reason: `${NAMES[who]} needs you to sign in (or install it) before the task can continue.`, agent: who };
  if (['resume', 'outage', 'timeout', 'limit'].includes(st)) {
    // Out of usage: someone else must take it. Otherwise the implementer retries first.
    const agent = st !== 'limit' && canRun(task.assignee) ? task.assignee : free.find((a) => st !== 'limit' || a !== who) || null;
    if (!agent) return null; // nobody free (e.g. waiting for usage to reset): nothing for the owner to press
    const why = { resume: `${NAMES[who]} stopped (${last?.status || 'paused'}).`, outage: `${NAMES[who]}'s provider had a problem.`, timeout: `${NAMES[who]} timed out.`, limit: `${NAMES[who]} ran out of usage.` }[st];
    return { kind: 'resume', label: 'Approve to resume', reason: `${why} Continues with ${NAMES[agent]} from the last checkpoint.`, agent };
  }
  if (task.stage === 'intake' && task.assignee && task.assignee !== 'none' && !(task.runs || []).length) {
    return { kind: 'start', label: 'Approve to start', reason: `Waiting for you to start it with ${NAMES[task.assignee]}.`, agent: task.assignee };
  }
  return null;
}

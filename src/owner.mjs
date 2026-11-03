// The owner's side of the task flow (pure functions, unit tested): reviewer sign-off,
// what a task is waiting on the owner for, and when a "done" report counts.
import { NAMES, PERMISSION_KINDS } from './chat.mjs';
import { taskRunState } from './team.mjs';

const CLOSED = ['approved', 'rejected'];
// Stages where the implementer has handed the work over (Checkpoint included, so
// finished work never sits there: the reviewer can move it on).
export const REVIEWABLE = ['checkpoint', 'testing', 'review'];

// Reviewer lines in a reply: "APPROVE: T-ABC123 note" / "CHANGES: T-ABC123 reason".
export function parseVerdicts(text) {
  const found = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim().replace(/^[-*•>\s`]+/, '').replace(/[`*]/g, '');
    const m = /^(APPROVED?|CHANGES)\s*:\s*T-([A-Za-z0-9]{4,12})\b[\s:—–-]*(.*)$/i.exec(line);
    if (m) found.push({ verdict: /^CHANGES$/i.test(m[1]) ? 'changes' : 'approve', taskId: m[2].toUpperCase(), reason: m[3].trim().slice(0, 1000) });
  }
  return found;
}

// A verdict from `by`. Only the task's assigned reviewer counts. Mutates the task.
export function applyVerdict(task, { by, verdict, reason = '', at = new Date().toISOString(), sha = null }) {
  if (!task) return { ok: false, reason: 'no such task' };
  if (by !== task.reviewer) return { ok: false, reason: `only the assigned reviewer (${NAMES[task.reviewer] || 'none'}) can sign off on T-${task.id}` };
  if (CLOSED.includes(task.stage)) return { ok: false, reason: `T-${task.id} is already ${task.stage}` };
  if (verdict === 'approve') {
    if (task.stage === 'approval') return { ok: false, reason: `T-${task.id} is already waiting for owner approval` };
    if (!REVIEWABLE.includes(task.stage)) return { ok: false, reason: `T-${task.id} isn't ready for review yet (${task.stage})` };
    if (task.policy && !task.policy.ok) return { ok: false, reason: `T-${task.id} is blocked by the policy check` };
    task.stage = 'approval';
    // The approval is for this exact commit; a later change clears it.
    task.reviewVerdict = { by, verdict, reason, at, sha: sha || null };
  } else if (verdict === 'changes') {
    if (!reason) return { ok: false, reason: 'CHANGES needs a reason' };
    if (task.stage === 'intake') return { ok: false, reason: `T-${task.id} hasn't started yet` };
    task.stage = 'implementing';
    task.reviewVerdict = { by, verdict, reason, at };
    task.notes = task.notes || [];
    task.notes.push({ at, who: `${NAMES[by]} (review)`, text: `CHANGES REQUESTED: ${reason}` });
    requestChanges(task, { by, reason, at });
  } else return { ok: false, reason: 'unknown verdict' };
  task.updatedAt = at;
  return { ok: true, stage: task.stage };
}

// The one button a task shows when it waits on the owner, or null.
// kind: permission | approve | policy | signin | resume | start
export function ownerAction(task, { permissions = [], running = false, saving = false, canRun = () => true, free = [] } = {}) {
  if (!task || CLOSED.includes(task.stage)) return null;
  const ask = permissions.find((p) => p.context === task.id && p.status === 'pending');
  if (ask) return { kind: 'permission', label: 'Answer permission request', reason: `${NAMES[ask.agent]} asks: ${PERMISSION_KINDS[ask.kind] || ask.kind} — ${ask.what}` };
  if (task.stage === 'approval') {
    const label = task.action === 'release' ? 'Approve release' : task.action === 'deploy' ? 'Approve deploy' : task.ws || task.pr || task.action === 'merge' ? 'Approve to merge' : 'Approve';
    const v = task.reviewVerdict?.verdict === 'approve' ? task.reviewVerdict : null;
    return { kind: 'approve', label, reason: v ? `${NAMES[v.by]} approved${v.sha ? ` ${v.sha}` : ''}${v.reason ? `: ${v.reason}` : '.'}` : 'Ready for your sign-off.' };
  }
  if (task.policy && !task.policy.ok) return { kind: 'policy', label: 'Fix policy issue', reason: task.policy.block?.[0] || 'Blocked by the policy check.' };
  if (running || saving) return null;
  const st = taskRunState(task, { running, saving });
  const last = (task.runs || []).slice(-1)[0];
  const who = last?.agent || task.assignee;
  if (st === 'auth' || st === 'not_installed') return { kind: 'signin', label: 'Sign in to resume', reason: `${NAMES[who]} needs you to sign in (or install it) first.`, agent: who };
  if (['resume', 'outage', 'timeout', 'limit'].includes(st)) {
    const agent = st !== 'limit' && canRun(task.assignee) ? task.assignee : free.find((a) => a !== who) || null;
    if (!agent) return null; // nobody free: nothing to press yet
    const why = { resume: `${NAMES[who]} stopped (${last?.status || 'paused'}).`, outage: `${NAMES[who]}'s provider had a problem.`, timeout: `${NAMES[who]} timed out.`, limit: `${NAMES[who]} ran out of usage.` }[st];
    return { kind: 'resume', label: 'Approve to resume', reason: `${why} ${NAMES[agent]} continues from the last checkpoint.`, agent };
  }
  if (task.stage === 'intake' && task.assignee && task.assignee !== 'none' && !(task.runs || []).length) {
    return { kind: 'start', label: 'Approve to start', reason: `Waiting for you to start it with ${NAMES[task.assignee]}.`, agent: task.assignee };
  }
  return null;
}

// ---- "done" without fixes ----
// After a review asks for changes, a later "done" only counts if the task branch
// has a new commit since then. `sha` is the branch head when the next run starts.
export function requestChanges(task, { by = 'owner', reason = '', at = new Date().toISOString() } = {}) {
  task.changesSince = { at, by, reason: String(reason).slice(0, 500), sha: null };
  return task.changesSince;
}

export function reviewBaseline(task, head) {
  if (task?.changesSince && !task.changesSince.sha && head) task.changesSince.sha = head;
}

const NO_CHANGES = /\bno (?:further|more|other|additional) changes\b|\bnothing (?:more|else|further) to (?:change|fix|do)\b/i;
export function claimsDone(status, text = '') {
  return status === 'done' || NO_CHANGES.test(String(text || ''));
}

// { ok: true } to accept the report, or { ok: false, note } to send the task back.
export function checkDoneAfterReview(task, { head = null, status = '', text = '' } = {}) {
  if (claimsDone(status, text) && testResult(text) === 'failed') {
    return { ok: false, note: `Not accepted: you reported this done${head ? ` at ${head}` : ''}, but the run's test output shows failures. Fix the failing tests, then report STATUS: DONE with TESTS: PASSED.` };
  }
  const since = task?.changesSince;
  if (!since || !claimsDone(status, text)) return { ok: true };
  if (!since.sha || !head || head !== since.sha) {
    if (since.sha && head) delete task.changesSince; // a new commit: the fixes are in
    return { ok: true };
  }
  const who = since.by === 'owner' ? 'the Owner' : `${NAMES[since.by] || since.by}'s review`;
  return { ok: false, note: `Not accepted: you reported this done, but the task branch has no new commit since ${who} asked for changes (still at ${since.sha}). Make the requested fixes in this workspace first${since.reason ? `: ${since.reason}` : ''}. Then report STATUS: DONE.` };
}

// "passed" / "failed" / "not run" from a run's output: the TESTS: line the brief asks
// for, else the usual npm test / node --test summaries the output already contains.
export function testResult(text) {
  const t = String(text || '');
  const m = t.match(/^\s*TESTS:\s*(PASSED|PASS|FAILED|FAIL|NOT RUN|NONE|SKIPPED)\b/im);
  if (m) return /^PASS/i.test(m[1]) ? 'passed' : /^FAIL/i.test(m[1]) ? 'failed' : 'not run';
  if (/#\s*fail\s+[1-9]|\b[1-9]\d*\s+(?:failing|failed)\b|Tests:\s+\d+\s+failed|npm ERR! Test failed|tests? failed\b/i.test(t)) return 'failed';
  if (/#\s*fail\s+0\b|\b\d+\s+passing\b|Tests:\s+\d+\s+passed|\ball (?:\d+ )?tests? pass(?:ed)?\b|\btests? pass(?:ed)?\b/i.test(t)) return 'passed';
  return 'not run';
}

export const TEST_LABEL = { passed: 'tests passed', failed: 'tests failed', 'not run': 'tests not run' };

// An approval covers one commit. If the branch has moved since, it no longer counts.
export function approvalStale(task, head) {
  const v = task?.reviewVerdict;
  return Boolean(task && task.stage === 'approval' && v?.verdict === 'approve' && v.sha && head && head !== v.sha);
}

// Clear a stale approval: the task goes back to review. Returns true if it did.
export function clearStaleApproval(task, head, at = new Date().toISOString()) {
  if (!approvalStale(task, head)) return false;
  const v = task.reviewVerdict;
  task.stage = 'review';
  delete task.reviewVerdict;
  task.notes = task.notes || [];
  task.notes.push({ at, who: 'System', text: `The branch changed after ${NAMES[v.by] || v.by} approved ${v.sha} (now ${head}), so that approval was cleared and the task is back in review.` });
  task.updatedAt = at;
  return true;
}

// How a done report reads in chat: what was built and tested, at which commit.
// Pushing is separate (the lead's job), so it is never implied here.
export function doneLine(run) {
  const tests = TEST_LABEL[run?.tests] || 'tests not run';
  return `Reported done: implemented${run?.tests === 'passed' ? ' and tested' : ''} at ${run?.head || 'the latest checkpoint'} (${tests}). Not pushed by this report; pushing is done by the lead.`;
}

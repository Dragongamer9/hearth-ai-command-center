// The lead AI acting on the owner's Task board (only while the owner's Settings switch
// is on). Pure rules, unit tested; main.js carries out the allowed actions with the
// same functions the owner's buttons use.
import { NAMES } from './chat.mjs';
import { EDITORS } from './registry.mjs';
import { findDuplicate } from './dupes.mjs';

const CLOSED = ['approved', 'rejected'];
const REVIEWABLE = ['checkpoint', 'testing', 'review'];
// Always the owner's: releases and deploys, and the AIs' own merge/release/boot requests.
const OWNER_ONLY_ACTIONS = ['release', 'deploy'];
// push, command and outside too: otherwise the lead could approve `git push origin main --tags`.
const OWNER_ONLY_PERMISSIONS = ['release', 'merge', 'boot', 'push', 'command', 'outside'];

export const leadOn = ({ enabled = false, agent, lead } = {}) => enabled === true && Boolean(agent) && agent === lead;

const clean = (raw) => raw.replace(/^[\s*\-•`>]+/, '').replace(/[*`]+/g, '').trim();

// START: T-…, APPROVE: R-…, DENY: R-… [reason], ADD TASK: title — details [| implementer: x | reviewer: y | action: code]
// (APPROVE:/CHANGES: T-… lines are read by parseVerdicts in owner.mjs.)
export function parseLeadLines(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = clean(raw);
    let m = line.match(/^START\s*:\s*T-([A-Z0-9]{4,12})\b/i);
    if (m) { out.push({ kind: 'start', id: m[1].toUpperCase() }); continue; }
    m = line.match(/^(APPROVE|APPROVED|ALLOW|DENY|DENIED)\s*:\s*R-([A-Z0-9]{4,12})\b[\s:—–-]*(.*)$/i);
    if (m) { out.push({ kind: /^(DENY|DENIED)$/i.test(m[1]) ? 'deny' : 'allow', id: m[2].toUpperCase(), reason: m[3].trim().slice(0, 500) }); continue; }
    m = line.match(/^ADD\s+TASK\s*:\s*(.+)$/i);
    if (m) {
      const [head, ...fields] = m[1].split('|').map((x) => x.trim());
      const [title, ...rest] = head.split(/\s+[—–-]{1,2}\s+/);
      const field = (k) => (fields.find((f) => f.toLowerCase().startsWith(`${k}:`)) || '').split(':').slice(1).join(':').trim().toLowerCase();
      if (title?.trim()) out.push({ kind: 'add', title: title.trim().slice(0, 200), details: rest.join(' — ').trim().slice(0, 4000), implementer: field('implementer'), reviewer: field('reviewer'), action: field('action') || 'code' });
    }
  }
  return out;
}

// Did the lead build (implement or run) this task?
export function leadBuilt(task, lead) {
  return task.assignee === lead || (task.runs || []).some((r) => r.agent === lead);
}

// May the lead take this owner action? Returns { ok, action } or { ok: false, reason }.
// skip: true means it is the lead's own reviewer sign-off, handled by applyVerdict.
export function leadDecision(cmd, { lead, enabled = false, task = null, request = null, tasks = [], resumable = false } = {}) {
  const who = `${NAMES[lead] || 'The lead'} (lead)`;
  if (!enabled) return { ok: false, ignored: true, reason: 'the lead switch is off' };
  if (cmd.kind === 'approve' || cmd.kind === 'changes' || cmd.kind === 'start') {
    if (!task) return { ok: false, reason: `there is no task T-${cmd.id}` };
    if (CLOSED.includes(task.stage)) return { ok: false, reason: `T-${task.id} is already ${task.stage}` };
    if ((cmd.kind === 'approve' || cmd.kind === 'changes') && task.reviewer === lead && REVIEWABLE.includes(task.stage)) return { ok: false, skip: true };
  }
  if (cmd.kind === 'approve') {
    if (OWNER_ONLY_ACTIONS.includes(task.action)) return { ok: false, reason: `${task.action === 'release' ? 'releases' : 'deploys'} stay with the Owner` };
    if (task.policy && !task.policy.ok) return { ok: false, reason: `T-${task.id} is blocked by the policy check` };
    if (task.stage === 'approval') {
      // A lead approval always needs an independent review: never the lead's own word,
      // and the local model (no tools, can't look at the code) doesn't count for code.
      const v = task.reviewVerdict?.verdict === 'approve' ? task.reviewVerdict : null;
      const independent = v && v.by !== lead && !(v.by === 'ollama' && task.action !== 'docs');
      if (!independent) {
        if (leadBuilt(task, lead)) return { ok: false, reason: `${who} built T-${task.id}, so it needs another AI's review first (or the Owner's approval). It can't approve its own work` };
        if (v?.by === lead) return { ok: false, reason: `${who} reviewed T-${task.id} itself, so it can't also merge it on its own word; the Owner approves this one` };
        return { ok: false, reason: `T-${task.id} needs an approving review from an AI that can read the code (not the local model) before the lead can approve it` };
      }
      return { ok: true, action: task.ws || task.pr ? 'merge' : 'approve' };
    }
    if (resumable) return { ok: true, action: 'resume' };
    return { ok: false, reason: `T-${task.id} isn't waiting for approval (${task.stage})` };
  }
  if (cmd.kind === 'changes') {
    if (!cmd.reason) return { ok: false, reason: 'CHANGES needs a reason' };
    if (task.stage !== 'approval' && !REVIEWABLE.includes(task.stage)) return { ok: false, reason: `T-${task.id} has nothing to review yet (${task.stage})` };
    return { ok: true, action: 'changes' };
  }
  if (cmd.kind === 'start') {
    if (task.policy && !task.policy.ok) return { ok: false, reason: `T-${task.id} is blocked by the policy check` };
    if (OWNER_ONLY_ACTIONS.includes(task.action) || task.action === 'merge') return { ok: false, reason: `${task.action} tasks stay with the Owner` };
    if (!['intake', 'implementing'].includes(task.stage)) return { ok: false, reason: `T-${task.id} isn't waiting to start (${task.stage})` };
    if (!EDITORS.includes(task.assignee)) return { ok: false, reason: `T-${task.id} has no AI that can work on it` };
    return { ok: true, action: 'start' };
  }
  if (cmd.kind === 'allow' || cmd.kind === 'deny') {
    if (!request) return { ok: false, reason: `there is no request R-${cmd.id}` };
    if (request.status !== 'pending') return { ok: false, reason: `R-${request.id} was already answered` };
    if (cmd.kind === 'allow') {
      if (request.agent === lead) return { ok: false, reason: `${who} can't approve its own request R-${request.id}` };
      if (OWNER_ONLY_PERMISSIONS.includes(request.kind)) return { ok: false, reason: `${request.kind} requests stay with the Owner` };
    }
    return { ok: true, action: cmd.kind === 'allow' ? 'allowperm' : 'denyperm' };
  }
  if (cmd.kind === 'add') {
    if (OWNER_ONLY_ACTIONS.includes(cmd.action) || cmd.action === 'merge') return { ok: false, reason: `${cmd.action} tasks stay with the Owner` };
    const dup = findDuplicate({ title: cmd.title, description: cmd.details }, tasks);
    if (dup) return { ok: false, duplicate: dup.task.id, reason: `it looks like T-${dup.task.id} “${dup.task.title}”, which is already open` };
    return { ok: true, action: 'add' };
  }
  return { ok: false, reason: 'unknown action' };
}

export const LEAD_VERBS = { merge: 'approved and merged', approve: 'approved', resume: 'approved resuming', changes: 'requested changes on', start: 'started', allowperm: 'approved', denyperm: 'denied', add: 'added' };
// What the audit log and chat say: "Claude (lead) approved T-ABC123 …".
export function leadLabel(lead, action, ref, extra = '') {
  return `${NAMES[lead] || lead} (lead) ${LEAD_VERBS[action] || action} ${ref}${extra ? ` ${extra}` : ''}`.trim();
}
// Undo is offered for deny, start, add, approve-to-resume and a decision-only approve or
// changes; never after a completed merge or an approved permission (the AI may have acted).
export const leadUndoable = (action) => ['denyperm', 'start', 'resume', 'add', 'approve', 'changes'].includes(action);

// The extra lead prompt, only while the switch is on.
export function leadRules(lead) {
  const n = NAMES[lead] || 'the lead';
  return [
    `- The Owner has let you, ${n}, take his Task board actions. Write one line per action:`,
    '  APPROVE: T-<id> <note> — approve a task waiting for Owner approval (does what "Approve to merge" does) or approve resuming a stopped task',
    '  CHANGES: T-<id> <what must be fixed> — send it back to its implementer',
    '  START: T-<id> — start a queued task (or queue it as Start next)',
    '  APPROVE: R-<id> / DENY: R-<id> <reason> — answer a teammate\'s permission card',
    '  ADD TASK: <title> — <details> | implementer: <name> | reviewer: <name> | action: code|docs',
    '- Limits that always hold: you cannot approve your own work (a task you built needs another AI\'s review first, or the Owner) or your own permission requests; releases, deploys, version numbers, tags and merge/release/boot permission requests stay with the Owner; new tasks go through the duplicate check. Everything you do is shown to the Owner, who can undo it.',
  ].join('\n');
}

// Who reviews a task: never the implementer, and preferably not the lead (who approves)
// or the local model (no tools). `requested` wins when it's allowed.
export function pickReviewer(implementer, { requested = null, candidates = [], lead = 'anthropic' } = {}) {
  if (requested && requested !== implementer && candidates.includes(requested)) return requested;
  const ok = candidates.filter((a) => a !== implementer);
  return ok.find((a) => a !== lead && a !== 'ollama') || ok.find((a) => a !== lead) || ok[0] || 'none';
}

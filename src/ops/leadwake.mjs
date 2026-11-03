// The lead gets a turn when it's needed (while the owner's lead switch is on): a new
// permission card from another AI, a task reaching approval or waiting to start, or a
// reviewer verdict. Debounced into one short turn. Also: what is waiting for the lead,
// and the lead's refused actions, for its prompt. Pure, unit tested.
import { leadMayApprove } from './approval.mjs';

const OPEN = ['intake', 'implementing'];

// Tasks awaiting approval or start, and the permission cards, marking owner-only ones.
export function waitingForLead({ tasks = [], permissions = [], lead, running = {}, editors = [] } = {}) {
  const out = { tasks: [], cards: [] };
  for (const t of tasks) {
    if (t.stage === 'approval') out.tasks.push({ id: t.id, title: t.title, stage: 'approval', assignee: t.assignee, reviewer: t.reviewer, verdict: t.reviewVerdict?.verdict === 'approve' ? `approved by ${t.reviewVerdict.by}${t.reviewVerdict.sha ? ` at ${String(t.reviewVerdict.sha).slice(0, 7)}` : ''}` : 'no reviewer approval yet', ownerOnly: ['release', 'deploy'].includes(t.action) || t.assignee === lead });
    else if (OPEN.includes(t.stage) && !running[t.id] && t.policy?.ok !== false && editors.includes(t.assignee) && !t.startNext) {
      const runs = (t.runs || []).filter((r) => r.status !== 'running');
      const last = runs[runs.length - 1];
      if (!last || last.status !== 'done') out.tasks.push({ id: t.id, title: t.title, stage: t.stage === 'intake' ? 'waiting to start' : `stopped (${last?.status || 'not started'})`, assignee: t.assignee, reviewer: t.reviewer, verdict: t.changesSince ? `changes requested: ${String(t.changesSince.reason || '').slice(0, 120)}` : '', ownerOnly: ['merge', 'release', 'deploy'].includes(t.action) });
    }
  }
  for (const p of permissions) {
    if (p.status !== 'pending') continue;
    const own = p.agent === lead;
    const may = own ? { ok: false, reason: 'your own request' } : leadMayApprove(p);
    out.cards.push({ id: p.id, agent: p.agent, kind: p.kind, what: p.what, leadMay: may.ok, reason: may.ok ? '' : may.reason });
  }
  return out;
}

export function waitingSection(w, names = {}) {
  if (!w || (!w.tasks.length && !w.cards.length)) return '';
  const n = (a) => names[a] || a || 'none';
  return [
    'WAITING FOR YOU (LEAD) OR THE OWNER:',
    ...w.tasks.slice(0, 15).map((t) => `- T-${t.id} "${t.title}" — ${t.stage}, implementer ${n(t.assignee)}, reviewer ${n(t.reviewer)}${t.verdict ? `, ${t.verdict}` : ''}${t.ownerOnly ? ' [OWNER-ONLY]' : ''}`),
    ...w.cards.slice(0, 15).map((c) => `- R-${c.id} by ${n(c.agent)}: ${c.kind} — ${c.what}${c.leadMay ? ' [YOU MAY ANSWER: APPROVE: R-' + c.id + ' or DENY: R-' + c.id + ' <reason>]' : ` [OWNER-ONLY: ${c.reason}]`}`),
    '- Answer what you may in THIS reply with the lines above; leave owner-only items to the Owner.',
  ].join('\n');
}

export function refusalSection(list = []) {
  if (!list.length) return '';
  return ['YOUR LAST ACTIONS THAT WERE REFUSED (do not repeat them as-is):', ...list.slice(-8).map((r) => `- ${r.ref}: ${r.reason}`)].join('\n');
}

// Debounced lead turn. schedule(fn, ms) -> handle; nothing runs while switched off,
// for the lead's own cards, or when the lead can't run (out of usage, sign-in hold).
export function createLeadWaker({ delayMs = 4000, schedule = (fn, ms) => setTimeout(fn, ms), isOn, lead, canRun, run }) {
  let timer = null;
  let reasons = [];
  return {
    nudge(reason, from = null) {
      if (!isOn() || (from && from === lead())) return false;
      reasons.push(reason);
      if (timer) return true;
      timer = schedule(() => {
        timer = null;
        const why = [...new Set(reasons)];
        reasons = [];
        if (isOn() && canRun()) run(why);
      }, delayMs);
      return true;
    },
    get pending() { return Boolean(timer); },
  };
}

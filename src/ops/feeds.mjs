// Small pure pieces: lead MEMORY: proposals, log-created tasks, the phone snapshot and
// its actions, and opsSnapshot() for the Habitat. Unit tested.
import { CI_LABEL } from './ci.mjs';

export function parseMemoryLines(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const m = raw.replace(/^[\s*\-•`>]+/, '').replace(/[*`]+$/g, '').match(/^MEMORY:\s*(.{3,1000})$/i);
    if (m) out.push(m[1].trim());
  }
  return out.slice(0, 5);
}

export function memoryCard(text, by, id) {
  return { id, type: 'memory', status: 'pending', by, text: `${by} proposes adding to PROJECT.md: ${text}`, proposal: text, options: [{ value: 'approve', label: 'Approve', primary: true }, { value: 'deny', label: 'Deny' }] };
}

export function logTask(l) {
  const s = l.summary || {};
  const lines = [
    `Hearth device log ${l.code} from ${l.date}.`,
    `Device: ${s.device || 'unknown'} · Hearth OS: ${s.version || 'unknown'}`,
    s.errors?.length ? `Top errors:\n${s.errors.map((e) => `- ${e}`).join('\n')}` : 'No error lines found.',
    `Full log saved at ${l.file} (from ${l.path}).`,
  ];
  return { title: `Look at log ${l.code}`, description: lines.join('\n').slice(0, 4800), action: 'docs', labels: ['log'] };
}

const COLS = [['Intake', ['intake']], ['In progress', ['implementing', 'checkpoint']], ['Verify', ['testing', 'review']], ['Owner approval', ['approval']]];

export function phoneSnapshot({ state, names = {}, project = '', startLabel = () => null }) {
  const tasks = state.tasks || [];
  return {
    project,
    names,
    at: new Date().toISOString(),
    waiting: {
      permissions: (state.permissions || []).filter((p) => p.status === 'pending').map((p) => ({ id: p.id, agent: p.agent, kind: p.kind, what: p.what, why: p.why, computerOnly: PHONE_NEVER_APPROVE.includes(p.kind) })),
      approvals: tasks.filter((t) => t.stage === 'approval').map((t) => ({ id: t.id, title: t.title, assignee: t.assignee, tests: t.done?.tests ? `tests ${t.done.tests}` : null })),
      cards: (state.opsCards || []).filter((c) => c.status === 'pending').map((c) => ({ id: c.id, text: c.text, options: c.options })),
    },
    board: COLS.map(([title, stages]) => ({ title, tasks: tasks.filter((t) => stages.includes(t.stage)).slice(0, 30).map((t) => ({ id: t.id, title: t.title, stage: t.stage, assignee: t.assignee, ci: CI_LABEL[t.ci?.state] || '', canStart: startLabel(t) })) })),
    chat: (state.chat || []).filter((m) => !m.deleted).slice(-40).map((m) => ({ who: m.who, at: m.at, text: String(m.text || '').slice(0, 1500) })),
  };
}

// Owner-only kinds and boot-critical changes are approved on the computer only.
export const PHONE_NEVER_APPROVE = ['merge', 'release', 'tag', 'version', 'settings', 'boot'];
export function phoneMayDecide(request, value) {
  if (!request || request.status !== 'pending') return { ok: false, reason: 'no such pending request' };
  if (value === 'approved' && PHONE_NEVER_APPROVE.includes(request.kind)) return { ok: false, reason: `${request.kind} requests can only be approved on the computer` };
  return { ok: true };
}
const ID = /^[A-Za-z0-9]{2,16}$/;
// A phone request -> one normalized action, or null.
export function phoneAction(a) {
  if (!a || typeof a !== 'object') return null;
  const id = typeof a.id === 'string' && ID.test(a.id) ? a.id : null;
  switch (a.type) {
    case 'decide': return id && ['approved', 'denied'].includes(a.value) ? { type: 'decide', id, value: a.value } : null;
    case 'approve': case 'changes': case 'start': return id ? { type: a.type, id } : null;
    case 'card': return id && typeof a.value === 'string' && /^[\w:-]{1,40}$/.test(a.value) ? { type: 'card', id, value: a.value } : null;
    case 'chat': { const t = String(a.value || '').trim().slice(0, 4000); return t ? { type: 'chat', value: t } : null; }
    default: return null;
  }
}

// Plain data for the Habitat (and anything else that wants it).
export function opsSnapshot({ state = {}, budgets = {}, since = '' } = {}) {
  const tasks = state.tasks || [];
  const failures = [];
  for (const t of tasks) for (const r of t.runs || []) if (!['done', 'ok', 'continue', 'running'].includes(r.status) || r.refused) failures.push({ taskId: t.id, title: t.title, agent: r.agent, kind: r.refused ? 'refused' : r.status, at: r.at });
  return {
    at: new Date().toISOString(),
    finished: tasks.filter((t) => t.done && String(t.done.at || '') > since).map((t) => ({ id: t.id, title: t.title, by: t.done.by, at: t.done.at, tests: t.done.tests || 'not run' })),
    failures: failures.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20),
    budget: Object.fromEntries(Object.entries(budgets).map(([a, b]) => [a, { headroom: b.headroom, near: b.near, out: b.out, recent: b.recent, cap: b.cap, reset: b.reset }])),
    ci: Object.fromEntries(tasks.filter((t) => t.ci).map((t) => [t.id, { state: t.ci.state, sha: t.ci.sha, url: t.ci.url }])),
  };
}

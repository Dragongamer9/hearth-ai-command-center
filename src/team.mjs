// Shared-progress helpers: what every agent is told when it picks up a task,
// including work another agent left behind. Pure functions (unit tested).
import { NAMES } from './chat.mjs';
import { EDITORS } from './registry.mjs';
import { hearthFacts } from './hearth.mjs';

// Who takes over a task when an agent stops: lead first, then the others that can edit files.
export function nextAgent(available, exclude = [], lead = 'anthropic') {
  const order = [lead, ...EDITORS.filter((a) => a !== lead)];
  return order.find((a) => EDITORS.includes(a) && available.includes(a) && !exclude.includes(a)) || null;
}

// Kinds of work, read from the role text on the Agents page (the defaults or
// whatever the owner typed). Matching stays on those words.
const ROLE_TESTS = [
  ['code', /\b(cod(?:e|ing)|implement(?:ation|ing|er)?|debug(?:ging)?|fix(?:es)?)\b/i],
  ['research', /\b(research|documents?|docs|fact-?check(?:ing)?|screenshots?)\b/i],
  ['review', /\b(reviews?|reviewing|second opinions?|reasoning)\b/i],
  ['lead', /\b(leads?|coordinator)\b/i],
];

const ROLE_LABEL = { code: 'coding', research: 'research', review: 'review', lead: 'lead' };

export function roleKinds(text) {
  return ROLE_TESTS.filter(([, re]) => re.test(String(text || ''))).map(([kind]) => kind);
}

export function roleLabel(kind) {
  return ROLE_LABEL[kind] || String(kind || '');
}

// What a queued task needs. Merges, releases and deploys stay with the owner.
export function taskNeeds(task) {
  if (!task || ['merge', 'release', 'deploy'].includes(task.action)) return null;
  if (task.stage === 'review') return 'review';
  if (task.action === 'docs') return 'research';
  return 'code';
}

const QUEUE_STAGES = new Set(['intake', 'implementing']);

// Tasks an AI will actually work: open, policy-clear, file-editing, not waiting on the owner.
export function isQueued(task) {
  if (!task || task.policy?.ok !== true) return false;
  if (!QUEUE_STAGES.has(task.stage)) return false;
  if (!task.assignee || task.assignee === 'none') return false;
  if (!EDITORS.includes(task.assignee)) return false;
  return taskNeeds(task) != null;
}

// One AI's queue, oldest first. queuedAt (set when a task is moved) wins over createdAt
// so a handoff lands where it was placed instead of jumping by its original date.
export function agentQueue(tasks, agent) {
  return (tasks || [])
    .filter((t) => t.assignee === agent && isQueued(t))
    .slice()
    .sort((a, b) => {
      const ka = String(a.queuedAt || a.createdAt || '');
      const kb = String(b.queuedAt || b.createdAt || '');
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return String(a.id).localeCompare(String(b.id));
    });
}

// The task to start on its own: a usage handoff parked with resumeNext, otherwise
// the front of the queue if it has never been started. An unfinished task in front
// stays put until the owner presses Continue — the ones behind it wait.
export function nextAutoTask(tasks, agent) {
  const q = agentQueue(tasks, agent);
  const parked = q.find((t) => t.resumeNext);
  if (parked) return parked;
  const first = q[0];
  if (!first) return null;
  const started = (first.runs || []).some((r) => r.status && r.status !== 'running');
  return started ? null : first;
}

function ranked(available, { need, roles = {}, exclude = [], editors = EDITORS, lead = 'anthropic' } = {}) {
  const pool = editors.filter((a) => available.includes(a) && !exclude.includes(a));
  const matched = need ? pool.filter((a) => roleKinds(roles[a] || '').includes(need)) : [];
  const roleMatched = matched.length > 0;
  const base = roleMatched ? matched : pool;
  return base.slice().sort((a, b) => {
    const aLead = a === lead;
    const bLead = b === lead;
    if (aLead !== bLead) {
      if (roleMatched) return aLead ? 1 : -1;
      return aLead ? -1 : 1;
    }
    return editors.indexOf(a) - editors.indexOf(b);
  });
}

// Next free file-editing AI for this kind of work. A role match beats the lead.
// With no match, same order as nextAgent: the lead, then the other editors.
export function nextForRole(available, opts = {}) {
  return ranked(available, opts)[0] || null;
}

// When `agent` runs out of usage, every task still waiting (not the one in
// progress) moves to the next free AI whose role matches. Several free matches
// share the tasks, so each of them still works one queue. Never the reviewer.
// Does not mutate tasks.
export function reassignWaiting({ tasks, agent, available, roles = {}, currentId = null, editors = EDITORS, lead = 'anthropic' } = {}) {
  const waiting = agentQueue(tasks, agent).filter((t) => t.id !== currentId);
  const load = {};
  const moves = [];
  for (const task of waiting) {
    const need = taskNeeds(task);
    if (!need) continue;
    const exclude = [agent];
    if (task.reviewer && task.reviewer !== 'none') exclude.push(task.reviewer);
    const order = ranked(available, { need, roles, exclude, editors, lead });
    if (!order.length) continue;
    const to = order.slice().sort((a, b) => ((load[a] || 0) - (load[b] || 0)) || (order.indexOf(a) - order.indexOf(b)))[0];
    load[to] = (load[to] || 0) + 1;
    moves.push({ id: task.id, from: agent, to, need });
  }
  return moves;
}

function stamp(tasks, agent, at, end) {
  let mark = '';
  for (const t of agentQueue(tasks, agent)) {
    const k = String(t.queuedAt || t.createdAt || '');
    if (!k) continue;
    if (!mark || (end ? k > mark : k < mark)) mark = k;
  }
  if (!mark) return at;
  const ms = Date.parse(mark);
  if (Number.isNaN(ms)) return at;
  const next = new Date(ms + (end ? 1 : -1)).toISOString();
  if (end) return next > at ? next : at;
  return next;
}

// Place a moved task after everything the recipient already has.
export function queuedAtEnd(tasks, agent, at) {
  return stamp(tasks, agent, at, true);
}

// Place an in-progress handoff ahead of the recipient's queue.
export function queuedAtFront(tasks, agent, at) {
  return stamp(tasks, agent, at, false);
}

// "STATUS: DONE" / "STATUS: CONTINUE ..." line the agent ends with.
export function parseStatus(text) {
  const m = String(text || '').match(/STATUS:\s*(DONE|CONTINUE)/i);
  return m ? m[1].toLowerCase() : null;
}

const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}\n…[trimmed]` : String(s));

export function buildTaskBrief({ task, agent, summary = '', handoffFrom = null, reason = '' }) {
  const runs = (task.runs || []).filter((r) => r.status !== 'running').slice(-4);
  const notes = (task.notes || []).slice(-6);
  return [
    `You are ${NAMES[agent]}, working on a shared task in the Hearth AI Command Center alongside the other AIs in the team (Claude, ChatGPT, Gemini, a local model, FreeBuff). The task belongs to the Command Center, not to any one AI.`,
    'Your current directory is this task\'s own git worktree. Everything you change here is checkpointed (committed) automatically after you finish, so another agent can continue if you stop.',
    handoffFrom
      ? `HANDOFF: ${NAMES[handoffFrom]} was working on this and had to stop (${reason || 'stopped'}). Do NOT start over. Inspect the current files and the progress below, then continue from where they left off.`
      : '',
    'You can do everything you normally can in your own app here: edit files, run commands, use git and the web (with your own built-in safety checks). The Command Center commits your work as a checkpoint (as Dragongamer9, no AI attribution) after you finish.',
    'Rules: stay within this task; keep changes focused; never push to main/master, merge, publish or deploy yourself (the owner presses Approve in the app for merges and releases); never pick or change a version number (the owner chooses every number); if you commit yourself, commit as Dragongamer9 with no Co-authored-by or "Generated with" lines; ask the owner first (in Team chat, ASK: line) before deleting files, boot-critical changes or commands outside this workspace.',
    hearthFacts(),
    '',
    `# Task T-${task.id}: ${task.title}`,
    task.description ? clip(task.description, 4000) : '',
    `Action type: ${task.action}`,
    '',
    '# Progress so far (shared by all agents)',
    summary || 'Nothing recorded yet.',
    runs.length ? '\n# Previous agent runs' : '',
    ...runs.map((r) => `## ${NAMES[r.agent]} — ${r.status}${r.checkpoint ? ` (checkpoint ${r.checkpoint})` : ''}\n${clip(r.output || '', 2500)}`),
    notes.length ? '\n# Notes' : '',
    ...notes.map((n) => `- ${n.who}: ${clip(n.text, 800)}`),
    '',
    'When you finish, reply with a short summary of what you did and what is left, ending with one line: "STATUS: DONE" if the task is complete, or "STATUS: CONTINUE — <what remains>".',
  ].filter((l) => l !== '').join('\n');
}

// Human-readable run state for a task (shown on the board and in the drawer).
export const RUN_STATES = {
  running: 'Running',
  saving: 'Saving',
  limit: 'Paused — Usage Limit',
  outage: 'Waiting for Provider',
  timeout: 'Waiting for Provider',
  auth: 'Needs Authentication',
  not_installed: 'Needs Authentication',
  resume: 'Ready to Resume',
};

export function taskRunState(task, { running = false, saving = false } = {}) {
  if (running) return 'running';
  if (saving) return 'saving';
  if (['approved', 'rejected'].includes(task.stage)) return null;
  const last = (task.runs || []).slice(-1)[0];
  if (!last) return null;
  if (['limit', 'outage', 'timeout', 'auth', 'not_installed'].includes(last.status)) return last.status;
  if (['interrupted', 'cancelled', 'failed', 'error', 'continue', 'no_workspace'].includes(last.status)) return 'resume';
  return null;
}

// After a crash / forced quit, runs still marked "running" never got a reply.
// Mark them interrupted so the task shows Ready to Resume. Returns affected tasks.
export function recoverInterrupted(state, at = new Date().toISOString()) {
  const affected = [];
  for (const t of state.tasks || []) {
    for (const r of t.runs || []) {
      if (r.status !== 'running') continue;
      r.status = 'interrupted';
      r.output = 'The app closed while this agent was working, so its final reply was never received and cannot be recovered. Any files it changed before that are kept in the workspace and saved in the recovery checkpoint.';
      r.recoveredAt = at;
      if (!affected.includes(t)) affected.push(t);
    }
  }
  return affected;
}

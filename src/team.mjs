// Shared-progress helpers: what every agent is told when it picks up a task,
// including work another agent left behind. Pure functions (unit tested).
import { NAMES } from './chat.mjs';
import { EDITORS } from './registry.mjs';
import { hearthFacts } from './hearth.mjs';
import { policyText } from './ops/approval.mjs';
import { extrasRules } from './ops/extras.mjs';

// Who takes over a task when an agent stops: lead first, then the others that can edit files.
export function nextAgent(available, exclude = [], lead = 'anthropic') {
  const order = [lead, ...EDITORS.filter((a) => a !== lead)];
  return order.find((a) => EDITORS.includes(a) && available.includes(a) && !exclude.includes(a)) || null;
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
    'Rules: stay within this task; keep changes focused; never push to main/master, merge, publish or deploy yourself (the owner presses Approve in the app for merges and releases); never pick or change a version number (the owner chooses every number); if you commit yourself, commit as Dragongamer9 with no Co-authored-by or "Generated with" lines; follow the approval levels below: routine things you just do, major things you ask about first with an ASK: line.',
    policyText(),
    extrasRules(agent),
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
    'To show the Owner a screenshot, chart or recording you made in this workspace, add a line: ATTACH: <path relative to this workspace> (png, jpg, webp, gif, mp4, webm, mov; up to 200 MB). Attach a screenshot when you report UI work.',
    'If the project has tests or checks, run them before reporting done and add a line "TESTS: PASSED", "TESTS: FAILED" or "TESTS: NOT RUN". A done report is tied to the branch\'s newest commit; it is refused when tests fail or nothing new was committed since a review asked for changes.',
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
  // Owner approval is waiting on the owner. A previous "continue" run must not
  // keep the board on Ready to Resume after the reviewer has signed off.
  if (['approved', 'rejected', 'approval'].includes(task.stage)) return null;
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

// ---- one task at a time per AI ----
// Kinds of work, read from the role text on the Agents page.
const KINDS = [['code', /\b(cod(e|ing)|implement\w*|debug\w*|fix\w*)\b/i], ['research', /\b(research|docs?|documents?|fact-?check\w*)\b/i], ['review', /\b(review\w*|second opinions?|reasoning)\b/i]];
export const roleKinds = (text) => KINDS.filter(([, re]) => re.test(String(text || ''))).map(([k]) => k);

// What a waiting task needs from whoever takes it. Merges, releases and deploys stay with the owner.
export function taskNeed(task) {
  if (!task || ['merge', 'release', 'deploy'].includes(task.action)) return null;
  if (task.stage === 'review') return 'review';
  return task.action === 'docs' ? 'research' : 'code';
}

// Tasks an AI works through on its own: open, policy-clear, assigned to an editing AI.
export function inQueue(task) {
  return Boolean(task && task.policy?.ok === true && ['intake', 'implementing'].includes(task.stage) && EDITORS.includes(task.assignee) && taskNeed(task));
}

const qkey = (t) => String(t.queuedAt || t.createdAt || '');
// One AI's queue, oldest first.
export function queueOf(tasks, agent) {
  return (tasks || []).filter((t) => t.assignee === agent && inQueue(t)).sort((a, b) => qkey(a).localeCompare(qkey(b)) || String(a.id).localeCompare(String(b.id)));
}

// What the AI starts by itself when it's free: only tasks someone pressed Start on
// while it was busy, in the order Start was pressed. A task that was only added never
// starts by itself.
export function nextQueued(tasks, agent) {
  return queueOf(tasks, agent).find((t) => t.startNext) || null;
}

// Where a task goes when the owner presses Start next on a busy AI: behind the other
// Start-next tasks, ahead of the rest. So several Start-next tasks run oldest-first.
export function placeNext(tasks, agent, at) {
  const q = queueOf(tasks, agent);
  const parked = q.filter((t) => t.startNext);
  const ref = parked.length ? parked[parked.length - 1] : null;
  if (ref) return new Date(Date.parse(qkey(ref)) + 1).toISOString();
  return q.length ? new Date(Date.parse(qkey(q[0])) - 1000).toISOString() : at;
}

// After everything the AI already has.
export function placeLast(tasks, agent, at) {
  const q = queueOf(tasks, agent);
  const last = q.length ? qkey(q[q.length - 1]) : '';
  return last && last >= at ? new Date(Date.parse(last) + 1).toISOString() : at;
}

export const startLabel = (task, busy, name) => (busy ? 'Start next' : `${(task.runs || []).length ? 'Continue' : 'Start'} with ${name}`);

// An AI ran out of usage: each of its waiting tasks (not the one it was in) goes to the
// next free editing AI with the same kind of role, spread evenly, never to the task's
// reviewer. With no such AI free, the task waits.
export function redistribute({ tasks, agent, available = [], roles = {}, currentId = null, lead = 'anthropic' }) {
  const load = {};
  const moves = [];
  for (const t of queueOf(tasks, agent)) {
    if (t.id === currentId) continue;
    const need = taskNeed(t);
    const pool = EDITORS.filter((a) => a !== agent && a !== t.reviewer && available.includes(a));
    const fit = pool.filter((a) => roleKinds(roles[a]).includes(need));
    const order = fit.sort((a, b) => (load[a] || 0) - (load[b] || 0) || (a === lead) - (b === lead) || EDITORS.indexOf(a) - EDITORS.indexOf(b));
    if (!order.length) continue;
    load[order[0]] = (load[order[0]] || 0) + 1;
    moves.push({ id: t.id, from: agent, to: order[0], need });
  }
  return moves;
}

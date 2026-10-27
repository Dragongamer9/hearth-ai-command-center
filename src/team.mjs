// Shared-progress helpers: what every agent is told when it picks up a task,
// including work another agent left behind. Pure functions (unit tested).
import { NAMES } from './chat.mjs';
import { EDITORS } from './registry.mjs';

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
    'You can do everything you normally can in your own app here: edit files, run commands, use git and the web (with your own built-in safety checks). The Command Center commits your work as a checkpoint and pushes this task\'s branch to GitHub after you finish.',
    'Rules: stay within this task; keep changes focused; never push to main/master, merge, publish or deploy (the owner approves merges); do not change the Hearth OS version (pinned 0.6.55, the owner chooses version numbers); anything touching booting must keep the previous version startable.',
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

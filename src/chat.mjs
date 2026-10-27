// Team chat helpers (pure, unit tested).
import { AGENTS, AGENT_IDS, DEFAULT_ROLES, EDITORS, aliasOf } from './registry.mjs';

export const NAMES = { owner: 'Owner', system: 'System', ...Object.fromEntries(AGENT_IDS.map((a) => [a, AGENTS[a].name])) };
const ACTIONS = ['code', 'docs', 'merge', 'release', 'deploy'];
const MAX_TRANSCRIPT_CHARS = 12000;

// Who should answer, in order. "@claude ..." targets one; otherwise every live
// agent, with the lead coordinator answering first.
export function recipients(text, live, target = 'all', lead = 'anthropic') {
  const mentioned = [...new Set([...String(text).matchAll(/@(\w+)/g)].map((m) => aliasOf(m[1])).filter(Boolean))];
  let list = mentioned.length ? mentioned : target === 'all' ? [...live] : [target];
  list = list.filter((a) => live.includes(a));
  if (!mentioned.length && list.includes(lead)) list = [lead, ...list.filter((a) => a !== lead)];
  return list;
}

// What every agent is told about the Command Center, so it knows what it can
// actually do instead of guessing.
export function teamContext({ agent, roster = [], lead = 'anthropic', board = [], project = null, chatEdits = false, extraDirs = [] } = {}) {
  const roleOf = (r) => r.role || DEFAULT_ROLES[r.id] || '';
  return [
    'ABOUT THE HEARTH AI COMMAND CENTER (facts, not suggestions):',
    '- It is a desktop app (Electron, Linux AppImage) on the Owner\'s own computer. It coordinates several AIs on the Owner\'s software projects, mainly Hearth OS.',
    `- Shared project folder (a git repo): ${project || 'not chosen yet'}.`,
    chatEdits
      ? '- In this chat you can do everything you normally can in your own app: read and edit files, run commands, use git and search or read websites (with your own built-in safety checks). Your current directory is the team chat\'s own git branch/worktree of the project, so your edits never touch the main branch directly. After every reply the Command Center commits your changes as a checkpoint and pushes that branch to GitHub.'
      : '- In this chat you can read the project (your current directory) and search the web, but not change files.',
    `- Folders on the Owner\'s computer you may also use: ${extraDirs.length ? extraDirs.join(', ') : 'none granted yet (the Owner can add some in Settings)'}.`,
    '- Bigger work goes in TASKS: each task gets its own git branch and worktree, every run is checkpointed and pushed to GitHub, and another AI can continue if one runs out of usage.',
    '- Merging into the main branch only happens when the Owner clicks Approve. Do not push to main/master yourself. Never claim something was pushed or done unless it really was (a checkpoint commit shows it).',
    '- Hearth OS is pinned at 0.6.55; only the Owner picks version numbers. Anything touching booting must keep the previous version startable.',
    '',
    'THE TEAM:',
    ...roster.map((r) => `- ${NAMES[r.id]}${r.id === agent ? ' (you)' : ''}${r.id === lead ? ' [LEAD]' : ''}: ${roleOf(r)} — ${r.status}`),
    '',
    board.length ? 'OPEN TASKS ON THE BOARD:' : 'The task board is empty.',
    ...board.slice(0, 15).map((t) => `- T-${t.id} "${t.title}" — ${t.stage}, implementer ${NAMES[t.assignee] || 'none'}${t.state ? `, ${t.state}` : ''}`),
  ].join('\n');
}

export function buildPrompt(agent, messages, ctx = {}) {
  const lead = ctx.lead || 'anthropic';
  let lines = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.who === 'system') continue;
    const line = `${NAMES[m.who] || m.who}: ${m.text}`;
    if (used + line.length > MAX_TRANSCRIPT_CHARS) break;
    lines.unshift(line);
    used += line.length;
  }
  const editors = EDITORS.map((a) => AGENTS[a].mention[0]).join('|');
  return [
    `You are ${NAMES[agent]} in the Hearth AI Command Center team chat with the Owner and the other AIs. Everyone sees every message.`,
    teamContext({ ...ctx, agent }),
    '',
    'HOW TO BEHAVE:',
    agent === lead
      ? '- You are the LEAD: when the Owner asks for work, break it down and assign it to the best-suited teammates by their roles. Keep the plan short.'
      : `- ${NAMES[lead]} is the lead. Build on the lead's plan and the other replies instead of repeating them; disagree when you have a reason.`,
    '- Be concise. Do not ask the Owner for facts that are stated above.',
    '- To put work on the board, write one line per task in exactly this format (the Owner gets Add / Add & start buttons):',
    `TASK: <title> | implementer: ${editors} | reviewer: ${editors}|local | action: code|docs|merge|release|deploy`,
    '- The reviewer must differ from the implementer. The local AI cannot implement (it can only review).',
    '',
    '--- Chat so far ---',
    ...lines,
    '--- End ---',
    `Reply as ${NAMES[agent]}.`,
  ].join('\n');
}

export function parseProposals(text) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/^[\s*\-•`]+/, '').replace(/[*`]/g, '');
    const m = line.match(/^TASK:\s*(.+)$/i);
    if (!m) continue;
    const parts = m[1].split('|').map((s) => s.trim());
    const title = parts.shift();
    if (!title) continue;
    const field = (k) => {
      const p = parts.find((x) => x.toLowerCase().startsWith(`${k}:`));
      return p ? p.slice(k.length + 1).trim().toLowerCase() : '';
    };
    let assignee = aliasOf(field('implementer')) || 'none';
    if (assignee !== 'none' && !EDITORS.concat('freebuff').includes(assignee)) assignee = 'none';
    let reviewer = aliasOf(field('reviewer')) || 'none';
    if (reviewer === assignee && assignee !== 'none') reviewer = EDITORS.find((a) => a !== assignee) || 'none';
    const action = ACTIONS.includes(field('action')) ? field('action') : 'code';
    out.push({ title: title.slice(0, 200), assignee, reviewer, action });
  }
  return out;
}

// Team chat helpers (pure, unit tested).
import { AGENTS, AGENT_IDS, DEFAULT_ROLES, EDITORS, aliasOf } from './registry.mjs';
import { hearthFacts } from './hearth.mjs';

export const NAMES = { owner: 'Owner', system: 'System', ...Object.fromEntries(AGENT_IDS.map((a) => [a, AGENTS[a].name])) };
const ACTIONS = ['code', 'docs', 'merge', 'release', 'deploy'];
const MAX_TRANSCRIPT_CHARS = 12000;

// Risky actions an AI must ask the owner about first (structured request card).
export const PERMISSION_KINDS = {
  push: 'Push to GitHub',
  merge: 'Merge a branch',
  release: 'Publish a release',
  delete: 'Delete files',
  boot: 'Boot-critical change',
  outside: 'Work outside the workspace',
  command: 'Run a risky command',
  other: 'Something else',
};

// Who should answer, in order. "@claude ..." targets one; otherwise every live
// agent, with the lead coordinator answering first.
export function recipients(text, live, target = 'all', lead = 'anthropic') {
  const mentioned = mentions(text);
  let list = mentioned.length ? mentioned : target === 'all' ? [...live] : [target];
  list = list.filter((a) => live.includes(a));
  if (!mentioned.length && list.includes(lead)) list = [lead, ...list.filter((a) => a !== lead)];
  return list;
}

export function mentions(text) {
  return [...new Set([...String(text).matchAll(/@(\w+)/g)].map((m) => aliasOf(m[1])).filter(Boolean))];
}

// What every agent is told about the Command Center, so it knows what it can
// actually do instead of guessing.
export function teamContext({ agent, roster = [], lead = 'anthropic', board = [], project = null, chatEdits = false, extraDirs = [], pending = [] } = {}) {
  const roleOf = (r) => r.role || DEFAULT_ROLES[r.id] || '';
  return [
    'ABOUT THE HEARTH AI COMMAND CENTER (facts, not suggestions):',
    '- It is a desktop app (Electron, Linux AppImage) on the Owner\'s own computer. It coordinates several AIs on the Owner\'s software projects, mainly Hearth OS.',
    `- Shared project folder (a git repo): ${project || 'not chosen yet'}.`,
    chatEdits
      ? '- In this chat you can do everything you normally can in your own app: read and edit files, run commands, use git and search or read websites (with your own built-in safety checks). Your current directory is the team chat\'s own git branch/worktree of the project, so your edits never touch the main branch directly. After every reply the Command Center commits your changes as a checkpoint.'
      : '- In this chat you can read the project (your current directory) and search the web, but not change files.',
    `- Folders on the Owner\'s computer you may also use: ${extraDirs.length ? extraDirs.join(', ') : 'none granted yet (the Owner can add some in Settings)'}.`,
    '- Bigger work goes in TASKS: each task gets its own git branch and worktree, every run is checkpointed, and another AI can continue if one runs out of usage.',
    '- Merging into the main branch and releases only happen when the Owner presses Approve in the app (a release also needs the version typed by the Owner). Never push to main/master yourself. Never claim something was pushed or done unless it really was (a checkpoint commit shows it).',
    '- Every conversation is saved in the app\'s history and in your own CLI\'s session list, so the Owner can resume it later in your own app.',
    hearthFacts(),
    '',
    'THE TEAM:',
    ...roster.map((r) => `- ${NAMES[r.id]}${r.id === agent ? ' (you)' : ''}${r.id === lead ? ' [LEAD]' : ''}: ${roleOf(r)} — ${r.status}`),
    '',
    board.length ? 'OPEN TASKS ON THE BOARD:' : 'The task board is empty.',
    ...board.slice(0, 15).map((t) => `- T-${t.id} "${t.title}" — ${t.stage}, implementer ${NAMES[t.assignee] || 'none'}${t.reviewer ? `, reviewer ${NAMES[t.reviewer] || 'none'}` : ''}${t.state ? `, ${t.state}` : ''}`),
    pending.length ? '\nPERMISSION REQUESTS WAITING FOR THE OWNER:' : '',
    ...pending.map((p) => `- R-${p.id} by ${NAMES[p.agent]}: ${PERMISSION_KINDS[p.kind] || p.kind} — ${p.what}`),
  ].filter((l) => l !== '').join('\n');
}

// The chat-room rules every AI gets (how to post, edit, hand off and ask).
export function chatRules(agent, lead) {
  const editors = EDITORS.map((a) => AGENTS[a].mention[0]).join('|');
  return [
    'HOW TO BEHAVE:',
    agent === lead
      ? '- You are the LEAD: when the Owner asks for work, break it down and assign it to the best-suited teammates by their roles. Keep the plan short.'
      : `- ${NAMES[lead]} is the lead. Build on the lead's plan and the other replies instead of repeating them; disagree when you have a reason.`,
    '- Be concise. Do not ask the Owner for facts that are stated above. If you have nothing useful to add, reply with exactly: PASS',
    '- Mention a teammate with @name (e.g. @gemini) to ask them something; they will answer after you.',
    '- To put work on the board, write one line per task in exactly this format (the Owner gets Add / Add & start buttons):',
    `TASK: <title> | implementer: ${editors} | reviewer: ${editors}|local | action: code|docs|merge|release|deploy`,
    '- The reviewer must differ from the implementer. The local AI cannot implement (it can only review).',
    '- If you are the assigned REVIEWER of a task and it is ready for the Owner, write a line: APPROVE: T-<task id> <short note>. To send it back to its implementer, write: CHANGES: T-<task id> <what must be fixed>. Only the assigned reviewer\'s lines count; APPROVE only moves it to Owner approval (the Owner still decides and merges).',
    '- To fix one of YOUR OWN earlier messages, write a line: EDIT #<message id>: <the corrected full text>',
    '- To take back one of YOUR OWN earlier messages, write a line: RETRACT #<message id>',
    '- To hand the conversation to a teammate, write a line: HANDOFF: @<name> <what they should do>',
    `- BEFORE any risky action (${Object.keys(PERMISSION_KINDS).filter((k) => k !== 'other').join(', ')} — i.e. pushing, merging, releasing, deleting files, boot-critical changes, running commands outside the workspace) you MUST ask the Owner and stop until they answer. Write one line: ASK: <push|merge|release|delete|boot|outside|command|other> | <exactly what you want to do> | <why>`,
    '- After an ASK line, do NOT do that action in this reply. The Owner answers Approve / Deny / Ask why; you will be told the answer.',
  ].join('\n');
}

export function buildPrompt(agent, messages, ctx = {}) {
  const lead = ctx.lead || 'anthropic';
  const lines = transcript(messages, MAX_TRANSCRIPT_CHARS);
  return [
    `You are ${NAMES[agent]} in the Hearth AI Command Center team chat with the Owner and the other AIs. Everyone sees every message. Messages show their id like [#AB12CD].`,
    teamContext({ ...ctx, agent }),
    '',
    chatRules(agent, lead),
    '',
    '--- Chat so far ---',
    ...lines,
    '--- End ---',
    `Reply as ${NAMES[agent]}.`,
  ].join('\n');
}

// Short follow-up for an AI that already has the room in its resumed CLI session.
export function buildDelta(agent, newMessages, ctx = {}) {
  const lines = transcript(newMessages, MAX_TRANSCRIPT_CHARS);
  return [
    `(Hearth AI Command Center team chat — continuing. You are ${NAMES[agent]}. Same rules as before; red-flag rules still apply.)`,
    ctx.pending?.length ? `Waiting for the Owner: ${ctx.pending.map((p) => `R-${p.id} (${NAMES[p.agent]}: ${p.what})`).join('; ')}` : '',
    '--- New messages since your last turn ---',
    ...(lines.length ? lines : ['(none)']),
    '--- End ---',
    `Reply as ${NAMES[agent]} (or PASS).`,
  ].filter(Boolean).join('\n');
}

function transcript(messages, max) {
  const lines = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.who === 'system' || m.deleted) continue;
    const body = m.retracted ? '(retracted)' : m.text;
    const line = `[#${m.id || '?'}] ${NAMES[m.who] || m.who}${m.edited ? ' (edited)' : ''}: ${body}`;
    if (used + line.length > max) break;
    lines.unshift(line);
    used += line.length;
  }
  return lines;
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

// Pull EDIT / RETRACT / HANDOFF / ASK / PASS lines out of an AI reply.
// Returns the reply text without those lines plus the structured requests.
export function parseDirectives(text) {
  const out = { text: '', edits: [], retracts: [], handoffs: [], asks: [], pass: false };
  const keep = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/^[\s*\-•`>]+/, '').replace(/[*`]+$/g, '').replace(/^\*+/, '');
    let m;
    if ((m = line.match(/^EDIT\s+#?([A-Z0-9]{4,12})\s*:\s*(.+)$/i))) { out.edits.push({ id: m[1].toUpperCase(), text: m[2].trim() }); continue; }
    if ((m = line.match(/^RETRACT\s+#?([A-Z0-9]{4,12})\b/i))) { out.retracts.push(m[1].toUpperCase()); continue; }
    if ((m = line.match(/^HANDOFF:\s*@(\w+)\s*(.*)$/i))) {
      const to = aliasOf(m[1]);
      if (to) out.handoffs.push({ to, note: m[2].trim().slice(0, 500) });
      continue;
    }
    if ((m = line.match(/^ASK:\s*(.+)$/i))) {
      const parts = m[1].split('|').map((s) => s.trim());
      const kind = PERMISSION_KINDS[parts[0]?.toLowerCase()] ? parts[0].toLowerCase() : 'other';
      const what = (PERMISSION_KINDS[parts[0]?.toLowerCase()] ? parts[1] : parts[0]) || '';
      const why = (PERMISSION_KINDS[parts[0]?.toLowerCase()] ? parts[2] : parts[1]) || '';
      if (what) out.asks.push({ kind, what: what.slice(0, 500), why: why.slice(0, 800) });
      continue;
    }
    keep.push(raw);
  }
  out.text = keep.join('\n').trim();
  out.pass = /^PASS\.?$/i.test(out.text) && !out.edits.length && !out.retracts.length && !out.asks.length && !out.handoffs.length;
  if (out.pass) out.text = '';
  return out;
}

// Edit a chat message. AIs may only edit their own messages; the owner may edit any.
// The previous text is kept in m.history so every change is visible.
export function applyEdit(chat, { id, by, text, at = new Date().toISOString() }) {
  const m = chat.find((x) => x.id === id);
  if (!m) return { ok: false, reason: 'no such message' };
  if (m.deleted) return { ok: false, reason: 'message was deleted' };
  if (by !== 'owner' && m.who !== by) return { ok: false, reason: 'AIs can only edit their own messages' };
  if (by !== 'owner' && m.retracted) return { ok: false, reason: 'message was retracted' };
  const t = String(text).trim().slice(0, 8000);
  if (!t || t === m.text) return { ok: false, reason: 'no change' };
  m.history = [...(m.history || []), { text: m.text, at, by }];
  m.text = t;
  m.edited = true;
  m.editedAt = at;
  m.editedBy = by;
  return { ok: true, message: m };
}

export function applyRetract(chat, { id, by, at = new Date().toISOString() }) {
  const m = chat.find((x) => x.id === id);
  if (!m) return { ok: false, reason: 'no such message' };
  if (by !== 'owner' && m.who !== by) return { ok: false, reason: 'AIs can only retract their own messages' };
  if (m.retracted) return { ok: false, reason: 'already retracted' };
  m.history = [...(m.history || []), { text: m.text, at, by, retracted: true }];
  m.retracted = true;
  m.retractedAt = at;
  return { ok: true, message: m };
}

// ---- Permission requests (AI asks, owner decides, everything audited) ----
export function makeRequest({ id, agent, kind, what, why = '', context = 'chat', msgId = null, at = new Date().toISOString() }) {
  return { id, agent, kind: PERMISSION_KINDS[kind] ? kind : 'other', what: String(what).slice(0, 500), why: String(why).slice(0, 800), context, msgId, at, status: 'pending', questions: [] };
}

// decision: 'approved' | 'denied' | 'why'. Only pending requests can be decided.
export function decideRequest(list, id, decision, at = new Date().toISOString()) {
  const r = list.find((x) => x.id === id);
  if (!r) return { ok: false, reason: 'no such request' };
  if (r.status !== 'pending') return { ok: false, reason: `already ${r.status}` };
  if (decision === 'why') {
    r.questions.push({ at });
    return { ok: true, request: r };
  }
  if (!['approved', 'denied'].includes(decision)) return { ok: false, reason: 'bad decision' };
  r.status = decision;
  r.decidedAt = at;
  return { ok: true, request: r };
}

// AIs with an unanswered request are blocked until the owner answers.
export function blockedAgents(list = []) {
  return [...new Set(list.filter((r) => r.status === 'pending').map((r) => r.agent))];
}

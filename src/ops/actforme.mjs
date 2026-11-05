// "Claude can do everything I can (asks me first every time)": pure rules, unit tested in
// test/actforme.test.mjs.
//
// With the owner's switch on, Claude may REQUEST any owner action with a line like
//   ACT FOR OWNER: merge T-ST0002
// Nothing runs until the owner says yes: Allow in a popup, or typing "yes" / "approve"
// in that chat. Each request is bound to its project, its chat, its exact target and
// commit, expires after 30 minutes, and is used once.
//
// It reuses the approval levels (src/ops/approval.mjs) for the label on each request and
// the owner's own buttons to carry the action out. Hard limits stay even with the switch on.
import { CATEGORIES, levelOf } from './approval.mjs';

export const ACT_AGENT = 'anthropic'; // the owner asked for Claude: only Claude may ask
export const ACT_TTL_MS = 30 * 60 * 1000;

// The owner actions Claude may ask for, each with its approval-level category.
export const ACT_KINDS = {
  approve: { label: 'Approve', cat: 'merge', needs: 'task' },
  merge: { label: 'Approve and merge into main', cat: 'merge', needs: 'task' },
  reject: { label: 'Reject', cat: 'other', needs: 'task' },
  changes: { label: 'Request changes on', cat: 'review', needs: 'task' },
  push: { label: 'Push the branch of', cat: 'push', needs: 'task' },
  pr: { label: 'Open a pull request for', cat: 'push', needs: 'task' },
  start: { label: 'Start', cat: 'edit', needs: 'task' },
  stop: { label: 'Stop the run of', cat: 'other', needs: 'task' },
  assign: { label: 'Assign', cat: 'other', needs: 'task' },
  allow: { label: 'Approve permission request', cat: 'other', needs: 'perm' },
  deny: { label: 'Deny permission request', cat: 'other', needs: 'perm' },
  release: { label: 'Release', cat: 'release', needs: 'version' },
  tag: { label: 'Tag', cat: 'tag', needs: 'version' },
  setting: { label: 'Change the app setting', cat: 'settings', needs: 'setting' },
  projectsetting: { label: 'Change the project setting', cat: 'settings', needs: 'setting' },
};

// App settings Claude may ask to change, and how to read the value it gives.
export const APP_SETTINGS = {
  autoPush: 'bool', chatEdits: 'bool', chatResume: 'bool', leadActions: 'bool', leadGitHub: 'bool', localReviewCode: 'bool',
  leadMerge: 'bool', leadRelease: 'bool', leadTag: 'bool', reduceMotion: 'bool',
  access: ['standard', 'full'], theme: ['hearth', 'dark', 'light', 'system'],
};
export const PROJECT_SETTINGS = { testCommand: 'text', testTimeoutMin: 'int', stallMin: 'int', ciWatch: 'bool', logsOn: 'bool', logsRepo: 'text', docsPaths: 'text' };

// Never, even with the owner's yes (the owner does these himself).
const HARD = [
  [/version|^next/i, 'Claude never picks or changes a version number; you set Next version yourself'],
  [/updat/i, "Claude never touches the in-app updaters or their settings"],
  [/identity|author|attribution|committer/i, "Claude never changes your identity or commit authorship"],
  [/^actforme$/i, 'only you can turn "Claude can do everything I can" on or off'],
  [/releasecommand/i, 'the release command is yours to set'],
];
export function hardLimit(key) {
  for (const [re, why] of HARD) if (re.test(String(key || ''))) return why;
  return null;
}

const clean = (raw) => raw.replace(/^[\s*\-•`>]+/, '').replace(/[*`]+/g, '').trim();

// ACT FOR OWNER: <action> <target> [value]
export function parseActLines(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = clean(raw);
    const m = line.match(/^ACT\s+FOR\s+OWNER\s*:\s*(.+)$/i);
    if (!m) continue;
    const body = m[1].trim();
    let k;
    if ((k = body.match(/^(approve|merge|reject|push|pr|start|stop)\s+T-([A-Z0-9]{4,12})\b/i))) out.push({ kind: k[1].toLowerCase(), taskId: k[2].toUpperCase(), raw: line });
    else if ((k = body.match(/^changes\s+T-([A-Z0-9]{4,12})\b[\s:—–-]*(.*)$/i))) out.push({ kind: 'changes', taskId: k[1].toUpperCase(), note: k[2].trim().slice(0, 500), raw: line });
    else if ((k = body.match(/^assign\s+T-([A-Z0-9]{4,12})\s+(?:to\s+)?@?([a-z]+)/i))) out.push({ kind: 'assign', taskId: k[1].toUpperCase(), agent: k[2].toLowerCase(), raw: line });
    else if ((k = body.match(/^(allow|deny)\s+R-([A-Z0-9]{4,12})\b/i))) out.push({ kind: k[1].toLowerCase(), permId: k[2].toUpperCase(), raw: line });
    else if ((k = body.match(/^(release|tag)\s+(v?\S+)/i))) out.push({ kind: k[1].toLowerCase(), version: k[2].replace(/^v/, '').replace(/[.,;]+$/, ''), raw: line });
    else if ((k = body.match(/^(project\s+)?setting\s+([A-Za-z]+)\s*(?:=|to)?\s*(.*)$/i))) out.push({ kind: k[1] ? 'projectsetting' : 'setting', key: k[2], value: k[3].trim().slice(0, 300), raw: line });
    else out.push({ kind: 'unknown', raw: line });
  }
  return out;
}

function parseValue(type, v) {
  const s = String(v ?? '').trim();
  if (type === 'bool') { if (/^(on|true|yes|1)$/i.test(s)) return { ok: true, value: true }; if (/^(off|false|no|0)$/i.test(s)) return { ok: true, value: false }; return { ok: false }; }
  if (type === 'int') return /^\d{1,4}$/.test(s) ? { ok: true, value: Number(s) } : { ok: false };
  if (Array.isArray(type)) return type.includes(s) ? { ok: true, value: s } : { ok: false };
  return { ok: true, value: s };
}

// Check a parsed line and turn it into a pending request, or say why it can't be one.
// ctx: { agent, on, projectId, chatId, nextVersion, tasks, permissions, settings, projectSettings, shaOf(task), now }
export function makeActRequest(cmd, ctx) {
  if (ctx.on !== true) return { ok: false, reason: 'ignored: "Claude can do everything I can" is off (only you can turn it on in Settings)' };
  if (ctx.agent !== ACT_AGENT) return { ok: false, reason: 'only Claude may ask to act for you' };
  const def = ACT_KINDS[cmd.kind];
  if (!def) return { ok: false, reason: 'unknown action' };
  if (!ctx.projectId) return { ok: false, reason: 'no open project' };
  const base = { id: `A${Math.random().toString(36).slice(2, 8).toUpperCase()}`, kind: cmd.kind, by: ctx.agent, at: new Date(ctx.now).toISOString(), expiresAt: new Date(ctx.now + ACT_TTL_MS).toISOString(), projectId: ctx.projectId, chatId: ctx.chatId || null, status: 'pending', level: levelOf(def.cat), category: CATEGORIES[def.cat]?.label || '' };
  if (def.needs === 'task') {
    const t = (ctx.tasks || []).find((x) => x.id === cmd.taskId);
    if (!t) return { ok: false, reason: `unknown task T-${cmd.taskId}` };
    if (cmd.kind === 'assign' && !(ctx.agents || []).includes(cmd.agent)) return { ok: false, reason: `unknown teammate @${cmd.agent}` };
    return { ok: true, request: { ...base, target: `T-${t.id}`, taskId: t.id, title: t.title, branch: t.ws?.branch || null, sha: ctx.shaOf ? ctx.shaOf(t) : null, agent: cmd.agent || null, note: cmd.note || '' } };
  }
  if (def.needs === 'perm') {
    const p = (ctx.permissions || []).find((x) => x.id === cmd.permId && x.status === 'pending');
    if (!p) return { ok: false, reason: `no pending permission request R-${cmd.permId}` };
    if (p.agent === ACT_AGENT) return { ok: false, reason: "Claude can't answer its own permission request" };
    return { ok: true, request: { ...base, target: `R-${p.id}`, permId: p.id, title: p.what } };
  }
  if (def.needs === 'version') {
    const next = String(ctx.nextVersion || '');
    if (!next) return { ok: false, reason: 'you have not set a Next version for this project (Project page); Claude never picks one' };
    if (cmd.version !== next) return { ok: false, reason: `Claude may only ${cmd.kind} your Next version v${next}, not v${cmd.version}; Claude never picks a version number` };
    return { ok: true, request: { ...base, target: `v${next}`, version: next } };
  }
  // settings
  const hard = hardLimit(cmd.key);
  if (hard) return { ok: false, reason: hard };
  const table = cmd.kind === 'setting' ? APP_SETTINGS : PROJECT_SETTINGS;
  if (!(cmd.key in table)) return { ok: false, reason: `"${cmd.key}" isn't a setting Claude can ask about` };
  const v = parseValue(table[cmd.key], cmd.value);
  if (!v.ok) return { ok: false, reason: `"${cmd.value}" isn't a valid value for ${cmd.key}` };
  const before = cmd.kind === 'setting' ? ctx.settings?.[cmd.key] : ctx.projectSettings?.[cmd.key];
  if (JSON.stringify(before) === JSON.stringify(v.value)) return { ok: false, reason: `${cmd.key} is already ${JSON.stringify(v.value)}` };
  return { ok: true, request: { ...base, target: cmd.key, key: cmd.key, before: before === undefined ? null : before, after: v.value } };
}

// What exactly will happen, for the popup and the chat card.
export function describe(req, { projectName = '' } = {}) {
  const def = ACT_KINDS[req.kind] || { label: req.kind };
  const parts = [];
  if (req.taskId) parts.push(`${def.label} T-${req.taskId}${req.title ? ` “${req.title}”` : ''}${req.kind === 'assign' ? ` to ${req.agent}` : ''}`);
  else if (req.permId) parts.push(`${def.label} R-${req.permId}${req.title ? `: ${req.title}` : ''}`);
  else if (req.version) parts.push(`${def.label} v${req.version}`);
  else if (req.key) parts.push(`${def.label} ${req.key}: ${JSON.stringify(req.before)} → ${JSON.stringify(req.after)}`);
  return {
    what: parts[0] || def.label,
    facts: [
      ['Project', projectName || req.projectId],
      ...(req.branch ? [['Branch', req.branch]] : []),
      ...(req.sha ? [['Commit', String(req.sha).slice(0, 12)]] : []),
      ...(req.note ? [['Note', req.note]] : []),
      ...(req.key ? [['Old value', JSON.stringify(req.before)], ['New value', JSON.stringify(req.after)]] : []),
      ['Approval level', { routine: 'Routine', major: 'Major', owner: 'Owner-only' }[req.level] || req.level],
      ['Asked by', 'Claude'],
    ],
  };
}

// Only the owner's own typed message counts: exactly yes / approve / no / deny (optionally
// with the request id). Text from an AI, a relayed post, a quote or a log never counts.
export function typedDecision(msg, pending = []) {
  if (!msg || msg.who !== 'owner' || msg.relayed || msg.auto || msg.quoted) return null;
  const t = String(msg.text || '').trim();
  if (!t || t.startsWith('>')) return null;
  const m = t.match(/^(yes|approve|approved|allow|no|deny|denied)[.!]?(?:\s+(A[A-Z0-9]{6}))?[.!]?$/i);
  if (!m) return null;
  const decision = /^(yes|approve|approved|allow)$/i.test(m[1]) ? 'allow' : 'deny';
  const open = pending.filter((r) => r.status === 'pending');
  if (m[2]) { const r = open.find((x) => x.id === m[2].toUpperCase()); return r ? { decision, id: r.id } : { decision, error: `no open request ${m[2].toUpperCase()}` }; }
  if (open.length === 1) return { decision, id: open[0].id };
  if (!open.length) return null;
  return { decision, error: `${open.length} requests are waiting; type ${decision === 'allow' ? 'yes' : 'no'} with the request id, e.g. "yes ${open[open.length - 1].id}"` };
}

// Right before running: the request must still be exactly what the owner approved.
// cur: { now, projectId, chatId, sha (current head of the task, if any), settingNow, nextVersion }
export function stillValid(req, cur) {
  if (!req || req.status !== 'pending') return { ok: false, reason: 'already answered' };
  if (cur.now > Date.parse(req.expiresAt)) return { ok: false, reason: 'it expired (requests last 30 minutes)' };
  if (req.projectId !== cur.projectId) return { ok: false, reason: 'the project changed since it was asked' };
  if ((req.chatId || null) !== (cur.chatId || null)) return { ok: false, reason: 'it was asked in another chat' };
  if (req.sha && cur.sha !== undefined && cur.sha !== req.sha) return { ok: false, reason: `T-${req.taskId} moved from ${String(req.sha).slice(0, 7)} to ${String(cur.sha || 'nothing').slice(0, 7)} since it was asked` };
  if (req.key && JSON.stringify(cur.settingNow) !== JSON.stringify(req.before)) return { ok: false, reason: `${req.key} changed since it was asked` };
  if (req.version && req.version !== cur.nextVersion) return { ok: false, reason: `your Next version is no longer v${req.version}` };
  if (req.key && hardLimit(req.key)) return { ok: false, reason: hardLimit(req.key) };
  return { ok: true };
}

// Mark a request answered (used once).
export function settle(req, decision, { by = 'owner', how = 'popup', now = Date.now(), reason = '' } = {}) {
  req.status = decision === 'allow' ? 'allowed' : decision === 'deny' ? 'denied' : 'refused';
  req.decidedAt = new Date(now).toISOString();
  req.decidedBy = by;
  req.how = how;
  if (reason) req.reason = reason;
  return req;
}

// Settings Claude changed with your yes: shown with who changed it and one-click undo.
export function undoEntry(req, now = Date.now()) {
  return { id: req.id, scope: req.kind === 'setting' ? 'app' : 'project', projectId: req.projectId, key: req.key, before: req.before, after: req.after, by: 'Claude, with your yes', at: new Date(now).toISOString(), undone: false };
}

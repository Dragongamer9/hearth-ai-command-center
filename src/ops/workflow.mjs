// Team workflow rules (pure functions, unit tested): the task truth card, the review
// ledger and sha-locked sign-off, run modes (verify only, docs and research), the review
// handoff lock, the task instruction log, the review packet, blocker kinds, the release
// gate and the notes validator, and tags that appeared without the app.
import { NAMES } from '../chat.mjs';
import { short, REVIEWABLE, reviewerCanApprove } from '../owner.mjs';

const CLOSED = ['approved', 'rejected'];
const clip = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ''));
const nm = (a) => NAMES[a] || a || 'nobody';
export const moved = (a, b) => `head moved since your review (${short(a)}→${short(b)})`;

// ---------- A. the task truth card (from git facts, never from AI reports) ----------
// facts: { branch, head, behind, ahead, stat, merged: 'main'|'release/next'|null, dirty }
export function testAt(task, sha) {
  if (!sha) return null;
  const map = task?.testAt || {};
  const k = Object.keys(map).find((x) => x === sha || (x.length >= 7 && sha.startsWith(x)) || x.startsWith(sha));
  return k ? { sha: k, ...map[k] } : null;
}
export function recordTest(task, sha, r = {}) {
  if (!task || !sha) return;
  task.testAt = task.testAt || {};
  task.testAt[sha] = { status: r.status || 'not run', command: r.command || null, at: r.at || new Date().toISOString(), blocker: r.blocker || null };
  const keys = Object.keys(task.testAt);
  for (const k of keys.slice(0, Math.max(0, keys.length - 20))) delete task.testAt[k];
}
export function lastReview(task) { return (task?.reviews || []).slice(-1)[0] || null; }

export function truthCard(task, facts = {}) {
  const head = facts.head || null;
  const t = testAt(task, head);
  // The reviewer's last verdict (anyone's if the reviewer hasn't written one).
  const r = [...(task?.reviews || [])].reverse().find((x) => x.by === task.reviewer) || lastReview(task);
  return {
    branch: facts.branch || task?.ws?.branch || null,
    head,
    behind: Number.isFinite(facts.behind) ? facts.behind : null,
    ahead: Number.isFinite(facts.ahead) ? facts.ahead : null,
    stat: facts.stat || '',
    dirty: Boolean(facts.dirty),
    tests: t ? { status: t.blocker ? 'blocked' : t.status, sha: t.sha, command: t.command, exact: true } : { status: 'not run at this commit', sha: head, exact: false },
    review: r ? { by: r.by, verdict: r.verdict, sha: r.sha, accepted: r.accepted, why: r.why || '', stale: Boolean(r.accepted && r.verdict === 'approve' && r.sha && head && r.sha !== head) } : null,
    merged: facts.merged || null,
    known: Boolean(head),
  };
}
// One line for the lead's and reviewer's prompts.
export function truthLine(task, facts = {}) {
  const c = truthCard(task, facts);
  if (!c.known) return `T-${task.id}: no task branch yet`;
  const rev = c.review ? `${c.review.verdict === 'approve' ? 'APPROVE' : 'CHANGES'} by ${nm(c.review.by)} @${short(c.review.sha) || '?'} (${c.review.accepted ? 'accepted' : `refused: ${clip(c.review.why, 80)}`})` : 'none';
  return `T-${task.id}: ${c.branch || '?'} @${short(c.head)}, behind main ${c.behind ?? '?'}, ahead ${c.ahead ?? '?'}${c.stat ? ` (${c.stat})` : ''}${c.dirty ? ', uncommitted changes' : ''}; tests ${c.tests.status}${c.tests.exact ? ` @${short(c.tests.sha)}` : ''}; last review: ${rev}; merged: ${c.merged || 'neither'}`;
}

// ---------- B. the review ledger: every verdict is recorded against its sha ----------
export function recordReview(task, { by, verdict, sha = null, reason = '', at = new Date().toISOString(), accepted = false, why = '' }) {
  task.reviews = [...(task.reviews || []), { by, verdict, sha: sha || null, reason: clip(reason, 500), at, accepted: Boolean(accepted), why: clip(why, 300) }].slice(-30);
  return task.reviews[task.reviews.length - 1];
}
// The last commit `by` signed off (approved and accepted), for "diff since your last sign-off".
export function lastSigned(task, by) {
  return [...(task?.reviews || [])].reverse().find((r) => r.by === by && r.verdict === 'approve' && r.sha && (r.accepted || r.held)) || null;
}
// A reviewer's APPROVE that was refused only because the task was stopped or not handed
// over yet is held against the sha it named; it is never lost. It takes effect when the
// task reaches review at exactly that commit.
export function holdApproval(task, { by, sha, reason = '', at = new Date().toISOString() }) {
  if (!task || !sha || by !== task.reviewer || CLOSED.includes(task.stage) || task.stage === 'approval') return false;
  task.heldApproval = { by, sha, reason: clip(reason, 500), at };
  const last = lastReview(task);
  if (last && last.by === by && last.sha === sha && last.verdict === 'approve') last.held = true;
  return true;
}
// Returns { applied } / { dropped } / null. Mutates the task.
export function useHeldApproval(task, head, at = new Date().toISOString()) {
  const h = task?.heldApproval;
  if (!h || !head) return null;
  if (h.sha !== head && !head.startsWith(h.sha)) { delete task.heldApproval; return { dropped: true, why: moved(h.sha, head) }; }
  if (!REVIEWABLE.includes(task.stage) && !reviewerCanApprove(task) && task.stage !== 'implementing') return null;
  task.stage = 'approval';
  task.reviewVerdict = { by: h.by, verdict: 'approve', reason: h.reason, at, sha: head };
  delete task.heldApproval;
  delete task.changesSince;
  delete task.reviewWaiting;
  task.updatedAt = at;
  return { applied: true, by: h.by, sha: head };
}

// ---------- E/F/J. run modes, the review handoff lock and the sha lock ----------
export const RUN_MODES = {
  normal: 'Normal run',
  verify: 'Verify only: run checks and report',
  docs: 'Docs and research: may only change docs files',
};
const RESEARCH = /\b(research|investigat\w*|compare|comparison|survey|look into|find out|write[- ]?up|document\w*|docs?)\b/i;
export function defaultMode(task, agent) {
  if (task?.action === 'docs') return 'docs';
  if (agent === 'google' && RESEARCH.test(`${task?.title || ''}`)) return 'docs';
  return 'normal';
}
// Who may ask for a verify run: the owner, the lead, or the task's reviewer.
export function mayRequestVerify(task, who, lead) {
  return who === 'owner' || who === lead || who === task?.reviewer;
}
// May a run start now? Verify runs always may (they can't change anything).
export function runGate(task, { mode = 'normal' } = {}) {
  if (!task) return { ok: false, reason: 'no such task' };
  if (CLOSED.includes(task.stage)) return { ok: false, reason: `T-${task.id} is already ${task.stage}` };
  if (mode === 'verify') return { ok: true };
  const v = task.reviewVerdict;
  if (task.stage === 'approval' && v?.verdict === 'approve') return { ok: false, lock: 'sha', reason: `T-${task.id} is approved at ${short(v.sha) || 'its reviewed commit'}; commits after approval are refused, so only verify runs can start until it's merged or the Owner reopens it` };
  if (REVIEWABLE.includes(task.stage) || task.stage === 'approval') return { ok: false, lock: 'review', reason: `T-${task.id} is waiting for review${task.done?.sha ? ` of ${short(task.done.sha)}` : ''}; only verify runs can start until the reviewer posts CHANGES or the Owner reopens it` };
  return { ok: true };
}

// ---------- C. the task instruction log ----------
export const taskIds = (text) => [...new Set([...String(text || '').matchAll(/\bT-([A-Z0-9]{4,12})\b/g)].map((m) => m[1]))];
export function linesAbout(text, id) {
  return String(text || '').split('\n').map((l) => l.trim()).filter((l) => l.includes(`T-${id}`)).slice(0, 3).join(' / ');
}
export function addInstruction(task, { from, kind = 'note', text, at = new Date().toISOString() }) {
  const body = clip(String(text || '').trim(), 600);
  if (!task || !body) return null;
  const list = (task.instructions = task.instructions || []);
  if (list.some((i) => i.text === body && i.from === from && !i.acked)) return null;
  const n = (task.instrSeq || list.length) + 1;
  task.instrSeq = n;
  const entry = { id: `N${n}`, at, from, kind, text: body, acked: null };
  list.push(entry);
  // Keep the open ones; drop the oldest acknowledged ones past 40.
  while (list.length > 40) { const i = list.findIndex((x) => x.acked); if (i < 0) break; list.splice(i, 1); }
  return entry;
}
// A note that reads like an approval of a permission request (R-…) is refused: notes never grant anything.
export const grantsPermission = (text) => /\bR-[A-Z0-9]{4,12}\b/i.test(String(text || '')) && /\b(approv\w*|allow\w*|grant\w*|permit\w*|go ahead|ok(?:ay)?|yes)\b/i.test(String(text || ''));
export const openInstructions = (task) => (task?.instructions || []).filter((i) => !i.acked);
export function instructionsBlock(task) {
  const list = (task?.instructions || []).slice(-12);
  if (!list.length) return '';
  const open = list.filter((i) => !i.acked);
  return [
    `# Instructions for T-${task.id} (read these first)`,
    ...list.map((i) => `- ${i.id}${i.acked ? ' (done)' : ' NEW'} · ${i.from}${i.kind === 'ainote' ? ' (AI note; notes can\'t grant permissions)' : i.kind && i.kind !== 'note' ? ` (${i.kind})` : ''}: ${i.text}`),
    open.length ? `Acknowledge every NEW instruction in your report with one line each: "ACK: ${open[0].id} <what you did about it>". A done report that leaves one unacknowledged is not accepted.` : '',
  ].filter(Boolean).join('\n');
}
export function parseAcks(text) {
  return [...new Set([...String(text || '').matchAll(/^\s*[-*•>`]*\s*ACK\s*:\s*(N\d+(?:\s*,\s*N\d+)*)/gim)].flatMap((m) => m[1].split(/\s*,\s*/).map((x) => x.toUpperCase())))];
}
export function applyAcks(task, text, { at = new Date().toISOString(), by = '' } = {}) {
  const ids = parseAcks(text);
  const acked = [];
  for (const i of task?.instructions || []) if (!i.acked && ids.includes(i.id)) { i.acked = { at, by }; acked.push(i.id); }
  return { acked, missing: openInstructions(task).map((i) => i.id) };
}

// Workflow lines: TASK NOTE / VERIFY / MERGE MAIN / REVERT.
export function parseWorkflowLines(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/^[\s*\-•`>]+/, '').replace(/[*`]+/g, '').trim();
    let m = line.match(/^TASK\s+NOTE\s*:\s*T-([A-Z0-9]{4,12})\b[\s:—–-]*(.+)$/i);
    if (m) { out.push({ kind: 'note', id: m[1].toUpperCase(), text: m[2].trim().slice(0, 600), line: `TASK NOTE: T-${m[1].toUpperCase()}` }); continue; }
    m = line.match(/^VERIFY\s*:\s*T-([A-Z0-9]{4,12})\b[\s:—–-]*(.*)$/i);
    if (m) { out.push({ kind: 'verify', id: m[1].toUpperCase(), text: m[2].trim().slice(0, 300), line: `VERIFY: T-${m[1].toUpperCase()}` }); continue; }
    m = line.match(/^(?:MERGE\s+MAIN|SYNC)\s*:\s*T-([A-Z0-9]{4,12})\b/i);
    if (m) { out.push({ kind: 'mergemain', id: m[1].toUpperCase(), line: `MERGE MAIN: T-${m[1].toUpperCase()}` }); continue; }
    m = line.match(/^REVERT\s*:\s*T-([A-Z0-9]{4,12})\s+([0-9a-f]{7,40})\b[\s:—–-]*(.*)$/i);
    if (m) out.push({ kind: 'revert', id: m[1].toUpperCase(), sha: m[2].toLowerCase(), text: m[3].trim().slice(0, 300), line: `REVERT: T-${m[1].toUpperCase()} ${m[2].slice(0, 7)}` });
  }
  return out;
}

// B. Every action line gets a result: lines that look like actions but got none.
const VERB = /^(APPROVED?|CHANGES|START|RELEASE|TAG|REWRITE|DENY|DENIED|ALLOW|ADD\s+TASK|VERIFY|TASK\s+NOTE|MERGE\s+MAIN|SYNC|REVERT|ATTACH|IMAGE\s+REQUEST|BACKGROUND|EDIT|RETRACT|HANDOFF)\b\s*:?/i;
const actKey = (line) => {
  const l = String(line || '').replace(/^[\s*\-•`>]+/, '').replace(/[*`]+/g, '').trim();
  const m = l.match(VERB);
  if (!m) return null;
  const verb = m[1].toUpperCase().replace(/\s+/g, ' ').replace(/^APPROVED$/, 'APPROVE').replace(/^DENIED$/, 'DENY').replace(/^SYNC$/, 'MERGE MAIN');
  const ref = (l.slice(m[0].length).match(/[TR]-[A-Z0-9]{4,12}|#\w+|v?\d+(?:\.\d+)+|\S+/i) || [''])[0].toUpperCase();
  return `${verb}|${ref}`;
};
export function unanswered(text, results = []) {
  const done = new Set(results.map((r) => actKey(r.line)).filter(Boolean));
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const l = raw.replace(/^[\s*\-•`>]+/, '').replace(/[*`]+/g, '').trim();
    if (!VERB.test(l) || !/^[A-Z ]+\s*:/.test(l)) continue; // only "VERB:" lines in capitals
    const k = actKey(l);
    if (k && !done.has(k) && !out.some((x) => actKey(x) === k)) out.push(l.slice(0, 120));
  }
  return out;
}

// ---------- G. the review packet (one ping per commit) ----------
export function shouldPing(task, sha) {
  if (!task) return false;
  const key = sha || `done:${task.done?.at || ''}`;
  return task.reviewPing?.key !== key;
}
export function markPinged(task, sha, at = new Date().toISOString()) {
  task.reviewPing = { key: sha || `done:${task.done?.at || ''}`, sha: sha || null, at };
}
// Previous CHANGES by this reviewer and whether each was addressed by a later commit.
// commitsAfter: { [changesSha]: ['abc1234 subject', …] }
export function changesStatus(task, by, commitsAfter = {}) {
  return (task?.reviews || []).filter((r) => r.by === by && r.verdict === 'changes').slice(-5).map((r) => {
    const after = r.sha ? commitsAfter[r.sha] || [] : [];
    return { reason: r.reason, sha: r.sha, at: r.at, addressed: after.length > 0, commits: after.slice(0, 6) };
  });
}
export function reviewPacket({ task, by, sha, base = null, baseLabel = 'main', stat = '', diff = '', log = '', commitsAfter = {}, facts = null }) {
  const t = testAt(task, sha);
  const prev = changesStatus(task, by, commitsAfter);
  return [
    `REVIEW PACKET for T-${task.id} “${task.title}”`,
    `Review exactly this commit: ${sha || 'unknown (no task branch)'}`,
    facts ? `Truth: ${truthLine(task, facts)}` : '',
    `Tests at ${short(sha) || 'this commit'}: ${t ? `${t.blocker ? `blocked (${t.blocker})` : t.status}${t.command ? ` — \`${t.command}\`` : ''}` : 'not run at this commit'}`,
    `Changes since ${baseLabel}${base ? ` (${short(base)})` : ''}:`,
    log ? `Commits:\n${clip(log, 2000)}` : 'No commits.',
    stat ? `Files:\n${clip(stat, 2000)}` : '',
    diff ? `Diff:\n${clip(diff, 9000)}` : '',
    prev.length ? 'Your previous CHANGES requests:' : 'You have no earlier CHANGES requests on this task.',
    ...prev.map((p) => `- ${p.addressed ? 'ADDRESSED' : 'NOT ADDRESSED'} (asked at ${short(p.sha) || '?'}): ${p.reason}${p.addressed ? `\n  by: ${p.commits.join('; ')}` : '\n  no commit since then'}`),
    `End with exactly one line: "APPROVE: T-${task.id} @${short(sha)}" or "CHANGES: T-${task.id} <what must be fixed>". To have the checks run again without anyone editing, write "VERIFY: T-${task.id}".`,
  ].filter(Boolean).join('\n');
}

// ---------- H. blockers: environment problems are never the implementer's code failure ----------
export const BLOCKER_LABEL = { dependency: 'Missing dependency', tool: 'Missing tool', permission: 'Permission denied', environment: 'Environment problem', conflict: 'Merge conflict', code: 'Code failure' };
export function classifyFailure(log = '') {
  const t = String(log || '');
  let m;
  if ((m = t.match(/Could not find '([^']*\*[^']*)'/)) || /node --test\s+['"][^'"]*\*/.test(t)) {
    return { kind: 'environment', title: 'Test glob not expanded', detail: `The test runner got a literal glob${m ? ` (${m[1]})` : ''}: this Node version doesn't expand quoted globs (Node 21+ does).`, next: 'Use Node 22 for tests, or set the test command on the Project page to an unquoted glob (e.g. node --test test/*.test.*).' };
  }
  if (/engine "node" is incompatible|Unsupported engine|requires? node(?:\.js)?\s*(?:version\s*)?[><=^~]*\s*\d/i.test(t)) {
    const want = ((t.match(/(?:Expected version|wanted: \{"node":|requires? node(?:\.js)?\s*(?:version)?)\s*"?([><=^~\d.x |]+)/i) || [])[1] || '').trim();
    return { kind: 'environment', title: 'Wrong Node version', detail: `The project wants Node ${want || 'another version'}.`, next: `Install Node ${want || 'the version in package.json engines'} (e.g. with nvm) and run the tests again.` };
  }
  if ((m = t.match(/Cannot find (?:module|package) '([^'.\/][^']*)'/)) || /npm ERR! missing|no node_modules|ERR_MODULE_NOT_FOUND[^\n]*node_modules/i.test(t)) {
    return { kind: 'dependency', title: 'Dependencies not installed', detail: m ? `Module ${m[1]} is not installed.` : 'node_modules is missing or incomplete.', next: 'Set the test command to "npm ci && npm test" on the Project page (or run npm ci in the task workspace), then run the tests again.' };
  }
  if ((m = t.match(/(?:^|\n|: )([\w.-]+): (?:command )?not found/)) || (m = t.match(/spawn (\S+) ENOENT/))) {
    return { kind: 'tool', title: 'Tool not installed', detail: `${m[1]} is not installed on this computer.`, next: `Install ${m[1]} (or add it to PATH), then run again.` };
  }
  if (/EACCES|EPERM|Permission denied|permission (?:was )?denied|R-[A-Z0-9]{4,12} (?:was )?denied/i.test(t)) {
    return { kind: 'permission', title: 'Permission denied', detail: 'A file, folder or permission request was denied.', next: 'Answer the pending permission card, or grant the folder in Settings › Folder access.' };
  }
  if (/cannot open display|Missing X server|\$DISPLAY|ENOSPC|EAI_AGAIN|getaddrinfo|ETIMEDOUT|ECONNREFUSED|out of memory|Killed\b/i.test(t)) {
    return { kind: 'environment', title: 'Machine-dependent failure', detail: clip((t.match(/[^\n]*(?:display|ENOSPC|EAI_AGAIN|getaddrinfo|ETIMEDOUT|ECONNREFUSED|memory|Killed)[^\n]*/i) || [''])[0].trim(), 200), next: 'This depends on the computer (display, network, disk or memory), not the code. Fix the machine or mark the test as needing it, then run again.' };
  }
  return { kind: 'code', title: 'Tests failed', detail: '', next: 'The implementer fixes the failing tests.' };
}

// ---------- I. the release gate ----------
// The checklist and the gate are in electron/ops/gate.cjs: the main process enforces them.
// Tags or releases on GitHub that the app didn't make. remote: [{ name, sha }].
export function unknownTags(remote = [], { baseline = [], made = [], seen = [] } = {}) {
  const known = new Set([...baseline, ...made, ...seen]);
  return remote.filter((t) => t && t.name && !known.has(t.name));
}

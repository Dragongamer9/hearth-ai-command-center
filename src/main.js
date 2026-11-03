import './styles.css';
import { policyCheck } from './policy.mjs';
import { recipients, buildPrompt, buildDelta, parseProposals, parseDirectives, applyEdit, applyRetract, makeRequest, decideRequest, blockedAgents, mentions, NAMES, PERMISSION_KINDS, HOLD_BADGES, authProblem, makeHold, holdLifted } from './chat.mjs';
import { buildTaskBrief, nextAgent, parseStatus, taskRunState, recoverInterrupted, RUN_STATES, roleKinds, taskNeed, inQueue, queueOf, nextQueued, placeNext, placeLast, startLabel, redistribute } from './team.mjs';
import { short, parseVerdicts, applyVerdict, ownerAction, REVIEWABLE, requestChanges, reviewBaseline, checkDoneAfterReview, testResult, TEST_LABEL, clearStaleApproval, doneLine } from './owner.mjs';
import { panelState, holdStatus, keyTestLine } from './presence.mjs';
import { findDuplicate } from './dupes.mjs';
import { parseAttachLines, mediaFor } from './media.mjs';
import { chatPlan, canOwnerSend, newRound, ownerInterrupt, stopRound, cameAfterOwner, beginPass } from './room.mjs';
import { leadOn, parseLeadLines, leadDecision, leadLabel, leadUndoable, pickReviewer } from './lead.mjs';
import { AGENTS, AGENT_IDS, WEB_ONLY, HEADLESS, EDITORS, API_CAPABLE, DEFAULT_ROLES, BILLING, ACCESS_NOTE, OLLAMA_NOTE, COLORS } from './registry.mjs';
import { viewHabitat, mountHabitat, stopHabitat, habitatPresence } from './habitat.mjs';
import { applyHabitatLines, habitatSection, stripHabitatLines } from './habitat/actions.mjs';
import { HEARTH_OS, RED_FLAGS } from './hearth.mjs';
import { tokensToCss, pickMode } from './theme.mjs';
import { createOps } from './ops/ui.mjs';
import { setLevels as setApprovalLevels } from './ops/approval.mjs';
import { createLeadWaker, waitingForLead } from './ops/leadwake.mjs';

const api = window.hearth;

// ---------- constants ----------
const STAGES = {
  intake: 'Intake & policy',
  implementing: 'Implementing',
  checkpoint: 'Checkpoint saved',
  testing: 'Tests & evidence',
  review: 'Independent review',
  approval: 'Owner approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

const COLUMNS = [
  { title: 'Intake', stages: ['intake'] },
  { title: 'In progress', stages: ['implementing', 'checkpoint'] },
  { title: 'Verify', stages: ['testing', 'review'] },
  { title: 'Owner approval', stages: ['approval'] },
  { title: 'Closed', stages: ['approved', 'rejected'] },
];

const NEXT = {
  intake: ['implementing', 'Start work'],
  implementing: ['checkpoint', 'Mark checkpoint saved'],
  checkpoint: ['testing', 'Tests & evidence collected'],
  testing: ['review', 'Send to independent review'],
  review: ['approval', 'Request owner approval'],
};

const ACTIONS = { code: 'Code change', docs: 'Docs', merge: 'Merge', release: 'Release', deploy: 'Deploy' };
const API_ONLY = AGENT_IDS.filter((a) => AGENTS[a].kind === 'api');
const MAX_HOPS = 6;

// ---------- state ----------
let state = { version: 1, tasks: [], audit: [], models: {}, chat: [], agentStatus: {}, autoHandoff: true, roles: {}, lead: 'anthropic', disabled: {}, permissions: [], chatSessions: {} };
let ui = { view: 'overview', selected: null, modal: null, busy: {}, draft: '', target: 'all', typing: null, running: {}, saving: {}, changes: {}, expanded: null, side: 'anthropic', signin: {}, installOllama: false, editing: null, showHist: {}, typingSet: new Set(), attach: [], lightbox: null, hist: { q: '', provider: 'all', source: 'all', list: [], sel: null, stats: null, kind: 'auto', scanning: false }, prs: { list: [], loaded: false, msg: '', byTask: {} }, release: { version: '', confirm: '', target: '', notes: '', draft: true } };
let backups = { recoveredFrom: null, backups: [] };
let settings = { project: null, projects: [], connection: { anthropic: 'cli', openai: 'cli', xai: 'cli', mistral: 'cli', perplexity: 'api', deepseek: 'api' }, bins: {}, access: 'standard', extraDirs: [], autoPush: true, chatEdits: true, chatResume: true, theme: 'hearth', reduceMotion: false };
let gh = { git: null, gh: null, ghUser: null };
let repo = { repo: false };
let cli = Object.fromEntries(AGENT_IDS.map((a) => [a, {}]));
let info = { appVersion: '?', hearthOs: null, dataPath: '', electron: '?', packaged: false };
let prov = { encryption: false, weakEncryption: false, defaults: {}, keys: {} };
let upd = { enabled: false, reason: '', status: { state: 'idle' } };
let hearthTheme = { found: false, tokens: {}, css: '', dir: '~/.config/hearth' };
let consoleOut = {};
const keyTests = {};
// Team ops (src/ops/): summary, budget, strengths, stats, tests, CI, logs, projects, phone, voice.
const ops = createOps({
  api, esc: (s) => esc(s), NAMES, AGENTS, AGENT_IDS, EDITORS, HEADLESS, roleKinds, taskNeed, requestChanges,
  state: () => state, ui: () => ui, settings: () => settings, setSettings: (s) => { settings = s; setApprovalLevels(s.approvalLevels); ops.syncPowers(); },
  save: () => save(), render: () => render(), audit: (...a) => audit(...a), post: (m) => post(m), toast: (m) => toast(m),
  now: () => now(), uid: () => uid(), time: (x) => time(x), ago: (x) => ago(x), agentChip: (a) => agentChip(a), connected: (a) => connected(a),
  canRun: (a) => canRun(a), isFree: (a) => isFree(a), roleMap: () => roleMap(), moveWaiting: (a, id) => moveWaiting(a, id), assignTask: (t, a, why) => assignTask(t, a, why),
  runTask: (...a) => runTask(...a), startOrQueue: (t, a) => startOrQueue(t, a), decide: (...a) => decide(...a), sendChat: () => sendChat(),
  makeTask: (o, src) => makeTask(o, src), actionFor: (t) => actionFor(t),
  cli: () => cli, method: (a) => method(a), refreshAgents: async () => { await refreshAgents(); render(); },
});

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const now = () => new Date().toISOString();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const time = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const ago = (iso) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return time(iso);
};
const cleanErr = (m) => String(m).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

let saveChain = Promise.resolve();
// Serialized, atomic saves (the main process writes temp -> fsync -> rename).
function save() {
  saveChain = saveChain.then(() => api.saveState(state)).catch((e) => toast(`Could not save: ${cleanErr(e.message)}`));
  return saveChain;
}

function audit(event, taskId, detail = '', actor = 'owner') {
  state.audit.unshift({ id: uid(), at: now(), actor, event, taskId, detail });
}

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 4500);
}

// ---------- theme ----------
function applyTheme() {
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  const follow = settings.theme === 'hearth' && hearthTheme.found;
  document.documentElement.dataset.mode = pickMode(settings.theme, { ...hearthTheme, systemDark });
  const set = (id, css) => {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    el.textContent = css;
  };
  set('hearth-tokens', follow ? tokensToCss(hearthTheme.tokens) : '');
  set('hearth-css', follow ? hearthTheme.css || '' : '');
}

// ---------- agent helpers ----------
const agentChip = (id) => {
  const a = AGENTS[id] || AGENTS.none;
  return `<span class="agent ${a.cls}"><i></i>${esc(a.name)}</span>`;
};
const avatar = (id) => `<span class="avatar ${AGENTS[id]?.cls || ''}" style="background:${COLORS[id] || '#67707b'}">${esc((AGENTS[id]?.name || '?')[0])}</span>`;

function method(a) {
  if (API_ONLY.includes(a)) return 'api';
  return API_CAPABLE.includes(a) ? settings.connection[a] || 'cli' : 'cli';
}

function connected(a) {
  if (state.disabled?.[a]) return false;
  const c = cli[a] || {};
  if (a === 'freebuff') return Boolean(c.installed);
  if (a === 'ollama') return Boolean(c.installed && c.models?.length);
  if (method(a) === 'api') return Boolean(prov.keys[a]);
  if (a === 'mistral') return Boolean(c.installed && c.signedIn !== false);
  return Boolean(c.installed && c.signedIn);
}
function outInfo(a) {
  const st = state.agentStatus[a];
  if (!st?.outUntil) return null;
  if (Date.now() > Date.parse(st.outUntil)) return null;
  return st;
}
const blocked = () => blockedAgents(state.permissions);
// A saved sign-in hold (a refused login or key) keeps the AI out until it changes.
const authHold = (a) => state.agentStatus?.[a]?.hold || null;
const canRun = (a) => Boolean(AGENTS[a]?.headless) && connected(a) && !outInfo(a) && !authHold(a);
const liveAgents = () => HEADLESS.filter(canRun);
const liveEditors = () => EDITORS.filter((a) => canRun(a) && method(a) !== 'api');
const busyOn = (a) => Object.entries(ui.running).find(([, r]) => r.agent === a);

// Short, clear status: linked / signed out / out of usage / working on …
function statusOf(a) {
  const c = cli[a] || {};
  if (state.disabled?.[a]) return { text: 'turned off', cls: '' };
  if (outInfo(a)) return { text: 'out of usage', cls: 'bad' };
  const b = busyOn(a);
  if (b) return { text: b[0].startsWith('CHAT') ? 'working in team chat' : `working on T-${b[0]}`, cls: 'accent', live: true };
  if (isTyping(a)) return { text: 'replying in team chat', cls: 'accent', live: true };
  if (blocked().includes(a)) return { text: 'waiting for your answer', cls: 'warn' };
  const held = holdStatus(authHold(a), Boolean(prov.keys[a]));
  if (held) return held;
  if (method(a) === 'api') return prov.keys[a] ? { text: 'linked (API key)', cls: 'good' } : { text: 'needs API key', cls: 'warn' };
  if (a === 'ollama') return c.installed ? (c.models?.length ? { text: 'running', cls: 'good' } : { text: 'no models yet', cls: 'warn' }) : { text: 'not running', cls: 'warn' };
  if (!c.installed) return { text: 'not installed', cls: 'warn' };
  if (a === 'freebuff') return { text: 'installed · hands-on', cls: 'good' };
  if (a === 'mistral' && c.signedIn === null) return { text: 'installed · sign-in not checkable', cls: '' };
  return c.signedIn ? { text: 'linked', cls: 'good' } : { text: 'signed out', cls: 'warn' };
}
const statusText = (a) => statusOf(a).text;
const statusBadge = (a) => { const s = statusOf(a); return `<span class="badge ${s.cls}">${s.live ? '<span class="dot pulse"></span>' : ''}${esc(s.text)}</span>`; };

function runBadge(t) {
  const st = taskRunState(t, { running: Boolean(ui.running[t.id]), saving: Boolean(ui.saving?.[t.id]) });
  if (!st) return '';
  const cls = { running: 'accent', saving: 'accent', limit: 'warn', outage: 'warn', timeout: 'warn', auth: 'bad', not_installed: 'bad', resume: '' }[st];
  return `<span class="badge ${cls}">${st === 'running' ? '<span class="dot pulse"></span>' : ''}${esc(RUN_STATES[st])}</span>`;
}

function stageBadge(t) {
  if (t.stage === 'approved') return '<span class="badge good"><span class="dot"></span>Approved</span>';
  if (t.stage === 'rejected') return '<span class="badge bad"><span class="dot"></span>Rejected</span>';
  if (!t.policy.ok) return '<span class="badge bad">Blocked by policy</span>';
  if (t.stage === 'approval') return '<span class="badge warn">Awaiting you</span>';
  return `<span class="badge">${esc(STAGES[t.stage])}</span>`;
}

const pendingAsks = () => state.permissions.filter((p) => p.status === 'pending');
const openTasks = () => state.tasks.filter((t) => !['approved', 'rejected'].includes(t.stage));

// ---------- queue: one task at a time per AI ----------
function queueText(t) {
  if (!inQueue(t)) return '';
  const q = queueOf(state.tasks, t.assignee);
  const i = q.findIndex((x) => x.id === t.id);
  if (t.startNext) return 'next up';
  return q.length > 1 && i >= 0 ? `queue ${i + 1} of ${q.length}` : '';
}
function queueBadge(t) {
  const q = queueText(t);
  return q ? `<span class="badge ${t.startNext ? 'accent' : ''}" title="${esc(NAMES[t.assignee])} works one task at a time">${esc(q === 'next up' ? 'Next up' : q[0].toUpperCase() + q.slice(1))}</span>` : '';
}
function assignTask(t, agent, why) {
  if (!t || t.assignee === agent) return;
  const prev = t.assignee;
  t.assignee = agent;
  if (t.reviewer === agent) t.reviewer = pickReviewer(agent, { candidates: [...HEADLESS.filter(canRun), ...HEADLESS.filter((a) => !canRun(a))], lead: state.lead });
  audit(`Handed off to ${NAMES[agent]}`, t.id, why || `from ${NAMES[prev] || 'unassigned'}`);
}
const roleMap = () => Object.fromEntries(AGENT_IDS.map((a) => [a, state.roles[a] || DEFAULT_ROLES[a]]));
const isFree = (a) => canRun(a) && !busyOn(a) && !isTyping(a) && !blocked().includes(a);

// Start now, or, if that AI is busy, queue it as Start next (several run oldest-first).
function startOrQueue(t, a) {
  if (!t) return null;
  ops.beforeStart(t, a);
  const b = busyOn(a);
  if ((b && b[0] !== t.id) || isTyping(a)) {
    if (t.startNext && t.assignee === a) { toast(`T-${t.id} is already next for ${NAMES[a]}.`); return 'queued'; }
    assignTask(t, a, `queued behind ${b ? `T-${b[0]}` : 'team chat'}`);
    t.queuedAt = placeNext(state.tasks.filter((x) => x.id !== t.id), a, now());
    t.startNext = true;
    save();
    render();
    toast(`${NAMES[a]} is busy. T-${t.id} starts as soon as they finish.`);
    return 'queued';
  }
  return runTask(t, a);
}

// Each free AI starts its next Start-next task.
async function pumpQueues() {
  if (!settings.project) return;
  ops.routeQueued();
  const starts = [];
  for (const a of EDITORS) {
    if (!isFree(a)) continue;
    const next = nextQueued(state.tasks, a);
    if (next?.startNext) starts.push(runTask(next, a));
  }
  // Done tasks waiting for a reviewer who couldn't run: send them now if they can.
  for (const t of state.tasks) {
    if (t.stage === 'review' && t.reviewWaiting && HEADLESS.includes(t.reviewer) && isFree(t.reviewer) && !ui.busy[t.id]) starts.push(askForTask(t, 'opinion'));
  }
  await Promise.all(starts);
}

// An AI ran out of usage: its waiting tasks go to free AIs with the same kind of role.
function moveWaiting(agent, currentId) {
  if (!state.autoHandoff) return '';
  const moves = redistribute({ tasks: state.tasks, agent, currentId, available: EDITORS.filter((a) => canRun(a)), roles: roleMap(), lead: state.lead });
  for (const m of moves) {
    const t = state.tasks.find((x) => x.id === m.id);
    assignTask(t, m.to, `${NAMES[agent]} ran out of usage`);
    t.queuedAt = placeLast(state.tasks.filter((x) => x.id !== t.id), m.to, now());
  }
  return moves.length ? ` Waiting tasks moved: ${moves.map((m) => `T-${m.id} → ${NAMES[m.to]}`).join(', ')}.` : '';
}

// ---------- owner actions ----------
const actionFor = (t) => ownerAction(t, { permissions: state.permissions, running: Boolean(ui.running[t.id]), saving: Boolean(ui.saving?.[t.id]), canRun, free: liveEditors() });
function ownerButton(t) {
  const a = actionFor(t);
  if (!a) return '';
  // Passive states (queued with Start next) read as a label, not a button.
  if (a.passive) return `<div class="owner-act"><span class="badge accent">${esc(a.label)}</span><span class="why">${esc(a.reason)}</span></div>`;
  return `<div class="owner-act"><button class="btn primary small" data-owneract="${t.id}">${esc(a.label)}</button><span class="why">${esc(a.reason)}</span></div>`;
}

// Reviewer lines (APPROVE:/CHANGES: T-…) in a reply. Only the assigned reviewer
// counts; with the lead switch on, the lead's lines act for the owner (lead.mjs).
async function handleVerdicts(agent, text) {
  const restart = [];
  const leading = leadOn({ enabled: settings.leadActions === true, agent, lead: state.lead });
  for (const v of parseVerdicts(text)) {
    const t = state.tasks.find((x) => x.id === v.taskId);
    const vline = `${v.verdict === 'approve' ? 'APPROVE' : 'CHANGES'}: T-${v.taskId}`;
    if (!t) { ops.actionResult(agent, vline, false, `unknown task id T-${v.taskId}`); continue; }
    if (agent === 'ollama') { const lr = ops.localMayReview(t); if (!lr.ok) { ops.actionResult(agent, vline, false, lr.reason, t.id); continue; } }
    if (leading) {
      const dec = leadDecision({ kind: v.verdict, id: v.taskId, reason: v.reason }, { ...leadCtx(), task: t, resumable: actionFor(t)?.kind === 'resume' });
      if (!dec.skip) { await leadAct({ kind: v.verdict, id: v.taskId, reason: v.reason }, dec, t); continue; }
    }
    const sha = v.verdict === 'approve' && t.ws ? await api.workspaceHead(t.id).catch(() => null) : null;
    const r = applyVerdict(t, { by: agent, verdict: v.verdict, reason: v.reason, at: now(), sha });
    if (!r.ok) { post({ who: 'system', text: `${NAMES[agent]} wrote ${v.verdict === 'approve' ? 'APPROVE' : 'CHANGES'} for T-${v.taskId}, but ${r.reason}.` }); ops.actionResult(agent, vline, false, r.reason, t.id); continue; }
    ops.actionResult(agent, vline, true, v.verdict === 'approve' ? 'moved to approval' : `sent back to ${NAMES[t.assignee] || 'its implementer'}`, t.id);
    ops.recordVerdict(t, v.verdict, agent);
    wakeLead(v.verdict === 'approve' ? 'task reached approval' : 'reviewer verdict', agent);
    if (v.verdict === 'approve') {
      audit('Reviewer approved', t.id, `${NAMES[agent]}${sha ? ` at ${sha}` : ''}${v.reason ? `: ${v.reason}` : ''}`, agent);
      post({ who: 'system', text: `${NAMES[agent]} approved T-${t.id} “${t.title}”${sha ? ` at ${sha}` : ''}. It's in Approvals, waiting for you.` });
    } else {
      audit('Reviewer requested changes', t.id, `${NAMES[agent]}: ${v.reason}`, agent);
      post({ who: 'system', text: `${NAMES[agent]} sent T-${t.id} “${t.title}” back to ${NAMES[t.assignee] || 'its implementer'}: ${v.reason}` });
      if (EDITORS.includes(t.assignee) && canRun(t.assignee)) restart.push(t);
    }
  }
  save();
  render();
  for (const t of restart) startOrQueue(t, t.assignee);
}

// An approval covers the exact commit it was given for. If a task branch has moved
// since, the approval is cleared and the task goes back to review.
async function recheckApprovals(list = state.tasks.filter((t) => t.stage === 'approval' && t.ws && t.reviewVerdict?.sha)) {
  let changed = false;
  for (const t of list) {
    const head = await api.workspaceHead(t.id).catch(() => null);
    const was = t.reviewVerdict;
    if (clearStaleApproval(t, head, now())) {
      changed = true;
      audit('Approval cleared: branch changed', t.id, `${was.sha} → ${head}`);
      post({ who: 'system', text: `T-${t.id} “${t.title}” changed after ${NAMES[was.by]} approved ${was.sha} (now ${head}). The approval was cleared and it's back in review.` });
    }
  }
  if (changed) { save(); render(); }
  return changed;
}

// The commit that was approved (or reported done): what a merge must use.
const approvedSha = (t) => (t.reviewVerdict?.verdict === 'approve' && t.reviewVerdict.sha) || t.done?.sha || null;

// Short commit + test result for a reported-done task (board and Approvals).
function doneBadge(t) {
  if (!t.done) return '';
  const cls = { passed: 'good', failed: 'bad' }[t.done.tests] || '';
  return `${t.done.sha ? `<span class="badge mono" title="Reported done at this commit">${esc(short(t.done.sha))}</span>` : ''}<span class="badge ${cls}">${esc(TEST_LABEL[t.done.tests] || 'tests not run')}</span>${t.done.testsChanged ? '<span class="badge warn">tests changed by this task</span>' : ''}`;
}

// ---------- the lead acting for the owner ----------
const leadCtx = () => ({ lead: state.lead, enabled: settings.leadActions === true, tasks: state.tasks, powers: ops.syncPowers() });

// START / APPROVE R- / DENY R- / ADD TASK lines from the lead (switch on only).
function handleLeadLines(agent, text) {
  ops.leadLines(agent, text); // MEMORY: proposals become owner-approved cards
  if (!leadOn({ enabled: settings.leadActions === true, agent, lead: state.lead })) {
    // No silent no-ops: say why each board line was ignored.
    for (const cmd of parseLeadLines(text)) ops.actionResult(agent, cmd.kind === 'add' ? `ADD TASK: ${cmd.title}` : cmd.version ? `${cmd.kind.toUpperCase()}: ${cmd.version}` : `${{ start: 'START', allow: 'APPROVE', deny: 'DENY' }[cmd.kind] || cmd.kind.toUpperCase()}: ${['allow', 'deny'].includes(cmd.kind) ? 'R' : 'T'}-${cmd.id}`, false, agent !== state.lead ? `only the lead (${NAMES[state.lead]}) can do that` : 'ignored because the lead switch is off');
    return;
  }
  if (!leadOn({ enabled: settings.leadActions === true, agent, lead: state.lead })) return;
  for (const cmd of parseLeadLines(text)) {
    const t = cmd.id ? state.tasks.find((x) => x.id === cmd.id) : null;
    const request = cmd.id ? state.permissions.find((p) => p.id === cmd.id) : null;
    leadAct(cmd, leadDecision(cmd, { ...leadCtx(), task: t, request }), t, request);
  }
}

function leadRecord(action, ref, detail, undo = null) {
  const lead = state.lead;
  const label = leadLabel(lead, action, ref, detail);
  state.leadLog = state.leadLog || [];
  const entry = { id: uid(), at: now(), lead, action, ref, undo: leadUndoable(action) ? undo : null };
  state.leadLog.unshift(entry);
  state.leadLog = state.leadLog.slice(0, 200);
  audit(label, ref.startsWith('T-') ? ref.slice(2) : null, '', lead);
  post({ who: 'system', text: label, leadUndo: entry.undo ? entry.id : undefined });
  return entry;
}

// Carries out an allowed lead action with the same steps as the owner's buttons.
async function leadAct(cmd, dec, t = null, request = null) {
  const lead = state.lead;
  if (dec.ignored) return;
  const ref = cmd.version ? `v${String(cmd.version).replace(/^v/, '')}` : cmd.id ? `${cmd.kind === 'allow' || cmd.kind === 'deny' ? 'R' : 'T'}-${cmd.id}` : `“${cmd.title}”`;
  if (!dec.ok) {
    audit(`${NAMES[lead]} (lead) was refused`, t?.id || null, `${ref}: ${dec.reason}`, lead);
    state.leadRefusals = [...(state.leadRefusals || []), { ref, reason: dec.reason, at: now() }].slice(-8);
    ops.actionResult(lead, `${({ allow: 'APPROVE', deny: 'DENY', add: 'ADD TASK' })[cmd.kind] || cmd.kind.toUpperCase()}: ${ref}`, false, dec.reason, t?.id || null);
    post({ who: 'system', text: `${NAMES[lead]} (lead) can't act on ${ref}: ${dec.reason}.${dec.duplicate ? ` Open T-${dec.duplicate} instead.` : ''}` });
    save();
    render();
    return;
  }
  const title = t ? ` “${t.title}”` : '';
  ops.actionResult(lead, `${({ allow: 'APPROVE', deny: 'DENY', add: 'ADD TASK' })[cmd.kind] || cmd.kind.toUpperCase()}: ${ref}`, true, `done (${dec.action})`, t?.id || null);
  if (dec.action === 'release' || dec.action === 'tag' || dec.action === 'rewrite') {
    // The main process re-checks the switch, the owner's Next version, the version file and the guard.
    const r = dec.action === 'rewrite'
      ? await api.opsRewriteTask(t.id, true).catch((err) => ({ ok: false, message: cleanErr(err.message) }))
      : await api.opsLeadRelease(dec.action, dec.version).catch((err) => ({ ok: false, message: cleanErr(err.message) }));
    if (!r?.ok) return leadAct(cmd, { ok: false, reason: r?.message || 'not available' }, t);
    leadRecord(dec.action, ref, `— ${r.message}${dec.action === 'rewrite' ? '' : ' This can\'t be undone.'}`);
    if (r.dispatched) ops.watchRelease(dec.version);
    save();
    render();
    return;
  }
  if (dec.action === 'merge') {
    if (await recheckApprovals([t])) return leadAct(cmd, { ok: false, reason: `T-${t.id} changed after its review, so it went back to review` }, t);
    const pr = ui.prs.byTask[t.id];
    let r;
    if (pr && pr.state === 'OPEN') {
      if (pr.checks?.failed) return leadAct(cmd, { ok: false, reason: `PR #${pr.number} has failing checks` }, t);
      r = await api.gitPrMerge(pr.number, { byLead: true, sha: approvedSha(t) }).catch((err) => ({ ok: false, message: cleanErr(err.message) }));
    } else {
      r = await api.gitMergeApproved(t.id, { byLead: true, sha: approvedSha(t) }).catch((err) => ({ ok: false, message: cleanErr(err.message) }));
    }
    if (!r.ok) return leadAct(cmd, { ok: false, reason: `the merge stopped: ${r.message}` }, t);
    t.decision = 'approved';
    t.notes.push({ at: now(), who: `${NAMES[lead]} (lead)`, text: r.message });
    t.stage = 'approved';
    t.updatedAt = now();
    leadRecord('merge', `T-${t.id}`, `${title} — ${r.message} This can't be undone.`);
    await refreshGit().catch(() => {});
  } else if (dec.action === 'approve') {
    t.decision = 'approved';
    t.stage = 'approved';
    t.updatedAt = now();
    const entry = leadRecord('approve', `T-${t.id}`, `${title} (nothing merged into main or released)`, { kind: 'stage', id: t.id, stage: 'approval' });
    save();
    await leadIntegrate(t);
    // Once it is on the release branch, Undo would not take it back off: don't offer it.
    if (t.integratedInto) { entry.undo = null; post({ who: 'system', text: `T-${t.id} is now on ${t.integratedInto}, so this approval can't be undone here; it stays on the release branch.` }); }
  } else if (dec.action === 'changes') {
    const prev = t.stage;
    t.stage = 'implementing';
    t.updatedAt = now();
    t.notes.push({ at: now(), who: `${NAMES[lead]} (lead)`, text: `CHANGES REQUESTED: ${cmd.reason}` });
    requestChanges(t, { by: lead, reason: cmd.reason, at: now() });
    leadRecord('changes', `T-${t.id}`, `${title}: ${cmd.reason}`, { kind: 'stage', id: t.id, stage: prev });
  } else if (dec.action === 'start' || dec.action === 'resume') {
    leadRecord(dec.action, `T-${t.id}`, title, { kind: 'start', id: t.id });
    save();
    render();
    await startOrQueue(t, dec.action === 'resume' ? (actionFor(t)?.agent || t.assignee) : t.assignee);
    return;
  } else if (dec.action === 'allowperm' || dec.action === 'denyperm') {
    leadRecord(dec.action, `R-${request.id}`, `(${NAMES[request.agent]}: ${request.what})${cmd.reason ? ` — ${cmd.reason}` : ''}`, { kind: 'perm', id: request.id });
    return decide(request.id, dec.action === 'allowperm' ? 'approved' : 'denied', `${NAMES[lead]} (lead)`);
  } else if (dec.action === 'add') {
    const assignee = aliasOrNone(cmd.implementer, EDITORS) || (liveEditors().find((a) => a !== lead) || lead);
    const reviewer = pickReviewer(assignee, { requested: aliasOrNone(cmd.reviewer, HEADLESS), candidates: HEADLESS.filter(canRun), lead });
    const nt = makeTask({ title: cmd.title, description: cmd.details, assignee, reviewer, action: ['code', 'docs'].includes(cmd.action) ? cmd.action : 'code' }, `${NAMES[lead]} (lead)`);
    if (!nt) return;
    leadRecord('add', `T-${nt.id}`, `“${nt.title}”`, { kind: 'add', id: nt.id });
  }
  save();
  render();
}

function aliasOrNone(word, allowed) {
  const a = AGENT_IDS.find((id) => AGENTS[id].mention.includes(String(word || '').toLowerCase()));
  return a && allowed.includes(a) ? a : null;
}

// Files an AI named with ATTACH lines: copied into the attachments folder (only from
// inside the workspace), then posted with its message.
async function agentAttachments(parsed, base, agent) {
  const atts = [];
  for (const f of parsed.files) {
    const r = await api.attachFromAgent(f.path, base).catch((e) => ({ ok: false, message: cleanErr(e.message) }));
    if (r?.ok) { atts.push({ ...r.att, from: f.path }); audit('Routine: posted an attachment', null, `${NAMES[agent]}: ${f.path} (no approval needed)`, agent); }
    ops.actionResult(agent, `ATTACH: ${f.path}`, Boolean(r?.ok), r?.ok ? 'posted' : r?.message || 'failed');
  }
  return { atts, text: parsed.text };
}

// Owner presses Undo on a lead action.
async function undoLead(id) {
  const e = (state.leadLog || []).find((x) => x.id === id);
  if (!e || !e.undo || e.undone) return toast('That can no longer be undone.');
  const u = e.undo;
  const t = u.id ? state.tasks.find((x) => x.id === u.id) : null;
  if (u.kind === 'perm') {
    const p = state.permissions.find((x) => x.id === u.id);
    if (!p || p.status !== 'denied') return toast('That request has changed since; nothing to undo.');
    p.status = 'pending';
    delete p.decidedAt;
  } else if (u.kind === 'add') {
    if (!t || (t.runs || []).length) return toast('Work on that task has started; remove it from the board instead.');
    state.tasks = state.tasks.filter((x) => x.id !== t.id);
  } else if (u.kind === 'start') {
    if (!t) return;
    const r = ui.running[t.id];
    if (r) await api.cancelRun(r.runId).catch(() => {});
    delete t.startNext;
  } else if (u.kind === 'stage') {
    if (!t || (t.stage === 'approved' && t.decision === 'approved' && u.stage !== 'approval')) return;
    if (t.integratedInto) return toast(`T-${t.id} is already on ${t.integratedInto}; it stays on the release branch.`);
    t.stage = u.stage;
    if (u.stage === 'approval') delete t.decision;
    delete t.changesSince;
  }
  e.undone = true;
  audit(`Owner undid: ${leadLabel(e.lead, e.action, e.ref)}`, t?.id || null);
  post({ who: 'system', text: `You undid: ${leadLabel(e.lead, e.action, e.ref)}.` });
  save();
  render();
}

// ---------- views ----------
function viewOverview() {
  return `${ops.summaryCard()}${viewOverviewMain()}`;
}
function viewOverviewMain() {
  const open = openTasks();
  const waiting = state.tasks.filter((t) => t.stage === 'approval');
  const asks = pendingAsks();
  const ready = AGENT_IDS.filter((a) => canRun(a) || (a === 'freebuff' && connected(a))).length;
  const counts = Object.fromEntries(Object.keys(STAGES).map((s) => [s, state.tasks.filter((t) => t.stage === s).length]));
  const flow = ['intake', 'implementing', 'checkpoint', 'testing', 'review', 'approval'];
  const openPrs = ui.prs.list.filter((p) => p.state === 'OPEN').length;
  const active = open.filter((t) => ui.running[t.id] || ['implementing', 'checkpoint', 'testing', 'review'].includes(t.stage)).slice(0, 6);
  const roster = AGENT_IDS.filter((a) => connected(a) || ui.running[a] || state.tasks.some((t) => t.assignee === a && !['approved', 'rejected'].includes(t.stage)));
  const recentChat = state.chat.filter((m) => !m.deleted && m.who !== 'system').slice(-5).reverse();
  return `${setupChecklist()}
    <div class="grid stats">
      <div class="card stat"><div class="n">${open.length}</div><div class="l">Open tasks</div></div>
      <div class="card stat"><div class="n" style="color:${waiting.length + asks.length ? 'var(--warn)' : 'var(--strong)'}">${waiting.length + asks.length}</div><div class="l">Waiting for you<br><span class="faint">${waiting.length} approval${waiting.length === 1 ? '' : 's'} · ${asks.length} permission${asks.length === 1 ? '' : 's'}</span></div></div>
      <div class="card stat"><div class="n">${ready}<span class="muted" style="font-size:15px"> / ${AGENT_IDS.length}</span></div><div class="l">AIs ready</div></div>
      <div class="card stat"><div class="n">${ui.prs.loaded ? openPrs : '—'}</div><div class="l">Open pull requests</div></div>
    </div>
    <div class="grid three mb">
      <div class="card"><h3>What each AI is doing<span class="grow"></span><button class="btn small link" data-nav="agents">Agents →</button></h3>
        <div class="who-list">${(roster.length ? roster : ['anthropic', 'openai', 'google']).map((a) => {
          const b = busyOn(a);
          const t = b ? state.tasks.find((x) => x.id === b[0]) : null;
          const assigned = state.tasks.filter((x) => x.assignee === a && !['approved', 'rejected'].includes(x.stage)).length;
          const last = [...state.chat].reverse().find((m) => m.who === a);
          const what = t ? `T-${t.id} ${t.title}` : isTyping(a) ? 'replying in team chat' : last ? `said: ${last.text.replace(/\s+/g, ' ').slice(0, 80)}` : assigned ? `${assigned} task${assigned > 1 ? 's' : ''} assigned` : 'idle';
          return `<div class="w">${avatar(a)}<div style="min-width:90px"><b style="color:var(--strong)">${esc(AGENTS[a].name)}</b>${a === state.lead ? ' <span class="faint">★</span>' : ''}<div>${statusBadge(a)}</div></div><span class="what" title="${esc(what)}">${esc(what)}</span><div class="load" title="${assigned} assigned"><div style="width:${Math.min(100, assigned * 25)}%"></div></div></div>`;
        }).join('')}</div>
      </div>
      <div class="card"><h3>Active work<span class="grow"></span><button class="btn small link" data-nav="board">Board →</button></h3>
        ${active.map((t) => `<div class="task" data-open="${t.id}"><div class="t">${esc(t.title)}</div><div class="meta">${stageBadge(t)}${runBadge(t)}${agentChip(t.assignee)}${t.pr ? `<span class="badge accent">PR #${esc(t.pr.number || '')}</span>` : ''}</div></div>`).join('') || '<div class="empty">Nothing in progress. Start a task, or ask the team in Team chat.</div>'}
      </div>
      <div class="card"><h3>Quick actions</h3>
        <div class="quick">
          <button class="btn" data-new>＋ New task</button>
          <button class="btn" data-nav="chat">✎ Message the team</button>
          <button class="btn" data-checkin ${liveAgents().length ? '' : 'disabled'}>◎ Team check-in</button>
          <button class="btn" data-nav="approvals">✓ Review approvals</button>
          <button class="btn" data-histscan>⟳ Sync CLI chats</button>
          <button class="btn" data-nav="history">⌕ Search chat history</button>
          <button class="btn" data-gitpull ${repo.repo && repo.remote ? '' : 'disabled'}>⇣ Pull latest</button>
          <button class="btn" data-openweb="${esc(state.lead)}">⧉ Open ${esc(AGENTS[state.lead].name)} site</button>
        </div>
      </div>
    </div>
    <div class="grid two mb">
      <div class="card"><h3>Recent team chat<span class="grow"></span><button class="btn small link" data-nav="chat">Open chat →</button></h3>
        <div class="mini-chat">${recentChat.map((m) => `<div class="m"><div>${m.who === 'owner' ? '<b>You</b>' : agentChip(m.who)} <span class="faint">${esc(ago(m.at))}${m.edited ? ' · edited' : ''}</span></div><div class="t">${esc(m.retracted ? '(retracted)' : m.text)}</div></div>`).join('') || '<div class="empty">No messages yet.</div>'}</div>
      </div>
      <div class="card"><h3>Needs you</h3>
        ${asks.map((p) => `<div class="task" data-nav="chat"><div class="t">${esc(PERMISSION_KINDS[p.kind])}: ${esc(p.what)}</div><div class="meta">${agentChip(p.agent)}<span class="badge warn">Permission request R-${esc(p.id)}</span></div></div>`).join('')}
        ${waiting.map(taskRow).join('')}
        ${!asks.length && !waiting.length ? '<div class="empty">Nothing is waiting for you.</div>' : ''}
      </div>
    </div>
    <div class="grid two">
      <div class="card">
        <h3>Governance flow</h3>
        <div class="pipe">
          ${flow.map((s, i) => `<span class="step ${s === 'approval' ? 'gate' : ''}">${esc(STAGES[s])}<b>${counts[s]}</b></span>${i < flow.length - 1 ? '<span class="arrow">›</span>' : ''}`).join('')}
          <span class="arrow">›</span><span class="step">Approved<b>${counts.approved}</b></span>
          <span class="step">Rejected<b>${counts.rejected}</b></span>
        </div>
      </div>
      <div class="card">
        <h3>Recent activity<span class="grow"></span><button class="btn small link" data-nav="audit">Audit log →</button></h3>
        ${state.audit.slice(0, 5).map((a) => `<div class="row" style="font-size:12.5px;padding:3px 0"><span class="faint" style="width:110px">${esc(ago(a.at))}</span><span style="flex:1">${esc(a.event)}${a.detail ? ` <span class="muted">— ${esc(String(a.detail).slice(0, 70))}</span>` : ''}</span></div>`).join('') || '<div class="empty">No activity yet.</div>'}
      </div>
    </div>`;
}

// First-run checklist: link your AIs (no API keys needed) and pick a project.
function setupChecklist() {
  const linked = EDITORS.filter(connected);
  const done = linked.length > 0 && settings.project;
  if (done && state.setupDismissed) return '';
  const step = (ok, text, btn) => `<div class="setup-step ${ok ? 'ok' : ''}"><span class="tick">${ok ? '✓' : ''}</span><span style="flex:1">${text}</span>${ok ? '' : btn}</div>`;
  return `<div class="card mb">
    <h3>Set up your AI team<span class="grow"></span>${done ? '<button class="btn small ghost" data-dismisssetup>Hide</button>' : ''}</h3>
    <p class="muted" style="font-size:12.5px;margin:0 0 6px">Sign in with your own accounts on each provider's own page — no passwords pass through this app.</p>
    ${['anthropic', 'openai', 'google'].map((a) => step(connected(a), `<b>${AGENTS[a].name}</b> <span class="muted">· ${esc(AGENTS[a].plan)}</span>`,
      `<button class="btn small primary" data-signin="${a}">Sign in</button>`)).join('')}
    ${step(connected('ollama'), '<b>Local AI</b> <span class="muted">· optional, free, works offline (Ollama)</span>', cli.ollama.installed ? '' : ui.signin.ollama?.state === 'installing' ? '<button class="btn small" disabled><span class="dot pulse"></span> Installing…</button>' : '<button class="btn small" data-install="ollama" title="Runs Ollama’s official installer in a terminal. It asks for your computer password there; this app never sees it.">Install Ollama</button>')}
    ${step(Boolean(gh.ghUser), `<b>GitHub</b> <span class="muted">· ${gh.ghUser ? `signed in as ${esc(gh.ghUser)}` : 'sign in on github.com to pull, push and track pull requests'}</span>`, gh.gh ? '<button class="btn small primary" data-ghlogin>Connect GitHub</button>' : '<button class="btn small" data-nav="github">How to install</button>')}
    ${step(Boolean(settings.project), '<b>Shared project folder</b> <span class="muted">· the git repo the AIs work on</span>', '<button class="btn small primary" data-pickproject>Choose folder</button>')}
    <div class="row" style="margin-top:6px"><button class="btn small ghost" data-recheck>Re-check</button><span class="faint" style="font-size:12px">More AIs (Grok, Mistral, Qwen, Perplexity, DeepSeek, Copilot, Meta AI) are on the Agents page.</span></div>
  </div>`;
}

function taskRow(t) {
  return `<div class="task" data-open="${t.id}"><div class="t">${esc(t.title)}</div><div class="meta">${stageBadge(t)}${agentChip(t.assignee)}<span class="badge">${esc(ACTIONS[t.action])}</span></div></div>`;
}

// The team chat's own workspace id, one per project (so switching projects never mixes them up).
function chatId() {
  let h = 0;
  for (const c of String(settings.project || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `CHAT${h.toString(36).toUpperCase().padStart(6, '0').slice(-6)}`;
}
const chatCanEdit = () => Boolean(settings.chatEdits && settings.project && gh.git);

// After a checkpoint, back the branch up to GitHub (never main).
// Lead handles GitHub: on by default only when GitHub is already set up.
// Lead handles GitHub: only when the owner turned it on (settings never change by themselves).
const leadGitHubOn = () => settings.leadGitHub === true;

async function autoPush(taskId) {
  if (settings.autoPush === false) return null; // the owner turned automatic pushes off
  if (leadGitHubOn() && repo.remote) {
    const r = await api.gitLeadSync('push', taskId).catch((e) => ({ ok: false, message: cleanErr(e.message) }));
    leadGitNote(r.ok ? `pushed ${r.branch} (${short(r.sha)})` : `couldn't push ${r.branch || `T-${taskId}`}: ${r.message}`, taskId);
    return r;
  }
  if (!settings.autoPush || !gh.ghUser || !repo.remote) return null;
  return api.gitPushTask(taskId).catch((e) => ({ ok: false, message: cleanErr(e.message) }));
}

// Every push and pull the lead does shows in Team chat and the Audit log.
function leadGitNote(what, taskId = null) {
  const text = `${NAMES[state.lead]} (lead) ${what}`;
  audit(text, taskId && /^[A-Z0-9]{4,12}$/.test(taskId) ? taskId : null, '', state.lead);
  post({ who: 'system', text });
}

async function leadFetch() {
  if (!leadGitHubOn() || !repo.remote) return null;
  const r = await api.gitLeadSync('fetch').catch((e) => ({ ok: false, message: cleanErr(e.message) }));
  if (r.ok && state.lastFetch !== `${r.branch}@${r.sha}`) { state.lastFetch = `${r.branch}@${r.sha}`; leadGitNote(`pulled from GitHub: ${r.branch} is at ${r.sha}`); save(); }
  else if (!r.ok) leadGitNote(`couldn't pull from GitHub: ${r.message}`);
  return r;
}

// An approved task goes to the lead, who merges it onto release/next and pushes it.
async function leadIntegrate(t) {
  if (!leadGitHubOn() || !t?.ws) return;
  await leadFetch();
  const r = await api.gitLeadSync('integrate', t.id).catch((e) => ({ ok: false, message: cleanErr(e.message) }));
  t.notes.push({ at: now(), who: `${NAMES[state.lead]} (lead)`, text: r.message });
  if (r.ok) t.integratedInto = r.release;
  if (r.ok) leadGitNote(`merged T-${t.id} onto ${r.release} (${short(r.sha)})${r.pushed ? ` and pushed ${r.release}` : ''}`, t.id);
  else {
    leadGitNote(`couldn't merge T-${t.id} onto release/next: ${r.message}`, t.id);
    if (r.conflicts?.length) {
      const fix = makeTask({ title: `Resolve release/next conflicts with T-${t.id}`, description: `T-${t.id} “${t.title}” conflicts with release/next in: ${r.conflicts.join(', ')}.\nIn this workspace: git fetch origin, git merge origin/release/next and ${t.ws.branch}, resolve the conflicts keeping both sides' behaviour, run the tests, report TESTS: and STATUS: DONE.`, assignee: EDITORS.includes(state.lead) ? state.lead : t.assignee, reviewer: t.assignee, action: 'code' }, `${NAMES[state.lead]} (lead)`);
      if (fix) post({ who: 'system', text: `Added T-${fix.id} for ${NAMES[fix.assignee]} to resolve it.` });
    }
  }
  save();
  render();
}

async function refreshGit() {
  try { gh = await api.gitTools(); } catch {}
  try { repo = await api.gitStatus(); } catch { repo = { repo: false }; }
}
async function refreshPrs() {
  if (!gh.ghUser || !repo.remote) { ui.prs = { ...ui.prs, list: [], loaded: false, msg: gh.ghUser ? 'The active project has no GitHub remote.' : 'Connect GitHub to see pull requests.' }; return; }
  const r = await api.gitPrList().catch((e) => ({ ok: false, prs: [], message: cleanErr(e.message) }));
  ui.prs.list = r.prs || [];
  ui.prs.loaded = r.ok;
  ui.prs.msg = r.ok ? '' : r.message;
}

// What every AI is told about the app, the team and the board.
function chatCtx() {
  return {
    lead: state.lead,
    project: settings.project,
    chatEdits: chatCanEdit(),
    extraDirs: settings.extraDirs,
    pending: pendingAsks(),
    roster: AGENT_IDS.map((id) => ({ id, role: state.roles[id] || DEFAULT_ROLES[id], status: statusText(id) })),
    board: openTasks().map((t) => ({ id: t.id, title: t.title, stage: STAGES[t.stage], assignee: t.assignee, reviewer: t.reviewer, state: RUN_STATES[taskRunState(t, { running: Boolean(ui.running[t.id]) })], queue: queueText(t) })),
    leadActions: settings.leadActions === true,
    // With the lead switch on, the lead sees what waits for it and its refused actions.
    ...(settings.leadActions === true ? { waiting: waitingForLead({ tasks: state.tasks, permissions: state.permissions, lead: state.lead, running: ui.running, editors: EDITORS }), refusals: state.leadRefusals || [] } : {}),
  };
}

// The lead gets a short turn when something needs it (switch on only; debounced).
const leadWaker = createLeadWaker({
  isOn: () => settings.leadActions === true,
  lead: () => state.lead,
  canRun: () => canRun(state.lead) && !blocked().includes(state.lead) && !isTyping(state.lead),
  run: (why) => runRoom([state.lead], { trigger: `lead check: ${why.join(', ')}` }),
});
const wakeLead = (reason, from = null) => leadWaker.nudge(reason, from);

function markOut(a, err) {
  // Unknown reset time: assume an hour; you can mark it available any time.
  state.agentStatus[a] = { ...(state.agentStatus[a] || {}), outUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: err?.reset || 'usage limit reached' };
  audit(`${NAMES[a]} ran out of usage`, null, err?.reset || '');
}

// One way to talk to any agent, whatever it's linked by. Marks agents that run out.
async function callAgent(agent, prompt, opts = {}) {
  let res;
  try {
    res = await api.run({ agent, prompt, model: state.models[agent] || undefined, ...opts });
  } catch (e) {
    res = { ok: false, error: { kind: 'error', message: cleanErr(e.message) } };
  }
  if (!res.ok && res.error.kind === 'limit') markOut(agent, res.error);
  // A refused sign-in or key becomes a saved hold and a badge, shown once.
  if (!res.ok) {
    const problem = authProblem(res.error, { method: method(agent) });
    if (problem) { setHold(agent, problem); res.quiet = true; save(); }
  }
  updatePanel();
  return res;
}

function setHold(agent, problem) {
  state.agentStatus = state.agentStatus || {};
  const prev = authHold(agent);
  const hold = makeHold(problem, { signedIn: cli[agent]?.signedIn, hasKey: prov.keys?.[agent], at: now() }, prev);
  state.agentStatus[agent] = { ...(state.agentStatus[agent] || {}), hold };
  if (hold !== prev) audit(`${NAMES[agent]}: ${holdStatus(hold, Boolean(prov.keys?.[agent])).text}`, null, hold.message, agent);
}
function clearHold(a) {
  const st = state.agentStatus?.[a];
  if (!st?.hold) return false;
  delete st.hold;
  if (!Object.keys(st).length) delete state.agentStatus[a];
  return true;
}
// After a status check: lift a hold only when sign-in or the key really changed.
function liftHolds() {
  let changed = false;
  for (const a of AGENT_IDS) {
    const h = authHold(a);
    if (!h) continue;
    const c = cli[a] || {};
    if (method(a) !== 'api' && typeof c.signedIn !== 'boolean') continue; // a failed check proves nothing
    if (holdLifted(h, { method: method(a), signedIn: Boolean(c.signedIn), hasKey: Boolean(prov.keys?.[a]) })) changed = clearHold(a) || changed;
  }
  return changed;
}

async function refreshAgents() {
  try { settings = await api.settings(); } catch {}
  const list = await Promise.all(AGENT_IDS.map((a) => api.agentStatus(a).catch(() => ({}))));
  cli = Object.fromEntries(AGENT_IDS.map((a, i) => [a, list[i] || {}]));
  if (liftHolds()) save();
}

function attachmentsHtml(m) {
  if (!m.attachments?.length) return '';
  return `<div class="atts">${m.attachments.map((a, i) => a.kind === 'audio'
    ? `<figure><audio controls preload="none" src="${esc(a.url || '')}"></audio><figcaption>${esc(a.name)}</figcaption></figure>`
    : a.kind === 'video'
    ? `<figure><video controls preload="metadata" src="${esc(a.url || '')}"></video><figcaption>${esc(a.name)}${a.duration ? ` · ${Math.round(a.duration)}s` : ''}${a.note ? ` · ${esc(a.note)}` : ''}</figcaption></figure>`
    : `<figure><img src="${esc(a.url || '')}" alt="${esc(a.name)}" data-lightbox="${esc(m.id)}:${i}" title="Click to enlarge"><figcaption>${esc(a.name)}${ops.attMeta(m, a, i)}</figcaption></figure>`).join('')}</div>`;
}

// ---------- team status panel ----------
function renderPanel() {
  return AGENT_IDS.filter((a) => connected(a) || authHold(a) || outInfo(a) || a === state.lead).map((a) => {
    const st = panelState(statusOf(a), outInfo(a));
    const hold = authHold(a);
    return `<div class="team-member">${agentChip(a)}<span class="badge ${st.cls}"${hold?.message ? ` title="${esc(hold.message)}"` : ''}>${st.live ? '<span class="dot pulse"></span>' : ''}${esc(st.text)}</span>${st.detail ? `<small>${esc(st.detail)}</small>` : ''}</div>`;
  }).join('') || '<span class="faint">No AIs linked yet.</span>';
}
// ---------- Habitat (src/habitat.mjs) ----------
// The same state the status panel reads, one entry per enabled AI.
function habitatSnapshot() {
  const open = (t) => !['approved', 'rejected'].includes(t.stage);
  const ids = AGENT_IDS.filter((a) => !state.disabled?.[a] && (connected(a) || authHold(a) || outInfo(a) || a === state.lead || cli[a]?.installed || prov.keys?.[a] || busyOn(a) || state.tasks.some((t) => open(t) && t.assignee === a)));
  const reviewOf = (a) => {
    const id = Object.keys(ui.busy).find((k) => ui.busy[k] === 'opinion' && state.tasks.find((t) => t.id === k)?.reviewer === a);
    return id ? state.tasks.find((t) => t.id === id) : null;
  };
  const brief = (t) => (t ? { id: t.id, title: t.title, branch: t.ws?.branch || '' } : null);
  const reducedOs = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  // Real task facts for the Habitat's garden, desk lights, moods and visits.
  const lastTests = (t) => [...(t.runs || [])].reverse().find((r) => r.tests)?.tests || t.done?.tests || '';
  const ciOf = (t) => { const c = ui.prs.byTask?.[t.id]?.checks; return !c ? '' : c.failed ? 'failed' : c.pending ? 'pending' : c.total && c.passed === c.total ? 'passed' : ''; };
  const fact = (t) => ({ id: t.id, title: t.title, stage: t.stage, assignee: t.assignee, reviewer: t.reviewer, updatedAt: t.updatedAt, tests: lastTests(t), ci: ciOf(t), running: Boolean(ui.running[t.id]), merged: (t.notes || []).some((n) => /^Merged into /.test(n.text || '')), runs: (t.runs || []).slice(-6).map((r) => ({ a: r.agent, s: r.status })) });
  return {
    tasks: state.tasks.slice(-300).map(fact),
    chat: state.chat.slice(-12).map((m) => ({ id: m.id, who: m.who, text: String(m.text || '').slice(0, 200) })),
    store: state.habitat || null,
    ops: ops.snapshot(), // finished tasks, failures, per-AI budget, CI per task
    reduced: settings.reduceMotion === true || reducedOs,
    agents: ids.slice(0, 12).map((a) => {
      const b = busyOn(a);
      const task = b && !b[0].startsWith('CHAT') ? state.tasks.find((t) => t.id === b[0]) : null;
      const st = statusOf(a);
      const status = outInfo(a) ? 'out' : authHold(a) ? 'hold' : connected(a) ? 'idle' : 'signedout';
      return { id: a, name: AGENTS[a].name, color: COLORS[a] || '#888888', lead: a === state.lead, status, task: brief(task), reviewing: brief(reviewOf(a)), typing: isTyping(a) || Boolean(b && b[0].startsWith('CHAT')), waiting: blocked().includes(a), note: authHold(a)?.message || st.text };
    }),
  };
}
const habitatHooks = {
  snapshot: habitatSnapshot,
  openTask: (id) => { if (state.tasks.some((t) => t.id === id)) { ui.selected = id; render(); } },
  openAgent: (a) => { ui.view = 'agents'; ui.side = a; ui.expanded = a; ui.selected = null; render(); },
  openChat: () => { ui.view = 'chat'; ui.selected = null; render(); },
  // Habitat progress lives in the app state and is saved with it.
  saveStore: (h) => { state.habitat = h; save(); },
  audit: (event, detail = '') => { audit(event, null, detail); save(); },
};

// AIs acting in their Habitat with HABITAT: lines (logic in src/habitat/actions.mjs).
// Cosmetic and Routine: no approval card; every line is audited and gets a ✓/✗ result.
// d: the parsed reply; its HABITAT: lines are removed so @names in them don't call teammates in.
function habitatLines(agent, d, m) {
  const text = d.text;
  d.text = stripHabitatLines(text);
  const snap = habitatSnapshot();
  const r = applyHabitatLines(state.habitat, { agent, text, ids: snap.agents.map((a) => a.id), agents: snap.agents, names: NAMES, reduced: snap.reduced, local: agent === 'ollama' });
  if (!r.results.length) return;
  if (r.changed) state.habitat = r.store;
  for (const a of r.audits) audit(a.event, null, a.detail, agent);
  if (m) { m.text = stripHabitatLines(m.text); m.results = [...(m.results || []), ...r.results]; } else post({ who: 'system', text: r.results.map((x) => `${NAMES[agent]} · ${x.line}: ${x.ok ? '✓' : '✗'} ${x.reason}`).join('\n') });
}
// Every chat prompt gets the AI's one-line Habitat memory; full prompts also the rules.
function habitatPrompt(agent, resumed) {
  const snap = habitatSnapshot();
  const r = habitatSection(state.habitat, { agent, ids: snap.agents.map((a) => a.id), names: NAMES, local: agent === 'ollama', full: !resumed, agents: snap.agents, presence: habitatPresence() });
  if (r.changed) state.habitat = r.store;
  return r.text;
}

// Redraw only the panel (keeps the chat draft and scroll).
function updatePanel() {
  const el = document.getElementById('team-panel');
  if (el) el.innerHTML = renderPanel();
}

// ---------- team chat ----------
function askCard(p) {
  const st = p.status;
  return `<div class="ask ${st}">
    <div class="k">${st === 'pending' ? 'Permission request' : st === 'approved' ? 'Approved' : 'Denied'} · R-${esc(p.id)} · ${esc(PERMISSION_KINDS[p.kind])}${p.context !== 'chat' ? ` · T-${esc(p.context)}` : ''}</div>
    <div class="w">${esc(p.what)}</div>
    ${p.why ? `<div class="y">Why: ${esc(p.why)}</div>` : ''}
    ${st === 'pending' ? `<div class="row"><button class="btn small good" data-decide="${p.id}:approved">Approve</button><button class="btn small danger" data-decide="${p.id}:denied">Deny</button><button class="btn small ghost" data-decide="${p.id}:why">Ask why</button><span class="faint" style="font-size:11.5px">${esc(NAMES[p.agent])} is blocked until you answer.</span></div>`
      : `<div class="faint" style="font-size:11.5px">${esc(st)} by you ${esc(ago(p.decidedAt))} · recorded in the audit log</div>`}
  </div>`;
}

function chatMessage(m) {
  if (m.deleted) return '';
  const cls = { owner: 'me', system: 'sys' }[m.who] || '';
  const chip = m.who === 'owner' ? '<b style="color:var(--strong)">You</b>' : m.who === 'system' ? '' : agentChip(m.who) + (m.relayed ? '<span>relayed by you</span>' : '');
  const props = (m.proposals || []).map((p, i) => `<div class="prop">
      <div style="flex:1"><div>${esc(p.title)}</div><div class="meta row" style="margin-top:4px">${agentChip(p.assignee)}<span class="faint" style="font-size:11px">review</span>${agentChip(p.reviewer)}<span class="badge">${esc(ACTIONS[p.action])}</span></div></div>
      ${!p.taskId && p.dupOf && state.tasks.some((x) => x.id === p.dupOf) ? `<span class="badge warn" title="Similar to an open task">Looks like T-${esc(p.dupOf)}</span><button class="btn small primary" data-opendup="${esc(p.dupOf)}">Open T-${esc(p.dupOf)}</button><button class="btn small" data-adddup="${m.id}:${i}">Add anyway</button>` : ''}
      ${p.taskId ? `<button class="btn small ghost" data-open="${p.taskId}">On board ✓</button>` : p.dupOf && state.tasks.some((x) => x.id === p.dupOf) ? '' : `<button class="btn small" data-addprop="${m.id}:${i}">Add</button>${EDITORS.includes(p.assignee) ? `<button class="btn small primary" data-startprop="${m.id}:${i}" ${canRun(p.assignee) && settings.project ? '' : 'disabled'}>Add & start</button>` : ''}`}
    </div>`).join('');
  const pending = (m.proposals || []).filter((p) => !p.taskId).length;
  const asks = (m.asks || []).map((id) => state.permissions.find((p) => p.id === id)).filter(Boolean).map(askCard).join('');
  const edited = m.edited ? `<span class="edited" data-togglehist="${m.id}" title="Edited ${esc(time(m.editedAt))}${m.editedBy && m.editedBy !== m.who ? ` by ${esc(NAMES[m.editedBy])}` : ''} — click to see earlier versions">(edited)</span>` : '';
  const editing = ui.editing === m.id;
  const body = editing
    ? `<textarea id="edit-text" style="min-height:70px">${esc(m.text)}</textarea><div class="row" style="margin-top:6px"><button class="btn small primary" data-saveedit="${m.id}">Save</button><button class="btn small ghost" data-canceledit>Cancel</button></div>`
    : `<div class="body">${m.retracted ? `Message retracted by ${esc(NAMES[m.who])}.` : ops.bodyHtml(m)}${edited}</div>`;
  const hist = ui.showHist[m.id] && m.history?.length ? `<div class="hist">${m.history.map((h) => `${esc(time(h.at))} · ${esc(NAMES[h.by] || h.by)}${h.retracted ? ' retracted' : ' edited'} — earlier text:\n${esc(h.text)}`).join('\n\n')}</div>` : '';
  const tools = m.who !== 'system' && !editing ? `<div class="tools"><button data-editmsg="${m.id}" title="Edit (you can edit any message)">Edit</button><button data-delmsg="${m.id}" title="Delete">Delete</button></div>` : '';
  return `<div class="msg ${cls} ${m.err ? 'err' : ''} ${m.retracted ? 'retracted' : ''}">
    ${tools}
    ${chip ? `<div class="who">${chip}<span>${esc(time(m.at))}${m.model ? ` · ${esc(m.model)}` : ''}${m.auto ? ' · posted on its own' : ''}${m.parallel ? ' · answered in parallel, independently' : ''}${m.beforeOwner ? ' · written before your newest message' : ''}</span><span class="mid">#${esc(m.id)}</span></div>` : ''}
    ${body}${attachmentsHtml(m)}${ops.resultsHtml(m)}${hist}
    ${asks}
    ${m.leadUndo ? (() => { const e = (state.leadLog || []).find((x) => x.id === m.leadUndo); return e ? `<div class="row" style="margin-top:6px">${e.undone ? '<span class="badge">Undone</span>' : `<button class="btn small" data-leadundo="${esc(e.id)}">Undo</button>`}</div>` : ''; })() : ''}
    ${props ? `<div class="props">${props}${pending > 1 ? `<button class="btn small primary" data-addall="${m.id}" style="margin-top:4px;align-self:flex-start">Add all ${pending}</button>` : ''}</div>` : ''}
  </div>`;
}

function viewChat() {
  const live = liveAgents();
  const target = (id, label) => `<button class="chip ${ui.target === id ? 'on' : ''}" data-target="${id}" ${id !== 'all' && !live.includes(id) ? 'disabled' : ''}>${label}</button>`;
  if (ui.target !== 'all' && ui.target !== 'relay' && !live.includes(ui.target)) ui.target = 'all';
  const asks = pendingAsks().length;
  return `<div class="chat">
    <section class="team-status" aria-label="Team status"><div class="row"><b>Team status</b><span style="flex:1"></span><button class="btn small ghost" data-recheck>Re-check</button><button class="btn small link" data-nav="agents">Agents →</button></div><div class="team-panel" id="team-panel">${renderPanel()}</div></section>
    <div class="chat-top"><span style="flex:1"></span>
      ${asks ? `<span class="badge warn">${asks} waiting for your answer</span>` : ''}
      <span class="faint" style="font-size:11.5px" title="Each AI keeps one session for this room in its own CLI, so you can resume it there (Chat history → Resume).">${settings.chatResume ? 'Saved in each AI’s own CLI' : ''}</span>
      ${round ? '<button class="btn small danger" data-stopround title="End this chat round: nobody else starts, and the AIs typing now are cancelled">Stop</button>' : ''}<button class="btn small ghost" data-checkin ${live.length && !round ? '' : 'disabled'}>Team check-in</button>
      ${state.chat.length ? '<button class="btn small ghost" data-clearchat>Clear</button>' : ''}</div>
    <div class="chat-log" id="chat-log">
      ${state.chat.map(chatMessage).join('') || `<div class="empty" style="padding:28px;line-height:1.6">Say hi, or try: <i>"Here's the plan for Hearth's Settings › Storage page — split it into tasks between you."</i><br><br>
        Everyone sees every message. ${esc(AGENTS[state.lead].name)} ★ leads and answers first. AIs can mention and hand off to each other, post updates on their own, fix or retract their own messages, and must ask you before risky actions (pushes, merges, releases, deleting files, boot-critical changes, commands outside the workspace). You can edit or delete any message.
        ${live.length ? '' : '<br><br><span style="color:var(--warn)">No agents are linked yet — sign in on the Agents page.</span>'}</div>`}
      ${typingNow() ? `<div class="msg typing">${[...ui.typingSet].map(agentChip).join('')} <span class="muted">${ui.typingSet.size > 1 ? 'are replying (in parallel)…' : 'is replying…'}</span></div>` : ''}
    </div>
    <div class="chat-input">
      ${ui.attach.length ? `<div class="row att-pending" style="margin-bottom:7px">${ui.attach.map((a, i) => `<span class="badge">${a.kind === 'video' ? '🎬' : '🖼'} ${esc(a.name)}<button class="btn small link" data-unattach="${i}" title="Remove">✕</button></span>`).join('')}</div>` : ''}
      <div class="row" style="margin-bottom:7px"><span class="faint" style="font-size:12px">Send to</span>${target('all', 'Team (lead first)')}${HEADLESS.filter((a) => connected(a)).map((a) => target(a, AGENTS[a].name)).join('')}<span style="flex:1"></span><button class="chip ${ui.target === 'relay' ? 'on' : ''}" data-target="relay" title="Paste what FreeBuff said so everyone can see it">Post as FreeBuff</button></div>
      <div class="row" style="align-items:flex-end">
        <button class="btn ghost" data-attach title="Attach images or videos (or paste / drag them in)">📎</button>${ops.voiceButton()}
        <textarea id="chat-text" placeholder="Message the team…  (Enter to send, Shift+Enter for a new line, @name to address one AI)" style="flex:1;min-height:48px">${esc(ui.draft)}</textarea>
        <button class="btn primary" data-sendchat>Send</button>
      </div>
    </div>
  </div>`;
}

function post(msg) {
  const m = { id: uid(), at: now(), ...msg };
  state.chat.push(m);
  trimChat();
  return m;
}

async function sendChat() {
  const text = ui.draft.trim();
  // Never blocked by AI activity: only an empty box stops it.
  if (!canOwnerSend(text) && !ui.attach.length) return;
  if (ui.target === 'relay') {
    post({ who: 'freebuff', text: text.slice(0, 8000), relayed: true, proposals: parseProposals(text) });
    ui.draft = '';
    save();
    return render();
  }
  const live = liveAgents();
  const plan = chatPlan(text, live, ui.target, state.lead);
  const who = plan.queue;
  post({ who: 'owner', text: text.slice(0, 8000), attachments: ui.attach.length ? ui.attach : undefined });
  ops.mentionNotes(text);
  ui.draft = '';
  ui.attach = [];
  if (/@freebuff/i.test(text)) post({ who: 'system', text: 'FreeBuff only runs interactively, so it can’t answer in chat by itself. Open it from a task, then use “Post as FreeBuff” to share what it says.' });
  if (!who.length) {
    const mentioned = mentions(text);
    const asked = mentioned.length ? mentioned : (ui.target !== 'all' && ui.target !== 'relay' ? [ui.target] : []);
    // The status panel already shows their sign-in hold; don't add another line.
    const covered = asked.length > 0 && asked.every((a) => authHold(a));
    if (!covered) post({ who: 'system', text: live.length ? 'That AI isn’t available right now (not linked or out of usage).' : 'No AIs are available yet. Sign in on the Agents page.' });
  }
  const job = { queue: who, opts: { trigger: text, parallel: plan.parallel } };
  if (round) {
    // A round is running: cancel the AIs that haven't started, let the typing ones
    // finish, then restart with this message as the newest.
    const { cancelled } = ownerInterrupt(round, job);
    if (cancelled.length) post({ who: 'system', text: `${cancelled.map((a) => NAMES[a]).join(' and ')} won't answer the earlier message; the round restarts with yours.` });
    save();
    render();
    return;
  }
  save();
  render();
  if (who.length) await runRoom(job.queue, job.opts);
}

// The room. By default AIs answer one after another (lead first; teammates join when
// mentioned or handed off), each seeing every reply posted before its turn. When the
// owner asks several AIs at once they answer in parallel, independently. The owner can
// always write: his message cancels the AIs that haven't started yet in this round,
// lets the ones already typing finish, and restarts the round with his message.
let round = null;
const isTyping = (a) => ui.typingSet.has(a);
const typingNow = () => ui.typingSet.size > 0;

async function runRoom(queue, opts = {}) {
  if (round) { round.next.push({ queue, opts }); return; }
  round = newRound(uid());
  try {
    let job = { queue, opts };
    while (job) {
      beginPass(round);
      await roomPass(job.queue, job.opts);
      job = round.next.shift() || null;
    }
  } finally {
    round = null;
    ui.typingSet.clear();
    ui.typing = null;
    render();
    await pumpQueues();
  }
}

// Owner pressed Stop: nothing else starts, and the AIs typing now are cancelled.
async function stopChatRound() {
  if (!round) return;
  const { cancelled } = stopRound(round);
  for (const runId of Object.values(round.runs)) api.cancelRun(runId).catch(() => {});
  post({ who: 'system', text: `You stopped this round.${cancelled.length ? ` ${cancelled.map((a) => NAMES[a]).join(' and ')} won't answer.` : ''}` });
  save();
  render();
}

async function roomPass(queue, { trigger = '', allow = [], hops = 0, parallel = false } = {}) {
  queue = [...queue];
  const answered = [];
  const canEdit = chatCanEdit() && !parallel; // parallel answers are read-only so they can't clash
  if (canEdit && queue.length) {
    try {
      state.chatWs = state.chatWs?.id === chatId() ? state.chatWs : { ...(await api.ensureWorkspace(chatId(), 'team chat')), id: chatId() };
    } catch (e) {
      post({ who: 'system', text: `Chat can't edit files right now: ${cleanErr(e.message)} — answering read-only.` });
    }
  }
  const eligible = (agent) => {
    if (!canRun(agent)) return false;
    if (blocked().includes(agent) && !allow.includes(agent)) {
      const p = pendingAsks().find((x) => x.agent === agent);
      post({ who: 'system', text: `${NAMES[agent]} is waiting for your answer on R-${p.id} before it continues.` });
      return false;
    }
    return true;
  };
  if (parallel) {
    const group = queue.filter(eligible);
    round.waiting = [...group];
    const snapshot = state.chat.slice();
    const results = await Promise.all(group.map((agent) => chatTurn(agent, { trigger, canEdit: false, snapshot, parallel: true, answered })));
    queue = [];
    if (!round.stop && hops < MAX_HOPS) {
      for (const r of results) for (const next of r.followups) if (!group.includes(next) && !queue.includes(next) && canRun(next)) { queue.push(next); hops++; }
    }
  }
  round.waiting = [...queue];
  while (queue.length && !round.stop) {
    const agent = queue.shift();
    if (!eligible(agent)) continue;
    const r = await chatTurn(agent, { trigger, canEdit, answered, queue });
    if (r.sub) queue.push(r.sub);
    if (hops < MAX_HOPS) {
      for (const next of r.followups) {
        if (next !== agent && !queue.includes(next) && canRun(next)) { queue.push(next); hops++; }
      }
    }
    round.waiting = [...queue];
  }
}

// One AI's turn in the room. Returns teammates it brought in and any substitute.
async function chatTurn(agent, { trigger = '', canEdit = false, snapshot = null, parallel = false, answered = [], queue = [] } = {}) {
  const out = { followups: [], sub: null };
  round.started.push(agent);
  ui.typingSet.add(agent);
  ui.typing = agent;
  render();
  const startedAt = now();
  const chat = snapshot || state.chat;
  const edit = canEdit && state.chatWs && EDITORS.includes(agent) && method(agent) !== 'api';
  const full = buildPrompt(agent, chat, { ...chatCtx(), chatEdits: Boolean(edit) });
  if (agent === state.lead && state.leadRefusals?.length && settings.leadActions === true) state.leadRefusals = []; // shown in this prompt
  const skey = `${chatId()}:${agent}`;
  const sess = settings.chatResume && method(agent) !== 'api' ? state.chatSessions?.[skey] : null;
  let prompt = full;
  if (sess?.sessionId) {
    const idx = chat.findIndex((m) => m.id === sess.lastMsgId);
    prompt = buildDelta(agent, idx >= 0 ? chat.slice(idx + 1).filter((m) => m.who !== agent) : chat.slice(-10), chatCtx());
  }
  // Images (and video frames) posted by the owner or other AIs since this AI's last turn.
  const media = mediaFor(agent, chat, NAMES);
  if (media.note) prompt += media.note;
  ops.imageNotice(agent, media); // never claim an AI saw an image it didn't get
  const lastOwner = [...chat].reverse().find((m) => m.who === 'owner');
  const runId = uid() + uid();
  round.runs[agent] = runId;
  prompt += habitatPrompt(agent, Boolean(sess?.sessionId));
  const res = await callAgent(agent, prompt, {
    ...(edit ? { mode: 'edit', taskId: chatId() } : { mode: 'read', taskId: state.chatWs ? chatId() : undefined }),
    runId,
    images: media.images,
    resumeId: sess?.sessionId || undefined,
    fallbackPrompt: sess?.sessionId ? full : undefined,
    thread: `chat-${chatId()}-${agent}`,
    title: `Team chat — ${settings.project ? settings.project.split('/').pop() : 'Hearth AI'}`,
    historyText: lastOwner?.text || trigger,
  });
  delete round.runs[agent];
  ui.typingSet.delete(agent);
  ui.typing = [...ui.typingSet][0] || null;
  const late = cameAfterOwner(state.chat, startedAt);
  if (res.ok) {
    answered.push(agent);
    const d = parseDirectives(res.text);
    let m = null;
    ops.turnBegin(agent);
    try { // results always attach, even if something below throws
    for (const e of d.edits) {
      const r = applyEdit(state.chat, { id: e.id, by: agent, text: e.text });
      if (r.ok) audit(`${NAMES[agent]} edited its message #${e.id}`, null, '', agent);
      else post({ who: 'system', text: `${NAMES[agent]} tried to edit #${e.id}: ${r.reason}.` });
      ops.actionResult(agent, `EDIT #${e.id}`, r.ok, r.ok ? 'message updated' : r.reason);
    }
    for (const id of d.retracts) {
      const r = applyRetract(state.chat, { id, by: agent });
      if (r.ok) audit(`${NAMES[agent]} retracted its message #${id}`, null, '', agent);
      else post({ who: 'system', text: `${NAMES[agent]} tried to retract #${id}: ${r.reason}.` });
      ops.actionResult(agent, `RETRACT #${id}`, r.ok, r.ok ? 'message retracted' : r.reason);
    }
    const posted = await agentAttachments(parseAttachLines(d.text), chatId(), agent);
    if (!d.pass && (d.text || d.asks.length || d.handoffs.length || posted.atts.length)) {
      const handoffNote = d.handoffs.map((h) => `→ handing off to ${NAMES[h.to]}${h.note ? `: ${h.note}` : ''}`).join('\n');
      for (const h of d.handoffs) ops.actionResult(agent, `HANDOFF: @${h.to}`, canRun(h.to), canRun(h.to) ? `${NAMES[h.to]} answers next` : `${NAMES[h.to]} can't run right now`);
      for (const p of parseProposals(d.text)) ops.actionResult(agent, `TASK: ${p.title}`, true, 'proposal card added (Add / Add & start)');
      m = post({ who: agent, attachments: posted.atts.length ? posted.atts : undefined, text: [posted.text, handoffNote].filter(Boolean).join('\n\n') || (posted.atts.length ? '' : `${NAMES[agent]} needs your permission:`), model: res.via, proposals: parseProposals(d.text), parallel: parallel || undefined, beforeOwner: late || undefined });
      m.asks = d.asks.map((a) => {
        const req = makeRequest({ id: uid(), agent, kind: a.kind, what: a.what, why: a.why, context: 'chat', msgId: m.id });
        state.permissions.push(req);
        audit('Permission requested', null, `${NAMES[agent]} · ${PERMISSION_KINDS[req.kind]}: ${req.what}`, agent);
        return req.id;
      });
      if (m.asks.length) wakeLead('permission card', agent);
    }
    ops.auditRoutine(agent, d.routine, null);
    await handleVerdicts(agent, d.text);
    handleLeadLines(agent, d.text);
    await ops.handleLines(agent, d.text, null, Boolean(edit)); // IMAGE REQUEST / BACKGROUND (jobs edit only if this turn could)
    } finally { ops.turnEnd(agent, m); }
    if (res.sessionId && settings.chatResume) {
      state.chatSessions = state.chatSessions || {};
      state.chatSessions[skey] = { sessionId: res.sessionId, lastMsgId: (m || state.chat[state.chat.length - 1])?.id, at: now() };
    }
    if (res.resumeReset) post({ who: 'system', text: `${NAMES[agent]}'s saved CLI session couldn't continue, so it started a new one (also saved in its CLI).` });
    habitatLines(agent, d, m);
    if (edit) {
      const cp = await api.checkpoint(chatId(), NAMES[agent], `Team chat: ${(lastOwner?.text || trigger || 'update').slice(0, 80)}`).catch(() => null);
      if (cp) {
        const pushed = await autoPush(chatId());
        ops.checkpointLine(agent, cp, null, ` On ${state.chatWs.branch}${pushed?.ok ? ', pushed to GitHub' : pushed ? `; push failed: ${pushed.message}` : ''}.`);
      }
    }
    // Mentions and handoffs bring teammates in after this reply.
    if (m) out.followups = [...d.handoffs.map((h) => h.to), ...mentions(d.text)];
  } else if (round.stoppedByOwner && ['cancelled', 'error', 'failed'].includes(res.error.kind)) {
    // Stopped by the owner: nothing to report.
  } else if (res.error.kind === 'limit') {
    const sub = parallel ? null : liveAgents().find((x) => ![...answered, ...queue, agent].includes(x)) || null;
    const still = queue.filter(canRun);
    const after = sub ? ` ${NAMES[sub]} is picking up its turn.` : still.length ? ` ${still.map((x) => NAMES[x]).join(' and ')} will carry on.` : ' No other agent is free right now.';
    const moved = moveWaiting(agent, null);
    post({ who: 'system', text: `${NAMES[agent]} is out of usage${res.error.reset ? ` (${res.error.reset})` : ''}.${after}${moved}` });
    out.sub = sub;
  } else if (!res.quiet) {
    // Sign-in and key problems are quiet: the status panel shows the hold instead.
    post({ who: agent, text: `${res.error.kind}: ${res.error.message}`, err: true });
  }
  save();
  render();
  return out;
}

function trimChat() {
  if (state.chat.length > 400) state.chat = state.chat.slice(-400);
}

// Owner answers a permission request. Approve/Deny unblock the AI; Ask why lets it explain.
async function decide(id, decision, by = 'Owner') {
  const r = decideRequest(state.permissions, id, decision);
  if (!r.ok) return toast(r.reason);
  const p = r.request;
  const label = PERMISSION_KINDS[p.kind];
  if (decision === 'why') {
    audit('Owner asked why', p.context === 'chat' ? null : p.context, `R-${p.id} ${label}: ${p.what}`);
    post({ who: 'owner', auto: true, text: `@${AGENTS[p.agent].mention[0]} Why do you need R-${p.id} (${label}: ${p.what})? Explain briefly; don't do it until I approve.` });
    save();
    render();
    return runRoom([p.agent], { allow: [p.agent] });
  }
  audit(decision === 'approved' ? 'Permission approved' : 'Permission denied', p.context === 'chat' ? null : p.context, `R-${p.id} · ${NAMES[p.agent]} · ${label}: ${p.what}${by !== 'Owner' ? ` · by ${by}` : ''}`, by === 'Owner' ? 'owner' : state.lead);
  if (p.context !== 'chat') {
    const t = state.tasks.find((x) => x.id === p.context);
    if (t) {
      t.notes.push({ at: now(), who: by, text: `${decision === 'approved' ? 'APPROVED' : 'DENIED'} permission R-${p.id} (${label}): ${p.what}${decision === 'approved' ? ' — go ahead with exactly that.' : ' — do not do it; find another way or stop.'}` });
      post({ who: 'system', text: `${by === 'Owner' ? 'You' : by} ${decision} R-${p.id} for T-${t.id}.` });
      save();
      render();
      if (decision === 'approved' && canRun(p.agent) && !blocked().includes(p.agent)) return runTask(t, p.agent);
      return;
    }
  }
  post({ who: by === 'Owner' ? 'owner' : 'system', auto: true, text: (by === 'Owner' ? '' : `${by}: `) + (decision === 'approved'
    ? `@${AGENTS[p.agent].mention[0]} Approved R-${p.id} (${label}): ${p.what}. Go ahead with exactly that, then report back.`
    : `@${AGENTS[p.agent].mention[0]} Denied R-${p.id} (${label}): ${p.what}. Don't do it; suggest another way if there is one.`) });
  save();
  render();
  if (!blocked().includes(p.agent)) return runRoom([p.agent], { trigger: 'permission answer' });
}

function addProposal(msgId, i, force = false) {
  const m = state.chat.find((x) => x.id === msgId);
  const p = m?.proposals?.[i];
  if (!p || p.taskId) return null;
  if (!force) {
    const dup = findDuplicate(p, state.tasks);
    if (dup) { p.dupOf = dup.task.id; toast(`That looks like T-${dup.task.id}. Open it, or press Add anyway.`); return null; }
  }
  // Carry the chat that produced it, so whoever works on it has the context.
  const context = state.chat.slice(-8).filter((x) => x.who !== 'system' && !x.deleted).map((x) => `${NAMES[x.who]}: ${x.text}`).join('\n\n').slice(-3000);
  const t = makeTask({ ...p, description: `Proposed by ${NAMES[m.who]} in Team chat.\n\nChat context:\n${context}` }, m.who === 'owner' ? 'Owner' : NAMES[m.who]);
  if (t) p.taskId = t.id;
  return t;
}

function viewBoard() {
  const recentRuns = state.tasks.flatMap((t) => (t.runs || []).filter((r) => r.status !== 'running').map((r) => ({ ...r, task: t }))).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 6);
  const load = AGENT_IDS.map((a) => [a, state.tasks.filter((t) => t.assignee === a && !['approved', 'rejected'].includes(t.stage)).length]).filter(([a, n]) => n || connected(a));
  return `<div class="board mb">${COLUMNS.map((c) => {
    const items = state.tasks.filter((t) => c.stages.includes(t.stage));
    return `<div class="col"><div class="col-h">${esc(c.title)}<span class="n">${items.length}</span></div>
      ${items.map((t) => `<div class="task ${ui.selected === t.id ? 'sel' : ''}" data-open="${t.id}">
        <div class="t">${esc(t.title)}</div>
        <div class="meta">${ops.ciBadge(t)}${actionFor(t) && !actionFor(t).passive ? '<span class="badge warn">Waiting for you</span>' : ''}${t.stage === 'review' && t.reviewWaiting ? `<span class="badge">Waiting for ${esc(NAMES[t.reviewer] || 'a reviewer')}</span>` : ''}${stageBadge(t)}${runBadge(t)}${queueBadge(t)}${agentChip(t.assignee)}${t.pr ? `<span class="badge accent">PR #${esc(t.pr.number || '')}</span>` : ''}${doneBadge(t)}</div>
        ${ownerButton(t)}
      </div>`).join('') || `<div class="empty">${{ Intake: 'New tasks land here after the policy check.', 'In progress': 'Nothing being built.', Verify: 'Nothing waiting for tests or review.', 'Owner approval': 'Nothing waiting for you.', Closed: 'No decisions yet.' }[c.title]}</div>`}
    </div>`;
  }).join('')}</div>
  <div class="grid three">
    <div class="card"><h3>Team load</h3>
      ${load.map(([a, n]) => `<div class="row" style="padding:4px 0">${agentChip(a)}<span style="flex:1"></span><span class="faint" style="font-size:12px">${n} open</span><div class="load"><div style="width:${Math.min(100, n * 25)}%"></div></div></div>`).join('') || '<div class="empty">No AIs linked yet.</div>'}
    </div>
    <div class="card"><h3>Recent runs</h3>
      ${recentRuns.map((r) => `<div class="row" style="padding:4px 0;font-size:12.5px;cursor:pointer" data-open="${r.task.id}">${agentChip(r.agent)}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.task.title)}</span><span class="badge ${['done', 'ok'].includes(r.status) ? 'good' : ['limit', 'outage'].includes(r.status) ? 'warn' : ''}">${esc(r.status)}</span></div>`).join('') || '<div class="empty">No runs yet.</div>'}
    </div>
    <div class="card"><h3>Quick actions</h3>
      <div class="quick"><button class="btn" data-new>＋ New task</button><button class="btn" data-nav="chat">✎ Plan in Team chat</button><button class="btn" data-nav="approvals">✓ Approvals</button><button class="btn" data-nav="github">⑂ Pull requests</button></div>
    </div>
  </div>`;
}

function approveButtons(t) {
  const pr = ui.prs.byTask[t.id];
  if (pr && pr.state === 'OPEN') return `<button class="btn primary small" data-approvepr="${t.id}" ${pr.checks.failed ? 'disabled title="Checks are failing"' : ''}>Approve & merge PR #${pr.number}</button><button class="btn small" data-approve="${t.id}">Approve only</button>`;
  if (t.ws) return `<button class="btn primary small" data-approvemerge="${t.id}">Approve & merge into main</button><button class="btn small" data-approve="${t.id}">Approve only</button>`;
  return `<button class="btn primary small" data-approve="${t.id}">Approve</button>`;
}

function viewApprovals() {
  const waiting = state.tasks.filter((t) => t.stage === 'approval');
  const decided = state.tasks.filter((t) => ['approved', 'rejected'].includes(t.stage));
  const asks = state.permissions.slice().reverse();
  return `${ops.approvalCards()}
    <div class="card mb"><h3>Permission requests from the AIs</h3>
      ${asks.filter((p) => p.status === 'pending').map((p) => `<div style="margin-bottom:6px">${agentChip(p.agent)} ${askCard(p)}</div>`).join('') || '<div class="empty">No AI is waiting for permission.</div>'}
    </div>
    <div class="card mb">
      <h3>Awaiting owner approval</h3>
      ${waiting.filter((t) => t.ws).length >= 2 ? `<div class="row" style="margin-bottom:10px"><button class="btn small" data-releasebranch ${ui.busy.release ? 'disabled' : ''}>${ui.busy.release ? 'Combining…' : `Combine ${waiting.filter((t) => t.ws).length} tasks into a release branch`}</button><span class="faint" style="font-size:12px">Merges them together on a new release/… branch (not main) and lists any conflicts.</span></div>` : ''}
      ${ui.releaseResult ? `<div class="policy ${ui.releaseResult.conflicts?.length || !ui.releaseResult.ok ? 'warn' : 'ok'}" style="margin-bottom:10px">${esc(ui.releaseResult.message)}</div>` : ''}
      ${waiting.map((t) => `<div class="task" style="cursor:default">
        <div class="t">${esc(t.title)}</div>
        <div class="meta" style="margin-bottom:8px">${agentChip(t.assignee)}<span class="faint" style="font-size:12px">reviewed by</span>${agentChip(t.reviewer)}<span class="badge">${esc(ACTIONS[t.action])}</span>${t.pr ? `<a class="badge accent" href="${esc(t.pr.url)}" target="_blank">PR #${esc(t.pr.number)}</a>` : ''}${doneBadge(t)}</div>
        ${t.reviewVerdict?.verdict === 'approve' ? `<div class="policy ok">${esc(NAMES[t.reviewVerdict.by])} approved ${t.reviewVerdict.sha ? `commit <span class="mono">${esc(short(t.reviewVerdict.sha))}</span>` : 'the review'}${t.reviewVerdict.reason ? `: ${esc(t.reviewVerdict.reason)}` : '.'}</div>` : ''}
        ${t.policy.warn.length ? `<div class="policy warn">${t.policy.warn.map(esc).join('<br>')}</div>` : ''}
        <div class="row">${approveButtons(t)}
          <button class="btn small" data-changes="${t.id}">Request changes</button>
          ${t.ws ? `<button class="btn small ghost" data-updatemain="${t.id}" ${ui.busy[t.id] ? 'disabled' : ''} title="Merge the latest main into this task's branch first, so Approve & merge won't stop on a conflict">${ui.busy[t.id] === 'update' ? 'Updating…' : 'Update from main'}</button>` : ''}
          <button class="btn danger small" data-reject="${t.id}">Reject</button>
          <button class="btn ghost small" data-open="${t.id}">Details</button>
        </div></div>`).join('') || '<div class="empty">Nothing to approve.</div>'}
    </div>
    <div class="grid two">
      <div class="card"><h3>Decisions</h3>${decided.map(taskRow).join('') || '<div class="empty">No decisions recorded yet.</div>'}</div>
      <div class="card"><h3>Answered permission requests</h3>${asks.filter((p) => p.status !== 'pending').slice(0, 10).map((p) => `<div class="row" style="font-size:12.5px;padding:3px 0">${agentChip(p.agent)}<span style="flex:1">${esc(PERMISSION_KINDS[p.kind])}: ${esc(p.what)}</span><span class="badge ${p.status === 'approved' ? 'good' : 'bad'}">${esc(p.status)}</span></div>`).join('') || '<div class="empty">None yet.</div>'}</div>
    </div>`;
}

// ---------- Agents ----------
function kindPill(a) {
  const k = AGENTS[a].kind;
  if (k === 'web') return '<span class="kind web" title="Web window only">Web window</span>';
  if (k === 'api') return '<span class="kind api" title="Team member through an official API key">Team · API</span>';
  return '<span class="kind member" title="Full team member">Team member</span>';
}

function signinSteps(a) {
  const c = cli[a] || {};
  const s = ui.signin[a];
  if (method(a) === 'api') {
    const has = prov.keys[a];
    return `<div class="signin-steps"><span class="${has ? 'done' : 'now'}">1 · Get a key on ${esc(AGENTS[a].vendor)}'s site</span><span class="${has ? 'done' : ''}">2 · Paste it here (encrypted)</span><span class="${has ? 'done' : ''}">3 · Linked</span></div>`;
  }
  const installed = Boolean(c.installed);
  const linked = connected(a);
  const waiting = s?.state === 'waiting';
  const fail = s?.state === 'timeout' || s?.state === 'error';
  return `<div class="signin-steps">
    <span class="${installed ? 'done' : installFailed(a) ? 'fail' : 'now'}">1 · ${installed ? 'Installed' : s?.state === 'installing' ? (c.install === 'queued' ? 'Waiting in line to install…' : 'Installing…') : installFailed(a) ? 'Install failed: see the terminal' : 'Install official tool'}</span>
    <span class="${linked ? 'done' : waiting ? 'now' : fail ? 'fail' : ''}">2 · ${waiting ? 'Waiting for sign-in in your browser…' : fail ? 'Sign-in not finished' : 'Sign in on the official page'}</span>
    <span class="${linked ? 'done' : ''}">3 · ${linked ? 'Linked ✓' : 'Linked'}</span></div>`;
}

// Install / Installing… / Installed for every agent with a one-click installer.
const INSTALLABLE = AGENT_IDS.filter((a) => ['cli', 'manual'].includes(AGENTS[a].kind));
const installFailed = (a) => !cli[a]?.installed && (ui.signin[a]?.state === 'error' ? Boolean(ui.signin[a].install) : cli[a]?.install === 'failed' && ui.signin[a]?.state !== 'installing');
const installingBtn = (a) => `<button class="btn small" disabled><span class="dot pulse"></span> ${cli[a]?.install === 'queued' ? 'Queued…' : 'Installing…'}</button>`;

function installAllBar() {
  const missing = INSTALLABLE.filter((a) => !cli[a]?.installed && !state.disabled?.[a]);
  const busy = [...missing, 'ollama'].some((a) => ui.signin[a]?.state === 'installing' && !cli[a]?.installed);
  const ollamaMissing = !cli.ollama?.installed;
  const count = missing.length + (ollamaMissing && ui.installOllama ? 1 : 0);
  const names = missing.map((a) => AGENTS[a].name).join(', ');
  return `<div class="card mb install-all">
    <div class="install-all-main">
      <div class="install-all-text"><b>Install all</b> <span class="muted">· ${missing.length ? `not installed yet: ${esc(names)}` : 'every AI tool is installed'}</span>
        <div class="faint">Runs each official installer one after another in a terminal you can see. Node.js and uv are set up for you in your own folder if needed, so no password is asked.</div></div>
      <button class="btn primary small" data-installall ${!count || busy ? 'disabled' : ''}>${busy ? '<span class="dot pulse"></span> Installing…' : count ? `Install all (${count})` : 'All installed ✓'}</button>
    </div>
    ${ollamaMissing ? `<label class="install-all-opt"><input type="checkbox" data-installollama ${ui.installOllama ? 'checked' : ''}> Also install Local AI (Ollama). It asks for your computer password in the terminal; this app never sees it.</label>` : ''}
  </div>`;
}

function agentActions(a) {
  const c = cli[a] || {};
  const m = method(a);
  const out = [];
  if (AGENTS[a].kind === 'web') return `<button class="btn small primary" data-openweb="${a}">Open</button>`;
  if (a === 'ollama') {
    if (c.installed) return '';
    if (ui.signin.ollama?.state === 'installing') return installingBtn(a);
    return `<button class="btn small" data-install="ollama" title="${esc(OLLAMA_NOTE)}">${installFailed(a) ? 'Try install again' : 'Install'}</button>`;
  }
  if (m === 'api') out.push(prov.keys[a] ? '' : `<button class="btn small primary" data-opensignin="${a}">Get API key</button>`);
  else if (!c.installed && ui.signin[a]?.state === 'installing') out.push(installingBtn(a));
  else if (a === 'freebuff') out.push(c.installed ? `<button class="btn small" data-login="${a}">Open</button>` : `<button class="btn small primary" data-install="${a}" title="Installs FreeBuff for you in a terminal you can see. No password needed.">${installFailed(a) ? 'Try install again' : 'Install'}</button>`);
  else if (ui.signin[a]?.state === 'waiting' && !connected(a)) out.push('<button class="btn small" disabled><span class="dot pulse"></span> Waiting for browser…</button>');
  else if (!c.installed && !state.disabled?.[a]) out.push(`<button class="btn small primary" data-signin="${a}" title="Installs ${esc(AGENTS[a].tool)} for you in a terminal you can see (no password), then opens its own sign-in">${installFailed(a) ? 'Try install again' : 'Install'}</button>`);
  else if (!connected(a) && !state.disabled?.[a]) out.push(`<button class="btn small primary" data-signin="${a}">${ui.signin[a]?.state === 'timeout' ? 'Try again' : 'Sign in'}</button>`);
  return out.join('');
}

function agentDetail(a) {
  const ag = AGENTS[a];
  const c = cli[a] || {};
  const m = method(a);
  const res = consoleOut[a];
  const out = outInfo(a);
  const left = `
    <p><b style="color:var(--strong)">${esc(ACCESS_NOTE[a])}</b></p>
    <div class="billing">${esc(m === 'api' && !API_ONLY.includes(a) ? BILLING.api : BILLING[a])}</div>
    ${ag.kind !== 'local' && ag.kind !== 'web' ? signinSteps(a) : ''}
    ${m === 'api' ? `<div class="row"><input type="password" id="key-${a}" placeholder="${prov.keys[a] ? '•••••••• saved — paste to replace' : `Paste your ${esc(ag.vendor)} API key`}" autocomplete="off" style="flex:1">
        <button class="btn small" data-savekey="${a}">Save</button><button class="btn small" id="testkey-${a}" data-testkey="${a}" ${prov.keys[a] && !keyTests[a]?.busy ? '' : 'disabled'} title="Sends a one-word prompt with the saved key (may use a little API credit)">${keyTests[a]?.busy ? 'Testing…' : 'Test'}</button>${prov.keys[a] ? `<button class="btn danger small" data-rmkey="${a}">Remove</button>` : ''}</div>
        <p style="margin-top:6px">The key is encrypted with your OS keyring and never shown again. Test checks the saved key. ${ag.edits ? 'API-linked AIs can chat, plan and review but not edit files.' : 'Chat, plan, research and review — no file edits.'}</p>
        <div id="keytest-${a}" role="status">${keyTestLine(keyTests[a], esc)}</div>`
    : a === 'ollama' ? `<p>Runs models on your own computer — free, private, offline. ${c.installed ? (c.models?.length ? `Models: ${esc(c.models.join(', '))}` : 'Download a model: <span class="mono">ollama pull llama3.2</span>') : `Install runs ${esc(ag.install)} in a terminal you can see. ${esc(ag.installNote)} Then download a model: <span class="mono">ollama pull llama3.2</span>.`}</p>`
    : `<p>Signs in through ${esc(ag.tool)}’s own official sign-in (it opens ${esc(ag.vendor)}’s page in your browser) with ${esc(ag.plan)}. This app never sees your password; ${esc(ag.tool)} keeps its own login token where it always does.</p>
      ${c.installed ? `<div class="kv" style="margin:4px 0"><span class="k">Program</span><span class="mono" style="font-size:11px;word-break:break-all">${esc(c.path)}</span></div>` : `<p class="faint">Install runs <span class="mono">${esc(ag.install)}</span> in a terminal you can see. ${esc(ag.installNote || '')}${ag.kind === 'cli' ? ' Sign-in starts by itself when it finishes.' : ''}</p>`}
      ${a === 'xai' ? '<p class="faint">Grok’s headless mode has no “safe auto” level: working mode auto-approves its tools; read mode leaves approvals on.</p>' : ''}
      ${a === 'qwen' ? '<p class="faint">Qwen Code needs its Qwen OAuth sign-in cached before it can run from the app; if runs report “not signed in”, open it once in a terminal (Sign in) or give it an API key in ~/.qwen/.env.</p>' : ''}
      ${a === 'freebuff' ? '<p class="faint">FreeBuff has no hands-free mode: from any task, “Continue in FreeBuff” opens it in that task’s workspace with the handoff brief on your clipboard.</p>' : ''}`}
    <div class="row" style="margin-top:8px">
      ${ag.kind === 'cli' && m !== 'api' && c.installed && !connected(a) && ui.signin[a]?.state !== 'waiting' ? `<button class="btn small primary" data-signin="${a}">${ui.signin[a]?.state === 'timeout' ? 'Try again' : 'Sign in'}</button>` : ''}
      ${ag.kind === 'cli' && m !== 'api' && c.signedIn ? `<button class="btn small danger" data-disconnect="${a}">Sign out</button>` : ''}
      ${ag.signin ? `<button class="btn small ghost" data-opensignin="${a}">${m === 'api' ? 'API key page' : 'Account page'} ↗</button>` : ''}
      ${ag.web ? `<button class="btn small ghost" data-openweb="${a}">Open ${esc(ag.name)} web chat</button>` : ''}
      <button class="btn small ghost" data-recheck>Re-check</button>
      ${ag.kind === 'cli' || a === 'freebuff' ? `<button class="btn small ghost" data-locate="${a}">Locate program…</button>` : ''}
      ${out || authHold(a) ? `<button class="btn small" data-available="${a}">Mark available</button>` : ''}
    </div>`;
  const right = ag.headless ? `
      <div class="sect" style="margin-top:0">Quick test</div>
      <textarea id="prompt-${a}" placeholder="Ask ${esc(ag.name)} something…" style="min-height:60px"></textarea>
      <div class="row" style="margin-top:6px"><button class="btn primary small" data-ask="${a}" ${ui.busy[a] || !canRun(a) ? 'disabled' : ''}>${ui.busy[a] ? 'Waiting…' : 'Send'}</button></div>
      ${res ? `<div class="note ${res.ok ? '' : 'err'}" style="margin-top:8px;max-height:200px;overflow:auto">${res.ok ? esc(res.text) : `${esc(res.error.kind)}: ${esc(res.error.message)}`}</div>` : ''}` : '';
  return `<div class="detail"><div>${left}</div><div>${right}</div></div>`;
}

function sidePanel() {
  const a = ui.side;
  const ag = AGENTS[a];
  if (!ag) return '';
  const c = cli[a] || {};
  const m = method(a);
  const modelField = ag.kind === 'web' || a === 'freebuff' ? '' : a === 'ollama'
    ? ops.localModels()
    : `<label>Model <span class="faint">(blank = ${m === 'api' ? esc(prov.defaults[a] || 'default') : 'the tool’s default'})</span></label>
      <input type="text" value="${esc(state.models[a] || '')}" placeholder="${m === 'api' ? esc(prov.defaults[a] || '') : 'default'}" data-model="${a}">`;
  return `<div class="card side-panel">
    <h3>${avatar(a)}<span style="color:var(--strong);text-transform:none;letter-spacing:0;font-size:14px">${esc(ag.name)}</span><span class="grow"></span>${kindPill(a)}</h3>
    <div class="row" style="margin-bottom:6px">${ag.kind === 'web' ? '' : statusBadge(a)}<span style="flex:1"></span>
      ${ag.kind === 'web' ? '' : `<label style="display:flex;gap:6px;align-items:center;margin:0;cursor:pointer"><input type="checkbox" data-toggleagent="${a}" ${state.disabled?.[a] ? '' : 'checked'}> Use on the team</label>`}</div>
    ${ag.kind === 'web' ? `<p class="muted" style="font-size:12.5px;line-height:1.5">${esc(ACCESS_NOTE[a])} The window shows ${esc(ag.vendor)}’s own site with its own sign-in; this app never reads, scrapes or stores anything from it.</p>
      <div class="row"><button class="btn small primary" data-openweb="${a}">Open ${esc(ag.name)}</button></div>
      <div class="sect">Your chats</div><p class="muted" style="font-size:12.5px">${esc(ag.export || 'No official chat export.')}</p>${ag.export ? `<button class="btn small ghost" data-openexport="${a}">Export page ↗</button>` : ''}`
    : `${API_CAPABLE.includes(a) && !API_ONLY.includes(a) ? `<label>Connect with</label><div class="row"><button class="chip ${m === 'cli' ? 'on' : ''}" data-method="${a}:cli">My account (${esc(ag.tool)})</button><button class="chip ${m === 'api' ? 'on' : ''}" data-method="${a}:api">API key</button></div>` : ''}
      <label>Role on the team</label>
      <input type="text" data-role="${a}" value="${esc(state.roles[a] || DEFAULT_ROLES[a])}">
      ${modelField}
      <div class="kv"><span class="k">Can</span><span>${ag.edits && ag.headless && m !== 'api' ? 'chat · plan · review · edit code' : ag.headless ? 'chat · plan · review' : 'edit code (hands-on)'}</span>
        <span class="k">Lead</span><span>${a === state.lead ? 'Yes ★' : EDITORS.includes(a) ? `<button class="btn small link" data-makelead="${a}">Make lead</button>` : '—'}</span>
        ${ag.resume ? `<span class="k">Resume</span><span class="mono" style="font-size:11.5px">${esc(ag.resume)}</span>` : ''}
        ${ag.export ? `<span class="k">Web chats</span><span style="font-size:12px">${esc(ag.export)}</span>` : ''}</div>`}
  </div>`;
}

function viewAgents() {
  const warn = API_CAPABLE.some((a) => method(a) === 'api') && !prov.encryption ? '<div class="policy block">No OS keyring available (GNOME Keyring / KWallet), so API keys can’t be stored securely. Signing in with your account doesn’t need one.</div>' : '';
  const proj = settings.project ? '' : '<div class="policy warn">Pick a shared project folder in Settings so the AIs can work on tasks together.</div>';
  const row = (a) => {
    const ag = AGENTS[a];
    const b = busyOn(a);
    const assigned = state.tasks.filter((t) => t.assignee === a && !['approved', 'rejected'].includes(t.stage)).length;
    const open = ui.expanded === a;
    return `<tr class="click ${open ? 'open' : ''}" data-expand="${a}">
      <td><div class="nm">${avatar(a)}<div><b>${esc(ag.name)}</b>${a === state.lead ? ' <span class="faint">★ lead</span>' : ''}<small>${esc(ag.vendor)} · ${esc(ag.tool)}</small></div></div></td>
      <td>${kindPill(a)}</td>
      <td>${ag.kind === 'web' ? '<span class="faint">you sign in on their site</span>' : statusBadge(a)}</td>
      <td class="muted">${b ? `<a href="#" data-open="${b[0].startsWith('CHAT') ? '' : b[0]}">${b[0].startsWith('CHAT') ? 'team chat' : `T-${esc(b[0])}`}</a>` : ag.kind === 'web' ? '—' : assigned ? `${assigned} assigned` : 'idle'}</td>
      <td class="muted" style="font-size:12px">${ag.kind === 'web' ? 'web window' : method(a) === 'api' ? 'API key' : ag.kind === 'local' ? 'local' : ag.kind === 'manual' ? 'terminal' : 'your account'}</td>
      <td style="text-align:right;white-space:nowrap">${agentActions(a)} <span class="faint">${open ? '▴' : '▾'}</span></td>
    </tr>${open ? `<tr class="detail-row"><td colspan="6">${ag.kind === 'web' ? `<p class="muted" style="margin:0">${esc(ACCESS_NOTE[a])} Use the Open button: it shows ${esc(ag.vendor)}’s own site in a sandboxed window with its own sign-in. ${ag.export ? `Your chats: ${esc(ag.export)}.` : ''}</p>` : agentDetail(a)}</td></tr>` : ''}`;
  };
  return `${warn}${proj}
  <div class="roster-wrap">
    <div>
      ${installAllBar()}
      <div class="card mb" style="padding:4px 6px">
        <table class="roster"><thead><tr><th>AI</th><th>Access</th><th>Status</th><th>Working on</th><th>Signed in with</th><th style="text-align:right"><button class="btn small ghost" data-recheck>Re-check all</button></th></tr></thead>
        <tbody>${AGENT_IDS.map(row).join('')}</tbody></table>
      </div>
      <div class="card" style="padding:4px 6px">
        <table class="roster"><thead><tr><th>Web window only</th><th>Access</th><th></th><th></th><th></th><th></th></tr></thead>
        <tbody>${WEB_ONLY.map(row).join('')}</tbody></table>
      </div>
      <p class="faint" style="font-size:12px;line-height:1.5;margin-top:10px"><b>Team member</b>: official CLI signed in with your own account — chats, plans, reviews and edits code in task workspaces. <b>Team · API</b>: no official CLI exists, so it joins through the provider's official API with a key you create in your account (chat, research, review; no file edits). <b>Web window</b>: only a web chat exists for personal accounts, so the app opens their own site in a sandboxed window — it never reads or scrapes it. Every provider's web chat can be opened from its row.</p>
    </div>
    <div>${sidePanel()}</div>
  </div>`;
}

// ---------- Chat history (bridge) ----------
const SOURCE_LABEL = (s) => (s === 'app' ? 'This app' : s === 'cli' ? 'CLI session' : String(s).startsWith('import') ? `Imported (${String(s).split(':')[1] || 'export'})` : s);
function viewHistory() {
  const h = ui.hist;
  const st = h.stats;
  const providers = [...AGENT_IDS.filter((a) => a !== 'freebuff'), 'other'];
  const sel = h.sel;
  const resumeTool = sel ? AGENTS[sel.provider]?.tool : '';
  return `<div class="hist-wrap">
    <div class="card hist-list">
      <div style="padding:10px 12px;border-bottom:1px solid var(--line)">
        <input type="search" id="hist-q" placeholder="Search every saved conversation…" value="${esc(h.q)}">
        <div class="row" style="margin-top:6px">
          <select data-histfilter="provider" style="width:auto;flex:1"><option value="all">All AIs</option>${providers.map((p) => `<option value="${p}" ${h.provider === p ? 'selected' : ''}>${esc(AGENTS[p]?.name || 'Other')}</option>`).join('')}</select>
          <select data-histfilter="source" style="width:auto;flex:1">${[['all', 'All sources'], ['app', 'This app'], ['cli', 'CLI sessions'], ['import', 'Imported']].map(([v, l]) => `<option value="${v}" ${h.source === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <div class="row" style="margin-top:6px">
          <button class="btn small" data-histscan ${h.scanning ? 'disabled' : ''}>${h.scanning ? 'Syncing…' : '⟳ Sync CLI sessions'}</button>
          <select data-histkind style="width:auto">${[['auto', 'Detect'], ['chatgpt', 'ChatGPT'], ['claude', 'Claude'], ['gemini', 'Gemini (Takeout)'], ['deepseek', 'DeepSeek'], ['generic', 'Other JSON']].map(([v, l]) => `<option value="${v}" ${h.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <button class="btn small primary" data-histimport>Import export…</button>
        </div>
        ${st ? `<div class="faint" style="font-size:11.5px;margin-top:6px">${st.total} conversations saved</div>` : ''}
      </div>
      ${h.list.map((c) => `<div class="hist-item ${sel?.key === c.key ? 'on' : ''}" data-histopen="${esc(c.key)}">
        <div class="row" style="gap:6px">${agentChip(AGENTS[c.provider] ? c.provider : 'none')}<span class="badge ${c.source === 'app' ? 'accent' : c.source === 'cli' ? 'good' : ''}">${esc(SOURCE_LABEL(c.source))}</span><span class="faint" style="font-size:11px;margin-left:auto">${esc(ago(c.updatedAt))}</span></div>
        <div class="t" style="margin-top:4px">${esc(c.title)}</div>
        <div class="s">${esc(c.snippet)}</div>
      </div>`).join('') || `<div class="empty" style="padding:14px">${h.q ? 'No matches.' : 'Nothing saved yet. Sync CLI sessions or import an export.'}</div>`}
    </div>
    <div class="card hist-view">
      ${sel ? `<div class="row">${agentChip(AGENTS[sel.provider] ? sel.provider : 'none')}<span class="badge">${esc(SOURCE_LABEL(sel.source))}</span>${sel.taskId ? `<a href="#" data-open="${esc(sel.taskId)}" class="badge accent">T-${esc(sel.taskId)}</a>` : ''}<span style="flex:1"></span>
          ${sel.resumable ? `<button class="btn small primary" data-histresume="${esc(sel.key)}">Resume in ${esc(resumeTool)}</button>` : ''}
          ${AGENTS[sel.provider]?.web ? `<button class="btn small" data-histweb="${esc(sel.key)}">Open in ${esc(AGENTS[sel.provider].name)} ↗</button><button class="btn small ghost" data-histwebin="${esc(sel.key)}">In app window</button>` : ''}
          <button class="btn small ghost" data-histremove="${esc(sel.key)}" title="Remove from this app's history (doesn't touch the CLI's own files)">Remove</button></div>
        <h2 style="font-size:16px;color:var(--strong);margin:10px 0 2px">${esc(sel.title)}</h2>
        <div class="faint" style="font-size:12px">${sel.messages.length} messages · ${esc(time(sel.startedAt))} → ${esc(time(sel.updatedAt))}${sel.cwd ? ` · <span class="mono">${esc(sel.cwd)}</span>` : ''}${sel.sessionId && sel.source !== 'import' ? ` · session <span class="mono">${esc(String(sel.sessionId).slice(0, 40))}</span>` : ''}</div>
        ${sel.bestEffort ? '<div class="policy warn">Read with the best-effort parser: this CLI doesn’t document its session format, so some turns may be missing.</div>' : ''}
        ${!sel.resumable && String(sel.source).startsWith('import') ? `<div class="policy info">Imported from ${esc(AGENTS[sel.provider]?.name || 'a')} data export. Read-only here — web-app chats can’t be continued from another app; “Open in ${esc(AGENTS[sel.provider]?.name || 'provider')}” takes you to it.</div>` : ''}
        ${sel.messages.map((m) => `<div class="turn"><div class="r">${m.role === 'user' ? 'You' : esc(AGENTS[sel.provider]?.name || 'AI')}${m.at ? ` · ${esc(time(m.at))}` : ''}</div><div class="x">${esc(m.text)}</div></div>`).join('')}`
      : `<h3>How chat history works</h3>
        <div style="font-size:13px;line-height:1.6" class="muted">
          <p><b style="color:var(--strong)">Two-way with the official CLIs.</b> Every conversation this app has with Claude Code, Codex, Gemini CLI, Grok Build, Qwen Code or Mistral Vibe runs as a real session of that CLI, so it is saved here <i>and</i> in the CLI’s own session list — press <b>Resume</b> to continue it in a terminal (<span class="mono">claude --resume</span>, <span class="mono">codex resume</span>, <span class="mono">gemini --resume</span>, <span class="mono">grok --resume</span>…). Sessions you start in those CLIs yourself appear here after <b>Sync CLI sessions</b> (also done at startup). Team chat keeps one session per AI per project.</p>
          <p><b style="color:var(--strong)">Web and desktop chat apps</b> (claude.ai, chatgpt.com, gemini.google.com, grok.com, Le Chat, Perplexity…) have no official API to read or write your chat history, and this app never scrapes them. Instead, download your official data export and import it: ChatGPT and Claude (zip with conversations.json), Gemini (Google Takeout → My Activity → Gemini Apps, JSON), DeepSeek (Settings → Data → Export). Imported chats are searchable here and link back with “Open in …”, but can’t be continued from another app.</p>
          <p><b style="color:var(--strong)">API-key chats</b> (Perplexity, DeepSeek, or any AI switched to an API key) have no CLI session; this app’s history is their copy.</p>
        </div>`}
    </div>
  </div>`;
}

async function refreshHistory() {
  const h = ui.hist;
  h.list = await api.historySearch(h.q, { provider: h.provider, source: h.source }).catch(() => []);
  h.stats = await api.historyStats().catch(() => null);
}

// ---------- GitHub ----------
function prBadge(pr) {
  const cls = { merged: 'accent', closed: '', draft: '', 'checks failing': 'bad', 'changes requested': 'warn', 'checks running': 'warn', approved: 'good', 'review required': 'warn', open: 'good' }[pr.label] || '';
  return `<span class="badge ${cls}">${esc(pr.label)}</span>`;
}
function prCard(pr, t = null) {
  return `<div class="pr">
    <div class="h"><b>#${pr.number}</b><span style="flex:1;color:var(--strong)">${esc(pr.title)}</span>${prBadge(pr)}</div>
    <div class="faint" style="font-size:12px;margin-top:3px"><span class="mono">${esc(pr.head)}</span> → <span class="mono">${esc(pr.base)}</span> · ${esc(ago(pr.updatedAt))}</div>
    <div class="checks"><span style="color:var(--good)">✓ ${pr.checks.passed} passed</span><span style="color:var(--bad)">✕ ${pr.checks.failed} failed</span><span style="color:var(--warn)">● ${pr.checks.pending} running</span><span class="muted">Reviews: ${pr.reviews.length ? pr.reviews.map((r) => `${esc(r.who)} ${esc(r.state.toLowerCase().replace('_', ' '))}`).join(', ') : 'none yet'}</span></div>
    ${pr.checks.items.length ? `<ul class="check-list">${pr.checks.items.slice(0, 8).map((c) => `<li><span class="dot" style="color:${c.state === 'passed' ? 'var(--good)' : c.state === 'failed' ? 'var(--bad)' : 'var(--warn)'}"></span>${esc(c.name)}</li>`).join('')}</ul>` : ''}
    <div class="row" style="margin-top:6px"><a class="btn small ghost" href="${esc(pr.url)}" target="_blank">Open on GitHub ↗</a>${t ? `<button class="btn small ghost" data-prrefresh="${t.id}">Refresh</button>` : ''}</div>
  </div>`;
}

function viewGithub() {
  const tool = (ok, name, how) => `<div class="setup-step ${ok ? 'ok' : ''}"><span class="tick">${ok ? '✓' : ''}</span><span style="flex:1">${name}</span>${ok ? '' : how}</div>`;
  const st = repo;
  const rel = ui.release;
  const relOk = /^\d{1,4}\.\d{1,4}(\.\d{1,4})?$/.test(rel.version) && rel.version === rel.confirm;
  return `<div class="grid two mb">
    <div class="card"><h3>Connection</h3>
      ${tool(Boolean(gh.git), '<b>git</b>', '<span class="faint mono" style="font-size:12px">sudo apt install git</span>')}
      ${tool(Boolean(gh.gh), '<b>GitHub CLI</b> <span class="muted">· official GitHub tool used for sign-in and pull requests</span>', '<span class="faint mono" style="font-size:12px">sudo apt install gh</span>')}
      ${tool(Boolean(gh.ghUser), `<b>GitHub account</b> ${gh.ghUser ? `<span class="muted">· ${esc(gh.ghUser)}</span>` : ''}`, gh.gh ? '<button class="btn small primary" data-ghlogin>Connect GitHub</button>' : '')}
      <p class="muted" style="font-size:12.5px;line-height:1.5;margin:8px 0">Connect GitHub opens GitHub's own sign-in in your browser (<span class="mono">gh auth login --web</span>). git and gh then use that same sign-in — this app never sees your password or token.</p>
      <div class="row"><button class="btn small ghost" data-gitrefresh>Re-check</button></div>
    </div>
    <div class="card"><h3>Projects</h3>
      ${settings.projects.map((p) => `<div class="row" style="margin:3px 0;font-size:12.5px"><span class="mono" style="flex:1;word-break:break-all">${esc(p)}</span>${p === settings.project ? '<span class="badge accent">Active</span>' : `<button class="btn small ghost" data-useproject="${esc(p)}">Use</button>`}</div>`).join('') || '<div class="empty">No projects yet.</div>'}
      <div class="row" style="margin-top:8px"><button class="btn small" data-pickproject>Open folder…</button></div>
      <label>Clone from GitHub</label>
      <div class="row"><input type="text" id="clone-input" placeholder="owner/repo or https://github.com/owner/repo" style="flex:1"><button class="btn small primary" data-clone ${gh.git ? '' : 'disabled'}>Clone</button></div>
    </div>
  </div>
  <div class="card mb">
    <h3>Pull requests<span class="grow"></span><button class="btn small ghost" data-prlist>Refresh</button></h3>
    ${ui.prs.list.length ? `<table><thead><tr><th>#</th><th>Title</th><th>Status</th><th>Checks</th><th>Reviews</th><th>Branch</th><th></th></tr></thead><tbody>
      ${ui.prs.list.map((p) => { const t = state.tasks.find((x) => x.pr?.number === p.number); return `<tr><td class="mono">#${p.number}</td><td>${esc(p.title)}${t ? ` <a href="#" data-open="${t.id}" class="faint">T-${esc(t.id)}</a>` : ''}</td><td>${prBadge(p)}</td>
        <td style="white-space:nowrap"><span style="color:var(--good)">✓${p.checks.passed}</span> <span style="color:var(--bad)">✕${p.checks.failed}</span> <span style="color:var(--warn)">●${p.checks.pending}</span></td>
        <td class="muted" style="font-size:12px">${p.reviews.map((r) => `${esc(r.who)}: ${esc(r.state.toLowerCase().replace('_', ' '))}`).join('<br>') || '—'}</td>
        <td class="mono" style="font-size:11.5px">${esc(p.head)}</td><td><a href="${esc(p.url)}" target="_blank">Open ↗</a></td></tr>`; }).join('')}</tbody></table>`
      : `<div class="empty">${esc(ui.prs.msg || 'No pull requests yet. Open one from a task (“Open pull request”).')}</div>`}
    <p class="faint" style="font-size:12px;margin:8px 0 0">Merging a pull request only happens when you press <b>Approve & merge PR</b> on a task in Owner approval (then a confirmation). main stays locked otherwise. Uses <span class="mono">gh pr merge --merge</span> with your own GitHub login; never bypasses branch protection.</p>
  </div>
  <div class="grid two">
    <div class="card">
      <h3>Active project<span class="grow"></span><button class="btn small" data-gitpull ${st.repo && st.remote ? '' : 'disabled'}>Pull latest</button><button class="btn small ghost" data-gitrefresh>Refresh</button></h3>
      ${st.repo ? `<div class="kv">
        <span class="k">Folder</span><span class="mono" style="word-break:break-all">${esc(settings.project)}</span>
        <span class="k">GitHub</span><span class="mono">${esc(st.remote || 'not connected to a GitHub repo')}</span>
        <span class="k">Checked out</span><span class="mono">${esc(st.branch)}${st.ahead ? ` · ${st.ahead} to push` : ''}${st.behind ? ` · ${st.behind} to pull` : ''}${st.dirty ? ` · ${st.dirty} uncommitted` : ''}</span>
        <span class="k">Main branch</span><span class="mono">${esc(st.defaultBranch)} <span class="faint">(locked — changes only when you approve)</span></span>
      </div>
      <table><thead><tr><th>Branch</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>
        ${st.branches.map((b) => `<tr><td class="mono">${esc(b.name)}${b.protected ? ' <span class="badge">locked</span>' : ''}</td><td class="muted">${esc(b.track || (b.protected ? '' : 'not on GitHub yet'))}</td><td class="muted">${esc(b.when)}</td><td>${b.protected || !st.remote ? '' : `<button class="btn small ghost" data-pushbranch="${esc(b.name)}">Push</button>`}</td></tr>`).join('')}
      </tbody></table>` : `<div class="empty">${settings.project ? 'The active project is not a git repository.' : 'Open a folder or clone a repo to get started.'}</div>`}
    </div>
    <div class="card">
      <h3>Release (separate approval)</h3>
      <p class="muted" style="font-size:12.5px;line-height:1.5;margin:0 0 6px">Only you pick version numbers. Type the exact version (MAJOR.MINOR, e.g. 1.1) twice, then press Approve. Nothing is pre-filled and no AI can start this.</p>
      <div class="two-in">
        <div><label>Version (typed by you)</label><input type="text" id="rel-version" value="${esc(rel.version)}" placeholder="e.g. 1.1" autocomplete="off"></div>
        <div><label>Type it again</label><input type="text" id="rel-confirm" value="${esc(rel.confirm)}" autocomplete="off"></div>
      </div>
      <label>From branch</label><input type="text" id="rel-target" value="${esc(rel.target || st.defaultBranch || 'main')}">
      <label>Release notes</label><textarea id="rel-notes" style="min-height:60px">${esc(rel.notes)}</textarea>
      <label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" id="rel-draft" ${rel.draft ? 'checked' : ''}> Create as a draft (publish later on GitHub)</label>
      <div class="row" style="margin-top:8px"><button class="btn primary" data-release ${relOk && gh.ghUser && st.remote ? '' : 'disabled'}>Approve release ${relOk ? `v${esc(rel.version)}` : ''}</button>${rel.version && !relOk ? '<span class="faint" style="font-size:12px">Both fields must match (MAJOR.MINOR).</span>' : ''}</div>
    </div>
  </div>`;
}

function viewAudit() {
  return `<div class="card">
    <h3>Append-only audit record<span class="grow"></span><button class="btn small" data-export>Export everything</button></h3>
    <table><thead><tr><th>When</th><th>Who</th><th>Task</th><th>Event</th><th>Detail</th></tr></thead><tbody>
    ${state.audit.map((a) => `<tr><td class="mono">${esc(time(a.at))}</td><td>${a.actor === 'owner' ? '<span class="muted">you</span>' : agentChip(a.actor)}</td><td class="mono">${esc(a.taskId || '—')}</td><td>${esc(a.event)}</td><td class="muted">${esc(a.detail)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No records yet.</td></tr>'}
    </tbody></table></div>`;
}

function updateBlock() {
  const s = upd.status || {};
  if (!upd.enabled) return `<p class="muted">${esc(upd.reason || 'Updates unavailable.')}${upd.link?.startsWith('https://github.com/') ? ` <a href="${esc(upd.link)}" target="_blank">Open the release page</a>` : ''}</p>`;
  const msg = {
    idle: 'Not checked yet.',
    checking: 'Checking GitHub Releases…',
    none: s.message || 'You are on the latest version.',
    available: `Version ${s.version} is available.`,
    downloading: `Downloading… ${s.percent || 0}%`,
    ready: s.deb ? `Version ${s.version} downloaded and its checksum checked. Installing asks for your computer password.` : `Version ${s.version} downloaded. Restart when you're ready.`,
    installing: s.message || 'Installing…',
    installed: s.message || 'Installed. Restart to use the new version.',
    error: s.message || 'Update failed.',
  }[s.state] || '';
  return `
    <p class="${s.state === 'error' ? '' : 'muted'}" style="${s.state === 'error' ? 'color:var(--bad)' : ''}">${esc(msg)}</p>
    ${s.state === 'downloading' ? `<div class="progress"><div style="width:${s.percent || 0}%"></div></div>` : ''}
    <div class="row">
      <button class="btn small" data-upd="check" ${['checking', 'downloading'].includes(s.state) ? 'disabled' : ''}>Check for updates</button>
      ${s.state === 'available' ? `<button class="btn primary small" data-upd="download">${upd.install === 'deb' ? 'Download and install' : 'Download update'}</button>` : ''}
      ${s.state === 'ready' ? `<button class="btn primary small" data-upd="install">${s.deb ? 'Install (asks for your password)' : 'Restart & install'}</button>` : ''}
      ${s.state === 'installed' ? '<button class="btn primary small" data-upd="restart">Restart now</button>' : ''}
    </div>`;
}

function viewSettings() {
  const themeChip = (v, l) => `<button class="chip ${settings.theme === v ? 'on' : ''}" data-theme="${v}">${l}</button>`;
  const check = (key, label) => `<label style="display:flex;gap:10px;align-items:center;margin:4px 0;cursor:pointer;color:var(--text)"><input type="checkbox" data-togglesetting="${key}" ${settings[key] ? 'checked' : ''}> ${label}</label>`;
  return `${ops.approvalSettings()}<div class="grid two">
    <div class="card"><h3>Appearance</h3>
      <div class="row">${themeChip('hearth', 'Follow Hearth OS desktop')}${themeChip('dark', 'Dark')}${themeChip('light', 'Light')}${themeChip('system', 'System')}</div>
      ${check('reduceMotion', 'Reduce motion (Habitat characters stay in place instead of walking around)')}
      <p class="muted" style="font-size:12.5px;line-height:1.5;margin:8px 0 0">${hearthTheme.found
        ? `Using the Hearth desktop theme${hearthTheme.tokens.name ? ` “${esc(hearthTheme.tokens.name)}”` : ''} from <span class="mono">${esc(hearthTheme.dir)}</span> — changes there apply here live.`
        : `No Hearth desktop theme found at <span class="mono">${esc(hearthTheme.dir)}</span> (theme.json / theme.css), so the Steam-style Hearth OS 1.0 look is used. On Hearth OS it follows Mantel's theme automatically.`}</p>
    </div>
    <div class="card"><h3>App updates</h3>
      <div class="kv"><span class="k">Installed</span><span class="mono">${esc(info.appVersion)}</span>
      <span class="k">Channel</span><span>GitHub Releases (published releases only)</span></div>
      ${updateBlock()}
    </div>
    <div class="card"><h3>Shared workspace</h3>
      <div class="kv"><span class="k">Project folder</span><span class="mono" style="word-break:break-all">${esc(settings.project || 'Not set')}</span></div>
      <p class="muted" style="font-size:12.5px;line-height:1.5">A git repository all agents share. Each task gets its own branch and working copy; every run is committed as a checkpoint (as you, with no AI attribution) so nothing is lost.</p>
      <div class="row"><button class="btn small primary" data-pickproject>${settings.project ? 'Change folder' : 'Choose folder'}</button></div>
      <div class="sep"></div>
      <label style="display:flex;gap:10px;align-items:center;margin:0;cursor:pointer;color:var(--text)"><input type="checkbox" data-autohandoff ${state.autoHandoff ? 'checked' : ''}> Hand a task to the next free agent when one runs out of usage</label>
    </div>
    <div class="card"><h3>What the AIs may do</h3>
      <label style="display:flex;gap:10px;align-items:flex-start;margin:6px 0;cursor:pointer;font-size:13px;color:var(--text)"><input type="radio" name="access" data-access="standard" ${settings.access !== 'full' ? 'checked' : ''}><span><b>Like their own apps (recommended)</b><br><span class="muted">Edit files, run commands, use git and the web — each with its own built-in safety checks.</span></span></label>
      <label style="display:flex;gap:10px;align-items:flex-start;margin:6px 0;cursor:pointer;font-size:13px;color:var(--text)"><input type="radio" name="access" data-access="full" ${settings.access === 'full' ? 'checked' : ''}><span><b>Full access, no safety checks</b><br><span class="muted">Anything, without asking. Only if you accept that one bad command can break a device.</span></span></label>
      <div class="sep"></div>
      ${check('chatEdits', 'AIs can work (edit, run, use git) right from Team chat')}
      ${check('chatResume', 'Keep one CLI session per AI for Team chat (resumable in each AI’s own CLI)')}
      <label style="display:flex;gap:10px;align-items:center;margin:4px 0;cursor:pointer;color:var(--text)"><input type="checkbox" data-toggleleadgh ${leadGitHubOn() ? 'checked' : ''}> Lead handles GitHub (pull, combine, push branches)</label>
      <p class="faint" style="margin:0 0 6px 26px;font-size:12px">${esc(NAMES[state.lead])} pulls from GitHub, pushes task branches and merges approved tasks onto release/next with your own git/gh sign-in. Main, tags and releases stay yours.${gh.ghUser && repo.remote ? '' : ' Needs GitHub set up first.'} Off until you turn it on.</p>
      ${check('leadActions', `Let the lead AI (${esc(NAMES[state.lead])}) approve, deny, start and add tasks`)}
      <p class="faint" style="margin:0 0 6px 26px;font-size:12px">Off by default. ${esc(NAMES[state.lead])} can't approve its own work; releases, version numbers and tags stay yours. Every action shows in Team chat and the Audit log, with Undo where possible.</p>
      ${check('autoPush', 'Back up every checkpoint to its own branch on GitHub')}
      <p class="faint" style="font-size:12px;margin:6px 0">Whatever the setting, AIs must ask you (a permission card) before pushes, merges, releases, deleting files, boot-critical changes and commands outside the workspace.</p>
      <div class="sep"></div>
      <div class="faint" style="font-size:12px;margin-bottom:6px">Other folders on this computer the AIs may use</div>
      ${settings.extraDirs.map((d) => `<div class="row" style="font-size:12.5px;margin:3px 0"><span class="mono" style="flex:1;word-break:break-all">${esc(d)}</span><button class="btn small ghost" data-removedir="${esc(d)}">Remove</button></div>`).join('') || '<div class="empty" style="padding:4px 0">None yet.</div>'}
      <button class="btn small" data-adddir style="margin-top:6px">Add folder…</button>
    </div>
    <div class="card"><h3>Hearth OS project facts the AIs follow</h3>
      <div class="kv"><span class="k">Line</span><span>Hearth OS ${esc(HEARTH_OS.line)} — ${esc(HEARTH_OS.base)}-only</span>
        <span class="k">Desktop</span><span>${esc(HEARTH_OS.desktop)}</span>
        <span class="k">Game Mode</span><span>${esc(HEARTH_OS.gameMode)}</span>
        <span class="k">Plugins</span><span>${esc(HEARTH_OS.plugins)}</span>
        <span class="k">Versions</span><span>${esc(HEARTH_OS.versioning)}</span>
        <span class="k">This computer</span><span>${info.hearthOs ? `${esc(info.hearthOs.name)}${info.hearthOs.version ? ` ${esc(info.hearthOs.version)}` : ''}` : '<span class="faint">not running Hearth OS</span>'}</span></div>
      <div class="sect">Red-flag rules</div>
      ${RED_FLAGS.map((r) => `<div class="policy warn" style="margin:4px 0">${esc(r)}</div>`).join('')}
      <p class="faint" style="font-size:12px;margin:8px 0 0">${esc(HEARTH_OS.scope)}</p>
    </div>
    <div class="card"><h3>Saved work & backups</h3>
      <p class="muted" style="font-size:12.5px;line-height:1.5">Everything is saved automatically and atomically, with the last ${backups.backups.length || 10} versions kept. Chat history is saved separately.</p>
      ${backups.recoveredFrom ? `<div class="policy warn">The latest save was damaged, so it was set aside and your work was restored from ${esc(backups.recoveredFrom)}.</div>` : ''}
      ${backups.backups.slice(0, 6).map((b) => `<div class="row" style="font-size:12.5px;margin:3px 0"><span class="mono faint" style="width:20px">${b.n}</span><span style="flex:1">${b.ok ? `${esc(time(b.savedAt))} · ${b.tasks} task${b.tasks === 1 ? '' : 's'}` : '<span style="color:var(--bad)">unreadable</span>'}</span>${b.ok ? `<button class="btn small ghost" data-restore="${b.n}">Restore</button>` : ''}</div>`).join('') || '<div class="empty">No earlier versions yet.</div>'}
      <div class="row" style="margin-top:8px"><button class="btn small" data-export>Export everything</button></div>
    </div>
    <div class="card"><h3>Local data</h3>
      <div class="kv"><span class="k">Folder</span><span class="mono" style="word-break:break-all">${esc(info.dataPath)}</span>
      <span class="k">Electron</span><span class="mono">${esc(info.electron)}</span></div>
      <button class="btn danger small" data-reset>Clear tasks & audit log</button>
    </div>
    <div class="card"><h3>About this build</h3>
      <p class="muted" style="line-height:1.55;font-size:12.5px;margin:0">A standalone personal tool for working on the Hearth OS project (not part of Hearth OS). Claude, ChatGPT, Gemini, Grok, Mistral and Qwen signed in with your own accounts through their official CLIs; Perplexity and DeepSeek through official API keys; Copilot and Meta AI as sandboxed windows of their own sites. Shared git workspace with checkpoints, out-of-usage handoff, team chat with edits, handoffs and permission requests, two-way chat history with the CLIs and official-export import, pull-request tracking, owner-approved merges and releases, audit log, in-app updates.</p>
    </div>
  </div>`;
}

function workControls(t) {
  const running = ui.running[t.id];
  if (running) {
    return `<div class="policy info" style="display:flex;align-items:center;gap:10px">${agentChip(running.agent)} is working in the shared workspace…<span style="flex:1"></span><button class="btn small danger" data-stop="${t.id}">Stop</button></div>`;
  }
  const others = EDITORS.filter((a) => a !== t.assignee && connected(a));
  const ws = t.ws ? `<div class="kv"><span class="k">Workspace</span><span><span class="mono" style="font-size:11.5px">${esc(t.ws.branch)}</span> <button class="btn small link" data-openws="${t.id}">Open folder</button></span></div>` : '';
  return `${ws}<div class="row" style="margin:8px 0">
      ${EDITORS.includes(t.assignee) ? (() => { const b = busyOn(t.assignee); const busy = Boolean((b && b[0] !== t.id) || isTyping(t.assignee)); return `<button class="btn primary small" data-run="${t.id}:${t.assignee}" ${canRun(t.assignee) ? '' : 'disabled'}${busy ? ` title="${esc(AGENTS[t.assignee].name)} is busy: this starts T-${esc(t.id)} as soon as they finish"` : ''}>${esc(startLabel(t, busy, AGENTS[t.assignee].name))}</button>`; })() : ''}
      ${others.map((a) => `<button class="btn small" data-run="${t.id}:${a}" ${canRun(a) ? '' : 'disabled'}>Hand off to ${esc(AGENTS[a].name)}</button>`).join('')}
      <button class="btn small" data-freebuff="${t.id}">Continue in FreeBuff</button>
      ${t.freebuffOpen ? `<button class="btn small primary" data-fbdone="${t.id}">FreeBuff finished — checkpoint</button>` : ''}
    </div>
    <div class="row">
      ${t.ws && gh.ghUser && repo.remote && !t.pr ? `<button class="btn small ghost" data-openpr="${t.id}">Open pull request</button>` : ''}
      ${t.ws ? `<button class="btn small ghost" data-updatemain="${t.id}" ${ui.busy[t.id] || ui.running[t.id] ? 'disabled' : ''}>${ui.busy[t.id] === 'update' ? 'Updating…' : 'Update from main'}</button>` : ''}
      ${t.ws ? `<button class="btn small ghost" data-showchanges="${t.id}">${ui.changes[t.id] ? 'Refresh changes' : 'Show changes'}</button>` : ''}
      ${HEADLESS.includes(t.reviewer) ? `<button class="btn small ghost" data-opinion="${t.id}" ${canRun(t.reviewer) && !ui.busy[t.id] ? '' : 'disabled'}>${ui.busy[t.id] === 'opinion' ? 'Reviewing…' : `Independent review by ${esc(AGENTS[t.reviewer].name)}`}</button>` : ''}
      ${!settings.project ? '<span class="faint" style="font-size:12px">Set a project folder in Settings to start work.</span>' : ''}
    </div>`;
}

function drawer() {
  const t = state.tasks.find((x) => x.id === ui.selected);
  if (!t) return '';
  const next = NEXT[t.stage];
  const closed = ['approved', 'rejected'].includes(t.stage);
  const pol = !t.policy.ok
    ? `<div class="policy block">${t.policy.block.map(esc).join('<br>')}</div>`
    : t.policy.warn.length ? `<div class="policy warn">${t.policy.warn.map(esc).join('<br>')}</div>` : '<div class="policy ok">Policy & scope check passed.</div>';
  const pr = ui.prs.byTask[t.id];
  const asks = state.permissions.filter((p) => p.context === t.id && p.status === 'pending');
  return `<div class="drawer">
    <div class="row"><span class="mono faint">T-${esc(t.id)}</span><span style="flex:1"></span><button class="btn ghost small" data-close>Close ✕</button></div>
    <h2>${esc(t.title)}</h2>
    <div class="row">${stageBadge(t)}${runBadge(t)}${queueBadge(t)}${doneBadge(t)}<span class="badge">${esc(ACTIONS[t.action])}</span></div>
    ${pol}
    ${ops.drawerPanel(t)}
    ${asks.map(askCard).join('')}
    ${['resume', 'start', 'signin'].includes(actionFor(t)?.kind) ? ownerButton(t) : ''}
    <div class="kv">
      <span class="k">Stage</span><span>${esc(STAGES[t.stage])}</span>
      <span class="k">Implementer</span><span>${agentChip(t.assignee)}</span>
      <span class="k">Reviewer</span><span>${t.stage === 'review' && t.reviewWaiting ? `<select id="pickrev-${t.id}">${HEADLESS.filter((a) => a !== t.assignee).map((a) => `<option value="${a}" ${a === t.reviewer ? 'selected' : ''}>${esc(AGENTS[a].name)}${canRun(a) ? '' : ' (not available)'}</option>`).join('')}</select> <button class="btn small primary" data-sendreview="${t.id}">Send for review</button>` : agentChip(t.reviewer)}</span>
      <span class="k">Created</span><span>${esc(time(t.createdAt))}</span>
    </div>
    ${t.description ? `<div class="note">${esc(t.description)}</div>` : ''}
    ${t.pr ? `<div class="sect">Pull request</div>${pr ? prCard(pr, t) : `<div class="pr"><a href="${esc(t.pr.url)}" target="_blank">PR #${esc(t.pr.number || '')} ↗</a> <button class="btn small ghost" data-prrefresh="${t.id}">Load status</button></div>`}` : ''}
    ${!closed && t.policy.ok ? `<div class="row" style="margin:10px 0">
      ${next && !(t.stage === 'intake' && EDITORS.includes(t.assignee)) ? `<button class="btn primary small" data-advance="${t.id}">${esc(next[1])}</button>` : ''}
      ${t.stage === 'approval' ? `${approveButtons(t)}<button class="btn small" data-changes="${t.id}">Request changes</button><button class="btn danger small" data-reject="${t.id}">Reject</button>` : ''}
    </div>` : ''}
    ${t.policy.ok && !closed ? workControls(t) : ''}
    ${ui.changes[t.id] ? `<div class="note mono" style="font-size:11.5px;white-space:pre-wrap">${esc(ui.changes[t.id])}</div>` : ''}
    ${t.runs?.length ? `<div class="sect">Shared progress</div>
      ${t.runs.slice().reverse().map((r) => `<div class="note ${['limit', 'failed', 'error', 'timeout', 'not_installed', 'auth', 'no_workspace'].includes(r.status) ? 'err' : ''}"><div class="who">${esc(NAMES[r.agent])} · ${esc(r.status)}${r.via ? ` · ${esc(r.via)}` : ''} · ${esc(time(r.at))}${r.checkpoint ? ` · checkpoint <span class="mono">${esc(r.checkpoint)}</span>` : ''}${r.pushed ? ` · ${esc(r.pushed)}` : ''}${r.sessionId ? ` · session <span class="mono">${esc(String(r.sessionId).slice(0, 13))}</span>` : ''}</div>${esc(r.output ? (r.output.length > 1500 ? `${r.output.slice(0, 1500)}…` : r.output) : r.status === 'running' ? 'Working…' : '')}</div>`).join('')}` : ''}
    <div class="sect">Notes</div>
    ${t.notes.map((n) => `<div class="note ${n.err ? 'err' : ''}"><div class="who">${esc(n.who)} · ${esc(time(n.at))}</div>${esc(n.text)}</div>`).join('') || '<div class="empty">No notes yet.</div>'}
    <textarea id="note-text" placeholder="Add a note…" style="min-height:56px"></textarea>
    <div class="row" style="margin-top:6px"><button class="btn small" data-note="${t.id}">Add note</button>
      ${!closed ? `<span style="flex:1"></span><button class="btn danger small" data-delete="${t.id}">Delete task</button>` : ''}</div>
  </div>`;
}

function lightbox() {
  if (!ui.lightbox) return '';
  return `<div class="modal-bg lightbox" data-closelightbox><img src="${esc(ui.lightbox.url)}" alt="${esc(ui.lightbox.name)}"></div>`;
}

function modal() {
  if (ui.lightbox) return lightbox();
  if (ui.modal !== 'new') return '';
  const opt = (sel, ids) => ids.map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(AGENTS[k].name)}${k !== 'none' && !connected(k) ? ' (not linked)' : ''}</option>`).join('');
  const sug = ops.suggestHint(); // assign by strength and headroom (the owner can change both)
  const firstEditor = sug.builder || liveEditors()[0] || state.lead;
  const firstReviewer = sug.reviewer && sug.reviewer !== firstEditor ? sug.reviewer : pickReviewer(firstEditor, { candidates: [...liveAgents(), ...HEADLESS.filter((a) => !liveAgents().includes(a))], lead: state.lead });
  return `<div class="modal-bg" data-modalbg><div class="modal">
    <h2>New task</h2><div class="muted" style="font-size:12.5px">Runs a policy & scope check when created. If it needs a version number, write the exact one — only you pick versions.</div>
    <label>Title</label><input type="text" id="f-title" placeholder="e.g. Add Settings › Storage page to Mantel">
    <label>Description</label><textarea id="f-desc" placeholder="What should be done, constraints, acceptance criteria"></textarea>
    <div class="two-in">
      <div><label>Implementer</label><select id="f-assignee">${opt(firstEditor, [...EDITORS, 'freebuff', 'none'])}</select></div>
      <div><label>Independent reviewer</label><select id="f-reviewer">${opt(firstReviewer, [...HEADLESS, 'none'])}</select></div>
    </div>
    ${sug.html}
    <label>Action type</label><select id="f-action">${Object.entries(ACTIONS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
    <div id="f-dup"></div>
    <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn ghost" data-cancel>Cancel</button><button class="btn primary" data-create>Create task</button></div>
  </div></div>`;
}

const NAV = [
  ['overview', '◈', 'Overview'],
  ['habitat', '⌂', 'Habitat'],
  ['chat', '✎', 'Team chat'],
  ['board', '▦', 'Task board'],
  ['approvals', '✓', 'Approvals'],
  ['agents', '✦', 'Agents'],
  ['history', '⌕', 'Chat history'],
  ['github', '⑂', 'GitHub'],
  ['audit', '☰', 'Audit log'],
  ...ops.nav,
  ['settings', '⚙', 'Settings'],
];
const TITLES = {
  overview: ['Command Center', 'Your AI team, working on the Hearth OS project under your approval'],
  habitat: ['Habitat', 'Each AI has its own room; when they work, they sit at their desk in the shared workroom'],
  chat: ['Team chat', 'You and the whole AI team in one room — everyone sees everything'],
  board: ['Task board', 'Owner → policy → agent → checkpoint → tests → review → approval'],
  approvals: ['Approvals', 'Nothing high-impact happens without your explicit sign-off'],
  agents: ['Agents', 'Sign in on each provider’s own page, see who is available and what they are doing'],
  history: ['Chat history', 'Every conversation, saved and searchable — and resumable in each AI’s own CLI'],
  audit: ['Audit log', 'Every decision, recorded'],
  github: ['GitHub', 'Pull requests, pushes and releases — main only changes when you approve'],
  settings: ['Settings', 'Appearance, permissions, Hearth OS facts, updates and data'],
  ...ops.titles,
};

function render() {
  const waiting = state.tasks.filter((t) => t.stage === 'approval').length + pendingAsks().length;
  const views = { habitat: viewHabitat, github: viewGithub, chat: viewChat, overview: viewOverview, board: viewBoard, approvals: viewApprovals, agents: viewAgents, history: viewHistory, audit: viewAudit, settings: viewSettings, ...ops.views };
  const [title, sub] = TITLES[ui.view];
  const updBadge = upd.status?.state === 'available' || upd.status?.state === 'ready' ? '<span class="badge accent" data-nav="settings" style="cursor:pointer">Update available</span>' : '';
  const scroll = document.querySelector('.main')?.scrollTop || 0;
  document.getElementById('app').innerHTML = `
  <div class="shell">
    <aside class="side">
      <div class="brand"><img src="./icon.png" alt=""><div><b>Hearth AI</b><span>Command Center</span></div></div>
      ${ops.projectSwitcher()}
      ${NAV.map(([id, ico, label]) => `<button class="nav ${ui.view === id ? 'on' : ''}" data-nav="${id}"><span class="ico">${ico}</span>${label}${id === 'approvals' && waiting ? `<span class="count warn">${waiting}</span>` : ''}${id === 'chat' && typingNow() ? '<span class="count">…</span>' : ''}</button>`).join('')}
      <div class="spacer"></div>
      <div class="pin">Working on <b>Hearth OS ${esc(HEARTH_OS.line)}</b><br>Debian · Mantel · Steam Game Mode<br><span class="faint">App v${esc(info.appVersion)} · standalone</span></div>
    </aside>
    <main class="main">
      <div class="top"><div><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div><div class="grow"></div>
        ${updBadge}<span class="badge warn">Beta</span>
        <button class="btn primary" data-new>＋ New task</button></div>
      ${ops.banner()}${views[ui.view]()}
    </main>
  </div>${drawer()}${modal()}${ops.overlay()}`;
  const main = document.querySelector('.main');
  if (main && ui.keepScroll) main.scrollTop = scroll;
  ui.keepScroll = false;
  const log = document.getElementById('chat-log');
  if (log) log.scrollTop = log.scrollHeight;
  const box = document.getElementById('chat-text');
  if (box && !ui.modal && !ui.selected && !ui.editing) {
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }
  document.getElementById('edit-text')?.focus();
  if (ui.view === 'habitat') mountHabitat(document.getElementById('habitat'), habitatHooks);
  else stopHabitat();
}

// ---------- actions ----------
function setStage(t, stage, event, detail) {
  t.stage = stage;
  t.updatedAt = now();
  audit(event, t.id, detail);
  save();
  render();
}

function makeTask({ title, description = '', assignee, reviewer, action }, source = 'Owner') {
  const t = {
    id: uid(),
    title: String(title).trim().slice(0, 200),
    description: String(description).trim().slice(0, 5000),
    assignee: AGENTS[assignee] && AGENT_IDS.includes(assignee) ? assignee : 'none',
    reviewer: AGENTS[reviewer] && AGENT_IDS.includes(reviewer) ? reviewer : 'none',
    action: ACTIONS[action] ? action : 'code',
    stage: 'intake',
    notes: [],
    createdAt: now(),
    updatedAt: now(),
  };
  t.policy = policyCheck(t, { source });
  if (!t.policy.ok && t.policy.block.some((b) => b.startsWith('Looks like it contains'))) {
    toast('That task text contains something that looks like a secret. Remove it first.');
    return null;
  }
  state.tasks.unshift(t);
  audit('Task created', t.id, source === 'Owner' ? t.title : `${t.title} (proposed by ${source} in Team chat)`);
  audit(t.policy.ok ? 'Policy check passed' : 'Policy check blocked', t.id, [...t.policy.block, ...t.policy.warn].join(' '));
  if (t.policy.ok) wakeLead('task waiting to start', source === NAMES[state.lead] ? state.lead : null);
  return t;
}

function dupWarning(t, addBtn) {
  return `<div class="policy warn" style="margin-top:10px">This looks like T-${esc(t.id)} “${esc(t.title)}” (${esc(STAGES[t.stage] || t.stage)}). <div class="row" style="margin-top:6px"><button class="btn small primary" data-opendup="${esc(t.id)}">Open T-${esc(t.id)}</button>${addBtn}</div></div>`;
}

function createTask(force = false) {
  const v = (id) => document.getElementById(id).value;
  const title = v('f-title').trim();
  if (!title) return toast('Give the task a title.');
  // Looks like an open task? Say so (without redrawing the form) and offer it.
  const dup = force ? null : findDuplicate({ title, description: v('f-desc') }, state.tasks);
  if (dup) {
    const box = document.getElementById('f-dup');
    if (box) box.innerHTML = dupWarning(dup.task, '<button class="btn small" data-adddup="form">Add anyway</button>');
    return;
  }
  const t = makeTask({ title, description: v('f-desc'), assignee: v('f-assignee'), reviewer: v('f-reviewer'), action: v('f-action') });
  if (!t) return;
  ui.modal = null;
  ui.selected = t.id;
  save();
  render();
}

async function askForTask(t, kind) {
  const who = t.reviewer;
  delete t.reviewWaiting;
  let summary = '';
  if (t.ws) summary = await api.workspaceSummary(t.id, t.ws.baseSha).catch(() => '');
  const prompt = `You are an independent reviewer (${NAMES[who]}) in the Hearth AI Command Center. Look at the task's workspace (your current directory) and the shared progress below. List concerns, missing tests, and whether the owner should approve. Be concise. Do not modify files. End with exactly one line: "APPROVE: T-${t.id}" if it is ready for the owner, or "CHANGES: T-${t.id} <what must be fixed>" to send it back.\n\n${buildTaskBrief({ task: t, agent: who, summary })}`;
  ui.busy[t.id] = kind;
  render();
  const res = await callAgent(who, prompt, { mode: 'read', taskId: t.ws ? t.id : undefined, title: `Review: ${t.title}`, thread: `review-${t.id}`, historyText: `Independent review of T-${t.id}: ${t.title}` });
  delete ui.busy[t.id];
  const name = AGENTS[who].name;
  t.notes.push(res.ok ? { at: now(), who: `${name} (review)`, text: res.text } : { at: now(), who: name, text: `${res.error.kind}: ${res.error.message}`, err: true });
  audit(res.ok ? `${name} reviewed` : `${name} review failed`, t.id, '', who);
  save();
  render();
  if (res.ok) await handleVerdicts(who, res.text);
}

// Run (or continue) a task with an agent in the shared workspace. Progress is
// checkpointed after every run; if the agent runs out of usage the next free
// agent picks up from the checkpoint automatically.
async function runTask(t, agent, handoff = null, depth = 0) {
  if (!t || ui.running[t.id] || !canRun(agent)) return;
  const other = busyOn(agent);
  if (other && other[0] !== t.id) return startOrQueue(t, agent);
  delete t.startNext;
  const waitingOn = pendingAsks().find((p) => p.agent === agent);
  if (waitingOn) return toast(`${NAMES[agent]} is waiting for your answer on R-${waitingOn.id} first.`);
  try {
    t.ws = t.ws || (await api.ensureWorkspace(t.id, t.title));
  } catch (e) {
    return toast(cleanErr(e.message));
  }
  assignTask(t, agent, handoff ? `${NAMES[handoff.from]}: ${handoff.reason}` : undefined);
  if (t.stage === 'intake') { t.stage = 'implementing'; audit('Work started', t.id, NAMES[agent]); }
  const summary = await api.workspaceSummary(t.id, t.ws.baseSha).catch(() => '');
  const prompt = buildTaskBrief({ task: t, agent, summary, handoffFrom: handoff?.from, reason: handoff?.reason });
  const runId = uid() + uid();
  // Checkpoint BEFORE the call: commit anything already in the workspace and
  // persist the task (with the exact brief) so a crash mid-call loses nothing saved.
  ui.saving[t.id] = true;
  render();
  try { await api.checkpoint(t.id, 'owner', `Snapshot before next run: ${t.title}`); } catch {}
  if (t.changesSince && !t.changesSince.sha) reviewBaseline(t, await api.workspaceHead(t.id).catch(() => null));
  const run = { id: runId, agent, at: now(), status: 'running', brief: prompt.slice(0, 20000) };
  t.runs = t.runs || [];
  t.runs.push(run);
  await save();
  delete ui.saving[t.id];
  ui.running[t.id] = { agent, runId };
  render();

  const res = await callAgent(agent, prompt, { mode: 'edit', taskId: t.id, runId, title: `T-${t.id}: ${t.title}`, thread: `task-${t.id}-${agent}`, historyText: `Task T-${t.id}: ${t.title}${t.description ? `\n\n${t.description}` : ''}` });
  delete ui.running[t.id];
  ui.saving[t.id] = true;
  render();
  let cp = null;
  try {
    cp = await api.checkpoint(t.id, agent, `${t.title} — ${res.ok ? 'progress' : `checkpoint (${res.error.kind})`}`);
  } catch (e) {
    t.notes.push({ at: now(), who: 'System', text: cleanErr(e.message), err: true });
  }
  const d = res.ok ? parseDirectives(res.text) : null;
  run.status = res.ok ? (parseStatus(res.text) || 'ok') : res.error.kind;
  run.via = res.via || '';
  run.sessionId = res.sessionId || null;
  run.output = res.ok ? res.text : `${res.error.message}${res.partial ? `\n\nLast output:\n${res.partial}` : ''}`;
  run.checkpoint = cp?.sha || null;
  ops.afterRun(run, res);
  // A "done" after a review only counts with a new commit since that review.
  let refused = null;
  if (res.ok) {
    run.head = await api.workspaceHead(t.id).catch(() => null);
    run.tests = testResult(res.text);
  }
  if (res.ok) {
    const verdict = checkDoneAfterReview(t, { head: run.head, status: run.status, text: res.text });
    if (!verdict.ok) {
      refused = verdict.note;
      run.status = 'continue';
      run.refused = true;
      t.notes.push({ at: now(), who: 'System', text: refused });
      audit('Done report refused', t.id, verdict.note, agent);
    } else if (run.status === 'done') {
      t.done = { sha: run.head, tests: run.tests, at: now(), by: agent };
    }
  }
  // The app runs the project's tests itself; its result replaces the AI's claim, and a failure refuses the report.
  if (res.ok && run.status === 'done' && !refused) refused = await ops.checkDone(t, run, agent);
  if (cp) {
    const pushed = await autoPush(t.id);
    if (pushed) run.pushed = pushed.ok ? 'pushed to GitHub' : `push failed: ${pushed.message}`;
  }
  t.updatedAt = now();
  audit(res.ok ? `${NAMES[agent]} finished a run` : `${NAMES[agent]} stopped (${res.error.kind})`, t.id, cp ? `checkpoint ${cp.sha} · ${cp.stat}` : 'no file changes', agent);
  if (res.ok && run.status === 'done' && t.stage === 'implementing') {
    t.stage = 'checkpoint';
    audit('Checkpoint saved', t.id, 'agent reported done');
  }
  // The AI posts its own update to Team chat, with any permission it needs.
  if (cp) ops.checkpointLine(agent, cp, t.id);
  if (res.ok) {
    let m = null;
    ops.turnBegin(agent);
    try {
    const media = await agentAttachments(parseAttachLines(d.text || res.text), t.id, agent);
    m = post({ who: agent, auto: true, model: res.via, attachments: media.atts.length ? media.atts : undefined, text: `T-${t.id} “${t.title}”: ${(media.text || d.text || res.text).replace(/STATUS:.*$/is, '').trim().slice(0, 400) || 'finished a run.'}${run.status === 'done' ? `\n(${doneLine(run)})` : ''}` });
    if (refused) post({ who: 'system', text: `T-${t.id}: ${NAMES[agent]} reported done, but it wasn't accepted. The task stays with ${NAMES[agent]} (Ready to Resume): ${refused}` });
    m.asks = d.asks.map((a) => {
      const req = makeRequest({ id: uid(), agent, kind: a.kind, what: a.what, why: a.why, context: t.id, msgId: m.id });
      state.permissions.push(req);
      audit('Permission requested', t.id, `${NAMES[agent]} · ${PERMISSION_KINDS[req.kind]}: ${req.what}`, agent);
      return req.id;
    });
    ops.auditRoutine(agent, d.routine, t.id);
    if (m.asks.length) wakeLead('permission card', agent);
    await ops.handleLines(agent, d.text || res.text, t.id, true);
    } finally { ops.turnEnd(agent, m); }
  }
  await save();
  delete ui.saving[t.id];
  render();

  if (!res.ok && res.error.kind !== 'cancelled') wakeLead('task waiting to resume', null);
  // Crash, stall or limit: resume on another AI with the same role (at most 2 hand-offs, then ask).
  if (!res.ok && (await ops.handoff(t, agent, res, cp, depth))) { await pumpQueues(); return; }
  if (!res.ok && ['outage', 'auth', 'not_installed'].includes(res.error.kind)) {
    const next = nextAgent(liveEditors(), [agent], state.lead);
    t.notes.push({ at: now(), who: 'System', text: `${NAMES[agent]}: ${res.error.message} Progress is saved${cp ? ` (checkpoint ${cp.sha})` : ''}. Resume with ${NAMES[agent]} later${next ? `, or hand it to ${NAMES[next]} now` : ''}.` });
    await save();
    render();
  }
  if (!res.ok && res.error.kind === 'limit') {
    // Its waiting tasks go to free AIs with the same kind of role; this one continues
    // with such an AI now, or is next in line if that AI is busy.
    const moved = moveWaiting(agent, t.id);
    const need = taskNeed(t) || 'code';
    const fit = EDITORS.filter((a) => a !== agent && a !== t.reviewer && canRun(a) && roleKinds(roleMap()[a]).includes(need));
    const next = fit.find(isFree) || fit[0] || null;
    if (next && state.autoHandoff && depth < 3) {
      post({ who: 'system', text: `${NAMES[agent]} ran out of usage on T-${t.id}. ${NAMES[next]} ${isFree(next) ? 'is continuing it' : 'continues it when free'}.${moved}` });
      await save();
      if (isFree(next)) await runTask(t, next, { from: agent, reason: 'ran out of usage' }, depth + 1);
      else startOrQueue(t, next);
    } else {
      t.notes.push({ at: now(), who: 'System', text: `${NAMES[agent]} ran out of usage. Progress is saved${cp ? ` (checkpoint ${cp.sha})` : ''}. ${next ? `Hand it to ${NAMES[next]}` : 'No AI with the same role is free'} — or continue in FreeBuff.${moved}` });
      if (moved) post({ who: 'system', text: `${NAMES[agent]} ran out of usage.${moved}` });
      save();
      render();
    }
  }
  // Nothing waits at Checkpoint: a done report always moves to review. It goes to the
  // reviewer now, or waits for them ("Waiting for …", with Pick reviewer for the owner).
  if (res.ok && t.stage === 'checkpoint') {
    t.stage = 'review';
    const canReview = HEADLESS.includes(t.reviewer) && isFree(t.reviewer) && !ui.busy[t.id];
    t.reviewWaiting = !canReview;
    audit(canReview ? 'Sent for review' : 'Waiting for reviewer', t.id, NAMES[t.reviewer] || 'no reviewer set');
    save();
    render();
    if (canReview) askForTask(t, 'opinion');
  }
  await pumpQueues();
}

async function openInFreebuff(t) {
  try {
    t.ws = t.ws || (await api.ensureWorkspace(t.id, t.title));
    const prev = (t.runs || []).filter((r) => r.status !== 'running').slice(-1)[0];
    const summary = await api.workspaceSummary(t.id, t.ws.baseSha).catch(() => '');
    const brief = buildTaskBrief({ task: t, agent: 'freebuff', summary, handoffFrom: prev?.agent, reason: prev ? `last status: ${prev.status}` : '' });
    const r = await api.openFreebuff(t.id, brief);
    if (!r.ok) return toast(r.message);
    t.freebuffOpen = true;
    if (t.stage === 'intake') t.stage = 'implementing';
    audit('Opened in FreeBuff', t.id, `brief copied to clipboard and saved to ${r.briefFile}`);
    save();
    render();
    toast('FreeBuff opened in this task’s workspace. The handoff brief is on your clipboard — paste it in.');
  } catch (e) {
    toast(cleanErr(e.message));
  }
}

async function freebuffDone(t) {
  let cp = null;
  try { cp = await api.checkpoint(t.id, 'freebuff', `${t.title} — progress`); } catch (e) { return toast(cleanErr(e.message)); }
  t.freebuffOpen = false;
  t.runs = t.runs || [];
  t.runs.push({ id: uid(), agent: 'freebuff', at: now(), status: 'ok', via: 'FreeBuff (interactive)', output: 'Worked interactively in FreeBuff.', checkpoint: cp?.sha || null });
  audit('FreeBuff work checkpointed', t.id, cp ? `checkpoint ${cp.sha} · ${cp.stat}` : 'no file changes', 'freebuff');
  save();
  render();
}

async function refreshProviders() {
  try { prov = await api.providerStatus(); } catch {}
}

// One-click sign-in: install the official tool if missing, otherwise open its
// own sign-in (it opens the provider's page in your browser), then watch for it
// to finish. Passwords and tokens never pass through this app.
const signinTimers = {};
const INSTALL_WAIT_MS = 20 * 60 * 1000;
async function startSignin(a) {
  await refreshAgents();
  if (!cli[a]?.installed) return startInstall([a], { signin: true });
  const r = await api.agentLogin(a);
  if (!r.ok) { ui.signin[a] = { state: 'error', msg: r.message }; render(); return toast(r.message); }
  ui.signin[a] = { state: 'waiting', at: Date.now() };
  audit(`${AGENTS[a].name} sign-in started`, null, `official sign-in in ${r.terminal}`);
  toast(`${AGENTS[a].tool}'s own sign-in opened in ${r.terminal}. Finish on ${AGENTS[a].vendor}'s page in your browser — this updates by itself.`);
  render();
  watchSignin(a);
}

// One-click install of one or more official tools, one after another in a
// terminal you can see. signin: open the tool's own sign-in when it's done.
async function startInstall(list, { signin = false } = {}) {
  await refreshAgents();
  const todo = list.filter((a) => !cli[a]?.installed);
  if (!todo.length) { render(); return toast('Already installed.'); }
  const r = await api.agentInstall(todo).catch((e) => ({ ok: false, message: cleanErr(e.message) }));
  if (!r.ok) {
    for (const a of todo) ui.signin[a] = { state: 'error', msg: r.message, install: true };
    render();
    return toast(r.message);
  }
  for (const a of todo) {
    ui.signin[a] = { state: 'installing', at: Date.now(), signin: signin && AGENTS[a].kind === 'cli' };
    cli[a] = { ...cli[a], install: 'queued' };
  }
  const names = todo.map((a) => AGENTS[a].tool).join(', ');
  audit(todo.length > 1 ? 'Install all started' : `${AGENTS[todo[0]].tool} install started`, null, `official installer${todo.length > 1 ? 's' : ''} in ${r.terminal}: ${names}`);
  toast(`Installing ${names} in ${r.terminal}.${todo.includes('ollama') ? ' Ollama asks for your computer password there; this app never sees it.' : ''}${signin ? ' Sign-in starts when it’s done.' : ''}`);
  render();
  for (const a of todo) watchSignin(a);
}

function watchSignin(a) {
  clearInterval(signinTimers[a]);
  signinTimers[a] = setInterval(async () => {
    const s = ui.signin[a];
    if (!s) return clearInterval(signinTimers[a]);
    const st = await api.agentStatus(a).catch(() => ({}));
    cli[a] = st;
    if (s.state === 'installing' && st.installed) {
      if (s.signin) {
        const lr = await api.agentLogin(a);
        ui.signin[a] = lr.ok ? { state: 'waiting', at: Date.now() } : { state: 'error', msg: lr.message };
        if (lr.ok) toast(`${AGENTS[a].tool} is installed. Its own sign-in opened in ${lr.terminal}.`);
      } else {
        clearInterval(signinTimers[a]);
        ui.signin[a] = { state: 'installed', at: Date.now() };
        audit(`${AGENTS[a].tool} installed`);
        save();
        toast(`${AGENTS[a].tool} is installed.${AGENTS[a].kind === 'cli' ? ' Press Sign in on its card.' : ''}`);
      }
    } else if (s.state === 'installing' && st.install === 'failed') {
      clearInterval(signinTimers[a]);
      ui.signin[a] = { state: 'error', msg: `${AGENTS[a].tool} could not be installed. The terminal says why.`, install: true };
      toast(ui.signin[a].msg);
    } else if (s.state === 'waiting' && (st.signedIn || (a === 'mistral' && st.signedIn !== false))) {
      clearInterval(signinTimers[a]);
      clearHold(a);
      ui.signin[a] = { state: 'linked', at: Date.now() };
      audit(`${AGENTS[a].name} linked`, null, `signed in with your own account via ${AGENTS[a].tool}`);
      save();
      toast(`${AGENTS[a].name} is linked.`);
    } else if (Date.now() - s.at > (s.state === 'installing' ? INSTALL_WAIT_MS : 5 * 60 * 1000)) {
      clearInterval(signinTimers[a]);
      ui.signin[a] = s.state === 'installing' ? { state: 'error', msg: 'The install did not finish. Check the terminal, then press Re-check.', install: true } : { state: 'timeout', at: Date.now() };
    }
    ui.keepScroll = true;
    if (['agents', 'overview'].includes(ui.view)) render();
  }, 3000);
}

async function teamCheckin() {
  const live = liveAgents();
  if (!live.length || round) return;
  post({ who: 'owner', auto: true, text: 'Team check-in: anything to report, propose or ask? Reply PASS if not.' });
  save();
  render();
  await runRoom([state.lead, ...live.filter((a) => a !== state.lead)].filter((a) => live.includes(a)), { trigger: 'check-in' });
}

async function syncHistory(quiet = false) {
  ui.hist.scanning = true;
  if (ui.view === 'history') render();
  const r = await api.historyScan().catch((e) => ({ ok: false, message: cleanErr(e.message) }));
  ui.hist.scanning = false;
  await refreshHistory();
  if (!quiet) toast(r.ok ? `Synced ${r.found} CLI sessions.` : `Couldn't sync: ${r.message}`);
  if (ui.view === 'history') render();
}

const CLICK = '[data-sendreview],[data-owneract],[data-updatemain],[data-releasebranch],[data-leadundo],[data-opendup],[data-adddup],[data-stopround],[data-toggleleadgh],[data-attach],[data-unattach],[data-lightbox],[data-closelightbox],[data-testkey],[data-nav],[data-new],[data-open],[data-close],[data-cancel],[data-create],[data-advance],[data-approve],[data-reject],[data-changes],[data-note],[data-delete],[data-savekey],[data-rmkey],[data-ask],[data-export],[data-reset],[data-upd],[data-opinion],[data-modalbg],[data-sendchat],[data-target],[data-addprop],[data-addall],[data-clearchat],[data-method],[data-login],[data-recheck],[data-locate],[data-available],[data-run],[data-stop],[data-freebuff],[data-fbdone],[data-openws],[data-pickproject],[data-autohandoff],[data-restore],[data-install],[data-installall],[data-installollama],[data-startprop],[data-showchanges],[data-dismisssetup],[data-signin],[data-disconnect],[data-toggleagent],[data-ghlogin],[data-gitrefresh],[data-useproject],[data-clone],[data-gitpull],[data-pushbranch],[data-openpr],[data-approvemerge],[data-approvepr],[data-access],[data-togglesetting],[data-adddir],[data-removedir],[data-expand],[data-opensignin],[data-openweb],[data-openexport],[data-makelead],[data-decide],[data-editmsg],[data-delmsg],[data-saveedit],[data-canceledit],[data-togglehist],[data-checkin],[data-histscan],[data-histimport],[data-histopen],[data-histresume],[data-histweb],[data-histwebin],[data-histremove],[data-prlist],[data-prrefresh],[data-release],[data-theme]';

document.addEventListener('click', async (e) => {
  const el = e.target.closest(CLICK);
  if (!el) return;
  const d = el.dataset;
  const task = (id) => state.tasks.find((t) => t.id === id);

  if (d.modalbg !== undefined && e.target === el) { ui.modal = null; return render(); }
  if (d.nav) {
    ui.view = d.nav; ui.selected = null;
    if (d.nav === 'settings') backups = await api.backups().catch(() => backups);
    if (d.nav === 'github') { await refreshGit(); await refreshPrs(); }
    if (d.nav === 'approvals' || d.nav === 'board') recheckApprovals();
    if (d.nav === 'approvals' && Date.now() - (ui.lastFetchAt || 0) > 10 * 60000) { ui.lastFetchAt = Date.now(); leadFetch().then(() => { if (ui.view === 'approvals') render(); }); }
    if (d.nav === 'history') await refreshHistory();
    return render();
  }
  if (d.expand) {
    if (e.target.closest('button,a,input,select,textarea')) return;
    ui.expanded = ui.expanded === d.expand ? null : d.expand;
    ui.side = d.expand;
    ui.keepScroll = true;
    return render();
  }
  if (d.sendchat !== undefined) return sendChat();
  if (d.stopround !== undefined) return stopChatRound();
  if (d.leadundo) return undoLead(d.leadundo);
  if (d.toggleleadgh !== undefined) { settings = await api.setSettings({ leadGitHub: !leadGitHubOn() }); audit(`Lead handles GitHub turned ${leadGitHubOn() ? 'on' : 'off'}`); save(); return render(); }
  if (d.attach !== undefined) {
    const list = await api.attachPick().catch((err) => [{ ok: false, message: cleanErr(err.message) }]);
    for (const r of list || []) { if (r.ok) ui.attach.push(r.att); else toast(r.message); }
    return render();
  }
  if (d.unattach !== undefined) { ui.attach.splice(Number(d.unattach), 1); return render(); }
  if (d.lightbox) {
    const [mid, i] = d.lightbox.split(':');
    const a = state.chat.find((x) => x.id === mid)?.attachments?.[Number(i)];
    if (a) { ui.lightbox = a; render(); }
    return;
  }
  if (d.closelightbox !== undefined) { ui.lightbox = null; return render(); }
  if (d.opendup) { ui.modal = null; ui.view = 'board'; ui.selected = d.opendup; return render(); }
  if (d.adddup) {
    if (d.adddup === 'form') return createTask(true);
    const [id, i] = d.adddup.split(':');
    const t = addProposal(id, Number(i), true);
    save();
    render();
    if (t) toast('Added to the board anyway.');
    return;
  }
  if (d.sendreview) {
    const t = task(d.sendreview);
    const who = document.getElementById(`pickrev-${t.id}`)?.value;
    if (!t || !who || who === t.assignee) return;
    if (who !== t.reviewer) { audit('Reviewer changed', t.id, `${NAMES[t.reviewer] || 'none'} → ${NAMES[who]}`); t.reviewer = who; }
    if (!canRun(who) || !isFree(who)) { t.reviewWaiting = true; save(); render(); return toast(`${NAMES[who]} isn't free; T-${t.id} goes to them when they are.`); }
    save();
    return askForTask(t, 'opinion');
  }
  if (d.owneract) {
    const t = task(d.owneract);
    const a = t && actionFor(t);
    if (!a) return render();
    if (a.kind === 'resume' || a.kind === 'start') {
      audit(a.kind === 'resume' ? 'Owner approved resume' : 'Owner started task', t.id, NAMES[a.agent]);
      return startOrQueue(t, a.agent);
    }
    if (a.kind === 'signin') { ui.view = 'agents'; ui.side = a.agent; ui.selected = null; return render(); }
    if (a.kind === 'pickreviewer') { ui.selected = t.id; render(); return document.getElementById(`pickrev-${t.id}`)?.focus(); }
    ui.selected = t.id; // approve / permission / policy: decide in the task panel
    return render();
  }
  if (d.checkin !== undefined) return teamCheckin();
  if (d.decide) { const [id, dec] = d.decide.split(':'); return decide(id, dec); }
  if (d.editmsg) { ui.editing = d.editmsg; return render(); }
  if (d.canceledit !== undefined) { ui.editing = null; return render(); }
  if (d.saveedit) {
    const r = applyEdit(state.chat, { id: d.saveedit, by: 'owner', text: document.getElementById('edit-text').value });
    ui.editing = null;
    if (r.ok) { audit('Owner edited a message', null, `#${d.saveedit} (${NAMES[r.message.who]})`); save(); } else if (r.reason !== 'no change') toast(r.reason);
    return render();
  }
  if (d.delmsg) {
    const m = state.chat.find((x) => x.id === d.delmsg);
    if (!m || !confirm('Delete this message? The audit log keeps a short record.')) return;
    state.chat = state.chat.filter((x) => x.id !== d.delmsg);
    audit('Owner deleted a message', null, `#${m.id} by ${NAMES[m.who]}: ${String(m.text).slice(0, 80)}`);
    save();
    return render();
  }
  if (d.togglehist) { ui.showHist[d.togglehist] = !ui.showHist[d.togglehist]; return render(); }
  if (d.ghlogin !== undefined) {
    const r = await api.gitLogin();
    return toast(r.ok ? `GitHub sign-in opened in ${r.terminal} — choose "Login with a web browser", finish on github.com, then press Re-check.` : r.message);
  }
  if (d.gitrefresh !== undefined) { await refreshGit(); await refreshPrs(); return render(); }
  if (d.prlist !== undefined) { await refreshPrs(); return render(); }
  if (d.prrefresh) {
    const r = await api.gitPrView(d.prrefresh).catch((err) => ({ ok: false, message: cleanErr(err.message) }));
    if (r.ok) ui.prs.byTask[d.prrefresh] = r.pr; else toast(r.message);
    return render();
  }
  // A folder is a project with its own board: switching reloads the window (saved first, never after).
  if (d.useproject) { await save(); settings = await api.useProject(d.useproject); if (settings.projectSwitched) return location.reload(); state.chatWs = null; await refreshGit(); return render(); }
  if (d.clone !== undefined) {
    const input = document.getElementById('clone-input').value.trim();
    if (!input) return;
    toast('Cloning…');
    audit('Cloning a project', null, input);
    await save();
    const r = await api.gitClone(input).catch((err) => ({ ok: false, message: cleanErr(err.message) }));
    if (r.ok && r.settings?.projectSwitched) return location.reload();
    if (r.ok) { settings = await api.settings(); state.chatWs = null; await refreshGit(); audit('Cloned project', null, r.dir); save(); }
    toast(r.ok ? `Cloned to ${r.dir} — it's now the active project.` : `Clone failed: ${r.message}`);
    return render();
  }
  if (d.gitpull !== undefined) {
    const r = await api.gitPull().catch((err) => ({ ok: false, message: cleanErr(err.message) }));
    audit(r.ok ? 'Pulled from GitHub' : 'Pull failed', null, r.message);
    await refreshGit();
    save();
    toast(r.message);
    return render();
  }
  if (d.pushbranch) {
    const r = await api.gitPushBranch(d.pushbranch).catch((err) => ({ ok: false, message: cleanErr(err.message) }));
    audit(r.ok ? 'Pushed to GitHub' : 'Push failed', null, `${d.pushbranch}: ${r.message}`);
    await refreshGit();
    save();
    toast(r.message);
    return render();
  }
  if (d.openpr) {
    const t = task(d.openpr);
    const body = `${t.description}\n\n---\nTask T-${t.id} from Hearth AI Command Center.`;
    const r = await api.gitOpenPr(t.id, t.title, body).catch((err) => ({ ok: false, message: cleanErr(err.message) }));
    if (r.ok) {
      t.pr = { url: r.url, number: r.number };
      t.notes.push({ at: now(), who: 'System', text: `Pull request: ${r.url}` });
      audit('Pull request opened', t.id, r.url);
      const v = await api.gitPrView(t.id).catch(() => null);
      if (v?.ok) ui.prs.byTask[t.id] = v.pr;
      save();
    }
    toast(r.ok ? 'Pull request opened on GitHub.' : `Couldn't open a pull request: ${r.message}`);
    return render();
  }
  if (d.approvepr) {
    const t = task(d.approvepr);
    const pr = ui.prs.byTask[t.id];
    if (!pr) return;
    if (await recheckApprovals([t])) return toast(`T-${t.id} changed after its review, so it went back to review.`);
    const r = await api.gitPrMerge(pr.number, { sha: approvedSha(t) }).catch((err) => ({ ok: false, message: cleanErr(err.message) }));
    if (!r.ok) { if (r.message !== 'Cancelled.') toast(r.message); return; }
    t.decision = 'approved';
    t.notes.push({ at: now(), who: 'System', text: r.message });
    const v = await api.gitPrView(t.id).catch(() => null);
    if (v?.ok) ui.prs.byTask[t.id] = v.pr;
    await refreshGit();
    return setStage(t, 'approved', 'Owner approved and merged PR', r.message);
  }
  if (d.updatemain) {
    const t = task(d.updatemain);
    if (!t?.ws || ui.busy[t.id]) return;
    if (ui.running[t.id]) return toast(`${NAMES[ui.running[t.id].agent]} is working on T-${t.id}. Update from main when the run has finished.`);
    ui.busy[t.id] = 'update';
    render();
    const r = await api.gitUpdateFromMain(t.id).catch((err) => ({ ok: false, message: cleanErr(err.message) }));
    delete ui.busy[t.id];
    t.notes.push({ at: now(), who: 'System', text: r.message });
    audit(r.ok ? 'Task branch updated from main' : 'Update from main stopped', t.id, r.message);
    if (!r.ok && r.conflicts?.length) post({ who: 'system', text: `T-${t.id} “${t.title}” conflicts with main in ${r.conflicts.join(', ')}. Nothing was changed. ${NAMES[t.assignee] || 'The implementer'} needs to resolve it before it can be merged.` });
    save();
    toast(r.message);
    return render();
  }
  if (d.releasebranch !== undefined) {
    if (ui.busy.release) return;
    await recheckApprovals();
    const list = state.tasks.filter((t) => t.stage === 'approval' && t.ws);
    if (list.length < 2) return render();
    ui.busy.release = true;
    render();
    // The approved commits are merged; a workspace with unsaved changes is refused.
    const r = await api.gitReleaseBranch(list.map((t) => ({ id: t.id, sha: approvedSha(t) }))).catch((err) => ({ ok: false, message: cleanErr(err.message) }));
    delete ui.busy.release;
    ui.releaseResult = r;
    audit(r.ok ? 'Release branch created' : 'Release branch failed', null, r.message);
    post({ who: 'system', text: `Release branch: ${r.message}` });
    save();
    toast(r.ok ? `Created ${r.branch}.` : r.message);
    return render();
  }
  if (d.approvemerge) {
    const t = task(d.approvemerge);
    if (await recheckApprovals([t])) return toast(`T-${t.id} changed after its review, so it went back to review.`);
    const r = await api.gitMergeApproved(t.id, { sha: approvedSha(t) }).catch((err) => ({ ok: false, message: cleanErr(err.message) }));
    if (!r.ok) { if (r.message !== 'Cancelled.') toast(r.message); return; }
    t.decision = 'approved';
    t.notes.push({ at: now(), who: 'System', text: r.message });
    await refreshGit();
    return setStage(t, 'approved', 'Owner approved and merged', r.message);
  }
  if (d.release !== undefined) {
    const rel = ui.release;
    const r = await api.gitRelease({ version: rel.version, confirmVersion: rel.confirm, target: rel.target || repo.defaultBranch || 'main', notes: rel.notes, draft: rel.draft }).catch((err) => ({ ok: false, message: cleanErr(err.message) }));
    if (r.ok) { audit('Owner approved a release', null, `${r.tag}${r.draft ? ' (draft)' : ''} · version typed by you`); ui.release = { version: '', confirm: '', target: '', notes: '', draft: true }; save(); }
    toast(r.message);
    return render();
  }
  if (d.theme) { settings = await api.setSettings({ theme: d.theme }); applyTheme(); return render(); }
  if (d.access) {
    if (d.access === 'full' && !confirm('Give the AIs full access with no safety checks? They could run any command on this computer without asking. One bad command could break a device.')) return render();
    settings = await api.setSettings({ access: d.access });
    audit(`AI permissions set to ${d.access === 'full' ? 'full access' : 'like their own apps'}`);
    save();
    return render();
  }
  if (d.togglesetting) { settings = await api.setSettings({ [d.togglesetting]: !settings[d.togglesetting] }); return render(); }
  if (d.adddir !== undefined) {
    try { settings = await api.addDir(); audit('Folder access granted', null, settings.extraDirs.slice(-1)[0] || ''); save(); } catch (err) { toast(cleanErr(err.message)); }
    return render();
  }
  if (d.removedir) { settings = await api.removeDir(d.removedir); audit('Folder access removed', null, d.removedir); save(); return render(); }
  if (d.signin) return startSignin(d.signin);
  if (d.opensignin) { await api.agentOpenSignin(d.opensignin).catch((err) => toast(cleanErr(err.message))); return; }
  if (d.openweb) { await api.openWeb(d.openweb).catch((err) => toast(cleanErr(err.message))); audit(`Opened ${AGENTS[d.openweb]?.name || d.openweb} web window`); return; }
  if (d.openexport) { const r = await api.openExport(d.openexport); if (!r.ok) toast(r.message); return; }
  if (d.makelead) { state.lead = d.makelead; audit('Lead coordinator changed', null, NAMES[state.lead]); save(); return render(); }
  if (d.disconnect) {
    const a = d.disconnect;
    if (!confirm(`Sign ${AGENTS[a].name} out on this computer? This signs out ${AGENTS[a].tool} everywhere you use it on this computer, not just here.`)) return;
    const r = await api.agentLogout(a).catch((err) => ({ ok: false, message: cleanErr(err.message) }));
    audit(r.ok ? `${AGENTS[a].name} signed out` : `${AGENTS[a].name} sign-out failed`, null, r.message || '');
    delete ui.signin[a];
    await refreshAgents();
    save();
    toast(r.ok ? (r.message || `${AGENTS[a].name} is signed out.`) : `Couldn't sign out: ${r.message}`);
    return render();
  }
  if (d.toggleagent) {
    state.disabled = state.disabled || {};
    state.disabled[d.toggleagent] = !state.disabled[d.toggleagent];
    if (!state.disabled[d.toggleagent]) delete state.disabled[d.toggleagent];
    audit(`${AGENTS[d.toggleagent].name} turned ${state.disabled[d.toggleagent] ? 'off' : 'on'}`);
    save();
    return render();
  }
  if (d.install) return startInstall([d.install]);
  if (d.installollama !== undefined) { ui.installOllama = !ui.installOllama; ui.keepScroll = true; return render(); }
  if (d.installall !== undefined) {
    const list = INSTALLABLE.filter((a) => !cli[a]?.installed && !state.disabled?.[a]);
    if (ui.installOllama && !cli.ollama?.installed) list.push('ollama');
    return startInstall(list);
  }
  if (d.startprop) {
    const [id, i] = d.startprop.split(':');
    const t = addProposal(id, Number(i));
    await save();
    render();
    if (t && t.policy.ok) return startOrQueue(t, t.assignee);
    if (t) toast('Added, but the policy check blocked it — open it to see why.');
    return;
  }
  if (d.showchanges) {
    const t = task(d.showchanges);
    ui.changes[t.id] = await api.workspaceSummary(t.id, t.ws.baseSha).catch((err) => cleanErr(err.message));
    return render();
  }
  if (d.dismisssetup !== undefined) { state.setupDismissed = true; save(); return render(); }
  if (d.method) {
    const [a, m] = d.method.split(':');
    settings = await api.setConnection(a, m);
    if (clearHold(a)) save();
    return render();
  }
  if (d.login) {
    const r = await api.agentLogin(d.login);
    toast(r.ok ? `Opened in ${r.terminal}. Finish there, then press Re-check.` : r.message);
    return;
  }
  if (d.recheck !== undefined) { await refreshAgents(); await refreshProviders(); toast('Agent status refreshed.'); ui.keepScroll = true; return render(); }
  if (d.locate) { settings = await api.pickBinary(d.locate); await refreshAgents(); return render(); }
  if (d.available) { delete state.agentStatus[d.available]; audit(`${NAMES[d.available]} marked available`); save(); render(); return pumpQueues(); }
  if (d.run) { const [id, a] = d.run.split(':'); return startOrQueue(task(id), a); }
  if (d.stop) { const r = ui.running[d.stop]; if (r) await api.cancelRun(r.runId); return; }
  if (d.freebuff) return openInFreebuff(task(d.freebuff));
  if (d.fbdone) return freebuffDone(task(d.fbdone));
  if (d.openws !== undefined) return api.openWorkspace(d.openws || null);
  if (d.pickproject !== undefined) {
    try { await save(); settings = await api.pickProject(); if (settings.projectSwitched) return location.reload(); state.chatWs = null; await refreshGit(); } catch (err) { toast(cleanErr(err.message)); }
    return render();
  }
  if (d.autohandoff !== undefined) { state.autoHandoff = !state.autoHandoff; save(); return render(); }
  if (d.target) { ui.target = d.target; render(); return document.getElementById('chat-text')?.focus(); }
  if (d.addprop) {
    const [id, i] = d.addprop.split(':');
    const added = addProposal(id, Number(i));
    save();
    render();
    if (added) toast('Added to the board — it starts at Intake with a policy check.');
    return;
  }
  if (d.addall) {
    const m = state.chat.find((x) => x.id === d.addall);
    (m?.proposals || []).forEach((_, i) => addProposal(d.addall, i));
    save();
    render();
    return toast('Tasks added to the board.');
  }
  if (d.clearchat !== undefined) {
    if (!confirm('Clear the team chat? Tasks on the board, permission records and saved CLI sessions stay.')) return;
    state.chat = [];
    state.chatSessions = {};
    audit('Team chat cleared');
    save();
    return render();
  }
  if (d.histscan !== undefined) return syncHistory();
  if (d.histimport !== undefined) {
    const r = await api.historyImport(ui.hist.kind).catch((err) => ({ ok: false, message: cleanErr(err.message) }));
    if (r.cancelled) return;
    if (r.ok) audit('Imported chat export', null, `${r.imported} conversations from ${r.file} (${r.kind})`);
    toast(r.ok ? `Imported ${r.imported} conversations (${r.kind}).` : `Import failed: ${r.message}`);
    await refreshHistory();
    save();
    return render();
  }
  if (d.histopen) { ui.hist.sel = await api.historyGet(d.histopen).catch(() => null); return render(); }
  if (d.histresume) {
    const r = await api.historyResume(d.histresume);
    toast(r.ok ? `Opened “${r.command}” in ${r.terminal}.` : r.message);
    return;
  }
  if (d.histweb) { await api.historyOpenWeb(d.histweb, false); return; }
  if (d.histwebin) { await api.historyOpenWeb(d.histwebin, true); return; }
  if (d.histremove) {
    if (!confirm('Remove this conversation from the app’s history? The CLI’s own files are not touched.')) return;
    await api.historyRemove(d.histremove);
    ui.hist.sel = null;
    await refreshHistory();
    return render();
  }
  if (d.new !== undefined) { ui.modal = 'new'; render(); return document.getElementById('f-title')?.focus(); }
  if (d.cancel !== undefined) { ui.modal = null; return render(); }
  if (d.create !== undefined) return createTask();
  if (d.close !== undefined) { ui.selected = null; return render(); }
  if (d.advance) {
    const t = task(d.advance);
    return setStage(t, NEXT[t.stage][0], NEXT[t.stage][1], STAGES[NEXT[t.stage][0]]);
  }
  if (d.approve) {
    const t = task(d.approve);
    if (await recheckApprovals([t])) return toast(`T-${t.id} changed after its review, so it went back to review.`);
    t.decision = 'approved';
    setStage(t, 'approved', 'Owner approved', `${ACTIONS[t.action]} authorized (nothing merged into main or released).`);
    return leadIntegrate(t);
  }
  if (d.reject) {
    const t = task(d.reject);
    t.decision = 'rejected';
    return setStage(t, 'rejected', 'Owner rejected', 'Branch kept; decision recorded.');
  }
  if (d.changes) {
    const t = task(d.changes);
    requestChanges(t, { by: 'owner', reason: 'requested from Approvals', at: now() });
    return setStage(t, 'implementing', 'Changes requested', 'Sent back to implementer');
  }
  if (d.open !== undefined) {
    e.preventDefault();
    if (!d.open) return;
    ui.selected = d.open;
    render();
    const t = task(d.open);
    if (t?.pr && !ui.prs.byTask[t.id] && gh.ghUser) {
      const v = await api.gitPrView(t.id).catch(() => null);
      if (v?.ok) { ui.prs.byTask[t.id] = v.pr; render(); }
    }
    return;
  }
  if (d.note) {
    const text = document.getElementById('note-text').value.trim();
    if (!text) return;
    const t = task(d.note);
    t.notes.push({ at: now(), who: 'Owner', text: text.slice(0, 5000) });
    audit('Note added', t.id);
    save();
    return render();
  }
  if (d.delete) {
    if (!confirm('Delete this task? The audit log keeps a record.')) return;
    state.tasks = state.tasks.filter((t) => t.id !== d.delete);
    audit('Task deleted', d.delete);
    ui.selected = null;
    save();
    return render();
  }
  if (d.opinion) return askForTask(task(d.opinion), 'opinion');
  if (d.savekey) {
    const input = document.getElementById(`key-${d.savekey}`);
    try {
      await api.setKey(d.savekey, input.value);
      input.value = '';
      clearHold(d.savekey);
      delete keyTests[d.savekey];
      audit('API key saved', null, AGENTS[d.savekey].name);
      save();
      toast(`${AGENTS[d.savekey].name} key saved securely.`);
    } catch (err) {
      toast(`Not saved: ${cleanErr(err.message)}`);
    }
    await refreshProviders();
    return render();
  }
  if (d.testkey) {
    const p = d.testkey;
    if (keyTests[p]?.busy || !prov.keys[p]) return;
    const test = { busy: true };
    keyTests[p] = test;
    // Only the button and its result line change. A full redraw would wipe a key
    // pasted into the field but not saved yet.
    const show = () => {
      const btn = document.getElementById(`testkey-${p}`);
      if (btn) { btn.disabled = Boolean(test.busy); btn.textContent = test.busy ? 'Testing…' : 'Test'; }
      const line = document.getElementById(`keytest-${p}`);
      if (line) line.innerHTML = keyTestLine(test, esc);
    };
    show();
    try {
      test.result = await api.testKey(p, state.models[p] || '');
      if (test.result?.ok && clearHold(p)) { save(); updatePanel(); }
      // A refused key sets the same sign-in hold as a failed chat turn, so everything agrees.
      const problem = test.result?.ok ? null : authProblem(test.result?.error, { method: 'api' });
      if (problem) { setHold(p, problem); save(); updatePanel(); }
    } catch {
      test.result = { ok: false, error: { message: 'The test could not run. Try again.' } };
    }
    test.busy = false;
    show();
    return;
  }
  if (d.rmkey) {
    await api.removeKey(d.rmkey);
    clearHold(d.rmkey);
    delete keyTests[d.rmkey];
    audit('API key removed', null, AGENTS[d.rmkey].name);
    save();
    await refreshProviders();
    return render();
  }
  if (d.ask) {
    const p = d.ask;
    const prompt = document.getElementById(`prompt-${p}`).value;
    if (!prompt.trim()) return;
    ui.busy[p] = true;
    ui.keepScroll = true;
    render();
    consoleOut[p] = await callAgent(p, prompt, { mode: 'read', title: 'Quick test', thread: `quick-${p}`, historyText: prompt });
    delete ui.busy[p];
    ui.keepScroll = true;
    render();
    const box = document.getElementById(`prompt-${p}`);
    if (box) box.value = prompt;
    return;
  }
  if (d.export !== undefined) {
    const r = await api.exportAll(state);
    if (r.ok) toast(`Exported to ${r.file}`);
    return;
  }
  if (d.restore) {
    if (!confirm('Restore this earlier save? Your current state becomes a backup too, so you can switch back.')) return;
    try {
      const s = await api.restoreBackup(Number(d.restore));
      state = { models: {}, chat: [], agentStatus: {}, autoHandoff: true, permissions: [], chatSessions: {}, ...s };
      backups = await api.backups();
      toast('Earlier save restored.');
    } catch (err) { toast(cleanErr(err.message)); }
    return render();
  }
  if (d.reset !== undefined) {
    if (!confirm('Clear all tasks and the audit log? This cannot be undone.')) return;
    state.tasks = [];
    state.audit = [];
    save();
    return render();
  }
  if (d.upd) {
    const fn = { check: api.checkForUpdates, download: api.downloadUpdate, install: api.installUpdate, restart: api.restartApp }[d.upd];
    const res = await fn();
    if (res && !res.ok && res.message) toast(res.message);
  }
});

document.addEventListener('change', async (e) => {
  const ds = e.target.dataset || {};
  if (ds.role) {
    state.roles[ds.role] = e.target.value.trim().slice(0, 200) || DEFAULT_ROLES[ds.role];
    save();
    return;
  }
  if (ds.histfilter) { ui.hist[ds.histfilter] = e.target.value; await refreshHistory(); return render(); }
  if (ds.histkind !== undefined) { ui.hist.kind = e.target.value; return; }
  if (e.target.id === 'rel-draft') { ui.release.draft = e.target.checked; return; }
  const p = ds.model;
  if (!p) return;
  const val = e.target.value.trim();
  if (!val) {
    delete state.models[p];
    save();
  } else if (/^[A-Za-z0-9._:\-/]{1,100}$/.test(val)) {
    state.models[p] = val;
    save();
  } else {
    toast('Model name looks invalid.');
  }
});

let histTimer;
// Paste or drop images / videos into Team chat.
async function addFiles(files) {
  for (const f of [...(files || [])].slice(0, 10)) {
    if (!/^(image|video)\//.test(f.type) && !/\.(png|jpe?g|webp|gif|mp4|webm|mov)$/i.test(f.name)) continue;
    if (f.size > 200 * 1024 * 1024) { toast(`${f.name} is ${(f.size / 1048576).toFixed(0)} MB; attachments can be up to 200 MB.`); continue; }
    const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('quicktime', 'mov');
    const name = f.name && /\.\w+$/.test(f.name) ? f.name : `pasted-${Date.now()}.${ext}`;
    const r = await api.attachSave(name, await f.arrayBuffer()).catch((err) => ({ ok: false, message: cleanErr(err.message) }));
    if (r.ok) ui.attach.push(r.att); else toast(r.message);
  }
  if (ui.view === 'chat') render();
}
document.addEventListener('paste', (e) => {
  if (ui.view !== 'chat' || !e.clipboardData?.files?.length) return;
  e.preventDefault();
  addFiles(e.clipboardData.files);
});
document.addEventListener('dragover', (e) => { if (ui.view === 'chat') e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (ui.view !== 'chat' || !e.dataTransfer?.files?.length) return;
  e.preventDefault();
  addFiles(e.dataTransfer.files);
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'chat-text') ui.draft = e.target.value;
  if (e.target.id === 'hist-q') {
    ui.hist.q = e.target.value;
    clearTimeout(histTimer);
    histTimer = setTimeout(async () => {
      await refreshHistory();
      const pos = e.target.selectionStart;
      render();
      const box = document.getElementById('hist-q');
      if (box) { box.focus(); box.setSelectionRange(pos, pos); }
    }, 250);
  }
  const relMap = { 'rel-version': 'version', 'rel-confirm': 'confirm', 'rel-target': 'target', 'rel-notes': 'notes' };
  if (relMap[e.target.id]) {
    ui.release[relMap[e.target.id]] = e.target.value.trim ? (e.target.id === 'rel-notes' ? e.target.value : e.target.value.trim()) : e.target.value;
    // Keep the Approve button in sync without stealing focus.
    const btn = document.querySelector('[data-release]');
    const rel = ui.release;
    const ok = /^\d{1,4}\.\d{1,4}(\.\d{1,4})?$/.test(rel.version) && rel.version === rel.confirm;
    if (btn) { btn.disabled = !(ok && gh.ghUser && repo.remote); btn.textContent = `Approve release ${ok ? `v${rel.version}` : ''}`; }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.id === 'chat-text' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    return sendChat();
  }
  if (e.key === 'Escape') {
    if (ui.editing) ui.editing = null;
    else if (ui.modal) ui.modal = null;
    else ui.selected = null;
    render();
  }
});

// ---------- boot ----------
async function boot() {
  if (!api) {
    document.getElementById('app').innerHTML = '<div style="padding:40px">This interface must run inside the Hearth AI Command Center app.</div>';
    return;
  }
  try {
    info = await api.appInfo();
    try { settings = await api.settings(); } catch {}
    try { hearthTheme = await api.themeGet(); } catch {}
    applyTheme();
    api.onThemeChanged?.((t) => { hearthTheme = t; applyTheme(); });
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
    const saved = await api.loadState();
    if (saved && Array.isArray(saved.tasks) && Array.isArray(saved.audit)) state = { models: {}, ...saved };
    if (!Array.isArray(state.chat)) state.chat = [];
    if (!Array.isArray(state.permissions)) state.permissions = [];
    if (!state.chatSessions) state.chatSessions = {};
    for (const m of state.chat) if (!m.id) m.id = uid();
    backups = await api.backups().catch(() => backups);
    const interrupted = recoverInterrupted(state);
    for (const t of interrupted) {
      let cp = null;
      if (t.ws) { try { cp = await api.checkpoint(t.id, 'owner', `Recovery checkpoint after interrupted run: ${t.title}`); } catch {} }
      const r = t.runs.filter((x) => x.status === 'interrupted').slice(-1)[0];
      if (r && cp) r.checkpoint = cp.sha;
      audit('Recovered interrupted work', t.id, cp ? `checkpoint ${cp.sha} · ${cp.stat}` : 'no unsaved file changes');
    }
    if (interrupted.length) {
      await save();
      setTimeout(() => toast(`Recovered ${interrupted.length} interrupted task${interrupted.length > 1 ? 's' : ''} — marked Ready to Resume.`), 300);
    }
    if (backups.recoveredFrom) setTimeout(() => toast(`Your last save was damaged; restored from ${backups.recoveredFrom}.`), 600);
    await refreshProviders();
    await refreshAgents();
    await refreshGit();
    if (!state.agentStatus) state.agentStatus = {};
    if (state.autoHandoff === undefined) state.autoHandoff = true;
    if (!state.roles) state.roles = {};
    if (!state.disabled) state.disabled = {};
    if (!EDITORS.includes(state.lead)) state.lead = 'anthropic';
    upd = await api.updaterInfo();
    api.onUpdaterStatus((s) => {
      const prev = upd.status?.state;
      upd.status = s;
      if (s.state === 'available' && prev !== 'available') toast(`Update ${s.version} is available — see Settings.`);
      render();
    });
  } catch (e) {
    toast(`Startup problem: ${e.message}`);
  }
  render();
  ops.boot();
  ops.syncLocal();
  // Update only the status panel, so a usage pause can expire without touching the draft.
  setInterval(updatePanel, 15000);
  // In the background: pick up CLI sessions started outside the app, and PR status.
  setTimeout(() => { syncHistory(true); refreshPrs().then(() => { if (ui.view === 'overview') render(); }); }, 800);
}

boot();

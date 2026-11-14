// Team ops in the window: the "While you were away" page, Team stats (budget,
// strengths, cost and time, CI), the Project page (projects, PROJECT.md, tests, CI,
// logs, phone), approval levels in Settings, voice notes, and the hooks main.js calls
// around task runs. main.js passes its helpers in through createOps(ctx).
import './ops.css';
import { icon } from '../icons.mjs';
import { describeMedia } from '../media.mjs';
import { classifyFailure, BLOCKER_LABEL } from './workflow.mjs';
import { budgets as computeBudgets, pickByHeadroom, nearLimitWarning } from './budget.mjs';
import { buildSummary } from './summary.mjs';
import { inferKind, outcomes, score, suggest, KINDS } from './strength.mjs';
import { taskStats, agentTotals, fmtMs } from './stats.mjs';
import { decideHandoff, askCard, REASON, MAX_HANDOFFS } from './handoff.mjs';
import { ciBranches, applyCi, ciChangesText, CI_LABEL } from './ci.mjs';
import { parseMemoryLines, memoryCard, logTask, phoneSnapshot, phoneAction, phoneMayDecide, opsSnapshot as snapshotOf } from './feeds.mjs';
import { CATEGORIES, MOVABLE, OWNER_ONLY, cleanLevels, levelPatch, setLevels, setLeadPowers } from './approval.mjs';
import { testGate, testLabel, LOCAL_PRESETS, fitCheck, resolveLocalModel, validTag, paramsOf, localMayReview, setLocalConfig, unknownMentions, capabilities, canSeeImages, splitProgress, requestedSize, belowRequested, fmtBytes, parseImageRequests, pickImageAI, checkpointReport, result as mkResult, CAPS } from './extras.mjs';

let C = null; // the ctx main.js passed in
const local = { disk: {}, diskNotice: null, identityLater: false, guard: {}, identity: null, release: null, hw: null, jobs: [], tools: null, turn: {}, projects: { active: 'default', list: [] }, phone: null, voice: null, usage: {}, memory: null, memoryDirty: false, testing: {}, rec: null, suggestTouched: false, projectMsg: '' };

const call = (name, ...a) => (typeof C?.api?.[name] === 'function' ? C.api[name](...a).catch((e) => ({ ok: false, message: String(e?.message || e) })) : Promise.resolve(null));
const S = () => C.state();
const esc = (s) => C.esc(s);
const N = (a) => C.NAMES[a] || a || 'nobody';
const short = (sha) => String(sha || '').slice(0, 7);
const logEv = (e) => { const st = S(); st.opsLog = [...(st.opsLog || []), { at: C.now(), ...e }].slice(-1000); };
const cards = () => (S().opsCards = S().opsCards || []);

function B() {
  const st = S();
  return computeBudgets({ agents: C.EDITORS.concat(C.HEADLESS.filter((a) => !C.EDITORS.includes(a))), tasks: st.tasks, agentStatus: st.agentStatus || {}, usage: { ...(st.opsUsage || {}), ...local.usage } });
}

// Plain data the Habitat can read (finished tasks, failures, per-AI budget, CI per task).
export function opsSnapshot() {
  if (!C) return { at: new Date().toISOString(), finished: [], failures: [], budget: {}, ci: {} };
  return snapshotOf({ state: S(), budgets: B(), since: S().opsSeenAt || '' });
}

// Synthetic click on main.js's own handlers (same code path as the owner's buttons).
function fakeClick(data) {
  const b = document.createElement('button');
  for (const [k, v] of Object.entries(data)) b.dataset[k] = v;
  b.hidden = true;
  document.body.appendChild(b);
  b.click();
  b.remove();
}

// ---------- hooks around task runs ----------
function afterRun(run, res) {
  const at = Date.parse(run.at);
  if (Number.isFinite(at)) run.ms = Date.now() - at;
  if (res?.usage) run.usage = res.usage;
}

// The app runs the tests; returns a refusal note when they fail.
async function checkDone(t, run, agent) {
  local.testing[t.id] = true;
  C.render();
  const r = (await call('opsTestRun', t.id, run.head)) || { status: 'not run', log: 'Test runner unavailable.', command: null };
  delete local.testing[t.id];
  run.claimedTests = run.tests;
  run.tests = r.status;
  run.appTests = r.status;
  run.testCommand = r.command || null;
  run.testMs = r.ms || 0;
  run.testLog = String(r.log || '').slice(-20000);
  run.testReason = r.reason || null;
  run.testsChanged = r.testsChanged?.length ? r.testsChanged : undefined;
  if (t.done) { t.done.tests = r.status; t.done.testsChanged = run.testsChanged; }
  if (run.testsChanged) C.audit('Tests changed by this task', t.id, run.testsChanged.join(', '), agent);
  C.audit(r.status === 'passed' ? 'Tests passed' : r.status === 'failed' ? 'Tests failed' : 'Tests not run', t.id, `${r.command || 'no test command'} at ${short(run.head)}${r.ms ? ` · ${fmtMs(r.ms)}` : ''}${run.claimedTests && run.claimedTests !== r.status ? ` (the AI said: ${run.claimedTests})` : ''}`, agent);
  // Environment blockers (missing deps or tools, denied permissions, wrong Node, machine-
  // dependent tests) are shown as their own state and never count as the implementer's failure.
  const b = r.status === 'failed' ? classifyFailure(r.log) : r.reason === 'no dependencies installed' ? classifyFailure('no node_modules') : null;
  if (b && b.kind !== 'code') {
    run.blocker = b;
    t.testBlocker = { ...b, at: C.now(), sha: run.head };
    C.audit(`Blocker: ${BLOCKER_LABEL[b.kind]}`, t.id, `${b.title} — next: ${b.next}`, agent);
    if (r.status === 'failed') { t.notes.push({ at: C.now(), who: 'Tests', text: `The tests couldn't run properly here (${BLOCKER_LABEL[b.kind]}: ${b.title}). That isn't counted against ${N(agent)}'s code. Next: ${b.next}`, err: true }); return null; }
  } else if (r.status === 'passed') delete t.testBlocker;
  const gate = testGate(r);
  if (gate.accept) return null;
  if (gate.note) {
    run.status = 'continue';
    run.refused = true;
    delete t.done;
    t.notes.push({ at: C.now(), who: 'Tests', text: gate.note, err: true });
    C.audit('Done report refused', t.id, gate.note, agent);
    return gate.note;
  }
  const lines = String(r.log || '').trim().split('\n').slice(-15).join('\n');
  const note = `The app ran \`${r.command}\` at ${short(run.head)} and it failed, so the done report wasn't accepted. Fix the failing tests and report done again.\n\nLast lines:\n${lines}`;
  run.status = 'continue';
  run.refused = true;
  delete t.done;
  t.notes.push({ at: C.now(), who: 'Tests', text: note, err: true });
  C.audit('Done report refused', t.id, `tests failed: ${r.command}`, agent);
  return note;
}

// Crash, stall or limit: resume on another AI with the same role (max 2), then ask.
async function handoff(t, agent, res, cp, depth = 0) {
  const kind = res?.error?.kind;
  const need = C.taskNeed(t) || 'code';
  const roles = C.roleMap();
  const cands = C.EDITORS.filter((a) => C.canRun(a) && C.roleKinds(roles[a]).includes(need));
  const dec = decideHandoff({ task: t, from: agent, kind, candidates: cands, budgets: B(), autoHandoff: S().autoHandoff !== false });
  if (dec.action === 'none') return false;
  const moved = kind === 'limit' ? C.moveWaiting(agent, t.id) : '';
  if (dec.action === 'ask') {
    if (!cards().some((c) => c.taskId === t.id && c.status === 'pending')) {
      const card = askCard(t, agent, kind, cands.filter((a) => a !== agent && a !== t.reviewer));
      card.options = card.options.map((o) => (o.value.startsWith('to:') ? { ...o, label: `Hand to ${N(o.value.slice(3))}` } : o));
      card.id = `HO${C.uid()}`;
      cards().push(card);
    }
    C.audit('Hand-off limit reached', t.id, `${N(agent)} ${REASON[kind]}; asking the owner (${MAX_HANDOFFS} hand-offs already)`, agent);
    C.post({ who: 'system', text: `T-${t.id} “${t.title}”: ${N(agent)} ${REASON[kind]}. It was already handed off ${MAX_HANDOFFS} times, so it waits for you in Approvals.${moved}` });
    await C.save();
    C.render();
    return true;
  }
  const to = dec.to;
  t.handoffs = [...(t.handoffs || []), { ...dec.record, at: C.now(), checkpoint: cp?.sha || null }];
  C.audit(`Hand-off to ${N(to)}`, t.id, `${N(agent)} ${REASON[kind]}; resumes from checkpoint ${cp?.sha || 'the latest commit'} (hand-off ${dec.record.n} of ${MAX_HANDOFFS})`, agent);
  C.post({ who: 'system', text: `${N(agent)} ${REASON[kind]} on T-${t.id}. ${N(to)} ${C.isFree(to) ? 'continues it now' : 'continues it when free'} from the last checkpoint (hand-off ${dec.record.n} of ${MAX_HANDOFFS}).${moved}` });
  await C.save();
  if (C.isFree(to)) await C.runTask(t, to, { from: agent, reason: REASON[kind] }, depth + 1);
  else C.startOrQueue(t, to);
  return true;
}

function recordVerdict(t, verdict, reviewer) {
  logEv({ ev: 'verdict', taskId: t.id, builder: t.assignee, reviewer, verdict, kind: inferKind(t) });
}

function leadLines(agent, text) {
  if (agent !== S().lead) return;
  for (const p of parseMemoryLines(text)) {
    if (cards().some((c) => c.type === 'memory' && c.proposal === p && c.status === 'pending')) continue;
    cards().push(memoryCard(p, N(agent), `MM${C.uid()}`));
    C.audit('Lead proposed a PROJECT.md change', null, p, agent);
    C.post({ who: 'system', text: `${N(agent)} proposes a change to PROJECT.md: “${p.slice(0, 300)}”. Approve or deny it in Approvals.` });
  }
}

function auditRoutine(agent, list = [], taskId = null) {
  for (const a of list || []) C.audit(`Routine: ${CATEGORIES[a.kind]?.label || a.kind}`, taskId, `${N(agent)}: ${a.what} (no approval needed)`, agent);
}

function beforeStart(t, a) {
  const w = nearLimitWarning(t, a, B(), C.NAMES);
  if (w) { C.toast(`${w} Consider another AI.`); t.notes.push({ at: C.now(), who: 'Budget', text: w }); }
}

// Queued tasks whose AI is out of usage move to the same-role AI with the most headroom.
function routeQueued() {
  const b = B();
  const roles = C.roleMap();
  for (const t of S().tasks) {
    if (!t.startNext || !(b[t.assignee]?.out)) continue;
    const need = C.taskNeed(t) || 'code';
    const to = pickByHeadroom(C.EDITORS.filter((a) => a !== t.assignee && a !== t.reviewer && C.canRun(a) && C.roleKinds(roles[a]).includes(need)), b);
    if (!to) continue;
    const from = t.assignee;
    C.assignTask(t, to, `${N(from)} is out of usage; ${N(to)} has the most headroom`);
    C.audit('Routed by budget', t.id, `${N(from)} → ${N(to)}`);
  }
}

function suggestFor(task = {}) {
  const st = S();
  const builders = C.EDITORS.filter((a) => C.canRun(a));
  const reviewers = C.HEADLESS.filter((a) => C.canRun(a));
  return suggest({ task, builders: builders.length ? builders : C.EDITORS, reviewers: reviewers.length ? reviewers : C.HEADLESS, stats: outcomes(st.tasks, st.opsLog || []), budgets: B() });
}

// ---------- cards (hand-off asks, PROJECT.md proposals) ----------
async function answerCard(id, value, via = '') {
  const c = cards().find((x) => x.id === id && x.status === 'pending');
  if (!c) return;
  c.status = 'answered';
  c.answer = value;
  c.answeredAt = C.now();
  if (c.type === 'memory') {
    if (value === 'approve') {
      const r = await call('opsMemoryApply', c.proposal);
      if (r?.ok) local.memory = r.text;
      C.audit('Owner approved a PROJECT.md change', null, `${c.proposal}${via}`);
    } else C.audit('Owner denied a PROJECT.md change', null, `${c.proposal}${via}`);
  }
  if (c.type === 'handoff') {
    const t = S().tasks.find((x) => x.id === c.taskId);
    if (t && value.startsWith('to:')) {
      const to = value.slice(3);
      C.audit('Owner chose who continues', t.id, `${N(to)}${via}`);
      C.assignTask(t, to, 'owner chose after the hand-off limit');
      C.startOrQueue(t, to);
    } else C.audit('Owner kept the task', c.taskId, `no further hand-off${via}`);
  }
  await C.save();
  C.render();
}

function cardHtml(c) {
  return `<div class="ask pending ops-card"><div class="k">${c.type === 'memory' ? 'PROJECT.md proposal' : 'Hand-off limit reached'}</div><div class="w">${esc(c.text)}</div>
    <div class="row">${c.options.map((o) => `<button class="btn small ${o.primary || o.value === 'approve' ? 'good' : ''}" data-ops="card" data-arg="${esc(c.id)}" data-val="${esc(o.value)}">${esc(o.label)}</button>`).join('')}</div></div>`;
}

function approvalCards() {
  const list = cards().filter((c) => c.status === 'pending');
  return list.length ? `<div class="card mb"><h3>Questions for you</h3>${list.map(cardHtml).join('')}</div>` : '';
}

// ---------- views ----------
const bar = (v, cls = '') => `<div class="ops-bar ${cls}"><div style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></div></div>`;

function summaryData() {
  const st = S();
  const since = st.opsSeenAt || new Date(Date.now() - 24 * 3600e3).toISOString();
  return buildSummary({ audit: st.audit, tasks: st.tasks, permissions: st.permissions, cards: cards(), since, agents: C.AGENT_IDS });
}

function summaryCard() {
  const s = summaryData();
  return `<div class="card mb ops-away"><h3>While you were away<span class="grow"></span><span class="faint" style="font-size:12px">since ${esc(C.time(s.since))}</span><button class="btn small link" data-nav="summary">Open →</button></h3>
    ${s.quiet ? '<div class="empty">Nothing happened since you last looked.</div>' : `<div class="ops-stats">
      <div><b>${s.totals.done}</b><span>tasks finished</span></div><div><b>${s.totals.reviews}</b><span>reviews</span></div><div><b>${s.totals.merges}</b><span>merges</span></div>
      <div class="${s.waitingCount ? 'warn' : ''}"><b>${s.waitingCount}</b><span>waiting for you</span></div><div class="${s.totals.failures ? 'bad' : ''}"><b>${s.totals.failures}</b><span>failed</span></div><div><b>${s.totals.runs}</b><span>runs · ${esc(fmtMs(s.totals.ms))}</span></div></div>`}
  </div>`;
}

function viewSummary() {
  const s = summaryData();
  const row = (r) => `<tr><td>${C.agentChip(r.agent)}</td><td>${r.done}</td><td>${r.finished}</td><td>${r.reviews}</td><td>${r.merges}</td><td>${r.handoffs}</td><td class="${r.failures ? 'bad-t' : ''}">${r.failures}</td><td>${r.runs} · ${esc(fmtMs(r.ms))}${r.tokens ? ` · ${r.tokens.toLocaleString()} tokens` : ''}${r.limits ? ` · ${r.limits} limit hit${r.limits > 1 ? 's' : ''}` : ''}</td></tr>`;
  return `<div class="card mb"><div class="row"><div><b>Since ${esc(C.time(s.since))}</b> <span class="faint">· built from the audit log and the board, not by an AI</span></div><span class="grow"></span><button class="btn small" data-ops="seen">Mark all as seen</button></div></div>
    <div class="card mb"><h3>What each AI did</h3>${s.agents.length ? `<table class="ops-table"><thead><tr><th>AI</th><th>Finished</th><th>Runs done</th><th>Reviews</th><th>Merges</th><th>Hand-offs</th><th>Failed</th><th>Usage spent</th></tr></thead><tbody>${s.agents.map(row).join('')}</tbody></table>` : '<div class="empty">No AI worked since then.</div>'}</div>
    <div class="grid two">
      <div class="card"><h3>Waiting for you (${s.waitingCount})</h3>
        ${s.waiting.approvals.map((t) => `<div class="task" data-open="${esc(t.id)}"><div class="t">${esc(t.title)}</div><div class="meta"><span class="badge warn">Approval</span>${C.agentChip(t.assignee)}</div></div>`).join('')}
        ${s.waiting.permissions.map((p) => `<div class="task" data-nav="approvals"><div class="t">${esc(p.what)}</div><div class="meta"><span class="badge warn">Permission R-${esc(p.id)}</span>${C.agentChip(p.agent)}</div></div>`).join('')}
        ${s.waiting.cards.map((c) => `<div class="task" data-nav="approvals"><div class="t">${esc(c.text)}</div></div>`).join('')}
        ${s.waitingCount ? '' : '<div class="empty">Nothing is waiting for you.</div>'}</div>
      <div class="card"><h3>What failed (${s.failed.length})</h3>${s.failed.map((f) => `<div class="task" ${f.taskId ? `data-open="${esc(f.taskId)}"` : ''}><div class="t">${esc(f.what)}${f.title ? ` · ${esc(f.title)}` : ''}</div><div class="meta">${C.agentChip(f.actor)}<span class="faint">${esc(C.ago(f.at))}</span></div>${f.detail ? `<div class="faint ops-detail">${esc(f.detail)}</div>` : ''}</div>`).join('') || '<div class="empty">Nothing failed.</div>'}</div>
    </div>`;
}

function viewOps() {
  const st = S();
  const b = B();
  const stats = outcomes(st.tasks, st.opsLog || []);
  const rows = C.AGENT_IDS.filter((a) => b[a] && (C.connected(a) || b[a].runs));
  const tstats = st.tasks.map((t) => taskStats(t)).filter((x) => x.runs || x.handoffs).slice(0, 40);
  const totals = agentTotals(st.tasks);
  const ciTasks = st.tasks.filter((t) => t.ci && t.ci.state !== 'none');
  return `${capsCard()}${jobsCard()}${toolsCard()}<div class="card mb"><h3>Budget and headroom<span class="grow"></span><button class="btn small ghost" data-ops="usage">Check usage</button></h3>
      <table class="ops-table"><thead><tr><th>AI</th><th>Headroom</th><th>Runs (5 h)</th><th>Limit hits</th><th>Reset</th><th>Based on</th></tr></thead><tbody>
      ${rows.map((a) => { const x = b[a]; return `<tr><td>${C.agentChip(a)}</td><td>${bar(x.headroom, x.out ? 'out' : x.near ? 'near' : '')}<span class="faint">${Math.round(x.headroom * 100)}%${x.out ? ' · out of usage' : x.near ? ' · near limit' : ''}</span></td><td>${x.recent} / ~${x.cap}</td><td>${x.limitHits}</td><td>${esc(x.reset || '—')}</td><td class="faint">${x.source === 'usage' ? `/usage: ${x.usedPct}% used` : x.source === 'limit' ? 'limit reported' : 'run count'}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">No AIs linked yet.</td></tr>'}
      </tbody></table><div class="faint ops-note">New and queued tasks go to the AI with the most headroom among those with the right role; starting a long task on an AI near its limit shows a warning. Tokens or credits only where a CLI reports them.</div></div>
    <div class="grid two mb">
      <div class="card"><h3>Strengths by kind of task</h3><table class="ops-table"><thead><tr><th>AI</th>${KINDS.map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>
        ${C.EDITORS.concat(C.HEADLESS.filter((a) => !C.EDITORS.includes(a))).filter((a) => stats[a]).map((a) => `<tr><td>${C.agentChip(a)}</td>${KINDS.map((k) => { const c = stats[a][k]; return `<td title="${c ? `${c.runs} runs, tests ${c.passed}/${c.passed + c.failed}, reviews ${c.approved} approved / ${c.changes} changes${c.reviewsGiven ? `, ${c.reviewsGiven} reviews given` : ''}` : 'no record yet'}">${c ? Math.round(score(c) * 100) : '—'}</td>`; }).join('')}</tr>`).join('') || `<tr><td colspan="${KINDS.length + 1}" class="empty">No outcomes recorded yet.</td></tr>`}
        </tbody></table><div class="faint ops-note">From review approvals vs changes, the app's test results and time taken. Used to suggest the builder and reviewer for new tasks.</div></div>
      <div class="card"><h3>Per AI</h3><table class="ops-table"><thead><tr><th>AI</th><th>Tasks</th><th>Runs</th><th>Time</th><th>Retries</th><th>Hand-offs out / in</th><th>Tokens</th></tr></thead><tbody>
        ${totals.map((x) => `<tr><td>${C.agentChip(x.agent)}</td><td>${x.tasks}</td><td>${x.runs}</td><td>${esc(fmtMs(x.ms))}</td><td>${x.retries}</td><td>${x.handoffsFrom} / ${x.handoffsTo}</td><td>${x.tokens ? x.tokens.toLocaleString() : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No runs yet.</td></tr>'}</tbody></table></div>
    </div>
    <div class="card mb"><h3>Cost and time per task</h3><table class="ops-table"><thead><tr><th>Task</th><th>Elapsed</th><th>Work time</th><th>Runs</th><th>Retries</th><th>Hand-offs</th><th>Tokens</th></tr></thead><tbody>
      ${tstats.map((x) => `<tr data-open="${esc(x.id)}" class="ops-click"><td>${esc(x.title)}</td><td>${esc(fmtMs(x.elapsedMs))}</td><td>${esc(fmtMs(x.workMs))}</td><td>${x.runs}</td><td>${x.retries}</td><td>${x.handoffs}</td><td>${x.tokens ? x.tokens.toLocaleString() : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No task has run yet.</td></tr>'}</tbody></table></div>
    <div class="card"><h3>CI per task</h3>${ciTasks.map((t) => `<div class="task" data-open="${esc(t.id)}"><div class="t">${esc(t.title)}</div><div class="meta">${ciBadge(t)}<span class="mono faint">${esc(short(t.ci.sha))}</span>${t.ci.job ? `<span class="faint">${esc(t.ci.job)}</span>` : ''}</div></div>`).join('') || '<div class="empty">No CI runs seen for task branches yet.</div>'}</div>`;
}

function ciBadge(t) {
  const s = t?.ci?.state;
  if (!s || s === 'none') return '';
  return `<span class="badge ${{ success: 'good', failure: 'bad', pending: '' }[s] || ''}" title="GitHub Actions on ${esc(t.ws?.branch || '')}">${esc(CI_LABEL[s])}</span>`;
}

function drawerPanel(t) {
  const last = (t.runs || []).filter((r) => r.appTests || r.testLog).slice(-1)[0];
  const parts = [];
  if (local.testing[t.id]) parts.push(`<div class="policy warn"><span class="dot pulse"></span> The app is running the tests at the reported commit… <button class="btn small ghost" data-ops="canceltests" data-arg="${esc(t.id)}">Cancel</button></div>`);
  if (last) parts.push(`<details class="ops-log"><summary><span class="badge ${{ passed: 'good', failed: 'bad' }[last.appTests] || ''}">App tests: ${esc(testLabel(last))}</span>${last.testsChanged ? `<span class="badge warn" title="${esc(last.testsChanged.join(', '))}">tests changed by this task</span>` : ''} <span class="mono faint">${esc(last.testCommand || 'no test command')} · ${esc(short(last.head))}</span>${last.claimedTests && last.claimedTests !== last.appTests ? ` <span class="faint">(the AI said ${esc(last.claimedTests)})</span>` : ''}</summary><pre>${esc(last.testLog || '')}</pre></details>`);
  if (t.ci && t.ci.state !== 'none') parts.push(`<div class="row">${ciBadge(t)}<span class="mono faint">${esc(short(t.ci.sha))}</span>${t.ci.url?.startsWith('https://github.com/') ? `<a class="btn small link" href="${esc(t.ci.url)}" target="_blank">Open run ↗</a>` : ''}</div>${t.ci.log ? `<details class="ops-log"><summary>CI log tail</summary><pre>${esc(t.ci.log)}</pre></details>` : ''}`);
  if (t.handoffs?.length) parts.push(`<div class="faint ops-note">Hand-offs: ${t.handoffs.map((h) => `${esc(N(h.from))} → ${esc(N(h.to))} (${esc(REASON[h.kind] || h.kind)})`).join(' · ')}</div>`);
  if (t.ws) {
    const g = local.guard[t.id];
    parts.push(g && !g.ok ? `<div class="policy warn">Not yours only: ${esc((g.problems || []).slice(0, 3).join('; '))}<div class="row" style="margin-top:6px"><button class="btn small" data-ops="rewrite" data-arg="${esc(t.id)}">Rewrite authorship on this task branch</button></div></div>` : `<div class="row faint ops-note">${g ? 'Every commit on this branch is yours.' : ''}<button class="btn small link" data-ops="checkauthor" data-arg="${esc(t.id)}">Check authorship</button></div>`);
  }
  if (t.log?.file) parts.push(`<div class="faint ops-note">Log ${esc(t.log.code)} saved at <span class="mono">${esc(t.log.file)}</span></div>`);
  return parts.length ? `<div class="ops-drawer">${parts.join('')}</div>` : '';
}

function projectSwitcher() {
  const p = local.projects;
  if (!p.list.length) return '';
  return `<div class="ops-proj"><label class="faint" for="ops-project">Project</label><select id="ops-project" data-opsproject>${p.list.map((x) => `<option value="${esc(x.id)}" ${x.id === p.active ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>`;
}

function phoneBlock() {
  const ph = local.phone;
  if (!ph) return '<div class="empty">Phone view isn\'t available in this build.</div>';
  return `<p class="muted ops-note">A LAN-only web page served by this app: see the board and chat, approve or deny, start tasks, answer cards and get notified. Off by default, never reachable from the internet, no third-party service. Merging into main and owner-only requests stay on this computer.</p>
    <div class="policy warn">It is plain HTTP on your local network: anyone on the same network can see the traffic. Use it only on a network you trust. Paired phones are signed out after 30 days without use.</div>
    ${(ph.interfaces || []).length ? `<label class="ops-field"><span>Network interface</span><select data-opsphonehost>${ph.interfaces.map((i) => `<option value="${esc(i.address)}" ${i.address === (ph.host || ph.interfaces[0].address) ? 'selected' : ''}>${esc(i.name)} · ${esc(i.address)}</option>`).join('')}</select></label>` : ''}
    ${ph.running ? `<div class="policy ok">On at ${ph.urls.map((u) => `<span class="mono">${esc(u)}</span>`).join(' or ') || `port ${esc(ph.port)}`} (your local network only).</div>
      ${ph.pairing ? `<div class="ops-code" aria-label="Pairing code">${esc(ph.pairing.code)}</div><div class="faint ops-note">Open the address on your phone and enter this one-time code. It expires in 5 minutes.</div>` : '<button class="btn small primary" data-ops="phonecode">Show pairing code</button>'}
      <div class="sect">Paired devices</div>${ph.devices.map((d) => `<div class="row"><span style="flex:1">${esc(d.name)} <span class="faint">· paired ${esc(C.ago(d.pairedAt))}${d.lastSeen ? ` · seen ${esc(C.ago(d.lastSeen))}` : ''}</span></span><button class="btn small ghost" data-ops="phoneremove" data-arg="${esc(d.id)}">Remove</button></div>`).join('') || '<div class="empty">No phone paired yet.</div>'}
      <div class="row" style="margin-top:8px"><button class="btn small" data-ops="phoneoff">Turn off</button><button class="btn small danger" data-ops="phoneforget">Turn off and forget devices</button></div>`
    : `<button class="btn small primary" data-ops="phoneon">Turn on</button>${ph.devices.length ? ` <button class="btn small danger" data-ops="phoneforget">Forget ${ph.devices.length} device${ph.devices.length > 1 ? 's' : ''}</button>` : ''}${ph.error ? `<div class="policy warn">${esc(ph.error)}</div>` : ''}`}`;
}

function viewProject() {
  const p = local.projects;
  const cur = p.list.find((x) => x.id === p.active) || { settings: {} };
  const s = cur.settings || {};
  const num = (k, label, min, max) => `<label class="ops-field"><span>${label}</span><input type="number" min="${min}" max="${max}" data-opsset="${k}" value="${esc(s[k])}"></label>`;
  return `<div class="grid two mb">
    <div class="card"><h3>Projects</h3>
      ${p.list.map((x) => `<div class="row ops-prow ${x.id === p.active ? 'on' : ''}"><b style="flex:1">${esc(x.name)}</b><span class="mono faint">${esc(x.dir || 'no folder yet')}</span>${x.id === p.active ? '<span class="badge accent">Open</span>' : `<button class="btn small" data-ops="switch" data-arg="${esc(x.id)}">Switch</button>`}</div>`).join('') || '<div class="empty">Loading…</div>'}
      <div class="row" style="margin-top:10px"><button class="btn small" data-ops="addfolder">Add a project folder</button><input type="text" id="ops-clone" placeholder="owner/repo to clone" style="flex:1"><button class="btn small" data-ops="addclone">Clone</button></div>
      ${local.projectMsg ? `<div class="policy warn">${esc(local.projectMsg)}</div>` : ''}
      <div class="faint ops-note">Each project has its own folder, board, chat, PROJECT.md, test command and settings. Your earlier work is the first project, unchanged.</div></div>
    <div class="card"><h3>This project's settings</h3>
      <label class="ops-field"><span>Test command</span><input type="text" data-opsset="testCommand" value="${esc(s.testCommand ?? '')}" placeholder="${s.testCommand === '' ? 'none' : 'automatic: npm test when package.json has a test script'}" ${s.testCommand === '' ? 'disabled' : ''}></label>
      <label class="ops-check"><input type="checkbox" data-opsset="noTests" ${s.testCommand === '' ? 'checked' : ''}> This project has no tests</label>
      ${num('testTimeoutMin', 'Test time limit (minutes)', 1, 120)}
      ${num('stallMin', 'Stalled after no output or file changes for (minutes, 0 = off)', 0, 240)}
      <label class="ops-check"><input type="checkbox" data-opsset="ciWatch" ${s.ciWatch ? 'checked' : ''}> Watch GitHub Actions for task and release branches (uses your gh sign-in)</label>
      <label class="ops-check"><input type="checkbox" data-opsset="logsOn" ${s.logsOn ? 'checked' : ''}> Hearth logs straight in: each new log in a GitHub repo becomes a “Look at log” task</label>
      <label class="ops-field"><span>Logs repo (layout logs/&lt;date&gt;/&lt;code&gt;.txt)</span><input type="text" data-opsset="logsRepo" value="${esc(s.logsRepo || '')}" placeholder="owner/repo, e.g. Dragongamer9/hearth-logs"></label>
      <label class="ops-field"><span>Next version (only you set it; the lead may release or tag only this one)</span><input type="text" data-opsset="nextVersion" value="${esc(s.nextVersion || '')}" placeholder="e.g. 0.9.0"></label>
      <label class="ops-field"><span>Version file</span><input type="text" data-opsset="versionFile" value="${esc(s.versionFile || 'package.json')}"></label>
      <label class="ops-field"><span>Release command (blank = run .github/workflows/release.yml on main)</span><input type="text" data-opsset="releaseCommand" value="${esc(s.releaseCommand || '')}" placeholder="blank"></label>
      <label class="ops-field"><span>Docs and research runs may only change (comma-separated)</span><input type="text" data-opsset="docsPaths" value="${esc(s.docsPaths || '')}" placeholder="*.md, **/*.md, docs/**, release-notes/**"></label>
      <div class="faint ops-note">Saved for this project and never changed by the app or any AI.</div></div>
  </div>
  <div class="grid two">
    <div class="card"><h3>Project memory <span class="mono faint">.hearth-ai/PROJECT.md</span></h3>
      <p class="muted ops-note">Every AI reads this at the start of each run. AIs don't edit it; the lead can propose changes, which you approve.</p>
      ${local.memory === null ? '<button class="btn small" data-ops="memload">Open PROJECT.md</button>' : `<textarea id="ops-memory" class="mono ops-mem">${esc(local.memory)}</textarea><div class="row"><button class="btn small primary" data-ops="memsave">Save</button>${local.memoryDirty ? '<span class="faint">Unsaved changes</span>' : ''}</div>`}</div>
    <div class="card"><h3>Your phone</h3>${phoneBlock()}</div>
  </div>`;
}

function approvalSettings() {
  return `${levelsCard()}${leadPowersCard()}${identityCard()}`;
}
// Settings › Approvals & safety shows the levels; Team & lead powers and Owner identity show the other two cards.
function levelsCard() {
  const lv = cleanLevels(C.settings().approvalLevels);
  const item = (k) => `<div class="row ops-lv"><span style="flex:1">${esc(CATEGORIES[k].label)}</span>${OWNER_ONLY.includes(k) ? '<span class="badge warn">Owner-only</span>'
    : `<button class="chip ${lv[k] === 'routine' ? 'on' : ''}" data-ops="level" data-arg="${k}" data-val="routine">Routine</button><button class="chip ${lv[k] === 'major' ? 'on' : ''}" data-ops="level" data-arg="${k}" data-val="major">Major</button>`}</div>`;
  return `<div class="card mb ops-levels"><h3>Approval levels</h3>
    <p class="muted ops-note">Routine actions never ask (they are still recorded in the Audit log). Major ones ask you, or the lead while “lead acts for me” is on (never for boot-critical changes or anything touching main, tags or force-pushes). Owner-only ones always need you, except merges, releases and tags when you turn on the lead's switch below. Settings stay yours so no AI can give itself more power. Every AI is told this policy.</p>
    <div class="grid two"><div><div class="sect">Routine or major (you choose)</div>${MOVABLE.map(item).join('')}</div><div><div class="sect">Always yours</div>${OWNER_ONLY.map(item).join('')}</div></div></div>`;
}

function voiceButton() {
  const mic = `<button class="btn ghost ops-mic ${local.rec ? 'rec' : ''}" data-opsmic title="Hold to record a voice note (transcribed on this computer only)">${local.rec ? '● Recording… release to send' : icon('mic', 'sm')}</button>`;
  // 3.7: when nothing here can turn speech into text, an Install button sits beside the mic.
  if (!local.voiceMissing && !local.voiceInstalling) return mic;
  const inst = local.voiceInstalling
    ? `<button class="btn ghost ops-voice-install" disabled title="Installing faster-whisper into this app's folder">${esc(local.voiceInstalling)}…</button>`
    : '<button class="btn ops-voice-install" data-ops="voice-install" title="Installs faster-whisper for this app (about 250 MB, no password needed); your voice stays on this computer">Install speech to text</button>';
  return mic + inst;
}
async function voiceInstall() {
  if (local.voiceInstalling) return;
  local.voiceInstalling = 'Starting';
  C.render();
  const off = C.api?.onOpsVoiceInstallStep?.((label) => { local.voiceInstalling = label; C.render(); });
  const r = await call('opsVoiceInstall');
  if (typeof off === 'function') off();
  local.voiceInstalling = null;
  if (r?.ok) { local.voiceMissing = false; C.toast('Speech to text is installed. Hold the mic to record a voice note.'); }
  else C.toast(r?.message || 'Speech to text couldn\'t be installed.');
  C.render();
}

function suggestHint() {
  const s = suggestFor({ title: '' });
  return { builder: s.builder, reviewer: s.reviewer, html: `<div id="f-suggest" class="faint ops-note">${s.builder ? `Suggested: ${esc(N(s.builder))} builds, ${esc(N(s.reviewer))} reviews (${esc(s.why)}). You can change both.` : ''}</div>` };
}

// ---------- background ----------
async function refreshProjects() {
  const r = await call('opsProjects');
  if (r?.list) local.projects = r;
}
async function pollCi() {
  const st = S();
  const branches = ciBranches(st.tasks, ['release/next']);
  if (!branches.length) return;
  const r = await call('opsCiPoll', branches);
  if (!r?.ok) return;
  let changed = false;
  for (const res of r.results || []) {
    const t = st.tasks.find((x) => x.ws?.branch === res.branch);
    if (!t) continue;
    const a = applyCi(t, res, C.now());
    changed = changed || a.changed;
    if (a.newFailure) { sendBackCi(t, res, a.author); changed = true; }
  }
  if (changed) { await C.save(); C.render(); }
}
function sendBackCi(t, res, author) {
  const text = ciChangesText(res);
  t.ci.log = String(res.tail || '').slice(0, 8000);
  t.notes.push({ at: C.now(), who: 'CI', text, err: true });
  logEv({ ev: 'ci', taskId: t.id, author, ok: false, kind: inferKind(t), sha: res.sha });
  C.audit('CI failed', t.id, `${res.workflow || 'CI'}${res.job ? ` › ${res.job.name}` : ''} at ${short(res.sha)}; sent back to ${N(author)} as CHANGES`, author || 'owner');
  C.requestChanges(t, { by: 'CI', reason: text.slice(0, 500), at: C.now() });
  if (!['intake', 'implementing'].includes(t.stage)) { t.stage = 'implementing'; delete t.reviewVerdict; delete t.reviewWaiting; delete t.done; }
  if (author && C.EDITORS.includes(author) && author !== t.assignee) C.assignTask(t, author, 'wrote the commit that failed CI');
  C.post({ who: 'system', text: `CI failed on T-${t.id} “${t.title}” (${res.job?.name || res.workflow || 'a job'} at ${short(res.sha)}). Sent back to ${N(author)} as CHANGES with the log tail.` });
  if (author && C.EDITORS.includes(author) && C.canRun(author)) C.startOrQueue(t, author);
}
async function pollLogs() {
  const r = await call('opsLogsPoll');
  if (!r?.ok) return;
  if (r.baseline && r.skipped) C.audit('Hearth logs connected', null, `${r.repo}: ${r.skipped} existing logs skipped; new ones become tasks`);
  for (const l of r.created || []) {
    const f = logTask(l);
    const sug = suggestFor({ title: f.title, action: 'docs', labels: f.labels });
    const t = C.makeTask({ ...f, assignee: sug.builder || 'none', reviewer: sug.reviewer || 'none' }, 'Hearth logs');
    if (!t) continue;
    t.labels = f.labels;
    t.log = { code: l.code, date: l.date, file: l.file, path: l.path, summary: l.summary };
    t.notes.push({ at: C.now(), who: 'Hearth logs', text: l.excerpt || '' });
    C.post({ who: 'system', text: `New Hearth log ${l.code} (${l.summary?.device || 'unknown device'}, Hearth OS ${l.summary?.version || '?'}): T-${t.id} “${t.title}” was added to the board.` });
  }
  if (r.created?.length || (r.baseline && r.skipped)) { await C.save(); C.render(); }
}
async function pollUsage() {
  const r = await call('opsUsage', 'google');
  if (r?.ok) { local.usage.google = r; const st = S(); st.opsUsage = { ...(st.opsUsage || {}), google: r }; }
}
async function pushPhone() {
  if (!local.phone?.running) return;
  const st = S();
  await call('opsPhonePush', phoneSnapshot({ state: { ...st, opsCards: cards() }, names: C.NAMES, project: local.projects.list.find((x) => x.id === local.projects.active)?.name || '', startLabel: (t) => { const a = C.actionFor(t); return a && ['start', 'resume'].includes(a.kind) ? a.label : null; }, team: C.team ? C.team() : [] }));
}
async function onPhone(raw) {
  const a = phoneAction(raw);
  if (!a) return;
  const via = ` (from ${String(raw.device || 'phone').slice(0, 40)})`;
  const t = a.id ? S().tasks.find((x) => x.id === a.id) : null;
  C.audit('Phone action', t?.id || null, `${a.type}${a.value && a.type !== 'chat' ? ` ${a.value}` : ''}${via}`);
  if (a.type === 'decide') {
    const may = phoneMayDecide((S().permissions || []).find((p) => p.id === a.id), a.value);
    if (!may.ok) { C.audit('Phone action refused', null, `${a.id}: ${may.reason}${via}`); C.post({ who: 'system', text: `From the phone: ${may.reason}.` }); await C.save(); return C.render(); }
    return C.decide(a.id, a.value, `Owner${via}`);
  }
  if (a.type === 'approve' && t?.stage === 'approval') return fakeClick({ approve: t.id }); // never merges; merge stays on the computer
  if (a.type === 'changes' && t?.stage === 'approval') return fakeClick({ changes: t.id });
  if (a.type === 'start' && t && ['start', 'resume'].includes(C.actionFor(t)?.kind)) return fakeClick({ owneract: t.id });
  if (a.type === 'card') return answerCard(a.id, a.value, via);
  if (a.type === 'chat') { C.ui().draft = a.value; return C.sendChat(); }
}

// ---------- voice ----------
async function startRec() {
  if (local.rec || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { if (!local.rec) C.toast('Recording isn\'t available here.'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const parts = [];
    rec.ondataavailable = (e) => { if (e.data?.size) parts.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((x) => x.stop());
      const blob = new Blob(parts, { type: rec.mimeType || 'audio/webm' });
      if (blob.size < 2000) { C.toast('Too short. Hold the button while you speak.'); return; }
      C.toast('Transcribing on this computer…');
      const r = await call('opsVoiceSave', await blob.arrayBuffer());
      if (!r?.ok) return C.toast(r?.message || 'Could not save the voice note.');
      if (r.canInstall && !r.transcript) local.voiceMissing = true;
      const u = C.ui();
      u.attach.push(r.att);
      const line = r.transcript ? `(voice note) ${r.transcript}` : `(voice note: ${r.note || 'transcription unavailable: press Install speech to text beside the mic'})`;
      u.draft = u.draft ? `${u.draft}\n${line}` : line;
      C.render();
    };
    rec.start();
    local.rec = rec;
    C.render();
  } catch (e) {
    C.toast(`Microphone: ${e.message}`);
  }
}
function stopRec() {
  if (!local.rec) return;
  const r = local.rec;
  local.rec = null;
  try { r.stop(); } catch {}
  C.render();
}

// ---------- action-line results (every line gets a ✓ or ✗) ----------
function attachResult(m, r) { m.results = [...(m.results || []), r].slice(-20); }
function actionResult(agent, line, ok, reason = '', taskId = null) {
  const r = mkResult(line, ok, reason);
  C.audit('Board action', taskId, `${N(agent)} · ${r.line}: ${r.ok ? '✓' : '✗'} ${r.reason}`, agent);
  if (local.turn[agent]) { local.turn[agent].push(r); return r; }
  const st = S();
  const m = [...st.chat].reverse().find((x) => x.who === agent && Date.now() - Date.parse(x.at) < 10 * 60000);
  if (m) attachResult(m, r);
  else C.post({ who: 'system', text: `${N(agent)} · ${r.line}: ${r.ok ? '✓' : '✗'} ${r.reason}` });
  return r;
}
function turnBegin(agent) { local.turn[agent] = []; }
const turnResults = (agent) => [...(local.turn[agent] || [])];
function turnEnd(agent, m) {
  const list = local.turn[agent] || [];
  delete local.turn[agent];
  if (!list.length) return;
  const target = m || [...S().chat].reverse().find((x) => x.who === agent);
  if (target) for (const r of list) attachResult(target, r);
  else C.post({ who: 'system', text: list.map((r) => `${N(agent)} · ${r.line}: ${r.ok ? '✓' : '✗'} ${r.reason}`).join('\n') });
}
function resultsHtml(m) {
  if (!m.results?.length) return '';
  return `<div class="ops-results">${m.results.map((r) => `<div class="${r.ok ? 'ok' : 'no'}"><span>${r.ok ? '✓' : '✗'}</span> <span class="mono">${esc(r.line)}</span> — ${esc(r.reason)}</div>`).join('')}</div>`;
}
function bodyHtml(m) {
  const { progress, body } = splitProgress(m.text);
  if (!progress.length) return esc(m.text);
  return `<details class="ops-working"><summary>working… (${progress.length} step${progress.length > 1 ? 's' : ''})</summary>${progress.map((p) => `<div>${esc(p)}</div>`).join('')}</details>${esc(body)}`;
}
function viewActions() {
  const rows = S().audit.filter((e) => e.event === 'Board action').slice(0, 200);
  return `<div class="card"><h3>Board actions<span class="grow"></span><span class="faint" style="font-size:12px">every action line an AI wrote, with its outcome</span></h3>
    ${rows.map((e) => `<div class="row ops-act ${/: ✓/.test(e.detail) ? 'ok' : 'no'}"><span class="faint">${esc(C.time(e.at))}</span>${C.agentChip(e.actor)}<span style="flex:1">${esc(e.detail)}</span>${e.taskId ? `<button class="btn small link" data-open="${esc(e.taskId)}">T-${esc(e.taskId)}</button>` : ''}</div>`).join('') || '<div class="empty">No action lines yet.</div>'}</div>`;
}

// ---------- @mentions ----------
function mentionNotes(text) {
  for (const u of unknownMentions(text)) C.post({ who: 'system', text: `No teammate called @${u.name}.${u.suggest.length ? ` Did you mean ${u.suggest.join(', ')}?` : ''}` });
}

// ---------- images: who can see them, sizes, upscaling ----------
function imageNotice(agent, media) {
  if (!media?.images?.length) return;
  if (!canSeeImages(agent, C.method(agent) === 'api')) C.post({ who: 'system', text: `${N(agent)} can't see images, so it only got the file names (${media.images.length} image${media.images.length > 1 ? 's' : ''}).` });
}
function attMeta(m, a, i) {
  if (a.kind === 'video') return `<span class="ops-attmeta">${esc(describeMedia(a))}</span>`;
  if (a.kind !== 'image') return '';
  const want = requestedSize(`${m.text || ''} ${linkedTaskText(m)}`);
  const low = belowRequested(a, want);
  return `<span class="ops-attmeta">${esc(describeMedia(a))}${low ? ` <span class="badge warn">below the asked ${want.w}×${want.h}</span>` : ''}
    <span class="ops-up">Upscale ${['1080p', '1440p', '4k'].map((t) => `<button class="btn small link" data-ops="upscale" data-arg="${esc(m.id)}:${i}" data-val="${t}">${t === '4k' ? '4K' : t}</button>`).join('')}</span></span>`;
}
function linkedTaskText(m) {
  const id = String(m.text || '').match(/\bT-([A-Z0-9]{4,10})\b/)?.[1];
  const t = id && S().tasks.find((x) => x.id === id);
  return t ? `${t.title} ${t.description || ''}` : '';
}
async function upscale(ref, target) {
  const [mid, i] = String(ref).split(':');
  const a = S().chat.find((x) => x.id === mid)?.attachments?.[Number(i)];
  if (!a?.path) return;
  C.toast(`Upscaling ${a.name} to ${target === '4k' ? '4K' : target}…`);
  const r = await call('opsUpscale', a.path, target);
  if (!r?.ok) return C.toast(r?.message || 'Upscaling failed.');
  C.post({ who: 'system', text: `Upscaled ${a.name} to ${target === '4k' ? '4K' : target} with ${r.method}. The original is kept.`, attachments: [r.att] });
  C.audit('Image upscaled', null, `${a.name} → ${target} (${r.method})`);
  await C.save();
  C.render();
}

// ---------- checkpoint report ----------
function checkpointLine(agent, cp, taskId = null, extra = '') {
  const text = checkpointReport(cp, N(agent));
  if (!text) return null;
  const t = taskId ? S().tasks.find((x) => x.id === taskId) : null;
  if (t) t.notes.push({ at: C.now(), who: 'Checkpoint', text });
  return C.post({ who: 'system', report: true, text: `${text}${extra}` });
}

// ---------- IMAGE REQUEST and BACKGROUND lines -> background jobs ----------
function capsNow() {
  const st = S();
  return Object.fromEntries(C.AGENT_IDS.map((a) => [a, capabilities(a, { tasks: st.tasks, chat: st.chat, api: C.method(a) === 'api' })]));
}
async function handleLines(agent, text, taskId = null, canEdit = false) {
  const caps = capsNow();
  for (const req of parseImageRequests(text)) {
    const line = `IMAGE REQUEST: ${req.prompt}`;
    const to = pickImageAI(C.EDITORS.filter((a) => a !== agent && C.canRun(a) && C.method(a) !== 'api'), caps);
    if (!to) { actionResult(agent, line, false, 'no teammate with image tools is available', taskId); continue; }
    const id = `IR${C.uid()}`;
    const prompt = `Image request from ${N(agent)}${req.for ? ` (for ${req.for})` : ''}: ${req.prompt}${req.size ? `\nSize: ${req.size}` : ''}\nGenerate the image with your own image tools, save it in $HEARTH_AI_ASSETS, and end with one line: ATTACH: <its path relative to your workspace>. If you have no image tools, say so plainly and do not claim you made one.`;
    const j = await call('opsJobStart', { canEdit, agent: to, kind: 'image', title: `Image for ${N(agent)}: ${req.prompt.slice(0, 80)}`, prompt, taskId, requestId: id });
    if (!j?.id) { actionResult(agent, line, false, j?.message || 'could not start the job', taskId); continue; }
    S().opsRequests = [...(S().opsRequests || []), { id, from: agent, to, prompt: req.prompt, size: req.size, for: req.for, jobId: j.id, at: C.now() }].slice(-50);
    actionResult(agent, line, true, `sent to ${N(to)}${caps[to].imageOut === true ? '' : ' (image output not verified yet)'} as job ${j.id}`, taskId);
    local.jobs = [j, ...local.jobs];
  }
  for (const raw of String(text || '').split('\n')) {
    const m = raw.replace(/^[\s*\-•`>]+/, '').match(/^BACKGROUND:\s*(.{3,2000})$/i);
    if (!m) continue;
    const j = await call('opsJobStart', { canEdit, agent, kind: 'background', title: m[1].slice(0, 120), prompt: `Background job: ${m[1]}\nWork on it fully; your final answer is posted to the team chat. Post files with ATTACH: lines.`, taskId });
    actionResult(agent, `BACKGROUND: ${m[1]}`, Boolean(j?.id), j?.id ? `running as job ${j.id}; the result is posted when it finishes` : j?.message || 'could not start', taskId);
    if (j?.id) local.jobs = [j, ...local.jobs];
  }
}
async function pollJobs() {
  const list = await call('opsJobs');
  if (!Array.isArray(list)) return;
  local.jobs = list;
  const st = S();
  const seen = new Set(st.opsJobsSeen || []);
  let changed = false;
  for (const j of list) {
    if (['running'].includes(j.status) || seen.has(j.id)) continue;
    seen.add(j.id);
    changed = true;
    const req = (st.opsRequests || []).find((r) => r.jobId === j.id);
    const atts = [];
    let text = j.text || '';
    if (j.status === 'done') {
      for (const mm of text.matchAll(/^\s*ATTACH:\s*(\S.*)$/gim)) {
        const r = await call('attachFromAgent', mm[1].trim(), j.base || undefined);
        if (r?.ok) atts.push({ ...r.att, from: mm[1].trim() });
      }
      text = text.replace(/^\s*ATTACH:.*$/gim, '').trim();
    }
    const head = req ? `${N(j.agent)} answered ${N(req.from)}'s image request “${req.prompt.slice(0, 80)}”` : `Background job ${j.id} by ${N(j.agent)} (${j.title})`;
    C.post({ who: j.status === 'done' ? j.agent : 'system', auto: true, attachments: atts.length ? atts : undefined, text: `${head}: ${j.status === 'done' ? (text.slice(0, 1500) || 'done.') : `${j.status}${j.error ? ` — ${j.error.message}` : ''}`}${req && j.status === 'done' && !atts.length ? '\n(No image came back.)' : ''}` });
    C.audit(`Job ${j.status}`, j.taskId, `${j.id} · ${N(j.agent)} · ${j.title}`, j.agent);
  }
  if (changed) { st.opsJobsSeen = [...seen].slice(-200); await C.save(); C.render(); }
}
function jobsCard() {
  const list = local.jobs || [];
  return `<div class="card mb"><h3>Background jobs</h3>${list.map((j) => `<div class="row ops-act"><span class="badge ${{ running: 'accent', done: 'good', failed: 'bad', lost: 'warn', cancelled: '' }[j.status] || ''}">${esc(j.status)}</span>${C.agentChip(j.agent)}<span style="flex:1">${esc(j.title || j.kind)}</span><span class="faint">${esc(C.ago(j.startedAt))}</span>${j.status === 'running' ? `<button class="btn small ghost" data-ops="jobcancel" data-arg="${esc(j.id)}">Cancel</button>` : ''}</div>`).join('') || '<div class="empty">No background jobs. AIs start them with BACKGROUND: or IMAGE REQUEST: lines; they keep running across turns and restarts.</div>'}</div>`;
}

// ---------- capability panel ----------
const yn = (v) => (v === true ? '<span class="badge good">yes</span>' : v === false ? '<span class="badge">no</span>' : '<span class="badge warn">unknown</span>');
function capsCard() {
  const st = S();
  const rows = C.AGENT_IDS.filter((a) => CAPS[a] && (C.connected(a) || a === 'ollama'));
  return `<div class="card mb"><h3>What each AI can do here</h3><table class="ops-table"><thead><tr><th>AI</th><th>Edits</th><th>Commands</th><th>Web</th><th>Sees images</th><th>Makes images</th><th>Image sizes</th><th>Last good run</th></tr></thead><tbody>
    ${rows.map((a) => { const c = capabilities(a, { tasks: st.tasks, chat: st.chat, api: C.method(a) === 'api' }); return `<tr><td>${C.agentChip(a)}</td><td>${yn(c.edits)}</td><td>${yn(c.commands)}</td><td>${yn(c.web)}</td><td title="${esc(c.note || '')}">${yn(c.imageIn)}</td><td>${yn(c.imageOut)}</td><td>${c.sizes ? esc(c.sizes) : '<span class="faint">unknown</span>'}</td><td>${c.lastOk ? esc(C.ago(c.lastOk)) : '<span class="faint">none yet</span>'}</td></tr>`; }).join('')}
  </tbody></table><div class="faint ops-note">From how the app runs each tool plus what was recorded (an image an AI attached from its own assets folder marks image output as working). Unknown means not verified, not no.</div></div>`;
}
function toolsCard() {
  const t = local.tools || {};
  return `<div class="card mb"><h3>Image tools</h3><div class="row"><span style="flex:1">Real-ESRGAN (AI upscaling)</span>${t.esrgan ? '<span class="badge good">installed</span>' : '<button class="btn small" data-ops="esrgan">Install from its GitHub release</button>'}</div>
    <div class="row"><span style="flex:1">ffmpeg (basic resize fallback)</span>${t.ffmpeg ? '<span class="badge good">installed</span>' : '<span class="badge warn">not installed</span>'}</div></div>`;
}

// ---------- Local AI models ----------
function syncLocal() {
  const installed = C.cli().ollama?.models || [];
  const r = resolveLocalModel(S().models?.ollama || null, installed, S().opsLocal?.enabled);
  setLocalConfig({ model: r.use, allowCode: C.settings().localReviewCode === true });
  return r;
}
function localMayReviewTask(t) { const r = syncLocal(); return localMayReview(t, { model: r.use, allowCode: C.settings().localReviewCode === true }); }
function localModels() {
  const c = C.cli().ollama || {};
  const installed = c.models || [];
  const st = S();
  const enabled = st.opsLocal?.enabled || {};
  const r = syncLocal();
  const hw = local.hw || {};
  const isOn = (tag) => enabled[tag] !== false;
  const inst = (tag) => installed.some((m) => m.replace(/:latest$/, '') === tag);
  const fitBadge = (p) => { const f = fitCheck(p, hw); return `<span class="badge ${{ 'fits-gpu': 'good', 'fits-split': 'accent', 'fits-ram': 'good', tight: 'warn', 'too-big': 'bad' }[f.fit] || ''}" title="needs ~${f.needGb ?? '?'} GB">${esc(f.label)}</span>`; };
  const offered = installed.filter((m) => isOn(m.replace(/:latest$/, '')));
  return `<div class="ops-local"><label>Model</label>
    ${offered.length ? `<select data-opslocal>${offered.map((m) => `<option value="${esc(m)}" ${m === r.use ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>` : '<div class="faint">No model installed yet: press Download on one below.</div>'}
    ${r.notice ? `<div class="policy warn">${esc(r.notice)}</div>` : ''}
    <div class="faint ops-note">This computer: ${hw.ramGb ? `${hw.ramGb} GB RAM` : 'RAM unknown'}${hw.discrete ? ` · ${esc(hw.gpu)} graphics card ${hw.vramGb} GB` : hw.gpu ? ` · ${esc(hw.gpu)} (counts as RAM)` : ' · no graphics card memory detected'}</div>
    <table class="ops-table"><tbody>${LOCAL_PRESETS.map((p) => `<tr><td><label class="ops-check" style="margin:0"><input type="checkbox" data-opslocalon="${esc(p.tag)}" ${isOn(p.tag) ? 'checked' : ''}> ${esc(p.label)}</label>${p.note ? `<span class="faint"> ${esc(p.note)}</span>` : ''}</td><td class="faint">~${p.sizeGb} GB</td><td>${fitBadge(p)}</td><td>${inst(p.tag) ? `<span class="badge good">installed</span> <button class="btn small link" data-ops="ollamarm" data-arg="${esc(p.tag)}">Remove</button>` : `<button class="btn small" data-ops="ollamapull" data-arg="${esc(p.tag)}">Download</button>`}</td></tr>`).join('')}
    <tr><td colspan="3"><input type="text" id="ops-local-custom" placeholder="Custom: any Ollama model name, e.g. mistral-nemo:12b"></td><td><button class="btn small" data-ops="ollamapull" data-arg="custom">Download</button></td></tr></tbody></table>
    ${installed.filter((m) => !LOCAL_PRESETS.some((p) => p.tag === m.replace(/:latest$/, ''))).map((m) => `<div class="row"><span class="mono" style="flex:1">${esc(m)}</span><button class="btn small link" data-ops="ollamarm" data-arg="${esc(m)}">Remove</button></div>`).join('')}
    <label class="ops-check"><input type="checkbox" data-opslocalcode ${C.settings().localReviewCode ? 'checked' : ''}> Let the Local AI review code (7B or larger)</label>
    <div class="faint ops-note">With a 7B or larger model the Local AI may review docs tasks${C.settings().localReviewCode ? ' and code' : ''}${paramsOf(r.use) !== null ? ` (now: ${esc(r.use)}, ${paramsOf(r.use)}B)` : ''}. Downloads run in a terminal you can see.</div></div>`;
}

// ---------- lead powers, Next version, owner identity ----------
function docsPaths() { const cur = local.projects.list.find((x) => x.id === local.projects.active); return cur?.settings?.docsPaths || '*.md, **/*.md, docs/**, release-notes/**'; }
function syncPowers() {
  const s = C.settings();
  const p = local.projects.list.find((x) => x.id === local.projects.active);
  return setLeadPowers({ merge: s.leadMerge === true, release: s.leadRelease === true, tag: s.leadTag === true, nextVersion: p?.settings?.nextVersion || '' });
}
function watchRelease(version) {
  local.release = { version, last: '', since: new Date(Date.now() - 60000).toISOString() };
  const tick = async () => {
    if (!local.release || local.release.version !== version) return;
    const r = await call('opsReleaseStatus', version, local.release.since);
    if (!r?.ok) return;
    const now = r.released ? 'released' : r.run ? `${r.run.status}${r.run.conclusion ? ` (${r.run.conclusion})` : ''}` : 'waiting';
    if (now !== local.release.last) {
      local.release.last = now;
      C.post({ who: 'system', text: r.released ? `Release v${version} is published${r.url ? `: ${r.url}` : ''}.` : `Release v${version}: workflow ${now}${r.run?.url ? ` — ${r.run.url}` : ''}.` });
      C.audit('Release progress', null, `v${version}: ${now}`);
      await C.save();
      C.render();
    }
    if (r.released || r.run?.conclusion) { local.release = null; return; }
    setTimeout(tick, 30000);
  };
  setTimeout(tick, 15000);
}
const idText = (id) => (id ? `${id.name} <${id.email}>` : '');
function identityFields(prefix) {
  const s = C.settings();
  const id = s.ownerIdentity || local.identity?.suggested || null;
  return `<label class="ops-field"><span>Name</span><input type="text" id="${prefix}-name" value="${esc(id?.name || '')}" placeholder="e.g. Dragongamer9"></label>
    <label class="ops-field"><span>Your emails, one per line (the first is used for new commits)</span><textarea id="${prefix}-emails" class="mono" style="min-height:70px">${esc((id?.emails || (id?.email ? [id.email] : [])).join('\n'))}</textarea></label>`;
}
function identityCard() {
  const saved = C.settings().ownerIdentity;
  return `<div class="card mb ops-identity"><h3>Owner identity for every commit</h3>
    <p class="muted ops-note">Every commit the app or any AI makes (checkpoints, AI commits in task branches, merges, releases and tags) is made as you. AI attribution lines are stripped, and nothing is pushed, merged, released or tagged if a commit has another author or such a line. Merge commits GitHub made for you (committer GitHub &lt;noreply@github.com&gt;) count as yours.</p>
    ${saved ? '' : '<div class="policy warn">Not confirmed yet: these are suggestions from your git config. Check them and press Confirm.</div>'}
    ${identityFields('ops-identity')}
    <div class="row"><button class="btn small primary" data-ops="identity" data-arg="ops-identity">${saved ? 'Save' : 'Confirm'}</button></div></div>`;
}
// First run after the upgrade: a blocking prompt until the owner confirms (never auto-saved).
function overlay() {
  if (!C || C.settings().ownerIdentity || local.identityLater || !C.api) return '';
  return `<div class="modal-bg ops-overlay"><div class="modal"><h2>Who should every commit be from?</h2>
    <p class="muted" style="font-size:12.5px">The app now makes every commit (yours and the AIs') as you, and checks commits before anything is pushed, merged, released or tagged. These suggestions come from your git config; nothing is saved until you confirm.</p>
    ${identityFields('ops-first')}
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" data-ops="identitylater">Later</button><button class="btn primary" data-ops="identity" data-arg="ops-first">Confirm</button></div></div></div>`;
}
function banner() {
  if (!C) return '';
  const out = [];
  if (!C.settings().ownerIdentity) out.push('<div class="policy warn ops-banner">Your owner identity isn\'t confirmed, so nothing can be pushed, merged, released or tagged yet. <button class="btn small" data-ops="identityopen">Set it now</button></div>');
  for (const which of Object.keys(local.disk || {}).filter((k) => local.disk[k])) out.push(`<div class="policy warn ops-banner">${which === 'settings' ? 'Settings' : 'Project settings (Next version, test command…)'} changed outside the app — keep or discard? Nothing was applied. <button class="btn small" data-ops="diskkeep" data-arg="${which}">Keep the change</button><button class="btn small primary" data-ops="diskdiscard" data-arg="${which}">Discard it</button></div>`);
  if (local.diskNotice) out.push(`<div class="policy warn ops-banner">${esc(local.diskNotice)} <button class="btn small ghost" data-ops="noticeok">OK</button></div>`);
  return out.join('');
}
function leadPowersCard() {
  const s = C.settings();
  const p = syncPowers();
  const sw = (k, label) => `<label class="ops-check"><input type="checkbox" data-opslead="${k}" ${s[k] === true ? 'checked' : ''}> ${label}</label>`;
  return `<div class="card mb"><h3>What the lead may do on its own</h3>
    ${sw('leadMerge', 'Lead may merge to main')}${sw('leadRelease', 'Lead may publish releases (only the version you set)')}${sw('leadTag', 'Lead may create tags (only the version you set)')}
    <div class="faint ops-note">Off by default; only you change them. Merges still need another AI's approving review and the exact approved commit. Releases and tags only for your Next version (${p.nextVersion ? `v${esc(p.nextVersion)}` : 'not set: Project page'}), and only when the version file on main already says it; the lead never edits version numbers. Merges, releases and tags can't be undone. Also needs “lead acts for me”.</div></div>
    ${actForMeCard()}`;
}
// "Claude can do everything I can (asks me first every time)": the owner's switch, and the
// settings Claude changed with his yes (who changed them, with one-click undo).
function actForMeCard() {
  const s = C.settings();
  const log = (S().actLog || []).slice(0, 8);
  return `<div class="card mb" id="act-for-me"><h3>Claude can do everything I can</h3>
    <label class="ops-check"><input type="checkbox" data-opsact ${s.actForMe === true ? 'checked' : ''}> Claude can do everything I can (asks me first every time)</label>
    <div class="faint ops-note">Off by default; only you turn it on or off (no AI or chat line can). When on, Claude may ask to do any of your actions: approve, reject or request changes, merge, push, open a pull request, start, stop or assign tasks, answer permission requests, release or tag your Next version${p0()}, and change settings. Nothing runs until you say yes, every time: Allow in the popup, or type <b>yes</b> (or <b>no</b>) in that chat. Requests expire after 30 minutes, or when the project or chat changes. Version numbers, the updaters and your identity stay yours.</div>
    <div class="faint ops-note"><b>How this fits with the switches above:</b> “lead acts for me” and the three lead switches let the lead act <i>on its own</i>, without asking. This switch is different: Claude asks first, every time, and works even when those are off. If both are on, Claude's own board lines follow the lead switches, and anything it asks with ACT FOR OWNER always waits for your yes.</div>
    ${log.length ? `<div class="sect">Changed by Claude with your yes</div>${log.map((e) => `<div class="row"><span style="flex:1"><span class="mono">${esc(e.key)}</span>: ${esc(JSON.stringify(e.before))} → ${esc(JSON.stringify(e.after))} <span class="faint">· ${esc(e.by)} · ${esc(C.ago(e.at))}${e.scope === 'project' ? ' · this project' : ''}</span></span>${e.undone ? '<span class="badge">Undone</span>' : `<button class="btn small" data-actundo="${esc(e.id)}">Undo</button>`}</div>`).join('')}` : ''}</div>`;
}
const p0 = () => { const n = syncPowers().nextVersion; return n ? ` (now v${esc(n)})` : ''; };

// ---------- events ----------
async function onClick(e) {
  const el = e.target.closest('[data-ops]');
  if (!el) return;
  const { ops: op, arg, val } = el.dataset;
  if (op === 'card') return answerCard(arg, val);
  if (op === 'voice-install') return voiceInstall();
  if (op === 'identity') {
    const name = document.getElementById(`${arg}-name`)?.value.trim() || '';
    const emails = (document.getElementById(`${arg}-emails`)?.value || '').split(/[\s,]+/).filter((e) => /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(e));
    if (!name || !emails.length) return C.toast('Give your name and at least one email.');
    const s2 = await call('setSettings', { ownerIdentity: { name, emails } });
    if (s2 && !s2.message && s2.ownerIdentity) { C.setSettings(s2); await call('opsIdentityApply'); C.audit('Owner identity confirmed', null, `${name} <${emails.join('>, <')}>`); await C.save(); C.toast('Saved. Every commit is made as you.'); }
    return C.render();
  }
  if (op === 'identitylater') { local.identityLater = true; return C.render(); }
  if (op === 'identityopen') { local.identityLater = false; return C.render(); }
  if (op === 'diskkeep' || op === 'diskdiscard') {
    const r = await call('opsDiskResolve', arg, op === 'diskkeep' ? 'keep' : 'discard');
    if (r?.ok) {
      local.disk[arg] = false;
      if (r.settings) C.setSettings(r.settings);
      if (r.list) { local.projects = { active: r.active, list: r.list }; syncPowers(); }
      C.audit(`Owner ${op === 'diskkeep' ? 'kept' : 'discarded'} a ${arg} change made outside the app`);
      await C.save();
    }
    return C.render();
  }
  if (op === 'noticeok') { local.diskNotice = null; return C.render(); }
  if (op === 'checkauthor') { local.guard[arg] = await call('opsCheckTask', arg); return C.render(); }
  if (op === 'rewrite') {
    const r = await call('opsRewriteTask', arg, false);
    C.toast(r?.message || 'Rewrite failed.');
    if (r?.ok) { C.audit('Owner rewrote task authorship', arg, r.message); local.guard[arg] = await call('opsCheckTask', arg); await C.save(); }
    return C.render();
  }
  if (op === 'upscale') return upscale(arg, val);
  if (op === 'jobcancel') { const r = await call('opsJobCancel', arg); if (r?.ok) { C.audit('Owner cancelled a job', r.job?.taskId || null, arg); await pollJobs(); } return C.render(); }
  if (op === 'esrgan') { C.toast('Downloading Real-ESRGAN from its GitHub release…'); const r = await call('opsEsrganInstall'); C.toast(r?.message || 'Install failed.'); if (r?.ok) C.audit('Real-ESRGAN installed', null, r.message); local.tools = await call('opsUpscaleTools'); return C.render(); }
  if (op === 'ollamapull') {
    const tag = arg === 'custom' ? document.getElementById('ops-local-custom')?.value.trim() : arg;
    if (!validTag(tag)) return C.toast('Type an Ollama model name like qwen2.5-coder:7b.');
    const r = await call('opsOllamaPull', tag);
    C.audit('Routine: Local AI model download', null, `ollama pull ${tag} (no approval needed)`);
    return C.toast(r?.ok ? `Downloading ${tag} in ${r.terminal}. Re-check Local AI when it finishes.` : r?.message || 'Could not start the download.');
  }
  if (op === 'ollamarm') {
    if (!confirm(`Remove the local model ${arg}? You can download it again later.`)) return;
    const r = await call('opsOllamaRemove', arg);
    if (r?.ok) C.audit('Local AI model removed', null, arg);
    C.toast(r?.ok ? `Removed ${arg}.` : r?.message || 'Could not remove it.');
    return C.refreshAgents?.();
  }
  if (op === 'seen') { S().opsSeenAt = C.now(); C.audit('Owner marked the summary as seen'); await C.save(); return C.render(); }
  if (op === 'canceltests') { await call('opsTestCancel', arg); return C.toast('Stopping the test run…'); }
  if (op === 'usage') { await pollUsage(); C.toast(local.usage.google ? `agy: ${local.usage.google.usedPct}% used` : 'No CLI reported usage numbers (only agy does).'); return C.render(); }
  if (op === 'level') {
    const r = levelPatch(C.settings().approvalLevels, arg, val);
    if (!r.ok) return C.toast(r.reason);
    const s = await call('setSettings', { approvalLevels: r.saved });
    if (s && !s.message) { C.setSettings(s); setLevels(s.approvalLevels); C.audit('Approval level changed', null, `${CATEGORIES[arg].label}: ${val}`); await C.save(); }
    return C.render();
  }
  if (op === 'switch') {
    const running = Object.keys(C.ui().running || {});
    if (running.length) return C.toast(`Wait until the running task${running.length > 1 ? 's' : ''} (${running.map((id) => `T-${id}`).join(', ')}) finish, or stop them, before switching projects.`);
    // A chat round still answering would post (and save) into the wrong project.
    const busy = C.beforeSwitch?.();
    if (busy) return C.toast(busy);
    const name = (local.projects?.list || []).find((x) => x.id === arg)?.name || 'the project';
    C.toast(`Switching to ${name}…`);
    try {
      await C.save();
      // From here this window saves nothing more (the main process would refuse it anyway).
      C.switching?.(true);
      const r = await call('opsProjectSwitch', arg);
      if (r?.ok) { const rw = C.api?.reloadWindow; if (typeof rw === 'function') rw().catch(() => location.reload()); else location.reload(); return; }
      C.switching?.(false);
      return C.toast(`Could not switch to ${name}: ${r?.message || 'no answer from the app'}`);
    } catch (err) { C.switching?.(false); return C.toast(`Could not switch to ${name}: ${String(err?.message || err)}`); }
  }
  if (op === 'addfolder' || op === 'addclone') {
    const input = op === 'addclone' ? document.getElementById('ops-clone')?.value.trim() : '';
    if (op === 'addclone' && !input) return C.toast('Type owner/repo or a GitHub URL first.');
    const r = await call('opsProjectAdd', op === 'addclone' ? 'clone' : 'folder', input);
    local.projectMsg = r && !r.ok && !r.cancelled ? r.message || 'Could not add it.' : '';
    if (r?.ok) { local.projects = { active: r.active, list: r.list }; C.audit('Project added', null, `${r.project.name} (${r.project.dir})`); }
    return C.render();
  }
  if (op === 'memload') {
    const decisions = S().tasks.filter((t) => t.stage === 'approved').slice(0, 30).map((t) => t.title);
    const r = await call('opsMemoryGet', decisions);
    if (!r?.ok) return C.toast(r?.message || 'Could not open PROJECT.md.');
    local.memory = r.text;
    if (r.seeded) C.audit('PROJECT.md created', null, r.file);
    return C.render();
  }
  if (op === 'memsave') {
    const text = document.getElementById('ops-memory')?.value ?? '';
    const r = await call('opsMemorySave', text);
    if (r?.ok) { local.memory = r.text; local.memoryDirty = false; C.audit('Owner edited PROJECT.md'); await C.save(); C.toast('PROJECT.md saved.'); }
    return C.render();
  }
  const phoneOps = { phoneon: 'opsPhoneEnable', phoneoff: 'opsPhoneDisable', phonecode: 'opsPhoneNewCode', phoneforget: 'opsPhoneForget', phoneremove: 'opsPhoneRemove' };
  if (phoneOps[op]) {
    if (op === 'phoneforget' && !confirm('Turn off the phone view and forget every paired device?')) return;
    const r = await call(phoneOps[op], arg);
    if (r) local.phone = r;
    C.audit({ phoneon: 'Phone view turned on', phoneoff: 'Phone view turned off', phonecode: 'Phone pairing code shown', phoneforget: 'Phone view off, devices forgotten', phoneremove: 'Phone device removed' }[op]);
    await C.save();
    return C.render();
  }
}

async function onChange(e) {
  const el = e.target;
  if (el.matches?.('[data-opsproject]')) { fakeSwitch(el.value); return; }
  if (el.matches?.('[data-opslocal]')) { S().models.ollama = el.value; C.audit('Local AI model chosen', null, el.value); syncLocal(); await C.save(); return C.render(); }
  if (el.dataset?.opslocalon) { const st = S(); st.opsLocal = st.opsLocal || { enabled: {} }; st.opsLocal.enabled = { ...(st.opsLocal.enabled || {}), [el.dataset.opslocalon]: el.checked }; C.audit('Local AI preset turned ' + (el.checked ? 'on' : 'off'), null, el.dataset.opslocalon); await C.save(); return C.render(); }
  if (el.matches?.('[data-opsphonehost]')) { const r = await call('opsPhoneHost', el.value); if (r) local.phone = r; C.audit('Phone view interface chosen', null, el.value); await C.save(); return C.render(); }
  if (el.dataset && 'opsact' in el.dataset) {
    // The main process asks for confirmation in its own dialog before turning it on.
    const s2 = await call('setSettings', { actForMe: el.checked });
    if (s2 && !s2.message) { C.setSettings(s2); C.audit(`"Claude can do everything I can (asks me first)" turned ${s2.actForMe ? 'on' : 'off'}`); await C.save(); }
    else el.checked = !el.checked;
    return C.render();
  }
  if (el.dataset?.opslead) {
    const k = el.dataset.opslead;
    if (el.checked && !confirm({ leadMerge: 'Let the lead merge approved, independently reviewed work into main on its own?', leadRelease: 'Let the lead publish releases (only the Next version you set)?', leadTag: 'Let the lead create tags (only v<Next version>)?' }[k])) { el.checked = false; return; }
    const s2 = await call('setSettings', { [k]: el.checked });
    if (s2 && !s2.message) { C.setSettings(s2); C.audit(`${{ leadMerge: 'Lead may merge to main', leadRelease: 'Lead may publish releases', leadTag: 'Lead may create tags' }[k]} turned ${el.checked ? 'on' : 'off'}`); await C.save(); }
    return C.render();
  }
  if (el.matches?.('[data-opslocalcode]')) { const s2 = await call('setSettings', { localReviewCode: el.checked }); if (s2 && !s2.message) { C.setSettings(s2); C.audit(`Local AI code reviews turned ${el.checked ? 'on' : 'off'}`); syncLocal(); await C.save(); } return C.render(); }
  const k = el.dataset?.opsset;
  if (!k) return;
  let patch;
  if (k === 'noTests') patch = { testCommand: el.checked ? '' : null };
  else if (el.type === 'checkbox') patch = { [k]: el.checked };
  else if (k === 'testCommand') patch = { testCommand: el.value.trim() ? el.value.trim() : null };
  else patch = { [k]: el.type === 'number' ? Number(el.value) : el.value.trim() };
  const r = await call('opsProjectSettings', patch);
  if (r?.list) { local.projects = r; syncPowers(); C.audit('Project setting changed', null, Object.entries(patch).map(([a, b]) => `${a}: ${b === null ? 'automatic' : b}`).join(', ')); await C.save(); }
  else if (r?.message) C.toast(r.message);
  C.render();
}
function fakeSwitch(id) {
  const b = document.createElement('button');
  b.dataset.ops = 'switch';
  b.dataset.arg = id;
  document.body.appendChild(b);
  b.click();
  b.remove();
}

function onInput(e) {
  if (e.target.id === 'ops-memory') { local.memoryDirty = true; local.memory = e.target.value; }
  if (e.target.id === 'f-title' && !local.suggestTouched) {
    const s = suggestFor({ title: e.target.value });
    const a = document.getElementById('f-assignee');
    const r = document.getElementById('f-reviewer');
    if (s.builder && a && [...a.options].some((o) => o.value === s.builder)) a.value = s.builder;
    if (s.reviewer && r && [...r.options].some((o) => o.value === s.reviewer)) r.value = s.reviewer;
    const h = document.getElementById('f-suggest');
    if (h && s.builder) h.textContent = `Suggested for ${s.kind}: ${N(s.builder)} builds, ${N(s.reviewer)} reviews (${s.why}). You can change both.`;
  }
}

export function createOps(ctx) {
  C = ctx;
  return {
    views: { summary: viewSummary, ops: viewOps, project: viewProject, actions: viewActions },
    nav: [['summary', '☾', 'While you were away'], ['ops', '▤', 'Team stats'], ['actions', '≡', 'Board actions'], ['project', '▣', 'Project']],
    titles: {
      summary: ['While you were away', 'What each AI did since you last looked, from the audit log and the board'],
      ops: ['Team stats', 'Budget and headroom, strengths, cost and time per task, and CI'],
      project: ['Project', 'Projects, project memory, tests, CI, Hearth logs and your phone'],
      actions: ['Board actions', 'Every action line an AI wrote, and what came of it'],
    },
    summaryCard, summaryData, approvalCards, approvalSettings, levelsCard, leadPowersCard, identityCard, phoneBlock, capsCard, toolsCard, projectsList: () => local.projects, projectSwitcher, ciBadge, drawerPanel, voiceButton, suggestHint,
    afterRun, checkDone, handoff, recordVerdict, leadLines, auditRoutine, beforeStart, routeQueued,
    snapshot: opsSnapshot,
    overlay, banner, syncPowers, docsPaths, refreshProjects: async () => { await refreshProjects(); syncPowers(); }, watchRelease, actionResult, turnBegin, turnEnd, turnResults, resultsHtml, bodyHtml, mentionNotes, imageNotice, attMeta, checkpointLine, handleLines, localModels, localMayReview: localMayReviewTask, syncLocal,
    async boot() {
      setLevels(C.settings().approvalLevels);
      document.addEventListener('click', onClick);
      document.addEventListener('change', onChange);
      document.addEventListener('input', onInput);
      document.addEventListener('pointerdown', (e) => { if (e.target.closest?.('[data-opsmic]')) { e.preventDefault(); startRec(); } });
      document.addEventListener('pointerup', stopRec);
      document.addEventListener('pointercancel', stopRec);
      document.addEventListener('change', (e) => { if (e.target.id === 'f-assignee' || e.target.id === 'f-reviewer') local.suggestTouched = true; });
      document.addEventListener('click', (e) => { if (e.target.closest?.('[data-new]')) local.suggestTouched = false; }, true);
      C.api?.onOpsPhoneAction?.((a) => onPhone(a));
      await refreshProjects();
      syncPowers();
      { const vt = await call('opsVoiceTools'); if (vt && !vt.tool && vt.canInstall) local.voiceMissing = true; }
      local.identity = await call('opsIdentityDefault');
      const dp = await call('opsDiskPending');
      if (dp) { local.disk = { settings: Boolean(dp.settings), projects: Boolean(dp.projects) }; local.diskNotice = dp.notice || null; }
      C.api?.onOpsDiskChange?.((e) => { if (e?.which) { local.disk[e.which] = true; C.render(); } });
      local.phone = await call('opsPhoneStatus');
      C.render();
      call('opsHardware').then((h) => { if (h) local.hw = h; });
      call('opsUpscaleTools').then((t) => { if (t) local.tools = t; });
      setTimeout(() => { pollCi(); pollLogs(); pollUsage(); pollJobs(); }, 4000);
      setInterval(pollJobs, 10000);
      setInterval(pollCi, 3 * 60000);
      setInterval(pollLogs, 10 * 60000);
      setInterval(pollUsage, 30 * 60000);
      setInterval(pushPhone, 4000);
      setInterval(async () => { if (local.phone?.running) { const s = await call('opsPhoneStatus'); if (s) { const changed = JSON.stringify(s) !== JSON.stringify(local.phone); local.phone = s; if (changed && C.ui().view === 'project') C.render(); } } }, 5000);
    },
  };
}

// Team ops in the window: the "While you were away" page, Team stats (budget,
// strengths, cost and time, CI), the Project page (projects, PROJECT.md, tests, CI,
// logs, phone), approval levels in Settings, voice notes, and the hooks main.js calls
// around task runs. main.js passes its helpers in through createOps(ctx).
import './ops.css';
import { budgets as computeBudgets, pickByHeadroom, nearLimitWarning } from './budget.mjs';
import { buildSummary } from './summary.mjs';
import { inferKind, outcomes, score, suggest, KINDS } from './strength.mjs';
import { taskStats, agentTotals, fmtMs } from './stats.mjs';
import { decideHandoff, askCard, REASON, MAX_HANDOFFS } from './handoff.mjs';
import { ciBranches, applyCi, ciChangesText, CI_LABEL } from './ci.mjs';
import { parseMemoryLines, memoryCard, logTask, phoneSnapshot, phoneAction, opsSnapshot as snapshotOf } from './feeds.mjs';
import { CATEGORIES, MOVABLE, OWNER_ONLY, cleanLevels, levelPatch, setLevels } from './approval.mjs';

let C = null; // the ctx main.js passed in
const local = { projects: { active: 'default', list: [] }, phone: null, voice: null, usage: {}, memory: null, memoryDirty: false, testing: {}, rec: null, suggestTouched: false, projectMsg: '' };

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
  if (t.done) t.done.tests = r.status;
  C.audit(r.status === 'passed' ? 'Tests passed' : r.status === 'failed' ? 'Tests failed' : 'Tests not run', t.id, `${r.command || 'no test command'} at ${short(run.head)}${r.ms ? ` · ${fmtMs(r.ms)}` : ''}${run.claimedTests && run.claimedTests !== r.status ? ` (the AI said: ${run.claimedTests})` : ''}`, agent);
  if (r.status !== 'failed') return null;
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
  return `<div class="card mb"><h3>Budget and headroom<span class="grow"></span><button class="btn small ghost" data-ops="usage">Check usage</button></h3>
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
  if (last) parts.push(`<details class="ops-log"><summary><span class="badge ${{ passed: 'good', failed: 'bad' }[last.appTests] || ''}">App tests: ${esc(last.appTests || 'not run')}</span> <span class="mono faint">${esc(last.testCommand || 'no test command')} · ${esc(short(last.head))}</span>${last.claimedTests && last.claimedTests !== last.appTests ? ` <span class="faint">(the AI said ${esc(last.claimedTests)})</span>` : ''}</summary><pre>${esc(last.testLog || '')}</pre></details>`);
  if (t.ci && t.ci.state !== 'none') parts.push(`<div class="row">${ciBadge(t)}<span class="mono faint">${esc(short(t.ci.sha))}</span>${t.ci.url?.startsWith('https://github.com/') ? `<a class="btn small link" href="${esc(t.ci.url)}" target="_blank">Open run ↗</a>` : ''}</div>${t.ci.log ? `<details class="ops-log"><summary>CI log tail</summary><pre>${esc(t.ci.log)}</pre></details>` : ''}`);
  if (t.handoffs?.length) parts.push(`<div class="faint ops-note">Hand-offs: ${t.handoffs.map((h) => `${esc(N(h.from))} → ${esc(N(h.to))} (${esc(REASON[h.kind] || h.kind)})`).join(' · ')}</div>`);
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
  return `<p class="muted ops-note">A LAN-only web page served by this app: see the board and chat, approve or deny, start tasks, answer cards and get notified. Off by default, never reachable from the internet, no third-party service. Merging into main stays on this computer.</p>
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
      <div class="faint ops-note">Saved for this project and never changed by the app.</div></div>
  </div>
  <div class="grid two">
    <div class="card"><h3>Project memory <span class="mono faint">.hearth-ai/PROJECT.md</span></h3>
      <p class="muted ops-note">Every AI reads this at the start of each run. AIs don't edit it; the lead can propose changes, which you approve.</p>
      ${local.memory === null ? '<button class="btn small" data-ops="memload">Open PROJECT.md</button>' : `<textarea id="ops-memory" class="mono ops-mem">${esc(local.memory)}</textarea><div class="row"><button class="btn small primary" data-ops="memsave">Save</button>${local.memoryDirty ? '<span class="faint">Unsaved changes</span>' : ''}</div>`}</div>
    <div class="card"><h3>Your phone</h3>${phoneBlock()}</div>
  </div>`;
}

function approvalSettings() {
  const lv = cleanLevels(C.settings().approvalLevels);
  const item = (k) => `<div class="row ops-lv"><span style="flex:1">${esc(CATEGORIES[k].label)}</span>${OWNER_ONLY.includes(k) ? '<span class="badge warn">Owner-only</span>'
    : `<button class="chip ${lv[k] === 'routine' ? 'on' : ''}" data-ops="level" data-arg="${k}" data-val="routine">Routine</button><button class="chip ${lv[k] === 'major' ? 'on' : ''}" data-ops="level" data-arg="${k}" data-val="major">Major</button>`}</div>`;
  return `<div class="card mb ops-levels"><h3>Approval levels</h3>
    <p class="muted ops-note">Routine actions never ask (they are still recorded in the Audit log). Major ones ask you, or the lead while “lead acts for me” is on (never for boot-critical changes or anything touching main, tags or force-pushes). Owner-only ones always need you. Every AI is told this policy.</p>
    <div class="grid two"><div><div class="sect">Routine or major (you choose)</div>${MOVABLE.map(item).join('')}</div><div><div class="sect">Always yours</div>${OWNER_ONLY.map(item).join('')}</div></div></div>`;
}

function voiceButton() {
  return `<button class="btn ghost ops-mic ${local.rec ? 'rec' : ''}" data-opsmic title="Hold to record a voice note (transcribed on this computer only)">${local.rec ? '● Recording… release to send' : '🎙'}</button>`;
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
  await call('opsPhonePush', phoneSnapshot({ state: { ...st, opsCards: cards() }, names: C.NAMES, project: local.projects.list.find((x) => x.id === local.projects.active)?.name || '', startLabel: (t) => { const a = C.actionFor(t); return a && ['start', 'resume'].includes(a.kind) ? a.label : null; } }));
}
async function onPhone(raw) {
  const a = phoneAction(raw);
  if (!a) return;
  const via = ` (from ${String(raw.device || 'phone').slice(0, 40)})`;
  const t = a.id ? S().tasks.find((x) => x.id === a.id) : null;
  C.audit('Phone action', t?.id || null, `${a.type}${a.value && a.type !== 'chat' ? ` ${a.value}` : ''}${via}`);
  if (a.type === 'decide') return C.decide(a.id, a.value, `Owner${via}`);
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
      const u = C.ui();
      u.attach.push(r.att);
      const line = r.transcript ? `(voice note) ${r.transcript}` : `(voice note: ${r.note || 'transcription unavailable: install whisper.cpp'})`;
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

// ---------- events ----------
async function onClick(e) {
  const el = e.target.closest('[data-ops]');
  if (!el) return;
  const { ops: op, arg, val } = el.dataset;
  if (op === 'card') return answerCard(arg, val);
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
    if (Object.keys(C.ui().running || {}).length) return C.toast('Wait until the running tasks finish (or stop them) before switching projects.');
    await C.save();
    const r = await call('opsProjectSwitch', arg);
    if (r?.ok) { location.reload(); return; }
    return C.toast(r?.message || 'Could not switch.');
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
  const k = el.dataset?.opsset;
  if (!k) return;
  let patch;
  if (k === 'noTests') patch = { testCommand: el.checked ? '' : null };
  else if (el.type === 'checkbox') patch = { [k]: el.checked };
  else if (k === 'testCommand') patch = { testCommand: el.value.trim() ? el.value.trim() : null };
  else patch = { [k]: el.type === 'number' ? Number(el.value) : el.value.trim() };
  const r = await call('opsProjectSettings', patch);
  if (r?.list) { local.projects = r; C.audit('Project setting changed', null, Object.entries(patch).map(([a, b]) => `${a}: ${b === null ? 'automatic' : b}`).join(', ')); await C.save(); }
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
    views: { summary: viewSummary, ops: viewOps, project: viewProject },
    nav: [['summary', '☾', 'While you were away'], ['ops', '▤', 'Team stats'], ['project', '▣', 'Project']],
    titles: {
      summary: ['While you were away', 'What each AI did since you last looked, from the audit log and the board'],
      ops: ['Team stats', 'Budget and headroom, strengths, cost and time per task, and CI'],
      project: ['Project', 'Projects, project memory, tests, CI, Hearth logs and your phone'],
    },
    summaryCard, approvalCards, approvalSettings, projectSwitcher, ciBadge, drawerPanel, voiceButton, suggestHint,
    afterRun, checkDone, handoff, recordVerdict, leadLines, auditRoutine, beforeStart, routeQueued,
    snapshot: opsSnapshot,
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
      local.phone = await call('opsPhoneStatus');
      C.render();
      setTimeout(() => { pollCi(); pollLogs(); pollUsage(); }, 4000);
      setInterval(pollCi, 3 * 60000);
      setInterval(pollLogs, 10 * 60000);
      setInterval(pollUsage, 30 * 60000);
      setInterval(pushPhone, 4000);
      setInterval(async () => { if (local.phone?.running) { const s = await call('opsPhoneStatus'); if (s) { const changed = JSON.stringify(s) !== JSON.stringify(local.phone); local.phone = s; if (changed && C.ui().view === 'project') C.render(); } } }, 5000);
    },
  };
}

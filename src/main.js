import './styles.css';
import { policyCheck, HEARTH_OS_PIN } from './policy.mjs';
import { recipients, buildPrompt, parseProposals, NAMES } from './chat.mjs';
import { buildTaskBrief, nextAgent, parseStatus, taskRunState, recoverInterrupted, RUN_STATES } from './team.mjs';

const api = window.hearth;

// ---------- constants ----------
const AGENTS = {
  anthropic: { name: 'Claude', vendor: 'Anthropic', cls: 'a-anthropic' },
  openai: { name: 'ChatGPT', vendor: 'OpenAI', cls: 'a-openai' },
  freebuff: { name: 'FreeBuff', vendor: 'FreeBuff', cls: 'a-freebuff' },
  none: { name: 'Unassigned', vendor: '', cls: 'a-none' },
};

const STAGES = {
  intake: 'Intake & policy',
  implementing: 'Implementing',
  checkpoint: 'Checkpoint pushed',
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
  implementing: ['checkpoint', 'Mark checkpoint pushed'],
  checkpoint: ['testing', 'Tests & evidence collected'],
  testing: ['review', 'Send to independent review'],
  review: ['approval', 'Request owner approval'],
};

const ACTIONS = { code: 'Code change', docs: 'Docs', merge: 'Merge', release: 'Release', deploy: 'Deploy' };

// ---------- state ----------
let state = { version: 1, tasks: [], audit: [], models: {}, chat: [], agentStatus: {}, autoHandoff: true };
let ui = { view: 'overview', selected: null, modal: null, busy: {}, draft: '', target: 'all', typing: null, running: {}, saving: {} };
let backups = { recoveredFrom: null, backups: [] };
let settings = { project: null, connection: { anthropic: 'cli', openai: 'cli' }, bins: {} };
let cli = { anthropic: {}, openai: {}, freebuff: {} };
let info = { appVersion: '?', hearthOsVersion: HEARTH_OS_PIN, dataPath: '', electron: '?', packaged: false };
let prov = { encryption: false, weakEncryption: false, defaults: {}, keys: {} };
let upd = { enabled: false, reason: '', status: { state: 'idle' } };
let consoleOut = {};

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const now = () => new Date().toISOString();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const time = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

let saveChain = Promise.resolve();
// Serialized, atomic saves (the main process writes temp -> fsync -> rename).
function save() {
  saveChain = saveChain.then(() => api.saveState(state)).catch((e) => toast(`Could not save: ${cleanErr(e.message)}`));
  return saveChain;
}

function audit(event, taskId, detail = '') {
  state.audit.unshift({ id: uid(), at: now(), actor: 'owner', event, taskId, detail });
}

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 4000);
}

const agentChip = (id) => {
  const a = AGENTS[id] || AGENTS.none;
  return `<span class="agent ${a.cls}"><i></i>${esc(a.name)}</span>`;
};

function runBadge(t) {
  const st = taskRunState(t, { running: Boolean(ui.running[t.id]), saving: Boolean(ui.saving?.[t.id]) });
  if (!st) return '';
  const cls = { running: 'sage', saving: 'sage', limit: 'amber', outage: 'amber', timeout: 'amber', auth: 'red', not_installed: 'red', resume: '' }[st];
  return `<span class="badge ${cls}">${st === 'running' ? '<span class="dot"></span>' : ''}${esc(RUN_STATES[st])}</span>`;
}

function stageBadge(t) {
  if (t.stage === 'approved') return '<span class="badge sage"><span class="dot"></span>Approved</span>';
  if (t.stage === 'rejected') return '<span class="badge red"><span class="dot"></span>Rejected</span>';
  if (!t.policy.ok) return '<span class="badge red">Blocked by policy</span>';
  if (t.stage === 'approval') return '<span class="badge amber">Awaiting you</span>';
  return `<span class="badge">${esc(STAGES[t.stage])}</span>`;
}

// ---------- views ----------
function viewOverview() {
  const open = state.tasks.filter((t) => !['approved', 'rejected'].includes(t.stage));
  const waiting = state.tasks.filter((t) => t.stage === 'approval');
  const ready = ['anthropic', 'openai'].filter(canRun).length + (connected('freebuff') ? 1 : 0);
  const counts = Object.fromEntries(Object.keys(STAGES).map((s) => [s, state.tasks.filter((t) => t.stage === s).length]));
  const flow = ['intake', 'implementing', 'checkpoint', 'testing', 'review', 'approval'];
  return `
    <div class="grid stats">
      <div class="card stat"><div class="n">${open.length}</div><div class="l">Open tasks</div></div>
      <div class="card stat"><div class="n" style="color:var(--amber)">${waiting.length}</div><div class="l">Awaiting your approval</div></div>
      <div class="card stat"><div class="n">${ready}<span class="muted" style="font-size:16px"> / 3</span></div><div class="l">Agents ready</div></div>
      <div class="card stat"><div class="n">${state.audit.length}</div><div class="l">Audit records</div></div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <h3>Governance flow</h3>
      <div class="pipe">
        ${flow.map((s, i) => `<span class="step ${s === 'approval' ? 'gate' : ''}">${esc(STAGES[s])}<b>${counts[s]}</b></span>${i < flow.length - 1 ? '<span class="arrow">→</span>' : ''}`).join('')}
        <span class="arrow">→</span><span class="step">Approved<b>${counts.approved}</b></span>
        <span class="step">Rejected<b>${counts.rejected}</b></span>
      </div>
    </div>
    <div class="grid two">
      <div class="card">
        <h3>Needs you</h3>
        ${waiting.length ? waiting.map(taskRow).join('') : '<div class="empty">Nothing is waiting for your approval.</div>'}
      </div>
      <div class="card">
        <h3>Recent activity</h3>
        ${state.audit.slice(0, 8).map((a) => `<div class="note"><div class="who">${esc(time(a.at))} · ${esc(a.taskId || '')}</div>${esc(a.event)}${a.detail ? ` — <span class="muted">${esc(a.detail)}</span>` : ''}</div>`).join('') || '<div class="empty">No activity yet. Create a task to begin.</div>'}
      </div>
    </div>`;
}

function taskRow(t) {
  return `<div class="task" data-open="${t.id}"><div class="t">${esc(t.title)}</div><div class="meta">${stageBadge(t)}${agentChip(t.assignee)}<span class="badge">${esc(ACTIONS[t.action])}</span></div></div>`;
}

const INSTALL = {
  anthropic: 'npm install -g @anthropic-ai/claude-code',
  openai: 'npm install -g @openai/codex',
  freebuff: 'npm install -g freebuff',
};

function connected(a) {
  if (a === 'freebuff') return Boolean(cli.freebuff.installed);
  if (settings.connection[a] === 'api') return Boolean(prov.keys[a]);
  return Boolean(cli[a].installed && cli[a].signedIn);
}
function outInfo(a) {
  const st = state.agentStatus[a];
  if (!st?.outUntil) return null;
  if (Date.now() > Date.parse(st.outUntil)) return null;
  return st;
}
const canRun = (a) => a !== 'freebuff' && connected(a) && !outInfo(a);
function liveAgents() {
  return ['anthropic', 'openai'].filter(canRun);
}

function markOut(a, err) {
  // Unknown reset time: assume an hour; you can mark it available any time.
  state.agentStatus[a] = { outUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: err?.reset || 'usage limit reached' };
  audit(`${NAMES[a]} ran out of usage`, null, err?.reset || '');
}

const cleanErr = (m) => String(m).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// One way to talk to any agent, whatever it's linked by. Marks agents that run out.
async function callAgent(agent, prompt, opts = {}) {
  let res;
  try {
    res = await api.run({ agent, prompt, model: state.models[agent] || undefined, ...opts });
  } catch (e) {
    res = { ok: false, error: { kind: 'error', message: cleanErr(e.message) } };
  }
  if (!res.ok && res.error.kind === 'limit') markOut(agent, res.error);
  return res;
}

async function refreshAgents() {
  try { settings = await api.settings(); } catch {}
  const list = await Promise.all(['anthropic', 'openai', 'freebuff'].map((a) => api.agentStatus(a).catch(() => ({}))));
  cli = { anthropic: list[0], openai: list[1], freebuff: list[2] };
}

function chatMessage(m) {
  const cls = { owner: 'me', system: 'sys' }[m.who] || '';
  const chip = m.who === 'owner' ? '<b>You</b>' : m.who === 'system' ? '' : agentChip(m.who) + (m.relayed ? '<span class="muted">relayed by you</span>' : '');
  const props = (m.proposals || []).map((p, i) => `<div class="prop">
      <div style="flex:1"><div>${esc(p.title)}</div><div class="meta" style="margin-top:5px">${agentChip(p.assignee)}<span class="muted" style="font-size:11px">review</span>${agentChip(p.reviewer)}<span class="badge">${esc(ACTIONS[p.action])}</span></div></div>
      ${p.taskId ? `<button class="btn small ghost" data-open="${p.taskId}">On board ✓</button>` : `<button class="btn small" data-addprop="${m.id}:${i}">Add to board</button>`}
    </div>`).join('');
  const pending = (m.proposals || []).filter((p) => !p.taskId).length;
  return `<div class="msg ${cls} ${m.err ? 'err' : ''}">
    ${chip ? `<div class="who">${chip}<span class="muted">${esc(time(m.at))}${m.model ? ` · ${esc(m.model)}` : ''}</span></div>` : ''}
    <div class="body">${esc(m.text)}</div>
    ${props ? `<div class="props">${props}${pending > 1 ? `<button class="btn small primary" data-addall="${m.id}" style="margin-top:6px">Add all ${pending}</button>` : ''}</div>` : ''}
  </div>`;
}

function viewChat() {
  const live = liveAgents();
  const target = (id, label) => `<button class="chip ${ui.target === id ? 'on' : ''}" data-target="${id}" ${id !== 'all' && !live.includes(id) ? 'disabled' : ''}>${label}</button>`;
  if (ui.target !== 'all' && ui.target !== 'relay' && !live.includes(ui.target)) ui.target = 'all';
  const label = (a) => (a === 'freebuff' ? (connected(a) ? ' · manual' : ' · not installed') : outInfo(a) ? ' · out of usage' : connected(a) ? '' : ' · not linked');
  const presence = ['anthropic', 'openai', 'freebuff'].map((a) => `<span class="agent ${AGENTS[a].cls}"><i style="${live.includes(a) ? '' : 'opacity:.3'}"></i>${AGENTS[a].name}${label(a)}</span>`).join('');
  return `<div class="chat">
    <div class="chat-top"><div class="row">${presence}</div><span style="flex:1"></span>
      ${state.chat.length ? '<button class="btn small ghost" data-clearchat>Clear chat</button>' : ''}</div>
    <div class="chat-log" id="chat-log">
      ${state.chat.map(chatMessage).join('') || `<div class="empty" style="padding:30px">Say hi, or try: <i>"Here's the plan for Hearth's settings page — split it into tasks between you."</i><br><br>
        Everyone sees every message. Use <b>@claude</b> or <b>@chatgpt</b> to talk to one agent. When agents propose tasks you can add them to the board, where they go through the usual policy check and your approval.
        ${live.length ? '' : '<br><br><span style="color:var(--amber)">No agents are linked yet — link your accounts on the Agents page.</span>'}</div>`}
      ${ui.typing ? `<div class="msg typing">${agentChip(ui.typing)} <span class="muted">is replying…</span></div>` : ''}
    </div>
    <div class="chat-input">
      <div class="row" style="margin-bottom:8px"><span class="muted" style="font-size:12px">Send to</span>${target('all', 'Everyone')}${target('anthropic', 'Claude')}${target('openai', 'ChatGPT')}<span style="flex:1"></span><button class="chip ${ui.target === 'relay' ? 'on' : ''}" data-target="relay" title="Paste what FreeBuff said so everyone can see it">Post as FreeBuff</button></div>
      <div class="row" style="align-items:flex-end">
        <textarea id="chat-text" placeholder="Message the team…  (Enter to send, Shift+Enter for a new line)" style="flex:1;min-height:52px">${esc(ui.draft)}</textarea>
        <button class="btn primary" data-sendchat ${ui.typing ? 'disabled' : ''}>Send</button>
      </div>
    </div>
  </div>`;
}

async function sendChat() {
  const text = ui.draft.trim();
  if (!text || ui.typing) return;
  if (ui.target === 'relay') {
    state.chat.push({ id: uid(), at: now(), who: 'freebuff', text: text.slice(0, 8000), relayed: true, proposals: parseProposals(text) });
    ui.draft = '';
    trimChat();
    save();
    return render();
  }
  const live = liveAgents();
  const who = recipients(text, live, ui.target);
  state.chat.push({ id: uid(), at: now(), who: 'owner', text: text.slice(0, 8000) });
  ui.draft = '';
  if (/@freebuff/i.test(text)) state.chat.push({ id: uid(), at: now(), who: 'system', text: 'FreeBuff only runs interactively, so it can’t answer in chat by itself. Open it from a task, then use “Post as FreeBuff” to share what it says.' });
  if (!who.length) state.chat.push({ id: uid(), at: now(), who: 'system', text: live.length ? 'That agent isn’t available right now (not linked or out of usage).' : 'No agents are available. Link Claude or ChatGPT on the Agents page.' });
  trimChat();
  save();
  render();
  const queue = [...who];
  const answered = [];
  while (queue.length) {
    const agent = queue.shift();
    if (!canRun(agent)) continue;
    ui.typing = agent;
    render();
    const res = await callAgent(agent, buildPrompt(agent, state.chat), { mode: 'read' });
    if (res.ok) {
      answered.push(agent);
      state.chat.push({ id: uid(), at: now(), who: agent, text: res.text, model: res.via, proposals: parseProposals(res.text) });
    } else if (res.error.kind === 'limit') {
      const sub = nextAgent(liveAgents(), [...answered, ...queue, agent]);
      const still = queue.filter(canRun);
      const after = sub ? ` ${NAMES[sub]} is picking up its turn.` : still.length ? ` ${still.map((x) => NAMES[x]).join(' and ')} will carry on.` : ' No other agent is free right now.';
      state.chat.push({ id: uid(), at: now(), who: 'system', text: `${NAMES[agent]} is out of usage${res.error.reset ? ` (${res.error.reset})` : ''}.${after}` });
      if (sub) queue.push(sub);
    } else {
      state.chat.push({ id: uid(), at: now(), who: agent, text: `${res.error.kind}: ${res.error.message}`, err: true });
    }
    trimChat();
    save();
  }
  ui.typing = null;
  render();
}

function trimChat() {
  if (state.chat.length > 300) state.chat = state.chat.slice(-300);
}

function addProposal(msgId, i) {
  const m = state.chat.find((x) => x.id === msgId);
  const p = m?.proposals?.[i];
  if (!p || p.taskId) return;
  const t = makeTask({ ...p, description: `Proposed by ${NAMES[m.who]} in Team chat.` }, NAMES[m.who]);
  if (t) p.taskId = t.id;
}

function viewBoard() {
  return `<div class="board">${COLUMNS.map((c) => {
    const items = state.tasks.filter((t) => c.stages.includes(t.stage));
    return `<div class="col"><div class="col-h">${esc(c.title)}<span class="n">${items.length}</span></div>
      ${items.map((t) => `<div class="task ${ui.selected === t.id ? 'sel' : ''}" data-open="${t.id}">
        <div class="t">${esc(t.title)}</div>
        <div class="meta">${stageBadge(t)}${runBadge(t)}${agentChip(t.assignee)}</div>
      </div>`).join('') || '<div class="empty">Empty</div>'}
    </div>`;
  }).join('')}</div>`;
}

function viewApprovals() {
  const waiting = state.tasks.filter((t) => t.stage === 'approval');
  const decided = state.tasks.filter((t) => ['approved', 'rejected'].includes(t.stage));
  return `
    <div class="card" style="margin-bottom:14px">
      <h3>Awaiting owner approval</h3>
      ${waiting.map((t) => `<div class="task" data-open="${t.id}" style="cursor:default">
        <div class="t">${esc(t.title)}</div>
        <div class="meta" style="margin-bottom:10px">${agentChip(t.assignee)}<span class="muted" style="font-size:12px">reviewed by</span>${agentChip(t.reviewer)}<span class="badge">${esc(ACTIONS[t.action])}</span></div>
        ${t.policy.warn.length ? `<div class="policy warn">${t.policy.warn.map(esc).join('<br>')}</div>` : ''}
        <div class="row">
          <button class="btn primary small" data-approve="${t.id}">Approve</button>
          <button class="btn small" data-changes="${t.id}">Request changes</button>
          <button class="btn danger small" data-reject="${t.id}">Reject</button>
          <button class="btn ghost small" data-open="${t.id}">Details</button>
        </div></div>`).join('') || '<div class="empty">Nothing to approve.</div>'}
    </div>
    <div class="card"><h3>Decisions</h3>
      ${decided.map(taskRow).join('') || '<div class="empty">No decisions recorded yet.</div>'}
    </div>`;
}

function providerCard(id) {
  const a = AGENTS[id];
  const c = cli[id] || {};
  const method = id === 'freebuff' ? 'cli' : settings.connection[id];
  const out = outInfo(id);
  const res = consoleOut[id];
  const tool = { anthropic: 'Claude Code', openai: 'Codex CLI', freebuff: 'FreeBuff CLI' }[id];
  const plan = { anthropic: 'your Claude subscription', openai: 'your ChatGPT account', freebuff: 'your free FreeBuff account' }[id];
  let status;
  if (out) status = `<span class="badge red">Out of usage — ${esc(out.reason)}</span>`;
  else if (method === 'api') status = prov.keys[id] ? '<span class="badge sage"><span class="dot"></span>Linked (API key)</span>' : '<span class="badge amber">No API key</span>';
  else if (!c.installed) status = '<span class="badge amber">Not installed</span>';
  else if (id === 'freebuff') status = '<span class="badge sage"><span class="dot"></span>Installed · runs in a terminal</span>';
  else status = c.signedIn ? '<span class="badge sage"><span class="dot"></span>Linked (signed in)</span>' : '<span class="badge amber">Installed · not signed in</span>';

  const methodToggle = id === 'freebuff' ? '' : `<div class="row" style="margin:10px 0"><span class="muted" style="font-size:12px">Link with</span>
      <button class="chip ${method === 'cli' ? 'on' : ''}" data-method="${id}:cli">Account (${tool})</button>
      <button class="chip ${method === 'api' ? 'on' : ''}" data-method="${id}:api">API key</button></div>`;

  const cliBlock = `
    <p>Uses ${tool} on this computer, signed in with ${esc(plan)}${id === 'freebuff' ? '' : ' — no API credit needed'}.</p>
    ${c.installed ? `<div class="kv" style="margin:6px 0"><span class="k">Program</span><span class="mono" style="font-size:11.5px;word-break:break-all">${esc(c.path)}</span></div>`
      : `<p class="muted">Install it, then press Re-check:<br><code class="mono">${esc(INSTALL[id])}</code></p>`}
    <div class="row">
      ${c.installed && id !== 'freebuff' ? `<button class="btn small ${c.signedIn ? '' : 'primary'}" data-login="${id}">${c.signedIn ? 'Switch account' : 'Sign in'}</button>` : ''}
      ${c.installed && id === 'freebuff' ? `<button class="btn small" data-login="${id}">Open FreeBuff (sign in)</button>` : ''}
      <button class="btn small ghost" data-recheck>Re-check</button>
      <button class="btn small ghost" data-locate="${id}">Locate program…</button>
    </div>
    ${id === 'freebuff' ? '<p class="muted" style="margin-top:12px">FreeBuff has no non-interactive mode, so it works hands-on: from any task, “Continue in FreeBuff” opens it in that task’s shared workspace with the full handoff brief on your clipboard. Share its replies in Team chat with “Post as FreeBuff”.</p>' : ''}`;

  const apiBlock = `
    <p>Uses the official ${esc(a.vendor)} API (billed per use). The key is encrypted with your OS keyring. API-linked agents can plan and review but not edit files.</p>
    <div class="row"><input type="password" id="key-${id}" placeholder="${prov.keys[id] ? '•••••••• saved — paste to replace' : 'Paste API key'}" autocomplete="off" style="flex:1">
      <button class="btn small" data-savekey="${id}">Save</button>
      ${prov.keys[id] ? `<button class="btn danger small" data-rmkey="${id}">Remove</button>` : ''}</div>`;

  return `<div class="card prov">
    <h4><span class="agent ${a.cls}"><i></i></span>${esc(a.name)} <span class="muted" style="font-size:12px;font-weight:400">${esc(a.vendor)}</span></h4>
    <div class="row" style="margin:10px 0">${status}${out ? `<button class="btn small" data-available="${id}">Mark available</button>` : ''}</div>
    ${methodToggle}
    ${method === 'api' ? apiBlock : cliBlock}
    ${id !== 'freebuff' ? `
      <label>Model <span class="muted">(optional${method === 'cli' ? ' — blank uses the CLI default' : ''})</span></label>
      <input type="text" id="model-${id}" value="${esc(state.models[id] || '')}" placeholder="${method === 'api' ? esc(prov.defaults[id] || '') : 'default'}" data-model="${id}">
      <label>Quick test</label>
      <textarea id="prompt-${id}" placeholder="Ask ${esc(a.name)} something…" style="min-height:56px"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn primary small" data-ask="${id}" ${ui.busy[id] || !canRun(id) ? 'disabled' : ''}>${ui.busy[id] ? 'Waiting…' : 'Send'}</button></div>
      ${res ? `<div class="console-out note ${res.ok ? '' : 'err'}">${res.ok ? esc(res.text) : `${esc(res.error.kind)}: ${esc(res.error.message)}`}</div>` : ''}` : ''}
  </div>`;
}

function viewAgents() {
  const warn = settings.connection.anthropic === 'api' || settings.connection.openai === 'api'
    ? (!prov.encryption ? '<div class="policy block">No OS keyring available (GNOME Keyring / KWallet), so API keys can’t be stored securely. Account linking (the default) doesn’t need one.</div>'
      : prov.weakEncryption ? '<div class="policy warn">No desktop keyring detected; API keys use weak fallback encryption.</div>' : '')
    : '';
  const proj = settings.project
    ? `<div class="policy ok">Shared project folder: <span class="mono">${esc(settings.project)}</span></div>`
    : '<div class="policy warn">Pick a shared project folder in Settings so agents can work on tasks together.</div>';
  return `${warn}${proj}<div class="grid agents">${['anthropic', 'openai', 'freebuff'].map(providerCard).join('')}</div>`;
}

function viewAudit() {
  return `<div class="card">
    <div class="row" style="margin-bottom:10px"><h3 style="margin:0;flex:1">Append-only audit record</h3>
      <button class="btn small" data-export>Export everything</button></div>
    <table><thead><tr><th>When</th><th>Task</th><th>Event</th><th>Detail</th></tr></thead><tbody>
    ${state.audit.map((a) => `<tr><td class="mono">${esc(time(a.at))}</td><td class="mono">${esc(a.taskId || '—')}</td><td>${esc(a.event)}</td><td class="muted">${esc(a.detail)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No records yet.</td></tr>'}
    </tbody></table></div>`;
}

function updateBlock() {
  const s = upd.status || {};
  if (!upd.enabled) return `<p class="muted">${esc(upd.reason || 'Updates unavailable.')}</p>`;
  const msg = {
    idle: 'Not checked yet.',
    checking: 'Checking GitHub Releases…',
    none: s.message || 'You are on the latest version.',
    available: `Version ${s.version} is available.`,
    downloading: `Downloading… ${s.percent || 0}%`,
    ready: `Version ${s.version} downloaded. Restart when you're ready.`,
    error: s.message || 'Update failed.',
  }[s.state] || '';
  return `
    <p class="${s.state === 'error' ? '' : 'muted'}" style="${s.state === 'error' ? 'color:var(--red)' : ''}">${esc(msg)}</p>
    ${s.state === 'downloading' ? `<div class="progress"><div style="width:${s.percent || 0}%"></div></div>` : ''}
    <div class="row">
      <button class="btn small" data-upd="check" ${['checking', 'downloading'].includes(s.state) ? 'disabled' : ''}>Check for updates</button>
      ${s.state === 'available' ? '<button class="btn primary small" data-upd="download">Download update</button>' : ''}
      ${s.state === 'ready' ? '<button class="btn primary small" data-upd="install">Restart & install</button>' : ''}
    </div>`;
}

function viewSettings() {
  return `<div class="grid two">
    <div class="card"><h3>App updates</h3>
      <div class="kv"><span class="k">Installed</span><span class="mono">${esc(info.appVersion)}</span>
      <span class="k">Channel</span><span>GitHub Releases (published releases only)</span></div>
      ${updateBlock()}
    </div>
    <div class="card"><h3>Shared workspace</h3>
      <div class="kv"><span class="k">Project folder</span><span class="mono" style="word-break:break-all">${esc(settings.project || 'Not set')}</span></div>
      <p class="muted" style="font-size:13px;line-height:1.5">A git repository all agents share. Each task gets its own branch and working copy; every agent run is committed as a checkpoint so nothing is lost. Nothing is ever pushed or merged for you.</p>
      <div class="row"><button class="btn small primary" data-pickproject>${settings.project ? 'Change folder' : 'Choose folder'}</button></div>
      <div class="sep"></div>
      <label style="display:flex;gap:10px;align-items:center;margin:0;cursor:pointer"><input type="checkbox" data-autohandoff ${state.autoHandoff ? 'checked' : ''}> Automatically hand a task to the next free agent when one runs out of usage</label>
    </div>
    <div class="card"><h3>Saved work & backups</h3>
      <p class="muted" style="font-size:13px;line-height:1.5">Everything is saved automatically and atomically, with the last ${backups.backups.length || 10} versions kept. Code progress also lives in git checkpoints on each task branch.</p>
      ${backups.recoveredFrom ? `<div class="policy warn">The latest save was damaged, so it was set aside and your work was restored from ${esc(backups.recoveredFrom)}.</div>` : ''}
      ${backups.lost ? '<div class="policy block">No readable save was found; starting fresh. Damaged files were kept next to the data folder.</div>' : ''}
      ${backups.backups.slice(0, 6).map((b) => `<div class="row" style="font-size:12.5px;margin:4px 0"><span class="mono muted" style="width:20px">${b.n}</span><span style="flex:1">${b.ok ? `${esc(time(b.savedAt))} · ${b.tasks} task${b.tasks === 1 ? '' : 's'}` : '<span style="color:var(--red)">unreadable</span>'}</span>${b.ok ? `<button class="btn small ghost" data-restore="${b.n}">Restore</button>` : ''}</div>`).join('') || '<div class="empty">No earlier versions yet.</div>'}
      <div class="row" style="margin-top:10px"><button class="btn small" data-export>Export everything</button></div>
    </div>
    <div class="card"><h3>Hearth OS</h3>
      <div class="kv"><span class="k">Pinned version</span><span class="mono" style="color:var(--sage-2)">${esc(info.hearthOsVersion)}</span>
      <span class="k">Policy</span><span>Read-only. This app never changes Hearth OS, merges, releases or deploys. Version numbers are chosen by you.</span></div>
    </div>
    <div class="card"><h3>Local data</h3>
      <div class="kv"><span class="k">Folder</span><span class="mono" style="word-break:break-all">${esc(info.dataPath)}</span>
      <span class="k">Electron</span><span class="mono">${esc(info.electron)}</span></div>
      <button class="btn danger small" data-reset>Clear tasks & audit log</button>
    </div>
    <div class="card"><h3>About this build</h3>
      <p class="muted" style="line-height:1.55">Real: account-linked Claude (Claude Code) and ChatGPT (Codex) working in a shared git workspace, automatic checkpoints and out-of-usage handoff, FreeBuff in a terminal on the same workspace, team chat, policy checks, approvals, audit log, in-app updates. Not yet: GitHub PR tracking, executing approved merges/releases.</p>
    </div>
  </div>`;
}

function workControls(t) {
  const running = ui.running[t.id];
  if (running) {
    return `<div class="policy ok" style="display:flex;align-items:center;gap:10px">${agentChip(running.agent)} is working in the shared workspace…<span style="flex:1"></span><button class="btn small danger" data-stop="${t.id}">Stop</button></div>`;
  }
  const others = ['anthropic', 'openai'].filter((a) => a !== t.assignee);
  const ws = t.ws ? `<div class="kv"><span class="k">Workspace</span><span><span class="mono" style="font-size:12px">${esc(t.ws.branch)}</span> <button class="btn small ghost" data-openws="${t.id}">Open folder</button></span></div>` : '';
  return `${ws}<div class="row" style="margin:8px 0">
      ${['anthropic', 'openai'].includes(t.assignee) ? `<button class="btn primary small" data-run="${t.id}:${t.assignee}" ${canRun(t.assignee) ? '' : 'disabled'}>${t.runs?.length ? 'Continue' : 'Start'} with ${esc(AGENTS[t.assignee].name)}</button>` : ''}
      ${others.map((a) => `<button class="btn small" data-run="${t.id}:${a}" ${canRun(a) ? '' : 'disabled'}>Hand off to ${esc(AGENTS[a].name)}</button>`).join('')}
      <button class="btn small" data-freebuff="${t.id}">Continue in FreeBuff</button>
      ${t.freebuffOpen ? `<button class="btn small primary" data-fbdone="${t.id}">FreeBuff finished — checkpoint</button>` : ''}
    </div>
    <div class="row">
      ${['anthropic', 'openai'].includes(t.reviewer) ? `<button class="btn small ghost" data-opinion="${t.id}" ${canRun(t.reviewer) && !ui.busy[t.id] ? '' : 'disabled'}>${ui.busy[t.id] === 'opinion' ? 'Reviewing…' : `Independent review by ${esc(AGENTS[t.reviewer].name)}`}</button>` : ''}
      ${!settings.project ? '<span class="muted" style="font-size:12px">Set a project folder in Settings to start work.</span>' : ''}
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
  return `<div class="drawer">
    <div class="row"><span class="mono muted">T-${esc(t.id)}</span><span style="flex:1"></span><button class="btn ghost small" data-close>Close ✕</button></div>
    <h2>${esc(t.title)}</h2>
    <div class="row">${stageBadge(t)}${runBadge(t)}<span class="badge">${esc(ACTIONS[t.action])}</span></div>
    ${pol}
    <div class="kv">
      <span class="k">Stage</span><span>${esc(STAGES[t.stage])}</span>
      <span class="k">Implementer</span><span>${agentChip(t.assignee)}</span>
      <span class="k">Reviewer</span><span>${agentChip(t.reviewer)}</span>
      <span class="k">Created</span><span>${esc(time(t.createdAt))}</span>
    </div>
    ${t.description ? `<div class="note">${esc(t.description)}</div>` : ''}
    ${!closed && t.policy.ok ? `<div class="row" style="margin:12px 0">
      ${next ? `<button class="btn primary small" data-advance="${t.id}">${esc(next[1])}</button>` : ''}
      ${t.stage === 'approval' ? `<button class="btn primary small" data-approve="${t.id}">Approve</button><button class="btn small" data-changes="${t.id}">Request changes</button><button class="btn danger small" data-reject="${t.id}">Reject</button>` : ''}
    </div>` : ''}
    ${t.policy.ok && !closed ? workControls(t) : ''}
    ${t.runs?.length ? `<div class="sep"></div><h3 class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.6px">Shared progress</h3>
      ${t.runs.slice().reverse().map((r) => `<div class="note ${['limit', 'failed', 'error', 'timeout', 'not_installed', 'auth', 'no_workspace'].includes(r.status) ? 'err' : ''}"><div class="who">${esc(NAMES[r.agent])} · ${esc(r.status)}${r.via ? ` · ${esc(r.via)}` : ''} · ${esc(time(r.at))}${r.checkpoint ? ` · checkpoint <span class="mono">${esc(r.checkpoint)}</span>` : ''}</div>${esc(r.output ? (r.output.length > 1500 ? `${r.output.slice(0, 1500)}…` : r.output) : r.status === 'running' ? 'Working…' : '')}</div>`).join('')}` : ''}
    <div class="sep"></div>
    <h3 class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.6px">Notes</h3>
    ${t.notes.map((n) => `<div class="note ${n.err ? 'err' : ''}"><div class="who">${esc(n.who)} · ${esc(time(n.at))}</div>${esc(n.text)}</div>`).join('') || '<div class="empty">No notes yet.</div>'}
    <textarea id="note-text" placeholder="Add a note…" style="min-height:60px"></textarea>
    <div class="row" style="margin-top:8px"><button class="btn small" data-note="${t.id}">Add note</button>
      ${!closed ? `<span style="flex:1"></span><button class="btn danger small" data-delete="${t.id}">Delete task</button>` : ''}</div>
  </div>`;
}

function modal() {
  if (ui.modal !== 'new') return '';
  const opt = (sel) => Object.entries(AGENTS).map(([k, a]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  return `<div class="modal-bg" data-modalbg><div class="modal">
    <h2>New task</h2><div class="muted" style="font-size:13px">Runs a policy & scope check when created.</div>
    <label>Title</label><input type="text" id="f-title" placeholder="e.g. Add update toast to Hearth settings">
    <label>Description</label><textarea id="f-desc" placeholder="What should be done, constraints, acceptance criteria"></textarea>
    <div class="two-in">
      <div><label>Implementer</label><select id="f-assignee">${opt('anthropic')}</select></div>
      <div><label>Independent reviewer</label><select id="f-reviewer">${opt('openai')}</select></div>
    </div>
    <label>Action type</label><select id="f-action">${Object.entries(ACTIONS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
    <div class="row" style="margin-top:18px;justify-content:flex-end"><button class="btn ghost" data-cancel>Cancel</button><button class="btn primary" data-create>Create task</button></div>
  </div></div>`;
}

const NAV = [
  ['overview', '◈', 'Overview'],
  ['chat', '❖', 'Team chat'],
  ['board', '▦', 'Task board'],
  ['approvals', '✓', 'Approvals'],
  ['agents', '✦', 'Agents'],
  ['audit', '☰', 'Audit log'],
  ['settings', '⚙', 'Settings'],
];
const TITLES = {
  overview: ['Command Center', 'Coordinate Claude, ChatGPT and FreeBuff under your approval'],
  chat: ['Team chat', 'You, Claude, ChatGPT and FreeBuff in one room — everyone sees everything'],
  board: ['Task board', 'Owner → policy → agent → checkpoint → tests → review → approval'],
  approvals: ['Approvals', 'Nothing high-impact happens without your explicit sign-off'],
  agents: ['Agents', 'Link your Claude, ChatGPT and FreeBuff accounts'],
  audit: ['Audit log', 'Every decision, recorded'],
  settings: ['Settings', 'Updates, data and Hearth OS pin'],
};

function render() {
  const waiting = state.tasks.filter((t) => t.stage === 'approval').length;
  const views = { chat: viewChat, overview: viewOverview, board: viewBoard, approvals: viewApprovals, agents: viewAgents, audit: viewAudit, settings: viewSettings };
  const [title, sub] = TITLES[ui.view];
  const updBadge = upd.status?.state === 'available' || upd.status?.state === 'ready' ? '<span class="badge sage" data-nav="settings" style="cursor:pointer">Update available</span>' : '';
  document.getElementById('app').innerHTML = `
  <div class="shell">
    <aside class="side">
      <div class="brand"><img src="./icon.png" alt=""><div><b>Hearth AI</b><span>Command Center</span></div></div>
      ${NAV.map(([id, ico, label]) => `<button class="nav ${ui.view === id ? 'on' : ''}" data-nav="${id}"><span class="ico">${ico}</span>${label}${id === 'approvals' && waiting ? `<span class="count">${waiting}</span>` : ''}</button>`).join('')}
      <div class="spacer"></div>
      <div class="pin">Hearth OS pinned <b>${esc(info.hearthOsVersion)}</b><br><span style="font-size:11px">App v${esc(info.appVersion)}</span></div>
    </aside>
    <main class="main">
      <div class="top"><div><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div><div class="grow"></div>
        ${updBadge}<span class="badge amber">Prototype</span>
        <button class="btn primary" data-new>+ New task</button></div>
      ${views[ui.view]()}
    </main>
  </div>${drawer()}${modal()}`;
  const log = document.getElementById('chat-log');
  if (log) log.scrollTop = log.scrollHeight;
  const box = document.getElementById('chat-text');
  if (box && !ui.modal && !ui.selected) {
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }
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
    assignee: AGENTS[assignee] ? assignee : 'none',
    reviewer: AGENTS[reviewer] ? reviewer : 'none',
    action: ACTIONS[action] ? action : 'code',
    stage: 'intake',
    notes: [],
    createdAt: now(),
    updatedAt: now(),
  };
  t.policy = policyCheck(t);
  if (!t.policy.ok && t.policy.block.some((b) => b.startsWith('Looks like it contains'))) {
    toast('That task text contains something that looks like a secret. Remove it first.');
    return null;
  }
  state.tasks.unshift(t);
  audit('Task created', t.id, source === 'Owner' ? t.title : `${t.title} (proposed by ${source} in Team chat)`);
  audit(t.policy.ok ? 'Policy check passed' : 'Policy check blocked', t.id, [...t.policy.block, ...t.policy.warn].join(' '));
  return t;
}

function createTask() {
  const v = (id) => document.getElementById(id).value;
  const title = v('f-title').trim();
  if (!title) return toast('Give the task a title.');
  const t = makeTask({ title, description: v('f-desc'), assignee: v('f-assignee'), reviewer: v('f-reviewer'), action: v('f-action') });
  if (!t) return;
  ui.modal = null;
  ui.selected = t.id;
  save();
  render();
}

async function askForTask(t, kind) {
  const who = t.reviewer;
  let summary = '';
  if (t.ws) summary = await api.workspaceSummary(t.id, t.ws.baseSha).catch(() => '');
  const prompt = `You are an independent reviewer (${NAMES[who]}) in the Hearth AI Command Center. Look at the task's workspace (your current directory) and the shared progress below. List concerns, missing tests, and whether the owner should approve. Be concise. Do not modify files.\n\n${buildTaskBrief({ task: t, agent: who, summary })}`;
  ui.busy[t.id] = kind;
  render();
  const res = await callAgent(who, prompt, { mode: 'read', taskId: t.ws ? t.id : undefined });
  delete ui.busy[t.id];
  const name = AGENTS[who].name;
  t.notes.push(res.ok ? { at: now(), who: `${name} (review)`, text: res.text } : { at: now(), who: name, text: `${res.error.kind}: ${res.error.message}`, err: true });
  audit(res.ok ? `${name} reviewed` : `${name} review failed`, t.id);
  save();
  render();
}

// Run (or continue) a task with an agent in the shared workspace. Progress is
// checkpointed after every run; if the agent runs out of usage the next free
// agent picks up from the checkpoint automatically.
async function runTask(t, agent, handoff = null, depth = 0) {
  if (ui.running[t.id] || !canRun(agent)) return;
  try {
    t.ws = t.ws || (await api.ensureWorkspace(t.id, t.title));
  } catch (e) {
    return toast(cleanErr(e.message));
  }
  if (t.assignee !== agent) {
    const prev = t.assignee;
    t.assignee = agent;
    if (t.reviewer === agent) t.reviewer = ['anthropic', 'openai'].find((a) => a !== agent) || 'none';
    audit(`Handed off to ${NAMES[agent]}`, t.id, handoff ? `${NAMES[handoff.from]}: ${handoff.reason}` : `from ${NAMES[prev] || 'unassigned'}`);
  }
  if (t.stage === 'intake') { t.stage = 'implementing'; audit('Work started', t.id, NAMES[agent]); }
  const summary = await api.workspaceSummary(t.id, t.ws.baseSha).catch(() => '');
  const prompt = buildTaskBrief({ task: t, agent, summary, handoffFrom: handoff?.from, reason: handoff?.reason });
  const runId = uid() + uid();
  // Checkpoint BEFORE the call: commit anything already in the workspace and
  // persist the task (with the exact brief) so a crash mid-call loses nothing saved.
  ui.saving[t.id] = true;
  render();
  try {
    await api.checkpoint(t.id, 'Hearth AI', `Snapshot before ${NAMES[agent]} run on: ${t.title}`);
  } catch {}
  const run = { id: runId, agent, at: now(), status: 'running', brief: prompt.slice(0, 20000) };
  t.runs = t.runs || [];
  t.runs.push(run);
  await save();
  delete ui.saving[t.id];
  ui.running[t.id] = { agent, runId };
  render();

  const res = await callAgent(agent, prompt, { mode: 'edit', taskId: t.id, runId });
  delete ui.running[t.id];
  ui.saving[t.id] = true;
  render();
  let cp = null;
  try {
    cp = await api.checkpoint(t.id, NAMES[agent], `${NAMES[agent]}: ${t.title} — ${res.ok ? 'progress' : `checkpoint (${res.error.kind})`}`);
  } catch (e) {
    t.notes.push({ at: now(), who: 'System', text: cleanErr(e.message), err: true });
  }
  run.status = res.ok ? (parseStatus(res.text) || 'ok') : res.error.kind;
  run.via = res.via || '';
  run.output = res.ok ? res.text : `${res.error.message}${res.partial ? `\n\nLast output:\n${res.partial}` : ''}`;
  run.checkpoint = cp?.sha || null;
  t.updatedAt = now();
  audit(res.ok ? `${NAMES[agent]} finished a run` : `${NAMES[agent]} stopped (${res.error.kind})`, t.id, cp ? `checkpoint ${cp.sha} · ${cp.stat}` : 'no file changes');
  if (res.ok && run.status === 'done' && t.stage === 'implementing') {
    t.stage = 'checkpoint';
    audit('Checkpoint pushed', t.id, 'agent reported done');
  }
  await save();
  delete ui.saving[t.id];
  render();

  if (!res.ok && ['outage', 'auth', 'not_installed'].includes(res.error.kind)) {
    const next = nextAgent(liveAgents(), [agent]);
    t.notes.push({ at: now(), who: 'System', text: `${NAMES[agent]}: ${res.error.message} Progress is saved${cp ? ` (checkpoint ${cp.sha})` : ''}. Resume with ${NAMES[agent]} later${next ? `, or hand it to ${NAMES[next]} now` : ''}.` });
    await save();
    render();
  }
  if (!res.ok && res.error.kind === 'limit') {
    const next = nextAgent(liveAgents(), [agent]);
    if (next && state.autoHandoff && depth < 3) {
      toast(`${NAMES[agent]} ran out of usage — ${NAMES[next]} is continuing from the checkpoint.`);
      return runTask(t, next, { from: agent, reason: 'ran out of usage' }, depth + 1);
    }
    t.notes.push({ at: now(), who: 'System', text: `${NAMES[agent]} ran out of usage. Progress is saved${cp ? ` (checkpoint ${cp.sha})` : ''}. ${next ? `Hand it to ${NAMES[next]}` : 'No other agent is free'} — or continue in FreeBuff.` });
    save();
    render();
  }
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
  try { cp = await api.checkpoint(t.id, 'FreeBuff', `FreeBuff: ${t.title} — progress`); } catch (e) { return toast(cleanErr(e.message)); }
  t.freebuffOpen = false;
  t.runs = t.runs || [];
  t.runs.push({ id: uid(), agent: 'freebuff', at: now(), status: 'ok', via: 'FreeBuff (interactive)', output: 'Worked interactively in FreeBuff.', checkpoint: cp?.sha || null });
  audit('FreeBuff work checkpointed', t.id, cp ? `checkpoint ${cp.sha} · ${cp.stat}` : 'no file changes');
  save();
  render();
}

async function refreshProviders() {
  try { prov = await api.providerStatus(); } catch {}
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-nav],[data-new],[data-open],[data-close],[data-cancel],[data-create],[data-advance],[data-approve],[data-reject],[data-changes],[data-note],[data-delete],[data-savekey],[data-rmkey],[data-ask],[data-export],[data-reset],[data-upd],[data-opinion],[data-modalbg],[data-sendchat],[data-target],[data-addprop],[data-addall],[data-clearchat],[data-method],[data-login],[data-recheck],[data-locate],[data-available],[data-run],[data-stop],[data-freebuff],[data-fbdone],[data-openws],[data-pickproject],[data-autohandoff],[data-restore]');
  if (!el) return;
  const d = el.dataset;
  const task = (id) => state.tasks.find((t) => t.id === id);

  if (d.modalbg !== undefined && e.target === el) { ui.modal = null; return render(); }
  if (d.nav) { ui.view = d.nav; ui.selected = null; if (d.nav === 'settings') backups = await api.backups().catch(() => backups); return render(); }
  if (d.sendchat !== undefined) return sendChat();
  if (d.method) {
    const [a, m] = d.method.split(':');
    settings = await api.setConnection(a, m);
    return render();
  }
  if (d.login) {
    const r = await api.agentLogin(d.login);
    toast(r.ok ? `Sign-in opened in ${r.terminal}. Finish there, then press Re-check.` : r.message);
    return;
  }
  if (d.recheck !== undefined) { await refreshAgents(); await refreshProviders(); toast('Agent status refreshed.'); return render(); }
  if (d.locate) { settings = await api.pickBinary(d.locate); await refreshAgents(); return render(); }
  if (d.available) { delete state.agentStatus[d.available]; audit(`${NAMES[d.available]} marked available`); save(); return render(); }
  if (d.run) { const [id, a] = d.run.split(':'); return runTask(task(id), a); }
  if (d.stop) { const r = ui.running[d.stop]; if (r) await api.cancelRun(r.runId); return; }
  if (d.freebuff) return openInFreebuff(task(d.freebuff));
  if (d.fbdone) return freebuffDone(task(d.fbdone));
  if (d.openws !== undefined) return api.openWorkspace(d.openws || null);
  if (d.pickproject !== undefined) {
    try { settings = await api.pickProject(); } catch (err) { toast(cleanErr(err.message)); }
    return render();
  }
  if (d.autohandoff !== undefined) { state.autoHandoff = !state.autoHandoff; save(); return render(); }
  if (d.target) { ui.target = d.target; render(); return document.getElementById('chat-text')?.focus(); }
  if (d.addprop) {
    const [id, i] = d.addprop.split(':');
    addProposal(id, Number(i));
    save();
    render();
    return toast('Added to the board — it starts at Intake with a policy check.');
  }
  if (d.addall) {
    const m = state.chat.find((x) => x.id === d.addall);
    (m?.proposals || []).forEach((_, i) => addProposal(d.addall, i));
    save();
    render();
    return toast('Tasks added to the board.');
  }
  if (d.clearchat !== undefined) {
    if (!confirm('Clear the team chat? Tasks already on the board stay.')) return;
    state.chat = [];
    save();
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
    t.decision = 'approved';
    return setStage(t, 'approved', 'Owner approved', `${ACTIONS[t.action]} authorized. The prototype records the decision only; it does not execute merges, releases or deploys.`);
  }
  if (d.reject) {
    const t = task(d.reject);
    t.decision = 'rejected';
    return setStage(t, 'rejected', 'Owner rejected', 'Branch kept; decision recorded.');
  }
  if (d.changes) return setStage(task(d.changes), 'implementing', 'Changes requested', 'Sent back to implementer');
  if (d.open) { ui.selected = d.open; return render(); }
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
      audit('API key saved', null, AGENTS[d.savekey].name);
      save();
      toast(`${AGENTS[d.savekey].name} key saved securely.`);
    } catch (err) {
      toast(`Not saved: ${err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`);
    }
    await refreshProviders();
    return render();
  }
  if (d.rmkey) {
    await api.removeKey(d.rmkey);
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
    render();
    try {
      consoleOut[p] = await callAgent(p, prompt, { mode: 'read' });
    } catch (err) {
      consoleOut[p] = { ok: false, error: { kind: 'error', message: err.message } };
    }
    delete ui.busy[p];
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
      state = { models: {}, chat: [], agentStatus: {}, autoHandoff: true, ...s };
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
    const fn = { check: api.checkForUpdates, download: api.downloadUpdate, install: api.installUpdate }[d.upd];
    const res = await fn();
    if (res && !res.ok && res.message) toast(res.message);
  }
});

document.addEventListener('change', (e) => {
  const p = e.target.dataset?.model;
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

document.addEventListener('input', (e) => {
  if (e.target.id === 'chat-text') ui.draft = e.target.value;
});

document.addEventListener('keydown', (e) => {
  if (e.target.id === 'chat-text' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    return sendChat();
  }
  if (e.key === 'Escape') {
    if (ui.modal) ui.modal = null;
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
    const saved = await api.loadState();
    if (saved && Array.isArray(saved.tasks) && Array.isArray(saved.audit)) state = { models: {}, ...saved };
    if (!Array.isArray(state.chat)) state.chat = [];
    backups = await api.backups().catch(() => backups);
    const interrupted = recoverInterrupted(state);
    for (const t of interrupted) {
      let cp = null;
      if (t.ws) { try { cp = await api.checkpoint(t.id, 'Hearth AI', `Recovery checkpoint after interrupted run: ${t.title}`); } catch {} }
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
    if (!state.agentStatus) state.agentStatus = {};
    if (state.autoHandoff === undefined) state.autoHandoff = true;
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
}

boot();

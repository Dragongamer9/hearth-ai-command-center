import './styles.css';
import { policyCheck, HEARTH_OS_PIN } from './policy.mjs';

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
let state = { version: 1, tasks: [], audit: [], models: {} };
let ui = { view: 'overview', selected: null, modal: null, busy: {} };
let info = { appVersion: '?', hearthOsVersion: HEARTH_OS_PIN, dataPath: '', electron: '?', packaged: false };
let prov = { encryption: false, weakEncryption: false, defaults: {}, keys: {} };
let upd = { enabled: false, reason: '', status: { state: 'idle' } };
let consoleOut = {};

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const now = () => new Date().toISOString();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const time = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

async function save() {
  try {
    await api.saveState(state);
  } catch (e) {
    toast(`Could not save: ${e.message}`);
  }
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
  const connected = ['anthropic', 'openai'].filter((p) => prov.keys[p]).length;
  const counts = Object.fromEntries(Object.keys(STAGES).map((s) => [s, state.tasks.filter((t) => t.stage === s).length]));
  const flow = ['intake', 'implementing', 'checkpoint', 'testing', 'review', 'approval'];
  return `
    <div class="grid stats">
      <div class="card stat"><div class="n">${open.length}</div><div class="l">Open tasks</div></div>
      <div class="card stat"><div class="n" style="color:var(--amber)">${waiting.length}</div><div class="l">Awaiting your approval</div></div>
      <div class="card stat"><div class="n">${connected}<span class="muted" style="font-size:16px"> / 3</span></div><div class="l">Agents with API access</div></div>
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

function viewBoard() {
  return `<div class="board">${COLUMNS.map((c) => {
    const items = state.tasks.filter((t) => c.stages.includes(t.stage));
    return `<div class="col"><div class="col-h">${esc(c.title)}<span class="n">${items.length}</span></div>
      ${items.map((t) => `<div class="task ${ui.selected === t.id ? 'sel' : ''}" data-open="${t.id}">
        <div class="t">${esc(t.title)}</div>
        <div class="meta">${stageBadge(t)}${agentChip(t.assignee)}</div>
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
  const live = id !== 'freebuff';
  const hasKey = prov.keys[id];
  const model = state.models[id] || prov.defaults[id] || '';
  const out = consoleOut[id];
  const status = !live
    ? '<span class="badge">Not available</span>'
    : hasKey ? '<span class="badge sage"><span class="dot"></span>API key saved</span>' : '<span class="badge amber">No API key</span>';
  return `<div class="card prov">
    <h4><span class="agent ${a.cls}"><i></i></span>${esc(a.name)} <span class="muted" style="font-size:12px;font-weight:400">${esc(a.vendor)}</span></h4>
    <div class="row" style="margin:10px 0">${status}</div>
    ${live ? `
      <p>Uses the official ${esc(a.vendor)} API. The key is encrypted with your OS keyring and stays in the app's background process; this screen never sees it again.</p>
      <label>API key</label>
      <div class="row"><input type="password" id="key-${id}" placeholder="${hasKey ? '•••••••• saved — paste to replace' : 'Paste API key'}" autocomplete="off" style="flex:1">
        <button class="btn small" data-savekey="${id}">Save</button>
        ${hasKey ? `<button class="btn danger small" data-rmkey="${id}">Remove</button>` : ''}</div>
      <label>Model</label>
      <input type="text" id="model-${id}" value="${esc(model)}" data-model="${id}">
      <label>Quick console</label>
      <textarea id="prompt-${id}" placeholder="Ask ${esc(a.name)} something…"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn primary small" data-ask="${id}" ${ui.busy[id] ? 'disabled' : ''}>${ui.busy[id] ? 'Waiting…' : 'Send'}</button></div>
      ${out ? `<div class="console-out note ${out.ok ? '' : 'err'}">${out.ok ? esc(out.text) : `${esc(out.error.kind)}: ${esc(out.error.message)}`}</div>` : ''}
    ` : `
      <p>FreeBuff is included as a planned agent, but there is no verified, documented public API to connect to, so nothing is wired up. Tasks can still be assigned to FreeBuff and moved through the flow manually.</p>
      <p class="muted">Once FreeBuff publishes an official API (or an OpenAI-compatible endpoint is confirmed), an adapter can be added here.</p>
    `}
  </div>`;
}

function viewAgents() {
  const warn = !prov.encryption
    ? '<div class="policy block">Your system has no OS keyring available (GNOME Keyring / KWallet), so API keys cannot be stored securely. Install and unlock a keyring, then restart.</div>'
    : prov.weakEncryption ? '<div class="policy warn">No desktop keyring detected; keys use weak fallback encryption. Installing GNOME Keyring or KWallet is recommended.</div>' : '';
  return `${warn}<div class="grid agents">${['anthropic', 'openai', 'freebuff'].map(providerCard).join('')}</div>`;
}

function viewAudit() {
  return `<div class="card">
    <div class="row" style="margin-bottom:10px"><h3 style="margin:0;flex:1">Append-only audit record</h3>
      <button class="btn small" data-export>Export JSON</button></div>
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
      <p class="muted" style="line-height:1.55">Prototype. Real: task flow, policy checks, approvals, audit log, Claude & ChatGPT API calls, in-app updates. Not yet: agents running code, GitHub branch/PR tracking, FreeBuff, executing approved actions.</p>
    </div>
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
    <div class="row">${stageBadge(t)}<span class="badge">${esc(ACTIONS[t.action])}</span></div>
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
    ${t.policy.ok && !closed ? `<div class="row">
      ${['anthropic', 'openai'].includes(t.assignee) ? `<button class="btn small" data-brief="${t.id}" ${ui.busy[t.id] ? 'disabled' : ''}>${ui.busy[t.id] === 'brief' ? 'Waiting…' : `Ask ${esc(AGENTS[t.assignee].name)} for a plan`}</button>` : ''}
      ${['anthropic', 'openai'].includes(t.reviewer) ? `<button class="btn small" data-opinion="${t.id}" ${ui.busy[t.id] ? 'disabled' : ''}>${ui.busy[t.id] === 'opinion' ? 'Waiting…' : `Independent opinion from ${esc(AGENTS[t.reviewer].name)}`}</button>` : ''}
    </div>` : ''}
    <div class="sep"></div>
    <h3 class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.6px">Notes & agent responses</h3>
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
  ['board', '▦', 'Task board'],
  ['approvals', '✓', 'Approvals'],
  ['agents', '✦', 'Agents'],
  ['audit', '☰', 'Audit log'],
  ['settings', '⚙', 'Settings'],
];
const TITLES = {
  overview: ['Command Center', 'Coordinate Claude, ChatGPT and FreeBuff under your approval'],
  board: ['Task board', 'Owner → policy → agent → checkpoint → tests → review → approval'],
  approvals: ['Approvals', 'Nothing high-impact happens without your explicit sign-off'],
  agents: ['Agents', 'Connect providers through their official APIs'],
  audit: ['Audit log', 'Every decision, recorded'],
  settings: ['Settings', 'Updates, data and Hearth OS pin'],
};

function render() {
  const waiting = state.tasks.filter((t) => t.stage === 'approval').length;
  const views = { overview: viewOverview, board: viewBoard, approvals: viewApprovals, agents: viewAgents, audit: viewAudit, settings: viewSettings };
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
}

// ---------- actions ----------
function setStage(t, stage, event, detail) {
  t.stage = stage;
  t.updatedAt = now();
  audit(event, t.id, detail);
  save();
  render();
}

function createTask() {
  const v = (id) => document.getElementById(id).value;
  const title = v('f-title').trim();
  if (!title) return toast('Give the task a title.');
  const t = {
    id: uid(),
    title: title.slice(0, 200),
    description: v('f-desc').trim().slice(0, 5000),
    assignee: v('f-assignee'),
    reviewer: v('f-reviewer'),
    action: v('f-action'),
    stage: 'intake',
    notes: [],
    createdAt: now(),
    updatedAt: now(),
  };
  t.policy = policyCheck(t);
  if (!t.policy.ok && t.policy.block.some((b) => b.startsWith('Looks like it contains'))) {
    return toast('That task text contains something that looks like a secret. Remove it first.');
  }
  state.tasks.unshift(t);
  audit('Task created', t.id, t.title);
  audit(t.policy.ok ? 'Policy check passed' : 'Policy check blocked', t.id, [...t.policy.block, ...t.policy.warn].join(' '));
  ui.modal = null;
  ui.selected = t.id;
  save();
  render();
}

async function askForTask(t, kind) {
  const who = kind === 'brief' ? t.assignee : t.reviewer;
  const prompt = kind === 'brief'
    ? `You are the implementing agent for a task in the Hearth AI Command Center. Propose a concise, step-by-step implementation plan and list risks. Do not claim to have done anything.\n\nTask: ${t.title}\n\n${t.description}`
    : `You are an independent reviewer. Critically assess this task and any notes below. List concerns, missing tests and whether the owner should approve. Be concise.\n\nTask: ${t.title}\n\n${t.description}\n\nNotes:\n${t.notes.map((n) => `${n.who}: ${n.text}`).join('\n').slice(0, 8000)}`;
  ui.busy[t.id] = kind;
  render();
  let res;
  try {
    res = await api.ask(who, state.models[who] || prov.defaults[who], prompt);
  } catch (e) {
    res = { ok: false, error: { kind: 'error', message: e.message } };
  }
  delete ui.busy[t.id];
  const name = AGENTS[who].name;
  t.notes.push(res.ok ? { at: now(), who: `${name} (${res.model})`, text: res.text } : { at: now(), who: name, text: `${res.error.kind}: ${res.error.message}`, err: true });
  audit(res.ok ? `${name} responded` : `${name} request failed`, t.id, kind === 'brief' ? 'plan' : 'independent review');
  save();
  render();
}

async function refreshProviders() {
  try { prov = await api.providerStatus(); } catch {}
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-nav],[data-new],[data-open],[data-close],[data-cancel],[data-create],[data-advance],[data-approve],[data-reject],[data-changes],[data-note],[data-delete],[data-savekey],[data-rmkey],[data-ask],[data-export],[data-reset],[data-upd],[data-brief],[data-opinion],[data-modalbg]');
  if (!el) return;
  const d = el.dataset;
  const task = (id) => state.tasks.find((t) => t.id === id);

  if (d.modalbg !== undefined && e.target === el) { ui.modal = null; return render(); }
  if (d.nav) { ui.view = d.nav; ui.selected = null; return render(); }
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
  if (d.brief) return askForTask(task(d.brief), 'brief');
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
      consoleOut[p] = await api.ask(p, state.models[p] || prov.defaults[p], prompt);
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
    const blob = new Blob([JSON.stringify(state.audit, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hearth-ai-audit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
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
  if (/^[A-Za-z0-9._:\-/]{1,100}$/.test(val)) {
    state.models[p] = val;
    save();
  } else {
    toast('Model name looks invalid.');
  }
});

document.addEventListener('keydown', (e) => {
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
    await refreshProviders();
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

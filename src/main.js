// Hearth AI Command Center 2.x: chats only. Each chat can connect to one of the owner's
// GitHub repos; Claude, ChatGPT, Gemini and the others work together in it, Claude leading.
// Work happens in a small temporary copy of the repo on this PC (electron/copies.cjs);
// builds and tests run in GitHub Actions after a push to the chat's own branch.
import './styles.css';
import { AGENTS, COLORS, AGENT_IDS } from './registry.mjs';
import { icon } from './icons.mjs';
import { tokensToCss, pickMode } from './theme.mjs';
import { autoTitle, moveInGroup, dropInGroup } from './chats.mjs';
import { groupChats, repoHint, greeting, fmtBytes, ago } from './app/groups.mjs';
import { groupSteps, outcomeSteps } from './app/steps.mjs';
import { extractPreviews, previewDoc, frameHtml, kindOf } from './app/previews.mjs';
import { md, esc } from './app/text.mjs';
import { parseDiff } from './app/diff.mjs';
import { teamOf, planTurn, handoffs, pickReviewer, brief, turnPrompt, name as aiName } from './app/brief.mjs';
import { parseActs, makeAct, expired, typedAnswer, ACT_KINDS } from './app/act.mjs';

const api = window.hearth || null;
const TEAM_IDS = ['anthropic', 'openai', 'google', 'xai', 'mistral', 'qwen', 'perplexity', 'deepseek', 'ollama'];
const MONO = { anthropic: ['C', '#c96b3c'], openai: ['G', '#3f8f6f'], google: ['Ge', '#4b6fd0'], xai: ['X', '#5d636b'], mistral: ['M', '#6b5bd2'], qwen: ['Q', '#7a5cc9'], perplexity: ['P', '#1f8a99'], deepseek: ['D', '#3d56c9'], ollama: ['L', '#6d746e'], freebuff: ['F', '#8a7bc6'] };
const QUICK = [
  ['gh', 'Fix a bug in a repo', 'There\'s a bug I want fixed: '],
  ['dl', 'Look at a sent log', 'Look at the log I attached (or the newest one in Dragongamer9/hearth-logs) and find the cause: '],
  ['globe', 'Research something', 'Research this and give me a short answer with sources: '],
  ['eye', 'Make a mockup', 'Make a live preview mockup of '],
  ['branch', 'Review open pull requests', 'Review the open pull requests in this repo and tell me which are ready.'],
  ['flag', 'Prepare a release', 'Prepare a release: list what changed since the last release and draft the release notes. Don\'t pick a version number; ask me for it.'],
];
const SECTIONS = [['team', 'AI team'], ['accounts', 'Accounts'], ['github', 'GitHub'], ['tools', 'Tools'], ['perms', 'Permissions'], ['look', 'Appearance'], ['updates', 'App updates'], ['data', 'Saved data']];
const IDLE = [[1, '1 hour'], [6, '6 hours'], [24, '1 day'], [72, '3 days'], [168, '1 week'], [0, 'Never']];

const S = {
  view: 'home', tab: 'team',
  chats: [], trash: [], notices: [], broken: false,
  open: null, msgs: [], sessions: {}, readOnly: false, copy: null,
  draft: '', attach: [], conn: null, mode: 'team', web: true, build: true,
  busy: null, stop: false,
  pane: null, pop: null, modal: null, toast: null, undo: null,
  search: '', hits: null, showTrash: false, showHidden: false, renaming: null,
  repos: null, reposMsg: '', repoQuery: '', branches: {}, pick: null,
  settings: { tools: { web: true, build: true, quickChecks: [] }, team: null, copyIdleHours: 24, theme: 'hearth', textSize: 100, connection: {}, bins: {}, extraDirs: [] },
  info: {}, upd: { enabled: false, status: { state: 'idle' } }, gh: {}, cli: {}, prov: { keys: {} }, theme: { found: false, tokens: {} },
  copies: null, boards: null, phone: null, idle: [], rec: null, voice: null,
};

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const cleanErr = (e) => String(e?.message || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const call = async (fn, ...a) => { if (!api || typeof api[fn] !== 'function') return null; try { return await api[fn](...a); } catch (e) { return { ok: false, message: cleanErr(e), error: { message: cleanErr(e) } }; } };
const entry = (id = S.open) => S.chats.find((c) => c.id === id) || null;
const ownerName = () => S.settings.ownerIdentity?.name || S.gh.ghUser || 'Dragongamer9';
const team = () => teamOf(S.settings.team);

// ---------- AIs ----------
function method(a) { return AGENTS[a]?.kind === 'api' ? 'api' : S.settings.connection?.[a] === 'api' ? 'api' : 'cli'; }
function ready(a) {
  if (!AGENTS[a]?.headless) return false;
  if (method(a) === 'api') return Boolean(S.prov.keys?.[a]);
  const c = S.cli[a];
  return Boolean(c && c.installed && c.signedIn !== false);
}
const live = () => team().members.filter(ready);
const mono = (a, cls = '') => { const m = MONO[a] || [(AGENTS[a]?.name || '?')[0], '#7a7166']; return `<span class="ava ${cls}" style="background:${m[1]}">${esc(m[0])}</span>`; };

// ---------- saving ----------
let saveChain = Promise.resolve();
function save() {
  const id = S.open;
  if (!id || S.readOnly) return saveChain;
  const data = { messages: S.msgs.filter((m) => !m.local), sessions: S.sessions };
  saveChain = saveChain.then(async () => {
    const r = await call('chatsSave', id, data);
    if (r && r.ok === false) toast(r.message || 'Not saved.');
    const c = entry(id);
    if (c) c.updatedAt = now();
  });
  return saveChain;
}

function toast(text, undo = null) {
  S.toast = { text, undo, at: Date.now() };
  renderOverlay();
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { S.toast = null; renderOverlay(); }, undo ? 9000 : 5000);
}

// ---------- chats ----------
async function loadChats() {
  const r = await call('chatsList2');
  if (r && Array.isArray(r.list)) { S.chats = r.list; S.broken = r.broken; for (const n of r.notices || []) if (!S.notices.includes(n)) S.notices.push(n); }
  const t = await call('chatsTrash');
  S.trash = Array.isArray(t) ? t : [];
}

async function openChat(id) {
  if (S.busy && S.open !== id) { toast('An AI is still working in this chat. Stop it or wait, then switch.'); return; }
  const c = entry(id);
  if (!c) return;
  const r = await call('chatsGet2', id);
  S.open = id;
  S.view = 'chat';
  S.pane = null;
  S.pop = null;
  S.msgs = r?.ok ? (r.messages || []) : [];
  S.sessions = r?.ok ? (r.sessions || {}) : {};
  S.readOnly = Boolean(r?.readOnly) || (r && r.ok === false);
  S.copy = null;
  if (r && r.ok === false) S.msgs = [{ id: 'x', who: 'system', local: true, text: r.message || 'This chat could not be read. It was left exactly as it is.', at: now() }];
  if (c.importError) S.msgs.unshift({ id: 'ie', who: 'system', local: true, text: c.importError, at: now() });
  try { localStorage.setItem('hearth.v2.open', id); } catch {}
  render(true);
  if (c.hasCopy) { const st = await call('copiesStatus', id); if (st?.exists) { S.copy = st; render(); } }
  for (const m of S.msgs) if (m.actions && ['pending', 'queued'].includes(m.actions.state)) pollRuns(m.id);
  pushPhone();
}

function goHome() {
  if (S.busy) { toast('An AI is still working. Stop it or wait first.'); return; }
  S.view = 'home'; S.open = null; S.msgs = []; S.sessions = {}; S.pane = null; S.pop = null; S.copy = null;
  try { localStorage.removeItem('hearth.v2.open'); } catch {}
  render(true);
}

async function ensureChat(firstText) {
  if (S.open) return entry();
  const title = autoTitle(firstText) || 'New chat';
  const e = await call('chatsCreate2', { repo: S.conn?.repo || null, branch: S.conn?.branch || null, title });
  if (!e || !e.id) { toast(e?.message || 'Could not start a chat.'); return null; }
  await loadChats();
  S.open = e.id; S.view = 'chat'; S.msgs = []; S.sessions = {}; S.readOnly = false; S.copy = null;
  try { localStorage.setItem('hearth.v2.open', e.id); } catch {}
  return entry(e.id) || e;
}

async function chatAction(kind, id) {
  const c = entry(id);
  S.pop = null;
  if (!c) return render();
  if (kind === 'rename') { S.renaming = id; return render(); }
  if (kind === 'pin' || kind === 'unpin') { await call('chatsUpdate', id, { pinned: kind === 'pin' }); }
  if (kind === 'up' || kind === 'down') { const ids = moveInGroup(S.chats, id, kind === 'up' ? -1 : 1); if (ids) await call('chatsReorder', ids); }
  if (kind === 'hide' || kind === 'unhide') { const r = await call('chatsUpdate', id, { hidden: kind === 'hide' }); if (r?.ok === false) toast(r.message); if (kind === 'hide' && S.open === id) goHome(); }
  if (kind === 'connect') { S.pick = { chatId: id }; S.pop = { kind: 'repo', chatId: id }; loadRepos(); return render(); }
  if (kind === 'close') return closeCopy(id);
  if (kind === 'delete') return deleteChat(id);
  await loadChats();
  render();
}

async function deleteChat(id, opts = {}) {
  if (S.busy && S.open === id) return toast('Stop the AI first.');
  const title = entry(id)?.title || 'chat';
  const r = await call('chatsDelete2', id, opts);
  if (r?.unpushed) return askUnpushed(id, 'delete');
  if (!r || r.ok === false) { if (!r?.cancelled) toast(r?.message || 'Not deleted.'); return; }
  if (S.open === id) goHome();
  await loadChats();
  render();
  toast(`Deleted “${title}”. It's in Recently deleted.`, { kind: 'restore', trashId: r.trashId });
}

async function closeCopy(id, force = false) {
  const r = await call('copiesRemove', id, force);
  if (r?.unpushed) return askUnpushed(id, 'close');
  if (r?.ok) { toast(`Removed the temporary copy${r.freed ? ` (${fmtBytes(r.freed)} freed)` : ''}. It comes back when the team works here again.`); if (S.open === id) S.copy = null; }
  else if (!r?.cancelled) toast(r?.message || 'Not removed.');
  await loadChats();
  if (S.copies) await loadCopies();
  render();
}

// Never delete unpushed work without asking: offer to push it to a branch first.
function askUnpushed(chatId, then) {
  S.modal = { kind: 'unpushed', chatId, then };
  render();
}

// ---------- repos ----------
async function loadRepos(force = false) {
  if (S.repos && !force) return;
  S.reposMsg = 'Loading your repos…';
  renderOverlay();
  const r = await call('ghRepos');
  if (r?.ok) { S.repos = r.repos; S.reposMsg = ''; } else { S.repos = []; S.reposMsg = r?.message ? `Couldn't list your repos: ${r.message}` : 'Sign in to GitHub (Settings › GitHub) to pick a repo.'; }
  renderOverlay();
}
async function loadBranches(repo) {
  if (S.branches[repo]) return S.branches[repo];
  const r = await call('ghBranches', repo);
  S.branches[repo] = r?.ok ? r : { branches: [], default: null };
  renderOverlay();
  return S.branches[repo];
}
async function chooseRepo(repo, branch) {
  const chatId = S.pop?.chatId || S.pick?.chatId || null;
  S.pop = null;
  S.pick = null;
  if (!chatId && S.view !== 'chat') { S.conn = repo ? { repo, branch: branch || null } : null; return render(); }
  const id = chatId || S.open;
  if (!id) { S.conn = repo ? { repo, branch } : null; return render(); }
  const r = await call('chatsConnect', id, repo ? { repo, branch } : null);
  if (r?.unpushed) { S.modal = { kind: 'unpushed', chatId: id, then: 'connect', conn: repo ? { repo, branch } : null }; return render(); }
  if (!r?.ok) return toast(r?.message || 'Not connected.');
  if (S.open === id) S.copy = null;
  await loadChats();
  render();
  toast(repo ? `Connected to ${repo}${branch ? ` · ${branch}` : ''}.` : 'This chat has no repo now; the team just talks.');
}

// ---------- attachments ----------
async function addFiles(fileList) {
  for (const f of [...fileList].slice(0, 10)) {
    const buf = await f.arrayBuffer();
    const r = await call('attachSaveAny', f.name || 'pasted.png', buf);
    if (r?.ok) S.attach.push(r.att); else toast(r?.message || `Couldn't attach ${f.name}.`);
  }
  render();
}

// ---------- the team at work ----------
async function send(textIn) {
  const text = String(textIn ?? S.draft).trim();
  if (!text && !S.attach.length) return;
  // The owner is never blocked: while the team works, his message is posted now and
  // answered as soon as the current turn ends.
  if (S.busy) {
    if (S.readOnly || !S.open) return;
    S.msgs.push({ id: uid(), who: 'owner', text, at: now(), attachments: S.attach.slice() });
    S.draft = '';
    S.attach = [];
    S.queued = [...(S.queued || []), text];
    await save();
    render(true);
    return toast('Sent. The team reads it as soon as the current step is done.');
  }
  // "yes" / "no" answers Claude's newest request in this chat.
  const pendingAct = [...S.msgs].reverse().flatMap((m) => (m.acts || []).filter((a) => a.status === 'pending' && !expired(a))).shift();
  const typed = pendingAct ? typedAnswer(text) : null;
  if (S.readOnly) return toast('This chat could not be read, so nothing is added to it.');
  const c = await ensureChat(text || 'Files');
  if (!c) return;
  const msg = { id: uid(), who: 'owner', text, at: now(), attachments: S.attach.slice() };
  S.msgs.push(msg);
  S.draft = '';
  S.attach = [];
  if (c.titleAuto && S.msgs.filter((m) => m.who === 'owner').length === 1 && text) {
    await call('chatsUpdate', c.id, { title: autoTitle(text), auto: true });
    await loadChats();
  }
  await save();
  render(true);
  if (typed && pendingAct) return decideAct(pendingAct.id, typed === 'yes', 'typed');
  await runTeam(text);
}

async function runTeam(text) {
  // Right after start the AIs' sign-in checks may still be running: wait for them once.
  if (team().members.some((a) => method(a) !== 'api' && !S.cli[a])) await refreshAgents();
  const t = team();
  const L = live();
  const order = planTurn({ text, mode: S.mode, team: t, live: L });
  if (!order.length) {
    post({ who: 'system', text: L.length ? 'The AI you picked isn\'t ready. Set it up in Settings › Accounts, or pick another one.' : 'No AI is ready yet. Sign in to Claude (or another AI) in Settings › Accounts.' });
    return save();
  }
  S.stop = false;
  const done = [];
  let changed = null;
  for (let i = 0; i < order.length && !S.stop; i++) {
    const agent = order[i];
    const role = S.mode === 'team' && agent === t.lead ? 'lead' : 'member';
    const r = await turn(agent, { role });
    done.push(agent);
    if (!r) break;
    if (r.changes?.files?.length) changed = { by: agent, msgId: r.msgId };
    if (role === 'lead') for (const h of handoffs(r.text, { team: t, live: L, done: [...done, ...order] })) order.push(h);
  }
  const reviewer = changed && S.mode === 'team' && !S.stop ? pickReviewer({ team: t, live: L, author: changed.by }) : null;
  if (reviewer) {
    const d = await call('chatDiff', S.open);
    const diff = String(d?.diff || '').slice(0, 40000);
    await turn(reviewer, { role: 'reviewer', task: `Review ${aiName(changed.by)}'s changes on this chat's branch. Say plainly if they are right and what (if anything) must change. Keep it short. Don't edit files.\n\nTHE CHANGES:\n${diff || '(no diff available)'}`, readOnly: true });
  }
  S.busy = null;
  render();
  // Messages the owner sent while the team was working.
  if (S.queued?.length && !S.stop) { const next = S.queued.join('\n\n'); S.queued = []; return runTeam(next); }
  S.queued = [];
}

function post(m) {
  const msg = { id: uid(), at: now(), ...m };
  S.msgs.push(msg);
  render();
  return msg;
}

async function turn(agent, { role = 'member', task = '', readOnly = false } = {}) {
  const c = entry();
  if (!c) return null;
  const runId = uid().replace(/[^a-z0-9]/gi, '').slice(0, 10) + 'r';
  S.busy = { agent, role, runId, steps: [], startedAt: Date.now() };
  render(true);
  const resumeId = typeof S.sessions[agent] === 'string' ? S.sessions[agent] : null;
  const copy = S.copy ? { base: S.copy.base, work: S.copy.work } : null;
  const opts = { agent, role, chat: c, copy, build: S.build && !readOnly, web: S.web, quickChecks: S.settings.tools?.quickChecks || [], team: team(), live: live(), actForMe: S.settings.actForMe === true, apiOnly: method(agent) === 'api' };
  const briefText = brief(opts);
  const prompt = turnPrompt({ agent, role, messages: S.msgs, briefText, resumed: Boolean(resumeId), task });
  const fallbackPrompt = turnPrompt({ agent, role, messages: S.msgs, briefText, resumed: false, task });
  const lastOwner = [...S.msgs].reverse().find((m) => m.who === 'owner');
  const atts = lastOwner?.attachments || [];
  const r = await call('chatRun', {
    chatId: c.id, agent, runId, prompt: prompt.slice(-58000), fallbackPrompt: fallbackPrompt.slice(-58000), resumeId,
    images: atts.filter((a) => a.kind === 'image').map((a) => a.path).concat(atts.filter((a) => a.kind === 'video').flatMap((a) => a.frames || [])),
    files: atts.filter((a) => a.kind === 'file').map((a) => a.path),
    web: S.web, build: S.build && !readOnly, title: c.title, historyText: lastOwner?.text || '',
  }) || { ok: false, error: { message: 'The app could not start the AI.' } };
  const steps = S.busy?.steps || [];
  S.busy = null;
  if (r.sessionId) S.sessions[agent] = r.sessionId;
  if (r.resumeReset && r.sessionId) S.sessions[agent] = r.sessionId;
  if (r.status) S.copy = { ...r.status, exists: true };
  if (!r.ok) {
    const kind = r.error?.kind;
    const why = kind === 'limit' ? `${aiName(agent)} is out of usage${r.error.reset ? ` (${r.error.reset})` : ''}.` : kind === 'auth' ? `${aiName(agent)} isn't signed in. Sign in under Settings › Accounts.` : kind === 'cancelled' ? 'Stopped.' : kind === 'wrong_repo' ? r.error.message : r.error?.message || 'Something went wrong.';
    post({ who: agent, role, err: true, text: why + (r.partial ? `\n\n${r.partial}` : ''), steps, outcome: outcomeSteps(r), ...(r.changes?.files?.length ? { changes: changesOf(r) } : {}) });
    await save();
    await loadChats();
    return null;
  }
  const { text, previews: fenced } = extractPreviews(r.text || '');
  const previews = [...(r.previews || []), ...fenced].map((p) => ({ id: uid(), name: p.name, kind: p.kind || kindOf(p.name), content: p.content }));
  const { acts, refused } = parseActs(text, { agent, enabled: S.settings.actForMe === true });
  const shown = text.split('\n').filter((l) => !/^\s*ACT FOR OWNER:/i.test(l.replace(/[*`]/g, ''))).join('\n').trim();
  const msg = post({
    who: agent, role, text: shown || (previews.length ? 'Here\'s the preview.' : '(no text)'), via: r.via, steps,
    outcome: outcomeSteps({ ...r, previews }), previews,
    ...(r.changes?.files?.length ? { changes: changesOf(r) } : {}),
    ...(r.pushed?.ok ? { actions: { branch: r.pushed.branch, sha: r.pushed.sha, state: 'queued', since: now() } } : {}),
    ...(acts.length ? { acts: acts.map((a) => makeAct(a.kind, { chatId: c.id, sha: r.status?.head || null })) } : {}),
    ...(refused.length ? { refusedActs: refused } : {}),
  });
  if (previews.length) openPane(msg.id, previews[0].id);
  await save();
  await loadChats();
  if (msg.actions) pollRuns(msg.id);
  pushPhone();
  return { text: shown, changes: r.changes, msgId: msg.id };
}
const changesOf = (r) => ({ ...r.changes, head: r.status?.head || null, unpushed: Boolean(r.status?.unpushed), pushed: r.pushed?.ok ? r.pushed.branch : null, base: r.changes?.base || r.status?.base, repo: entry()?.repo || null });

async function stopRun() {
  S.stop = true;
  if (S.open) await call('chatCancel', S.open);
  toast('Stopping…');
}

// ---------- the files-changed card ----------
async function cardAction(kind, msgId) {
  const m = S.msgs.find((x) => x.id === msgId);
  const c = entry();
  if (!m || !c) return;
  if (kind === 'diff') {
    const d = await call('chatDiff', c.id);
    S.modal = { kind: 'diff', files: parseDiff(d?.diff || ''), title: `${m.changes?.files?.length || 0} files changed`, branch: m.changes?.branch };
    return render();
  }
  if (kind === 'push') {
    m.busy = 'push'; render();
    const r = await call('chatPush', c.id);
    m.busy = null;
    if (r?.ok) { m.changes = { ...m.changes, pushed: r.branch, unpushed: false, head: r.sha }; m.actions = { branch: r.branch, sha: r.sha, state: 'queued', since: now() }; pollRuns(m.id); toast(`Pushed ${r.branch}.`); }
    else toast(r?.message || 'Not pushed.');
    S.copy = await call('copiesStatus', c.id);
    await save(); return render();
  }
  if (kind === 'pr') {
    m.busy = 'pr'; render();
    const r = await call('chatPr', c.id, { title: c.title, body: prBody(m) });
    m.busy = null;
    if (r?.ok) { m.changes = { ...m.changes, pr: { number: r.number, url: r.url }, pushed: m.changes.branch, unpushed: false }; toast(`Pull request #${r.number || ''} is open.`); if (!m.actions) { const st = await call('copiesStatus', c.id); if (st?.head) { m.actions = { branch: m.changes.branch, sha: st.head, state: 'queued', since: now() }; pollRuns(m.id); } } }
    else toast(r?.message || 'Couldn\'t open a pull request.');
    await save(); return render();
  }
  if (kind === 'merge') {
    m.busy = 'merge'; render();
    // The main process always asks the owner in its own popup before anything is merged.
    const r = await call('chatMerge', c.id, { sha: m.changes?.head || undefined, body: prBody(m) });
    m.busy = null;
    if (r?.ok) { m.changes = { ...m.changes, merged: true, pr: { number: r.number, url: r.url } }; post({ who: 'system', text: `${r.message} (pull request #${r.number}).` }); }
    else if (!r?.cancelled) toast(r?.message || 'Not merged.');
    await save(); return render();
  }
}
const prBody = (m) => `${String(m.text || '').slice(0, 3000)}\n\nMade in Hearth AI Command Center; reviewed and merged by the owner.`;

// GitHub Actions for a pushed commit: polled until it passes or fails.
const polling = new Set();
async function pollRuns(msgId) {
  if (polling.has(msgId)) return;
  polling.add(msgId);
  const chatId = S.open;
  const started = Date.now();
  try {
    while (Date.now() - started < 90 * 60000) {
      if (S.open !== chatId) break;
      const m = S.msgs.find((x) => x.id === msgId);
      if (!m?.actions) break;
      const r = await call('chatRuns', chatId, { branch: m.actions.branch, sha: m.actions.sha });
      if (S.open !== chatId) break;
      if (r?.ok) {
        const state = r.state === 'none' ? (Date.now() - Date.parse(m.actions.since || now()) > 10 * 60000 ? 'none' : 'queued') : r.state;
        m.actions = { ...m.actions, state, runs: r.runs || [], failedRun: r.failedRun || null, checkedAt: now() };
        if (state === 'failure' && r.failedRun && !m.actions.failure) {
          const f = await call('chatFailure', chatId, r.failedRun.id);
          if (f?.ok) m.actions.failure = { job: f.job, annotations: f.annotations || [] };
        }
        render();
        if (['success', 'failure', 'none'].includes(state)) { await save(); break; }
      } else if (r && r.message) { m.actions = { ...m.actions, note: r.message }; render(); }
      await new Promise((res) => setTimeout(res, 20000));
    }
  } finally { polling.delete(msgId); }
}

// ---------- Claude acting for the owner ----------
async function decideAct(actId, yes, how = 'button') {
  const m = S.msgs.find((x) => (x.acts || []).some((a) => a.id === actId));
  const a = m?.acts.find((x) => x.id === actId);
  if (!a || a.status !== 'pending') return;
  if (expired(a)) { a.status = 'expired'; await save(); return render(); }
  a.status = yes ? 'approved' : 'denied';
  a.decidedAt = now();
  a.how = how;
  post({ who: 'system', text: yes ? `You said yes: ${ACT_KINDS[a.kind]}.` : `You said no to: ${ACT_KINDS[a.kind]}.` });
  await save();
  if (!yes) return render();
  const target = [...S.msgs].reverse().find((x) => x.changes) || { id: null };
  if (!target.id) { post({ who: 'system', text: 'There are no changes in this chat to do that with.' }); return save(); }
  await cardAction(a.kind === 'pr' ? 'pr' : a.kind === 'merge' ? 'merge' : 'push', target.id);
}

// ---------- previews ----------
function previewOf(msgId, pid) {
  const m = S.msgs.find((x) => x.id === msgId);
  return m?.previews?.find((p) => p.id === pid) || null;
}
async function openPane(msgId, pid, tab = 'preview') {
  const p = previewOf(msgId, pid);
  if (!p) return;
  S.pane = { msgId, pid, tab, url: null };
  const html = previewDoc({ kind: p.kind, content: p.content, name: p.name, dark: document.documentElement.dataset.mode !== 'light', allowNet: S.settings.previewNetwork === true });
  if (api?.previewServe) { const r = await call('previewServe', html); if (r?.ok) S.pane.url = r.url; }
  S.pane.srcdoc = html;
  renderPane(true);
  renderMain();
}
async function savePreviewToRepo(msgId, pid) {
  const p = previewOf(msgId, pid);
  const c = entry();
  if (!p || !c) return;
  if (!c.repo && !c.repoDir) return toast('Connect this chat to a repo first (the repo chip above the box).');
  S.modal = { kind: 'saveto', msgId, pid, path: `docs/mockups/${p.name}` };
  render();
}

// ---------- voice ----------
async function toggleVoice() {
  if (S.rec) { S.rec.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || !api?.opsVoiceSave) return toast('Voice isn\'t available here.');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const parts = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      S.rec = null;
      render();
      const blob = new Blob(parts, { type: rec.mimeType || 'audio/webm' });
      toast('Turning your voice into text on this PC…');
      const r = await call('opsVoiceSave', await blob.arrayBuffer());
      const t = r?.text || r?.transcript || '';
      if (t) { S.draft = `${S.draft ? `${S.draft} ` : ''}${t}`; render(true); focusComposer(); }
      else toast(r?.message || 'No words were heard (voice needs whisper.cpp on this PC).');
    };
    rec.start();
    S.rec = rec;
    render();
  } catch (e) { toast(`Microphone: ${cleanErr(e)}`); }
}

// ---------- phone view (LAN only, off unless the owner turns it on) ----------
let phoneTimer = null;
function pushPhone() {
  if (!S.phone?.enabled || !api?.opsPhonePush) return;
  clearTimeout(phoneTimer);
  phoneTimer = setTimeout(() => {
    const t = team();
    call('opsPhonePush', {
      project: entry()?.title || 'Chats',
      names: Object.fromEntries(TEAM_IDS.map((a) => [a, aiName(a)])),
      team: t.members.map((a) => ({ id: a, lead: a === t.lead, dot: S.busy?.agent === a ? 'work' : ready(a) ? 'ok' : 'off' })),
      chat: S.msgs.filter((m) => !m.local).slice(-60).map((m) => ({ who: m.who, text: String(m.text || '').slice(0, 4000), at: m.at })),
      waiting: { permissions: [], approvals: [], cards: [] },
      board: [],
    });
  }, 600);
}
function onPhone(a) {
  if (!a || a.type !== 'chat') return;
  const t = String(a.value || '').trim().slice(0, 4000);
  if (!t) return;
  send(`${t}`);
}

// ---------- rendering ----------
const regions = {};
function setRegion(id, html, force = false) {
  const el = document.getElementById(id);
  if (!el) return false;
  if (!force && regions[id] === html) return false;
  regions[id] = html;
  el.innerHTML = html;
  return true;
}

function shell() {
  document.getElementById('app').innerHTML = `<div class="shell" id="shell"><aside class="side" id="side"></aside><main class="main" id="main"><header class="top" id="top"></header><section class="body" id="body"></section><div class="dock" id="dock"></div></main><aside class="pane" id="pane" hidden></aside></div><div id="overlay"></div>`;
}

function render(scroll = false) {
  if (!document.getElementById('shell')) shell();
  renderSide();
  renderMain(scroll);
  renderPane();
  renderOverlay();
}

function renderSide() {
  const groups = groupChats(S.chats, { query: S.search, hits: S.hits });
  const hidden = S.chats.filter((c) => c.hidden);
  const busyId = S.busy ? S.open : null;
  const item = (c) => {
    const on = S.view === 'chat' && S.open === c.id;
    const pend = c.id === S.open && S.msgs.some((m) => (m.acts || []).some((a) => a.status === 'pending' && !expired(a)));
    if (S.renaming === c.id) return `<div class="item on renaming"><input id="rename-input" class="rename" value="${esc(c.title)}" maxlength="120" aria-label="Chat name"><button class="ib sm" data-a="rename-save" title="Save">${icon('check', 'sm')}</button></div>`;
    return `<div class="item ${on ? 'on' : ''}" draggable="true" data-chat="${esc(c.id)}" data-drag="${esc(c.id)}" title="${esc(c.title)}${c.repo ? ` · ${esc(c.repo)}` : ''}">
      ${icon(c.pinned ? 'pin' : 'chat', 'sm')}<span class="t">${esc(c.title)}</span>
      ${busyId === c.id || pend ? '<span class="dot"></span>' : repoHint(c) ? `<span class="repo">${esc(repoHint(c))}</span>` : ''}
      <button class="more" data-a="chat-menu" data-id="${esc(c.id)}" title="More" aria-label="More for ${esc(c.title)}">${icon('dots', 'sm')}</button>
    </div>`;
  };
  const html = `
    <div class="brand"><img src="./icon.png" alt=""><div><b>Hearth AI</b><span>Command Center</span></div></div>
    <button class="newchat" data-a="new-chat"><span class="plus">${icon('plus', 'sm')}</span>New chat</button>
    <label class="search">${icon('search', 'sm')}<input id="chat-search" placeholder="Search chats" value="${esc(S.search)}" aria-label="Search chats"></label>
    <div class="list" id="chat-list">
      ${S.broken ? '<div class="note bad">Your chats list couldn\'t be read. It was left as it is; new chats can\'t be saved until it\'s fixed.</div>' : ''}
      ${groups.map((g) => `<div class="sec">${esc(g.label)}</div>${g.items.map(item).join('')}`).join('') || `<div class="empty-list">${S.search ? 'No chats match.' : 'No chats yet.'}</div>`}
      ${hidden.length ? `<button class="sec link" data-a="toggle-hidden">${icon(S.showHidden ? 'chev' : 'chevr', 'sm')}Hidden (${hidden.length})</button>${S.showHidden ? hidden.map((c) => `<div class="item dim"><span class="t">${esc(c.title)}</span><button class="mini" data-a="unhide" data-id="${esc(c.id)}">Show</button></div>`).join('') : ''}` : ''}
      ${S.trash.length ? `<button class="sec link" data-a="toggle-trash">${icon(S.showTrash ? 'chev' : 'chevr', 'sm')}Recently deleted (${S.trash.length})</button>${S.showTrash ? S.trash.map((t) => `<div class="item dim"><span class="t">${esc(t.title)}</span><button class="mini" data-a="restore" data-id="${esc(t.trashId)}">Restore</button></div>`).join('') : ''}` : ''}
    </div>
    <div class="owner"><span class="av">${esc(ownerName()[0] || 'D')}</span><div><b>${esc(ownerName())}</b><span>${esc(team().members.filter(ready).map(aiName).join(' · ') || 'Set up your AI team')}</span></div><button class="ib ghost" data-a="settings" title="Settings" aria-label="Settings">${icon('gear')}</button></div>`;
  const focused = document.activeElement?.id;
  const sel = focused === 'chat-search' ? document.activeElement.selectionStart : null;
  if (setRegion('side', html) && focused === 'chat-search') { const el = document.getElementById('chat-search'); el.focus(); try { el.setSelectionRange(sel, sel); } catch {} }
  if (S.renaming) { const el = document.getElementById('rename-input'); if (el && document.activeElement !== el) { el.focus(); el.select(); } }
}

function topbar() {
  const c = entry();
  const title = S.view === 'settings' ? 'Settings' : S.view === 'chat' ? (c?.title || 'Chat') : '';
  const chip = S.view === 'chat' && c && (c.repo || c.repoDir) ? `<button class="chip" data-a="repo-pop" title="Connected repo">${icon('gh', 'sm')}${esc(c.repo || c.repoDir)} <span class="faint">· ${esc(c.branch || S.copy?.base || 'default branch')}</span></button>` : '';
  return `<span class="ttl">${esc(title)}</span>${chip}<span class="grow"></span>
    <button class="tb" data-a="team-pop" title="Who's in this chat">${icon('users', 'sm')}Team</button>
    <button class="tb" data-a="toggle-pane" title="Live preview panel" ${S.view !== 'chat' ? 'disabled' : ''}>${icon('panel', 'sm')}</button>`;
}

function renderMain(scroll = false) {
  setRegion('top', topbar());
  const body = document.getElementById('body');
  const atBottom = body ? body.scrollHeight - body.scrollTop - body.clientHeight < 120 : true;
  let html = '';
  let dock = '';
  if (S.view === 'settings') { html = settingsView(); dock = ''; }
  else if (S.view === 'chat') { html = chatView(); dock = composer(S.open && S.msgs.some((m) => m.previews?.length) && S.pane ? 'Ask for changes to the preview…' : 'Reply to the team…') + `<div class="hint">${esc(hintLine())}</div>`; }
  else { html = homeView(); dock = ''; }
  document.getElementById('main').classList.toggle('home-mode', S.view === 'home');
  document.getElementById('main').classList.toggle('settings-mode', S.view === 'settings');
  setRegion('body', html);
  const focused = document.activeElement?.id === 'composer';
  const caret = focused ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  if (setRegion('dock', dock) && focused) focusComposer(caret);
  if (S.view === 'home' && focused) focusComposer(caret);
  fitComposer();
  if (body && (scroll || atBottom) && S.view === 'chat') body.scrollTop = body.scrollHeight;
}

function hintLine() {
  const names = live().map(aiName);
  const c = entry();
  const who = names.length ? `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.slice(-1)}` : names[0]} see${names.length > 1 ? '' : 's'} this chat` : 'No AI is set up yet';
  return c && (c.repo || c.repoDir) ? `${who} · changes go to a branch · main only changes when you approve` : `${who} · no repo connected`;
}

function homeView() {
  return `<div class="home">
    <h1><img src="./icon.png" alt="">${esc(greeting())}, ${esc(ownerName())}</h1>
    ${composer('What should the team work on?')}
    <div class="sugs">${QUICK.map(([ic, label], i) => `<button class="sug" data-a="quick" data-i="${i}">${icon(ic, 'sm')}${esc(label)}</button>`).join('')}</div>
    <div class="fine">Every chat can connect to one of your GitHub repos. The team works in a small temporary copy on this PC; builds and tests run in GitHub Actions.</div>
    ${S.notices.length ? `<div class="notices">${S.notices.map((n, i) => `<div class="note">${esc(n)}<button class="mini" data-a="dismiss" data-i="${i}">Dismiss</button></div>`).join('')}</div>` : ''}
    ${S.idle.length ? `<div class="notices">${S.idle.map((c) => `<div class="note warn">The temporary copy for “${esc(entry(c.chatId)?.title || c.repo || 'a chat')}” has work that isn't on GitHub, so it was kept. <button class="mini" data-a="open-data">Look at it</button></div>`).join('')}</div>` : ''}
  </div>`;
}

function composer(placeholder) {
  const c = S.view === 'chat' ? entry() : null;
  const conn = c ? (c.repo ? { repo: c.repo, branch: c.branch } : c.repoDir ? { repo: c.repoDir } : null) : S.conn;
  const t = team();
  const teamLabel = S.mode === 'team' ? `Team <span class="faint">(${esc(aiName(t.lead))} ★ leads)</span>` : esc(aiName(S.mode));
  const thumbs = S.attach.map((a, i) => a.kind === 'image' ? `<div class="th" style="background-image:url('${esc(a.url || '')}')" title="${esc(a.name)}"><button class="x" data-a="unattach" data-i="${i}" aria-label="Remove">${icon('x', 'sm')}</button></div>` : `<div class="th f" title="${esc(a.name)}"><span>${esc(a.name)}</span><button class="x" data-a="unattach" data-i="${i}" aria-label="Remove">${icon('x', 'sm')}</button></div>`).join('');
  const busy = Boolean(S.busy);
  return `<div class="composer ${busy ? 'busy' : ''}" id="composer-box">
    ${thumbs ? `<div class="thumbs">${thumbs}</div>` : ''}
    <textarea id="composer" rows="1" placeholder="${esc(placeholder)}" aria-label="Message">${esc(S.draft)}</textarea>
    <div class="row">
      <button class="ib" data-a="attach" title="Attach files and images (or paste a screenshot)" aria-label="Attach">${icon('plus', 'sm')}</button>
      <button class="chip ${conn ? '' : 'off'}" data-a="repo-pop" title="Connect a GitHub repo">${icon('gh', 'sm')}${conn ? `${esc(String(conn.repo).split('/').pop())} <span class="faint">· ${esc(conn.branch || 'main')}</span>` : 'No repo'}</button>
      <button class="chip" data-a="team-pop" title="Who answers">${icon('at', 'sm')}${teamLabel}</button>
      <button class="chip sw ${S.web ? 'on' : ''}" data-a="toggle-web" aria-pressed="${S.web}" title="Web search and reading pages">${icon('globe', 'sm')}Web</button>
      <button class="chip sw ${S.build ? 'on' : ''}" data-a="toggle-build" aria-pressed="${S.build}" title="Run quick checks here, push to the chat's branch, builds in GitHub Actions">${icon('play', 'sm')}Run &amp; build</button>
      <span class="grow"></span>
      <button class="ib ${S.rec ? 'rec' : ''}" data-a="voice" title="${S.rec ? 'Stop recording' : 'Talk instead of typing'}" aria-label="Voice">${icon('mic', 'sm')}</button>
      ${busy ? `<button class="send stop" data-a="stop" title="Stop" aria-label="Stop">${icon('stop', 'sm')}</button>` : ''}<button class="send" data-a="send" title="Send (Enter)" aria-label="Send">${icon('up', 'sm')}</button>
    </div>
  </div>`;
}

function focusComposer(caret) {
  const el = document.getElementById('composer');
  if (!el) return;
  el.focus();
  const n = caret || [el.value.length, el.value.length];
  try { el.setSelectionRange(n[0], n[1]); } catch {}
}
function fitComposer() {
  const el = document.getElementById('composer');
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.35))}px`;
}

function chatView() {
  const msgs = S.msgs.filter((m) => !m.deleted);
  const lastChanges = [...msgs].reverse().find((m) => m.changes)?.id;
  const items = msgs.map((m) => message(m, m.id === lastChanges)).join('');
  const working = S.busy ? `<div class="msg-a working"><div class="who">${mono(S.busy.agent)}<b>${esc(aiName(S.busy.agent))}</b>${S.busy.role === 'lead' ? '<span class="star">★ lead</span>' : S.busy.role === 'reviewer' ? '<span>· reviewer</span>' : ''}<span>· working</span><span class="dots"><i></i><i></i><i></i></span></div>${stepsHtml(S.busy.steps, [], true)}</div>` : '';
  const empty = !msgs.length && !S.busy ? `<div class="chat-empty"><p>Ask the team anything. ${entry()?.repo ? `They work in a temporary copy of <b>${esc(entry().repo)}</b> and push to their own branch.` : 'Connect a repo from the box below to let them change code.'}</p></div>` : '';
  return `<div class="col">${empty}${items}${working}</div>`;
}

function stepsHtml(steps = [], outcome = [], liveNow = false, actions = null) {
  // The app's own "Edited N files … committed as you" row replaces the AI's edit rows.
  const summary = outcome.some((o) => o.kind === 'edit-summary');
  const rows = [...groupSteps(steps).filter((r) => !(summary && r.kind === 'edit')), ...outcome];
  if (actions) {
    const st = actions.state;
    rows.push({ icon: 'play', label: st === 'success' ? 'Ran the tests' : st === 'failure' ? 'Tests failed' : st === 'none' ? 'No tests ran' : 'Running the tests', detail: 'in GitHub Actions', note: st === 'success' ? `✓ passed${actions.runs?.length > 1 ? ` · ${actions.runs.length} workflows` : ''}` : st === 'failure' ? '✗ see below' : st === 'none' ? '' : 'running…', ok: st === 'success', bad: st === 'failure' });
  }
  if (!rows.length) return liveNow ? '<div class="steps"><div class="step"><span class="faint">Starting…</span></div></div>' : '';
  return `<div class="steps">${rows.map((r) => `<div class="step ${r.bad ? 'bad' : ''}">${icon(r.icon || 'cpu', 'sm')}<b>${esc(r.label)}</b>${r.detail ? `<span class="d">${esc(r.detail)}</span>` : ''}${r.open ? `<button class="r link ok" data-a="open-preview-name" data-name="${esc(r.detail)}">${esc(r.note)}</button>` : r.note ? `<span class="r ${r.ok ? 'ok' : ''}">${esc(r.note)}</span>` : ''}</div>`).join('')}</div>`;
}

function message(m, latestChanges) {
  if (m.who === 'owner') {
    const atts = (m.attachments || []).map((a) => a.kind === 'image' ? `<img class="att" src="${esc(a.url || '')}" alt="${esc(a.name)}">` : `<span class="att-f">${icon('doc', 'sm')}${esc(a.name)}</span>`).join('');
    return `<div class="msg-u">${atts ? `<div class="atts">${atts}</div>` : ''}${md(m.text)}</div>`;
  }
  if (m.who === 'system') return `<div class="msg-s">${md(m.text)}</div>`;
  const role = m.role === 'lead' ? '<span class="star">★ lead</span>' : m.role === 'reviewer' ? '<span>· reviewer</span>' : '';
  const when = ago(m.at);
  return `<div class="msg-a ${m.err ? 'err' : ''}" data-msg="${esc(m.id)}">
    <div class="who">${mono(m.who)}<b>${esc(aiName(m.who))}</b>${role}${when ? `<span>· ${esc(when)}</span>` : ''}${m.via ? `<span class="faint">· ${esc(m.via)}</span>` : ''}</div>
    ${stepsHtml(m.steps, m.outcome || [], false, m.actions)}
    <div class="text">${md(m.text)}</div>
    ${(m.previews || []).map((p) => previewCard(m, p)).join('')}
    ${m.changes ? changesCard(m, latestChanges) : ''}
    ${m.actions && ['failure'].includes(m.actions.state) ? actionsCard(m) : ''}
    ${(m.acts || []).map((a) => actCard(a)).join('')}
    ${(m.refusedActs || []).map((r) => `<div class="msg-s">Claude asked to “${esc(r.kind)}”, which isn't allowed: ${esc(r.reason)}.</div>`).join('')}
  </div>`;
}

function previewCard(m, p) {
  return `<div class="card pv"><div class="hd">${icon('eye', 'sm')}<b>${esc(p.name)}</b><span class="grow"></span><span class="chip">Live preview</span></div>
    <div class="ft"><button class="btn p" data-a="open-preview" data-m="${esc(m.id)}" data-p="${esc(p.id)}">Open</button><button class="btn" data-a="download-preview" data-m="${esc(m.id)}" data-p="${esc(p.id)}">${icon('dl', 'sm')}Download</button><button class="btn" data-a="save-preview" data-m="${esc(m.id)}" data-p="${esc(p.id)}">${icon('gh', 'sm')}Save to repo…</button></div></div>`;
}

function changesCard(m, latest) {
  const ch = m.changes;
  const files = ch.files || [];
  const base = ch.base || 'main';
  const state = m.actions?.state;
  const badge = ch.merged ? '<span class="chip g">merged</span>' : state === 'success' ? '<span class="chip g">tests passed</span>' : state === 'failure' ? '<span class="chip b">tests failed</span>' : state && state !== 'none' ? '<span class="chip">tests running</span>' : ch.pushed ? '<span class="chip">on GitHub</span>' : '<span class="chip">only on this PC</span>';
  const busy = m.busy;
  const canAct = latest && !ch.merged && entry()?.repo;
  return `<div class="card ch"><div class="hd">${icon('branch', 'sm')}<b>${files.length} file${files.length === 1 ? '' : 's'} changed</b>${ch.branch ? `<span class="chip">${esc(ch.branch)}</span>` : ''}<span class="grow"></span>${badge}</div>
    <div class="bd">${files.slice(0, 12).map((f) => `<div>${esc(f.path)} ${f.binary ? '<span class="faint">binary</span>' : `<span class="add">+${f.add}</span> <span class="del">−${f.del}</span>`}</div>`).join('')}${files.length > 12 ? `<div class="faint">and ${files.length - 12} more</div>` : ''}</div>
    <div class="ft">
      ${canAct ? (ch.pr ? `<a class="btn p" href="${esc(ch.pr.url)}" target="_blank" rel="noopener">${icon('branch', 'sm')}Pull request #${esc(ch.pr.number)}</a>` : `<button class="btn p" data-a="card-pr" data-m="${esc(m.id)}" ${busy ? 'disabled' : ''}>${icon('branch', 'sm')}${busy === 'pr' ? 'Opening…' : 'Open pull request'}</button>`) : ''}
      <button class="btn" data-a="card-diff" data-m="${esc(m.id)}">${icon('eye', 'sm')}Show changes</button>
      ${canAct && !ch.pushed ? `<button class="btn" data-a="card-push" data-m="${esc(m.id)}" ${busy ? 'disabled' : ''}>${icon('push', 'sm')}${busy === 'push' ? 'Pushing…' : 'Push to branch'}</button>` : ''}
      ${canAct ? `<button class="btn ghost" data-a="card-merge" data-m="${esc(m.id)}" ${busy ? 'disabled' : ''}>${busy === 'merge' ? 'Merging…' : `Merge into ${esc(base)}…`}</button>` : ''}
      <span class="grow"></span><span class="fine">${ch.merged ? `Merged into ${esc(base)}` : entry()?.repo ? 'Merging asks you first' : 'Local repo: push and merge in your own git'}</span>
    </div></div>`;
}

function actionsCard(m) {
  const a = m.actions;
  const label = { queued: 'Waiting for GitHub Actions to start…', pending: 'GitHub Actions is running…', success: 'GitHub Actions passed', failure: 'GitHub Actions failed', none: 'No GitHub Actions ran for this push' }[a.state] || 'GitHub Actions';
  const runs = (a.runs || []).map((r) => `<div class="run"><span class="dot ${r.conclusion === 'success' ? 'g' : ['failure', 'timed_out', 'startup_failure'].includes(r.conclusion) ? 'b' : r.status === 'completed' ? '' : 'w'}"></span>${esc(r.name)}${r.url?.startsWith('https://github.com/') ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener">open</a>` : ''}</div>`).join('');
  const f = a.failure;
  const ann = f ? `<div class="ann"><b>${esc(f.job?.name || 'Failing job')}${f.job?.step ? ` › ${esc(f.job.step)}` : ''}</b>${(f.annotations || []).slice(0, 8).map((x) => `<div class="a ${esc(x.level)}"><span class="mono">${esc(x.path)}${x.line ? `:${x.line}` : ''}</span> ${esc(x.message)}</div>`).join('') || '<div class="faint">No error lines were reported; open the run on GitHub.</div>'}</div>` : '';
  return `<div class="card act ${a.state}"><div class="hd">${icon('play', 'sm')}<b>${esc(label)}</b><span class="chip">${esc(a.branch)}</span><span class="grow"></span><span class="fine mono">${esc(String(a.sha || '').slice(0, 7))}</span></div>${runs || ann ? `<div class="bd plain">${runs}${ann}</div>` : ''}${a.state === 'failure' ? `<div class="ft"><button class="btn" data-a="fix-failure" data-m="${esc(m.id)}">Ask the team to fix it</button></div>` : ''}</div>`;
}

function actCard(a) {
  const st = a.status === 'pending' && expired(a) ? 'expired' : a.status;
  return `<div class="card askc"><div class="hd">${icon('shield', 'sm')}<b>Claude asks: ${esc(ACT_KINDS[a.kind] || a.kind)}</b></div><div class="ft">${st === 'pending' ? `<button class="btn p" data-a="act-yes" data-id="${esc(a.id)}">Yes, do it</button><button class="btn" data-a="act-no" data-id="${esc(a.id)}">No</button><span class="fine">or type yes / no</span>` : `<span class="fine">${st === 'approved' ? 'You said yes.' : st === 'denied' ? 'You said no.' : 'Expired (30 minutes).'}</span>`}</div></div>`;
}

// ---------- the preview panel ----------
let paneKey = '';
function renderPane(force = false) {
  const el = document.getElementById('pane');
  if (!el) return;
  const p = S.pane ? previewOf(S.pane.msgId, S.pane.pid) : null;
  const show = Boolean(p) && S.view === 'chat';
  el.hidden = !show;
  document.getElementById('shell')?.classList.toggle('with-pane', show);
  if (!show) { if (paneKey) { el.innerHTML = ''; paneKey = ''; } return; }
  const key = `${S.pane.msgId}|${S.pane.pid}|${S.pane.tab}|${S.pane.url || ''}|${S.pane.n || 0}`;
  if (!force && key === paneKey) return;
  paneKey = key;
  el.innerHTML = `<div class="ph2"><b>${esc(p.name)}</b><div class="tabs"><button class="${S.pane.tab === 'preview' ? 'on' : ''}" data-a="pane-tab" data-t="preview">Preview</button><button class="${S.pane.tab === 'code' ? 'on' : ''}" data-a="pane-tab" data-t="code">Code</button></div><span class="grow"></span><button class="tb" data-a="pane-reload" title="Reload">${icon('refresh', 'sm')}</button><button class="tb" data-a="pane-close" title="Close">${icon('x', 'sm')}</button></div>
    <div class="frame-wrap">${S.pane.tab === 'code' ? `<pre class="code-view"><code>${esc(p.content)}</code></pre>` : frameHtml({ url: S.pane.url, srcdoc: S.pane.url ? null : S.pane.srcdoc, title: p.name })}</div>
    <div class="pfoot">${S.settings.previewNetwork ? 'Previews may load from the internet (Settings › Tools).' : 'Sandboxed: no internet, no access to the app or your files.'}</div>`;
}

// ---------- popovers, modals, toast ----------
function renderOverlay() {
  let html = '';
  if (S.pop) html += popHtml();
  if (S.modal) html += modalHtml();
  if (S.toast) html += `<div class="toast">${esc(S.toast.text)}${S.toast.undo ? `<button class="mini" data-a="undo">${icon('undo', 'sm')}Undo</button>` : ''}</div>`;
  setRegion('overlay', html);
  if (S.pop?.kind === 'repo') { const el = document.getElementById('repo-q'); if (el && document.activeElement !== el && !S.pop.noFocus) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
}

function popHtml() {
  const p = S.pop;
  if (p.kind === 'menu') {
    const c = entry(p.id);
    if (!c) return '';
    const it = (a, ic, label) => `<button class="it" data-a="chat-act" data-k="${a}" data-id="${esc(c.id)}">${icon(ic, 'sm')}${label}</button>`;
    return `<div class="scrim" data-a="close-pop"></div><div class="pop menu" style="left:${p.x}px;top:${p.y}px">
      ${it('rename', 'pencil', 'Rename')}${it(c.pinned ? 'unpin' : 'pin', 'pin', c.pinned ? 'Unpin' : 'Pin to the top')}${it('up', 'up', 'Move up')}${it('down', 'chev', 'Move down')}
      ${it('connect', 'gh', c.repo || c.repoDir ? 'Connect to another repo…' : 'Connect to a repo…')}
      ${c.hasCopy ? it('close', 'x', 'Close (remove its temporary copy)') : ''}
      ${it('hide', 'eyeoff', 'Hide')}<div class="sep"></div>${it('delete', 'trash', 'Delete')}</div>`;
  }
  if (p.kind === 'team') {
    const t = team();
    const opt = (v, label, sub) => `<button class="it ${S.mode === v ? 'on' : ''}" data-a="set-mode" data-v="${v}">${label}<small>${sub}</small></button>`;
    return `<div class="scrim" data-a="close-pop"></div><div class="pop" style="${p.top ? 'right:20px;top:52px' : `left:${p.x}px;bottom:${p.b}px`}"><div class="mh">Who answers</div>
      ${opt('team', `${icon('users', 'sm')}Whole team`, `${esc(aiName(t.lead))} ★ leads`)}
      ${t.members.map((a) => opt(a, `${mono(a, 'sm')}${esc(aiName(a))}`, ready(a) ? (a === t.lead ? 'lead' : a === t.reviewer ? 'reviewer' : 'ready') : 'not set up')).join('')}
      <div class="note">Or type @name in your message to ask one AI. Change who's in the team in Settings › AI team.</div></div>`;
  }
  if (p.kind === 'repo') {
    const q = S.repoQuery.toLowerCase();
    const repos = (S.repos || []).filter((r) => !q || r.full.toLowerCase().includes(q)).slice(0, 8);
    const c = p.chatId ? entry(p.chatId) : S.view === 'chat' ? entry() : null;
    const cur = c ? c.repo : S.conn?.repo;
    const sel = S.pickRepo || cur || repos[0]?.full || null;
    const br = sel ? S.branches[sel] : null;
    const curBranch = S.pickBranch || (sel === cur ? (c ? c.branch : S.conn?.branch) : null) || br?.default || 'main';
    return `<div class="scrim" data-a="close-pop"></div><div class="pop repo-pop" style="left:${p.x ?? 620}px;${p.b != null ? `bottom:${p.b}px` : `top:${p.y ?? 330}px`};${p.maxH ? `max-height:${p.maxH}px` : ''}"><div class="mh">Connect this chat to a GitHub repo</div>
      <label class="search in">${icon('search', 'sm')}<input id="repo-q" placeholder="Search your repos" value="${esc(S.repoQuery)}"></label>
      ${S.reposMsg ? `<div class="note">${esc(S.reposMsg)}</div>` : ''}
      ${repos.map((r) => `<button class="it ${r.full === sel ? 'on' : ''}" data-a="pick-repo" data-r="${esc(r.full)}">${icon('gh', 'sm')}${esc(r.full)}<small>${r.private ? 'private' : 'public'}${r.pushedAt ? ` · ${esc(ago(r.pushedAt))}` : ''}</small></button>`).join('')}
      <div class="sep"></div>
      <div class="it static">${icon('branch', 'sm')}Branch<select id="branch-sel" ${sel ? '' : 'disabled'}>${(br?.branches?.length ? br.branches : [curBranch]).map((b) => `<option ${b === curBranch ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></div>
      <button class="it" data-a="connect-repo" ${sel ? '' : 'disabled'}>${icon('check', 'sm')}${sel ? `Use ${esc(sel.split('/').pop())}` : 'Pick a repo'}</button>
      <button class="it" data-a="no-repo">${icon('x', 'sm')}No repo, just talk</button>
      <div class="note">The team works in a small temporary copy on this PC (newest commit only) and pushes to the chat's own branch; builds and tests run in GitHub Actions. The copy is deleted when you close the chat or it sits idle.</div></div>`;
  }
  return '';
}

function modalHtml() {
  const m = S.modal;
  if (m.kind === 'diff') {
    const files = m.files || [];
    return `<div class="scrim dark" data-a="close-modal"></div><div class="modal wide diffm"><div class="mhd"><b>${esc(m.title)}</b>${m.branch ? `<span class="chip">${esc(m.branch)}</span>` : ''}<span class="grow"></span><button class="tb" data-a="close-modal">${icon('x', 'sm')}</button></div>
      <div class="diff-body"><nav class="dfiles">${files.map((f, i) => `<a href="#df${i}">${esc(f.path)} <span class="add">+${f.add}</span> <span class="del">−${f.del}</span></a>`).join('') || '<span class="faint">No changes.</span>'}</nav>
      <div class="dview">${files.map((f, i) => `<section id="df${i}" class="dfile"><h4>${esc(f.path)} <span class="faint">${esc(f.status)}</span></h4>${f.binary ? '<div class="faint pad">Binary file</div>' : f.hunks.map((h) => `<div class="hunk"><div class="hh">${esc(h.header)}</div>${h.lines.map((l) => `<div class="dl ${l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''}"><span class="ln">${l.o ?? ''}</span><span class="ln">${l.n ?? ''}</span><span class="tx">${esc(l.t === '\\' ? l.text : `${l.t}${l.text}`)}</span></div>`).join('')}</div>`).join('')}</section>`).join('')}</div></div></div>`;
  }
  if (m.kind === 'unpushed') {
    const c = entry(m.chatId);
    const verb = m.then === 'delete' ? 'deleting this chat' : m.then === 'connect' ? 'switching repos' : 'removing the copy';
    return `<div class="scrim dark"></div><div class="modal"><div class="mhd"><b>This copy has work that isn't on GitHub</b></div>
      <p>The temporary copy of ${esc(c?.repo || c?.repoDir || 'the repo')} for “${esc(c?.title || 'this chat')}” holds changes that were never pushed. Before ${verb}, push them to the chat's own branch so nothing is lost.</p>
      <div class="mft"><button class="btn p" data-a="unpushed-push">${icon('push', 'sm')}Push to a branch first</button><button class="btn" data-a="unpushed-force">Delete the work…</button><button class="btn ghost" data-a="close-modal">Cancel</button></div></div>`;
  }
  if (m.kind === 'saveto') {
    return `<div class="scrim dark" data-a="close-modal"></div><div class="modal"><div class="mhd"><b>Save the preview to the repo</b></div>
      <p>It's saved in this chat's temporary copy and committed as you, on the chat's branch. Push or open a pull request to put it on GitHub.</p>
      <label class="field">Path in the repo<input id="saveto-path" value="${esc(m.path)}"></label>
      <div class="mft"><button class="btn p" data-a="saveto-do">Save</button><button class="btn ghost" data-a="close-modal">Cancel</button></div></div>`;
  }
  if (m.kind === 'board') {
    const b = m.board;
    return `<div class="scrim dark" data-a="close-modal"></div><div class="modal wide"><div class="mhd"><b>${esc(b.name)} — old board (read-only)</b><span class="grow"></span><button class="tb" data-a="close-modal">${icon('x', 'sm')}</button></div>
      <p class="fine">${b.tasks.length} tasks · ${b.approvals} approval requests · ${b.audit} audit entries · ${b.chat} chat messages. Kept exactly as they were in ${esc(b.file)}.</p>
      <div class="tbl">${b.tasks.map((t) => `<div class="tr"><span class="mono faint">T-${esc(t.id)}</span><span>${esc(t.title)}</span><span class="chip">${esc(t.stage)}</span><span class="faint">${esc(aiName(t.assignee) || '')}</span></div>`).join('') || '<div class="faint">No tasks.</div>'}</div></div>`;
  }
  return '';
}

// ---------- settings ----------
function settingsView() {
  const nav = SECTIONS.map(([k, label]) => `<button class="${S.tab === k ? 'on' : ''}" data-a="tab" data-t="${k}">${esc(label)}</button>`).join('');
  return `<div class="set"><nav class="snav">${nav}</nav><div class="spage">${section(S.tab)}</div></div>`;
}
const tog = (on, a, extra = '') => `<button class="tog ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-a="${a}" ${extra}></button>`;
function section(k) {
  const s = S.settings;
  const t = team();
  if (k === 'team') {
    return `<h1>AI team</h1><div class="box"><h3>Who's in your chats</h3>
      ${TEAM_IDS.map((a) => { const inTeam = t.members.includes(a); const r = ready(a); return `<div class="srow mem">${mono(a)}<b>${esc(aiName(a))}</b><span class="d">${a === t.lead ? 'lead ★ · ' : a === t.reviewer ? 'reviewer · ' : ''}${esc(AGENTS[a].tool)}${r ? `, ${esc(AGENTS[a].plan)}` : ' · not set up'}${inTeam ? '' : ' · off'}</span><span class="grow"></span>${inTeam && a !== t.lead && AGENTS[a].edits ? `<button class="mini" data-a="make-lead" data-v="${a}">Make lead</button>` : ''}${inTeam && a !== t.lead && a !== t.reviewer ? `<button class="mini" data-a="make-reviewer" data-v="${a}">Make reviewer</button>` : ''}${tog(inTeam, 'team-member', `data-v="${a}" ${a === t.lead ? 'disabled title="The lead is always in"' : ''}`)}</div>`; }).join('')}
      <div class="note">The lead (Claude unless you change it) answers first and hands parts to teammates. When the lead changes files, the reviewer checks the diff. Type @name in a message to ask one AI. ${t.reviewer ? '' : 'No reviewer is set.'}</div>
      ${t.reviewer ? '<button class="mini" data-a="no-reviewer">No reviewer</button>' : ''}</div>`;
  }
  if (k === 'accounts') {
    return `<h1>Accounts</h1><div class="box"><h3>Your AI accounts</h3><p class="fine">Each AI signs in with your own account in its own official app. The Command Center never holds your passwords.</p>
      ${TEAM_IDS.map((a) => { const c = S.cli[a] || {}; const isApi = method(a) === 'api'; const st = isApi ? (S.prov.keys?.[a] ? 'API key saved' : 'needs an API key') : !c.installed ? 'not installed' : c.signedIn === false ? 'not signed in' : c.signedIn ? 'signed in' : 'installed'; return `<div class="srow">${mono(a)}<b>${esc(aiName(a))}</b><span class="d">${esc(AGENTS[a].tool)} · ${esc(st)}</span><span class="grow"></span>${isApi ? `<button class="mini" data-a="set-key" data-v="${a}">${S.prov.keys?.[a] ? 'Change key' : 'Add key'}</button>` : !c.installed && a !== 'ollama' ? `<button class="mini" data-a="install" data-v="${a}">Install</button>` : c.signedIn === false ? `<button class="mini" data-a="signin" data-v="${a}">Sign in</button>` : ''}<button class="mini" data-a="recheck" data-v="${a}">Re-check</button></div>`; }).join('')}</div>
      <div class="box"><h3>${icon('phone', 'sm')}Your phone</h3><div class="srow">Phone view<span class="d">your chat on your phone, on your home network only</span><span class="grow"></span>${tog(Boolean(S.phone?.enabled), 'phone-toggle')}</div>${S.phone?.enabled ? `<div class="srow">Address<span class="d mono">${esc((S.phone.urls || []).join(', ') || 'starting…')}</span><span class="grow"></span><button class="mini" data-a="phone-code">Show pairing code</button></div>${S.phone.code ? `<div class="srow">Code<b class="mono big">${esc(S.phone.code)}</b><span class="d">type it on your phone within 5 minutes</span></div>` : ''}` : ''}</div>`;
  }
  if (k === 'github') {
    const id = s.ownerIdentity;
    return `<h1>GitHub</h1><div class="box"><h3>${icon('gh', 'sm')}GitHub</h3>
      <div class="srow">Signed in as <b>${esc(S.gh.ghUser || 'nobody yet')}</b><span class="d">through gh${S.repos ? ` · ${S.repos.length} repos` : ''}</span><span class="grow"></span><button class="btn" data-a="gh-login">${S.gh.ghUser ? 'Change' : 'Sign in'}</button></div>
      <div class="srow">Work in temporary copies<span class="d">a chat with a repo gets a small shallow copy on this PC (newest commit only, about 5–100 MB); the team edits and runs quick checks there and pushes to its own branch; builds and tests run in GitHub Actions</span></div>
      <div class="srow">Remove idle copies after<span class="grow"></span><select data-a="idle-hours">${IDLE.map(([v, l]) => `<option value="${v}" ${s.copyIdleHours === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="srow">Commits as<span class="d mono">${esc(id ? `${id.name} <${id.email}>` : 'Dragongamer9 <Dragongamer9@users.noreply.github.com>')}, no AI lines</span><span class="grow"></span><button class="mini" data-a="edit-identity">Change</button></div>
      ${S.editIdentity ? `<div class="srow"><input id="id-name" placeholder="Name" value="${esc(id?.name || 'Dragongamer9')}"><input id="id-email" placeholder="Email" value="${esc(id?.email || 'Dragongamer9@users.noreply.github.com')}"><button class="btn p" data-a="save-identity">Save</button></div>` : ''}
      <div class="note">Pushing to main, the chat's base branch or a tag is refused in every copy. Merging always asks you.</div></div>`;
  }
  if (k === 'tools') {
    const qc = s.tools?.quickChecks || [];
    return `<h1>Tools</h1><div class="box"><h3>New messages start with</h3>
      <div class="srow">Web<span class="d">search the web and read pages</span><span class="grow"></span>${tog(s.tools?.web !== false, 'tool-web')}</div>
      <div class="srow">Run &amp; build<span class="d">run quick checks on this PC and push to the chat's branch; heavy builds run in GitHub Actions</span><span class="grow"></span>${tog(s.tools?.build !== false, 'tool-build')}</div></div>
      <div class="box"><h3>Quick checks the AIs may run on this PC</h3><p class="fine">One per line: the start of a command. Claude can run only these (plus git and reading files); everything heavier goes to GitHub Actions.</p>
      <textarea id="quick-checks" rows="8" class="mono">${esc(qc.join('\n'))}</textarea><div class="mft left"><button class="btn" data-a="save-checks">Save</button></div></div>
      <div class="box"><h3>Live previews</h3><div class="srow">Previews may load from the internet<span class="d">off: previews can't reach the network (safest)</span><span class="grow"></span>${tog(s.previewNetwork === true, 'preview-net')}</div></div>`;
  }
  if (k === 'perms') {
    return `<h1>Permissions</h1><div class="box"><h3>${icon('shield', 'sm')}Permissions</h3>
      <div class="srow">Claude can do everything I can<span class="d">asks me first every time (popup or typed yes)</span><span class="grow"></span>${tog(s.actForMe === true, 'act-for-me')}</div>
      <div class="srow">Merging into main, releases and tags<span class="d">always ask me</span></div>
      <div class="srow">Version numbers<span class="d">only you set them</span></div>
      <div class="srow">Full access<span class="d">${s.access === 'full' ? 'on: with Run & build, AIs run any command with no checks' : 'off: AIs run only the quick checks you allow'}</span><span class="grow"></span>${tog(s.access === 'full', 'full-access')}</div></div>`;
  }
  if (k === 'look') {
    return `<h1>Appearance</h1><div class="box"><h3>Look</h3>
      <div class="srow">Theme<span class="grow"></span>${['hearth', 'dark', 'light', 'system'].map((v) => `<button class="seg ${s.theme === v ? 'on' : ''}" data-a="theme" data-v="${v}">${{ hearth: 'Follow Hearth OS', dark: 'Dark', light: 'Light', system: 'System' }[v]}</button>`).join('')}</div>
      <div class="srow">Text size<span class="grow"></span>${[100, 115, 130, 150].map((v) => `<button class="seg ${s.textSize === v ? 'on' : ''}" data-a="text-size" data-v="${v}">${v}%</button>`).join('')}</div>
      <div class="srow">Reduce motion<span class="grow"></span>${tog(s.reduceMotion === true, 'reduce-motion')}</div></div>`;
  }
  if (k === 'updates') {
    const u = S.upd;
    const st = u.status || {};
    const msg = !u.enabled ? (u.reason || 'Updates unavailable.') : ({ idle: 'Not checked yet.', checking: 'Checking GitHub Releases…', none: st.message || 'You are on the latest version.', available: `Version ${st.version} is available.`, downloading: `Downloading… ${st.percent || 0}%`, ready: st.deb ? `Version ${st.version} downloaded and its checksum checked. Installing asks for your computer password.` : `Version ${st.version} downloaded. Restart when you're ready.`, installing: st.message || 'Installing…', installed: st.message || 'Installed. Restart to use the new version.', error: st.message || 'Update failed.' }[st.state] || '');
    return `<h1>App updates</h1><div class="box"><h3>${icon('dl', 'sm')}Hearth AI Command Center ${esc(S.info.appVersion || '')}</h3>
      <p class="${st.state === 'error' ? 'bad' : 'fine'}">${esc(msg)}${!u.enabled && u.link?.startsWith('https://github.com/') ? ` <a href="${esc(u.link)}" target="_blank" rel="noopener">Open the release page</a>` : ''}</p>
      ${st.state === 'downloading' ? `<div class="progress"><div style="width:${st.percent || 0}%"></div></div>` : ''}
      ${u.enabled ? `<div class="mft left"><button class="btn" data-a="upd" data-v="check" ${['checking', 'downloading'].includes(st.state) ? 'disabled' : ''}>Check for updates</button>
      ${st.state === 'available' ? `<button class="btn p" data-a="upd" data-v="download">${u.install === 'deb' ? 'Download and install' : 'Download update'}</button>` : ''}
      ${st.state === 'ready' ? `<button class="btn p" data-a="upd" data-v="install">${st.deb ? 'Install (asks for your password)' : 'Restart & install'}</button>` : ''}
      ${st.state === 'installed' ? '<button class="btn p" data-a="upd" data-v="restart">Restart now</button>' : ''}</div>` : ''}
      <p class="fine">Works for the AppImage and the .deb. Version numbers are always yours to pick.</p></div>`;
  }
  if (k === 'data') {
    const cp = S.copies;
    const total = (cp?.list || []).reduce((n, c) => n + (c.size || 0), 0);
    return `<h1>Saved data</h1>
      <div class="box"><h3>${icon('db', 'sm')}Temporary copies</h3>
        <div class="srow">Space used<b>${cp ? fmtBytes(total) : '…'}</b><span class="d">${cp ? `${cp.list.length} cop${cp.list.length === 1 ? 'y' : 'ies'} · removed after ${esc(IDLE.find(([v]) => v === S.settings.copyIdleHours)?.[1] || '1 day')} idle` : ''}</span><span class="grow"></span><button class="btn" data-a="cleanup" ${cp?.list?.length ? '' : 'disabled'}>Clean up</button></div>
        ${(cp?.list || []).map((c) => `<div class="srow copy">${icon('gh', 'sm')}<b>${esc(c.repo || c.dir || '?')}</b><span class="d">${esc(entry(c.chatId)?.title || 'deleted chat')} · ${esc(c.work || c.branch || '')} · ${fmtBytes(c.size)} · used ${esc(ago(c.lastUsedAt) || 'never')}</span><span class="grow"></span>${c.unpushed ? `<span class="chip b">not on GitHub</span><button class="mini" data-a="copy-push" data-id="${esc(c.chatId)}">Push to a branch</button>` : ''}<button class="mini" data-a="copy-remove" data-id="${esc(c.chatId)}">Remove</button></div>`).join('') || '<div class="fine">No temporary copies right now.</div>'}
        <div class="note">Copies holding work that isn't on GitHub are never deleted without asking you. ${cp?.root ? `They live in ${esc(cp.root)}.` : ''}</div></div>
      <div class="box"><h3>Backups</h3><div class="srow">Your chats list keeps its last good copy as a backup, and the list from before 2.0 is kept as index.json.pre-2.<span class="grow"></span><button class="mini" data-a="open-data-folder">Open the data folder</button></div></div>
      <div class="box"><h3>Old boards (read-only)</h3><p class="fine">The task boards, approvals and audit logs from 1.x are kept on disk exactly as they were. They're not used any more.</p>
        ${(S.boards || []).map((b) => `<div class="srow">${icon('board', 'sm')}<b>${esc(b.name)}</b><span class="d">${b.ok ? `${b.tasks.length} tasks · ${b.approvals} approvals · ${b.audit} audit entries` : 'couldn\'t be read (left as it is)'}</span><span class="grow"></span>${b.ok ? `<button class="mini" data-a="view-board" data-id="${esc(b.id)}">View</button>` : ''}</div>`).join('') || '<div class="fine">No old boards.</div>'}</div>`;
  }
  return '';
}

async function loadCopies() { S.copies = await call('copiesList'); render(); }
async function setSettings(patch) {
  const r = await call('setSettings', patch);
  if (r && !r.message && r.tools) { S.settings = r; applyTheme(); }
  else if (r?.message) toast(r.message);
  render();
}

function applyTheme() {
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  const follow = S.settings.theme === 'hearth' && S.theme.found;
  document.documentElement.dataset.mode = pickMode(S.settings.theme, { ...S.theme, systemDark });
  document.documentElement.classList.toggle('reduce-motion', S.settings.reduceMotion === true);
  const set = (id, css) => { let el = document.getElementById(id); if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); } el.textContent = css; };
  set('hearth-tokens', follow ? tokensToCss(S.theme.tokens) : '');
  set('hearth-css', follow ? S.theme.css || '' : '');
}

// ---------- events ----------
function popAt(el, kind, extra = {}) {
  const r = el.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  const up = below < 520 && r.top > below;
  S.pop = { kind, x: Math.max(8, Math.min(r.left, window.innerWidth - 440)), ...(up ? { b: window.innerHeight - r.top + 8, maxH: r.top - 16 } : { y: r.bottom + 6, maxH: below - 16 }), ...extra };
}

document.addEventListener('click', async (ev) => {
  const a = ev.target.closest('[data-a]');
  const chatEl = !a && ev.target.closest('[data-chat]');
  if (chatEl) return openChat(chatEl.dataset.chat);
  if (!a) return;
  const d = a.dataset;
  const k = d.a;
  if (a.tagName === 'SELECT') return;
  ev.preventDefault();
  switch (k) {
    case 'new-chat': return goHome();
    case 'settings': S.view = 'settings'; S.pane = null; render(true); if (S.tab === 'data') { loadCopies(); S.boards = await call('savedBoards'); render(); } return;
    case 'tab': S.tab = d.t; render(); if (d.t === 'data') { loadCopies(); S.boards = await call('savedBoards'); render(); } if (d.t === 'accounts' || d.t === 'team') refreshAgents(); if (d.t === 'github') loadRepos(); return;
    case 'chat-menu': ev.stopPropagation(); { const r = a.getBoundingClientRect(); S.pop = { kind: 'menu', id: d.id, x: Math.min(r.left, window.innerWidth - 260), y: Math.min(r.bottom + 4, window.innerHeight - 330) }; } return renderOverlay();
    case 'chat-act': return chatAction(d.k, d.id);
    case 'close-pop': S.pop = null; S.pickRepo = null; S.pickBranch = null; return renderOverlay();
    case 'close-modal': S.modal = null; return renderOverlay();
    case 'rename-save': return finishRename(true);
    case 'toggle-hidden': S.showHidden = !S.showHidden; return renderSide();
    case 'toggle-trash': S.showTrash = !S.showTrash; return renderSide();
    case 'unhide': await call('chatsUpdate', d.id, { hidden: false }); await loadChats(); return render();
    case 'restore': { const r = await call('chatsRestore', d.id); if (r?.ok === false || r?.message) toast(r.message || 'Not restored.'); await loadChats(); return render(); }
    case 'undo': { const u = S.toast?.undo; S.toast = null; if (u?.kind === 'restore') { await call('chatsRestore', u.trashId); await loadChats(); render(); toast('Restored.'); } return renderOverlay(); }
    case 'repo-pop': S.pick = null; S.repoQuery = ''; S.pickRepo = null; S.pickBranch = null; popAt(a, 'repo', { chatId: S.view === 'chat' ? S.open : null }); renderOverlay(); await loadRepos(); { const c = S.view === 'chat' ? entry() : null; const cur = c?.repo || S.conn?.repo || S.repos?.[0]?.full; if (cur) loadBranches(cur); } return;
    case 'pick-repo': S.pickRepo = d.r; S.pickBranch = null; S.pop.noFocus = true; renderOverlay(); await loadBranches(d.r); return;
    case 'connect-repo': { const c = S.pop?.chatId ? entry(S.pop.chatId) : S.view === 'chat' ? entry() : null; const sel = S.pickRepo || c?.repo || S.conn?.repo || (S.repos || [])[0]?.full; const b = document.getElementById('branch-sel')?.value || null; S.pickRepo = null; return chooseRepo(sel, b); }
    case 'no-repo': S.pickRepo = null; return chooseRepo(null, null);
    case 'team-pop': popAt(a, 'team', { top: a.classList.contains('tb') }); return renderOverlay();
    case 'set-mode': S.mode = d.v; S.pop = null; return render();
    case 'toggle-web': S.web = !S.web; return render();
    case 'toggle-build': S.build = !S.build; return render();
    case 'toggle-pane': if (S.pane) { S.pane = null; } else { const m = [...S.msgs].reverse().find((x) => x.previews?.length); if (m) return openPane(m.id, m.previews[0].id); toast('No live preview in this chat yet.'); } return render();
    case 'attach': { const r = await call('attachPickAny'); for (const x of r || []) { if (x?.ok) S.attach.push(x.att); else if (x?.message) toast(x.message); } return render(); }
    case 'unattach': S.attach.splice(Number(d.i), 1); return render();
    case 'voice': return toggleVoice();
    case 'send': return send();
    case 'stop': return stopRun();
    case 'quick': { const q = QUICK[Number(d.i)]; S.draft = q[2]; render(); focusComposer(); return; }
    case 'dismiss': S.notices.splice(Number(d.i), 1); return render();
    case 'open-data': S.view = 'settings'; S.tab = 'data'; render(); loadCopies(); S.boards = await call('savedBoards'); return render();
    case 'open-preview': return openPane(d.m, d.p);
    case 'open-preview-name': { const m = a.closest('[data-msg]'); const msg = S.msgs.find((x) => x.id === m?.dataset.msg); const p = msg?.previews?.find((x) => x.name === d.name); if (p) openPane(msg.id, p.id); return; }
    case 'download-preview': { const p = previewOf(d.m, d.p); if (p) { const r = await call('previewDownload', p.name, p.content); if (r === null) { const blob = new Blob([p.content], { type: 'text/plain' }); const u = URL.createObjectURL(blob); const l = document.createElement('a'); l.href = u; l.download = p.name; l.click(); URL.revokeObjectURL(u); } else if (r?.ok) toast(`Saved ${r.file}.`); } return; }
    case 'save-preview': return savePreviewToRepo(d.m, d.p);
    case 'saveto-do': { const m = S.modal; const p = previewOf(m.msgId, m.pid); const rel = document.getElementById('saveto-path')?.value || m.path; S.modal = null; const r = await call('chatSaveFile', S.open, rel, p?.content || ''); toast(r?.ok ? `Saved ${r.path} in the chat's branch (committed as you). Push or open a pull request to put it on GitHub.` : r?.message || 'Not saved.'); if (r?.ok) S.copy = await call('copiesStatus', S.open); return render(); }
    case 'pane-tab': S.pane.tab = d.t; return renderPane(true);
    case 'pane-reload': S.pane.n = (S.pane.n || 0) + 1; return renderPane(true);
    case 'pane-close': S.pane = null; return render();
    case 'card-diff': return cardAction('diff', d.m);
    case 'card-push': return cardAction('push', d.m);
    case 'card-pr': return cardAction('pr', d.m);
    case 'card-merge': return cardAction('merge', d.m);
    case 'fix-failure': { const m = S.msgs.find((x) => x.id === d.m); const f = m?.actions?.failure; S.draft = `GitHub Actions failed on ${m?.actions?.branch}${f?.job ? ` (${f.job.name}${f.job.step ? ` › ${f.job.step}` : ''})` : ''}. Fix it and push again.${f?.annotations?.length ? `\n\nErrors:\n${f.annotations.slice(0, 8).map((x) => `- ${x.path}${x.line ? `:${x.line}` : ''} ${x.message}`).join('\n')}` : ''}`; render(); focusComposer(); return; }
    case 'act-yes': return decideAct(d.id, true);
    case 'act-no': return decideAct(d.id, false);
    case 'unpushed-push': { const m = S.modal; S.modal = null; render(); const r = await call('chatPush', m.chatId); if (!r?.ok) return toast(r?.message || 'Not pushed.'); toast(`Pushed ${r.branch}. Your work is safe on GitHub.`); if (m.then === 'delete') return deleteChat(m.chatId); if (m.then === 'connect') { S.pop = { chatId: m.chatId }; return chooseRepo(m.conn?.repo || null, m.conn?.branch || null); } return closeCopy(m.chatId); }
    case 'unpushed-force': { const m = S.modal; S.modal = null; render(); if (m.then === 'delete') return deleteChat(m.chatId, { force: true }); const r = await call('copiesRemove', m.chatId, true); if (!r?.ok) { if (!r?.cancelled) toast(r?.message || 'Kept.'); return; } if (m.then === 'connect') { S.pop = { chatId: m.chatId }; return chooseRepo(m.conn?.repo || null, m.conn?.branch || null); } await loadChats(); if (S.copies) await loadCopies(); return render(); }
    // settings
    case 'team-member': { const t = team(); const v = d.v; const members = t.members.includes(v) ? t.members.filter((x) => x !== v) : [...t.members, v]; return setSettings({ team: { ...t, members, reviewer: t.reviewer === v && !members.includes(v) ? null : t.reviewer } }); }
    case 'make-lead': { const t = team(); return setSettings({ team: { ...t, lead: d.v, reviewer: t.reviewer === d.v ? t.lead : t.reviewer } }); }
    case 'make-reviewer': return setSettings({ team: { ...team(), reviewer: d.v } });
    case 'no-reviewer': return setSettings({ team: { ...team(), reviewer: null } });
    case 'tool-web': return setSettings({ tools: { web: !(S.settings.tools?.web !== false) } });
    case 'tool-build': return setSettings({ tools: { build: !(S.settings.tools?.build !== false) } });
    case 'save-checks': return setSettings({ tools: { quickChecks: String(document.getElementById('quick-checks')?.value || '').split('\n').map((x) => x.trim()).filter(Boolean) } });
    case 'preview-net': return setSettings({ previewNetwork: !S.settings.previewNetwork });
    case 'act-for-me': return setSettings({ actForMe: !S.settings.actForMe });
    case 'full-access': return setSettings({ access: S.settings.access === 'full' ? 'standard' : 'full' });
    case 'theme': return setSettings({ theme: d.v });
    case 'text-size': return setSettings({ textSize: Number(d.v) });
    case 'reduce-motion': return setSettings({ reduceMotion: !S.settings.reduceMotion });
    case 'edit-identity': S.editIdentity = !S.editIdentity; return render();
    case 'save-identity': { const name = document.getElementById('id-name')?.value; const email = document.getElementById('id-email')?.value; S.editIdentity = false; await setSettings({ ownerIdentity: { name, email } }); await call('opsIdentityApply'); return; }
    case 'gh-login': { const r = await call('gitLogin'); toast(r?.ok ? 'GitHub sign-in opened in a terminal. Come back and press Re-check when done.' : r?.message || 'Couldn\'t start the sign-in.'); setTimeout(async () => { S.gh = (await call('gitTools')) || S.gh; S.repos = null; render(); }, 20000); return; }
    case 'install': { const r = await call('agentInstall', d.v); toast(r?.ok ? 'Installing in a terminal. Press Re-check when it\'s done.' : r?.message || 'Couldn\'t start the install.'); return; }
    case 'signin': { const r = await call('agentLogin', d.v); toast(r?.ok ? 'Sign-in opened in a terminal. Press Re-check when done.' : r?.message || 'Couldn\'t start the sign-in.'); return; }
    case 'recheck': S.cli[d.v] = (await call('agentStatus', d.v)) || {}; return render();
    case 'set-key': { const key = window.prompt?.(`Paste your ${aiName(d.v)} API key (saved encrypted on this PC):`); if (key) { const r = await call('setKey', d.v, key); if (r?.ok === false) toast(r.message); S.prov = (await call('providerStatus')) || S.prov; render(); } return; }
    case 'phone-toggle': S.phone = await call(S.phone?.enabled ? 'opsPhoneDisable' : 'opsPhoneEnable'); render(); pushPhone(); return;
    case 'phone-code': { const r = await call('opsPhoneNewCode'); S.phone = { ...(S.phone || {}), ...(r || {}) }; return render(); }
    case 'upd': { const fn = { check: 'checkForUpdates', download: 'downloadUpdate', install: 'installUpdate', restart: 'restartApp' }[d.v]; const r = await call(fn); if (r?.ok === false && r.message) toast(r.message); return; }
    case 'cleanup': { const r = await call('copiesCleanup'); await loadCopies(); await loadChats(); const freed = (r?.removed || []).reduce((n, c) => n + (c.freed || 0), 0); toast(`Removed ${r?.removed?.length || 0} cop${r?.removed?.length === 1 ? 'y' : 'ies'}${freed ? `, ${fmtBytes(freed)} freed` : ''}.${r?.unpushed?.length ? ` ${r.unpushed.length} with work not on GitHub ${r.unpushed.length === 1 ? 'was' : 'were'} kept: push or remove ${r.unpushed.length === 1 ? 'it' : 'them'} below.` : ''}`); return render(); }
    case 'copy-push': { const r = await call('chatPush', d.id); toast(r?.ok ? `Pushed ${r.branch}.` : r?.message || 'Not pushed.'); return loadCopies(); }
    case 'copy-remove': return closeCopy(d.id);
    case 'open-data-folder': return call('savedOpenData');
    case 'view-board': { const b = (S.boards || []).find((x) => x.id === d.id); if (b) { S.modal = { kind: 'board', board: b }; renderOverlay(); } return; }
    default: return undefined;
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.matches?.('[data-a="idle-hours"]')) setSettings({ copyIdleHours: Number(t.value) });
  if (t.id === 'branch-sel') S.pickBranch = t.value;
});

let searchTimer = null;
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'composer') { S.draft = t.value; fitComposer(); return; }
  if (t.id === 'chat-search') {
    S.search = t.value;
    clearTimeout(searchTimer);
    if (!S.search.trim()) { S.hits = null; return renderSide(); }
    renderSide();
    searchTimer = setTimeout(async () => { const r = await call('chatsSearch', S.search); S.hits = Array.isArray(r) ? new Set([...r.map((x) => x.id), ...S.chats.filter((c) => `${c.title} ${c.repo || ''}`.toLowerCase().includes(S.search.toLowerCase())).map((c) => c.id)]) : null; renderSide(); }, 250);
    return;
  }
  if (t.id === 'repo-q') { S.repoQuery = t.value; S.pop.noFocus = false; renderOverlay(); }
});

document.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if (t.id === 'composer' && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); send(); return; }
  if (t.id === 'rename-input') { if (ev.key === 'Enter') { ev.preventDefault(); finishRename(true); } if (ev.key === 'Escape') finishRename(false); return; }
  if (ev.key === 'Escape') { if (S.modal) { S.modal = null; renderOverlay(); } else if (S.pop) { S.pop = null; renderOverlay(); } }
});
document.addEventListener('focusout', (ev) => { if (ev.target.id === 'rename-input') setTimeout(() => { if (S.renaming) finishRename(true); }, 120); });

async function finishRename(keep) {
  const id = S.renaming;
  const el = document.getElementById('rename-input');
  const v = el?.value?.trim();
  S.renaming = null;
  if (keep && id && v) { await call('chatsUpdate', id, { title: v }); await loadChats(); }
  render();
}

document.addEventListener('paste', (ev) => {
  if (!(ev.target.id === 'composer')) return;
  const files = [...(ev.clipboardData?.files || [])];
  if (files.length) { ev.preventDefault(); addFiles(files); }
});
document.addEventListener('dragover', (ev) => { if (ev.dataTransfer?.types?.includes('Files')) ev.preventDefault(); });
document.addEventListener('drop', (ev) => { if (ev.dataTransfer?.files?.length && S.view !== 'settings') { ev.preventDefault(); addFiles(ev.dataTransfer.files); } });

// Drag a chat to reorder it within its group.
let dragId = null;
document.addEventListener('dragstart', (ev) => { const el = ev.target.closest?.('[data-drag]'); if (el) { dragId = el.dataset.drag; ev.dataTransfer.effectAllowed = 'move'; } });
document.addEventListener('dragover', (ev) => { if (dragId && ev.target.closest?.('[data-drag]')) ev.preventDefault(); });
document.addEventListener('drop', async (ev) => {
  const el = ev.target.closest?.('[data-drag]');
  if (!dragId || !el) return;
  ev.preventDefault();
  const ids = dropInGroup(S.chats, dragId, el.dataset.drag);
  dragId = null;
  if (ids) { await call('chatsReorder', ids); await loadChats(); renderSide(); }
});
document.addEventListener('dragend', () => { dragId = null; });

window.addEventListener('resize', () => { fitComposer(); });

// ---------- boot ----------
async function refreshAgents() {
  const ids = [...new Set([...team().members, ...(S.view === 'settings' ? TEAM_IDS : [])])].filter((a) => AGENTS[a]?.kind !== 'api');
  await Promise.all(ids.map(async (a) => { S.cli[a] = (await call('agentStatus', a)) || {}; }));
  render();
}

async function boot() {
  if (!api) { document.getElementById('app').innerHTML = '<div style="padding:40px">This interface must run inside the Hearth AI Command Center app.</div>'; return; }
  shell();
  try {
    S.info = (await call('appInfo')) || {};
    S.settings = { ...S.settings, ...((await call('settings')) || {}) };
    S.theme = (await call('themeGet')) || S.theme;
    applyTheme();
    api.onThemeChanged?.((t) => { S.theme = t; applyTheme(); });
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
    S.web = S.settings.tools?.web !== false;
    S.build = S.settings.tools?.build !== false;
    const b = await call('v2Boot');
    for (const n of b?.notices || []) if (!S.notices.includes(n)) S.notices.push(n);
    await loadChats();
    S.prov = (await call('providerStatus')) || S.prov;
    S.upd = (await call('updaterInfo')) || S.upd;
    api.onUpdaterStatus?.((s) => { const prev = S.upd.status?.state; S.upd.status = s; if (s.state === 'available' && prev !== 'available') toast(`Update ${s.version} is available — see Settings › App updates.`); if (S.view === 'settings') render(); });
    api.onChatStep?.((e) => { if (S.busy && e && e.runId === S.busy.runId && e.step) { S.busy.steps.push(e.step); renderMain(); } });
    api.onCopiesIdle?.((list) => { S.idle = Array.isArray(list) ? list : []; render(); });
    api.onCopiesRemoved?.(async () => { await loadChats(); renderSide(); });
    api.onOpsPhoneAction?.((a) => onPhone(a));
    S.phone = await call('opsPhoneStatus');
  } catch (e) { toast(`Startup problem: ${cleanErr(e)}`); }
  let remembered = null;
  try { remembered = localStorage.getItem('hearth.v2.open'); } catch {}
  if (remembered && entry(remembered)) await openChat(remembered); else render(true);
  refreshAgents();
  call('gitTools').then((g) => { if (g) { S.gh = g; renderSide(); } });
}

boot();

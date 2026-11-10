// Hearth AI Command Center 2.x: chats only. Each chat can connect to one of the owner's
// GitHub repos; Claude, ChatGPT, Gemini and the others work together in it, Claude leading.
// Work happens in a small temporary copy of the repo on this PC (electron/copies.cjs);
// builds and tests run in GitHub Actions after a push to the chat's own branch.
// Several chats can have their teams working at the same time (src/app/team-run.mjs): every
// chat keeps its own messages, sessions, step stream, Stop and queue, and results always land
// in the chat they belong to, whichever chat is open.
import './styles.css';
import './vendor/katex/katex.min.css';
import './vendor/highlight/github-dark.min.css';
import { AGENTS, COLORS, TEAMMATE_IDS, UNFILTERED } from './registry.mjs';
import { icon } from './icons.mjs';
import { tokensToCss, pickMode } from './theme.mjs';
import { autoTitle, moveInGroup, dropInGroup } from './chats.mjs';
import { groupChats, repoHint, greeting, fmtBytes, ago } from './app/groups.mjs';
import { groupSteps } from './app/steps.mjs';
import { previewDoc, frameHtml } from './app/previews.mjs';
import { SAFE_MEDIA, GALLERY_MIN, thumbUrl, shownUrl, tooBigCard, previewTooBig, problemCard, hugePictureCard, galleryItems, galleryGrid, galleryViewer, galleryKey, padActions, galleryStep, progressLine } from './app/bigmedia.mjs';
import { esc } from './app/text.mjs';
import { rich, sourcesOf, plainText, hostOf } from './app/rich.mjs';
import { parseDiff } from './app/diff.mjs';
import { teamOf, mentionsIn, name as aiName } from './app/brief.mjs';
import { expired, typedAnswer, ACT_KINDS } from './app/act.mjs';
import { pickMaker, toolsBrief } from './app/tools.mjs';
import { createTeamRunner } from './app/team-run.mjs';
import { teammateStatus } from './app/errors.mjs';
import { viewHabitat, mountHabitat, stopHabitat } from './habitat.mjs';
import { mountHabitat3d, stopHabitat3d } from './habitat3d/view.mjs';
import { applyHabitatLines, habitatSection, stripHabitatLines } from './habitat/actions.mjs';
import { teamHabitatLine } from './habitat/status.mjs';
import { activateLore, nextSpeakers, rpPrompt, addSwipe, moveSwipe, isSexual, fill, spriteFor } from './app/roleplay.mjs';
import { createVoice } from './voice.mjs';
import { creditsHtml } from './app/credits.mjs';
import { voiceSettings, routeFor, isServer, serverIdOf, idOf } from './app/voice-logic.mjs';
import { studioView, queueHtml, requestFrom } from './app/studio.mjs';
import { defaultsFrom, prefsFor, prefsOf, samePrefs, applyPrefs, rememberPrefs } from './app/chat-prefs.mjs';
import { FIND_FIELDS, searchFields, stepIndex, replaceAllFields, snippet, cardMatches, matchedIn } from './app/card-find.mjs';

const api = window.hearth || null;
const TEAM_IDS = ['anthropic', 'openai', 'google', 'xai', 'mistral', 'qwen', 'perplexity', 'deepseek', 'ollama', ...TEAMMATE_IDS];
const MONO = { free: ['Fr', '#3f8a5a'], hearth: ['H', '#c8743a'], anthropic: ['C', '#c96b3c'], openai: ['G', '#3f8f6f'], google: ['Ge', '#4b6fd0'], xai: ['X', '#5d636b'], mistral: ['M', '#6b5bd2'], qwen: ['Q', '#7a5cc9'], perplexity: ['P', '#1f8a99'], deepseek: ['D', '#3d56c9'], ollama: ['L', '#6d746e'], freebuff: ['F', '#8a7bc6'], venice: ['V', '#c2453b'], civitai: ['Ci', '#2f6fd6'], gpu: ['GP', '#6f7a3e'] };
const QUICK = [
  ['gh', 'Fix a bug in a repo', 'There\'s a bug I want fixed: '],
  ['dl', 'Look at a sent log', 'Look at the log I attached (or the newest one in Dragongamer9/hearth-logs) and find the cause: '],
  ['globe', 'Research something', 'Research this and give me a short answer with sources: '],
  ['eye', 'Make a mockup', 'Make a live preview mockup of '],
  ['stats', 'Analyse a spreadsheet', 'Analyse the CSV I attached: summarise it and make charts of '],
  ['flag', 'Prepare a release', 'Prepare a release: list what changed since the last release and draft the release notes. Don\'t pick a version number; ask me for it.'],
];
const SECTIONS = [['team', 'AI team'], ['accounts', 'Accounts'], ['uncensored', 'Uncensored mode'], ['github', 'GitHub'], ['tools', 'Tools'], ['memory', 'Memory'], ['scheduled', 'Scheduled'], ['connectors', 'Connectors'], ['perms', 'Permissions'], ['alerts', 'Notifications'], ['voice', 'Voice'], ['look', 'Appearance'], ['updates', 'App updates'], ['data', 'Saved data']];
const IDLE = [[1, '1 hour'], [6, '6 hours'], [24, '1 day'], [72, '3 days'], [168, '1 week'], [0, 'Never']];
const MAX_CHATS = [1, 2, 3, 4, 5, 6, 8, 10];
const IMAGE_MAKERS = ['openai', 'google', 'xai', 'venice', 'civitai', 'gpu', 'hearth'];
const VIDEO_MAKERS = ['openai', 'google'];
const MODEL_PRESETS = { anthropic: ['opus', 'sonnet', 'haiku'], openai: ['gpt-5', 'gpt-5-codex', 'o4-mini'], google: ['gemini-2.5-pro', 'gemini-2.5-flash'], xai: ['grok-4', 'grok-code-fast-1'], mistral: ['mistral-large-latest', 'codestral-latest'], perplexity: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'], deepseek: ['deepseek-chat', 'deepseek-reasoner'], qwen: [], ollama: [], venice: [], civitai: [], gpu: [] };
const MEDIA_KEYS = [['google', 'Gemini API key', 'pictures (Gemini image model), Veo videos'], ['openai', 'OpenAI API key', 'pictures and edits (OpenAI Images), Sora videos; the same key as ChatGPT by API'], ['xai', 'xAI API key', 'Grok pictures'], ['mistral', 'Mistral API key', 'reading PDFs and scans (Mistral OCR)']];

const S = {
  view: 'home', tab: 'team',
  // Images & Videos (src/app/studio.mjs): the form, what the main process reported, the PC's status.
  studio: { f: { kind: 'image', count: 1 }, data: null, st: null, filter: 'all', shown: new Set(), models: null },
  chats: [], temps: [], trash: [], notices: [], broken: false,
  open: null, lastChat: null,
  draft: '', attach: [], conn: null, mode: 'team', web: true, build: true, deep: false, homeModels: {},
  pane: null, pop: null, modal: null, toast: null, editing: null,
  search: '', hits: null, showTrash: false, showHidden: false, renaming: null,
  repos: null, reposMsg: '', repoQuery: '', branches: {}, pick: null,
  settings: { tools: { web: true, build: true, quickChecks: [] }, team: null, copyIdleHours: 24, theme: 'hearth', textSize: 100, connection: {}, bins: {}, extraDirs: [], notify: true, autoRead: false, maxChats: 3, customInstructions: { about: '', style: '' }, teammates: {} },
  info: {}, upd: { enabled: false, status: { state: 'idle' } }, gh: {}, cli: {}, prov: { keys: {} }, theme: { found: false, tokens: {} },
  mates: { ready: {}, keys: {}, servers: [], imagesOnly: {}, conf: { venice: {}, civitai: {} }, models: { venice: [], veniceImage: [], civitaiEngines: [] } },
  mkeys: { keys: {} }, memory: null, memPrompt: '', schedules: null, connectors: null, skills: null, habitat: null,
  copies: null, boards: null, phone: null, idle: [], rec: null,
  cards: null, books: null, persona: null, cardEdit: null, loreEdit: null, cardQuery: '', cardFind: null, cardColl: '', collSel: [], colls: [],
  // Quick checks whose tool is missing on this PC, the Permissions table, Gemini's allow-list,
  // the last team test and the settings change log.
  missing: [], permsT: null, agy: null, teamTest: null, testing: false, slog: null, findSites: null, found: [],
};

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const cleanErr = (e) => String(e?.message || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const call = async (fn, ...a) => { if (!api || typeof api[fn] !== 'function') return null; try { return await api[fn](...a); } catch (e) { return { ok: false, message: cleanErr(e), error: { message: cleanErr(e) } }; } };
const entry = (id = S.open) => S.chats.find((c) => c.id === id) || S.temps.find((c) => c.id === id) || null;
const ownerName = () => S.settings.ownerIdentity?.name || S.gh.ghUser || 'Dragongamer9';
const team = () => teamOf(S.settings.team);

// ---------- AIs ----------
// Missing quick-check tools above the message box: each tool once, and it can be hidden (it
// comes back only when the list of missing tools changes). Look only: nothing is saved in settings.
function missingList() { return [...new Set((S.missing || []).filter((x) => x.missing).map((x) => x.tool))]; }
function missingNote() {
  const tools = missingList();
  if (!S.build || !tools.length) return '';
  let hidden = null;
  try { hidden = localStorage.getItem('hearth.v2.missingHidden'); } catch {}
  if (hidden === tools.join(',')) return '';
  return `<div class="cnote warn">${icon('flag', 'sm')}<span>Not installed on this PC: ${esc(tools.join(', '))}. Those checks run in GitHub Actions instead.</span><button class="mini" data-a="missing-hide" title="Hide until this list changes">Hide</button></div>`;
}
function method(a) { return AGENTS[a]?.kind === 'api' ? 'api' : S.settings.connection?.[a] === 'api' ? 'api' : 'cli'; }
function ready(a) {
  if (!AGENTS[a]?.headless) return false;
  if (TEAMMATE_IDS.includes(a)) return Boolean(S.mates.ready?.[a]);
  if (method(a) === 'api') return Boolean(S.prov.keys?.[a]);
  const c = S.cli[a];
  return Boolean(c && c.installed && c.signedIn !== false);
}
const live = () => team().members.filter(ready);
// Every teammate's true status: connected, needs a key, CLI missing, not signed in, or off.
function statusOf(a) {
  const kind = TEAMMATE_IDS.includes(a) ? 'teammate' : method(a) === 'api' ? 'api' : AGENTS[a]?.kind === 'local' ? 'local' : AGENTS[a]?.kind === 'manual' ? 'manual' : 'cli';
  const c = S.cli[a];
  return teammateStatus(a, { inTeam: team().members.includes(a), kind, installed: c ? c.installed : true, signedIn: c?.signedIn, ready: ready(a) });
}
const statusMap = () => Object.fromEntries(team().members.map((a) => [a, statusOf(a)]));
const missingChecks = () => (S.missing || []).filter((x) => x.missing).map((x) => x.check);
const mono = (a, cls = '') => { const m = MONO[a] || [(AGENTS[a]?.name || '?')[0], '#7a7166']; return `<span class="ava ${cls}" style="background:${m[1]}">${esc(m[0])}</span>`; };
const setupHint = (a) => (a === 'gpu' ? 'Add your GPU server in Settings › Accounts' : a === 'hearth' ? 'Type your Home server\'s address in Settings › Accounts › Hearth devices' : TEAMMATE_IDS.includes(a) ? `Add your ${aiName(a)} key in Settings › Accounts` : `set up ${aiName(a)} in Settings › Accounts`);
const makerReady = (a) => (TEAMMATE_IDS.includes(a) ? Boolean(S.mates.ready?.[a]) && team().members.includes(a) : Boolean(S.mkeys.keys?.[a]));

// ---------- every chat's own runtime ----------
const runner = createTeamRunner({
  call: (fn, ...a) => call(fn, ...a),
  save: (R) => saveRt(R),
  render: (R) => { renderSide(); if (R.id === S.open && S.view === 'chat') renderMain(); if (S.view === 'habitat') pokeHabitat(); },
  openId: () => (S.view === 'chat' && document.hasFocus?.() !== false ? S.open : (S.view === 'chat' ? S.open : null)),
  entry: (id) => entry(id),
  settings: () => S.settings,
  team, live, method, setupHint, statusOf, statusMap, missingChecks,
  modeFor: (R) => R.mode || S.mode,
  webFor: (R) => (R.deep ? true : R.web ?? S.web),
  buildFor: (R) => R.build ?? S.build,
  imagesOnly: (a) => Boolean(S.mates.imagesOnly?.[a]),
  makeImage: async (R, { agent, prompt }) => { const r = await call('mediaImage', R.id, { provider: agent, prompt }); return r?.ok ? { ok: true, items: r.items || [r.item].filter(Boolean), via: r.via, text: `Made: “${prompt.slice(0, 200)}”${r.notes?.length ? `\n\n${r.notes.join(' ')}` : ''}` } : { ok: false, message: r?.error?.message || r?.message || 'No picture came back.' }; },
  modelFor: (R, a) => { const m = R.sessions?._models?.[a]; return m && m !== 'default' ? m : null; },
  refsFor: (R) => (entry(R.id)?.refs || []),
  briefExtra: (R, agent, role, resumed) => briefExtra(R, agent, role, resumed),
  afterReply: (R, agent, text) => habitatLines(R, agent, text),
  onTools: (R, msg, tools, agent) => onTools(R, msg, tools, agent),
  onPreview: (R, msg) => { if (R.id === S.open && S.view === 'chat') openPane(msg.id, msg.previews[0].id); },
  beforeRound: async () => { S.memPrompt = (await call('memoryPrompt')) || ''; },
  afterSave: (R, msg) => { loadChats().then(renderSide); pushPhone(); if (msg && ((msg.acts || []).length || (msg.memo || []).length)) notify(R, 'needs your answer'); },
  onRoundDone: (R, { stopped }) => { if (!stopped) { notify(R, 'reply is ready'); if (!voice.roundDone(R)) autoRead(R); } },
  isRoleplay: (R) => Boolean(entry(R.id)?.rp),
  roleplayTurn: (R, text, opts) => roleplayTurn(R, text, opts),
  uid, now,
});
const rt = (id) => runner.rt(id);
const cur = () => (S.open ? runner.rt(S.open) : null);
// The open chat's state, read through its runtime (so a background chat is never touched).
Object.defineProperties(S, {
  msgs: { get: () => cur()?.msgs || [], set: (v) => { const R = cur(); if (R) R.msgs = v; } },
  sessions: { get: () => cur()?.sessions || {}, set: (v) => { const R = cur(); if (R) R.sessions = v; } },
  readOnly: { get: () => Boolean(cur()?.readOnly), set: (v) => { const R = cur(); if (R) R.readOnly = v; } },
  copy: { get: () => cur()?.copy || null, set: (v) => { const R = cur(); if (R) R.copy = v; } },
  busy: { get: () => cur()?.busy || null },
  working: { get: () => Boolean(cur()?.round || cur()?.waiting) },
});

// ---------- saving (each chat to its own file) ----------
function saveRt(R) {
  if (!R || R.readOnly || R.temp) return Promise.resolve();
  const id = R.id;
  const data = { messages: R.msgs.filter((m) => !m.local), sessions: R.sessions };
  R.chain = R.chain.then(async () => {
    const r = await call('chatsSave', id, data);
    if (r && r.ok === false) toast(r.message || 'Not saved.');
    const c = entry(id);
    if (c) c.updatedAt = now();
  });
  return R.chain;
}
const save = () => saveRt(cur());
// The owner changed a composer switch in an open chat: saved with that chat only.
function keepPrefs() { const R = S.view === 'chat' && S.open ? cur() : null; if (R && rememberPrefs(R, S)) saveRt(R); }

function toast(text, undo = null) {
  S.toast = { text, undo, at: Date.now() };
  renderOverlay();
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { S.toast = null; renderOverlay(); }, undo ? 9000 : 5000);
}

// Desktop notification (Settings › Notifications): only when the owner isn't looking at that chat.
function notify(R, what) {
  if (S.settings.notify === false) return;
  const looking = document.hasFocus?.() && !document.hidden && S.view === 'chat' && S.open === R.id;
  if (looking) return;
  const c = entry(R.id);
  const last = [...R.msgs].reverse().find((m) => m.who !== 'owner' && m.who !== 'system');
  call('notifyShow', { title: `“${c?.title || 'Chat'}”: ${what}`, body: last ? `${aiName(last.who)}: ${plainText(last.text).slice(0, 140)}` : '', chatId: R.id });
}

// ---------- chats ----------
async function loadChats() {
  const r = await call('chatsList2');
  if (r && Array.isArray(r.list)) { S.chats = r.list; S.broken = r.broken; for (const n of r.notices || []) if (!S.notices.includes(n)) S.notices.push(n); }
  const t = await call('chatsTrash');
  S.trash = Array.isArray(t) ? t : [];
}

async function loadRt(id) {
  const c = entry(id);
  const R = rt(id);
  if (c?.temp) R.temp = true;
  if (R.loaded || R.round || R.temp) { R.loaded = true; return R; }
  const r = await call('chatsGet2', id);
  if (R.loaded || R.round) return R;
  R.msgs = r?.ok ? (r.messages || []) : [];
  R.sessions = r?.ok ? (r.sessions || {}) : {};
  R.readOnly = Boolean(r?.readOnly) || (r && r.ok === false);
  if (r && r.ok === false) R.msgs = [{ id: 'x', who: 'system', local: true, text: r.message || 'This chat could not be read. It was left exactly as it is.', at: now() }];
  if (c?.importError) R.msgs.unshift({ id: 'ie', who: 'system', local: true, text: c.importError, at: now() });
  R.loaded = true;
  return R;
}

// Switching chats never stops or blocks a chat that is working: it keeps going in the background.
async function openChat(id) {
  const c = entry(id);
  if (!c) return;
  const R = await loadRt(id);
  S.open = id;
  S.lastChat = id;
  S.view = 'chat';
  // This chat's own switches (who it talks to, web, build, deep), else the defaults.
  applyPrefs(S, prefsFor(R, S.settings));
  S.pane = null;
  S.pop = null;
  S.editing = null;
  R.unseen = false;
  try { if (!c.temp) localStorage.setItem('hearth.v2.open', id); } catch {}
  render(true);
  if (c.hasCopy && !R.copy) { const st = await call('copiesStatus', id); if (st?.exists) { R.copy = st; render(); } }
  for (const m of R.msgs) if (m.actions && ['pending', 'queued'].includes(m.actions.state)) pollRuns(R, m.id);
  pushPhone();
}

function goHome() {
  S.view = 'home'; S.open = null; S.pane = null; S.pop = null; S.editing = null;
  // A new chat starts from the owner's defaults, never from what the last chat used.
  applyPrefs(S, defaultsFrom(S.settings)); S.homeModels = {};
  try { localStorage.removeItem('hearth.v2.open'); } catch {}
  render(true);
}

async function ensureChat(firstText) {
  if (S.open) return entry();
  const title = autoTitle(firstText) || 'New chat';
  const e = await call('chatsCreate2', { repo: S.conn?.repo || null, branch: S.conn?.branch || null, title });
  if (!e || !e.id) { toast(e?.message || 'Could not start a chat.'); return null; }
  await loadChats();
  const R = rt(e.id);
  R.loaded = true;
  if (Object.keys(S.homeModels).length) R.sessions._models = { ...S.homeModels };
  // Switches he changed on the home screen before the first message belong to this chat.
  if (!samePrefs(prefsOf(S), defaultsFrom(S.settings))) rememberPrefs(R, S);
  S.open = e.id; S.lastChat = e.id; S.view = 'chat';
  try { localStorage.setItem('hearth.v2.open', e.id); } catch {}
  return entry(e.id) || e;
}

// A temporary chat: nothing is saved (no file, no history, no memory); it ends when closed.
async function startTemp() {
  const e = await call('chatsTemp');
  if (!e?.id) return toast('Temporary chats need the app.');
  S.temps.push(e);
  const R = rt(e.id);
  R.temp = true;
  R.loaded = true;
  await openChat(e.id);
}
async function endTemp(id) {
  const R = runner.runtimes.get(id);
  if (R?.round) await runner.stop(R);
  await call('chatsTempEnd', id);
  S.temps = S.temps.filter((t) => t.id !== id);
  runner.runtimes.delete(id);
  if (S.open === id) goHome(); else render();
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
  if (kind === 'knowledge') { S.modal = { kind: 'knowledge', chatId: id, instructions: c.instructions || '', refs: (c.refs || []).slice() }; return render(); }
  if (kind === 'export') { S.modal = { kind: 'export', chatId: id }; return render(); }
  if (kind === 'close') return closeCopy(id);
  if (kind === 'delete') return deleteChat(id);
  await loadChats();
  render();
}

async function deleteChat(id, opts = {}) {
  const R = runner.runtimes.get(id);
  if (R?.round || R?.waiting) return toast('Stop the team in that chat first.');
  const title = entry(id)?.title || 'chat';
  const r = await call('chatsDelete2', id, opts);
  if (r?.unpushed) return askUnpushed(id, 'delete');
  if (!r || r.ok === false) { if (!r?.cancelled) toast(r?.message || 'Not deleted.'); return; }
  runner.runtimes.delete(id);
  if (S.open === id) goHome();
  await loadChats();
  render();
  toast(`Deleted “${title}”. It's in Recently deleted.`, { kind: 'restore', trashId: r.trashId });
}

async function closeCopy(id, force = false) {
  const r = await call('copiesRemove', id, force);
  if (r?.unpushed) return askUnpushed(id, 'close');
  if (r?.ok) { toast(`Removed the temporary copy${r.freed ? ` (${fmtBytes(r.freed)} freed)` : ''}. It comes back when the team works here again.`); const R = runner.runtimes.get(id); if (R) R.copy = null; }
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
  if (entry(id)?.temp) return toast('A temporary chat can\'t connect to a repo (nothing of it is kept).');
  const R = runner.runtimes.get(id);
  if (R?.round) return toast('Wait for the team in that chat to finish (or stop it) before switching repos.');
  const r = await call('chatsConnect', id, repo ? { repo, branch } : null);
  if (r?.unpushed) { S.modal = { kind: 'unpushed', chatId: id, then: 'connect', conn: repo ? { repo, branch } : null }; return render(); }
  if (!r?.ok) return toast(r?.message || 'Not connected.');
  if (R) R.copy = null;
  await loadChats();
  render();
  toast(repo ? `Connected to ${repo}${branch ? ` · ${branch}` : ''}.` : 'This chat has no repo now; the team just talks.');
}

// ---------- attachments ----------
// Pasted or dropped files come as bytes through the window, so they're capped at 200 MB;
// the + button picks bigger ones (up to 10 GB), copied from disk with progress.
const PASTE_MAX = 200 * 1024 * 1024;
async function addFiles(fileList) {
  for (const f of [...fileList].slice(0, 10)) {
    if (f.size > PASTE_MAX) { toast(`${f.name} is ${fmtBytes(f.size)}. Pasted or dropped files can be up to 200 MB; use the + button to pick it (up to 10 GB, copied from disk).`); continue; }
    const buf = await f.arrayBuffer();
    const r = await call('attachSaveAny', f.name || 'pasted.png', buf);
    if (r?.ok) S.attach.push(r.att); else toast(r?.message || `Couldn't attach ${f.name}.`);
  }
  render();
}

// ---------- the team at work ----------
// Who a message is for when it names only unfiltered teammates: kept away from the other AIs.
function targetsOf(text) {
  const named = mentionsIn(text);
  if (named.length) return named;
  return S.mode !== 'team' ? [S.mode] : [];
}

async function send(textIn) {
  const text = String(textIn ?? S.draft).trim();
  if (!text && !S.attach.length) return;
  const R0 = cur();
  // The owner is never blocked: while this chat's team works, his message is posted now and
  // answered as soon as the current turn ends. Other chats are not affected.
  if (S.busy || S.working) {
    if (S.readOnly || !S.open) return;
    const to = entry()?.rp ? rpShield(entry(), text) : targetsOf(text);
    R0.msgs.push({ id: uid(), who: 'owner', text, at: now(), attachments: S.attach.slice(), ...(to.length && to.every((a) => UNFILTERED.includes(a)) ? { to } : {}) });
    S.draft = '';
    S.attach = [];
    runner.start(R0, text);
    await save();
    render(true);
    return toast(R0.waiting ? 'Sent. This chat is waiting for a free slot; it answers when its turn comes.' : 'Sent. The team reads it as soon as the current step is done.');
  }
  // "yes" / "no" answers Claude's newest request in this chat.
  const pendingAct = [...S.msgs].reverse().flatMap((m) => (m.acts || []).filter((a) => a.status === 'pending' && !expired(a))).shift();
  const typed = pendingAct ? typedAnswer(text) : null;
  if (S.readOnly) return toast('This chat could not be read, so nothing is added to it.');
  const c = await ensureChat(text || 'Files');
  if (!c) return;
  const R = rt(c.id);
  const to = c.rp ? rpShield(c, text) : targetsOf(text);
  const msg = { id: uid(), who: 'owner', text, at: now(), attachments: S.attach.slice(), ...(to.length && to.every((a) => UNFILTERED.includes(a)) ? { to } : {}) };
  R.msgs.push(msg);
  S.draft = '';
  S.attach = [];
  if (c.titleAuto && R.msgs.filter((m) => m.who === 'owner').length === 1 && text && !c.temp) {
    await call('chatsUpdate', c.id, { title: autoTitle(text), auto: true });
    await loadChats();
  }
  await saveRt(R);
  render(true);
  if (typed && pendingAct) return decideAct(pendingAct.id, typed === 'yes', 'typed');
  // This round's switches come from the composer now; changing them later doesn't touch it.
  Object.assign(R, { mode: S.mode, web: S.web, build: S.build, deep: S.deep });
  if (team().members.some((a) => method(a) !== 'api' && !S.cli[a])) await refreshAgents();
  await runner.start(R, text);
}

// Retry an answer: a new version of the same message (← 1/2 →).
async function regenerate(msgId) {
  const R = cur();
  const m = R?.msgs.find((x) => x.id === msgId);
  if (!m || R.round || R.waiting) return toast(R?.round ? 'Wait for the team to finish first.' : 'Nothing to retry.');
  Object.assign(R, { mode: S.mode, web: S.web, build: S.build, deep: S.deep });
  await runner.start(R, '', { only: m.who, regenerate: m.id, mode: m.role === 'lead' ? 'team' : m.who });
}

// Edit and resend: the old message and everything after it stay as an earlier version.
async function resendEdited(msgId, text) {
  const R = cur();
  const i = R ? R.msgs.findIndex((x) => x.id === msgId) : -1;
  if (i < 0 || !text.trim()) return;
  if (R.round || R.waiting) return toast('Wait for the team to finish (or stop it) before editing.');
  const m = R.msgs[i];
  const branches = m.branches?.length ? m.branches : [{ text: m.text, tail: [] }];
  branches[m.b || 0] = { text: m.text, tail: R.msgs.slice(i + 1) };
  branches.push({ text: text.trim(), tail: [] });
  m.branches = branches.slice(-10);
  m.b = m.branches.length - 1;
  m.text = text.trim();
  m.editedAt = now();
  R.msgs.splice(i + 1);
  S.editing = null;
  await saveRt(R);
  render(true);
  Object.assign(R, { mode: S.mode, web: S.web, build: S.build, deep: S.deep });
  await runner.start(R, m.text);
}
async function switchBranch(msgId, dir) {
  const R = cur();
  const i = R ? R.msgs.findIndex((x) => x.id === msgId) : -1;
  const m = R?.msgs[i];
  if (!m?.branches?.length || R.round) return;
  const to = Math.max(0, Math.min(m.branches.length - 1, (m.b || 0) + dir));
  if (to === (m.b || 0)) return;
  m.branches[m.b || 0] = { text: m.text, tail: R.msgs.slice(i + 1) };
  const b = m.branches[to];
  m.text = b.text;
  m.b = to;
  R.msgs.splice(i + 1, Infinity, ...(b.tail || []));
  m.branches[to] = { text: b.text, tail: [] };
  await saveRt(R);
  render();
}
function switchVersion(msgId, dir) {
  const m = S.msgs.find((x) => x.id === msgId);
  if (!m?.versions?.length) return;
  const to = Math.max(0, Math.min(m.versions.length - 1, (m.v ?? m.versions.length - 1) + dir));
  Object.assign(m, m.versions[to], { v: to, versions: m.versions });
  save();
  render();
}

async function stopRun(R = cur()) {
  if (!R) return;
  await runner.stop(R);
  call('mediaCancel', R.id);
  toast('Stopping…');
}

// What every AI also gets: memory, the owner's custom instructions, this chat's own
// instructions and files, the Habitat, the app lines, and the mode of this round.
function briefExtra(R, agent, role, resumed) {
  const c = entry(R.id) || {};
  const ci = S.settings.customInstructions || {};
  const L = [];
  if (S.memPrompt && !c.temp) L.push('', S.memPrompt);
  if (ci.about || ci.style) L.push('', 'THE OWNER\'S CUSTOM INSTRUCTIONS:', ...(ci.about ? [`About him: ${ci.about}`] : []), ...(ci.style ? [`How to answer: ${ci.style}`] : []));
  if (c.instructions) L.push('', `THIS CHAT'S INSTRUCTIONS (from the owner): ${c.instructions}`);
  if (c.refs?.length) L.push('', `THIS CHAT'S REFERENCE FILES (always attached): ${c.refs.map((r) => `${r.name} (${r.path})`).join(', ')}`);
  if (!resumed) {
    const imgs = IMAGE_MAKERS.filter(makerReady).map(aiName);
    const vids = VIDEO_MAKERS.filter((a) => S.mkeys.keys?.[a]).map((a) => (a === 'openai' ? 'Sora' : 'Veo'));
    L.push(toolsBrief({ role, memory: !c.temp, images: imgs, video: vids, screenshots: Boolean(S.mkeys.screenshot) }));
  }
  if (R.deep) L.push('', 'DEEP RESEARCH MODE (the owner turned it on for this message): search widely (many sources, primary ones first), cross-check facts, then write a long, well-structured report with numbered citations [1] … and a Sources list of full https links at the end. Save the full report as .hearth-out/report-<short-topic>.md too. Lead: you may hand parts to teammates with HELPER lines.');
  const lastOwner = [...R.msgs].reverse().find((m) => m.who === 'owner');
  if ((lastOwner?.attachments || []).some((a) => /\.(csv|tsv|xlsx?|ods|json)$/i.test(a.name || ''))) L.push('', 'DATA ANALYSIS: the owner attached data. Analyse it locally (python3 with pandas/matplotlib if installed, else plain python or a ```chart block) in your folder; never upload it anywhere. Save every chart as a PNG in .hearth-media/ so it shows in the chat, and say what each one shows.');
  if (R.canvas) {
    const p = previewOf(R.canvas.msgId, R.canvas.pid, R);
    if (p) L.push('', `THE CANVAS (the document open next to the chat, exactly as the owner left it; name ${p.name}):\n\`\`\`\n${String(p.content).slice(0, 30000)}\n\`\`\`\nTo change it, reply with the whole new version in one fenced block whose first line is \`\`\`${p.kind === 'markdown' ? 'markdown' : p.kind === 'svg' ? 'svg' : 'html'} preview ${p.name}`);
  }
  const hab = habitatPrompt(agent, resumed);
  if (hab) L.push('', hab);
  return L.join('\n');
}

// ---------- the Habitat (sidebar › Habitat; the AIs act in it with HABITAT: lines) ----------
const NAMES = Object.fromEntries(TEAM_IDS.map((a) => [a, aiName(a)]));
function habitatAgents() {
  const t = team();
  const R = S.lastChat ? runner.runtimes.get(S.lastChat) : null;
  const helping = new Set((R?.msgs || []).flatMap((m) => (m.helpers || []).filter((h) => h.state === 'working').map((h) => h.agent)));
  return t.members.slice(0, 12).map((a) => {
    const busy = R?.busy?.agent === a;
    const brief = busy ? { id: 'chat', title: entry(R.id)?.title || 'Chat', branch: R.copy?.work || '' } : null;
    return { id: a, name: aiName(a), color: COLORS[a] || '#888888', lead: a === t.lead, status: ready(a) ? 'idle' : 'signedout', task: busy && R.busy.role !== 'reviewer' ? brief : null, reviewing: busy && R.busy.role === 'reviewer' ? brief : null, typing: busy || helping.has(a), waiting: Boolean(R?.waiting), note: ready(a) ? (busy ? 'working in this chat' : 'ready') : 'not set up' };
  });
}
const habitatHooks = {
  snapshot: () => {
    const R = S.lastChat ? runner.runtimes.get(S.lastChat) : null;
    return { tasks: [], chat: (R?.msgs || []).filter((m) => !m.local).slice(-12).map((m) => ({ id: m.id, who: m.who, text: String(m.text || '').slice(0, 200) })), store: S.habitat || null, ops: {}, reduced: S.settings.reduceMotion === true || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false), agents: habitatAgents() };
  },
  openTask: () => { if (S.lastChat) openChat(S.lastChat); },
  openAgent: () => { S.view = 'settings'; S.tab = 'team'; render(true); },
  openChat: () => { if (S.lastChat) openChat(S.lastChat); else goHome(); },
  // The Habitat's progress: written only when it really changes (electron/parity.cjs habitat:save).
  saveStore: (h) => { const before = JSON.stringify({ ...(S.habitat || {}), rev: 0 }); S.habitat = h; if (JSON.stringify({ ...h, rev: 0 }) !== before) call('habitatSave', h); },
  // 2D/3D, Lighter 3D, walk view, avatar, the study: the owner's own saved choices (Settings view3d).
  view3d: () => S.settings.view3d || null,
  saveView3d: (v) => { call('setSettings', { view3d: v }).then((s2) => { if (s2 && !s2.message && s2.tools) S.settings = s2; }); },
  audit: () => {},
};
let habMounted = false;
function pokeHabitat() { /* the Habitat polls habitatHooks.snapshot() itself */ }
function habitatLines(R, agent, text) {
  if (!/HABITAT:/i.test(text)) return text;
  const ids = habitatAgents().map((a) => a.id);
  const r = applyHabitatLines(S.habitat, { agent, text, ids, agents: habitatAgents(), names: NAMES, reduced: S.settings.reduceMotion === true, local: agent === 'ollama' });
  if (r.changed) { S.habitat = r.store; call('habitatSave', r.store); }
  if (r.results?.length) runner.post(R, { who: 'system', local: false, text: r.results.map((x) => `${aiName(agent)} · Habitat: ${x.ok ? '✓' : '✗'} ${x.reason}`).join('\n') });
  return stripHabitatLines(text);
}
function habitatPrompt(agent, resumed) {
  if (UNFILTERED.includes(agent)) return '';
  const ids = habitatAgents().map((a) => a.id);
  const r = habitatSection(S.habitat, { agent, ids, names: NAMES, local: agent === 'ollama', full: !resumed });
  if (r.changed) S.habitat = r.store;
  const others = r.text ? teamHabitatLine(S.habitat, habitatAgents(), NAMES, Date.now(), 360, agent) : '';
  // The owner's presence line: whether he is looking at the Habitat right now.
  const owner = S.view === 'habitat' ? 'The owner is in the Habitat right now, watching the team.' : '';
  return [r.text, others, owner].filter(Boolean).join('\n');
}

// ---------- app lines from the AIs (pictures, memory, past chats, screenshots) ----------
const newestImage = (R) => [...R.msgs].reverse().flatMap((m) => [...(m.media || [])].reverse()).find((x) => x.kind === 'image' && x.file) || null;
async function onTools(R, msg, tools, agent) {
  const answers = [];
  for (const t of tools) {
    if (R.stop) break;
    if (t.kind === 'image' || t.kind === 'edit') {
      const maker = pickMaker(t.to, { capable: t.kind === 'edit' ? ['openai', 'google'] : IMAGE_MAKERS, ready: makerReady });
      if (!maker) { runner.post(R, { who: 'system', text: `${aiName(agent)} asked for a picture, but ${t.to ? `${aiName(t.to)} isn't set up for pictures (${setupHint(t.to)})` : t.kind === 'edit' ? 'editing needs an OpenAI or Gemini API key (Settings › Accounts)' : 'no image maker is set up yet (add a key in Settings › Accounts)'}.` }); continue; }
      const edit = t.kind === 'edit' ? newestImage(R) : null;
      if (t.kind === 'edit' && !edit) { runner.post(R, { who: 'system', text: 'There\'s no picture in this chat to edit.' }); continue; }
      R.busy = { agent: maker, role: 'member', runId: `img${uid()}`, steps: [{ kind: 'image', label: t.kind === 'edit' ? 'Editing the picture' : 'Making a picture', detail: aiName(maker) }], startedAt: Date.now() };
      renderSide(); if (R.id === S.open) renderMain();
      const r = await call('mediaImage', R.id, { provider: maker, prompt: t.prompt, ...(edit ? { edit: edit.file } : {}) });
      R.busy = null;
      runner.post(R, r?.ok ? { who: maker, text: `${t.kind === 'edit' ? 'Edited' : 'Made'} for ${aiName(agent)}: “${t.prompt.slice(0, 240)}”`, via: r.via, media: r.items || [r.item].filter(Boolean) } : { who: maker, err: true, text: `${r?.error?.kind === 'refused' ? '' : 'No picture: '}${r?.error?.message || r?.message || 'it failed.'}` });
    } else if (t.kind === 'video') {
      const maker = pickMaker(t.to, { capable: VIDEO_MAKERS, ready: (a) => Boolean(S.mkeys.keys?.[a]) });
      if (!maker) { runner.post(R, { who: 'system', text: 'Video needs your own OpenAI (Sora) or Gemini API (Veo) key in Settings › Accounts.' }); continue; }
      R.busy = { agent: maker, role: 'member', runId: `vid${uid()}`, steps: [{ kind: 'image', label: 'Making a video', detail: `${maker === 'openai' ? 'Sora' : 'Veo'} · this can take several minutes` }], startedAt: Date.now() };
      renderSide(); if (R.id === S.open) renderMain();
      const r = await call('mediaVideo', R.id, { provider: maker, prompt: t.prompt });
      R.busy = null;
      runner.post(R, r?.ok ? { who: maker, text: `Video for ${aiName(agent)}: “${t.prompt.slice(0, 240)}”`, via: r.via, media: [r.item].filter(Boolean) } : { who: maker, err: true, text: `No video: ${r?.error?.message || r?.message || 'it failed.'}` });
    } else if (t.kind === 'shot') {
      const r = await call('mediaScreenshot', R.id, t.url);
      runner.post(R, r?.ok ? { who: 'system', text: `Screenshot of ${hostOf(t.url)} for ${aiName(agent)}.`, media: [r.item].filter(Boolean) } : { who: 'system', text: `No screenshot of ${t.url}: ${r?.error?.message || r?.message || 'it failed.'}` });
    } else if (t.kind === 'remember') {
      if (UNFILTERED.includes(agent) || entry(R.id)?.temp) { runner.post(R, { who: 'system', text: entry(R.id)?.temp ? 'Memory suggestions aren\'t taken in a temporary chat.' : `Memory suggestions from ${aiName(agent)} aren't taken (its content stays away from your other AIs).` }); continue; }
      const r = await call('memoryPropose', t.text, agent, R.id);
      if (r?.proposal) msg.memo = [...(msg.memo || []), { id: r.proposal.id, text: r.proposal.text, status: 'pending' }];
    } else if (t.kind === 'search') {
      const r = await call('chatsRecall', t.query, R.id);
      answers.push(`SEARCH CHATS "${t.query}":\n${(Array.isArray(r) && r.length ? r.map((h) => `- "${h.title}"${h.repo ? ` (${h.repo})` : ''}, ${String(h.updatedAt || '').slice(0, 10)}: ${(h.snippets || []).join(' … ')}`).join('\n') : '(no matching chats)')}`);
      msg.steps = [...(msg.steps || []), { kind: 'search', label: 'Searched your chats', detail: `for “${t.query}”` }];
    } else if (t.kind === 'read') {
      const q = t.chat.toLowerCase();
      const hit = S.chats.find((c) => c.id === t.chat) || S.chats.find((c) => c.title.toLowerCase() === q) || S.chats.find((c) => c.title.toLowerCase().includes(q));
      if (!hit || hit.id === R.id) { answers.push(`READ CHAT "${t.chat}": no such chat.`); continue; }
      const r = await call('chatsReadOther', hit.id);
      answers.push(r?.ok ? `CHAT "${r.title}" (read-only):\n${r.text}` : `READ CHAT "${t.chat}": couldn't be read.`);
      msg.steps = [...(msg.steps || []), { kind: 'read', label: 'Read another chat', detail: hit.title }];
    }
  }
  return answers.length ? `RESULTS OF YOUR APP LINES (read-only; now answer the owner):\n\n${answers.join('\n\n')}` : null;
}

// ---------- roleplay chats (characters, lorebooks, swipes; src/app/roleplay.mjs) ----------
const cardById = (id) => (S.cards || []).find((c) => c.id === id) || null;
const rpCards = (c) => (c?.rp?.characters || []).map(cardById).filter(Boolean);
const playerOf = (c, cardId) => c?.rp?.players?.[cardId] || team().lead;
async function loadColls() { const cl = await call('cardsCollections'); S.colls = Array.isArray(cl) ? cl : []; }
async function loadCards() {
  const r = await call('cardsList');
  S.cards = r?.list || [];
  await loadColls();
  S.books = (await call('loreList')) || [];
  S.persona = (await call('rpPersona')) || { name: '', description: '' };
}
// The owner's line in a roleplay with an uncensored teammate: kept away from the other AIs
// when it reads as adult.
function rpShield(c, text) {
  const unf = [...new Set(Object.values(c.rp?.players || {}).filter((a) => UNFILTERED.includes(a)))];
  return unf.length && isSexual(text) ? unf : [];
}
function loreFor(c, cards) {
  const ids = new Set([...(c.rp?.lorebooks || []), ...cards.flatMap((x) => x.lorebooks || [])]);
  return [...(S.books || []).filter((b) => ids.has(b.id)), ...cards.map((x) => x.character_book).filter(Boolean)];
}
// One owner message in a roleplay chat: the right character(s) answer, each played by its AI.
async function roleplayTurn(R, text, opts = {}) {
  const c = entry(R.id);
  if (!S.cards) await loadCards();
  const cards = rpCards(c);
  if (!cards.length) { runner.post(R, { who: 'system', text: 'This roleplay chat has no characters (they may have been deleted).' }); return false; }
  const lastChar = [...R.msgs].reverse().find((m) => m.char)?.char || null;
  const who = opts.swipe || opts.cont ? [R.msgs.find((m) => m.id === (opts.swipe || opts.cont))?.char].filter(Boolean) : opts.impersonate ? [cards[0].id] : nextSpeakers({ cards, order: c.rp.order, text, lastSpeaker: lastChar, forced: opts.char || null });
  let ok = true;
  for (const id of who) {
    if (R.stop) break;
    const card = cardById(id);
    const player = playerOf(c, id);
    if (!ready(player)) { runner.post(R, { who: 'system', text: `${card.name} is played by ${aiName(player)}, which isn't set up: ${setupHint(player)}.` }); ok = false; continue; }
    const mode = opts.impersonate ? 'impersonate' : opts.cont ? 'continue' : 'reply';
    const upto = opts.swipe ? R.msgs.slice(0, R.msgs.findIndex((m) => m.id === opts.swipe)) : R.msgs;
    const prompt = rpPrompt({ card, cards, persona: S.persona || {}, messages: upto, lore: activateLore(loreFor(c, cards), upto), mode, player, limits: card.limits });
    R.busy = { agent: player, role: 'member', char: id, runId: `${uid().replace(/[^a-z0-9]/gi, '').slice(0, 10)}p`, steps: [], startedAt: Date.now() };
    renderSide(); if (R.id === S.open) renderMain();
    const lastOwner = [...upto].reverse().find((m) => m.who === 'owner');
    const r = await call('chatRun', { chatId: R.id, agent: player, runId: R.busy.runId, prompt: prompt.slice(-58000), web: false, build: false, title: c.title, rp: { cardIds: cards.map((x) => x.id), check: opts.impersonate ? '' : String(lastOwner?.text || text || '') }, ...(runner.runtimes.get(R.id)?.sessions?._models?.[player] ? { model: R.sessions._models[player] } : {}) }) || { ok: false, error: { message: 'The app could not start the AI.' } };
    R.busy = null;
    if (!r.ok) {
      ok = false;
      runner.post(R, r.error?.kind === 'refused' ? { who: 'system', block: Boolean(r.error.limit), text: r.error.message } : { who: player, char: id, err: true, text: r.error?.message || 'Something went wrong.' });
      continue;
    }
    const out = String(r.text || '').trim();
    if (mode === 'impersonate') { S.draft = out.replace(new RegExp(`^${(S.persona?.name || 'You').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*`, 'i'), ''); render(); focusComposer(); continue; }
    if (opts.cont) { const m = R.msgs.find((x) => x.id === opts.cont); if (m) { const t = `${m.text}${/\s$/.test(m.text) ? '' : ' '}${out}`; Object.assign(m, Array.isArray(m.swipes) ? { text: t, swipes: m.swipes.map((x, i) => (i === (m.sw ?? 0) ? t : x)) } : { text: t }); } }
    else if (opts.swipe) { const i = R.msgs.findIndex((x) => x.id === opts.swipe); if (i >= 0) R.msgs[i] = { ...addSwipe(R.msgs[i], out), via: r.via, at: now() }; if (S.open !== R.id) R.unseen = true; }
    else runner.post(R, { who: player, char: id, text: out || '…', via: r.via, ...(Array.isArray(r.media) && r.media.length ? { media: r.media } : {}) });
    await saveRt(R);
  }
  await saveRt(R);
  return ok;
}
// Start a roleplay chat with one or several characters; their greetings start it.
async function startRoleplay(m) {
  const cards = m.chars.map(cardById).filter(Boolean);
  if (!cards.length) return toast('Pick at least one character.');
  for (const c of cards) if (c.limits?.minor && UNFILTERED.includes(m.players[c.id])) return toast(`${c.name} reads as under 18 (${c.limits.minorWhy}), so an uncensored teammate can't play it. Pick Claude, ChatGPT or Gemini for a non-sexual story.`);
  const title = cards.map((c) => c.name).join(', ').slice(0, 100);
  const e = await call('chatsCreate2', { title });
  if (!e?.id) return toast(e?.message || 'Could not start a chat.');
  const r = await call('chatsRp', e.id, { characters: cards.map((c) => c.id), players: m.players, order: m.order, lorebooks: m.lorebooks });
  if (r?.ok === false || r?.message) return toast(r.message || 'Not saved.');
  await loadChats();
  const R = rt(e.id);
  R.loaded = true;
  const user = S.persona?.name || 'You';
  for (const c of cards) {
    const greets = [c.first_mes, ...(c.alternate_greetings || [])].filter((g) => String(g || '').trim()).map((g) => fill(g, { char: c.name, user }));
    if (greets.length) R.msgs.push({ id: uid(), who: m.players[c.id], char: c.id, greeting: true, text: greets[0], swipes: greets.length > 1 ? greets : undefined, sw: 0, at: now() });
  }
  await saveRt(R);
  S.modal = null;
  await openChat(e.id);
}
function rpSwipe(msgId, dir) {
  const R = cur();
  const i = R ? R.msgs.findIndex((x) => x.id === msgId) : -1;
  if (i < 0 || R.round) return;
  const m = R.msgs[i];
  const n = Array.isArray(m.swipes) ? m.swipes.length : 1;
  // Past the last swipe: a new one (greetings only swipe through their alternates).
  if (dir > 0 && ((m.sw ?? 0) >= n - 1 || dir === 999)) { if (m.greeting) return; Object.assign(R, { mode: 'team', web: false, build: false }); runner.start(R, '', { swipe: msgId }); return; }
  R.msgs[i] = moveSwipe(m, dir);
  saveRt(R);
  render();
}

// ---------- the files-changed card ----------
async function cardAction(kind, msgId, R = cur()) {
  const m = R?.msgs.find((x) => x.id === msgId);
  const c = entry(R?.id);
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
    if (r?.ok) { m.changes = { ...m.changes, pushed: r.branch, unpushed: false, head: r.sha }; m.actions = { branch: r.branch, sha: r.sha, state: 'queued', since: now() }; pollRuns(R, m.id); toast(`Pushed ${r.branch}.`); }
    else toast(r?.message || 'Not pushed.');
    R.copy = await call('copiesStatus', c.id);
    await saveRt(R); return render();
  }
  if (kind === 'pr') {
    m.busy = 'pr'; render();
    const r = await call('chatPr', c.id, { title: c.title, body: prBody(m) });
    m.busy = null;
    if (r?.ok) { m.changes = { ...m.changes, pr: { number: r.number, url: r.url }, pushed: m.changes.branch, unpushed: false }; toast(`Pull request #${r.number || ''} is open.`); if (!m.actions) { const st = await call('copiesStatus', c.id); if (st?.head) { m.actions = { branch: m.changes.branch, sha: st.head, state: 'queued', since: now() }; pollRuns(R, m.id); } } }
    else toast(r?.message || 'Couldn\'t open a pull request.');
    await saveRt(R); return render();
  }
  if (kind === 'merge') {
    m.busy = 'merge'; render();
    // The main process always asks the owner in its own popup before anything is merged.
    const r = await call('chatMerge', c.id, { sha: m.changes?.head || undefined, body: prBody(m) });
    m.busy = null;
    if (r?.ok) { m.changes = { ...m.changes, merged: true, pr: { number: r.number, url: r.url } }; runner.post(R, { who: 'system', text: `${r.message} (pull request #${r.number}).` }); }
    else if (!r?.cancelled) toast(r?.message || 'Not merged.');
    await saveRt(R); return render();
  }
}
const prBody = (m) => `${String(m.text || '').slice(0, 3000)}\n\nMade in Hearth AI Command Center; reviewed and merged by the owner.`;

// GitHub Actions for a pushed commit: polled until it passes or fails (in the background too).
const polling = new Set();
async function pollRuns(R, msgId) {
  const key = `${R.id}|${msgId}`;
  if (polling.has(key)) return;
  polling.add(key);
  const started = Date.now();
  try {
    while (Date.now() - started < 90 * 60000 && runner.runtimes.get(R.id) === R) {
      const m = R.msgs.find((x) => x.id === msgId);
      if (!m?.actions) break;
      const r = await call('chatRuns', R.id, { branch: m.actions.branch, sha: m.actions.sha });
      if (r?.ok) {
        const state = r.state === 'none' ? (Date.now() - Date.parse(m.actions.since || now()) > 10 * 60000 ? 'none' : 'queued') : r.state;
        m.actions = { ...m.actions, state, runs: r.runs || [], failedRun: r.failedRun || null, checkedAt: now() };
        if (state === 'failure' && r.failedRun && !m.actions.failure) {
          const f = await call('chatFailure', R.id, r.failedRun.id);
          if (f?.ok) m.actions.failure = { job: f.job, annotations: f.annotations || [] };
        }
        if (R.id === S.open) render();
        if (['success', 'failure', 'none'].includes(state)) { await saveRt(R); break; }
      } else if (r && r.message) { m.actions = { ...m.actions, note: r.message }; if (R.id === S.open) render(); }
      else if (!r) break;
      await new Promise((res) => setTimeout(res, 20000));
    }
  } finally { polling.delete(key); }
}

// ---------- Claude acting for the owner (bound to the chat it was asked in) ----------
async function decideAct(actId, yes, how = 'button') {
  const R = [...runner.runtimes.values()].find((x) => x.msgs.some((m) => (m.acts || []).some((a) => a.id === actId)));
  const m = R?.msgs.find((x) => (x.acts || []).some((a) => a.id === actId));
  const a = m?.acts.find((x) => x.id === actId);
  if (!a || a.status !== 'pending') return;
  if (a.chatId && a.chatId !== R.id) return;
  if (expired(a)) { a.status = 'expired'; await saveRt(R); return render(); }
  a.status = yes ? 'approved' : 'denied';
  a.decidedAt = now();
  a.how = how;
  runner.post(R, { who: 'system', text: yes ? `You said yes: ${ACT_KINDS[a.kind]}.` : `You said no to: ${ACT_KINDS[a.kind]}.` });
  await saveRt(R);
  if (!yes) return render();
  const target = [...R.msgs].reverse().find((x) => x.changes) || { id: null };
  if (!target.id) { runner.post(R, { who: 'system', text: 'There are no changes in this chat to do that with.' }); return saveRt(R); }
  await cardAction(a.kind === 'pr' ? 'pr' : a.kind === 'merge' ? 'merge' : 'push', target.id, R);
}

// Memory suggestions: saved only after the owner's yes.
async function decideMemo(msgId, pid, yes) {
  const R = cur();
  const m = R?.msgs.find((x) => x.id === msgId);
  const p = m?.memo?.find((x) => x.id === pid);
  if (!p || p.status !== 'pending') return;
  const r = await call('memoryDecide', pid, yes);
  p.status = r?.ok ? (yes ? 'saved' : 'declined') : 'gone';
  await saveRt(R);
  render();
  toast(yes && r?.saved ? 'Saved to memory. Every chat sees it now (Settings › Memory).' : r?.ok ? 'Not saved.' : (r?.message || 'That suggestion is gone.'));
}

// ---------- previews and the canvas ----------
function previewOf(msgId, pid, R = cur()) {
  const m = R?.msgs.find((x) => x.id === msgId);
  return m?.previews?.find((p) => p.id === pid) || null;
}
async function openPane(msgId, pid, tab = 'preview') {
  const p = previewOf(msgId, pid);
  if (!p) return;
  // Too big for the panel: the card in the chat says why and offers "Open in browser".
  if (p.tooBig) { if (tab !== 'preview') toast('That preview is too big to edit here. Use Save as… and edit it in your editor.'); return; }
  // Over 1 MB: kept as a file in the chat's media folder and shown from disk (no srcdoc).
  if (p.file) {
    S.pane = { msgId, pid, tab: 'preview', url: null, big: true };
    const r = await call('previewServeFile', S.open, p.file, p.kind);
    if (r?.ok) S.pane.url = r.url; else { S.pane = null; toast(r?.message || 'That preview couldn\'t be opened.'); }
    renderPane(true);
    renderMain();
    return;
  }
  S.pane = { msgId, pid, tab, url: null };
  const html = p.kind === 'code' ? `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0d1117;color:#c9d1d9;font:13px/1.55 ui-monospace,monospace}pre{margin:0;padding:16px;white-space:pre-wrap}</style><pre>${esc(p.content)}</pre>` : previewDoc({ kind: p.kind, content: p.content, name: p.name, dark: document.documentElement.dataset.mode !== 'light', allowNet: S.settings.previewNetwork === true });
  if (api?.previewServe) { const r = await call('previewServe', html); if (r?.ok) S.pane.url = r.url; }
  S.pane.srcdoc = html;
  renderPane(true);
  renderMain();
}
function savePreviewToRepo(msgId, pid) {
  const p = previewOf(msgId, pid);
  const c = entry();
  if (!p || !c) return;
  if (!c.repo && !c.repoDir) return toast('Connect this chat to a repo first (the repo chip above the box).');
  S.modal = { kind: 'saveto', msgId, pid, path: `docs/mockups/${p.name}` };
  render();
}
// Open a code block from an answer in the canvas (an editable document next to the chat).
async function codeToCanvas(btn) {
  const block = btn.closest('.codeblock');
  const msgEl = btn.closest('[data-msg]');
  const R = cur();
  const m = R?.msgs.find((x) => x.id === msgEl?.dataset.msg);
  if (!block || !m) return;
  const lang = block.querySelector('.cb-hd span')?.textContent || 'text';
  const kind = lang === 'html' ? 'html' : lang === 'svg' || lang === 'xml' ? 'svg' : ['markdown', 'md'].includes(lang) ? 'markdown' : 'code';
  const ext = { html: 'html', svg: 'svg', markdown: 'md' }[kind] || (lang.replace(/[^a-z0-9]/gi, '') || 'txt');
  const p = { id: uid(), name: `canvas-${(m.previews || []).length + 1}.${ext}`, kind, content: block.querySelector('code')?.innerText || '' };
  m.previews = [...(m.previews || []), p];
  await save();
  openPane(m.id, p.id, 'canvas');
}

// ---------- pictures, videos and files in chat ----------
function mediaHtml(m) {
  const items = (m.media || []).filter((x) => x && SAFE_MEDIA.test(String(x.url || '')));
  if (!items.length) return '';
  // Pictures are files streamed from disk; very big ones show a screen-sized copy, ones too big
  // to decode get the clear card, and five or more become a gallery of small thumbnails.
  const huge = items.filter((x) => x.kind === 'image' && x.huge).map((x) => hugePictureCard(x, icon)).join('');
  const picItems = items.filter((x) => x.kind === 'image' && !x.huge);
  const gallery = picItems.length >= GALLERY_MIN ? `<div class="galwrap"><div class="mh">${icon('eye', 'sm')}${picItems.length} pictures <button class="mini" data-a="gallery" data-m="${esc(m.id)}" data-i="0">Open gallery</button></div>${galleryGrid(picItems, { msg: m.id, limit: 60 })}</div>` : '';
  const auds = items.filter((x) => x.kind === 'audio').map((x) => `<figure class="media aud"><audio controls preload="metadata" src="${esc(x.url)}"></audio><figcaption><span>${esc(x.name)}</span><span class="faint">${fmtBytes(x.size)}</span><span class="grow"></span><button class="mini" data-a="media-save" data-f="${esc(x.file || '')}" data-n="${esc(x.name)}">${icon('dl', 'sm')}Save as…</button><button class="mini" data-a="media-reveal" data-f="${esc(x.file || '')}">Show in folder</button></figcaption></figure>`).join('');
  const btns = (x) => `<button class="mini" data-a="media-save" data-f="${esc(x.file || '')}" data-n="${esc(x.name)}">${icon('dl', 'sm')}Download</button><button class="mini" data-a="media-repo" data-f="${esc(x.file || '')}" data-n="${esc(x.name)}">${icon('gh', 'sm')}Save to repo…</button>`;
  const pics = gallery ? '' : picItems.map((x, i) => `<figure class="media"><img src="${esc(shownUrl(x))}" alt="${esc(x.name)}" data-a="gallery" data-m="${esc(m.id)}" data-i="${i}" loading="lazy" decoding="async"${x.width ? ` width="${Number(x.width)}" height="${Number(x.height)}"` : ''}><figcaption><span>${esc(x.name)}</span>${x.view ? `<span class="faint" title="The original is ${esc(fmtBytes(x.size))}${x.width ? `, ${x.width}×${x.height}` : ''}">screen-sized copy</span>` : ''}<span class="grow"></span>${btns(x)}</figcaption></figure>`).join('');
  const vids = items.filter((x) => x.kind === 'video').map((x) => `<figure class="media vid"><video controls preload="metadata" src="${esc(x.url)}"${x.poster && SAFE_MEDIA.test(x.poster) ? ` poster="${esc(x.poster)}"` : ''}></video><figcaption><span>${esc(x.name)}</span><span class="faint">${fmtBytes(x.size)}</span><span class="grow"></span>${btns(x)}</figcaption></figure>`).join('');
  const files = items.filter((x) => x.kind === 'file').map((x) => `<div class="card filec"><div class="hd">${icon('doc')}<div class="fn"><b>${esc(x.name)}</b><span class="faint">${fmtBytes(x.size)} · ${esc(String(x.name).split('.').pop().toUpperCase())}</span></div><span class="grow"></span><button class="btn" data-a="media-open" data-f="${esc(x.file || '')}">Open</button><button class="btn" data-a="media-save" data-f="${esc(x.file || '')}" data-n="${esc(x.name)}">${icon('dl', 'sm')}Save</button><button class="btn ghost" data-a="media-repo" data-f="${esc(x.file || '')}" data-n="${esc(x.name)}">${icon('gh', 'sm')}To repo…</button></div></div>`).join('');
  return `${gallery}${pics ? `<div class="pics">${pics}</div>` : ''}${huge}${vids}${auds}${files}`;
}

// Big files being copied or downloaded into a chat: one line at the bottom with Stop.
// Drawn straight into its own element (the chat isn't re-rendered for every update).
function showCopy(p) {
  let el = document.getElementById('copybar');
  if (!p || p.finished) { S.copying = null; el?.remove(); return; }
  S.copying = p;
  if (!el) { el = document.createElement('div'); el.id = 'copybar'; el.className = 'copybar'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
  el.innerHTML = `<span>${esc(progressLine(p))}</span>${pct != null ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ''}<button class="mini" data-a="copy-cancel">${icon('x', 'sm')}Stop</button>`;
}

// The gallery viewer: keys, controller and zoom. Only the shown picture is loaded.
function galleryDo(actName) {
  const g = S.modal;
  if (g?.kind !== 'gallery') return;
  if (actName === 'close') { S.modal = null; renderOverlay(); return; }
  S.modal = galleryStep(g, actName);
  renderOverlay();
  galleryFocus();
}
let padPrev = [];
function galleryFocus() {
  document.getElementById('gviewer')?.focus({ preventScroll: true });
  // A controller (Steam Deck, ROG Ally, Xbox pad): polled only while the gallery is open.
  if (galleryFocus.polling || !navigator.getGamepads) return;
  galleryFocus.polling = true;
  const poll = () => {
    if (S.modal?.kind !== 'gallery') { galleryFocus.polling = false; padPrev = []; return; }
    const pad = [...(navigator.getGamepads() || [])].find(Boolean);
    if (pad) { const now = pad.buttons.map((b) => b.pressed); for (const x of padActions(now, padPrev)) galleryDo(x); padPrev = now; }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}

// Mermaid diagrams: drawn in a sandboxed frame with the bundled library (never in this window).
const diagramUrls = new Map();
async function drawDiagrams() {
  const boxes = [...document.querySelectorAll('.mermaid-box:not([data-drawn])')];
  for (const box of boxes) {
    box.dataset.drawn = '1';
    const key = box.dataset.src || '';
    let src = '';
    try { src = decodeURIComponent(escape(atob(key))); } catch { continue; }
    const dark = document.documentElement.dataset.mode !== 'light';
    const pageFor = (lib) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:${dark ? '#1d1a17' : '#fffdf9'};color:${dark ? '#e9e2d7' : '#2d2822'};font:13px system-ui,sans-serif}.mermaid{display:flex;justify-content:center;padding:10px}</style><script src="${lib}"></script></head><body><pre class="mermaid">${esc(src)}</pre><script>mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'${dark ? 'dark' : 'default'}'});mermaid.run({querySelector:'.mermaid'}).then(function(){parent.postMessage({hearthDiagram:1,h:document.documentElement.scrollHeight},'*')}).catch(function(e){document.body.textContent='This diagram has an error: '+(e&&e.message||e);parent.postMessage({hearthDiagram:1,h:60},'*')});</script></body></html>`;
    let url = diagramUrls.get(key + dark);
    if (!url && api?.previewServe) { const r = await call('previewServe', pageFor('hearth-preview://lib/mermaid.min.js'), { diagram: true }); if (r?.ok) { url = r.url; diagramUrls.set(key + dark, url); } }
    // Outside the app (the screenshot harness) the frame loads the same bundled file over http.
    const page = url ? '' : /^https?:/.test(location.protocol) ? pageFor(new URL('vendor/mermaid/mermaid.min.js', location.href).href) : '';
    if (!url && !page) continue;
    const f = document.createElement('iframe');
    f.className = 'dg-frame';
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.title = 'Diagram';
    if (url) f.src = url; else f.srcdoc = page;
    box.replaceChildren(f);
  }
}
window.addEventListener('message', (e) => {
  if (!e.data || e.data.hearthDiagram !== 1) return;
  for (const f of document.querySelectorAll('iframe.dg-frame')) if (f.contentWindow === e.source) f.style.height = `${Math.min(900, Math.max(60, Number(e.data.h) || 200))}px`;
});

// ---------- voice: Talk view, dictation, read aloud (src/voice.mjs) ----------
const voice = createVoice({
  call, api, esc, icon, toast,
  settings: () => S.settings,
  renderOverlay: () => renderOverlay(),
  rerender: () => render(),
  entry: (id) => entry(id),
  rt: (id) => (id ? rt(id) : null),
  openId: () => S.open,
  mode: () => S.mode,
  cards: () => S.cards || [],
  cardById: (id) => cardById(id),
  aiName: (a) => aiName(a),
  avatar: (c) => avatarHtml(c, 'sm'),
  mono: (a) => mono(a, 'sm'),
  lead: () => team().lead,
  members: () => team().members.filter((a) => !AGENTS[a]?.imagesOnly),
  // What he said, sent as his message in the chat the Talk view belongs to.
  send: async (text) => { if (S.open !== voice.chatId()) return; await send(text); },
  addDraft: (t, via) => { S.draft = `${S.draft ? `${S.draft} ` : ''}${t}`; render(true); focusComposer(); if (via) toast(`Heard with ${via}.`); },
});
function toggleVoice() { return voice.dictate(); }
function readAloud(m) { return voice.readAloud(m); }
function stopSpeaking() { voice.stopSpeaking(); }
function autoRead(R) {
  if (!S.settings.autoRead || R.id !== S.open || voice.isOpen()) return;
  const last = [...R.msgs].reverse().find((m) => m.who !== 'owner' && m.who !== 'system' && !m.err);
  if (last) readAloud(last);
}
function openTalk() {
  if (S.view !== 'chat' || !S.open) { toast('Open a chat first, then press Talk.'); return; }
  S.pop = null;
  voice.openView(S.open);
}
// A voice picked from a picker: 'set:<key>' gives the settings change to save (the change handler
// saves it: his pick), 'card' goes into the character being edited (saved when he presses Save).
function pickVoice(key, provider, id) {
  const list = voice.state.lists[provider] || [];
  const val = !id ? null : provider === 'elevenlabs' ? { id, name: list.find((x) => x.id === id)?.name || id } : id;
  // A speech server's voice is kept per server (voices[k].servers[<id>]).
  if (isServer(provider)) {
    const sid = serverIdOf(provider);
    if (key === 'card') { const c = S.cardEdit; if (!c) return null; c.ownerVoice = { ...(c.ownerVoice || {}), servers: { ...(c.ownerVoice?.servers || {}), [sid]: val || undefined } }; c.voiceChanged = true; renderMain(); return null; }
    if (key.startsWith('set:')) return { voices: { [key.slice(4)]: { servers: { [sid]: val } } } };
    return null;
  }
  if (key === 'card') { const c = S.cardEdit; if (!c) return null; c.ownerVoice = { ...(c.ownerVoice || {}), [provider]: val || undefined }; c.voiceChanged = true; renderMain(); return null; }
  if (key.startsWith('set:')) return { voices: { [key.slice(4)]: { [provider]: val } } };
  return null;
}
function previewVoice(key, provider, who) {
  const v = voiceSettings(S.settings);
  const sel = key === 'card' ? (S.cardEdit?.ownerVoice || {}) : (v.voices[key.slice(4)] || {});
  const id = document.querySelector(`[data-vpick="${CSS.escape(key)}"]`)?.value || idOf(sel, provider) || (voice.state.lists[provider] || [])[0]?.id || '';
  const name = key === 'card' ? (S.cardEdit?.name || 'your character') : key === 'set:narrator' ? 'the narrator' : key === 'set:default' ? 'the default voice' : aiName(key.slice(4));
  voice.preview({ provider, voice: id, speed: sel.speed, pitch: sel.pitch, who: who || 'owner' }, `Hello, ${ownerName()}. I'm ${name}, and this is how I sound.`);
}

// ---------- export ----------
async function exportChat(id, fmt) {
  const R = await loadRt(id);
  const c = entry(id);
  const who = (m) => (m.who === 'owner' ? ownerName() : m.who === 'system' ? 'App' : aiName(m.who));
  const msgs = R.msgs.filter((m) => !m.local && !m.deleted);
  const md = [`# ${c?.title || 'Chat'}`, '', ...msgs.flatMap((m) => [`**${who(m)}** · ${String(m.at || '').slice(0, 16).replace('T', ' ')}`, '', String(m.text || ''), ...(m.media || []).map((x) => (x.kind === 'image' ? `![${x.name}](${x.url})` : `[${x.name}](${x.url})`)), ...(m.previews || []).filter((p) => p.original).map((p) => `[${p.name}](hearth-media://c/${id}/${encodeURIComponent(p.original)})`), ''])].join('\n');
  const body = msgs.map((m) => `<section class="${m.who === 'owner' ? 'u' : 'a'}"><h4>${esc(who(m))} <small>${esc(String(m.at || '').slice(0, 16).replace('T', ' '))}</small></h4>${rich(m.text)}${(m.media || []).filter((x) => x.kind === 'image').map((x) => `<img src="${esc(x.url)}" alt="${esc(x.name)}">`).join('')}${(m.media || []).filter((x) => x.kind !== 'image').map((x) => `<p class="f">${esc(x.kind === 'video' ? 'Video' : 'File')}: ${esc(x.name)}</p>`).join('')}</section>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: file:; media-src data: file:; style-src 'unsafe-inline'"><title>${esc(c?.title || 'Chat')}</title><style>body{font:15px/1.6 system-ui,sans-serif;max-width:820px;margin:32px auto;padding:0 24px;color:#2d2822}h1{font-family:Georgia,serif}section{margin:0 0 22px}section.u{background:#f4efe7;border-radius:12px;padding:10px 16px}h4{margin:0 0 4px;font-size:13px}small{color:#9a9083;font-weight:400}img{max-width:100%;border-radius:10px;margin:6px 0}pre{background:#0d1117;color:#c9d1d9;padding:12px;border-radius:8px;overflow:auto;white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px}.cb-hd button{display:none}.f{color:#71685c}</style></head><body><h1>${esc(c?.title || 'Chat')}</h1>${body}</body></html>`;
  const r = await call('chatExport', id, fmt, { markdown: md, html });
  if (r?.ok) toast(`Exported to ${r.file}.`); else if (!r?.cancelled) toast(r?.message || 'Not exported.');
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
  // The Talk view belongs to one chat: leaving it closes the view (and the microphone).
  if (voice.isOpen() && (S.view !== 'chat' || S.open !== voice.chatId())) voice.closeView();
  renderSide();
  renderMain(scroll);
  renderPane();
  renderOverlay();
}

function chatStatus(id) {
  const R = runner.runtimes.get(id);
  if (!R) return '';
  if (R.round) return `<span class="st" title="The team is working in this chat"><span class="spin"></span>replying…</span>`;
  if (R.waiting) return `<span class="st" title="Over your limit of chats working at once: it waits its turn">waiting…</span>`;
  if (R.unseen) return '<span class="dot" title="New results you haven\'t seen"></span>';
  return null;
}

function renderSide() {
  const groups = groupChats(S.chats, { query: S.search, hits: S.hits });
  const hidden = S.chats.filter((c) => c.hidden);
  const item = (c) => {
    const on = S.view === 'chat' && S.open === c.id;
    const R = runner.runtimes.get(c.id);
    const pend = R && R.msgs.some((m) => (m.acts || []).some((a) => a.status === 'pending' && !expired(a)) || (m.memo || []).some((p) => p.status === 'pending'));
    if (S.renaming === c.id) return `<div class="item on renaming"><input id="rename-input" class="rename" value="${esc(c.title)}" maxlength="120" aria-label="Chat name"><button class="ib sm" data-a="rename-save" title="Save">${icon('check', 'sm')}</button></div>`;
    const st = chatStatus(c.id);
    return `<div class="item ${on ? 'on' : ''} ${R?.round ? 'busy' : ''}" draggable="true" data-chat="${esc(c.id)}" data-drag="${esc(c.id)}" title="${esc(c.title)}${c.repo ? ` · ${esc(c.repo)}` : ''}">
      ${c.rp ? avatarHtml(cardById(c.rp.characters[0]), 'xs') : icon(c.pinned ? 'pin' : 'chat', 'sm')}<span class="t">${esc(c.title)}</span>
      ${st || (pend ? '<span class="dot"></span>' : repoHint(c) ? `<span class="repo">${esc(repoHint(c))}</span>` : '')}
      <button class="more" data-a="chat-menu" data-id="${esc(c.id)}" title="More" aria-label="More for ${esc(c.title)}">${icon('dots', 'sm')}</button>
    </div>`;
  };
  const working = runner.busyIds().length;
  const html = `
    <div class="brand"><img src="./icon.png" alt=""><div><b>Hearth AI</b><span>Command Center</span></div></div>
    <button class="newchat" data-a="new-chat"><span class="plus">${icon('plus', 'sm')}</span>New chat</button>
    <button class="navitem" data-a="temp-chat" title="Nothing is saved: no chat file, no history, no memory">${icon('eyeoff', 'sm')}Temporary chat</button>
    <label class="search">${icon('search', 'sm')}<input id="chat-search" placeholder="Search chats" value="${esc(S.search)}" aria-label="Search chats"></label>
    <button class="navitem ${['characters', 'card', 'lorebooks'].includes(S.view) ? 'on' : ''}" data-a="characters" title="Character cards, lorebooks and your persona">${icon('user', 'sm')}Characters<span class="faint">${S.cards ? S.cards.length : ''}</span></button>
    <button class="navitem ${S.view === 'studio' ? 'on' : ''}" data-a="studio" title="Pictures and videos made on your PC (ComfyUI)">${icon('pic', 'sm')}Images &amp; Videos<span class="faint">${S.studio.data?.jobs?.length ? `${S.studio.data.jobs.length} on your PC` : ''}</span></button>
    <button class="navitem ${S.view === 'reverse' ? 'on' : ''}" data-a="reverse" title="Look inside programs with REA and your AI">${icon('code', 'sm')}Reverse Engineering<span class="faint">${S.re?.projects?.length ? S.re.projects.length : ''}</span></button>
    <button class="navitem hab ${S.view === 'habitat' ? 'on' : ''}" data-a="habitat" title="Your AI team's Habitat">${icon('home', 'sm')}Habitat<span class="faint">${esc(S.lastChat && entry(S.lastChat) ? entry(S.lastChat).title.slice(0, 22) : 'your team')}</span></button>
    <div class="list" id="chat-list">
      ${S.broken ? '<div class="note bad">Your chats list couldn\'t be read. It was left as it is; new chats can\'t be saved until it\'s fixed.</div>' : ''}
      ${working ? `<div class="sec">${working} working · up to ${S.settings.maxChats || 3} at once</div>` : ''}
      ${S.temps.length ? `<div class="sec">Temporary (not saved)</div>${S.temps.map((c) => `<div class="item ${S.view === 'chat' && S.open === c.id ? 'on' : ''}" data-chat="${esc(c.id)}">${icon('eyeoff', 'sm')}<span class="t">${esc(c.title)}</span>${chatStatus(c.id) || ''}<button class="more vis" data-a="temp-end" data-id="${esc(c.id)}" title="End and forget it">${icon('x', 'sm')}</button></div>`).join('')}` : ''}
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
  if (S.view === 'studio') return `<span class="ttl">Images &amp; Videos</span><span class="grow"></span>`;
  if (S.view === 'reverse') return `<span class="ttl">Reverse Engineering</span><span class="grow"></span>`;
  const title = S.view === 'settings' ? 'Settings' : S.view === 'habitat' ? 'Habitat' : ['characters', 'card', 'lorebooks'].includes(S.view) ? 'Characters' : S.view === 'chat' ? (c?.title || 'Chat') : '';
  if (['characters', 'card', 'lorebooks'].includes(S.view)) return `<span class="ttl">${esc(title)}</span><span class="grow"></span>`;
  const chip = S.view === 'chat' && c && (c.repo || c.repoDir) ? `<button class="chip" data-a="repo-pop" title="Connected repo">${icon('gh', 'sm')}${esc(c.repo || c.repoDir)} <span class="faint">· ${esc(c.branch || S.copy?.base || 'default branch')}</span></button>` : '';
  const temp = S.view === 'chat' && c?.temp ? `<span class="chip">${icon('eyeoff', 'sm')}Temporary · nothing is saved</span><button class="mini" data-a="temp-end" data-id="${esc(c.id)}">End</button>` : '';
  const know = S.view === 'chat' && c?.rp ? `<span class="chip">${rpCards(c).map((x) => avatarHtml(x, 'xs')).join('')}Roleplay${c.rp.characters.length > 1 ? ` · group · ${c.rp.order === 'list' ? 'in order' : 'natural order'}` : ''}</span>` : S.view === 'chat' && c && !c.temp ? `<button class="tb" data-a="chat-act" data-k="knowledge" data-id="${esc(c.id)}" title="This chat's instructions and reference files">${icon('doc', 'sm')}${c.instructions || c.refs?.length ? 'Instructions ✓' : 'Instructions'}</button>` : '';
  if (S.view === 'habitat') return `<span class="ttl">Habitat</span><span class="faint hab-sub">${S.lastChat && entry(S.lastChat) ? `the team of “${esc(entry(S.lastChat).title)}”` : 'your AI team'}</span><span class="grow"></span>`;
  return `<span class="ttl">${esc(title)}</span>${chip}${temp}<span class="grow"></span>${know}
    <button class="tb" data-a="team-pop" title="Who's in this chat">${icon('users', 'sm')}Team</button>
    ${S.view === 'chat' && S.msgs.some((m) => (m.media || []).some((x) => x.kind === 'image')) ? `<button class="tb" data-a="gallery" data-m="" data-i="0" title="Every picture in this chat">${icon('eye', 'sm')}Gallery</button>` : ''}
    <button class="tb" data-a="toggle-pane" title="Live preview and canvas panel" ${S.view !== 'chat' ? 'disabled' : ''}>${icon('panel', 'sm')}</button>`;
}

function renderMain(scroll = false) {
  setRegion('top', topbar());
  const body = document.getElementById('body');
  const atBottom = body ? body.scrollHeight - body.scrollTop - body.clientHeight < 120 : true;
  let html = '';
  let dock = '';
  if (S.view !== 'habitat' && habMounted) { stopHabitat(); stopHabitat3d(); habMounted = false; }
  if (S.view === 'settings') { html = settingsView(); dock = ''; }
  else if (S.view === 'habitat') { html = `<div class="habwrap">${viewHabitat()}</div>`; dock = ''; }
  else if (S.view === 'studio') { stSync(); html = stHtml(); dock = ''; }
  else if (S.view === 'reverse') { html = reverseView(); dock = ''; }
  else if (S.view === 'characters') { html = charactersView(); dock = ''; }
  else if (S.view === 'card') { html = cardEditView(); dock = ''; queueMicrotask(() => cfRun(false)); }
  else if (S.view === 'lorebooks') { html = lorebooksView(); dock = ''; }
  else if (S.view === 'chat') { html = chatView(); dock = composer(entry()?.rp ? `Your line as ${S.persona?.name || 'you'}…` : cur()?.canvas ? 'Ask for changes to the canvas…' : S.open && S.msgs.some((m) => m.previews?.length) && S.pane ? 'Ask for changes to the preview…' : 'Reply to the team…') + `<div class="hint">${esc(hintLine())}</div>`; }
  else { html = homeView(); dock = ''; }
  const main = document.getElementById('main');
  main.classList.toggle('home-mode', S.view === 'home');
  main.classList.toggle('settings-mode', S.view === 'settings');
  main.classList.toggle('habitat-mode', S.view === 'habitat');
  main.classList.toggle('studio-mode', S.view === 'studio');
  main.classList.toggle('lib-mode', ['characters', 'card', 'lorebooks'].includes(S.view));
  const keep = S.view === 'studio' ? stFocus() : null;
  const changed = setRegion('body', html);
  if (keep && changed) stRefocus(keep);
  if (S.view === 'habitat' && (changed || !habMounted)) {
    const el = document.getElementById('habitat');
    if (el) { mountHabitat(el, habitatHooks); mountHabitat3d(el, habitatHooks); habMounted = true; }
  }
  const focused = document.activeElement?.id === 'composer';
  const caret = focused ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  if (setRegion('dock', dock) && focused) focusComposer(caret);
  if (S.view === 'home' && focused) focusComposer(caret);
  fitComposer();
  if (S.editing) { const el = document.getElementById('edit-text'); if (el && document.activeElement !== el) { el.focus(); } }
  if (body && (scroll || atBottom) && S.view === 'chat') body.scrollTop = body.scrollHeight;
  if (S.view === 'chat' && changed) drawDiagrams();
}

function hintLine() {
  const names = live().map(aiName);
  const c = entry();
  const R = cur();
  if (R?.waiting) return `Waiting: ${runner.queue.active.size} chats are already working (your limit is ${S.settings.maxChats || 3}). This one starts when one finishes.`;
  const waitingOn = team().members.filter((a) => !ready(a)).map((a) => `${aiName(a)}: ${statusOf(a).label}`);
  const who = (names.length ? `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.slice(-1)}` : names[0]} see${names.length > 1 ? '' : 's'} this chat` : 'No AI is set up yet') + (waitingOn.length ? ` · ${waitingOn.join(', ')}` : '');
  if (c?.temp) return `${who} · temporary: nothing is saved`;
  if (c?.rp) return `Roleplay · ${rpCards(c).map((x) => `${x.name} played by ${aiName(playerOf(c, x.id))}`).join(' · ')} · built-in limits always on`;
  return c && (c.repo || c.repoDir) ? `${who} · changes go to a branch · main only changes when you approve` : `${who} · no repo: nothing can be committed or pushed`;
}

function homeView() {
  return `<div class="home">
    <h1><img src="./icon.png" alt="">${esc(greeting())}, ${esc(ownerName())}</h1>
    ${composer('What should the team work on?')}
    <div class="sugs">${QUICK.map(([ic, label], i) => `<button class="sug" data-a="quick" data-i="${i}">${icon(ic, 'sm')}${esc(label)}</button>`).join('')}</div>
    <div class="fine">Every chat can connect to one of your GitHub repos. The team works in a small temporary copy on this PC; builds and tests run in GitHub Actions. Several chats can work at once.</div>
    ${S.notices.length ? `<div class="notices">${S.notices.map((n, i) => `<div class="note">${esc(n)}<button class="mini" data-a="dismiss" data-i="${i}">Dismiss</button></div>`).join('')}</div>` : ''}
    ${S.idle.length ? `<div class="notices">${S.idle.map((c) => `<div class="note warn">The temporary copy for “${esc(entry(c.chatId)?.title || c.repo || 'a chat')}” has work that isn't on GitHub, so it was kept. <button class="mini" data-a="open-data">Look at it</button></div>`).join('')}</div>` : ''}
  </div>`;
}

function composer(placeholder) {
  const c = S.view === 'chat' ? entry() : null;
  const conn = c ? (c.repo ? { repo: c.repo, branch: c.branch } : c.repoDir ? { repo: c.repoDir } : null) : S.conn;
  const t = team();
  const teamLabel = S.mode === 'team' ? `Team <span class="faint">(${esc(aiName(t.lead))} ★ leads)</span>` : esc(aiName(S.mode));
  const thumbs = S.attach.map((a, i) => a.kind === 'image' && !a.huge ? `<div class="th" style="background-image:url('${esc(a.url || '')}')" title="${esc(a.name)}"><button class="x" data-a="unattach" data-i="${i}" aria-label="Remove">${icon('x', 'sm')}</button></div>` : `<div class="th f" title="${esc(a.name)}"><span>${esc(a.name)}</span><button class="x" data-a="unattach" data-i="${i}" aria-label="Remove">${icon('x', 'sm')}</button></div>`).join('');
  const busy = Boolean(S.busy) || S.working;
  const models = c ? (cur()?.sessions?._models || {}) : S.homeModels;
  const picked = Object.entries(models).filter(([, v]) => v && v !== 'default').length;
  return `${c?.rp ? rpBar(c) : ''}<div class="composer ${busy ? 'busy' : ''}" id="composer-box">
    ${thumbs ? `<div class="thumbs">${thumbs}</div>` : ''}
    ${c && !c.rp && !(c.repo || c.repoDir) ? `<div class="cnote" id="no-push-note">${icon('gh', 'sm')}<span>This chat has no repo, so the team can't commit or push anything. Connect a repo if the work should go to GitHub.</span><button class="mini" data-a="repo-pop">Connect a repo</button></div>` : ''}
    ${missingNote()}
    ${S.deep ? `<div class="modes"><button class="chip on" data-a="toggle-deep" title="Turn deep research off">${icon('globe', 'sm')}Deep research ×</button></div>` : ''}
    <textarea id="composer" rows="1" placeholder="${esc(placeholder)}" aria-label="Message">${esc(S.draft)}</textarea>
    <div class="row">
      <button class="ib" data-a="attach" title="Attach files, images, videos, PDFs or spreadsheets (or paste a screenshot)" aria-label="Attach">${icon('plus', 'sm')}</button>
      <button class="ib" data-a="humanize-draft" title="Make it sound human (rewrites your draft so it reads less like AI)" aria-label="Make it sound human">${icon('user', 'sm')}</button>
      ${c?.rp ? '' : `<button class="chip ${conn ? '' : 'off'}" data-a="repo-pop" title="Connect a GitHub repo">${icon('gh', 'sm')}${conn ? `${esc(String(conn.repo).split('/').pop())} <span class="faint">· ${esc(conn.branch || 'main')}</span>` : 'No repo'}</button>
      <button class="chip" data-a="team-pop" title="Who answers">${icon('at', 'sm')}${teamLabel}</button>
      <button class="chip sw ${S.web ? 'on' : ''}" data-a="toggle-web" aria-pressed="${S.web}" title="Web search and reading pages">${icon('globe', 'sm')}Web</button>
      <button class="chip sw ${S.build ? 'on' : ''}" data-a="toggle-build" aria-pressed="${S.build}" title="Run quick checks here, push to the chat's branch, builds in GitHub Actions">${icon('play', 'sm')}Run &amp; build</button>`}
      <button class="chip" data-a="options-pop" title="Models, deep research, talk mode">${icon('more', 'sm')}${picked ? `Models (${picked})` : 'More'}</button>
      <span class="grow"></span>
      <button class="ib ${voice.dictating() ? 'rec' : ''}" data-a="voice" title="${voice.dictating() ? 'Stop and turn it into text' : 'Dictate: say your message, it becomes text'}" aria-label="Dictate">${icon('mic', 'sm')}</button>
      ${c ? `<button class="chip talk" data-a="talk" id="talk-btn" title="Voice chat: talk with ${c.rp ? 'the characters' : 'the team'} and hear the answers">${icon('wave', 'sm')}Talk</button>` : ''}
      ${busy ? `<button class="send stop" data-a="stop" title="Stop this chat" aria-label="Stop">${icon('stop', 'sm')}</button>` : ''}<button class="send" data-a="send" title="Send (Enter)" aria-label="Send">${icon('up', 'sm')}</button>
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
  const R = cur();
  const msgs = S.msgs.filter((m) => !m.deleted);
  const lastChanges = [...msgs].reverse().find((m) => m.changes)?.id;
  const lastAi = [...msgs].reverse().find((m) => m.who !== 'owner' && m.who !== 'system');
  const items = msgs.map((m) => message(m, m.id === lastChanges, m === lastAi && !R?.round)).join('');
  const b = S.busy;
  const working = b ? `<div class="msg-a working"><div class="who">${b.char ? avatarHtml(cardById(b.char)) : mono(b.agent)}<b>${esc(b.char ? `${cardById(b.char)?.name || ''} (${aiName(b.agent)})` : aiName(b.agent))}</b>${b.role === 'lead' ? '<span class="star">★ lead</span>' : b.role === 'reviewer' ? '<span>· reviewer</span>' : ''}<span>· working</span><span class="dots"><i></i><i></i><i></i></span>${b.note ? `<span class="faint">· ${esc(b.note)}</span>` : ''}</div>${stepsHtml(b.steps, [], true)}</div>` : R?.waiting ? `<div class="msg-s waitline">${icon('clock', 'sm')} Waiting for a free slot: ${runner.queue.active.size} chats are already working (your limit is ${S.settings.maxChats || 3}). This chat starts by itself when one finishes.</div>` : '';
  const empty = !msgs.length && !b ? `<div class="chat-empty"><p>${entry()?.temp ? 'A temporary chat: nothing is saved, and it ends when you close it.' : `Ask the team anything. ${entry()?.repo ? `They work in a temporary copy of <b>${esc(entry().repo)}</b> and push to their own branch.` : 'Connect a repo from the box below to let them change code.'}`}</p></div>` : '';
  const c = entry();
  if (c?.rp && R?.vn) return `<div class="col vncol">${vnStage(R, c)}</div>`;
  const rpEmpty = c?.rp && !msgs.length && !b ? `<div class="chat-empty"><p>The story starts with your first line.</p></div>` : '';
  return `<div class="col">${c?.rp ? rpEmpty : empty}${items}${working}${c?.rp ? sceneJobsHtml(R) : ''}${c?.rp ? '' : turnStrip(R)}</div>`;
}

// Who is in this turn: waiting, working, blocked, failed or done, with a plain reason and Retry.
const TS_ICON = { waiting: 'clock', working: 'cpu', blocked: 'flag', failed: 'x', done: 'check', skipped: 'clock' };
function turnStrip(R) {
  const ts = R?.turnState;
  if (!ts?.list?.length || (ts.list.length === 1 && ts.list[0].state === 'done')) return '';
  return `<div class="tstrip" id="turn-strip"><div class="mh">This turn</div>${ts.list.map((x) => `<div class="ts ${esc(x.state)}">${mono(x.agent, 'sm')}<b>${esc(aiName(x.agent))}</b><span class="chip ${x.state === 'done' ? 'g' : ['failed', 'blocked'].includes(x.state) ? 'b' : ''}">${icon(TS_ICON[x.state] || 'cpu', 'sm')}${esc(x.state)}</span><span class="d">${esc(x.reason || (x.state === 'working' ? 'answering now' : x.state === 'waiting' ? 'answers after the ones above' : ''))}</span><span class="grow"></span>${['failed', 'blocked'].includes(x.state) && !R.round ? `<button class="mini" data-a="turn-retry" data-v="${esc(x.agent)}">Retry</button>` : ''}</div>`).join('')}</div>`;
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

function helpersHtml(m) {
  if (!m.helpers?.length) return '';
  return `<div class="helpers">${m.helpers.map((h) => `<details class="helper ${h.state}"><summary>${mono(h.agent, 'sm')}<b>${esc(aiName(h.agent))}</b><span class="d">helper · ${esc(h.task.slice(0, 90))}</span><span class="r">${h.state === 'working' ? '<span class="spin"></span>working…' : h.state === 'done' ? '✓ reported back' : '✗ failed'}</span></summary>${h.text ? `<div class="text">${rich(h.text)}</div>` : ''}</details>`).join('')}</div>`;
}

function sourcesHtml(m) {
  if (!(m.web || m.who === 'perplexity' || m.citations?.length)) return '';
  const list = sourcesOf({ text: `${m.text || ''}\n${(m.citations || []).join('\n')}`, steps: m.steps || [] });
  if (!list.length) return '';
  return `<details class="sources"><summary>${icon('globe', 'sm')}Sources <span class="faint">${list.length}</span>${list.slice(0, 5).map((s) => `<span class="src-chip">${esc(s.host)}</span>`).join('')}</summary><ol>${list.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.host)}</a> <span class="faint">${esc(s.host)}</span></li>`).join('')}</ol></details>`;
}

function controlsHtml(m, owner = false) {
  const R = cur();
  const busy = R?.round || R?.waiting;
  const ver = m.versions?.length > 1 ? `<span class="ver"><button class="ib sm ghost" data-a="ver" data-m="${esc(m.id)}" data-d="-1" ${(m.v ?? m.versions.length - 1) === 0 ? 'disabled' : ''} aria-label="Previous version">‹</button>${(m.v ?? m.versions.length - 1) + 1}/${m.versions.length}<button class="ib sm ghost" data-a="ver" data-m="${esc(m.id)}" data-d="1" ${(m.v ?? m.versions.length - 1) === m.versions.length - 1 ? 'disabled' : ''} aria-label="Next version">›</button></span>` : '';
  const br = m.branches?.length > 1 ? `<span class="ver"><button class="ib sm ghost" data-a="branch" data-m="${esc(m.id)}" data-d="-1" ${(m.b || 0) === 0 || busy ? 'disabled' : ''} aria-label="Previous version">‹</button>${(m.b || 0) + 1}/${m.branches.length}<button class="ib sm ghost" data-a="branch" data-m="${esc(m.id)}" data-d="1" ${(m.b || 0) === m.branches.length - 1 || busy ? 'disabled' : ''} aria-label="Next version">›</button></span>` : '';
  if (owner) return `<div class="mctl u">${br}<button class="ib sm ghost" data-a="msg-copy" data-m="${esc(m.id)}" title="Copy">${icon('doc', 'sm')}</button>${!S.readOnly ? `<button class="ib sm ghost" data-a="msg-edit" data-m="${esc(m.id)}" title="Edit and resend" ${busy ? 'disabled' : ''}>${icon('pencil', 'sm')}</button>` : ''}</div>`;
  return `<div class="mctl">${ver}<button class="ib sm ghost" data-a="msg-copy" data-m="${esc(m.id)}" title="Copy">${icon('doc', 'sm')}</button><button class="ib sm ghost" data-a="humanize-msg" data-m="${esc(m.id)}" title="Make it sound human">${icon('user', 'sm')}</button><button class="ib sm ghost ${voice.isReading(m.id) ? 'rec' : ''}" data-a="msg-read" data-m="${esc(m.id)}" title="${voice.isReading(m.id) ? 'Stop reading' : 'Read aloud'}">${icon(voice.isReading(m.id) ? 'stop' : 'mic', 'sm')}</button>${!S.readOnly && AGENTS[m.who] ? `<button class="ib sm ghost" data-a="msg-retry" data-m="${esc(m.id)}" title="Retry (a new version of this answer)" ${busy ? 'disabled' : ''}>${icon('refresh', 'sm')}</button>` : ''}</div>`;
}

function message(m, latestChanges, last = false) {
  if (m.char) return rpMessage(m);
  if (m.block) return `<div class="msg-s block">${icon('shield', 'sm')} ${esc(m.text)}</div>`;
  if (m.who === 'system' && m.scene) return sceneMsg(m);
  if (m.who === 'system' && m.sceneFailed) return `<div class="msg-s" data-msg="${esc(m.id)}">${rich(m.text)}${S.readOnly ? '' : `<div class="mft left"><button class="mini" data-a="scene-edit" data-m="${esc(m.id)}">${icon('pencil', 'sm')}Try again</button></div>`}</div>`;
  if (m.who === 'owner') {
    const atts = (m.attachments || []).map((a) => a.kind === 'image' && !a.huge ? `<img class="att" src="${esc(a.url || '')}" alt="${esc(a.name)}" loading="lazy" decoding="async">` : `<span class="att-f" ${a.huge ? `title="${esc(a.huge)}"` : ''}>${icon('doc', 'sm')}${esc(a.name)}${a.size > 50 * 1024 * 1024 ? ` <span class="faint">${fmtBytes(a.size)}</span>` : ''}</span>`).join('');
    if (S.editing === m.id) return `<div class="msg-u editing" data-msg="${esc(m.id)}"><textarea id="edit-text" rows="3">${esc(m.text)}</textarea><div class="mft"><button class="btn ghost" data-a="edit-cancel">Cancel</button><button class="btn p" data-a="edit-send" data-m="${esc(m.id)}">Save and send</button></div></div>`;
    return `<div class="uwrap" data-msg="${esc(m.id)}"><div class="msg-u">${atts ? `<div class="atts">${atts}</div>` : ''}${rich(m.text)}${m.to ? `<div class="fine">only for ${esc(m.to.map(aiName).join(', '))}: not shown to your other AIs</div>` : ''}</div>${controlsHtml(m, true)}</div>`;
  }
  if (m.who === 'system') return `<div class="msg-s">${rich(m.text)}${mediaHtml(m)}</div>`;
  const role = m.role === 'lead' ? '<span class="star">★ lead</span>' : m.role === 'reviewer' ? '<span>· reviewer</span>' : '';
  const when = ago(m.at);
  return `<div class="msg-a ${m.err ? 'err' : ''}" data-msg="${esc(m.id)}">
    <div class="who">${mono(m.who)}<b>${esc(aiName(m.who))}</b>${role}${when ? `<span>· ${esc(when)}</span>` : ''}${m.via ? `<span class="faint">· ${esc(m.via)}</span>` : ''}${UNFILTERED.includes(m.who) ? '<span class="faint">· not shown to your other AIs</span>' : ''}</div>
    ${stepsHtml(m.steps, m.outcome || [], false, m.actions)}
    ${helpersHtml(m)}
    <div class="text">${rich(m.text)}</div>
    ${m.err && m.rawError ? `<details class="raw"><summary class="fine">Details (the tool's own words)</summary><pre class="mono">${esc(m.rawError)}</pre></details>` : ''}
    ${m.err && m.retryable !== false && AGENTS[m.who] && !cur()?.round ? `<div class="mft left"><button class="mini" data-a="turn-retry" data-v="${esc(m.who)}">Retry ${esc(aiName(m.who))}</button></div>` : ''}
    ${mediaHtml(m)}
    ${(m.mediaProblems || []).map((p) => p.tooBig || p.noSpace ? problemCard(p, icon) : `<div class="media-why">${icon('eye', 'sm')}<span>Can't show <b class="mono">${esc(p.path)}</b>: ${esc(p.reason)}.</span></div>`).join('')}
    ${(m.previews || []).map((p) => previewCard(m, p)).join('')}
    ${sourcesHtml(m)}
    ${m.changes ? changesCard(m, latestChanges) : ''}
    ${m.actions && ['failure'].includes(m.actions.state) ? actionsCard(m) : ''}
    ${(m.acts || []).map((a) => actCard(a)).join('')}
    ${(m.memo || []).map((p) => memoCard(m, p)).join('')}
    ${(m.refusedActs || []).map((r) => `<div class="msg-s">Claude asked to “${esc(r.kind)}”, which isn't allowed: ${esc(r.reason)}.</div>`).join('')}
    ${controlsHtml(m)}
    ${last && m.followUps?.length ? `<div class="chips">${m.followUps.map((f, i) => `<button class="sug" data-a="follow" data-m="${esc(m.id)}" data-i="${i}">${esc(f)}</button>`).join('')}</div>` : ''}
  </div>`;
}

function previewCard(m, p) {
  if (p.tooBig) return previewTooBig(p, icon);
  if (p.file) return `<div class="card pv"><div class="hd">${icon('eye', 'sm')}<b>${esc(p.name)}</b><span class="faint">${fmtBytes(p.size)}${p.extracted ? ` · ${p.extracted} picture${p.extracted > 1 ? 's' : ''} loaded from disk` : ''}</span><span class="grow"></span><span class="chip">Live preview</span></div>
    <div class="ft"><button class="btn p" data-a="open-preview" data-m="${esc(m.id)}" data-p="${esc(p.id)}">Open</button><button class="btn" data-a="media-browser" data-f="${esc(p.original || p.file)}">${icon('globe', 'sm')}Open in browser</button><button class="btn" data-a="media-save" data-f="${esc(p.original || p.file)}" data-n="${esc(p.name)}">${icon('dl', 'sm')}Save as…</button><button class="btn" data-a="media-reveal" data-f="${esc(p.original || p.file)}">Show in folder</button></div></div>`;
  return `<div class="card pv"><div class="hd">${icon(p.kind === 'code' ? 'code' : 'eye', 'sm')}<b>${esc(p.name)}</b><span class="grow"></span><span class="chip">${p.kind === 'code' ? 'Canvas' : 'Live preview'}</span></div>
    <div class="ft"><button class="btn p" data-a="open-preview" data-m="${esc(m.id)}" data-p="${esc(p.id)}">Open</button><button class="btn" data-a="open-canvas" data-m="${esc(m.id)}" data-p="${esc(p.id)}">${icon('pencil', 'sm')}Edit in canvas</button><button class="btn" data-a="download-preview" data-m="${esc(m.id)}" data-p="${esc(p.id)}">${icon('dl', 'sm')}Download</button><button class="btn" data-a="save-preview" data-m="${esc(m.id)}" data-p="${esc(p.id)}">${icon('gh', 'sm')}Save to repo…</button></div></div>`;
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

function memoCard(m, p) {
  return `<div class="card askc memo"><div class="hd">${icon('db', 'sm')}<b>Remember this in every chat?</b><span class="d">“${esc(p.text)}”</span></div><div class="ft">${p.status === 'pending' ? `<button class="btn p" data-a="memo-yes" data-m="${esc(m.id)}" data-id="${esc(p.id)}">Yes, remember</button><button class="btn" data-a="memo-no" data-m="${esc(m.id)}" data-id="${esc(p.id)}">No</button><span class="fine">${esc(aiName(m.who))} suggested it · nothing is saved without your yes</span>` : `<span class="fine">${p.status === 'saved' ? 'Saved to memory (Settings › Memory).' : p.status === 'declined' ? 'Not saved.' : 'That suggestion is gone.'}</span>`}</div></div>`;
}

// ---------- roleplay views: library, card editor, lorebooks, visual novel ----------
const avatarHtml = (card, cls = '') => (card?.avatarUrl ? `<img class="cav ${cls}" src="${esc(card.avatarUrl)}" alt="">` : `<span class="cav ${cls} none">${esc((card?.name || '?')[0])}</span>`);
// A false "under 18" alarm (only a word or age somewhere in the text) can be cleared by the owner
// confirming the character's adult age. Not offered when the card itself says minor.
// No keyring on this PC: keys can't be encrypted. Say so plainly, and offer basic protection
// only as the owner's own choice (it is weak: the key file is protected only by file permissions).
const keyringNote = () => {
  if (S.prov?.encryption !== false && !S.prov?.weakEncryption) return '';
  if (S.prov?.weakEncryption) return `<div class="note warn">${icon('shield', 'sm')}<div><b>Keys use basic protection.</b><div class="fine">This PC has no keyring, so saved keys are protected only by your user account's file permissions. To use real encryption, unlock or install GNOME Keyring or KWallet, then turn basic protection off and add your keys again.</div></div>${S.settings.secretsBasic ? '<button class="mini" data-a="secrets-basic" data-v="off">Turn off</button>' : ''}</div>`;
  return `<div class="note warn">${icon('shield', 'sm')}<div><b>Keys can't be saved yet: this PC has no keyring.</b><div class="fine">The app encrypts keys with your desktop's keyring (GNOME Keyring, KWallet or the Secret portal), and none answered. Unlock or install one and press Re-check, or use basic protection: keys are then protected only by your user account's file permissions, which is weaker.</div></div><button class="mini" data-a="secrets-recheck">Re-check</button><button class="mini" data-a="secrets-basic" data-v="on">Use basic protection</button></div>`;
};
// Flag explanations: which field and words, hard (never cleared) or soft (cleared by an adult age).
const flagWord = (r) => (r.kind === 'hard' ? 'hard: can\'t be cleared' : 'soft: an adult age clears it');
const reasonsTitle = (c) => (c.limits?.reasons || []).map((r) => `${r.label} “${r.words}” (${flagWord(r)})`).join('\n');
const limitBadge = (c) => (c.limits?.minor ? `<button class="chip b flagb" data-a="flag-why" data-id="${esc(c.id || '')}" title="${esc(`Reads as under 18 because ${c.limits.minorWhy}.\n${reasonsTitle(c)}\nClick to see it in the editor.`)}">stories only · reads as under 18 · ${c.limits.hard ? 'hard' : 'soft'}</button>` : c.limits?.real ? `<span class="chip b" title="${esc(c.limits.realWhy)}">real person · nothing sexual</span>` : '');
function flagList(c) {
  const R = c.limits?.reasons || [];
  if (!R.length) return '';
  const hard = R.some((r) => r.kind === 'hard');
  const soft = R.some((r) => r.kind === 'soft');
  return `<div class="flags" id="card-flags"><div class="fine"><b>Why it's flagged</b> (as last saved; click one to find it)</div>
    ${R.slice(0, 20).map((r) => `<button class="flag ${r.kind}" data-a="flag-jump" data-f="${esc(r.field)}" data-w="${esc(r.words)}" ${r.field === 'age' ? 'disabled title="The card file\'s own age field"' : ''}><span class="chip ${r.kind === 'hard' ? 'b' : ''}">${r.kind}</span><span>${esc(r.label)}: “${esc(r.words)}”</span></button>`).join('')}
    ${hard ? '<div class="fine">Hard flags come from the card itself (an age under 18, a minor tag, words like loli or underage). They can never be cleared: no age, confirmation or setting changes them, and the character stays stories only.</div>' : ''}
    ${soft && !hard ? '<div class="fine">Soft flags are words that may be about someone else or the past. Setting an adult age (18+) below clears them.</div>' : ''}</div>`;
}
const ownerAgeOf = (c) => (c.ownerAgeEdit !== undefined ? c.ownerAgeEdit : c.ownerAdult?.age ? String(c.ownerAdult.age) : '');
function ageBox(c) {
  const hard = Boolean(c.limits?.hard);
  return `<label class="field" id="card-age">Set age (18+)<input type="number" data-cf="ownerAge" min="18" max="999" step="1" inputmode="numeric" value="${esc(hard ? '' : ownerAgeOf(c))}" placeholder="${hard ? 'can\'t be set: hard flag' : 'for example 25'}" ${hard ? 'disabled' : ''} aria-label="The character's age, 18 or more"></label>
    <div class="fine">${hard ? 'This card has a hard flag, so no age can clear it.' : 'Saved when you press Save, kept in this app only (never in exported card files). An adult age clears soft flags. Leave it empty to remove it.'}</div>`;
}
// Reverse Engineering (electron/reverse.cjs): REA, a connector only for these projects' chats.
function reverseView() {
  const r = S.re;
  if (!r) return '<div class="col"><div class="fine">Loading…</div></div>';
  const ok = (b) => (b ? `<span class="ok">${icon('check', 'sm')}</span>` : `<span class="bad">${icon('x', 'sm')}</span>`);
  const ready = r.node.ok && r.npx;
  return `<div class="col">
    <h1>Reverse Engineering</h1>
    <p class="fine">Pick a program and your AI looks inside it with <b>REA</b> (Reverse Engineer Anything, github.com/morluto/rea, MIT): what it is, what it's built with, what each part does, with the evidence for each answer. It works on Windows programs and DLLs, Linux programs, Electron and JavaScript apps, .NET, Android apps, firmware and network captures. Use it only on software you own or are allowed to look at, for things like making it work on Linux or keeping it alive.</p>
    ${r.broken ? '<div class="note bad">Your Reverse Engineering file couldn\'t be read. It was left as it is; nothing here can be saved until it\'s fixed.</div>' : ''}
    <div class="box"><h3>${icon('gear', 'sm')}REA</h3>
      <div class="srow"><b>REA ${esc(r.version)}</b><span class="d">${r.enabled ? 'On: given to the chats of your projects below, and to no other chat' : 'Off: no chat gets it'}</span><span class="grow"></span><button class="mini ${r.enabled ? '' : 'p'}" data-a="re-onoff" data-v="${r.enabled ? '0' : '1'}" ${!r.enabled && !ready ? 'disabled' : ''}>${r.enabled ? 'Turn off' : 'Turn on'}</button></div>
      <div class="srow">${ok(r.node.ok)}<b>Node.js</b><span class="d">${r.node.found ? `${esc(r.node.version)}${r.node.ok ? '' : ' · REA needs 22.23.4 or newer (or 24.22.1+, 26.12.1+)'}` : 'not found: install Node.js 22 or newer'}</span></div>
      <div class="srow">${ok(r.npx)}<b>npx</b><span class="d">${r.npx ? 'found: REA is fetched by it the first time, then kept' : 'not found (it comes with Node.js)'}</span></div>
      <div class="srow">${ok(r.ghidra.ok || Boolean(r.ghidra.onPath))}<b>Ghidra</b><span class="d">${r.ghidra.ok ? esc(r.ghidra.dir) : r.ghidra.onPath ? `found on this PC (${esc(r.ghidra.onPath)})` : 'optional: needed for Windows and Linux programs (12.1 or newer, free from ghidra-sre.org). Java ' + (r.java ? esc(r.java) : 'not found: it needs JDK 21 or newer')}</span><span class="grow"></span><button class="mini" data-a="re-ghidra">${r.ghidra.dir ? 'Change folder' : 'Pick Ghidra folder'}</button>${r.ghidra.dir ? '<button class="mini" data-a="re-ghidra-clear">Forget</button>' : ''}</div>
      <p class="fine">REA runs on this PC and only reads the program. What it finds is sent to the AI you use in the chat, under that AI's rules. Its own setup is never run, so nothing is added to Claude Code's, Codex's or Gemini's own settings.</p>
    </div>
    <div class="box"><h3>${icon('folder', 'sm')}Your projects</h3>
      <div class="srow"><span class="d">Each project is one program and its own chat. Use Claude Code, Codex or Gemini as the lead: REA works through them.</span><span class="grow"></span><button class="btn p" data-a="re-new" ${r.broken ? 'disabled' : ''}>${icon('plus', 'sm')}New project</button></div>
      ${r.projects.length ? r.projects.slice().reverse().map((p) => `<div class="srow">${icon('doc', 'sm')}<b>${esc(p.name)}</b><span class="d">${esc(p.kind)} · <span class="mono">${esc(p.path)}</span>${p.exists ? '' : ' · <span class="bad">file not found</span>'}</span><span class="grow"></span>${p.chat ? `<button class="mini p" data-a="re-open" data-id="${esc(p.chatId)}">Open chat</button>` : '<span class="faint">chat deleted</span>'}<button class="mini" data-a="re-remove" data-id="${esc(p.id)}" title="Takes it off this list; its chat stays in Chats">Remove</button></div>`).join('') : '<p class="fine">No projects yet. Press New project and pick a program.</p>'}
    </div>
  </div>`;
}
async function openReverse() { S.view = 'reverse'; S.open = null; render(true); S.re = await call('reverseStatus'); render(); }
async function openReChat(id, first) {
  await loadChats();
  await openChat(id);
  if (!first) { const r = await call('reverseFirst', id); first = r?.ok ? r.first : ''; }
  if (first && !S.msgs.length && !String(S.draft || '').trim()) { S.draft = first; render(true); focusComposer(); toast('Your first message is ready. Nothing is sent until you press Send.'); }
  if (S.re && !S.re.enabled) toast('REA is off, so this chat can\'t use it yet: turn it on in Reverse Engineering.');
}

function charactersView() {
  if (S.cards === null) return '<div class="col"><div class="fine">Loading…</div></div>';
  const colls = S.colls || [];
  const cc = colls.find((x) => x.id === S.cardColl) || null;
  if (!cc) S.cardColl = '';
  const has = (id) => S.cards.some((c) => c.id === id);
  const base = cc ? cc.cardIds.map((id) => S.cards.find((c) => c.id === id)).filter(Boolean) : S.cards;
  const list = base.filter((c) => cardMatches(c, S.cardQuery));
  const sel = (S.collSel || []).filter((id) => cc?.cardIds.includes(id));
  const p = S.persona || {};
  const q = S.cardQuery.trim();
  const tabs = `<div class="colls" id="card-colls" role="tablist" aria-label="Collections"><button role="tab" class="chip ${cc ? '' : 'on'}" aria-selected="${!cc}" data-a="coll-view" data-id="">All characters <span class="faint">${S.cards.length}</span></button>${colls.map((x) => `<button role="tab" class="chip ${cc?.id === x.id ? 'on' : ''}" aria-selected="${cc?.id === x.id}" data-a="coll-view" data-id="${esc(x.id)}">${icon('doc', 'sm')}${esc(x.name)} <span class="faint">${x.cardIds.filter(has).length}</span></button>`).join('')}<span class="grow"></span><input id="coll-new" class="coll-new" placeholder="New collection" maxlength="80" aria-label="New collection name"><button class="mini" data-a="coll-new">${icon('plus', 'sm')}New collection</button></div>`;
  const bar = cc ? `<div class="srow coll-bar" id="coll-bar"><b>${esc(cc.name)}</b><span class="fine">Removing a card from this collection keeps it in All characters, in any other collection, and keeps its chats.</span><span class="grow"></span><button class="mini" data-a="coll-sel-all">${sel.length && sel.length === list.length ? 'Select none' : 'Select all'}</button><button class="btn" data-a="coll-remove-sel" ${sel.length ? '' : 'disabled'}>Remove selected from collection${sel.length ? ` (${sel.length})` : ''}</button></div>` : '';
  const addTo = (c) => (colls.length && !cc ? `<select class="coll-add" data-a="coll-addto" data-id="${esc(c.id)}" aria-label="Add ${esc(c.name)} to a collection"><option value="">Add to collection…</option>${colls.map((x) => `<option value="${esc(x.id)}" ${x.cardIds.includes(c.id) ? 'disabled' : ''}>${esc(x.name)}${x.cardIds.includes(c.id) ? ' (in it)' : ''}</option>`).join('')}</select>` : '');
  const where = (c) => { if (!q) return ''; const w = matchedIn(c, q); return w.length ? `<span class="fine found-in">found in ${esc(w.join(', '))}</span>` : ''; };
  return `<div class="lib" id="drop-cards">
    <div class="lib-hd"><h1>Characters</h1><span class="grow"></span><label class="search in">${icon('search', 'sm')}<input id="card-q" placeholder="Search names, tags and descriptions" aria-label="Search characters" value="${esc(S.cardQuery)}"></label><button class="btn p" data-a="find-chars">${icon('search', 'sm')}Find characters</button><button class="btn" data-a="card-import">${icon('dl', 'sm')}Import</button><button class="btn" data-a="card-new">${icon('plus', 'sm')}Create</button><button class="btn" data-a="lorebooks">${icon('doc', 'sm')}Lorebooks</button></div>
    <div class="persona">${p.avatarUrl ? `<img class="cav" src="${esc(p.avatarUrl)}" alt="">` : `<span class="cav none">${esc((p.name || 'Y')[0])}</span>`}<div><b>Your persona: ${esc(p.name || 'not set')}</b><span class="fine">${esc(String(p.description || 'Who you are in the stories. The characters call you by this name.').slice(0, 160))}</span></div><span class="grow"></span><button class="mini" data-a="persona-edit">Edit</button></div>
    ${foundHtml()}
    <p class="fine">Drop a character card here (PNG or JSON, Character Card V1, V2 or V3) or a lorebook JSON. Cards are kept on this PC with a backup. Built-in limits: no minors, no real people in anything sexual, nothing illegal.</p>
    ${tabs}${bar}
    ${q ? `<div class="fine" id="card-count">${list.length} of ${base.length} character${base.length === 1 ? '' : 's'} match “${esc(q)}”</div>` : ''}
    <div class="cgrid">${list.map((c) => `<div class="ccard ${sel.includes(c.id) ? 'picked' : ''}" data-card="${esc(c.id)}">${cc ? `<label class="coll-pick"><input type="checkbox" data-a="coll-sel" data-id="${esc(c.id)}" ${sel.includes(c.id) ? 'checked' : ''} aria-label="Select ${esc(c.name)}"></label>` : ''}${c.avatarUrl ? `<img src="${esc(c.avatarUrl)}" alt="">` : `<div class="noimg">${esc(c.name[0])}</div>`}<div class="cbody"><b>${esc(c.name)}</b><span class="fine">${esc((c.tags || []).slice(0, 4).join(' · ') || c.creator || '')}</span>${limitBadge(c)}${where(c)}<p>${esc(String(c.creator_notes || c.description || '').slice(0, 120))}</p></div><div class="cft"><button class="btn p" data-a="card-chat" data-id="${esc(c.id)}">Start chat</button><button class="mini" data-a="card-edit" data-id="${esc(c.id)}">Edit</button>${cc ? `<button class="mini" data-a="coll-remove-one" data-id="${esc(c.id)}" title="Keeps the card in All characters (Delete key)">${icon('x', 'sm')}Remove from collection</button>` : `<button class="mini" data-a="card-export" data-id="${esc(c.id)}" data-f="png">PNG</button><button class="mini" data-a="card-export" data-id="${esc(c.id)}" data-f="json">JSON</button>${addTo(c)}`}</div></div>`).join('') || (q ? '<div class="empty-list">No character matches that search.</div>' : cc ? '<div class="empty-list">This collection is empty. Add characters from All characters with "Add to collection…".</div>' : '<div class="empty-list">No characters yet. Import a card or create one.</div>')}</div></div>`;
}
// The Find box in the character editor (Ctrl+F): find and replace in the unsaved edit only.
function findBarHtml() {
  const F = S.cardFind;
  return `<div class="cfind" id="card-find" role="search" aria-label="Find in this card">
    <div class="row"><label class="search in">${icon('search', 'sm')}<input id="cf-q" value="${esc(F.q)}" placeholder="Find in this card" aria-label="Find in this card" autocomplete="off" spellcheck="false"></label>
      <span class="cf-count" id="cf-count" aria-live="polite"></span>
      <button class="mini" data-a="cf-prev" title="Previous match (Shift+Enter, Shift+F3)" aria-label="Previous match">↑</button><button class="mini" data-a="cf-next" title="Next match (Enter, F3)" aria-label="Next match">↓</button>
      <label class="day"><input type="checkbox" id="cf-case" ${F.matchCase ? 'checked' : ''}>Match case</label><label class="day"><input type="checkbox" id="cf-word" ${F.wholeWord ? 'checked' : ''}>Whole word</label>
      <span class="grow"></span><button class="tb" data-a="cf-close" aria-label="Close find (Escape)">${icon('x', 'sm')}</button></div>
    <div class="row"><input id="cf-rep" class="cf-rep" value="${esc(F.rep || '')}" placeholder="Replace with" aria-label="Replace with" autocomplete="off" spellcheck="false"><button class="mini" data-a="cf-rep1">Replace</button><button class="mini" data-a="cf-repall">Replace all</button><span class="fine">Only this card's unsaved edit changes; nothing is saved until you press Save.</span></div>
    <div class="cf-fields" id="cf-fields"></div></div>`;
}
function cardEditView() {
  const c = S.cardEdit;
  if (!c) return '';
  const f = (k, label, rows = 3, ph = '') => `<label class="field" data-ff="${k}">${label}<textarea data-cf="${k}" rows="${rows}" placeholder="${esc(ph)}">${esc(c[k] || '')}</textarea></label>`;
  const look = c.appearanceEdit !== undefined ? c.appearanceEdit : c.ownerLook?.appearance || '';
  return `<div class="lib edit"><div class="lib-hd"><button class="tb" data-a="characters">${icon('chevr', 'sm')}Characters</button><h1>${esc(c.id ? `Edit ${c.name}` : 'New character')}</h1><span class="grow"></span><button class="btn" data-a="cf-open" title="Find in this card (Ctrl+F)">${icon('search', 'sm')}Find</button><button class="btn ghost" data-a="characters">Cancel</button><button class="btn p" data-a="card-save">Save</button></div>
    ${S.cardFind?.open ? findBarHtml() : ''}
    <div class="cedit"><div class="cleft">${c.avatarUrl ? `<img class="big" src="${esc(c.avatarUrl)}" alt="">` : '<div class="big noimg">?</div>'}<button class="mini" data-a="card-pic">Change picture</button>${c.limits ? limitBadge(c) : ''}${flagList(c)}${ageBox(c)}
      ${voice.cardHtml(c)}
      <label class="field">Lorebooks<select data-cf="lorebooks" multiple size="4">${(S.books || []).map((b) => `<option value="${esc(b.id)}" ${(c.lorebooks || []).includes(b.id) ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
      ${c.character_book ? `<div class="fine">Embedded lorebook: ${c.character_book.entries?.length || 0} entries <button class="mini" data-a="lore-from-card" data-id="${esc(c.id || '')}">Copy to Lorebooks</button></div>` : ''}</div>
    <div class="cright"><label class="field" data-ff="name">Name<input data-cf="name" value="${esc(c.name || '')}" maxlength="120"></label>
      ${f('description', 'Description', 5, 'Who {{char}} is, what they look like…')}${f('personality', 'Personality', 2)}${f('scenario', 'Scenario', 2)}${f('first_mes', 'First message (greeting)', 4)}
      <label class="field" data-ff="alternate_greetings">Alternate greetings (one per block, separated by a line with ---)<textarea data-cf="alternate_greetings" rows="3">${esc((c.alternate_greetings || []).join('\n---\n'))}</textarea></label>
      ${f('mes_example', 'Example dialogue', 4, '<START>\n{{user}}: Hi\n{{char}}: *waves* "Hello!"')}${f('system_prompt', 'System prompt', 2)}${f('post_history_instructions', 'Post-history instructions', 2)}${f('creator_notes', 'Creator notes', 2)}
      <label class="field" data-ff="appearance">Appearance (for pictures: hair, eyes, clothes; kept in this app only)<textarea data-cf="appearance" rows="2" placeholder="For example: long silver hair, violet eyes, silver elven armour">${esc(look)}</textarea></label>
      <label class="field" data-ff="tags">Tags (comma separated)<input data-cf="tags" value="${esc((c.tags || []).join(', '))}"></label>
      <label class="field">Creator<input data-cf="creator" value="${esc(c.creator || '')}"></label></div></div></div>`;
}
function lorebooksView() {
  const b = S.loreEdit;
  if (b) {
    return `<div class="lib edit"><div class="lib-hd"><button class="tb" data-a="lorebooks">${icon('chevr', 'sm')}Lorebooks</button><h1>${esc(b.name || 'New lorebook')}</h1><span class="grow"></span><button class="btn ghost" data-a="lorebooks">Cancel</button><button class="btn p" data-a="lore-save">Save</button></div>
      <div class="srow"><label class="field">Name<input data-lf="name" value="${esc(b.name || '')}"></label><label class="field">Scan depth (messages)<input data-lf="scan_depth" type="number" min="1" max="100" value="${b.scan_depth || 4}"></label><label class="field">Token budget<input data-lf="token_budget" type="number" min="50" max="32000" value="${b.token_budget || 1024}"></label></div>
      <div class="lore-list">${(b.entries || []).map((e, i) => `<div class="lentry"><div class="srow"><input data-le="${i}" data-k="name" placeholder="Entry name" value="${esc(e.name || '')}"><input data-le="${i}" data-k="keys" class="grow" placeholder="Keywords, comma separated" value="${esc((e.keys || []).join(', '))}"><label class="day">Order<input data-le="${i}" data-k="insertion_order" type="number" value="${e.insertion_order ?? 100}"></label><label class="day"><input type="checkbox" data-le="${i}" data-k="constant" ${e.constant ? 'checked' : ''}>Always on</label><label class="day"><input type="checkbox" data-le="${i}" data-k="enabled" ${e.enabled !== false ? 'checked' : ''}>On</label><button class="mini" data-a="lore-del-entry" data-i="${i}">Delete</button></div><textarea data-le="${i}" data-k="content" rows="3" placeholder="What the characters know when a keyword comes up">${esc(e.content || '')}</textarea></div>`).join('') || '<div class="fine">No entries yet.</div>'}</div>
      <div class="mft left"><button class="btn" data-a="lore-add-entry">${icon('plus', 'sm')}Add entry</button></div></div>`;
  }
  return `<div class="lib"><div class="lib-hd"><button class="tb" data-a="characters">${icon('chevr', 'sm')}Characters</button><h1>Lorebooks</h1><span class="grow"></span><button class="btn" data-a="lore-import">${icon('dl', 'sm')}Import</button><button class="btn" data-a="lore-new">${icon('plus', 'sm')}Create</button></div>
    <p class="fine">World info: entries with keywords. When a keyword comes up in the last few messages, its entry is added to the characters' context (within the token budget); always-on entries are always added. Attach lorebooks to a character (its editor) or to a chat (when you start it).</p>
    ${(S.books || []).map((b) => `<div class="srow">${icon('doc', 'sm')}<b>${esc(b.name)}</b><span class="d">${(b.entries || []).length} entries · scan ${b.scan_depth} · budget ${b.token_budget}</span><span class="grow"></span><button class="mini" data-a="lore-edit" data-id="${esc(b.id)}">Edit</button><button class="mini" data-a="lore-export" data-id="${esc(b.id)}">Export</button><button class="mini" data-a="lore-remove" data-id="${esc(b.id)}">Delete</button></div>`).join('') || '<div class="fine">No lorebooks yet.</div>'}</div>`;
}
function vnStage(R, c) {
  const cards = rpCards(c);
  const last = [...R.msgs].reverse().find((m) => m.char) || null;
  const card = cardById(last?.char) || cards[0];
  const bgMedia = [...R.msgs].reverse().flatMap((m) => m.media || []).find((x) => x.kind === 'image' && /^scene-/.test(x.name || '')) || null;
  const bg = card?.backgroundUrl || bgMedia?.url || '';
  const sp = spriteFor(card, last?.text);
  const art = sp ? card.spriteUrls[sp] : card?.avatarUrl;
  return `<div class="vn" ${bg && SAFE_MEDIA.test(bg) ? `style="background-image:url('${esc(bg)}')"` : ''}>${art ? `<img class="vn-art" src="${esc(art)}" alt="${esc(card?.name || '')}">` : ''}
    <div class="vn-box">${last ? `<div class="vn-name">${esc(card?.name || '')}${sp ? ` <span class="faint">· ${esc(sp)}</span>` : ''}</div><div class="text">${rich(last.text)}</div>` : '<div class="text faint">The story starts with your first line.</div>'}${R.busy ? `<div class="faint">${esc(cardById(R.busy.char)?.name || aiName(R.busy.agent))} is writing<span class="dots"><i></i><i></i><i></i></span></div>` : ''}</div></div>`;
}
function rpMessage(m) {
  const c = entry();
  const card = cardById(m.char);
  const R = cur();
  const busy = R?.round || R?.waiting;
  const n = Array.isArray(m.swipes) ? m.swipes.length : 1;
  const isLast = [...S.msgs].reverse().find((x) => x.char)?.id === m.id;
  const swipe = (n > 1 || isLast) && !m.err ? `<span class="ver"><button class="ib sm ghost" data-a="rp-swipe" data-m="${esc(m.id)}" data-d="-1" ${(m.sw ?? 0) === 0 || busy ? 'disabled' : ''} aria-label="Previous reply">‹</button>${(m.sw ?? 0) + 1}/${n}<button class="ib sm ghost" data-a="rp-swipe" data-m="${esc(m.id)}" data-d="1" ${busy || ((m.sw ?? 0) >= n - 1 && (m.greeting || !isLast)) ? 'disabled' : ''} aria-label="Next reply">›</button></span>` : '';
  if (S.editing === m.id) return `<div class="msg-a rp editing" data-msg="${esc(m.id)}"><div class="who">${avatarHtml(card)}<b>${esc(card?.name || aiName(m.who))}</b></div><textarea id="edit-text" rows="4">${esc(m.text)}</textarea><div class="mft"><button class="btn ghost" data-a="edit-cancel">Cancel</button><button class="btn p" data-a="rp-edit-save" data-m="${esc(m.id)}">Save</button></div></div>`;
  return `<div class="msg-a rp ${m.err ? 'err' : ''}" data-msg="${esc(m.id)}"><div class="rp-row">${avatarHtml(card, 'lg')}<div class="rp-body">
    <div class="who"><b>${esc(card?.name || aiName(m.who))}</b><span class="faint">· played by ${esc(aiName(m.who))}${UNFILTERED.includes(m.who) ? ' · not shown to your other AIs' : ''}</span>${m.greeting ? '<span class="faint">· greeting</span>' : ''}</div>
    <div class="text">${rich(m.text)}</div>${mediaHtml(m)}
    <div class="mctl">${swipe}<button class="ib sm ghost" data-a="msg-copy" data-m="${esc(m.id)}" title="Copy">${icon('doc', 'sm')}</button><button class="ib sm ghost ${voice.isReading(m.id) ? 'rec' : ''}" data-a="msg-read" data-m="${esc(m.id)}" title="Read aloud${card?.voice ? ` (${esc(card.voice)})` : ''}">${icon(voice.isReading(m.id) ? 'stop' : 'mic', 'sm')}</button><button class="ib sm ghost" data-a="msg-edit" data-m="${esc(m.id)}" title="Edit" ${busy ? 'disabled' : ''}>${icon('pencil', 'sm')}</button>${isLast && !m.greeting ? `<button class="ib sm ghost" data-a="rp-swipe" data-m="${esc(m.id)}" data-d="99" title="Regenerate (a new swipe)" ${busy ? 'disabled' : ''}>${icon('refresh', 'sm')}</button><button class="ib sm ghost" data-a="rp-continue" data-m="${esc(m.id)}" title="Continue this reply" ${busy ? 'disabled' : ''}>${icon('chevr', 'sm')}</button>` : ''}</div></div></div></div>`;
}
function rpBar(c) {
  const cards = rpCards(c);
  return `<div class="rpbar">${cards.map((x) => `<button class="mini" data-a="rp-reply-as" data-id="${esc(x.id)}" title="${esc(x.name)} replies next (played by ${esc(aiName(playerOf(c, x.id)))})">${avatarHtml(x, 'xs')}${esc(x.name)}</button>`).join('')}<span class="grow"></span><button class="mini" data-a="rp-impersonate" title="The AI writes your next line as a draft">${icon('pencil', 'sm')}Impersonate</button><button class="mini" data-a="rp-picture">${icon('eye', 'sm')}Picture</button><button class="mini" data-a="rp-scene" title="A ComfyUI picture of this moment: you see and can edit the prompt first">${icon('eye', 'sm')}Generate scene</button><button class="mini ${cur()?.vn ? 'on' : ''}" data-a="rp-vn">${icon('panel', 'sm')}Visual novel</button></div>`;
}

// ---------- the preview panel and canvas ----------
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
  const tab = (t, label) => `<button class="${S.pane.tab === t ? 'on' : ''}" data-a="pane-tab" data-t="${t}">${label}</button>`;
  const body = p.file ? (S.pane.url ? frameHtml({ url: S.pane.url, title: p.name }) : '<div class="pfoot">Loading…</div>') : S.pane.tab === 'code' ? `<pre class="code-view"><code>${esc(p.content)}</code></pre>`
    : S.pane.tab === 'canvas' ? `<div class="canvas-wrap"><textarea id="canvas-text" class="canvas" spellcheck="false" aria-label="Canvas">${esc(p.content)}</textarea></div>`
      : frameHtml({ url: S.pane.url, srcdoc: S.pane.url ? null : S.pane.srcdoc, title: p.name });
  el.innerHTML = `<div class="ph2"><b>${esc(p.name)}</b><div class="tabs">${p.kind !== 'code' ? tab('preview', 'Preview') : ''}${p.file ? '' : `${tab('code', 'Code')}${tab('canvas', 'Canvas')}`}</div><span class="grow"></span><button class="tb" data-a="pane-reload" title="Reload">${icon('refresh', 'sm')}</button><button class="tb" data-a="pane-close" title="Close">${icon('x', 'sm')}</button></div>
    <div class="frame-wrap">${body}</div>
    ${S.pane.tab === 'canvas' ? `<div class="canvas-bar"><button class="btn" data-a="canvas-save">${icon('check', 'sm')}Save version</button><button class="btn p" data-a="canvas-ask">${icon('users', 'sm')}Ask the team to change it</button><button class="btn ghost" data-a="download-preview" data-m="${esc(S.pane.msgId)}" data-p="${esc(S.pane.pid)}">${icon('dl', 'sm')}Download</button><span class="fine">${p.versions?.length ? `${p.versions.length} earlier version${p.versions.length === 1 ? '' : 's'} kept` : 'Your edits stay in this chat'}</span></div>` : ''}
    <div class="pfoot">${S.settings.previewNetwork ? 'Previews may load from the internet (Settings › Tools).' : 'Sandboxed: no internet, no access to the app or your files.'}</div>`;
}

// ---------- popovers, modals, toast ----------
function renderOverlay() {
  let html = '';
  if (S.pop) html += popHtml();
  if (S.modal) html += modalHtml();
  if (voice.isOpen()) html += voice.viewHtml();
  if (S.deskAsks?.length) html += deskAsksHtml();
  if (S.toast) html += `<div class="toast">${esc(S.toast.text)}${S.toast.undo ? `<button class="mini" data-a="undo">${icon('undo', 'sm')}Undo</button>` : ''}</div>`;
  setRegion('overlay', html);
  if (S.pop?.kind === 'repo') { const el = document.getElementById('repo-q'); if (el && document.activeElement !== el && !S.pop.noFocus) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
}

// Agent Desktop asking to act (electron/desktop.cjs): one card per ask, newest on top.
function deskAsksHtml() {
  return `<div class="desk-asks" role="alertdialog" aria-label="Your AI wants to use this desktop">${S.deskAsks.slice().reverse().map((a) => `<div class="box desk-ask"><b>${icon('cpu', 'sm')}${esc(entry(a.chat)?.title ? `In “${entry(a.chat).title}”` : 'Your AI')} wants to <span class="mono">${esc(a.tool)}</span>${a.detail ? `: “${esc(a.detail)}”` : ''}</b><div class="fine mono">${esc(a.args)}</div><div class="srow"><button class="btn p" data-a="desk-ans" data-id="${esc(a.id)}" data-v="once">Allow</button><button class="btn" data-a="desk-ans" data-id="${esc(a.id)}" data-v="ten">Allow for 10 minutes in this chat</button><button class="btn ghost" data-a="desk-ans" data-id="${esc(a.id)}" data-v="no">Don't allow</button></div></div>`).join('')}</div>`;
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
      ${it('knowledge', 'doc', 'Instructions and reference files…')}${it('export', 'dl', 'Export (Markdown, HTML, PDF)…')}
      ${c.hasCopy ? it('close', 'x', 'Close (remove its temporary copy)') : ''}
      ${it('hide', 'eyeoff', 'Hide')}<div class="sep"></div>${it('delete', 'trash', 'Delete')}</div>`;
  }
  if (p.kind === 'team') {
    const t = team();
    const opt = (v, label, sub) => `<button class="it ${S.mode === v ? 'on' : ''}" data-a="set-mode" data-v="${v}">${label}<small>${sub}</small></button>`;
    return `<div class="scrim" data-a="close-pop"></div><div class="pop" style="${p.top ? 'right:20px;top:52px' : `left:${p.x}px;bottom:${p.b}px`}"><div class="mh">Who answers</div>
      ${opt('team', `${icon('users', 'sm')}Whole team`, `${esc(aiName(t.lead))} ★ leads`)}
      ${t.members.map((a) => opt(a, `${mono(a, 'sm')}${esc(aiName(a))}`, ready(a) ? (a === t.lead ? 'lead · connected' : a === t.reviewer ? 'reviewer · connected' : 'connected') : `${statusOf(a).label}${statusOf(a).why ? ` · ${statusOf(a).why}` : ''}`)).join('')}
      <div class="note">Or type @name in your message to ask one AI (several names on one line reach them all). Change who's in the team in Settings › AI team.</div>
      <button class="it" data-a="team-test-go">${icon('check', 'sm')}Test team<small>a safe test of each connected teammate (Settings › AI team)</small></button></div>`;
  }
  if (p.kind === 'options') {
    const R = S.view === 'chat' ? cur() : null;
    const models = R ? (R.sessions._models || {}) : S.homeModels;
    const t = team();
    const opts = (a) => [...new Set([...(MODEL_PRESETS[a] || []), ...(a === 'venice' ? S.mates.models?.venice || [] : [])])];
    return `<div class="scrim" data-a="close-pop"></div><div class="pop opts" style="left:${p.x}px;${p.b != null ? `bottom:${p.b}px` : `top:${p.y}px`}">
      <div class="mh">For this message</div>
      <button class="it" data-a="toggle-deep">${icon('globe', 'sm')}Deep research<small>${S.deep ? 'on' : 'off'} · a long report with sources</small></button>
      <button class="it" data-a="toggle-talk">${icon('wave', 'sm')}Talk<small>${voice.isOpen() ? 'on' : 'off'} · voice chat: say it, hear the answers</small></button>
      <div class="sep"></div><div class="mh">Model per AI ${R ? '(this chat)' : '(the next chat)'}</div>
      ${t.members.filter((a) => !AGENTS[a]?.imagesOnly).map((a) => `<div class="it static">${mono(a, 'sm')}${esc(aiName(a))}<select data-a="pick-model" data-v="${a}"><option value="default">default</option>${opts(a).map((o) => `<option ${models[a] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}${models[a] && models[a] !== 'default' && !opts(a).includes(models[a]) ? `<option selected>${esc(models[a])}</option>` : ''}</select></div>`).join('')}
      <div class="note">Default uses each AI's own setting. Models are kept with the chat, not in your settings.</div></div>`;
  }
  if (p.kind === 'repo') {
    const q = S.repoQuery.toLowerCase();
    const repos = (S.repos || []).filter((r) => !q || r.full.toLowerCase().includes(q)).slice(0, 8);
    const c = p.chatId ? entry(p.chatId) : S.view === 'chat' ? entry() : null;
    const curRepo = c ? c.repo : S.conn?.repo;
    const sel = S.pickRepo || curRepo || repos[0]?.full || null;
    const br = sel ? S.branches[sel] : null;
    const curBranch = S.pickBranch || (sel === curRepo ? (c ? c.branch : S.conn?.branch) : null) || br?.default || 'main';
    return `<div class="scrim" data-a="close-pop"></div><div class="pop repo-pop" style="left:${p.x ?? 620}px;${p.b != null ? `bottom:${p.b}px` : `top:${p.y ?? 330}px`};${p.maxH ? `max-height:${p.maxH}px` : ''}"><div class="mh">Connect this chat to a GitHub repo</div>
      <label class="search in">${icon('search', 'sm')}<input id="repo-q" placeholder="Search your repos" value="${esc(S.repoQuery)}"></label>
      ${S.reposMsg ? `<div class="note">${esc(S.reposMsg)}</div>` : ''}
      ${repos.map((r) => `<button class="it ${r.full === sel ? 'on' : ''}" data-a="pick-repo" data-r="${esc(r.full)}">${icon('gh', 'sm')}${esc(r.full)}<small>${r.private ? 'private' : 'public'}${r.pushedAt ? ` · ${esc(ago(r.pushedAt))}` : ''}</small></button>`).join('')}
      <div class="sep"></div>
      <div class="it static">${icon('branch', 'sm')}Branch<select id="branch-sel" ${sel ? '' : 'disabled'}>${(br?.branches?.length ? br.branches : [curBranch]).map((b) => `<option ${b === curBranch ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></div>
      <button class="it" data-a="connect-repo" ${sel ? '' : 'disabled'}>${icon('check', 'sm')}${sel ? `Use ${esc(sel.split('/').pop())}` : 'Pick a repo'}</button>
      <button class="it" data-a="no-repo">${icon('x', 'sm')}No repo, just talk</button>
      <div class="note">The team works in a small temporary copy on this PC (newest commit only) and pushes to the chat's own branch; builds and tests run in GitHub Actions. The copy is deleted when you close the chat or it sits idle. The same repo in two chats gets two separate copies and branches.</div></div>`;
  }
  return '';
}

function modalHtml() {
  const m = S.modal;
  if (m.kind === 'humanize') {
    const list = humanizeTargets(m.from);
    return `<div class="scrim dark" data-a="close-modal"></div><div class="modal wide"><div class="mhd"><b>Make it sound human</b><span class="grow"></span><button class="tb" data-a="close-modal">${icon('x', 'sm')}</button></div>
      <p class="fine">Rewrites ${m.source === 'draft' ? 'your draft' : 'this reply'} so it reads less like AI, with Humanizer's rules (github.com/blader/humanizer, MIT). The facts stay the same.</p>
      ${list.length ? `<div class="srow">Rewrite with<select id="hz-agent" aria-label="AI that rewrites it">${list.map((a) => `<option value="${esc(a)}" ${a === m.agent ? 'selected' : ''}>${esc(aiName(a))}</option>`).join('')}</select><button class="btn p" data-a="humanize-run" ${m.busy ? 'disabled' : ''}>${m.busy ? 'Rewriting…' : m.out ? 'Again' : 'Rewrite'}</button></div>` : `<p class="bad">No AI that answers by API is set up yet. Add Free AI or your GPU server in Settings › Accounts${UNFILTERED.includes(m.from) ? ' (an uncensored teammate\'s reply is only rewritten by Venice, your GPU server or Hearth devices)' : ''}.</p>`}
      ${m.err ? `<p class="bad">${esc(m.err)}</p>` : ''}
      ${m.out ? `<textarea id="hz-out" rows="12" class="grow" aria-label="Rewritten text">${esc(m.out)}</textarea><p class="faint">${esc(m.via || '')}</p>
      <div class="mft"><button class="btn" data-a="humanize-copy">${icon('doc', 'sm')}Copy</button><button class="btn p" data-a="humanize-use">${m.source === 'draft' ? 'Use it as my draft' : 'Put it in my message box'}</button><button class="btn ghost" data-a="close-modal">Close</button></div>` : ''}</div>`;
  }
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
  if (m.kind === 'saveto' || m.kind === 'mediarepo') {
    return `<div class="scrim dark" data-a="close-modal"></div><div class="modal"><div class="mhd"><b>Save ${m.kind === 'mediarepo' ? esc(m.name) : 'the preview'} to the repo</b></div>
      <p>It's saved in this chat's temporary copy and committed as you, on the chat's branch. Push or open a pull request to put it on GitHub.</p>
      <label class="field">Path in the repo<input id="saveto-path" value="${esc(m.path)}"></label>
      <div class="mft"><button class="btn p" data-a="saveto-do">Save</button><button class="btn ghost" data-a="close-modal">Cancel</button></div></div>`;
  }
  if (m.kind === 'gallery') return galleryViewer(m, icon);
  if (m.kind === 'lightbox') {
    return `<div class="scrim dark lb" data-a="close-modal"></div><div class="lightbox"><img src="${esc(m.src)}" alt="${esc(m.name || '')}"><div class="lb-bar"><span>${esc(m.name || '')}</span><span class="grow"></span>${m.file ? `<button class="btn" data-a="media-save" data-f="${esc(m.file)}" data-n="${esc(m.name)}">${icon('dl', 'sm')}Download</button><button class="btn" data-a="media-repo" data-f="${esc(m.file)}" data-n="${esc(m.name)}">${icon('gh', 'sm')}Save to repo…</button>` : ''}<button class="btn ghost" data-a="close-modal">${icon('x', 'sm')}Close</button></div></div>`;
  }
  if (m.kind === 'export') {
    return `<div class="scrim dark" data-a="close-modal"></div><div class="modal"><div class="mhd"><b>Export “${esc(entry(m.chatId)?.title || 'chat')}”</b></div>
      <p>Pictures are included (next to a Markdown file, inside the HTML and PDF). Nothing is uploaded anywhere.</p>
      <div class="mft"><button class="btn" data-a="export-do" data-f="md">Markdown</button><button class="btn" data-a="export-do" data-f="html">HTML</button><button class="btn p" data-a="export-do" data-f="pdf">PDF</button><button class="btn ghost" data-a="close-modal">Cancel</button></div></div>`;
  }
  if (m.kind === 'knowledge') {
    return `<div class="scrim dark" data-a="close-modal"></div><div class="modal"><div class="mhd"><b>Instructions and reference files</b><span class="grow"></span><span class="faint">${esc(entry(m.chatId)?.title || '')}</span></div>
      <p>Like a Project in the Claude app: every AI in this chat gets these instructions, and the files are attached to every turn.</p>
      <label class="field">Instructions for this chat<textarea id="know-text" rows="5" maxlength="4000" placeholder="For example: answer in short bullet points; this repo uses tabs.">${esc(m.instructions)}</textarea></label>
      <div class="field">Reference files<div class="refs">${m.refs.map((r, i) => `<span class="att-f">${icon('doc', 'sm')}${esc(r.name)}<button class="ib sm ghost" data-a="know-unref" data-i="${i}" aria-label="Remove">${icon('x', 'sm')}</button></span>`).join('') || '<span class="faint">None yet.</span>'}<button class="mini" data-a="know-add">${icon('plus', 'sm')}Add files</button></div></div>
      <div class="mft"><button class="btn p" data-a="know-save">Save</button><button class="btn ghost" data-a="close-modal">Cancel</button></div></div>`;
  }
  if (m.kind === 'rpstart') {
    const L = TEAM_IDS.filter(ready).filter((a) => !AGENTS[a]?.imagesOnly);
    return `<div class="scrim dark" data-a="close-modal"></div><div class="modal"><div class="mhd"><b>Start a roleplay chat</b></div>
      <p>Pick the characters (several make a group) and who plays each one. Venice plays adult scenes; the others play regular stories.</p>
      <div class="rp-pick">${(S.cards || []).map((c) => { const on = m.chars.includes(c.id); return `<div class="srow"><label class="day"><input type="checkbox" data-a="rp-toggle" data-id="${esc(c.id)}" ${on ? 'checked' : ''}>${avatarHtml(c, 'xs')}<b>${esc(c.name)}</b></label>${limitBadge(c)}<span class="grow"></span>${on ? `played by <select data-a="rp-player" data-id="${esc(c.id)}">${L.map((a) => `<option value="${a}" ${m.players[c.id] === a ? 'selected' : ''} ${c.limits?.minor && UNFILTERED.includes(a) ? 'disabled' : ''}>${esc(aiName(a))}${c.limits?.minor && UNFILTERED.includes(a) ? ' (not for this card)' : ''}</option>`).join('')}</select>` : ''}</div>`; }).join('') || '<div class="fine">No characters yet.</div>'}</div>
      ${m.chars.length > 1 ? `<div class="srow">Turn order<select data-a="rp-order"><option value="natural" ${m.order !== 'list' ? 'selected' : ''}>Natural (whoever is named, else the next one)</option><option value="list" ${m.order === 'list' ? 'selected' : ''}>In order (everyone, each turn)</option></select></div>` : ''}
      ${(S.books || []).length ? `<div class="srow">Lorebooks for this chat${(S.books || []).map((b) => `<label class="day"><input type="checkbox" data-a="rp-lore" data-id="${esc(b.id)}" ${m.lorebooks.includes(b.id) ? 'checked' : ''}>${esc(b.name)}</label>`).join('')}</div>` : ''}
      ${L.length ? '' : '<div class="note bad">No AI is set up to play a character yet (Settings › Accounts).</div>'}
      <div class="mft"><button class="btn p" data-a="rp-start-do" ${m.chars.length && L.length ? '' : 'disabled'}>Start</button><button class="btn ghost" data-a="close-modal">Cancel</button></div></div>`;
  }
  if (m.kind === 'rpscene') {
    const c = entry(m.chatId);
    const all = rpCards(c);
    const sel = all.filter((x) => m.ids.includes(x.id));
    const lookRow = (x) => { const L = x.ownerLook || {}; return `<div class="srow sub rs-look"><b>${esc(x.name)}</b><textarea id="rs-look-${esc(x.id)}" rows="2" style="flex:1;min-width:16em" placeholder="Appearance: hair, eyes, clothes… (helps keep the look similar; the scene still changes it)" aria-label="${esc(x.name)}'s appearance">${esc(L.appearance || '')}</textarea><label class="day"><input type="checkbox" id="rs-keep-${esc(x.id)}" ${L.keepSeed !== false ? 'checked' : ''}>Keep the same seed</label><span class="d">${Number.isInteger(L.seed) ? `saved seed ${L.seed}` : 'no saved seed'}</span><button class="mini" data-a="rs-look-save" data-id="${esc(x.id)}">Save look</button><button class="mini" data-a="rs-reroll" data-id="${esc(x.id)}">Re-roll seed</button></div>${(L.appearance || '').trim() ? '' : `<div class="fine rs-hint" id="rs-hint-${esc(x.id)}">${icon('eye', 'sm')} Add ${pronounOf(x)} look in Appearance for better pictures (the box above, then Save look). Without it, only the looks in ${esc(x.name)}'s card text are used.</div>`}`; };
    const st = m.settings || {};
    const fromComfy = m.source === 'comfy' || (m.source || '').startsWith('gpu:');
    return `<div class="scrim dark" data-a="close-modal"></div><div class="modal wide"><div class="mhd"><b>Generate scene</b></div>
      <p>A ComfyUI picture of this moment, built from the characters and the last messages. Check or change the prompts, then generate. The built-in limits are checked before anything is sent: nothing sexual unless every character is clearly an adult (never anyone who looks under 18), and never a real person's likeness.</p>
      <div class="srow">Characters${all.map((x) => `<label class="day"><input type="checkbox" class="rsc" value="${esc(x.id)}" ${m.ids.includes(x.id) ? 'checked' : ''} data-a="rs-chars">${esc(x.name)}</label>`).join('')}</div>
      ${sel.map(lookRow).join('')}
      ${sel.length ? '<p class="fine">A saved appearance and seed help keep a character looking similar between pictures, but each new scene still changes the picture, so the look won\'t be exactly the same every time.</p>' : ''}
      <label class="field">Prompt<textarea id="rs-prompt" rows="6">${esc(m.prompt || '')}</textarea></label>
      <label class="field">Negative prompt <span class="d">(your words, added after the built-in ones)</span><textarea id="rs-neg" rows="2" placeholder="What to leave out, like: hats, rain">${esc(m.negative || '')}</textarea></label>
      ${m.negativeBase ? `<div class="fine">Always left out: <span class="mono">${esc(m.negativeBase)}</span></div>` : ''}
      <div class="srow"><button class="mini" data-a="rs-rebuild">Rebuild from the chat</button><span class="grow"></span>Seed<input id="rs-seed" class="mono" value="${esc(String(m.seed ?? ''))}" inputmode="numeric" aria-label="Seed" style="width:9em"><span class="d">${m.seedSaved ? 'the saved seed' : 'not saved (Save look keeps it)'}</span></div>
      <div class="srow">Made on<select id="rs-src" data-a="rs-src">${(m.sources || []).map((x) => `<option value="${esc(x.id)}" ${m.source === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      ${st.width ? `<div class="fine" id="rs-settings">${st.width} × ${st.height} · ${st.steps} steps · CFG ${st.cfg} · ${esc(st.sampler)} / ${esc(st.scheduler)}${m.source === 'comfy' ? ` · ${esc(st.checkpoint || 'suggested model')}` : ''} <span class="faint">(change these in Settings › Accounts › ComfyUI server)</span></div>` : ''}
      ${fromComfy && m.vram?.note ? `<div class="note warn" id="rs-vram">${esc(m.vram.note)}</div>` : fromComfy && m.vram?.ok ? `<div class="fine" id="rs-vram">${esc(vramLine(m.vram))}</div>` : ''}
      ${(m.sources || []).length ? '' : '<div class="note bad">No ComfyUI is set up. Add your ComfyUI server (or Hearth devices) in Settings › Accounts.</div>'}
      ${m.error ? `<div class="note bad">${esc(m.error)}</div>` : ''}
      <div class="mft"><button class="btn p" data-a="rs-go" ${(m.sources || []).length ? '' : 'disabled'}>Generate</button><button class="btn ghost" data-a="close-modal">Cancel</button></div></div>`;
  }
  if (m.kind === 'rppic') {
    const c = entry(m.chatId);
    const makers = IMAGE_MAKERS.filter((a) => (TEAMMATE_IDS.includes(a) ? S.mates.ready?.[a] : S.mkeys.keys?.[a]));
    return `<div class="scrim dark" data-a="close-modal"></div><div class="modal"><div class="mhd"><b>A picture for this story</b></div>
      <p>Made from the characters' descriptions. The built-in limits are checked before anything is sent.</p>
      <div class="srow"><label class="day"><input type="radio" name="rpk" value="portrait" ${m.kind2 !== 'scene' ? 'checked' : ''}>Character portrait</label><label class="day"><input type="radio" name="rpk" value="scene" ${m.kind2 === 'scene' ? 'checked' : ''}>Scene</label></div>
      <div class="srow">Characters${rpCards(c).map((x) => `<label class="day"><input type="checkbox" class="rpc" value="${esc(x.id)}" checked>${esc(x.name)}</label>`).join('')}</div>
      <label class="field">Anything to add<input id="rp-note" placeholder="For example: by the campfire at night"></label>
      <div class="srow">Made by<select id="rp-maker">${makers.map((a) => `<option value="${a}">${esc(aiName(a))}</option>`).join('')}</select></div>
      ${makers.length ? '' : '<div class="note bad">No picture maker is set up (Settings › Accounts: Venice, Civitai, your GPU server, or an OpenAI/Gemini/xAI key).</div>'}
      <div class="mft"><button class="btn p" data-a="rp-pic-do" ${makers.length ? '' : 'disabled'}>Make it</button><button class="btn ghost" data-a="close-modal">Cancel</button></div></div>`;
  }
  if (m.kind === 'persona') {
    return `<div class="scrim dark" data-a="close-modal"></div><div class="modal"><div class="mhd"><b>Your persona</b></div>
      <p>Who you are in roleplay chats. Characters see this name and description.</p>
      <label class="field">Name<input id="pe-name" value="${esc(m.name || '')}" maxlength="80"></label>
      <label class="field">Description<textarea id="pe-desc" rows="4">${esc(m.description || '')}</textarea></label>
      <div class="srow">${m.avatarUrl ? `<img class="cav" src="${esc(m.avatarUrl)}" alt="">` : ''}<button class="mini" data-a="persona-pic">Choose a picture</button></div>
      <div class="mft"><button class="btn p" data-a="persona-save">Save</button><button class="btn ghost" data-a="close-modal">Cancel</button></div></div>`;
  }
  if (m.kind === 'find') {
    const F = S.findSites || { sites: [], notListed: [] };
    return `<div class="scrim dark" data-a="close-modal"></div><div class="modal" id="find-chars"><div class="mhd"><b>${icon('search', 'sm')} Find characters</b><span class="grow"></span><button class="tb" data-a="close-modal">${icon('x', 'sm')}</button></div>
      <p class="fine">Opens the site in a separate, sandboxed window with its own browser profile: it can't reach the app, your files or your keys. Search and browse there; when you download a card (PNG, JSON or CHARX, up to ${F.maxMb || 20} MB) it is imported here straight away, picture included. Other downloads are ignored, and nothing from the site is ever run.</p>
      ${F.sites.map((x) => `<div class="srow">${icon('globe', 'sm')}<b>${esc(x.name)}</b><span class="d">${esc(x.note)} · ${esc(x.url.replace(/^https:\/\//, '').replace(/\/$/, ''))}</span><span class="grow"></span><button class="btn" data-a="find-open" data-v="${esc(x.id)}">Open</button></div>`).join('')}
      ${F.notListed?.length ? `<div class="note">${esc(F.notListed.join(' and '))} aren't listed yet: their official addresses couldn't be confirmed, and a guessed one could be someone else's site. Some sites have their own age check.</div>` : ''}
      <div class="note">Cards that read as under 18 still import, and are always blocked from anything sexual. There's no search box here: none of these sites offers an official search API for other apps.</div></div>`;
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
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function whenText(t) {
  if (t.kind === 'once') return `once, ${new Date(t.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  if (t.kind === 'daily') return `every day at ${t.time}`;
  if (t.kind === 'weekly') return `every ${(t.days || []).map((d) => WEEK[d]).join(', ')} at ${t.time}`;
  return `cron ${t.cron}`;
}
function section(k) {
  const s = S.settings;
  const t = team();
  if (k === 'team') {
    return `<h1>AI team</h1><div class="box"><h3>Who's in your chats</h3>
      ${TEAM_IDS.map((a) => { const inTeam = t.members.includes(a); const r = ready(a); return `<div class="srow mem">${mono(a)}<b>${esc(aiName(a))}</b><span class="d">${a === t.lead ? 'lead ★ · ' : a === t.reviewer ? 'reviewer · ' : ''}${esc(AGENTS[a].tool)}${r ? `, ${esc(AGENTS[a].plan)} · connected` : inTeam ? ` · ${esc(statusOf(a).label)}${statusOf(a).why ? `: ${esc(statusOf(a).why)}` : ''}` : ''}${inTeam ? '' : ' · off'}</span><span class="grow"></span>${inTeam && a !== t.lead && AGENTS[a].edits ? `<button class="mini" data-a="make-lead" data-v="${a}">Make lead</button>` : ''}${inTeam && a !== t.lead && a !== t.reviewer && !UNFILTERED.includes(a) ? `<button class="mini" data-a="make-reviewer" data-v="${a}">Make reviewer</button>` : ''}${tog(inTeam, 'team-member', `data-v="${a}" ${a === t.lead ? 'disabled title="The lead is always in"' : ''}`)}</div>`; }).join('')}
      <div class="note">The lead (Claude unless you change it) answers first and hands parts to teammates. When the lead changes files, the reviewer checks the diff. Type @name in a message to ask one AI. ${t.reviewer ? '' : 'No reviewer is set.'} Venice, Civitai and your GPU server never see the other AIs' private context and what they make is never passed to Claude, ChatGPT or Gemini.</div>
      ${t.reviewer ? '<button class="mini" data-a="no-reviewer">No reviewer</button>' : ''}</div>
      ${teamTestBox()}`;
  }
  if (k === 'accounts') {
    const M = S.mates;
    const c = M.conf || {};
    return `<h1>Accounts</h1>${keyringNote()}<div class="box"><h3>Your AI accounts</h3><p class="fine">Each AI signs in with your own account in its own official app. The Command Center never holds your passwords.</p>
      ${TEAM_IDS.filter((a) => !TEAMMATE_IDS.includes(a)).map((a) => { const cl = S.cli[a] || {}; const isApi = method(a) === 'api'; const st = isApi ? (S.prov.keys?.[a] ? 'API key saved' : 'needs an API key') : !cl.installed ? 'not installed' : cl.signedIn === false ? 'not signed in' : cl.signedIn ? 'signed in' : 'installed'; return `<div class="srow">${mono(a)}<b>${esc(aiName(a))}</b><span class="d">${esc(AGENTS[a].tool)} · ${esc(st)}</span><span class="grow"></span>${isApi ? `<button class="mini" data-a="set-key" data-v="${a}">${S.prov.keys?.[a] ? 'Change key' : 'Add key'}</button>` : !cl.installed && a !== 'ollama' ? `<button class="mini" data-a="install" data-v="${a}">Install</button>` : cl.signedIn === false ? `<button class="mini" data-a="signin" data-v="${a}">Sign in</button>` : ''}<button class="mini" data-a="recheck" data-v="${a}">Re-check</button></div>`; }).join('')}</div>
      <div class="box"><h3>${icon('eye', 'sm')}Pictures, videos and documents</h3><p class="fine">The AIs' own picture and video tools through their official APIs, with your own keys (saved encrypted on this PC). Each use is billed to that account.</p>
      ${MEDIA_KEYS.map(([k2, label, what]) => `<div class="srow"><b>${esc(label)}</b><span class="d">${esc(what)} · ${S.mkeys.keys?.[k2] ? 'saved' : 'not added'}</span><span class="grow"></span><button class="mini" data-a="media-key" data-v="${k2}">${S.mkeys.keys?.[k2] ? 'Change' : 'Add key'}</button>${S.mkeys.keys?.[k2] ? `<button class="mini" data-a="media-unkey" data-v="${k2}">Remove</button>` : ''}</div>`).join('')}
      <div class="srow">On this PC<span class="d">web page screenshots: ${S.mkeys.screenshot ? 'yes (headless browser found)' : 'no Chromium or Chrome found'} · reading aloud: ${esc(S.mkeys.tts || 'Web Speech, or install espeak-ng')} · PDF text: ${S.mkeys.pdftotext ? 'pdftotext' : 'install poppler-utils, or add a Mistral key'}</span></div></div>
      <div class="box"><h3>${icon('users', 'sm')}More teammates</h3><p class="fine">Each one joins your team (Settings › AI team) once you add its key or address. Keys stay in the encrypted store. They are told the same hard limits: never sexual content involving minors, never sexual images of real, identifiable people, nothing illegal. What they make is shown to you but never forwarded to Claude, ChatGPT or Gemini.</p>
      <div class="srow">${mono('free')}<b>Free AI</b><span class="d">free tiers of several providers with your own free keys: when one runs out, the next one answers · ${M.free?.ready ? `${(M.free.providers || []).filter((p) => p.key).length} added` : 'Add at least one free key'}</span></div>
      ${(M.free?.providers || []).map((p) => `<div class="srow sub"><b>${esc(p.name)}</b><span class="d">${p.key ? `key saved${p.model ? ` · ${esc(p.model)}` : ''}${p.resting ? ' · at its free limit, resting' : ''}` : 'no key yet'}</span><span class="grow"></span>${p.key ? '' : `<a class="mini" href="${esc(p.keys)}" target="_blank" rel="noopener">Get a key</a>`}<button class="mini" data-a="mate-key" data-v="free.${esc(p.id)}">${p.key ? 'Change key' : 'Add key'}</button>${p.key ? `<button class="mini" data-a="mate-unkey" data-v="free.${esc(p.id)}">Remove</button>` : ''}</div>`).join('')}
      <div class="note sub">Tried in this order; the reply says which one answered. Stay inside each provider's terms: one account each, for your own use. Based on FreeLLMAPI (github.com/tashfeenahmed/freellmapi, MIT).</div>
      <div class="srow">${mono('venice')}<b>Venice</b><span class="d">uncensored chat and pictures · ${M.keys?.venice ? 'key saved' : 'Add your Venice key'}</span><span class="grow"></span><button class="mini" data-a="mate-key" data-v="venice">${M.keys?.venice ? 'Change key' : 'Add key'}</button>${M.keys?.venice ? '<button class="mini" data-a="mate-unkey" data-v="venice">Remove</button>' : ''}</div>
      <div class="srow sub">Text model<select data-a="venice-model">${(M.models?.venice || []).map((x) => `<option ${c.venice?.model === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>Picture model<select data-a="venice-image">${(M.models?.veniceImage || []).map((x) => `<option ${c.venice?.imageModel === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select><span class="d">pictures use safe_mode off (Venice's default blurs adult pictures)</span></div>
      <div class="srow">${mono('civitai')}<b>Civitai</b><span class="d">pictures (billed in Buzz) · mature content allowed · ${M.keys?.civitai ? 'token saved' : 'Add your Civitai key'}</span><span class="grow"></span><button class="mini" data-a="mate-key" data-v="civitai">${M.keys?.civitai ? 'Change token' : 'Add token'}</button>${M.keys?.civitai ? '<button class="mini" data-a="mate-unkey" data-v="civitai">Remove</button>' : ''}</div>
      <div class="srow sub">Engine<select data-a="civitai-engine">${(M.models?.civitaiEngines || []).map((x) => `<option ${c.civitai?.engine === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select><input id="civitai-fields" class="mono grow" value="${esc(c.civitai?.fields || '{"prompt": "{prompt}"}')}" aria-label="Civitai request fields"><button class="mini" data-a="civitai-fields">Save fields</button><span class="d">the engine's own fields as JSON; {prompt} is filled in (check Civitai's docs for your engine)</span></div>
      <div class="srow">${mono('gpu')}<b>Your GPU servers</b><span class="d">RunPod or any rented or local GPU: an OpenAI-compatible chat URL, or a ComfyUI image API · ${M.servers?.length ? `${M.servers.length} added` : 'Add your GPU server'}</span></div>
      ${(M.servers || []).map((sv) => `<div class="srow sub">${icon('cpu', 'sm')}<b>${esc(sv.name)}</b><span class="d mono">${esc(sv.type === 'comfy' ? 'ComfyUI' : 'OpenAI-compatible')} · ${esc(sv.url)}${sv.key ? ' · key saved' : ''}${sv.workflow ? ' · own workflow' : ''}</span><span class="grow"></span>${svModelPick(sv)}<button class="mini" data-a="server-models" data-id="${esc(sv.id)}" title="Look for the models on this server again">Refresh</button><button class="mini" data-a="server-remove" data-id="${esc(sv.id)}">Remove</button></div>`).join('')}
      <div class="srow sub form"><input id="sv-name" placeholder="Name (e.g. RunPod 4090)"><select id="sv-type"><option value="openai">OpenAI-compatible chat</option><option value="comfy">ComfyUI pictures</option></select><input id="sv-url" class="grow" placeholder="https://…/v1 or http://192.168.1.20:8188">${svAddModelPick()}<input id="sv-key" type="password" placeholder="Key (optional)"><button class="mini" data-a="server-add">Add server</button></div>
      <details class="sub"><summary class="fine">ComfyUI workflow (optional): paste your own workflow JSON; {prompt}, {negative}, {seed} and {ckpt} are filled in. Empty uses a stock SDXL text-to-image graph.</summary><textarea id="sv-workflow" rows="4" class="mono" placeholder='{"3": {"class_type": "KSampler", …}}'></textarea></details>
      <div class="note">NovelAI isn't offered: it has no public developer API, and its terms restrict third-party apps.</div></div>
      ${hearthBox()}
      ${comfyBox()}
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
      <div class="srow">Web<span class="d">search the web and read pages; answers list their sources</span><span class="grow"></span>${tog(s.tools?.web !== false, 'tool-web')}</div>
      <div class="srow">Run &amp; build<span class="d">run quick checks on this PC and push to the chat's branch; heavy builds run in GitHub Actions</span><span class="grow"></span>${tog(s.tools?.build !== false, 'tool-build')}</div></div>
      <div class="box"><h3>Quick checks the AIs may run on this PC</h3><p class="fine">One per line: the start of a command. Claude can run only these (plus git and reading files); everything heavier goes to GitHub Actions.</p>
      <textarea id="quick-checks" rows="8" class="mono">${esc(qc.join('\n'))}</textarea><div class="mft left"><button class="btn" data-a="save-checks">Save</button></div>
      ${missingBox()}</div>
      <div class="box"><h3>${icon('star', 'sm')}Skills</h3><p class="fine">Claude Code skills from ~/.claude/skills and the chat's repo (.claude/skills) work in chats: Claude uses them by itself when they fit. The lead can also hand side tasks to helpers that work in parallel.</p>
      ${S.skills === null ? '<div class="fine">Loading…</div>' : (S.skills || []).map((x) => `<div class="srow">${icon('star', 'sm')}<b>${esc(x.name)}</b><span class="d">${esc(x.description || '')} · ${esc(x.where)}</span></div>`).join('') || '<div class="fine">No skills installed. Put a skill folder with a SKILL.md in ~/.claude/skills, or in a repo\'s .claude/skills.</div>'}</div>
      <div class="box"><h3>Live previews</h3><div class="srow">Previews may load from the internet<span class="d">off: previews can't reach the network (safest)</span><span class="grow"></span>${tog(s.previewNetwork === true, 'preview-net')}</div></div>`;
  }
  if (k === 'memory') {
    const mem = S.memory;
    const ci = s.customInstructions || {};
    return `<h1>Memory</h1>
      <div class="box"><h3>${icon('user', 'sm')}Custom instructions</h3><p class="fine">Every AI gets these in every chat.</p>
        <label class="field">About you<textarea id="ci-about" rows="3" maxlength="3000" placeholder="For example: I'm Dragongamer9; I build Hearth OS; my laptop has Intel graphics and 8 GB of RAM.">${esc(ci.about || '')}</textarea></label>
        <label class="field">How the AIs should answer<textarea id="ci-style" rows="3" maxlength="3000" placeholder="For example: plain language, short answers, say what changed for me.">${esc(ci.style || '')}</textarea></label>
        <div class="mft left"><button class="btn" data-a="save-ci">Save</button></div></div>
      <div class="box"><h3>${icon('db', 'sm')}Memory across chats</h3><p class="fine">Facts every AI reads at the start of a chat. AIs can only suggest one; it's saved after your yes. Saved safely (with a backup) in memory.json.</p>
        ${mem?.broken ? `<div class="note bad">${esc(mem.broken)}</div>` : ''}
        ${(mem?.pending || []).map((p) => `<div class="srow">${icon('clock', 'sm')}<span class="d">${esc(aiName(p.agent) || 'An AI')} suggests:</span><b>${esc(p.text)}</b><span class="grow"></span><button class="mini" data-a="mem-decide" data-id="${esc(p.id)}" data-v="1">Remember</button><button class="mini" data-a="mem-decide" data-id="${esc(p.id)}" data-v="0">No</button></div>`).join('')}
        ${(mem?.facts || []).map((f) => (S.memEdit === f.id ? `<div class="srow"><input id="mem-edit" class="grow" value="${esc(f.text)}" maxlength="500"><button class="mini" data-a="mem-save" data-id="${esc(f.id)}">Save</button><button class="mini" data-a="mem-cancel">Cancel</button></div>` : `<div class="srow">${icon('check', 'sm')}<span class="grow">${esc(f.text)}</span><span class="d">${f.suggestedBy ? `suggested by ${esc(aiName(f.suggestedBy))} · ` : ''}${esc(ago(f.at) || '')}</span><button class="mini" data-a="mem-edit" data-id="${esc(f.id)}">Edit</button><button class="mini" data-a="mem-del" data-id="${esc(f.id)}">Delete</button></div>`)).join('') || (mem ? '<div class="fine">Nothing remembered yet.</div>' : '<div class="fine">Loading…</div>')}
        <div class="srow"><input id="mem-new" class="grow" maxlength="500" placeholder="Add something to remember"><button class="mini" data-a="mem-add">Add</button></div></div>`;
  }
  if (k === 'scheduled') {
    const sc = S.schedules;
    const chats = S.chats.filter((c) => !c.hidden);
    return `<h1>Scheduled</h1><div class="box"><h3>${icon('clock', 'sm')}Scheduled tasks</h3><p class="fine">The team runs a message in a chat later, every day or every week, while the app is running. Each run posts its result into that chat. Nothing runs until you create a task.</p>
      ${sc?.broken ? `<div class="note bad">${esc(sc.broken)}</div>` : ''}
      ${(sc?.list || []).map((x) => `<div class="srow">${icon('clock', 'sm')}<b>${esc(x.title)}</b><span class="d">${esc(whenText(x))} · in “${esc(entry(x.chatId)?.title || 'a deleted chat')}”${x.nextRun ? ` · next ${esc(new Date(x.nextRun).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}` : ''}${x.lastRun ? ` · last ${esc(ago(x.lastRun))}: ${esc(x.lastResult === 'ok' ? 'done' : x.lastResult || '')}` : ''}${x.running ? ' · running now' : ''}</span><span class="grow"></span>${tog(x.enabled, 'sched-toggle', `data-id="${esc(x.id)}"`)}<button class="mini" data-a="sched-del" data-id="${esc(x.id)}">Delete</button></div>`).join('') || (sc ? '<div class="fine">No scheduled tasks.</div>' : '<div class="fine">Loading…</div>')}</div>
      <div class="box"><h3>New scheduled task</h3>
        <label class="field">What the team should do<textarea id="sc-prompt" rows="3" maxlength="4000" placeholder="For example: check the newest logs in Dragongamer9/hearth-logs and tell me about new crashes."></textarea></label>
        <div class="srow">In chat<select id="sc-chat">${chats.map((c) => `<option value="${esc(c.id)}" ${c.id === S.lastChat ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select>When<select id="sc-kind"><option value="daily">Every day</option><option value="weekly">Every week</option><option value="once">Once</option></select><input id="sc-time" type="time" value="09:00"><input id="sc-at" type="datetime-local"></div>
        <div class="srow">Days (weekly)${WEEK.map((d, i) => `<label class="day"><input type="checkbox" class="sc-day" value="${i}" ${i === 1 ? 'checked' : ''}>${d}</label>`).join('')}</div>
        <div class="mft left"><button class="btn p" data-a="sched-add" ${chats.length ? '' : 'disabled'}>Create</button></div></div>`;
  }
  if (k === 'connectors') {
    const cn = S.connectors;
    const dk = S.desktop || {};
    const desk = `<div class="box"><h3>${icon('cpu', 'sm')}Let your AI use this desktop</h3><p class="fine">Claude Code, Codex and Gemini can look at your open apps and work them for you with Agent Desktop (github.com/vercel-labs/agent-desktop, Apache-2.0), through each app's accessibility. <b>Every action asks you first</b>: a card shows what it wants to click, type, press, open or close, and nothing happens until you press Allow. Looking (reading what's on screen in an app) doesn't ask. No answer in 2 minutes is a no. On Hearth's desktop it clicks and types through the apps themselves; moving the mouse and pressing keys for it needs a later Hearth update.</p>
      ${dk.broken ? '<div class="note bad">Your desktop control file couldn\'t be read. It was left as it is; this switch can\'t be saved until it\'s fixed.</div>' : ''}
      <div class="srow"><b>Agent Desktop</b><span class="d">${dk.enabled ? 'On: your AIs can ask to use this desktop' : 'Off'}</span><span class="grow"></span>${tog(dk.enabled === true, 'desk-toggle', '')}</div></div>`;
    return `<h1>Connectors</h1>${desk}<div class="box"><h3>${icon('cpu', 'sm')}Connectors (MCP servers)</h3><p class="fine">Tools the AIs can use, like in the Claude app. Passed to Claude Code (--mcp-config), Codex (its mcp_servers setting) and the Gemini CLI (its settings file) for every run. Secrets (tokens, keys) go only into the encrypted store; the files the AI apps read hold references, never the values.</p>
      ${cn?.broken ? `<div class="note bad">${esc(cn.broken)}</div>` : ''}
      ${(cn?.list || []).map((x) => `<div class="srow">${icon('cpu', 'sm')}<b>${esc(x.name)}</b><span class="d mono">${esc(x.type === 'http' ? x.url : `${x.command} ${(x.args || []).join(' ')}`)}${x.secrets?.length ? ` · ${x.secrets.map((q) => `${esc(q.key)} ${q.saved ? '✓' : '✗'}`).join(', ')}` : ''}</span><span class="grow"></span>${tog(x.enabled, 'conn-toggle', `data-id="${esc(x.id)}"`)}<button class="mini" data-a="conn-del" data-id="${esc(x.id)}">Remove</button></div>`).join('') || (cn ? '<div class="fine">No connectors yet.</div>' : '<div class="fine">Loading…</div>')}</div>
      <div class="box"><h3>Add a connector</h3>
        <div class="srow"><input id="cn-name" placeholder="Name (letters, numbers, - _)"><select id="cn-type"><option value="stdio">Runs on this PC (command)</option><option value="http">Remote (URL)</option></select></div>
        <div class="srow"><input id="cn-command" class="grow" placeholder="Command, e.g. npx -y @modelcontextprotocol/server-github"><input id="cn-url" class="grow" placeholder="or https://… for a remote server"></div>
        <label class="field">Secrets, one per line: NAME=value (environment variables for a command, headers like Authorization=Bearer … for a URL)<textarea id="cn-secrets" rows="3" class="mono" placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=…"></textarea></label>
        <div class="mft left"><button class="btn p" data-a="conn-add">Add</button></div></div>`;
  }
  if (k === 'perms') {
    return `<h1>Permissions</h1><div class="box"><h3>${icon('shield', 'sm')}Permissions</h3>
      <div class="srow">Claude can do everything I can<span class="d">asks me first every time (popup or typed yes)</span><span class="grow"></span>${tog(s.actForMe === true, 'act-for-me')}</div>
      <div class="srow">Merging into main, releases and tags<span class="d">always ask me</span></div>
      <div class="srow">Version numbers<span class="d">only you set them</span></div>
      <div class="srow">Memory<span class="d">AIs only suggest; nothing is remembered without your yes</span></div>
      <div class="srow">Full access<span class="d">${s.access === 'full' ? 'on: with Run & build, Claude, ChatGPT and Qwen run any command with no checks (Gemini and Mistral always stay on their narrow list)' : 'off: AIs run only the quick checks you allow'}</span><span class="grow"></span>${tog(s.access === 'full', 'full-access')}</div>
      ${leadSwitchesNote(s)}</div>
      ${permsTableBox()}`;
  }
  if (k === 'alerts') {
    return `<h1>Notifications</h1><div class="box"><h3>${icon('flag', 'sm')}Notifications</h3>
      <div class="srow">Desktop notifications<span class="d">when a reply is ready or an AI needs your answer, naming the chat (only when you're not looking at it)</span><span class="grow"></span>${tog(s.notify !== false, 'notify-toggle')}</div></div>
      <div class="box"><h3>${icon('users', 'sm')}Several chats at once</h3><div class="srow">Chats working at the same time<span class="d">more wait in line and say so</span><span class="grow"></span><select data-a="max-chats">${MAX_CHATS.map((n) => `<option value="${n}" ${(s.maxChats || 3) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
      <div class="box"><h3>${icon('mic', 'sm')}Voice</h3><div class="srow">Voice chat, read aloud and voices<span class="d">moved to their own page</span><span class="grow"></span><button class="mini" data-a="tab" data-t="voice">Settings › Voice</button></div></div>`;
  }
  if (k === 'voice') return voice.settingsHtml({ tog, team: t, mono, aiName });
  if (k === 'uncensored') return uncensoredSection();
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
      <p class="fine">Works for the AppImage and the .deb. Version numbers are always yours to pick.</p></div>
      ${creditsHtml(esc)}`;
  }
  if (k === 'data') {
    const cp = S.copies;
    const total = (cp?.list || []).reduce((n, c) => n + (c.size || 0), 0);
    return `<h1>Saved data</h1>
      <div class="box"><h3>${icon('db', 'sm')}Temporary copies</h3>
        <div class="srow">Space used<b>${cp ? fmtBytes(total) : '…'}</b><span class="d">${cp ? `${cp.list.length} cop${cp.list.length === 1 ? 'y' : 'ies'} · removed after ${esc(IDLE.find(([v]) => v === S.settings.copyIdleHours)?.[1] || '1 day')} idle` : ''}</span><span class="grow"></span><button class="btn" data-a="cleanup" ${cp?.list?.length ? '' : 'disabled'}>Clean up</button></div>
        ${(cp?.list || []).map((c) => `<div class="srow copy">${icon('gh', 'sm')}<b>${esc(c.repo || c.dir || '?')}</b><span class="d">${esc(entry(c.chatId)?.title || 'deleted chat')} · ${esc(c.work || c.branch || '')} · ${fmtBytes(c.size)} · used ${esc(ago(c.lastUsedAt) || 'never')}</span><span class="grow"></span>${c.unpushed ? `<span class="chip b">not on GitHub</span><button class="mini" data-a="copy-push" data-id="${esc(c.chatId)}">Push to a branch</button>` : ''}<button class="mini" data-a="copy-remove" data-id="${esc(c.chatId)}">Remove</button></div>`).join('') || '<div class="fine">No temporary copies right now.</div>'}
        <div class="note">Copies holding work that isn't on GitHub are never deleted without asking you. ${cp?.root ? `They live in ${esc(cp.root)}.` : ''}</div></div>
      ${settingsLogBox()}
      <div class="box"><h3>Backups</h3><div class="srow">Your chats list keeps its last good copy as a backup, and the list from before 2.0 is kept as index.json.pre-2. Memory, scheduled tasks, connectors and the Habitat keep a .bak too.<span class="grow"></span><button class="mini" data-a="open-data-folder">Open the data folder</button></div></div>
      <div class="box"><h3>Old boards (read-only)</h3><p class="fine">The task boards, approvals and audit logs from 1.x are kept on disk exactly as they were. They're not used any more.</p>
        ${(S.boards || []).map((b) => `<div class="srow">${icon('board', 'sm')}<b>${esc(b.name)}</b><span class="d">${b.ok ? `${b.tasks.length} tasks · ${b.approvals} approvals · ${b.audit} audit entries` : 'couldn\'t be read (left as it is)'}</span><span class="grow"></span>${b.ok ? `<button class="mini" data-a="view-board" data-id="${esc(b.id)}">View</button>` : ''}</div>`).join('') || '<div class="fine">No old boards.</div>'}</div>`;
  }
  return '';
}

// ---- Settings › AI team › Test team ----
function teamTestBox() {
  const T = S.teamTest;
  const ids = team().members.filter((a) => ready(a) && method(a) !== 'api' && ['anthropic', 'openai', 'google', 'xai', 'mistral', 'qwen'].includes(a));
  const res = (T?.results || []).map((r) => `<div class="tt"><div class="srow">${mono(r.agent)}<b>${esc(aiName(r.agent))}</b><span class="d">${r.via ? esc(r.via) : ''}${r.ms ? ` · ${Math.round(r.ms / 1000)} s` : ''}</span><span class="grow"></span><span class="chip ${r.steps.every((x) => x.pass) ? 'g' : 'b'}">${r.steps.filter((x) => x.pass).length}/${r.steps.length} passed</span></div>
    ${r.steps.map((x) => `<div class="srow sub step-${x.pass ? 'ok' : 'bad'}">${icon(x.pass ? 'check' : 'x', 'sm')}<b>${esc(x.label)}</b><span class="d">${x.pass ? 'pass' : 'fail'}${x.detail ? ` · ${esc(x.detail)}` : ''}${x.verified && !/checked by the app/.test(x.detail || '') ? ' · checked by the app' : ''}</span></div>`).join('')}</div>`).join('');
  return `<div class="box" id="team-test"><h3>${icon('check', 'sm')}Test team</h3><p class="fine">Every connected teammate runs the same safe test in a temporary scratch folder: read a file, search the web, run node --check on a file it makes, then delete that file. Nothing is pushed, no pictures are made, and your settings are checked afterwards.</p>
    <div class="srow"><span class="d">${ids.length ? `Will test: ${esc(ids.map(aiName).join(', '))}` : 'No connected teammate with a CLI yet.'}</span><span class="grow"></span><button class="btn p" data-a="team-test" ${S.testing || !ids.length ? 'disabled' : ''}>${S.testing ? 'Testing…' : 'Test team'}</button></div>
    ${S.testing ? `<div class="fine">${esc((T?.running || []).map(aiName).join(', '))} are working on it (up to a few minutes)…</div>` : ''}
    ${T?.error ? `<div class="note bad">${esc(T.error)}</div>` : ''}${res}
    ${T?.settingsUndone ? '<div class="note warn">A teammate changed settings.json during the test; it was undone (see Saved data).</div>' : ''}</div>`;
}
// ---- Settings › Tools: quick checks whose tool isn't on this PC ----
function missingBox() {
  const miss = (S.missing || []).filter((x) => x.missing);
  if (!miss.length) return S.missing?.length ? '<div class="fine">Every quick check\'s tool is installed on this PC.</div>' : '';
  return `<div class="note warn" id="missing-tools">${icon('flag', 'sm')}<div><b>Not installed on this PC:</b> ${[...new Set(miss.map((x) => x.tool))].map((t) => `<span class="chip">${esc(t)}</span>`).join(' ')}<div class="fine">${miss.map((x) => esc(x.check)).join(', ')} can't run here. The AIs are told to leave them to GitHub Actions (push to the chat's branch). Or install ${esc([...new Set(miss.map((x) => x.tool))].join(', '))} and press Re-check.</div></div><button class="mini" data-a="tab" data-t="tools">Re-check</button></div>`;
}
// ---- Settings › Permissions ----
function leadSwitchesNote(s) {
  const on = [['leadMerge', 'Lead may merge'], ['leadRelease', 'Lead may publish releases'], ['leadTag', 'Lead may create tags']].filter(([k]) => s[k] === true);
  return `<div class="srow">Old lead switches (from 1.4–1.5)<span class="d">${on.length ? `${esc(on.map((x) => x[1]).join(', '))}: on in your settings. Since this version they only let the lead ask; merging, releasing and tagging always ask you in a popup. They aren't used by chats.` : 'all off'}</span></div>
    <div class="srow">Auto-push<span class="d">${s.autoPush !== false ? 'on: after a Run & build turn in a chat with a repo, the app pushes the chat\'s own hearth/ branch (never main, the base branch or a tag)' : 'off: pushes wait for you'}</span></div>`;
}
function permsTableBox() {
  const P = S.permsT;
  if (!P) return '<div class="box"><h3>What each AI can really do</h3><div class="fine">Checking the AI apps on this PC…</div></div>';
  const agy = P.agy;
  const agyRow = agy ? `<div class="srow" id="agy-setup">${mono('google')}<b>Gemini's allow-list (agy)</b><span class="d">${agy.state === 'set' ? 'set up: read-only commands, your quick checks and reading web pages' : agy.state === 'partly' ? `partly set up (${agy.missing} of ${agy.total} rules missing)` : agy.state === 'error' ? esc(agy.message) : 'not set up: Gemini\'s commands and web pages are refused'} · rules live in agy's own ${esc(agy.file || 'settings.json')}; the app adds them only when you press the button (your other agy settings stay)</span><span class="grow"></span>${agy.state !== 'set' && agy.state !== 'error' ? '<button class="btn p" data-a="agy-setup">Set up Gemini\'s allow-list</button>' : ''}</div>` : '';
  const cell = (v) => `<td>${esc(v)}</td>`;
  return `<div class="box"><h3>${icon('shield', 'sm')}What each AI can really do</h3><p class="fine">Worked out from the AI apps found on this PC (and their versions), your keys, and the exact flags the app passes. Signed-in state is on the Accounts page.</p>${agyRow}
    <div class="tbl-wrap"><table class="perms" id="perms-table"><thead><tr><th>AI</th><th>Connection</th><th>Files</th><th>Commands</th><th>Web</th><th>Pictures</th><th>Push</th></tr></thead><tbody>
    ${P.rows.map((r) => `<tr class="${r.ready ? '' : 'off'}"><td>${mono(r.id, 'sm')}<b>${esc(r.name)}</b>${r.notes?.length ? `<div class="fine">${esc(r.notes.join(' '))}</div>` : ''}</td><td>${esc(r.connection)}<div class="fine">${esc(r.tool)}</div></td>${cell(r.files)}${cell(r.commands)}${cell(r.web)}${cell(r.images)}${cell(r.push)}</tr>`).join('')}
    </tbody></table></div><div class="mft left"><button class="mini" data-a="perms-refresh">Check again</button></div></div>`;
}
// ---- Settings › Saved data: the settings change log ----
function settingsLogBox() {
  const L = S.slog;
  const rows = (L?.entries || []).slice(0, 60).map((e) => `<div class="srow log"><span class="d mono">${esc(String(e.at || '').slice(0, 16).replace('T', ' '))}</span><b class="mono">${esc(e.key)}</b><span class="d mono">${esc(e.from)} → ${esc(e.to)}</span><span class="grow"></span><span class="chip">${esc(e.by)}</span></div>`).join('');
  return `<div class="box" id="settings-log"><h3>${icon('clock', 'sm')}Settings changes</h3><p class="fine">Every change to your settings: when, what (old → new) and who. Only what really changed is saved; defaults are never written for you. A change an AI makes to the settings file is undone at once and shown here.</p>
    ${L?.broken ? `<div class="note bad">${esc(L.broken)}</div>` : ''}${rows || '<div class="fine">No changes recorded yet.</div>'}</div>`;
}

// Cards imported from a site's download (newest first, until dismissed).
function foundHtml() {
  return (S.found || []).slice(0, 4).map((f) => f.ok && f.card ? `<div class="note found" id="found-${esc(f.key)}">${icon('check', 'sm')}<span>Imported <b>${esc(f.card.name)}</b>${f.card.minor ? ` · reads as under 18 (${esc(f.card.minorWhy || '')}): stories only, nothing sexual` : ''}</span><span class="grow"></span><button class="mini" data-a="card-edit" data-id="${esc(f.card.id)}">Open</button><button class="mini" data-a="card-chat" data-id="${esc(f.card.id)}">Start chat</button><button class="mini" data-a="found-dismiss" data-v="${esc(f.key)}">×</button></div>`
    : f.ok && f.lorebook ? `<div class="note found">${icon('doc', 'sm')}<span>Imported the lorebook <b>${esc(f.lorebook.name)}</b></span><span class="grow"></span><button class="mini" data-a="found-dismiss" data-v="${esc(f.key)}">×</button></div>`
    : `<div class="note warn">${esc(f.message || 'Not imported.')}<span class="grow"></span><button class="mini" data-a="found-dismiss" data-v="${esc(f.key)}">×</button></div>`).join('');
}

async function loadCopies() { S.copies = await call('copiesList'); render(); }
async function loadSection(t) {
  if (t === 'voice') { await voice.loadLists(); return render(); }
  if (t === 'data') { loadCopies(); S.boards = await call('savedBoards'); S.slog = await call('settingsLog'); }
  if (t === 'perms') { refreshAgents(); loadPerms(); }
  if (t === 'tools') loadMissing();
  if (t === 'uncensored') { refreshAgents(); if (!S.studio.models) { const l = await call('comfyCheckpoints'); S.studio.models = l?.ok ? l.checkpoints : null; } }
  if (t === 'accounts' || t === 'team') { refreshAgents(); await refreshMates(); }
  if (t === 'accounts') { S.hd = (await call('hearthStatus', { probe: true })) || S.hd; loadAllServerModels().then(() => render()); }
  if (t === 'github') loadRepos();
  if (t === 'memory') S.memory = await call('memoryList');
  if (t === 'scheduled') S.schedules = await call('scheduleList');
  if (t === 'connectors') { S.connectors = await call('connectorsList'); S.desktop = await call('desktopStatus'); }
  if (t === 'tools') { S.skills = (await call('skillsList', S.lastChat)) || []; }
  render();
}
// ---------- Images & Videos (2.2.1; electron/studio.cjs, src/app/studio.mjs) ----------
const stHtml = () => studioView({ f: S.studio.f, data: S.studio.data || {}, st: S.studio.st, filter: S.studio.filter, models: S.studio.models, shown: S.studio.shown });
// What he typed is kept across re-renders (the page is redrawn when a job moves on).
function stSync() {
  if (S.view !== 'studio' || !document.getElementById('st-prompt')) return;
  const r = requestFrom(S.studio.f, document);
  Object.assign(S.studio.f, { prompt: document.getElementById('st-prompt').value, size: r.size, count: r.count, model: r.model, negative: r.negative, seed: document.getElementById('st-seed')?.value ?? S.studio.f.seed, steps: document.getElementById('st-steps')?.value ?? S.studio.f.steps });
}
function stFocus() {
  const a = document.activeElement;
  if (!a?.id || !a.closest?.('.studio')) return null;
  return { id: a.id, start: a.selectionStart, end: a.selectionEnd, top: document.getElementById('body')?.scrollTop || 0 };
}
function stRefocus(k) {
  const el = document.getElementById(k.id);
  if (el) { el.focus(); try { if (k.start !== null && k.start !== undefined) el.setSelectionRange(k.start, k.end); } catch {} }
  const body = document.getElementById('body');
  if (body) body.scrollTop = k.top;
}
async function openStudio() {
  S.view = 'studio'; S.pane = null; S.pop = null;
  if (!S.studio.data) S.studio.data = (await call('studioList')) || { items: [], jobs: [] };
  render(true);
  stStatus();
  if (!S.studio.models) { const l = await call('comfyCheckpoints'); S.studio.models = l?.ok ? l.checkpoints : []; if (S.view === 'studio') render(); }
}
async function stStatus(force = false) {
  if (force) { S.studio.st = null; render(); }
  S.studio.st = await call('studioStatus');
  if (S.view === 'studio') render();
  clearTimeout(stStatus.t);
  stStatus.t = setTimeout(() => { if (S.view === 'studio') stStatus(); }, 30000);
}
function onStudio(type, a) {
  if (type === 'failed') { toast(`${a?.kind === 'video' ? 'The video' : 'The picture'} “${String(a?.prompt || '').slice(0, 40)}” didn't work: ${a?.message || 'no reason given'}`); return; }
  const before = S.studio.data;
  S.studio.data = a || before;
  if (S.view !== 'studio') { renderSide(); return; }
  // Only the queue moved: patch it alone (playing videos and what he's typing stay as they are).
  const same = before && a && before.items.length === a.items.length && before.items[0]?.id === a.items[0]?.id && before.uncensored === a.uncensored;
  const q = document.getElementById('st-queue');
  if (same && q) { q.innerHTML = queueHtml(a.jobs); if ((before.jobs || []).length !== (a.jobs || []).length) renderSide(); return; }
  render();
}

// ---------- Characters chat: Generate scene (ComfyUI; electron/scene.cjs) ----------
// The last messages as plain text for the prompt (built in the main process, shown to edit).
const sceneMsgs = (chatId) => (rt(chatId)?.msgs || []).filter((x) => !x.deleted && x.who !== 'system').slice(-12).map((x) => ({ who: x.who, text: String(x.text || '').slice(0, 2000), err: x.err === true }));
const GB = 1024 ** 3;
// "her" / "his" / "their", from the card's own words (the Generate scene hint).
const pronounOf = (c) => { const t = `${c?.description || ''} ${c?.personality || ''}`; const she = (t.match(/\b(?:she|her|hers|herself)\b/gi) || []).length; const he = (t.match(/\b(?:he|him|his|himself)\b/gi) || []).length; return she > he ? 'her' : he > she ? 'his' : 'their'; };
const vramLine = (v) => (v?.vramTotal ? `${v.gpu || 'GPU'}: ${(v.vramFree / GB).toFixed(1)} GB of ${(v.vramTotal / GB).toFixed(1)} GB graphics memory free` : v?.gpu || '');
async function openScene(chatId, preset = null) {
  const c = entry(chatId);
  if (!S.cards) await loadCards();
  const ids = preset?.cardIds?.length ? preset.cardIds : rpCards(c).map((x) => x.id);
  const [sources, pr] = await Promise.all([call('rpSceneSources'), call('rpScenePrompt', ids, sceneMsgs(chatId))]);
  const L = cardById(ids[0])?.ownerLook || {};
  const kept = L.keepSeed !== false && Number.isInteger(L.seed);
  const list = Array.isArray(sources) ? sources : [];
  const source = preset?.source && list.some((x) => x.id === preset.source) ? preset.source : list[0]?.id || '';
  S.modal = { kind: 'rpscene', chatId, ids, prompt: preset?.positive || pr?.prompt || '', negative: preset?.ownNegative || '', negativeBase: pr?.negativeBase || '', settings: pr?.settings || null, sources: list, source, seed: kept ? L.seed : Math.floor(Math.random() * 2 ** 31), seedSaved: kept };
  renderOverlay();
  sceneVram();
}
// Free graphics memory on his ComfyUI server, read live when the dialog opens (never unloads anything).
async function sceneVram() {
  const m = S.modal;
  if (m?.kind !== 'rpscene' || m.source !== 'comfy') return;
  const v = await call('comfyStats');
  if (S.modal !== m) return;
  m.vram = v?.ok ? v : null;
  renderOverlay();
}
// Scene pictures being made now, per chat (shown at the bottom of the chat with Cancel). The chat
// keeps working meanwhile: nothing here blocks sending or other messages.
function sceneJobsHtml(R) {
  const jobs = R?.scenes || [];
  if (!jobs.length) return '';
  const phase = { checking: 'Checking the server', queued: 'Queued on ComfyUI', generating: 'Generating', downloading: 'Downloading the picture', cancelling: 'Cancelling' };
  return jobs.map((j) => `<div class="msg-s scenejob" data-job="${esc(j.job)}">${icon('eye', 'sm')} <b>Scene picture</b> · <span class="sj-phase">${esc(phase[j.phase] || 'Sending')}</span> · <span class="sj-time">${Number(j.elapsed) || 0} s</span> <span class="faint">· ${esc(j.where || 'ComfyUI')}</span>${j.note ? `<div class="note warn">${esc(j.note)}</div>` : ''} <button class="mini" data-a="rs-cancel" data-job="${esc(j.job)}" ${j.phase === 'cancelling' ? 'disabled' : ''}>${icon('x', 'sm')}Cancel</button></div>`).join('');
}
function onSceneProgress(p) {
  const R = rt(p?.chatId);
  const j = R?.scenes?.find((x) => x.job === p.job);
  if (!j) return;
  if (p.phase && p.phase !== 'tick' && j.phase !== 'cancelling') j.phase = p.phase;
  j.elapsed = Math.max(Number(p.elapsed) || 0, Math.round((Date.now() - j.started) / 1000));
  if (p.note) j.note = p.note;
  // Drawn straight into its row (the chat isn't re-rendered for every second).
  const el = document.querySelector(`.scenejob[data-job="${CSS.escape(j.job)}"]`);
  if (el && !p.note) { const ph = el.querySelector('.sj-phase'); const tm = el.querySelector('.sj-time'); if (ph) ph.textContent = ({ checking: 'Checking the server', queued: 'Queued on ComfyUI', generating: 'Generating', downloading: 'Downloading the picture', cancelling: 'Cancelling' })[j.phase] || 'Sending'; if (tm) tm.textContent = `${j.elapsed} s`; } else if (R === cur()) renderMain();
}
async function makeSceneNow() {
  const m = S.modal;
  if (m?.kind !== 'rpscene') return;
  const prompt = document.getElementById('rs-prompt')?.value || '';
  const negative = document.getElementById('rs-neg')?.value || '';
  const seed = (document.getElementById('rs-seed')?.value || '').trim();
  const source = document.getElementById('rs-src')?.value || m.source;
  const ids = [...document.querySelectorAll('.rsc:checked')].map((x) => x.value);
  S.modal = null; renderOverlay();
  return runScene(m.chatId, { cardIds: ids, prompt, negative, seed: seed === '' ? null : Number(seed), source }, (m.sources.find((x) => x.id === source) || {}).name);
}
// Make one scene picture in the background of this chat, then post it (or a clear message).
async function runScene(chatId, o, where) {
  const R = rt(chatId);
  if (!R) return;
  const job = `s${uid().replace(/[^A-Za-z0-9]/g, '').slice(0, 20)}`;
  R.scenes = [...(R.scenes || []), { job, phase: 'checking', elapsed: 0, started: Date.now(), where: where || 'ComfyUI' }];
  render();
  const r = await call('rpScene', chatId, { ...o, job });
  R.scenes = (R.scenes || []).filter((x) => x.job !== job);
  // Shown and saved with this chat (its media folder); the prompt and settings used stay with
  // the message (never in settings) and out of the text the other AIs read.
  const meta = r?.meta || { seed: r?.seed, checkpoint: r?.checkpoint };
  const dims = meta.width ? ` · ${meta.width}×${meta.height}` : '';
  if (r?.ok) runner.post(R, { who: 'system', text: `Scene picture · ${r.via}${dims}`, media: r.items || [], scene: meta, ...(r.vramNote ? { sceneNote: r.vramNote } : {}) });
  else if (r?.error?.kind === 'cancelled') runner.post(R, { who: 'system', text: r.error.message || 'Cancelled.' });
  else runner.post(R, { who: 'system', block: ['minor', 'real', 'age'].includes(r?.error?.kind), sceneFailed: { ...o, seed: o.seed ?? null }, text: `Scene picture: ${r?.error?.message || r?.message || 'no picture came back.'}` });
  await saveRt(R);
  return render();
}
// A scene picture's message: the picture (from its file), what was used, Regenerate (new seed),
// Use this seed for the character, Edit prompt.
function sceneMsg(m) {
  const sc = m.scene || {};
  const used = [sc.seed != null ? `seed ${sc.seed}` : '', sc.checkpoint || '', sc.width ? `${sc.width}×${sc.height}` : '', sc.steps ? `${sc.steps} steps` : '', sc.cfg ? `CFG ${sc.cfg}` : '', sc.sampler ? `${sc.sampler}${sc.scheduler ? ` / ${sc.scheduler}` : ''}` : ''].filter(Boolean).join(' · ');
  const first = (sc.cardIds || []).map(cardById).find(Boolean);
  const ro = S.readOnly;
  return `<div class="msg-s scene" data-msg="${esc(m.id)}">${rich(m.text)}${mediaHtml(m)}${m.sceneNote ? `<div class="fine">${esc(m.sceneNote)}</div>` : ''}
    ${sc.positive ? `<details class="raw"><summary class="fine">Prompt and settings used</summary><div class="fine mono">${esc(used)}</div><div class="fine"><b>Prompt:</b> ${esc(sc.positive)}</div>${sc.negative ? `<div class="fine"><b>Negative:</b> ${esc(sc.negative)}</div>` : ''}</details>` : used ? `<div class="fine mono">${esc(used)}</div>` : ''}
    ${ro ? '' : `<div class="mft left">${sc.positive ? `<button class="mini" data-a="scene-regen" data-m="${esc(m.id)}" title="The same prompt and settings with a new seed">${icon('refresh', 'sm')}Regenerate</button>` : ''}<button class="mini" data-a="scene-edit" data-m="${esc(m.id)}">${icon('pencil', 'sm')}Edit prompt</button>${first && Number.isInteger(sc.seed) ? `<button class="mini" data-a="scene-seed" data-m="${esc(m.id)}" title="Save this seed in ${esc(first.name)}'s look">Use this seed for ${esc(first.name)}</button>` : ''}</div>`}</div>`;
}

// ---------- Hearth devices and the ComfyUI server (Settings › Accounts) ----------
// The devices come from the Home server (main process); nothing here is saved unless he clicks.
function hdOrder() {
  const hd = S.hd || {};
  return hd.order || (hd.devices || []).map((d) => d.device);
}
function hearthBox() {
  const hd = S.hd || {};
  const st = hd.settings || S.settings.hearthDevices || {};
  const devs = Object.fromEntries((hd.devices || []).map((d) => [d.device, d]));
  const kindName = { chat: 'chat', voice: 'Kokoro voices', image: 'ComfyUI pictures', stt: 'whisper speech to text' };
  const rows = hdOrder().map((n, i, all) => {
    const d = devs[n];
    if (!d) return '';
    const flags = [d.gaming ? 'gaming' : '', d.busy ? 'busy' : '', d.battery ? `battery ${d.battery.percent ?? '?'}%${d.battery.charging ? ' (charging)' : ''}` : ''].filter(Boolean).join(' · ');
    const svc = d.services.map((x) => `${kindName[x.kind] || x.kind}${x.healthy ? '' : ' (not healthy)'}${x.allowed === false ? ' (address not allowed)' : ''}`).join(', ') || 'shares nothing';
    const chat = d.services.find((x) => x.kind === 'chat');
    const img = d.services.find((x) => x.kind === 'image');
    const pick = (k, list, cur) => `<select data-a="hd-pick" data-k="${k}" data-v="${esc(n)}" aria-label="${k === 'models' ? 'Chat model' : 'Checkpoint'} on ${esc(n)}"><option value="">${k === 'models' ? 'first model' : 'first checkpoint'}</option>${list.map((m) => `<option ${cur === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`;
    return `<div class="srow sub hd-dev"><b>${i + 1}. ${esc(n)}</b><span class="d">${esc(svc)}${flags ? ` · ${esc(flags)}` : ''}</span><span class="grow"></span><button class="mini" data-a="hd-move" data-v="${esc(n)}" data-d="-1" ${i ? '' : 'disabled'} title="Try earlier">↑</button><button class="mini" data-a="hd-move" data-v="${esc(n)}" data-d="1" ${i < all.length - 1 ? '' : 'disabled'} title="Try later">↓</button></div>${chat?.models?.length || img?.models?.length ? `<div class="srow sub">${chat?.models?.length ? `Chat model${pick('models', chat.models, st.models?.[n])}` : ''}${img?.models?.length ? `Checkpoint${pick('checkpoints', img.models, st.checkpoints?.[n])}` : ''}</div>` : ''}`;
  }).join('');
  return `<div class="box" id="hearth-devices"><h3>${mono('hearth')}Hearth devices</h3><p class="fine">The AI your Hearth OS machines share: chat (Ollama) and pictures (ComfyUI) on your Nvidia PC first, voices (Kokoro) and speech to text (whisper) on the others when it's busy, gaming or off. The best device is picked for each job and the next one is tried if it fails. Your own machines: chats with uncensored teammates may use them.</p>
    <div class="srow">Home server<span class="d">its address, port ${8189}</span><span class="grow"></span><input id="hd-url" class="mono" value="${esc(st.url || '')}" placeholder="http://nvidia-pc:8189" aria-label="Home server address"><button class="mini" data-a="hd-url">Save</button><button class="mini" data-a="hd-test">Test</button></div>
    <div class="srow">Share code<span class="d">only if your Hearth devices ask for one · ${hd.shareCode ? 'saved, encrypted on this PC' : 'none'}</span><span class="grow"></span><input id="hd-code" type="password" placeholder="${hd.shareCode ? 'Type a new code to replace it' : 'Share code (optional)'}" autocomplete="off" aria-label="Share code"><button class="mini" data-a="hd-code">Save</button>${hd.shareCode ? '<button class="mini" data-a="hd-code-remove">Remove</button>' : ''}</div>
    <div class="srow">Skip a device while it's gaming<span class="d">a game keeps its GPU to itself</span><span class="grow"></span>${tog(st.skipGaming !== false, 'hd-tog', 'data-k="skipGaming"')}</div>
    <div class="srow">Skip handhelds on battery<span class="d">the ROG Ally (or a laptop) is used only when plugged in</span><span class="grow"></span>${tog(st.skipBattery !== false, 'hd-tog', 'data-k="skipBattery"')}</div>
    <div class="srow">Tailscale addresses<span class="d">devices may point to their 100.x or .ts.net address</span><span class="grow"></span>${tog(st.tailscale !== false, 'hd-tog', 'data-k="tailscale"')}</div>
    <div class="srow">Other allowed names<span class="d">device names on your home network that services may use (besides the Home server)</span><span class="grow"></span><input id="hd-hosts" class="mono" value="${esc((st.allowHosts || []).join(', '))}" placeholder="rog-ally, laptop" aria-label="Other allowed names"><button class="mini" data-a="hd-hosts">Save</button></div>
    ${hd.error ? `<div class="note warn">${esc(hd.error)}</div>` : ''}
    ${rows ? `<div class="srow"><b>Order</b><span class="d">tried top to bottom${st.order?.length ? '' : ' (your Nvidia PC first by default)'}</span></div>${rows}` : st.url && !hd.error ? '<div class="note">Press Test to list your devices.</div>' : ''}
    <div class="note">Turn on “Hearth devices” in Settings › AI team to chat with it. Pictures: pick Hearth devices as the picture maker. Voices and speech to text: Settings › Voice.</div></div>`;
}
// The ComfyUI server box. The suggested address and model are only placeholders: nothing is
// saved until he presses Save or picks something.
const COMFY_SUGGEST = { url: 'http://chris-hearth.tail0e2082.ts.net:8188', checkpoint: 'NoobAI-XL-v1.1.safetensors' };
const COMFY_SIZES = [['1024x1024', '1024 × 1024 (square, about 8 s)'], ['1344x768', '1344 × 768 (wide, about 13 s)'], ['768x1344', '768 × 1344 (tall, about 13 s)']];
// Settings › Uncensored mode (2.2.1): one switch; the hard limits are listed and can't be changed.
const ADULT_CHAT_SUGGEST = ['huihui_ai/qwen3-abliterated:30b-a3b', 'huihui_ai/qwen3-abliterated:14b', 'dolphin3:8b'];
function uncensoredSection() {
  const u = S.settings.uncensored || {};
  const chatOpts = [...new Set([...(S.cli.ollama?.models || []), ...ADULT_CHAT_SUGGEST, ...(u.chatModel ? [u.chatModel] : [])])];
  const picOpts = [...new Set([...(S.studio.models || []), ...(u.pictureModel ? [u.pictureModel] : [])])];
  return `<h1>Uncensored mode</h1><div class="box"><h3>${icon('shield', 'sm')}Uncensored mode (18+)</h3>
    <p class="fine">For adults only. Off until you turn it on; it stays exactly as you set it.</p>
    <div class="srow"><b>Uncensored mode</b><span class="d">${u.on ? 'on: 18+ pictures, videos and local chat are allowed' : 'off'}</span><span class="grow"></span>${tog(u.on === true, 'unc-on')}</div>
    <div class="note">When it's on:</div>
    <ul class="fine unc-list">
      <li><b>Images &amp; Videos:</b> videos use the uncensored Wan 2.2 LoRA pair (Wan2.2_LightX2V_4Step_Uncensored), and pictures no longer leave out nudity. Pictures can use the 18+ picture model below.</li>
      <li><b>Local chat:</b> Local AI (Ollama) and Hearth devices answer with the 18+ chat model below.</li>
      <li><b>Claude, ChatGPT and Gemini don't change:</b> they keep their own rules, and 18+ pictures and videos are never sent to them.</li>
      <li><b>18+ pictures and videos are blurred</b> in Images &amp; Videos until you click them.</li>
    </ul>
    <div class="srow">18+ chat model<span class="d">used by Local AI and Hearth devices while this is on (download it on the PC first, e.g. in Hearth's Settings › Home server › AI chat › Show 18+ models)</span><span class="grow"></span><select data-a="unc-chat" aria-label="18+ chat model"><option value="">your normal local model</option>${chatOpts.map((m) => `<option ${u.chatModel === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
    <div class="srow">18+ picture model<span class="d">${picOpts.length ? 'a checkpoint on your PC\'s ComfyUI' : 'open Images &amp; Videos once, or press Load models in Accounts › ComfyUI server, to list your checkpoints'}</span><span class="grow"></span><select data-a="unc-pic" aria-label="18+ picture model" ${picOpts.length ? '' : 'disabled'}><option value="">your ComfyUI default</option>${picOpts.map((m) => `<option ${u.pictureModel === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div></div>
    <div class="box"><h3>${icon('flag', 'sm')}Always on, in every mode</h3><p class="fine">These can't be switched off by any setting:</p>
    <ul class="fine unc-list"><li>Nothing sexual involving minors or anyone who looks under 18.</li><li>No sexual or nude pictures or videos of real people, and no real person's likeness.</li><li>A picture file you add starts a video in Uncensored mode only after you confirm, each time, that it isn't a real person (AI-made, drawn or a 3D render) and everyone in it is an adult.</li><li>Minors are left out of every picture and video.</li></ul></div>`;
}
function comfyBox() {
  const c = S.settings.comfy || {};
  const t = S.comfyTest?.url === c.url ? S.comfyTest : null;
  const list = S.comfyCkpts?.url === c.url ? S.comfyCkpts.list : t?.checkpoints?.length ? t.checkpoints : null;
  const opts = [...new Set([...(list || []), ...(c.checkpoint ? [c.checkpoint] : [])])];
  const missing = c.checkpoint && list && !list.includes(c.checkpoint);
  const status = t ? (t.ok || t.gpu ? `<div class="note ${t.ok ? '' : 'warn'}" id="comfy-status">${icon(t.ok ? 'check' : 'flag', 'sm')}Online${t.version ? ` · ComfyUI ${esc(t.version)}` : ''}${t.gpu ? ` · ${esc(t.gpu)}` : ''}${t.vramTotal ? ` · <span id="comfy-vram">${((t.vramFree || 0) / GB).toFixed(1)} GB of ${(t.vramTotal / GB).toFixed(1)} GB graphics memory free</span>` : ''}${t.ok ? ` · ${t.checkpoints.length} model${t.checkpoints.length === 1 ? '' : 's'}` : ''}${t.message ? `<br>${esc(t.message)}` : ''}${t.low ? '<br>Graphics memory is low (another model may be loaded), so pictures may be slower. Nothing is unloaded unless you do it.' : ''}</div>` : `<div class="note bad" id="comfy-status">${icon('x', 'sm')}${esc(t.message || 'Not reachable.')}</div>`) : '';
  return `<div class="box" id="comfy-server"><h3>${icon('eye', 'sm')}ComfyUI server</h3><p class="fine">Scene pictures in Characters chats (Generate scene). On this PC, your home network or Tailscale only, never the internet. Your GPU servers set up as ComfyUI and Hearth devices can make scenes too.</p>
    <div class="srow">Address<span class="grow"></span><input id="comfy-url" class="mono" value="${esc(c.url || '')}" placeholder="${esc(COMFY_SUGGEST.url)}" aria-label="ComfyUI address"><button class="mini" data-a="comfy-url">Save</button><button class="mini" data-a="comfy-test" ${c.url ? '' : 'disabled'}>Test connection</button><button class="mini" data-a="comfy-list" ${c.url ? '' : 'disabled'}>Load models</button></div>
    ${status}
    <div class="srow">Default model<span class="d">${list ? `${list.length} checkpoint${list.length === 1 ? '' : 's'} on the server` : c.url ? 'press Test connection or Load models to see the server\'s checkpoints' : 'save the address first'}</span><span class="grow"></span><select data-a="comfy-ckpt" aria-label="Default model" ${opts.length ? '' : 'disabled'}><option value="">suggested: ${esc(COMFY_SUGGEST.checkpoint)} if the server has it, else its first</option>${opts.map((m) => `<option ${c.checkpoint === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
    ${missing ? `<div class="note warn">Your default model ${esc(c.checkpoint)} isn't on the server any more. Pick another one, or scenes will stop with "model missing".</div>` : ''}
    <div class="srow">Picture size<span class="d">bigger sizes fall apart without an upscaler, so they aren't offered</span><span class="grow"></span><select data-a="comfy-size" aria-label="Picture size"><option value="" ${c.size ? '' : 'selected'}>default: 1024 × 1024</option>${COMFY_SIZES.map(([id, label]) => `<option value="${id}" ${c.size === id ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
    <div class="srow">Steps and CFG<span class="d">sampler euler_ancestral, scheduler normal</span><span class="grow"></span><input id="comfy-steps" class="mono" inputmode="numeric" style="width:5em" value="${esc(c.steps ?? '')}" placeholder="26" aria-label="Steps"><input id="comfy-cfg" class="mono" inputmode="decimal" style="width:5em" value="${esc(c.cfg ?? '')}" placeholder="5.5" aria-label="CFG"><button class="mini" data-a="comfy-tune">Save</button></div>
    ${S.comfyCkpts?.error && S.comfyCkpts.url === c.url ? `<div class="note warn">${esc(S.comfyCkpts.error)}</div>` : ''}</div>`;
}
// Test connection, and the free graphics memory kept live (every 5 s) while the box is shown.
async function comfyTest() {
  const url = S.settings.comfy?.url;
  const r = await call('comfyTest');
  S.comfyTest = { url, ...(r || { ok: false, message: 'No answer.' }) };
  if (r?.ok) S.comfyCkpts = { url, list: r.checkpoints, error: null };
  render();
  clearInterval(comfyTest.t);
  if (!r?.vramTotal) return;
  comfyTest.t = setInterval(async () => {
    const el = document.getElementById('comfy-vram');
    if (!el || S.comfyTest?.url !== S.settings.comfy?.url) { clearInterval(comfyTest.t); return; }
    const v = await call('comfyStats');
    if (v?.ok && v.vramTotal) { Object.assign(S.comfyTest, { vramFree: v.vramFree, vramTotal: v.vramTotal, low: v.low }); el.textContent = `${(v.vramFree / GB).toFixed(1)} GB of ${(v.vramTotal / GB).toFixed(1)} GB graphics memory free`; }
  }, 5000);
}
// After he changed a Hearth devices setting (setSettings is called only from his clicks).
function hdAfter(r) {
  if (r && !r.message && r.hearthDevices) S.hd = { ...(S.hd || {}), settings: r.hearthDevices };
  return r;
}

// Your GPU servers: the models each one has, picked up automatically (nothing to type).
// S.svModels[id] = { loading } | { models } | { message }; S.svAdd for the Add form.
function svOptions(models, current, firstLabel) {
  const list = [...new Set([...(current ? [current] : []), ...(models || [])])];
  return `<option value="" ${current ? '' : 'selected'}>${esc(firstLabel)}</option>${list.map((m) => `<option value="${esc(m)}" ${m === current ? 'selected' : ''}>${esc(m)}${models && !models.includes(m) ? ' (not on the server now)' : ''}</option>`).join('')}`;
}
function svModelPick(sv) {
  const st = S.svModels?.[sv.id];
  if (!st || st.loading) return `<span class="d">${st ? 'finding models…' : esc(sv.model || '')}</span>`;
  const note = st.message ? `<span class="d bad" title="${esc(st.message)}">couldn't list its models</span>` : '';
  return `${note}<select data-a="sv-model-pick" data-id="${esc(sv.id)}" aria-label="Model on ${esc(sv.name)}">${svOptions(st.models, sv.model || '', sv.type === 'comfy' ? 'Pick automatically' : 'First model on the server')}</select>`;
}
function svAddModelPick() {
  const st = S.svAdd || {};
  if (st.loading) return '<span class="d">finding models…</span>';
  if (st.models) return `<select id="sv-model" aria-label="Model">${svOptions(st.models, st.pick || '', 'First model on the server')}</select>`;
  return `<input id="sv-model" placeholder="${st.message ? 'Couldn\'t list its models: type one (optional)' : 'Model: found when you type the address'}" title="${esc(st.message || '')}">`;
}
async function loadServerModels(id) {
  S.svModels = S.svModels || {};
  S.svModels[id] = { loading: true };
  const r = await call('teammatesListModels', { id });
  S.svModels[id] = r?.ok ? { models: r.models } : { message: r?.message || 'Couldn\'t list its models.' };
}
async function loadAllServerModels() {
  await Promise.all((S.mates?.servers || []).map((sv) => loadServerModels(sv.id)));
}
async function loadAddModels() {
  const v = (id) => document.getElementById(id)?.value || '';
  const url = v('sv-url').trim();
  if (!url) { S.svAdd = {}; return; }
  const keep = { name: v('sv-name'), type: v('sv-type'), url, key: v('sv-key') };
  S.svAdd = { loading: true, keep };
  render(); restoreAddForm(keep);
  const r = await call('teammatesListModels', { url, type: keep.type, key: keep.key });
  S.svAdd = r?.ok ? { models: r.models, keep } : { message: r?.message || 'Couldn\'t list its models.', keep };
  render(); restoreAddForm(keep);
}
// A render rebuilds the form: put back what he typed (the key too, only in the box).
function restoreAddForm(k) {
  if (!k) return;
  for (const [id, val] of [['sv-name', k.name], ['sv-type', k.type], ['sv-url', k.url], ['sv-key', k.key]]) { const el = document.getElementById(id); if (el && val != null) el.value = val; }
}

// "Make it sound human": the AIs that answer by API and are set up (Free AI first). What an
// uncensored teammate wrote is only ever rewritten by an uncensored teammate (never Claude,
// ChatGPT or Gemini).
function humanizeTargets(from) {
  const order = ['free', ...TEAM_IDS.filter((a) => a !== 'free')];
  return order.filter((a) => a !== 'civitai' && method(a) === 'api' && ready(a) && (!UNFILTERED.includes(from) || UNFILTERED.includes(a)));
}
function openHumanize(source, text, from = 'owner', msgId = null) {
  if (!String(text || '').trim()) return toast(source === 'draft' ? 'Type something first.' : 'This reply has no text.');
  const list = humanizeTargets(from);
  const agent = list.includes(S.humanAgent) ? S.humanAgent : list[0] || null;
  S.modal = { kind: 'humanize', source, text: String(text), from, msgId, agent, out: '', err: '', busy: false };
  renderOverlay();
  if (agent) runHumanize();
}
async function runHumanize() {
  const m = S.modal;
  if (!m || m.kind !== 'humanize') return;
  const pick = document.getElementById('hz-agent')?.value || m.agent;
  if (!humanizeTargets(m.from).includes(pick)) return;
  m.agent = pick; S.humanAgent = pick; m.busy = true; m.err = ''; renderOverlay();
  const r = await call('humanize', { text: m.text, agent: pick });
  if (S.modal !== m) return;
  m.busy = false;
  if (r?.ok) { m.out = r.text; m.via = r.via ? `Rewritten by ${r.via}` : `Rewritten by ${aiName(pick)}`; } else m.err = r?.message || 'The rewrite didn\'t come back.';
  renderOverlay();
}

async function refreshMates() {
  S.mates = (await call('teammatesStatus')) || S.mates;
  S.mkeys = (await call('mediaKeys')) || S.mkeys;
}
async function setSettings(patch) {
  const r = await call('setSettings', patch);
  if (r && !r.message && r.tools) { S.settings = r; applyTheme(); }
  else if (r?.message) toast(r.message);
  if (patch.teammates) await refreshMates();
  render();
  return r;
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

// ---------- roleplay helpers ----------
function defaultPlayer(c) {
  const L = TEAM_IDS.filter(ready).filter((a) => !AGENTS[a]?.imagesOnly);
  if (ready('venice') && !c?.limits?.minor) return 'venice';
  return L.includes(team().lead) ? team().lead : L.find((a) => !UNFILTERED.includes(a)) || L[0] || team().lead;
}
function pickFile(accept) {
  return new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => res(i.files?.[0] || null); i.click(); });
}
const fileUrl = (f) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(null); r.readAsDataURL(f); });
async function afterImport(list) {
  const good = list.filter((x) => x?.ok !== false && (x?.card || x?.lorebook));
  const bad = list.filter((x) => x?.ok === false || x?.message);
  await loadCards();
  render();
  const young = good.filter((x) => x.card?.limits?.minor).map((x) => x.card.name);
  toast([good.length ? `Imported ${good.map((x) => x.card?.name || x.lorebook?.name).join(', ')}.` : '', young.length ? `${young.join(', ')} read${young.length === 1 ? 's' : ''} as under 18: stories only, nothing sexual.` : '', bad.map((x) => x.message).join(' ')].filter(Boolean).join(' ') || 'Nothing imported.');
  if (good.length === 1 && good[0].card) { S.lastImport = good[0].card.id; }
}
function readCardForm() {
  const c = S.cardEdit;
  if (!c) return;
  for (const el of document.querySelectorAll('[data-cf]')) {
    const k = el.dataset.cf;
    if (k === 'tags') c.tags = el.value.split(',').map((x) => x.trim()).filter(Boolean);
    else if (k === 'alternate_greetings') c.alternate_greetings = el.value.split(/\n-{3,}\n/).map((x) => x.trim()).filter(Boolean);
    else if (k === 'lorebooks') c.lorebooks = [...el.selectedOptions].map((o) => o.value);
    else if (k === 'appearance') c.appearanceEdit = el.value;
    else if (k === 'ownerAge') { if (!el.disabled) c.ownerAgeEdit = el.value.trim(); }
    else c[k] = el.value;
  }
}
function readLoreForm() {
  const b = S.loreEdit;
  if (!b) return;
  for (const el of document.querySelectorAll('[data-lf]')) b[el.dataset.lf] = el.type === 'number' ? Number(el.value) : el.value;
  for (const el of document.querySelectorAll('[data-le]')) {
    const e = b.entries[Number(el.dataset.le)];
    if (!e) continue;
    const k = el.dataset.k;
    if (k === 'keys') e.keys = el.value.split(',').map((x) => x.trim()).filter(Boolean);
    else if (el.type === 'checkbox') e[k] = el.checked;
    else if (el.type === 'number') e[k] = Number(el.value);
    else e[k] = el.value;
  }
}

// ---------- events ----------
function popAt(el, kind, extra = {}) {
  const r = el.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  const up = below < 520 && r.top > below;
  S.pop = { kind, x: Math.max(8, Math.min(r.left, window.innerWidth - 440)), ...(up ? { b: window.innerHeight - r.top + 8, maxH: r.top - 16 } : { y: r.bottom + 6, maxH: below - 16 }), ...extra };
}
const msgById = (id) => S.msgs.find((x) => x.id === id);
const mediaChat = (el) => el.closest('[data-msg]') ? S.open : (S.modal?.chatId || S.open);
// Ask for a key or token in the app's own small dialog (Electron has no window.prompt, so the
// old prompt silently returned nothing and keys could never be entered). Hidden input; the value
// goes straight to the encrypted store and is never kept in the window.
function secretPrompt(label, { placeholder = 'Paste it here' } = {}) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg secret-bg';
    bg.innerHTML = `<div class="modal secret-modal" role="dialog" aria-modal="true" aria-label="${esc(label)}"><h3>${esc(label)}</h3><p class="fine">Saved encrypted on this PC. It never goes to any other AI.</p><input type="password" id="secret-in" autocomplete="off" spellcheck="false" placeholder="${esc(placeholder)}"><label class="fine"><input type="checkbox" id="secret-show"> Show</label><div class="mft"><button class="btn ghost" id="secret-cancel">Cancel</button><button class="btn p" id="secret-ok">Save</button></div></div>`;
    document.body.appendChild(bg);
    const inp = bg.querySelector('#secret-in');
    const done = (v) => { document.removeEventListener('keydown', onKey, true); bg.remove(); resolve(v); };
    const ok = () => { const v = inp.value.trim(); done(v || null); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } else if (e.key === 'Enter' && document.activeElement === inp) { e.preventDefault(); e.stopPropagation(); ok(); } };
    document.addEventListener('keydown', onKey, true);
    bg.querySelector('#secret-show').addEventListener('change', (e) => { inp.type = e.target.checked ? 'text' : 'password'; });
    bg.querySelector('#secret-cancel').addEventListener('click', (e) => { e.stopPropagation(); done(null); });
    bg.querySelector('#secret-ok').addEventListener('click', (e) => { e.stopPropagation(); ok(); });
    bg.addEventListener('click', (e) => { if (e.target === bg) done(null); });
    setTimeout(() => inp.focus(), 0);
  });
}

document.addEventListener('click', async (ev) => {
  const a = ev.target.closest('[data-a]');
  const chatEl = !a && ev.target.closest('[data-chat]');
  if (chatEl) return openChat(chatEl.dataset.chat);
  if (!a) return;
  const d = a.dataset;
  const k = d.a;
  if (a.tagName === 'SELECT' || a.tagName === 'INPUT') return;
  if (a.tagName === 'A' && a.getAttribute('target') === '_blank') return;
  ev.preventDefault();
  switch (k) {
    case 'new-chat': return goHome();
    // roleplay: characters, lorebooks, persona
    case 'characters': S.view = 'characters'; S.cardEdit = null; S.loreEdit = null; S.pane = null; render(true); await loadCards(); return render();
    case 'lorebooks': S.view = 'lorebooks'; S.loreEdit = null; render(true); S.books = (await call('loreList')) || []; return render();
    case 'card-import': { const r = await call('cardsPick'); return afterImport(r || []); }
    case 'card-new': S.cardFind = null; S.cardEdit = { name: '', tags: [], alternate_greetings: [], lorebooks: [] }; S.view = 'card'; return render(true);
    case 'card-edit': S.cardFind = null; S.cardEdit = JSON.parse(JSON.stringify(cardById(d.id) || {})); S.view = 'card'; render(true); await voice.loadLists(); return render();
    case 'card-pic': { readCardForm(); const f = await pickFile('image/png,image/jpeg,image/webp'); if (f) { const url = await fileUrl(f); S.cardEdit.avatarData = url; S.cardEdit.avatarUrl = url; } return render(); }
    case 'card-adult': case 'card-adult-undo': {
      const c = S.cardEdit; if (!c?.id) return;
      const age = Number(document.getElementById('adult-age')?.value || 0);
      if (d.a === 'card-adult' && !(age >= 18)) return toast('Give an age of 18 or more.');
      readCardForm();
      const r = await call('cardsConfirmAdult', c.id, age, d.a === 'card-adult');
      if (!r || r.ok === false || r.message) return toast(r?.message || 'Not changed.');
      S.cardEdit = { ...S.cardEdit, limits: r.limits };
      toast(d.a === 'card-adult' ? `${r.name} is confirmed as an adult (age ${r.limits?.adultConfirmed?.age}).` : `Adult confirmation removed from ${r.name}.`);
      await loadCards(); return render();
    }
    case 'card-save': {
      readCardForm(); const c = S.cardEdit; if (!String(c.name || '').trim()) return toast('Give the character a name.');
      // The age (18+) and the appearance are saved only now, with the card.
      const ageWas = c.ownerAdult?.age ? String(c.ownerAdult.age) : '';
      const age = c.ownerAgeEdit;
      if (age !== undefined && age !== '' && !(/^\d{1,3}$/.test(age) && Number(age) >= 18 && Number(age) <= 999)) return toast('Set an age from 18 to 999, or leave it empty.');
      const { appearanceEdit, ownerAgeEdit, ...patch } = c;
      const r = await call('cardsSave', patch); if (r?.ok === false || r?.message) return toast(r.message || 'Not saved.');
      const notes = [];
      if (c.voiceChanged && r?.id) { const vr = await call('cardsSetVoice', r.id, c.ownerVoice || null); if (vr?.message) notes.push(vr.message); }
      if (r?.id && appearanceEdit !== undefined && appearanceEdit !== (c.ownerLook?.appearance || '')) { const lr = await call('cardsSetLook', r.id, { appearance: appearanceEdit }); if (lr?.message) notes.push(lr.message); }
      if (r?.id && ownerAgeEdit !== undefined && ownerAgeEdit !== ageWas) { const ar = ownerAgeEdit === '' ? await call('cardsConfirmAdult', r.id, 0, false) : await call('cardsConfirmAdult', r.id, Number(ownerAgeEdit), true); if (ar?.message) notes.push(ar.message); }
      toast([`Saved ${r.name}.`, ...notes].join(' ')); await loadCards(); S.cardEdit = null; S.cardFind = null; S.view = 'characters'; return render(true);
    }
    case 'cf-open': return cfOpen();
    case 'cf-close': return cfClose();
    case 'cf-next': return cfStep(1);
    case 'cf-prev': return cfStep(-1);
    case 'cf-goto': { const F = S.cardFind; if (!F) return; cfRun(false); const i = F.flat.findIndex((m) => m.key === d.f); if (i >= 0) { F.i = i; cfRun(true); } return; }
    case 'cf-rep1': return cfReplaceOne();
    case 'cf-repall': return cfReplaceAll();
    case 'flag-jump': return flagJump(d.f, d.w);
    case 'flag-why': {
      const c = d.id ? cardById(d.id) : S.cardEdit;
      const r0 = (c?.limits?.reasons || []).find((x) => x.field !== 'age');
      if (d.id && S.view !== 'card') { S.cardEdit = JSON.parse(JSON.stringify(c || {})); S.cardFind = null; S.view = 'card'; render(true); }
      if (r0) flagJump(r0.field, r0.words); else toast(c?.limits?.minorWhy ? `Flagged because ${c.limits.minorWhy}.` : 'Nothing to show.');
      return;
    }
    case 'coll-view': S.cardColl = d.id || ''; S.collSel = []; return renderMain();
    case 'coll-new': {
      const el = document.getElementById('coll-new'); const name = String(el?.value || '').trim();
      if (!name) { el?.focus(); return toast('Type a name for the collection first.'); }
      const r = await call('cardsCollectionNew', name); if (!r || r.ok === false || r.message) return toast(r?.message || 'Not made.');
      await loadColls(); toast(`Made the collection “${r.name}”. Add characters with “Add to collection…” on each card.`); return renderMain();
    }
    case 'coll-sel-all': { const cc = (S.colls || []).find((x) => x.id === S.cardColl); if (!cc) return; const shown = cc.cardIds.filter((id) => { const c = cardById(id); return c && cardMatches(c, S.cardQuery); }); S.collSel = S.collSel.length && S.collSel.length === shown.length ? [] : shown; return renderMain(); }
    case 'coll-remove-one': return collRemove([d.id]);
    case 'coll-remove-sel': return collRemove(S.collSel);
    case 'card-export': { const r = await call('cardsExport', d.id, d.f); if (r?.ok) toast(`Exported to ${r.file}.`); else if (r && !r.cancelled) toast(r.message || 'Not exported.'); return; }
    case 'find-chars': S.findSites = (await call('cardsFindSites')) || S.findSites; S.modal = { kind: 'find' }; return renderOverlay();
    case 'find-open': { const r = await call('cardsFindOpen', d.v); if (r?.ok === false) toast(r.message || 'Couldn\'t open it.'); return; }
    case 'found-dismiss': S.found = S.found.filter((x) => x.key !== d.v); return render();
    case 'card-chat': { const c = cardById(d.id); if (!c) return; const pl = defaultPlayer(c); S.modal = { kind: 'rpstart', chars: [c.id], players: { [c.id]: pl }, order: 'natural', lorebooks: [] }; return renderOverlay(); }
    case 'lore-from-card': { const r = await call('loreFromCard', d.id); if (r?.ok) { toast(`Copied to Lorebooks as “${r.book.name}”.`); S.books = (await call('loreList')) || []; render(); } else toast(r?.message || 'Not copied.'); return; }
    case 'lore-new': S.loreEdit = { name: 'New lorebook', scan_depth: 4, token_budget: 1024, entries: [] }; return render(true);
    case 'lore-edit': S.loreEdit = JSON.parse(JSON.stringify((S.books || []).find((b) => b.id === d.id) || {})); return render(true);
    case 'lore-add-entry': readLoreForm(); S.loreEdit.entries = [...(S.loreEdit.entries || []), { name: '', keys: [], content: '', insertion_order: 100, constant: false, enabled: true }]; return render();
    case 'lore-del-entry': readLoreForm(); S.loreEdit.entries.splice(Number(d.i), 1); return render();
    case 'lore-save': { readLoreForm(); const r = await call('loreSave', S.loreEdit); if (r?.ok === false || r?.message) return toast(r.message || 'Not saved.'); toast(`Saved ${r.name}.`); S.loreEdit = null; S.books = (await call('loreList')) || []; return render(true); }
    case 'lore-import': { const f = await pickFile('application/json,.json'); if (!f) return; const r = await call('loreImport', f.name, await f.arrayBuffer()); if (r?.ok === false || r?.message) toast(r.message || 'Not imported.'); else toast(`Imported ${r.name} (${r.entries.length} entries).`); S.books = (await call('loreList')) || []; return render(); }
    case 'lore-export': { const r = await call('loreExport', d.id); if (r?.ok) toast(`Exported to ${r.file}.`); else if (r && !r.cancelled) toast(r.message || 'Not exported.'); return; }
    case 'lore-remove': await call('loreRemove', d.id); S.books = (await call('loreList')) || []; return render();
    case 'persona-edit': S.modal = { kind: 'persona', ...(S.persona || {}) }; return renderOverlay();
    case 'persona-pic': { S.modal.name = document.getElementById('pe-name')?.value ?? S.modal.name; S.modal.description = document.getElementById('pe-desc')?.value ?? S.modal.description; const f = await pickFile('image/png,image/jpeg,image/webp'); if (f) { const url = await fileUrl(f); S.modal.avatarData = url; S.modal.avatarUrl = url; } return renderOverlay(); }
    case 'persona-save': { const r = await call('rpSetPersona', { name: document.getElementById('pe-name')?.value || '', description: document.getElementById('pe-desc')?.value || '', ...(S.modal.avatarData ? { avatarData: S.modal.avatarData } : {}) }); S.modal = null; if (r?.ok === false || r?.message) toast(r.message || 'Not saved.'); else S.persona = r; return render(); }
    case 'rp-start-do': return startRoleplay(S.modal);
    case 'rp-reply-as': { const R = cur(); if (!R || R.round) return toast('Wait for the current reply.'); runner.start(R, '', { char: d.id }); return; }
    case 'rp-impersonate': { const R = cur(); if (!R || R.round) return toast('Wait for the current reply.'); runner.start(R, '', { impersonate: true }); return; }
    case 'rp-continue': { const R = cur(); if (!R || R.round) return; runner.start(R, '', { cont: d.m }); return; }
    case 'rp-swipe': return rpSwipe(d.m, Number(d.d) === 99 ? 999 : Number(d.d));
    case 'rp-edit-save': { const m = msgById(d.m); const v = document.getElementById('edit-text')?.value; if (m && typeof v === 'string') { m.text = v; if (Array.isArray(m.swipes)) m.swipes[m.sw ?? 0] = v; } S.editing = null; await save(); return render(); }
    case 'rp-vn': { const R = cur(); if (R) R.vn = !R.vn; return render(true); }
    case 'rp-picture': S.modal = { kind: 'rppic', chatId: S.open }; return renderOverlay();
    case 'rp-scene': return openScene(S.open);
    case 'rs-chars': case 'rs-rebuild': { const m = S.modal; if (m?.kind !== 'rpscene') return; m.ids = [...document.querySelectorAll('.rsc:checked')].map((x) => x.value); const pr = await call('rpScenePrompt', m.ids, sceneMsgs(m.chatId)); m.prompt = pr?.prompt || m.prompt; return renderOverlay(); }
    case 'rs-look-save': { const m = S.modal; const keep = document.getElementById(`rs-keep-${d.id}`)?.checked !== false; const seed = (document.getElementById('rs-seed')?.value || '').trim(); const r = await call('cardsSetLook', d.id, { appearance: document.getElementById(`rs-look-${d.id}`)?.value || '', keepSeed: keep, ...(seed && m?.ids?.[0] === d.id ? { seed: Number(seed) } : {}) }); if (r?.ok === false || r?.message) { toast(r.message || 'Not saved.'); return; } await loadCards(); toast(`Saved ${r.name}'s look.`); if (m?.kind === 'rpscene') { if (m.ids[0] === d.id) m.seedSaved = Boolean(seed); const pr = await call('rpScenePrompt', m.ids, sceneMsgs(m.chatId)); m.prompt = pr?.prompt || m.prompt; } return renderOverlay(); }
    case 'rs-reroll': { const m = S.modal; const r = await call('cardsSetLook', d.id, { reroll: true }); if (r?.ok === false || r?.message) { toast(r.message || 'Not changed.'); return; } await loadCards(); if (m?.kind === 'rpscene' && m.ids[0] === d.id) { m.seed = r.ownerLook?.seed ?? m.seed; m.seedSaved = true; } toast(`New seed for ${r.name}: ${r.ownerLook?.seed}.`); return renderOverlay(); }
    case 'rs-go': return makeSceneNow();
    case 'rp-pic-do': { const m = S.modal; const R = rt(m.chatId); const kind = document.querySelector('input[name="rpk"]:checked')?.value || 'portrait'; const ids = [...document.querySelectorAll('.rpc:checked')].map((x) => x.value); const note = document.getElementById('rp-note')?.value || ''; const provider = document.getElementById('rp-maker')?.value || ''; S.modal = null; renderOverlay(); R.busy = { agent: provider, role: 'member', runId: `pic${uid()}`, steps: [{ kind: 'image', label: kind === 'scene' ? 'Making a scene picture' : 'Making a portrait', detail: aiName(provider) }], startedAt: Date.now() }; render(); const r = await call('rpImage', m.chatId, { kind, cardIds: ids, note, provider }); R.busy = null; runner.post(R, r?.ok ? { who: provider, text: `${kind === 'scene' ? 'Scene' : 'Portrait'}${note ? `: ${note}` : ''}`, via: r.via, media: r.items || [] } : r?.error?.kind === 'minor' || r?.error?.kind === 'real' ? { who: 'system', block: true, text: r.error.message } : { who: provider, err: true, text: r?.error?.message || r?.message || 'No picture came back.' }); await saveRt(R); return render(); }
    case 'temp-chat': return startTemp();
    case 'temp-end': ev.stopPropagation(); return endTemp(d.id);
    case 'studio': return openStudio();
    case 'reverse': return openReverse();
    case 'desk-ans': { await call('desktopAnswer', d.id, d.v); S.deskAsks = (S.deskAsks || []).filter((a) => a.id !== d.id); return renderOverlay(); }
    case 're-onoff': { const r = await call('reverseSetEnabled', d.v === '1'); if (r?.ok === false || r?.message) toast(r.message || 'Not saved.'); return openReverse(); }
    case 're-ghidra': { const r = await call('reversePickGhidra'); if (r && !r.canceled && (r.ok === false || r.message)) toast(r.message || 'Not saved.'); return openReverse(); }
    case 're-ghidra-clear': await call('reverseClearGhidra'); return openReverse();
    case 're-new': { const r = await call('reverseNewProject'); if (!r || r.canceled) return; if (r.ok === false || r.message) return toast(r.message || 'Not saved.'); S.re = await call('reverseStatus'); return openReChat(r.chat.id, r.first); }
    case 're-open': return openReChat(d.id);
    case 're-remove': await call('reverseRemoveProject', d.id); return openReverse();
    case 'unc-on': { const r = await setSettings({ uncensored: { on: !(S.settings.uncensored?.on === true) } }); if (S.studio.data && r?.uncensored) S.studio.data = { ...S.studio.data, uncensored: r.uncensored.on }; return render(); }
    case 'st-kind': stSync(); S.studio.f.kind = d.v === 'video' ? 'video' : 'image'; S.studio.f.size = ''; return render();
    case 'st-more': stSync(); S.studio.f.more = !S.studio.f.more; return render();
    case 'st-filter': stSync(); S.studio.filter = d.v; return render();
    case 'st-show': stSync(); S.studio.shown.add(d.id); return render();
    case 'st-refresh': return stStatus(true);
    case 'st-start-none': stSync(); S.studio.f.start = null; S.studio.f.startName = ''; return render();
    case 'st-start-file': { stSync(); const r = await call('studioPickImage'); if (r?.ok) { S.studio.f.start = r.token; S.studio.f.startName = r.name; } else if (r?.message) toast(r.message); return render(); }
    case 'st-animate': { stSync(); const it = (S.studio.data?.items || []).find((x) => x.id === d.id); if (!it) return; Object.assign(S.studio.f, { kind: 'video', size: '', start: `item:${it.id}`, startName: it.prompt.slice(0, 60) }); render(); document.getElementById('st-prompt')?.focus(); return; }
    case 'st-make': {
      stSync();
      const req = requestFrom(S.studio.f, document);
      if (!req.prompt) { toast(`Say what the ${req.kind === 'video' ? 'video' : 'picture'} should show.`); return; }
      const r = await call('studioAdd', req);
      if (!r?.ok) { toast(r?.message || r?.error?.message || 'Not started.'); return; }
      toast(r.jobs.length > 1 ? `${r.jobs.length} pictures are on their way.` : `Your ${req.kind === 'video' ? 'video' : 'picture'} is on its way.`);
      return;
    }
    case 'st-cancel': { const r = await call('studioCancel', d.id); if (r && !r.ok && r.message) toast(r.message); return; }
    case 'st-again': { const r = await call('studioAgain', d.id); toast(r?.ok ? 'Again, with a new seed.' : r?.message || 'Not started.'); return; }
    case 'st-remove': { if (!confirm('Delete this from Images & Videos? The file is removed too.')) return; const r = await call('studioRemove', d.id); if (r && !r.ok) toast(r.message || 'Not deleted.'); return; }
    case 'st-save': { const it = (S.studio.data?.items || []).find((x) => x.id === d.id); if (!it) return; const r = await call('mediaSave', 'studio', it.file, it.file.replace(/^[0-9a-f]{10}-/, '')); if (r?.ok) toast(`Saved to ${r.file}`); else if (r && !r.cancelled) toast(r.message || 'Not saved.'); return; }
    case 'st-send': {
      const r = await call('studioToAttach', d.id);
      if (!r?.ok) { toast(r?.message || 'Couldn\'t add it.'); return; }
      S.attach.push(r.att);
      if (S.lastChat && entry(S.lastChat)) { await openChat(S.lastChat); toast('Added to the message box of your last chat.'); } else { goHome(); toast('Added to the message box: write your message and send.'); }
      return;
    }
    case 'habitat': S.view = 'habitat'; S.pane = null; S.pop = null; if (!S.habitat) { const h = await call('habitatGet'); S.habitat = h?.store || null; } return render(true);
    case 'settings': S.view = 'settings'; S.pane = null; render(true); return loadSection(S.tab);
    case 'tab': S.tab = d.t; render(); return loadSection(d.t);
    case 'missing-hide': { try { localStorage.setItem('hearth.v2.missingHidden', missingList().join(',')); } catch {} render(); return; }
    case 'chat-menu': ev.stopPropagation(); { const r = a.getBoundingClientRect(); S.pop = { kind: 'menu', id: d.id, x: Math.min(r.left, window.innerWidth - 260), y: Math.min(r.bottom + 4, window.innerHeight - 400) }; } return renderOverlay();
    case 'chat-act': return chatAction(d.k, d.id);
    case 'close-pop': S.pop = null; S.pickRepo = null; S.pickBranch = null; return renderOverlay();
    case 'close-modal': S.modal = null; return renderOverlay();
    case 'humanize-draft': return openHumanize('draft', document.getElementById('composer')?.value ?? S.draft);
    case 'humanize-msg': { const m = msgById(d.m); return m ? openHumanize('msg', m.text, m.who, m.id) : undefined; }
    case 'humanize-run': return runHumanize();
    case 'humanize-copy': { const t = document.getElementById('hz-out')?.value ?? S.modal?.out ?? ''; try { await navigator.clipboard.writeText(t); toast('Copied.'); } catch { toast('Couldn\'t copy.'); } return; }
    case 'humanize-use': { const t = document.getElementById('hz-out')?.value ?? S.modal?.out ?? ''; S.modal = null; S.draft = t; render(true); focusComposer(); return toast('Put in your message box. Nothing is sent until you press Send.'); }
    case 'rename-save': return finishRename(true);
    case 'toggle-hidden': S.showHidden = !S.showHidden; return renderSide();
    case 'toggle-trash': S.showTrash = !S.showTrash; return renderSide();
    case 'unhide': await call('chatsUpdate', d.id, { hidden: false }); await loadChats(); return render();
    case 'restore': { const r = await call('chatsRestore', d.id); if (r?.ok === false || r?.message) toast(r.message || 'Not restored.'); await loadChats(); return render(); }
    case 'undo': { const u = S.toast?.undo; S.toast = null; if (u?.kind === 'coll-restore') { const r = await call('cardsCollectionRestore', u.coll, u.ids, u.before); await loadColls(); renderMain(); toast(r?.message ? r.message : `Put back in “${u.name}”.`); return renderOverlay(); } if (u?.kind === 'restore') { await call('chatsRestore', u.trashId); await loadChats(); render(); toast('Restored.'); } return renderOverlay(); }
    case 'repo-pop': S.pick = null; S.repoQuery = ''; S.pickRepo = null; S.pickBranch = null; popAt(a, 'repo', { chatId: S.view === 'chat' ? S.open : null }); renderOverlay(); await loadRepos(); { const c = S.view === 'chat' ? entry() : null; const cr = c?.repo || S.conn?.repo || S.repos?.[0]?.full; if (cr) loadBranches(cr); } return;
    case 'pick-repo': S.pickRepo = d.r; S.pickBranch = null; S.pop.noFocus = true; renderOverlay(); await loadBranches(d.r); return;
    case 'connect-repo': { const c = S.pop?.chatId ? entry(S.pop.chatId) : S.view === 'chat' ? entry() : null; const sel = S.pickRepo || c?.repo || S.conn?.repo || (S.repos || [])[0]?.full; const b = document.getElementById('branch-sel')?.value || null; S.pickRepo = null; return chooseRepo(sel, b); }
    case 'no-repo': S.pickRepo = null; return chooseRepo(null, null);
    case 'team-pop': popAt(a, 'team', { top: a.classList.contains('tb') }); return renderOverlay();
    case 'options-pop': popAt(a, 'options'); return renderOverlay();
    case 'set-mode': S.mode = d.v; S.pop = null; keepPrefs(); return render();
    case 'toggle-web': S.web = !S.web; keepPrefs(); return render();
    case 'toggle-build': S.build = !S.build; keepPrefs(); return render();
    case 'toggle-deep': S.deep = !S.deep; if (S.deep) S.web = true; S.pop = null; keepPrefs(); return render();
    case 'toggle-talk': S.pop = null; if (voice.isOpen()) voice.closeView(); else openTalk(); return render();
    case 'talk': return openTalk();
    case 'voice-close': return voice.closeView();
    case 'voice-settings': voice.closeView(); S.view = 'settings'; S.tab = 'voice'; render(true); return loadSection('voice');
    case 'voice-turn': voice.setTurn(d.v); return setSettings({ voice: { turn: d.v } });
    case 'voice-barge': { const on = !voiceSettings(S.settings).bargeIn; voice.setBarge(on); return setSettings({ voice: { bargeIn: on } }); }
    case 'voice-set': if (d.v) { await setSettings({ voice: { [d.k]: d.v } }); return loadSection('voice'); } return;
    case 'voice-keep': return setSettings({ voice: { keepAudio: !voiceSettings(S.settings).keepAudio } });
    case 'voice-uncensored': {
      const on = !voiceSettings(S.settings).openaiForUncensored;
      if (on && !window.confirm?.('Allow OpenAI for Venice, Civitai and your GPU server?\n\nTheir replies would then be sent to OpenAI to be spoken (and your voice, in chats only with them, to be turned into text). They are otherwise never sent to Claude, OpenAI or Google.')) return;
      return setSettings({ voice: { openaiForUncensored: on } });
    }
    case 'voice-key': { const el = document.getElementById(`vkey-${d.k}`); const k2 = String(el?.value || '').trim(); if (!k2) return toast('Paste the key into the box first.'); if (el) el.value = ''; const r = await call('mediaSetKey', d.k, k2.trim()); toast(r?.ok ? 'Saved, encrypted on this PC.' : r?.message || 'Not saved.'); await refreshMates(); return loadSection('voice'); }
    case 'voice-key-remove': await call('mediaRemoveKey', d.k); await refreshMates(); return loadSection('voice');
    case 'voice-preview': return previewVoice(d.k, d.prov, d.who);
    // Speech servers (Settings › Voice). Saved only from his clicks; the key goes to the encrypted store.
    case 'vsrv-add': voice.state.srvErr = ''; voice.state.srvForm = { api: 'kokoro-fastapi', voices: [], extras: {} }; return render();
    case 'vsrv-edit': { const x = voiceSettings(S.settings).servers.find((q) => q.id === d.id); if (!x) return; voice.state.srvErr = ''; voice.state.srvForm = JSON.parse(JSON.stringify(x)); return render(); }
    case 'vsrv-cancel': voice.state.srvForm = null; voice.state.srvErr = ''; return render();
    case 'vsrv-save': {
      const f = voice.readServerForm();
      if (!f) return;
      if (!String(f.url || '').trim()) { voice.state.srvErr = 'Type the server\'s address, like http://localhost:8880 or http://100.64.0.5:8880.'; return render(); }
      const isNew = !f.id;
      const id = f.id || [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');
      const r = await setSettings({ voice: { servers: voice.serverPatch(f, id) } });
      if (r?.message || !r) { voice.state.srvErr = r?.message || 'Not saved.'; return render(); }
      voice.state.srvErr = '';
      if (f.key) { const kr = await call('voiceServerKey', id, f.key); if (!kr?.ok) { voice.state.srvForm = { ...f, id, key: undefined }; voice.state.srvErr = `The server was saved, but not its key: ${kr?.message || 'unknown error'}`; await voice.loadStatus(); return render(); } }
      voice.state.srvForm = null;
      toast(isNew ? `Added ${f.name || 'the speech server'}. Press Test to check it.` : 'Saved.');
      await voice.loadStatus(); await voice.loadList(`server:${id}`, true);
      return render();
    }
    case 'vsrv-key-remove': { const r = await call('voiceServerKey', d.id, null); toast(r?.ok ? 'Key removed.' : r?.message || 'Not removed.'); await voice.loadStatus(); return render(); }
    case 'vsrv-remove': {
      const x = voiceSettings(S.settings).servers.find((q) => q.id === d.id);
      if (!x || !window.confirm?.(`Remove ${x.name}?\n\nIts key and any voice clips saved for it are removed from this PC too. Nothing on the server itself is changed.`)) return;
      const r = await setSettings({ voice: { servers: { [d.id]: null } } });
      if (r?.message || !r) return;
      await call('voiceServerForget', d.id);
      delete voice.state.srvTest[d.id];
      if (voice.state.srvForm?.id === d.id) voice.state.srvForm = null;
      await voice.loadStatus();
      return render();
    }
    case 'vsrv-test': {
      voice.state.srvTest[d.id] = { busy: true }; render();
      const r = await call('voiceServerTest', d.id);
      voice.state.srvTest[d.id] = r?.ok ? { ok: true, voices: r.voices, voice: r.voice, ms: r.ms, warning: r.warning } : { ok: false, step: r?.step, message: r?.message || 'No answer.' };
      if (r?.ok) { await voice.loadList(`server:${d.id}`); voice.playAudio(r.audio, r.mime); }
      return render();
    }
    case 'vsrv-clone': {
      const sid = document.getElementById('sclone-server')?.value || '';
      const name = document.getElementById('sclone-name')?.value || '';
      const transcript = document.getElementById('sclone-text')?.value || '';
      const consent = Boolean(document.getElementById('sclone-consent')?.checked);
      if (!consent) return toast('Tick the box first: only your own voice, or one you have permission to use.');
      if (!name.trim()) return toast('Give the voice a name.');
      const r = await call('voiceServerClone', { id: sid, name, transcript, consent: true });
      if (r?.cancelled) return;
      toast(r?.ok ? `Added “${r.voice.name}” to the server's voices.` : r?.message || 'Not added.');
      if (r?.ok) { await voice.loadList(`server:${sid}`, true); render(); }
      return;
    }
    case 'voice-clone': {
      const name = document.getElementById('clone-name')?.value || '';
      const consent = Boolean(document.getElementById('clone-consent')?.checked);
      if (!consent) return toast('Tick the box first: only your own voice, or one you have permission to use.');
      if (!name.trim()) return toast('Give the voice a name.');
      toast('Sending the recordings to ElevenLabs…');
      const r = await call('voiceClone', { name, consent: true });
      if (r?.cancelled) return;
      toast(r?.ok ? `Added “${r.voice.name}” to your ElevenLabs voices${r.requiresVerification ? ' (ElevenLabs asks you to verify it on its website first)' : ''}.` : r?.message || 'Not added.');
      if (r?.ok) { await voice.loadList('elevenlabs', true); render(); }
      return;
    }
    case 'toggle-pane': if (S.pane) { S.pane = null; } else { const m = [...S.msgs].reverse().find((x) => x.previews?.length); if (m) return openPane(m.id, m.previews[0].id); toast('No live preview or canvas in this chat yet.'); } return render();
    case 'attach': { const r = await call('attachPickAny'); for (const x of r || []) { if (x?.ok) S.attach.push(x.att); else if (x?.message) toast(x.message); } return render(); }
    case 'unattach': S.attach.splice(Number(d.i), 1); return render();
    case 'voice': return toggleVoice();
    case 'send': return send();
    case 'stop': return stopRun();
    case 'turn-retry': { const R = cur(); if (R && !R.round) runner.retry(R, d.v); return; }
    case 'team-test-go': S.pop = null; renderOverlay(); S.view = 'settings'; S.tab = 'team'; render(true); return runTeamTest();
    case 'team-test': return runTeamTest();
    case 'agy-setup': { const r = await call('permsAgySetup'); toast(r?.message || (r?.ok ? 'Done.' : 'Not changed.')); return loadPerms(); }
    case 'perms-refresh': return loadPerms(true);
    case 'follow': { const m = msgById(d.m); const f = m?.followUps?.[Number(d.i)]; if (f) send(f); return; }
    case 'quick': { const q = QUICK[Number(d.i)]; S.draft = q[2]; render(); focusComposer(); return; }
    case 'dismiss': S.notices.splice(Number(d.i), 1); return render();
    case 'open-data': S.view = 'settings'; S.tab = 'data'; render(); return loadSection('data');
    // message controls
    case 'msg-copy': { const m = msgById(d.m); if (m) { try { await navigator.clipboard.writeText(String(m.text || '')); toast('Copied.'); } catch { toast('Couldn\'t copy.'); } } return; }
    case 'msg-read': return readAloud(msgById(d.m));
    case 'msg-retry': return regenerate(d.m);
    case 'msg-edit': S.editing = d.m; return render();
    case 'edit-cancel': S.editing = null; return render();
    case 'edit-send': return resendEdited(d.m, document.getElementById('edit-text')?.value || '');
    case 'ver': return switchVersion(d.m, Number(d.d));
    case 'branch': return switchBranch(d.m, Number(d.d));
    case 'copy-code': { const code = a.closest('.codeblock')?.querySelector('code')?.innerText || ''; try { await navigator.clipboard.writeText(code); a.textContent = 'Copied'; setTimeout(() => { a.textContent = 'Copy'; }, 1500); } catch { toast('Couldn\'t copy.'); } return; }
    case 'code-canvas': return codeToCanvas(a);
    // pictures, videos, files
    case 'lightbox': S.modal = { kind: 'lightbox', src: d.src, file: d.f || null, name: d.n || '', chatId: S.open }; return renderOverlay();
    // The gallery: one full picture at a time (a message's pictures, or the whole chat's).
    case 'gallery': { const msg = d.m ? msgById(d.m) : null; const items = galleryItems(msg ? [msg] : S.msgs); if (!items.length) return toast('No pictures in this chat yet.'); S.modal = { kind: 'gallery', items, i: Math.min(items.length - 1, Number(d.i) || 0), zoom: 1, chatId: S.open }; renderOverlay(); galleryFocus(); return; }
    case 'gal-prev': case 'gal-next': case 'gal-zoom': case 'gal-zoom-toggle': { if (S.modal?.kind !== 'gallery') return; galleryDo(k === 'gal-prev' ? 'prev' : k === 'gal-next' ? 'next' : k === 'gal-zoom' ? (d.d === '1' ? 'in' : 'out') : 'toggle'); return; }
    case 'media-browser': { const r = await call('mediaOpenBrowser', mediaChat(a), d.f); if (r && !r.ok) toast(r.message || 'Couldn\'t open it.'); return; }
    case 'media-reveal': { const r = await call('mediaReveal', mediaChat(a), d.f); if (r && !r.ok) toast(r.message || 'Couldn\'t show it.'); return; }
    case 'media-reveal-src': { const r = await call('mediaRevealSource', mediaChat(a), d.src); if (r && !r.ok) toast(r.message || 'Couldn\'t show it.'); return; }
    case 'copy-cancel': { const p = S.copying; if (!p) return; if (p.attach) await call('attachCancel'); else if (p.fetch) await call('mediaCancelFetch', p.chatId); else await call('chatCancel', p.chatId); return; }
    case 'media-save': { const r = await call('mediaSave', mediaChat(a), d.f, d.n); if (r?.ok) toast(`Saved ${r.file}.`); else if (r && !r.cancelled) toast(r.message || 'Not saved.'); return; }
    case 'media-open': { const r = await call('mediaOpen', mediaChat(a), d.f); if (r && !r.ok) toast(r.message || 'Couldn\'t open it.'); return; }
    case 'media-repo': { const c = entry(mediaChat(a)); if (!c?.repo && !c?.repoDir) return toast('Connect this chat to a repo first (the repo chip above the box).'); S.modal = { kind: 'mediarepo', chatId: c.id, file: d.f, name: d.n, path: `assets/${d.n}` }; return renderOverlay(); }
    case 'load-remote': { const msgEl = a.closest('[data-msg]'); const m = msgById(msgEl?.dataset.msg); a.disabled = true; a.textContent = 'Loading…'; const r = await call('mediaFetchRemote', S.open, d.url); if (r?.ok && r.item && m) { m.media = [...(m.media || []), r.item]; await save(); render(); } else toast(r?.message || 'Couldn\'t load that picture.'); return; }
    // previews and the canvas
    case 'open-preview': return openPane(d.m, d.p);
    case 'open-canvas': return openPane(d.m, d.p, 'canvas');
    case 'open-preview-name': { const m = a.closest('[data-msg]'); const msg = msgById(m?.dataset.msg); const p = msg?.previews?.find((x) => x.name === d.name); if (p) openPane(msg.id, p.id); return; }
    case 'download-preview': { const p = previewOf(d.m, d.p); if (p) { const r = await call('previewDownload', p.name, p.content); if (r === null) { const blob = new Blob([p.content], { type: 'text/plain' }); const u = URL.createObjectURL(blob); const l = document.createElement('a'); l.href = u; l.download = p.name; l.click(); URL.revokeObjectURL(u); } else if (r?.ok) toast(`Saved ${r.file}.`); } return; }
    case 'save-preview': return savePreviewToRepo(d.m, d.p);
    case 'saveto-do': { const m = S.modal; const rel = document.getElementById('saveto-path')?.value || m.path; S.modal = null; let r; if (m.kind === 'mediarepo') r = await call('mediaToRepo', m.chatId, m.file, rel); else { const p = previewOf(m.msgId, m.pid); r = await call('chatSaveFile', S.open, rel, p?.content || ''); } toast(r?.ok ? `Saved ${r.path || rel} in the chat's branch (committed as you). Push or open a pull request to put it on GitHub.` : r?.message || 'Not saved.'); if (r?.ok && S.open) { const R = cur(); if (R) R.copy = await call('copiesStatus', S.open); } return render(); }
    case 'pane-tab': S.pane.tab = d.t; return renderPane(true);
    case 'pane-reload': S.pane.n = (S.pane.n || 0) + 1; return renderPane(true);
    case 'pane-close': S.pane = null; { const R = cur(); if (R) R.canvas = null; } return render();
    case 'canvas-save': { const p = previewOf(S.pane.msgId, S.pane.pid); const v = document.getElementById('canvas-text')?.value; if (p && typeof v === 'string' && v !== p.content) { p.versions = [...(p.versions || []), p.content].slice(-10); p.content = v; await save(); const tab = S.pane.tab; await openPane(S.pane.msgId, S.pane.pid, tab); toast('Saved this version in the chat.'); } return; }
    case 'canvas-ask': { const p = previewOf(S.pane.msgId, S.pane.pid); const v = document.getElementById('canvas-text')?.value; if (p && typeof v === 'string' && v !== p.content) { p.versions = [...(p.versions || []), p.content].slice(-10); p.content = v; await save(); } const R = cur(); if (R) R.canvas = { msgId: S.pane.msgId, pid: S.pane.pid }; render(); focusComposer(); return; }
    case 'card-diff': return cardAction('diff', d.m);
    case 'card-push': return cardAction('push', d.m);
    case 'card-pr': return cardAction('pr', d.m);
    case 'card-merge': return cardAction('merge', d.m);
    case 'fix-failure': { const m = msgById(d.m); const f = m?.actions?.failure; S.draft = `GitHub Actions failed on ${m?.actions?.branch}${f?.job ? ` (${f.job.name}${f.job.step ? ` › ${f.job.step}` : ''})` : ''}. Fix it and push again.${f?.annotations?.length ? `\n\nErrors:\n${f.annotations.slice(0, 8).map((x) => `- ${x.path}${x.line ? `:${x.line}` : ''} ${x.message}`).join('\n')}` : ''}`; render(); focusComposer(); return; }
    case 'act-yes': return decideAct(d.id, true);
    case 'act-no': return decideAct(d.id, false);
    case 'memo-yes': return decideMemo(d.m, d.id, true);
    case 'memo-no': return decideMemo(d.m, d.id, false);
    case 'export-do': { const id = S.modal?.chatId; S.modal = null; renderOverlay(); if (id) await exportChat(id, d.f); return; }
    case 'know-add': { const r = await call('attachPickAny'); for (const x of r || []) { if (x?.ok) S.modal.refs.push({ name: x.att.name, path: x.att.path, kind: x.att.kind }); else if (x?.message) toast(x.message); } S.modal.instructions = document.getElementById('know-text')?.value ?? S.modal.instructions; return renderOverlay(); }
    case 'know-unref': S.modal.instructions = document.getElementById('know-text')?.value ?? S.modal.instructions; S.modal.refs.splice(Number(d.i), 1); return renderOverlay();
    case 'know-save': { const m = S.modal; const r = await call('chatsKnowledge', m.chatId, { instructions: document.getElementById('know-text')?.value || '', refs: m.refs }); S.modal = null; if (r?.ok === false || r?.message) toast(r.message || 'Not saved.'); else toast('Saved. Every AI in this chat gets them from the next message.'); await loadChats(); return render(); }
    case 'unpushed-push': { const m = S.modal; S.modal = null; render(); const r = await call('chatPush', m.chatId); if (!r?.ok) return toast(r?.message || 'Not pushed.'); toast(`Pushed ${r.branch}. Your work is safe on GitHub.`); if (m.then === 'delete') return deleteChat(m.chatId); if (m.then === 'connect') { S.pop = { chatId: m.chatId }; return chooseRepo(m.conn?.repo || null, m.conn?.branch || null); } return closeCopy(m.chatId); }
    case 'unpushed-force': { const m = S.modal; S.modal = null; render(); if (m.then === 'delete') return deleteChat(m.chatId, { force: true }); const r = await call('copiesRemove', m.chatId, true); if (!r?.ok) { if (!r?.cancelled) toast(r?.message || 'Kept.'); return; } if (m.then === 'connect') { S.pop = { chatId: m.chatId }; return chooseRepo(m.conn?.repo || null, m.conn?.branch || null); } await loadChats(); if (S.copies) await loadCopies(); return render(); }
    // settings (each one only from the owner's own click)
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
    case 'notify-toggle': return setSettings({ notify: S.settings.notify === false });
    case 'auto-read': return setSettings({ autoRead: !S.settings.autoRead });
    case 'save-ci': return setSettings({ customInstructions: { about: document.getElementById('ci-about')?.value || '', style: document.getElementById('ci-style')?.value || '' } });
    case 'civitai-fields': return setSettings({ teammates: { civitai: { fields: document.getElementById('civitai-fields')?.value || '' } } });
    case 'edit-identity': S.editIdentity = !S.editIdentity; return render();
    case 'save-identity': { const name = document.getElementById('id-name')?.value; const email = document.getElementById('id-email')?.value; S.editIdentity = false; await setSettings({ ownerIdentity: { name, email } }); await call('opsIdentityApply'); return; }
    case 'gh-login': { const r = await call('gitLogin'); toast(r?.ok ? 'GitHub sign-in opened in a terminal. Come back and press Re-check when done.' : r?.message || 'Couldn\'t start the sign-in.'); setTimeout(async () => { S.gh = (await call('gitTools')) || S.gh; S.repos = null; render(); }, 20000); return; }
    case 'install': { const r = await call('agentInstall', d.v); toast(r?.ok ? 'Installing in a terminal. Press Re-check when it\'s done.' : r?.message || 'Couldn\'t start the install.'); return; }
    case 'signin': { const r = await call('agentLogin', d.v); toast(r?.ok ? 'Sign-in opened in a terminal. Press Re-check when done.' : r?.message || 'Couldn\'t start the sign-in.'); return; }
    case 'recheck': S.cli[d.v] = (await call('agentStatus', d.v)) || {}; return render();
    case 'secrets-recheck': { S.prov = (await call('providerStatus')) || S.prov; render(); return toast(S.prov.encryption ? 'A keyring answered: keys can be saved now.' : 'Still no keyring. Unlock or install GNOME Keyring or KWallet, or use basic protection.'); }
    case 'secrets-basic': {
      const on = d.v === 'on';
      if (on && !confirm('Use basic protection for your keys? This PC has no keyring, so keys are then protected only by your user account\'s file permissions. Anyone who can read your files could read them.')) return;
      const s2 = await call('setSettings', { secretsBasic: on }); if (s2 && !s2.message) S.settings = s2;
      S.prov = (await call('providerStatus')) || S.prov; render();
      return toast(on ? 'Basic protection is on. Add your keys again.' : 'Basic protection is off.');
    }
    case 'set-key': { const key = await secretPrompt(`Paste your ${aiName(d.v)} API key`); if (key) { const r = await call('setKey', d.v, key); if (r?.ok === false) toast(r.message); S.prov = (await call('providerStatus')) || S.prov; render(); } return; }
    case 'media-key': { const key = await secretPrompt(`Paste your ${MEDIA_KEYS.find((x) => x[0] === d.v)?.[1] || 'API key'}`); if (key) { const r = await call('mediaSetKey', d.v, key); if (r?.ok === false) toast(r.message); await refreshMates(); render(); } return; }
    case 'media-unkey': await call('mediaRemoveKey', d.v); await refreshMates(); return render();
    case 'mate-key': { const key = await secretPrompt(d.v.startsWith('free.') ? `Paste your free ${esc((S.mates.free?.providers || []).find((p) => `free.${p.id}` === d.v)?.name || '')} API key` : `Paste your ${aiName(d.v)} ${d.v === 'civitai' ? 'API token' : 'API key'}`); if (key) { const r = await call('teammatesSetKey', d.v, key); if (r?.ok === false) toast(r.message); await refreshMates(); render(); } return; }
    case 'mate-unkey': await call('teammatesRemoveKey', d.v); await refreshMates(); return render();
    case 'server-add': { const v = (id) => document.getElementById(id)?.value || ''; const r = await call('teammatesAddServer', { name: v('sv-name'), type: v('sv-type'), url: v('sv-url'), model: v('sv-model').trim(), key: v('sv-key'), workflow: v('sv-workflow').trim() }); if (r?.ok === false || r?.message) toast(r.message || 'Not added.'); else { toast(`Added ${r.name}. Turn on “Your GPU server” in Settings › AI team to use it.`); S.svAdd = {}; } await refreshMates(); if (r?.id) await loadServerModels(r.id); return render(); }
    case 'server-remove': await call('teammatesRemoveServer', d.id); if (S.svModels) delete S.svModels[d.id]; await refreshMates(); return render();
    case 'server-models': await loadServerModels(d.id); return render();
    case 'hd-url': { hdAfter(await setSettings({ hearthDevices: { url: document.getElementById('hd-url')?.value || '' } })); S.hd = (await call('hearthStatus', { probe: true, fresh: true })) || S.hd; await refreshMates(); return render(); }
    case 'hd-test': { toast('Asking your Home server…'); S.hd = (await call('hearthStatus', { probe: true, fresh: true })) || S.hd; toast(S.hd?.error ? 'The test didn\'t work (see Hearth devices).' : `${(S.hd?.devices || []).length} device${(S.hd?.devices || []).length === 1 ? '' : 's'} found.`); return render(); }
    case 'hd-code': { const v = document.getElementById('hd-code')?.value || ''; if (!v.trim()) return toast('Type the share code first.'); const r = await call('hearthShareCode', v); toast(r?.ok ? 'Share code saved (encrypted).' : r?.message || 'Not saved.'); S.hd = (await call('hearthStatus', { probe: true, fresh: true })) || S.hd; return render(); }
    case 'hd-code-remove': { await call('hearthShareCode', null); S.hd = (await call('hearthStatus', {})) || S.hd; return render(); }
    case 'hd-tog': { const st = S.hd?.settings || S.settings.hearthDevices || {}; hdAfter(await setSettings({ hearthDevices: { [d.k]: st[d.k] === false } })); return render(); }
    case 'hd-hosts': { hdAfter(await setSettings({ hearthDevices: { allowHosts: document.getElementById('hd-hosts')?.value || '' } })); return render(); }
    case 'hd-move': { const o = hdOrder().slice(); const i = o.indexOf(d.v); const j = i + Number(d.d); if (i < 0 || j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; hdAfter(await setSettings({ hearthDevices: { order: o } })); S.hd = { ...(S.hd || {}), order: o }; return render(); }
    case 'comfy-url': { const r = await setSettings({ comfy: { url: document.getElementById('comfy-url')?.value || '' } }); if (r && !r.message && r.comfy?.url) { const l = await call('comfyCheckpoints'); S.comfyCkpts = { url: r.comfy.url, list: l?.ok ? l.checkpoints : null, error: l?.ok ? null : l?.message }; } return render(); }
    case 'comfy-test': return comfyTest();
    case 'comfy-tune': { const st = (document.getElementById('comfy-steps')?.value || '').trim(); const cf = (document.getElementById('comfy-cfg')?.value || '').trim(); await setSettings({ comfy: { steps: st === '' ? null : Number(st), cfg: cf === '' ? null : Number(cf) } }); return; }
    case 'rs-cancel': { for (const R of runner.runtimes.values()) { const j = (R.scenes || []).find((x) => x.job === d.job); if (j) j.phase = 'cancelling'; } await call('rpSceneCancel', d.job); return render(); }
    case 'scene-regen': { const m = msgById(d.m); const sc = m?.scene; if (!sc?.positive || !S.open) return; return runScene(S.open, { cardIds: sc.cardIds || [], prompt: sc.positive, negative: sc.ownNegative || '', seed: Math.floor(Math.random() * 2 ** 31), source: sc.source || 'comfy', width: sc.width, height: sc.height, steps: sc.steps, cfg: sc.cfg, checkpoint: sc.source === 'comfy' ? sc.checkpoint : undefined }, 'Regenerating with a new seed'); }
    case 'scene-edit': { const m = msgById(d.m); if (!m || !S.open) return; const sc = m.scene || m.sceneFailed || {}; return openScene(S.open, { cardIds: sc.cardIds, positive: sc.positive || sc.prompt, ownNegative: sc.ownNegative || sc.negative || '', source: sc.source }); }
    case 'scene-seed': { const m = msgById(d.m); const sc = m?.scene; const id = (sc?.cardIds || []).find((x) => cardById(x)); if (!id || !Number.isInteger(sc.seed)) return; const r = await call('cardsSetLook', id, { seed: sc.seed, keepSeed: true }); if (r?.ok === false || r?.message) { toast(r.message || 'Not saved.'); return; } await loadCards(); toast(`Saved seed ${sc.seed} in ${r.name}'s look.`); return render(); }
    case 'comfy-list': { const l = await call('comfyCheckpoints'); S.comfyCkpts = { url: S.settings.comfy?.url, list: l?.ok ? l.checkpoints : null, error: l?.ok ? null : l?.message }; return render(); }
    case 'mem-add': { const v = document.getElementById('mem-new')?.value || ''; const r = await call('memoryAdd', v); if (r?.ok === false || r?.message) toast(r.message || 'Not saved.'); S.memory = await call('memoryList'); return render(); }
    case 'mem-edit': S.memEdit = d.id; return render();
    case 'mem-cancel': S.memEdit = null; return render();
    case 'mem-save': { const r = await call('memoryUpdate', d.id, document.getElementById('mem-edit')?.value || ''); if (r?.ok === false || r?.message) toast(r.message || 'Not saved.'); S.memEdit = null; S.memory = await call('memoryList'); return render(); }
    case 'mem-del': await call('memoryRemove', d.id); S.memory = await call('memoryList'); return render();
    case 'mem-decide': await call('memoryDecide', d.id, d.v === '1'); S.memory = await call('memoryList'); return render();
    case 'sched-add': { const v = (id) => document.getElementById(id)?.value || ''; const kind = v('sc-kind'); const days = [...document.querySelectorAll('.sc-day:checked')].map((x) => Number(x.value)); const r = await call('scheduleAdd', { prompt: v('sc-prompt'), chatId: v('sc-chat'), kind, time: v('sc-time'), at: v('sc-at') ? new Date(v('sc-at')).toISOString() : '', days }); if (r?.ok === false || r?.message) toast(r.message || 'Not created.'); else toast('Scheduled. It runs while the app is open.'); S.schedules = await call('scheduleList'); return render(); }
    case 'sched-toggle': { const x = S.schedules?.list?.find((y) => y.id === d.id); if (x) await call('scheduleUpdate', d.id, { enabled: !x.enabled }); S.schedules = await call('scheduleList'); return render(); }
    case 'sched-del': await call('scheduleRemove', d.id); S.schedules = await call('scheduleList'); return render();
    case 'conn-add': { const v = (id) => document.getElementById(id)?.value || ''; const type = v('cn-type'); const pairs = Object.fromEntries(v('cn-secrets').split('\n').map((l) => l.trim()).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])); const words = v('cn-command').trim().split(/\s+/).filter(Boolean); const r = await call('connectorsAdd', { name: v('cn-name').trim(), type, command: words[0] || '', args: words.slice(1), url: v('cn-url').trim(), ...(type === 'http' ? { headers: pairs } : { env: pairs }) }); if (r?.ok === false || r?.message) toast(r.message || 'Not added.'); else toast(`Added ${r.name}. The AIs can use it from the next message.`); S.connectors = await call('connectorsList'); return render(); }
    case 'desk-toggle': { const r = await call('desktopSetEnabled', !(S.desktop?.enabled === true)); if (r?.ok === false || r?.message) toast(r.message || 'Not saved.'); S.desktop = await call('desktopStatus'); return render(); }
    case 'conn-toggle': { const x = S.connectors?.list?.find((y) => y.id === d.id); if (x) await call('connectorsEnable', d.id, !x.enabled); S.connectors = await call('connectorsList'); return render(); }
    case 'conn-del': await call('connectorsRemove', d.id); S.connectors = await call('connectorsList'); return render();
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
  if (t.matches?.('select[data-a="st-start-item"]')) { stSync(); const it = (S.studio.data?.items || []).find((x) => `item:${x.id}` === t.value); S.studio.f.start = it ? t.value : null; S.studio.f.startName = it ? it.prompt.slice(0, 60) : ''; render(); }
  if (t.matches?.('select[data-a="unc-chat"]')) setSettings({ uncensored: { chatModel: t.value } });
  if (t.matches?.('select[data-a="unc-pic"]')) setSettings({ uncensored: { pictureModel: t.value } });
  if (t.matches?.('[data-a="idle-hours"]')) setSettings({ copyIdleHours: Number(t.value) });
  if (t.matches?.('[data-a="max-chats"]')) setSettings({ maxChats: Number(t.value) });
  if (t.matches?.('select[data-a="voice-set"]')) setSettings({ voice: { [t.dataset.k]: t.value } }).then(() => loadSection('voice'));
  if (t.matches?.('[data-vpick]')) { const vp = pickVoice(t.dataset.vpick, t.dataset.prov, t.value); if (vp) setSettings({ voice: vp }); }
  // Which engine a voice uses: the main provider ('') or one of his speech servers.
  if (t.matches?.('[data-vuse]')) {
    const k = t.dataset.vuse;
    const use = t.value || null;
    if (use) voice.loadList(use).then(() => render());
    if (k === 'card' && S.cardEdit) { const c = S.cardEdit; c.ownerVoice = { ...(c.ownerVoice || {}), use: use || undefined }; c.voiceChanged = true; renderMain(); } else if (k.startsWith('set:')) setSettings({ voice: { voices: { [k.slice(4)]: { use } } } });
  }
  if (t.matches?.('#vsrv-api')) { voice.readServerForm(); render(); }
  if (t.matches?.('[data-cvoice]') && S.cardEdit) { const c = S.cardEdit; c.ownerVoice = { ...(c.ownerVoice || {}), [t.dataset.cvoice]: Number(t.value) }; c.voiceChanged = true; renderMain(); }
  if (t.matches?.('[data-a="venice-model"]')) setSettings({ teammates: { venice: { model: t.value } } });
  if (t.matches?.('[data-a="venice-image"]')) setSettings({ teammates: { venice: { imageModel: t.value } } });
  if (t.matches?.('select[data-a="sv-model-pick"]')) {
    const id = t.dataset.id; const m = t.value;
    call('teammatesUpdateServer', id, { model: m }).then(async (r) => { if (r?.ok === false || r?.message) toast(r.message || 'Not saved.'); else toast(m ? `Saved. ${r.name} now uses ${m}.` : `Saved. ${r.name} uses the first model it has.`); await refreshMates(); render(); });
  }
  if (t.matches?.('#sv-url, #sv-type')) loadAddModels();
  if (t.matches?.('[data-a="civitai-engine"]')) setSettings({ teammates: { civitai: { engine: t.value } } });
  if (t.matches?.('[data-a="hd-pick"]')) setSettings({ hearthDevices: { [t.dataset.k]: { [t.dataset.v]: t.value || null } } }).then(hdAfter);
  if (t.matches?.('[data-a="comfy-ckpt"]')) setSettings({ comfy: { checkpoint: t.value } });
  if (t.matches?.('[data-a="comfy-size"]')) setSettings({ comfy: { size: t.value || null } });
  if (t.matches?.('[data-a="rs-src"]') && S.modal?.kind === 'rpscene') { S.modal.source = t.value; S.modal.vram = null; S.modal.prompt = document.getElementById('rs-prompt')?.value ?? S.modal.prompt; S.modal.negative = document.getElementById('rs-neg')?.value ?? S.modal.negative; renderOverlay(); sceneVram(); }
  if (t.matches?.('[data-a="pick-model"]')) {
    // A model per AI for this chat: kept with the chat's own data, never in settings.
    const R = S.view === 'chat' ? cur() : null;
    if (R) { R.sessions._models = { ...(R.sessions._models || {}), [t.dataset.v]: t.value }; save(); } else S.homeModels = { ...S.homeModels, [t.dataset.v]: t.value };
    renderMain();
  }
  if (t.id === 'branch-sel') S.pickBranch = t.value;
  if (t.matches?.('[data-a="coll-addto"]') && t.value) { const coll = t.value; const id = t.dataset.id; call('cardsCollectionAdd', coll, [id]).then(async (r) => { if (!r || r.ok === false || r.message) toast(r?.message || 'Not added.'); else toast(`Added ${cardById(id)?.name || 'the character'} to “${r.collection?.name}”.`); await loadColls(); renderMain(); }); }
  if (t.matches?.('[data-a="coll-sel"]')) { const id = t.dataset.id; S.collSel = t.checked ? [...new Set([...S.collSel, id])] : S.collSel.filter((x) => x !== id); renderMain(); document.querySelector(`[data-a="coll-sel"][data-id="${CSS.escape(id)}"]`)?.focus(); }
  if ((t.id === 'cf-case' || t.id === 'cf-word') && S.cardFind) { S.cardFind[t.id === 'cf-case' ? 'matchCase' : 'wholeWord'] = t.checked; S.cardFind.i = -1; cfRun(false); }
  if (S.modal?.kind === 'rpstart') {
    const m = S.modal;
    if (t.matches('[data-a="rp-toggle"]')) { const id = t.dataset.id; if (t.checked) { m.chars.push(id); m.players[id] = defaultPlayer(cardById(id)); } else m.chars = m.chars.filter((x) => x !== id); renderOverlay(); }
    if (t.matches('[data-a="rp-player"]')) m.players[t.dataset.id] = t.value;
    if (t.matches('[data-a="rp-order"]')) m.order = t.value;
    if (t.matches('[data-a="rp-lore"]')) m.lorebooks = t.checked ? [...m.lorebooks, t.dataset.id] : m.lorebooks.filter((x) => x !== t.dataset.id);
  }
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
  if (t.id === 'cf-q' && S.cardFind) { S.cardFind.q = t.value; S.cardFind.i = -1; cfRun(false); return; }
  if (t.id === 'cf-rep' && S.cardFind) { S.cardFind.rep = t.value; return; }
  if (t.dataset?.cf && S.cardFind?.open) { S.cardFind.nav = null; cfRun(false); }
  if (t.id === 'card-q') { S.cardQuery = t.value; const el = t; const pos = el.selectionStart; renderMain(); const n = document.getElementById('card-q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
  if (t.id === 'repo-q') { S.repoQuery = t.value; S.pop.noFocus = false; renderOverlay(); }
});

document.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if (S.view === 'card' && !S.modal && cardFindKey(ev)) return;
  // In a collection: Delete removes the selected cards, else the focused card (Undo puts them back).
  if (S.view === 'characters' && S.cardColl && ev.key === 'Delete' && !/^(TEXTAREA|SELECT)$/.test(t.tagName || '') && !(t.tagName === 'INPUT' && t.type !== 'checkbox') && t.closest?.('.ccard')) { ev.preventDefault(); collRemove(S.collSel.length ? S.collSel : [t.closest('.ccard').dataset.card]); return; }
  if (t.id === 'composer' && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); send(); return; }
  if (t.id === 'edit-text' && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); resendEdited(S.editing, t.value); return; }
  if (t.id === 'rename-input') { if (ev.key === 'Enter') { ev.preventDefault(); finishRename(true); } if (ev.key === 'Escape') finishRename(false); return; }
  if (S.modal?.kind === 'gallery' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { const g = galleryKey(ev.key); if (g) { ev.preventDefault(); galleryDo(g); return; } }
  if (ev.key === 'Escape' && voice.isOpen() && !S.modal && !S.pop) { voice.closeView(); return; }
  if (ev.key === 'Escape') { if (S.modal) { S.modal = null; renderOverlay(); } else if (S.pop) { S.pop = null; renderOverlay(); } else if (S.editing) { S.editing = null; render(); } }
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
document.addEventListener('drop', async (ev) => {
  if (!ev.dataTransfer?.files?.length || S.view === 'settings') return;
  ev.preventDefault();
  // On the Characters and Lorebooks pages a dropped PNG or JSON is imported as a card or lorebook.
  if (['characters', 'lorebooks', 'card'].includes(S.view)) {
    const out = [];
    for (const f of [...ev.dataTransfer.files].slice(0, 20)) { const r = await call(S.view === 'lorebooks' ? 'loreImport' : 'cardsImport', f.name, await f.arrayBuffer()); out.push(r && r.ok === false ? r : { ok: !r?.message, ...(S.view === 'lorebooks' ? { lorebook: r } : r), message: r?.message ? `${f.name}: ${r.message}` : undefined }); }
    return afterImport(out);
  }
  addFiles(ev.dataTransfer.files);
});

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

// Code blocks get an "Open in canvas" button next to Copy (added after each render).
new MutationObserver(() => {
  for (const hd of document.querySelectorAll('.msg-a .cb-hd:not([data-cv])')) { hd.dataset.cv = '1'; const b = document.createElement('button'); b.className = 'mini'; b.dataset.a = 'code-canvas'; b.textContent = 'Open in canvas'; hd.appendChild(b); }
}).observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener('resize', () => { fitComposer(); });

// ---------- character editor: Find and replace (src/app/card-find.mjs) ----------
// Everything works on the editor's own fields (the unsaved edit); Save is still the only save.
function cfEls() { return FIND_FIELDS.map(([key, label]) => ({ key, label, el: document.querySelector(`.cedit [data-cf="${key}"]`) })).filter((x) => x.el); }
function cfRun(jump = false) {
  const F = S.cardFind;
  if (!F?.open || S.view !== 'card') return;
  const els = cfEls();
  const r = searchFields(els.map((x) => ({ key: x.key, label: x.label, text: x.el.value })), F.q, F);
  F.flat = r.flat;
  if (F.i >= r.flat.length) F.i = r.flat.length ? 0 : -1;
  const cur = F.flat[F.i];
  const cnt = document.getElementById('cf-count');
  if (cnt) cnt.textContent = !F.q ? '' : r.total ? `${F.i >= 0 ? `${F.i + 1} of ` : ''}${r.total} match${r.total === 1 ? '' : 'es'}` : 'No matches';
  for (const lab of document.querySelectorAll('.cedit [data-ff]')) { const fr = r.fields.find((x) => x.key === lab.dataset.ff); lab.classList.toggle('has-match', Boolean(fr?.count)); lab.dataset.count = fr?.count ? `${fr.count}` : ''; }
  const box = document.getElementById('cf-fields');
  if (box) {
    box.innerHTML = r.fields.filter((x) => x.count).map((x) => { const el = els.find((e) => e.key === x.key).el; const m = cur?.key === x.key ? cur : x.matches[0]; const sn = snippet(el.value, m); return `<button class="cf-hit ${cur?.key === x.key ? 'on' : ''}" data-a="cf-goto" data-f="${esc(x.key)}"><b>${esc(x.label)}</b><span class="chip">${x.count}</span><span class="sn">${esc(sn.before)}<mark>${esc(sn.hit)}</mark>${esc(sn.after)}</span></button>`; }).join('')
      || `<span class="fine">${F.q ? 'No matches in this card.' : 'Searches the name, description, personality, scenario, greetings, example dialogue, system prompt, post-history instructions, creator notes, appearance and tags.'}</span>`;
  }
  if (jump && cur) cfSelect(cur);
}
function cfSelect(m) {
  const el = document.querySelector(`.cedit [data-cf="${m.key}"]`);
  if (!el) return;
  el.closest('.field')?.scrollIntoView({ block: 'center' });
  if (el.tagName === 'TEXTAREA') { const lines = el.value.slice(0, m.start).split('\n').length - 1; const lh = parseFloat(getComputedStyle(el).lineHeight) || 18; el.scrollTop = Math.max(0, lines * lh - el.clientHeight / 2); }
  el.focus({ preventScroll: true });
  el.setSelectionRange(m.start, m.end);
  S.cardFind.nav = { key: m.key, start: m.start, end: m.end };
}
function cfOpen(q = null) {
  readCardForm();
  const a = document.activeElement;
  const picked = a?.dataset?.cf && typeof a.selectionStart === 'number' ? a.value.slice(a.selectionStart, a.selectionEnd) : '';
  const F0 = S.cardFind || {};
  S.cardFind = { open: true, q: q ?? (picked && picked.length < 80 && !picked.includes('\n') ? picked : F0.q || ''), matchCase: Boolean(F0.matchCase), wholeWord: Boolean(F0.wholeWord), rep: F0.rep || '', i: -1, flat: [], nav: null };
  renderMain();
  cfRun(false);
  const qi = document.getElementById('cf-q');
  if (qi) { qi.focus(); qi.select(); }
}
function cfClose() { readCardForm(); if (S.cardFind) S.cardFind.open = false; renderMain(); }
function cfStep(dir) {
  const F = S.cardFind;
  if (!F?.open) return cfOpen();
  cfRun(false);
  if (!F.flat.length) return;
  F.i = stepIndex(F.i, F.flat.length, dir);
  cfRun(true);
}
// Put text in a field the way typing would (so Ctrl+Z still works), else set it directly.
function cfInsert(el, start, end, text) {
  el.focus({ preventScroll: true });
  el.setSelectionRange(start, end);
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch {}
  if (!ok || el.value.slice(start, start + text.length) !== text) { el.setRangeText(text, start, end, 'end'); el.dispatchEvent(new Event('input', { bubbles: true })); }
}
function cfReplaceOne() {
  const F = S.cardFind;
  if (!F?.open || !F.q) return;
  cfRun(false);
  if (!F.flat.length) return toast('No matches to replace.');
  if (F.i < 0) { F.i = 0; return cfRun(true); }
  const m = F.flat[F.i];
  const el = document.querySelector(`.cedit [data-cf="${m.key}"]`);
  if (!el) return;
  const rep = F.rep || '';
  cfInsert(el, m.start, m.end, rep);
  const order = FIND_FIELDS.map(([k]) => k);
  cfRun(false);
  const after = F.flat.findIndex((x) => order.indexOf(x.key) > order.indexOf(m.key) || (x.key === m.key && x.start >= m.start + rep.length));
  F.i = after >= 0 ? after : F.flat.length ? 0 : -1;
  cfRun(true);
}
function cfReplaceAll() {
  const F = S.cardFind;
  if (!F?.open || !F.q) return;
  const els = cfEls();
  const res = replaceAllFields(els.map((x) => ({ key: x.key, text: x.el.value })), F.q, F.rep || '', F);
  if (!res.count) return toast('No matches to replace.');
  for (const f of res.fields) { if (!f.count) continue; const el = els.find((x) => x.key === f.key).el; cfInsert(el, 0, el.value.length, f.text); }
  F.i = -1;
  cfRun(false);
  document.getElementById('cf-q')?.focus();
  toast(`Replaced ${res.count} in ${res.changed.length} field${res.changed.length === 1 ? '' : 's'}. Nothing is saved until you press Save.`);
}
// A flag reason: open Find with its words and jump to them in that field.
function flagJump(field, words) {
  if (S.view !== 'card' || !words) return;
  cfOpen(words);
  const F = S.cardFind;
  F.matchCase = false; F.wholeWord = false;
  const wc = document.getElementById('cf-case'); if (wc) wc.checked = false;
  const ww = document.getElementById('cf-word'); if (ww) ww.checked = false;
  cfRun(false);
  const i = F.flat.findIndex((m) => m.key === field);
  F.i = i >= 0 ? i : F.flat.length ? 0 : -1;
  cfRun(true);
}
// Keys while editing a card: Ctrl+F opens Find; F3 / Shift+F3 next and previous; in the Find box
// Enter / Shift+Enter and Escape; right after a jump, Enter in the field goes to the next match.
function cardFindKey(ev) {
  const t = ev.target;
  const F = S.cardFind;
  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 'f') { ev.preventDefault(); cfOpen(); return true; }
  if (ev.key === 'F3') { ev.preventDefault(); cfStep(ev.shiftKey ? -1 : 1); return true; }
  if (!F?.open) return false;
  if (t.id === 'cf-q') {
    if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); cfStep(ev.shiftKey ? -1 : 1); return true; }
    if (ev.key === 'Escape') { ev.preventDefault(); cfClose(); return true; }
  }
  if (t.id === 'cf-rep') {
    if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); if (ev.ctrlKey) cfReplaceAll(); else cfReplaceOne(); return true; }
    if (ev.key === 'Escape') { ev.preventDefault(); cfClose(); return true; }
  }
  const nav = F.nav;
  if (t.dataset?.cf && nav && t.dataset.cf === nav.key && t.selectionStart === nav.start && t.selectionEnd === nav.end) {
    if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); cfStep(ev.shiftKey ? -1 : 1); return true; }
    if (ev.key === 'Escape') { ev.preventDefault(); F.nav = null; document.getElementById('cf-q')?.focus(); return true; }
  }
  return false;
}
// ---------- Characters: collections ----------
// Removing a card from a collection only changes that collection: the card stays in All
// characters and in its other collections, and its chats are untouched. Undo puts it back.
async function collRemove(ids) {
  const cc = (S.colls || []).find((x) => x.id === S.cardColl);
  const list = (ids || []).filter((id) => cc?.cardIds.includes(id));
  if (!cc || !list.length) return;
  const r = await call('cardsCollectionRemove', cc.id, list);
  if (!r || r.ok === false || r.message) return toast(r?.message || 'Not removed.');
  S.collSel = S.collSel.filter((x) => !list.includes(x));
  await loadColls();
  renderMain();
  const names = (r.removed || []).map((id) => cardById(id)?.name).filter(Boolean);
  const what = names.length === 1 ? names[0] : `${names.length} characters`;
  toast(`Removed ${what} from “${cc.name}”. ${names.length === 1 ? 'It stays' : 'They stay'} in All characters.`, { kind: 'coll-restore', coll: cc.id, name: cc.name, ids: r.removed || [], before: r.before || [] });
}

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
    await refreshMates();
    await loadCards();
    S.upd = (await call('updaterInfo')) || S.upd;
    api.onUpdaterStatus?.((s) => { const prev = S.upd.status?.state; S.upd.status = s; if (s.state === 'available' && prev !== 'available') toast(`Update ${s.version} is available — see Settings › App updates.`); if (S.view === 'settings') render(); });
    // Steps carry their chat: only that chat's runtime gets them, open or not.
    api.onChatStep?.((e) => runner.onStep(e));
    api.onMediaProgress?.((p) => showCopy(p));
    api.onSceneProgress?.((p) => onSceneProgress(p));
    api.onStudio?.((type, a) => onStudio(type, a));
    api.onDesktop?.((type, a) => {
      if (type === 'ask') { S.deskAsks = [...(S.deskAsks || []).filter((x) => x.id !== a.id), a]; try { new Notification('Your AI wants to use this desktop', { body: `${a.tool}${a.detail ? `: ${a.detail}` : ''}` }); } catch {} }
      if (type === 'asked') S.deskAsks = (S.deskAsks || []).filter((x) => x.id !== a.id);
      renderOverlay();
    });
    api.onCardsFound?.(async (r) => {
      S.found = [{ ...(r || {}), key: uid() }, ...(S.found || [])].slice(0, 6);
      toast(r?.ok && r.card ? `Imported ${r.card.name}.` : r?.ok && r.lorebook ? `Imported the lorebook ${r.lorebook.name}.` : r?.message || 'Not imported.');
      if (r?.ok) await loadCards();
      render();
    });
    api.onCopiesIdle?.((list) => { S.idle = Array.isArray(list) ? list : []; render(); });
    api.onCopiesRemoved?.(async () => { await loadChats(); renderSide(); });
    api.onOpsPhoneAction?.((a) => onPhone(a));
    api.onNotifyOpen?.((id) => { if (id && entry(id)) openChat(id); });
    // A scheduled task posted into a chat: reload that chat's messages (unless its team is working).
    api.onChatExternal?.(async (e) => {
      const R = e?.chatId ? runner.runtimes.get(e.chatId) : null;
      if (R && !R.round) { R.loaded = false; await loadRt(e.chatId); if (S.open !== e.chatId) R.unseen = true; }
      await loadChats();
      render();
      if (e?.scheduled) { toast(`Scheduled task ran in “${e.title || 'a chat'}”.`); notify(rt(e.chatId), 'scheduled task ran'); }
    });
    S.phone = await call('opsPhoneStatus');
  } catch (e) { toast(`Startup problem: ${cleanErr(e)}`); }
  let remembered = null;
  try { remembered = localStorage.getItem('hearth.v2.open'); } catch {}
  if (remembered && entry(remembered)) await openChat(remembered); else render(true);
  refreshAgents();
  call('gitTools').then((g) => { if (g) { S.gh = g; renderSide(); } });
  loadMissing();
}
async function loadMissing() { const r = await call('toolsMissing'); if (Array.isArray(r)) { S.missing = r; render(); } }
// What each AI can really do (Settings › Permissions).
async function loadPerms(force = false) {
  if (force) S.permsT = null;
  const apiReady = Object.fromEntries(TEAM_IDS.map((a) => [a, method(a) === 'api' ? ready(a) : a === 'ollama' ? Boolean(S.cli.ollama?.installed) : false]));
  S.permsT = (await call('permsTable', TEAM_IDS, apiReady)) || { rows: [] };
  render();
}
// Settings › AI team › Test team: each connected teammate runs the same safe test.
async function runTeamTest() {
  if (S.testing) return;
  const ids = team().members.filter((a) => ready(a) && method(a) !== 'api' && ['anthropic', 'openai', 'google', 'xai', 'mistral', 'qwen'].includes(a));
  if (!ids.length) { toast('No connected teammate with a CLI to test.'); return; }
  S.testing = true; S.teamTest = { running: ids, results: [] }; render();
  const r = await call('teamTest', ids);
  S.testing = false;
  S.teamTest = r?.ok ? { results: r.results, at: new Date().toISOString(), settingsUndone: r.settingsUndone } : { results: [], error: r?.message || 'The test couldn\'t start.' };
  render();
}

boot();

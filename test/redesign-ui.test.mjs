// The redesigned shell (1.2): every page stays reachable, the composer keeps its controls,
// the in-app update UI stays visible, fonts are bundled, and look-only preferences never
// touch the app settings. Checked in the source (the renderer can't run outside Electron).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { phoneSnapshot } from '../src/ops/feeds.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ui = read('src/main.js');
const ops = read('src/ops/ui.mjs');
const wf = read('src/ops/workflow-ui.mjs');
const css = read('src/styles.css');
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); const j = src.indexOf(b, i + a.length); return src.slice(i, j < 0 ? undefined : j); };

test('sidebar: New task, Team chat, Board, Approvals (count), Jobs, Habitat and a More menu', () => {
  const side = between(ui, 'function sidebar(waiting) {', '\nfunction topbar(');
  assert.match(side, /class="newtask" data-new/);
  for (const [id, label] of [['chat', 'Team chat'], ['board', 'Board'], ['approvals', 'Approvals'], ['jobs', 'Jobs'], ['habitat', 'Habitat']]) assert.ok(side.includes(`nav('${id}', `) && side.includes(`'${label}'`), label);
  assert.match(side, /nav\('approvals', 'shield', 'Approvals', waiting \? `<span class="n">\$\{waiting\}<\/span>`/, 'approvals count');
  assert.match(side, /data-ui="more"/);
  assert.match(side, /data-nav="overview"/, 'Home from the brand');
  assert.match(side, /data-nav="settings"/, 'settings gear');
  assert.match(side, /data-recheck/, 'Re-check in the Team header');
  assert.match(side, /id="team-panel"/, 'Team list keeps the live-updated panel id');
  assert.match(side, /data-ops="switch"/, 'project switcher');
  assert.match(side, /data-ops="addfolder"/);
});

test('every page is still one or two clicks away (nothing removed)', () => {
  const navIds = [...between(ui, 'const NAV = [', '];').matchAll(/\['(\w+)', /g)].map((m) => m[1]);
  const opsIds = [...between(ops, 'nav: [', ']],').matchAll(/\['(\w+)', /g)].map((m) => m[1]);
  const wfIds = [...between(wf, 'nav: [', ']],').matchAll(/\['(\w+)', /g)].map((m) => m[1]);
  const more = JSON.parse(between(ui, 'const MORE = ', ';').slice('const MORE = '.length).replace(/'/g, '"'));
  const primary = ['chat', 'board', 'approvals', 'jobs', 'habitat', 'overview', 'settings'];
  for (const id of [...navIds, ...opsIds, ...wfIds]) assert.ok(primary.includes(id) || more.includes(id), `${id} is reachable`);
  for (const id of ['agents', 'history', 'github', 'audit', 'ops', 'actions', 'summary', 'project', 'release']) assert.ok(more.includes(id), `More › ${id}`);
});

test('right panel: Board, Task, Habitat, Jobs, Approvals and Release tabs', () => {
  const tabs = [...between(ui, 'const PANEL_TABS = [', '];').matchAll(/\['(\w+)', '([^']+)'\]/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['board', 'task', 'habitat', 'jobs', 'approvals', 'release']);
  const body = between(ui, 'function panelBody() {', '\nfunction rightPanel(');
  assert.match(body, /drawer\(\)/, 'Task tab is the task view (truth card, actions, review packet…)');
  assert.match(body, /viewHabitat\(\)/);
  assert.match(body, /wf\.views\.jobs\(\)/);
  assert.match(body, /viewApprovals\(\)/);
  assert.match(body, /wf\.views\.release\(\)/);
  assert.match(ui, /if \(hab && \(ui\.view === 'habitat' \|\| ui\.panel === 'habitat'\)\) \{ mountHabitat\(hab, habitatHooks\); mountHabitat3d\(hab, habitatHooks\); \}/);
});

test('composer: attach, @-target picker, Routine/Major, voice and send', () => {
  const c = between(ui, 'function composer(placeholder, note) {', '\nfunction viewChat(');
  for (const s of ['data-attach', 'data-ui="menu-target"', 'data-ui="menu-mode"', '${ops.voiceButton()}', 'data-sendchat', 'id="chat-text"', 'data-target="relay"', 'data-pickmode="routine"', 'data-pickmode="major"', 'data-unattach']) assert.ok(c.includes(s), s);
  assert.doesNotMatch(c, /data-sendchat[^>]*disabled/);
  // Home and Team chat use the same composer; sending from Home opens Team chat.
  assert.match(between(ui, 'function viewOverview() {', '\nfunction viewOverviewMain'), /composer\('What should the team work on\?', false\)/);
  assert.match(between(ui, 'async function sendChat() {', '// The room.'), /if \(ui\.view === 'overview'\) ui\.view = 'chat';/);
  // Enter still sends, Shift+Enter still makes a new line.
  assert.match(ui, /if \(e\.target\.id === 'chat-text' && e\.key === 'Enter' && !e\.shiftKey\) \{\s*e\.preventDefault\(\);\s*return sendChat\(\);/);
});

test('conversation: owner cards, AI monograms, inline approvals with Approve / Deny / Ask why', () => {
  const m = between(ui, 'function chatMessage(m) {', '\nfunction composer(');
  assert.match(m, /class="bubble"/);
  assert.match(m, /mono\(m\.who\)/);
  for (const s of ['data-editmsg', 'data-delmsg', 'data-togglehist', 'data-addprop', 'data-addall', 'data-startprop', 'data-adddup', 'data-opendup', 'data-leadundo', 'ops.resultsHtml(m)', 'attachmentsHtml(m)', 'relayed by you', 'posted on its own']) assert.ok(m.includes(s), s);
  const ask = between(ui, 'function askCard(p) {', '\nfunction inlineApprovals(');
  for (const s of [':approved">Approve', ':denied">Deny', ':why">Ask why']) assert.ok(ask.includes(s), s);
  const inl = between(ui, 'function inlineApprovals() {', '\nfunction chatMessage(');
  assert.match(inl, /approveButtons\(t\)/);
  assert.match(inl, /data-reject=/);
  assert.match(inl, /data-showchanges=/);
  assert.match(css, /\.chat-log > \* \{ max-width: 760px;/, 'centred 760px column');
});

test('RED FLAG: the in-app update UI stays visible (Settings › App updates, the Update pill)', () => {
  const block = between(ui, 'function updateBlock() {', '\n}\n');
  assert.match(block, /data-upd="check"[^>]*>Check for updates<\/button>/);
  assert.match(block, /data-upd="download"/);
  assert.match(block, /data-upd="install"/);
  assert.match(block, /data-upd="restart"/);
  const settings = between(ui, 'function viewSettings() {', '\nfunction workControls(');
  assert.match(settings, /updates: `<div class="card"><h3>App updates<\/h3>[\s\S]*\$\{updateBlock\(\)\}/);
  assert.match(ui, /\['updates', 'dl', 'App updates',/);
  assert.match(between(ui, 'function sidebar(waiting) {', '\nfunction topbar('), /class="updpill" data-goupdates/);
  assert.match(between(ui, 'function topbar(', '\nfunction boardList('), /data-goupdates/);
  assert.match(ui, /if \(d\.goupdates !== undefined\) \{ ui\.view = 'settings';/);
});

test('settings page: section navigation with every section', () => {
  const ids = [...between(ui, 'const SET_SECS = [', '];').matchAll(/\['(\w+)', '\w+', '([^']+)'/g)].map((m) => m[2]);
  assert.deepEqual(ids, ['General', 'Owner identity', 'Team & lead powers', 'AI accounts', 'Local AI', 'Projects & workspace', 'GitHub', 'Hearth OS facts & red flags', 'Approvals & safety', 'Phone view', 'App updates', 'Saved work & data', 'About this build']);
  const s = between(ui, 'function viewSettings() {', '\nfunction workControls(');
  for (const k of ["data-theme=", "data-togglesetting=", "data-toggleleadgh", "data-autohandoff", "data-access=\"standard\"", "data-access=\"full\"", "data-adddir", "data-removedir", "data-pickproject", "data-restore=", "data-export", "data-reset", "id=\"text-size\"", "ops.identityCard()", "ops.leadPowersCard()", "ops.levelsCard()", "ops.phoneBlock()", "ops.capsCard()", "ops.localModels()"]) assert.ok(s.includes(k), k);
  assert.match(s, /themeChip\('hearth', 'Follow Hearth OS desktop'\)/, 'follow the Hearth OS desktop theme is kept');
});

test('look-only preferences never change app settings by themselves', () => {
  const load = between(ui, 'function loadPrefs() {', '\n');
  assert.doesNotMatch(load, /setItem|setSettings/);
  const shell = between(ui, "const PREFILL = {", "document.addEventListener('change', async (e) => {");
  assert.doesNotMatch(shell, /api\.setSettings|save\(\)/, 'the shell controls never write settings or state');
  // Prefs are written only from the owner's own clicks on those controls.
  const total = (ui.match(/savePref\(/g) || []).length;
  assert.equal((shell.match(/savePref\(/g) || []).length, total - 1, 'savePref only in the click handler (plus its definition)');
});

test('fonts are bundled locally (Lora with its OFL licence, Inter) and nothing is loaded remotely', () => {
  assert.ok(statSync(new URL('../src/fonts/Lora-Variable.ttf', import.meta.url)).size > 100000);
  const lic = read('src/fonts/Lora-OFL.txt');
  assert.match(lic, /The Lora Project Authors/);
  assert.match(lic, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.ok(existsSync(new URL('../src/fonts/InterVariable.woff2', import.meta.url)));
  assert.match(css, /url\('\.\/fonts\/Lora-Variable\.ttf'\)/);
  assert.doesNotMatch(css, /https?:\/\/|@import/);
  assert.doesNotMatch(read('index.html'), /fonts\.googleapis|https?:\/\/(?!www\.w3)/);
});

test('phone snapshot carries only a sanitised team list for the team chips', () => {
  const s = phoneSnapshot({ state: { tasks: [], chat: [], permissions: [] }, team: [{ id: 'anthropic', dot: 'work', lead: true, secret: 'x' }, { id: 'openai', dot: '<b>' }] });
  assert.deepEqual(s.team, [{ id: 'anthropic', dot: 'work', lead: true }, { id: 'openai', dot: 'off', lead: false }]);
  assert.deepEqual(phoneSnapshot({ state: {} }).team, []);
});

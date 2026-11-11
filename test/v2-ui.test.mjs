// 2.x window: pure helpers (sidebar groups, steps, previews, diff, team plan, the AIs' brief,
// Claude acting for the owner) and source guards for what can't run outside Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupChats, repoHint, fmtBytes } from '../src/app/groups.mjs';
import { groupSteps, outcomeSteps } from '../src/app/steps.mjs';
import { extractPreviews, previewDoc, frameHtml, cspMeta, SANDBOX } from '../src/app/previews.mjs';
import { md } from '../src/app/text.mjs';
import { parseDiff } from '../src/app/diff.mjs';
import { teamOf, planTurn, handoffs, pickReviewer, brief, turnPrompt, transcript } from '../src/app/brief.mjs';
import { parseActs, typedAnswer, makeAct, expired, ACT_TTL_MS } from '../src/app/act.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ui = read('src/main.js');
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); const j = src.indexOf(b, i + a.length); return src.slice(i, j < 0 ? undefined : j); };

test('sidebar: Pinned / Today / Yesterday / Earlier, hidden chats out of the list, a repo hint per chat', () => {
  const now = new Date('2026-11-04T15:00:00');
  const list = [
    { id: 'a', title: 'Pinned one', pinned: true, updatedAt: '2026-10-01T00:00:00' },
    { id: 'b', title: 'Today', updatedAt: '2026-11-04T09:00:00', repo: 'Dragongamer9/hearth-os' },
    { id: 'c', title: 'Yesterday', updatedAt: '2026-11-03T22:00:00' },
    { id: 'd', title: 'Old', updatedAt: '2026-10-20T00:00:00', repoDir: '/home/o/beacon' },
    { id: 'e', title: 'Hidden', hidden: true, updatedAt: '2026-11-04T10:00:00' },
  ];
  const g = groupChats(list, { now });
  assert.deepEqual(g.map((x) => [x.label, x.items.map((i) => i.id)]), [['Pinned', ['a']], ['Today', ['b']], ['Yesterday', ['c']], ['Earlier', ['d']]]);
  assert.deepEqual(groupChats(list, { now, query: 'hearth' }).flatMap((x) => x.items.map((i) => i.id)), ['b'], 'search by title or repo');
  assert.equal(repoHint(list[1]), 'hearth-os');
  assert.equal(repoHint(list[3]), 'beacon');
  assert.equal(repoHint(list[2]), '');
  assert.equal(fmtBytes(98 * 1048576), '98 MB');
});

test('steps: consecutive steps become one row; the app adds what really happened', () => {
  const rows = groupSteps([
    { kind: 'search', label: 'Searched the repo', detail: 'for “wifi rescan”' },
    { kind: 'read', label: 'Read', detail: 'WifiPage.qml', file: 'a/WifiPage.qml' },
    { kind: 'read', label: 'Read', detail: 'nm-watch.py', file: 'b/nm-watch.py' },
    { kind: 'web-read', label: 'Read a web page', detail: 'networkmanager.dev' },
    { kind: 'edit', label: 'Edited', detail: 'nm-watch.py', file: 'b/nm-watch.py' },
    { kind: 'edit', label: 'Edited', detail: 'WifiPage.qml', file: 'a/WifiPage.qml' },
  ]);
  assert.deepEqual(rows.map((r) => [r.label, r.detail]), [['Searched the repo', 'for “wifi rescan”'], ['Read', 'WifiPage.qml, nm-watch.py'], ['Read a web page', 'networkmanager.dev'], ['Edited 2 files', 'nm-watch.py, WifiPage.qml']]);
  const out = outcomeSteps({ changes: { files: [{ path: 'x' }, { path: 'y' }], branch: 'hearth/wifi' }, pushed: { ok: true, branch: 'hearth/wifi' }, previews: [{ name: 'p.html' }] });
  assert.deepEqual(out.map((o) => o.label), ['Edited 2 files', 'Pushed to GitHub', 'Made a live preview']);
  assert.equal(out[0].note, '✓ committed as you');
});

test('artifacts render sandboxed: no same-origin, CSP first in <head>, network blocked unless allowed', () => {
  const f = frameHtml({ url: 'hearth-preview://0123456789abcdef/' });
  assert.equal(SANDBOX, 'allow-scripts');
  assert.match(f, /sandbox="allow-scripts"/);
  assert.doesNotMatch(f, /allow-same-origin|allow-top-navigation|allow-popups|allow-forms/);
  assert.match(frameHtml({ url: 'https://evil.example/' }), /srcdoc=""/, 'only hearth-preview: pages are loaded by URL');
  const doc = previewDoc({ kind: 'html', content: '<html><head><title>x</title><script>fetch("https://x")</script></head><body>hi</body></html>' });
  assert.ok(doc.indexOf('Content-Security-Policy') < doc.indexOf('<title>'), 'the CSP comes before anything the page adds');
  assert.match(cspMeta(false), /connect-src 'none'/);
  assert.doesNotMatch(cspMeta(false), /https:/);
  assert.match(cspMeta(true), /connect-src https:/);
  assert.match(previewDoc({ kind: 'svg', content: '<svg><script>alert(1)</script><rect/></svg>' }), /<svg><rect\/><\/svg>/, 'scripts are dropped from SVG');
  assert.doesNotMatch(previewDoc({ kind: 'markdown', content: '[x](javascript:alert(1)) <img src=x onerror=alert(1)>' }), /<img|href="javascript/);
  // The window: the iframe never gets the preload or Node; the main process guards frame navigation.
  const main = read('electron/main.cjs');
  assert.doesNotMatch(main, /nodeIntegrationInSubFrames/);
  assert.match(main, /on\('will-frame-navigate'/);
  assert.match(main, /registerSchemesAsPrivileged\(\[\{ scheme: 'hearth-preview'/);
  assert.match(read('index.html'), /frame-src hearth-preview:/);
  assert.match(ui, /frameHtml\(\{ url: S\.pane\.url/);
});

test('the preview convention: fenced "preview" blocks become previews', () => {
  const r = extractPreviews('Here it is.\n\n```html preview storage page\n<h1>Storage</h1>\n```\n\n```svg preview\n<svg/>\n```\nand ```js\nnot one\n```');
  assert.deepEqual(r.previews.map((p) => [p.name, p.kind]), [['storage-page.html', 'html'], ['preview-2.svg', 'svg']]);
  assert.match(r.text, /Live preview: storage-page\.html/);
  assert.match(r.text, /not one/);
  assert.equal(extractPreviews('```markdown preview notes.md\n# Hi\n```').previews[0].kind, 'markdown');
});

test('chat text is escaped; only https links', () => {
  const h = md('<script>x</script> **bold** `code` [a](https://x.y) [b](http://x.y) javascript:alert(1)');
  assert.doesNotMatch(h, /<script>/);
  assert.match(h, /<b>bold<\/b>/);
  assert.match(h, /<code>code<\/code>/);
  assert.match(h, /href="https:\/\/x\.y"/);
  assert.doesNotMatch(h, /href="http:/);
});

test('diff viewer: files, hunks, line numbers', () => {
  const files = parseDiff('diff --git a/x.py b/x.py\nindex 1..2 100644\n--- a/x.py\n+++ b/x.py\n@@ -1,3 +1,4 @@\n a\n-b\n+B\n+c\n d\ndiff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hi\n');
  assert.deepEqual(files.map((f) => [f.path, f.add, f.del, f.status]), [['x.py', 2, 1, 'modified'], ['new.txt', 1, 0, 'added']]);
  assert.deepEqual(files[0].hunks[0].lines.map((l) => [l.t, l.o ?? null, l.n ?? null]), [[' ', 1, 1], ['-', 2, null], ['+', null, 2], ['+', null, 3], [' ', 3, 4]]);
});

test('team: Claude leads; @name asks one AI; the lead hands work over; the reviewer checks changes', () => {
  const t = teamOf(null);
  assert.deepEqual(t, { lead: 'anthropic', reviewer: 'openai', members: ['anthropic', 'openai', 'google'] });
  const live = ['anthropic', 'openai', 'google'];
  assert.deepEqual(planTurn({ text: 'fix it', team: t, live }), ['anthropic']);
  assert.deepEqual(planTurn({ text: '@Gemini research this', team: t, live }), ['google']);
  assert.deepEqual(planTurn({ text: 'fix it', mode: 'openai', team: t, live }), ['openai']);
  assert.deepEqual(planTurn({ text: 'fix it', team: t, live: ['google'] }), ['google'], 'someone answers if the lead is out');
  assert.deepEqual(handoffs('Plan:\n@Gemini check the docs for resume\nThen I edit.', { team: t, live, done: ['anthropic'] }), ['google']);
  assert.deepEqual(handoffs('I asked @Gemini earlier in passing', { team: t, live, done: [] }), [], 'only lines that start with @name');
  assert.equal(pickReviewer({ team: t, live, author: 'anthropic' }), 'openai');
  assert.equal(pickReviewer({ team: t, live, author: 'openai' }), null);
  assert.equal(teamOf({ lead: 'openai', reviewer: null, members: ['anthropic', 'openai'] }).reviewer, null);
});

test('the brief: temporary shallow copy, quick checks only, Actions for builds, live previews, the owner\'s rules', () => {
  const b = brief({ agent: 'anthropic', role: 'lead', chat: { title: 'Fix Wi-Fi', repo: 'Dragongamer9/hearth-os', branch: 'main' }, copy: { base: 'main', work: 'hearth/fix-wi-fi-0001' }, build: true, web: true, quickChecks: ['node --check', 'bash -n'], live: ['anthropic'], actForMe: true });
  for (const s of ['TEMPORARY SHALLOW COPY of Dragongamer9/hearth-os', 'hearth/fix-wi-fi-0001', 'quick checks only', 'node --check, bash -n', 'GitHub Actions', '.hearth-preview/<name>.html', '```html preview <name>.html', 'never pick, bump or apply one', 'Co-authored-by', 'Never push to main, master or a tag', 'ACT FOR OWNER: merge']) assert.ok(b.includes(s), s);
  const off = brief({ agent: 'openai', chat: { title: 'x', repo: 'Dragongamer9/beacon', branch: 'bughunt' }, build: false, web: false });
  assert.match(off, /Run & build is OFF/);
  assert.match(off, /Web is OFF/);
  assert.match(off, /Never push to main, master, bughunt or a tag/);
  assert.doesNotMatch(off, /ACT FOR OWNER/, 'only Claude may ask to act for the owner');
  const msgs = [{ who: 'owner', text: 'hi' }, { who: 'anthropic', text: 'hello' }, { who: 'owner', text: 'next', attachments: [{ kind: 'file', name: 'log.txt', path: '/a/log.txt', text: 'ERR boom' }] }];
  assert.match(transcript(msgs), /Owner: next\n\[attached file log\.txt: \/a\/log\.txt\]\n--- log\.txt ---\nERR boom/);
  const resumed = turnPrompt({ agent: 'anthropic', role: 'lead', messages: msgs, briefText: b, resumed: true });
  assert.doesNotMatch(resumed, /Owner: hi/, 'a resumed session only gets what is new');
  assert.match(resumed, /Owner: next/);
});

test('Claude acting for the owner: asks only, nothing without a yes, hard limits stay', () => {
  assert.deepEqual(parseActs('ACT FOR OWNER: push\nACT FOR OWNER: merge', { agent: 'anthropic', enabled: true }).acts.map((a) => a.kind), ['push', 'merge']);
  assert.deepEqual(parseActs('ACT FOR OWNER: push', { agent: 'openai', enabled: true }).acts, [], 'only Claude');
  assert.deepEqual(parseActs('ACT FOR OWNER: push', { agent: 'anthropic', enabled: false }).acts, [], 'only with the owner\'s switch on');
  const r = parseActs('ACT FOR OWNER: release 1.6\nACT FOR OWNER: setting updates off\nACT FOR OWNER: version 2.0', { agent: 'anthropic', enabled: true });
  assert.equal(r.acts.length, 0);
  assert.equal(r.refused.length, 3);
  assert.equal(typedAnswer('Yes'), 'yes');
  assert.equal(typedAnswer('yes, and also merge'), null, 'only an exact yes');
  assert.equal(typedAnswer('no'), 'no');
  const a = makeAct('merge', { chatId: 'c1', now: 0 });
  assert.equal(a.status, 'pending');
  assert.equal(expired(a, ACT_TTL_MS + 1), true);
  // In the window: a yes runs the same card action, and a merge goes through chat:merge (which asks again).
  const decide = between(ui, 'async function decideAct(', '// ---------- previews');
  assert.ok(decide.indexOf("a.status = yes ? 'approved' : 'denied'") < decide.indexOf('cardAction('), 'acts only after the yes');
  assert.equal((ui.match(/call\('chatMerge'/g) || []).length, 1, 'one merge call site');
  assert.match(between(ui, 'async function send(', 'async function runTeam('), /typedAnswer\(text\)/, 'typed answers come only from the owner\'s composer');
  const runner = read('src/app/team-run.mjs');
  assert.doesNotMatch(between(runner, 'async function turn(', 'async function runHelpers('), /typedAnswer/, 'never from an AI\'s reply');
  assert.match(decide, /a\.chatId && a\.chatId !== R\.id/, 'an approval stays bound to the chat it was asked in');
});

test('RED FLAG: the in-app update UI stays visible and working (Settings › App updates)', () => {
  assert.match(ui, /\['updates', 'App updates'\]/);
  const sec = between(ui, "if (k === 'updates') {", "if (k === 'data') {");
  for (const v of ['check', 'download', 'install', 'restart']) assert.match(sec, new RegExp(`data-a="upd" data-v="${v}"`));
  assert.match(ui, /check: 'checkForUpdates', download: 'downloadUpdate', install: 'installUpdate', restart: 'restartApp'/);
  assert.match(ui, /api\.onUpdaterStatus\?\.\(/);
  assert.match(sec, /AppImage and the \.deb/);
});

test('the owner\'s input is never blocked by AI activity', () => {
  const send = between(ui, 'async function send(', '// Retry an answer');
  assert.match(send, /if \(S\.busy \|\| S\.working\) \{[\s\S]*runner\.start\(R0, text\)/, 'a message sent while the team works is queued, not refused');
  const runner = read('src/app/team-run.mjs');
  assert.match(runner, /if \(R\.round \|\| R\.waiting\) \{ R\.queued\.push\(text\)/, 'queued for that chat');
  assert.match(runner, /next = R\.queued\.length && !R\.stop \?/, 'and answered right after');
  assert.doesNotMatch(between(ui, 'async function openChat(', 'function goHome('), /toast\(/, 'switching chats never blocks');
  assert.match(ui, /<button class="send" data-a="send"/);
  assert.doesNotMatch(ui, /data-a="send"[^>]*disabled/);
  assert.doesNotMatch(ui, /id="composer"[^>]*disabled/);
  assert.match(ui, /data-a="stop"/, 'there is a Stop control');
});

test('settings never change by themselves: the window writes settings only from the owner\'s clicks', () => {
  const boot = between(ui, 'async function boot() {', '\nboot();');
  assert.doesNotMatch(boot, /setSettings|chatsUpdate|chatsSave/);
  const click = between(ui, "document.addEventListener('click'", "document.addEventListener('change'");
  const change = between(ui, "document.addEventListener('change'", "let searchTimer");
  // 3.4.1: his own Ctrl − / Ctrl + / Ctrl 0 (the app's size) is the only other place, and only on those keys.
  const keys = between(ui, '// 3.4.1: Ctrl − / Ctrl + / Ctrl 0', "document.addEventListener('input'");
  assert.match(keys, /if \(!\(ev\.ctrlKey \|\| ev\.metaKey\)/);
  assert.match(keys, /setSettings\(\{ textSize: next \}\)/);
  assert.equal([...keys.matchAll(/setSettings\(/g)].length, 1);
  const outside = ui.replace(click, '').replace(change, '').replace(keys, '');
  assert.deepEqual([...outside.matchAll(/setSettings\(\{/g)].length, 0, 'every setSettings({…}) is inside the click handler');
  assert.match(ui, /if \(t\.matches\?\.\('\[data-a="idle-hours"\]'\)\) setSettings/, 'plus the owner\'s own idle-time choice');
});

test('no Projects list, no Board, Approvals or Jobs; the Habitat only as a sidebar entry', () => {
  const side = between(ui, 'function renderSide() {', '\nfunction topbar(');
  assert.doesNotMatch(side, /Projects|Board|Approvals|Jobs/);
  assert.match(side, /data-a="habitat"[^>]*>\$\{icon\('home', 'sm'\)\}Habitat/, 'a Habitat entry in the sidebar');
  assert.ok(side.indexOf('data-a="habitat"') < side.indexOf('id="chat-list"'), 'just above the chats list');
  const top = between(ui, 'function topbar() {', '\nfunction renderMain(');
  assert.doesNotMatch(top, /data-a="habitat"/, 'no top-bar button');
  assert.doesNotMatch(between(ui, 'function renderPane(', '// ---------- popovers'), /habitat/i, 'no side panel tab');
  assert.match(ui, /saveView3d: \(v\) => \{ call\('setSettings', \{ view3d: v \}\)/, 'the saved 3D settings change only from the owner\'s own 3D controls');
  assert.doesNotMatch(ui, /from '\.\/ops\/ui\.mjs'|from '\.\/team\.mjs'/);
  for (const s of ['New chat', 'Search chats', 'data-a="chat-menu"', 'data-a="settings"']) assert.ok(side.includes(s), s);
  for (const k of ['rename', 'pin', 'unpin', 'up', 'down', 'connect', 'close', 'hide', 'delete']) assert.ok(ui.includes(`'${k}'`), `chat menu: ${k}`);
  assert.match(ui, /dropInGroup\(S\.chats, dragId/, 'drag to reorder');
  assert.match(ui, /Recently deleted/);
  assert.match(ui, /kind: 'restore', trashId/, 'Undo after delete');
});

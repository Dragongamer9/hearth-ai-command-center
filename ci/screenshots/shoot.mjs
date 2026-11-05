// CI-only screenshot harness for the 2.x chats layout. Serves the built renderer and
// replaces the Electron preload bridge (window.hearth) with harmless fake data. Nothing
// here ships in the app; it never signs in anywhere or touches real accounts.
// Fails (exit 1) when a page doesn't render what it should or the page throws.
import { mkdirSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.OUT_DIR || 'shots';
mkdirSync(OUT, { recursive: true });

function stub(opts) {
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  const chats = [
    { id: 'team-a1b2c3d4', title: 'Hearth OS 1.4 planning', team: true, pinned: true, repo: 'Dragongamer9/hearth-os', branch: 'bughunt', createdAt: ago(9000), updatedAt: ago(3000), migratedV2: true, hasCopy: false },
    { id: 'c0000000001', title: 'Fix Wi-Fi list after resume', repo: 'Dragongamer9/hearth-os', branch: 'main', createdAt: ago(60), updatedAt: ago(2), hasCopy: true },
    { id: 'c0000000002', title: 'Storage page mockup', repo: 'Dragongamer9/hearth-os', branch: 'main', createdAt: ago(90), updatedAt: ago(20), hasCopy: true },
    { id: 'c0000000003', title: 'Beacon launcher icons', repo: 'Dragongamer9/beacon', branch: 'main', createdAt: ago(200), updatedAt: ago(40) },
    { id: 'c0000000004', title: 'Release notes for 1.3', repo: 'Dragongamer9/hearth-os', branch: 'main', createdAt: ago(1700), updatedAt: ago(1500) },
    { id: 'c0000000005', title: 'Weekend ideas', createdAt: ago(1700), updatedAt: ago(1560) },
    { id: 'c0000000006', title: 'Command Center crash log', repo: 'Dragongamer9/hearth-ai-command-center', branch: 'main', createdAt: ago(1800), updatedAt: ago(1600) },
    { id: 'c0000000007', title: 'GRUB theme research', createdAt: ago(9000), updatedAt: ago(6000) },
    { id: 'c0000000008', title: 'Mech game turret ideas', repo: 'Dragongamer9/quad-mech', branch: 'main', createdAt: ago(9500), updatedAt: ago(7000) },
  ];
  const storage = '<!doctype html><html><head><style>body{margin:0;font-family:Inter,system-ui,sans-serif;color:#d8f3ff;background:radial-gradient(80% 60% at 80% 0,#ff2bd633,transparent 60%),#0b1020;min-height:100vh;padding:22px;box-sizing:border-box}h1{font:800 24px system-ui;letter-spacing:.04em;color:#22d3ee;margin:0}.s{color:#7fa6c0;font-size:13px;margin:4px 0 18px}.d{border:1px solid #22d3ee55;border-radius:12px;padding:14px 16px;margin-bottom:12px;background:#0f1830}.r{display:flex;justify-content:space-between;font-weight:700}.r span{color:#7fa6c0;font-weight:500}.b{height:8px;border-radius:4px;background:#1c2a48;margin-top:10px}.b i{display:block;height:8px;border-radius:4px;background:linear-gradient(90deg,#22d3ee,#ff2bd6)}.u{font-size:12px;color:#7fa6c0;margin-top:6px}.a{display:flex;gap:10px;margin-top:6px}.a div{flex:1;padding:14px;border-radius:12px;font-weight:800;text-align:center}.c{background:#22d3ee;color:#04121c}.m{border:1px solid #ff2bd6;color:#ffb3f0}.h{margin-top:40px;font-size:12px;color:#7fa6c0}</style></head><body><h1>STORAGE</h1><div class="s">2 drives · 1.3 TB free</div><div class="d"><div class="r">Internal SSD<span>512 GB</span></div><div class="b"><i style="width:72%"></i></div><div class="u">72% used</div></div><div class="d"><div class="r">microSD — Games<span>1 TB</span></div><div class="b"><i style="width:41%"></i></div><div class="u">41% used</div></div><div class="a"><div class="c">Clean up</div><div class="m">Move games</div></div><div class="h">Ⓐ open &nbsp; Ⓑ back &nbsp; Ⓧ clean up</div></body></html>';
  const msgs = {
    c0000000001: [
      { id: 'm1', who: 'owner', text: "The Wi-Fi list in Mantel doesn't refresh after the ROG Ally wakes up. Fix it and run the tests.", at: ago(4) },
      { id: 'm2', who: 'anthropic', role: 'lead', at: ago(2), via: 'Claude Code',
        steps: [
          { kind: 'search', label: 'Searched the repo', detail: 'for “wifi rescan”' },
          { kind: 'read', label: 'Read', detail: 'WifiPage.qml', file: 'hosts/linux/desktop/shell/WifiPage.qml' },
          { kind: 'read', label: 'Read', detail: 'nm-watch.py', file: 'hosts/linux/desktop/nm-watch.py' },
          { kind: 'read', label: 'Read', detail: 'test_wifi.py', file: 'hosts/linux/test/test_wifi.py' },
          { kind: 'web-read', label: 'Read a web page', detail: 'networkmanager.dev', url: 'https://networkmanager.dev/docs/' },
          { kind: 'edit', label: 'Edited', detail: 'nm-watch.py', file: 'hosts/linux/desktop/nm-watch.py' },
          { kind: 'edit', label: 'Edited', detail: 'WifiPage.qml', file: 'hosts/linux/desktop/shell/WifiPage.qml' },
          { kind: 'check', label: 'Ran checks locally', detail: 'python3 -m py_compile hosts/linux/desktop/nm-watch.py' },
        ],
        outcome: [{ kind: 'edit-summary', icon: 'pencil', label: 'Edited 2 files', detail: 'on branch hearth/fix-wi-fi-list-0001', note: '✓ committed as you', ok: true }, { kind: 'pushed', icon: 'push', label: 'Pushed to GitHub', detail: 'hearth/fix-wi-fi-list-0001', note: '✓ on GitHub', ok: true }],
        text: 'NetworkManager drops its cached scan when the Ally sleeps, and Mantel only asked for a scan when the page opened. It now listens for the resume signal and rescans, with a 2-second wait so the Wi-Fi card is awake first.',
        changes: { files: [{ path: 'hosts/linux/desktop/nm-watch.py', add: 14, del: 2 }, { path: 'hosts/linux/desktop/shell/WifiPage.qml', add: 6, del: 1 }], add: 20, del: 3, branch: 'hearth/fix-wi-fi-list-0001', base: 'main', head: 'c0ffee15d9a3b2e4f60718293a4b5c6d7e8f9012', pushed: 'hearth/fix-wi-fi-list-0001', repo: 'Dragongamer9/hearth-os' },
        actions: { branch: 'hearth/fix-wi-fi-list-0001', sha: 'c0ffee15d9a3b2e4f60718293a4b5c6d7e8f9012', state: opts.failing ? 'failure' : 'success', runs: [{ name: 'CI', status: 'completed', conclusion: opts.failing ? 'failure' : 'success', url: 'https://github.com/Dragongamer9/hearth-os/actions/runs/1' }], ...(opts.failing ? { failure: { job: { name: 'test', step: 'Run tests' }, annotations: [{ level: 'failure', path: 'hosts/linux/test/test_wifi.py', line: 41, message: 'AssertionError: rescan was not called after resume' }] } } : {}) } },
      { id: 'm3', who: 'openai', role: 'reviewer', at: ago(1), via: 'Codex', text: 'Reviewed the diff: looks right. One note: the 2-second wait should be a constant so the tests can shorten it. ✓ Approve.' },
    ],
    c0000000002: [
      { id: 'p1', who: 'owner', text: 'Make a mockup of a Settings › Storage page for Mantel, in the Gaming look.', at: ago(25) },
      { id: 'p2', who: 'anthropic', role: 'lead', at: ago(20), via: 'Claude Code', steps: [{ kind: 'read', label: 'Read', detail: 'palettes.json', file: 'hosts/linux/desktop/palettes.json' }], outcome: [{ kind: 'preview', icon: 'eye', label: 'Made a live preview', detail: 'storage-page.html', note: 'open →', open: 'storage-page.html' }],
        text: 'Here\'s the Storage page: drives as cards with a usage bar, big “Clean up” and “Move games” actions, and the controller hints along the bottom. Want me to build the real QML page from it?',
        previews: [{ id: 'pv1', name: 'storage-page.html', kind: 'html', content: storage }] },
    ],
  };
  const diff = 'diff --git a/hosts/linux/desktop/nm-watch.py b/hosts/linux/desktop/nm-watch.py\nindex 1..2 100644\n--- a/hosts/linux/desktop/nm-watch.py\n+++ b/hosts/linux/desktop/nm-watch.py\n@@ -10,7 +10,19 @@ import dbus\n from gi.repository import GLib\n \n-def watch():\n-    bus = dbus.SystemBus()\n+RESCAN_DELAY_S = 2\n+\n+def on_resume(sleeping):\n+    if not sleeping:\n+        GLib.timeout_add_seconds(RESCAN_DELAY_S, rescan)\n+\n+def watch():\n+    bus = dbus.SystemBus()\n+    bus.add_signal_receiver(on_resume, "PrepareForSleep", "org.freedesktop.login1.Manager")\n     nm = bus.get_object(NM, NM_PATH)\n     return nm\n \ndiff --git a/hosts/linux/desktop/shell/WifiPage.qml b/hosts/linux/desktop/shell/WifiPage.qml\nindex 3..4 100644\n--- a/hosts/linux/desktop/shell/WifiPage.qml\n+++ b/hosts/linux/desktop/shell/WifiPage.qml\n@@ -22,6 +22,11 @@ Page {\n     ListView {\n         model: wifi.networks\n+        Connections {\n+            target: power\n+            function onResumed() { wifi.rescan() }\n+        }\n     }\n-    Component.onCompleted: wifi.rescan()\n+    Component.onCompleted: wifi.rescan()\n }\n';
  const listeners = { step: [] };
  const ok = (v) => Promise.resolve(v);
  const settings = { theme: opts.light ? 'light' : 'dark', textSize: 100, connection: {}, bins: {}, extraDirs: [], access: 'standard', autoPush: true, actForMe: true, previewNetwork: false, copyIdleHours: 24, tools: { web: true, build: true, quickChecks: ['node --check', 'node --test', 'python3 -m py_compile', 'bash -n'] }, team: null, ownerIdentity: { name: 'Dragongamer9', email: 'Dragongamer9@users.noreply.github.com', emails: ['Dragongamer9@users.noreply.github.com'] } };
  window.__calls = [];
  window.hearth = new Proxy({
    appInfo: () => ok({ appVersion: '1.5.0', dataPath: '/home/you/.config/Hearth AI Command Center', electron: '45', packaged: true }),
    settings: () => ok(settings),
    setSettings: (p) => { Object.assign(settings, p, p.tools ? { tools: { ...settings.tools, ...p.tools } } : {}); return ok({ ...settings }); },
    themeGet: () => ok({ found: false, tokens: {} }),
    v2Boot: () => ok({ migrated: true, notices: [] }),
    chatsList2: () => ok({ list: chats, notices: [], broken: false }),
    chatsTrash: () => ok(opts.trash ? [{ trashId: 'c0000000009-x1', title: 'Old test chat', deletedAt: ago(30) }] : []),
    chatsGet2: (id) => ok({ ok: true, messages: msgs[id] || [], sessions: {} }),
    chatsSave: () => ok(true),
    chatsUpdate: (id, p) => ok({ ...chats.find((c) => c.id === id), ...p }),
    chatsCreate2: (o) => { const e = { id: 'c00000000aa', title: o.title || 'New chat', titleAuto: true, repo: o.repo, branch: o.branch, createdAt: ago(0), updatedAt: ago(0) }; chats.unshift(e); return ok(e); },
    copiesStatus: () => ok({ exists: true, unpushed: false, dirty: 0, ahead: 0, base: 'main', work: 'hearth/fix-wi-fi-list-0001', head: 'c0ffee15d9a3b2e4f60718293a4b5c6d7e8f9012' }),
    providerStatus: () => ok({ encryption: true, keys: {} }),
    agentStatus: (a) => ok(['anthropic', 'openai', 'google'].includes(a) ? { installed: true, signedIn: true } : { installed: false, signedIn: false }),
    gitTools: () => ok({ git: '/usr/bin/git', gh: '/usr/bin/gh', ghUser: 'Dragongamer9' }),
    updaterInfo: () => ok({ enabled: true, install: 'appimage', status: { state: 'none', message: 'You are on the latest version.' } }),
    onUpdaterStatus: () => () => {}, onThemeChanged: () => () => {}, onCopiesIdle: () => () => {}, onCopiesRemoved: () => () => {}, onOpsPhoneAction: () => () => {},
    onChatStep: (cb) => { listeners.step.push(cb); return () => {}; },
    opsPhoneStatus: () => ok({ enabled: false }),
    ghRepos: () => ok({ ok: true, repos: [
      { full: 'Dragongamer9/hearth-os', private: false, pushedAt: ago(120), default: 'main' },
      { full: 'Dragongamer9/hearth-ai-command-center', private: false, pushedAt: ago(300), default: 'main' },
      { full: 'Dragongamer9/beacon', private: false, pushedAt: ago(8640), default: 'main' },
      { full: 'Dragongamer9/hearth-logs', private: true, pushedAt: ago(60), default: 'main' },
      { full: 'Dragongamer9/Tributary-Launcher', private: false, pushedAt: null, default: 'main' },
    ] }),
    ghBranches: () => ok({ ok: true, default: 'main', branches: ['main', 'bughunt', 'feature/storage'] }),
    chatDiff: () => ok({ ok: true, diff }),
    copiesList: () => ok({ ok: true, root: '/home/you/.config/Hearth AI Command Center/copies', idleHours: 24, list: [
      { chatId: 'c0000000001', repo: 'Dragongamer9/hearth-os', branch: 'main', work: 'hearth/fix-wi-fi-list-0001', size: 98 * 1048576, lastUsedAt: ago(2), unpushed: false },
      { chatId: 'c0000000002', repo: 'Dragongamer9/hearth-os', branch: 'main', work: 'hearth/storage-page-mockup-0002', size: 97 * 1048576, lastUsedAt: ago(20), unpushed: true, dirty: 1, ahead: 1 },
      { chatId: 'c0000000006', repo: 'Dragongamer9/hearth-ai-command-center', branch: 'main', work: 'hearth/command-center-crash-0006', size: 5 * 1048576, lastUsedAt: ago(1600), unpushed: false },
    ] }),
    savedBoards: () => ok([{ id: 'default', name: 'hearth-os', file: '/home/you/.config/Hearth AI Command Center/command-center-state.json', ok: true, tasks: [{ id: 'K7Q2MA', title: 'Add Settings › Storage page to Mantel', stage: 'approval', assignee: 'anthropic' }, { id: 'P3LX9Z', title: 'Fix Wi-Fi list not refreshing after resume', stage: 'implementing', assignee: 'openai' }], approvals: 3, audit: 412, chat: 230 }, { id: 'b7e1c2d3', name: 'beacon', file: '/home/you/.config/Hearth AI Command Center/projects/b7e1c2d3/command-center-state.json', ok: true, tasks: [], approvals: 0, audit: 12, chat: 18 }]),
    chatRun: (o) => {
      window.__calls.push(['chatRun', o]);
      const steps = [{ kind: 'search', label: 'Searched the repo', detail: 'for “storage”' }, { kind: 'read', label: 'Read', detail: 'StoragePage.qml' }];
      steps.forEach((s, i) => setTimeout(() => listeners.step.forEach((cb) => cb({ runId: o.runId, step: s })), 200 + i * 200));
      return new Promise((r) => setTimeout(() => r({ ok: true, text: o.agent === 'openai' ? 'Checked the change: it refreshes the list when a card is inserted. Looks right.' : 'Done: the drive list now refreshes.\n\n```html preview drives.html\n<h1 style="color:#22d3ee">Drives</h1>\n```', sessionId: 'sess-1', via: o.agent === 'openai' ? 'Codex' : 'Claude Code', changes: o.build === false ? null : { files: [{ path: 'StoragePage.qml', add: 3, del: 1 }], add: 3, del: 1, branch: 'hearth/storage-00aa', base: 'main' }, status: { exists: true, unpushed: true, ahead: 1, dirty: 0, base: 'main', work: 'hearth/storage-00aa', head: 'b'.repeat(40) }, previews: [] }), opts.sendHang ? 1e9 : 900));
    },
  }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? () => Promise.resolve(null) : undefined) });
  try { localStorage.setItem('hearth.v2.open', opts.open || ''); if (!opts.open) localStorage.removeItem('hearth.v2.open'); } catch {}
}

const SHOTS = [
  { file: '01-home.png', opts: {}, expect: ['Good ', 'What should the team work on?', 'Fix a bug in a repo', 'Prepare a release', 'Pinned', 'Today', 'Yesterday', 'Earlier'] },
  { file: '02-chat-working-on-a-repo.png', opts: { open: 'c0000000001' }, expect: ['Searched the repo', 'Read', 'Edited 2 files', 'committed as you', '2 files changed', 'Open pull request', 'Show changes', 'Merge into main', 'Ran the tests', 'in GitHub Actions', 'reviewer'] },
  { file: '03-live-preview.png', opts: { open: 'c0000000002' }, click: '[data-a="open-preview"]', expect: ['storage-page.html', 'Preview', 'Code', 'Download', 'Save to repo'], frame: true },
  { file: '04-connect-a-repo-and-attach.png', opts: {}, attach: true, click: '#composer-box [data-a="repo-pop"]', expect: ['Connect this chat to a GitHub repo', 'Dragongamer9/hearth-os', 'No repo, just talk', 'Branch'] },
  { file: '05-settings.png', opts: {}, click: '[data-a="settings"]', expect: ['AI team', 'Who\'s in your chats', 'Accounts', 'GitHub', 'Tools', 'Permissions', 'Appearance', 'App updates', 'Saved data'] },
  { file: '06-chat-light.png', opts: { open: 'c0000000001', light: true }, expect: ['2 files changed'] },
  { file: '07-diff-viewer.png', opts: { open: 'c0000000001' }, click: '[data-a="card-diff"]', expect: ['nm-watch.py', 'RESCAN_DELAY_S', 'WifiPage.qml'] },
  { file: '08-saved-data-temporary-copies.png', opts: { trash: true }, click: '[data-a="settings"]', then: '[data-a="tab"][data-t="data"]', expect: ['Temporary copies', 'Space used', '200 MB', 'not on GitHub', 'Clean up', 'Old boards (read-only)', 'hearth-os'] },
  { file: '09-actions-failed.png', opts: { open: 'c0000000001', failing: true }, expect: ['GitHub Actions failed', 'rescan was not called after resume', 'Ask the team to fix it'] },
  { file: '10-app-updates.png', opts: {}, click: '[data-a="settings"]', then: '[data-a="tab"][data-t="updates"]', expect: ['App updates', 'Check for updates', 'AppImage and the .deb'] },
  { file: '11-send-and-steps.png', opts: { open: 'c0000000002' }, send: 'Refresh the drive list when a card is inserted', expect: ['Done: the drive list now refreshes.', 'drives.html', 'Live preview'] },
];

const browser = await chromium.launch();
let failed = 0;
for (const s of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.addInitScript(stub, s.opts);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#side .brand');
  await page.waitForTimeout(300);
  if (s.attach) {
    await page.evaluate(() => {
      const dt = new DataTransfer();
      for (const [n, t] of [['log.txt', 'text/plain'], ['crash.png', 'image/png']]) dt.items.add(new File(['x'], n, { type: t }));
    });
    await page.evaluate(() => { window.hearth.attachSaveAny = (name) => Promise.resolve({ ok: true, att: { name, kind: name.endsWith('.png') ? 'file' : 'file', path: `/tmp/${name}` } }); });
    await page.fill('#composer', 'Here\'s the crash from my log, find the cause');
    await page.evaluate(async () => { const f = [new File(['x'], 'log.txt'), new File(['x'], 'crash.png')]; const ev = new Event('drop', { bubbles: true }); ev.dataTransfer = { files: f, types: ['Files'] }; document.dispatchEvent(ev); });
    await page.waitForTimeout(300);
  }
  if (s.click) { await page.click(s.click); await page.waitForTimeout(500); }
  if (s.then) { await page.click(s.then); await page.waitForTimeout(500); }
  if (s.send) { await page.fill('#composer', s.send); await page.keyboard.press('Enter'); await page.waitForTimeout(2200); }
  const text = (await page.evaluate(() => `${document.body.innerText}\n${[...document.querySelectorAll('[placeholder]')].map((e) => e.placeholder).join('\n')}`)).toLowerCase();
  const missing = (s.expect || []).filter((t) => !text.includes(t.toLowerCase()));
  if (s.frame) {
    const sandbox = await page.getAttribute('.pv-frame', 'sandbox');
    if (sandbox !== 'allow-scripts') missing.push(`iframe sandbox="${sandbox}"`);
  }
  await page.screenshot({ path: `${OUT}/${s.file}` });
  if (missing.length || errors.length) { failed++; console.log(`::error::${s.file}: missing ${JSON.stringify(missing)} errors ${JSON.stringify(errors)}`); }
  else console.log(`ok ${s.file}`);
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);

// CI-only screenshot harness for the 2.x chats layout. Serves the built renderer and
// replaces the Electron preload bridge (window.hearth) with harmless fake data. Nothing
// here ships in the app; it never signs in anywhere or touches real accounts.
// Fails (exit 1) when a page doesn't render what it should or the page throws.
import { mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.OUT_DIR || 'shots';
mkdirSync(OUT, { recursive: true });

// Small gradient pictures for the fake chats (made here, no files needed).
function crc(buf) { let c = -1; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (c ^ -1) >>> 0; }
function chunk(t, d) { const h = Buffer.alloc(8); h.writeUInt32BE(d.length); h.write(t, 4, 'latin1'); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([h.subarray(4), d]))); return Buffer.concat([h, d, c]); }
function gradient(w, h, a, b, c = null) {
  const head = Buffer.alloc(13); head.writeUInt32BE(w); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) { const r = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { const t = (x / w + y / h) / 2; const disc = c && Math.hypot(x - w * 0.5, y - h * 0.42) < h * 0.22; for (let i = 0; i < 3; i++) r[1 + x * 3 + i] = disc ? c[i] : Math.round(a[i] + (b[i] - a[i]) * t); } rows.push(r); }
  return `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]).toString('base64')}`;
}
const PICS = { fox: gradient(320, 220, [240, 140, 60], [90, 40, 120], [255, 230, 200]), castle: gradient(320, 220, [40, 60, 110], [200, 90, 140], [250, 220, 120]), chart: gradient(320, 200, [230, 240, 250], [120, 170, 230]), mira: gradient(240, 320, [70, 110, 90], [30, 40, 60], [230, 200, 170]), tobin: gradient(240, 320, [140, 90, 50], [40, 30, 30], [220, 180, 150]), ash: gradient(240, 320, [90, 90, 140], [20, 20, 40], [200, 200, 230]), scene: gradient(480, 300, [40, 70, 110], [10, 20, 40], [250, 200, 120]), persona: gradient(64, 64, [200, 120, 80], [120, 60, 40]) };

function stub(opts) {
  const P = opts.pics || {};
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
  // 2.x parity: pictures, rich answers, controls, teammates, roleplay.
  chats.push({ id: 'c0000000011', title: 'Fox pictures', createdAt: ago(30), updatedAt: ago(1) }, { id: 'c0000000012', title: 'Rich answer test', createdAt: ago(30), updatedAt: ago(1) }, { id: 'c0000000013', title: 'Venice art', createdAt: ago(30), updatedAt: ago(1) },
    { id: 'c0000000014', title: 'Mira', rp: { characters: ['a000000001'], players: { a000000001: 'venice' }, order: 'natural', lorebooks: [] }, createdAt: ago(30), updatedAt: ago(1) },
    { id: 'c0000000015', title: 'Mira, Tobin, Ash', rp: { characters: ['a000000001', 'a000000002', 'a000000003'], players: { a000000001: 'venice', a000000002: 'anthropic', a000000003: 'openai' }, order: 'natural', lorebooks: [] }, createdAt: ago(30), updatedAt: ago(1) },
    { id: 'c0000000016', title: 'Lena (story)', rp: { characters: ['a000000004'], players: { a000000004: 'anthropic' }, order: 'natural', lorebooks: [] }, createdAt: ago(30), updatedAt: ago(1) });
  const rich = 'Here\'s the comparison you asked for.\n\n| Device | RAM | Graphics |\n|---|---|---|\n| ROG Ally | 16 GB | Radeon 780M |\n| Laptop | 8 GB | Intel Iris Xe |\n\n```python\ndef rescan(delay=2):\n    """Rescan Wi-Fi after resume."""\n    time.sleep(delay)\n    return nm.scan()\n```\n\nThe wait grows like $t = 2^n$ seconds, and the total is $$\\sum_{n=0}^{3} 2^n = 15$$\n\n```mermaid\ngraph LR; Sleep-->Resume-->Rescan-->List\n```\n\n```chart\n{"type":"bar","title":"Rescans per day","labels":["Mon","Tue","Wed","Thu"],"series":[{"name":"rescans","data":[3,7,4,9]}]}\n```';
  msgs.c0000000011 = [
    { id: 'f1', who: 'owner', text: 'Make a picture of a red fox in the snow, and a short clip of it.', at: ago(5) },
    { id: 'f2', who: 'anthropic', role: 'lead', at: ago(4), via: 'Claude Code', text: 'Asked ChatGPT to draw it and Gemini (Veo) for the clip.', web: true, steps: [{ kind: 'web-read', label: 'Read a web page', detail: 'en.wikipedia.org', url: 'https://en.wikipedia.org/wiki/Red_fox' }] },
    { id: 'f3', who: 'openai', at: ago(3), via: 'ChatGPT (OpenAI Images)', text: 'Made for Claude: “a red fox in the snow at dusk”', media: [{ kind: 'image', name: 'image-fox.png', file: 'ab12cd34ef-image-fox.png', size: 210000, url: P.fox }] },
    { id: 'f4', who: 'google', at: ago(2), via: 'Veo (Gemini API)', text: 'Video for Claude: “the fox trots through snow”', media: [{ kind: 'video', name: 'video-fox.mp4', file: 'cd34ef56ab-video-fox.mp4', size: 3200000, url: 'data:video/mp4;base64,AAAAIGZ0eXBpc29t', poster: P.castle }] },
    { id: 'f5', who: 'anthropic', role: 'lead', at: ago(1), via: 'Claude Code', web: true, text: 'Both are below. I also wrote a short report with sources ([Wikipedia](https://en.wikipedia.org/wiki/Red_fox), https://www.nationalgeographic.com/animals/mammals/facts/red-fox).', media: [{ kind: 'file', name: 'report-red-fox.md', file: 'ef56ab78cd-report-red-fox.md', size: 18400, url: P.chart }], versions: [{ text: 'First try.' }, { text: 'Both are below.' }], v: 1, followUps: ['Make it a painting', 'Turn it into a wallpaper', 'Add a second fox'] },
  ];
  msgs.c0000000012 = [{ id: 'r1', who: 'owner', text: 'Compare my devices, show the maths, a diagram and a chart.', at: ago(3), branches: [{ text: 'Compare my devices.', tail: [] }, { text: 'Compare my devices, show the maths, a diagram and a chart.', tail: [] }], b: 1 }, { id: 'r2', who: 'anthropic', role: 'lead', at: ago(2), via: 'Claude Code', text: rich, followUps: ['Explain the formula', 'Make the chart a line chart'] }];
  msgs.c0000000013 = [{ id: 'v1', who: 'owner', text: '@Venice a dragon queen on her throne, fantasy art', at: ago(3), to: ['venice'] }, { id: 'v2', who: 'venice', at: ago(2), via: 'Venice · lustify-sdxl', text: 'Made: “a dragon queen on her throne, fantasy art”', media: [{ kind: 'image', name: 'venice-1.png', file: '12ab34cd56-venice-1.png', size: 400000, url: P.castle }, { kind: 'image', name: 'venice-2.png', file: '34cd56ef78-venice-2.png', size: 400000, url: P.fox }] }];
  msgs.c0000000014 = [{ id: 'g1', who: 'venice', char: 'a000000001', greeting: true, text: '*Mira looks up from the campfire and smiles.* "You found the camp, Drake. Sit, the stew is almost ready."', swipes: ['*Mira looks up from the campfire and smiles.* "You found the camp, Drake. Sit, the stew is almost ready."', '"Late again," *Mira teases.*'], sw: 0, at: ago(10) }, { id: 'g2', who: 'owner', text: 'I sit down and ask her about Emberfall.', at: ago(9) }, { id: 'g3', who: 'venice', char: 'a000000001', text: '*She stirs the pot, the firelight on her face.* "Emberfall was the old capital. Nobody goes there now… except fools and treasure hunters. Which are you?"', swipes: ['First reply.', '*She stirs the pot, the firelight on her face.* "Emberfall was the old capital. Nobody goes there now… except fools and treasure hunters. Which are you?"'], sw: 1, at: ago(8) }];
  msgs.c0000000015 = [{ id: 'h1', who: 'owner', text: 'Tobin, what do you think? Ash, keep watch.', at: ago(6) }, { id: 'h2', who: 'anthropic', char: 'a000000002', text: '*Tobin scratches his beard.* "I think we wait for dawn. Roads are no place at night."', at: ago(5) }, { id: 'h3', who: 'openai', char: 'a000000003', text: '*Ash climbs the rock and scans the dark.* "Nothing moves. Yet."', at: ago(4) }, { id: 'h4', who: 'venice', char: 'a000000001', text: '"Dawn it is," *Mira agrees, handing out bowls.*', at: ago(3) }];
  msgs.c0000000016 = [{ id: 'l1', who: 'anthropic', char: 'a000000004', greeting: true, text: '"Hi! Want to help me find my lost kite?"', at: ago(5) }, { id: 'l2', who: 'owner', text: 'something sexual', at: ago(4) }, { id: 'l3', who: 'system', block: true, text: 'Blocked: Lena reads as under 18 (it says the character is 12), so no sexual roleplay with this character. The card can still be used for non-sexual stories.', at: ago(4) }];
  const card = (id, name, pic, extra = {}) => ({ id, name, description: `${name} is a traveller of the north woods.`, personality: 'calm', scenario: 'A campfire on the road to Emberfall.', first_mes: `Hello, {{user}}. I'm ${name}.`, alternate_greetings: ['Evening.'], tags: ['fantasy', 'adventure'], creator: 'Dragongamer9', creator_notes: `A ${name.toLowerCase()} for long stories.`, avatarUrl: pic, spriteUrls: {}, limits: { minor: false, real: false }, lorebooks: [], ...extra });
  const CARDS = [card('a000000001', 'Mira', P.mira, { backgroundUrl: P.scene, character_book: { entries: [{}, {}] } }), card('a000000002', 'Tobin', P.tobin), card('a000000003', 'Ash', P.ash), card('a000000004', 'Lena', null, { description: 'Lena is 12 years old.', tags: ['slice of life'], limits: { minor: true, minorWhy: 'it says the character is 12' } })];
  const BOOKS = [{ id: 'b000000001', name: 'The North', scan_depth: 4, token_budget: 1024, entries: [{ name: 'Emberfall', keys: ['Emberfall', 'old capital'], content: 'Emberfall was the capital before the long winter.', insertion_order: 10, enabled: true }, { name: 'Winter', keys: [], content: 'Winter never ends in the north.', constant: true, insertion_order: 5, enabled: true }] }];
  const listeners = { step: [] };
  const ok = (v) => Promise.resolve(v);
  const settings = { notify: true, autoRead: false, maxChats: 3, customInstructions: { about: 'I build Hearth OS. My laptop has Intel graphics and 8 GB of RAM.', style: 'Plain language, short answers.' }, teammates: {}, theme: opts.light ? 'light' : 'dark', textSize: 100, connection: {}, bins: {}, extraDirs: [], access: 'standard', autoPush: true, actForMe: true, previewNetwork: false, copyIdleHours: 24, tools: { web: true, build: true, quickChecks: ['node --check', 'node --test', 'python3 -m py_compile', 'bash -n'] }, team: null, ownerIdentity: { name: 'Dragongamer9', email: 'Dragongamer9@users.noreply.github.com', emails: ['Dragongamer9@users.noreply.github.com'] } };
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
    teammatesStatus: () => ok({ ready: { venice: true, civitai: true, gpu: true }, keys: { venice: true, civitai: true }, servers: [{ id: 'aa11bb22', name: 'RunPod 4090', type: 'comfy', url: 'https://abc123-8188.proxy.runpod.net', model: 'sd_xl_base_1.0.safetensors', key: true }, { id: 'cc33dd44', name: 'Home server', type: 'openai', url: 'http://192.168.1.20:8000/v1', model: 'llama3.1-8b', key: false }], imagesOnly: { venice: false, civitai: true, gpu: false }, conf: { venice: { model: 'venice-uncensored-1-2', imageModel: 'lustify-sdxl' }, civitai: { engine: 'sdcpp', fields: '{"prompt": "{prompt}"}' } }, models: { venice: ['venice-uncensored-1-2', 'llama-3.3-70b'], veniceImage: ['lustify-sdxl', 'lustify-v7', 'lustify-v8'], civitaiEngines: ['sdcpp', 'comfy', 'flux2', 'qwen'] } }),
    mediaKeys: () => ok({ encryption: true, keys: { google: true, openai: true, xai: false, mistral: false }, screenshot: true, tts: 'espeak-ng', pdftotext: true }),
    memoryList: () => ok({ facts: [{ id: 'm1', text: 'The owner picks every version number.', at: ago(3000), by: 'owner' }, { id: 'm2', text: 'Commit only as Dragongamer9, no AI lines.', at: ago(2000), by: 'owner' }, { id: 'm3', text: 'His laptop has Intel graphics and about 8 GB of RAM.', at: ago(60), by: 'owner', suggestedBy: 'anthropic' }], pending: [{ id: 'p1', text: 'Prefers short answers in plain language.', agent: 'openai', at: ago(5) }], broken: null }),
    memoryPrompt: () => ok(''),
    scheduleList: () => ok({ list: [{ id: 's1', title: 'Check new crash logs', kind: 'daily', time: '09:00', chatId: 'c0000000006', enabled: true, nextRun: Date.now() + 3600e3, lastRun: ago(1440), lastResult: 'ok' }, { id: 's2', title: 'Weekly release notes draft', kind: 'weekly', days: [5], time: '17:30', chatId: 'c0000000004', enabled: false, nextRun: null }], broken: null }),
    connectorsList: () => ok({ list: [{ id: 'k1', name: 'github', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], enabled: true, secrets: [{ kind: 'env', key: 'GITHUB_PERSONAL_ACCESS_TOKEN', saved: true }] }, { id: 'k2', name: 'docs', type: 'http', url: 'https://mcp.example.com/mcp', enabled: false, secrets: [{ kind: 'header', key: 'Authorization', saved: true }] }], broken: null }),
    skillsList: () => ok([{ name: 'release-notes', description: 'Draft plain-language release notes', where: 'yours (~/.claude/skills)' }]),
    habitatGet: () => ok({ store: null }),
    cardsList: () => ok({ list: CARDS }),
    loreList: () => ok(BOOKS),
    rpPersona: () => ok({ name: 'Drake', description: 'A wandering cartographer.', avatarUrl: P.persona }),
    cardsImport: (name) => { const c = card('a00000000' + (CARDS.length + 1), 'Seren', P.ash, { tags: ['imported', 'v3'] }); CARDS.push(c); return ok({ card: c }); },
    chatRun: (o) => {
      window.__calls.push(['chatRun', o]);
      if (opts.hang && opts.hang.includes(o.chatId)) return new Promise(() => {});
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
  // 2.x parity
  { file: '12-habitat-in-sidebar.png', opts: { open: 'c0000000001' }, click: '[data-a="habitat"]', wait: 1500, expect: ['Habitat', 'Fix Wi-Fi list after resume'], canvas: '#habitat canvas' },
  { file: '13-picture-video-file-in-chat.png', opts: { open: 'c0000000011' }, expect: ['image-fox.png', 'video-fox.mp4', 'report-red-fox.md', 'Download', 'Save to repo', 'Open', 'Sources'], selector: ['.media img', '.media video', '.filec'] },
  { file: '14-rich-answer.png', opts: { open: 'c0000000012' }, bypassCSP: true, wait: 2500, expect: ['ROG Ally', 'Intel Iris Xe', 'def', 'Copy', 'Rescans per day'], selector: ['.tbl-wrap table', '.hljs-keyword', '.katex', '.dg-frame', '.chart-svg'] },
  { file: '15-controls-sources-followups.png', opts: { open: 'c0000000011' }, click: '.sources summary', expect: ['2/2', 'Sources', 'wikipedia.org', 'Make it a painting', 'Turn it into a wallpaper'], selector: ['[data-a="msg-retry"]', '[data-a="msg-edit"]', '[data-a="follow"]'] },
  { file: '16-settings-memory.png', opts: {}, click: '[data-a="settings"]', then: '[data-a="tab"][data-t="memory"]', expect: ['Custom instructions', 'Memory across chats', 'The owner picks every version number.', 'Prefers short answers', 'Remember', 'Delete'] },
  { file: '17-settings-scheduled.png', opts: {}, click: '[data-a="settings"]', then: '[data-a="tab"][data-t="scheduled"]', expect: ['Scheduled tasks', 'Check new crash logs', 'every day at 09:00', 'New scheduled task', 'Create'] },
  { file: '18-settings-connectors.png', opts: {}, click: '[data-a="settings"]', then: '[data-a="tab"][data-t="connectors"]', expect: ['Connectors (MCP servers)', 'github', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'Add a connector', 'encrypted store'] },
  { file: '19-settings-accounts-teammates.png', opts: {}, click: '[data-a="settings"]', then: '[data-a="tab"][data-t="accounts"]', scrollTo: '.box:nth-of-type(3)', expect: ['More teammates', 'Venice', 'Civitai', 'Your GPU servers', 'RunPod 4090', 'NovelAI isn\'t offered', 'Pictures, videos and documents'] },
  { file: '20-two-chats-working-one-unread.png', opts: { open: 'c0000000003', hang: ['c0000000003', 'c0000000004'] }, run: 'multi', expect: ['replying…', '2 working'], selector: ['.item .dot'] },
  { file: '21-venice-picture.png', opts: { open: 'c0000000013' }, expect: ['Venice', 'not shown to your other AIs', 'venice-1.png'], selector: ['.media img'] },
  { file: '22-canvas.png', opts: { open: 'c0000000002' }, click: '[data-a="open-canvas"]', expect: ['Canvas', 'Save version', 'Ask the team to change it'], selector: ['#canvas-text'] },
  { file: '23-follow-up-chips.png', opts: { open: 'c0000000012' }, bypassCSP: true, wait: 1500, scrollBottom: true, expect: ['Explain the formula', 'Make the chart a line chart', '2/2'] },
  // roleplay
  { file: '24-character-library.png', opts: {}, click: '[data-a="characters"]', expect: ['Characters', 'Mira', 'Tobin', 'Ash', 'Lena', 'Start chat', 'Import', 'Create', 'Your persona: Drake', 'stories only'] },
  { file: '25-roleplay-chat-swipe.png', opts: { open: 'c0000000014' }, expect: ['Mira', 'played by Venice', '2/2', 'Emberfall', 'Impersonate', 'Picture', 'Visual novel'], selector: ['img.cav', '[data-a="rp-swipe"]'] },
  { file: '26-roleplay-group.png', opts: { open: 'c0000000015' }, expect: ['Tobin', 'Ash', 'Mira', 'played by Claude', 'played by ChatGPT', 'group'] },
  { file: '27-visual-novel.png', opts: { open: 'c0000000014' }, click: '[data-a="rp-vn"]', expect: ['Mira', 'Emberfall'], selector: ['.vn', '.vn-art', '.vn-box'] },
  { file: '28-lorebook-editor.png', opts: {}, click: '[data-a="characters"]', then: '[data-a="lorebooks"]', then2: '[data-a="lore-edit"]', expect: ['The North', 'Scan depth', 'Token budget', 'Always on', 'Add entry'], selector: ['[data-le="0"][data-k="keys"]', 'textarea[data-k="content"]'] },
  { file: '29-card-import.png', opts: {}, click: '[data-a="characters"]', run: 'import', expect: ['Imported Seren', 'Seren'] },
  { file: '30-minor-block.png', opts: { open: 'c0000000016' }, expect: ['Blocked: Lena reads as under 18', 'non-sexual stories'], selector: ['.msg-s.block'] },
];

const browser = await chromium.launch();
let failed = 0;
for (const s of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, bypassCSP: Boolean(s.bypassCSP) });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.addInitScript(stub, { ...s.opts, pics: PICS });
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
  if (s.then2) { await page.click(s.then2); await page.waitForTimeout(500); }
  if (s.run === 'multi') {
    // Two chats working (they never finish here) and a third whose answer arrives while another is open.
    await page.fill('#composer', 'Fix the GRUB theme'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    await page.click('[data-chat="c0000000004"]'); await page.waitForTimeout(300);
    await page.fill('#composer', 'Draft the release notes'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    await page.click('[data-chat="c0000000005"]'); await page.waitForTimeout(300);
    await page.fill('#composer', 'Ideas for the weekend?'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    await page.click('[data-chat="c0000000001"]'); await page.waitForTimeout(4000);
  }
  if (s.run === 'import') {
    await page.evaluate(() => { const ev = new Event('drop', { bubbles: true }); ev.dataTransfer = { files: [new File(['x'], 'seren.png', { type: 'image/png' })], types: ['Files'] }; document.dispatchEvent(ev); });
    await page.waitForTimeout(800);
  }
  if (s.scrollTo) { await page.evaluate((q) => document.querySelector(q)?.scrollIntoView(), s.scrollTo); await page.waitForTimeout(200); }
  if (s.scrollBottom) { await page.evaluate(() => { const b = document.getElementById('body'); b.scrollTop = b.scrollHeight; }); await page.waitForTimeout(200); }
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.send) { await page.fill('#composer', s.send); await page.keyboard.press('Enter'); await page.waitForTimeout(2200); }
  const text = (await page.evaluate(() => `${document.body.innerText}\n${[...document.querySelectorAll('[placeholder]')].map((e) => e.placeholder).join('\n')}`)).toLowerCase();
  const missing = (s.expect || []).filter((t) => !text.includes(t.toLowerCase()));
  for (const q of s.selector || []) if (!(await page.$(q))) missing.push(`element ${q}`);
  if (s.canvas && !(await page.$(s.canvas))) missing.push(`canvas ${s.canvas}`);
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

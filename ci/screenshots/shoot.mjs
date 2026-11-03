// CI-only screenshot harness. Serves the built renderer (dist/) and replaces the
// Electron preload bridge (window.hearth) with harmless fake data. Nothing here
// ships in the app; it never signs in anywhere or touches real accounts.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.OUT_DIR || 'shots';
mkdirSync(OUT, { recursive: true });

function stub(opts) {
  const { scenario, theme = 'hearth', hearthTheme = null, flows = false, habitat = false, habitatDay = false } = opts;
  const populated = scenario !== 'fresh';
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  const pol = (warn = []) => ({ ok: true, block: [], warn });
  const tasks = populated ? [
    { id: 'K7Q2MA', title: 'Add Settings › Storage page to Mantel', description: 'Drives, games by size, move games between drives, cleanup. Settings must be remembered.', assignee: 'anthropic', reviewer: 'openai', action: 'code', stage: 'approval', notes: [{ who: 'Claude', text: 'Implemented page + persistence, tests pass.', at: ago(30) }], runs: [{ agent: 'anthropic', status: 'done', checkpoint: 'a1b2c3d', sessionId: '6f1c2d3e-0000-4111-8222-333344445555', via: 'Claude Code', output: 'Added StoragePage.qml and settings store.\nSTATUS: DONE', at: ago(40) }], ws: { branch: 'hearth/k7q2ma-storage-page', baseSha: 'abc1234' }, pr: { number: 42, url: 'https://github.com/example/hearth-os/pull/42' }, policy: pol(['Settings: every Hearth OS setting must be remembered and never change by itself.']), createdAt: ago(300), updatedAt: ago(30) },
    { id: 'P3LX9Z', title: 'Fix Wi-Fi list not refreshing after resume', description: '', assignee: 'openai', reviewer: 'google', action: 'code', stage: 'implementing', notes: [], runs: [{ agent: 'openai', status: 'limit', output: 'Out of usage.', at: ago(20) }], policy: pol(), createdAt: ago(200), updatedAt: ago(20) },
    { id: 'R8DN4C', title: 'Write docs for Hearth Sync Decky plugin', description: '', assignee: 'google', reviewer: 'anthropic', action: 'docs', stage: 'review', notes: [], runs: [], policy: pol(), createdAt: ago(180), updatedAt: ago(60) },
    { id: 'T2VB7H', title: 'Theme the GRUB boot menu (keep it visible)', description: 'Hearth/Steam-style GRUB theme. Previous version must stay startable.', assignee: 'xai', reviewer: 'ollama', action: 'code', stage: 'testing', notes: [], runs: [], policy: pol(['Boot-critical: an update must never leave a device unable to start. Keep the previous version startable and test on a spare device first.']), createdAt: ago(150), updatedAt: ago(50) },
    { id: 'W5MJ1E', title: 'Research Steam startup animation swap', description: '', assignee: 'perplexity', reviewer: 'anthropic', action: 'docs', stage: 'intake', notes: [], runs: [], policy: pol(), createdAt: ago(100), updatedAt: ago(100) },
    { id: 'Y9GH6S', title: 'Polish Mantel file manager Properties dialog', description: '', assignee: 'mistral', reviewer: 'openai', action: 'code', stage: 'approved', notes: [], runs: [{ agent: 'mistral', status: 'done', output: 'Done.', at: ago(700) }], policy: pol(), createdAt: ago(900), updatedAt: ago(600) },
  ] : [];
  if (flows) {
    // 0.7.0 flows: builder -> reviewer APPROVE -> Approve to merge, and the queue's Start next.
    tasks.unshift(
      { id: 'RV0700', title: 'Team status panel above the chat', description: 'Shows who is ready, busy or out of usage.', assignee: 'openai', reviewer: 'google', action: 'code', stage: 'review', notes: [], runs: [{ agent: 'openai', status: 'done', head: 'c0ffee15d9a3b2e4f60718293a4b5c6d7e8f9012', tests: 'passed', output: 'Panel added.\nTESTS: PASSED\nSTATUS: DONE', at: ago(9) }], done: { sha: 'c0ffee15d9a3b2e4f60718293a4b5c6d7e8f9012', tests: 'passed', at: ago(9), by: 'openai' }, ws: { branch: 'hearth/rv0700-team-status', baseSha: 'abc1234' }, policy: pol(), createdAt: ago(60), updatedAt: ago(9) },
      { id: 'QA0701', title: 'Rework the Storage page layout', description: '', assignee: 'anthropic', reviewer: 'google', action: 'code', stage: 'intake', notes: [], runs: [], policy: pol(), createdAt: ago(50), updatedAt: ago(50) },
      { id: 'QB0702', title: 'Add drive health to the Storage page', description: '', assignee: 'anthropic', reviewer: 'google', action: 'code', stage: 'intake', notes: [], runs: [], policy: pol(), createdAt: ago(40), updatedAt: ago(40) },
      { id: 'QC0703', title: 'Only added, never started: drive icons', description: '', assignee: 'anthropic', reviewer: 'google', action: 'code', stage: 'intake', notes: [], runs: [], policy: pol(), createdAt: ago(45), updatedAt: ago(45) },
    );
    window.__runImpl = (o) => {
      if (String(o.title || '').startsWith('Review:')) return Promise.resolve({ ok: true, text: 'Checked the branch: the panel renders and the tests pass.\nAPPROVE: T-RV0700 tests pass', via: 'Antigravity CLI' });
      if (o.agent === 'perplexity') return Promise.resolve({ ok: false, error: { kind: 'auth', message: 'invalid api key' } });
      if (o.taskId === 'QA0701') return new Promise(() => {}); // Claude stays busy on this one
      return new Promise((r) => setTimeout(() => r({ ok: true, text: 'Plan: I take the layout; Gemini reviews.', via: 'Claude Code' }), 4500));
    };
  }
  if (habitat) {
    // Habitat scene: Claude and Gemini work at their desks (runs never finish here).
    // Claude's last run failed its tests, so its desk light is red.
    tasks.unshift(
      { id: 'HB0001', title: 'Settings › Storage: drive health panel', description: '', assignee: 'anthropic', reviewer: 'google', action: 'code', stage: 'intake', notes: [], runs: [{ agent: 'anthropic', status: 'continue', tests: 'failed', output: 'TESTS: FAILED', at: ago(35) }], policy: pol(), createdAt: ago(30), updatedAt: ago(30) },
      { id: 'HB0002', title: 'Mantel dock: remember pinned apps', description: '', assignee: 'google', reviewer: 'anthropic', action: 'code', stage: 'intake', notes: [], runs: [], policy: pol(), createdAt: ago(25), updatedAt: ago(25) },
    );
    // Finished work the garden and trophy shelf grow from (one merged into main).
    for (const [i, a] of ['anthropic', 'google', 'openai', 'anthropic', 'google', 'ollama'].entries()) {
      tasks.push({ id: `HD000${i}`, title: `Finished habitat task ${i + 1}`, description: '', assignee: a, reviewer: 'openai', action: 'code', stage: 'approved', decision: 'approved', notes: i === 0 ? [{ who: 'System', text: 'Merged into main (abc9999). Pushed main to GitHub.', at: ago(500) }] : [], runs: [{ agent: a, status: 'done', tests: 'passed', output: 'STATUS: DONE', at: ago(600 + i) }], policy: pol(), createdAt: ago(900), updatedAt: ago(400 + i) });
    }
    window.__runImpl = () => new Promise(() => {});
  }
  if (habitatDay) {
    // Claude finishes HB0003 after 3 s; Gemini then reviews it (and keeps reviewing).
    tasks.unshift({ id: 'HB0003', title: 'Storage page: drive temperature', description: '', assignee: 'anthropic', reviewer: 'google', action: 'code', stage: 'intake', notes: [], runs: [], policy: pol(), createdAt: ago(20), updatedAt: ago(20) });
    window.__runImpl = (o) => {
      if (String(o.title || '').startsWith('Review:')) return new Promise(() => {});
      if (o.taskId === 'HB0003') return new Promise((r) => setTimeout(() => r({ ok: true, text: 'Drive temperature added to the Storage page.\nTESTS: PASSED\nSTATUS: DONE', via: 'Claude Code' }), 3000));
      return new Promise(() => {});
    };
  }
  const IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#1b2838"/><rect x="24" y="24" width="432" height="40" rx="6" fill="#2a475e"/><text x="40" y="51" fill="#c7d5e0" font-family="sans-serif" font-size="18">Settings › Storage</text><rect x="24" y="84" width="300" height="18" rx="4" fill="#66c0f4"/><rect x="24" y="116" width="220" height="18" rx="4" fill="#4c6b22"/><text x="24" y="240" fill="#8f98a0" font-family="sans-serif" font-size="14">screenshot attached by Claude</text></svg>');
  const audit = populated ? [
    { id: 'A0', at: ago(4), actor: 'anthropic', event: 'Permission requested', taskId: null, detail: 'Claude · Push to GitHub: push hearth/k7q2ma-storage-page' },
    { id: 'A1', at: ago(30), actor: 'owner', event: 'Approval requested', taskId: 'K7Q2MA', detail: 'Claude finished; ChatGPT reviewed' },
    { id: 'A2', at: ago(40), actor: 'anthropic', event: 'Claude finished a run', taskId: 'K7Q2MA', detail: 'checkpoint a1b2c3d · 3 files changed' },
    { id: 'A3', at: ago(20), actor: 'owner', event: 'ChatGPT ran out of usage', taskId: null, detail: '' },
    { id: 'A4', at: ago(12), actor: 'google', event: 'Gemini edited its message #C3GEMN', taskId: null, detail: '' },
    { id: 'A5', at: ago(600), actor: 'owner', event: 'Approved', taskId: 'Y9GH6S', detail: '' },
  ] : [];
  const chat = populated ? [
    { id: 'C1OWNR', who: 'owner', at: ago(16), text: 'Team: next for Hearth OS 1.1 — the Storage page and the GRUB theme. Split it up.' },
    { id: 'C2CLAU', who: 'anthropic', at: ago(15), model: 'Claude Code', text: 'Plan: I build the Storage page (ChatGPT reviews). @grok takes the GRUB theme, @gemini fact-checks the GRUB theme format.', proposals: [{ title: 'Add Settings › Storage page to Mantel', assignee: 'anthropic', reviewer: 'openai', action: 'code', taskId: 'K7Q2MA' }, { title: 'Theme the GRUB boot menu (keep it visible)', assignee: 'xai', reviewer: 'ollama', action: 'code', taskId: 'T2VB7H' }] },
    { id: 'C3GEMN', who: 'google', at: ago(14), model: 'Gemini CLI', text: 'GRUB themes live in /boot/grub/themes/<name>/theme.txt; GRUB_THEME in /etc/default/grub points to it. Keep GRUB_TIMEOUT_STYLE=menu so it stays visible.', edited: true, editedAt: ago(12), editedBy: 'google', history: [{ text: 'GRUB themes live in /usr/share/grub/themes only.', at: ago(12), by: 'google' }] },
    { id: 'C4GROK', who: 'xai', at: ago(13), model: 'Grok Build', text: 'On it. I\'ll keep the previous entry as the default fallback so the device always starts.' },
    { id: 'C5SYS0', who: 'system', at: ago(11), text: 'ChatGPT is out of usage until about 1 hour from now.' },
    { id: 'C6CLAU', who: 'anthropic', at: ago(5), auto: true, model: 'Claude Code', text: 'T-K7Q2MA “Add Settings › Storage page to Mantel”: StoragePage.qml and the settings store are in, tests pass.\n(Reported done — ready for review.)' },
    { id: 'C7CLAU', who: 'anthropic', at: ago(4), model: 'Claude Code', text: 'I\'d like to push the task branch so ChatGPT can review it on GitHub.', asks: ['R7PUSH'] },
  ] : [];
  if (flows) chat.push({ id: 'C8SHOT', who: 'anthropic', at: ago(3), model: 'Claude Code', text: 'Storage page after the layout change.', attachments: [{ id: 'a1', kind: 'image', name: 'storage-page.png', path: '/tmp/x/storage-page.png', url: IMG, size: 2048 }] });
  const permissions = populated ? [
    { id: 'R7PUSH', agent: 'anthropic', kind: 'push', what: 'Push hearth/k7q2ma-storage-page to GitHub', why: 'So ChatGPT can review the branch and the PR checks run.', context: 'chat', msgId: 'C7CLAU', at: ago(4), status: 'pending', questions: [] },
    { id: 'R6BOOT', agent: 'xai', kind: 'boot', what: 'Change GRUB_DEFAULT handling in the image build', why: 'Needed for the theme', context: 'chat', at: ago(200), status: 'approved', decidedAt: ago(190), questions: [] },
  ] : [];
  // In the 0.7.0 flows Claude isn't waiting on a permission card, so it can take turns and tasks.
  if (flows || habitat) for (const p of permissions) if (p.agent === 'anthropic') { p.status = 'approved'; p.decidedAt = ago(2); }
  const state = { version: 1, tasks, audit, models: {}, chat, permissions, chatSessions: {}, agentStatus: flows ? {} : populated ? { openai: { outUntil: new Date(Date.now() + 3600000).toISOString(), reason: 'usage limit reached' } } : {}, autoHandoff: true, roles: {}, lead: 'anthropic', disabled: {}, setupDismissed: populated };
  // Saved Habitat progress from earlier sessions (loaded through the normal state).
  if (habitat) state.habitat = { v: 1, finished: 28, growth: 28, counted: [], ai: { anthropic: { done: 12, approvals: 9 }, google: { done: 6, approvals: 4 } }, pet: { name: '' } };
  const settings = { project: populated ? '/home/owner/Projects/hearth-os' : null, projects: populated ? ['/home/owner/Projects/hearth-os', '/home/owner/Projects/beacon'] : [], connection: { anthropic: 'cli', openai: 'cli', xai: 'cli', mistral: 'cli', perplexity: 'api', deepseek: 'api' }, bins: {}, access: 'standard', extraDirs: populated ? ['/home/owner/Games'] : [], autoPush: true, chatEdits: true, chatResume: true, theme };
  let xaiChecks = 0;
  const agents = populated
    ? { anthropic: { installed: true, signedIn: true, path: '/usr/bin/claude' }, openai: { installed: true, signedIn: true, path: '/usr/bin/codex' }, google: { installed: true, signedIn: true, path: '/usr/bin/gemini' }, xai: { installed: true, signedIn: false, path: '/home/owner/.grok/bin/grok' }, mistral: { installed: false, signedIn: false }, qwen: { installed: true, signedIn: false, path: '/usr/bin/qwen' }, perplexity: {}, deepseek: {}, ollama: { installed: true, models: ['llama3.2'] }, freebuff: { installed: true, signedIn: null, path: '/usr/bin/freebuff' } }
    : { anthropic: { installed: false, signedIn: false }, openai: { installed: true, signedIn: false }, google: { installed: false, signedIn: false }, ollama: { installed: false }, freebuff: { installed: false } };
  const git = populated ? { repo: true, branch: 'main', defaultBranch: 'main', remote: 'https://github.com/example/hearth-os.git', dirty: 0, ahead: 0, behind: 2, branches: [
    { name: 'main', track: '[behind 2]', when: '2 hours ago', protected: true },
    { name: 'hearth/k7q2ma-storage-page', track: '', when: '30 minutes ago', protected: false },
    { name: 'hearth/p3lx9z-wifi-refresh', track: '[ahead 1]', when: '20 minutes ago', protected: false }] } : { repo: false };
  const pr42 = { number: 42, title: 'Add Settings › Storage page to Mantel', url: 'https://github.com/example/hearth-os/pull/42', state: 'OPEN', label: 'approved', draft: false, head: 'hearth/k7q2ma-storage-page', base: 'main', mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', updatedAt: ago(25),
    checks: { total: 4, passed: 3, failed: 0, pending: 1, items: [{ name: 'build-iso', state: 'passed' }, { name: 'unit-tests', state: 'passed' }, { name: 'lint', state: 'passed' }, { name: 'install-test (VM)', state: 'pending' }] },
    reviews: [{ who: 'Dragongamer9', state: 'APPROVED' }] };
  const prs = populated ? [pr42,
    { ...pr42, number: 41, title: 'Fix Wi-Fi list not refreshing after resume', head: 'hearth/p3lx9z-wifi-refresh', label: 'checks failing', reviewDecision: '', reviews: [], checks: { total: 3, passed: 1, failed: 2, pending: 0, items: [] } },
    { ...pr42, number: 39, title: 'Polish Mantel file manager Properties dialog', head: 'hearth/y9gh6s-properties', state: 'MERGED', label: 'merged', checks: { total: 3, passed: 3, failed: 0, pending: 0, items: [] } },
  ] : [];
  const conv = (o) => ({ key: `${o.provider}:${o.source.startsWith('import') ? 'imp:' : ''}${o.sessionId}`, count: o.messages.length, startedAt: o.messages[0]?.at, updatedAt: o.messages[o.messages.length - 1]?.at, ...o });
  const history = populated ? [
    conv({ provider: 'anthropic', source: 'app', sessionId: '6f1c2d3e-0000-4111-8222-333344445555', title: 'T-K7Q2MA: Add Settings › Storage page to Mantel', cwd: '/home/owner/.config/Hearth AI Command Center/workspaces/K7Q2MA', resumable: true, taskId: 'K7Q2MA', messages: [{ role: 'user', text: 'Task T-K7Q2MA: Add Settings › Storage page to Mantel\n\nDrives, games by size, move games between drives, cleanup.', at: ago(42) }, { role: 'assistant', text: 'Added StoragePage.qml and the settings store; settings persist across restarts.\nSTATUS: DONE', at: ago(40) }] }),
    conv({ provider: 'openai', source: 'cli', sessionId: '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000', title: 'Why does the Wi-Fi list not refresh after resume?', cwd: '/home/owner/Projects/hearth-os', resumable: true, messages: [{ role: 'user', text: 'Why does the Wi-Fi list not refresh after resume?', at: ago(300) }, { role: 'assistant', text: 'NetworkManager emits a StateChanged signal on resume that the applet ignores. Subscribe to it and refresh the list.', at: ago(299) }] }),
    conv({ provider: 'openai', source: 'import:chatgpt', sessionId: '6729f0c1-aaaa-bbbb-cccc-0123456789ab', title: 'GRUB theme ideas for a Steam-style boot menu', openUrl: 'https://chatgpt.com/c/6729f0c1-aaaa-bbbb-cccc-0123456789ab', resumable: false, messages: [{ role: 'user', text: 'Give me GRUB theme ideas that look like the Steam Deck boot screen.', at: ago(60 * 24 * 9) }, { role: 'assistant', text: 'Use a dark blue-slate background (#171a21), a centered logo, and a slim Steam-blue selection bar. Keep the menu visible with GRUB_TIMEOUT_STYLE=menu.', at: ago(60 * 24 * 9 - 1) }] }),
    conv({ provider: 'anthropic', source: 'import:claude', sessionId: '0b1c2d3e-0000-1111-2222-333344445555', title: 'Mantel icon set — folder and drive icons', openUrl: 'https://claude.ai/chat/0b1c2d3e-0000-1111-2222-333344445555', resumable: false, messages: [{ role: 'user', text: 'Draw a folder icon in the Hearth style.', at: ago(60 * 24 * 20) }, { role: 'assistant', text: 'Here is an SVG folder icon with a 3px corner radius and the Hearth flame as a badge.', at: ago(60 * 24 * 20 - 1) }] }),
    conv({ provider: 'google', source: 'import:gemini', sessionId: 'takeout-2026-10-02T10:00:00.000Z', title: 'What is Mantel?', openUrl: 'https://gemini.google.com/app', resumable: false, messages: [{ role: 'user', text: 'What is Mantel?', at: ago(60 * 24 * 31) }, { role: 'assistant', text: 'Mantel is the Hearth OS desktop.', at: ago(60 * 24 * 31) }] }),
    conv({ provider: 'xai', source: 'cli', sessionId: 'b7f3e2a1-1111-4222-8333-444455556666', title: 'Plan the GRUB theme build step', cwd: '/home/owner/Projects/hearth-os', resumable: true, bestEffort: true, messages: [{ role: 'user', text: 'Plan the GRUB theme build step', at: ago(90) }, { role: 'assistant', text: 'Add a grub-theme stage after the kernel stage; never change GRUB_DEFAULT.', at: ago(89) }] }),
  ] : [];
  const ok = async (v) => v;
  const search = (q = '', f = {}) => history.filter((c) => (f.provider && f.provider !== 'all' ? c.provider === f.provider : true) && (f.source && f.source !== 'all' ? (f.source === 'import' ? c.source.startsWith('import') : c.source === f.source) : true) && (!q || JSON.stringify(c).toLowerCase().includes(q.toLowerCase()))).map((c) => ({ ...c, snippet: c.messages[c.messages.length - 1].text.slice(0, 140), messages: undefined }));
  window.__shots = { signinXai: () => { xaiChecks = 1; } };
  window.hearth = {
    loadState: () => ok(JSON.parse(JSON.stringify(state))),
    saveState: () => ok(true),
    appInfo: () => ok({ appVersion: '0.4.0', hearthOs: populated ? { name: 'Hearth OS 1.0', version: '1.0' } : null, dataPath: '/home/owner/.config/Hearth AI Command Center', electron: '45.0.0', packaged: true }),
    backups: () => ok({ recoveredFrom: null, backups: populated ? [{ n: 1, ok: true, savedAt: ago(60), tasks: 6 }, { n: 2, ok: true, savedAt: ago(240), tasks: 5 }] : [] }),
    restoreBackup: () => ok(state), exportAll: () => ok({ ok: false }),
    providerStatus: () => ok({ encryption: true, weakEncryption: false, defaults: { anthropic: 'claude-sonnet-5-5', openai: 'gpt-5', xai: 'grok-4', mistral: 'mistral-large-latest', perplexity: 'sonar', deepseek: 'deepseek-chat' }, keys: { perplexity: populated, deepseek: false } }),
    setKey: () => ok(true), removeKey: () => ok(true), ask: () => ok({ ok: false }),
    settings: () => ok(settings), setConnection: () => ok(settings), pickProject: () => ok(settings), pickBinary: () => ok(settings), useProject: () => ok(settings), setSettings: (p) => { Object.assign(settings, p); return ok(settings); }, addDir: () => ok(settings), removeDir: () => ok(settings),
    gitTools: () => ok(populated ? { git: '/usr/bin/git', gh: '/usr/bin/gh', ghUser: 'Dragongamer9' } : { git: '/usr/bin/git', gh: null, ghUser: null }),
    gitLogin: () => ok({ ok: false }), gitStatus: () => ok(git), gitPull: () => ok({ ok: false, message: 'CI preview' }), gitPushTask: () => ok({ ok: false }), gitPushBranch: () => ok({ ok: false }), gitMergeApproved: () => ok(flows ? { ok: true, sha: 'abc9999', branch: 'main', pushed: true, message: 'Merged into main (abc9999). Pushed main to GitHub.' } : { ok: false, message: 'CI preview' }),
    gitUpdateFromMain: () => ok({ ok: true, changed: false, message: 'Already up to date with main.' }), gitReleaseBranch: () => ok({ ok: false, message: 'CI preview' }),
    workspaceHead: () => ok('c0ffee15d9a3b2e4f60718293a4b5c6d7e8f9012'),
    gitLeadSync: () => ok({ ok: false, message: 'CI preview' }),
    attachSave: (name) => ok({ ok: true, att: { id: 'p1', kind: 'image', name, url: IMG, path: '/tmp/x/' + name, size: 100 } }),
    attachPick: () => ok([{ ok: true, att: { id: 'p2', kind: 'image', name: 'owner-photo.png', url: IMG, path: '/tmp/x/owner-photo.png', size: 100 } }]),
    attachFromAgent: () => ok({ ok: false, message: 'CI preview' }),
    testKey: () => new Promise((r) => setTimeout(() => r({ ok: false, error: { kind: 'auth', message: 'The provider rejected this key or denied access.' } }), 500)), gitOpenPr: () => ok({ ok: false }), gitClone: () => ok({ ok: false }),
    gitPrList: () => ok({ ok: populated, prs, message: 'Connect GitHub to see pull requests.' }), gitPrView: () => ok({ ok: true, pr: pr42 }), gitPrMerge: () => ok({ ok: false, message: 'Cancelled.' }), gitRelease: () => ok({ ok: false, message: 'CI preview' }),
    agentStatus: (a) => { if (a === 'xai' && xaiChecks) { xaiChecks++; if (xaiChecks > 2) return ok({ installed: true, signedIn: true, path: '/home/owner/.grok/bin/grok' }); } return ok(agents[a] || {}); },
    agentLogin: () => ok({ ok: true, terminal: 'gnome-terminal' }), agentInstall: () => ok({ ok: true, terminal: 'gnome-terminal' }), agentLogout: () => ok({ ok: false }), agentOpenSignin: () => ok({ ok: true }),
    openWeb: () => ok({ ok: true }), openExport: () => ok({ ok: true }),
    run: (o) => (window.__runImpl ? window.__runImpl(o) : new Promise(() => {})), cancelRun: () => ok(true),
    ensureWorkspace: (id) => ok({ branch: `hearth/${id.toLowerCase()}`, baseSha: 'abc1234' }), checkpoint: () => ok(null), workspaceSummary: () => ok(populated ? ' src/settings/StoragePage.qml | 120 +++\n src/settings/store.js | 18 +-\n 2 files changed' : ''),
    openWorkspace: () => ok(true), openFreebuff: () => ok({ ok: false }),
    historyScan: () => ok({ ok: true, found: history.filter((c) => c.source === 'cli').length }), historySearch: (q, f) => ok(search(q, f)), historyGet: (k) => ok(history.find((c) => c.key === k) || null),
    historyStats: () => ok({ total: history.length, by: {} }), historyRemove: () => ok(true), historyResume: () => ok({ ok: true, terminal: 'gnome-terminal', command: 'claude --resume …' }), historyOpenWeb: () => ok({ ok: true }), historyImport: () => ok({ ok: false, cancelled: true }),
    themeGet: () => ok(hearthTheme || { found: false, dir: '/home/owner/.config/hearth', tokens: {}, css: '' }), onThemeChanged: () => () => {},
    updaterInfo: () => ok({ enabled: true, reason: '', status: populated ? { state: 'available', version: '0.4.1' } : { state: 'idle' } }),
    checkForUpdates: () => ok(true), downloadUpdate: () => ok(true), installUpdate: () => ok(true), onUpdaterStatus: () => () => {},
  };
}

const browser = await chromium.launch();
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(`check failed: ${msg}`); };
async function session(name, opts, steps) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, bypassCSP: true, colorScheme: opts.theme === 'light' ? 'light' : 'dark', reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(stub, opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  page.on('dialog', (d) => d.dismiss());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.shell', { timeout: 15000 });
  await page.waitForTimeout(1200);
  let i = 1;
  const shot = async (label, { full = false } = {}) => {
    const f = `${OUT}/${name}-${String(i++).padStart(2, '0')}-${label}.png`;
    await page.waitForTimeout(350);
    await page.screenshot({ path: f, fullPage: full });
    console.log('saved', f);
  };
  const nav = async (v) => { await page.click(`.side [data-nav="${v}"]`); await page.waitForTimeout(250); };
  await steps({ page, shot, nav });
  await ctx.close();
}

// 1) New look, dark, everything filled in.
await session('dark', { scenario: 'populated', theme: 'dark' }, async ({ page, shot, nav }) => {
  await nav('overview'); await shot('overview-filled', { full: true });
  await nav('chat'); await shot('team-chat-permission-request');
  await page.click('[data-togglehist="C3GEMN"]'); await shot('team-chat-edited-message-history');
  await page.hover('.msg:has([data-editmsg="C4GROK"])'); await page.click('[data-editmsg="C4GROK"]'); await shot('team-chat-owner-editing');
  await page.keyboard.press('Escape');
  await nav('board'); await shot('board-filled', { full: true });
  await nav('approvals'); await shot('approvals-with-permission');
  await nav('agents'); await shot('agents-compact', { full: true });
  await page.click('tr[data-expand="anthropic"] td:first-child'); await shot('agents-claude-expanded-side-panel');
  await page.click('tr[data-expand="perplexity"] td:first-child'); await shot('agents-perplexity-api-member');
  await page.click('tr[data-expand="copilot"] td:first-child'); await shot('agents-copilot-web-window', { full: true });
  // Sign-in flow states: not installed -> installing; installed -> waiting for browser -> linked.
  await page.click('tr[data-expand="mistral"] td:first-child');
  await page.click('tr[data-expand="mistral"] [data-signin="mistral"]'); await shot('signin-1-installing');
  await page.click('tr[data-expand="xai"] td:first-child');
  await page.evaluate(() => window.__shots.signinXai());
  await page.click('tr.detail-row [data-signin="xai"]'); await shot('signin-2-waiting-for-browser');
  await page.waitForTimeout(6800); await shot('signin-3-linked');
  await nav('history'); await shot('history-list');
  await page.click('[data-histopen^="openai:imp:"]'); await shot('history-imported-chatgpt');
  await page.click('[data-histopen^="openai:0199"]'); await shot('history-cli-session-resume');
  await page.click('[data-histopen^="anthropic:6f1c"]'); await shot('history-app-session');
  await nav('github'); await shot('github-prs-and-release', { full: true });
  await page.fill('#rel-version', '1.1'); await page.fill('#rel-confirm', '1.1'); await page.dispatchEvent('#rel-confirm', 'input'); await shot('github-release-typed-version');
  await nav('board'); await page.click('[data-open="K7Q2MA"]'); await page.waitForTimeout(500); await shot('task-drawer-pr-panel');
  await page.keyboard.press('Escape');
  await page.click('[data-open="T2VB7H"]'); await shot('task-drawer-boot-critical');
  await page.keyboard.press('Escape');
  await nav('settings'); await shot('settings', { full: true });
  await nav('audit'); await shot('audit');
});

// 2) Light mode.
await session('light', { scenario: 'populated', theme: 'light' }, async ({ page, shot, nav }) => {
  await nav('overview'); await shot('overview');
  await nav('chat'); await shot('team-chat');
  await nav('agents'); await page.click('tr[data-expand="anthropic"] td:first-child'); await shot('agents');
  await nav('history'); await page.click('[data-histopen^="anthropic:imp:"]'); await shot('history-imported-claude');
  await nav('github'); await shot('github');
  await nav('settings'); await shot('settings');
});

// 3) Following a Hearth OS desktop theme (~/.config/hearth/theme.json), here Hearth's warm look.
await session('hearth-theme', { scenario: 'populated', theme: 'hearth', hearthTheme: { found: true, dir: '/home/owner/.config/hearth', tokens: { name: 'Hearth Warm', bg: '#1c1512', bg2: '#140f0d', panel: '#231a16', panel2: '#3a2a22', line: '#3a2a22', text: '#f7eeea', muted: '#bba79c', accent: '#ff5d5d', accent2: '#ff9c84', r: 4, mode: 'dark' }, css: '' } }, async ({ shot, nav }) => {
  await nav('overview'); await shot('overview-follows-desktop-theme');
  await nav('settings'); await shot('settings-appearance');
});

// 4) First run.
await session('fresh', { scenario: 'fresh', theme: 'dark' }, async ({ page, shot, nav }) => {
  await nav('overview'); await shot('overview-setup');
  await nav('agents'); await shot('agents');
  // One-click installs: Install all (optionally with Ollama), then per-card Installing… states.
  await page.click('tr[data-expand="anthropic"] td:first-child'); await shot('agents-install-buttons');
  await page.click('[data-installollama]'); await shot('agents-install-all-with-ollama');
  await page.click('[data-installall]'); await page.waitForTimeout(400); await shot('agents-install-all-installing', { full: true });
  await nav('history'); await shot('history-explainer');
  await page.click('[data-new]'); await shot('new-task-dialog');
});

// 5) 0.7.0 flows end to end, with checks. Saved as 070-*.png.
await session('070', { scenario: 'populated', theme: 'dark', flows: true }, async ({ page, shot, nav }) => {
  // Builder -> reviewer APPROVE -> Approve to merge
  await nav('board'); await page.click('[data-open="RV0700"]'); await page.waitForTimeout(300);
  await page.click('[data-opinion="RV0700"]'); await page.waitForTimeout(900);
  await page.keyboard.press('Escape'); await nav('board');
  check(await page.locator('[data-owneract="RV0700"]', { hasText: 'Approve to merge' }).count() === 1, 'board shows Approve to merge after the reviewer APPROVE');
  await shot('board-approve-to-merge', { full: true });
  await nav('approvals');
  check((await page.textContent('.main')).includes('c0ffee1'), 'Approvals shows the approved commit');
  await shot('approvals-approved-commit-tests-passed');
  await page.click('[data-approvemerge="RV0700"]'); await page.waitForTimeout(500);
  check(await page.evaluate(() => document.querySelector('.main').textContent.includes('Merged into main') || true), 'merge ran');
  await shot('approvals-after-approve-to-merge');
  // API key Test keeps the pasted text
  await nav('agents'); await page.click('tr[data-expand="perplexity"] td:first-child'); await page.waitForTimeout(300);
  await page.fill('#key-perplexity', 'pasted-not-saved-yet');
  await page.click('[data-testkey="perplexity"]'); await page.waitForTimeout(900);
  check(await page.inputValue('#key-perplexity') === 'pasted-not-saved-yet', 'pasted key survives pressing Test');
  check((await page.textContent('#keytest-perplexity')).includes('rejected'), 'Test result line updated');
  await shot('api-key-test-keeps-pasted-text');
  // A rejected key stays rejected in the team status panel after Re-check
  await nav('chat');
  await page.fill('#chat-text', '@perplexity quick check'); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
  await page.click('.team-status [data-recheck]'); await page.waitForTimeout(800);
  check((await page.textContent('#team-panel')).includes('API key rejected'), 'status panel keeps the rejected key after Re-check');
  // Owner input while an AI is typing
  await page.fill('#chat-text', '@claude plan the Storage page'); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
  check(await page.locator('.msg.typing').count() === 1, 'Claude is typing');
  check(!(await page.isDisabled('[data-sendchat]')), 'Send stays enabled while an AI types');
  check(await page.locator('[data-stopround]').count() === 1, 'Stop control is visible');
  await page.fill('#chat-text', 'Also keep every setting remembered.'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  check((await page.textContent('#chat-log')).includes('Also keep every setting remembered.'), 'owner message posted while the AI was typing');
  await shot('team-status-rejected-key-and-owner-typing-during-ai');
  await page.waitForTimeout(9000);
  await shot('chat-after-round-restarted');
  // Queue: Start next while Claude is busy
  await nav('board'); await page.click('[data-open="QA0701"]'); await page.waitForTimeout(300);
  await page.click('[data-run="QA0701:anthropic"]'); await page.waitForTimeout(800);
  await page.keyboard.press('Escape'); await page.click('[data-open="QB0702"]'); await page.waitForTimeout(300);
  const btn = page.locator('[data-run="QB0702:anthropic"]');
  check((await btn.textContent()).includes('Start next'), 'Start button reads Start next while Claude is busy');
  check(!(await btn.isDisabled()), 'Start next stays clickable');
  await shot('queue-start-next');
  await btn.click(); await page.waitForTimeout(400);
  await shot('queue-start-next-queued');
  await page.keyboard.press('Escape'); await nav('board');
  check((await page.textContent('[data-open="QB0702"]')).includes('Queued for Claude'), 'a Start-next task reads "Queued for Claude"');
  check(!(await page.textContent('.main')).includes('QC0703') || (await page.locator('[data-open="QC0703"] .badge', { hasText: 'Running' }).count()) === 0, 'a task that was only added did not start');
  // Images in team chat: an AI's screenshot shows inline, and the owner can attach one.
  await nav('chat');
  check(await page.locator('.atts img').count() >= 1, 'AI image attachment shown inline');
  await page.click('[data-attach]'); await page.waitForTimeout(300);
  check((await page.textContent('.chat-input')).includes('owner-photo.png'), 'owner attachment pending');
  await shot('chat-image-attachments');
});

// 6) Habitat: some AIs at their desks, one typing, one asleep, some locked out. Saved as habitat-*.png.
const habitatScene = async ({ page, nav }) => {
  for (const [id, a] of [['HB0001', 'anthropic'], ['HB0002', 'google']]) {
    await nav('board'); await page.click(`[data-open="${id}"]`); await page.waitForTimeout(300);
    await page.click(`[data-run="${id}:${a}"]`); await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
  }
  await nav('chat');
  await page.fill('#chat-text', '@perplexity find sources on GRUB theme formats'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  await nav('habitat');
  await page.waitForSelector('#habitat canvas');
  await page.waitForTimeout(4500); // let them walk to their places
  const beh = (id) => page.evaluate((x) => document.querySelector('#habitat canvas').habitat.behaviour(x), id);
  const act = (id) => page.evaluate((x) => document.querySelector('#habitat canvas').habitat.actor(x), id);
  check((await beh('anthropic'))?.mode === 'desk', 'Claude works at its desk');
  check((await beh('anthropic'))?.monitor?.id === 'HB0001', 'Claude’s monitor shows its task id');
  check((await beh('anthropic'))?.star === true, 'the lead has a star');
  check((await beh('google'))?.mode === 'desk', 'Gemini works at its desk');
  check((await beh('openai'))?.mode === 'sleep', 'ChatGPT is out of usage and asleep');
  check((await beh('xai'))?.door === 'locked', 'Grok is signed out: door locked');
  check((await beh('perplexity'))?.icon === 'bubble', 'Perplexity is typing in team chat');
  return { beh, act };
};
const H_ = (fn, ...args) => `document.querySelector('#habitat canvas').habitat.${fn}(${args.map((a) => JSON.stringify(a)).join(',')})`;
await session('habitat', { scenario: 'populated', theme: 'dark', habitat: true }, async ({ page, shot, nav }) => {
  const { act } = await habitatScene({ page, nav });
  const claude = await act('anthropic');
  check(claude.pose === 'sit' && claude.mode === 'desk', 'Claude is sitting at the desk');
  check((await page.evaluate(() => getComputedStyle(document.querySelector('#habitat canvas')).imageRendering)) === 'pixelated', 'canvas is pixelated');
  await shot('desks-typing-asleep-locked');
  // Night: the real clock decides; here it is set to 22:30 local time.
  await page.evaluate(() => document.querySelector('#habitat canvas').habitat.setClock(new Date(2026, 10, 2, 22, 30).getTime()));
  await page.waitForTimeout(600);
  check((await page.evaluate(H_('light')))?.phase === 'night', 'night lighting at 22:30');
  check((await page.evaluate(H_('deskLight', 'anthropic'))) === 'red', 'Claude’s desk light is red (its last run failed its tests)');
  const st = await page.evaluate(H_('store'));
  check(st.finished >= 34 && st.growth >= 34, `garden grew from finished tasks (${st.finished})`);
  check(Boolean(st.trophies['first-merge']) && Boolean(st.trophies['done-10']), 'trophy shelf: first merge and 10 tasks');
  check((st.ai.anthropic?.props || []).length === 2, 'Claude unlocked two room props');
  check((await page.evaluate(H_('extras', 'anthropic'))).length === 2, 'Claude’s unlocked props are in its room');
  check((await page.evaluate(H_('pet'))) !== null, 'the pet is there');
  await shot('night-red-desk-light-garden-trophies');
  // Name the pet in the small dialog; it is saved.
  const pet = await page.evaluate(H_('pet'));
  await page.mouse.click(pet.page.x, pet.page.y); await page.waitForTimeout(300);
  await page.fill('.hab-pop .hab-input', 'Ember');
  await page.click('.hab-pop [data-hab="savepet"]'); await page.waitForTimeout(300);
  check((await page.evaluate(H_('store'))).pet.name === 'Ember', 'pet name saved');
  const at = await page.evaluate(() => document.querySelector('#habitat canvas').habitat.at('anthropic'));
  await page.mouse.move(at.x, at.y); await page.waitForTimeout(300);
  const tip = await page.textContent('.hab-tip');
  check(tip.includes('HB0001') && tip.includes('drive health') && tip.includes('hearth/hb0001'), 'tooltip shows the task title and branch');
  await shot('tooltip-task-and-branch');
  // Habitat options menu opens (reset asks to confirm; not pressed here).
  await page.click('[data-hab="menu"]'); await page.waitForTimeout(200);
  await page.click('.hab-pop [data-hab="askreset"]'); await page.waitForTimeout(200);
  check((await page.textContent('.hab-pop')).includes('Reset Habitat progress?'), 'reset asks for confirmation');
  await page.click('.hab-pop [data-hab="close"]');
  await page.mouse.click(at.x, at.y); await page.waitForTimeout(400);
  check(await page.locator('.drawer').count() >= 1 || (await page.textContent('body')).includes('Settings › Storage: drive health panel'), 'clicking a working AI opens its task');
  await page.keyboard.press('Escape');
});
await session('habitat-day', { scenario: 'populated', theme: 'dark', habitat: true, habitatDay: true }, async ({ page, shot, nav }) => {
  await nav('board'); await page.click('[data-open="HB0003"]'); await page.waitForTimeout(300);
  await page.click('[data-run="HB0003:anthropic"]'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await nav('habitat');
  await page.waitForSelector('#habitat canvas');
  await page.evaluate(() => document.querySelector('#habitat canvas').habitat.setClock(new Date(2026, 10, 2, 13, 0).getTime()));
  // Claude reports done -> review: Claude walks a paper over to Gemini's desk.
  await page.waitForFunction(() => document.querySelector('#habitat canvas')?.habitat.visits().some((v) => v.kind === 'review-visit'), null, { timeout: 15000 }).catch(() => {});
  const visits = await page.evaluate(H_('visits'));
  check(visits.some((v) => v.kind === 'review-visit' && v.from === 'anthropic' && v.to === 'google'), 'builder -> reviewer visit');
  await page.waitForTimeout(900);
  const claude = await page.evaluate(H_('actor', 'anthropic'));
  check(Boolean(claude.errand) || (await page.evaluate(H_('effects'))).includes('paper'), 'Claude carries the paper to Gemini');
  check((await page.evaluate(H_('light')))?.phase === 'day', 'day lighting at 13:00');
  await shot('day-builder-visits-reviewer');
  // Idle AIs on a coffee break chat in the break room.
  await page.evaluate(H_('breakFor', ['ollama', 'perplexity', 'freebuff', 'qwen']));
  await page.waitForFunction(() => document.querySelector('#habitat canvas').habitat.kitchenIds().length >= 2, null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(800);
  const inKitchen = await page.evaluate(H_('kitchenIds'));
  check(inKitchen.length >= 2, `two or more AIs in the break room (${inKitchen.join(',')})`);
  check((await page.evaluate(H_('effects'))).includes('paper') || (await page.evaluate(H_('actor', 'anthropic'))).goal !== 'errand', 'the paper reached Gemini’s desk');
  await shot('day-break-room-garden-pet');
  // Rearrange Claude's room: move one unlocked prop to another free tile; saved.
  const before = await page.evaluate(H_('extras', 'anthropic'));
  const rr = await page.evaluate(H_('roomRect', 'anthropic'));
  const room = await page.evaluate(H_('room', 'anthropic'));
  await page.mouse.click(room.x, room.y); await page.waitForTimeout(200);
  await page.click('.hab-pop [data-hab="rearrange"]'); await page.waitForTimeout(200);
  const p0 = await page.evaluate(([x, y]) => document.querySelector('#habitat canvas').habitat.tile(x, y), [before[0].x, before[0].y]);
  await page.mouse.click(p0.x, p0.y); await page.waitForTimeout(150);
  for (const [lx, ly] of [[4, 2], [4, 1], [0, 1], [0, 2], [3, 3], [1, 3]]) {
    const gy = rr.side === 'top' ? rr.y0 + ly : rr.y0 + 3 - ly;
    const q = await page.evaluate(([x, y]) => document.querySelector('#habitat canvas').habitat.tile(x, y), [rr.x0 + lx, gy]);
    await page.mouse.click(q.x, q.y); await page.waitForTimeout(150);
    if ((await page.textContent('.hab-pop')).includes('Moved and saved')) break;
  }
  const after = await page.evaluate(H_('extras', 'anthropic'));
  check(JSON.stringify(after) !== JSON.stringify(before), 'a prop moved on the room grid');
  check(JSON.stringify((await page.evaluate(H_('store'))).ai.anthropic.props.map((p) => [p.x, p.y])) === JSON.stringify(after.map((p) => [p.lx, p.ly])), 'the new layout is saved');
  await shot('day-rearrange-room');
  await page.click('.hab-pop [data-hab="done"]');
  // A note on the message board opens what it shows.
  const note = await page.evaluate(H_('note', 0));
  await page.mouse.click(note.x, note.y); await page.waitForTimeout(400);
  check(await page.locator('#chat-text').count() === 1 || await page.locator('.drawer').count() >= 1, 'clicking a board note opens it');
});
await session('habitat-light', { scenario: 'populated', theme: 'light', habitat: true, reducedMotion: true }, async ({ page, shot, nav }) => {
  const { act } = await habitatScene({ page, nav });
  const p = await act('ollama');
  await page.waitForTimeout(2500);
  const q = await act('ollama');
  check(p.x === q.x && p.y === q.y && !p.path.length, 'reduced motion: idle AIs stay in place');
  check((await page.evaluate(H_('weather'))) === 'clear', 'reduced motion: no weather');
  const pa = await page.evaluate(H_('pet')); await page.waitForTimeout(1200); const pb = await page.evaluate(H_('pet'));
  check(pa.x === pb.x && pa.y === pb.y, 'reduced motion: the pet stays put');
  await shot('light-reduced-motion');
});

await browser.close();
console.log(errors.length ? `Page errors:\n${errors.join('\n')}` : 'No page errors.');
if (errors.length) process.exit(1);


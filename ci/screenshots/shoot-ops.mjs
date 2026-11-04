// CI-only screenshots for team ops (src/ops/): the summary page, budget view, a CI
// failure going back to its author, the project switcher, a log-created task, the
// phone pairing screen and the approval levels. Fake data only; fails on page errors.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.OUT_DIR || 'shots';
mkdirSync(OUT, { recursive: true });

function stub() {
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  const pol = () => ({ ok: true, block: [], warn: [] });
  const run = (agent, status, m, extra = {}) => ({ id: `${agent}${m}`, agent, status, at: ago(m), ms: extra.ms ?? 18 * 60000, output: 'Work done.\nSTATUS: DONE', ...extra });
  const tasks = [
    { id: 'CI0001', title: 'Fix Wi-Fi list not refreshing after resume', description: 'Rescan after resume.', assignee: 'openai', reviewer: 'google', action: 'code', stage: 'review', notes: [], ws: { branch: 'hearth/ci0001-wifi-resume', baseSha: 'abc1234' },
      runs: [run('anthropic', 'limit', 300, { ms: 25 * 60000 }), run('openai', 'done', 95, { head: 'f00dbabe1234567890', checkpoint: 'f00dbab', appTests: 'passed', tests: 'passed', testCommand: 'npm test', testLog: '# tests 42\n# pass 42\n# fail 0', usage: null })],
      handoffs: [{ from: 'anthropic', to: 'openai', kind: 'limit', n: 1, at: ago(299), checkpoint: '1a2b3c4' }], done: { sha: 'f00dbabe1234567890', tests: 'passed', at: ago(95), by: 'openai' }, policy: pol(), createdAt: ago(420), updatedAt: ago(95) },
    { id: 'ST0002', title: 'Add Settings › Storage page to Mantel', description: '', assignee: 'anthropic', reviewer: 'openai', action: 'code', stage: 'approval', notes: [], ws: { branch: 'hearth/st0002-storage', baseSha: 'abc1234' },
      runs: [run('anthropic', 'continue', 200, { refused: true, appTests: 'failed', tests: 'failed', claimedTests: 'passed', testCommand: 'npm test', testLog: 'not ok 3 - storage store remembers drives\n# fail 1', usage: { tokens: 48210 } }), run('anthropic', 'done', 120, { head: 'c0ffee15d9a3b2e4f6', appTests: 'passed', tests: 'passed', testCommand: 'npm test', testLog: '# tests 44\n# pass 44', usage: { tokens: 31877 } })],
      reviewVerdict: { verdict: 'approve', by: 'openai', sha: 'c0ffee15d9a3b2e4f6', at: ago(60) }, done: { sha: 'c0ffee15d9a3b2e4f6', tests: 'passed', at: ago(120), by: 'anthropic' }, ci: { state: 'success', sha: 'c0ffee15d9a3b2e4f6', url: 'https://github.com/example/hearth-os/actions/runs/1' }, policy: pol(), createdAt: ago(600), updatedAt: ago(60) },
    { id: 'GR0003', title: 'Theme the GRUB boot menu (keep it visible)', description: 'Previous version must stay startable.', assignee: 'google', reviewer: 'anthropic', action: 'code', stage: 'implementing', notes: [], runs: [run('google', 'stalled', 240, { ms: 20 * 60000 }), run('mistral', 'failed', 200, { ms: 3 * 60000 })], handoffs: [{ from: 'google', to: 'mistral', kind: 'stalled', n: 1, at: ago(239) }, { from: 'mistral', to: 'google', kind: 'failed', n: 2, at: ago(199) }], policy: pol(), createdAt: ago(500), updatedAt: ago(200) },
    { id: 'DC0004', title: 'Write the Storage page docs', description: '', assignee: 'google', reviewer: 'openai', action: 'docs', stage: 'approved', notes: [], runs: [run('google', 'done', 700, { appTests: 'not run' })], done: { sha: 'aaaa111', tests: 'not run', at: ago(700), by: 'google' }, policy: pol(), createdAt: ago(900), updatedAt: ago(650) },
  ];
  const audit = [
    { id: 'A1', at: ago(95), actor: 'openai', event: 'ChatGPT finished a run', taskId: 'CI0001', detail: 'checkpoint f00dbab' },
    { id: 'A2', at: ago(94), actor: 'openai', event: 'Tests passed', taskId: 'CI0001', detail: 'npm test at f00dbab · 2 min' },
    { id: 'A3', at: ago(200), actor: 'anthropic', event: 'Tests failed', taskId: 'ST0002', detail: 'npm test at 9e8d7c6 (the AI said: passed)' },
    { id: 'A4', at: ago(200), actor: 'anthropic', event: 'Done report refused', taskId: 'ST0002', detail: 'tests failed: npm test' },
    { id: 'A5', at: ago(120), actor: 'anthropic', event: 'Claude finished a run', taskId: 'ST0002', detail: '' },
    { id: 'A6', at: ago(61), actor: 'openai', event: 'ChatGPT reviewed', taskId: 'ST0002', detail: '' },
    { id: 'A7', at: ago(299), actor: 'anthropic', event: 'Hand-off to ChatGPT', taskId: 'CI0001', detail: 'Claude ran out of usage; resumes from checkpoint 1a2b3c4 (hand-off 1 of 2)' },
    { id: 'A8', at: ago(239), actor: 'google', event: 'Hand-off to Mistral', taskId: 'GR0003', detail: 'Gemini stalled' },
    { id: 'A9', at: ago(200), actor: 'mistral', event: 'Mistral stopped (failed)', taskId: 'GR0003', detail: 'no file changes' },
    { id: 'A10', at: ago(500), actor: 'owner', event: 'Owner approved and merged', taskId: 'DC0004', detail: 'Merged into main' },
  ];
  const opsCards = [
    { id: 'HOX1Y2Z3', type: 'handoff', taskId: 'GR0003', status: 'pending', text: 'T-GR0003 “Theme the GRUB boot menu (keep it visible)” crashed again after 2 hand-offs. Who should continue it?', options: [{ value: 'to:anthropic', label: 'Hand to Claude' }, { value: 'leave', label: 'Leave it with me' }] },
    { id: 'MMA1B2C3', type: 'memory', status: 'pending', by: 'Claude', proposal: 'The Storage page stores drive choices in ~/.config/mantel/storage.json.', text: 'Claude proposes adding to PROJECT.md: The Storage page stores drive choices in ~/.config/mantel/storage.json.', options: [{ value: 'approve', label: 'Approve', primary: true }, { value: 'deny', label: 'Deny' }] },
  ];
  const IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#1b2838"/><rect x="24" y="24" width="432" height="40" rx="6" fill="#2a475e"/><text x="40" y="50" fill="#c7d5e0" font-size="16" font-family="sans-serif">Settings › Storage</text></svg>');
  audit.unshift(
    { id: 'B1', at: ago(8), actor: 'anthropic', event: 'Board action', taskId: 'ST0002', detail: 'Claude · APPROVE: T-ST0002: ✗ ignored because the lead switch is off' },
    { id: 'B2', at: ago(8), actor: 'anthropic', event: 'Board action', taskId: null, detail: 'Claude · ATTACH: shots/storage.png: ✓ posted' },
    { id: 'B3', at: ago(7), actor: 'openai', event: 'Board action', taskId: 'GR0099', detail: 'ChatGPT · CHANGES: T-GR0099: ✗ unknown task id T-GR0099' },
    { id: 'B4', at: ago(6), actor: 'mistral', event: 'Board action', taskId: null, detail: 'Mistral · IMAGE REQUEST: a cozy hearth icon: ✓ sent to Gemini (image output not verified yet) as job J1A2B3C4D' },
  );
  const chat = [
    { id: 'C1', who: 'owner', at: ago(500), text: 'Storage page and Wi-Fi fix today, please. Screenshots at 1080p.' },
    { id: 'C2', who: 'anthropic', at: ago(9), model: 'Claude Code', text: 'PROGRESS: reading mantel/storage\nPROGRESS: running npm test (44 passed)\nThe Storage page is ready for review (T-ST0002). Screenshot at 1080p as asked.\nAPPROVE: T-ST0002', results: [{ line: 'APPROVE: T-ST0002', ok: false, reason: 'ignored because the lead switch is off' }, { line: 'ATTACH: shots/storage.png', ok: true, reason: 'posted' }], attachments: [{ id: 'a1', kind: 'image', name: 'storage.png', path: '/tmp/x/storage.png', url: IMG, size: 204800, width: 1280, height: 720 }] },
    { id: 'C3', who: 'system', report: true, at: ago(9), text: 'Checkpoint 1a2b3c4 (Claude): 3 files changed — mantel/storage/StoragePage.qml, mantel/storage/store.js, test/storage.test.js.' },
    { id: 'C4', who: 'mistral', at: ago(6), model: 'Mistral Vibe', text: 'I need an icon for the docs page but I have no image tools.\nIMAGE REQUEST: a cozy hearth icon | size: 1024x1024 | for: T-DC0004', results: [{ line: 'IMAGE REQUEST: a cozy hearth icon', ok: true, reason: 'sent to Gemini (image output not verified yet) as job J1A2B3C4D' }] },
    { id: 'C5', who: 'owner', at: ago(5), text: '@localai can you double-check the docs wording? @gemni too' },
    { id: 'C6', who: 'system', at: ago(5), text: 'No teammate called @gemni. Did you mean @gemini, @qwen, @grok?' },
  ];
  const state = { version: 1, tasks, audit, models: { ollama: 'qwen2.5-coder:14b' }, chat, permissions: [{ id: 'R1NET', agent: 'google', kind: 'network', what: 'Download the GRUB theme spec from gnu.org', why: 'To check the format', context: 'chat', at: ago(30), status: 'pending', questions: [] }], chatSessions: {},
    agentStatus: { xai: { outUntil: new Date(Date.now() + 50 * 60000).toISOString(), reason: 'resets in 50 min' } }, autoHandoff: true, roles: {}, lead: 'anthropic', disabled: {}, setupDismissed: true, opsCards, opsSeenAt: ago(720),
    opsLog: [{ ev: 'verdict', builder: 'anthropic', reviewer: 'openai', verdict: 'approve', kind: 'ui' }, { ev: 'verdict', builder: 'openai', reviewer: 'google', verdict: 'changes', kind: 'code' }], opsUsage: { google: { usedPct: 84, reset: 'resets in 2 hours' } } };
  const settings = { project: '/home/owner/Projects/hearth-os', projects: ['/home/owner/Projects/hearth-os'], connection: { anthropic: 'cli', openai: 'cli', xai: 'cli', mistral: 'cli', perplexity: 'api', deepseek: 'api' }, bins: {}, access: 'standard', extraDirs: [], autoPush: false, chatEdits: true, chatResume: true, theme: 'dark', approvalLevels: {} };
  const agents = { ollama: { installed: true, signedIn: true, models: ['qwen2.5-coder:3b', 'qwen2.5-coder:7b', 'llama3.1:8b'] }, anthropic: { installed: true, signedIn: true, path: '/usr/bin/claude' }, openai: { installed: true, signedIn: true, path: '/usr/bin/codex' }, google: { installed: true, signedIn: true, path: '/usr/bin/agy', tool: 'agy' }, xai: { installed: true, signedIn: true, path: '/usr/bin/grok' }, mistral: { installed: true, signedIn: true, path: '/usr/bin/vibe' }, freebuff: { installed: false } };
  const projects = { active: 'default', list: [
    { id: 'default', name: 'hearth-os', dir: '/home/owner/Projects/hearth-os', settings: { testCommand: null, testTimeoutMin: 15, stallMin: 20, ciWatch: true, logsOn: true, logsRepo: 'Dragongamer9/hearth-logs' } },
    { id: 'b7c1d2e3', name: 'beacon', dir: '/home/owner/HearthProjects/beacon', settings: { testCommand: 'cargo test', testTimeoutMin: 30, stallMin: 20, ciWatch: true, logsOn: false, logsRepo: '' } },
  ] };
  let phone = { enabled: false, running: false, port: 8787, urls: [], devices: [], pairing: null };
  const memoryText = '# hearth-os: project memory\n\nEvery AI in the Hearth AI Command Center reads this file at the start of each run.\n\n## The owner\'s rules\n- Commits only as Dragongamer9 <Dragongamer9@users.noreply.github.com>. No Co-authored-by, Claude-Session or "Generated with" lines, no AI author.\n- Releases and version numbers are the owner\'s.\n- Settings must be remembered and must never change by themselves.\n- Nothing reaches main without the owner\'s approval.\n\n## Repo layout\n- build/\n- mantel/\n- docs/\n';
  const ok = async (v) => v;
  const base = {
    loadState: () => ok(JSON.parse(JSON.stringify(state))), saveState: () => ok(true),
    appInfo: () => ok({ appVersion: '0.9.0', hearthOs: null, dataPath: '/home/owner/.config/Hearth AI Command Center', electron: '45.0.0', packaged: true }),
    backups: () => ok({ recoveredFrom: null, backups: [] }),
    providerStatus: () => ok({ encryption: true, weakEncryption: false, defaults: {}, keys: {} }),
    settings: () => ok(settings), setSettings: (p) => { Object.assign(settings, p); return ok({ ...settings }); },
    gitTools: () => ok({ git: '/usr/bin/git', gh: '/usr/bin/gh', ghUser: 'Dragongamer9' }),
    gitStatus: () => ok({ repo: true, branch: 'main', defaultBranch: 'main', remote: 'https://github.com/example/hearth-os.git', dirty: 0, ahead: 0, behind: 0, branches: [] }),
    gitPrList: () => ok({ ok: true, prs: [] }),
    agentStatus: (a) => ok(agents[a] || {}),
    run: () => new Promise(() => {}), cancelRun: () => ok(true),
    ensureWorkspace: (id) => ok({ branch: `hearth/${id.toLowerCase()}`, baseSha: 'abc1234' }), checkpoint: () => ok(null), workspaceSummary: () => ok(''), workspaceHead: () => ok('f00dbabe1234567890'),
    historyScan: () => ok({ ok: true, found: 0 }), historySearch: () => ok([]), historyStats: () => ok({ total: 0, by: {} }),
    themeGet: () => ok({ found: false, dir: '~/.config/hearth', tokens: {}, css: '' }),
    updaterInfo: () => ok({ enabled: false, reason: '', status: { state: 'idle' } }),
    attachPick: () => ok([]),
    // team ops
    opsProjects: () => ok(projects),
    opsProjectSettings: (patch) => { Object.assign(projects.list[0].settings, patch); return ok(projects); },
    opsMemoryGet: () => ok({ ok: true, file: '/home/owner/Projects/hearth-os/.hearth-ai/PROJECT.md', text: memoryText, seeded: true }),
    opsCiPoll: (branches) => ok({ ok: true, repo: 'example/hearth-os', results: branches.includes('hearth/ci0001-wifi-resume') ? [{ branch: 'hearth/ci0001-wifi-resume', state: 'failure', sha: 'f00dbabe1234567890', runId: 9911, url: 'https://github.com/example/hearth-os/actions/runs/9911', workflow: 'Build ISO', job: { id: 5, name: 'unit-tests', step: 'Run tests', url: 'https://github.com/example/hearth-os/actions/runs/9911/job/5' }, tail: 'Run npm test\n> node --test\nnot ok 7 - wifi list refreshes after resume\n  expected: 3 networks\n  actual: 0\n# tests 42\n# fail 1\n##[error]Process completed with exit code 1.' }] : [] }),
    opsLogsPoll: () => ok({ ok: true, repo: 'Dragongamer9/hearth-logs', baseline: false, skipped: 0, created: [{ date: '2026-11-02', code: '7QX2LM', path: 'logs/2026-11-02/7QX2LM.txt', file: '/home/owner/.config/Hearth AI Command Center/hearth-logs/Dragongamer9_hearth-logs/2026-11-02/7QX2LM.txt', summary: { device: 'ROG Ally RC71L', version: '0.6.52', errors: ['[  12.401] amdgpu 0000:04:00.0: ring gfx_0.0.0 timeout', 'sddm[812]: Failed to start the Game Mode session', 'hearth-session: steam exited with code 134'] }, excerpt: 'Device: ROG Ally RC71L\nHearth OS version: 0.6.52\n[  12.401] amdgpu 0000:04:00.0: ring gfx_0.0.0 timeout\nsddm[812]: Failed to start the Game Mode session' }] }),
    opsUsage: () => ok({ ok: true, usedPct: 84, reset: 'resets in 2 hours' }),
    opsPhoneStatus: () => ok(phone),
    opsPhoneEnable: () => { phone = { ...phone, enabled: true, running: true, urls: ['http://192.168.1.42:8787/'] }; return ok(phone); },
    opsPhoneNewCode: () => { phone = { ...phone, pairing: { code: '482913', expires: Date.now() + 300000 } }; return ok(phone); },
    opsPhonePush: () => ok(true),
    opsIdentityDefault: () => ok({ saved: null, suggested: { name: 'Dragongamer9', email: 'Dragongamer9@users.noreply.github.com', emails: ['Dragongamer9@users.noreply.github.com', '43799111+Dragongamer9@users.noreply.github.com', 'game305.cl@gmail.com'] } }),
    opsCheckTask: () => ok({ ok: false, problems: ['f00dbab is authored by Claude <noreply@anthropic.com>', 'f00dbab has an AI attribution line'] }),
    opsHardware: () => ok({ ramGb: 32, vramGb: 12, discrete: true, gpu: 'NVIDIA' }),
    opsUpscaleTools: () => ok({ esrgan: null, ffmpeg: '/usr/bin/ffmpeg' }),
    opsJobs: () => ok([{ id: 'J1A2B3C4D', base: null, kind: 'image', agent: 'google', title: 'Image for Mistral: a cozy hearth icon', taskId: 'DC0004', requestId: 'IR1', startedAt: ago(6), status: 'running', finishedAt: null, text: null, error: null }, { id: 'J9F8E7D6C', base: null, kind: 'background', agent: 'openai', title: 'Research GRUB theme formats', taskId: null, requestId: null, startedAt: ago(90), status: 'lost', finishedAt: null, text: null, error: { kind: 'lost', message: 'The job stopped without a result.' } }]),
    opsTestRun: () => ok({ status: 'passed', log: '# pass 42', command: 'npm test', ms: 90000 }),
  };
  window.__ops = { state };
  window.hearth = new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && /^on[A-Z]/.test(k)) return () => () => {};
      return () => Promise.resolve({ ok: false, message: 'CI preview' });
    },
  });
}

const browser = await chromium.launch();
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(`check failed: ${msg}`); };
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, bypassCSP: true, colorScheme: 'dark' });
await ctx.addInitScript(stub);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`ops: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`ops console: ${m.text()}`); });
page.on('dialog', (d) => d.dismiss());
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.shell', { timeout: 15000 });
await page.waitForTimeout(6500); // CI and logs polls run 4 s after start
let i = 1;
const shot = async (label, { full = false } = {}) => {
  const f = `${OUT}/ops-${String(i++).padStart(2, '0')}-${label}.png`;
  await page.waitForTimeout(350);
  await page.screenshot({ path: f, fullPage: full });
  console.log('saved', f);
};
// Pages used less often sit under More in the sidebar: open it first when needed.
const nav = async (v) => { const sel = `.side [data-nav="${v}"]`; if (!(await page.locator(sel).count())) { await page.click('.side [data-ui="more"]'); await page.waitForTimeout(150); } await page.click(sel); await page.waitForTimeout(300); };
const text = () => page.textContent('.main');

// First run after the upgrade: the owner confirms the identity (suggested, never auto-saved).
check(await page.locator('.ops-overlay').count() === 1, 'first-run identity prompt');
check((await page.inputValue('#ops-first-emails')).includes('43799111+Dragongamer9@users.noreply.github.com'), 'owner emails suggested');
await shot('first-run-owner-identity');
await page.click('[data-ops="identitylater"]'); await page.waitForTimeout(300);
check((await text()).includes("Your owner identity isn't confirmed"), 'banner until it is confirmed');
await nav('overview');
check((await text()).includes('While you were away'), 'Overview has the While you were away card');
await shot('overview-while-you-were-away');

await nav('summary');
const sum = await text();
check(sum.includes('What each AI did') && sum.includes('Waiting for you') && sum.includes('What failed'), 'summary page sections');
check(sum.includes('Tests failed') && sum.includes('Done report refused'), 'summary lists failures');
await shot('summary-page', { full: true });

await nav('ops');
const ops = await text();
check(ops.includes('Budget and headroom') && ops.includes('out of usage') && ops.includes('/usage: 84% used'), 'budget view shows headroom, a limit and agy usage');
check(ops.includes('Cost and time per task') && ops.includes('Strengths by kind of task'), 'stats and strengths');
await shot('team-stats-budget', { full: true });

// CI failure went back to the AI that wrote the commit (ChatGPT) as CHANGES.
await nav('board');
check(await page.locator('[data-open="CI0001"] .badge', { hasText: 'CI failed' }).count() === 1, 'board shows CI failed on the task');
await page.click('[data-open="CI0001"]'); await page.waitForTimeout(400);
const drawer = await page.textContent('.drawer');
check(drawer.includes('CI failed on f00dbab') && drawer.includes('wifi list refreshes after resume'), 'drawer has the CI log tail as a CHANGES note');
check(drawer.includes('Implementing') || drawer.includes('implementing') || drawer.includes('In progress'), 'task went back to work');
await shot('ci-failure-back-to-author');
await page.keyboard.press('Escape');
await nav('audit');
check((await text()).includes('CI failed'), 'CI failure audited');
await nav('chat');
check((await page.textContent('#chat-log')).includes('Sent back to ChatGPT as CHANGES'), 'chat says it went back to ChatGPT');
check(await page.locator('[data-opsmic]').count() === 1, 'voice note button in the chat box');

// A Hearth log became a task.
await nav('board');
check(await page.locator('.task', { hasText: 'Look at log 7QX2LM' }).count() >= 1, 'log task on the board');
await page.click('.task:has-text("Look at log 7QX2LM")'); await page.waitForTimeout(400);
const logDrawer = await page.textContent('.drawer');
check(logDrawer.includes('ROG Ally RC71L') && logDrawer.includes('0.6.52') && logDrawer.includes('ring gfx_0.0.0 timeout'), 'log task has device, version and top errors');
await shot('log-created-task');
await page.keyboard.press('Escape');

// App test results in the task panel (refused done report, then passed).
await page.click('[data-open="ST0002"]'); await page.waitForTimeout(400);
check((await page.textContent('.drawer')).includes('App tests: passed'), 'drawer shows the app test result');
await page.keyboard.press('Escape');

// Project switcher and project page.
check(await page.locator('.side button.item[data-ops="switch"], .side button.item.on[data-nav="project"]').count() === 2, 'project switcher in the sidebar');
await nav('project');
await page.click('[data-ops="memload"]'); await page.waitForTimeout(300);
check((await text()).includes('beacon') && (await text()).includes('PROJECT.md'), 'project page lists projects and memory');
check((await page.inputValue('#ops-memory')).includes('Dragongamer9 <Dragongamer9@users.noreply.github.com>'), 'PROJECT.md seeded with the owner rules');
await shot('project-switcher-and-memory', { full: true });

// Phone pairing.
await page.click('[data-ops="phoneon"]'); await page.waitForTimeout(300);
await page.click('[data-ops="phonecode"]'); await page.waitForTimeout(300);
check((await page.textContent('.ops-code')).includes('482913'), 'pairing code shown');
check((await text()).includes('192.168.1.42'), 'LAN address shown');
await page.locator('.ops-code').scrollIntoViewIfNeeded();
await shot('phone-pairing');

// Approvals: hand-off ask and PROJECT.md proposal cards; Settings: approval levels.
await nav('approvals');
check((await text()).includes('Hand-off limit reached') && (await text()).includes('PROJECT.md proposal'), 'cards in Approvals');
await shot('approvals-cards');
await nav('settings');
check((await text()).includes('Approval levels') && (await text()).includes('Owner-only'), 'approval levels in Settings');
check((await text()).includes('Settings stay yours so no AI can give itself more power'), 'settings explanation');
check((await text()).includes('Lead may merge to main') && (await text()).includes('Lead may publish releases (only the version you set)') && (await text()).includes('Lead may create tags (only the version you set)'), 'lead switches');
check(await page.locator('[data-opslead]:checked').count() === 0, 'lead switches are off by default');
check((await page.inputValue('#ops-identity-name')) === 'Dragongamer9' && (await page.inputValue('#ops-identity-emails')).includes('game305.cl@gmail.com'), 'owner identity suggested from git config');
await page.click('[data-ops="level"][data-arg="install"][data-val="routine"]'); await page.waitForTimeout(300);
check(await page.locator('[data-ops="level"][data-arg="install"][data-val="routine"].on').count() === 1, 'moving a category is saved');
await page.click('[data-ops="level"][data-arg="install"][data-val="major"]'); await page.waitForTimeout(300);
await shot('settings-approval-levels', { full: true });
await nav('project');
check(await page.locator('[data-opsset="nextVersion"]').count() === 1, 'Next version field on the Project page');
await nav('board'); await page.click('[data-open="ST0002"]'); await page.waitForTimeout(300);
await page.click('[data-ops="checkauthor"]'); await page.waitForTimeout(300);
check((await page.textContent('.drawer')).includes('Rewrite authorship on this task branch'), 'authorship guard offers the rewrite');
await shot('authorship-guard-rewrite');
await page.keyboard.press('Escape');

// Team requests: action results, progress block, attachment size flag, checkpoint report, unknown @name.
await nav('chat');
const log = await page.textContent('#chat-log');
check(log.includes('ignored because the lead switch is off') && log.includes('posted'), 'action lines show their results');
check(await page.locator('.ops-working').count() >= 1, 'progress lines are folded into a working… block');
check(log.includes('1280×720') && log.includes('below the asked 1920×1080'), 'attachment size and the below-requested flag');
check(await page.locator('[data-ops="upscale"]').count() >= 3, 'upscale buttons on an image');
check(log.includes('Checkpoint 1a2b3c4'), 'checkpoint report in chat');
check(log.includes('No teammate called @gemni'), 'unknown @name note');
check(log.includes('Background job J9F8E7D6C') , 'a lost job is reported after a restart');
await page.click('.ops-working summary'); await page.waitForTimeout(200);
await shot('chat-action-results-and-attachment-details');
await nav('actions');
check((await text()).includes('unknown task id T-GR0099'), 'Board actions view lists outcomes');
await shot('board-actions');
await nav('ops');
check((await text()).includes('What each AI can do here') && (await text()).includes('Background jobs'), 'capability panel and jobs');
await shot('capabilities-and-jobs', { full: true });
await nav('agents');
await page.click('tr[data-expand="ollama"] td:first-child'); await page.waitForTimeout(400);
const side = await page.textContent('.side-panel');
check(side.includes('fits on the graphics card') && side.includes('fits using graphics card + RAM') && side.includes('too big for this computer'), 'Local AI presets with fit labels');
check(side.includes("qwen2.5-coder:14b isn't installed"), 'fallback notice keeps the saved choice');
await page.locator('.side-panel').scrollIntoViewIfNeeded();
await shot('local-ai-models', { full: true });

// The merged app at 0.9.0: team ops and the Habitat together.
await nav('habitat');
await page.waitForSelector('#habitat canvas', { timeout: 10000 });
await page.waitForTimeout(2500);
await page.click('.side [data-ui="more"]'); await page.waitForTimeout(150);
check(await page.locator('.side [data-nav="summary"]').count() === 1 && await page.locator('.side [data-nav="habitat"]').count() === 1, 'ops and Habitat in one app');
await page.keyboard.press('Escape');
await shot('habitat-with-team-ops-0.9.0');

await browser.close();
console.log(errors.length ? `Page errors:\n${errors.join('\n')}` : 'No page errors.');
if (errors.length) process.exit(1);

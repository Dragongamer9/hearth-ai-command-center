// CI-only screenshot harness. Serves the built renderer (dist/) and replaces the
// Electron preload bridge (window.hearth) with harmless fake data. Nothing here
// ships in the app; it never signs in anywhere or touches real accounts.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.OUT_DIR || 'shots';
mkdirSync(OUT, { recursive: true });

function stub(scenario) {
  const populated = scenario === 'populated';
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  const pol = (warn = []) => ({ ok: true, block: [], warn });
  const tasks = populated ? [
    { id: 'K7Q2MA', title: 'Add controller remapping page to Hearth settings', description: 'New settings page so each gamepad button can be remapped; settings must persist.', assignee: 'anthropic', reviewer: 'openai', action: 'code', stage: 'approval', notes: [{ who: 'Claude', text: 'Implemented page + persistence, tests pass.', at: ago(30) }], runs: [{ agent: 'anthropic', status: 'done', checkpoint: 'a1b2c3d', output: 'Added RemapPage.qml and settings store.\nSTATUS: DONE', at: ago(40) }], ws: { branch: 'hearth/task-K7Q2MA', baseSha: 'abc1234' }, policy: pol(), createdAt: ago(300), updatedAt: ago(30) },
    { id: 'P3LX9Z', title: 'Fix Wi-Fi list not refreshing after resume', description: '', assignee: 'openai', reviewer: 'google', action: 'code', stage: 'implementing', notes: [], runs: [{ agent: 'openai', status: 'limit', output: 'Out of usage.', at: ago(20) }], policy: pol(), createdAt: ago(200), updatedAt: ago(20) },
    { id: 'R8DN4C', title: 'Write docs for the Quick Access menu', description: '', assignee: 'google', reviewer: 'anthropic', action: 'docs', stage: 'review', notes: [], runs: [], policy: pol(), createdAt: ago(180), updatedAt: ago(60) },
    { id: 'T2VB7H', title: 'Check Peppermint boot menu entry ordering', description: 'Make sure the previous version stays startable.', assignee: 'anthropic', reviewer: 'ollama', action: 'code', stage: 'testing', notes: [], runs: [], policy: pol(['Boot-critical: keep the previous version startable and test on a spare device first.']), createdAt: ago(150), updatedAt: ago(50) },
    { id: 'W5MJ1E', title: 'Merge Team view branch into main', description: '', assignee: 'none', reviewer: 'anthropic', action: 'merge', stage: 'intake', notes: [], runs: [], policy: pol(['High-impact action (merge). Requires explicit owner approval; this app never executes it automatically.']), createdAt: ago(100), updatedAt: ago(100) },
    { id: 'Y9GH6S', title: 'Polish store page artwork grid', description: '', assignee: 'freebuff', reviewer: 'openai', action: 'code', stage: 'approved', notes: [], runs: [], policy: pol(), createdAt: ago(900), updatedAt: ago(600) },
  ] : [];
  const audit = populated ? [
    { id: 'A1', at: ago(30), actor: 'owner', event: 'Approval requested', taskId: 'K7Q2MA', detail: 'Claude finished; ChatGPT reviewed' },
    { id: 'A2', at: ago(40), actor: 'owner', event: 'Checkpoint pushed', taskId: 'K7Q2MA', detail: 'a1b2c3d · 3 files changed' },
    { id: 'A3', at: ago(20), actor: 'owner', event: 'ChatGPT ran out of usage', taskId: null, detail: '' },
    { id: 'A4', at: ago(100), actor: 'owner', event: 'Task created', taskId: 'W5MJ1E', detail: 'Merge Team view branch into main' },
    { id: 'A5', at: ago(100), actor: 'owner', event: 'Policy check passed', taskId: 'W5MJ1E', detail: 'High-impact action (merge).' },
    { id: 'A6', at: ago(600), actor: 'owner', event: 'Approved', taskId: 'Y9GH6S', detail: '' },
  ] : [];
  const chat = populated ? [
    { id: 'C1', who: 'owner', at: ago(15), text: 'Team: what should we do next for Hearth OS settings?' },
    { id: 'C2', who: 'anthropic', at: ago(14), model: 'claude-opus', text: 'I suggest two tasks: a controller remap page (ChatGPT reviews) and docs for Quick Access (Gemini).', proposals: [{ title: 'Add controller remapping page', assignee: 'anthropic', reviewer: 'openai', action: 'code', taskId: 'K7Q2MA' }, { title: 'Audio output switcher in Quick Access', assignee: 'openai', reviewer: 'anthropic', action: 'code' }] },
    { id: 'C3', who: 'google', at: ago(13), text: 'Agreed. I can also fact-check the gamepad mapping against SDL\'s controller database.' },
    { id: 'C4', who: 'ollama', at: ago(12), text: 'Local review ready whenever you want a free second opinion.' },
    { id: 'C5', who: 'system', at: ago(11), text: 'ChatGPT is out of usage until about 1 hour from now.' },
  ] : [];
  const state = { version: 1, tasks, audit, models: {}, chat, agentStatus: populated ? { openai: { outUntil: new Date(Date.now() + 3600000).toISOString(), reason: 'usage limit reached' } } : {}, autoHandoff: true, roles: {}, lead: 'anthropic', disabled: {}, setupDismissed: populated };
  const settings = { project: populated ? '/home/owner/Projects/hearth-os' : null, projects: populated ? ['/home/owner/Projects/hearth-os', '/home/owner/Projects/beacon'] : [], connection: { anthropic: 'cli', openai: 'cli' }, bins: {}, access: 'standard', extraDirs: populated ? ['/home/owner/Games'] : [], autoPush: true, chatEdits: true };
  const agents = populated
    ? { anthropic: { installed: true, signedIn: true, path: '/usr/bin/claude' }, openai: { installed: true, signedIn: true, path: '/usr/bin/codex' }, google: { installed: true, signedIn: true, path: '/usr/bin/gemini' }, ollama: { installed: true, models: ['llama3.2'] }, freebuff: { installed: true, signedIn: null, path: '/usr/bin/freebuff' } }
    : { anthropic: { installed: false, signedIn: false }, openai: { installed: true, signedIn: false }, google: { installed: false, signedIn: false }, ollama: { installed: false }, freebuff: { installed: false } };
  const git = populated ? { repo: true, branch: 'main', defaultBranch: 'main', remote: 'https://github.com/example/hearth-os.git', dirty: 0, ahead: 0, behind: 2, branches: [
    { name: 'main', track: '[behind 2]', when: '2 hours ago', protected: true },
    { name: 'hearth/task-K7Q2MA', track: '', when: '30 minutes ago', protected: false },
    { name: 'hearth/task-P3LX9Z', track: '[ahead 1]', when: '20 minutes ago', protected: false } ] } : { repo: false };
  const ok = async (v) => v;
  window.hearth = {
    loadState: () => ok(JSON.parse(JSON.stringify(state))),
    saveState: () => ok(true),
    appInfo: () => ok({ appVersion: '0.4.0', hearthOsVersion: '0.6.55', dataPath: '/home/owner/.config/Hearth AI Command Center', electron: '45.0.0', packaged: true }),
    backups: () => ok({ recoveredFrom: null, backups: populated ? [{ n: 1, at: ago(60), size: 18234 }, { n: 2, at: ago(240), size: 17012 }] : [] }),
    restoreBackup: () => ok(state), exportAll: () => ok({ ok: false }),
    providerStatus: () => ok({ encryption: true, weakEncryption: false, defaults: { anthropic: 'claude-sonnet-4-5', openai: 'gpt-5' }, keys: {} }),
    setKey: () => ok(true), removeKey: () => ok(true), ask: () => ok({ ok: false }),
    settings: () => ok(settings), setConnection: () => ok(settings), pickProject: () => ok(settings), pickBinary: () => ok(settings), useProject: () => ok(settings), setSettings: () => ok(settings), addDir: () => ok(settings), removeDir: () => ok(settings),
    gitTools: () => ok(populated ? { git: '/usr/bin/git', gh: '/usr/bin/gh', ghUser: 'Dragongamer9' } : { git: '/usr/bin/git', gh: null, ghUser: null }),
    gitLogin: () => ok({ ok: false }), gitStatus: () => ok(git), gitPull: () => ok({ ok: false, message: 'CI preview' }), gitPushTask: () => ok({ ok: false }), gitPushBranch: () => ok({ ok: false }), gitMergeApproved: () => ok({ ok: false, message: 'CI preview' }), gitOpenPr: () => ok({ ok: false }), gitClone: () => ok({ ok: false }),
    agentStatus: (a) => ok(agents[a] || {}), agentLogin: () => ok({ ok: false }), agentInstall: () => ok({ ok: false }), agentLogout: () => ok({ ok: false }),
    run: () => new Promise(() => {}), cancelRun: () => ok(true),
    ensureWorkspace: (id) => ok({ branch: `hearth/task-${id}`, baseSha: 'abc1234' }), checkpoint: () => ok(null), workspaceSummary: () => ok(populated ? ' src/settings/RemapPage.qml | 120 +++\n src/settings/store.js | 18 +-\n 2 files changed' : ''),
    openWorkspace: () => ok(true), openFreebuff: () => ok({ ok: false }),
    updaterInfo: () => ok({ enabled: true, reason: '', status: populated ? { state: 'available', version: '0.4.1' } : { state: 'idle' } }),
    checkForUpdates: () => ok(true), downloadUpdate: () => ok(true), installUpdate: () => ok(true), onUpdaterStatus: () => () => {},
  };
}

const VIEWS = ['overview', 'chat', 'board', 'approvals', 'agents', 'github', 'audit', 'settings'];
const browser = await chromium.launch();
const errors = [];
for (const scenario of ['fresh', 'populated']) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, bypassCSP: true, colorScheme: 'dark' });
  await ctx.addInitScript(stub, scenario);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${scenario}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${scenario} console: ${m.text()}`); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.shell', { timeout: 15000 });
  let i = 1;
  const shot = async (name) => { const f = `${OUT}/${scenario}-${String(i++).padStart(2, '0')}-${name}.png`; await page.waitForTimeout(400); await page.screenshot({ path: f }); console.log('saved', f); };
  for (const v of VIEWS) {
    await page.click(`.side [data-nav="${v}"]`);
    await shot(v);
    const full = await page.evaluate(() => document.querySelector('.main')?.scrollHeight || 0);
    if (full > 1000) { await page.screenshot({ path: `${OUT}/${scenario}-${String(i++).padStart(2, '0')}-${v}-full.png`, fullPage: true }); }
  }
  await page.click('[data-new]');
  await shot('new-task-dialog');
  await page.keyboard.press('Escape');
  if (scenario === 'populated') {
    await page.click('.side [data-nav="board"]');
    await page.click('[data-open="K7Q2MA"]');
    await shot('task-drawer-awaiting-approval');
    await page.keyboard.press('Escape');
    await page.click('[data-open="T2VB7H"]');
    await shot('task-drawer-boot-critical');
    await page.keyboard.press('Escape');
  }
  await ctx.close();
}
await browser.close();
console.log(errors.length ? `Page errors:\n${errors.join('\n')}` : 'No page errors.');

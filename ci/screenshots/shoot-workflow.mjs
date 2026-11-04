// CI-only screenshots for the team workflow: the task truth card, a refused action with
// its reason, the review packet, the release preview checklist, the Jobs panel and the
// blocker states. Fake data only; fails on page errors.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.OUT_DIR || 'shots';
mkdirSync(OUT, { recursive: true });

function stub() {
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  const pol = () => ({ ok: true, block: [], warn: [] });
  const H1 = 'c0ffee15d9a3b2e4f6a7c0ffee15d9a3b2e4f6a7';
  const H2 = 'f00dbabe1234567890abcdef1234567890abcdef';
  const packet = `REVIEW PACKET for T-WF0001 “Text size option for the Command Center”\nReview exactly this commit: ${H2}\nTests at f00dbab: passed — \`npm test\`\nChanges since your last sign-off (c0ffee1):\nCommits:\nf00dbab Text size: remember the choice per project\nFiles:\n src/main.js | 12 ++++++++----\nYour previous CHANGES requests:\n- ADDRESSED (asked at c0ffee1): the size resets after a restart\n  by: f00dbab Text size: remember the choice per project\nEnd with exactly one line: "APPROVE: T-WF0001 @f00dbab" or "CHANGES: T-WF0001 <what must be fixed>".`;
  const tasks = [
    { id: 'WF0001', title: 'Text size option for the Command Center', description: 'Small, normal, large; remembered.', assignee: 'anthropic', reviewer: 'openai', action: 'code', stage: 'review', notes: [], policy: pol(), ws: { branch: 'hearth/wf0001-text-size', baseSha: 'abc1234' },
      runs: [{ id: 'r1', agent: 'anthropic', status: 'done', at: ago(40), head: H2, appTests: 'passed', tests: 'passed', testCommand: 'npm test', output: 'Done.\nACK: N1 kept the old default\nSTATUS: DONE' }],
      done: { sha: H2, tests: 'passed', at: ago(40), by: 'anthropic' }, testAt: { [H2]: { status: 'passed', command: 'npm test', at: ago(39) } },
      reviews: [{ by: 'openai', verdict: 'changes', sha: H1, reason: 'the size resets after a restart', at: ago(90), accepted: true }, { by: 'openai', verdict: 'approve', sha: H1, reason: '', at: ago(30), accepted: false, why: 'head moved since your review (c0ffee1→f00dbab)' }],
      instructions: [{ id: 'N1', at: ago(100), from: 'Owner', kind: 'owner', text: 'T-WF0001 keep normal as the default size', acked: { at: ago(40), by: 'anthropic' } }, { id: 'N2', at: ago(20), from: 'Claude (lead)', kind: 'note', text: 'merge main first', acked: null }],
      reviewPing: { key: H2, sha: H2, at: ago(39), packet }, createdAt: ago(300), updatedAt: ago(30) },
    { id: 'WF0002', title: 'Storage page tests on the build machine', description: '', assignee: 'openai', reviewer: 'google', action: 'code', stage: 'implementing', notes: [], policy: pol(), ws: { branch: 'hearth/wf0002-storage', baseSha: 'abc1234' },
      runs: [{ id: 'r2', agent: 'openai', status: 'continue', at: ago(15), output: 'STATUS: CONTINUE' }],
      blockers: [{ kind: 'environment', title: 'Test glob needs Node 21+', detail: "npm test runs `node --test 'test/*.test.*'`; Node 20.11.0 doesn't expand quoted globs.", next: 'Use Node 22 for this project, or set the test command on the Project page to an unquoted glob.' }, { kind: 'dependency', title: 'Dependencies not installed', detail: '41 package(s) in package.json, no node_modules in this workspace.', next: 'Set the test command to "npm ci && npm test" on the Project page.' }],
      testBlocker: { kind: 'permission', title: 'Permission denied', detail: 'A file, folder or permission request was denied.', next: 'Answer the pending permission card, or grant the folder in Settings › Folder access.' },
      createdAt: ago(200), updatedAt: ago(15) },
    { id: 'WF0003', title: 'Docs: release checklist', description: '', assignee: 'google', reviewer: 'openai', action: 'docs', stage: 'approval', notes: [], policy: pol(), ws: { branch: 'hearth/wf0003-docs', baseSha: 'abc1234' }, runs: [],
      reviewVerdict: { verdict: 'approve', by: 'openai', sha: H1, at: ago(10) }, reviews: [{ by: 'openai', verdict: 'approve', sha: H1, at: ago(10), accepted: true }], testAt: { [H1]: { status: 'not run', command: null, at: ago(10) } }, createdAt: ago(100), updatedAt: ago(10) },
  ];
  const chat = [
    { id: 'C1', who: 'owner', at: ago(50), text: 'T-WF0001 keep normal as the default size, please.' },
    { id: 'C2', who: 'openai', at: ago(30), model: 'Codex', text: 'Looked at the text size change again.\nAPPROVE: T-WF0001 @c0ffee1\nSTART: T-NOPE99', results: [{ line: 'APPROVE: T-WF0001', ok: false, reason: 'head moved since your review (c0ffee1→f00dbab)' }, { line: 'START: T-NOPE99', ok: false, reason: 'only the lead (Claude) can do that' }] },
    { id: 'C3', who: 'anthropic', at: ago(20), model: 'Claude Code', text: 'TASK NOTE: T-WF0001 merge main first\nVERIFY: T-WF0003', results: [{ line: 'TASK NOTE: T-WF0001', ok: true, reason: 'logged as N2; the runner must acknowledge it' }, { line: 'VERIFY: T-WF0003', ok: true, reason: 'verify-only run started with Gemini (read-only; nothing can be changed)' }] },
    { id: 'C4', who: 'system', at: ago(5), text: 'Heads-up: v1.0.0 appeared on GitHub at 34c616d, but the app didn\'t make it. Check the Release gate page before tagging or merging more.' },
  ];
  const state = { version: 1, tasks, audit: [], models: {}, chat, permissions: [], chatSessions: {}, agentStatus: {}, autoHandoff: true, roles: {}, lead: 'anthropic', disabled: {}, setupDismissed: true, opsSeenAt: ago(60),
    wfTags: { baseline: ['v0.9.0'], made: [], outside: [{ name: 'v1.0.0', sha: '34c616d0000000000000000000000000000000000', release: false, at: ago(5) }] },
    habitat: { board: { anthropic: { text: 'Release prep today', at: ago(30) } }, journal: { google: [{ at: ago(10), text: 'went to the garden' }] } } };
  const settings = { project: '/home/owner/Projects/hearth-ai-command-center', projects: ['/home/owner/Projects/hearth-ai-command-center'], connection: { anthropic: 'cli', openai: 'cli', xai: 'cli', mistral: 'cli', perplexity: 'api', deepseek: 'api' }, bins: {}, access: 'standard', extraDirs: [], autoPush: false, chatEdits: true, chatResume: true, theme: 'dark', approvalLevels: {}, leadActions: true, ownerIdentity: { name: 'Dragongamer9', email: 'Dragongamer9@users.noreply.github.com' } };
  const agents = { anthropic: { installed: true, signedIn: true, path: '/usr/bin/claude' }, openai: { installed: true, signedIn: true, path: '/usr/bin/codex' }, google: { installed: true, signedIn: true, path: '/usr/bin/agy', tool: 'agy' }, ollama: { installed: false }, freebuff: { installed: false } };
  const projects = { active: 'default', list: [{ id: 'default', name: 'hearth-ai-command-center', dir: settings.project, settings: { testCommand: null, testTimeoutMin: 15, stallMin: 45, nextVersion: '1.1.0', versionFile: 'package.json', docsPaths: '*.md, **/*.md, docs/**, release-notes/**' } }] };
  const truth = {
    WF0001: { known: true, branch: 'hearth/wf0001-text-size', head: H2, behind: 2, ahead: 5, stat: '4 files, +86 −12', dirty: false, merged: null },
    WF0002: { known: true, branch: 'hearth/wf0002-storage', head: 'aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44', behind: 0, ahead: 2, stat: '2 files, +40 −3', dirty: true, merged: null },
    WF0003: { known: true, branch: 'hearth/wf0003-docs', head: H1, behind: 0, ahead: 1, stat: '1 file, +22 −0', dirty: false, merged: 'release/next' },
  };
  const commits = [{ sha: '34c616d0', subject: 'Merge hearth/98xuz2-prepare-the-1-0-release (approved in Hearth AI Command Center)' }, { sha: 'd92bc780', subject: 'Merge hearth/7vpj34-text-size-option-for-the-command-center (approved in Hearth AI Command Center)' }];
  const preview = { ok: true, version: '1.1.0', sha: '02fe1d2a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e', ref: 'origin/main', lastTag: 'v1.0.0', commits, tasks: [{ id: '7VPJ34', title: 'text size option for the command center' }, { id: '98XUZ2', title: 'prepare the 1 0 release' }], notesRel: 'release-notes/v1.1.0.md', notes: '- Text size option for the Command Center\n- Brand new cloud sync',
    tests: { status: 'passed', command: 'npm test' },
    list: [
      { id: 'version', label: 'Version files equal the Next version (v1.1.0)', ok: false, detail: 'The version file says 1.0.0 at 02fe1d2.' },
      { id: 'notes', label: 'release-notes/v1.1.0.md maps to merged commits on main', ok: false, detail: '1 line(s) match no merged commit: “Brand new cloud sync”', lines: [{ text: 'Text size option for the Command Center', ok: true, match: 'T-7VPJ34' }, { text: 'Brand new cloud sync', ok: false, match: null }] },
      { id: 'tests', label: 'Full test suite passes at 02fe1d2', ok: true, detail: 'passed — npm test' },
      { id: 'authorship', label: 'Authorship check passes (only the owner, no AI attribution)', ok: true, detail: '2 commit(s) checked' },
    ],
    gate: { ok: false, reason: 'release checklist failed: Version files equal the Next version (v1.1.0); release-notes/v1.1.0.md maps to merged commits on main' } };
  const jobs = [
    { id: 'J1A2B3C4D', kind: 'image', agent: 'google', title: 'Image for Claude: text size settings mockup', taskId: 'WF0001', startedAt: ago(6), status: 'running', restarts: 1, progress: ['[10:02:11] started', 'Generating 3 variants…', 'variant 1 saved'], outputs: ['/w/.hearth-ai/assets/google/mockup-1.png'], error: null },
    { id: 'J9F8E7D6C', kind: 'background', agent: 'openai', title: 'Research GRUB theme formats', taskId: null, startedAt: ago(90), status: 'lost', restarts: 0, progress: ['[08:31:40] started', 'reading gnu.org manual'], outputs: [], error: { kind: 'lost', message: 'The job stopped without a result (the computer restarted or it was killed).' } },
    { id: 'J5E5E5E5E', kind: 'background', agent: 'anthropic', title: 'Summarise the 1.0 release notes', taskId: null, startedAt: ago(200), status: 'done', restarts: 0, retryOf: null, progress: ['[07:00:00] started', '[07:04:10] finished'], outputs: ['/w/.hearth-ai/assets/anthropic/summary.md'], error: null },
  ];
  const ok = async (v) => v;
  const base = {
    loadState: () => ok(JSON.parse(JSON.stringify(state))), saveState: () => ok(true),
    appInfo: () => ok({ appVersion: '1.0.0', hearthOs: null, dataPath: '/home/owner/.config/Hearth AI Command Center', electron: '45.0.0', packaged: true }),
    backups: () => ok({ recoveredFrom: null, backups: [] }), providerStatus: () => ok({ encryption: true, weakEncryption: false, defaults: {}, keys: {} }),
    settings: () => ok(settings), setSettings: (p) => { Object.assign(settings, p); return ok({ ...settings }); },
    gitTools: () => ok({ git: '/usr/bin/git', gh: '/usr/bin/gh', ghUser: 'Dragongamer9' }),
    gitStatus: () => ok({ repo: true, branch: 'main', defaultBranch: 'main', remote: 'https://github.com/example/x.git', dirty: 0, ahead: 0, behind: 0, branches: [] }),
    gitPrList: () => ok({ ok: true, prs: [] }), agentStatus: (a) => ok(agents[a] || {}),
    run: () => new Promise(() => {}), cancelRun: () => ok(true), checkpoint: () => ok(null), workspaceSummary: () => ok(''), workspaceHead: () => ok(H2),
    historyScan: () => ok({ ok: true, found: 0 }), historySearch: () => ok([]), historyStats: () => ok({ total: 0, by: {} }),
    themeGet: () => ok({ found: false, dir: '~/.config/hearth', tokens: {}, css: '' }), updaterInfo: () => ok({ enabled: false, reason: '', status: { state: 'idle' } }),
    opsProjects: () => ok(projects), opsIdentityDefault: () => ok({ saved: settings.ownerIdentity, suggested: settings.ownerIdentity }),
    opsJobs: () => ok(jobs), opsJobRetry: (id) => ok({ id: 'J7777AAAA', retryOf: id }), opsTruth: (ids) => ok(Object.fromEntries(ids.filter((i) => truth[i]).map((i) => [i, truth[i]]))),
    opsReleasePreview: () => ok(preview), opsRemoteTags: () => ok({ ok: true, tags: [{ name: 'v0.9.0', sha: 'a' }, { name: 'v1.0.0', sha: '34c616d' }] }),
    opsPhoneStatus: () => ok({ enabled: false, running: false, port: 8787, urls: [], devices: [], pairing: null }), opsPhonePush: () => ok(true),
    opsHardware: () => ok({ ramGb: 32, vramGb: 12, discrete: true, gpu: 'NVIDIA' }), opsUpscaleTools: () => ok({ esrgan: null, ffmpeg: '/usr/bin/ffmpeg' }),
  };
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
page.on('pageerror', (e) => errors.push(`workflow: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`workflow console: ${m.text()}`); });
page.on('dialog', (d) => d.dismiss());
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.shell', { timeout: 15000 });
await page.waitForTimeout(4500); // truth facts load 3 s after start
if (await page.locator('[data-ops="identitylater"]').count()) { await page.click('[data-ops="identitylater"]'); await page.waitForTimeout(300); }
let i = 1;
const shot = async (label, { full = false } = {}) => {
  const f = `${OUT}/wf-${String(i++).padStart(2, '0')}-${label}.png`;
  await page.waitForTimeout(350);
  await page.screenshot({ path: f, fullPage: full });
  console.log('saved', f);
};
// Pages used less often sit under More in the sidebar: open it first when needed.
const nav = async (v) => { const sel = `.side [data-nav="${v}"]`; if (!(await page.locator(sel).count())) { await page.click('.side [data-ui="more"]'); await page.waitForTimeout(150); } await page.click(sel); await page.waitForTimeout(400); };

// Overview: a tag made outside the app.
await nav('overview');
check((await page.textContent('.main')).includes('Made outside the app') && (await page.textContent('.main')).includes('v1.0.0'), 'outside tag warning on the Overview');

// Board: truth badges (behind main, tests at the sha, refused review), blocker badges.
await nav('board');
const card = await page.textContent('[data-open="WF0001"]');
check(card.includes('behind main by 2') && card.includes('tests passed') && card.includes('@f00dbab'), 'board truth badges');
check((await page.textContent('[data-open="WF0002"]')).includes('Environment problem'), 'blocker badge on the board');
await shot('board-truth-badges');

// Drawer: the truth card, the review lock, the instruction log and the review packet.
await page.click('[data-open="WF0001"]'); await page.waitForTimeout(500);
const d1 = await page.textContent('.drawer');
check(d1.includes('Task truth') && d1.includes('hearth/wf0001-text-size') && d1.includes('behind 2 · ahead 5'), 'truth card in the drawer');
check(d1.includes('refused') && d1.includes('head moved since your review (c0ffee1→f00dbab)'), 'refused review with its reason');
check(d1.includes('only verify runs can start until the reviewer posts CHANGES'), 'review lock shown');
check(d1.includes('Instruction log') && d1.includes('merge main first'), 'instruction log');
check(d1.includes('Verify only: run checks and report'), 'verify-only run button');
await shot('drawer-truth-card');
await page.click('.wf-packet summary'); await page.waitForTimeout(300);
check((await page.textContent('.wf-packet')).includes('ADDRESSED (asked at c0ffee1)'), 'review packet with addressed CHANGES');
await page.locator('.wf-packet').scrollIntoViewIfNeeded();
await shot('review-packet');
await page.keyboard.press('Escape');
await page.click('[data-close]').catch(() => {});
await page.waitForTimeout(300);

// Blockers: environment, dependency and permission are separate states with next actions.
await page.click('[data-open="WF0002"]'); await page.waitForTimeout(500);
check(await page.locator('.wf-blocker').count() === 3, 'three blocker states');
check((await page.textContent('.drawer')).includes("not the implementer's code failure"), 'blockers are not code failures');
await page.locator('.wf-blockers').scrollIntoViewIfNeeded();
await shot('blocker-states');
await page.click('[data-close]').catch(() => {});
await page.waitForTimeout(300);

// Chat: refused actions with their exact reasons, and the passive Habitat status panel.
await nav('chat');
const log = await page.textContent('#chat-log');
check(log.includes('head moved since your review (c0ffee1→f00dbab)') && log.includes('only the lead (Claude) can do that'), 'refused actions with reasons');
check((await page.textContent('#team-panel')).includes('Hall board') && (await page.textContent('#team-panel')).includes('garden'), 'passive Habitat status in the team panel');
await shot('chat-refused-actions-and-habitat-status');

// Release gate: preview checklist blocks on a version mismatch and an unmatched note.
await nav('release');
await page.click('[data-wf="preview"]'); await page.waitForTimeout(600);
const rel = await page.textContent('.main');
check(rel.includes('Checklist') && rel.includes('The version file says 1.0.0') && rel.includes('Brand new cloud sync'), 'release checklist and unmatched note');
check(rel.includes('The release waits'), 'release waits');
check(await page.locator('.wf-unmatched').count() === 1, 'one unmatched note line');
await shot('release-preview-checklist', { full: true });

// Jobs panel.
await nav('jobs');
const jobsText = await page.textContent('.main');
check(jobsText.includes('Restarts survived') && jobsText.includes('variant 1 saved') && jobsText.includes('mockup-1.png'), 'jobs with progress, outputs and restarts');
check(await page.locator('[data-wf="jobcancel"]').count() === 1 && await page.locator('[data-wf="jobretry"]').count() === 2, 'Cancel and Retry');
await shot('jobs-panel', { full: true });

await browser.close();
console.log(errors.length ? `Page errors:\n${errors.join('\n')}` : 'No page errors.');
if (errors.length) process.exit(1);

// Team ops, renderer side (src/ops/*): budget, summary, strengths, stats, hand-offs, CI,
// feeds and the approval-level policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { budgets, budgetFor, pickByHeadroom, estimateCap, nearLimitWarning, DEFAULT_CAP } from '../src/ops/budget.mjs';
import { buildSummary } from '../src/ops/summary.mjs';
import { inferKind, outcomes, score, suggest } from '../src/ops/strength.mjs';
import { taskStats, agentTotals, fmtMs } from '../src/ops/stats.mjs';
import { decideHandoff, askCard, MAX_HANDOFFS } from '../src/ops/handoff.mjs';
import { ciBranches, authorOf, applyCi, ciChangesText } from '../src/ops/ci.mjs';
import { parseMemoryLines, logTask, phoneSnapshot, phoneAction, opsSnapshot } from '../src/ops/feeds.mjs';
import { CATEGORIES, MOVABLE, OWNER_ONLY, DEFAULT_LEVELS, cleanLevels, levelPatch, splitAsks, classifyAsk, leadMayApprove, policyText, setLevels } from '../src/ops/approval.mjs';
import { parseDirectives, buildPrompt } from '../src/chat.mjs';
import { leadDecision } from '../src/lead.mjs';
import { buildTaskBrief } from '../src/team.mjs';

const require = createRequire(import.meta.url);
const NOW = Date.parse('2026-11-02T12:00:00Z');
const at = (minAgo) => new Date(NOW - minAgo * 60000).toISOString();

// 3. Budget
test('budget: headroom from runs, limit hits, reset hints and /usage; routing picks the most headroom', () => {
  const runs = Array.from({ length: 10 }, (_, i) => ({ agent: 'anthropic', status: 'done', at: at(400 + i), ms: 60000 }));
  runs.push({ agent: 'anthropic', status: 'limit', at: at(399) });
  const tasks = [{ id: 'T1', runs: [...runs, { agent: 'anthropic', status: 'done', at: at(30), ms: 120000 }, { agent: 'openai', status: 'done', at: at(10) }] }];
  assert.equal(estimateCap(tasks[0].runs.filter((r) => r.agent === 'anthropic').sort((a, b) => a.at.localeCompare(b.at))), 11);
  const b = budgets({ agents: ['anthropic', 'openai', 'google', 'xai'], tasks, agentStatus: { xai: { outUntil: at(-30), reason: 'resets in 30 min' } }, usage: { google: { usedPct: 90 } }, now: NOW });
  assert.equal(b.anthropic.recent, 1);
  assert.equal(b.anthropic.cap, 11);
  assert.equal(b.anthropic.limitHits, 1);
  assert.equal(b.openai.cap, DEFAULT_CAP);
  assert.equal(b.xai.headroom, 0);
  assert.equal(b.xai.out, true);
  assert.equal(b.xai.reset, 'resets in 30 min');
  assert.equal(b.google.headroom, 0.1);
  assert.equal(b.google.near, true);
  assert.equal(b.google.source, 'usage');
  assert.equal(pickByHeadroom(['xai', 'google', 'openai', 'anthropic'], b), 'openai');
  assert.equal(pickByHeadroom(['xai'], b), null);
  const long = { id: 'L1', title: 'Rewrite the whole installer', description: '' };
  assert.match(nearLimitWarning(long, 'google', b, { google: 'Gemini' }), /Gemini is near its usage limit \(10% headroom/);
  assert.equal(nearLimitWarning({ id: 'S1', title: 'Fix typo' }, 'google', b), null);
  assert.equal(nearLimitWarning(long, 'openai', b), null);
  assert.equal(budgetFor({ agent: 'mistral', tasks: [], now: NOW }).headroom, 1);
});

// 2. Summary
test('summary: per-AI work since last look, waiting items, failures and usage, from audit + board', () => {
  const since = at(600);
  const audit = [
    { at: at(500), actor: 'anthropic', event: 'Claude finished a run', taskId: 'A1' },
    { at: at(400), actor: 'google', event: 'Gemini reviewed', taskId: 'A1' },
    { at: at(300), actor: 'owner', event: 'Owner approved and merged', taskId: 'A1' },
    { at: at(200), actor: 'openai', event: 'Tests failed', taskId: 'B2', detail: 'npm test' },
    { at: at(150), actor: 'openai', event: 'Hand-off to Claude', taskId: 'B2' },
    { at: at(900), actor: 'anthropic', event: 'Claude finished a run', taskId: 'OLD' },
  ];
  const tasks = [
    { id: 'A1', title: 'Storage page', stage: 'approved', done: { at: at(450), by: 'anthropic' }, runs: [{ agent: 'anthropic', status: 'done', at: at(500), ms: 600000, usage: { tokens: 1200 } }] },
    { id: 'B2', title: 'Wi-Fi', stage: 'approval', assignee: 'openai', runs: [{ agent: 'openai', status: 'limit', at: at(200), ms: 60000 }] },
  ];
  const s = buildSummary({ audit, tasks, permissions: [{ id: 'R1', status: 'pending', agent: 'openai', kind: 'push', what: 'push' }], cards: [{ id: 'C1', status: 'pending', text: 'Who continues?' }], since, now: at(0), agents: ['anthropic', 'openai', 'google'] });
  const by = Object.fromEntries(s.agents.map((r) => [r.agent, r]));
  assert.equal(by.anthropic.finished, 1, 'older events ignored');
  assert.equal(by.anthropic.done, 1);
  assert.equal(by.anthropic.tokens, 1200);
  assert.equal(by.google.reviews, 1);
  assert.equal(by.openai.failures, 1);
  assert.equal(by.openai.handoffs, 1);
  assert.equal(by.openai.limits, 1);
  assert.equal(s.totals.merges, 1);
  assert.equal(s.waitingCount, 3);
  assert.equal(s.failed[0].title, 'Wi-Fi');
  assert.equal(s.totals.ms, 660000);
  assert.equal(buildSummary({ since: at(1), agents: ['anthropic'] }).quiet, true);
});

// 5. Strengths
test('strengths: kind from labels or title; outcomes; suggestion never uses the same AI twice', () => {
  assert.equal(inferKind({ title: 'Add unit tests for the store' }), 'tests');
  assert.equal(inferKind({ title: 'Polish the Storage page layout' }), 'ui');
  assert.equal(inferKind({ title: 'Whatever', labels: ['docs'] }), 'docs');
  assert.equal(inferKind({ title: 'Fix wifi resume', action: 'code' }), 'code');
  const tasks = [
    { id: '1', title: 'Fix wifi', runs: [{ agent: 'openai', appTests: 'passed', ms: 600000 }, { agent: 'openai', appTests: 'passed', ms: 600000 }] },
    { id: '2', title: 'Fix audio', runs: [{ agent: 'anthropic', appTests: 'failed', ms: 3600000 }] },
  ];
  const log = [{ ev: 'verdict', builder: 'openai', reviewer: 'google', verdict: 'approve', kind: 'code' }, { ev: 'verdict', builder: 'anthropic', reviewer: 'google', verdict: 'changes', kind: 'code' }, { ev: 'ci', author: 'anthropic', ok: false, kind: 'code' }];
  const st = outcomes(tasks, log);
  assert.equal(st.openai.code.passed, 2);
  assert.equal(st.anthropic.code.ciFailed, 1);
  assert.equal(st.google.review.reviewsGiven, 2);
  assert.ok(score(st.openai.code) > score(st.anthropic.code));
  const s = suggest({ task: { title: 'Fix bluetooth' }, builders: ['anthropic', 'openai'], reviewers: ['openai', 'google', 'anthropic'], stats: st, budgets: {} });
  assert.equal(s.builder, 'openai');
  assert.equal(s.reviewer, 'google');
  const only = suggest({ task: {}, builders: ['openai'], reviewers: ['openai', 'anthropic'], stats: {}, budgets: {} });
  assert.notEqual(only.builder, only.reviewer);
  const out = suggest({ task: {}, builders: ['openai', 'anthropic'], reviewers: ['google'], stats: st, budgets: { openai: { headroom: 0 } } });
  assert.equal(out.builder, 'anthropic', 'no headroom, no assignment');
});

// 6. Cost and time
test('stats: elapsed, work time, runs, retries, hand-offs and tokens per task and per AI', () => {
  const t = { id: 'X', title: 'x', stage: 'approved', createdAt: at(120), updatedAt: at(0), runs: [{ agent: 'openai', status: 'failed', ms: 60000 }, { agent: 'openai', status: 'limit', ms: 60000 }, { agent: 'anthropic', status: 'done', ms: 120000, usage: { tokens: 500 } }, { agent: 'anthropic', status: 'running' }], handoffs: [{ from: 'openai', to: 'anthropic', kind: 'limit' }] };
  const s = taskStats(t, NOW);
  assert.equal(s.elapsedMs, 120 * 60000);
  assert.equal(s.workMs, 240000);
  assert.equal(s.runs, 3);
  assert.equal(s.retries, 2);
  assert.equal(s.handoffs, 1);
  assert.equal(s.tokens, 500);
  const a = Object.fromEntries(agentTotals([t]).map((x) => [x.agent, x]));
  assert.equal(a.openai.retries, 1);
  assert.equal(a.openai.handoffsFrom, 1);
  assert.equal(a.anthropic.handoffsTo, 1);
  assert.equal(a.openai.tokens, null, 'no tokens unless a CLI reported them');
  assert.equal(fmtMs(90 * 60000), '1 h 30 min');
});

// 4. Hand-off
test('hand-off: crash, stall or limit go to a same-role AI with headroom; capped at 2, then ask', () => {
  const task = { id: 'H1', title: 'Fix', reviewer: 'google', handoffs: [] };
  const b = { openai: { headroom: 0.2 }, mistral: { headroom: 0.9 }, xai: { headroom: 0 } };
  for (const kind of ['limit', 'stalled', 'failed', 'timeout']) {
    const d = decideHandoff({ task, from: 'anthropic', kind, candidates: ['anthropic', 'google', 'openai', 'mistral', 'xai'], budgets: b });
    assert.equal(d.action, 'handoff', kind);
    assert.equal(d.to, 'mistral', 'most headroom, never the reviewer or itself');
  }
  assert.equal(decideHandoff({ task, from: 'anthropic', kind: 'cancelled', candidates: ['openai'] }).action, 'none');
  assert.equal(decideHandoff({ task, from: 'anthropic', kind: 'limit', candidates: ['openai'], autoHandoff: false }).action, 'none');
  const tried = { ...task, handoffs: [{ from: 'anthropic', to: 'mistral', kind: 'limit' }] };
  assert.equal(decideHandoff({ task: tried, from: 'mistral', kind: 'stalled', candidates: ['anthropic', 'openai', 'mistral'], budgets: b }).to, 'openai', 'prefers an AI that has not had it');
  const capped = { ...task, handoffs: [{}, {}] };
  assert.equal(MAX_HANDOFFS, 2);
  assert.equal(decideHandoff({ task: capped, from: 'openai', kind: 'limit', candidates: ['mistral'], budgets: b }).action, 'ask');
  const card = askCard(task, 'openai', 'limit', ['mistral']);
  assert.deepEqual(card.options.map((o) => o.value), ['to:mistral', 'leave']);
});

// 8. CI on the board
test('CI: branches to watch; a new failure goes back to the AI that wrote the commit, once', () => {
  const t = { id: 'C1', title: 'x', stage: 'review', assignee: 'openai', ws: { branch: 'hearth/c1' }, runs: [{ agent: 'anthropic', head: 'aaaaaaa111', status: 'done' }, { agent: 'openai', head: 'bbbbbbb222', status: 'done' }] };
  assert.deepEqual(ciBranches([t, { stage: 'approved', ws: { branch: 'old' } }], ['release/next']), ['hearth/c1', 'release/next']);
  assert.equal(authorOf(t, 'aaaaaaa111'), 'anthropic');
  assert.equal(authorOf(t, 'unknown'), 'openai');
  const fail = { branch: 'hearth/c1', state: 'failure', sha: 'aaaaaaa111', runId: 77, url: 'https://github.com/o/r/actions/runs/77', job: { name: 'appimage', step: 'Unit tests' }, workflow: 'Build', tail: '##[error] 1 test failed' };
  const a = applyCi(t, fail);
  assert.equal(a.newFailure, true);
  assert.equal(a.author, 'anthropic');
  assert.equal(applyCi(t, fail).newFailure, false, 'handled once');
  assert.equal(applyCi(t, { ...fail, runId: 78 }).newFailure, true);
  assert.match(ciChangesText(fail), /CI failed on aaaaaaa \(Build › appimage › Unit tests\)[\s\S]*1 test failed/);
});

// 7/10/11 feeds
test('feeds: MEMORY lines, log tasks, phone snapshot and validated phone actions, opsSnapshot', () => {
  assert.deepEqual(parseMemoryLines('ok\n- **MEMORY: Wi-Fi code lives in mantel/net**\nMEMORY: x'), ['Wi-Fi code lives in mantel/net']);
  const lt = logTask({ code: 'AB12', date: '2026-11-01', path: 'logs/2026-11-01/AB12.txt', file: '/d/AB12.txt', summary: { device: 'ROG Ally', version: '0.6.52', errors: ['amdgpu: error'] } });
  assert.equal(lt.title, 'Look at log AB12');
  assert.match(lt.description, /Device: ROG Ally · Hearth OS: 0\.6\.52/);
  assert.match(lt.description, /- amdgpu: error/);
  const state = { tasks: [{ id: 'A1', title: 'a', stage: 'approval', assignee: 'openai', done: { tests: 'passed' } }, { id: 'B1', title: 'b', stage: 'intake', ci: { state: 'failure' } }], permissions: [{ id: 'R1', status: 'pending', agent: 'openai', kind: 'push', what: 'p' }, { id: 'R2', status: 'approved' }], chat: [{ who: 'owner', text: 'hi' }, { who: 'x', text: 'gone', deleted: true }], opsCards: [] };
  const ps = phoneSnapshot({ state, startLabel: (t) => (t.stage === 'intake' ? 'Start' : null) });
  assert.equal(ps.waiting.permissions.length, 1);
  assert.equal(ps.waiting.approvals[0].tests, 'tests passed');
  assert.equal(ps.board[0].tasks[0].canStart, 'Start');
  assert.equal(ps.board[0].tasks[0].ci, 'CI failed');
  assert.equal(ps.chat.length, 1);
  assert.deepEqual(phoneAction({ type: 'decide', id: 'R1', value: 'approved' }), { type: 'decide', id: 'R1', value: 'approved' });
  assert.equal(phoneAction({ type: 'decide', id: 'R1', value: 'maybe' }), null);
  assert.equal(phoneAction({ type: 'merge', id: 'A1' }), null, 'no merge from the phone');
  assert.equal(phoneAction({ type: 'approve', id: '../x' }), null);
  assert.deepEqual(phoneAction({ type: 'chat', value: '  hello ' }), { type: 'chat', value: 'hello' });
  const snap = opsSnapshot({ state: { tasks: [{ id: 'F1', title: 'f', done: { at: at(1), by: 'openai', tests: 'passed' }, ci: { state: 'success', sha: 's' }, runs: [{ agent: 'openai', status: 'limit', at: at(5) }] }] }, budgets: { openai: { headroom: 0.5, near: false, out: false, recent: 3, cap: 40, reset: null, extra: 1 } } });
  assert.equal(snap.finished[0].id, 'F1');
  assert.equal(snap.failures[0].kind, 'limit');
  assert.deepEqual(Object.keys(snap.budget.openai), ['headroom', 'near', 'out', 'recent', 'cap', 'reset']);
  assert.equal(snap.ci.F1.state, 'success');
  assert.doesNotThrow(() => JSON.stringify(snap));
});

// Approval levels
test('approval: ATTACH never prompts, routine asks never become cards, major ones do', () => {
  setLevels({});
  const plain = parseDirectives('Here is the page.\nATTACH: shots/storage.png');
  assert.equal(plain.asks.length, 0);
  for (const line of ['ASK: attach | post shots/storage.png in chat | so you can see it', 'ASK: other | post a screenshot of the Storage page in team chat', 'ASK: tests | run npm test', 'ASK: other | run the tests in my worktree', 'ASK: edit | commit on my own task branch', 'ASK: review | comment on T-ABC123', 'ASK: screenshot | capture the app window', 'ASK: read | read src/settings']) {
    const d = parseDirectives(line);
    assert.equal(d.asks.length, 0, line);
    assert.equal(d.routine.length, 1, line);
  }
  for (const [line, kind] of [['ASK: install | apt install ffmpeg | needed', 'install'], ['ASK: outside | edit ~/.bashrc', 'outside'], ['ASK: delete | delete build/ on main', 'delete'], ['ASK: secrets | read ~/.config/gh/hosts.yml', 'secrets'], ['ASK: network | curl an external API', 'network'], ['ASK: push | push hearth/x to GitHub', 'push'], ['ASK: merge | merge into main', 'merge'], ['ASK: version | set version 0.6.53', 'version'], ['ASK: other | post a screenshot after rm -rf build', 'delete']]) {
    const d = parseDirectives(line);
    assert.equal(d.asks.length, 1, line);
    assert.equal(d.asks[0].kind, kind, line);
  }
  assert.equal(classifyAsk({ kind: 'other', what: 'install the screenshot tool' }), 'other', 'major words win');
});

test('approval: the owner can move routine/major either way, never out of owner-only; the choice persists', () => {
  assert.deepEqual(OWNER_ONLY, ['merge', 'release', 'version', 'tag', 'settings']);
  for (const k of OWNER_ONLY) {
    assert.equal(levelPatch({}, k, 'routine').ok, false, k);
    assert.equal(cleanLevels({ [k]: 'routine' })[k], 'owner', k);
  }
  const r = levelPatch({}, 'install', 'routine');
  assert.deepEqual(r.saved, { install: 'routine' });
  const back = levelPatch(r.saved, 'attach', 'major');
  assert.deepEqual(back.saved, { install: 'routine', attach: 'major' });
  assert.deepEqual(levelPatch(back.saved, 'install', 'major').saved, { attach: 'major' }, 'only differences saved');
  setLevels(back.saved);
  assert.equal(parseDirectives('ASK: attach | post x.png').asks.length, 1, 'moved to major: now asks');
  assert.equal(parseDirectives('ASK: install | apt install jq').asks.length, 0, 'moved to routine: never asks');
  setLevels({});
  // The main process saves the same categories (electron/ops/approval.cjs).
  const main = require('../electron/ops/approval.cjs');
  assert.deepEqual(Object.keys(main.MOVABLE).sort(), MOVABLE.slice().sort());
  for (const k of MOVABLE) assert.equal(main.MOVABLE[k], DEFAULT_LEVELS[k], k);
  assert.deepEqual(main.OWNER_ONLY, OWNER_ONLY);
  const src = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  assert.match(src, /approvalLevels: cleanSavedLevels\(s\.approvalLevels\),/, 'read back from settings.json');
  assert.match(src, /if \('approvalLevels' in patch\) s\.approvalLevels = cleanSavedLevels\(patch\.approvalLevels\);/, 'only saved when the owner changes it');
});

test('approval: the lead may answer major requests but never owner-only, boot or main/tags pushes', () => {
  const on = { lead: 'anthropic', enabled: true, tasks: [] };
  const ask = (kind, what = 'do it') => leadDecision({ kind: 'allow', id: 'R1' }, { ...on, request: { id: 'R1', agent: 'openai', kind, what, status: 'pending' } });
  for (const k of ['install', 'outside', 'network', 'delete', 'command']) assert.equal(ask(k).ok, true, k);
  assert.equal(ask('push', 'push hearth/k7q2ma to origin').ok, true);
  for (const k of ['merge', 'release', 'version', 'tag', 'settings', 'boot', 'secrets', 'other']) assert.equal(ask(k).ok, false, k);
  assert.equal(ask('push', 'git push origin main --tags').ok, false);
  assert.equal(ask('command', 'git push --force origin hearth/x').ok, false);
  assert.equal(leadMayApprove({ kind: 'push', what: 'git push origin master' }).ok, false);
});

test('approval: every AI is told the policy (chat and task briefs)', () => {
  const p = buildPrompt('openai', [], {});
  assert.match(p, /APPROVAL LEVELS/);
  assert.match(p, /ROUTINE, just do it, never ask[^\n]*Post images, video or files/);
  assert.match(p, /OWNER-ONLY[^\n]*Merge to main; Releases; Version numbers; Tags; Changing app settings/);
  const brief = buildTaskBrief({ task: { id: 'T1', title: 't', runs: [], notes: [] }, agent: 'openai' });
  assert.match(brief, /APPROVAL LEVELS/);
  assert.match(policyText(), /MAJOR, ask first[^\n]*Install software/);
  assert.ok(Object.keys(CATEGORIES).length >= 20);
});

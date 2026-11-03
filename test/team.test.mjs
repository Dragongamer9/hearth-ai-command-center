import test from 'node:test';
import assert from 'node:assert';
import { buildTaskBrief, nextAgent, parseStatus, roleKinds, agentQueue, nextAutoTask, nextForRole, reassignWaiting, queuedAtEnd, queuedAtFront } from '../src/team.mjs';
import { DEFAULT_ROLES } from '../src/registry.mjs';

test('next free agent skips the one that ran out', () => {
  assert.equal(nextAgent(['anthropic', 'openai'], ['anthropic']), 'openai');
  assert.equal(nextAgent(['anthropic'], ['anthropic']), null);
});
test('status line', () => {
  assert.equal(parseStatus('ok\nSTATUS: DONE'), 'done');
  assert.equal(parseStatus('STATUS: continue — tests'), 'continue');
  assert.equal(parseStatus('no status'), null);
});
test('handoff brief carries everyone\'s progress', () => {
  const task = { id: 'ABC123', title: 'T', description: 'D', action: 'code', notes: [{ who: 'Owner', text: 'use sage green' }],
    runs: [{ agent: 'openai', status: 'limit', output: 'built half the page', checkpoint: 'abc1234' }] };
  const b = buildTaskBrief({ task, agent: 'anthropic', summary: 'Commits on this task branch:\nabc1234 ChatGPT: checkpoint', handoffFrom: 'openai', reason: 'ran out of usage' });
  assert.match(b, /HANDOFF: ChatGPT was working on this/);
  assert.match(b, /built half the page/);
  assert.match(b, /abc1234/);
  assert.match(b, /use sage green/);
  assert.match(b, /owner chooses every number/);
  assert.match(b, /Dragongamer9/);
  assert.match(b, /Debian/);
  assert.match(b, /Steam Game Mode/);
  assert.doesNotMatch(b, /0\.6\.55/);
});

import { taskRunState, recoverInterrupted } from '../src/team.mjs';
test('task run states', () => {
  const t = (status) => ({ stage: 'implementing', runs: [{ status }] });
  assert.equal(taskRunState(t('limit')), 'limit');
  assert.equal(taskRunState(t('outage')), 'outage');
  assert.equal(taskRunState(t('auth')), 'auth');
  assert.equal(taskRunState(t('interrupted')), 'resume');
  assert.equal(taskRunState(t('done')), null);
  assert.equal(taskRunState(t('done'), { running: true }), 'running');
  assert.equal(taskRunState(t('done'), { saving: true }), 'saving');
});
test('restart recovery marks in-flight runs interrupted and keeps everything else', () => {
  const state = { tasks: [
    { id: 'A', runs: [{ status: 'done', output: 'kept' }, { status: 'running', brief: 'the brief' }] },
    { id: 'B', runs: [{ status: 'done' }] },
  ] };
  const affected = recoverInterrupted(state);
  assert.deepStrictEqual(affected.map((t) => t.id), ['A']);
  assert.equal(state.tasks[0].runs[1].status, 'interrupted');
  assert.equal(state.tasks[0].runs[1].brief, 'the brief');
  assert.equal(state.tasks[0].runs[0].output, 'kept');
  assert.match(state.tasks[0].runs[1].output, /cannot be recovered/);
  assert.equal(taskRunState(state.tasks[0]), 'resume');
  assert.equal(recoverInterrupted(state).length, 0);
});

test('handoff order follows the lead, then other file-editing AIs; never the local model', () => {
  assert.equal(nextAgent(['openai', 'google', 'ollama'], ['openai'], 'anthropic'), 'google');
  assert.equal(nextAgent(['anthropic', 'google'], [], 'google'), 'google');
  assert.equal(nextAgent(['ollama'], []), null);
});

const task = (o) => ({ action: 'code', stage: 'intake', policy: { ok: true }, reviewer: 'none', notes: [], runs: [], ...o });

test('default roles map onto coding, research, review and lead', () => {
  assert.ok(roleKinds(DEFAULT_ROLES.openai).includes('code'));
  assert.ok(!roleKinds(DEFAULT_ROLES.openai).includes('research'));
  assert.ok(roleKinds(DEFAULT_ROLES.google).includes('research'));
  assert.ok(!roleKinds(DEFAULT_ROLES.google).includes('code'));
  assert.ok(roleKinds(DEFAULT_ROLES.anthropic).includes('lead'));
  assert.ok(roleKinds(DEFAULT_ROLES.anthropic).includes('review'));
  assert.ok(!roleKinds(DEFAULT_ROLES.anthropic).includes('code'));
  assert.ok(roleKinds(DEFAULT_ROLES.xai).includes('code'));
});

test('an AI\'s queue is oldest first and skips closed, blocked, high-impact and non-editing work', () => {
  const tasks = [
    task({ id: 'B', assignee: 'openai', stage: 'implementing', createdAt: '2026-02-02' }),
    task({ id: 'A', assignee: 'openai', createdAt: '2026-02-01' }),
    task({ id: 'C', assignee: 'openai', stage: 'approved', createdAt: '2026-01-01' }),
    task({ id: 'D', assignee: 'openai', policy: { ok: false }, createdAt: '2026-01-01' }),
    task({ id: 'E', assignee: 'openai', action: 'merge', createdAt: '2026-01-01' }),
    task({ id: 'F', assignee: 'anthropic', createdAt: '2026-01-01' }),
    task({ id: 'G', assignee: 'openai', stage: 'approval', createdAt: '2026-01-01' }),
    task({ id: 'H', assignee: 'perplexity', action: 'docs', createdAt: '2026-01-01' }),
    task({ id: 'I', assignee: 'openai', stage: 'checkpoint', createdAt: '2026-01-01' }),
  ];
  assert.deepStrictEqual(agentQueue(tasks, 'openai').map((t) => t.id), ['A', 'B']);
});

test('queuedAt places a moved task after work the recipient already has, or in front', () => {
  const tasks = [
    task({ id: 'OLD', assignee: 'openai', createdAt: '2026-02-01T00:00:00.000Z' }),
  ];
  const end = queuedAtEnd(tasks, 'openai', '2026-03-01T00:00:00.000Z');
  const front = queuedAtFront(tasks, 'openai', '2026-03-01T00:00:00.000Z');
  assert.ok(end > '2026-02-01T00:00:00.000Z');
  assert.ok(front < '2026-02-01T00:00:00.000Z');
  const moved = task({ id: 'NEW', assignee: 'openai', createdAt: '2026-01-01T00:00:00.000Z', queuedAt: end });
  assert.deepStrictEqual(agentQueue([...tasks, moved], 'openai').map((t) => t.id), ['OLD', 'NEW']);
});

test('the next task starts on its own only when the one in front has not been started', () => {
  const fresh = task({ id: 'A', assignee: 'openai', createdAt: '2026-02-01' });
  const behind = task({ id: 'B', assignee: 'openai', createdAt: '2026-02-02' });
  assert.equal(nextAutoTask([fresh, behind], 'openai').id, 'A');
  fresh.runs = [{ status: 'continue' }];
  assert.equal(nextAutoTask([fresh, behind], 'openai'), null);
  behind.resumeNext = true;
  assert.equal(nextAutoTask([fresh, behind], 'openai').id, 'B');
});

test('a role match is chosen ahead of the lead, and the lead is the fallback', () => {
  const roles = DEFAULT_ROLES;
  assert.equal(nextForRole(['anthropic', 'openai', 'google'], { need: 'code', roles }), 'openai');
  assert.equal(nextForRole(['anthropic', 'google'], { need: 'research', roles }), 'google');
  assert.equal(nextForRole(['anthropic', 'google'], { need: 'code', roles }), 'anthropic');
  assert.equal(nextForRole(['ollama'], { need: 'code', roles }), null);
  assert.equal(nextForRole(['openai'], { need: 'code', roles, exclude: ['openai'] }), null);
});

test('when an AI runs out, waiting tasks go to free AIs with the matching role', () => {
  const tasks = [
    task({ id: 'NOW', assignee: 'xai', stage: 'implementing', createdAt: '2026-01-01', reviewer: 'google' }),
    task({ id: 'NEXT', assignee: 'xai', createdAt: '2026-01-02', reviewer: 'google' }),
    task({ id: 'DOCS', assignee: 'xai', action: 'docs', createdAt: '2026-01-03', reviewer: 'openai' }),
    task({ id: 'MERGE', assignee: 'xai', action: 'release', createdAt: '2026-01-04', reviewer: 'google' }),
  ];
  const moves = reassignWaiting({
    tasks, agent: 'xai', currentId: 'NOW',
    available: ['anthropic', 'openai', 'google'],
    roles: DEFAULT_ROLES,
  });
  assert.deepStrictEqual(moves, [
    { id: 'NEXT', from: 'xai', to: 'openai', need: 'code' },
    { id: 'DOCS', from: 'xai', to: 'google', need: 'research' },
  ]);
});

test('several waiting tasks spread across the free AIs that share that role', () => {
  const tasks = [
    task({ id: 'A', assignee: 'mistral', createdAt: '2026-01-01', reviewer: 'google' }),
    task({ id: 'B', assignee: 'mistral', createdAt: '2026-01-02', reviewer: 'google' }),
    task({ id: 'C', assignee: 'mistral', createdAt: '2026-01-03', reviewer: 'google' }),
  ];
  const moves = reassignWaiting({
    tasks, agent: 'mistral',
    available: ['anthropic', 'openai', 'xai', 'google'],
    roles: DEFAULT_ROLES,
  });
  assert.deepStrictEqual(moves.map((m) => [m.id, m.to]), [['A', 'openai'], ['B', 'xai'], ['C', 'openai']]);
});

test('a waiting task is not given to its reviewer, and stays put when nobody else is free', () => {
  const onlyReviewer = [task({ id: 'A', assignee: 'xai', createdAt: '2026-01-01', reviewer: 'openai' })];
  const moved = reassignWaiting({
    tasks: onlyReviewer, agent: 'xai',
    available: ['openai', 'xai'],
    roles: DEFAULT_ROLES,
  });
  assert.deepStrictEqual(moved, []);
  const fallback = reassignWaiting({
    tasks: onlyReviewer, agent: 'xai',
    available: ['anthropic', 'openai'],
    roles: DEFAULT_ROLES,
  });
  assert.deepStrictEqual(fallback.map((m) => m.to), ['anthropic']);
});

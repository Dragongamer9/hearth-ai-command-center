import test from 'node:test';
import assert from 'node:assert';
import { buildTaskBrief, nextAgent, parseStatus } from '../src/team.mjs';

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

import { roleKinds, taskNeed, inQueue, queueOf, nextQueued, placeNext, placeLast, startLabel, redistribute } from '../src/team.mjs';
import { DEFAULT_ROLES } from '../src/registry.mjs';
const OK = { ok: true, block: [], warn: [] };
const T = (id, o = {}) => ({ id, title: id, assignee: 'anthropic', reviewer: 'google', stage: 'intake', action: 'code', policy: OK, runs: [], createdAt: `2026-11-01T0${id.slice(-1)}:00:00.000Z`, ...o });

test('queue: one AI, oldest first, only open policy-clear tasks', () => {
  const tasks = [T('Q3'), T('Q1'), T('Q2', { stage: 'review' }), T('Q4', { policy: { ok: false } }), T('Q5', { assignee: 'openai' }), T('Q6', { action: 'release' })];
  assert.deepEqual(queueOf(tasks, 'anthropic').map((t) => t.id), ['Q1', 'Q3']);
  assert.equal(inQueue(T('X', { assignee: 'ollama' })), false, 'the local model does not work tasks');
  assert.equal(taskNeed(T('X', { action: 'docs' })), 'research');
  assert.equal(taskNeed(T('X', { action: 'merge' })), null);
});

test('Start next while busy: stays clickable and several run oldest-first', () => {
  assert.equal(startLabel(T('A'), true, 'Claude'), 'Start next');
  assert.equal(startLabel(T('A'), false, 'Claude'), 'Start with Claude');
  assert.equal(startLabel(T('A', { runs: [{ status: 'continue' }] }), false, 'Claude'), 'Continue with Claude');
  const tasks = [T('B1', { stage: 'implementing', runs: [{ status: 'running' }] }), T('B2')];
  for (const [i, id] of ['N1', 'N2', 'N3'].entries()) {
    const t = T(id, { createdAt: `2026-11-02T0${i}:00:00.000Z` });
    t.queuedAt = placeNext(tasks, 'anthropic', `2026-11-02T1${i}:00:00.000Z`);
    t.startNext = true;
    tasks.push(t);
  }
  const order = queueOf(tasks, 'anthropic').map((t) => t.id);
  assert.ok(order.indexOf('N1') < order.indexOf('N2') && order.indexOf('N2') < order.indexOf('N3'), order.join(','));
  assert.ok(order.indexOf('N3') < order.indexOf('B2'), 'Start-next tasks go ahead of the rest');
  assert.equal(nextQueued(tasks, 'anthropic').id, 'N1');
  tasks.find((t) => t.id === 'N1').startNext = false;
  tasks.find((t) => t.id === 'N1').stage = 'checkpoint';
  assert.equal(nextQueued(tasks, 'anthropic').id, 'N2');
  assert.ok(placeLast(tasks, 'anthropic', '2026-01-01T00:00:00.000Z') > '2026-11-02');
});

test('out of usage: waiting tasks go to free AIs with the same kind of role, never the reviewer', () => {
  assert.deepEqual(roleKinds(DEFAULT_ROLES.openai), ['code']);
  assert.ok(roleKinds(DEFAULT_ROLES.google).includes('research'));
  const tasks = [T('C1', { stage: 'implementing', runs: [{ status: 'limit' }] }), T('C2'), T('C3'), T('C4', { action: 'docs' }), T('C5', { reviewer: 'openai' })];
  const moves = redistribute({ tasks, agent: 'anthropic', currentId: 'C1', available: ['openai', 'google', 'xai'], roles: DEFAULT_ROLES });
  const to = Object.fromEntries(moves.map((m) => [m.id, m.to]));
  assert.equal(to.C1, undefined, 'the task it was inside stays for the caller');
  assert.ok(['openai', 'xai'].includes(to.C2) && ['openai', 'xai'].includes(to.C3) && to.C2 !== to.C3, 'coders share the work');
  assert.equal(to.C4, 'google', 'docs go to research');
  assert.equal(to.C5, 'xai', 'never to its reviewer');
  assert.deepEqual(redistribute({ tasks, agent: 'anthropic', available: ['google'], roles: DEFAULT_ROLES }).map((m) => m.id), ['C4'], 'no coder free: coding tasks wait');
});

test("Add doesn't start a task: only tasks someone pressed Start on run by themselves", () => {
  const tasks = [T('D1'), T('D2'), T('D3', { stage: 'implementing', runs: [{ status: 'continue' }] })];
  assert.equal(nextQueued(tasks, 'anthropic'), null, 'added tasks and unfinished ones wait for Start');
  tasks[1].startNext = true;
  assert.equal(nextQueued(tasks, 'anthropic').id, 'D2');
});

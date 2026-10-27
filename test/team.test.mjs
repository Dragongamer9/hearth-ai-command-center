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
  assert.match(b, /0\.6\.55/);
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

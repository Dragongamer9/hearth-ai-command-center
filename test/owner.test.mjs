import test from 'node:test';
import assert from 'node:assert';
import { parseVerdicts, applyVerdict, ownerAction } from '../src/owner.mjs';

const mk = (o = {}) => ({ id: 'ABC123', title: 'T', stage: 'review', assignee: 'anthropic', reviewer: 'xai', action: 'code', policy: { ok: true, block: [], warn: [] }, notes: [], runs: [], ...o });

test('parses APPROVE and CHANGES lines, with markdown around them', () => {
  const v = parseVerdicts('Looks good.\n**APPROVE: T-abc123** tests pass\n- `CHANGES: T-XYZ789 add a regression test`\nAPPROVE T-NOPE');
  assert.deepEqual(v, [
    { verdict: 'approve', taskId: 'ABC123', reason: 'tests pass' },
    { verdict: 'changes', taskId: 'XYZ789', reason: 'add a regression test' },
  ]);
  assert.deepEqual(parseVerdicts('CHANGES: T-ABC123 — fix the flag'), [{ verdict: 'changes', taskId: 'ABC123', reason: 'fix the flag' }]);
  assert.deepEqual(parseVerdicts('I would APPROVE: T-ABC123 later'), []);
});

test('only the assigned reviewer can sign off', () => {
  const t = mk();
  assert.equal(applyVerdict(t, { by: 'openai', verdict: 'approve' }).ok, false);
  assert.equal(applyVerdict(t, { by: 'anthropic', verdict: 'approve' }).ok, false);
  assert.equal(t.stage, 'review');
});

test('APPROVE moves a reviewed task to owner approval', () => {
  for (const stage of ['checkpoint', 'testing', 'review']) {
    const t = mk({ stage });
    assert.deepEqual(applyVerdict(t, { by: 'xai', verdict: 'approve', reason: 'ok', at: 'X' }), { ok: true, stage: 'approval' });
    assert.deepEqual(t.reviewVerdict, { by: 'xai', verdict: 'approve', reason: 'ok', at: 'X' });
  }
  assert.equal(applyVerdict(mk({ stage: 'implementing' }), { by: 'xai', verdict: 'approve' }).ok, false);
  assert.equal(applyVerdict(mk({ stage: 'approval' }), { by: 'xai', verdict: 'approve' }).ok, false);
  assert.equal(applyVerdict(mk({ stage: 'approved' }), { by: 'xai', verdict: 'approve' }).ok, false);
  assert.equal(applyVerdict(mk({ policy: { ok: false, block: ['x'], warn: [] } }), { by: 'xai', verdict: 'approve' }).ok, false);
});

test('APPROVE never merges or closes the task by itself', () => {
  const t = mk();
  applyVerdict(t, { by: 'xai', verdict: 'approve' });
  assert.equal(t.stage, 'approval');
  assert.equal(t.decision, undefined);
});

test('CHANGES sends it back to the implementer with the reason', () => {
  for (const stage of ['checkpoint', 'review', 'approval']) {
    const t = mk({ stage });
    assert.deepEqual(applyVerdict(t, { by: 'xai', verdict: 'changes', reason: 'add a test' }), { ok: true, stage: 'implementing' });
    assert.match(t.notes.at(-1).text, /CHANGES REQUESTED: add a test/);
  }
  assert.equal(applyVerdict(mk(), { by: 'xai', verdict: 'changes', reason: '' }).ok, false);
  assert.equal(applyVerdict(mk({ stage: 'intake' }), { by: 'xai', verdict: 'changes', reason: 'x' }).ok, false);
  assert.equal(applyVerdict(mk({ stage: 'rejected' }), { by: 'xai', verdict: 'changes', reason: 'x' }).ok, false);
});

test('owner action: approval, with the reason and a merge label', () => {
  const t = mk({ stage: 'approval', ws: { branch: 'b' }, reviewVerdict: { by: 'xai', verdict: 'approve', reason: 'all tests pass' } });
  const a = ownerAction(t);
  assert.equal(a.kind, 'approve');
  assert.equal(a.label, 'Approve to merge');
  assert.match(a.reason, /Grok approved the review: all tests pass/);
  assert.equal(ownerAction(mk({ stage: 'approval', action: 'release' })).label, 'Approve release');
});

test('owner action: a pending permission request comes first', () => {
  const t = mk({ stage: 'approval' });
  const a = ownerAction(t, { permissions: [{ id: 'R1', context: 'ABC123', status: 'pending', agent: 'anthropic', kind: 'delete', what: 'remove old.js' }] });
  assert.equal(a.kind, 'permission');
  assert.equal(a.label, 'Answer permission request');
  assert.match(a.reason, /Claude asks: Delete files — remove old\.js/);
  assert.equal(ownerAction(t, { permissions: [{ id: 'R1', context: 'ABC123', status: 'approved', agent: 'anthropic', kind: 'delete', what: 'x' }] }).kind, 'approve');
});

test('owner action: resume after a stop, sign-in, usage limit', () => {
  const stopped = mk({ stage: 'implementing', runs: [{ agent: 'anthropic', status: 'interrupted' }] });
  const a = ownerAction(stopped, { canRun: () => true, free: ['anthropic'] });
  assert.equal(a.kind, 'resume');
  assert.equal(a.label, 'Approve to resume');
  assert.equal(a.agent, 'anthropic');
  assert.equal(ownerAction(stopped, { running: true }), null);

  const auth = mk({ stage: 'implementing', runs: [{ agent: 'anthropic', status: 'auth' }] });
  assert.equal(ownerAction(auth).kind, 'signin');

  const limit = mk({ stage: 'implementing', runs: [{ agent: 'anthropic', status: 'limit' }] });
  assert.equal(ownerAction(limit, { free: ['openai'] }).agent, 'openai');
  assert.equal(ownerAction(limit, { free: ['anthropic'] }), null, 'nobody else free: nothing to press');
});

test('owner action: unstarted task, and nothing for working or closed tasks', () => {
  assert.equal(ownerAction(mk({ stage: 'intake' })).label, 'Approve to start');
  assert.equal(ownerAction(mk({ stage: 'intake', assignee: 'none' })), null);
  assert.equal(ownerAction(mk({ stage: 'implementing', runs: [{ agent: 'anthropic', status: 'continue' }] }), { canRun: () => true }).kind, 'resume');
  assert.equal(ownerAction(mk({ stage: 'review', runs: [{ agent: 'anthropic', status: 'done' }] })), null);
  assert.equal(ownerAction(mk({ stage: 'approved' })), null);
  assert.equal(ownerAction(mk({ stage: 'intake', policy: { ok: false, block: ['Only the owner picks version numbers.'], warn: [] } })).kind, 'policy');
});

import { chatRules, teamContext } from '../src/chat.mjs';
test('the AIs are told how to sign off and who reviews each task', () => {
  assert.match(chatRules('xai', 'anthropic'), /APPROVE: T-<task id>/);
  assert.match(chatRules('xai', 'anthropic'), /CHANGES: T-<task id>/);
  assert.match(teamContext({ board: [{ id: 'ABC123', title: 'T', stage: 'Independent review', assignee: 'anthropic', reviewer: 'xai' }] }), /T-ABC123 .*reviewer Grok/);
});

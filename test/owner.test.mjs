import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVerdicts, applyVerdict, ownerAction, requestChanges, reviewBaseline, checkDoneAfterReview, claimsDone, testResult, approvalStale, clearStaleApproval } from '../src/owner.mjs';
import { waitingForLead } from '../src/ops/leadwake.mjs';
import { taskRunState } from '../src/team.mjs';

const mk = (o = {}) => ({ id: 'ABC123', title: 'T', stage: 'review', assignee: 'anthropic', reviewer: 'xai', action: 'code', policy: { ok: true, block: [], warn: [] }, notes: [], runs: [], ...o });

test('reviewer lines are read even with list or bold markup', () => {
  assert.deepEqual(parseVerdicts('ok\n**APPROVE: T-abc123** tests pass\n- `CHANGES: T-XYZ789 — add a test`\nAPPROVE T-NOPE\nI might APPROVE: T-ABC123 later'), [
    { verdict: 'approve', taskId: 'ABC123', reason: 'tests pass' },
    { verdict: 'changes', taskId: 'XYZ789', reason: 'add a test' },
  ]);
});

test('only the assigned reviewer moves a task; APPROVE goes to Owner approval, never merges', () => {
  assert.equal(applyVerdict(mk(), { by: 'openai', verdict: 'approve' }).ok, false);
  assert.equal(applyVerdict(mk(), { by: 'anthropic', verdict: 'approve' }).ok, false, 'not the implementer either');
  for (const stage of ['checkpoint', 'testing', 'review']) {
    const t = mk({ stage });
    assert.deepEqual(applyVerdict(t, { by: 'xai', verdict: 'approve', reason: 'ok', at: 'X', sha: 'abc1234' }), { ok: true, stage: 'approval' });
    assert.deepEqual(t.reviewVerdict, { by: 'xai', verdict: 'approve', reason: 'ok', at: 'X', sha: 'abc1234' });
    assert.equal(t.decision, undefined);
  }
  assert.equal(applyVerdict(mk({ stage: 'implementing' }), { by: 'xai', verdict: 'approve' }).ok, false);
  assert.equal(applyVerdict(mk({ stage: 'approved' }), { by: 'xai', verdict: 'approve' }).ok, false);
  assert.equal(applyVerdict(mk({ policy: { ok: false, block: ['x'] } }), { by: 'xai', verdict: 'approve' }).ok, false);
});

test('CHANGES sends it back to the implementer with the reason', () => {
  const t = mk();
  assert.deepEqual(applyVerdict(t, { by: 'xai', verdict: 'changes', reason: 'add a test', at: 'X' }), { ok: true, stage: 'implementing' });
  assert.match(t.notes.at(-1).text, /CHANGES REQUESTED: add a test/);
  assert.equal(t.changesSince.by, 'xai');
  assert.equal(applyVerdict(mk(), { by: 'xai', verdict: 'changes', reason: '' }).ok, false);
});

test('request-changes → fix → approve clears the old flag and leaves owner approval, not stopped (continue)', () => {
  const t = mk({ runs: [{ agent: 'anthropic', status: 'continue' }], ws: { branch: 'hearth/abc123' } });
  applyVerdict(t, { by: 'xai', verdict: 'changes', reason: 'derive locations from the store', at: 'T1' });
  reviewBaseline(t, 'aaa1111');
  assert.equal(t.stage, 'implementing');
  const stuckBtn = ownerAction(t, { canRun: () => true });
  assert.equal(stuckBtn.kind, 'resume', 'stuck as Ready to Resume while the old flag is set');
  assert.match(stuckBtn.reason, /stopped \(continue\)/);
  const stuck = waitingForLead({ tasks: [t], lead: 'google', editors: ['anthropic'] });
  assert.equal(stuck.tasks[0].stage, 'stopped (continue)');
  assert.match(stuck.tasks[0].verdict, /changes requested: derive locations from the store/);
  assert.equal(applyVerdict(t, { by: 'xai', verdict: 'approve', reason: 'fixed', at: 'T2', sha: 'aaa1111' }).ok, false, 'same commit as the review is not a fix');
  assert.match(applyVerdict(t, { by: 'xai', verdict: 'approve', reason: 'fixed', at: 'T2', sha: null }).reason, /can't be approved until its branch head can be read/);
  assert.equal(t.stage, 'implementing');
  assert.equal(t.changesSince.sha, 'aaa1111');
  const r = applyVerdict(t, { by: 'xai', verdict: 'approve', reason: 'fixed at dde8f12', at: 'T3', sha: 'bbb2222' });
  assert.deepEqual(r, { ok: true, stage: 'approval' });
  assert.equal(t.changesSince, undefined);
  assert.deepEqual(t.reviewVerdict, { by: 'xai', verdict: 'approve', reason: 'fixed at dde8f12', at: 'T3', sha: 'bbb2222' });
  const a = ownerAction(t);
  assert.equal(a.kind, 'approve');
  assert.equal(a.label, 'Approve to merge');
  assert.match(a.reason, /Grok approved bbb2222: fixed at dde8f12/);
  assert.doesNotMatch(a.reason, /stopped \(continue\)/);
  assert.equal(taskRunState(t), null, 'the board no longer reads Ready to Resume');
  const moved = waitingForLead({ tasks: [t], lead: 'google', editors: ['anthropic'] });
  assert.equal(moved.tasks[0].stage, 'approval');
  assert.match(moved.tasks[0].verdict, /approved by xai at bbb2222/);
  assert.doesNotMatch(moved.tasks[0].verdict, /changes requested/);
});

test('owner buttons: Approve to merge, Approve to resume, Approve to start', () => {
  const a = ownerAction(mk({ stage: 'approval', ws: { branch: 'b' }, reviewVerdict: { by: 'xai', verdict: 'approve', reason: 'tests pass', sha: 'abc1234' } }));
  assert.equal(a.label, 'Approve to merge');
  assert.match(a.reason, /Grok approved abc1234: tests pass/);
  assert.equal(ownerAction(mk({ stage: 'approval', action: 'release' })).label, 'Approve release');
  const stopped = mk({ stage: 'implementing', runs: [{ agent: 'anthropic', status: 'interrupted' }] });
  assert.equal(ownerAction(stopped, { canRun: () => true }).label, 'Approve to resume');
  assert.equal(ownerAction(stopped, { running: true }), null);
  assert.equal(ownerAction(mk({ stage: 'implementing', runs: [{ agent: 'anthropic', status: 'limit' }] }), { free: ['openai'] }).agent, 'openai');
  assert.equal(ownerAction(mk({ stage: 'implementing', runs: [{ agent: 'anthropic', status: 'limit' }] }), { free: [] }), null);
  assert.equal(ownerAction(mk({ stage: 'implementing', runs: [{ agent: 'anthropic', status: 'auth' }] })).kind, 'signin');
  assert.equal(ownerAction(mk({ stage: 'intake' })).label, 'Approve to start');
  assert.equal(ownerAction(mk({ stage: 'approval' }), { permissions: [{ id: 'R1', context: 'ABC123', status: 'pending', agent: 'anthropic', kind: 'delete', what: 'old.js' }] }).kind, 'permission');
  assert.equal(ownerAction(mk({ stage: 'approved' })), null);
});

test('a "done" after a review needs a new commit; failing tests are refused', () => {
  const t = mk();
  applyVerdict(t, { by: 'xai', verdict: 'changes', reason: 'add a regression test', at: 'T1' });
  reviewBaseline(t, 'abc1234');
  reviewBaseline(t, 'zzz9999');
  assert.equal(t.changesSince.sha, 'abc1234', 'the first run after the review sets the baseline');
  const r = checkDoneAfterReview(t, { head: 'abc1234', status: 'done', text: 'STATUS: DONE' });
  assert.equal(r.ok, false);
  assert.match(r.note, /no new commit since Grok's review asked for changes/);
  assert.equal(checkDoneAfterReview(t, { head: 'abc1234', status: 'ok', text: 'No further changes are needed.' }).ok, false);
  assert.equal(checkDoneAfterReview(t, { head: 'abc1234', status: 'continue', text: 'working' }).ok, true);
  assert.equal(checkDoneAfterReview(t, { head: 'def5678', status: 'done' }).ok, true);
  assert.equal(t.changesSince, undefined);
  const f = checkDoneAfterReview(mk({ stage: 'implementing' }), { head: 'aaa', status: 'done', text: '# pass 3\n# fail 1\nSTATUS: DONE' });
  assert.match(f.note, /at aaa.*test output shows failures/);
  const o = mk();
  requestChanges(o, { by: 'owner', reason: 'fix the label' });
  reviewBaseline(o, 'bbb');
  assert.match(checkDoneAfterReview(o, { head: 'bbb', status: 'done' }).note, /since the Owner asked/);
  assert.equal(claimsDone('ok', 'nothing more to fix'), true);
});

test('test results come from the run output', () => {
  assert.equal(testResult('TESTS: PASSED'), 'passed');
  assert.equal(testResult('TESTS: NOT RUN'), 'not run');
  assert.equal(testResult('# pass 125\n# fail 0'), 'passed');
  assert.equal(testResult('  3 passing\n  1 failing'), 'failed');
  assert.equal(testResult('Updated the docs.'), 'not run');
});

test('an approval covers its commit; a branch change sends the task back to review', () => {
  const t = mk();
  applyVerdict(t, { by: 'xai', verdict: 'approve', sha: 'abc1234' });
  assert.equal(approvalStale(t, 'abc1234'), false);
  assert.equal(clearStaleApproval(t, 'fff9999', 'Y'), true);
  assert.equal(t.stage, 'review');
  assert.equal(t.reviewVerdict, undefined);
  assert.match(t.notes.at(-1).text, /changed after Grok approved abc1234 \(now fff9999\)/);
});

import { doneLine } from '../src/owner.mjs';
test('a done report says "implemented and tested at commit X", separate from pushing', () => {
  assert.equal(doneLine({ head: 'c0ffee1', tests: 'passed' }), 'Reported done: implemented and tested at c0ffee1 (tests passed). Not pushed by this report; pushing is done by the lead.');
  assert.match(doneLine({ head: 'c0ffee1', tests: 'not run' }), /implemented at c0ffee1 \(tests not run\)/);
});

test('a done task whose reviewer is not available waits in review with "Pick reviewer"', () => {
  const a = ownerAction(mk({ stage: 'review', reviewWaiting: true }));
  assert.equal(a.kind, 'pickreviewer');
  assert.equal(a.label, 'Pick reviewer');
  assert.match(a.reason, /Waiting for Grok \(sent when they are free\)/);
  assert.match(ownerAction(mk({ stage: 'review', reviewWaiting: true, reviewer: 'none' })).reason, /Waiting for/);
  assert.equal(ownerAction(mk({ stage: 'review' })), null, 'a review in progress needs nothing from the owner');
});

test('a task queued with Start next reads "Queued for <AI>", not "Approve to start"', () => {
  const a = ownerAction(mk({ stage: 'intake', startNext: true }));
  assert.equal(a.kind, 'queued');
  assert.equal(a.passive, true);
  assert.equal(a.label, 'Queued for Claude');
  assert.equal(ownerAction(mk({ stage: 'intake' })).label, 'Approve to start');
});

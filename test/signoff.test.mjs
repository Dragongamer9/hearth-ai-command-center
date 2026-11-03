// Reviewer sign-off from chat: APPROVE / CHANGES lines move a task, only for its named reviewer.
import test from 'node:test';
import assert from 'node:assert';
import { parseSignoffs, parseDirectives, applySignoff, teamContext, chatRules } from '../src/chat.mjs';

const mk = (over = {}) => ({ id: 'PK22UQ', title: 'Installer tests', assignee: 'openai', reviewer: 'xai', stage: 'checkpoint', notes: [], policy: { ok: true, block: [], warn: [] }, ...over });

test('parses APPROVE and CHANGES lines, tolerating markdown, skipping placeholders', () => {
  const s = parseSignoffs([
    'Looked at the diff.',
    '**APPROVE: T-pk22uq all 12 tests pass**',
    '- `CHANGES: T-KN8XEW — Re-check must not mark a bad key available`',
    'Format reminder: write `APPROVE: T-XXXXXX` when ready.',
    'APPROVE: T-XXXXXX',
    'CHANGES: T-PK22UQ second verdict ignored',
  ].join('\n'));
  assert.deepStrictEqual(s, [
    { verdict: 'approve', id: 'PK22UQ', reason: 'all 12 tests pass' },
    { verdict: 'changes', id: 'KN8XEW', reason: 'Re-check must not mark a bad key available' },
  ]);
  const d = parseDirectives('APPROVE: T-PK22UQ');
  assert.equal(d.signoffs.length, 1);
  assert.equal(d.text, 'APPROVE: T-PK22UQ', 'the sign-off stays visible in chat');
  assert.equal(d.pass, false);
});

test('the named reviewer approves: task moves to Owner approval with the review attached', () => {
  const tasks = [mk()];
  const r = applySignoff(tasks, { agent: 'xai', verdict: 'approve', id: 'PK22UQ', reason: 'tests pass', review: 'Full review text.\nAPPROVE: T-PK22UQ tests pass', at: 'T' });
  assert.equal(r.ok, true);
  assert.equal(r.from, 'checkpoint');
  assert.equal(tasks[0].stage, 'approval');
  assert.equal(tasks[0].review.by, 'xai');
  assert.equal(tasks[0].review.verdict, 'approve');
  assert.match(tasks[0].notes[0].who, /Grok \(review\)/);
  assert.match(tasks[0].notes[0].text, /Full review text/);
  // Approving twice is refused; nothing is merged or decided by the reviewer.
  assert.equal(applySignoff(tasks, { agent: 'xai', verdict: 'approve', id: 'PK22UQ' }).ok, false);
  assert.equal(tasks[0].decision, undefined);
});

test('CHANGES sends it back to the implementer and needs a reason', () => {
  const tasks = [mk({ stage: 'approval' })];
  assert.equal(applySignoff(tasks, { agent: 'xai', verdict: 'changes', id: 'PK22UQ', reason: '' }).ok, false);
  const r = applySignoff(tasks, { agent: 'xai', verdict: 'changes', id: 'PK22UQ', reason: 'add a test for Re-check' });
  assert.equal(r.ok, true);
  assert.equal(tasks[0].stage, 'implementing');
  assert.equal(tasks[0].assignee, 'openai');
  assert.match(tasks[0].notes[0].text, /CHANGES REQUESTED.*add a test for Re-check/);
});

test('only the reviewer named on the task can sign off, and only finished open work', () => {
  const tasks = [mk()];
  const no = (o) => { const r = applySignoff(tasks, { verdict: 'approve', id: 'PK22UQ', ...o }); assert.equal(r.ok, false); return r.reason; };
  assert.match(no({ agent: 'anthropic' }), /only the reviewer/);
  assert.match(no({ agent: 'openai' }), /only the reviewer/);
  assert.match(no({ agent: 'xai', id: 'NOPE00' }), /no task/);
  assert.match(no({ agent: 'xai', running: true }), /still being worked on/);
  tasks[0].stage = 'implementing';
  assert.match(no({ agent: 'xai' }), /isn't finished/);
  tasks[0].stage = 'approved';
  assert.match(no({ agent: 'xai' }), /already decided/);
  tasks[0].stage = 'review';
  tasks[0].reviewer = 'none';
  assert.match(no({ agent: 'xai' }), /only the reviewer/);
  tasks[0].reviewer = 'openai'; // same as implementer
  assert.match(no({ agent: 'openai' }), /implementer/);
  tasks[0].reviewer = 'xai';
  tasks[0].policy = { ok: false, block: ['x'], warn: [] };
  assert.match(no({ agent: 'xai' }), /policy/);
  assert.equal(tasks[0].stage, 'review');
  assert.equal(tasks[0].notes.length, 0);
});

test('AIs are told who reviews each task and how to sign off', () => {
  const ctx = teamContext({ board: [{ id: 'PK22UQ', title: 'x', stage: 'Checkpoint saved', assignee: 'openai', reviewer: 'xai' }] });
  assert.match(ctx, /T-PK22UQ .*implementer ChatGPT, reviewer Grok/);
  assert.match(chatRules('xai', 'anthropic'), /APPROVE: T-<id>/);
  assert.match(chatRules('xai', 'anthropic'), /CHANGES: T-<id>/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicate, similarity } from '../src/dupes.mjs';

const open = [
  { id: 'V3B7TA', title: 'Gemini via Antigravity CLI: detect agy, sign-in check, headless runs', stage: 'implementing' },
  { id: 'IZVYHF', title: 'Agents page: a field to paste API keys for Mistral', stage: 'review' },
  { id: 'OLD123', title: 'Team status panel above the chat', stage: 'approved' },
];

test('a task that repeats an open one is flagged', () => {
  const d = findDuplicate({ title: 'Gemini via the Antigravity CLI (agy): detect it, sign-in check and headless runs' }, open);
  assert.equal(d.task.id, 'V3B7TA');
  assert.ok(d.score >= 0.6);
  assert.equal(findDuplicate({ title: 'agents page: a field to paste API keys for Mistral' }, open).task.id, 'IZVYHF');
});
test('different work and closed tasks are not flagged', () => {
  assert.equal(findDuplicate({ title: 'Dark mode for the Settings page' }, open), null);
  assert.equal(findDuplicate({ title: 'Team status panel above the chat' }, open), null, 'closed tasks do not count');
  assert.equal(findDuplicate({ id: 'V3B7TA', title: open[0].title }, open), null, 'a task is not its own duplicate');
  assert.ok(similarity({ title: 'x' }, { title: '' }) === 0);
});

import test from 'node:test';
import assert from 'node:assert';
import { recipients, buildPrompt, parseProposals } from '../src/chat.mjs';

const both = ['anthropic', 'openai'];
test('everyone by default, mentions narrow it, offline agents skipped', () => {
  assert.deepStrictEqual(recipients('hi team', both), both);
  assert.deepStrictEqual(recipients('@claude thoughts?', both), ['anthropic']);
  assert.deepStrictEqual(recipients('@ChatGPT and @claude', both), ['openai', 'anthropic']);
  assert.deepStrictEqual(recipients('hi', ['openai']), ['openai']);
  assert.deepStrictEqual(recipients('@freebuff hi', both), []);
  assert.deepStrictEqual(recipients('hi', both, 'openai'), ['openai']);
});

test('prompt includes other agents replies and is bounded', () => {
  const msgs = [
    { who: 'owner', text: 'plan the settings page' },
    { who: 'anthropic', text: 'I suggest three tasks' },
    { who: 'system', text: 'internal note' },
  ];
  const p = buildPrompt('openai', msgs);
  assert.match(p, /You are ChatGPT/);
  assert.match(p, /Claude: I suggest three tasks/);
  assert.doesNotMatch(p, /internal note/);
  const big = Array.from({ length: 500 }, (_, i) => ({ who: 'owner', text: `msg ${i} ${'x'.repeat(100)}` }));
  assert.ok(buildPrompt('anthropic', big).length < 20000);
});

test('parses task proposals, tolerating markdown', () => {
  const out = parseProposals(`Here's a split:
- **TASK: Build settings layout | implementer: claude | reviewer: chatgpt | action: code**
TASK: Write docs | implementer: ChatGPT | reviewer: chatgpt | action: docs
TASK: Ship it | implementer: freebuff | reviewer: claude | action: launch
not a task line`);
  assert.equal(out.length, 3);
  assert.deepStrictEqual(out[0], { title: 'Build settings layout', assignee: 'anthropic', reviewer: 'openai', action: 'code' });
  assert.equal(out[1].reviewer, 'anthropic'); // self-review auto-corrected
  assert.equal(out[2].action, 'code'); // unknown action falls back
});

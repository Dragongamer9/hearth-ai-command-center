// The owner's GPU server is told adult content is allowed only while Uncensored mode is on;
// the hard limits always come with it, and no other AI is told this.
import test from 'node:test';
import assert from 'node:assert/strict';
import { brief, HARD_LIMITS, ADULT_OK } from '../src/app/brief.mjs';

test('GPU server with Uncensored mode on: told adult content is allowed, hard limits kept', () => {
  const b = brief({ agent: 'gpu', apiOnly: true, uncensored: true });
  assert.ok(b.includes(ADULT_OK));
  assert.ok(b.includes(HARD_LIMITS));
  assert.ok(b.indexOf(HARD_LIMITS) < b.indexOf(ADULT_OK));
  assert.match(ADULT_OK, /between adults/);
});

test('Uncensored mode off: the GPU server is not told it', () => {
  assert.ok(!brief({ agent: 'gpu', apiOnly: true, uncensored: false }).includes(ADULT_OK));
  assert.ok(!brief({ agent: 'gpu', apiOnly: true }).includes(ADULT_OK));
});

test('no other AI is told it, Uncensored mode or not', () => {
  for (const agent of ['anthropic', 'openai', 'google', 'ollama', 'venice', 'civitai', 'hearth']) {
    assert.ok(!brief({ agent, apiOnly: true, uncensored: true }).includes(ADULT_OK), agent);
  }
});

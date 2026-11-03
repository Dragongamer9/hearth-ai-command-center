import test from 'node:test';
import assert from 'node:assert/strict';
import { teamPresence } from '../src/presence.mjs';

test('availability labels distinguish ready, busy, sign-in and manual agents', () => {
  for (const text of ['linked', 'linked (API key)', 'running']) assert.equal(teamPresence({ text }).text, 'Ready');
  assert.equal(teamPresence({ text: 'signed out' }).text, 'Needs sign-in');
  assert.equal(teamPresence({ text: 'installed · hands-on' }).text, 'Hands-on only');
  assert.equal(teamPresence({ text: 'installed · sign-in not checkable' }).text, 'Sign-in unknown');
  assert.deepEqual(teamPresence({ text: 'working on T-ABC', cls: 'accent', live: true }), { text: 'Busy', detail: 'working on T-ABC', cls: 'accent', live: true });
});
test('usage pause includes retry date and provider hint without promising a reset', () => {
  const result = teamPresence({ text: 'linked' }, { outUntil: '2026-11-02T18:30:00Z', reason: 'resets in 3 hours' });
  assert.equal(result.text, 'Out of usage');
  assert.match(result.detail, /Retry after .+ \(estimated\) · resets in 3 hours/);
});
test('setup and disabled states remain visible', () => {
  for (const text of ['turned off', 'not installed', 'needs API key', 'API key rejected', 'no models yet', 'waiting for your answer']) assert.equal(teamPresence({ text }).text, text);
});

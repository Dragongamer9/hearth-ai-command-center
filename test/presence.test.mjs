import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { panelState, holdStatus, keyTestLine } from '../src/presence.mjs';
import { authProblem, makeHold, holdLifted } from '../src/chat.mjs';

test('panel states: ready, busy, out of usage, sign-in', () => {
  for (const text of ['linked', 'linked (API key)', 'running']) assert.equal(panelState({ text }).text, 'Ready');
  assert.equal(panelState({ text: 'signed out' }).text, 'Needs sign-in');
  assert.deepEqual(panelState({ text: 'working on T-1', live: true }), { text: 'Busy', cls: 'accent', live: true, detail: 'working on T-1' });
  const out = panelState({ text: 'linked' }, { outUntil: '2026-11-02T18:30:00Z', reason: 'resets in 3h' });
  assert.equal(out.text, 'Out of usage');
  assert.match(out.detail, /until about .+ \(estimate\) · resets in 3h/);
});

test('a rejected key stays "API key rejected" after a refresh', () => {
  const hold = makeHold(authProblem({ kind: 'auth', message: 'invalid' }, { method: 'api' }), { hasKey: true });
  assert.equal(holdLifted(hold, { method: 'api', hasKey: true }), false, 'refresh with the same key keeps it');
  assert.equal(panelState(holdStatus(hold, true)).text, 'API key rejected');
  assert.equal(panelState(holdStatus(makeHold({ badge: 'needs sign-in' }, {}), false)).text, 'Needs sign-in');
  assert.equal(holdStatus(null, true), null);
});

test('key Test: the result line, and Test never redraws the page', () => {
  assert.equal(keyTestLine(null), '');
  assert.match(keyTestLine({ busy: true }), /Testing/);
  assert.match(keyTestLine({ result: { ok: true } }), /Connection successful/);
  assert.match(keyTestLine({ result: { ok: false, error: { message: 'The provider rejected this key or denied access.' } } }), /note err.*rejected/);
});

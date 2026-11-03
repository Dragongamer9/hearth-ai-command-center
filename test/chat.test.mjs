import test from 'node:test';
import assert from 'node:assert';
import { recipients, buildPrompt, parseProposals, chatTurnFailure, rememberAuthHold, authHoldCleared, QUIET_STATUS_BADGES } from '../src/chat.mjs';

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

import { teamContext } from '../src/chat.mjs';
test('lead answers first; new mentions work', () => {
  const live = ['openai', 'google', 'anthropic', 'ollama'];
  assert.deepStrictEqual(recipients('plan this', live, 'all', 'anthropic'), ['anthropic', 'openai', 'google', 'ollama']);
  assert.deepStrictEqual(recipients('plan this', live, 'all', 'google')[0], 'google');
  assert.deepStrictEqual(recipients('@gemini and @local check', live), ['google', 'ollama']);
});
test('agents are told what the Command Center can do, the team and the board', () => {
  const ctx = { lead: 'anthropic', project: '/home/chris/hearth', roster: [{ id: 'anthropic', status: 'available' }, { id: 'ollama', status: 'available' }], board: [{ id: 'ABC123', title: 'Fix boot menu', stage: 'Implementing', assignee: 'openai' }] };
  const p = buildPrompt('anthropic', [{ who: 'owner', text: 'hi' }], ctx);
  assert.match(p, /Electron, Linux AppImage/);
  assert.match(p, /\/home\/chris\/hearth/);
  assert.match(p, /Claude \(you\) \[LEAD\]/);
  assert.match(p, /You are the LEAD/);
  assert.match(p, /T-ABC123 "Fix boot menu"/);
  assert.match(p, /Never claim something was pushed/);
  assert.doesNotMatch(buildPrompt('openai', [], ctx), /You are the LEAD/);
  assert.match(teamContext({}), /not chosen yet/);
});
test('proposals for Gemini and local AI', () => {
  const out = parseProposals('TASK: Research boot loaders | implementer: gemini | reviewer: local | action: docs\nTASK: Review it | implementer: local | reviewer: claude');
  assert.deepStrictEqual(out[0], { title: 'Research boot loaders', assignee: 'google', reviewer: 'ollama', action: 'docs' });
  assert.equal(out[1].assignee, 'none'); // the local model can't implement
});

test('sign-in and missing-key failures are one badge, not a chat post every round', () => {
  const signIn = { kind: 'auth', message: 'Not signed in. Use “Sign in” on the Agents page.' };
  const first = chatTurnFailure(signIn, null, { method: 'cli' });
  assert.equal(first.post, false);
  assert.equal(first.first, true);
  assert.equal(first.hold.badge, 'needs sign-in');
  assert.ok(QUIET_STATUS_BADGES.includes(first.hold.badge));

  const remembered = rememberAuthHold(null, first.hold, { signedIn: true, hasKey: false, at: 't1' });
  const again = chatTurnFailure(signIn, remembered, { method: 'cli' });
  assert.equal(again.post, false);
  assert.equal(again.first, false);
  const kept = rememberAuthHold(remembered, again.hold, { signedIn: true, at: 't2' });
  assert.equal(kept.at, 't1');
  assert.equal(kept.sawSignedIn, true);
  // The status check already said signed in when the run failed, so it must not clear the badge.
  assert.equal(authHoldCleared(kept, { method: 'cli', signedIn: true }), false);
  // Signing out is a real change: the badge can go, and a later sign-in can try again.
  assert.equal(authHoldCleared(kept, { method: 'cli', signedIn: false }), true);

  const missing = chatTurnFailure({ kind: 'no_key', message: 'No API key saved for this provider.' }, null, { method: 'api' });
  assert.equal(missing.post, false);
  assert.equal(missing.hold.badge, 'needs API key');
  const badKey = chatTurnFailure({ kind: 'auth', message: 'Incorrect API key provided.' }, null, { method: 'api' });
  assert.equal(badKey.hold.badge, 'needs API key');
  const heldKey = rememberAuthHold(null, badKey.hold, { hasKey: true, at: 'k1' });
  assert.equal(authHoldCleared(heldKey, { method: 'api', hasKey: true }), false);
  assert.equal(authHoldCleared(heldKey, { method: 'api', hasKey: false }), true);

  const outage = chatTurnFailure({ kind: 'outage', message: 'The provider is unreachable or having problems.' }, null);
  assert.equal(outage.post, true);
  assert.equal(outage.hold, null);
  const refused = chatTurnFailure({ kind: 'failed', message: 'Your current account is not eligible for Antigravity' }, null);
  assert.equal(refused.post, false);
  assert.equal(refused.hold.badge, 'needs sign-in');
  assert.equal(chatTurnFailure({ kind: 'failed', message: 'tests failed: 2' }, null).post, true);
});

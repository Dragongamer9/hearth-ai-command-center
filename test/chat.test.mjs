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

import { buildDelta, chatRules, authProblem, makeHold, holdLifted, HOLD_BADGES, LOCAL_RULES } from '../src/chat.mjs';

test('the local model is told it has no tools, even when chat editing is on', () => {
  for (const chatEdits of [false, true]) {
    const p = buildPrompt('ollama', [], { chatEdits, project: '/repo' });
    assert.match(p, /You are the local model\. You only see the text in this prompt and have NO tools/);
    assert.doesNotMatch(p, /you can do everything you normally can/);
  }
  assert.match(buildPrompt('openai', [], { chatEdits: true }), /you can do everything you normally can/);
});

test('the local model must not echo teammates or claim work it cannot do (full and continuing prompts)', () => {
  const msgs = [{ id: 'A1', who: 'anthropic', text: 'I cloned the repo.' }];
  for (const p of [buildPrompt('ollama', msgs), buildDelta('ollama', msgs)]) {
    assert.match(p, /Never repeat, reword or continue what a teammate already said/);
    assert.match(p, /reply PASS/);
    assert.match(p, /Never say you did, checked, cloned, ran, tested, pushed or started anything/);
    assert.match(p, /say it is their report/);
  }
  assert.doesNotMatch(buildPrompt('openai', msgs), /Speak only for yourself, the local model/);
  assert.equal(LOCAL_RULES.length, 3);
});

test('sign-in and key failures become a quiet hold, everything else still posts', () => {
  assert.deepEqual(authProblem({ kind: 'auth', message: 'Not signed in.' }), { badge: 'needs sign-in', message: 'Not signed in.' });
  assert.equal(authProblem({ kind: 'auth', message: 'invalid' }, { method: 'api' }).badge, 'API key rejected');
  assert.equal(authProblem({ kind: 'no_key', message: 'x' }).badge, 'needs API key');
  assert.equal(authProblem({ kind: 'failed', message: 'Your account is not eligible' }).badge, 'needs sign-in');
  assert.equal(authProblem({ kind: 'limit', message: 'quota' }), null);
  assert.equal(authProblem({ kind: 'outage', message: '503' }), null);
  for (const b of ['needs sign-in', 'needs API key', 'API key rejected']) assert.ok(HOLD_BADGES.includes(b));
});

test('the hold is recorded once and only lifts when sign-in or the key changes', () => {
  const p = authProblem({ kind: 'auth', message: 'Not signed in.' });
  const h = makeHold(p, { signedIn: true, at: 'T1' });
  assert.equal(makeHold(p, { signedIn: false, at: 'T2' }, h), h, 'the same failure again keeps the first hold (no second badge)');
  assert.equal(holdLifted(h, { method: 'cli', signedIn: true }), false, 'a status check that already said "signed in" proves nothing');
  assert.equal(holdLifted(makeHold(p, { signedIn: false }), { method: 'cli', signedIn: true }), true, 'signing in lifts it');
  const k = makeHold(authProblem({ kind: 'auth', message: 'bad' }, { method: 'api' }), { hasKey: true });
  assert.equal(holdLifted(k, { method: 'api', hasKey: true }), false, 'same saved key: stays rejected after refresh');
  assert.equal(holdLifted(k, { method: 'api', hasKey: false }), true);
});

test('reviewers are told how to sign off and who reviews each task', () => {
  assert.match(chatRules('xai', 'anthropic'), /APPROVE: T-<task id>/);
  assert.match(chatRules('xai', 'anthropic'), /CHANGES: T-<task id>/);
  assert.match(buildPrompt('xai', [], { board: [{ id: 'ABC123', title: 'T', stage: 'Review', assignee: 'anthropic', reviewer: 'xai', queue: 'next up' }] }), /T-ABC123 .*reviewer Grok.*next up/);
});

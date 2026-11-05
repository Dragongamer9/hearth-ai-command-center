import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chatPlan, canOwnerSend, newRound, ownerInterrupt, stopRound, cameAfterOwner, asksEveryone, beginPass } from '../src/room.mjs';

const live = ['anthropic', 'openai', 'google'];

test('sequential by default: the lead answers first, alone', () => {
  assert.deepEqual(chatPlan('How should we split the Storage page?', live), { parallel: false, queue: ['anthropic'] });
  assert.deepEqual(chatPlan('hi', ['openai', 'google']), { parallel: false, queue: ['openai'] }, 'lead offline: first live AI');
  assert.deepEqual(chatPlan('@gemini what do you think?', live), { parallel: false, queue: ['google'] });
  assert.deepEqual(chatPlan('thoughts?', live, 'openai'), { parallel: false, queue: ['openai'] });
});

test('parallel when the owner asks two or more AIs at once, or everyone', () => {
  assert.deepEqual(chatPlan('@claude @gemini compare your plans', live), { parallel: true, queue: ['anthropic', 'google'] });
  const all = chatPlan('@everyone status please', live);
  assert.equal(all.parallel, true);
  assert.deepEqual(all.queue, ['anthropic', 'openai', 'google']);
  assert.equal(chatPlan('Everyone: one line each on what you are doing', live).parallel, false, 'the plain word is not @everyone');
  assert.equal(asksEveryone('@all quick check'), true);
  assert.equal(asksEveryone('fix the overall layout'), false);
  assert.deepEqual(chatPlan('@claude @mistral go', live), { parallel: false, queue: ['anthropic'] }, 'only live AIs count');
});

test("the owner's input is never blocked by AI activity", () => {
  assert.equal(canOwnerSend('next idea'), true);
  assert.equal(canOwnerSend('   '), false);
});

test('an owner message mid-round cancels AIs not yet started and restarts with his message', () => {
  const r = newRound();
  r.started = ['anthropic'];
  r.waiting = ['openai', 'google'];
  const job = { queue: ['anthropic'], opts: { trigger: 'new direction' } };
  const out = ownerInterrupt(r, job);
  assert.deepEqual(out.cancelled, ['openai', 'google']);
  assert.equal(r.stop, true);
  assert.deepEqual(r.next, [{ ...job, fromOwner: true }], 'the round restarts with the newest owner message');
  assert.equal(ownerInterrupt(null, job).restart, false);
});

test('Stop ends the round without restarting', () => {
  const r = newRound();
  r.waiting = ['openai'];
  r.next = [{ queue: ['google'] }];
  assert.deepEqual(stopRound(r).cancelled, ['openai']);
  assert.equal(r.stop, true);
  assert.equal(r.stoppedByOwner, true);
  assert.deepEqual(r.next, []);
});

test('a reply that started before the owner wrote again is marked', () => {
  const chat = [{ who: 'owner', at: '2026-11-02T10:00:00.000Z' }, { who: 'anthropic', at: '2026-11-02T10:00:05.000Z' }];
  assert.equal(cameAfterOwner(chat, '2026-11-02T10:00:01.000Z'), false);
  chat.push({ who: 'owner', at: '2026-11-02T10:00:09.000Z' });
  assert.equal(cameAfterOwner(chat, '2026-11-02T10:00:01.000Z'), true);
  assert.equal(cameAfterOwner([{ who: 'owner', auto: true, at: '2026-11-02T11:00:00.000Z' }], '2026-11-02T10:00:00.000Z'), false);
});

test('"thanks everyone" is an ordinary message: lead first, one at a time', () => {
  assert.deepEqual(chatPlan('thanks everyone', live), { parallel: false, queue: ['anthropic'] });
  assert.equal(asksEveryone('thanks everyone'), false);
  assert.equal(asksEveryone('@everyone thanks'), true);
});

test('an owner message keeps queued follow-up rounds, and a new pass clears Stop', () => {
  const r = newRound();
  const followUp = { queue: ['openai'], opts: { trigger: 'permission answer' } };
  r.next = [followUp, { queue: ['anthropic'], opts: { trigger: 'older owner msg' }, fromOwner: true }];
  ownerInterrupt(r, { queue: ['anthropic'], opts: { trigger: 'newest' } });
  assert.deepEqual(r.next.map((j) => j.opts.trigger), ['newest', 'permission answer'], 'newest owner message first, follow-ups kept, older owner message replaced');
  stopRound(r);
  assert.equal(r.stoppedByOwner, true);
  beginPass(r);
  assert.equal(r.stoppedByOwner, false);
  assert.equal(r.stop, false);
  assert.deepEqual(r.started, []);
});

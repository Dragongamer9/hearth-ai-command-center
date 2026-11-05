// Several chats working at once in the window (src/app/team-run.mjs), with a fake app bridge:
// each chat gets only its own output, switching chats mid-run never moves a result, the limit
// is a waiting line, and stopping one chat leaves the others running.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeamRunner, createRoundQueue } from '../src/app/team-run.mjs';

function harness({ limit = 3, delay = 30 } = {}) {
  const saved = {}; // what each chat's FILE would hold (chatsSave id → messages)
  const calls = [];
  const cancelled = new Set();
  const waits = new Map();
  const S = { open: null, settings: { maxChats: limit, tools: { quickChecks: [] } } };
  const entries = { c0000000001: { id: 'c0000000001', title: 'One' }, c0000000002: { id: 'c0000000002', title: 'Two' }, c0000000003: { id: 'c0000000003', title: 'Three' } };
  const call = async (fn, ...a) => {
    calls.push([fn, ...a]);
    if (fn === 'chatRun') {
      const o = a[0];
      await new Promise((r) => { const t = setTimeout(r, o.prompt.includes('SLOW') ? delay * 6 : delay); waits.set(o.chatId, () => { clearTimeout(t); r(); }); });
      if (cancelled.has(o.chatId)) return { ok: false, error: { kind: 'cancelled' } };
      return { ok: true, text: `answer for ${o.chatId}`, via: 'fake' };
    }
    if (fn === 'chatCancel') { cancelled.add(a[0]); waits.get(a[0])?.(); return true; }
    return null;
  };
  const runner = createTeamRunner({
    call, settings: () => S.settings, openId: () => S.open, entry: (id) => entries[id] || null,
    team: () => ({ lead: 'anthropic', reviewer: null, members: ['anthropic'] }), live: () => ['anthropic'], method: () => 'cli',
    modeFor: () => 'team', webFor: () => false, buildFor: () => false,
    render: () => {}, save: async (R) => { saved[R.id] = R.msgs.filter((m) => !m.local).map((m) => ({ ...m })); },
  });
  return { runner, saved, calls, S, cancelled };
}
const owner = (R, text) => R.msgs.push({ id: `o${R.msgs.length}`, who: 'owner', text });

test('two chats run at the same time and each gets only its own output, in its own file', async () => {
  const h = harness();
  const A = h.runner.rt('c0000000001'); const B = h.runner.rt('c0000000002');
  owner(A, 'SLOW question one'); owner(B, 'question two');
  const pa = h.runner.start(A, 'SLOW question one');
  const pb = h.runner.start(B, 'question two');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(A.round && B.round, true, 'both working at once');
  await Promise.all([pa, pb]);
  assert.deepEqual(A.msgs.map((m) => m.text), ['SLOW question one', 'answer for c0000000001']);
  assert.deepEqual(B.msgs.map((m) => m.text), ['question two', 'answer for c0000000002']);
  assert.deepEqual(h.saved.c0000000001.map((m) => m.text), ['SLOW question one', 'answer for c0000000001']);
  assert.deepEqual(h.saved.c0000000002.map((m) => m.text), ['question two', 'answer for c0000000002']);
  const runs = h.calls.filter(([f]) => f === 'chatRun').map(([, o]) => o.chatId).sort();
  assert.deepEqual(runs, ['c0000000001', 'c0000000002']);
});

test('switching chats mid-run: the result lands in the chat it was started for (and is marked unseen)', async () => {
  const h = harness();
  const A = h.runner.rt('c0000000001');
  h.S.open = 'c0000000001';
  owner(A, 'SLOW work');
  const p = h.runner.start(A, 'SLOW work');
  await new Promise((r) => setTimeout(r, 5));
  h.S.open = 'c0000000002'; // the owner opens another chat while A works
  const B = h.runner.rt('c0000000002');
  await p;
  assert.equal(A.msgs.at(-1).text, 'answer for c0000000001');
  assert.equal(B.msgs.length, 0, 'nothing in the chat that was open');
  assert.equal(h.saved.c0000000002, undefined, 'and nothing written to its file');
  assert.equal(h.saved.c0000000001.at(-1).text, 'answer for c0000000001');
  assert.equal(A.unseen, true, 'a dot in the sidebar');
});

test('the limit on chats at once: over it, a chat waits in line, says so, and starts when one finishes', async () => {
  const h = harness({ limit: 1 });
  const A = h.runner.rt('c0000000001'); const B = h.runner.rt('c0000000002');
  owner(A, 'SLOW one'); owner(B, 'two');
  const pa = h.runner.start(A, 'SLOW one');
  const wb = await h.runner.start(B, 'two');
  assert.equal(wb, 'waiting');
  assert.equal(B.waiting, true);
  assert.equal(h.runner.queue.position('c0000000002'), 1);
  assert.equal(h.calls.filter(([f, o]) => f === 'chatRun' && o.chatId === 'c0000000002').length, 0, 'not started yet');
  await pa;
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(B.waiting, false);
  assert.equal(B.msgs.at(-1).text, 'answer for c0000000002', 'it started by itself');
  const q = createRoundQueue({ limit: () => 2 });
  assert.deepEqual(['a', 'b', 'c'].map((x) => q.want(x)), ['start', 'start', 'wait']);
  assert.deepEqual(q.done('a'), ['c']);
});

test('stopping one chat leaves the other running', async () => {
  const h = harness();
  const A = h.runner.rt('c0000000001'); const B = h.runner.rt('c0000000002');
  owner(A, 'SLOW a'); owner(B, 'SLOW b');
  const pa = h.runner.start(A, 'SLOW a');
  const pb = h.runner.start(B, 'SLOW b');
  await new Promise((r) => setTimeout(r, 10));
  await h.runner.stop(A);
  await Promise.all([pa, pb]);
  assert.deepEqual(h.calls.filter(([f]) => f === 'chatCancel').map(([, id]) => id), ['c0000000001'], 'only that chat is cancelled');
  assert.equal(A.msgs.at(-1).text, 'Stopped.');
  assert.equal(B.msgs.at(-1).text, 'answer for c0000000002');
});

test('a message sent while its chat works is queued for that chat only', async () => {
  const h = harness();
  const A = h.runner.rt('c0000000001');
  owner(A, 'SLOW first');
  const p = h.runner.start(A, 'SLOW first');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(await h.runner.start(A, 'second'), 'queued');
  await p;
  assert.equal(h.calls.filter(([f, o]) => f === 'chatRun' && o.chatId === 'c0000000001').length, 2, 'answered right after');
});

test('steps stream only into the chat they belong to', () => {
  const h = harness();
  const A = h.runner.rt('c0000000001'); const B = h.runner.rt('c0000000002');
  A.busy = { runId: 'r1', steps: [] }; B.busy = { runId: 'r2', steps: [] };
  assert.equal(h.runner.onStep({ chatId: 'c0000000002', runId: 'r1', step: { kind: 'read' } }), false, 'wrong chat: ignored');
  h.runner.onStep({ chatId: 'c0000000001', runId: 'r1', step: { kind: 'read' } });
  assert.equal(A.busy.steps.length, 1); assert.equal(B.busy.steps.length, 0);
});

// 2.10: the lead plans and hands parts out; everyone it names works at the same time (each in its own lane), reports
// to the lead as soon as it's done and gets an answer (or more work) at once; then the lanes are merged and the lead
// checks everything. Off (Settings › AI team) is the old one-after-another order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeamRunner } from '../src/app/team-run.mjs';
import { brief } from '../src/app/brief.mjs';

const ALL = ['anthropic', 'openai', 'google', 'perplexity'];
const TEAM = { lead: 'anthropic', reviewer: null, members: ALL };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function harness({ parallel = true, leadReply = 'Good.', repo = true, delays = {} } = {}) {
  const runs = [];
  const merges = [];
  let live = 0;
  let maxLive = 0;
  const S = { settings: { maxChats: 3, tools: { quickChecks: [] }, teamParallel: parallel } };
  const runner = createTeamRunner({
    call: async (fn, ...a) => {
      if (fn === 'chatLanesMerge') { merges.push(a[1]); return { ok: true, merged: [{ agent: 'openai', files: ['a.js'], commits: 1 }], empty: [], conflicts: [{ agent: 'google', files: ['b.js'], branch: 'hearth/t-1--google' }] }; }
      if (fn !== 'chatRun') return null;
      const o = a[0];
      runs.push({ agent: o.agent, lane: o.lane === true, helper: o.helper === true, prompt: o.prompt });
      live++; maxLive = Math.max(maxLive, live);
      await sleep(delays[o.agent] ?? 5);
      live--;
      if (o.helper) return { ok: true, text: typeof leadReply === 'function' ? leadReply(o.prompt) : leadReply, via: 'fake' };
      if (o.agent === 'anthropic') return { ok: true, text: 'Plan.\n@ChatGPT write the parser\n@Gemini write the tests\n@Perplexity find the file format', via: 'fake' };
      return { ok: true, text: `done by ${o.agent}`, via: 'fake', ...(o.agent === 'openai' ? { changes: { files: [{ path: 'a.js' }] } } : {}) };
    },
    settings: () => S.settings, openId: () => null, entry: (id) => ({ id, title: 'T', ...(repo ? { repo: 'Dragongamer9/x' } : {}) }),
    team: () => TEAM, live: () => ALL, method: () => 'cli', modeFor: () => 'team', webFor: () => false, buildFor: () => true,
    statusOf: () => ({ label: 'ok', why: '' }), render: () => {}, save: async () => {},
  });
  return { runner, runs, merges, max: () => maxLive };
}

test('everyone the lead names works at the same time, each in its own lane', async () => {
  const h = harness();
  const R = h.runner.rt('c0000000001');
  R.msgs.push({ id: 'o1', who: 'owner', text: 'port the game' });
  await h.runner.start(R, 'port the game');
  const team = h.runs.filter((r) => r.agent !== 'anthropic');
  assert.deepEqual(team.map((r) => r.agent).sort(), ['google', 'openai', 'perplexity']);
  assert.ok(team.every((r) => r.lane), 'each in its own lane');
  assert.ok(h.max() >= 3, `three at once (was ${h.max()})`);
  assert.match(team.find((r) => r.agent === 'google').prompt, /Your part, from Claude: write the tests/);
  assert.match(team.find((r) => r.agent === 'google').prompt, /AT THE SAME TIME as ChatGPT, Perplexity/);
});

test('each one reports to the lead as soon as it is done, and the lead answers while the others work', async () => {
  const h = harness({ delays: { openai: 5, google: 60, perplexity: 60 } });
  const R = h.runner.rt('c0000000002');
  R.msgs.push({ id: 'o1', who: 'owner', text: 'go' });
  await h.runner.start(R, 'go');
  const order = h.runs.map((r) => (r.helper ? `lead-reply` : r.agent));
  // ChatGPT finishes first: the lead's reply to it comes before Gemini and Perplexity are done.
  const firstReply = order.indexOf('lead-reply');
  assert.ok(firstReply > 0 && firstReply < order.length - 2);
  assert.equal(h.runs.filter((r) => r.helper).length, 3, 'one answer per teammate');
  const replies = R.msgs.filter((m) => m.who === 'anthropic' && m.role === 'lead');
  assert.ok(replies.length >= 5, 'plan, three answers, the final check');
});

test('the lead can give a finished teammate more work; it keeps its lane', async () => {
  let n = 0;
  const h = harness({ leadReply: (p) => (/ChatGPT just finished/.test(p) && n++ === 0 ? 'Nice.\n@ChatGPT now add error messages' : 'Good.') });
  const R = h.runner.rt('c0000000003');
  R.msgs.push({ id: 'o1', who: 'owner', text: 'go' });
  await h.runner.start(R, 'go');
  const gpt = h.runs.filter((r) => r.agent === 'openai' && !r.helper);
  assert.equal(gpt.length, 2, 'its part, then the more the lead gave it');
  assert.ok(gpt.every((r) => r.lane));
  assert.match(gpt[1].prompt, /gave you more: now add error messages/);
});

test('then the lanes are merged and the lead checks everything, told about clashes', async () => {
  const h = harness();
  const R = h.runner.rt('c0000000004');
  R.msgs.push({ id: 'o1', who: 'owner', text: 'go' });
  await h.runner.start(R, 'go');
  assert.deepEqual(h.merges.map((x) => [...x].sort()), [['google', 'openai', 'perplexity']]);
  const last = h.runs[h.runs.length - 1];
  assert.equal(last.agent, 'anthropic');
  assert.equal(last.helper, false, 'the final check is a full turn');
  assert.match(last.prompt, /finished working at the same time/);
  assert.match(last.prompt, /hearth\/t-1--google/);
  const sys = R.msgs.filter((m) => m.who === 'system').map((m) => m.text).join('\n');
  assert.match(sys, /ChatGPT's changes were merged/);
  assert.match(sys, /Gemini's changes clash/);
  assert.deepEqual(R.working, [], 'nobody left on the stack');
});

test('a chat without a repo has no lanes to merge', async () => {
  const h = harness({ repo: false });
  const R = h.runner.rt('c0000000005');
  R.msgs.push({ id: 'o1', who: 'owner', text: 'go' });
  await h.runner.start(R, 'go');
  assert.equal(h.merges.length, 0);
});

test('with "Work at the same time" off, the old order: one after another, no lanes', async () => {
  const h = harness({ parallel: false });
  const R = h.runner.rt('c0000000006');
  R.msgs.push({ id: 'o1', who: 'owner', text: 'go' });
  await h.runner.start(R, 'go');
  assert.deepEqual(h.runs.map((r) => r.agent), ['anthropic', 'openai', 'google', 'perplexity']);
  assert.ok(h.runs.every((r) => !r.lane && !r.helper));
  assert.equal(h.max(), 1);
});

test('the lead is told to plan, split by strength and that everyone works at once', () => {
  const b = brief({ agent: 'anthropic', role: 'lead', chat: { title: 'T' }, team: TEAM, live: ALL, status: {} });
  assert.match(b, /first work out what the task needs, then split it/);
  assert.match(b, /AT THE SAME TIME, each in its own copy of the files/);
  assert.match(b, /web research with sources \(Perplexity\)/);
});

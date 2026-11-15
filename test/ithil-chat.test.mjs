// 3.10.1: Ithil's own chat said "The AI you picked isn't ready" unless she was on the team and awake and free.
// She talks whenever she's connected; when she isn't, the chat says why. A full address in the host box is understood.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createTeamRunner } from '../src/app/team-run.mjs';
const { cleanSettings } = createRequire(import.meta.url)('../electron/ithil.cjs');

const TEAM = { lead: 'anthropic', members: ['anthropic', 'openai'], reviewer: null };
function harness({ online }) {
  const calls = [];
  const runner = createTeamRunner({
    call: async (fn, o) => { if (fn !== 'chatRun') return null; calls.push(o.agent); return { ok: true, text: `answer from ${o.agent}`, via: 'fake' }; },
    settings: () => ({ maxChats: 3, tools: { quickChecks: [] } }), openId: () => null, entry: (id) => ({ id, title: 'T' }),
    team: () => TEAM, live: () => ['anthropic', 'openai'], method: () => 'cli', modeFor: () => 'ithil', webFor: () => false, buildFor: () => false,
    statusOf: () => ({ label: 'off', why: '' }), render: () => {}, save: async () => {},
    readyAlone: (a) => a === 'ithil' && online,
    whyNot: (a) => (a === 'ithil' ? 'Ithil can\'t answer: Hearth AI isn\'t running on the PC.' : ''),
  });
  return { runner, calls };
}

test('her own chat reaches her while connected, though she is not on the team', async () => {
  const h = harness({ online: true });
  const R = h.runner.rt('c0000000001');
  R.msgs.push({ id: 'o1', who: 'owner', text: 'hi Ithil' });
  await h.runner.start(R, 'hi Ithil');
  assert.deepEqual(h.calls, ['ithil']);
  assert.ok(!R.msgs.some((m) => m.who === 'system' && /isn't ready/.test(m.text)));
});

test('when she is offline the chat says why, not "the AI you picked isn\'t ready"', async () => {
  const h = harness({ online: false });
  const R = h.runner.rt('c0000000002');
  R.msgs.push({ id: 'o1', who: 'owner', text: 'hi' });
  await h.runner.start(R, 'hi');
  assert.deepEqual(h.calls, []);
  const sys = R.msgs.filter((m) => m.who === 'system').map((m) => m.text).join('\n');
  assert.match(sys, /Hearth AI isn't running/);
});

test('the host box understands a full address', () => {
  assert.deepEqual(cleanSettings({ host: 'http://100.72.99.97:47860' }), { host: '100.72.99.97', port: 47860 });
  assert.deepEqual(cleanSettings({ host: '100.72.99.97:47861/' }), { host: '100.72.99.97', port: 47861 });
  assert.deepEqual(cleanSettings({ host: 'chris-hearth.tail0e2082.ts.net', port: 47860 }), { host: 'chris-hearth.tail0e2082.ts.net', port: 47860 });
  assert.deepEqual(cleanSettings({ host: '100.72.99.97', port: 47860 }), { host: '100.72.99.97', port: 47860 });
  assert.equal(cleanSettings({ host: 'not a host!' }).host, '');
});

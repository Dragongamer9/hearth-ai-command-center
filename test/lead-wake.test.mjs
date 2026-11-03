// The lead gets a turn when needed, sees what waits for it, and learns from refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeadWaker, waitingForLead, waitingSection, refusalSection } from '../src/ops/leadwake.mjs';
import { pushTargetsOk } from '../src/ops/approval.mjs';
import { leadDecision } from '../src/lead.mjs';
import { buildPrompt, buildDelta } from '../src/chat.mjs';

const ok = { ok: true, block: [], warn: [] };
const on = { lead: 'anthropic', enabled: true, tasks: [] };
const card = (kind, what, agent = 'google') => ({ id: 'R1', agent, kind, what, status: 'pending' });

function waker(state) {
  const timers = [];
  const runs = [];
  const w = createLeadWaker({ delayMs: 4000, schedule: (fn) => { timers.push(fn); return timers.length; }, isOn: () => state.on, lead: () => 'anthropic', canRun: () => state.canRun, run: (why) => runs.push(why) });
  return { w, timers, runs, fire: () => { while (timers.length) timers.shift()(); } };
}

test('a permission card from Gemini triggers exactly one lead turn (debounced, batched)', () => {
  const k = waker({ on: true, canRun: true });
  assert.equal(k.w.nudge('permission card', 'google'), true);
  k.w.nudge('reviewer verdict', 'openai');
  k.w.nudge('permission card', 'google');
  k.fire();
  assert.equal(k.runs.length, 1);
  assert.deepEqual(k.runs[0], ['permission card', 'reviewer verdict']);
  k.w.nudge('task reached approval', 'openai');
  k.fire();
  assert.equal(k.runs.length, 2, 'a later event gets its own turn');
});

test('no lead turn when the switch is off, for the lead\'s own cards, or when the lead cannot run', () => {
  const off = waker({ on: false, canRun: true });
  assert.equal(off.w.nudge('permission card', 'google'), false);
  off.fire();
  assert.equal(off.runs.length, 0);
  const own = waker({ on: true, canRun: true });
  assert.equal(own.w.nudge('permission card', 'anthropic'), false);
  own.fire();
  assert.equal(own.runs.length, 0);
  const out = waker({ on: true, canRun: false });
  out.w.nudge('permission card', 'google');
  out.fire();
  assert.equal(out.runs.length, 0, 'out of usage or on a sign-in hold');
});

test('the delta includes the waiting tasks and cards (with owner-only marks) only with the switch on', () => {
  const tasks = [
    { id: 'APR001', title: 'Status panel', stage: 'approval', assignee: 'openai', reviewer: 'google', action: 'code', reviewVerdict: { verdict: 'approve', by: 'google', sha: 'b'.repeat(40) }, policy: ok },
    { id: 'NEW002', title: 'Drive icons', stage: 'intake', assignee: 'openai', reviewer: 'google', action: 'code', policy: ok, runs: [] },
    { id: 'RUN003', title: 'Busy', stage: 'implementing', assignee: 'openai', policy: ok, runs: [] },
  ];
  const permissions = [card('command', 'run make clean in /tmp/build'), { ...card('merge', 'merge hearth/x into main'), id: 'R2' }];
  const waiting = waitingForLead({ tasks, permissions, lead: 'anthropic', running: { RUN003: {} }, editors: ['anthropic', 'openai'] });
  assert.deepEqual(waiting.tasks.map((t) => t.id), ['APR001', 'NEW002']);
  const ctx = { lead: 'anthropic', leadActions: true, pending: permissions, waiting, refusals: [{ ref: 'R-R9', reason: 'merge requests stay with the Owner' }] };
  const d = buildDelta('anthropic', [], ctx);
  assert.match(d, /WAITING FOR YOU \(LEAD\) OR THE OWNER:/);
  assert.match(d, /T-APR001 "Status panel" — approval, implementer ChatGPT, reviewer Gemini, approved by google at bbbbbbb/);
  assert.match(d, /T-NEW002 "Drive icons" — waiting to start/);
  assert.match(d, /R-R1 by Gemini: command — run make clean in \/tmp\/build \[YOU MAY ANSWER/);
  assert.match(d, /R-R2 by Gemini: merge — merge hearth\/x into main \[OWNER-ONLY/);
  assert.match(d, /Waiting for the Owner or the lead:/);
  assert.match(d, /REFUSED[\s\S]*R-R9: merge requests stay with the Owner/);
  assert.doesNotMatch(buildDelta('openai', [], ctx), /WAITING FOR YOU \(LEAD\)/, 'only the lead');
  const offDelta = buildDelta('anthropic', [], { ...ctx, leadActions: false });
  assert.doesNotMatch(offDelta, /WAITING FOR YOU \(LEAD\)|or the lead|REFUSED/);
  assert.equal(waitingSection({ tasks: [], cards: [] }), '');
  assert.equal(refusalSection([]), '');
});

test('prompt wording changes only when the switch is on', () => {
  const pending = [card('install', 'apt install jq')];
  const offP = buildPrompt('openai', [], { lead: 'anthropic', pending });
  assert.match(offP, /PERMISSION REQUESTS WAITING FOR THE OWNER:/);
  assert.match(offP, /The Owner answers Approve \/ Deny/);
  assert.match(offP, /APPROVE only moves it to Owner approval/);
  assert.doesNotMatch(offP, /or the lead/i);
  const onP = buildPrompt('anthropic', [], { lead: 'anthropic', pending, leadActions: true, waiting: waitingForLead({ permissions: pending, lead: 'anthropic' }) });
  assert.match(onP, /PERMISSION REQUESTS WAITING FOR THE OWNER OR THE LEAD:/);
  assert.match(onP, /The Owner or the lead answers/);
  assert.match(onP, /where the lead \(if allowed\) or the Owner approves/);
  assert.match(onP, /Permission cards you MAY answer/);
  assert.match(onP, /do not defer them to the Owner/);
  assert.match(onP, /R-R1 by Gemini: install — apt install jq \[YOU MAY ANSWER/);
});

test('the lead can approve a command card but not a merge card, nor its own request', () => {
  assert.deepEqual(leadDecision({ kind: 'allow', id: 'R1' }, { ...on, request: card('command', 'run make clean in /tmp/build') }), { ok: true, action: 'allowperm' });
  assert.equal(leadDecision({ kind: 'allow', id: 'R1' }, { ...on, request: card('merge', 'merge hearth/x') }).ok, false);
  assert.equal(leadDecision({ kind: 'allow', id: 'R1' }, { ...on, request: card('command', 'x', 'anthropic') }).ok, false);
  assert.equal(leadDecision({ kind: 'deny', id: 'R1' }, { ...on, request: card('merge', 'merge hearth/x') }).ok, true, 'denying is always fine');
});

test('push is allowed only to hearth/ and release/ branches, never main, tags or force; unclear is refused', () => {
  for (const what of ['push hearth/k7q2ma-storage to origin', 'git push origin release/tasks-20261102', 'git push -u origin hearth/abc origin/release/next']) assert.equal(pushTargetsOk(what).ok, true, what);
  for (const what of ['git push origin main', 'push hearth/x and tags', 'git push --force origin hearth/x', 'git push origin hearth/x:main', 'push feature/x to origin', 'push the branch', 'git push origin HEAD:refs/heads/hearth/x']) assert.equal(pushTargetsOk(what).ok, false, what);
  assert.equal(leadDecision({ kind: 'allow', id: 'R1' }, { ...on, request: card('push', 'push hearth/k7q2ma to origin') }).ok, true);
  assert.equal(leadDecision({ kind: 'allow', id: 'R1' }, { ...on, request: card('push', 'push feature/x') }).ok, false);
});

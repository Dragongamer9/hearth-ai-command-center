// 1.8 fixes in the window's logic: several @names on one line, a failed teammate no longer
// stops the others, each teammate's state with a plain reason and Retry, true team status,
// the briefs (no contradictions, can't-push, missing checks, the one picture method), and
// pictures shown where their link was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionsIn, handoffs, brief, planTurn } from '../src/app/brief.mjs';
import { createTeamRunner, showMedia } from '../src/app/team-run.mjs';
import { plainError, teammateStatus } from '../src/app/errors.mjs';

const ALL = ['anthropic', 'openai', 'google', 'xai', 'mistral'];
const TEAM = { lead: 'anthropic', reviewer: null, members: ALL };

test('several @names on one line: spaces, commas and "and" all reach everyone', () => {
  for (const line of ['@ChatGPT @Gemini @Grok @Mistral please check', '@ChatGPT, @Gemini, @Grok, @Mistral: check', '@ChatGPT @Gemini, @Grok and @Mistral check this', '@chatgpt,@gemini and @grok,@mistral']) {
    assert.deepEqual(mentionsIn(line), ['openai', 'google', 'xai', 'mistral'], line);
    assert.deepEqual(planTurn({ text: line, team: TEAM, live: ALL }), ['openai', 'google', 'xai', 'mistral'], line);
  }
});

test('a lead hand-off line with four names reaches all four (1.7 stopped after two)', () => {
  assert.deepEqual(handoffs('Plan:\n@ChatGPT @Gemini @Grok @Mistral each check one file', { team: TEAM, live: ALL, done: ['anthropic'] }), ['openai', 'google', 'xai', 'mistral']);
  assert.deepEqual(handoffs('- @Grok and @Mistral review', { team: TEAM, live: ALL, done: [] }), ['xai', 'mistral']);
});

function harness(fail = {}) {
  const calls = [];
  const S = { settings: { maxChats: 3, tools: { quickChecks: [] }, autoPush: true } };
  const runner = createTeamRunner({
    call: async (fn, o) => {
      if (fn !== 'chatRun') return null;
      calls.push(o.agent);
      if (fail[o.agent]) { const f = fail[o.agent]; delete fail[o.agent]; return { ok: false, error: f }; }
      // The lead's quick answers to a teammate's report (helper runs) just say thanks here.
      if (o.helper) return { ok: true, text: 'Thanks, good.', via: 'fake' };
      return { ok: true, text: o.agent === 'anthropic' ? 'On it.\n@ChatGPT @Gemini @Grok @Mistral check one file each' : `answer from ${o.agent}`, via: 'fake' };
    },
    settings: () => S.settings, openId: () => null, entry: (id) => ({ id, title: 'T' }),
    team: () => TEAM, live: () => ALL, method: () => 'cli', modeFor: () => 'team', webFor: () => false, buildFor: () => false,
    statusOf: () => ({ label: 'needs a key', why: 'Add your key.' }),
    render: () => {}, save: async () => {},
  });
  return { runner, calls };
}

test('owner names four on one line and Gemini fails: Grok and Mistral still answer; states say who did what', async () => {
  const h = harness({ google: { kind: 'failed', message: 'jetski: internal error' } });
  const R = h.runner.rt('c0000000001');
  R.msgs.push({ id: 'o1', who: 'owner', text: '@ChatGPT @Gemini @Grok @Mistral hi' });
  await h.runner.start(R, '@ChatGPT @Gemini @Grok @Mistral hi');
  assert.deepEqual(h.calls, ['openai', 'google', 'xai', 'mistral']);
  assert.deepEqual(R.turnState.list.map((x) => [x.agent, x.state]), [['openai', 'done'], ['google', 'failed'], ['xai', 'done'], ['mistral', 'done']]);
  const g = R.turnState.list.find((x) => x.agent === 'google');
  assert.match(g.reason, /internal error/);
  assert.doesNotMatch(g.reason, /^jetski/, 'plain words, not the raw error');
  const msg = R.msgs.find((m) => m.who === 'google');
  assert.equal(msg.err, true);
  assert.match(msg.rawError, /jetski/, 'the raw error stays under Details');
  // Retry only Gemini: its row is updated, the others stay.
  await h.runner.retry(R, 'google');
  assert.deepEqual(h.calls.slice(4), ['google']);
  assert.deepEqual(R.turnState.list.map((x) => [x.agent, x.state]), [['openai', 'done'], ['google', 'done'], ['xai', 'done'], ['mistral', 'done']]);
});

test('the lead hands off to four teammates on one line: all four answer after it, one failing blocks nobody', async () => {
  const h = harness({ xai: { kind: 'failed', message: "a tool required the 'command' permission that headless mode cannot prompt for, so it was auto-denied" } });
  const R = h.runner.rt('c0000000002');
  R.msgs.push({ id: 'o1', who: 'owner', text: 'check the repo' });
  await h.runner.start(R, 'check the repo');
  // 2.10: the lead first, then all four at the same time, the lead answering each one that finished (Grok failed),
  // then the lead's check of everything.
  assert.equal(h.calls[0], 'anthropic');
  assert.deepEqual(h.calls.slice(1, 5).sort(), ['google', 'mistral', 'openai', 'xai']);
  assert.deepEqual(h.calls.slice(5), ['anthropic', 'anthropic', 'anthropic', 'anthropic']);
  const x = R.turnState.list.find((y) => y.agent === 'xai');
  assert.equal(x.state, 'blocked');
  assert.match(x.reason, /allow-list/);
});

test('known raw errors in plain words', () => {
  const perm = plainError('google', { message: "a tool required the 'command' permission that headless mode cannot prompt for, so it was auto-denied" });
  assert.equal(perm.state, 'blocked');
  assert.match(perm.reason, /Set up Gemini's allow-list in Settings › Permissions/);
  assert.match(plainError('google', { message: 'jetski session failed' }).reason, /internal error/);
  assert.match(plainError('xai', { kind: 'limit', reset: 'resets in 2h' }).reason, /out of usage \(resets in 2h\)/);
  assert.match(plainError('mistral', { kind: 'not_installed', message: 'vibe is not installed.' }).reason, /isn't installed/);
  assert.match(plainError('google', { message: 'Eligibility check failed: unknown reason' }).reason, /can't use the Antigravity CLI/);
  assert.match(plainError('openai', { message: 'weird thing' }).reason, /stopped with an error: weird thing/);
});

test('true team status: connected, needs a key, CLI missing, not signed in, off', () => {
  assert.equal(teammateStatus('venice', { inTeam: true, kind: 'teammate', ready: false }).label, 'needs a key');
  assert.equal(teammateStatus('gpu', { inTeam: true, kind: 'teammate', ready: false }).label, 'needs a server');
  assert.equal(teammateStatus('mistral', { inTeam: true, kind: 'cli', installed: false }).label, 'CLI missing');
  assert.equal(teammateStatus('xai', { inTeam: true, kind: 'cli', installed: true, signedIn: false }).label, 'not signed in');
  assert.equal(teammateStatus('google', { inTeam: true, kind: 'cli', installed: true, ready: true }).label, 'connected');
  assert.equal(teammateStatus('qwen', { inTeam: false }).label, 'off');
});

test('briefs: the team with its true status, can\'t-push, missing checks to Actions, one picture method, no contradictions', () => {
  const t = { lead: 'anthropic', reviewer: 'openai', members: ['anthropic', 'openai', 'venice', 'civitai', 'gpu'] };
  const b = brief({ agent: 'anthropic', role: 'lead', team: t, live: ['anthropic', 'openai'], build: true, quickChecks: ['node --check', 'shellcheck', 'cargo check'], missing: ['shellcheck', 'cargo check'], actForMe: true, status: { venice: { label: 'needs a key', why: 'Add your Venice key in Settings › Accounts.' }, civitai: { label: 'needs a key', why: '' }, gpu: { label: 'needs a server', why: '' } } });
  assert.match(b, /- Venice \(needs a key: Add your Venice key/);
  assert.match(b, /- Your GPU server \(needs a server\)/);
  assert.match(b, /Only the owner can connect them/);
  assert.match(b, /THIS CHAT CAN'T PUSH/);
  assert.match(b, /NOT INSTALLED on this PC: shellcheck, cargo check/);
  assert.match(b, /Run quick checks only on this PC: node --check\./);
  assert.match(b, /ATTACH: \.hearth-media\/<name>\.png/);
  assert.match(b, /You never merge, release or tag yourself/);
  assert.match(b, /you still never push to main, merge, release or tag yourself\. You may ASK him/);
  assert.doesNotMatch(b, /you may (merge|release|tag)/i);
  const repo = brief({ agent: 'openai', chat: { repo: 'Dragongamer9/x' }, copy: { base: 'main', work: 'hearth/x-1' }, build: true, autoPush: true, canPush: true, missing: ['shellcheck'], quickChecks: ['shellcheck'] });
  assert.doesNotMatch(repo, /CAN'T PUSH/);
  assert.match(repo, /push to the chat's branch so GitHub Actions runs them/);
  assert.match(repo, /the app commits what you left and pushes this chat's branch hearth\/x-1 for you/);
});

test('pictures show where their link was; an ATTACH line that worked is dropped, one that failed stays', () => {
  const media = [{ kind: 'image', from: 'shot.png', alsoFrom: ['.hearth-media/s.png'], url: 'hearth-media://c/c0000000001/ab-shot.png' }];
  const out = showMedia('Look: ![the page](shot.png)\n- ATTACH: .hearth-media/s.png\nATTACH: missing.png\n![x](other.png)', media);
  assert.match(out, /!\[the page\]\(hearth-media:\/\/c\/c0000000001\/ab-shot\.png\)/);
  assert.doesNotMatch(out, /ATTACH: \.hearth-media\/s\.png/);
  assert.match(out, /ATTACH: missing\.png/);
  assert.match(out, /!\[x\]\(other\.png\)/);
});

test('an AI changing the settings file is told to the owner in the chat', async () => {
  const runner = createTeamRunner({
    call: async (fn) => (fn === 'chatRun' ? { ok: true, text: 'done', settingsUndone: { undone: true, keys: ['leadMerge'] } } : null),
    settings: () => ({ tools: {} }), openId: () => null, entry: (id) => ({ id, title: 'T' }),
    team: () => ({ lead: 'xai', reviewer: null, members: ['xai'] }), live: () => ['xai'], method: () => 'cli', modeFor: () => 'team', webFor: () => false, buildFor: () => false, render: () => {}, save: async () => {},
  });
  const R = runner.rt('c0000000003');
  await runner.start(R, 'hi');
  assert.match(R.msgs.find((m) => m.who === 'system').text, /Grok changed your settings file during its turn\. The change was undone/);
});

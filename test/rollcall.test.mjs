// 3.4.1 Test team (check words) and the team bugs found while testing every teammate in one chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWord, CHECK_PROMPT, planCheck, judgeReply, runCheck, summary } from '../src/app/rollcall.mjs';
import { createTeamRunner } from '../src/app/team-run.mjs';
import { brief, turnPrompt, teamStatusLine, teamReports, shieldFor, mentionsIn } from '../src/app/brief.mjs';
import { plainError, teammateStatus } from '../src/app/errors.mjs';

test('check words are unique per AI and the prompt asks for only the word', () => {
  const w = checkWord('ghcopilot', () => 0.5);
  assert.match(w, /^HEARTH-GITHUBCOPILO-[A-Z2-9]{4}$/);
  assert.notEqual(checkWord('kiro'), checkWord('kiro'));
  assert.match(CHECK_PROMPT(w), new RegExp(`exactly this one word and nothing else:\\n${w}$`));
});

test('who is asked, and why the rest are not: not in the team, not signed in, not connected, cloud jobs and pictures skipped', () => {
  const info = {
    anthropic: { inTeam: true, ready: true }, kiro: { inTeam: true, ready: false, status: { state: 'cli', why: 'Install Kiro CLI in Settings › Accounts.' } },
    cursor: { inTeam: true, ready: false, status: { state: 'signin', why: 'Sign in to Cursor in Settings › Accounts.' } }, ai21: { inTeam: true, ready: false, status: { state: 'key', why: 'Add your AI21 Jamba API key in Settings › Accounts.' } },
    warp: { inTeam: false }, devin: { inTeam: true, ready: true, cloud: true }, civitai: { inTeam: true, ready: true, imagesOnly: true }, groq: { inTeam: true, ready: true, bridge: true },
  };
  const rows = planCheck(Object.keys(info), (a) => info[a]);
  const by = Object.fromEntries(rows.map((r) => [r.agent, r]));
  assert.equal(by.anthropic.run, true);
  assert.equal(by.groq.run && by.groq.bridge, true);
  assert.deepEqual([by.kiro.state, by.kiro.fix], ['notconnected', 'install']);
  assert.deepEqual([by.cursor.state, by.cursor.fix], ['signin', 'signin']);
  assert.deepEqual([by.ai21.state, by.ai21.fix], ['notconnected', 'accounts']);
  assert.deepEqual([by.warp.state, by.warp.fix], ['offteam', 'team']);
  assert.equal(by.devin.state, 'skipped');
  assert.equal(by.civitai.state, 'skipped');
});

test('judging: the word (any case, with punctuation) passes; an error keeps its reason and fix; a wrong answer says what came back', () => {
  assert.equal(judgeReply({ ok: true, text: 'hearth-kiro-ab12.' }, 'HEARTH-KIRO-AB12').state, 'passed');
  assert.equal(judgeReply({ ok: true, text: 'Sure! HEARTH-KIRO-AB12' }, 'HEARTH-KIRO-AB12').state, 'passed');
  const f = judgeReply({ ok: false, error: { kind: 'timeout', fix: 'open', message: 'Groq gave no answer on its website within 5 minutes (page loaded · chat box found · message sent).' } }, 'X');
  assert.deepEqual([f.state, f.fix], ['failed', 'open']);
  assert.match(f.reason, /chat box found · message sent/);
  assert.equal(judgeReply({ ok: false, error: { kind: 'auth', message: 'Not signed in.' } }, 'X').state, 'signin');
  assert.match(judgeReply({ ok: true, text: 'I am Qwen' }, 'HEARTH-QWEN-AAAA').reason, /without the check word: “I am Qwen”/);
});

test('running: web-bridge teammates at most two at a time, the others four, and a hung one times out on its own', async () => {
  const ids = ['groq', 'nova', 'openrouter', 'freebuff', 'glm', 'anthropic', 'openai', 'google', 'xai', 'mistral', 'qwen', 'kimi'];
  const bridge = new Set(ids.slice(0, 5));
  const rows = ids.map((a) => ({ agent: a, run: true, bridge: bridge.has(a), state: 'waiting' }));
  const words = Object.fromEntries(ids.map((a) => [a, `W-${a}`]));
  let b = 0; let o = 0; let maxB = 0; let maxO = 0;
  const tick = () => new Promise((r) => setTimeout(r, 2));
  await runCheck(rows, {
    words, timeoutMs: 60000, wait: (ms) => (ms > 1000 ? new Promise((r) => setTimeout(r, 40)) : tick()),
    run: async (row) => {
      if (row.bridge) { b++; maxB = Math.max(maxB, b); } else { o++; maxO = Math.max(maxO, o); }
      if (row.agent === 'kimi') return new Promise(() => {}); // never answers
      await tick(); await tick();
      if (row.bridge) b--; else o--;
      return { ok: true, text: words[row.agent] };
    },
  });
  assert.ok(maxB <= 2, `bridge at once: ${maxB}`);
  assert.ok(maxO <= 4, `others at once: ${maxO}`);
  assert.equal(rows.filter((r) => r.state === 'passed').length, 11);
  assert.match(rows.find((r) => r.agent === 'kimi').reason, /No answer within/);
  assert.match(summary(rows), /^11 passed · 1 failed$/);
});

// ---- bug 1: named teammates that can't answer are named, with what they need ----
function harness({ team, live, statusOf, reply }) {
  const runs = [];
  const runner = createTeamRunner({
    uid: (() => { let n = 0; return () => `m${(++n).toString(36)}`; })(),
    call: async (fn, ...a) => { if (fn !== 'chatRun') return null; const o = a[0]; runs.push(o); return { via: 'fake', sessionId: `S-${o.agent}`, ...(reply ? reply(o) : { ok: true, text: `hi from ${o.agent}` }) }; },
    settings: () => ({ maxChats: 3, tools: { quickChecks: [] }, teamParallel: true }), openId: () => null, entry: (id) => ({ id, title: 'T' }),
    team: () => team, live: () => live, method: () => 'cli', modeFor: () => 'team', webFor: () => false, buildFor: () => false,
    statusOf, setupHint: (a) => `set up ${a}`, render: () => {}, save: async () => {},
  });
  return { runner, runs };
}
const STATUS = (a) => ({ kiro: { state: 'cli', label: 'CLI missing', why: 'Install Kiro CLI in Settings › Accounts.' }, qwen: { state: 'signin', label: 'not signed in', why: 'Sign in to Qwen in Settings › Accounts.' }, ai21: { state: 'key', label: 'needs a key', why: 'Add your AI21 Jamba API key in Settings › Accounts.' } }[a] || { state: 'connected', label: 'connected', why: '' });

test('bug 1: @-named teammates that aren\'t connected (or aren\'t in the team) are all in the turn list and named in the chat', async () => {
  const team = { lead: 'anthropic', reviewer: null, members: ['anthropic', 'openai', 'kiro', 'qwen', 'ai21'] };
  const h = harness({ team, live: ['anthropic', 'openai'], statusOf: STATUS });
  const R = h.runner.rt('c1');
  const text = '@Claude @ChatGPT @Kiro @Qwen @AI21 @Warp @Phi @LocalAI test';
  R.msgs.push({ id: 'o1', who: 'owner', text });
  await h.runner.start(R, text);
  const list = Object.fromEntries(R.turnState.list.map((x) => [x.agent, x]));
  for (const a of ['kiro', 'qwen', 'ai21', 'warp', 'phi', 'ollama']) assert.equal(list[a]?.state, 'blocked', `${a} is in the list`);
  assert.match(list.kiro.reason, /CLI missing: Install Kiro CLI/);
  assert.equal(list.kiro.fix, 'install');
  assert.equal(list.qwen.fix, 'signin');
  assert.equal(list.warp.fix, 'team');
  assert.match(list.warp.reason, /not in your team/);
  const note = R.msgs.find((m) => m.who === 'system' && /can't answer/.test(m.text));
  assert.ok(note, 'one message in the chat says so');
  assert.match(note.text, /These 6 teammates were named but can't answer/);
  assert.match(note.text, /- Kiro: CLI missing, Install Kiro CLI in Settings › Accounts\./);
  assert.equal(note.fixes.length, 6);
  assert.deepEqual(h.runs.map((r) => r.agent).sort(), ['anthropic', 'openai']);
});

test('bug 1: teammates the LEAD names that can\'t answer are named too, and the lead\'s wrap-up lists them as not reached', async () => {
  const team = { lead: 'anthropic', reviewer: null, members: ['anthropic', 'openai', 'google', 'kiro'] };
  let leadTurns = 0;
  const h = harness({ team, live: ['anthropic', 'openai', 'google'], statusOf: STATUS, reply: (o) => (o.agent === 'anthropic' ? { ok: true, text: ++leadTurns === 1 ? 'Plan:\n@ChatGPT part one\n@Gemini part two\n@Kiro part three\n@Amp part four' : 'All done.' } : { ok: true, text: `done by ${o.agent}` }) });
  const R = h.runner.rt('c2');
  R.msgs.push({ id: 'o1', who: 'owner', text: 'go' });
  await h.runner.start(R, 'go');
  const list = Object.fromEntries(R.turnState.list.map((x) => [x.agent, x]));
  assert.equal(list.kiro.state, 'blocked');
  assert.equal(list.amp.state, 'blocked');
  assert.match(list.amp.reason, /not in your team/);
  const wrap = h.runs.filter((r) => r.agent === 'anthropic').find((r) => /finished working at the same time/.test(r.prompt));
  assert.match(wrap.prompt, /- Kiro: NOT REACHED \(CLI missing: Install Kiro CLI in Settings › Accounts\)/);
  assert.match(wrap.prompt, /- Amp: NOT REACHED \(not in your team/);
});

test('bug 1: @GitHub Copilot, @Local AI and @Factory Droid (with spaces) still reach the right teammate', () => {
  assert.deepEqual(mentionsIn('@GitHub Copilot, @Local AI and @Factory Droid'), ['ghcopilot', 'ollama', 'droid']);
});

// ---- bug 2: the lead is told who is connected, every turn ----
test('bug 2: the lead gets the team with each one\'s status, also in a resumed session', () => {
  const team = { lead: 'anthropic', reviewer: null, members: ['anthropic', 'openai', 'qwen', 'kiro'] };
  const status = { qwen: { label: 'not signed in', why: 'Sign in to Qwen in Settings › Accounts.' }, kiro: { label: 'CLI missing', why: '' } };
  const b = brief({ agent: 'anthropic', role: 'lead', team, live: ['anthropic', 'openai'], status });
  assert.match(b, /- ChatGPT \(connected\) · write @ChatGPT/);
  assert.match(b, /- Qwen \(not signed in: Sign in to Qwen/);
  assert.match(b, /- Team status now: @Claude you, @ChatGPT connected, @Qwen not signed in, @Kiro CLI missing\. Hand work only to the ones marked connected/);
  assert.match(b, /use only the ones in THE TEAM above that are connected/);
  const resumed = turnPrompt({ agent: 'anthropic', role: 'lead', messages: [{ who: 'owner', text: 'hi' }], briefText: b, resumed: true });
  assert.match(resumed, /Team status now: @Claude you, @ChatGPT connected, @Qwen not signed in/);
  assert.equal(teamStatusLine({ team, live: ['openai'], status: {} }), '@Claude not connected, @ChatGPT connected, @Qwen not connected, @Kiro not connected');
});

// ---- bug 4: sign-in and "no chat box" are different, and each error carries its fix ----
test('bug 4: a missing chat box is not called a sign-in problem; errors carry Open page / Sign in / Install', () => {
  const page = plainError('cerebras', { kind: 'page', fix: 'open', message: 'Cerebras\'s page didn\'t show its chat box (page loaded (chat.cerebras.ai) · chat box not found · message not sent).' });
  assert.doesNotMatch(page.reason, /signed in/);
  assert.equal(page.fix, 'open');
  assert.equal(plainError('cursor', { kind: 'auth', message: 'Not signed in.' }).fix, 'signin');
  assert.equal(plainError('cohere', { kind: 'auth', message: 'Not signed in.' }).fix, 'accounts');
  assert.equal(plainError('kiro', { kind: 'not_installed', message: 'x' }).fix, 'install');
  assert.equal(teammateStatus('qwen', { inTeam: true, kind: 'cli', installed: true, signedIn: false }).state, 'signin');
});

// ---- bug 5: the owner's "Looks right" reaches the lead, the content never does ----
test('bug 5: an uncensored teammate\'s reply stays hidden, but the owner\'s verdict reaches the lead', () => {
  const m = { id: 'v1', who: 'venice', text: 'secret words HEARTH-VENICE-AB12', ownerCheck: 'ok' };
  const rep = teamReports([m], ['venice'], { forAgent: 'anthropic' });
  assert.doesNotMatch(rep, /secret words|HEARTH-VENICE/);
  assert.match(rep, /The owner checked it and marked it: LOOKS RIGHT/);
  assert.match(shieldFor({ ...m, ownerCheck: 'bad' }, 'openai'), /content from Venice, not shown\] The owner checked it and marked it: NOT RIGHT/);
  assert.doesNotMatch(shieldFor({ ...m, ownerCheck: undefined }, 'openai'), /owner checked/);
});

// The lead must SEE what its teammates sent back. Bug (3.2): the wrap-up said "their answers are in the chat above",
// but the lead's resumed session only got the messages after its own last one, and its quick replies to each teammate
// counted as "last one", so every teammate's reply was dropped. Now the replies go into the lead's prompt itself,
// labelled by name, whole (errors, refusals and changed files too); a reply too long to fit says so and can be read
// with READ MESSAGE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeamRunner } from '../src/app/team-run.mjs';
import { teamReports, readMessage, since } from '../src/app/brief.mjs';
import { parseTools } from '../src/app/tools.mjs';

const MATES = ['openai', 'google', 'xai', 'mistral'];
const ALL = ['anthropic', ...MATES];
const TEAM = { lead: 'anthropic', reviewer: null, members: ALL };
const PLAN = 'Plan.\n@ChatGPT write the parser\n@Gemini write the tests\n@Grok write the save file\n@Mistral write the docs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fake AIs. The lead always has a session to resume (as the real CLIs do), which is where the replies were lost.
function harness({ reply = (agent) => ({ ok: true, text: `REPLY-FROM-${agent}: my part is done.` }), lead = () => 'Good.', delays = { openai: 5, google: 25, xai: 45, mistral: 65 } } = {}) {
  const runs = [];
  let n = 0;
  const runner = createTeamRunner({
    uid: () => `m${(++n).toString(36)}`,
    call: async (fn, ...a) => {
      if (fn !== 'chatRun') return null;
      const o = a[0];
      runs.push({ agent: o.agent, helper: o.helper === true, prompt: o.prompt, resumeId: o.resumeId });
      await sleep(delays[o.agent] ?? 1);
      if (o.agent === 'anthropic') {
        const first = !runs.slice(0, -1).some((x) => x.agent === 'anthropic');
        return { ok: true, text: first ? PLAN : lead(o.prompt, o), via: 'fake', sessionId: 'S-lead' };
      }
      return { via: 'fake', sessionId: `S-${o.agent}`, ...reply(o.agent, o) };
    },
    settings: () => ({ maxChats: 3, tools: { quickChecks: [] }, teamParallel: true }), openId: () => null, entry: (id) => ({ id, title: 'T' }),
    team: () => TEAM, live: () => ALL, method: () => 'cli', modeFor: () => 'team', webFor: () => false, buildFor: () => true,
    statusOf: () => ({ label: 'ok', why: '' }), render: () => {}, save: async () => {},
  });
  return { runner, runs };
}
const wrapUp = (runs) => runs.filter((r) => r.agent === 'anthropic' && !r.helper).find((r) => /finished working at the same time/.test(r.prompt));

test('4 jobs handed out, 4 replies: all 4 are in the lead\'s next prompt, labelled by name', async () => {
  const h = harness();
  const R = h.runner.rt('c1000000001');
  R.msgs.push({ id: 'o1', who: 'owner', text: 'make the game' });
  await h.runner.start(R, 'make the game');
  assert.deepEqual(h.runs.filter((r) => r.agent !== 'anthropic').map((r) => r.agent).sort(), [...MATES].sort(), 'each got its job');
  const w = wrapUp(h.runs);
  assert.ok(w, 'the lead got a wrap-up turn');
  assert.equal(w.resumeId, 'S-lead', 'it resumed the lead\'s session (where the replies were lost before)');
  for (const [id, label] of [['openai', 'ChatGPT'], ['google', 'Gemini'], ['xai', 'Grok'], ['mistral', 'Mistral']]) {
    assert.match(w.prompt, new RegExp(`=== ${label} ===\\n[^]*REPLY-FROM-${id}: my part is done\\.[^]*=== end of ${label} ===`), `${label}'s reply, labelled`);
  }
  assert.doesNotMatch(w.prompt, /in the chat above/);
});

test('errors, refusals and changed files reach the lead too', async () => {
  const h = harness({
    reply: (a) => (a === 'google' ? { ok: false, error: { kind: 'failed', message: 'Gemini ran out of its daily quota.' } }
      : a === 'xai' ? { ok: true, text: 'I can\'t help with that part.' }
        : a === 'openai' ? { ok: true, text: 'Parser written.', changes: { files: [{ path: 'src/parser.js' }, { path: 'test/parser.test.js' }] } }
          : { ok: true, text: 'Docs written.' }),
  });
  const R = h.runner.rt('c1000000002');
  R.msgs.push({ id: 'o1', who: 'owner', text: 'go' });
  await h.runner.start(R, 'go');
  const w = wrapUp(h.runs);
  assert.match(w.prompt, /=== Gemini ===\nERROR \(Gemini did not finish\): [^]*quota/);
  assert.match(w.prompt, /- Gemini: did not finish/);
  assert.match(w.prompt, /=== Grok ===\nI can't help with that part\./);
  assert.match(w.prompt, /\[files ChatGPT changed in its own copy: src\/parser\.js, test\/parser\.test\.js\]/);
  assert.match(w.prompt, /=== Mistral ===\nDocs written\./);
});

test('the lead\'s quick answer to each teammate includes that teammate\'s report', async () => {
  const h = harness();
  const R = h.runner.rt('c1000000003');
  R.msgs.push({ id: 'o1', who: 'owner', text: 'go' });
  await h.runner.start(R, 'go');
  const quick = h.runs.filter((r) => r.helper);
  assert.equal(quick.length, 4);
  for (const id of MATES) assert.ok(quick.some((q) => new RegExp(`REPORT:\\n=== [^\\n]+ ===\\nREPLY-FROM-${id}`).test(q.prompt)), `${id}'s report was in a quick reply`);
});

test('a reply too long to include says so, and READ MESSAGE gives the lead the rest', async () => {
  const long = `START ${'x'.repeat(30000)} THE-VERY-END`;
  let asked = null;
  const h = harness({
    reply: (a) => ({ ok: true, text: a === 'mistral' ? long : `short from ${a}` }),
    lead: (p, o) => {
      const m = !o.helper && p.match(/^READ MESSAGE: (\S+) from (\d+)$/m);
      if (m && !asked) { asked = m; return `READ MESSAGE: ${m[1]} from ${m[2]}`; }
      return 'All checked.';
    },
  });
  const R = h.runner.rt('c1000000004');
  R.msgs.push({ id: 'o1', who: 'owner', text: 'go' });
  await h.runner.start(R, 'go');
  const w = wrapUp(h.runs);
  assert.match(w.prompt, /=== Mistral ===\nSTART x+\n\[… cut here: this message is \d+ characters and only the first \d+ fit\]/);
  assert.match(w.prompt, /Mistral's reply was too long to include in full/);
  for (const id of ['openai', 'google', 'xai']) assert.match(w.prompt, new RegExp(`short from ${id}`));
  assert.ok(asked, 'the lead was given a READ MESSAGE line');
  const after = h.runs.filter((r) => r.agent === 'anthropic' && !r.helper).pop();
  assert.match(after.prompt, /THE MESSAGES YOU ASKED TO READ/);
  assert.match(after.prompt, /THE-VERY-END/, 'the rest of the long reply reached the lead');
  assert.ok(R.msgs.some((m) => m.who === 'anthropic' && m.text === 'All checked.'));
});

test('an uncensored teammate\'s content still never reaches the lead, but the lead is told it answered and why it can\'t see it', () => {
  const msgs = [{ id: 'g1', who: 'gpu', text: 'SECRET-PICTURE-PROMPT', media: [{ kind: 'image', name: 'a.png' }] }, { id: 'g2', who: 'openai', text: 'fine' }];
  const t = teamReports(msgs, ['gpu', 'openai'], { forAgent: 'anthropic' });
  assert.doesNotMatch(t, /SECRET-PICTURE-PROMPT|a\.png/);
  assert.match(t, /answered\. What it wrote and made is shown to the owner only/);
  assert.match(t, /=== ChatGPT ===\nfine/);
  assert.match(readMessage(msgs, 'g1', { forAgent: 'anthropic' }), /never passes/);
  assert.doesNotMatch(readMessage(msgs, 'g1', { forAgent: 'anthropic' }), /SECRET/);
});

test('a teammate that posted nothing is named, not silently skipped', () => {
  assert.match(teamReports([], ['xai']), /=== Grok ===\n\(nothing came back from Grok/);
});

test('the lead\'s quick replies (a fresh session) don\'t hide what came before them from its resumed session', () => {
  const msgs = [{ id: '1', who: 'anthropic', text: 'plan' }, { id: '2', who: 'openai', text: 'done' }, { id: '3', who: 'anthropic', text: 'nice', quick: true }, { id: '4', who: 'google', text: 'done too' }];
  assert.deepEqual(since(msgs, 'anthropic').map((m) => m.id), ['2', '3', '4']);
});

test('READ MESSAGE lines are parsed and taken out of the text', () => {
  const r = parseTools('Let me look.\nREAD MESSAGE: m1a from 1200\nREAD MESSAGE: m2b', { agent: 'anthropic' });
  assert.equal(r.text, 'Let me look.');
  assert.deepEqual(r.tools.map((x) => [x.kind, x.id, x.from]), [['readmsg', 'm1a', 1200], ['readmsg', 'm2b', 0]]);
});

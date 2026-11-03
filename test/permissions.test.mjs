// Team chat: AI directives (edit / retract / handoff / ask), owner edits, permission flow.
import test from 'node:test';
import assert from 'node:assert';
import { parseDirectives, applyEdit, applyRetract, makeRequest, decideRequest, blockedAgents, buildDelta, buildPrompt, mentions, PERMISSION_KINDS } from '../src/chat.mjs';

test('directives are pulled out of a reply; the rest stays as the message', () => {
  const d = parseDirectives([
    'Here is the plan.',
    'EDIT #AB12CD: Corrected: use GRUB themes, not a custom menu.',
    '- RETRACT #ZZ99YY',
    'HANDOFF: @gemini check the Decky docs',
    '**ASK: push | push hearth/task-k7q2ma to GitHub | so ChatGPT can review the branch**',
    'ASK: rm -rf build/ in the repo root | clean build',
    'TASK: Add page | implementer: claude | reviewer: chatgpt | action: code',
  ].join('\n'));
  assert.equal(d.text, 'Here is the plan.\nTASK: Add page | implementer: claude | reviewer: chatgpt | action: code');
  assert.deepStrictEqual(d.edits, [{ id: 'AB12CD', text: 'Corrected: use GRUB themes, not a custom menu.' }]);
  assert.deepStrictEqual(d.retracts, ['ZZ99YY']);
  assert.deepStrictEqual(d.handoffs, [{ to: 'google', note: 'check the Decky docs' }]);
  assert.deepStrictEqual(d.asks[0], { kind: 'push', what: 'push hearth/task-k7q2ma to GitHub', why: 'so ChatGPT can review the branch' });
  assert.equal(d.asks[1].kind, 'delete', 'rm -rf is a delete, whatever the AI called it');
  assert.equal(d.asks[1].what, 'rm -rf build/ in the repo root');
  assert.equal(d.pass, false);
  assert.equal(parseDirectives('PASS').pass, true);
  assert.equal(parseDirectives('PASS').text, '');
  assert.equal(parseDirectives('HANDOFF: @nobody do it').handoffs.length, 0);
});

test('AIs can only edit/retract their own messages; owner can edit any; history is kept', () => {
  const chat = [
    { id: 'AAAA11', who: 'anthropic', text: 'v1' },
    { id: 'BBBB22', who: 'openai', text: 'gpt says' },
  ];
  assert.equal(applyEdit(chat, { id: 'BBBB22', by: 'anthropic', text: 'hijack' }).ok, false);
  assert.equal(chat[1].text, 'gpt says');
  const r = applyEdit(chat, { id: 'AAAA11', by: 'anthropic', text: 'v2', at: 't1' });
  assert.ok(r.ok);
  assert.equal(chat[0].text, 'v2');
  assert.ok(chat[0].edited);
  assert.deepStrictEqual(chat[0].history, [{ text: 'v1', at: 't1', by: 'anthropic' }]);
  assert.ok(applyEdit(chat, { id: 'BBBB22', by: 'owner', text: 'owner fixed it' }).ok);
  assert.equal(chat[1].editedBy, 'owner');
  assert.equal(applyEdit(chat, { id: 'AAAA11', by: 'anthropic', text: 'v2' }).reason, 'no change');
  assert.equal(applyRetract(chat, { id: 'BBBB22', by: 'anthropic' }).ok, false);
  assert.ok(applyRetract(chat, { id: 'AAAA11', by: 'anthropic' }).ok);
  assert.ok(chat[0].retracted);
  assert.equal(applyEdit(chat, { id: 'AAAA11', by: 'anthropic', text: 'v3' }).ok, false, 'retracted stays retracted');
  assert.equal(applyEdit(chat, { id: 'NOPE00', by: 'owner', text: 'x' }).ok, false);
});

test('permission requests block the AI until the owner approves or denies', () => {
  const list = [makeRequest({ id: 'R1', agent: 'anthropic', kind: 'merge', what: 'merge hearth/task-x into main', why: 'tests pass' }), makeRequest({ id: 'R2', agent: 'openai', kind: 'weird', what: 'x' })];
  assert.equal(list[1].kind, 'other');
  assert.deepStrictEqual(blockedAgents(list), ['anthropic', 'openai']);
  assert.ok(decideRequest(list, 'R1', 'why').ok);
  assert.equal(list[0].status, 'pending', 'asking why keeps it pending');
  assert.equal(list[0].questions.length, 1);
  assert.ok(decideRequest(list, 'R1', 'approved', 'tA').ok);
  assert.equal(list[0].decidedAt, 'tA');
  assert.equal(decideRequest(list, 'R1', 'denied').ok, false, 'decided once');
  assert.ok(decideRequest(list, 'R2', 'denied').ok);
  assert.deepStrictEqual(blockedAgents(list), []);
  assert.equal(decideRequest(list, 'R9', 'approved').ok, false);
  assert.equal(decideRequest([makeRequest({ id: 'R3', agent: 'google', kind: 'boot', what: 'x' })], 'R3', 'maybe').ok, false);
  for (const k of ['push', 'merge', 'release', 'delete', 'boot', 'outside']) assert.ok(PERMISSION_KINDS[k]);
});

test('AIs are told how to ask, edit, hand off; prompts show message ids and edits', () => {
  const chat = [{ id: 'M1AAAA', who: 'owner', text: 'go' }, { id: 'M2BBBB', who: 'anthropic', text: 'plan', edited: true }, { id: 'M3CCCC', who: 'openai', text: 'gone', retracted: true }, { id: 'M4', who: 'owner', text: 'deleted', deleted: true }];
  const p = buildPrompt('openai', chat, { pending: [{ id: 'R1', agent: 'anthropic', kind: 'push', what: 'push branch' }] });
  assert.match(p, /\[#M2BBBB\] Claude \(edited\): plan/);
  assert.match(p, /\[#M3CCCC\] ChatGPT: \(retracted\)/);
  assert.doesNotMatch(p, /deleted/);
  assert.match(p, /ASK: <install\|outside\|command\|delete\|secrets\|network\|push\|boot\|other\|merge\|release\|version\|tag\|settings>/);
  assert.match(p, /ROUTINE, just do it, never ask/);
  assert.match(p, /EDIT #<message id>/);
  assert.match(p, /HANDOFF: @<name>/);
  assert.match(p, /R-R1 by Claude/);
  assert.match(p, /Dragongamer9/);
  assert.match(p, /never add it to the Hearth OS image/);
  const d = buildDelta('google', [{ id: 'X1', who: 'owner', text: 'new thing' }], { pending: [] });
  assert.match(d, /continuing/);
  assert.match(d, /\[#X1\] Owner: new thing/);
  assert.ok(d.length < 1000);
  assert.deepStrictEqual(mentions('@grok and @perplexity, also @deepseek @nobody'), ['xai', 'perplexity', 'deepseek']);
});

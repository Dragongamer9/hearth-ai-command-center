// Voice chat, window side logic (src/app/voice-logic.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeFor, voiceFor, speechParts, speechPlan, createTurnTaker, createSpeechQueue, newReplies, uncensoredOnly, autoPick, voiceSettings } from '../src/app/voice-logic.mjs';

const keysAll = { elevenlabs: true, openai: true };
const lists = { elevenlabs: [{ id: 'VoiceAria0001' }, { id: 'VoiceRoger0002' }, { id: 'VoiceSarah0003' }, { id: 'VoiceLaura0004' }], openai: ['alloy', 'nova', 'onyx'].map((id) => ({ id })), local: [] };

test('Barge-in: talking over a reply stops the playback at once and drops the rest', async () => {
  const cancelled = [];
  let release;
  const q = createSpeechQueue({ play: () => new Promise((r) => { release = r; }), cancel: (p) => { cancelled.push(p.text); release(); } });
  let barged = 0;
  const t = createTurnTaker({ onBarge: () => { barged++; q.stop(); } });
  q.enqueue([{ text: 'one' }, { text: 'two' }, { text: 'three' }]);
  t.setSpeaking(true);
  assert.equal(q.current.text, 'one');
  // The reply's own echo (quiet) doesn't count; his voice (loud, for a moment) does.
  for (let ms = 0; ms < 600; ms += 20) t.feed(0.03, ms);
  assert.equal(barged, 0);
  let res = null;
  for (let ms = 600; ms < 1000 && res !== 'barge'; ms += 20) res = t.feed(0.3, ms);
  assert.equal(res, 'barge');
  assert.equal(barged, 1);
  assert.deepEqual(cancelled, ['one']);
  assert.equal(q.busy, false, 'the rest of the reply is dropped');
  assert.equal(t.state.inSpeech, true, 'and it is listening to him straight away');
  // Barge-in off: talking over a reply does nothing.
  const t2 = createTurnTaker({ onBarge: () => assert.fail('no barge-in') });
  t2.setBargeIn(false); t2.setSpeaking(true);
  for (let ms = 0; ms < 1000; ms += 20) t2.feed(0.5, ms);
});

test('Hands-free turn taking: speech starts, a pause ends the turn; coughs and push to talk do not', () => {
  const ev = [];
  const t = createTurnTaker({ onStart: () => ev.push('start'), onEnd: () => ev.push('end') });
  for (let ms = 0; ms < 500; ms += 20) t.feed(0.005, ms);
  for (let ms = 500; ms < 1500; ms += 20) t.feed(0.12, ms);
  for (let ms = 1500; ms < 2600; ms += 20) t.feed(0.004, ms);
  assert.deepEqual(ev, ['start', 'end']);
  const short = [];
  const t2 = createTurnTaker({ onStart: () => short.push('start'), onEnd: () => short.push('end') });
  for (let ms = 0; ms < 200; ms += 20) t2.feed(0.12, ms);
  for (let ms = 200; ms < 1400; ms += 20) t2.feed(0.003, ms);
  assert.deepEqual(short, ['start'], 'a short noise never sends a turn');
  const t3 = createTurnTaker({ onStart: () => assert.fail('push to talk ignores the level') });
  t3.setMode('ptt');
  for (let ms = 0; ms < 1000; ms += 20) t3.feed(0.4, ms);
});

test('Group roleplay: each character speaks in its own voice; narration can use a narrator or be skipped', () => {
  const cards = [{ id: 'm', name: 'Mira', ownerVoice: { elevenlabs: { id: 'VoiceAria0001', name: 'Aria' }, speed: 1.1 } }, { id: 't', name: 'Tobin', ownerVoice: { elevenlabs: { id: 'VoiceRoger0002' }, openai: 'onyx' } }, { id: 'a', name: 'Ash' }];
  const msgs = [{ id: '1', who: 'owner', text: 'Hi' }, { id: '2', who: 'anthropic', char: 't', text: '*Tobin nods.* "Dawn."' }, { id: '3', who: 'openai', char: 'a', text: '"Watch."' }, { id: '4', who: 'venice', char: 'm', text: '"Stew?" *she asks.*' }];
  const settings = { voice: { tts: 'elevenlabs', narration: 'narrator', voices: { narrator: { elevenlabs: { id: 'VoiceLaura0004' } }, anthropic: { elevenlabs: { id: 'VoiceSarah0003' } } } } };
  const { plan } = speechPlan({ msgs, cards, settings, keys: keysAll, lists });
  const say = plan.map((p) => [p.char, p.kind, p.voice]);
  assert.deepEqual(say[0], ['t', 'narration', 'VoiceLaura0004'], 'narrator voice for *Tobin nods.*');
  assert.deepEqual(say[1], ['t', 'speech', 'VoiceRoger0002'], 'Tobin\'s own voice, not Claude\'s teammate voice');
  assert.equal(say[2][0], 'a');
  assert.ok(say[2][2] && plan[2].auto, 'Ash has no voice: an automatic one');
  assert.deepEqual(say[3], ['m', 'speech', 'VoiceAria0001']);
  assert.equal(plan[3].speed, 1.1);
  // The automatic pick is stable and the same every time.
  assert.equal(autoPick('card:a', ['x', 'y', 'z']), autoPick('card:a', ['x', 'y', 'z']));
  // Narration skipped / same voice.
  assert.deepEqual(speechParts('*waves* "Hello there." *smiles*', { narration: 'skip' }), [{ kind: 'speech', text: '"Hello there."' }]);
  assert.deepEqual(speechParts('*waves* "Hello."', { narration: 'same' }), [{ kind: 'speech', text: 'waves "Hello."' }]);
  // Normal chats: a voice per AI teammate, then the default voice.
  const s2 = { voice: { tts: 'openai', voices: { openai: { openai: 'nova' }, default: { openai: 'alloy' } } } };
  assert.equal(voiceFor({ msg: { who: 'openai' }, settings: s2, provider: 'openai', list: lists.openai }).voice, 'nova');
  assert.equal(voiceFor({ msg: { who: 'google' }, settings: s2, provider: 'openai', list: lists.openai }).voice, 'alloy');
});

test('Uncensored teammates: their text is not routed to OpenAI TTS without his choice', () => {
  const s = { voice: { tts: 'openai' } };
  for (const who of ['venice', 'civitai', 'gpu']) {
    const r = routeFor({ who, settings: s, keys: keysAll, names: { venice: 'Venice' } });
    assert.notEqual(r.provider, 'openai');
    assert.equal(r.provider, 'elevenlabs');
    assert.match(r.notice, /aren't sent to OpenAI/);
    assert.equal(routeFor({ who, settings: s, keys: { openai: true } }).provider, 'local', 'no ElevenLabs key: this PC');
  }
  assert.equal(routeFor({ who: 'anthropic', settings: s, keys: keysAll }).provider, 'openai');
  assert.equal(routeFor({ who: 'venice', settings: { voice: { tts: 'openai', openaiForUncensored: true } }, keys: keysAll }).provider, 'openai', 'his explicit choice');
  // In a group roleplay, Venice's character is spoken elsewhere while the others use OpenAI.
  const { plan, notices } = speechPlan({ msgs: [{ id: '1', who: 'venice', char: 'm', text: '"Hi."' }, { id: '2', who: 'anthropic', char: 't', text: '"Yo."' }], cards: [{ id: 'm' }, { id: 't' }], settings: s, keys: keysAll, lists });
  assert.deepEqual(plan.map((p) => p.provider), ['elevenlabs', 'openai']);
  assert.equal(notices.length, 1);
  assert.equal(uncensoredOnly({ chat: { rp: { players: { m: 'venice' } } } }), true);
  assert.equal(uncensoredOnly({ chat: { rp: { players: { m: 'venice', t: 'anthropic' } } } }), false);
  assert.equal(uncensoredOnly({ chat: {}, mode: 'venice' }), true);
});

test('Spoken text leaves out code and links; long replies are cut at sentence ends; new replies are found', () => {
  const p = speechParts('Here:\n```js\nconst x = 1;\n```\nSee [the docs](https://x.y) at https://a.b now.');
  assert.equal(p.length, 1);
  assert.doesNotMatch(p[0].text, /const|https|\[/);
  assert.match(p[0].text, /the docs/);
  const long = speechParts(Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(' '));
  assert.ok(long.length > 1 && long.every((x) => x.text.length <= 420));
  const msgs = [{ who: 'owner', text: 'a' }, { who: 'anthropic', text: 'b' }, { who: 'system', text: 'c' }, { who: 'openai', text: 'd', err: true }, { who: 'google', text: 'e' }];
  assert.deepEqual(newReplies(msgs, 1).map((m) => m.text), ['b', 'e']);
  assert.equal(voiceSettings({}).tts, 'local');
});

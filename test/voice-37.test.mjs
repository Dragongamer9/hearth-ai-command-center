// 3.7 voice: sentence by sentence with the next one made ahead, what isn't read aloud, the time to the first sound,
// talking to an AI by name, and each AI's own voice (his choice always wins).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speakable, sentences, speechParts, createSpeechQueue, createLatencyMeter, spokenTo, voiceLines, voiceMenu, voiceFor, pickEntry } from '../src/app/voice-logic.mjs';
import { messageText } from '../src/app/brief.mjs';

test('tables, code blocks, links and Markdown symbols are not read aloud', () => {
  const t = speakable('## Done\n\nI changed **two** files, see [the PR](https://github.com/x/y/pull/1) or https://x.y.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n- one thing\n1. another\n> quoted\n`npm test` passed');
  assert.doesNotMatch(t, /\||```|const x|https?:|\*\*|##|^- |^1\. |^> /m);
  assert.match(t, /^Done\.$/m); assert.match(t, /I changed two files, see the PR or/);
  assert.match(t, /one thing\./); assert.match(t, /npm test passed$/);
});

test('cut into sentences; short bits join the next one', () => {
  assert.deepEqual(sentences('Yes. I fixed the battery page today. Dr. Smith checked it twice. It costs 3.5 dollars now.'), ['Yes. I fixed the battery page today.', 'Dr. Smith checked it twice.', 'It costs 3.5 dollars now.']);
  assert.equal(speechParts('First sentence is right here. Second sentence follows it now.').length, 2);
});

test('the next sentence is made while one plays, and a stop drops what was made', async () => {
  const made = []; const played = []; const dropped = [];
  let release;
  const q = createSpeechQueue({
    prepare: async (p) => { made.push(p.text); return { id: p.text }; },
    play: (p, r) => new Promise((res) => { played.push([p.text, r?.id]); release = res; }),
    discard: (p) => dropped.push(p.text),
  });
  q.enqueue([{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }]);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(played, [['a', 'a']]);
  assert.deepEqual(made, ['a', 'b', 'c']); // the current one and the next two
  q.stop();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(dropped.sort(), ['b', 'c']);
  release();
});

test('time from the end of his speech to the first sound', () => {
  let t = 0;
  const m = createLatencyMeter({ now: () => t });
  m.endOfSpeech(1000); t = 3400; assert.equal(m.firstSound(), 2400);
  assert.equal(m.firstSound(), null); // only the first sound of a turn counts
  m.endOfSpeech(5000); m.firstSound(6000); m.endOfSpeech(7000); m.firstSound(10000);
  assert.deepEqual(m.list, [2400, 1000, 3000]); assert.equal(m.median, 2400);
});

test('talking to an AI by name in Talk', () => {
  const al = (w) => ({ gemini: 'google', claude: 'anthropic', codex: 'openai', grok: 'xai' })[w] || null;
  assert.deepEqual(spokenTo('Gemini, what do you think?', al), ['google']);
  assert.deepEqual(spokenTo('Hey Codex check the build', al), ['openai']);
  assert.deepEqual(spokenTo('Claude and Grok: compare these', al), ['anthropic', 'xai']);
  assert.deepEqual(spokenTo('Claude code broke again', al), []);
  assert.deepEqual(spokenTo('So what now', al), []);
});

test('a message said aloud tells the AI its reply is read aloud, with no limit on length', () => {
  const t = messageText({ who: 'owner', text: 'how is the build', voice: true });
  assert.match(t, /said this out loud/); assert.match(t, /as much as the answer needs/);
  assert.doesNotMatch(messageText({ who: 'owner', text: 'typed' }), /out loud/);
});

test('each AI picks its own voice; his choice wins', () => {
  assert.deepEqual(voiceLines('Okay.\n**VOICE: af_heart**\nDone.'), { text: 'Okay.\nDone.', pick: 'af_heart' });
  assert.equal(voiceLines('No pick here.').pick, null);
  const list = [{ id: 'af_heart', name: 'Heart' }, { id: 'am_adam', name: 'Adam' }];
  const picks = { anthropic: { provider: 'local', voice: 'kokoro:am_adam' } };
  const settings = { voice: { tts: 'local', voices: {} } };
  assert.equal(voiceFor({ msg: { who: 'anthropic' }, settings, provider: 'local', list, picks }).voice, 'kokoro:am_adam');
  const his = { voice: { tts: 'local', voices: { anthropic: { local: 'kokoro:af_heart' } } } };
  assert.equal(voiceFor({ msg: { who: 'anthropic' }, settings: his, provider: 'local', list, picks }).voice, 'kokoro:af_heart');
  assert.equal(voiceMenu({ who: 'anthropic', settings: his, provider: 'local', list }), '');
  assert.match(voiceMenu({ who: 'anthropic', settings, provider: 'local', list, picks }), /VOICE: <id>.*af_heart \(Heart\).*The owner can always change it/);
  assert.deepEqual(pickEntry({ provider: 'elevenlabs', voice: 'abc123' }), { elevenlabs: { id: 'abc123' } });
});

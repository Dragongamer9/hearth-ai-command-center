// A chat's own voice and speed (the chat window's Voice button): its voice speaks for the AI teammates, a character
// keeps its own, and its speed is for everyone in the chat.
const test = require('node:test');
const assert = require('node:assert/strict');

test('a chat voice replaces the teammates\' voice and sets the speed', async () => {
  const { withChatVoice } = await import('../src/app/voice-logic.mjs');
  const sel = { provider: 'local', voice: 'kokoro:af_heart', speed: 1, auto: true };
  const cv = { provider: 'server:vs', voice: 'Narrator', speed: 1.3 };
  assert.deepEqual(withChatVoice(sel, { who: 'claude' }, cv), { provider: 'server:vs', voice: 'Narrator', speed: 1.3, auto: false });
  // A character keeps its own voice; the speed still applies.
  assert.deepEqual(withChatVoice(sel, { who: 'claude', char: 'c1' }, cv), { ...sel, speed: 1.3 });
  // No choice: unchanged. A speed out of range is ignored.
  assert.equal(withChatVoice(sel, { who: 'claude' }, null), sel);
  assert.equal(withChatVoice(sel, { who: 'claude' }, { speed: 9 }).speed, 1);
});

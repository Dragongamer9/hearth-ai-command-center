// Speech servers in the window's voice logic (src/app/voice-logic.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeFor, voiceFor, speechPlan, speechParts, providerName, isServer } from '../src/app/voice-logic.mjs';

const servers = [{ id: 'abc123def456', name: 'Kokoro (home)', url: 'http://100.64.0.5:8880', api: 'kokoro-fastapi', engine: 'kokoro' }, { id: 'fff000aaa111', name: 'Dia', url: 'http://100.64.0.5:8003', api: 'dia-server', engine: 'dia' }];

test('A speech server can be the voice provider; uncensored teammates may use it (it is his own PC)', () => {
  const settings = { voice: { tts: 'server:abc123def456', servers } };
  assert.deepEqual(routeFor({ who: 'venice', settings }), { provider: 'server:abc123def456', notice: null });
  assert.equal(providerName('server:abc123def456', settings), 'Kokoro (home)');
  assert.equal(isServer('server:abc123def456'), true);
  // A removed server falls back to this PC and says so.
  const gone = routeFor({ who: 'anthropic', settings: { voice: { tts: 'server:zzzzzz999999', servers } } });
  assert.equal(gone.provider, 'local');
  assert.match(gone.notice, /removed/);
  // A server at OpenAI's own address follows the uncensored rule.
  const sneaky = routeFor({ who: 'venice', settings, hosts: { abc123def456: { openaiHost: true } } });
  assert.equal(sneaky.provider, 'local');
});

test('Different characters can use different engines; voices are kept per server', () => {
  const settings = { voice: { tts: 'server:abc123def456', servers, narration: 'narrator', voices: { narrator: { use: 'server:fff000aaa111', servers: { fff000aaa111: 'S2' } }, default: { servers: { abc123def456: 'af_bella' } } } } };
  const cards = [{ id: 'c1', name: 'Mira', ownerVoice: { use: 'server:fff000aaa111' } }];
  const canUse = () => true;
  assert.deepEqual(voiceFor({ msg: { who: 'anthropic' }, settings, provider: 'server:abc123def456', canUse }), { provider: 'server:abc123def456', voice: 'af_bella', speed: undefined, pitch: undefined });
  const n = voiceFor({ msg: { who: 'anthropic' }, part: 'narration', settings, provider: 'server:abc123def456', canUse });
  assert.equal(n.provider, 'server:fff000aaa111');
  assert.equal(n.voice, 'S2');
  const m = voiceFor({ msg: { who: 'anthropic', char: 'c1' }, cards, settings, provider: 'server:abc123def456', canUse });
  assert.equal(m.provider, 'server:fff000aaa111', 'Mira speaks on Dia');
  assert.equal(m.voice, null, 'the server\'s first voice');
  // A use that isn't allowed (or a removed server) is ignored.
  assert.equal(voiceFor({ msg: { who: 'anthropic', char: 'c1' }, cards, settings, provider: 'local', list: [{ id: 'espeak:en-us' }] }).provider, 'local');
  const { plan } = speechPlan({ msgs: [{ id: 'm1', who: 'anthropic', char: 'c1', text: '*She smiles.* Hello <laugh> there' }], cards, settings });
  assert.deepEqual(plan.map((p) => [p.kind, p.provider, p.text]), [['narration', 'server:fff000aaa111', 'She smiles.'], ['speech', 'server:fff000aaa111', 'Hello <laugh> there']]);
});

test('Expressive tags survive the spoken text for the engines that perform them', () => {
  assert.deepEqual(speechParts('Oh <laugh> no > yes (sighs)'), [{ kind: 'speech', text: 'Oh <laugh> no yes (sighs)' }]);
});

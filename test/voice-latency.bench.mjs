// Time from the end of his speech to the first sound, old (3.6) vs new (3.7) Talk pipeline, same simulated world:
// VAD waits 900 ms of silence; speech to text 800 ms; the lead's reply lands 6 s after sending; the voice server takes
// 300 ms + 12 ms per character before it returns audio (Kokoro on a CPU is roughly like that); the round ends when the
// reply lands (solo) or 20 s later (a teammate checks it). Time runs 20x fast; numbers are scaled back.
import * as OLD from './fixtures/voice-logic-3.6.mjs';
import * as NEW from '../src/app/voice-logic.mjs';
const K = 20;
const wait = (ms) => new Promise((r) => setTimeout(r, ms / K));
const REPLY = `## The fix\n\nI found it. The battery watcher read the wrong file after a resume, so the number froze at the last value. I changed **BatteryWatch.qml** to read upower again whenever the PC wakes up.\n\n| file | change |\n|---|---|\n| BatteryWatch.qml | re-read on wake |\n\n- The tests pass on this PC.\n- I pushed it to the branch.\n\nNext, I can add a small check so this can't come back. Do you want me to do that now, or after the release? It would take about ten minutes and it only touches the test folder.`;
const tts = (text) => 300 + 12 * text.length;
const audioLen = (text) => 65 * text.length;
async function run(lib, mode, roundExtra) {
  const t0 = performance.now(); // end of his speech
  let first = null;
  await wait(900 + 800); // VAD silence + speech to text
  const msg = { who: 'anthropic', text: REPLY };
  const plan = (lib === NEW)
    ? NEW.speechParts(REPLY, { narration: 'same' }).map((p) => ({ ...p, who: 'anthropic' }))
    : OLD.speechParts(REPLY, { narration: 'same' }).map((p) => ({ ...p, who: 'anthropic' }));
  const firstSound = () => { if (first === null) first = (performance.now() - t0) * K; };
  let q;
  if (lib === NEW) q = NEW.createSpeechQueue({ prepare: async (p) => { await wait(tts(p.text)); return { ok: true }; }, play: async (p) => { firstSound(); await wait(audioLen(p.text)); } });
  else q = OLD.createSpeechQueue({ play: async (p) => { await wait(tts(p.text)); firstSound(); await wait(audioLen(p.text)); } });
  await wait(6000); // the reply lands
  if (lib === NEW) q.enqueue(plan); // spoken as soon as it lands
  else { await wait(roundExtra); q.enqueue(plan); } // 3.6 waited for the round to end
  while (first === null) await wait(50);
  return { first: Math.round(first), parts: plan.length, firstText: plan[0].text.length };
}
for (const [label, extra] of [['solo (the lead answers alone)', 0], ['team (a teammate checks for 20 s)', 20000]]) {
  const o = await run(OLD, 'old', extra); const n = await run(NEW, 'new', extra);
  console.log(`${label}: before ${(o.first / 1000).toFixed(1)} s (first part ${o.firstText} chars of ${o.parts}) · after ${(n.first / 1000).toFixed(1)} s (first part ${n.firstText} chars of ${n.parts})`);
}

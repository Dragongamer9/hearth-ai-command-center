// 2.2.1 Images & Videos page (src/app/studio.mjs) and its wiring in the window.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { studioView, queueHtml, requestFrom, filterItems, progressOf, jobLine, statusPill } from '../src/app/studio.mjs';

const items = [
  { id: 'a1', kind: 'image', url: 'hearth-media://c/studio/aa-picture.png', prompt: 'Elf queen, adult', seed: 1, adult: true },
  { id: 'b2', kind: 'video', url: 'hearth-media://c/studio/bb-video.mp4', prompt: 'Train in a tunnel', seed: 2, adult: false, frames: 81 },
  { id: 'c3', kind: 'image', url: 'hearth-media://c/studio/cc-picture.png', prompt: '<script>x</script>', seed: 3, adult: false },
];
test('the mockup: request panel, status pill, queue, gallery with Save / Send to a chat / Again', () => {
  const h = studioView({ data: { items, jobs: [{ id: 'j', kind: 'video', prompt: 'Freight train', state: 'running', elapsed: 60, estimate: 240 }], uncensored: false }, st: { ok: true, host: 'chris-hearth', gpu: 'NVIDIA GeForce RTX 5070', vramFree: 8 * 1024 ** 3, vramTotal: 12 * 1024 ** 3 } });
  for (const t of ['Images &amp; Videos', 'What should it show?', 'How many', 'On your PC now', 'Made so far', 'Save', 'Send to a chat', 'Again', 'Make it', 'RTX 5070 · online', '8.0 GB graphics memory free']) assert.ok(h.includes(t), t);
  assert.ok(!h.includes('<script>x'), 'prompts are escaped');
  assert.match(h, /aria-valuenow="25"/);
});
test('18+ items are blurred until clicked, marked, and never offered to a chat', () => {
  const h = studioView({ data: { items, jobs: [], uncensored: true } });
  assert.match(h, /class="st-item hidden18" data-id="a1"/);
  assert.match(h, /18\+ · show/);
  assert.match(h, /data-a="st-send" data-id="a1" disabled/);
  assert.ok(!/data-a="st-send" data-id="b2" disabled/.test(h));
  const shown = studioView({ data: { items, jobs: [], uncensored: true }, shown: new Set(['a1']) });
  assert.ok(!/hidden18" data-id="a1"/.test(shown));
  assert.match(shown, /st-mark/);
});
test('video form: start from text or a picture, Wan 2.2 14B, about 5 s; uncensored LoRA named when the mode is on', () => {
  const h = studioView({ f: { kind: 'video' }, data: { items, jobs: [], uncensored: true } });
  for (const t of ['Start from', 'Text only', 'A picture file', 'Wan 2.2 14B text to video', 'uncensored LoRA', 'about 5 s', '18+ Uncensored mode']) assert.ok(h.includes(t), t);
  assert.match(h, /value="item:c3"/);
  assert.ok(!/value="item:b2"/.test(h), 'only pictures can be animated');
  const i2v = studioView({ f: { kind: 'video', start: 'item:c3', startName: 'Signal box' }, data: { items, jobs: [] } });
  assert.ok(i2v.includes('picture to video'));
});
test('helpers: filter, progress, queue line, request', () => {
  assert.equal(filterItems(items, 'video').length, 1);
  assert.equal(filterItems(items, 'all').length, 3);
  assert.equal(progressOf({ state: 'running', elapsed: 10, estimate: null }), null);
  assert.equal(progressOf({ state: 'running', elapsed: 500, estimate: 100 }), 95);
  assert.equal(jobLine({ state: 'waiting' }), 'waiting');
  assert.equal(jobLine({ state: 'running', kind: 'video', phase: 'generating', elapsed: 75, estimate: 240 }), 'making the video · 1 min 15 s of about 4 min 00 s');
  assert.match(queueHtml([{ id: 'w', kind: 'image', prompt: 'p', state: 'waiting' }]), /Remove/);
  assert.equal(queueHtml([]), '');
  assert.match(statusPill({ ok: false, kind: 'not_set' }), /no address yet/);
  const r = requestFrom({ kind: 'video', start: 'item:c3', 'st-prompt': ' a lamp ', 'st-size': '480x832', 'st-seed': '' });
  assert.deepEqual([r.kind, r.prompt, r.size, r.start, r.seed, r.count], ['video', 'a lamp', '480x832', 'item:c3', null, 1]);
});
test('window wiring: sidebar entry, settings tab, events and actions', () => {
  const m = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(m, /data-a="studio"/);
  assert.match(m, /\['uncensored', 'Uncensored mode'\]/);
  assert.match(m, /api\.onStudio\?\./);
  for (const a of ['st-make', 'st-cancel', 'st-again', 'st-save', 'st-send', 'st-animate', 'unc-on']) assert.ok(m.includes(`case '${a}'`), a);
  const p = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  for (const f of ['studioList', 'studioAdd', 'studioCancel', 'studioPickImage', 'studioToAttach', 'onStudio']) assert.ok(p.includes(`${f}:`), f);
});

test('the request carries what was typed when it comes from the kept form (2.2.1: "Say what the picture should show" with a prompt typed)', () => {
  const r = requestFrom({ kind: 'image', prompt: ' a red fox in snow ', size: '1024x1024', count: 2, negative: 'blurry', seed: '', steps: '' });
  assert.equal(r.prompt, 'a red fox in snow');
  assert.equal(r.size, '1024x1024');
  assert.equal(r.count, 2);
  assert.equal(r.negative, 'blurry');
  const v = requestFrom({ kind: 'video', prompt: 'a lamp', start: 'item:c3' });
  assert.equal(v.prompt, 'a lamp');
  assert.equal(v.start, 'item:c3');
});

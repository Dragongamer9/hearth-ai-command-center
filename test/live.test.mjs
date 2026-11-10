// 2.9 Live view: every AI has its own core shape, colour and talking motion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CORES, GROUPS, LIVE_AIS, coreHtml, coreOf, liveStageHtml, miniCore } from '../src/live.mjs';
import { AGENTS } from '../src/registry.mjs';

test('every AI on the Live screen is a real AI with its own core', () => {
  for (const a of LIVE_AIS) { assert.ok(AGENTS[a], `${a} is in the registry`); assert.ok(CORES[a], `${a} has a core`); }
  const grouped = GROUPS.flatMap((g) => g[2]);
  for (const a of [...LIVE_AIS, 'comfy', 'voice', 'listen']) assert.ok(grouped.includes(a), `${a} has a place on the screen`);
});

test('all cores look different and talk differently', () => {
  const v = Object.values(CORES);
  assert.equal(new Set(v.map((c) => c.shape)).size, v.length, 'shapes are unique');
  assert.equal(new Set(v.map((c) => c.rgb)).size, v.length, 'colours are unique');
  assert.equal(new Set(v.map((c) => c.talk.split(' ')[0])).size, v.length, 'talking motions are unique');
  for (const c of v) assert.equal(c.talk.trim().split(/\s+/).length, 3, `one name, one time, one timing: ${c.talk}`);
});

test('a speaking core pulses rings and uses its own talking motion; a ready one does not', () => {
  const sp = coreHtml({ id: 'xai', name: 'Grok', size: 96, state: 'speaking', status: 'speaking' });
  assert.match(sp, /class="emit"/);
  assert.match(sp, /animation:tGlitch/);
  assert.match(sp, /iris talk/);
  const rd = coreHtml({ id: 'xai', name: 'Grok', size: 96, state: 'ready', status: 'ready' });
  assert.doesNotMatch(rd, /emit/);
  assert.doesNotMatch(rd, /animation:tGlitch/);
});

test('names and lines are escaped', () => {
  const h = liveStageHtml({ who: [{ id: 'anthropic', name: '<b>x</b>', state: 'ready', status: '"q"', big: true }], caption: { id: 'anthropic', name: 'C', line: '<script>alert(1)</script>', note: '' }, chatTitle: '<i>t</i>', counts: { total: 1, working: 0 }, canTalk: true });
  assert.doesNotMatch(h, /<script>|<b>x<\/b>|<i>t<\/i>/);
  assert.match(h, /&lt;script&gt;/);
  assert.match(h, /data-a="talk"/);
  assert.doesNotMatch(liveStageHtml({ who: [], caption: { id: 'openai', name: 'C', line: 'hi' }, chatTitle: '', counts: { total: 0, working: 0 }, canTalk: false }), /data-a="talk"/);
});

test('unknown ids get a safe fallback and mini cores stay small', () => {
  assert.ok(coreOf('nope').shape);
  assert.match(miniCore('openai', 'Codex', 34), /class="core mini ready"/);
  assert.match(miniCore('openai', 'Codex', 34), /width:34px/);
});

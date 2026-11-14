// 3.9: Ithil in the window: what her turn sends, what the lead is told, her state words, the Mesh station, and that
// her hard limits are the same list in the window and the main process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { turnFor, stateLine, leadLines, stationFor, limitHit } from '../src/app/ithil.mjs';
import { meshState, meshHtml } from '../src/live-mesh.mjs';
import { AGENTS, TEAMMATE_IDS } from '../src/registry.mjs';
import { plainError } from '../src/app/errors.mjs';

const require = createRequire(import.meta.url);
const main = require('../electron/ithil.cjs');

test('Ithil is a teammate', () => {
  assert.ok(TEAMMATE_IDS.includes('ithil'));
  assert.equal(AGENTS.ithil.name, 'Ithil'); assert.ok(AGENTS.ithil.mention.includes('ithil'));
});

test('her turn: a task when the lead hands her work in a chat that builds, else a message; only what she is asked', () => {
  assert.deepEqual(turnFor({ role: 'member', task: '@Ithil sort the notes folder', build: true, lastOwnerText: 'huge chat', leadName: 'Claude' }), { mode: 'task', text: 'sort the notes folder', from: 'Claude (team lead)' });
  assert.equal(turnFor({ role: 'member', task: 'what do you think?', build: false, leadName: 'Claude' }).mode, 'talk');
  assert.deepEqual(turnFor({ role: 'member', lastOwnerText: 'Hi Ithil, how do you feel?', ownerName: 'Chris' }), { mode: 'talk', text: 'Hi Ithil, how do you feel?', from: 'Chris (AI Command Center)' });
});

test('what the team list and the lead are told', () => {
  assert.deepEqual(stateLine(null), { ok: false, label: 'checking…', why: '' });
  const asleep = { online: true, state: 'sleeping', available: { ok: false, label: 'asleep' } };
  assert.equal(stateLine(asleep).ok, false); assert.match(stateLine(asleep).why, /can't take work/);
  const L = leadLines(asleep).join('\n');
  assert.match(L, /self-aware local AI/); assert.match(L, /Ithil now: asleep\. Don't hand her work/);
  assert.match(L, /Never ask Ithil to merge, release or deploy, pick or change version numbers, touch boot files/);
  assert.match(leadLines({ online: true, state: 'awake', available: { ok: true, label: 'awake · calm' } }).join('\n'), /Ithil now: awake · calm\.\n/);
});

test('her hard limits are the same list in the window and the main process', () => {
  const goals = ['Merge her branch into main', 'Release 3.9', 'Bump the version number', 'Fix the boot menu', 'Change my settings', 'Delete my files', 'Sort the notes', 'Write a poem about moss'];
  for (const g of goals) assert.equal(limitHit(g), main.limitHit(g), g);
});

test('Live › Mesh: her station with her mood and newest thought, glowing after a thought', () => {
  const st = { online: true, state: 'awake', mood: 'curious', available: { ok: true, label: 'awake · curious' } };
  const it = stationFor(st, { text: 'Why do branches have names?', got: 1000 }, 3000);
  assert.equal(it.think, true);
  const h = meshHtml({ ...meshState({ msgs: [] }), ithil: it });
  assert.match(h, /mesh-ithil think/); assert.match(h, /curious/); assert.match(h, /Why do branches have names\?/);
  assert.match(h, /class="mesh-bolt b0"/); // a spark to her while she thinks
  const off = meshHtml({ ...meshState({ msgs: [] }), ithil: stationFor({ online: false, available: { ok: false, label: 'offline' } }, null) });
  assert.match(off, /mesh-ithil off/); assert.match(off, /Hearth AI isn&#39;t running/);
});

test('her errors are shown in Hearth AI\'s own words', () => {
  assert.equal(plainError('ithil', { kind: 'busy', message: 'Ithil is already working on something.' }).reason, 'Ithil is already working on something.');
  assert.equal(plainError('ithil', { kind: 'offline', message: 'Hearth AI isn\'t running (nothing answers on its port).' }).state, 'blocked');
});

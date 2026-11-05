// Roleplay in the window (src/app/roleplay.mjs): lorebook keywords and budget, group turn
// order, swipes, the character's brief, and adult content kept from the other AIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activateLore, nextSpeakers, addSwipe, moveSwipe, rpPrompt, storyText, SEXUAL, RP_LIMITS, fill, spriteFor } from '../src/app/roleplay.mjs';

const book = { name: 'North', scan_depth: 2, token_budget: 30, entries: [
  { keys: ['Emberfall'], content: 'Emberfall is the old capital of the north.', insertion_order: 20 },
  { keys: ['dragon'], content: 'Dragons sleep under the mountain.', insertion_order: 10 },
  { keys: [], content: 'Winter never ends.', constant: true, insertion_order: 50 },
  { keys: ['ghost'], content: 'off', enabled: false },
  { keys: ['/wol(f|ves)/i'], content: 'Wolves guard the pass.', insertion_order: 30 },
] };
const msg = (text, who = 'owner') => ({ who, text });

test('lorebook: keywords in the recent messages activate entries; constant ones always; scan depth; budget', () => {
  const a = activateLore([book], [msg('Tell me about Emberfall.')]);
  assert.deepEqual(a.map((e) => e.content), ['Emberfall is the old capital of the north.', 'Winter never ends.']);
  assert.deepEqual(activateLore([book], [msg('a dragon!'), msg('x'), msg('y')]).map((e) => e.content), ['Winter never ends.'], 'outside the scan depth (2)');
  assert.ok(activateLore([book], [msg('the wolves howl')]).some((e) => /Wolves/.test(e.content)), 'regex keys');
  assert.ok(!activateLore([book], [msg('a ghost')]).some((e) => e.content === 'off'), 'disabled entries never');
  assert.ok(!activateLore([book], [msg('Emberfallen')]).some((e) => /capital/.test(e.content)), 'whole words only');
  const all = activateLore([book], [msg('Emberfall dragon wolves')], { budget: 22 });
  assert.ok(all.reduce((n, e) => n + Math.ceil(e.content.length / 4), 0) <= 22, 'within the token budget');
  assert.ok(all.some((e) => e.constant), 'constant entries are picked first, before the budget runs out');
  assert.ok(!all.some((e) => /capital/.test(e.content)), 'what doesn\'t fit is left out');
});

test('group turn order: named characters reply (in order named), else the next one; "in order"; forced', () => {
  const cards = [{ id: 'a', name: 'Mira Vale' }, { id: 'b', name: 'Tobin' }, { id: 'c', name: 'Ash' }];
  assert.deepEqual(nextSpeakers({ cards, text: 'Tobin, then Mira: what now?' }), ['b', 'a']);
  assert.deepEqual(nextSpeakers({ cards, text: '@Ash help' }), ['c']);
  assert.deepEqual(nextSpeakers({ cards, text: 'what now?', lastSpeaker: 'a' }), ['b'], 'the next one after the last speaker');
  assert.deepEqual(nextSpeakers({ cards, text: 'go', lastSpeaker: 'c' }), ['a']);
  assert.deepEqual(nextSpeakers({ cards, order: 'list', text: 'go' }), ['a', 'b', 'c']);
  assert.deepEqual(nextSpeakers({ cards, text: 'Tobin?', forced: 'c' }), ['c'], 'the owner picked who replies');
  assert.deepEqual(nextSpeakers({ cards: [cards[0]], text: 'hi' }), ['a']);
});

test('swipes: a new reply is added and selected; ← → move through them', () => {
  let m = { id: 'm', text: 'one' };
  m = addSwipe(m, 'two');
  assert.deepEqual([m.swipes, m.sw, m.text], [['one', 'two'], 1, 'two']);
  m = moveSwipe(m, -1);
  assert.deepEqual([m.sw, m.text], [0, 'one']);
  m = moveSwipe(m, -1);
  assert.equal(m.sw, 0, 'stays at the first');
  m = addSwipe(moveSwipe(m, 1), 'three');
  assert.deepEqual([m.swipes.length, m.text], [3, 'three']);
});

test('every character\'s brief carries the hard limits; a card that reads as under 18 says so', () => {
  const card = { id: 'a', name: 'Mira', description: '{{char}} meets {{user}}.', mes_example: '' };
  const p = rpPrompt({ card, cards: [card], persona: { name: 'Drake' }, messages: [msg('hi')], lore: [{ content: 'Winter never ends.' }], limits: { minor: true } });
  assert.ok(p.includes(RP_LIMITS));
  assert.match(p, /Mira reads as under 18: keep everything with Mira non-sexual/);
  assert.match(p, /Mira meets Drake/, '{{char}} and {{user}} are filled in');
  assert.match(p, /WORLD INFO[\s\S]*Winter never ends/);
  assert.equal(fill('<USER> and {{char}}', { char: 'A', user: 'B' }), 'B and A');
  assert.match(rpPrompt({ card, cards: [card], messages: [], mode: 'impersonate' }), /Write only You's next line/);
});

test('adult roleplay lines never reach Claude, ChatGPT or Gemini; the uncensored player sees the story', () => {
  const cards = [{ id: 'a', name: 'Mira' }];
  const story = [msg('hello'), { who: 'venice', char: 'a', text: 'explicit scene', media: [{ kind: 'image', name: 'p.png' }] }, { who: 'owner', text: 'a nude scene', to: ['venice'] }];
  const forClaude = storyText(story, { cards, persona: { name: 'Drake' }, forAgent: 'anthropic' });
  assert.doesNotMatch(forClaude, /explicit scene|nude scene/);
  assert.match(forClaude, /Mira: \[image by an uncensored teammate, not shown\]/);
  assert.match(forClaude, /Drake: \[line kept for an uncensored teammate, not shown\]/);
  assert.match(storyText(story, { cards, forAgent: 'venice' }), /explicit scene/);
});

test('the window\'s adult-word list is the same as the main process\'s', () => {
  const src = readFileSync(new URL('../electron/cards.cjs', import.meta.url), 'utf8');
  const m = src.match(/const SEXUAL = (\/.*\/i);/);
  assert.ok(m);
  assert.equal(m[1], String(SEXUAL));
});

test('visual novel: the expression sprite that fits the reply', () => {
  const card = { spriteUrls: { happy: 'x', sad: 'y', neutral: 'z' } };
  assert.equal(spriteFor(card, 'She looks sad today.'), 'sad');
  assert.equal(spriteFor(card, 'Hello.'), 'neutral');
  assert.equal(spriteFor({}, 'x'), null);
});

// Find and replace in the character editor, and the Characters list search (src/app/card-find.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIND_FIELDS, findRegex, findIn, searchFields, stepIndex, replaceAt, replaceAllIn, replaceAllFields, snippet, cardMatches, matchedIn } from '../src/app/card-find.mjs';

const fields = [
  { key: 'name', label: 'Name', text: 'Mira' },
  { key: 'description', label: 'Description', text: 'Mira has silver hair. Silver eyes, a silvery cloak.' },
  { key: 'first_mes', label: 'First message', text: '*Mira waves.* "Hello, {{user}}!"' },
  { key: 'tags', label: 'Tags', text: 'fantasy, silver' },
];

test('every card text field is searched, in the editor order', () => {
  assert.deepEqual(FIND_FIELDS.map(([k]) => k), ['name', 'description', 'personality', 'scenario', 'first_mes', 'alternate_greetings', 'mes_example', 'system_prompt', 'post_history_instructions', 'creator_notes', 'appearance', 'tags']);
});

test('matches: case, whole word, literal text, counts per field', () => {
  assert.equal(findIn('Silver silver SILVER silvery', 'silver').length, 4);
  assert.equal(findIn('Silver silver SILVER silvery', 'silver', { matchCase: true }).length, 2);
  assert.equal(findIn('Silver silver SILVER silvery', 'silver', { wholeWord: true }).length, 3);
  assert.equal(findIn('Silver silver SILVER silvery', 'silver', { wholeWord: true, matchCase: true }).length, 1);
  assert.deepEqual(findIn('a.b axb', 'a.b'), [{ start: 0, end: 3 }], 'regex characters are literal');
  assert.equal(findIn('Hello, {{user}}!', '{{user}}').length, 1);
  assert.equal(findIn('élan Élan', 'élan', { wholeWord: true }).length, 2, 'unicode words');
  assert.equal(findRegex(''), null);
  assert.deepEqual(findIn('abc', ''), []);
  const r = searchFields(fields, 'silver');
  assert.equal(r.total, 4);
  assert.deepEqual(r.fields.map((f) => f.count), [0, 3, 0, 1]);
  assert.deepEqual(r.flat[0], { key: 'description', start: 9, end: 15 });
  assert.equal(r.flat.at(-1).key, 'tags');
});

test('next / previous wrap around (Enter, Shift+Enter, F3)', () => {
  assert.equal(stepIndex(-1, 5, 1), 0);
  assert.equal(stepIndex(4, 5, 1), 0);
  assert.equal(stepIndex(0, 5, -1), 4);
  assert.equal(stepIndex(-1, 5, -1), 4);
  assert.equal(stepIndex(2, 0, 1), -1);
});

test('replace one and replace all are literal and only touch matches', () => {
  assert.equal(replaceAt('Mira has silver hair', { start: 9, end: 15 }, 'golden'), 'Mira has golden hair');
  assert.equal(replaceAt('abc', { start: 5, end: 9 }, 'x'), 'abc', 'out of range changes nothing');
  assert.deepEqual(replaceAllIn('Silver silver silvery', 'silver', 'gold', { wholeWord: true }), { text: 'gold gold silvery', count: 2 });
  assert.deepEqual(replaceAllIn('a b', 'a', '$&$1'), { text: '$&$1 b', count: 1 }, '$ patterns stay literal');
  const all = replaceAllFields(fields, 'silver', 'golden');
  assert.equal(all.count, 4);
  assert.deepEqual(all.changed, ['description', 'tags']);
  assert.equal(all.fields.find((f) => f.key === 'description').text, 'Mira has golden hair. golden eyes, a goldeny cloak.');
  assert.equal(fields[1].text, 'Mira has silver hair. Silver eyes, a silvery cloak.', 'the input is never changed in place');
  assert.equal(replaceAllFields(fields, '', 'x').count, 0);
});

test('a snippet around a match for highlighting', () => {
  const s = snippet('The quick brown fox jumps over the lazy dog and keeps running far away', { start: 16, end: 19 }, 10);
  assert.equal(s.hit, 'fox');
  assert.ok(s.before.startsWith('…'));
  assert.ok(s.after.endsWith('…'));
});

test('Characters list search: names, tags and description text', () => {
  const c = { name: 'Dilya Perbella', tags: ['fantasy', 'elf'], description: 'A high elf knight with a silver sword.' };
  assert.equal(cardMatches(c, ''), true);
  assert.equal(cardMatches(c, 'dilya'), true);
  assert.equal(cardMatches(c, 'ELF'), true);
  assert.equal(cardMatches(c, 'silver sword'), true);
  assert.equal(cardMatches(c, 'silver dragon'), false, 'every word must appear');
  assert.equal(cardMatches({ name: 'X', personality: 'silver' }, 'silver'), false, 'only names, tags and description');
  assert.deepEqual(matchedIn(c, 'knight fantasy'), ['description', 'tags']);
});

test('the editor wires Find: Ctrl+F, F3, Enter/Shift+Enter, options, replace, unsaved only', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /ev\.key\.toLowerCase\(\) === 'f'\) \{ ev\.preventDefault\(\); cfOpen\(\)/);
  assert.match(main, /ev\.key === 'F3'\) \{ ev\.preventDefault\(\); cfStep\(ev\.shiftKey \? -1 : 1\)/);
  assert.match(main, /id="cf-case"/);
  assert.match(main, /id="cf-word"/);
  assert.match(main, /data-a="cf-rep1">Replace</);
  assert.match(main, /data-a="cf-repall">Replace all</);
  assert.match(main, /nothing is saved until you press Save/i);
  for (const k of ['system_prompt', 'post_history_instructions', 'appearance']) assert.match(main, new RegExp(`data-cf="?\\$?\\{?k?\\}?"?|f\\('${k}'|data-cf="${k}"`));
  // The find helpers never call the save functions.
  const helpers = main.slice(main.indexOf('// ---------- character editor: Find and replace'), main.indexOf('// ---------- Characters: collections'));
  assert.doesNotMatch(helpers, /call\('cards/);
});

// A false "under 18" alarm can be cleared by the owner confirming the character's adult age;
// a card that itself says minor can never be.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { cardLimits, checkRequest, createCards } = require('../electron/cards.cjs');

const card = (o) => ({ name: 'Mira', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', creator_notes: '', alternate_greetings: [], tags: [], extensions: {}, ...o });

test('"16 years ago" and "for 10 years" are not ages', () => {
  assert.equal(cardLimits(card({ description: 'She left the capital 16 years ago and has fought for 10 years.' })).minor, false);
  assert.equal(cardLimits(card({ description: 'She is 16 years old.' })).minor, true);
  assert.equal(cardLimits(card({ description: 'a 15-year-old squire' })).minor, true);
});

test('a word in the text is a soft flag the owner can clear with an adult age', () => {
  const c = card({ description: 'A 30 year old teacher at a middle school who has two kids.' });
  const l = cardLimits(c);
  assert.equal(l.minor, true);
  assert.equal(l.hard, false);
  assert.equal(l.canConfirmAdult, true);
  const ok = cardLimits({ ...c, ownerAdult: { age: 30 } });
  assert.equal(ok.minor, false);
  assert.equal(ok.adultConfirmed.age, 30);
  assert.equal(checkRequest({ cards: [{ ...c, ownerAdult: { age: 30 } }], text: 'a sexy scene' }).ok, true);
  assert.equal(checkRequest({ cards: [c], text: 'a sexy scene' }).ok, false);
});

test('a card that itself says minor can never be confirmed adult', () => {
  for (const c of [card({ tags: ['loli'] }), card({ extensions: { age: 15 } }), card({ description: 'She is a shota fan', tags: [] }), card({ tags: ['teen'] }), card({ description: 'underage elf' })]) {
    const l = cardLimits({ ...c, ownerAdult: { age: 500 } });
    assert.equal(l.minor, true, JSON.stringify(c));
    assert.equal(l.hard, true);
    assert.equal(l.canConfirmAdult, false);
    assert.equal(checkRequest({ cards: [{ ...c, ownerAdult: { age: 500 } }], text: 'nsfw' }).ok, false);
  }
});

test('the store refuses hard cards and ages under 18, keeps the confirmation out of exported files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adult-'));
  const store = createCards({ dataDir: dir });
  const soft = store.save({ name: 'Ana', description: 'Runs the tavern; her kids help out. 34 years old.' });
  assert.throws(() => store.confirmAdult(soft.id, 17), /18 or more/);
  const ok = store.confirmAdult(soft.id, 34);
  assert.equal(ok.limits.minor, false);
  assert.equal(ok.limits.adultConfirmed.age, 34);
  const ex = store.exportCard(soft.id, 'json').buf.toString('utf8');
  assert.doesNotMatch(ex, /ownerAdult/);
  const undone = store.confirmAdult(soft.id, 0, false);
  assert.equal(undone.limits.minor, true);
  const hard = store.save({ name: 'Kit', description: 'x', tags: ['loli'] });
  assert.throws(() => store.confirmAdult(hard.id, 300), /can't be confirmed/);
  fs.rmSync(dir, { recursive: true, force: true });
});

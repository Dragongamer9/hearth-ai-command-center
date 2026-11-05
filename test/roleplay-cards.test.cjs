// Roleplay (electron/cards.cjs): Character Card V1/V2/V3 from JSON and PNG, export round
// trips, embedded lorebooks, the built-in hard limits, and atomic storage with backups.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const C = require('../electron/cards.cjs');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-cards-')); made.push(d); return d; };

const V2 = { spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Mira', description: 'A ranger of the north woods, 27 years old.', personality: 'calm', scenario: 'A campfire.', first_mes: 'Hello, {{user}}.', mes_example: '<START>\n{{char}}: Hi', creator_notes: 'by me', system_prompt: '', post_history_instructions: '', alternate_greetings: ['Evening.', 'You again?'], tags: ['fantasy', 'ranger'], creator: 'Dragongamer9', character_version: '1', extensions: { depth: 1 }, character_book: { name: 'North', scan_depth: 3, token_budget: 500, entries: [{ keys: ['Emberfall'], content: 'Emberfall is the old capital.', enabled: true, insertion_order: 10, constant: false, id: 1 }, { keys: [], content: 'Winter never ends.', enabled: true, insertion_order: 5, constant: true, id: 2 }] } } };

test('V1, V2 and V3 cards from JSON', () => {
  const v1 = C.readCardFile('a.json', Buffer.from(JSON.stringify({ name: 'Old', description: 'd', personality: 'p', scenario: 's', first_mes: 'f', mes_example: 'm' }))).card;
  assert.equal(v1.source, 'v1'); assert.equal(v1.first_mes, 'f');
  const old = C.normalizeCard({ char_name: 'Tav', char_persona: 'x', char_greeting: 'hey' });
  assert.equal(old.name, 'Tav'); assert.equal(old.first_mes, 'hey');
  const v2 = C.readCardFile('b.json', Buffer.from(JSON.stringify(V2))).card;
  assert.equal(v2.source, 'v2'); assert.deepEqual(v2.alternate_greetings, ['Evening.', 'You again?']); assert.deepEqual(v2.tags, ['fantasy', 'ranger']);
  assert.equal(v2.character_book.entries.length, 2, 'embedded lorebook kept');
  const v3 = C.readCardFile('c.json', Buffer.from(JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { ...V2.data, assets: [{ type: 'emotion', name: 'happy', uri: 'data:image/png;base64,iVBORw0KGgo=' }, { type: 'icon', name: 'main', uri: 'ccdefault:' }] } }))).card;
  assert.equal(v3.source, 'v3'); assert.equal(v3.assets.length, 1, 'only inline pictures are taken');
  assert.throws(() => C.readCardFile('x.json', Buffer.from('{"foo":1}')), /character card/);
});

test('PNG cards: chara (V2) and ccv3 (V3) chunks are read; export round-trips', () => {
  const png = C.withPngText(C.plainPng(8), { chara: C.b64(V2) });
  assert.equal(C.readCardFile('m.png', png).card.name, 'Mira');
  const v3png = C.withPngText(C.plainPng(8), { chara: C.b64({ ...V2, data: { ...V2.data, name: 'Old copy' } }), ccv3: C.b64({ spec: 'chara_card_v3', spec_version: '3.0', data: { ...V2.data, name: 'Newer' } }) });
  assert.equal(C.readCardFile('n.png', v3png).card.name, 'Newer', 'V3 wins when both are present');
  assert.throws(() => C.readCardFile('p.png', C.plainPng(8)), /no character card/);
  // export → import keeps every field
  const d = tmp();
  const store = C.createCards({ dataDir: d });
  const a = store.importFile('m.png', png).card;
  for (const fmt of ['png', 'json']) {
    const x = store.exportCard(a.id, fmt);
    const back = C.readCardFile(x.name, x.buf).card;
    for (const k of ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'creator']) assert.equal(back[k], V2.data[k], `${fmt} ${k}`);
    assert.deepEqual(back.alternate_greetings, V2.data.alternate_greetings);
    assert.deepEqual(back.tags, V2.data.tags);
    assert.equal(back.character_book.entries.length, 2, `${fmt}: lorebook`);
  }
  const t = C.pngText(store.exportCard(a.id, 'png').buf);
  assert.equal(JSON.parse(Buffer.from(t.chara, 'base64')).spec, 'chara_card_v2');
  assert.equal(JSON.parse(Buffer.from(t.ccv3, 'base64')).spec, 'chara_card_v3');
});

test('lorebooks: embedded ones import; standalone character_book and world-info JSON import and export', () => {
  const d = tmp();
  const store = C.createCards({ dataDir: d });
  const fromCard = store.importBook('card.json', Buffer.from(JSON.stringify(V2)));
  assert.equal(fromCard.entries.length, 2);
  const wi = store.importBook('world.json', Buffer.from(JSON.stringify({ entries: { 0: { uid: 0, key: ['dragon'], keysecondary: [], content: 'Dragons sleep.', order: 50, constant: false, disable: false }, 1: { uid: 1, key: ['x'], content: 'off', disable: true } } })));
  assert.deepEqual(wi.entries.map((e) => [e.keys[0], e.insertion_order, e.enabled]), [['dragon', 50, true], ['x', 100, false]]);
  const out = JSON.parse(store.exportBook(wi.id).buf.toString());
  assert.equal(out.entries[0].content, 'Dragons sleep.');
  // a dropped lorebook JSON is recognised as a lorebook, not a card
  assert.ok(store.importFile('w.json', Buffer.from(JSON.stringify({ name: 'W', entries: [{ keys: ['a'], content: 'b' }] }))).lorebook);
});

test('HARD LIMIT: cards that read as under 18 (age fields, description words, tags) are blocked from sexual text and pictures', () => {
  const base = V2.data;
  const cases = [
    { ...base, extensions: { age: 16 } },
    { ...base, description: 'She is 15 years old.' },
    { ...base, description: 'A shy teenager.' },
    { ...base, description: 'a little girl' },
    { ...base, tags: ['loli'] },
    { ...base, tags: ['Shota'] },
    { ...base, description: 'An underage student.' },
  ].map((d) => C.normalizeCard({ spec: 'chara_card_v2', data: d }));
  for (const c of cases) {
    const l = C.cardLimits(c);
    assert.equal(l.minor, true, JSON.stringify([c.description, c.tags, c.extensions]));
    const t = C.checkRequest({ cards: [c], text: 'she undresses, nude' });
    assert.equal(t.ok, false); assert.equal(t.kind, 'minor'); assert.match(t.message, /under 18/);
    const i = C.checkRequest({ cards: [c], text: 'a nude portrait', image: true });
    assert.equal(i.ok, false); assert.match(i.message, /no sexual pictures/);
    const story = C.checkRequest({ cards: [c], text: 'they explore the forest' });
    assert.equal(story.ok, true, 'still fine for non-sexual stories'); assert.equal(story.safe, true, 'pictures go with safe mode on');
  }
  const adult = C.normalizeCard(V2);
  assert.equal(C.cardLimits(adult).minor, false, '27 years old is an adult');
  assert.equal(C.cardLimits(C.normalizeCard({ spec: 'chara_card_v2', data: { ...base, description: 'Eighteen and thirty-year-old' } })).minor, false, '"eighteen" is not "teen"');
  assert.equal(C.checkRequest({ cards: [adult], text: 'nude' }).ok, true, 'fictional adults: no extra filtering');
  const real = C.normalizeCard({ spec: 'chara_card_v2', data: { ...base, tags: ['celebrity'] } });
  assert.equal(C.checkRequest({ cards: [real], text: 'naked' }).kind, 'real');
});

test('cards and lorebooks are saved atomically with a .bak, and an unreadable file is never overwritten', () => {
  const d = tmp();
  const store = C.createCards({ dataDir: d });
  assert.equal(fs.existsSync(path.join(d, 'characters.json')), false, 'nothing written on first run');
  store.list(); store.bookList(); store.persona();
  assert.deepEqual(fs.readdirSync(d), [], 'reading writes nothing');
  const a = store.add(C.normalizeCard(V2));
  store.save({ ...a, name: 'Mira II' });
  assert.ok(fs.existsSync(path.join(d, 'characters.json.bak')), 'previous copy kept');
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'characters.json.bak'), 'utf8')).cards[0].name, 'Mira');
  store.saveBook({ name: 'B', entries: [] }); store.saveBook({ name: 'C', entries: [] });
  assert.ok(fs.existsSync(path.join(d, 'lorebooks.json.bak')));
  fs.writeFileSync(path.join(d, 'characters.json'), '{broken');
  const again = C.createCards({ dataDir: d });
  assert.throws(() => again.add(C.normalizeCard(V2)), /could not be read/);
  assert.equal(fs.readFileSync(path.join(d, 'characters.json'), 'utf8'), '{broken', 'left exactly as it was');
  assert.equal(again.list()[0].name, 'Mira', 'its last good copy (.bak) is shown read-only');
});

test('no code from other roleplay apps: none of the app\'s source names one or carries its licence', () => {
  const roots = ['src', 'electron'].map((r) => path.join(__dirname, '..', r));
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'vendor') walk(f); } else if (/\.(c?js|mjs|css|html)$/.test(e.name)) files.push(f); } };
  roots.forEach(walk);
  // src/app/credits.mjs lists the licence of a speech server the app only reaches over HTTP
  // (chatterbox-tts-api); it is the one file allowed to name it, and it holds no code from it.
  const credits = path.join(__dirname, '..', 'src', 'app', 'credits.mjs');
  for (const f of files) { const t = fs.readFileSync(f, 'utf8'); assert.doesNotMatch(t, f === credits ? /sillytavern|silly tavern|tavernai/i : /sillytavern|silly tavern|tavernai|GNU Affero|AGPL/i, f); }
  assert.match(fs.readFileSync(credits, 'utf8'), /chatterbox-tts-api[\s\S]*AGPL-3\.0[\s\S]*only talks to it over HTTP/);
});

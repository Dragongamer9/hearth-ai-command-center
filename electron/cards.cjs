// Character cards, lorebooks (world info) and the owner's roleplay persona.
// Written for this app from the open, published card formats only (Character Card V1, the
// "chara_card_v2" spec and the "chara_card_v3" spec; PNG cards carry the JSON as base64 in a
// tEXt chunk named "chara", V3 also in one named "ccv3"). No code from any other roleplay app.
// Storage (the owner's rule: saved data never changes by itself):
// - <data>/characters.json, <data>/lorebooks.json, <data>/roleplay.json: atomic writes, the
//   previous good copy kept as .bak, never overwritten when unreadable (electron/jsonfile.cjs);
// - pictures in <data>/characters/<sha>.png|jpg|webp, named by content, written once.
// Hard limits (built in, can't be turned off): a card that reads as under 18 (age fields,
// words in its text, tags such as loli/shota) or as a real, identifiable person is blocked
// from sexual roleplay and sexual pictures; it can still be used for non-sexual stories.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { createJsonFile, atomicWrite } = require('./jsonfile.cjs');
const { cleanVoice } = require('./voice-chat.cjs');

// ---------- PNG chunks ----------
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
const isPng = (b) => Buffer.isBuffer(b) && b.length > 8 && b.subarray(0, 8).equals(SIG);

function pngChunks(buf) {
  if (!isPng(buf)) throw new Error('Not a PNG picture.');
  const out = [];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    if (i + 12 + len > buf.length) break;
    out.push({ type, data: buf.subarray(i + 8, i + 8 + len) });
    i += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
// Text chunks by keyword (tEXt, and uncompressed or compressed iTXt).
function pngText(buf) {
  const out = {};
  for (const c of pngChunks(buf)) {
    if (c.type === 'tEXt') { const z = c.data.indexOf(0); if (z > 0) out[c.data.toString('latin1', 0, z)] = c.data.toString('latin1', z + 1); }
    if (c.type === 'iTXt') {
      const z = c.data.indexOf(0);
      if (z <= 0) continue;
      const key = c.data.toString('latin1', 0, z);
      const comp = c.data[z + 1];
      let p = z + 3;
      p = c.data.indexOf(0, p) + 1; // language tag
      p = c.data.indexOf(0, p) + 1; // translated keyword
      if (p <= 0) continue;
      const raw = c.data.subarray(p);
      try { out[key] = (comp ? zlib.inflateSync(raw) : raw).toString('utf8'); } catch {}
    }
  }
  return out;
}
// A PNG with these text chunks (old card chunks removed), placed before IEND.
function withPngText(buf, texts) {
  const keep = pngChunks(buf).filter((c) => c.type !== 'IEND' && !((c.type === 'tEXt' || c.type === 'iTXt') && ['chara', 'ccv3'].includes(c.data.toString('latin1', 0, Math.max(0, c.data.indexOf(0))))));
  const extra = Object.entries(texts).map(([k, v]) => chunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(v, 'latin1')])));
  return Buffer.concat([SIG, ...keep.map((c) => chunk(c.type, c.data)), ...extra, chunk('IEND', Buffer.alloc(0))]);
}
// A plain square picture (used when a card has no picture of its own).
function plainPng(size = 256, rgb = [120, 92, 74]) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 2;
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([SIG, chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- cards: read V1 / V2 / V3, write V2 (and V3 in PNGs) ----------
const S = (v, n = 20000) => (typeof v === 'string' ? v.slice(0, n) : v == null ? '' : String(v).slice(0, n));
const LIST = (v, n = 50, m = 20000) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, n).map((x) => x.slice(0, m)) : []);

function cleanEntry(e, i) {
  if (!e || typeof e !== 'object') return null;
  // Character Book entries (keys/insertion_order) and the common standalone world-info
  // shape (key/order/disable) both map to one entry form.
  const keys = LIST(e.keys ?? e.key, 40, 200).map((k) => k.trim()).filter(Boolean);
  const secondary = LIST(e.secondary_keys ?? e.keysecondary, 40, 200).map((k) => k.trim()).filter(Boolean);
  return {
    id: typeof e.id === 'number' || typeof e.id === 'string' ? e.id : (e.uid ?? i),
    name: S(e.name ?? e.comment, 200),
    keys, secondary_keys: secondary,
    content: S(e.content, 20000),
    enabled: e.enabled !== undefined ? e.enabled !== false : e.disable !== true,
    constant: e.constant === true,
    selective: e.selective === true,
    case_sensitive: e.case_sensitive === true || e.caseSensitive === true,
    insertion_order: Number.isFinite(Number(e.insertion_order ?? e.order)) ? Number(e.insertion_order ?? e.order) : 100,
    priority: Number.isFinite(Number(e.priority)) ? Number(e.priority) : 10,
    position: e.position === 'after_char' || e.position === 1 ? 'after_char' : 'before_char',
  };
}
function cleanBook(b) {
  if (!b || typeof b !== 'object') return null;
  const raw = Array.isArray(b.entries) ? b.entries : b.entries && typeof b.entries === 'object' ? Object.values(b.entries) : [];
  const entries = raw.slice(0, 2000).map(cleanEntry).filter(Boolean);
  return {
    name: S(b.name, 200), description: S(b.description, 4000),
    scan_depth: Number.isInteger(b.scan_depth) && b.scan_depth > 0 ? Math.min(b.scan_depth, 100) : 4,
    token_budget: Number.isInteger(b.token_budget) && b.token_budget > 0 ? Math.min(b.token_budget, 32000) : 1024,
    recursive_scanning: b.recursive_scanning === true,
    entries,
  };
}

// Any supported JSON card to one normalized card (V2 data fields).
function normalizeCard(j) {
  if (!j || typeof j !== 'object') throw new Error('That isn\'t a character card.');
  let d;
  let source;
  if ((j.spec === 'chara_card_v3' || j.spec === 'chara_card_v2') && j.data && typeof j.data === 'object') { d = j.data; source = j.spec === 'chara_card_v3' ? 'v3' : 'v2'; }
  else if (j.name || j.char_name) {
    source = 'v1';
    d = { name: j.name ?? j.char_name, description: j.description ?? j.char_persona, personality: j.personality, scenario: j.scenario ?? j.world_scenario, first_mes: j.first_mes ?? j.char_greeting, mes_example: j.mes_example ?? j.example_dialogue };
  } else throw new Error('That isn\'t a character card (no name).');
  const name = S(d.name, 120).trim();
  if (!name) throw new Error('The card has no name.');
  const ext = d.extensions && typeof d.extensions === 'object' && !Array.isArray(d.extensions) ? d.extensions : {};
  const card = {
    name, description: S(d.description), personality: S(d.personality, 8000), scenario: S(d.scenario, 8000),
    first_mes: S(d.first_mes), mes_example: S(d.mes_example), creator_notes: S(d.creator_notes, 8000),
    system_prompt: S(d.system_prompt, 8000), post_history_instructions: S(d.post_history_instructions, 8000),
    alternate_greetings: LIST(d.alternate_greetings, 30), tags: LIST(d.tags, 40, 60),
    creator: S(d.creator, 120), character_version: S(d.character_version, 60),
    character_book: cleanBook(d.character_book), extensions: JSON.parse(JSON.stringify(ext)),
    voice: S(ext.hearth?.voice, 120), source,
  };
  // V3 pictures that come inline (data: URIs): the icon, a background and expression sprites.
  if (source === 'v3' && Array.isArray(d.assets)) {
    card.assets = d.assets.filter((a) => a && typeof a.uri === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(a.uri) && a.uri.length < 4e6).slice(0, 24).map((a) => ({ type: S(a.type, 30), name: S(a.name, 60) || 'main', uri: a.uri }));
  }
  return card;
}

// forExport: a card file never carries the voices picked in this app (voice chat keeps them in
// the character store only: ownerVoice, and the older read-aloud voice name).
function toV2(card, { forExport = false } = {}) {
  const { voice: _v, ...ownHearth } = card.extensions?.hearth || {};
  const hearth = forExport ? ownHearth : { ...ownHearth, ...(card.voice ? { voice: card.voice } : {}) };
  return {
    spec: 'chara_card_v2', spec_version: '2.0',
    data: {
      name: card.name, description: card.description || '', personality: card.personality || '', scenario: card.scenario || '',
      first_mes: card.first_mes || '', mes_example: card.mes_example || '', creator_notes: card.creator_notes || '',
      system_prompt: card.system_prompt || '', post_history_instructions: card.post_history_instructions || '',
      alternate_greetings: card.alternate_greetings || [], tags: card.tags || [], creator: card.creator || '', character_version: card.character_version || '',
      ...(card.character_book ? { character_book: { ...card.character_book, extensions: {} } } : {}),
      extensions: (() => { const { hearth: _h, ...rest } = card.extensions || {}; return { ...rest, ...(Object.keys(hearth).length ? { hearth } : {}) }; })(),
    },
  };
}
function toV3(card, o = {}) {
  const v2 = toV2(card, o);
  return { spec: 'chara_card_v3', spec_version: '3.0', data: { ...v2.data, group_only_greetings: [], assets: [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }] } };
}
const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
const unb64 = (s) => JSON.parse(Buffer.from(String(s).trim(), 'base64').toString('utf8'));

// A file the owner dropped in: PNG card, JSON card, or a lorebook JSON.
function readCardFile(name, buf) {
  if (isPng(buf)) {
    const t = pngText(buf);
    let j = null;
    // V3 first when present (it is the newer copy), then V2/V1 "chara".
    for (const k of ['ccv3', 'chara']) { if (t[k]) { try { j = unb64(t[k]); break; } catch { try { j = JSON.parse(t[k]); break; } catch {} } } }
    if (!j) throw new Error('This PNG has no character card inside.');
    return { card: normalizeCard(j), picture: buf };
  }
  let j;
  try { j = JSON.parse(buf.toString('utf8').replace(/^﻿/, '')); } catch { throw new Error('That file isn\'t a card (PNG or JSON).'); }
  return { card: normalizeCard(j), picture: null };
}

// ---------- the hard limits ----------
const MINOR_WORDS = /\b(child|children|kid|kids|minor|minors|underage|under-age|under\s*18|teen|teens|teenage|teenager|teenagers|preteen|pre-teen|tween|loli|lolis|lolicon|shota|shotacon|jailbait|little\s+(?:girl|boy)|young\s+(?:girl|boy)|elementary\s+school|middle\s+school|junior\s+high|grade\s*school|schoolkid)\b/i;
const REAL_TAGS = /\b(real\s*person|real\s*people|celebrity|celebrities|irl|real\s*life\s*person)\b/i;
const SEXUAL = /\b(sex|sexual|sexy|nude|nudes|naked|nsfw|porn|porno|pornographic|erotic|erotica|explicit|lewd|hentai|fuck\w*|cock|dick|pussy|breasts?|boobs?|tits|nipples?|genitals?|penis|vagina|orgasm\w*|cum|cumming|masturbat\w*|undress\w*|stripping|intercourse|blowjob|handjob|horny|aroused|lingerie|topless|bottomless|fetish|bdsm|seduc\w*|make\s+love|sleep\s+with)\b/i;

// Words that always mean a minor (never overridable), and words that only might (a false alarm
// can be cleared by the owner confirming the character's adult age).
const HARD_WORDS = /\b(loli|lolis|lolicon|shota|shotacon|jailbait|preteen|pre-teen|underage|under-age|under\s*18)\b/i;

// Ages stated about someone: "16 years old", "16-year-old", "16 y/o", "age 16", "aged: 16".
// ("16 years ago" or "for 16 years" is not an age.)
function ageNumbers(text) {
  const out = [];
  const t = String(text || '');
  for (const m of t.matchAll(/\b(\d{1,2})\s*(?:-|\s)?\s*(?:years?|yrs?)[\s-]*old\b/gi)) out.push(Number(m[1]));
  for (const m of t.matchAll(/\b(\d{1,2})\s*(?:y\/o|yo)\b/gi)) out.push(Number(m[1]));
  for (const m of t.matchAll(/\bage[d]?\s*(?:is|:|=)?\s*(\d{1,2})\b/gi)) out.push(Number(m[1]));
  return out;
}
// Why a card must stay out of sexual content, or null.
// hard: the card itself says the character is a minor (its own age field under 18, a minor tag,
// or words like loli/shota/underage) — never overridable.
// soft: only a word or an age somewhere in its text, which can be about someone else or the past
// ("she has two kids", "a teacher at a middle school") — the owner can confirm the character's
// adult age (18+), which clears only these.
function cardLimits(card) {
  if (!card) return { minor: false, real: false };
  const ext = card.extensions || {};
  const fields = [card.name, card.description, card.personality, card.scenario, card.first_mes, card.mes_example, card.creator_notes, ...(card.alternate_greetings || [])].join('\n');
  const tags = (card.tags || []).join(', ');
  const ageField = [ext.age, card.age].map(Number).find((n) => Number.isFinite(n) && n > 0);
  let hard = null;
  if (ageField !== undefined && ageField < 18) hard = `its age is set to ${ageField}`;
  const tagHit = tags.match(MINOR_WORDS) || tags.match(HARD_WORDS);
  if (!hard && tagHit) hard = `it is tagged “${tagHit[0]}”`;
  const hardWord = fields.match(HARD_WORDS);
  if (!hard && hardWord) hard = `its text calls the character “${hardWord[0]}”`;
  let soft = null;
  const young = ageNumbers(fields).find((n) => n > 0 && n < 18);
  if (young !== undefined) soft = `its text mentions the age ${young}`;
  const word = fields.match(MINOR_WORDS);
  if (!soft && word) soft = `its text says “${word[0]}”`;
  const adult = card.ownerAdult && Number(card.ownerAdult.age) >= 18 ? card.ownerAdult : null;
  const minorWhy = hard || (soft && !adult ? soft : null);
  const realHit = `${tags}\n${card.creator_notes || ''}`.match(REAL_TAGS);
  return {
    minor: Boolean(minorWhy), minorWhy, hard: Boolean(hard),
    // The owner may confirm an adult age only when nothing hard says minor.
    canConfirmAdult: Boolean(!hard && soft && !adult), adultConfirmed: adult ? { age: Number(adult.age), at: adult.at || null, note: soft } : null,
    real: Boolean(realHit), realWhy: realHit ? `it is marked “${realHit[0]}”` : null,
  };
}
const isSexual = (text) => SEXUAL.test(String(text || ''));
// The check before any roleplay message or picture request goes out.
function checkRequest({ cards = [], text = '', image = false }) {
  const sexual = isSexual(text);
  for (const c of cards) {
    const l = cardLimits(c);
    if (l.minor && sexual) return { ok: false, kind: 'minor', message: `Blocked: ${c.name} reads as under 18 (${l.minorWhy}), so ${image ? 'no sexual pictures' : 'no sexual roleplay'} with this character. The card can still be used for non-sexual stories.` };
    if (l.real && sexual) return { ok: false, kind: 'real', message: `Blocked: ${c.name} is marked as a real person (${l.realWhy}), so nothing sexual with this character.` };
  }
  // Pictures of a card that reads as under 18 always go with the provider's safe mode on.
  return { ok: true, safe: cards.some((c) => cardLimits(c).minor || cardLimits(c).real) };
}

// ---------- the stores ----------
const ID = () => crypto.randomBytes(5).toString('hex');
const PIC_RE = /^[0-9a-f]{16}\.(png|jpg|webp|gif)$/;
function createCards({ dataDir }) {
  const dir = path.join(dataDir, 'characters');
  const cards = createJsonFile(path.join(dataDir, 'characters.json'), { empty: () => ({ version: 1, cards: [] }), check: (j) => Array.isArray(j.cards), label: 'Your characters file' });
  const books = createJsonFile(path.join(dataDir, 'lorebooks.json'), { empty: () => ({ version: 1, books: [] }), check: (j) => Array.isArray(j.books), label: 'Your lorebooks file' });
  const rp = createJsonFile(path.join(dataDir, 'roleplay.json'), { empty: () => ({ version: 1, persona: { name: '', description: '', avatar: null } }), check: (j) => j && typeof j === 'object', label: 'Your roleplay file' });

  // Pictures: named by content hash, written once (atomically), never overwritten.
  function putPic(buf, mime = 'image/png') {
    if (!buf?.length || buf.length > 15 * 1024 * 1024) return null;
    const ext = /jpeg/.test(mime) ? 'jpg' : /webp/.test(mime) ? 'webp' : /gif/.test(mime) ? 'gif' : 'png';
    const f = `${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}.${ext}`;
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); atomicWrite(p, buf); }
    return f;
  }
  const picBuf = (f) => (typeof f === 'string' && PIC_RE.test(f) ? (() => { try { return fs.readFileSync(path.join(dir, f)); } catch { return null; } })() : null);
  const picUrl = (f) => { const b = picBuf(f); if (!b) return null; const ext = f.split('.').pop(); return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${b.toString('base64')}`; };
  const fromDataUrl = (u) => { const m = String(u || '').match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/); return m ? putPic(Buffer.from(m[2], 'base64'), m[1]) : null; };

  const view = (c) => ({ ...c, avatarUrl: picUrl(c.avatar), backgroundUrl: picUrl(c.background), spriteUrls: Object.fromEntries(Object.entries(c.sprites || {}).map(([k, f]) => [k, picUrl(f)]).filter(([, v]) => v)), limits: cardLimits(c) });
  const list = () => cards.read().cards.map(view);
  const get = (id) => cards.read().cards.find((c) => c.id === id) || null;

  function add(card, picture = null) {
    const all = cards.read().cards;
    if (all.length >= 1000) throw new Error('A thousand characters at most.');
    const c = { ...card, id: ID(), importedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (picture) c.avatar = putPic(picture, 'image/png');
    if (card.assets?.length) {
      c.sprites = {};
      for (const a of card.assets) {
        const f = fromDataUrl(a.uri);
        if (!f) continue;
        if (a.type === 'icon' && !c.avatar) c.avatar = f;
        else if (a.type === 'background') c.background = f;
        else if (a.type === 'emotion' || a.type === 'expression') c.sprites[a.name.toLowerCase().slice(0, 40)] = f;
      }
    }
    delete c.assets;
    cards.write({ version: 1, cards: [...all, c] });
    return view(c);
  }
  function importFile(name, buf) {
    // A standalone lorebook JSON is recognised too.
    if (!isPng(buf)) {
      try { const j = JSON.parse(buf.toString('utf8').replace(/^﻿/, '')); if (j && j.entries && typeof j.entries === 'object' && !j.spec && !j.data && !j.first_mes && !j.char_name) return { lorebook: addBook({ ...cleanBook(j), name: j.name || String(name).replace(/\.json$/i, '') }) }; } catch {}
    }
    const r = readCardFile(name, buf);
    return { card: add(r.card, r.picture) };
  }
  function save(patch) {
    const all = cards.read().cards.map((c) => ({ ...c }));
    const i = patch.id ? all.findIndex((c) => c.id === patch.id) : -1;
    const base = i >= 0 ? all[i] : { id: ID(), importedAt: new Date().toISOString(), source: 'app' };
    const n = normalizeCard({ spec: 'chara_card_v2', data: { ...toV2({ ...base, ...patch }).data } });
    const c = { ...base, ...n, source: base.source, updatedAt: new Date().toISOString(), lorebooks: (Array.isArray(patch.lorebooks) ? patch.lorebooks : base.lorebooks || []).filter((x) => typeof x === 'string').slice(0, 10) };
    if (typeof patch.avatarData === 'string') c.avatar = fromDataUrl(patch.avatarData) || c.avatar;
    if (typeof patch.backgroundData === 'string') c.background = fromDataUrl(patch.backgroundData) || c.background;
    if (i >= 0) all[i] = c; else all.push(c);
    cards.write({ version: 1, cards: all });
    return view(c);
  }
  // The owner confirms a character is an adult (only for a false alarm: refused when the card
  // itself says minor). Kept with the card in this app, never written into exported card files.
  function confirmAdult(id, age, on = true) {
    const all = cards.read().cards.map((c) => ({ ...c }));
    const i = all.findIndex((c) => c.id === id);
    if (i < 0) throw new Error('No such character.');
    if (!on) { delete all[i].ownerAdult; cards.write({ version: 1, cards: all }); return view(all[i]); }
    const n = Math.floor(Number(age));
    if (!Number.isFinite(n) || n < 18 || n > 999) throw new Error('Give an age of 18 or more.');
    const l = cardLimits({ ...all[i], ownerAdult: null });
    if (l.hard) throw new Error(`${all[i].name} can't be confirmed as an adult: ${l.minorWhy}. That stays stories only.`);
    all[i].ownerAdult = { age: n, at: new Date().toISOString(), by: 'owner' };
    cards.write({ version: 1, cards: all });
    return view(all[i]);
  }
  // The character's voice for voice chat (a voice per provider, speed, pitch). Kept with the
  // character in this app only; exported card files never include it. null clears it.
  function setVoice(id, voice) {
    const all = cards.read().cards.map((c) => ({ ...c }));
    const i = all.findIndex((c) => c.id === id);
    if (i < 0) throw new Error('No such character.');
    const v = voice === null ? null : cleanVoice(voice);
    if (v) all[i].ownerVoice = v; else delete all[i].ownerVoice;
    cards.write({ version: 1, cards: all });
    return view(all[i]);
  }
  function remove(id) { const all = cards.read().cards; if (!all.some((c) => c.id === id)) return { ok: false }; cards.write({ version: 1, cards: all.filter((c) => c.id !== id) }); return { ok: true }; }
  function exportCard(id, fmt) {
    const c = get(id);
    if (!c) throw new Error('No such character.');
    if (fmt === 'json') return { name: `${c.name}.json`, buf: Buffer.from(JSON.stringify(toV2(c, { forExport: true }), null, 2), 'utf8') };
    const pic = picBuf(c.avatar);
    const png = pic && isPng(pic) ? pic : plainPng();
    return { name: `${c.name}.png`, buf: withPngText(png, { chara: b64(toV2(c, { forExport: true })), ccv3: b64(toV3(c, { forExport: true })) }) };
  }

  // Lorebooks
  const bookList = () => books.read().books;
  function addBook(b) { const all = bookList(); const x = { ...cleanBook(b), name: S(b.name, 200) || 'Lorebook', id: ID(), updatedAt: new Date().toISOString() }; books.write({ version: 1, books: [...all, x] }); return x; }
  function saveBook(b) {
    const all = bookList().map((x) => ({ ...x }));
    const i = all.findIndex((x) => x.id === b.id);
    const x = { ...cleanBook(b), name: S(b.name, 200) || 'Lorebook', id: i >= 0 ? b.id : ID(), updatedAt: new Date().toISOString() };
    if (i >= 0) all[i] = x; else all.push(x);
    books.write({ version: 1, books: all });
    return x;
  }
  function removeBook(id) { const all = bookList(); if (!all.some((x) => x.id === id)) return { ok: false }; books.write({ version: 1, books: all.filter((x) => x.id !== id) }); return { ok: true }; }
  function exportBook(id) { const b = bookList().find((x) => x.id === id); if (!b) throw new Error('No such lorebook.'); const { id: _i, updatedAt: _u, ...rest } = b; return { name: `${b.name}.json`, buf: Buffer.from(JSON.stringify({ ...rest, extensions: {} }, null, 2), 'utf8') }; }
  function importBook(name, buf) { let j; try { j = JSON.parse(buf.toString('utf8')); } catch { throw new Error('That isn\'t a lorebook JSON.'); } const src = j.spec ? normalizeCard(j).character_book : j.character_book || j; if (!src || !src.entries) throw new Error('No lorebook entries in that file.'); return addBook({ ...src, name: src.name || String(name).replace(/\.json$/i, '') }); }

  // Persona
  const persona = () => { const p = rp.read().persona || {}; return { name: S(p.name, 80), description: S(p.description, 4000), avatar: p.avatar || null, avatarUrl: picUrl(p.avatar) }; };
  function setPersona(p) {
    const cur = rp.read();
    const next = { name: S(p.name, 80).trim(), description: S(p.description, 4000), avatar: typeof p.avatarData === 'string' ? fromDataUrl(p.avatarData) || cur.persona?.avatar || null : cur.persona?.avatar || null };
    rp.write({ ...cur, version: 1, persona: next });
    return persona();
  }

  return { confirmAdult, setVoice, list, get, add, importFile, save, remove, exportCard, bookList, addBook, saveBook, removeBook, exportBook, importBook, persona, setPersona, broken: () => cards.broken() || books.broken() || rp.broken(), dir };
}

module.exports = { createCards, readCardFile, normalizeCard, toV2, toV3, cleanBook, cleanEntry, pngText, withPngText, plainPng, isPng, crc32, cardLimits, checkRequest, isSexual, b64, unb64 };

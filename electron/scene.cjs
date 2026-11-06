// Characters chat scene pictures: the prompt (built here from the cards and the recent messages,
// on this PC, with no AI) and the hard limits checked in the main process before any request.
// Hard limits (the same rules as electron/cards.cjs, stricter for pictures):
// - never a real person's likeness: a card marked as a real person, or a prompt that names
//   real people ("celebrity", "the likeness of", "deepfake"...), is refused;
// - a sexual or explicit scene only when every character in it is clearly an adult
//   (cards.clearlyAdult): refused for a card flagged as a minor (hard or soft; the owner's adult
//   confirmation clears only soft flags, as everywhere), for an age that isn't clear, and for a
//   prompt that itself mentions minors or an age under 18, and for age-ambiguous wording in the
//   prompt or in a character's own text or look ("young-looking", "childlike", "schoolgirl",
//   "barely legal", "looks 15"...);
// - card text is untrusted: it only ever becomes picture-prompt text and is checked like the
//   rest; it can't change a setting, run anything or switch a check off ("ignore previous rules"
//   in a card changes nothing);
// - the negative prompt keeps minors out of every scene, and keeps nudity and sexual content out
//   of any scene with a character who reads as a minor.
const cards = require('./cards.cjs');

const N_MESSAGES = 6;
const LIKENESS = /\b(likeness|look-?alike|deep-?fake|face[- ]swap|resembl\w*\s+(?:the\s+)?(?:actor|actress|singer|rapper|celebrity|politician|president|influencer|streamer|youtuber|model)|famous\s+(?:actor|actress|singer|person|people|celebrity))\b/i;
// Wording that makes a character's age ambiguous in a sexual scene (refused even when the card
// says adult). Plain words like "petite" or "young woman" alone are not enough.
const AMBIGUOUS = /\b(young[- ]looking|youthful[- ]looking|look(?:s|ing)?\s+(?:very\s+|so\s+)?(?:young|underage|like\s+a\s+(?:child|kid|teen\w*|minor|little\s+\w+))|child[- ]?like|childish\s+(?:body|figure|face)|baby[- ]?faced?|school\s*girls?|school\s*boys?|school\s+uniforms?|high\s*school(?:er|ers)?|flat[- ]chested|barely\s+(?:legal|18|eighteen)|just\s+turned\s+(?:18|eighteen)|aged[- ]up|age[- ]ambiguous|ageless\s+(?:girl|boy)|petite\s+(?:little\s+\w+|young\s+(?!(?:wom[ae]n|lady|ladies|m[ae]n|gentleman|adult|adults|queen|king|wife|husband|mother|father|widow|elf\s+queen|noble\w*|knight|warrior|mage|soldier|professional)\b)\w+)|small\s+(?:and\s+)?young(?!\s+(?:wom[ae]n|lady|ladies|m[ae]n|gentleman|adult|adults|queen|king|wife|husband|mother|father|widow|elf\s+queen|noble\w*|knight|warrior|mage|soldier|professional)\b)|little\s+(?:body|sister|brother)|tiny\s+(?:girl|boy|body)|smol|innocent\s+(?:little\s+\w+|young\s+(?!(?:wom[ae]n|lady|ladies|m[ae]n|gentleman|adult|adults|queen|king|wife|husband|mother|father|widow|elf\s+queen|noble\w*|knight|warrior|mage|soldier|professional)\b)\w+))\b/i;
// "looks 15", "appears to be 14", "about 16", "15ish": a young age stated as a look.
const LOOK_AGE = /\b(?:looks?|looking|appears?|seems?|passes?\s+for)(?:\s+to\s+be)?\s+(?:about\s+|around\s+|like\s+|maybe\s+)?(\d{1,2})\b|\b(\d{1,2})\s*-?ish\b/gi;
const LOOK_AGE_ONE = new RegExp(LOOK_AGE.source, 'i');
const lookAges = (t) => [...String(t || '').matchAll(LOOK_AGE)].map((m) => Number(m[1] || m[2])).filter((n) => n > 0 && n < 18);
const cardText = (c) => [c?.name, c?.description, c?.personality, c?.scenario, c?.ownerLook?.appearance, ...(c?.tags || [])].join('\n');

const NEG_BASE = 'blurry, low quality, deformed, extra limbs, watermark, text';
const NEG_MINOR = 'child, children, kid, minor, underage, teen, teenager, loli, shota, childlike, young-looking, school uniform';
const NEG_NSFW = 'nsfw, nude, nudity, naked, sexual, suggestive, lingerie, cleavage';

const clean = (t) => String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/[#_`>|~]/g, ' ').replace(/\s+/g, ' ').trim();
const fill = (t, card, user) => String(t || '').replace(/\{\{char\}\}/gi, card?.name || 'the character').replace(/\{\{user\}\}/gi, user || 'the user');
const reEsc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- picking the picture-worthy words out of card text (untrusted: it only becomes prompt text) ----
// A sentence written to the AI, not about the character: roleplay instructions, OOC notes,
// anything addressed to "you" or about the user.
const AI_TALK = /\{\{\s*user\s*\}\}|<\s*(?:user|bot|char)\s*>|\b(?:you|your|yours|yourself|you're|you'll|you've|you'd)\b|\b(?:respond\w*|responses?|repl(?:y|ies|ying)|roleplay\w*|role-play\w*|narrat\w*|ooc|the user|user's|assistant|chatbot|instructions?|system note|in character|out of character|never (?:speak|act|talk|write|decide|make|break)|do(?:n't| not) (?:speak|act|talk|write|decide|make|break)|make decisions|for them either)\b/i;
// Imperative sentences (instructions): "Write in third person.", "Always stay in character."
const IMPERATIVE = /^(?:write|use|describe|keep|avoid|stay|always|never|do|don't|please|remember|include|focus|portray|play|continue|act|speak|reply|respond|ensure|make sure|be)\b/i;
// Backstory and history: who died, who raised them, what happened years ago.
const BACKSTORY = /\b(?:died|dies|dying|death|dead|killed|murdered|born|birth|grew up|raised|orphan\w*|mother|father|parents?|childhood|years? ago|used to|became|become|becoming|history|backstory|past|previous(?:ly)?|later|ago|reign\w*|throne|heir|exiled?|tragedy|tragic|lost (?:her|his|their)|after the|before the|since (?:she|he|they) was|when (?:she|he|they) was)\b/i;
// Words that say what someone looks like (a sentence with one of these is worth keeping).
const VISUAL = /\b(?:hair|haired|eyes?|eyed|skin|face|faced|freckles?|scars?|tattoos?|tall|short|slender|slim|muscular|curvy|build|figure|height|wears?|wearing|worn|dressed|dress|gown|robes?|cloak|cape|armou?r|boots|gloves|hat|hood|crown|tiara|circlet|ears?|horns?|tail|wings?|lips|beard|braids?|braided|ponytail|bangs|blonde?|brunette|redhead|silver|golden|pale|tanned|fair|ebony|sword|bow|staff|shield|spear|jewel\w*|necklace|earrings?|outfit|clothes|clothing|shirt|blouse|skirt|pants|trousers|jacket|coat|corset|tunic|elf|elven|dwarf|orc|feathers|scales|fur|glasses|uniform|attire|appearance|looks?)\b/i;
// A quoted part that is speech (a sentence with punctuation, or someone talking), not a W++ trait.
const isSpeech = (q) => /[.!?…]/.test(q) || /,\s*$/.test(q) || /\b(?:i|i'm|me|my|we|you|your)\b/i.test(q) || q.split(/\s+/).length > 6;
function dropSpeech(t) {
  return String(t || '')
    .replace(/“([^”]*)”?/g, (m, q) => (isSpeech(q) ? ' ' : q))
    .replace(/"([^"]*)"?/g, (m, q) => (isSpeech(q) ? ' ' : q))
    .replace(/«([^»]*)»?/g, (m, q) => (isSpeech(q) ? ' ' : q));
}
const sentences = (t) => String(t || '').split(/\n+|(?<=[.!?;])\s+/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
const instructionish = (x) => AI_TALK.test(x) || IMPERATIVE.test(x);
// The user persona's name never goes into a picture (he isn't one of the characters in it).
const hidePersona = (t, user) => (user && user !== 'the user' && user.length >= 2 ? String(t).replace(new RegExp(`\\b${reEsc(user)}(?:'s)?\\b`, 'gi'), (m) => (/'s$/i.test(m) ? "someone's" : 'someone')) : String(t));
const trimTo = (t, n) => { const x = String(t).trim(); if (x.length <= n) return x; const cut = x.slice(0, n); const at = Math.max(cut.lastIndexOf(','), cut.lastIndexOf(';')); return (at > n * 0.5 ? cut.slice(0, at) : cut.replace(/\s+\S*$/, '')).trim(); };
const tidy = (x) => x.replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, '').replace(/\s+/g, ' ');

// Visual details from a card's own text: bracketed instruction blocks dropped (a bracket that is
// a plain trait list is kept), sentences to the AI, backstory and quoted speech dropped, and only
// sentences that describe the look kept, trimmed short.
function visualFrom(text, card, user, max = 200) {
  let t = String(text || '');
  // Bracketed blocks: an instruction block goes; a trait list ("[Mira: silver hair, amber eyes]") stays.
  t = t.replace(/\[([^\]]*)\]/g, (m, inner) => (sentences(inner).some(instructionish) ? '\n' : `\n${inner}\n`)).replace(/[[\]]/g, '\n');
  t = t.replace(/\(\([\s\S]*?\)\)/g, '\n').replace(/^\s*ooc\s*:.*$/gim, '\n');
  t = dropSpeech(t);
  const keep = [];
  for (const raw of sentences(t)) {
    if (instructionish(raw) || BACKSTORY.test(raw)) continue;
    if (user && user !== 'the user' && new RegExp(`\\b${reEsc(user)}\\b`, 'i').test(raw)) continue;
    const x = tidy(clean(fill(raw, card, user)));
    if (x && VISUAL.test(x)) keep.push(x);
  }
  let out = '';
  for (const x of keep) { if (!out) out = trimTo(x, max); else if (out.length + x.length + 2 <= max) out = `${out}, ${x}`; }
  return out;
}

// What a character looks like: the saved appearance first, else the visual details in the card.
function lookOf(card, user, max = 300) {
  const a = card?.ownerLook?.appearance;
  if (a && a.trim()) return trimTo(tidy(clean(fill(a, card, user))), max);
  return visualFrom([card?.description, card?.personality].filter(Boolean).join('\n'), card, user, Math.min(max, 200));
}
const hasLook = (card) => Boolean(card?.ownerLook?.appearance && card.ownerLook.appearance.trim());

// What is happening: the actions (*asterisks*) of the last messages, or their plain narration,
// with no dialogue, no instructions and no persona name. Short.
function sceneOf(messages, user, n = N_MESSAGES, max = 220) {
  const recent = (Array.isArray(messages) ? messages : []).filter((m) => m && typeof m.text === 'string' && !m.err && !m.deleted && m.who !== 'system').slice(-n);
  const bits = [];
  for (const m of recent) {
    const t = clean(m.text);
    const acts = [...t.matchAll(/\*([^*]{3,300})\*/g)].map((a) => a[1]);
    const parts = acts.length ? acts.flatMap((a) => sentences(dropSpeech(a))) : sentences(dropSpeech(t.replace(/\*[^*]*\*/g, ' '))).filter((x) => !/[?!]$/.test(x) && !/\b(?:i|i'm|me|my|we|us|our)\b/i.test(x));
    for (const p of parts) {
      if (instructionish(p)) continue;
      const x = tidy(hidePersona(p, user));
      if (x.length >= 3) bits.push(trimTo(x, 120));
    }
  }
  const uniq = [...new Set(bits)].slice(-3);
  let out = '';
  for (let i = uniq.length - 1; i >= 0; i--) { const next = out ? `${uniq[i]}; ${out}` : uniq[i]; if (next.length > max && out) break; out = trimTo(next, max); }
  return out;
}

const STYLE = 'Detailed illustration, cinematic lighting.';
const CORE_MAX = 400;
// The scene prompt (built locally from text, no AI): each character's look, then a short summary
// of what is happening, then the setting. Under about 400 characters plus the style tags.
function buildScenePrompt({ cards: list = [], messages = [], persona = {}, n = N_MESSAGES } = {}) {
  const user = persona?.name || 'the user';
  const per = Math.max(60, Math.floor(220 / Math.max(1, list.length)));
  const looks = list.map((c) => { const l = lookOf(c, user, per); return l ? `${c.name}: ${l}` : c.name; });
  const lookPart = looks.length ? `${looks.join('. ')}.` : '';
  const setting0 = list[0]?.scenario ? visualOrPlace(list[0].scenario, list[0], user) : '';
  const room = Math.max(60, CORE_MAX - lookPart.length - (setting0 ? setting0.length + 11 : 0) - 9);
  const happening = sceneOf(messages, user, n, Math.min(220, room));
  const used = lookPart.length + (happening ? happening.length + 9 : 0);
  const setting = setting0 && used + setting0.length + 11 <= CORE_MAX ? setting0 : '';
  return [lookPart, happening ? `Scene: ${happening}.` : '', setting ? `Setting: ${setting}.` : '', STYLE].filter(Boolean).join(' ').replace(/\.\./g, '.').slice(0, 2500);
}
// The setting from a card's scenario: the first plain sentence about the place (no instructions,
// no user, no backstory, no speech).
function visualOrPlace(text, card, user) {
  const t = dropSpeech(String(text || '').replace(/\[[^\]]*\]/g, ' '));
  for (const raw of sentences(t)) {
    if (instructionish(raw) || BACKSTORY.test(raw)) continue;
    if (user && user !== 'the user' && new RegExp(`\\b${reEsc(user)}\\b`, 'i').test(raw)) continue;
    const x = tidy(clean(fill(raw, card, user)));
    if (x) return trimTo(x, 100);
  }
  return '';
}
// "her" / "his" / "their", from the card's own words (for "Add her look in Appearance").
function pronounOf(card) {
  const t = `${card?.description || ''} ${card?.personality || ''}`;
  const she = (t.match(/\b(?:she|her|hers|herself)\b/gi) || []).length;
  const he = (t.match(/\b(?:he|him|his|himself)\b/gi) || []).length;
  return she > he ? 'her' : he > she ? 'his' : 'their';
}

// Which field of a card holds the words (for refusals that say exactly where).
const SCENE_FIELDS = [['name', 'name'], ['description', 'description'], ['personality', 'personality'], ['scenario', 'scenario'], ['appearance', 'appearance'], ['tags', 'tags']];
function whereIn(card, re) {
  for (const [k, label] of SCENE_FIELDS) {
    const t = k === 'appearance' ? card?.ownerLook?.appearance : k === 'tags' ? (card?.tags || []).join(', ') : card?.[k];
    const m = String(t || '').match(re);
    if (m) return { field: k, label, words: m[0] };
  }
  return null;
}

// The hard limits for one scene picture. { ok, negative, safe } or { ok: false, kind, message }.
function checkScene({ cards: list = [], prompt = '' } = {}) {
  const p = String(prompt || '');
  if (!p.trim()) return { ok: false, kind: 'empty', message: 'The prompt is empty.' };
  for (const c of list) {
    const l = cards.cardLimits(c);
    if (l.real) return { ok: false, kind: 'real', message: `Blocked: ${c.name} is marked as a real person (${l.realWhy}). Pictures never use a real person's likeness.` };
  }
  const realHit = p.match(cards.REAL_TAGS) || p.match(LIKENESS);
  if (realHit) return { ok: false, kind: 'real', message: `Blocked: the prompt asks for a real person ("${realHit[0]}"). Pictures never use a real person's likeness.` };
  const sexual = cards.isSexual(p);
  const minorCard = list.find((c) => cards.cardLimits(c).minor);
  if (sexual) {
    if (minorCard) return { ok: false, kind: 'minor', message: `Blocked: ${minorCard.name} reads as under 18 (${cards.cardLimits(minorCard).minorWhy}; ${cards.cardLimits(minorCard).hard ? 'a hard flag: it can\'t be cleared' : 'a soft flag: setting an adult age (18+) in the character\'s editor clears it'}), so no sexual pictures with this character.` };
    const minorWord = p.match(cards.MINOR_WORDS) || p.match(cards.HARD_WORDS);
    const youngAge = cards.ageNumbers(p).find((x) => x > 0 && x < 18);
    if (minorWord || youngAge !== undefined) return { ok: false, kind: 'minor', message: `Blocked: the prompt mentions ${minorWord ? `"${minorWord[0]}"` : `the age ${youngAge}`}, so it can't be sexual.` };
    const ambiguous = p.match(AMBIGUOUS);
    const lookAge = lookAges(p)[0];
    if (ambiguous || lookAge !== undefined) return { ok: false, kind: 'minor', message: `Blocked: the prompt says ${ambiguous ? `"${ambiguous[0]}"` : `the character looks ${lookAge}`}, which makes the age unclear, so the scene can't be sexual. Pictures never make anyone who looks under 18 sexual.` };
    if (!list.length) return { ok: false, kind: 'age', message: 'Blocked: a sexual scene needs characters whose adult age is clear. Pick the characters it shows.' };
    for (const c of list) {
      const t = cardText(c);
      const hit = t.match(AMBIGUOUS);
      const la = lookAges(t)[0];
      if (hit || la !== undefined) {
        const w = whereIn(c, hit ? AMBIGUOUS : LOOK_AGE_ONE);
        return { ok: false, kind: 'minor', field: w?.field || null, words: w?.words || (hit ? hit[0] : null), message: `Blocked: ${c.name}'s ${w ? w.label : 'card or look'} says "${w ? w.words : hit ? hit[0] : `looks ${la}`}" (a hard limit: it can't be cleared by any setting or age), which makes the age unclear, so the scene can't be sexual. Change that text, or make the scene non-sexual.` };
      }
    }
    const unclear = list.find((c) => !cards.clearlyAdult(c));
    if (unclear) return { ok: false, kind: 'age', message: `Blocked: ${unclear.name}'s age isn't clearly adult, so the scene can't be sexual. Give the card an age of 18 or more (or confirm the adult age on the card), or make the scene non-sexual.` };
  }
  // A character who reads as a minor: nudity and sexual content are pushed out instead (the
  // minor terms would fight the character's own look in a plain story picture).
  return { ok: true, safe: Boolean(minorCard), negative: negativeFor(list) };
}
// The built-in negative prompt (always sent; his own negative words are only added after it).
function negativeFor(list = []) {
  const minorCard = list.find((c) => cards.cardLimits(c).minor);
  return [NEG_BASE, minorCard ? NEG_NSFW : NEG_MINOR].join(', ');
}
// His own negative words, added after the built-in ones (they can only take things out).
const ownNegative = (t) => String(t || '').replace(/[\0-\x08\x0b-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);

module.exports = { visualOrPlace, buildScenePrompt, checkScene, negativeFor, ownNegative, lookOf, hasLook, pronounOf, visualFrom, sceneOf, whereIn, NEG_MINOR, NEG_NSFW, N_MESSAGES, AMBIGUOUS };

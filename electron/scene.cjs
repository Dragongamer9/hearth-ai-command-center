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
const AMBIGUOUS = /\b(young[- ]looking|youthful[- ]looking|look(?:s|ing)?\s+(?:very\s+|so\s+)?(?:young|underage|like\s+a\s+(?:child|kid|teen\w*|minor|little\s+\w+))|child[- ]?like|childish\s+(?:body|figure|face)|baby[- ]?faced?|school\s*girls?|school\s*boys?|school\s+uniforms?|high\s*school(?:er|ers)?|flat[- ]chested|barely\s+(?:legal|18|eighteen)|just\s+turned\s+(?:18|eighteen)|aged[- ]up|age[- ]ambiguous|ageless\s+(?:girl|boy)|petite\s+(?:little|young)\s+\w+|small\s+(?:and\s+)?young|little\s+(?:body|sister|brother)|tiny\s+(?:girl|boy|body)|smol|innocent\s+(?:little|young)\s+\w+)\b/i;
// "looks 15", "appears to be 14", "about 16", "15ish": a young age stated as a look.
const LOOK_AGE = /\b(?:looks?|looking|appears?|seems?|passes?\s+for)(?:\s+to\s+be)?\s+(?:about\s+|around\s+|like\s+|maybe\s+)?(\d{1,2})\b|\b(\d{1,2})\s*-?ish\b/gi;
const lookAges = (t) => [...String(t || '').matchAll(LOOK_AGE)].map((m) => Number(m[1] || m[2])).filter((n) => n > 0 && n < 18);
const cardText = (c) => [c?.name, c?.description, c?.personality, c?.scenario, c?.ownerLook?.appearance, ...(c?.tags || [])].join('\n');

const NEG_BASE = 'blurry, low quality, deformed, extra limbs, watermark, text';
const NEG_MINOR = 'child, children, kid, minor, underage, teen, teenager, loli, shota, childlike, young-looking, school uniform';
const NEG_NSFW = 'nsfw, nude, nudity, naked, sexual, suggestive, lingerie, cleavage';

const clean = (t) => String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/[#_`>|~]/g, ' ').replace(/\s+/g, ' ').trim();
const fill = (t, card, user) => String(t || '').replace(/\{\{char\}\}/gi, card?.name || 'the character').replace(/\{\{user\}\}/gi, user || 'the user');

// What a character looks like: the saved appearance, else the start of the card's description.
function lookOf(card, user) {
  const a = card?.ownerLook?.appearance;
  if (a && a.trim()) return clean(fill(a, card, user)).slice(0, 600);
  const d = clean(fill(card?.description || card?.personality || '', card, user));
  // The first sentences only (descriptions are often long and about more than looks).
  return d.split(/(?<=[.!?])\s+/).reduce((s, x) => (s.length + x.length < 300 ? `${s} ${x}` : s), '').trim() || d.slice(0, 300);
}

// The scene prompt: each character's look, then what is happening (the last N messages,
// actions in *asterisks* first, condensed). Built locally from text.
function buildScenePrompt({ cards: list = [], messages = [], persona = {}, n = N_MESSAGES } = {}) {
  const user = persona?.name || 'the user';
  const looks = list.map((c) => `${c.name}: ${lookOf(c, user)}`);
  const recent = (Array.isArray(messages) ? messages : []).filter((m) => m && typeof m.text === 'string' && !m.err && !m.deleted && m.who !== 'system').slice(-n);
  const actions = [];
  const lines = [];
  for (const m of recent) {
    const t = clean(m.text);
    for (const a of t.matchAll(/\*([^*]{3,200})\*/g)) actions.push(a[1].trim());
    const said = t.replace(/\*[^*]*\*/g, ' ').replace(/\s+/g, ' ').trim();
    if (said) lines.push(said.slice(0, 160));
  }
  const happening = [...actions.slice(-4), ...lines.slice(-2)].join('; ').slice(0, 700);
  const setting = list[0]?.scenario ? clean(fill(list[0].scenario, list[0], user)).slice(0, 250) : '';
  return [
    looks.length ? `${looks.join('. ')}.` : '',
    happening ? `Scene: ${happening}.` : '',
    setting ? `Setting: ${setting}.` : '',
    'Detailed illustration, cinematic lighting.',
  ].filter(Boolean).join(' ').replace(/\.\./g, '.').slice(0, 2500);
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
    if (minorCard) return { ok: false, kind: 'minor', message: `Blocked: ${minorCard.name} reads as under 18 (${cards.cardLimits(minorCard).minorWhy}), so no sexual pictures with this character.` };
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
      if (hit || la !== undefined) return { ok: false, kind: 'minor', message: `Blocked: ${c.name}'s card or look says ${hit ? `"${hit[0]}"` : `they look ${la}`}, which makes the age unclear, so the scene can't be sexual. Change the look, or make the scene non-sexual.` };
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

module.exports = { buildScenePrompt, checkScene, negativeFor, ownNegative, lookOf, NEG_MINOR, NEG_NSFW, N_MESSAGES, AMBIGUOUS };

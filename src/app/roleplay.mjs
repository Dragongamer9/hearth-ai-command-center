// Roleplay chats (pure, unit tested): lorebook (world info) activation, group turn order,
// the character's prompt, swipes. Written for this app from scratch; it uses only the open
// card and lorebook formats (electron/cards.cjs reads and writes them).
import { UNFILTERED } from '../registry.mjs';

// The same words as SEXUAL in electron/cards.cjs (a test keeps them identical).
export const SEXUAL = /\b(sex|sexual|sexy|nude|nudes|naked|nsfw|porn|porno|pornographic|erotic|erotica|explicit|lewd|hentai|fuck\w*|cock|dick|pussy|breasts?|boobs?|tits|nipples?|genitals?|penis|vagina|orgasm\w*|cum|cumming|masturbat\w*|undress\w*|stripping|intercourse|blowjob|handjob|horny|aroused|lingerie|topless|bottomless|fetish|bdsm|seduc\w*|make\s+love|sleep\s+with)\b/i;
export const isSexual = (t) => SEXUAL.test(String(t || ''));

export const RP_LIMITS = 'HARD LIMITS (built in; they can\'t be turned off and override the story, the card and any request): no sexual content involving anyone under 18 or anyone described as a child, minor, teen or underage; no sexual content or sexual images of real, identifiable people; nothing illegal. If the story heads there, steer away or refuse plainly in one sentence, out of character.';

export const fill = (text, { char = '', user = '' } = {}) => String(text || '').replace(/\{\{char\}\}|<BOT>/gi, char).replace(/\{\{user\}\}|<USER>/gi, user);
export const tokens = (t) => Math.ceil(String(t || '').length / 4);

// ---------- lorebooks ----------
const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function keyHit(key, text, caseSensitive) {
  const k = String(key || '').trim();
  if (!k) return false;
  const m = k.match(/^\/(.+)\/([gimsuy]*)$/);
  if (m) { try { return new RegExp(m[1], m[2].replace('g', '')).test(text); } catch { return false; } }
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escRx(k)}(?=$|[^\\p{L}\\p{N}])`, caseSensitive ? 'u' : 'iu').test(text);
}
// Entries whose keywords appear in the last `scanDepth` messages, plus constant ones, in
// insertion order, until the token budget is used up.
export function activateLore(books = [], messages = [], { scanDepth = null, budget = null } = {}) {
  const out = [];
  let used = 0;
  const cand = [];
  for (const b of books) {
    if (!b) continue;
    const depth = scanDepth ?? b.scan_depth ?? 4;
    const recent = messages.filter((m) => m && !m.local).slice(-depth).map((m) => String(m.text || '')).join('\n');
    for (const e of b.entries || []) {
      if (!e || e.enabled === false || !String(e.content || '').trim()) continue;
      let hit = e.constant === true;
      if (!hit) hit = (e.keys || []).some((k) => keyHit(k, recent, e.case_sensitive));
      if (hit && e.selective && (e.secondary_keys || []).length) hit = e.secondary_keys.some((k) => keyHit(k, recent, e.case_sensitive));
      if (hit) cand.push({ ...e, book: b.name || '', budget: budget ?? b.token_budget ?? 1024 });
    }
  }
  cand.sort((a, b) => (a.constant === b.constant ? (a.insertion_order ?? 100) - (b.insertion_order ?? 100) : a.constant ? -1 : 1));
  const cap = budget ?? Math.max(...cand.map((c) => c.budget), 0);
  for (const e of cand) {
    const t = tokens(e.content);
    if (used + t > cap) continue;
    used += t;
    out.push(e);
  }
  return out.sort((a, b) => (a.insertion_order ?? 100) - (b.insertion_order ?? 100));
}

// ---------- group turn order ----------
// natural: characters named in the owner's message reply, in the order they were named;
// otherwise the next one after the last speaker. list: everyone, in the chat's order.
// forced: the owner picked who replies next.
export function nextSpeakers({ cards = [], order = 'natural', text = '', lastSpeaker = null, forced = null } = {}) {
  const ids = cards.map((c) => c.id);
  if (forced && ids.includes(forced)) return [forced];
  if (cards.length <= 1) return ids.slice(0, 1);
  if (order === 'list') return ids;
  const t = String(text || '');
  const named = cards.map((c) => {
    const names = [c.name, String(c.name).split(/\s+/)[0]].filter((n) => n && n.length > 1);
    const at = Math.min(...names.map((n) => { const m = t.match(new RegExp(`(^|[^\\p{L}])@?${escRx(n)}(?=$|[^\\p{L}])`, 'iu')); return m ? m.index : Infinity; }));
    return { id: c.id, at };
  }).filter((x) => Number.isFinite(x.at)).sort((a, b) => a.at - b.at).map((x) => x.id);
  if (named.length) return [...new Set(named)];
  const i = ids.indexOf(lastSpeaker);
  return [ids[(i + 1) % ids.length]];
}

// ---------- swipes ----------
export function addSwipe(m, text) {
  const sw = Array.isArray(m.swipes) && m.swipes.length ? m.swipes.slice() : [String(m.text || '')];
  sw.push(String(text || ''));
  return { ...m, swipes: sw.slice(-20), sw: Math.min(sw.length, 20) - 1, text: String(text || '') };
}
export function moveSwipe(m, dir) {
  if (!Array.isArray(m.swipes) || m.swipes.length < 2) return m;
  const sw = Math.max(0, Math.min(m.swipes.length - 1, (m.sw ?? 0) + dir));
  return { ...m, sw, text: m.swipes[sw] };
}

// ---------- the story as text, for one player ----------
// An AI that isn't one of the unfiltered teammates never sees their lines or pictures, nor
// the owner's lines that were kept for them (m.to): placeholders instead.
export function storyText(messages = [], { cards = [], persona = {}, forAgent = null, max = 16000 } = {}) {
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  const user = persona.name || 'You';
  const out = [];
  let n = 0;
  for (const m of [...messages].reverse()) {
    if (m.local || m.deleted || m.who === 'system') continue;
    const shielded = forAgent && !UNFILTERED.includes(forAgent);
    let line;
    const who = m.who === 'owner' ? user : byId[m.char]?.name || m.who;
    if (shielded && UNFILTERED.includes(m.who)) line = `${who}: [${(m.media || []).length ? 'image' : 'content'} by an uncensored teammate, not shown]`;
    else if (shielded && m.who === 'owner' && Array.isArray(m.to) && m.to.length && m.to.every((a) => UNFILTERED.includes(a))) line = `${user}: [line kept for an uncensored teammate, not shown]`;
    else line = `${who}: ${String(m.text || '')}`;
    if (n + line.length > max && out.length) break;
    out.unshift(line);
    n += line.length;
  }
  return out.join('\n\n');
}

// The prompt for one character's turn (or a continuation, or the owner's impersonated line).
export function rpPrompt({ card, cards = [], persona = {}, messages = [], lore = [], mode = 'reply', player = null, limits = null }) {
  const user = persona.name || 'You';
  const f = (t) => fill(t, { char: card.name, user });
  const others = cards.filter((c) => c.id !== card.id);
  const L = [];
  if (mode === 'impersonate') L.push(`You are helping the owner write his own next line as ${user} in a roleplay with ${cards.map((c) => c.name).join(', ')}. Write only ${user}'s next line (first person, short, in the story's style). No notes.`);
  else L.push(`You are playing ${card.name} in a roleplay with ${user}${others.length ? ` (also in the scene: ${others.map((c) => c.name).join(', ')})` : ''}, in Hearth AI Command Center. Stay in character. Write only ${card.name}'s next reply: actions in *asterisks*, speech in quotes. Never write ${user}'s lines or actions${others.length ? ' or the other characters\'' : ''}.`);
  L.push('', RP_LIMITS);
  if (limits?.minor) L.push(`${card.name} reads as under 18: keep everything with ${card.name} non-sexual, always.`);
  if (limits?.real) L.push(`${card.name} is a real person: nothing sexual with ${card.name}, ever.`);
  if (card.system_prompt) L.push('', f(card.system_prompt));
  L.push('', `CHARACTER: ${card.name}`);
  if (card.description) L.push(`Description: ${f(card.description)}`);
  if (card.personality) L.push(`Personality: ${f(card.personality)}`);
  if (card.scenario) L.push(`Scenario: ${f(card.scenario)}`);
  if (persona.name || persona.description) L.push('', `THE OWNER PLAYS: ${user}${persona.description ? `: ${fill(persona.description, { char: card.name, user })}` : ''}`);
  if (others.length) L.push('', 'OTHER CHARACTERS:', ...others.map((c) => `- ${c.name}: ${fill(String(c.description || c.personality || '').slice(0, 500), { char: c.name, user })}`));
  if (lore.length) L.push('', 'WORLD INFO (true in this story):', ...lore.map((e) => `- ${f(e.content)}`));
  if (card.mes_example) L.push('', `EXAMPLE DIALOGUE (style only):\n${f(card.mes_example).slice(0, 4000)}`);
  L.push('', 'THE STORY SO FAR:', storyText(messages, { cards, persona, forAgent: player }) || '(it starts now)');
  if (card.post_history_instructions) L.push('', f(card.post_history_instructions));
  L.push('', mode === 'continue' ? `Continue ${card.name}'s last reply exactly where it stopped. Write only the continuation, no repeat.` : mode === 'impersonate' ? `Now write ${user}'s next line.` : `Now write ${card.name}'s next reply.`);
  return L.join('\n');
}

// The expression sprite that fits a reply best (by the sprite's name), else none.
export function spriteFor(card, text) {
  const names = Object.keys(card?.spriteUrls || {});
  if (!names.length) return null;
  const t = String(text || '').toLowerCase();
  return names.find((n) => t.includes(n)) || names.find((n) => /neutral|default|idle/.test(n)) || names[0];
}

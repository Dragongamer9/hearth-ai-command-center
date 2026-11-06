// Find and replace in the character editor, and the Characters list search (no DOM; tested in
// test/card-find.test.mjs). Everything here works on plain text: the editor reads its fields,
// these functions say where the matches are or what the replaced text is, and the editor puts
// the result back into its unsaved form. Nothing here saves anything: a card changes only when
// the owner presses Save.

// The card's text fields the Find box searches, in the editor's order, with their labels.
export const FIND_FIELDS = [
  ['name', 'Name'], ['description', 'Description'], ['personality', 'Personality'], ['scenario', 'Scenario'],
  ['first_mes', 'First message'], ['alternate_greetings', 'Alternate greetings'], ['mes_example', 'Example dialogue'],
  ['system_prompt', 'System prompt'], ['post_history_instructions', 'Post-history instructions'],
  ['creator_notes', 'Creator notes'], ['appearance', 'Appearance'], ['tags', 'Tags'],
];

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = '[\\p{L}\\p{N}_]';

// The search as a RegExp (global, literal text), or null for an empty query.
export function findRegex(query, { matchCase = false, wholeWord = false } = {}) {
  const q = String(query ?? '');
  if (!q) return null;
  const body = escRe(q);
  return new RegExp(wholeWord ? `(?<!${WORD})${body}(?!${WORD})` : body, `g${matchCase ? '' : 'i'}u`);
}

// Every match in one text: [{ start, end }].
export function findIn(text, query, opts = {}) {
  const re = findRegex(query, opts);
  if (!re) return [];
  const out = [];
  for (const m of String(text ?? '').matchAll(re)) { if (m[0].length) out.push({ start: m.index, end: m.index + m[0].length }); if (out.length >= 5000) break; }
  return out;
}

// All fields at once: { total, fields: [{ key, label, count, matches }], flat: [{ key, start, end }] }.
// fields: [{ key, label, text }] in the order they are shown.
export function searchFields(fields, query, opts = {}) {
  const out = { total: 0, fields: [], flat: [] };
  for (const f of fields || []) {
    const matches = findIn(f.text, query, opts);
    out.fields.push({ key: f.key, label: f.label, count: matches.length, matches });
    for (const m of matches) out.flat.push({ key: f.key, ...m });
    out.total += matches.length;
  }
  return out;
}

// The next / previous match index (wrapping), from the current one.
export function stepIndex(i, total, dir = 1) {
  if (!total) return -1;
  const n = Number.isInteger(i) && i >= 0 ? i : (dir > 0 ? -1 : 0);
  return ((n + dir) % total + total) % total;
}

// Replace one match (the replacement is literal text: "$1" stays "$1").
export function replaceAt(text, match, replacement) {
  const t = String(text ?? '');
  if (!match || match.start < 0 || match.end > t.length || match.start > match.end) return t;
  return t.slice(0, match.start) + String(replacement ?? '') + t.slice(match.end);
}

// Replace every match in one text: { text, count }.
export function replaceAllIn(text, query, replacement, opts = {}) {
  const re = findRegex(query, opts);
  if (!re) return { text: String(text ?? ''), count: 0 };
  let count = 0;
  const out = String(text ?? '').replace(re, () => { count++; return String(replacement ?? ''); });
  return { text: out, count };
}

// Replace every match in every field: { fields: [{ key, text, count }], count, changed: [keys] }.
export function replaceAllFields(fields, query, replacement, opts = {}) {
  const res = { fields: [], count: 0, changed: [] };
  for (const f of fields || []) {
    const r = replaceAllIn(f.text, query, replacement, opts);
    res.fields.push({ key: f.key, text: r.text, count: r.count });
    res.count += r.count;
    if (r.count) res.changed.push(f.key);
  }
  return res;
}

// A short piece of text around a match, split for highlighting: { before, hit, after }.
export function snippet(text, match, span = 28) {
  const t = String(text ?? '');
  if (!match) return { before: '', hit: '', after: '' };
  const a = Math.max(0, match.start - span);
  const b = Math.min(t.length, match.end + span);
  return { before: `${a > 0 ? '…' : ''}${t.slice(a, match.start)}`.replace(/\s+/g, ' '), hit: t.slice(match.start, match.end), after: `${t.slice(match.end, b)}${b < t.length ? '…' : ''}`.replace(/\s+/g, ' ') };
}

// Characters list search: names, tags and description text, every word of the query must appear.
export function cardMatches(card, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${card?.name || ''}\n${(card?.tags || []).join(' ')}\n${card?.description || ''}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}
// Where a card matched, for the list ("tags", "description"): the first place each word was found.
export function matchedIn(card, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const places = [['name', card?.name || ''], ['tags', (card?.tags || []).join(' ')], ['description', card?.description || '']];
  return [...new Set(words.map((w) => places.find(([, t]) => t.toLowerCase().includes(w))?.[0]).filter(Boolean))];
}

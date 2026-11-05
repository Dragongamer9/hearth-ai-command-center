// "Claude can do everything I can (asks me first every time)" in chats (pure, unit tested).
// Claude may ask with a line "ACT FOR OWNER: push|pr|merge". Nothing happens until the owner
// says yes (the card's button, or typing yes in that chat), and a merge still asks him again
// in the app's own popup. Version numbers, updaters, identity and settings are never asked for.
import { hardLimit } from '../ops/actforme.mjs';

export const ACT_KINDS = {
  push: 'Push this chat\'s branch to GitHub',
  pr: 'Open a pull request for this chat\'s branch',
  merge: 'Merge this chat\'s branch (you\'re asked again before anything changes)',
};
export const ACT_TTL_MS = 30 * 60 * 1000;

export function parseActs(text, { agent, enabled }) {
  if (!enabled || agent !== 'anthropic') return { acts: [], refused: [] };
  const acts = [];
  const refused = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.replace(/[*`]/g, '').match(/^\s*ACT FOR OWNER:\s*([a-z-]+)(.*)$/i);
    if (!m) continue;
    const kind = m[1].toLowerCase();
    const rest = m[2].trim();
    const limit = hardLimit(`${kind} ${rest}`) || hardLimit(kind);
    if (limit) { refused.push({ kind, reason: limit }); continue; }
    if (!ACT_KINDS[kind]) { refused.push({ kind, reason: `"${kind}" isn't something Claude can ask for here` }); continue; }
    if (!acts.some((a) => a.kind === kind)) acts.push({ kind });
  }
  return { acts, refused };
}

export function makeAct(kind, { chatId, sha = null, now = Date.now() }) {
  return { id: `A${Math.random().toString(36).slice(2, 8).toUpperCase()}`, kind, chatId, sha, at: now, status: 'pending' };
}
export const expired = (a, now = Date.now()) => now - a.at > ACT_TTL_MS;

// The owner typing "yes" in the chat answers the newest pending request there.
export function typedAnswer(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!]+$/, '');
  if (/^(yes|yep|yeah|ok|okay|approve|approved|do it|go ahead|allow)$/.test(t)) return 'yes';
  if (/^(no|nope|deny|denied|don't|do not|stop|cancel)$/.test(t)) return 'no';
  return null;
}

// Memory across chats (like the Claude app's memory). Facts the owner asked the AIs to
// remember. The owner adds, edits and deletes them in Settings › Memory. An AI can only
// PROPOSE one (a REMEMBER: line); it becomes a fact only after the owner says yes.
// Stored in <data>/memory.json (atomic, .bak, never overwritten when unreadable).
const crypto = require('node:crypto');
const { createJsonFile } = require('./jsonfile.cjs');

const MAX_FACTS = 300;
const MAX_TEXT = 500;
const clean = (t) => String(t ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
const id = () => `m${crypto.randomBytes(5).toString('hex')}`;

function createMemory(file, { now = () => new Date().toISOString() } = {}) {
  const f = createJsonFile(file, { empty: () => ({ version: 1, facts: [], pending: [] }), check: (j) => Array.isArray(j.facts), label: 'Your memory file' });
  const get = () => { const j = f.read(); return { facts: j.facts.slice(), pending: (j.pending || []).slice() }; };
  const put = (facts, pending) => f.write({ version: 1, facts, pending });
  return {
    list: () => ({ ...get(), broken: f.broken() }),
    // The owner's own additions and edits (from Settings › Memory or a Yes on a proposal).
    add(text, { by = 'owner' } = {}) {
      const t = clean(text);
      if (!t) throw new Error('Type something to remember.');
      const { facts, pending } = get();
      if (facts.length >= MAX_FACTS) throw new Error(`Memory is full (${MAX_FACTS} facts). Delete some first.`);
      if (facts.some((x) => x.text.toLowerCase() === t.toLowerCase())) return { ok: true, duplicate: true };
      const fact = { id: id(), text: t, at: now(), by: by === 'owner' ? 'owner' : String(by).slice(0, 20) };
      put([...facts, fact], pending);
      return { ok: true, fact };
    },
    update(fid, text) {
      const t = clean(text);
      const { facts, pending } = get();
      const i = facts.findIndex((x) => x.id === fid);
      if (i < 0) throw new Error('Not found.');
      if (!t) throw new Error('A fact can\'t be empty; delete it instead.');
      facts[i] = { ...facts[i], text: t, editedAt: now() };
      put(facts, pending);
      return { ok: true };
    },
    remove(fid) {
      const { facts, pending } = get();
      if (!facts.some((x) => x.id === fid)) return { ok: false, message: 'Not found.' };
      put(facts.filter((x) => x.id !== fid), pending);
      return { ok: true };
    },
    // An AI's suggestion: waits for the owner's yes, never saved as a fact by itself.
    propose(text, { agent, chatId } = {}) {
      const t = clean(text);
      if (!t) return { ok: false };
      const { facts, pending } = get();
      if (facts.some((x) => x.text.toLowerCase() === t.toLowerCase())) return { ok: true, known: true };
      const dup = pending.find((x) => x.text.toLowerCase() === t.toLowerCase());
      if (dup) return { ok: true, proposal: dup };
      const p = { id: id(), text: t, agent: String(agent || '').slice(0, 20), chatId: String(chatId || '').slice(0, 30), at: now() };
      put(facts, [...pending, p].slice(-50));
      return { ok: true, proposal: p };
    },
    decide(pid, yes) {
      const { facts, pending } = get();
      const p = pending.find((x) => x.id === pid);
      if (!p) return { ok: false, message: 'That suggestion is gone.' };
      const rest = pending.filter((x) => x.id !== pid);
      if (yes !== true) { put(facts, rest); return { ok: true, saved: false }; }
      const fact = { id: id(), text: p.text, at: now(), by: 'owner', suggestedBy: p.agent };
      put(facts.some((x) => x.text.toLowerCase() === p.text.toLowerCase()) ? facts : [...facts, fact], rest);
      return { ok: true, saved: true, fact };
    },
    // What the AIs read at the start of a chat.
    promptLines(max = 6000) {
      const { facts } = get();
      if (!facts.length) return '';
      let out = 'MEMORY (facts the owner asked the AIs to remember; use them, never contradict them):';
      for (const x of facts) { const l = `\n- ${x.text}`; if (out.length + l.length > max) break; out += l; }
      return out;
    },
  };
}

module.exports = { createMemory, MAX_FACTS, MAX_TEXT };

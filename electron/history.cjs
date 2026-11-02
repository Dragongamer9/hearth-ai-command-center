// The app's own searchable chat history: every conversation the app had with an
// AI, every CLI session found on this computer, and imported web-chat exports.
// Kept in its own file (separate from task state) with atomic writes, so it can
// grow without slowing the rest of the app. Secrets are redacted before saving.
const fs = require('node:fs');
const path = require('node:path');
const { redact } = require('./store.cjs');

const MAX_ITEMS = 20000;

const keyOf = (c) => `${c.provider}:${String(c.source || '').startsWith('import') ? 'imp:' : ''}${c.sessionId}`;

function createHistory(file) {
  let items = new Map();
  let loaded = false;

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const c of j.items || []) items.set(c.key, c);
    } catch {}
  }

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    const list = [...items.values()].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, MAX_ITEMS);
    const fd = fs.openSync(tmp, 'w', 0o600);
    fs.writeSync(fd, JSON.stringify({ version: 1, items: list }));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, file);
  }

  // Insert or update. App-started sessions keep their app details (title, task)
  // when the CLI's own transcript is merged in later.
  function upsert(conv, { persist = true } = {}) {
    load();
    if (!conv?.provider || !conv?.sessionId) return null;
    const key = keyOf(conv);
    const prev = items.get(key);
    const messages = (conv.messages || prev?.messages || []).map((m) => ({ role: m.role, text: redact(String(m.text || '')), at: m.at || null }));
    const next = {
      ...prev,
      ...conv,
      key,
      source: prev?.source === 'app' ? 'app' : conv.source || prev?.source || 'app',
      title: prev?.source === 'app' && prev.title ? prev.title : conv.title || prev?.title || 'Untitled',
      messages,
      count: messages.length,
    };
    delete next.file;
    items.set(key, next);
    if (persist) save();
    return next;
  }

  function upsertMany(list) {
    let n = 0;
    for (const c of list) if (upsert(c, { persist: false })) n++;
    save();
    return n;
  }

  // App conversation without a CLI transcript (API-key runs): append messages.
  function append({ provider, sessionId, title, messages, ...rest }) {
    load();
    const key = keyOf({ provider, sessionId, source: 'app' });
    const prev = items.get(key);
    return upsert({ ...rest, provider, sessionId, source: 'app', title: prev?.title || title, messages: [...(prev?.messages || []), ...messages], updatedAt: new Date().toISOString(), startedAt: prev?.startedAt || new Date().toISOString() });
  }

  function search(q = '', { provider = 'all', source = 'all', limit = 200 } = {}) {
    load();
    const needle = String(q).trim().toLowerCase();
    const out = [];
    for (const c of items.values()) {
      if (provider !== 'all' && c.provider !== provider) continue;
      if (source !== 'all' && !(source === 'import' ? String(c.source).startsWith('import') : c.source === source)) continue;
      let snippet = '';
      if (needle) {
        const hitTitle = String(c.title).toLowerCase().includes(needle);
        const hit = c.messages.find((m) => m.text.toLowerCase().includes(needle));
        if (!hitTitle && !hit) continue;
        if (hit) {
          const i = hit.text.toLowerCase().indexOf(needle);
          snippet = `${i > 40 ? '…' : ''}${hit.text.slice(Math.max(0, i - 40), i + 80)}${i + 80 < hit.text.length ? '…' : ''}`;
        }
      }
      out.push(summary(c, snippet));
    }
    return out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, limit);
  }

  function summary(c, snippet = '') {
    const last = c.messages[c.messages.length - 1];
    return { key: c.key, provider: c.provider, source: c.source, sessionId: c.sessionId, title: c.title, cwd: c.cwd || null, startedAt: c.startedAt || null, updatedAt: c.updatedAt || null, count: c.count, snippet: snippet || (last ? last.text.slice(0, 140) : ''), resumable: Boolean(c.resumable), openUrl: c.openUrl || null, taskId: c.taskId || null, bestEffort: Boolean(c.bestEffort) };
  }

  function get(key) { load(); return items.get(key) || null; }
  function stats() {
    load();
    const by = {};
    for (const c of items.values()) {
      const k = String(c.source).startsWith('import') ? 'import' : c.source;
      by[c.provider] = by[c.provider] || { app: 0, cli: 0, import: 0 };
      by[c.provider][k] = (by[c.provider][k] || 0) + 1;
    }
    return { total: items.size, by };
  }
  function remove(key) { load(); const ok = items.delete(key); if (ok) save(); return ok; }

  return { upsert, upsertMany, append, search, get, stats, remove, keyOf };
}

module.exports = { createHistory, keyOf };

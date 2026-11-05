// Chats: many conversations, each with its own messages and AI sessions, each linkable
// to one project (or none).
//
// Data safety (the owner's rule: saved data never changes by itself):
// - A project's existing team chat is never moved, copied or rewritten. It stays in that
//   project's state file and shows up here as a "team chat" entry linked to the project.
// - The index (chats/index.json) and each new chat (chats/<id>.json) are written
//   atomically (temp file, fsync, rename) and the previous good copy is kept as .bak.
// - A file that fails to parse is never overwritten: the .bak is used if it parses, the
//   broken file is kept aside, and writes to it stop until the owner looks at it.
// - The first run only ADDS the index; nothing else is touched.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ID_RE = /^c[0-9a-f]{10}$/;
const TEAM_RE = /^team-([a-z0-9]{3,16})$/;
const MAX_MESSAGES = 400;

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function createChats(dataDir, { now = () => new Date().toISOString() } = {}) {
  const dir = path.join(dataDir, 'chats');
  const indexFile = path.join(dir, 'index.json');
  let idx = null;
  let broken = null; // set when the index couldn't be read: no writes until the owner decides
  const notices = [];

  const parseIndex = (f) => { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (!j || !Array.isArray(j.list)) throw new Error('bad shape'); return j; };
  // Keep the previous good copy as .bak, then swap the new file in atomically.
  function writeJson(file, value, parse) {
    if (fs.existsSync(file)) {
      let good = false;
      try { parse(file); good = true; } catch {}
      if (!good) throw new Error(`${path.basename(file)} could not be read, so it was not overwritten.`);
      fs.copyFileSync(file, `${file}.bak`);
    }
    atomicWrite(file, JSON.stringify(value, null, 1));
  }
  const clean = (e) => (e && typeof e === 'object' && typeof e.id === 'string' && (ID_RE.test(e.id) || TEAM_RE.test(e.id)) ? {
    id: e.id,
    title: String(e.title || 'New chat').slice(0, 120),
    titleAuto: e.titleAuto === true,
    projectId: typeof e.projectId === 'string' && /^[a-z0-9]{3,16}$/.test(e.projectId) ? e.projectId : null,
    team: TEAM_RE.test(e.id),
    createdAt: typeof e.createdAt === 'string' ? e.createdAt : now(),
    updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : null,
    ...(e.linkedBy ? { linkedBy: String(e.linkedBy).slice(0, 40), linkedAt: String(e.linkedAt || '') } : {}),
  } : null);

  function load() {
    if (idx) return idx;
    if (!fs.existsSync(indexFile)) { idx = { version: 1, migratedAt: null, list: [] }; return idx; }
    try { idx = parseIndex(indexFile); }
    catch {
      try {
        idx = parseIndex(`${indexFile}.bak`);
        const aside = `${indexFile}.corrupt-${Date.now()}`;
        fs.copyFileSync(indexFile, aside);
        notices.push(`Your chats list was damaged; the last good copy was used. The damaged file is kept at ${aside}.`);
        broken = null;
        atomicWrite(indexFile, JSON.stringify(idx, null, 1));
      } catch {
        broken = indexFile;
        idx = { version: 1, migratedAt: null, list: [] };
        notices.push(`Your chats list (${indexFile}) could not be read. It was left exactly as it is; new chats can't be saved until it is fixed. Every project's team chat still works.`);
      }
    }
    idx.list = idx.list.map(clean).filter(Boolean);
    return idx;
  }
  function saveIndex() {
    if (broken) throw new Error('Your chats list could not be read, so nothing was written to it.');
    writeJson(indexFile, idx, parseIndex);
  }

  // Additive: every project gets its "team chat" entry (its existing messages, untouched).
  function ensureTeams(projects) {
    load();
    let added = false;
    for (const p of projects || []) {
      const id = `team-${p.id}`;
      if (idx.list.some((e) => e.id === id)) continue;
      idx.list.push({ id, title: `${p.name} team chat`, titleAuto: false, projectId: p.id, team: true, createdAt: p.createdAt || now(), updatedAt: null });
      added = true;
    }
    if (added && !broken) {
      if (!idx.migratedAt) idx.migratedAt = now();
      saveIndex();
    }
  }

  // Newest first. Team chats use their project state file's time.
  function list(projects, stateFileFor) {
    ensureTeams(projects);
    const known = new Set((projects || []).map((p) => p.id));
    return idx.list.map((e) => {
      let at = e.updatedAt;
      if (e.team && stateFileFor) { try { at = fs.statSync(stateFileFor(e.projectId)).mtime.toISOString(); } catch {} }
      return { ...e, updatedAt: at || e.createdAt, projectId: e.projectId && known.has(e.projectId) ? e.projectId : (e.team ? e.projectId : null) };
    }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function create({ projectId = null, title = 'New chat' } = {}) {
    load();
    let id;
    do { id = `c${crypto.randomBytes(5).toString('hex')}`; } while (idx.list.some((e) => e.id === id));
    const e = clean({ id, title, titleAuto: true, projectId, createdAt: now(), updatedAt: now() });
    atomicWrite(path.join(dir, `${id}.json`), JSON.stringify({ id, messages: [], sessions: {} }, null, 1));
    idx.list.push(e);
    saveIndex();
    return e;
  }

  const fileOf = (id) => { if (!ID_RE.test(String(id))) throw new Error('bad chat id'); return path.join(dir, `${id}.json`); };
  const parseChat = (f) => { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (!j || !Array.isArray(j.messages)) throw new Error('bad shape'); return j; };

  function get(id) {
    const f = fileOf(id);
    try { const j = parseChat(f); return { ok: true, messages: j.messages, sessions: j.sessions && typeof j.sessions === 'object' ? j.sessions : {} }; }
    catch {
      try { const j = parseChat(`${f}.bak`); return { ok: true, messages: j.messages, sessions: j.sessions || {}, recovered: true, readOnly: fs.existsSync(f) }; }
      catch { return { ok: false, damaged: fs.existsSync(f), message: 'This chat could not be read. It was left exactly as it is.' }; }
    }
  }

  function save(id, { messages, sessions } = {}) {
    load();
    const e = idx.list.find((x) => x.id === id);
    if (!e || e.team) throw new Error('unknown chat');
    if (!Array.isArray(messages)) throw new Error('bad messages');
    const data = { id, messages: messages.slice(-MAX_MESSAGES), sessions: sessions && typeof sessions === 'object' ? sessions : {} };
    if (Buffer.byteLength(JSON.stringify(data)) > 20 * 1024 * 1024) throw new Error('chat too large');
    writeJson(fileOf(id), data, parseChat);
    e.updatedAt = now();
    saveIndex();
    return true;
  }

  // Title and project link. A project's team chat stays with its project (its messages live there).
  function update(id, patch = {}) {
    load();
    const e = idx.list.find((x) => x.id === id);
    if (!e) throw new Error('unknown chat');
    if ('title' in patch) {
      const t = String(patch.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (t) { e.title = t; e.titleAuto = patch.auto === true; }
    }
    if ('projectId' in patch) {
      if (e.team) throw new Error("A project's team chat stays linked to its project. Start a new chat to link another one.");
      const p = patch.projectId;
      if (p !== null && !(typeof p === 'string' && /^[a-z0-9]{3,16}$/.test(p))) throw new Error('bad project');
      e.projectId = p;
      e.linkedBy = 'owner';
      e.linkedAt = now();
    }
    saveIndex();
    return { ...e };
  }

  return { list, create, get, save, update, ensureTeams, notices: () => notices.slice(), broken: () => broken, dir, indexFile };
}

module.exports = { createChats, atomicWrite, ID_RE, TEAM_RE };

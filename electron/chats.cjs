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
const MAX_MESSAGES = 5000; // 2.x: every message of a migrated team chat is kept
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,200}$/;
const cleanRepo = (r) => (typeof r === 'string' && REPO_RE.test(r) && !r.endsWith('.git') ? r : null);
const cleanBranch = (b) => (typeof b === 'string' && BRANCH_RE.test(b) && !b.includes('..') && !b.startsWith('-') ? b : null);

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

// Pinned first; within a group the owner's order (when set), then newest first.
function chatOrder(a, b) {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
  const ao = Number.isInteger(a.order), bo = Number.isInteger(b.order);
  if (ao && bo && a.order !== b.order) return a.order - b.order;
  if (ao !== bo) return ao ? -1 : 1;
  return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
}

const CARD_ID = /^[0-9a-f]{10}$/;
const PLAYER = /^[a-z]{2,12}$/;
function cleanRp(r) {
  const characters = r.characters.filter((x) => typeof x === 'string' && CARD_ID.test(x)).slice(0, 8);
  const players = Object.fromEntries(Object.entries(r.players && typeof r.players === 'object' ? r.players : {}).filter(([k, v]) => characters.includes(k) && typeof v === 'string' && PLAYER.test(v)));
  return { characters, players, order: r.order === 'list' ? 'list' : 'natural', lorebooks: (Array.isArray(r.lorebooks) ? r.lorebooks : []).filter((x) => typeof x === 'string' && CARD_ID.test(x)).slice(0, 10), ...(typeof r.background === 'string' && r.background.length < 300 ? { background: r.background } : {}) };
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
    ...(e.pinned === true ? { pinned: true } : {}),
    ...(Number.isInteger(e.order) ? { order: e.order } : {}),
    ...(e.hidden === true ? { hidden: true } : {}),
    ...(e.renamed === true ? { renamed: true } : {}),
    // 2.x: the GitHub repo (owner/name) and branch the chat is connected to, or a local
    // repo folder when a project had no GitHub remote.
    ...(cleanRepo(e.repo) ? { repo: cleanRepo(e.repo) } : {}),
    ...(cleanBranch(e.branch) ? { branch: cleanBranch(e.branch) } : {}),
    ...(typeof e.repoDir === 'string' && path.isAbsolute(e.repoDir) && !cleanRepo(e.repo) ? { repoDir: e.repoDir } : {}),
    ...(e.migratedV2 === true ? { migratedV2: true } : {}),
    ...(typeof e.importError === 'string' ? { importError: e.importError.slice(0, 300) } : {}),
    // Per-chat knowledge: custom instructions and pinned reference files (attachments).
    ...(typeof e.instructions === 'string' && e.instructions.trim() ? { instructions: e.instructions.slice(0, 4000) } : {}),
    // A roleplay chat: its characters (card ids), who plays each one, turn order, lorebooks, view.
    ...(e.rp && typeof e.rp === 'object' && Array.isArray(e.rp.characters) && e.rp.characters.length ? { rp: cleanRp(e.rp) } : {}),
    ...(Array.isArray(e.refs) && e.refs.length ? { refs: e.refs.filter((r) => r && typeof r.path === 'string' && path.isAbsolute(r.path) && typeof r.name === 'string').slice(0, 12).map((r) => ({ name: String(r.name).slice(0, 120), path: r.path, kind: ['image', 'video', 'file'].includes(r.kind) ? r.kind : 'file' })) } : {}),
  } : null);
  const cleanTrash = (t) => (t && typeof t === 'object' && typeof t.trashId === 'string' && /^[a-z0-9-]{8,40}$/.test(t.trashId) && clean(t.entry) ? { trashId: t.trashId, deletedAt: String(t.deletedAt || ''), file: String(t.file || ''), entry: clean(t.entry) } : null);

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
    idx.trash = (Array.isArray(idx.trash) ? idx.trash : []).map(cleanTrash).filter(Boolean);
    if (idx.v2 && typeof idx.v2 !== 'object') delete idx.v2;
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
    if (idx.v2) return; // 2.x: the migration added them once; a deleted one stays deleted
    for (const p of projects || []) {
      const id = `team-${p.id}`;
      if (idx.list.some((e) => e.id === id) || (idx.trash || []).some((t) => t.entry.id === id)) continue;
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
      if (e.team && stateFileFor && !hasFile(e.id)) { try { at = fs.statSync(stateFileFor(e.projectId)).mtime.toISOString(); } catch {} }
      return { ...e, updatedAt: at || e.createdAt, projectId: e.projectId && known.has(e.projectId) ? e.projectId : (e.team ? e.projectId : null) };
    }).sort(chatOrder);
  }

  function create({ projectId = null, title = 'New chat', repo = null, branch = null } = {}) {
    load();
    let id;
    do { id = `c${crypto.randomBytes(5).toString('hex')}`; } while (idx.list.some((e) => e.id === id));
    const orders = idx.list.filter((x) => !x.pinned && Number.isInteger(x.order)).map((x) => x.order);
    const e = clean({ id, title, titleAuto: true, projectId, repo, branch: repo ? branch : null, createdAt: now(), updatedAt: now(), ...(orders.length ? { order: Math.min(...orders) - 1 } : {}) });
    atomicWrite(path.join(dir, `${id}.json`), JSON.stringify({ id, messages: [], sessions: {} }, null, 1));
    idx.list.push(e);
    saveIndex();
    return e;
  }

  // 2.x: a project's team chat gets its own file too (a copy made by the migration; the
  // project's state file is never written).
  const fileOf = (id) => { if (!ID_RE.test(String(id)) && !TEAM_RE.test(String(id))) throw new Error('bad chat id'); return path.join(dir, `${id}.json`); };
  const hasFile = (id) => { try { return fs.existsSync(fileOf(id)); } catch { return false; } };
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
    if (!e || (e.team && !hasFile(id))) throw new Error('unknown chat');
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
      if (t) { e.title = t; e.titleAuto = patch.auto === true; if (patch.auto !== true) e.renamed = true; }
    }
    if ('pinned' in patch) {
      if (patch.pinned === true) e.pinned = true; else delete e.pinned;
      delete e.order; // it joins the other group at its natural place
    }
    if ('hidden' in patch) {
      if (!e.team && !idx.v2) throw new Error('Only a project\'s team chat can be hidden; other chats can be deleted.');
      if (patch.hidden === true) e.hidden = true; else delete e.hidden;
    }
    // 2.x: connect the chat to a GitHub repo and branch (or to nothing: "No repo, just talk").
    if ('repo' in patch) {
      const r = patch.repo === null ? null : cleanRepo(patch.repo);
      if (patch.repo !== null && !r) throw new Error('bad repo');
      const b = r ? cleanBranch(patch.branch) : null;
      if (r && patch.branch != null && !b) throw new Error('bad branch');
      if (r) e.repo = r; else delete e.repo;
      if (b) e.branch = b; else delete e.branch;
      delete e.repoDir;
      e.linkedBy = 'owner';
      e.linkedAt = now();
    }
    if ('instructions' in patch) {
      const t = String(patch.instructions || '').slice(0, 4000);
      if (t.trim()) e.instructions = t; else delete e.instructions;
    }
    if ('rp' in patch) {
      if (patch.rp && Array.isArray(patch.rp.characters) && patch.rp.characters.length) e.rp = cleanRp(patch.rp); else delete e.rp;
    }
    if ('refs' in patch) {
      const c = clean({ ...e, refs: Array.isArray(patch.refs) ? patch.refs : [] });
      if (c.refs) e.refs = c.refs; else delete e.refs;
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

  // The owner's order for one group (pinned or not): exactly the chats of that group, in the new order.
  function reorder(ids) {
    load();
    if (!Array.isArray(ids) || !ids.length) throw new Error('bad order');
    const entries = ids.map((id) => idx.list.find((x) => x.id === id));
    if (entries.some((x) => !x)) throw new Error('unknown chat');
    if (new Set(ids).size !== ids.length) throw new Error('bad order');
    const pinned = Boolean(entries[0].pinned);
    if (entries.some((x) => Boolean(x.pinned) !== pinned)) throw new Error('Pinned and other chats are ordered separately.');
    entries.forEach((x, i) => { x.order = i; });
    // Chats of that group not in the list keep their place after the ordered ones.
    let n = entries.length;
    for (const x of idx.list) if (Boolean(x.pinned) === pinned && !ids.includes(x.id)) x.order = n++;
    saveIndex();
    return true;
  }

  // Delete a chat: its file moves to chats/trash (nothing is destroyed) and it can be restored.
  function remove(id) {
    load();
    const e = idx.list.find((x) => x.id === id);
    if (!e) throw new Error('unknown chat');
    if (e.team && !hasFile(id)) throw new Error("A project's team chat can't be deleted (its messages belong to the project). You can hide it instead.");
    const trashId = `${id}-${Date.now().toString(36)}`;
    const tdir = path.join(dir, 'trash');
    fs.mkdirSync(tdir, { recursive: true, mode: 0o700 });
    const src = fileOf(id);
    const dest = path.join(tdir, `${trashId}.json`);
    if (fs.existsSync(src)) fs.renameSync(src, dest);
    if (fs.existsSync(`${src}.bak`)) fs.renameSync(`${src}.bak`, `${dest}.bak`);
    idx.list = idx.list.filter((x) => x.id !== id);
    idx.trash = [{ trashId, deletedAt: now(), file: dest, entry: { ...e } }, ...(idx.trash || [])].slice(0, 50);
    saveIndex();
    return { ok: true, trashId };
  }
  const trash = () => { load(); return (idx.trash || []).map((t) => ({ trashId: t.trashId, deletedAt: t.deletedAt, id: t.entry.id, title: t.entry.title, projectId: t.entry.projectId })); };
  function restore(trashId) {
    load();
    const t = (idx.trash || []).find((x) => x.trashId === trashId);
    if (!t) throw new Error('That deleted chat is no longer in the bin.');
    if (idx.list.some((x) => x.id === t.entry.id)) throw new Error('That chat is already in the list.');
    const dest = fileOf(t.entry.id);
    const src = path.join(dir, 'trash', `${trashId}.json`);
    if (fs.existsSync(dest)) throw new Error('A chat file with that id already exists, so nothing was overwritten.');
    if (fs.existsSync(src)) fs.renameSync(src, dest);
    if (fs.existsSync(`${src}.bak`)) fs.renameSync(`${src}.bak`, `${dest}.bak`);
    const entry = { ...t.entry };
    delete entry.order;
    idx.list.push(entry);
    idx.trash = idx.trash.filter((x) => x.trashId !== trashId);
    saveIndex();
    return { ...entry };
  }

  // 2.x migration: change index entries in one atomic write (keeps index.json.bak). Never
  // runs on an index that couldn't be read.
  function migrateIndex(fn) {
    load();
    if (broken) throw new Error('Your chats list could not be read, so nothing was changed.');
    const changed = fn(idx);
    if (changed) { idx.list = idx.list.map(clean).filter(Boolean); saveIndex(); }
    return changed;
  }
  const entry = (id) => { load(); const e = idx.list.find((x) => x.id === id); return e ? { ...e } : null; };
  const isV2 = () => { load(); return Boolean(idx.v2); };
  // Search titles, repos and message text (newest first).
  function search(q) {
    load();
    const s = String(q || '').toLowerCase().trim().slice(0, 200);
    if (!s) return [];
    const out = [];
    for (const e of idx.list) {
      let hit = `${e.title} ${e.repo || ''}`.toLowerCase().includes(s) ? 'title' : null;
      let snippet = '';
      if (!hit && hasFile(e.id)) {
        try {
          const t = fs.readFileSync(fileOf(e.id), 'utf8');
          if (t.length < 25e6 && t.toLowerCase().includes(s)) {
            const m = (JSON.parse(t).messages || []).find((x) => String(x.text || '').toLowerCase().includes(s));
            if (m) { hit = 'message'; const i = String(m.text).toLowerCase().indexOf(s); snippet = String(m.text).slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, ' '); }
          }
        } catch {}
      }
      if (hit) out.push({ id: e.id, hit, snippet });
    }
    return out.slice(0, 50);
  }

  return { list, create, get, save, update, reorder, remove, trash, restore, ensureTeams, migrateIndex, entry, isV2, search, hasFile, fileOf, notices: () => notices.slice(), broken: () => broken, dir, indexFile };
}

module.exports = { createChats, chatOrder, atomicWrite, ID_RE, TEAM_RE };

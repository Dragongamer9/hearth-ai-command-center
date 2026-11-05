// 2.x migration: from projects + boards to chats only.
//
// Additive and safe (the owner's rule: saved data never changes by itself):
// - Every existing chat stays a chat. Each project's team chat becomes a chat of its own:
//   its messages and AI sessions are COPIED into chats/team-<id>.json. The project's state
//   file (board, tasks, approvals, audit, the original chat) is only read, never written.
// - A project's chat (its team chat and every 1.4/1.5 chat linked to it) is connected to
//   that project's GitHub repo, read from the project folder's git remote; with no GitHub
//   remote it is connected to the folder itself.
// - Before the first change the chats list is backed up once (chats/index.json.pre-2);
//   every write is atomic and keeps index.json.bak. A list or state file that fails to
//   parse is never written over: that chat is left as it is, with a note.
// - settings.json, ops-projects.json and the state files are not touched at all.
// - Running it again changes nothing.
const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite } = require('./chats.cjs');
const { sourceOf, validRepo } = require('./copies.cjs');

// Read a project's state file without ever changing it: the file, else its newest readable backup.
function readStateReadOnly(file) {
  for (const f of [file, ...Array.from({ length: 10 }, (_, i) => `${file}.${i + 1}`)]) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (j && typeof j === 'object') return { state: j, from: f };
    } catch {}
  }
  return { state: null, from: null };
}

async function migrateV2({ chats, projects = [], stateFileFor, remoteOf, now = () => new Date().toISOString() }) {
  const notices = [];
  const already = chats.isV2(); // reads the list first, so a damaged one is seen below
  if (chats.broken()) return { ok: false, migrated: false, notices: ['Your chats list could not be read, so nothing was moved to the new layout. It was left exactly as it is.'] };
  if (already) return { ok: true, migrated: false, notices };

  // One untouched copy of the 1.x chats list, made before anything changes.
  const pre = `${chats.indexFile}.pre-2`;
  if (fs.existsSync(chats.indexFile) && !fs.existsSync(pre)) fs.copyFileSync(chats.indexFile, pre);

  // Every project gets its team chat entry first (the 1.x additive step).
  chats.ensureTeams(projects);

  // Where each project's chats connect: its GitHub repo, else its folder.
  const conn = {};
  for (const p of projects) {
    let repo = null;
    if (p.dir) { try { repo = await remoteOf(p.dir); } catch {} }
    const name = validRepo(repo) ? repo : repo ? sourceOf(repo)?.repo || null : null;
    conn[p.id] = name ? { repo: name } : p.dir ? { repoDir: p.dir } : {};
  }

  // Team chats: copy their messages out of the project's state file (read-only).
  const copied = {};
  for (const p of projects) {
    const id = `team-${p.id}`;
    const dest = chats.fileOf(id);
    if (fs.existsSync(dest)) { copied[id] = 'kept'; continue; }
    let file;
    try { file = stateFileFor(p.id); } catch { continue; }
    if (!fs.existsSync(file) && !fs.existsSync(`${file}.1`)) {
      atomicWrite(dest, JSON.stringify({ id, messages: [], sessions: {}, importedFrom: null, importedAt: now() }, null, 1));
      copied[id] = 'empty';
      continue;
    }
    const { state, from } = readStateReadOnly(file);
    if (!state) {
      copied[id] = 'error';
      notices.push(`${p.name}'s team chat couldn't be read (${file}). It was left exactly as it is.`);
      continue;
    }
    const messages = Array.isArray(state.chat) ? state.chat : [];
    const sessions = state.chatSessions && typeof state.chatSessions === 'object' && !Array.isArray(state.chatSessions) ? state.chatSessions : {};
    atomicWrite(dest, JSON.stringify({ id, messages, sessions, importedFrom: from, importedAt: now() }, null, 1));
    copied[id] = from === file ? 'copied' : 'copied-from-backup';
    if (from !== file) notices.push(`${p.name}'s team chat was read from its backup ${path.basename(from)} because the main file couldn't be read. Nothing was changed.`);
  }

  // Connect every chat that belongs to a project; mark the list as 2.x.
  chats.migrateIndex((idx) => {
    for (const e of idx.list) {
      if (e.migratedV2) continue;
      const c = e.projectId ? conn[e.projectId] : null;
      if (c && !e.repo && !e.repoDir) Object.assign(e, c);
      if (e.team && copied[e.id] === 'error') e.importError = 'The project file could not be read; nothing was changed.';
      e.migratedV2 = true;
    }
    idx.v2 = { at: now(), from: '1.x', backup: path.basename(pre) };
    return true;
  });
  return { ok: true, migrated: true, notices, copied };
}

// The project folder's GitHub remote ("owner/name"), or null.
function remoteReader(git) {
  return async (dir) => {
    if (!dir || !fs.existsSync(dir)) return null;
    const r = await git(dir, ['remote', 'get-url', 'origin']);
    const src = r.ok ? sourceOf(r.out) : null;
    return src?.repo || null;
  };
}

module.exports = { migrateV2, readStateReadOnly, remoteReader };

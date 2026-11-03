// Projects: each one has its own repo folder, board + chat (its own state file),
// PROJECT.md, test command and settings. The data that existed before projects
// is the "default" project and stays in the same file it always used, so nothing
// moves and nothing is lost. Settings only change when the owner changes them.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LEGACY_STATE = 'command-center-state.json';
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/;

function defaultSettings() {
  return {
    testCommand: null, // null = automatic (npm test when package.json has one), '' = none
    testTimeoutMin: 15,
    stallMin: 20, // no output and no file changes for this long = stalled (0 = off)
    ciWatch: true,
    logsOn: false,
    logsRepo: '',
  };
}

const clampInt = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : dflt);

function cleanSettings(s = {}) {
  const d = defaultSettings();
  return {
    testCommand: s.testCommand === null || s.testCommand === undefined ? null : String(s.testCommand).replace(/[\r\n\0]/g, ' ').trim().slice(0, 300),
    testTimeoutMin: clampInt(s.testTimeoutMin, 1, 120, d.testTimeoutMin),
    stallMin: clampInt(s.stallMin, 0, 240, d.stallMin),
    ciWatch: s.ciWatch === undefined ? d.ciWatch : s.ciWatch === true,
    logsOn: s.logsOn === true,
    logsRepo: typeof s.logsRepo === 'string' && REPO_RE.test(s.logsRepo.trim()) ? s.logsRepo.trim() : '',
  };
}

function cleanProject(p) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !/^[a-z0-9]{3,16}$/.test(p.id)) return null;
  return {
    id: p.id,
    name: String(p.name || p.id).slice(0, 80),
    dir: typeof p.dir === 'string' && path.isAbsolute(p.dir) ? p.dir : null,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
    settings: cleanSettings(p.settings || {}),
  };
}

// The registry; created once from the existing settings (the migration).
function migrate(legacyDir, now = new Date().toISOString()) {
  return {
    version: 1,
    active: 'default',
    migratedAt: now,
    list: [{ id: 'default', name: legacyDir ? path.basename(legacyDir) : 'Default project', dir: legacyDir || null, createdAt: now, settings: defaultSettings() }],
  };
}

function normalize(j, legacyDir) {
  if (!j || typeof j !== 'object' || !Array.isArray(j.list)) return migrate(legacyDir);
  const list = j.list.map(cleanProject).filter(Boolean);
  if (!list.some((p) => p.id === 'default')) list.unshift(migrate(legacyDir).list[0]);
  const ids = new Set();
  const uniq = list.filter((p) => (ids.has(p.id) ? false : ids.add(p.id)));
  return { version: 1, active: uniq.some((p) => p.id === j.active) ? j.active : 'default', migratedAt: j.migratedAt || null, list: uniq };
}

function stateFileFor(dataDir, id) {
  if (id === 'default') return path.join(dataDir, LEGACY_STATE);
  if (!/^[a-z0-9]{3,16}$/.test(id)) throw new Error('bad project id');
  return path.join(dataDir, 'projects', id, LEGACY_STATE);
}

function createProjects(dataDir) {
  const file = path.join(dataDir, 'ops-projects.json');
  let reg = null;

  function write() {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(reg, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function load(legacyDir) {
    let j = null;
    let existed = false;
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')); existed = true; } catch {}
    reg = normalize(j, legacyDir);
    if (!existed) write(); // first start with projects: record the migration once
    return reg;
  }

  const get = () => reg || load(null);
  const active = () => get().list.find((p) => p.id === get().active);
  const byId = (id) => get().list.find((p) => p.id === id) || null;

  function add({ name, dir }) {
    if (!dir || !path.isAbsolute(dir)) throw new Error('bad folder');
    const have = get().list.find((p) => p.dir === dir);
    if (have) return have;
    let id;
    do { id = crypto.randomBytes(4).toString('hex'); } while (byId(id));
    const p = cleanProject({ id, name: name || path.basename(dir), dir, createdAt: new Date().toISOString(), settings: defaultSettings() });
    get().list.push(p);
    write();
    return p;
  }

  // Before switching away, remember the folder the current project uses.
  function setDir(id, dir) {
    const p = byId(id);
    if (!p || !dir || p.dir === dir) return p;
    p.dir = dir;
    write();
    return p;
  }

  function switchTo(id) {
    const p = byId(id);
    if (!p) throw new Error('Unknown project.');
    get().active = id;
    write();
    return p;
  }

  function rename(id, name) {
    const p = byId(id);
    if (!p) throw new Error('Unknown project.');
    p.name = String(name || '').trim().slice(0, 80) || p.name;
    write();
    return p;
  }

  function setSettings(id, patch) {
    const p = byId(id);
    if (!p) throw new Error('Unknown project.');
    if (!patch || typeof patch !== 'object') throw new Error('bad settings');
    const next = { ...p.settings };
    for (const k of Object.keys(defaultSettings())) if (k in patch) next[k] = patch[k];
    p.settings = cleanSettings(next);
    write();
    return p;
  }

  return { load, get, active, byId, add, setDir, switchTo, rename, setSettings, stateFile: (id) => stateFileFor(dataDir, id), file };
}

module.exports = { createProjects, defaultSettings, cleanSettings, migrate, normalize, stateFileFor, REPO_RE, LEGACY_STATE };

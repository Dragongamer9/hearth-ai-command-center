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
    stallMin: 45, // no output and no file changes for this long = stalled (0 = off); Claude -p is quiet while it builds
    ciWatch: false, // the owner turns it on
    logsOn: false,
    logsRepo: '',
    nextVersion: '', // set by the owner only; the lead may release/tag only this version
    versionFile: 'package.json',
    releaseCommand: '', // '' = dispatch .github/workflows/release.yml on main
    docsPaths: '*.md, **/*.md, docs/**, release-notes/**', // what Docs and research runs may change
  };
}

// Docs paths: comma-separated globs of letters, digits, . _ - / * only (no "..", no pathspec magic).
const validDocsPaths = (v) => typeof v === 'string' && /^[A-Za-z0-9._*/,\s-]{1,300}$/.test(v) && !v.includes('..') && v.split(',').every((x) => x.trim() && !x.trim().startsWith('/'));
const clampInt = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : dflt);

function cleanSettings(s = {}) {
  const d = defaultSettings();
  return {
    testCommand: s.testCommand === null || s.testCommand === undefined ? null : String(s.testCommand).replace(/[\r\n\0]/g, ' ').trim().slice(0, 300),
    testTimeoutMin: clampInt(s.testTimeoutMin, 1, 120, d.testTimeoutMin),
    stallMin: clampInt(s.stallMin, 0, 240, d.stallMin),
    ciWatch: s.ciWatch === true,
    logsOn: s.logsOn === true,
    logsRepo: typeof s.logsRepo === 'string' && REPO_RE.test(s.logsRepo.trim()) ? s.logsRepo.trim() : '',
    nextVersion: typeof s.nextVersion === 'string' && /^\d{1,4}\.\d{1,4}(\.\d{1,6})?$/.test(s.nextVersion.trim()) ? s.nextVersion.trim() : '',
    versionFile: typeof s.versionFile === 'string' && /^[A-Za-z0-9._/-]{1,120}$/.test(s.versionFile) && !s.versionFile.includes('..') ? s.versionFile : 'package.json',
    releaseCommand: typeof s.releaseCommand === 'string' ? s.releaseCommand.replace(/[\r\n\0]/g, ' ').trim().slice(0, 300) : '',
    docsPaths: validDocsPaths(s.docsPaths) ? s.docsPaths.trim() : d.docsPaths,
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
  const bak = `${file}.bak`;
  let reg = null;
  let notice = null;
  let lastHash = null;
  const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
  const parse = (f) => { const raw = fs.readFileSync(f, 'utf8'); const j = JSON.parse(raw); if (!j || !Array.isArray(j.list)) throw new Error('bad shape'); return { j, raw }; };

  // Atomic, and the previous good copy is kept as .bak.
  function write() {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    try { parse(file); fs.copyFileSync(file, bak); } catch {}
    const data = JSON.stringify(reg, null, 2);
    const tmp = `${file}.tmp-${process.pid}`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
    lastHash = hash(data);
  }

  // A file that fails to parse is never overwritten: the .bak is restored, or (if that is
  // bad too) the broken file is kept aside and the owner is told.
  function load(legacyDir, legacyList = []) {
    let j = null;
    const exists = fs.existsSync(file);
    try { const p = parse(file); j = p.j; lastHash = hash(p.raw); } catch {
      if (exists) {
        try { const b = parse(bak); j = b.j; fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); fs.copyFileSync(bak, file); lastHash = hash(b.raw); notice = 'Your projects file was damaged; the last good copy was restored.'; }
        catch { const aside = `${file}.corrupt-${Date.now()}`; fs.renameSync(file, aside); notice = `Your projects file was damaged and no good copy existed; it was kept at ${aside}.`; }
      }
    }
    reg = normalize(j, legacyDir);
    // Folders from the old Settings list become projects too (nothing is lost).
    let added = false;
    for (const d of legacyList || []) if (typeof d === 'string' && path.isAbsolute(d) && !reg.list.some((p) => p.dir === d)) { reg.list.push(newProject(d)); added = true; }
    if (!fs.existsSync(file) || added) write();
    return reg;
  }
  function newProject(dir, name) {
    let id;
    do { id = crypto.randomBytes(4).toString('hex'); } while (reg && reg.list.some((p) => p.id === id));
    return cleanProject({ id, name: name || path.basename(dir), dir, createdAt: new Date().toISOString(), settings: defaultSettings() });
  }
  // Changed on disk by something other than the app (e.g. an AI)? The owner decides.
  function changedOnDisk() {
    try { return hash(fs.readFileSync(file, 'utf8')) !== lastHash; } catch { return false; }
  }
  function keepDisk() { const p = parse(file); reg = normalize(p.j, null); lastHash = hash(p.raw); return reg; }

  const get = () => reg || load(null);
  const active = () => get().list.find((p) => p.id === get().active);
  const byId = (id) => get().list.find((p) => p.id === id) || null;

  function add({ name, dir }) {
    if (!dir || !path.isAbsolute(dir)) throw new Error('bad folder');
    const have = get().list.find((p) => p.dir === dir);
    if (have) return have;
    const p = newProject(dir, name);
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
    // An invalid docs paths entry is refused with the reason, never silently reset.
    if ('docsPaths' in patch && !validDocsPaths(patch.docsPaths)) throw new Error('Docs paths must be comma-separated relative globs using only letters, digits, . _ - / and * (no "..", no leading /), e.g. *.md, docs/**');
    const next = { ...p.settings };
    for (const k of Object.keys(defaultSettings())) if (k in patch) next[k] = patch[k];
    p.settings = cleanSettings(next);
    write();
    return p;
  }

  return { notice: () => notice, changedOnDisk, keepDisk, discardDisk: () => write(), load, get, active, byId, add, setDir, switchTo, rename, setSettings, stateFile: (id) => stateFileFor(dataDir, id), file };
}

module.exports = { validDocsPaths, createProjects, defaultSettings, cleanSettings, migrate, normalize, stateFileFor, REPO_RE, LEGACY_STATE };

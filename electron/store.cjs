// Durable app-state storage.
// - Atomic writes: write temp file -> fsync -> rename, so an interrupted write
//   can never leave a half-written state file.
// - Versioned: the previous good copies are kept as state.json.1 … .N.
// - Recovery: if the newest file is unreadable it is set aside (never deleted)
//   and the newest readable backup is loaded instead.
// - Secrets are scrubbed before anything touches disk.
const fs = require('node:fs');
const path = require('node:path');

const SECRET_RES = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[abpr]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(Bearer|x-api-key:?)\s+[A-Za-z0-9._~+/=-]{16,}/gi,
];

function redact(text) {
  let s = String(text);
  for (const re of SECRET_RES) s = s.replace(re, '[REDACTED]');
  return s;
}

// Deep-redact every string in a JSON-able value.
function redactDeep(v) {
  if (typeof v === 'string') return redact(v);
  if (Array.isArray(v)) return v.map(redactDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = redactDeep(val);
    return out;
  }
  return v;
}

function createStore(file, { keep = 10 } = {}) {
  const backup = (n) => `${file}.${n}`;

  function parse(p) {
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object' || !Array.isArray(j.tasks) || !Array.isArray(j.audit)) throw new Error('invalid shape');
    return j;
  }

  function save(state) {
    const clean = redactDeep({ ...state, savedAt: new Date().toISOString() });
    const data = JSON.stringify(clean, null, 1);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp-${process.pid}`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // Rotate: only a file that currently parses becomes a backup.
    if (fs.existsSync(file)) {
      let good = false;
      try { parse(file); good = true; } catch {}
      if (good) {
        for (let n = keep - 1; n >= 1; n--) {
          if (fs.existsSync(backup(n))) fs.renameSync(backup(n), backup(n + 1));
        }
        fs.copyFileSync(file, backup(1));
        try { fs.unlinkSync(backup(keep + 1)); } catch {}
      }
    }
    fs.renameSync(tmp, file);
    return true;
  }

  // Returns { state, recoveredFrom } — recoveredFrom names the backup used, if any.
  function load() {
    if (!fs.existsSync(file) && !fs.existsSync(backup(1))) return { state: null, recoveredFrom: null };
    try {
      return { state: parse(file), recoveredFrom: null };
    } catch {
      if (fs.existsSync(file)) {
        try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch {}
      }
      for (let n = 1; n <= keep; n++) {
        try {
          const s = parse(backup(n));
          return { state: s, recoveredFrom: path.basename(backup(n)) };
        } catch {}
      }
      return { state: null, recoveredFrom: null, lost: true };
    }
  }

  function list() {
    const out = [];
    for (let n = 1; n <= keep; n++) {
      const p = backup(n);
      if (!fs.existsSync(p)) continue;
      let savedAt = null;
      let tasks = null;
      let ok = true;
      try {
        const s = parse(p);
        savedAt = s.savedAt || fs.statSync(p).mtime.toISOString();
        tasks = s.tasks.length;
      } catch { ok = false; }
      out.push({ n, savedAt, tasks, ok });
    }
    return out;
  }

  function restore(n) {
    if (!Number.isInteger(n) || n < 1 || n > keep) throw new Error('bad backup number');
    const s = parse(backup(n));
    save(s);
    return s;
  }

  return { save, load, list, restore };
}

module.exports = { createStore, redact, redactDeep };

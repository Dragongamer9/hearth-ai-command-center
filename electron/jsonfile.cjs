// One small JSON file the app owns (memory, scheduled tasks, connectors, Habitat).
// The owner's rule: saved data never changes by itself.
// - Nothing is written until something really changes (no file on first run).
// - Writes are atomic (temp file, fsync, rename) and keep the previous good copy as .bak.
// - A file that fails to parse is never overwritten: its .bak is read instead (read-only)
//   and writes stop with a clear message until the owner looks at it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function createJsonFile(file, { empty, check = () => true, label = path.basename(file) } = {}) {
  let cache = null;
  let broken = null;
  const parse = (f) => { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (!j || typeof j !== 'object' || !check(j)) throw new Error('bad shape'); return j; };
  function read() {
    if (cache) return cache;
    if (!fs.existsSync(file)) { cache = empty(); return cache; }
    try { cache = parse(file); broken = null; } catch {
      broken = `${label} could not be read. It was left exactly as it is; changes can't be saved until it's fixed.`;
      try { cache = parse(`${file}.bak`); } catch { cache = empty(); }
    }
    return cache;
  }
  function write(value) {
    read();
    if (broken) throw new Error(broken);
    if (fs.existsSync(file)) {
      try { parse(file); } catch { broken = `${label} could not be read, so it was not overwritten.`; throw new Error(broken); }
      fs.copyFileSync(file, `${file}.bak`);
    }
    atomicWrite(file, JSON.stringify(value, null, 1));
    cache = value;
    return value;
  }
  return { read, write, file, broken: () => (read(), broken), reset: () => { cache = null; } };
}

module.exports = { createJsonFile, atomicWrite };

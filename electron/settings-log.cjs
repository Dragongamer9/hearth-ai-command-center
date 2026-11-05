// Settings: what really changed, and a simple log of it (Settings › Saved data).
// The owner's rule: settings never change by themselves.
// - diffSettings(before, after): only the leaves that really changed ("tools.web", "team").
//   main.cjs writes ONLY those into settings.json, so the defaults shown at read time are
//   never saved for him (before 1.7.x every click also saved every default).
// - The log: time, what changed (old -> new) and who (the owner's click, a change made
//   outside the app that he kept, an AI's change the app undid). Atomic writes, a .bak, and
//   a log that can't be read is never overwritten (electron/jsonfile.cjs).
const { createJsonFile } = require('./jsonfile.cjs');

const MAX = 500;
const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Objects whose own keys are separate settings (a change to one never rewrites the others).
const NESTED = new Set(['tools', 'connection', 'bins', 'teammates', 'customInstructions']);

function diffSettings(before = {}, after = {}) {
  const out = [];
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const a = before?.[k];
    const b = after?.[k];
    if (same(a, b)) continue;
    if (NESTED.has(k) && (plain(a) || a === undefined) && (plain(b) || b === undefined)) {
      for (const kk of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
        if (!same(a?.[kk], b?.[kk])) out.push({ key: `${k}.${kk}`, path: [k, kk], from: a?.[kk], to: b?.[kk] });
      }
    } else out.push({ key: k, path: [k], from: a, to: b });
  }
  return out;
}

// Put only the changed leaves into the raw saved object (a copy; the input is untouched).
function applyChanges(raw, changes) {
  const out = JSON.parse(JSON.stringify(plain(raw) ? raw : {}));
  for (const c of changes) {
    if (c.path.length === 1) { if (c.to === undefined) delete out[c.path[0]]; else out[c.path[0]] = c.to; continue; }
    const [k, kk] = c.path;
    if (!plain(out[k])) out[k] = {};
    if (c.to === undefined) delete out[k][kk]; else out[k][kk] = c.to;
  }
  return out;
}

const short = (v) => {
  if (v === undefined) return '(not set)';
  const t = JSON.stringify(v);
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
};

function createSettingsLog(file, { now = () => new Date().toISOString() } = {}) {
  const store = createJsonFile(file, { empty: () => ({ entries: [] }), check: (j) => Array.isArray(j.entries), label: 'The settings change log' });
  function add(changes, by) {
    if (!changes.length) return [];
    const at = now();
    const entries = changes.map((c) => ({ at, key: c.key, from: short(c.from), to: short(c.to), by: String(by || 'owner') }));
    try {
      const cur = store.read();
      store.write({ entries: [...cur.entries, ...entries].slice(-MAX) });
    } catch { /* a broken log never stops a settings change; the log says it can't be read */ }
    return entries;
  }
  return { add, list: () => ({ entries: [...store.read().entries].reverse(), broken: store.broken() }), file };
}

module.exports = { diffSettings, applyChanges, createSettingsLog, NESTED };

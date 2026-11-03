// The owner's approval-level choices as saved in settings.json (main process side).
// Mirrors src/ops/approval.mjs (a unit test keeps the two in step). Only categories the
// owner may move are stored; owner-only ones (merge to main, releases, version numbers,
// tags, app settings) can never be saved as anything else.
const MOVABLE = {
  attach: 'routine', read: 'routine', tests: 'routine', edit: 'routine', review: 'routine', screenshot: 'routine',
  install: 'major', outside: 'major', command: 'major', delete: 'major', network: 'major', push: 'major',
};
const OWNER_ONLY = ['merge', 'release', 'version', 'tag', 'settings'];
// boot and secrets are fixed Major: never movable to Routine.
const FIXED = ['boot', 'secrets'];

// Saved = only the owner's differences from the defaults.
function cleanSavedLevels(saved) {
  const out = {};
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return out;
  for (const [k, dflt] of Object.entries(MOVABLE)) {
    const v = saved[k];
    if ((v === 'routine' || v === 'major') && v !== dflt) out[k] = v;
  }
  return out;
}

module.exports = { MOVABLE, OWNER_ONLY, FIXED, cleanSavedLevels };

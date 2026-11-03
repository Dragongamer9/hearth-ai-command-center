// Releases and tags by the lead (each behind its own owner switch, off by default):
// only the owner's Next version, only when the version file on main already says it,
// never an existing release or tag. Version files are never edited here.
const VERSION_RE = /^\d{1,4}\.\d{1,4}(\.\d{1,6})?$/;

// The version a version file states (package.json "version", or a plain VERSION file).
function fileVersion(name, text) {
  if (/\.json$/i.test(name)) { try { return String(JSON.parse(text).version || '') || null; } catch { return null; } }
  const m = String(text || '').match(/\b(\d{1,4}\.\d{1,4}(?:\.\d{1,6})?)\b/);
  return m ? m[1] : null;
}

function checkLead({ kind, leadActions, switchOn, requested, next, fileVer, exists }) {
  const v = String(requested || '').replace(/^v/, '');
  const what = kind === 'tag' ? 'tags' : 'releases';
  if (leadActions !== true) return { ok: false, reason: 'the lead switch is off' };
  if (switchOn !== true) return { ok: false, reason: `the lead may not create ${what} (the Owner's switch is off)` };
  if (!next || !VERSION_RE.test(next)) return { ok: false, reason: 'the Owner has not set a Next version' };
  if (v !== next) return { ok: false, reason: `only v${next} (the Owner's Next version) is allowed, not ${requested}` };
  if (fileVer !== next) return { ok: false, reason: `the version file on main says ${fileVer || 'nothing'}, not ${next}; the Owner sets the version first` };
  if (exists) return { ok: false, reason: `v${next} already ${kind === 'tag' ? 'exists as a tag' : 'has a release'}` };
  return { ok: true, version: v, tag: `v${v}` };
}

const tagArgs = (v, sha) => ['tag', '-a', `v${v}`, '-m', `Release v${v}`, sha];
const pushTagArgs = (v) => ['push', 'origin', `refs/tags/v${v}`]; // never --force, never a delete

module.exports = { VERSION_RE, fileVersion, checkLead, tagArgs, pushTagArgs };

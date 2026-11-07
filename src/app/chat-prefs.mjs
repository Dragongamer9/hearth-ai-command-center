// Each chat keeps its own composer settings (2.2.1): who it talks to (the team or one AI), web
// search, Run & build and deep research. They're saved with the chat (sessions._prefs, in the
// chat's own file: atomic, with a backup, never written over when it can't be read) and only
// when the owner changes one in that chat. A chat without saved ones, and every new chat, uses
// the owner's defaults (Settings), never what the last chat used. Pure, unit tested.
export const PREF_KEYS = ['mode', 'web', 'build', 'deep'];
const MODE_RE = /^[a-z]{2,16}$/;

export function defaultsFrom(settings = {}) {
  return { mode: 'team', web: settings?.tools?.web !== false, build: settings?.tools?.build !== false, deep: false };
}
export function cleanPrefs(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const out = {};
  if (typeof p.mode === 'string' && MODE_RE.test(p.mode)) out.mode = p.mode;
  for (const k of ['web', 'build', 'deep']) if (typeof p[k] === 'boolean') out[k] = p[k];
  return Object.keys(out).length ? out : null;
}
// What a chat uses: its own saved choices over the defaults.
export function prefsFor(R, settings) {
  return { ...defaultsFrom(settings), ...(cleanPrefs(R?.sessions?._prefs) || {}) };
}
export const prefsOf = (S) => ({ mode: S.mode, web: S.web, build: S.build, deep: S.deep });
export const samePrefs = (a, b) => PREF_KEYS.every((k) => a?.[k] === b?.[k]);
export function applyPrefs(S, p) { for (const k of PREF_KEYS) S[k] = p[k]; return S; }
// The owner changed a switch: the chat's own copy (nothing is saved for a chat he didn't change).
export function rememberPrefs(R, S) {
  if (!R) return false;
  R.sessions = R.sessions && typeof R.sessions === 'object' ? R.sessions : {};
  R.sessions._prefs = prefsOf(S);
  return true;
}

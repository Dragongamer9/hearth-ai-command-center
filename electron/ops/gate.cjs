// The release gate (pure, unit tested; enforced in the main process before any tag or
// release): version files equal the Next version, every release-notes line maps to a
// merged commit, the full test suite passes at that commit, and the authorship check passes.
// It waits until the checklist passes, or the Owner overrides it explicitly.
const short = (sha) => (sha ? String(sha).slice(0, 7) : '');
const clip = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ''));

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'when', 'your', 'now', 'are', 'was', 'its', 'has', 'have', 'not', 'can', 'all', 'new', 'more', 'less', 'only', 'also', 'after', 'before', 'each', 'every', 'than', 'then', 'they', 'them', 'their', 'what', 'which', 'while', 'will', 'just', 'like', 'over', 'same', 'some', 'very', 'progress', 'merge', 'approved', 'hearth', 'command', 'center']);
const words = (s) => [...new Set(String(s || '').toLowerCase().replace(/[^a-z0-9.+ ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
// Every item in the release notes must map to merged commits (or tasks) since the last tag.
// commits: [{ sha, subject }], tasks: [{ id, title }] merged since the last tag.
function validateNotes(notes, commits = [], tasks = []) {
  const items = String(notes || '').split('\n').map((l) => l.trim()).filter((l) => /^([-*•]|\d+[.)])\s+/.test(l)).map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, ''));
  const subjects = commits.map((c) => ({ ref: short(c.sha), text: c.subject || '', w: words(c.subject) }));
  const tw = tasks.map((t) => ({ ref: `T-${t.id}`, text: t.title || '', w: words(t.title) }));
  const lines = items.map((text) => {
    const id = text.match(/\bT-([A-Z0-9]{4,12})\b/)?.[1];
    if (id) {
      const hit = tw.find((x) => x.ref === `T-${id}`) || subjects.find((s) => s.text.toLowerCase().includes(id.toLowerCase()));
      return { text, ok: Boolean(hit), match: hit?.ref || null };
    }
    const pr = text.match(/#(\d+)\b/)?.[1];
    if (pr) { const hit = subjects.find((s) => new RegExp(`#${pr}\\b`).test(s.text)); if (hit) return { text, ok: true, match: hit.ref }; }
    const lw = words(text);
    let best = null;
    for (const s of [...subjects, ...tw]) {
      const shared = lw.filter((w) => s.w.includes(w)).length;
      if (shared >= 2 || (lw.length && shared / lw.length >= 0.5 && shared >= 1)) { if (!best || shared > best.shared) best = { ...s, shared }; }
    }
    return { text, ok: Boolean(best), match: best?.ref || null };
  });
  return { lines, unmatched: lines.filter((l) => !l.ok).map((l) => l.text), empty: items.length === 0 };
}
// facts: { version, next, fileVersion, sha, notes (text or null), commits, tasks, tests: {status}, authorship: {ok, problems} }
function releaseChecklist(f = {}) {
  const ver = String(f.version || '').replace(/^v/, '');
  const nv = validateNotes(f.notes || '', f.commits || [], f.tasks || []);
  return [
    { id: 'version', label: `Version files equal the Next version (v${f.next || '?'})`, ok: Boolean(ver && f.next && ver === String(f.next).replace(/^v/, '') && f.fileVersion === ver), detail: !f.next ? 'No Next version set on the Project page.' : ver !== String(f.next).replace(/^v/, '') ? `Asked for v${ver}, but the Next version is v${f.next}.` : f.fileVersion !== ver ? `The version file says ${f.fileVersion || 'nothing'} at ${short(f.sha)}.` : `${f.fileVersion} at ${short(f.sha)}` },
    { id: 'notes', label: `release-notes/v${ver}.md maps to merged commits on main`, ok: f.notes != null && !nv.empty && nv.unmatched.length === 0, detail: f.notes == null ? `release-notes/v${ver}.md is missing at ${short(f.sha)}.` : nv.empty ? 'The notes have no items.' : nv.unmatched.length ? `${nv.unmatched.length} line(s) match no merged commit: ${nv.unmatched.map((x) => `“${clip(x, 60)}”`).join(', ')}` : `${nv.lines.length} item(s), all matched`, lines: nv.lines },
    { id: 'tests', label: `Full test suite passes at ${short(f.sha) || 'the commit'}`, ok: f.tests?.status === 'passed', detail: f.tests ? `${f.tests.status}${f.tests.command ? ` — ${f.tests.command}` : ''}${f.tests.reason ? ` (${f.tests.reason})` : ''}` : 'not run' },
    { id: 'authorship', label: 'Authorship check passes (only the owner, no AI attribution)', ok: f.authorship?.ok === true, detail: f.authorship?.ok ? `${(f.commits || []).length} commit(s) checked` : (f.authorship?.problems || ['not checked']).slice(0, 3).join('; ') },
  ];
}
function releaseGate(list = [], override = null) {
  const failed = list.filter((c) => !c.ok);
  if (!failed.length && list.length) return { ok: true, reason: 'all checks passed' };
  if (override && override.by === 'owner' && String(override.reason || '').trim()) return { ok: true, overridden: true, reason: `overridden by the Owner: ${override.reason}` };
  return { ok: false, reason: list.length ? `release checklist failed: ${failed.map((c) => c.label).join('; ')}` : 'no release preview yet' };
}

module.exports = { validateNotes, releaseChecklist, releaseGate };

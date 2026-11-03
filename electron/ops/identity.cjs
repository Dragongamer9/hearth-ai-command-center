// Every commit the app or any AI makes is under the owner's name only: the owner
// identity goes into GIT_AUTHOR_*/GIT_COMMITTER_* for every run and git operation,
// task worktrees get hooks that strip AI attribution trailers, and a guard checks the
// commits before anything is pushed, merged, released or tagged.
const fs = require('node:fs');
const path = require('node:path');

const EMAIL_RE = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
// One name plus every email the owner commits with (the first is used for new commits).
function cleanIdentity(v) {
  if (!v || typeof v !== 'object') return null;
  const name = String(v.name || '').replace(/[\r\n<>]/g, '').trim().slice(0, 100);
  const list = [...(Array.isArray(v.emails) ? v.emails : []), v.email].map((e) => String(e || '').trim().slice(0, 200)).filter((e) => EMAIL_RE.test(e));
  const emails = [...new Set(list.map((e) => e.toLowerCase()))].map((l) => list.find((e) => e.toLowerCase() === l)).slice(0, 10);
  return name && emails.length ? { name, email: emails[0], emails } : null;
}
// "Name <a@x>, <b@y>" or "Name <a@x>"
function parseIdentity(text) {
  const t = String(text || '');
  const name = t.split('<')[0].trim();
  const emails = [...t.matchAll(/<([^<>\s]+)>/g)].map((m) => m[1]);
  return cleanIdentity({ name, emails });
}
// Suggestions only: shown for the owner to confirm, never saved by themselves.
const KNOWN = { dragongamer9: ['Dragongamer9@users.noreply.github.com', '43799111+Dragongamer9@users.noreply.github.com', 'game305.cl@gmail.com'] };
function suggestIdentity(name, email) {
  const n = String(name || '').trim();
  const seeds = KNOWN[n.toLowerCase()] || [];
  return cleanIdentity({ name: n, emails: [email, ...seeds] });
}
const WEB_FLOW = { name: 'GitHub', email: 'noreply@github.com' };
const gitEnv = (id) => (id ? { GIT_AUTHOR_NAME: id.name, GIT_AUTHOR_EMAIL: id.email, GIT_COMMITTER_NAME: id.name, GIT_COMMITTER_EMAIL: id.email } : {});

// AI attribution trailers and lines, in any case.
const TRAILER_RE = /^\s*(co-authored-by:|claude-session:|generated-by:|ai-assisted-by:|assisted-by:\s*(claude|chatgpt|codex|gemini|grok|copilot|mistral|qwen)|\W{0,3}\s*generated (with|by) (\[?claude|claude code|codex|chatgpt|gemini|grok|copilot|mistral|qwen|an ai|ai\b))/i;
function stripTrailers(msg) {
  const out = String(msg || '').split('\n').filter((l) => !TRAILER_RE.test(l)).join('\n');
  return `${out.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`;
}
const hasTrailer = (msg) => String(msg || '').split('\n').some((l) => TRAILER_RE.test(l));

// The hook (commit-msg and prepare-commit-msg): same filter, in POSIX sh + grep -E.
const HOOK_MARK = '# hearth-ai-command-center: strip AI attribution';
function hookScript() {
  return `#!/bin/sh
${HOOK_MARK}
f="$1"
# Only for commits made by the app or an AI it runs; the owner's own commits are left alone.
[ "$HEARTH_AI_APP" = "1" ] || exit 0
[ -f "$f" ] || exit 0
grep -v -i -E '^[[:space:]]*(co-authored-by:|claude-session:|generated-by:|ai-assisted-by:|assisted-by:[[:space:]]*(claude|chatgpt|codex|gemini|grok|copilot|mistral|qwen)|[^[:alnum:]]{0,6}[[:space:]]*generated (with|by) (\\[?claude|claude code|codex|chatgpt|gemini|grok|copilot|mistral|qwen|an ai|ai([^[:alnum:]]|$)))' "$f" > "$f.hearth" || true
mv "$f.hearth" "$f"
exit 0
`;
}

// Install the hooks in the repo's hooks folder (shared by its worktrees). An existing hook
// that isn't ours is left alone (the guard still checks every commit before publishing).
function installHooks(hooksDir) {
  const done = [];
  const skipped = [];
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const name of ['commit-msg', 'prepare-commit-msg']) {
    const f = path.join(hooksDir, name);
    let cur = null;
    try { cur = fs.readFileSync(f, 'utf8'); } catch {}
    if (cur && !cur.includes(HOOK_MARK)) { skipped.push(name); continue; }
    fs.writeFileSync(f, hookScript(), { mode: 0o755 });
    done.push(name);
  }
  return { done, skipped };
}

// log: `git log --format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e <range>`
function parseLog(text) {
  return String(text || '').split('\x1e').map((r) => r.replace(/^\n/, '')).filter((r) => r.trim()).map((r) => {
    const [sha, an, ae, cn, ce, parents = '', body = ''] = r.split('\x1f');
    return { sha, an, ae, cn, ce, parents: parents.split(' ').filter(Boolean), body };
  });
}
// ownerRelease: the owner's own Release button only refuses commits someone else authored.
function scanCommits(commits, id, { ownerRelease = false } = {}) {
  if (!id) return { ok: false, problems: ['No owner identity is set (Settings › Owner identity).'] };
  const emails = (id.emails || [id.email]).map((e) => String(e).toLowerCase());
  const same = (n, e) => n === id.name && emails.includes(String(e).toLowerCase());
  const problems = [];
  for (const c of commits) {
    const mine = same(c.an, c.ae);
    if (!mine) problems.push(`${c.sha.slice(0, 7)} is authored by ${c.an} <${c.ae}>`);
    if (ownerRelease && mine) continue;
    // GitHub's web-flow committer on a merge commit the owner authored (merged on github.com).
    const webFlow = mine && c.cn === WEB_FLOW.name && String(c.ce).toLowerCase() === WEB_FLOW.email && c.parents.length >= 2;
    if (!same(c.cn, c.ce) && !webFlow) problems.push(`${c.sha.slice(0, 7)} is committed by ${c.cn} <${c.ce}>`);
    if (hasTrailer(c.body)) problems.push(`${c.sha.slice(0, 7)} has an AI attribution line`);
  }
  return { ok: !problems.length, problems, count: commits.length };
}
const LOG_FORMAT = '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%P%x1f%B%x1e';

// Rewriting authorship is only for the app's own unpublished task branches.
function rewriteAllowed({ branch, remoteBranchesContaining = [] }) {
  if (!/^hearth\/[a-z0-9]/.test(String(branch || ''))) return { ok: false, reason: 'only the app\'s own task branches (hearth/…) can be rewritten, never main or other branches' };
  if (remoteBranchesContaining.length) return { ok: false, reason: `these commits are already on GitHub (${remoteBranchesContaining.slice(0, 3).join(', ')}), so they can't be rewritten` };
  return { ok: true };
}

// Paths go through env vars, never a quoted shell string.
const REWRITE_EXEC = 'git log -1 --format=%B > "$HEARTH_MSG" && sh "$HEARTH_HOOK" "$HEARTH_MSG" && git commit --amend -q --no-verify --reset-author -F "$HEARTH_MSG"';
const rewriteEnv = (env, msg, hook) => ({ ...env, HEARTH_MSG: msg, HEARTH_HOOK: hook, HEARTH_AI_APP: '1' });

module.exports = { REWRITE_EXEC, rewriteEnv, suggestIdentity, WEB_FLOW, cleanIdentity, parseIdentity, gitEnv, TRAILER_RE, stripTrailers, hasTrailer, hookScript, installHooks, HOOK_MARK, parseLog, scanCommits, LOG_FORMAT, rewriteAllowed };

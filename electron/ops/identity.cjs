// Every commit the app or any AI makes is under the owner's name only: the owner
// identity goes into GIT_AUTHOR_*/GIT_COMMITTER_* for every run and git operation,
// task worktrees get hooks that strip AI attribution trailers, and a guard checks the
// commits before anything is pushed, merged, released or tagged.
const fs = require('node:fs');
const path = require('node:path');

const EMAIL_RE = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
function cleanIdentity(v) {
  if (!v || typeof v !== 'object') return null;
  const name = String(v.name || '').replace(/[\r\n<>]/g, '').trim().slice(0, 100);
  const email = String(v.email || '').trim().slice(0, 200);
  return name && EMAIL_RE.test(email) ? { name, email } : null;
}
function parseIdentity(text) {
  const m = String(text || '').match(/^\s*([^<>]+?)\s*<([^<>\s]+)>\s*$/);
  return m ? cleanIdentity({ name: m[1], email: m[2] }) : null;
}
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
    const [sha, an, ae, cn, ce, body = ''] = r.split('\x1f');
    return { sha, an, ae, cn, ce, body };
  });
}
function scanCommits(commits, id) {
  if (!id) return { ok: false, problems: ['No owner identity is set (Settings › Owner identity).'] };
  const problems = [];
  const same = (n, e) => n === id.name && String(e).toLowerCase() === id.email.toLowerCase();
  for (const c of commits) {
    if (!same(c.an, c.ae)) problems.push(`${c.sha.slice(0, 7)} is authored by ${c.an} <${c.ae}>`);
    if (!same(c.cn, c.ce)) problems.push(`${c.sha.slice(0, 7)} is committed by ${c.cn} <${c.ce}>`);
    if (hasTrailer(c.body)) problems.push(`${c.sha.slice(0, 7)} has an AI attribution line`);
  }
  return { ok: !problems.length, problems, count: commits.length };
}
const LOG_FORMAT = '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e';

// Rewriting authorship is only for the app's own unpublished task branches.
function rewriteAllowed({ branch, remoteBranchesContaining = [] }) {
  if (!/^hearth\/[a-z0-9]/.test(String(branch || ''))) return { ok: false, reason: 'only the app\'s own task branches (hearth/…) can be rewritten, never main or other branches' };
  if (remoteBranchesContaining.length) return { ok: false, reason: `these commits are already on GitHub (${remoteBranchesContaining.slice(0, 3).join(', ')}), so they can't be rewritten` };
  return { ok: true };
}

module.exports = { cleanIdentity, parseIdentity, gitEnv, TRAILER_RE, stripTrailers, hasTrailer, hookScript, installHooks, HOOK_MARK, parseLog, scanCommits, LOG_FORMAT, rewriteAllowed };

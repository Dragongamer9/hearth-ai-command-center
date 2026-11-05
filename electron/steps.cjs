// What an AI did during a turn, as compact steps for the chat ("Searched the repo",
// "Read files", "Read a web page", "Edited files", "Ran checks", "Pushed", "Actions").
// Parsed from Claude Code's --output-format stream-json events and Codex's --json events.
// Pure, unit tested (test/v2-steps.test.cjs).
const path = require('node:path');

const CHECK_RE = /^(node --check|node --test|npm (run )?test|npx (vitest|jest|eslint|tsc)|python3? -m (py_compile|pytest|unittest)|pytest|bash -n|sh -n|shellcheck|cargo (check|fmt --check|clippy)|go vet|ruff|flake8|tsc --noEmit|qmllint|make (check|test)|dotnet (build|test))\b/;

const short = (s, n = 140) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const base = (p) => (p ? path.basename(String(p)) : '');
const host = (u) => { try { return new URL(String(u)).host; } catch { return short(u, 60); } };

function bashStep(cmd) {
  const c = String(cmd || '').trim().replace(/^(cd [^&;]+(&&|;)\s*)+/, '');
  if (/^git push\b/.test(c)) return { kind: 'push', label: 'Pushed', detail: short(c, 90) };
  if (/^git commit\b/.test(c)) return { kind: 'commit', label: 'Committed', detail: '' };
  if (/^gh run (watch|view|list)\b/.test(c)) return { kind: 'actions', label: 'Checked GitHub Actions', detail: short(c, 90) };
  if (/^gh pr\b/.test(c)) return { kind: 'pr', label: 'Pull request', detail: short(c, 90) };
  if (/^(grep|rg|git grep|find|ag)\b/.test(c)) return { kind: 'search', label: 'Searched the repo', detail: short(c, 90) };
  if (/^(cat|head|tail|sed -n|less|ls|tree|wc|git (log|show|diff|status))\b/.test(c)) return { kind: 'read', label: 'Looked at', detail: short(c, 90) };
  if (CHECK_RE.test(c)) return { kind: 'check', label: 'Ran checks locally', detail: short(c, 90) };
  return { kind: 'run', label: 'Ran', detail: short(c, 90) };
}

// One Claude Code tool use -> a step (or null for bookkeeping tools).
function claudeTool(name, input = {}) {
  const i = input && typeof input === 'object' ? input : {};
  switch (name) {
    case 'Grep': return { kind: 'search', label: 'Searched the repo', detail: i.pattern ? `for “${short(i.pattern, 60)}”` : '' };
    case 'Glob': return { kind: 'search', label: 'Looked for files', detail: short(i.pattern, 60) };
    case 'Read': case 'NotebookRead': return { kind: 'read', label: 'Read', detail: base(i.file_path || i.notebook_path), file: i.file_path || i.notebook_path || '' };
    case 'LS': return { kind: 'read', label: 'Listed', detail: base(i.path) || '.' };
    case 'WebSearch': return { kind: 'web-search', label: 'Searched the web', detail: i.query ? `for “${short(i.query, 80)}”` : '' };
    case 'WebFetch': return { kind: 'web-read', label: 'Read a web page', detail: host(i.url), url: /^https?:\/\//.test(String(i.url || '')) ? String(i.url) : '' };
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': return { kind: 'edit', label: name === 'Write' ? 'Wrote' : 'Edited', detail: base(i.file_path || i.notebook_path), file: i.file_path || i.notebook_path || '' };
    case 'Bash': return bashStep(i.command);
    case 'Task': case 'Agent': return { kind: 'task', label: 'Asked a helper', detail: short(i.description || i.prompt, 80) };
    case 'TodoWrite': case 'ExitPlanMode': case 'BashOutput': case 'KillShell': return null;
    default: return { kind: 'tool', label: `Used ${short(name, 30)}`, detail: '' };
  }
}

// A stream-json event from `claude -p --output-format stream-json --verbose`.
function fromClaudeEvent(ev) {
  if (!ev || typeof ev !== 'object' || ev.type !== 'assistant') return [];
  const content = Array.isArray(ev.message?.content) ? ev.message.content : [];
  return content.filter((c) => c && c.type === 'tool_use').map((c) => claudeTool(String(c.name || ''), c.input)).filter(Boolean);
}

// A JSONL event from `codex exec --json`.
function fromCodexEvent(ev) {
  if (!ev || typeof ev !== 'object' || ev.type !== 'item.started') return [];
  const it = ev.item || {};
  if (it.type === 'command_execution') return [bashStep(it.command)];
  if (it.type === 'file_change') return (Array.isArray(it.changes) ? it.changes : []).map((c) => ({ kind: 'edit', label: 'Edited', detail: base(c.path), file: c.path || '' }));
  if (it.type === 'web_search') return [{ kind: 'web-search', label: 'Searched the web', detail: it.query ? `for “${short(it.query, 80)}”` : '' }];
  if (it.type === 'mcp_tool_call') return [{ kind: 'tool', label: `Used ${short(it.tool || it.server || 'a tool', 30)}`, detail: '' }];
  return [];
}

function fromEvent(agent, ev) {
  if (agent === 'anthropic') return fromClaudeEvent(ev);
  if (agent === 'openai') return fromCodexEvent(ev);
  return [];
}

module.exports = { fromEvent, fromClaudeEvent, fromCodexEvent, claudeTool, bashStep, CHECK_RE };

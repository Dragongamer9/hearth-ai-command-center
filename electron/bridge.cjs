// Chat bridge, CLI side: finds the conversations each official CLI already keeps
// on this computer, so sessions started in those CLIs (outside the app) show up
// in the app's history, and sessions started from the app can be resumed in the
// CLI. Read-only: these files belong to the CLIs and are never modified.
//
//   Claude Code  ~/.claude/projects/<project>/<session-id>.jsonl   (CLAUDE_CONFIG_DIR)
//   Codex CLI    ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl[.zst] (CODEX_HOME)
//   Gemini CLI   ~/.gemini/tmp/<project-hash>/chats/*.json, checkpoint-*.json
//   Qwen Code    ~/.qwen/tmp/… and ~/.qwen/projects/…  (Gemini-CLI based; best effort)
//   Grok Build   ~/.grok/sessions/…                     (GROK_HOME; format undocumented, best effort)
// Each CLI documents its transcript format as internal and subject to change,
// so every parser here is tolerant and skips what it doesn't understand.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const MAX_FILES = 400;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_MSG = 8000;
const MAX_MSGS = 600;

const clip = (s) => (s.length > MAX_MSG ? `${s.slice(0, MAX_MSG)} …[trimmed]` : s);

function textOf(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join('\n');
  if (v && typeof v === 'object') {
    if (v.type && !['text', 'input_text', 'output_text'].includes(v.type) && !('text' in v)) return '';
    return textOf(v.text ?? v.content ?? v.parts ?? '');
  }
  return '';
}

function roleOf(v) {
  const r = String(v || '').toLowerCase();
  if (['user', 'human', 'owner', 'you'].includes(r)) return 'user';
  if (['assistant', 'model', 'gemini', 'ai', 'bot', 'agent', 'claude', 'grok', 'qwen'].includes(r)) return 'assistant';
  return null;
}

// Files under dir matching re, newest first, at most `max`, up to `depth` levels.
function walk(dir, re, depth = 4, max = MAX_FILES) {
  const out = [];
  const visit = (d, lvl) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) { if (lvl < depth) visit(p, lvl + 1); continue; }
      if (!e.isFile() || !re.test(e.name)) continue;
      try {
        const st = fs.statSync(p);
        if (st.size <= MAX_BYTES) out.push({ file: p, mtime: st.mtimeMs, size: st.size });
      } catch {}
    }
  };
  visit(dir, 0);
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, max);
}

function readText(file) {
  const buf = fs.readFileSync(file);
  if (file.endsWith('.zst')) {
    if (typeof zlib.zstdDecompressSync !== 'function') return null; // older runtimes
    return zlib.zstdDecompressSync(buf).toString('utf8');
  }
  return buf.toString('utf8');
}

function jsonl(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

function finish(conv) {
  conv.messages = conv.messages.filter((m) => m.text && m.text.trim()).slice(-MAX_MSGS).map((m) => ({ ...m, text: clip(m.text.trim()) }));
  if (!conv.messages.length) return null;
  const firstUser = conv.messages.find((m) => m.role === 'user');
  conv.title = (conv.title || firstUser?.text || conv.messages[0].text).replace(/\s+/g, ' ').slice(0, 120);
  conv.startedAt = conv.startedAt || conv.messages[0].at || null;
  conv.updatedAt = conv.updatedAt || conv.messages[conv.messages.length - 1].at || conv.startedAt;
  return conv;
}

// ---- Claude Code ----
function parseClaudeSession(text, { file = '' } = {}) {
  const conv = { provider: 'anthropic', sessionId: path.basename(file, '.jsonl') || null, cwd: null, title: null, messages: [] };
  for (const j of jsonl(text)) {
    if (j.type === 'summary' && typeof j.summary === 'string') { conv.title = conv.title || j.summary; continue; }
    if ((j.type === 'custom-title' || j.type === 'session-title') && typeof j.title === 'string') { conv.title = j.title; continue; }
    if (j.sessionId && !conv.sessionId) conv.sessionId = j.sessionId;
    if (j.cwd && !conv.cwd) conv.cwd = j.cwd;
    if (j.isSidechain || j.isMeta) continue;
    if (j.type !== 'user' && j.type !== 'assistant') continue;
    const content = j.message?.content;
    const text = Array.isArray(content) ? content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : textOf(content);
    if (!text || /^<(command-name|local-command-stdout|command-message)>/.test(text.trim())) continue;
    conv.messages.push({ role: j.type, text, at: j.timestamp || null });
  }
  return finish(conv);
}

// ---- Codex CLI ----
const CODEX_NOISE = /^\s*(<environment_context>|<user_instructions>|<permissions instructions>|# AGENTS\.md|<turn_aborted>)/;
function parseCodexSession(text, { file = '' } = {}) {
  const idFromName = (path.basename(file).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || [])[1] || null;
  const conv = { provider: 'openai', sessionId: idFromName, cwd: null, title: null, messages: [] };
  const events = [];
  for (const j of jsonl(text)) {
    const type = j.type;
    const p = j.payload || j;
    if (type === 'session_meta' || (!type && j.id && j.instructions !== undefined)) {
      conv.sessionId = p.id || conv.sessionId;
      conv.cwd = p.cwd || conv.cwd;
      conv.startedAt = p.timestamp || j.timestamp || null;
      continue;
    }
    if ((type === 'response_item' || !type) && p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
      const t = textOf(p.content);
      if (p.role === 'user' && CODEX_NOISE.test(t)) continue;
      conv.messages.push({ role: p.role, text: t, at: j.timestamp || null });
      continue;
    }
    if (type === 'event_msg' && (p.type === 'user_message' || p.type === 'agent_message') && typeof p.message === 'string') {
      events.push({ role: p.type === 'user_message' ? 'user' : 'assistant', text: p.message, at: j.timestamp || null });
    }
  }
  if (!conv.messages.length) conv.messages = events;
  return finish(conv);
}

// ---- Gemini CLI (and Qwen Code, which is built on it) ----
function parseGeminiSession(text, { file = '', provider = 'google' } = {}) {
  let j;
  try { j = JSON.parse(text); } catch { return generic(text, { file, provider }); }
  const conv = { provider, sessionId: null, cwd: null, title: null, messages: [], projectHash: null };
  if (Array.isArray(j)) {
    // checkpoint-<tag>.json from /chat save: [{role, parts}]
    conv.sessionId = `checkpoint:${path.basename(file, '.json').replace(/^checkpoint-/, '')}`;
    conv.checkpoint = true;
    for (const c of j) {
      const role = roleOf(c?.role);
      if (role) conv.messages.push({ role, text: textOf(c.parts), at: null });
    }
  } else if (j && Array.isArray(j.messages)) {
    conv.sessionId = j.sessionId || path.basename(file, '.json');
    conv.projectHash = j.projectHash || null;
    conv.startedAt = j.startTime || null;
    conv.updatedAt = j.lastUpdated || null;
    for (const m of j.messages) {
      const role = roleOf(m?.type || m?.role);
      if (role) conv.messages.push({ role, text: textOf(m.content ?? m.parts), at: m.timestamp || null });
    }
  } else {
    return generic(text, { file, provider });
  }
  if (!conv.projectHash) conv.projectHash = (file.match(/[\\/]tmp[\\/]([0-9a-f]{16,})[\\/]/) || [])[1] || null;
  return finish(conv);
}

// Gemini names a project's folder by the SHA-256 of its root path.
const projectHash = (dir) => crypto.createHash('sha256').update(dir).digest('hex');

// ---- Anything message-shaped (Grok, Qwen layouts we haven't seen) ----
function messagesFrom(v, depth = 0) {
  if (depth > 4 || !v) return [];
  if (Array.isArray(v)) {
    const msgs = v.map((x) => ({ role: roleOf(x?.role || x?.type || x?.sender || x?.author?.role || x?.author || x?.message?.role), text: textOf(x?.content ?? x?.text ?? x?.message?.content ?? x?.parts ?? ''), at: x?.timestamp || x?.created_at || x?.time || null })).filter((m) => m.role && m.text);
    if (msgs.length) return msgs;
    for (const x of v) { const inner = messagesFrom(x, depth + 1); if (inner.length) return inner; }
    return [];
  }
  if (typeof v === 'object') {
    for (const k of ['messages', 'history', 'conversation', 'turns', 'items', 'chat_messages']) {
      if (Array.isArray(v[k])) { const m = messagesFrom(v[k], depth + 1); if (m.length) return m; }
    }
  }
  return [];
}

function generic(text, { file = '', provider }) {
  let messages = [];
  let meta = {};
  try {
    const j = JSON.parse(text);
    messages = messagesFrom(j);
    meta = Array.isArray(j) ? {} : j;
  } catch {
    const lines = jsonl(text);
    messages = messagesFrom(lines);
    meta = lines.find((l) => l && (l.session_id || l.sessionId || l.cwd)) || {};
  }
  const conv = {
    provider,
    sessionId: meta.session_id || meta.sessionId || meta.id || path.basename(file).replace(/\.(jsonl?|json)$/, ''),
    cwd: meta.cwd || null,
    title: meta.title || meta.name || null,
    messages,
    bestEffort: true,
  };
  return finish(conv);
}

function homeOf(envVar, fallback) {
  const v = process.env[envVar];
  return v && path.isAbsolute(v) ? v : path.join(os.homedir(), fallback);
}

// Every CLI conversation on this computer (newest first, bounded).
// knownDirs: folders the app knows (projects, task worktrees) to map Gemini's
// project hashes back to a folder so `gemini --resume` runs in the right place.
function scanAll({ knownDirs = [] } = {}) {
  const out = [];
  const hashes = new Map(knownDirs.map((d) => [projectHash(d), d]));
  const add = (conv, file) => { if (conv) out.push({ ...conv, file }); };
  const tryParse = (fn, f, opts) => { try { const t = readText(f.file); if (t) add(fn(t, { file: f.file, ...opts }), f.file); } catch {} };

  for (const f of walk(path.join(homeOf('CLAUDE_CONFIG_DIR', '.claude'), 'projects'), /\.jsonl$/, 1)) tryParse(parseClaudeSession, f);
  for (const f of walk(path.join(homeOf('CODEX_HOME', '.codex'), 'sessions'), /^rollout-.*\.jsonl(\.zst)?$/, 4)) tryParse(parseCodexSession, f);
  for (const f of walk(path.join(os.homedir(), '.gemini', 'tmp'), /^(session-.*|checkpoint-.*)\.json$|^[^.]+\.json$/, 2)) tryParse(parseGeminiSession, f);
  const qwen = path.join(os.homedir(), '.qwen');
  for (const sub of ['tmp', 'projects']) for (const f of walk(path.join(qwen, sub), /\.(json|jsonl)$/, 3)) tryParse(parseGeminiSession, f, { provider: 'qwen' });
  for (const f of walk(path.join(homeOf('GROK_HOME', '.grok'), 'sessions'), /\.(json|jsonl)$/, 3)) tryParse(generic, f, { provider: 'xai' });

  for (const c of out) {
    if (!c.cwd && c.projectHash && hashes.has(c.projectHash)) c.cwd = hashes.get(c.projectHash);
    c.source = 'cli';
    c.resumable = !c.checkpoint && Boolean(c.sessionId);
  }
  return out;
}

// argv (never a shell string) to reopen a session in its own CLI.
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:-]{3,99}$/; // never starts with "-" (no flag injection)
function resumeArgs(provider, sessionId) {
  if (!SAFE.test(String(sessionId || ''))) return null;
  if (String(sessionId).startsWith('checkpoint:')) return provider === 'google' ? [] : null; // resume inside with /chat resume <tag>
  return {
    anthropic: ['--resume', sessionId],
    openai: ['resume', sessionId],
    google: ['--resume', sessionId],
    qwen: ['--resume', sessionId],
    xai: ['--resume', sessionId],
    mistral: ['--resume', sessionId],
  }[provider] || null;
}

module.exports = { scanAll, parseClaudeSession, parseCodexSession, parseGeminiSession, generic, resumeArgs, projectHash, walk, textOf };

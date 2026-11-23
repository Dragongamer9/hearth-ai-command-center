// Hearth Ideas (Hearth OS, hosts/hearth-ui/apps/ideas): the owner presses "Build it" on an idea people asked for, and
// the idea comes here as a file: `hearth-ai-command-center --idea=<file.json>`. The first time, a chat is made for it,
// connected to the repo on its base branch, and the brief goes to the team as the owner's own message (the lead named
// in it answers; the checker named in it checks). The same idea again (Open in the Command Center) opens that chat.
// Nothing else is started, merged or released: the brief carries the owner's rules, and versions stay his.
//
// <data>/ideas.json maps each idea's key to its chat (jsonfile.cjs: atomic, .bak, never overwritten when unreadable).
const fs = require('node:fs');
const path = require('node:path');
const { createJsonFile } = require('./jsonfile.cjs');

const KEY_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const BRANCH_RE = /^(?!.*\.\.)(?!\/)[A-Za-z0-9._/-]{1,100}(?<!\/)$/;
const AI_RE = /^[a-z0-9-]{1,30}$/;

const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n) : '');

// The file Hearth Ideas wrote, checked. Returns null when it isn't an idea.
function parseIdea(text) {
  let j;
  try { j = JSON.parse(String(text || '')); } catch { return null; }
  if (!j || typeof j !== 'object' || j.format !== 1) return null;
  const idea = {
    key: str(j.key, 80),
    title: str(j.title, 120),
    brief: str(j.brief, 12000),
    repo: str(j.repo, 201) || 'Dragongamer9/hearth-os',
    base: str(j.base, 100) || 'bughunt',
    branch: str(j.branch, 100),
    lead: str(j.lead, 30),
    checks: str(j.checks, 30),
    mockupFirst: j.mockupFirst === true,
  };
  if (!KEY_RE.test(idea.key) || !idea.title || !idea.brief) return null;
  if (!REPO_RE.test(idea.repo) || !BRANCH_RE.test(idea.base) || !BRANCH_RE.test(idea.branch)) return null;
  if (idea.branch === idea.base || /^(main|master)$/.test(idea.branch)) return null;
  if (idea.lead && !AI_RE.test(idea.lead)) return null;
  if (idea.checks && !AI_RE.test(idea.checks)) return null;
  return idea;
}

// `--idea=<file>` or `--idea <file>` in a command line.
function ideaArg(argv = []) {
  const a = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < a.length; i++) {
    const s = String(a[i]);
    if (s.startsWith('--idea=')) return s.slice(7);
    if (s === '--idea' && a[i + 1]) return String(a[i + 1]);
  }
  return null;
}

// The owner's message to the team: who leads (as an @mention, so that AI answers first), who checks, the brief and
// the rules that always hold.
const NAMES = { claude: 'Claude', chatgpt: 'ChatGPT', codex: 'Codex', gemini: 'Gemini', grok: 'Grok', mistral: 'Mistral', qwen: 'Qwen', deepseek: 'DeepSeek', ithil: 'Ithil', local: 'Local AI' };
function messageFor(idea) {
  const N = (id) => NAMES[id] || id;
  const lines = [];
  lines.push(`${idea.lead ? `@${idea.lead} ` : ''}An idea from Hearth Ideas to build: **${idea.title}**`);
  lines.push('');
  lines.push(idea.brief);
  lines.push('');
  lines.push(`Make it in ${idea.repo} on its own branch \`${idea.branch}\`, made from \`${idea.base}\`, and open a pull request to \`${idea.base}\`.`);
  if (idea.mockupFirst) lines.push('Draw a mockup first and wait for my yes before building it.');
  lines.push('Build and test in GitHub Actions only, with pictures of what you made next to its mockup.');
  if (idea.checks) lines.push(`${N(idea.checks)} checks the work before it's ready${idea.lead ? `; ${N(idea.lead)} leads` : ''}.`);
  lines.push('Never pick or change a version number, never merge, tag or release, and commit only as me with no AI lines.');
  return lines.join('\n').slice(0, 16000);
}

function createIdeas(dataDir) {
  const f = createJsonFile(path.join(dataDir, 'ideas.json'), { empty: () => ({ chats: {} }), check: (j) => j.chats && typeof j.chats === 'object', label: 'ideas.json' });
  return {
    chatFor: (key) => f.read().chats[key] || null,
    remember(key, chatId) {
      const cur = f.read();
      return f.write({ ...cur, chats: { ...cur.chats, [key]: chatId } });
    },
    forget(key) {
      const cur = f.read();
      if (!cur.chats[key]) return cur;
      const chats = { ...cur.chats };
      delete chats[key];
      return f.write({ ...cur, chats });
    },
    broken: () => f.broken(),
  };
}

function readIdeaFile(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > 64 * 1024) return null;
    return parseIdea(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}

module.exports = { parseIdea, ideaArg, messageFor, createIdeas, readIdeaFile };

// Team chat helpers (pure, unit tested).
export const NAMES = { owner: 'Owner', anthropic: 'Claude', openai: 'ChatGPT', freebuff: 'FreeBuff', system: 'System' };
const ALIASES = { claude: 'anthropic', anthropic: 'anthropic', chatgpt: 'openai', gpt: 'openai', openai: 'openai', freebuff: 'freebuff' };
const ACTIONS = ['code', 'docs', 'merge', 'release', 'deploy'];
const MAX_TRANSCRIPT_CHARS = 12000;

// Which agents should answer. "@claude ..." targets one; otherwise everyone live.
export function recipients(text, live, target = 'all') {
  const mentioned = [...new Set([...text.matchAll(/@(\w+)/g)].map((m) => ALIASES[m[1].toLowerCase()]).filter(Boolean))];
  let list = mentioned.length ? mentioned : target === 'all' ? ['anthropic', 'openai'] : [target];
  return list.filter((a) => live.includes(a));
}

export function buildPrompt(agent, messages) {
  const others = ['anthropic', 'openai', 'freebuff'].filter((a) => a !== agent).map((a) => NAMES[a]).join(', ');
  let lines = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.who === 'system') continue;
    const line = `${NAMES[m.who] || m.who}: ${m.text}`;
    if (used + line.length > MAX_TRANSCRIPT_CHARS) break;
    lines.unshift(line);
    used += line.length;
  }
  return [
    `You are ${NAMES[agent]} in the Hearth AI Command Center team chat with the Owner and the other agents (${others}).`,
    'Everyone sees every message. FreeBuff is not connected yet and cannot reply.',
    'Be concise. Build on what the other agents said instead of repeating it; disagree when you have a reason.',
    'You cannot run code or change repositories from this chat. Never claim to have done work.',
    'Hearth OS is pinned at 0.6.55; never propose changing its version, the Owner picks version numbers.',
    'When the Owner asks to split up or distribute work, propose tasks, one per line, in exactly this format:',
    'TASK: <title> | implementer: claude|chatgpt|freebuff | reviewer: claude|chatgpt|freebuff | action: code|docs|merge|release|deploy',
    'The reviewer must differ from the implementer. The Owner decides which tasks go on the board.',
    '',
    '--- Chat so far ---',
    ...lines,
    '--- End ---',
    `Reply as ${NAMES[agent]}.`,
  ].join('\n');
}

export function parseProposals(text) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/^[\s*\-•`]+/, '').replace(/[*`]/g, '');
    const m = line.match(/^TASK:\s*(.+)$/i);
    if (!m) continue;
    const parts = m[1].split('|').map((s) => s.trim());
    const title = parts.shift();
    if (!title) continue;
    const field = (k) => {
      const p = parts.find((x) => x.toLowerCase().startsWith(`${k}:`));
      return p ? p.slice(k.length + 1).trim().toLowerCase() : '';
    };
    const assignee = ALIASES[field('implementer')] || 'none';
    let reviewer = ALIASES[field('reviewer')] || 'none';
    if (reviewer === assignee && assignee !== 'none') reviewer = assignee === 'anthropic' ? 'openai' : 'anthropic';
    const action = ACTIONS.includes(field('action')) ? field('action') : 'code';
    out.push({ title: title.slice(0, 200), assignee, reviewer, action });
  }
  return out;
}

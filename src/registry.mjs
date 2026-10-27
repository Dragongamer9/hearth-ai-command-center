// The one list of AI teammates. Everything else (chat, tasks, Control Room)
// reads from here, so adding an agent is a one-place change.
export const AGENT_IDS = ['anthropic', 'openai', 'google', 'ollama', 'freebuff'];

export const AGENTS = {
  anthropic: { name: 'Claude', vendor: 'Anthropic', cls: 'a-anthropic', tool: 'Claude Code', plan: 'your Claude subscription', install: 'npm install -g @anthropic-ai/claude-code', headless: true, edits: true, mention: ['claude', 'anthropic'] },
  openai: { name: 'ChatGPT', vendor: 'OpenAI', cls: 'a-openai', tool: 'Codex CLI', plan: 'your ChatGPT account', install: 'npm install -g @openai/codex', headless: true, edits: true, mention: ['chatgpt', 'gpt', 'openai', 'codex'] },
  google: { name: 'Gemini', vendor: 'Google', cls: 'a-google', tool: 'Gemini CLI', plan: 'your Google account (free tier available)', install: 'npm install -g @google/gemini-cli', headless: true, edits: true, mention: ['gemini', 'google'] },
  ollama: { name: 'Local AI', vendor: 'Ollama, on this computer', cls: 'a-ollama', tool: 'Ollama', plan: 'no account — runs on your own hardware', install: 'Download from ollama.com', headless: true, edits: false, mention: ['local', 'ollama'] },
  freebuff: { name: 'FreeBuff', vendor: 'FreeBuff', cls: 'a-freebuff', tool: 'FreeBuff CLI', plan: 'your free FreeBuff account', install: 'npm install -g freebuff', headless: false, edits: true, mention: ['freebuff'] },
  none: { name: 'Unassigned', vendor: '', cls: 'a-none', headless: false, edits: false, mention: [] },
};

export const DEFAULT_ROLES = {
  anthropic: 'Lead coordinator: plans, splits work into tasks, reviews results, decides next steps',
  openai: 'Coding: implementation and debugging',
  google: 'Research and documents: large files, screenshots, fact-checking, second opinions',
  ollama: 'Local helper: free quick answers and reviews, works offline, never runs out of usage',
  freebuff: 'Coding, hands-on in a terminal (cannot reply in chat by itself)',
};

// Agents that can be run without a person at the keyboard.
export const HEADLESS = AGENT_IDS.filter((a) => AGENTS[a].headless);
// Agents that can edit files in a task workspace without a person.
export const EDITORS = AGENT_IDS.filter((a) => AGENTS[a].headless && AGENTS[a].edits);

export function aliasOf(word) {
  const w = String(word || '').toLowerCase();
  return AGENT_IDS.find((a) => AGENTS[a].mention.includes(w)) || null;
}

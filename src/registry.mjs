// The one list of AI teammates. Everything else (chat, tasks, Agents page)
// reads from here, so adding an agent is a one-place change.
//
// Two kinds of providers:
//   TEAM members (AGENT_IDS): the app can talk to them without a person at the
//     keyboard, through their official CLI signed in with your own account, or an
//     official API key you create in your own account. They chat, plan, review,
//     and (CLI ones) edit files in task workspaces.
//   WEB-WINDOW providers (WEB_ONLY): only an official web chat exists for a
//     personal account (no CLI, no consumer API). The app opens their own site in
//     an in-app window where you sign in yourself. The app never reads, scrapes or
//     stores anything from those pages.
export const AGENT_IDS = ['anthropic', 'openai', 'google', 'xai', 'mistral', 'qwen', 'perplexity', 'deepseek', 'ollama', 'freebuff'];
export const WEB_ONLY = ['copilot', 'meta'];

// One-click install (Install button / Install all), always in a terminal you can see.
export const NPM_NOTE = 'No password needed: it installs into your own folder (~/.local). If Node.js 20 or newer is missing, the official Node.js LTS from nodejs.org is downloaded, checked against its official checksum and set up in your own folder first.';
export const OLLAMA_NOTE = 'Ollama installs system-wide, so its official installer asks for your computer password in the terminal. This app never sees, stores or passes it.';

// kind: 'cli' official CLI with account sign-in (API key optional fallback)
//       'api' official API key from your own account only
//       'local' runs on this computer
//       'manual' interactive terminal only
// web: the provider's own chat site (opened in an in-app window or your browser)
// signin: the provider's own account page
// export: how to get an official copy of your web chats (null = none offered)
export const AGENTS = {
  anthropic: { name: 'Claude', vendor: 'Anthropic', cls: 'a-anthropic', kind: 'cli', tool: 'Claude Code', plan: 'your Claude subscription', install: 'npm install -g --prefix ~/.local @anthropic-ai/claude-code', installNote: NPM_NOTE, headless: true, edits: true, api: true, mention: ['claude', 'anthropic'], web: 'https://claude.ai/new', signin: 'https://claude.ai/login', export: 'claude.ai → Settings → Privacy → Export data (zip with conversations.json)', resume: 'claude --resume <id>' },
  openai: { name: 'ChatGPT', vendor: 'OpenAI', cls: 'a-openai', kind: 'cli', tool: 'Codex CLI', plan: 'your ChatGPT account', install: 'npm install -g --prefix ~/.local @openai/codex', installNote: NPM_NOTE, headless: true, edits: true, api: true, mention: ['chatgpt', 'gpt', 'openai', 'codex'], web: 'https://chatgpt.com/', signin: 'https://chatgpt.com/auth/login', export: 'chatgpt.com → Settings → Data controls → Export data (zip with conversations.json)', resume: 'codex resume <id>' },
  google: { name: 'Gemini', vendor: 'Google', cls: 'a-google', kind: 'cli', tool: 'Antigravity CLI (agy) or Gemini CLI', plan: 'your Google account (free tier available)', install: 'npm install -g --prefix ~/.local @google/gemini-cli', installNote: NPM_NOTE, headless: true, edits: true, api: false, mention: ['gemini', 'google'], web: 'https://gemini.google.com/app', signin: 'https://accounts.google.com/', export: 'takeout.google.com → My Activity → Gemini Apps, format JSON', resume: 'agy --conversation <id> (or gemini --resume <id>)' },
  xai: { name: 'Grok', vendor: 'xAI', cls: 'a-xai', kind: 'cli', tool: 'Grok Build CLI', plan: 'your grok.com account', install: 'npm install -g --prefix ~/.local @xai-official/grok', installNote: NPM_NOTE, headless: true, edits: true, api: true, mention: ['grok', 'xai'], web: 'https://grok.com/', signin: 'https://accounts.x.ai/', export: null, resume: 'grok --resume <id>' },
  mistral: { name: 'Mistral', vendor: 'Mistral AI', cls: 'a-mistral', kind: 'cli', tool: 'Mistral Vibe CLI', plan: 'your Mistral account (Le Chat)', install: 'uv tool install mistral-vibe', installNote: 'If uv is missing, Astral’s official installer (astral.sh) puts it in ~/.local/bin first. No password needed.', headless: true, edits: true, api: true, mention: ['mistral', 'lechat', 'vibe'], web: 'https://chat.mistral.ai/chat', signin: 'https://chat.mistral.ai/', export: null, resume: 'vibe --resume <id>' },
  qwen: { name: 'Qwen', vendor: 'Alibaba Qwen', cls: 'a-qwen', kind: 'cli', tool: 'Qwen Code', plan: 'your qwen.ai account', install: 'npm install -g --prefix ~/.local @qwen-code/qwen-code', installNote: NPM_NOTE, headless: true, edits: true, api: false, mention: ['qwen'], web: 'https://chat.qwen.ai/', signin: 'https://chat.qwen.ai/auth', export: null, resume: 'qwen --resume <id>' },
  perplexity: { name: 'Perplexity', vendor: 'Perplexity', cls: 'a-perplexity', kind: 'api', tool: 'Sonar API', plan: 'an API key from your Perplexity account', install: '', headless: true, edits: false, api: true, mention: ['perplexity', 'pplx', 'sonar'], web: 'https://www.perplexity.ai/', signin: 'https://www.perplexity.ai/account/api', export: null },
  deepseek: { name: 'DeepSeek', vendor: 'DeepSeek', cls: 'a-deepseek', kind: 'api', tool: 'DeepSeek API', plan: 'an API key from your DeepSeek platform account', install: '', headless: true, edits: false, api: true, mention: ['deepseek'], web: 'https://chat.deepseek.com/', signin: 'https://platform.deepseek.com/api_keys', export: 'chat.deepseek.com → Settings → Data → Export data (JSON)' },
  ollama: { name: 'Local AI', vendor: 'Ollama, on this computer', cls: 'a-ollama', kind: 'local', tool: 'Ollama', plan: 'no account — runs on your own hardware', install: 'Ollama’s official installer (ollama.com/install.sh)', installNote: OLLAMA_NOTE, headless: true, edits: false, api: false, mention: ['local', 'ollama'], web: null, signin: null, export: null },
  freebuff: { name: 'FreeBuff', vendor: 'FreeBuff', cls: 'a-freebuff', kind: 'manual', tool: 'FreeBuff CLI', plan: 'your free FreeBuff account', install: 'npm install -g --prefix ~/.local freebuff', installNote: NPM_NOTE, headless: false, edits: true, api: false, mention: ['freebuff'], web: 'https://freebuff.com/', signin: 'https://freebuff.com/', export: null, resume: 'freebuff --continue' },
  // Web-window only (no CLI or consumer API for personal accounts).
  copilot: { name: 'Copilot', vendor: 'Microsoft', cls: 'a-copilot', kind: 'web', tool: 'copilot.microsoft.com', plan: 'your Microsoft account', headless: false, edits: false, api: false, mention: [], web: 'https://copilot.microsoft.com/', signin: 'https://copilot.microsoft.com/', export: 'account.microsoft.com/privacy → Copilot activity (view/clear; no chat-file download)' },
  meta: { name: 'Meta AI', vendor: 'Meta', cls: 'a-meta', kind: 'web', tool: 'meta.ai', plan: 'your Meta account', headless: false, edits: false, api: false, mention: [], web: 'https://www.meta.ai/', signin: 'https://www.meta.ai/', export: 'Accounts Center → Your information → Download your information' },
  none: { name: 'Unassigned', vendor: '', cls: 'a-none', headless: false, edits: false, mention: [] },
};

// Why each provider is a full team member or a web window (shown on the Agents page).
export const ACCESS_NOTE = {
  anthropic: 'Full member: Claude Code CLI signs in with your Claude account in the browser.',
  openai: 'Full member: Codex CLI signs in with your ChatGPT account in the browser.',
  google: 'Full member: Antigravity CLI (agy), or Gemini CLI if agy isn’t installed, signs in with your Google account in the browser.',
  xai: 'Full member: xAI\'s Grok Build CLI signs in with your grok.com account (browser OAuth). API key optional.',
  mistral: 'Full member: Mistral Vibe CLI signs in with your Mistral account (browser) or a key from Le Chat → Code.',
  qwen: 'Full member: Qwen Code signs in with your qwen.ai account (Qwen OAuth in the browser).',
  perplexity: 'Team member by API: Perplexity has no CLI; the official Sonar API uses a key you create in your account. Chat, research, review — no file edits. Its web chat opens in a window.',
  deepseek: 'Team member by API: DeepSeek has no official CLI; its API uses a key from platform.deepseek.com. Chat, plan, review — no file edits. Its web chat opens in a window.',
  ollama: 'Full member: local models on this computer, no account.',
  freebuff: 'Hands-on: FreeBuff only runs interactively in a terminal.',
  copilot: 'Web window only: Microsoft offers no CLI or personal-account API for Copilot chat.',
  meta: 'Web window only: Meta AI has no CLI or personal-account API (the Llama API is a separate developer product).',
};

// How each connection is paid for, shown next to every AI.
export const BILLING = {
  anthropic: 'Uses your Claude subscription (Pro/Max) — no API charges. Heavy non-stop use reaches your plan limits sooner.',
  openai: 'Uses your ChatGPT plan’s included Codex usage — no API charges.',
  google: 'Uses your Google account — free tier or your Gemini plan.',
  xai: 'Uses your grok.com account plan (or xAI API credits if you switch to an API key).',
  mistral: 'Uses your Mistral plan / pay-as-you-go settings.',
  qwen: 'Uses your qwen.ai account (Qwen OAuth free quota).',
  perplexity: 'API key — billed per use to your Perplexity API credits.',
  deepseek: 'API key — billed per use to your DeepSeek platform balance.',
  ollama: 'Free — runs on your own computer. No account, never runs out.',
  freebuff: 'Free FreeBuff account (it has its own daily limits).',
  copilot: 'Your Microsoft account, inside Microsoft’s own site.',
  meta: 'Your Meta account, inside Meta’s own site.',
  api: 'API key — billed per use to your developer account, separate from any subscription.',
};

export const DEFAULT_ROLES = {
  anthropic: 'Lead coordinator: plans, splits work into tasks, reviews results, decides next steps',
  openai: 'Coding: implementation and debugging',
  google: 'Research and documents: large files, screenshots, fact-checking, second opinions',
  xai: 'Coding and second opinions',
  mistral: 'Coding and quick fixes',
  qwen: 'Coding helper',
  perplexity: 'Web research with sources',
  deepseek: 'Reasoning and code review',
  ollama: 'Local helper: free quick answers and reviews, works offline, never runs out of usage',
  freebuff: 'Coding, hands-on in a terminal (cannot reply in chat by itself)',
};

// Agents that can be run without a person at the keyboard.
export const HEADLESS = AGENT_IDS.filter((a) => AGENTS[a].headless);
// Agents that can edit files in a task workspace without a person.
export const EDITORS = AGENT_IDS.filter((a) => AGENTS[a].headless && AGENTS[a].edits);
// Agents that can be linked with an official API key.
export const API_CAPABLE = AGENT_IDS.filter((a) => AGENTS[a].api);

export function aliasOf(word) {
  const w = String(word || '').toLowerCase();
  return AGENT_IDS.find((a) => AGENTS[a].mention.includes(w)) || null;
}

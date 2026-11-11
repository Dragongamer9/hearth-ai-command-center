// 3.3: the AIs added for the owner (electron/more-ais.cjs has the same ids for the app's main side).
// Kinds: MORE_CLI coding tools, MORE_CHAT chat APIs, MORE_CLOUD cloud agents, MORE_BUILDERS app builders.
export const MORE_IDS = ["openrouter", "kimi", "glm", "cohere", "ai21", "minimax", "nova", "nvidia", "groq", "cerebras", "v0", "cursor", "ghcopilot", "kiro", "aider", "opencode", "goose", "cline", "crush", "openhands", "amp", "auggie", "droid", "warp", "devin", "jules", "lovable", "replit", "phi"];
// 3.3: picture and video makers (each with its own key in Settings › Media & voice).
export const MAKERS = { flux: 'FLUX', stability: 'Stability', ideogram: 'Ideogram', leonardo: 'Leonardo', runway: 'Runway', luma: 'Luma', kling: 'Kling', pika: 'Pika' };
export const MORE_WEB = ["bolt", "firebase"];
export const MORE_GROUPS = {
  coders: ['cursor', 'ghcopilot', 'kiro', 'kimi', 'aider', 'opencode', 'goose', 'cline', 'crush', 'openhands', 'amp', 'auggie', 'droid', 'warp'],
  chat: ['openrouter', 'glm', 'cohere', 'ai21', 'minimax', 'nova', 'nvidia', 'groq', 'cerebras', 'v0'],
  cloud: ['devin', 'jules'],
  builders: ['lovable', 'replit', 'bolt', 'firebase'],
  local: ['phi'],
};

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
export const AGENT_IDS = ['anthropic', 'openai', 'google', 'xai', 'mistral', 'qwen', 'perplexity', 'deepseek', 'ollama', 'freebuff', ...MORE_IDS];
export const WEB_ONLY = ['copilot', 'meta', ...MORE_WEB];

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
  ollama: { name: 'Local AI', vendor: 'Ollama, on this computer', cls: 'a-ollama', kind: 'local', tool: 'Ollama', plan: 'no account — runs on your own hardware', install: 'Ollama’s official installer (ollama.com/install.sh)', installNote: OLLAMA_NOTE, headless: true, edits: false, api: false, mention: ['local', 'ollama', 'localai'], web: null, signin: null, export: null },
  freebuff: { name: 'FreeBuff', vendor: 'FreeBuff', cls: 'a-freebuff', kind: 'manual', tool: 'FreeBuff CLI', plan: 'your free FreeBuff account', install: 'npm install -g --prefix ~/.local freebuff', installNote: NPM_NOTE, headless: false, edits: true, api: false, mention: ['freebuff'], web: 'https://freebuff.com/', signin: 'https://freebuff.com/', export: null, resume: 'freebuff --continue' },
  // More teammates by API key or URL (2.x). Unfiltered: what they make is never forwarded
  // to the other AIs' context (placeholders instead), to protect the owner's other accounts.
  venice: { name: 'Venice', vendor: 'Venice AI', cls: 'a-venice', kind: 'api', tool: 'Venice API', plan: 'an API key from your Venice account', install: '', headless: true, edits: false, api: true, unfiltered: true, images: true, mention: ['venice', 'veniceai'], web: 'https://venice.ai/', signin: 'https://venice.ai/settings/api', export: null },
  civitai: { name: 'Civitai', vendor: 'Civitai', cls: 'a-civitai', kind: 'api', tool: 'Civitai image API', plan: 'an API token from your Civitai account (billed in Buzz)', install: '', headless: true, edits: false, api: true, unfiltered: true, images: true, imagesOnly: true, mention: ['civitai', 'civit'], web: 'https://civitai.com/', signin: 'https://civitai.com/user/account', export: null },
  gpu: { name: 'Your GPU server', vendor: 'your own server', cls: 'a-gpu', kind: 'api', tool: 'your server (OpenAI-compatible chat or ComfyUI)', plan: 'your own rented or local GPU', install: '', headless: true, edits: false, api: true, unfiltered: true, images: true, mention: ['gpu', 'myserver', 'server', 'runpod', 'comfy', 'comfyui'], web: null, signin: null, export: null },
  // Free AI (2.7): the free tiers of several providers (Cerebras, Groq, Google AI Studio, Mistral,
  // OpenRouter) with his own keys, one after another when one is at its limit (electron/free-ai.cjs).
  free: { name: 'Free AI', vendor: 'free tiers of several providers', cls: 'a-free', kind: 'api', tool: 'free tiers: Cerebras, Groq, Google AI Studio, Mistral, OpenRouter', plan: 'free keys from your own accounts', install: '', headless: true, edits: false, api: true, mention: ['free', 'freeai'], web: null, signin: null, export: null },
  // The AI the owner's Hearth OS machines share (Ollama chat, ComfyUI pictures, Kokoro voices,
  // whisper): the best device per job, his Nvidia PC first. His own machines; kept from the other AIs like his GPU server.
  hearth: { name: 'Hearth devices', vendor: 'your Hearth OS machines', cls: 'a-hearth', kind: 'api', tool: 'the AI your Hearth devices share (Ollama, ComfyUI, Kokoro, whisper)', plan: 'your own Hearth OS machines (no account)', install: '', headless: true, edits: false, api: true, unfiltered: true, images: true, mention: ['hearth', 'hearthdevices', 'devices', 'nvidiapc'], web: null, signin: null, export: null },
  // Web-window only (no CLI or consumer API for personal accounts).
  copilot: { name: 'Copilot', vendor: 'Microsoft', cls: 'a-copilot', kind: 'web', tool: 'copilot.microsoft.com', plan: 'your Microsoft account', headless: false, edits: false, api: false, mention: [], web: 'https://copilot.microsoft.com/', signin: 'https://copilot.microsoft.com/', export: 'account.microsoft.com/privacy → Copilot activity (view/clear; no chat-file download)' },
  meta: { name: 'Meta AI', vendor: 'Meta', cls: 'a-meta', kind: 'web', tool: 'meta.ai', plan: 'your Meta account', headless: false, edits: false, api: false, mention: [], web: 'https://www.meta.ai/', signin: 'https://www.meta.ai/', export: 'Accounts Center → Your information → Download your information' },
  openrouter: {"name": "OpenRouter", "vendor": "OpenRouter", "cls": "a-openrouter", "kind": "api", "tool": "OpenRouter API (hundreds of models)", "plan": "an API key from your OpenRouter account (many free models)", "install": "", "headless": true, "edits": false, "api": true, "mention": ["openrouter", "or"], "web": "https://openrouter.ai/chat", "signin": "https://openrouter.ai/keys", "export": null},
  kimi: {"name": "Kimi", "vendor": "Moonshot AI", "cls": "a-kimi", "kind": "cli", "tool": "Kimi Code CLI (or the Kimi API)", "plan": "your Kimi account (or a Moonshot API key)", "install": "one click (Settings › Accounts)", "headless": true, "edits": true, "api": true, "mention": ["kimi", "moonshot"], "web": "https://www.kimi.com/", "signin": "https://www.kimi.com/", "export": null},
  glm: {"name": "GLM", "vendor": "Z.ai (Zhipu)", "cls": "a-glm", "kind": "api", "tool": "Z.ai API", "plan": "an API key from your Z.ai account", "install": "", "headless": true, "edits": false, "api": true, "mention": ["glm", "zai", "zhipu"], "web": "https://chat.z.ai/", "signin": "https://z.ai/", "export": null},
  cohere: {"name": "Cohere", "vendor": "Cohere", "cls": "a-cohere", "kind": "api", "tool": "Cohere API (Command)", "plan": "an API key from your Cohere account", "install": "", "headless": true, "edits": false, "api": true, "mention": ["cohere", "command"], "web": "https://dashboard.cohere.com/playground", "signin": "https://dashboard.cohere.com/", "export": null},
  ai21: {"name": "AI21 Jamba", "vendor": "AI21 Labs", "cls": "a-ai21", "kind": "api", "tool": "AI21 Studio API (Jamba)", "plan": "an API key from your AI21 Studio account", "install": "", "headless": true, "edits": false, "api": true, "mention": ["ai21", "jamba"], "web": "https://studio.ai21.com/", "signin": "https://studio.ai21.com/", "export": null},
  minimax: {"name": "MiniMax", "vendor": "MiniMax", "cls": "a-minimax", "kind": "api", "tool": "MiniMax API", "plan": "an API key from your MiniMax account", "install": "", "headless": true, "edits": false, "api": true, "mention": ["minimax"], "web": "https://chat.minimax.io/", "signin": "https://platform.minimax.io/", "export": null},
  nova: {"name": "Amazon Nova", "vendor": "Amazon", "cls": "a-nova", "kind": "api", "tool": "Amazon Nova API", "plan": "an API key from nova.amazon.com (free tier with limits)", "install": "", "headless": true, "edits": false, "api": true, "mention": ["nova", "amazon"], "web": "https://nova.amazon.com/", "signin": "https://nova.amazon.com/dev", "export": null},
  nvidia: {"name": "NVIDIA", "vendor": "NVIDIA", "cls": "a-nvidia", "kind": "api", "tool": "NVIDIA API (build.nvidia.com)", "plan": "an API key from build.nvidia.com (free developer tier)", "install": "", "headless": true, "edits": false, "api": true, "mention": ["nvidia", "nemotron", "nim"], "web": "https://build.nvidia.com/", "signin": "https://build.nvidia.com/settings/api-keys", "export": null},
  groq: {"name": "Groq", "vendor": "Groq", "cls": "a-groq", "kind": "api", "tool": "Groq API", "plan": "an API key from your Groq account (free tier)", "install": "", "headless": true, "edits": false, "api": true, "mention": ["groq"], "web": "https://console.groq.com/playground", "signin": "https://console.groq.com/keys", "export": null},
  cerebras: {"name": "Cerebras", "vendor": "Cerebras", "cls": "a-cerebras", "kind": "api", "tool": "Cerebras API", "plan": "an API key from your Cerebras account (free tier)", "install": "", "headless": true, "edits": false, "api": true, "mention": ["cerebras"], "web": "https://cloud.cerebras.ai/", "signin": "https://cloud.cerebras.ai/", "export": null},
  v0: {"name": "v0", "vendor": "Vercel", "cls": "a-v0", "kind": "api", "tool": "v0 Model API", "plan": "an API key from v0 (Premium or Team plan)", "install": "", "headless": true, "edits": false, "api": true, "mention": ["v0", "vercel"], "web": "https://v0.dev/", "signin": "https://v0.dev/", "export": null},
  cursor: {"name": "Cursor", "vendor": "Anysphere", "cls": "a-cursor", "kind": "cli", "tool": "Cursor CLI (agent)", "plan": "your Cursor account", "install": "one click (Settings › Accounts)", "headless": true, "edits": true, "api": false, "mention": ["cursor"], "web": "https://cursor.com/", "signin": "https://cursor.com/dashboard", "export": null},
  ghcopilot: {"name": "GitHub Copilot", "vendor": "GitHub", "cls": "a-ghcopilot", "kind": "cli", "tool": "GitHub Copilot CLI", "plan": "your GitHub account with Copilot", "install": "one click (Settings › Accounts)", "headless": true, "edits": true, "api": false, "mention": ["copilot", "githubcopilot", "gh"], "web": "https://github.com/copilot", "signin": "https://github.com/login", "export": null},
  kiro: {"name": "Kiro", "vendor": "Amazon (Kiro)", "cls": "a-kiro", "kind": "cli", "tool": "Kiro CLI", "plan": "a Kiro API key (Kiro Pro and up)", "install": "one click (Settings › Accounts)", "headless": true, "edits": true, "api": false, "mention": ["kiro", "amazonq", "q"], "web": "https://kiro.dev/", "signin": "https://app.kiro.dev/", "export": null},
  aider: {"name": "Aider", "vendor": "Aider (open source)", "cls": "a-aider", "kind": "cli", "tool": "Aider", "plan": "your own model keys, or a local model", "install": "one click (Settings › Accounts)", "headless": true, "edits": true, "api": false, "mention": ["aider"], "web": null, "signin": null, "export": null},
  opencode: {"name": "OpenCode", "vendor": "OpenCode (open source)", "cls": "a-opencode", "kind": "cli", "tool": "OpenCode", "plan": "your own model keys (opencode auth login)", "install": "one click (Settings › Accounts)", "headless": true, "edits": true, "api": false, "mention": ["opencode"], "web": "https://opencode.ai/", "signin": "https://opencode.ai/", "export": null},
  goose: {"name": "Goose", "vendor": "Goose (open source)", "cls": "a-goose", "kind": "cli", "tool": "Goose", "plan": "your own model keys (goose configure)", "install": "one click (Settings › Accounts)", "headless": true, "edits": true, "api": false, "mention": ["goose"], "web": null, "signin": null, "export": null},
  cline: {"name": "Cline", "vendor": "Cline (open source)", "cls": "a-cline", "kind": "cli", "tool": "Cline CLI", "plan": "your Cline account or own keys (cline auth)", "install": "one click (Settings › Accounts)", "headless": true, "edits": true, "api": false, "mention": ["cline"], "web": null, "signin": null, "export": null},
  crush: {"name": "Crush", "vendor": "Charm (open source)", "cls": "a-crush", "kind": "cli", "tool": "Crush", "plan": "your own model keys", "install": "one click (Settings › Accounts)", "headless": true, "edits": true, "api": false, "mention": ["crush", "charm"], "web": null, "signin": null, "export": null},
  openhands: {"name": "OpenHands", "vendor": "OpenHands (open source)", "cls": "a-openhands", "kind": "cli", "tool": "OpenHands CLI", "plan": "your own model settings", "install": "one click (Settings › Accounts)", "headless": true, "edits": true, "api": false, "mention": ["openhands"], "web": null, "signin": null, "export": null},
  amp: {"name": "Amp", "vendor": "Amp", "cls": "a-amp", "kind": "cli", "tool": "Amp CLI", "plan": "your Amp account (amp login)", "install": "one click (Settings › Accounts)", "headless": true, "edits": true, "api": false, "mention": ["amp", "ampcode"], "web": "https://ampcode.com/", "signin": "https://ampcode.com/", "export": null},
  auggie: {"name": "Augment", "vendor": "Augment Code", "cls": "a-auggie", "kind": "cli", "tool": "Augment CLI (auggie)", "plan": "your Augment account (auggie auth login)", "install": "one click (Settings › Accounts)", "headless": true, "edits": true, "api": false, "mention": ["augment", "auggie"], "web": "https://www.augmentcode.com/", "signin": "https://app.augmentcode.com/", "export": null},
  droid: {"name": "Factory Droid", "vendor": "Factory", "cls": "a-droid", "kind": "cli", "tool": "Droid CLI", "plan": "your Factory account (or a Factory API key)", "install": "one click (Settings › Accounts)", "headless": true, "edits": true, "api": false, "mention": ["droid", "factory"], "web": "https://factory.ai/", "signin": "https://app.factory.ai/", "export": null},
  warp: {"name": "Warp", "vendor": "Warp", "cls": "a-warp", "kind": "cli", "tool": "Warp agent CLI (oz)", "plan": "your Warp account (or a Warp API key)", "install": "one click (Settings › Accounts)", "headless": true, "edits": true, "api": false, "mention": ["warp", "oz"], "web": "https://www.warp.dev/", "signin": "https://app.warp.dev/", "export": null},
  devin: {"name": "Devin", "vendor": "Cognition", "cls": "a-devin", "kind": "api", "tool": "Devin API", "plan": "an API key from your Devin account", "install": "", "headless": true, "edits": false, "api": true, "mention": ["devin"], "web": "https://app.devin.ai/", "signin": "https://app.devin.ai/", "export": null, "cloud": true},
  jules: {"name": "Jules", "vendor": "Google", "cls": "a-jules", "kind": "api", "tool": "Jules API", "plan": "an API key from Jules (Settings)", "install": "", "headless": true, "edits": false, "api": true, "mention": ["jules"], "web": "https://jules.google.com/", "signin": "https://jules.google.com/", "export": null, "cloud": true},
  lovable: {"name": "Lovable", "vendor": "Lovable", "cls": "a-lovable", "kind": "cli", "tool": "Lovable (through Claude Code)", "plan": "your Lovable account", "install": "one click (Settings › Accounts)", "headless": true, "edits": false, "api": false, "mention": ["lovable"], "web": "https://lovable.dev/", "signin": "https://lovable.dev/", "export": null, "builder": true},
  replit: {"name": "Replit", "vendor": "Replit", "cls": "a-replit", "kind": "cli", "tool": "Replit (through Claude Code)", "plan": "your Replit account", "install": "one click (Settings › Accounts)", "headless": true, "edits": false, "api": false, "mention": ["replit"], "web": "https://replit.com/", "signin": "https://replit.com/", "export": null, "builder": true},
  phi: {"name": "Phi", "vendor": "Microsoft, on this computer", "cls": "a-phi", "kind": "local", "tool": "Ollama (phi4)", "plan": "no account — runs on your own hardware", "install": "one click (Settings › Accounts)", "headless": true, "edits": false, "api": false, "mention": ["phi", "phi4", "microsoft"], "web": null, "signin": null, "export": null},
  bolt: {"name": "Bolt", "vendor": "StackBlitz", "cls": "a-bolt", "kind": "web", "tool": "bolt.new", "plan": "your Bolt account", "install": "", "headless": false, "edits": false, "api": false, "mention": [], "web": "https://bolt.new/", "signin": "https://bolt.new/", "export": null},
  firebase: {"name": "Firebase Studio", "vendor": "Google", "cls": "a-firebase", "kind": "web", "tool": "Firebase Studio", "plan": "your Google account", "install": "", "headless": false, "edits": false, "api": false, "mention": [], "web": "https://studio.firebase.google.com/", "signin": "https://studio.firebase.google.com/", "export": null},
  none: { name: 'Unassigned', vendor: '', cls: 'a-none', headless: false, edits: false, mention: [] },
};

// Each AI's color (the same as the .a-* chips in styles.css).
export const COLORS = { free: '#5bb37a', venice: '#e05a4f', civitai: '#3b82f6', gpu: '#8f9a5b', hearth: '#e08a4c', anthropic: '#d4a27f', openai: '#74c7a4', google: '#8ab4f8', xai: '#c9ccd1', mistral: '#fa7a35', qwen: '#8a7cf6', perplexity: '#20b8cd', deepseek: '#4d6bfe', ollama: '#e6ebe7', freebuff: '#a99be0', copilot: '#36b37e', meta: '#0a7cff', openrouter: '#8b8ff7', kimi: '#3fb5ff', glm: '#2f7cff', cohere: '#39a68b', ai21: '#e85d9b', minimax: '#ff5c7a', nova: '#ff9f1c', nvidia: '#76b900', groq: '#f55036', cerebras: '#f05a28', v0: '#e8e8e8', cursor: '#9fb3c8', ghcopilot: '#6e7681', kiro: '#7b61ff', aider: '#14b88a', opencode: '#c6c6c6', goose: '#d9c27a', cline: '#5b8def', crush: '#ff6ec7', openhands: '#ffd23f', amp: '#ff4f3f', auggie: '#4ade80', droid: '#e5e5e5', warp: '#01a4ff', devin: '#2ec4b6', jules: '#a142f4', lovable: '#ff7ab6', replit: '#f26207', phi: '#00a4ef', bolt: '#4e5cff', firebase: '#ffca28' };

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
  openrouter: "Team member by API: one OpenRouter key gives hundreds of models, many free. Chat, plan, review — no file edits.",
  kimi: "Full member: Kimi Code CLI signs in with your Kimi account (/login). Its print mode approves its own steps, so it only gets turns where changes are wanted.",
  glm: "Team member by API: Z.ai's API with your key. Chat, plan, review — no file edits.",
  cohere: "Team member by API: Cohere's OpenAI-compatible API with your key. No file edits.",
  ai21: "Team member by API: AI21 Studio with your key. No file edits.",
  minimax: "Team member by API: MiniMax's OpenAI-compatible API with your key. No file edits.",
  nova: "Team member by API: the Amazon Nova API with your key. No file edits.",
  nvidia: "Team member by API: NVIDIA's hosted models with your key. No file edits.",
  groq: "Team member by API: open models on Groq's fast chips, with your key. No file edits.",
  cerebras: "Team member by API: open models on Cerebras, with your key. No file edits.",
  v0: "Team member by API: v0's model API with your key (needs v0 Premium or Team). Writes UI code in the chat; no file edits.",
  cursor: "Full member: Cursor's own CLI signs in with your Cursor account (or a Cursor API key).",
  ghcopilot: "Full member: GitHub's Copilot CLI signs in with your GitHub account (/login).",
  kiro: "Full member: Kiro CLI's headless mode with your Kiro API key.",
  aider: "Full member: Aider, open source, works with the model keys you give it (or Ollama).",
  opencode: "Full member: OpenCode, open source, with the providers you sign in to.",
  goose: "Full member: Goose, open source, with the provider you set up.",
  cline: "Full member: Cline's CLI with the provider you set up.",
  crush: "Full member: Crush, open source, with the provider you set up.",
  openhands: "Full member: OpenHands' CLI in headless mode with your model settings. (Its makers say it's no longer actively maintained.)",
  amp: "Full member: Amp's CLI signs in with your Amp account (or AMP_API_KEY).",
  auggie: "Full member: Augment's auggie CLI signs in with your Augment account.",
  droid: "Full member: Factory's droid CLI; without --auto it only reads.",
  warp: "Full member: Warp's oz CLI with your Warp key. Install it from Warp's own page (it's a system package).",
  devin: "Cloud member: Devin works in its own cloud on your repo and comes back with a pull request. The lead hands it whole tasks.",
  jules: "Cloud member: Jules works in Google's cloud on your GitHub repo (connected in Jules) and opens a pull request.",
  lovable: "App builder: Claude Code drives Lovable's official MCP server, signed in with your Lovable account. It builds apps on Lovable, not files here.",
  replit: "App builder: Claude Code drives Replit's official MCP server, signed in with your Replit account. It builds apps on Replit, not files here.",
  phi: "Full member: Microsoft's Phi model on this computer through Ollama.",
  bolt: "Web window only: Bolt has no CLI, API or MCP for other apps.",
  firebase: "Web window only: Firebase Studio has no API for other apps.",
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
  free: 'Free — each provider\'s free tier with your own key. When one runs out, the next one answers.',
  freebuff: 'Free FreeBuff account (it has its own daily limits).',
  copilot: 'Your Microsoft account, inside Microsoft’s own site.',
  meta: 'Your Meta account, inside Meta’s own site.',
  openrouter: "API key — billed per use to your OpenRouter credits (free models cost nothing).",
  kimi: "Uses your Kimi plan (or Moonshot API credits with a key).",
  glm: "API key — billed per use to your Z.ai balance.",
  cohere: "API key — billed per use (Cohere has a free trial key).",
  ai21: "API key — billed per use to your AI21 account.",
  minimax: "API key — billed per use to your MiniMax balance.",
  nova: "API key — Nova's free tier, then billed per use.",
  nvidia: "API key — NVIDIA's free developer tier, with limits.",
  groq: "API key — Groq's free tier, then billed per use.",
  cerebras: "API key — Cerebras's free tier, then billed per use.",
  v0: "API key — billed to your v0 plan's usage.",
  cursor: "Uses your Cursor plan.",
  ghcopilot: "Uses your GitHub Copilot plan's requests.",
  kiro: "Uses your Kiro plan.",
  aider: "Free tool — the model it uses bills as that model does.",
  opencode: "Free tool — the model it uses bills as that model does.",
  goose: "Free tool — the model it uses bills as that model does.",
  cline: "Free tool — the model it uses bills as that model does.",
  crush: "Free tool — the model it uses bills as that model does.",
  openhands: "Free tool — the model it uses bills as that model does.",
  amp: "Uses your Amp credits.",
  auggie: "Uses your Augment plan.",
  droid: "Uses your Factory plan.",
  warp: "Uses your Warp plan.",
  devin: "Uses your Devin plan's credits.",
  jules: "Uses your Jules plan's tasks.",
  lovable: "Uses your Lovable plan's credits.",
  replit: "Uses your Replit plan's credits.",
  phi: "Free — runs on your own computer.",
  bolt: "Your Bolt account, inside Bolt's own site.",
  firebase: "Your Google account, inside Firebase Studio.",
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
  openrouter: "Second opinions from many models, cheap or free",
  kimi: "Coding: big refactors and long files",
  glm: "Coding help and reviews, low cost",
  cohere: "Writing, summaries and searching through documents",
  ai21: "Reading very long documents",
  minimax: "Coding and long-context work, low cost",
  nova: "Quick, cheap answers and checks",
  nvidia: "Reasoning with NVIDIA's Nemotron models",
  groq: "Very fast quick checks",
  cerebras: "Very fast quick checks",
  v0: "Web page and UI code (React, Next.js)",
  cursor: "Coding: features and fixes",
  ghcopilot: "Coding and GitHub work (issues, pull requests)",
  kiro: "Coding from a plan: specs, then the work",
  aider: "Coding: small exact changes to named files",
  opencode: "Coding with any model you choose",
  goose: "Coding and jobs that use your tools (MCP)",
  cline: "Coding: plan, then do",
  crush: "Coding helper in the terminal",
  openhands: "Coding: long jobs on its own",
  amp: "Coding: big features",
  auggie: "Coding in big codebases",
  droid: "Coding: tests, migrations, fixes",
  warp: "Terminal jobs and coding",
  devin: "Whole tasks in the cloud, back as a pull request",
  jules: "Whole tasks in the cloud, back as a pull request",
  lovable: "App builder: makes and hosts whole web apps",
  replit: "App builder: makes, runs and publishes apps",
  phi: "Local helper: free, offline answers",
};

// Agents that can be run without a person at the keyboard.
export const HEADLESS = AGENT_IDS.filter((a) => AGENTS[a].headless);
// Agents that can edit files in a task workspace without a person.
export const EDITORS = AGENT_IDS.filter((a) => AGENTS[a].headless && AGENTS[a].edits);
// Agents that can be linked with an official API key.
export const API_CAPABLE = AGENT_IDS.filter((a) => AGENTS[a].api);

// Teammates added in 2.x by key or URL (not part of the 1.x agent list).
export const TEAMMATE_IDS = ['venice', 'civitai', 'gpu', 'hearth', 'free'];
export const UNFILTERED = TEAMMATE_IDS.filter((a) => AGENTS[a].unfiltered);

// @local, @LocalAI, @Local_AI, display names ("@Claude", "@ChatGPT"): case-insensitive.
export function aliasOf(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return [...AGENT_IDS, ...TEAMMATE_IDS].find((a) => AGENTS[a].mention.includes(w) || AGENTS[a].name.toLowerCase().replace(/[^a-z0-9]/g, '') === w) || null;
}

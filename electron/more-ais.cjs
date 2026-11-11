// The AIs added in 3.3 (the owner's "add all of them", Nov 2026): one list, read by the API
// adapter (providers.cjs), the CLI runner (agents.cjs), the installer (installer.cjs), the
// picture/video makers (makers.cjs) and main.cjs. src/registry.mjs has the same ids for the
// window (test/more-ais.test.cjs keeps the two in step).
//
// Each one is reached the official way only, with the owner's own account or key:
//   chat:    an OpenAI-compatible chat API (POST <base>/chat/completions) with his key
//   cli:     the company's own command-line agent, signed in with his account (or key)
//   cloud:   a cloud coding agent's own API (a job that works on his GitHub repo and comes back)
//   builder: an app builder through its official MCP server, driven by Claude Code
//   local:   a model run on this PC by Ollama
//   web:     only the company's own website (opened in a window; nothing is read from it)
// Checked against each company's own docs on 2026-11-11; model ids change, so every one can be
// changed in Settings › Accounts.

// ---- chat APIs (OpenAI-compatible) ----
const CHAT = Object.freeze({
  openrouter: { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', keys: 'https://openrouter.ai/keys', headers: { 'HTTP-Referer': 'https://hearthos.fun', 'X-OpenRouter-Title': 'Hearth AI Command Center' } },
  kimi: { name: 'Kimi', base: 'https://api.moonshot.ai/v1', model: 'kimi-k3.1-pro', keys: 'https://platform.moonshot.ai/' },
  glm: { name: 'GLM', base: 'https://api.z.ai/api/paas/v4', model: 'glm-4.6', keys: 'https://z.ai/' },
  cohere: { name: 'Cohere', base: 'https://api.cohere.ai/compatibility/v1', model: 'command-a-plus-05-2026', keys: 'https://dashboard.cohere.com/' },
  ai21: { name: 'AI21 Jamba', base: 'https://api.ai21.com/studio/v1', model: 'jamba-large', keys: 'https://studio.ai21.com/' },
  minimax: { name: 'MiniMax', base: 'https://api.minimax.io/v1', model: 'MiniMax-M3', keys: 'https://platform.minimax.io/' },
  nova: { name: 'Amazon Nova', base: 'https://api.nova.amazon.com/v1', model: 'nova-2-lite-v1', keys: 'https://nova.amazon.com/dev' },
  nvidia: { name: 'NVIDIA', base: 'https://integrate.api.nvidia.com/v1', model: 'nvidia/nemotron-3-ultra-550b-a55b', keys: 'https://build.nvidia.com/settings/api-keys' },
  groq: { name: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keys: 'https://console.groq.com/keys' },
  cerebras: { name: 'Cerebras', base: 'https://api.cerebras.ai/v1', model: 'gpt-oss-120b', keys: 'https://cloud.cerebras.ai/' },
  v0: { name: 'v0', base: 'https://api.v0.dev/v1', model: 'v0-1.5-md', keys: 'https://v0.dev/' },
});
const CHAT_IDS = Object.keys(CHAT);

// ---- command-line agents ----
// args({ prompt, mode, resume, model }) -> the argument list (never a shell). input: 'stdin' sends
// the prompt on stdin, 'arg' means args() put it in. parse: how the answer is read (see agents.cjs).
// readOnly: true when the tool can be told not to change files; false = it can't be held back in
// print mode, so the app only lets it work in a copy (never in read-only turns: it answers instead).
// keyEnv: the environment variable its own key goes in (saved encrypted as cli.<id>).
// login: its own sign-in (run in a terminal you can see). install: see installer.cjs.
const CLI = Object.freeze({
  cursor: {
    name: 'Cursor', bin: ['agent', 'cursor-agent'], input: 'arg', parse: 'claude', readOnly: true, keyEnv: 'CURSOR_API_KEY',
    // Without --force Cursor only proposes changes; with it, it makes them.
    args: ({ prompt, mode, resume, model }) => ['-p', '--output-format', 'json', '--trust', ...(mode === 'read' ? [] : ['--force']), ...(resume ? ['--resume', resume] : []), ...(model ? ['--model', model] : []), prompt],
    login: ['login'], install: { script: 'https://cursor.com/install' },
  },
  ghcopilot: {
    name: 'GitHub Copilot', bin: ['copilot'], input: 'arg', parse: 'text', readOnly: true, keyEnv: 'COPILOT_GITHUB_TOKEN',
    args: ({ prompt, mode, model }) => ['-p', prompt, '-s', ...(mode === 'read' ? ['--deny-tool=write', '--deny-tool=shell'] : mode === 'full' ? ['--allow-all-tools'] : ['--allow-tool=write', '--allow-tool=shell(git:*)', '--allow-tool=shell(npm test)']), ...(model ? ['--model', model] : [])],
    login: [], loginNote: 'Type /login in Copilot and follow the steps.', install: { npm: '@github/copilot' },
  },
  kiro: {
    name: 'Kiro', bin: ['kiro-cli'], input: 'stdin', parse: 'text', readOnly: true, keyEnv: 'KIRO_API_KEY', needsKey: true,
    args: ({ mode, model }) => ['chat', '--v3', '--no-interactive', ...(mode === 'read' ? ['--trust-tools=read_file,grep_search'] : ['--trust-all-tools']), ...(model ? ['--model', model] : [])],
    login: ['login'], install: { script: 'https://cli.kiro.dev/install' },
  },
  kimi: {
    name: 'Kimi', bin: ['kimi'], input: 'stdin', parse: 'text', readOnly: false,
    // Print mode approves its own tool calls (Kimi's docs), so it only gets turns where changes are wanted.
    args: () => ['--print', '--output-format', 'text', '--final-message-only'],
    login: [], loginNote: 'Type /login in Kimi and follow the steps.', install: { npm: '@moonshot-ai/kimi-code' },
  },
  aider: {
    name: 'Aider', bin: ['aider'], input: 'arg', parse: 'text', readOnly: true,
    args: ({ prompt, mode, model }) => ['--message', prompt, '--yes-always', '--no-auto-commits', '--no-stream', '--no-pretty', '--no-check-update', '--no-show-model-warnings', ...(mode === 'read' ? ['--dry-run'] : []), ...(model ? ['--model', model] : [])],
    login: [], loginNote: 'Aider uses your own model keys (for example OPENAI_API_KEY or ANTHROPIC_API_KEY) or a local Ollama model.', install: { uv: 'aider-chat', python: '3.12' },
  },
  opencode: {
    name: 'OpenCode', bin: ['opencode'], input: 'arg', parse: 'events', readOnly: true,
    args: ({ prompt, mode, resume, model }) => ['run', '--format', 'json', ...(mode === 'read' ? ['--agent', 'plan'] : ['--auto']), ...(resume ? ['--session', resume] : []), ...(model ? ['--model', model] : []), prompt],
    login: ['auth', 'login'], install: { npm: 'opencode-ai' },
  },
  goose: {
    name: 'Goose', bin: ['goose'], input: 'stdin', parse: 'events', readOnly: true,
    // GOOSE_MODE=chat: no tools at all (read-only turns); auto: it works on its own.
    args: () => ['run', '--no-session', '--output-format', 'json', '-i', '-'],
    env: ({ mode }) => ({ GOOSE_MODE: mode === 'read' ? 'chat' : 'auto' }),
    login: ['configure'], install: { script: 'https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh', env: { CONFIGURE: 'false' } },
  },
  cline: {
    name: 'Cline', bin: ['cline'], input: 'arg', parse: 'cline', readOnly: true,
    args: ({ prompt, mode, model }) => ['--json', ...(mode === 'read' ? ['--plan', '--auto-approve', 'false'] : ['--auto-approve', 'true']), ...(model ? ['-m', model] : []), prompt],
    login: ['auth'], install: { npm: 'cline' },
  },
  crush: {
    name: 'Crush', bin: ['crush'], input: 'arg', parse: 'text', readOnly: true,
    args: ({ prompt, mode }) => ['run', '-q', ...(mode === 'read' ? [] : ['--yolo']), prompt],
    login: [], loginNote: 'Crush asks for a provider and key the first time it runs.', install: { npm: '@charmland/crush' },
  },
  openhands: {
    name: 'OpenHands', bin: ['openhands'], input: 'arg', parse: 'text', readOnly: true,
    args: ({ prompt, mode }) => ['--headless', '-t', prompt, ...(mode === 'read' ? [] : ['--always-approve'])],
    login: [], loginNote: 'OpenHands asks for your model settings the first time it runs.', install: { uv: 'openhands', python: '3.12' },
  },
  amp: {
    name: 'Amp', bin: ['amp'], input: 'stdin', parse: 'claude', readOnly: false, keyEnv: 'AMP_API_KEY',
    args: ({ mode }) => ['-x', '--stream-json', ...(mode === 'read' ? [] : ['--dangerously-allow-all'])],
    login: ['login'], install: { npm: '@sourcegraph/amp' },
  },
  auggie: {
    name: 'Augment', bin: ['auggie'], input: 'arg', parse: 'text', readOnly: true,
    args: ({ prompt, mode }) => ['--print', prompt, ...(mode === 'read' ? ['--tools', 'read,grep,find,ls'] : [])],
    login: ['auth', 'login'], install: { npm: '@augmentcode/auggie@prerelease' },
  },
  droid: {
    name: 'Factory Droid', bin: ['droid'], input: 'arg', parse: 'claude', readOnly: true, keyEnv: 'FACTORY_API_KEY',
    // No --auto = read-only (Factory's docs); low = file edits; high = everything.
    args: ({ prompt, mode, resume, model }) => ['exec', '-o', 'json', ...(mode === 'read' ? [] : ['--auto', mode === 'full' ? 'high' : 'low']), ...(resume ? ['-s', resume] : []), ...(model ? ['-m', model] : []), prompt],
    login: [], loginNote: 'Run droid once to sign in, or add a Factory API key.', install: { npm: '@factory/cli' },
  },
  warp: {
    name: 'Warp', bin: ['oz', 'oz-preview'], input: 'arg', parse: 'text', readOnly: false, keyEnv: 'WARP_API_KEY',
    args: ({ prompt }) => ['agent', 'run', '--prompt', prompt],
    login: ['login'], install: { manual: 'https://docs.warp.dev/reference/cli' },
  },
});
const CLI_IDS = Object.keys(CLI);

// ---- cloud coding agents (they work on a GitHub repo and come back with a pull request) ----
const CLOUD = Object.freeze({
  devin: { name: 'Devin', base: 'https://api.devin.ai/v1', keys: 'https://app.devin.ai/' },
  jules: { name: 'Jules', base: 'https://jules.googleapis.com/v1alpha', keys: 'https://jules.google.com/' },
});
const CLOUD_IDS = Object.keys(CLOUD);

// ---- app builders through their official MCP servers (Claude Code connects and signs in) ----
const BUILDERS = Object.freeze({
  lovable: { name: 'Lovable', mcp: 'https://mcp.lovable.dev', web: 'https://lovable.dev/' },
  replit: { name: 'Replit', mcp: 'https://mcp.replit.com/server/mcp', web: 'https://replit.com/' },
});
const BUILDER_IDS = Object.keys(BUILDERS);

// ---- on this PC ----
const LOCAL = Object.freeze({
  phi: { name: 'Phi', vendor: 'Microsoft, on this computer', model: 'phi4' },
});
const LOCAL_IDS = Object.keys(LOCAL);

// ---- website only (no CLI, API or MCP for a personal account) ----
const WEB = Object.freeze({
  bolt: { name: 'Bolt', web: 'https://bolt.new/' },
  firebase: { name: 'Firebase Studio', web: 'https://studio.firebase.google.com/' },
});
const WEB_IDS = Object.keys(WEB);

// ---- picture, video and voice makers (Settings › Media & voice keys) ----
const IMAGE_MAKERS = ['flux', 'stability', 'ideogram', 'leonardo'];
const VIDEO_MAKERS = ['runway', 'luma', 'kling', 'pika'];
const MAKER_NAMES = Object.freeze({ flux: 'FLUX (Black Forest Labs)', stability: 'Stability AI', ideogram: 'Ideogram', leonardo: 'Leonardo', runway: 'Runway', luma: 'Luma', kling: 'Kling', pika: 'Pika (through fal.ai)', elevenlabs: 'ElevenLabs' });
// Kling signs in with two parts (access key + secret key): saved as kling and kling.secret.
const MAKER_KEYS = [...IMAGE_MAKERS, ...VIDEO_MAKERS, 'kling.secret'];

// Every new teammate (chat, CLI, cloud, builders, local, web).
const TEAM = [...CHAT_IDS, ...CLI_IDS, ...CLOUD_IDS, ...BUILDER_IDS, ...LOCAL_IDS, ...WEB_IDS].filter((id, i, a) => a.indexOf(id) === i);
// The ones that answer by API key (kimi is a CLI that can also use its API key).
const KEYED = [...CHAT_IDS, ...CLOUD_IDS];
const kindOf = (id) => (CLI[id] ? 'cli' : CHAT[id] ? 'chat' : CLOUD[id] ? 'cloud' : BUILDERS[id] ? 'builder' : LOCAL[id] ? 'local' : WEB[id] ? 'web' : null);

module.exports = { CHAT, CHAT_IDS, CLI, CLI_IDS, CLOUD, CLOUD_IDS, BUILDERS, BUILDER_IDS, LOCAL, LOCAL_IDS, WEB, WEB_IDS, IMAGE_MAKERS, VIDEO_MAKERS, MAKER_NAMES, MAKER_KEYS, TEAM, KEYED, kindOf };

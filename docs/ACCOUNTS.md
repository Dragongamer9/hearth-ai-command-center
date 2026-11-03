# Connecting your AI accounts

Hearth AI Command Center is a personal tool. Every AI is connected through **its provider's own official tool and sign-in**. The Command Center never asks for, sees, stores or refreshes your passwords or login tokens: the official tool keeps them and refreshes them itself.

| AI | Connect account does | Paid by | Disconnect does |
|---|---|---|---|
| **Claude** (lead) | Installs Claude Code if needed, then opens its own browser sign-in (`claude auth login`) | Your Claude subscription (Pro/Max). No API charges | `claude auth logout` |
| **ChatGPT** | Installs the Codex CLI if needed, then opens "Sign in with ChatGPT" (`codex login`) | Your ChatGPT plan's included Codex usage. No API charges | `codex logout` |
| **Gemini** | Installs Gemini CLI if needed, then opens it so you can choose "Sign in with Google" | Your Google account: free tier (about 1,000 requests/day) or your Gemini plan | Removes Gemini CLI's cached Google sign-in (`~/.gemini/oauth_creds.json`); other Gemini settings are kept |
| **Local AI** | **Install** runs Ollama's official installer in a terminal (it asks for your computer password there); then `ollama pull <model>` | Free. Runs on your computer | Untick **Use** on its card |
| **FreeBuff** | Installs FreeBuff; it signs in inside its own session | Free FreeBuff account (its own daily limits) | Sign out inside FreeBuff |

Grok, Mistral and Qwen work the same way: **Install** puts the official tool on your computer, then its own browser sign-in opens.

Disconnect signs that tool out on this computer everywhere, not only in Hearth AI (you are asked to confirm). Every card also has a **Use** switch to stop Hearth AI from using an AI without signing it out.

API keys are still available for Claude and ChatGPT as an optional backup ("Link with: API key"). That is billed per use to your developer account, separately from any subscription.

## One-click install
Every AI card has an **Install** button, and the Agents page has **Install all**, which installs every AI tool that isn't installed yet, one after another. Each step runs in a terminal window you can see, with a summary at the end that says what worked and what failed. When an install finishes, the card switches to *Installed* and (for a single AI) its own sign-in opens by itself.

What gets installed, and where:

| Tool | How | Password? |
|---|---|---|
| Claude Code, Codex CLI, Gemini CLI, Grok Build CLI, Qwen Code, FreeBuff | Official npm packages, installed with `npm install -g --prefix ~/.local <package>`. Programs land in `~/.local/bin` | No |
| Node.js (only if Node.js 20+ isn't already there) | The current LTS build from nodejs.org, checked against the official `SHASUMS256.txt` before unpacking, into `~/.local/share/hearth-ai/node`. A download with the wrong checksum is never installed | No |
| uv, for Mistral Vibe (only if missing) | Astral's official installer (`https://astral.sh/uv/install.sh`) into `~/.local/bin`, without changing your shell files; then `uv tool install mistral-vibe` | No |
| Ollama (Local AI) | Ollama's official installer (`https://ollama.com/install.sh`). Install all includes it only if you tick it | **Yes**: Ollama installs system-wide, so its installer asks for your computer password in the terminal |

The Command Center never sees, asks for, stores or passes your password: you type it into the terminal, straight to your system. Only the vendors' own sources are used (npm, nodejs.org, astral.sh, ollama.com).

Good to know:
- The Node.js set up by Hearth AI is used by Hearth AI and the terminals it opens. If you also want `claude`, `codex` etc. in your own terminal without a system Node.js, install Node.js 20+ from your package manager.
- Ollama's installer needs `curl` (`sudo apt install curl`).
- After installing Ollama, download a model: `ollama pull llama3.2`.

## Why this is the supported way
- **Anthropic** doesn't let other apps offer Claude.ai login or handle subscription tokens. Its docs do allow a person to sign in to the *unmodified* Claude Code program with their own subscription, which is what happens here. Pro and Max limits assume ordinary individual use, so heavy multi-agent runs reach them sooner. When that happens, the task is checkpointed and another AI continues.
- **OpenAI** supports "Sign in with ChatGPT" in Codex for local use. It recommends API keys for automated server pipelines. ChatGPT logins can't be used directly by other apps; Codex is the official route.
- **Google** supports "Sign in with Google" in Gemini CLI, including a free tier.
- **FreeBuff** has no documented hands-free mode or sign-in that other apps can use. Unofficial "FreeBuff-to-API" proxies exist; Hearth AI does not use them. FreeBuff works hands-on: *Continue in FreeBuff* opens it in the task's workspace with the handoff brief on your clipboard.

## Status and limits
The Control Room (Agents page) shows for each AI:
- whether it's connected
- what it's doing
- how it's paid for
- whether it's out of usage

When an AI hits its usage limit, it's marked *Out of usage*. The task it was on is saved and handed to the next free AI with the same kind of role (coding, research, or review). Tasks still waiting in its queue move the same way. The lead is the fallback when nobody else has that role.

## Sources
- Anthropic: https://code.claude.com/docs/en/legal-and-compliance
- OpenAI Codex sign-in: https://learn.chatgpt.com/docs/auth
- Gemini CLI: https://github.com/google-gemini/gemini-cli
- FreeBuff: https://github.com/CodebuffAI/freebuff

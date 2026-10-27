# Connecting your AI accounts

Hearth AI Command Center is a personal tool. Every AI is connected through **its provider's own official tool and sign-in**. The Command Center never asks for, sees, stores or refreshes your passwords or login tokens: the official tool keeps them and refreshes them itself.

| AI | Connect account does | Paid by | Disconnect does |
|---|---|---|---|
| **Claude** (lead) | Installs Claude Code if needed, then opens its own browser sign-in (`claude auth login`) | Your Claude subscription (Pro/Max). No API charges | `claude auth logout` |
| **ChatGPT** | Installs the Codex CLI if needed, then opens "Sign in with ChatGPT" (`codex login`) | Your ChatGPT plan's included Codex usage. No API charges | `codex logout` |
| **Gemini** | Installs Gemini CLI if needed, then opens it so you can choose "Sign in with Google" | Your Google account: free tier (about 1,000 requests/day) or your Gemini plan | Removes Gemini CLI's cached Google sign-in (`~/.gemini/oauth_creds.json`); other Gemini settings are kept |
| **Local AI** | Opens ollama.com to install Ollama; then `ollama pull <model>` | Free. Runs on your computer | Untick **Use** on its card |
| **FreeBuff** | Installs FreeBuff; it signs in inside its own session | Free FreeBuff account (its own daily limits) | Sign out inside FreeBuff |

Disconnect signs that tool out on this computer everywhere, not only in Hearth AI (you are asked to confirm). Every card also has a **Use** switch to stop Hearth AI from using an AI without signing it out.

API keys are still available for Claude and ChatGPT as an optional backup ("Link with: API key"). That is billed per use to your developer account, separately from any subscription.

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

When an AI hits its usage limit, it's marked *Out of usage*. Its task is saved and handed to the next free AI, starting with the lead.

## Sources
- Anthropic: https://code.claude.com/docs/en/legal-and-compliance
- OpenAI Codex sign-in: https://learn.chatgpt.com/docs/auth
- Gemini CLI: https://github.com/google-gemini/gemini-cli
- FreeBuff: https://github.com/CodebuffAI/freebuff

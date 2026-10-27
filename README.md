# Hearth AI Command Center

Desktop command center for Hearth OS: sign in with your **Claude**, **ChatGPT**, **Gemini** and **FreeBuff** accounts (plus a free **local AI**), talk to all of them in one team chat, hand them tasks, and let them pick up each other's work when one runs out of usage. Every task runs through a policy check, independent review and your approval, and every step is saved. Linux AppImage.

Hearth OS stays pinned at **0.6.55**. This app never changes Hearth OS, merges, releases or deploys anything.

Docs: `docs/ACCOUNTS.md` (connecting accounts), `docs/SAVING_AND_RESUME.md` (what's saved, recovery, handoff), `docs/IN_APP_UPDATES.md` (updates), `FULL_VERSION_ROADMAP.md` (what's next).

## Install & run

1. Download `Hearth-AI-Command-Center-<version>-x86_64.AppImage` (from a GitHub Release, or the *Build Linux AppImage* workflow artifact — artifacts download as a zip, unzip it first).
2. Put it somewhere writable, e.g. `~/Applications`.
3. `chmod +x Hearth-AI-Command-Center-*.AppImage` and double-click it (or run it from a terminal).

### Required Linux libraries
- **FUSE 2** to mount the AppImage: `sudo apt install libfuse2` (Ubuntu 22.04+ / Debian: `libfuse2t64` on 24.04). Fedora: `sudo dnf install fuse-libs`. Arch: `sudo pacman -S fuse2`.
- **git** (for the shared workspace) and **Node.js 18+** (for the agent CLIs).
- A keyring (GNOME Keyring / KWallet) only if you use API keys instead of account linking.
- Standard desktop libs (GTK3, NSS, libasound) present on any normal desktop install.

### Troubleshooting
| Problem | Fix |
|---|---|
| "dlopen(): error loading libfuse.so.2" | Install FUSE 2 (above), or run with `--appimage-extract-and-run`. |
| Nothing opens, "SUID sandbox" error | Your distro restricts user namespaces (Ubuntu 24.04+ AppArmor). Run with `--no-sandbox`, or add an AppArmor profile for the AppImage. |
| Agent shows "Not installed" but it is | Use *Locate program…*; desktop launchers often have a shorter PATH than your terminal. |
| Sign in does nothing | No terminal app found. Run `claude auth login` / `codex login` yourself, then *Re-check*. |
| Updates say "disabled" | You launched an unpacked build — run the `.AppImage` file itself. |

## Connecting your AIs
Open **Agents** (or follow the setup checklist on the Overview page) and press **Connect account** on each AI. That installs the official tool if needed, then opens the provider's own sign-in. No API keys to hunt down. Details, billing and limits: `docs/ACCOUNTS.md`.

| AI | Signs in with | Paid by |
|---|---|---|
| Claude (lead coordinator) | Claude Code | Your Claude subscription |
| ChatGPT | Codex CLI ("Sign in with ChatGPT") | Your ChatGPT plan |
| Gemini | Gemini CLI ("Sign in with Google") | Free tier / your Google plan |
| Local AI | Ollama on your computer | Free |
| FreeBuff | FreeBuff (hands-on in a terminal) | Free account |

Then pick a **shared project folder** (any git repo) in Settings.

## Using it
- **Team chat:** everyone sees every message; Claude leads and answers first. `@claude` / `@chatgpt` / `@gemini` / `@local` talks to one AI. Ask them to split up work and their `TASK:` proposals become one-click *Add to board* cards. FreeBuff can't reply on its own, so paste what it says with *Post as FreeBuff*.
- **Tasks:** *Start with Claude/ChatGPT* runs the agent in that task's own git branch and working copy. Every run is committed as a checkpoint. *Hand off to…* or *Continue in FreeBuff* lets another agent continue from the same files.
- **Out of usage:** the task is checkpointed and handed to the next free agent automatically.
- **Approvals:** nothing is merged, pushed, released or deployed by the app.

## Develop
```bash
npm ci
npm test            # unit + integration tests (fake CLIs, real git)
npm start           # build UI and launch Electron
npm run dist:linux  # check + test + build release/*.AppImage
```

## Architecture
- `electron/main.cjs` — window, IPC (sender-checked, every input validated), state file, crash/start-failure handling, single instance.
- `electron/agents.cjs` — runs Claude Code / Codex / FreeBuff (spawn, no shell, prompt over stdin, timeouts), detects usage limits, outages and sign-in problems.
- `electron/workspace.cjs` — per-task git branch + worktree, checkpoint commits, progress summaries.
- `electron/store.cjs` — atomic, versioned, self-recovering state file with secret scrubbing.
- `electron/providers.cjs` — optional API-key path (Anthropic Messages / OpenAI Chat Completions).
- `electron/secrets.cjs` — keyring-encrypted key store.
- `electron/updater.cjs` — consent-only `electron-updater` flow.
- `electron/preload.cjs` — the only API the UI can touch.
- `src/` — UI (Vite, no framework); `policy.mjs`, `chat.mjs`, `team.mjs` hold the testable logic (policy check, chat routing, handoff briefs, task states, crash recovery).

No local HTTP server or open port: the UI talks to the background process over Electron IPC only. Renderer runs sandboxed with context isolation, no Node access, strict CSP, navigation and pop-ups blocked.

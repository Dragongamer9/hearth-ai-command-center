# Hearth AI Command Center

Desktop coordination console for Hearth OS: hand tasks to **Claude**, **ChatGPT** and **FreeBuff**, run them through a policy check, independent review and your approval, and keep an audit record of every decision. Linux AppImage, local-only, prototype.

Hearth OS stays pinned at **0.6.55**. This app never changes Hearth OS, merges, releases or deploys anything.

See `FULL_VERSION_ROADMAP.md` for what's real vs. planned, and `docs/IN_APP_UPDATES.md` for updates.

## Install & run

1. Download `Hearth-AI-Command-Center-<version>-x86_64.AppImage` (from a GitHub Release, or the *Build Linux AppImage* workflow artifact — artifacts download as a zip, unzip it first).
2. Put it somewhere writable, e.g. `~/Applications`.
3. `chmod +x Hearth-AI-Command-Center-*.AppImage` and double-click it (or run it from a terminal).

### Required Linux libraries
- **FUSE 2** to mount the AppImage: `sudo apt install libfuse2` (Ubuntu 22.04+ / Debian: `libfuse2t64` on 24.04). Fedora: `sudo dnf install fuse-libs`. Arch: `sudo pacman -S fuse2`.
- A **keyring** to store API keys securely: GNOME Keyring or KWallet (most desktops have one). Without it the app refuses to save keys.
- Standard desktop libs (GTK3, NSS, libasound) present on any normal desktop install.

### Troubleshooting
| Problem | Fix |
|---|---|
| "dlopen(): error loading libfuse.so.2" | Install FUSE 2 (above), or run with `--appimage-extract-and-run`. |
| Nothing opens, "SUID sandbox" error | Your distro restricts user namespaces (Ubuntu 24.04+ AppArmor). Run with `--no-sandbox`, or add an AppArmor profile for the AppImage. |
| "No OS keyring available" on Agents page | Install/unlock GNOME Keyring or KWallet and restart the app. |
| Updates say "disabled" | You launched an unpacked build — run the `.AppImage` file itself. |

## Connecting agents
Agents → paste your **Anthropic** or **OpenAI** API key → Save. Keys are encrypted with your OS keyring in the app's data folder (`~/.config/Hearth AI Command Center/`, file mode 0600) and never go to the UI, logs or Git. API usage is billed by the provider; chat subscriptions (Claude Pro, ChatGPT Plus) do not include API credit.

FreeBuff has no verified public API, so it's assignable but not connected.

## Develop
```bash
npm ci
npm test            # 19 unit tests: provider errors, IPC validation, policy
npm start           # build UI and launch Electron
npm run dist:linux  # check + test + build release/*.AppImage
```

## Architecture
- `electron/main.cjs` — window, IPC (sender-checked, every input validated), state file, crash/start-failure handling, single instance.
- `electron/providers.cjs` — official Anthropic Messages / OpenAI Chat Completions calls with timeouts, auth / rate-limit / malformed-response handling.
- `electron/secrets.cjs` — keyring-encrypted key store.
- `electron/updater.cjs` — consent-only `electron-updater` flow.
- `electron/preload.cjs` — the only API the UI can touch.
- `src/` — UI (Vite, no framework) and the policy check.

No local HTTP server or open port: the UI talks to the background process over Electron IPC only. Renderer runs sandboxed with context isolation, no Node access, strict CSP, navigation and pop-ups blocked.

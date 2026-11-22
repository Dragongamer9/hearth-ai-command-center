# Roadmap & current limitations

## New in 3.14 (the owner's number, Nov 21, 2026)
- Everything connects by itself (the owner: "All these connections need to be automatic and from now on i shouldnt need to connect any manuel setting or adresses or keys. should just launch do a auto scan or whatever and pick the stuff up"): at start and every few minutes the Command Center scans your own Tailscale devices (same account), asks each one's Hearth AI list (port 8189, `/v1/hearth/ai`: its chat, pictures, voices and speech to text), and uses what answers; a saved Home server address that doesn't answer falls back to the scan: no addresses, keys or share codes to type. Your own GPU servers and Hearth devices address stay as you set them and win over what's found; nothing found is saved over your settings.
- Your keys stay readable on every desktop: the Command Center remembers which password store (KDE's wallet or GNOME Keyring) its keys were saved in and always opens that one, so switching desktops never hides your GPU servers, keys or sign-ins again (found Nov 21: keys saved on KDE Plasma, Mantel asked GNOME Keyring).
- In-app updates keep working for the AppImage and the .deb (red flag).

## New in 0.4.0
- AIs can do in chat and tasks what they do in their own apps: edit, run commands, git and web, with each tool's own safety checks. Full access is an opt-in.
- GitHub page: Connect GitHub (official sign-in), clone, open any folder, pull, push branches, pull requests.
- Every checkpoint is backed up to its own GitHub branch. "Approve & merge into main" merges and pushes after you confirm.
- Extra folders on your computer can be shared with the AIs.

## New in 0.3.0
- Connect account / Disconnect for every AI through official sign-ins; billing shown per AI; Use on/off switch.
- Gemini (Google sign-in) and a local AI (Ollama) join the team.
- Setup checklist, Control Room, Claude as lead coordinator, agents told what the Command Center can do, Add & start from chat, Show changes on tasks.

## Working since 0.2.0
- Account-linked Claude (Claude Code) and ChatGPT (Codex CLI); FreeBuff via its CLI in a terminal. Optional API keys.
- Team chat: everyone sees everything, @mentions, task proposals become board cards, FreeBuff relay.
- Shared, provider-independent tasks: per-task git branch and worktree, checkpoint before and after every agent run, handoff briefs, auto-handoff when an agent runs out of usage.
- Task states: Running, Saving, Paused — Usage Limit, Waiting for Provider, Needs Authentication, Ready to Resume.
- Crash and restart recovery; atomic, versioned saves with corrupt-file fallback and restore; secret scrubbing; export.
- Policy check, approvals, audit log, in-app updates from published GitHub Releases.

## Not yet
- FreeBuff can't be driven automatically (no non-interactive mode found), so its work is hands-on in a terminal.
- No GitHub PR/CI tracking; approved merges/releases/deploys are recorded, not executed.
- Agents run one task at a time each; no queue or scheduler yet.
- Out-of-usage reset time is estimated (1 h) unless the provider states it.

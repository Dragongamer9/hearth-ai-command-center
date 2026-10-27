# Roadmap & current limitations

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

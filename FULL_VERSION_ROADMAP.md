# Roadmap & current limitations

## Working now (0.2.0)
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

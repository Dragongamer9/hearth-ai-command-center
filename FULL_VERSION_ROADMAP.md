# Roadmap & current limitations

## Working now (prototype)
- Hearth-style desktop app (Electron, Linux AppImage x86_64).
- Task flow from the governance diagram: owner creates task → policy & scope check → implementer agent → checkpoint → tests & evidence → independent review → owner approval → approved / rejected → audit record.
- Policy check: blocks Hearth OS version changes (pinned 0.6.55), secrets pasted into tasks, and same-agent self-review; warns on boot-critical, destructive and merge/release/deploy work.
- Approvals with approve / request changes / reject; append-only audit log with JSON export.
- **Claude (Anthropic API)** and **ChatGPT (OpenAI API)**: real calls from the background process. Keys are encrypted with the OS keyring and never shown to the UI. Used for "ask for a plan", "independent opinion" and a quick console.
- In-app updates from published GitHub Releases (see `docs/IN_APP_UPDATES.md`).

## Not implemented yet
- **FreeBuff**: no verified public API found, so it's a manual-only agent. No invented endpoint.
- Agents do not edit code, run tests, push branches or open PRs. Stages are advanced by you.
- No GitHub integration (branch/PR/CI status).
- Approved merges/releases/deploys are recorded only, never executed.
- No isolated per-agent workspaces / sandboxes yet.
- Hosted web version / remote access.

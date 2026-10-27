# Saving, recovery and cross-provider resume

Tasks belong to the Command Center, not to whichever AI is working on them. Any agent can pick up any task from its last checkpoint.

## What is saved

| What | Where | When |
|---|---|---|
| Tasks: title, instructions, implementer/reviewer, stage, policy result, notes, decisions | App data folder `command-center-state.json` | After every change |
| Every agent run: who, when, status, the exact brief it was given, its reply or error, its checkpoint | same file | **Before** each agent call (status *Running*) and right after it returns |
| Team chat, audit log, agent out-of-usage status | same file | After every change |
| Code / file changes | Git: each task has its own branch `hearth/<id>-<title>` and working copy in `<app data>/workspaces/<id>` | A commit **before** each agent call (snapshot of anything already there) and **after** it (the agent's work, even if it failed or ran out of usage). Also a recovery commit at startup after a crash |
| FreeBuff handoff brief | `<app data>/workspaces/<id>-HANDOFF.md` + clipboard | When you click *Continue in FreeBuff* |

App data folder on Linux: `~/.config/Hearth AI Command Center/` (files are mode 0600).

## How saving stays safe
- **Atomic:** writes go to a temp file, are flushed to disk (fsync), then renamed over the old file. An interrupted write can't leave a half-written save.
- **Versioned:** the last 10 good saves are kept (`command-center-state.json.1` … `.10`). Settings → *Saved work & backups* lists them, and you can restore any of them. Restoring keeps the current save as a backup too.
- **Corruption recovery:** if the latest save can't be read at startup, it is set aside as `.corrupt-<time>` (never deleted) and the newest readable backup is loaded. The app tells you when this happens.
- **Git history** is a second, independent record of every checkpoint.

## Provider problems
| Situation | Task shows | What happens |
|---|---|---|
| Usage / credit limit, 429 | Paused — Usage Limit | Checkpoint, agent marked out (1 h or until you click *Mark available*), task **auto-handed to the next free agent** (Settings toggle) |
| Outage, overload, network | Waiting for Provider | Checkpoint; resume later or hand off |
| Not signed in / not installed | Needs Authentication | Checkpoint; sign in on the Agents page, then resume |
| Timeout, you pressed Stop, crash | Ready to Resume | Checkpoint; resume with any agent |
| App killed / crashed mid-run | Ready to Resume | On next start the run is marked *interrupted* and files it changed are committed in a recovery checkpoint |

## Handoff
The next agent gets one brief built from the Command Center's own record:
- the task
- what was done (commits and changed files on the branch)
- what each earlier agent reported (including its *STATUS: CONTINUE — what remains* line)
- notes
- explicit instructions to continue rather than start over

It works in the same branch and working copy, so it sees the real files.

## Secrets
API keys are stored only in the OS keyring. They are never in prompts, briefs, saves, exports or the audit log. As an extra guard, anything that looks like a key or token is replaced with `[REDACTED]` before it is written to disk, exported, or shown from an agent's reply.

## Export and back up
- Settings or Audit log → **Export everything** writes one JSON file (secrets scrubbed).
- For a full backup, copy the app data folder. Your project repo plus the `hearth/*` branches hold all code checkpoints.

## Limitations, honestly
- If an agent was mid-reply when its usage ran out, the app crashed, or the network dropped, **any text it hadn't returned yet is gone**. Only what it had already written to files, plus what it returned, is saved.
- Agents reached by API key (instead of an account link) can plan and review but can't edit files.
- FreeBuff runs interactively. Its file changes are checkpointed when you click *FreeBuff finished — checkpoint*, but its chat text is only shared if you paste it with *Post as FreeBuff*.
- The 1-hour out-of-usage pause is a guess when the provider doesn't say when usage resets. *Mark available* clears it.
- Nothing is pushed to GitHub automatically. Back up your project repo and the `hearth/*` branches yourself.

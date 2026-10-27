# GitHub, files and what the AIs may do

## Connecting GitHub
1. Install **git** and the **GitHub CLI** (`gh`), GitHub's official tool:
   - Debian, Ubuntu or Peppermint: `sudo apt install git gh`
   - Fedora, or Fedora-based images inside a toolbox: `sudo dnf install git gh`
2. In Hearth AI, open **GitHub → Connect GitHub**. GitHub's own sign-in opens in your browser.
3. Hearth AI then lets git push and pull with that sign-in (`gh auth setup-git`). It never sees your password or token.

## Projects
- **Open folder…** works with any folder. If it isn't a git repo yet, Hearth AI asks before starting to track it. That adds a hidden `.git` folder and one first commit; your files aren't changed.
- **Clone from GitHub** accepts `owner/repo` or a github.com link and clones into `~/HearthProjects`.
- **Pull latest** only fast-forwards, and refuses if you have uncommitted changes, so nothing is overwritten.

## Where AI work goes
- **Tasks:** each task works on its own branch `hearth/<id>-<title>` in its own working copy.
- **Team chat:** chat work goes on the project's chat branch `hearth/chat…-team-chat`.
- After every run or chat reply, changes are committed as a checkpoint. They're also **pushed to that branch on GitHub** (Settings → *Back up every checkpoint*), so nothing is lost even if this computer dies.
- **The main branch only changes when you click "Approve & merge into main".** Hearth AI merges and pushes, but only after a confirmation. A merge conflict changes nothing. Pushing directly to `main` or `master` is refused everywhere else.
- **Open pull request** pushes the task branch and opens a GitHub pull request, if you'd rather review there.

## What the AIs may do (Settings)
| Setting | Claude | ChatGPT (Codex) | Gemini |
|---|---|---|---|
| **Like their own apps** (default) | Claude Code `auto` mode | Codex `--approve-for-me` (sandbox plus automatic review) | `auto_edit` |
| **Full access** (opt-in, warning) | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` | `yolo` |

- In both settings they can edit files, run commands, use git and use the web (Claude can always search and fetch web pages).
- Reviewers and the local AI stay read-only.
- **Other folders:** Settings → *Add folder…* gives the AIs access to more folders on your computer. They're passed to each tool as an extra directory: `--add-dir` for Claude and Codex, `--include-directories` for Gemini. Your whole home folder or `/` can't be added.

## Limits
- Codex's normal sandbox may block network access during a run. That's Codex's own safety default.
- Web access depends on each tool's own web features.
- Full access really means no safety net. Keep it off on anything that touches booting Hearth OS.

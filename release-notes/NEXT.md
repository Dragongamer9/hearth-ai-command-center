### What's new
The Command Center is now just chats, like the Claude app, with your whole AI team in every chat.

- **Chats only.** The sidebar shows your chats (Pinned, Today, Yesterday, Earlier) with the repo each one works on. No more projects, board, approvals, jobs or Habitat pages. Rename, pin, reorder by dragging, hide and delete (with Undo and Recently deleted) still work.
- **Every chat can connect to a GitHub repo.** Use the repo button in the message box to pick one of your repos and a branch, or "No repo, just talk".
- **The team works on a small temporary copy.** When a chat has a repo, the app copies only its newest commit to your PC (about 5 MB for the Command Center, about 100 MB for Hearth OS). The AIs read, search, edit and run quick checks there, then push to the chat's own branch. GitHub Actions does the real builds and tests, and the result shows in the chat. If a test fails you see the error lines and an "Ask the team to fix it" button.
- **The copy goes away by itself:** when you close or delete the chat, or after it sits unused for a day (change this in Settings › GitHub). A copy with work that isn't on GitHub yet is never deleted without asking you first. You get "Push to a branch first" every time.
- **See what the AIs did.** Every reply shows its steps: searched, read files, read a web page, edited files, ran checks, pushed, tests in GitHub Actions.
- **Files changed card** with Show changes (a full diff), Open pull request and "Merge into main…". Merging always asks you in a popup first, also when Claude asked to do it.
- **Live previews.** When an AI makes a mockup, page, diagram or document, it opens next to the chat with Preview and Code tabs, plus Download and "Save to repo…". Previews run sealed off: no internet (unless you allow it in Settings › Tools) and no access to the app or your files.
- **Attach files, images and screenshots** (paste a screenshot straight into the box), talk instead of typing, and turn **Web** and **Run & build** on or off for each message.
- **Claude still leads.** It answers first, can hand parts to ChatGPT or Gemini (or type @name to ask one AI), and when it changes files the reviewer checks the diff right in the chat.
- **New Settings:** AI team, Accounts, GitHub, Tools, Permissions, Appearance, App updates and Saved data. Saved data shows how much space the temporary copies use, with a Clean up button.

### Your old work is all still here
- Every chat you had is in the list, including each project's team chat, with all its messages. A project's chats are connected to that project's repo.
- The old boards, tasks, approvals and audit logs are kept on disk exactly as they were. You can look through them in Settings › Saved data.
- Your settings keep their values. The chats list from before this update is kept as a backup too.

### The rules stay the same
- Version numbers are only yours to pick.
- Every commit is yours only, with no AI lines.
- Nothing reaches main without your yes.
- In-app updates keep working for the AppImage and the .deb.

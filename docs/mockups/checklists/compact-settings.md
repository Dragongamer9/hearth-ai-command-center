# Compact Settings, characters for every AI, and a collapsible right panel

Release: 3.13
Approved by the owner on 2026-11-14 ("All looks good make it and push it"). The starter characters are drawn for this
app (no one else's characters). `- [x] part — file: "proof"` once built.

## The Settings dialog (compact-A1…A8)
- [x] The dialog fits the window (top and bottom margins); only its page scrolls — src/styles.css: ".set.dlg.cmp .spage { flex: 1; min-height: 0; overflow-y: auto"
- [x] Left side list: "Settings", "Search settings", the seven tabs with their icons; the open one highlighted — src/main.js: "<nav class=\"snav2\"><b class=\"st\">Settings</b><input id=\"set-q\" class=\"sq\" placeholder=\"Search settings\""
- [x] A header with the tab's name and a round ✕ — src/main.js settingsView: ".sph" header with the tab name and close-modal ✕
- [x] Rows are one line (36 px): name, a short grey note beside it, the control on the right — src/styles.css: ".set.dlg.cmp .box > .srow { min-height: 36px"
- [x] Group titles in small capitals, groups in two columns when the window is wide enough — src/styles.css: ".set.dlg.cmp .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr))"
- [x] Buttons like ＋ Add, See and edit, Change…, Set up open the full form in the dialog, with ‹ Back — src/main.js: "<button class=\"mini sub-back\" data-a=\"sub-back\">‹ Back</button>"

## AI team (compact-A1)
- [x] Who's in your chats: all AIs in two columns, "N AIs · M on", a switch or Sign in / Set up each — src/main.js: "Who's in your chats <span class=\"cnt\">${ids.length} AIs · ${on} on</span>"
- [x] Roles: Team lead, Reviewer, New messages start with — src/main.js: "row('Team lead', '', sel('set-lead'"
- [x] Several chats at once: Working at the same time, Notify when a chat needs me, Check the team (Test team, Tool test) — src/main.js: "grp('Several chats at once', [row('Working at the same time'"

## Accounts (compact-A3)
- [x] Signed in with your account, With a key, Your own, On the web, GitHub, Devices — src/main.js CONNECT_GROUPS: "['Signed in with your account', 'Your own accounts: the Command Center never sees your password.'"

## Ithil (compact-A5)
- [x] Ithil (Hearth AI): Now (Test), Host, Port, Key (Replace, Remove) — src/main.js ithilBox: Now (Test), Host, Port, Key with Replace and Remove
- [x] With the team: In your team, Hand her tasks, Chat with Ithil (Open chat) — src/main.js: "Hand her tasks in chats that build"
- [x] Her hard limits (always on), On Live (Mesh, Cores) — src/main.js: "<div class=\"box\"><h3>Her hard limits</h3>"

## Tools (compact-A6)
- [x] Quick checks with switches and ＋ Add; Skills and Install a skill from a file… — src/main.js: "row('Install a skill from a file…'"
- [x] Connectors (MCP) with switch and 🗑, Add a connector — src/main.js: "grp('Connectors (MCP servers)'" with conn-toggle and conn-del
- [x] Permissions: Run commands, Files outside the project, Push to GitHub, Live previews, Use this desktop — src/main.js: "row('Run commands'", "row('Push to GitHub'", "row('Live previews'", "grp('Let your AI use this desktop'"

## Memory (compact-A7)
- [x] Custom instructions box — src/main.js: "grp('Custom instructions', [`<div class=\"srow\"><textarea id=\"ci-about\""
- [x] Memory across chats; Scheduled tasks; Saved data — src/main.js PAGES.memory: Memory across chats, Scheduled tasks and Saved data in two columns

## Voice & avatar (compact-A8)
- [x] Voice: Read answers aloud, Voice, Each AI its own voice, Talk to the team — src/main.js: "grp('Voice', [row('Read answers aloud'"
- [x] Avatar panel: Show the panel, Who stands there, Lip sync and expressions, Mini window (Open), Mini window on top — src/main.js PAGES.voice: "row('Mini window on top'"
- [x] Characters (2D and 3D): each AI with its file, its kind (None, 2D picture, Live2D, 3D (VRM)), Change…; Show all — src/main.js charactersBox: "All ${ids.length} AIs" … "data-a=\"chars-all\">Show all</button>"

## General (compact-A2)
- [x] Look (Style, Accent colour, Text size), Notifications, App updates, More (home server AI, Uncensored mode, Settings changes) — src/main.js: "grp('Look', [row('Style'" with Accent colour and Text size; App updates, Uncensored mode, Settings changes

## The character picker (compact-A9)
- [x] Title "<AI>'s character" with its round mark and ✕ — src/main.js characterModal: "<b>${esc(aiName(a))}'s character</b>" with the AI mark and ✕
- [x] None · 2D picture · Live2D · 3D (VRM), and "Ithil's body always comes from Hearth AI" — src/main.js: "${tab('none', 'None')}${tab('picture', '2D picture')}${tab('live2d', 'Live2D')}${tab('vrm', '3D (VRM)')}"
- [x] A live preview (breathing, blinking, talking with its voice) with Happy, Thinking, Talking — src/main.js: "Preview · breathing, blinks, talks with its voice" with char-mood Happy, Thinking, Talking
- [x] Starter characters: Ember fox, Robot pilot, Star twin, Wind sprite, Moss bear, Crystal — src/app/characters.mjs STARTERS: Ember fox, Robot pilot, Star twin, Wind sprite, Moss bear, Crystal
- [x] Your own picture (PNG, GIF, WebP); From your image maker (ComfyUI) — src/main.js: "From your image maker<small>ComfyUI on your PC</small>"
- [x] Live2D model folder Load…; 3D VRM file Load…; Move with its voice and mood (switch) — src/main.js: "Move with its voice and mood<span class=\"grow\"></span>${tog(c.motion !== false, 'char-motion')}"
- [x] "Files stay on this PC; nothing is sent to the AI"; Cancel and Use this character — src/main.js: "Files stay on this PC; nothing is sent to the AI" … "Use this character"
- [x] The character stands in the right panel and the mini window for that AI — src/main.js avatarStage: "characterOf(S.settings.characters, who)"

## The right panel (compact-A4)
- [x] ⟨ collapses it to a thin strip: the answering AI's face, read aloud, tools, Ithil; ⟨ opens it again — src/main.js railHtml: the thin strip with data-a="rp-collapse"
- [x] ▥ at the right of the headerbar (or Ctrl + .) hides it completely and brings it back — src/main.js: "ev.key === '.') { ev.preventDefault(); document.querySelector('[data-a=\"rp-hide\"]')?.click()"
- [x] Open, collapsed or hidden is remembered — src/main.js: "S.settings.panelState || 'open';   // 3.13 (compact-A4): open, collapsed or hidden; remembered"

# The Command Center in Nyarch Assistant's layout

Release: 3.12
Approved by the owner on 2026-11-14 ("nice nice, lets do it 3.12"). Ithil is drawn as Hearth's own character (no
other app's mascot, name or logo). Every part below is built exactly as shown before 3.12 is released:
`- [x] part — file: "proof"` once done.

## nyarch-1-talking-with-ithil.png
- [x] History sidebar: "History" title with a ☰ menu, chats with an emoji each, the open one highlighted — src/main.js: "<div class="hist-h"><b>History</b>"
- [x] Blue "＋ New Chat" button at the bottom of History — src/main.js: "<button class="newchat-big" data-a="new-chat">"
- [x] Headerbar: sidebar toggle, the answering AI's round avatar, a centred model button ("Ithil · her own mind (gen N)") with ⚙ — src/main.js: "<button class="model-pill" data-a="team-pop""
- [x] Yellow warning line under the headerbar (Ithil's hard limits in her chat) — src/main.js: "<div class="warnline">"
- [x] Rows separated by lines: "You:" in blue, the AI's name in its colour (Ithil yellow), right-aligned labels — src/main.js: "<div class="lbl" style="color:${esc(nameColor(m.who))}">"
- [x] Your message in a soft box; the AI's text plain — src/styles.css: ".uwrap.nrow > .msg-u"
- [x] "Thoughts · Expand to see details" box that opens — src/main.js: "<b>Thoughts</b><span class="d">Expand to see details</span>"
- [x] Tool boxes (name, what it did, "completed in N s") that open — src/styles.css: ".nrow .steps .step"
- [x] Pictures shown inline under a tool box — src/main.js: "${mediaHtml(m)}"
- [x] "⧉ Clear" and "↻ Regenerate" under the chat — src/main.js: "data-a="chat-clear""
- [x] Input bar: ⚙ and 📎 on the left, a tall rounded box "Send a message…", blue 🎙 and blue › buttons — src/main.js: "<button class="bluesq" data-a="send""
- [x] Right panel: full-body avatar standing at the bottom — src/main.js: "framing: 'full'"
- [x] Right panel top bar: 🔊, ◫ (panel), 👤, minimise and close buttons — src/main.js: "data-a="toggle-autoread" title="Read answers aloud""
- [x] Mood line under the avatar ("feels calm · awake") — src/main.js: "feels ${esc(st.mood || 'calm')}"

## nyarch-2-team-chat-panel.png
- [x] Model button reads "Team · <lead> leads · <repo> (<branch>)" in a team chat — src/main.js: "`Team · ${esc(aiName(t.lead))} leads${where}`"
- [x] Warning line for a team chat that changes files — src/main.js: "on its own branch. Nothing is merged or released without you."
- [x] Each AI's name label in its own colour (Claude, Ithil, ChatGPT, …) — src/main.js: "const NAME_COLORS"
- [x] Tool box with "working…" while an AI is busy — src/main.js: "'<div class="steps"><div class="step"><span class="faint">Starting…</span></div></div>'"
- [x] "■ Stop the team" next to Clear and Regenerate — src/main.js: "Stop the team</button>"
- [x] Input placeholder lists the team's @names — src/main.js: "`Send a message… (${team().members"
- [x] Right panel tabs: 📁 Files, ⌨ Terminal, 🌐 Browser, 🔀 Changes, 🌙 Ithil — src/main.js: "const RTABS = [['files'"
- [x] Files tab: path line and files with who touched them and when — src/main.js: "<div class="rt-path mono">"
- [x] A terminal view below the files ("Ithil's terminal") — src/main.js: "'Ithil\'s terminal'"
- [x] Right panel top bar: panel toggle, 🖥, ＋⌄, ▣, close — src/main.js: "data-a="rfiles-new""

## nyarch-3-mini-window.png
- [x] Small window with Ithil at the top, her state ("Ithil · awake · curious"), 🔊 and close — src/main.js: "<div class="mini-win"><div class="mini-av">"
- [x] The same labelled rows, Thoughts/tool boxes, Clear and Regenerate, and input bar — src/main.js: "data-a="mini-regen""
- [x] Opens with Super + I — electron/main.cjs: "globalShortcut.register('Super+I'"

## settings-1-ai-team.png
- [x] Settings dialog: 🔎, centred title, close; tabs with icons (AI team, Accounts, Ithil, Tools, Memory, Voice & avatar, General) — src/main.js: "const STABS = [['team', 'users', 'AI team'"
- [x] "Who's in your chats": all 18 AIs, each with its avatar, a line about it and a switch (or Sign in / Set up) — src/styles.css: ".set.dlg .tm-grid { display: flex !important"
- [x] Roles: Team lead, Reviewer, New messages start with (drop-downs) — src/main.js: "data-a="no-reviewer""
- [x] Several chats at once: how many at the same time, notify when a chat needs my answer — src/main.js: "data-a="max-chats""
- [x] Check the team: Test team (blue Run test), Tool test, What each AI can really do › — src/main.js: "${teamCheckBox()}"

## settings-2-accounts.png
- [x] Signed in with your account: Claude, ChatGPT, Gemini, Grok, Mistral, Qwen with their state — src/main.js: "['Signed in with your account'"
- [x] With a key: Perplexity, DeepSeek, Venice, Civitai (Change), Free AI (Add keys) — src/main.js: "['With a key', 'Keys are saved encrypted on this device.'"
- [x] Your own: Local AI, Your GPU server (Set up), Ithil — src/main.js: "['Your own', ''"
- [x] On the web: FreeBuff, Copilot, Meta AI (Sign in / signed in) — src/main.js: "['On the web (signed in in a window)'"
- [x] GitHub (account, Projects ›), Hearth devices (online/offline), ComfyUI server (address, Test), Your phone (switch) — src/main.js: "['accounts', 'key', 'Accounts', ['accounts', 'github', 'accounts2']]"

## settings-3-ithil.png
- [x] Now (state, mood, version) with Test connection; Host; Port; Key with Replace and Remove — src/main.js: "<b>Now</b><span class="d">"
- [x] With the team: In your team, Hand her tasks, Chat with Ithil (blue Open chat) — src/main.js: "<h3>With the team</h3>"
- [x] Her hard limits row with "always on" — src/main.js: "<h3>Her hard limits</h3>"
- [x] On Live: her Mesh station, next to your PCs on Cores — src/main.js: "<h3>On Live</h3>"

## settings-4-tools.png
- [x] Quick checks with a switch and ＋ Add — src/main.js: "grp('Quick checks the AIs may run on this PC'"
- [x] Skills with switches and Install a skill from a file — src/main.js: "row('Install a skill from a file…'"
- [x] Connectors (MCP) with switch and 🗑, ＋ Add — src/main.js: "grp('Connectors (MCP servers)'"
- [x] Let your AI use this desktop (switch) — src/main.js: "grp('Let your AI use this desktop'"
- [x] Permissions: Run commands, Change files outside the project, Push to GitHub (drop-downs), Live previews (switch) — src/main.js: "data-a="perm-run""

## settings-5-memory.png
- [x] Custom instructions text box — src/main.js: "grp('Custom instructions'"
- [x] Memory across chats: switch, See and edit, Forget… (red) — src/main.js: "tog(s.memoryOn !== false, 'memory-on')"
- [x] Scheduled tasks with switch and 🗑, ＋ New — src/main.js: "grp('Scheduled tasks'"
- [x] Saved data: Temporary copies (Clean up), Backups (Open folder), Old boards › — src/main.js: "grp('Saved data'"

## settings-6-voice-avatar.png
- [x] Voice: Read answers aloud, Voice, Each AI its own voice, Talk to the team — src/main.js: "row('Each AI its own voice'"
- [x] Avatar: Show the avatar panel, Who stands there, Ithil's body, Lip sync and expressions — src/main.js: "<h3>Avatar</h3>"
- [x] Mini window: Open the mini window (Super + I), Stay on top — src/main.js: "<h3>Mini window</h3>"

## settings-7-general.png
- [x] Look: Style, Accent colour, Text size — src/main.js: "data-a="accent-pick""
- [x] Notifications: needs my answer, task finishes, on my phone too — src/main.js: "'notify-phone'"
- [x] App updates: version with Check now; Install updates by themselves (AppImage and .deb) — src/main.js: "row('Install updates by themselves'"
- [x] Home server: AI chat on the home server — src/main.js: "row('AI chat on the home server'"
- [x] Uncensored mode (18+) switch (Ithil's limits still apply) — src/main.js: "grp('Uncensored mode (18+)'"
- [x] Settings changes › — src/main.js: "grp('Settings changes'"

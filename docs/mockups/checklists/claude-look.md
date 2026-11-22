# The Command Center in the Claude app's look, with everything from 3.x

Release: 3.14
Approved by the owner on 2026-11-21 ("Make the AI command center a 1 to 1 of the claude app", screens 1–5 "looks good",
screens 6–12 "yes all together" into 3.14). No Anthropic logo or name anywhere; open fonts (Lora for reading text and
headings, Inter for the rest). It's the default Style; anyone who picked Gold hologram, Dark or Classic keeps it.
`- [x] part — file: "proof"` once built. Screenshots are on the `ci/screenshots-out` branch (UI screenshots workflow).

Still open, and why:
- Images & Videos: "Edit a picture" and "Starred" are new features (the app can't edit a picture or star one yet); Open gallery too.
- Agent Desktop: Agent Desktop doesn't capture the screen today, so the real screen picture with the click marked needs a screen capture added.
- Habitat: the name · doing pills and journal / board / wave pills are drawn inside the world; "Workroom" waits for the owner to say which place it is.
- Accounts (12) and Images & Videos tiles: rebuilt after the last screenshots; ticked once the next ones match.

## claude-look-1-home-dark.png
- [x] Sidebar: "Command Center" in the serif at the top with the collapse button — src/main.js: "sideClaude" (screenshot 3.14-1-home-dark.png)
- [x] "+ New chat" first, in the accent colour with a round accent icon — src/main.js: "sideClaude" (screenshot 3.14-1-home-dark.png)
- [x] The places always shown in the sidebar (not behind a menu): Chats, Repos, Images & Videos, Live, Habitat, Reverse Engineering, Agent Desktop — src/main.js: "CLAUDE_PLACES" (screenshot 3.14-1-home-dark.png)
- [x] Starred and Recents groups; each chat's repo on its right in small mono; a dot for a chat that needs you — src/main.js: "sideClaude" (screenshot 3.14-1-home-dark.png)
- [x] Your account at the bottom (initial, name, the plans signed in) — src/main.js: "sideClaude" (screenshot 3.14-1-home-dark.png)
- [x] Top right: Team and the side panel buttons, nothing else on Home — src/main.js: "topbar: isClaude() && S.view === 'home'" (screenshot 3.14-1-home-dark.png)
- [x] Greeting "✻ Evening, Dragongamer9" (morning / afternoon / evening), serif, the ✻ in the accent — src/main.js: "homeClaude" (screenshot 3.14-1-home-dark.png)
- [x] The message box: big rounded box, the placeholder on top, a bottom row with +, tools, the repo pill, the team's cores with "Team: …" and ⌄, the mic, and an accent square send ↑ — src/main.js: "claudeRow" (screenshot 3.14-1-home-dark.png)
- [x] Quick-start chips under it (Fix a bug in a repo, Look at a sent log, Research something, Make a mockup, Analyse a spreadsheet, Prepare a release, Make a picture or video) — src/main.js: "homeClaude: QUICK + "Make a picture or video"" (screenshot 3.14-1-home-dark.png)
- [x] One quiet status line under the chips (who is ready, checks run in GitHub Actions) — src/main.js: "homeClaude" (screenshot 3.14-1-home-dark.png)

## claude-look-2-chat-repo.png
- [x] Top bar: the chat's title with ⌄ (its menu), the repo · branch pill, Team and panel on the right — src/main.js: "topbar" (screenshot 3.14-2-chat-repo.png)
- [x] Your message in a rounded bubble on the right with your initial — src/main.js: "message" (screenshot 3.14-9b-reverse-chat.png)
- [x] The AIs' answers without a box, in the serif reading font, with a small "name · role" line and their core above — src/styles.css: ".msg-a .text { font-family: var(--read) }" (screenshot 3.14-2-chat-repo.png)
- [x] Tool steps as one-line rounded rows ("✓ Edited file · +38 −3" with ⌄ to open) — src/styles.css: ".nrow .steps .step" (screenshot 3.14-2-chat-repo.png)
- [x] A code / artifact card (icon, name, kind) that opens in the side panel — src/main.js: "previewCard, Code tab in clPanelHtml" (screenshot 3.14-9b-reverse-chat.png)
- [x] Copy, 👍, 👎 and retry under an answer — src/main.js: "controlsHtml" (screenshot 3.14-2-chat-repo.png)
- [x] Approve & merge as an accent-bordered card: what's ready, checks, "nothing reaches main without you", Approve & merge / Look at the changes / Not yet — src/main.js: "clMergeCard" (screenshot 3.14-2-chat-repo.png)
- [x] The message box at the bottom (the same box as Home, "Reply to the team…") — src/main.js: "composer" (screenshot 3.14-2-chat-repo.png)
- [x] The side panel: title, Changes / Code / Preview tabs, the diff in mono with + and − lines coloured — src/main.js: "clPanelHtml" (screenshot 3.14-2-chat-repo.png)

## claude-look-3-light.png
- [x] The Claude app's light colours (warm off-white, cream sidebar, white message box, accent orange) — src/styles.css: "[data-design="claude"][data-mode="light"]" (screenshot 3.14-3-light.png)
- [x] A copyable command shown as a rounded mono row with "⧉ Copy" — src/app/rich.mjs: "⧉ Copy" (screenshot 3.14-3b-light-copy-and-working.png)
- [x] "Gemini is looking for …" with a small spinner while an AI is still working — src/main.js: "clWork, cl-spin" (screenshot 3.14-3c-working.png)

## claude-look-4-team-picker.png
- [x] The team picker opens from the message box's team button, like the Claude app's model menu — src/main.js: "teamPickClaude" (screenshot 3.14-4-team-picker.png)
- [x] "Who works on this chat": each AI with its core, name, role · plan, and an on/off switch (Claude, ChatGPT, Gemini, FreeBuff, Colibri on your PC) — src/main.js: "teamPickClaude, case 'team-off' (sessions._off)" (screenshot 3.14-4-team-picker.png, 3.14-4b-team-switch-off.png)
- [x] More AIs ›, Roles and who leads…, Just one AI, no team › — src/main.js: "teamPickClaude" (screenshot 3.14-4-team-picker.png)

## claude-look-5-settings.png
- [x] Settings as a page like the Claude app's: sections on the left (General, Appearance, Accounts, GitHub, Team, Voice, Memory, Images & Videos, Phone, Updates, Credits), one page on the right with a serif title — src/main.js: "settingsClaude, CTABS" (screenshot 3.14-5-settings-appearance.png)
- [x] Appearance: Colour mode (Light / Dark / Match Hearth), Style (Claude app / Gold hologram / Dark), Chat font (Serif / Sans / Dyslexic friendly), Text size, Send with Enter, cores in the message box, Updates with Check for updates — src/main.js: "lookClaudeRows" (screenshot 3.14-5-settings-appearance.png)
- [x] Rows with a bold label, a muted line under it, and the control on the right; segmented buttons and switches in the accent — src/styles.css: ".cl-set .srow .t2 b" (screenshot 3.14-5-settings-appearance.png)

## claude-look-6-studio.png
- [ ] Images & Videos: Picture / Video / Edit a picture tabs, the prompt in a message box (serif) with +, aspect, count, the maker and send
- [x] The line about making on your PC or online makers; the Queue as rounded rows with progress — src/app/studio.mjs: "cl-st-why, st-queue" (screenshot 3.14-6-studio.png)
- [ ] Results as rounded tiles with Save; All / Pictures / Videos / Starred and Open gallery
- [x] Top right: your PC's status (ComfyUI ready · the graphics card) — src/app/studio.mjs: "statusPill(st)" (screenshot 3.14-6-studio.png)

## claude-look-7-live.png
- [x] Live: every AI as a glowing core with its name (serif) and talking / listening / thinking / idle — src/main.js: "liveCalm" (screenshot 3.14-7-live.png)
- [x] What's being said in the reading font under the cores; the message box under that; "🎙 Talk to the team" on top — src/main.js: "liveCalm" (screenshot 3.14-7-live.png)

## claude-look-8-habitat.png
- [ ] Habitat's world unchanged; its room tabs (Great hall, King's chambers, Workroom) and 2D ⇄ 3D in the top bar
- [ ] The world in a rounded frame; each AI's name · what they're doing as a pill; Habitat journal, Board and Wave as pills

## claude-look-9-reverse-engineering.png
- [x] Reverse Engineering: each project as a card on top (name, file, size, state) — src/main.js: "reCards" (screenshot 3.14-9-reverse.png)
- [x] REA's chat in the same look (bubble, serif answer, tool step), the message box with the project's repo — src/main.js: "chatView: reCards(), "Ask about a game's files…"" (screenshot 3.14-9b-reverse-chat.png)

## claude-look-10-agent-desktop.png
- [ ] Agent Desktop: the screen it's using, framed, with where it'll click marked
- [x] Each action as an accent card "<AI> wants to …" with Allow / Allow for this task / Stop; done steps as ✓ rows — src/main.js: "deskView, cl-desk-ask, cl-desk-done" (screenshot 3.14-10-agent-desktop.png)

## claude-look-11-characters.png
- [x] Characters chats in the same look: the character's answer in the reading font with *actions* in italics — src/styles.css: ".rp .text, em" (screenshot 3.14-11-characters.png)
- [x] Swipes ‹ 2 / 3 › with retry and edit under the answer; your lines in the bubble — src/main.js: "rpMessage swipes (unchanged), bubble" (screenshot 3.14-11-characters.png)
- [x] Characters and Lorebooks in the top bar; the message box says "Write <name>'s scene…" and who plays them — src/main.js: "topbar c?.rp, "Write …'s scene…", claudeRow rpc" (screenshot 3.14-11-characters.png)

## claude-look-12-accounts.png
- [ ] Settings › Accounts: every AI and GitHub in one list with its core, name, plan or how it's signed in, and a button (Signed in / Re-check / Set up / Connected)
- [ ] More AIs… under the list

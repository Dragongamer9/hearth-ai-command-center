# The Command Center in the Claude app's look, with everything from 3.x

Release: 3.14
Approved by the owner on 2026-11-21 ("Make the AI command center a 1 to 1 of the claude app", screens 1–5 "looks good",
screens 6–12 "yes all together" into 3.14). No Anthropic logo or name anywhere; open fonts (Lora for reading text and
headings, Inter for the rest). It's the default Style; anyone who picked Gold hologram, Dark or Classic keeps it.
`- [x] part — file: "proof"` once built.

## claude-look-1-home-dark.png
- [ ] Sidebar: "Command Center" in the serif at the top with the collapse button
- [ ] "+ New chat" first, in the accent colour with a round accent icon
- [ ] The places always shown in the sidebar (not behind a menu): Chats, Repos, Images & Videos, Live, Habitat, Reverse Engineering, Agent Desktop
- [ ] Starred and Recents groups; each chat's repo on its right in small mono; a dot for a chat that needs you
- [ ] Your account at the bottom (initial, name, the plans signed in)
- [ ] Top right: Team and the side panel buttons, nothing else on Home
- [ ] Greeting "✻ Evening, Dragongamer9" (morning / afternoon / evening), serif, the ✻ in the accent
- [ ] The message box: big rounded box, the placeholder on top, a bottom row with +, tools, the repo pill, the team's cores with "Team: …" and ⌄, the mic, and an accent square send ↑
- [ ] Quick-start chips under it (Fix a bug in a repo, Look at a sent log, Research something, Make a mockup, Analyse a spreadsheet, Prepare a release, Make a picture or video)
- [ ] One quiet status line under the chips (who is ready, checks run in GitHub Actions)

## claude-look-2-chat-repo.png
- [ ] Top bar: the chat's title with ⌄ (its menu), the repo · branch pill, Team and panel on the right
- [ ] Your message in a rounded bubble on the right with your initial
- [ ] The AIs' answers without a box, in the serif reading font, with a small "name · role" line and their core above
- [ ] Tool steps as one-line rounded rows ("✓ Edited file · +38 −3" with ⌄ to open)
- [ ] A code / artifact card (icon, name, kind) that opens in the side panel
- [ ] Copy, 👍, 👎 and retry under an answer
- [ ] Approve & merge as an accent-bordered card: what's ready, checks, "nothing reaches main without you", Approve & merge / Look at the changes / Not yet
- [ ] The message box at the bottom (the same box as Home, "Reply to the team…")
- [ ] The side panel: title, Changes / Code / Preview tabs, the diff in mono with + and − lines coloured

## claude-look-3-light.png
- [ ] The Claude app's light colours (warm off-white, cream sidebar, white message box, accent orange)
- [ ] A copyable command shown as a rounded mono row with "⧉ Copy"
- [ ] "Gemini is looking for …" with a small spinner while an AI is still working

## claude-look-4-team-picker.png
- [ ] The team picker opens from the message box's team button, like the Claude app's model menu
- [ ] "Who works on this chat": each AI with its core, name, role · plan, and an on/off switch (Claude, ChatGPT, Gemini, FreeBuff, Colibri on your PC)
- [ ] More AIs ›, Roles and who leads…, Just one AI, no team ›

## claude-look-5-settings.png
- [ ] Settings as a page like the Claude app's: sections on the left (General, Appearance, Accounts, GitHub, Team, Voice, Memory, Images & Videos, Phone, Updates, Credits), one page on the right with a serif title
- [ ] Appearance: Colour mode (Light / Dark / Match Hearth), Style (Claude app / Gold hologram / Dark), Chat font (Serif / Sans / Dyslexic friendly), Text size, Send with Enter, cores in the message box, Updates with Check for updates
- [ ] Rows with a bold label, a muted line under it, and the control on the right; segmented buttons and switches in the accent

## claude-look-6-studio.png
- [ ] Images & Videos: Picture / Video / Edit a picture tabs, the prompt in a message box (serif) with +, aspect, count, the maker and send
- [ ] The line about making on your PC or online makers; the Queue as rounded rows with progress
- [ ] Results as rounded tiles with Save; All / Pictures / Videos / Starred and Open gallery
- [ ] Top right: your PC's status (ComfyUI ready · the graphics card)

## claude-look-7-live.png
- [ ] Live: every AI as a glowing core with its name (serif) and talking / listening / thinking / idle
- [ ] What's being said in the reading font under the cores; the message box under that; "🎙 Talk to the team" on top

## claude-look-8-habitat.png
- [ ] Habitat's world unchanged; its room tabs (Great hall, King's chambers, Workroom) and 2D ⇄ 3D in the top bar
- [ ] The world in a rounded frame; each AI's name · what they're doing as a pill; Habitat journal, Board and Wave as pills

## claude-look-9-reverse-engineering.png
- [ ] Reverse Engineering: each project as a card on top (name, file, size, state)
- [ ] REA's chat in the same look (bubble, serif answer, tool step), the message box with the project's repo

## claude-look-10-agent-desktop.png
- [ ] Agent Desktop: the screen it's using, framed, with where it'll click marked
- [ ] Each action as an accent card "<AI> wants to …" with Allow / Allow for this task / Stop; done steps as ✓ rows

## claude-look-11-characters.png
- [ ] Characters chats in the same look: the character's answer in the reading font with *actions* in italics
- [ ] Swipes ‹ 2 / 3 › with retry and edit under the answer; your lines in the bubble
- [ ] Characters and Lorebooks in the top bar; the message box says "Write <name>'s scene…" and who plays them

## claude-look-12-accounts.png
- [ ] Settings › Accounts: every AI and GitHub in one list with its core, name, plan or how it's signed in, and a button (Signed in / Re-check / Set up / Connected)
- [ ] More AIs… under the list

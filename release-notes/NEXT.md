# Next update (version number: yours to pick)

## The Habitat is back, in the sidebar
- A **Habitat** entry sits in the sidebar just above your chats. It opens the Habitat full width and shows the team of the chat you last opened. When an AI is working in that chat, you can see it typing at its desk.
- 2D and 3D both work. Your saved 3D choices (view, Lighter 3D, walk view, avatar, study) are kept exactly as they were.
- The AIs' Habitat lines still work, and they know when you're looking at the Habitat.

## Several chats at once
- Several chats can have their teams working at the same time. Switching chats never stops or blocks a chat that is working.
- Each chat keeps its own temporary copy, branch, AI sessions, steps, Stop button and waiting messages. Two chats on the same repo get separate copies and branches.
- In the sidebar, a busy chat shows a spinner and "replying…". A dot means there's a result you haven't seen yet.
- New setting under Settings › Notifications & voice: how many chats can work at once (3 unless you change it). Extra chats wait their turn and say so.

## Like the Claude app
- **Pictures and videos in chat.** Pictures and videos the AIs make show up inline. Click a picture to see it big. Each one has Download and "Save to repo". Files they make (reports, CSVs) appear as cards with Open and Save. A picture on the web loads only when you click it. Everything comes from the app's own media folder, and nothing outside that folder can be opened.
- **Rich answers.** Tables, highlighted code with a Copy button, maths, diagrams and simple charts. AI output is cleaned before it's shown, and diagrams draw in a sealed-off frame.
- **Message controls.** Copy, read aloud, Retry (keeps every version: ‹ 1/2 ›), and edit-and-resend on your own messages (your earlier version stays too). Stop works per chat.
- **Sources** appear under answers that used the web.
- **Follow-up buttons** appear under the newest answer.
- **Memory** (Settings › Memory): facts every AI reads in every chat. You can view, edit and delete them. An AI can only suggest one, and it's saved only if you say yes. Your custom instructions are on the same page.
- **Past chats.** AIs can look through your other chats when you ask (read-only).
- **Scheduled tasks** (Settings › Scheduled): later, every day or every week, while the app is running. Each run posts its result into its chat. Nothing runs until you create a task.
- **Connectors** (Settings › Connectors): tools (MCP servers) for Claude Code, Codex and the Gemini CLI. Tokens go only into the encrypted store.
- **Desktop notifications** when a reply is ready or an AI needs your answer, naming the chat. They're on unless you turn them off.
- **Read aloud** on any answer. Automatic reading is off unless you turn it on.
- **Export** a chat as Markdown, HTML or PDF (chat menu › Export), pictures included.
- **Per-chat instructions and reference files** (the "Instructions" button above a chat), like Projects in the Claude app.
- **Skills** from ~/.claude/skills and the repo's .claude/skills work in chats. They're listed in Settings › Tools.
- **Helpers.** The lead can hand side tasks to teammates. They work at the same time and report back in a fold-out step.
- **Temporary chat** (in the sidebar): nothing is saved, and it's gone when you end it.

## What the other AIs' apps can do
- **Pictures:** ChatGPT (OpenAI Images, which can also edit the newest picture), Gemini and Grok, each with your own API key (Settings › Accounts › Pictures, videos and documents).
- **Videos:** Sora (OpenAI) or Veo (Gemini API), only with your own key. Each video is billed to that account.
- **Canvas:** open any preview or code block in the Canvas tab, edit it, save versions, and ask the team to change it.
- **Data analysis:** attach a CSV. The AI analyses it on this PC and shows the charts in the chat.
- **Deep research** (composer › More): a long report with sources, also saved as a file.
- **Model picker per AI** (composer › More). It's kept with the chat, not in your settings.
- **Talk mode** (composer › More): what you say is sent straight away and answers are read aloud. This needs whisper.cpp for listening.
- **Perplexity** answers come with sources and its own follow-up questions.
- **PDFs:** text is read with pdftotext, or Mistral OCR with your Mistral key, so the AIs can answer questions about long documents. Gemini also gets attached videos.

## New teammates
- **Venice:** uncensored chat and pictures. Pictures use safe mode off, so Venice doesn't blur them. You can pick the text model and the picture model.
- **Civitai:** pictures, billed in Buzz, with mature content allowed. You pick the engine and its request fields.
- **Your own GPU server** (RunPod or any rented or local GPU): an OpenAI-style chat address, or a ComfyUI picture server, with an optional key. It only ever gets its own key.
- Each one joins once you add its key or address. Without one, it's skipped with "Add your … key".
- All three have hard limits in their instructions: never sexual content involving minors, never sexual images of real, identifiable people, nothing illegal. Their refusals are shown plainly.
- What they write and make is shown to you but **never passed to Claude, ChatGPT or Gemini**. Those AIs see "[image by Venice]" or "[content from Venice, not shown]" instead.
- **NovelAI isn't offered:** it has no public developer API, and its terms restrict third-party apps.

## Roleplay
- **Characters** (in the sidebar): a card library.
  - Import cards by dragging a PNG or JSON in. Character Card V1, V2 and V3 all work, including cards that have their lorebook inside.
  - Create, edit and export cards (PNG or JSON).
  - Start a chat straight from a card.
  - Set your persona: name, description and picture.
- **Lorebooks:** entries with keywords. When a keyword comes up in the last few messages, its entry is added to the characters' context, within a size limit. "Always on" entries are always added. Import and export the standard lorebook JSON, and attach lorebooks to a character or to a chat.
- **Roleplay chats with one character or a group.**
  - You pick which teammate plays each character: Venice for adult scenes, the others for regular stories.
  - In groups, either whoever is named answers, or everyone answers in order. "Reply as" makes a chosen character answer next.
  - Swipes (‹ 1/2 ›), edit, continue, regenerate, and Impersonate (the AI drafts your next line).
  - The character's greeting starts the chat, and its alternate greetings can be swiped.
- **Pictures** of a character or a scene through Venice, Civitai, your GPU server, ChatGPT, Gemini or Grok, made from the character's description.
- **Visual novel view:** the character's art over a scene, with the dialogue underneath.
- **A voice per character** for read aloud.
- **Built-in limits that can't be turned off:**
  - A card whose character reads as under 18 can't be used for sexual roleplay or sexual pictures. The app checks its age fields, words like child, minor, teen or underage in its text, and tags like loli or shota. An uncensored teammate can't play that character, and its pictures always go with the provider's safe mode on. The card still works for non-sexual stories.
  - A card marked as a real person can't be used for anything sexual.
  - Nothing illegal.
  - These limits are checked before anything is sent and again on the reply. A block shows a clear message.
- Adult roleplay lines and pictures are never passed to Claude, ChatGPT or Gemini.
- Everything here was written for this app from the open card formats. No code from other roleplay apps was used.

## Safety (unchanged)
- In-app updates for the AppImage and the .deb are untouched.
- Merging always asks you. AIs never pick version numbers, and commits are made only as you.
- New settings show their defaults and are saved only when you change one. Memory, schedules, connectors, servers, characters, lorebooks and the Habitat are each saved safely with a backup. A file that can't be read is never overwritten.

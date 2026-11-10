# Let your AI use this desktop

Settings › Connectors › **Let your AI use this desktop** gives Claude Code, Codex and Gemini a `desktop` connector. It's built on [Agent Desktop](https://github.com/vercel-labs/agent-desktop) (Apache-2.0), pinned to `agent-desktop@1.2.0` and started with npx. It's off until you turn it on.

- **Every action asks you first.** Clicking, typing, pressing keys, opening or closing apps, moving windows, the clipboard, screenshots and batches each show a card in the window. You can press **Allow**, **Allow for 10 minutes in this chat**, or **Don't allow**.
  - No answer in 2 minutes counts as a no, and so does a closed window.
  - "10 minutes" applies to that chat only, isn't saved, and ends when you turn the switch off or the app closes.
  - Looking doesn't ask: snapshot, find, get, is, the lists of apps, windows and surfaces, wait, and status.
- **How:** `electron/desktop-proxy.cjs` runs between the AI's CLI and `agent-desktop mcp`. A refused action never reaches Agent Desktop. The proxy asks the app over its own local approval server: 127.0.0.1 on a random port, with a token made fresh every time the app starts. That token only reaches a run through its environment, never through a file. The switch is saved in `desktop.json`, written in one step with a `.bak`, and never overwritten if it can't be read.
- **On Hearth's desktop (labwc, Wayland):** Agent Desktop works through each app's accessibility (AT-SPI). It can find buttons and fields, click them, type into them, and set, select and toggle values. Moving the pointer, pressing keys and moving windows aren't possible on Wayland outside GNOME yet. Those need a Hearth update (a labwc add-on).

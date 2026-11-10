# Reverse Engineering

The **Reverse Engineering** section in the sidebar looks inside programs with [REA](https://github.com/morluto/rea) (Reverse Engineer Anything, MIT) and your AI.

- **Projects:** press **New project** and pick a program: a Windows .exe or .dll, a Linux program, an Electron .asar, an Android .apk, a .jar, firmware or a capture. Each project gets its own chat. Its first message is put in your message box and is only sent when you press Send.
- **REA:** off until you press **Turn on**. While it's on, only the chats of your projects get it. Any other chat never does. It's started with `npx -y rea-agents@6.8.0 mcp`, a pinned version that's changed on purpose. REA's own `setup` is never run, so nothing is written into Claude Code's, Codex's or Gemini's own settings. The lead has to be Claude Code, Codex or Gemini, because REA works through them.
- **Needs:** Node.js 22.23.4 or newer (or 24.22.1+, 26.12.1+), with npx. For Windows and Linux programs it also needs **Ghidra** 12.1 or newer and JDK 21 or newer. Pick the Ghidra folder in the section; it's passed to REA as `GHIDRA_INSTALL_DIR`. A Ghidra found on PATH also works.
- **Saved** in `reverse.json`: on/off, your Ghidra folder and your projects. It's written in one step with a `.bak`, and never overwritten if it can't be read. Removing a project takes it off the list; its chat stays in Chats.
- **Use it only on software you own or are allowed to look at,** for things like compatibility and preservation. REA runs on this PC and only reads the program, but what it finds goes to the AI you chat with, under that AI's rules.

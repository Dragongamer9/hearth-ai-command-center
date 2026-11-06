### What's new in the next version

## Hearth devices: the AI all your Hearth machines share

The Command Center can now use the AI your Hearth OS devices share with each other, and it picks the best device for each job. Your Nvidia PC goes first: it does the big chats (Ollama) and the pictures (ComfyUI). When the PC is busy, gaming or off, the other devices take over. The ROG Ally does Kokoro voices or a small chat model, and the laptop does whisper speech to text.

- **Set it up in Settings › Accounts › Hearth devices:**
  - **Home server:** type its address (like `http://nvidia-pc:8189`). On Hearth OS, turn on **Let the Command Center find my devices here** in Settings › Home server › AI devices, then copy the **Command Center address** shown there.
  - **Test:** lists your devices and what each one shares.
  - **Order:** your Home server's order is used by default, which puts your Nvidia PC first. Use ↑ and ↓ to change the order. For each device you can also pick its chat model and its ComfyUI checkpoint.
  - **Skip a device while it's gaming** (on by default): a game keeps its GPU to itself.
  - **Skip handhelds on battery** (on by default): the Ally and the laptop are only used while plugged in.
  - **Share code** (only if your devices ask for one): it is saved encrypted on this PC, never in your settings.
- **Chat:** turn on **Hearth devices** in Settings › AI team. It answers on the first device in your order that's online and sharing, and tries the next one if that one fails or takes too long. Each answer says where it came from, like "Answered on nvidia-pc".
- **Voices:** **Hearth devices** shows up in Settings › Voice by itself, with the Kokoro voices your devices share. If one device can't speak, the next one does. If none can, your system voice on this PC is used.
- **Speech to text:** on **Automatic**, a device's whisper is used first when one is shared. If it can't, the app falls back to whisper.cpp on this PC, then OpenAI, as before.
- **Pictures:** pick **Hearth devices** as the picture maker. It uses ComfyUI on the best device. The same hard limits as always still apply.
- **Safe by design:**
  - The app only follows addresses on the Home server itself, your Tailscale addresses, or device names you allowed.
  - It never follows a redirect.
  - Every request has a time limit and a size cap, and anything a device sends back is checked before it's used.
- **Your machines, your rules:** chats with Venice, Civitai, your GPU server or Hearth devices may use your own devices. Their text still never goes to OpenAI unless you allowed it.

## Characters chat: Generate scene

Characters chats already had a **Picture** button (a portrait or a scene from Venice, Civitai, your GPU server or an OpenAI, Gemini or xAI key). There's now also **Generate scene**, which makes a ComfyUI picture of the current moment.

- **The prompt is built from the character cards and the last few messages, and you see it first.** Change anything you like, then press Generate.
- **The picture shows up in the chat and is saved with that chat.** It's included when you export the chat, and it goes away when you delete the chat.
- **Characters keep their look between pictures.** Each character can have a saved **appearance** and a **seed**, with **Keep the same seed** on by default. Change them with **Save look** or **Re-roll seed**. Nothing changes unless you press one of these. The look is kept with the character in this app and is never written into exported card files.
- **Where it's made:** your **ComfyUI server** (new in Settings › Accounts: type its address, press **Load models** and pick a default model), your GPU servers set up as ComfyUI, or Hearth devices.
- **Clear errors** when ComfyUI is off, has no model, the address is wrong, or it answers with a redirect.
- **Hard limits, checked before anything is sent:**
  - A sexual scene is only made when every character in it is clearly an adult.
  - It's refused for any character who reads as under 18. Confirming a character's adult age still only clears false alarms, as before.
  - It's also refused when a character's age isn't clear.
  - Never a real person's likeness.
  - The picture is always told to leave out minors (and, for a character who reads as under 18, to leave out anything sexual).
- **A GPU server error is clearer:** if your GPU server has no ComfyUI entry, the message now lists the servers you saved and their types.

AppImage: update from inside the app (Settings → App updates → Check for updates).

.deb installs update from inside the app too (asks for your computer password once per update).

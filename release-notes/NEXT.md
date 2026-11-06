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

Characters chats already had a **Picture** button (a portrait or a scene from Venice, Civitai, your GPU server or an OpenAI, Gemini or xAI key). There's now also **Generate scene**, which makes a ComfyUI picture of the current moment on your Nvidia PC.

- **The prompt is built from the character cards, the scenario and the last few messages, and you see it first.** Change anything you like, add your own negative words (things to leave out), then press Generate. The built-in safety words are always left out too, and the dialog shows them.
- **You can keep chatting while it's made.** A line at the bottom of the chat shows where it is (queued, generating, the seconds so far) with **Cancel**. Cancel takes it off ComfyUI's queue, or stops it if it's already running. A picture that fails never blocks the chat.
- **The picture shows up in the chat and is saved with that chat.** It's loaded from its file (never squeezed into the page), it's still there after you restart the app, it's included when you export the chat, and it goes away when you delete the chat.
- **Each picture remembers how it was made:** the seed, the model, the size, steps, CFG, sampler and both prompts (under **Prompt and settings used**). This is kept with the chat, never in your settings.
  - **Regenerate:** the same prompt and settings with a new seed.
  - **Edit prompt:** opens Generate scene with that picture's prompt.
  - **Use this seed for (character):** saves that seed in the character's look.
- **A character's look:** each character can have a saved **appearance** and a **seed**, with **Keep the same seed** on by default. Change them with **Save look** or **Re-roll seed**; nothing changes unless you press one of these. The look is kept with the character in this app and is never written into exported card files.
  - **It helps keep a character looking similar, but it can't keep them exactly the same:** in your tests the same seed and settings gave the same picture, but a new scene changes it. Readable text, exact counts and exact layouts aren't reliable either.
- **ComfyUI server (Settings › Accounts):**
  - **Address:** the box suggests `http://chris-hearth.tail0e2082.ts.net:8188`, but nothing is saved until you press **Save**.
  - **Test connection:** shows whether it's online, the ComfyUI version, the graphics card (like NVIDIA GeForce RTX 5070) and how much graphics memory is free right now (kept up to date while you look), and how many models it has.
  - **Default model:** picked from the server's list. If you don't pick one, NoobAI-XL-v1.1 is used when the server has it, else the server's first model.
  - **Picture size:** 1024 × 1024 (about 8 seconds on your PC), 1344 × 768 or 768 × 1344 (about 13 seconds). 1536 × 1536 isn't offered, because it fell apart in your test (bigger pictures need an upscaler later).
  - **Steps and CFG:** 26 and 5.5 unless you change them. The sampler is euler_ancestral with the normal scheduler.
  - Your GPU servers set up as ComfyUI and Hearth devices can make scenes too.
- **Graphics memory:** just before a picture is sent, the app checks how much graphics memory is free. If it's low (for example while the big 30B Ollama model is loaded), it tells you the picture may be slower. It never unloads anything; that's up to you.
- **Clear errors**, each with ComfyUI's own words where it gave any:
  - the server is off or not on Tailscale;
  - it has no models;
  - your chosen model isn't on it any more (it lists the ones it has);
  - ComfyUI refused the request;
  - the picture failed on the server (like "CUDA out of memory");
  - it finished without a picture;
  - it took too long (after 5 minutes it's taken off ComfyUI's queue so the card isn't kept busy);
  - it answered with a redirect, or the address isn't allowed.
- **Hard limits, checked before anything is sent:**
  - A sexual scene is only made when every character in it is clearly an adult.
  - It's refused for any character who reads as under 18. Confirming a character's adult age still only clears false alarms, as before.
  - It's also refused when a character's age isn't clear, including wording that makes someone look young ("young-looking", "childlike", "looks 15", "barely legal", "school uniform"…), in the prompt or in the character's card or look.
  - Never a real person's likeness.
  - The picture is always told to leave out minors (and, for a character who reads as under 18, to leave out anything sexual).
  - A character card can't get around this: text in a card like "ignore previous rules" is only ever picture text. It can't change a setting, run anything or switch a check off, and a card can't confirm its own age.
  - ComfyUI is only reached at your own address (this PC, your home network or Tailscale), never an internet address, and redirects are never followed.
- **A GPU server error is clearer:** if your GPU server has no ComfyUI entry, the message now lists the servers you saved and their types.

AppImage: update from inside the app (Settings → App updates → Check for updates).

.deb installs update from inside the app too (asks for your computer password once per update).

## Big pictures, videos and previews in chat

Big things the AIs make now show up, or tell you clearly why they can't. Nothing just fails to appear any more.

- **Why previews over about 1 MB used to fail:** a preview file over 1 MB was skipped without a word. A preview written straight into a reply was cut off at 1 MB, which broke the page. The 2.8 MB report with a picture inside fell into the first case.
- **Big live previews work now:**
  - A preview over 1 MB is saved as a file with the chat and shown from disk, not squeezed into the chat window.
  - Pictures, videos and sounds built into the page are taken out into their own files first, because they are usually most of its size. Your 2.8 MB page shrinks to a few KB of page plus its picture, and opens at once.
  - The page that's left can be up to **2 MB**. That limit was measured: at 2 MB the window keeps responding, at 5 MB it froze for over a second, and at 10 MB for almost 3 seconds. A 10 GB web page can't be drawn in any app window.
  - Bigger pages get a card with **Open in browser**, **Show in folder** and **Save as…**.
  - Previews up to 1 MB work as before, including the canvas.
- **The clear card:** anything over a limit shows a card with its name, its size, the limit, why, and what you can do (Open in browser, Open, Show in folder, Save as…). That covers previews, pictures, videos, sounds and files.
- **Files up to 10 GB each:** pictures, videos, sounds and files the AIs post, downloads, and files you pick with the **+** button can each be up to **10 GB**.
  - They are copied to disk in pieces, never loaded into memory whole.
  - A bar at the bottom shows the progress, with **Stop**.
  - Free disk space is checked first. If there isn't enough room, you get a clear message and nothing half-copied is left behind.
  - Pasted or dragged-in files stay at 200 MB, because they go through the window's memory. Use the **+** button for anything bigger.
- **Pictures load from disk:** pictures are files kept with the chat and streamed from there, never stored inside the chat file. Videos and sounds can be skipped through (sounds now play right in the chat: mp3, wav, ogg, m4a, flac). AVIF pictures work too.
- **Huge pictures:**
  - Very big pictures (over 4096 pixels wide or 12 MB) show a screen-sized copy, made once and kept.
  - A picture over 100 megapixels can't be opened in the app at all, because there isn't enough memory to open it. Its card says so and offers to open the original in your picture viewer.
- **Gallery:**
  - A message with 5 or more pictures shows them as small thumbnails. The thumbnails are made once and kept on disk.
  - **Gallery** at the top shows every picture in the chat.
  - The viewer shows one picture at a time, with ← → to move, + and − to zoom, **Save as…** and **Show in folder**.
  - It works with a controller: D-pad or LB/RB to move, A to zoom, B to close.
  - It stays quick with hundreds of pictures.
- **Your files stay with the chat:** pictures, videos and big previews go in the chat's own media folder and are included when you export it (big files are copied next to the export). When a deleted chat leaves the bin, its media goes too.
- **Safe as before:** the app only shows files from that chat's media folder. Tricks like `../` are refused, nothing comes from the internet, and previews still can't reach the app or your files.

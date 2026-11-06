### What's new

## Find in the character editor

Press **Ctrl+F** while editing a character, or the **Find** button at the top, to search the whole card: name, description, personality, scenario, first message, alternate greetings, example dialogue, system prompt, post-history instructions, creator notes, appearance and tags.

- **How many matches, and where:** it shows the number of matches for each field with a short piece of the text around each one, the word highlighted, and it marks the fields that have matches.
- **Next and previous:** Enter and Shift+Enter in the Find box, or F3 and Shift+F3. Each one scrolls to the field and selects the match in it. Right after a jump, Enter goes on to the next match. Escape takes you back to the Find box, and Escape there closes it.
- **Options:** Match case and Whole word.
- **Replace and Replace all:** these change only the card you're editing, and only in the editor. Nothing is saved until you press **Save**, and Cancel throws it all away as before. Ctrl+Z undoes a replace in a field.
- **The editor now also shows the system prompt, the post-history instructions and the character's appearance.** The appearance is the one Generate scene uses, and it's saved when you press Save.
- **Works with a controller or the keyboard:** every part of the Find box is a normal button or box you can move to.

**Search on the Characters page:** the search box now looks through names, tags and description text across all your cards. It says how many match and where each one matched.

## Collections: remove a card from a collection

You can now group characters into **collections** (the row above the cards: **All characters**, your collections, then **New collection**). To put a card in one, use **Add to collection…** on the card in All characters.

- **Remove from collection:** open a collection and press **Remove from collection** on a card, or select it and press the Delete key.
- **Remove several at once:** tick the cards (or **Select all**) and press **Remove selected from collection**.
- **Undo:** the message that appears after a removal has an **Undo** button, which puts the cards back where they were.
- **Only that collection changes.** The card stays in All characters and in any other collection, and its chats aren't touched. Collections are saved like your characters: the file is replaced in one step, a backup is kept, and a damaged file is never written over.

## Set age (18+) and why a card is flagged

- **Set age (18+)** in the character editor: type an age from 18 to 999. It's saved when you press **Save** and kept in this app only, never in exported card files. An adult age clears **soft** flags, the same way confirming an adult age did before. Leave it empty to remove it.
- **Why it's flagged:** the editor now lists every reason a card reads as under 18, with the field and the exact words. Each one is marked:
  - **hard:** the card itself says the character is a minor. That means an age field under 18, a minor tag, or words like loli, shota or underage. A childlike body also blocks sexual pictures. **Hard flags can never be cleared:** no age, confirmation or setting changes them, and the character stays stories only.
  - **soft:** a word or age somewhere in the text that might be about someone else or the past. Setting an adult age clears these.
- **Jump to the text:** click a reason to open Find on those words in that field.
- **Everywhere else too:** the badge on the Characters page says hard or soft and links to the editor. A refused roleplay message, picture or scene now says which field and words caused it, and whether it can be cleared.
- **Fewer false alarms, with the same hard limits:**
  - ages written as words now count properly. "nineteen years old" is an adult, and "sixteen years old" is still flagged;
  - "young" in adult phrases ("young queen", "young woman", "young elf queen", "young adult") doesn't flag;
  - "teen" only counts as a whole word;
  - "school" on its own doesn't flag; only school-age phrases like "middle schooler" do;
  - the years of a thing or a place ("a 12 year old sword", "her 15-year reign") aren't a person's age.

  Real minors are still caught: an age field under 18, "16 years old", "middle schooler", a childlike body. The hard limits (loli, lolicon, shota, shotacon, jailbait, preteen, underage, "under 18", an age under 18, childlike bodies, real people) are exactly as before and can't be switched off.

## Fixes

- **The Generate scene button is always on screen.** On smaller screens (and on your 1920×1080 laptop with Hearth OS Mantel) a tall dialog pushed **Generate** and **Cancel** off the bottom. Every dialog now scrolls inside itself, and its buttons stay visible along the bottom. This is checked at 1280×720 and 1280×800 (handheld sizes) too.
- **Better Generate scene prompts.** Some cards' roleplay instructions and backstory ended up in the prompt, for example "Never speak or act for Chris…", "Her mother died…", or a whole line of dialogue. Now:
  - The prompt uses the character's saved **Appearance** first.
  - Without one, it only takes the parts of the card that describe how the character looks. Roleplay instructions, bracketed instruction blocks, lines written to the AI, backstory and quoted speech are left out.
  - The scene part is a short summary of what's happening in the last messages (actions and place only). It has no dialogue and never uses your persona's name.
  - The prompt is kept short (about 400 characters plus the style words).
  - When a character has no saved appearance, the dialog says "Add her look in Appearance for better pictures".
  - The older **Picture** button uses the same cleaned-up looks.
- **Pictures on your GPU server work again.** The **Picture** button with **Your GPU server**, and GPU server pictures in normal chats, failed with "Prompt outputs failed validation". The app asked for a model the server didn't have. Now it checks the server's model list first:
  - your saved model is used if the server has it;
  - with no model saved, it uses NoobAI-XL-v1.1 if the server has it, else the server's first model;
  - if your saved model isn't on the server, the message says so and lists the models it does have.

  When ComfyUI refuses a picture, its own reason is now shown plainly (for example "node 4 (CheckpointLoaderSimple): Value not in list"). Redirects are never followed.

AppImage: update from inside the app (Settings → App updates → Check for updates).

.deb installs update from inside the app too (asks for your computer password once per update).

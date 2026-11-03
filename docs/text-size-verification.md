# Text size verification

Checked 2026-11-03 using the production Vite build in Electron 45, in an isolated headless window with sample task/chat data and a mock IPC bridge. No owner app settings or credentials were used.

At a 1440 × 1000 window, captured Team chat, Task board, and Settings at 100% and 150%. At 150% the CSS viewport is 960 pixels wide; document width stayed 960 in each view. Chat messages wrap and the composer remains accessible. Board columns use the horizontal scrollbar. Settings labels and help text wrap. Removed the text selector's left margin to keep the full-width control inside its card.

Screenshots are in `.hearth-ai/assets/openai/{chat,board,settings}-{100,150}.png` (uncommitted assets). The preview harness and output log are beside them.

The real renderer shortcut handler passed reset → 115 → 130 → 150 → upper bound → 130 → reset, with the expected Electron zoom factor after each press. This preview does not exercise disk persistence; source guards cover validation, settings persistence, and startup restoration.

Validation:

- `npm run build:web`: passed.
- `npm run check`: passed.
- `node --test test/settings-guards.test.mjs`: 7/7 passed.
- `node --test test/*.test.*`: 183/185 passed. Existing failures concern shared-workspace commit email and Gemini sign-out.
- `npm test`: Node 20 treats its quoted glob literally; used shell expansion for the full suite above.

Habitat does not exist in this checkout, so its requested visual check remains unavailable. Full-suite failures remain outside this task's scope.

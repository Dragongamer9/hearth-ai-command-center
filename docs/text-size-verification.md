# Text size verification

Checked 2026-11-03 using the production Vite build in Electron 45, in an isolated headless window with sample task/chat data and a mock IPC bridge. No owner app settings or credentials were used.

At a 1440 × 1000 window, captured Team chat, Task board, Settings, and Habitat at 100% and 150%. At 150% the CSS viewport is 960 pixels wide; document width stayed 960 in each view. Chat messages wrap and the composer remains accessible. Board columns use the horizontal scrollbar. Settings labels and help text wrap. Removed the text selector's left margin to keep the full-width control inside its card.

Screenshots are in `.hearth-ai/assets/openai/{chat,board,settings,habitat}-{100,150}.png` (uncommitted assets). The preview harness and output log are beside them.

The real renderer shortcut handler passed reset → 115 → 130 → 150 → upper bound → 130 → reset, with the expected Electron zoom factor after each press. This preview does not exercise disk persistence; source guards cover validation, settings persistence, and startup restoration.

Validation:

- `npm run build:web`: passed.
- `npm run check`: passed.
- `node --test test/settings-guards.test.mjs`: 9/9 passed. Runtime tests execute the real settings handler and renderer-load callback with an in-memory settings store: all four sizes apply, unrelated edits preserve 150%, invalid values leave the saved choice unchanged, and renderer recovery restores 150%. Rapid changes serialize and respect bounds; a failed save restores the dropdown to the saved choice, and subsequent changes still work. This does not exercise disk I/O.
- `node --test test/*.test.*`: 305/305 passed after the shared test fixes were merged. Full output: `.hearth-ai/assets/openai/test-results.txt`.
- `npm test`: removed the quotes around the test glob so the shell expands it on Node 20 as well. This fixes the Command Center test gate, which previously failed before running any tests.

Command Center gate recheck: `npm test` passes all 305 tests on Node 20.19.2. The installer missing-tool fixture now explicitly simulates an absent Grok binary, because discovery also checks system directories and npm's prefix even with a restricted PATH. Production behavior is unchanged. `npm run check`, `npm run build:web`, and `git diff --check` also pass.

After the main-branch merge, refreshed all eight screenshots against the current build. Habitat renders at both sizes with its canvas contained inside the view and its instructions wrapping at 150%. The isolated preview dismisses the owner-identity onboarding dialog using Later; it does not confirm or alter an identity. Refreshed the screenshots again after the shared test fixes merged; all four views retain their contents at 150%, with vertical scrolling for the chat composer and horizontal scrolling for board columns. The complete shortcut sequence passed again. No outstanding test failures remain.

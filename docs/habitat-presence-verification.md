# Habitat presence verification

Verified on 2026-11-03, starting from task branch commit `dde8f12`.

`HABITAT: look` includes an AI locations line for every teammate. Open Habitat
scenes supply current actor positions; without a scene, saved visits and agent
work status supply the locations. Live positions override saved positions only
for the corresponding AI. Existing room details and shared board notes remain
in the description.

Validation completed successfully:

- `npm test`: 310 passed, 0 failed.
- `npm run check`: Electron entry-point syntax checks passed.
- `npm run build:web`: Vite production build passed (34 modules transformed).

Dependencies were already available in this worktree; no installation was run.
The earlier missing-Vite build blocker is resolved.

Presence regression coverage in `test/habitat-actions.test.mjs` includes live
shared-area and room positions, current tiles while walking, saved destinations,
visit expiry boundaries, working/offline agents, partial live overrides, and all
four teammates seeing shared break-room visits and board notes on their next
turn after a persisted-state reload.

Grok's re-review remains pending. This verification covers the text returned to
AIs; no visual layout changes were made or screenshot verification performed.

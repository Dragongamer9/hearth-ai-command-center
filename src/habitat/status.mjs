// Passive Habitat status (pure, unit tested): where each AI is in the Habitat and what it
// is doing, plus the latest hall board notes, so nobody needs a `HABITAT: look` round trip.
import { migrateStore, cleanText } from './life.mjs';

const RECENT = 2 * 3600e3;
const PLACE_OF = [[/went to the (desk|room|break room|garden|hall)/i, (m) => m[1].toLowerCase()], [/had coffee with|joined .* for coffee/i, () => 'break room'], [/watered the garden/i, () => 'garden']];

// agent: one entry of the Habitat snapshot ({ id, status, task, reviewing, typing, waiting }).
export function whereIs(store, agent, now = Date.now()) {
  const s = migrateStore(store);
  if (agent.task) return { place: 'desk', activity: `working on T-${agent.task.id}` };
  if (agent.reviewing) return { place: 'desk', activity: `reviewing T-${agent.reviewing.id}` };
  const act = agent.typing ? 'typing in Team chat' : agent.waiting ? 'waiting for a permission answer' : agent.status === 'out' ? 'out of usage' : agent.status === 'hold' ? 'needs sign-in' : agent.status === 'signedout' ? 'signed out' : 'idle';
  if (agent.status === 'signedout') return { place: 'room', activity: act };
  for (const e of [...(s.journal[agent.id] || [])].reverse()) {
    if (now - Date.parse(e.at) > RECENT) break;
    for (const [re, f] of PLACE_OF) { const m = String(e.text).match(re); if (m) return { place: f(m) === 'desk' ? 'desk' : f(m), activity: act }; }
  }
  return { place: 'room', activity: act };
}

export function boardNotes(store, names = {}, n = 3) {
  const s = migrateStore(store);
  return Object.entries(s.board || {}).map(([id, b]) => ({ id, who: names[id] || id, text: cleanText(b.text, 120), at: b.at })).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, n);
}

export function teamHabitat(store, agents = [], names = {}, now = Date.now()) {
  return { rows: agents.map((a) => ({ id: a.id, name: names[a.id] || a.name || a.id, ...whereIs(store, a, now) })), board: boardNotes(store, names) };
}

const PLACE_TEXT = { desk: 'at the desk', room: 'in its room', 'break room': 'in the break room', garden: 'in the garden', hall: 'in the hall' };
// One line for the prompts, next to the AI's own Habitat memory.
export function teamHabitatLine(store, agents = [], names = {}, now = Date.now(), max = 360) {
  const t = teamHabitat(store, agents, names, now);
  if (!t.rows.length) return '';
  const who = t.rows.map((r) => `${r.name} ${PLACE_TEXT[r.place] || r.place} (${r.activity})`).join('; ');
  const board = t.board.length ? ` Hall board: ${t.board.map((b) => `${b.who}: '${cleanText(b.text, 50)}'`).join('; ')}.` : '';
  const line = `Team in the Habitat now: ${who}.${board}`;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

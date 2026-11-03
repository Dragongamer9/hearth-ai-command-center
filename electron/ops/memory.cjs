// Project memory: .hearth-ai/PROJECT.md in the project folder. Every AI reads it at the
// start of each run (it is put in front of the prompt). AIs never edit it; the lead may
// propose a change with a MEMORY: line, which the owner approves or denies.
const MEMORY_REL = '.hearth-ai/PROJECT.md';
const MAX_CHARS = 8000;

const RULES = [
  '- Commits only as Dragongamer9 <Dragongamer9@users.noreply.github.com>. No Co-authored-by, Claude-Session or "Generated with" lines, no AI author.',
  '- Releases and version numbers are the owner\'s. Never pick, bump or apply a version number. Releases and tags only for the owner\'s Next version, and only with the owner\'s lead switches on.',
  '- Settings must be remembered and must never change by themselves.',
  '- Nothing reaches main without the owner\'s approval.',
];

function seed({ name = 'this project', layout = [], decisions = [], at = new Date().toISOString() } = {}) {
  return [
    `# ${name}: project memory`,
    '',
    'Every AI in the Hearth AI Command Center reads this file at the start of each run.',
    'AIs do not edit it. The lead may propose a change with a line `MEMORY: <text>`; the owner approves it.',
    '',
    '## The owner\'s rules',
    ...RULES,
    '',
    '## Repo layout',
    ...(layout.length ? layout.slice(0, 40).map((l) => `- ${l}`) : ['- (not read yet)']),
    '',
    '## Decisions so far',
    ...(decisions.length ? decisions.slice(0, 30).map((d) => `- ${d}`) : ['- (none recorded yet)']),
    '',
    `_Created ${at.slice(0, 10)}._`,
    '',
  ].join('\n');
}

function withMemory(prompt, text) {
  const t = String(text || '').trim();
  if (!t) return prompt;
  const body = t.length > MAX_CHARS ? `${t.slice(0, MAX_CHARS)}\n…[trimmed]` : t;
  return `PROJECT MEMORY (${MEMORY_REL}, kept by the owner; follow it and do not edit it):\n${body}\n\n---\n\n${prompt}`;
}

// The owner approved a proposal: add it under "Approved additions".
function applyProposal(text, proposal, at = new Date().toISOString()) {
  const line = `- ${String(proposal).replace(/[\r\n]+/g, ' ').trim().slice(0, 1000)} _(approved ${at.slice(0, 10)})_`;
  const s = String(text || '').replace(/\s+$/, '');
  if (/\n## Approved additions\n/.test(`${s}\n`)) return `${s}\n${line}\n`;
  return `${s}\n\n## Approved additions\n${line}\n`;
}

module.exports = { MEMORY_REL, MAX_CHARS, RULES, seed, withMemory, applyProposal };

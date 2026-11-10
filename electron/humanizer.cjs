// "Make it sound human": rewrites a reply or a draft with blader/humanizer's instructions
// (electron/humanizer/SKILL.md, MIT, bundled unchanged; see SOURCE.txt). Nothing is downloaded.
// The text goes only to the AI the owner picks in the window; the window keeps what an
// uncensored teammate wrote away from Claude, ChatGPT and Gemini.
const fs = require('node:fs');
const path = require('node:path');

const MAX = 20000;
let cached = null;
function skill() {
  if (cached == null) cached = fs.readFileSync(path.join(__dirname, 'humanizer', 'SKILL.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  return cached;
}

function prompt(text) {
  const t = String(text || '').slice(0, MAX);
  return `${skill()}\n\n---\n\nEmbedded mode: rewrite the text between <text> and </text> using the instructions above. Return only the final rewritten text: no draft, no list of patterns, no notes, no tags. Keep code blocks, commands, paths and links exactly as they are.\n\n<text>\n${t}\n</text>`;
}

// What came back, without the wrappers a model sometimes adds.
function clean(out) {
  let s = String(out || '').trim();
  s = s.replace(/^<text>\s*/i, '').replace(/\s*<\/text>$/i, '');
  s = s.replace(/^(?:here(?:'s| is) the (?:final )?(?:rewritten )?(?:text|version|rewrite)[^\n]*:\s*\n)/i, '');
  return s.trim();
}

// callApi(agent, model, prompt, signal) is the app's own API path (electron/main.cjs).
async function humanize({ text, agent, callApi, signal }) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, message: 'There is no text to rewrite.' };
  if (t.length > MAX) return { ok: false, message: `That text is too long to rewrite in one go (over ${MAX.toLocaleString('en-US')} characters).` };
  const r = await callApi(agent, null, prompt(t), signal);
  if (!r?.ok) return { ok: false, message: r?.error?.message || r?.message || 'The rewrite didn\'t come back.' };
  const out = clean(r.text);
  if (!out) return { ok: false, message: 'The AI answered with nothing.' };
  return { ok: true, text: out, via: r.via || '' };
}

module.exports = { humanize, prompt, clean, skill, MAX };

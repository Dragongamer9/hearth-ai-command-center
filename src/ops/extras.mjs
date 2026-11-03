// Smaller team requests, pure and unit tested: Local AI model presets and fit checks,
// @mentions with aliases, capability facts, progress lines, attachment size checks,
// IMAGE REQUEST lines, checkpoint reports and action-line results.
import { AGENTS, AGENT_IDS } from '../registry.mjs';

// ---------- Local AI (Ollama) ----------
// Tags as published on ollama.com/library. Download size at the default Q4 quantization:
// 3B ~2 GB, 7-8B ~5 GB, 14B ~9 GB, 32B ~20 GB, 70B ~40 GB. Loaded, a model needs ~1.2x that.
const SIZE = { 3: 2, 7: 5, 8: 5, 14: 9, 32: 20, 70: 40 };
const P = (family, params, note = '') => ({ tag: `${family}:${params}b`, label: `${family} ${params}B`, note, params, sizeGb: SIZE[params] });
export const LOCAL_PRESETS = [
  P('qwen2.5-coder', 3, 'current, fastest'), P('qwen2.5-coder', 7), P('qwen2.5-coder', 14), P('qwen2.5-coder', 32),
  P('llama3.1', 8), P('llama3.1', 70),
  P('deepseek-r1', 7), P('deepseek-r1', 8), P('deepseek-r1', 14), P('deepseek-r1', 32), P('deepseek-r1', 70),
];
export const TAG_RE = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)?(:[A-Za-z0-9._-]+)?$/;
export const validTag = (t) => typeof t === 'string' && t.length <= 100 && TAG_RE.test(t);
export const FIT_LABEL = { 'fits-gpu': 'fits on the graphics card', 'fits-split': 'fits using graphics card + RAM', 'fits-ram': 'fits in RAM (no graphics card, slower)', tight: 'tight', 'too-big': 'too big for this computer', unknown: 'size unknown' };
const HEADROOM_GB = 4;

// Against this computer: a warning label, never a block. Integrated or shared-memory GPUs
// (discrete: false) count RAM only.
export function fitCheck(preset, { ramGb = null, vramGb = null, discrete = false } = {}) {
  const size = preset?.sizeGb ?? (SIZE[paramsOf(preset?.tag)] || null);
  if (!size || !ramGb) return { fit: 'unknown', label: FIT_LABEL.unknown, needGb: size ? Math.round(size * 12) / 10 : null };
  const need = Math.round(size * 1.2 * 10) / 10;
  const v = discrete && vramGb ? vramGb : 0;
  let fit;
  if (v && need <= v) fit = 'fits-gpu';
  else if (need <= v + ramGb - HEADROOM_GB) fit = v ? 'fits-split' : 'fits-ram';
  else if (need <= v + ramGb) fit = 'tight';
  else fit = 'too-big';
  return { fit, label: FIT_LABEL[fit], needGb: need };
}

const base = (t) => String(t || '').replace(/:latest$/, '');
export const sameModel = (a, b) => base(a) === base(b);

// The model the Local AI uses now. The saved choice is never changed here; when it isn't
// installed, an installed one is used and `notice` says so.
export function resolveLocalModel(saved, installed = [], enabled = null) {
  const offer = installed.filter((m) => !enabled || enabled[base(m)] !== false);
  if (saved && installed.some((m) => sameModel(m, saved))) return { use: installed.find((m) => sameModel(m, saved)), saved, notice: null };
  const use = offer[0] || installed[0] || null;
  return { use, saved: saved || null, notice: saved ? `${saved} isn't installed${use ? `; using ${use} until it is back (your choice is kept)` : ''}.` : null };
}

export function paramsOf(tag) {
  const p = LOCAL_PRESETS.find((x) => sameModel(x.tag, tag));
  if (p) return p.params;
  const m = String(tag || '').match(/:(\d+(?:\.\d+)?)b\b/i);
  return m ? Number(m[1]) : null;
}

// The Local AI reviews docs with a 7B+ model; code only when the owner allowed it (7B+).
export function localMayReview(task, { model = null, allowCode = false } = {}) {
  const p = paramsOf(model);
  const big = p !== null && p >= 7;
  if (task?.action === 'docs') return big ? { ok: true } : { ok: false, reason: 'the Local AI reviews docs only with a 7B or larger model' };
  if (!allowCode) return { ok: false, reason: 'code reviews need an AI that can use tools (the owner can let a 7B+ Local AI review code in Agents)' };
  return big ? { ok: true } : { ok: false, reason: 'the Local AI reviews code only with a 7B or larger model' };
}
let localCfg = { model: null, allowCode: false };
export function setLocalConfig(c) { localCfg = { model: c?.model || null, allowCode: c?.allowCode === true }; return localCfg; }
export const localReviewOk = (task) => localMayReview(task, localCfg).ok;

// ---------- @mentions ----------
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const EXTRA = { ollama: ['localai', 'local', 'ollama'] };
export function resolveMention(word) {
  const w = norm(word);
  if (!w) return null;
  return AGENT_IDS.find((a) => AGENTS[a].mention.map(norm).includes(w) || norm(AGENTS[a].name) === w || (EXTRA[a] || []).includes(w)) || null;
}
const dist = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
// @names in text that match nobody (emails like a@b.c are ignored), with suggestions.
export function unknownMentions(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/(^|[\s(,;])@([A-Za-z][\w.-]{0,30})/g)) {
    const word = m[2].replace(/[.-]+$/, '');
    if (resolveMention(word) || out.some((x) => x.name === word)) continue;
    const names = AGENT_IDS.flatMap((a) => [AGENTS[a].mention[0], ...(EXTRA[a] || [])].filter(Boolean).map((n) => ({ a, n })));
    const sugg = [...new Set(names.map((x) => ({ ...x, d: dist(norm(word), x.n) })).sort((p, q) => p.d - q.d).slice(0, 3).map((x) => `@${x.n}`))];
    out.push({ name: word, suggest: sugg });
  }
  return out;
}

// ---------- capabilities ----------
// What each tool can do through this app. Image input follows how agents.cjs passes images
// (Claude: file paths it opens; Codex: --image; Gemini/agy/Qwen: @path). Anything not known
// from the tool's flags is 'unknown', never guessed.
export const CAPS = {
  anthropic: { edits: true, commands: true, web: true, imageIn: true, imageOut: 'unknown', sizes: null },
  openai: { edits: true, commands: true, web: true, imageIn: true, imageOut: 'unknown', sizes: null },
  google: { edits: true, commands: true, web: true, imageIn: true, imageOut: 'unknown', sizes: null },
  qwen: { edits: true, commands: true, web: 'unknown', imageIn: true, imageOut: 'unknown', sizes: null },
  xai: { edits: true, commands: true, web: 'unknown', imageIn: false, imageOut: 'unknown', sizes: null, note: 'The app passes no images to Grok Build (no image flag is used); support is unverified.' },
  mistral: { edits: true, commands: true, web: 'unknown', imageIn: false, imageOut: 'unknown', sizes: null, note: 'Mistral Vibe gets no images from the app.' },
  perplexity: { edits: false, commands: false, web: true, imageIn: false, imageOut: false, sizes: null },
  deepseek: { edits: false, commands: false, web: false, imageIn: false, imageOut: false, sizes: null },
  ollama: { edits: false, commands: false, web: false, imageIn: false, imageOut: false, sizes: null },
  freebuff: { edits: true, commands: true, web: 'unknown', imageIn: 'unknown', imageOut: 'unknown', sizes: null },
};
// Recorded outcomes refine it: an image the AI attached from its own assets folder means
// image output works; the last successful run is its last good test.
export function capabilities(agent, { tasks = [], chat = [], api = false } = {}) {
  const c = { ...(CAPS[agent] || {}) };
  if (api) Object.assign(c, { edits: false, commands: false, imageIn: false });
  let lastOk = null;
  for (const t of tasks) for (const r of t.runs || []) if (r.agent === agent && ['done', 'ok', 'continue'].includes(r.status) && (!lastOk || r.at > lastOk)) lastOk = r.at;
  for (const m of chat) if (m.who === agent && !m.err && (!lastOk || m.at > lastOk)) lastOk = m.at;
  const madeImage = chat.find((m) => m.who === agent && (m.attachments || []).some((a) => a.kind === 'image' && /\.hearth-ai[\\/]assets[\\/]/.test(a.from || '')));
  if (madeImage && c.imageOut !== false) c.imageOut = true;
  return { ...c, lastOk };
}
export const canSeeImages = (agent, api = false) => !api && CAPS[agent]?.imageIn === true;

// ---------- progress lines ----------
// PROGRESS: lines (and a leading "working…" preamble) go in a collapsible block.
export function splitProgress(text) {
  const progress = [];
  const body = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*(?:PROGRESS|WORKING|STEP):\s*(.*)$/i);
    if (m) progress.push(m[1]); else body.push(line);
  }
  return { progress, body: body.join('\n').trim() };
}

// ---------- attachment sizes ----------
const NAMED = { '720p': [1280, 720], '1080p': [1920, 1080], 'full hd': [1920, 1080], fhd: [1920, 1080], '1440p': [2560, 1440], '2k': [2560, 1440], qhd: [2560, 1440], '4k': [3840, 2160], uhd: [3840, 2160], '2160p': [3840, 2160] };
export function requestedSize(text) {
  const s = String(text || '').toLowerCase();
  const m = s.match(/\b(\d{3,5})\s*[x×]\s*(\d{3,5})\b/);
  if (m) return { w: Number(m[1]), h: Number(m[2]) };
  for (const [k, [w, h]] of Object.entries(NAMED)) if (new RegExp(`(^|[^a-z0-9])${k.replace(' ', '\\s*')}($|[^a-z0-9])`).test(s)) return { w, h };
  return null;
}
export function belowRequested(att, want) {
  if (!want || !att?.width || !att?.height) return false;
  const [aw, ah] = [Math.max(att.width, att.height), Math.min(att.width, att.height)];
  const [ww, wh] = [Math.max(want.w, want.h), Math.min(want.w, want.h)];
  return aw < ww || ah < wh;
}
export function fmtBytes(n) {
  const b = Number(n) || 0;
  return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`;
}

// ---------- IMAGE REQUEST lines ----------
export function parseImageRequests(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const m = raw.replace(/^[\s*\-•`>]+/, '').replace(/[*`]+$/g, '').match(/^IMAGE REQUEST:\s*(.+)$/i);
    if (!m) continue;
    const parts = m[1].split('|').map((x) => x.trim());
    const prompt = parts[0];
    if (!prompt) continue;
    const opt = (k) => (parts.find((p) => p.toLowerCase().startsWith(`${k}:`)) || '').slice(k.length + 1).trim();
    const size = requestedSize(opt('size'));
    out.push({ prompt: prompt.slice(0, 1500), size: size ? `${size.w}x${size.h}` : null, for: opt('for').slice(0, 200) || null });
  }
  return out.slice(0, 3);
}
// An image-capable AI: known image output first, then 'unknown' ones that can use tools.
export function pickImageAI(candidates, caps) {
  return candidates.find((a) => caps[a]?.imageOut === true) || candidates.find((a) => caps[a]?.imageOut === 'unknown' && caps[a]?.edits) || null;
}

// ---------- checkpoint report ----------
export function checkpointReport(cp, who = '') {
  if (!cp?.sha) return null;
  const files = cp.files || [];
  const n = files.length || Number(String(cp.stat || '').match(/(\d+) files? changed/)?.[1] || 0);
  const first = files.slice(0, 4).join(', ');
  return `Checkpoint ${String(cp.sha).slice(0, 7)}${who ? ` (${who})` : ''}: ${n} file${n === 1 ? '' : 's'} changed${first ? ` — ${first}${files.length > 4 ? `, +${files.length - 4} more` : ''}` : ''}.`;
}

// ---------- action-line results ----------
export const ACTION_RE = /^(APPROVE|CHANGES|DENY|START|ADD TASK|TASK|ATTACH|EDIT|HANDOFF|IMAGE REQUEST|BACKGROUND)\b/i;
export function result(line, ok, reason = '') {
  return { line: String(line).slice(0, 120), ok: Boolean(ok), reason: String(reason || (ok ? 'done' : 'not done')).slice(0, 240) };
}

// ---------- what every AI is told about these ----------
export function extrasRules(agent) {
  return [
    `- Save images or other files you generate in $HEARTH_AI_ASSETS (your own folder: .hearth-ai/assets/${agent}/ in your workspace) and post them with ATTACH: .hearth-ai/assets/${agent}/<file>. That folder is never committed.`,
    '- Progress notes go on lines starting with PROGRESS: (shown folded); the rest of your reply is the answer.',
    '- If you need an image but have no image tools, write: IMAGE REQUEST: <prompt> | size: <WxH> | for: <task or purpose>. The app asks a teammate with image tools; the image comes back as an attachment.',
    '- For long work that should keep running in the background (image generation, deep research), write: BACKGROUND: <what to do>. It runs as a job and its result is posted when done.',
  ].join('\n');
}
